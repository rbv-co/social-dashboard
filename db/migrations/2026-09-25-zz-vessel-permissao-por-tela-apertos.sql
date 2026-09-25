-- B13, SEGUNDA RODADA: OS TRÊS APERTOS QUE O DONO DECIDIU (25/09/2026).
--
-- A primeira rodada (2026-09-25-vessel-permissao-por-tela-no-banco.sql) pôs
-- cada função do Comercial Vessel na chave da SUA tela e deixou três pontos
-- para o dono. Ele decidiu:
--
-- 1. A BASE COMUM (clientes, visitas, vendas e itens das vendas) passa a exigir
--    Private Appointment 'ver' na leitura direta. Conferido antes de fechar
--    (25/09/2026): na Central, só `tela-de-atendimentos.vue` lê essas tabelas
--    direto; as telas de Beauty Sessions, Private Edit, Stylist Circle e
--    Material Gráfico só leem por funções security definer (que não passam pela
--    política). As três funções SEM security definer que as leem
--    (vessel_codigo_de_evento_usado, vessel_contexto_da_loja,
--    vessel_data_da_compra) não são executáveis pela Central e só são chamadas
--    de dentro de funções security definer. O robô da planilha
--    (vessel-espelhar-lista) usa a chave de serviço. A Base de Leads do Meta
--    Ads lê visitas e clientes pela política PRÓPRIA dela
--    (`*_leitura_meta_leads`, is_vessel_leads()), que não muda.
-- 2. VEIO / NÃO VEIO (`vessel_situacao_do_atendimento`) passa a exigir EDITAR
--    (Private Appointment ou Private Edit). Ela grava: pedia só ver. As duas
--    telas só mostram os botões com editar (o Private Appointment já fazia; o
--    Private Edit passou a fazer nesta entrega — gestosDaConvidada).
-- 3. A LISTA DAS PARCEIRAS (`vessel_rastreio_dos_stylists`) devolve a quem não
--    tem o Stylist Circle (o Material Gráfico) só código, nome, cidade, ativa e
--    etapa. Quem tem Stylist Circle continua recebendo tudo.
--
-- O corpo das duas funções é o `pg_get_functiondef` de 25/09/2026, depois da
-- primeira rodada; o aplicador (coletor/aplicar-vessel-permissao-por-tela-
-- apertos.mjs) confere o sha256 antes e PARA se mudou.

-- ── 1. A base comum: leitura direta só com Private Appointment ──────────────
alter policy vessel_pessoas_le_central on public.vessel_pessoas
  using (public.vessel_pode('atendimentos', 'ver'));
alter policy vessel_atendimentos_le_central on public.vessel_atendimentos
  using (public.vessel_pode('atendimentos', 'ver'));
alter policy vessel_pedidos_le_central on public.vessel_pedidos
  using (public.vessel_pode('atendimentos', 'ver'));
alter policy vessel_pedido_itens_le_central on public.vessel_pedido_itens
  using (public.vessel_pode('atendimentos', 'ver'));

comment on policy vessel_pessoas_le_central on public.vessel_pessoas is
  'B13 (25/09/2026): leitura direta so com Private Appointment ver. As outras telas leem por funcoes security definer.';
comment on policy vessel_atendimentos_le_central on public.vessel_atendimentos is
  'B13 (25/09/2026): leitura direta so com Private Appointment ver. As outras telas leem por funcoes security definer.';
comment on policy vessel_pedidos_le_central on public.vessel_pedidos is
  'B13 (25/09/2026): leitura direta so com Private Appointment ver. As outras telas leem por funcoes security definer.';
comment on policy vessel_pedido_itens_le_central on public.vessel_pedido_itens is
  'B13 (25/09/2026): leitura direta so com Private Appointment ver (irma de vessel_pedidos). Nenhuma tela le direto hoje.';

comment on function public.is_vessel_atendimentos() is  -- familia: so o comentario da propria trava
  'FAMILIA do Comercial Vessel (qualquer tela). Desde o B13 (25/09/2026) so o convite publico a usa ("abertura da equipe nao conta"). Funcao ou politica de UMA tela usa vessel_pode(ferramenta, nivel).';

