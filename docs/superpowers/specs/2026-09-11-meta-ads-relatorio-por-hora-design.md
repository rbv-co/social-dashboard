# Meta Ads — Relatório por Hora

**Data:** 11/09/2026
**Estado:** desenho aprovado pelo dono, aguardando plano de execução.

---

## 1. O que foi pedido

> "relatorio de hora em hora segregado por campanha por quantidade de
> conversas iniciadas, valor que foi investido nessas 1 hora (teria que
> calcular o delta), custo por lead. [...] módulo em meta ads com o nome
> relatório por hora. [...] visualização de todos os relatorios por dia, cada
> dia agrupado, eu expando e vejo os números de cada hora. visão simples."

Perguntado e confirmado durante o desenho:

- **Custo por lead** = mesma conta de "conversas iniciadas" (cada conversa do
  WhatsApp conta como 1 lead) — não é uma métrica de formulário/compra à parte.
- **Escopo**: todas as campanhas de Meta Ads, não só as de mensagem. Campanha
  sem conversa naquela hora simplesmente fica sem custo (nunca "R$ 0,00").
- **Delta**: robô novo rodando de hora em hora, lendo o acumulado do dia e
  calculando a diferença contra a última leitura — não existe hoje um jeito
  confiável da Meta entregar isso pronto.
- **Sem histórico**: começa a contar a partir de agora. Dias anteriores a esta
  entrega não têm relatório por hora, porque o dado nunca foi coletado.

---

## 2. Por que isto não existe hoje (levantado antes do desenho)

Não há, em lugar nenhum do projeto, granularidade por hora — nem tabela, nem
robô, nem chamada à Meta com esse recorte. O que já existe:

- `campaign_insights`: gasto **diário** por campanha, coletado 1x/dia por
  `supabase/functions/coletar-dados/index.ts` (`coletarAdsPorCampanha`/
  `coletarAdsDia`). Sem coluna de leads/conversas.
- "Conversas iniciadas" já é um conceito **implementado, mas só ao vivo, no
  navegador**: `src/ferramentas/gestao-trafego/funil.js` e
  `tela-de-gestao-trafego.vue` (constante
  `['onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.messaging_conversation_started']`) buscam isso direto na
  Graph API a cada vez que a tela abre, e nunca gravam em banco.

Este módulo cria a primeira coleta persistente e granular por hora do projeto.

---

## 3. Tabela nova: `campaign_insights_hora`

Nome espelha `campaign_insights` de propósito — é a mesma entidade
(campanha × dia), só que com uma dimensão a mais (hora) e dois campos a mais
(conversas).

```sql
create table public.campaign_insights_hora (
  campaign_id          text        not null,
  account_id           uuid        not null,
  dia                  date        not null,
  hora                 smallint    not null check (hora between 0 and 23),
  gasto_acumulado      numeric(12,2) not null default 0,
  conversas_acumuladas integer     not null default 0,
  gasto_hora           numeric(12,2) not null default 0,
  conversas_hora       integer     not null default 0,
  coletado_em          timestamptz not null default now(),
  unique (campaign_id, account_id, dia, hora)
);

alter table public.campaign_insights_hora enable row level security;

create policy so_contas_permitidas on public.campaign_insights_hora
  as restrictive for select to authenticated
  using (public.pode_ver_conta(account_id::text));
```

> **ERRATO (revisão final, 11/09/2026):** este desenho só tem a policy
> RESTRICTIVE acima — sem NENHUMA policy PERMISSIVE, o Postgres nega toda
> leitura (RESTRICTIVE só reduz o que uma permissiva já libera). A tabela
> nasceu lendo 200 + `[]` sempre. Corrigido em
> `db/migrations/2026-09-11-meta-ads-hora-permissiva.sql` (policy
> `campaign_insights_hora_leitura`, permissiva, por `p.permissions ? 'meta.hora'`).

