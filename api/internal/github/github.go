// Package github dispara workflows do GitHub Actions e cancela execuções com um token pessoal (PAT) que
// SÓ vem do chamador (config.GitHubPAT = GITHUB_PAT). Lista FECHADA: o pedido escolhe o nome de um
// Disparo e os valores das entradas declaradas; repositório, arquivo e ref são texto deste arquivo.
// Consumidores: fabrica (5.8), retaguardas da Vessel (5.10), Plano 6. Novo consumidor = uma entrada em
// Disparos e o caso dela em TestDispararListaFechada (Ruling 5.8-4).
package github

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"testing"
	"time"
)

// repoDoPainel: o repositório dos workflows (o GITHUB_REPO das edges). Constante: nunca do pedido.
const repoDoPainel = "rbv-co/social-dashboard"

var (
	reUUID  = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	reRunID = regexp.MustCompile(`^[0-9]{1,20}$`)

	reRepo     = regexp.MustCompile(`^[a-z0-9-]{1,39}/[a-z0-9._-]{1,100}$`)
	reWorkflow = regexp.MustCompile(`^[a-z0-9-]{1,80}\.ya?ml$`)
	reRef      = regexp.MustCompile(`^[a-z0-9][a-z0-9._/-]{0,99}$`)
)

// Disparo é um workflow que a API pode acordar. Entradas: nome do input → formato aceito (todas
// obrigatórias; nenhuma outra).
type Disparo struct {
	Repo, Workflow, Ref string
	Entradas            map[string]*regexp.Regexp
}

// Disparos: a lista fechada. 5.10: "vessel-fotos" (fotos-do-selo.yml) e "vessel-cartoes" (cartoes-ean.yml).
var Disparos = map[string]Disparo{
	"fabrica": {Repo: repoDoPainel, Workflow: "fabrica.yml", Ref: "main", Entradas: map[string]*regexp.Regexp{"job_id": reUUID}},
}

var (
	ErrSemToken     = errors.New("github: GITHUB_PAT ausente")
	ErrDesconhecido = errors.New("github: disparo fora da lista")
	ErrEntrada      = errors.New("github: entrada inválida")
)

type Classe string

const (
	TokenInvalido Classe = "token_invalido" // 401: token vencido ou revogado
	SemPermissao  Classe = "sem_permissao"  // 403: token sem "Actions: Read and write" no repositório
	NaoEncontrado Classe = "nao_encontrado" // 404: workflow fora da ref, repositório errado, token sem acesso
	Recusado      Classe = "recusado"       // 422: input que o workflow não declara, workflow sem workflow_dispatch
	Limite        Classe = "limite"         // 429 ou 403 de limite
	Indisponivel  Classe = "indisponivel"   // 5xx (menos 502/504), DNS, conexão recusada: o pedido NÃO foi aceito
	Incerto       Classe = "incerto"        // sem resposta depois de conectar, 502 ou 504: pode ter sido aceito
	Inesperado    Classe = "inesperado"     // 3xx (não seguimos) ou status fora da lista
)

// Erro: a falha classificada. Nunca carrega URL, token nem o corpo do GitHub.
type Erro struct {
	Classe     Classe
	Status     int           // 0 = sem resposta
	EsperarAte time.Duration // só em Limite
}

func (e *Erro) Error() string { return fmt.Sprintf("github: %s (%d)", e.Classe, e.Status) }

// Cliente fala com a API REST do GitHub. Zero valor não serve: use Novo.
type Cliente struct {
	token string
	base  string // https://api.github.com; só os testes deste pacote trocam
	http  *http.Client
}

