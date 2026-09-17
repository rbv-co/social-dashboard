# Relatório OPR diário (Paid Media Performance)

**Data:** 17/09/2026
**Estado:** implementado e em produção — dono validou o preview (local e via `workflow_dispatch`) e aprovou ligar o envio real em 17/09/2026. Cron diário ativo (`schedule` em `.github/workflows/opr-diario.yml`, 08h BRT).

---

## 1. O que foi pedido

O dono mostrou um infográfico "PAID MEDIA PERFORMANCE" (gerado hoje via
ChatGPT, imagem só, não é template de sistema nenhum) e pediu pra gerar isso
todo dia, automaticamente, consolidando os dados do dia anterior — "hoje por
exemplo você mandaria o relatório consolidando os dados de ontem".

Confirmado durante o desenho:

- **Formato**: imagem (não texto), igual ao mockup — "depois transformamos
  isso em um painel" (o HTML usado pra gerar a imagem deve servir de base pra
  uma tela futura, não é descartável).
- **Escopo desta entrega**: só as seções com dado confiável hoje — Growth
  (Seguidores), Engagement, e Leads (contagem, sem qualificação). **Leads
  Quentes**, **Vendas** e **Media Mix** ficam de fora por agora:
  - Leads Quentes/Vendas: virão do Chatwoot (integração futura, fora de
    escopo aqui).
  - Media Mix: dono precisa confirmar definição com o gerente de marketing
    antes de expor o número.
- **Investimento Total** (card do header) soma só as 3 categorias rastreadas
  (WPP + Seguidores + Engajamento) — a conta de anúncios tem campanhas de
  outros assuntos (vaga de emprego, DRE, atacado) que não entram em nenhuma
  seção do relatório e não devem inflar esse número.
- **Horário de envio**: 08h BRT (depois do coletor das 07h re-sincronizar o
  gasto/engajamento de ontem — a Meta ainda ajusta esses números por algumas
  horas após a virada do dia).
- **Grupo**: mesmo grupo de WhatsApp de teste que já recebe os relatórios por
  hora (Leads/Seguidores) — mesma constante `GRUPO_WHATSAPP`.
- **NÃO enviar nada de verdade ainda** — o dono pediu explicitamente pra só
  montar, sem mandar pro grupo, até aprovar o resultado.

---

## 2. Por que isto não existe hoje

O que já existe hoje (Relatório por Hora, `supabase/functions/enviar-relatorio-hora`)
manda **texto** de hora em hora, e só sabe separar campanhas em 2 baldes:
`[CAMPANHA WPP]` e `[+ SEGUIDORES]` (função `tipoDaCampanha` em
`src/ferramentas/meta-ads/relatorio-por-hora.js`). Não existe:

- Geração de **imagem** a partir de dado real (o mockup foi feito à mão via IA
  de imagem, que não garante número certo de forma repetível — não serve pra
  automação diária).
- Uma terceira categoria de campanha pra "Engajamento" — hoje qualquer
  campanha fora de WPP/Seguidores cai no balde genérico "outro", junto com
  vaga de emprego, DRE, etc.
- Consolidação por **dia inteiro** de curtida/comentário/compartilhamento/
  salvamento por campanha — esse dado BRUTO já existe (`campaign_insights`,
  colunas `likes`/`comments`/`shares`/`saves`/`post_engagement`, com
  `period_days=1` dando o corte exato de 1 dia — confirmado com dado real de
  16/09/2026), só nunca foi somado/exposto em lugar nenhum do projeto.
- Um jeito de mandar **imagem** por WhatsApp — hoje só existe `mandarWhatsapp()`
  usando `send-text` da Z-API (`supabase/functions/enviar-relatorio-hora/index.ts`).

Este módulo é o primeiro do projeto a gerar imagem (HTML → PNG via Puppeteer)
fora da Fábrica de Criativos, e o primeiro relatório automático que roda fora
do Supabase (via GitHub Actions, não Edge Function + pg_cron) — porque Deno
não roda Chromium.

---

## 3. Nova categoria de campanha: `[+ ENGAJAMENTO]`

`tipoDaCampanha(nome)` em `src/ferramentas/meta-ads/relatorio-por-hora.js`
(e sua cópia `supabase/functions/_shared/relatorio-por-hora.js`) ganha um
terceiro prefixo:

```js
export function tipoDaCampanha(nome) {
  if (nome.startsWith('[CAMPANHA WPP]')) return 'wpp';
  if (nome.startsWith('[+ SEGUIDORES]')) return 'seguidores';
  if (nome.startsWith('[+ ENGAJAMENTO]')) return 'engajamento';
  return 'outro';
}
```