- `gasto_acumulado`/`conversas_acumuladas`: o número **cru** que a Meta
  devolveu para "o dia até agora" — fica gravado para auditoria (se o delta
  algum dia parecer errado, dá para conferir contra a fonte).
- `gasto_hora`/`conversas_hora`: o delta já calculado pelo robô (ver §4). A
  tela lê **estas** colunas, nunca recalcula.
- Sem chave estrangeira para `campaigns`/`accounts` — mesmo desenho solto que
  `campaign_insights` já usa (a sincronia é por convenção, não por FK).
- Entra na mesma trava `pode_ver_conta(account_id)` que já protege as outras
  19 tabelas com `account_id` (`db/migrations/2026-07-31-allowed-accounts-no-banco.sql`).
  A migration desta tabela **acrescenta `campaign_insights_hora` a essa lista**
  em vez de duplicar a política à mão.

---

## 4. O robô: `coletar-dados-hora`

Edge Function nova, **não** um acréscimo ao `coletar-dados` existente.

**Por que separada:** `coletar-dados` roda 4x/dia e faz dezenas de chamadas
por conta (seguidores, stories, mídia, engajamento × 5 períodos...) — já
precisou ser dividido em "uma conta por vez" para não estourar o teto de 150s
da plataforma. Este robô faz **1 chamada à Graph API por conta**, então roda
inteiro, todas as contas, numa única invocação — não precisa da fila.

```
act_<ad_account_id>/insights
  level: campaign
  fields: campaign_id,spend,actions
  time_range: { since: hoje, until: hoje }
```

Isso devolve o acumulado do dia (spend + actions) até o momento da chamada,
por campanha. Passos por conta:

1. Buscar o insight acima (só contas com `ad_account_id` preenchido).
2. Extrair `conversas_acumuladas` do array `actions` usando a mesma constante
   já usada em `gestao-trafego/funil.js`
   (`messaging_conversation_started_7d` / `messaging_conversation_started`) —
   duplicada aqui como `.js` puro em `_shared/`, no mesmo espírito de
   `_shared/leitura-de-engajamento.js`.
3. Para cada campanha, buscar a **última linha já gravada hoje** para aquela
   `campaign_id`+`account_id` (`order by hora desc limit 1`, não
   necessariamente `hora - 1` — uma rodada perdida não pode fazer o delta
   seguinte ficar negativo ou duplicado).

   > **ERRATO (revisão final, 11/09/2026):** faltava excluir a própria hora
   > da busca. Sem `hora < hora atual`, uma SEGUNDA rodada na mesma hora
   > encontra a própria escrita anterior como "linha anterior" e o delta se
   > autocorrompe. Corrigido em `supabase/functions/coletar-dados-hora/index.ts`
   > (`.lt('hora', hora)`).
4. `gasto_hora = gasto_acumulado - (linha anterior?.gasto_acumulado ?? 0)`,
   mesma conta para `conversas_hora`. Primeira leitura do dia = o próprio
   acumulado.
5. `upsert` em `campaign_insights_hora` com `onConflict:
   'campaign_id,account_id,dia,hora'` — protege contra o cron disparar duas
   vezes na mesma hora.

`dia`/`hora` calculados em `America/Sao_Paulo` (mesmo padrão `todayBR()` já
usado no coletor), não em UTC — é hora de parede que a pessoa vai ler na tela.

**A hora gravada é a hora da rodada, não um recorte exato 14:00–15:00.** O
cron dispara no minuto 5 (14:05, 15:05...), e o delta é "quanto mudou desde a
última rodada" — na prática, os ~60 minutos entre uma chamada e a outra. A
linha fica rotulada com a hora da rodada (`hora = 14` na chamada das 14:05),
mas representa aproximadamente 13:05→14:05, não 14:00→15:00 cravado. É a
mesma imprecisão que qualquer coleta por polling tem, e foi o desenho que o
dono aprovou (delta entre leituras) — só registrando aqui para não virar
suposição errada de quem ler a tela achando que é corte exato de relógio.

