# Sair do Supabase — Plano 3: edges que o core já cobre (Bling, Meta, push de vendas e webhooks)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `api-go-edges`** (branch `feat/api-go-edges`, empilhada sobre `feat/api-go-postgres-ensaio` = PR #334); nunca na `main`. Faça `git add` só dos caminhos de cada task.

**Goal:** Portar para a API em Go (`api/`) as edge functions que são fachadas do `core` — `bling-proxy` (com a regra de canais por loja portada uma vez e exposta em `GET /eu/canais`), `meta-proxy`, os coletores Meta "ao vivo", `enviar-push-vendas` (worker, 07h/22h) e os receptores de webhook da Shopify e do Chatwoot —, sem a API nunca chamar Bling/Meta direto.

**Architecture:** Um pacote `internal/core` é o único cliente HTTP do core (`POST /api/interno/bling/proxy` e `POST /api/interno/meta/graph`, Bearer `CORE_API_TOKEN`), com a política de repetição medida em produção (`_shared/tentar-de-novo.js`) e sem nunca repetir escrita. Cada edge vira um handler com o **mesmo nome, corpo e resposta** da edge (`POST /bling-proxy`, `/meta-proxy`, ...), atrás de `auth.Exigir` + o portão que a edge usa hoje (`Ator.PodeModulo`: `role = 'admin'` ou módulo em `profiles.features`). Os webhooks são rotas públicas com HMAC/segredo em tempo constante, limite por IP e deduplicação por `X-Shopify-Event-Id` gravada na mesma transação do efeito. O push de vendas é uma tarefa do worker, com Web Push (RFC 8291/8292) feito só com a biblioteca padrão.

**Tech Stack:** Go 1.26 (`go.mod`; toolchain local 1.27), `chi`, `pgx` v5, `goose`, Postgres 17 (testes em contêiner), `net/http/httptest` para o core, a Graph e o serviço de push de mentira.

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§4 conta de serviço, §5 regra de canais e rotas públicas, §8 mapa das edges, §8.1 agenda, §11 segurança, §14 rate gate do Bling) e `docs/migracao-go/RESULTADO-DO-LEVANTAMENTO.md` (agenda real, `estoque-do-site` desligado, nomes de segredos).

## Global Constraints

- **Nada em produção é tocado por este plano.** Sem `ssh`, sem credencial real, sem `push`. Testes usam só servidores `httptest` e Postgres local descartável; segredos nos testes são textos inventados.
- **A API nunca chama Bling, Meta ou Shopify direto:** só o core (`CORE_URL`, padrão `https://core.rbvcompany.com`), com o contrato da seção "Contrato do core". O rate gate de 3 req/s por conta Bling é do core (spec §14).
- **Contrato HTTP de cada rota portada = o da edge** (nome da rota, corpo de entrada, corpo e status de saída, textos de erro), exceto 401/403 de sessão, que usam o formato do núcleo (`{"error":"nao_autenticado"}`/`{"error":"sem_permissao"}`).
- **Negar por padrão:** toda rota nova fica atrás de `auth.Exigir` + portão, ou na lista pública explícita (os 5 webhooks), com limite de taxa e autenticação por assinatura/segredo. Segredo vazio = 401 em tudo.
- **Segredos (`CORE_API_TOKEN`, segredos de webhook, VAPID) nunca aparecem em log, erro ou resposta.** Cada task que os toca tem teste que captura o `slog` e procura o segredo.
- **Sem dependência nova:** só biblioteca padrão e o que já está no `go.sum` (`golang.org/x/text` passa de indireta a direta). `go.mod` fica em `go 1.26.0` (APIs usadas: `crypto/hkdf` 1.24; `ecdsa.ParseRawPrivateKey`, `PublicKey.Bytes`, `PrivateKey.Bytes`, `sync.WaitGroup.Go` 1.25).
- **Gate real:** `make -C api teste PG_PORTA=58432` (CI do GitHub bloqueado por billing). Teste de banco que **pula** (sem `TEST_DATABASE_URL`) **não é aprovação**: rode com `-v` e confira que não há `--- SKIP`.
- Em teste, parâmetro SQL usado como `uuid` e como texto na mesma consulta precisa de cast explícito (`$1::uuid`, `$1::text || '@x'`): sem isso o insert falha calado e o teste mente.
- Cada commit termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Código, comentários e mensagens em português com acentuação correta (mensagens de erro copiadas das edges ficam como na edge, sem acento, porque o front compara texto).
- Comandos `go` rodam em `api/`; `git` na raiz da worktree.

## Review Focus

1. **`params` do bling-proxy montado à mão pelo front** (objeto aninhado, `null`, lista de um item, número) → a mesma `query` que a edge mandava ao core (objeto vira o texto "[object Object]" (String() do JS, como a edge), lista de um vira texto, `null` some, número vira o literal). Teste: `TestBlingProxyRepassaOContrato` (Task 3).
2. **`accountId` numérico × texto no meta-proxy** (o front manda os dois) → ambos acham a conta (`id::text = $1`). Teste: último caso de `TestMetaProxyMontaOPedidoDoCore` (Task 4).
3. **Cabeçalho de assinatura da Shopify com base64 inválido ou espaços nas pontas** → 401 sem pânico / aceito depois de aparar. Teste: `TestShopifyAssinatura` (Task 7).
4. **Pedido do Bling com `loja.id` em texto ou sem `loja`, para quem está limitado** → texto e número casam; sem loja é negado, nunca "de todo mundo". Teste: `TestRecortar` (Task 2).
5. **Inscrição de push com chave malformada no meio das boas** → é pulada e as outras recebem. Teste: `TestPushVendasInscricaoRuimNaoDerrubaAsOutras` (Task 6).

---

## Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/api-go-edges && git status --short` → vazio; `git branch --show-current` → `feat/api-go-edges`.
- [ ] `go version` → `go1.26` ou mais novo.
- [ ] `ls "$(go env GOMODCACHE)/golang.org/x/text@v0.43.0" >/dev/null && echo ok` → `ok` (já está no `go.sum`; sem rede).
- [ ] Docker no ar e porta livre: `lsof -iTCP:58432 -sTCP:LISTEN` → vazio (55432/55433 estão ocupadas por outras sessões).
- [ ] Banco das etapas (fica no ar até a verificação final):
  ```bash
  docker run -d --rm --name pg-plano3 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58432:5432 postgres:17
  until docker exec pg-plano3 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58432/postgres?sslmode=disable'
  ```
  Toda etapa "Run" abaixo assume `TEST_DATABASE_URL` exportada e o diretório `api/`.
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

## Contrato do core (referência para todas as tasks)

Fonte: repositório `vessel-core-go`, commit `168882e29` (lido em 2026-10-10; ver Ruling da lacuna). As edges de hoje já falam esse contrato quando `CORE_BLING_PROXY`/`CORE_META` estão ligadas.

| | Bling | Meta |
|---|---|---|
| Rota | `POST {CORE_URL}/api/interno/bling/proxy` (`services/core/routes/api.php:48`) | `POST {CORE_URL}/api/interno/meta/graph` (`routes/api.php:69-72`) |
| Autenticação | `Authorization: Bearer <CORE_API_TOKEN>`; sem token válido `401 {"erro":"nao_autorizado"}`, escopo errado `403 {"erro":"escopo_negado"}`, acima do limite por consumidor (600/min Bling, 120/min Meta) `429 {"erro":"limite_excedido"}` + `Retry-After` — **sem** `X-Core-Origem` (`app/Http/Middleware/AutenticaConsumidor.php:26,30,40-41`) | igual |
| Corpo | `{metodo, caminho, query?, corpo?, prioridade?, idempotency_key?}`; `caminho` começa com `/`, só `[A-Za-z0-9_-]` por segmento (`BlingProxyController.php:34-43`); `query` é objeto (valor único = texto, repetido = lista, como `_shared/core-bling-proxy.js:128-130` monta) | `{conta?, caminho, metodo, parametros, imagem_url?, imagem_campo?, video_url?}` (`docs/migracao-core/API-META.md:28-34`); `parametros` ≤ 64 KB (413) |
| Resposta repassada | status, corpo, `Content-Type` e `Retry-After` do Bling, com `X-Core-Origem: bling` (`BlingProxyController.php:168-178`) | status e corpo da Graph; `access_token` mascarado como `***` em URLs (`API-META.md:35`) |
| Erros do próprio core | `X-Core-Origem: proxy` + `{erro}`: `caminho_nao_permitido` 403, `requisicao_invalida` 422, `reautorizacao_necessaria` 409, `bling_indisponivel`/`resultado_incerto` 504, `em_andamento` 409, `chave_reutilizada` 422 (`BlingProxyController.php:50,74,83,183-189`; `PROXY-BLING.md:3-8`) | `{erro}`: `caminho ou metodo nao permitido` 400, `parametros grandes demais` 413, `meta_em_recuo` 429 + `Retry-After`, `falha ao falar com a Meta` 502 (`MetaGraphController.php:47,50,90,92`) |
| Repetição no cliente | GET: 429/5xx/sem resposta, até 3 tentativas, 600/1200 ms ou `Retry-After`, 11 s por tentativa, 25 s no total (`_shared/tentar-de-novo.js:49-115`); escrita **nunca** (`PROXY-BLING.md:21-34`) | só 429, até 3 tentativas, `Retry-After` (padrão 5 s, teto 30 s) (`_shared/core-meta.js:24-25,50`); 5xx/rede nunca em POST (`API-META.md:43`) |
| Webhooks Shopify (fan-out) | o core recebe `POST /api/webhooks/shopify` e repassa o corpo **cru** a cada destino, **reassinado** em `X-Shopify-Hmac-Sha256` com o segredo do destino, preservando `X-Shopify-Topic`, `-Event-Id`, `-Webhook-Id`, `-Shop-Domain`, `-Api-Version`; reentrega em 1/5/15/60/240 min e depois fila de falhas (`docs/migracao-core/SHOPIFY.md:124-135`). Hoje dormente (`CORE_SHOPIFY_FANOUT=false`). | — |

## Estrutura de arquivos

```
api/internal/config/config.go            # + CORE_URL, CORE_API_TOKEN, HOSTS_DE_MIDIA, SHOPIFY_WEBHOOK_SEGREDOS, CHATWOOT_WEBHOOK_SEGREDO, VAPID_*
api/internal/core/core.go                 # cliente do core: Bling (com repetição) e Meta (429)
api/internal/core/repetir.go              # política de tentar-de-novo.js
api/internal/auth/ator.go                 # + Ator.Modulos (profiles.features)
api/internal/auth/pode.go                 # + Ator.PodeModulo (portão das edges)
api/internal/auth/middleware.go           # + ExigirModulo, LimitarPorIP
api/internal/testebanco/testebanco.go     # profiles + features, escopo_por_equipe
api/internal/canais/canais.go             # regra de canais por loja + recorte da resposta do Bling
api/internal/canais/banco.go              # Carregar (escopo do banco) + GET /eu/canais
api/internal/comercial/bling.go           # POST /bling-proxy
api/internal/comercial/vendas.go          # data da nota, valor corrigido, agregação, corpo do push
api/internal/comercial/push_vendas.go     # tarefas push-vendas-07h / -22h
api/internal/webpush/webpush.go           # RFC 8291 (aes128gcm) + VAPID (RFC 8292), só biblioteca padrão
api/internal/meta/proxy.go                # POST /meta-proxy
api/internal/meta/ao_vivo.go              # POST /insights-ao-vivo, /serie-novos-dia, /contar-collabs
api/internal/banco/migracoes/00002_webhooks_recebidos.sql
api/internal/webhooks/shopify.go          # HMAC, deduplicação, pedido e checkout
api/internal/webhooks/abandono.go         # decisões do abandono + chamadas às funções SQL
api/internal/webhooks/chatwoot.go         # segredo em tempo constante, evento de CRM e opt-out
api/internal/web/rotas.go                 # montagem: públicas × Exigir
api/cmd/api/main.go                       # worker registra o push de vendas
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md  # variáveis, nginx, virada
```

## Tarefas

| # | Task | Revisor |
|---|---|---|
| 1 | Configuração e cliente do core | padrão |
| 2 | Portão das edges (`PodeModulo`) e regra de canais por loja + `GET /eu/canais` | **opus (autorização)** |
| 3 | `POST /bling-proxy` | **opus (autorização, allow-list)** |
| 4 | `POST /meta-proxy` | **opus (autorização, SSRF)** |
| 5 | Coletores Meta ao vivo | padrão |
| 6 | Web Push e push de vendas no worker | **opus (cripto, SSRF)** |
| 7 | Webhooks da Shopify | **opus (HMAC, replay)** |
| 8 | Webhooks do Chatwoot | **opus (segredo)** |
| 9 | Montagem das rotas, limite por IP, worker e notas de implantação | **opus (fronteira pública)** |

Ordem: 1 → 9 em sequência (cada task usa nomes da anterior, ver "Interfaces").

---

### Task 1: Configuração e cliente do core

**Revisor:** padrão.

**Files:**
- Modify: `api/internal/config/config.go` (arquivo inteiro abaixo)
- Modify: `api/internal/config/config_test.go` (acrescentar 2 testes)
- Create: `api/internal/core/core.go`
- Create: `api/internal/core/repetir.go`
- Test: `api/internal/core/core_test.go`, `api/internal/core/repetir_test.go`

**Interfaces:**
- Consumes: nada novo.
- Produces:
  - `config.Config` ganha `CoreURL, CoreToken string; HostsDeMidia, ShopifySegredos []string; ChatwootSegredo, VAPIDPublica, VAPIDPrivada, VAPIDAssunto string` (`CoreURL` sem barra final, padrão `https://core.rbvcompany.com`).
  - `core.Novo(url, token string) *core.Cliente` (não segue redirecionamento).
  - `type core.Cliente struct { URL, Token string; HTTP *http.Client; Prazo, Orcamento time.Duration; Dormir func(context.Context, time.Duration) error }` — `Prazo`/`Orcamento` zero = 11 s/25 s; `Dormir` nil = espera de verdade (os testes trocam).
  - `func (c *Cliente) Bling(ctx context.Context, p core.PedidoBling) (*core.Resposta, error)` — GET repete; outro método sai uma vez.
  - `func (c *Cliente) Meta(ctx context.Context, p core.PedidoMeta, tentativas int) (*core.Resposta, error)` — só repete 429.
  - `type core.Resposta struct { Status int; Corpo []byte; RetryAfter, Origem string }` (`Origem` = `X-Core-Origem`).
  - `type core.PedidoBling struct { Metodo, Caminho string; Query map[string]any }`; `type core.PedidoMeta struct { Caminho, Metodo string; Parametros map[string]any; ImagemURL, ImagemCampo, VideoURL string }`.
  - `var core.ErrSemToken`; `type core.SemResposta struct { Causa string; Tentativas int }` (o `Error()` é a frase de `fraseDeDesistencia`).

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao fim de `api/internal/config/config_test.go`:

```go
func TestCarregarVariaveisDoPlano3(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("CORE_URL", " https://core.exemplo/ ")
	t.Setenv("CORE_API_TOKEN", "tok")
	t.Setenv("HOSTS_DE_MIDIA", "a.exemplo, b.exemplo")
	t.Setenv("SHOPIFY_WEBHOOK_SEGREDOS", "s1,,s2")
	t.Setenv("CHATWOOT_WEBHOOK_SEGREDO", "cw")
	t.Setenv("VAPID_PUBLIC_KEY", "pub")
	t.Setenv("VAPID_PRIVATE_KEY", "priv")
	t.Setenv("VAPID_SUBJECT", "mailto:x@exemplo")
	c, err := Carregar()
	if err != nil {
		t.Fatal(err)
	}
	if c.CoreURL != "https://core.exemplo" || c.CoreToken != "tok" {
		t.Fatalf("core = %q %q", c.CoreURL, c.CoreToken)
	}
	if len(c.HostsDeMidia) != 2 || c.HostsDeMidia[1] != "b.exemplo" {
		t.Fatalf("HostsDeMidia = %#v", c.HostsDeMidia)
	}
	if len(c.ShopifySegredos) != 2 || c.ShopifySegredos[1] != "s2" {
		t.Fatalf("ShopifySegredos = %#v", c.ShopifySegredos)
	}
	if c.ChatwootSegredo != "cw" || c.VAPIDPublica != "pub" || c.VAPIDPrivada != "priv" || c.VAPIDAssunto != "mailto:x@exemplo" {
		t.Fatalf("config = %+v", c)
	}
}

func TestCarregarCoreURLPadrao(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("CORE_URL", "")
	c, _ := Carregar()
	if c.CoreURL != "https://core.rbvcompany.com" {
		t.Fatalf("CoreURL = %q", c.CoreURL)
	}
}
```

Crie `api/internal/core/repetir_test.go`:

```go
package core

import (
	"testing"
	"time"
)

func TestDecidir(t *testing.T) {
	const p, o = 11 * time.Second, 25 * time.Second
	casos := []struct {
		nome                  string
		tentativa, status     int
		decorrido, retryAfter time.Duration
		repetir               bool
		esperar               time.Duration
	}{
		{"deu certo", 1, 200, 0, 0, false, 0},
		{"404 é resposta", 1, 404, 0, 0, false, 0},
		{"403 é resposta", 1, 403, 0, 0, false, 0},
		{"429 repete", 1, 429, 0, 0, true, 600 * time.Millisecond},
		{"429 obedece Retry-After maior", 1, 429, 0, 3 * time.Second, true, 3 * time.Second},
		{"Retry-After menor não encurta", 2, 429, 0, time.Second, true, 1200 * time.Millisecond},
		{"500 repete", 2, 500, 0, 0, true, 1200 * time.Millisecond},
		{"sem resposta repete", 1, 0, 0, 0, true, 600 * time.Millisecond},
		{"terceira não repete", 3, 503, 0, 0, false, 0},
		{"não cabe no orçamento", 1, 0, 14 * time.Second, 0, false, 0},
	}
	for _, c := range casos {
		d := decidir(c.tentativa, c.status, c.decorrido, c.retryAfter, p, o)
		if d.repetir != c.repetir || d.esperar != c.esperar || d.motivo == "" {
			t.Errorf("%s: %+v", c.nome, d)
		}
	}
}
```

Crie `api/internal/core/core_test.go` (core de mentira com `httptest`: contrato, 429 com `Retry-After`, 5xx com recuo, 4xx não repete, lentidão, orçamento, escrita nunca repete, sem token, token fora de erro e log, resposta grande, Meta só repete 429, sem redirecionamento):

```go
package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

const tokenDeTeste = "segredo-do-core-123"

// coreFalso responde com `resp(n, corpo)` para a n-ésima chamada (1, 2, ...) e guarda o que recebeu.
type coreFalso struct {
	mu      sync.Mutex
	corpos  []map[string]any
	cabecas []http.Header
	caminho []string
}

func (f *coreFalso) n() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.corpos) }

func novoCore(t *testing.T, resp func(n int, w http.ResponseWriter, r *http.Request)) (*Cliente, *coreFalso, *[]time.Duration) {
	t.Helper()
	f := &coreFalso{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var m map[string]any
		json.NewDecoder(r.Body).Decode(&m)
		f.mu.Lock()
		f.corpos = append(f.corpos, m)
		f.cabecas = append(f.cabecas, r.Header.Clone())
		f.caminho = append(f.caminho, r.Method+" "+r.URL.Path)
		n := len(f.corpos)
		f.mu.Unlock()
		resp(n, w, r)
	}))
	t.Cleanup(srv.Close)
	esperas := &[]time.Duration{}
	c := Novo(srv.URL, tokenDeTeste)
	c.Prazo = 200 * time.Millisecond
	c.Dormir = func(_ context.Context, d time.Duration) error { *esperas = append(*esperas, d); return nil }
	return c, f, esperas
}

func status(cod int, corpo string, cab ...string) func(int, http.ResponseWriter, *http.Request) {
	return func(_ int, w http.ResponseWriter, _ *http.Request) {
		for i := 0; i+1 < len(cab); i += 2 {
			w.Header().Set(cab[i], cab[i+1])
		}
		w.WriteHeader(cod)
		io.WriteString(w, corpo)
	}
}

// sequencia responde a n-ésima chamada com resps[n-1] (a última se repete).
func sequencia(resps ...func(int, http.ResponseWriter, *http.Request)) func(int, http.ResponseWriter, *http.Request) {
	return func(n int, w http.ResponseWriter, r *http.Request) {
		resps[min(n, len(resps))-1](n, w, r)
	}
}

// pendurar segura a resposta até o cliente desistir (simula core lento).
func pendurar(_ int, _ http.ResponseWriter, r *http.Request) {
	select {
	case <-r.Context().Done():
	case <-time.After(5 * time.Second):
	}
}

var leitura = PedidoBling{Metodo: "GET", Caminho: "/pedidos/vendas", Query: map[string]any{"pagina": "1", "idsSituacoes[]": []string{"9", "12"}}}

func TestBlingMandaOContratoDoCore(t *testing.T) {
	c, f, _ := novoCore(t, status(200, `{"data":[]}`, "X-Core-Origem", "bling"))
	r, err := c.Bling(context.Background(), leitura)
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != 200 || string(r.Corpo) != `{"data":[]}` || r.Origem != "bling" {
		t.Fatalf("resposta = %+v", r)
	}
	if f.caminho[0] != "POST "+CaminhoBling {
		t.Fatalf("chamou %s", f.caminho[0])
	}
	if got := f.cabecas[0].Get("Authorization"); got != "Bearer "+tokenDeTeste {
		t.Fatalf("Authorization = %q", got)
	}
	b, _ := json.Marshal(f.corpos[0])
	if string(b) != `{"caminho":"/pedidos/vendas","metodo":"GET","query":{"idsSituacoes[]":["9","12"],"pagina":"1"}}` {
		t.Fatalf("corpo = %s", b)
	}
}

func TestBlingRepete429RespeitandoRetryAfter(t *testing.T) {
	c, f, esperas := novoCore(t, sequencia(status(429, `{}`, "Retry-After", "2"), status(200, `{"data":[1]}`)))
	r, err := c.Bling(context.Background(), leitura)
	if err != nil || r.Status != 200 {
		t.Fatalf("r=%+v err=%v", r, err)
	}
	if f.n() != 2 || len(*esperas) != 1 || (*esperas)[0] != 2*time.Second {
		t.Fatalf("chamadas=%d esperas=%v", f.n(), *esperas)
	}
}

func TestBlingRepete5xxComRecuoEDevolveOUltimo(t *testing.T) {
	c, f, esperas := novoCore(t, status(503, `{"erro":"bling_indisponivel"}`))
	r, err := c.Bling(context.Background(), leitura)
	if err != nil {
		t.Fatal(err)
	}
	if r.Status != 503 || f.n() != 3 {
		t.Fatalf("status=%d chamadas=%d", r.Status, f.n())
	}
	if len(*esperas) != 2 || (*esperas)[0] != 600*time.Millisecond || (*esperas)[1] != 1200*time.Millisecond {
		t.Fatalf("esperas = %v", *esperas)
	}
}

func TestBlingNaoRepeteResposta(t *testing.T) {
	for _, cod := range []int{400, 403, 404, 409, 422} {
		c, f, _ := novoCore(t, status(cod, `{}`))
		r, err := c.Bling(context.Background(), leitura)
		if err != nil || r.Status != cod || f.n() != 1 {
			t.Errorf("%d: r=%+v err=%v chamadas=%d", cod, r, err, f.n())
		}
	}
}

func TestBlingLentoDesisteComFraseDeGente(t *testing.T) {
	c, f, _ := novoCore(t, pendurar)
	c.Prazo = 50 * time.Millisecond
	_, err := c.Bling(context.Background(), leitura)
	var sr *SemResposta
	if !errors.As(err, &sr) {
		t.Fatalf("err = %v", err)
	}
	if f.n() != 3 || !strings.Contains(err.Error(), "não respondeu no prazo") || !strings.Contains(err.Error(), "Tentei 3 vezes") {
		t.Fatalf("chamadas=%d err=%q", f.n(), err)
	}
}

func TestBlingNaoComecaTentativaQueNaoCabeNoOrcamento(t *testing.T) {
	c, f, _ := novoCore(t, status(503, `{}`))
	c.Prazo, c.Orcamento = 100*time.Millisecond, 650*time.Millisecond // 600 ms + 100 ms > 650 ms
	r, err := c.Bling(context.Background(), leitura)
	if err != nil || r.Status != 503 || f.n() != 1 {
		t.Fatalf("r=%+v err=%v chamadas=%d", r, err, f.n())
	}
}

func TestBlingEscritaNuncaRepete(t *testing.T) {
	escrita := PedidoBling{Metodo: "POST", Caminho: "/pedidos/vendas"}
	c, f, _ := novoCore(t, status(503, `{}`))
	if r, err := c.Bling(context.Background(), escrita); err != nil || r.Status != 503 || f.n() != 1 {
		t.Fatalf("5xx: r=%+v err=%v chamadas=%d", r, err, f.n())
	}
	c2, f2, _ := novoCore(t, pendurar)
	c2.Prazo = 50 * time.Millisecond
	if _, err := c2.Bling(context.Background(), escrita); err == nil || f2.n() != 1 {
		t.Fatalf("prazo: err=%v chamadas=%d", err, f2.n())
	}
}

func TestSemTokenNaoChamaNada(t *testing.T) {
	c, f, _ := novoCore(t, status(200, `{}`))
	c.Token = ""
	if _, err := c.Bling(context.Background(), leitura); !errors.Is(err, ErrSemToken) {
		t.Fatalf("bling err = %v", err)
	}
	if _, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 3); !errors.Is(err, ErrSemToken) {
		t.Fatalf("meta err = %v", err)
	}
	if f.n() != 0 {
		t.Fatalf("chamou o core %d vezes", f.n())
	}
}

func TestSegredoNuncaApareceEmErroNemEmLog(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })

	c, _, _ := novoCore(t, pendurar)
	c.Prazo = 30 * time.Millisecond
	_, err1 := c.Bling(context.Background(), leitura) // repete (loga) e desiste
	srv := httptest.NewServer(http.NotFoundHandler())
	srv.Close() // porta fechada: erro de rede
	c2 := Novo(srv.URL, tokenDeTeste)
	_, err2 := c2.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
	if err1 == nil || err2 == nil {
		t.Fatalf("esperava erros: %v / %v", err1, err2)
	}
	for _, s := range []string{err1.Error(), err2.Error(), log.String()} {
		if strings.Contains(s, tokenDeTeste) {
			t.Fatalf("o token vazou: %q", s)
		}
	}
	if !strings.Contains(log.String(), "repetindo") {
		t.Fatal("o teste não exercitou o log de repetição")
	}
}

func TestRespostaGrandeDemaisEhRecusada(t *testing.T) {
	antes := limiteResposta
	limiteResposta = 10
	t.Cleanup(func() { limiteResposta = antes })
	c, _, _ := novoCore(t, status(200, `{"data":"12345678901234567890"}`))
	if _, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1); err == nil || !strings.Contains(err.Error(), "grande demais") {
		t.Fatalf("err = %v", err)
	}
}

func TestMetaSoRepete429(t *testing.T) {
	c, f, esperas := novoCore(t, sequencia(status(429, `{"erro":"meta_em_recuo"}`, "Retry-After", "7"), status(200, `{"id":"1"}`)))
	r, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/act_1/campaigns", Metodo: "POST"}, 3)
	if err != nil || r.Status != 200 || f.n() != 2 || (*esperas)[0] != 7*time.Second {
		t.Fatalf("r=%+v err=%v chamadas=%d esperas=%v", r, err, f.n(), *esperas)
	}
	c2, f2, _ := novoCore(t, status(500, `{"erro":"x"}`))
	if r, _ := c2.Meta(context.Background(), PedidoMeta{Caminho: "/act_1/campaigns", Metodo: "POST"}, 3); r.Status != 500 || f2.n() != 1 {
		t.Fatalf("5xx repetiu: chamadas=%d", f2.n())
	}
	c3, f3, esperas3 := novoCore(t, status(429, `{}`)) // sem Retry-After: 5 s; tentativas=1: não repete
	if r, _ := c3.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1); r.Status != 429 || f3.n() != 1 || len(*esperas3) != 0 {
		t.Fatalf("tentativas=1: chamadas=%d", f3.n())
	}
	c4, _, esperas4 := novoCore(t, sequencia(status(429, `{}`, "Retry-After", "99"), status(200, `{}`)))
	c4.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 2)
	if (*esperas4)[0] != 30*time.Second {
		t.Fatalf("teto de espera = %v", *esperas4)
	}
}

func TestMetaParametrosVazioViraObjeto(t *testing.T) {
	c, f, _ := novoCore(t, status(200, `{}`))
	c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
	if p, ok := f.corpos[0]["parametros"].(map[string]any); !ok || len(p) != 0 {
		t.Fatalf("parametros = %#v", f.corpos[0]["parametros"])
	}
}

func TestNaoSegueRedirecionamento(t *testing.T) {
	c, f, _ := novoCore(t, status(302, ``, "Location", "https://outro.exemplo/roubar"))
	r, err := c.Meta(context.Background(), PedidoMeta{Caminho: "/me", Metodo: "GET"}, 1)
	if err != nil || r.Status != 302 || f.n() != 1 {
		t.Fatalf("r=%+v err=%v", r, err)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/config/ ./internal/core/ -v`
Expected: FAIL de compilação (`undefined: Novo`, `undefined: decidir`, `c.CoreURL undefined`).

- [ ] **Step 3: Implementar**

Substitua `api/internal/config/config.go` por:

```go
// Package config lê a configuração do processo a partir de variáveis de ambiente.
package config

import (
	"errors"
	"os"
	"strings"
)

type Config struct {
	Addr        string
	DatabaseURL string
	Origens     []string // CORS: usado quando as rotas públicas entrarem (plano da Vessel)

	// Plano 3 (edges do core). Todos opcionais na carga: a rota que precisa e não tem
	// responde 503 (core) ou 401 (webhook); nunca sobe "aberta".
	CoreURL         string   // CORE_URL; padrão https://core.rbvcompany.com
	CoreToken       string   // CORE_API_TOKEN: Bearer deste consumidor no core
	HostsDeMidia    []string // HOSTS_DE_MIDIA: hosts de onde o meta-proxy aceita imagem/vídeo
	ShopifySegredos []string // SHOPIFY_WEBHOOK_SEGREDOS: admin, app e o do destino no fan-out do core
	ChatwootSegredo string   // CHATWOOT_WEBHOOK_SEGREDO
	VAPIDPublica    string   // VAPID_PUBLIC_KEY (base64url, 65 bytes)
	VAPIDPrivada    string   // VAPID_PRIVATE_KEY (base64url, 32 bytes)
	VAPIDAssunto    string   // VAPID_SUBJECT (ex.: mailto:...)
}

// lista lê uma variável separada por vírgulas, sem itens vazios.
func lista(nome string) []string {
	var out []string
	for _, o := range strings.Split(os.Getenv(nome), ",") {
		if o = strings.TrimSpace(o); o != "" {
			out = append(out, o)
		}
	}
	return out
}

func Carregar() (Config, error) {
	c := Config{
		Addr:            os.Getenv("ADDR"),
		DatabaseURL:     os.Getenv("DATABASE_URL"),
		Origens:         lista("ORIGENS_PERMITIDAS"),
		CoreURL:         strings.TrimRight(strings.TrimSpace(os.Getenv("CORE_URL")), "/"),
		CoreToken:       os.Getenv("CORE_API_TOKEN"),
		HostsDeMidia:    lista("HOSTS_DE_MIDIA"),
		ShopifySegredos: lista("SHOPIFY_WEBHOOK_SEGREDOS"),
		ChatwootSegredo: os.Getenv("CHATWOOT_WEBHOOK_SEGREDO"),
		VAPIDPublica:    os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivada:    os.Getenv("VAPID_PRIVATE_KEY"),
		VAPIDAssunto:    os.Getenv("VAPID_SUBJECT"),
	}
	if c.Addr == "" {
		c.Addr = ":8080"
	}
	if c.CoreURL == "" {
		c.CoreURL = "https://core.rbvcompany.com"
	}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL ausente")
	}
	return c, nil
}
```

Crie `api/internal/core/repetir.go`:

```go
package core

import "time"

type decisao struct {
	repetir bool
	esperar time.Duration
	motivo  string
}

// decidir é a política de supabase/functions/_shared/tentar-de-novo.js (medida em 18/08/2026):
// 404/403/4xx é RESPOSTA e não se repete; 429, 5xx e "sem resposta" (status 0) se repetem
// até 3 tentativas, com espera de 600 ms e 1200 ms (ou o Retry-After do 429, se maior), e
// nunca se começa uma tentativa que não cabe inteira no orçamento.
func decidir(tentativa, status int, decorrido, retryAfter, prazo, orcamento time.Duration) decisao {
	if status > 0 && status < 400 {
		return decisao{motivo: "deu certo"}
	}
	if status != 0 && status != 429 && status < 500 {
		return decisao{motivo: "o Bling respondeu, e a resposta é essa"}
	}
	if tentativa >= 3 {
		return decisao{motivo: "já tentei 3 vezes"}
	}
	esperar := (600 * time.Millisecond) << (tentativa - 1)
	if status == 429 && retryAfter > esperar {
		esperar = retryAfter
	}
	if decorrido+esperar+prazo > orcamento {
		return decisao{motivo: "não caberia outra tentativa no tempo desta chamada"}
	}
	motivo := "o Bling falhou do lado dele"
	switch status {
	case 0:
		motivo = "o Bling não respondeu no prazo"
	case 429:
		motivo = "o Bling pediu para esperar"
	}
	return decisao{repetir: true, esperar: esperar, motivo: motivo}
}
```

Crie `api/internal/core/core.go`:

