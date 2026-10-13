package fabrica

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/github"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const segredoPAT = "SEGREDO-pat"

// ghFalso: o GitHub de mentira. Conta os pedidos, guarda o último corpo e, em CADA pedido, lê pela pool o
// status do job do corpo: o job tem de estar visível (comitado) quando o despacho acontece.
type ghFalso struct {
	*httptest.Server
	mu       sync.Mutex
	pedidos  int
	corpo    string
	visivel  []string // status do job no momento de cada pedido
	pool     *pgxpool.Pool
	resposta func(w http.ResponseWriter, r *http.Request, job string)
}

func novoGH(t *testing.T, resposta func(w http.ResponseWriter, r *http.Request, job string)) *ghFalso {
	t.Helper()
	f := &ghFalso{resposta: resposta}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var c struct {
			Inputs struct {
				JobID string `json:"job_id"`
			} `json:"inputs"`
		}
		_ = json.Unmarshal(b, &c)
		vis := "<sem pool>"
		if f.pool != nil {
			if err := f.pool.QueryRow(r.Context(), `select status from fabrica_jobs where id = $1::uuid`, c.Inputs.JobID).Scan(&vis); err != nil {
				vis = "<invisível>"
			}
		}
		f.mu.Lock()
		f.pedidos++
		f.corpo = string(b)
		f.visivel = append(f.visivel, vis)
		f.mu.Unlock()
		f.resposta(w, r, c.Inputs.JobID)
	}))
	t.Cleanup(f.Close)
	return f
}

func aceita(w http.ResponseWriter, _ *http.Request, _ string) { w.WriteHeader(http.StatusNoContent) }

func comStatus(st int) func(http.ResponseWriter, *http.Request, string) {
	return func(w http.ResponseWriter, _ *http.Request, _ string) {
		w.WriteHeader(st)
		fmt.Fprint(w, `{"message":"corpo do GitHub com SEGREDO-do-corpo"}`)
	}
}

func (f *ghFalso) n() int { f.mu.Lock(); defer f.mu.Unlock(); return f.pedidos }

// mundoDisparo: o mundo da fábrica com POST /fabrica-trigger atrás do portão (a montagem da Task 10).
func mundoDisparo(t *testing.T, f *ghFalso, gh *github.Cliente, lim *auth.Limitador) *mundoteste.Mundo {
	t.Helper()
	if gh == nil {
		gh = github.ParaTeste(t, segredoPAT, f.URL)
	}
	if lim == nil {
		lim = auth.NovoLimitador()
		lim.Max, lim.Janela = 30, time.Hour
	}
	return novoMundo(t, func(r chi.Router, p *pgxpool.Pool) {
		f.pool = p
		r.With(soFabricante, soSessaoPropria).Post("/fabrica-trigger", (&Disparador{Pool: p, GH: gh, Limite: lim}).ServeHTTP)
	})
}

func disparar(t *testing.T, m *mundoteste.Mundo, quem, corpo string) *httptest.ResponseRecorder {
	t.Helper()
	return m.Resposta(t, quem, "POST", "/fabrica-trigger", corpo)
}

func resposta(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("corpo %q: %v", w.Body.String(), err)
	}
	return v
}

func ultimoJob(t *testing.T, m *mundoteste.Mundo) string {
	t.Helper()
	return m.Um(t, `select id::text from fabrica_jobs order by created_at desc, id limit 1`)
}

