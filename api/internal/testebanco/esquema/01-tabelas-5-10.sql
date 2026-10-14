-- FATIA 5.10 do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1, 5.9-1 e 5.10-4). Carrega
-- depois de 01-tabelas-5-01.sql (usuarios, profiles). As 11 tabelas com a policy is_vessel_admin() do catálogo
-- e vessel_cartao_arquivos (lida por POST /vessel-baixar-cartao), das migrations; FKs de auth.users não há.
-- PRESUMIDAS (sem DDL no repositório: existem em produção, a função vessel_decidir_pedido_de_registro as grava e
-- a edge vessel-espelhar-lista as lê): vessel_registros.nascimento e vessel_registros.bling_atualizado_em.
-- NÃO declaradas aqui: vessel_lista_espera e vessel_pedidos (5.11: vessel_data_da_compra lê vessel_pedidos só
-- quando há número de pedido do Bling sem data — os testes do 5.10 dão a data), acessos_conexoes (5.4). Os 6
-- gatilhos vivos e as 35 funções vão VERBATIM em 03-funcoes-5-10.sql.

-- db/migrations/2026-08-04-vessel-verify.sql:19-28 + 2026-08-04-vessel-verify-fotos.sql:11
-- + 2026-09-04-vessel-lote-ganha-numero-da-os.sql:8 + 2026-09-17-vessel-lote-de-teste.sql:44-45,53-54
-- + 2026-09-18-zz-vessel-garantia-pelo-material.sql:54-76
create table public.vessel_lotes (
  id             uuid primary key default gen_random_uuid(),
  modelo         text not null,
  cor            text,
  sku            text,
  quantidade     int  not null,
  fabricado_em   date not null default current_date,
  criado_por     uuid,
  criado_em      timestamptz not null default now(),
  fotos          text[],
  os             text,
  teste          boolean not null default false,
  material       text,
  material_fonte text,
  constraint vessel_lotes_material_check check (material is null or material in ('canvas', 'couro')),
  constraint vessel_lotes_material_fonte_check
    check (material_fonte is null or material_fonte in ('dono', 'bling_estrutura', 'painel', 'herdado')),
  constraint vessel_lotes_material_com_fonte_check check (material is not null or material_fonte is null)
);
create index vessel_lotes_teste_idx on public.vessel_lotes (teste) where teste;

-- 2026-08-04-vessel-verify.sql:30-36 + 2026-09-11-vessel-cartoes-fila-e-trava.sql:32-33
create table public.vessel_pecas (
  codigo           text primary key,
  lote_id          uuid references public.vessel_lotes(id) on delete cascade,
  numero_na_serie  int  not null,
  gravada_em       timestamptz,
  criado_em        timestamptz not null default now(),
  cartao_gerado_em timestamptz
);

