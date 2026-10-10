package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func nada(context.Context) error { return nil }

func TestAgendasDeProducaoSaoValidas(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	for i, ag := range []string{
		"* * * * *", "0 10 * * *", "0 15 * * *", "0 21 * * *", "59 2 * * *", "5 * * * *", "30 3 * * *",
		"2-59/5 * * * *", "*/30 * * * *", "*/5 * * * *", "30 10 * * 1-5", "10 * * * *", "17 4 * * *",
		"30 2 * * *", "0 11 * * *", "0 1 * * *", "41 5 * * *",
	} {
		if err := a.Registrar(Tarefa{Nome: fmt.Sprintf("t%d", i), Agenda: ag, Limite: time.Second, Executar: nada}); err != nil {
			t.Errorf("agenda %q: %v", ag, err)
		}
	}
	if err := a.Registrar(Tarefa{Nome: "x", Agenda: "isto não é cron", Limite: time.Second, Executar: nada}); err == nil {
		t.Error("agenda inválida deveria falhar")
	}
	if err := a.Registrar(Tarefa{Nome: "t0", Agenda: "* * * * *", Limite: time.Second, Executar: nada}); err == nil {
		t.Error("nome repetido deveria falhar")
	}
}

func linha(t *testing.T, p *pgxpool.Pool, robo string) (ok bool, resp string, n int) {
	t.Helper()
	p.QueryRow(context.Background(), `select count(*) from robos_execucoes where robo = $1`, robo).Scan(&n)
	p.QueryRow(context.Background(), `select coalesce(ok, false), coalesce(resposta, '') from robos_execucoes where robo = $1 order by id desc limit 1`, robo).Scan(&ok, &resp)
	return
}

// semTrava confere em pg_locks (visão do cluster inteiro) que a trava da tarefa não sobrou.
// pg_try_advisory_lock(int, int) guarda a 1ª chave em classid, a 2ª em objid e objsubid = 2.
func semTrava(t *testing.T, p *pgxpool.Pool, trava string) {
	t.Helper()
	var n int
	if err := p.QueryRow(context.Background(), `select count(*) from pg_locks
		where locktype = 'advisory' and objsubid = 2 and granted
		  and classid::bigint = $1::bigint and objid::bigint = (hashtext($2::text)::bigint & 4294967295)`,
		int64(EspacoDaTrava), trava).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("trava de %q vazou (%d linhas em pg_locks)", trava, n)
	}
}

func TestRodarRegistraSucessoEErroComConferidoEm(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	ctx := context.Background()
	if ex, err := a.Rodar(ctx, Tarefa{Nome: "boa", Limite: time.Second, Executar: nada}); !ex || err != nil {
		t.Fatalf("ex=%v err=%v", ex, err)
	}
	if ok, resp, n := linha(t, p, "boa"); !ok || resp != "ok" || n != 1 {
		t.Fatalf("ok=%v resp=%q n=%d", ok, resp, n)
	}
	ex, err := a.Rodar(ctx, Tarefa{Nome: "ruim", Limite: time.Second, Executar: func(context.Context) error { return errors.New("bling fora") }})
	if !ex || err == nil || err.Error() != "bling fora" {
		t.Fatalf("o erro da tarefa volta para quem chamou: ex=%v err=%v", ex, err)
	}
	if ok, resp, _ := linha(t, p, "ruim"); ok || resp != "bling fora" {
		t.Fatalf("ok=%v resp=%q", ok, resp)
	}
	var semConferir, status500 int
	p.QueryRow(ctx, `select count(*) filter (where conferido_em is null), count(*) filter (where status_code = 500) from robos_execucoes`).Scan(&semConferir, &status500)
	if semConferir != 0 || status500 != 1 {
		t.Fatalf("toda linha nasce conferida (conferir-robos não reescreve): sem conferido_em=%d, status 500=%d", semConferir, status500)
	}
	semTrava(t, p, "boa")
	semTrava(t, p, "ruim")
}

