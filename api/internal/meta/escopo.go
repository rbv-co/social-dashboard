package meta

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"unicode"

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
// ponytail: o VALOR de fields/filtering (expansão aninhada) é olhado por paramAlcancaOutraConta, que é
// lista de negação; trocar por lista de permissão de campos se aparecer aresta nova.
func temParam(params map[string]any, nomes ...string) bool {
	for k := range params {
		// Normaliza a chave: o core tira o "[]" ao montar a query (bling.Query) e a Graph pode aparar
		// espaços e sufixos, então "method[]", "Method[0]", " method", "method.x" e "method\u0000x"
		// chegam à Graph como `method`: corta no primeiro caractere fora de [A-Za-z0-9_].
		k = strings.TrimLeftFunc(k, unicode.IsSpace)
		if i := strings.IndexFunc(k, foraDeToken); i >= 0 {
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

func foraDeToken(r rune) bool {
	return !(r == '_' || r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9')
}

// arestasDeOutraConta: arestas da Graph que, expandidas dentro de um valor de params, saem da conta do
// pedido (o BM dono, as contas irmãs, as agências). Além destas, qualquer token terminado em "_accounts".
var arestasDeOutraConta = map[string]bool{
	"business": true, "businesses": true, "owner": true, "owner_business": true, "agencies": true, "adaccounts": true,
}

// paramAlcancaOutraConta: o valor de algum param (fields, filtering, ...) nomeia uma aresta que alcança
// outras contas. A âncora prende só o `path`; a Graph expande arestas aninhadas (`fields=business{owned_ad_accounts{...}}`)
// com o token único do core, que alcança TODAS as contas do BM. Vale só para quem não vê todas as contas.
// Não-string entra pelo JSON. Tokens são sequências de [A-Za-z0-9_] em minúsculas, então
// `instagram_business_account`, `funding_source_details` e `insights` seguem passando.
// ponytail: lista de negação de arestas que alcançam outras contas; trocar por lista de permissão de
// campos se aparecer aresta nova.
func paramAlcancaOutraConta(params map[string]any) bool {
	for _, v := range params {
		texto, ok := v.(string)
		if !ok {
			b, _ := json.Marshal(v)
			texto = string(b)
		}
		for _, t := range strings.FieldsFunc(strings.ToLower(texto), foraDeToken) {
			if arestasDeOutraConta[t] || strings.HasSuffix(t, "_accounts") {
				return true
			}
		}
	}
	return false
}
