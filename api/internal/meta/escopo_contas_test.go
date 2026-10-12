package meta

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// Ruling 34 (5.6-4) e 5.6-5/6: a conta do pedido passa na regra das tabelas, o caminho mora nela e a
// sessão de "entrar como" só lê. Cada recusa é assertada COM o efeito: o core de mentira não recebeu pedido.
func TestMetaProxyEscopoDeContas(t *testing.T) {
	a := montarMeta(t, graphOK(`{"data":[]}`))
	pedir := func(token, corpo string) (int, string) {
		w := a.post("/meta-proxy", token, corpo)
		return w.Code, w.Body.String()
	}
	corpo := func(conta, path string) string {
		b, _ := json.Marshal(map[string]string{"accountId": conta, "path": path})
		return string(b)
	}
	const naoAcha = `{"error":"conta nao encontrada"}`

	t.Run("conta que a pessoa não vê responde igual à que não existe", func(t *testing.T) {
		antes := a.core.n()
		st1, c1 := pedir(a.tokens[uRestrito], corpo("conta-3", "/act_999/insights"))
		st2, c2 := pedir(a.tokens[uRestrito], corpo("nao-existe", "/act_999/insights"))
		if st1 != 400 || strings.TrimSpace(c1) != naoAcha || st1 != st2 || c1 != c2 {
			t.Fatalf("conta-3: %d %s / nao-existe: %d %s", st1, c1, st2, c2)
		}
		if a.core.n() != antes {
			t.Fatalf("o core recebeu pedido de conta invisível (%d -> %d)", antes, a.core.n())
		}
	})

	t.Run("a própria conta passa, com caminho ancorado", func(t *testing.T) {
		for _, c := range []struct{ path, extra string }{
			{"/act_999/insights", ""}, {"act_999/campaigns", ""}, {"/1784/media", ""}, {"/search", `,"params":{"type":"adinterest"}`},
			{"/act_999/campaigns", `,"method":"POST"`},
		} {
			antes := a.core.n()
			b := strings.TrimSuffix(corpo("conta-1", c.path), "}") + c.extra + "}"
			if st, resp := pedir(a.tokens[uRestrito], b); st != 200 {
				t.Errorf("%s: %d %s", b, st, resp)
			}
			if a.core.n() != antes+1 {
				t.Errorf("%s: core chamado %d vezes, esperava 1", b, a.core.n()-antes)
			}
		}
	})

	t.Run("caminho fora da conta é recusado sem chegar ao core", func(t *testing.T) {
		for _, path := range []string{"/act_123/insights", "/1785/insights", "/me/adaccounts", "/act_999/../act_123/insights", "/act_999/../me/adaccounts",
			"/v22.0/act_999/insights", "/9001", "/", "/act_999%2F..%2Fact_1/insights", "/act_999/insights?ids=1", "/ACT_999/insights"} {
			antes := a.core.n()
			st, resp := pedir(a.tokens[uRestrito], corpo("conta-1", path))
			if st != 403 || strings.TrimSpace(resp) != `{"error":"caminho fora da conta"}` {
				t.Errorf("%q: %d %s", path, st, resp)
			}
			if a.core.n() != antes {
				t.Errorf("%q: o core recebeu pedido de caminho fora da conta", path)
			}
		}
	})

	t.Run("params ids e batch saem do caminho ancorado", func(t *testing.T) {
		for _, params := range []string{`{"ids":"1,2"}`, `{"BATCH":"[]"}`} {
			antes := a.core.n()
			b := `{"accountId":"conta-1","path":"/act_999/insights","params":` + params + `}`
			st, resp := pedir(a.tokens[uRestrito], b)
			if st != 403 || strings.TrimSpace(resp) != `{"error":"caminho fora da conta"}` {
				t.Errorf("%s: %d %s", b, st, resp)
			}
			if a.core.n() != antes {
				t.Errorf("%s: o core recebeu o pedido", b)
			}
		}
		antes := a.core.n()
		if st, resp := pedir(a.tokens[uMeta], `{"accountId":"conta-1","path":"/act_999/insights","params":{"ids":"1"}}`); st != 200 || a.core.n() != antes+1 {
			t.Errorf("uMeta com ids (paridade): %d %s, core %d", st, resp, a.core.n()-antes)
		}
	})

	t.Run("quem vê todas as contas não tem âncora (paridade com o Plano 3)", func(t *testing.T) {
		for nome, tok := range map[string]string{"admin com lista": a.tokens[uAdminRestrito], "sem lista": a.tokens[uMeta]} {
			antes := a.core.n()
			if st, resp := pedir(tok, corpo("conta-3", "/me/adaccounts")); st != 200 {
				t.Errorf("%s: %d %s", nome, st, resp)
			}
			if a.core.n() != antes+1 {
				t.Errorf("%s: core chamado %d vezes, esperava 1", nome, a.core.n()-antes)
			}
		}
	})

	t.Run("entrar como não escreve pelo override method da Graph", func(t *testing.T) {
		antes := a.core.n()
		for _, b := range []string{
			`{"accountId":"conta-1","path":"/9001","params":{"method":"delete"}}`,
			`{"accountId":"conta-1","path":"/act_999/campaigns","params":{"METHOD":"POST"}}`,
		} {
			st, resp := pedir(a.tokens["impersonado"], b)
			if st != 403 || !strings.Contains(resp, `"sem_permissao"`) || !strings.Contains(resp, "Quem entrou como outra pessoa") {
				t.Errorf("%s: %d %s", b, st, resp)
			}
		}
		if a.core.n() != antes {
			t.Fatalf("o override method chegou ao core (%d pedidos)", a.core.n()-antes)
		}
		// paridade: sessão normal segue passando o param (o Plano 3 não o filtrava)
		if st, resp := pedir(a.tokens[uMeta], `{"accountId":"conta-1","path":"/9001","params":{"method":"delete"}}`); st != 200 || a.core.n() != antes+1 {
			t.Errorf("uMeta com method (paridade): %d %s, core %d", st, resp, a.core.n()-antes)
		}
	})

	t.Run("entrar como só consulta", func(t *testing.T) {
		antes := a.core.n()
		if st, resp := pedir(a.tokens["impersonado"], corpo("conta-1", "/act_999/insights")); st != 200 {
			t.Fatalf("GET impersonado: %d %s", st, resp)
		}
		if a.core.n() != antes+1 {
			t.Fatalf("GET impersonado: core chamado %d vezes, esperava 1", a.core.n()-antes)
		}
		antes = a.core.n()
		for _, b := range []string{
			`{"accountId":"conta-1","path":"/act_999/campaigns","method":"POST"}`,
			`{"accountId":"conta-1","path":"/9001","method":"delete"}`,
			`{"accountId":"conta-1","path":"/act_999/adimages","imageFromUrl":"https://midia.exemplo/x.jpg"}`,
			`{"accountId":"conta-1","path":"/act_999/advideos","videoFromUrl":"https://midia.exemplo/v.mp4"}`,
		} {
			st, resp := pedir(a.tokens["impersonado"], b)
			if st != 403 || !strings.Contains(resp, `"sem_permissao"`) || !strings.Contains(resp, "Quem entrou como outra pessoa") {
				t.Errorf("%s: %d %s", b, st, resp)
			}
		}
		if a.core.n() != antes {
			t.Fatalf("a sessão de entrar como escreveu na Meta (%d pedidos ao core)", a.core.n()-antes)
		}
	})
}

