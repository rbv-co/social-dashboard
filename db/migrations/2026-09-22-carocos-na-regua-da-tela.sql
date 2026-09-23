-- O LOG DE CAROÇOS PASSA A USAR A RÉGUA DA TELA.
--
-- Pedido do dono em 22/09/2026: "rode uma conferência sobre o robô que revalida
-- e confere dados de vendas e quaisquer coisas que o Breno vê e pode questionar
-- diferença de dados". A conferência achou isto.
--
-- ── O QUE ESTAVA ERRADO ─────────────────────────────────────────────────────
--
-- As seis conferências de venda liam `vessel_pedidos` com `situacao_id = 9`.
-- A Gestão à Vista e a Análise de Vendas leem `bling_pedido_nota`. São tabelas
-- diferentes, e por isso o log e o painel respondiam números diferentes para a
-- mesma pergunta. Medido em 22/09, setembro:
--
--     tela  R$ 28.055,88          log  R$ 29.333,94
--
-- E a distância não era só de valor, era de ALCANCE. A tabela da tela tem 1.979
-- notas desde 01/08/2025; `vessel_pedidos` tem 464 pedidos desde 19/06/2026 e só
-- dos canais da Vessel. O log conferia R$ 160.861 de R$ 1.061.751 — 15%. Quatro
-- canais inteiros nunca tinham sido conferidos, o maior deles o Institucional,
-- com R$ 74.948,05.
--
-- ⚠️ E A RÉGUA DA TELA MUDOU TRÊS VEZES NO DIA 22/09, sem o log saber de
-- nenhuma: pedido cancelado saiu (3266b29, 09h00), nota não autorizada saiu
-- (5bc193f, 09h28) e loja fechada saiu do total (174dfda, 09h48). Cada conserto
-- na tela abria mais distância para o log — e é justamente nessa distância que
-- nasce a pergunta "por que este número está diferente daquele?".
--
-- ── A RÉGUA, AGORA UMA SÓ ───────────────────────────────────────────────────
--
-- O CTE `venda` é a tradução em SQL do que `_shared/data-da-venda.js` faz nas
-- telas. Venda é a nota que:
--   • NÃO está negada — cancelada (2), rejeitada (4) ou denegada (9) sai;
--     pendente (1, 3, 8) ou sem linha FICA, porque nota que ainda não voltou da
--     Sefaz é venda em andamento, não venda que não houve;
--   • vale o `total` da nota, com o AJUSTE MANUAL por cima quando existe — é o
--     caso do pedido 2656, que a NFC-e congelou em R$ 1.900,00 e entrou no
--     caixa por R$ 1.615,00.
--
-- ⚠️ LOJA FECHADA CONTINUA NO LOG, E ISSO NÃO É ESQUECIMENTO. A regra da tela
-- (`src/compartilhado/canal-fechado.js`) não apaga o histórico: o canal some
-- quando a janela COMEÇA depois do fechamento. O log não tem janela — ele olha
-- desde sempre —, e numa janela que começa em 2025 a Loja Dom Pedro aparece na
-- tela também. Filtrá-la aqui seria inventar uma TERCEIRA régua para consertar
-- a distância entre duas.
--
-- ⚠️ O `left join bling_lojas` É DE PROPÓSITO, E O `inner` SERIA UM BURACO.
-- Três canais da base não têm linha em `bling_lojas` (205424518, 205383545 e o
-- "0"). Com `inner join` eles sumiriam da conferência sem erro nenhum — que é
-- exatamente o defeito que esta migration existe para consertar.
--
-- ── A CONFERÊNCIA NOVA, E POR QUE ELA É SOBRE O PRÓPRIO LOG ─────────────────
--
-- `venda-sem-conferencia` lista, POR CANAL, a venda que aparece na tela e da
-- qual não temos detalhe nenhum. Não é erro: é o alcance do log, dito em voz
-- alta. Sem ela, aba de Vendas curta queria dizer "está tudo certo" e queria
-- dizer "eu nem olhei esse canal" — e são coisas opostas. É o mesmo motivo pelo
-- qual o Resumo sempre listou as conferências que deram zero.
--
-- As quatro conferências que precisam de cliente, vendedor ou peça continuam
-- rodando só onde o detalhe existe (`v.pedido_row is not null`), porque
-- `bling_pedido_nota` não guarda nome de cliente nem vendedor. Fingir que
-- cobrem tudo seria pior que dizer o que não cobrem.
--
-- ⚠️ `item-sem-sku` GANHOU FILTRO DE VENDA. Ela cruzava itens com pedidos sem
-- olhar a situação, então listava peça de pedido cancelado. Agora passa pelo
-- mesmo `venda`, como as outras.
--
-- ── A PROVA ─────────────────────────────────────────────────────────────────
--
-- Somando setembro pelas duas réguas depois desta mudança e do conserto do
-- desconto do item (`2026-09-22-item-preco-de-tabela.sql`):
--
--     tela  R$ 28.055,88          log  R$ 28.055,88
--
-- que é o mesmo número do commit 174dfda. As duas peças só fecham JUNTAS: o
-- conserto do desconto, sozinho, levaria o log de R$ 29.333,94 para R$ 30.258,21
-- e AUMENTARIA a distância.

