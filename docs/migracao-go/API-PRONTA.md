# API pronta: o que a trilha C já pode trocar

**Para que serve.** Registro, rota por rota, do que a API em Go já tem montado em `api/internal/web/rotas.go` (`web.Rotas`) e do que cada rota substitui no Supabase (edge, RPC ou tabela). É a lista de "o que já pode trocar" do front (`src/`).

**Quem atualiza.** A trilha de backend que mescla um sub-plano acrescenta as linhas dele NESTE arquivo, no MESMO PR, e atualiza a seção "Ainda NÃO pronto". Rota que não está aqui não existe para o front, mesmo que o plano-mãe a cite.

**Regra da trilha C.** Lê este arquivo do `origin/main` e só troca o que está listado. Se o texto divergir do código, vale `rotas.go`: abra a correção aqui, não improvise no front.

**Estado:** Planos 1 a 4, 5.0 e 5.12 (este PR). 32 rotas montadas: Conta 10, RPC 1, Edges do Core e webhooks 11, Worker 1, Painéis pequenos 7, Outras 2.

## Convenções que valem para todas as rotas

- **Base e sessão.** As rotas Go não têm prefixo; o nginx as serve em `/api/...` na mesma origem do front (sem CORS). Toda rota, salvo as marcadas "sem sessão", exige `Authorization: Bearer <token>` com o token de `POST /auth/entrar`. **O JWT do Supabase não vale**: trocar qualquer rota exige antes o login pela API. A sessão dura 12 h, renovada ao uso (no máximo a cada 5 min), sem refresh token; a de "entrar como" dura 1 h e não renova. Sessão de cliente da Vessel recebe 403 em tudo.
- **Erro.** Rotas novas e de domínio: `{"error": "<codigo>", "mensagem"?: "<frase para a pessoa>"}`. As rotas portadas de edge MANTÊM o corpo de erro da edge (cada linha abaixo diz qual); só 401/403 de sessão e de portão de módulo usam o formato novo.

| Status | `error` | Quando |
|---|---|---|
| 400 | `pedido_invalido` (a `mensagem` diz o quê), `parametro_invalido` (query string malformada), `corpo_invalido`, `regra_de_negocio` (frase do `raise exception` nosso), `senha_invalida`, `token_invalido` | entrada errada; parâmetro desconhecido, repetido ou com valor inválido |
| 401 | `nao_autenticado`, `credenciais_invalidas` | sem token, token inválido ou vencido, conta desativada com sessão antiga; login errado |
| 403 | `sem_permissao` (com `mensagem` quando vem de regra nossa), `conta_desativada` | portão (módulo, papel, permissão, regra da função); login de conta desativada com a senha certa |
| 404 | `nao_encontrado` | linha inexistente OU invisível (iguais); RPC não registrada. Rota que não existe: o chi responde 404 em TEXTO, não JSON |
| 405 | (sem corpo JSON) | método errado; o chi manda `Allow`. Os 5 webhooks, `custo-*` e as rotas só-POST |
| 409 | `conflito` | 23505/23503, texto fixo, sem valor |
| 413 | `corpo_grande_demais` | corpo acima de 1 MiB (domínio e RPC) ou de 64 KB (`bling-proxy`, `meta-proxy` e coletores ao vivo, com a frase da edge); as rotas de conta e `custo-*` leem no máximo 4 KB e tratam o excesso como 400 |
| 429 | `muitas_tentativas` (login e links de senha), `muitas_requisicoes` (webhooks, com `Retry-After`) | limite de taxa |
| 499 / 500 / 504 | `requisicao_cancelada` / `erro_interno` / `prazo_esgotado` | cliente desistiu / defeito / prazo da rota (domínio 30 s) |

- **Leitura de domínio** (`dados.Consulta`): `GET` → `200` com array JSON no formato do PostgREST (datas `2026-10-11T12:00:00+00:00`, `numeric` como número, `null`, colunas na ordem da consulta). Sem permissão = `200 []`, nunca 403. Parâmetros reservados:
  - `limite` 1 a 1000 (padrão 1000, o `max_rows` do Supabase) e `deslocamento` 0 a 2147483647 (só dígitos);
  - `contar=1` acrescenta o cabeçalho `X-Total-Count` (total sem paginação; qualquer outro valor é 400);
  - `ordem=<campo>[.asc|.desc]` só com os campos que a rota declara (a ordem padrão é fixa e tem desempate);
  - **NÃO existe `select`** (as colunas e o recurso embutido são fixos por rota) **nem operadores do PostgREST** (`eq.`, `in.`, `gte.`...): o filtro por coluna é um parâmetro NOMEADO e declarado por rota (`?rodada=...`); parâmetro fora da lista, repetido ou inválido = 400. Cada linha abaixo diz quais filtros e ordens a rota aceita.
