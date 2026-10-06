-- 2026-10-06-robo-de-cartoes.sql
-- LIGA O ROBÔ DOS CARTÕES EAN (.github/workflows/cartoes-ean.yml, coletor/robo-de-cartoes.mjs).
--
-- A fila `vessel_cartao_pedidos` e as funções de pegar/devolver existem desde 11/09 (2026-09-11-vessel-cartoes-fila-
-- e-trava.sql), mas NADA acordava o robô e nenhum robô existia: em 06/10 dois pedidos ficaram parados horas. Aqui:
--   1) o gatilho que acorda o robô quando um pedido entra (molde: vessel_lote_novo_pede_foto);
--   2) `vessel_cartao_recolocar_travados`: pedido `rodando` há muito tempo (runner morto) volta para `na_fila`;
--   3) o segredo que a edge `vessel-cartoes-trigger` confere.
--
-- ⚠️ ORDEM DE PUBLICAÇÃO: (a) esta migration, (b) a edge `vessel-cartoes-trigger` (--no-verify-jwt, ver CLAUDE.md),
-- (c) o workflow na main. Sem (c) o gatilho responde 404 e a rodada de hora em hora não existe; sem (b) o disparo
-- falha (e é engolido de propósito: o pedido continua na fila).

-- 1) O gatilho. ⚠️ FALHA AQUI NÃO PODE DERRUBAR O PEDIDO: o gatilho roda DENTRO da transação de quem pediu os
-- cartões, e um erro não tratado desfaria o pedido por causa de um aviso que é opcional (a rodada de hora em hora
-- o pegaria de qualquer jeito).
create or replace function public.vessel_cartao_pedido_novo_acorda_o_robo()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    perform public.disparar_robo(
      'vessel-cartoes-trigger', 'vessel-cartoes-trigger', 'vessel-cartoes-trigger',
      jsonb_build_object('pedido', new.id, 'origem', 'pedido-novo'),
      30000);
  exception when others then
    null;
  end;
  return new;
end;
$function$;

revoke execute on function public.vessel_cartao_pedido_novo_acorda_o_robo() from public, anon, authenticated;

drop trigger if exists vessel_cartao_pedido_novo_acorda_o_robo on public.vessel_cartao_pedidos;
create trigger vessel_cartao_pedido_novo_acorda_o_robo
  after insert on public.vessel_cartao_pedidos
  for each row
  execute function public.vessel_cartao_pedido_novo_acorda_o_robo();

-- 2) A retaguarda dos travados. O robô devolve o pedido SEMPRE que termina (pronto ou falhou); só fica `rodando`
-- se o runner for morto no meio. Gerar de novo é seguro: o upload sobrescreve pelo nome e a marca
-- `cartao_gerado_em` só vai para a peça confirmada.
create or replace function public.vessel_cartao_recolocar_travados(p_minutos int default 150)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_n int;
begin
  update public.vessel_cartao_pedidos
     set situacao = 'na_fila', comecou_em = null
   where situacao = 'rodando'
     and comecou_em < now() - make_interval(mins => greatest(p_minutos, 10));
  get diagnostics v_n = row_count;
  return json_build_object('ok', true, 'recolocados', v_n);
end;
$function$;

-- ⚠️ SÓ O ROBÔ (chave de serviço). Sem este revoke o Supabase deixa `anon` executar função nova do schema public.
revoke execute on function public.vessel_cartao_recolocar_travados(int) from public, anon, authenticated;
grant  execute on function public.vessel_cartao_recolocar_travados(int) to service_role;

-- 3) O segredo do disparo (valor aleatório, nunca versionado). `on conflict do nothing`: rodar de novo não troca.
insert into public.segredos_de_cron (nome, segredo)
values ('vessel-cartoes-trigger', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (nome) do nothing;
