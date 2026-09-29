-- Remove o funil de carrinho (antes do checkout).
-- Decisão do dono, 29/09/2026: centralizar no checkout e não guardar dado de carrinho anônimo.
--
-- O script do tema (interceptador) e a Edge Function capturar-evento-carrinho já saíram do ar.
-- Esta migration é idempotente: em produção o conteúdo abaixo já foi aplicado à mão em 29/09/2026
-- (45 linhas de carrinho apagadas: produto_adicionado=36, produto_removido=2, sessao_iniciada=7).
--
-- checkout_iniciado FICA: vem do webhook nativo checkouts/create (receber-webhook-checkout)
-- e a tela Meta Ads > Base de Leads lê dele. As migrations antigas não são alteradas.

delete from public.carrinho_eventos
where tipo in ('produto_adicionado', 'produto_removido', 'sessao_iniciada');

drop view if exists public.carrinho_abandonados;
