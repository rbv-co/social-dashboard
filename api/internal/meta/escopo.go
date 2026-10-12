package meta

import (
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// contaVisivel: a conta do pedido passa na MESMA regra das tabelas dela (pode_ver_conta; Ruling 34 do
// mestre, estendido às rotas ao vivo pelo 5.6-4). Sem escopo no contexto (rota montada fora de
// autz.ComEscopo) nega e avisa: falha fechada.
func contaVisivel(r *http.Request, conta string) bool {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		slog.Error("meta: rota sem autz.ComEscopo; conta recusada", "rota", r.URL.Path)
		return false
	}
	return autz.PodeVerConta(e, conta)
}

// reCaminhoAncorado: o caminho que quem tem lista de contas pode pedir — /act_<n>, /<n> ou /search,
// seguido só de nomes de aresta. Sem versão, "..", "%", "?", vírgula, maiúscula ou id depois da raiz.
var reCaminhoAncorado = regexp.MustCompile(`^/?(act_[0-9]+|[0-9]+|search)(/[a-z_]+)*/?$`)

// caminhoDaConta (Ruling 5.6-5): o token do core é um só e alcança TODAS as contas; sem âncora, um
// accountId permitido com o caminho de outra conta lia a outra. Vale só para quem não vê todas as contas.
// ponytail: objeto solto (/<campanha>, /<anúncio>, /me/…) é negado a quem tem lista; olhar
// campaigns/ads/campaign_adsets da conta quando alguém com lista precisar editar campanha pelo Gestor.
func caminhoDaConta(caminho, adAccount, instagram string) bool {
	m := reCaminhoAncorado.FindStringSubmatch(caminho)
	if m == nil {
		return false
	}
	switch raiz := m[1]; {
	case raiz == "search":
		return true // busca de segmentação: não lê dado de conta
	case strings.HasPrefix(raiz, "act_"):
		return adAccount != "" && strings.TrimPrefix(raiz, "act_") == strings.TrimPrefix(adAccount, "act_")
	default:
		return instagram != "" && raiz == instagram
	}
}

// temParam: o corpo traz algum destes nomes em params (chave normalizada, sem diferenciar maiúscula, qualquer valor).
// "method" é o override da Graph (GET com method=delete apaga): conta como escrita, então a sessão de
// "entrar como" não passa. "ids" e "batch" escolhem OUTROS objetos fora do caminho ancorado.
// ponytail: `fields=` com expansão aninhada (ex.: business_discovery) ainda alcança só dado público de
// outro perfil; olhar o valor de fields se isso virar problema.
func temParam(params map[string]any, nomes ...string) bool {
	for k := range params {
		// Normaliza a chave: o core tira o "[]" ao montar a query (bling.Query) e a Graph pode aparar
		// espaços, então "method[]", "Method[0]" e " method" chegam à Graph como `method`.
		k = strings.TrimSpace(k)
		if i := strings.IndexByte(k, '['); i >= 0 {
			k = k[:i]
		}
		for _, n := range nomes {
			if strings.EqualFold(k, n) {
				return true
			}
		}
	}
	return false
}
