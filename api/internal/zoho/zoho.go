// Package zoho fala com o Zoho WorkDrive pela conexão OAuth da Central guardada em acessos_conexoes (provedor
// 'zoho', gravada pela tela de Acessos), como as edges faziam com a chave de serviço. Só leitura: listar uma pasta
// e baixar um arquivo. Consumidor: vessel (POST /vessel-baixar-cartao, Plano 5.10); o Plano 6 acrescenta o que
// precisar (planilhas, upload) neste mesmo cliente. Os segredos (client_secret, refresh_token e o token de acesso)
// não saem deste pacote: nem em erro, nem em log, nem no String() da conexão.
package zoho

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrDesconectado: não há conexão do Zoho utilizável (sem linha, sem refresh_token ou data center fora da lista).
var ErrDesconectado = errors.New("zoho: sem conexão")

// ErroHTTP: o Zoho respondeu fora do 2xx (ou um redirecionamento que não seguimos). Sem o corpo: pode citar o token.
type ErroHTTP struct{ Status int }

func (e *ErroHTTP) Error() string { return fmt.Sprintf("zoho: status %d", e.Status) }

// dataCenters: os sufixos de domínio do Zoho (accounts.zoho<dc>, www.zohoapis<dc>). Lista FECHADA: o valor vem do
// banco, e um texto qualquer levaria o refresh_token a outro host.
var dataCenters = []string{".com", ".eu", ".in", ".com.au", ".jp", ".ca", ".sa", ".com.cn", ".uk"}

// reTokenRecusado: o Zoho invalida o token antes de 1 hora (F7003, visto em 06/10/2026) e às vezes não responde 401.
var reTokenRecusado = regexp.MustCompile(`(?i)F7003|invalid.{0,3}oauth`)

const porPagina = 50 // o máximo do WorkDrive por chamada

// Conexao: as credenciais lidas de acessos_conexoes. Campos fechados e String() sem segredo.
type Conexao struct{ clientID, clientSecret, refreshToken, sufixo string }

func (c Conexao) String() string { return "zoho.Conexao(" + c.sufixo + ")" }

// GoString: o %#v ignora o String() e imprimiria os campos (segredos) um a um.
func (c Conexao) GoString() string { return c.String() }

// chave: de qual conexão é o token em cache; reconectar outra conta do Zoho não reaproveita o token da anterior.
type chave struct{ clientID, refreshToken, sufixo string }

// Item: um arquivo ou pasta de uma listagem.
type Item struct {
	ID, Nome string
	Pasta    bool
}

// Cliente: o token de acesso fica em memória por 50 min (o Zoho limita quantos tokens novos se pedem por janela;
// pedir um por clique estouraria isso). ponytail: um por processo; vários processos = guardar o token no banco.
type Cliente struct {
	pool        *pgxpool.Pool
	http        *http.Client
	contas, api func(sufixo string) string // bases; só ParaTeste troca
	mu          sync.Mutex                 // ponytail: o cadeado fica preso durante o pedido do token (um pedido só por vez); accounts.zoho
	token       string                     // pendurado bloqueia quem chama até o timeout do cliente (50s). Vários processos/tráfego alto: single-flight com contexto.
	ate         time.Time
	de          chave
}

// String e GoString: o %v/%+v/%#v de um *Cliente imprimiria o token de acesso em cache.
func (c *Cliente) String() string   { return "zoho.Cliente" }
func (c *Cliente) GoString() string { return c.String() }

// semResposta: a chamada não chegou a ter resposta. Contexto cancelado ou vencido vai embrulhado (errors.Is) para quem
// chama distinguir "desistimos" de "o Zoho está fora"; a URL (do *url.Error) nunca sai daqui.
func semResposta(ctx context.Context, msg string) error {
	if ctx.Err() != nil {
		return fmt.Errorf("%s: %w", msg, ctx.Err())
	}
	return errors.New(msg)
}

func Novo(p *pgxpool.Pool) *Cliente {
	return &Cliente{pool: p, http: &http.Client{Timeout: 50 * time.Second,
		// segue até 3 redirecionamentos, só para https (o download do WorkDrive pode mudar de host; o Go tira o
		// Authorization quando o domínio muda, como o fetch da edge); http ou o 4º = 3xx devolvido (ErroHTTP). Só GET
		// segue: o POST do token (client_secret e refresh_token no corpo) nunca é reenviado a outro host por 307/308.
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 || req.URL.Scheme != "https" || via[0].Method != http.MethodGet {
				return http.ErrUseLastResponse
			}
			return nil
		}},
		contas: func(s string) string { return "https://accounts.zoho" + s },
		api:    func(s string) string { return "https://www.zohoapis" + s + "/workdrive/api/v1" }}
}

// ParaTeste: o cliente falando com um Zoho de mentira (httptest) nos dois papéis (contas e API). Base que não é
// loopback derruba o teste: nunca aponta para um host de verdade.
func ParaTeste(t testing.TB, p *pgxpool.Pool, base string) *Cliente {
	t.Helper()
	u, err := url.Parse(base)
	if err != nil || u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "::1" && u.Hostname() != "localhost") {
		t.Fatalf("zoho.ParaTeste: base %q não é loopback", base)
	}
	c := Novo(p)
	b := strings.TrimRight(base, "/")
	c.contas = func(string) string { return b }
	c.api = func(string) string { return b + "/workdrive/api/v1" }
	return c
}

