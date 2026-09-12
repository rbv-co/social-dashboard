# A data da venda: o dia da nota, não o dia do pedido

Status: **as três etapas feitas.** Falta só olhar as telas logado.

## O problema, em uma frase

A dashboard lança a venda no dia em que o **pedido foi gerado**. O dono viu um
pedido do Atacado gerado na quinta e faturado na sexta aparecer na quinta.

## O que foi medido (11/08/2026, dados reais)

| | |
|---|---|
| Pedidos concluídos num dia posterior ao do pedido, últimos 30 dias | 44 · R$ 31.143,58 (teto) |
| Com atraso de exatamente 1 dia | 18 · R$ 19.375,69 |
| Conferido contra a nota de verdade | 4 de 11 pedidos com data diferente |
| Padrão | loja emite NFC-e no mesmo dia; Atacado emite NF-e no dia seguinte |

Casos que serviram de prova: nº2429 (R$ 3.644,30) e nº2427 (R$ 2.550,74),
pedido 04/08 → nota 05/08. E o nº2372, pedido de 27/07, concluído em 11/08 —
esse **sem nota nenhuma**.

## Armadilhas medidas (não deduzir de novo)

1. **`dataSaida` do pedido não serve.** Igual à `data` nos 493 pedidos atendidos
   dos últimos 90 dias. O Bling preenche na criação e não atualiza no
   faturamento.
2. **O filtro de data da LISTA de notas deixa escapar a borda de baixo.** Pedir
   `04..04` devolve zero; `03..06` devolve o dia 04. Por isso a nota é lida pelo
   **id** que o pedido informa.
3. **"Pedido sem nota" chega como `notaFiscal.id = 0`**, não como vazio.
4. **Reautorizar o Bling invalida o token anterior E o refresh_token.** Custou
   uma queda do sistema em 11/08. O `code` da autorização vale ~60 segundos.

## Etapa 1 — guardar a data certa ✔ FEITA

- `db/migrations/2026-08-11-nota-fiscal-dos-pedidos.sql` → tabela
  `bling_pedido_nota`, com `data_da_venda` como **coluna gerada**
  (`coalesce(data_da_nota, data_pedido)`). Gerada de propósito: se cada tela
  decidisse a regra, cinco telas dariam cinco respostas.
- `coletor/notas-dos-pedidos.mjs` (janela de 7 dias, idempotente) +
  regras puras em `coletor/lib/notas-bling.mjs` com 13 testes.
- `.github/workflows/notas-dos-pedidos.yml` — de hora em hora, aos 23 minutos
  (era diário; ver Etapa 2). Não colide com o Relatórios Comerciais — os dois
  batem no mesmo Bling, que limita 3 chamadas/segundo.
- `bling-proxy` v9: rotas `nfe`/`nfce` liberadas, só leitura.

**Nenhum número de tela mudou nesta etapa.** De propósito.

## Etapa 2 — as telas passarem a usar a data da nota ✔ FEITA

Telas: Gestão à Vista (o telão) e Análise de Vendas. Hoje as duas pedem ao Bling
`pedidos/vendas` por faixa de data do pedido e somam o que vier.

Três caminhos possíveis, do mais barato ao mais definitivo:

**A · Janela alargada.** Buscar no Bling de `início − 30 dias` até `fim`, e
depois manter só os pedidos cuja `data_da_venda` cai na janela pedida.
Simples, mas o telão passa a baixar 30 dias de pedidos para mostrar "hoje" —
e ele já busca sequencial por causa do limite do Bling.

**B · Correção cirúrgica.** Buscar a janela normal (como hoje) e, pela nossa
tabela, (1) tirar os pedidos que saíram desta janela e (2) trazer os poucos que
entraram, buscando esses um a um. Mede-se em unidades: foram 44 pedidos em 30
dias. Rápido, mas espalha regra por duas telas.

**C · Virar a fonte.** As telas passam a ler as vendas do nosso banco (como a
Gestão Comercial já faz com `gc_vendas_item`), e o Bling fica só para o "ao
vivo" de hoje. É a mais trabalhosa e a que deixa tudo mais rápido — leitura do
Supabase não tem limite de 3 por segundo.

**Feito o B**, em `src/compartilhado/data-da-venda.js` (12 testes): a busca no
Bling continua igual e o ajuste acontece depois — sai quem foi faturado noutro
dia, entra quem foi faturado neste. As três janelas da Análise de Vendas e as
duas do telão (atual e anterior) recebem o mesmo tratamento; comparar períodos
com réguas diferentes seria pior que o defeito original.

Duas decisões que seguram a tela de pé:
- **Pedido sem linha nossa fica como está.** O robô roda de hora em hora; um
  pedido feito agora ainda não passou por ele. Sumir com ele seria trocar um
  erro pequeno por um buraco.
- **Banco fora do ar = tela como está hoje, nunca vazia.** `buscarLinhasDaJanela`
  devolve `null` ("não sei") e o chamador mantém o comportamento antigo.

A data original vai junto em `dataDoPedido`, porque a Gestão à Vista grava
`pedido_data` no cache `bling_pedido_vendedor` — gravar ali a data da nota
deixaria a mentira no banco.

O robô passou a rodar **de hora em hora** (era diário): o telão mostra "hoje", e
com rodada diária uma nota emitida hoje de manhã só entraria amanhã.

Guarda de import (pendência B1) instalado nas duas pastas, cobrindo também
`src/compartilhado/` — e **provado** removendo o import de propósito.

O caminho **C** (virar a fonte) continua valendo como melhoria futura de
velocidade, não de correção.

## Etapa 3 — o resto ✔ FEITA

**A regra passou a ter UMA cópia só**, em `supabase/functions/_shared/data-da-venda.js`.
Ela mora ali, e não em `src/`, porque a Edge roda no Deno e não alcança `src/`
nem `coletor/` — mesmo arranjo de `checklist.js` e `rabisco.js`, pelo mesmo
motivo. As telas e os robôs importam de lá.

**Notificação das 22h/07h** (`enviar-push-vendas`): ajusta os dois dias (o de
referência e o de comparação) antes de contar itens — senão um pedido trazido de
outro dia chegaria ao push com zero itens. Segue a regra dura desta Edge: se não
der para saber a data certa, **não envia** (`data_da_venda_indisponivel`), como
já valia para token, Bling fora do ar e itens incompletos.

**Robôs**: o ajuste entrou DENTRO de `blingPedidos` (`coletor/lib/bling-comercial.mjs`),
não em cada robô. São **três** que chamam essa função — `gestor-comercial`,
`relatorios-comerciais` e `atualizar-cards-comercial`, este último descoberto só
ao procurar. Corrigir um a um deixaria o esquecido publicando outro número.

`linhasDaJanela` **lança** quando não consegue ler, de propósito: robô que segue
calado publicaria o número errado num relatório que ninguém confere. A rodada é
diária e o erro aparece no log do Actions.

## O que ainda NÃO foi verificado

As telas **abertas e logadas**. Não dá para Playwright neste projeto (o
navegador de teste entra noutra conta). O que cobre: build, guarda de import, e
os números conferidos contra o banco real.

E a rede da máquina do dono derrubava 1 em cada 5 chamadas ao Supabase no dia
desta entrega — o que fez dois backfills locais caírem pela metade e dois testes
da Fábrica falharem por `fetch failed`. Rodar pelo GitHub Actions contorna.
