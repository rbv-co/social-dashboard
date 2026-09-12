# Redes Sociais · o Meta Ads separado por tipo de campanha

Desenho de 17/08/2026. Pedido do dono, na conversa desta data:

> "vamos segmentar (filtrar) essa sessão por objetivo de campanha agora, e aí já
> automaticamente filtrar (mostrar) somente as campanhas do objetivo selecionado"

E, sobre a composição dos baldes:

> "teremos o objetivo seguidores que irá compor campanhas de tráfego, engajamento
> e o que mais sugere?" · "conversas e leads podem ser juntos não? assim como site
> e reconhecimento?"

A seção **02 · Meta Ads** da tela de Redes Sociais passa a ter uma barra de
**baldes**. Escolhendo um balde, os quatro cartões passam a falar só daquele tipo
de campanha — o dinheiro e os indicadores.

---

## O que foi medido antes de desenhar

Nada aqui é suposição. Tudo saiu do banco de produção em 17/08/2026.

### O objetivo "seguidores" não existe na Meta

Os objetivos que essas contas realmente rodam são seis:

| Objetivo | Campanhas | Gasto no histórico coletado (18/04 a 17/08) |
|---|---|---|
| Engajamento | 44 | R$ 59.070 |
| Tráfego | 40 | R$ 57.217 |
| Cadastros (leads) | 21 | R$ 34.738 |
| Cliques no link (antigo) | 26 | R$ 16.216 |
| Vendas | 6 | R$ 1.114 |
| **Reconhecimento** | 4 | **R$ 0,00** |

### Hoje os quatro cartões dividem o dinheiro de TODOS os objetivos

Últimos 30 dias, na última captura:

| Perfil | Gasto | Onde o dinheiro está |
|---|---|---|
| Breno Vale | R$ 2.584 | 100% Tráfego |
| Motoeasy | R$ 5.803 | 98,3% Cadastros |
| Raíssa Herculano | R$ 14.052 | 73,6% Tráfego · 26,4% Engajamento |
| Vessel | R$ 7.802 | 84% Engajamento · resto tráfego/cadastros/vendas |
| Mantova Móveis | R$ 1.056 | 100% Engajamento |

Em **três dos cinco perfis** a maior parte do dinheiro não é de engajamento. O
"custo por seguidor" da Motoeasy é, hoje, *dinheiro de cadastro dividido por
seguidores* — um número sem significado.

### Somar "Engajamento + Tráfego" seria errado nos dois sentidos

**Traria dinheiro que não é de seguidor.** Na Vessel, das campanhas com objetivo
Engajamento (R$ 6.553 em 30 dias), **R$ 5.699 são de WhatsApp** — `[IA] Dom Pedro
· WhatsApp`, `[GENSPARK] Tivoli · WhatsApp` e companhia: 87% do balde. A Meta
entrega campanha de conversa como `OUTCOME_ENGAGEMENT`. Na Motoeasy há a mesma
armadilha ao contrário: `[LEADS] NEGATIVADO? | P3 | TESTE OBJ ENGAJAMENTO` é
campanha de cadastro com objetivo de engajamento.

**Deixaria de fora dinheiro que é de seguidor.** No Breno Vale, os R$ 2.584 são
`[TRÁFEGO] GESTÃO EMPRESARIAL | PERFIL` — tráfego, sim, mas **para o perfil**. Na
Raíssa, R$ 7.292 dos R$ 10.342 de tráfego vão para o **PERFIL**; os outros
R$ 3.050 (`INSPIRA MAIS`, `DIA DA BELEZA`) vão para fora.

### O cartão de investimento não obedece ao filtro que já existe

`_inv` vem da edge `insights-ao-vivo`, que consulta `act_X/insights` em
`level=account` — a conta inteira, sem filtro nenhum. Os outros três cartões usam
`campaign_insights` **com** o filtro aplicado.

Na Vessel isso já diverge hoje: o painel mostra **R$ 7.802** de investimento e
divide **R$ 461,52** nos custos (1 campanha marcada de 125). Fatia de 6% do
dinheiro. É defeito de hoje, não desta obra — mas esta obra passa por cima dele e
tem que consertá-lo.

### Duas boas notícias que baratearam o desenho

