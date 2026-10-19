package zoho

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/conexoes"
)

// Proxy do Acessos (Plano 07a): o que a edge acessos-proxy fazia no Zoho Mail, no Contacts e no WorkDrive (leitura e
// escrita) e o OAuth da conexão (acessos-oauth). O corpo de resposta do Zoho volta ao chamador (que traduz); o token e os
// segredos da conexão não saem do pacote.

// Servico: em qual API do Zoho o pedido vai.
type Servico int

const (
	Mail Servico = iota
	Contatos
	WorkDrive
)

// Pedido: Caminho começa com "/" e leva a query; Corpo (JSON) vazio = sem corpo.
type Pedido struct {
	Metodo  string
	Servico Servico
	Caminho string
	Corpo   []byte
}

// Resposta: qualquer status HTTP do Zoho volta aqui (o chamador decide); erro só quando não houve resposta.
type Resposta struct {
	Status int
	Corpo  []byte
	Tipo   string // Content-Type
}

const tetoDaResposta = 8 << 20

// reTokenDoProxy: token recusado de verdade (F7003, INVALID_OAUTHTOKEN). Mais estreito que reTokenRecusado de propósito:
// INVALID_OAUTHSCOPE num laço (fotos do import) renovaria o token a cada chamada e estouraria o limite do Zoho.
var reTokenDoProxy = regexp.MustCompile(`(?i)F7003|invalid.?oauth.?token`)

func (c *Cliente) base(s Servico, sufixo string) string {
	switch s {
	case Contatos:
		return c.contatos(sufixo)
	case WorkDrive:
		return c.api(sufixo)
	}
	return c.mail(sufixo)
}

// Chamar faz o pedido com o token da conexão; token recusado (401 ou F7003) renova e tenta UMA vez de novo.
func (c *Cliente) Chamar(ctx context.Context, con Conexao, p Pedido) (Resposta, error) {
	for tentativa := 0; ; tentativa++ {
		tok, err := c.tokenDe(ctx, con)
		if err != nil {
			return Resposta{}, err
		}
		var corpo io.Reader
		if len(p.Corpo) > 0 {
			corpo = bytes.NewReader(p.Corpo)
		}
		req, err := http.NewRequestWithContext(ctx, p.Metodo, c.base(p.Servico, con.sufixo)+p.Caminho, corpo)
		if err != nil {
			return Resposta{}, errors.New("zoho: pedido inválido")
		}
		req.Header.Set("Authorization", "Zoho-oauthtoken "+tok)
		if p.Servico == WorkDrive {
			req.Header.Set("Accept", "application/vnd.api+json")
		}
		if len(p.Corpo) > 0 {
			req.Header.Set("Content-Type", "application/json")
		}
		resp, err := c.http.Do(req)
		if err != nil { // o *url.Error traz a URL: não sai daqui
			return Resposta{}, semResposta(ctx, "zoho: sem resposta")
		}
		lido, err := io.ReadAll(io.LimitReader(resp.Body, tetoDaResposta))
		resp.Body.Close()
		if err != nil {
			return Resposta{}, semResposta(ctx, "zoho: resposta interrompida")
		}
		if tentativa == 0 && (resp.StatusCode == http.StatusUnauthorized || reTokenDoProxy.Match(lido)) { // F7003 vem às vezes com 200; INVALID_OAUTHSCOPE (sem escopo) não é token vencido
			c.esquecer(tok)
			continue
		}
		return Resposta{Status: resp.StatusCode, Corpo: lido, Tipo: resp.Header.Get("Content-Type")}, nil
	}
}

// Estado: o que a tela pode saber da conexão (nunca os segredos).
type Estado struct {
	Conectado   bool
	OrgID       *string
	ConectadoEm *time.Time
}

func (c *Cliente) Estado(ctx context.Context) (Estado, error) {
	var e Estado
	err := c.pool.QueryRow(ctx, `select coalesce(refresh_token, '') <> '', org_id, conectado_em from acessos_conexoes where provedor = 'zoho'`).
		Scan(&e.Conectado, &e.OrgID, &e.ConectadoEm)
	if errors.Is(err, pgx.ErrNoRows) {
		return Estado{}, conexoes.ErrSemConexao
	}
	return e, err
}

// credenciais: client_id, client_secret, sufixo e escopos, SEM exigir refresh_token (a primeira conexão ainda não tem).
func (c *Cliente) credenciais(ctx context.Context) (clientID, secret, sufixo, escopos string, err error) {
	var dc, esc *string
	err = c.pool.QueryRow(ctx, `select coalesce(client_id, ''), coalesce(client_secret, ''), data_center, escopos
		  from acessos_conexoes where provedor = 'zoho'`).Scan(&clientID, &secret, &dc, &esc)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", "", conexoes.ErrSemConexao
	}
	if err != nil {
		return "", "", "", "", err
	}
	sufixo = ".com"
	if dc != nil && strings.TrimSpace(*dc) != "" {
		sufixo = "." + strings.TrimPrefix(strings.TrimSpace(*dc), ".")
	}
	if clientID == "" || secret == "" || !slices.Contains(dataCenters, sufixo) {
		return "", "", "", "", ErrDesconectado
	}
	if esc != nil {
		escopos = strings.TrimSpace(*esc)
	}
	if escopos == "" {
		escopos = "ZohoMail.organization.accounts.READ"
	}
	return clientID, secret, sufixo, escopos, nil
}