func TestTrigger(t *testing.T) {
	t.Run("gerar sem rodada", func(t *testing.T) {
		f := novoGH(t, aceita)
		m := mundoDisparo(t, f, nil, nil)
		w := disparar(t, m, "fabricante", `{"tipo":"gerar","params":{"itens":[{"sku":"S1","deposito":"14888726315","pct":30}],"nome":"Rodada X","objetivo":"branding"}}`)
		if w.Code != 200 {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		v := resposta(t, w)
		job, camp := v["job_id"].(string), v["campanha_id"].(string)
		if job == "" || camp == "" {
			t.Fatalf("resposta %v", v)
		}
		if got := m.Um(t, `select nome||'|'||status||'|'||objetivo||'|'||criado_por::text||'|'||job_id::text from fabrica_campanhas where id=$1::uuid`, camp); got != "Rodada X|gerando|branding|"+idFabricante+"|"+job {
			t.Errorf("rodada = %s", got)
		}
		if got := m.Um(t, `select tipo||'|'||status||'|'||criado_por::text||'|'||(params->>'campanhaId')||'|'||(params->'itens'->0->>'sku')||'|'||(params->'itens'->0->>'pct') from fabrica_jobs where id=$1::uuid`, job); got != "gerar|enfileirado|"+idFabricante+"|"+camp+"|S1|30" {
			t.Errorf("job = %s", got)
		}
		if f.n() != 1 || f.corpo != `{"inputs":{"job_id":"`+job+`"},"ref":"main"}` {
			t.Errorf("GitHub: %d pedidos, corpo %s", f.n(), f.corpo)
		}
		if f.visivel[0] != "enfileirado" {
			t.Errorf("job no momento do despacho = %q: tem de estar comitado", f.visivel[0])
		}
	})

	t.Run("padrões, subir, preview e quem passa", func(t *testing.T) {
		f := novoGH(t, aceita)
		m := mundoDisparo(t, f, nil, nil)
		w := disparar(t, m, "fabricante", `{"tipo":"gerar"}`)
		if w.Code != 200 {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		camp := resposta(t, w)["campanha_id"].(string)
		if got := m.Um(t, `select nome||'|'||objetivo from fabrica_campanhas where id=$1::uuid`, camp); !strings.HasPrefix(got, "Rodada · 20") || !strings.HasSuffix(got, "|engajamento") {
			t.Errorf("padrões = %s", got)
		}
		if got := m.Um(t, `select (nome ~ '^Rodada · [0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}$')::text from fabrica_campanhas where id=$1::uuid`, camp); got != "true" {
			t.Errorf("formato do nome: %s", got)
		}
		if got := m.Um(t, `select params->>'objetivo' from fabrica_jobs where id=$1::uuid`, resposta(t, w)["job_id"].(string)); got != "engajamento" {
			t.Errorf("objetivo no job = %s", got)
		}
		antes := m.Um(t, `select count(*)::text from fabrica_campanhas`)
		w = disparar(t, m, "fabricante", `{"tipo":"subir","params":{"campanhaId":"`+C2+`","destino":{"tipo":"nova"}}}`)
		if w.Code != 200 || resposta(t, w)["campanha_id"] != C2 {
			t.Errorf("subir: %d %s", w.Code, w.Body)
		}
		if m.Um(t, `select count(*)::text from fabrica_campanhas`) != antes {
			t.Error("subir criou rodada")
		}
		w = disparar(t, m, "fabricante", `{"tipo":"preview","params":{}}`)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"campanha_id":null`) {
			t.Errorf("preview: %d %s", w.Code, w.Body)
		}
		for _, quem := range []string{"chaveEmLista", "super", "adminA1"} {
			if w := disparar(t, m, quem, `{"tipo":"ativar","params":{"campanhaId":"`+C2+`"}}`); w.Code != 200 {
				t.Errorf("%s: %d %s", quem, w.Code, w.Body)
			}
		}
	})

	grande := `{"tipo":"gerar","params":{"x":"` + strings.Repeat("a", 65<<10) + `"}}`
	negados := []struct {
		nome, quem, corpo string
		st                int
		tem               string
	}{
		{"leitor", "leitor", `{"tipo":"preview"}`, 403, "sem_permissao"},
		{"semModulo", "semModulo", `{"tipo":"preview"}`, 403, "sem_permissao"},
		{"roboSemFabrica", "roboSemFabrica", `{"tipo":"preview"}`, 403, "sem_permissao"},
		{"impersonado", "impersonado", `{"tipo":"preview"}`, 403, "Quem entrou como outra pessoa"},
		{"desativado", "desativado", `{"tipo":"preview"}`, 401, ""},
		{"sem sessão", "", `{"tipo":"preview"}`, 401, ""},
		{"excluir", "fabricante", `{"tipo":"excluir","params":{}}`, 400, "tipo_invalido"},
		{"tipo x", "fabricante", `{"tipo":"x"}`, 400, "tipo_invalido"},
		{"sem tipo", "fabricante", `{}`, 400, "tipo_invalido"},
		{"params lista", "fabricante", `{"tipo":"gerar","params":[]}`, 400, "pedido_invalido"},
		{"params número", "fabricante", `{"tipo":"gerar","params":1}`, 400, "pedido_invalido"},
		{"campanhaId abc", "fabricante", `{"tipo":"subir","params":{"campanhaId":"abc"}}`, 400, "campanhaId"},
		{"campanhaId número", "fabricante", `{"tipo":"subir","params":{"campanhaId":5}}`, 400, "campanhaId"},
		{"nome grande", "fabricante", `{"tipo":"gerar","params":{"nome":"` + strings.Repeat("n", 201) + `"}}`, 400, "nome"},
		{"objetivo grande", "fabricante", `{"tipo":"gerar","params":{"objetivo":"` + strings.Repeat("o", 41) + `"}}`, 400, "objetivo"},
		{"params 65 KiB", "fabricante", grande, 400, "64 KiB"},
		{"campo desconhecido", "fabricante", `{"tipo":"preview","extra":1}`, 400, "corpo_invalido"},
	}
	for _, c := range negados {
		t.Run("negado: "+c.nome, func(t *testing.T) {
			f := novoGH(t, aceita)
			m := mundoDisparo(t, f, nil, nil)
			antes := m.Um(t, fotoDaFabrica)
			w := disparar(t, m, c.quem, c.corpo)
			if w.Code != c.st || !strings.Contains(w.Body.String(), c.tem) {
				t.Errorf("%d %s, esperava %d com %q", w.Code, w.Body, c.st, c.tem)
			}
			if f.n() != 0 {
				t.Errorf("o GitHub recebeu %d pedido(s)", f.n())
			}
			if m.Um(t, fotoDaFabrica) != antes {
				t.Error("o banco mudou")
			}
		})
	}

	t.Run("negado: GITHUB_PAT vazio grava nada", func(t *testing.T) {
		f := novoGH(t, aceita)
		m := mundoDisparo(t, f, github.Novo(""), nil)
		antes := m.Um(t, fotoDaFabrica)
		w := disparar(t, m, "fabricante", `{"tipo":"gerar","params":{}}`)
		if w.Code != 503 || !strings.Contains(w.Body.String(), "github_nao_configurado") {
			t.Errorf("%d %s", w.Code, w.Body)
		}
		if f.n() != 0 || m.Um(t, fotoDaFabrica) != antes {
			t.Error("gravou ou despachou sem token")
		}
	})

	t.Run("limite por pessoa", func(t *testing.T) {
		f := novoGH(t, aceita)
		lim := auth.NovoLimitador()
		lim.Max, lim.Janela = 2, time.Hour
		m := mundoDisparo(t, f, nil, lim)
		for i := 1; i <= 2; i++ {
			if w := disparar(t, m, "fabricante", `{"tipo":"preview"}`); w.Code != 200 {
				t.Fatalf("disparo %d: %d %s", i, w.Code, w.Body)
			}
		}
		antes := m.Um(t, fotoDaFabrica)
		w := disparar(t, m, "fabricante", `{"tipo":"preview"}`)
		if w.Code != 429 || !strings.Contains(w.Body.String(), "muitas_tentativas") || w.Header().Get("Retry-After") != "3600" {
			t.Errorf("3º: %d %s Retry-After=%q", w.Code, w.Body, w.Header().Get("Retry-After"))
		}
		if f.n() != 2 || m.Um(t, fotoDaFabrica) != antes {
			t.Errorf("o 429 despachou (%d pedidos) ou gravou", f.n())
		}
		if w := disparar(t, m, "adminA1", `{"tipo":"preview"}`); w.Code != 200 {
			t.Errorf("outra pessoa: %d %s", w.Code, w.Body)
		}
		if w := disparar(t, m, "fabricante", `{"tipo":"excluir"}`); w.Code != 400 {
			t.Errorf("pedido inválido não gasta limite nem some: %d", w.Code)
		}
	})
}

func TestTriggerFalhasDoGitHub(t *testing.T) {
	gerar := `{"tipo":"gerar","params":{"nome":"R","itens":[]}}`
	casos := []struct {
		nome   string
		resp   func(http.ResponseWriter, *http.Request, string)
		st     int
		codigo string
		tem    string // no detail
		erro   string // prefixo de fabrica_jobs.erro
		cab    string // Retry-After esperado
	}{
		{"403", comStatus(403), 502, "dispatch_falhou", "Actions", "dispatch_falhou github: sem_permissao (403)", ""},
		{"401", comStatus(401), 502, "dispatch_falhou", "GITHUB_PAT", "dispatch_falhou github: token_invalido (401)", ""},
		{"404", comStatus(404), 502, "dispatch_falhou", "fabrica.yml", "dispatch_falhou github: nao_encontrado (404)", ""},
		{"422", comStatus(422), 502, "dispatch_falhou", "recusou", "dispatch_falhou github: recusado (422)", ""},
		{"500", comStatus(500), 502, "dispatch_falhou", "fora do ar", "dispatch_falhou github: indisponivel (500)", ""},
		{"429", func(w http.ResponseWriter, _ *http.Request, _ string) {
			w.Header().Set("Retry-After", "60")
			w.WriteHeader(429)
			fmt.Fprint(w, `{"message":"SEGREDO-do-corpo"}`)
		}, 429, "muitas_tentativas", "esperar", "muitas_tentativas github: limite (429)", "60"},
		{"502 do gateway", comStatus(502), 504, "dispatch_incerto", "Actions", "dispatch_incerto github: incerto (502)", ""},
		{"504 do gateway", comStatus(504), 504, "dispatch_incerto", "Actions", "dispatch_incerto github: incerto (504)", ""},
		{"conexão fechada sem resposta", func(w http.ResponseWriter, _ *http.Request, _ string) {
			c, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				c.Close()
			}
		}, 504, "dispatch_incerto", "Actions", "dispatch_incerto github: incerto (0)", ""},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			f := novoGH(t, c.resp)
			m := mundoDisparo(t, f, nil, nil)
			w := disparar(t, m, "fabricante", gerar)
			v := resposta(t, w)
			if w.Code != c.st || v["error"] != c.codigo || !strings.Contains(fmt.Sprint(v["detail"]), c.tem) {
				t.Errorf("%d %s, esperava %d %s com %q", w.Code, w.Body, c.st, c.codigo, c.tem)
			}
			if w.Header().Get("Retry-After") != c.cab {
				t.Errorf("Retry-After = %q, esperava %q", w.Header().Get("Retry-After"), c.cab)
			}
			if f.n() != 1 {
				t.Errorf("pedidos ao GitHub = %d: nenhuma repetição automática", f.n())
			}
			job := ultimoJob(t, m)
			if got := m.Um(t, `select status||'|'||erro from fabrica_jobs where id=$1::uuid`, job); !strings.HasPrefix(got, "erro|"+c.erro) {
				t.Errorf("job = %s", got)
			}
			if got := m.Um(t, `select status from fabrica_campanhas where job_id=$1::uuid`, job); got != "erro" {
				t.Errorf("rodada = %s", got)
			}
			if strings.Contains(w.Body.String(), "SEGREDO") {
				t.Errorf("o corpo da resposta vazou: %s", w.Body)
			}
			if got := m.Um(t, `select count(*)::text from fabrica_jobs where criado_por=$1::uuid and created_at > now() - interval '1 minute'`, idFabricante); got != "1" {
				t.Errorf("jobs novos = %s: a falha não duplica nem apaga o job", got)
			}
		})
	}

	t.Run("subir com 500 não derruba a rodada pronta", func(t *testing.T) {
		f := novoGH(t, comStatus(500))
		m := mundoDisparo(t, f, nil, nil)
		w := disparar(t, m, "fabricante", `{"tipo":"subir","params":{"campanhaId":"`+C2+`","destino":{"tipo":"nova"}}}`)
		if w.Code != 502 {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		if got := m.Um(t, `select status from fabrica_campanhas where id=$1::uuid`, C2); got != "pronta" {
			t.Errorf("C2 = %s", got)
		}
		if got := m.Um(t, `select status from fabrica_jobs where id=$1::uuid`, ultimoJob(t, m)); got != "erro" {
			t.Errorf("job = %s", got)
		}
	})

	t.Run("a rodada que o pedido não criou fica como está, mesmo gerando", func(t *testing.T) {
		f := novoGH(t, comStatus(500))
		m := mundoDisparo(t, f, nil, nil)
		w := disparar(t, m, "fabricante", `{"tipo":"subir","params":{"campanhaId":"`+C1+`"}}`)
		if w.Code != 502 {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		if got := m.Um(t, `select status from fabrica_campanhas where id=$1::uuid`, C1); got != "gerando" {
			t.Errorf("C1 = %s: só a rodada criada por este pedido vira erro", got)
		}
	})

	t.Run("robô que já começou é a verdade", func(t *testing.T) {
		var f *ghFalso
		f = novoGH(t, func(w http.ResponseWriter, _ *http.Request, job string) {
			if _, err := f.pool.Exec(t.Context(), `update fabrica_jobs set status = 'rodando' where id = $1::uuid`, job); err != nil {
				t.Error(err)
			}
			w.WriteHeader(500)
		})
		m := mundoDisparo(t, f, nil, nil)
		w := disparar(t, m, "fabricante", `{"tipo":"gerar","params":{}}`)
		if w.Code != 502 {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		if got := m.Um(t, `select status||'|'||coalesce(erro,'') from fabrica_jobs where id=$1::uuid`, ultimoJob(t, m)); got != "rodando|" {
			t.Errorf("job = %s", got)
		}
	})

	t.Run("contexto do pedido cancelado no despacho: o erro é marcado mesmo assim", func(t *testing.T) {
		ctx, cancelar := context.WithCancel(context.Background())
		defer cancelar()
		f := novoGH(t, func(w http.ResponseWriter, _ *http.Request, _ string) {
			cancelar()
			time.Sleep(100 * time.Millisecond)
			w.WriteHeader(500)
		})
		m := mundoDisparo(t, f, nil, nil)
		r := httptest.NewRequest("POST", "/fabrica-trigger", strings.NewReader(`{"tipo":"gerar","params":{}}`)).WithContext(ctx)
		r.Header.Set("Authorization", "Bearer "+m.Tok["fabricante"])
		w := httptest.NewRecorder()
		m.H.ServeHTTP(w, r)
		if got := m.Um(t, `select status from fabrica_jobs where id=$1::uuid`, ultimoJob(t, m)); got != "erro" {
			t.Errorf("job = %s (resposta %d %s)", got, w.Code, w.Body)
		}
		if got := m.Um(t, `select status from fabrica_campanhas where job_id=$1::uuid`, ultimoJob(t, m)); got != "erro" {
			t.Errorf("rodada = %s", got)
		}
	})
}
