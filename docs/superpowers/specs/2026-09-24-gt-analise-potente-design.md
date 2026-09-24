# Gestão de Tráfego: a análise de início do dia — Onda A (o robô enxergar)

Data: 2026-09-24
Pedido do dono: "preciso de uma análise potente de cada campanha no início do
dia na aba campanhas e fila; na aba campanhas pode ser mais objetiva, na fila
mais técnica, clara e valiosa."

Decidido com ele em 24/09: **a Onda A vem primeiro.** As telas (Ondas C e D) só
ficam boas depois — sem A, as duas abas ficariam bonitas mostrando um julgamento
feito sem o número principal.

---

## 1. O problema, com a prova

O robô diário já existe: `coletor/budget-ia.mjs` roda **todo dia às 08:00 BRT**
(`.github/workflows/budget-ia.yml:18`) com Opus 4.8 e grava por campanha
veredito, justificativa, impacto e os três cenários em `gt_budget_analises`.
A infraestrutura da "análise de início do dia" está de pé. O que está fraco é o
que o robô ENXERGA.

Quatro cegueiras, todas em `montarMensagens` (`coletor/budget-ia.mjs:68-175`):

**1.1 — O custo atual não vai, mas a meta vai.** Linha 139:

    custo_atual_reais: pnd ? pnd.custoPorPonto : null,
    indice_contra_meta: pnd ? pnd.indice : null,

e `pnd` só existe quando o balde é engajamento (linha 83). Em campanha de
**lead, venda, mensagem e tráfego** — a maioria da carteira — o robô manda
`rotulo: "Custo por lead"`, manda `meta_reais: 15` e manda
`custo_atual_reais: null`. Enquanto isso o system prompt ordena, linha 99:
*"Cite esse número na justificativa, em reais e contra a meta."*

O modelo recebe a régua e não recebe o número que ela mede. Ou julga no escuro,
ou deduz do array cru de `actions` — sem que ninguém confira a conta dele.

**1.2 — Os anúncios vão sem resultado.** `adFields` (linha 389) pede
`spend,impressions,clicks,ctr,cpc,reach,frequency` e **não pede `actions`**.
O robô decide pausar criativo sem saber quantos leads, conversas ou compras
aquele criativo trouxe: julga criativo de conversão por CTR e frequência.

**1.3 — Sem tendência.** Busca uma janela só (`time_range: {since, until}`,
linha 370). O modelo não sabe se a campanha está melhorando ou piorando — e
"o que mudou desde ontem" é exatamente o que se olha às 8h da manhã.

**1.4 — Sem tempo no ar.** Nada distingue campanha em aprendizado da Meta de
campanha madura, embora o prompt mande falar de "reinício do aprendizado".

## 2. A causa raiz (por que 1.1 aconteceu)

Não foi esquecimento. `custo_atual_reais` só existe para engajamento porque
**`ponderada.js` é o único cálculo de custo que mora num módulo puro**. Quem
sabe calcular custo por lead, CAC, custo por visita, CPM e custo por conversa é
o `GT_METRIC_CATALOG` — e ele está **dentro de `tela-de-gestao-trafego.vue`**
(linha 654), que um robô Node não tem como importar.

É exatamente o problema que fez nascer o `baldes.js`, repetido. O comentário de
abertura dele já dizia a regra da casa:

> "Vive num módulo próprio porque a TELA e o ROBÔ precisam da mesma resposta.
> Enquanto isto era uma constante dentro do .vue, o robô não tinha como saber a
> que balde a campanha pertencia, então julgava por critério próprio (CTR, CPC)
> enquanto a tela julgava pela meta do dono — dois juízes discordando sobre a
> mesma campanha."

O catálogo de métricas é a mesma história, um degrau abaixo: a tela sabe quanto
a campanha paga por resultado, o robô não, e é o robô quem escreve a
justificativa que o dono lê.

## 3. O que muda

### 3.1 Nasce `metricas.js` — módulo puro

Extrair de `tela-de-gestao-trafego.vue` para
`src/ferramentas/gestao-trafego/metricas.js`:

- as listas de action types (`_GT_LEAD`, `_GT_VISIT`, `_GT_MSG`, `_GT_PURCHASE`,
  `_GT_POSTENG`, `_GT_LPV`, `_GT_ATC`, `_GT_IC`, `_GT_VIDEO`, `_GT_MSG_CONN`,
  `_GT_MSG_REPLY`);
