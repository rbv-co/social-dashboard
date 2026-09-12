-- Solta o CHECK de push_preferencias.tipo pra aceitar 'frota_reserva'.
--
-- POR QUE ESTA MIGRATION EXISTE: o tipo novo foi acrescentado ao array
-- TIPOS_DE_NOTIFICACAO em supabase/functions/_shared/notificacoes.js, o que já
-- basta pra "Resposta do pedido de carro" aparecer sozinho em Administração ›
-- Usuários (a tela lê o array direto). Mas sem esta migration o CHECK antigo
-- barra o INSERT, e o dono leva um erro de restrição do Postgres na cara ao
-- clicar no interruptor — sem nada na mensagem que aponte pra cá. Já aconteceu
-- duas vezes, com 'conteudo' e com 'frota' (ver a 030, mesmo defeito).
--
-- CONFERIDO ANTES DE ESCREVER (medido, não suposto), em 20/08/2026: a tabela
-- só tem linhas de 'vendas' (18), 'saldo' (18), 'conteudo' (13) e 'frota' (11)
-- — nenhuma de outro tipo, então ampliar a lista não viola dado nenhum já
-- gravado.
--   node coletor/consultar.mjs "select tipo, count(*) from public.push_preferencias group by tipo order by tipo"

alter table public.push_preferencias drop constraint if exists push_preferencias_tipo_check;
alter table public.push_preferencias add constraint push_preferencias_tipo_check
  check (tipo in ('vendas', 'saldo', 'conteudo', 'frota', 'frota_reserva'));