- **Escrita (`POST/PATCH/DELETE /<dominio>/<recurso>`) e `GET /<dominio>/<recurso>/{id}`:** o contrato existe (II.2 do plano-mãe), mas NENHUMA rota montada hoje o usa. Chegam com o 5.1 em diante.
- **Tela mostra `mensagem`**, não o `error` (o `error` é o código).

## Conta e autenticação (5.0)

As 3 primeiras linhas são do Plano 1 (PR #333) e as demais do 5.0 (PR #349). Os dois RPC `marcar_senha_trocada` e `minha_conta_esta_desativada` NÃO entram em `/rpc`: viraram o comportamento de `trocar-senha` e do login.

| Método e caminho | Substitui (Supabase) | Quem pode | Desvios do II.2 / observações | Commit |
|---|---|---|---|---|
| `POST /auth/entrar` | `sbClient.auth.signInWithPassword({email, password})` (`tela-de-login.vue:111`) | sem sessão; limite por IP e por e-mail | corpo `{email, senha}` (campo `senha`, não `password`) → `{token}` (sem refresh). `401 credenciais_invalidas`; `400 pedido_invalido`; `429 muitas_tentativas`; `403 conta_desativada` SÓ com a senha certa (substitui a RPC `minha_conta_esta_desativada`, `controle-de-login-e-usuario.js:65`) | PR #333 `b801a327`; 403 desde PR #349 `b400c65c` |
| `POST /auth/sair` | `sbClient.auth.signOut()` (`moldura-do-aplicativo.vue:262,295,307`) | sessão | `204`. Revoga só o token enviado (como `signOut({scope:'local'})`; o padrão do Supabase era global) | PR #333 `b801a327` |
| `GET /auth/eu` | sem equivalente direto (`sbClient.auth.getUser()`, `tela-de-gestao-trafego.vue:4927`) | sessão | `{id, tipo, papel, superadmin, permissoes, impersonador_id, email, nome}` (`permissoes` = mapa recurso → ações; `impersonador_id` não nulo = sessão "entrar como"; `email` e `nome` são de quem a sessão É — o alvo, no "entrar como"; `nome` = `profiles.name`, `null` sem perfil — Ruling 37 do plano-mãe, pedido da trilha C). O perfil completo é `GET /eu/perfil` | PR #333 `b801a327` |
| `POST /auth/esqueci-senha` | `sbClient.auth.resetPasswordForEmail(email, {redirectTo})` (`tela-de-login.vue:194`) | sem sessão; 20/IP e 5/e-mail a cada 15 min | corpo `{email}`. SEMPRE `202 {"ok":true}` (sem enumeração); o e-mail sai por ZeptoMail fora da requisição. O destino do link é o `Origin` do pedido se estiver em `ENDERECOS_DO_APP`, senão o padrão; `redirectTo` não existe. Link: `<origem>/#type=recovery&token=<token>` (1 h, uso único) | PR #349 `b980f815` |
| `POST /auth/definir-senha` | `sbClient.auth.updateUser({password})` no fluxo de convite/recuperação (`tela-de-login.vue:154`) + leitura do `#access_token` do hash | sem sessão; o balde de 20/IP é o MESMO do `esqueci-senha` | corpo `{token, senha}` → `{token}` de sessão (já entra logada). O front lê `type` e `token` do hash (`#type=invite\|recovery&token=...`), limpa o hash com `history.replaceState` antes de qualquer outra chamada e chama aqui. `400 token_invalido` (usado, vencido ou conta desativada), `400 senha_invalida`. Derruba as outras sessões da pessoa | PR #349 `b980f815` |
| `POST /auth/trocar-senha` | `sbClient.auth.updateUser({password})` (`moldura-do-aplicativo.vue:237` e `:344`) + RPC `marcar_senha_trocada` (`:247`) | sessão (não impersonada) | corpo `{senha}` → `204`; já tira `precisa_trocar_senha` (não chamar mais a RPC). Senha de 6 CARACTERES a 72 BYTES. Não pede a senha atual (paridade com o `updateUser`). Derruba as OUTRAS sessões. Sessão "entrar como" = `403 sem_permissao` + `mensagem` | PR #349 `b980f815` |
| `GET /eu/perfil` | `GET rest/v1/profiles?id=eq.<eu>&select=role,features,avatar_url,permissions,allowed_accounts,is_superadmin,precisa_trocar_senha,escopo_por_equipe` (`controle-de-login-e-usuario.js:92`, `carregarPerfil`) | sessão | array de UMA linha com exatamente essas 8 colunas (`[]` se não há perfil). Conta desativada não chega aqui: o login dá 403 e a sessão antiga dá 401, o que substitui a RPC `minha_conta_esta_desativada` | PR #349 `b980f815` |
| `POST /invite-user` | edge `invite-user` (`tela-de-admin.vue:724,3110,3527,3869`, `tela-de-frota.vue:756`, `tela-de-redes-sociais.vue:3769`) | sessão com papel `admin` (checado dentro); `resetPasswordUserId` só super-admin pela ficha | corpo e respostas da edge: convidar (`{email, name, role, password?}`), excluir (`{deleteUserId}`), trocar senha de outra pessoa (`{resetPasswordUserId, password}`); sucesso `{"success":true}`, recusa de regra `400 {"error": "<frase>"}` (a `error` é a frase). Sem `password` (ou com menos de 6 caracteres) manda o e-mail por ZeptoMail: convite de 24 h, ou link de troca de 1 h se a conta já existe e já tem senha; `redirectTo` é ignorado. Sessão "entrar como" = `403 sem_permissao` + `mensagem`. Qualquer admin exclui qualquer conta, como na edge (Ruling 21, achado para o dono) | PR #349 `b980f815` |
| `POST /entrar-como-usuario` | edge `entrar-como-usuario` (`tela-de-admin.vue:3412`) | super-admin pela ficha, sessão de painel (checado dentro, ANTES de olhar o alvo) | corpo `{alvoId}`. **Resposta muda: `{token, expira_em}`** (a edge dava `access_token`/`refresh_token`/`expires_in`). O token é uma sessão da API: vale 1 h e não renova; o "link de sessão" `#access_token=...&refresh_token=...` que a tela monta (`:3418`) deixa de existir como está. Recusas `400 {"error": "<frase>"}` como na edge; sessão já impersonada = `403 sem_permissao` | PR #349 `b980f815` |
| `POST /conferir-senha` | edge `conferir-senha` (`tela-de-frota.vue:2129`, `tela-de-autenticidade.vue:4492`) | sessão (a pessoa é a da sessão, nunca do corpo) | corpo `{senha}`. `200 {ok:true}` ou `200 {ok:false, erro:"senha_incorreta", restam}`; `400 {ok:false, erro:"sem_senha"}`; `429 {ok:false, erro:"bloqueado", bloqueado_ate}` (5 erros = 10 min). **Desvio:** sem sessão = `401 {"error":"nao_autenticado"}` (a edge dava `{ok:false, erro:"sem_sessao"}`). Sessão "entrar como" = `403 sem_permissao` | PR #349 `b980f815` |

## RPC com lista branca (5.0)

| Método e caminho | Substitui (Supabase) | Quem pode | Desvios do II.2 / observações | Commit |
|---|---|---|---|---|
| `POST /rpc/{nome}` | `sbClient.rpc('<nome>', args)` e `rest/v1/rpc/<nome>` (92 nomes que o painel chama) | sessão de painel + o portão em Go de CADA função (a regra da checagem interna dela) | corpo = o MESMO objeto de `.rpc(nome, args)` (nomes `p_*`). `200` com o resultado (`to_json`: escalar, objeto ou `null`) ou array (`setof`), `204` (`void`). `404 nao_encontrado` para nome não registrado (vem ANTES do portão); `400 pedido_invalido` para parâmetro faltando, desconhecido ou de forma errada; `403 sem_permissao`. Prazo de 30 s | PR #349 `b980f815` |

**HOJE NENHUMA função está registrada** (`web.FuncoesRPC` vazia): todo `POST /rpc/{nome}` dá 404. **A trilha C não troca nenhum `.rpc(...)` ainda.** Cada sub-plano acrescenta as funções do seu domínio e esta seção passa a listá-las, com parâmetros e portão. Pendentes por sub-plano (fonte: `web.RPCPendentes` em `api/internal/web/rpc_lista.go`): 5.2 = 5, 5.3 = 2, 5.7 = 1, 5.9 = 6, 5.10 = 16, 5.11 = 62 (total 92). Há ainda 15 nomes que nunca viram `/rpc` (`web.RPCForaDoPainel`; os 3 de página pública são do Plano 6).

## Edges do Core e webhooks (Plano 3)

Todas mantêm o nome da edge (`functions.invoke('x', {body})` vira `POST /x` com o mesmo corpo). Quando o front chama por `fetch` direto, o cabeçalho `apikey` e o JWT do Supabase saem. Portão de módulo: `profiles.features` contém o módulo, ou papel `admin`, ou super-admin. Todas no PR #340, commit de montagem `6490ee00`.

| Método e caminho | Substitui (Supabase) | Quem pode | Desvios do II.2 / observações | Commit |
|---|---|---|---|---|
| `POST /bling-proxy` | edge `bling-proxy` (`src/compartilhado/chamada-do-bling.js:117`; `tela-de-gestao-comercial.vue:186,189` por `functions.invoke`) | sessão; dentro do handler: módulo `sales` ou `gestor` (todos os caminhos permitidos) ou `autenticidade` (só `produtos` e `produtos/{id}`). Pessoa limitada a lojas recebe o recorte por canal | corpo `{endpoint, params}`, resposta e status do Bling repassados, com `Retry-After` e `X-Core-Origem`. Erro desta API: `{"error": "<frase sem acento>"}` (`endpoint required`, `endpoint nao permitido`, `sem permissao`, `sem permissao para este canal`, `core nao configurado` 503, `falha ao falar com o core` 502). 504 se o core não responde. Só GET no Bling. Prazo 90 s | PR #340 `6490ee00` |
| `POST /meta-proxy` | edge `meta-proxy` (`tela-de-analise-campanhas.vue:127`, `tela-de-gestao-trafego.vue:373,399,5433,5466`, `tela-de-fabrica-home.vue:77`, `painel-subir.vue:51,140,184,193,317,337,344,357`) | sessão + módulo `meta` | corpo da edge `{accountId, path, params, method, imageFromUrl, imageField, videoFromUrl}`; a Graph volta tal qual (inclusive `{error:{...}}` da Meta). Erro desta API: `{"error": "<frase>"}`. 401/403 do core NUNCA saem como 401/403. Mídia só dos hosts de `HOSTS_DE_MIDIA`. Prazo 25 s (45 s imagem, 75 s vídeo). **Ainda NÃO confere `accountId` contra `allowed_accounts`** (entra no 5.6, Ruling 34) | PR #340 `6490ee00` |
| `POST /insights-ao-vivo` | edge `insights-ao-vivo` (`tela-de-redes-sociais.vue:1273`) | sessão + módulo `social` | corpo e resposta da edge. Erro no formato da edge: `{"meta_erro": "<frase>"}` (404 conta não encontrada, 503 `core nao configurado`, 500 `erro interno`); `meta_erro: "meta_incompleto"` dentro do 200. Prazo 90 s | PR #340 `6490ee00` |
| `POST /serie-novos-dia` | edge `serie-novos-dia` (`tela-de-redes-sociais.vue:1334`) | sessão + módulo `social` | corpo `{account_id, dias}`, resposta `{serie}`. Erro no formato da edge: `{"erro": "<frase>"}`. Prazo 90 s | PR #340 `6490ee00` |
| `POST /contar-collabs` | edge `contar-collabs` (`tela-de-redes-sociais.vue:1288`) | sessão + módulo `social` | corpo `{account_id, since, until}`, resposta `{posts, reels}`. Erro `{"erro": "<frase>"}`. Prazo 120 s (o maior; o nginx tem de ficar acima) | PR #340 `6490ee00` |
| `GET /eu/canais` | a regra `canaisDoEscopo` (`src/compartilhado/canais-de-venda-permitidos.js`) e as leituras que a alimentam só para isso: `.from('equipes')`, `.from('equipes_membros')`, `.from('canais_grupos_membros')` (`tela-de-analise-vendas.vue:403-409`, `tela-de-gestao-a-vista.vue:690-697`) | sessão | `{"canais": null}` = vê todos; `{"canais": [ids]}` = só esses; `[]` = nenhum (null e [] NÃO são iguais). Sem perfil = `[]`. A frase do recorte (`fraseDoRecorte`) e o mapa de nomes (`bling_lojas`) continuam no front. Conta de serviço nunca é limitada | PR #340 `b7ac0764` (handler), `6490ee00` (montagem) |
| `POST /receber-webhook-pedido-shopify` | edge `receber-webhook-pedido-shopify` | **sem sessão**; HMAC `X-Shopify-Hmac-Sha256` com um dos `SHOPIFY_WEBHOOK_SEGREDOS`; 600 req/min por IP | quem chama é o core (fan-out), não o front: **nada a trocar no front.** `401 nao_autorizado`, `429 muitas_requisicoes`, `413` (5 MB); repetição barrada por `X-Shopify-Event-Id` (`200 {ok:true, duplicado:true}`) | PR #340 `6490ee00` |
| `POST /receber-webhook-checkout` | edge `receber-webhook-checkout` | idem | idem | PR #340 `6490ee00` |
| `POST /receber-webhook-abandono` | edge `receber-webhook-abandono` | idem | idem. O "disparo imediato" não foi portado (a tarefa de 1 min cobre) | PR #340 `6490ee00` |
| `POST /receber-webhook-chatwoot` | edge `receber-webhook-chatwoot` | **sem sessão**; segredo `?token=` (`CHATWOOT_WEBHOOK_SEGREDO`); 600 req/min por IP | quem chama é o Chatwoot: **nada a trocar no front.** `401 nao_autorizado`, `400 payload_incompleto`, `429 muitas_requisicoes`; erro de banco = 500 | PR #340 `6490ee00` |
| `POST /receber-opt-out-chatwoot` | edge `receber-opt-out-chatwoot` | idem | idem | PR #340 `6490ee00` |

## Worker e robôs (Plano 4)

O worker (`api worker`, serviço separado) roda 20 tarefas que saem do pg_cron e das edges de cron do Supabase: coletores Meta, push de vendas/saldo/frota, mensagens de abandono, relatório da hora, conteúdo (hora H e espelho), purga da fábrica, auditoria e robôs de manutenção. **O front não tem nada a trocar por causa dele**: nenhuma tela chama essas tarefas e não existe rota HTTP que dispare tarefa (execução manual só por linha de comando no servidor). Uma ressalva: os botões "coletar/auditar agora" da aba Saúde do admin (`tela-de-admin.vue:1765-1769`, `post('coletar-dados')` e `post('auditar-dados')`) NÃO têm rota na API (Ruling 30 do Plano 5): a trilha C remove os botões junto com o 5.1, não os aponta para a API. O que o worker grava (`robos_execucoes`) continua sendo lido pela tela de status, via a rota `/status-ia/saude-dos-robos` do 5.12 (abaixo). O único pedaço do Plano 4 que é rota:

| Método e caminho | Substitui (Supabase) | Quem pode | Desvios do II.2 / observações | Commit |
|---|---|---|---|---|
| `POST /avisar-decisao-de-reserva` | edge `avisar-decisao-de-reserva` (`tela-de-frota.vue:2523`) | sessão + super-admin OU `permissions['frota.aprovar']` com `ver` (o portão da edge). `403 sem_permissao` | corpo `{requisicaoId}`. Respostas no formato da edge: `{ok:true, enviados, ...}`; `{ok:true, enviados:0, motivo}`; `400 {ok:false, erro:"sem_requisicao"}`; `404 {ok:false, erro:"requisicao_nao_encontrada"}`; `500 {ok:false, erro:"erro_interno"}`. Push com livro anti-repetição (o mesmo par requisição+situação não reenvia). Exige as `VAPID_*` na API | PR #347 `a6a3251f` |

## Painéis pequenos (5.12)

Leituras de domínio com a regra de Ler do catálogo de produção (`api/internal/autz/catalogo-policies-producao.json`): sem permissão = `200 []`. Nenhuma tem `ordem` (a ordem é fixa; `?ordem=` dá 400) nem `select`. Todas aceitam `limite`, `deslocamento` e `contar=1`, salvo `saude-dos-robos` (nenhum parâmetro). Prazo de domínio 30 s.

| Método e caminho | Substitui (Supabase) | Quem pode | Desvios do II.2 / observações | Commit |
|---|---|---|---|---|
| `GET /noticias/rodadas` | `.from('noticias_concorrentes').select('rodada').order('rodada', desc).limit(1200)` + `Set`/`slice(0,6)` (`tela-de-noticias.vue:108-109`) | qualquer sessão (policy `noticias_select_authenticated` = `true`) | usar `?limite=6`: já vem DISTINTO e do mais novo ao mais antigo, `[{"rodada":"2026-10-05"}, ...]`; some o `Set` no JS. Sem filtros | PR do 5.12 (este) `55fd3729` |
| `GET /noticias/concorrentes` | `.from('noticias_concorrentes').select('*').order(rodada, destaque, created_at desc).in('rodada', recentes)` (`tela-de-noticias.vue:110-112`) | qualquer sessão (idem) | todas as colunas. Filtro `?rodada=<AAAA-MM-DD>[,<AAAA-MM-DD>...]` (lista por vírgula, até 1000; sem o filtro, vêm todas, até `limite`). Ordem fixa: `rodada desc, destaque desc, created_at desc, id`. Sem `.in(...)` | PR do 5.12 (este) `55fd3729` |
| `GET /noticias/panorama` | `.from('noticias_panorama').select('rodada,conteudo_md,modelo,created_at').order('rodada', desc).limit(1)` (`tela-de-noticias.vue:119-120`) | qualquer SESSÃO (policy `noticias_panorama_read` = `true`; a leitura anônima da policy `_read_anon` NÃO é replicada) | só essas 4 colunas, `rodada desc`; usar `?limite=1` | PR do 5.12 (este) `55fd3729` |
| `GET /status-ia/execucoes` | `sb('ia_execucoes?select=*&order=run_at.desc&limit=200')` (`tela-de-status-claude.vue:703`) | qualquer sessão (policy `ia_exec_select` = `true`) | todas as colunas, `run_at desc, id`; usar `?limite=200` | PR do 5.12 (este) `55fd3729` |
| `GET /status-ia/saude-dos-robos` | `sb('robos_saude?select=*')` (visão `robos_saude`, `tela-de-status-claude.vue:707`) | quem a regra de Ler de `robos_esperados` E `robos_execucoes` libera: papel `admin`, super-admin pela ficha ou `claude.status` em `profiles.features` (policies `robos_esperados_leitura` e `robos_execucoes_leitura`) | `200 []` para quem não passa (mudança intencional: quem tem `claude.status` só em `permissions` abre a tela mas recebe `[]`). Aceita NENHUM parâmetro (`400 pedido_invalido`); sempre até 1000 linhas, `critico desc, robo`. Mesmo corpo da visão | PR do 5.12 (este) `ab318975` |
| `POST /custo-anthropic` | edge `custo-anthropic` (`sbClient.functions.invoke(funcao, {body:{dias}})`, `tela-de-status-claude.vue:449`; chamadas em `:469,485,502,517`) | sessão de painel com `profiles.role = 'admin'` (super-admin pela ficha e `claude.status` NÃO abrem), checado antes de ler o corpo | corpo `{dias}` (número; padrão 30, ajustado a 1..90; `"30"` em texto = `400 pedido_invalido`). Resposta `{desde, ate, cambio, totalUsd, totalBrl, dias:[{data,usd}], porCategoria:[{item,usd}], porChave:[{nome,tokensIn,tokensOut,usdEstimado}]}`. **Não-2xx agora tem corpo:** `403 {"error":"sem_permissao"}`, `500 {"error":"falha","detalhe":"<frase>"}` (`chave_admin_nao_configurada` se a variável falta). Só `POST` (outro método = 405 com `Allow: POST`). Prazo 90 s | PR do 5.12 (este) `107b928b` |
| `POST /custo-openai` | edge `custo-openai` (a mesma chamada por variável, `tela-de-status-claude.vue:449`) | idem | idem; `porChave:[{nome,usd}]` (custo real por chave) | PR do 5.12 (este) `107b928b` |

## Outras

Sem equivalente no Supabase e sem troca no front; servem à operação (health check do contêiner e do nginx).

| Método e caminho | Substitui (Supabase) | Quem pode | Desvios do II.2 / observações | Commit |
|---|---|---|---|---|
| `GET /saude` | nada | sem sessão | `200 ok` (texto) | PR #333 `514ab223` |
| `GET /pronto` | nada | sem sessão | `200 ok` (texto) se o banco responde, `503` (texto) senão | PR #333 `514ab223` |

## Ainda NÃO pronto

5.1 (admin, equipes e acesso; entra no PR dele), 5.2 a 5.11 (um sub-plano cada, incluindo as 92 RPC pendentes) e Plano 6 (Storage, páginas públicas da Vessel, Zoho/Microsoft); consulte o plano-mãe `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md`, seção IV.2, para o dono de cada área e as telas a trocar.
