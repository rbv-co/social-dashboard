-- ARQUIVAR NAO E ENCERRAR, E A DIFERENCA E NAS CONTAS.
--   · encerrada  (ativa = false) = acabou como devia. CONTINUA contando: e
--     historico, e historico e o que responde "quanto esse canal vendeu".
--   · arquivada  (arquivada = true) = nao devia estar ali: duplicata, engano
--     feito depois que gente ja tinha entrado. SAI das contas e sai da lista.
--     O dado FICA no banco — arquivar nao apaga nada.
--
-- ⚠️ Sem essa diferenca, arquivar uma duplicata deixaria a receita contada DUAS
-- VEZES — que e justamente o que arquivar existe para resolver.
--
-- ⚠️ O FILTRO ENTRA PELO MESMO CAMINHO QUE `teste` JA USA nas funcoes de conta:
-- o `where` da consulta de fora, sobre a linha do evento. Nao se inventa um
-- segundo jeito de esconder linha. (Em `vessel_beauty_sessions` nao existe
-- coluna `teste` e a consulta de fora nao tinha `where` nenhum — entao o
-- `where` nasce aqui, no mesmo lugar onde o de `vessel_private_edits` mora.)
alter table public.vessel_private_edits
  add column if not exists arquivada boolean not null default false;
alter table public.vessel_beauty_sessions
  add column if not exists arquivada boolean not null default false;

comment on column public.vessel_private_edits.arquivada is
  'Fora das contas e fora da lista. Diferente de ativa=false (encerrada), que continua contando.';
comment on column public.vessel_beauty_sessions.arquivada is
  'Fora das contas e fora da lista. Diferente de ativa=false (encerrada), que continua contando.';

-- ⚠️ DERRUBAR ANTES DE CRIAR, E NAO SO `create or replace`.
-- `create or replace function` NAO troca uma funcao por outra de lista de
-- argumentos diferente: ele CRIA UMA SEGUNDA, sobrecarregada. As duas
-- passariam a existir, e a chamada das telas que estao no ar — um unico
-- parametro, `{ "p_dias": 7 }` — morreria com "function is not unique".
-- Por isso as duas antigas caem primeiro, na MESMA transacao em que as novas
-- nascem: DDL no Postgres e transacional, entao nao existe um instante em que
-- a tela de alguem encontre a funcao faltando.
drop function if exists public.vessel_conta_das_private_edits(int);
drop function if exists public.vessel_conta_das_beauty_sessions(int);

-- ── a conta por encontro ───────────────────────────────────────────────────
/**
 * "Receita por Private Edit e repetição do stylist" — o KPI principal do canal,
 * segundo o módulo 07. Mesma régua de janela de venda da Central.
 *
 * ⚠️ `p_incluir_arquivadas` NASCE `false`, e e por isso que a tela que ja esta
 * no ar continua funcionando sem mudar uma linha: ela manda so `p_dias`, cai no
 * padrao, e a arquivada fica de fora das contas — como tem de ficar.
 * O parametro existe porque um botao de "Desarquivar" precisa CONSEGUIR VER o
 * que foi arquivado; uma linha que nunca mais pode ser listada nunca mais pode
 * ser desarquivada.
 */
create or replace function public.vessel_conta_das_private_edits(
  p_dias int default 14,
  p_incluir_arquivadas boolean default false
)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_dias int := greatest(coalesce(p_dias, 14), 0);
  -- ⚠️ `coalesce` aqui porque quem manda `p_incluir_arquivadas: null` de fora
  -- nao cai no default do parametro — cai em NULL, e `where NULL` esconderia
  -- TUDO, lista vazia e sem erro nenhum para denunciar.
  v_incluir boolean := coalesce(p_incluir_arquivadas, false);
  v_saida json;
