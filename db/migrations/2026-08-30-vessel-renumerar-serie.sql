-- RENUMERAR A SÉRIE AO DIMINUIR — decisão do dono, 30/08/2026.
--
-- O PROBLEMA, achado pela revisão da branch: a página da cliente mostra
-- "peça N de TOTAL", com N vindo de `vessel_pecas.numero_na_serie` e TOTAL de
-- `vessel_lotes.quantidade`. Duas sequências normais quebravam esse par:
--   · lote de 10, a #10 gravada, o dono diminui para 5 → sobram #1-#4 e #10, e
--     quem tem a bolsa lê "peça 10 de 5";
--   · excluir uma peça do meio deixa buraco, e um aumento seguinte nasce acima
--     do total.
-- Não fazia a bolsa parecer falsa, mas punha um número incoerente justamente na
-- página que este projeto existe para proteger.
--
-- ⚠️ O QUE ISSO CUSTA, e o dono aceitou de propósito: o número de uma peça JÁ
-- GRAVADA pode mudar. O CÓDIGO na etiqueta NÃO muda — é ele que identifica a
-- peça, e é ele que está costurado dentro da bolsa — mas quem viu "peça 10 de
-- 10" pode ver "peça 5 de 5" depois. Número coerente vale mais que número
-- imutável: incoerência a cliente percebe, mudança silenciosa quase nunca.
--
-- Esta migration REDEFINE `vessel_editar_lote` e `vessel_excluir_peca`, que
-- nasceram em `2026-08-30-vessel-editar-lote.sql` e `2026-08-30-vessel-excluir.sql`.
-- As versões de lá ficaram para trás.
--
-- ⚠️ E ESTA TAMBÉM NÃO É A ÚLTIMA PALAVRA sobre essas duas funções. Quem manda
-- é `2026-08-30-vessel-zz-fecha-o-portao-e-garantias.sql`, que roda depois de
-- todas (o `zz` do nome existe para isso: o runner aplica em ordem alfabética).
-- Lá elas ganham a regra da GARANTIA e a renumeração fora dos ramos.

create or replace function public.vessel_renumerar_lote(p_lote uuid)
returns int language plpgsql security definer set search_path to 'public'
as $$
declare v_n int;
begin
  -- A LIÇÃO DA MIGRATION IRMÃ, aplicada de saída: portão por dentro, porque
  -- `revoke ... from public` NÃO tira a concessão que o Postgres dá por default
  -- a `authenticated`. O ajudante anterior foi para produção sem isto.
  if not public.is_vessel_admin() then
    raise exception 'sem_permissao';
  end if;

  -- A ordem atual manda: quem era o primeiro continua sendo o primeiro. Não há
  -- restrição de unicidade em (lote_id, numero_na_serie), então a renumeração
  -- não esbarra em si mesma no meio do caminho.
  with nova as (
    select codigo,
           row_number() over (order by numero_na_serie, criado_em, codigo) as n
      from public.vessel_pecas where lote_id = p_lote
  )
  update public.vessel_pecas p
     set numero_na_serie = nova.n
    from nova
   where nova.codigo = p.codigo
     and p.numero_na_serie is distinct from nova.n;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke all on function public.vessel_renumerar_lote(uuid) from public, anon, authenticated;

create or replace function public.vessel_editar_lote(
  p_lote uuid, p_modelo text, p_cor text, p_sku text,
  p_fabricado_em date, p_quantidade int
) returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_gravadas int; v_hoje int; v_maior int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_lotes where id = p_lote) then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;
  if coalesce(trim(p_modelo), '') = '' or coalesce(p_quantidade, 0) < 1 or p_quantidade > 500 then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;

  select count(*) filter (where gravada_em is not null), count(*),
         coalesce(max(numero_na_serie), 0)
    into v_gravadas, v_hoje, v_maior
    from public.vessel_pecas where lote_id = p_lote;

  -- Diminuir abaixo do que ja foi gravado apagaria peca com etiqueta dentro de
  -- bolsa. Recusa dizendo QUANTAS estao presas.
  if p_quantidade < v_gravadas then
    return json_build_object('ok', false, 'motivo', 'abaixo_do_gravado',
                             'gravadas', v_gravadas);
  end if;

  -- modelo, cor, SKU e data sao seguros a qualquer momento: nao tocam em
  -- codigo nenhum, so mudam o que a cliente le na pagina.
  update public.vessel_lotes
     set modelo = trim(p_modelo),
         cor = nullif(trim(coalesce(p_cor, '')), ''),
         sku = nullif(trim(coalesce(p_sku, '')), ''),
         fabricado_em = coalesce(p_fabricado_em, fabricado_em),
         quantidade = p_quantidade
   where id = p_lote;

  if p_quantidade > v_hoje then
    perform public.vessel_criar_pecas(p_lote, v_maior + 1, v_maior + (p_quantidade - v_hoje));
    -- renumera tambem ao AUMENTAR: se um dia sobrou buraco, o aumento nasceria
    -- acima do total e a incoerencia voltaria por outra porta
    perform public.vessel_renumerar_lote(p_lote);
  elsif p_quantidade < v_hoje then
    -- saem as NAO GRAVADAS de maior numero na serie
    delete from public.vessel_pecas
     where codigo in (
       select codigo from public.vessel_pecas
        where lote_id = p_lote and gravada_em is null
        order by numero_na_serie desc
        limit (v_hoje - p_quantidade)
     );
    -- SEM ISTO a cliente leria "peca 10 de 5"
    perform public.vessel_renumerar_lote(p_lote);
  end if;

  return json_build_object('ok', true, 'quantidade',
    (select count(*) from public.vessel_pecas where lote_id = p_lote));
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
  -- O `lote_id` foi guardado ANTES do delete: depois dele a linha nao existe
  -- mais para ser consultada.
  update public.vessel_lotes
     set quantidade = (select count(*) from public.vessel_pecas p where p.lote_id = v_lote)
   where id = v_lote;
  -- tirar do meio deixa buraco na serie; renumerar fecha
  perform public.vessel_renumerar_lote(v_lote);
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$$;