// URLDeConsentimento: grava um state novo e devolve a URL de autorização do Zoho (redirect_uri = callback).
func (c *Cliente) URLDeConsentimento(ctx context.Context, callback string) (string, error) {
	clientID, _, sufixo, escopos, err := c.credenciais(ctx)
	if err != nil {
		return "", err
	}
	estado, err := conexoes.NovoEstado(ctx, c.pool, "zoho")
	if err != nil {
		return "", err
	}
	q := url.Values{"response_type": {"code"}, "access_type": {"offline"}, "prompt": {"consent"}, "client_id": {clientID},
		"scope": {escopos}, "redirect_uri": {callback}, "state": {estado}}
	return c.contas(sufixo) + "/oauth/v2/auth?" + q.Encode(), nil
}

// FalhaOAuth: o motivo curto que o retorno devolve à tela (?zoho=erro&msg=<motivo>). Sem segredo, sem corpo do provedor.
type FalhaOAuth struct{ Motivo string }

func (f *FalhaOAuth) Error() string { return "zoho: oauth: " + f.Motivo }

// ConcluirOAuth: confere o state (CSRF), troca o code por tokens, acha o zoid (best effort) e grava a conexão.
func (c *Cliente) ConcluirOAuth(ctx context.Context, code, estado, callback string) error {
	clientID, secret, sufixo, _, err := c.credenciais(ctx)
	if err != nil {
		return &FalhaOAuth{"falha_ao_ler_credenciais"}
	}
	switch err := conexoes.ConsumirEstado(ctx, c.pool, "zoho", estado); {
	case errors.Is(err, conexoes.ErrEstadoInvalido):
		return &FalhaOAuth{"state_invalido"}
	case errors.Is(err, conexoes.ErrEstadoExpirado):
		return &FalhaOAuth{"state_expirado"}
	case err != nil:
		return &FalhaOAuth{"falha_ao_ler_credenciais"}
	}
	form := url.Values{"grant_type": {"authorization_code"}, "client_id": {clientID}, "client_secret": {secret},
		"redirect_uri": {callback}, "code": {code}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.contas(sufixo)+"/oauth/v2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return &FalhaOAuth{"falha_token"}
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return &FalhaOAuth{"falha_token"}
	}
	var tk struct {
		Acesso     string `json:"access_token"`
		Atualizar  string `json:"refresh_token"`
		ErroDoZoho string `json:"error"`
	}
	err = json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&tk)
	resp.Body.Close()
	if resp.StatusCode/100 != 2 || (err != nil && !errors.Is(err, io.EOF)) || tk.ErroDoZoho != "" {
		return &FalhaOAuth{"falha_token"}
	}
	if tk.Atualizar == "" {
		return &FalhaOAuth{"sem_refresh_token"}
	}
	zoid := c.zoidDe(ctx, sufixo, tk.Acesso)
	if _, err := c.pool.Exec(ctx, `update acessos_conexoes set refresh_token = $1, org_id = $2, conectado_em = now(), atualizado_em = now()
		  where provedor = 'zoho'`, tk.Atualizar, zoid); err != nil {
		return &FalhaOAuth{"falha_ao_salvar"}
	}
	return nil
}

// zoidDe: o id da organização no Zoho Mail; best effort (a conexão vale sem ele, org_id fica nulo como na edge).
func (c *Cliente) zoidDe(ctx context.Context, sufixo, acesso string) *string {
	if acesso == "" {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.mail(sufixo)+"/api/organization", nil)
	if err != nil {
		return nil
	}
	req.Header.Set("Authorization", "Zoho-oauthtoken "+acesso)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return nil
	}
	var j struct {
		Data json.RawMessage `json:"data"`
		Zoid json.RawMessage `json:"zoid"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&j) != nil {
		return nil
	}
	var um struct {
		Zoid json.RawMessage `json:"zoid"`
	}
	var varios []struct {
		Zoid json.RawMessage `json:"zoid"`
	}
	cand := j.Zoid
	if json.Unmarshal(j.Data, &um) == nil && len(um.Zoid) > 0 {
		cand = um.Zoid
	} else if json.Unmarshal(j.Data, &varios) == nil && len(varios) > 0 && len(varios[0].Zoid) > 0 {
		cand = varios[0].Zoid
	}
	s := strings.Trim(string(cand), `"`)
	if s == "" || s == "null" {
		return nil
	}
	return &s
}
