-- PROVA DO ESPELHO DO GRUPO DO CANAL, NOS DOIS SENTIDOS.
--
-- Roda com o gatilho ARMADO e não deixa nada gravado: o bloco termina com um
-- `raise exception` de propósito, e o Postgres desfaz tudo. Desarmar a trava
-- para depois testar provaria o contrário do que se quer saber.
--
-- Sete perguntas. A primeira é o defeito que esta migration veio fechar; as
-- outras seis são o que NÃO pode ter quebrado no caminho.
--
--   1. texto → apontamento   (o defeito: a tela no ar escreve o texto)
--   2. apontamento → texto   (o que já valia desde 21/08, não regrediu)
--   3. grafia diferente      ("varejo" reaproveita "Varejo", não cria um segundo)
--   4. grupo que não existe  (nasce, porque a tela só sabe escrever texto)
--   5. apagar o texto        (o apontamento vai junto)
--   6. os dois no mesmo UPDATE (o apontamento manda — precedência declarada)
--   7. UPDATE que não toca em grupo (não mexe em nada)
--
-- Como rodar: pelo MCP do Supabase, ou `psql` com o arquivo inteiro.

do $$
declare
  v_canal    bigint;
  v_varejo   uuid;
  v_atacado  uuid;
  v_grupo    text;
  v_id       uuid;
  v_qtd      int;
  v_antes_g  text;
  v_antes_id uuid;
  v_ok       text := '';
begin
  select id into v_varejo  from public.canais_grupos where lower(btrim(nome)) = 'varejo';
  select id into v_atacado from public.canais_grupos where lower(btrim(nome)) = 'atacado';
  if v_varejo is null or v_atacado is null then
    raise exception 'PROVA NÃO RODOU: esperava os grupos Varejo e Atacado cadastrados';
  end if;

  -- A cobaia: um canal do Varejo. Qualquer um serve; o rollback devolve.
  select loja_id, grupo, grupo_id into v_canal, v_antes_g, v_antes_id
    from public.bling_lojas where lower(btrim(coalesce(grupo,''))) = 'varejo' order by nome limit 1;
  if v_canal is null then raise exception 'PROVA NÃO RODOU: nenhum canal no Varejo'; end if;

  -- ── 1. O DEFEITO: escrever o TEXTO, como a tela no ar faz ──────────────────
  update public.bling_lojas set grupo = 'Atacado' where loja_id = v_canal;
  select grupo, grupo_id into v_grupo, v_id from public.bling_lojas where loja_id = v_canal;
  if v_id is distinct from v_atacado then
    raise exception 'FALHOU 1: escrevi o texto "Atacado" e o apontamento ficou %, devia ser o do Atacado', v_id;
  end if;
  v_ok := v_ok || '1 texto→apontamento ok; ';

  -- ── 2. O sentido que já valia: escrever o APONTAMENTO ─────────────────────
  update public.bling_lojas set grupo_id = v_varejo where loja_id = v_canal;
  select grupo into v_grupo from public.bling_lojas where loja_id = v_canal;
  if lower(btrim(coalesce(v_grupo,''))) is distinct from 'varejo' then
    raise exception 'FALHOU 2: apontei para o Varejo e o texto ficou "%"', v_grupo;
  end if;
  v_ok := v_ok || '2 apontamento→texto ok; ';

  -- ── 3. Grafia diferente NÃO cria um segundo grupo ─────────────────────────
  select count(*) into v_qtd from public.canais_grupos;
  update public.bling_lojas set grupo = '  varejo ' where loja_id = v_canal;
  select grupo, grupo_id into v_grupo, v_id from public.bling_lojas where loja_id = v_canal;
  if v_id is distinct from v_varejo then
    raise exception 'FALHOU 3: "varejo" devia reaproveitar o Varejo, e apontou para %', v_id;
  end if;
  if v_grupo is distinct from 'Varejo' then
    raise exception 'FALHOU 3: o texto devia voltar canônico "Varejo", e ficou "%"', v_grupo;
  end if;
  if (select count(*) from public.canais_grupos) <> v_qtd then
    raise exception 'FALHOU 3: criou grupo novo para uma grafia que já existia';
  end if;
  v_ok := v_ok || '3 grafia diferente ok; ';

  -- ── 4. Grupo que ainda não existe nasce ───────────────────────────────────
  update public.bling_lojas set grupo = 'Marketplace Teste' where loja_id = v_canal;
  select grupo_id into v_id from public.bling_lojas where loja_id = v_canal;
  if v_id is null then raise exception 'FALHOU 4: grupo novo não nasceu, apontamento ficou nulo'; end if;
  if (select nome from public.canais_grupos where id = v_id) is distinct from 'Marketplace Teste' then
    raise exception 'FALHOU 4: o grupo criado não tem o nome digitado';
  end if;
  v_ok := v_ok || '4 grupo novo nasce ok; ';

  -- ── 5. Apagar o texto leva o apontamento junto ────────────────────────────
  update public.bling_lojas set grupo = null where loja_id = v_canal;
  select grupo, grupo_id into v_grupo, v_id from public.bling_lojas where loja_id = v_canal;
  if v_id is not null or v_grupo is not null then
    raise exception 'FALHOU 5: apaguei o texto e sobrou grupo="%" apontamento=%', v_grupo, v_id;
  end if;
  v_ok := v_ok || '5 apagar leva os dois ok; ';

  -- ── 6. Os dois no MESMO update: o apontamento manda ───────────────────────
  update public.bling_lojas set grupo_id = v_atacado, grupo = 'Varejo' where loja_id = v_canal;
  select grupo, grupo_id into v_grupo, v_id from public.bling_lojas where loja_id = v_canal;
  if v_id is distinct from v_atacado or lower(btrim(coalesce(v_grupo,''))) is distinct from 'atacado' then
    raise exception 'FALHOU 6: com os dois juntos devia mandar o apontamento (Atacado), e ficou "%" / %', v_grupo, v_id;
  end if;
  v_ok := v_ok || '6 precedência do apontamento ok; ';

  -- ── 7. UPDATE que não toca em grupo não mexe em nada ──────────────────────
  update public.bling_lojas set updated_at = now() where loja_id = v_canal;
  select grupo, grupo_id into v_grupo, v_id from public.bling_lojas where loja_id = v_canal;
  if v_id is distinct from v_atacado or lower(btrim(coalesce(v_grupo,''))) is distinct from 'atacado' then
    raise exception 'FALHOU 7: um update sem grupo mexeu no grupo';
  end if;
  v_ok := v_ok || '7 update alheio não mexe ok';

  raise exception 'PROVA COMPLETA (nada foi gravado, isto é o rollback): %', v_ok;
end $$;
