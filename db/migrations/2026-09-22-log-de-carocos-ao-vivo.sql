-- O LOG DE CAROÇOS PASSA A SER AO VIVO.
--
-- Pedido do dono em 22/09/2026: "o log de caroços pode ser ao vivo tá".
--
-- ⚠️ POR QUE AS CONSULTAS MUDARAM DE CASA. Até hoje elas moravam em JavaScript
-- (`coletor/lib/carocos-no-angu.mjs`) e um robô do GitHub Actions as rodava uma
-- vez por dia. GitHub Actions não tem como ser ao vivo — o agendamento mínimo é
-- de minutos e, medido neste repositório, atrasa de 2 a 3 horas. Ao vivo nesta
-- casa quer dizer edge function chamada pelo cron do banco, como o espelho da
-- Vessel. E a edge é Deno: ela não abre conexão de Postgres para rodar SQL
-- solta, ela chama função. Por isso as quinze consultas viraram ESTA função.
--
-- O que NÃO mudou de casa: o nome de cada conferência, a gravidade, a frase do
-- "o que fazer" e a montagem das abas continuam em
-- `supabase/functions/_shared/carocos-no-angu.js`, com teste em node. A regra é
-- a de sempre: o que decide texto e forma fica onde o teste alcança; o que fala
-- com o banco fica no banco.
--
-- ⚠️ CADA CONFERÊNCIA DEVOLVE SEMPRE AS MESMAS QUATRO COLUNAS — `quem`,
-- `quando`, `detalhe`, `valor`. É o contrato que a montagem das abas espera, e
-- há teste do lado do JavaScript conferindo que nenhuma conferência ficou sem
-- uma delas. Conferência nova aqui precisa da entrada correspondente lá.
--
-- ⚠️ E ELA DEVOLVE TUDO, sem `limit`. São ~350 linhas no total hoje, de quatro
-- campos curtos — uns 40 KB de JSON. O corte de 100 linhas por conferência é
-- decisão de LEITURA e mora no JavaScript, junto com o aviso de quantas ficaram
-- de fora; cortar aqui faria o Resumo perder o total de verdade.