func Novo(token string) *Cliente {
	return &Cliente{token: strings.TrimSpace(token), base: "https://api.github.com", http: &http.Client{
		Timeout: 15 * time.Second,
		// nunca segue: o Authorization não pode ir a outro host (3xx vira Inesperado)
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// ParaTeste: o cliente falando com um GitHub de mentira (httptest) — para os testes de outros pacotes
// (fabrica, 5.10). Base que não é loopback derruba o teste: nunca aponta para um host de verdade.
func ParaTeste(t testing.TB, token, base string) *Cliente {
	t.Helper()
	if !loopback(base) {
		t.Fatalf("github.ParaTeste: base %q não é loopback", base)
	}
	c := Novo(token)
	c.base = strings.TrimRight(base, "/")
	return c
}

func loopback(base string) bool {
	u, err := url.Parse(base)
	return err == nil && u.Scheme == "http" && (u.Hostname() == "127.0.0.1" || u.Hostname() == "::1" || u.Hostname() == "localhost")
}

// Configurado: há token. Sem ele, quem chama responde 503 ANTES de gravar qualquer coisa.
func (c *Cliente) Configurado() bool { return c != nil && c.token != "" }

func (d Disparo) conferir(entradas map[string]string) error {
	if !slices.Equal(slices.Sorted(maps.Keys(entradas)), slices.Sorted(maps.Keys(d.Entradas))) {
		return ErrEntrada
	}
	for k, v := range entradas {
		if !d.Entradas[k].MatchString(v) {
			return ErrEntrada
		}
	}
	return nil
}

// Disparar acorda o workflow `nome` com as entradas. Sem repetição: quem chama decide o que fazer
// com cada classe (Ruling 5.8-5).
func (c *Cliente) Disparar(ctx context.Context, nome string, entradas map[string]string) error {
	d, ok := Disparos[nome]
	if !ok {
		return ErrDesconhecido
	}
	if err := d.conferir(entradas); err != nil {
		return err
	}
	if !c.Configurado() {
		return ErrSemToken
	}
	corpo := map[string]any{"ref": d.Ref}
	if len(entradas) > 0 {
		corpo["inputs"] = entradas
	}
	j, err := json.Marshal(corpo)
	if err != nil {
		return err
	}
	return c.chamar(ctx, "/repos/"+d.Repo+"/actions/workflows/"+d.Workflow+"/dispatches", j)
}

// Cancelar pede o cancelamento da execução runID (lida do banco, gravada pelo robô) no repositório do
// disparo `nome`. Execução já terminada (409) conta como cancelada.
func (c *Cliente) Cancelar(ctx context.Context, nome, runID string) error {
	d, ok := Disparos[nome]
	if !ok {
		return ErrDesconhecido
	}
	if !reRunID.MatchString(runID) {
		return ErrEntrada
	}
	if !c.Configurado() {
		return ErrSemToken
	}
	err := c.chamar(ctx, "/repos/"+d.Repo+"/actions/runs/"+runID+"/cancel", nil)
	var e *Erro
	if errors.As(err, &e) && e.Status == http.StatusConflict {
		return nil
	}
	return err
}

func (c *Cliente) chamar(ctx context.Context, caminho string, corpo []byte) error {
	var leitor io.Reader = http.NoBody
	if corpo != nil {
		leitor = bytes.NewReader(corpo)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.base+caminho, leitor)
	if err != nil {
		return &Erro{Classe: Inesperado}
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", "api-central")
	if corpo != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return semResposta(err)
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, io.LimitReader(resp.Body, 64<<10)) // o corpo do GitHub não sai daqui
	return classificar(resp)
}

func classificar(resp *http.Response) error {
	s := resp.StatusCode
	limite := resp.Header.Get("X-RateLimit-Remaining") == "0" || resp.Header.Get("Retry-After") != ""
	switch {
	case s >= 200 && s < 300:
		return nil
	case s == http.StatusTooManyRequests || (s == http.StatusForbidden && limite):
		return &Erro{Classe: Limite, Status: s, EsperarAte: esperar(resp.Header)}
	case s == http.StatusUnauthorized:
		return &Erro{Classe: TokenInvalido, Status: s}
	case s == http.StatusForbidden:
		return &Erro{Classe: SemPermissao, Status: s}
	case s == http.StatusNotFound:
		return &Erro{Classe: NaoEncontrado, Status: s}
	case s == http.StatusUnprocessableEntity:
		return &Erro{Classe: Recusado, Status: s}
	case s == http.StatusBadGateway || s == http.StatusGatewayTimeout:
		// o gateway pode estourar o prazo DEPOIS de o GitHub aceitar o disparo: incerto, nunca repetir sozinho
		return &Erro{Classe: Incerto, Status: s}
	case s >= 500:
		return &Erro{Classe: Indisponivel, Status: s}
	}
	return &Erro{Classe: Inesperado, Status: s}
}

func esperar(h http.Header) time.Duration {
	if n, err := strconv.Atoi(h.Get("Retry-After")); err == nil && n >= 0 {
		return time.Duration(n) * time.Second
	}
	if n, err := strconv.ParseInt(h.Get("X-RateLimit-Reset"), 10, 64); err == nil {
		if d := time.Until(time.Unix(n, 0)); d > 0 {
			return d
		}
	}
	return time.Minute
}

// semResposta: DNS e conexão recusada = o pedido não saiu; o resto (prazo, conexão caída) = incerto.
// O *url.Error (que tem o host e o caminho) não sai daqui.
func semResposta(err error) error {
	var dns *net.DNSError
	if errors.As(err, &dns) || errors.Is(err, syscall.ECONNREFUSED) {
		return &Erro{Classe: Indisponivel}
	}
	return &Erro{Classe: Incerto}
}