```go
// Package core fala com o `core` (Laravel; dono do Bling, da Shopify e do token da Meta).
// A API NUNCA chama Bling nem Meta direto: o core guarda os tokens, o gate de 3 req/s por
// conta do Bling e a idempotência. Contrato (repo vessel-core-go, services/core):
// docs/migracao-core/PROXY-BLING.md, API-META.md e app/Http/Controllers/BlingProxyController.php.
package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"
)

const (
	CaminhoBling = "/api/interno/bling/proxy"
	CaminhoMeta  = "/api/interno/meta/graph"
)

// limiteResposta: nenhuma resposta legítima do core passa disso (var para o teste baixar).
var limiteResposta int64 = 32 << 20

// ErrSemToken: CORE_API_TOKEN não configurado; nada é enviado.
var ErrSemToken = errors.New("core: CORE_API_TOKEN ausente")

type Cliente struct {
	URL       string // sem barra no fim
	Token     string
	HTTP      *http.Client
	Prazo     time.Duration                                    // por tentativa no Bling; 0 = 11 s
	Orcamento time.Duration                                    // da chamada inteira no Bling; 0 = 25 s
	Dormir    func(ctx context.Context, d time.Duration) error // nil = espera de verdade (o teste troca)
}

// Novo devolve um cliente que não segue redirecionamento (o Bearer não sai para outro lugar).
func Novo(url, token string) *Cliente {
	return &Cliente{URL: url, Token: token, HTTP: &http.Client{
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

// Resposta é o que o core devolveu, cru.
type Resposta struct {
	Status     int
	Corpo      []byte
	RetryAfter string // cabeçalho cru (segundos)
	Origem     string // X-Core-Origem: "bling" = repassado do Bling; "proxy" = erro do core; "" = autenticação/nginx
}

// PedidoBling é o corpo de POST /api/interno/bling/proxy. Este plano só lê (GET).
type PedidoBling struct {
	Metodo  string         `json:"metodo"`
	Caminho string         `json:"caminho"` // começa com "/" (ex.: /pedidos/vendas)
	Query   map[string]any `json:"query,omitempty"`
}

// PedidoMeta é o corpo de POST /api/interno/meta/graph.
type PedidoMeta struct {
	Caminho     string         `json:"caminho"`
	Metodo      string         `json:"metodo"`
	Parametros  map[string]any `json:"parametros"`
	ImagemURL   string         `json:"imagem_url,omitempty"`
	ImagemCampo string         `json:"imagem_campo,omitempty"`
	VideoURL    string         `json:"video_url,omitempty"`
}

// SemResposta: nenhuma tentativa teve resposta do core (prazo ou rede). Error() é a frase
// que a tela mostra (fraseDeDesistencia de _shared/tentar-de-novo.js).
type SemResposta struct {
	Causa      string
	Tentativas int
}

func (e *SemResposta) Error() string {
	vez := "vezes"
	if e.Tentativas == 1 {
		vez = "vez"
	}
	return fmt.Sprintf("Não consegui falar com o Bling agora (%s). Tentei %d %s. Tente de novo em instantes; se continuar, o Bling está fora do ar.", e.Causa, e.Tentativas, vez)
}

// enviar faz UMA chamada. Erro = sem resposta (rede, prazo, ctx). O token vai só no
// cabeçalho: o erro do http (método + URL + causa) nunca o contém.
func (c *Cliente) enviar(ctx context.Context, caminho string, corpo any) (*Resposta, error) {
	if c.Token == "" {
		return nil, ErrSemToken
	}
	b, err := json.Marshal(corpo)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.URL+caminho, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	cli := c.HTTP
	if cli == nil {
		cli = http.DefaultClient
	}
	r, err := cli.Do(req)
	if err != nil {
		return nil, err
	}
	defer r.Body.Close()
	lido, err := io.ReadAll(io.LimitReader(r.Body, limiteResposta+1))
	if err != nil {
		return nil, err
	}
	if int64(len(lido)) > limiteResposta {
		return nil, errors.New("core: resposta grande demais")
	}
	return &Resposta{Status: r.StatusCode, Corpo: lido, RetryAfter: r.Header.Get("Retry-After"), Origem: r.Header.Get("X-Core-Origem")}, nil
}

func (c *Cliente) dormir(ctx context.Context, d time.Duration) error {
	if c.Dormir != nil {
		return c.Dormir(ctx, d)
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func retryAfter(r *Resposta) time.Duration {
	if r == nil {
		return 0
	}
	s, err := strconv.Atoi(r.RetryAfter)
	if err != nil || s <= 0 {
		return 0
	}
	return time.Duration(s) * time.Second
}

// Bling chama o proxy do Bling. GET repete o que é falha do lado de lá (429, 5xx, sem
// resposta) com recuo e dentro do orçamento (`decidir`); qualquer outro método sai UMA vez
// (escrita repetida duplicaria movimento). Erro *SemResposta = nenhuma tentativa respondeu.
func (c *Cliente) Bling(ctx context.Context, p PedidoBling) (*Resposta, error) {
	prazo, orc := c.Prazo, c.Orcamento
	if prazo == 0 {
		prazo = 11 * time.Second
	}
	if orc == 0 {
		orc = 25 * time.Second
	}
	comeco := time.Now()
	causa := "o Bling não respondeu"
	for tentativa := 1; ; tentativa++ {
		ctxT, cancela := context.WithTimeout(ctx, prazo)
		r, err := c.enviar(ctxT, CaminhoBling, p)
		cancela()
		if errors.Is(err, ErrSemToken) || (err != nil && ctx.Err() != nil) {
			return nil, err
		}
		status := 0
		if err != nil {
			causa = "o Bling não respondeu no prazo"
		} else {
			status = r.Status
			if status >= 400 {
				causa = fmt.Sprintf("o Bling respondeu %d", status)
			}
		}
		d := decisao{motivo: "escrita não se repete"}
		if p.Metodo == http.MethodGet {
			d = decidir(tentativa, status, time.Since(comeco), retryAfter(r), prazo, orc)
		}
		if !d.repetir {
			if err != nil {
				return nil, &SemResposta{Causa: causa, Tentativas: tentativa}
			}
			return r, nil
		}
		slog.Warn("core bling: repetindo", "caminho", p.Caminho, "tentativa", tentativa, "motivo", d.motivo, "espera", d.esperar)
		if err := c.dormir(ctx, d.esperar); err != nil {
			return nil, err
		}
	}
}

// Meta chama a Graph pelo core. Só repete 429 do core (recuo por uso alto: nada chegou à
// Meta), esperando o Retry-After (padrão 5 s, teto 30 s), até `tentativas`. 5xx, rede e
// prazo NÃO se repetem: POST repetido duplicaria campanha. O prazo é o do ctx.
func (c *Cliente) Meta(ctx context.Context, p PedidoMeta, tentativas int) (*Resposta, error) {
	if p.Parametros == nil {
		p.Parametros = map[string]any{}
	}
	for t := 1; ; t++ {
		r, err := c.enviar(ctx, CaminhoMeta, p)
		if err != nil || r.Status != http.StatusTooManyRequests || t >= tentativas {
			return r, err
		}
		espera := retryAfter(r)
		if espera <= 0 {
			espera = 5 * time.Second
		}
		if err := c.dormir(ctx, min(espera, 30*time.Second)); err != nil {
			return nil, err
		}
	}
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l internal/ && go vet ./internal/core/ ./internal/config/ && go test -race ./internal/config/ ./internal/core/ -v`
Expected: nenhum arquivo listado pelo `gofmt`; todos `--- PASS`, sem `--- SKIP`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/config api/internal/core
git commit -m "feat(api): cliente do core (proxy do Bling e Graph da Meta) e configuração do Plano 3

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Portão das edges (`PodeModulo`) e regra de canais por loja + `GET /eu/canais`

**Revisor:** **opus** (autorização: portão por módulo, escopo de canais, conta de serviço).

**Files:**
- Modify: `api/internal/auth/ator.go` (arquivo inteiro abaixo)
- Modify: `api/internal/auth/pode.go` (acrescentar `PodeModulo`)
- Modify: `api/internal/auth/middleware.go` (acrescentar `ExigirModulo`)
- Modify: `api/internal/testebanco/testebanco.go` (colunas `features` e `escopo_por_equipe` em `profiles`)
- Create: `api/internal/canais/canais.go`, `api/internal/canais/banco.go`
- Test: `api/internal/auth/pode_test.go` (acrescentar), `api/internal/auth/modulo_test.go`, `api/internal/canais/canais_test.go`, `api/internal/canais/banco_test.go`

**Interfaces:**
- Consumes: `auth.Exigir`, `auth.NovoStore`, `testebanco.Novo` (Plano 1).
- Produces:
  - `Ator.Modulos []string` (lido de `profiles.features`); `func (a *auth.Ator) PodeModulo(modulo string) bool`.
  - `func auth.ExigirModulo(modulos ...string) func(http.Handler) http.Handler` (passa com QUALQUER um).
  - `func canais.DoEscopo(e canais.Escopo) []int64` — `nil` = todos; `[]int64{}` = nenhum.
  - `func canais.Recortar(endpoint string, corpo any, canais []int64) (saida any, negado bool)` — `corpo` é o JSON decodificado (de preferência com `UseNumber`).
  - `func canais.Carregar(ctx context.Context, p *pgxpool.Pool, a *auth.Ator) ([]int64, error)` — sessão `servico` = `nil` sempre; sem `profiles` = `[]`.
  - `func canais.Handler(p *pgxpool.Pool) http.HandlerFunc` — `GET /eu/canais` → `{"canais": null}` ou `{"canais": [ids]}`.
  - `testebanco`: `profiles` ganha `features text[] default '{banco}'` e `escopo_por_equipe boolean default false`.

Regra portada de `supabase/functions/_shared/canais-de-venda-permitidos.js:46-136` (`canaisDoEscopo`) e `:201-224` (`recortarRespostaDoBling`), lida pelo `bling-proxy/index.ts:198-240`. O portão é o de `bling-proxy/index.ts:175-185` e `meta-proxy/index.ts:96-98` (`role === 'admin'` ou `features.includes(...)`).

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao fim de `api/internal/auth/pode_test.go`:

```go
func TestPodeModulo(t *testing.T) {
	vendas := &Ator{Tipo: "painel", Papel: "viewer", Modulos: []string{"banco", "sales"}}
	casos := []struct {
		nome   string
		ator   *Ator
		modulo string
		quer   bool
	}{
		{"ator nulo", nil, "sales", false},
		{"tem o módulo", vendas, "sales", true},
		{"não tem o módulo", vendas, "meta", false},
		{"módulo vazio", vendas, "", false},
		{"role admin passa (como nas edges)", &Ator{Tipo: "painel", Papel: "admin"}, "meta", true},
		{"super-admin passa", &Ator{Tipo: "painel", SuperAdmin: true}, "social", true},
		{"conta de serviço usa os módulos", &Ator{Tipo: "servico", Modulos: []string{"sales"}}, "sales", true},
		{"cliente da Vessel nunca, nem admin", &Ator{Tipo: "cliente", Papel: "admin", Modulos: []string{"sales"}}, "sales", false},
		{"tipo vazio nega", &Ator{Papel: "admin"}, "sales", false},
		{"permissions não abre módulo", &Ator{Tipo: "painel", Permissoes: map[string][]string{"meta": {"ver"}}}, "meta", false},
	}
	for _, c := range casos {
		if got := c.ator.PodeModulo(c.modulo); got != c.quer {
			t.Errorf("%s: PodeModulo(%q) = %v, esperava %v", c.nome, c.modulo, got, c.quer)
		}
	}
}
```

Crie `api/internal/auth/modulo_test.go` (usa `chamar` de `rotas_test.go`, que já existe no pacote):

```go
package auth

import (
	"context"
	"net/http"
	"slices"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestCarregarAtorLeFeaturesEExigirModulo(t *testing.T) {
	p := testebanco.Novo(t)
	s := NovoStore(p)
	ctx := context.Background()
	const com, sem = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	p.Exec(ctx, `insert into usuarios (id, email) values ($1, 'a@x.com'), ($2, 'b@x.com')`, com, sem)
	p.Exec(ctx, `insert into profiles (id, email, role, features) values ($1, 'a@x.com', 'viewer', '{banco,meta}'), ($2, 'b@x.com', 'viewer', null)`, com, sem)
	se, _ := s.Criar(ctx, com, "painel", nil)
	sessao, err := s.Buscar(ctx, se)
	if err != nil {
		t.Fatal(err)
	}
	a, err := CarregarAtor(ctx, p, sessao)
	if err != nil || !slices.Equal(a.Modulos, []string{"banco", "meta"}) {
		t.Fatalf("Modulos = %v (%v)", a.Modulos, err)
	}

	r := chi.NewRouter()
	r.Use(Exigir(p, s))
	r.With(ExigirModulo("social", "meta")).Get("/x", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	tokSem, _ := s.Criar(ctx, sem, "painel", nil)
	for _, c := range []struct {
		token string
		quer  int
	}{{se, 200}, {tokSem, 403}} {
		if w := chamar(r, "GET", "/x", "", c.token); w.Code != c.quer {
			t.Errorf("token %q: %d, esperava %d", c.token[:4], w.Code, c.quer)
		}
	}
}
```

Crie `api/internal/canais/canais_test.go`:

```go
package canais

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

func p64(v int64) *int64  { return &v }
func ps(v string) *string { return &v }

const (
	domPedro = int64(205657609)
	tivoli   = int64(205834140)
	atacado1 = int64(205395333)
	fabrica  = int64(205451611)
)

var (
	times = []Time{
		{ID: "t-dompedro", CanalLojaID: p64(domPedro)},
		{ID: "t-tivoli", CanalLojaID: p64(tivoli)},
		{ID: "t-marketing"}, // setor sem canal
		{ID: "t-atacado", CanalLojaID: p64(atacado1)},
	}
	lojas = []Canal{
		{LojaID: domPedro, Grupo: ps("Varejo"), GrupoID: ps("g-varejo")},
		{LojaID: tivoli, Grupo: ps(" varejo "), GrupoID: ps("g-varejo")},
		{LojaID: atacado1, Grupo: ps("Atacado"), GrupoID: ps("g-atacado")},
		{LojaID: fabrica, Grupo: ps("ATACADO"), GrupoID: ps("g-atacado")},
		{LojaID: 999, Grupo: nil}, // canal sem grupo
	}
)

func limitada(membros []Membro, grupos ...MembroDeGrupo) []int64 {
	return DoEscopo(Escopo{PorEquipe: true, MeuID: "u1", Times: times, Membros: membros, Canais: lojas, MembrosDeGrupo: grupos})
}

func TestDoEscopo(t *testing.T) {
	casos := []struct {
		nome string
		got  []int64
		quer []int64 // nil = todos
	}{
		{"super-admin não é limitado", DoEscopo(Escopo{SuperAdmin: true, PorEquipe: true, MeuID: "u1"}), nil},
		{"fora do escopo por equipe vê tudo", DoEscopo(Escopo{PorEquipe: false, MeuID: "u1", Times: times}), nil},
		{"vendedora do Dom Pedro só vê o Dom Pedro", limitada([]Membro{{"t-dompedro", "u1", "vendedora"}}), []int64{domPedro}},
		{"dois times = dois canais", limitada([]Membro{{"t-dompedro", "u1", "vendedora"}, {"t-tivoli", "u1", "gestor"}}), []int64{domPedro, tivoli}},
		{"limitada sem time vê NADA", limitada(nil), []int64{}},
		{"time sem canal não acrescenta", limitada([]Membro{{"t-marketing", "u1", "vendedora"}}), []int64{}},
		{"sem id de usuário não vê tudo", DoEscopo(Escopo{PorEquipe: true, Times: times}), []int64{}},
		{"vínculo de OUTRA pessoa não conta", limitada([]Membro{{"t-tivoli", "u2", "supervisora"}}), []int64{}},
		{"papel ausente = vendedora (não amplia)", limitada([]Membro{{"t-dompedro", "u1", ""}}), []int64{domPedro}},
		{"supervisora vê o grupo inteiro (maiúscula e espaço não importam)",
			limitada([]Membro{{"t-atacado", "u1", "supervisora"}}), []int64{atacado1, fabrica}},
		{"supervisora de grupo (canais_grupos_membros) vê o grupo",
			limitada(nil, MembroDeGrupo{"g-varejo", "u1", "supervisora"}), []int64{domPedro, tivoli}},
		{"vínculo de grupo sem papel não amplia", limitada(nil, MembroDeGrupo{"g-varejo", "u1", ""}), []int64{}},
		{"vínculo de grupo de outra pessoa não conta", limitada(nil, MembroDeGrupo{"g-varejo", "u2", "supervisora"}), []int64{}},
		{"canal repetido não duplica",
			limitada([]Membro{{"t-dompedro", "u1", "supervisora"}}, MembroDeGrupo{"g-varejo", "u1", "supervisora"}), []int64{domPedro, tivoli}},
	}
	for _, c := range casos {
		if (c.got == nil) != (c.quer == nil) || !slices.Equal(c.got, c.quer) {
			t.Errorf("%s: %v, esperava %v", c.nome, c.got, c.quer)
		}
	}
	if sem := DoEscopo(Escopo{PorEquipe: true, MeuID: "u1", Times: []Time{{ID: "t", CanalLojaID: p64(999)}},
		Membros: []Membro{{"t", "u1", "supervisora"}}, Canais: lojas}); !slices.Equal(sem, []int64{999}) {
		t.Errorf("canal sem grupo não pode ampliar: %v", sem)
	}
}

func decod(t *testing.T, s string) any {
	t.Helper()
	d := json.NewDecoder(strings.NewReader(s))
	d.UseNumber()
	var v any
	if err := d.Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestRecortar(t *testing.T) {
	lista := decod(t, `{"data":[{"id":1,"loja":{"id":205657609}},{"id":2,"loja":{"id":205834140}},{"id":3},{"id":4,"loja":{"id":"205657609"}}],"pagina":3}`)
	if c, neg := Recortar("pedidos/vendas", lista, nil); neg || c.(map[string]any)["pagina"] == nil {
		t.Fatal("sem limite o corpo passa intacto")
	}
	c, neg := Recortar("pedidos/vendas", lista, []int64{domPedro})
	b, _ := json.Marshal(c)
	if neg || string(b) != `{"data":[{"id":1,"loja":{"id":205657609}},{"id":4,"loja":{"id":"205657609"}}],"pagina":3}` {
		t.Fatalf("lista recortada = %s", b)
	}
	if c, _ := Recortar("pedidos/vendas", lista, []int64{}); len(c.(map[string]any)["data"].([]any)) != 0 {
		t.Fatal("sem canal a lista vem vazia, não inteira")
	}
	erro := decod(t, `{"error":{"type":"x"}}`)
	if c, neg := Recortar("pedidos/vendas", erro, []int64{domPedro}); neg || c == nil {
		t.Fatal("resposta de erro do Bling não é lista")
	}
	outro := decod(t, `{"data":{"id":2,"loja":{"id":205834140}}}`)
	if _, neg := Recortar("pedidos/vendas/2", outro, []int64{domPedro}); !neg {
		t.Fatal("UM pedido de outra loja é NEGADO")
	}
	if _, neg := Recortar("pedidos/vendas/3", decod(t, `{"data":{"id":3}}`), []int64{domPedro}); !neg {
		t.Fatal("pedido sem loja não vira de todo mundo")
	}
	if _, neg := Recortar("pedidos/vendas/1", decod(t, `{"data":{"id":1,"loja":{"id":205657609}}}`), []int64{domPedro}); neg {
		t.Fatal("pedido da loja dela passa")
	}
	for _, cam := range []string{"nfe", "nfe/7", "nfce", "nfce/7"} {
		if _, neg := Recortar(cam, decod(t, `{"data":[]}`), []int64{domPedro}); !neg {
			t.Errorf("%s deveria ser negado a quem é limitado", cam)
		}
		if _, neg := Recortar(cam, decod(t, `{"data":[]}`), nil); neg {
			t.Errorf("%s passa para quem não é limitado (o robô)", cam)
		}
	}
	for _, cam := range []string{"produtos", "produtos/1", "estoques/saldos", "depositos"} {
		if _, neg := Recortar(cam, decod(t, `{"data":[]}`), []int64{domPedro}); neg {
			t.Errorf("%s não fala de canal e passa", cam)
		}
	}
}
```

Crie `api/internal/canais/banco_test.go` (o vínculo da supervisora B **não** pode vazar para a vendedora A; conta de serviço com escopo ligado continua vendo tudo):

```go
package canais

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Tabelas de produção que a regra lê (só as colunas usadas).
const tabelas = `
create table bling_lojas (loja_id bigint primary key, nome text, grupo text, grupo_id uuid);
create table equipes (id uuid primary key, canal_loja_id bigint);
create table equipes_membros (equipe_id uuid not null, profile_id uuid not null, papel text not null default 'vendedora');
create table canais_grupos_membros (grupo_id uuid not null, profile_id uuid not null, papel text not null default 'supervisora');`

const (
	uA   = "aaaaaaaa-0000-0000-0000-000000000001" // vendedora limitada ao Dom Pedro
	uB   = "aaaaaaaa-0000-0000-0000-000000000002" // supervisora do Tivoli (outra pessoa)
	uC   = "aaaaaaaa-0000-0000-0000-000000000003" // não limitada
	uSem = "aaaaaaaa-0000-0000-0000-000000000004" // sem profile
	eDom = "bbbbbbbb-0000-0000-0000-000000000001"
	eTiv = "bbbbbbbb-0000-0000-0000-000000000002"
)

func preparar(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p := testebanco.Novo(t)
	ctx := context.Background()
	for _, sql := range []string{
		tabelas,
		`insert into usuarios (id, email) values ('` + uA + `','a@x'),('` + uB + `','b@x'),('` + uC + `','c@x'),('` + uSem + `','s@x')`,
		`insert into profiles (id, email, role, escopo_por_equipe) values ('` + uA + `','a@x','viewer',true),('` + uB + `','b@x','viewer',true),('` + uC + `','c@x','viewer',false)`,
		`insert into bling_lojas values (205657609,'Dom Pedro','Varejo',null),(205834140,'Tivoli','Varejo',null)`,
		`insert into equipes values ('` + eDom + `',205657609),('` + eTiv + `',205834140)`,
		`insert into equipes_membros values ('` + eDom + `','` + uA + `','vendedora'),('` + eTiv + `','` + uB + `','supervisora')`,
	} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	return p
}

func TestCarregar(t *testing.T) {
	p := preparar(t)
	ctx := context.Background()
	casos := []struct {
		nome string
		ator *auth.Ator
		quer []int64
	}{
		{"vendedora: só a loja dela (o vínculo da supervisora B não vaza)", &auth.Ator{ID: uA, Tipo: "painel"}, []int64{205657609}},
		{"supervisora B: o grupo do canal dela", &auth.Ator{ID: uB, Tipo: "painel"}, []int64{205834140, 205657609}},
		{"fora do escopo: todos", &auth.Ator{ID: uC, Tipo: "painel"}, nil},
		{"super-admin: todos", &auth.Ator{ID: uA, Tipo: "painel", SuperAdmin: true}, nil},
		{"conta de serviço nunca é limitada, mesmo com escopo ligado", &auth.Ator{ID: uA, Tipo: "servico"}, nil},
		{"sem profile: nenhum", &auth.Ator{ID: uSem, Tipo: "painel"}, []int64{}},
	}
	for _, c := range casos {
		got, err := Carregar(ctx, p, c.ator)
		if err != nil {
			t.Fatalf("%s: %v", c.nome, err)
		}
		if (got == nil) != (c.quer == nil) || !slices.Equal(got, c.quer) {
			t.Errorf("%s: %v, esperava %v", c.nome, got, c.quer)
		}
	}
}

func TestHandlerEuCanais(t *testing.T) {
	p := preparar(t)
	s := auth.NovoStore(p)
	ctx := context.Background()
	r := chi.NewRouter()
	r.With(auth.Exigir(p, s)).Get("/eu/canais", Handler(p))
	tokA, _ := s.Criar(ctx, uA, "painel", nil)
	tokC, _ := s.Criar(ctx, uC, "painel", nil)
	for _, c := range []struct{ token, quer string }{{tokA, `{"canais":[205657609]}`}, {tokC, `{"canais":null}`}} {
		req := httptest.NewRequest("GET", "/eu/canais", nil)
		req.Header.Set("Authorization", "Bearer "+c.token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var got, quer any
		json.Unmarshal(w.Body.Bytes(), &got)
		json.Unmarshal([]byte(c.quer), &quer)
		b1, _ := json.Marshal(got)
		b2, _ := json.Marshal(quer)
		if w.Code != http.StatusOK || string(b1) != string(b2) {
			t.Errorf("%d %s, esperava %s", w.Code, w.Body, c.quer)
		}
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/eu/canais", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("sem sessão = %d", w.Code)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/auth/ ./internal/canais/ -v`
Expected: FAIL de compilação (`a.Modulos undefined`, `undefined: ExigirModulo`, `undefined: DoEscopo`).

- [ ] **Step 3: Implementar**

Em `api/internal/testebanco/testebanco.go`, dentro da constante `legado`, troque a última coluna de `profiles` (`  disabled boolean default false`) por:

```sql
  disabled boolean default false,
  features text[] default '{banco}', escopo_por_equipe boolean default false
```

Substitua `api/internal/auth/ator.go` por (lê `features`; `role::text` porque `profiles.role` pode ser enum, ver NOTAS):

```go
package auth

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Ator é quem está fazendo a requisição, já com o que pode.
type Ator struct {
	ID             string
	Tipo           string // painel | cliente | servico
	Papel          string
	SuperAdmin     bool
	Permissoes     map[string][]string // recurso -> ações ("ver","criar","editar","excluir")
	ImpersonadorID *string
	Modulos        []string // profiles.features: o portão que as edges usavam (ver PodeModulo)
}

func CarregarAtor(ctx context.Context, p *pgxpool.Pool, s *Sessao) (*Ator, error) {
	a := &Ator{ID: s.UsuarioID, Tipo: s.Tipo, ImpersonadorID: s.ImpersonadorID, Permissoes: map[string][]string{}}
	var perm []byte
	err := p.QueryRow(ctx,
		`select coalesce(role::text, ''), coalesce(is_superadmin, false), coalesce(permissions, '{}'::jsonb),
		        coalesce(features, '{}'::text[])
		   from profiles where id = $1`, s.UsuarioID).Scan(&a.Papel, &a.SuperAdmin, &perm, &a.Modulos)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, nil // sem perfil = sem permissão (cliente da Vessel não tem profile)
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(perm, &a.Permissoes); err != nil {
		return nil, err
	}
	return a, nil
}
```

Acrescente ao fim de `api/internal/auth/pode.go`:

```go
// PodeModulo é o portão das edge functions que as rotas portadas delas preservam
// (bling-proxy, meta-proxy, insights-ao-vivo...): `profiles.role = 'admin'` ou o módulo em
// `profiles.features` (text[], derivado de `permissions` por src/compartilhado/derivar-features.js).
// Super-admin passa, como em Pode. Tipo fora de painel/servico nunca passa.
// A unificação com `permissions` (Pode) é do plano de domínios.
func (a *Ator) PodeModulo(modulo string) bool {
	if a == nil || (a.Tipo != "painel" && a.Tipo != "servico") || modulo == "" {
		return false
	}
	return a.SuperAdmin || a.Papel == "admin" || slices.Contains(a.Modulos, modulo)
}
```

Acrescente ao fim de `api/internal/auth/middleware.go` (sem import novo):

```go
// ExigirModulo deve vir DEPOIS de Exigir: passa quem tem QUALQUER um dos módulos (PodeModulo).
func ExigirModulo(modulos ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a := AtorDoContexto(r.Context())
			for _, m := range modulos {
				if a.PodeModulo(m) {
					next.ServeHTTP(w, r)
					return
				}
			}
			erroJSON(w, http.StatusForbidden, "sem_permissao")
		})
	}
}
```

Crie `api/internal/canais/canais.go`:

```go
// Package canais decide de quais canais de venda (lojas do Bling) uma pessoa vê o faturamento.
// Porta ÚNICA de supabase/functions/_shared/canais-de-venda-permitidos.js: o bling-proxy
// recorta a resposta do Bling com isto e o front pergunta por GET /eu/canais, em vez de
// manter uma segunda cópia da regra.
//
// nil = vê TODOS os canais; []int64{} = não vê NENHUM. Confundir os dois é o defeito que
// faria uma vendedora sem time enxergar a empresa inteira.
package canais

import (
	"regexp"
	"strconv"
	"strings"
)

type Time struct {
	ID          string
	CanalLojaID *int64
}

type Membro struct{ EquipeID, ProfileID, Papel string }

type Canal struct {
	LojaID  int64
	Grupo   *string
	GrupoID *string
}

type MembroDeGrupo struct{ GrupoID, ProfileID, Papel string }

type Escopo struct {
	SuperAdmin     bool
	PorEquipe      bool
	MeuID          string
	Times          []Time
	Membros        []Membro
	Canais         []Canal
	MembrosDeGrupo []MembroDeGrupo
}

// normalizarGrupo: pontas fora, espaço repetido vira um, vazio vira "" (sem grupo).
func normalizarGrupo(g *string) string {
	if g == nil {
		return ""
	}
	return strings.Join(strings.Fields(*g), " ")
}

// DoEscopo é canaisDoEscopo do JS, regra por regra.
func DoEscopo(e Escopo) []int64 {
	if e.SuperAdmin || !e.PorEquipe {
		return nil
	}
	ids := []int64{}
	if e.MeuID == "" {
		return ids
	}
	// Os MEUS vínculos com o papel em cada time. Papel ausente = vendedora: falta de dado
	// nunca dá acesso a mais.
	meus := map[string]string{}
	for _, m := range e.Membros {
		if m.ProfileID != e.MeuID {
			continue
		}
		papel := m.Papel
		if papel == "" {
			papel = "vendedora"
		}
		meus[m.EquipeID] = papel
	}
	grupoDoCanal := map[int64]string{}
	for _, c := range e.Canais {
		if g := normalizarGrupo(c.Grupo); g != "" {
			grupoDoCanal[c.LojaID] = strings.ToLower(g)
		}
	}
	supervisiono := map[string]bool{}
	for _, t := range e.Times {
		papel, ok := meus[t.ID]
		if !ok || t.CanalLojaID == nil {
			continue // time sem canal não acrescenta nada (e não vira "vê tudo")
		}
		ids = append(ids, *t.CanalLojaID)
		// Supervisora vê todos os canais do GRUPO do canal do time (decisão de 20/08/2026).
		if g := grupoDoCanal[*t.CanalLojaID]; papel == "supervisora" && g != "" {
			supervisiono[g] = true
		}
	}
	if len(supervisiono) > 0 {
		for _, c := range e.Canais {
			if g := grupoDoCanal[c.LojaID]; g != "" && supervisiono[g] {
				ids = append(ids, c.LojaID)
			}
		}
	}
	// A supervisora que mora no GRUPO (canais_grupos_membros), casada por grupo_id como
	// public.pode_ver_canal faz no banco. Só 'supervisora' amplia.
	meusGrupos := map[string]bool{}
	for _, gm := range e.MembrosDeGrupo {
		if gm.ProfileID == e.MeuID && gm.Papel == "supervisora" && gm.GrupoID != "" {
			meusGrupos[gm.GrupoID] = true
		}
	}
	if len(meusGrupos) > 0 {
		for _, c := range e.Canais {
			if c.GrupoID != nil && *c.GrupoID != "" && meusGrupos[*c.GrupoID] {
				ids = append(ids, c.LojaID)
			}
		}
	}
	// Sem repetição, na ordem em que apareceram (o Set do JS).
	vistos := map[int64]bool{}
	out := []int64{}
	for _, id := range ids {
		if !vistos[id] {
			vistos[id] = true
			out = append(out, id)
		}
	}
	return out
}

var (
	negadosAQuemELimitado = regexp.MustCompile(`^nfc?e(/|$)`)
	umPedido              = regexp.MustCompile(`^pedidos/vendas/[A-Za-z0-9_-]+$`)
)

// lojaDoPedido devolve pedido.loja.id como texto ("" se não houver): número e texto casam.
func lojaDoPedido(p any) string {
	m, _ := p.(map[string]any)
	loja, _ := m["loja"].(map[string]any)
	switch v := loja["id"].(type) {
	case string:
		return v
	case interface{ String() string }: // json.Number
		return v.String()
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return ""
}

// Recortar é recortarRespostaDoBling: o que sai do bling-proxy para quem está limitado.
// canais nil devolve o corpo intacto. negado = responder 403, não uma lista vazia (lista
// vazia mentiria dizendo que não há venda). corpo é o JSON já decodificado.
func Recortar(endpoint string, corpo any, canais []int64) (any, bool) {
	if canais == nil {
		return corpo, false
	}
	if negadosAQuemELimitado.MatchString(endpoint) {
		return nil, true // nota fiscal não dá para recortar por canal
	}
	ok := map[string]bool{}
	for _, c := range canais {
		ok[strconv.FormatInt(c, 10)] = true
	}
	m, _ := corpo.(map[string]any)
	if endpoint == "pedidos/vendas" {
		lista, eLista := m["data"].([]any)
		if !eLista {
			return corpo, false // resposta de erro do Bling não é lista
		}
		filtrada := []any{}
		for _, p := range lista {
			if ok[lojaDoPedido(p)] {
				filtrada = append(filtrada, p)
			}
		}
		saida := map[string]any{}
		for k, v := range m {
			saida[k] = v
		}
		saida["data"] = filtrada
		return saida, false
	}
	if umPedido.MatchString(endpoint) {
		if m["data"] == nil {
			return corpo, false
		}
		if !ok[lojaDoPedido(m["data"])] {
			return nil, true
		}
	}
	return corpo, false
}
```

Crie `api/internal/canais/banco.go`:

