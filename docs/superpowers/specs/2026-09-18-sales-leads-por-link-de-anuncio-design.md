# Sales / Leads por link de anúncio

**Data:** 18/09/2026
**Estado:** desenho aprovado em chat pelo dono ("sim, pode fazer") — spec
escrita agora, plano de implementação ainda não.

---

## 1. O que foi pedido

O dono pediu pra listar as campanhas AXIOM (nome sem prefixo `[...]`, ficam
hoje no balde "outro" de `tipoDaCampanha` e por isso **fora** de qualquer
seção do Relatório por Hora e do OPR). Ao detalhar conjunto/anúncio/link de
cada uma via Graph API, achamos que os anúncios de uma MESMA campanha —
às vezes do MESMO conjunto — apontam pra destinos diferentes:

- `vesselbrasil.com.br`, `loja.vesselbrasil.com.br`, `www.lavessel.com.br` →
  o dono classificou como **SALES**.
- `.../universovessel#narrativa` → o dono classificou como **LEADS**.

Confirmado em chat (18/09/2026):

- A classificação é **só pelo link do anúncio** — não depende do Chatwoot
  nem de nenhum funil de qualificação. Investigação anterior (12/09/2026)
  já tinha confirmado que a Meta não atribui conversa/seguidor por
  campanha pra esse tipo de anúncio; aqui o sinal é outro: o **destino do
  clique**, que a Meta dá por ANÚNCIO via `creative`.
- Essa "LEADS" nova é **separada** da Leads que já existe (campanhas
  `[CAMPANHA WPP]`, mensagem no WhatsApp) — "campanhas wpp desconsidera,
  pode tirar da regra". Não mexe em `tipoDaCampanha`, não mexe em
  `montarMensagemWpp`, não soma com `sales.leads` do OPR (que é a contagem
  de conversas WPP).
- A métrica de resultado, pros dois lados (Sales e Leads-por-link), é
  **cliques no link** (`link_click`) — mesmo padrão já usado nas campanhas
  `[+ SEGUIDORES]` antes da correção de 12/09/2026 (aqui não tem o mesmo
  problema: estes anúncios TÊM link de destino de verdade, diferente de
  `[+ SEGUIDORES]`, que não tem).
- Precisa aparecer **nos dois**: Relatório por Hora (hora em hora, como
  Campanhas/Seguidores já aparecem) e no OPR (fechamento diário). Isso
  descarta calcular só na hora de gerar o OPR — precisa de uma tabela nova,
  igual ao resto do projeto (grava o bruto de hora em hora, a tela nunca
  recalcula o delta).

**Achado à parte, registrado aqui pra não se perder**: o anúncio
`AXIOM_1_5_VESSEL_SP_NUCLEO-INTERESSE_CRIATIVO-B-CARROSSEL-COLECAO`, dentro
do conjunto NUCLEO-INTERESSE da campanha
`AXIOM_VESSEL_SP_TRAF-LPV_ALTOPADRAO_2026-09`, aponta pra
`www.lavessel.com.br` (loja errada — os mesmos anúncios, mesmo nome, nos
outros 2 conjuntos da campanha apontam certo pra `vesselbrasil.com.br`).
Continua contando como SALES pela regra acima (é domínio da lista), mas é
provavelmente um erro de configuração no Ads Manager que vale o dono
corrigir por lá — não é este projeto que conserta o link, só reporta.

---

## 2. Por que isto não existe hoje

