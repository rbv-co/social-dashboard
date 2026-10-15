package web

// Plano 07 do esforço REVISAO-TESTES-2026-10 (item A): quantas consultas ao banco cada rota faz por requisição.
//
// Um tracer do pgx conta as consultas de cada GET sem parâmetro de caminho e de cada RPC de leitura sem parâmetro
// obrigatório, com a sessão de superadmin. Rota que faz mais de maxConsultasPorRota consultas (N+1 ou sobreposição de
// portões) reprova, e rota que responde 5xx também. Com CARGA_BANCO_URL (e CARGA_EMAIL de um usuário painel) o mesmo
// teste roda contra uma CÓPIA do banco com dado real (ensaio na VPS): é lá que o N+1 aparece, porque a conta
// de consultas por linha só cresce com linhas. Sem a variável, roda no esquema de produção vazio (custo fixo por rota).

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/config"
)

// maxConsultasPorRota: teto de consultas por requisição. A sessão, o perfil e o escopo custam ~4; o resto é a rota.
const maxConsultasPorRota = 12

type contadorDeConsultas struct {
	n    atomic.Int64
	mu   sync.Mutex
	sqls []string
}

func (c *contadorDeConsultas) TraceQueryStart(ctx context.Context, _ *pgx.Conn, d pgx.TraceQueryStartData) context.Context {
	c.n.Add(1)
	c.mu.Lock()
	c.sqls = append(c.sqls, strings.Join(strings.Fields(d.SQL), " "))
	c.mu.Unlock()
	return ctx
}
func (c *contadorDeConsultas) TraceQueryEnd(context.Context, *pgx.Conn, pgx.TraceQueryEndData) {}

// mundoContado devolve a API montada sobre um pool com contador e o token de um superadmin.
func mundoContado(t *testing.T, c *contadorDeConsultas) (http.Handler, string) {
	t.Helper()
	ctx := context.Background()
	var base *pgxpool.Pool
	var id, tok string
	if url := os.Getenv("CARGA_BANCO_URL"); url != "" {
		cfg, err := pgxpool.ParseConfig(url)
		if err != nil {
			t.Fatal(err)
		}
		banco.Configurar(cfg)
		if base, err = pgxpool.NewWithConfig(ctx, cfg); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(base.Close)
		if err := base.QueryRow(ctx, `select id::text from usuarios where lower(email) = lower($1::text)`, os.Getenv("CARGA_EMAIL")).Scan(&id); err != nil {
			t.Fatalf("CARGA_EMAIL: %v", err)
		}
	} else {
		var sessoes func() map[perfil]string
		base, _, sessoes, _, _ = mundoDaMatriz(t) // o esquema de produção vazio, com o superadmin e as tabelas do 5.12
		tok = sessoes()[pSuper]
	}
	cfg := base.Config()
	cfg.ConnConfig.Tracer = c
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	st := auth.NovoStore(p)
	if tok == "" {
		if tok, err = st.Criar(ctx, id, "painel", nil); err != nil {
			t.Fatal(err)
		}
	}
	return Rotas(p, st, auth.NovoLimitador(), config.Config{}), tok
}

func TestConsultasPorRota(t *testing.T) {
	c := &contadorDeConsultas{}
	h, tok := mundoContado(t, c)
	type pedido struct{ metodo, caminho, corpo string }
	var pedidos []pedido
	err := chi.Walk(h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == "GET" && !strings.Contains(rota, "{") && rota != "/saude" {
			pedidos = append(pedidos, pedido{metodo, strings.TrimSuffix(rota, "/"), ""})
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range FuncoesRPC {
		semObrigatorio := !f.SoSessaoPropria
		for _, p := range f.Params {
			semObrigatorio = semObrigatorio && p.Opcional
		}
		if semObrigatorio {
			pedidos = append(pedidos, pedido{"POST", "/rpc/" + f.Nome, "{}"})
		}
	}
	type medida struct {
		pedido
		consultas int64
		status    int
		dur       time.Duration
		bytes     int
	}
	var ms []medida
	for _, pd := range pedidos {
		r := httptest.NewRequest(pd.metodo, pd.caminho, strings.NewReader(pd.corpo))
		r.Header.Set("Authorization", "Bearer "+tok)
		if pd.corpo != "" {
			r.Header.Set("Content-Type", "application/json")
		}
		w := httptest.NewRecorder()
		c.n.Store(0)
		c.mu.Lock()
		c.sqls = nil
		c.mu.Unlock()
		t0 := time.Now()
		h.ServeHTTP(w, r)
		ms = append(ms, medida{pd, c.n.Load(), w.Code, time.Since(t0), w.Body.Len()})
		if os.Getenv("CARGA_SQL") == pd.caminho { // CARGA_SQL=/comercial/lojas mostra as consultas dessa rota
			t.Logf("consultas de %s:\n  %s", pd.caminho, strings.Join(c.sqls, "\n  "))
		}
	}
	sort.Slice(ms, func(i, j int) bool { return ms[i].consultas > ms[j].consultas })
	var tab strings.Builder
	for _, m := range ms {
		fmt.Fprintf(&tab, "\n%3d consultas  %d  %8s  %7d B  %s %s", m.consultas, m.status, m.dur.Round(time.Millisecond), m.bytes, m.metodo, m.caminho)
		if m.consultas > maxConsultasPorRota {
			t.Errorf("%s %s fez %d consultas (teto %d): N+1 ou portão repetido", m.metodo, m.caminho, m.consultas, maxConsultasPorRota)
		}
		if m.status >= 500 {
			t.Errorf("%s %s respondeu %d", m.metodo, m.caminho, m.status)
		}
	}
	// sanidade: o tracer pegou o pool certo e a sessão vale (senão tudo daria 0 consultas ou 401 e passaria vazio)
	var contaram, autorizadas int
	for _, m := range ms {
		if m.consultas > 0 {
			contaram++
		}
		if m.status == 200 {
			autorizadas++
		}
		if m.status == 401 || m.status == 429 {
			t.Errorf("%s %s respondeu %d: a sessão do teste não vale", m.metodo, m.caminho, m.status)
		}
	}
	if contaram < len(ms)/2 || autorizadas < len(ms)/2 {
		t.Errorf("só %d de %d pedidos contaram consultas e %d responderam 200", contaram, len(ms), autorizadas)
	}
	t.Logf("%d pedidos%s", len(ms), tab.String())
}