func TestRespostaSemSegredoECortadaEm500(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Segredos = []string{"segredo-do-chatwoot-123", "curto"}
	longo := strings.Repeat("é", 600)
	a.Rodar(context.Background(), Tarefa{Nome: "vaza", Limite: time.Second, Executar: func(context.Context) error {
		return fmt.Errorf("POST https://x/token/segredo-do-chatwoot-123/send curto %s", longo)
	}})
	_, resp, _ := linha(t, p, "vaza")
	if strings.Contains(resp, "segredo-do-chatwoot-123") || !strings.Contains(resp, "/token/***/send curto") {
		t.Fatalf("segredo na resposta (ou o curto foi trocado): %q", resp)
	}
	if n := len([]rune(resp)); n != 500 {
		t.Fatalf("resposta com %d caracteres, esperava 500", n)
	}
}

func TestLimiteDeTempoCancelaATarefa(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Rodar(context.Background(), Tarefa{Nome: "lenta", Limite: 50 * time.Millisecond,
		Executar: func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }})
	if ok, resp, _ := linha(t, p, "lenta"); ok || !strings.Contains(resp, "deadline") {
		t.Fatalf("ok=%v resp=%q", ok, resp)
	}
	semTrava(t, p, "lenta")
}

func TestDuasInstanciasSoUmaExecutaEAPuladaNaoGravaLinha(t *testing.T) {
	p := testebanco.Novo(t)
	a, b := Novo(p), Novo(p) // dois processos de worker no mesmo banco (deploy sobreposto)
	preso, liberar := make(chan struct{}), make(chan struct{})
	tarefa := Tarefa{Nome: "unica", Limite: 5 * time.Second, Executar: func(context.Context) error {
		close(preso)
		<-liberar
		return nil
	}}
	feito := make(chan bool)
	go func() { ex, _ := a.Rodar(context.Background(), tarefa); feito <- ex }()
	select {
	case <-preso:
	case <-time.After(5 * time.Second):
		t.Fatal("a primeira execução não começou")
	}
	ex, err := b.Rodar(context.Background(), Tarefa{Nome: "unica", Limite: time.Second, Executar: func(context.Context) error { t.Error("não podia executar"); return nil }})
	if ex || err != nil {
		t.Fatalf("segunda: ex=%v err=%v", ex, err)
	}
	close(liberar)
	if !<-feito {
		t.Fatal("a primeira deveria ter executado")
	}
	if _, _, n := linha(t, p, "unica"); n != 1 {
		t.Fatalf("pulada não grava linha: esperava 1, achei %d", n)
	}
	if b.metricas["unica"].Puladas != 1 {
		t.Fatalf("pulada não contou: %+v", b.metricas["unica"])
	}
}

func TestTravaCompartilhadaEntreTarefas(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	preso, liberar := make(chan struct{}), make(chan struct{})
	go a.Rodar(context.Background(), Tarefa{Nome: "meta-hora", Trava: "coletar-dados-hora", Limite: 5 * time.Second,
		Executar: func(context.Context) error { close(preso); <-liberar; return nil }})
	<-preso
	ex, _ := a.Rodar(context.Background(), Tarefa{Nome: "meta-hora-retentativa-00h", Trava: "coletar-dados-hora", Limite: time.Second, Executar: nada})
	close(liberar)
	if ex {
		t.Fatal("tarefas com a mesma Trava não podem rodar juntas")
	}
}

