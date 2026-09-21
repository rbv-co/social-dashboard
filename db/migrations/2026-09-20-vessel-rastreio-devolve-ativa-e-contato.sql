-- O PAINEL DO STYLIST CIRCLE PASSA A DEVOLVER `ativa`, `whatsapp`, `instagram`
-- E `atuacao` POR LINHA, E GANHA `p_incluir_desativadas`.
--
-- ⚠️ BURACO ACHADO NA T12 (a tela do Stylist Circle ganhar cadastrar, corrigir
-- e desativar), medido AO VIVO em produção com `pg_get_functiondef` antes de
-- escrever esta linha: `vessel_rastreio_dos_stylists` já filtra por
-- `coalesce(s.ativa, true)` no `where` (desde
-- `2026-09-19-vessel-stylist-mexer.sql`), mas o `json_build_object` nunca
-- devolvia esse campo por linha — e também nunca devolvia `whatsapp`,
-- `instagram` nem `atuacao`, os campos que o formulário de corrigir precisa
-- pré-preencher.
--
-- O estrago, sem este conserto: a tela não teria como saber se uma parceira
-- está desativada (o campo nunca chegava) e por isso não conseguiria decidir
-- entre mostrar "Desativar" ou "Reativar" — e, porque a função SEMPRE exclui
-- quem está desativada, um filtro de "Só desativadas" viria vazio para
-- sempre, deixando o botão "Reativar" inalcançável.
--
-- ⚠️ ASSINATURA MUDA (ganha `p_incluir_desativadas boolean`): `create or
-- replace` NÃO troca uma função por outra de lista de parâmetros diferente —
-- cria uma SEGUNDA, sobrecarregada, e uma chamada com só `p_dias` passaria a
-- morrer com "function is not unique". Por isso o `drop function if exists`
-- na assinatura antiga vem ANTES do `create`, e os grants são refeitos depois
-- — um `drop` não carrega os grants antigos para a função nova.
--
-- O corpo abaixo é cópia byte a byte do que `pg_get_functiondef` devolveu em
-- produção, com:
--   · o parâmetro `p_incluir_desativadas boolean default false` acrescentado
--     à assinatura (mesmo formato de `p_incluir_arquivadas` nas irmãs);
--   · quatro linhas novas no `json_build_object` — `ativa`, `whatsapp`,
--     `instagram`, `atuacao` — logo depois de `praca_preview`;
--   · o `where` trocando `and coalesce(s.ativa, true)` por
--     `and (coalesce(p_incluir_desativadas, false) or coalesce(s.ativa,
--     true))` — o padrão continua escondendo quem está desativada; só quando
--     a tela pede explicitamente é que elas voltam.
-- Nada mais mudou: mesma conta de aberturas/clientes/pedidos/confirmados/
-- compareceram/receita, mesma janela de venda, mesmo `order by`.

drop function if exists public.vessel_rastreio_dos_stylists(integer);

create or replace function public.vessel_rastreio_dos_stylists(p_dias integer DEFAULT 7, p_incluir_desativadas boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dias int := greatest(coalesce(p_dias, 7), 0);
  v_saida json;
begin
  -- ⚠️ A CONFERÊNCIA DE PERMISSÃO MORA AQUI DENTRO, não no grant: `security
  -- definer` roda como dono, e `authenticated` é TODO mundo que fez login no
  -- iamundi. Sem esta linha, qualquer conta do sistema leria a lista inteira de
  -- stylists da marca — nome, cidade e quanto cada uma vendeu.
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select coalesce(json_agg(linha order by linha ->> 'codigo'), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', s.codigo,
        'nome', s.nome,
        'cidade', s.cidade,
        'estagio', s.estagio,
        'praca_preview', s.praca_preview,
        -- ⚠️ AS QUATRO LINHAS NOVAS DESTA MIGRATION. `ativa` é o que falta para
        -- a tela decidir entre "Desativar" e "Reativar"; `whatsapp`,
        -- `instagram` e `atuacao` são os campos que o formulário de corrigir
        -- precisa pré-preencher. `whatsapp` é dado pessoal e continua atrás
        -- do MESMO portão que já protege esta tela inteira
        -- (`is_vessel_atendimentos()`, conferido acima) — nenhuma trava nova
        -- foi criada nem precisa ser.
        'ativa', s.ativa,
        'whatsapp', s.whatsapp,
        'instagram', s.instagram,
        'atuacao', s.atuacao,
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
        -- ⚠️ CADA PEDIDO CONTA UMA VEZ SÓ, mesmo que a cliente tenha duas
        -- visitas realizadas cuja janela pega a mesma compra.
        'receita', (select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)
                      from public.vessel_pedidos p
                     where exists (select 1 from public.vessel_origens o
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
      where not coalesce(s.teste, false)
        and (coalesce(p_incluir_desativadas, false) or coalesce(s.ativa, true))
    ) as linhas;

  return v_saida;
end;
$function$;

-- ⚠️ OS GRANTS NÃO SOBREVIVEM AO `drop`: refeitos aqui, na assinatura NOVA.
-- Só `authenticated` (a Central) — nunca `anon`, que é quem abre página
-- pública. `whatsapp` é dado pessoal; ele sai desta função só para quem já
-- está autenticado E passa por `is_vessel_atendimentos()` dentro do corpo.
revoke all on function public.vessel_rastreio_dos_stylists(integer, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_rastreio_dos_stylists(integer, boolean) to authenticated;

comment on function public.vessel_rastreio_dos_stylists(integer, boolean) is
  'O painel do Stylist Circle: aberturas, clientes, pedidos, comparecimento e '
  'venda por stylist. p_dias so governa a janela de venda '
  '(janela_de_venda_em_dias na resposta) — nunca filtra linha, ver filtros.js. '
  'p_incluir_desativadas (padrao false) tira quem esta desativada das contas '
  'por padrao; cada linha devolvida traz ativa, whatsapp, instagram e atuacao '
  '— nenhum dos quatro entrava no json antes desta migration. whatsapp e dado '
  'pessoal e continua atras do MESMO portao desta funcao inteira '
  '(is_vessel_atendimentos()), sem trava nova. A permissao e conferida DENTRO '
  'da funcao; o grant a authenticated e so a porta, nao a tranca.';
