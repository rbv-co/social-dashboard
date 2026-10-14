-- FATIA 5.3 (Frota) do esquema de produção para os testes (D0 reconstruído: Rulings 5.1-1 e 5.3-1).
-- Carregada depois de 01-tabelas-5-01.sql e 01-tabelas-5-02.sql (ordem do nome): usa public.usuarios
-- (migrações da API), acessos_pessoas (5.1) e patrimonio_bens/_empresas/_locais/_comodos (5.2).
-- frota_veiculos e frota_uso entram MÍNIMAS no 5.2 (o que os gatilhos do bem e do carro leem e gravam):
-- aqui são COMPLETADAS com `alter table ... add column`, sem recriar. Por isso as colunas completadas vêm
-- DEPOIS das do 5.2 (em produção a ordem é a das migrations); nenhum código lê por posição.
-- Colunas na ordem em que as migrations as criaram; FKs de auth.users viram public.usuarios, como no
-- dump limpo (ops/migracao/limpar-dump.mjs:64). As outras 12 tabelas frota_* são declaradas SÓ aqui.
-- Sem RLS, sem sementes (as linhas de plano, itens e config de 022/028 são dados, não esquema) e sem os
-- índices não únicos: nada disso muda o que um gatilho ou uma rota faz. Os índices únicos ficam: são regra.
-- Os gatilhos e as funções vêm verbatim do levantamento (02-gatilhos.sql, gerado).
-- A linha abaixo é lida por gerar-gatilhos.mjs: estas funções (RPCs que nenhum gatilho chama) entram verbatim.
-- funções: etiqueta_quem_e, frota_corrente_do_veiculo

-- db/migrations/acessos/022_frota.sql:18-49 (as colunas que o 5.2 não trouxe) + 025_frota_veiculo_completo.sql:8-15
-- + 026_frota_contato.sql:7-12 + 027_frota_oficina.sql:8-10 + 034_arvore_local_universal.sql:33-36
alter table public.frota_veiculos
  add column ano                 int,
  add column cor                 text,
  add column combustivel         text,
  add column renavam             text,
  add column chassi              text,
  add column tipo_oleo           text,
  add column contrato            text,
  add column codigo_patrimonial  text,
  add column aluguel_centavos    bigint,
  add column categoria_comercial text,
  add column blindado            boolean not null default false,
  add column local_texto         text,
  add column observacao          text,
  add column seguro_seguradora   text,
  add column seguro_apolice      text,
  add column seguro_vence_em     date,
  add column seguro_valor_centavos bigint,
  add column tag_pedagio         text,
  add column rastreador          text,
  add column contato_nome        text,
  add column contato_telefone    text,
  add column contato_papel       text,
  add column oficina_nome        text,
  add column oficina_telefone    text,
  add column empresa_id          uuid references public.patrimonio_empresas(id) on delete set null,
  add column local_id            uuid references public.patrimonio_locais(id) on delete set null,
  add column comodo_id           uuid references public.patrimonio_comodos(id) on delete set null;

-- 028_frota_checklist.sql:24-33 + 044_frota_checklist_impede_uso.sql:21-22
create table public.frota_checklist_itens (
  id         uuid primary key default gen_random_uuid(),
  ordem      int not null default 0,
  item       text not null unique,
  cadencia   text not null check (cadencia in ('diario','semanal','mensal')),
  ativo      boolean not null default true,
  observacao text,
  impede_uso boolean not null default false
);

-- 028_frota_checklist.sql:43-48 (a linha única id = true)
create table public.frota_checklist_config (
  id            boolean primary key default true check (id),
  dia_semanal   int not null default 5 check (dia_semanal between 1 and 5),
  semana_mensal int not null default 1 check (semana_mensal between 1 and 4),
  dia_mensal    int not null default 3 check (dia_mensal between 1 and 5)
);

