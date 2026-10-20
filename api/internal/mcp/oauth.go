// Package mcp é a porta do ChatGPT para a Frota: um servidor OAuth 2.1 mínimo (cliente público + PKCE) e o
// endpoint MCP. Desenho: docs/superpowers/specs/2026-10-19-mcp-frota-chatgpt-design.md.
package mcp

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	escopo        = "frota"
	vidaDoCodigo  = 10 * time.Minute
	vidaDoRefresh = 30 * 24 * time.Hour
)

// hostsDeRetorno: para onde um código pode voltar. O nome do cliente é escolhido por quem se registra (qualquer
// um), então ESTA lista é o que impede um site qualquer de pedir o consentimento de alguém e levar o código.
// ponytail: lista fixa; vira variável de ambiente quando outro cliente (Claude, por exemplo) precisar entrar.
var hostsDeRetorno = []string{"chatgpt.com", "chat.openai.com"}

// OAuth: Emissor = API_URL_PUBLICA (o issuer e a base dos endpoints); Front = ENDERECO_PADRAO (a tela de
// consentimento mora em <Front>/oauth/consentimento).
type OAuth struct {
	Pool    *pgxpool.Pool
	Sessoes *auth.Store
	Emissor string
	Front   string
}

func hashDe(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

func aleatorio() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err) // crypto/rand não falha em sistema são
	}
	return base64.RawURLEncoding.EncodeToString(b)
}

func responderJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// erroOAuth: o formato do RFC 6749 §5.2 (token e registro).
func erroOAuth(w http.ResponseWriter, status int, codigo, descricao string) {
	responderJSON(w, status, map[string]string{"error": codigo, "error_description": descricao})
}

// ---- metadados (RFC 9728 e RFC 8414) ----

func (o *OAuth) MetadadosDoRecurso(w http.ResponseWriter, _ *http.Request) {
	responderJSON(w, http.StatusOK, map[string]any{
		"resource":                 o.Emissor + "/mcp",
		"authorization_servers":    []string{o.Emissor},
		"scopes_supported":         []string{escopo},
		"bearer_methods_supported": []string{"header"},
	})
}

func (o *OAuth) MetadadosDoServidor(w http.ResponseWriter, _ *http.Request) {
	responderJSON(w, http.StatusOK, map[string]any{
		"issuer":                                o.Emissor,
		"authorization_endpoint":                o.Emissor + "/oauth/autorizar",
		"token_endpoint":                        o.Emissor + "/oauth/token",
		"registration_endpoint":                 o.Emissor + "/oauth/registrar",
		"scopes_supported":                      []string{escopo},
		"response_types_supported":              []string{"code"},
		"grant_types_supported":                 []string{"authorization_code", "refresh_token"},
		"code_challenge_methods_supported":      []string{"S256"},
		"token_endpoint_auth_methods_supported": []string{"none"},
	})
}

// ---- registro dinâmico (RFC 7591) ----

func retornoPermitido(u string) bool {
	p, err := url.Parse(u)
	return err == nil && len(u) <= 500 && p.Scheme == "https" && p.User == nil && p.Fragment == "" &&
		p.Port() == "" && slices.Contains(hostsDeRetorno, p.Hostname())
}