Já existem campanhas com "[Engajamento]"/"[ENGAJAMENTO]" soltas no nome, com
grafia inconsistente, e pelo menos uma delas é uma vaga de emprego que só por
acaso tem essa palavra no nome — **não são reaproveitadas**. O prefixo exato
`[+ ENGAJAMENTO]` (maiúsculas, com "+ ", igual ao `[+ SEGUIDORES]`) é o único
reconhecido; até o time de marketing renomear as campanhas de engajamento de
verdade no Meta Ads Manager pra usar esse prefixo, a seção 02 do relatório
sai vazia (nunca inventa número — mesma regra do resto do projeto).

Essa mudança em `tipoDaCampanha` é retrocompatível: só adiciona um `if`, não
muda o comportamento de `wpp`/`seguidores`/`outro` pra nenhuma campanha
existente. Os testes de `montarMensagemWpp`/`montarMensagemSeguidores` (que
já rodam de hora em hora em produção) continuam passando sem alteração.

---

## 4. Fonte dos dados (dia = ontem, América/São Paulo)

| Dado | Tabela | Filtro |
|---|---|---|
| Gasto, curtidas, comentários, compart., salvos, conversas, post_engagement — por campanha | `campaign_insights` | `account_id=Vessel AND captured_at=ontem AND period_days=1` |
| Nome da campanha (pra classificar) | `campaigns` | — |
| Novos seguidores no dia | `followers_leituras` | leituras cobrindo o dia de ontem inteiro (mesma função `deltaDeSeguidoresPorHora`, somando os deltas do dia — igual `seguidoresNoDia` já faz, só que pro dia completo, não até uma hora de corte) |
| Visitas ao perfil no dia | `perfil_visitas_hora` | soma do dia (`visitasPerfilNoDia`, já existe) |

Confirmado com dado real (16/09/2026): `campaign_insights` com `period_days=1`
soma R$ 1.542,66 no dia, contra R$ 1.456,04 de `campaign_insights_hora` no
mesmo dia — diferença de ~6%, consistente com o "acerto tardio da Meta" já
documentado no projeto (propagação de `spend` que ainda está processando).
Aceitável pra um relatório diário consolidado (não é o relatório por hora,
que já existe e usa a fonte mais fresca).

---

## 5. Métricas por seção

### Header (4 cards)

- **Investimento Total** = gasto(wpp) + gasto(seguidores) + gasto(engajamento), do dia
- **Novos Seguidores** = delta de seguidores do dia
- **Engajamentos** = soma de `post_engagement` das campanhas `engajamento` do dia (bruto da Meta — inclui mais que só as 4 métricas específicas: cliques em foto, reprodução parcial de vídeo, etc.)
- **Leads Gerados** = soma de `conversas` das campanhas `wpp` do dia

### 01 · Growth / Seguidores

- Investimento = gasto(seguidores) do dia
- Seguidores = delta do dia
- Visitas ao Perfil = soma do dia
- Custo por Seguidor = Investimento ÷ Seguidores (`custoPorLead`, null se seguidores ≤ 0)
- Custo por Visita = Investimento ÷ Visitas ao Perfil (null se visitas ≤ 0)
- Conversão Visita → Seguidor = Seguidores ÷ Visitas ao Perfil × 100%

### 02 · Engagement

- Investimento = gasto(engajamento) do dia
- Curtidas / Comentários / Compartilhamentos / Salvamentos = soma direta das 4 colunas, campanhas `engajamento`
- Custo por Curtida / Comentário / Compart. / Salvamento = Investimento ÷ cada métrica isolada (mesma simplificação já usada em Leads/Seguidores — não é atribuição por interação individual, é o mesmo investimento dividido por cada contagem)
- **Total de Interações** = Curtidas + Comentários + Compart. + Salvamentos (subconjunto qualificado — DIFERENTE de "Engajamentos" do header, que usa `post_engagement` bruto)
- Custo Médio por Engajamento = Investimento ÷ Total de Interações

### 03 · Leads & Sales (parcial — sem Quentes/Vendas)

- Leads = soma de `conversas`, campanhas `wpp`, do dia
- Investimento = gasto(wpp) do dia
- Custo por Lead = Investimento ÷ Leads

Sem funil (Leads→Quentes→Vendas), sem Custo por Lead Quente/Venda, sem
Conversão Lead→Quente/Quente→Venda — tudo isso depende do Chatwoot, que é
integração futura, fora desta entrega.

**Media Mix**: fora desta entrega — aguardando definição do gerente de marketing.

---

## 6. Arquitetura

```
GitHub Actions (cron diário, 08h BRT)
  └─ node coletor/gerar-opr-diario.mjs
       ├─ busca dado de ontem (REST Supabase, mesmo padrão de gerar-criativos.mjs)
       ├─ agrega números (src/ferramentas/meta-ads/relatorio-diario-opr.js — lógica pura)
       ├─ monta HTML (coletor/lib/template-opr.mjs)
       ├─ renderiza PNG (coletor/lib/render-criativo.mjs::renderPNG, já existe)
       └─ manda pro grupo via Z-API send-image (base64 direto, sem subir em bucket)
```

