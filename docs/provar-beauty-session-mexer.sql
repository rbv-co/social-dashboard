-- PROVA DE `2026-09-19-vessel-beauty-session-mexer.sql`
-- (editar, apagar e arquivar a Beauty Session)
--
-- Roda dentro de uma transação que SE DESFAZ. Nada fica no banco.
--   node coletor/provar-migration.mjs docs/provar-beauty-session-mexer.sql
--
-- ⚠️⚠️ ESTA TABELA TEM DADO DE VERDADE, ao contrário das irmãs deste plano.
-- `vessel_beauty_sessions` guarda as sessões do negócio, com QR já impresso e
-- na mão de cliente. Por isso esta prova INVENTA as próprias sessões
-- (`BS-PROVA-...`) e não cita nenhuma das de verdade em lugar nenhum — e a
-- asserção 100, no fim, confere campo a campo que elas voltaram idênticas.
-- Uma prova que só contasse "são três linhas" não pegaria uma sessão editada
-- no lugar de outra.
--
-- ⚠️ NÃO DESARMA NADA PARA PROVAR. Trocar `is_vessel_atendimentos()` por um
-- `select true` abriria, de um golpe, o `using` do RLS de SEIS tabelas. O
-- caminho certo — o mesmo de `docs/provar-portao-das-duas-funcoes.sql` — é
-- montar a situação DENTRO da transação e falar como cada pessoa.
--
-- ⚠️ E CADA RECUSA É PROVADA PELO MOTIVO CERTO, não só "falhou". Uma prova que
-- só olha `ok = false` passa batido quando a função recusa por outro motivo —
-- por exemplo devolvendo `nao_achei` porque a trava sumiu e o código usado no
-- teste nem existia.
--
-- ⚠️ E NULO NÃO É FALSO. Toda comparação abaixo vem embrulhada em `coalesce`
-- com `false`: um `ok` nulo é tão ruim quanto um `ok` verdadeiro, e sem o
-- `coalesce` a asserção daria NULL e não reprovaria ninguém.

begin;

create temp table resultado(ordem int, o_que_prova text, esperado text, obtido text, passou boolean)
  on commit drop;

-- A impressão das sessões DE VERDADE, antes de qualquer escrita.
create temp table impressao_antes on commit drop as
  select t.codigo, t.quando, t.praca, t.loja, t.parceiro, t.ativa, t.arquivada, t.criado_em
    from public.vessel_beauty_sessions t;