-- ── 2. Veio / não veio passa a exigir EDITAR ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.vessel_situacao_do_atendimento(p_id bigint, p_situacao text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_atual public.vessel_atendimentos%rowtype;
begin
  if not (public.vessel_pode('atendimentos', 'editar') or public.vessel_pode('atendimentos.private-edit', 'editar')) then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  -- A lista fechada mora AQUI, e não num CHECK novo: a coluna já tem o seu, e
  -- este recorte é menor de propósito. 'solicitado' não entra — ninguém
  -- "desmarca" uma visita de volta para pedido; e 'cancelado' entra porque
  -- desistir antes da hora é diferente de faltar.
  if p_situacao is null or p_situacao not in
     ('confirmado', 'realizado', 'no_show', 'remarcado', 'cancelado') then
    return json_build_object('ok', false, 'situacao', 'situacao_invalida');
  end if;

  select * into v_atual from public.vessel_atendimentos where id = p_id;
  if v_atual.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ QA11 DO PLANO: "no-show não vira presença". Só 'realizado' carimba hora
  -- de chegada; todo o resto APAGA o carimbo. Sem isso, marcar "veio" por
  -- engano e corrigir para "não veio" deixaria a hora de chegada para trás, e o
  -- show rate contaria quem não veio.
  update public.vessel_atendimentos
     set status      = p_situacao,
         presenca_em = case when p_situacao = 'realizado'
                            then coalesce(presenca_em, now()) else null end,
         atualizado_em = now()
   where id = p_id;

  return json_build_object('ok', true, 'situacao', p_situacao,
                           'antes', v_atual.status);
end;
$function$;

-- ── 3. A lista das parceiras, recortada para quem só tem o Material Gráfico ──
CREATE OR REPLACE FUNCTION public.vessel_rastreio_dos_stylists(p_dias integer DEFAULT 7, p_incluir_desativadas boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dias int := greatest(coalesce(p_dias, 7), 0);
  v_saida json;
begin
  if not (public.vessel_pode('atendimentos.stylist-circle', 'ver') or public.vessel_pode('atendimentos.material-grafico', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  with vendas as (select * from public.vessel_vendas_dos_encontros(v_dias))
  select coalesce(json_agg(linha order by linha ->> 'codigo'), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', s.codigo,
        'nome', s.nome,
        'cidade', s.cidade,
        -- ⚠️ 24/09/2026: a etapa é uma linha de `vessel_stylist_etapas`.
        'etapa_id', s.etapa_id,
        'etapa', et.nome,
        'etapa_tipo', et.tipo,
        'etapa_ordem', et.ordem,
        -- ⚠️ 24/09/2026 (Private Edit só com liberada, e os motivos de saída).
        'etapa_libera_private_edit', et.libera_private_edit,
        'saida_motivo_id', case when et.tipo = 'saida' then sa.motivo_id end,
        'saida_motivo', case when et.tipo = 'saida' then ms.nome end,
        'saida_nota', case when et.tipo = 'saida' then sa.nota end,
        'praca_preview', s.praca_preview,
        'ativa', s.ativa,
        'whatsapp', s.whatsapp,
        'instagram', s.instagram,
        'atuacao', s.atuacao,
        -- T11: a ficha operacional.
        'loja', s.loja,
        'origem_contato', s.origem_contato,
        'responsavel', s.responsavel,
        'prospectado_em', s.prospectado_em,
        'proxima_acao', s.proxima_acao,
        'proxima_acao_em', s.proxima_acao_em,
        'observacoes', s.observacoes,
        -- ⚠️ 24/09/2026: "sem contato ainda" — alguém vai completar.
        'sem_contato', s.sem_contato,
        -- ⚠️ 24/09/2026: a ativação é a da etapa (a mesma função do placar); o
        -- primeiro Private Edit agendado continua, com o nome dele.
        'ativada_em', public.vessel_stylist_ativada_em(s.id),
        'private_edit_agendado_em', s.ativada_em,
        'encontros_realizados', ee.realizados,
        'ultima_private_edit', ee.ultima,
        'proxima_data_permitida', ee.ultima + 45,
        'receita_dos_encontros', (select coalesce(sum(v.receita), 0) from vendas v
                                   where v.stylist_id = s.id),
        'contatos', (select count(*)::int from public.vessel_stylist_contatos c where c.stylist_id = s.id),
        'ultimo_contato_em', (select max(c.criado_em) from public.vessel_stylist_contatos c where c.stylist_id = s.id),
        'aberturas', (select count(*)::int from public.vessel_stylist_aberturas a
                       where a.codigo = s.codigo),
        'clientes', (select count(distinct o.pessoa_id)::int
                       from public.vessel_origens o where o.stylist_id = s.codigo),
        'pedidos', (select count(*)::int from public.vessel_atendimentos t
                     where not coalesce(t.teste, false)
                       and exists (select 1 from public.vessel_origens o
                                    where o.stylist_id = s.codigo
                                      and o.pessoa_id = t.pessoa_id)),
        'confirmados', (select count(*)::int from public.vessel_atendimentos t
                         where not coalesce(t.teste, false)
                           and t.status in ('confirmado', 'realizado', 'no_show')
                           and exists (select 1 from public.vessel_origens o
                                        where o.stylist_id = s.codigo
                                          and o.pessoa_id = t.pessoa_id)),
        'compareceram', (select count(*)::int from public.vessel_atendimentos t
                          where not coalesce(t.teste, false) and t.status = 'realizado'
                            and exists (select 1 from public.vessel_origens o
                                         where o.stylist_id = s.codigo
                                           and o.pessoa_id = t.pessoa_id)),
        'receita', (select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)
                      from public.vessel_pedidos p
                     where p.situacao_id = 9
                       and exists (select 1 from public.vessel_origens o
                                    where o.stylist_id = s.codigo and o.pessoa_id = p.pessoa_id)
                       and exists (select 1 from public.vessel_atendimentos t
                                    where t.pessoa_id = p.pessoa_id
                                      and not coalesce(t.teste, false)
                                      and t.status = 'realizado'
                                      and p.data_do_pedido
                                            between (coalesce(t.quando, t.criado_em)
                                                      at time zone 'America/Sao_Paulo')::date
                                                and (coalesce(t.quando, t.criado_em)
                                                      at time zone 'America/Sao_Paulo')::date
                                                    + v_dias)),
        'janela_de_venda_em_dias', v_dias
      ) as linha
      from public.vessel_stylists s
      join public.vessel_stylist_etapas et on et.id = s.etapa_id
      left join lateral public.vessel_stylist_saida_atual(s.id) sa on true
      left join public.vessel_stylist_motivos_de_saida ms on ms.id = sa.motivo_id
      cross join lateral (
        select count(*) filter (where e.status = 'realizado')::int as realizados,
               max(e.realizado_em) filter (where e.status = 'realizado') as ultima
          from public.vessel_private_edits e
         where e.stylist_id = s.id and not coalesce(e.teste, false)
           and not coalesce(e.arquivada, false)
      ) ee
      where not coalesce(s.teste, false)
        and (coalesce(p_incluir_desativadas, false) or coalesce(s.ativa, true))
    ) as linhas;


  -- ⚠️ QUEM NÃO TEM O STYLIST CIRCLE (hoje: só o Material Gráfico, que é só
  -- leitura e mostra os QR) recebe SÓ o que o QR precisa: código, nome,
  -- cidade, se está ativa e a etapa (nome + a marca de que libera o Private
  -- Edit — é ela que decide se o QR aparece). WhatsApp, Instagram,
  -- observações, responsável, próxima ação e os números NÃO saem daqui para
  -- ele. Lista do que o Material Gráfico lê: itemDaStylist(), em
  -- src/ferramentas/comercial-vessel/material-grafico-regras.js. A ordem é a mesma.
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    select coalesce(json_agg(json_build_object(
             'codigo', x.l -> 'codigo',
             'nome', x.l -> 'nome',
             'cidade', x.l -> 'cidade',
             'ativa', x.l -> 'ativa',
             'etapa', x.l -> 'etapa',
             'etapa_libera_private_edit', x.l -> 'etapa_libera_private_edit') order by x.n), '[]'::json)
      into v_saida
      from json_array_elements(v_saida) with ordinality as x(l, n);
  end if;

  return v_saida;
end;
$function$;
