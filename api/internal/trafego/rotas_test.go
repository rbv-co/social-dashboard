package trafego

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// escritas: um pedido VÁLIDO (para quem não entrou como outra pessoa) por rota de escrita de Montar. Rota
// de escrita nova sem entrada aqui faz as varreduras falharem.
var escritas = map[string]struct{ caminho, corpo string }{
	"POST /gestao-trafego/decisoes":               {"/gestao-trafego/decisoes", `{"campaign_id":"9001","account_id":"` + A1 + `","veredito":"escalar","decisao":"aprovada"}`},
	"POST /gestao-trafego/rascunhos":              {"/gestao-trafego/rascunhos", `{"account_id":"` + A1 + `","estado":{},"nome":"x"}`},
	"PATCH /gestao-trafego/rascunhos/{id}":        {"/gestao-trafego/rascunhos/" + R2, `{"nome":"y"}`},
	"DELETE /gestao-trafego/rascunhos/{id}":       {"/gestao-trafego/rascunhos/" + R2, ``},
	"PUT /gestao-trafego/config-metricas/{balde}": {"/gestao-trafego/config-metricas/engajamento", `{"metricas":["cpm"]}`},
	"PUT /gestao-trafego/objetivos/{alvo_id}":     {"/gestao-trafego/objetivos/9001", `{"nivel":"campanha","interacao":"curtidas","conta_id":"` + A1 + `"}`},
	"DELETE /gestao-trafego/objetivos/{alvo_id}":  {"/gestao-trafego/objetivos/9001", ``},
	"PUT /gestao-trafego/regua":                   {"/gestao-trafego/regua", `{"pesos":{},"limiares":{},"limiares_resultado":{},"conta_id":"` + A1 + `","metas":{}}`},
}

// semRestritiva: as ÚNICAS leituras fora da varredura de vazamento — as de tabelas sem pode_ver_conta em
// produção, que mostram a conta de A2 a toda sessão, como hoje (Ruling 5.7-3, achado 3 do plano). A régua
// devolve as metas de TODAS as contas (metas_por_conta) e os objetivos, o conta_id de cada campanha; fechar
// isso é policy em produção (o catálogo recompilado leva à API sem código). Toda outra leitura — inclusive
// rascunhos, as duas análises, as decisões e os interesses — entra na varredura.
var semRestritiva = map[string]string{
	"/gestao-trafego/config-metricas": "gt_cfg_read é `true` e a tabela não tem conta (Ruling 5.7-3)",
	"/gestao-trafego/objetivos":       "gt_objetivo_interacao_leitura é `true` (Ruling 5.7-3, achado 3)",
	"/gestao-trafego/regua":           "gt_ponderada_config_leitura é `true`: metas de todas as contas legíveis, como em produção (Ruling 5.7-3, achado 3)",
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

// A2 nunca aparece para quem não a vê — em NENHUMA leitura com a restritiva, sem filtro, filtrando por A2
// ou contando; o impersonado vê o que o ALVO (gestorA1) vê. Toda leitura dessas projeta account_id
// (Ruling 5.7-4), por isso o uuid de A2 na resposta é vazamento. As exceções são `semRestritiva`.
func TestNadaVazaEntreContas(t *testing.T) {
	m := novoMundo(t, Montar)
	varridas := map[string]bool{}
	l, g := varrer(t, m, func(metodo, rota, _, _ string) {
		if _, excecao := semRestritiva[rota]; metodo != http.MethodGet || excecao {
			return
		}
		varridas[rota] = true
		for _, quem := range []string{"gestorA1", "impersonado", "gestorNenhuma"} {
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
		if _, b := m.Pedir(t, "gestorNenhuma", "GET", rota, ""); strings.Contains(b, A1) {
			t.Errorf("lista vazia viu A1 em %s: %s", rota, b)
		}
		if _, b := m.Pedir(t, "adminA1", "GET", rota, ""); !strings.Contains(b, A2) {
			t.Errorf("adminA1 não viu A2 em %s (a rota projeta account_id?): %s", rota, b)
		}
	})
	// as 8 leituras = as 5 varridas + as 3 exceções; as varridas são EXATAMENTE estas (rota nova de leitura
	// sem restritiva só entra em `semRestritiva` com o motivo, nunca some da varredura sem ninguém ver)
	for _, rota := range []string{"/gestao-trafego/analises-de-orcamento", "/gestao-trafego/analises-de-anuncio",
		"/gestao-trafego/decisoes", "/gestao-trafego/rascunhos", "/gestao-trafego/interesses-sugeridos"} {
		if !varridas[rota] {
			t.Errorf("a leitura %s ficou fora da varredura de vazamento", rota)
		}
	}
	if l != 8 || g != 8 || len(varridas) != 5 || len(varridas)+len(semRestritiva) != l {
		t.Errorf("rotas = %d leituras (%d varridas, %d exceções) e %d escritas, esperava 8 (5 + 3) e 8", l, len(varridas), len(semRestritiva), g)
	}
}

// Toda escrita recusa a sessão de "entrar como", sem tocar no banco.
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.Um(t, fotoDoTrafego)
	_, n := varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet {
			return
		}
		if st, b := m.Pedir(t, "impersonado", metodo, caminho, corpo); st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, b)
		}
	})
	if n != 8 {
		t.Errorf("escritas = %d, esperava 8 (rota nova? ponha soSessaoPropria e um caso em `escritas`)", n)
	}
	if m.Um(t, fotoDoTrafego) != antes {
		t.Error("o impersonado mudou o banco")
	}
}
