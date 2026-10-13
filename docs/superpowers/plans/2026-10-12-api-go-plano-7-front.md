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
| `edges-core` | Planos 3 e 4 | `bling-proxy` (`chamada-do-bling.js`, Gestão Comercial), `meta-proxy` (Análise de Campanhas, Gestão de Tráfego, Fábrica, `painel-subir`), `insights-ao-vivo`, `serie-novos-dia`, `contar-collabs` (Redes), `avisar-decisao-de-reserva` (Frota). O `GET /eu/canais` (também do Plano 3) vai com `comercial`: as telas que o usam leem o resto do recorte (`bling_lojas`, metas) do domínio 5.5 |
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

**Inventário feito em 12/10/2026: `docs/migracao-go/INVENTARIO-DO-COLETOR.md`** (robô × quem roda × tabelas × RPC/edge/Storage × caminho na virada). Em resumo:
- 24 robôs vivos rodam na VPS (`coletor/vps/robos.cron`) + o serviço `cartoes-ean`: 18 vão por `pg` direto, 6 são híbridos (tabelas por `pg`, Bling/Meta por `/bling-proxy` e `/meta-proxy`, que já existem);
- no GitHub Actions sobram Fábrica, Conteúdo e `status-projetos`: o runner não alcança o `api-db` (sem porta publicada), então ou vão pela API (pedem os itens abaixo) ou mudam para a VPS;
- mais de 100 scripts avulsos (`aplicar-*`, `provar-*`, `insere-*`, cargas já usadas) aposentam;
- nenhum robô saiu pelo Plano 4 (ele só adaptou a cópia do banco).

**O que falta na API para os robôs (pedido às trilhas em `COORDENACAO.md`):** (1) **emissor de sessão `tipo='servico'`** — hoje só `/auth/entrar` e o link de senha criam sessão, sempre `painel`, e a regra "conta de serviço nunca é limitada a loja" só vale para `servico` (dono: A, 5.0/5.1); (2) rotas `fabrica_*` + `fabrica-trigger` (5.8); (3) rotas `conteudo_*` + `conteudo-trigger` (5.9); (4) RPC `gt_registrar_problemas` (5.7; a função aceita só o claim `service_role`, que a compat não define); (5) Storage dos buckets `fabrica-criativos` e `ig-cache` (Plano 6); (6) `HOSTS_DE_MIDIA` com o host do Storage novo (Plano 3/6); (7) `allowed_accounts` no `meta-proxy` (5.6, em andamento); (8) escrita de `projetos_status` ou aposentar o robô (5.1); (9) RPC `vessel_cartao_*`/`vessel_carocos` só por `pg` (5.10, se algum dia sair da VPS); (10) despacho dos workflows (`internal/github` + `disparos_pendentes`, 5.8–5.10). Achados: os robôs importam código de `supabase/functions/_shared/` e de `src/ferramentas/` — apagar essas pastas na aposentadoria do Supabase quebra robô (lista na seção 3 do inventário); e `rodar-robo.sh`/`cartoes-ean-vigia.sh` ainda falam com o Supabase por REST.

**Decisões da orquestradora (12/10, `COORDENACAO.md`, "DECISÃO FINAL"):**
- **Conta de serviço:** cada robô é um `usuarios` + `profiles` PRÓPRIO (papel viewer, `features` só dos módulos dele, sem senha) e autentica por `tokens_de_servico` (sessão/Ator `tipo='servico'`), **sem escopos por token** — o menor privilégio vem do perfil. Entrega da trilha A no sub-plano **5.13**, PR logo depois do 5.1 (CLI `api servico criar|revogar|listar`). O `loginServico` do `coletor/` troca para `Authorization: Bearer <token de serviço>` quando o 5.13 estiver no `API-PRONTA.md`.
- **`status-projetos` aposentado** (a trilha C remove): o quadro que lia `projetos_status` saiu do Painel de Status em 19/08/2026 e ninguém mais lia o que ele gravava. Removidos o workflow `.github/workflows/status-projetos.yml`, o script e o teste; o cartão dele no Painel de Status da IA some (o nome fica só para o histórico antigo); a tabela `projetos_status` e os dados ficam (apagar dado é outra decisão). Item (8) da lista acima: resolvido por aposentadoria.