**O coletor já recebe o que falta.** `coletar-dados` pede
`fields: 'campaign_id,spend,impressions,clicks,reach,actions'` e joga fora quase
tudo do `actions` — guarda só engajamento, curtida, comentário, compartilhamento
e salvamento. **Conversa, cadastro, venda e visita vêm na mesma resposta.** Não é
chamada nova e não é risco de rate limit — o que já derrubou esta tela uma vez.

**As metas não precisam de mudança no banco.** `social_metas` é
`(account_id, periodo, indicador, valor)` com `onConflict` em
`account_id,periodo,indicador`. Basta o indicador passar a carregar o balde no
nome.

---

## Os baldes

Quatro, mais o "Todos" de hoje:

| Balde | O que entra |
|---|---|
| **Todos** | tudo, como hoje |
| **Seguidores** | visita ao perfil do Instagram · engajamento na publicação · visualização de vídeo |
| **Contatos** | WhatsApp · Direct · Messenger · cadastro por formulário |
| **Site e alcance** | tráfego para fora · cliques no link · reconhecimento |
| **Vendas** | venda de produto/catálogo |

**Por que Contatos junta conversa e cadastro:** o app já trata assim. O
`baldeEfetivo` da Gestão de Tráfego joga campanha de cadastro com destino WhatsApp
no balde de conversa — são R$ 33.314 em 90 dias de campanhas rotuladas
leads/tráfego/vendas que na verdade são WhatsApp. Separados, a Motoeasy apareceria
com quase nada em "Cadastros" (R$ 5.385 dos R$ 5.803 são `[Leads] Para WhatsApp`)
e tudo em "Conversas". A divisão confundiria em vez de informar.

**Por que Site e alcance junta os dois:** Reconhecimento tem R$ 0,00 em quatro
meses de histórico. Um balde só pra ele viveria vazio.

**Por que Vendas fica sozinho apesar de miúdo (R$ 1.114):** é a única unidade que
mede dinheiro que volta. Juntar com qualquer outra faria a conta perder o sentido.

---

## 1 · Quem decide o balde de cada campanha

Módulo puro novo, `src/ferramentas/redes-sociais/baldes-do-painel.js`, com
`baldes-do-painel.test.mjs` ao lado. Sem rede, sem tela.

A decisão sai do **sinal que a Meta afirma no conjunto** (`destination_type` e
`optimization_goal`) — nunca do nome da campanha. Nomear por convenção funciona
hoje (`| PERFIL`, `[+ SEGUIDORES]`) e quebra no primeiro dia em que alguém nomear
diferente.

Ordem de precedência, de cima para baixo (a primeira que casar vence):

| # | Sinal | Balde |
|---|---|---|
| 1 | `destination_type` = WHATSAPP · INSTAGRAM_DIRECT · MESSENGER · MESSAGING_* , **ou** `optimization_goal` = CONVERSATIONS | Contatos |
| 2 | `objective` de cadastro (OUTCOME_LEADS, LEAD_GENERATION) | Contatos |
| 3 | `destination_type` = INSTAGRAM_PROFILE, **ou** `optimization_goal` = PROFILE_VISIT | Seguidores |
| 4 | `destination_type` = ON_POST · ON_VIDEO, **ou** `optimization_goal` = POST_ENGAGEMENT · THRUPLAY | Seguidores |
| 5 | `objective` de venda (OUTCOME_SALES, CONVERSIONS, PRODUCT_CATALOG_SALES) | Vendas |
| 6 | qualquer outro | Site e alcance |

