-- ESCOLHER O MATERIAL DO LOTE PELO PAINEL.
--
-- Decisão do dono, 18/09/2026 (Fase 2 do Registered Pieces, tarefa 3). Desde
-- 2026-09-18-zz-vessel-garantia-pelo-material.sql a garantia depende de
-- `vessel_lotes.material` — e não existia porta nenhuma para preencher esse
-- campo. As três que existiam não cobrem o caso novo:
--   · a lista conferida pelo dono (fonte 'dono') só existe naquela migration;
--   · o gatilho de herança só age quando JÁ existe lote do mesmo SKU com
--     material — SKU inédito nasce sem nada;
--   · `coletor/classificar-material-dos-lotes.mjs` é SÓ LEITURA, de propósito.
-- Resultado: lote de produto novo ficava sem material para sempre, e toda peça
-- dele com `garantia_ate` NULO, sem ninguém poder consertar pela tela.
--
-- ⚠️ POR QUE UMA FUNÇÃO, E NÃO UM `update` DIRETO DA TELA. Conferido no banco
-- em 18/09/2026: `vessel_lotes` tem RLS ligado e EXATAMENTE UMA política, de
-- SELECT, para `authenticated`, com `using (public.is_vessel_admin())`. Não há
-- política de escrita nenhuma. Um `update` pelo cliente não dá erro: volta 0
-- linhas, e a tela anunciaria "salvo" sem nada ter sido salvo — o defeito mais
-- caro de perceber. Quem escreve em `vessel_lotes` é sempre uma função
-- `security definer`, como em `vessel_editar_lote` e `vessel_excluir_lote`.
--
-- ⚠️ POR QUE NÃO ENTROU EM `vessel_editar_lote`. Aquela função mexe na
-- QUANTIDADE do lote: aumentar cria peças, diminuir apaga as não gravadas.
-- Pendurar o material nela faria corrigir "canvas → couro" passar pelo mesmo
-- caminho que apaga código de etiqueta. São dois riscos diferentes, e um deles
-- não se desfaz.
--
-- ⚠️ ESTA FUNÇÃO NÃO LIMPA O MATERIAL (não aceita nulo). Limpar zeraria a
-- `garantia_ate` de toda peça já registrada do lote — o gatilho da seção 4
-- daquela migration recalcula, e sem material o recálculo dá nulo. Tirar a data
-- do certificado de uma cliente não pode ser um efeito colateral de um clique
-- num seletor. Se um dia for preciso, entra como ação própria, com pergunta
-- própria.
--
-- O QUE ESTE ARQUIVO FAZ:
--   1. a trilha (`vessel_edicoes`) passa a aceitar a ação 'material_do_lote';
--   2. `vessel_definir_material_do_lote(uuid, text)`, com portão
--      `is_vessel_admin()`, grava o material com fonte 'painel'.
--
-- ENSAIADO em transação com `begin` / `rollback` em 19/09/2026 (nada aplicado):
-- grava canvas e couro, marca a fonte como 'painel', recalcula a garantia das
-- peças já registradas pelo gatilho que já existia, deixa a linha na trilha,
-- recusa material inválido, recusa lote que não existe, e recusa quem não é
-- admin do selo.

-- ══════════════════════════════════════════════════════════════════════════
-- 1. A TRILHA ACEITA A AÇÃO NOVA
-- ══════════════════════════════════════════════════════════════════════════
--
-- ⚠️ A LISTA DO `check` VEM PRIMEIRO, E NÃO É DETALHE. `vessel_edicoes.acao`
-- tem lista fechada; inserir uma palavra que não está nela derruba a TRANSAÇÃO
-- INTEIRA — ou seja, a gravação do material falharia por causa da linha de
-- histórico. Esta lista é a de
-- 2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql (a mais recente,
-- doze ações), mais uma.
--
-- POR QUE O MATERIAL DEIXA RASTRO: mudar o material MOVE A DATA DE FIM DA
-- GARANTIA das peças já registradas daquele lote (o gatilho
-- `trg_vessel_lote_material_recalcula_garantia` faz isso sozinho). Uma data de
-- certificado que muda sem nenhuma linha dizendo quem mudou e por quê é a mesma
-- situação que custou horas em 06/09/2026 com as etiquetas órfãs.
--
-- ⚠️ UMA LINHA POR PEÇA JÁ REGISTRADA, e não uma por peça do lote. A trilha é
-- indexada por `codigo` — é pelo código da etiqueta que alguém procura. Escrever
-- as 500 peças de um lote grande encheria a trilha de linhas em que nada mudou:
-- peça sem registro não tem `garantia_ate` para mexer. As registradas são as
-- únicas em que a data se moveu, e são poucas (190 no banco inteiro, medido em
-- 18/09/2026).
alter table public.vessel_edicoes
  drop constraint if exists vessel_edicoes_acao_check;
