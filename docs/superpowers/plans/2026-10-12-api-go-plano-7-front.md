# Sair do Supabase — Plano 7: o front trocando o Supabase pela API em Go, área por área

> **For agentic workers:** executado pela trilha C (`~/Projetos/Trabalho/lavessel/MIGRACAO-GO/C-front.md`), em worktrees próprias a partir de `origin/main`, uma branch por área. Steps em checkbox (`- [ ]`). Só se troca uma área depois de ela aparecer em `docs/migracao-go/API-PRONTA.md` **no `origin/main`** (`git show origin/main:docs/migracao-go/API-PRONTA.md`).

**Goal:** Tirar do navegador o acesso direto ao Supabase (`supabase-js`, REST cru, `.rpc`, `functions.invoke`, `supabase.auth`) trocando cada sítio por uma chamada ao cliente `src/compartilhado/api.js`, contra o contrato II.2 do plano-mãe, **atrás de uma chave por área que começa desligada**. Com a chave desligada a tela é byte a byte a de hoje; na virada (Plano 8) ligam-se todas.

**Architecture:** Um cliente só (`api.js`) que fala o contrato II.2 e devolve `{ data, error }` no mesmo formato do `supabase-js`, para a troca em cada sítio ser mecânica e o tratamento de erro da tela continuar o mesmo. A chave é de BUILD (`VITE_API_AREAS`), não de execução: o pacote de produção, sem a variável, nem contém o ramo novo ligado. A sessão do Supabase e a da API não convivem: a área `conta` é a base, e ligar qualquer outra sem ela é configuração inválida (o app recusa subir).

**Tech Stack:** Vue 3 + Vite 5 (o que já existe), `fetch`, `node --test` para a lógica pura. Nenhuma dependência nova.

