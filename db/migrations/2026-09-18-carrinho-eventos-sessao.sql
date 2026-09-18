-- db/migrations/2026-09-18-carrinho-eventos-sessao.sql
--
-- ID de sessão de verdade, ponta a ponta: usa o cookie `_shopify_s` que a
-- própria Shopify já grava em QUALQUER visita, antes de qualquer ação de
-- carrinho (confirmado ao vivo, 18/09/2026 — presente numa visita nova, sem
-- cookie nenhum antes). Evento novo `sessao_iniciada` dispara uma vez por
-- sessão, na entrada — cart_token ainda não existe nesse momento (só nasce
-- na primeira ação de carrinho), por isso deixa de ser obrigatório.
--
-- "Sessão encerrada" NÃO é um evento — não existe evento de saída confiável
-- num site de várias páginas (pagehide dispara em toda troca de página, não
-- só ao sair do site). Continua sendo inferido por inatividade, do mesmo
-- jeito que carrinho_abandonados já faz.
alter table public.carrinho_eventos
  alter column cart_token drop not null,
  add column if not exists session_id text;

alter table public.carrinho_eventos drop constraint if exists carrinho_eventos_tipo_check;
alter table public.carrinho_eventos add constraint carrinho_eventos_tipo_check
  check (tipo in (
    'produto_adicionado', 'produto_removido', 'checkout_iniciado', 'sessao_iniciada'
  ));

create index if not exists carrinho_eventos_session_id_criado_em_idx
  on public.carrinho_eventos (session_id, criado_em);
