-- PROVA DE `2026-09-19-vessel-private-edit-mexer.sql`
-- (editar, apagar e arquivar o encontro — o Private Edit)
--
-- Roda dentro de uma transação que SE DESFAZ. Nada fica no banco.
--   node coletor/provar-migration.mjs docs/provar-private-edit-mexer.sql
--
-- ⚠️ ESTE É O ARQUIVO PROMETIDO EM `coletor/aplicar-vessel-trava-de-editar.mjs`.
-- Lá a trava foi provada por uma CÓPIA da regra (um `select` que repete o corpo
-- da função), porque `auth.uid()` é nulo numa conexão `pg` pura. Cópia pode
-- envelhecer e mentir. Aqui a prova é com SESSÃO DE VERDADE: define-se
-- `request.jwt.claims`, que é exatamente de onde `auth.uid()` lê quem é, e
-- chamam-se as funções DE VERDADE, com a trava ligada, do jeito que a Central
-- chama.
--
-- ⚠️ NÃO DESARMA NADA PARA PROVAR. Trocar `is_vessel_atendimentos()` por um
-- `select true` abriria, de um golpe, o `using` do RLS de SEIS tabelas
-- (vessel_pessoas, vessel_atendimentos, vessel_convite_aberturas,
-- vessel_client_advisors, vessel_pedidos e vessel_pedido_itens). O caminho
-- certo — o mesmo de `docs/provar-portao-das-duas-funcoes.sql` — é montar a
-- situação DENTRO da transação e falar como cada pessoa.
--
-- ⚠️ E CADA RECUSA É PROVADA PELO MOTIVO CERTO, não só "falhou". Uma prova que
-- só olha `ok = false` passa batido quando a função recusa por outro motivo —
-- por exemplo devolvendo `nao_achei` porque a trava sumiu e o código usado no
-- teste nem existia.
--
-- ⚠️ E RECUSAR NÃO BASTA: recusar SEM TER MEXIDO é o que importa. Por isso
-- depois de cada recusa a linha do encontro é conferida inteira, campo a campo.

begin;

create temp table resultado(ordem int, o_que_prova text, esperado text, obtido text, passou boolean)
  on commit drop;

do $$
declare
  v_so_ve   uuid;
  v_mexe    uuid;
  v_sty     bigint;
  v_sty2    bigint;
  v_pes     bigint;
  v_r       jsonb;
  v_antes   jsonb;
  v_depois  jsonb;
  v_n       int;
  v_texto   text;
  v_bool    boolean;
  c_com     text := 'PE-PROVA-COM-GENTE';
  c_sem     text := 'PE-PROVA-SEM-GENTE';