**Spec e contrato:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§4 sessões, §9 workstream 7), `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (II.2 contrato, "Mudanças de contrato que o Plano 7 absorve", tabela IV.2, coluna "Telas e sítios a trocar"), `docs/migracao-go/RESULTADO-DO-LEVANTAMENTO.md`.

## Global Constraints

- **Nada muda na produção antes da virada.** O build de produção não define `VITE_API_AREAS`; toda chave fica desligada e o caminho do Supabase segue intacto. Teste que prova: `api.test.mjs` (sem variável = nenhuma área) e o `npm run build` sem a variável.
- **Uma chave por área, padrão desligado.** O ramo novo só roda com `areaNaApi('<area>')` verdadeiro. Ramo velho não é apagado antes da virada (o Plano 8 limpa).
- **`conta` é pré-requisito de toda área.** Sem a sessão da API, a área nova tomaria 401; com a sessão da API, a área velha toma 401 do Supabase. `lerAreas` recusa (lança) lista com área e sem `conta`.
- **Não contornar a API.** Se uma tela precisa de algo que a rota não dá, pede-se à trilha dona (README da migração, seção 1.3) por uma linha no `COORDENACAO.md` (não por `SendMessage`: pede aprovação ao dono a cada envio). Nunca se lê do Supabase "só esse pedaço" com a chave ligada.
- **Contrato II.2 é lei.** O cliente não "conserta" resposta: se a forma diverge do PostgREST que a tela lia, é defeito da rota (pedido à trilha dona), não adaptação no front.
- **Padrão da Central** (`PADRAO-DA-CENTRAL.md`): toda tela trocada é medida a 375 px e no desktop, com a chave ligada contra a API local, num navegador de verdade.
- **Segredo nunca no código:** o token de sessão vive no `localStorage` (ou `sessionStorage` na aba de "entrar como"), como o do Supabase vive hoje; o token de link de senha só na memória, e o hash é limpo antes de qualquer `await`.
- **Testes locais antes de merge** (`npm test`, `npm run build`), resultado colado no PR. CI do GitHub parado por billing.
- Commits terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---
## I. A chave por área

| Chave | Sub-plano | Telas e sítios (coluna "Telas" da IV.2) |
|---|---|---|
| `conta` | 5.0 (+ Planos 3/4 já mesclados) | `ponto-de-partida.js`, `controle-de-login-e-usuario.js`, `login/tela-de-login.vue`, `moldura-do-aplicativo.vue` (troca de senha, sair, "entrar como"); as edges `invite-user` (Admin 3×, Frota, Redes), `entrar-como-usuario` (Admin) e `conferir-senha` (Frota, Autenticidade) |
| `edges-core` | Planos 3 e 4 | `bling-proxy` (`chamada-do-bling.js`), `meta-proxy`, `insights-ao-vivo`, `serie-novos-dia`, `contar-collabs`, `avisar-decisao-de-reserva` — sítios de `functions.invoke`/`fetch …/functions/v1/` dessas edges |
| `admin` | 5.1 | `admin/tela-de-admin.vue`, pedir acesso no login, `notificacoes-push.js` |
| `patrimonio` | 5.2 | `patrimonio/*`, cadastro rápido em `frota` e `acessos` |
| `frota` | 5.3 | `frota/*` |
| `acessos` | 5.4 | `acessos/tela-de-acessos.vue` |
| `comercial` | 5.5 | `analise-vendas`, `gestao-a-vista`, `gestao-comercial`, `vendas`, `pedidos-shopify.js`, `valor-corrigido.js`, `vendedor-corrigido.js`, `data-da-venda.js` |
| `meta` | 5.6 | `redes-sociais`, `analise-campanhas`, `meta-ads` (métricas), aba Saúde do Admin |
| `trafego` | 5.7 | `gestao-trafego` |
| `fabrica` | 5.8 | `meta-ads` (estúdio e fábrica) |
| `conteudo` | 5.9 | `conteudo/*` |
| `autenticidade` | 5.10 | `autenticidade/*` |
| `vessel` | 5.11 | `comercial-vessel/*`, `beauty-sessions`, `atendimentos`, `abandono-carrinho`, `meta-ads` (leads) |
| `paineis` | 5.12 | `noticias`, `claude-status`, `inicio`, `gestao-interna` |

**Como liga:** `VITE_API_AREAS=conta,admin npm run dev` (ou `*` para todas). Valor vazio ou ausente = nenhuma. Nome desconhecido = erro no carregamento (pega erro de digitação em vez de deixar a área no Supabase calada).

**Onde a API mora:** `VITE_API_BASE` (padrão `/api`, o `location /api/` do nginx). No `npm run dev`, o Vite repassa `/api/*` para `VITE_API_ALVO` (padrão `http://127.0.0.1:8080`) tirando o `/api` — o mesmo que o nginx faz.

---
## II. O cliente `src/compartilhado/api.js`

- `lerAreas(texto)` → `Set` (puro, testado); `areaNaApi(area)` lê o conjunto do build.
- `pedir(metodo, caminho, { corpo, params, semSessao })` → `{ data, error, status, total }`. Nunca lança.
  - Manda `Authorization: Bearer <token>` (menos com `semSessao`), `Content-Type: application/json` quando há corpo.
  - `200/201` → `data` = JSON; `204` → `data = null`; `total` = `X-Total-Count` quando pedido com `contar=1`.
  - Falha → `error = { ...classificarErro(status, corpo), status, codigo: corpo.error, message }`, onde `message` = `corpo.mensagem` (frase para a pessoa, quando a API manda) ou a frase da classificação. Rede caída → `ERRO_DE_REDE` com `status: 0`.
- `rpc(nome, args)` = `pedir('POST', '/rpc/' + nome, { corpo: args ?? {} })`.
- `edge(nome, corpo)` = `pedir('POST', '/' + nome, { corpo })` — edges portadas mantêm corpo e resposta da edge. A edge que responde `{ error }` com 4xx continua chegando em `error.codigo`/`data` como antes.
- Sessão: `lerToken()`, `guardarToken(t)`, `apagarToken()` na chave `central_sessao_api` do armazenamento da aba (`sessionStorage` em modo "entrar como", `localStorage` no resto — a mesma regra de `conectar-no-banco-de-dados.js`).
- **Classificação de erro:** a de `classificar-erro.js`, que passa a reconhecer `403 {"error":"conta_desativada"}` como `CONTA_DESATIVADA` e `429` como "muitas tentativas" (o resto já vale: 401 → sessão expirou, 403 → sem permissão, outro → servidor).

---
## III. Login, sessão e conta (área `conta`, contra o 5.0)

| Hoje (Supabase) | Com `conta` ligada |
|---|---|
| `auth.getSession()` no boot | token guardado → `GET /auth/eu` → `GET /eu/perfil`; `401` apaga o token |
| `auth.onAuthStateChange` (troca de usuário em outra aba) | evento `storage` na chave do token: some = sai; muda = recarrega sessão e perfil |
| `auth.signInWithPassword` | `POST /auth/entrar {email, senha}` → `{token}`; `401 credenciais_invalidas` = "Email ou senha incorretos."; `403 conta_desativada` = `CONTA_DESATIVADA`; `429` = muitas tentativas |
| RPC `minha_conta_esta_desativada` | some: conta desativada não tem sessão (`401`) e o login devolve `403 conta_desativada` |
| `auth.resetPasswordForEmail` | `POST /auth/esqueci-senha {email}` → `202` (sempre igual) |
| link `#access_token…&type=recovery` | link `#type=recovery|invite&token=…`: o boot lê, **limpa o hash com `history.replaceState` antes de qualquer `await`**, guarda o token só em memória e abre o formulário |
| `auth.updateUser({password})` no formulário do link | `POST /auth/definir-senha {token, senha}` → `{token}` de sessão; `400 senha_invalida`/`token_invalido` mostram a `mensagem` |
| `auth.updateUser` + RPC `marcar_senha_trocada` (moldura) | `POST /auth/trocar-senha {senha}` → `204` (já tira `precisa_trocar_senha`) |
| `auth.signOut()` | `POST /auth/sair` + apagar token |
| `signOut({scope:'local'})` da aba "entrar como" | `POST /auth/sair` (só revoga a sessão impersonada) + apagar token da aba |
| `entrar-como-usuario` → `access_token/refresh_token` no hash | `POST /entrar-como-usuario {alvoId}` → `{token, expira_em}`; link `/?modo=entrar-como#sessao=<token>`; vale 1 h e não renova |
| `functions.invoke('invite-user'|'conferir-senha')`, `fetch …/functions/v1/…` | `edge('invite-user'|'conferir-senha', corpo)`; `conferir-senha` sem sessão = `401 nao_autenticado` |

`estado.currentSession` continua existindo (`{ access_token, user: { id, email } }`) para os sítios ainda não trocados lerem o token; com `conta` ligada, ele é o token da API.

**Pendência de API (pedida à trilha A em 12/10, aceita):** `GET /auth/eu` passa a devolver `email` e `nome` (Ruling no plano-mãe), no PR do 5.12. O front lê `eu.email`/`eu.nome`; até a rota mesclar, ficam vazios.

**Fora da área `conta`:** "Solicitar acesso" (`access_requests`, policy `public_insert`) segue com a chave `anon` do Supabase até a área `admin` (5.1, `POST /pedir-acesso`); funciona com `conta` ligada porque não precisa de sessão.

---
## IV. Área por área

Para cada área que aparecer no `API-PRONTA.md` do `origin/main`:

- [ ] Ler as rotas, os desvios do II.2 e os sítios listados pelo sub-plano.
- [ ] Worktree `plano-7-<area>` a partir do `origin/main`.
- [ ] Trocar cada sítio por `areaNaApi('<area>') ? <cliente> : <como hoje>`; quando a tela tem um ajudante (`sb`, `adFetch`, `chamar`), trocar o AJUDANTE uma vez em vez de cada chamada.
- [ ] Teste por ajudante trocado (caminho, método, corpo e leitura da resposta; `node --test` com `fetch` de mentira).
- [ ] Prova: API local (`go run ./cmd/api api` contra o Postgres do ensaio ou um descartável com o DDL do domínio), `VITE_API_AREAS=conta,<area> npm run dev`, a tela a 375 px e no desktop, cada ação de escrita uma vez.
- [ ] `npm test` e `npm run build` verdes; PR com o resultado; merge.
- [ ] Linha em `MIGRACAO-GO/COORDENACAO.md`.

O que faltar de rota vira pedido à trilha dona e linha na tabela "Pendências de API" do Resultado.

---
## V. Os robôs do `coletor/`

83 arquivos do `coletor/` falam com o Supabase (REST com a chave de serviço, alguns `pg` direto). Não é trabalho de tela: na virada, o caminho é um destes, decidido por robô quando os sub-planos fecharem:

1. **Postgres direto** (`DATABASE_URL` do Postgres próprio) para os robôs que já usam `pg`/SQL e escrevem em tabela de serviço — é o equivalente exato da chave de serviço;
2. **API com token de serviço** (`sessoes.tipo = 'servico'`, que o `auth.Exigir` já aceita) para os que chamam edges ou RPCs com regra de negócio.

O inventário (robô × tabelas/edges × caminho) é a primeira task deste item, feita depois que o 5.11 estiver mesclado (antes disso a lista de rotas não está fechada). Os crons já portados (Plano 4) saem da lista.

---
## Pronto quando

- Todas as áreas do `API-PRONTA.md` trocadas no front, atrás da chave, testadas (375 px e desktop contra a API local) e mescladas.
- O que falta de API listado com o dono de cada item.
- O inventário dos robôs do `coletor/` feito, com o caminho de cada um.

## Resultado

### Área `conta` (5.0) — 12/10/2026, branch `feat/plano-7-front`

**Trocado (atrás de `areaNaApi('conta')`):** boot e sessão (`ponto-de-partida.js`, `controle-de-login-e-usuario.js`), login, link de senha e "esqueci" (`tela-de-login.vue`), troca de senha e sair (`moldura-do-aplicativo.vue`), `entrar-como-usuario` e os 3 `invite-user` do Admin, `invite-user` da Frota e de Redes Sociais, `conferir-senha` da Frota e da Autenticidade. Cliente novo `src/compartilhado/api.js`; `classificar-erro.js` reconhece `conta_desativada` e `429`; `vite.config.js` repassa `/api` no `npm run dev`.

**Decisões:**
- Chave de BUILD (`VITE_API_AREAS`), não de execução: produção não tem a variável, e não existe jeito de ligá-la no navegador de alguém por engano.
- `conta` obrigatória para qualquer outra área (as duas sessões não convivem); erro de digitação na lista derruba o carregamento em vez de deixar a área calada no Supabase.
- `{ data, error }` no formato do supabase-js, para a troca em cada sítio ser mecânica; `corpoDaEdge` converte o erro do núcleo (`{error: código, mensagem}`) na frase que as telas já mostram, e `conferirSenhaPelaApi` devolve os códigos da edge (`401 nao_autenticado` → `sem_sessao`).
- Queda de rede ou 5xx no boot NÃO desloga nem rebaixa (mesma regra do caminho do Supabase); só `401` apaga o token.
- **Achado na prova:** o `createWebHistory` guarda o endereço quando o roteador carrega (antes do boot) e a navegação inicial regravava o `#sessao=<token>` na barra da aba de "entrar como". O boot agora navega o roteador para o endereço limpo depois de tirar o segredo.

**Prova** (API do `origin/main` em `127.0.0.1:58612`, Postgres 17 descartável com o DDL mínimo do `testebanco`, `VITE_API_AREAS=conta npm run dev`, Chrome de verdade, 10 verificações a 375 px e as mesmas 10 a 1440 px, sem rolagem lateral): senha errada; conta desativada; senha provisória com parede → troca → F5 continua logada e sem parede; a senha nova entra; sair revoga a sessão no servidor (401); convite com hash limpo → senha definida → logada; link reusado recusado; "esqueci" 202; "entrar como" com hash limpo, token só no `sessionStorage`, faixa roxa, e sair revoga SÓ a sessão impersonada (a do admin segue 200); token morto apagado → login. Com a chave desligada, o login vai ao Auth do Supabase e há 0 pedidos a `/api`. `npm test` 6730/6730, `npm run build` ok.

**Pendente da API:** `email`/`nome` no `GET /auth/eu` (trilha A, aceito, no PR do 5.12). Até mesclar, o e-mail fica vazio no avatar e na faixa do "entrar como" — e, com a faixa numa linha só, o avatar (`top: 92px`, que supõe a faixa em duas linhas) cai sobre o seletor grade/lista a 375 px. Reconferir a 375 px quando o e-mail chegar.

**Fora da `conta`, de propósito:** "Solicitar acesso" segue no Supabase com a chave `anon` até a área `admin` (5.1).

### Pendências de API

| Item | Dono | Situação |
|---|---|---|
| `email` e `nome` em `GET /auth/eu` | A (5.0, no PR do 5.12) | aceito em 12/10 |
