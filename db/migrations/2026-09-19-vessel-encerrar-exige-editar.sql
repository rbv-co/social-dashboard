-- ENCERRAR PASSA A EXIGIR A TRAVA DE EDITAR, NAO A DE VER.
--
-- ⚠️ O BURACO: `vessel_private_edit_encerrar` e `vessel_beauty_session_encerrar`
-- MUDAM dado — as duas gravam `ativa` na linha — mas so pediam
-- `is_vessel_atendimentos()`, que e a trava de VER. As duas nasceram antes de
-- `is_vessel_atendimentos_editar()` existir (`2026-09-19-vessel-trava-de-editar.sql`),
-- e ficaram para tras quando as irmas foram apertadas.
--
-- ⚠️ POR QUE UMA FUNCAO QUE "SO ENCERRA" PRECISA DA TRAVA DE MUDAR. Encerrar
-- nao e olhar: e ESCREVER na linha. Uma sessao encerrada por engano para de
-- aceitar contato novo pelo QR que ja esta IMPRESSO — no display do salao e no
-- cartao na mao da cliente. O desenho desta entrega diz em letra: "Editar,
-- apagar e arquivar entram atras de `atendimentos` -> `editar`, nao de `ver`.
-- Quem so ve continua so vendo." Encerrar e mudar, entao entra na mesma porta.
--
-- ⚠️ E PORQUE A PORTA MAIS FRACA E QUE DECIDE. Depois desta entrega, as quatro
-- acoes ficam LADO A LADO NA MESMA TELA: "Editar", "Apagar" e "Arquivar" ja
-- exigem `editar`; deixar "Encerrar" pedindo menos nao esconderia nada — quem
-- so ve continuaria podendo desligar o evento por fora da tela, que e
-- exatamente o estrago que as outras tres passaram a impedir.
--
-- ⚠️ MEDIDO ANTES DE APERTAR, NAO SUPOSTO: dos 24 perfis do sistema, ZERO tem
-- `atendimentos` em `features` e ZERO tem `editar` em
-- `permissions.atendimentos`. Quem passa hoje pelos dois portoes sao so os 3
-- superadmins — e superadmin passa nos DOIS, porque
-- `is_vessel_atendimentos_editar()` comeca chamando
-- `is_vessel_atendimentos()` e depois aceita `p.is_superadmin`. Ou seja: este
-- aperto NAO TIRA ACESSO DE NINGUEM hoje. Se algum dia alguem receber so a
-- permissao de ver, esta e a linha que o mantem so vendo.
--
-- ⚠️ SO A LINHA DO PORTAO MUDA. O corpo das duas funcoes e byte a byte o que
-- ja estava no banco — a mesma normalizacao
-- `upper(nullif(trim(coalesce(p_codigo,'')),''))`, o mesmo `update`, o mesmo
-- `if not found`, o mesmo json de volta, as mesmas mensagens em portugues.
-- Aproveitar este `create or replace` para "melhorar" qualquer outra coisa
-- faria uma mudanca de seguranca carregar mudanca de comportamento junto, e a
-- prova desta migration nao teria como separar as duas.

-- ── 1. o encontro do Private Edit ──────────────────────────────────────────
create or replace function public.vessel_private_edit_encerrar(
  p_codigo text,
  p_ativa  boolean default false
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'erro',
      'Você não tem a permissão de Atendimentos para mexer nos encontros.');
  end if;
  update public.vessel_private_edits
     set ativa = coalesce(p_ativa, false)
   where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'erro', 'Não achei este encontro.');
  end if;
  return json_build_object('ok', true, 'codigo', v_codigo, 'ativa', coalesce(p_ativa, false));
end;
$function$;

-- ⚠️ AS DUAS LINHAS DE NOVO, IGUAIS AS QUE JA ESTAVAM. `create or replace` nao
-- mexe na porta de uma funcao que ja existe, entao em tese estas linhas nao
-- fariam falta — mas elas ficam porque o dia em que esta funcao for recriada
-- do zero (um banco novo, um restore) ela nasce ABERTA para `public`, e
-- `revoke ... from public` NAO fecha `authenticated`. A porta aqui e a MESMA
-- de hoje, conferida antes de escrever esta linha: `authenticated` executa,
-- `anon` e `public` nao, `service_role` continua como estava. Este arquivo
-- aperta o PORTAO DE DENTRO da funcao, nao a porta de fora.
revoke all on function public.vessel_private_edit_encerrar(text, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_private_edit_encerrar(text, boolean) to authenticated;

-- ── 2. a sessao da Beauty Session ──────────────────────────────────────────
create or replace function public.vessel_beauty_session_encerrar(
  p_codigo text,
  p_ativa  boolean default false
) returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'erro',
      'Você não tem a permissão de Atendimentos para mexer nas sessões.');
  end if;
  update public.vessel_beauty_sessions
     set ativa = coalesce(p_ativa, false)
   where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'erro', 'Não achei esta sessão.');
  end if;
  return json_build_object('ok', true, 'codigo', v_codigo, 'ativa', coalesce(p_ativa, false));
end;
$function$;

revoke all on function public.vessel_beauty_session_encerrar(text, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_beauty_session_encerrar(text, boolean) to authenticated;
