-- ⚠️ O `zz` DO NOME É FUNCIONAL. NÃO "ARRUME" ESTE NOME.
--
-- `coletor/run-migrations.mjs` aplica os arquivos em ORDEM ALFABÉTICA
-- (`readdirSync(...).filter(...).sort()`). São cinco arquivos do mesmo dia
-- mexendo nas MESMAS funções, e sem o `zz` eles caem nesta ordem:
--
--     baixas → criar-pecas-fecha-o-portao → editar-lote → excluir → renumerar-serie
--
-- Ou seja: este arquivo — que existe para FECHAR um buraco de segurança —
-- rodaria ANTES de `editar-lote.sql`, que recria `vessel_criar_pecas` sem o
-- portão por dentro e revoga só de `public, anon`. Em banco novo o buraco
-- voltava inteiro, com a suíte verde e a produção certa. Achado pela revisão
-- final da branch.
--
-- Este arquivo se chama `zz` para ser SEMPRE O ÚLTIMO dos cinco. Ele é a
-- palavra final sobre `vessel_criar_pecas`, `vessel_baixar_peca`,
-- `vessel_excluir_lote`, `vessel_excluir_peca` e `vessel_editar_lote`. Trocar o
-- nome por um "mais bonito" reabre o buraco.
--
-- ══════════════════════════════════════════════════════════════════════════
-- PARTE 1 — O PORTÃO DO AJUDANTE (o buraco que foi para produção em 30/08)
-- ══════════════════════════════════════════════════════════════════════════
--
-- `revoke all ... from public, anon` NÃO tira a concessão que o Postgres dá por
-- DEFAULT PRIVILEGES a `authenticated` em função nova do schema public. Medido
-- no banco, não deduzido:
--   select has_function_privilege('authenticated',
--          'public.vessel_criar_pecas(uuid,int,int)','execute');   -- devolvia TRUE
--
-- E `vessel_criar_pecas` é `security definer` SEM portão por dentro: a
-- concessão era a única porta. Com ela aberta, qualquer pessoa logada na
-- Central — mesmo sem a chave 'autenticidade' — podia injetar peças em qualquer
-- lote, ou segurar a transação até o timeout pedindo um intervalo gigante.
--
-- ⚠️ ESTE PROJETO JÁ SABIA DISSO. A armadilha está documentada em
-- `db/migrations/2026-07-31-saude-dos-robos.sql`, e quatro migrations já
-- revogam de `authenticated` explicitamente por causa dela. Aquela não seguiu.
--
-- DUAS travas, e as duas valem: a concessão revogada E o portão por dentro. A
-- concessão sozinha volta a falhar se alguém recriar a função; o portão sozinho
-- deixa a função alcançável por quem não deveria nem enxergá-la.

create or replace function public.vessel_criar_pecas(p_lote uuid, p_de int, p_ate int)
returns int language plpgsql security definer set search_path to 'public'
as $$
declare
  ALFABETO constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- sem O, 0, I, 1
  v_codigo text; v_bytes bytea; i int; j int; tentativa int; v_feitas int := 0;
begin
  -- O PORTÃO. As duas funções que chamam esta já conferem antes, e continuam
  -- passando: `auth.uid()` aqui dentro ainda é o da pessoa que chamou.
  if not public.is_vessel_admin() then
    raise exception 'sem_permissao';
  end if;

  -- Um intervalo absurdo seguraria a transação até o timeout. O lote já é
  -- limitado a 500 nas duas funções que chamam esta; aqui a trava é do próprio
  -- ajudante, para ele não depender de quem o chama.
  if p_de is null or p_ate is null or p_ate < p_de or (p_ate - p_de) >= 500 then
    raise exception 'intervalo_invalido';
  end if;

  for i in p_de..p_ate loop
    tentativa := 0;
    loop
      -- Sorteio CRIPTOGRAFICO, nao random(). O random() do Postgres e
      -- previsivel: quem comprasse algumas bolsas e olhasse os codigos poderia
      -- calcular os proximos — e a protecao contra falsificacao depende
      -- justamente de o codigo nao ser adivinhavel.
      -- O alfabeto tem exatamente 32 letras e 256/32 = 8, entao `byte % 32` nao
      -- puxa pra letra nenhuma (sem vies de modulo).
      v_bytes := extensions.gen_random_bytes(10);
      v_codigo := '';
      for j in 0..9 loop
        v_codigo := v_codigo || substr(ALFABETO, 1 + (get_byte(v_bytes, j) % length(ALFABETO)), 1);
      end loop;
      begin
        insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
        values (v_codigo, p_lote, i);
        v_feitas := v_feitas + 1;
        exit;
      exception when unique_violation then
        tentativa := tentativa + 1;
        if tentativa > 20 then raise exception 'nao consegui sortear codigo livre'; end if;
      end;
    end loop;
  end loop;
  return v_feitas;
