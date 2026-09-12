-- ⚠️ ESTE ARQUIVO NÃO É A ÚLTIMA PALAVRA. O `vessel_criar_pecas` que ele cria
-- aqui embaixo NÃO tem portão por dentro, e `vessel_editar_lote` ainda ignora a
-- garantia da cliente. Quem corrige as duas coisas é
-- `2026-08-30-vessel-zz-fecha-o-portao-e-garantias.sql`, que o runner aplica
-- depois desta por ordem alfabética — é para isso que o `zz` existe no nome
-- dele. Não renomeie aquele arquivo.
--
-- O SORTEIO DE CÓDIGOS, ESCRITO UMA VEZ SÓ.
--
-- Ele nasceu dentro do vessel_gerar_lote. Agora o vessel_editar_lote também
-- precisa dele, para quando a quantidade AUMENTA. Copiar o laço seria copiar
-- junto o cuidado com viés de módulo e o motivo de não usar random() — e
-- copiar cuidado é como se perde cuidado.
create or replace function public.vessel_criar_pecas(p_lote uuid, p_de int, p_ate int)
returns int language plpgsql security definer set search_path to 'public'
as $$
declare
  ALFABETO constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- sem O, 0, I, 1
  v_codigo text; v_bytes bytea; i int; j int; tentativa int; v_feitas int := 0;
begin
  for i in p_de..p_ate loop
    tentativa := 0;
    loop
      -- Sorteio CRIPTOGRAFICO, nao random(). O random() do Postgres e
      -- previsivel: quem comprasse algumas bolsas e olhasse os codigos poderia
      -- calcular os proximos — e a protecao contra falsificacao depende
      -- justamente de o codigo nao ser adivinhavel.
      -- O alfabeto tem exatamente 32 letras e 256/32 = 8, entao `byte % 32` nao
      -- puxa pra letra nenhuma (sem vies de modulo).
      v_bytes := extensions.gen_random_bytes(10);
      v_codigo := '';
      for j in 0..9 loop
        v_codigo := v_codigo || substr(ALFABETO, 1 + (get_byte(v_bytes, j) % length(ALFABETO)), 1);
      end loop;
      begin
        insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
        values (v_codigo, p_lote, i);
        v_feitas := v_feitas + 1;
        exit;
      exception when unique_violation then
        tentativa := tentativa + 1;
        if tentativa > 20 then raise exception 'nao consegui sortear codigo livre'; end if;
      end;
    end loop;
  end loop;
  return v_feitas;
end;
$$;

-- vessel_gerar_lote passa a usar o ajudante. A ASSINATURA NAO MUDA: a tela
-- chama com os mesmos seis parametros, e nada do lado dela precisa mexer.
create or replace function public.vessel_gerar_lote(
  p_modelo text, p_cor text, p_sku text, p_quantidade int,
  p_fabricado_em date, p_fotos text[]
) returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_lote uuid;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if coalesce(trim(p_modelo), '') = '' or coalesce(p_quantidade, 0) < 1 or p_quantidade > 500 then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;

  insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em, fotos, criado_por)
  values (trim(p_modelo),
          nullif(trim(coalesce(p_cor, '')), ''),
          nullif(trim(coalesce(p_sku, '')), ''),
          p_quantidade, coalesce(p_fabricado_em, current_date), p_fotos, auth.uid())
  returning id into v_lote;

  perform public.vessel_criar_pecas(v_lote, 1, p_quantidade);

  return json_build_object('ok', true, 'lote_id', v_lote, 'quantidade', p_quantidade);
end;
$$;

-- ── EDITAR ────────────────────────────────────────────────────────────────
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
  -- bolsa. Recusa dizendo QUANTAS estao presas — numero seco ajuda mais que
  -- "nao e possivel".
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
    -- nascem codigos novos CONTINUANDO a serie, nunca reaproveitando numero
    perform public.vessel_criar_pecas(p_lote, v_maior + 1, v_maior + (p_quantidade - v_hoje));
  elsif p_quantidade < v_hoje then
    -- saem as NAO GRAVADAS de maior numero na serie
    delete from public.vessel_pecas
     where codigo in (
       select codigo from public.vessel_pecas
        where lote_id = p_lote and gravada_em is null
        order by numero_na_serie desc
        limit (v_hoje - p_quantidade)
     );
  end if;

  return json_build_object('ok', true, 'quantidade',
    (select count(*) from public.vessel_pecas where lote_id = p_lote));
end;
$$;

revoke all on function public.vessel_criar_pecas(uuid, int, int) from public, anon;
revoke all on function public.vessel_editar_lote(uuid, text, text, text, date, int) from public, anon;
grant execute on function public.vessel_editar_lote(uuid, text, text, text, date, int) to authenticated;
