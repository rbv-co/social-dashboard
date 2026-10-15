package acesso

import (
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"net/mail"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	LimitePedirAcesso = 10
	JanelaPedirAcesso = time.Hour
	// TetoGlobalPedirAcesso (Ruling 5.1-17): pedidos por hora somando todos os IPs (aceitos e recusados).
	// O limite por IP não contém spam de muitos IPs (cada um com o seu).
	TetoGlobalPedirAcesso = 100
	// tetoCorpoPedido: 120 + 2000 caracteres escapados como \uXXXX (6 bytes cada) + e-mail cabem com folga;
	// acima disso é lixo, e a rota é pública (o teto geral de dados.LerCorpo é 1 MiB).
	tetoCorpoPedido = 32 << 10
)

// MontarPublicas: a ÚNICA rota pública do 5.1, montada FORA do grupo autenticado de web.Rotas. Defesas, nesta
// ordem: JSON obrigatório (415, ANTES dos limitadores: um <form> de outro site não gasta cota de ninguém),
// 10 por IP por hora e, depois do por IP (quem estoura o seu IP não gasta o teto dos outros), o teto global de
// 100 por hora; os dois limites em memória, por instância.
func MontarPublicas(r chi.Router, p *pgxpool.Pool) {
	r.With(soJSON, auth.LimitarPorIP(LimitePedirAcesso, JanelaPedirAcesso), auth.LimitarGlobal(TetoGlobalPedirAcesso, JanelaPedirAcesso)).
		Post("/pedir-acesso", pedirAcesso(p))
}

// soJSON: 415 sem ler o corpo se o Content-Type não for application/json. Rota anônima: um <form> de outro
// site posta com o navegador (e o IP) do visitante, mas sem preflight só manda text/plain, multipart ou
// urlencoded. Como roda antes dos limitadores, o <form> alheio não grava lixo NEM queima a cota por IP de quem
// é legítimo nem o teto global. (O argumento "Bearer, sem CSRF" de dados.LerCorpo vale para rota autenticada,
// não para esta.)
func soJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
			dados.Erro(w, http.StatusUnsupportedMediaType, "tipo_de_conteudo", "Envie o pedido como application/json.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// pedirAcesso: POST /pedir-acesso {name, email, message}, sem sessão (a tela de login). Grava só essas
// três colunas e status 'pending' — o insert anônimo de hoje aceitava qualquer coluna, inclusive status.
// Nome e e-mail são dado pessoal: nunca vão para log nem para a resposta. A resposta é a mesma para
// e-mail novo ou repetido: a rota não serve para descobrir quem já pediu. Em PRODUÇÃO há um índice único parcial
// (lower(email) onde status = 'pending'): o e-mail que já tem pedido pendente não grava outra linha, e o
// `on conflict do nothing` mantém o mesmo 201 {"id"} (id de mentira, que ninguém usa) em vez de um 409 que
// denunciaria quem já pediu.
func pedirAcesso(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, tetoCorpoPedido)
		var in struct {
			Name    string `json:"name"`
			Email   string `json:"email"`
			Message string `json:"message"`
		}
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		nome, email, msg := strings.TrimSpace(in.Name), strings.TrimSpace(in.Email), strings.TrimSpace(in.Message)
		if emBranco(nome) || email == "" {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Nome e email são obrigatórios.")
			return
		}
		if utf8.RuneCountInString(nome) > 120 || len(email) > 254 || utf8.RuneCountInString(msg) > 2000 || !emailPlausivel(email) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Confira o nome, o e-mail e o tamanho da mensagem.")
			return
		}
		var corpo []byte
		err := p.QueryRow(r.Context(), `with n as (insert into access_requests (name, email, message, status)
			values (@nome::text, @email::text, @msg::text, 'pending') on conflict (lower(email)) where status = 'pending' do nothing returning id)
			select row_to_json(x) from (select coalesce((select id from n), gen_random_uuid()) as id) x`,
			pgx.NamedArgs{"nome": nome, "email": email, "msg": msg}).Scan(&corpo)
		if err != nil {
			dados.ErroDoBanco(w, err) // texto com NUL = 22021 = 400; o resto loga só código e mensagem do banco
			return
		}
		dados.Responder(w, http.StatusCreated, corpo)
	}
}

// emailPlausivel: um endereço só, sem nome de exibição, com domínio que tem ponto.
func emailPlausivel(s string) bool {
	a, err := mail.ParseAddress(s)
	return err == nil && a.Address == s && strings.Contains(s[strings.LastIndex(s, "@")+1:], ".")
}

const colunasPedido = `t.id, t.name, t.email, t.message, t.status, t.created_at`

var consultaPedidos = dados.Consulta{Tabela: "access_requests", Alias: "t", SQL: `select ` + colunasPedido + ` from access_requests t`,
	OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

type corpoDecisao struct {
	Status json.RawMessage `json:"status,omitempty"`
}

func (c corpoDecisao) Validar() error {
	var s string
	if json.Unmarshal(c.Status, &s) != nil || !slices.Contains([]string{"pending", "approved", "denied"}, s) {
		return errors.New("status deve ser pending, approved ou denied")
	}
	return nil
}

var tabelaPedidos = dados.Tabela{Nome: "access_requests", Resposta: colunasPedido}

// montarPedidos: GET /acesso/pedidos (admin_read_requests no WHERE) e PATCH /acesso/pedidos/{id}
// (admin_update_requests; recusa sessão de "entrar como").
func montarPedidos(r chi.Router, p *pgxpool.Pool) {
	deve(consultaPedidos.Validar(autz.Producao))
	deve(tabelaPedidos.Validar(autz.Producao))
	r.Get("/acesso/pedidos", consultaPedidos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Patch("/acesso/pedidos/{id}", dados.RotaEditar[corpoDecisao](p, autz.Producao, tabelaPedidos))
}