do $$
declare
  v_so_ve  uuid;
  v_mexe   uuid;
  v_r      jsonb;
  v_antes  jsonb;
  v_depois jsonb;
  v_n      int;
  v_texto  text;
  v_bool   boolean;
  c_lida   text := 'BS-PROVA-COM-LEITURA';
  c_limpa  text := 'BS-PROVA-SEM-LEITURA';
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

  -- ── AS SESSÕES DE MENTIRA — as únicas em que se mexe ────────────────────
  insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro)
       values (c_limpa, date '2027-05-20', 'SBO', 'tivoli', 'Salão da prova'),
              (c_lida,  date '2027-05-21', 'SBO', 'tivoli', 'Salão da prova dois');

  -- ══ 1. QUEM SÓ VÊ NÃO MEXE — nas três, e sem deixar rastro ════════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_so_ve)::text, true);

  select to_jsonb(t) into v_antes from public.vessel_beauty_sessions t where codigo = c_limpa;

  v_r := public.vessel_beauty_session_editar(c_limpa, date '2099-01-01', 'iguatemi')::jsonb;
  insert into resultado values (1, 'quem só vê NÃO edita',
    'sem_permissao', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'sem_permissao', false));
  insert into resultado values (2, 'e a resposta vem com ok = false (não nulo)',
    'false', coalesce(v_r->>'ok','(nulo)'), coalesce((v_r->>'ok') = 'false', false));

  v_r := public.vessel_beauty_session_arquivar(c_limpa, true)::jsonb;
  insert into resultado values (3, 'quem só vê NÃO arquiva',
    'sem_permissao', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'sem_permissao', false));

  v_r := public.vessel_beauty_session_apagar(c_limpa)::jsonb;
  insert into resultado values (4, 'quem só vê NÃO apaga',
    'sem_permissao', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'sem_permissao', false));

  -- ⚠️ A ASSERÇÃO QUE AS TRÊS DE CIMA NÃO FAZEM: uma função que escrevesse e
  -- só depois devolvesse "sem_permissao" passaria por todas elas.
  select to_jsonb(t) into v_depois from public.vessel_beauty_sessions t where codigo = c_limpa;
  insert into resultado values (5, 'e a sessão ficou EXATAMENTE como estava',
    'idêntica', case when v_antes = v_depois then 'idêntica' else coalesce(v_depois::text,'(sumiu)') end,
    coalesce(v_antes = v_depois, false));

  -- ══ 2. QUEM PODE EDITAR, EDITA — E O VALOR ENTRA DE VERDADE ═══════════
  perform set_config('request.jwt.claims', json_build_object('sub', v_mexe)::text, true);

  -- ⚠️ OS DOIS CAMPOS NA MESMA CHAMADA e os dois DIFERENTES do que a linha
  -- tinha. Conferir que um campo continua igual ao que já era não prova
  -- escrita nenhuma: um `set loja = loja`, com o parâmetro silenciosamente
  -- ignorado, passaria por uma asserção dessas.
  v_r := public.vessel_beauty_session_editar(c_limpa, date '2028-01-07', 'iguatemi')::jsonb;
  insert into resultado values (10, 'quem tem editar EDITA',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));

  select loja into v_texto from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (11, 'a loja nova ENTROU',
    'iguatemi', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'iguatemi', false));

  -- ⚠️ O DIA É COMPARADO NO BANCO, não por texto: quem sabe se dois `date` são
  -- o mesmo dia é o Postgres, não a forma como cada um deles foi escrito.
  select (quando = date '2028-01-07') into v_bool
    from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (12, 'o dia novo ENTROU',
    'true', coalesce(v_bool::text,'(nulo)'), coalesce(v_bool, false));

  -- ⚠️ E A OUTRA METADE DO `coalesce`: campo nulo é "não mexe neste", nunca
  -- "apaga o que estava lá". Em `loja` um `set loja = p_loja` sem `coalesce`
  -- nem chegaria a apagar — a coluna é `not null` e a chamada morreria com
  -- erro de banco na cara da pessoa. Já `quando` aceita nulo, e sumiria calado.
  v_r := public.vessel_beauty_session_editar(c_limpa, null, null)::jsonb;
  insert into resultado values (13, 'editar só com nulos é aceito',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));
  select loja into v_texto from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (14, 'a loja NÃO foi apagada pelo nulo',
    'iguatemi', coalesce(v_texto,'(apagada)'), coalesce(v_texto = 'iguatemi', false));
  select (quando = date '2028-01-07') into v_bool
    from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (15, 'o dia NÃO foi apagado pelo nulo',
    'true', coalesce(v_bool::text,'(apagado)'), coalesce(v_bool, false));

  -- ⚠️ `codigo` NUNCA MUDA, e nem é parâmetro. Ele está dentro dos DOIS links
  -- já copiados desta sessão — o QR da MESA e o QR do CARTÃO — e os dois estão
  -- IMPRESSOS. E o que `editar` não recebe também não pode mudar sozinho.
  select codigo into v_texto from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (16, 'o código continua o mesmo',
    c_limpa, coalesce(v_texto,'(nulo)'), coalesce(v_texto = c_limpa, false));
  select praca into v_texto from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (17, 'a praça, que editar nem recebe, não mudou sozinha',
    'SBO', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'SBO', false));
  select parceiro into v_texto from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (18, 'o parceiro também não',
    'Salão da prova', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'Salão da prova', false));

  -- ══ 3. ARQUIVAR E DESARQUIVAR ═════════════════════════════════════════
  v_r := public.vessel_beauty_session_arquivar(c_limpa, true)::jsonb;
  insert into resultado values (30, 'quem tem editar ARQUIVA',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));
  select arquivada::text into v_texto from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (31, 'e a coluna arquivada virou true de verdade',
    'true', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'true', false));

  -- ⚠️ ARQUIVAR TEM DE TER VOLTA. Uma linha que sai da lista e nunca mais pode
  -- voltar nunca mais pode ser DESARQUIVADA, e o botão de desarquivar viraria
  -- código morto.
  v_r := public.vessel_beauty_session_arquivar(c_limpa, false)::jsonb;
  insert into resultado values (32, 'e DESARQUIVA',
    'false', coalesce(v_r->>'arquivada','(nulo)'), coalesce((v_r->>'arquivada') = 'false', false));
  select arquivada::text into v_texto from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (33, 'a coluna voltou para false',
    'false', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'false', false));

  -- ⚠️ E `arquivar(codigo, null)` ARQUIVA. O `coalesce(p_arquivada, true)`
  -- existe para isso: quando a tela manda só o código — ou quando o PostgREST
  -- deixa o segundo parâmetro de fora e ele chega nulo — "arquivar" tem de
  -- significar ARQUIVAR. Sem o `coalesce`, `arquivada` receberia NULL e a
  -- coluna é `not null`: a chamada morreria com erro de banco na cara da
  -- pessoa.
  v_r := public.vessel_beauty_session_arquivar(c_limpa, null)::jsonb;
  insert into resultado values (34, 'arquivar SEM dizer o que fazer cai no padrão: arquiva',
    'true', coalesce(v_r->>'arquivada','(nulo)'), coalesce((v_r->>'arquivada') = 'true', false));
  select arquivada::text into v_texto from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (35, 'e gravou (não foi só o json dizendo true)',
    'true', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'true', false));

  -- ⚠️ ARQUIVAR NÃO É ENCERRAR: `ativa` não pode ter sido tocada no caminho.
  -- São duas contas diferentes — encerrada continua somando no histórico,
  -- arquivada sai das contas.
  select ativa::text into v_texto from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (36, 'arquivar NÃO encerrou a sessão de tabela',
    'true', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'true', false));
  v_r := public.vessel_beauty_session_arquivar(c_limpa, false)::jsonb;

  -- ══ 3b. O CÓDIGO TORTO — minúsculas e espaço na ponta ═════════════════
  --
  -- ⚠️ AS QUATRO AÇÕES MORAM NA MESMA TELA, lado a lado. A irmã
  -- `vessel_beauty_session_encerrar` já normaliza o código com
  -- `upper(nullif(trim(coalesce(p_codigo,'')),''))`; as três daqui copiam a
  -- MESMA expressão, na MESMA ordem, para as duas não poderem divergir. Sem
  -- isso, o mesmo código faria "Encerrar" funcionar e "Editar", "Apagar" e
  -- "Arquivar" responderem `nao_achei` — e recusa pela metade a pessoa lê como
  -- sistema quebrado, não como código errado.
  v_r := public.vessel_beauty_session_arquivar('  ' || lower(c_limpa) || '  ', true)::jsonb;
  insert into resultado values (40, 'código torto (minúsculas + espaço) ACHA a sessão',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));
  insert into resultado values (41, 'e o código volta NORMALIZADO na resposta',
    c_limpa, coalesce(v_r->>'codigo','(nulo)'), coalesce((v_r->>'codigo') = c_limpa, false));
  select arquivada::text into v_texto from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (42, 'e gravou de verdade (não foi só um ok de mentira)',
    'true', coalesce(v_texto,'(nulo)'), coalesce(v_texto = 'true', false));
  v_r := public.vessel_beauty_session_arquivar(c_limpa, false)::jsonb;

  v_r := public.vessel_beauty_session_editar('  ' || lower(c_limpa) || '  ', date '2029-02-03', null)::jsonb;
  insert into resultado values (43, 'editar também aceita o código torto',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));
  select (quando = date '2029-02-03') into v_bool
    from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (44, 'e editou a linha certa',
    'true', coalesce(v_bool::text,'(nulo)'), coalesce(v_bool, false));

  -- ══ 4. APAGAR A SESSÃO QUE NINGUÉM LEU ════════════════════════════════
  select count(*) into v_n from public.vessel_sessao_aberturas where codigo = c_limpa;
  insert into resultado values (50, 'a sessão de prova está mesmo sem leitura antes de apagar',
    '0', v_n::text, v_n = 0);

  -- ⚠️ E VAI PELO CÓDIGO TORTO de propósito: se o `exists` normalizasse e o
  -- `delete` lesse o cru, a resposta seria `ok` e a linha CONTINUARIA LÁ — um
  -- "apaguei" que não apagou nada, que só a asserção 52 denuncia.
  v_r := public.vessel_beauty_session_apagar('  ' || lower(c_limpa) || '  ')::jsonb;
  insert into resultado values (51, 'sessão SEM leitura: apaga (pelo código torto)',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));
  select count(*) into v_n from public.vessel_beauty_sessions where codigo = c_limpa;
  insert into resultado values (52, 'e a linha sumiu mesmo (não foi só um ok de mentira)',
    '0', v_n::text, v_n = 0);

  -- ══ 5. APAGAR COM O QR JÁ LIDO — O CASO QUE EXISTE PARA RECUSAR ═══════
  --
  -- ⚠️ POR QUE A REGRA EXISTE: apagar uma sessão que já teve o QR lido
  -- deixaria as leituras SEM SESSÃO em `vessel_sessao_aberturas`, e a conta
  -- passaria a somar sobre uma sessão que não existe mais. Para essas, a tela
  -- oferece "encerrar" (aconteceu, e continua contando no histórico) e
  -- "arquivar" (não era para estar ali, então sai das contas e da lista sem
  -- perder o dado).
  --
  -- ⚠️ "TER GENTE" AQUI É LEITURA DO QR, não convidada: a Beauty Session não
  -- tem lista de convidadas. A tabela é `vessel_sessao_aberturas`, LIGADA PELA
  -- COLUNA `codigo` — a mesma ligação que a função de conta já usa
  -- (`a.codigo = s.codigo`). Não existe coluna `sessao_codigo` nessa tabela.
  --
  -- ⚠️ E A PRIMEIRA LEITURA VAI COM `peca = 'cartao'`, DE PROPÓSITO. A conta
  -- separa 'mesa' de 'cartao' porque quer saber qual peça funciona melhor;
  -- para "alguém já leu este QR?", QUALQUER peça conta. Uma conferência que
  -- copiasse o `and a.peca = 'mesa'` da conta apagaria uma sessão lida só pelo
  -- cartão.
  insert into public.vessel_sessao_aberturas (codigo, peca, via)
       values (c_lida, 'cartao', 'qr');

  select count(*) into v_n from public.vessel_sessao_aberturas where codigo = c_lida;
  insert into resultado values (60, 'a leitura do cartão pendurou na sessão',
    '1', v_n::text, v_n = 1);

  v_r := public.vessel_beauty_session_apagar(c_lida)::jsonb;
  insert into resultado values (61, 'sessão JÁ LIDA: recusa, e pelo motivo certo',
    'tem_gente', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'tem_gente', false));
  insert into resultado values (62, 'e a recusa vem com ok = false (não nulo)',
    'false', coalesce(v_r->>'ok','(nulo)'), coalesce((v_r->>'ok') = 'false', false));

  select count(*) into v_n from public.vessel_beauty_sessions where codigo = c_lida;
  insert into resultado values (63, 'a sessão já lida continua lá',
    '1', v_n::text, v_n = 1);

  -- ⚠️ E A LEITURA CONTINUA LÁ. Esta é a asserção que a recusa existe para
  -- proteger: se o `delete` rodasse antes da conferência, a resposta poderia
  -- até dizer "tem_gente" e a linha da sessão já teria ido embora.
  select count(*) into v_n from public.vessel_sessao_aberturas where codigo = c_lida;
  insert into resultado values (64, 'e a linha da leitura NÃO foi tocada',
    '1', v_n::text, v_n = 1);

  -- ⚠️ E COM O CÓDIGO TORTO A RECUSA TEM DE SER A MESMA. Esta é a fresta mais
  -- perigosa da normalização: se a conferência de leitura lesse `p_codigo` cru
  -- enquanto o `delete` lê o normalizado, este `apagar` não acharia leitura
  -- nenhuma, responderia `ok` e levaria embora uma sessão JÁ LIDA. Foi
  -- exatamente esse buraco que, na irmã do Private Edit, apagou um encontro
  -- com gente dentro devolvendo `ok`.
  v_r := public.vessel_beauty_session_apagar('  ' || lower(c_lida) || '  ')::jsonb;
  insert into resultado values (65, 'código torto NÃO fura a conferência de leitura',
    'tem_gente', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'tem_gente', false));
  select count(*) into v_n from public.vessel_beauty_sessions where codigo = c_lida;
  insert into resultado values (66, 'e a sessão já lida continua lá',
    '1', v_n::text, v_n = 1);
  select count(*) into v_n from public.vessel_sessao_aberturas where codigo = c_lida;
  insert into resultado values (67, 'e a leitura também',
    '1', v_n::text, v_n = 1);

  -- ⚠️ E LEITURA DE `peca` NULA TAMBÉM CONTA. A coluna aceita nulo, e uma
  -- conferência escrita como `peca in ('mesa','cartao')` deixaria passar essa
  -- linha — que continua sendo alguém que leu o QR.
  delete from public.vessel_sessao_aberturas where codigo = c_lida;
  insert into public.vessel_sessao_aberturas (codigo, peca, via) values (c_lida, null, 'texto');
  v_r := public.vessel_beauty_session_apagar(c_lida)::jsonb;
  insert into resultado values (68, 'leitura de peça NULA também segura o apagar',
    'tem_gente', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'tem_gente', false));

  -- E o caminho que sobra para essas: arquivar, que funciona mesmo com leitura.
  v_r := public.vessel_beauty_session_arquivar(c_lida, true)::jsonb;
  insert into resultado values (69, 'a sessão já lida ainda pode ser ARQUIVADA',
    'ok', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'ok', false));

  -- ══ 6. SESSÃO QUE NÃO EXISTE ══════════════════════════════════════════
  -- ⚠️ `nao_achei`, e não um `ok` sobre zero linhas: um `update`/`delete` que
  -- não acha nada não levanta erro nenhum no Postgres.
  v_r := public.vessel_beauty_session_editar('BS-NAO-EXISTE', null, 'tivoli')::jsonb;
  insert into resultado values (80, 'editar sessão inexistente: nao_achei',
    'nao_achei', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'nao_achei', false));
  v_r := public.vessel_beauty_session_apagar('BS-NAO-EXISTE')::jsonb;
  insert into resultado values (81, 'apagar sessão inexistente: nao_achei',
    'nao_achei', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'nao_achei', false));
  v_r := public.vessel_beauty_session_arquivar('BS-NAO-EXISTE', true)::jsonb;
  insert into resultado values (82, 'arquivar sessão inexistente: nao_achei',
    'nao_achei', coalesce(v_r->>'situacao','(nulo)'), coalesce((v_r->>'situacao') = 'nao_achei', false));

  -- ══ 7. QUEM PODE CHAMAR — a asserção que nenhuma das de cima faz ══════
  -- ⚠️ `revoke ... from public` NÃO fecha `authenticated`, e função nova nasce
  -- aberta para `public` — ou seja, também para `anon`, que é quem abre a
  -- página do QR da Beauty Session.
  insert into resultado values (90, 'anon NÃO executa editar', 'false',
    has_function_privilege('anon','public.vessel_beauty_session_editar(text, date, text)','execute')::text,
    has_function_privilege('anon','public.vessel_beauty_session_editar(text, date, text)','execute') = false);
  insert into resultado values (91, 'anon NÃO executa apagar', 'false',
    has_function_privilege('anon','public.vessel_beauty_session_apagar(text)','execute')::text,
    has_function_privilege('anon','public.vessel_beauty_session_apagar(text)','execute') = false);
  insert into resultado values (92, 'anon NÃO executa arquivar', 'false',
    has_function_privilege('anon','public.vessel_beauty_session_arquivar(text, boolean)','execute')::text,
    has_function_privilege('anon','public.vessel_beauty_session_arquivar(text, boolean)','execute') = false);
  insert into resultado values (93, 'authenticated executa editar (a tela chama; a trava é por dentro)', 'true',
    has_function_privilege('authenticated','public.vessel_beauty_session_editar(text, date, text)','execute')::text,
    has_function_privilege('authenticated','public.vessel_beauty_session_editar(text, date, text)','execute') = true);
  insert into resultado values (94, 'authenticated executa apagar', 'true',
    has_function_privilege('authenticated','public.vessel_beauty_session_apagar(text)','execute')::text,
    has_function_privilege('authenticated','public.vessel_beauty_session_apagar(text)','execute') = true);
  insert into resultado values (95, 'authenticated executa arquivar', 'true',
    has_function_privilege('authenticated','public.vessel_beauty_session_arquivar(text, boolean)','execute')::text,
    has_function_privilege('authenticated','public.vessel_beauty_session_arquivar(text, boolean)','execute') = true);

  -- Devolve a sessão para "ninguém" antes de sair.
  perform set_config('request.jwt.claims', '', true);