begin
  -- ⚠️ A PERMISSÃO É CONFERIDA AQUI DENTRO: `security definer` roda como dono, e
  -- `authenticated` é todo mundo que fez login no sistema.
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select coalesce(json_agg(linha order by linha ->> 'quando' desc), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', e.codigo,
        'quando', e.quando,
        'anfitria', s.nome,
        'stylist', s.codigo,
        'local', e.local,
        'vagas', e.vagas,
        'responderam', (select count(*)::int from public.vessel_atendimentos t
                         where t.evento_codigo = e.codigo and not coalesce(t.teste, false)),
        'disseram_sim', (select count(*)::int from public.vessel_atendimentos t
                          where t.evento_codigo = e.codigo and not coalesce(t.teste, false)
                            and t.rsvp = 'sim'),
        'confirmadas', (select count(*)::int from public.vessel_atendimentos t
                         where t.evento_codigo = e.codigo and not coalesce(t.teste, false)
                           and t.status in ('confirmado', 'realizado', 'no_show')),
        'compareceram', (select count(*)::int from public.vessel_atendimentos t
                          where t.evento_codigo = e.codigo and not coalesce(t.teste, false)
                            and t.status = 'realizado'),
        -- ⚠️ Cada pedido conta uma vez só, e a janela viaja na resposta: não
        -- existe no dado nenhum campo dizendo "esta compra veio daquele
        -- encontro" — o que existe é a mesma cliente comprando perto dele.
        'receita', (select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)
                      from public.vessel_pedidos p
                     where exists (select 1 from public.vessel_atendimentos t
                                    where t.evento_codigo = e.codigo
                                      and t.pessoa_id = p.pessoa_id
                                      and not coalesce(t.teste, false)
                                      and t.status = 'realizado')
                       and p.data_do_pedido
                             between (e.quando at time zone 'America/Sao_Paulo')::date
                                 and (e.quando at time zone 'America/Sao_Paulo')::date + v_dias),
        'janela_de_venda_em_dias', v_dias
      ) as linha
      from public.vessel_private_edits e
      join public.vessel_stylists s on s.id = e.stylist_id
      where not coalesce(e.teste, false)
        and (v_incluir or not coalesce(e.arquivada, false))
    ) as linhas;

  return v_saida;
end;
$function$;