```go
package canais

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// Carregar lê do banco o escopo do ator e devolve os canais (nil = todos).
//
// Conta de serviço (sessão tipo "servico") NUNCA é limitada a loja: regra explícita da spec
// §4 (os robôs do coletor leem o faturamento inteiro). Sem linha em profiles = nenhum canal:
// falta de dado nunca amplia.
//
// ⚠️ As leituras de vínculo filtram por profile_id = o ator. Sem esse filtro viria o vínculo
// de TODO MUNDO e a regra ampliaria o acesso de quem não devia (a edge tinha o mesmo aviso).
func Carregar(ctx context.Context, p *pgxpool.Pool, a *auth.Ator) ([]int64, error) {
	if a.Tipo == "servico" {
		return nil, nil
	}
	var porEquipe bool
	err := p.QueryRow(ctx, `select coalesce(escopo_por_equipe, false) from profiles where id = $1`, a.ID).Scan(&porEquipe)
	if errors.Is(err, pgx.ErrNoRows) {
		return []int64{}, nil
	}
	if err != nil {
		return nil, err
	}
	e := Escopo{SuperAdmin: a.SuperAdmin, PorEquipe: porEquipe, MeuID: a.ID}
	if e.SuperAdmin || !e.PorEquipe {
		return nil, nil // economia de consulta: a regra devolveria nil de qualquer jeito
	}
	linhas, err := p.Query(ctx, `select equipe_id::text, profile_id::text, coalesce(papel, '') from equipes_membros where profile_id = $1`, a.ID)
	if err != nil {
		return nil, err
	}
	if e.Membros, err = pgx.CollectRows(linhas, func(r pgx.CollectableRow) (m Membro, err error) {
		return m, r.Scan(&m.EquipeID, &m.ProfileID, &m.Papel)
	}); err != nil {
		return nil, err
	}
	linhas, err = p.Query(ctx, `select e.id::text, e.canal_loja_id from equipes e
		where e.id in (select equipe_id from equipes_membros where profile_id = $1)`, a.ID)
	if err != nil {
		return nil, err
	}
	if e.Times, err = pgx.CollectRows(linhas, func(r pgx.CollectableRow) (t Time, err error) {
		return t, r.Scan(&t.ID, &t.CanalLojaID)
	}); err != nil {
		return nil, err
	}
	// TODOS os canais com o grupo: é o que deixa a supervisora ver o grupo inteiro.
	linhas, err = p.Query(ctx, `select loja_id, grupo, grupo_id::text from bling_lojas`)
	if err != nil {
		return nil, err
	}
	if e.Canais, err = pgx.CollectRows(linhas, func(r pgx.CollectableRow) (c Canal, err error) {
		return c, r.Scan(&c.LojaID, &c.Grupo, &c.GrupoID)
	}); err != nil {
		return nil, err
	}
	linhas, err = p.Query(ctx, `select grupo_id::text, profile_id::text, coalesce(papel, '') from canais_grupos_membros where profile_id = $1`, a.ID)
	if err != nil {
		return nil, err
	}
	if e.MembrosDeGrupo, err = pgx.CollectRows(linhas, func(r pgx.CollectableRow) (g MembroDeGrupo, err error) {
		return g, r.Scan(&g.GrupoID, &g.ProfileID, &g.Papel)
	}); err != nil {
		return nil, err
	}
	return DoEscopo(e), nil
}

// Handler: GET /eu/canais -> {"canais": null} (vê todos) ou {"canais": [ids]} ([] = nenhum).
// Deve vir DEPOIS de auth.Exigir.
func Handler(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := Carregar(r.Context(), p, auth.AtorDoContexto(r.Context()))
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"erro_interno"}`))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"canais": c})
	}
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l internal/ && go vet ./internal/auth/ ./internal/canais/ && go test -race ./internal/auth/ ./internal/canais/ -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'`
Expected: só `--- PASS` (inclusive `TestCarregar`, `TestHandlerEuCanais`, `TestCarregarAtorLeFeaturesEExigirModulo`, que precisam do banco).

- [ ] **Step 5: Commit**

```bash
git add api/internal/auth api/internal/testebanco api/internal/canais
git commit -m "feat(api): portão das edges (PodeModulo), regra de canais por loja e GET /eu/canais

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `POST /bling-proxy`

**Revisor:** **opus** (allow-list que segura o ERP inteiro, portão por caminho, recorte por loja).

**Files:**
- Create: `api/internal/comercial/bling.go`
- Test: `api/internal/comercial/bling_test.go`

**Interfaces:**
- Consumes: `core.Cliente.Bling`, `core.PedidoBling`, `core.ErrSemToken`, `core.SemResposta` (Task 1); `auth.AtorDoContexto`, `Ator.PodeModulo`, `canais.Carregar`, `canais.Recortar` (Task 2).
- Produces:
  - `type comercial.Bling struct { Pool *pgxpool.Pool; Core *core.Cliente }` com `ServeHTTP` — montado atrás de `auth.Exigir` (o portão por caminho é interno).
  - Para os testes do pacote (Task 6 reusa): `coreFalso` (`pedidos []core.PedidoBling`, `n()`, `resp func(core.PedidoBling, int) (int, string, map[string]string)`; status 0 = pendura até o cliente desistir).

Porta de `supabase/functions/bling-proxy/index.ts`: allow-list `:51-73` (o teste de `caminhos-permitidos.test.mjs` vem junto), entrada e portão `:145-185`, chamada e repetição `:244-324`, lista por loja com `idLoja` e conferência `:353-379`, recorte `:382-385`. Erros com o mesmo texto da edge (`endpoint required`, `endpoint nao permitido`, `sem permissao`, `sem permissao para este canal`).

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/comercial/bling_test.go`:

```go
package comercial

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// coreFalso é o core de mentira: guarda cada PedidoBling recebido e responde com `resp`.
type coreFalso struct {
	mu      sync.Mutex
	pedidos []core.PedidoBling
	resp    func(p core.PedidoBling, n int) (status int, corpo string, cab map[string]string)
}

func (f *coreFalso) n() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.pedidos) }

func (f *coreFalso) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var p core.PedidoBling
	json.NewDecoder(r.Body).Decode(&p)
	f.mu.Lock()
	f.pedidos = append(f.pedidos, p)
	n := len(f.pedidos)
	f.mu.Unlock()
	st, corpo, cab := f.resp(p, n)
	for k, v := range cab {
		w.Header().Set(k, v)
	}
	if st == 0 { // pendura até o cliente desistir
		<-r.Context().Done()
		return
	}
	w.WriteHeader(st)
	io.WriteString(w, corpo)
}

const tabelasDeCanais = `
create table bling_lojas (loja_id bigint primary key, nome text, grupo text, grupo_id uuid);
create table equipes (id uuid primary key, canal_loja_id bigint);
create table equipes_membros (equipe_id uuid not null, profile_id uuid not null, papel text not null default 'vendedora');
create table canais_grupos_membros (grupo_id uuid not null, profile_id uuid not null, papel text not null default 'supervisora');
insert into bling_lojas values (205657609, 'Dom Pedro', 'Varejo', null), (205834140, 'Tivoli', 'Varejo', null);
insert into equipes values ('bbbbbbbb-0000-0000-0000-000000000001', 205657609), ('bbbbbbbb-0000-0000-0000-000000000002', null);`

const (
	uVendas   = "aaaaaaaa-0000-0000-0000-000000000001" // features sales, sem escopo
	uLimitada = "aaaaaaaa-0000-0000-0000-000000000002" // sales, limitada ao Dom Pedro
	uSemTime  = "aaaaaaaa-0000-0000-0000-000000000003" // sales, limitada, só num time sem canal
	uAutent   = "aaaaaaaa-0000-0000-0000-000000000004" // só autenticidade
	uNada     = "aaaaaaaa-0000-0000-0000-000000000005" // só banco
)

type ambiente struct {
	p      *pgxpool.Pool
	h      http.Handler
	core   *coreFalso
	cli    *core.Cliente
	tokens map[string]string
}

func montar(t *testing.T, resp func(core.PedidoBling, int) (int, string, map[string]string)) *ambiente {
	t.Helper()
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasDeCanais); err != nil {
		t.Fatal(err)
	}
	perfis := []struct {
		id, features string
		escopo       bool
	}{
		{uVendas, "{banco,sales}", false}, {uLimitada, "{sales}", true}, {uSemTime, "{sales}", true},
		{uAutent, "{autenticidade}", false}, {uNada, "{banco}", false},
	}
	s := auth.NovoStore(p)
	tokens := map[string]string{}
	for _, pf := range perfis {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $1::text || '@x')`, pf.id); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, features, escopo_por_equipe)
			values ($1::uuid, $1::text || '@x', 'viewer', $2::text[], $3)`, pf.id, pf.features, pf.escopo); err != nil {
			t.Fatal(err)
		}
		tokens[pf.id], _ = s.Criar(ctx, pf.id, "painel", nil)
	}
	tokens["servico"], _ = s.Criar(ctx, uLimitada, "servico", nil) // mesma pessoa limitada, sessão de serviço
	if _, err := p.Exec(ctx, `insert into equipes_membros values ('bbbbbbbb-0000-0000-0000-000000000001', $1, 'vendedora'),
		('bbbbbbbb-0000-0000-0000-000000000002', $2, 'vendedora')`, uLimitada, uSemTime); err != nil {
		t.Fatal(err)
	}

	f := &coreFalso{resp: resp}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	cli := core.Novo(srv.URL, "token-do-core")
	cli.Prazo = 100 * time.Millisecond
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	r := chi.NewRouter()
	r.With(auth.Exigir(p, s)).Post("/bling-proxy", (&Bling{Pool: p, Core: cli}).ServeHTTP)
	return &ambiente{p: p, h: r, core: f, cli: cli, tokens: tokens}
}

func (a *ambiente) post(token, corpo string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", "/bling-proxy", strings.NewReader(corpo))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	a.h.ServeHTTP(w, req)
	return w
}

func ok200(corpo string) func(core.PedidoBling, int) (int, string, map[string]string) {
	return func(core.PedidoBling, int) (int, string, map[string]string) {
		return 200, corpo, map[string]string{"X-Core-Origem": "bling"}
	}
}

func TestCaminhosPermitidos(t *testing.T) {
	for _, bom := range []string{"pedidos/vendas", "pedidos/vendas/123", "vendedores/45", "produtos", "produtos/999",
		"estoques/saldos", "nfe", "nfe/7", "nfce", "nfce/7", "depositos", "formas-pagamentos"} {
		if !permitido(bom) {
			t.Errorf("caminho que uma tela usa foi fechado: %s", bom)
		}
	}
	for _, mau := range []string{"contatos", "contatos/1", "financeiro", "contas/pagar", "contas/receber", "oauth/token",
		"usuarios", "notas", "estoques", "estoques/saldos/1", "pedidos", "pedidos/compras", "depositos/1",
		"produtos/../oauth/token", "produtos/..%2Foauth", "../financeiro", "depositos ", " depositos", "depositos/", "/produtos"} {
		if permitido(mau) {
			t.Errorf("caminho perigoso ficou ABERTO: %q", mau)
		}
	}
	for _, re := range caminhosPermitidos {
		if s := re.String(); s[0] != '^' || s[len(s)-1] != '$' {
			t.Errorf("regra sem âncora nas duas pontas: %s", s)
		}
	}
}

func TestBlingProxyAutorizacao(t *testing.T) {
	a := montar(t, ok200(`{"data":[]}`))
	casos := []struct {
		nome, token, corpo string
		quer               int
	}{
		{"sem sessão", "", `{"endpoint":"produtos"}`, 401},
		{"fora da lista", a.tokens[uVendas], `{"endpoint":"contatos"}`, 403},
		{"fuga de caminho", a.tokens[uVendas], `{"endpoint":"produtos/../oauth/token"}`, 403},
		{"sem endpoint", a.tokens[uVendas], `{}`, 400},
		{"corpo não é JSON", a.tokens[uVendas], `xx`, 400},
		{"sem sales/gestor", a.tokens[uNada], `{"endpoint":"produtos"}`, 403},
		{"autenticidade só produto: produtos", a.tokens[uAutent], `{"endpoint":"produtos/1"}`, 200},
		{"autenticidade só produto: pedidos", a.tokens[uAutent], `{"endpoint":"pedidos/vendas"}`, 403},
		{"vendas pode pedidos", a.tokens[uVendas], `{"endpoint":"pedidos/vendas"}`, 200},
	}
	for _, c := range casos {
		if w := a.post(c.token, c.corpo); w.Code != c.quer {
			t.Errorf("%s: %d %s, esperava %d", c.nome, w.Code, w.Body, c.quer)
		}
	}
	if a.core.n() != 2 {
		t.Fatalf("o core só podia ser chamado pelos 2 casos permitidos; foi %d", a.core.n())
	}
}

func TestBlingProxyRepassaOContrato(t *testing.T) {
	a := montar(t, func(p core.PedidoBling, _ int) (int, string, map[string]string) {
		return 200, `{"data":[{"id":27078068236,"loja":{"id":205834140}}],"pagina":1}`, map[string]string{"X-Core-Origem": "bling"}
	})
	w := a.post(a.tokens[uVendas], `{"endpoint":"pedidos/vendas","params":{"pagina":1,"idsSituacoes[]":[9,12],"idLoja":null,"dataInicial":"2026-10-01","um":[5],"obj":{"a":1}}}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `27078068236`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	p := a.core.pedidos[0]
	b, _ := json.Marshal(p)
	if string(b) != `{"metodo":"GET","caminho":"/pedidos/vendas","query":{"dataInicial":"2026-10-01","idsSituacoes[]":["9","12"],"obj":"{\"a\":1}","pagina":"1","um":"5"}}` {
		t.Fatalf("pedido ao core = %s", b)
	}
}

func TestBlingProxyLimitadaALoja(t *testing.T) {
	outraLoja := false
	a := montar(t, func(p core.PedidoBling, _ int) (int, string, map[string]string) {
		if outraLoja {
			return 200, `{"data":[{"id":1,"loja":{"id":205657609}},{"id":2,"loja":{"id":205834140}}]}`, nil
		}
		return 200, `{"data":[{"id":1,"loja":{"id":205657609}}]}`, nil
	})
	w := a.post(a.tokens[uLimitada], `{"endpoint":"pedidos/vendas","params":{"pagina":1}}`)
	if w.Code != 200 || a.core.n() != 1 {
		t.Fatalf("%d %s (core chamado %d vezes)", w.Code, w.Body, a.core.n())
	}
	if q := a.core.pedidos[0].Query; q["idLoja"] != "205657609" || q["pagina"] != "1" {
		t.Fatalf("query = %v", q)
	}
	outraLoja = true // o Bling deixou de honrar idLoja
	if w := a.post(a.tokens[uLimitada], `{"endpoint":"pedidos/vendas"}`); w.Code != 502 {
		t.Fatalf("lista torta deveria ser 502: %d %s", w.Code, w.Body)
	}
	antes := a.core.n()
	if w := a.post(a.tokens[uSemTime], `{"endpoint":"pedidos/vendas"}`); w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"data":[]}` || a.core.n() != antes {
		t.Fatalf("limitada sem canal: %d %s (core chamado %d vezes)", w.Code, w.Body, a.core.n()-antes)
	}
	if w := a.post(a.tokens[uLimitada], `{"endpoint":"nfe"}`); w.Code != 403 || !strings.Contains(w.Body.String(), "sem permissao para este canal") {
		t.Fatalf("nfe para limitada: %d %s", w.Code, w.Body)
	}
	// Conta de serviço: a MESMA pessoa limitada, com sessão de serviço, não é recortada.
	if w := a.post(a.tokens["servico"], `{"endpoint":"pedidos/vendas"}`); w.Code != 200 || a.core.pedidos[a.core.n()-1].Query != nil {
		t.Fatalf("serviço: %d query=%v", w.Code, a.core.pedidos[a.core.n()-1].Query)
	}
}

func TestBlingProxyUmPedidoDeOutraLoja(t *testing.T) {
	a := montar(t, ok200(`{"data":{"id":2,"loja":{"id":205834140}}}`))
	if w := a.post(a.tokens[uLimitada], `{"endpoint":"pedidos/vendas/2"}`); w.Code != 403 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

func TestBlingProxyFalhasDoCore(t *testing.T) {
	lento := montar(t, func(core.PedidoBling, int) (int, string, map[string]string) { return 0, "", nil })
	if w := lento.post(lento.tokens[uVendas], `{"endpoint":"produtos"}`); w.Code != 504 || !strings.Contains(w.Body.String(), "Tentei 3 vezes") || lento.core.n() != 3 {
		t.Fatalf("lento: %d %s (%d chamadas)", w.Code, w.Body, lento.core.n())
	}
	recuo := montar(t, func(_ core.PedidoBling, n int) (int, string, map[string]string) {
		if n == 1 {
			return 429, `{"error":"limite"}`, map[string]string{"Retry-After": "1", "X-Core-Origem": "bling"}
		}
		return 200, `{"data":[]}`, nil
	})
	if w := recuo.post(recuo.tokens[uVendas], `{"endpoint":"produtos"}`); w.Code != 200 || recuo.core.n() != 2 {
		t.Fatalf("429: %d (%d chamadas)", w.Code, recuo.core.n())
	}
	cred := montar(t, func(core.PedidoBling, int) (int, string, map[string]string) {
		return 401, `{"erro":"nao_autorizado"}`, nil
	})
	if w := cred.post(cred.tokens[uVendas], `{"endpoint":"produtos"}`); w.Code != 502 {
		t.Fatalf("401 do core sem X-Core-Origem deveria virar 502: %d", w.Code)
	}
	reaut := montar(t, func(core.PedidoBling, int) (int, string, map[string]string) {
		return 409, `{"erro":"reautorizacao_necessaria"}`, map[string]string{"X-Core-Origem": "proxy"}
	})
	if w := reaut.post(reaut.tokens[uVendas], `{"endpoint":"produtos"}`); w.Code != 409 || !strings.Contains(w.Body.String(), "reautorizacao_necessaria") {
		t.Fatalf("409 do core: %d %s", w.Code, w.Body)
	}
	cru := montar(t, ok200(`<html>oops</html>`))
	w := cru.post(cru.tokens[uVendas], `{"endpoint":"produtos"}`)
	var raw map[string]string
	if json.Unmarshal(w.Body.Bytes(), &raw); raw["raw"] != "<html>oops</html>" {
		t.Fatalf("corpo não-JSON vira {raw}: %s", w.Body)
	}
	semToken := montar(t, ok200(`{}`))
	semToken.cli.Token = ""
	if w := semToken.post(semToken.tokens[uVendas], `{"endpoint":"produtos"}`); w.Code != 503 {
		t.Fatalf("sem token do core: %d", w.Code)
	}
}

func TestBlingProxyCorpoGrande(t *testing.T) {
	a := montar(t, ok200(`{}`))
	grande := `{"endpoint":"produtos","params":{"x":"` + strings.Repeat("a", 70<<10) + `"}}`
	if w := a.post(a.tokens[uVendas], grande); w.Code != 413 || a.core.n() != 0 {
		t.Fatalf("%d (core chamado %d vezes)", w.Code, a.core.n())
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/comercial/ -v`
Expected: FAIL de compilação (`undefined: Bling`, `undefined: permitido`, `undefined: caminhosPermitidos`).

- [ ] **Step 3: Implementar**

Crie `api/internal/comercial/bling.go`:

```go
// Package comercial: vendas (bling-proxy e push de vendas), sempre pelo core.
package comercial

import (
	"bytes"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/canais"
	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// caminhosPermitidos: o token do Bling (no core) abre o ERP INTEIRO; esta lista é o que
// separa a Central do resto. Cópia exata de supabase/functions/bling-proxy/index.ts
// (CAMINHOS_PERMITIDOS). O id aceita só [A-Za-z0-9_-]: sem ponto nem barra, não há fuga.
var caminhosPermitidos = []*regexp.Regexp{
	regexp.MustCompile(`^pedidos/vendas$`),
	regexp.MustCompile(`^pedidos/vendas/[A-Za-z0-9_-]+$`),
	regexp.MustCompile(`^vendedores/[A-Za-z0-9_-]+$`),
	regexp.MustCompile(`^produtos$`),
	regexp.MustCompile(`^produtos/[A-Za-z0-9_-]+$`),
	regexp.MustCompile(`^estoques/saldos$`),
	regexp.MustCompile(`^depositos$`),
	regexp.MustCompile(`^formas-pagamentos$`),
	regexp.MustCompile(`^nfe$`),
	regexp.MustCompile(`^nfe/[A-Za-z0-9_-]+$`),
	regexp.MustCompile(`^nfce$`),
	regexp.MustCompile(`^nfce/[A-Za-z0-9_-]+$`),
}

// 'autenticidade' abre SÓ os caminhos de produto (o seletor de produto do painel NFC).
var caminhoDeProduto = regexp.MustCompile(`^produtos(/[A-Za-z0-9_-]+)?$`)

func permitido(endpoint string) bool {
	for _, re := range caminhosPermitidos {
		if re.MatchString(endpoint) {
			return true
		}
	}
	return false
}

// Bling é POST /bling-proxy {endpoint, params}: porta de supabase/functions/bling-proxy.
// Mesmo contrato de entrada e saída da edge. Deve vir DEPOIS de auth.Exigir.
type Bling struct {
	Pool *pgxpool.Pool
	Core *core.Cliente
}

func responder(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

func erro(w http.ResponseWriter, status int, msg string) {
	responder(w, status, map[string]string{"error": msg})
}

// texto é o String() do JS para um valor de params (a edge montava a URL com ele).
func texto(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		return x.String()
	case bool:
		return strconv.FormatBool(x)
	case nil:
		return "null"
	}
	b, _ := json.Marshal(v)
	return string(b)
}

// query reproduz o que a edge mandava ao core: a URL montada com params e relida por
// blingPeloCore (_shared/core-bling-proxy.js) — valor único vira texto, repetido vira lista.
func query(params map[string]any) map[string]any {
	q := map[string]any{}
	for k, v := range params {
		switch x := v.(type) {
		case nil:
		case []any:
			var vs []string
			for _, it := range x {
				vs = append(vs, texto(it))
			}
			if len(vs) == 1 {
				q[k] = vs[0]
			} else if len(vs) > 1 {
				q[k] = vs
			}
		default:
			q[k] = texto(x)
		}
	}
	return q
}

// chamar devolve o status e o corpo (JSON decodificado) que a edge devolveria.
func (b *Bling) chamar(r *http.Request, endpoint string, q map[string]any) (int, any) {
	if len(q) == 0 {
		q = nil
	}
	resp, err := b.Core.Bling(r.Context(), core.PedidoBling{Metodo: http.MethodGet, Caminho: "/" + endpoint, Query: q})
	var sr *core.SemResposta
	switch {
	case errors.Is(err, core.ErrSemToken):
		return http.StatusServiceUnavailable, map[string]string{"error": "core nao configurado"}
	case errors.As(err, &sr):
		slog.Error("bling-proxy: desisti", "endpoint", endpoint, "tentativas", sr.Tentativas, "causa", sr.Causa)
		return http.StatusGatewayTimeout, map[string]string{"error": sr.Error()}
	case err != nil:
		return http.StatusBadGateway, map[string]string{"error": "falha ao falar com o core"}
	}
	// 401/403 que NÃO veio do Bling é o core recusando a credencial DESTA API: repassar
	// 401 faria o front achar que a sessão da pessoa expirou.
	if (resp.Status == http.StatusUnauthorized || resp.Status == http.StatusForbidden) && resp.Origem != "bling" && resp.Origem != "proxy" {
		slog.Error("bling-proxy: o core recusou a credencial da API", "status", resp.Status)
		return http.StatusBadGateway, map[string]string{"error": "o core recusou a credencial desta API"}
	}
	var corpo any
	d := json.NewDecoder(bytes.NewReader(resp.Corpo))
	d.UseNumber()
	if d.Decode(&corpo) != nil {
		corpo = map[string]any{"raw": string(resp.Corpo)}
	}
	return resp.Status, corpo
}

func (b *Bling) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a := auth.AtorDoContexto(r.Context())
	var in struct {
		Endpoint string         `json:"endpoint"`
		Params   map[string]any `json:"params"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	d.UseNumber()
	if err := d.Decode(&in); err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			erro(w, http.StatusRequestEntityTooLarge, "corpo grande demais")
			return
		}
		erro(w, http.StatusBadRequest, "endpoint required")
		return
	}
	if in.Endpoint == "" {
		erro(w, http.StatusBadRequest, "endpoint required")
		return
	}
	if !permitido(in.Endpoint) {
		erro(w, http.StatusForbidden, "endpoint nao permitido")
		return
	}
	// Vendas ('sales') e Gestão Comercial ('gestor') consultam tudo da lista; 'autenticidade'
	// só produto.
	pode := a.PodeModulo("sales") || a.PodeModulo("gestor")
	if caminhoDeProduto.MatchString(in.Endpoint) {
		pode = pode || a.PodeModulo("autenticidade")
	}
	if !pode {
		erro(w, http.StatusForbidden, "sem permissao")
		return
	}
	lista, err := canais.Carregar(r.Context(), b.Pool, a)
	if err != nil {
		erro(w, http.StatusInternalServerError, "erro_interno")
		return
	}

	// A LISTA de pedidos para quem está limitado: quem recorta é o Bling (`idLoja`, uma loja
	// por chamada), senão a página de 100 chegaria com 30 e a paginação da tela pararia cedo
	// (vendedora veria MENOS venda da própria loja, calada).
	if lista != nil && in.Endpoint == "pedidos/vendas" {
		if len(lista) == 0 {
			responder(w, http.StatusOK, map[string]any{"data": []any{}})
			return
		}
		pedidos := []any{}
		for _, canal := range lista {
			q := query(in.Params)
			q["idLoja"] = strconv.FormatInt(canal, 10)
			st, corpo := b.chamar(r, in.Endpoint, q)
			if st >= 400 {
				responder(w, st, corpo) // erro sobe como veio: "deu ruim" ≠ "não vendeu nada"
				return
			}
			if m, ok := corpo.(map[string]any); ok {
				if dados, ok := m["data"].([]any); ok {
					pedidos = append(pedidos, dados...)
				}
			}
		}
		// Cinto e suspensório: se o recorte do nosso lado tirar algo, o `idLoja` deixou de
		// ser honrado; o certo é erro visível, não lista torta.
		conferido, _ := canais.Recortar(in.Endpoint, map[string]any{"data": pedidos}, lista)
		if len(conferido.(map[string]any)["data"].([]any)) != len(pedidos) {
			erro(w, http.StatusBadGateway, "O filtro de loja do Bling parou de funcionar. Nao vou devolver uma lista pela metade: avise quem cuida do sistema.")
			return
		}
		responder(w, http.StatusOK, conferido)
		return
	}

	st, corpo := b.chamar(r, in.Endpoint, query(in.Params))
	saida, negado := canais.Recortar(in.Endpoint, corpo, lista)
	if negado {
		erro(w, http.StatusForbidden, "sem permissao para este canal")
		return
	}
	responder(w, st, saida)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l internal/ && go vet ./internal/comercial/ && go test -race ./internal/comercial/ -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'`
Expected: só `--- PASS`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/comercial
git commit -m "feat(api): bling-proxy em Go pelo core, com allow-list, portão por caminho e recorte por loja

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `POST /meta-proxy`

**Revisor:** **opus** (portão `meta`, trava de origem da mídia contra SSRF, mapeamento de erro que nunca devolve 401 ao front).

**Files:**
- Create: `api/internal/meta/proxy.go`
- Test: `api/internal/meta/proxy_test.go`

**Interfaces:**
- Consumes: `core.Cliente.Meta`, `core.PedidoMeta`, `core.ErrSemToken` (Task 1); `auth.Exigir`, `auth.ExigirModulo` (Task 2).
- Produces:
  - `type meta.Proxy struct { Pool *pgxpool.Pool; Core *core.Cliente; HostsDeMidia []string }` com `ServeHTTP`, montado atrás de `auth.Exigir` + `auth.ExigirModulo("meta")`.
  - Funções do pacote que a Task 5 usa: `responder(w, status, corpo any)`, `erro(w, status, msg string)`, `textoDe(v any) string`.
  - Para os testes do pacote (Task 5 usa): `montarMeta(t, resp) *ambienteMeta`, `(*ambienteMeta).post(caminho, token, corpo)`, `coreMeta`, `graphOK`, `tokenDoCore` e os usuários `uMeta` (`{meta}`), `uSocial` (`{social}`), `uAdmin` (role `admin`), `uNada`; a tabela `accounts` de teste tem `conta-1` (ig `1784`, anúncio `999`), `42` (ig `1785`), `conta-3` (ig `1786`) e `conta-sem-ig`.

Porta do ramo `CORE_META` de `supabase/functions/meta-proxy/index.ts:53-79` (`viaCore`): trava de origem `:32-48`, método `:60-61`, prazos 25/45/75 s `:68`, sem repetição `:67-69`, erro do core como texto e 401/403 viram 500 `:70-77`. O portão é o de `:96-98`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/meta/proxy_test.go`:

```go
package meta

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const tokenDoCore = "token-secreto-do-core"

// coreMeta é o core de mentira da Graph: guarda os pedidos e responde com `resp`.
type coreMeta struct {
	mu      sync.Mutex
	pedidos []core.PedidoMeta
	resp    func(p core.PedidoMeta) (status int, corpo string, cab map[string]string)
}

func (f *coreMeta) n() int { f.mu.Lock(); defer f.mu.Unlock(); return len(f.pedidos) }

func (f *coreMeta) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var p core.PedidoMeta
	json.NewDecoder(r.Body).Decode(&p)
	f.mu.Lock()
	f.pedidos = append(f.pedidos, p)
	f.mu.Unlock()
	st, corpo, cab := f.resp(p)
	for k, v := range cab {
		w.Header().Set(k, v)
	}
	w.WriteHeader(st)
	io.WriteString(w, corpo)
}

const (
	uMeta   = "aaaaaaaa-0000-0000-0000-000000000011"
	uSocial = "aaaaaaaa-0000-0000-0000-000000000012"
	uAdmin  = "aaaaaaaa-0000-0000-0000-000000000013"
	uNada   = "aaaaaaaa-0000-0000-0000-000000000014"
)

// ambienteMeta monta banco (accounts + perfis), core de mentira e roteador com as rotas do pacote.
type ambienteMeta struct {
	p      *pgxpool.Pool
	h      http.Handler
	core   *coreMeta
	cli    *core.Cliente
	tokens map[string]string
}

func montarMeta(t *testing.T, resp func(core.PedidoMeta) (int, string, map[string]string)) *ambienteMeta {
	t.Helper()
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table accounts (id text primary key, instagram_id text, ad_account_id text, access_token text);
		insert into accounts values ('conta-1', '1784', '999', 'TOKEN-DA-CONTA'), ('42', '1785', null, null), ('conta-3', '1786', null, null), ('conta-sem-ig', null, null, null);`); err != nil {
		t.Fatal(err)
	}
	s := auth.NovoStore(p)
	tokens := map[string]string{}
	for _, u := range []struct{ id, role, features string }{
		{uMeta, "viewer", "{meta}"}, {uSocial, "viewer", "{social}"}, {uAdmin, "admin", "{}"}, {uNada, "viewer", "{banco}"},
	} {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $1::text || '@x')`, u.id); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, features) values ($1::uuid, $1::text || '@x', $2, $3::text[])`, u.id, u.role, u.features); err != nil {
			t.Fatal(err)
		}
		tokens[u.id], _ = s.Criar(ctx, u.id, "painel", nil)
	}
	f := &coreMeta{resp: resp}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	cli := core.Novo(srv.URL, tokenDoCore)
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.With(auth.ExigirModulo("meta")).Post("/meta-proxy", (&Proxy{Pool: p, Core: cli, HostsDeMidia: []string{"midia.exemplo"}}).ServeHTTP)
	})
	return &ambienteMeta{p: p, h: r, core: f, cli: cli, tokens: tokens}
}

func (a *ambienteMeta) post(caminho, token, corpo string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", caminho, strings.NewReader(corpo))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	a.h.ServeHTTP(w, req)
	return w
}

func graphOK(corpo string) func(core.PedidoMeta) (int, string, map[string]string) {
	return func(core.PedidoMeta) (int, string, map[string]string) { return 200, corpo, nil }
}

func TestMetaProxyPortao(t *testing.T) {
	a := montarMeta(t, graphOK(`{"data":[]}`))
	corpo := `{"accountId":"conta-1","path":"/act_999/insights"}`
	for _, c := range []struct {
		nome, token string
		quer        int
	}{{"sem sessão", "", 401}, {"sem o módulo meta", a.tokens[uNada], 403}, {"com meta", a.tokens[uMeta], 200}, {"role admin", a.tokens[uAdmin], 200}} {
		if w := a.post("/meta-proxy", c.token, corpo); w.Code != c.quer {
			t.Errorf("%s: %d, esperava %d", c.nome, w.Code, c.quer)
		}
	}
	if a.core.n() != 2 {
		t.Fatalf("core chamado %d vezes, esperava 2", a.core.n())
	}
}

func TestMetaProxyValidaAntesDoCore(t *testing.T) {
	a := montarMeta(t, graphOK(`{}`))
	casos := []struct {
		corpo, erro string
		quer        int
	}{
		{`{"path":"/me"}`, "accountId e path obrigatorios", 400},
		{`{"accountId":"conta-1"}`, "accountId e path obrigatorios", 400},
		{`{"accountId":"nao-existe","path":"/me"}`, "conta nao encontrada", 400},
		{`{"accountId":"conta-1","path":"/act_1/adimages","imageFromUrl":"http://midia.exemplo/x.png"}`, "origem da imagem nao permitida", 400},
		{`{"accountId":"conta-1","path":"/act_1/adimages","imageFromUrl":"https://169.254.169.254/latest"}`, "origem da imagem nao permitida", 400},
		{`{"accountId":"conta-1","path":"/act_1/adimages","imageFromUrl":"https://midia.exemplo.mal.com/x.png"}`, "origem da imagem nao permitida", 400},
		{`{"accountId":"conta-1","path":"/act_1/advideos","videoFromUrl":"file:///etc/passwd"}`, "origem do video nao permitida", 400},
	}
	for _, c := range casos {
		w := a.post("/meta-proxy", a.tokens[uMeta], c.corpo)
		if w.Code != c.quer || !strings.Contains(w.Body.String(), c.erro) {
			t.Errorf("%s: %d %s", c.corpo, w.Code, w.Body)
		}
	}
	if a.core.n() != 0 {
		t.Fatalf("nada disso podia chegar ao core (%d chamadas)", a.core.n())
	}
	grande := `{"accountId":"conta-1","path":"/me","params":{"x":"` + strings.Repeat("a", 70<<10) + `"}}`
	if w := a.post("/meta-proxy", a.tokens[uMeta], grande); w.Code != 413 || a.core.n() != 0 {
		t.Fatalf("corpo grande: %d", w.Code)
	}
}

func TestMetaProxyMontaOPedidoDoCore(t *testing.T) {
	a := montarMeta(t, graphOK(`{"data":[{"spend":"10.5","id":123456789012345678}]}`))
	w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/act_999/insights","params":{"fields":"spend","nulo":null,"filtro":{"a":1}},"method":"get"}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `123456789012345678`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	b, _ := json.Marshal(a.core.pedidos[0])
	if string(b) != `{"caminho":"/act_999/insights","metodo":"GET","parametros":{"fields":"spend","filtro":{"a":1}}}` {
		t.Fatalf("pedido = %s", b)
	}
	for metodo, quer := range map[string]string{"delete": "DELETE", "POST": "POST", "PATCH": "GET", "": "GET"} {
		a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/123","method":"`+metodo+`"}`)
		if got := a.core.pedidos[a.core.n()-1].Metodo; got != quer {
			t.Errorf("method %q -> %q, esperava %q", metodo, got, quer)
		}
	}
	a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/act_1/adimages","imageFromUrl":"https://midia.exemplo/x.png","imageField":"img1","method":"GET"}`)
	if p := a.core.pedidos[a.core.n()-1]; p.Metodo != "POST" || p.ImagemURL != "https://midia.exemplo/x.png" || p.ImagemCampo != "img1" {
		t.Fatalf("imagem: %+v", p)
	}
	a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/act_1/advideos","videoFromUrl":"https://midia.exemplo/v.mp4"}`)
	if p := a.core.pedidos[a.core.n()-1]; p.Metodo != "POST" || p.VideoURL != "https://midia.exemplo/v.mp4" || p.ImagemURL != "" {
		t.Fatalf("vídeo: %+v", p)
	}
	// accountId numérico também acha a conta (o front manda número ou texto).
	if w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":42,"path":"/me"}`); w.Code != 200 {
		t.Fatalf("accountId numérico: %d %s", w.Code, w.Body)
	}
}

