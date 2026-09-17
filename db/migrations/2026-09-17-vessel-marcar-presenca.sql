-- MARCAR QUE A CLIENTE VEIO — ou que não veio
--
-- ⚠️ SEM ISTO A META DE 75% DE COMPARECIMENTO NÃO EXISTE. A conta é
-- presentes ÷ agendamentos confirmados, e ninguém preenchia o primeiro número.
-- Nenhum robô resolve: é um botão que uma pessoa aperta.
--
-- ⚠️ E NÃO EXISTE CONSULTA QUE DEVOLVA A LISTA, DE PROPÓSITO.
-- A página do gerador não tem login. Uma função que listasse os atendimentos de
-- uma Client Advisor devolveria nomes e telefones de clientes para quem
-- descobrisse o endereço e um código de CA — que viaja dentro de todo convite.
-- Então o caminho é o contrário: o celular dela guarda os códigos dos cartões
-- que ELA fez, e para marcar presença ela manda o código. Sem listagem, não há
-- o que enumerar.

create or replace function public.vessel_marcar_presenca(
  p_codigo  text,
  p_veio    boolean,
  p_teste   boolean default true
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     bigint;
  v_status text;
begin
  select id, status into v_id, v_status
    from public.vessel_atendimentos
   where convite_codigo = upper(trim(coalesce(p_codigo, '')));

  -- ⚠️ Não dizer que o convite não existe. A página é pública: responder
  -- "não achei" transformaria a função num verificador de códigos válidos.
  if v_id is null then
    return json_build_object('ok', true);
  end if;

  -- ⚠️ QA11 DO PLANO: "no-show não vira presença". Faltar é um ESTADO, e ele
  -- não carimba hora de chegada — senão o show rate contaria quem não veio.
  update public.vessel_atendimentos
     set status      = case when p_veio then 'realizado' else 'no_show' end,
         presenca_em = case when p_veio then coalesce(presenca_em, now()) else null end,
         teste       = p_teste,
         atualizado_em = now()
   where id = v_id;

  return json_build_object('ok', true, 'situacao', case when p_veio then 'veio' else 'nao_veio' end);
end;
$$;

revoke all on function public.vessel_marcar_presenca(text, boolean, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_marcar_presenca(text, boolean, boolean)
  to anon, authenticated;

comment on function public.vessel_marcar_presenca(text, boolean, boolean) is
  'Marca que a cliente veio (status realizado + presenca_em) ou nao veio '
  '(no_show, SEM presenca_em). Responde ok mesmo para codigo inexistente, para '
  'nao virar um verificador de codigos validos.';
