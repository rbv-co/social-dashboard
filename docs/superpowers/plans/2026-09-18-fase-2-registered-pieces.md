# Fase 2 do Registered Pieces — plano

**Decidido pelo dono em 18/09/2026.**

Números medidos no banco em 18/09: **212 peças**, **190 gravadas**, **159 com
cartão**, **139 lotes**, **63 SKUs**, **1 peça registrada** por cliente, 799
leituras em 179 peças. (O "157" que circulava era o número de cartões, não de
peças vendidas.)

## O que a Fase 2 entrega

1. **Uma página só.** O `/verify` passa a ser a página completa (a que hoje é a
   `/verify/novo`, feita a partir da demo aprovada): conta, registro estando
   logada, presente, minhas peças e transferência. `/verify/novo` vira
   redirecionamento para `/verify`.
2. **Vale para peça de verdade.** Cai a trava `fora_do_teste` do registro com
   conta e da transferência. Qualquer peça gravada passa a aceitar registro com
   conta e transferência.
3. **Quem já registrou antes das contas entra pelo CPF.** Ao criar a conta, se o
   CPF já for o de um registro existente, aquelas peças passam a ser dela
   (`cliente_id`) e aparecem em "Minhas peças".
4. **Transferência só de quem é dona registrada.** Registro pendente não
   transfere.
5. **Campo de material no painel**, para o lote de SKU que nunca teve lote
   (hoje o material só é herdado do último lote do mesmo SKU).
6. **Acabamento da lista "Onde você comprou"**, que hoje usa a caixa padrão do
   celular.

## O que NÃO entra

"Register Later" (lembrete para registrar depois) e histórico de donas visível
para a cliente.

## Tarefa 1 — banco

- Tirar a conferência de lote `teste` de `vessel_registrar_como_cliente`,
  `vessel_transferencia_gerar` e `vessel_transferencia_aceitar`, **mantendo**
  todas as outras travas (trava da dona, pedido já usado, portão do `'bling'`,
  teto de tentativas).
- `vessel_conta_criar`: ao criar conta, ligar `cliente_id` nos registros cujo
  CPF seja igual ao da conta (e nos pedidos de registro pendentes do mesmo CPF).
  Gravar na trilha.
- Ensaio com `begin`/`rollback` provando: peça de verdade registra estando
  logada; transferência funciona em peça de verdade; a trava da dona continua
  barrando; conta nova com CPF de registro antigo enxerga a peça em "Minhas
  peças"; CPF sem registro não liga nada.
- Aplicar só com autorização do dono.

## Tarefa 2 — site

- `/verify` passa a ser a página completa. Nada do certificado de hoje pode
  sumir: número de série, fotos, Product Details, Authenticity, Ownership,
  Service & Repair, Vessel Care, a regra da garantia por material e a data de
  fim quando existir.
- Tirar o aviso "Ambiente de teste".
- `/verify/novo` responde com redirecionamento para `/verify`.
- Testes com a forma real da resposta e fotos a 375px, com rede fingida (nunca
  abrir peça real em produção: grava leitura).

## Tarefa 3 — painel

- Campo de material no lote (canvas/couro), mostrando de onde veio (`dono`,
  `bling_estrutura`, `painel`, `herdado`), sem chutar quando a estrutura do
  Bling for ambígua.
- Lista "Onde você comprou" com o estilo da casa nas telas da cliente.