end;
$$;

revoke all on function public.vessel_criar_pecas(uuid, int, int) from public, anon, authenticated;

-- ── E o motivo NULO, do mesmo relatório ───────────────────────────────────
-- `null not in (...)` devolve NULL, o `if` nao dispara, e a funcao seguia ate o
-- insert estourar com erro cru do Postgres — 500 na tela, em vez da recusa que
-- o desenho promete.
create or replace function public.vessel_baixar_peca(p_codigo text, p_motivo text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_codigo text := upper(trim(coalesce(p_codigo, '')));
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if coalesce(p_motivo, '') not in ('extraviada','defeito','devolvida','etiqueta_perdida') then
    return json_build_object('ok', false, 'motivo', 'motivo_invalido');
  end if;
  if not exists (select 1 from public.vessel_pecas where codigo = v_codigo) then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;
  if exists (select 1 from public.vessel_baixas
              where codigo = v_codigo and desfeita_em is null) then
    return json_build_object('ok', false, 'motivo', 'ja_baixada');
  end if;
  insert into public.vessel_baixas (codigo, motivo, baixada_por)
  values (v_codigo, p_motivo, auth.uid());
  return json_build_object('ok', true, 'codigo', v_codigo, 'motivo_da_baixa', p_motivo);
end;
$$;

-- ══════════════════════════════════════════════════════════════════════════
-- PARTE 2 — `gravada_em` NÃO ERA A ÚNICA PROVA DE QUE A PEÇA ESTÁ NO MUNDO
-- ══════════════════════════════════════════════════════════════════════════
--
-- Aplicado na produção em 30/08/2026, com 9 asserções verdes; este arquivo é a
-- mesma coisa escrita, para banco novo nascer igual.
--
-- O QUE FALTAVA: as três funções abaixo tratavam `gravada_em is not null` como
-- a única prova de que a peça já saiu para o mundo. Mas:
--
--   · `vessel_registrar` (a página da cliente) NÃO exige `gravada_em`: a
--     cliente registra a garantia pelo CÓDIGO, e o código existe desde que o
--     lote nasceu. Conferido no banco: JÁ EXISTIA registro de garantia em peça
--     sem `gravada_em`;
--   · `vessel_registros.codigo` referencia `vessel_pecas(codigo)` com
--     `on delete cascade`.
--
-- Somando os dois: apagar uma peça "não gravada" que tem garantia APAGAVA A
-- GARANTIA DA CLIENTE junto, calado, sem nada na tela. A regra passa a ser:
--
--     PEÇA PRESA = gravada OU com garantia registrada.
--
-- E não é o mesmo caso do `esta_gravada`: ali o conselho é "dê baixa em vez de
-- excluir". Aqui não há conselho — há uma garantia de uma pessoa de verdade
-- pendurada no código, e ninguém do lado de cá pode tirá-la.

create or replace function public.vessel_excluir_lote(p_lote uuid)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_gravadas int; v_total int; v_garantias int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  -- A existencia vem ANTES da contagem: contar peca de lote inexistente nao
  -- quebra (da zero), mas a funcao devolveria 'lote_nao_existe' depois de ter
  -- feito uma conta que nao significa nada.
  if not exists (select 1 from public.vessel_lotes where id = p_lote) then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;

  select count(*) filter (where gravada_em is not null), count(*)
    into v_gravadas, v_total
    from public.vessel_pecas where lote_id = p_lote;

  -- BASTA UMA gravada para o lote inteiro ficar preso: as outras peças até
  -- poderiam sumir, mas o lote é o que dá modelo, cor e data para a página da
  -- cliente ler. Sem ele, a peça gravada fica órfã.
  if v_gravadas > 0 then
    return json_build_object('ok', false, 'motivo', 'tem_gravada',
                             'gravadas', v_gravadas, 'total', v_total);
  end if;

  -- E BASTA UMA GARANTIA, mesmo sem nenhuma gravação: `vessel_registros` cai
  -- por cascade junto com a peça, e a cliente perderia a garantia dela sem
  -- ninguém saber.
  select count(*) into v_garantias
    from public.vessel_registros r
    join public.vessel_pecas p on p.codigo = r.codigo
   where p.lote_id = p_lote;

  if v_garantias > 0 then
    return json_build_object('ok', false, 'motivo', 'tem_garantia',
                             'garantias', v_garantias, 'total', v_total);
  end if;

  -- as peças saem por cascade (vessel_pecas.lote_id ... on delete cascade),
  -- e as baixas delas por cascade também
  delete from public.vessel_lotes where id = p_lote;
  return json_build_object('ok', true, 'excluidas', v_total);
end;
$$;

create or replace function public.vessel_excluir_peca(p_codigo text)
returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_codigo text := upper(trim(coalesce(p_codigo, '')));
        v_gravada timestamptz; v_lote uuid;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;

  select gravada_em, lote_id into v_gravada, v_lote
    from public.vessel_pecas where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'motivo', 'peca_nao_existe');
  end if;
  if v_gravada is not null then
    return json_build_object('ok', false, 'motivo', 'esta_gravada');
  end if;

  -- Peça sem gravação nenhuma, mas COM garantia registrada, também está no
  -- mundo: o `on delete cascade` de `vessel_registros` levaria a garantia da
  -- cliente junto. `garantias` vem 1 porque `vessel_registros.codigo` é chave
  -- primária — uma peça tem no máximo um registro.
  if exists (select 1 from public.vessel_registros where codigo = v_codigo) then
    return json_build_object('ok', false, 'motivo', 'tem_garantia', 'garantias', 1);
  end if;

  delete from public.vessel_pecas where codigo = v_codigo;
  -- O `lote_id` foi guardado ANTES do delete: depois dele a linha nao existe
  -- mais para ser consultada.
  update public.vessel_lotes
     set quantidade = (select count(*) from public.vessel_pecas p where p.lote_id = v_lote)
   where id = v_lote;
  -- tirar do meio deixa buraco na serie; renumerar fecha
  perform public.vessel_renumerar_lote(v_lote);
  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$$;