-- 028_frota_checklist.sql:52-75 + 032_frota_checklist_assinatura.sql:9-19 + 037_frota_checklist_rabisco.sql:26-38
create table public.frota_checklist (
  id                       uuid primary key default gen_random_uuid(),
  veiculo_id               uuid not null references public.frota_veiculos(id) on delete cascade,
  pessoa_id                uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome              text,
  feita_em                 date not null,
  cadencias                text[] not null default '{diario}',
  hodometro                int not null check (hodometro > 0),
  hodometro_justificativa  text,
  resultado                text not null default 'liberado' check (resultado in ('liberado','com_ressalvas','nao_liberado')),
  anomalias                text,
  criada_em                timestamptz not null default now(),
  criada_por               uuid references public.usuarios(id) on delete set null,
  aberta_em                timestamptz,
  assinada_em              timestamptz,
  assinada_por             uuid references public.usuarios(id) on delete set null,
  assinatura_hash          text,
  assinatura_hash_anterior text,
  sem_assinatura_motivo    text,
  assinatura_rabisco       jsonb,
  assinatura_versao        smallint,
  unique (veiculo_id, feita_em)
);

-- 028_frota_checklist.sql:79-91 + 032_frota_checklist_assinatura.sql:32-33 + 035_frota_resposta_ordem_unica.sql:43-44
create table public.frota_checklist_respostas (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.frota_checklist(id) on delete cascade,
  item_id      uuid references public.frota_checklist_itens(id) on delete set null,
  item_texto   text not null,
  cadencia     text not null,
  estado       text not null check (estado in ('ok','nao_ok','na')),
  observacao   text,
  ordem        int not null default 0
);
create unique index frota_resposta_ordem_unica on public.frota_checklist_respostas (checklist_id, ordem);

-- 036_frota_checklist_pdf.sql:30-54
create table public.frota_checklist_pdf (
  id           uuid primary key default gen_random_uuid(),
  checklist_id uuid not null references public.frota_checklist(id) on delete cascade,
  situacao     text not null default 'na_fila' check (situacao in ('na_fila','enviando','enviado','falhou')),
  tentativas   int not null default 0,
  ultimo_erro  text,
  tentado_em   timestamptz,
  zoho_file_id text,
  criado_em    timestamptz not null default now(),
  enviado_em   timestamptz,
  unique (checklist_id)
);

-- frota_uso (do 5.2, mínima): 022_frota.sql:58-91 (o que faltava: pessoa_nome, km, destino, finalidade, tanque,
-- observação, criado_em e os checks) + 046_frota_aceite_de_retirada.sql:45 (a FK de aceite_checklist_id, que o 5.2
-- deixou sem porque frota_checklist é daqui). 028_frota_checklist.sql:14-20 (tipo_valido) e 022:78-79 (volta_depois).
alter table public.frota_uso
  add column pessoa_nome    text,
  add column km_saida       int,
  add column km_volta       int,
  add column destino        text,
  add column finalidade     text,
  add column tanque_quartos int check (tanque_quartos between 0 and 4),
  add column observacao     text,
  add column criado_em      timestamptz not null default now(),
  add constraint frota_uso_aceite_checklist_id_fkey foreign key (aceite_checklist_id) references public.frota_checklist(id) on delete set null,
  add constraint frota_uso_volta_depois check (volta_em is null or volta_em >= saida_em),
  add constraint frota_uso_km_cresce check (km_volta is null or km_saida is null or km_volta >= km_saida),
  add constraint frota_uso_tipo_valido check (tipo in ('viagem','posse'));
-- "um carro, uma saída aberta": a trava da concorrência (022_frota.sql:88-89)
create unique index uniq_frota_uso_um_aberto on public.frota_uso (veiculo_id) where volta_em is null;

-- db/migrations/2026-08-18-fila-do-pdf-do-aceite.sql:17-30
create table public.frota_uso_pdf (
  id           uuid primary key default gen_random_uuid(),
  uso_id       uuid not null unique references public.frota_uso(id) on delete cascade,
  situacao     text not null default 'na_fila' check (situacao in ('na_fila','enviando','enviado','falhou')),
  tentativas   integer not null default 0,
  ultimo_erro  text,
  tentado_em   timestamptz,
  zoho_file_id text,
  criado_em    timestamptz not null default now(),
  enviado_em   timestamptz
);

