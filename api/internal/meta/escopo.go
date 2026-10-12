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