**Contas de serviço na `lib` dos robôs (5.13 mesclado, PR #364):** `coletor/lib/bling-comercial.mjs` ganhou `CENTRAL_API_URL` + `CENTRAL_API_TOKEN` (o `srv_…` de `api servico criar`). Com as duas, `loginServico({ naApi: true })` devolve o token (sem login de gente, sem `GESTOR_USER_PASSWORD`) e `blingProxy()`, `urlDaEdge(nome, token)` e `cabecalhosDaEdge(token)` levam às rotas `/bling-proxy` e `/meta-proxy` da API, sem `apikey`; só uma das duas = caminho de hoje. **Quem escolhe o caminho é o TOKEN** (`srv_` → API; JWT → Supabase), e o `srv_` só sai para o robô que pede: robô ainda não migrado, que monta a URL da edge na mão, segue no Supabase mesmo com as variáveis num `/etc/robos.env` compartilhado (achado da revisão). Usam já: os robôs do Bling pela `lib` (`gestor-comercial`, `notas-dos-pedidos`, `trazer-pedidos-do-bling`, `atualizar-cards-comercial`, `relatorios-comerciais`, `estoque-do-site`) e o `sugerir-interesses` (meta-proxy). Prova contra a API da `main` com um robô criado pelo CLI (`--modulos sales,gestor,meta`): `/auth/eu` = `tipo servico`; `bling-proxy` e `meta-proxy` respondem com o token; token falso = 401. **Na virada:** um robô por papel (ex.: `robo-comercial` com `--modulos sales,gestor`, `robo-interesses` com `--modulos meta`), o token em `/etc/robos.env` e `CENTRAL_API_URL` apontando a API na rede da VPS. **Ficam para o 5.8:** a Fábrica e os validadores/sondas da Meta (montam a URL da edge na mão e dependem das rotas `fabrica_*`); passam a usar `urlDaEdge`/`cabecalhosDaEdge` quando as rotas deles existirem.

A troca de cada robô é feita quando o caminho dele estiver pronto: os de `pg` direto na virada (Plano 8, trocando `SUPABASE_*` por `DATABASE_URL`), os de API quando o item correspondente existir.

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

**Revisão (opus, 1 rodada):** nada bloqueante; 8 menores. Corrigidos: o `429`/`conta_desativada` saiu de `classificarErro` (mudava a frase do 429 do Supabase em produção) para `erroDaApi`; 2xx que não é JSON vira erro em vez de sucesso vazio (o boot não quebra se um rewrite devolver HTML); o 401 só apaga o token se ainda for o enviado (outra aba pode ter entrado no meio); `conferir-senha` na aba de "entrar como" ganhou código e frase próprios (`entrou_como_outra_pessoa`) em vez de "confira a conexão"; a troca de senha do Supabase com mensagem vazia não vira mais "sucesso"; login e sair pela API encerram (`scope: 'local'`) a sessão do Supabase guardada no navegador, para nenhuma tela ainda no Supabase usar a de outra pessoa. **Registrados, sem correção agora:** sem rede no boot, o menu do perfil some até "Tentar de novo" (o `estado.user` só chega com `/auth/eu`; não desloga nem rebaixa); e, até o `email` chegar no `/auth/eu`, o Admin não reconhece a própria linha (`isSelf`) e oferece ações que o servidor recusa — some com o 5.12 mesclado.

**Fora da `conta`, de propósito:** "Solicitar acesso" segue no Supabase com a chave `anon` até a área `admin` (5.1).

### Área `edges-core` (Planos 3 e 4) — 12/10/2026, branch `feat/plano-7-edges-core`

**Trocado (atrás de `areaNaApi('edges-core')`):** 13 sítios de `functions.invoke` (Redes ×3, Gestão Comercial ×2, `painel-subir` ×8) por `invocarNaArea` — o ramo do Supabase segue a MESMA chamada; 8 sítios de `fetch` (Análise de Campanhas, Gestão de Tráfego ×4, Fábrica, Frota, `chamada-do-bling.js`) por `fetchDaApi`, que devolve o mesmo `Response` com o token da API e sem `apikey`.

**Decisões:** `invocar` devolve o formato do `functions.invoke`, inclusive `error.context.json()` com o corpo do não-2xx (as telas leem o motivo por ali). Os sítios que paravam em "sem sessão do Supabase" antes do `fetch` não consultam mais o Supabase com a chave ligada. `/eu/canais` foi para a área `comercial` (decisão acima, na tabela).

**Prova** (API local com `CORE_URL` num core de mentira em `127.0.0.1:58613`, `VITE_API_AREAS=conta,edges-core`, Chrome a 375 px, chamando os módulos reais da tela pelo Vite): `chamarBling` → `bling-proxy` → core (`/api/interno/bling/proxy`) → produto lido; `meta-proxy` → core (`/api/interno/meta/graph`) → `effective_status`; `insights-ao-vivo` com erro → motivo da edge em `error.context.json()`; 0 pedidos a `functions/v1`. `npm test` 6733/6733, build ok. **Tela a 375 px/desktop com dado:** não dá com só `conta`+`edges-core` — todas essas telas leem as próprias tabelas do domínio antes de chamar a edge; a medida da tela vem com a área do domínio de cada uma (5.3, 5.5, 5.6, 5.7, 5.8).

**Revisão (opus, 1 rodada):** nada bloqueante; 2 menores, corrigidos: `invocar` passou a mostrar a frase do corpo (Meta repassada, edge, núcleo) em vez de "o servidor não respondeu" quando o servidor respondeu e recusou (`fraseDoCorpo`); `metaFetch`/`metaPost` trocam o código do portão (`sem_permissao`, `nao_autenticado`) pela frase (`trocarCodigoPorFrase`).

**⚠️ Não ligar `edges-core` num ambiente com gente de verdade antes do 5.6 mesclado:** o `meta-proxy` em Go ainda NÃO confere `accountId` contra `allowed_accounts` (a edge conferia; Ruling 34, entra no 5.6). Com a chave ligada, quem tem o módulo `meta` consultaria qualquer conta. Em produção a chave está desligada; na virada, o 5.6 já estará mesclado. O envio de imagem/vídeo da Gestão de Tráfego também depende do Storage (Plano 6).

### Área `paineis` (5.12) — 12/10/2026, branch `feat/plano-7-paineis`

**Trocado (atrás de `areaNaApi('paineis')`):** Notícias (`/noticias/rodadas?limite=6` — já distinto, some o `Set`; `/noticias/concorrentes?rodada=a,b,…`; `/noticias/panorama?limite=1`), Status da IA (`/status-ia/execucoes?limite=200`, `/status-ia/saude-dos-robos`) e os custos (`POST /custo-anthropic`, `/custo-openai`; o `detalhe` do não-2xx, como `chave_admin_nao_configurada`, aparece no lugar da frase genérica). `lerDaApi` em `buscar-e-salvar-dados.js` devolve o formato do `sb` (array com `.erro`). Início e Gestão Interna: conferido, nenhum acesso direto ao Supabase.

**Prova** (API do `main` com o 5.12 e o DDL de `testebanco/paineis.go`, `VITE_API_AREAS=conta,edges-core,paineis`, Chrome a 375 e a 1440 px): e-mail do `/auth/eu` no menu do perfil; Notícias com Panorama e marcas; Status da IA com a linha do tempo; 0 pedidos dessas leituras ao Supabase; sem rolagem lateral. Com o e-mail, a faixa do "entrar como" ocupa duas linhas e o avatar fica no lugar (a sobreposição registrada na área `conta` sumiu). O custo aparece "indisponível" no ensaio porque a API local não tem a chave admin da Anthropic — é o comportamento certo.

### Pendências resolvidas — 12/10/2026, branch `feat/plano-7-pendencias`

- **`GET /eu/canais` trocado, atrás da chave `comercial`** (Análise de Vendas e Gestão à Vista): a regra `canaisDoEscopo` roda no servidor e a tela só lê `{canais}`; `canaisDaApi` (em `canais-de-venda-permitidos.js`) mantém o lado seguro da leitura antiga quando a chamada falha — limitada fica com `[]`, super-admin e não limitada com `null`, nunca "vê tudo" por falha. Fica atrás de `comercial` porque essas telas leem o resto (lojas, metas, vendedores) do domínio 5.5; ligar sozinha não abre a tela. Prova (Chrome, API local): super-admin → `null`; vendedora limitada no time da loja 203 → `[203]`.
- **Menu do perfil sem rede no boot:** a moldura passou a mostrá-lo pela SESSÃO (`estado.currentSession`), não por `estado.user`; no Supabase os dois nascem e morrem juntos, então nada muda lá. Prova: `/auth/eu` derrubado no boot → "Sem conexão" + menu presente + "Sair" leva ao login.
- **`isSelf` do Admin:** resolvido com o `email` do `/auth/eu` (PR #352).
- **Frase do 403 do `meta-proxy` na aba de "entrar como":** já coberta por `trocarCodigoPorFrase` (Análise de Campanhas, Gestão de Tráfego) e por `invocar` (`painel-subir`); a Fábrica só usa a resposta para "excluída ou não". As respostas novas do 5.6 (`conta nao encontrada`, `caminho fora da conta`) já vêm como frase.

### Área `admin` (5.1) — branch `feat/plano-7-admin`

**A peça nova: `src/compartilhado/banco-pela-api.js`.** O front fala com o PostgREST de três jeitos (encadeado do supabase-js, URL montada à mão em `sb`/`adFetch`, e o `gravar` do Admin); a API não aceita nenhum (rota por recurso, filtros nomeados, sem `select` nem operadores). Em vez de reescrever ~300 sítios à mão, a tradução mora num lugar só:
- `ROTAS`: tabela → rota, área (chave), filtros que a rota aceita e ordens declaradas — hoje as 11 tabelas do 5.1; cada sub-plano novo acrescenta as dele;
- `traduzir`/`lerPelaApi`/`escreverPelaApi`: `eq`/`ilike` (o `paraIlike` escapado vira igualdade)/`in` viram parâmetro nomeado; `select` projeta na tela; `order` vai para a rota quando ela declara (senão a tela ordena — só sem limite); `PATCH`/`DELETE` por id viram `/rota/{id}`; a autoria (`criado_por`, `concedido_por`, `alterado_por`) sai do corpo (Ruling 9 do 5.1); upserts de preferências e push viram as rotas próprias; apagar por chave natural (`equipes_permissoes`) lê as linhas e apaga por id (Ruling 14);
- **o que a rota não sabe fazer, a tradução recusa alto** (`ErroDeTraducao`: filtro não declarado, operador sem par, recurso embutido, coluna pedida que a rota não devolve, editar sem id) — ignorar em silêncio devolveria/gravaria/apagaria MAIS do que a tela pediu;
- fachadas: `deOnde(sbClient).from(t)` (o MESMO `sbClient.from(t)` quando a área está desligada) e `fetchPostgrest(caminho, opcoes)` (um `Response` com o que as telas leem: `Prefer: return=representation` devolve o array; sem ele, 201/204 vazio; erro com `message` legível).

**Trocado (atrás de `areaNaApi('admin')`):** `sb()` compartilhado, `adFetch` e `gravar` do Admin, e os `.from` de `profiles`, `equipes*`, `canais_grupos*`, `acessos_perfis`, `access_requests`, `push_*` e `data_integrity_checks` no Admin, Frota, Time de Vendas, Gestão Comercial, Conteúdo e `notificacoes-push.js`; "Solicitar acesso" do login → `POST /pedir-acesso` (público); os botões "coletar/auditar agora" da aba Saúde saem (Ruling 30).

**Corrigido de passagem (anterior à migração, visível a 375 px):** no celular, a barra de abas do Admin esticava para 232–287 px nas seções curtas (Solicitações, Contas, Dados) — o grid de uma coluna com `min-height` de tela cheia dividia a sobra com ela. `grid-template-rows: auto 1fr` no celular; medida de novo: 35 px em todas.

**Prova** (API do branch `feat/api-go-plano-5-1` em `99b081ad`, banco com a compat + migrações + a fatia de produção `01-tabelas-5-01.sql`/`02-gatilhos.sql`, Chrome a 375 e 1440 px, efeito conferido no banco): "Solicitar acesso" grava `pending`; Usuários pela API com o "VOCÊ" na própria linha; Solicitações › Aprovar grava `approved`; Saúde sem os botões órfãos; cargo trocado por quem não é super-admin por e-mail é recusado pelo gatilho de produção com a frase legível e nada gravado (paridade); e, como super por e-mail: busca por e-mail com `ilike` escapado, `PATCH` de papel, Time de Vendas (pôr, trocar papel, liberar/tirar estoque por chave natural, tirar), aba Time da Gestão Comercial (`in` + `limit`), grupos de canal pelo `gravar` (criar/renomear/apagar), preferências em lote e perfil de acesso com `criado_por` vindo da sessão.

**Revisão (opus, 1 rodada):** 2 bloqueantes, corrigidos — (1) apagar com `Prefer: return=representation` voltava `[]`, e o Admin (que CONTA o que voltou) dizia "não apagou nada" depois de apagar grupo de canal ou supervisora: agora devolve as linhas apagadas (`[{id}]`); (2) `Prefer: count=exact` era ignorado calado, e o convite (que lê o total no `Content-Range` para não aplicar perfil quando o e-mail tem mais de um cadastro) caía no tamanho do corpo: agora pede `contar=1` e responde `Content-Range: 0-0/N`. Menores corrigidos: erro mostrado como JSON cru (o `text()` de erro devolve a frase); `profiles` por `fetch` cru em Redes Sociais (lista e troca de papel) trocado; ordem com várias colunas vai para a tela (a rota aceita um campo) e `nullsfirst`/`nullslast` recusam; nulos ordenados como o PostgREST; `in` com aspas recusa; o encadeado ganhou `gte`/`lte`. Prova refeita depois: 15 verificações, inclusive o apagar do `gravar` e o `count=exact` do convite.

**Não medido com dado:** a seção Times do Admin e o Time de Vendas desenhados — eles leem `bling_lojas` (5.5) junto, e com só as áreas até `admin` ligadas essa leitura falha (cai no aviso "Não consegui carregar os times"). As escritas dessas telas foram provadas pelos mesmos ajudantes, contra a API real; a tela desenhada se mede com a área `comercial`.

### Área `meta` (5.6) — branch `feat/plano-7-meta` (o 5.6 entrou no `main` pelo PR #357, `8b8ef431`)

**Trocado (atrás de `areaNaApi('meta')`):** as 15 tabelas com rota entram no `ROTAS` do `banco-pela-api.js` — `gte`/`lte` de data viram `_de`/`_ate`, `period_days=lte` vira `period_days_ate`, `lido_em=gte.<data>` vira o instante `<data>T00:00:00Z` (Ruling 15 do 5.6), `dia=gte` vira `dia_de`, metas em lote vão para `PUT /redes/metas` e o filtro de campanhas para `PUT /redes/filtros-de-campanha/{conta}` (sem `updated_at`, que o servidor carimba). Sítios: Redes Sociais, Relatório de Redes, Análise de Campanhas e Gestão de Tráfego (o `adFetch` próprio de cada uma passa pela ponte), Relatório por Hora, OPR, Marca de Vendas, Conteúdo e Admin.

**O teto de 1000 linhas:** a tradução RECUSA `limit` acima de 1000 (cortar calado devolveria número menor sem aviso). Os pedidos de 5000 de Redes passam a pedir 1000 com a chave ligada; o aviso "bateu no teto e pode estar incompleta" passa a disparar em 1000, inclusive na série diária de anúncios (que antes não tinha aviso: ~30 campanhas por dia passam de 1000 num intervalo longo). As contagens do Admin › Dados saem do `X-Total-Count` (`contarPelaApi`), e o cartão "Ads" sai (`ads_snapshots` não tem rota nem escritor, Ruling 9 do 5.6).

**Prova** (API do branch `feat/api-go-plano-5-6` em `a4cfce71`, banco com a compat + migrações + as fatias `01-tabelas-5-01`, `01-tabelas-5-06`, `02-gatilhos`, `03-funcoes-5-06`, 41 dias de dados de duas contas, `VITE_API_AREAS=conta,edges-core,paineis,comercial,admin,meta`, Chrome a 375 e 1440 px): Redes Sociais com os seguidores do banco, Relatório de Redes, Admin › Dados contando 82 snapshots pelo `X-Total-Count` e sem o cartão "Ads", nenhum pedido das tabelas do 5.6 ao Supabase em nenhuma das 6 telas e nenhuma recusa da tradução; metas em lote gravadas e lidas, filtro de campanhas gravado, conta editada (nome/@/cor e persona); e o escopo de contas — quem só vê a Vessel recebe `[]` da outra marca e `403` ao gravar meta nela, nada gravado.

**Contra a API da `main` (`8b8ef431`):** a prova inteira refeita (10 verificações) e as respostas novas do `meta-proxy` (Ruling 34) conferidas nas duas portas do front, sem mudança de código: conta fora da lista = `400 "conta nao encontrada"`, caminho fora da conta = `403 "caminho fora da conta"`, caminho na conta = `200`; `insights-ao-vivo` de conta fora da lista = `404` com a frase em `error.message`; escrita na Meta numa aba de "entrar como" = `403` com a frase ("Quem entrou como outra pessoa só consulta.") tanto pelo `fetchDaApi`+`trocarCodigoPorFrase` quanto pelo `invocar`. O `indicador` com hífen das metas (`posts-reels`), que o 5.6 mesclado passou a aceitar, grava. Para o ensaio, a tabela `entradas_como_outro_usuario` (sem leitor no front, fora da fatia de esquema) foi criada com o DDL dos testes do 5.0.

**Revisão (opus, 1 rodada):** nada bloqueante; corrigidos — (1) **leitura sem limite vem inteira**: a ponte pede `contar=1` e busca as páginas seguintes por `deslocamento` até o `X-Total-Count` (teto de 20 páginas, acima recusa) — o Relatório de Redes (`campaign_insights` de 90 dias/"tudo") e o Relatório por Hora (14 dias × 24 h × campanhas) passavam de 1000 e cortavam calados, nos DOIS caminhos (o `max_rows` do Supabase também é 1000): pela API, deixam de cortar; (2) filtro `eq`/`in` que a rota não declara, sem limite e numa coluna que ela devolve, vira filtro na tela sobre a leitura inteira (as fotos da Marca de Vendas, `accounts` por `instagram_id`); com limite ou outro operador continua recusado; (3) a meta recusada (403 do lote) aparece num aviso, em vez de só no console; (4) ordenação na tela compara texto em português (`localeCompare`); (5) import sem uso removido.

### Área `trafego` (5.7) — branch `feat/plano-7-trafego` (o 5.7 entrou no `main` pelo PR #362, `448c1356`)

**Trocado (atrás de `areaNaApi('trafego')`):**
- as 9 tabelas com rota entram no `ROTAS` da ponte (análises, decisões, rascunhos, config de métricas, objetivos, régua, interesses); a autoria sai do corpo (`decidido_por`, `criado_por`, `updated_by`) e o `silenciar_ate` também — o servidor calcula os 7 dias (Ruling 5.7-17); objetivos e config viram `PUT` por chave; o apagar de objetivo devolve a linha alvo (o 204 vale também sem linha, e a releitura de desambiguação deixa de ser preciso);
- **decisões casadas pelo par conta + campanha** (`fila.js`, regra pura com teste): pela API as decisões vêm com `account_id`; conta ausente de um dos lados casa só pela campanha, como antes — no caminho do Supabase a leitura segue sem a coluna e o comportamento é idêntico;
- a régua vira UM `PUT /gestao-trafego/regua` (o servidor funde só as metas da conta e grava o histórico na mesma transação), no lugar do `update` + `insert` no log;
- interesses por `?account_id=` (sai o `fabrica_marcas!inner`); a RPC `gt_registrar_problemas` pelo `rpc()`; os proxies `ler-documento` e `sugerir-publico-ia` (com o `contaId` que a rota passou a exigir) pelo `fetchDaApi`, e `buscar-lugar` (Tráfego e `painel-subir`) pelo `invocarNaArea`;
- as recusas dos proxies, que vêm com CÓDIGO (`muitas_leituras`, `nao_e_pdf`, `sem_evidencia`...), aparecem como frase (`frases-dos-proxies.js`, com teste) — inclusive os códigos que a edge antiga já devolvia e a tela mostrava crus.

**O robô `vigia-problemas-meta`** (decisão das NOTAS do 5.7): com `VIGIA_DATABASE_URL` no ambiente, lê as contas e chama `gt_registrar_problemas` por `pg`, numa transação com `set_config('request.jwt.claims','{"role":"service_role"}', true)`; sem a variável, segue no REST do Supabase. Na virada: o papel de banco do robô com SELECT em `accounts` e EXECUTE na função, e a URL em `/etc/robos.env` (como o `COPIA_DATABASE_URL` da cópia do banco).

**Prova** (API da `main` em `448c1356`, banco com as fatias 5.1/5.6/5.7, Chrome a 375 e 1440 px, efeito no banco): a tela abre pela API sem nenhum pedido do 5.7 ao Supabase e sem rolagem lateral; recusa gravada com `decidido_por` da sessão e `silenciar_ate` de 7 dias calculado pelo servidor (o corpo pedia 999); conta divergente da campanha = 403, nada gravado; decisões lidas com a conta; régua funde só as metas da conta e grava o histórico; objetivo declarado e desfeito (inclusive sem linha); config por balde; rascunho criado/editado/listado com `criado_por` da sessão; interesses pela conta; proxies com frase (`ler-documento` de não-PDF, `buscar-lugar` curto, IA recusada); e a gestora que só vê a Vessel lê só as análises dela e recebe 403 ao apagar rascunho alheio, registrar problemas ou salvar a régua de outra conta. O robô, por `pg` contra o banco de ensaio com um core de mentira, leu as duas contas e FECHOU o problema aberto (lista vazia fecha o que sumiu).

**Revisão (opus, 1 rodada):** nada bloqueante; corrigidos — (1) o `import pg` do robô foi para dentro do caminho que o usa (o workflow manual roda sem `npm ci`: sem a variável, o robô é idêntico ao de antes); (2) a frase útil que a edge manda (`detalhe`/`comoResolver`: o tamanho do PDF, o "30 por hora", a causa da Anthropic) vence o mapa de frases, menos o detalhe técnico de rede; (3) a fila casa a decisão com a conta CORRIGIDA pela Meta (a gravada na análise pode ser antiga e a decisão vai com a corrigida: sem isto a sugestão continuava pendente depois de decidida) — os nomes da Meta passam a vir antes de montar a fila, só com a chave; (4) a recusa do servidor com frase própria (aba de "entrar como") aparece com a frase dele, não com o "sem permissão" genérico (a ponte devolve a frase do servidor em `details`). **Corrigido de passagem, nos dois caminhos:** a leitura das decisões de orçamento não pedia `escopo`, e uma decisão de criativos ou de saúde calava a sugestão de VERBA da mesma campanha. Provas refeitas depois: 17 verificações da tela e o robô fechando o problema por `pg`.

### Área `fabrica` (5.8) — branch `feat/plano-7-fabrica` (o 5.8 entrou no `main` pelo PR #366)

**Trocado (atrás de `areaNaApi('fabrica')`):**
- as 9 tabelas `fabrica_*` entram no `ROTAS` da ponte, com os filtros da tela traduzidos para os nomes da API (`fechada_em=is.null` → `aberta`, `purgado_em` → `purgada`/`purgado`, `params->>campanhaId` e `payload->>campanhaId` → `campanha_id`, `meta_campaign_id=not.is.null` → `com_campanha_meta`); `fabrica_marcas` é lida pela conta;
- as 4 edges (`fabrica-trigger`, `fabrica-apagar`, `fabrica-looks`, `fabrica-publicos`) pelo `invocarNaArea`, nas 6 telas; os códigos sem frase das rotas novas (`github_nao_configurado`, `dispatch_incerto`, `tipo_invalido`, `campanhaId_invalido`, `acao_invalida`) e o `detail` do `dispatch_falhou` viram frase em `fraseDoCorpo`;
- curar (um criativo e "Marcar todos") por `POST /fabrica/criativos/escolher`, um lote numa transação: um negado desfaz tudo e a tela volta ao que era;
- a home usa o `qtd_criativos` que a rota já devolve, no lugar do laço de contagens; a Gestão à Vista (`fabrica_lojas`) e a Gestão de Tráfego (`fabrica_publicos`) leem pela ponte.
- **Fica no Supabase:** `use-candidatos.js` (`fabrica-candidatos` espera as tabelas `gc_*` do 5.5).

**O robô** (`fabrica.yml`: runner, `gerar-criativos`, `gerar-previews`, `subir-`/`ativar-`/`excluir-estudio`, `registrar-execucao`): com `CENTRAL_API_URL` + `CENTRAL_API_TOKEN` (o `srv_` do `robo-fabrica`, `--modulos meta` e `meta.fabrica` em `permissions`), `coletor/lib/fabrica-banco.mjs` leva o MESMO caminho REST que os módulos já montam: leituras de `fabrica_*` pela ponte do front (uma tradução só, testada nos dois lados), escritas pelas rotas `/fabrica/robo/*` (criativos de 200 em 200; o encadeamento do `gerar` por `proximo-lote`, idempotente) e `ia_execucoes` dos 6 robôs da Fábrica por `/fabrica/robo/execucoes`; o `meta-proxy` pelo `urlDaEdge`/`cabecalhosDaEdge`. Escrita sem rota (criar rodada fora do painel, trocar o `job_id`) **recusa alto**. Quem decide é o caminho: Storage dos criativos (Plano 6) e `gc_*` (5.5) seguem na REST do Supabase. Sem as variáveis, o robô é o de hoje. Fora do `fabrica.yml`, `subir-campanha-meta.mjs` (lançamento manual de julho) segue no Supabase. **Na virada:** `api servico criar robo-fabrica … --modulos meta`, `permissions = {"meta.fabrica": [...]}` e, no `fabrica.yml`, `CENTRAL_API_URL` + `CENTRAL_API_TOKEN: ${{ secrets.API_TOKEN_FABRICA }}`.

**Prova** (API da `main` com a fatia 5.8, Chrome a 375 e 1440 px, efeito no banco): home, rodada (curar), looks e nova rodada abrem sem nenhum pedido ao Supabase e sem erro da ponte; curar um e "Marcar todos" gravam; o disparo sem GitHub configurado mostra a frase; look desativado e reativado; rodada apagada pelo diálogo; quem não tem `meta.fabrica` recebe 403 e nada grava (a regra é a da produção: basta a CHAVE existir em `permissions`, mesmo com lista vazia). O robô, com o token do `robo-fabrica`, rodou um job `ativar` inteiro (job `concluido`, `ia_execucoes` gravada, Graph pelo core de mentira) e, em chamada direta: 205 criativos em dois lotes, status e fechamento da rodada, `preview_url` do look, meta-job, próximo lote idempotente e as duas recusas.

**Revisão (opus, 1 rodada):** um bloqueante para a virada do robô, corrigido — (1) o `subir` lia os escolhidos com `formato=neq.1920x1080`, que a rota não filtra: pela API todo `subir` daria erro (a prova rodou um `ativar`); o corte do 16:9 passou para o código, igual nos dois caminhos, e TODAS as leituras de `fabrica_*` dos módulos ligados foram passadas pela tradução. Corrigidos também: (2) contar com `head: true` baixava a tabela inteira (a home a cada 4 s); a fachada `deOnde` pede uma linha e lê o `X-Total-Count` — vale para toda tela; (3) `erro` acima de 2000 caracteres (o `subir` de várias lojas) era 400 e perdia junto o `resultado` com os ids da Meta: cortado no robô, como o `detalhe` de `ia_execucoes` (500) e o `erro` do meta-job; (4) look sem linha: o PATCH do PostgREST seguia, a rota dá 404 — o robô segue também; (5) "Marcar todos" acima de 500 criativos (teto da rota) vai em lotes; (6) a frase de `campanhaId_invalido` (código com maiúscula) não aparecia; (7) `CENTRAL_API_URL` aparado. Provas refeitas: 602 criativos marcados num clique, a contagem da home em `limite=1`, e o robô com erro de 5000 caracteres gravando o `resultado`.

### Notas para áreas ainda não trocadas

- **`conteudo` (5.9), pedido da trilha B (13/10):** ao trocar a área, (1) o bloco sem apelido passa a ser recusado pela API — a tela mostra a frase e torna o campo **obrigatório** no formulário; (2) o botão "Portal de Notícias" recebe `403` de quem não tem papel admin (`PATCH /redes/contas/{id}`, achado 8 do 5.6: hoje "salvava" sem gravar) — a tela mostra a frase em vez de fingir que salvou.

### Pendências de API

| Item | Dono | Situação |
|---|---|---|
| `email` e `nome` em `GET /auth/eu` | A (5.0, no PR do 5.12) | entregue (PR #352, Ruling 37) |
| rotas `fabrica_*`, `fabrica-trigger` e rotas do robô | B (5.8) | entregue (PR #366); falta `fabrica-candidatos` (espera o 5.5) |
