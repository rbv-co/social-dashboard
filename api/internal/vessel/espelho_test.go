package vessel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/github"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// githubFalso responde ao dispatch com o status dado (0 = fecha a conexão sem responder) e guarda os pedidos.
type githubFalso struct {
	status  atomic.Int32
	mu      sync.Mutex
	pedidos []string
	srv     *httptest.Server
}

func novoGitHubFalso(t *testing.T, status int) *githubFalso {
	t.Helper()
	f := &githubFalso{}
	f.status.Store(int32(status))
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.pedidos = append(f.pedidos, r.Method+" "+r.URL.Path)
		f.mu.Unlock()
		if f.status.Load() == 0 {
			hj, _ := w.(http.Hijacker)
			c, _, _ := hj.Hijack()
			c.Close()
			return
		}
		w.WriteHeader(int(f.status.Load()))
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *githubFalso) n() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.pedidos)
}

func espelhoDeTeste(t *testing.T, f *githubFalso, token string) (*Espelho, *pgxpool.Pool) {
	t.Helper()
	p := testebanco.Novo(t)
	return &Espelho{Pool: p, GitHub: github.ParaTeste(t, token, f.srv.URL)}, p
}

func pede(t *testing.T, p *pgxpool.Pool, vezes int) {
	t.Helper()
	for range vezes {
		if _, err := p.Exec(context.Background(), `select disparar_robo('vessel-espelhar-lista', 'x', 'y')`); err != nil {
			t.Fatal(err)
		}
	}
}

