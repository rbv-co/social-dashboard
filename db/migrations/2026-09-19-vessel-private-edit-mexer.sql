-- MEXER NO ENCONTRO: editar, apagar e arquivar.
--
-- ⚠️ AS TRES USAM `is_vessel_atendimentos_editar()`, nao a trava de ver. Quem so
-- ve continua so vendo, inclusive por fora da tela.
--
-- ⚠️ `codigo` e `chave` NUNCA se editam. O `codigo` e o identificador do CRM e a
-- `chave` esta dentro de todo convite JA ENVIADO. Trocar qualquer um dos dois
-- mata links que ja estao circulando.
--
-- ⚠️ O `codigo` QUE CHEGA E NORMALIZADO IGUALZINHO AO DA IRMA
-- `vessel_private_edit_encerrar` — `upper(nullif(trim(coalesce(p_codigo,'')),''))`,
-- mesma expressao e mesma ordem (ver
-- `db/migrations/2026-09-19-vessel-private-edit-pela-tela.sql`). E copia
-- deliberada, para as duas nao poderem divergir. O motivo: as quatro acoes
-- moram NA MESMA TELA, lado a lado. Um codigo com espaco na ponta ou em
-- minusculas que faz "Encerrar" funcionar e "Editar", "Apagar" e "Arquivar"
-- responderem `nao_achei` e pior do que os quatro recusarem juntos: recusa em
-- bloco a pessoa entende como codigo errado; recusa pela metade ela entende
-- como sistema quebrado, e nao ha nada na tela que explique a diferenca.
--
-- ⚠️ E O VALOR NORMALIZADO VALE PARA A FUNCAO INTEIRA: o `exists`, o `update`,
-- o `delete`, a conferencia de convidadas e o `codigo` que volta no json. Um
-- so desses lugares lendo `p_codigo` cru ja e um buraco — a conferencia de
-- convidadas lendo o cru, por exemplo, nao acharia ninguem pendurado e o
-- `delete` (que usaria o normalizado) apagaria um encontro com gente.

create or replace function public.vessel_private_edit_editar(
  p_codigo  text,
  p_quando  timestamptz default null,
  p_local   text default null,
  p_praca   text default null,
  p_loja    text default null,
  p_vagas   int default null,
  p_stylist text default null            -- o CODIGO da stylist, nao o id
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_private_edit_encerrar`.
  v_codigo  text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_stylist bigint;
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_private_edits where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if p_stylist is not null then
    select id into v_stylist from public.vessel_stylists where codigo = p_stylist;
    if v_stylist is null then
      return json_build_object('ok', false, 'situacao', 'stylist_nao_achei');
    end if;
  end if;

  -- Campo nulo = "nao mexe neste", nunca "apaga o que estava la".
  update public.vessel_private_edits
     set quando     = coalesce(p_quando, quando),
         local      = coalesce(p_local, local),
         praca      = coalesce(p_praca, praca),
         loja       = coalesce(p_loja, loja),
         vagas      = coalesce(p_vagas, vagas),
         stylist_id = coalesce(v_stylist, stylist_id)
   where codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

create or replace function public.vessel_private_edit_apagar(p_codigo text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_private_edit_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_private_edits where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ APAGAR COM GENTE PENDURADA DEIXARIA LINHAS ORFAS em vessel_atendimentos,
  -- e a receita passaria a somar sobre um encontro que nao existe mais. Para
  -- esses, a tela oferece encerrar e arquivar.
  --
  -- ⚠️ E AQUI TAMBEM E `v_codigo`, NAO `p_codigo`. Se esta linha lesse o cru
  -- enquanto o `delete` abaixo le o normalizado, um codigo em minusculas nao
  -- acharia ninguem pendurado e o `delete` apagaria um encontro COM GENTE —
  -- exatamente o estrago que esta conferencia existe para impedir.
  if exists (select 1 from public.vessel_atendimentos where evento_codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'tem_gente');
  end if;

  delete from public.vessel_private_edits where codigo = v_codigo;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

create or replace function public.vessel_private_edit_arquivar(
  p_codigo text,
  p_arquivada boolean default true
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_private_edit_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_private_edits where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  update public.vessel_private_edits
     set arquivada = coalesce(p_arquivada, true)
   where codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok',
                           'codigo', v_codigo, 'arquivada', coalesce(p_arquivada, true));
end;
$function$;

-- ⚠️ AS DUAS LINHAS, PARA CADA UMA: `revoke ... from public` NAO fecha
-- `authenticated`.
revoke all on function public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text) from public, anon, authenticated;
grant execute on function public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text) to authenticated;
revoke all on function public.vessel_private_edit_apagar(text) from public, anon, authenticated;
grant execute on function public.vessel_private_edit_apagar(text) to authenticated;
revoke all on function public.vessel_private_edit_arquivar(text, boolean) from public, anon, authenticated;
grant execute on function public.vessel_private_edit_arquivar(text, boolean) to authenticated;