**Conversa vence o objetivo declarado.** É a mesma regra que já corrigiu R$ 15.177
na Gestão de Tráfego (PR #51): o sinal vem do que a Meta AFIRMA no conjunto, não
do resultado observado. Uma conversa espontânea não faz campanha virar de
WhatsApp.

**Campanha com vários conjuntos:** basta UM conjunto dizer conversa para a
campanha inteira ser Contatos (`.some()`, como no `ehDeWhatsapp`). Nas demais
regras vale o primeiro sinal não-nulo entre os conjuntos.

**Campanha sem conjunto coletado:** cai pela regra do `objective`, usando o mapa
`GT_OBJETIVO_BALDE` que já existe. **Nenhuma campanha pode desaparecer.**

### Reaproveitamento, e o limite dele

`baldes.js` da Gestão de Tráfego é puro e já resolve WhatsApp e objetivo — o
módulo novo **importa** `ehDeWhatsapp` e `baldeDoObjetivo` dele em vez de copiar.
O que ele **não** sabe fazer é separar tráfego-para-o-perfil de tráfego-para-fora
(lá os dois caem em `trafego`), e é justamente essa a divisão que dá sentido ao
balde Seguidores. Por isso o mapeamento novo mora em módulo próprio do painel:
mexer nele não pode mudar o veredito da régua da Gestão de Tráfego.

### Testes de mesa (casos reais medidos)

| Campanha | Objetivo | Sinal do conjunto | Balde esperado |
|---|---|---|---|
| `[IA] Dom Pedro · WhatsApp` (Vessel) | Engajamento | destino WHATSAPP | Contatos |
| `[LEADS] NEGATIVADO? \| P3 \| TESTE OBJ ENGAJAMENTO` | Engajamento | cadastro | Contatos |
| `[TRÁFEGO] GESTÃO EMPRESARIAL \| PERFIL` (Breno) | Tráfego | INSTAGRAM_PROFILE | Seguidores |
| `[ENGAJAMENTO] FEED \| [P3]` (Raíssa) | Engajamento | ON_POST | Seguidores |
| `[TRÁFEGO] DIA DA BELEZA \| [P3]` | Tráfego | sem destino (site) | Site e alcance |
| `[ATACADO - SALE] SUA VITRINE` (Vessel) | Vendas | — | Vendas |
| campanha sem conjunto coletado | Tráfego | nenhum | Site e alcance |

E um teste que vale por todos: **soma dos quatro baldes = "Todos"**, em cada
perfil e cada período. Se um centavo sumir, o teste quebra.

---

## 2 · O que passa a ser coletado

### Conjuntos (a única chamada nova)

Tabela nova `campaign_adsets`:

| Coluna | Tipo | |
|---|---|---|
| `adset_id` | text | chave |
| `campaign_id` | text | |
| `account_id` | uuid | |
| `destination_type` | text | pode ser nulo de verdade |
| `optimization_goal` | text | |
| `synced_at` | timestamptz | |

Uma chamada `act_X/adsets` por perfil por rodada, com
`fields=id,campaign_id,destination_type,optimization_goal` — os mesmos campos que
a Gestão de Tráfego já pede ao vivo. Quatro rodadas por dia, cinco perfis com
conta de anúncio: **20 chamadas a mais por dia**.

`destination_type` nulo é informação, não falha — a Meta o deixa vazio de verdade
em campanha de site.

### Quatro colunas em `campaign_insights`

`conversas`, `cadastros`, `compras`, `visitas` — inteiros, extraídos do `actions`
que já chega, com o `actVal` que já existe:

| Coluna | `action_type` |
|---|---|
| `conversas` | `onsite_conversion.total_messaging_connection`, `onsite_conversion.messaging_conversation_started_7d` |
| `cadastros` | `lead`, `onsite_conversion.lead_grouped` |
| `compras` | `purchase`, `omni_purchase` |
| `visitas` | `landing_page_view` (não `link_click` — clique não é visita) |

Vale nos dois trechos que gravam `campaign_insights` (o agregado e o dia-a-dia).

**Dia antigo fica sem esses números** até um backfill rodar. Nesse caso o cartão
mostra **"—", nunca R$ 0**. Zero mentiria dizendo "custou zero" quando o certo é
"ainda não sei".

---

## 3 · O cartão de investimento

Continua sendo o primeiro cartão e continua sendo investimento. Muda só o dinheiro
que ele considera.

- **Todos** → segue ao vivo em `level=account`, exato, como hoje. Sem chamada
  nova, sem regressão.
- **Balde escolhido** → a edge `insights-ao-vivo` ganha um parâmetro **opcional**
  `campanhas: [ids]`; havendo ids, ela consulta `level=campaign` e soma só essas.
  Continua ao vivo e exato. Se a Meta engasgar, a tela cai no coletado como já cai
  hoje.
- Parâmetro ausente = comportamento de hoje, byte a byte. Quem chama a edge sem
  ele (se houver) não percebe diferença.
- **Consequência boa:** o "⚙ Filtrar campanhas" passa a valer também no cartão de
  investimento, e a divergência da Vessel (R$ 7.802 contra R$ 461,52) morre junto.

O filtro manual de campanhas e o balde se **somam**: o balde recorta o tipo, o
filtro recorta dentro dele. A barra escreve o que está valendo, em palavras.

---

## 4 · Os cartões 2, 3 e 4

Trocam junto com o balde, reaproveitando `alvos.js` da Gestão de Tráfego, que já
diz a unidade e o rótulo de cada tipo de resultado:

| Balde | Cartão 2 | Cartão 3 | Cartão 4 |
|---|---|---|---|
| Todos | Custo por mil impressões | Alcance | Frequência |
| Seguidores | Custo por seguidor | Custo por interação | Custo por curtida |
| Contatos | Custo por conversa | Conversas | Custo por cadastro |
| Site e alcance | Custo por visita | Visitas | Custo por mil impressões |
| Vendas | Custo por venda | Vendas | *(não tem)* |

**Balde sem quarto indicador honesto mostra três cartões.** Vendas é o caso:
inventar um quarto número só para preencher o vão seria fingir informação. A
grade se ajusta; o vazio não fica lá pedindo explicação.

Regras que valem para todos:

- **Toda meta é "custo por resultado, menor é melhor"** — a mesma régua da Gestão
  de Tráfego, para um semáforo só governar a tela. Por isso vendas usa custo por
  venda e não ROAS.
- **Denominador zero não vira R$ 0** — vira "—" com o motivo escrito. O selo
  "⏳ consolidando" que já existe no custo por seguidor continua valendo no balde
  Seguidores.
### "Todos" passa a mostrar só o que vale para qualquer campanha

Decisão do dono nesta conversa. O "Todos" **não** repete os cartões de hoje: um
custo por seguidor calculado sobre todo o dinheiro é sempre meio mentira, porque o
denominador só vale para uma parte dele — é exatamente a distorção da Motoeasy
(dinheiro de cadastro dividido por seguidores).

No lugar entram quatro indicadores que valem para **qualquer** tipo de campanha,
todos já em `account_insights`, **já deduplicados por pessoa e já coletados**
(gasto, alcance, impressões, cliques e frequência). Zero coleta nova para este
balde.

Medido em 30 dias, na última captura:

| Perfil | Investimento | Alcance | Custo/mil impressões | Frequência |
|---|---|---|---|---|
| Raíssa Herculano | R$ 14.548 | 1.306.633 | R$ 5,04 | 2,21 |
| Vessel | R$ 7.791 | 596.446 | R$ 5,55 | 2,36 |
| **Motoeasy** | R$ 6.212 | 85.367 | **R$ 14,51** | **5,02** |
| Breno Vale | R$ 2.882 | 237.272 | R$ 7,17 | 1,69 |
| Mantova Móveis | R$ 732 | 80.074 | R$ 4,75 | 1,93 |

O quadro se justifica sozinho: a Motoeasy paga **três vezes** o preço de mil
impressões dos outros e cada pessoa já viu o anúncio **cinco vezes** — acima do
limiar 4 que a régua usa para mandar reduzir verba. Nada disso é visível no painel
de hoje.

- **Alcance** vem do nível-conta (`account_insights.reach`), nunca da soma por
  campanha — somar infla até ~35%, porque a mesma pessoa aparece em várias.
- **Frequência** entra com semáforo no limiar já provado (≥4 = a mesma pessoa
  vendo demais), **sem meta editável**: o limiar é conhecimento do negócio, não
  preferência de conta.
- **Custo por mil impressões** ganha meta máxima editável, como os outros custos.
- Com um balde escolhido, alcance volta a ser a soma por campanha (não há
  deduplicação por recorte na Meta) e o cartão diz isso em uma linha.

### As metas

`social_metas.indicador` passa a carregar o balde: `seguidores.cps`,
`contatos.custo_conversa`, `site.custo_visita`, `todos.cpm`. As linhas de hoje
(`cps`, `cpi`, `cpl`) continuam sendo lidas como do balde **Seguidores** — que é
onde esses três cartões passam a viver. Migração de leitura, **sem tocar no banco
e sem apagar meta nenhuma**.

**O BUDGET também é por balde**, e é obrigatório que seja: se o investimento passa
a ser o do balde, uma meta de conta inteira compararia coisas diferentes — a
barrinha de progresso mostraria 8% de meta batida quando o dono gastou tudo que
queria em seguidores. A linha `spend` de hoje passa a valer para **Todos**, que é
o número contra o qual ela foi definida. **Os demais baldes nascem sem meta**:
mostram o valor sem barrinha, até o dono digitar a dele. Herdar meta de outro
recorte seria pior do que não ter.

`goalStorageKey` ganha o balde junto com conta e período, pela mesma razão.

---

## 5 · A barra na tela

Acima da barra "Campanhas consideradas no cálculo", no estilo segmented-control
que as abas do Engajamento já usam (seção 03) — não é botão novo, é o mesmo
padrão, e portanto obedece ao `PADRAO-DA-CENTRAL.md`: cor só de token, alvo de
40px no celular sem engordar o botão, texto que não corta.

```
BALDE:  [ Todos ]  [ Seguidores ]  [ Contatos ]  [ Site e alcance ]  [ Vendas ]
Campanhas consideradas no cálculo: Todas as campanhas de Seguidores   ⚙ Filtrar
```

- **A tela abre em Seguidores** (decisão do dono). É o painel de redes sociais: o
  que ele responde primeiro é quanto custa crescer. Quem quiser o retrato geral
  clica em Todos.
- **Perfil sem dinheiro em Seguidores abre em Todos** — a Motoeasy é o caso real
  hoje (R$ 0 no balde). Abrir num balde vazio seria abrir numa tela de traços.
- **Balde sem dinheiro no período fica apagado, com o motivo** ("sem campanha
  desse tipo neste período") — **não some**. Sumir faria a pessoa procurar o que
  não está lá.
- A escolha fica no navegador, por perfil (`localStorage`), e **não** vai para o
  banco: é recorte de leitura, não configuração da conta. Sessão nova volta a
  abrir em Seguidores.
- O modo **AUTO** (a TV passeando entre os perfis) continua funcionando: ao trocar
  de perfil, o balde escolhido é mantido se aquele perfil tiver dinheiro nele, e
  cai para "Todos" se não tiver.
- Medida a 375px num navegador de verdade antes de dizer que acabou. A barra
  rola na horizontal no celular; não quebra em duas linhas nem encolhe fonte.

---

## O que fica de fora, de propósito

- **Seções 01, 03 e 04 não mudam.** Esta obra é a seção 02.
- **Sem balde de Reconhecimento** — R$ 0,00 em quatro meses.
- **Sem editor de baldes na tela.** O mapa é código com teste; virar configuração
  seria convidar alguém a quebrá-lo sem teste.
- **Sem classificação por nome de campanha**, nem como reserva.
- **Sem backfill nesta entrega.** Os números novos aparecem à medida que o coletor
  roda; até lá, "—". Backfill entra como item separado, se o dono quiser o
  histórico.

---

## Como se prova que está certo

1. `npm test` — a suíte inteira, com os testes novos do módulo puro.
2. **Soma dos baldes = Todos**, medido em produção nos cinco perfis, em 7D e 30D.
3. **Vessel:** o investimento do balde Contatos tem que dar os R$ 5.699 de
   WhatsApp medidos hoje; o de Seguidores, os R$ 842.
4. **Breno Vale:** os R$ 2.584 têm que cair inteiros em Seguidores (é
   tráfego-para-o-perfil) — se caírem em Site e alcance, a regra 3 não pegou.
5. **Motoeasy:** balde Seguidores vazio, com o motivo escrito, e a tela abrindo em
   Todos por causa disso. No Todos, os R$ 14,51 de custo por mil impressões e a
   frequência 5,02 têm que aparecer com o semáforo aceso — se saírem cinzas, o
   limiar não foi ligado.
6. A tela aberta a 375px e no desktop, com o CSS do build.
7. `verificarTravaJanelas()` continua passando: esta obra não encosta em
   `janelasDoPeriodo`.

---

## Riscos anotados

- **A edge muda de contrato.** O parâmetro é opcional e o caminho sem ele é o de
  hoje — mas a edge sobe **na mão pelo MCP**, com todas as dependências de
  `_shared`, e não pelo push. Esquecer isso deixa a tela pedindo um parâmetro que
  o servidor não conhece.
- **`campaign_adsets` nasce vazia.** Enquanto a primeira coleta não roda, toda
  campanha cai pela regra do objetivo — o que significa WhatsApp da Vessel
  contando como Seguidores. A tela precisa dizer "classificação provisória" nesse
  primeiro dia, não mostrar número errado com cara de certo.
- **Rate limit.** Vinte chamadas a mais por dia é pouco, mas esta tela já caiu por
  rate limit uma vez. A chamada de conjuntos entra no mesmo `try` que já existe:
  falhou, não coleta, não quebra o resto da rodada.