func TestMetaProxyErrosDoCore(t *testing.T) {
	casos := []struct {
		nome           string
		st             int
		corpo, retry   string
		quer           int
		querCorpo      string
		querRetryAfter string
	}{
		{"recuo do core repassa 429 + Retry-After", 429, `{"erro":"meta_em_recuo"}`, "7", 429, `{"error":"meta_em_recuo"}`, "7"},
		{"rede core->Meta vira 500", 502, `{"erro":"falha ao falar com a Meta"}`, "", 500, `{"error":"falha ao falar com a Meta"}`, ""},
		{"credencial da API vira 500, nunca 401", 401, `{"erro":"nao_autorizado"}`, "", 500, `{"error":"nao_autorizado"}`, ""},
		{"barrado no core mantém o 4xx", 400, `{"erro":"caminho ou metodo nao permitido"}`, "", 400, `{"error":"caminho ou metodo nao permitido"}`, ""},
		{"erro da Graph passa tal qual", 400, `{"error":{"message":"Invalid","code":100}}`, "", 400, `{"error":{"code":100,"message":"Invalid"}}`, ""},
		{"5xx sem erro nenhum", 500, `{}`, "", 500, `{"error":"core: 500"}`, ""},
	}
	for _, c := range casos {
		a := montarMeta(t, func(core.PedidoMeta) (int, string, map[string]string) {
			cab := map[string]string{}
			if c.retry != "" {
				cab["Retry-After"] = c.retry
			}
			return c.st, c.corpo, cab
		})
		w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/act_1/campaigns","method":"POST"}`)
		if w.Code != c.quer || strings.TrimSpace(w.Body.String()) != c.querCorpo || w.Header().Get("Retry-After") != c.querRetryAfter {
			t.Errorf("%s: %d %s RA=%q", c.nome, w.Code, w.Body, w.Header().Get("Retry-After"))
		}
		if a.core.n() != 1 {
			t.Errorf("%s: meta-proxy não repete (%d chamadas)", c.nome, a.core.n())
		}
	}
}

func TestMetaProxyCoreForaSemVazarToken(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	a := montarMeta(t, graphOK(`{}`))
	morto := httptest.NewServer(http.NotFoundHandler())
	morto.Close()
	a.cli.URL = morto.URL
	w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/me"}`)
	if w.Code != 500 || strings.Contains(w.Body.String(), tokenDoCore) || strings.Contains(log.String(), tokenDoCore) {
		t.Fatalf("%d %s / log: %s", w.Code, w.Body, log.String())
	}
	a.cli.Token = ""
	if w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/me"}`); w.Code != 503 {
		t.Fatalf("sem token: %d", w.Code)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/meta/ -v`
Expected: FAIL de compilação (`undefined: Proxy`).

- [ ] **Step 3: Implementar**

Crie `api/internal/meta/proxy.go`:

```go
// Package meta: Graph API da Meta (anúncios e Instagram), sempre pelo core
// (POST /api/interno/meta/graph, token global do core). Nenhum token da Meta passa por aqui.
package meta

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
)

func responder(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

func erro(w http.ResponseWriter, status int, msg string) {
	responder(w, status, map[string]string{"error": msg})
}

// textoDe é o `${v}` do JS para um valor do corpo (id de conta, data em segundos...).
func textoDe(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case json.Number:
		return x.String()
	}
	return fmt.Sprint(v)
}

// Proxy é POST /meta-proxy {accountId, path, params, method, imageFromUrl, imageField,
// videoFromUrl}: porta do ramo CORE_META de supabase/functions/meta-proxy (viaCore).
// Deve vir DEPOIS de auth.Exigir + auth.ExigirModulo("meta").
type Proxy struct {
	Pool         *pgxpool.Pool
	Core         *core.Cliente
	HostsDeMidia []string // vazio = nenhum upload de mídia é aceito
}

// midiaPermitida fecha o SSRF: a URL de mídia só pode ser https num host da lista.
func (p *Proxy) midiaPermitida(bruta string) bool {
	u, err := url.Parse(bruta)
	return err == nil && u.Scheme == "https" && u.Host != "" && slices.Contains(p.HostsDeMidia, u.Host)
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		AccountID    any            `json:"accountId"`
		Path         string         `json:"path"`
		Params       map[string]any `json:"params"`
		Method       string         `json:"method"`
		ImageFromURL string         `json:"imageFromUrl"`
		ImageField   string         `json:"imageField"`
		VideoFromURL string         `json:"videoFromUrl"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)) // o core recusa parametros > 64 KB
	d.UseNumber()
	if err := d.Decode(&in); err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			erro(w, http.StatusRequestEntityTooLarge, "corpo grande demais")
			return
		}
		erro(w, http.StatusBadRequest, "accountId e path obrigatorios")
		return
	}
	conta := textoDe(in.AccountID)
	if conta == "" || conta == "0" || in.Path == "" {
		erro(w, http.StatusBadRequest, "accountId e path obrigatorios")
		return
	}
	var existe bool
	if err := p.Pool.QueryRow(r.Context(), `select exists(select 1 from accounts where id::text = $1)`, conta).Scan(&existe); err != nil {
		erro(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	if !existe {
		erro(w, http.StatusBadRequest, "conta nao encontrada")
		return
	}
	if in.ImageFromURL != "" && !p.midiaPermitida(in.ImageFromURL) {
		erro(w, http.StatusBadRequest, "origem da imagem nao permitida")
		return
	}
	if in.ImageFromURL == "" && in.VideoFromURL != "" && !p.midiaPermitida(in.VideoFromURL) {
		erro(w, http.StatusBadRequest, "origem do video nao permitida")
		return
	}
	ped := core.PedidoMeta{Caminho: in.Path, Metodo: "GET", Parametros: map[string]any{}}
	for k, v := range in.Params {
		if v != nil {
			ped.Parametros[k] = v
		}
	}
	if m := strings.ToUpper(in.Method); m == "POST" || m == "DELETE" {
		ped.Metodo = m
	}
	prazo := 25 * time.Second
	switch {
	case in.ImageFromURL != "":
		ped.Metodo, ped.ImagemURL, ped.ImagemCampo, prazo = "POST", in.ImageFromURL, in.ImageField, 45*time.Second
	case in.VideoFromURL != "":
		ped.Metodo, ped.VideoURL, prazo = "POST", in.VideoFromURL, 75*time.Second
	}
	ctx, cancela := context.WithTimeout(r.Context(), prazo)
	defer cancela()
	// Sem repetição aqui (tentativas = 1): o gestor e os robôs já tentam de novo.
	resp, err := p.Core.Meta(ctx, ped, 1)
	if errors.Is(err, core.ErrSemToken) {
		erro(w, http.StatusServiceUnavailable, "core nao configurado")
		return
	}
	if err != nil {
		slog.Error("meta-proxy: sem resposta do core", "caminho", in.Path)
		erro(w, http.StatusInternalServerError, "falha ao falar com o core")
		return
	}
	var j any
	dj := json.NewDecoder(bytes.NewReader(resp.Corpo))
	dj.UseNumber() // números da Graph saem como entraram
	if dj.Decode(&j) != nil {
		j = map[string]any{"raw": string(resp.Corpo)}
	}
	// Erro do PRÓPRIO core vem em `erro` e volta como STRING em `error`: o gestor classifica
	// por aí (barrado antes da Meta = status < 500; desistiu no meio = 500).
	obj, eObj := j.(map[string]any)
	barrado := resp.Status >= 400 && resp.Status < 500 && resp.Status != 401 && resp.Status != 403
	if e, ok := obj["erro"]; eObj && ok {
		st := http.StatusInternalServerError
		if barrado {
			st = resp.Status
		}
		if resp.Status == http.StatusTooManyRequests && resp.RetryAfter != "" {
			w.Header().Set("Retry-After", resp.RetryAfter)
		}
		erro(w, st, fmt.Sprint(e))
		return
	}
	if _, temErro := obj["error"]; eObj && !temErro && resp.Status >= 400 {
		st := http.StatusInternalServerError
		if barrado {
			st = resp.Status
		}
		erro(w, st, fmt.Sprintf("core: %d", resp.Status))
		return
	}
	responder(w, resp.Status, j) // a Graph tal qual (inclusive {error:{...}} da Meta)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l internal/ && go vet ./internal/meta/ && go test -race ./internal/meta/ -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'`
Expected: só `--- PASS`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/meta
git commit -m "feat(api): meta-proxy em Go pelo core, com trava de origem da mídia

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Coletores Meta ao vivo (`/insights-ao-vivo`, `/serie-novos-dia`, `/contar-collabs`)

**Revisor:** padrão.

**Files:**
- Create: `api/internal/meta/ao_vivo.go`
- Modify: `api/internal/meta/proxy_test.go` (montar as 3 rotas em `montarMeta`)
- Test: `api/internal/meta/ao_vivo_test.go`

**Interfaces:**
- Consumes: `core.Cliente.Meta` (Task 1); `auth.ExigirModulo` (Task 2); `responder`, `textoDe`, `montarMeta`, `coreMeta`, `uSocial`, `uMeta` (Task 4).
- Produces: `type meta.AoVivo struct { Pool *pgxpool.Pool; Core *core.Cliente }` com `Insights`, `SerieNovosDia`, `ContarCollabs` (`http.HandlerFunc`), cada um atrás de `auth.Exigir` + `auth.ExigirModulo("social")`. Funções do pacote para o Plano 4 (coletores de cron): `graph`, `comoGraph`, `traduzirURL`, `lerBrutoDoDia`, `semResposta`, `podeBuscarProxima`.

Portas do ramo `CORE_META` de `supabase/functions/insights-ao-vivo/index.ts` (13 chamadas em paralelo `:141-155`, gasto com `paging.next` e teto de 20 páginas `:67-99`, Ads Manager sobrepõe `.ad` `:107-119`, `meta_incompleto` `:169`), `serie-novos-dia/index.ts` (um GET por dia em ondas de 5, teto de 93 dias, `:40-71`) e `contar-collabs/index.ts` (5 páginas por perfil, só convite aceito, sem repetir post `:44-66`), com `comoGraph`/`traduzirUrl` de `_shared/core-meta.js:57-87` e `lerBrutoDoDia` de `_shared/bruto-de-seguidores.js:56-72`. Falta de resposta do core: `insights-ao-vivo` e `contar-collabs` devolvem 500 (`erro interno`), como a edge quando o `fetch` lançava; `serie-novos-dia` marca o dia como `publicado: false`.

- [ ] **Step 1: Escrever os testes que falham**

Em `api/internal/meta/proxy_test.go`, dentro de `montarMeta`, logo depois da linha do `/meta-proxy`, acrescente:

```go
		av := &AoVivo{Pool: p, Core: cli}
		r.With(auth.ExigirModulo("social")).Post("/insights-ao-vivo", av.Insights)
		r.With(auth.ExigirModulo("social")).Post("/serie-novos-dia", av.SerieNovosDia)
		r.With(auth.ExigirModulo("social")).Post("/contar-collabs", av.ContarCollabs)
```

Crie `api/internal/meta/ao_vivo_test.go`:

```go
package meta

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// graphFalsa responde como a Graph (pelo core) de acordo com caminho e parâmetros.
func graphFalsa(p core.PedidoMeta) (int, string, map[string]string) {
	m := func(k string) string { s, _ := p.Parametros[k].(string); return s }
	switch {
	case p.Caminho == "/1784" && m("fields") == "followers_count":
		return 200, `{"followers_count":24345,"id":"1784"}`, nil
	case p.Caminho == "/1784/insights" && strings.HasPrefix(m("metric"), "views"):
		if m("since") == "erro" {
			return 400, `{"error":{"message":"Invalid metric","code":100}}`, nil
		}
		return 200, `{"data":[{"name":"views","total_value":{"value":100}},{"name":"reach","total_value":{"value":50}}]}`, nil
	case p.Caminho == "/1784/insights" && strings.HasPrefix(m("metric"), "likes"):
		return 200, `{"data":[{"name":"likes","total_value":{"breakdowns":[{"results":[
			{"dimension_values":["POST"],"value":3},{"dimension_values":["REEL"],"value":2},{"dimension_values":["AD"],"value":4}]}]}}]}`, nil
	case p.Caminho == "/1784/insights" && m("metric") == "follows_and_unfollows":
		return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[{"dimension_values":["FOLLOWER"],"value":14},{"dimension_values":["NON_FOLLOWER"],"value":3}]}]}}]}`, nil
	case p.Caminho == "/1784/insights" && m("metric") == "replies":
		return 200, `{"data":[{"total_value":{"value":7}}]}`, nil
	case p.Caminho == "/act_999/insights" && m("fields") == "spend":
		return 200, `{"data":[{"spend":"10.5"}]}`, nil
	case p.Caminho == "/act_999/insights" && m("fields") == "actions":
		return 200, `{"data":[{"actions":[{"action_type":"post_reaction","value":"9"},{"action_type":"comment","value":"2"}]}]}`, nil
	case p.Caminho == "/act_999/insights" && m("fields") == "campaign_id,spend":
		if m("after") == "P2" {
			return 200, `{"data":[{"campaign_id":"c1","spend":"1.5"}]}`, nil
		}
		return 200, `{"data":[{"campaign_id":"c1","spend":"5"},{"campaign_id":"c2","spend":"7"}],
			"paging":{"next":"https://graph.facebook.com/v22.0/act_999/insights?fields=campaign_id%2Cspend&level=campaign&after=P2&limit=500&access_token=***"}}`, nil
	}
	return 404, `{"erro":"rota de teste desconhecida"}`, nil
}

func decodificar(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	return m
}

func TestInsightsAoVivo(t *testing.T) {
	a := montarMeta(t, graphFalsa)
	w := a.post("/insights-ao-vivo", a.tokens[uSocial], `{"account_id":"conta-1","engSince":1759287600,"engUntil":1759892400,"folSince":"1","folUntil":"2"}`)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	m := decodificar(t, w)
	b, _ := json.Marshal(m)
	quer := `{"engajamento":{"interacoes":0,"reach":50,"views":100,"visitas":0},"followers_count":24345,` +
		`"interacoes":{"comentarios":{"ad":2,"geral":2,"org":0,"post":0,"reel":0,"story":0},` +
		`"compartilhamentos":{"ad":0,"geral":0,"org":0,"post":0,"reel":0,"story":0},` +
		`"curtidas":{"ad":9,"geral":14,"org":5,"post":3,"reel":2,"story":0},` +
		`"salvamentos":{"ad":0,"geral":0,"org":0,"post":0,"reel":0,"story":0}},` +
		`"investimento":10.5,"novos":{"deixou":3,"seguiu":14,"total":11},"respostas":7}`
	if string(b) != quer {
		t.Fatalf("saída =\n%s\nesperava\n%s", b, quer)
	}
	for _, p := range a.core.pedidos {
		if p.Caminho == "/act_999/insights" && p.Parametros["time_range"] != `{"since":"2025-10-01","until":"2025-10-07"}` {
			t.Fatalf("janela em São Paulo errada: %v", p.Parametros["time_range"])
		}
	}
}

func TestInsightsAoVivoCampanhasPeriodoAnteriorEErros(t *testing.T) {
	a := montarMeta(t, graphFalsa)
	w := a.post("/insights-ao-vivo", a.tokens[uSocial], `{"account_id":"conta-1","engSince":"1759287600","engUntil":"1759892400",
		"folSince":"1","folUntil":"2","prevEngSince":"erro","prevEngUntil":"2","prevFolSince":"1","prevFolUntil":"2","campanhas":["c1"]}`)
	m := decodificar(t, w)
	if m["investimento"] != 6.5 {
		t.Fatalf("soma só de c1 nas duas páginas = %v", m["investimento"])
	}
	ant, ok := m["anterior"].(map[string]any)
	if !ok || m["meta_erro"] != "meta_incompleto" || ant["engajamento"] == nil {
		t.Fatalf("anterior/meta_erro: %s", w.Body)
	}
	var pagina2 *core.PedidoMeta
	for i, p := range a.core.pedidos {
		if p.Parametros["after"] == "P2" {
			pagina2 = &a.core.pedidos[i]
		}
	}
	if pagina2 == nil || pagina2.Caminho != "/act_999/insights" || pagina2.Parametros["access_token"] != nil {
		t.Fatalf("paging.next traduzido errado: %+v", pagina2)
	}
	semAd := a.post("/insights-ao-vivo", a.tokens[uSocial], `{"account_id":"42","engSince":"1","engUntil":"2","folSince":"1","folUntil":"2"}`)
	if m := decodificar(t, semAd); m["investimento"] != nil {
		t.Fatalf("sem conta de anúncio o investimento é null: %v", m["investimento"])
	}
	if w := a.post("/insights-ao-vivo", a.tokens[uSocial], `{"account_id":"nao-existe"}`); w.Code != 404 {
		t.Fatalf("conta inexistente: %d", w.Code)
	}
	if w := a.post("/insights-ao-vivo", a.tokens[uMeta], `{"account_id":"conta-1"}`); w.Code != 403 {
		t.Fatalf("sem o módulo social: %d", w.Code)
	}
	morto := httptest.NewServer(http.NotFoundHandler())
	morto.Close()
	a.cli.URL = morto.URL
	if w := a.post("/insights-ao-vivo", a.tokens[uSocial], `{"account_id":"conta-1","engSince":"1","engUntil":"2","folSince":"1","folUntil":"2"}`); w.Code != 500 || !strings.Contains(w.Body.String(), "erro interno") {
		t.Fatalf("core fora: %d %s", w.Code, w.Body)
	}
}

func TestSerieNovosDia(t *testing.T) {
	var simultaneas, pico atomic.Int32
	a := montarMeta(t, func(p core.PedidoMeta) (int, string, map[string]string) {
		n := simultaneas.Add(1)
		defer simultaneas.Add(-1)
		for v := pico.Load(); n > v && !pico.CompareAndSwap(v, n); v = pico.Load() {
		}
		time.Sleep(5 * time.Millisecond)
		switch p.Parametros["since"] {
		case "1":
			return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[{"dimension_values":["FOLLOWER"],"value":5},{"dimension_values":["NON_FOLLOWER"],"value":1}]}]}}]}`, nil
		case "2":
			return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[]}]}}]}`, nil
		}
		return 500, `{"erro":"falhou"}`, nil
	})
	w := a.post("/serie-novos-dia", a.tokens[uSocial], `{"account_id":"conta-1","dias":[{"since":1,"until":2,"label":"01/10"},{"since":"2","until":"3","label":"02/10"},{"since":"3","until":"4","label":"03/10"}]}`)
	b, _ := json.Marshal(decodificar(t, w))
	quer := `{"serie":[{"deixou":1,"label":"01/10","publicado":true,"seguiu":5},{"deixou":0,"label":"02/10","publicado":false,"seguiu":0},{"deixou":0,"label":"03/10","publicado":false,"seguiu":0}]}`
	if string(b) != quer {
		t.Fatalf("%s", b)
	}
	var dias []string
	for i := 0; i < 100; i++ {
		dias = append(dias, `{"since":"9","until":"9","label":"x"}`)
	}
	antes := a.core.n()
	a.post("/serie-novos-dia", a.tokens[uSocial], `{"account_id":"conta-1","dias":[`+strings.Join(dias, ",")+`]}`)
	if a.core.n()-antes != 93 || pico.Load() > 5 {
		t.Fatalf("teto de 93 dias e ondas de 5: %d chamadas, pico %d", a.core.n()-antes, pico.Load())
	}
	if w := a.post("/serie-novos-dia", a.tokens[uSocial], `{"account_id":"conta-1","dias":[]}`); strings.TrimSpace(w.Body.String()) != `{"serie":[]}` {
		t.Fatalf("sem dias: %s", w.Body)
	}
}

func TestContarCollabs(t *testing.T) {
	var mu sync.Mutex
	caminhos := map[string]bool{}
	a := montarMeta(t, func(p core.PedidoMeta) (int, string, map[string]string) {
		mu.Lock()
		caminhos[p.Caminho] = true
		mu.Unlock()
		aceito := `{"data":[{"id":"1784","invite_status":"Accepted"}]}`
		switch {
		case p.Caminho == "/1785/media" && p.Parametros["after"] == "A2":
			return 200, `{"data":[{"id":"m1","media_product_type":"FEED","collaborators":` + aceito + `}]}`, nil
		case p.Caminho == "/1785/media":
			return 200, `{"data":[{"id":"m1","media_product_type":"FEED","collaborators":` + aceito + `},
				{"id":"m2","media_product_type":"REELS","collaborators":` + aceito + `},
				{"id":"m3","media_product_type":"FEED","collaborators":{"data":[{"id":"1784","invite_status":"Pending"}]}}],
				"paging":{"cursors":{"after":"A2"}}}`, nil
		}
		return 400, `{"error":{"message":"sem acesso"}}`, nil
	})
	w := a.post("/contar-collabs", a.tokens[uSocial], `{"account_id":"conta-1","since":"2026-10-01","until":"2026-10-07"}`)
	if strings.TrimSpace(w.Body.String()) != `{"posts":1,"reels":1}` {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if caminhos["/1784/media"] || caminhos["/null/media"] || !caminhos["/1786/media"] {
		t.Fatalf("perfis varridos: %v", caminhos)
	}
	antes := a.core.n()
	if w := a.post("/contar-collabs", a.tokens[uSocial], `{"account_id":"conta-1"}`); strings.TrimSpace(w.Body.String()) != `{"posts":0,"reels":0}` || a.core.n() != antes {
		t.Fatalf("sem datas: %s", w.Body)
	}
}

func TestPecasPuras(t *testing.T) {
	if g := comoGraph(429, obj{"erro": "meta_em_recuo"}); g["error"].(obj)["message"] != "core: meta_em_recuo" || g["error"].(obj)["code"] != 429 {
		t.Fatalf("comoGraph erro do core: %v", g)
	}
	graph := obj{"error": obj{"message": "x"}}
	if g := comoGraph(400, graph); g["error"].(obj)["message"] != "x" {
		t.Fatalf("erro da Graph passa: %v", g)
	}
	if g := comoGraph(502, obj{"raw": strings.Repeat("z", 300)}); len(g["error"].(obj)["message"].(string)) != len("core: ")+200 {
		t.Fatal("raw é cortado em 200")
	}
	cam, params, ok := traduzirURL("https://graph.facebook.com/v21.0/act_9/insights?fields=spend&access_token=***&time_range=%7B%22since%22%3A%221%22%7D")
	if !ok || cam != "/act_9/insights" || params["fields"] != "spend" || params["time_range"] != `{"since":"1"}` || params["access_token"] != nil {
		t.Fatalf("traduzirURL = %q %v %v", cam, params, ok)
	}
	for _, fora := range []string{"https://scontent.fbcdn.net/x.jpg", "http://graph.facebook.com/v21.0/me", "nao e url"} {
		if _, _, ok := traduzirURL(fora); ok {
			t.Errorf("%q não é a Graph", fora)
		}
	}
	if pub, _, _ := lerBrutoDoDia(obj{"data": []any{}}); pub {
		t.Fatal("dia sem linha não foi publicado")
	}
	if diaSP("1760065200") != "2025-10-10" || diaSP("1760065199") != "2025-10-09" {
		t.Fatalf("dia em São Paulo: %s %s", diaSP("1760065200"), diaSP("1760065199"))
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/meta/ -v`
Expected: FAIL de compilação (`undefined: AoVivo`, `undefined: comoGraph`).

- [ ] **Step 3: Implementar**

Crie `api/internal/meta/ao_vivo.go`:

```go
package meta

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"sync"
	"time"
	_ "time/tzdata" // America/Sao_Paulo sem depender do zoneinfo do contêiner

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
)

var saoPaulo = func() *time.Location {
	l, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		panic(err)
	}
	return l
}()

// AoVivo: as rotas que o front chama para KPIs exatos da Meta (portas de
// supabase/functions/insights-ao-vivo, serie-novos-dia e contar-collabs, ramo CORE_META).
// Devem vir DEPOIS de auth.Exigir + auth.ExigirModulo("social").
type AoVivo struct {
	Pool *pgxpool.Pool
	Core *core.Cliente
}

type obj = map[string]any

// graph faz um GET da Graph pelo core e devolve o JSON NO FORMATO DA GRAPH: erro do core
// vira {"error":{"message":"core: ...","type":"CoreProxy","code":N}} (comoGraph de
// _shared/core-meta.js). 429 do core (recuo) repete até 3 vezes (chamarGraph). Erro só
// quando não houve resposta (rede/prazo) ou falta o token.
func (av *AoVivo) graph(ctx context.Context, caminho string, params obj) (obj, error) {
	r, err := av.Core.Meta(ctx, core.PedidoMeta{Caminho: caminho, Metodo: "GET", Parametros: params}, 3)
	if err != nil {
		return nil, err
	}
	var j obj
	d := json.NewDecoder(bytes.NewReader(r.Corpo))
	d.UseNumber() // ids e contagens saem como entraram
	if d.Decode(&j) != nil || j == nil {
		j = obj{"raw": string(r.Corpo)}
	}
	return comoGraph(r.Status, j), nil
}

func comoGraph(status int, j obj) obj {
	if status < 400 {
		return j
	}
	if _, ok := j["error"].(obj); ok {
		return j
	}
	msg := fmt.Sprintf("HTTP %d", status)
	if s, ok := j["erro"].(string); ok && s != "" {
		msg = s
	} else if s, ok := j["message"].(string); ok && s != "" {
		msg = s
	} else if s, ok := j["raw"].(string); ok && s != "" {
		msg = s[:min(len(s), 200)]
	}
	return obj{"error": obj{"message": "core: " + msg, "type": "CoreProxy", "code": status}}
}

var versaoDaGraph = regexp.MustCompile(`^/v\d+\.\d+/`)

// traduzirURL: `paging.next` (https://graph.facebook.com/v22.0/act_1/insights?after=X&access_token=***)
// -> caminho sem versão + parâmetros sem access_token. ok=false se não for a Graph.
func traduzirURL(bruta string) (string, obj, bool) {
	u, err := url.Parse(bruta)
	if err != nil || u.Scheme != "https" || u.Hostname() != "graph.facebook.com" {
		return "", nil, false
	}
	params := obj{}
	for k, vs := range u.Query() {
		if k != "access_token" && len(vs) > 0 {
			params[k] = vs[len(vs)-1]
		}
	}
	caminho := versaoDaGraph.ReplaceAllString(u.Path, "/")
	if caminho == "" {
		caminho = "/"
	}
	return caminho, params, true
}

// semResposta: nulo é "não sei", zero é "não gastou" (gasto-de-campanhas.js).
func semResposta(r obj) bool {
	_, lista := r["data"].([]any)
	return r == nil || r["error"] != nil || !lista
}

func podeBuscarProxima(pagina obj, lidas, max int) bool {
	paging, _ := pagina["paging"].(obj)
	next, _ := paging["next"].(string)
	dados, _ := pagina["data"].([]any)
	return next != "" && len(dados) > 0 && lidas < max
}

func numero(v any) float64 {
	switch x := v.(type) {
	case json.Number:
		f, _ := x.Float64()
		return f
	case float64:
		return x
	case string:
		f, _ := strconv.ParseFloat(x, 64)
		return f
	}
	return 0
}

// primeiro devolve r.data[0] (ou nil).
func primeiro(r obj) obj {
	d, _ := r["data"].([]any)
	if len(d) == 0 {
		return nil
	}
	o, _ := d[0].(obj)
	return o
}

// resultados devolve item.total_value.breakdowns[0].results.
func resultados(item obj) []any {
	tv, _ := item["total_value"].(obj)
	bds, _ := tv["breakdowns"].([]any)
	if len(bds) == 0 {
		return nil
	}
	b0, _ := bds[0].(obj)
	rs, _ := b0["results"].([]any)
	return rs
}

func dimensao(r obj) any {
	dv, _ := r["dimension_values"].([]any)
	if len(dv) == 0 {
		return nil
	}
	return dv[0]
}

// lerBrutoDoDia (bruto-de-seguidores.js): "publicou zero" e "não publicou" NÃO são a mesma coisa.
func lerBrutoDoDia(r obj) (publicado bool, seguiu, deixou float64) {
	item := primeiro(r)
	if item == nil {
		return false, 0, 0
	}
	rs := resultados(item)
	if len(rs) == 0 {
		return false, 0, 0
	}
	for _, x := range rs {
		o, _ := x.(obj)
		switch dimensao(o) {
		case "FOLLOWER":
			seguiu = numero(o["value"])
		case "NON_FOLLOWER":
			deixou = numero(o["value"])
		}
	}
	return true, seguiu, deixou
}

func diaSP(segundos string) string {
	f, _ := strconv.ParseFloat(segundos, 64)
	return time.Unix(int64(f), 0).In(saoPaulo).Format("2006-01-02")
}

func janela(since, until string) string {
	u, _ := strconv.ParseFloat(until, 64)
	b, _ := json.Marshal(struct {
		Since string `json:"since"`
		Until string `json:"until"`
	}{diaSP(since), diaSP(strconv.FormatFloat(u-1, 'f', -1, 64))})
	return string(b)
}

func lerCorpo(w http.ResponseWriter, r *http.Request, destino any) bool {
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10))
	d.UseNumber()
	if err := d.Decode(destino); err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			responder(w, http.StatusRequestEntityTooLarge, obj{"erro": "corpo grande demais"})
		} else {
			responder(w, http.StatusBadRequest, obj{"erro": "corpo invalido"})
		}
		return false
	}
	return true
}

// ── insights-ao-vivo ──────────────────────────────────────────────────────────

type periodo struct{ eS, eU, fS, fU string }

// Insights é POST /insights-ao-vivo. Todas as chamadas em paralelo (a latência é a da mais lenta).
func (av *AoVivo) Insights(w http.ResponseWriter, r *http.Request) {
	var in map[string]any
	if !lerCorpo(w, r, &in) {
		return
	}
	var campanhas []string
	if cs, ok := in["campanhas"].([]any); ok {
		for _, c := range cs {
			campanhas = append(campanhas, textoDe(c))
		}
	}
	var ig, adAcc *string
	err := av.Pool.QueryRow(r.Context(), `select instagram_id::text, ad_account_id::text from accounts where id::text = $1`, textoDe(in["account_id"])).Scan(&ig, &adAcc)
	if errors.Is(err, pgx.ErrNoRows) {
		responder(w, http.StatusNotFound, obj{"meta_erro": "conta não encontrada"})
		return
	}
	if err != nil {
		responder(w, http.StatusInternalServerError, obj{"meta_erro": "erro interno"})
		return
	}
	igID := ""
	if ig != nil {
		igID = *ig
	}
	atual := periodo{textoDe(in["engSince"]), textoDe(in["engUntil"]), textoDe(in["folSince"]), textoDe(in["folUntil"])}
	ant := periodo{textoDe(in["prevEngSince"]), textoDe(in["prevEngUntil"]), textoDe(in["prevFolSince"]), textoDe(in["prevFolUntil"])}
	querAnterior := ant.eS != "" && ant.eU != "" && ant.fS != "" && ant.fU != ""

	ctx := r.Context()
	var (
		wg       sync.WaitGroup
		mu       sync.Mutex
		falhou   error
		seguidor obj
		out      = obj{}
		anterior = obj{}
		incompl  bool
	)
	anotar := func(err error) {
		mu.Lock()
		defer mu.Unlock()
		if err != nil && falhou == nil {
			falhou = err
		}
	}
	por := func(destino obj, p periodo) {
		wg.Go(func() {
			e, err := av.engajamento(ctx, igID, p.eS, p.eU)
			anotar(err)
			mu.Lock()
			destino["engajamento"] = e.obj
			incompl = incompl || e.erro
			mu.Unlock()
		})
		wg.Go(func() {
			i, err := av.interacoes(ctx, igID, p.eS, p.eU)
			anotar(err)
			mu.Lock()
			destino["interacoes"] = i
			mu.Unlock()
		})
		wg.Go(func() {
			n, err := av.novos(ctx, igID, p.fS, p.fU)
			anotar(err)
			mu.Lock()
			destino["novos"] = obj{"seguiu": n.seguiu, "deixou": n.deixou, "total": n.seguiu - n.deixou}
			incompl = incompl || n.erro
			mu.Unlock()
		})
		wg.Go(func() {
			v, err := av.respostas(ctx, igID, p.eS, p.eU)
			anotar(err)
			mu.Lock()
			destino["respostas"] = v
			mu.Unlock()
		})
		wg.Go(func() {
			var inv *float64
			var acoes obj
			if adAcc != nil && *adAcc != "" {
				var err error
				inv, err = av.gasto(ctx, *adAcc, p.eS, p.eU, campanhas)
				anotar(err)
				acoes, err = av.acoesDeAnuncio(ctx, *adAcc, p.eS, p.eU)
				anotar(err)
			}
			mu.Lock()
			destino["investimento"] = inv
			destino["_acoes"] = acoes
			mu.Unlock()
		})
	}
	wg.Go(func() {
		f, err := av.graph(ctx, "/"+igID, obj{"fields": "followers_count"})
		anotar(err)
		mu.Lock()
		seguidor = f
		mu.Unlock()
	})
	por(out, atual)
	if querAnterior {
		por(anterior, ant)
	}
	wg.Wait()
	if falhou != nil {
		responder(w, http.StatusInternalServerError, obj{"meta_erro": "erro interno"})
		return
	}
	// Interações de anúncio = Ads Manager (sobrepõe o breakdown do IG, que difere).
	for _, d := range []obj{out, anterior} {
		if acoes, ok := d["_acoes"].(obj); ok && acoes != nil {
			fundirAnuncio(d["interacoes"].(map[string]map[string]float64), acoes)
		}
		delete(d, "_acoes")
	}
	out["followers_count"] = seguidor["followers_count"]
	if querAnterior {
		out["anterior"] = anterior
	}
	if incompl {
		out["meta_erro"] = "meta_incompleto"
	}
	responder(w, http.StatusOK, out)
}