**Autenticação**: igual ao `coletar-dados` — `exigirSegredoDeCron(req,
'coletar-dados-hora')`, segredo próprio em `segredos_de_cron`, nunca a anon
key.

**Agendamento**: `pg_cron`, de hora em hora, via `disparar_robo` (mesmo
mecanismo do resto do projeto):

```sql
select cron.schedule(
  'coletar-dados-hora',
  '5 * * * *',
  $$ select public.disparar_robo(
       'coletar-dados-hora', 'coletar-dados-hora', 'coletar-dados-hora',
       '{}'::jsonb, 60000
     ) $$
);
```

(minuto 5, não em cima da hora — dá folga para a Meta consolidar o minuto
anterior antes de perguntar "quanto gastou hoje até agora".)

> **ERRATO (revisão final, 11/09/2026):** o primeiro argumento de
> `disparar_robo` (`p_robo`) acima é `'coletar-dados-hora'`, que começa com
> `coletar-dados` — e `robos_saude` junta por PREFIXO
> (`u.robo like x.robo || '%'`). Isso esconde este robô atrás do sucesso do
> `coletar-dados` crítico (o que renova o token da Meta) e nunca aparece
> sozinho em `robos_esperados`. Corrigido em
> `db/migrations/2026-09-11-meta-ads-hora-cron.sql`: o rótulo de robô passou a
> ser `'meta-hora'` (a Edge Function e o segredo continuam
> `coletar-dados-hora`, só o 1º argumento muda), com registro próprio em
> `robos_esperados`.

---

## 5. Cálculo exibido na tela

- **Conversas iniciadas** = `conversas_hora`, direto da coluna.
- **Valor investido na hora** = `gasto_hora`, direto da coluna.
- **Custo por lead** = `gasto_hora / conversas_hora` quando `conversas_hora >
  0`; caso contrário, célula mostra **"—"**, nunca "R$ 0,00" (regra do
  padrão: "a tela nunca mente" — custear em cima de zero lead seria inventar
  um número).

Toda essa lógica (agrupar por dia, por hora, calcular custo por lead) vira um
`.js` puro com `.test.mjs` ao lado — ex.:
`src/ferramentas/meta-ads/relatorio-por-hora.js` — que recebe as linhas cruas
da tabela e devolve a estrutura já pronta para o acordeão (dia → hora →
campanhas).

---

## 6. Tela nova

- **Card novo** "Relatório por Hora" em `tela-de-menu-meta-ads.vue`, ao lado
  dos já existentes (Gestão de Tráfego, Estúdio de Criativos), atrás de
  `hasPermission('meta.hora')`.
- **Rota nova** (ex.: `/meta-relatorio-hora`), arquivo
  `src/ferramentas/meta-ads/tela-de-relatorio-por-hora.vue`.
- **Não reaproveita `aba-de-relatorios.vue`** — aquela casca é para tabela
  plana com recorte marca/local e exportação Excel/PDF; aqui o formato é
  outro (série temporal, acordeão, sem export pedido). Forçar o mesmo
  mecanismo geraria uma tela mais confusa do que uma tela nova e simples.
- Estrutura, "visão simples" como pedido:

```
▾ 11/09/2026                                    R$ 842,10 · 37 conversas
    08h            R$ 62,00 · 4 conversas
      Campanha A     R$ 40,00 · 3 conversas · R$ 13,33/lead
      Campanha B     R$ 22,00 · 1 conversa  · R$ 22,00/lead
      Campanha C     R$ 0,00  · 0 conversas · —
    09h            R$ 71,50 · 2 conversas
      ...
▸ 10/09/2026                                    R$ 1.204,40 · 51 conversas
▸ 09/09/2026                                    R$ 998,00 · 44 conversas
```

- Dias em ordem decrescente (mais recente primeiro), **fechados por padrão**
  — só o dia de hoje abre expandido. Dentro do dia, horas em ordem
  crescente, só as que já têm leitura.
- Subtotal por dia e por hora (some as campanhas), calculado no mesmo `.js`
  puro do §5.

