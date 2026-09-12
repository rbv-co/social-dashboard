-- PROVA DO ALCANCE DA SUPERVISORA — 20/08/2026 (Peça 3)
--
-- Roda num bloco que TERMINA EM EXCEÇÃO de propósito: a exceção desfaz tudo,
-- então nenhum dado real fica alterado. Rodar pelo `execute_sql` do MCP.
--
-- Em 20/08 NÃO HAVIA supervisora nenhuma no banco (os 4 membros eram todos
-- 'vendedora') e nenhum canal tinha grupo — ou seja, a regra nova não mudava
-- nada para ninguém. Por isso o cenário é MONTADO aqui dentro: sem montar, a
-- prova passaria sem provar coisa alguma.
--
-- ESPERADO: a mensagem final começando com "PROVA OK".
--
-- O QUE CADA CENÁRIO TRANCA:
--   1. vendedora  -> só o canal do time dela
--   2. gestor     -> idem (é a "gerente" da fala do dono: administra, não enxerga mais)
--   3. supervisora-> TODO o grupo dela, e NADA do outro grupo
--   4. supervisora de canal SEM grupo -> só o canal dela.
--      ⚠️ Este é o que não pode dar errado: "sem grupo" jamais pode virar "vê tudo".
do $$
declare
  v_pessoa uuid; v_time_dp uuid;
  c_dp bigint := 205657609;   -- Loja Dom Pedro     (vira Varejo)
  c_tv bigint := 205834140;   -- Loja Santa Bárbara (vira Varejo)
  c_nu bigint := 205451611;   -- Atacado Nuvem Shop (vira Atacado)
  c_fa bigint := 205395333;   -- Atacado Fábrica    (vira Atacado)
  r text := '';
begin
  select m.profile_id into v_pessoa from public.equipes_membros m limit 1;
  select id into v_time_dp from public.equipes where nome = 'Dom Pedro';

  update public.bling_lojas set grupo = 'Varejo'  where loja_id in (c_dp, c_tv);
  update public.bling_lojas set grupo = 'Atacado' where loja_id in (c_nu, c_fa);
  update public.profiles set escopo_por_equipe = true, is_superadmin = false where id = v_pessoa;
  delete from public.equipes_membros where profile_id = v_pessoa;
  insert into public.equipes_membros (equipe_id, profile_id, papel) values (v_time_dp, v_pessoa, 'vendedora');

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa)::text, true);
  r := r || format('vendedora -> DomPedro=%s Tivoli=%s Nuvem=%s | ',
       pode_ver_canal(c_dp), pode_ver_canal(c_tv), pode_ver_canal(c_nu));
  if not pode_ver_canal(c_dp) or pode_ver_canal(c_tv) or pode_ver_canal(c_nu) then
    raise exception 'FALHOU vendedora: %', r; end if;

  reset role;
  update public.equipes_membros set papel = 'gestor' where profile_id = v_pessoa;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa)::text, true);
  r := r || format('gestor -> DomPedro=%s Tivoli=%s | ', pode_ver_canal(c_dp), pode_ver_canal(c_tv));
  if not pode_ver_canal(c_dp) or pode_ver_canal(c_tv) then
    raise exception 'FALHOU gestor: %', r; end if;

  reset role;
  update public.equipes_membros set papel = 'supervisora' where profile_id = v_pessoa;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa)::text, true);
  r := r || format('supervisora -> DomPedro=%s Tivoli=%s Nuvem=%s Fabrica=%s | ',
       pode_ver_canal(c_dp), pode_ver_canal(c_tv), pode_ver_canal(c_nu), pode_ver_canal(c_fa));
  if not pode_ver_canal(c_dp) or not pode_ver_canal(c_tv) then
    raise exception 'FALHOU: supervisora nao viu o grupo dela: %', r; end if;
  if pode_ver_canal(c_nu) or pode_ver_canal(c_fa) then
    raise exception 'FALHOU: supervisora VAZOU para o outro grupo: %', r; end if;

  reset role;
  update public.bling_lojas set grupo = null where loja_id = c_dp;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa)::text, true);
  r := r || format('supervisora sem grupo -> DomPedro=%s Tivoli=%s Nuvem=%s',
       pode_ver_canal(c_dp), pode_ver_canal(c_tv), pode_ver_canal(c_nu));
  if not pode_ver_canal(c_dp) then raise exception 'FALHOU: perdeu ate o proprio canal: %', r; end if;
  if pode_ver_canal(c_tv) or pode_ver_canal(c_nu) then
    raise exception 'FALHOU: SEM GRUPO VIROU VE TUDO: %', r; end if;

  reset role;
  raise exception 'PROVA OK -- %', r;
end $$;

-- Resultado obtido em 20/08/2026:
--   vendedora   -> DomPedro=t Tivoli=f Nuvem=f
--   gestor      -> DomPedro=t Tivoli=f
--   supervisora -> DomPedro=t Tivoli=t Nuvem=f Fabrica=f
--   supervisora sem grupo -> DomPedro=t Tivoli=f Nuvem=f
--
-- DEPOIS DE RODAR, conferir que nada sobrou:
--   select count(grupo) canais_com_grupo, (select count(*) from equipes_membros) membros
--     from bling_lojas;
-- Esperado em 20/08: canais_com_grupo = 0 (ate o dono configurar), membros = 4.
