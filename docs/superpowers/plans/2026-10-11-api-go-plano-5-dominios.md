# Sair do Supabase — Plano 5: Domínios (arquivo-mestre: inventário, arquitetura, Plano 5.0 e sub-planos 5.1–5.12)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Execute na worktree `api-go-dominios`** (branch `feat/api-go-dominios`, empilhada sobre `feat/api-go-worker` = Plano 4, ainda em revisão final; Planos 1–3 já na `main`); nunca na `main`. Faça `git add` só dos caminhos de cada task. **Só o Plano 5.0 (Tasks 1–10) é executável neste arquivo**; os sub-planos 5.1–5.12 (seção IV) são escritos depois, cada um no seu arquivo, no mesmo formato.

**Goal:** Tirar do navegador o acesso direto ao Supabase (PostgREST `.from`, `.rpc`, RLS) trocando-o por rotas da API em Go que decidem a permissão em código com as MESMAS regras das 276 policies de produção — começando pela fundação (Plano 5.0: contrato HTTP, autorização compilada do catálogo e provada contra a própria RLS, lista branca de RPC e o módulo de conta: convite, troca de senha, "entrar como", conferir-senha).

**Architecture:** Endpoints por domínio com SQL explícito (decisão (a), Ruling 1). As 276 policies do catálogo de produção são compiladas em predicados Go (`internal/autz`), que viram condições SQL com parâmetros nomeados (`Filtro`) aplicadas por uma rota de leitura declarativa (`dados.Consulta`) e por conferências de escrita (`PodeCriar/PodeEditar/PodeApagar`) dentro de `banco.ComUsuario`. As funções SQL que o front chamava por `.rpc` continuam no banco e passam por uma lista branca (`POST /rpc/{nome}`) com portão em Go. O teste de contrato monta um banco com a RLS LIGADA, as policies verbatim e as funções de produção verbatim, e compara a decisão do Go com a do Postgres para cada pessoa × tabela × operação × linha.

**Tech Stack:** Go 1.26 (`go.mod`; toolchain local 1.27), `chi`, `pgx` v5, `goose`, Postgres 17 (testes em contêiner), `net/http/httptest` (ZeptoMail de mentira), Node 22 (só o extrator `extrair-ajudantes.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` (§1 decisões, §4 autenticação e sessões, §5 autorização `Pode()`/catálogo/testes de contrato, §6 funções do banco, §9 workstreams 3, 4 e 7, §11 segurança, §13 testes) e `docs/migracao-go/RESULTADO-DO-LEVANTAMENTO.md` (276 policies, 308 funções, 63 gatilhos, 26 usuários, 5 desativados). A especificação das permissões é `docs/migracao-go/catalogo-policies-producao.json`.

## Global Constraints

- **Nada em produção é tocado por este plano.** Sem `ssh`, sem credencial real, sem `push`. Testes usam Postgres local descartável e `httptest`; segredos nos testes são textos inventados.
- **Mesmas permissões de hoje (spec §1, §5):** a regra de cada tabela é a do catálogo de produção, compilada, nunca reescrita à mão; a regra de cada RPC é a checagem que a própria função faz por dentro. Divergência de comportamento só por Ruling explícito.
- **Negar por padrão:** tabela fora do catálogo, forma de policy desconhecida, escopo ausente, alias inválido ou nome de RPC não registrado = nega (erro, `false`, 403 ou 404). Uma forma nova no catálogo FALHA a compilação (a API não sobe) em vez de liberar.
- **Testes matam mutações de segurança:** todo portão tem caso positivo E negativo assertado (status e efeito: nada gravado, nenhuma sessão criada); IDOR (linha de outra conta/loja/equipe) assertado como `[]`/404; o teste de contrato exige que cada tabela×operação mostre os dois lados (permitido e negado) no mundo do teste.
- **Segredos (`ZEPTOMAIL_TOKEN`, tokens de sessão e de link de senha) nunca em log, erro ou resposta;** o token de link só existe em claro no e-mail; o banco guarda o hash (SHA-256).
- **SQL:** todo parâmetro com cast explícito (`$1::uuid`, `@x::text[]`); o texto do pedido nunca entra no SQL (só valores em parâmetros; ordem e filtros por lista branca; nomes de RPC e parâmetros validados por expressão regular e citados com `pgx.Identifier`).
- **Toda escrita de domínio roda em `banco.ComUsuario`** (os gatilhos `guard_profiles`, `impedir_autopromocao`, `guard_user_permissions` e a trilha de edições leem `auth.uid()`; sem identidade, `guard_user_permissions` deixa passar).
- **Contrato de rota portada de edge = o da edge** (nome, corpo, status e textos), exceto 401/403 de sessão, que usam o formato do núcleo (`{"error":"nao_autenticado"}`/`{"error":"sem_permissao"}`). Rota nova de domínio usa o contrato da seção II.
- **Sem dependência nova:** biblioteca padrão e o que já está no `go.mod`. `go.mod` fica em `go 1.26.0`.
- **Gate real:** `make -C api teste PG_PORTA=58534` (CI do GitHub bloqueado por billing; 55432/55433/58432 ocupadas por outras sessões). Teste de banco que **pula** não é aprovação: rode com `-v` e confira `--- SKIP` = 0.
- Cada commit termina com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Código, comentários e mensagens em português com acentuação correta; textos copiados das edges ficam como na edge (o front compara texto).
- Comandos `go` rodam em `api/`; `git` e `node` na raiz da worktree.

## Review Focus

1. **Conta desativada com papel admin e super-admin na ficha** → não passa em NENHUMA policy que lê `profiles` por subconsulta (a RLS de `profiles` esconde o próprio perfil de quem está desativado), nem nas funções com `conta_ativa()`. Teste: pessoa `desativado` em `TestContratoDePermissaoContraARLSDeProducao` (Task 4) e `TestPodeApagarECriar` (Task 5).
2. **Id de outra conta/loja/equipe numa leitura filtrada ou numa escrita (IDOR)** → `[]` na lista e 404 na escrita (nunca 403, que confirmaria que a linha existe). Testes: `TestConsultaAplicaARegraNaPrincipalENaEmbutida` e `TestPodeEditar` (Task 5).
3. **Sessão de "entrar como" pedindo ação de conta** (trocar a senha do alvo, convidar/excluir gente, entrar como uma terceira pessoa, assinar com `conferir-senha`) → recusada sem efeito. Testes: `TestTrocarSenha` (Task 7), `TestInviteUserPortaoEContrato` (Task 8), `TestEntrarComoAuditaAntesEDaUmaHoraSemRenovar` e `TestConferirSenha` (Task 9).
4. **`Origin` forjado no "esqueci a senha"** (`https://central.exemplo.ladrao.net`) → o link do e-mail cai no endereço padrão do app, nunca no do pedido; e a resposta é idêntica para quem tem conta, quem não tem e quem está desativado. Teste: `TestEsqueciSenha` (Task 7).
5. **`profiles.permissions` fora do formato** (array em vez de objeto, valor escalar, número dentro do array) → a mesma decisão do `jsonb` (o `?` casa texto de array; `vessel_pode` exige objeto e array com texto). Testes: pessoas `permissions-lista` e `permissions-chave-nao-array` (Task 4) e `TestCarregarEscopo` (Task 2).

---
## I. Inventário e triagem (o que o front faz direto no Supabase hoje)

### I.1 Como foi contado

`grep` sobre `src/` (fora de `*.test.*` e de `src/demonstracao/`, que é o banco de mentira), em 2026-10-11, nesta worktree. Contam-se **literais no código**: uma linha com duas chamadas conta duas; um nome citado em comentário com aspas também conta (por isso as colunas "distintas" foram conferidas à mão contra a triagem das funções). As contagens da spec §2 (347/43/39) eram por grep sem separar `storage.from` nem os acessos REST "crus"; os números reais:

| Forma de acesso | Literais | Observação |
|---|---|---|
| supabase-js `.from('<tabela>')` | 294 (+~20 com nome em variável) | `storage.from` (16) excluído: é Storage, Plano 6 |
| REST cru `sb('<tabela>?…')` (`src/compartilhado/buscar-e-salvar-dados.js`) | 81 | PostgREST com filtros na URL (`eq.`, `order=`, `select=`) |
| REST cru `adFetch('<tabela>…')` (admin, análise de campanhas, GT) | 31 | idem, com `PATCH`/`POST` |
| `fetch(\`${SUPABASE_URL}/rest/v1/<tabela>\`)` | 7 | atendimentos, redes, login |
| `.rpc('<função>')` | 43 | |
| RPC por helper (`chamar('vessel_…')`, `fetch …/rest/v1/rpc/${funcao}`) | 9 `fetch` + ~150 nomes literais | comercial-vessel, beauty-sessions, autenticidade |
| `functions.invoke('<edge>')` + `fetch …/functions/v1/<edge>` | 38 + 20 | 22 edges distintas |
| `supabase.auth.*` | 30 sítios | login, moldura, getSession espalhado: Plano 7, contra as rotas do 5.0 |

Resultado: **117 tabelas distintas** lidas/gravadas pelo front (todas no catálogo de policies, salvo a visão `robos_saude`), **94 nomes de função SQL** chamados como RPC pelo painel (92 registráveis: 2 são as do Ruling 23; ver I.2) e **22 edges**.

### I.2 Triagem das 308 funções SQL de produção (`levantamento/02-funções.csv`)

Classificação automática (corpo × chamadores: policies, front, `vessel-brasil`, edges/cron/`coletor`/Go) conferida à mão:

| Categoria | Qtde | Escrevem | Usam `auth.uid()` | Destino |
|---|---|---|---|---|
| **T** gatilho (`returns trigger`) | 39 | 15 | 9 | **Ficam no banco** (integridade, trilha, imutabilidade). Os 9 com `auth.uid()` passam a ler a identidade de `banco.ComUsuario`. **3 chamam `disparar_robo` (`pg_net`)**: `vessel_lote_novo_pede_foto`, `vessel_cartao_pedido_novo_acorda_o_robo` (com `exception when others`) e `vessel_espelhar_agora` (**sem** tratamento: o insert em `vessel_lista_espera` QUEBRA depois do corte) → sub-plano 5.10 (Ruling 28) |
| **A** ajudante de policy | 19 (+6 auxiliares) | 0 | 18 | **Reescritas em Go** (`internal/autz`) e conferidas contra a original (Task 4). Ficam também no banco, porque as RPCs da categoria F as chamam por dentro |
| **F** RPC do painel | 107 (92 chamadas pelo painel; as outras 15, abaixo) | 69 | 29 | **`POST /rpc/{nome}`** (lista branca), por sub-plano. 97 já checam permissão por dentro (`vessel_pode` 63, `is_vessel_admin` 16, `pode_cadastrar_pessoa_rapida` 4, outras); 10 não checam nada (validadores puros e 2 que escrevem: `vessel_pedir_atendimento`, `vessel_rsvp_da_convidada`; nenhuma das 12 é chamada pelo painel, ver a nota abaixo da tabela) |
| **V** RPC pública da `vessel-brasil` (chave anon) | 30 | 25 | 0 | Plano 6 (rotas públicas da Vessel) |
| **W** chamadas por edge/cron/`coletor`/Go | 66 | 43 | 3 | Planos 3/4 (já portados: fila do abandono, `tomar_trava`, `conferir_robos`, `vessel_rd_*`...) e Plano 6 (`vessel_conta_*`, cartões, lembretes, transferência) |
| **I** internas (só outras funções chamam) | 42 | 5 | 4 | Ficam |
| **X** sem chamador achado | 5 | 2 | 1 | Ficam; candidatas a remoção depois do corte (`frota_traduz_situacao_para_patrimonio`, `meu_papel_na_equipe`, `vessel_adotar_etiqueta`, `vessel_registrar`, `vessel_revelar_dono`) |

Só 2 funções usam `pg_net` diretamente (`disparar_robo`, `vessel_rd_enviar`, já substituída no Plano 4) e 18 usam `extensions.*` (a camada de compatibilidade do Plano 2 cobre). Nenhuma função da categoria F depende de Supabase além de `auth.uid()`: elas rodam como estão sob `banco.ComUsuario` (Ruling 2).

**As 107 da categoria F e o que o painel de fato chama** (conferido em 2026-10-12: `grep` em `src/`, fora de testes e de `src/demonstracao/`, nos sítios `.rpc('x')`, nos ajudantes `chamar('x')`, `props.chamar('x')`, `gravar('x')` e `fetch …/rest/v1/rpc/x`, mais `db/migrations` para os `grant`/`revoke`): o front chama **94 nomes distintos** (43 sítios `.rpc('x')` com 33 nomes, o resto pelos ajudantes). Destes, **92 são registráveis** em `POST /rpc/{nome}`; os outros 2, `marcar_senha_trocada` (`src/moldura-do-aplicativo.vue:247`) e `minha_conta_esta_desativada` (`src/compartilhado/controle-de-login-e-usuario.js:65`), o Ruling 23 manda NÃO expor (o Plano 7 troca os dois sítios). Os **13 nomes do levantamento sem chamada do painel** (107 − 92 = 15 contando os 2 do Ruling 23, que o painel chama mas não se registram) NÃO são registrados:

- 3 funções de página pública (chave `anon`; `grant execute … to anon, authenticated`): `vessel_convite_da_convidada`, `vessel_rsvp_da_convidada`, `vessel_pedir_atendimento` → Plano 6 (rotas públicas da Vessel);
- 5 internas com `EXECUTE` revogado de `authenticated` (chamadas só por outras funções): `vessel_cpf_valido`, `vessel_faixa_da_nota`, `vessel_situacao_do_convite`, `vessel_numeros_do_stylist_circle`, `vessel_telefone_canonico`;
- 5 só citadas em comentário, teste ou policy, sem chamada de rede: `is_vessel_atendimentos_editar` (ajudante de policy, vira `autz.VesselAtendimentosEditar`), `meus_vinculos` (ajudante de policy, vira `Escopo.Vinculos`), `vessel_chave_do_produto`, `vessel_email_canonico`, `vessel_placar_do_stylist_circle`.

Contagem por sub-plano das 92: 5.2 = 5, 5.3 = 2, 5.5 = 0, 5.7 = 1, 5.9 = 6, 5.10 = 16, 5.11 = 62 (5.1, 5.4, 5.6, 5.8 e 5.12 = 0). `bem_de_veiculo_segue_a_frota` é gatilho do 5.2, não RPC.

### I.3 Policies do catálogo de produção (`catalogo-policies-producao.json`)

276 policies em 144 tabelas: 239 permissivas e 37 restritivas (26 `pode_ver_conta`, 6 `pode_ver_canal`, 4 `pode_ver_bem`, 1 `pode_ver_estoque`); papéis: 193 `authenticated`, 80 `public`, 2 `service_role`, 1 `anon`; comandos: 164 `select`, 76 `all`, 17 `insert`, 14 `update`, 5 `delete`. **Só 40 formas distintas de expressão** (53× `true`, 45× `is_frota_admin()`, 31× `auth.role() = …`, 26× `is_acessos_admin()`, 23× "perfil com papel/super/módulo"...), compostas de 22 átomos: é isso que torna viável compilar o catálogo em vez de reescrever 276 regras à mão (Ruling 3).

### I.4 Tabela por domínio

"Acessos" = literais de acesso a tabela (todas as formas da I.1) cuja tabela é do domínio, venham da tela que vierem. "Gatilhos" = em tabelas do domínio (`03-triggers.csv`). Risco: **ALTO** = dinheiro, identidade, permissão de gente ou dado pessoal de cliente.

| Sub-plano | Telas (`src/ferramentas/…`) | Acessos | RPC distintas | Edges do front | Tabelas (catálogo) | Policies (restritivas) | Gatilhos | Risco |
|---|---|---|---|---|---|---|---|---|
| **5.0** Fundação + conta | `login`, `moldura-do-aplicativo.vue`, `compartilhado/controle-de-login-e-usuario.js` | — | 2 (`marcar_senha_trocada`, `minha_conta_esta_desativada`: substituídas) | `invite-user`, `entrar-como-usuario`, `conferir-senha` | — | (todas, via autz) | — | ALTO |
| **5.1** Admin, equipes e acesso | `admin`, `login` (pedir acesso), `compartilhado` (push) | 70 | 0 | (`coletar-dados`/`auditar-dados` pelo botão: não portar, Ruling 30) | 21 | 44 (1) | 9 (`profiles` 2, `user_permissions` 3, `equipes` 1, `canais_grupos` 1, `bling_lojas` 2*) | ALTO |
| **5.2** Patrimônio e cadastros compartilhados | `patrimonio` (+ chamadas de `frota`, `acessos`) | 33 | 5 | — | 9 | 20 (4) | 3 | ALTO |
| **5.3** Frota | `frota` | 56 | 2 (+5 do 5.2) | (`avisar-decisao-de-reserva`: Plano 4) | 14 | 28 (0) | 19 | médio |
| **5.4** Acessos (cadastro) | `acessos` | 65 | 0 | (`acessos-proxy`, `acessos-oauth`: Plano 6) | 13 | 14 (0) | 0 | médio |
| **5.5** Comercial (Bling) | `analise-vendas`, `gestao-a-vista`, `gestao-comercial`, `vendas`, `compartilhado` (pedidos) | 35 | 0 | (`bling-proxy`: Plano 3) | 15 | 33 (7) | 2* | ALTO |
| **5.6** Meta e redes (métricas) | `redes-sociais`, `analise-campanhas`, `meta-ads` (métricas), `admin` (saúde) | 58 | 0 | (`meta-proxy`, `insights-ao-vivo`, `serie-novos-dia`, `contar-collabs`: Plano 3) | 17 | 39 (15) | 0 | ALTO |
| **5.7** Gestão de tráfego | `gestao-trafego` | 23 | 1 | `buscar-lugar`, `sugerir-publico-ia`, `ler-documento` | 10 | 24 (5) | 1 | médio |
| **5.8** Fábrica de anúncios | `meta-ads` (estúdio, fábrica) | 25 | 0 | `fabrica-trigger`, `-apagar`, `-candidatos`, `-looks`, `-publicos` | 9 | 18 (1) | 0 | médio |
| **5.9** Conteúdo | `conteudo` | 27 | 6 | `conteudo-trigger` | 9 | 25 (4) | 1 | médio |
| **5.10** Autenticidade (selo Vessel no painel) | `autenticidade` | 8 | 16 | `vessel-baixar-cartao` | 10 | 10 (0) | 8 | ALTO |
| **5.11** Comercial Vessel e leads | `comercial-vessel` (6 telas), `beauty-sessions`, `atendimentos`, `abandono-carrinho`, `meta-ads` (leads) | 9 + REST cru | 62 | — | 15 | 18 (0) | 13+ | ALTO |
| **5.12** Painéis pequenos | `noticias`, `claude-status`, `inicio`, `gestao-interna` | 4 | 0 | `custo-anthropic`, `custo-openai` | 2 (+ visão `robos_saude`) | 3 (0) | 0 | baixo |

\* os gatilhos de `bling_lojas` contam no 5.5 (dono da tabela). `banco` (bucket `arquivos`) é inteiro Storage: Plano 6. Soma: 144 tabelas, 276 policies.

---
## II. Arquitetura e contrato

### II.1 A decisão: endpoints por domínio, autorização compilada do catálogo

| | (a) Endpoints por domínio, SQL explícito | (b) Camada genérica (tabela/filtros por JSON) |
|---|---|---|
| Superfície | Só o que cada tela precisa, com filtros e ordens em lista branca | Toda coluna de toda tabela, combinável: é o PostgREST de novo, sem a RLS |
| Erro de autorização | Aparece numa rota, num SQL que se lê | Um erro no catálogo abre a tabela inteira para qualquer combinação |
| Formato da resposta | Igual ao PostgREST (o Postgres monta o JSON) | Igual |
| Trabalho | Maior (~150–250 rotas nos sub-planos) | Menor |

**Escolha: (a)**, com três peças que cortam o trabalho sem abrir consulta arbitrária:

1. **`autz`**: as policies NÃO são reescritas à mão. O catálogo de produção (JSON embutido) é compilado em predicados Go (22 átomos: `is_frota_admin()`, `pode_ver_conta(col)`, "perfil com papel/super/módulo/chave", dono da linha...). Cada tabela×operação vira um `Filtro` — condição SQL com os valores do ator em parâmetros nomeados — que a rota põe no `WHERE`. Uma policy nova em produção com forma desconhecida faz a API não subir.
2. **`dados.Consulta`**: leitura declarada (tabela, alias, SQL fixo, filtros e ordens permitidos). A regra de Ler entra sozinha na tabela principal e em cada tabela embutida (marcador `{ler:<tabela>:<alias>}`); `Validar` recusa, na montagem, SQL que leia uma tabela sem regra.
3. **`rpc`**: as 92 funções que o painel chama por `.rpc` (das 107 da categoria F; ver I.2) já são a API de negócio, com checagem interna. Viram `POST /rpc/{nome}` por **lista branca**: nome registrado, parâmetros tipados (cast explícito), portão em Go (`autz.Regra`) que espelha a checagem da função, execução em `banco.ComUsuario` (a checagem interna continua valendo como segunda barreira).

Escritas de tabela (insert/update/delete diretos do front, ~160 sítios) viram rotas de escrita por domínio: a rota decide as colunas (struct + `dados.LerCorpo`, que recusa campo não declarado), confere com `autz.PodeCriar/PodeEditar/PodeApagar` (que travam a linha `for update` e checam a linha antiga E a nova) e grava dentro de `banco.ComUsuario`.

### II.2 Contrato HTTP das rotas de domínio (o cliente `api` do Plano 7)

O Plano 7 escreve `src/compartilhado/api.js` contra este contrato; nenhum sub-plano o muda sem Ruling.

- **Base e sessão:** `/api` no nginx (as rotas Go não têm o prefixo; ver NOTAS). `Authorization: Bearer <token>` de `POST /auth/entrar` (`{email, senha}` → `{token}`); `POST /auth/sair`; `GET /auth/eu`; `GET /eu/perfil` (o array que a tela lia de `profiles`); `GET /eu/canais`.
- **Leitura:** `GET /<dominio>/<recurso>?<filtro>=<valor>&ordem=<campo>[.asc|.desc]&limite=1..1000&deslocamento=N[&contar=1]` → `200` com **array JSON no formato do PostgREST** (montado pelo Postgres com `json_agg`: datas `2026-10-11T12:00:00+00:00`, `numeric` como número, `null`, chaves na ordem das colunas, recurso embutido como objeto aninhado com o nome que a tela já lê). Sem permissão = `200 []` (como o PostgREST com RLS). `contar=1` acrescenta `X-Total-Count`. Parâmetro desconhecido, repetido ou com valor inválido = `400`. Sem `limite` = 1000 (o `max_rows` do Supabase). Uma linha: `GET /<dominio>/<recurso>/{id}` → objeto, ou `404` (não existe OU não é visível: as duas iguais).
- **Escrita:** `POST /<dominio>/<recurso>` → `201` com a linha (se a pessoa a lê; senão `{"id": …}`); `PATCH /<dominio>/<recurso>/{id}` → `200` com a linha; `DELETE /<dominio>/<recurso>/{id}` → `204`. Ação de negócio: `POST /<dominio>/<acao>`. Linha invisível = `404`; visível sem permissão (ou mudança que leva a linha para fora do que a pessoa vê) = `403`.
- **RPC:** `POST /rpc/{nome}` com o MESMO corpo de `.rpc(nome, args)` (nomes `p_*`). `200` com o resultado (`to_json` da função: escalar, objeto ou `null`), `200` com array (função `setof`/`table`), `204` (função `void`). Nome não registrado = `404`.
- **Edges portadas:** `POST /<nome-da-edge>` com o corpo e a resposta da edge (Planos 3 e 4; no 5.0: `invite-user`, `entrar-como-usuario`, `conferir-senha`).
- **Erro (rotas novas):** `{"error": "<codigo>", "mensagem": "<frase opcional para a pessoa>"}`:

| Status | `error` | Quando |
|---|---|---|
| 400 | `pedido_invalido`, `corpo_invalido`, `regra_de_negocio` (com a mensagem do `raise exception` da função), `senha_invalida`, `token_invalido` | entrada; regra escrita por nós no banco (P0001/22023) |
| 401 | `nao_autenticado`, `credenciais_invalidas` | sem sessão; login errado |
| 403 | `sem_permissao` (com a mensagem quando vem de um 42501 da função), `conta_desativada` | portão; conta desativada com a senha certa |
| 404 | `nao_encontrado` | linha inexistente ou invisível; RPC não registrada |
| 409 | `conflito` | 23505/23503 (texto fixo, sem valor) |
| 413 / 429 / 500 / 504 | `corpo_grande_demais` / `muitas_tentativas` / `erro_interno` / `prazo_esgotado` | |

  O cliente `api.js` classifica por status (o `classificarErro` atual já faz 401 → "sessão expirou", 403 → "sem permissão"); `403 conta_desativada` vira a mensagem `CONTA_DESATIVADA` que a tela já tem.

### II.3 O gerador dos testes de contrato de permissão

Spec §5: "a base dos testes de contrato de permissão (tabela de casos: ator × operação × recurso → permitido/negado), executados contra o Go". O desenho (Task 4):

- **O oráculo é a própria RLS de produção.** `autzteste.Novo` cria um banco novo com as 144 tabelas do catálogo (colunas que as policies leem + as do "mundo"), liga a RLS, cria as 276 policies **verbatim** do JSON e as 25 funções que elas chamam **verbatim** de produção (`ajudantes.sql`, gerado do levantamento por `extrair-ajudantes.mjs`). Perguntar "o que esta pessoa vê" = `set local role authenticated` + `app.usuario_id` e um `select`. Nada de reimplementar a semântica da RLS no teste: a combinação permissiva/restritiva, o `with check` que cai no `using`, o `update` que também exige a policy de `select`, a subconsulta da policy que passa pela RLS de outra tabela — tudo é o Postgres que decide.
- **O mundo:** equipes T1–T4 (canal, local, depósito), lojas 1–5 (grupos G1/G2), pessoas e bens, e ~60 pessoas geradas do próprio catálogo: as fixas (sem perfil, comum, admin, super pela ficha, super por e-mail, **desativado com tudo**, vendedora, gestor, supervisora de time e de grupo, estoque com e sem vínculo, contas limitadas, `permissions` malformado) e uma por módulo, chave de `permissions` e ferramenta do `vessel_pode` que o catálogo e as funções citam.
- **As linhas:** em cada tabela fora do mundo, o produto cartesiano dos valores das colunas que as policies dela leem (contas A1/A2/nula, lojas 1–5/nula, donos = toda pessoa/nulo...). Para criar, candidatas por pessoa (dono = ela, outra, ninguém).
- **A comparação:** para cada pessoa × tabela, Ler e Apagar comparam o conjunto de ids; Editar compara o tri-estado por linha (não vê / passou / caiu no WITH CHECK); Criar compara cada candidata. Tudo numa transação desfeita, com savepoint por tentativa, uma goroutine por pessoa (~16 s).
- **A cobertura é assertada:** toda tabela×operação tem de mostrar permitido E negado no mundo, salvo quando o Go a decide como constante para todas as pessoas (`true` ou `false`). Regra que o mundo não exercita falha o teste ("acrescente pessoa/linha").
- **Portões de RPC:** o mesmo mundo compara cada `autz.Regra` exportada com a função de produção que ela espelha (`select is_frota_admin()` como a pessoa). Os sub-planos acrescentam um caso por portão novo e, com o esquema real (dependência D0), comparam o portão da rota com a função chamada como cada pessoa (42501 = negado).
- **Formato de um caso:** `<pessoa> × <tabela> × <op> [linha <id>]: RLS <x>, Go <y> (<SQL do Go>)`. As 60 primeiras divergências aparecem; o teste falha com o total.

O ensaio deste plano rodou o oráculo inteiro: 0 divergências depois de 2 correções que ele mesmo achou (a subconsulta em `profiles` não enxerga o perfil de quem está desativado; idem o `COALESCE((select is_superadmin …))`), e 13 das 14 mutações de segurança testadas morreram (a sobrevivente, a RLS de `patrimonio_bens` dentro da policy de `patrimonio_posse`, é redundante com o catálogo atual e foi retirada do código; o oráculo acusa se o catálogo mudar).

---
## III. Plano 5.0 — a fundação (executável)

### Pré-voo (antes da Task 1)

- [ ] `cd /Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/api-go-dominios && git status --short` → só este plano (ou vazio); `git branch --show-current` → `feat/api-go-dominios`.
- [ ] A base é o Plano 4: `git log --oneline -1 feat/api-go-worker` aparece em `git log --oneline | head -20` e `grep -q 'func Configurar' api/internal/banco/banco.go || echo 'ainda não'` → `ainda não`. Se a revisão final do Plano 4 trouxer commits novos, faça `git merge --no-edit feat/api-go-worker` antes da Task 1; se algum trecho "troque" deste plano não casar exatamente, **pare e reporte**.
- [ ] `go version` → `go1.26` ou mais novo; `node --version` → `v22` ou mais novo.
- [ ] O levantamento existe (fonte do `ajudantes.sql`, Task 4): `test -f "/Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/levantamento-ro/docs/migracao-go/levantamento/02-funções.csv" && echo ok` → `ok`.
- [ ] Docker no ar e porta livre: `lsof -iTCP:58534 -sTCP:LISTEN` → vazio.
- [ ] Banco das etapas (fica no ar até a verificação final):
  ```bash
  docker run -d --rm --name pg-plano5 -e POSTGRES_PASSWORD=x -p 127.0.0.1:58534:5432 postgres:17
  until docker exec pg-plano5 pg_isready -h 127.0.0.1 -U postgres >/dev/null 2>&1; do sleep 1; done
  export TEST_DATABASE_URL='postgres://postgres:x@localhost:58534/postgres?sslmode=disable'
  ```
  Toda etapa "Run" de Go assume `TEST_DATABASE_URL` exportada e o diretório `api/`. O teste de contrato (Task 4) CRIA e APAGA bancos `autz_<hex>` nesse servidor (o usuário `postgres` do contêiner pode).
- [ ] Linha de base: `cd api && go test ./... && go test -v ./... 2>&1 | grep -c -- '--- SKIP'` → tudo `ok` e `0`.

### Estrutura de arquivos

```
api/internal/banco/banco.go                    # + Configurar (timezone=UTC) usado por Abrir e pelos testes
api/internal/testebanco/testebanco.go          # Configurar; TabelasDoEscopo; profiles com as colunas da conta
api/internal/dados/dados.go                    # erro, ErroDoBanco, LerCorpo, Lista/Um (JSON montado pelo Postgres)
api/internal/dados/parametros.go               # paginação, ordem e filtros declarados (lista branca, cast obrigatório)
api/internal/dados/consulta.go                 # Consulta: leitura declarada com a regra de Ler do catálogo; ErroDeEscrita
api/internal/autz/escopo.go                    # Escopo: o que as policies liam sobre quem pede (perfil, vínculos, canais...)
api/internal/autz/predicados.go                # os 22 átomos das policies + portões de RPC (Regra)
api/internal/autz/catalogo.go                  # compila o catálogo de produção (embutido) em regras por tabela×op
api/internal/autz/filtro.go                    # Filtro (SQL + parâmetros nomeados) e Conferir (linha nova)
api/internal/autz/escrita.go                   # ComEscopo, PodeCriar/PodeEditar/PodeApagar
api/internal/autz/catalogo-policies-producao.json  # cópia embutida (teste prende igual à dos docs)
api/internal/autz/autzteste/mundo.go           # o oráculo: banco com a RLS de produção e o mundo de pessoas
api/internal/autz/autzteste/extrair-ajudantes.mjs  # gera ajudantes.sql do levantamento
api/internal/autz/autzteste/ajudantes.sql      # GERADO: as 25 funções das policies, verbatim de produção
api/internal/autz/contrato_test.go             # o teste de contrato pessoa×tabela×op×linha contra a RLS
api/internal/autz/portoes_test.go              # portões de RPC contra as funções de produção
api/internal/rpc/rpc.go                        # POST /rpc/{nome}: lista branca, parâmetros tipados, portão, ComUsuario
api/internal/auth/middleware.go                # + NoContexto
api/internal/email/email.go                    # ZeptoMail (convite e troca de senha)
api/internal/banco/migracoes/00005_tokens_de_senha.sql
api/internal/auth/conta.go                     # esqueci/definir/trocar senha, GET /eu/perfil
api/internal/auth/rotas.go                     # Entrar: 403 conta_desativada só com a senha certa
api/internal/auth/convite.go                   # POST /invite-user (contrato da edge)
api/internal/auth/sessoes.go                   # + CriarComPrazo
api/internal/auth/entrar_como.go               # POST /entrar-como-usuario e POST /conferir-senha
api/internal/config/config.go                  # + ZEPTOMAIL_TOKEN, ZEPTOMAIL_DE, ENDERECOS_DO_APP, ENDERECO_PADRAO
api/internal/web/rotas.go                      # montagem: links de senha públicos; conta; grupo de domínio com ComEscopo e /rpc
api/cmd/api/conferir.go                        # colunas que a conta e o Escopo presumem no banco restaurado
docs/migracao-go/NOTAS-DA-IMPLANTACAO.md       # seção do Plano 5.0
```

### Tarefas

| # | Task | Revisor |
|---|---|---|
| 1 | Contrato HTTP de base: erro, JSON montado pelo Postgres em UTC, corpo, paginação, ordem e filtros declarados | **opus (injeção, vazamento em erro)** |
| 2 | `autz.Escopo`: o que as policies liam sobre quem pede | **opus (autorização)** |
| 3 | `autz`: compilar o catálogo de produção em predicados e filtros SQL | **opus (autorização)** |
| 4 | O oráculo: teste de contrato contra a RLS de produção e portões de RPC | **opus (autorização)** |
| 5 | `dados.Consulta` e conferências de escrita (IDOR) | **opus (autorização, IDOR)** |
| 6 | `POST /rpc/{nome}`: lista branca de funções SQL | **opus (injeção, autorização)** |
| 7 | Conta: links de senha por e-mail, trocar senha, conta desativada, `GET /eu/perfil` | **opus (autenticação, segredo)** |
| 8 | `POST /invite-user` | **opus (gestão de contas)** |
| 9 | `POST /entrar-como-usuario` e `POST /conferir-senha` | **opus (impersonação, senha)** |
| 10 | Montagem das rotas, configuração, `conferir` e notas de implantação | **opus (fronteira pública)** |

Ordem: 1 → 10 em sequência (cada task usa os nomes das anteriores; ver "Interfaces"). O ensaio deste plano aplicou as 10 tasks, em ordem, numa cópia de `api/` sobre `feat/api-go-worker` e rodou `gofmt`, `go vet` e `go test -race` de cada pacote contra Postgres 17 (fora da cópia ficaram só os 2 testes que leem `db/migrations/`, que existe na worktree).

---
### Task 1: Contrato HTTP de base — erro, JSON montado pelo Postgres em UTC, corpo, paginação, ordem e filtros

**Revisor:** **opus** (o texto do pedido nunca pode virar SQL; erro do banco nunca pode vazar valor de coluna).

Todas as rotas de domínio dos sub-planos usam estas peças. O JSON sai do próprio Postgres (`json_agg`, o mesmo serializador do PostgREST), então datas, números e nulos chegam às telas no formato que elas já leem; para as datas saírem com `+00:00` (como no Supabase), toda conexão da API passa a usar `timezone=UTC` (`banco.Configurar`).

**Files:**
- Modify: `api/internal/banco/banco.go` (função `Abrir`)
- Modify: `api/internal/testebanco/testebanco.go` (uma linha)
- Create: `api/internal/dados/dados.go`, `api/internal/dados/parametros.go`
- Test: `api/internal/dados/dados_test.go`, `api/internal/banco/fuso_test.go`

**Interfaces:**
- Consumes: `testebanco.Novo` (Plano 1).
- Produces:
  - `banco.Configurar(c *pgxpool.Config)` (timezone UTC).
  - `type dados.Consultor interface { QueryRow(ctx, sql string, args ...any) pgx.Row }`.
  - `dados.Erro(w, status int, codigo, mensagem string)`; `dados.ErroDoBanco(w, err error)`; `dados.LerCorpo(w, r, destino any) bool`.
  - `dados.Lista(ctx, q Consultor, w, consulta string, args pgx.NamedArgs)`; `dados.Um(...)` (mesma assinatura).
  - `const dados.LimitePadrao = 1000`; `var dados.Reservados map[string]bool`; `type dados.Pagina struct{ Limite, Deslocamento int }`; `dados.LerPagina(q url.Values) (Pagina, error)`; `dados.LerOrdem(q url.Values, permitidas map[string]string, padrao string) (string, error)`.
  - `type dados.Filtro struct { Param, SQL, Tipo string }` com `Validar() error`; `dados.LerFiltros(q url.Values, filtros []Filtro, args pgx.NamedArgs) ([]string, error)`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/banco/fuso_test.go`:

```go
package banco

import (
	"context"
	"os"
	"testing"
)

// O pool da API fala UTC, como o Supabase: sem isso o JSON montado pelo Postgres sairia no
// fuso do servidor (o contêiner do Postgres usa "Etc/UTC", e um VPS pode usar outro).
func TestAbrirFalaUTC(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL ausente: rode `make teste` em api/")
	}
	p, err := Abrir(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	defer p.Close()
	var fuso string
	if err := p.QueryRow(context.Background(), `show timezone`).Scan(&fuso); err != nil || fuso != "UTC" {
		t.Fatalf("timezone = %q (%v), esperava UTC", fuso, err)
	}
}
```

Crie `api/internal/dados/dados_test.go`:

```go
package dados

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestErroDoBanco(t *testing.T) {
	casos := []struct {
		err    error
		status int
		corpo  string
	}{
		{pgx.ErrNoRows, 404, `{"error":"nao_encontrado"}`},
		{&pgconn.PgError{Code: "42501", Message: "Sem acesso para cadastrar colaborador", Detail: "SEGREDO"}, 403, `{"error":"sem_permissao","mensagem":"Sem acesso para cadastrar colaborador"}`},
		{&pgconn.PgError{Code: "P0001", Message: "Lote já gravado", Detail: "SEGREDO"}, 400, `{"error":"regra_de_negocio","mensagem":"Lote já gravado"}`},
		{&pgconn.PgError{Code: "22023", Message: "Digite o nome antes de criar."}, 400, `{"error":"regra_de_negocio","mensagem":"Digite o nome antes de criar."}`},
		{&pgconn.PgError{Code: "23505", Message: `duplicate key value violates unique constraint "x_email"`, Detail: "Key (email)=(SEGREDO@x) already exists."}, 409, `{"error":"conflito","mensagem":"Já existe um registro com esses dados."}`},
		{&pgconn.PgError{Code: "23503", Message: "fk", Detail: "SEGREDO"}, 409, `{"error":"conflito","mensagem":"O registro está ligado a outro que não existe ou que ainda depende dele."}`},
		{&pgconn.PgError{Code: "22P02", Message: `invalid input syntax for type uuid: "SEGREDO"`}, 400, `{"error":"pedido_invalido"}`},
		{&pgconn.PgError{Code: "23502", Message: `null value in column "SEGREDO"`}, 400, `{"error":"pedido_invalido"}`},
		{&pgconn.PgError{Code: "XX000", Message: "SEGREDO interno"}, 500, `{"error":"erro_interno"}`},
		{context.DeadlineExceeded, 504, `{"error":"prazo_esgotado"}`},
		{errors.New("dial tcp 10.0.0.1:5432: SEGREDO"), 500, `{"error":"erro_interno"}`},
	}
	for _, c := range casos {
		w := httptest.NewRecorder()
		ErroDoBanco(w, c.err)
		if w.Code != c.status || strings.TrimSpace(w.Body.String()) != c.corpo {
			t.Errorf("%v: %d %s, esperava %d %s", c.err, w.Code, w.Body, c.status, c.corpo)
		}
		if strings.Contains(w.Body.String(), "SEGREDO") {
			t.Errorf("%v: vazou detalhe na resposta: %s", c.err, w.Body)
		}
	}
}

func TestLerCorpo(t *testing.T) {
	type alvo struct {
		Nome string `json:"nome"`
	}
	casos := []struct {
		corpo  string
		ok     bool
		status int
	}{
		{`{"nome":"a"}`, true, 200},
		{`{"nome":"a","is_superadmin":true}`, false, 400}, // campo não declarado: nunca vira coluna
		{`{"nome":"a"} {"nome":"b"}`, false, 400},
		{`{"nome":`, false, 400},
		{`{"nome":"` + strings.Repeat("x", 1<<20) + `"}`, false, 413},
	}
	for _, c := range casos {
		w := httptest.NewRecorder()
		var a alvo
		ok := LerCorpo(w, httptest.NewRequest("POST", "/", strings.NewReader(c.corpo)), &a)
		if ok != c.ok || (!ok && w.Code != c.status) {
			t.Errorf("%.40q: ok=%v status=%d", c.corpo, ok, w.Code)
		}
	}
}

// O JSON sai do Postgres, como no PostgREST: data com +00:00 (pool em UTC), numeric com as
// casas, nulo, jsonb aninhado e chaves na ordem das colunas.
func TestListaEUmNoFormatoDoPostgREST(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table coisa (id int, quando timestamptz, valor numeric(10,2), nada text, extra jsonb);
		insert into coisa values (1, '2026-10-11 09:00:00-03', 10.5, null, '{"a":[1,2]}'), (2, '2026-10-12 00:00:00+00', 0, 'x', null)`); err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	Lista(ctx, p, w, `select * from coisa where id = @id::int`, pgx.NamedArgs{"id": 1})
	quer := `[{"id":1,"quando":"2026-10-11T12:00:00+00:00","valor":10.50,"nada":null,"extra":{"a": [1, 2]}}]`
	if w.Code != 200 || w.Body.String() != quer || w.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("Lista = %d %s", w.Code, w.Body)
	}
	w = httptest.NewRecorder()
	Lista(ctx, p, w, `select * from coisa where id = @id::int`, pgx.NamedArgs{"id": 99})
	if w.Body.String() != `[]` {
		t.Fatalf("Lista vazia = %s", w.Body)
	}
	for _, c := range []struct {
		onde   string
		status int
		corpo  string
	}{
		{"id = 2", 200, `{"id":2,"quando":"2026-10-12T00:00:00+00:00","valor":0.00,"nada":"x","extra":null}`},
		{"id = 99", 404, `{"error":"nao_encontrado"}`},
		{"true", 500, `{"error":"erro_interno"}`},
	} {
		w = httptest.NewRecorder()
		Um(ctx, p, w, `select * from coisa where `+c.onde, nil)
		if w.Code != c.status || strings.TrimSpace(w.Body.String()) != c.corpo {
			t.Errorf("Um(%s) = %d %s", c.onde, w.Code, w.Body)
		}
	}
}

func TestLerPagina(t *testing.T) {
	for q, quer := range map[string]Pagina{"": {1000, 0}, "limite=10&deslocamento=20": {10, 20}, "limite=1000": {1000, 0}} {
		v, _ := url.ParseQuery(q)
		if p, err := LerPagina(v); err != nil || p != quer {
			t.Errorf("%q = %+v %v", q, p, err)
		}
	}
	for _, q := range []string{"limite=0", "limite=1001", "limite=x", "deslocamento=-1", "deslocamento=1.5"} {
		v, _ := url.ParseQuery(q)
		if _, err := LerPagina(v); err == nil {
			t.Errorf("%q aceito", q)
		}
	}
}

func TestLerOrdemSoComCamposPermitidos(t *testing.T) {
	perm := map[string]string{"quando": "u.criado_em", "placa": "v.placa"}
	for q, quer := range map[string]string{"": "u.criado_em desc", "ordem=quando": "u.criado_em asc", "ordem=placa.desc": "v.placa desc", "ordem=placa.asc": "v.placa asc"} {
		v, _ := url.ParseQuery(q)
		if got, err := LerOrdem(v, perm, "u.criado_em desc"); err != nil || got != quer {
			t.Errorf("%q = %q %v", q, got, err)
		}
	}
	// url.Values direto: ParseQuery descartaria o par com ";" e o teste não testaria nada
	for _, o := range []string{"id", "quando.desc;drop table x", "quando.nullsfirst", "u.criado_em", "quando desc"} {
		if got, err := LerOrdem(url.Values{"ordem": {o}}, perm, "x"); err == nil {
			t.Errorf("%q aceito: %q", o, got)
		}
	}
}

func TestFiltroValidar(t *testing.T) {
	if err := (Filtro{Param: "veiculo", SQL: "u.veiculo_id = @veiculo::uuid", Tipo: "uuid"}).Validar(); err != nil {
		t.Fatal(err)
	}
	for _, f := range []Filtro{
		{Param: "veiculo", SQL: "u.veiculo_id = @veiculo", Tipo: "uuid"}, // sem cast
		{Param: "limite", SQL: "x = @limite::int", Tipo: "inteiro"},      // reservado
		{Param: "Veiculo", SQL: "x = @Veiculo::uuid", Tipo: "uuid"},
		{Param: "veiculo", SQL: "x = @veiculo::uuid", Tipo: "numero"},
	} {
		if f.Validar() == nil {
			t.Errorf("%+v aceito", f)
		}
	}
}

func TestLerFiltros(t *testing.T) {
	fs := []Filtro{
		{Param: "veiculo", SQL: "u.veiculo_id = @veiculo::uuid", Tipo: "uuid"},
		{Param: "lojas", SQL: "u.loja_id = any(@lojas::bigint[])", Tipo: "inteiro[]"},
		{Param: "desde", SQL: "u.dia >= @desde::date", Tipo: "data"},
	}
	v, _ := url.ParseQuery("veiculo=AAAAAAAA-1111-1111-1111-111111111111&lojas=1,2&desde=2026-10-01&limite=5")
	args := pgx.NamedArgs{}
	conds, err := LerFiltros(v, fs, args)
	if err != nil || len(conds) != 3 {
		t.Fatalf("conds=%v err=%v", conds, err)
	}
	if args["veiculo"] != "aaaaaaaa-1111-1111-1111-111111111111" || len(args["lojas"].([]int64)) != 2 || args["desde"] != "2026-10-01" {
		t.Fatalf("args = %#v", args)
	}
	for _, v := range []url.Values{
		{"cor": {"azul"}}, {"veiculo": {"1"}}, {"veiculo": {"a", "b"}}, {"lojas": {"1,x"}},
		{"desde": {"01/10/2026"}}, {"veiculo": {"'; drop table x"}}, {"lojas": {strings.Repeat("1,", 1000) + "1"}},
	} {
		if _, err := LerFiltros(v, fs, pgx.NamedArgs{}); err == nil {
			t.Errorf("%v aceito", v)
		}
	}
}

// Os valores de LerFiltros entram de verdade numa consulta com o cast declarado.
func TestFiltrosNumaConsultaReal(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	p.Exec(ctx, `create table u (veiculo_id uuid, loja_id bigint, dia date);
		insert into u values ('aaaaaaaa-1111-1111-1111-111111111111', 1, '2026-10-02'), ('bbbbbbbb-1111-1111-1111-111111111111', 2, '2026-09-01'), (null, 3, '2026-10-05')`)
	fs := []Filtro{
		{Param: "lojas", SQL: "loja_id = any(@lojas::bigint[])", Tipo: "inteiro[]"},
		{Param: "desde", SQL: "dia >= @desde::date", Tipo: "data"},
		{Param: "veiculos", SQL: "veiculo_id = any(@veiculos::uuid[])", Tipo: "uuid[]"},
	}
	v, _ := url.ParseQuery("lojas=1,2,3&desde=2026-10-01&veiculos=aaaaaaaa-1111-1111-1111-111111111111")
	args := pgx.NamedArgs{}
	conds, err := LerFiltros(v, fs, args)
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	Lista(ctx, p, w, `select loja_id from u where `+strings.Join(conds, " and ")+` order by 1`, args)
	if w.Body.String() != `[{"loja_id":1}]` {
		t.Fatalf("= %s", w.Body)
	}
	_ = http.StatusOK
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/dados/ ./internal/banco/ 2>&1 | tail -5`
Expected: FAIL de compilação (`undefined: ErroDoBanco`, `undefined: LerCorpo`...) em `dados`; em `banco`, `TestAbrirFalaUTC` falha com `timezone = "Etc/UTC"` (o padrão do contêiner).

- [ ] **Step 3: Implementar**

Em `api/internal/banco/banco.go`, troque o começo de `Abrir`:

```go
func Abrir(ctx context.Context, url string) (*pgxpool.Pool, error) {
	p, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, err
	}
```

por:

```go
// Configurar é o que toda conexão da API usa. timezone=UTC é o do Supabase: o JSON que o
// Postgres monta (dados.Lista) sai com "+00:00", no formato que o PostgREST entregava às telas.
func Configurar(c *pgxpool.Config) {
	c.ConnConfig.RuntimeParams["timezone"] = "UTC"
}

func Abrir(ctx context.Context, url string) (*pgxpool.Pool, error) {
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, err
	}
	Configurar(cfg)
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
```

Em `api/internal/testebanco/testebanco.go`, logo depois de `cfg.ConnConfig.RuntimeParams["search_path"] = esquema`, acrescente:

```go
	banco.Configurar(cfg)
```

Crie `api/internal/dados/dados.go`:

```go
// Package dados é o contrato HTTP das rotas de domínio (Plano 5): formato de erro, JSON
// montado pelo próprio Postgres (o mesmo serializador do PostgREST), corpo de escrita,
// paginação, ordenação e filtros declarados por rota. Nada aqui decide permissão: isso é
// do pacote autz.
package dados

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Consultor é o que Lista e Um precisam: *pgxpool.Pool e pgx.Tx servem.
type Consultor interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Erro escreve {"error": codigo} e, se houver, "mensagem" (frase para a pessoa ler).
func Erro(w http.ResponseWriter, status int, codigo, mensagem string) {
	corpo := map[string]string{"error": codigo}
	if mensagem != "" {
		corpo["mensagem"] = mensagem
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

// ErroDoBanco traduz o erro de uma consulta. Só as mensagens ESCRITAS POR NÓS nas funções do
// banco (raise exception: P0001, 22023 e 42501) chegam à pessoa, como o PostgREST fazia; o
// resto sai com texto fixo, sem nome de coluna nem valor (Detail nunca é lido nem logado).
func ErroDoBanco(w http.ResponseWriter, err error) {
	var pe *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		Erro(w, http.StatusNotFound, "nao_encontrado", "")
	case errors.As(err, &pe):
		switch {
		case pe.Code == "42501":
			Erro(w, http.StatusForbidden, "sem_permissao", pe.Message)
		case pe.Code == "P0001" || pe.Code == "22023":
			Erro(w, http.StatusBadRequest, "regra_de_negocio", pe.Message)
		case pe.Code == "23505":
			Erro(w, http.StatusConflict, "conflito", "Já existe um registro com esses dados.")
		case pe.Code == "23503":
			Erro(w, http.StatusConflict, "conflito", "O registro está ligado a outro que não existe ou que ainda depende dele.")
		case strings.HasPrefix(pe.Code, "22") || strings.HasPrefix(pe.Code, "23"):
			Erro(w, http.StatusBadRequest, "pedido_invalido", "")
		default:
			slog.Error("banco", "codigo", pe.Code, "mensagem", pe.Message)
			Erro(w, http.StatusInternalServerError, "erro_interno", "")
		}
	case errors.Is(err, context.DeadlineExceeded):
		Erro(w, http.StatusGatewayTimeout, "prazo_esgotado", "")
	default:
		slog.Error("banco", "erro", err.Error())
		Erro(w, http.StatusInternalServerError, "erro_interno", "")
	}
}

// LerCorpo decodifica UM objeto JSON de até 1 MiB em destino. Campo que a struct não declara
// é recusado (é o que impede gravar coluna que a rota não escolheu); lixo depois do objeto
// também. Devolve false depois de já ter respondido 400/413.
func LerCorpo(w http.ResponseWriter, r *http.Request, destino any) bool {
	dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	dec.DisallowUnknownFields()
	err := dec.Decode(destino)
	if err == nil {
		if _, fim := dec.Token(); fim != io.EOF {
			err = errors.New("lixo depois do objeto")
		}
	}
	if err == nil {
		return true
	}
	var grande *http.MaxBytesError
	if errors.As(err, &grande) {
		Erro(w, http.StatusRequestEntityTooLarge, "corpo_grande_demais", "")
	} else {
		Erro(w, http.StatusBadRequest, "corpo_invalido", "")
	}
	return false
}

// Lista responde 200 com o array JSON de `consulta`, montado pelo Postgres (json_agg): datas
// com "+00:00", numeric como número, nulos e chaves na ordem das colunas, exatamente como o
// PostgREST entregava. Lista vazia = [].
func Lista(ctx context.Context, q Consultor, w http.ResponseWriter, consulta string, args pgx.NamedArgs) {
	var corpo []byte
	if err := q.QueryRow(ctx, `select coalesce(json_agg(t), '[]'::json) from (`+consulta+`) t`, args).Scan(&corpo); err != nil {
		ErroDoBanco(w, err)
		return
	}
	escrever(w, http.StatusOK, corpo)
}

// Um responde 200 com o objeto da ÚNICA linha de `consulta`; nenhuma linha = 404; mais de uma
// é defeito da rota (500), nunca "a primeira que vier".
func Um(ctx context.Context, q Consultor, w http.ResponseWriter, consulta string, args pgx.NamedArgs) {
	var corpo []byte
	var n int
	err := q.QueryRow(ctx, `select (array_agg(row_to_json(t)))[1], count(*) from (`+consulta+`) t`, args).Scan(&corpo, &n)
	switch {
	case err != nil:
		ErroDoBanco(w, err)
	case n == 0:
		Erro(w, http.StatusNotFound, "nao_encontrado", "")
	case n > 1:
		slog.Error("dados.Um: consulta devolveu mais de uma linha", "linhas", n)
		Erro(w, http.StatusInternalServerError, "erro_interno", "")
	default:
		escrever(w, http.StatusOK, corpo)
	}
}

func escrever(w http.ResponseWriter, status int, corpo []byte) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(corpo)
}
```

Crie `api/internal/dados/parametros.go`:

```go
package dados

import (
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// LimitePadrao é o max_rows do PostgREST do Supabase: nenhuma tela recebeu mais linhas que
// isso numa leitura; manter o teto evita que uma tela antiga passe a baixar a tabela inteira.
const LimitePadrao = 1000

// Reservados são os parâmetros de query que toda leitura entende, além dos filtros da rota.
var Reservados = map[string]bool{"limite": true, "deslocamento": true, "ordem": true, "contar": true}

type Pagina struct{ Limite, Deslocamento int }

// LerPagina: ?limite= (1..1000, padrão 1000) e ?deslocamento= (>= 0, padrão 0).
func LerPagina(q url.Values) (Pagina, error) {
	p := Pagina{Limite: LimitePadrao}
	if v := q.Get("limite"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 || n > LimitePadrao {
			return p, fmt.Errorf("limite deve ser de 1 a %d", LimitePadrao)
		}
		p.Limite = n
	}
	if v := q.Get("deslocamento"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			return p, fmt.Errorf("deslocamento deve ser 0 ou mais")
		}
		p.Deslocamento = n
	}
	return p, nil
}

// LerOrdem: ?ordem=campo ou ?ordem=campo.desc, só com campos de `permitidas` (nome público →
// expressão SQL fixa, escrita na rota). Sem ?ordem, devolve `padrao` (SQL fixo da rota).
// O texto do pedido NUNCA entra no SQL: só a expressão da tabela de permitidas.
func LerOrdem(q url.Values, permitidas map[string]string, padrao string) (string, error) {
	v := q.Get("ordem")
	if v == "" {
		return padrao, nil
	}
	campo, sentido, _ := strings.Cut(v, ".")
	expr, ok := permitidas[campo]
	if !ok || (sentido != "" && sentido != "asc" && sentido != "desc") {
		return "", fmt.Errorf("ordem inválida: %q", v)
	}
	if sentido == "" {
		sentido = "asc"
	}
	return expr + " " + sentido, nil
}

// Filtro é um filtro de query DECLARADO pela rota: ?<Param>=valor vira `and <SQL>` com o valor
// no parâmetro nomeado @<Param>, já convertido para o Tipo. SQL é texto fixo da rota e TEM de
// trazer o cast explícito do parâmetro (ex.: "u.veiculo_id = @veiculo::uuid").
type Filtro struct {
	Param string
	SQL   string
	Tipo  string // texto | uuid | inteiro | data | instante | booleano; com sufixo [] = lista por vírgula
}

var (
	reParam = regexp.MustCompile(`^[a-z][a-z0-9_]{0,40}$`)
	reUUID  = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	tipos   = map[string]bool{"texto": true, "uuid": true, "inteiro": true, "data": true, "instante": true, "booleano": true}
)

// Validar confere a declaração (chamado na montagem das rotas: erro = a API não sobe).
func (f Filtro) Validar() error {
	base := strings.TrimSuffix(f.Tipo, "[]")
	switch {
	case !reParam.MatchString(f.Param) || Reservados[f.Param]:
		return fmt.Errorf("filtro %q: nome inválido ou reservado", f.Param)
	case !tipos[base]:
		return fmt.Errorf("filtro %q: tipo desconhecido %q", f.Param, f.Tipo)
	case !strings.Contains(f.SQL, "@"+f.Param+"::"):
		return fmt.Errorf("filtro %q: o SQL precisa do cast explícito @%s::<tipo>", f.Param, f.Param)
	}
	return nil
}

// LerFiltros lê os filtros presentes na query, põe os valores em args e devolve as condições.
// Parâmetro que não é filtro nem reservado, repetido ou com valor inválido = erro (400).
func LerFiltros(q url.Values, filtros []Filtro, args pgx.NamedArgs) ([]string, error) {
	porNome := map[string]Filtro{}
	for _, f := range filtros {
		porNome[f.Param] = f
	}
	var conds []string
	for nome, vals := range q {
		if len(vals) != 1 {
			return nil, fmt.Errorf("parâmetro repetido: %q", nome)
		}
		if Reservados[nome] {
			continue
		}
		f, ok := porNome[nome]
		if !ok {
			return nil, fmt.Errorf("parâmetro desconhecido: %q", nome)
		}
		v, err := converter(f.Tipo, vals[0])
		if err != nil {
			return nil, fmt.Errorf("%s: %w", nome, err)
		}
		args[nome] = v
		conds = append(conds, f.SQL)
	}
	return conds, nil
}

func converter(tipo, v string) (any, error) {
	if base, lista := strings.CutSuffix(tipo, "[]"); lista {
		partes := strings.Split(v, ",")
		if len(partes) > 1000 {
			return nil, fmt.Errorf("lista grande demais")
		}
		// fatia tipada: o pgx sabe codificar []string, []int64 e []bool num array do Postgres
		var textos []string
		var inteiros []int64
		var bools []bool
		for _, p := range partes {
			x, err := converter(base, p)
			if err != nil {
				return nil, err
			}
			switch y := x.(type) {
			case int64:
				inteiros = append(inteiros, y)
			case bool:
				bools = append(bools, y)
			case time.Time:
				textos = append(textos, y.Format(time.RFC3339Nano))
			default:
				textos = append(textos, y.(string))
			}
		}
		switch base {
		case "inteiro":
			return inteiros, nil
		case "booleano":
			return bools, nil
		}
		return textos, nil
	}
	switch tipo {
	case "texto":
		if len(v) > 500 {
			return nil, fmt.Errorf("texto grande demais")
		}
		return v, nil
	case "uuid":
		if !reUUID.MatchString(v) {
			return nil, fmt.Errorf("não é um uuid")
		}
		return strings.ToLower(v), nil
	case "inteiro":
		return strconv.ParseInt(v, 10, 64)
	case "booleano":
		return strconv.ParseBool(v)
	case "data":
		d, err := time.Parse(time.DateOnly, v)
		if err != nil {
			return nil, fmt.Errorf("data deve ser AAAA-MM-DD")
		}
		return d.Format(time.DateOnly), nil
	case "instante":
		t, err := time.Parse(time.RFC3339, v)
		if err != nil {
			return nil, fmt.Errorf("instante deve ser RFC 3339")
		}
		return t, nil
	}
	return nil, fmt.Errorf("tipo desconhecido %q", tipo)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l ./internal && go vet ./internal/dados/ ./internal/banco/ && go test -v ./internal/dados/ ./internal/banco/ 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: nada no `gofmt`; todos `--- PASS`, nenhum `--- SKIP`; `ok` nos dois pacotes. Rode também `go test ./...` (o `testebanco` mudou: todos os pacotes têm de continuar `ok`).

- [ ] **Step 5: Commit**

```bash
git add api/internal/banco/banco.go api/internal/banco/fuso_test.go api/internal/testebanco/testebanco.go api/internal/dados/
git commit -m "feat(api): contrato de base das rotas de domínio (erro, JSON do Postgres em UTC, filtros declarados)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: `autz.Escopo` — o que as policies liam sobre quem pede

**Revisor:** **opus** (falta de dado nunca pode ampliar acesso; todo vínculo filtrado por `profile_id` = quem pede).

As policies chamam funções (`conta_ativa`, `meus_vinculos`, `pode_ver_canal`, `pode_ver_bem`, `pode_ver_estoque`...) que leem `profiles`, `equipes`, `equipes_membros`, `canais_grupos_membros`, `bling_lojas`, `equipes_permissoes` e `acessos_pessoas`. O `Escopo` lê tudo isso UMA vez por requisição e guarda, com os nomes das funções que substitui. Regras finas (copiadas das funções de produção, conferidas pela Task 4): sem perfil conta como **ativo** (`coalesce(..., true)`); `meus_vinculos()` = vínculos diretos ∪ `supervisora` em toda equipe cujo canal é loja de grupo que eu supervisiono; `pode_ver_estoque` = depósito de equipe em que sou supervisora/gestor pelos vínculos OU em que tenho a chave `estoque` E sou membro direto; `permissions` é lido como o `jsonb` lê (array casa o operador `?` pelos elementos texto; só objeto dá ações).

**Files:**
- Create: `api/internal/autz/escopo.go`
- Modify: `api/internal/testebanco/testebanco.go` (acrescentar `TabelasDoEscopo`)
- Test: `api/internal/autz/escopo_test.go`

**Interfaces:**
- Consumes: `testebanco.Novo`.
- Produces:
  - `type autz.Banco interface { Query(...) (pgx.Rows, error); QueryRow(...) pgx.Row }`.
  - `var autz.SuperAdminsPorEmail []string`.
  - `type autz.Escopo struct { ID string; TemPerfil, Ativo bool; Email, Papel string; SuperFicha bool; Modulos []string; Chaves map[string]bool; Acoes map[string][]string; SemTrava, TodasContas bool; Contas []string; Vinculos, Diretos map[string][]string; Canais []int64; Locais, Pessoas []string; Depositos []int64; Grupos []string }` com `Modulo(m string) bool` e `Equipes() []string`.
  - `autz.CarregarEscopo(ctx, b Banco, usuarioID string) (*Escopo, error)`.
  - `testebanco.TabelasDoEscopo(t, p)`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescente ao fim de `api/internal/testebanco/testebanco.go`:

```go
// TabelasDoEscopo cria (se faltarem) as tabelas que autz.CarregarEscopo lê, com as colunas que
// ele usa. Para os testes de rotas que passam por autz.ComEscopo sem montar o mundo inteiro.
func TabelasDoEscopo(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	if _, err := p.Exec(context.Background(), `
create table if not exists equipes (id uuid primary key, canal_loja_id bigint);
alter table equipes add column if not exists local_id uuid, add column if not exists deposito_id bigint;
create table if not exists equipes_membros (equipe_id uuid not null, profile_id uuid not null, papel text);
create table if not exists canais_grupos_membros (grupo_id uuid not null, profile_id uuid not null, papel text);
create table if not exists bling_lojas (loja_id bigint primary key, nome text, grupo text, grupo_id uuid);
create table if not exists equipes_permissoes (equipe_id uuid not null, profile_id uuid not null, chave text not null);
create table if not exists acessos_pessoas (id uuid primary key, nome text, profile_id uuid, email_corporativo text);`); err != nil {
		t.Fatal(err)
	}
}
```

(É função de teste num pacote de teste; as tabelas já existem em produção. `if not exists`: os testes de `canais` e `comercial` criam algumas delas por conta própria.)

Crie `api/internal/autz/escopo_test.go`:

```go
package autz

import (
	"context"
	"reflect"
	"slices"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const (
	eu    = "11111111-0000-4000-a000-000000000001"
	outra = "11111111-0000-4000-a000-000000000002"
	t1    = "e0000000-0000-4000-a000-000000000001"
	t2    = "e0000000-0000-4000-a000-000000000002"
	t3    = "e0000000-0000-4000-a000-000000000003"
	t4    = "e0000000-0000-4000-a000-000000000004"
	g1    = "c0000000-0000-4000-a000-000000000001"
	l1    = "10c00000-0000-4000-a000-000000000001"
	pe1   = "9e000000-0000-4000-a000-000000000001"
)

func TestCarregarEscopo(t *testing.T) {
	p := testebanco.Novo(t)
	testebanco.TabelasDoEscopo(t, p)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `
		insert into profiles (id, email, role, is_superadmin, disabled, escopo_por_equipe, features, permissions, allowed_accounts) values
		  ('`+eu+`', 'eu@x', 'viewer', false, false, true, '{frota,null}', '{"atendimentos":["ver",1,"editar"],"meta.hora":true}', '{A1}'),
		  ('`+outra+`', 'outra@x', 'admin', false, false, true, '{}', '{}', null);
		insert into equipes (id, canal_loja_id, local_id, deposito_id) values
		  ('`+t1+`', 1, '`+l1+`', 11), ('`+t2+`', 2, null, 12), ('`+t3+`', 3, null, 13), ('`+t4+`', 4, null, 14);
		insert into bling_lojas (loja_id, grupo_id) values (1, null), (3, '`+g1+`'), (5, '`+g1+`');
		insert into equipes_membros (equipe_id, profile_id, papel) values
		  ('`+t1+`', '`+eu+`', 'vendedora'), ('`+t4+`', '`+eu+`', null), ('`+t2+`', '`+outra+`', 'gestor');
		insert into canais_grupos_membros (grupo_id, profile_id, papel) values ('`+g1+`', '`+eu+`', 'supervisora');
		insert into equipes_permissoes (equipe_id, profile_id, chave) values ('`+t4+`', '`+eu+`', 'estoque'), ('`+t2+`', '`+eu+`', 'estoque');
		insert into acessos_pessoas (id, profile_id) values ('`+pe1+`', '`+eu+`');`); err != nil {
		t.Fatal(err)
	}
	e, err := CarregarEscopo(ctx, p, eu)
	if err != nil {
		t.Fatal(err)
	}
	slices.Sort(e.Canais)
	quer := &Escopo{
		ID: eu, TemPerfil: true, Ativo: true, Email: "eu@x", Papel: "viewer", Modulos: []string{"frota"},
		Chaves: map[string]bool{"atendimentos": true, "meta.hora": true}, Acoes: map[string][]string{"atendimentos": {"ver", "editar"}},
		SemTrava: false, Contas: []string{"A1"},
		// vínculos: os diretos (T1 vendedora, T4 sem papel) + supervisora de T3 (canal 3 está no grupo G1)
		Vinculos: map[string][]string{t1: {"vendedora"}, t4: {""}, t3: {"supervisora"}},
		Diretos:  map[string][]string{t1: {"vendedora"}, t4: {""}},
		Canais:   []int64{1, 3, 4, 5}, Locais: []string{l1}, Pessoas: []string{pe1}, Grupos: []string{g1},
		// estoque: T3 (supervisora) e T4 (chave estoque + membro); T2 tem a chave mas eu não sou membro
		Depositos: []int64{13, 14},
	}
	if !reflect.DeepEqual(e, quer) {
		t.Fatalf("escopo =\n%+v\nesperava\n%+v", e, quer)
	}
	// sem perfil: ativo (conta_ativa() dá true), nada mais; outra pessoa não vaza para mim
	sem, err := CarregarEscopo(ctx, p, "11111111-0000-4000-a000-000000000009")
	if err != nil || sem.TemPerfil || !sem.Ativo || len(sem.Vinculos) != 0 || sem.TodasContas || len(sem.Canais) != 0 {
		t.Fatalf("sem perfil = %+v %v", sem, err)
	}
	p.Exec(ctx, `update profiles set disabled = true, permissions = '["meta.opr", 3]' where id = '`+eu+`'`)
	e, _ = CarregarEscopo(ctx, p, eu)
	if e.Ativo || !e.Chaves["meta.opr"] || len(e.Acoes) != 0 {
		t.Fatalf("desativado com permissions-lista = %+v", e)
	}
	o, _ := CarregarEscopo(ctx, p, outra)
	if !o.TodasContas || o.Papel != "admin" || !reflect.DeepEqual(o.Vinculos, map[string][]string{t2: {"gestor"}}) || len(o.Depositos) != 1 {
		t.Fatalf("outra = %+v", o)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/autz/ 2>&1 | tail -3`
Expected: FAIL de compilação (`undefined: CarregarEscopo`, `undefined: Escopo`).

- [ ] **Step 3: Implementar**

Crie `api/internal/autz/escopo.go`:

```go
// Package autz decide, em Go, o que cada pessoa lê e grava nas tabelas que as policies RLS
// de produção protegiam (spec §5: sem RLS, autorização em código, as MESMAS permissões).
// O catálogo de produção (catalogo-policies-producao.json, embutido) é a especificação: cada
// policy é compilada num predicado deste pacote, e o teste de contrato compara o predicado
// com a própria RLS do Postgres rodando a policy verbatim.
package autz

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"
)

// Banco é o que CarregarEscopo e Conferir precisam: *pgxpool.Pool e pgx.Tx servem.
type Banco interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// SuperAdminsPorEmail é a lista cravada em public.is_superadmin() de produção (que confere
// e-mail, NÃO a coluna profiles.is_superadmin). O teste de contrato roda a função de produção:
// se a lista mudar lá, o teste falha aqui.
var SuperAdminsPorEmail = []string{"erick@rbvcompany.com", "gabriel.gertrudes@rbvcompany.com", "breno@rbvcompany.com"}

// Escopo é tudo o que as policies liam sobre quem pede, carregado uma vez por requisição.
// Os nomes seguem as funções SQL que eles substituem.
type Escopo struct {
	ID          string
	TemPerfil   bool                // existe linha em profiles
	Ativo       bool                // conta_ativa(): sem perfil conta como ativo (coalesce(..., true))
	Email       string              // profiles.email (is_superadmin() confere a lista)
	Papel       string              // profiles.role
	SuperFicha  bool                // profiles.is_superadmin (superadmin_pela_ficha)
	Modulos     []string            // profiles.features
	Chaves      map[string]bool     // chaves do objeto profiles.permissions (operador ? do jsonb)
	Acoes       map[string][]string // permissions[chave] quando é array: os textos dele
	SemTrava    bool                // tem perfil e escopo_por_equipe = false
	TodasContas bool                // allowed_accounts nulo
	Contas      []string            // allowed_accounts::text[]
	Vinculos    map[string][]string // meus_vinculos(): equipe -> papéis (inclui a supervisora de grupo)
	Diretos     map[string][]string // equipes_membros do próprio: equipe -> papéis
	Canais      []int64             // pode_ver_canal: canal das equipes dos vínculos + lojas dos grupos supervisionados
	Locais      []string            // pode_ver_bem: local_id das equipes dos vínculos
	Pessoas     []string            // pode_ver_bem: acessos_pessoas com profile_id = eu
	Depositos   []int64             // pode_ver_estoque
	Grupos      []string            // pode_ver_grupo: canais_grupos_membros (qualquer papel)
}

func (e *Escopo) Modulo(m string) bool { return slices.Contains(e.Modulos, m) }

func (e *Escopo) Equipes() []string {
	out := make([]string, 0, len(e.Vinculos))
	for id := range e.Vinculos {
		out = append(out, id)
	}
	slices.Sort(out)
	return out
}

func (e *Escopo) temPapel(equipe string, papeis ...string) bool {
	for _, p := range e.Vinculos[equipe] {
		if slices.Contains(papeis, p) {
			return true
		}
	}
	return false
}

// CarregarEscopo lê o escopo de usuarioID. Falta de dado nunca amplia: sem perfil = nenhum
// papel, nenhum módulo, nenhuma conta; vínculos sempre filtrados por profile_id = usuarioID.
func CarregarEscopo(ctx context.Context, b Banco, usuarioID string) (*Escopo, error) {
	e := &Escopo{ID: usuarioID, Ativo: true, Chaves: map[string]bool{}, Acoes: map[string][]string{},
		Vinculos: map[string][]string{}, Diretos: map[string][]string{}}
	var perm []byte
	var desativado, porEquipe bool
	var contas []string
	err := b.QueryRow(ctx, `select coalesce(email, ''), coalesce(role::text, ''), coalesce(is_superadmin, false),
	        coalesce(disabled, false), coalesce(escopo_por_equipe, false),
	        coalesce(array_remove(features, null), '{}'::text[]), coalesce(permissions, '{}'::jsonb),
	        allowed_accounts::text[]
	   from profiles where id = $1::uuid`, usuarioID).
		Scan(&e.Email, &e.Papel, &e.SuperFicha, &desativado, &porEquipe, &e.Modulos, &perm, &contas)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// sem perfil: Ativo (coalesce true), nada mais
	case err != nil:
		return nil, err
	default:
		e.TemPerfil, e.Ativo, e.SemTrava = true, !desativado, !porEquipe
		e.TodasContas, e.Contas = contas == nil, contas
		lerPermissoes(perm, e)
	}

	// meus_vinculos(): os vínculos diretos + 'supervisora' em toda equipe cujo canal é loja de
	// um grupo em que sou supervisora (canais_grupos_membros).
	linhas, err := b.Query(ctx, `select m.equipe_id::text, coalesce(m.papel, ''), true
	     from equipes_membros m where m.profile_id = $1::uuid
	   union
	   select e.id::text, 'supervisora', false
	     from canais_grupos_membros gm
	     join bling_lojas bl on bl.grupo_id = gm.grupo_id
	     join equipes e on e.canal_loja_id = bl.loja_id
	    where gm.profile_id = $1::uuid and gm.papel = 'supervisora'`, usuarioID)
	if err != nil {
		return nil, err
	}
	var equipe, papel string
	var direto bool
	if _, err := pgx.ForEachRow(linhas, []any{&equipe, &papel, &direto}, func() error {
		e.Vinculos[equipe] = acrescentar(e.Vinculos[equipe], papel)
		if direto {
			e.Diretos[equipe] = acrescentar(e.Diretos[equipe], papel)
		}
		return nil
	}); err != nil {
		return nil, err
	}

	if err := b.QueryRow(ctx, `select
	    coalesce((select array_agg(distinct x) from (
	        select e.canal_loja_id as x from equipes e where e.id::text = any($2::text[]) and e.canal_loja_id is not null
	        union
	        select bl.loja_id from canais_grupos_membros gm join bling_lojas bl on bl.grupo_id = gm.grupo_id
	         where gm.profile_id = $1::uuid and gm.papel = 'supervisora') c), '{}'::bigint[]),
	    coalesce((select array_agg(distinct e.local_id::text) from equipes e
	               where e.id::text = any($2::text[]) and e.local_id is not null), '{}'::text[]),
	    coalesce((select array_agg(ap.id::text) from acessos_pessoas ap where ap.profile_id = $1::uuid), '{}'::text[]),
	    coalesce((select array_agg(distinct gm.grupo_id::text) from canais_grupos_membros gm
	               where gm.profile_id = $1::uuid and gm.grupo_id is not null), '{}'::text[])`,
		usuarioID, e.Equipes()).Scan(&e.Canais, &e.Locais, &e.Pessoas, &e.Grupos); err != nil {
		return nil, err
	}

	// pode_ver_estoque: depósito de equipe em que sou supervisora/gestor (pelos vínculos) OU
	// em que tenho a chave 'estoque' em equipes_permissoes E sou membro direto.
	var comEstoque []string
	if err := b.QueryRow(ctx, `select coalesce(array_agg(distinct p.equipe_id::text), '{}'::text[]) from equipes_permissoes p
	   where p.profile_id = $1::uuid and p.chave = 'estoque'`, usuarioID).Scan(&comEstoque); err != nil {
		return nil, err
	}
	linhas, err = b.Query(ctx, `select e.id::text, e.deposito_id from equipes e where e.deposito_id is not null`)
	if err != nil {
		return nil, err
	}
	var dep int64
	vistos := map[int64]bool{}
	if _, err := pgx.ForEachRow(linhas, []any{&equipe, &dep}, func() error {
		ok := e.temPapel(equipe, "supervisora", "gestor") || (slices.Contains(comEstoque, equipe) && len(e.Diretos[equipe]) > 0)
		if ok && !vistos[dep] {
			vistos[dep] = true
			e.Depositos = append(e.Depositos, dep)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	slices.Sort(e.Depositos)
	return e, nil
}

func acrescentar(l []string, v string) []string {
	if slices.Contains(l, v) {
		return l
	}
	return append(l, v)
}

// lerPermissoes é tolerante como o banco: permissions array só serve ao operador ? (casa
// os elementos texto) e escalar não dá chave nenhuma (o vessel_pode exige objeto); valor que não é array conta para o operador ? mas não tem
// ações; dentro do array só textos contam (o ? do jsonb só casa elemento texto).
func lerPermissoes(bruto []byte, e *Escopo) {
	var obj map[string]json.RawMessage
	if json.Unmarshal(bruto, &obj) != nil {
		// array: o ? do jsonb casa os elementos texto (nenhuma ação: vessel_pode exige objeto)
		var lista []any
		json.Unmarshal(bruto, &lista)
		for _, x := range lista {
			if s, ok := x.(string); ok {
				e.Chaves[s] = true
			}
		}
		return
	}
	for k, v := range obj {
		e.Chaves[k] = true
		var lista []any
		if json.Unmarshal(v, &lista) != nil {
			continue
		}
		acoes := []string{}
		for _, x := range lista {
			if s, ok := x.(string); ok {
				acoes = append(acoes, s)
			}
		}
		e.Acoes[k] = acoes
	}
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l ./internal && go vet ./internal/autz/ && go test -v -run CarregarEscopo ./internal/autz/ 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: `--- PASS: TestCarregarEscopo`, `ok`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/autz/escopo.go api/internal/autz/escopo_test.go api/internal/testebanco/testebanco.go
git commit -m "feat(api): autz.Escopo lê uma vez o que as policies liam sobre quem pede

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: `autz` — compilar o catálogo de produção em predicados e filtros SQL

**Revisor:** **opus** (é a regra de permissão de 144 tabelas).

O catálogo (`docs/migracao-go/catalogo-policies-producao.json`) é copiado para dentro do pacote e embutido. `Compilar` normaliza cada expressão (espaços), divide `OR`/`AND` no nível zero de parênteses e casa cada átomo com uma das formas conhecidas; forma desconhecida = erro (a API não sobe). Policies só de `anon` ou só de `service_role` ficam de fora (nunca valem para uma sessão da API); `auth.role() = 'service_role'` vira `false`. A regra de uma tabela×operação segue o Postgres: (OU das permissivas) E (todas as restritivas); sem permissiva = nega; `Editar` e `Apagar` exigem também a regra de `Ler` (o UPDATE/DELETE com WHERE lê a linha); `ALL` sem WITH CHECK usa o USING. Cada predicado devolve uma constante (`true`/`false`, decidida em Go) ou uma condição sobre a linha com os valores do ator em parâmetros nomeados `@autz_<alias>_<op>_<n>::<tipo>` (dois filtros na mesma consulta nunca colidem). As subconsultas das policies que leem `profiles` passam pela RLS de `profiles` em produção: por isso "perfil com papel/super/módulo" e o `COALESCE((select is_superadmin …))` exigem a conta ativa (achado do oráculo, Task 4). Os portões de RPC (`autz.Regra`) ficam no mesmo arquivo dos átomos.

**Files:**
- Create: `api/internal/autz/catalogo-policies-producao.json` (cópia)
- Create: `api/internal/autz/predicados.go`, `api/internal/autz/catalogo.go`, `api/internal/autz/filtro.go`
- Test: `api/internal/autz/catalogo_test.go`

**Interfaces:**
- Consumes: `Escopo` (Task 2).
- Produces:
  - `type autz.Op int` com `Ler, Criar, Editar, EditarNova, Apagar` e `String()`.
  - `type autz.Catalogo`; `autz.Compilar(bruto []byte) (*Catalogo, error)`; `var autz.Producao *Catalogo`; `autz.CatalogoJSON() []byte`; `(*Catalogo).Tabelas() []string`, `Tem(tab string) bool`, `Filtro(e *Escopo, tab string, op Op, alias string) (Filtro, error)`.
  - `type autz.Filtro struct { SQL string; Args pgx.NamedArgs; Alias string }` com `Nega() bool` e `Juntar(args pgx.NamedArgs) pgx.NamedArgs`; `autz.Conferir(ctx, b Banco, f Filtro, tab string, linha map[string]any) (bool, error)`.
  - `var autz.ErrRecursoDesconhecido`, `autz.ErrNegado`; `var autz.FerramentasVessel []string`.
  - `type autz.Regra func(*Escopo) bool`; `autz.FrotaAdmin, AcessosAdmin, PatrimonioAdmin, VesselAdmin, VesselLeads, PodeVerVendas, SuperFicha, SuperEmail, PodeAprovarFrota, PodeCadastrarPessoaRapida, VesselAtendimentos, VesselAtendimentosEditar`; `autz.VesselPode(f, n string) (Regra, error)`.

- [ ] **Step 1: Escrever os testes que falham**

```bash
cp docs/migracao-go/catalogo-policies-producao.json api/internal/autz/catalogo-policies-producao.json
```

Crie `api/internal/autz/catalogo_test.go`:

```go
package autz

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestCatalogoEmbutidoIgualAoDosDocs(t *testing.T) {
	docs, err := os.ReadFile("../../../docs/migracao-go/catalogo-policies-producao.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(docs, catalogoProducao) {
		t.Fatal("api/internal/autz/catalogo-policies-producao.json difere de docs/migracao-go/: copie o dos docs")
	}
}

func TestCatalogoDeProducaoCompilaInteiro(t *testing.T) {
	if n := len(Producao.Tabelas()); n != 144 {
		t.Fatalf("tabelas = %d, esperava 144", n)
	}
}

// Forma que o pacote não conhece NUNCA vira liberado: a compilação falha.
func TestFormaDesconhecidaFalha(t *testing.T) {
	for _, expr := range []string{
		`is_dono_de_tudo()`, `(auth.role() = 'anon'::text)`, `vessel_pode('atendimentos'::text, 'apagar'::text)`,
		`vessel_pode('outra'::text, 'ver'::text)`, `(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.email ~~ '%@rbv%'::text))))`,
		`(true OR is_hacker())`,
	} {
		j := `[{"tabela":"t","nome":"n","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":` + strings.ReplaceAll(`"`+expr+`"`, `'`, `'`) + `,"withCheck":null}]`
		if _, err := Compilar([]byte(j)); err == nil {
			t.Errorf("%s compilou", expr)
		}
	}
}

// O SQL do filtro: constante quando só depende de quem pede; com a linha, parâmetros nomeados
// com cast e prefixo por alias×op (dois filtros na mesma consulta não colidem); entrada ruim nega.
func TestFiltroFormaDoSQL(t *testing.T) {
	comum := &Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, Papel: "viewer", SemTrava: true}
	frota := &Escopo{ID: comum.ID, TemPerfil: true, Ativo: true, Modulos: []string{"frota"}}
	contas := &Escopo{ID: comum.ID, TemPerfil: true, Ativo: true, Contas: []string{"A1"}}
	casos := []struct {
		e     *Escopo
		tab   string
		op    Op
		sql   string
		nArgs int
	}{
		{comum, "frota_veiculos", Ler, "false", 0},
		{frota, "frota_veiculos", Ler, "true", 0},
		{frota, "frota_requisicoes", Criar, `("v"."criada_por" = @autz_v_1_1::uuid)`, 1},
		{contas, "campaigns", Ler, `("v"."account_id" is null or "v"."account_id"::text = any(@autz_v_0_1::text[]))`, 1},
		{comum, "push_subs", Apagar, `(("v"."user_id" = @autz_v_4_1::uuid) and ("v"."user_id" = @autz_v_4_2::uuid))`, 2},
	}
	for _, c := range casos {
		f, err := Producao.Filtro(c.e, c.tab, c.op, "v")
		if err != nil || f.SQL != c.sql || len(f.Args) != c.nArgs {
			t.Errorf("%s×%s = %q %v (%d args)", c.tab, c.op, f.SQL, err, len(f.Args))
		}
	}
	for nome, chamar := range map[string]func() (Filtro, error){
		"tabela fora":   func() (Filtro, error) { return Producao.Filtro(comum, "tabela_que_nao_existe", Ler, "v") },
		"sem escopo":    func() (Filtro, error) { return Producao.Filtro(nil, "push_subs", Ler, "v") },
		"alias injeção": func() (Filtro, error) { return Producao.Filtro(comum, "push_subs", Ler, `v" or true --`) },
	} {
		if f, err := chamar(); err == nil || !f.Nega() {
			t.Errorf("%s: %q %v", nome, f.SQL, err)
		}
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/autz/ 2>&1 | tail -3`
Expected: FAIL de compilação (`undefined: catalogoProducao`, `undefined: Producao`, `undefined: Compilar`).

- [ ] **Step 3: Implementar**

Crie `api/internal/autz/predicados.go`:

```go
package autz

import (
	"fmt"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
)

// pred é uma condição de policy traduzida. sql devolve a condição sobre a linha `alias`;
// quando não depende da linha, devolve a constante "true" ou "false" (decidida em Go). Os
// valores do ator entram como parâmetros nomeados (@autz_<alias>_<op>_N) com cast explícito.
type pred interface {
	sql(e *Escopo, alias string, a *argumentos) string
}

type argumentos struct {
	prefixo string // autz_<alias>_<op>_: dois filtros na mesma consulta nunca colidem
	n       int
	v       pgx.NamedArgs
}

func (a *argumentos) novo(valor any, tipo string) string {
	a.n++
	nome := fmt.Sprintf("%s%d", a.prefixo, a.n)
	a.v[nome] = valor
	return "@" + nome + "::" + tipo
}

func constante(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// predAtor: condição que só depende de quem pede.
type predAtor func(e *Escopo) bool

func (p predAtor) sql(e *Escopo, _ string, _ *argumentos) string { return constante(p(e)) }

// predLinha: condição sobre colunas da linha.
type predLinha func(e *Escopo, alias string, a *argumentos) string

func (p predLinha) sql(e *Escopo, alias string, a *argumentos) string { return p(e, alias, a) }

type ou []pred
type e_ []pred

func (l ou) sql(e *Escopo, alias string, a *argumentos) string {
	var partes []string
	for _, p := range l {
		switch s := p.sql(e, alias, a); s {
		case "true":
			return "true"
		case "false":
		default:
			partes = append(partes, s)
		}
	}
	return juntar(partes, " or ", "false")
}

func (l e_) sql(e *Escopo, alias string, a *argumentos) string {
	var partes []string
	for _, p := range l {
		switch s := p.sql(e, alias, a); s {
		case "false":
			return "false"
		case "true":
		default:
			partes = append(partes, s)
		}
	}
	return juntar(partes, " and ", "true")
}

func juntar(partes []string, op, vazio string) string {
	switch len(partes) {
	case 0:
		return vazio
	case 1:
		return partes[0]
	}
	return "(" + strings.Join(partes, op) + ")"
}

func col(alias, c string) string { return pgx.Identifier{alias, c}.Sanitize() }

// ---- os átomos: um por função/forma que as policies de produção usam ----

var (
	sempre = predAtor(func(*Escopo) bool { return true })
	nunca  = predAtor(func(*Escopo) bool { return false })

	// is_frota_admin(): conta_ativa() and ('frota' = any(features) or is_superadmin)
	frotaAdmin = predAtor(func(e *Escopo) bool { return e.Ativo && (e.Modulo("frota") || e.SuperFicha) })
	// is_acessos_admin(): conta_ativa() and exists(perfil com role admin ou 'acessos' em features)
	acessosAdmin = predAtor(func(e *Escopo) bool { return e.Ativo && e.TemPerfil && (e.Papel == "admin" || e.Modulo("acessos")) })
	// is_patrimonio_admin(): idem com 'patrimonio'
	patrimonioAdmin = predAtor(func(e *Escopo) bool { return e.Ativo && e.TemPerfil && (e.Papel == "admin" || e.Modulo("patrimonio")) })
	// is_vessel_admin(): conta_ativa() and ('autenticidade' em features or is_superadmin)
	vesselAdmin = predAtor(func(e *Escopo) bool { return e.Ativo && (e.Modulo("autenticidade") || e.SuperFicha) })
	// is_vessel_leads(): SEM conta_ativa ('meta.leads' em features or is_superadmin)
	vesselLeads = predAtor(func(e *Escopo) bool { return e.Modulo("meta.leads") || e.SuperFicha })
	// pode_ver_vendas(): conta_ativa() and (role admin or is_superadmin or 'sales' em features)
	podeVerVendas = predAtor(func(e *Escopo) bool { return e.Ativo && (e.Papel == "admin" || e.SuperFicha || e.Modulo("sales")) })
	// superadmin_pela_ficha() (security definer): SEM conta_ativa
	superFicha = predAtor(func(e *Escopo) bool { return e.SuperFicha })
	// COALESCE((select is_superadmin from profiles ...), false): a subconsulta passa pela RLS
	// de profiles, então a conta desativada lê NULL (= false)
	superFichaVisivel = predAtor(func(e *Escopo) bool { return e.SuperFicha && e.Ativo })
	// is_superadmin(): conta_ativa() and e-mail na lista cravada
	superEmail = predAtor(func(e *Escopo) bool { return e.Ativo && slices.Contains(SuperAdminsPorEmail, e.Email) })
	// conta_ativa()
	contaAtiva = predAtor(func(e *Escopo) bool { return e.Ativo })
)

// perfilCom: EXISTS(select 1 from profiles p where p.id = auth.uid() and (<termos em OU>)).
// A subconsulta da policy roda COM a RLS de profiles (auth_read_profiles: autenticado e
// conta_ativa()): a conta desativada não enxerga o próprio perfil, então nada passa.
func perfilCom(termos ...predAtor) pred {
	return predAtor(func(e *Escopo) bool {
		if !e.TemPerfil || !e.Ativo {
			return false
		}
		for _, t := range termos {
			if t(e) {
				return true
			}
		}
		return false
	})
}

func termoPapel(p string) predAtor  { return func(e *Escopo) bool { return e.Papel == p } }
func termoModulo(m string) predAtor { return func(e *Escopo) bool { return e.Modulo(m) } }
func termoChave(k string) predAtor  { return func(e *Escopo) bool { return e.Chaves[k] } }
func termoSuper() predAtor          { return func(e *Escopo) bool { return e.SuperFicha } }
func papelAtivo(p string) pred {
	return predAtor(func(e *Escopo) bool { return e.Ativo && e.Papel == p })
}
func papelDiretoEmAlguma(p string) pred {
	return predAtor(func(e *Escopo) bool {
		for _, ps := range e.Diretos {
			if slices.Contains(ps, p) {
				return true
			}
		}
		return false
	})
}

// FerramentasVessel é a lista fechada de public.vessel_pode (nome desconhecido lá é exceção).
var FerramentasVessel = []string{"atendimentos", "atendimentos.beauty-sessions", "atendimentos.private-edit",
	"atendimentos.stylist-circle", "atendimentos.material-grafico", "atendimentos.pracas", "atendimentos.edicoes"}

// vesselPode(f, n): conta_ativa() and (is_superadmin or permissions[f] é array com 'ver' e,
// se n = 'editar', também 'editar').
func vesselPode(f, n string) (pred, error) {
	if !slices.Contains(FerramentasVessel, f) || (n != "ver" && n != "editar") || (f == "atendimentos.material-grafico" && n != "ver") {
		return nil, fmt.Errorf("vessel_pode(%q, %q) fora da lista fechada", f, n)
	}
	return predAtor(func(e *Escopo) bool {
		if !e.Ativo {
			return false
		}
		if e.SuperFicha {
			return true
		}
		acoes, ok := e.Acoes[f]
		return ok && slices.Contains(acoes, "ver") && (n == "ver" || slices.Contains(acoes, n))
	}), nil
}

// dono(c): auth.uid() = <c> (coluna nula nunca casa).
func dono(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		return "(" + col(alias, c) + " = " + a.novo(e.ID, "uuid") + ")"
	})
}

// podeVerConta(c): conta_ativa() and exists(perfil com role admin, is_superadmin,
// allowed_accounts nulo, conta nula ou conta em allowed_accounts::text[]).
func podeVerConta(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		if !e.Ativo || !e.TemPerfil {
			return "false"
		}
		if e.Papel == "admin" || e.SuperFicha || e.TodasContas {
			return "true"
		}
		x := col(alias, c)
		return "(" + x + " is null or " + x + "::text = any(" + a.novo(nn(e.Contas), "text[]") + "))"
	})
}

// semTravaOuSuper: o começo comum de pode_ver_canal/bem/equipe/estoque/grupo.
func semTravaOuSuper(e *Escopo) bool { return e.SuperFicha || e.SemTrava }

func podeVerCanal(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		if !e.Ativo {
			return "false"
		}
		if semTravaOuSuper(e) {
			return "true"
		}
		return "(" + col(alias, c) + " = any(" + a.novo(nn(e.Canais), "bigint[]") + "))"
	})
}

func podeVerBem(cLocal, cPessoa string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		if !e.Ativo {
			return "false"
		}
		if semTravaOuSuper(e) {
			return "true"
		}
		return "(" + col(alias, cLocal) + "::text = any(" + a.novo(nn(e.Locais), "text[]") + ") or " +
			col(alias, cPessoa) + "::text = any(" + a.novo(nn(e.Pessoas), "text[]") + "))"
	})
}

// podeVerBemPeloID(c): exists(patrimonio_bens b where b.id = <c> and pode_ver_bem(b.local_id, b.pessoa_id)).
// (A subconsulta da policy passa também pela RLS de patrimonio_bens; hoje isso não muda nada,
// porque ver patrimonio_posse já exige is_patrimonio_admin, que é o Ler de patrimonio_bens.
// Se o catálogo mudar, o teste de contrato contra a RLS acusa.)
func podeVerBemPeloID(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		cond := podeVerBem("local_id", "pessoa_id").sql(e, "autz_b", a)
		if cond == "false" {
			return "false"
		}
		return "exists (select 1 from patrimonio_bens autz_b where autz_b.id = " + col(alias, c) + " and " + cond + ")"
	})
}

func podeVerEquipe(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		if !e.Ativo {
			return "false"
		}
		if semTravaOuSuper(e) {
			return "true"
		}
		return "(" + col(alias, c) + "::text = any(" + a.novo(nn(e.Equipes()), "text[]") + "))"
	})
}

func podeVerEstoque(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		if !e.Ativo {
			return "false"
		}
		if semTravaOuSuper(e) {
			return "true"
		}
		return "(" + col(alias, c) + " = any(" + a.novo(nn(e.Depositos), "bigint[]") + "))"
	})
}

func podeVerGrupo(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		if !e.Ativo {
			return "false"
		}
		if semTravaOuSuper(e) {
			return "true"
		}
		return "(" + col(alias, c) + "::text = any(" + a.novo(nn(e.Grupos), "text[]") + "))"
	})
}

// papelNaEquipe(c, papeis): tenho_papel_na_equipe(<c>, papeis), pelos vínculos (sem conta_ativa).
func papelNaEquipe(c string, papeis ...string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		var ids []string
		for _, id := range e.Equipes() {
			if e.temPapel(id, papeis...) {
				ids = append(ids, id)
			}
		}
		if len(ids) == 0 {
			return "false"
		}
		return "(" + col(alias, c) + "::text = any(" + a.novo(ids, "text[]") + "))"
	})
}

// gestorDaEquipe(c): sou_gestor_da_equipe = is_superadmin (ficha) or tenho_papel(c, gestor).
func gestorDaEquipe(c string) pred { return ou{superFicha, papelNaEquipe(c, "gestor")} }

// nn: nunca mandar NULL no lugar de lista (any(NULL) dá NULL, e NULL num OR esconderia erro).
func nn[T any](l []T) []T {
	if l == nil {
		return []T{}
	}
	return l
}

// ---- portões de RPC (sub-planos): as checagens que as funções de produção fazem no começo ----

// Regra decide só por quem pede (portão de rota/RPC).
type Regra func(e *Escopo) bool

var (
	FrotaAdmin      = Regra(frotaAdmin)
	AcessosAdmin    = Regra(acessosAdmin)
	PatrimonioAdmin = Regra(patrimonioAdmin)
	VesselAdmin     = Regra(vesselAdmin)
	VesselLeads     = Regra(vesselLeads)
	PodeVerVendas   = Regra(podeVerVendas)
	SuperFicha      = Regra(superFicha)
	SuperEmail      = Regra(superEmail)
	// pode_aprovar_frota(): conta_ativa() and ('frota.aprovar' em features or is_superadmin)
	PodeAprovarFrota = Regra(func(e *Escopo) bool { return e.Ativo && (e.Modulo("frota.aprovar") || e.SuperFicha) })
	// pode_cadastrar_pessoa_rapida(): is_acessos_admin() or is_patrimonio_admin() or is_frota_admin()
	PodeCadastrarPessoaRapida = Regra(func(e *Escopo) bool { return acessosAdmin(e) || patrimonioAdmin(e) || frotaAdmin(e) })
	// is_vessel_atendimentos(): conta_ativa() and (is_superadmin or algum módulo 'atendimentos' ou 'atendimentos.*')
	VesselAtendimentos = Regra(func(e *Escopo) bool {
		return e.Ativo && (e.SuperFicha || slices.ContainsFunc(e.Modulos, ehAtendimentos))
	})
	// is_vessel_atendimentos_editar(): o de cima e (is_superadmin or alguma chave 'atendimentos'
	// ou 'atendimentos.*' de permissions-objeto cujo array tem 'editar')
	VesselAtendimentosEditar = Regra(func(e *Escopo) bool {
		if !VesselAtendimentos(e) {
			return false
		}
		if e.SuperFicha {
			return true
		}
		for k, acoes := range e.Acoes {
			if ehAtendimentos(k) && slices.Contains(acoes, "editar") {
				return true
			}
		}
		return false
	})
)

func ehAtendimentos(s string) bool {
	return s == "atendimentos" || strings.HasPrefix(s, "atendimentos.")
}

// VesselPode é vessel_pode(f, n) como portão; nome fora da lista fechada = erro (a função de
// produção levanta exceção).
func VesselPode(f, n string) (Regra, error) {
	p, err := vesselPode(f, n)
	if err != nil {
		return nil, err
	}
	return Regra(p.(predAtor)), nil
}
```

Crie `api/internal/autz/catalogo.go`:

```go
package autz

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// Cópia de docs/migracao-go/catalogo-policies-producao.json (o go:embed não sai do pacote);
// TestCatalogoEmbutidoIgualAoDosDocs prende as duas cópias.
//
//go:embed catalogo-policies-producao.json
var catalogoProducao []byte

// CatalogoJSON devolve o catálogo de produção cru (o oráculo do teste cria as policies dele).
func CatalogoJSON() []byte { return catalogoProducao }

// Op é a operação pedida numa tabela, com a semântica do Postgres para RLS.
type Op int

const (
	Ler        Op = iota // USING das policies de select/all
	Criar                // WITH CHECK das de insert/all (ALL sem check usa o USING)
	Editar               // linha ANTIGA: Ler e USING das de update/all (o UPDATE com WHERE lê a linha)
	EditarNova           // linha NOVA: WITH CHECK das de update/all (sem check usa o USING)
	Apagar               // Ler e USING das de delete/all
)

func (o Op) String() string { return [...]string{"ler", "criar", "editar", "editar-nova", "apagar"}[o] }

var ErrRecursoDesconhecido = errors.New("autz: tabela fora do catálogo")

type policy struct {
	nome, comando string
	restritiva    bool
	using, check  pred // nil = cláusula ausente
}

type tabela struct{ policies []policy }

// Catalogo é o conjunto de policies compiladas, por tabela.
type Catalogo struct{ tabelas map[string]*tabela }

type policyJSON struct {
	Tabela, Nome, Tipo, Comando string
	Papeis                      []string
	Using, WithCheck            *string
}

// Producao é o catálogo de produção compilado. Falha de compilação derruba a API na subida
// (e o teste): policy com forma que este pacote não conhece nunca vira "liberado".
var Producao = func() *Catalogo {
	c, err := Compilar(catalogoProducao)
	if err != nil {
		panic(err)
	}
	return c
}()

// Compilar lê o JSON do catálogo. Policies que não valem para sessão de pessoa (só anon ou só
// service_role) ficam de fora: nunca liberam nada à API autenticada.
func Compilar(bruto []byte) (*Catalogo, error) {
	var lista []policyJSON
	if err := json.Unmarshal(bruto, &lista); err != nil {
		return nil, err
	}
	c := &Catalogo{tabelas: map[string]*tabela{}}
	for _, p := range lista {
		t := c.tabelas[p.Tabela]
		if t == nil {
			t = &tabela{}
			c.tabelas[p.Tabela] = t
		}
		if !slices.Contains(p.Papeis, "authenticated") && !slices.Contains(p.Papeis, "public") {
			continue
		}
		if !slices.Contains([]string{"select", "insert", "update", "delete", "all"}, p.Comando) || (p.Tipo != "permissive" && p.Tipo != "restrictive") {
			return nil, fmt.Errorf("%s.%s: comando/tipo desconhecido %q/%q", p.Tabela, p.Nome, p.Comando, p.Tipo)
		}
		pol := policy{nome: p.Nome, comando: p.Comando, restritiva: p.Tipo == "restrictive"}
		var err error
		if p.Using != nil {
			if pol.using, err = c.analisar(normalizar(*p.Using)); err != nil {
				return nil, fmt.Errorf("%s.%s (using): %w", p.Tabela, p.Nome, err)
			}
		}
		if p.WithCheck != nil {
			if pol.check, err = c.analisar(normalizar(*p.WithCheck)); err != nil {
				return nil, fmt.Errorf("%s.%s (with check): %w", p.Tabela, p.Nome, err)
			}
		}
		t.policies = append(t.policies, pol)
	}
	return c, nil
}

// Tabelas devolve os nomes do catálogo, em ordem.
func (c *Catalogo) Tabelas() []string {
	out := make([]string, 0, len(c.tabelas))
	for n := range c.tabelas {
		out = append(out, n)
	}
	slices.Sort(out)
	return out
}

func (c *Catalogo) Tem(tab string) bool { return c.tabelas[tab] != nil }

// regra devolve o predicado combinado de tab×op: (OU das permissivas) E (todas as restritivas).
// Sem permissiva aplicável = nega (RLS ligado sem policy).
func (c *Catalogo) regra(tab string, op Op) (pred, error) {
	t := c.tabelas[tab]
	if t == nil {
		return nil, fmt.Errorf("%w: %q", ErrRecursoDesconhecido, tab)
	}
	combinar := func(comandos []string, clausula func(policy) pred) pred {
		var perm ou
		var restr e_
		for _, p := range t.policies {
			if !slices.Contains(comandos, p.comando) {
				continue
			}
			x := clausula(p)
			if x == nil {
				continue
			}
			if p.restritiva {
				restr = append(restr, x)
			} else {
				perm = append(perm, x)
			}
		}
		if len(perm) == 0 {
			return nunca
		}
		return append(e_{perm}, restr...)
	}
	usingDe := func(p policy) pred { return p.using }
	checkDe := func(p policy) pred {
		if p.check != nil || p.comando == "insert" {
			return p.check
		}
		return p.using
	}
	ler := combinar([]string{"select", "all"}, usingDe)
	switch op {
	case Ler:
		return ler, nil
	case Criar:
		return combinar([]string{"insert", "all"}, checkDe), nil
	case Editar:
		return e_{ler, combinar([]string{"update", "all"}, usingDe)}, nil
	case EditarNova:
		return combinar([]string{"update", "all"}, checkDe), nil
	case Apagar:
		return e_{ler, combinar([]string{"delete", "all"}, usingDe)}, nil
	}
	return nil, fmt.Errorf("autz: op desconhecida %d", op)
}

// ---- análise das expressões (texto de pg_policies, verbatim) ----

func normalizar(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	return strings.NewReplacer("( ", "(", " )", ")").Replace(s)
}

// tirarParenteses remove parênteses que embrulham a expressão INTEIRA.
func tirarParenteses(s string) string {
	for strings.HasPrefix(s, "(") && strings.HasSuffix(s, ")") {
		nivel, fecha := 0, -1
		for i, emAspas := 0, false; i < len(s); i++ {
			switch {
			case s[i] == '\'':
				emAspas = !emAspas
			case emAspas:
			case s[i] == '(':
				nivel++
			case s[i] == ')':
				nivel--
				if nivel == 0 {
					fecha = i
					i = len(s)
				}
			}
		}
		if fecha != len(s)-1 {
			return s
		}
		s = s[1 : len(s)-1]
	}
	return s
}

// dividir corta s em `sep` só no nível zero de parênteses e fora de aspas.
func dividir(s, sep string) []string {
	var partes []string
	nivel, inicio, emAspas := 0, 0, false
	for i := 0; i < len(s); i++ {
		switch {
		case s[i] == '\'':
			emAspas = !emAspas
		case emAspas:
		case s[i] == '(':
			nivel++
		case s[i] == ')':
			nivel--
		case nivel == 0 && strings.HasPrefix(s[i:], sep):
			partes = append(partes, s[inicio:i])
			inicio = i + len(sep)
			i += len(sep) - 1
		}
	}
	return append(partes, s[inicio:])
}

func (c *Catalogo) analisar(s string) (pred, error) {
	s = tirarParenteses(s)
	for _, sep := range []string{" OR ", " AND "} {
		if partes := dividir(s, sep); len(partes) > 1 {
			var l []pred
			for _, p := range partes {
				x, err := c.analisar(p)
				if err != nil {
					return nil, err
				}
				l = append(l, x)
			}
			if sep == " OR " {
				return ou(l), nil
			}
			return e_(l), nil
		}
	}
	return c.atomo(s)
}

var (
	semArgs = map[string]pred{
		"true": sempre, "is_frota_admin()": frotaAdmin, "is_acessos_admin()": acessosAdmin,
		"is_patrimonio_admin()": patrimonioAdmin, "is_vessel_admin()": vesselAdmin, "is_vessel_leads()": vesselLeads,
		"pode_ver_vendas()": podeVerVendas, "superadmin_pela_ficha()": superFicha, "is_superadmin()": superEmail,
		"conta_ativa()": contaAtiva,
		"COALESCE((SELECT profiles.is_superadmin FROM profiles WHERE (profiles.id = auth.uid())), false)": superFichaVisivel,
	}
	reRole       = regexp.MustCompile(`^auth\.role\(\) = '([a-z_]+)'::text$`)
	reGetMyRole  = regexp.MustCompile(`^get_my_role\(\) = '([a-z_]+)'::text$`)
	reDono       = regexp.MustCompile(`^(?:auth\.uid\(\) = ([a-z_]+)|([a-z_]+) = auth\.uid\(\))$`)
	reUmaColuna  = regexp.MustCompile(`^(pode_ver_conta|pode_ver_canal|pode_ver_equipe|pode_ver_estoque|pode_ver_grupo|sou_gestor_da_equipe)\(\(?([a-z_]+)\)?(::text)?\)$`)
	reBem        = regexp.MustCompile(`^pode_ver_bem\(([a-z_]+), ([a-z_]+)\)$`)
	reBemPeloID  = regexp.MustCompile(`^EXISTS \(SELECT 1 FROM patrimonio_bens b WHERE \(\(b\.id = [a-z_]+\.([a-z_]+)\) AND pode_ver_bem\(b\.local_id, b\.pessoa_id\)\)\)$`)
	reVesselPode = regexp.MustCompile(`^vessel_pode\('([a-z.-]+)'::text, '([a-z]+)'::text\)$`)
	rePapelEm    = regexp.MustCompile(`^tenho_papel_na_equipe\(([a-z_]+), ARRAY\[(.+)\]\)$`)
	reLiteral    = regexp.MustCompile(`^'([a-z_.-]+)'::text$`)
	rePerfil     = regexp.MustCompile(`^EXISTS \(SELECT 1 FROM profiles (?:p )?WHERE \(\((?:p|profiles)\.id = auth\.uid\(\)\) AND (.+)\)\)$`)
	reMembro     = regexp.MustCompile(`^EXISTS \(SELECT 1 FROM equipes_membros m WHERE \(\(m\.profile_id = auth\.uid\(\)\) AND \(m\.papel = '([a-z_]+)'::text\)\)\)$`)
	reTermo      = map[string]*regexp.Regexp{
		"papel": regexp.MustCompile(`^p\.role = '([a-z_]+)'::text$`), "modulo": regexp.MustCompile(`^'([a-z_.-]+)'::text = ANY \(p\.features\)$`),
		"chave": regexp.MustCompile(`^p\.permissions \? '([a-z_.-]+)'::text$`),
	}
)

func (c *Catalogo) atomo(s string) (pred, error) {
	if p, ok := semArgs[s]; ok {
		return p, nil
	}
	if m := reRole.FindStringSubmatch(s); m != nil {
		switch m[1] {
		case "authenticated":
			return sempre, nil
		case "service_role":
			return nunca, nil // só a chave de serviço do Supabase; nenhuma sessão da API é isso
		}
	}
	if m := reGetMyRole.FindStringSubmatch(s); m != nil {
		return papelAtivo(m[1]), nil
	}
	if m := reDono.FindStringSubmatch(s); m != nil {
		return dono(m[1] + m[2]), nil
	}
	if m := reUmaColuna.FindStringSubmatch(s); m != nil {
		return map[string]func(string) pred{"pode_ver_conta": podeVerConta, "pode_ver_canal": podeVerCanal,
			"pode_ver_equipe": podeVerEquipe, "pode_ver_estoque": podeVerEstoque, "pode_ver_grupo": podeVerGrupo,
			"sou_gestor_da_equipe": gestorDaEquipe}[m[1]](m[2]), nil
	}
	if m := reBem.FindStringSubmatch(s); m != nil {
		return podeVerBem(m[1], m[2]), nil
	}
	if m := reBemPeloID.FindStringSubmatch(s); m != nil {
		return podeVerBemPeloID(m[1]), nil
	}
	if m := reVesselPode.FindStringSubmatch(s); m != nil {
		return vesselPode(m[1], m[2])
	}
	if m := reMembro.FindStringSubmatch(s); m != nil {
		return papelDiretoEmAlguma(m[1]), nil
	}
	if m := rePapelEm.FindStringSubmatch(s); m != nil {
		var papeis []string
		for _, lit := range strings.Split(m[2], ", ") {
			l := reLiteral.FindStringSubmatch(lit)
			if l == nil {
				return nil, fmt.Errorf("papel desconhecido em %q", s)
			}
			papeis = append(papeis, l[1])
		}
		return papelNaEquipe(m[1], papeis...), nil
	}
	if m := rePerfil.FindStringSubmatch(s); m != nil {
		var termos []predAtor
		for _, t := range dividir(tirarParenteses(strings.ReplaceAll(m[1], "profiles.", "p.")), " OR ") {
			t = tirarParenteses(t)
			switch {
			case t == "p.is_superadmin" || t == "p.is_superadmin = true":
				termos = append(termos, termoSuper())
			case reTermo["papel"].MatchString(t):
				termos = append(termos, termoPapel(reTermo["papel"].FindStringSubmatch(t)[1]))
			case reTermo["modulo"].MatchString(t):
				termos = append(termos, termoModulo(reTermo["modulo"].FindStringSubmatch(t)[1]))
			case reTermo["chave"].MatchString(t):
				termos = append(termos, termoChave(reTermo["chave"].FindStringSubmatch(t)[1]))
			default:
				return nil, fmt.Errorf("termo de perfil desconhecido %q", t)
			}
		}
		return perfilCom(termos...), nil
	}
	return nil, fmt.Errorf("forma desconhecida: %q", s)
}
```

Crie `api/internal/autz/filtro.go`:

```go
package autz

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
)

// Filtro é a condição SQL de uma tabela×operação para quem pede, já com os valores do ator
// em parâmetros nomeados (@autz_N, com cast). Entra no WHERE da consulta da rota.
type Filtro struct {
	SQL   string
	Args  pgx.NamedArgs
	Alias string
}

// Nega: a condição é a constante false (a rota pode responder 403 sem ir ao banco).
func (f Filtro) Nega() bool { return f.SQL == "false" }

// Filtro devolve a condição de tab×op sobre `alias`. Tabela fora do catálogo = erro (nega).
// O SQL só contém texto fixo deste pacote e o alias (citado): nada do pedido entra nele.
func (c *Catalogo) Filtro(e *Escopo, tab string, op Op, alias string) (Filtro, error) {
	nega := Filtro{SQL: "false", Args: pgx.NamedArgs{}, Alias: alias}
	if !reAlias.MatchString(alias) {
		return nega, fmt.Errorf("autz: alias inválido %q", alias)
	}
	if e == nil {
		return nega, errors.New("autz: sem escopo (a rota não passou por ComEscopo)")
	}
	p, err := c.regra(tab, op)
	if err != nil {
		return nega, err
	}
	a := &argumentos{prefixo: fmt.Sprintf("autz_%s_%d_", alias, op), v: pgx.NamedArgs{}}
	return Filtro{SQL: p.sql(e, alias, a), Args: a.v, Alias: alias}, nil
}

var reAlias = regexp.MustCompile(`^[a-z][a-z0-9_]{0,30}$`)

// Juntar copia os parâmetros do filtro em args (os nomes autz_* não colidem com os da rota).
func (f Filtro) Juntar(args pgx.NamedArgs) pgx.NamedArgs {
	for k, v := range f.Args {
		args[k] = v
	}
	return args
}

// Conferir avalia o filtro sobre uma linha que ainda não existe (insert, ou o valor novo de um
// update): monta a linha com o tipo da própria tabela (jsonb_populate_record) e roda a condição.
// Coluna que a tabela não tem é ignorada pelo Postgres; NULL na condição = negado.
func Conferir(ctx context.Context, b Banco, f Filtro, tab string, linha map[string]any) (bool, error) {
	if f.Nega() {
		return false, nil
	}
	j, err := json.Marshal(linha)
	if err != nil {
		return false, err
	}
	args := f.Juntar(pgx.NamedArgs{"autz_linha": string(j)})
	var ok *bool
	err = b.QueryRow(ctx, `select (`+f.SQL+`) from jsonb_populate_record(null::`+pgx.Identifier{tab}.Sanitize()+
		`, @autz_linha::jsonb) as `+pgx.Identifier{f.Alias}.Sanitize(), args).Scan(&ok)
	if err != nil {
		return false, err
	}
	return ok != nil && *ok, nil
}

// ErrNegado: a operação não passa na regra (a rota responde 403).
var ErrNegado = errors.New("autz: negado")
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l ./internal && go vet ./internal/autz/ && go test -v ./internal/autz/ 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: `--- PASS` em `TestCatalogoEmbutidoIgualAoDosDocs`, `TestCatalogoDeProducaoCompilaInteiro`, `TestFormaDesconhecidaFalha`, `TestFiltroFormaDoSQL` e `TestCarregarEscopo`; `ok`. (A correção das regras contra a RLS é a Task 4: aqui só a forma.)

- [ ] **Step 5: Commit**

```bash
git add api/internal/autz/
git commit -m "feat(api): autz compila as 276 policies de produção em predicados e filtros SQL

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 4: O oráculo — teste de contrato contra a RLS de produção e portões de RPC

**Revisor:** **opus** (este teste É a especificação das permissões: um mundo fraco aprovaria regra errada).

Desenho na seção II.3. `autzteste.Novo` cria um BANCO novo por teste (as funções de produção fixam `search_path = public`, então um schema por teste não serve), aplica a camada de compatibilidade (`banco.Compat`: `auth.uid()` lê `app.usuario_id`; papéis `anon`/`authenticated`/`service_role`), cria as 144 tabelas, as 25 funções verbatim, liga a RLS com as 276 policies verbatim, dá `GRANT` aos papéis e insere o mundo. O teste compara, para cada pessoa × tabela, o que o Go decide (como superusuário, sem RLS) com o que a RLS decide (`set local role authenticated`).

**Files:**
- Create: `api/internal/autz/autzteste/extrair-ajudantes.mjs`
- Create (gerado): `api/internal/autz/autzteste/ajudantes.sql`
- Create: `api/internal/autz/autzteste/mundo.go`
- Test: `api/internal/autz/contrato_test.go`, `api/internal/autz/portoes_test.go`

**Interfaces:**
- Consumes: `autz.Producao`, `autz.CatalogoJSON`, `autz.CarregarEscopo`, `autz.Conferir`, `autz.SuperAdminsPorEmail`, `autz.FerramentasVessel`, as `autz.Regra` (Task 3); `banco.Compat` (Plano 2); `banco.Configurar` (Task 1).
- Produces (para os sub-planos): `autzteste.Novo(t) *Mundo`; `type autzteste.Mundo struct { Pool *pgxpool.Pool; Personas []Persona }` com `Pessoa(nome) Persona` e `ComoPessoa(ctx, id, fn func(pgx.Tx) error) error`; `type autzteste.Persona struct { Nome, ID string }`; `autzteste.Colunas`, `autzteste.Valores`, `autzteste.DeDono`, `autzteste.DoMundo`; os ids fixos `T1..T4, TX, G1, G2, L1, L2, PE1, PE2, B1..B4`; `autzteste.Ajudantes` (o SQL das funções).

- [ ] **Step 1: Gerar as funções de produção**

Crie `api/internal/autz/autzteste/extrair-ajudantes.mjs`:

```js
// Extrai do levantamento de produção (02-funções.csv, fora do git) as funções SQL que as
// policies chamam, e as que ELAS chamam, verbatim, para o oráculo do teste de contrato.
// Uso (na raiz do repositório):
//   node api/internal/autz/autzteste/extrair-ajudantes.mjs <caminho/02-funções.csv> > api/internal/autz/autzteste/ajudantes.sql
import { readFileSync } from 'node:fs';

const [csvPath] = process.argv.slice(2);
if (!csvPath) {
  console.error('uso: extrair-ajudantes.mjs <02-funções.csv>');
  process.exit(2);
}

// CSV com campos entre aspas que atravessam linhas ("" = aspas dentro do campo).
function lerCSV(texto) {
  const linhas = [];
  let campo = '', linha = [], aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === ',') { linha.push(campo); campo = ''; }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = ''; }
    else if (c !== '\r') campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const [cab, ...linhas] = lerCSV(readFileSync(csvPath, 'utf8'));
const iNome = cab.indexOf('proname'), iDef = cab.indexOf('definicao');
const funcoes = new Map(linhas.filter((l) => l.length > iDef).map((l) => [l[iNome], l[iDef]]));

const catalogo = JSON.parse(readFileSync(new URL('../catalogo-policies-producao.json', import.meta.url), 'utf8'));
const chamadas = (texto) => [...funcoes.keys()].filter((n) => new RegExp(`\\b${n}\\(`).test(texto));

// Fechamento: as funções citadas nas policies + as que o vessel_pode e cia. chamam + as que os
// portões de RPC dos sub-planos usam (lista fixa abaixo).
const extras = ['pode_aprovar_frota', 'pode_cadastrar_pessoa_rapida', 'is_vessel_atendimentos', 'is_vessel_atendimentos_editar'];
const fila = [...new Set([...catalogo.flatMap((p) => chamadas(`${p.using ?? ''} ${p.withCheck ?? ''}`)), ...extras])];
const vistas = new Set();
while (fila.length) {
  const n = fila.shift();
  if (vistas.has(n)) continue;
  if (!funcoes.has(n)) { console.error(`função ${n} não está no CSV`); process.exit(1); }
  vistas.add(n);
  fila.push(...chamadas(funcoes.get(n)));
}

const nomes = [...vistas].sort();
process.stdout.write(
  '-- GERADO por extrair-ajudantes.mjs a partir do levantamento de produção (02-funções.csv).\n' +
  '-- NÃO EDITE À MÃO: rode o script de novo. Corpos verbatim de produção.\n' +
  `-- Funções (${nomes.length}): ${nomes.join(', ')}\n` +
  'set check_function_bodies = off;\n\n' +
  nomes.map((n) => funcoes.get(n).trim() + ';\n').join('\n'),
);
```

Rode (raiz da worktree):

```bash
node api/internal/autz/autzteste/extrair-ajudantes.mjs "/Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard/.claude/worktrees/levantamento-ro/docs/migracao-go/levantamento/02-funções.csv" > api/internal/autz/autzteste/ajudantes.sql
sed -n 3p api/internal/autz/autzteste/ajudantes.sql; wc -l < api/internal/autz/autzteste/ajudantes.sql
```

Expected: `-- Funções (25): conta_ativa, get_my_role, is_acessos_admin, is_frota_admin, is_patrimonio_admin, is_superadmin, is_vessel_admin, is_vessel_atendimentos, is_vessel_atendimentos_editar, is_vessel_leads, meus_vinculos, minhas_equipes, pode_aprovar_frota, pode_cadastrar_pessoa_rapida, pode_ver_bem, pode_ver_canal, pode_ver_conta, pode_ver_equipe, pode_ver_estoque, pode_ver_grupo, pode_ver_vendas, sou_gestor_da_equipe, superadmin_pela_ficha, tenho_papel_na_equipe, vessel_pode` e `354`. O arquivo é versionado (são corpos de função; os 3 e-mails de `is_superadmin()` já estão em `db/migrations/acessos/013_superadmin_gabriel.sql`). Não edite à mão: rode o script de novo se o levantamento for refeito.

- [ ] **Step 2: Escrever o mundo e os testes**

Crie `api/internal/autz/autzteste/mundo.go`:

```go
// Package autzteste monta o ORÁCULO do teste de contrato de permissão: um banco novo com as
// 144 tabelas do catálogo, a RLS LIGADA com as 276 policies de produção verbatim, as funções
// que elas chamam (ajudantes.sql, verbatim de produção) e um mundo de pessoas, equipes, grupos,
// lojas, locais e bens. Perguntar ao Postgres "o que esta pessoa vê/grava" com
// `set local role authenticated` é perguntar à própria RLS de produção.
package autzteste

import (
	"context"
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

//go:embed ajudantes.sql
var Ajudantes string

// Colunas que as policies leem da linha, com o tipo do oráculo. account_id é text: casa as
// duas formas do catálogo (pode_ver_conta(account_id) e pode_ver_conta((account_id)::text)).
var Colunas = []struct{ Nome, Tipo string }{
	{"account_id", "text"}, {"user_id", "uuid"}, {"criado_por", "uuid"}, {"criada_por", "uuid"},
	{"decidido_por", "uuid"}, {"quem", "uuid"}, {"profile_id", "uuid"}, {"equipe_id", "uuid"},
	{"grupo_id", "uuid"}, {"local_id", "uuid"}, {"pessoa_id", "uuid"}, {"bem_id", "uuid"},
	{"loja_id", "bigint"}, {"canal_loja_id", "bigint"}, {"deposito_id", "bigint"},
	{"papel", "text"}, {"chave", "text"},
}

// Tabelas do MUNDO: as funções das policies leem estas linhas, então o teste não gera linhas
// sintéticas nelas (mudaria quem é membro de quê); as linhas do mundo são as candidatas.
var DoMundo = map[string]bool{"profiles": true, "equipes": true, "equipes_membros": true, "equipes_permissoes": true,
	"canais_grupos_membros": true, "bling_lojas": true, "acessos_pessoas": true, "patrimonio_bens": true}

func id(prefixo string, n int) string { return fmt.Sprintf("%s-0000-4000-a000-%012d", prefixo, n) }

// Identificadores fixos do mundo.
var (
	T1, T2, T3, T4, TX = id("e0000000", 1), id("e0000000", 2), id("e0000000", 3), id("e0000000", 4), id("e0000000", 9)
	G1, G2             = id("c0000000", 1), id("c0000000", 2)
	L1, L2             = id("10c00000", 1), id("10c00000", 2)
	PE1, PE2           = id("9e000000", 1), id("9e000000", 2)
	B1, B2, B3, B4     = id("be000000", 1), id("be000000", 2), id("be000000", 3), id("be000000", 4)
)

// Valores que cada coluna assume nas linhas geradas (nil = NULL). Colunas de dono usam os ids
// das pessoas (ValoresDeDono).
var Valores = map[string][]any{
	"account_id": {"A1", "A2", nil}, "equipe_id": {T1, T2, T3, T4, TX, nil}, "grupo_id": {G1, G2, nil},
	"local_id": {L1, L2, nil}, "pessoa_id": {PE1, PE2, nil}, "bem_id": {B1, B2, B3, B4, nil},
	"loja_id": {int64(1), int64(2), int64(3), int64(4), int64(5), nil}, "canal_loja_id": {int64(1), int64(2), int64(3), int64(4), int64(5), nil},
	"deposito_id": {int64(11), int64(12), int64(13), int64(14), nil},
}

var DeDono = map[string]bool{"user_id": true, "criado_por": true, "criada_por": true, "decidido_por": true, "quem": true, "profile_id": true}

type Persona struct {
	Nome, ID string
	perfil   map[string]any // colunas de profiles; nil = sem perfil
	depois   []string       // SQL do mundo desta pessoa (%s = id)
}

type Mundo struct {
	Pool     *pgxpool.Pool // superusuário: ignora a RLS
	Personas []Persona
}

func (m *Mundo) Pessoa(nome string) Persona {
	for _, p := range m.Personas {
		if p.Nome == nome {
			return p
		}
	}
	panic("persona desconhecida: " + nome)
}

// ComoPessoa roda fn numa transação como `authenticated` com auth.uid() = id, e DESFAZ tudo.
func (m *Mundo) ComoPessoa(ctx context.Context, idPessoa string, fn func(tx pgx.Tx) error) error {
	tx, err := m.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select set_config('app.usuario_id', $1::text, true)`, idPessoa); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `set local role authenticated`); err != nil {
		return err
	}
	return fn(tx)
}

var reLiterais = map[string]*regexp.Regexp{
	"modulo": regexp.MustCompile(`'([^']+)'::text = ANY \(p\.features\)`),
	"chave":  regexp.MustCompile(`p\.permissions \? '([^']+)'::text`),
}

// personas: as fixas e uma por módulo/chave/ferramenta que o catálogo e as funções citam.
func personas(catalogo []map[string]any) []Persona {
	perfil := func(kv ...any) map[string]any {
		m := map[string]any{"role": "viewer", "permissions": map[string]any{}, "is_superadmin": false, "escopo_por_equipe": false}
		for i := 0; i+1 < len(kv); i += 2 {
			m[kv[i].(string)] = kv[i+1]
		}
		return m
	}
	ps := []Persona{
		{Nome: "sem-perfil"},
		{Nome: "comum", perfil: perfil()},
		{Nome: "admin", perfil: perfil("role", "admin")},
		{Nome: "super-ficha", perfil: perfil("is_superadmin", true)},
		{Nome: "super-email", perfil: perfil("email", autz.SuperAdminsPorEmail[0])},
		{Nome: "desativado", perfil: perfil("role", "admin", "is_superadmin", true, "disabled", true,
			"email", autz.SuperAdminsPorEmail[1], "features", []string{"frota", "acessos", "patrimonio", "autenticidade", "sales"},
			"permissions", map[string]any{"atendimentos": []string{"ver", "editar"}})},
		{Nome: "vendedora", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T1 + `', '%s', 'vendedora')`,
			`insert into acessos_pessoas (id, profile_id) values ('` + PE1 + `', '%s')`}},
		{Nome: "papel-nulo", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T1 + `', '%s', null)`}},
		{Nome: "gestor", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T2 + `', '%s', 'gestor')`}},
		{Nome: "gestor-sem-trava", perfil: perfil(), depois: []string{
			`insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T2 + `', '%s', 'gestor')`}},
		{Nome: "supervisora-time", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T3 + `', '%s', 'supervisora')`}},
		{Nome: "supervisora-grupo", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into canais_grupos_membros (grupo_id, profile_id, papel) values ('` + G1 + `', '%s', 'supervisora')`}},
		{Nome: "membro-grupo", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into canais_grupos_membros (grupo_id, profile_id, papel) values ('` + G2 + `', '%s', 'membro')`}},
		{Nome: "estoque", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into equipes_membros (equipe_id, profile_id, papel) values ('` + T4 + `', '%s', 'vendedora')`,
			`insert into equipes_permissoes (equipe_id, profile_id, chave) values ('` + T4 + `', '%s', 'estoque')`}},
		{Nome: "estoque-sem-membro", perfil: perfil("escopo_por_equipe", true), depois: []string{
			`insert into equipes_permissoes (equipe_id, profile_id, chave) values ('` + T4 + `', '%s', 'estoque')`}},
		{Nome: "sem-time", perfil: perfil("escopo_por_equipe", true)},
		{Nome: "contas-a1", perfil: perfil("allowed_accounts", []string{"A1"})},
		{Nome: "contas-vazio", perfil: perfil("allowed_accounts", []string{})},
		{Nome: "admin-contas-vazio", perfil: perfil("role", "admin", "allowed_accounts", []string{})},
		{Nome: "permissions-lista", perfil: perfil("permissions", []string{"meta.hora", "atendimentos"})},
		{Nome: "permissions-chave-nao-array", perfil: perfil("permissions", map[string]any{"meta.opr": true, "atendimentos": "ver"})},
	}
	modulos := []string{"frota", "acessos", "patrimonio", "autenticidade", "meta.leads", "sales", "frota.aprovar",
		"atendimentos", "atendimentos.pracas", "atendimentos2"}
	var chaves []string
	for _, p := range catalogo {
		texto := fmt.Sprint(p["using"], " ", p["withCheck"])
		for _, m := range reLiterais["modulo"].FindAllStringSubmatch(texto, -1) {
			modulos = append(modulos, m[1])
		}
		for _, m := range reLiterais["chave"].FindAllStringSubmatch(texto, -1) {
			chaves = append(chaves, m[1])
		}
	}
	slices.Sort(modulos)
	slices.Sort(chaves)
	for _, m := range slices.Compact(modulos) {
		ps = append(ps, Persona{Nome: "modulo:" + m, perfil: perfil("features", []string{m})})
	}
	for _, c := range slices.Compact(chaves) {
		ps = append(ps, Persona{Nome: "chave:" + c, perfil: perfil("permissions", map[string]any{c: []string{"ver"}})})
	}
	for _, f := range autz.FerramentasVessel {
		ps = append(ps,
			Persona{Nome: "vessel:" + f + ":ver", perfil: perfil("permissions", map[string]any{f: []string{"ver"}})},
			Persona{Nome: "vessel:" + f + ":editar", perfil: perfil("permissions", map[string]any{f: []string{"ver", "editar"}})},
			Persona{Nome: "vessel:" + f + ":so-editar", perfil: perfil("permissions", map[string]any{f: []string{"editar"}})})
	}
	for i := range ps {
		ps[i].ID = id("00000000", i+1)
	}
	return ps
}

// Novo cria um BANCO novo (as funções de produção fixam search_path = public, então um schema
// por teste não serve) e o apaga no fim. Pula sem TEST_DATABASE_URL, como o testebanco.
func Novo(t *testing.T) *Mundo {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL ausente: rode `make teste` em api/")
	}
	ctx := context.Background()
	admin, err := pgx.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	b := make([]byte, 6)
	rand.Read(b)
	nome := "autz_" + hex.EncodeToString(b)
	if _, err := admin.Exec(ctx, "create database "+nome); err != nil {
		t.Fatal(err)
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.Database = nome
	cfg.MaxConns = 16 // o teste de contrato roda uma pessoa por goroutine
	banco.Configurar(cfg)
	p, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		p.Close()
		admin.Exec(ctx, "drop database "+nome+" with (force)")
		admin.Close(ctx)
	})
	var catalogo []map[string]any
	if err := json.Unmarshal(autz.CatalogoJSON(), &catalogo); err != nil {
		t.Fatal(err)
	}
	m := &Mundo{Pool: p, Personas: personas(catalogo)}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := p.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%v\n%s", err, sql)
		}
	}
	exec(banco.Compat)
	var ddl strings.Builder
	for _, tab := range autz.Producao.Tabelas() {
		fmt.Fprintf(&ddl, "create table %s (id uuid primary key default gen_random_uuid()", pgx.Identifier{tab}.Sanitize())
		for _, c := range Colunas {
			fmt.Fprintf(&ddl, ", %s %s", c.Nome, c.Tipo)
		}
		if tab == "profiles" {
			ddl.WriteString(", email text, role text not null default 'viewer', disabled boolean, features text[]," +
				" permissions jsonb not null default '{}', allowed_accounts text[], is_superadmin boolean not null default false," +
				" escopo_por_equipe boolean not null default false")
		}
		ddl.WriteString(");\n")
	}
	exec(ddl.String())
	exec(Ajudantes)
	var pol strings.Builder
	for _, tab := range autz.Producao.Tabelas() {
		fmt.Fprintf(&pol, "alter table %s enable row level security;\n", pgx.Identifier{tab}.Sanitize())
	}
	for _, c := range catalogo {
		var papeis []string
		for _, r := range c["papeis"].([]any) {
			if r == "public" {
				papeis = append(papeis, "public")
			} else {
				papeis = append(papeis, pgx.Identifier{r.(string)}.Sanitize())
			}
		}
		fmt.Fprintf(&pol, "create policy %s on %s as %s for %s to %s",
			pgx.Identifier{c["nome"].(string)}.Sanitize(), pgx.Identifier{c["tabela"].(string)}.Sanitize(),
			c["tipo"], c["comando"], strings.Join(papeis, ", "))
		if u, ok := c["using"].(string); ok {
			fmt.Fprintf(&pol, " using (%s)", u)
		}
		if w, ok := c["withCheck"].(string); ok {
			fmt.Fprintf(&pol, " with check (%s)", w)
		}
		pol.WriteString(";\n")
	}
	pol.WriteString(`grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;`)
	exec(pol.String())

	// O mundo: equipes T1..T4 (canal, local, depósito), lojas 1..5 (3 e 5 no grupo G1, 4 no G2),
	// pessoas PE1/PE2, bens B1 (local L1), B2 (L2), B3 (da pessoa PE1), B4 (sem nada).
	exec(`insert into equipes (id, canal_loja_id, local_id, deposito_id) values
	  ($1, 1, $5, 11), ($2, 2, $6, 12), ($3, 3, null, 13), ($4, 4, null, 14)`, T1, T2, T3, T4, L1, L2)
	exec(`insert into bling_lojas (loja_id, grupo_id) values (1, null), (2, null), (3, $1), (4, $2), (5, $1)`, G1, G2)
	exec(`insert into acessos_pessoas (id, profile_id) values ($1, null)`, PE2)
	exec(`insert into patrimonio_bens (id, local_id, pessoa_id) values ($1, $5, null), ($2, $6, null), ($3, null, $7), ($4, null, null)`,
		B1, B2, B3, B4, L1, L2, PE1)
	for _, ps := range m.Personas {
		if ps.perfil != nil {
			ps.perfil["id"] = ps.ID
			if _, ok := ps.perfil["email"]; !ok {
				ps.perfil["email"] = strings.ReplaceAll(ps.Nome, ":", "-") + "@teste"
			}
			j, _ := json.Marshal(ps.perfil)
			exec(`insert into profiles select * from jsonb_populate_record(null::profiles, $1::jsonb)`, string(j))
		}
		for _, sql := range ps.depois {
			exec(strings.ReplaceAll(sql, "%s", ps.ID))
		}
	}
	return m
}
```

Crie `api/internal/autz/contrato_test.go`:

```go
package autz_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/autz/autzteste"
)

// colunasDa devolve as colunas da linha que as policies de `tab` leem (as de Colunas que
// aparecem sem prefixo de outra tabela: "p.id" é do perfil, "patrimonio_posse.bem_id" é da linha).
func colunasDa(tab string, catalogo []map[string]any) []string {
	var texto strings.Builder
	for _, p := range catalogo {
		if p["tabela"] == tab {
			fmt.Fprint(&texto, p["using"], " ", p["withCheck"], " ")
		}
	}
	s := strings.ReplaceAll(texto.String(), tab+".", "")
	var out []string
	for _, c := range append([]string{"id"}, nomes()...) {
		if regexp.MustCompile(`(^|[^.\w])` + c + `\b`).MatchString(s) {
			out = append(out, c)
		}
	}
	return out
}

func nomes() []string {
	var l []string
	for _, c := range autzteste.Colunas {
		l = append(l, c.Nome)
	}
	return l
}

// grade: o produto cartesiano dos valores das colunas (dono = os ids de `donos`).
func grade(cols []string, donos []any) []map[string]any {
	linhas := []map[string]any{{}}
	for _, c := range cols {
		vals, ok := autzteste.Valores[c]
		if autzteste.DeDono[c] {
			vals, ok = donos, true
		}
		if !ok {
			continue // "id" e as colunas que nenhuma policy compara a valor fixo
		}
		var nova []map[string]any
		for _, l := range linhas {
			for _, v := range vals {
				x := map[string]any{c: v}
				for k, w := range l {
					x[k] = w
				}
				nova = append(nova, x)
			}
		}
		linhas = nova
	}
	return linhas
}

type resultado struct{ permitido, negado int }

type placar struct {
	mu         sync.Mutex
	cobertura  map[string]*resultado
	constantes map[string]map[string]bool // tab×op -> formas do SQL do Go vistas ("true", "false", "linha")
	falhas     int
}

func (p *placar) contar(chave string, ok bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	r := p.cobertura[chave]
	if r == nil {
		r = &resultado{}
		p.cobertura[chave] = r
	}
	if ok {
		r.permitido++
	} else {
		r.negado++
	}
}

func (p *placar) forma(chave, sql string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.constantes[chave] == nil {
		p.constantes[chave] = map[string]bool{}
	}
	if sql != "true" && sql != "false" {
		sql = "linha"
	}
	p.constantes[chave][sql] = true
}

func (p *placar) erro(t *testing.T, format string, a ...any) {
	t.Helper()
	p.mu.Lock()
	p.falhas++
	n := p.falhas
	p.mu.Unlock()
	if n <= 60 {
		t.Errorf(format, a...)
	}
}

// O CONTRATO: para cada pessoa × tabela × operação, o que o Go decide (autz.Producao) é
// EXATAMENTE o que a RLS de produção decide, linha a linha. Ler e Apagar: o conjunto de ids;
// Editar: 0 (não vê/não pode), 1 (passou) ou erro (passou no USING e caiu no WITH CHECK);
// Criar: cada linha candidata aceita ou recusada.
func TestContratoDePermissaoContraARLSDeProducao(t *testing.T) {
	m := autzteste.Novo(t)
	ctx := context.Background()
	var catalogo []map[string]any
	json.Unmarshal(autz.CatalogoJSON(), &catalogo)
	var todos []any
	for _, ps := range m.Personas {
		todos = append(todos, ps.ID)
	}
	todos = append(todos, nil)
	cols := map[string][]string{}
	for _, tab := range autz.Producao.Tabelas() {
		cols[tab] = colunasDa(tab, catalogo)
		if autzteste.DoMundo[tab] {
			continue
		}
		j, _ := json.Marshal(grade(cols[tab], todos))
		nomeT := pgx.Identifier{tab}.Sanitize()
		if _, err := m.Pool.Exec(ctx, `insert into `+nomeT+` select (jsonb_populate_record(null::`+nomeT+
			`, jsonb_build_object('id', gen_random_uuid()) || x)).* from jsonb_array_elements($1::jsonb) x`, string(j)); err != nil {
			t.Fatalf("%s: %v", tab, err)
		}
	}
	pl := &placar{cobertura: map[string]*resultado{}, constantes: map[string]map[string]bool{}}
	t.Run("pessoas", func(t *testing.T) {
		for _, ps := range m.Personas {
			t.Run(ps.Nome, func(t *testing.T) {
				t.Parallel()
				verificarPessoa(t, m, pl, ps, cols)
			})
		}
	})
	if pl.falhas > 0 {
		t.Fatalf("%d divergências entre o Go e a RLS de produção", pl.falhas)
	}
	// Cobertura: toda tabela×operação viu permitido E negado, salvo quando a regra é constante
	// para TODAS as pessoas (o Go devolveu só "true", ou só "false"): aí o mundo não tem como
	// mostrar o outro lado, e a constante é a própria regra (ex.: `true`, ou nenhuma policy).
	var fracas []string
	for k, r := range pl.cobertura {
		c := pl.constantes[k]
		if (r.negado == 0 && !(len(c) == 1 && c["true"])) || (r.permitido == 0 && !(len(c) == 1 && c["false"])) {
			fracas = append(fracas, fmt.Sprintf("%s (permitido %d, negado %d, Go %v)", k, r.permitido, r.negado, c))
		}
	}
	sort.Strings(fracas)
	if len(fracas) > 0 {
		t.Fatalf("o mundo do teste não mostra os dois lados de %d regras (acrescente pessoa/linha):\n%s", len(fracas), strings.Join(fracas, "\n"))
	}
}

func verificarPessoa(t *testing.T, m *autzteste.Mundo, pl *placar, ps autzteste.Persona, cols map[string][]string) {
	ctx := context.Background()
	e, err := autz.CarregarEscopo(ctx, m.Pool, ps.ID)
	if err != nil {
		t.Fatal(err)
	}
	outro := m.Pessoa("comum").ID
	if ps.ID == outro {
		outro = m.Pessoa("admin").ID
	}
	// O lado da RLS: UMA transação como a pessoa, cada tentativa num savepoint desfeito.
	err = m.ComoPessoa(ctx, ps.ID, func(tx pgx.Tx) error {
		for _, tab := range autz.Producao.Tabelas() {
			nomeT := pgx.Identifier{tab}.Sanitize()
			filtro := func(op autz.Op) autz.Filtro {
				f, err := autz.Producao.Filtro(e, tab, op, tab)
				if err != nil {
					t.Fatal(err)
				}
				if op != autz.EditarNova { // só tem efeito junto do Editar: o tri-estado de editar já a confere
					pl.forma(tab+"×"+op.String(), f.SQL)
				}
				return f
			}
			fl, fa, fe, fn, fc := filtro(autz.Ler), filtro(autz.Apagar), filtro(autz.Editar), filtro(autz.EditarNova), filtro(autz.Criar)

			// Go: uma consulta dá ler, apagar e editar de todas as linhas (como superusuário).
			goLer, goApagar, goEditar := map[string]bool{}, map[string]bool{}, map[string]string{}
			var todas []string
			args := fc.Juntar(fn.Juntar(fe.Juntar(fa.Juntar(fl.Juntar(pgx.NamedArgs{})))))
			linhas, err := m.Pool.Query(ctx, `select id::text, coalesce(`+fl.SQL+`, false), coalesce(`+fa.SQL+`, false),
			    coalesce(`+fe.SQL+`, false), coalesce(`+fn.SQL+`, false) from `+nomeT+` as `+nomeT, args)
			if err != nil {
				t.Fatalf("%s: %v", tab, err)
			}
			var id string
			var ler, apagar, velha, nova bool
			if _, err := pgx.ForEachRow(linhas, []any{&id, &ler, &apagar, &velha, &nova}, func() error {
				todas = append(todas, id)
				goLer[id], goApagar[id] = ler, apagar
				switch {
				case !velha:
					goEditar[id] = "0"
				case !nova:
					goEditar[id] = "erro"
				default:
					goEditar[id] = "1"
				}
				return nil
			}); err != nil {
				t.Fatalf("%s: %v", tab, err)
			}

			// RLS: ler
			rlsLer := conjunto(t, tx, `select id::text from `+nomeT)
			// RLS: apagar (desfeito)
			rlsApagar := map[string]bool{}
			emSavepoint(t, tx, func() error {
				rlsApagar = conjunto(t, tx, `delete from `+nomeT+` returning id::text`)
				return nil
			})
			// RLS: editar: a tabela inteira; se a RLS recusar alguma linha nova, linha a linha
			rlsEditar := map[string]string{}
			for _, x := range todas {
				rlsEditar[x] = "0"
			}
			errLote := emSavepoint(t, tx, func() error {
				l, err := tx.Query(ctx, `update `+nomeT+` set id = id returning id::text`)
				if err != nil {
					return err
				}
				vistos, err := pgx.CollectRows(l, pgx.RowTo[string])
				for _, x := range vistos {
					rlsEditar[x] = "1"
				}
				return err
			})
			if errLote != nil {
				for _, x := range todas {
					rlsEditar[x] = "0"
					err := emSavepoint(t, tx, func() error {
						tag, err := tx.Exec(ctx, `update `+nomeT+` set id = id where id = $1::uuid`, x)
						if err == nil && tag.RowsAffected() == 1 {
							rlsEditar[x] = "1"
						}
						return err
					})
					if err != nil {
						rlsEditar[x] = "erro"
					}
				}
			}
			for _, x := range todas {
				if rlsLer[x] != goLer[x] {
					pl.erro(t, "%s × %s × ler linha %s: RLS %v, Go %v (%s)", ps.Nome, tab, x, rlsLer[x], goLer[x], fl.SQL)
				}
				if rlsApagar[x] != goApagar[x] {
					pl.erro(t, "%s × %s × apagar linha %s: RLS %v, Go %v", ps.Nome, tab, x, rlsApagar[x], goApagar[x])
				}
				if rlsEditar[x] != goEditar[x] {
					pl.erro(t, "%s × %s × editar linha %s: RLS %q, Go %q", ps.Nome, tab, x, rlsEditar[x], goEditar[x])
				}
				pl.contar(tab+"×ler", rlsLer[x])
				pl.contar(tab+"×apagar", rlsApagar[x])
				pl.contar(tab+"×editar", rlsEditar[x] == "1")
			}

			// CRIAR: linhas candidatas desta pessoa (dono = ela, outra pessoa ou ninguém)
			for _, l := range grade(cols[tab], []any{ps.ID, outro, nil}) {
				delete(l, "id")
				goOK, err := autz.Conferir(ctx, m.Pool, fc, tab, l)
				if err != nil {
					t.Fatalf("%s criar: %v", tab, err)
				}
				rlsOK := emSavepoint(t, tx, func() error { return inserir(ctx, tx, tab, l) }) == nil
				if goOK != rlsOK {
					pl.erro(t, "%s × %s × criar %v: RLS %v, Go %v (%s)", ps.Nome, tab, l, rlsOK, goOK, fc.SQL)
				}
				pl.contar(tab+"×criar", rlsOK)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// emSavepoint roda fn e desfaz o que ela fez. Erro que não seja a recusa da RLS (42501)
// derruba o teste: só a RLS pode dizer não.
func emSavepoint(t *testing.T, tx pgx.Tx, fn func() error) error {
	t.Helper()
	ctx := context.Background()
	if _, err := tx.Exec(ctx, `savepoint s`); err != nil {
		t.Fatal(err)
	}
	err := fn()
	if _, e := tx.Exec(ctx, `rollback to savepoint s`); e != nil {
		t.Fatal(e)
	}
	if err != nil && !negadoPelaRLS(err) {
		t.Fatalf("erro que não é da RLS: %v", err)
	}
	return err
}

func conjunto(t *testing.T, tx pgx.Tx, sql string) map[string]bool {
	t.Helper()
	l, err := tx.Query(context.Background(), sql)
	if err != nil {
		t.Fatalf("%v\n%s", err, sql)
	}
	vistos, err := pgx.CollectRows(l, pgx.RowTo[string])
	if err != nil {
		t.Fatalf("%v\n%s", err, sql)
	}
	out := map[string]bool{}
	for _, x := range vistos {
		out[x] = true
	}
	return out
}

func inserir(ctx context.Context, tx pgx.Tx, tab string, linha map[string]any) error {
	nomeT := pgx.Identifier{tab}.Sanitize()
	if len(linha) == 0 {
		_, err := tx.Exec(ctx, `insert into `+nomeT+` default values`)
		return err
	}
	var cs []string
	for c := range linha {
		cs = append(cs, pgx.Identifier{c}.Sanitize())
	}
	sort.Strings(cs)
	j, _ := json.Marshal(linha)
	_, err := tx.Exec(ctx, `insert into `+nomeT+` (`+strings.Join(cs, ", ")+`) select `+strings.Join(cs, ", ")+
		` from jsonb_populate_record(null::`+nomeT+`, $1::jsonb)`, string(j))
	return err
}

func negadoPelaRLS(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "42501"
}
```

Crie `api/internal/autz/portoes_test.go`:

```go
package autz_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/autz/autzteste"
)

// Os portões que os sub-planos põem na frente das RPCs decidem como a função de produção
// que eles espelham, para cada pessoa do mundo (chamada como a pessoa).
func TestPortoesContraAsFuncoesDeProducao(t *testing.T) {
	m := autzteste.Novo(t)
	ctx := context.Background()
	portoes := map[string]autz.Regra{
		"is_frota_admin()": autz.FrotaAdmin, "is_acessos_admin()": autz.AcessosAdmin,
		"is_patrimonio_admin()": autz.PatrimonioAdmin, "is_vessel_admin()": autz.VesselAdmin,
		"is_vessel_leads()": autz.VesselLeads, "pode_ver_vendas()": autz.PodeVerVendas,
		"superadmin_pela_ficha()": autz.SuperFicha, "is_superadmin()": autz.SuperEmail,
		"pode_aprovar_frota()": autz.PodeAprovarFrota, "pode_cadastrar_pessoa_rapida()": autz.PodeCadastrarPessoaRapida,
		"is_vessel_atendimentos()": autz.VesselAtendimentos, "is_vessel_atendimentos_editar()": autz.VesselAtendimentosEditar,
	}
	for _, f := range autz.FerramentasVessel {
		for _, n := range []string{"ver", "editar"} {
			if r, err := autz.VesselPode(f, n); err == nil {
				portoes["vessel_pode('"+f+"', '"+n+"')"] = r
			}
		}
	}
	if _, err := autz.VesselPode("atendimentos.material-grafico", "editar"); err == nil {
		t.Error("vessel_pode do Material Gráfico só tem ver")
	}
	if _, err := autz.VesselPode("outra", "ver"); err == nil {
		t.Error("ferramenta fora da lista aceita")
	}
	for chamada, regra := range portoes {
		sim, nao := 0, 0
		for _, ps := range m.Personas {
			e, err := autz.CarregarEscopo(ctx, m.Pool, ps.ID)
			if err != nil {
				t.Fatal(err)
			}
			var banco *bool
			if err := m.ComoPessoa(ctx, ps.ID, func(tx pgx.Tx) error {
				return tx.QueryRow(ctx, `select `+chamada).Scan(&banco)
			}); err != nil {
				t.Fatalf("%s: %v", chamada, err)
			}
			quer := banco != nil && *banco
			if regra(e) != quer {
				t.Errorf("%s como %s: Go %v, produção %v", chamada, ps.Nome, regra(e), quer)
			}
			if quer {
				sim++
			} else {
				nao++
			}
		}
		if sim == 0 || nao == 0 {
			t.Errorf("%s: o mundo não mostra os dois lados (sim %d, não %d)", chamada, sim, nao)
		}
	}
}
```

- [ ] **Step 3: Rodar e conferir que o teste MORDE**

Run: `go vet ./internal/autz/... && go test -count=1 ./internal/autz/ 2>&1 | grep -v goose | tail -3`
Expected: `ok` (~20 s). O código da Task 3 já é o que passou no ensaio; esta etapa prova que o teste reprova regra errada. Aplique UMA mutação por vez, rode `go test -count=1 -run 'Contrato|Portoes' ./internal/autz/` e confira `FAIL` em cada uma; depois desfaça (`git checkout api/internal/autz/predicados.go api/internal/autz/catalogo.go api/internal/autz/escopo.go`):

| Arquivo | Troque | Por |
|---|---|---|
| `predicados.go` | `if !e.TemPerfil \|\| !e.Ativo {` (em `perfilCom`) | `if !e.TemPerfil {` |
| `predicados.go` | `e.Papel == "admin" \|\| e.SuperFicha \|\| e.TodasContas` | `e.Papel == "admin" \|\| e.SuperFicha \|\| e.TodasContas \|\| len(e.Contas) == 0` |
| `predicados.go` | `return e.Ativo && (e.Modulo("frota") \|\| e.SuperFicha)` (em `frotaAdmin`) | `return e.Ativo && (e.Modulo("frota") \|\| e.SuperFicha \|\| e.Papel == "admin")` |
| `predicados.go` | `return ok && slices.Contains(acoes, "ver") && (n == "ver" \|\| slices.Contains(acoes, n))` | `return ok && (slices.Contains(acoes, "ver") \|\| slices.Contains(acoes, n))` |
| `catalogo.go` | `return append(e_{perm}, restr...)` | `return e_{perm}` |
| `catalogo.go` | `return e_{ler, combinar([]string{"update", "all"}, usingDe)}, nil` | `return combinar([]string{"update", "all"}, usingDe), nil` |
| `catalogo.go` | `if !slices.Contains(p.Papeis, "authenticated") && !slices.Contains(p.Papeis, "public") {` | `if false {` |
| `escopo.go` | `where gm.profile_id = $1::uuid and gm.papel = 'supervisora') c)` | `where gm.profile_id = $1::uuid) c)` |
| `escopo.go` | `(slices.Contains(comEstoque, equipe) && len(e.Diretos[equipe]) > 0)` | `slices.Contains(comEstoque, equipe)` |

(Os `\|` da tabela são `|` no código.) Se alguma mutação passar, o mundo está fraco: acrescente a pessoa ou a linha que a mostra antes de seguir.

- [ ] **Step 4: Rodar tudo**

Run: `gofmt -l ./internal && go test -count=1 -v ./internal/autz/... 2>&1 | grep -E '^(--- (FAIL|SKIP)|ok|FAIL)'`
Expected: só `ok` (nenhum `--- FAIL`, nenhum `--- SKIP`).

- [ ] **Step 5: Commit**

```bash
git add api/internal/autz/autzteste/ api/internal/autz/contrato_test.go api/internal/autz/portoes_test.go
git commit -m "test(api): contrato de permissão contra a RLS de produção (276 policies, 144 tabelas, ~60 pessoas) e portões de RPC

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: `dados.Consulta` e conferências de escrita (IDOR)

**Revisor:** **opus** (é por aqui que toda rota de domínio lê e grava).

`autz.ComEscopo` (depois de `auth.Exigir`) carrega o `Escopo` no contexto. `dados.Consulta` é a leitura declarada: o domínio escreve o SQL; a regra de Ler entra no `WHERE` da tabela principal e no lugar de cada marcador `{ler:<tabela>:<alias>}` (tabela embutida ou de junção); filtros e ordem só da lista branca. `Validar` (na montagem) recusa: tabela/marcador fora do catálogo, alias errado, SQL que não lê a principal, e QUALQUER `from`/`join` de tabela sem marcador (inclusive sem alias). Lista negada = `200 []`. As escritas conferem antes de gravar: `PodeCriar` (linha nova), `PodeEditar` (trava a linha; Ler + USING na antiga; WITH CHECK na antiga com as mudanças) e `PodeApagar`. Linha invisível = `ErrNaoEncontrado` (404, nunca 403: id de outra conta não confirma que existe).

**Files:**
- Create: `api/internal/autz/escrita.go`, `api/internal/dados/consulta.go`
- Test: `api/internal/autz/escrita_test.go`, `api/internal/dados/consulta_test.go`

**Interfaces:**
- Consumes: Tasks 1–3; `auth.AtorDoContexto`.
- Produces:
  - `autz.ComEscopo(b Banco) func(http.Handler) http.Handler`; `autz.NoContexto(ctx, e *Escopo) context.Context`; `autz.EscopoDo(ctx) *Escopo`; `var autz.ErrNaoEncontrado`.
  - `(*autz.Catalogo).PodeCriar(ctx, b Banco, e, tab string, linha map[string]any) error`; `PodeEditar(ctx, tx pgx.Tx, e, tab, id string, mudancas map[string]any) error`; `PodeApagar(ctx, tx pgx.Tx, e, tab, id string) error`.
  - `type dados.Consulta struct { Tabela, Alias, SQL, Onde string; Filtros []Filtro; Ordens map[string]string; OrdemPadrao string }` com `Validar(cat *autz.Catalogo) error` e `Handler(b Consultor, cat *autz.Catalogo) http.HandlerFunc`; `dados.ErroDeEscrita(w, err)`.

- [ ] **Step 1: Escrever os testes que falham**

Crie `api/internal/autz/escrita_test.go`:

```go
package autz

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// CatalogoDeTeste: "coisa" lida por conta (restritiva), editada por quem vê a conta (antes E
// depois), criada por quem tem o módulo frota e apagada só por super-admin. "conta" é lida só
// por quem a tem em allowed_accounts.
const CatalogoDeTeste = `[
 {"tabela":"conta","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"(auth.role() = 'authenticated'::text)","withCheck":null},
 {"tabela":"conta","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta((id)::text)","withCheck":null},
 {"tabela":"coisa","nome":"le","tipo":"permissive","comando":"select","papeis":["public"],"using":"true","withCheck":null},
 {"tabela":"coisa","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null},
 {"tabela":"coisa","nome":"edita","tipo":"permissive","comando":"update","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":"pode_ver_conta(account_id)"},
 {"tabela":"coisa","nome":"cria","tipo":"permissive","comando":"insert","papeis":["authenticated"],"using":null,"withCheck":"is_frota_admin()"},
 {"tabela":"coisa","nome":"apaga","tipo":"permissive","comando":"delete","papeis":["authenticated"],"using":"superadmin_pela_ficha()","withCheck":null},
 {"tabela":"coisa","nome":"servico","tipo":"permissive","comando":"all","papeis":["service_role"],"using":"true","withCheck":null}
]`

const (
	coisaA1 = "aaaaaaaa-0000-4000-a000-000000000001"
	coisaA2 = "aaaaaaaa-0000-4000-a000-000000000002"
)

func escopoComContas(contas ...string) *Escopo {
	return &Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, SemTrava: true, Contas: contas}
}

func mundoDeEscrita(t *testing.T) (*Catalogo, pgx.Tx) {
	t.Helper()
	cat, err := Compilar([]byte(CatalogoDeTeste))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table conta (id text primary key);
		create table coisa (id uuid primary key, account_id text, nome text);
		insert into conta values ('A1'), ('A2');
		insert into coisa values ('`+coisaA1+`', 'A1', 'um'), ('`+coisaA2+`', 'A2', 'dois')`); err != nil {
		t.Fatal(err)
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tx.Rollback(ctx) })
	return cat, tx
}

func TestPodeEditar(t *testing.T) {
	cat, tx := mundoDeEscrita(t)
	ctx := context.Background()
	a1 := escopoComContas("A1")
	casos := []struct {
		nome     string
		id       string
		mudancas map[string]any
		quer     error
	}{
		{"a própria conta", coisaA1, map[string]any{"nome": "novo"}, nil},
		{"linha de outra conta é 404, não 403 (IDOR)", coisaA2, map[string]any{"nome": "x"}, ErrNaoEncontrado},
		{"mover para conta que não vê", coisaA1, map[string]any{"account_id": "A2"}, ErrNegado},
		{"id que não existe", "aaaaaaaa-0000-4000-a000-000000000009", map[string]any{"nome": "x"}, ErrNaoEncontrado},
		{"id que nem é uuid", "1 or 1=1", map[string]any{"nome": "x"}, ErrNaoEncontrado},
	}
	for _, c := range casos {
		if err := cat.PodeEditar(ctx, tx, a1, "coisa", c.id, c.mudancas); !errors.Is(err, c.quer) {
			t.Errorf("%s: %v, esperava %v", c.nome, err, c.quer)
		}
	}
	if err := cat.PodeEditar(ctx, tx, escopoComContas("A1", "A2"), "coisa", coisaA1, map[string]any{"account_id": "A2"}); err != nil {
		t.Errorf("quem vê as duas contas move: %v", err)
	}
	if err := cat.PodeEditar(ctx, tx, nil, "coisa", coisaA1, nil); err == nil {
		t.Error("sem escopo passou")
	}
	if err := cat.PodeEditar(ctx, tx, a1, "fora_do_catalogo", coisaA1, nil); !errors.Is(err, ErrRecursoDesconhecido) {
		t.Errorf("tabela fora do catálogo: %v", err)
	}
}

func TestPodeApagarECriar(t *testing.T) {
	cat, tx := mundoDeEscrita(t)
	ctx := context.Background()
	super := escopoComContas()
	super.SuperFicha = true
	if err := cat.PodeApagar(ctx, tx, escopoComContas("A1"), "coisa", coisaA1); !errors.Is(err, ErrNegado) {
		t.Errorf("quem só vê apaga: %v", err)
	}
	if err := cat.PodeApagar(ctx, tx, escopoComContas("A1"), "coisa", coisaA2); !errors.Is(err, ErrNaoEncontrado) {
		t.Errorf("apagar linha que não vê: %v", err)
	}
	if err := cat.PodeApagar(ctx, tx, super, "coisa", coisaA2); err != nil {
		t.Errorf("super-admin apaga: %v", err)
	}
	frota := escopoComContas()
	frota.Modulos = []string{"frota"}
	if err := cat.PodeCriar(ctx, tx, frota, "coisa", map[string]any{"account_id": "A2"}); err != nil {
		t.Errorf("módulo frota cria: %v", err)
	}
	if err := cat.PodeCriar(ctx, tx, escopoComContas("A1"), "coisa", map[string]any{"account_id": "A1"}); !errors.Is(err, ErrNegado) {
		t.Errorf("sem frota cria: %v", err)
	}
	frota.Ativo = false
	if err := cat.PodeCriar(ctx, tx, frota, "coisa", nil); !errors.Is(err, ErrNegado) {
		t.Errorf("conta desativada cria: %v", err)
	}
}
```

Crie `api/internal/dados/consulta_test.go`:

```go
package dados

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// O mesmo catálogo de teste do autz (coisa lida por conta; conta lida por allowed_accounts).
const catalogoDeTeste = `[
 {"tabela":"conta","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"(auth.role() = 'authenticated'::text)","withCheck":null},
 {"tabela":"conta","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta((id)::text)","withCheck":null},
 {"tabela":"coisa","nome":"le","tipo":"permissive","comando":"select","papeis":["public"],"using":"true","withCheck":null},
 {"tabela":"coisa","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null}
]`

var consultaDeTeste = Consulta{
	Tabela: "coisa", Alias: "c",
	SQL: `select c.nome, c.account_id,
	        (select row_to_json(k) from conta k where k.id = c.dona and {ler:conta:k}) as dona
	      from coisa c`,
	Filtros:     []Filtro{{Param: "conta", SQL: "c.account_id = @conta::text", Tipo: "texto"}},
	Ordens:      map[string]string{"nome": "c.nome"},
	OrdemPadrao: "c.nome asc",
}

func montarConsulta(t *testing.T, e *autz.Escopo) http.Handler {
	t.Helper()
	cat, err := autz.Compilar([]byte(catalogoDeTeste))
	if err != nil {
		t.Fatal(err)
	}
	if err := consultaDeTeste.Validar(cat); err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), `create table conta (id text primary key);
		create table coisa (id serial primary key, nome text, account_id text, dona text);
		insert into conta values ('A1'), ('A2');
		insert into coisa (nome, account_id, dona) values ('a', 'A1', 'A1'), ('b', 'A1', 'A2'), ('c', 'A2', 'A1'), ('d', null, null)`); err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if e != nil {
				req = req.WithContext(autz.NoContexto(req.Context(), e))
			}
			next.ServeHTTP(w, req)
		})
	})
	r.Get("/coisas", consultaDeTeste.Handler(p, cat))
	return r
}

// compacto: o json_agg separa os itens com ", \n " (igual ao PostgREST); o teste compara o conteúdo.
func compacto(s string) string {
	var b bytes.Buffer
	if json.Compact(&b, []byte(s)) != nil {
		return s
	}
	return b.String()
}

func pedir(h http.Handler, url string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", url, nil))
	return w
}

// IDOR: quem só vê a conta A1 não recebe linha de A2 nem filtrando por ela, e a conta
// embutida que não vê sai null (a regra vale também na tabela embutida).
func TestConsultaAplicaARegraNaPrincipalENaEmbutida(t *testing.T) {
	a1 := &autz.Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, Contas: []string{"A1"}}
	h := montarConsulta(t, a1)
	casos := map[string]string{
		"/coisas":                          `[{"nome":"a","account_id":"A1","dona":{"id":"A1"}}, {"nome":"b","account_id":"A1","dona":null}, {"nome":"d","account_id":null,"dona":null}]`,
		"/coisas?conta=A2":                 `[]`,
		"/coisas?ordem=nome.desc&limite=1": `[{"nome":"d","account_id":null,"dona":null}]`,
	}
	for url, quer := range casos {
		w := pedir(h, url)
		if w.Code != 200 || compacto(w.Body.String()) != compacto(quer) {
			t.Errorf("%s = %d %s", url, w.Code, w.Body)
		}
	}
	w := pedir(h, "/coisas?contar=1&limite=1")
	if w.Header().Get("X-Total-Count") != "3" {
		t.Errorf("X-Total-Count = %q", w.Header().Get("X-Total-Count"))
	}
	for _, url := range []string{"/coisas?cor=azul", "/coisas?ordem=id", "/coisas?contar=sim", "/coisas?limite=5000"} {
		if w := pedir(h, url); w.Code != 400 {
			t.Errorf("%s = %d %s", url, w.Code, w.Body)
		}
	}
	todas := &autz.Escopo{ID: a1.ID, TemPerfil: true, Ativo: true, TodasContas: true}
	if w := pedir(montarConsulta(t, todas), "/coisas?conta=A2"); compacto(w.Body.String()) != `[{"nome":"c","account_id":"A2","dona":{"id":"A1"}}]` {
		t.Errorf("quem vê tudo, filtrando A2 = %s", w.Body)
	}
	if w := pedir(montarConsulta(t, nil), "/coisas"); w.Code != 500 {
		t.Errorf("sem escopo = %d (a rota precisa de autz.ComEscopo)", w.Code)
	}
}

func TestConsultaValidar(t *testing.T) {
	cat, _ := autz.Compilar([]byte(catalogoDeTeste))
	ok := func(c Consulta) Consulta {
		if c.OrdemPadrao == "" {
			c.OrdemPadrao = "c.nome"
		}
		if c.Tabela == "" {
			c.Tabela, c.Alias = "coisa", "c"
		}
		return c
	}
	if err := ok(Consulta{SQL: `select c.nome, x.v from coisa c, jsonb_array_elements('[]') x`}).Validar(cat); err == nil {
		// jsonb_array_elements é função (não precisa de regra), mas "x" não é tabela: passa
	} else {
		t.Errorf("função no from recusada: %v", err)
	}
	for nome, c := range map[string]Consulta{
		"join sem regra":            ok(Consulta{SQL: `select c.nome from coisa c join conta k on k.id = c.dona`}),
		"subconsulta sem regra":     ok(Consulta{SQL: `select (select k.id from conta k where k.id = c.dona) from coisa c`}),
		"tabela sem alias":          ok(Consulta{SQL: `select c.nome from coisa c where exists (select 1 from conta where id = c.dona)`}),
		"alias trocado":             ok(Consulta{SQL: `select x.nome from coisa x`}),
		"não lê a principal":        ok(Consulta{SQL: `select k.id from conta k where {ler:conta:k}`}),
		"marcador fora do catálogo": ok(Consulta{SQL: `select c.nome from coisa c join outra o on {ler:outra:o}`}),
		"principal fora":            {Tabela: "outra", Alias: "o", SQL: `select 1 from outra o`, OrdemPadrao: "1"},
		"sem ordem":                 {Tabela: "coisa", Alias: "c", SQL: `select c.nome from coisa c`},
		"filtro sem cast":           ok(Consulta{SQL: `select c.nome from coisa c`, Filtros: []Filtro{{Param: "x", SQL: "c.nome = @x", Tipo: "texto"}}}),
	} {
		if err := c.Validar(cat); err == nil {
			t.Errorf("%s: aceito", nome)
		}
	}
	if err := ok(Consulta{SQL: `select c.nome from coisa c left join conta k on k.id = c.dona and {ler:conta:k}`}).Validar(cat); err != nil {
		t.Errorf("join com regra recusado: %v", err)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/autz/ ./internal/dados/ 2>&1 | tail -4`
Expected: FAIL de compilação (`undefined: PodeEditar`, `undefined: NoContexto`, `undefined: Consulta`).

- [ ] **Step 3: Implementar**

Crie `api/internal/autz/escrita.go`:

```go
package autz

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// ErrNaoEncontrado: a linha não existe OU quem pede não a lê. As duas respostas são iguais
// (404) de propósito: um id de outra loja/conta nunca confirma que existe (IDOR).
var ErrNaoEncontrado = errors.New("autz: não encontrado")

type chaveEscopo struct{}

func NoContexto(ctx context.Context, e *Escopo) context.Context {
	return context.WithValue(ctx, chaveEscopo{}, e)
}

// EscopoDo devolve o escopo que ComEscopo pôs no contexto (nil se a rota não passou por ele).
func EscopoDo(ctx context.Context) *Escopo {
	e, _ := ctx.Value(chaveEscopo{}).(*Escopo)
	return e
}

// ComEscopo carrega o Escopo de quem pede. Vem DEPOIS de auth.Exigir (que garante o ator).
func ComEscopo(b Banco) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			a := auth.AtorDoContexto(r.Context())
			if a == nil {
				http.Error(w, `{"error":"nao_autenticado"}`, http.StatusUnauthorized)
				return
			}
			e, err := CarregarEscopo(r.Context(), b, a.ID)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"error":"erro_interno"}`))
				return
			}
			next.ServeHTTP(w, r.WithContext(NoContexto(r.Context(), e)))
		})
	}
}

// PodeCriar: a linha nova passa no WITH CHECK de insert (Criar).
func (c *Catalogo) PodeCriar(ctx context.Context, b Banco, e *Escopo, tab string, linha map[string]any) error {
	f, err := c.Filtro(e, tab, Criar, "autz_nova")
	if err != nil {
		return err
	}
	ok, err := Conferir(ctx, b, f, tab, linha)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNegado
	}
	return nil
}

// PodeEditar trava a linha `id` (for update) e confere: a linha antiga é lida e passa no USING
// de update (senão ErrNaoEncontrado/ErrNegado), e a linha NOVA (a antiga com `mudancas`) passa
// no WITH CHECK (mover uma linha para uma conta/loja que a pessoa não vê é negado).
func (c *Catalogo) PodeEditar(ctx context.Context, tx pgx.Tx, e *Escopo, tab, id string, mudancas map[string]any) error {
	fe, err := c.Filtro(e, tab, Editar, "autz_velha")
	if err != nil {
		return err
	}
	fn, err := c.Filtro(e, tab, EditarNova, "autz_nova")
	if err != nil {
		return err
	}
	j, err := json.Marshal(mudancas)
	if err != nil {
		return err
	}
	return c.conferirExistente(ctx, tx, e, tab, id, fe, `coalesce((select `+fn.SQL+` from jsonb_populate_record(null::`+
		pgx.Identifier{tab}.Sanitize()+`, to_jsonb(autz_velha) || @autz_mudancas::jsonb) as autz_nova), false)`,
		fn.Juntar(pgx.NamedArgs{"autz_mudancas": string(j)}))
}

// PodeApagar trava a linha `id` e confere Ler + USING de delete.
func (c *Catalogo) PodeApagar(ctx context.Context, tx pgx.Tx, e *Escopo, tab, id string) error {
	fa, err := c.Filtro(e, tab, Apagar, "autz_velha")
	if err != nil {
		return err
	}
	return c.conferirExistente(ctx, tx, e, tab, id, fa, "true", nil)
}

func (c *Catalogo) conferirExistente(ctx context.Context, tx pgx.Tx, e *Escopo, tab, id string, fop Filtro, extra string, extraArgs pgx.NamedArgs) error {
	fl, err := c.Filtro(e, tab, Ler, "autz_velha")
	if err != nil {
		return err
	}
	args := fop.Juntar(fl.Juntar(pgx.NamedArgs{"autz_id": id}))
	for k, v := range extraArgs {
		args[k] = v
	}
	var ler, pode bool
	err = tx.QueryRow(ctx, `select coalesce(`+fl.SQL+`, false), coalesce(`+fop.SQL+`, false) and `+extra+
		` from `+pgx.Identifier{tab}.Sanitize()+` as autz_velha where autz_velha.id::text = @autz_id::text for update`, args).Scan(&ler, &pode)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return ErrNaoEncontrado
	case err != nil:
		return err
	case !ler:
		return ErrNaoEncontrado
	case !pode:
		return ErrNegado
	}
	return nil
}
```

Crie `api/internal/dados/consulta.go`:

```go
package dados

import (
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// Consulta é uma rota de LEITURA declarada: SQL fixo escrito no domínio, filtros e ordens da
// lista branca, e a regra de Ler do catálogo entrando sozinha no WHERE da tabela principal e
// em cada tabela embutida ({ler:<tabela>:<alias>}). O pedido nunca escolhe tabela, coluna nem
// trecho de SQL: só valores de filtros declarados.
type Consulta struct {
	Tabela, Alias string
	// SQL: "select ... from <Tabela> <Alias> [join ...]", sem where/order/limit. Toda OUTRA
	// tabela lida (join, subconsulta) leva o marcador {ler:<tabela>:<alias>} na sua condição,
	// ex.: "(select row_to_json(v) from frota_veiculos v where v.id = u.veiculo_id and {ler:frota_veiculos:v})".
	SQL         string
	Onde        string // condição fixa extra (sem valor do pedido); opcional
	Filtros     []Filtro
	Ordens      map[string]string
	OrdemPadrao string // obrigatória: lista sem ordem não é determinística
}

var (
	reMarcador = regexp.MustCompile(`\{ler:([a-z_][a-z0-9_]*):([a-z][a-z0-9_]*)\}`)
	reFromJoin = regexp.MustCompile(`(?i)\b(?:from|join)\s+([a-z_][a-z0-9_.]*)(\s*\()?(?:\s+(?:as\s+)?([a-z][a-z0-9_]*))?`)
	// palavras que aparecem depois de from/join sem ser tabela, ou no lugar do alias
	palavras = map[string]bool{"lateral": true, "select": true, "where": true, "on": true, "join": true, "left": true,
		"inner": true, "cross": true, "order": true, "group": true, "limit": true, "using": true}
)

// Validar confere a declaração na montagem das rotas (erro = a API não sobe): tabela e
// marcadores no catálogo, alias certo, filtros válidos, e NENHUMA tabela lida sem regra.
func (c Consulta) Validar(cat *autz.Catalogo) error {
	if !cat.Tem(c.Tabela) {
		return fmt.Errorf("consulta: %q fora do catálogo", c.Tabela)
	}
	if c.OrdemPadrao == "" {
		return fmt.Errorf("consulta %s: OrdemPadrao obrigatória", c.Tabela)
	}
	for _, f := range c.Filtros {
		if err := f.Validar(); err != nil {
			return err
		}
	}
	guardadas := map[string]bool{c.Tabela + " " + c.Alias: true}
	for _, m := range reMarcador.FindAllStringSubmatch(c.SQL, -1) {
		if !cat.Tem(m[1]) {
			return fmt.Errorf("consulta %s: marcador de %q fora do catálogo", c.Tabela, m[1])
		}
		guardadas[m[1]+" "+m[2]] = true
	}
	achouPrincipal := false
	for _, m := range reFromJoin.FindAllStringSubmatch(reMarcador.ReplaceAllString(c.SQL, ""), -1) {
		if strings.TrimSpace(m[2]) == "(" || palavras[strings.ToLower(m[1])] {
			continue // função (jsonb_array_elements(...)) ou palavra-chave
		}
		if palavras[strings.ToLower(m[3])] {
			m[3] = "" // tabela sem alias: só passa se for declarada assim (não é)
		}
		if !guardadas[m[1]+" "+m[3]] {
			return fmt.Errorf("consulta %s: %q (alias %q) é lida sem {ler:%s:%s}", c.Tabela, m[1], m[3], m[1], m[3])
		}
		achouPrincipal = achouPrincipal || (m[1] == c.Tabela && m[3] == c.Alias)
	}
	if !achouPrincipal {
		return fmt.Errorf("consulta %s: o SQL não lê %s %s", c.Tabela, c.Tabela, c.Alias)
	}
	return nil
}

// montar devolve o SQL final e os argumentos para quem pede.
func (c Consulta) montar(r *http.Request, cat *autz.Catalogo) (string, string, pgx.NamedArgs, error) {
	e := autz.EscopoDo(r.Context())
	q := r.URL.Query()
	args := pgx.NamedArgs{}
	pag, err := LerPagina(q)
	if err != nil {
		return "", "", nil, errPedido{err}
	}
	ordem, err := LerOrdem(q, c.Ordens, c.OrdemPadrao)
	if err != nil {
		return "", "", nil, errPedido{err}
	}
	conds, err := LerFiltros(q, c.Filtros, args)
	if err != nil {
		return "", "", nil, errPedido{err}
	}
	var errMarcador error
	sql := reMarcador.ReplaceAllStringFunc(c.SQL, func(s string) string {
		m := reMarcador.FindStringSubmatch(s)
		f, err := cat.Filtro(e, m[1], autz.Ler, m[2])
		if err != nil {
			errMarcador = err
			return "false"
		}
		f.Juntar(args)
		return "(" + f.SQL + ")"
	})
	if errMarcador != nil {
		return "", "", nil, errMarcador
	}
	f, err := cat.Filtro(e, c.Tabela, autz.Ler, c.Alias)
	if err != nil {
		return "", "", nil, err
	}
	f.Juntar(args)
	onde := append([]string{f.SQL}, conds...)
	if c.Onde != "" {
		onde = append(onde, "("+c.Onde+")")
	}
	base := sql + " where " + strings.Join(onde, " and ")
	args["limite"], args["deslocamento"] = pag.Limite, pag.Deslocamento
	return base + " order by " + ordem + " limit @limite::int offset @deslocamento::int", base, args, nil
}

type errPedido struct{ error }

// Handler responde a lista (200 [] quando nada passa na regra, como o PostgREST com RLS).
// ?contar=1 acrescenta X-Total-Count (total sem paginação). Monte DEPOIS de autz.ComEscopo.
func (c Consulta) Handler(b Consultor, cat *autz.Catalogo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sql, base, args, err := c.montar(r, cat)
		var pe errPedido
		switch {
		case errors.As(err, &pe):
			Erro(w, http.StatusBadRequest, "pedido_invalido", pe.Error())
			return
		case err != nil:
			ErroDoBanco(w, err)
			return
		}
		if v := r.URL.Query().Get("contar"); v != "" {
			if v != "1" {
				Erro(w, http.StatusBadRequest, "pedido_invalido", "contar só aceita 1")
				return
			}
			var n int64
			if err := b.QueryRow(r.Context(), `select count(*) from (`+base+`) t`, args).Scan(&n); err != nil {
				ErroDoBanco(w, err)
				return
			}
			w.Header().Set("X-Total-Count", strconv.FormatInt(n, 10))
		}
		Lista(r.Context(), b, w, sql, args)
	}
}

// ErroDeEscrita traduz o resultado de autz.PodeCriar/PodeEditar/PodeApagar ou da gravação.
func ErroDeEscrita(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, autz.ErrNaoEncontrado):
		Erro(w, http.StatusNotFound, "nao_encontrado", "")
	case errors.Is(err, autz.ErrNegado):
		Erro(w, http.StatusForbidden, "sem_permissao", "")
	default:
		ErroDoBanco(w, err)
	}
}
```

- [ ] **Step 4: Rodar e ver passar (e morder)**

Run: `gofmt -l ./internal && go vet ./internal/autz/ ./internal/dados/ && go test -count=1 -v -run 'Consulta|Pode' ./internal/autz/ ./internal/dados/ 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: todos `--- PASS`; `ok`. Mutações que têm de reprovar (uma por vez, depois `git checkout`): em `consulta.go`, `return "(" + f.SQL + ")"` → `return "true"` (a conta embutida que a pessoa não vê apareceria) e `onde := append([]string{f.SQL}, conds...)` → `onde := append([]string{"true"}, conds...)` (IDOR na principal).

- [ ] **Step 5: Commit**

```bash
git add api/internal/autz/escrita.go api/internal/autz/escrita_test.go api/internal/dados/consulta.go api/internal/dados/consulta_test.go
git commit -m "feat(api): leitura declarada com a regra do catálogo e conferências de escrita (404 em IDOR)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: `POST /rpc/{nome}` — lista branca de funções SQL

**Revisor:** **opus** (nome e parâmetros viram SQL; portão antes da função).

O corpo é o mesmo de `.rpc(nome, args)`. Cada valor JSON vira o parâmetro nomeado da função com cast explícito no SQL (`(@p::jsonb #>> '{}')::uuid`; array: `jsonb_array_elements_text`; `jsonb`: `nullif(..., 'null')`), então tipo errado é 22P02 → 400 e nada do pedido entra no texto do SQL. Ordem: nome registrado (senão 404) → portão (senão 403, SEM chamar a função) → parâmetros (falta/sobra/lista = 400) → função em `banco.ComUsuario` (`auth.uid()` = quem pede; a checagem interna da função continua). Erros do banco por `dados.ErroDoBanco` (42501 da função = 403 com a frase; `raise exception` = 400 `regra_de_negocio`). O registro nasce vazio (Task 10); cada sub-plano acrescenta as suas funções.

**Files:**
- Modify: `api/internal/auth/middleware.go` (acrescentar `NoContexto`)
- Create: `api/internal/rpc/rpc.go`
- Test: `api/internal/rpc/rpc_test.go`

**Interfaces:**
- Consumes: `dados.Erro`, `dados.ErroDoBanco`, `dados.LerCorpo` (Task 1); `autz.EscopoDo`, `autz.NoContexto`, `autz.Regra` (Tasks 3 e 5); `banco.ComUsuario` (Plano 2).
- Produces: `auth.NoContexto(ctx, a *Ator) context.Context`; `type rpc.Retorno int` (`Valor`, `Conjunto`, `Nada`); `type rpc.Param struct { Nome, Tipo string; Opcional bool }`; `type rpc.Funcao struct { Nome string; Params []Param; Retorno Retorno; Portao autz.Regra }`; `rpc.Novo(p *pgxpool.Pool, fs ...Funcao) (*Registro, error)`; `(*rpc.Registro).ServeHTTP`.

- [ ] **Step 1: Escrever o teste que falha**

Em `api/internal/auth/middleware.go`, troque:

```go
func AtorDoContexto(ctx context.Context) *Ator {
```

por:

```go
// NoContexto põe o ator no contexto (o Exigir usa; os testes de outros pacotes também).
func NoContexto(ctx context.Context, a *Ator) context.Context {
	return context.WithValue(ctx, chaveAtor{}, a)
}

func AtorDoContexto(ctx context.Context) *Ator {
```

e, em `Exigir`, troque `next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), chaveAtor{}, a)))` por `next.ServeHTTP(w, r.WithContext(NoContexto(r.Context(), a)))`.

Crie `api/internal/rpc/rpc_test.go`:

```go
package rpc

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const quemPede = "11111111-0000-4000-a000-000000000001"

var (
	todos   = autz.Regra(func(*autz.Escopo) bool { return true })
	ninguem = autz.Regra(func(*autz.Escopo) bool { return false })
)

func montar(t *testing.T, fs ...Funcao) (*pgxpool.Pool, http.Handler) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), `
		create table marca (quem text);
		create function soma(p_a integer, p_b integer default 1) returns integer language sql as $$ select p_a + p_b $$;
		create function lista(p_ids uuid[]) returns table(id uuid, n int) language sql as $$ select x, 1 from unnest(p_ids) x order by x $$;
		create function quem() returns text language sql as $$ select current_setting('app.usuario_id', true) $$;
		create function marcar() returns void language sql as $$ insert into marca values (current_setting('app.usuario_id', true)) $$;
		create function negada() returns int language plpgsql as $$ begin raise exception 'Sem acesso para isso' using errcode = '42501'; end $$;
		create function regra() returns int language plpgsql as $$ begin raise exception 'Lote já gravado'; end $$;
		create function eco(p_j jsonb) returns jsonb language sql as $$ select p_j $$;
		create function nulo() returns int language sql as $$ select null::int $$;`); err != nil {
		t.Fatal(err)
	}
	reg, err := Novo(p, fs...)
	if err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := auth.NoContexto(req.Context(), &auth.Ator{ID: quemPede, Tipo: "painel"})
			next.ServeHTTP(w, req.WithContext(autz.NoContexto(ctx, &autz.Escopo{ID: quemPede})))
		})
	})
	r.Post("/rpc/{nome}", reg.ServeHTTP)
	return p, r
}

func chamar(h http.Handler, nome, corpo string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/rpc/"+nome, strings.NewReader(corpo)))
	return w
}

func TestRPCChamaComParametrosNomeadosEIdentidade(t *testing.T) {
	_, h := montar(t,
		Funcao{Nome: "soma", Params: []Param{{Nome: "p_a", Tipo: "integer"}, {Nome: "p_b", Tipo: "integer", Opcional: true}}, Portao: todos},
		Funcao{Nome: "lista", Params: []Param{{Nome: "p_ids", Tipo: "uuid[]"}}, Retorno: Conjunto, Portao: todos},
		Funcao{Nome: "quem", Portao: todos},
		Funcao{Nome: "eco", Params: []Param{{Nome: "p_j", Tipo: "jsonb"}}, Portao: todos},
		Funcao{Nome: "nulo", Portao: todos},
		Funcao{Nome: "negada", Portao: todos},
		Funcao{Nome: "regra", Portao: todos},
	)
	casos := []struct {
		nome, corpo string
		status      int
		quer        string
	}{
		{"soma", `{"p_a":2}`, 200, `3`},
		{"soma", `{"p_a":2,"p_b":5}`, 200, `7`},
		{"soma", `{}`, 400, `{"error":"pedido_invalido","mensagem":"falta o parâmetro p_a"}`},
		{"soma", `{"p_a":"x"}`, 400, `{"error":"pedido_invalido"}`},
		{"soma", `{"p_a":1,"p_c":1}`, 400, `{"error":"pedido_invalido","mensagem":"parâmetro desconhecido: p_c"}`},
		{"soma", `{"p_a":1} lixo`, 400, `{"error":"corpo_invalido"}`},
		{"lista", `{"p_ids":["bbbbbbbb-0000-4000-a000-000000000002","aaaaaaaa-0000-4000-a000-000000000001"]}`, 200,
			`[{"id":"aaaaaaaa-0000-4000-a000-000000000001","n":1}, ` + "\n" + ` {"id":"bbbbbbbb-0000-4000-a000-000000000002","n":1}]`},
		{"lista", `{"p_ids":"aaaaaaaa-0000-4000-a000-000000000001"}`, 400, `{"error":"pedido_invalido","mensagem":"p_ids deve ser uma lista"}`},
		{"quem", ``, 200, `"` + quemPede + `"`},
		{"eco", `{"p_j":{"a":[1,"x"]}}`, 200, `{"a": [1, "x"]}`},
		{"eco", `{"p_j":null}`, 200, `null`},
		{"nulo", `{}`, 200, `null`},
		{"negada", `{}`, 403, `{"error":"sem_permissao","mensagem":"Sem acesso para isso"}`},
		{"regra", `{}`, 400, `{"error":"regra_de_negocio","mensagem":"Lote já gravado"}`},
		{"pg_sleep", `{}`, 404, `{"error":"nao_encontrado"}`}, // não registrada: lista branca
		{"marcar", `{}`, 404, `{"error":"nao_encontrado"}`},
	}
	for _, c := range casos {
		w := chamar(h, c.nome, c.corpo)
		if w.Code != c.status || strings.TrimSpace(w.Body.String()) != c.quer {
			t.Errorf("%s %s = %d %s, esperava %d %s", c.nome, c.corpo, w.Code, w.Body, c.status, c.quer)
		}
	}
}

// O portão vem ANTES da função: negado = 403 e a função nem roda (a marca não é gravada).
func TestRPCPortaoAntesDaFuncao(t *testing.T) {
	p, h := montar(t, Funcao{Nome: "marcar", Retorno: Nada, Portao: ninguem})
	if w := chamar(h, "marcar", `{}`); w.Code != 403 {
		t.Fatalf("portão fechado = %d %s", w.Code, w.Body)
	}
	var n int
	p.QueryRow(context.Background(), `select count(*) from marca`).Scan(&n)
	if n != 0 {
		t.Fatalf("a função rodou com o portão fechado (%d marcas)", n)
	}
	p2, h2 := montar(t, Funcao{Nome: "marcar", Retorno: Nada, Portao: todos})
	if w := chamar(h2, "marcar", ``); w.Code != 204 {
		t.Fatalf("portão aberto = %d %s", w.Code, w.Body)
	}
	var quem string
	if err := p2.QueryRow(context.Background(), `select quem from marca`).Scan(&quem); err != nil || quem != quemPede {
		t.Fatalf("marca = %q %v (a escrita não viu quem pede)", quem, err)
	}
}

func TestRPCNovoRecusaDeclaracaoRuim(t *testing.T) {
	for _, f := range []Funcao{
		{Nome: "soma; drop table x", Portao: todos},
		{Nome: "soma"},
		{Nome: "soma", Portao: todos, Params: []Param{{Nome: "p_a", Tipo: "integer); drop table x; --"}}},
		{Nome: "soma", Portao: todos, Params: []Param{{Nome: "p-a", Tipo: "integer"}}},
	} {
		if _, err := Novo(nil, f); err == nil {
			t.Errorf("%+v aceito", f)
		}
	}
	if _, err := Novo(nil, Funcao{Nome: "a", Portao: todos}, Funcao{Nome: "a", Portao: todos}); err == nil {
		t.Error("duplicata aceita")
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/rpc/ 2>&1 | tail -3`
Expected: FAIL de compilação (`undefined: Novo`, `undefined: Funcao`).

- [ ] **Step 3: Implementar**

Crie `api/internal/rpc/rpc.go`:

```go
// Package rpc expõe, uma a uma, as funções SQL que o front chamava pelo PostgREST
// (`.rpc(nome, args)`): POST /rpc/{nome} com o mesmo corpo. Só nomes registrados (lista
// branca), cada um com seus parâmetros tipados e um portão em Go (autz.Regra) que espelha a
// checagem que a função já faz por dentro. A função roda numa transação com auth.uid() = quem
// pede (banco.ComUsuario), então a checagem interna dela continua valendo como segunda barreira.
package rpc

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Retorno diz como a resposta é montada.
type Retorno int

const (
	Valor    Retorno = iota // returns <escalar|json|record>: to_json(f(...))
	Conjunto                // returns setof/table: json_agg das linhas ([] se nenhuma)
	Nada                    // returns void: 204
)

// Param: Tipo é o tipo SQL do parâmetro (com [] para array). Opcional = a função tem DEFAULT.
type Param struct {
	Nome, Tipo string
	Opcional   bool
}

type Funcao struct {
	Nome    string
	Params  []Param
	Retorno Retorno
	Portao  autz.Regra
}

var (
	reNome = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)
	tipos  = []string{"text", "uuid", "integer", "bigint", "numeric", "boolean", "date", "timestamptz", "jsonb"}
)

type Registro struct {
	pool    *pgxpool.Pool
	funcoes map[string]Funcao
}

// Novo valida as declarações (erro = a API não sobe): nome, tipos, portão obrigatório.
func Novo(p *pgxpool.Pool, fs ...Funcao) (*Registro, error) {
	r := &Registro{pool: p, funcoes: map[string]Funcao{}}
	for _, f := range fs {
		if !reNome.MatchString(f.Nome) || f.Portao == nil {
			return nil, fmt.Errorf("rpc %q: nome inválido ou sem portão", f.Nome)
		}
		if _, dup := r.funcoes[f.Nome]; dup {
			return nil, fmt.Errorf("rpc %q registrada duas vezes", f.Nome)
		}
		for _, pr := range f.Params {
			if !reNome.MatchString(pr.Nome) || !slices.Contains(tipos, strings.TrimSuffix(pr.Tipo, "[]")) || pr.Tipo == "jsonb[]" {
				return nil, fmt.Errorf("rpc %s: parâmetro %q de tipo %q inválido", f.Nome, pr.Nome, pr.Tipo)
			}
		}
		r.funcoes[f.Nome] = f
	}
	return r, nil
}

// expr: o valor JSON do parâmetro convertido no SQL, sempre com cast explícito.
func expr(pr Param) string {
	v := "@" + pr.Nome + "::jsonb"
	switch {
	case pr.Tipo == "jsonb":
		return "nullif(" + v + ", 'null'::jsonb)"
	case strings.HasSuffix(pr.Tipo, "[]"):
		return "(select array_agg(x)::" + pr.Tipo + " from jsonb_array_elements_text(" + v + ") x)"
	}
	return "(" + v + " #>> '{}')::" + pr.Tipo
}

// ServeHTTP: POST /rpc/{nome}. Monte DEPOIS de auth.Exigir e autz.ComEscopo.
func (rg *Registro) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f, ok := rg.funcoes[chi.URLParam(r, "nome")]
	if !ok {
		dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
		return
	}
	e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
	if e == nil || a == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	if !f.Portao(e) {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
		return
	}
	corpo := map[string]json.RawMessage{}
	if r.ContentLength != 0 && !dados.LerCorpo(w, r, &corpo) {
		return
	}
	args := pgx.NamedArgs{}
	var chamadas []string
	for _, pr := range f.Params {
		v, tem := corpo[pr.Nome]
		delete(corpo, pr.Nome)
		if !tem {
			if !pr.Opcional {
				dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "falta o parâmetro "+pr.Nome)
				return
			}
			continue
		}
		if strings.HasSuffix(pr.Tipo, "[]") && !(strings.HasPrefix(strings.TrimSpace(string(v)), "[") || string(v) == "null") {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", pr.Nome+" deve ser uma lista")
			return
		}
		args[pr.Nome] = string(v)
		chamadas = append(chamadas, pgx.Identifier{pr.Nome}.Sanitize()+" => "+expr(pr))
	}
	for k := range corpo {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "parâmetro desconhecido: "+k)
		return
	}
	chamada := pgx.Identifier{f.Nome}.Sanitize() + "(" + strings.Join(chamadas, ", ") + ")"
	var saida []byte
	err := banco.ComUsuario(r.Context(), rg.pool, a.ID, func(tx pgx.Tx) error {
		switch f.Retorno {
		case Conjunto:
			return tx.QueryRow(r.Context(), `select coalesce(json_agg(r), '[]'::json) from `+chamada+` r`, args).Scan(&saida)
		case Nada:
			_, err := tx.Exec(r.Context(), `select `+chamada, args)
			return err
		}
		return tx.QueryRow(r.Context(), `select coalesce(to_json(`+chamada+`), 'null'::json)`, args).Scan(&saida)
	})
	if err != nil {
		dados.ErroDoBanco(w, err)
		return
	}
	if f.Retorno == Nada {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(saida)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l ./internal && go vet ./internal/rpc/ ./internal/auth/ && go test -count=1 -v ./internal/rpc/ ./internal/auth/ 2>&1 | grep -E '^(--- (FAIL|SKIP)|ok|FAIL)'`
Expected: só `ok`. Mutação que tem de reprovar: mover o bloco `if !f.Portao(e) { … }` para DEPOIS de `banco.ComUsuario` (a marca seria gravada com o portão fechado).

- [ ] **Step 5: Commit**

```bash
git add api/internal/auth/middleware.go api/internal/rpc/
git commit -m "feat(api): POST /rpc/{nome} com lista branca, parâmetros tipados e portão antes da função

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Conta — links de senha por e-mail, trocar senha, conta desativada e `GET /eu/perfil`

**Revisor:** **opus** (autenticação: enumeração de contas, token de uso único, sessão que sobrevive à troca).

O Auth do Supabase fazia três coisas que a tela usa: "esqueci a senha" (`resetPasswordForEmail`), "definir a senha" pelo link do convite/troca (`updateUser` com a sessão do link) e "trocar a senha" logado (`updateUser` + RPC `marcar_senha_trocada`). Aqui: tokens de uso único guardados como hash (`tokens_de_senha`, migração 00005), e-mail pelo ZeptoMail (o mesmo provedor que `vessel-conta` já usa), três rotas e o perfil. Regras: "esqueci" responde SEMPRE `202 {"ok":true}` e manda o e-mail fora da requisição (sem enumeração, nem pelo tempo); só conta ativa recebe; pedir de novo invalida o link anterior; o link leva ao endereço de onde a pessoa pediu se estiver em `ENDERECOS_DO_APP`, senão ao padrão; "definir" consome o link, grava a senha, derruba TODAS as sessões da pessoa e já devolve uma sessão nova; "trocar" (sessão) grava, tira a cobrança `precisa_trocar_senha` na mesma transação (substitui a RPC) e derruba as OUTRAS sessões; sessão de "entrar como" não troca a senha do alvo. Senha de 6 a 72 caracteres (72 = limite do bcrypt). E o login da conta desativada: com a senha CERTA responde `403 conta_desativada` (a tela mostra "fale com quem administra", que hoje vem da RPC `minha_conta_esta_desativada`); com a senha errada, o mesmo 401 de quem não existe.

**Files:**
- Create: `api/internal/banco/migracoes/00005_tokens_de_senha.sql`
- Create: `api/internal/email/email.go`; Test: `api/internal/email/email_test.go`
- Create: `api/internal/auth/conta.go`; Test: `api/internal/auth/conta_test.go`
- Modify: `api/internal/auth/rotas.go` (`Entrar`), `api/internal/auth/rotas_test.go` (um teste trocado)
- Modify: `api/internal/testebanco/testebanco.go` (colunas de `profiles`)

**Interfaces:**
- Consumes: `auth.Store`, `auth.Limitador`, `ipDe`, `hashDoToken`, `HashDaSenha`, `SenhaConfere`, `erroJSON`, `tokenDe` (Plano 1); `banco.ComUsuario`.
- Produces:
  - `type email.ZeptoMail struct { URL, Token, De, Nome string; HTTP *http.Client }` com `Mandar(ctx, para, assunto, html, texto string) error`; `email.ErrSemToken`.
  - `type auth.Mandador interface { Mandar(...) error }`; `type auth.Conta struct { Pool; Sessoes; Email Mandador; Enderecos []string; Padrao string; PorIP, PorEmail *Limitador; … }`; `auth.NovaConta(p, s, m Mandador, enderecos []string, padrao string) *Conta`.
  - Handlers: `(*Conta).EsqueciSenha`, `DefinirSenha`, `TrocarSenha`, `Perfil`.
  - `auth.PrazoRecuperacao = 1h`, `auth.PrazoConvite = 24h`, `auth.SenhaMinima = 6`, `auth.SenhaMaxima = 72`; funções internas `novoLink(ctx, tx, usuarioID, tipo, base string, prazo) (string, error)`, `validarSenha`, `erroComMensagem`, `(*Conta).destino(r) string` (usadas nas Tasks 8 e 9).

- [ ] **Step 1: Escrever os testes que falham**

Em `api/internal/testebanco/testebanco.go`, troque a tabela `profiles` do `legado` por:

```sql
create table profiles (
  id uuid primary key, email text, name text, role text,
  is_superadmin boolean default false, permissions jsonb default '{}'::jsonb,
  disabled boolean default false,
  features text[] default '{banco}', escopo_por_equipe boolean default false,
  avatar_url text, allowed_accounts text[], precisa_trocar_senha boolean not null default false
);
```

Crie `api/internal/email/email_test.go`:

```go
package email

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

const tokenDeTeste = "segredo-zepto-123456"

func TestMandarMontaOPedidoDoZeptoMail(t *testing.T) {
	var cab http.Header
	var corpo map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cab = r.Header.Clone()
		json.NewDecoder(r.Body).Decode(&corpo)
		w.WriteHeader(201)
	}))
	defer srv.Close()
	for _, tok := range []string{tokenDeTeste, "Zoho-enczapikey " + tokenDeTeste} {
		z := &ZeptoMail{URL: srv.URL, Token: tok, De: "nao-responda@x", Nome: "Central"}
		if err := z.Mandar(context.Background(), "pessoa@x", "Assunto", "<p>oi</p>", "oi"); err != nil {
			t.Fatal(err)
		}
		if cab.Get("Authorization") != "Zoho-enczapikey "+tokenDeTeste {
			t.Fatalf("Authorization = %q", cab.Get("Authorization"))
		}
	}
	de, _ := corpo["from"].(map[string]any)
	para, _ := corpo["to"].([]any)
	if de["address"] != "nao-responda@x" || de["name"] != "Central" || corpo["subject"] != "Assunto" ||
		corpo["htmlbody"] != "<p>oi</p>" || corpo["textbody"] != "oi" || len(para) != 1 ||
		para[0].(map[string]any)["email_address"].(map[string]any)["address"] != "pessoa@x" {
		t.Fatalf("corpo = %v", corpo)
	}
}

// Recusa, redirecionamento e rede fora viram erro sem token, sem destinatário e sem o texto.
func TestMandarFalhaSemVazar(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/recusa":
			w.WriteHeader(401)
			w.Write([]byte(`{"error":{"code":"TM_3201","message":"token ` + tokenDeTeste + ` inválido"}}`))
		case "/redireciona":
			http.Redirect(w, r, "https://outro.exemplo/roubar", http.StatusTemporaryRedirect)
		}
	}))
	defer srv.Close()
	for caminho, quer := range map[string]string{"/recusa": "zeptomail: recusou (401 TM_3201)", "/redireciona": "zeptomail: recusou (307 )"} {
		z := &ZeptoMail{URL: srv.URL + caminho, Token: tokenDeTeste}
		err := z.Mandar(context.Background(), "pessoa@x", "a", "link-secreto", "link-secreto")
		if err == nil || err.Error() != quer {
			t.Errorf("%s: %v", caminho, err)
		}
	}
	z := &ZeptoMail{URL: "http://127.0.0.1:1/" + tokenDeTeste, Token: tokenDeTeste}
	err := z.Mandar(context.Background(), "pessoa@x", "a", "b", "c")
	if err == nil || strings.Contains(err.Error(), tokenDeTeste) || strings.Contains(err.Error(), "127.0.0.1") {
		t.Fatalf("rede fora: %v", err)
	}
	if err := (&ZeptoMail{}).Mandar(context.Background(), "a", "b", "c", "d"); err != ErrSemToken {
		t.Fatalf("sem token: %v", err)
	}
}
```

Crie `api/internal/auth/conta_test.go`:

```go
package auth

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

type enviado struct{ para, assunto, html, texto string }

type correio struct {
	mu       sync.Mutex
	enviados []enviado
	falhar   bool
}

func (c *correio) Mandar(_ context.Context, para, assunto, html, texto string) error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.falhar {
		return errFalhaDeEnvio
	}
	c.enviados = append(c.enviados, enviado{para, assunto, html, texto})
	return nil
}

var errFalhaDeEnvio = errors.New("falha de envio")

func (c *correio) lista() []enviado {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]enviado(nil), c.enviados...)
}

const padrao, central = "https://socialdashboard.exemplo", "https://central.exemplo"

func montarConta(t *testing.T) (*pgxpool.Pool, *Store, *Conta, *correio, http.Handler) {
	t.Helper()
	p := testebanco.Novo(t)
	s := NovoStore(p)
	cor := &correio{}
	c := NovaConta(p, s, cor, []string{padrao, central}, padrao)
	c.enviando = make(chan struct{}, 10)
	r := chi.NewRouter()
	r.Post("/auth/entrar", NovosHandlers(p, s, NovoLimitador()).Entrar)
	r.Post("/auth/esqueci-senha", c.EsqueciSenha)
	r.Post("/auth/definir-senha", c.DefinirSenha)
	r.Group(func(r chi.Router) {
		r.Use(Exigir(p, s))
		r.Post("/auth/trocar-senha", c.TrocarSenha)
		r.Get("/eu/perfil", c.Perfil)
	})
	return p, s, c, cor, r
}

func pedirComOrigem(h http.Handler, caminho, corpo, origem string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", caminho, strings.NewReader(corpo))
	r.Header.Set("Origin", origem)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

var reLink = regexp.MustCompile(`(https://[a-z.]+)/#type=(recovery|invite)&token=([A-Za-z0-9_-]{43})`)

func esperarEnvio(t *testing.T, c *Conta) {
	t.Helper()
	select {
	case <-c.enviando:
	case <-time.After(5 * time.Second):
		t.Fatal("o envio não terminou")
	}
}

// Sem enumeração: quem tem conta, quem não tem e quem está desativado recebem a MESMA resposta;
// só a conta ativa recebe o e-mail, e o link só leva a um endereço do app.
func TestEsqueciSenha(t *testing.T) {
	p, _, c, cor, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	usuarioComSenha(t, p, uid2, "desligada@x.com", "antiga", `{}`)
	p.Exec(context.Background(), `update profiles set disabled = true where id = $1`, uid2)
	respostas := map[string]string{}
	for _, email := range []string{"PESSOA@x.com ", "ninguem@x.com", "desligada@x.com"} {
		w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"`+email+`"}`, central)
		esperarEnvio(t, c)
		respostas[email] = w.Body.String()
		if w.Code != 202 || w.Body.String() != `{"ok":true}` {
			t.Fatalf("%s = %d %s", email, w.Code, w.Body)
		}
	}
	env := cor.lista()
	if len(env) != 1 || env[0].para != "pessoa@x.com" {
		t.Fatalf("enviados = %+v", env)
	}
	m := reLink.FindStringSubmatch(env[0].texto)
	if m == nil || m[1] != central || m[2] != "recovery" || !strings.Contains(env[0].html, m[0]) {
		t.Fatalf("link = %v (%q)", m, env[0].texto)
	}
	var claro, hash int
	p.QueryRow(context.Background(), `select count(*) filter (where token_hash = $1), count(*) filter (where token_hash = $2) from tokens_de_senha`, m[3], hashDoToken(m[3])).Scan(&claro, &hash)
	if claro != 0 || hash != 1 {
		t.Fatalf("token no banco: em claro %d, hash %d", claro, hash)
	}
	// origem forjada: o link cai no endereço padrão
	pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"pessoa@x.com"}`, "https://central.exemplo.ladrao.net")
	esperarEnvio(t, c)
	if m := reLink.FindStringSubmatch(cor.lista()[1].texto); m == nil || m[1] != padrao {
		t.Fatalf("origem forjada levou o link para %v", m)
	}
	// pedir de novo invalida o link anterior
	var vivos int
	p.QueryRow(context.Background(), `select count(*) from tokens_de_senha where usado_em is null`).Scan(&vivos)
	if vivos != 1 {
		t.Fatalf("links vivos = %d, esperava 1", vivos)
	}
	for _, corpo := range []string{`{}`, `{"email":""}`, `lixo`} {
		if w := pedirComOrigem(h, "/auth/esqueci-senha", corpo, ""); w.Code != 400 {
			t.Errorf("%s = %d", corpo, w.Code)
		}
	}
}

func TestEsqueciSenhaTemLimitePorEmail(t *testing.T) {
	_, _, c, _, h := montarConta(t)
	for i := 0; i < 5; i++ {
		if w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"alvo@x.com"}`, ""); w.Code != 202 {
			t.Fatalf("pedido %d = %d", i, w.Code)
		}
		esperarEnvio(t, c)
	}
	if w := pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"alvo@x.com"}`, ""); w.Code != 429 {
		t.Fatalf("6º pedido = %d, esperava 429", w.Code)
	}
}

func linkDe(t *testing.T, c *Conta, cor *correio, h http.Handler, email string) string {
	t.Helper()
	pedirComOrigem(h, "/auth/esqueci-senha", `{"email":"`+email+`"}`, padrao)
	esperarEnvio(t, c)
	env := cor.lista()
	return reLink.FindStringSubmatch(env[len(env)-1].texto)[3]
}

func TestDefinirSenhaConsomeOLinkUmaVez(t *testing.T) {
	p, s, c, cor, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	velha, _ := s.Criar(context.Background(), uid, "painel", nil)
	tok := linkDe(t, c, cor, h, "pessoa@x.com")
	w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+tok+`","senha":"nova-senha"}`, "")
	var o struct{ Token string }
	json.Unmarshal(w.Body.Bytes(), &o)
	if w.Code != 200 || o.Token == "" {
		t.Fatalf("definir = %d %s", w.Code, w.Body)
	}
	if _, err := s.Buscar(context.Background(), o.Token); err != nil {
		t.Fatalf("sessão nova: %v", err)
	}
	if _, err := s.Buscar(context.Background(), velha); err != ErrSessaoInvalida {
		t.Fatalf("sessão antiga continuou viva: %v", err)
	}
	if w := chamar(h, "POST", "/auth/entrar", `{"email":"pessoa@x.com","senha":"antiga"}`, ""); w.Code != 401 {
		t.Fatalf("senha antiga = %d", w.Code)
	}
	entrar(t, h, "pessoa@x.com", "nova-senha")
	if w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+tok+`","senha":"outra-senha"}`, ""); w.Code != 400 || !strings.Contains(w.Body.String(), "token_invalido") {
		t.Fatalf("link usado de novo = %d %s", w.Code, w.Body)
	}
}

func TestDefinirSenhaRecusa(t *testing.T) {
	p, _, c, cor, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	tok := linkDe(t, c, cor, h, "pessoa@x.com")
	casos := []struct{ corpo, erro string }{
		{`{"token":"` + tok + `","senha":"12345"}`, "senha_invalida"},
		{`{"token":"` + tok + `","senha":"` + strings.Repeat("x", 73) + `"}`, "senha_invalida"},
		{`{"token":"inventado","senha":"nova-senha"}`, "token_invalido"},
		{`{"senha":"nova-senha"}`, "pedido_invalido"},
	}
	for _, c := range casos {
		if w := pedirComOrigem(h, "/auth/definir-senha", c.corpo, ""); w.Code != 400 || !strings.Contains(w.Body.String(), c.erro) {
			t.Errorf("%.60s = %d %s", c.corpo, w.Code, w.Body)
		}
	}
	p.Exec(context.Background(), `update tokens_de_senha set expira_em = now() - interval '1 second'`)
	if w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+tok+`","senha":"nova-senha"}`, ""); w.Code != 400 {
		t.Errorf("link vencido = %d", w.Code)
	}
	tok = linkDe(t, c, cor, h, "pessoa@x.com")
	p.Exec(context.Background(), `update profiles set disabled = true where id = $1`, uid)
	if w := pedirComOrigem(h, "/auth/definir-senha", `{"token":"`+tok+`","senha":"nova-senha"}`, ""); w.Code != 400 {
		t.Errorf("conta desativada com link vivo = %d", w.Code)
	}
}

func TestTrocarSenha(t *testing.T) {
	p, s, _, _, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "antiga", `{}`)
	p.Exec(context.Background(), `update profiles set precisa_trocar_senha = true where id = $1`, uid)
	esta := entrar(t, h, "pessoa@x.com", "antiga")
	outra := entrar(t, h, "pessoa@x.com", "antiga")
	if w := chamar(h, "POST", "/auth/trocar-senha", `{"senha":"123"}`, esta); w.Code != 400 {
		t.Fatalf("senha curta = %d", w.Code)
	}
	if w := chamar(h, "POST", "/auth/trocar-senha", `{"senha":"nova-senha"}`, esta); w.Code != 204 {
		t.Fatalf("trocar = %d %s", w.Code, w.Body)
	}
	var precisa bool
	p.QueryRow(context.Background(), `select precisa_trocar_senha from profiles where id = $1`, uid).Scan(&precisa)
	if precisa {
		t.Fatal("a cobrança de troca continuou")
	}
	if _, err := s.Buscar(context.Background(), esta); err != nil {
		t.Fatalf("a sessão de quem trocou caiu: %v", err)
	}
	if _, err := s.Buscar(context.Background(), outra); err != ErrSessaoInvalida {
		t.Fatalf("a outra sessão continuou: %v", err)
	}
	entrar(t, h, "pessoa@x.com", "nova-senha")
	// sessão de "entrar como": nunca troca a senha do alvo
	usuarioComSenha(t, p, uid2, "super@x.com", "s", `{}`)
	imp := uid2
	tokImp, _ := s.Criar(context.Background(), uid, "painel", &imp)
	if w := chamar(h, "POST", "/auth/trocar-senha", `{"senha":"do-impostor"}`, tokImp); w.Code != 403 {
		t.Fatalf("impersonada = %d", w.Code)
	}
	if w := chamar(h, "POST", "/auth/entrar", `{"email":"pessoa@x.com","senha":"do-impostor"}`, ""); w.Code != 401 {
		t.Fatal("a senha mudou pela sessão impersonada")
	}
}

func TestPerfil(t *testing.T) {
	p, s, _, _, h := montarConta(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "s", `{"frota":["ver"]}`)
	tok, _ := s.Criar(context.Background(), uid, "painel", nil)
	w := chamar(h, "GET", "/eu/perfil", "", tok)
	quer := `[{"role":"viewer","features":["banco"],"avatar_url":null,"permissions":{"frota": ["ver"]},"allowed_accounts":null,"is_superadmin":false,"precisa_trocar_senha":false,"escopo_por_equipe":false}]`
	if w.Code != 200 || w.Body.String() != quer {
		t.Fatalf("= %d %s", w.Code, w.Body)
	}
	p.Exec(context.Background(), `insert into usuarios (id, email) values ($1, 'semperfil@x.com')`, uid2)
	tok2, _ := s.Criar(context.Background(), uid2, "painel", nil)
	if w := chamar(h, "GET", "/eu/perfil", "", tok2); w.Body.String() != `[]` {
		t.Fatalf("sem perfil = %s", w.Body)
	}
}
```

Em `api/internal/auth/rotas_test.go`, troque a função `TestLoginDeDesativadoPorProfilesEh401MesmoComSenhaCerta` inteira por:

```go
// Conta desativada (profiles.disabled ou usuarios.desativado_em): com a senha CERTA, 403
// conta_desativada e nenhuma sessão; com a senha ERRADA, o mesmo 401 de quem não existe.
func TestLoginDeDesativadoSoDizQueEstaDesativadoComASenhaCerta(t *testing.T) {
	for _, como := range []string{`update profiles set disabled = true where id = $1`, `update usuarios set desativado_em = now() where id = $1`} {
		p, _, h := montar(t)
		usuarioComSenha(t, p, uid, "a@x.com", "certa", `{}`)
		p.Exec(context.Background(), como, uid)
		w := chamar(h, "POST", "/auth/entrar", `{"email":"a@x.com","senha":"certa"}`, "")
		if w.Code != 403 || strings.TrimSpace(w.Body.String()) != `{"error":"conta_desativada"}` {
			t.Fatalf("%s: senha certa = %d %s", como, w.Code, w.Body)
		}
		w = chamar(h, "POST", "/auth/entrar", `{"email":"a@x.com","senha":"errada"}`, "")
		inexistente := chamar(h, "POST", "/auth/entrar", `{"email":"ninguem@x.com","senha":"errada"}`, "")
		if w.Code != 401 || w.Body.String() != inexistente.Body.String() {
			t.Fatalf("%s: senha errada = %d %s (inexistente: %s)", como, w.Code, w.Body, inexistente.Body)
		}
		var n int
		p.QueryRow(context.Background(), `select count(*) from sessoes`).Scan(&n)
		if n != 0 {
			t.Fatalf("%s: conta desativada ganhou %d sessão(ões)", como, n)
		}
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/email/ ./internal/auth/ 2>&1 | tail -5`
Expected: FAIL de compilação (`undefined: ZeptoMail`; `undefined: NovaConta`).

- [ ] **Step 3: Implementar**

Crie `api/internal/banco/migracoes/00005_tokens_de_senha.sql`:

```sql
-- +goose Up
-- Links de uso único de convite e de troca de senha (antes, do Auth do Supabase). Só o hash
-- do token é guardado; o token em claro vai uma vez, no e-mail.
create table tokens_de_senha (
  token_hash text primary key,
  usuario_id uuid not null references usuarios (id) on delete cascade,
  tipo       text not null check (tipo in ('convite', 'recuperacao')),
  criado_em  timestamptz not null default now(),
  expira_em  timestamptz not null,
  usado_em   timestamptz
);
create index tokens_de_senha_usuario_idx on tokens_de_senha (usuario_id);

-- +goose Down
drop table tokens_de_senha;
```

Crie `api/internal/email/email.go`:

```go
// Package email manda e-mail pela API do ZeptoMail (Zoho), como supabase/functions/_shared/email-zeptomail.ts:
// convite e troca de senha da Central, que antes saíam pelo Auth do Supabase.
package email

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

const URLPadrao = "https://api.zeptomail.com/v1.1/email"

var ErrSemToken = errors.New("zeptomail: ZEPTOMAIL_TOKEN ausente")

type ZeptoMail struct {
	URL, Token, De, Nome string
	HTTP                 *http.Client // nil = cliente próprio (15 s, nunca segue redirecionamento)
}

// cabecalho aceita a chave crua ou já com o esquema "Zoho-enczapikey" (o painel do Zoho entrega dos dois jeitos).
func (z *ZeptoMail) cabecalho() string {
	if strings.HasPrefix(z.Token, "Zoho-enczapikey") {
		return z.Token
	}
	return "Zoho-enczapikey " + z.Token
}

// Mandar envia UM e-mail. O erro nunca traz token, destinatário nem texto (o texto leva link
// de senha): só o status e o código do ZeptoMail, ou "rede".
func (z *ZeptoMail) Mandar(ctx context.Context, para, assunto, html, texto string) error {
	if z.Token == "" {
		return ErrSemToken
	}
	corpo, _ := json.Marshal(map[string]any{
		"from":     map[string]string{"address": z.De, "name": z.Nome},
		"to":       []any{map[string]any{"email_address": map[string]string{"address": para}}},
		"subject":  assunto,
		"htmlbody": html,
		"textbody": texto,
	})
	url := z.URL
	if url == "" {
		url = URLPadrao
	}
	req, err := http.NewRequestWithContext(ctx, "POST", url, bytes.NewReader(corpo))
	if err != nil {
		return errors.New("zeptomail: pedido inválido")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Authorization", z.cabecalho())
	cli := z.HTTP
	if cli == nil {
		cli = &http.Client{Timeout: 15 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	resp, err := cli.Do(req)
	if err != nil {
		return errors.New("zeptomail: rede") // *url.Error traz a URL; nada dele sai daqui
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}
	var e struct {
		Error struct{ Code string } `json:"error"`
	}
	json.NewDecoder(io.LimitReader(resp.Body, 64<<10)).Decode(&e)
	return fmt.Errorf("zeptomail: recusou (%d %s)", resp.StatusCode, e.Error.Code)
}
```

Crie `api/internal/auth/conta.go`:

```go
package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// Prazos dos links de uso único: troca de senha 1 h (o padrão do Auth do Supabase); convite
// 24 h (quem é convidado nem sempre abre o e-mail na mesma hora).
const (
	PrazoRecuperacao = time.Hour
	PrazoConvite     = 24 * time.Hour
	SenhaMinima      = 6  // a mesma regra da tela e do Auth do Supabase
	SenhaMaxima      = 72 // bcrypt ignora o que passa de 72 bytes: recusar é mais honesto que cortar
)

// Mandador é quem envia e-mail (email.ZeptoMail; os testes trocam).
type Mandador interface {
	Mandar(ctx context.Context, para, assunto, html, texto string) error
}

// Conta: troca de senha, links de uso único e o perfil de quem está logado.
type Conta struct {
	Pool      *pgxpool.Pool
	Sessoes   *Store
	Email     Mandador
	Enderecos []string // ENDERECOS_DO_APP: para onde o link pode levar (texto exato)
	Padrao    string   // ENDERECO_PADRAO
	PorIP     *Limitador
	PorEmail  *Limitador
	enviando  chan struct{} // testes: avisa quando o envio assíncrono termina
}

func NovaConta(p *pgxpool.Pool, s *Store, m Mandador, enderecos []string, padrao string) *Conta {
	lim := func(max int) *Limitador {
		l := NovoLimitador()
		l.Max, l.Janela = max, 15*time.Minute
		return l
	}
	return &Conta{Pool: p, Sessoes: s, Email: m, Enderecos: enderecos, Padrao: padrao, PorIP: lim(20), PorEmail: lim(5)}
}

// destino: a origem do pedido se for um dos endereços do app; senão o padrão. Nunca o que o
// pedido mandou sem conferir (link de senha para site de terceiro).
func (c *Conta) destino(r *http.Request) string {
	if o := r.Header.Get("Origin"); slices.Contains(c.Enderecos, o) {
		return o
	}
	return c.Padrao
}

func tokenAleatorio() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// novoLink grava um token de uso único (apagando os anteriores não usados do mesmo tipo) e
// devolve o link em claro.
func novoLink(ctx context.Context, tx pgx.Tx, usuarioID, tipo, base string, prazo time.Duration) (string, error) {
	tok, err := tokenAleatorio()
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `delete from tokens_de_senha where usuario_id = $1::uuid and tipo = $2::text and usado_em is null`, usuarioID, tipo); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `insert into tokens_de_senha (token_hash, usuario_id, tipo, expira_em) values ($1::text, $2::uuid, $3::text, now() + make_interval(secs => $4::int))`,
		hashDoToken(tok), usuarioID, tipo, int(prazo.Seconds())); err != nil {
		return "", err
	}
	return base + "/#type=" + map[string]string{"convite": "invite", "recuperacao": "recovery"}[tipo] + "&token=" + tok, nil
}

func validarSenha(s string) string {
	switch {
	case len(s) < SenhaMinima:
		return "A senha deve ter ao menos 6 caracteres."
	case len(s) > SenhaMaxima:
		return "A senha pode ter no máximo 72 caracteres."
	}
	return ""
}

func erroComMensagem(w http.ResponseWriter, status int, codigo, mensagem string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": codigo, "mensagem": mensagem})
}

// EsqueciSenha: POST /auth/esqueci-senha {email} (público). Responde SEMPRE 202 igual, exista
// a conta ou não (sem enumeração), e manda o e-mail fora da requisição (o tempo de resposta
// também não entrega quem tem conta).
func (c *Conta) EsqueciSenha(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in)
	email := strings.ToLower(strings.TrimSpace(in.Email))
	if email == "" || len(email) > 254 {
		erroJSON(w, http.StatusBadRequest, "pedido_invalido")
		return
	}
	if !(c.PorIP.Tentar(ipDe(r)) && c.PorEmail.Tentar(email)) {
		erroJSON(w, http.StatusTooManyRequests, "muitas_tentativas")
		return
	}
	base := c.destino(r)
	go func() {
		defer func() {
			if c.enviando != nil {
				c.enviando <- struct{}{}
			}
		}()
		ctx, cancela := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancela()
		var id string
		err := c.Pool.QueryRow(ctx, `select u.id::text from usuarios u left join profiles p on p.id = u.id
		   where lower(u.email) = $1::text and u.desativado_em is null and not coalesce(p.disabled, false)`, email).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return
		}
		var link string
		if err == nil {
			err = pgx.BeginFunc(ctx, c.Pool, func(tx pgx.Tx) error {
				var e error
				link, e = novoLink(ctx, tx, id, "recuperacao", base, PrazoRecuperacao)
				return e
			})
		}
		if err == nil {
			err = c.Email.Mandar(ctx, email, "Troque a sua senha da Central",
				`<p>Para criar uma senha nova, abra o link abaixo (vale por 1 hora):</p><p><a href="`+link+`">Criar senha nova</a></p>`,
				"Para criar uma senha nova, abra o link (vale por 1 hora): "+link)
		}
		if err != nil {
			slog.Error("esqueci-senha: não enviei o link", "usuario", id, "erro", err.Error())
		}
	}()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"ok":true}`))
}

// DefinirSenha: POST /auth/definir-senha {token, senha} (público). Consome o link (convite ou
// troca), grava a senha, derruba as outras sessões da pessoa e já devolve uma sessão nova.
func (c *Conta) DefinirSenha(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
		Senha string `json:"senha"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in)
	if in.Token == "" || len(in.Token) > 100 {
		erroJSON(w, http.StatusBadRequest, "pedido_invalido")
		return
	}
	if msg := validarSenha(in.Senha); msg != "" {
		erroComMensagem(w, http.StatusBadRequest, "senha_invalida", msg)
		return
	}
	if !c.PorIP.Tentar(ipDe(r)) {
		erroJSON(w, http.StatusTooManyRequests, "muitas_tentativas")
		return
	}
	hash, err := HashDaSenha(in.Senha)
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	var id string
	err = pgx.BeginFunc(r.Context(), c.Pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `select t.usuario_id::text from tokens_de_senha t
		     join usuarios u on u.id = t.usuario_id left join profiles p on p.id = u.id
		    where t.token_hash = $1::text and t.usado_em is null and t.expira_em > now()
		      and u.desativado_em is null and not coalesce(p.disabled, false)
		    for update of t`, hashDoToken(in.Token)).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `update usuarios set senha_hash = $2::text, email_confirmado_em = coalesce(email_confirmado_em, now()) where id = $1::uuid`, id, hash); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `update tokens_de_senha set usado_em = now() where token_hash = $1::text`, hashDoToken(in.Token)); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `delete from tokens_de_senha where usuario_id = $1::uuid and usado_em is null`, id); err != nil {
			return err
		}
		_, err := tx.Exec(r.Context(), `delete from sessoes where usuario_id = $1::uuid`, id)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		erroComMensagem(w, http.StatusBadRequest, "token_invalido", "Este link é inválido ou já venceu. Peça um novo.")
		return
	}
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	token, err := c.Sessoes.Criar(r.Context(), id, "painel", nil)
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

// TrocarSenha: POST /auth/trocar-senha {senha} (sessão). Grava a senha, tira a cobrança de
// troca (precisa_trocar_senha) e derruba as OUTRAS sessões da pessoa. Sessão de "entrar como"
// nunca troca a senha de ninguém.
func (c *Conta) TrocarSenha(w http.ResponseWriter, r *http.Request) {
	a := AtorDoContexto(r.Context())
	if a.ImpersonadorID != nil {
		erroComMensagem(w, http.StatusForbidden, "sem_permissao", "Quem entrou como outra pessoa não troca a senha dela.")
		return
	}
	var in struct {
		Senha string `json:"senha"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in)
	if msg := validarSenha(in.Senha); msg != "" {
		erroComMensagem(w, http.StatusBadRequest, "senha_invalida", msg)
		return
	}
	hash, err := HashDaSenha(in.Senha)
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	err = banco.ComUsuario(r.Context(), c.Pool, a.ID, func(tx pgx.Tx) error { // gatilhos de profiles veem quem
		if _, err := tx.Exec(r.Context(), `update usuarios set senha_hash = $2::text where id = $1::uuid`, a.ID, hash); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `update profiles set precisa_trocar_senha = false where id = $1::uuid`, a.ID); err != nil {
			return err
		}
		_, err := tx.Exec(r.Context(), `delete from sessoes where usuario_id = $1::uuid and token_hash <> $2::text`, a.ID, hashDoToken(tokenDe(r)))
		return err
	})
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Perfil: GET /eu/perfil (sessão) -> o mesmo array que a tela lia de
// profiles?id=eq.<eu>&select=role,features,...: [] quando não há perfil.
func (c *Conta) Perfil(w http.ResponseWriter, r *http.Request) {
	var corpo []byte
	err := c.Pool.QueryRow(r.Context(), `select coalesce(json_agg(t), '[]'::json) from (
	    select role, features, avatar_url, permissions, allowed_accounts, is_superadmin, precisa_trocar_senha, escopo_por_equipe
	      from profiles where id = $1::uuid) t`, AtorDoContexto(r.Context()).ID).Scan(&corpo)
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(corpo)
}
```

Em `api/internal/auth/rotas.go`, dentro de `Entrar`, troque:

```go
	var id, hash string
	err := h.pool.QueryRow(r.Context(),
		`select u.id::text, coalesce(u.senha_hash, '')
		   from usuarios u left join profiles p on p.id = u.id
		  where lower(u.email) = $1 and u.desativado_em is null and not coalesce(p.disabled, false)`, email).
		Scan(&id, &hash)
```

por:

```go
	var id, hash string
	var ativa bool
	err := h.pool.QueryRow(r.Context(),
		`select u.id::text, coalesce(u.senha_hash, ''), u.desativado_em is null and not coalesce(p.disabled, false)
		   from usuarios u left join profiles p on p.id = u.id
		  where lower(u.email) = $1::text`, email).
		Scan(&id, &hash, &ativa)
```

e, logo depois do bloco `if !SenhaConfere(hash, in.Senha) || id == "" { … return }`, acrescente:

```go
	// Só com a senha CERTA a conta desativada fica sabendo que foi desativada (a tela mostra
	// "fale com quem administra"); senha errada continua o 401 de sempre (sem oráculo).
	if !ativa {
		erroJSON(w, http.StatusForbidden, "conta_desativada")
		return
	}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l ./internal && go vet ./... && go test -count=1 -race -v ./internal/email/ ./internal/auth/ 2>&1 | grep -E '^(--- (FAIL|SKIP)|ok|FAIL)'`
Expected: só `ok` (o pacote `auth` leva ~2 min com `-race`: bcrypt). `go test ./...` continua todo `ok` (a migração 00005 entra em todo banco de teste).

- [ ] **Step 5: Commit**

```bash
git add api/internal/banco/migracoes/00005_tokens_de_senha.sql api/internal/email/ api/internal/auth/conta.go api/internal/auth/conta_test.go api/internal/auth/rotas.go api/internal/auth/rotas_test.go api/internal/testebanco/testebanco.go
git commit -m "feat(api): links de senha de uso único por e-mail, trocar senha e conta desativada no login

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: `POST /invite-user`

**Revisor:** **opus** (criar, excluir e trocar a senha de contas).

Mesmo corpo e mesmas respostas da edge `invite-user` (`{success:true}`; erro = `400 {"error": "<frase da edge>"}`, que a tela mostra): portão papel `admin` (antes de ler o corpo, como a edge); `resetPasswordUserId` só para super-admin pela ficha, senha provisória (`precisa_trocar_senha = true`) e, a mais que a edge, derruba as sessões do alvo (Ruling 20); `deleteUserId` (não a própria conta) apaga `profiles` e `usuarios`; criar com senha (6+) confirma o e-mail e faz upsert do perfil; sem senha, convida por e-mail (link de 24 h) ou, se a conta já existe, manda o link de troca (como a edge fazia no "already registered"). Papel diferente de `admin` vira `viewer`. Sessão de "entrar como" não administra contas. Toda escrita em `banco.ComUsuario` (os gatilhos de `profiles` registram quem mexeu).

**Files:**
- Create: `api/internal/auth/convite.go`
- Test: `api/internal/auth/convite_test.go`

**Interfaces:**
- Consumes: `Conta`, `novoLink`, `PrazoRecuperacao`, `PrazoConvite`, `SenhaMinima`, `SenhaMaxima`, `destino` (Task 7); `HashDaSenha`, `erroJSON`; `banco.ComUsuario`; o `correio` e o `montarConta` de `conta_test.go`.
- Produces: `(*Conta).InviteUser`; `falhaDaEdge(w, msg)` e `sucesso(w)` (usadas na Task 9); `reUUIDConta`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `api/internal/auth/convite_test.go`:

```go
package auth

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func montarConvite(t *testing.T) (*Conta, *correio, http.Handler, map[string]string) {
	t.Helper()
	p, s, c, cor, _ := montarConta(t)
	r := chi.NewRouter()
	r.Post("/auth/entrar", NovosHandlers(p, s, NovoLimitador()).Entrar)
	r.Post("/auth/definir-senha", c.DefinirSenha)
	r.With(Exigir(p, s)).Post("/invite-user", c.InviteUser)
	ctx := context.Background()
	toks := map[string]string{}
	for i, u := range []struct {
		nome, role string
		super      bool
	}{{"viewer", "viewer", false}, {"admin", "admin", false}, {"super", "admin", true}} {
		id := "33333333-3333-4333-a333-33333333333" + string(rune('0'+i))
		usuarioComSenha(t, p, id, u.nome+"@x.com", "s3nha", `{}`)
		p.Exec(ctx, `update profiles set role = $2::text, is_superadmin = $3::boolean where id = $1::uuid`, id, u.role, u.super)
		toks[u.nome], _ = s.Criar(ctx, id, "painel", nil)
		toks[u.nome+"-id"] = id
	}
	imp := toks["super-id"]
	toks["admin-impersonado"], _ = s.Criar(ctx, toks["admin-id"], "painel", &imp)
	return c, cor, r, toks
}

func TestInviteUserPortaoEContrato(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	casos := []struct {
		quem, corpo, quer string
	}{
		{"viewer", `{"email":"novo@x.com"}`, `{"error":"Apenas administradores podem realizar esta ação"}`},
		{"viewer", `lixo`, `{"error":"Apenas administradores podem realizar esta ação"}`},
		{"admin-impersonado", `{"email":"novo@x.com"}`, `{"error":"Quem entrou como outra pessoa não administra contas."}`},
		{"admin", `{}`, `{"error":"Email obrigatório"}`},
		{"admin", `{"email":"sem-arroba"}`, `{"error":"E-mail inválido"}`},
		{"admin", `{"resetPasswordUserId":"` + toks["viewer-id"] + `","password":"nova-senha"}`, `{"error":"Apenas superadmin pode trocar a senha de usuários"}`},
		{"super", `{"resetPasswordUserId":"` + toks["viewer-id"] + `","password":"123"}`, `{"error":"A senha precisa de no mínimo 6 caracteres"}`},
		{"super", `{"resetPasswordUserId":"44444444-4444-4444-a444-444444444444","password":"nova-senha"}`, `{"error":"Usuário não encontrado"}`},
		{"super", `{"resetPasswordUserId":"x' or '1'='1","password":"nova-senha"}`, `{"error":"Usuário não encontrado"}`},
		{"admin", `{"deleteUserId":"` + toks["admin-id"] + `"}`, `{"error":"Não é possível excluir sua própria conta"}`},
		{"admin", `{"email":"viewer@x.com","password":"outra-senha"}`, `{"error":"A user with this email address has already been registered"}`},
	}
	for _, k := range casos {
		w := chamar(h, "POST", "/invite-user", k.corpo, toks[k.quem])
		if w.Code != 400 || strings.TrimSpace(w.Body.String()) != k.quer {
			t.Errorf("%s %s = %d %s", k.quem, k.corpo, w.Code, w.Body)
		}
	}
	var n int
	c.Pool.QueryRow(context.Background(), `select count(*) from usuarios where email = 'novo@x.com'`).Scan(&n)
	if n != 0 {
		t.Fatal("recusado e mesmo assim criou")
	}
	if w := chamar(h, "POST", "/invite-user", `{}`, ""); w.Code != 401 {
		t.Fatalf("sem sessão = %d", w.Code)
	}
}

func TestInviteUserCriaComSenhaEConvida(t *testing.T) {
	c, cor, h, toks := montarConvite(t)
	ctx := context.Background()
	if w := chamar(h, "POST", "/invite-user", `{"email":" Com.Senha@x.com","name":"Ana","role":"superadmin","password":"senha-boa"}`, toks["admin"]); w.Code != 200 || w.Body.String() != `{"success":true}` {
		t.Fatalf("criar com senha = %d %s", w.Code, w.Body)
	}
	var papel, nome string
	c.Pool.QueryRow(ctx, `select p.role, p.name from profiles p join usuarios u on u.id = p.id where u.email = 'com.senha@x.com'`).Scan(&papel, &nome)
	if papel != "viewer" || nome != "Ana" {
		t.Fatalf("papel=%q nome=%q (papel desconhecido vira viewer)", papel, nome)
	}
	entrar(t, h, "com.senha@x.com", "senha-boa")

	// sem senha: convite por e-mail; ninguém entra antes de definir a senha
	if w := chamar(h, "POST", "/invite-user", `{"email":"convidado@x.com","role":"admin"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("convite = %d %s", w.Code, w.Body)
	}
	env := cor.lista()
	m := reLink.FindStringSubmatch(env[len(env)-1].texto)
	if env[len(env)-1].para != "convidado@x.com" || m == nil || m[2] != "invite" || m[1] != padrao {
		t.Fatalf("e-mail = %+v", env[len(env)-1])
	}
	for _, senha := range []string{"", "x", "qualquer"} {
		if w := chamar(h, "POST", "/auth/entrar", `{"email":"convidado@x.com","senha":"`+senha+`"}`, ""); w.Code == 200 {
			t.Fatalf("convidado entrou com %q antes de definir a senha", senha)
		}
	}
	var horas float64
	c.Pool.QueryRow(ctx, `select extract(epoch from expira_em - now()) / 3600 from tokens_de_senha where tipo = 'convite'`).Scan(&horas)
	if horas < 23.9 || horas > 24 {
		t.Fatalf("convite vale %.2f h", horas)
	}
	if w := chamar(h, "POST", "/auth/definir-senha", `{"token":"`+m[3]+`","senha":"minha-senha"}`, ""); w.Code != 200 {
		t.Fatalf("definir pelo convite = %d %s", w.Code, w.Body)
	}
	entrar(t, h, "convidado@x.com", "minha-senha")

	// convidar quem já existe manda o link de troca, sem criar outra conta
	if w := chamar(h, "POST", "/invite-user", `{"email":"viewer@x.com"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("convite de existente = %d", w.Code)
	}
	env = cor.lista()
	if m := reLink.FindStringSubmatch(env[len(env)-1].texto); m == nil || m[2] != "recovery" {
		t.Fatalf("existente recebeu %+v", env[len(env)-1])
	}
	// e-mail que não sai vira erro na tela
	cor.falhar = true
	if w := chamar(h, "POST", "/invite-user", `{"email":"outro@x.com"}`, toks["admin"]); w.Code != 400 || !strings.Contains(w.Body.String(), "Não consegui enviar o e-mail") {
		t.Fatalf("falha de envio = %d %s", w.Code, w.Body)
	}
}

func TestInviteUserTrocaSenhaProvisoriaEExclui(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	ctx := context.Background()
	if w := chamar(h, "POST", "/invite-user", `{"resetPasswordUserId":"`+toks["viewer-id"]+`","password":"provisoria"}`, toks["super"]); w.Code != 200 {
		t.Fatalf("reset = %d %s", w.Code, w.Body)
	}
	var precisa bool
	c.Pool.QueryRow(ctx, `select precisa_trocar_senha from profiles where id = $1::uuid`, toks["viewer-id"]).Scan(&precisa)
	if !precisa {
		t.Fatal("senha posta por outra pessoa tem de ser provisória")
	}
	if _, err := c.Sessoes.Buscar(ctx, toks["viewer"]); err != ErrSessaoInvalida {
		t.Fatalf("a sessão do alvo continuou: %v", err)
	}
	entrar(t, h, "viewer@x.com", "provisoria")
	if w := chamar(h, "POST", "/invite-user", `{"deleteUserId":"`+toks["viewer-id"]+`"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("excluir = %d %s", w.Code, w.Body)
	}
	var n int
	c.Pool.QueryRow(ctx, `select (select count(*) from usuarios where id = $1::uuid) + (select count(*) from profiles where id = $1::uuid)`, toks["viewer-id"]).Scan(&n)
	if n != 0 {
		t.Fatalf("sobrou %d linha(s) do excluído", n)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -run InviteUser ./internal/auth/ 2>&1 | tail -3`
Expected: FAIL de compilação (`c.InviteUser undefined`).

- [ ] **Step 3: Implementar**

Crie `api/internal/auth/convite.go`:

```go
package auth

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

var (
	reUUIDConta    = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	reEmailSimples = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
)

// falhaDaEdge: o contrato de erro de invite-user e entrar-como-usuario (400 {"error": frase}),
// que a tela mostra como está.
func falhaDaEdge(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func sucesso(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

// InviteUser: POST /invite-user, o mesmo corpo e as mesmas respostas da edge invite-user:
// convidar (com ou sem senha), excluir (deleteUserId) e, só super-admin, trocar a senha de
// alguém (resetPasswordUserId, que fica provisória: precisa_trocar_senha). Portão: papel admin.
// Sessão de "entrar como" não administra contas.
func (c *Conta) InviteUser(w http.ResponseWriter, r *http.Request) {
	a := AtorDoContexto(r.Context())
	if a.ImpersonadorID != nil {
		falhaDaEdge(w, "Quem entrou como outra pessoa não administra contas.")
		return
	}
	if a.Papel != "admin" {
		falhaDaEdge(w, "Apenas administradores podem realizar esta ação")
		return
	}
	var in struct {
		Email, Name, Role, Password, DeleteUserId, ResetPasswordUserId string
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in) != nil {
		falhaDaEdge(w, "Pedido inválido")
		return
	}
	ctx := r.Context()
	switch {
	case in.ResetPasswordUserId != "":
		if !a.SuperAdmin {
			falhaDaEdge(w, "Apenas superadmin pode trocar a senha de usuários")
			return
		}
		if len(in.Password) < SenhaMinima {
			falhaDaEdge(w, "A senha precisa de no mínimo 6 caracteres")
			return
		}
		if len(in.Password) > SenhaMaxima {
			falhaDaEdge(w, "A senha pode ter no máximo 72 caracteres.")
			return
		}
		if !reUUIDConta.MatchString(in.ResetPasswordUserId) {
			falhaDaEdge(w, "Usuário não encontrado")
			return
		}
		hash, err := HashDaSenha(in.Password)
		if err != nil {
			erroJSON(w, http.StatusInternalServerError, "erro_interno")
			return
		}
		achou := false
		err = banco.ComUsuario(ctx, c.Pool, a.ID, func(tx pgx.Tx) error {
			tag, err := tx.Exec(ctx, `update usuarios set senha_hash = $2::text where id = $1::uuid`, in.ResetPasswordUserId, hash)
			if err != nil || tag.RowsAffected() == 0 {
				return err
			}
			achou = true
			// senha posta por outra pessoa é PROVISÓRIA (a tela cobra a troca) e derruba as sessões do alvo
			if _, err := tx.Exec(ctx, `update profiles set precisa_trocar_senha = true where id = $1::uuid`, in.ResetPasswordUserId); err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `delete from sessoes where usuario_id = $1::uuid`, in.ResetPasswordUserId)
			return err
		})
		switch {
		case err != nil:
			erroJSON(w, http.StatusInternalServerError, "erro_interno")
		case !achou:
			falhaDaEdge(w, "Usuário não encontrado")
		default:
			sucesso(w)
		}
		return

	case in.DeleteUserId != "":
		if in.DeleteUserId == a.ID {
			falhaDaEdge(w, "Não é possível excluir sua própria conta")
			return
		}
		if !reUUIDConta.MatchString(in.DeleteUserId) {
			falhaDaEdge(w, "Usuário não encontrado")
			return
		}
		err := banco.ComUsuario(ctx, c.Pool, a.ID, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `delete from profiles where id = $1::uuid`, in.DeleteUserId); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `delete from usuarios where id = $1::uuid`, in.DeleteUserId)
			return err
		})
		var pe *pgconn.PgError
		switch {
		case errors.As(err, &pe) && pe.Code == "23503":
			falhaDaEdge(w, "Não é possível excluir: ainda há registros ligados a esta pessoa.")
		case err != nil:
			erroJSON(w, http.StatusInternalServerError, "erro_interno")
		default:
			sucesso(w)
		}
		return
	}

	email := strings.ToLower(strings.TrimSpace(in.Email))
	if email == "" {
		falhaDaEdge(w, "Email obrigatório")
		return
	}
	if len(email) > 254 || !reEmailSimples.MatchString(email) {
		falhaDaEdge(w, "E-mail inválido")
		return
	}
	papel := "viewer"
	if in.Role == "admin" {
		papel = "admin"
	}
	var existente string
	if err := c.Pool.QueryRow(ctx, `select id::text from usuarios where lower(email) = $1::text`, email).Scan(&existente); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}

	if len(in.Password) >= SenhaMinima { // criar já com senha (a edge: password && length >= 6)
		if len(in.Password) > SenhaMaxima {
			falhaDaEdge(w, "A senha pode ter no máximo 72 caracteres.")
			return
		}
		if existente != "" {
			falhaDaEdge(w, "A user with this email address has already been registered")
			return
		}
		hash, err := HashDaSenha(in.Password)
		if err != nil {
			erroJSON(w, http.StatusInternalServerError, "erro_interno")
			return
		}
		if err := banco.ComUsuario(ctx, c.Pool, a.ID, func(tx pgx.Tx) error {
			var id string
			if err := tx.QueryRow(ctx, `insert into usuarios (id, email, senha_hash, email_confirmado_em)
			    values (gen_random_uuid(), $1::text, $2::text, now()) returning id::text`, email, hash).Scan(&id); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `insert into profiles (id, email, name, role) values ($1::uuid, $2::text, $3::text, $4::text)
			    on conflict (id) do update set email = excluded.email, name = excluded.name, role = excluded.role`, id, email, in.Name, papel)
			return err
		}); err != nil {
			erroJSON(w, http.StatusInternalServerError, "erro_interno")
			return
		}
		sucesso(w)
		return
	}

	// Convite por e-mail. Quem já tem conta recebe o link de troca de senha (como a edge fazia
	// quando o Auth respondia "already registered").
	base := c.destino(r)
	var link, assunto, frase string
	err := banco.ComUsuario(ctx, c.Pool, a.ID, func(tx pgx.Tx) error {
		var err error
		if existente != "" {
			link, err = novoLink(ctx, tx, existente, "recuperacao", base, PrazoRecuperacao)
			assunto, frase = "Troque a sua senha da Central", "Para criar uma senha nova, abra o link (vale por 1 hora): "
			return err
		}
		var id string
		if err := tx.QueryRow(ctx, `insert into usuarios (id, email) values (gen_random_uuid(), $1::text) returning id::text`, email).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into profiles (id, email, name, role) values ($1::uuid, $2::text, $3::text, $4::text)
		    on conflict (id) do nothing`, id, email, in.Name, papel); err != nil {
			return err
		}
		link, err = novoLink(ctx, tx, id, "convite", base, PrazoConvite)
		assunto, frase = "Você foi convidado para a Central", "Você foi convidado! Crie a sua senha pelo link (vale por 24 horas): "
		return err
	})
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	if err := c.Email.Mandar(ctx, email, assunto, `<p>`+frase+`</p><p><a href="`+link+`">Abrir a Central</a></p>`, frase+link); err != nil {
		slog.Error("invite-user: e-mail não saiu", "erro", err.Error())
		falhaDaEdge(w, "Não consegui enviar o e-mail. Tente de novo.")
		return
	}
	sucesso(w)
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l ./internal && go vet ./internal/auth/ && go test -count=1 -race -v -run InviteUser ./internal/auth/ 2>&1 | grep -E '^(--- |ok|FAIL)'`
Expected: os 3 testes `--- PASS`; `ok`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/auth/convite.go api/internal/auth/convite_test.go
git commit -m "feat(api): POST /invite-user com o contrato e o portão da edge

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 9: `POST /entrar-como-usuario` e `POST /conferir-senha`

**Revisor:** **opus** (impersonação auditada; conferência de senha que não pode virar oráculo).

"Entrar como": só super-admin pela ficha; recusas com as frases e a ordem de `_shared/checagem-de-entrar-como.js`; a auditoria em `entradas_como_outro_usuario` é gravada ANTES de existir sessão (falhou = nenhuma sessão, mensagem sem detalhe do banco); a sessão nova é do alvo, marcada com `impersonador_id`, vale 1 h e não renova (o `Store.Buscar` do Plano 1 já não renova sessão impersonada); sessão impersonada não encadeia. Resposta `{token, expira_em}` (a edge devolvia tokens do Supabase: o front muda no Plano 7). "Conferir senha": a pessoa sai da sessão, nunca do corpo; contrato da edge (`{ok:true}`; `{ok:false, erro:"senha_incorreta", restam}`; 5 erros = `429 bloqueado` por 10 min com `bloqueado_ate` no formato do `toISOString` do JS; `400 sem_senha`; `500 falha_interna` sem a mensagem do erro); sessão impersonada = `403 {"error":"sem_permissao","mensagem":<frase>}` (o super-admin não assina checklist pelo alvo). Contagem em memória por pessoa, como a edge (Ruling 22).

**Files:**
- Modify: `api/internal/auth/sessoes.go` (`CriarComPrazo`)
- Modify: `api/internal/auth/conta.go` (campo `conferir`)
- Create: `api/internal/auth/entrar_como.go`
- Test: `api/internal/auth/entrar_como_test.go`

**Interfaces:**
- Consumes: `Conta`, `falhaDaEdge`, `reUUIDConta`, `hashFalso`, `SenhaConfere` (Tasks 7–8 e Plano 1).
- Produces: `(*auth.Store).CriarComPrazo(ctx, usuarioID, tipo string, impersonadorID *string, ttl time.Duration) (string, error)`; `auth.PrazoEntrarComo = time.Hour`; `auth.ErrosAteBloquear = 5`; `auth.Bloqueio = 10 * time.Minute`; `(*Conta).EntrarComo`, `(*Conta).ConferirSenha`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `api/internal/auth/entrar_como_test.go`:

```go
package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func montarEntrarComo(t *testing.T) (*pgxpool.Pool, *Store, *Conta, http.Handler, map[string]string) {
	t.Helper()
	p, s, c, _, _ := montarConta(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table entradas_como_outro_usuario (id bigserial primary key, admin_id uuid, admin_email text,
		alvo_id uuid, alvo_email text, quando timestamptz not null default now())`); err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(Exigir(p, s))
		r.Post("/entrar-como-usuario", c.EntrarComo)
		r.Post("/conferir-senha", c.ConferirSenha)
		r.Get("/auth/eu", NovosHandlers(p, s, NovoLimitador()).Eu)
	})
	ids := map[string]string{}
	for i, u := range []struct {
		nome         string
		super, desat bool
	}{{"super", true, false}, {"admin", false, false}, {"alvo", false, false}, {"desativado", false, true}, {"outro-super", true, false}} {
		id := "55555555-5555-4555-a555-55555555555" + string(rune('0'+i))
		usuarioComSenha(t, p, id, u.nome+"@x.com", "senha-"+u.nome, `{}`)
		p.Exec(ctx, `update profiles set is_superadmin = $2::boolean, disabled = $3::boolean, role = 'admin' where id = $1::uuid`, id, u.super, u.desat)
		ids[u.nome] = id
		if !u.desat {
			ids["tok-"+u.nome], _ = s.Criar(ctx, id, "painel", nil)
		}
	}
	return p, s, c, r, ids
}

func TestEntrarComoRecusasNaOrdemDaEdge(t *testing.T) {
	p, _, _, h, ids := montarEntrarComo(t)
	casos := []struct{ quem, alvo, quer string }{
		{"admin", ids["alvo"], "Apenas super-admin pode entrar como outro usuário"},
		{"admin", ids["admin"], "Apenas super-admin pode entrar como outro usuário"}, // quem pede vem antes do alvo
		{"super", ids["super"], "Você já é você — não precisa entrar como si mesmo"},
		{"super", "66666666-6666-4666-a666-666666666666", "Não encontrei essa pessoa"},
		{"super", "nao-e-uuid", "Não encontrei essa pessoa"},
		{"super", ids["desativado"], "Conta desativada — reative antes de entrar como ela"},
		{"super", "", "Faltou alvoId"},
	}
	for _, c := range casos {
		w := chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+c.alvo+`"}`, ids["tok-"+c.quem])
		var o struct{ Error string }
		json.Unmarshal(w.Body.Bytes(), &o)
		if w.Code != 400 || o.Error != c.quer {
			t.Errorf("%s -> %s = %d %s", c.quem, c.alvo, w.Code, w.Body)
		}
	}
	var n int
	p.QueryRow(context.Background(), `select (select count(*) from entradas_como_outro_usuario) + (select count(*) from sessoes where impersonador_id is not null)`).Scan(&n)
	if n != 0 {
		t.Fatalf("recusa deixou %d auditoria/sessão", n)
	}
}

func TestEntrarComoAuditaAntesEDaUmaHoraSemRenovar(t *testing.T) {
	p, s, _, h, ids := montarEntrarComo(t)
	ctx := context.Background()
	w := chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["alvo"]+`"}`, ids["tok-super"])
	var o struct {
		Token    string `json:"token"`
		ExpiraEm string `json:"expira_em"`
	}
	json.Unmarshal(w.Body.Bytes(), &o)
	if w.Code != 200 || o.Token == "" || o.ExpiraEm == "" {
		t.Fatalf("= %d %s", w.Code, w.Body)
	}
	var admin, alvo, adminEmail, alvoEmail string
	p.QueryRow(ctx, `select admin_id::text, alvo_id::text, admin_email, alvo_email from entradas_como_outro_usuario`).Scan(&admin, &alvo, &adminEmail, &alvoEmail)
	if admin != ids["super"] || alvo != ids["alvo"] || adminEmail != "super@x.com" || alvoEmail != "alvo@x.com" {
		t.Fatalf("auditoria = %s %s %s %s", admin, alvo, adminEmail, alvoEmail)
	}
	se, err := s.Buscar(ctx, o.Token)
	if err != nil || se.UsuarioID != ids["alvo"] || se.ImpersonadorID == nil || *se.ImpersonadorID != ids["super"] {
		t.Fatalf("sessão = %+v %v", se, err)
	}
	if d := time.Until(se.ExpiraEm); d < 59*time.Minute || d > time.Hour {
		t.Fatalf("a sessão impersonada vale %v", d)
	}
	// não encadeia: a sessão impersonada (de um alvo super-admin) não entra como outra pessoa
	w = chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["outro-super"]+`"}`, ids["tok-super"])
	json.Unmarshal(w.Body.Bytes(), &o)
	w = chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["admin"]+`"}`, o.Token)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "Sua sessão já é de outra pessoa") {
		t.Fatalf("encadeou: %d %s", w.Code, w.Body)
	}
	// sem a tabela de auditoria: nenhuma sessão nasce
	p.Exec(ctx, `drop table entradas_como_outro_usuario`)
	var antes, depois int
	p.QueryRow(ctx, `select count(*) from sessoes`).Scan(&antes)
	w = chamar(h, "POST", "/entrar-como-usuario", `{"alvoId":"`+ids["admin"]+`"}`, ids["tok-super"])
	p.QueryRow(ctx, `select count(*) from sessoes`).Scan(&depois)
	if w.Code != 400 || depois != antes || strings.Contains(w.Body.String(), "relation") {
		t.Fatalf("auditoria falhou e: %d %s (sessões %d -> %d)", w.Code, w.Body, antes, depois)
	}
}

func TestConferirSenha(t *testing.T) {
	_, s, c, h, ids := montarEntrarComo(t)
	agora := time.Date(2026, 10, 11, 12, 0, 0, 0, time.UTC)
	c.conferir.agora = func() time.Time { return agora }
	tok := ids["tok-admin"]
	pedir := func(corpo, token string) (int, string) {
		w := chamar(h, "POST", "/conferir-senha", corpo, token)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	if c, b := pedir(`{"senha":"senha-admin"}`, tok); c != 200 || b != `{"ok":true}` {
		t.Fatalf("certa = %d %s", c, b)
	}
	// a senha é de QUEM ESTÁ NA SESSÃO: a senha de outra pessoa (mesmo com e-mail no corpo) não vale
	if c, b := pedir(`{"senha":"senha-super","email":"super@x.com"}`, tok); c != 200 || b != `{"erro":"senha_incorreta","ok":false,"restam":4}` {
		t.Fatalf("senha de outro = %d %s", c, b)
	}
	for i := 3; i >= 0; i-- {
		if c, b := pedir(`{"senha":"errada"}`, tok); c != 200 || !strings.Contains(b, `"restam":`+string(rune('0'+i))) {
			t.Fatalf("erro %d = %d %s", 5-i, c, b)
		}
	}
	if c, b := pedir(`{"senha":"senha-admin"}`, tok); c != 429 || b != `{"bloqueado_ate":"2026-10-11T12:10:00.000Z","erro":"bloqueado","ok":false}` {
		t.Fatalf("bloqueado = %d %s", c, b)
	}
	if c, _ := pedir(`{"senha":"senha-alvo"}`, ids["tok-alvo"]); c != 200 {
		t.Fatal("o bloqueio de uma pessoa travou outra")
	}
	agora = agora.Add(Bloqueio)
	if c, b := pedir(`{"senha":"senha-admin"}`, tok); c != 200 || b != `{"ok":true}` {
		t.Fatalf("depois do bloqueio = %d %s", c, b)
	}
	for _, corpo := range []string{`{}`, `{"senha":""}`, `{"senha":123}`, `lixo`} {
		if c, b := pedir(corpo, tok); c != 400 || b != `{"erro":"sem_senha","ok":false}` {
			t.Errorf("%s = %d %s", corpo, c, b)
		}
	}
	imp := ids["super"]
	tokImp, _ := s.Criar(context.Background(), ids["admin"], "painel", &imp)
	if c, b := pedir(`{"senha":"senha-admin"}`, tokImp); c != 403 || b != `{"error":"sem_permissao","mensagem":"Quem entrou como outra pessoa não confere senha por ela."}` {
		t.Fatalf("impersonada = %d %s", c, b)
	}
	if c, _ := pedir(`{"senha":"senha-admin"}`, ""); c != 401 {
		t.Fatalf("sem sessão = %d", c)
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test -run 'EntrarComo|ConferirSenha' ./internal/auth/ 2>&1 | tail -3`
Expected: FAIL de compilação (`c.EntrarComo undefined`, `c.conferir undefined`).

- [ ] **Step 3: Implementar**

Em `api/internal/auth/sessoes.go`, troque:

```go
func (s *Store) Criar(ctx context.Context, usuarioID, tipo string, impersonadorID *string) (string, error) {
	b := make([]byte, 32)
```

por:

```go
func (s *Store) Criar(ctx context.Context, usuarioID, tipo string, impersonadorID *string) (string, error) {
	return s.CriarComPrazo(ctx, usuarioID, tipo, impersonadorID, s.TTL)
}

// CriarComPrazo cria a sessão com vida própria (a de "entrar como" vale 1 h e não renova).
func (s *Store) CriarComPrazo(ctx context.Context, usuarioID, tipo string, impersonadorID *string, ttl time.Duration) (string, error) {
	b := make([]byte, 32)
```

e, no `insert` logo abaixo, troque `agora.Add(s.TTL))` por `agora.Add(ttl))`.

Em `api/internal/auth/conta.go`, na struct `Conta`, troque:

```go
	enviando  chan struct{} // testes: avisa quando o envio assíncrono termina
}
```

por:

```go
	enviando  chan struct{} // testes: avisa quando o envio assíncrono termina
	conferir  conferencias  // conferir-senha: erros por pessoa
}
```

Crie `api/internal/auth/entrar_como.go`:

```go
package auth

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
)

// PrazoEntrarComo: a sessão de "entrar como" vale 1 h e NUNCA renova (Store.Buscar não
// renova sessão impersonada), como o token de acesso do Supabase que a edge entregava.
const PrazoEntrarComo = time.Hour

// motivoDeRecusa é supabase/functions/_shared/checagem-de-entrar-como.js, na mesma ordem e com
// as mesmas frases (a primeira que bater é a que a pessoa lê).
func motivoDeRecusa(chamadorSuper, chamadorDesativado bool, chamadorID, alvoID string, alvoExiste, alvoDesativado bool) string {
	switch {
	case !chamadorSuper:
		return "Apenas super-admin pode entrar como outro usuário"
	case chamadorDesativado:
		return "Sua conta está desativada"
	case chamadorID == alvoID:
		return "Você já é você — não precisa entrar como si mesmo"
	case !alvoExiste:
		return "Não encontrei essa pessoa"
	case alvoDesativado:
		return "Conta desativada — reative antes de entrar como ela"
	}
	return ""
}

// EntrarComo: POST /entrar-como-usuario {alvoId}. Só super-admin (pela ficha); grava a
// auditoria ANTES de existir sessão (falhou a auditoria, não há sessão); a sessão nova é do
// alvo, marcada com o impersonador, vale 1 h e não renova. Sessão impersonada não encadeia.
// Resposta: {token, expira_em} (a edge devolvia access/refresh token do Supabase: o front muda no Plano 7).
func (c *Conta) EntrarComo(w http.ResponseWriter, r *http.Request) {
	a := AtorDoContexto(r.Context())
	if a.ImpersonadorID != nil {
		falhaDaEdge(w, "Sua sessão já é de outra pessoa: saia dela antes de entrar como outra.")
		return
	}
	var in struct {
		AlvoID string `json:"alvoId"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in)
	if in.AlvoID == "" {
		falhaDaEdge(w, "Faltou alvoId")
		return
	}
	ctx := r.Context()
	var alvoEmail string
	var alvoDesativado bool
	alvoExiste := reUUIDConta.MatchString(in.AlvoID)
	if alvoExiste {
		err := c.Pool.QueryRow(ctx, `select u.email, coalesce(p.disabled, false) or u.desativado_em is not null
		     from profiles p join usuarios u on u.id = p.id where p.id = $1::uuid`, in.AlvoID).Scan(&alvoEmail, &alvoDesativado)
		if errors.Is(err, pgx.ErrNoRows) {
			alvoExiste = false
		} else if err != nil {
			erroJSON(w, http.StatusInternalServerError, "erro_interno")
			return
		}
	}
	// o chamador tem sessão válida, então não está desativado (Store.Buscar recusaria)
	if msg := motivoDeRecusa(a.SuperAdmin, false, a.ID, in.AlvoID, alvoExiste, alvoDesativado); msg != "" {
		falhaDaEdge(w, msg)
		return
	}
	if _, err := c.Pool.Exec(ctx, `insert into entradas_como_outro_usuario (admin_id, admin_email, alvo_id, alvo_email)
	    values ($1::uuid, (select email from usuarios where id = $1::uuid), $2::uuid, $3::text)`, a.ID, in.AlvoID, alvoEmail); err != nil {
		slog.Error("entrar-como: auditoria falhou", "erro", err.Error())
		falhaDaEdge(w, "Não consegui registrar a auditoria.")
		return
	}
	impersonador := a.ID
	token, err := c.Sessoes.CriarComPrazo(ctx, in.AlvoID, "painel", &impersonador, PrazoEntrarComo)
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token, "expira_em": time.Now().Add(PrazoEntrarComo).UTC().Format(time.RFC3339)})
}

// Conferência de senha: 5 erros seguidos bloqueiam por 10 min, por pessoa (como a edge).
// ponytail: em memória, uma instância só (a edge tinha o mesmo furo, aceito pelo dono).
const (
	ErrosAteBloquear = 5
	Bloqueio         = 10 * time.Minute
)

type conferencias struct {
	mu    sync.Mutex
	marca map[string]struct {
		erros int
		ate   time.Time
	}
	agora func() time.Time
}

func respostaConferir(w http.ResponseWriter, status int, corpo map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

// ConferirSenha: POST /conferir-senha {senha}. A pessoa sai da SESSÃO, nunca do corpo (não é
// oráculo de senha alheia); responde só sim ou não, com o contrato da edge conferir-senha.
// Sessão de "entrar como" não assina pelo alvo.
func (c *Conta) ConferirSenha(w http.ResponseWriter, r *http.Request) {
	a := AtorDoContexto(r.Context())
	if a.ImpersonadorID != nil {
		erroComMensagem(w, http.StatusForbidden, "sem_permissao", "Quem entrou como outra pessoa não confere senha por ela.")
		return
	}
	cf := &c.conferir
	cf.mu.Lock()
	if cf.marca == nil {
		cf.marca = map[string]struct {
			erros int
			ate   time.Time
		}{}
	}
	if cf.agora == nil {
		cf.agora = time.Now
	}
	m := cf.marca[a.ID]
	agora := cf.agora()
	cf.mu.Unlock()
	if m.ate.After(agora) {
		respostaConferir(w, http.StatusTooManyRequests, map[string]any{"ok": false, "erro": "bloqueado",
			"bloqueado_ate": m.ate.UTC().Format("2006-01-02T15:04:05.000Z")})
		return
	}
	var in struct {
		Senha any `json:"senha"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in)
	senha, _ := in.Senha.(string)
	if senha == "" {
		respostaConferir(w, http.StatusBadRequest, map[string]any{"ok": false, "erro": "sem_senha"})
		return
	}
	var hash string
	err := c.Pool.QueryRow(r.Context(), `select coalesce(senha_hash, '') from usuarios where id = $1::uuid`, a.ID).Scan(&hash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		respostaConferir(w, http.StatusInternalServerError, map[string]any{"ok": false, "erro": "falha_interna"})
		return
	}
	if hash == "" {
		hash = hashFalso
	}
	if !SenhaConfere(hash, senha) || hash == hashFalso {
		cf.mu.Lock()
		m = cf.marca[a.ID]
		m.erros++
		if m.erros >= ErrosAteBloquear {
			m.ate = agora.Add(Bloqueio)
		}
		cf.marca[a.ID] = m
		cf.mu.Unlock()
		respostaConferir(w, http.StatusOK, map[string]any{"ok": false, "erro": "senha_incorreta", "restam": max(0, ErrosAteBloquear-m.erros)})
		return
	}
	cf.mu.Lock()
	delete(cf.marca, a.ID)
	cf.mu.Unlock()
	respostaConferir(w, http.StatusOK, map[string]any{"ok": true})
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l ./internal && go vet ./internal/auth/ && go test -count=1 -race -v ./internal/auth/ 2>&1 | grep -E '^(--- (FAIL|SKIP)|ok|FAIL)'`
Expected: só `ok`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/auth/sessoes.go api/internal/auth/conta.go api/internal/auth/entrar_como.go api/internal/auth/entrar_como_test.go
git commit -m "feat(api): entrar como outro usuário (auditado, 1 h, sem encadear) e conferir-senha

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Montagem das rotas, configuração, `conferir` e notas de implantação

**Revisor:** **opus** (lista pública, rotas novas fora do grupo autenticado, segredo novo).

**Files:**
- Modify: `api/internal/config/config.go`, `api/internal/config/config_test.go`
- Modify: `api/internal/web/rotas.go`, `api/internal/web/rotas_test.go`
- Modify: `api/cmd/api/conferir.go`
- Modify: `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`

**Interfaces:**
- Consumes: tudo das Tasks 1–9.
- Produces: `config.Config` ganha `ZeptoToken, ZeptoDe string; EnderecosDoApp []string; EnderecoPadrao string` (e `ZeptoToken` entra em `Segredos()`); `var web.FuncoesRPC []rpc.Funcao` (a lista branca que os sub-planos completam); o grupo de domínio em `web.Rotas` (com `autz.ComEscopo`), onde os sub-planos montam as suas rotas.

- **`conferir` e `entradas_como_outro_usuario` (achado da revisão da Task 9):** no banco restaurado, conferir que a tabela existe com as colunas `admin_id`, `admin_email`, `alvo_id`, `alvo_email`, `criado_em`, que o papel de conexão da API consegue `insert` nela (dono da tabela ou grant; com RLS ligada e só a policy de `select` do super-admin, o `insert` da API falharia e "entrar como" ficaria recusado com "Não consegui registrar a auditoria."), e que a API grava como dono/BYPASSRLS de propósito (ensaio de RLS/ownership).

**Requisitos da lista branca de RPC (a Task 10 os cumpre junto da montagem; são exigências, o código segue o padrão dos testes de `web`):**

- (a) Ao lado de `web.FuncoesRPC`, declarar `RPCPendentes` (os 92 nomes registráveis de I.2, por sub-plano) e `RPCForaDoPainel` (os 2 do Ruling 23, os 3 de página pública, os 5 internos com `EXECUTE` revogado e os 5 só citados em comentário/policy: 15 no total). Um teste exige `nomes(FuncoesRPC) ∩ (RPCPendentes ∪ RPCForaDoPainel) = ∅` e `nomes(FuncoesRPC) ∪ RPCPendentes` = exatamente os 92. Cada sub-plano move os seus nomes de pendentes para registrados; o critério de entrada do Plano 8 é `RPCPendentes` vazio. `rpc.Novo` já recusa na montagem os nomes proibidos (Rulings 23 e 25, `checkout_*`, `disparar_robo`, `tomar_trava`, as 5 internas e as 3 `anon`), então `RPCForaDoPainel` e a recusa do `Novo` têm de concordar (um teste confere).
- (b) `api worker conferir` verifica, para cada nome registrado, no banco restaurado: (i) a função existe em `public` e NÃO existe em `pg_catalog` (nome sem schema resolve pelo `search_path` com `pg_catalog` na frente: uma função de mesmo nome lá a esconderia); (ii) `has_function_privilege('authenticated', oid, 'execute')` é verdadeiro (conferência mecânica de "mesmas permissões" para RPC: se a produção fechou o `EXECUTE` para `authenticated`, a API não pode abrir); (iii) a declaração bate com `pg_proc`: nomes e tipos dos parâmetros (`proargnames`/`proargtypes`), `pronargdefaults` = quantidade de `Opcional`, `proretset`/`void` × `Retorno`.
- (c) A rota `/rpc` ganha prazo na montagem (`comPrazo` ou `statement_timeout` na transação de `banco.ComUsuario`): função lenta não segura conexão do pool indefinidamente.

**Execução da Task 10 (2026-10-12), o que o código final faz além/diferente do texto abaixo** (o texto é o ponto de partida; a fonte de verdade é o código):
- Limpeza de integração das Tasks 5–9 (commit à parte): `falhaDaEdge`/`reUUIDConta` únicos (some `recusaDeEntrarComo`/`reUUIDEntrarComo`); a regra de "RAISE escrito por nós" vive em `banco.RaiseNosso`/`banco.FraseDoRaise` (folha sem ciclo) e some a cópia `raiseDoBanco`; `dados.LerFiltros` devolve cada condição já entre parênteses.
- `ZEPTOMAIL_NOME` (padrão "Central de Inteligência RBV") em vez do nome fixo; `ENDERECOS_DO_APP`/`ENDERECO_PADRAO`/`ZEPTOMAIL_DE` são validados na subida (origem https sem caminho; padrão da lista; remetente só endereço): erro derruba a API. Sem variável para os limites de taxa (fixos no código).
- `web.RPCPendentes` (92) e `web.RPCForaDoPainel` (15) em `api/internal/web/rpc_lista.go`; `montarRPC` valida as três listas e `Rotas` dá panic; `rpc.Novo` passou a recusar também os 5 nomes "sem chamada de rede" (`is_vessel_atendimentos_editar`, `meus_vinculos`, `vessel_chave_do_produto`, `vessel_email_canonico`, `vessel_placar_do_stylist_circle`), para as duas listas concordarem.
- O grupo de domínio inteiro tem `comPrazo(PrazoDominio)` (30 s) antes de `autz.ComEscopo`.
- `conferir` (`cmd/api/conferir_dominio.go`): ambiente da gramática (`dados.ConferirAmbiente`), papel da API na auditoria, cada RPC registrada contra o `pg_proc` e a montagem de `web.Rotas` contra as tabelas reais.
- Testes de montagem: sessão de cliente recusada em TODA rota protegida; caminhos felizes da conta pela montagem real; o teste do `/rpc` usa um nome que nenhum sub-plano registra (`funcao_que_ninguem_registra`), não `vessel_gerar_lote`.

- [ ] **Step 1: Escrever os testes que falham**

Acrescente ao fim de `api/internal/config/config_test.go` (o arquivo já importa `slices`):

```go
func TestCarregarVariaveisDoPlano5(t *testing.T) {
	t.Setenv("DATABASE_URL", "postgres://x")
	t.Setenv("ZEPTOMAIL_TOKEN", " zepto-segredo-123 ")
	t.Setenv("ZEPTOMAIL_DE", "")
	t.Setenv("ENDERECOS_DO_APP", "")
	t.Setenv("ENDERECO_PADRAO", "")
	c, err := Carregar()
	if err != nil {
		t.Fatal(err)
	}
	if c.ZeptoToken != "zepto-segredo-123" || c.ZeptoDe != "nao-responda@vesselbrasil.com.br" ||
		len(c.EnderecosDoApp) != 2 || c.EnderecoPadrao != "https://socialdashboard.rbvcompany.com" {
		t.Fatalf("padrões = %+v", c)
	}
	if !slices.Contains(c.Segredos(), "zepto-segredo-123") {
		t.Fatal("ZEPTOMAIL_TOKEN fora de Segredos()")
	}
	t.Setenv("ENDERECOS_DO_APP", "https://a.exemplo, https://b.exemplo")
	t.Setenv("ENDERECO_PADRAO", "https://b.exemplo")
	c, _ = Carregar()
	if len(c.EnderecosDoApp) != 2 || c.EnderecosDoApp[1] != "https://b.exemplo" || c.EnderecoPadrao != "https://b.exemplo" {
		t.Fatalf("endereços = %v %q", c.EnderecosDoApp, c.EnderecoPadrao)
	}
}
```

Em `api/internal/web/rotas_test.go`:

1. No mapa `publicas`, depois de `"POST /receber-opt-out-chatwoot": true,`, acrescente:
   ```go
	// Plano 5.0: links de senha (sem enumeração, limite por IP e por e-mail no handler)
	"POST /auth/esqueci-senha": true, "POST /auth/definir-senha": true,
   ```
2. Troque a linha `var soSessao = map[string]bool{"POST /auth/sair": true, "GET /auth/eu": true, "GET /eu/canais": true}` por:
   ```go
var soSessao = map[string]bool{"POST /auth/sair": true, "GET /auth/eu": true, "GET /eu/canais": true,
	// Plano 5.0: a conta de quem está logado; invite-user e entrar-como têm o portão das edges
	// DENTRO do handler (400 com a frase da edge: TestContaPelaMontagemReal) e /rpc/{nome} só
	// responde para nome registrado, cada um com o seu portão (sem registro: 404).
	"POST /auth/trocar-senha": true, "GET /eu/perfil": true, "POST /invite-user": true,
	"POST /entrar-como-usuario": true, "POST /conferir-senha": true, "POST /rpc/{nome}": true,
}
   ```
3. Acrescente ao fim do arquivo:

```go
// Plano 5.0 pela montagem real: os links de senha respondem sem sessão; as rotas da conta exigem
// sessão de painel e, para quem não é admin/super-admin, devolvem a frase da edge.
func TestContaPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{EnderecosDoApp: []string{"https://central.exemplo"}, EnderecoPadrao: "https://central.exemplo"})
	viewer := fixtureUsuarios(t, p, s)["nenhum"]
	testebanco.TabelasDoEscopo(t, p)
	ctx := context.Background()
	const cliente = "77777777-7777-4777-a777-777777777777"
	p.Exec(ctx, `insert into usuarios (id, email) values ($1, 'cliente@x.com')`, cliente)
	tokCliente, _ := s.Criar(ctx, cliente, "cliente", nil)
	pedir := func(metodo, caminho, corpo, tok string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	casos := []struct {
		metodo, caminho, corpo, tok string
		status                      int
		trecho                      string
	}{
		{"POST", "/auth/esqueci-senha", `{"email":"ninguem@x.com"}`, "", 202, `{"ok":true}`},
		{"POST", "/auth/definir-senha", `{"token":"inventado","senha":"senha-boa"}`, "", 400, "token_invalido"},
		{"POST", "/invite-user", `{"email":"a@x.com"}`, viewer, 400, "Apenas administradores"},
		{"POST", "/entrar-como-usuario", `{"alvoId":"` + conta + `"}`, viewer, 400, "Apenas super-admin"},
		{"POST", "/conferir-senha", `{}`, viewer, 400, "sem_senha"},
		{"POST", "/auth/trocar-senha", `{"senha":"1"}`, viewer, 400, "senha_invalida"},
		{"GET", "/eu/perfil", ``, viewer, 200, `"role":"viewer"`},
		{"POST", "/rpc/vessel_gerar_lote", `{}`, viewer, 404, "nao_encontrado"},
		{"POST", "/invite-user", `{}`, tokCliente, 403, "sem_permissao"},
		{"POST", "/rpc/qualquer", `{}`, "", 401, "nao_autenticado"},
	}
	for _, c := range casos {
		if st, corpo := pedir(c.metodo, c.caminho, c.corpo, c.tok); st != c.status || !strings.Contains(corpo, c.trecho) {
			t.Errorf("%s %s = %d %s, esperava %d com %q", c.metodo, c.caminho, st, corpo, c.status, c.trecho)
		}
	}
}
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `go test ./internal/config/ ./internal/web/ 2>&1 | tail -4`
Expected: FAIL de compilação em `config` (`c.ZeptoToken undefined`) e, em `web`, `TestNenhumaRotaNovaFicaAberta` acusa as rotas públicas que ainda não existem e `TestContaPelaMontagemReal` falha com 404.

- [ ] **Step 3: Implementar**

Em `api/internal/config/config.go`:

1. No fim da struct `Config`, depois de `ZAPICliente    string // ZAPI_TOKEN (cabeçalho Client-Token)`, acrescente:
   ```go

	// Plano 5.0 (conta: convite e troca de senha por e-mail).
	ZeptoToken     string   // ZEPTOMAIL_TOKEN (vazio = convite e "esqueci a senha" não mandam e-mail)
	ZeptoDe        string   // ZEPTOMAIL_DE; padrão nao-responda@vesselbrasil.com.br (domínio verificado no ZeptoMail)
	EnderecosDoApp []string // ENDERECOS_DO_APP: para onde o link de senha pode levar (a origem do pedido, se estiver aqui)
	EnderecoPadrao string   // ENDERECO_PADRAO: o link quando a origem não é do app
   ```
2. Em `Segredos()`, troque `c.ZAPIInstancia, c.ZAPIToken, c.ZAPICliente}, c.ShopifySegredos...)` por `c.ZAPIInstancia, c.ZAPIToken, c.ZAPICliente, c.ZeptoToken}, c.ShopifySegredos...)`.
3. Em `Carregar`, troque o fim do literal:
   ```go
		ZAPICliente:       strings.TrimSpace(os.Getenv("ZAPI_TOKEN")),
	}
   ```
   por:
   ```go
		ZAPICliente:       strings.TrimSpace(os.Getenv("ZAPI_TOKEN")),
		ZeptoToken:        strings.TrimSpace(os.Getenv("ZEPTOMAIL_TOKEN")),
		ZeptoDe:           strings.TrimSpace(os.Getenv("ZEPTOMAIL_DE")),
		EnderecosDoApp:    lista("ENDERECOS_DO_APP"),
		EnderecoPadrao:    strings.TrimSpace(os.Getenv("ENDERECO_PADRAO")),
	}
	if c.ZeptoDe == "" {
		c.ZeptoDe = "nao-responda@vesselbrasil.com.br"
	}
	// os dois endereços de supabase/functions/_shared/enderecos-do-app.js; o padrão ainda é o antigo
	if len(c.EnderecosDoApp) == 0 {
		c.EnderecosDoApp = []string{"https://socialdashboard.rbvcompany.com", "https://central.rbvcompany.com"}
	}
	if c.EnderecoPadrao == "" {
		c.EnderecoPadrao = c.EnderecosDoApp[0]
	}
   ```

Em `api/internal/web/rotas.go`:

1. Nos imports, acrescente `"github.com/rbv-co/social-dashboard/api/internal/autz"`, `"github.com/rbv-co/social-dashboard/api/internal/email"` e `"github.com/rbv-co/social-dashboard/api/internal/rpc"` (em ordem alfabética, como os outros).
2. Antes de `// comPrazo limita o contexto da requisição`, acrescente:
   ```go
// FuncoesRPC é a lista branca de POST /rpc/{nome}. Vazia no 5.0: cada sub-plano acrescenta as
// funções do seu domínio, com parâmetros, retorno e o portão que espelha a checagem interna da função.
var FuncoesRPC = []rpc.Funcao{}

   ```
3. Logo depois de `r.Post("/auth/entrar", h.Entrar)`, acrescente:
   ```go
	// Plano 5.0: links de senha (públicos; limite por IP e por e-mail lá dentro, resposta sem enumeração).
	conta := auth.NovaConta(p, s, &email.ZeptoMail{Token: cfg.ZeptoToken, De: cfg.ZeptoDe, Nome: "Central de Inteligência RBV"},
		cfg.EnderecosDoApp, cfg.EnderecoPadrao)
	r.Post("/auth/esqueci-senha", conta.EsqueciSenha)
	r.Post("/auth/definir-senha", conta.DefinirSenha)
   ```
4. Troque `	cli := core.Novo(cfg.CoreURL, cfg.CoreToken)` por:
   ```go
	rpcs, err := rpc.Novo(p, FuncoesRPC...)
	if err != nil {
		panic(err) // declaração errada: a API não sobe
	}
	cli := core.Novo(cfg.CoreURL, cfg.CoreToken)
   ```
5. No grupo autenticado, depois da rota `/avisar-decisao-de-reserva` (antes do `})` que fecha o grupo), acrescente:
   ```go

		// Plano 5.0: conta. Os portões de invite-user e entrar-como são os das edges (papel admin;
		// super-admin pela ficha), dentro do handler, com a resposta 400 {"error": frase} das edges.
		r.Post("/auth/trocar-senha", conta.TrocarSenha)
		r.Get("/eu/perfil", conta.Perfil)
		r.Post("/invite-user", conta.InviteUser)
		r.Post("/entrar-como-usuario", conta.EntrarComo)
		r.Post("/conferir-senha", conta.ConferirSenha)

		// Plano 5: rotas de DOMÍNIO. Toda rota daqui lê autz.EscopoDo(ctx): leitura por dados.Consulta
		// (regra de Ler do catálogo no WHERE), escrita por autz.PodeCriar/PodeEditar/PodeApagar dentro de
		// banco.ComUsuario, RPC pelo registro (lista branca). Os sub-planos 5.1+ acrescentam aqui.
		r.Group(func(r chi.Router) {
			r.Use(autz.ComEscopo(p))
			r.Post("/rpc/{nome}", rpcs.ServeHTTP)
		})
   ```

Em `api/cmd/api/conferir.go` (premissas de schema conferidas no banco restaurado pelo `api worker conferir`):

1. Troque a linha de `"profiles"` em `colunasDoWorker` por:
   ```go
	"profiles":                  "id,email,name,role,is_superadmin,disabled,features,permissions,escopo_por_equipe,allowed_accounts,avatar_url,precisa_trocar_senha",
   ```
2. Troque `	"equipes":                   "id,canal_loja_id",` por:
   ```go
	"equipes":                   "id,canal_loja_id,local_id,deposito_id",
	"equipes_permissoes":        "equipe_id,profile_id,chave",
	"entradas_como_outro_usuario": "admin_id,admin_email,alvo_id,alvo_email",
   ```
3. Em `tiposDoWorker`, depois da linha `"profiles.is_superadmin": "boolean", "profiles.disabled": "boolean", "profiles.escopo_por_equipe": "boolean",`, acrescente:
   ```go
	"profiles.precisa_trocar_senha": "boolean", "equipes.deposito_id": "bigint|integer", "equipes.canal_loja_id": "bigint|integer",
	"entradas_como_outro_usuario.admin_id": "uuid", "entradas_como_outro_usuario.alvo_id": "uuid",
   ```

Rode `gofmt -w ./internal ./cmd` (as entradas novas mudam o alinhamento dos mapas de `conferir.go` e de `rotas_test.go`; só espaços).

Em `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md`, acrescente ao fim:

```markdown
## Plano 5.0 — autorização, contrato das rotas de domínio e conta

### Variáveis de ambiente (serviço `api`)
| Variável | Observação |
|---|---|
| `ZEPTOMAIL_TOKEN` | a MESMA chave que a edge `vessel-conta` usa (segredo da Supabase), copiada por quem tem acesso. Vazia = convite e "esqueci a senha" não mandam e-mail (o "esqueci" continua respondendo 202 e só loga; o convite responde "Não consegui enviar o e-mail"). É segredo (entra em `Segredos()`) |
| `ZEPTOMAIL_DE` | padrão `nao-responda@vesselbrasil.com.br` (domínio verificado no ZeptoMail desde 17/09/2026); o nome do remetente é "Central de Inteligência RBV" |
| `ENDERECOS_DO_APP` | lista por vírgula; padrão `https://socialdashboard.rbvcompany.com,https://central.rbvcompany.com` (a lista de `_shared/enderecos-do-app.js`). O link de senha leva à origem do pedido SÓ se ela estiver aqui (texto exato) |
| `ENDERECO_PADRAO` | padrão: o primeiro de `ENDERECOS_DO_APP`. Trocar para `https://central.rbvcompany.com` quando o endereço novo estiver provado |

### Rotas novas
- Públicas (o `location /api/` genérico cobre; não têm segredo na query): `POST /api/auth/esqueci-senha`, `POST /api/auth/definir-senha`. Limite próprio: 20 por IP e 5 por e-mail a cada 15 min.
- Com sessão: `POST /api/auth/trocar-senha`, `GET /api/eu/perfil`, `POST /api/invite-user`, `POST /api/entrar-como-usuario`, `POST /api/conferir-senha`, `POST /api/rpc/{nome}` (só nomes registrados pelos sub-planos; vazio no 5.0).
- Links do e-mail: `<endereço>/#type=recovery&token=<token>` (troca, 1 h) e `<endereço>/#type=invite&token=<token>` (convite, 24 h). O token vai no FRAGMENTO (`#`), não na query: o fragmento não chega ao servidor, então não cai no log de acesso do nginx (`deploy/nginx/central.rbvcompany.com.conf` registra a linha do pedido e o Referer) nem no `Referer`. O front (Plano 7) lê `type` e `token` do hash (a função `detectarFluxoDeSenha` já lê `type` do hash, hoje junto do `#access_token` do Supabase), **limpa o hash com `history.replaceState(null, "", location.pathname + location.search)` assim que os lê** (antes de qualquer outra chamada), e chama `POST /api/auth/definir-senha {token, senha}`, que devolve `{token}` de sessão.

### Mudanças de contrato que o Plano 7 absorve
- `entrar-como-usuario` responde `{token, expira_em}` (não mais `access_token`/`refresh_token`); a sessão vale 1 h e NÃO renova; sessão impersonada não convida/exclui, não entra como terceiros e não confere senha e não troca a senha do alvo: toda recusa de sessão impersonada em ação de conta é `403 {"error":"sem_permissao","mensagem":<frase>}` (o formato do núcleo, o que `POST /auth/trocar-senha` e `POST /invite-user` devolvem).
- `conferir-senha` sem sessão responde `401 {"error":"nao_autenticado"}` (a edge: `{ok:false, erro:"sem_sessao"}`); o resto do contrato é o da edge.
- Senha: 6 a 72 BYTES (o limite do bcrypt; a mensagem diz "72 bytes"). `definir-senha` e `trocar-senha` derrubam também as sessões "entrar como" em que a pessoa é o impersonador, e `trocar-senha` apaga os links de senha ainda vivos; "esqueci" não manda outro e-mail se já houve link para a pessoa há menos de 60 s (resposta idêntica). `faxina-da-api` apaga `tokens_de_senha` vencidos ou usados há mais de 7 dias.
- Login de conta desativada com a senha certa: `403 {"error":"conta_desativada"}` (substitui a RPC `minha_conta_esta_desativada`). `POST /auth/trocar-senha` já tira `precisa_trocar_senha` (substitui a RPC `marcar_senha_trocada`).
- Leituras de domínio: array no formato do PostgREST; sem permissão = `[]`; linha invisível = 404; erro `{"error","mensagem"}` (contrato completo no Plano 5, seção II.2).

### Antes do corte
- `api worker conferir` agora confere também `profiles.allowed_accounts/avatar_url/precisa_trocar_senha/name`, `equipes.local_id/deposito_id`, `equipes_permissoes` e `entradas_como_outro_usuario`: rodar no banco restaurado do ensaio.
- O catálogo de policies e as funções do oráculo (`api/internal/autz/autzteste/ajudantes.sql`) são de 2026-10-09. Se alguém criar/alterar policy ou uma das 25 funções em produção antes do corte, refazer o levantamento, copiar o JSON novo para `api/internal/autz/`, regerar `ajudantes.sql` e rodar o teste de contrato: forma nova de policy faz a API NÃO subir.
- O Auth do Supabase deixa de mandar e-mail de convite/troca: conferir no ZeptoMail o domínio remetente e a cota antes do corte.
```

- [ ] **Step 4: Rodar e ver passar**

Run: `gofmt -l . && go vet ./... && go test -count=1 -race ./... 2>&1 | grep -v goose | grep -E '^(ok|FAIL|---)'`
Expected: todos os pacotes `ok`.

- [ ] **Step 5: Commit**

```bash
git add api/internal/config/ api/internal/web/ api/cmd/api/conferir.go docs/migracao-go/NOTAS-DA-IMPLANTACAO.md
git commit -m "feat(api): monta a conta, o grupo de domínio com autz e /rpc, configuração do ZeptoMail e notas do Plano 5.0

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Verificação final do Plano 5.0

- [ ] `docker stop pg-plano5` e depois `make -C api teste PG_PORTA=58534` → todos os pacotes `ok`.
- [ ] Executados × pulados com banco: subir o `pg-plano5` de novo (comando do pré-voo) e `cd api && go test -count=1 -v ./... 2>&1 | grep -c -- '--- SKIP'` → `0`.
- [ ] `cd api && gofmt -l . && go vet ./...` → nada listado.
- [ ] `grep -rn 'supabase\.co' api/internal --include='*.go' | grep -v _test.go` → nada (a API não fala com o Supabase).
- [ ] `git diff feat/api-go-worker --stat -- supabase/ src/ coletor/` → vazio (front, edges e robôs continuam no ar até a virada).
- [ ] `docker stop pg-plano5`.
- [ ] Revisão final do branch por um revisor opus, com foco em: o oráculo (o mundo mostra os dois lados de toda regra? alguma forma de policy aceita sem teste?), `Validar` da `Consulta` (algum `from`/`join` escapa da expressão regular?), a ordem portão → função no `/rpc`, enumeração e uso único nos links de senha, e o que uma sessão impersonada ainda consegue fazer.

---
## IV. Sub-planos 5.1–5.12 (escritos depois, um arquivo cada, no formato deste)

### IV.1 Regras comuns a todo sub-plano

- **Arquivo:** `docs/superpowers/plans/2026-10-1X-api-go-plano-5.N-<dominio>.md`, worktree e branch próprias empilhadas sobre o 5.0 (ou sobre o sub-plano anterior quando houver dependência).
- **Dependência D0 (todos):** DDL real das tabelas, gatilhos e funções do domínio nos testes. Fonte: `pg_dump --schema-only` do banco do **ensaio local** (restaurado pelo Plano 2; nunca da produção), passado por `ops/migracao/limpar-dump.mjs`, versionado como `api/internal/testebanco/esquema/producao.sql` e carregado por um `testebanco.ComEsquemaDeProducao(t)` (banco novo por teste, como o `autzteste`). O primeiro sub-plano a rodar escreve essa task (Ruling 29); até lá, DDL mínima reescrita das migrations com cast explícito, conferida por `api worker conferir`.
- **Leitura:** uma `dados.Consulta` por necessidade de tela (não por chamada): agrupar as variações de filtro de uma mesma tabela numa rota com filtros declarados; o nome do recurso embutido = o que a tela lê hoje (ex.: `frota_veiculos(*)` → coluna `frota_veiculos` com `row_to_json`). Toda tabela lida com marcador `{ler:…}`; `Validar` no teste da montagem.
- **Regras do modelo de leitura (revisão final do 5.0; valem para todo sub-plano):**
  - **Filtro compara COLUNA com PARÂMETRO tipado, nada mais.** `u.veiculo_id = @veiculo::uuid`, `c.criado_em >= @de::timestamptz`, `c.id = any(@ids::uuid[])`. NUNCA cast, função ou operador sobre o DADO da coluna (`c.codigo::int = @n::bigint`, `lower(c.nome) = ...` só se `lower` não puder falhar): o Postgres não garante a ordem em que avalia os termos do `where`, e o filtro não tem semântica de `security_barrier`; um cast que pode estourar ou falhar (`'abc'::int`, `numeric` fora da faixa, divisão por zero) numa linha que a pessoa NÃO vê vira um oráculo de erro (500/400 com o filtro certo = a linha invisível existe e tem tal valor). Se a coluna não tem o tipo do parâmetro, o cast é do PARÂMETRO (`c.codigo = @n::text`), ou a rota expõe uma coluna já convertida por expressão total (`case when c.codigo ~ '^[0-9]{1,9}$' then c.codigo::int end`) e o filtro compara essa coluna. Hoje `Filtro.Validar` confere o cast do parâmetro e a revisão humana confere a coluna; um sub-plano que automatizar isso melhora o 5.0 sem mudar o contrato.
  - **Listas em `in`/`= any(@ids::uuid[])` vão no máximo até ~150 uuids por pedido** (37 caracteres cada na URL; o nginx recusa cabeçalho acima de `large_client_header_buffers` = 8k com 414/400 antes de a API ver o pedido). Lista maior: (a) trocar por JOIN no servidor (a tela manda o que identifica o conjunto, a equipe, o grupo, o período, e o SQL junta; é quase sempre o certo, porque o conjunto já está no banco), ou (b) uma rota de leitura por `POST` com a lista no corpo (`dados.LerCorpo`, até o limite do corpo; continua sendo uma `dados.Consulta`, com o corpo virando o filtro `= any(@ids::uuid[])`). Nunca subir o `large_client_header_buffers` por causa de uma rota.
  - **Limites de expressividade da gramática de `dados.Consulta` (e os desvios):**
    - *Filtro não carrega `{ler:...}`*: o filtro é um fragmento escalar sobre colunas já lidas, e todo marcador tem de estar na condição de uma leitura. Filtro que precisa de OUTRA tabela ("só veículos com multa aberta"): junte a tabela no SQL (`left join multas m on m.veiculo_id = v.id and {ler:multas:m}`) e filtre pela coluna do alias (`m.situacao = @situacao::text`), ou ponha a regra em `Onde` (que aceita `exists (select 1 from ... where ... and {ler:...})`), ou declare duas rotas.
    - *Dois aliases para a mesma tabela são recusados* (um alias por tabela e uma tabela por alias, em toda a declaração, para o parâmetro `{ler:t:a}` ser um só): o par "origem/destino" da mesma tabela vira duas leituras de UM alias em subconsultas separadas (cada subconsulta pode repetir o alias, é a mesma ligação), ou colunas já resolvidas numa função/RPC com portão, ou duas rotas que a tela cruza.
    - *Auto-join é recusado* (a tabela principal só aparece uma vez no texto; ler de novo, por join ou subconsulta, é recusado): árvore/hierarquia ("pai da linha") sai por uma coluna que o banco já guarda (`pai_nome` mantido por gatilho ou view do catálogo), por uma RPC (com portão = a regra de Ler da tabela, Ruling 26) ou por duas leituras que a tela une pelo id.
    - *`unnest(...) as t(x)` e `with ordinality` são recusados* (o alias de função de conjunto é só o nome, sem lista de colunas, e a função de conjunto não tem `with`): use `unnest(c.ids) u` (a coluna se chama `u`), `jsonb_array_elements`/`jsonb_each` com alias simples, ou `generate_series(1, n) g`; para o índice do elemento (o que `with ordinality` daria), `row_number() over ()` na lista do select é aceito (verificado), ou guarde a ordem no próprio dado.
    - Também recusados, de propósito: `union/intersect/except`, `with`, `lateral`, `right/full/cross/natural join`, `using`, `between`, `extract(... from ...)` (use `date_part`), `trim/substring(... from ...)`, comentário, `where/group/order/limit` no nível 0 (o framework os acrescenta), e a LISTA FECHADA de funções que executam SQL em texto ou leem relação por nome (`api/internal/dados/gramatica.go`: `query_to_xml*`, `ts_rewrite`, `currtid*`, `pg_*`, `reg*`, `has_*_privilege`, contrib...). Função SECURITY DEFINER dentro da lista do select continua sendo revisão humana (a sombra não alcança o que roda dentro dela).
- **Escrita:** struct com as colunas que a tela grava (o resto é recusado por `dados.LerCorpo`), `PodeCriar/PodeEditar/PodeApagar`, SQL explícito, tudo em `banco.ComUsuario`. Resposta segundo a seção II.2.
- **RPC:** cada função em `web.FuncoesRPC` com os parâmetros de `02-funções.csv` (nome e tipo exatos; `Opcional` = tem `DEFAULT`), o `Retorno` pelo `RETURNS` e o portão = a checagem interna da função (`autz.VesselPode`, `autz.VesselAdmin`, `autz.PodeCadastrarPessoaRapida`...). Função **SECURITY INVOKER** que lê tabela perdeu a RLS que a protegia: o portão cobre a regra de Ler dessas tabelas (Ruling 26). Função sem checagem e sem tabela (validadores puros) = portão `Autenticado` com Ruling. Todo portão novo entra em `TestPortoesContraAsFuncoesDeProducao` (ou, com D0, comparado chamando a função real como cada pessoa: 42501 = negado).
- **Testes que todo sub-plano traz:** por rota, a matriz pessoa → status/linhas pela montagem real (`web.Rotas`) com pelo menos um caso positivo e um negativo por portão e um caso de IDOR (id de outra conta/loja/equipe → `[]`/404); por escrita, "negado não grava" (contar linhas depois); paridade de formato quando a tela compara texto (gerar vetores com o PostgREST de verdade no ensaio se houver dúvida); `cmd/api/conferir.go` com as colunas/tipos/funções que as rotas presumem.
- **O que NÃO entra em sub-plano do 5:** Storage (buckets, URLs assinadas, upload): Plano 6; rotas públicas da Vessel e `vessel-conta`: Plano 6; Zoho/Microsoft (`acessos-proxy`, `acessos-oauth`): Plano 6; trocar as chamadas no front: Plano 7 (cada sub-plano lista os sítios a trocar, com arquivo e linha, para o Plano 7).

### IV.2 A tabela

| # | Escopo (rotas, regras) | Tabelas (catálogo) | Funções / edges | Telas e sítios a trocar (Plano 7) | Depende de | Ordem | Revisor |
|---|---|---|---|---|---|---|---|
| **5.1** Admin, equipes e acesso | Usuários e perfis (lista, edição de `permissions`/`features`/`allowed_accounts`/`escopo_por_equipe`/`perfil_id`, com os gatilhos `guard_profiles` e `impedir_autopromocao` vendo quem edita); perfis de acesso; equipes, membros e permissões de equipe; grupos de canal e supervisoras; preferências e inscrições de push (do próprio); pedidos de acesso (`POST /pedir-acesso` PÚBLICO com limite por IP: hoje o login grava `access_requests` com a policy `public_insert`; leitura/decisão admin); auditoria (`audit_log`, `entradas_como_outro_usuario`: só leitura); `platform_settings`; leitura de `data_integrity_checks`. Os botões "coletar/auditar agora" da aba Saúde NÃO são portados (Ruling 30) | `profiles`, `access_requests`, `acessos_perfis`, `equipes`, `equipes_membros`, `equipes_permissoes`, `canais_grupos`, `canais_grupos_membros`, `push_subs`, `push_preferencias`, `audit_log`, `entradas_como_outro_usuario`, `user_permissions`, `platform_settings`, `data_integrity_checks`, `robos_esperados`, `robos_execucoes`, `coletor_log`, `projetos_status`, `ia_execucoes`, `gestor_log` (21; 44 policies; atenção: `acessos_perfis` usa `is_superadmin()` POR E-MAIL, não a ficha) | Gatilhos: `guard_profiles`, `impedir_autopromocao`, `guard_user_permissions`, `equipes_toca_atualizado`, `espelhar_rename_do_grupo` | `src/ferramentas/admin/tela-de-admin.vue` (`adFetch` 31, `sb` 13, `.from` 24), `src/ferramentas/login/tela-de-login.vue` (pedir acesso), `src/compartilhado/notificacoes-push.js`, `controle-de-login-e-usuario.js` | 5.0, D0 | 1º | **opus** (permissões de gente) |
| **5.2** Patrimônio e cadastros compartilhados | Bens (com `pode_ver_bem` por equipe/pessoa), posse, locais, cômodos, empresas, categorias, tipos, configuração e log; cadastro rápido de pessoa/setor e as listas de escolha; sincronização carro ↔ bem (gatilhos de espelho frota ↔ patrimônio ficam no banco) | `patrimonio_bens`, `patrimonio_posse`, `patrimonio_locais`, `patrimonio_comodos`, `patrimonio_empresas`, `patrimonio_categorias`, `patrimonio_tipos`, `patrimonio_config`, `patrimonio_log` (9; 20 policies, 4 restritivas) | RPC: `criar_pessoa_rapida`, `criar_setor_rapido`, `pessoas_para_escolher`, `setores_para_escolher` (portão `PodeCadastrarPessoaRapida`), `sincronizar_carro_e_bem` (portão = `is_frota_admin() or is_patrimonio_admin()`, conferir no corpo). Gatilhos: `bem_de_veiculo_segue_a_frota`, `patrimonio_espelha_*` | `src/ferramentas/patrimonio/*` (27 acessos, 5 dinâmicos), chamadas de cadastro rápido em `frota` e `acessos` | 5.0, 5.1 | 2º | **opus** (escopo por equipe) |
| **5.3** Frota | Veículos, uso (saída/volta, aceite imutável), requisições (decisão, arquivamento, histórico por gatilho), checklist (itens, configuração, respostas imutáveis, PDF enfileirado por gatilho), revisões, plano de revisão, manutenções, abastecimentos; convite ao dono do veículo já é o `invite-user` do 5.0; assinatura de checklist usa o `conferir-senha` do 5.0 | `frota_veiculos`, `frota_uso`, `frota_uso_pdf`, `frota_requisicoes`, `frota_requisicoes_historico`, `frota_checklist`, `frota_checklist_itens`, `frota_checklist_config`, `frota_checklist_respostas`, `frota_checklist_pdf`, `frota_revisoes`, `frota_plano_revisao`, `frota_manutencoes`, `frota_abastecimentos` (14; 28 policies, quase todas `is_frota_admin()`; `frota_req_criar` exige `criada_por = auth.uid()`) | RPC: `etiqueta_quem_e` (SD, checa por dentro), `frota_corrente_do_veiculo` (**SECURITY INVOKER**, lê `frota_checklist*`: portão `FrotaAdmin`, Ruling 26); as 5 do 5.2. Gatilhos: os 19 de `frota_*` ficam | `src/ferramentas/frota/tela-de-frota.vue` e `assinar-checklist.js`, `convite-do-dono.js` (63 acessos; inclui `profiles.precisa_trocar_senha` gravado pela tela: vira rota do 5.1) | 5.0, 5.2 | 3º | padrão (regra única `is_frota_admin`); **opus** na task de requisições (criada_por) |
| **5.4** Acessos (cadastro) | Pessoas, organizações, setores, recursos, vínculos, termos (metadados), drive (marcas, setores, overrides), log, dispositivos, configuração, histórico de patrimônio; leituras de `patrimonio_bens`/`frota_veiculos` pela tela usam as rotas do 5.2/5.3. O proxy Zoho/Microsoft e o OAuth são do Plano 6 | `acessos_pessoas`, `acessos_organizacoes`, `acessos_setores`, `acessos_recursos`, `acessos_vinculos`, `acessos_termos`, `acessos_drive_marcas`, `acessos_drive_setores`, `acessos_drive_overrides`, `acessos_log`, `acessos_dispositivos`, `acessos_config`, `acessos_patrimonio_historico` (13; 14 policies, `is_acessos_admin()`; `acessos_perfis` é do 5.1) | Nenhuma RPC própria; edges `acessos-proxy`/`acessos-oauth` → Plano 6; Storage `acessos-avatars`/`acessos-termos` → Plano 6 | `src/ferramentas/acessos/tela-de-acessos.vue` (61 acessos) | 5.0, 5.2 | 4º | padrão |
| **5.5** Comercial (Bling) | Vendas por canal/loja (`pode_ver_canal` restritiva nos pedidos), estoque por depósito (`pode_ver_estoque`), correções de vendedor/valor/forma de pagamento (`pode_ver_vendas`, super-admin pela ficha nos ajustes), metas de loja e de vendedora, vendedores, depósitos, lojas e grupo da loja (gatilho `espelhar_grupo_do_canal`), briefings da gestão comercial, pedidos da Shopify (dado pessoal: `cliente_nome`/`cliente_email` só para quem vê o canal). Decide o recorte do push de vendas (Ruling 24: paridade) | `bling_lojas`, `bling_depositos`, `bling_metas`, `bling_vendedor_metas`, `bling_vendedores`, `bling_pedido_vendedor`, `bling_pedido_nota`, `bling_pedido_ajuste_valor`, `bling_pedido_ajuste_vendedor`, `bling_pedido_forma_pagamento`, `bling_tokens` (só serviço: nenhuma rota), `gc_estoque_item`, `gc_vendas_item`, `gestao_comercial_briefings`, `shopify_pedidos` (15; 33 policies, 7 restritivas) | Nenhuma RPC (`meus_vinculos` é ajudante de policy: já é `Escopo.Vinculos`, não entra na lista branca). `bling-proxy` é do Plano 3 | `analise-vendas` (10), `gestao-a-vista` (14), `gestao-comercial` (15), `src/compartilhado/pedidos-shopify.js`, `valor-corrigido.js`, `vendedor-corrigido.js`, `data-da-venda.js` | 5.0, 5.1 (equipes) | 5º | **opus** (dinheiro, dado pessoal, escopo por loja) |
| **5.6** Meta e redes (métricas) | Leitura de contas, snapshots diários/engajamento/conteúdo, insights de campanha (dia e hora), anúncios, conjuntos, filtros de campanha (escrita por qualquer autenticado, como hoje), metas sociais, leituras de seguidores, visitas ao perfil; tudo com `pode_ver_conta` restritiva (`allowed_accounts`). Fecha a pendência do Plano 3: `meta-proxy` passa a recusar `accountId` fora de `allowed_accounts` (Ruling 34) | `accounts`, `account_insights`, `daily_snapshots`, `engagement_snapshots`, `content_snapshots`, `campaigns`, `campaign_insights`, `campaign_insights_hora`, `campaign_adsets`, `campaign_filters`, `ads`, `ads_snapshots`, `ad_insights_hora`, `perfil_visitas_hora`, `followers_leituras`, `social_metas`, `visitas_perfil_dia` (17; 39 policies, 15 restritivas) | Nenhuma RPC. Edges ao vivo: Plano 3 | `redes-sociais` (3 telas, 31), `analise-campanhas` (`adFetch`), `meta-ads` (`relatorio-por-hora.js`, leituras de insights), aba Saúde do `admin` | 5.0 | 6º | **opus** (IDOR por conta) |
| **5.7** Gestão de tráfego | Rascunhos de campanha (dono `criado_por`), fila de decisões (`decidido_por`), análises de anúncio e de orçamento, configuração de métricas e ponderada (com log), objetivo por interação, problemas da Meta, interesses sugeridos; proxies de IA e de mapa com portão (spec §8): `POST /sugerir-publico-ia`, `POST /ler-documento` (chaves de IA em variável de ambiente, nunca da tabela `segredos_de_cron`), `POST /buscar-lugar` (Nominatim com cache e limite) | `gt_campanhas_rascunho`, `gt_fila_decisoes`, `gt_ad_analises`, `gt_budget_analises`, `gt_config_metricas`, `gt_ponderada_config`, `gt_ponderada_config_log`, `gt_objetivo_interacao`, `gt_problemas_meta`, `interesses_sugeridos` (10; 24 policies, 5 restritivas) | RPC: `gt_registrar_problemas`. Edges: `sugerir-publico-ia`, `ler-documento`, `buscar-lugar` (usado também pela fábrica). Upload em `fabrica-criativos` → Plano 6 | `src/ferramentas/gestao-trafego/tela-de-gestao-trafego.vue` (27 acessos + `sb` 14, 7 `fetch` de edge) | 5.0, 5.6 (contas) | 7º | **opus** (custo de IA, SSRF no proxy de mapa) |
| **5.8** Fábrica de anúncios | Campanhas, criativos, jobs, lojas, looks, marcas, jobs da Meta, objetivos, públicos (permissão `meta.fabrica`/módulo); despacho de GitHub Actions (`fabrica-trigger`, PAT em variável de ambiente) num cliente `internal/github` reutilizado por 5.9 e 5.10; `fabrica-apagar` (apaga do disco pelo mesmo `filepath.IsLocal` do `fabrica-purga`), `fabrica-candidatos`, `fabrica-looks`, `fabrica-publicos` | `fabrica_campanhas`, `fabrica_criativos`, `fabrica_jobs`, `fabrica_lojas`, `fabrica_looks`, `fabrica_marcas`, `fabrica_meta_jobs`, `fabrica_objetivos`, `fabrica_publicos` (9; 18 policies) | Edges: `fabrica-trigger`, `fabrica-apagar`, `fabrica-candidatos`, `fabrica-looks`, `fabrica-publicos`; `buscar-lugar` (do 5.7) | `src/ferramentas/meta-ads/*` (estúdio e fábrica: 25 acessos + `sb` 22, 27 chamadas de edge) | 5.0, 5.6, 5.7 | 8º | **opus** (PAT do GitHub, apagar arquivo) |
| **5.9** Conteúdo | Peças (gatilho `conteudo_guarda_aprovacao`), ideias, blocos, arquivos, casamentos, concorrentes, eventos (`quem = auth.uid()`), jobs, métricas; `POST /conteudo-trigger` pelo `internal/github` | `conteudo_pecas`, `conteudo_ideias`, `conteudo_blocos`, `conteudo_arquivos`, `conteudo_casamentos`, `conteudo_concorrentes`, `conteudo_eventos`, `conteudo_jobs`, `conteudo_metricas` (9; 25 policies, 4 restritivas) | RPC: `conteudo_aprovar_e_agendar`, `conteudo_casar_na_mao`, `conteudo_decidir`, `conteudo_decidir_casamento`, `conteudo_ideia_virar_peca`, `conteudo_reavisar` (portões a ler no corpo de cada uma). Edge: `conteudo-trigger` | `src/ferramentas/conteudo/*` (30 acessos, 9 dinâmicos) | 5.0, 5.8 (`internal/github`) | 9º | padrão |
| **5.10** Autenticidade (selo Vessel no painel) | Lotes, peças, gravação NFC, baixas e garantias, registros e pedidos de registro, troca de dono, pedidos de cartão, lembretes, clientes, leituras; `POST /vessel-baixar-cartao`. **Primeira task: `disparar_robo` sem `pg_net`** (Ruling 28): a função passa a gravar em `disparos_pendentes` (migração goose + versão na camada de compatibilidade) e uma tarefa do worker despacha (`vessel-fotos-trigger`, `vessel-cartoes-trigger` pelo `internal/github`; `vessel-espelhar-lista` para a tarefa do Plano 6). Sem isso, o insert em `vessel_lista_espera` QUEBRA no corte | `vessel_lotes`, `vessel_pecas`, `vessel_registros`, `vessel_baixas`, `vessel_cartao_pedidos`, `vessel_lembretes`, `vessel_clientes`, `vessel_garantias_baixadas`, `vessel_leituras`, `vessel_pedidos_de_registro` (10; 10 policies, `is_vessel_admin()`) | RPC (16): `vessel_alertas`, `vessel_baixar_garantia`, `vessel_baixar_peca`, `vessel_decidir_pedido_de_registro`, `vessel_definir_material_do_lote`, `vessel_desfazer_baixa`, `vessel_desmarcar_gravada`, `vessel_editar_lote`, `vessel_excluir_lote`, `vessel_excluir_peca`, `vessel_fila_de_registros`, `vessel_gerar_lote`, `vessel_marcar_gravada`, `vessel_pedir_cartoes`, `vessel_sobrescrever_etiqueta`, `vessel_trocar_dono` (portão `VesselAdmin` na maioria; `vessel_decidir_pedido_de_registro` usa `auth.role()`: conferir). Edge: `vessel-baixar-cartao`. Gatilhos: 8 | `src/ferramentas/autenticidade/tela-de-autenticidade.vue`, `lotes.js` | 5.0, 5.8 (`internal/github`), D0 (testes de `db/*.test.mjs` de registro/transferência portados) | 10º | **opus** (garantia, dono da peça, fila do robô) |
| **5.11** Comercial Vessel e leads | Atendimentos e situação, beauty sessions, private edits, stylist circle (etapas, motivos, qualificações, contatos), praças e cidades, edições e turmas, material gráfico, agenda das lojas; leitura de leads (`vessel_lista_espera`, `vessel_origens`, `vessel_pessoas`, `carrinho_eventos`, `chatwoot_eventos` com `is_vessel_leads()`/módulo), abandono de carrinho (`checkout_abandono`, só leitura; as funções da fila ficam em SQL, Ruling 25) | `vessel_atendimentos`, `vessel_pessoas`, `vessel_origens`, `vessel_lista_espera`, `vessel_pedidos`, `vessel_pedido_itens`, `vessel_private_edits`, `vessel_edicoes`, `vessel_client_advisors`, `vessel_convite_aberturas`, `vessel_sessao_aberturas`, `vessel_stylist_aberturas`, `carrinho_eventos`, `chatwoot_eventos`, `checkout_abandono` (15; 18 policies) | RPC (62, quase todas `vessel_pode(<ferramenta>, ver\|editar)` por dentro): `vessel_agenda_das_lojas`, `vessel_beauty_session_{apagar,arquivar,cadastrar_lead,criar,editar,encerrar}`, `vessel_chave_da_convidada`, `vessel_conta_das_beauty_sessions`, `vessel_conta_das_private_edits`, `vessel_convidadas_do_encontro`, `vessel_convidar_para_encontro`, `vessel_convite_marcar`, `vessel_criar_private_edit`, `vessel_edicao_{abrir,criar,encerrar,incluir_stylist,tirar_stylist,turma}`, `vessel_edicoes_listar`, `vessel_eventos_de_origem`, `vessel_leads_da_beauty_session`, `vessel_placar_da_edicao`, `vessel_praca_cidade_{desvincular,vincular}`, `vessel_praca_{criar,editar}`, `vessel_pracas_listar`, `vessel_private_edit_{apagar,arquivar,editar,encerrar,situacao,sobreposicoes}`, `vessel_qualificacoes_vigentes`, `vessel_rastreio_dos_stylists`, `vessel_scorecard_da_stylist`, `vessel_situacao_do_atendimento`, `vessel_stylist_{avaliar,contatos,criar,desativar,editar,etapas,historico_de_etapas,mover_de_etapa,qualificacoes,registrar_contato}`, `vessel_stylist_etapa_{criar,excluir,liberar_private_edit,marcar_prospectada,mover,renomear,tipo}`, `vessel_stylist_motivo_{ativar,criar,exigir_nota,mover,renomear}`, `vessel_stylists_para_escolher`. Fora da lista (ver I.2): as 3 de página pública `anon` (`vessel_convite_da_convidada`, `vessel_rsvp_da_convidada`, `vessel_pedir_atendimento`, Plano 6) e as 5 internas com `EXECUTE` revogado (`vessel_cpf_valido`, `vessel_faixa_da_nota`, `vessel_situacao_do_convite`, `vessel_numeros_do_stylist_circle`, `vessel_telefone_canonico`) | `src/ferramentas/comercial-vessel/*` (6 telas, helper `chamar`), `beauty-sessions`, `atendimentos` (REST cru), `abandono-carrinho`, `meta-ads` (leads) | 5.0, 5.1, D0 | 11º | **opus** (dado pessoal de clientes; 72 portões) |
| **5.12** Painéis pequenos | Notícias (leitura; `noticias_panorama` é `true` até para anon: só sessões, Ruling 36), status do Claude/robôs (visão `robos_saude`, fora do catálogo: regra explícita `Autenticado` = o que a visão dá hoje; `ia_execucoes` do 5.1), custos de IA (`POST /custo-anthropic`, `POST /custo-openai` com o portão da edge: `role = 'admin'`; chave admin em variável de ambiente), Início e Gestão interna (sem acesso direto hoje: só conferir) | `noticias_concorrentes`, `noticias_panorama` (2; 3 policies) + visão `robos_saude` | Edges: `custo-anthropic`, `custo-openai` | `src/ferramentas/noticias/*`, `claude-status/tela-de-status-claude.vue`, `inicio`, `gestao-interna` | 5.0 | 12º (pode andar em paralelo a qualquer um) | padrão; **opus** na task dos custos (chave admin de IA) |

### IV.3 Ordem e paralelismo

5.0 → 5.1 → 5.2 → {5.3, 5.4} → 5.5 → 5.6 → 5.7 → 5.8 → {5.9, 5.10} → 5.11; 5.12 a qualquer momento depois do 5.0. A primeira a rodar entrega D0. O Plano 6 (Storage, Vessel pública, Zoho) consome o `internal/github` do 5.8 e a fila `disparos_pendentes` do 5.10; o Plano 7 (front) troca cada sítio listado na coluna "Telas" quando o sub-plano dele estiver mesclado. Critério de entrada da virada (spec §9): os 12 sub-planos mesclados, o teste de contrato verde e `RPCPendentes` vazio (cada um dos 92 nomes de RPC registrado em `FuncoesRPC`) e os 15 restantes em `RPCForaDoPainel` por Ruling (Task 10).

---
## Rulings do plano

1. Ruling: Arquitetura (a), endpoints por domínio com SQL explícito, e não (b) uma camada genérica de tabela/filtros por JSON — (b) recria o PostgREST sem a RLS: um erro no catálogo abriria a tabela inteira a qualquer combinação de colunas e filtros, e "sem RLS, autorização em código" pede que cada leitura seja uma consulta conhecida; o trabalho extra de (a) é cortado por `dados.Consulta` (declarativa) e pelo registro de RPC — custo se errada: ~150–250 rotas escritas nos sub-planos em vez de uma.
2. Ruling: As 92 funções que o painel chama por `.rpc` (das 107 da categoria F; as outras 15 não têm chamada do painel, ver I.2) NÃO são reescritas em Go no Plano 5: ficam em plpgsql e passam por `POST /rpc/{nome}` (lista branca, parâmetros tipados, portão em Go que espelha a checagem interna, execução em `banco.ComUsuario`) — desvio consciente da leitura literal da spec §6 ("lógica de negócio reescrita em Go"): elas já são a API de negócio, 97 já checam permissão por dentro, várias dependem de trava e transação do banco (§6 manda manter essas como query), e reescrever 107 regras na migração é o jeito mais certo de mudar regra de negócio (fora de escopo, §1); a troca por Go pode ser feita depois, uma a uma, atrás da mesma rota — custo se errada: duas linguagens com regra de negócio até essa troca.
3. Ruling: A permissão das tabelas é COMPILADA do catálogo de produção embutido (`autz.Compilar`), não escrita à mão por tabela — 276 policies têm só 40 formas e 22 átomos; transcrever à mão 144 tabelas é onde nasceria o vazamento silencioso que a spec §5 aponta como risco principal; forma desconhecida falha a compilação (nega) — custo se errada: uma policy nova em produção com forma inédita impede a API de subir até alguém mapear a forma (intencional).
4. Ruling: O oráculo do teste de contrato é a PRÓPRIA RLS do Postgres com as policies e as 25 funções verbatim de produção, comparada ao Go pessoa × tabela × operação × linha, com cobertura assertada (cada regra mostra permitido e negado) — reimplementar a semântica da RLS no teste repetiria o entendimento (e os erros) do código; o ensaio provou o valor: o oráculo achou a subconsulta de `profiles` que esconde o perfil da conta desativada — custo se errada: o teste leva ~16 s e cria/apaga bancos `autz_*` no Postgres de teste.
5. Ruling: Policy só para `anon` ou só para `service_role` não vale para sessão da API, e `auth.role() = 'service_role'` compila como `false` — sessão da API é sempre de pessoa ou conta de serviço logada (`authenticated` no Supabase); a chave de serviço some com o Supabase (robôs: Plano 7) — custo se errada: nenhum para o painel; um robô que dependia da chave de serviço precisa de rota própria no Plano 7.
6. Ruling: As subconsultas de policy que leem `profiles` (e o `COALESCE((select is_superadmin …))`) exigem a conta ATIVA em Go, porque em produção elas passam pela RLS de `profiles` (`auth_read_profiles`: `conta_ativa()`) — é a migração 054 ("desativado fecha de verdade"), achada pelo oráculo — custo se errada: nenhum (sessão de conta desativada já não existe; o predicado fica fiel se um dia existir).
7. Ruling: O `Escopo` é carregado do banco a cada requisição de domínio (6 consultas pequenas), sem cache — 26 usuários; cache traria invalidação (permissão retirada que continua valendo) — custo se errada: algumas dezenas de ms por requisição.
8. Ruling: O JSON das leituras é montado pelo Postgres (`json_agg`/`row_to_json`/`to_json`) e toda conexão usa `timezone=UTC` — é o mesmo serializador do PostgREST, então datas (`+00:00`), `numeric`, nulos e ordem das chaves chegam iguais às telas sem código de formatação em Go — custo se errada: nenhum conhecido; o separador entre itens do array é `", \n "` como no PostgREST (testes comparam conteúdo, não bytes).
9. Ruling: Lista sem permissão = `200 []` (como o PostgREST com RLS); linha inexistente OU invisível = `404`; visível sem permissão = `403` — paridade com o que as telas tratam hoje, e o 404 igual para "não existe" e "não é seu" fecha IDOR (um id de outra conta não confirma que existe) — custo se errada: "não tenho permissão para a lista" continua invisível na tela, como hoje.
10. Ruling: Leituras têm teto de 1000 linhas (o `max_rows` do Supabase), filtros e ordens declarados por rota, e parâmetro desconhecido/repetido é `400` — nenhuma tela recebeu mais de 1000 linhas por leitura; recusar o parâmetro desconhecido pega erro de digitação do Plano 7 em vez de devolver dados sem filtro — custo se errada: uma tela que precisasse de mais de 1000 linhas pagina (já precisava).
11. Ruling: Toda escrita de domínio é `autz.PodeCriar/PodeEditar/PodeApagar` (linha travada `for update`; linha antiga com Ler + USING; linha nova com WITH CHECK) seguida de SQL explícito dentro de `banco.ComUsuario` — os gatilhos `guard_profiles`, `impedir_autopromocao` e `guard_user_permissions` leem `auth.uid()` (e o último DEIXA PASSAR sem identidade); conferir a linha nova impede mover uma linha para uma conta/loja que a pessoa não vê — custo se errada: uma consulta a mais por escrita.
12. Ruling: `sqlc` (spec §3.1) NÃO é adotado: SQL cru com `pgx` e JSON montado pelo Postgres — as tabelas de produção não têm DDL no repositório (anteriores às migrations) e as leituras não precisam de structs; `api worker conferir` e o D0 cobrem as premissas de schema — custo se errada: erro de coluna aparece no teste de integração, não na compilação.
13. Ruling: `Ator.PodeModulo` (`features`) e `Ator.Pode` (`permissions`) NÃO são unificados (pendência do Plano 3) — as policies de produção leem as DUAS colunas literalmente (`'frota' = any(features)` e `permissions ? 'meta.hora'`), e `features` é derivada pela tela, podendo divergir; unificar mudaria quem passa — custo se errada: as duas colunas continuam tendo de andar juntas (como hoje).
14. Ruling: A regra de canais por loja do `bling-proxy` (`canais.DoEscopo`, Plano 3) e a de `pode_ver_canal` (tabelas `bling_pedido_*`) continuam duas regras — em produção também são duas (a do JS amplia a supervisora pelo NOME do grupo; a do banco só por `grupo_id` e pelos vínculos), e cada uma vale na superfície em que valia — custo se errada: as duas regras precisam ser mantidas em sincronia por decisão de produto, não por migração.
15. Ruling: Login de conta desativada com a senha CERTA responde `403 conta_desativada`; com a senha errada, o mesmo 401 de quem não existe — a tela já mostra "conta desativada" (hoje pela RPC `minha_conta_esta_desativada`, depois de logar); exigir a senha certa evita oráculo de contas — custo se errada: quem sabe a senha de uma conta desativada descobre que ela está desativada (já descobria hoje).
16. Ruling: Links de senha são tokens de 256 bits de uso único guardados como hash (`tokens_de_senha`), 1 h para troca e 24 h para convite, enviados pelo ZeptoMail; "esqueci a senha" responde igual para todo mundo e envia fora da requisição; o link só leva a `ENDERECOS_DO_APP` — sem o Auth do Supabase alguém tem de mandar o e-mail, e o ZeptoMail já é o provedor verificado da casa; resposta e tempo iguais evitam enumerar contas — custo se errada: e-mail perdido só aparece no log (a pessoa pede de novo).
17. Ruling: `definir-senha` derruba todas as sessões e já devolve uma nova; `trocar-senha` derruba as OUTRAS e tira `precisa_trocar_senha` na mesma transação (substitui a RPC `marcar_senha_trocada`) — troca de senha é o momento de expulsar quem tinha a senha antiga; fazer as duas coisas juntas evita senha trocada sem a cobrança tirada — custo se errada: a pessoa entra de novo nos outros aparelhos.
18. Ruling: Sessão de "entrar como" não troca senha, não convida/exclui contas, não entra como terceiros e não confere senha (sempre `403 {"error":"sem_permissao","mensagem":<frase>}`, o formato do `TrocarSenha`) — o propósito é ver o que a pessoa vê; agir em nome dela sobre conta e assinatura seria fraude possível (hoje o JWT do alvo permitia) — custo se errada: o super-admin sai da sessão impersonada para administrar (deve mesmo).
19. Ruling: A sessão de "entrar como" vale 1 h e não renova; a resposta passa a `{token, expira_em}` — sem refresh token no desenho de sessão opaca (spec §4), 1 h é o access token do Supabase; a pendência das NOTAS ("TTL cheio de 12 h") fica resolvida — custo se errada: o super-admin entra de novo depois de 1 h.
20. Ruling: Troca de senha por super-admin (`resetPasswordUserId`) derruba as sessões do alvo, além de marcar a senha como provisória como a edge — senha trocada por outra pessoa costuma ser resposta a conta comprometida — custo se errada: o alvo entra de novo com a senha provisória (que já precisaria trocar).
21. Ruling: `invite-user` mantém o portão e as respostas da edge, inclusive "qualquer admin exclui qualquer conta" e "admin cria outro admin" — "mesmas permissões de hoje"; restringir é decisão do dono, não da migração (achado registrado) — custo se errada: um admin continua podendo excluir um super-admin, como hoje.
22. Ruling: `conferir-senha` mantém a contagem em memória por pessoa (5 erros, 10 min) — mesmo furo aceito pelo dono na edge; com uma instância da API ele fica menor (a edge tinha várias cópias) — custo se errada: reiniciar a API zera a contagem.
23. Ruling: `minha_conta_esta_desativada` e `marcar_senha_trocada` não viram RPC — sessão de conta desativada não existe mais (o login diz `conta_desativada`) e a troca de senha tira a cobrança sozinha — custo se errada: nenhum.
24. Ruling: O push de vendas continua mandando o total de todas as lojas a todo inscrito (pendência do Plano 3) — é o comportamento de hoje; recortar por escopo de loja é decisão de produto — custo se errada: quem tem escopo por equipe continua vendo o total global no push.
25. Ruling: As funções da fila do abandono (`checkout_*`, `pegar_da_fila`, `marcar_*`) ficam em SQL (pendência do Plano 4) — dependem de `FOR UPDATE SKIP LOCKED` e trava do banco (spec §6) e já estão provadas pelo worker — custo se errada: nenhum.
26. Ruling: Portão de RPC = a checagem interna da função; função SECURITY INVOKER que lê tabela (hoje só `frota_corrente_do_veiculo`, que lê `frota_checklist*`) ganha o portão da regra de Ler dessas tabelas; validador puro sem tabela = `Autenticado` — a função invoker era protegida pela RLS de quem chamava, que deixa de existir; a definer já ignorava a RLS — custo se errada: um portão a mais por função invoker (as 48 invoker de produção estão listadas na triagem).
27. Ruling: Tabela ou visão fora do catálogo (hoje só `robos_saude`) só é lida com regra explícita no sub-plano, com Ruling — `autz` nega o que não conhece — custo se errada: nenhum.
28. Ruling: `disparar_robo` (usa `pg_net`, que não vai para o Postgres novo) vira gravação numa fila `disparos_pendentes` despachada pelo worker, no sub-plano 5.10, antes do corte — três gatilhos o chamam e `vessel_espelhar_agora` não trata erro: sem a troca, o insert em `vessel_lista_espera` quebra no corte — custo se errada: até o worker consumir a fila, o robô acorda com até 1 min de atraso.
29. Ruling: A DDL real dos testes de domínio (D0) vem de um `pg_dump --schema-only` do banco do ENSAIO local, nunca da produção, limpa por `limpar-dump.mjs` e versionada — schema não é dado pessoal, e o ensaio do Plano 2 já restaura produção localmente; testar contra os gatilhos e funções reais pega o que DDL reescrita esconde — custo se errada: o sub-plano que entregar D0 depende de o ensaio ter rodado.
30. Ruling: Os botões "coletar e corrigir"/"revalidar" da aba Saúde do admin NÃO são portados — hoje eles chamam `coletar-dados`/`auditar-dados` com o token da pessoa e a edge exige o segredo de cron: falham calados (o `catch` engole); o Plano 4 decidiu não ter rota HTTP que dispare tarefa — custo se errada: o botão continua sem efeito (o Plano 7 o remove ou desliga).
31. Ruling: `ajudantes.sql` é versionado, gerado de `02-funções.csv` por script — o oráculo precisa dos corpos de produção (as migrations podem estar atrás do banco); os 3 e-mails de `is_superadmin()` já estão em `db/migrations/acessos/013_superadmin_gabriel.sql` — custo se errada: refazer o levantamento exige rodar o script de novo.
32. Ruling: Remetente dos e-mails da Central: `ZEPTOMAIL_DE` (padrão `nao-responda@vesselbrasil.com.br`, o domínio verificado) com o nome "Central de Inteligência RBV"; links por `ENDERECOS_DO_APP`/`ENDERECO_PADRAO` com os padrões de `_shared/enderecos-do-app.js` — é o único domínio com DKIM no ZeptoMail hoje; trocar endereço vira variável, não deploy — custo se errada: convite da Central sai de um domínio Vessel até alguém verificar outro.
33. Ruling: Senha de 6 a 72 caracteres — 6 é a regra da tela e do Auth do Supabase; acima de 72 bytes o bcrypt ignora o resto, então recusar é mais honesto que cortar — custo se errada: nenhum (ninguém usa senha de 73+).
34. Ruling: No sub-plano 5.6, o `meta-proxy` passa a recusar `accountId` fora de `allowed_accounts` (pendência do Plano 3) — as tabelas dessa conta já são negadas pela policy restritiva `pode_ver_conta`; deixar o proxy ao vivo aberto contradiz a mesma regra — custo se errada: quem lia ao vivo uma conta que não podia ver nas tabelas perde esse acesso (o que é o certo).
35. Ruling: Os sub-planos são 12, por dono de tabela (prefixo) e não por tela — várias telas (admin, meta-ads) leem tabelas de vários domínios; agrupar por tabela deixa cada regra de policy num só sub-plano e num só revisor — custo se errada: uma tela só fica completa quando todos os sub-planos que ela usa estiverem mesclados.
36. Ruling: Policies `true` abertas a `anon`/`public` em leitura (`noticias_panorama`, `gt_config_metricas`) são servidas só a sessões; o insert público de `access_requests` (pedir acesso no login) vira rota pública com limite no 5.1 — a lista de rotas públicas é curta e explícita (spec §5); nenhum consumidor anônimo conhecido lê essas tabelas — custo se errada: um consumidor externo anônimo, se existir, aparece no Plano 7 e ganha rota própria.

## Cobertura da spec e o que vem depois

**Coberto por este plano (5.0):**
- §5 (autorização): ponto único de decisão por tabela (`autz`, negar por padrão), escopo de equipe/loja/conta/estoque/grupo, o catálogo de produção como especificação, testes de contrato ator × operação × recurso (Task 4) e portões de RPC conferidos contra as funções.
- §4 (autenticação): convite e troca de senha por e-mail com token de uso único, "entrar como" auditado, conta desativada, conferência de senha; a regra de canais por loja já estava no Plano 3 (`GET /eu/canais`).
- §6 (funções do banco): triagem das 308 (seção I.2) e o caminho de cada categoria; gatilhos ficam e veem a identidade por `banco.ComUsuario`.
- §9, workstreams 3 e 4: o catálogo virou código e teste; os módulos de domínio estão fatiados em 12 sub-planos com escopo fechado. Workstream 7 (front): contrato do cliente `api` (seção II.2).
- §11 (segurança): segredo novo só em variável de ambiente e mascarado; nada do pedido no SQL; IDOR fechado por 404.

**Fica para depois:**
- **Sub-planos 5.1–5.12** (seção IV), na ordem da IV.3; o primeiro entrega D0.
- **Plano 6:** Storage (buckets, URLs assinadas, upload), rotas públicas da Vessel (as 30 RPCs da categoria V, `vessel-conta`), Zoho/Microsoft; consome o `internal/github` (5.8) e a fila `disparos_pendentes` (5.10).
- **Plano 7:** `src/compartilhado/api.js` contra a seção II.2; troca dos ~294 `.from`, 112 REST crus, ~150 RPCs e 58 chamadas de edge listadas pelos sub-planos; login/sessão contra as rotas do 5.0 (incluindo o formato novo do link de senha e do "entrar como"); robôs do `coletor/` e consumidores externos.
- **Plano 8:** virada; antes dela, `api worker conferir` no banco restaurado e o teste de contrato com o catálogo (e o `ajudantes.sql`) refeitos se produção tiver mudado.