-- ── EDITAR ────────────────────────────────────────────────────────────────
-- DUAS mudanças em relação a `2026-08-30-vessel-renumerar-serie.sql`:
--
--  (a) conta `v_presas` (gravada OU com garantia) no lugar de `v_gravadas`, e o
--      `delete` de diminuir também pula as que têm registro. Sem isso, diminuir
--      a quantidade apagava calado a peça de uma cliente que registrou a
--      garantia antes de a etiqueta ter sido gravada;
--
--  (b) `vessel_renumerar_lote` saiu dos ramos e roda SEMPRE, depois do
--      `update`. Estava só dentro do `if`/`elsif` da quantidade — então salvar
--      um lote com buraco na série SEM mexer na quantidade não renumerava
--      nada. E lote com buraco não é hipótese: o lote real do Mônaco tinha
--      quantidade 20 com peças numeradas de 7 a 11, e a cliente lia
--      "peça 7 de 20" numa fornada de 5.

create or replace function public.vessel_editar_lote(
  p_lote uuid, p_modelo text, p_cor text, p_sku text,
  p_fabricado_em date, p_quantidade int
) returns json language plpgsql security definer set search_path to 'public'
as $$
declare v_presas int; v_hoje int; v_maior int;
begin
  if not public.is_vessel_admin() then
    return json_build_object('ok', false, 'motivo', 'sem_permissao');
  end if;
  if not exists (select 1 from public.vessel_lotes where id = p_lote) then
    return json_build_object('ok', false, 'motivo', 'lote_nao_existe');
  end if;
  if coalesce(trim(p_modelo), '') = '' or coalesce(p_quantidade, 0) < 1 or p_quantidade > 500 then
    return json_build_object('ok', false, 'motivo', 'dados_invalidos');
  end if;

  -- PRESA = gravada OU com garantia registrada. O `left join` é seguro porque
  -- `vessel_registros.codigo` é chave primária: no máximo uma linha por peça,
  -- então ele não multiplica a contagem.
  select count(*) filter (where p.gravada_em is not null or r.codigo is not null),
         count(*),
         coalesce(max(p.numero_na_serie), 0)
    into v_presas, v_hoje, v_maior
    from public.vessel_pecas p
    left join public.vessel_registros r on r.codigo = p.codigo
   where p.lote_id = p_lote;

  -- Diminuir abaixo do que ja esta preso apagaria peca com etiqueta dentro de
  -- bolsa, ou a garantia de uma cliente. Recusa dizendo QUANTAS estao presas.
  if p_quantidade < v_presas then
    return json_build_object('ok', false, 'motivo', 'abaixo_do_gravado',
                             'gravadas', v_presas);
  end if;

  -- modelo, cor, SKU e data sao seguros a qualquer momento: nao tocam em
  -- codigo nenhum, so mudam o que a cliente le na pagina.
  update public.vessel_lotes
     set modelo = trim(p_modelo),
         cor = nullif(trim(coalesce(p_cor, '')), ''),
         sku = nullif(trim(coalesce(p_sku, '')), ''),
         fabricado_em = coalesce(p_fabricado_em, fabricado_em),
         quantidade = p_quantidade
   where id = p_lote;

  if p_quantidade > v_hoje then
    -- nascem codigos novos CONTINUANDO a serie, nunca reaproveitando numero
    perform public.vessel_criar_pecas(p_lote, v_maior + 1, v_maior + (p_quantidade - v_hoje));
  elsif p_quantidade < v_hoje then
    -- saem as que NAO estao presas, de maior numero na serie
    delete from public.vessel_pecas
     where codigo in (
       select p.codigo from public.vessel_pecas p
        where p.lote_id = p_lote
          and p.gravada_em is null
          and not exists (select 1 from public.vessel_registros r where r.codigo = p.codigo)
        order by p.numero_na_serie desc
        limit (v_hoje - p_quantidade)
     );
  end if;

  -- SEMPRE, e FORA dos ramos acima. A cliente lê "peça N de TOTAL", com N em
  -- `vessel_pecas.numero_na_serie` e TOTAL em `vessel_lotes.quantidade`: um
  -- buraco na série já existente só se fecha aqui, e ele existe mesmo quando a
  -- quantidade não mudou.
  perform public.vessel_renumerar_lote(p_lote);

  return json_build_object('ok', true, 'quantidade',
    (select count(*) from public.vessel_pecas where lote_id = p_lote));
end;
$$;

-- ── AS CONCESSÕES, por último e por inteiro ───────────────────────────────
-- Os ajudantes (`vessel_criar_pecas`, `vessel_renumerar_lote`) não têm porta
-- nenhuma: só são chamados de dentro de outras funções, que já rodam como
-- `security definer`. As três de fora abrem só para quem está logado — e o
-- portão por dentro decide o resto.
revoke all on function public.vessel_criar_pecas(uuid, int, int) from public, anon, authenticated;
revoke all on function public.vessel_renumerar_lote(uuid) from public, anon, authenticated;
revoke all on function public.vessel_excluir_lote(uuid) from public, anon;
revoke all on function public.vessel_excluir_peca(text) from public, anon;
revoke all on function public.vessel_editar_lote(uuid, text, text, text, date, int) from public, anon;
revoke all on function public.vessel_baixar_peca(text, text) from public, anon;
grant execute on function public.vessel_excluir_lote(uuid) to authenticated;
grant execute on function public.vessel_excluir_peca(text) to authenticated;
grant execute on function public.vessel_editar_lote(uuid, text, text, text, date, int) to authenticated;
grant execute on function public.vessel_baixar_peca(text, text) to authenticated;