begin
  -- ── DUAS CONTAS QUE JÁ EXISTEM, com a permissão EMPRESTADA aqui dentro ──
  --
  -- Não dá para inventar pessoa: `profiles.id` aponta para o cadastro de
  -- autenticação. Então pegam-se duas contas quaisquer (nunca a de um
  -- super-admin, que passaria por qualquer trava e não provaria nada) e
  -- troca-se o acesso delas DENTRO da transação. O `rollback` no fim devolve
  -- tudo.
  --
  -- ⚠️ Os `update` vão com `request.jwt.claims` VAZIA porque existe um gatilho
  -- que impede mexer no próprio acesso; falando como ninguém, ele não dispara.
  perform set_config('request.jwt.claims', '', true);

  select id into v_so_ve from public.profiles where not is_superadmin order by id limit 1;
  select id into v_mexe  from public.profiles where not is_superadmin order by id offset 1 limit 1;

  -- ⚠️ QUEM SÓ VÊ TEM O `feature` DE ATENDIMENTOS. É de propósito: sem ele a
  -- recusa viria do portão de ver e esta prova não diria nada sobre a trava de
  -- editar. Com ele, a ÚNICA coisa que separa as duas contas é a ação `editar`
  -- dentro de `permissions`.
  update public.profiles
     set features = array['atendimentos'], permissions = '{"atendimentos":["ver"]}'::jsonb,
         is_superadmin = false, role = 'viewer'
   where id = v_so_ve;
  update public.profiles
     set features = array['atendimentos'], permissions = '{"atendimentos":["ver","editar"]}'::jsonb,
         is_superadmin = false, role = 'viewer'
   where id = v_mexe;

  -- ── A SITUAÇÃO DE MENTIRA: uma stylist e dois encontros ─────────────────
  insert into public.vessel_stylists (codigo, nome, whatsapp)
       values ('STY-PROVA-1','Stylist da prova','5519900000001') returning id into v_sty;
  insert into public.vessel_stylists (codigo, nome, whatsapp)
       values ('STY-PROVA-2','Stylist da prova dois','5519900000002') returning id into v_sty2;

  insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, local, praca, loja, vagas)
       values (c_sem, 'CHAVEPROVA1', v_sty, now() + interval '5 days', 'Piso L3', 'CPS', 'iguatemi', 8);
  insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, local, praca, loja, vagas)
       values (c_com, 'CHAVEPROVA2', v_sty, now() + interval '6 days', 'Piso L1', 'CPS', 'iguatemi', 6);

  -- ══ 1. QUEM SÓ VÊ NÃO MEXE — nas três, e sem deixar rastro ════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_so_ve)::text, true);

  select to_jsonb(t) into v_antes from public.vessel_private_edits t where codigo = c_sem;

  v_r := public.vessel_private_edit_editar(c_sem, now(), 'MEXIDO', 'XXX', 'tivoli', 99, 'STY-PROVA-2')::jsonb;
  insert into resultado values (1, 'quem só vê NÃO edita',
    'sem_permissao', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'sem_permissao', false));
  insert into resultado values (2, 'e a resposta vem com ok = false (não nulo)',
    'false', coalesce(v_r->>'ok','(nulo)'), coalesce((v_r->>'ok') = 'false', false));

  v_r := public.vessel_private_edit_arquivar(c_sem, true)::jsonb;
  insert into resultado values (3, 'quem só vê NÃO arquiva',
    'sem_permissao', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'sem_permissao', false));

  v_r := public.vessel_private_edit_apagar(c_sem)::jsonb;
  insert into resultado values (4, 'quem só vê NÃO apaga',
    'sem_permissao', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'sem_permissao', false));

  -- ⚠️ A ASSERÇÃO QUE AS TRÊS DE CIMA NÃO FAZEM: uma função que escrevesse e
  -- só depois devolvesse "sem_permissao" passaria por todas elas.
  select to_jsonb(t) into v_depois from public.vessel_private_edits t where codigo = c_sem;
  insert into resultado values (5, 'e o encontro ficou EXATAMENTE como estava',
    'idêntico', case when v_antes = v_depois then 'idêntico' else coalesce(v_depois::text,'(sumiu)') end,
    coalesce(v_antes = v_depois, false));

  -- ══ 2. QUEM PODE EDITAR, EDITA ════════════════════════════════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_mexe)::text, true);

  v_r := public.vessel_private_edit_editar(c_sem, null, null, null, null, 12, null)::jsonb;
  insert into resultado values (10, 'quem tem editar EDITA',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));

  select vagas::text into v_texto from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (11, 'e as vagas mudaram de verdade',
    '12', coalesce(v_texto,'(nulo)'), coalesce(v_texto = '12', false));

  -- ⚠️ CAMPO NULO É "NÃO MEXE NESTE", nunca "apaga o que estava lá". Sem o
  -- `coalesce` na função, editar as vagas apagaria o local, a praça, a loja e
  -- a stylist de uma vez — e ninguém veria isso olhando só para as vagas.
  select local into v_texto from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (12, 'o local NÃO foi apagado pelo nulo',
    'Piso L3', coalesce(v_texto,'(apagado)'), coalesce(v_texto = 'Piso L3', false));
  select praca into v_texto from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (13, 'a praça NÃO foi apagada pelo nulo',
    'CPS', coalesce(v_texto,'(apagada)'), coalesce(v_texto = 'CPS', false));
  select loja into v_texto from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (14, 'a loja NÃO foi apagada pelo nulo',
    'iguatemi', coalesce(v_texto,'(apagada)'), coalesce(v_texto = 'iguatemi', false));
  select (stylist_id = v_sty) into v_bool from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (15, 'a stylist NÃO foi apagada pelo nulo',
    'true', coalesce(v_bool::text,'(nulo)'), coalesce(v_bool, false));

  -- ⚠️ `codigo` E `chave` NUNCA MUDAM. A `chave` está dentro de todo convite
  -- JÁ ENVIADO e o `codigo` é o identificador no CRM: trocar qualquer um dos
  -- dois mata links que já estão circulando. Eles nem aparecem como parâmetro
  -- da função — esta asserção é o que garante que continuem não aparecendo.
  select chave into v_texto from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (16, 'a chave do convite continua a mesma',
    'CHAVEPROVA1', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'CHAVEPROVA1', false));

  -- A stylist entra pelo CÓDIGO dela, não pelo id.
  v_r := public.vessel_private_edit_editar(c_sem, null, null, null, null, null, 'STY-PROVA-2')::jsonb;
  select (stylist_id = v_sty2) into v_bool from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (17, 'trocar a stylist pelo código dela funciona',
    'true', coalesce(v_bool::text,'(nulo)'), coalesce(v_bool, false));

  -- Stylist que não existe não vira nulo calado: vira recusa com nome.
  v_r := public.vessel_private_edit_editar(c_sem, null, null, null, null, null, 'STY-NAO-EXISTE')::jsonb;
  insert into resultado values (18, 'stylist inexistente é recusa, não um nulo calado',
    'stylist_nao_achei', coalesce(v_r->>'situacao','(nulo)'),
    coalesce((v_r->>'situacao') = 'stylist_nao_achei', false));
  select (stylist_id = v_sty2) into v_bool from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (19, 'e nem assim a stylist boa foi trocada',
    'true', coalesce(v_bool::text,'(nulo)'), coalesce(v_bool, false));

  -- ══ 3. ARQUIVAR E DESARQUIVAR ═════════════════════════════════════════
  v_r := public.vessel_private_edit_arquivar(c_sem, true)::jsonb;
  insert into resultado values (20, 'quem tem editar ARQUIVA',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));
  select arquivada::text into v_texto from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (21, 'e a coluna arquivada virou true de verdade',
    'true', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'true', false));

  -- ⚠️ ARQUIVAR TEM DE TER VOLTA. Uma linha que sai da lista e nunca mais pode
  -- voltar nunca mais pode ser DESARQUIVADA, e o botão de desarquivar viraria
  -- código morto.
  v_r := public.vessel_private_edit_arquivar(c_sem, false)::jsonb;
  insert into resultado values (22, 'e DESARQUIVA',
    'false', coalesce(v_r->>'arquivada','(nulo)'), coalesce((v_r->>'arquivada') = 'false', false));
  select arquivada::text into v_texto from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (23, 'a coluna voltou para false',
    'false', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'false', false));

  -- ⚠️ ARQUIVAR NÃO É ENCERRAR: `ativa` não pode ter sido tocada no caminho.
  select ativa::text into v_texto from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (24, 'arquivar NÃO encerrou o encontro de tabela',
    'true', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'true', false));

  -- ══ 3b. O CÓDIGO TORTO — minúsculas e espaço na ponta ═════════════════
  --
  -- ⚠️ AS QUATRO AÇÕES MORAM NA MESMA TELA, lado a lado. A irmã
  -- `vessel_private_edit_encerrar` já normaliza o código com
  -- `upper(nullif(trim(coalesce(p_codigo,'')),''))`; as três daqui copiam a
  -- MESMA expressão, na MESMA ordem, para as duas não poderem divergir. Sem
  -- isso, o mesmo código faria "Encerrar" funcionar e "Editar", "Apagar" e
  -- "Arquivar" responderem `nao_achei` — e recusa pela metade a pessoa lê como
  -- sistema quebrado, não como código errado. Recusar os quatro juntos seria
  -- menos ruim do que isso.
  v_texto := '  ' || lower(c_sem) || '  ';

  v_r := public.vessel_private_edit_arquivar(v_texto, true)::jsonb;
  insert into resultado values (25, 'código torto (minúsculas + espaço) ACHA o encontro',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));
  insert into resultado values (26, 'e o código volta NORMALIZADO na resposta',
    c_sem, coalesce(v_r->>'codigo','(nulo)'), coalesce((v_r->>'codigo') = c_sem, false));

  select arquivada::text into v_texto from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (27, 'e gravou de verdade (não foi só um ok de mentira)',
    'true', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'true', false));

  v_r := public.vessel_private_edit_editar('  ' || lower(c_sem) || '  ', null, null, null, null, 7, null)::jsonb;
  insert into resultado values (28, 'editar também aceita o código torto',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));
  select vagas::text into v_texto from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (29, 'e editou a linha certa',
    '7', coalesce(v_texto,'(nulo)'), coalesce(v_texto = '7', false));

  -- Devolve o encontro para fora do arquivo, para o caso 4 apagar de verdade.
  v_r := public.vessel_private_edit_arquivar(c_sem, false)::jsonb;

  -- ══ 4. APAGAR SEM NINGUÉM PENDURADO ═══════════════════════════════════
  select count(*) into v_n from public.vessel_atendimentos where evento_codigo = c_sem;
  insert into resultado values (30, 'o encontro de prova está mesmo vazio antes de apagar',
    '0', v_n::text, v_n = 0);

  -- ⚠️ E VAI PELO CÓDIGO TORTO de propósito: se o `exists` normalizasse e o
  -- `delete` lesse o cru, a resposta seria `ok` e a linha CONTINUARIA LÁ — um
  -- "apaguei" que não apagou nada, que só a asserção 32 denuncia.
  v_r := public.vessel_private_edit_apagar('  ' || lower(c_sem) || '  ')::jsonb;
  insert into resultado values (31, 'encontro SEM gente: apaga (pelo código torto)',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));
  select count(*) into v_n from public.vessel_private_edits where codigo = c_sem;
  insert into resultado values (32, 'e a linha sumiu mesmo (não foi só um ok de mentira)',
    '0', v_n::text, v_n = 0);

  -- ══ 5. APAGAR COM GENTE PENDURADA — O CASO QUE EXISTE PARA RECUSAR ════
  --
  -- ⚠️ POR QUE A REGRA EXISTE: apagar um encontro que já tem convidada
  -- deixaria linhas ÓRFÃS em `vessel_atendimentos`, e a receita passaria a
  -- somar sobre um encontro que não existe mais. Para esses, a tela oferece
  -- "encerrar" (aconteceu, e continua contando no histórico) e "arquivar"
  -- (não era para estar ali, então sai das contas e da lista sem perder o
  -- dado).
  insert into public.vessel_pessoas (nome, telefone)
       values ('Convidada da prova', '5519900000003') returning id into v_pes;
  insert into public.vessel_atendimentos (pessoa_id, loja, origem_registro, evento_codigo, rsvp)
       values (v_pes, 'iguatemi', 'private-edit', c_com, 'sim');

  select count(*) into v_n from public.vessel_atendimentos where evento_codigo = c_com;
  insert into resultado values (40, 'a convidada pendurou no encontro',
    '1', v_n::text, v_n = 1);

  v_r := public.vessel_private_edit_apagar(c_com)::jsonb;
  insert into resultado values (41, 'encontro COM gente: recusa, e pelo motivo certo',
    'tem_gente', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'tem_gente', false));
  insert into resultado values (42, 'e a recusa vem com ok = false (não nulo)',
    'false', coalesce(v_r->>'ok','(nulo)'), coalesce((v_r->>'ok') = 'false', false));

  select count(*) into v_n from public.vessel_private_edits where codigo = c_com;
  insert into resultado values (43, 'o encontro com gente continua lá',
    '1', v_n::text, v_n = 1);

  -- ⚠️ E A CONVIDADA CONTINUA LÁ. Esta é a asserção que a recusa existe para
  -- proteger: se o `delete` rodasse antes da conferência, a resposta poderia
  -- até dizer "tem_gente" e a linha do encontro já teria ido embora.
  select count(*) into v_n from public.vessel_atendimentos where evento_codigo = c_com;
  insert into resultado values (44, 'e a linha da convidada NÃO foi tocada',
    '1', v_n::text, v_n = 1);

  -- ⚠️ E COM O CÓDIGO TORTO A RECUSA TEM DE SER A MESMA. Esta é a fresta mais
  -- perigosa da normalização: se a conferência de convidadas lesse `p_codigo`
  -- cru enquanto o `delete` lê o normalizado, este `apagar` não acharia
  -- ninguém pendurado, responderia `ok` e levaria embora um encontro COM
  -- GENTE — deixando linhas órfãs em `vessel_atendimentos`.
  v_r := public.vessel_private_edit_apagar('  ' || lower(c_com) || '  ')::jsonb;
  insert into resultado values (45, 'código torto NÃO fura a conferência de convidadas',
    'tem_gente', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'tem_gente', false));
  select count(*) into v_n from public.vessel_private_edits where codigo = c_com;
  insert into resultado values (46, 'e o encontro com gente continua lá',
    '1', v_n::text, v_n = 1);
  select count(*) into v_n from public.vessel_atendimentos where evento_codigo = c_com;
  insert into resultado values (47, 'e a convidada também',
    '1', v_n::text, v_n = 1);

  -- E o caminho que sobra para esses: arquivar, que funciona mesmo com gente.
  v_r := public.vessel_private_edit_arquivar(c_com, true)::jsonb;
  insert into resultado values (48, 'o que tem gente ainda pode ser ARQUIVADO',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));

  -- ══ 6. ENCONTRO QUE NÃO EXISTE ════════════════════════════════════════
  -- ⚠️ `nao_achei`, e não um `ok` sobre zero linhas: um `update`/`delete` que
  -- não acha nada não levanta erro nenhum no Postgres.
  v_r := public.vessel_private_edit_editar('PE-NAO-EXISTE', null, null, null, null, 1, null)::jsonb;
  insert into resultado values (50, 'editar encontro inexistente: nao_achei',
    'nao_achei', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'nao_achei', false));
  v_r := public.vessel_private_edit_apagar('PE-NAO-EXISTE')::jsonb;
  insert into resultado values (51, 'apagar encontro inexistente: nao_achei',
    'nao_achei', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'nao_achei', false));
  v_r := public.vessel_private_edit_arquivar('PE-NAO-EXISTE', true)::jsonb;
  insert into resultado values (52, 'arquivar encontro inexistente: nao_achei',
    'nao_achei', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'nao_achei', false));

  -- ══ 7. QUEM PODE CHAMAR — a asserção que nenhuma das de cima faz ══════
  -- ⚠️ `revoke ... from public` NÃO fecha `authenticated`, e função nova nasce
  -- aberta para `public` — ou seja, também para `anon`, que é a página pública
  -- do convite.
  insert into resultado values (60, 'anon NÃO executa editar', 'false',
    has_function_privilege('anon','public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text)','execute')::text,
    has_function_privilege('anon','public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text)','execute') = false);
  insert into resultado values (61, 'anon NÃO executa apagar', 'false',
    has_function_privilege('anon','public.vessel_private_edit_apagar(text)','execute')::text,
    has_function_privilege('anon','public.vessel_private_edit_apagar(text)','execute') = false);
  insert into resultado values (62, 'anon NÃO executa arquivar', 'false',
    has_function_privilege('anon','public.vessel_private_edit_arquivar(text, boolean)','execute')::text,
    has_function_privilege('anon','public.vessel_private_edit_arquivar(text, boolean)','execute') = false);
  insert into resultado values (63, 'authenticated executa editar (a tela chama; a trava é por dentro)', 'true',
    has_function_privilege('authenticated','public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text)','execute')::text,
    has_function_privilege('authenticated','public.vessel_private_edit_editar(text, timestamptz, text, text, text, integer, text)','execute') = true);
  insert into resultado values (64, 'authenticated executa apagar', 'true',
    has_function_privilege('authenticated','public.vessel_private_edit_apagar(text)','execute')::text,
    has_function_privilege('authenticated','public.vessel_private_edit_apagar(text)','execute') = true);
  insert into resultado values (65, 'authenticated executa arquivar', 'true',
    has_function_privilege('authenticated','public.vessel_private_edit_arquivar(text, boolean)','execute')::text,
    has_function_privilege('authenticated','public.vessel_private_edit_arquivar(text, boolean)','execute') = true);

  -- Devolve a sessão para "ninguém" antes de sair.
  perform set_config('request.jwt.claims', '', true);
end $$;

select * from resultado order by ordem;

select 999 as ordem, 'VEREDITO — asserções que passaram / total' as o_que_prova,
       count(*)::text as esperado,
       count(*) filter (where passou)::text as obtido,
       count(*) = count(*) filter (where passou) as passou
  from resultado;

rollback;
