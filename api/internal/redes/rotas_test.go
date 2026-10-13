package redes

import (
	"bytes"
	"log/slog"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// escritas: um pedido VÁLIDO por rota de escrita de Montar. Rota de escrita nova sem entrada aqui faz as
// varreduras falharem.
var escritas = map[string]struct{ caminho, corpo string }{
	"PATCH /redes/contas/{id}":                    {"/redes/contas/" + A1, `{"persona":"x"}`},
	"PUT /redes/metas":                            {"/redes/metas", `{"metas":[{"account_id":"` + A1 + `","periodo":"1","indicador":"seguidores","valor":1}]}`},
	"PUT /redes/filtros-de-campanha/{account_id}": {"/redes/filtros-de-campanha/" + A1, `{"selected_ids":["9001"]}`},
}

// varrer chama f para cada rota de Montar, com o caminho preenchido e o corpo de `escritas`.
func varrer(t *testing.T, m *mundoteste.Mundo, f func(metodo, rota, caminho, corpo string)) (leituras, gravacoes int) {
	t.Helper()
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet {
			leituras++
			f(metodo, rota, rota, "")
			return nil
		}
		gravacoes++
		e, ok := escritas[metodo+" "+rota]
		if !ok {
			t.Errorf("escrita sem caso nas varreduras: %s %s", metodo, rota)
			return nil
		}
		f(metodo, rota, e.caminho, e.corpo)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return leituras, gravacoes
}

// A2 nunca aparece para quem não a vê — em NENHUMA leitura de Montar, sem filtro, filtrando por A2 ou
// contando; o impersonado vê o que o ALVO (soA1) vê, não o que o super veria. /redes/contas é a exceção
// declarada (a tabela não tem a restritiva em produção: Ruling 5.6-3). Toda leitura projeta account_id
// (Ruling 5.6-10), por isso o uuid de A2 na resposta é vazamento.
func TestNadaVazaEntreContas(t *testing.T) {
	m := novoMundo(t, Montar)
	l, g := varrer(t, m, func(metodo, rota, _, _ string) {
		if metodo != http.MethodGet || rota == "/redes/contas" {
			return
		}
		for _, quem := range []string{"soA1", "emailA1", "horaA1", "impersonado", "nenhuma"} {
			for _, q := range []string{"", "?account_id=" + A2, "?account_id=" + A2 + "&contar=1&limite=1"} {
				w := m.Resposta(t, quem, "GET", rota+q, "")
				if w.Code != http.StatusOK || strings.Contains(w.Body.String(), A2) {
					t.Errorf("%s GET %s%s = %d %s", quem, rota, q, w.Code, w.Body)
				}
				if strings.Contains(q, "contar=1") && w.Header().Get("X-Total-Count") != "0" {
					t.Errorf("%s contou linhas de A2 em %s: %q", quem, rota, w.Header().Get("X-Total-Count"))
				}
			}
		}
		if _, b := m.Pedir(t, "nenhuma", "GET", rota, ""); strings.Contains(b, A1) {
			t.Errorf("lista vazia viu A1 em %s: %s", rota, b)
		}
		if _, b := m.Pedir(t, "adminA1", "GET", rota, ""); !strings.Contains(b, A2) {
			t.Errorf("adminA1 não viu A2 em %s (a rota projeta account_id?): %s", rota, b)
		}
	})
	if l != 15 || g != 3 {
		t.Errorf("rotas = %d leituras e %d escritas, esperava 15 e 3", l, g)
	}
}

// Toda escrita recusa a sessão de "entrar como", sem tocar no banco (Ruling 5.6-6).
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.Um(t, fotoDasRedes)
	_, n := varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet {
			return
		}
		if st, b := m.Pedir(t, "impersonado", metodo, caminho, corpo); st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, b)
		}
	})
	if n != 3 {
		t.Errorf("escritas = %d, esperava 3 (rota nova? ponha soSessaoPropria e um caso em `escritas`)", n)
	}
	if m.Um(t, fotoDasRedes) != antes {
		t.Error("o impersonado mudou o banco")
	}
}

// O token da Meta e a chave de publicação automática nunca saem (Ruling 5.6-8): nem em resposta de
// nenhuma rota — de quem pode tudo, com corpo válido, quebrado ou trazendo a chave — nem no log.
func TestSegredoDaContaNuncaSai(t *testing.T) {
	m := novoMundo(t, Montar)
	var log bytes.Buffer
	anterior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	defer slog.SetDefault(anterior)
	for _, quem := range []string{"adminA1", "todas", "impersonado"} {
		varrer(t, m, func(metodo, rota, caminho, corpo string) {
			for _, c := range []string{corpo, `{"lixo":`, `{"access_token":"x"}`} {
				_, b := m.Pedir(t, quem, metodo, caminho, c)
				if strings.Contains(b, "SEGREDO") || strings.Contains(b, `"access_token":`) || strings.Contains(b, `"publicacao_automatica":`) {
					t.Errorf("%s %s %s devolveu segredo: %s", quem, metodo, rota, b)
				}
			}
		})
	}
	if strings.Contains(log.String(), "SEGREDO") {
		t.Errorf("segredo no log:\n%s", log.String())
	}
	if v := m.Um(t, `select string_agg(access_token, ',' order by name)::text from accounts`); v != "SEGREDO-token-A2,SEGREDO-token-A1" {
		t.Errorf("os tokens mudaram: %s", v)
	}
}
