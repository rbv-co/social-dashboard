package conteudo

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// escritas: um pedido VÁLIDO para conteudistaA1 por rota de escrita de Montar (TestEscritasValemParaQuemPode
// prova). Rota de escrita nova sem entrada aqui faz as varreduras falharem.
var escritas = map[string]struct{ caminho, corpo string }{
	"POST /conteudo/pecas":              {"/conteudo/pecas", `{"account_id":"` + A1 + `","titulo":"x","formato":"feed"}`},
	"PATCH /conteudo/pecas/{id}":        {"/conteudo/pecas/" + P1, `{"titulo":"y"}`},
	"DELETE /conteudo/pecas/{id}":       {"/conteudo/pecas/" + P7, ``},
	"POST /conteudo/arquivos":           {"/conteudo/arquivos", `{"peca_id":"` + P1 + `","ordem":3,"caminho":"` + A1 + `/` + P1 + `/3-x.png","tipo":"imagem"}`},
	"PATCH /conteudo/arquivos/{id}":     {"/conteudo/arquivos/" + AR1, `{"ordem":4}`},
	"DELETE /conteudo/arquivos/{id}":    {"/conteudo/arquivos/" + AR2, ``},
	"POST /conteudo/eventos":            {"/conteudo/eventos", `{"peca_id":"` + P1 + `","acao":"criou"}`},
	"POST /conteudo/ideias":             {"/conteudo/ideias", `{"account_id":"` + A1 + `","titulo":"x"}`},
	"PATCH /conteudo/ideias/{id}":       {"/conteudo/ideias/" + I1, `{"situacao":"favorita"}`},
	"POST /conteudo/blocos":             {"/conteudo/blocos", `{"account_id":"` + A1 + `","tipo":"legenda","nome":"x","texto":"y"}`},
	"PATCH /conteudo/blocos/{id}":       {"/conteudo/blocos/" + B1, `{"ativo":false}`},
	"POST /conteudo/concorrentes":       {"/conteudo/concorrentes", `{"account_id":"` + A1 + `","handle":"novo"}`},
	"PATCH /conteudo/concorrentes/{id}": {"/conteudo/concorrentes/" + K1, `{"ativo":false}`},
	"POST /conteudo-trigger":            {"/conteudo-trigger", `{"account_id":"` + A1 + `","quantas":3}`},
}

// semRestritiva: a ÚNICA leitura fora da varredura de vazamento — conteudo_concorrentes não tem pode_ver_conta
// em produção (Ruling 5.9-5, achado 5): todo conteudista lê os de toda marca, como hoje.
var semRestritiva = map[string]string{
	"/conteudo/concorrentes": "conteudo_concorrentes não está em 2026-07-31-allowed-accounts-no-banco.sql (Ruling 5.9-5)",
}

func mundoMontado(t *testing.T) *mundoteste.Mundo {
	t.Helper()
	return novoMundo(t, Montar, montarRPCs)
}