-- 023_frota_requisicoes.sql:14-38 + 045_frota_reserva_editar_cancelar_revogar.sql:44-59 + 047_frota_reserva_arquivar.sql:41-43
create table public.frota_requisicoes (
  id                 uuid primary key default gen_random_uuid(),
  veiculo_id         uuid not null references public.frota_veiculos(id) on delete cascade,
  pessoa_id          uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome        text,
  departamento       text,
  destino            text,
  finalidade         text,
  retirada_prevista  timestamptz not null,
  devolucao_prevista timestamptz,
  situacao           text not null default 'pendente',
  criada_por         uuid references public.usuarios(id) on delete set null,
  criada_em          timestamptz not null default now(),
  decidida_por       uuid references public.usuarios(id) on delete set null,
  decidida_em        timestamptz,
  motivo_decisao     text,
  uso_id             uuid references public.frota_uso(id) on delete set null,
  observacao         text,
  encerrada_por      uuid references public.usuarios(id) on delete set null,
  encerrada_em       timestamptz,
  encerrada_motivo   text,
  arquivada_em       timestamptz,
  arquivada_por      uuid references public.usuarios(id),
  constraint frota_req_volta_depois check (devolucao_prevista is null or devolucao_prevista > retirada_prevista),
  constraint frota_requisicoes_situacao_check check (situacao in ('pendente','aprovada','recusada','cancelada','revogada','usada'))
);

-- 045_frota_reserva_editar_cancelar_revogar.sql:65-77 (só o gatilho escreve)
create table public.frota_requisicoes_historico (
  id            uuid primary key default gen_random_uuid(),
  requisicao_id uuid not null references public.frota_requisicoes(id) on delete cascade,
  campo         text not null,
  de            text,
  para          text,
  motivo        text,
  quem          uuid references public.usuarios(id) on delete set null,
  quando        timestamptz not null default now()
);

-- 022_frota.sql:93-99 + 024_frota_revisoes.sql:27
create table public.frota_plano_revisao (
  id         uuid primary key default gen_random_uuid(),
  item       text not null unique,
  a_cada_km  int not null check (a_cada_km > 0),
  ordem      int not null default 0,
  ativo      boolean not null default true,
  observacao text
);

-- 041_frota_manutencao.sql:15-32
create table public.frota_manutencoes (
  id             uuid primary key default gen_random_uuid(),
  veiculo_id     uuid not null references public.frota_veiculos(id) on delete cascade,
  km             int not null check (km >= 0),
  feita_em       date,
  oficina        text,
  total_centavos bigint,
  observacao     text,
  criada_em      timestamptz not null default now(),
  criada_por     uuid references public.usuarios(id) on delete set null
);

-- 024_frota_revisoes.sql:9-23 + 041_frota_manutencao.sql:40-42
create table public.frota_revisoes (
  id             uuid primary key default gen_random_uuid(),
  veiculo_id     uuid not null references public.frota_veiculos(id) on delete cascade,
  item           text not null,
  km             int check (km >= 0),
  feita_em       date,
  oficina        text,
  custo_centavos bigint,
  observacao     text,
  criada_em      timestamptz not null default now(),
  criada_por     uuid references public.usuarios(id) on delete set null,
  manutencao_id  uuid references public.frota_manutencoes(id) on delete cascade
);

-- 056_frota_abastecimentos.sql:6-29
create table public.frota_abastecimentos (
  id             uuid primary key default gen_random_uuid(),
  veiculo_id     uuid not null references public.frota_veiculos(id) on delete cascade,
  pessoa_id      uuid references public.acessos_pessoas(id) on delete set null,
  pessoa_nome    text,
  abastecido_em  timestamptz not null default now(),
  km             integer not null,
  litros         numeric(7,3) not null,
  total_centavos integer not null,
  tanque_depois  smallint not null,
  combustivel    text not null,
  posto          text,
  observacao     text,
  criado_em      timestamptz not null default now(),
  criado_por     uuid,
  constraint frota_abast_km_positivo check (km > 0),
  constraint frota_abast_litros_positivo check (litros > 0),
  constraint frota_abast_total_positivo check (total_centavos > 0),
  constraint frota_abast_tanque_valido check (tanque_depois between 0 and 4)
);