type leitura struct {
	obj  obj
	erro bool
}

func (av *AoVivo) engajamento(ctx context.Context, ig, eS, eU string) (leitura, error) {
	r, err := av.graph(ctx, "/"+ig+"/insights", obj{"metric": "views,reach,total_interactions,profile_views", "period": "day", "metric_type": "total_value", "since": eS, "until": eU})
	if err != nil {
		return leitura{}, err
	}
	em := map[string]float64{}
	dados, _ := r["data"].([]any)
	for _, x := range dados {
		it, _ := x.(obj)
		tv, _ := it["total_value"].(obj)
		nome, _ := it["name"].(string)
		em[nome] = numero(tv["value"])
	}
	return leitura{obj{"views": em["views"], "reach": em["reach"], "interacoes": em["total_interactions"], "visitas": em["profile_views"]}, r["error"] != nil}, nil
}

type novosLidos struct {
	seguiu, deixou float64
	erro           bool
}

func (av *AoVivo) novos(ctx context.Context, ig, fS, fU string) (novosLidos, error) {
	r, err := av.graph(ctx, "/"+ig+"/insights", obj{"metric": "follows_and_unfollows", "period": "day", "metric_type": "total_value", "breakdown": "follow_type", "since": fS, "until": fU})
	if err != nil {
		return novosLidos{}, err
	}
	n := novosLidos{erro: r["error"] != nil}
	for _, x := range resultados(primeiro(r)) {
		o, _ := x.(obj)
		switch dimensao(o) {
		case "FOLLOWER":
			n.seguiu = numero(o["value"])
		case "NON_FOLLOWER":
			n.deixou = numero(o["value"])
		}
	}
	return n, nil
}

var tipoDeConteudo = map[string]string{"POST": "post", "REEL": "reel", "STORY": "story", "AD": "ad"}

// interacoes por tipo de conteúdo; geral = tudo, org = sem anúncio.
func (av *AoVivo) interacoes(ctx context.Context, ig, eS, eU string) (map[string]map[string]float64, error) {
	r, err := av.graph(ctx, "/"+ig+"/insights", obj{"metric": "likes,comments,saves,shares", "period": "day", "metric_type": "total_value", "breakdown": "media_product_type", "since": eS, "until": eU})
	if err != nil {
		return nil, err
	}
	nomes := map[string]string{"likes": "curtidas", "comments": "comentarios", "saves": "salvamentos", "shares": "compartilhamentos"}
	inter := map[string]map[string]float64{}
	for _, m := range nomes {
		inter[m] = map[string]float64{"post": 0, "reel": 0, "story": 0, "ad": 0, "geral": 0, "org": 0}
	}
	dados, _ := r["data"].([]any)
	for _, x := range dados {
		it, _ := x.(obj)
		nome, _ := it["name"].(string)
		dest := inter[nomes[nome]]
		if dest == nil {
			continue
		}
		for _, y := range resultados(it) {
			o, _ := y.(obj)
			t, _ := dimensao(o).(string)
			v := numero(o["value"])
			if k, ok := tipoDeConteudo[t]; ok {
				dest[k] += v
			}
			dest["geral"] += v
			if t != "AD" {
				dest["org"] += v
			}
		}
	}
	return inter, nil
}

func (av *AoVivo) respostas(ctx context.Context, ig, eS, eU string) (float64, error) {
	r, err := av.graph(ctx, "/"+ig+"/insights", obj{"metric": "replies", "period": "day", "metric_type": "total_value", "since": eS, "until": eU})
	if err != nil {
		return 0, err
	}
	tv, _ := primeiro(r)["total_value"].(obj)
	return numero(tv["value"]), nil
}

const maxPaginas = 20 // teto: a Graph pode mandar paging.next para sempre

// gasto do período: sem campanhas, level=account; com campanhas, level=campaign somando
// só as escolhidas e seguindo paging.next. nil = "não sei" (meia soma é pior que nada).
func (av *AoVivo) gasto(ctx context.Context, conta, eS, eU string, campanhas []string) (*float64, error) {
	jan := janela(eS, eU)
	if len(campanhas) == 0 {
		r, err := av.graph(ctx, "/act_"+conta+"/insights", obj{"fields": "spend", "level": "account", "time_range": jan})
		if err != nil || semResposta(r) {
			return nil, err
		}
		v := numero(primeiro(r)["spend"])
		return &v, nil
	}
	pagina, err := av.graph(ctx, "/act_"+conta+"/insights", obj{"fields": "campaign_id,spend", "level": "campaign", "time_range": jan, "limit": "500"})
	if err != nil || semResposta(pagina) {
		return nil, err
	}
	linhas := append([]any{}, pagina["data"].([]any)...)
	for lidas := 1; podeBuscarProxima(pagina, lidas, maxPaginas); lidas++ {
		caminho, params, ok := traduzirURL(pagina["paging"].(obj)["next"].(string))
		if !ok {
			return nil, nil
		}
		if pagina, err = av.graph(ctx, caminho, params); err != nil || semResposta(pagina) {
			return nil, err
		}
		linhas = append(linhas, pagina["data"].([]any)...)
	}
	alvo := map[string]bool{}
	for _, c := range campanhas {
		alvo[c] = true
	}
	total := 0.0
	for _, x := range linhas {
		l, _ := x.(obj)
		if alvo[textoDe(l["campaign_id"])] {
			total += numero(l["spend"])
		}
	}
	return &total, nil
}

// acoesDeAnuncio: interações de anúncio pelo Ads Manager (a fonte certa para .ad).
func (av *AoVivo) acoesDeAnuncio(ctx context.Context, conta, eS, eU string) (obj, error) {
	r, err := av.graph(ctx, "/act_"+conta+"/insights", obj{"fields": "actions", "level": "account", "time_range": janela(eS, eU)})
	if err != nil {
		return nil, err
	}
	a := map[string]float64{}
	acoes, _ := primeiro(r)["actions"].([]any)
	for _, x := range acoes {
		o, _ := x.(obj)
		tipo, _ := o["action_type"].(string)
		a[tipo] = numero(o["value"])
	}
	return obj{"curtidas": a["post_reaction"], "comentarios": a["comment"], "salvamentos": a["onsite_conversion.post_save"], "compartilhamentos": a["post"]}, nil
}

// fundirAnuncio sobrepõe .ad (Ads Manager) e recalcula geral = orgânico + anúncio.
func fundirAnuncio(inter map[string]map[string]float64, acoes obj) {
	for _, m := range []string{"curtidas", "comentarios", "salvamentos", "compartilhamentos"} {
		v, _ := acoes[m].(float64)
		inter[m]["ad"] = v
		inter[m]["geral"] = inter[m]["org"] + v
	}
}

// ── serie-novos-dia ───────────────────────────────────────────────────────────

// SerieNovosDia é POST /serie-novos-dia {account_id, dias:[{since, until, label}]}: um GET
// por dia (o core não aceita o batch da Graph), em ondas de 5, no máximo 93 dias.
func (av *AoVivo) SerieNovosDia(w http.ResponseWriter, r *http.Request) {
	var in struct {
		AccountID any   `json:"account_id"`
		Dias      []obj `json:"dias"`
	}
	if !lerCorpo(w, r, &in) {
		return
	}
	if len(in.Dias) == 0 {
		responder(w, http.StatusOK, obj{"serie": []any{}})
		return
	}
	var ig *string
	err := av.Pool.QueryRow(r.Context(), `select instagram_id::text from accounts where id::text = $1`, textoDe(in.AccountID)).Scan(&ig)
	if errors.Is(err, pgx.ErrNoRows) {
		responder(w, http.StatusNotFound, obj{"erro": "conta não encontrada"})
		return
	}
	if err != nil {
		responder(w, http.StatusInternalServerError, obj{"erro": "erro interno"})
		return
	}
	igID := ""
	if ig != nil {
		igID = *ig
	}
	dias := in.Dias[:min(len(in.Dias), 93)]
	serie := make([]obj, len(dias))
	for ini := 0; ini < len(dias); ini += 5 {
		var wg sync.WaitGroup
		for i := ini; i < min(ini+5, len(dias)); i++ {
			wg.Go(func() {
				d := dias[i]
				resp, err := av.graph(r.Context(), "/"+igID+"/insights", obj{"metric": "follows_and_unfollows", "period": "day",
					"metric_type": "total_value", "breakdown": "follow_type", "since": textoDe(d["since"]), "until": textoDe(d["until"])})
				publicado, seguiu, deixou := false, 0.0, 0.0
				if err == nil { // sem resposta = "não publicado", nunca um zero que parece verdade
					publicado, seguiu, deixou = lerBrutoDoDia(resp)
				}
				serie[i] = obj{"label": d["label"], "seguiu": seguiu, "deixou": deixou, "publicado": publicado}
			})
		}
		wg.Wait()
	}
	responder(w, http.StatusOK, obj{"serie": serie})
}

// ── contar-collabs ────────────────────────────────────────────────────────────

// ContarCollabs é POST /contar-collabs {account_id, since, until}: conta posts/reels em COLLAB
// do perfil-alvo varrendo a /media dos OUTROS perfis da RBV (até 5 páginas por perfil).
func (av *AoVivo) ContarCollabs(w http.ResponseWriter, r *http.Request) {
	var in struct {
		AccountID any `json:"account_id"`
		Since     any `json:"since"`
		Until     any `json:"until"`
	}
	if !lerCorpo(w, r, &in) {
		return
	}
	since, until, conta := textoDe(in.Since), textoDe(in.Until), textoDe(in.AccountID)
	if since == "" || until == "" {
		responder(w, http.StatusOK, obj{"posts": 0, "reels": 0})
		return
	}
	var alvo *string
	err := av.Pool.QueryRow(r.Context(), `select instagram_id::text from accounts where id::text = $1`, conta).Scan(&alvo)
	if errors.Is(err, pgx.ErrNoRows) {
		responder(w, http.StatusNotFound, obj{"erro": "conta não encontrada"})
		return
	}
	if err != nil {
		responder(w, http.StatusInternalServerError, obj{"erro": "erro interno"})
		return
	}
	linhas, err := av.Pool.Query(r.Context(), `select instagram_id::text from accounts where id::text <> $1 and instagram_id is not null`, conta)
	if err != nil {
		responder(w, http.StatusInternalServerError, obj{"erro": "erro interno"})
		return
	}
	outros, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		responder(w, http.StatusInternalServerError, obj{"erro": "erro interno"})
		return
	}
	alvoIG := ""
	if alvo != nil {
		alvoIG = *alvo
	}
	posts, reels := 0, 0
	vistos := map[string]bool{}
	for _, o := range outros {
		after := ""
		for pag := 0; pag < 5; pag++ {
			params := obj{"fields": "id,media_product_type,collaborators", "since": since, "until": until, "limit": "50"}
			if after != "" {
				params["after"] = after
			}
			m, err := av.graph(r.Context(), "/"+o+"/media", params)
			if err != nil {
				responder(w, http.StatusInternalServerError, obj{"erro": "erro interno"})
				return
			}
			if m["error"] != nil {
				break
			}
			dados, _ := m["data"].([]any)
			for _, x := range dados {
				it, _ := x.(obj)
				id := textoDe(it["id"])
				col, _ := it["collaborators"].(obj)
				lista, _ := col["data"].([]any)
				for _, c := range lista {
					co, _ := c.(obj)
					if textoDe(co["id"]) == alvoIG && co["invite_status"] == "Accepted" && !vistos[id] {
						vistos[id] = true
						if it["media_product_type"] == "REELS" {
							reels++
						} else {
							posts++
						}
					}
				}
			}
			paging, _ := m["paging"].(obj)
			cursors, _ := paging["cursors"].(obj)
			after, _ = cursors["after"].(string)
			if after == "" {
				break
			}
		}
	}
	responder(w, http.StatusOK, obj{"posts": posts, "reels": reels})
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l internal/ && go vet ./internal/meta/ && go test -race ./internal/meta/ -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'`
Expected: só `--- PASS` (o `-race` importa: `Insights` escreve de várias goroutines).

- [ ] **Step 5: Commit**

```bash
git add api/internal/meta
git commit -m "feat(api): coletores Meta ao vivo (insights, série de novos seguidores e collabs) pelo core

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Web Push e push de vendas no worker

**Revisor:** **opus** (cripto do RFC 8291/8292 e endpoint vindo do navegador).

**Files:**
- Create: `api/internal/webpush/webpush.go`
- Create: `api/internal/comercial/vendas.go`, `api/internal/comercial/push_vendas.go`
- Test: `api/internal/webpush/webpush_test.go`, `api/internal/comercial/vendas_test.go`, `api/internal/comercial/push_vendas_test.go`

**Interfaces:**
- Consumes: `core.Cliente.Bling` (Task 1); `coreFalso` (teste da Task 3); `worker.Tarefa` (Plano 1).
- Produces:
  - `type webpush.VAPID struct { Publica, Privada, Assunto string }` (base64url do web-push do npm); `type webpush.Inscricao struct { Endpoint, P256dh, Auth string }`.
  - `func webpush.Enviar(ctx context.Context, cli *http.Client, s webpush.Inscricao, payload []byte, v webpush.VAPID) (status int, err error)` — 201 aceito; 404/410 = apagar a inscrição; erro = sem resposta ou dado inválido. Os pushes de saldo e frota (Plano 4) usam o mesmo.
  - `type comercial.PushVendas struct { Pool *pgxpool.Pool; Core *core.Cliente; VAPID webpush.VAPID; HTTP *http.Client; Agora func() time.Time }`.
  - `func (pv *PushVendas) Tarefas() []worker.Tarefa` — `push-vendas-07h` (`0 10 * * *`, modo `ontem`) e `push-vendas-22h` (`0 1 * * *`, modo `hoje`), limite 5 min.
  - `func (pv *PushVendas) Rodar(ctx context.Context, modo string) error`.

Porta de `supabase/functions/enviar-push-vendas/index.ts:110-277`, com as regras puras de `_shared/data-da-venda.js:65-122` (com `nota_situacao`, ver Ruling), `_shared/valor-corrigido.js:53-70`, `_shared/vendas-do-dia.js:35-87` e o filtro de `_shared/notificacoes.js:92-110` (tipo `vendas` ligado por padrão) feito em SQL. Itens: cache `bling_pedido_vendedor` e detalhe do que falta com até 8 em paralelo e 90 s (`:37-38,207-237`). Web Push: corpo `aes128gcm` de um registro (RFC 8291 §3.4, RFC 8188), VAPID ES256 com `aud` = origem do endpoint, `exp` = 12 h, `TTL` 2419200 (os padrões do `npm:web-push`). As saídas de `montarCorpo` foram conferidas contra o JS (mesmo texto, `R$` com espaço não separável U+00A0, arredondamento do `Math.round`).

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/webpush/webpush_test.go` (vetor do RFC 8291 Apêndice A byte a byte; decifragem do lado do navegador; assinatura VAPID conferida com a chave pública; recusas):

```go
package webpush

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func dec(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// RFC 8291, Apêndice A: chaves, salt e o registro cifrado esperado, byte a byte.
func TestCifrarVetorDoRFC8291(t *testing.T) {
	as, err := ecdh.P256().NewPrivateKey(dec(t, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	got, err := cifrar([]byte("When I grow up, I want to be a watermelon"),
		dec(t, "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"),
		dec(t, "BTBZMqHH6r4Tts7J_aSIgg"), as, dec(t, "DGv6ra1nlYgDCS1FRnbzlw"))
	if err != nil {
		t.Fatal(err)
	}
	const quer = "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
	if base64.RawURLEncoding.EncodeToString(got) != quer {
		t.Fatalf("registro cifrado difere do RFC 8291:\n%s", base64.RawURLEncoding.EncodeToString(got))
	}
}

// decifrar faz o papel do NAVEGADOR (RFC 8291 §3.4): prova que o que sai daqui abre do lado de lá.
func decifrar(t *testing.T, corpo []byte, ua *ecdh.PrivateKey, authSecret []byte) []byte {
	t.Helper()
	salt, asPub, ct := corpo[:16], corpo[21:86], corpo[86:]
	pub, err := ecdh.P256().NewPublicKey(asPub)
	if err != nil {
		t.Fatal(err)
	}
	segredo, _ := ua.ECDH(pub)
	info := append(append([]byte("WebPush: info\x00"), ua.PublicKey().Bytes()...), asPub...)
	ikm, _ := hkdf.Key(sha256.New, segredo, authSecret, string(info), 32)
	cek, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	bloco, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(bloco)
	claro, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		t.Fatalf("não decifra: %v", err)
	}
	return claro[:len(claro)-1] // tira o delimitador 0x02
}

func chavesVAPID(t *testing.T) (VAPID, *ecdsa.PublicKey) {
	t.Helper()
	k, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	d, _ := k.Bytes()
	pub, _ := k.PublicKey.Bytes()
	return VAPID{Publica: base64.RawURLEncoding.EncodeToString(pub), Privada: base64.RawURLEncoding.EncodeToString(d), Assunto: "mailto:teste@exemplo.com"}, &k.PublicKey
}

// servicoDePush é um serviço de push de mentira em https://example.com (o certificado do
// httptest vale para esse nome) e o cliente que disca nele.
func servicoDePush(t *testing.T, h http.HandlerFunc) *http.Client {
	t.Helper()
	srv := httptest.NewTLSServer(h)
	t.Cleanup(srv.Close)
	cli := srv.Client()
	cli.Transport.(*http.Transport).DialContext = func(ctx context.Context, rede, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, rede, srv.Listener.Addr().String())
	}
	return cli
}

func TestEnviarEntregaCifradoComVAPIDValido(t *testing.T) {
	v, pubVAPID := chavesVAPID(t)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	authSecret := make([]byte, 16)
	rand.Read(authSecret)
	var recebido []byte
	var cab http.Header
	cli := servicoDePush(t, func(w http.ResponseWriter, r *http.Request) {
		recebido, _ = io.ReadAll(r.Body)
		cab = r.Header.Clone()
		w.WriteHeader(http.StatusCreated)
	})
	ins := Inscricao{Endpoint: "https://example.com/push/abc", P256dh: base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()), Auth: base64.RawURLEncoding.EncodeToString(authSecret) + "=="}
	st, err := Enviar(context.Background(), cli, ins, []byte(`{"title":"oi"}`), v)
	if err != nil || st != 201 {
		t.Fatalf("st=%d err=%v", st, err)
	}
	if got := decifrar(t, recebido, ua, authSecret); string(got) != `{"title":"oi"}` {
		t.Fatalf("payload = %q", got)
	}
	if cab.Get("Content-Encoding") != "aes128gcm" || cab.Get("TTL") == "" {
		t.Fatalf("cabeçalhos = %v", cab)
	}
	t1, ok := strings.CutPrefix(cab.Get("Authorization"), "vapid t=")
	jwt, k, ok2 := strings.Cut(t1, ", k=")
	if !ok || !ok2 || k != v.Publica {
		t.Fatalf("Authorization = %q", cab.Get("Authorization"))
	}
	partes := strings.Split(jwt, ".")
	var claims map[string]any
	json.Unmarshal(dec(t, partes[1]), &claims)
	if claims["aud"] != "https://example.com" || claims["sub"] != v.Assunto || int64(claims["exp"].(float64)) <= time.Now().Unix() {
		t.Fatalf("claims = %v", claims)
	}
	sig := dec(t, partes[2])
	h := sha256.Sum256([]byte(partes[0] + "." + partes[1]))
	if !ecdsa.Verify(pubVAPID, h[:], new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])) {
		t.Fatal("assinatura VAPID não confere")
	}
}

func TestEnviarRecusas(t *testing.T) {
	v, _ := chavesVAPID(t)
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	boa := Inscricao{Endpoint: "https://example.com/p", P256dh: base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()), Auth: base64.RawURLEncoding.EncodeToString(make([]byte, 16))}
	chamadas := 0
	cli := servicoDePush(t, func(w http.ResponseWriter, _ *http.Request) { chamadas++; w.WriteHeader(http.StatusGone) })
	for _, e := range []string{"http://example.com/p", "https://127.0.0.1/p", "https://[::1]/p", "https://localhost/p", "https://169.254.169.254/latest", "nada"} {
		ins := boa
		ins.Endpoint = e
		if _, err := Enviar(context.Background(), cli, ins, []byte("x"), v); err == nil {
			t.Errorf("endpoint %q deveria ser recusado", e)
		}
	}
	ruim := boa
	ruim.P256dh = "nao-e-chave"
	if _, err := Enviar(context.Background(), cli, ruim, []byte("x"), v); err == nil {
		t.Error("p256dh inválida deveria falhar")
	}
	outra, _ := chavesVAPID(t)
	misturada := VAPID{Publica: outra.Publica, Privada: v.Privada, Assunto: v.Assunto}
	if _, err := Enviar(context.Background(), cli, boa, []byte("x"), misturada); err == nil {
		t.Error("par VAPID trocado deveria falhar")
	}
	if chamadas != 0 {
		t.Fatalf("nada disso podia sair (%d chamadas)", chamadas)
	}
	if st, err := Enviar(context.Background(), cli, boa, []byte("x"), v); err != nil || st != http.StatusGone {
		t.Fatalf("410 volta como status, não erro: %d %v", st, err)
	}
}
```

Crie `api/internal/comercial/vendas_test.go`:

```go
package comercial

import (
	"slices"
	"testing"
)

func i64(v int64) *int64 { return &v }
func ip(v int) *int      { return &v }

func TestAjustarPelaDataDaNota(t *testing.T) {
	pedidos := []pedido{
		{ID: 1, Data: "2026-10-09", Total: 100}, // sem linha: fica
		{ID: 2, Data: "2026-10-09", Total: 200}, // nota negada: sai
		{ID: 3, Data: "2026-10-09", Total: 300}, // nota pendente: fica
		{ID: 4, Data: "2026-10-09", Total: 400}, // nota saiu no dia seguinte: sai deste dia
	}
	linhas := []linhaDaNota{
		{PedidoID: 2, DataPedido: "2026-10-09", DataDaVenda: "2026-10-09", NotaSituacao: ip(4)},
		{PedidoID: 3, DataPedido: "2026-10-09", DataDaVenda: "2026-10-09", NotaSituacao: ip(1)},
		{PedidoID: 4, DataPedido: "2026-10-09", DataDaVenda: "2026-10-10", NotaSituacao: ip(6)},
		{PedidoID: 5, DataPedido: "2026-10-08", DataDaVenda: "2026-10-09", Total: 50, LojaID: i64(7), NotaSituacao: ip(5)}, // trazido
		{PedidoID: 6, DataPedido: "2026-10-08", DataDaVenda: "2026-10-09", Total: 60, NotaSituacao: ip(2)},                 // cancelado não é trazido
		{PedidoID: 7, DataPedido: "2026-10-08", DataDaVenda: "2026-10-09", Total: 70},                                      // sem situação não é trazido
	}
	var ids []int64
	for _, p := range ajustarPelaDataDaNota(pedidos, linhas, "2026-10-09", "2026-10-09") {
		ids = append(ids, p.ID)
	}
	if !slices.Equal(ids, []int64{1, 3, 5}) {
		t.Fatalf("ids = %v", ids)
	}
}

func TestAplicarValorCorrigido(t *testing.T) {
	ps := aplicarValorCorrigido([]pedido{{ID: 1, Total: 1900}, {ID: 2, Total: 10}}, map[int64]float64{1: 1615, 2: -5, 9: 99})
	if ps[0].Total != 1615 || ps[1].Total != 10 || len(ps) != 2 {
		t.Fatalf("%+v", ps)
	}
}

func TestBRLESeta(t *testing.T) {
	for v, quer := range map[float64]string{0: "R$ 0", 1234.5: "R$ 1.235", 1615: "R$ 1.615", 1e6: "R$ 1.000.000", 999.49: "R$ 999", 2.5: "R$ 3"} {
		if got := brl(v); got != quer {
			t.Errorf("brl(%v) = %q, esperava %q", v, got, quer)
		}
	}
	casos := []struct {
		ref, cmp float64
		quer     string
	}{{150, 100, "\U0001F4C8 50%"}, {50, 100, "\U0001F4C9 50%"}, {100, 100, "➡️ 0%"}, {10, 0, "\U0001F195"}, {87.5, 100, "\U0001F4C9 12%"}}
	for _, c := range casos {
		if got := seta(c.ref, c.cmp); got != c.quer {
			t.Errorf("seta(%v,%v) = %q, esperava %q", c.ref, c.cmp, got, c.quer)
		}
	}
}

func TestAgregarEMontarCorpo(t *testing.T) {
	lojas := []canalAgregado{{LojaID: 1, Nome: "Tivoli"}, {LojaID: 2, Nome: "Dom Pedro"}, {LojaID: 3, Nome: "Parada"}}
	ref := []pedido{{LojaID: i64(1), Total: 100, Itens: 2}, {LojaID: i64(2), Total: 300, Itens: 1}, {LojaID: i64(99), Total: 50, Itens: 1}}
	cmpDia := []pedido{{LojaID: i64(1), Total: 200, Itens: 1}}
	a := agregarVendasPorCanal(ref, cmpDia, lojas)
	if a.Ref.Valor != 450 || a.Ref.Vendas != 3 || a.Ref.Itens != 4 || a.Canais[0].Nome != "Dom Pedro" {
		t.Fatalf("%+v", a)
	}
	c := montarCorpo(a, "hoje", "ontem")
	if c["title"] != "\U0001F6CD️ Vendas de hoje · R$ 450" {
		t.Fatalf("title = %q", c["title"])
	}
	quer := "\U0001F4C8 125% vs ontem · 3 vendas · 4 itens\nDom Pedro · R$ 300 · \U0001F195\nTivoli · R$ 100 · \U0001F4C9 50%"
	if c["body"] != quer || c["url"] != "/gestao-vista" || c["tag"] != "vendas-do-dia" {
		t.Fatalf("body = %q", c["body"])
	}
	vazio := montarCorpo(agregarVendasPorCanal(nil, nil, lojas), "hoje", "ontem")
	if vazio["body"] != "\U0001F195 vs ontem · 0 vendas · 0 itens\nNenhuma venda registrada hoje ainda." {
		t.Fatalf("vazio = %q", vazio["body"])
	}
	if b := montarCorpo(agregarVendasPorCanal([]pedido{{LojaID: i64(1), Total: 1, Itens: 1}}, nil, lojas), "ontem", "anteontem")["body"]; b != "\U0001F195 vs anteontem · 1 venda · 1 item\nTivoli · R$ 1 · \U0001F195" {
		t.Fatalf("singular = %q", b)
	}
}
```

Crie `api/internal/comercial/push_vendas_test.go` (core de mentira com os pedidos por dia; serviço de push de mentira em `https://example.com`; relógio fixo em 2026-10-10 01:00 UTC = 09/10 22:00 em São Paulo):

```go
package comercial

import (
	"context"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
)

const tabelasDoPush = `
create table bling_lojas (loja_id bigint primary key, nome text, grupo text, grupo_id uuid);
create table bling_pedido_nota (pedido_id bigint primary key, loja_id bigint, data_pedido date not null, total numeric(12,2),
  nota_situacao smallint, data_da_nota date, data_da_venda date generated always as (coalesce(data_da_nota, data_pedido)) stored);
create table bling_pedido_ajuste_valor (pedido_id bigint primary key, total_corrigido numeric(12,2) not null);
create table bling_pedido_vendedor (pedido_id bigint primary key, qtd_itens int);
create table push_subs (endpoint text primary key, p256dh text not null, auth text not null, user_id uuid);
create table push_preferencias (user_id uuid not null, tipo text not null, ativo boolean not null, primary key (user_id, tipo));
insert into bling_lojas values (205657609, 'Dom Pedro', null, null);
insert into bling_pedido_vendedor values (1, 3);
insert into bling_pedido_ajuste_valor values (1, 90);`

type pushFalso struct {
	mu        sync.Mutex
	recebidos []string // caminhos que receberam push
}

// ambientePush: banco, core de mentira (pedidos por dia) e serviço de push em https://example.com.
func ambientePush(t *testing.T, resp func(core.PedidoBling, int) (int, string, map[string]string)) (*PushVendas, *coreFalso, *pushFalso, *pgxpool.Pool) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelasDoPush); err != nil {
		t.Fatal(err)
	}
	f := &coreFalso{resp: resp}
	srvCore := httptest.NewServer(f)
	t.Cleanup(srvCore.Close)
	cli := core.Novo(srvCore.URL, "token-do-core")
	cli.Prazo = 100 * time.Millisecond
	cli.Dormir = func(context.Context, time.Duration) error { return nil }

	pf := &pushFalso{}
	srvPush := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		pf.mu.Lock()
		pf.recebidos = append(pf.recebidos, r.URL.Path)
		pf.mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "/morta") {
			w.WriteHeader(http.StatusGone)
			return
		}
		w.WriteHeader(http.StatusCreated)
	}))
	t.Cleanup(srvPush.Close)
	hc := srvPush.Client()
	hc.Transport.(*http.Transport).DialContext = func(ctx context.Context, rede, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, rede, srvPush.Listener.Addr().String())
	}
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	d, _ := k.Bytes()
	pub, _ := k.PublicKey.Bytes()
	v := webpush.VAPID{Publica: base64.RawURLEncoding.EncodeToString(pub), Privada: base64.RawURLEncoding.EncodeToString(d), Assunto: "mailto:t@exemplo.com"}
	// 2026-10-10 01:00 UTC = 2026-10-09 22:00 em São Paulo
	agora := func() time.Time { return time.Date(2026, 10, 10, 1, 0, 0, 0, time.UTC) }
	return &PushVendas{Pool: p, Core: cli, VAPID: v, HTTP: hc, Agora: agora}, f, pf, p
}

func inscrever(t *testing.T, p *pgxpool.Pool, caminho string, userID any) {
	t.Helper()
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	if _, err := p.Exec(context.Background(), `insert into push_subs values ($1, $2, $3, $4)`, "https://example.com/push/"+caminho,
		base64.RawURLEncoding.EncodeToString(ua.PublicKey().Bytes()), base64.RawURLEncoding.EncodeToString(make([]byte, 16)), userID); err != nil {
		t.Fatal(err)
	}
}

// pedidosPorDia: 09/10 tem o pedido 1 (Dom Pedro, total 100) e o 2 (sem cache de itens); 08/10, o 3.
func pedidosPorDia(p core.PedidoBling, _ int) (int, string, map[string]string) {
	switch {
	case p.Caminho == "/pedidos/vendas" && p.Query["dataInicial"] == "2026-10-09":
		return 200, `{"data":[{"id":1,"data":"2026-10-09","total":100,"loja":{"id":205657609}},{"id":2,"data":"2026-10-09","total":50,"loja":{"id":205657609}}]}`, nil
	case p.Caminho == "/pedidos/vendas" && p.Query["dataInicial"] == "2026-10-08":
		return 200, `{"data":[{"id":3,"data":"2026-10-08","total":70,"loja":{"id":205657609}}]}`, nil
	case p.Caminho == "/pedidos/vendas" && p.Query["dataInicial"] == "2026-10-07":
		return 200, `{"data":[]}`, nil
	case strings.HasPrefix(p.Caminho, "/pedidos/vendas/"):
		return 200, `{"data":{"id":0,"itens":[{},{}]}}`, nil
	}
	return 404, `{}`, nil
}

func TestPushVendasEnviaAQuemQuerEPodaMortas(t *testing.T) {
	pv, f, pf, p := ambientePush(t, pedidosPorDia)
	const quer, naoQuer, semPref = "cccccccc-0000-0000-0000-000000000001", "cccccccc-0000-0000-0000-000000000002", "cccccccc-0000-0000-0000-000000000003"
	inscrever(t, p, "quer", quer)
	inscrever(t, p, "nao-quer", naoQuer)
	inscrever(t, p, "sem-pref", semPref)
	inscrever(t, p, "sem-dono", nil)
	inscrever(t, p, "morta", semPref)
	p.Exec(context.Background(), `insert into push_preferencias values ($1, 'vendas', true), ($2, 'vendas', false)`, quer, naoQuer)
	if err := pv.Rodar(context.Background(), "hoje"); err != nil {
		t.Fatal(err)
	}
	got := strings.Join(pf.recebidos, ",")
	for _, c := range []string{"/push/quer", "/push/sem-pref", "/push/morta"} {
		if !strings.Contains(got, c) {
			t.Errorf("%s não recebeu (%s)", c, got)
		}
	}
	if strings.Contains(got, "nao-quer") || strings.Contains(got, "sem-dono") {
		t.Fatalf("recebeu quem não devia: %s", got)
	}
	var n int
	p.QueryRow(context.Background(), `select count(*) from push_subs where endpoint like '%/morta'`).Scan(&n)
	if n != 0 {
		t.Fatal("inscrição 410 deveria ser apagada")
	}
	// 22h: hoje (09/10) × ontem (08/10); detalhe só do que não está no cache (2 e 3).
	var dias, detalhes []string
	for _, ped := range f.pedidos {
		if ped.Caminho == "/pedidos/vendas" {
			dias = append(dias, ped.Query["dataInicial"].(string))
		} else {
			detalhes = append(detalhes, ped.Caminho)
		}
	}
	if strings.Join(dias, ",") != "2026-10-09,2026-10-08" || len(detalhes) != 2 {
		t.Fatalf("dias=%v detalhes=%v", dias, detalhes)
	}
}

func TestPushVendasModoOntem(t *testing.T) {
	pv, f, _, _ := ambientePush(t, pedidosPorDia)
	if err := pv.Rodar(context.Background(), "ontem"); err != nil {
		t.Fatal(err)
	}
	if f.pedidos[0].Query["dataInicial"] != "2026-10-08" || f.pedidos[1].Query["dataInicial"] != "2026-10-07" {
		t.Fatalf("07h deveria comparar ontem com anteontem: %v %v", f.pedidos[0].Query, f.pedidos[1].Query)
	}
}

func TestPushVendasNaoEnviaComDadoIncompleto(t *testing.T) {
	casos := map[string]func(core.PedidoBling, int) (int, string, map[string]string){
		"bling_indisponivel": func(core.PedidoBling, int) (int, string, map[string]string) { return 503, `{}`, nil },
		"itens_incompletos": func(p core.PedidoBling, n int) (int, string, map[string]string) {
			if strings.HasPrefix(p.Caminho, "/pedidos/vendas/") {
				return 500, `{}`, nil
			}
			return pedidosPorDia(p, n)
		},
	}
	for motivo, resp := range casos {
		pv, _, pf, p := ambientePush(t, resp)
		inscrever(t, p, "quer", "cccccccc-0000-0000-0000-000000000001")
		err := pv.Rodar(context.Background(), "hoje")
		if err == nil || !strings.Contains(err.Error(), motivo) || len(pf.recebidos) != 0 {
			t.Errorf("%s: err=%v pushes=%d", motivo, err, len(pf.recebidos))
		}
	}
	pv, _, _, _ := ambientePush(t, pedidosPorDia)
	pv.VAPID = webpush.VAPID{}
	if err := pv.Rodar(context.Background(), "hoje"); err == nil || !strings.Contains(err.Error(), "vapid") {
		t.Fatalf("sem VAPID: %v", err)
	}
}

func TestPushVendasInscricaoRuimNaoDerrubaAsOutras(t *testing.T) {
	pv, _, pf, p := ambientePush(t, pedidosPorDia)
	inscrever(t, p, "boa", "cccccccc-0000-0000-0000-000000000001")
	p.Exec(context.Background(), `insert into push_subs values ('https://example.com/push/ruim', 'nao-e-chave', 'x', 'cccccccc-0000-0000-0000-000000000002')`)
	if err := pv.Rodar(context.Background(), "hoje"); err != nil {
		t.Fatal(err)
	}
	if strings.Join(pf.recebidos, ",") != "/push/boa" {
		t.Fatalf("recebidos = %v", pf.recebidos)
	}
}

func TestPushVendasAgendas(t *testing.T) {
	ts := (&PushVendas{}).Tarefas()
	if len(ts) != 2 || ts[0].Nome != "push-vendas-07h" || ts[0].Agenda != "0 10 * * *" || ts[1].Nome != "push-vendas-22h" || ts[1].Agenda != "0 1 * * *" {
		t.Fatalf("%+v", ts)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/webpush/ ./internal/comercial/ -v`
