-- ⚠️ ESTE ARQUIVO NÃO É A ÚLTIMA PALAVRA: falta aqui a regra da GARANTIA
-- (peça sem gravação, mas com garantia registrada, também não pode sumir — o
-- `on delete cascade` de `vessel_registros` levaria a garantia da cliente).
-- Quem fecha isso é `2026-08-30-vessel-zz-fecha-o-portao-e-garantias.sql`.
--
-- EXCLUIR SÓ O QUE NUNCA FOI GRAVADO.
--
-- A recusa mora AQUI, e não na tela. A tela impedir não basta: quem chamar a
-- função direto passaria por cima, e o custo é uma bolsa original virando
-- "não consta no nosso registro" na mão de quem comprou.

create or replace function public.vessel_excluir_lote(p_lote uuid)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_gravadas int; v_total int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- A existencia vem ANTES da contagem: contar peca de lote inexistente nao
  -- quebra (da zero), mas a funcao devolveria 'lote_nao_existe' depois de ter
  -- feito uma conta que nao significa nada. Conferir primeiro faz o motivo
  -- devolvido bater com o que realmente aconteceu.
  if not exists (select 1 from public.vessel_lotes where id = p_lote) then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;

  select count(*) filter (where gravada_em is not null), count(*)
    into v_gravadas, v_total
    from public.vessel_pecas where lote_id = p_lote;

  -- BASTA UMA gravada para o lote inteiro ficar preso: as outras peças até
  -- poderiam sumir, mas o lote é o que dá modelo, cor e data para a página da
  -- cliente ler. Sem ele, a peça gravada fica órfã.
  if v_gravadas > 0 then
    return json_build_object('ok', false, 'motivo', 'tem_gravada',
                             'gravadas', v_gravadas, 'total', v_total);
  end if;

  -- as peças saem por cascade (vessel_pecas.lote_id ... on delete cascade),
  -- e as baixas delas por cascade também
  delete from public.vessel_lotes where id = p_lote;
  return json_build_object('ok', true, 'excluidas', v_total);
end;
$$;

create or replace function public.vessel_excluir_peca(p_codigo text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_codigo text := upper(trim(coalesce(p_codigo, '')));
        v_gravada timestamptz; v_lote uuid;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select gravada_em, lote_id into v_gravada, v_lote
    from public.vessel_pecas where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;
  if v_gravada is not null then
    return json_build_object('ok', false, 'motivo', 'esta_gravada');
  end if;

  delete from public.vessel_pecas where codigo = v_codigo;
  -- A quantidade do lote acompanha, senão a tela diria "3 de 5" para sempre.
  -- O `lote_id` foi guardado ANTES do delete, de propósito: depois dele a linha
  -- não existe mais para ser consultada.
  update public.vessel_lotes
     set quantidade = (select count(*) from public.vessel_pecas p where p.lote_id = v_lote)
   where id = v_lote;
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

revoke all on function public.vessel_excluir_lote(uuid) from public, anon;
revoke all on function public.vessel_excluir_peca(text) from public, anon;
grant execute on function public.vessel_excluir_lote(uuid) to authenticated;
grant execute on function public.vessel_excluir_peca(text) to authenticated;