- os leitores (`_gtNum`, `_gtActionVal`, `_gtActionValue`, `_gtPerGasto`);
- o `GT_METRIC_CATALOG` inteiro;
- `GT_BALDE_PADRAO`.

A tela passa a importar de lá e **deixa de ter sua própria cópia** — uma fonte
só, como `baldes.js` e `alvos.js`. Puro: sem rede, sem tela, com
`metricas.test.mjs` ao lado.

Isto é movimento de código, não reescrita: as funções vão verbatim. O teste que
prova é o de igualdade — o catálogo importado responde o mesmo que a tela
respondia para os mesmos insights.

### 3.2 `custoDoAlvo(balde, insight)` — o número que faltava

Função nova em `metricas.js`, montada sobre `alvos.js` (que já diz, por balde,
qual métrica decide):

    custoDoAlvo('leads', ins)   -> gasto ÷ leads
    custoDoAlvo('vendas', ins)  -> CAC
    custoDoAlvo('trafego', ins) -> custo por visita
    custoDoAlvo('mensagens', ins) -> custo por conversa
    custoDoAlvo('reconhecimento', ins) -> CPM
    custoDoAlvo('engajamento', ins) -> null (fica com a ponderada, ver seção 4)

Quantidade zero devolve **null, nunca R$ 0,00** — mesma regra que
`custoDaInteracao` já pratica. Um custo de R$ 0,00 no prompt seria lido pelo
modelo como "de graça" e viraria "escalar".

Em `budget-ia.mjs`, a linha 139 passa a ser:

    custo_atual_reais: custoAtual,
    indice_contra_meta: (custoAtual != null && meta > 0) ? custoAtual / meta : null,

onde `custoAtual` é `pnd ? pnd.custoPorPonto : custoDoAlvo(balde, ins)`.
A ponderada continua sendo o custo do balde engajamento — nada nela muda nesta
onda.

### 3.3 Os anúncios passam a levar resultado

`adFields` ganha `actions,action_values`. Nenhuma chamada nova à Meta: são
campos do mesmo GET. No `dados.anuncios`, cada anúncio ganha
`resultado` (a quantidade do `alvo.resultado` do balde da campanha) e
`custo_por_resultado` (via `custoDoAlvo`), para o veredito de criativo parar de
sair só de CTR.

O balde usado é o **da campanha**, descido pronto — nunca recalculado por
anúncio. É a mesma correção já registrada no `.vue` (H1 do review de
2026-07-28): a Meta OMITE um action type inteiro quando a contagem é zero, e um
anúncio que gastou sem puxar conversa na janela fica indistinguível de um
anúncio de engajamento puro.

### 3.4 Tendência: a janela anterior

Uma segunda chamada de insights com `time_range` de **mesma duração,
imediatamente anterior** à janela atual (7 dias atuais -> os 7 dias que
terminam na véspera do `since`; mesmos `insFields`, mesmo `limit`) e o resultado entra no prompt como `janela_anterior`, com gasto,
o custo do alvo e frequência. O prompt ganha a ordem de comparar as duas e
dizer o SENTIDO do movimento — "o custo por lead subiu de R$ 12 para R$ 19 em
sete dias" é uma frase que hoje o modelo não tem como escrever.

Custo: uma chamada a mais por conta, na mesma rodada das 8h.

### 3.5 Tempo no ar

`dias_no_ar`, calculado de `camp.created_time` — campo que precisa ser
conferido na resposta real da Meta antes de entrar (se não vier, esta parte
cai e o resto da onda segue). Campanha com menos de 3 dias entra
no prompt marcada como **em aprendizado**, e a regra passa a ser: não mandar
mexer em quem ainda está aprendendo, a menos que esteja queimando dinheiro.

### 3.6 O prompt

Ajustes mínimos, já que o problema era insumo e não redação:
- citar o custo atual **e** o sentido contra a janela anterior;
- no veredito de criativo, usar o resultado do anúncio, não só CTR;
- respeitar o aprendizado (3.5);
- quando `custo_atual_reais` vier null **e** houver meta, dizer explicitamente
  "esta campanha não registrou resultado na janela" — em vez de inventar.

## 4. O que NÃO muda nesta onda

- As telas. `tela-de-gestao-trafego.vue` só perde as cópias que foram para
  `metricas.js`; nenhum pixel muda de lugar.
- A ponderada e a régua. O herói de engajamento **continua sendo o custo por
  ponto** até a Onda B.