-- 2026-09-17-vessel-contas-base.sql:18-34
create table public.vessel_clientes (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null,
  cpf                 text not null unique,
  email               text not null unique,
  whatsapp            text,
  nascimento          date,
  cidade              text,
  senha_hash          text not null,
  senha_trocada_em    timestamptz,
  email_confirmado_em timestamptz,
  bling_contato_id    bigint,
  pessoa_id           bigint,
  teste               boolean not null default false,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

-- 2026-09-03-zz-vessel-garantia-com-dono.sql:93-123 + 2026-09-16-zz-vessel-abrir-pedido-com-nascimento.sql:53-54
-- + 2026-09-17-vessel-registro-com-conta.sql:17-19
create table public.vessel_pedidos_de_registro (
  id               uuid primary key default gen_random_uuid(),
  codigo           text not null references public.vessel_pecas(codigo) on delete cascade,
  nome             text not null,
  cpf              text not null,
  whatsapp         text not null,
  onde_comprou     text,
  comprado_em      date,
  estado           text not null default 'pendente' check (estado in ('pendente', 'aprovado', 'recusado')),
  decidido_por_que text check (decidido_por_que in ('bling', 'na_mao')),
  conferencia      jsonb,
  criado_em        timestamptz not null default now(),
  decidido_em      timestamptz,
  decidido_quem    uuid,
  motivo           text,
  nascimento       date,
  cliente_id       uuid references public.vessel_clientes(id),
  presente_de_nome text
);
create index vessel_pedidos_registro_codigo_idx on public.vessel_pedidos_de_registro (codigo, criado_em desc);
create index vessel_pedidos_registro_pendente_idx on public.vessel_pedidos_de_registro (criado_em) where estado = 'pendente';

-- 2026-08-04-vessel-verify.sql:43-51 + 2026-09-03-zz-vessel-garantia-com-dono.sql:137-141
-- + 2026-09-17-vessel-registro-com-conta.sql:15-16 + 2026-09-18-zz-vessel-garantia-pelo-material.sql:96
-- + PRESUMIDAS: nascimento, bling_atualizado_em (ver o cabeçalho)
create table public.vessel_registros (
  codigo              text primary key references public.vessel_pecas(codigo) on delete cascade,
  nome                text not null,
  whatsapp            text not null,
  onde_comprou        text,
  comprado_em         date,
  garantia_ate        date,
  registrado_em       timestamptz not null default now(),
  cpf                 text,
  pedido_id           uuid references public.vessel_pedidos_de_registro(id),
  bling_contato_id    text,
  bling_pedido        text,
  cliente_id          uuid references public.vessel_clientes(id),
  nascimento          date,
  bling_atualizado_em timestamptz
);

-- 2026-08-04-vessel-verify.sql:53-62
create table public.vessel_leituras (
  id       bigserial primary key,
  codigo   text not null,
  achou    boolean not null,
  agente   text,
  ip_hash  text,
  lido_em  timestamptz not null default now()
);
create index vessel_leituras_codigo_idx on public.vessel_leituras (codigo, lido_em desc);

-- 2026-08-30-vessel-baixas.sql:15-30 + 2026-09-01-vessel-editar-etiquetas.sql:324-338 (o motivo 'teste')
create table public.vessel_baixas (
  id           uuid primary key default gen_random_uuid(),
  codigo       text not null references public.vessel_pecas(codigo) on delete cascade,
  motivo       text not null constraint vessel_baixas_motivo_check
               check (motivo in ('extraviada', 'defeito', 'devolvida', 'etiqueta_perdida', 'teste')),
  baixada_em   timestamptz not null default now(),
  baixada_por  uuid,
  desfeita_em  timestamptz,
  desfeita_por uuid
);
create index vessel_baixas_codigo_idx on public.vessel_baixas (codigo);
create unique index vessel_baixas_ativa_idx on public.vessel_baixas (codigo) where desfeita_em is null;

-- 2026-09-01-vessel-editar-etiquetas.sql:46-59 + a lista de ações de 2026-09-19-zz-vessel-trilha-a-lista-inteira.sql:28-37
-- (a última a redefinir o check; a trilha não tem FK de propósito: sobrevive à peça excluída)
create table public.vessel_edicoes (
  id        uuid primary key default gen_random_uuid(),
  codigo    text not null,
  acao      text not null constraint vessel_edicoes_acao_check check (acao = any (array[
              'desmarcar_gravada', 'sobrescrever_para_fila', 'sobrescrever_para_baixa',
              'registro_aprovado', 'registro_recusado', 'dono_trocado', 'baixar_garantia',
              'lote_excluido', 'peca_excluida', 'etiqueta_adotada', 'numero_trocado',
              'transferida_pela_dona', 'material_do_lote', 'conta_ligada_pelo_cpf'])),
  motivo    text,
  detalhes  jsonb not null default '{}'::jsonb,
  feito_por uuid,
  feito_em  timestamptz not null default now()
);
create index vessel_edicoes_codigo_idx on public.vessel_edicoes (codigo, feito_em desc);

-- 2026-09-05-vessel-garantias-baixadas.sql:38-53
create table public.vessel_garantias_baixadas (
  id               bigint generated always as identity primary key,
  codigo           text not null,
  nome             text,
  whatsapp         text,
  cpf              text,
  onde_comprou     text,
  comprado_em      date,
  garantia_ate     date,
  registrado_em    timestamptz,
  bling_contato_id text,
  bling_pedido     text,
  motivo           text not null,
  baixada_em       timestamptz not null default now(),
  baixada_por      uuid
);

-- 2026-09-11-vessel-cartoes-fila-e-trava.sql:39-70
create table public.vessel_cartao_pedidos (
  id          uuid primary key default gen_random_uuid(),
  pecas       text[] not null,
  situacao    text not null default 'na_fila' check (situacao in ('na_fila', 'rodando', 'pronto', 'falhou')),
  pasta       text,
  erro        text,
  criado_por  uuid,
  criado_em   timestamptz not null default now(),
  comecou_em  timestamptz,
  terminou_em timestamptz
);
create index vessel_cartao_pedidos_recentes on public.vessel_cartao_pedidos (criado_em desc);
create index vessel_cartao_pedidos_na_fila on public.vessel_cartao_pedidos (criado_em) where situacao in ('na_fila', 'rodando');

-- 2026-10-09-vessel-cartao-arquivos.sql:17-24 (fora do catálogo: só o robô grava e a rota do cartão lê)
create table public.vessel_cartao_arquivos (
  codigo        text not null,
  nome          text not null,
  zoho_id       text not null,
  pasta_id      text,
  atualizado_em timestamptz not null default now(),
  primary key (codigo, nome)
);

-- 2026-09-19-zzz-vessel-lembretes-register-later.sql:66-135
create table public.vessel_lembretes (
  id               uuid primary key default gen_random_uuid(),
  peca_codigo      text not null,
  email            text not null,
  cliente_id       uuid references public.vessel_clientes(id),
  consentimento_em timestamptz not null,
  criado_em        timestamptz not null default now(),
  enviado_7_em     timestamptz,
  enviado_30_em    timestamptz,
  cancelado_em     timestamptz,
  cancelado_por    text,
  token_hash       text,
  constraint vessel_lembretes_codigo_normalizado_check
    check (peca_codigo = upper(regexp_replace(peca_codigo, '[\s.\-_]', '', 'g'))),
  constraint vessel_lembretes_email_normalizado_check check (email = lower(btrim(email)) and email <> ''),
  constraint vessel_lembretes_cancelamento_check check ((cancelado_em is null) = (cancelado_por is null)),
  constraint vessel_lembretes_cancelado_por_check check (cancelado_por is null or cancelado_por in ('cliente', 'registro'))
);
create unique index vessel_lembretes_um_aberto_idx on public.vessel_lembretes (peca_codigo)
  where cancelado_em is null and enviado_30_em is null;
create index vessel_lembretes_peca_idx on public.vessel_lembretes (peca_codigo, criado_em desc);
create index vessel_lembretes_email_idx on public.vessel_lembretes (email, criado_em desc);
create index vessel_lembretes_token_idx on public.vessel_lembretes (token_hash) where token_hash is not null;
