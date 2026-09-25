# Gestão de Tráfego — Onda B: a régua que mede o que a campanha entrega

Data: 2026-09-24
Depende de: `2026-09-24-gt-analise-potente-design.md` (Onda A, já no ar — PR #251)
Medição que fundamenta: `.superpowers/sdd/2026-09-24-gt-analise-potente-onda-a/medicao-onda-b.md`

Decisões do dono em 24/09, depois de ver a medição:
- **"vamos tirar a dinâmica do engajamento ponderado por enquanto, então o custo por
  engajamento manda"**;
- **custo por seguidor: "só por conta, nunca por campanha"**.

---

## 1. O que a medição mostrou

A mesma campanha recebe vereditos opostos conforme a régua:

| `[FLUXO SHOPPING]` (Vessel) | valor |
|---|---|
| Pontos ponderados | **44** |
| Engajamentos brutos | **11.323** |
| Custo por ponto | R$ 8,30 → **662× a meta, "reduzir"** (rodada real de 24/09) |
| Custo por engajamento | R$ 0,032 → **pareceria ótima** |

Quase nada do que a Meta conta como `post_engagement` nessa campanha é curtida,
comentário, salvamento ou compartilhamento — as quatro ações que a ponderada pesa. As duas
réguas não medem a mesma coisa em unidades diferentes: medem coisas diferentes.

E não há fator de conversão: a razão pontos/engajamento vai de **0 a 0,56** nas três
campanhas medidas. Uma tem engajamento e zero pontos.

**Ressalva de honestidade, para ninguém superinterpretar depois:** a amostra é de 3
campanhas em 2 contas (as outras 4 contas não têm campanha de engajamento pura no ar). O
relatório traz "Spearman = −1,0"; com n=2 esse coeficiente só pode dar +1 ou −1, então ele
não sustenta nada sozinho. O que sustenta o achado é o mecanismo dos 11.323 contra 44.

**Achado lateral, que a Onda B não resolve:** as metas de engajamento salvas já estão mal
calibradas hoje — a Vessel pratica 13× a meta dela (vive vermelha) e a Raíssa pratica 13%
da meta (vive verde). Trocar a unidade da régua é a oportunidade de recalibrar as duas.

## 2. O que muda

### 2.1 Engajamento passa a ser medido por custo por engajamento

- Nasce `custo_engajamento` no catálogo (`metricas.js`): gasto ÷ `post_engagement`
  (a quantidade já existe como `engaj_pub`). Zero engajamento devolve `null`, nunca `0`.
- `alvos.js`: `ALVOS.engajamento` passa de `metrica: 'ponderada'` para
  `metrica: 'custo_engajamento'`, com `resultado: 'engaj_pub'` (hoje é `null`, e é por isso
  que todo anúncio de campanha de engajamento chega ao robô sem quantidade — ver Onda A,
  achado I2). Rótulo: "Custo por engajamento".
- Consequência de tabela: engajamento sai do "mundo do ponto" e entra no "mundo do
  resultado", passando a usar `limiares_resultado` (seção 2 da régua).

### 2.2 A ponderada é desligada, não apagada

"Por enquanto" é uma pausa, e o desenho tem de permitir voltar atrás sem arqueologia:

- `ponderada.js`, `regua.js` (seção 1: pesos e limiares do ponto) e as colunas do banco
  **permanecem**, intocados;
- o que muda é **quem consulta**: nem o cartão, nem a Fila, nem o robô julgam por ponto;
- o custo por ponto **some do cartão** — mostrar um número que não decide nada, ao lado do
  que decide, é exatamente o tipo de contradição visual que já foi rejeitada duas vezes
  nesta ferramenta (C2 e M4 dos reviews de 2026-07-28);
- a seção 1 da régua ganha um aviso dizendo que está em pausa desde 24/09/2026, com o
  motivo em uma linha. Quem abrir a tela precisa entender por que aqueles campos não
  afetam mais nada.

**O que NÃO é desligado:** o objetivo declarado por interação (`gt_objetivo_interacao`).
Ele não é a ponderada — não usa pesos; é "esta campanha compra salvamento, então me julgue
por custo por salvamento" (`custoDaInteracao`). Ele continua valendo e passa a ser o
**override**: campanha com interação declarada é julgada por ela; sem declaração, vale o
custo por engajamento. É a saída para casos como a FLUXO SHOPPING, sem escolher uma régua
única que erra metade dos casos.

### 2.3 A meta nova, sem sobrescrever a antiga

A meta de engajamento salva hoje está em **R$ por ponto** e não pode ser reaproveitada nem
convertida (não há fator). Então:

- nasce uma meta própria para `custo_engajamento`, ao lado, **sem apagar** a do ponto
  (que precisa sobreviver intacta para a pausa ser reversível);
- **enquanto o dono não definir a meta nova, campanha de engajamento fica SEM COR** — o
  número aparece, sem julgamento. Decisão dele em 24/09, mantida da Onda A;
- a tela da régua mostra, ao lado do campo, **o que a conta pratica hoje** em R$ por
  engajamento, para a meta ser definida olhando o real em vez de no escuro. Valores
  medidos em 24/09: Vessel R$ 0,032–0,087; Raíssa R$ 0,005.

### 2.4 Seguidores: custo por conta, nunca por campanha

Decisão do dono, e a medição dá razão a ela: o rateio por clique quebra quando uma
campanha tem clique perto de zero — a `AXIOM_05_SEGUID_VESSEL-CAMPINAS` gastou R$ 726 com
**1 clique** em 7 dias, e o rateio cospe "R$ 2.624,88 por seguidor".

- O custo por seguidor é **da conta**: gasto das campanhas de seguidores ÷ seguidores
  ganhos no período. A conta já existe em `coletor/gerar-opr-diario.mjs:152-158`; esta onda
  a leva para a ferramenta em vez de reescrevê-la.
- Valores medidos em 7 dias: Vessel R$ 1,60 · Mantova R$ 7,21 · Raíssa R$ 10,05.
- **Nunca é rateado por campanha, e nunca vira veredito de campanha.** Campanha de
  seguidores continua sem custo por resultado — a muleta da Onda A (`ehDeSeguidores` +
  `medida_indisponivel`) **permanece**, e deixa de ser temporária: passa a ser a regra.
- O número aparece em dois lugares: (i) no cabeçalho da lista de campanhas, uma linha por
  conta; (ii) no prompt do robô, como contexto ao analisar campanha de seguidores — para
  ele ter o que dizer além de "não sei medir".
- **Sempre marcado como estimativa**, com o motivo visível: inclui seguidor orgânico e a
  Meta não atribui seguidor a campanha. Número aproximado apresentado como exato é pior
  que número ausente.

### 2.5 Mensagens: só o rótulo

Campanha de mensagem/WhatsApp passa a se chamar **"Custo por lead"** na tela e no prompt.
A conta não muda — continua conversa iniciada, como decidido em 2026-07-29 e registrado em
`baldes.js`. Divergência de resultado: zero, por construção.

## 3. O que NÃO muda

- A decisão de 2026-07-29 sobre WhatsApp (o conjunto manda, não o objetivo declarado).
- `baldes.js`, `veiculacao.js`, `orcamento-hierarquia.js`.
- O esquema de `gt_budget_analises`.
- A cadência do robô: 08:00 BRT.
- A tela de Campanhas em si — a reforma do cartão é a Onda C. Esta onda mexe no cartão
  apenas onde a régua muda (tira o custo por ponto, troca o herói de engajamento).

## 4. Como provar

1. **`custo_engajamento` por mutação**: zero engajamento devolve `null`, nunca `0`.
2. **A troca de régua muda o veredito das campanhas certas**: com a régua nova e uma meta
   de exemplo, a `[FLUXO SHOPPING]` sai de "reduzir" — e o teste afirma isso nominalmente,
   porque é a campanha que motivou a mudança.
3. **A pausa da ponderada é reversível**: teste que prova que `ponderada.js` e a seção 1 da
   régua continuam funcionando e intocados; só ninguém os consulta.
4. **O override por interação declarada ganha do custo por engajamento** quando existe.
5. **Sem meta nova, sem cor**: teste que prova que engajamento sem meta devolve faixa
   neutra em vez de ser pintado pela meta do ponto.
6. **Custo por seguidor nunca aparece por campanha**: teste que prova que nenhuma campanha
   recebe custo por seguidor, por mais que a conta tenha o número.
7. **Prova na conta real** pelo `--dry` (não chama modelo, não grava), conferindo que
   engajamento mostra custo por engajamento e seguidores seguem em "medida indisponível".

## 5. Riscos

- **A migração da meta é manual e o dono precisa fazê-la.** Até lá, engajamento fica sem
  veredito de custo. É o combinado, mas significa que a Fila fica mais pobre em
  engajamento por alguns dias.
- **A amostra que fundamenta a troca é pequena** (3 campanhas, 2 contas). O mecanismo é
  claro, mas vale repetir a medição com janela de 30 dias depois da migração, para
  conferir que a régua nova separa bem as campanhas.
- **A FLUXO SHOPPING precisa de olhada humana** antes de a meta nova ser definida: ela
  sozinha puxa a média da Vessel para baixo (R$ 0,032 contra R$ 0,087 da outra campanha),
  e uma meta calibrada com ela dentro pode ficar frouxa para as demais.
