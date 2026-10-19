// Package microsoft fala com o OneDrive (conta pessoal, Microsoft Graph) pela conexão OAuth da Central guardada em
// acessos_conexoes (provedor 'microsoft'), como a edge acessos-proxy fazia com a chave de serviço, e conclui o OAuth da
// conexão (a edge acessos-oauth). Os segredos (client_secret, refresh_token e o token de acesso) não saem deste pacote:
// nem em erro, nem em log, nem no String() do cliente.
package microsoft

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/conexoes"
)

// ErrDesconectado: sem conexão utilizável (sem linha, sem client_id/secret, ou sem refresh_token quando a chamada o exige).
var ErrDesconectado = errors.New("microsoft: sem conexão")

const (
	// "consumers" = contas pessoais da Microsoft (MSA), o que o OneDrive da RBV é.
	urlDeAutorizacao = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize"
	urlDoToken       = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token"
	urlDoGrafo       = "https://graph.microsoft.com/v1.0"
	escopoPadrao     = "Files.ReadWrite offline_access User.Read"
	tetoDaResposta   = 8 << 20
)

type chave struct{ clientID, refreshToken, escopos string }

// Cliente: o token de acesso fica em memória por 50 min (vale ~1 h). ponytail: um por processo; vários processos =
// cada um pede o seu (o refresh_token não gira, então não há corrida).
type Cliente struct {
	pool              *pgxpool.Pool
	http              *http.Client
	urlAuth, urlToken string // só ParaTeste troca
	grafo             string
	mu                sync.Mutex
	token             string
	ate               time.Time
	de                chave
}

func (c *Cliente) String() string   { return "microsoft.Cliente" }
func (c *Cliente) GoString() string { return c.String() }