Expected: FAIL de compilação (`undefined: cifrar`, `undefined: Enviar`, `undefined: ajustarPelaDataDaNota`, `undefined: PushVendas`).

- [ ] **Step 3: Implementar**

Crie `api/internal/webpush/webpush.go`:

```go
// Package webpush entrega notificações Web Push só com a biblioteca padrão: corpo cifrado
// pelo RFC 8291 (aes128gcm, RFC 8188) e autenticação VAPID (RFC 8292). Substitui o
// `npm:web-push` das edges (enviar-push-vendas e, no Plano 4, saldo e frota).
package webpush

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// VAPID: as chaves no formato do web-push do npm (base64url): pública com 65 bytes
// (ponto não comprimido da P-256), privada com 32 bytes. Assunto: "mailto:...".
type VAPID struct{ Publica, Privada, Assunto string }

// Inscricao é uma linha de push_subs (PushSubscription do navegador).
type Inscricao struct{ Endpoint, P256dh, Auth string }

func b64(s string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(strings.TrimRight(strings.TrimSpace(s), "="))
}

// cifrar monta o corpo aes128gcm de UM registro: salt(16) | rs(4) | idlen(1) | chave do
// servidor(65) | ciphertext. Separado para o teste usar o vetor do RFC 8291, Apêndice A.
func cifrar(payload, uaPub, authSecret []byte, as *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	ua, err := ecdh.P256().NewPublicKey(uaPub)
	if err != nil {
		return nil, fmt.Errorf("p256dh inválida: %w", err)
	}
	segredo, err := as.ECDH(ua)
	if err != nil {
		return nil, err
	}
	asPub := as.PublicKey().Bytes()
	info := append(append([]byte("WebPush: info\x00"), uaPub...), asPub...)
	ikm, err := hkdf.Key(sha256.New, segredo, authSecret, string(info), 32)
	if err != nil {
		return nil, err
	}
	cek, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Key(sha256.New, ikm, salt, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	bloco, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(bloco)
	if err != nil {
		return nil, err
	}
	cab := make([]byte, 0, 86)
	cab = append(cab, salt...)
	cab = binary.BigEndian.AppendUint32(cab, 4096)
	cab = append(cab, byte(len(asPub)))
	cab = append(cab, asPub...)
	// 0x02 = delimitador do último (e único) registro.
	return gcm.Seal(cab, nonce, append(append([]byte{}, payload...), 0x02), nil), nil
}

// jwtVAPID assina o token ES256 do RFC 8292 (assinatura r||s de 64 bytes).
func jwtVAPID(aud, sub string, priv *ecdsa.PrivateKey, exp time.Time) (string, error) {
	cab := base64.RawURLEncoding.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	corpo, err := json.Marshal(map[string]any{"aud": aud, "exp": exp.Unix(), "sub": sub})
	if err != nil {
		return "", err
	}
	assinado := cab + "." + base64.RawURLEncoding.EncodeToString(corpo)
	h := sha256.Sum256([]byte(assinado))
	r, s, err := ecdsa.Sign(rand.Reader, priv, h[:])
	if err != nil {
		return "", err
	}
	sig := make([]byte, 64)
	r.FillBytes(sig[:32])
	s.FillBytes(sig[32:])
	return assinado + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}

// endpointAceito: o endpoint vem do NAVEGADOR (push_subs) e o worker faz POST nele; só https
// num host por nome (nunca IP nem localhost), para não virar SSRF cego para a rede interna.
func endpointAceito(u *url.URL) bool {
	h := u.Hostname()
	return u.Scheme == "https" && h != "" && h != "localhost" && net.ParseIP(h) == nil
}

// Enviar cifra o payload e o entrega. Devolve o status do serviço de push (201 = aceito;
// 404/410 = inscrição morta, apagar). Erro = nem chegou a ter resposta, ou dado inválido.
func Enviar(ctx context.Context, cli *http.Client, s Inscricao, payload []byte, v VAPID) (int, error) {
	u, err := url.Parse(s.Endpoint)
	if err != nil || !endpointAceito(u) {
		return 0, errors.New("webpush: endpoint recusado (precisa ser https num host por nome)")
	}
	uaPub, err := b64(s.P256dh)
	if err != nil {
		return 0, errors.New("webpush: p256dh inválida")
	}
	authSecret, err := b64(s.Auth)
	if err != nil || len(authSecret) != 16 {
		return 0, errors.New("webpush: auth inválido")
	}
	d, err := b64(v.Privada)
	if err != nil {
		return 0, errors.New("webpush: VAPID privada inválida")
	}
	priv, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), d)
	if err != nil {
		return 0, errors.New("webpush: VAPID privada inválida")
	}
	if pub, err := priv.PublicKey.Bytes(); err != nil || base64.RawURLEncoding.EncodeToString(pub) != strings.TrimRight(strings.TrimSpace(v.Publica), "=") {
		return 0, errors.New("webpush: a chave VAPID pública não confere com a privada")
	}
	as, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return 0, err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return 0, err
	}
	corpo, err := cifrar(payload, uaPub, authSecret, as, salt)
	if err != nil {
		return 0, err
	}
	jwt, err := jwtVAPID(u.Scheme+"://"+u.Host, v.Assunto, priv, time.Now().Add(12*time.Hour))
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.Endpoint, bytes.NewReader(corpo))
	if err != nil {
		return 0, err
	}
	req.Header.Set("TTL", "2419200") // 4 semanas, o padrão do web-push do npm
	req.Header.Set("Content-Encoding", "aes128gcm")
	req.Header.Set("Content-Type", "application/octet-stream")
	req.Header.Set("Authorization", "vapid t="+jwt+", k="+strings.TrimRight(strings.TrimSpace(v.Publica), "="))
	if cli == nil {
		cli = http.DefaultClient
	}
	r, err := cli.Do(req)
	if err != nil {
		return 0, err
	}
	defer r.Body.Close()
	io.Copy(io.Discard, io.LimitReader(r.Body, 64<<10))
	return r.StatusCode, nil
}
```

Crie `api/internal/comercial/vendas.go`:

```go
package comercial

import (
	"cmp"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
)

// pedido é o que o push de vendas precisa de um pedido do Bling (ou trazido de outro dia).
type pedido struct {
	ID     int64
	Data   string // AAAA-MM-DD
	Total  float64
	LojaID *int64
	Itens  int
}

// linhaDaNota é uma linha de bling_pedido_nota.
type linhaDaNota struct {
	PedidoID     int64
	DataPedido   string
	DataDaVenda  string
	Total        float64
	LojaID       *int64
	NotaSituacao *int
}

func dentro(dia, di, df string) bool { return dia != "" && dia >= di && dia <= df }

// ajustarPelaDataDaNota (_shared/data-da-venda.js): a venda conta no dia da NOTA. Sem linha
// fica como está; nota negada (2, 4, 9) tira a venda; trazido de outro dia só com nota
// AUTORIZADA (5, 6).
func ajustarPelaDataDaNota(pedidos []pedido, linhas []linhaDaNota, di, df string) []pedido {
	porID := map[int64]linhaDaNota{}
	for _, l := range linhas {
		porID[l.PedidoID] = l
	}
	negada := func(l linhaDaNota) bool {
		return l.NotaSituacao != nil && (*l.NotaSituacao == 2 || *l.NotaSituacao == 4 || *l.NotaSituacao == 9)
	}
	autorizada := func(l linhaDaNota) bool {
		return l.NotaSituacao != nil && (*l.NotaSituacao == 5 || *l.NotaSituacao == 6)
	}
	var saida []pedido
	vistos := map[int64]bool{}
	for _, p := range pedidos {
		vistos[p.ID] = true
		l, ok := porID[p.ID]
		if !ok {
			saida = append(saida, p)
			continue
		}
		if negada(l) {
			continue
		}
		dia := l.DataDaVenda
		if dia == "" {
			dia = p.Data
		}
		if !dentro(dia, di, df) {
			continue
		}
		p.Data = dia
		saida = append(saida, p)
	}
	for _, l := range linhas {
		if vistos[l.PedidoID] || !autorizada(l) || !dentro(l.DataDaVenda, di, df) {
			continue
		}
		saida = append(saida, pedido{ID: l.PedidoID, Data: l.DataDaVenda, Total: l.Total, LojaID: l.LojaID})
	}
	return saida
}

// aplicarValorCorrigido (_shared/valor-corrigido.js): bling_pedido_ajuste_valor vence o
// total do Bling; ajuste negativo não passa; ajuste nunca TRAZ pedido.
func aplicarValorCorrigido(pedidos []pedido, ajustes map[int64]float64) []pedido {
	for i, p := range pedidos {
		if v, ok := ajustes[p.ID]; ok && v >= 0 {
			pedidos[i].Total = v
		}
	}
	return pedidos
}

type metricas struct {
	Valor  float64
	Vendas int
	Itens  int
}

type canalAgregado struct {
	LojaID   int64
	Nome     string
	Ref, Cmp metricas
}

type agregado struct {
	Ref, Cmp metricas
	Canais   []canalAgregado // só lojas cadastradas, do maior valor para o menor
}

// agregarVendasPorCanal (_shared/vendas-do-dia.js): totais somam TODOS os pedidos (até de
// loja não cadastrada); a quebra por canal só as lojas de bling_lojas.
func agregarVendasPorCanal(ref, cmpDia []pedido, lojas []canalAgregado) agregado {
	soma := func(ps []pedido) (map[int64]metricas, metricas) {
		por := map[int64]metricas{}
		var tot metricas
		for _, p := range ps {
			k := int64(0)
			if p.LojaID != nil {
				k = *p.LojaID
			}
			m := por[k]
			m.Valor += p.Total
			m.Vendas++
			m.Itens += p.Itens
			por[k] = m
			tot.Valor += p.Total
			tot.Vendas++
			tot.Itens += p.Itens
		}
		return por, tot
	}
	pr, tr := soma(ref)
	pc, tc := soma(cmpDia)
	a := agregado{Ref: tr, Cmp: tc}
	for _, l := range lojas {
		a.Canais = append(a.Canais, canalAgregado{LojaID: l.LojaID, Nome: l.Nome, Ref: pr[l.LojaID], Cmp: pc[l.LojaID]})
	}
	slices.SortStableFunc(a.Canais, func(x, y canalAgregado) int { return cmp.Compare(y.Ref.Valor, x.Ref.Valor) })
	return a
}

// brl imita toLocaleString('pt-BR', {style:'currency', currency:'BRL', maximumFractionDigits:0}):
// "R$" + espaço NÃO separável (U+00A0) + milhar com ponto; arredonda metade para longe do zero.
func brl(v float64) string {
	n := int64(math.Round(v))
	sinal := ""
	if n < 0 {
		sinal, n = "-", -n
	}
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return sinal + "R$ " + b.String()
}

// seta: 📈 sobe, 📉 cai, ➡️ estável, 🆕 quando a comparação foi zero.
func seta(ref, comparacao float64) string {
	if comparacao == 0 {
		return "\U0001F195"
	}
	s := int(math.Floor((ref-comparacao)/comparacao*100 + 0.5)) // o Math.round do JS
	switch {
	case s > 0:
		return fmt.Sprintf("\U0001F4C8 %d%%", s)
	case s < 0:
		return fmt.Sprintf("\U0001F4C9 %d%%", -s)
	}
	return "➡️ 0%"
}

func plural(n int, sing, plur string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, sing)
	}
	return fmt.Sprintf("%d %s", n, plur)
}

// montarCorpo (_shared/vendas-do-dia.js): a MESMA notificação serve 22h (hoje × ontem) e
// 07h (ontem × anteontem).
func montarCorpo(a agregado, refLabel, cmpLabel string) map[string]string {
	linhas := []string{fmt.Sprintf("%s vs %s · %s · %s", seta(a.Ref.Valor, a.Cmp.Valor), cmpLabel,
		plural(a.Ref.Vendas, "venda", "vendas"), plural(a.Ref.Itens, "item", "itens"))}
	movimento := false
	for _, c := range a.Canais {
		if c.Ref.Vendas > 0 {
			movimento = true
			linhas = append(linhas, fmt.Sprintf("%s · %s · %s", c.Nome, brl(c.Ref.Valor), seta(c.Ref.Valor, c.Cmp.Valor)))
		}
	}
	if !movimento {
		ainda := ""
		if refLabel == "hoje" {
			ainda = " ainda"
		}
		linhas = append(linhas, "Nenhuma venda registrada "+refLabel+ainda+".")
	}
	return map[string]string{
		"title": "\U0001F6CD️ Vendas de " + refLabel + " · " + brl(a.Ref.Valor),
		"body":  strings.Join(linhas, "\n"),
		"url":   "/gestao-vista",
		"tag":   "vendas-do-dia",
	}
}
```

Crie `api/internal/comercial/push_vendas.go`:

```go
package comercial

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"
	_ "time/tzdata" // America/Sao_Paulo sem depender do zoneinfo do contêiner

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

var saoPaulo = func() *time.Location {
	l, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		panic(err)
	}
	return l
}()

// PushVendas porta supabase/functions/enviar-push-vendas: soma as vendas do dia por canal
// (22h: hoje × ontem; 07h: ontem × anteontem) e manda UM push a quem quer o tipo 'vendas'.
// EXATIDÃO PRIMEIRO: se faltar qualquer dado (Bling via core, data da nota, valor corrigido,
// itens), NÃO envia nada e a tarefa termina com erro (fica visível em robos_execucoes).
type PushVendas struct {
	Pool  *pgxpool.Pool
	Core  *core.Cliente
	VAPID webpush.VAPID
	HTTP  *http.Client     // para o serviço de push; nil = padrão
	Agora func() time.Time // nil = time.Now
}

const (
	itensOrcamento   = 90 * time.Second // teto para detalhar os itens que faltam no cache
	itensConcorrente = 8
)

// Tarefas: as agendas reais de produção (cron.job, UTC).
func (pv *PushVendas) Tarefas() []worker.Tarefa {
	return []worker.Tarefa{
		{Nome: "push-vendas-07h", Agenda: "0 10 * * *", Limite: 5 * time.Minute, Executar: func(ctx context.Context) error { return pv.Rodar(ctx, "ontem") }},
		{Nome: "push-vendas-22h", Agenda: "0 1 * * *", Limite: 5 * time.Minute, Executar: func(ctx context.Context) error { return pv.Rodar(ctx, "hoje") }},
	}
}

// pedidoBling é o pedaço do pedido de venda do Bling que importa aqui.
type pedidoBling struct {
	ID    int64   `json:"id"`
	Data  string  `json:"data"`
	Total float64 `json:"total"`
	Loja  *struct {
		ID int64 `json:"id"`
	} `json:"loja"`
	Itens []json.RawMessage `json:"itens"`
}

// blingGET lê um caminho do Bling pelo core; qualquer coisa que não seja 2xx é erro.
func (pv *PushVendas) blingGET(ctx context.Context, caminho string, q map[string]any, destino any) error {
	r, err := pv.Core.Bling(ctx, core.PedidoBling{Metodo: http.MethodGet, Caminho: caminho, Query: q})
	if err != nil {
		return err
	}
	if r.Status < 200 || r.Status > 299 {
		return fmt.Errorf("bling %s -> %d", caminho, r.Status)
	}
	return json.Unmarshal(r.Corpo, destino)
}

// listarPedidos: pedidos de venda atendidos (situação 9) de um dia, de 100 em 100 (até 10 páginas).
func (pv *PushVendas) listarPedidos(ctx context.Context, dia string) ([]pedido, error) {
	var todos []pedido
	for pagina := 1; pagina <= 10; pagina++ {
		var resp struct {
			Data []pedidoBling `json:"data"`
		}
		q := map[string]any{"dataInicial": dia, "dataFinal": dia, "idsSituacoes[]": "9", "pagina": strconv.Itoa(pagina), "limite": "100"}
		if err := pv.blingGET(ctx, "/pedidos/vendas", q, &resp); err != nil {
			return nil, err
		}
		for _, p := range resp.Data {
			np := pedido{ID: p.ID, Data: p.Data, Total: p.Total}
			if p.Loja != nil {
				id := p.Loja.ID
				np.LojaID = &id
			}
			todos = append(todos, np)
		}
		if len(resp.Data) < 100 {
			break
		}
	}
	return todos, nil
}

// linhasDoDia: bling_pedido_nota que toca o dia (pela data da venda OU do pedido), com
// nota_situacao — a coluna que as telas leem e que a regra de nota negada/autorizada exige.
func (pv *PushVendas) linhasDoDia(ctx context.Context, dia string) ([]linhaDaNota, error) {
	linhas, err := pv.Pool.Query(ctx, `select pedido_id, data_pedido::text, coalesce(data_da_venda::text, ''), coalesce(total, 0)::float8, loja_id, nota_situacao::int
		from bling_pedido_nota where data_da_venda = $1::date or data_pedido = $1::date`, dia)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(linhas, func(r pgx.CollectableRow) (l linhaDaNota, err error) {
		return l, r.Scan(&l.PedidoID, &l.DataPedido, &l.DataDaVenda, &l.Total, &l.LojaID, &l.NotaSituacao)
	})
}

func (pv *PushVendas) Rodar(ctx context.Context, modo string) error {
	if pv.VAPID.Publica == "" || pv.VAPID.Privada == "" {
		return errors.New("vapid_nao_configurado")
	}
	agora := time.Now
	if pv.Agora != nil {
		agora = pv.Agora
	}
	hoje := agora().In(saoPaulo)
	dia := func(n int) string { return hoje.AddDate(0, 0, -n).Format("2006-01-02") }
	diaRef, diaCmp, refLabel, cmpLabel := dia(0), dia(1), "hoje", "ontem"
	if modo == "ontem" {
		diaRef, diaCmp, refLabel, cmpLabel = dia(1), dia(2), "ontem", "anteontem"
	}

	ref, err := pv.listarPedidos(ctx, diaRef)
	if err != nil {
		return fmt.Errorf("bling_indisponivel: %w", err)
	}
	cmpDia, err := pv.listarPedidos(ctx, diaCmp)
	if err != nil {
		return fmt.Errorf("bling_indisponivel: %w", err)
	}
	lRef, err := pv.linhasDoDia(ctx, diaRef)
	if err != nil {
		return fmt.Errorf("data_da_venda_indisponivel: %w", err)
	}
	lCmp, err := pv.linhasDoDia(ctx, diaCmp)
	if err != nil {
		return fmt.Errorf("data_da_venda_indisponivel: %w", err)
	}
	ref = ajustarPelaDataDaNota(ref, lRef, diaRef, diaRef)
	cmpDia = ajustarPelaDataDaNota(cmpDia, lCmp, diaCmp, diaCmp)

	ajustes := map[int64]float64{}
	linhas, err := pv.Pool.Query(ctx, `select pedido_id, total_corrigido::float8 from bling_pedido_ajuste_valor where total_corrigido is not null`)
	if err != nil {
		return fmt.Errorf("valor_corrigido_indisponivel: %w", err)
	}
	var id int64
	var v float64
	if _, err := pgx.ForEachRow(linhas, []any{&id, &v}, func() error { ajustes[id] = v; return nil }); err != nil {
		return fmt.Errorf("valor_corrigido_indisponivel: %w", err)
	}
	ref = aplicarValorCorrigido(ref, ajustes)
	cmpDia = aplicarValorCorrigido(cmpDia, ajustes)

	// Itens: o cache que a Gestão à Vista popula; o que faltar, detalhe no Bling. Se não der
	// para contar TODOS, os itens não seriam exatos: não envia.
	todos := append(append([]*pedido{}, ponteiros(ref)...), ponteiros(cmpDia)...)
	ids := make([]int64, len(todos))
	for i, p := range todos {
		ids[i] = p.ID
	}
	cache := map[int64]int{}
	linhas, err = pv.Pool.Query(ctx, `select pedido_id, qtd_itens from bling_pedido_vendedor where pedido_id = any($1) and qtd_itens is not null`, ids)
	if err != nil {
		return fmt.Errorf("itens_incompletos: %w", err)
	}
	var qtd int
	if _, err := pgx.ForEachRow(linhas, []any{&id, &qtd}, func() error { cache[id] = qtd; return nil }); err != nil {
		return fmt.Errorf("itens_incompletos: %w", err)
	}
	if err := pv.detalharFaltantes(ctx, todos, cache); err != nil {
		return fmt.Errorf("itens_incompletos: %w", err)
	}
	for _, p := range todos {
		p.Itens = cache[p.ID]
	}

	linhas, err = pv.Pool.Query(ctx, `select loja_id, coalesce(nome, '') from bling_lojas`)
	if err != nil {
		return err
	}
	lojas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (c canalAgregado, err error) {
		return c, r.Scan(&c.LojaID, &c.Nome)
	})
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(montarCorpo(agregarVendasPorCanal(ref, cmpDia, lojas), refLabel, cmpLabel))

	// Quem quer 'vendas': inscrição COM dono; sem preferência gravada vale o padrão do tipo,
	// que para 'vendas' é LIGADO (_shared/notificacoes.js).
	linhas, err = pv.Pool.Query(ctx, `select s.endpoint, s.p256dh, s.auth from push_subs s
		where s.user_id is not null
		  and coalesce((select p.ativo from push_preferencias p where p.user_id = s.user_id and p.tipo = 'vendas'), true)`)
	if err != nil {
		return err
	}
	alvos, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (s webpush.Inscricao, err error) {
		return s, r.Scan(&s.Endpoint, &s.P256dh, &s.Auth)
	})
	if err != nil {
		return err
	}
	enviados, podados := 0, 0
	for _, s := range alvos {
		st, err := webpush.Enviar(ctx, pv.HTTP, s, payload, pv.VAPID)
		switch {
		case err != nil:
			slog.Warn("push de vendas: inscrição pulada", "erro", err) // o endpoint não vai ao log
		case st == http.StatusGone || st == http.StatusNotFound:
			if _, err := pv.Pool.Exec(ctx, `delete from push_subs where endpoint = $1`, s.Endpoint); err == nil {
				podados++
			}
		case st >= 200 && st < 300:
			enviados++
		}
	}
	slog.Info("push de vendas", "modo", modo, "dia", diaRef, "pedidos", len(todos), "enviados", enviados, "podados", podados)
	return nil
}

func ponteiros(ps []pedido) []*pedido {
	out := make([]*pedido, len(ps))
	for i := range ps {
		out[i] = &ps[i]
	}
	return out
}

// detalharFaltantes busca no Bling (via core) os itens dos pedidos fora do cache, com até 8
// em paralelo e 90 s no total. Qualquer falha = erro (os itens não seriam exatos).
func (pv *PushVendas) detalharFaltantes(ctx context.Context, todos []*pedido, cache map[int64]int) error {
	var faltam []int64
	for _, p := range todos {
		if _, ok := cache[p.ID]; !ok {
			faltam = append(faltam, p.ID)
		}
	}
	if len(faltam) == 0 {
		return nil
	}
	ctx, cancela := context.WithTimeout(ctx, itensOrcamento)
	defer cancela()
	var (
		mu     sync.Mutex
		wg     sync.WaitGroup
		falhou error
		fila   = make(chan int64)
	)
	for range min(itensConcorrente, len(faltam)) {
		wg.Go(func() {
			for id := range fila {
				var det struct {
					Data pedidoBling `json:"data"`
				}
				err := pv.blingGET(ctx, "/pedidos/vendas/"+strconv.FormatInt(id, 10), nil, &det)
				mu.Lock()
				if err != nil && falhou == nil {
					falhou = err
					cancela() // ninguém começa outra: o resultado já não seria exato
				}
				if err == nil {
					cache[id] = len(det.Data.Itens)
				}
				mu.Unlock()
			}
		})
	}
	for _, id := range faltam {
		if ctx.Err() != nil {
			break
		}
		fila <- id
	}
	close(fila)
	wg.Wait()
	if falhou == nil && ctx.Err() != nil {
		falhou = ctx.Err()
	}
	return falhou
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l internal/ && go vet ./internal/webpush/ ./internal/comercial/ && go test -race ./internal/webpush/ ./internal/comercial/ -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'`
Expected: só `--- PASS`. Se `TestCifrarVetorDoRFC8291` falhar, confira o vetor com o RFC 8291 §A **antes** de mexer no código: ele foi conferido contra o Node (`crypto.hkdfSync` + `aes-128-gcm`) em 2026-10-10.

- [ ] **Step 5: Commit**

```bash
git add api/internal/webpush api/internal/comercial
git commit -m "feat(api): Web Push com a biblioteca padrão e push de vendas (07h/22h) no worker, pedidos via core

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Webhooks da Shopify (pedido, checkout e abandono)

**Revisor:** **opus** (HMAC em tempo constante, replay, transação efeito + marca).

**Files:**
- Create: `api/internal/banco/migracoes/00002_webhooks_recebidos.sql`
- Create: `api/internal/webhooks/shopify.go`, `api/internal/webhooks/abandono.go`
- Test: `api/internal/webhooks/shopify_test.go`

**Interfaces:**
- Consumes: `testebanco.Novo` (aplica as migrações embutidas, inclusive a 00002).
- Produces:
  - Tabela `webhooks_recebidos (origem, evento_id, recebido_em)`, chave `(origem, evento_id)`.
  - `type webhooks.Shopify struct { Pool *pgxpool.Pool; Segredos []string }` com `Pedido`, `Checkout`, `Abandono` (`http.HandlerFunc`), rotas públicas.
  - Funções do pacote que a Task 8 usa: `responder(w, status, corpo any)`, `mapa(v any) map[string]any`. Para os testes do pacote: `contar(t, p, sql) int`.

Portas de `supabase/functions/receber-webhook-pedido-shopify/index.ts:33-58` (com `_shared/pedido-shopify.js:31-46`), `receber-webhook-checkout/index.ts:27-52` (com `_shared/verificar-webhook-shopify.js:11-59`) e `receber-webhook-abandono/index.ts:35-62` (com `_shared/abandono-de-checkout.js:38-90`, `_shared/pedido-para-mensagem.js:13-41` e `_shared/aplicar-decisao.js:18-57`). Assinatura: base64 do HMAC-SHA256 do corpo **cru** em `X-Shopify-Hmac-Sha256`, aceita com qualquer um dos segredos (`hmac.Equal`, sem sair cedo). O mesmo receptor serve a Shopify direto e o fan-out do core (que reassina com o segredo do destino). As funções SQL do abandono são as do banco restaurado; o teste usa dublês com as assinaturas de `db/migrations/2026-09-29-abandono-de-checkout.sql` e `2026-09-30-*`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/webhooks/shopify_test.go`:

```go
package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const segredoAdmin, segredoApp = "segredo-admin-shopify", "segredo-app-shopify"

// Tabelas e funções SQL de produção que os receptores tocam. As funções do abandono são
// dublês que registram a chamada em `chamadas` (o corpo real fica no banco restaurado).
const esquemaShopify = `
create table shopify_pedidos (id bigint primary key, numero text, loja_id bigint not null, total numeric(12,2) not null,
  moeda text not null, status_financeiro text not null, cliente_nome text, cliente_email text,
  criado_em_shopify timestamptz not null, bruto jsonb not null, atualizado_em timestamptz not null default now());
create table carrinho_eventos (id bigint generated always as identity primary key, cart_token text not null,
  tipo text not null, evento_shopify_id text, criado_em timestamptz not null default now());
create unique index carrinho_eventos_evento_shopify_id_uidx on carrinho_eventos (evento_shopify_id) where evento_shopify_id is not null;
create table chamadas (id serial, nome text, args text);
create function registrar_checkout_abandono(p_token text, p_email text, p_telefone text, p_nome text, p_total numeric, p_moeda text, p_url text)
  returns void language plpgsql as $$ begin
    if p_token = 'explode' then raise exception 'falha simulada'; end if;
    insert into chamadas (nome, args) values ('registrar', concat_ws('|', p_token, p_email, p_telefone, p_nome, p_total, p_moeda, p_url)); end $$;
create function marcar_checkout_comprou(p_token text) returns void language sql as $$ insert into chamadas (nome, args) values ('comprou-antiga', p_token) $$;
create function marcar_checkout_comprou(p_token text, p_email text default null, p_telefone text default null) returns void language sql
  as $$ insert into chamadas (nome, args) values ('comprou', concat_ws('|', coalesce(p_token, '-'), p_email, p_telefone)) $$;
create function marcar_checkout_pagamento_pendente(p_token text) returns void language sql as $$ insert into chamadas (nome, args) values ('pendente', p_token) $$;
create function reabrir_checkout_abandono(p_token text) returns void language sql as $$ insert into chamadas (nome, args) values ('reabrir', p_token) $$;
create function registrar_pedido_para_mensagem(p_pedido_id bigint, p_numero text, p_nome text, p_telefone text, p_criado_em timestamptz)
  returns void language sql as $$ insert into chamadas (nome, args) values ('pedido', concat_ws('|', p_pedido_id, p_numero, p_nome, p_telefone, p_criado_em is not null)) $$;