func TestEspacoDeDuasChavesNaoColideComAsFuncoesSQL(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	ctx := context.Background()
	// Uma função de produção segura a trava de UMA chave com o mesmo texto: o worker roda mesmo assim.
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('pegar_da_fila'))`); err != nil {
		t.Fatal(err)
	}
	if ex, err := a.Rodar(ctx, Tarefa{Nome: "pegar_da_fila", Limite: time.Second, Executar: nada}); !ex || err != nil {
		t.Fatalf("colidiu com a trava de uma chave: ex=%v err=%v", ex, err)
	}
}

func TestPanicoViraErroELiberaATrava(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	ctx := context.Background()
	ex, err := a.Rodar(ctx, Tarefa{Nome: "boom", Limite: time.Second, Executar: func(context.Context) error { panic("kaboom") }})
	if !ex || err == nil || !strings.Contains(err.Error(), "kaboom") {
		t.Fatalf("ex=%v err=%v", ex, err)
	}
	semTrava(t, p, "boom")
	for i, f := range []func(context.Context) error{nada, func(context.Context) error { return errors.New("falha") },
		func(c context.Context) error { <-c.Done(); return c.Err() }} {
		if ex, _ := a.Rodar(ctx, Tarefa{Nome: "boom", Limite: 20 * time.Millisecond, Executar: f}); !ex {
			t.Fatalf("rodada %d depois de liberar a trava não executou", i)
		}
		semTrava(t, p, "boom")
	}
	if _, _, n := linha(t, p, "boom"); n != 4 {
		t.Fatalf("esperava 4 linhas, achei %d", n)
	}
}

// Pool de 2 conexões e 6 tarefas que USAM o banco ao mesmo tempo: a trava não pode tomar conexão do
// pool (senão as tarefas esperariam umas pelas outras até o prazo).
func TestTarefasQueUsamOBancoNaoTravamOPool(t *testing.T) {
	grande := testebanco.Novo(t)
	cfg := grande.Config()
	cfg.MaxConns = 2
	pequeno, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pequeno.Close)
	a := Novo(pequeno)
	var wg sync.WaitGroup
	for i := range 6 {
		wg.Go(func() {
			a.Rodar(context.Background(), Tarefa{Nome: fmt.Sprintf("pool-%d", i), Limite: 5 * time.Second,
				Executar: func(ctx context.Context) error {
					_, err := pequeno.Exec(ctx, `select pg_sleep(0.1)`)
					return err
				}})
		})
	}
	feito := make(chan struct{})
	go func() { wg.Wait(); close(feito) }()
	select {
	case <-feito:
	case <-time.After(10 * time.Second):
		t.Fatal("tarefas presas: a trava está disputando o pool")
	}
	for i := range 6 {
		if ok, resp, n := linha(t, grande, fmt.Sprintf("pool-%d", i)); !ok || n != 1 {
			t.Errorf("pool-%d: ok=%v resp=%q n=%d", i, ok, resp, n)
		}
	}
}

func TestRegistroProprioSoGravaALinhaDaTarefaNaFalha(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	gravar := a.Gravador()
	ctx := context.Background()
	a.Rodar(ctx, Tarefa{Nome: "coletar-dados-07h", RegistroProprio: true, Limite: time.Second, Executar: func(ctx context.Context) error {
		return gravar(ctx, "coletar-dados-07h · Vessel", time.Now(), nil)
	}})
	if _, _, n := linha(t, p, "coletar-dados-07h"); n != 0 {
		t.Fatal("com RegistroProprio e sucesso, o agendador não grava a linha dele")
	}
	if ok, _, n := linha(t, p, "coletar-dados-07h · Vessel"); !ok || n != 1 {
		t.Fatal("a linha da variante não foi gravada")
	}
	a.Rodar(ctx, Tarefa{Nome: "coletar-dados-07h", RegistroProprio: true, Limite: time.Second, Executar: func(context.Context) error { panic("x") }})
	if ok, _, n := linha(t, p, "coletar-dados-07h"); ok || n != 1 {
		t.Fatal("falha inteira tem de aparecer com o nome da tarefa")
	}
}

func TestDesligadaNaoAgendaMasFicaParaORodarManual(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	a.Desligadas = []string{"vessel-rd-station"}
	if err := a.Registrar(Tarefa{Nome: "vessel-rd-station", Agenda: "* * * * *", Limite: time.Second, Executar: nada}); err != nil {
		t.Fatal(err)
	}
	if err := a.Registrar(Tarefa{Nome: "conferir-robos", Agenda: "* * * * *", Limite: time.Second, Executar: nada}); err != nil {
		t.Fatal(err)
	}
	if len(a.cron.Entries()) != 1 {
		t.Fatalf("só a ligada entra na agenda: %d entradas", len(a.cron.Entries()))
	}
	if _, ok := a.Buscar("vessel-rd-station"); !ok || !a.Desligada("vessel-rd-station") || a.Desligada("conferir-robos") {
		t.Fatal("a desligada continua registrada (para `api worker rodar --forcar`)")
	}
	a.Desligadas = []string{"*"}
	if !a.Desligada("qualquer") {
		t.Fatal(`"*" desliga todas`)
	}
}

func TestLimiteEExecutarInvalidosSaoRejeitados(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	casos := map[string]Tarefa{
		"limite zero":     {Nome: "v1", Agenda: "* * * * *", Executar: nada},
		"limite negativo": {Nome: "v2", Agenda: "* * * * *", Limite: -time.Second, Executar: nada},
		"executar nil":    {Nome: "v3", Agenda: "* * * * *", Limite: time.Second},
		"sem nome":        {Agenda: "* * * * *", Limite: time.Second, Executar: nada},
	}
	for nome, tf := range casos {
		if err := a.Registrar(tf); err == nil {
			t.Errorf("%s: Registrar deveria falhar", nome)
		}
		if ex, err := a.Rodar(context.Background(), tf); ex || err == nil {
			t.Errorf("%s: Rodar deveria falhar sem executar (ex=%v err=%v)", nome, ex, err)
		}
	}
	var n int
	p.QueryRow(context.Background(), `select count(*) from robos_execucoes`).Scan(&n)
	if n != 0 {
		t.Fatalf("nenhuma linha podia ser gravada: %d", n)
	}
}

// Desligamento: a tarefa em andamento tem a Graca; depois o contexto dela é cancelado e a linha de
// erro ainda é gravada (nada fica pendurado sem registro).
func TestDesligamentoCancelaDepoisDaGraca(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Graca = 100 * time.Millisecond
	comecou := make(chan struct{})
	var uma sync.Once
	if err := a.Registrar(Tarefa{Nome: "presa", Agenda: "@every 1s", Limite: time.Minute, Executar: func(ctx context.Context) error {
		uma.Do(func() { close(comecou) })
		<-ctx.Done()
		return ctx.Err()
	}}); err != nil {
		t.Fatal(err)
	}
	ctx, parar := context.WithCancel(context.Background())
	fim := make(chan struct{})
	go func() { a.Iniciar(ctx); close(fim) }()
	select {
	case <-comecou:
	case <-time.After(5 * time.Second):
		t.Fatal("a tarefa não foi agendada")
	}
	parar()
	select {
	case <-fim:
	case <-time.After(10 * time.Second):
		t.Fatal("Iniciar não voltou depois da graça")
	}
	if ok, resp, n := linha(t, p, "presa"); ok || n != 1 || !strings.Contains(resp, "canceled") {
		t.Fatalf("ok=%v resp=%q n=%d", ok, resp, n)
	}
}

func TestSaudeEMetricas(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Segredos = []string{"segredo-123456"}
	a.Registrar(Tarefa{Nome: "falha", Agenda: "0 1 * * *", Limite: time.Second, Executar: func(context.Context) error { return errors.New("x segredo-123456") }})
	a.Rodar(context.Background(), Tarefa{Nome: "falha", Limite: time.Second, Executar: func(context.Context) error { return errors.New("x segredo-123456") }})
	h := a.Saude()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/saude", nil))
	if w.Code != 503 {
		t.Fatalf("parado: %d", w.Code)
	}
	a.rodando.Store(true)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/saude", nil))
	if w.Code != 200 {
		t.Fatalf("rodando: %d", w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/metricas", nil))
	var m map[string]struct {
		Agenda     string `json:"agenda"`
		Falhas     int64  `json:"falhas"`
		UltimoErro string `json:"ultimo_erro"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil || m["falha"].Falhas != 1 || m["falha"].Agenda != "0 1 * * *" {
		t.Fatalf("métricas: %s (%v)", w.Body, err)
	}
	if strings.Contains(w.Body.String(), "segredo-123456") {
		t.Fatalf("segredo nas métricas: %s", w.Body)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/saude", nil))
	if w.Code != 405 {
		t.Fatalf("saúde é só leitura: POST = %d", w.Code)
	}
}

func TestLivroDeEnvios(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if ok, err := banco.ReservarEnvio(ctx, p, "relatorio:2026-10-10:14:wpp"); !ok || err != nil {
		t.Fatalf("primeira reserva: ok=%v err=%v", ok, err)
	}
	if ok, _ := banco.ReservarEnvio(ctx, p, "relatorio:2026-10-10:14:wpp"); ok {
		t.Fatal("a mesma chave não pode ser reservada duas vezes")
	}
	if err := banco.LiberarEnvio(ctx, p, "relatorio:2026-10-10:14:wpp"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := banco.ReservarEnvio(ctx, p, "relatorio:2026-10-10:14:wpp"); !ok {
		t.Fatal("liberada, pode ser reservada de novo")
	}
}
