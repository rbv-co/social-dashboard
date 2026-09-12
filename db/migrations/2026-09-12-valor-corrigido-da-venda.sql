-- O valor real de uma venda que o Bling não deixa mais corrigir.
--
-- POR QUE ESTA TABELA EXISTE
-- Em 11/09/2026 o pedido nº 2656 (id 26851358889, canal 205834116 — Iguatemi)
-- foi fechado por R$ 1.900,00 com desconto à vista no Pix de R$ 285,00: entrou
-- R$ 1.615,00. O desconto não foi lançado antes de a NFC-e sair, e **nota
-- autorizada congela o pedido**. Medido no mesmo dia, contra o Bling real:
--
--   * `PUT /pedidos/vendas/{id}` responde **HTTP 200** com o aviso "Esta venda
--     está bloqueada para edição e foi salva parcialmente" e **não grava um
--     campo sequer** (conferido por GET + diff, três vezes);
--   * estornar contas E estornar estoque — que é o destrave documentado pela
--     ajuda do Bling — **não abre**: o PUT segue devolvendo o mesmo aviso;
--   * a tela do Bling fica cinza do mesmo jeito. Não é regra só da API;
--   * a NFC-e 000107/série 5 está autorizada na SEFAZ desde 11/09 20:27. Passou
--     a janela de cancelamento, e carta de correção não muda valor.
--
-- Ou seja: o número errado é imutável na origem. A dashboard lê `total` do
-- pedido ao vivo do Bling, então sem esta tabela o telão da loja mostra para
-- sempre R$ 285,00 a mais no dia 11/09.
--
-- O QUE ESTA MIGRATION NÃO FAZ
-- Não mexe no Bling, na nota, no push de vendas das 22h nem nos relatórios do
-- coletor — esses continuam com o valor original, e está escrito em
-- docs/pendencias.md. Ela cria o lugar onde o valor real passa a morar; quem lê
-- são as duas telas de venda, pelo módulo
-- supabase/functions/_shared/valor-corrigido.js.
--
-- E NÃO É PORTA PARA MAQUIAR NÚMERO: `motivo` é obrigatório, `criado_por` fica
-- gravado, e a escrita é só de super-admin. Uma linha aqui é uma exceção
-- assinada, não um ajuste de meta.

create table if not exists public.bling_pedido_ajuste_valor (
  pedido_id       bigint        primary key,        -- id do pedido no Bling
  loja_id         bigint,                           -- canal, para o escopo por time
  total_corrigido numeric(12,2) not null check (total_corrigido >= 0),
  total_do_bling  numeric(12,2),                    -- o que o ERP diz, para auditoria
  motivo          text          not null check (length(btrim(motivo)) >= 10),
  criado_por      uuid          references auth.users (id),
  criado_em       timestamptz   not null default now()
);

comment on table public.bling_pedido_ajuste_valor is
  'Valor real de vendas que o Bling congelou erradas (nota fiscal autorizada tranca o pedido). Lida pelas telas de venda via supabase/functions/_shared/valor-corrigido.js. Escrita so de super-admin.';
comment on column public.bling_pedido_ajuste_valor.total_corrigido is
  'O valor que de fato entrou. Substitui o total do pedido nas telas de venda.';
comment on column public.bling_pedido_ajuste_valor.total_do_bling is
  'O total que o Bling mostra, guardado para dar para explicar a diferenca depois.';
comment on column public.bling_pedido_ajuste_valor.motivo is
  'Por que a correcao existe. Obrigatorio: linha sem explicacao vira numero sem dono.';

-- loja_id é lido pela política de escopo por time — coluna de RLS sem índice é
-- o jeito clássico de a tela ficar lenta só para quem tem time. Mesma razão do
-- idx_bpn_loja na tabela irmã.
create index if not exists idx_bpav_loja on public.bling_pedido_ajuste_valor (loja_id);

alter table public.bling_pedido_ajuste_valor enable row level security;

-- ── AS TRÊS POLÍTICAS, conferidas contra a irmã bling_pedido_nota ───────────
-- A permissiva sozinha NÃO recorta nada: é a RESTRICTIVE que segura, porque
-- restritiva faz AND com tudo. Tabela nova que sobe só com a permissiva parece
-- instalada e vaza — já aconteceu aqui uma vez, com campaign_adsets.

drop policy if exists bpav_leitura on public.bling_pedido_ajuste_valor;
create policy bpav_leitura on public.bling_pedido_ajuste_valor
  for select to authenticated using (true);

drop policy if exists bpav_so_do_meu_canal on public.bling_pedido_ajuste_valor;
create policy bpav_so_do_meu_canal on public.bling_pedido_ajuste_valor
  as restrictive for select to authenticated
  using (public.pode_ver_canal(loja_id));

-- Escrita só de super-admin. É `superadmin_pela_ficha()` (a COLUNA, que é o que
-- a tela administra), não `is_superadmin()`, que confere e-mail contra uma
-- lista cravada no corpo da função.
drop policy if exists bpav_escrever on public.bling_pedido_ajuste_valor;
create policy bpav_escrever on public.bling_pedido_ajuste_valor
  for all to authenticated
  using (public.superadmin_pela_ficha()) with check (public.superadmin_pela_ficha());