create function cancelar_mensagem_pedido(p_pedido_id bigint) returns void language sql as $$ insert into chamadas (nome, args) values ('cancelar', p_pedido_id::text) $$;`

func assinar(segredo, corpo string) string {
	m := hmac.New(sha256.New, []byte(segredo))
	m.Write([]byte(corpo))
	return base64.StdEncoding.EncodeToString(m.Sum(nil))
}

func montarShopify(t *testing.T, segredos ...string) (*pgxpool.Pool, http.Handler) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), esquemaShopify); err != nil {
		t.Fatal(err)
	}
	s := &Shopify{Pool: p, Segredos: segredos}
	r := chi.NewRouter()
	r.HandleFunc("/receber-webhook-pedido-shopify", s.Pedido)
	r.HandleFunc("/receber-webhook-checkout", s.Checkout)
	r.HandleFunc("/receber-webhook-abandono", s.Abandono)
	return p, r
}

func enviar(h http.Handler, caminho, corpo, assinatura, topico, evento string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", caminho, strings.NewReader(corpo))
	if assinatura != "" {
		req.Header.Set("X-Shopify-Hmac-Sha256", assinatura)
	}
	if topico != "" {
		req.Header.Set("X-Shopify-Topic", topico)
	}
	if evento != "" {
		req.Header.Set("X-Shopify-Event-Id", evento)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func contar(t *testing.T, p *pgxpool.Pool, sql string) int {
	t.Helper()
	var n int
	if err := p.QueryRow(context.Background(), sql).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

const pedido = `{"id":7001,"name":"#1042","total_price":"199.90","currency":"BRL","financial_status":"paid","created_at":"2026-10-09T10:00:00-03:00","customer":{"first_name":"Ana","last_name":"Lima","email":"ana@x.com"}}`

func TestShopifyAssinatura(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin, segredoApp)
	casos := []struct {
		nome, assinatura string
		quer             int
	}{
		{"sem assinatura", "", 401},
		{"assinatura errada", assinar("outro", pedido), 401},
		{"assinatura de outro corpo", assinar(segredoAdmin, pedido+" "), 401},
		{"base64 inválido", "%%%não-é-base64", 401},
		{"segredo do admin", assinar(segredoAdmin, pedido), 200},
		{"segredo do app (webhook criado por API) e espaços nas pontas", " " + assinar(segredoApp, pedido) + " ", 200},
	}
	for _, c := range casos {
		if w := enviar(h, "/receber-webhook-pedido-shopify", pedido, c.assinatura, "orders/paid", ""); w.Code != c.quer {
			t.Errorf("%s: %d %s", c.nome, w.Code, w.Body)
		}
	}
	if n := contar(t, p, `select count(*) from shopify_pedidos`); n != 1 {
		t.Fatalf("linhas = %d", n)
	}
	_, semSegredo := montarShopify(t)
	if w := enviar(semSegredo, "/receber-webhook-pedido-shopify", pedido, assinar("", pedido), "", ""); w.Code != 401 {
		t.Fatalf("sem segredo configurado nada passa: %d", w.Code)
	}
	req := httptest.NewRequest("GET", "/receber-webhook-checkout", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 405 {
		t.Fatalf("GET = %d", w.Code)
	}
}

func TestShopifyCorpoGrandeEJSONInvalido(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin)
	grande := `{"id":1,"x":"` + strings.Repeat("a", limiteShopify) + `"}`
	if w := enviar(h, "/receber-webhook-pedido-shopify", grande, assinar(segredoAdmin, grande), "", ""); w.Code != 413 {
		t.Fatalf("corpo grande = %d", w.Code)
	}
	if w := enviar(h, "/receber-webhook-checkout", "não é json", assinar(segredoAdmin, "não é json"), "", "e1"); w.Code != 200 || !strings.Contains(w.Body.String(), "json_invalido") {
		t.Fatalf("json inválido = %d %s", w.Code, w.Body)
	}
	if n := contar(t, p, `select count(*) from webhooks_recebidos`); n != 0 {
		t.Fatal("JSON inválido não deixa marca")
	}
}

func TestShopifyPedidoUpsertEReplay(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin)
	if w := enviar(h, "/receber-webhook-pedido-shopify", pedido, assinar(segredoAdmin, pedido), "orders/paid", "ev-1"); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var numero, nome, email, status string
	var total float64
	p.QueryRow(context.Background(), `select numero, cliente_nome, cliente_email, status_financeiro, total::float8 from shopify_pedidos where id = 7001`).Scan(&numero, &nome, &email, &status, &total)
	if numero != "#1042" || nome != "Ana Lima" || email != "ana@x.com" || status != "paid" || total != 199.9 {
		t.Fatalf("linha = %q %q %q %q %v", numero, nome, email, status, total)
	}
	// Replay do MESMO evento com corpo diferente: não regrava.
	outro := strings.Replace(pedido, `"199.90"`, `"1.00"`, 1)
	if w := enviar(h, "/receber-webhook-pedido-shopify", outro, assinar(segredoAdmin, outro), "orders/paid", "ev-1"); !strings.Contains(w.Body.String(), "duplicado") {
		t.Fatalf("replay = %s", w.Body)
	}
	p.QueryRow(context.Background(), `select total::float8 from shopify_pedidos where id = 7001`).Scan(&total)
	if total != 199.9 {
		t.Fatalf("replay regravou: %v", total)
	}
	// Sem Event-Id: processa, e o upsert por id é idempotente (uma linha só).
	enviar(h, "/receber-webhook-pedido-shopify", outro, assinar(segredoAdmin, outro), "orders/updated", "")
	if n := contar(t, p, `select count(*) from shopify_pedidos`); n != 1 {
		t.Fatalf("linhas = %d", n)
	}
	sem := `{"id":1}`
	if w := enviar(h, "/receber-webhook-pedido-shopify", sem, assinar(segredoAdmin, sem), "", ""); !strings.Contains(w.Body.String(), "ignorado") {
		t.Fatalf("sem created_at = %s", w.Body)
	}
}

func TestShopifyCheckout(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin)
	c := `{"cart_token":" abc ","email":"nao@grava.com"}`
	enviar(h, "/receber-webhook-checkout", c, assinar(segredoAdmin, c), "checkouts/create", "ev-9")
	enviar(h, "/receber-webhook-checkout", c, assinar(segredoAdmin, c), "checkouts/create", "ev-9")
	var token, ev string
	p.QueryRow(context.Background(), `select cart_token, evento_shopify_id from carrinho_eventos`).Scan(&token, &ev)
	if n := contar(t, p, `select count(*) from carrinho_eventos`); n != 1 || token != "abc" || ev != "ev-9" {
		t.Fatalf("n=%d token=%q ev=%q", n, token, ev)
	}
	sem := `{"email":"x@x.com"}`
	if w := enviar(h, "/receber-webhook-checkout", sem, assinar(segredoAdmin, sem), "checkouts/create", "ev-10"); !strings.Contains(w.Body.String(), "sem_cart_token") {
		t.Fatalf("sem cart_token = %s", w.Body)
	}
}

func TestShopifyAbandono(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin)
	casos := []struct {
		topico, corpo string
		quer          []string
	}{
		{"checkouts/create", `{"token":"t1","email":"a@x.com","total_price":"99.5","currency":"BRL","abandoned_checkout_url":"https://loja/r","shipping_address":{"first_name":"Luis","last_name":"Fulano","phone":"+55 11 98765-4321"},"customer":{"phone":"999"}}`,
			[]string{"registrar:t1|a@x.com|+55 11 98765-4321|Luis Fulano|99.5|BRL|https://loja/r"}},
		{"checkouts/update", `{"token":"t2","completed_at":"2026-10-09"}`, nil},
		{"orders/paid", `{"id":1,"checkout_token":"t1","email":"a@x.com"}`, []string{"comprou:t1|a@x.com"}},
		{"orders/create", `{"id":5,"name":"#9","checkout_token":"t3","financial_status":"pending","source_name":"web","phone":"11999990000","created_at":"2026-10-09T10:00:00Z","billing_address":{"first_name":"Bia"}}`,
			[]string{"pendente:t3", "pedido:5|#9|Bia|11999990000|t"}},
		{"orders/create", `{"id":6,"financial_status":"paid","source_name":"pos","phone":"11999990000"}`, []string{"comprou:-|11999990000"}},
		{"orders/cancelled", `{"id":5,"checkout_token":"t3"}`, []string{"reabrir:t3", "cancelar:5"}},
		{"customers/create", `{"id":1}`, nil},
	}
	for i, c := range casos {
		p.Exec(context.Background(), `delete from chamadas`)
		w := enviar(h, "/receber-webhook-abandono", c.corpo, assinar(segredoAdmin, c.corpo), c.topico, "")
		linhas, _ := p.Query(context.Background(), `select nome || ':' || coalesce(args, '') from chamadas order by id`)
		var got []string
		for linhas.Next() {
			var s string
			linhas.Scan(&s)
			got = append(got, s)
		}
		if w.Code != 200 || strings.Join(got, ",") != strings.Join(c.quer, ",") {
			t.Errorf("caso %d (%s): %d %s chamadas=%v", i, c.topico, w.Code, w.Body, got)
		}
	}
}

func TestShopifyFalhaDeBancoDevolve500ESemMarca(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	p, h := montarShopify(t, segredoAdmin)
	c := `{"token":"explode","email":"a@x.com"}`
	if w := enviar(h, "/receber-webhook-abandono", c, assinar(segredoAdmin, c), "checkouts/create", "ev-x"); w.Code != 500 {
		t.Fatalf("falha = %d", w.Code)
	}
	if n := contar(t, p, `select count(*) from webhooks_recebidos`); n != 0 {
		t.Fatal("a marca de recebido tem de sumir junto com o efeito que falhou")
	}
	// O banco voltou: a reentrega do MESMO evento é processada (não é tratada como duplicada).
	p.Exec(context.Background(), `create or replace function registrar_checkout_abandono(p_token text, p_email text, p_telefone text, p_nome text, p_total numeric, p_moeda text, p_url text)
		returns void language sql as $$ insert into chamadas (nome, args) values ('registrar', p_token) $$`)
	if w := enviar(h, "/receber-webhook-abandono", c, assinar(segredoAdmin, c), "checkouts/create", "ev-x"); w.Code != 200 || strings.Contains(w.Body.String(), "duplicado") {
		t.Fatalf("reentrega = %d %s", w.Code, w.Body)
	}
	if strings.Contains(log.String(), segredoAdmin) || !strings.Contains(log.String(), "falha ao gravar") {
		t.Fatalf("log = %s", log.String())
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/webhooks/ -v`
Expected: FAIL de compilação (`undefined: Shopify`, `undefined: limiteShopify`).

- [ ] **Step 3: Implementar**

Crie `api/internal/banco/migracoes/00002_webhooks_recebidos.sql`:

```sql
-- +goose Up
-- Reentrega e replay de webhook (a Shopify e o fan-out do core mandam o MESMO
-- X-Shopify-Event-Id em toda reentrega). A marca é gravada na MESMA transação do efeito:
-- se o efeito falha, a marca some junto e a reentrega seguinte é processada.
create table webhooks_recebidos (
  origem      text not null,
  evento_id   text not null,
  recebido_em timestamptz not null default now(),
  primary key (origem, evento_id)
);

-- +goose Down
drop table webhooks_recebidos;
```

Crie `api/internal/webhooks/shopify.go`:

```go
// Package webhooks: os receptores públicos (Shopify, direto ou pelo fan-out do core, e
// Chatwoot). Autenticação por assinatura/segredo, nunca por sessão; o efeito e a marca de
// "já recebido" andam na mesma transação.
package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const limiteShopify = 5 << 20 // pedido grande da Shopify cabe com folga

func responder(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

// assinaturaShopify confere X-Shopify-Hmac-Sha256 (base64 do HMAC-SHA256 do corpo CRU) contra
// QUALQUER um dos segredos, em tempo constante. Sem segredo, sem corpo ou sem cabeçalho: falso.
func assinaturaShopify(segredos []string, corpo []byte, cabecalho string) bool {
	recebida, err := base64.StdEncoding.DecodeString(strings.TrimSpace(cabecalho))
	if err != nil || len(recebida) == 0 || len(corpo) == 0 {
		return false
	}
	ok := false
	for _, s := range segredos {
		if s == "" {
			continue
		}
		m := hmac.New(sha256.New, []byte(s))
		m.Write(corpo)
		if hmac.Equal(m.Sum(nil), recebida) {
			ok = true // sem sair cedo: o tempo não diz qual segredo bateu
		}
	}
	return ok
}

// Shopify recebe os três webhooks da Shopify. Segredos: o do admin da loja, o do app e o do
// destino cadastrado no fan-out do core (CORE_SHOPIFY_DESTINOS), que reassina o corpo cru.
type Shopify struct {
	Pool     *pgxpool.Pool
	Segredos []string
}

type processar func(ctx context.Context, tx pgx.Tx, topico string, corpo map[string]any, cru []byte) (int, any, error)

func (s *Shopify) receber(w http.ResponseWriter, r *http.Request, origem string, fn processar) {
	if r.Method != http.MethodPost {
		responder(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
		return
	}
	cru, err := io.ReadAll(http.MaxBytesReader(w, r.Body, limiteShopify))
	if err != nil {
		responder(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "corpo_grande_demais"})
		return
	}
	if !assinaturaShopify(s.Segredos, cru, r.Header.Get("X-Shopify-Hmac-Sha256")) {
		responder(w, http.StatusUnauthorized, map[string]string{"error": "nao_autorizado"})
		return
	}
	var corpo map[string]any
	d := json.NewDecoder(bytes.NewReader(cru))
	d.UseNumber()
	if d.Decode(&corpo) != nil || corpo == nil {
		responder(w, http.StatusOK, map[string]any{"ok": true, "ignorado": "json_invalido"}) // repetir não conserta
		return
	}
	ctx := r.Context()
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		responder(w, http.StatusInternalServerError, map[string]any{"ok": false, "erro": "falha_ao_gravar"})
		return
	}
	defer tx.Rollback(ctx)
	if id := strings.TrimSpace(r.Header.Get("X-Shopify-Event-Id")); id != "" {
		tag, err := tx.Exec(ctx, `insert into webhooks_recebidos (origem, evento_id) values ($1, $2) on conflict do nothing`, origem, id)
		if err != nil {
			responder(w, http.StatusInternalServerError, map[string]any{"ok": false, "erro": "falha_ao_gravar"})
			return
		}
		if tag.RowsAffected() == 0 {
			responder(w, http.StatusOK, map[string]any{"ok": true, "duplicado": true})
			return
		}
	}
	status, resposta, err := fn(ctx, tx, r.Header.Get("X-Shopify-Topic"), corpo, cru)
	if err == nil {
		err = tx.Commit(ctx)
	}
	if err != nil {
		// 500: o core (ou a Shopify) reentrega com recuo; os efeitos são idempotentes.
		slog.Error("webhook shopify: falha ao gravar", "origem", origem, "erro", err)
		responder(w, http.StatusInternalServerError, map[string]any{"ok": false, "erro": "falha_ao_gravar"})
		return
	}
	responder(w, status, resposta)
}

// texto: string não vazia (sem espaços nas pontas) ou nil.
func texto(v any) *string {
	s, ok := v.(string)
	if s = strings.TrimSpace(s); !ok || s == "" {
		return nil
	}
	return &s
}

func mapa(v any) map[string]any { m, _ := v.(map[string]any); return m }

// inteiro: json.Number inteiro e seguro (Number.isSafeInteger do JS), maior que zero.
func inteiro(v any) (int64, bool) {
	n, ok := v.(json.Number)
	if !ok {
		return 0, false
	}
	i, err := n.Int64()
	return i, err == nil && i > 0 && i <= 1<<53-1
}

// Pedido é POST /receber-webhook-pedido-shopify (orders/create, orders/paid, orders/updated):
// upsert em shopify_pedidos por id (pedidoDoPayload de _shared/pedido-shopify.js).
func (s *Shopify) Pedido(w http.ResponseWriter, r *http.Request) {
	s.receber(w, r, "shopify:pedido", func(ctx context.Context, tx pgx.Tx, _ string, c map[string]any, cru []byte) (int, any, error) {
		id, ok := inteiro(c["id"])
		criado := texto(c["created_at"])
		if !ok || criado == nil {
			return http.StatusOK, map[string]any{"ok": true, "ignorado": "payload sem id ou sem created_at"}, nil
		}
		numero := texto(c["name"])
		if numero == nil {
			if n, ok := c["order_number"].(json.Number); ok {
				v := "#" + n.String()
				numero = &v
			}
		}
		total := "0"
		if v, ok := c["total_price"].(string); ok && v != "" {
			total = v
		} else if v, ok := c["total_price"].(json.Number); ok {
			total = v.String()
		}
		moeda, status := "BRL", "pending"
		if m := texto(c["currency"]); m != nil {
			moeda = *m
		}
		if f := texto(c["financial_status"]); f != nil {
			status = *f
		}
		cli := mapa(c["customer"])
		var partes []string
		for _, k := range []string{"first_name", "last_name"} {
			if v, _ := cli[k].(string); v != "" {
				partes = append(partes, v)
			}
		}
		var nome *string
		if len(partes) > 0 {
			n := strings.Join(partes, " ")
			nome = &n
		}
		email, _ := cli["email"].(string)
		var emailP *string
		if email != "" {
			emailP = &email
		}
		_, err := tx.Exec(ctx, `insert into shopify_pedidos
			  (id, numero, loja_id, total, moeda, status_financeiro, cliente_nome, cliente_email, criado_em_shopify, bruto, atualizado_em)
			values ($1, $2, 205512275, coalesce(nullif($3::text, '')::numeric, 0), $4, $5, $6, $7, $8::text::timestamptz, $9::text::jsonb, now())
			on conflict (id) do update set numero = excluded.numero, loja_id = excluded.loja_id, total = excluded.total,
			  moeda = excluded.moeda, status_financeiro = excluded.status_financeiro, cliente_nome = excluded.cliente_nome,
			  cliente_email = excluded.cliente_email, criado_em_shopify = excluded.criado_em_shopify, bruto = excluded.bruto,
			  atualizado_em = now()`, id, numero, total, moeda, status, nome, emailP, *criado, string(cru))
		return http.StatusOK, map[string]any{"ok": true}, err
	})
}

// Checkout é POST /receber-webhook-checkout (checkouts/create): só o cart_token vai para
// carrinho_eventos (corte de dado pessoal; e-mail e telefone ficam de fora de propósito).
func (s *Shopify) Checkout(w http.ResponseWriter, r *http.Request) {
	s.receber(w, r, "shopify:checkout", func(ctx context.Context, tx pgx.Tx, _ string, c map[string]any, _ []byte) (int, any, error) {
		token := texto(c["cart_token"])
		if token == nil {
			return http.StatusOK, map[string]any{"ok": true, "ignorado": "sem_cart_token"}, nil
		}
		id := strings.TrimSpace(r.Header.Get("X-Shopify-Event-Id"))
		var evento *string
		if id != "" {
			evento = &id
		}
		_, err := tx.Exec(ctx, `insert into carrinho_eventos (tipo, cart_token, evento_shopify_id)
			values ('checkout_iniciado', $1, $2) on conflict do nothing`, *token, evento)
		return http.StatusOK, map[string]any{"ok": true}, err
	})
}

// Abandono é POST /receber-webhook-abandono (checkouts/create|update, orders/create|paid|cancelled):
// a fila de checkout abandonado E a mensagem de pedido recebido, pelas funções SQL que o banco
// restaurado já tem. As duas rodam na mesma transação: falhou uma, 500 e a reentrega refaz as
// duas (ambas idempotentes).
func (s *Shopify) Abandono(w http.ResponseWriter, r *http.Request) {
	s.receber(w, r, "shopify:abandono", func(ctx context.Context, tx pgx.Tx, topico string, c map[string]any, _ []byte) (int, any, error) {
		dc, dp := decidir(topico, c), decidirPedido(topico, c)
		if err := aplicar(ctx, tx, dc); err != nil {
			return 0, nil, err
		}
		if err := aplicar(ctx, tx, dp); err != nil {
			return 0, nil, err
		}
		if dc.acao == "ignorar" && dp.acao == "ignorar" {
			return http.StatusOK, map[string]any{"ok": true, "ignorado": dc.motivo}, nil
		}
		return http.StatusOK, map[string]any{"ok": true}, nil
	})
}

var errAcaoDesconhecida = errors.New("webhook: ação desconhecida")
```

Crie `api/internal/webhooks/abandono.go`:

```go
package webhooks

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// decisao é o que fazer com um webhook (abandono-de-checkout.js e pedido-para-mensagem.js).
type decisao struct {
	acao     string // ignorar | registrar | comprou | pagamento_pendente | reabrir | registrar_pedido | cancelar_pedido
	motivo   string
	token    *string
	email    *string
	telefone *string
	nome     *string
	total    *string // texto numérico (vai como numeric)
	moeda    *string
	url      *string
	pedidoID int64
	numero   *string
	criadoEm *string
}

func primeiroTexto(vs ...any) *string {
	for _, v := range vs {
		if t := texto(v); t != nil {
			return t
		}
	}
	return nil
}

// nomeDe: nome e sobrenome de um bloco (endereço ou customer).
func nomeDe(v any) *string {
	m := mapa(v)
	var partes []string
	for _, k := range []string{"first_name", "last_name"} {
		if t := texto(m[k]); t != nil {
			partes = append(partes, *t)
		}
	}
	if len(partes) == 0 {
		return nil
	}
	s := strings.Join(partes, " ")
	return &s
}

// contato: o que foi digitado no endereço vence o cadastro do cliente.
func telefoneDe(c map[string]any) *string {
	return primeiroTexto(c["phone"], mapa(c["shipping_address"])["phone"], mapa(c["billing_address"])["phone"], mapa(c["customer"])["phone"])
}

var pago = map[string]bool{"paid": true, "authorized": true, "partially_paid": true}

func decidir(topico string, c map[string]any) decisao {
	switch topico {
	case "orders/create", "orders/paid", "orders/cancelled":
		token := texto(c["checkout_token"])
		status, _ := c["financial_status"].(string)
		eraPago := topico == "orders/paid" || pago[status]
		email := primeiroTexto(c["email"], c["contact_email"], mapa(c["customer"])["email"])
		tel := telefoneDe(c)
		if token == nil {
			// Pedido pago sem checkout (admin, WhatsApp) também é compra dessa pessoa.
			if topico != "orders/cancelled" && eraPago && (email != nil || tel != nil) {
				return decisao{acao: "comprou", email: email, telefone: tel}
			}
			return decisao{acao: "ignorar", motivo: "pedido_sem_checkout"}
		}
		if topico == "orders/cancelled" {
			return decisao{acao: "reabrir", token: token} // Pix que expirou: o checkout volta a valer
		}
		if eraPago {
			return decisao{acao: "comprou", token: token, email: email, telefone: tel}
		}
		return decisao{acao: "pagamento_pendente", token: token}
	case "checkouts/create", "checkouts/update":
		token := texto(c["token"])
		if token == nil {
			return decisao{acao: "ignorar", motivo: "sem_token"}
		}
		if c["completed_at"] != nil {
			return decisao{acao: "ignorar", motivo: "checkout_concluido"} // com Pix, concluído ≠ pago
		}
		email := primeiroTexto(c["email"], mapa(c["customer"])["email"])
		tel := telefoneDe(c)
		if email == nil && tel == nil {
			return decisao{acao: "ignorar", motivo: "sem_contato"}
		}
		d := decisao{acao: "registrar", token: token, email: email, telefone: tel,
			nome: nomeDe(c["shipping_address"]), moeda: primeiroTexto(c["currency"], c["presentment_currency"]), url: texto(c["abandoned_checkout_url"])}
		if d.nome == nil {
			d.nome = nomeDe(c["billing_address"])
		}
		if d.nome == nil {
			d.nome = nomeDe(c["customer"])
		}
		if f, err := strconv.ParseFloat(strings.TrimSpace(textoCru(c["total_price"])), 64); err == nil {
			v := strconv.FormatFloat(f, 'f', -1, 64)
			d.total = &v
		}
		return d
	}
	return decisao{acao: "ignorar", motivo: "topico_nao_tratado"}
}

func textoCru(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		return x.String()
	}
	return ""
}

func decidirPedido(topico string, c map[string]any) decisao {
	if topico != "orders/create" && topico != "orders/cancelled" {
		return decisao{acao: "ignorar", motivo: "topico_nao_tratado"}
	}
	id, ok := inteiro(c["id"])
	if !ok {
		return decisao{acao: "ignorar", motivo: "sem_id"}
	}
	if topico == "orders/cancelled" {
		return decisao{acao: "cancelar_pedido", pedidoID: id}
	}
	if c["test"] == true {
		return decisao{acao: "ignorar", motivo: "pedido_de_teste"}
	}
	if c["source_name"] != "web" {
		return decisao{acao: "ignorar", motivo: "pedido_de_outro_canal"}
	}
	tel := telefoneDe(c)
	if tel == nil {
		return decisao{acao: "ignorar", motivo: "sem_telefone"}
	}
	numero := texto(c["name"])
	if numero == nil {
		if n, ok := inteiro(c["order_number"]); ok {
			v := "#" + strconv.FormatInt(n, 10)
			numero = &v
		}
	}
	if numero == nil {
		return decisao{acao: "ignorar", motivo: "sem_numero"}
	}
	nome := nomeDe(c["shipping_address"])
	if nome == nil {
		nome = nomeDe(c["billing_address"])
	}
	if nome == nil {
		nome = nomeDe(c["customer"])
	}
	return decisao{acao: "registrar_pedido", pedidoID: id, numero: numero, nome: nome, telefone: tel, criadoEm: texto(c["created_at"])}
}

// aplicar chama a função SQL da decisão (argumentos nomeados: não depende da ordem nem de
// sobrecarga). Os ::text:: fazem o banco converter, sem o pgx adivinhar o tipo.
func aplicar(ctx context.Context, tx pgx.Tx, d decisao) error {
	var err error
	switch d.acao {
	case "ignorar":
	case "registrar":
		_, err = tx.Exec(ctx, `select registrar_checkout_abandono(p_token => $1, p_email => $2, p_telefone => $3, p_nome => $4,
			p_total => $5::text::numeric, p_moeda => $6, p_url => $7)`, d.token, d.email, d.telefone, d.nome, d.total, d.moeda, d.url)
	case "comprou":
		_, err = tx.Exec(ctx, `select marcar_checkout_comprou(p_token => $1, p_email => $2, p_telefone => $3)`, d.token, d.email, d.telefone)
	case "pagamento_pendente":
		_, err = tx.Exec(ctx, `select marcar_checkout_pagamento_pendente(p_token => $1)`, d.token)
	case "reabrir":
		_, err = tx.Exec(ctx, `select reabrir_checkout_abandono(p_token => $1)`, d.token)
	case "registrar_pedido":
		_, err = tx.Exec(ctx, `select registrar_pedido_para_mensagem(p_pedido_id => $1, p_numero => $2, p_nome => $3, p_telefone => $4,
			p_criado_em => $5::text::timestamptz)`, d.pedidoID, d.numero, d.nome, d.telefone, d.criadoEm)
	case "cancelar_pedido":
		_, err = tx.Exec(ctx, `select cancelar_mensagem_pedido(p_pedido_id => $1)`, d.pedidoID)
	default:
		err = errAcaoDesconhecida
	}
	return err
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l internal/ && go vet ./internal/webhooks/ ./internal/banco/ && go test -race ./internal/webhooks/ ./internal/banco/ -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'`
Expected: só `--- PASS` (o `banco` confirma que a migração 00002 sobe junto com a 00001).

- [ ] **Step 5: Commit**

```bash
git add api/internal/banco/migracoes/00002_webhooks_recebidos.sql api/internal/webhooks
git commit -m "feat(api): webhooks da Shopify em Go com HMAC, deduplicação por evento e 500 em falha de banco

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Webhooks do Chatwoot (evento de CRM e opt-out)

**Revisor:** **opus** (segredo em tempo constante, segredo fora de log).

**Files:**
- Create: `api/internal/webhooks/chatwoot.go`
- Modify: `api/go.mod` (`golang.org/x/text v0.43.0` sai do bloco `// indirect` e vai para o `require` direto; o `go.sum` não muda)
- Test: `api/internal/webhooks/chatwoot_test.go`

**Interfaces:**
- Consumes: `responder`, `mapa`, `contar` (Task 7).
- Produces: `type webhooks.Chatwoot struct { Pool *pgxpool.Pool; Segredo string; Agora func() time.Time }` com `Evento` e `OptOut` (`http.HandlerFunc`), rotas públicas autenticadas por `?token=`.

Portas de `supabase/functions/receber-webhook-chatwoot/index.ts:25-58` (com `_shared/verificar-webhook-chatwoot.js:12-46`) e `receber-opt-out-chatwoot/index.ts:14-33` (com `_shared/opt-out.js:8-21` e `normalizarTelefone` de `_shared/mensagem-de-abandono.js:51-57`). Reenvio é inofensivo pelos índices únicos (`conversation_id, tipo` e `telefone`).

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/webhooks/chatwoot_test.go`:

```go
package webhooks

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const segredoCW = "segredo-do-chatwoot-42"

const esquemaChatwoot = `
create table chatwoot_eventos (id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('lead_novo', 'lead_quente', 'qualified_lead')),
  chatwoot_account_id integer, conversation_id bigint not null, conversation_display_id bigint, contact_id bigint,
  contact_name text, contact_phone_number text, loja text, classificacao_ia text,
  criado_em_chatwoot timestamptz not null, dia_br date not null, recebido_em timestamptz not null default now(),
  unique (conversation_id, tipo));
create table contatos_sem_mensagem (telefone text primary key, motivo text, criado_em timestamptz not null default now());`

func montarChatwoot(t *testing.T, segredo string) (*pgxpool.Pool, http.Handler) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), esquemaChatwoot); err != nil {
		t.Fatal(err)
	}
	c := &Chatwoot{Pool: p, Segredo: segredo, Agora: func() time.Time { return time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC) }}
	r := chi.NewRouter()
	r.HandleFunc("/receber-webhook-chatwoot", c.Evento)
	r.HandleFunc("/receber-opt-out-chatwoot", c.OptOut)
	return p, r
}

func postCW(h http.Handler, caminho, token, corpo string) *httptest.ResponseRecorder {
	alvo := caminho
	if token != "" {
		alvo += "?token=" + token
	}
	req := httptest.NewRequest("POST", alvo, strings.NewReader(corpo))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

const lead = `{"tipo":"qualified_lead","account_id":1,"conversation_id":555,"conversation_display_id":12,"contact_id":9,"contact_name":"Ana","contact_phone_number":"+5511987654321","loja":"Tivoli","classificacao_ia":"quente","created_at":"2026-10-10T01:30:00Z"}`

func TestChatwootSegredo(t *testing.T) {
	p, h := montarChatwoot(t, segredoCW)
	for _, tok := range []string{"", "errado", segredoCW + "x", segredoCW[:5]} {
		if w := postCW(h, "/receber-webhook-chatwoot", tok, lead); w.Code != 401 {
			t.Errorf("token %q: %d", tok, w.Code)
		}
		if w := postCW(h, "/receber-opt-out-chatwoot", tok, `{}`); w.Code != 401 {
			t.Errorf("opt-out token %q: %d", tok, w.Code)
		}
	}
	if n := contar(t, p, `select count(*) from chatwoot_eventos`); n != 0 {
		t.Fatal("nada pode gravar sem o segredo")
	}
	_, semSegredo := montarChatwoot(t, "")
	if w := postCW(semSegredo, "/receber-webhook-chatwoot", "", lead); w.Code != 401 {
		t.Fatalf("sem segredo configurado nada passa: %d", w.Code)
	}
	if !tokenValido(segredoCW, segredoCW) || tokenValido(segredoCW, "") || tokenValido("", "") {
		t.Fatal("tokenValido")
	}
}

func TestChatwootEvento(t *testing.T) {
	p, h := montarChatwoot(t, segredoCW)
	for i := 0; i < 2; i++ { // reenvio do mesmo evento: uma linha só
		if w := postCW(h, "/receber-webhook-chatwoot", segredoCW, lead); w.Code != 200 {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
	}
	var dia, nome string
	p.QueryRow(context.Background(), `select dia_br::text, contact_name from chatwoot_eventos`).Scan(&dia, &nome)
	if n := contar(t, p, `select count(*) from chatwoot_eventos`); n != 1 || dia != "2026-10-09" || nome != "Ana" {
		t.Fatalf("n=%d dia=%s nome=%s (01:30 UTC ainda é dia 9 em São Paulo)", n, dia, nome)
	}
	semData := `{"tipo":"lead_novo","conversation_id":"556","created_at":"ontem"}`
	postCW(h, "/receber-webhook-chatwoot", segredoCW, semData)
	p.QueryRow(context.Background(), `select dia_br::text from chatwoot_eventos where conversation_id = 556`).Scan(&dia)
	if dia != "2026-10-10" {
		t.Fatalf("created_at inválido usa agora: %s", dia)
	}
	casos := []struct {
		corpo string
		quer  int
	}{
		{`{"tipo":"lead_frio","conversation_id":1}`, 400},
		{`{"tipo":"lead_novo"}`, 400},
		{`não é json`, 400},
		{`{"tipo":"lead_novo","conversation_id":1,"x":"` + strings.Repeat("a", limiteChatwoot) + `"}`, 413},
	}
	for _, c := range casos {
		if w := postCW(h, "/receber-webhook-chatwoot", segredoCW, c.corpo); w.Code != c.quer {
			t.Errorf("%.40s: %d", c.corpo, w.Code)
		}
	}
	req := httptest.NewRequest("GET", "/receber-webhook-chatwoot?token="+segredoCW, nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 405 {
		t.Fatalf("GET = %d", w.Code)
	}
}

func TestChatwootOptOut(t *testing.T) {
	p, h := montarChatwoot(t, segredoCW)
	msg := func(conteudo, tipo, fone string) string {
		return `{"event":"message_created","message_type":"` + tipo + `","content":"` + conteudo + `","sender":{"phone_number":"` + fone + `"}}`
	}
	casos := []struct {
		corpo, gravou string
	}{
		{msg("PARAR", "incoming", "+55 (11) 98765-4321"), "5511987654321|resposta: parar"},
		{msg("Não quero receber mais!", "incoming", "11 91234-5678"), "5511912345678|resposta: nao quero receber mais"},
		{msg("posso parar na loja?", "incoming", "11 91111-1111"), ""},
		{msg("sair", "outgoing", "11 92222-2222"), ""},
		{msg("sair", "incoming", "11 3333-3333"), ""}, // telefone fixo não recebe WhatsApp
		{`{"event":"message_created","message_type":"incoming","content":"pare","conversation":{"meta":{"sender":{"phone_number":"0055 21 99876-5432"}}}}`, "5521998765432|resposta: pare"},
		{msg("PARAR", "incoming", "+55 (11) 98765-4321"), ""}, // reenvio: nada novo
	}
	for _, c := range casos {
		antes := contar(t, p, `select count(*) from contatos_sem_mensagem`)
		if w := postCW(h, "/receber-opt-out-chatwoot", segredoCW, c.corpo); w.Code != 200 {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		depois := contar(t, p, `select count(*) from contatos_sem_mensagem`)
		if c.gravou == "" {
			if depois != antes {
				t.Errorf("não devia gravar: %s", c.corpo)
			}
			continue
		}
		tel, motivo, _ := strings.Cut(c.gravou, "|")
		var got string
		p.QueryRow(context.Background(), `select motivo from contatos_sem_mensagem where telefone = $1`, tel).Scan(&got)
		if got != motivo {
			t.Errorf("%s: motivo %q, esperava %q", c.corpo, got, motivo)
		}
	}
}

func TestChatwootSegredoNuncaNoLog(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	p, h := montarChatwoot(t, segredoCW)
	p.Exec(context.Background(), `drop table chatwoot_eventos`) // força a falha de banco (que loga)
	w := postCW(h, "/receber-webhook-chatwoot", segredoCW, lead)
	if w.Code != 500 || !strings.Contains(log.String(), "falha ao gravar") {
		t.Fatalf("%d / log: %s", w.Code, log.String())
	}
	if strings.Contains(log.String(), segredoCW) || strings.Contains(w.Body.String(), segredoCW) {
		t.Fatal("o segredo vazou")
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/webhooks/ -v`
Expected: FAIL de compilação (`undefined: Chatwoot`, `undefined: tokenValido`, `undefined: limiteChatwoot`).

- [ ] **Step 3: Implementar**

Crie `api/internal/webhooks/chatwoot.go`:

```go
package webhooks

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // America/Sao_Paulo sem depender do zoneinfo do contêiner
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/unicode/norm"
)

const limiteChatwoot = 1 << 20

var saoPaulo = func() *time.Location {
	l, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		panic(err)
	}
	return l
}()

// tokenValido compara o segredo da URL em tempo constante. Segredo vazio nunca vale.
func tokenValido(segredo, recebido string) bool {
	return segredo != "" && subtle.ConstantTimeCompare([]byte(segredo), []byte(recebido)) == 1
}

// Chatwoot recebe os dois webhooks do Chatwoot. Ele não assina o corpo: autentica por um
// segredo fixo na própria URL (?token=). ⚠️ A URL NUNCA vai para log aqui (nem r.URL, nem a
// query), e o nginx não pode logar a query destas rotas (NOTAS-DA-IMPLANTACAO.md).
type Chatwoot struct {
	Pool    *pgxpool.Pool
	Segredo string
	Agora   func() time.Time // nil = time.Now
}

// entrada: método, segredo, tamanho e JSON. false = já respondeu.
func (c *Chatwoot) entrada(w http.ResponseWriter, r *http.Request, destino any) bool {
	if r.Method != http.MethodPost {
		responder(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
		return false
	}
	if !tokenValido(c.Segredo, r.URL.Query().Get("token")) {
		responder(w, http.StatusUnauthorized, map[string]string{"error": "nao_autorizado"})
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, limiteChatwoot))
	d.UseNumber()
	if err := d.Decode(destino); err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			responder(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "corpo_grande_demais"})
		} else {
			responder(w, http.StatusBadRequest, map[string]string{"error": "corpo_invalido"})
		}
		return false
	}
	return true
}

func (c *Chatwoot) gravar(ctx context.Context, w http.ResponseWriter, quem, sql string, args ...any) {
	if _, err := c.Pool.Exec(ctx, sql, args...); err != nil {
		slog.Error("webhook chatwoot: falha ao gravar", "rota", quem, "erro", err)
		responder(w, http.StatusInternalServerError, map[string]any{"ok": false, "erro": "falha_ao_gravar"})
		return
	}
	responder(w, http.StatusOK, map[string]any{"ok": true})
}

// numeroOuNulo: id inteiro do Chatwoot (número ou texto numérico), ou nil.
func numeroOuNulo(v any) *int64 {
	var s string
	switch x := v.(type) {
	case json.Number:
		s = x.String()
	case string:
		s = x
	default:
		return nil
	}
	n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil {
		return nil
	}
	return &n
}

func textoOuNulo(v any) *string {
	s, ok := v.(string)
	if !ok {
		return nil
	}
	return &s
}

// tipos válidos: 'qualified_lead' substituiu 'lead_quente' em 05/10/2026 (o antigo segue
// aceito para reenvio de evento antigo).
var tiposDeLead = map[string]bool{"lead_novo": true, "lead_quente": true, "qualified_lead": true}

// Evento é POST /receber-webhook-chatwoot?token= (CRM: lead novo / qualificado):
// extrairEventoDoChatwoot de _shared/verificar-webhook-chatwoot.js. Cada conversa conta UMA
// vez por tipo (único em conversation_id+tipo): reenvio é inofensivo.
func (c *Chatwoot) Evento(w http.ResponseWriter, r *http.Request) {
	var in map[string]any
	if !c.entrada(w, r, &in) {
		return
	}
	tipo, _ := in["tipo"].(string)
	conversa := numeroOuNulo(in["conversation_id"])
	if !tiposDeLead[tipo] || conversa == nil || *conversa == 0 {
		responder(w, http.StatusBadRequest, map[string]string{"error": "payload_incompleto"})
		return
	}
	agora := time.Now
	if c.Agora != nil {
		agora = c.Agora
	}
	quando := agora()
	switch v := in["created_at"].(type) {
	case string:
		if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
			quando = t
		}
	case json.Number:
		if ms, err := v.Int64(); err == nil { // new Date(número) do JS = milissegundos
			quando = time.UnixMilli(ms)
		}
	}
	c.gravar(r.Context(), w, "evento", `insert into chatwoot_eventos (tipo, chatwoot_account_id, conversation_id,
		  conversation_display_id, contact_id, contact_name, contact_phone_number, loja, classificacao_ia, criado_em_chatwoot, dia_br)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text::date)
		on conflict (conversation_id, tipo) do nothing`,
		tipo, numeroOuNulo(in["account_id"]), *conversa, numeroOuNulo(in["conversation_display_id"]), numeroOuNulo(in["contact_id"]),
		textoOuNulo(in["contact_name"]), textoOuNulo(in["contact_phone_number"]), textoOuNulo(in["loja"]), textoOuNulo(in["classificacao_ia"]),
		quando.UTC(), quando.In(saoPaulo).Format("2006-01-02"))
}