// Conexao lê a conexão da Central (acessos_conexoes, provedor 'zoho'). Data center vazio = '.com', como a edge.
func (c *Cliente) Conexao(ctx context.Context) (Conexao, error) {
	var con Conexao
	var dc *string
	err := c.pool.QueryRow(ctx, `select coalesce(client_id, ''), coalesce(client_secret, ''), coalesce(refresh_token, ''), data_center
		  from acessos_conexoes where provedor = 'zoho'`).Scan(&con.clientID, &con.clientSecret, &con.refreshToken, &dc)
	if errors.Is(err, pgx.ErrNoRows) {
		return Conexao{}, ErrDesconectado
	}
	if err != nil {
		return Conexao{}, err
	}
	con.sufixo = ".com"
	if dc != nil && strings.TrimSpace(*dc) != "" {
		con.sufixo = "." + strings.TrimPrefix(strings.TrimSpace(*dc), ".")
	}
	if con.refreshToken == "" || !slices.Contains(dataCenters, con.sufixo) {
		return Conexao{}, ErrDesconectado
	}
	return con, nil
}

func (c *Cliente) tokenDe(ctx context.Context, con Conexao) (string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.token != "" && c.de == (chave{con.clientID, con.refreshToken, con.sufixo}) && time.Now().Before(c.ate) {
		return c.token, nil
	}
	form := url.Values{"grant_type": {"refresh_token"}, "client_id": {con.clientID}, "client_secret": {con.clientSecret},
		"refresh_token": {con.refreshToken}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.contas(con.sufixo)+"/oauth/v2/token", strings.NewReader(form.Encode()))
	if err != nil {
		return "", errors.New("zoho: sem token")
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", semResposta(ctx, "zoho: sem token (sem resposta)")
	}
	defer resp.Body.Close()
	var j struct {
		AccessToken string `json:"access_token"`
	}
	if json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&j) != nil || j.AccessToken == "" {
		return "", fmt.Errorf("zoho: sem token (status %d)", resp.StatusCode)
	}
	c.token, c.ate, c.de = j.AccessToken, time.Now().Add(50*time.Minute), chave{con.clientID, con.refreshToken, con.sufixo}
	return c.token, nil
}

func (c *Cliente) esquecer(tok string) {
	c.mu.Lock()
	if c.token == tok {
		c.token = ""
	}
	c.mu.Unlock()
}

// get: GET na API do WorkDrive com o token; token recusado (401 ou F7003) = renova e tenta UMA vez de novo.
// Fora do 2xx = *ErroHTTP (o corpo, que pode citar o token, é descartado aqui).
func (c *Cliente) get(ctx context.Context, con Conexao, caminho string) (*http.Response, error) {
	for tentativa := 0; ; tentativa++ {
		tok, err := c.tokenDe(ctx, con)
		if err != nil {
			return nil, err
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.api(con.sufixo)+caminho, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("Authorization", "Zoho-oauthtoken "+tok)
		req.Header.Set("Accept", "application/vnd.api+json")
		resp, err := c.http.Do(req)
		if err != nil { // o *url.Error traz a URL: não sai daqui
			return nil, semResposta(ctx, "zoho: sem resposta")
		}
		if resp.StatusCode/100 == 2 {
			return resp, nil
		}
		corpo, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<10))
		resp.Body.Close()
		if tentativa == 0 && (resp.StatusCode == http.StatusUnauthorized || reTokenRecusado.Match(corpo)) {
			c.esquecer(tok)
			continue
		}
		return nil, &ErroHTTP{Status: resp.StatusCode}
	}
}

// Listar: os itens de uma pasta, paginando (50 por chamada, até 5000). Leitura que falhou é erro, nunca lista vazia.
func (c *Cliente) Listar(ctx context.Context, con Conexao, pasta string) ([]Item, error) {
	var todos []Item
	for offset := 0; offset < 5000; offset += porPagina {
		resp, err := c.get(ctx, con, "/files/"+url.PathEscape(pasta)+"/files?page%5Blimit%5D="+strconv.Itoa(porPagina)+
			"&page%5Boffset%5D="+strconv.Itoa(offset))
		if err != nil {
			return nil, err
		}
		var j struct {
			Data []struct {
				ID         string `json:"id"`
				Attributes struct {
					Name     string `json:"name"`
					IsFolder bool   `json:"is_folder"`
				} `json:"attributes"`
			} `json:"data"`
		}
		err = json.NewDecoder(io.LimitReader(resp.Body, 8<<20)).Decode(&j)
		resp.Body.Close()
		if err != nil || j.Data == nil { // sem `data` (ou null) não é pasta vazia ([] é): é resposta quebrada
			return nil, errors.New("zoho: listagem ilegível")
		}
		for _, d := range j.Data {
			todos = append(todos, Item{ID: d.ID, Nome: strings.TrimSpace(d.Attributes.Name), Pasta: d.Attributes.IsFolder})
		}
		if len(j.Data) < porPagina {
			break
		}
	}
	return todos, nil
}

// Baixar: o conteúdo do arquivo `id`; quem chama fecha o corpo. Fora do 2xx = *ErroHTTP.
func (c *Cliente) Baixar(ctx context.Context, con Conexao, id string) (*http.Response, error) {
	return c.get(ctx, con, "/download/"+url.PathEscape(id))
}
