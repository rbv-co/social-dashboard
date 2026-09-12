-- GUARDAR O MOTIVO QUE A META DÁ — porque a Meta apaga o dela.
--
-- O PROBLEMA (medido em 17/08/2026): o dono relatou uma campanha barrada na
-- semana passada e pediu para eu achá-la. Não deu. A Meta expõe o motivo em
-- `issues_info`, e esse campo **some** quando o anúncio é excluído ou quando o
-- problema é resolvido — não há histórico, nem no Graph nem em lugar nenhum.
-- Das 33 campanhas e 300 anúncios que li da conta Vessel Brasil, os únicos
-- excluídos eram testes de 03/08, e nenhum guardava motivo.
--
-- Ou seja: hoje o motivo existe por um instante e depois deixa de existir. Quem
-- não estava olhando naquele instante nunca mais fica sabendo.
--
-- O QUE ESTA TABELA GUARDA, e por que cada coluna:
--
-- • **O nome da campanha e do anúncio, não só o id.** É a decisão que faz esta
--   tabela servir para alguma coisa: o ponto inteiro é sobreviver ao anúncio ser
--   APAGADO, e um id órfão não diz nada ao dono. Com o nome, a linha continua
--   legível anos depois, mesmo que o objeto não exista mais na Meta.
-- • **`primeira_vez` e `ultima_vez`, e não uma linha por leitura.** A tela vai
--   registrar toda vez que alguém abrir a Gestão de Tráfego. Gravando uma linha
--   por leitura, um problema que dura duas semanas viraria centenas de linhas
--   iguais e a história ficaria ilegível justamente por excesso.
-- • **`resolvido_em`.** "Sumiu da lista" é informação: é assim que se sabe que o
--   conserto funcionou, e quanto tempo o anúncio ficou parado. Sem isso, um
--   problema resolvido fica indistinguível de um problema ativo.
--
-- A chave é (ad_id, codigo): o MESMO anúncio pode ter dois problemas diferentes
-- ao mesmo tempo, e cada um tem a sua vida própria.

create table if not exists public.gt_problemas_meta (
  ad_id           text        not null,
  codigo          integer     not null,
  account_id      text,
  campaign_id     text,
  -- Os nomes: a razão de existir desta tabela. Ver o comentário acima.
  conta_nome      text,
  campanha_nome   text,
  ad_nome         text,
  titulo          text,
  detalhe         text,
  -- 'anuncio' ou 'conjunto' — muda ONDE a pessoa clica para resolver.
  nivel           text,
  -- HARD_ERROR impede de rodar; SOFT_ERROR só limita. A diferença é o que
  -- decide se é urgente.
  grave           boolean     not null default false,
  primeira_vez    timestamptz not null default now(),
  ultima_vez      timestamptz not null default now(),
  resolvido_em    timestamptz,
  primary key (ad_id, codigo)
);

comment on table public.gt_problemas_meta is
  'Historico do que a Meta reclamou de cada anuncio. Existe porque o issues_info '
  'do Graph SOME quando o anuncio e excluido ou o problema e resolvido. Guarda os '
  'NOMES junto com os ids de proposito: a linha precisa continuar legivel depois '
  'que o objeto deixou de existir na Meta.';

-- Ver a história por conta e por campanha é o uso real ("por que aquela campanha
-- parou?"), e o que está aberto vem primeiro.
create index if not exists gt_problemas_meta_conta_idx
  on public.gt_problemas_meta (account_id, resolvido_em, ultima_vez desc);
create index if not exists gt_problemas_meta_campanha_idx
  on public.gt_problemas_meta (campaign_id);

alter table public.gt_problemas_meta enable row level security;

-- LEITURA: o mesmo critério das outras tabelas da Gestão de Tráfego
-- (gt_ad_analises, gt_fila_decisoes) — admin ou quem tem a feature.
create policy gt_problemas_meta_leitura on public.gt_problemas_meta
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and (p.role = 'admin' or 'meta.gestor' = any (p.features))
    )
  );

-- E o recorte por conta, RESTRICTIVE, como nas outras 20 tabelas com account_id.
-- ⚠️ Tabela nova NÃO herda esta política: a migration de 31/07 aplica-a sobre uma
-- lista explícita, de propósito, para que tabela nova entre aqui por decisão de
-- alguém e não por acidente. Sem esta linha, um usuário limitado a uma marca
-- leria os problemas de todas.
create policy so_contas_permitidas on public.gt_problemas_meta
  as restrictive for select to authenticated
  using (public.pode_ver_conta(account_id));