func Novo(p *pgxpool.Pool) *Cliente {
	return &Cliente{pool: p, urlAuth: urlDeAutorizacao, urlToken: urlDoToken, grafo: urlDoGrafo,
		http: &http.Client{Timeout: 50 * time.Second,
			// o POST do token (client_secret e refresh_token no corpo) e o Bearer nunca seguem redirecionamento
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

// ParaTeste: o cliente falando com um Graph/login de mentira (httptest). Base que não é loopback derruba o teste.
func ParaTeste(t testing.TB, p *pgxpool.Pool, base string) *Cliente {
	t.Helper()
	u, err := url.Parse(base)
	if err != nil || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" && u.Hostname() != "localhost") {
		t.Fatalf("microsoft.ParaTeste: base %q não é loopback", base)
	}
	c := Novo(p)
	b := strings.TrimRight(base, "/")
	c.urlAuth, c.urlToken, c.grafo = b+"/authorize", b+"/token", b+"/graph"
	return c
}

type linha struct{ clientID, secret, refresh, escopos string }

func (c *Cliente) ler(ctx context.Context) (linha, error) {
	var l linha
	var esc *string
	err := c.pool.QueryRow(ctx, `select coalesce(client_id, ''), coalesce(client_secret, ''), coalesce(refresh_token, ''), escopos
		  from acessos_conexoes where provedor = 'microsoft'`).Scan(&l.clientID, &l.secret, &l.refresh, &esc)
	if errors.Is(err, pgx.ErrNoRows) {
		return linha{}, conexoes.ErrSemConexao
	}
	if err != nil {
		return linha{}, err
	}
	l.escopos = escopoPadrao
	if esc != nil && strings.TrimSpace(*esc) != "" {
		l.escopos = strings.TrimSpace(*esc)
	}
	return l, nil
}

// Estado: o que a tela pode saber da conexão (nunca os segredos).
type Estado struct {
	Conectado   bool
	ConectadoEm *time.Time
}

func (c *Cliente) Estado(ctx context.Context) (Estado, error) {
	var e Estado
	err := c.pool.QueryRow(ctx, `select coalesce(refresh_token, '') <> '', conectado_em from acessos_conexoes where provedor = 'microsoft'`).
		Scan(&e.Conectado, &e.ConectadoEm)
	if errors.Is(err, pgx.ErrNoRows) {
		return Estado{}, conexoes.ErrSemConexao
	}
	return e, err
}

func (c *Cliente) tokenDe(ctx context.Context, l linha) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	k := chave{l.clientID, l.refresh, l.escopos}
	if c.token != "" && c.de == k && time.Now().Before(c.ate) {
		return c.token, nil
	}
	form := url.Values{"client_id": {l.clientID}, "scope": {l.escopos}, "refresh_token": {l.refresh},
		"grant_type": {"refresh_token"}, "client_secret": {l.secret}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.urlToken, strings.NewReader(form.Encode()))
	if err != nil {
		return "", errors.New("microsoft: sem token")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", semResposta(ctx, "microsoft: sem token (sem resposta)")
	}
	defer resp.Body.Close()
	var j struct {
		AccessToken string `json:"access_token"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&j) != nil || j.AccessToken == "" {
		return "", errors.New("microsoft: sem token (status " + http.StatusText(resp.StatusCode) + ")")
	}
	c.token, c.ate, c.de = j.AccessToken, time.Now().Add(50*time.Minute), k
	return c.token, nil
}

func (c *Cliente) esquecer(tok string) {
	c.mu.Lock()
	if c.token == tok {
		c.token = ""
	}
	c.mu.Unlock()
}

// semResposta: contexto cancelado ou vencido vai embrulhado (errors.Is); a URL (do *url.Error) nunca sai daqui.
func semResposta(ctx context.Context, msg string) error {
	if ctx.Err() != nil {
		return errors.New(msg + ": " + ctx.Err().Error())
	}
	return errors.New(msg)
}

// Resposta do Graph: Corpo é o JSON da resposta (vazio no 204; `{"raw": "..."}` quando não era JSON, como a edge).
type Resposta struct {
	Status int
	Corpo  json.RawMessage
}

func (r Resposta) OK() bool { return r.Status/100 == 2 }

// Grafo chama o Graph (`caminho` começa com "/me/drive/...", segmentos já escapados). Qualquer status volta em Resposta;
// erro só quando não houve resposta ou a conexão não existe/está desconectada. Token recusado (401) renova e repete UMA vez.
func (c *Cliente) Grafo(ctx context.Context, metodo, caminho string, corpo any) (Resposta, error) {
	l, err := c.ler(ctx)
	if err != nil {
		return Resposta{}, err
	}
	if l.refresh == "" || l.clientID == "" {
		return Resposta{}, ErrDesconectado
	}
	var enviar []byte
	if corpo != nil {
		if enviar, err = json.Marshal(corpo); err != nil {
			return Resposta{}, err
		}
	}
	for tentativa := 0; ; tentativa++ {
		tok, err := c.tokenDe(ctx, l)
		if err != nil {
			return Resposta{}, err
		}
		var rd io.Reader
		if enviar != nil {
			rd = bytes.NewReader(enviar)
		}
		req, err := http.NewRequestWithContext(ctx, metodo, c.grafo+caminho, rd)
		if err != nil {
			return Resposta{}, errors.New("microsoft: pedido inválido")
		}
		req.Header.Set("Authorization", "Bearer "+tok)
		if enviar != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := c.http.Do(req)
		if err != nil { // o *url.Error traz a URL: não sai daqui
			return Resposta{}, semResposta(ctx, "microsoft: sem resposta")
		}
		lido, err := io.ReadAll(io.LimitReader(resp.Body, tetoDaResposta))
		resp.Body.Close()
		if err != nil {
			return Resposta{}, semResposta(ctx, "microsoft: resposta interrompida")
		}
		if tentativa == 0 && resp.StatusCode == http.StatusUnauthorized {
			c.esquecer(tok)
			continue
		}
		return Resposta{Status: resp.StatusCode, Corpo: corpoJSON(lido)}, nil
	}
}

func corpoJSON(b []byte) json.RawMessage {
	b = bytes.TrimSpace(b)
	if len(b) == 0 {
		return nil
	}
	if json.Valid(b) {
		return b
	}
	if len(b) > 800 {
		b = b[:800]
	}
	r, _ := json.Marshal(map[string]string{"raw": strings.ToValidUTF8(string(b), "")})
	return r
}

// URLDeConsentimento: grava um state novo e devolve a URL de autorização (redirect_uri = callback).
func (c *Cliente) URLDeConsentimento(ctx context.Context, callback string) (string, error) {
	l, err := c.ler(ctx)
	if err != nil {
		return "", err
	}
	if l.clientID == "" || l.secret == "" {
		return "", ErrDesconectado
	}
	estado, err := conexoes.NovoEstado(ctx, c.pool, "microsoft")
	if err != nil {
		return "", err
	}
	q := url.Values{"client_id": {l.clientID}, "response_type": {"code"}, "redirect_uri": {callback},
		"response_mode": {"query"}, "scope": {l.escopos}, "state": {estado}}
	return c.urlAuth + "?" + q.Encode(), nil
}

// FalhaOAuth: o motivo curto que o retorno devolve à tela (?onedrive=erro&msg=<motivo>). Sem segredo.
type FalhaOAuth struct{ Motivo string }

func (f *FalhaOAuth) Error() string { return "microsoft: oauth: " + f.Motivo }

// ConcluirOAuth: confere o state (CSRF), troca o code por tokens e grava o refresh_token.
func (c *Cliente) ConcluirOAuth(ctx context.Context, code, estado, callback string) error {
	l, err := c.ler(ctx)
	if err != nil || l.clientID == "" || l.secret == "" {
		return &FalhaOAuth{"falha_ao_ler_credenciais"}
	}
	switch err := conexoes.ConsumirEstado(ctx, c.pool, "microsoft", estado); {
	case errors.Is(err, conexoes.ErrEstadoInvalido):
		return &FalhaOAuth{"state_invalido"}
	case errors.Is(err, conexoes.ErrEstadoExpirado):
		return &FalhaOAuth{"state_expirado"}
	case err != nil:
		return &FalhaOAuth{"falha_ao_ler_credenciais"}
	}
	form := url.Values{"client_id": {l.clientID}, "scope": {l.escopos}, "code": {code}, "redirect_uri": {callback},
		"grant_type": {"authorization_code"}, "client_secret": {l.secret}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.urlToken, strings.NewReader(form.Encode()))
	if err != nil {
		return &FalhaOAuth{"falha_token"}
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return &FalhaOAuth{"falha_token"}
	}
	var tk struct {
		Atualizar string `json:"refresh_token"`
		Erro      string `json:"error"`
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&tk)
	resp.Body.Close()
	if resp.StatusCode/100 != 2 || (err != nil && !errors.Is(err, io.EOF)) || tk.Erro != "" {
		return &FalhaOAuth{"falha_token"}
	}
	if tk.Atualizar == "" {
		return &FalhaOAuth{"sem_refresh_token"}
	}
	if _, err := c.pool.Exec(ctx, `update acessos_conexoes set refresh_token = $1, conectado_em = now(), atualizado_em = now()
		  where provedor = 'microsoft'`, tk.Atualizar); err != nil {
		return &FalhaOAuth{"falha_ao_salvar"}
	}
	return nil
}
