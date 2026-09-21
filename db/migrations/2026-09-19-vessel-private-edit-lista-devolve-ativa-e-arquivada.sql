-- A LISTA DO PRIVATE EDIT PASSA A DEVOLVER `ativa`, `arquivada`, `praca` e
-- `loja` POR LINHA.
--
-- ⚠️ BURACOS ACHADOS NA T10, NÃO PREVISTOS POR NINGUÉM ANTES. Medido ao vivo em
-- produção antes deste conserto: `pg_get_functiondef` de
-- `vessel_conta_das_private_edits` não continha `'arquivada'`, `'ativa'`,
-- `'praca'` nem `'loja'` em lugar nenhum do `json_build_object` — mesmo a
-- função já recebendo `p_incluir_arquivadas` (Ruling R1) e a tabela já tendo
-- as quatro colunas.
--
-- O estrago de cada um:
--   · SEM `arquivada`: com `p_incluir_arquivadas: true` a função devolve
--     arquivada e não-arquivada MISTURADAS, sem nenhum campo para a tela
--     separar as duas. O filtro de tela (`filtros.js`, `passaNaSituacao`) lê
--     `linha.arquivada`; com o campo sempre ausente, "Só arquivadas" filtra um
--     array que TEM as arquivadas mas nunca as reconhece — resultado sempre
--     vazio, calado, sem erro para denunciar.
--   · SEM `ativa`: é ela que separa "Encerrada" de "Aceitando" e decide se o
--     botão mostra "Encerrar" ou "Reabrir" — sem ela, todo encontro lido pela
--     lista parece sempre aberto, mesmo depois de encerrado, e o filtro
--     "Só encerradas" também fica sempre vazio.
--   · SEM `praca`/`loja`: a barra de lista filtra por `loja` (`filtros.js`) e
--     nunca acha nada além de "Todas"; e a tela de editar não tem como
--     pré-preencher a praça e a loja ATUAIS do encontro — a pessoa editaria às
--     cegas, sem saber se está prestes a TROCAR a praça ou só confirmá-la.
--
-- ⚠️ CONSERTO CIRÚRGICO: só acrescenta os quatro campos ao SELECT que já
-- existe. Nenhuma coluna nova, nenhum parâmetro novo, nenhuma mudança na
-- assinatura — por isso não precisa de `drop function` (ver R2 do plano: só
-- precisaria se a assinatura mudasse) e os grants de `create or replace` sobre
-- a MESMA assinatura são preservados. As duas linhas de `revoke`/`grant`
-- abaixo ficam mesmo assim, pela mesma razão de sempre: uma função que
-- nascesse de novo sem elas nasceria aberta para `anon`.

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
  v_incluir boolean := coalesce(p_incluir_arquivadas, false);
  v_saida json;
begin
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
        'praca', e.praca,
        'loja', e.loja,
        'vagas', e.vagas,
        -- ⚠️ OS DOIS CAMPOS DE ESTADO. `coalesce` porque a coluna é NOT NULL
        -- com default (`ativa` nasce true, `arquivada` nasce false), mas uma
        -- linha de outra origem sem o default aplicado não pode virar NULL na
        -- tela — NULL num `v-if` de template é o tipo de falso que passa
        -- despercebido.
        'ativa', coalesce(e.ativa, true),
        'arquivada', coalesce(e.arquivada, false),
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

revoke all on function public.vessel_conta_das_private_edits(int, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_conta_das_private_edits(int, boolean) to authenticated;

comment on function public.vessel_conta_das_private_edits(int, boolean) is
  'A lista e as contas dos Private Edits. p_dias so governa a janela de venda '
  '(janela_de_venda_em_dias na resposta) — nunca filtra linha, ver filtros.js. '
  'p_incluir_arquivadas (padrao false) tira a arquivada das contas por padrao; '
  'cada linha devolvida traz ativa, arquivada, praca e loja, para a tela '
  'separar arquivada de encerrada, filtrar por loja e editar sem apagar a '
  'praca/loja atuais.';