- O esquema de `gt_budget_analises`. Nenhuma migration nesta onda.
- A cadência: continua 08:00 BRT, 'ativas' nos dias comuns, 'amplo' na segunda.

## 5. Como provar

Teste verde não é tela que abre, e aqui nem tela existe — então a prova é a
saída do robô, não o teste passando.

1. **Igualdade do catálogo** (`metricas.test.mjs`): para um conjunto de insights
   reais gravados, cada chave do `GT_METRIC_CATALOG` importado devolve
   exatamente o que a tela devolvia. Move-sem-quebrar, provado.
2. **`custoDoAlvo` por mutação**: para cada balde, um insight onde a quantidade
   é zero devolve `null` e NÃO `0`; e um insight com quantidade devolve
   gasto ÷ quantidade. O teste falha se alguém trocar null por 0.
3. **A cegueira fechou** (o teste que importa): montar as mensagens de uma
   campanha de LEAD real e afirmar que `dados.regua.custo_atual_reais` é um
   número. Hoje esse teste falha — é ele que prova que 1.1 existia.
4. **Rodada seca contra a conta real**, sem gravar: rodar o robô com escrita
   desligada e ler as justificativas de 5 campanhas de baldes diferentes,
   conferindo que o número citado no texto bate com o custo real da campanha
   na tela. Diagnóstico NA TELA, não deduzido do código.

## 6. Riscos

- **O `.vue` tem 6.161 linhas e o catálogo é usado em vários pontos dele.**
  A extração precisa ser verbatim e conferida por teste de igualdade (5.1)
  antes de qualquer outra mudança. Se a tela mudar um número no dia da
  extração, a culpa fica ambígua.
- **O custo do Opus sobe um pouco**: mais campos no prompt e uma chamada a mais
  de insights por conta. Medir na primeira rodada (`custo-anthropic` já existe).
- **Justificativa melhor pode mudar vereditos.** É o objetivo, mas a primeira
  rodada depois da mudança merece ser lida inteira antes de alguém aprovar em
  massa na Fila.

## 7. As ondas seguintes (desenhadas, não detalhadas)

- **B — KPI herói por objetivo.** Engajamento passa a ser julgado por **custo
  por engajamento** (gasto ÷ `post_engagement`), com o custo por ponto virando
  apoio. Campanhas `[+ SEGUIDORES]` (detectadas pelo prefixo do nome, como
  `relatorio-por-hora.js:36` já faz) ganham **custo por seguidor estimado**:
  gasto ÷ seguidores do dia — conta que `gerar-opr-diario.mjs:152` já faz —
  **rateado por clique no link** quando houver mais de uma campanha no ar.
  Rateio por GASTO foi descartado: daria o mesmo número para todas as
  campanhas. Rateio por CLIQUE preserva a mesma ordem de mérito do custo por
  clique (dado real por campanha) traduzida para a moeda que o dono lê, e a
  soma das partes fecha com o número real da conta. O número entra marcado como
  estimativa: assume que todo clique vira seguidor na mesma taxa, e o total
  inclui seguidor orgânico. Mensagem/WhatsApp passa a se chamar **"Custo por
  lead"** mantendo a conta de hoje (conversa iniciada = lead, decisão do dono
  em 24/09) — a decisão de 2026-07-29 registrada em `baldes.js` fica intacta.
- **C — Aba Campanhas, objetiva.** Herói grande com cor contra a meta, a
  quantidade do resultado, o gasto e a linha do robô. Conjuntos e anúncios
  recolhidos por padrão (hoje `:2585` abre todos, de todas as campanhas).
  Reaproveita `custoAlvo`/`metaAlvo`/`aval`, calculados em `:2415-2448` e hoje
  **descartados sem desenhar** — código morto desde que o veredito foi para a
  Fila.
- **D — Aba Fila, técnica.** Evidência numérica ao lado do texto do modelo:
  herói vs meta, tendência contra a janela anterior, e o que mudou desde a
  análise de ontem.
- **E — A régua.** Meta nova e própria para custo por engajamento, **ao lado**
  da meta do ponto, sem sobrescrever: a meta salva hoje está em R$ por ponto
  (na Vessel o ponto custa R$ 0,013) e julgar R$ por engajamento com ela
  pintaria a carteira inteira de uma cor só. Decisão do dono em 24/09:
  **enquanto ele não definir a meta nova, campanha de engajamento fica sem
  cor** — o número aparece, sem julgamento.
