-- APAGAR LOTE E APAGAR PEÇA PASSAM A DEIXAR RASTRO.
--
-- ⚠️ O QUE ACONTECEU EM 06/09/2026, e que levou horas para reconstituir:
-- entre 21:48 e 21:56, dez peças foram DESMARCADAS (isso a trilha registrava) e
-- em seguida os lotes foram apagados (isso a trilha NÃO registrava). Às 22:39
-- alguém encostou duas dessas etiquetas no leitor e a página respondeu que o
-- código não existe — porque não existia mesmo.
--
-- As etiquetas físicas continuam gravadas com o endereço antigo. Desmarcar
-- muda o BANCO; não apaga o que está dentro da etiqueta. É por isso que
-- desmarcar-e-apagar deixa etiqueta órfã, e por isso a trava de
-- `vessel_excluir_lote` ("não apago lote com peça gravada") não segurou: no
-- momento do apagar, já não havia peça marcada como gravada.
--
-- Com esta migration, procurar o código órfão na trilha responde sozinho o que
-- aconteceu com ele. Uma linha POR PEÇA, de propósito: é pelo código da etiqueta
-- que alguém vai procurar, e não pelo id do lote.
--
-- ⚠️ A trilha NÃO tem chave estrangeira para a peça (conferido) — se tivesse,
-- estas linhas sumiriam no mesmo cascade que apaga a peça, e a trilha seria
-- inútil justamente no caso que ela existe para explicar.
--
-- PROVADO em transação com rollback: depois do delete, as peças somem e as
-- linhas da trilha continuam lá, ainda dizendo modelo e SKU.

alter table public.vessel_edicoes
  drop constraint vessel_edicoes_acao_check;

alter table public.vessel_edicoes
  add constraint vessel_edicoes_acao_check
  check (acao = any (array[
    'desmarcar_gravada',
    'sobrescrever_para_fila',
    'sobrescrever_para_baixa',
    'registro_aprovado',
    'registro_recusado',
    'dono_trocado',
    'baixar_garantia',
    'lote_excluido',
    'peca_excluida'
  ]));

CREATE OR REPLACE FUNCTION public.vessel_excluir_lote(p_lote uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_gravadas int; v_garantias int; v_total int; v_lote record;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  select * into v_lote from public.vessel_lotes where id = p_lote;
  if not found then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;

  select count(*) filter (where p.gravada_em is not null),
         count(*) filter (where exists (select 1 from public.vessel_registros r
                                         where r.codigo = p.codigo)),
         count(*)
    into v_gravadas, v_garantias, v_total
    from public.vessel_pecas p where p.lote_id = p_lote;

  -- BASTA UMA gravada para o lote inteiro ficar preso: o lote e o que da modelo,
  -- cor e data para a pagina da cliente ler. Sem ele, a peca gravada fica orfa.
  if v_gravadas > 0 then
    return json_build_object('ok', false, 'motivo', 'tem_gravada',
                             'gravadas', v_gravadas, 'total', v_total);
  end if;
  -- E BASTA UMA GARANTIA REGISTRADA. Apagar levaria a garantia da cliente junto,
  -- por cascade, sem ninguem ver.
  if v_garantias > 0 then
    return json_build_object('ok', false, 'motivo', 'tem_garantia',
                             'garantias', v_garantias, 'total', v_total);
  end if;

  -- ⚠️ A TRILHA VEM ANTES DO DELETE. Depois dele nao ha de onde ler o codigo.
  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  select p.codigo, 'lote_excluido', null,
         jsonb_build_object('lote', p_lote, 'modelo', v_lote.modelo,
                            'cor', v_lote.cor, 'sku', v_lote.sku,
                            'numero_na_serie', p.numero_na_serie,
                            'pecas_no_lote', v_total),
         auth.uid()
    from public.vessel_pecas p where p.lote_id = p_lote;

  delete from public.vessel_lotes where id = p_lote;
  return json_build_object('ok', true, 'excluidas', v_total);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vessel_excluir_peca(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_codigo text := upper(trim(coalesce(p_codigo, '')));
        v_gravada timestamptz; v_lote uuid; v_num int; v_l record;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select gravada_em, lote_id, numero_na_serie into v_gravada, v_lote, v_num
    from public.vessel_pecas where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;
  if v_gravada is not null then
    return json_build_object('ok', false, 'motivo', 'esta_gravada');
  end if;
  if exists (select 1 from public.vessel_registros r where r.codigo = v_codigo) then
    return json_build_object('ok', false, 'motivo', 'tem_garantia', 'garantias', 1);
  end if;

  select * into v_l from public.vessel_lotes where id = v_lote;

  -- ⚠️ A TRILHA VEM ANTES DO DELETE, pelo mesmo motivo do lote.
  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  values (v_codigo, 'peca_excluida', null,
          jsonb_build_object('lote', v_lote, 'modelo', v_l.modelo, 'cor', v_l.cor,
                             'sku', v_l.sku, 'numero_na_serie', v_num),
          auth.uid());

  delete from public.vessel_pecas where codigo = v_codigo;
  update public.vessel_lotes
     set quantidade = (select count(*) from public.vessel_pecas p where p.lote_id = v_lote)
   where id = v_lote;
  perform public.vessel_renumerar_lote(v_lote);
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$function$;
