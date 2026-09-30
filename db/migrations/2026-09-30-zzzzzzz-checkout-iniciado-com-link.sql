-- 2026-09-30-zzzzzzz-checkout-iniciado-com-link.sql
-- A mensagem de checkout iniciado ganhou o botão "Finalizar compra": a linha da fila (`mensagem_fila`, tipo `inicio`)
-- passa a guardar o link de recuperação do checkout. Se o link ainda não veio no primeiro evento, o de um evento
-- seguinte entra na linha enquanto ela NÃO foi enviada (o robô espera o link, sem gastar tentativa). Link já gravado
-- não é trocado, e linha já enviada não muda mais.
-- Mesma função de 2026-09-30-zzzzzz-checkout-iniciado.sql; só o último INSERT muda.

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

  -- Só enquanto Aguardando e com telefone que identifica alguém. Nome, telefone e link são os JÁ consolidados do checkout.
  -- Uma vez por checkout (chave = token); um evento seguinte só completa o link que faltava.
  insert into public.mensagem_fila (tipo, chave, nome, telefone, url_de_recuperacao)
  select 'inicio', c.token, c.nome, c.telefone, c.url_de_recuperacao
    from public.checkout_abandono c
   where c.token = p_token and c.status = 'aguardando' and public.fone11(c.telefone) <> ''
  on conflict (tipo, chave) do update
    set url_de_recuperacao = coalesce(mensagem_fila.url_de_recuperacao, excluded.url_de_recuperacao)
    where mensagem_fila.mensagem_status is null;
end;
$$;