alter table public.vessel_edicoes
  add constraint vessel_edicoes_acao_check
  check (acao = any (array[
    'desmarcar_gravada','sobrescrever_para_fila','sobrescrever_para_baixa',
    'registro_aprovado','registro_recusado','dono_trocado','baixar_garantia',
    'lote_excluido','peca_excluida','etiqueta_adotada','numero_trocado',
    'transferida_pela_dona','material_do_lote'
  ]));

-- ══════════════════════════════════════════════════════════════════════════
-- 2. A FUNÇÃO
-- ══════════════════════════════════════════════════════════════════════════
--
-- Devolve `json` com `ok`/`motivo`, como todas as irmãs desta família — a tela
-- já sabe ler isso (`data.ok === false` é regra de negócio recusando, `error` é
-- rede ou permissão do PostgREST).
--
-- `material_fonte := 'painel'` SEMPRE, inclusive quando a pessoa confirma
-- exatamente o que a estrutura do Bling sugeriu: o que a fonte guarda é QUEM
-- decidiu, e aqui quem decidiu foi a pessoa no painel. Gravar
-- 'bling_estrutura' num material que alguém confirmou apagaria a diferença
-- entre "a máquina achou" e "alguém olhou a bolsa" — que é a informação mais
-- útil da coluna.
create or replace function public.vessel_definir_material_do_lote(
  p_lote uuid, p_material text
) returns json
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_antes text;
  v_fonte_antes text;
  v_material text := nullif(trim(lower(coalesce(p_material, ''))), '');
  v_registradas int := 0;
begin
  -- O PORTÃO É O MESMO DAS IRMÃS. `is_vessel_admin()` é quem manda; a tela
  -- esconder o botão é conveniência, não segurança.
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- A MESMA LISTA DA TRAVA DA COLUNA (`vessel_lotes_material_check`), conferida
  -- aqui em vez de deixar o `check` estourar: erro de constraint sobe como
  -- exceção do Postgres e chega na tela como texto técnico, em inglês.
  -- ⚠️ E NÃO ACEITA NULO — ver o aviso do cabeçalho.
  if v_material is null or v_material not in ('canvas', 'couro') then
    return json_build_object('ok', false, 'motivo', 'material_invalido');
  end if;

  select material, material_fonte into v_antes, v_fonte_antes
    from public.vessel_lotes where id = p_lote;
  if not found then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;

  update public.vessel_lotes
     set material = v_material,
         material_fonte = 'painel'
   where id = p_lote;
  -- O gatilho `trg_vessel_lote_material_recalcula_garantia` recalcula a
  -- `garantia_ate` das peças registradas AQUI, dentro deste update. Nada a
  -- fazer nesta função além de contar o que ele mexeu.

  -- A TRILHA, só nas peças em que a data de fato se moveu.
  with alvos as (
    select p.codigo
      from public.vessel_pecas p
      join public.vessel_registros r on r.codigo = p.codigo
     where p.lote_id = p_lote
  ), gravadas as (
    insert into public.vessel_edicoes (codigo, acao, motivo, detalhes, feito_por)
    select a.codigo, 'material_do_lote',
           case when v_antes is null then 'material escolhido no painel'
                else 'material corrigido no painel' end,
           jsonb_build_object(
             'lote', p_lote,
             'material_antes', v_antes,
             'material_fonte_antes', v_fonte_antes,
             'material_depois', v_material,
             'material_fonte_depois', 'painel'),
           auth.uid()
      from alvos a
    returning 1
  )
  select count(*) into v_registradas from gravadas;

  return json_build_object(
    'ok', true,
    'material', v_material,
    'material_fonte', 'painel',
    'material_antes', v_antes,
    -- quantas peças já registradas tiveram a data da garantia recalculada: é o
    -- número que a tela mostra, porque é o que mexeu na vida de alguém
    'registros_recalculados', v_registradas);
end;
$$;

comment on function public.vessel_definir_material_do_lote(uuid, text) is
  'Grava o material do lote escolhido no painel de Autenticidade (fonte '
  '"painel"). Portão is_vessel_admin(). Não aceita nulo: limpar o material '
  'zeraria a garantia das peças já registradas.';

-- ── O PORTÃO ──────────────────────────────────────────────────────────────
-- Igual a `vessel_editar_lote`: fechada para `public` e `anon`, aberta para
-- `authenticated` (quem entra na Central). Revogar dos dois, um a um — revogar
-- só de `public` não fecha para `anon` (ver
-- 2026-09-16-vessel-fecha-as-funcoes-internas.sql).
revoke all on function public.vessel_definir_material_do_lote(uuid, text) from public;
revoke all on function public.vessel_definir_material_do_lote(uuid, text) from anon;
grant execute on function public.vessel_definir_material_do_lote(uuid, text) to authenticated;
