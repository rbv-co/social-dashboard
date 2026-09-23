-- O DESCONTO DO ITEM ESTAVA SENDO CONTADO DUAS VEZES
--
-- O QUE APARECEU (22/09/2026, conferindo o Log de caroços): em 116 dos 464
-- pedidos de venda, a soma dos itens não fechava com a cabeça do pedido —
-- R$ 10.028,94 de diferença. O maior: pedido 2649 (CALÇADOS SODRÉ), nota de
-- R$ 1.263,25 contra R$ 338,98 nos nove itens.
--
-- ── O QUE O BLING RESPONDE, LIDO NA API ─────────────────────────────────────
--
--   pedido 2649: total 1263.25 · totalProdutos 1263.25 · desconto do PEDIDO: 0
--                item LV1185  qtd=5  valor=29.70  desconto=84.36
--   pedido 2130: total  224.95 · totalProdutos  224.95 · desconto do PEDIDO: 0
--                item LV1054  qtd=1  valor=224.95  desconto=50
--
-- O total do Bling é `qtd × valor`, SEM tocar no desconto do item — as nove
-- linhas do 2649 somam exatamente 1.263,25. E a NF-e saiu por esse mesmo valor
-- em 116 de 116 pedidos.
--
-- ⚠️ `desconto` É PORCENTAGEM MESMO — o comentário antigo do coletor acertava
-- nisso. O erro é outro, e mais sutil: **`valor` JÁ VEM COM O DESCONTO
-- APLICADO**. O coletor aplicava a porcentagem de novo, sobre um preço que já
-- era o de venda, e inventava um desconto que nunca existiu.
--
-- ── COMO SE PROVA QUAL É A FÓRMULA ──────────────────────────────────────────
--
-- Nos 171 itens com desconto, duas hipóteses, contadas:
--   A) `valor` é o preço COBRADO  → tabela = valor / (1 - pct/100) ....... 105
--   B) `desconto` é o valor abatido → tabela = valor + pct ................... 0
-- (quantos caem num preço de varejo de verdade, terminado em ,90 ou ,00)
--
-- A hipótese A reproduz o preço de tabela na bico: 224,95 a 50% → 449,90;
-- 244,95 a 50% → 489,90; 29,70 a 9,09% → 32,67; 331,42 a 15% → 389,91. A
-- hipótese B não acerta um. Os 66 que não terminam em ,90 são atacado, onde o
-- preço de tabela não é preço de varejo — e nem por isso a conta muda.
--
-- ── O QUE ESTA MIGRATION FAZ ────────────────────────────────────────────────
--
-- Guarda o PREÇO DE TABELA do item, que é a informação que a porcentagem estava
-- tentando dizer e que hoje não existe em lugar nenhum. Com ela dá para
-- responder "quanto de desconto a gente deu" sem refazer a conta em cada tela —
-- e sem confundir de novo o preço cheio com o preço cobrado.
--
-- ⚠️ NÃO EXISTE `update` AQUI, DE PROPÓSITO. O robô `trazer-pedidos-do-bling`
-- REFAZ os itens de cada pedido a cada rodada (`delete` + `insert`), então os
-- 116 pedidos se consertam sozinhos na próxima passagem, com o valor vindo do
-- Bling em vez de uma conta minha por cima de dado velho. Escrever número em
-- cima de venda real, aqui, seria arriscar o dobro para ganhar uma hora.

alter table public.vessel_pedido_itens
  add column if not exists preco_de_tabela numeric;

comment on column public.vessel_pedido_itens.valor_unitario is
  'O preco COBRADO por unidade, como o Bling devolve em `itens[].valor`. Ja vem '
  'com o desconto aplicado — nao aplicar `desconto_percentual` por cima dele.';

comment on column public.vessel_pedido_itens.desconto_percentual is
  'A porcentagem de desconto que o Bling informa em `itens[].desconto`. E so '
  'INFORMATIVA: o desconto ja esta dentro de `valor_unitario` e o total do '
  'pedido no Bling nao a aplica. Ate 22/09/2026 o coletor a descontava de novo.';

comment on column public.vessel_pedido_itens.preco_de_tabela is
  'Preco cheio por unidade, antes do desconto: valor_unitario / (1 - pct/100). '
  'Quando nao ha desconto, e igual ao valor_unitario. Serve para responder '
  '"quanto de desconto foi dado" — nunca para somar receita.';

comment on column public.vessel_pedido_itens.total_do_item is
  'quantidade x valor_unitario, o mesmo que o Bling poe em totalProdutos. '
  'E o dinheiro da nota.';