create or replace function public.vessel_carocos()
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  with venda as (
    select
      n.pedido_id,
      coalesce(n.pedido_numero, n.pedido_id::text)            as numero,
      coalesce(l.nome, 'canal ' || n.loja_id::text)           as canal,
      n.data_da_venda::date                                   as dia,
      round(coalesce(aj.total_corrigido, n.total), 2)         as valor,
      p.id                                                    as pedido_row,
      p.contato_nome,
      p.vendedor_id,
      p.conferido_no_bling_em
    from bling_pedido_nota n
    left join bling_lojas l
           on l.loja_id::text = n.loja_id::text
    -- ⚠️ O ajuste TORTO vale menos que o dado do Bling: valor vazio ou negativo
    -- não passa e o pedido fica como veio. É a mesma postura de
    -- `_shared/valor-corrigido.js`.
    left join lateral (
      select x.total_corrigido
        from bling_pedido_ajuste_valor x
       where x.pedido_id::text = n.pedido_id::text
         and x.total_corrigido is not null
         and x.total_corrigido >= 0
       order by x.criado_em desc
       limit 1
    ) aj on true
    left join vessel_pedidos p
           on p.bling_pedido_id::text = n.pedido_id::text
          and p.situacao_id = 9
    where coalesce(n.nota_situacao, 1) not in (2, 4, 9)
  )
  select jsonb_build_object(
    'venda-duplicada', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select v.contato_nome as quem,
      max(v.dia)::text as quando,
      count(*)::text || ' pedidos iguais: ' || string_agg(v.numero, ', ' order by v.numero) as detalhe,
      sum(v.valor) as valor
      from venda v
      where v.contato_nome is not null
      group by v.contato_nome, v.dia, v.valor
      having count(*) > 1
      order by sum(v.valor) desc
    ) x),
    'venda-sem-vendedor', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select coalesce(v.contato_nome, '(sem nome)') as quem, v.dia::text as quando,
      'pedido ' || v.numero || ' · ' || v.canal as detalhe, v.valor as valor
      from venda v
      where v.pedido_row is not null and v.vendedor_id is null
      order by v.dia desc
    ) x),
    'venda-sem-item', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select coalesce(v.contato_nome, '(sem nome)') as quem, v.dia::text as quando,
      'pedido ' || v.numero || ' · ' || v.canal as detalhe, v.valor as valor
      from venda v
      where v.pedido_row is not null
      and not exists (select 1 from vessel_pedido_itens i where i.pedido_id = v.pedido_row)
      order by v.dia desc
    ) x),
    'venda-valor-zero', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select coalesce(v.contato_nome, v.canal) as quem, v.dia::text as quando,
      'pedido ' || v.numero || ' · ' || v.canal as detalhe, 0::numeric as valor
      from venda v
      where coalesce(v.valor, 0) = 0
      order by v.dia desc
    ) x),
    'venda-que-parece-teste', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select coalesce(v.contato_nome, v.canal) as quem, v.dia::text as quando,
      'pedido ' || v.numero || ' — ' ||
      case when v.contato_nome ilike '%teste%' or v.contato_nome ilike '%test %'
      then 'o nome do cliente diz teste'
      else 'valor abaixo de R$ 5' end as detalhe,
      v.valor as valor
      from venda v
      where (v.contato_nome ilike '%teste%' or v.contato_nome ilike '%test %'
      or v.valor < 5)
      order by v.valor desc
    ) x),
    'venda-nunca-conferida', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select coalesce(v.contato_nome, '(sem nome)') as quem, v.dia::text as quando,
      'pedido ' || v.numero || ' · ' || v.canal as detalhe, v.valor as valor
      from venda v
      where v.pedido_row is not null and v.conferido_no_bling_em is null
      order by v.dia desc
    ) x),
    -- ⚠️ A CONFERÊNCIA SOBRE O PRÓPRIO LOG: o que ele NÃO alcança, por canal.
    'venda-sem-conferencia', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select v.canal as quem,
      min(v.dia)::text || ' a ' || max(v.dia)::text as quando,
      count(*)::text || ' pedidos: temos a nota, não temos cliente, vendedor nem peça' as detalhe,
      sum(v.valor) as valor
      from venda v
      where v.pedido_row is null
      group by v.canal
      order by sum(v.valor) desc
    ) x),
    'item-sem-sku', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select coalesce(i.descricao, '(sem descrição)') as quem,
      v.dia::text as quando,
      'pedido ' || v.numero || ' · ' || v.canal as detalhe, i.total_do_item as valor
      from vessel_pedido_itens i
      join venda v on v.pedido_row = i.pedido_id
      where i.sku is null or i.sku = ''
      order by v.dia desc
    ) x),
    'cadastro-de-teste', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select nome as quem, criado_em::date::text as quando,
      'origem: ' || origem as detalhe, null::numeric as valor
      from vessel_lista_espera
      where origem ilike '%teste%' or nome ilike '%teste%'
      order by criado_em desc
    ) x),
    'email-repetido', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select lower(email) as quem, max(criado_em)::date::text as quando,
      count(*)::text || ' cadastros: ' || string_agg(nome, ', ') as detalhe,
      null::numeric as valor
      from vessel_lista_espera
      where email is not null and email <> ''
      group by lower(email) having count(*) > 1
    ) x),
    'whatsapp-torto', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select nome as quem, criado_em::date::text as quando,
      'guardado como: ' || coalesce(whatsapp, '(vazio)') as detalhe,
      null::numeric as valor
      from vessel_lista_espera
      where whatsapp is null
      or length(regexp_replace(whatsapp, '\D', '', 'g')) < 10
      order by criado_em desc
    ) x),
    'sessao-sem-salao', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select codigo as quem, quando::text as quando,
      'praça ' || coalesce(praca, '—') as detalhe, null::numeric as valor
      from vessel_beauty_sessions
      where (parceiro is null or parceiro = '') and ativa
      order by quando desc
    ) x),
    'evento-ativo-no-passado', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select codigo as quem, quando::date::text as quando,
      'Private Edit' as detalhe, null::numeric as valor
      from vessel_private_edits where ativa and quando < now()
      union all
      select codigo, quando::text, 'Beauty Session', null::numeric
      from vessel_beauty_sessions where ativa and quando < current_date
    ) x),
    'garantia-sem-peca', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select r.nome as quem, r.registrado_em::date::text as quando,
      'selo ' || r.codigo as detalhe, null::numeric as valor
      from vessel_registros r
      where not exists (select 1 from vessel_pecas p where p.codigo = r.codigo)
      order by r.registrado_em desc
    ) x),
    'problema-meta', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select coalesce(campanha_nome, conta_nome, '(sem nome)') as quem,
      primeira_vez::date::text as quando,
      titulo || coalesce(' — ' || detalhe, '') as detalhe,
      null::numeric as valor
      from gt_problemas_meta
      where resolvido_em is null
      order by grave desc nulls last, primeira_vez desc
    ) x),
    'robo-parado', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select robo as quem,
      coalesce(ultimo_sucesso::date::text, 'nunca') as quando,
      situacao || coalesce(' — parou em ' || array_to_string(quem_falhou, ', '), '')
      || ' (teto de ' || horas_sem_sucesso_ate || 'h)' as detalhe,
      null::numeric as valor
      from robos_saude
      where situacao <> 'ok'
      order by critico desc, robo
    ) x)
  );
$function$;

revoke execute on function public.vessel_carocos() from public;
revoke execute on function public.vessel_carocos() from anon;
revoke execute on function public.vessel_carocos() from authenticated;
grant  execute on function public.vessel_carocos() to service_role;

comment on function public.vessel_carocos() is
  'As 16 conferencias do "log de carocos": o que PARECE errado no sistema. '
  'Desde 22/09/2026 a venda e a MESMA da tela (bling_pedido_nota, nota nao '
  'negada, com ajuste manual) — ate entao era vessel_pedidos, e log e painel '
  'discordavam. Devolve {chave: [{quem, quando, detalhe, valor}]}.';