end $$;

-- ══ 100. AS SESSÕES DE VERDADE NÃO FORAM TOCADAS ═══════════════════════
-- ⚠️⚠️ ESTA É A ASSERÇÃO QUE AS IRMÃS DESTE PLANO NÃO PRECISAVAM TER: a tabela
-- já estava em uso quando esta migration foi escrita, com QR impresso e na mão
-- de cliente. A comparação é campo a campo nos DOIS SENTIDOS (`except` de lá
-- para cá e de cá para lá) — só assim uma sessão editada no lugar de outra
-- aparece. As linhas da prova (`BS-PROVA-...`) ficam de fora porque não estão
-- na foto de antes e são apagadas/arquivadas aqui dentro: o que se compara é o
-- conjunto das que já existiam.
insert into resultado
select 100, 'as Beauty Sessions DE VERDADE estão exatamente como antes', '0 diferenças',
       v.n::text || ' diferença(s)', v.n = 0
  from (select (select count(*) from (
                 (select * from impressao_antes
                   except all
                  select codigo, quando, praca, loja, parceiro, ativa, arquivada, criado_em
                    from public.vessel_beauty_sessions)
                 union all
                 (select codigo, quando, praca, loja, parceiro, ativa, arquivada, criado_em
                    from public.vessel_beauty_sessions
                   where codigo not like 'BS-PROVA-%'
                   except all
                  select * from impressao_antes)) d)::int as n) v;

select * from resultado order by ordem;

select 999 as ordem, 'VEREDITO — asserções que passaram / total' as o_que_prova,
       count(*)::text as esperado,
       count(*) filter (where passou)::text as obtido,
       count(*) = count(*) filter (where passou) as passou
  from resultado;

rollback;