-- NÃO há policy de INSERT/UPDATE de propósito: quem grava é a função abaixo,
-- security definer. Escrita solta aqui deixaria qualquer usuário logado
-- reescrever a história — e história que se reescreve não é história.

-- ── QUEM GRAVA ──────────────────────────────────────────────────────────────
-- A tela chama isto depois de ler os problemas da Meta. Uma chamada por conta,
-- com a lista inteira do momento: o que está na lista é carimbado como visto
-- agora, e o que NÃO está mais é marcado como resolvido.
--
-- POR QUE UMA FUNÇÃO SÓ, e não INSERT do cliente: as duas metades (carimbar o
-- que existe, fechar o que sumiu) precisam acontecer juntas. Separadas, uma
-- falha no meio deixaria problema resolvido parecendo aberto para sempre.
create or replace function public.gt_registrar_problemas(p_conta text, p_itens jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quantos integer := 0;
begin
  if not exists (
    select 1 from public.profiles p
     where p.id = auth.uid()
       and (p.role = 'admin' or 'meta.gestor' = any (p.features))
  ) then
    raise exception 'Sem permissao na Gestao de Trafego.';
  end if;

  if p_conta is null or p_conta = '' then
    raise exception 'Falta dizer de qual conta e a lista.';
  end if;

  -- 1) O que a Meta está reclamando AGORA.
  with entrada as (
    select
      x.ad_id, x.codigo, x.campaign_id, x.conta_nome, x.campanha_nome,
      x.ad_nome, x.titulo, x.detalhe, x.nivel, coalesce(x.grave, false) as grave
    from jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb)) as x(
      ad_id text, codigo integer, campaign_id text, conta_nome text,
      campanha_nome text, ad_nome text, titulo text, detalhe text,
      nivel text, grave boolean
    )
    where x.ad_id is not null and x.codigo is not null
  )
  insert into public.gt_problemas_meta as g (
    ad_id, codigo, account_id, campaign_id, conta_nome, campanha_nome,
    ad_nome, titulo, detalhe, nivel, grave, primeira_vez, ultima_vez, resolvido_em
  )
  select
    e.ad_id, e.codigo, p_conta, e.campaign_id, e.conta_nome, e.campanha_nome,
    e.ad_nome, e.titulo, e.detalhe, e.nivel, e.grave, now(), now(), null
  from entrada e
  on conflict (ad_id, codigo) do update set
    -- `primeira_vez` NUNCA se mexe: é a resposta de "desde quando?".
    ultima_vez    = now(),
    -- Voltou a aparecer depois de resolvido? Então não estava resolvido.
    resolvido_em  = null,
    account_id    = excluded.account_id,
    campaign_id   = coalesce(excluded.campaign_id, g.campaign_id),
    conta_nome    = coalesce(nullif(excluded.conta_nome, ''), g.conta_nome),
    campanha_nome = coalesce(nullif(excluded.campanha_nome, ''), g.campanha_nome),
    ad_nome       = coalesce(nullif(excluded.ad_nome, ''), g.ad_nome),
    titulo        = coalesce(nullif(excluded.titulo, ''), g.titulo),
    detalhe       = coalesce(nullif(excluded.detalhe, ''), g.detalhe),
    nivel         = coalesce(nullif(excluded.nivel, ''), g.nivel),
    grave         = excluded.grave;

  get diagnostics v_quantos = row_count;

  -- 2) O que sumiu da lista desta conta está resolvido.
  update public.gt_problemas_meta g
     set resolvido_em = now()
   where g.account_id = p_conta
     and g.resolvido_em is null
     and not exists (
       select 1
         from jsonb_to_recordset(coalesce(p_itens, '[]'::jsonb)) as x(ad_id text, codigo integer)
        where x.ad_id = g.ad_id and x.codigo = g.codigo
     );

  return v_quantos;
end $$;

comment on function public.gt_registrar_problemas(text, jsonb) is
  'Carimba os problemas que a Meta reclama agora e fecha os que sumiram. Uma '
  'chamada por conta, com a lista inteira do momento. Chamada pela tela de Gestao '
  'de Trafego a cada carregamento.';

revoke execute on function public.gt_registrar_problemas(text, jsonb) from public, anon;
grant  execute on function public.gt_registrar_problemas(text, jsonb) to authenticated;

-- Esta migration se registra sozinha, como manda o acerto de 14/08.
insert into public.schema_migrations (name, observacao)
values ('2026-08-17-guardar-o-motivo-da-meta.sql', 'aplicada pelo MCP')
on conflict (name) do nothing;