- `tipoDaCampanha` (`src/ferramentas/meta-ads/relatorio-por-hora.js`)
  classifica só por **prefixo do nome da campanha** — `wpp`/`seguidores`/
  `engajamento`/`outro`. As campanhas AXIOM não têm prefixo nenhum, caem em
  `outro`, e `outro` não entra em NENHUMA seção do Relatório por Hora nem
  do OPR (spec de 17/09/2026, §1: "a conta de anúncios tem campanhas de
  outros assuntos... que não entram em nenhuma seção").
- O projeto nunca coletou dado no nível de **anúncio** — só campanha
  (`campaign_insights_hora`, `campaign_insights`). Não existe conceito de
  "anúncio" nem de "link de destino" em nenhuma tabela hoje.
- Classificar por campanha (como `tipoDaCampanha` faz) não resolve aqui: o
  próprio dono notou que "vamos ter que ir segmentando pelo anúncio mesmo"
  — confirmado com dado real, a MESMA campanha/conjunto tem anúncio Sales e
  anúncio Leads misturados.

---

## 3. Classificação: `classificarLinkAnuncio(url)`

Nova função pura em `src/ferramentas/meta-ads/relatorio-por-hora.js` (mesmo
arquivo de `tipoDaCampanha` — mesma responsabilidade: classificar algo do
Meta Ads por um sinal textual).

```js
export function classificarLinkAnuncio(url) {
  if (!url) return null;
  let host;
  try {
    host = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
  if (host === 'vesselbrasil.com.br' || host === 'loja.vesselbrasil.com.br' || host === 'lavessel.com.br') {
    return 'sales';
  }
  if (url.includes('universovessel') && url.includes('narrativa')) return 'leads';
  return null;
}
```

- `null` = sem link (ex.: anúncio de clique-para-WhatsApp, confirmado que
  existe — `CRIATIVO-A-VIDEO-PRODUTO` na campanha TRAF-LPV) OU link que não
  bate com nenhuma regra conhecida. Nunca inventa categoria — mesma regra
  "a tela nunca mente" do resto do projeto.
- URL malformada (`new URL()` lança) também cai em `null`, não quebra a
  tela.
- Domínio comparado sem `www.` (case: `www.lavessel.com.br` viria com
  `www.`; `vesselbrasil.com.br`/`loja.vesselbrasil.com.br` não têm no dado
  real observado, mas a normalização cobre os dois casos).
- **Testes obrigatórios**: os 4 domínios de Sales (incluindo com/sem
  `www.`), o link de Leads (com e sem UTM na frente/atrás), link de
  domínio desconhecido → `null`, `url` vazia/`null`/`undefined` → `null`,
  URL malformada (`"não é url"`) → `null`.

---

## 4. Escopo: quais campanhas entram

**Toda campanha com `tipoDaCampanha(nome) === 'outro'`** — não só as 3
AXIOM de hoje. Motivo: os nomes AXIOM carregam o mês no sufixo
(`_2026-09`) e mudam todo mês; amarrar por ID ou por trecho do nome quebra
sozinho em outubro. Campanha "outro" nova (`[LOJA]`, `[FLUXO SHOPPING]`,
etc.) passa a ser candidata automaticamente, sem precisar de código novo —
só depende de ter um anúncio com link classificável.

Dentro da campanha, todo ANÚNCIO é candidato (ativo ou pausado — mesma
filosofia de `campaign_insights_hora`, que também grava campanha pausada:
gasto/clique de hoje é zero de qualquer forma pra anúncio pausado, gravar
não custa nada e mantém histórico). Filtra por status só a campanha em si:
campanhas `ARCHIVED`/`DELETED` não entram no catálogo (nunca mais vão ter
gasto novo).

---

## 5. Catálogo de anúncios: tabela `ads`

Mesmo papel de `campaigns` pra campanha: nome/link não muda de hora em
hora, então não faz sentido perguntar pra Meta 24x/dia. Sincronizado pelo
`coletar-dados` (Edge Function que já roda menos vezes ao dia e já
sincroniza `campaigns` via `sincronizarCampanhas`), não pelo
`coletar-dados-hora`.

```sql
-- db/migrations/2026-09-18-meta-ads-catalogo-anuncios.sql
create table public.ads (
  ad_id        text primary key,
  campaign_id  text not null,
  account_id   uuid not null,
  name         text not null default '',
  status       text not null default '',
  destino_link text,
  synced_at    date not null default current_date
);

comment on table public.ads is
  'Catálogo de anúncios (nome, status, link de destino do criativo) — '
  'sincronizado pelo coletar-dados, junto com campaigns. Gasto/clique por '
  'hora fica em ad_insights_hora, à parte. Categoria (sales/leads) NÃO é '
  'coluna aqui — sempre recalculada por classificarLinkAnuncio(destino_link) '
  'em JS, nunca guardada, pra não desatualizar se a regra mudar.';
```

(Self-review: a primeira versão desta tabela tinha uma coluna `categoria`
gerada em SQL que ficava sempre `null` — SQL não replica
`classificarLinkAnuncio()`. Removida; `destino_link` sozinho basta.)

RLS: mesma regra de `campaigns` — confirmar se `campaigns` tem RLS hoje
(checar na hora do plano; se `campaigns` for lido sem RLS por já estar
sempre filtrada por `account_id` a partir de uma consulta em tabela com
RLS, `ads` segue o mesmo padrão exato, sem inventar política nova).

### 5.1. Extrair o link do criativo

Mesma lógica já usada (e validada com dado real em 18/09/2026) na
investigação manual — vira função permanente, em
`supabase/functions/_shared/delta-de-hora.js` (ESM puro, importável tanto
pelo `coletar-dados` quanto testável direto):

```js
export function linkDoCriativo(creative) {
  if (!creative) return null;
  const osp = creative.object_story_spec;
  if (osp?.link_data?.link) return osp.link_data.link;
  if (osp?.video_data?.call_to_action?.value?.link) return osp.video_data.call_to_action.value.link;
  const afs = creative.asset_feed_spec;
  if (afs?.link_urls?.length) return afs.link_urls.map((l) => l.website_url).join(' | ');
  if (creative.object_url) return creative.object_url;
  return null;
}
```

`sincronizarAnuncios(sb, accountId, adAccountId, token)` em
`supabase/functions/coletar-dados/index.ts` (ao lado de
`sincronizarCampanhas`, mesmo padrão):

```js
async function sincronizarAnuncios(sb, accountId, adAccountId, token) {
  try {
    const items = await apiGetAll(`act_${adAccountId}/ads`, {
      fields: 'id,name,campaign_id,status,creative{object_story_spec,asset_feed_spec,object_url}',
      access_token: token,
    });
    const rows = items.map((a) => ({
      ad_id: a.id, campaign_id: a.campaign_id, account_id: accountId,
      name: a.name ?? '', status: a.status ?? '',
      destino_link: linkDoCriativo(a.creative), synced_at: todayBR(),
    }));
    if (rows.length) await sb.from('ads').upsert(rows, { onConflict: 'ad_id' });
  } catch { /* sem ads */ }
}
```

Chamada junto de `sincronizarCampanhas` no loop de contas do
`coletar-dados`. **Uma chamada por conta, busca TODOS os anúncios** — não
filtra por campanha "outro" aqui (mais simples buscar tudo; filtrar por
`tipoDaCampanha` fica na hora de LER, não na hora de sincronizar — assim
uma campanha que muda de "outro" pra `[+ ENGAJAMENTO]` não deixa lixo
travado, o catálogo sempre reflete a Meta).

---

## 6. Gasto/clique por hora: tabela `ad_insights_hora`

Mesmo padrão de `campaign_insights_hora`/`perfil_visitas_hora` — grava o
acumulado do dia, o robô já calcula o delta, a tela nunca recalcula.

```sql
-- db/migrations/2026-09-18-meta-ads-ad-insights-hora.sql
create table public.ad_insights_hora (
  ad_id              text        not null,
  campaign_id        text        not null,
  account_id         uuid        not null,
  dia                date        not null,
  hora               smallint    not null check (hora between 0 and 23),
  gasto_acumulado    numeric     not null default 0,
  gasto_hora         numeric     not null default 0,
  cliques_acumulados integer     not null default 0,
  cliques_hora       integer     not null default 0,
  coletado_em        timestamptz not null default now(),
  unique (ad_id, account_id, dia, hora)
);

comment on table public.ad_insights_hora is
  'Gasto e cliques no link (link_click) por ANÚNCIO, por hora, com delta '
  'já calculado. Só cobre anúncios de campanhas "outro" (tipoDaCampanha) '
  '— ver classificarLinkAnuncio() pra Sales/Leads. Alimentada pela Edge '
  'Function coletar-dados-hora.';

alter table public.ad_insights_hora enable row level security;

-- As DUAS políticas na MESMA migration — campaign_insights_hora e
-- perfil_visitas_hora precisaram de uma segunda migration corretiva cada
-- (2026-09-11 e 2026-09-12) porque a RESTRICTIVE sozinha nega tudo sem
-- NENHUMA permissiva. Não repetir o erro: as duas nascem juntas aqui.
create policy so_contas_permitidas on public.ad_insights_hora
  as restrictive for select to authenticated
  using (public.pode_ver_conta(account_id::text));

create policy ad_insights_hora_leitura on public.ad_insights_hora
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and (p.role = 'admin' or p.is_superadmin or p.permissions ? 'meta.hora')
    )
  );

revoke all on table public.ad_insights_hora from public, anon, authenticated;
grant  select on table public.ad_insights_hora to authenticated;
```

### 6.1. Coleta: `coletarAnunciosOutroPorHora` em `coletar-dados-hora`

Nova função, ao lado de `coletarConta`, chamada do mesmo loop de contas:

1. Busca no catálogo `ads` (já sincronizado por `coletar-dados`) os
   `ad_id` cujas campanhas (`campaigns`, join por `campaign_id`) têm
   `tipoDaCampanha(nome) === 'outro'` E `destino_link is not null` (sem
   link classificável, nem vale gastar linha — fica de fora da tabela
   inteira, não só das seções da tela). Guarda um `Set<ad_id>`.
2. **Uma chamada de insights pra conta inteira, nível anúncio** (mesmo
   padrão de `coletarConta`, que já faz `level: 'campaign'` numa chamada
   só — aqui `level: 'ad'`):
   ```
   GET act_{adAccountId}/insights
     ?fields=ad_id,campaign_id,spend,actions
     &time_range={since:dia,until:dia}
     &level=ad
   ```
3. Filtra a resposta pelos `ad_id` do passo 1 — ads fora do escopo (wpp,
   seguidores, engajamento) vêm juntos na resposta da Meta mas são
   ignorados aqui (já tratados pelas outras seções).
4. Calcula `gasto_hora`/`cliques_hora` contra a última linha já gravada
   hoje ANTES desta hora (`ad_insights_hora`, mesmo filtro/ordenação de
   `coletarConta` — `lt('hora', hora)`, `order hora desc`, primeira
   ocorrência por `ad_id` vence).
5. `cliques_hora` vem de `linkClicks(actions)` — nova função em
   `_shared/delta-de-hora.js`, extrai `link_click` do array `actions`
   (mesmo formato de `conversasIniciadas`/`visitasNoPerfil`, action_type
   diferente).
6. Upsert em `ad_insights_hora`, `onConflict: 'ad_id,account_id,dia,hora'`.

Erro nesta função entra em `degraded[]`, não derruba o resto da rodada
(mesmo padrão de `coletarConta`/`coletarVisitasPerfilDaConta`).

---

## 7. Lógica pura de leitura: novas funções em `relatorio-por-hora.js`

```js
// Recorta linhas de ad_insights_hora (já com nome/link do anúncio anexado
// pela tela, igual agruparPorDiaEHora faz com campanhas) pela categoria.
export function anunciosPorCategoria(anuncios, categoria) {
  return anuncios.filter((a) => classificarLinkAnuncio(a.destinoLink) === categoria);
}
```

A tela monta a lista de "anúncios" juntando `ad_insights_hora` (gasto/
clique da hora) com `ads` (nome/link, buscado uma vez, igual `campaigns`
já é buscado) — mesma forma que `agruparPorDiaEHora` junta
`campaign_insights_hora` com `campaigns` hoje. Cada linha final:
`{ adId, campaignId, nome, destinoLink, gastoHora, cliquesHora,
custoPorClique }`. `custoPorClique` = `custoPorLead(gastoHora,
cliquesHora)` (função já existe, mesma regra: `null` sem clique, nunca
inventa "R$ 0,00").

Agrupamento por dia/hora: **reaproveitar `agruparPorDiaEHora`** é tentador
mas ele foi desenhado pra campanha (`campaign_id`, um nível). Anúncio
precisa de `ad_id` como chave. Decisão: criar
`agruparAnunciosPorDiaEHora(linhas, nomesPorAnuncio, linksPorAnuncio)`,
mesmo shape de saída (`[{dia, horas: [{hora, anuncios: [...]}]}]`), função
IRMÃ, não uma extensão da existente — evita `if (ehAnuncio)` espalhado
dentro de uma função que já está grande.

---

## 8. Tela: Relatório por Hora

Duas seções novas, mesmo padrão visual de Campanhas/Seguidores (acordeão,
toggle "só com resultado/todas", tabela Anúncio/Investido/Cliques/Custo-
clique):

- **Sales** — `anunciosPorCategoria(anuncios, 'sales')`
- **Leads (Link)** — `anunciosPorCategoria(anuncios, 'leads')` — nome
  "Leads (Link)" pra não confundir com a seção de Mensagens do grupo (WPP),
  que já usa a palavra "Leads" sozinha. Nome definitivo a confirmar com o
  dono na revisão da spec.

Ambas as seções só aparecem quando `anuncios.length > 0` nessa hora (mesma
regra de "Seguidores" hoje, que só aparece se `deSeguidores(...).length`).

Sem mensagem de WhatsApp nova nesta entrega — o dono não pediu; se pedir
depois, é `montarMensagemSalesLeadsLink(...)`, mesmo espírito das
existentes, tarefa separada.

---

## 9. OPR: onde entra

`relatorio-diario-opr.js` já tem um objeto `sales` — mas `sales.leads` é a
contagem de conversas WPP, e `sales.vendas`/`sales.leadsQuentes` estão
reservados em comentário pro Chatwoot ("vêm do Chatwoot, integração
futura"). **Não sobrescrever esses campos** —ação errada aqui quebraria a
promessa já documentada no código pro dono.

Dois objetos NOVOS no retorno de `calcularDadosOpr`/`montarDadosOpr`:

```js
salesLink: {
  investimento, cliques,
  custoPorClique, // null se cliques <= 0 ou investimento <= 0
},
leadsLink: {
  investimento, cliques,
  custoPorClique,
},
```

Alimentados por `agruparCampanhasDoDia`-equivalente pro nível de anúncio
(soma do DIA inteiro, não por hora — mesmo padrão de `campaign_insights`
vs `campaign_insights_hora`: existe `ad_insights` diário, ou soma-se
`ad_insights_hora` do dia inteiro como fallback, igual
`visitasPerfilNoPeriodoComCache` já faz pra visitas de perfil? **Decisão a
confirmar no plano**: como não há ainda um `ad_insights` diário oficial da
Meta sendo coletado (diferente de `campaign_insights`, que o
`coletar-dados` já busca com `period_days=1`), a rota mais simples é somar
`ad_insights_hora` do dia — mesmo caminho que `campaign_insights_hora`
tinha antes de existir a fonte diária oficial. Aceita a mesma margem de
erro (~6%) já documentada na spec de 17/09/2026 pro gasto por campanha.

`CAMPOS_CONFIRMADOS` (rollout gate) ganha `salesLink.investimento`,
`salesLink.cliques`, `salesLink.custoPorClique`, `leadsLink.*` — **NÃO
entram na lista até bater contra dado real**, mesma disciplina do resto do
arquivo (fica `null`/"—" até confirmar).

Template (`coletor/lib/template-opr.mjs`) e imagem: seção nova a
desenhar — fora do escopo desta spec (o layout do OPR é assunto visual,
decidido quando chegar a vez de implementar essa parte; a spec de
17/09/2026 tratou o layout à parte do cálculo, mesma divisão aqui).

---

## 10. Testes

- `classificarLinkAnuncio`: casos do §3.
- `linkDoCriativo` (`_shared/delta-de-hora.test.mjs`): os 4 formatos reais
  já vistos (`link_data.link`, `video_data` com CTA, `asset_feed_spec`,
  `object_url`), creative `null`/`undefined`, nenhum campo bate → `null`.
- `linkClicks(actions)` (`_shared/delta-de-hora.test.mjs`): mesmo padrão
  de `conversasIniciadas`/`visitasNoPerfil` — array com `link_click`, sem
  a action, `actions` vazio/undefined.
- `agruparAnunciosPorDiaEHora`: ordenação, granularidade por `ad_id`
  (dois anúncios da mesma campanha não se misturam), zero anúncios não
  quebra.
- `anunciosPorCategoria`: recorta certo por `sales`/`leads`, anúncio sem
  link classificável (`null`) não entra em nenhuma das duas.
- `calcularDadosOpr`: `salesLink`/`leadsLink` somam certo, `custoPorClique`
  null sem investimento/clique, campanha sem nenhum anúncio "outro" não
  quebra (objetos zerados, não `undefined`).

---

## 11. Fora de escopo nesta entrega

- Corrigir o link errado do anúncio pra `lavessel.com.br` no Ads Manager —
  é ação manual do dono, fora do código.
- `ad_insights` diário oficial da Meta (paralelo a `campaign_insights`) —
  só se o cálculo por soma-de-hora (§9) se mostrar impreciso demais na
  prática, mesmo processo que levou `visitas_perfil_dia` a existir.
- Mensagem de WhatsApp pra Sales/Leads-por-link.
- Media Mix reconhecer Sales/Leads-por-link como categoria própria (hoje é
  só growth/engagement/leads-wpp) — o dono não pediu isso ainda.
- Layout da imagem OPR pra essa seção nova.