// varrer chama f para cada rota de Montar (o /rpc/{nome} de montarRPCs fica de fora: as RPCs têm a varredura
// própria), com o caminho preenchido e o corpo de `escritas`.
func varrer(t *testing.T, m *mundoteste.Mundo, f func(metodo, rota, caminho, corpo string)) (leituras, gravacoes int) {
	t.Helper()
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		switch {
		case rota == "/rpc/{nome}":
		case metodo == http.MethodGet:
			leituras++
			f(metodo, rota, rota, "")
		default:
			gravacoes++
			e, ok := escritas[metodo+" "+rota]
			if !ok {
				t.Errorf("escrita sem caso nas varreduras: %s %s", metodo, rota)
				return nil
			}
			f(metodo, rota, e.caminho, e.corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return leituras, gravacoes
}

// A2 nunca aparece para quem não a vê — em NENHUMA leitura com a restritiva (as filhas pela peça), sem filtro,
// filtrando por A2 ou contando; o impersonado vê o que o ALVO (conteudistaA1) vê. Toda leitura dessas projeta
// account_id (a da peça, nas filhas), por isso o uuid de A2 na resposta é vazamento. As filhas (arquivos e
// eventos) ainda são varridas pelo caminho do JOIN: ?account_id=<A2> e a contagem passam pela peça.
func TestNadaVazaEntreContas(t *testing.T) {
	m := mundoMontado(t)
	varridas := map[string]bool{}
	l, g := varrer(t, m, func(metodo, rota, _, _ string) {
		if _, excecao := semRestritiva[rota]; metodo != http.MethodGet || excecao {
			return
		}
		varridas[rota] = true
		for _, quem := range []string{"conteudistaA1", "impersonado", "conteudistaNenhuma"} {
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
		if _, b := m.Pedir(t, "conteudistaNenhuma", "GET", rota, ""); strings.Contains(b, A1) {
			t.Errorf("lista vazia viu A1 em %s: %s", rota, b)
		}
		if _, b := m.Pedir(t, "adminA1", "GET", rota, ""); !strings.Contains(b, A2) {
			t.Errorf("adminA1 não viu A2 em %s (a rota projeta account_id?): %s", rota, b)
		}
	})
	for _, rota := range []string{"/conteudo/pecas", "/conteudo/arquivos", "/conteudo/eventos", "/conteudo/ideias",
		"/conteudo/blocos", "/conteudo/jobs"} {
		if !varridas[rota] {
			t.Errorf("a leitura %s ficou fora da varredura de vazamento", rota)
		}
	}
	if l != 7 || g != 14 || len(varridas) != 6 || len(varridas)+len(semRestritiva) != l {
		t.Errorf("rotas = %d leituras (%d varridas, %d exceções) e %d escritas, esperava 7 (6 + 1) e 14", l, len(varridas), len(semRestritiva), g)
	}
}

// corposDasRPCs: um corpo VÁLIDO por RPC (o portão e o "entrar como" vêm antes do corpo; o válido garante que,
// sem o SoSessaoPropria, a função passaria e gravaria).
var corposDasRPCs = map[string]string{
	"conteudo_aprovar_e_agendar": `{"p_peca":"` + P2 + `"}`,
	"conteudo_casar_na_mao":      `{"p_peca":"` + P1 + `","p_media":"https://www.instagram.com/p/ABC123/"}`,
	"conteudo_decidir":           `{"p_peca":"` + P2 + `","p_decisao":"aprovada"}`,
	"conteudo_decidir_casamento": `{"p_casamento":"` + CS1 + `","p_confirma":true}`,
	"conteudo_ideia_virar_peca":  `{"p_ideia":"` + I1 + `","p_account":"` + A1 + `"}`,
	"conteudo_reavisar":          `{"p_peca":"` + P4 + `"}`,
}

// Toda escrita — as 13 de catálogo, o /conteudo-trigger e as 6 RPCs — recusa a sessão de "entrar como", sem
// tocar no banco. As RPCs são pedidas pelo impersonado cujo ALVO é aprovador (passa em Aprovador e em
// Conteudista): o que recusa é o SoSessaoPropria, não o portão. E com o alvo SEM o portão das decisões
// (conteudistaA1) o 403 é o do portão, também sem efeito.
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := mundoMontado(t)
	antes := m.Um(t, fotoDoConteudo)
	_, n := varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet {
			return
		}
		if st, b := m.Pedir(t, "impersonado", metodo, caminho, corpo); st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, b)
		}
	})
	if n != 14 {
		t.Errorf("escritas = %d, esperava 14 (rota nova? ponha soSessaoPropria e um caso em `escritas`)", n)
	}
	if len(FuncoesRPC) != 6 || len(corposDasRPCs) != 6 {
		t.Errorf("RPCs = %d (corpos %d), esperava 6", len(FuncoesRPC), len(corposDasRPCs))
	}
	for _, f := range FuncoesRPC {
		corpo, ok := corposDasRPCs[f.Nome]
		if !ok {
			t.Errorf("RPC %s sem corpo em corposDasRPCs", f.Nome)
		}
		if !f.SoSessaoPropria {
			t.Errorf("RPC %s sem SoSessaoPropria", f.Nome)
		}
		if st, b := m.Pedir(t, "impersonadoAprovador", "POST", "/rpc/"+f.Nome, corpo); st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
			t.Errorf("RPC %s como impersonado (alvo aprovador) = %d %s", f.Nome, st, b)
		}
		if st, b := m.Pedir(t, "impersonado", "POST", "/rpc/"+f.Nome, corpo); st != http.StatusForbidden {
			t.Errorf("RPC %s como impersonado (alvo conteudista) = %d %s", f.Nome, st, b)
		}
	}
	if m.Um(t, fotoDoConteudo) != antes {
		t.Error("o impersonado mudou o banco")
	}
}

// Os corpos de `escritas` valem: quem pode (conteudistaA1, na conta dele) recebe 2xx em cada rota. Sem isto as
// varreduras acima poderiam passar com pedidos que nem chegariam a gravar. E os corpos das RPCs valem: o
// aprovador de A1 recebe 2xx em cada uma (senão o teste do impersonado passaria por corpo inválido).
func TestEscritasValemParaQuemPode(t *testing.T) {
	m := mundoMontado(t)
	varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet {
			return
		}
		if st, b := m.Pedir(t, "conteudistaA1", metodo, caminho, corpo); st < 200 || st > 299 {
			t.Errorf("%s %s como conteudistaA1 = %d %s", metodo, rota, st, b)
		}
	})
	for nome, corpo := range corposDasRPCs {
		m := mundoMontado(t) // um mundo por RPC: decidir_casamento publica a P4 (reavisar) e decidir aprova a P2
		if st, b := m.Pedir(t, "aprovadorA1", "POST", "/rpc/"+nome, corpo); st < 200 || st > 299 {
			t.Errorf("RPC %s como aprovadorA1 = %d %s", nome, st, b)
		}
	}
}