---

## 7. Permissão

Segue o padrão já estabelecido (mesmo commit que adicionou `meta.fabrica`),
tudo em `src/compartilhado/controle-de-login-e-usuario.js`:

1. `RECURSOS`: `{ key: 'meta.hora', label: 'Relatório por Hora', acoes: ['ver'] }`
   — tela inteira, sem sub-ação (mesmo padrão de `claude.status`/`noticias`).
2. `hasPermission`: incluir `'meta.hora'` no array
   `['meta.campanha', 'meta.gestor', 'meta.fabrica']` do `if (key === 'meta')`
   — senão quem só tem esta permissão não passa no guarda de
   `hasPermission('tool:meta')` do hub.
3. `PERMISSION_TREE`: novo nó filho sob `meta`.
4. Card novo chama `hasPermission('meta.hora')` **direto**, sem passar pela
   ponte `_legado` — os cards mais novos (`meta.fabrica`) já convivem com
   chamada antiga (`module:meta:fabrica`) por causa da migração gradual, mas
   não há motivo para este código, que nasce agora, perpetuar o prefixo
   `module:meta:` legado.
5. Réplica em `src/ferramentas/admin/niveis-de-permissao.test.mjs` (o teste
   que garante que a cópia bate com o catálogo real).

**Nasce desmarcada para todo mundo** — regra já estabelecida do projeto.
Quem libera é o Config de Admin, na mão.

---

## 8. O que NÃO entra (YAGNI)

- **Excel/PDF.** Não foi pedido ("visão simples"); se fizer falta depois, o
  `.js` puro do §5 já devolve os dados prontos para alimentar um exportador,
  sem precisar refazer o cálculo.
- **Backfill de dias anteriores.** Já decidido em conversa: o dado não
  existia antes de hoje.
- **Filtro por conta/campanha.** V1 mostra tudo que o robô coletou. Se a
  lista ficar grande demais com o tempo, é um recorte a acrescentar depois —
  não inventar antes de doer.
- **Breakdown nativo da Meta
  (`hourly_stats_aggregated_by_advertiser_time_zone`).** Descartado no
  desenho: é conhecido por atrasar/reprocessar horas passadas, e o desenho
  por delta já resolve o pedido do dono com uma chamada mais simples e
  previsível.

---

## 9. Riscos conhecidos

- **Rodada de cron perdida.** O delta usa "última linha gravada hoje", não
  "hora - 1" — uma falha de uma hora não quebra a hora seguinte, só produz
  uma hora sem linha (a tela mostra menos horas naquele dia, nunca um número
  errado).
- **Cota da Graph API.** Mais um robô rodando de hora em hora soma chamadas
  às já existentes. Como é 1 chamada por conta (hoje ~7 contas), o volume
  extra é pequeno perto do `coletar-dados` — mas vale registrar em
  `robos_execucoes`/`robos_saude` como os outros, para aparecer se degradar.
- **Fuso horário.** `dia`/`hora` gravados em `America/Sao_Paulo`. Se o
  servidor do cron mudar de fuso, a hora gravada muda de significado — mesmo
  risco que já existe em `todayBR()` hoje, nada novo introduzido.

---

## 10. Como se prova que ficou de pé

- `.test.mjs` para o cálculo de delta (`_shared/`) e para o agrupamento
  dia/hora/custo-por-lead (`relatorio-por-hora.js`).
- `imports.test.mjs` na pasta `meta-ads/` (se ainda não houver).
- Rodar o robô manualmente (chamada direta à Edge Function com o segredo) e
  conferir 2-3 linhas em `campaign_insights_hora` contra o gerenciador de
  anúncios da Meta.
- Deixar o cron rodar por umas horas reais antes de considerar pronto — só
  assim o acordeão tem mais de uma hora para mostrar.
- Abrir a tela nova **a 375px e a 1440px**, tema claro e escuro, conferindo
  os 4 critérios do padrão obrigatório (`PADRAO-DA-CENTRAL.md` item 6).