### 6.1. Lógica pura nova: `src/ferramentas/meta-ads/relatorio-diario-opr.js`

Um módulo novo (não uma extensão de `relatorio-por-hora.js`, que já está
grande e é sobre relatório por HORA, não consolidado diário). Reaproveita
`tipoDaCampanha`, `custoPorLead`, `formatarReais` do módulo existente
(import). Exporta uma função central, por exemplo:

```js
export function montarDadosOpr(campanhasDoDia, seguidoresDoDia, visitasDoDia) { ... }
```

devolvendo um objeto plano com todos os números já calculados (nunca a
mensagem/HTML pronta — isso é responsabilidade do template). Testado com
`.test.mjs` ao lado, cobrindo: soma por categoria, divisão por zero/negativo
(nunca inventar custo), e o caso "sem nenhuma campanha `[+ ENGAJAMENTO]`
ainda" (seção 02 zerada, não quebra).

Como é ESM puro sem nada de browser, tanto o front (`src/`) quanto
`coletor/gerar-opr-diario.mjs` importam o MESMO arquivo — sem precisar de uma
terceira cópia Deno, porque este pipeline não passa por Edge Function.

### 6.2. Template: `coletor/lib/template-opr.mjs`

Exporta `montarHtmlOpr(dados)` → string HTML autocontida (CSS inline, sem
fonte/imagem externa — mesma regra de `render-criativo.mjs`: "HTML
AUTOCONTIDO, fontes/imagens já inline"). Layout inspirado no mockup: cabeçalho
com título + conta/período, 4 cards de KPI, 2 colunas (Growth/Engagement) +
seção de Leads, sem a barra de funil visual complexa da seção 03 original
(como não temos Quentes/Vendas, a seção fica só com os 3 números que temos).

### 6.3. Script: `coletor/gerar-opr-diario.mjs`

Segue o padrão de `gerar-criativos.mjs` (import lazy do que precisa,
`sbGet`/fetch direto à REST, `--dry` pra rodar sem mandar). Suporta:

- `--dry`: salva o PNG em `coletor/opr-preview.png` (ou caminho similar) e
  IMPRIME os números calculados no terminal — nunca chama Z-API. Esse é o
  modo usado nesta entrega (dono pediu "monta pra mim mas não envia nada").
- Sem `--dry` (modo real, cron): manda pro grupo. Fica pronto no código, mas
  só é exercitado de verdade depois de aprovação explícita — o workflow do
  GitHub Actions só é CRIADO (sem rodar automaticamente) até o dono aprovar o
  preview.

Se a busca de dado ou a renderização falhar, o script tenta mandar um aviso
de TEXTO simples pro grupo (reaproveitando o mesmo padrão de `send-text` já
usado em `enviar-relatorio-hora`) — mesma filosofia do aviso de "sem dados"
recém-adicionado ao relatório por hora. Isso só entra em vigor quando o modo
real (sem `--dry`) estiver habilitado.

### 6.4. Envio de imagem: Z-API `send-image`

Confirmado via documentação: mesmo padrão de URL do `send-text`
(`.../instances/{id}/token/{token}/send-image`), header `Client-Token`, corpo
`{ phone, image, caption? }` — `image` aceita base64 com prefixo
`data:image/png;base64,`. Não precisa subir em bucket do Supabase Storage;
o PNG gerado pelo Puppeteer vai direto, em memória, pro corpo da requisição.

### 6.5. Workflow: `.github/workflows/opr-diario.yml`

Cron `0 11 * * *` (08h BRT — sem ajuste de horário de verão, Brasil não usa
desde 2019). Precisa de 3 secrets novos no repositório GitHub:
`ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN`, `ZAPI_TOKEN` (mesmos valores já
configurados como secret da Edge Function no Supabase — o dono vai precisar
informar de novo, porque `supabase secrets list` não expõe valor, só nome).
`SUPABASE_SERVICE_KEY` já existe como secret do GitHub (reaproveitado de
`fabrica.yml` e outros workflows).

**Nesta entrega**: o arquivo do workflow é criado, mas SEM o gatilho `on:
schedule` ativo (ou com o job comentado/`workflow_dispatch` manual só) — só
liga o cron automático depois que o dono aprovar o preview.

---

## 7. Testes e plano de rollout

1. `.test.mjs` cobrindo `montarDadosOpr` (lógica pura) — roda no `npm test`
   normal do projeto.
2. `node coletor/gerar-opr-diario.mjs --dry` gera o PNG localmente com dado
   real de ontem, SEM mandar nada — dono revisa o resultado.
3. Só depois de aprovação explícita: liga o `on: schedule` do workflow (ou
   troca `--dry` por envio de verdade) — commit separado, revisão separada.

Nenhum envio de teste ao grupo acontece nesta etapa, mesmo que eu invoque o
script manualmente — `--dry` é o único modo usado até o dono dizer "pode
mandar".