create or replace function public.vessel_carocos()
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'venda-duplicada', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select contato_nome as quem,
      max(data_do_pedido)::text as quando,
      count(*)::text || ' pedidos iguais: ' || string_agg(numero, ', ' order by numero) as detalhe,
      sum(receita_liquida) as valor
      from vessel_pedidos
      where situacao_id = 9
      group by contato_nome, data_do_pedido, total_produtos
      having count(*) > 1
      order by sum(receita_liquida) desc
    ) x),
    'venda-sem-vendedor', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select contato_nome as quem, data_do_pedido::text as quando,
      'pedido ' || numero as detalhe, receita_liquida as valor
      from vessel_pedidos
      where situacao_id = 9 and vendedor_id is null
      order by data_do_pedido desc
    ) x),
    'venda-sem-item', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select p.contato_nome as quem, p.data_do_pedido::text as quando,
      'pedido ' || p.numero as detalhe, p.receita_liquida as valor
      from vessel_pedidos p
      where p.situacao_id = 9
      and not exists (select 1 from vessel_pedido_itens i where i.pedido_id = p.id)
      order by p.data_do_pedido desc
    ) x),
    'venda-valor-zero', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select contato_nome as quem, data_do_pedido::text as quando,
      'pedido ' || numero as detalhe, 0::numeric as valor
      from vessel_pedidos
      where situacao_id = 9 and coalesce(receita_liquida, 0) = 0
      order by data_do_pedido desc
    ) x),
    'venda-que-parece-teste', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select contato_nome as quem, data_do_pedido::text as quando,
      'pedido ' || numero || ' — ' ||
      case when contato_nome ilike '%teste%' or contato_nome ilike '%test %'
      then 'o nome do cliente diz teste'
      else 'valor abaixo de R$ 5' end as detalhe,
      receita_liquida as valor
      from vessel_pedidos
      where situacao_id = 9
      and (contato_nome ilike '%teste%' or contato_nome ilike '%test %'
      or receita_liquida < 5)
      order by receita_liquida desc
    ) x),
    'venda-nunca-conferida', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select contato_nome as quem, data_do_pedido::text as quando,
      'pedido ' || numero as detalhe, receita_liquida as valor
      from vessel_pedidos
      where situacao_id = 9 and conferido_no_bling_em is null
      order by data_do_pedido desc
    ) x),
    'item-sem-sku', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from (
      select coalesce(i.descricao, '(sem descrição)') as quem,
      p.data_do_pedido::text as quando,
      'pedido ' || p.numero as detalhe, i.total_do_item as valor
      from vessel_pedido_itens i
      join vessel_pedidos p on p.id = i.pedido_id
      where i.sku is null or i.sku = ''
      order by p.data_do_pedido desc
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

-- ⚠️ SÓ O SERVICE ROLE. Esta função devolve nome, WhatsApp e valor de venda de
-- gente de verdade — é a base inteira vista por um buraco de fechadura. Função
-- nova no schema `public` nasce executável por `public`, que inclui `anon`,
-- cuja chave está no bundle do site. As três linhas são necessárias, nesta
-- ordem: `revoke from public` NÃO tira concessão explícita de `authenticated`.
revoke execute on function public.vessel_carocos() from public;
revoke execute on function public.vessel_carocos() from anon;
revoke execute on function public.vessel_carocos() from authenticated;
grant  execute on function public.vessel_carocos() to service_role;

comment on function public.vessel_carocos() is
  'As 15 conferencias do "log de carocos": o que PARECE errado no sistema. '
  'Devolve {chave: [{quem, quando, detalhe, valor}]}. Quem monta a planilha e '
  'a edge vessel-log-de-carocos, e os textos moram em _shared/carocos-no-angu.js.';

-- ── o segredo e o horário ───────────────────────────────────────────────────
-- ⚠️ O SEGREDO É GERADO AQUI E NUNCA APARECE NO TEXTO DO CRON: o `disparar_robo`
-- lê a tabela na hora de chamar. É o mesmo desenho dos outros doze robôs.
insert into public.segredos_de_cron (nome, segredo)
values ('vessel-log-de-carocos', encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (nome) do nothing;

-- ⚠️ DE 10 EM 10 MINUTOS, E NÃO DE 3 EM 3 COMO O ESPELHO. Dois motivos medidos:
--   • o dado que estas conferências olham não muda mais rápido que isso — o
--     robô dos pedidos roda de hora em hora, e cadastro novo é esporádico;
--   • cada rodada faz um login no Zoho, e o Zoho LIMITA quantos tokens se
--     geram por minuto (eu mesmo estourei esse limite em 21/09 sondando).
--     O espelho já gasta 20 logins por hora; somar mais 20 seria pedir para
--     esbarrar. Com 10 minutos são 6, e os dois convivem.
-- O minuto 4 desencontra da hora cheia e do */3 do espelho.
select cron.schedule('vessel-log-de-carocos', '4,14,24,34,44,54 * * * *', $cron$
  select public.disparar_robo(
    'vessel-log-de-carocos', 'vessel-log-de-carocos', 'vessel-log-de-carocos',
    '{"origem":"cron"}'::jsonb, 120000);
$cron$);

-- ── e o vigia olha para ele também ──────────────────────────────────────────
-- Teto de 3 horas: rodando de 10 em 10 minutos, três horas são 18 rodadas
-- seguidas falhando — quebra, não soluço.
insert into public.robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
  ('vessel-log-de-carocos', 3, false,
   'Monta o "Log de carocos" no Zoho (15 conferencias do que PARECE errado). '
   'Roda de 10 em 10 minutos. Parado, o dono deixa de ver problema novo — mas '
   'nada quebra em cascata, por isso nao e critico.')
on conflict (robo) do update
  set horas_sem_sucesso_ate = excluded.horas_sem_sucesso_ate,
      critico = excluded.critico,
      porque = excluded.porque;
