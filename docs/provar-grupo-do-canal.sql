-- PROVA DA TRAVA DO GRUPO DO CANAL — 20/08/2026
--
-- Roda inteiro num bloco que TERMINA EM EXCEÇÃO de propósito: a exceção desfaz
-- tudo, então nenhum dado real fica alterado. Rodar pelo `execute_sql` do MCP.
--
-- A trava se prova COM ela armada. Desarmar para testar é testar outra coisa.
--
-- ESPERADO: a mensagem final "PROVA OK -- superadmin=1 linha(s),
-- nao-superadmin=0 linha(s)". Qualquer outra mensagem é reprovação.
--
-- ⚠️ O DETALHE QUE FEZ A PRIMEIRA VERSÃO REPROVAR: a política não pode ler
-- `profiles` direto. A expressão de uma policy roda como o PRÓPRIO usuário, e
-- `profiles` tem RLS — a pessoa não enxerga a própria linha ali. O subselect
-- voltava vazio e NEM O SUPERADMIN passava. Por isso a política chama
-- `public.superadmin_pela_ficha()`, que é SECURITY DEFINER.
--
-- ⚠️ E NÃO troque por `public.is_superadmin()`: aquela NÃO lê a coluna, ela
-- confere o e-mail contra uma lista de três cravada no corpo dela. Hoje as duas
-- concordam; se alguém marcar a coluna para uma quarta pessoa, elas divergem, e
-- quem abre a tela é a COLUNA.
do $$
declare
  v_super uuid; v_comum uuid; v_canal bigint;
  v_super_afetou int; v_comum_afetou int;
begin
  select id into v_super from public.profiles where coalesce(is_superadmin,false) limit 1;
  select id into v_comum from public.profiles where not coalesce(is_superadmin,false) limit 1;
  select loja_id into v_canal from public.bling_lojas order by loja_id limit 1;
  if v_super is null or v_comum is null then
    raise exception 'preciso de um superadmin E de um nao-superadmin para provar (super=%, comum=%)', v_super, v_comum;
  end if;

  set local role authenticated;

  -- 1. Superadmin grava.
  perform set_config('request.jwt.claims', json_build_object('sub', v_super)::text, true);
  update public.bling_lojas set grupo = 'PROVA-atacado' where loja_id = v_canal;
  get diagnostics v_super_afetou = row_count;

  -- 2. Quem não é superadmin alcança ZERO linhas — e SEM erro. É exatamente por
  --    isso que a tela confere a contagem antes de dizer "salvo": o banco não
  --    reclama, ele simplesmente não grava.
  perform set_config('request.jwt.claims', json_build_object('sub', v_comum)::text, true);
  update public.bling_lojas set grupo = 'PROVA-invasor' where loja_id = v_canal;
  get diagnostics v_comum_afetou = row_count;

  reset role;
  if v_super_afetou <> 1 then raise exception 'FALHOU: superadmin deveria gravar, afetou %', v_super_afetou; end if;
  if v_comum_afetou <> 0 then raise exception 'FALHOU: nao-superadmin GRAVOU, afetou %', v_comum_afetou; end if;
  raise exception 'PROVA OK -- superadmin=% linha(s), nao-superadmin=% linha(s). Excecao de proposito: desfaz tudo.',
    v_super_afetou, v_comum_afetou;
end $$;

-- DEPOIS DE RODAR, conferir que não sobrou nada:
--   select count(*) total, count(grupo) com_grupo,
--          count(*) filter (where grupo like 'PROVA%') sobrou
--     from public.bling_lojas;
-- Esperado: sobrou = 0.
