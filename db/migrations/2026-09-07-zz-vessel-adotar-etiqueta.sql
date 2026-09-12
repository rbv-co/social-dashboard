-- ADOTAR UMA ETIQUETA ÓRFÃ.
--
-- O PROBLEMA QUE ISTO RESOLVE (06/09/2026): uma etiqueta já gravada cujo lote
-- foi apagado vira "órfã" — ela carrega um endereço que não existe mais. Até
-- hoje o único conserto era REGRAVAR a etiqueta, na bancada, uma a uma. Mas a
-- etiqueta já está colada na bolsa, e o código dela é perfeitamente bom: o que
-- falta é o sistema reconhecê-lo.
--
-- Então em vez de reescrever a etiqueta, o sistema ADOTA o código: uma peça que
-- está esperando gravação troca o código que foi gerado para ela pelo código que
-- já está dentro da etiqueta, e passa a valer como gravada.
--
-- ⚠️ AS TRÊS TRAVAS, e o porquê de cada uma:
--   1. o código órfão NÃO pode existir em lugar nenhum — senão dá para roubar a
--      etiqueta de uma peça viva, apontando duas bolsas para o mesmo endereço;
--   2. a peça de destino tem de estar PENDENTE (nunca gravada) — adotar em cima
--      de peça gravada deixaria OUTRA etiqueta órfã, trocando um problema por
--      outro;
--   3. e não pode ter garantia nem pedido de registro pendurado — aí há uma
--      pessoa de verdade ligada àquele código.
--
-- PROVADO em transação com rollback, vestindo a identidade de um admin de
-- verdade: as quatro recusas responderam o motivo certo e a adoção trocou o
-- código, marcou como gravada e deixou trilha.
create or replace function public.vessel_adotar_etiqueta(
  p_codigo_da_etiqueta text, p_peca_destino text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_orfao  text := upper(regexp_replace(coalesce(p_codigo_da_etiqueta, ''), '[\s.\-_]', '', 'g'));
  v_destino text := upper(regexp_replace(coalesce(p_peca_destino, ''), '[\s.\-_]', '', 'g'));
  v_peca   record;
  v_lote   record;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if v_orfao = '' or v_destino = '' then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;
  if v_orfao = v_destino then
    return json_build_object('ok', false, 'motivo', 'mesmo_codigo');
  end if;

  -- TRAVA 1: o codigo da etiqueta tem de ser mesmo orfao.
  if exists (select 1 from public.vessel_pecas where codigo = v_orfao) then
    return json_build_object('ok', false, 'motivo', 'etiqueta_em_uso');
  end if;

  select * into v_peca from public.vessel_pecas where codigo = v_destino;
  if not found then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;
  -- TRAVA 2: so peca esperando gravacao.
  if v_peca.gravada_em is not null then
    return json_build_object('ok', false, 'motivo', 'destino_ja_gravado');
  end if;
  -- TRAVA 3: ninguem pendurado no codigo de destino.
  if exists (select 1 from public.vessel_registros where codigo = v_destino)
     or exists (select 1 from public.vessel_pedidos_de_registro
                 where codigo = v_destino and estado = 'pendente') then
    return json_build_object('ok', false, 'motivo', 'destino_tem_gente');
  end if;

  select * into v_lote from public.vessel_lotes where id = v_peca.lote_id;

  -- A TROCA. `update` e nao delete+insert: as tres tabelas que apontam para
  -- `vessel_pecas.codigo` tem `on delete cascade`, e um delete levaria junto o
  -- que estivesse pendurado. Aqui nao ha nada pendurado (trava 3), mas a forma
  -- segura e a que continua segura quando alguem mexer nisto amanha.
  update public.vessel_pecas
     set codigo = v_orfao, gravada_em = now()
   where codigo = v_destino;

  insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
  values (v_orfao, 'etiqueta_adotada', null,
          jsonb_build_object('codigo_que_seria', v_destino,
                             'lote', v_peca.lote_id,
                             'modelo', v_lote.modelo, 'cor', v_lote.cor,
                             'sku', v_lote.sku,
                             'numero_na_serie', v_peca.numero_na_serie),
          auth.uid());

  return json_build_object('ok', true, 'codigo', v_orfao,
    'modelo', v_lote.modelo, 'cor', v_lote.cor,
    'numero_na_serie', v_peca.numero_na_serie,
    'aviso', 'A etiqueta continua como está. O sistema é que passou a '
          || 'reconhecer o código dela.');
end;
$function$;

-- A acao nova ENTRA NA LISTA FECHADA da trilha, na mesma migration. Escrever na
-- trilha uma acao que nao esta na lista derruba a transacao inteira — ja
-- aconteceu nesta casa em 05/09/2026, e a funcionalidade nunca rodou.
alter table public.vessel_edicoes
  drop constraint vessel_edicoes_acao_check;

alter table public.vessel_edicoes
  add constraint vessel_edicoes_acao_check
  check (acao = any (array[
    'desmarcar_gravada', 'sobrescrever_para_fila', 'sobrescrever_para_baixa',
    'registro_aprovado', 'registro_recusado', 'dono_trocado', 'baixar_garantia',
    'lote_excluido', 'peca_excluida', 'etiqueta_adotada'
  ]));

revoke execute on function public.vessel_adotar_etiqueta(text, text) from public;
revoke execute on function public.vessel_adotar_etiqueta(text, text) from anon;
grant  execute on function public.vessel_adotar_etiqueta(text, text) to authenticated;
