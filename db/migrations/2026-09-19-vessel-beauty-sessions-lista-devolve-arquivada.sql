-- A LISTA DA BEAUTY SESSION PASSA A DEVOLVER `arquivada` POR LINHA.
--
-- ⚠️ BURACO ACHADO NA T11 (a tela de Beauty Sessions ganhar tudo), medido AO
-- VIVO em produção com `pg_get_functiondef` antes de escrever esta linha:
-- `vessel_conta_das_beauty_sessions` já recebe `p_incluir_arquivadas` (a
-- mesma R1 da irmã Private Edit) e já filtra por `s.arquivada` no `where`,
-- mas o `json_build_object` nunca devolvia esse campo por linha — só `ativa`.
--
-- O estrago: com `p_incluir_arquivadas: true` a função devolve arquivada e
-- não-arquivada MISTURADAS, sem nenhum campo para a tela separar as duas.
-- `filtros.js` (`passaNaSituacao`) lê `linha.arquivada`; com o campo sempre
-- ausente (`undefined`), "Só arquivadas" filtra um array que TEM as
-- arquivadas mas nunca as reconhece — resultado sempre vazio, calado, sem
-- erro para denunciar — e o botão "Desarquivar" não teria como saber quando
-- aparecer no lugar de "Arquivar…".
--
-- ⚠️ CONSERTO CIRÚRGICO: só acrescenta UM campo ao SELECT que já existe, na
-- MESMA posição relativa que a irmã do Private Edit usou para o par
-- ativa/arquivada. Nenhuma coluna nova, nenhum parâmetro novo, nenhuma
-- mudança de assinatura — por isso `create or replace` basta, sem `drop`, e
-- os grants sobre a MESMA assinatura (integer, boolean) são preservados. As
-- duas linhas de `revoke`/`grant` ficam mesmo assim: uma função que nascesse
-- de novo sem elas nasceria aberta para `anon`.
--
-- O corpo abaixo é cópia byte a byte do que `pg_get_functiondef` devolveu em
-- produção, com UMA linha a mais (`'arquivada', coalesce(s.arquivada,
-- false),`, logo depois de `'ativa', s.ativa,`) e nada mudado além disso —
-- inclusive a comparação `s.ativa` sem `coalesce` foi deixada exatamente como
-- estava, para o diff mostrar só a linha nova.

create or replace function public.vessel_conta_das_beauty_sessions(p_dias integer DEFAULT 7, p_incluir_arquivadas boolean DEFAULT false)
 returns json
 language plpgsql
 stable security definer
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
        -- ⚠️ A LINHA NOVA DESTA MIGRATION. `coalesce` pela mesma razão da irmã:
        -- a coluna é NOT NULL com default (nasce false), mas uma linha de
        -- outra origem sem o default aplicado não pode virar NULL na tela —
        -- NULL num `v-if`/leitura de template é o tipo de falso que passa
        -- despercebido.
        'arquivada', coalesce(s.arquivada, false),
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

revoke all on function public.vessel_conta_das_beauty_sessions(int, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_conta_das_beauty_sessions(int, boolean) to authenticated;

comment on function public.vessel_conta_das_beauty_sessions(int, boolean) is
  'Leituras (mesa e cartao separados), pessoas, pedidos, comparecimento e venda '
  'por Beauty Session. p_dias so governa a janela de venda '
  '(janela_de_venda_em_dias na resposta) — nunca filtra linha, ver filtros.js. '
  'p_incluir_arquivadas (padrao false) tira a arquivada das contas por padrao; '
  'cada linha devolvida traz ativa E arquivada, para a tela separar as duas — '
  'arquivada nao entrava no json antes desta migration, so no filtro do where. '
  'A permissao e conferida DENTRO da funcao; o grant a authenticated e so a '
  'porta, nao a tranca.';