func TestAoVivoEscopoDeContas(t *testing.T) {
	a := montarMeta(t, graphOK(`{"data":[]}`))
	rotas := []struct{ rota, corpo, naoAcha string }{
		{"/insights-ao-vivo", `{"account_id":"%s","since":"2026-01-01","until":"2026-01-31"}`, `{"meta_erro":"conta não encontrada"}`},
		{"/serie-novos-dia", `{"account_id":"%s","dias":[{"since":"1767225600","until":"1767312000","label":"01/01"}]}`, `{"erro":"conta não encontrada"}`},
		{"/contar-collabs", `{"account_id":"%s","since":"1767225600","until":"1769904000"}`, `{"erro":"conta não encontrada"}`},
	}
	for _, c := range rotas {
		antes := a.core.n()
		w := a.post(c.rota, a.tokens[uRestrito], strings.Replace(c.corpo, "%s", "conta-3", 1))
		if w.Code != 404 || strings.TrimSpace(w.Body.String()) != c.naoAcha {
			t.Errorf("%s conta-3: %d %s", c.rota, w.Code, w.Body)
		}
		if a.core.n() != antes {
			t.Errorf("%s conta-3: o core recebeu pedido de conta invisível", c.rota)
		}
		if w := a.post(c.rota, a.tokens[uRestrito], strings.Replace(c.corpo, "%s", "conta-1", 1)); w.Code != 200 {
			t.Errorf("%s conta-1: %d %s", c.rota, w.Code, w.Body)
		}
	}
}

// Rota montada fora de autz.ComEscopo = falha fechada, com aviso no log: nunca "sem escopo = todas".
func TestMetaSemEscopoNega(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	a := montarMeta(t, graphOK(`{"data":[]}`))
	r := chi.NewRouter() // as mesmas rotas, SEM autz.ComEscopo
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(a.p, auth.NovoStore(a.p)))
		r.Post("/meta-proxy", (&Proxy{Pool: a.p, Core: a.cli}).ServeHTTP)
		av := &AoVivo{Pool: a.p, Core: a.cli}
		r.Post("/insights-ao-vivo", av.Insights)
		r.Post("/serie-novos-dia", av.SerieNovosDia)
		r.Post("/contar-collabs", av.ContarCollabs)
	})
	a.h = r
	tok := a.tokens[uMeta]
	for _, c := range []struct {
		rota, corpo string
		quer        int
	}{
		{"/meta-proxy", `{"accountId":"conta-1","path":"/act_999/insights"}`, http.StatusBadRequest},
		{"/insights-ao-vivo", `{"account_id":"conta-1"}`, http.StatusNotFound},
		{"/serie-novos-dia", `{"account_id":"conta-1","dias":[{"since":"1","until":"2","label":"x"}]}`, http.StatusNotFound},
		{"/contar-collabs", `{"account_id":"conta-1","since":"1","until":"2"}`, http.StatusNotFound},
	} {
		if w := a.post(c.rota, tok, c.corpo); w.Code != c.quer {
			t.Errorf("%s sem escopo: %d %s, esperava %d", c.rota, w.Code, w.Body, c.quer)
		}
	}
	if a.core.n() != 0 {
		t.Fatalf("sem escopo o core recebeu %d pedidos", a.core.n())
	}
	if !strings.Contains(log.String(), "rota sem autz.ComEscopo") {
		t.Fatalf("faltou o aviso no log: %s", log.String())
	}
}
