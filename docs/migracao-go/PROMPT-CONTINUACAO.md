# Prompt de continuação — saída do Supabase (API em Go + Postgres próprio)

Cole tudo abaixo numa sessão nova do Claude Code. Estado registrado em **2026-10-09, noite**.

---

Você vai continuar um projeto já em andamento. **Leia este prompt inteiro antes de agir.** Responda sempre em português, com acentuação correta.

## 1. Objetivo (onde queremos chegar)

Tirar o `social-dashboard` (Central de Inteligência RBV, repo `rbv-co/social-dashboard`) **por completo do Supabase**, para não somar complexidade ao `core` (Laravel, dono do espelho do Bling/Shopify; está sendo portado para Go em outra frente, PR `rbv-co/vessel#223`, que só interessa como "o core continua falando HTTP com o mesmo contrato").

Decisões firmes do dono (não reabrir):
- **Postgres próprio** (não MySQL) + **API nova em Go**.
- **Sem RLS**: a autorização é reescrita em código (`Ator.Pode`). As policies reais de produção viram a especificação dos testes.
- Virada em **big-bang** (um corte só), com **ensaio** repetível e Supabase **intacto por 14 dias** como rollback. Cancelar o plano do Supabase só com ok explícito do dono.
- Bling e Meta sempre via **core** (proxy com rate gate de 3 req/s por conta); a API Go nunca chama o Bling direto.
- O front (Vue) continua e sai da Vercel para nginx na VPS (outra sessão já fez: `central.rbvcompany.com`, PR #332 mesclado; a API entra depois como `location /api` no mesmo vhost, com `proxy_set_header X-Real-IP $remote_addr;`).

Critério de sucesso: o sistema roda sem nenhuma chamada a `*.supabase.co`, sem perda de dados, com as mesmas permissões de hoje, e o Supabase fica desligado após o período de retorno.

## 2. Regras de trabalho (do dono — valem sempre)

- **Plano antes de executar. Nada em produção, merge ou push em branch compartilhada sem ok explícito.** Billing do GitHub por último. O dono delegou: "faz tudo que precisa, me deixa só rodar os comandos; o que você conseguir pode rodar". Isso cobre **leitura** em produção e trabalho local/PR; **não** cobre mexer na VPS (`ssh op` é só para leitura sem ok), nem cancelar Supabase, nem merge do PR.
- **Nunca imprimir segredos** (URLs de conexão, chaves). Sempre passar saídas de `psql`/`pg_dump` por `sed -E 's#postgres(ql)?://[^ "]*#<URL>#g'`. Nunca `supabase secrets list` sem `jq -r '.[].name'`.
- **GitHub:** conta ativa `GabrielGertrudes07` tem push em `rbv-co/social-dashboard`. **Nunca `gh auth switch`** nem `vercel switch`. (O `CLAUDE.md` do repo fala em `brenoov`; está desatualizado nesta máquina.)
- O checkout principal `/Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard` costuma ter **arquivos sujos de outras pessoas** (`LEIA-ME-COMO-RODAR.txt`, `coletor/opr-layout-scratch.html`): **não descartar nem commitar**. Trabalhe em **worktrees** (`.claude/worktrees/...`), nunca direto na `main`. Nunca `git stash` solto.
- Comandos para o dono colar: **uma linha só** (quebra de linha quebra o `&&`); para rodar no shell dele, sugerir `! comando`.
- Skills do projeto que foram usadas e devem continuar: `superpowers:brainstorming` → `superpowers:writing-plans` → `superpowers:subagent-driven-development` (um subagente por tarefa, revisão de spec+qualidade por tarefa, revisão final do branch) → `superpowers:finishing-a-development-branch`. Registre decisões como `Ruling:` no ledger e liste todas ao fim ("Rulings I made").

## 3. Documentos de referência (leia nesta ordem)

No repo `social-dashboard` (já estão no PR #333):
1. `docs/superpowers/specs/2026-10-09-sair-do-supabase-design.md` — **a spec** (autoridade).
2. `docs/migracao-go/RESULTADO-DO-LEVANTAMENTO.md` — números reais de produção (substituem as contagens da spec).
3. `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md` — requisitos de nginx, decisões para os próximos planos, minors adiados.
4. `docs/superpowers/plans/2026-10-09-api-go-plano-1-levantamento-e-nucleo.md` — Plano 1 (**executado**).
5. `docs/superpowers/plans/2026-10-09-api-go-plano-2-postgres-e-ensaio.md` — Plano 2 (**em execução**).
6. `docs/migracao-go/catalogo-policies-producao.json` — as 276 policies reais (especificação das permissões).

Memória do assistente (se disponível): `project-saida-do-supabase.md`, `project-central-fora-da-vercel.md`, `project-core-para-go.md`, `reference-vps-e-ferramentas.md`, `feedback-ordem-e-limites-de-autonomia.md`.

## 4. O que já foi feito

**Spec e decisões** — escritas e aprovadas pelo dono.

**Plano 1 — executado e revisado** (levantamento + núcleo da API em Go, em `api/`): config, Postgres+goose (`usuarios`, `sessoes`), sessões opacas (token guardado como hash), login/logout/`/auth/eu`, limite de tentativas em 3 chaves (e-mail+IP, e-mail, IP), `Pode()` negando por padrão, middleware `Exigir` (só tipos `painel`/`servico`), `profiles.disabled` respeitado (5 contas desativadas em produção), importador idempotente de `auth.users` (preserva hash bcrypt), worker com `pg_try_advisory_lock` e registro em `robos_execucoes`. Catálogo de policies a partir das migrations (`db/catalogo/`). Foi mesclado **localmente** no `main` do checkout principal (merge `ead64b2d`, **sem push no main**) e enviado como **PR #333** (`feat/api-go-nucleo`, aberto, sem merge, CI do GitHub bloqueado por billing: o gate real é `make -C api teste PG_PORTA=58432`).

**Levantamento em produção — rodado (somente leitura, `begin read only`)**. Resultados em `docs/migracao-go/RESULTADO-DO-LEVANTAMENTO.md`. Fatos-chave: banco de **197 MB**; **276 policies** reais em 144 tabelas (as migrations tinham 217); **308 funções** (260 `security definer`; só **64 usam `auth.uid()`**, 18 `extensions.*`, 2 `net.http_*`); **63 triggers**; **24 crons** ativos (lista real em §8.1 da spec; `estoque-do-site` foi desligado em 2026-10-08, **não portar**; `vessel-rd-station` é SQL puro e exige decisão); **26 usuários**, todos e-mail+senha; 24 perfis, 5 `disabled`; **11 buckets ≈ 640 MB** (`ig-cache` 339 MB e `fotos-modelo` 253 MB são caches regeneráveis); **21 FKs de 16 tabelas apontam para `auth.users(id)`**; sem colisão de nomes (`usuarios`, `sessoes`, `goose_db_version` não existem no `public` de produção); 52 nomes de segredos das edges; robôs que já falham muito hoje (`enviar-relatorio-hora` 47%, `vessel-espelhar-lista · planilha` 53%, `vessel-log-de-carocos` 28%). Os CSVs completos estão **no disco, fora do git**: `.claude/worktrees/levantamento-ro/docs/migracao-go/levantamento/`.
- Ajuste necessário descoberto: o `DATABASE_URL` do `coletor/.env` é o **pooler em modo transação (porta 6543)**, que ignora `PGOPTIONS`; `levantar.sh` agora envolve cada consulta em `begin read only`. Para `pg_dump` usar a **porta de sessão 5432** (funciona). O servidor é **Postgres 17.6** e o `pg_dump` local é 16 → usar as ferramentas do container `postgres:17`.
- Credenciais para ler produção: `coletor/.env` do checkout principal tem `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ACCESS_TOKEN` (extrair sem imprimir).

**Plano 2 — escrito** (Postgres próprio, camada de compatibilidade, dump/restore, cópia do Storage, ensaio cronometrado). Já incorpora a descoberta das 21 FKs: a limpeza do dump reescreve `REFERENCES auth.users(id)` → `REFERENCES public.usuarios(id)`, o restore cria `usuarios` antes de carregar o schema (subcomando novo `api migrar`) e há `conferir-orfaos.sh`.

## 5. Estado exato dos branches e worktrees (no disco desta máquina)

| Caminho | Branch | Estado |
|---|---|---|
| `/Users/gabrielgertrudes/Projetos/Trabalho/lavessel/social-dashboard` (checkout principal) | `main` local | À frente de `origin/main` com o merge `ead64b2d`; arquivos sujos de terceiros. **Não mexer.** Ao mesclar o PR #333 no GitHub, o `main` local pode divergir (principalmente se for squash): combinar com o dono antes de qualquer `pull`/`reset`. |
| `.claude/worktrees/levantamento-ro` | `feat/api-go-nucleo` (= PR #333, head `e89aad93`) | Limpo. Tem os CSVs do levantamento (ignorados pelo git). |
| `.claude/worktrees/api-go-pg` | `feat/api-go-postgres-ensaio` (empilhada sobre `feat/api-go-nucleo`; **não enviada ao GitHub**) | Commits do Plano 2: `64064b6e` (plano), `aa372b58` (Task 1), `ef3f08d2` (Task 2). **Edições NÃO commitadas e NÃO verificadas** em `api/internal/banco/compat_test.go` e `usuario_test.go` (correção a meio caminho, interrompida): conferir com `git diff`; ou terminar conforme o item abaixo ou descartar com `git checkout -- <arquivos>`. |

Ledger do Plano 2 (briefs, relatórios e `progress.md` com todos os `Ruling:`): `.claude/worktrees/api-go-pg/.superpowers/sdd/2026-10-09-api-go-plano-2-postgres-e-ensaio/` (ignorado pelo git). Scripts da skill: `/Users/gabrielgertrudes/.claude/plugins/cache/claude-plugins-official/superpowers/6.4.1/skills/subagent-driven-development/scripts/` (`sdd-workspace`, `task-brief`, `review-package`). Se o ledger sumir, recupere pelo `git log`.

## 6. O que falta (em ordem)

**A. Terminar o Plano 2 (SDD, worktree `api-go-pg`)**
1. **Tasks 1+2** (compat `auth.uid()`/`extensions`/papéis + `banco.ComUsuario`): implementadas e revisadas; falta a **rodada 1 de correção**: os testes de não-vazamento do `auth.uid()` precisam usar **a mesma conexão** nas duas fases (hoje usam o pool e podem passar sem exercitar o quirk do GUC `''` pós-transação), assertando também `current_setting('app.usuario_id', true) = ''` e `auth.uid()` ainda nulo; provar (sem commitar) que o teste falha sem o `nullif`. Depois, re-revisão escopada e fechar no ledger. Minors adiados estão no ledger.
2. **Tasks 3–7**, nesta ordem: 3 `limpar-dump.mjs` (parser de SQL com `$$`, remove policies/RLS/grants/extensões do Supabase, **reescreve FKs para `public.usuarios`**) → 4 dump/restore/conferência + subcomando `api migrar` + `ensaio-local.sh` (prova de ponta a ponta com um "Supabase de mentira" no Docker; no macOS ajustar rede do Docker/`host.docker.internal`) → 5 Postgres da API na VPS (compose, backup, teste de restauração; **o passo de aplicar na VPS só com ok do dono**) → 6 `copiar-storage.mjs` → 7 `ensaio.sh` (cronometrado, alvo local obrigatório).
3. **Pré-voo já feito** para o Plano 2 (tabela no ledger). Modelos usados: implementadores `sonnet`; revisores `sonnet`, `opus` para parser de SQL e scripts que tocam produção; revisão final `opus`.
4. **Revisão final do branch**, onda única de correção, re-revisão escopada, depois **ensaio real** (Task 7 Step 4: leitura em produção + alvo local; dumps têm dado pessoal e segredos → apagar ao fim) e relatório de durações (a janela de manutenção do corte).
5. **Abrir PR do Plano 2** (base `feat/api-go-nucleo` empilhado, ou `main` depois do #333) — **push/PR só depois do ok** ou conforme a delegação atual (PR é o fluxo do repo; não fazer merge).

**B. Planos 3–8 (escrever e executar depois, na mesma sequência spec→plano→SDD)**
- **3** Edges que o core já cobre: `bling-proxy`, `meta-proxy`, `estoque-do-site` (já desligado), `enviar-push-vendas`, coletores Meta; webhooks Shopify/Chatwoot (`receber-webhook-*`) → core ou Go com HMAC.
- **4** Worker e crons: 24 jobs reais; decidir `vessel-rd-station`; **reescrever o workflow `guardar-copia-do-banco`**; robôs que já falham muito (decidir reproduzir × corrigir); `conferido_em` em `robos_execucoes`; namespace de advisory lock (26 funções já usam `pg_advisory`).
- **5** Domínios (`frota`, `acessos`, `conteudo`, `admin`, `patrimonio`, `meta-ads`, `gestao-trafego`, `autenticidade`, `comercial`): usar `catalogo-policies-producao.json` e a triagem das 308 funções (lógica de negócio × consulta pura × trigger de integridade). Entra aqui "entrar como outro usuário", convites/reset de senha, regra de canais por loja.
- **6** Zoho/Microsoft (`acessos-*`, `enviar-pdf-checklist`, `vessel-espelhar-lista`, `vessel-log-de-carocos`, `vessel-triagem-da-vaga`), Storage (URLs assinadas), rotas públicas da Vessel (≈20 RPCs chamadas por `vessel-brasil` com chave anon, `vessel-conta`, `vessel-registrar-garantia`, `vessel-lembretes`), CORS/subdomínio para `vesselbrasil.com.br`; decidir como clientes da Vessel ficam fora do login do painel (`usuarios` ainda não tem tipo de conta).
- **7** Front (trocar `supabase-js` por cliente da API: ~347 `.from`, 43 `.rpc`, 39 `functions.invoke`), `coletor/` e 29 workflows do GitHub Actions, consumidores externos (tema Shopify `capturacontato.liquid`, workflow n8n `OWv78JhWKGS5x7br`, PDV `pecas-origem.service.ts`, `vessel-brasil`).
- **8** Virada e rollback: congelar o Supabase em somente leitura, dump final, restore, trocar URLs/segredos/build, observação ativa; Supabase intacto 14 dias; dump horário do Postgres novo nas primeiras 24 h; **cancelamento do plano só com ok explícito**. Pós-corte: todos os 26 usuários precisam entrar de novo (sessões do GoTrue não migram), sem trocar senha.

## 7. Decisões pendentes do dono (pergunte quando chegar a hora, uma por vez)
- Migrar ou regenerar os buckets `ig-cache` e `fotos-modelo` (~590 MB, caches).
- `vessel-rd-station`: portar para o worker ou descartar.
- Aplicar o Postgres na VPS (Task 5 do Plano 2) — ok explícito para `ssh op` com escrita.
- Onde fica o código Go (assumido `api/` no repo `social-dashboard`).
- `sqlc` (spec §3.1) ainda não adotado (SQL cru com `pgx`): decidir antes dos planos de domínio.
- Quando fazer push/PR do que estiver pronto e quando mesclar o PR #333.

## 8. Armadilhas já pagas (não repetir)
- Portas **55432/55433 do host estão ocupadas** por outras sessões: use `make -C api teste PG_PORTA=58432`.
- Teste de banco que **pula** (sem `TEST_DATABASE_URL`) **não é** aprovação: conferir contagem de executados × pulados.
- `npm run test:ci` tem **49 falhas pré-existentes** neste ambiente (falta `.env`), idênticas com e sem este trabalho; use `node --test <arquivos>` ao verificar o que você mudou (passar **diretórios** ao `node --test` falha no Node 22).
- `go.mod` ficou em `go 1.26.0` (uma dependência exige).
- O ruling de "igualar o tempo de login" gerou uma falha crítica (senha "x" entrava em conta sem senha); foi corrigida. Em autenticação, sempre testar também o caminho "senha fixa/conhecida".
- Revisores acharam bugs reais em todas as rodadas; **não pule a revisão por tarefa nem a re-revisão escopada**.
- Ao mexer em chaves de segurança do levantamento (`levantar.sh`), manter o `begin read only` e o teste `docs/migracao-go/levantamento.test.mjs`.

## 9. Primeiro passo sugerido
1. Entre em `.claude/worktrees/api-go-pg`, rode `git status` e `git diff`, decida sobre as edições parciais e **retome a rodada de correção das Tasks 1+2** (item 6.A.1).
2. Releia o ledger e siga as Tasks 3–7 pelo SDD.
3. Reporte ao dono, em português, o que mudou e o que depende dele, sem repetir o que já está neste prompt.