-- ⚠️ O `drop` acima levou junto os grants desta funcao. Sem repetir o par
-- abaixo, a funcao renasceria aberta para `public` (e portanto para a pagina
-- publica, via `anon`). O acesso e EXATAMENTE o mesmo de antes: so
-- `authenticated`.
revoke all on function public.vessel_conta_das_private_edits(int, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_conta_das_private_edits(int, boolean) to authenticated;

-- ── a conta de cada sessão, do QR à venda ──────────────────────────────────
/**
 * Leram → preencheram → pediram visita → compareceram → compraram, por sessão,
 * com a MESA e o CARTÃO contados separados.
 *
 * ⚠️ "LERAM" NÃO É GENTE, É LEITURA. A mesma pessoa que abre duas vezes conta
 * duas. Não dá para ser diferente sem escrever no navegador dela, e o módulo 10
 * proíbe — um QR escaneado não é um contato. Por isso a coluna se chama
 * `leituras`, e nunca "visitantes": a tela que chamar isso de pessoa está
 * mentindo, e quem lê decide orçamento com esse número.
 *
 * ⚠️ A CONTA DE PESSOAS É POR pessoa_id, NÃO POR LINHA DE ORIGEM. `vessel_origens`
 * só acrescenta (first touch), então a mesma cliente que preenche a mesa e
 * depois o cartão deixa DUAS linhas lá. Somar linhas daria à sessão o dobro do
 * que ela trouxe.
 *
 * ⚠️ A JANELA DA VENDA É ESCOLHA, e viaja na resposta: não existe no dado
 * nenhum campo dizendo "esta compra veio daquela sessão". O que existe é a
 * mesma cliente comprando perto da visita. Chamar isso de conversão sem dizer a
 * régua é inventar precisão.
 *
 * ⚠️ `p_incluir_arquivadas` nasce `false` pelo mesmo motivo da funcao de cima:
 * a tela no ar manda so `p_dias` e continua certa, e a sessao arquivada sai da
 * receita em vez de soma-la duas vezes.
 */
create or replace function public.vessel_conta_das_beauty_sessions(
  p_dias int default 7,
  p_incluir_arquivadas boolean default false
)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_dias int := greatest(coalesce(p_dias, 7), 0);
  -- ⚠️ Mesmo cuidado da outra: NULL vindo de fora nao cai no default, e um
  -- `where NULL` devolveria lista vazia sem erro nenhum.
  v_incluir boolean := coalesce(p_incluir_arquivadas, false);
  v_saida json;
begin
  -- A permissão mora AQUI DENTRO, não no grant: `security definer` roda como
  -- dono, e `authenticated` é todo mundo que fez login no iamundi.
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select coalesce(json_agg(linha order by linha ->> 'quando' desc), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', s.codigo,
        'quando', s.quando,
        'praca', s.praca,
        'loja', s.loja,
        'parceiro', s.parceiro,
        'ativa', s.ativa,
        'leituras_mesa', (select count(*)::int from public.vessel_sessao_aberturas a
                           where a.codigo = s.codigo and a.peca = 'mesa'),
        'leituras_cartao', (select count(*)::int from public.vessel_sessao_aberturas a
                             where a.codigo = s.codigo and a.peca = 'cartao'),
        'pessoas', (select count(distinct o.pessoa_id)::int
                      from public.vessel_origens o where o.evento_id = s.codigo),
        'pedidos', (select count(*)::int from public.vessel_atendimentos t
                     where not coalesce(t.teste, false)
                       and exists (select 1 from public.vessel_origens o
                                    where o.evento_id = s.codigo
                                      and o.pessoa_id = t.pessoa_id)),
        'confirmados', (select count(*)::int from public.vessel_atendimentos t
                         where not coalesce(t.teste, false)
                           and t.status in ('confirmado', 'realizado', 'no_show')
                           and exists (select 1 from public.vessel_origens o
                                        where o.evento_id = s.codigo
                                          and o.pessoa_id = t.pessoa_id)),
        'compareceram', (select count(*)::int from public.vessel_atendimentos t
                          where not coalesce(t.teste, false) and t.status = 'realizado'
                            and exists (select 1 from public.vessel_origens o
                                         where o.evento_id = s.codigo
                                           and o.pessoa_id = t.pessoa_id)),
        -- ⚠️ `receita_liquida`, nunca `total_do_bling`: o segundo sai ~6% maior
        -- porque não desconta o desconto do item, e inflaria toda sessão.
        'receita', (select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)
                      from public.vessel_pedidos p
                     where exists (select 1 from public.vessel_origens o
                                    where o.evento_id = s.codigo and o.pessoa_id = p.pessoa_id)
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
      from public.vessel_beauty_sessions s
      where (v_incluir or not coalesce(s.arquivada, false))
    ) as linhas;

  return v_saida;
end;
$function$;

-- ⚠️ Mesma historia: o `drop` apagou os grants, e sem estas duas linhas a
-- funcao renasceria aberta para `public`. O acesso continua identico ao de
-- antes: so `authenticated`.
revoke all on function public.vessel_conta_das_beauty_sessions(int, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_conta_das_beauty_sessions(int, boolean) to authenticated;

-- ⚠️ O `drop` tambem levou o comentario da funcao. Reposto igual ao de antes.
comment on function public.vessel_conta_das_beauty_sessions(int, boolean) is
  'Leituras (mesa e cartao separados), pessoas, pedidos, comparecimento e venda '
  'por Beauty Session. ⚠️ "leituras" e LEITURA, nao pessoa: a mesma cliente '
  'abrindo duas vezes conta duas. A permissao e conferida DENTRO da funcao; o '
  'grant a authenticated e so a porta, nao a tranca.';