func (o *OAuth) Registrar(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Nome    string   `json:"client_name"`
		Retorno []string `json:"redirect_uris"`
		Metodo  string   `json:"token_endpoint_auth_method"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&in) != nil {
		erroOAuth(w, http.StatusBadRequest, "invalid_client_metadata", "corpo JSON inválido")
		return
	}
	if in.Metodo != "" && in.Metodo != "none" {
		erroOAuth(w, http.StatusBadRequest, "invalid_client_metadata", "só cliente público (token_endpoint_auth_method none)")
		return
	}
	if len(in.Retorno) == 0 || len(in.Retorno) > 5 {
		erroOAuth(w, http.StatusBadRequest, "invalid_redirect_uri", "de 1 a 5 redirect_uris")
		return
	}
	for _, u := range in.Retorno {
		if !retornoPermitido(u) {
			erroOAuth(w, http.StatusBadRequest, "invalid_redirect_uri", "redirect_uri fora dos hosts permitidos: "+strings.Join(hostsDeRetorno, ", "))
			return
		}
	}
	nome := strings.TrimSpace(in.Nome)
	if nome == "" {
		nome = "Cliente MCP"
	}
	if r := []rune(nome); len(r) > 100 {
		nome = string(r[:100])
	}
	id := "mcp_" + aleatorio()
	if _, err := o.Pool.Exec(r.Context(), `insert into oauth_clientes (id, nome, redirect_uris) values ($1, $2, $3)`,
		id, nome, in.Retorno); err != nil {
		erroOAuth(w, http.StatusInternalServerError, "server_error", "")
		return
	}
	responderJSON(w, http.StatusCreated, map[string]any{
		"client_id": id, "client_id_issued_at": time.Now().Unix(), "client_name": nome, "redirect_uris": in.Retorno,
		"token_endpoint_auth_method": "none", "grant_types": []string{"authorization_code", "refresh_token"},
		"response_types": []string{"code"}, "scope": escopo,
	})
}

// ---- autorização ----

// pedido: os parâmetros do authorization request, os mesmos do GET /oauth/autorizar ao POST /oauth/decidir.
type pedido struct {
	Cliente  string `json:"client_id"`
	Retorno  string `json:"redirect_uri"`
	Desafio  string `json:"code_challenge"`
	Metodo   string `json:"code_challenge_method"`
	Estado   string `json:"state"`
	Tipo     string `json:"response_type"`
	Escopo   string `json:"scope"`
	Recurso  string `json:"resource"`
	Permitir bool   `json:"permitir"`
}

var errClienteOuRetorno = errors.New("client_id desconhecido ou redirect_uri não registrada para ele")

// erroDoPedido: pedido mal formado de cliente conhecido; volta ao redirect_uri como invalid_request.
type erroDoPedido string

func (e erroDoPedido) Error() string { return string(e) }

// conferir valida o pedido. errClienteOuRetorno: não dá para devolver o erro ao cliente (não se redireciona para
// endereço não conferido). erroDoPedido: volta ao redirect_uri. Outro erro: falha do banco.
func (o *OAuth) conferir(r *http.Request, p pedido) (nomeDoCliente string, err error) {
	var uris []string
	err = o.Pool.QueryRow(r.Context(), `select nome, redirect_uris from oauth_clientes where id = $1`, p.Cliente).
		Scan(&nomeDoCliente, &uris)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !slices.Contains(uris, p.Retorno)) {
		return "", errClienteOuRetorno
	}
	if err != nil {
		return "", err
	}
	switch {
	case p.Tipo != "code":
		return "", erroDoPedido("response_type deve ser code")
	case p.Metodo != "S256" || len(p.Desafio) < 43 || len(p.Desafio) > 128:
		return "", erroDoPedido("PKCE obrigatório (code_challenge_method S256)")
	case p.Escopo != "" && !slices.Contains(strings.Fields(p.Escopo), escopo):
		return "", erroDoPedido("escopo deve ser frota")
	case p.Recurso != "" && strings.TrimRight(p.Recurso, "/") != o.Emissor+"/mcp":
		return "", erroDoPedido("resource desconhecido")
	}
	return nomeDoCliente, nil
}

func pedidoDaQuery(q url.Values) pedido {
	return pedido{Cliente: q.Get("client_id"), Retorno: q.Get("redirect_uri"), Desafio: q.Get("code_challenge"),
		Metodo: q.Get("code_challenge_method"), Estado: q.Get("state"), Tipo: q.Get("response_type"),
		Escopo: q.Get("scope"), Recurso: q.Get("resource")}
}

func (p pedido) query() url.Values {
	q := url.Values{}
	for k, v := range map[string]string{"client_id": p.Cliente, "redirect_uri": p.Retorno, "code_challenge": p.Desafio,
		"code_challenge_method": p.Metodo, "state": p.Estado, "response_type": p.Tipo, "scope": p.Escopo, "resource": p.Recurso} {
		if v != "" {
			q.Set(k, v)
		}
	}
	return q
}

// devolver monta o endereço de volta ao cliente (já conferido) com os parâmetros dados e o state.
func (o *OAuth) devolver(p pedido, params url.Values) string {
	u, _ := url.Parse(p.Retorno) // conferido no registro
	q := u.Query()
	for k, v := range params {
		q[k] = v
	}
	if p.Estado != "" {
		q.Set("state", p.Estado)
	}
	q.Set("iss", o.Emissor) // RFC 9207
	u.RawQuery = q.Encode()
	return u.String()
}

// Autorizar: GET /oauth/autorizar (público). Pedido bom vai à tela de consentimento do front, que exige login.
func (o *OAuth) Autorizar(w http.ResponseWriter, r *http.Request) {
	p := pedidoDaQuery(r.URL.Query())
	_, err := o.conferir(r, p)
	var ep erroDoPedido
	switch {
	case errors.Is(err, errClienteOuRetorno):
		http.Error(w, "Pedido de autorização inválido: "+err.Error()+".", http.StatusBadRequest)
	case errors.As(err, &ep):
		http.Redirect(w, r, o.devolver(p, url.Values{"error": {"invalid_request"}, "error_description": {ep.Error()}}), http.StatusFound)
	case err != nil:
		http.Error(w, "erro interno", http.StatusInternalServerError)
	default:
		http.Redirect(w, r, o.Front+"/oauth/consentimento?"+p.query().Encode(), http.StatusFound)
	}
}

// fraseSoPainel: a recusa que a tela de consentimento mostra a quem não é conta do painel.
const fraseSoPainel = "Só contas da Central podem ligar o ChatGPT a ela."

// SoPainel vai DEPOIS de auth.Exigir nas rotas da tela de consentimento. Qualquer conta do painel liga o ChatGPT
// (decisão do dono, 20/10: "autônomo a todo painel, desde que o usuário tenha permissão"); o que ela alcança lá
// dentro é o que a permissão dela alcança na tela. Cliente da Vessel não: o /mcp age como sessão de painel.
func SoPainel(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a := auth.AtorDoContexto(r.Context()); a == nil || a.Tipo != "painel" {
			responderJSON(w, http.StatusForbidden, map[string]string{"error": "sem_permissao", "mensagem": fraseSoPainel})
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Pedido: GET /oauth/pedido (sessão do painel). A tela de consentimento pergunta quem está pedindo ANTES de
// mostrar os botões; pode=false na sessão de "entrar como", que lê mas não consente.
func (o *OAuth) Pedido(w http.ResponseWriter, r *http.Request) {
	nome, err := o.conferir(r, pedidoDaQuery(r.URL.Query()))
	if recusou(w, err) {
		return
	}
	resp := map[string]any{"cliente": nome, "pode": true}
	if auth.AtorDoContexto(r.Context()).ImpersonadorID != nil {
		resp["pode"], resp["mensagem"] = false, dados.FraseEntrarComo
	}
	responderJSON(w, http.StatusOK, resp)
}

// recusou responde ao pedido inválido no formato da API ({"error","mensagem"}): a tela mostra a frase.
func recusou(w http.ResponseWriter, err error) bool {
	var ep erroDoPedido
	switch {
	case err == nil:
		return false
	case errors.Is(err, errClienteOuRetorno):
		responderJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido_invalido",
			"mensagem": "Este pedido de ligação não é válido. Comece de novo pelo ChatGPT."})
	case errors.As(err, &ep):
		responderJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido_invalido",
			"mensagem": "Pedido de ligação inválido: " + ep.Error() + "."})
	default:
		responderJSON(w, http.StatusInternalServerError, map[string]string{"error": "erro_interno"})
	}
	return true
}

// Decidir: POST /oauth/decidir (sessão própria do painel). Permitir grava o código; negar devolve access_denied. A resposta
// traz o endereço de volta ao cliente, já conferido: a tela só navega para ele.
func (o *OAuth) Decidir(w http.ResponseWriter, r *http.Request) {
	a := auth.AtorDoContexto(r.Context()) // painel e sessão própria: a rota já exigiu (SoPainel, dados.SoSessaoPropria)
	var p pedido
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&p) != nil {
		responderJSON(w, http.StatusBadRequest, map[string]string{"error": "pedido_invalido", "mensagem": "Corpo inválido."})
		return
	}
	if _, err := o.conferir(r, p); recusou(w, err) {
		return
	}
	if !p.Permitir {
		responderJSON(w, http.StatusOK, map[string]string{"redirect": o.devolver(p, url.Values{"error": {"access_denied"}})})
		return
	}
	codigo := aleatorio()
	// a faxina dos códigos vencidos vai junto: a tabela não cresce sem robô para isso
	_, err := o.Pool.Exec(r.Context(), `with faxina as (delete from oauth_codigos where expira_em < now())
		insert into oauth_codigos (codigo_hash, cliente_id, usuario_id, redirect_uri, desafio, expira_em)
		values ($1, $2, $3::uuid, $4, $5, now() + $6::interval)`, hashDe(codigo), p.Cliente, a.ID, p.Retorno, p.Desafio,
		vidaDoCodigo.String())
	if err != nil {
		responderJSON(w, http.StatusInternalServerError, map[string]string{"error": "erro_interno"})
		return
	}
	responderJSON(w, http.StatusOK, map[string]string{"redirect": o.devolver(p, url.Values{"code": {codigo}})})
}

// ---- token ----

// Token: POST /oauth/token (público, form-urlencoded). authorization_code com PKCE e refresh_token rotativo.
func (o *OAuth) Token(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 16<<10)
	if r.ParseForm() != nil {
		erroOAuth(w, http.StatusBadRequest, "invalid_request", "corpo inválido")
		return
	}
	switch r.PostForm.Get("grant_type") {
	case "authorization_code":
		o.trocarCodigo(w, r)
	case "refresh_token":
		o.renovar(w, r)
	default:
		erroOAuth(w, http.StatusBadRequest, "unsupported_grant_type", "use authorization_code ou refresh_token")
	}
}

func pkceConfere(verificador, desafio string) bool {
	if len(verificador) < 43 || len(verificador) > 128 {
		return false
	}
	h := sha256.Sum256([]byte(verificador))
	return subtle.ConstantTimeCompare([]byte(base64.RawURLEncoding.EncodeToString(h[:])), []byte(desafio)) == 1
}

func (o *OAuth) trocarCodigo(w http.ResponseWriter, r *http.Request) {
	f := r.PostForm
	var cliente, usuario, retorno, desafio string
	// delete ... returning: o código vale UMA vez, mesmo com duas trocas simultâneas
	err := o.Pool.QueryRow(r.Context(), `delete from oauth_codigos where codigo_hash = $1 and expira_em > now()
		returning cliente_id, usuario_id::text, redirect_uri, desafio`, hashDe(f.Get("code"))).
		Scan(&cliente, &usuario, &retorno, &desafio)
	if errors.Is(err, pgx.ErrNoRows) {
		erroOAuth(w, http.StatusBadRequest, "invalid_grant", "código inválido, vencido ou já usado")
		return
	}
	if err != nil {
		erroOAuth(w, http.StatusInternalServerError, "server_error", "")
		return
	}
	if f.Get("client_id") != cliente || f.Get("redirect_uri") != retorno || !pkceConfere(f.Get("code_verifier"), desafio) {
		erroOAuth(w, http.StatusBadRequest, "invalid_grant", "client_id, redirect_uri ou code_verifier não conferem")
		return
	}
	o.emitir(w, r, nil, cliente, usuario)
}

// emitir cria a sessão 'mcp' e o refresh dela (família nova, ou a do refresh trocado).
func (o *OAuth) emitir(w http.ResponseWriter, r *http.Request, familia *string, cliente, usuario string) {
	ctx := r.Context()
	acesso, err := o.Sessoes.Criar(ctx, usuario, "mcp", nil)
	if err != nil {
		erroOAuth(w, http.StatusInternalServerError, "server_error", "")
		return
	}
	refresh := aleatorio()
	if _, err := o.Pool.Exec(ctx, `insert into oauth_refresh (token_hash, familia, cliente_id, usuario_id, sessao_hash, expira_em)
		values ($1, coalesce($2::uuid, gen_random_uuid()), $3, $4::uuid, $5, now() + $6::interval)`,
		hashDe(refresh), familia, cliente, usuario, hashDe(acesso), vidaDoRefresh.String()); err != nil {
		o.Sessoes.Revogar(ctx, acesso)
		erroOAuth(w, http.StatusInternalServerError, "server_error", "")
		return
	}
	responderJSON(w, http.StatusOK, map[string]any{"access_token": acesso, "token_type": "Bearer",
		"expires_in": int(o.Sessoes.TTL.Seconds()), "refresh_token": refresh, "scope": escopo})
}

func (o *OAuth) renovar(w http.ResponseWriter, r *http.Request) {
	f := r.PostForm
	ctx := r.Context()
	h := hashDe(f.Get("refresh_token"))
	var familia, cliente, usuario, sessao string
	err := o.Pool.QueryRow(ctx, `update oauth_refresh set usado_em = now()
		where token_hash = $1 and cliente_id = $2 and usado_em is null and expira_em > now()
		returning familia::text, cliente_id, usuario_id::text, sessao_hash`, h, f.Get("client_id")).Scan(&familia, &cliente, &usuario, &sessao)
	if errors.Is(err, pgx.ErrNoRows) {
		// refresh já usado que volta = alguém guardou uma cópia: a família inteira cai (RFC 9700 §4.14.2)
		o.Pool.Exec(ctx, `with f as (delete from oauth_refresh where familia = (select familia from oauth_refresh
			where token_hash = $1 and usado_em is not null) returning sessao_hash)
			delete from sessoes where token_hash in (select sessao_hash from f)`, h)
		erroOAuth(w, http.StatusBadRequest, "invalid_grant", "refresh_token inválido, vencido ou já usado")
		return
	}
	if err != nil {
		erroOAuth(w, http.StatusInternalServerError, "server_error", "")
		return
	}
	// o acesso anterior cai: uma família, um token vivo
	if _, err := o.Pool.Exec(ctx, `delete from sessoes where token_hash = $1`, sessao); err != nil {
		erroOAuth(w, http.StatusInternalServerError, "server_error", "")
		return
	}
	o.emitir(w, r, &familia, cliente, usuario)
}
