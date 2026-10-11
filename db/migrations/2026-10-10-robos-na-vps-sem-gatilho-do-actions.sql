-- ROBÔS NA VPS: O BANCO PARA DE ACORDAR O GITHUB ACTIONS.
--
-- Fotos do selo e Cartões EAN saíram do Actions para a VPS (#336, #339). Mas dois gatilhos do banco continuavam, a cada
-- lote ou pedido novo, chamando uma edge (`vessel-fotos-trigger`, `vessel-cartoes-trigger`) que dispara o workflow no
-- GitHub (`workflow_dispatch`). Hoje o Actions recusa por pagamento; quando a cobrança voltar, cada lote e cada pedido
-- passaria a rodar o robô DUAS vezes (VPS + Actions), com minuto pago, empurrando para o mesmo repositório do site.
--
-- Não perde nada: a VPS pega lote novo em até 5 min (fotos-do-selo, cron) e pedido de cartão em até 10 s (serviço
-- cartoes-ean, que olha a fila).
--
-- Para desfazer: os dois CREATE TRIGGER estão em /root/backups/revisao-core/20261010-plano06-gatilhos-do-actions.sql
-- (as funções ficam; só os gatilhos saem).
drop trigger if exists vessel_lote_novo_pede_foto on public.vessel_lotes;
drop trigger if exists vessel_cartao_pedido_novo_acorda_o_robo on public.vessel_cartao_pedidos;