var (
	naoAlfanumerico = regexp.MustCompile(`[^a-z0-9 ]`)
	frasesDeSaida   = map[string]bool{"parar": true, "pare": true, "sair": true}
	celularBR       = regexp.MustCompile(`^55[1-9][1-9]9\d{8}$`)
	naoDigito       = regexp.MustCompile(`\D`)
)

// limpar: sem acento (NFD e fora U+0300..U+036F, como o JS), minúsculas, só [a-z0-9 ].
func limpar(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		if r >= 0x300 && r <= 0x36f {
			continue
		}
		b.WriteRune(r)
	}
	t := naoAlfanumerico.ReplaceAllString(strings.ToLower(b.String()), " ")
	return strings.Join(strings.Fields(t), " ")
}

// normalizarTelefone (_shared/mensagem-de-abandono.js): só celular brasileiro, com DDI 55.
func normalizarTelefone(bruto string) string {
	d := naoDigito.ReplaceAllString(bruto, "")
	d = strings.TrimPrefix(d, "00")
	if n := utf8.RuneCountInString(d); n == 10 || n == 11 {
		d = "55" + d
	}
	if !celularBR.MatchString(d) {
		return ""
	}
	return d
}

// OptOut é POST /receber-opt-out-chatwoot?token= (evento padrão "message_created"): quem
// responde PARAR/SAIR (frase exata) ou "não quero receber..." vai para contatos_sem_mensagem.
func (c *Chatwoot) OptOut(w http.ResponseWriter, r *http.Request) {
	var in map[string]any
	if !c.entrada(w, r, &in) {
		return
	}
	conteudo, _ := in["content"].(string)
	t := limpar(conteudo)
	if in["event"] != "message_created" || in["message_type"] != "incoming" || !(frasesDeSaida[t] || strings.HasPrefix(t, "nao quero receber")) {
		responder(w, http.StatusOK, map[string]any{"ok": true, "ignorado": true})
		return
	}
	bruto, _ := mapa(in["sender"])["phone_number"].(string)
	if bruto == "" {
		bruto, _ = mapa(mapa(mapa(in["conversation"])["meta"])["sender"])["phone_number"].(string)
	}
	tel := normalizarTelefone(bruto)
	if tel == "" {
		responder(w, http.StatusOK, map[string]any{"ok": true, "ignorado": true})
		return
	}
	c.gravar(r.Context(), w, "opt-out", `insert into contatos_sem_mensagem (telefone, motivo) values ($1, $2) on conflict (telefone) do nothing`,
		tel, "resposta: "+t)
}
```

Depois: `go mod tidy` (só move `golang.org/x/text` para o `require` direto; confira com `git diff api/go.mod api/go.sum` que o `go.sum` não mudou e que não entrou módulo novo).

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l internal/ && go vet ./internal/webhooks/ && go test -race ./internal/webhooks/ -v 2>&1 | grep -E -- '--- (PASS|FAIL|SKIP)'`
Expected: só `--- PASS`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/webhooks/chatwoot.go api/internal/webhooks/chatwoot_test.go api/go.mod
git commit -m "feat(api): webhooks do Chatwoot (lead e opt-out) com segredo em tempo constante

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Montagem das rotas, limite por IP, worker e notas de implantação

**Revisor:** **opus** (fronteira entre rotas públicas e autenticadas).

**Files:**
- Modify: `api/internal/auth/middleware.go` (imports `strconv`, `time` + `LimitarPorIP`)
- Modify: `api/internal/web/rotas.go` (arquivo inteiro abaixo)
- Modify: `api/internal/web/rotas_test.go` (novo parâmetro de `Rotas` + 1 teste)
- Modify: `api/cmd/api/main.go` (`Rotas(..., cfg)` e o `case "worker"`)
- Modify: `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md` (seção nova no fim)
- Test: `api/internal/auth/limite_test.go`

**Interfaces:**
- Consumes: tudo das Tasks 1–8.
- Produces: `func auth.LimitarPorIP(max int, janela time.Duration) func(http.Handler) http.Handler`; `func web.Rotas(p *pgxpool.Pool, s *auth.Store, l *auth.Limitador, cfg config.Config) http.Handler`; o worker passa a registrar `push-vendas-07h` e `push-vendas-22h`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/auth/limite_test.go`:

```go
package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLimitarPorIP(t *testing.T) {
	h := LimitarPorIP(2, time.Minute)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) }))
	pedir := func(ip string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/x", nil)
		r.RemoteAddr = ip + ":1234"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	pedir("203.0.113.1")
	pedir("203.0.113.1")
	if w := pedir("203.0.113.1"); w.Code != 429 || w.Header().Get("Retry-After") != "60" {
		t.Fatalf("terceira do mesmo IP: %d RA=%q", w.Code, w.Header().Get("Retry-After"))
	}
	if w := pedir("203.0.113.2"); w.Code != 200 {
		t.Fatalf("outro IP não divide o balde: %d", w.Code)
	}
}
```

Em `api/internal/web/rotas_test.go`: acrescente `"strings"` e `"github.com/rbv-co/social-dashboard/api/internal/config"` aos imports, troque as duas chamadas `Rotas(p, auth.NovoStore(p), auth.NovoLimitador())` e `Rotas(p, s, auth.NovoLimitador())` por versões com `config.Config{}` no fim, e acrescente:

```go
// Nenhuma rota portada fica aberta: sem sessão = 401; webhook sem assinatura/segredo = 401
// (e não 404: a rota existe). Pega rota montada fora do grupo certo.
func TestRotasDoPlano3NaoFicamAbertas(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{ShopifySegredos: []string{"s"}, ChatwootSegredo: "c"})
	for _, c := range []struct{ metodo, caminho string }{
		{"GET", "/eu/canais"}, {"POST", "/bling-proxy"}, {"POST", "/meta-proxy"},
		{"POST", "/insights-ao-vivo"}, {"POST", "/serie-novos-dia"}, {"POST", "/contar-collabs"},
		{"POST", "/receber-webhook-pedido-shopify"}, {"POST", "/receber-webhook-checkout"}, {"POST", "/receber-webhook-abandono"},
		{"POST", "/receber-webhook-chatwoot"}, {"POST", "/receber-opt-out-chatwoot"},
	} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest(c.metodo, c.caminho, strings.NewReader(`{"a":1}`)))
		if r.Code != http.StatusUnauthorized {
			t.Errorf("%s %s = %d, esperava 401", c.metodo, c.caminho, r.Code)
		}
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/auth/ ./internal/web/ -v`
Expected: FAIL de compilação (`undefined: LimitarPorIP`, `too many arguments in call to Rotas`).

- [ ] **Step 3: Implementar**

Em `api/internal/auth/middleware.go`, acrescente `"strconv"` e `"time"` aos imports e, no fim do arquivo:

```go
// LimitarPorIP é o limite de taxa das rotas públicas (spec §5): no máximo `max` requisições
// por IP (ipDe: X-Real-IP só vindo do proxy) por `janela`; acima disso, 429 com Retry-After.
// ponytail: em memória, vale para uma instância só (como o limitador de login).
func LimitarPorIP(max int, janela time.Duration) func(http.Handler) http.Handler {
	l := NovoLimitador()
	l.Max, l.Janela = max, janela
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !l.Tentar(ipDe(r)) {
				w.Header().Set("Retry-After", strconv.Itoa(int(janela.Seconds())))
				erroJSON(w, http.StatusTooManyRequests, "muitas_requisicoes")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
```

Substitua `api/internal/web/rotas.go` por:

```go
// Package web monta o roteador HTTP.
package web

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/canais"
	"github.com/rbv-co/social-dashboard/api/internal/comercial"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/meta"
	"github.com/rbv-co/social-dashboard/api/internal/webhooks"
)

// Rotas: tudo atrás de sessão (Exigir) e de um portão, exceto a lista PÚBLICA explícita
// (saúde, login e os webhooks, que se autenticam por assinatura/segredo e têm limite por IP).
// As rotas portadas das edges têm o MESMO nome, corpo e resposta da edge (Plano 7 troca
// `functions.invoke(nome)` por `POST /nome`).
func Rotas(p *pgxpool.Pool, s *auth.Store, l *auth.Limitador, cfg config.Config) http.Handler {
	r := chi.NewRouter()
	r.Get("/saude", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	r.Get("/pronto", func(w http.ResponseWriter, r *http.Request) {
		if err := p.Ping(r.Context()); err != nil {
			http.Error(w, "banco indisponível", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})
	h := auth.NovosHandlers(p, s, l)
	r.Post("/auth/entrar", h.Entrar)

	// Webhooks: públicos, sem sessão. O fan-out do core vem de um IP só: teto folgado.
	sh := &webhooks.Shopify{Pool: p, Segredos: cfg.ShopifySegredos}
	cw := &webhooks.Chatwoot{Pool: p, Segredo: cfg.ChatwootSegredo}
	r.Group(func(r chi.Router) {
		r.Use(auth.LimitarPorIP(600, time.Minute))
		r.Post("/receber-webhook-pedido-shopify", sh.Pedido)
		r.Post("/receber-webhook-checkout", sh.Checkout)
		r.Post("/receber-webhook-abandono", sh.Abandono)
		r.Post("/receber-webhook-chatwoot", cw.Evento)
		r.Post("/receber-opt-out-chatwoot", cw.OptOut)
	})

	cli := core.Novo(cfg.CoreURL, cfg.CoreToken)
	av := &meta.AoVivo{Pool: p, Core: cli}
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.Post("/auth/sair", h.Sair)
		r.Get("/auth/eu", h.Eu)
		r.Get("/eu/canais", canais.Handler(p))
		r.Post("/bling-proxy", (&comercial.Bling{Pool: p, Core: cli}).ServeHTTP) // portão por caminho, lá dentro
		r.With(auth.ExigirModulo("meta")).Post("/meta-proxy", (&meta.Proxy{Pool: p, Core: cli, HostsDeMidia: cfg.HostsDeMidia}).ServeHTTP)
		r.With(auth.ExigirModulo("social")).Post("/insights-ao-vivo", av.Insights)
		r.With(auth.ExigirModulo("social")).Post("/serie-novos-dia", av.SerieNovosDia)
		r.With(auth.ExigirModulo("social")).Post("/contar-collabs", av.ContarCollabs)
	})
	return r
}
```

Em `api/cmd/api/main.go`: acrescente aos imports `.../internal/comercial`, `.../internal/core` e `.../internal/webpush`; troque `web.Rotas(p, auth.NovoStore(p), auth.NovoLimitador())` por `web.Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), cfg)`; e troque o `case "worker":` inteiro por:

```go
	case "worker":
		ag := worker.Novo(p)
		pv := &comercial.PushVendas{Pool: p, Core: core.Novo(cfg.CoreURL, cfg.CoreToken),
			VAPID: webpush.VAPID{Publica: cfg.VAPIDPublica, Privada: cfg.VAPIDPrivada, Assunto: cfg.VAPIDAssunto}}
		for _, t := range pv.Tarefas() {
			if err := ag.Registrar(t); err != nil {
				slog.Error("tarefa", "nome", t.Nome, "erro", err)
				os.Exit(1)
			}
		}
		slog.Info("worker no ar", "tarefas", len(pv.Tarefas()))
		ag.Iniciar(ctx)
```

Acrescente ao fim de `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`:

```markdown
## Plano 3 — edges do core (Bling, Meta, push de vendas, webhooks)

### Variáveis de ambiente novas
- `CORE_URL` (padrão `https://core.rbvcompany.com`) e `CORE_API_TOKEN` — api e worker. No core, o consumidor desta API precisa estar em `CORE_API_TOKENS` com os escopos `bling` e `meta` (`AutenticaConsumidor`). Sem token: as rotas do core respondem 503 e o push de vendas termina com erro.
- `HOSTS_DE_MIDIA` (api): host(s) de onde o meta-proxy aceita imagem/vídeo. Vazio = nenhum upload. O mesmo host vai para `META_HOSTS_MIDIA` do core (quem baixa a imagem é o core).
- `SHOPIFY_WEBHOOK_SEGREDOS` (api, lista por vírgula): segredo do admin da loja, segredo do app e o `segredo` do destino desta API em `CORE_SHOPIFY_DESTINOS`. Vazio = 401 em tudo.
- `CHATWOOT_WEBHOOK_SEGREDO` (api). Vazio = 401 em tudo.
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (worker): os MESMOS valores de `segredos_de_cron` (`vapid_public_key`, `vapid_private_key`, `vapid_subject`), copiados por quem tem acesso. Trocar a chave invalida todas as inscrições de push.

### nginx (location `/api`)
- `/api/receber-webhook-chatwoot` e `/api/receber-opt-out-chatwoot` levam o segredo na query (`?token=`): nessas locations, `access_log off;` ou um `log_format` sem `$request_uri`/`$args` (ex.: `'$remote_addr [$time_local] "$request_method $uri" $status'`). A API nunca loga a URL.
- `client_max_body_size 5m;` nas rotas `/api/receber-webhook-*` (pedido grande da Shopify).
- `proxy_read_timeout 90s;` em `/api` (upload de vídeo pelo meta-proxy espera até 75 s).
- O limite por IP dos webhooks (600/min) depende do `X-Real-IP` (requisito já registrado acima).

### Dia da virada (Plano 8)
- Core: três destinos em `CORE_SHOPIFY_DESTINOS`, todos com o mesmo `segredo` (que entra em `SHOPIFY_WEBHOOK_SEGREDOS`): `/api/receber-webhook-pedido-shopify` (`orders/create`, `orders/paid`, `orders/updated`), `/api/receber-webhook-checkout` (`checkouts/create`) e `/api/receber-webhook-abandono` (`checkouts/create`, `checkouts/update`, `orders/create`, `orders/paid`, `orders/cancelled`); remover os webhooks antigos (que apontam para as edges) na Shopify no MESMO momento e ligar `CORE_SHOPIFY_FANOUT=true` (`vessel-core-go/docs/migracao-core/SHOPIFY.md`, "Ordem de virada", passo 7).
- Chatwoot: `CRM_EVENT_WEBHOOK_URL` e o webhook padrão "Message created" para as URLs novas, com o mesmo `?token=`.
- `estoque-do-site` não existe mais (desligado em produção em 2026-10-08; o core assumiu o estoque): nada a trocar.

### Pendências para os próximos planos
- Purga de `webhooks_recebidos` com mais de 30 dias (plano de crons).
- Unificar `Ator.PodeModulo` (`profiles.features`) com `Ator.Pode` (`permissions`) no plano de domínios.
- Coletores Meta de cron (`coletar-dados`, `coletar-dados-hora`, `conteudo-espelho`) e o disparo imediato do abandono: plano de crons.
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go build -o /dev/null ./cmd/api && go test -race ./... -v 2>&1 | grep -E -- '--- (FAIL|SKIP)'; echo "fim"`
Expected: nada antes de `fim` (nenhum FAIL nem SKIP); `go build` sem erro.

- [ ] **Step 5: Commit**

```bash
git add api/internal/auth/middleware.go api/internal/auth/limite_test.go api/internal/web api/cmd/api/main.go docs/migracao-go/NOTAS-DA-IMPLANTACAO.md
git commit -m "feat(api): monta as rotas do Plano 3, limite por IP nos webhooks e push de vendas no worker

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Verificação final do Plano 3

- [ ] `docker stop pg-plano3` e depois `make -C api teste PG_PORTA=58432` → todos os pacotes `ok`.
- [ ] Contagem de executados × pulados com banco: `cd api && TEST_DATABASE_URL=... go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0` (subir o contêiner de novo só para isto, ou confiar no `make`, que define `TEST_DATABASE_URL`).
- [ ] `cd api && gofmt -l . && go vet ./...` → nada listado.
- [ ] `git diff feat/api-go-postgres-ensaio --stat -- supabase/ src/ coletor/` → vazio (este plano não toca nas edges, no front nem nos robôs; elas continuam no ar até a virada).
- [ ] `grep -rn "graph.facebook.com\|api.bling.com.br\|myshopify.com" api/internal --include=*.go | grep -v _test.go` → só linhas de `meta/ao_vivo.go` (a checagem de host de `traduzirURL` e o comentário dela); nenhuma chamada direta.
- [ ] Revisão final do branch (whole-branch review) pedida a um revisor opus, com o foco em: rotas públicas × autenticadas, vazamento de segredo, SSRF (mídia do meta-proxy e endpoint de push), HMAC e transação efeito + marca.

## Rulings do plano

- Ruling: Os coletores Meta de cron (`coletar-dados`, `coletar-dados-hora` com a retentativa das 00h, `conteudo-espelho`) vão para o Plano 4; este plano porta os coletores "ao vivo" do front (`insights-ao-vivo`, `serie-novos-dia`, `contar-collabs`) e o cliente Meta que os de cron vão usar — são ~1.270 linhas de tarefa agendada que grava em várias tabelas e carrega a decisão sobre robô que já falha (`meta-hora`), que é do plano de crons; com eles o plano passaria de 10 tarefas — custo: o Plano 4 cresce e a linha dos coletores do mapa da spec §8 só fecha lá.
- Ruling: As rotas Go têm o MESMO nome da edge (`POST /bling-proxy`, `/meta-proxy`, `/insights-ao-vivo`, `/serie-novos-dia`, `/contar-collabs`, `/receber-webhook-*`, `/receber-opt-out-chatwoot`) e o mesmo corpo de entrada e de saída; só 401/403 de sessão usam o formato do núcleo — o Plano 7 troca `functions.invoke(nome, {body})` por `POST /api/nome` sem tradutor — custo: nomes "de edge" ficam na API.
- Ruling: As rotas portadas autorizam pelo portão que a edge usa hoje — `profiles.role = 'admin'` ou o módulo em `profiles.features` — via `Ator.PodeModulo` (no mesmo `pode.go` de `Pode`), mais super-admin; a unificação com `permissions` fica para o Plano 5 — é o que preserva "as mesmas permissões de hoje" mesmo com `features` dessincronizado de `permissions` — custo: dois portões convivem até o Plano 5, e um super-admin com `role` diferente de `admin` passa a entrar onde a edge o barrava.
- Ruling: Conta de serviço = sessão `tipo = 'servico'`, nunca limitada a loja (regra explícita e testada em `canais.Carregar` e no bling-proxy); os robôs de hoje entram com sessão `painel` e `escopo_por_equipe = false` e seguem vendo tudo pela regra normal — a spec §4 pede a regra explícita, e `tokens_de_servico` só chega com o coletor (Plano 7) — custo: se alguém ligar `escopo_por_equipe` na conta dos robôs antes do Plano 7, eles ficam limitados (como hoje).
- Ruling: Pessoa sem linha em `profiles` recebe `[]` (nenhum canal) em `/eu/canais`, não `null` — falta de dado nunca amplia, o princípio do próprio módulo JS — custo: nenhum prático (sem perfil não passa no portão de vendas).
- Ruling: `GET /eu/canais` devolve só `{"canais": null | [ids]}`; a frase do recorte e o mapa de nomes continuam no front, que já lê `bling_lojas` — o mínimo que elimina a regra duplicada — custo: o front monta a frase com `fraseDoRecorte` até o Plano 7.
- Ruling: 401/403 do core SEM `X-Core-Origem` (autenticação do consumidor no core) vira 502 no bling-proxy, em vez de repassar um 401 que o front leria como "sessão expirada"; com `X-Core-Origem: bling` ou `proxy` passa como veio — custo: um core sem o cabeçalho faria um 401 legítimo do Bling aparecer como 502.
- Ruling: Este plano não escreve no Bling (toda chamada é GET), então o cliente não manda `idempotency_key`; método diferente de GET sai uma vez só e nunca se repete — é o que impede duplicar movimento, sem código que ninguém usa — custo: o primeiro domínio que escrever no Bling (Plano 5) acrescenta a chave estável (`origem:operacao:hash`, `_shared/core-bling-proxy.js:17-20`).
- Ruling: A política de repetição do Bling é a de `_shared/tentar-de-novo.js` (11 s por tentativa, 25 s de orçamento, 3 tentativas, espera 600/1200 ms ou o `Retry-After` maior) e vale também para o push de vendas (a edge do push repetia 3 vezes qualquer erro, até 4xx) — uma regra só, medida em produção — custo: o push não repete 4xx, que repetir não resolve.
- Ruling: Meta repete só 429 do core (recuo; nada chegou à Meta): até 3 vezes nas rotas ao vivo e nenhuma no meta-proxy, como as edges; 5xx, rede e prazo nunca — POST repetido duplicaria campanha — custo: um soluço de rede vira erro na tela (o gestor já tenta de novo).
- Ruling: A API não tem gate de taxa próprio para Bling/Meta: o gate de 3 req/s por conta Bling e o recuo da Meta são do core (spec §14), e o 429 do core é tratado como falha repetível — custo: rajada da API espera na fila do core e, acima de 600/min por consumidor, recebe 429.
- Ruling: Limites de corpo: 64 KB em `bling-proxy`, `meta-proxy` e rotas ao vivo (o core recusa `parametros` acima de 64 KB), 5 MB nos webhooks Shopify, 1 MB nos do Chatwoot; resposta do core até 32 MB — custo: pedido da Shopify acima de 5 MB recebe 413 e vai para a fila de falhas do core.
- Ruling: Hosts de mídia do meta-proxy vêm de `HOSTS_DE_MIDIA` (vazio = nenhum upload; fail-closed), e não do host do Supabase — o Storage muda de casa no Plano 6 — custo: upload de criativo quebra até o host novo estar nesta lista E no `META_HOSTS_MIDIA` do core.
- Ruling: Replay e reentrega de webhook Shopify são barrados por `X-Shopify-Event-Id` em `webhooks_recebidos` (por rota), gravado na mesma transação do efeito; sem o cabeçalho, processa (os efeitos são idempotentes); sem janela de tempo, porque o core não repassa `X-Shopify-Triggered-At` e reentrega até ~5 h depois — custo: um evento velho fora de ordem ainda pode sobrescrever estado mais novo (como hoje).
- Ruling: Erro de banco em qualquer receptor (Shopify e Chatwoot) devolve 500, não 200 — com o fan-out do core a reentrega é limitada (1/5/15/60/240 min), não vira tempestade, e as edges de pedido, checkout e Chatwoot perdiam o evento — custo: até 5 entregas extras por evento enquanto o banco estiver fora.
- Ruling: JSON inválido com assinatura válida → 200 `ignorado: json_invalido` (repetir não conserta); checkout sem `cart_token` → 200 `ignorado: sem_cart_token`, sem tentar gravar (a coluna é `not null`; a edge tentava e logava erro) — custo: nenhum.
- Ruling: Um só `SHOPIFY_WEBHOOK_SEGREDOS` (lista por vírgula) no lugar de `SHOPIFY_WEBHOOK_SECRET` + `SHOPIFY_CLIENT_SECRET`, que também recebe o segredo do destino no fan-out do core; vazio = 401 em tudo — um lugar só para os três segredos — custo: um nome de variável novo no dia da virada (Plano 8).
- Ruling: O segredo do Chatwoot continua na query `?token=` (o webhook padrão do Chatwoot não manda cabeçalho próprio); a API nunca loga a URL e o nginx não pode logar a query dessas rotas (requisito nas NOTAS) — custo: o segredo depende da configuração do nginx para não ir parar em log de acesso.
- Ruling: O "disparo imediato" (`DISPARO_IMEDIATO`) de `receber-webhook-abandono` não é portado — depende da rodada de mensagens (`enviar-mensagem-abandono`, Plano 4) e o cron de 1 minuto cobre — custo: até 1 minuto a mais para a mensagem sair, se a flag estiver ligada em produção.
- Ruling: O receptor de abandono chama as funções SQL que já estão no banco restaurado (`registrar_checkout_abandono`, `marcar_checkout_comprou`...) com argumentos nomeados, em vez de reescrevê-las — o Plano 2 restaura as 308 funções como estão e a triagem é do Plano 5 — custo: se o Plano 5 reescrever essas funções em Go, este receptor muda junto.
- Ruling: VAPID vai para env (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`) com os MESMOS valores de `segredos_de_cron` — exceção à regra de rotacionar da spec §6, porque trocar a chave invalida todas as inscrições de push — custo: a chave antiga continua valendo; rotacionar = todo mundo se reinscreve (decisão do dono).
- Ruling: Web Push feito só com a biblioteca padrão (`crypto/ecdh`, `crypto/hkdf`, AES-GCM, ECDSA), provado byte a byte contra o vetor do RFC 8291 §A e com decifragem do lado do "navegador" no teste — sem dependência nova e sem `go get` — custo: ~150 linhas de cripto próprias (revisor opus).
- Ruling: Endpoint de push só https num host por nome (nunca IP literal nem `localhost`) — o endpoint vem do navegador e o worker faz POST nele (SSRF cego) — custo: um serviço de push servido por IP literal deixaria de receber (nenhum conhecido).
- Ruling: O push de vendas lê `nota_situacao` de `bling_pedido_nota`, como as telas (`src/compartilhado/data-da-venda.js:32`); a edge esquecia a coluna e por isso nunca tirava nota negada nem trazia nota de outro dia — o objetivo declarado da regra é o push bater com o telão — custo: o número do push muda nos dias com nota negada ou trazida.
- Ruling: "Não enviou por dado incompleto" vira erro da tarefa (`ok = false` com o motivo em `robos_execucoes`) em vez de 200 `enviado:false` — o worker só registra ok/erro, e falha calada é pior — custo: a tela de saúde passa a mostrar falha nesses dias.
- Ruling: O push de vendas não tem rota HTTP (só as tarefas do worker) e o segredo de cron some — o pg_cron era o único chamador — custo: sem disparo manual por HTTP.
- Ruling: Datas em `America/Sao_Paulo` com `time/tzdata` embutido (a edge do push usava UTC−3 fixo; dá no mesmo desde 2019) — correto nos casos de borda e independente do contêiner — custo: ~450 KB no binário.
- Ruling: `CORE_API_TOKEN` e os segredos são opcionais na carga: sem token as rotas do core respondem 503 e o push termina com erro; sem segredo os webhooks respondem 401 — a API sobe no ensaio do Plano 2 sem core — custo: esquecer uma variável só aparece na primeira chamada.
- Ruling: `estoque-do-site` não é portado — desligado em produção em 2026-10-08, o core assumiu o estoque (`RESULTADO-DO-LEVANTAMENTO.md`) — custo: nenhum (se o core devolver o estoque, vira tarefa do Plano 4).
- Ruling: Sem CORS nas rotas deste plano — o front chama a API pela mesma origem (`/api` no vhost da central) e os webhooks e robôs não são navegador; as edges respondiam `Access-Control-Allow-Origin: *` — custo: um cliente de navegador em outra origem (nenhum conhecido) teria de esperar o CORS do plano da Vessel.
- Ruling: Rotas de webhook com limite de 600 requisições por minuto por IP (`auth.LimitarPorIP`, spec §5) — o fan-out vem de um IP só, o do core — custo: rajada maior recebe 429 e o core reentrega depois.
- Ruling: O opt-out tira acento com `golang.org/x/text/unicode/norm` (já no `go.sum`; vira dependência direta) para igualar o NFD do JS — custo: uma linha a mais no `require` do `go.mod`.
- Ruling: `profiles.role` é lido como `role::text` em `CarregarAtor` (pode ser enum, NOTAS-DA-IMPLANTACAO) — custo: nenhum.
- Ruling: Lacuna — o contrato do core foi lido do repositório `vessel-core-go` no commit `168882e29` (`docs/migracao-core/PROXY-BLING.md`, `API-META.md`, `SHOPIFY.md`, `BlingProxyController.php`, `AutenticaConsumidor.php`, `MetaGraphController.php`); o core em produção, e a porta dele para Go (PR `rbv-co/vessel#223`), podem estar em outra versão; o plano não presume nada além desse contrato — custo: se `X-Core-Origem` ou os códigos de erro mudarem, bling-proxy e meta-proxy classificam errado; conferir antes da virada.

## Cobertura da spec e o que vem depois

| Spec | Onde |
|---|---|
| §8 `bling-proxy` → Go-api falando com o core | Tasks 1 e 3 |
| §5 regra de canais por loja portada UMA vez + `GET /eu/canais` | Task 2 |
| §4 conta de serviço não limitada a loja, explícita e testada | Task 2 (`TestCarregar`) e Task 3 (`TestBlingProxyLimitadaALoja`) |
| §8 `meta-proxy` → Go-api pelo proxy Meta do core | Task 4 |
| §8 coletores Meta, parte "ao vivo" (Go-api) | Task 5 |
| §8 coletores Meta, parte de cron (Go-worker) | **Plano 4** (Ruling) |
| §8 `enviar-push-vendas` → Go-worker, pedidos via core | Task 6 |
| §8.1 `push-vendas-07h` (`0 10 * * *`) e `-22h` (`0 1 * * *`) | Task 6 (`Tarefas`) e Task 9 (registro no worker) |
| §8 `receber-webhook-pedido-shopify`, `-checkout`, `-abandono` → core recebe e repassa; Go-api com HMAC | Task 7 |
| §8 `receber-webhook-chatwoot`, `receber-opt-out-chatwoot` → Go-api com segredo compartilhado | Task 8 |
| §5/§11 rotas públicas: lista explícita, limite de taxa, validação, HMAC | Tasks 7, 8 e 9 |
| §8 `estoque-do-site` | não portado (Ruling) |
| §14 Bling sempre pelo core (rate gate de 3 req/s) | Task 1 |
| §11 segredos fora de tabela e de log | Tasks 1, 4, 6, 7, 8 (testes de vazamento) e Ruling do VAPID |

**O que o Plano 4 (worker e crons) assume:** `core.Cliente` (Bling e Meta) e as funções `graph`, `comoGraph`, `traduzirURL`, `lerBrutoDoDia`, `semResposta`, `podeBuscarProxima` do pacote `meta` para portar `coletar-dados`, `coletar-dados-hora` (+ retentativa das 00h) e `conteudo-espelho`; `webpush.Enviar` para `enviar-push-saldo` e `enviar-push-frota` (com `coalesce(..., false)`, porque esses tipos são desligados por padrão); a purga de `webhooks_recebidos` (> 30 dias); `enviar-mensagem-abandono` e, se o dono quiser, o disparo imediato chamado no fim de `webhooks.Shopify.Abandono`; o worker já registra tarefas de verdade (as duas do push de vendas).

**Plano 5 (domínios):** unificar `PodeModulo` (`features`) com `Pode` (`permissions`); decidir se as funções SQL do abandono viram Go; acrescentar `idempotency_key` ao cliente do core quando o primeiro domínio escrever no Bling.

**Plano 6 (Storage e Vessel):** o host novo dos criativos entra em `HOSTS_DE_MIDIA` e no `META_HOSTS_MIDIA` do core.

**Plano 7 (front e robôs):** o front troca `functions.invoke('bling-proxy' | 'meta-proxy' | 'insights-ao-vivo' | 'serie-novos-dia' | 'contar-collabs', {body})` por `POST /api/<mesmo nome>` com o mesmo corpo e passa a usar `GET /api/eu/canais` no lugar de `canais-de-venda-permitidos.js` (que fica até lá, porque as edges seguem no ar); os 6 robôs do `coletor/` que usam o bling-proxy e os 24 pontos que usam o meta-proxy passam a entrar com sessão `servico` (tokens de serviço).

**Plano 8 (virada):** os passos de "Dia da virada" que esta entrega deixa escritos em `NOTAS-DA-IMPLANTACAO.md` (destinos do fan-out no core com o segredo, remoção dos webhooks antigos na Shopify no mesmo momento, URLs do Chatwoot, variáveis de ambiente, VAPID copiado).
