-- db/migrations/2026-09-24-chatwoot-eventos.sql
--
-- Lead novo / lead quente vindos do Chatwoot (Custom::CrmEventWebhookService,
-- do lado de lá) — alimenta Leads Gerados/Leads Quentes do OPR
-- (src/ferramentas/meta-ads/relatorio-diario-opr.js), que hoje usa a ação
-- de "conversa iniciada" da própria Meta (imprecisa: conta conversa que o
-- anúncio abriu, não conversa que chegou de verdade na caixa do Chatwoot).
-- Gravada crua pela Edge Function receber-webhook-chatwoot (chave de
-- serviço) — ver docs/superpowers/specs/2026-09-24-chatwoot-leads-design.md.
create table public.chatwoot_eventos (
  id                       bigint generated always as identity primary key,
  tipo                     text not null check (tipo in ('lead_novo', 'lead_quente')),
  chatwoot_account_id      integer,
  conversation_id          bigint not null,
  conversation_display_id  bigint,
  contact_id               bigint,
  contact_name             text,
  contact_phone_number     text,
  loja                     text,
  classificacao_ia         text,
  -- Quando o Chatwoot registrou o evento (vem no payload) — é o que decide
  -- o DIA do relatório, não o momento em que a gente recebeu o webhook.
  criado_em_chatwoot       timestamptz not null,
  dia_br                   date not null,
  recebido_em              timestamptz not null default now(),
  -- Cada conversa conta só UMA vez como lead_novo e UMA vez como
  -- lead_quente, pra sempre — reenvio de webhook (timeout, retry) ou
  -- etiqueta removida/reaplicada não infla o número do relatório.
  unique (conversation_id, tipo)
);

create index chatwoot_eventos_tipo_dia_br_idx on public.chatwoot_eventos (tipo, dia_br);

comment on table public.chatwoot_eventos is
  'Eventos crus de lead novo/lead quente do Chatwoot, gravados só pela Edge Function receber-webhook-chatwoot (chave de serviço). Leitura liberada a quem tem a permissão "meta.opr".';

alter table public.chatwoot_eventos enable row level security;

-- Sem policy de insert de propósito: só a chave de serviço grava (ela
-- ignora RLS) — mesmo desenho de carrinho_eventos
-- (db/migrations/2026-09-17-carrinho-eventos.sql).
create policy chatwoot_eventos_leitura on public.chatwoot_eventos
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles p
       where p.id = auth.uid()
         and (p.role = 'admin' or p.is_superadmin or p.permissions ? 'meta.opr')
    )
  );

-- ⚠️ Tabela nova no Supabase nasce com INSERT/UPDATE/DELETE para
-- `authenticated` pela concessão padrão (mesmo aviso de
-- 2026-09-11-meta-ads-hora-permissiva.sql) — sem isto, qualquer usuário
-- logado conseguiria inserir "lead quente" fake direto no banco.
revoke all on table public.chatwoot_eventos from public, anon, authenticated;
grant  select on table public.chatwoot_eventos to authenticated;
