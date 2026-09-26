# Gestão de Tráfego — Onda C: a régua segue o que a campanha COMPRA

Data: 2026-09-25
Depende de: Onda A (no ar, PR #251) e Onda B (branch `onda-b/gt-regua-do-engajamento`, 7/7)

Pedido do dono, 25/09: *"tem campanha que o objetivo é engajamento porém o evento de
conversão principal é mensagens no whatsapp, e aí tem outros tipos de eventos principais
diante do objetivo da campanha, precisamos desdobrar isso melhor… na Motoeasy tem campanhas
de engajamento para conversas, e na Mantova tem campanha de engajamento para visitas ao
perfil (seguidores)"*. Mais: **desativar a ponderada com interruptor na régua**, e **fechar o
custo por seguidor** como KPI das campanhas de perfil.

---

## 1. A medição que funda esta onda

Medi `destination_type` e `optimization_goal` dos conjuntos ATIVOS das 6 contas em 25/09.
**A Meta afirma o que a campanha compra — e não é o objetivo declarado:**

| Conta | Objetivo declarado | Destino real | Otimização |
|---|---|---|---|
| Motoeasy | `OUTCOME_ENGAGEMENT` | `WHATSAPP` | `CONVERSATIONS` |
| Mantova | `OUTCOME_ENGAGEMENT` | `INSTAGRAM_PROFILE` | `PROFILE_AND_PAGE_ENGAGEMENT` |
| Vessel | `OUTCOME_TRAFFIC` | `INSTAGRAM_PROFILE` | `PROFILE_VISIT` |
| Vessel `[FLUXO SHOPPING]` | `OUTCOME_ENGAGEMENT` | `ON_VIDEO` | `THRUPLAY` |
| Vessel `[250]_AXIOM_02` | `OUTCOME_TRAFFIC` | `WEBSITE` | `OFFSITE_CONVERSIONS` |
| Vessel `[Engajamento]` | `OUTCOME_ENGAGEMENT` | `ON_POST` | `POST_ENGAGEMENT` |

Três consequências:

**1.1 — A muleta do nome morre.** `ehDeSeguidores(nome)`, criada na Onda A procurando
"SEGUID" no nome, é substituída por sinal que a Meta afirma. A afirmação da migration
`2026-09-12-meta-ads-hora-visitas-perfil-da-conta.sql` ("nenhuma campanha [+ SEGUIDORES] tem
destino Instagram Profile — conferido na Graph API") está **desmentida** pelos dados de hoje:
todas têm. A migration fica; um comentário novo registra a correção com a data.

**1.2 — O mistério da `[FLUXO SHOPPING]` acabou.** Ela é `ON_VIDEO`/`THRUPLAY`: campanha de
**vídeo**. Os 11.323 "engajamentos" contra 44 pontos ponderados eram views. Ela nunca deveria
ter sido julgada por ponto (662× a meta, "reduzir" em 24/09) nem por engajamento bruto
(pareceria ótima a R$ 0,03). O produto dela é view.

**1.3 — Um bug real, com número.** `_GT_VISIT = ['landing_page_view','link_click']` e
`_gtActionVal` devolve **o primeiro tipo que existir**. Em campanha de perfil:

```
[SEGUIDORES][REMARKETING] (Raíssa) — gasto R$ 283,84
  landing_page_view = 1        <- era este que virava denominador
  link_click        = 3.203    <- o número real de quem foi levado ao perfil
```

Era essa a origem do "R$ 247,45 por visita, 1455× a meta" que assustou em 24/09 — não a
ausência de dado. Com `link_click`: **R$ 0,09**.

**1.4 — O que a Meta NÃO dá.** Conferido em 12 campanhas de perfil, 3 contas: **nenhuma ação
de `profile_visit` e nenhuma de `follow`**. Custo por seguidor **por campanha** não existe.
O clique é o único proxy por campanha; o seguidor só existe no nível da conta.

## 2. O desenho: MERCADO em vez de objetivo

Nasce `mercados.js` (puro, testado). O **mercado** de um conjunto é o que ele compra,
derivado do par que a Meta afirma:

| Mercado | Sinal (destino / otimização) | KPI principal | Quantidade |
|---|---|---|---|
| `conversa` | `WHATSAPP` ou `CONVERSATIONS` | Custo por lead | conversas iniciadas |
| `perfil` | `INSTAGRAM_PROFILE*` ou `PROFILE_VISIT` / `VISIT_INSTAGRAM_PROFILE` / `PROFILE_AND_PAGE_ENGAGEMENT` | **Custo por visita ao perfil** | `link_click` |
| `video` | `ON_VIDEO` ou `THRUPLAY` | Custo por view | `video_view` |
| `post` | `ON_POST` ou `POST_ENGAGEMENT` | Custo por engajamento | `post_engagement` |
| `site_venda` | `WEBSITE` + `OFFSITE_CONVERSIONS` | CAC | compras |
| `site_trafego` | `WEBSITE` + `LANDING_PAGE_VIEWS`/`LINK_CLICKS` | Custo por visita | `landing_page_view` |
| `lead_form` | `LEAD_GENERATION` | Custo por lead | leads |
| `desconhecido` | nada reconhecido | — (sem veredito de custo) | — |

**A ordem de decisão importa** e fica escrita no módulo: destino primeiro, otimização como
desempate. Uma campanha `OUTCOME_ENGAGEMENT` com destino `WHATSAPP` é mercado `conversa`,
ponto final — é a mesma regra de 2026-07-29 que já valia para WhatsApp, agora generalizada.

**O objetivo declarado deixa de decidir.** `baldes.js` continua existindo para leitura
histórica (o robô grava `objetivo` em `gt_budget_analises`), mas quem manda no veredito é o
mercado.

### 2.1 Campanha mista: o card quebra por conjunto

Decisão do dono, 25/09. A `[LEADS LOJA][mixconversão]` da Vessel tem conjuntos em
`WHATSAPP/CONVERSATIONS` e em `UNDEFINED/LANDING_PAGE_VIEWS` ao mesmo tempo.

- Quando **todos** os conjuntos têm o mesmo mercado, nada muda: a campanha tem um mercado e
  um KPI, como hoje.
- Quando **divergem**, a campanha **não recebe veredito de custo único** — somar mercados
  diferentes não produz número com significado. O cabeçalho da campanha mostra quais
  mercados ela mistura e o gasto de cada um; **cada conjunto exibe a própria régua e o
  próprio KPI** na linha dele, que é onde o card já expande hoje.
- O robô recebe a campanha marcada como mista, com a quebra por conjunto, e é instruído a
  julgar conjunto a conjunto em vez de inventar uma média.

### 2.2 O editor de KPIs passa a ser por mercado

Hoje `gt_config_metricas` guarda as métricas por **balde** (objetivo). Passa a guardar por
**mercado**. A tela do editor lista os mercados da tabela acima, cada um com seu KPI
principal fixo (o da régua) e as métricas de apoio editáveis.

Migração: a chave muda de balde para mercado. As linhas existentes são **mantidas** — ler
uma chave antiga não quebra, apenas não é usada. Nenhuma migration destrutiva.

## 3. A ponderada ganha interruptor

Hoje religar a ponderada é "trocar duas linhas em `alvos.js`". O dono quer **um botão**:

- na régua, a Seção 1 ganha um interruptor **Ativa / Desligada**, persistido junto com a
  régua (campo novo, sem sobrescrever nada);
- **desligada** (padrão a partir de 24/09): a ponderada some da aba Campanhas — nenhum chip,
  nenhum veredito — e os campos da Seção 1 aparecem esmaecidos, com a explicação de que não
  afetam nada enquanto estiver assim;
- **ativa**: volta a valer como régua do mercado `post`, usando a meta em R$/ponto que ficou
  guardada.

O estado é lido por uma função só (`ponderadaLigada(regua)`), consumida pela tela e pelo
robô — os dois não podem discordar sobre isso.

## 4. Custo por seguidor, fechado

- **No card da campanha de perfil:** KPI principal = **custo por visita ao perfil**
  (gasto ÷ `link_click`), número real e por campanha. É o que permite comparar uma campanha
  de perfil com outra.
- **Ao lado, como contexto:** o custo por seguidor **da conta**, que a Onda B já calcula,
  sempre marcado como estimativa e com a janela declarada.
- A marca "medida indisponível" **sai** das campanhas de perfil: elas passam a ter medida de
  verdade. O que continua não existindo é seguidor por campanha, e isso o texto diz.

### 2.3 O card do ANÚNCIO ganha o KPI do mercado

Pedido do dono, 25/09: *"eu não vejo as kpis no card dos anúncios também, sinto falta disso"*.

Hoje o anúncio mostra **só CTR e gasto** (`tela-de-gestao-trafego.vue:2931`), enquanto a
campanha mostra os KPIs do mercado. E o robô **já recebe** `resultado` e
`custo_por_resultado` por anúncio desde a Onda A — a informação existe, calculada, e a tela
nunca mostrou.

O anúncio passa a exibir, além de CTR e gasto:
- o **KPI principal do mercado da campanha** (custo por lead, por visita ao perfil, por view…),
  com a **cor** contra a meta daquele mercado;
- a **quantidade** do resultado.

**Não** herda as métricas de apoio: decisão do dono em 25/09, e pela mesma razão que abriu
este trabalho — uma campanha pode ter uma dúzia de anúncios na tela, e repetir a régua
inteira em cada um desfaz o que se ganhou tirando o excesso do cartão.

O mercado do anúncio é o **da campanha**, descido pronto — nunca recalculado por anúncio.
A Meta omite um action type inteiro quando a contagem é zero, então um anúncio de campanha de
WhatsApp que não puxou conversa na janela fica idêntico a um de engajamento puro (H1 do review
de 2026-07-28, e a mesma regra que a Onda A já aplica no robô).

Em campanha **mista**, o anúncio segue o mercado do **conjunto** dele, que é o que a quebra
por conjunto (2.1) torna possível.

## 5. O que NÃO muda

- A decisão de 2026-07-29 (o conjunto manda, não o objetivo declarado) — esta onda a
  generaliza, não a contradiz.
- `ponderada.js`, os pesos e a meta em R$/ponto: continuam guardados e intactos.
- O esquema de `gt_budget_analises`.
- A cadência do robô (08:00 BRT) e o `--dry`.

## 6. Como provar

1. **`mercados.js` por mutação**, com as combinações reais medidas em 25/09 como fixture —
   inclusive `OUTCOME_ENGAGEMENT` + `WHATSAPP` dando `conversa`, e `OUTCOME_ENGAGEMENT` +
   `INSTAGRAM_PROFILE` dando `perfil`. Um teste que trave que **o objetivo não decide**.
2. **O bug do fallback**: teste com `landing_page_view: 1` e `link_click: 3203` afirmando que
   o custo por visita ao perfil usa 3.203. Falha no código de hoje.
3. **Campanha mista**: teste que prova que ela não recebe custo único e que cada conjunto
   traz o seu.
4. **O interruptor**: teste que prova que, desligada, nenhum caminho consulta a ponderada; e
   que, ligada, ela volta a valer com a meta antiga.
5. **Prova na conta real** pelo `--dry`: a Motoeasy aparece em `conversa`, a Mantova em
   `perfil`, a `[FLUXO SHOPPING]` em `video`, e o `[SEGUIDORES][REMARKETING]` da Raíssa sai
   de R$ 247,45 para algo perto de R$ 0,09.

## 7. Riscos

- **O mercado `perfil` junta duas otimizações diferentes** (`PROFILE_VISIT` e
  `PROFILE_AND_PAGE_ENGAGEMENT`). São primas, mas não idênticas: a segunda otimiza por
  engajamento no perfil, não por visita. Se os custos por clique divergirem muito entre as
  duas, vale separar — medir depois da onda, com 30 dias.
- **`[FLUXO SHOPPING]` muda de mercado e de veredito.** Ela recebeu "reduzir" em 24/09 por
  uma régua errada. Com `video`, passa a ser julgada por custo por view — e o dono deve
  olhar essa campanha antes de definir a meta do mercado `video`.
- **Toda meta nova começa vazia.** Mercados novos (`video`, `perfil`, `post`) não têm meta
  em R$ na unidade nova. Até o dono definir, **sem cor** — a regra desta ferramenta desde a
  Onda A.