func situacoes(t *testing.T, p *pgxpool.Pool) string {
	t.Helper()
	var s string
	if err := p.QueryRow(context.Background(), `select coalesce(string_agg(situacao || ':' || pedidos, ',' order by id), '-') from disparos_pendentes where robo = 'vessel-espelhar-lista'`).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

// envelhece: o último atendimento foi há `min` minutos (o intervalo mínimo conta a partir dele).
func envelhece(t *testing.T, p *pgxpool.Pool, min int) {
	t.Helper()
	if _, err := p.Exec(context.Background(), `update disparos_pendentes set atualizado_em = now() - make_interval(mins => $1::int) where situacao <> 'pendente'`, min); err != nil {
		t.Fatal(err)
	}
}

// Pedido esperando → UM despacho do workflow certo; sem pedido, nenhuma chamada ao GitHub.
func TestEspelhoDespachaOWorkflow(t *testing.T) {
	f := novoGitHubFalso(t, 204)
	e, p := espelhoDeTeste(t, f, "pat")
	ctx := context.Background()
	if err := e.rodar(ctx); err != nil || f.n() != 0 {
		t.Fatalf("sem pedido: err %v, %d chamadas", err, f.n())
	}
	pede(t, p, 1)
	if err := e.rodar(ctx); err != nil {
		t.Fatal(err)
	}
	if f.n() != 1 || f.pedidos[0] != "POST /repos/rbv-co/social-dashboard/actions/workflows/espelho-da-vessel.yml/dispatches" {
		t.Errorf("despachos = %v", f.pedidos)
	}
	if got := situacoes(t, p); got != "feito:1" {
		t.Errorf("pedido = %s, esperava feito:1", got)
	}
	if err := e.rodar(ctx); err != nil || f.n() != 1 {
		t.Errorf("rodar de novo sem pedido novo: err %v, %d despachos", err, f.n())
	}
	tr := e.Tarefa()
	if tr.Nome != "vessel-espelhar-lista" || tr.Agenda != "* * * * *" {
		t.Errorf("tarefa = %+v", tr)
	}
}

// Pico de cadastros: 50 pedidos juntos viram UM pedido (pedidos = 50) e UM despacho; o próximo só depois do intervalo.
func TestEspelhoNoPicoDespachaPoucoEJuntaOsPedidos(t *testing.T) {
	f := novoGitHubFalso(t, 204)
	e, p := espelhoDeTeste(t, f, "pat")
	ctx := context.Background()
	pede(t, p, 50)
	e.rodar(ctx)
	if f.n() != 1 || situacoes(t, p) != "feito:50" {
		t.Fatalf("pico: %d despachos, pedido %s", f.n(), situacoes(t, p))
	}
	// chegam mais cadastros logo depois: o intervalo mínimo segura (o pedido espera, nada se perde)
	pede(t, p, 3)
	for range 5 {
		e.rodar(ctx)
	}
	if f.n() != 1 || situacoes(t, p) != "feito:50,pendente:3" {
		t.Errorf("dentro do intervalo: %d despachos, %s", f.n(), situacoes(t, p))
	}
	envelhece(t, p, 6)
	e.rodar(ctx)
	if f.n() != 2 || situacoes(t, p) != "feito:50,feito:3" {
		t.Errorf("depois do intervalo: %d despachos, %s", f.n(), situacoes(t, p))
	}
}

// 502, 504 e a conexão que cai depois de enviar = INCERTO: nunca se repete sozinho (o pedido não volta a pendente);
// o próximo cadastro abre outro pedido, atendido depois do intervalo.
func TestEspelhoIncertoNuncaRepete(t *testing.T) {
	for _, st := range []int{502, 504, 0} {
		f := novoGitHubFalso(t, st)
		e, p := espelhoDeTeste(t, f, "pat")
		ctx := context.Background()
		pede(t, p, 1)
		err := e.rodar(ctx)
		if err == nil || !strings.Contains(err.Error(), "incerto") {
			t.Errorf("status %d: err = %v, esperava incerto", st, err)
		}
		if got := situacoes(t, p); got != "incerto:1" {
			t.Errorf("status %d: pedido = %s", st, got)
		}
		envelhece(t, p, 10)
		for range 3 {
			e.rodar(ctx)
		}
		if f.n() != 1 {
			t.Errorf("status %d: %d despachos, o incerto foi refeito", st, f.n())
		}
		pede(t, p, 1)
		f.status.Store(204)
		if e.rodar(ctx); f.n() != 2 || !strings.HasSuffix(situacoes(t, p), "feito:1") {
			t.Errorf("status %d: depois de novo cadastro: %d despachos, %s", st, f.n(), situacoes(t, p))
		}
	}
}

// Recusa do GitHub (token vencido, sem permissão, workflow que não existe, entrada inválida) = 'falhou' À VISTA (erro na
// tarefa e no pedido, sem segredo), sem repetir.
func TestEspelhoFalhaAVista(t *testing.T) {
	for st, classe := range map[int]string{401: "token_invalido", 403: "sem_permissao", 404: "nao_encontrado", 422: "recusado"} {
		f := novoGitHubFalso(t, st)
		e, p := espelhoDeTeste(t, f, "SEGREDO-do-pat")
		pede(t, p, 1)
		err := e.rodar(context.Background())
		if err == nil || !strings.Contains(err.Error(), classe) || strings.Contains(err.Error(), "SEGREDO") {
			t.Errorf("status %d: err = %v, esperava a classe %s sem o token", st, err, classe)
		}
		var erro string
		p.QueryRow(context.Background(), `select situacao || '|' || coalesce(erro, '') from disparos_pendentes where robo = 'vessel-espelhar-lista'`).Scan(&erro)
		if !strings.HasPrefix(erro, "falhou|") || strings.Contains(erro, "SEGREDO") {
			t.Errorf("status %d: pedido = %q", st, erro)
		}
		envelhece(t, p, 10)
		e.rodar(context.Background())
		if f.n() != 1 {
			t.Errorf("status %d: %d despachos: a falha foi repetida sozinha", st, f.n())
		}
	}
}

// Sem GITHUB_PAT: a tarefa falha à vista e o pedido NÃO é consumido (fica pendente para quando o token chegar).
func TestEspelhoSemTokenNaoConsomeOPedido(t *testing.T) {
	f := novoGitHubFalso(t, 204)
	e, p := espelhoDeTeste(t, f, "")
	pede(t, p, 1)
	if err := e.rodar(context.Background()); err == nil || !strings.Contains(err.Error(), "GITHUB_PAT") {
		t.Errorf("err = %v, esperava a mensagem do token ausente", err)
	}
	if got := situacoes(t, p); got != "pendente:1" || f.n() != 0 {
		t.Errorf("pedido = %s, %d chamadas: o pedido não pode ser consumido sem token", got, f.n())
	}
	e.GitHub = nil
	if err := e.rodar(context.Background()); err == nil {
		t.Error("sem cliente do GitHub a tarefa devia falhar à vista")
	}
}

// Duas instâncias da tarefa ao mesmo tempo: um despacho só.
func TestEspelhoDuasInstanciasUmDespacho(t *testing.T) {
	f := novoGitHubFalso(t, 204)
	e, p := espelhoDeTeste(t, f, "pat")
	pede(t, p, 1)
	var wg sync.WaitGroup
	for range 6 {
		wg.Add(1)
		go func() { defer wg.Done(); e.rodar(context.Background()) }()
	}
	wg.Wait()
	if f.n() != 1 {
		t.Errorf("%d despachos com 6 instâncias, esperava 1", f.n())
	}
	_ = time.Second
}
