-- +goose Up
-- Plano 6 (pendência do 5.11): vessel_convite_marcar GRAVA (convite enviado, rsvp), e o comentário dela diz "a mesma trava de
-- vessel_situacao_do_atendimento", que exige EDITAR; o portão de produção era só `ver` do Private Edit (quem só vê marcava
-- o convite). Aqui o portão passa a ser o da situação do atendimento: (atendimentos, editar) ou (private-edit, editar). O resto
-- do corpo é o de produção (levantamento 02-funções.csv). limpar-dump.mjs tira a versão do dump (regra `substituidas`) para a
-- de produção não vencer esta no restaurar.sh.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.vessel_convite_marcar(p_id bigint, p_marca text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_marca text := lower(nullif(trim(coalesce(p_marca, '')), ''));
begin
  -- ⚠️ A MESMA TRAVA DE `vessel_situacao_do_atendimento`, que é por onde a
  -- presença é marcada: marcar "convite enviado" e marcar "veio" são o mesmo
  -- tipo de gesto, feitos pela mesma pessoa, no mesmo cartão.
  if not (public.vessel_pode('atendimentos', 'editar') or public.vessel_pode('atendimentos.private-edit', 'editar')) then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_marca is null or v_marca not in ('enviado', 'sim', 'nao', 'sem_resposta') then
    return json_build_object('ok', false, 'situacao', 'marca_invalida');
  end if;
  -- ⚠️ SÓ CONVIDADA DE ENCONTRO. Uma visita comum não tem convite, e esta
  -- função não pode virar um jeito de reescrever `rsvp` de qualquer linha.
  if not exists (select 1 from public.vessel_atendimentos
                  where id = p_id and evento_codigo is not null) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  update public.vessel_atendimentos
     set convite_enviado_em = case when v_marca = 'enviado'
                                   then coalesce(convite_enviado_em, now())
                                   else convite_enviado_em end,
         rsvp = case v_marca when 'sim' then 'sim' when 'nao' then 'nao'
                             when 'sem_resposta' then null else rsvp end,
         atualizado_em = now()
   where id = p_id;

  return json_build_object('ok', true, 'situacao', 'ok');
end;
$function$;
-- +goose StatementEnd

-- +goose Down
-- Não volta ao portão frouxo: a função de produção reaparece ao restaurar o dump de novo.
select 1;
