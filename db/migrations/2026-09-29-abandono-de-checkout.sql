-- FILA DE CHECKOUTS ABANDONADOS (o que alimenta o WhatsApp de recuperação).
--
-- Regra (a mesma do Shopify — "Recovering abandoned checkouts": incompleto por
-- mais de 10 minutos depois de o cliente informar o contato):
--   • checkout com e-mail/telefone entra em 'aguardando';
--   • cada novo evento do checkout ZERA o relógio;
--   • 10 min sem evento e sem pedido → 'fila_envio' (quem manda o WhatsApp lê daqui);
--   • pedido com o mesmo checkout → 'comprou'.
--
-- ⚠️ ESTA TABELA GUARDA DADO PESSOAL (e-mail, telefone, nome). O receptor antigo
-- (`receber-webhook-checkout`) descarta isso de propósito e guarda só o
-- cart_token. Aqui é o contrário, por decisão do dono (28/09/2026): sem o
-- telefone não há como mandar a mensagem. Por isso:
--   • RLS ligada, SEM policy de insert/update — só a chave de serviço grava;
--   • leitura só para quem tem a permissão 'abandono-carrinho';
--   • as funções abaixo são só do service_role.

create table if not exists public.checkout_abandono (
  token              text primary key,            -- token do checkout (Shopify)
  email              text,
  telefone           text,
  nome               text,
  total              numeric,
  moeda              text,
  url_de_recuperacao text,                        -- abandoned_checkout_url
  status             text not null default 'aguardando'
                     check (status in ('aguardando', 'fila_envio', 'comprou')),
  iniciado_em        timestamptz not null default now(),
  ultimo_evento_em   timestamptz not null default now(),
  fila_envio_em      timestamptz,
  comprou_em         timestamptz,
  comprou_depois     boolean not null default false  -- comprou já depois de entrar na fila de envio
);

create index if not exists checkout_abandono_status_ultimo_evento_idx
  on public.checkout_abandono (status, ultimo_evento_em);

comment on table public.checkout_abandono is
  'Fila de checkouts abandonados. Gravada so pelas funcoes registrar_checkout_abandono / '
  'marcar_checkout_comprou (edge receber-webhook-abandono) e mover_abandonados_para_fila (pg_cron). '
  'Tem e-mail e telefone: leitura so com a permissao abandono-carrinho.';

alter table public.checkout_abandono enable row level security;

-- Sem policy de insert/update de propósito: só a chave de serviço grava (ignora RLS).
drop policy if exists checkout_abandono_leitura on public.checkout_abandono;
create policy checkout_abandono_leitura on public.checkout_abandono for select to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and (p.role = 'admin' or p.is_superadmin or 'abandono-carrinho' = any (p.features))
  ));

-- ── checkouts/create e checkouts/update ─────────────────────────────────────
-- Upsert. Só mexe em quem ainda está 'aguardando': um update que chega depois
-- de o checkout ir para a fila de envio (ou de virar compra) NÃO o traz de volta.
-- Campo que veio vazio não apaga o que já se sabia (coalesce).
create or replace function public.registrar_checkout_abandono(
  p_token text, p_email text, p_telefone text, p_nome text,
  p_total numeric, p_moeda text, p_url text
) returns void
language sql
security definer
set search_path = public
as $$
  insert into public.checkout_abandono
    (token, email, telefone, nome, total, moeda, url_de_recuperacao)
  values (p_token, p_email, p_telefone, p_nome, p_total, p_moeda, p_url)
  on conflict (token) do update set
    email              = coalesce(excluded.email, checkout_abandono.email),
    telefone           = coalesce(excluded.telefone, checkout_abandono.telefone),
    nome               = coalesce(excluded.nome, checkout_abandono.nome),
    total              = coalesce(excluded.total, checkout_abandono.total),
    moeda              = coalesce(excluded.moeda, checkout_abandono.moeda),
    url_de_recuperacao = coalesce(excluded.url_de_recuperacao, checkout_abandono.url_de_recuperacao),
    ultimo_evento_em   = now()
  where checkout_abandono.status = 'aguardando';
$$;

-- ── orders/create (ou checkout com completed_at) ────────────────────────────
-- Pedido de checkout que nunca vimos (sem contato) não cria linha: não há o que recuperar.
create or replace function public.marcar_checkout_comprou(p_token text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.checkout_abandono
     set comprou_depois = (status = 'fila_envio'),
         status         = 'comprou',
         comprou_em     = now()
   where token = p_token
     and status <> 'comprou';
$$;

-- ── o relógio ───────────────────────────────────────────────────────────────
-- 10 = os minutos do Shopify. Se mudar aqui, mude MINUTOS_ATE_ABANDONO em
-- src/ferramentas/abandono-carrinho/regras-do-abandono.js (a tela faz a contagem).
create or replace function public.mover_abandonados_para_fila(p_minutos int default 10)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  movidos int;
begin
  update public.checkout_abandono
     set status        = 'fila_envio',
         fila_envio_em = now()
   where status = 'aguardando'
     and ultimo_evento_em < now() - make_interval(mins => p_minutos);
  get diagnostics movidos = row_count;
  return movidos;
end;
$$;

-- Função de escrita: fechada para todos, aberta só para o service_role.
-- `anon` precisa ser citado, senão a função fica aberta pelo `public`.
revoke execute on function public.registrar_checkout_abandono(text, text, text, text, numeric, text, text)
  from public, anon, authenticated;
revoke execute on function public.marcar_checkout_comprou(text) from public, anon, authenticated;
revoke execute on function public.mover_abandonados_para_fila(int) from public, anon, authenticated;
grant execute on function public.registrar_checkout_abandono(text, text, text, text, numeric, text, text) to service_role;
grant execute on function public.marcar_checkout_comprou(text) to service_role;
grant execute on function public.mover_abandonados_para_fila(int) to service_role;

-- A cada minuto, direto no banco (não precisa de edge nem de segredo: é só um UPDATE).
-- Tolerância do relógio = até 1 min depois dos 10.
select cron.schedule('abandono-de-checkout', '* * * * *', $cron$
  select public.mover_abandonados_para_fila(10);
$cron$);
