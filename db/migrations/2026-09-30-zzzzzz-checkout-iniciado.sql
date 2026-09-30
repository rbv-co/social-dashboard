-- 2026-09-30-zzzzzz-checkout-iniciado.sql
-- MENSAGEM "Nós reservamos seu pedido" NO MOMENTO EM QUE O CHECKOUT APARECE COM TELEFONE (Aguardando).
-- Decisão do dono (30/09/2026): a cliente é avisada assim que informa os dados no checkout, sem esperar o pagamento.
-- (Na Shopify o checkout ainda não é um pedido: o pedido só nasce quando ela conclui. A mensagem de pedido CRIADO de
-- verdade, por orders/create, continua existindo e fica desligada por configuração.)
--
-- Como: `registrar_checkout_abandono` passa a colocar o checkout na `mensagem_fila` (tipo `inicio`) na primeira vez em
-- que ele tem telefone e ainda está Aguardando. Uma vez por checkout. O robô envia em até 1 minuto.
-- Regras da passada `inicio` (em `candidatos_da_fila`): no máximo UM por telefone no lote, nenhum se o telefone já tem um
-- `inicio` em andamento e nenhum se ele recebeu um nas últimas 12 h (quem abre e fecha o checkout não recebe várias).

alter table public.mensagem_fila drop constraint if exists mensagem_fila_tipo_check;
alter table public.mensagem_fila add constraint mensagem_fila_tipo_check check (tipo in ('pedido', 'followup', 'inicio'));

-- Mesmo upsert de sempre (2026-09-29-abandono-de-checkout.sql), agora em plpgsql para também enfileirar a mensagem.
create or replace function public.registrar_checkout_abandono(
  p_token text, p_email text, p_telefone text, p_nome text,
  p_total numeric, p_moeda text, p_url text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
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

  -- Só enquanto Aguardando e com telefone que identifica alguém. Nome e telefone são os JÁ consolidados do checkout.
  -- Uma vez por checkout (chave = token): os updates seguintes não enfileiram de novo.
  insert into public.mensagem_fila (tipo, chave, nome, telefone)
  select 'inicio', c.token, c.nome, c.telefone
    from public.checkout_abandono c
   where c.token = p_token and c.status = 'aguardando' and public.fone11(c.telefone) <> ''
  on conflict (tipo, chave) do nothing;
end;
$$;

-- Chaves elegíveis. Follow-up e inicio: no máximo UM por telefone (o mais antigo) e nenhum cujo telefone já tem
-- mensagem do mesmo tipo em andamento. Inicio ainda barra quem recebeu nas últimas 12 h. Pedido: um por pedido.
create or replace function public.candidatos_da_fila(p_tipo text, p_max_horas int, p_ultimos11 text[] default null)
returns setof text
language sql
security definer
set search_path = public
as $$
  select distinct on (case when p_tipo in ('followup', 'inicio') and public.fone11(f.telefone) <> '' then public.fone11(f.telefone) else f.chave end) f.chave
    from public.mensagem_fila f
   where f.tipo = p_tipo and f.mensagem_status is null
     and f.criado_em >= now() - make_interval(hours => p_max_horas)
     and (p_ultimos11 is null or public.fone11(f.telefone) = any (p_ultimos11))
     and not (p_tipo in ('followup', 'inicio') and public.fone11(f.telefone) <> '' and exists (
       select 1 from public.mensagem_fila o
        where o.tipo = p_tipo and o.chave <> f.chave
          and public.fone11(o.telefone) = public.fone11(f.telefone)
          and (o.mensagem_status = 'enviando'
               or (p_tipo = 'inicio' and o.mensagem_status = 'enviada' and o.mensagem_enviada_em > now() - interval '12 hours'))))
   order by (case when p_tipo in ('followup', 'inicio') and public.fone11(f.telefone) <> '' then public.fone11(f.telefone) else f.chave end), f.criado_em, f.chave;
$$;
