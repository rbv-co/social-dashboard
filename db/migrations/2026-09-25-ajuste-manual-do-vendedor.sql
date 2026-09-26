-- O vendedor certo de uma venda que o Bling não deixa mais corrigir.
--
-- POR QUE ESTA TABELA EXISTE
-- Mesmo problema documentado em 2026-09-12-valor-corrigido-da-venda.sql, só que
-- no campo vendedor em vez de total: nota fiscal autorizada congela o pedido.
-- Quando a NFC/NFe sai com o vendedor certo mas o PEDIDO no Bling ficou com
-- outro vendedor, não dá mais para editar o pedido depois — a tela do Bling
-- trava e a API responde 200 sem gravar (mesmo sintoma do valor).
--
-- A Gestão à Vista e a Análise de Vendas atribuem cada venda pelo vendedor do
-- PEDIDO (`bling_pedido_vendedor`, que é só um espelho do que o Bling devolve),
-- então sem esta tabela o ranking credita a venda para sempre à pessoa errada.
--
-- O QUE ESTA MIGRATION NÃO FAZ
-- Não mexe no Bling nem na nota. Não sobrescreve `bling_pedido_vendedor` — essa
-- tabela continua sendo o espelho fiel do Bling, alimentada pelas telas e pelo
-- coletor como sempre. Esta tabela é lida DEPOIS, por cima, pelo módulo
-- supabase/functions/_shared/vendedor-corrigido.js — mesmo desenho da irmã de
-- valor.
--
-- E NÃO É PORTA PARA MAQUIAR RANKING: `motivo` é obrigatório, `criado_por` fica
-- gravado, e a escrita é só de super-admin. Uma linha aqui é uma exceção
-- assinada, não um ajuste de meta.

create table if not exists public.bling_pedido_ajuste_vendedor (
  pedido_id           bigint        primary key,        -- id do pedido no Bling
  loja_id             bigint,                            -- canal, para o escopo por time
  vendor_id_corrigido bigint        not null,             -- o vendedor de verdade (o da nota)
  vendor_id_do_bling  bigint,                            -- o que o pedido mostra, para auditoria
  motivo              text          not null check (length(btrim(motivo)) >= 10),
  criado_por          uuid          references auth.users (id),
  criado_em           timestamptz   not null default now()
);

comment on table public.bling_pedido_ajuste_vendedor is
  'Vendedor real de vendas cujo pedido o Bling congelou errado (nota fiscal autorizada tranca o pedido). Lida pelas telas de venda via supabase/functions/_shared/vendedor-corrigido.js. Escrita so de super-admin.';
comment on column public.bling_pedido_ajuste_vendedor.vendor_id_corrigido is
  'O vendedor que de fato fechou a venda (o da nota fiscal). Substitui o vendedor do pedido nas telas de venda.';
comment on column public.bling_pedido_ajuste_vendedor.vendor_id_do_bling is
  'O vendedor que o pedido do Bling mostra, guardado para dar para explicar a diferenca depois.';
comment on column public.bling_pedido_ajuste_vendedor.motivo is
  'Por que a correcao existe. Obrigatorio: linha sem explicacao vira numero sem dono.';

-- loja_id é lido pela política de escopo por time — coluna de RLS sem índice é
-- o jeito clássico de a tela ficar lenta só para quem tem time. Mesma razão da
-- irmã de valor (idx_bpav_loja).
create index if not exists idx_bpaven_loja on public.bling_pedido_ajuste_vendedor (loja_id);

alter table public.bling_pedido_ajuste_vendedor enable row level security;

-- ── AS TRÊS POLÍTICAS, conferidas contra a irmã bling_pedido_ajuste_valor ───
-- A permissiva sozinha NÃO recorta nada: é a RESTRICTIVE que segura, porque
-- restritiva faz AND com tudo.

drop policy if exists bpaven_leitura on public.bling_pedido_ajuste_vendedor;
create policy bpaven_leitura on public.bling_pedido_ajuste_vendedor
  for select to authenticated using (true);

drop policy if exists bpaven_so_do_meu_canal on public.bling_pedido_ajuste_vendedor;
create policy bpaven_so_do_meu_canal on public.bling_pedido_ajuste_vendedor
  as restrictive for select to authenticated
  using (public.pode_ver_canal(loja_id));

-- Escrita só de super-admin. É `superadmin_pela_ficha()` (a COLUNA, que é o que
-- a tela administra), não `is_superadmin()`, que confere e-mail contra uma
-- lista cravada no corpo da função.
drop policy if exists bpaven_escrever on public.bling_pedido_ajuste_vendedor;
create policy bpaven_escrever on public.bling_pedido_ajuste_vendedor
  for all to authenticated
  using (public.superadmin_pela_ficha()) with check (public.superadmin_pela_ficha());
