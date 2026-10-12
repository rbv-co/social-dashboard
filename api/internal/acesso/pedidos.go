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
	// tetoCorpoPedido: 120 + 2000 caracteres escapados como \uXXXX (6 bytes cada) + e-mail cabem com folga;
	// acima disso é lixo, e a rota é pública (o teto geral de dados.LerCorpo é 1 MiB).
	tetoCorpoPedido = 32 << 10
)

// MontarPublicas: a ÚNICA rota pública do 5.1, montada FORA do grupo autenticado de web.Rotas.
func MontarPublicas(r chi.Router, p *pgxpool.Pool) {
	r.With(auth.LimitarPorIP(LimitePedirAcesso, JanelaPedirAcesso)).Post("/pedir-acesso", pedirAcesso(p))
}

// pedirAcesso: POST /pedir-acesso {name, email, message}, sem sessão (a tela de login). Grava só essas
// três colunas e status 'pending' — o insert anônimo de hoje aceitava qualquer coluna, inclusive status.
// Nome e e-mail são dado pessoal: nunca vão para log nem para a resposta. A resposta é a mesma para
// e-mail novo ou repetido (não há unicidade: a rota não serve para descobrir quem já pediu).
func pedirAcesso(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Rota anônima: um <form> de outro site posta com o navegador (e o IP) do visitante, mas só
		// sem preflight com text/plain, multipart ou urlencoded. Exigir JSON impede que terceiros
		// queimem a cota por IP de quem visita o site deles. (O argumento "Bearer, sem CSRF" de
		// dados.LerCorpo vale para rota autenticada, não para esta.)
		if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
			dados.Erro(w, http.StatusUnsupportedMediaType, "tipo_de_conteudo", "Envie o pedido como application/json.")
			return
		}
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
			values (@nome::text, @email::text, @msg::text, 'pending') returning id) select row_to_json(n) from n`,
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
	r.Get("/acesso/pedidos", consultaPedidos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Patch("/acesso/pedidos/{id}", dados.RotaEditar[corpoDecisao](p, autz.Producao, tabelaPedidos))
}
