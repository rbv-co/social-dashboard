-- PROVA DA EDIÇÃO DE ETIQUETAS — `2026-09-01-vessel-editar-etiquetas.sql`
--
-- COMO RODAR: pelo `execute_sql` do MCP do Supabase, ou `psql -f` com o arquivo
-- inteiro. Sai UMA TABELA, uma linha por asserção, com `passou` em true/false, e
-- a última linha é o veredito. Qualquer `false` reprova.
--
-- ══════════════════════════════════════════════════════════════════════════
-- AS QUATRO REGRAS DESTA PROVA, todas aprendidas na marra neste projeto
-- ══════════════════════════════════════════════════════════════════════════
--
-- 1. ROLLBACK NO FIM, E NADA DE LIMPAR COM DELETE. Tudo o que a prova precisa
--    ela CRIA aqui dentro (um lote, onze peças, duas garantias) e o `rollback`
--    desfaz. Limpar depois exigiria desarmar trava, e teste que desarma a trava
--    está provando outra coisa.
--
-- 2. O PORTÃO NÃO SE DESARMA PARA PROVAR. Numa conexão de admin `auth.uid()` é
--    NULO, então `is_vessel_admin()` dá falso e TODAS as funções respondem
--    'sem_permissao' — as asserções voltam falsas em bloco e parece defeito na
--    migration. O jeito certo, e o que está feito abaixo: pegar uma conta real
--    como CONTA DE SERVIÇO, tirar dela a chave e o superadmin (para o cenário
--    existir de verdade), provar o portão FECHADO, e só então conceder a chave
--    DENTRO DA TRANSAÇÃO e definir `request.jwt.claims`. Tudo volta no rollback.
--
-- 3. UMA LINHA POR ASSERÇÃO, e nunca `union all`: ele não garante ordem de
--    avaliação, e a ordem aqui é o próprio teste (desmarcar duas vezes tem de
--    dar resultados diferentes). Por isso um bloco `do $$` que insere numa
--    tabela temporária, na ordem em que os fatos acontecem.
--
-- 4. CADA RECUSA PROVADA PELO MOTIVO CERTO. Comparar a STRING do motivo, nunca
--    só "falhou". Já houve aqui um teste que pedia quantidade zero para provar
--    "recusa diminuir abaixo do gravado" e batia antes em 'dados_invalidos':
--    verde, e não provava nada. Por isso cada cenário de recusa é montado para
--    passar por TODAS as portas anteriores e cair exatamente na que se quer.

begin;

create temp table prova(
  ordem     int,
  o_que_prova text,
  esperado  text,
  obtido    text
) on commit drop;

do $$
declare
  v_conta   uuid;
  v_lote    uuid;
  v_res     json;
  v_txt     text;
  v_quem    text;
  v_n       int;
begin
  -- ── A CONTA DE SERVIÇO ────────────────────────────────────────────────────
  -- Uma conta real qualquer, forçada ao estado "logada e SEM a chave". Forçar é
  -- necessário: se calhasse de a conta escolhida já ter a chave, a asserção do
  -- portão passaria sem provar nada. Tudo isto morre no rollback.
  select id into v_conta from public.profiles order by id limit 1;
  if v_conta is null then
    raise exception 'PROVA NÃO RODOU: nenhuma conta em public.profiles para servir de conta de serviço';
  end if;
  -- Este update roda ANTES de qualquer claim ser definida, de propósito: ver o
  -- aviso da autopromoção, mais abaixo.
  update public.profiles
     set is_superadmin = false,
         features = array_remove(coalesce(features, '{}'::text[]), 'autenticidade')
   where id = v_conta;
  perform set_config('request.jwt.claims', json_build_object('sub', v_conta)::text, true);

  -- ── O CENÁRIO ─────────────────────────────────────────────────────────────
  insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em)
  values ('PROVA Altiva', 'Preto Prova', 'PROVA-SKU', 11, current_date)
  returning id into v_lote;

  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em) values
    ('PROVAGRAV1', v_lote,  1, now()),   -- gravada, sem garantia
    ('PROVAGRAV2', v_lote,  2, now()),   -- gravada, COM garantia
    ('PROVAGRAV3', v_lote,  3, now()),   -- gravada -> sobrescrever para fila
    ('PROVAGRAV4', v_lote,  4, now()),   -- gravada -> sobrescrever para baixa
    ('PROVAGRAV5', v_lote,  5, now()),   -- gravada -> cobaia das recusas
    ('PROVAGRAV6', v_lote,  6, now()),   -- gravada, COM garantia -> motivo obrigatório
    ('PROVAGRAV7', v_lote,  7, now()),   -- gravada E JÁ BAIXADA
    ('PROVAPEND1', v_lote,  8, null),
    ('PROVAPEND2', v_lote,  9, null),
    ('PROVAPEND3', v_lote, 10, null),
    ('PROVAPEND4', v_lote, 11, null);

  -- as duas garantias de "cliente de verdade" do cenário
  insert into public.vessel_registros (codigo, nome, whatsapp, garantia_ate) values
    ('PROVAGRAV2', 'Cliente Prova', '19999990000', current_date + 730),
    ('PROVAGRAV6', 'Outra Prova',   '19999990001', current_date + 730);

  -- a peça 7 já tem baixa ativa ANTES de a sobrescrita chegar nela
  insert into public.vessel_baixas (codigo, motivo) values ('PROVAGRAV7', 'extraviada');

  -- ══════════════════════════════════════════════════════════════════════════
  -- GRUPO A — O PORTÃO POR DENTRO (conta logada, SEM a chave 'autenticidade')
  -- ══════════════════════════════════════════════════════════════════════════
  -- Esta é a asserção que vale por `has_function_privilege('authenticated',
  -- ..., 'execute') = false` nas duas funções novas: elas SÃO chamadas pela
  -- tela, então `authenticated` precisa do execute e a única coisa entre uma
  -- pessoa logada sem a chave e a função é este `if`. Ver o GRUPO F.
  insert into prova values (1, 'portão: conta logada SEM a chave não desmarca', 'sem_permissao',
    public.vessel_desmarcar_gravada('PROVAGRAV1', 'tentando sem chave') ->> 'motivo');

  insert into prova values (2, 'portão: conta logada SEM a chave não sobrescreve', 'sem_permissao',
    public.vessel_sobrescrever_etiqueta('PROVAGRAV1','PROVAPEND1','fila','tentando') ->> 'motivo');

  insert into prova values (3, 'portão: e nada foi feito nas costas da recusa', 'gravada',
    (select case when gravada_em is null then 'FILA (defeito)' else 'gravada' end
       from public.vessel_pecas where codigo = 'PROVAGRAV1'));

  -- A CHAVE, concedida aqui dentro. Daqui para baixo a conta é admin do selo.
  --
  -- ⚠️ AS CLAIMS SAEM ANTES DO UPDATE E VOLTAM DEPOIS. Existe neste banco uma
  -- guarda contra AUTOPROMOÇÃO em `profiles` (Onda 1 de Segurança): escrever na
  -- própria ficha com `auth.uid()` apontando para ela é justamente o que a
  -- guarda barra. Escrevendo com as claims vazias, o update é o de uma conexão
  -- de administração — que é o que ele é de verdade — e a prova não precisa
  -- desarmar guarda nenhuma para conceder a chave.
  perform set_config('request.jwt.claims', '', true);
  update public.profiles
     set features = array_append(coalesce(features, '{}'::text[]), 'autenticidade')
   where id = v_conta;
  perform set_config('request.jwt.claims', json_build_object('sub', v_conta)::text, true);

  insert into prova values (4, 'a chave concedida vale: is_vessel_admin()', 'true',
    public.is_vessel_admin()::text);

  -- ══════════════════════════════════════════════════════════════════════════
  -- GRUPO B — DESMARCAR GRAVADA: as recusas, cada uma pelo motivo certo
  -- ══════════════════════════════════════════════════════════════════════════
  insert into prova values (10, 'desmarcar: peça que não existe', 'peca_nao_existe',
    public.vessel_desmarcar_gravada('NAOEXISTEAA', 'x') ->> 'motivo');

  -- PROVAPEND1 EXISTE e não está gravada: sem isso a recusa viria por
  -- 'peca_nao_existe' e o teste passaria verde provando a porta errada.
  insert into prova values (11, 'desmarcar: peça que existe mas NÃO está gravada', 'nao_esta_gravada',
    public.vessel_desmarcar_gravada('PROVAPEND1', 'x') ->> 'motivo');

  -- PROVAGRAV2 existe, ESTÁ gravada e TEM garantia — passa pelas duas portas
  -- anteriores e cai exatamente na do motivo.
  insert into prova values (12, 'desmarcar: com garantia e motivo em branco', 'motivo_obrigatorio',
    public.vessel_desmarcar_gravada('PROVAGRAV2', '   ') ->> 'motivo');

  -- ── as duas passagens ─────────────────────────────────────────────────────
  v_res := public.vessel_desmarcar_gravada('PROVAGRAV1', null);
  insert into prova values (13, 'desmarcar SEM garantia aceita motivo em branco', 'true',
    (v_res ->> 'ok'));
  insert into prova values (14, 'desmarcar sem garantia: tinha_garantia = false', 'false',
    (v_res ->> 'tinha_garantia'));
  insert into prova values (15, 'desmarcar: a peça VOLTOU para a fila', 'true',
    (select (gravada_em is null)::text from public.vessel_pecas where codigo = 'PROVAGRAV1'));
  insert into prova values (16, 'desmarcar de novo a mesma peça é recusado', 'nao_esta_gravada',
    public.vessel_desmarcar_gravada('PROVAGRAV1', 'x') ->> 'motivo');

  v_res := public.vessel_desmarcar_gravada('PROVAGRAV2', 'gravei na etiqueta errada');
  insert into prova values (17, 'desmarcar COM garantia é permitido (decisão do dono)', 'true',
    (v_res ->> 'ok'));
  insert into prova values (18, 'desmarcar com garantia avisa: tinha_garantia = true', 'true',
    (v_res ->> 'tinha_garantia'));
  insert into prova values (19, 'desmarcar com garantia devolve o aviso escrito', 'true',
    (length(coalesce(v_res ->> 'aviso', '')) > 0)::text);
  insert into prova values (20, 'a garantia da cliente CONTINUA lá', '1',
    (select count(*)::text from public.vessel_registros where codigo = 'PROVAGRAV2'));
  insert into prova values (21, 'a trilha guardou o motivo escrito', 'gravei na etiqueta errada',
    (select motivo from public.vessel_edicoes
      where codigo = 'PROVAGRAV2' and acao = 'desmarcar_gravada'));
  insert into prova values (22, 'a trilha marcou que havia garantia', 'true',
    (select detalhes ->> 'tinha_garantia' from public.vessel_edicoes
      where codigo = 'PROVAGRAV2' and acao = 'desmarcar_gravada'));
  insert into prova values (23, 'a trilha sabe QUEM fez (auth.uid, não parâmetro)', 'true',
    (select (feito_por = v_conta)::text from public.vessel_edicoes
      where codigo = 'PROVAGRAV2' and acao = 'desmarcar_gravada'));

  -- ══════════════════════════════════════════════════════════════════════════
  -- GRUPO C — SOBRESCREVER: as recusas, cada uma pelo motivo certo
  -- ══════════════════════════════════════════════════════════════════════════
  -- Todos os cenários abaixo usam códigos que EXISTEM e uma antiga que ESTÁ
  -- gravada, de propósito: assim a recusa só pode vir da porta que se quer.
  insert into prova values (30, 'sobrescrever: destino que não é fila nem baixa', 'destino_invalido',
    public.vessel_sobrescrever_etiqueta('PROVAGRAV5','PROVAPEND3','reciclar','x') ->> 'motivo');

  insert into prova values (31, 'sobrescrever: a mesma peça nos dois campos', 'mesma_peca',
    public.vessel_sobrescrever_etiqueta('PROVAGRAV5','PROVAGRAV5','fila','x') ->> 'motivo');

  insert into prova values (32, 'sobrescrever: a peça ANTIGA não existe', 'antiga_nao_existe',
    public.vessel_sobrescrever_etiqueta('NAOEXISTEAA','PROVAPEND3','fila','x') ->> 'motivo');

  insert into prova values (33, 'sobrescrever: a peça NOVA não existe', 'nova_nao_existe',
    public.vessel_sobrescrever_etiqueta('PROVAGRAV5','NAOEXISTEBB','fila','x') ->> 'motivo');

  insert into prova values (34, 'sobrescrever: a antiga não está gravada', 'antiga_nao_esta_gravada',
    public.vessel_sobrescrever_etiqueta('PROVAPEND1','PROVAPEND3','fila','x') ->> 'motivo');

  -- a NOVA já gravada colocaria o mesmo código em duas etiquetas
  insert into prova values (35, 'sobrescrever: a nova JÁ está gravada', 'nova_ja_gravada',
    public.vessel_sobrescrever_etiqueta('PROVAGRAV5','PROVAGRAV3','fila','x') ->> 'motivo');

  -- destino 'baixa' com motivo fora da lista do `check` de vessel_baixas
  insert into prova values (36, 'sobrescrever para baixa: motivo fora da lista', 'motivo_invalido',
    public.vessel_sobrescrever_etiqueta('PROVAGRAV5','PROVAPEND3','baixa','motivo_inventado') ->> 'motivo');

  -- antiga COM garantia e sem motivo escrito
  insert into prova values (37, 'sobrescrever: antiga com garantia e motivo em branco', 'motivo_obrigatorio',
    public.vessel_sobrescrever_etiqueta('PROVAGRAV6','PROVAPEND3','fila','  ') ->> 'motivo');

  insert into prova values (38, 'nenhuma recusa mexeu em peça nenhuma', '5',
    (select count(*)::text from public.vessel_pecas
      where lote_id = v_lote and gravada_em is not null));
  -- esperado 5: das 7 gravadas do cenário, 2 saíram nas passagens do GRUPO B

  -- ══════════════════════════════════════════════════════════════════════════
  -- GRUPO D — SOBRESCREVER: os dois caminhos que o dono pediu
  -- ══════════════════════════════════════════════════════════════════════════
  v_res := public.vessel_sobrescrever_etiqueta('PROVAGRAV3','PROVAPEND1','fila','etiqueta reaproveitada');
  insert into prova values (40, 'sobrescrever para FILA responde ok', 'true', (v_res ->> 'ok'));
  insert into prova values (41, 'destino fila: a ANTIGA voltou para a fila', 'true',
    (select (gravada_em is null)::text from public.vessel_pecas where codigo = 'PROVAGRAV3'));
  insert into prova values (42, 'destino fila: a NOVA ficou gravada', 'true',
    (select (gravada_em is not null)::text from public.vessel_pecas where codigo = 'PROVAPEND1'));
  insert into prova values (43, 'destino fila: a antiga NÃO ganhou baixa', '0',
    (select count(*)::text from public.vessel_baixas
      where codigo = 'PROVAGRAV3' and desfeita_em is null));
  insert into prova values (44, 'destino fila: a trilha aponta para o código novo', 'PROVAPEND1',
    (select detalhes ->> 'codigo_novo' from public.vessel_edicoes
      where codigo = 'PROVAGRAV3' and acao = 'sobrescrever_para_fila'));

  v_res := public.vessel_sobrescrever_etiqueta('PROVAGRAV4','PROVAPEND2','baixa','defeito');
  insert into prova values (50, 'sobrescrever para BAIXA responde ok', 'true', (v_res ->> 'ok'));
  insert into prova values (51, 'destino baixa: a antiga saiu da fila com baixa ativa', 'defeito',
    (select motivo from public.vessel_baixas
      where codigo = 'PROVAGRAV4' and desfeita_em is null));
  insert into prova values (52, 'destino baixa: a antiga perdeu a marca de gravada', 'true',
    (select (gravada_em is null)::text from public.vessel_pecas where codigo = 'PROVAGRAV4'));
  insert into prova values (53, 'destino baixa: a NOVA ficou gravada', 'true',
    (select (gravada_em is not null)::text from public.vessel_pecas where codigo = 'PROVAPEND2'));
  insert into prova values (54, 'destino baixa: quem baixou saiu de auth.uid()', 'true',
    (select (baixada_por = v_conta)::text from public.vessel_baixas
      where codigo = 'PROVAGRAV4' and desfeita_em is null));
  insert into prova values (55, 'destino baixa: a trilha registrou a ação certa', '1',
    (select count(*)::text from public.vessel_edicoes
      where codigo = 'PROVAGRAV4' and acao = 'sobrescrever_para_baixa'));

  -- A PEÇA QUE JÁ ESTAVA BAIXADA. Sem o `if not exists` da função, o índice
  -- único parcial `vessel_baixas_ativa_idx` estouraria aqui e derrubaria a
  -- sobrescrita inteira — e a etiqueta nova ficaria sem dono.
  v_res := public.vessel_sobrescrever_etiqueta('PROVAGRAV7','PROVAPEND4','baixa','teste');
  insert into prova values (60, 'antiga JÁ baixada: a sobrescrita passa mesmo assim', 'true',
    (v_res ->> 'ok'));
  insert into prova values (61, 'antiga já baixada: continua com UMA baixa ativa só', '1',
    (select count(*)::text from public.vessel_baixas
      where codigo = 'PROVAGRAV7' and desfeita_em is null));
  insert into prova values (62, 'antiga já baixada: a baixa original não foi trocada', 'extraviada',
    (select motivo from public.vessel_baixas
      where codigo = 'PROVAGRAV7' and desfeita_em is null));
  insert into prova values (63, 'antiga já baixada: a nova ficou gravada assim mesmo', 'true',
    (select (gravada_em is not null)::text from public.vessel_pecas where codigo = 'PROVAPEND4'));

  -- ══════════════════════════════════════════════════════════════════════════
  -- GRUPO E — A TRILHA E O MOTIVO 'teste'
  -- ══════════════════════════════════════════════════════════════════════════
  -- CINCO passagens houve (2 desmarcar + 3 sobrescrever) e treze recusas. Se
  -- alguma recusa escrevesse na trilha, a auditoria contaria história que não
  -- aconteceu — e é o tipo de erro que ninguém percebe olhando a tela.
  insert into prova values (70, 'a trilha tem UMA linha por passagem, e nenhuma por recusa', '5',
    (select count(*)::text from public.vessel_edicoes));

  insert into prova values (71, 'RLS ligada na trilha', 'true',
    (select relrowsecurity::text from pg_class where oid = 'public.vessel_edicoes'::regclass));
  insert into prova values (72, 'a trilha tem exatamente UMA política, igual às irmãs', '1',
    (select count(*)::text from pg_policies
      where schemaname = 'public' and tablename = 'vessel_edicoes'));
  insert into prova values (73, 'e ela é de SELECT (nenhuma escrita direta)', 'SELECT',
    (select cmd from pg_policies
      where schemaname = 'public' and tablename = 'vessel_edicoes'));

  -- O motivo novo. Vale nos DOIS lugares onde a lista mora no banco: o `check`
  -- da tabela e o `if` de dentro de vessel_baixar_peca. Se só um tivesse sido
  -- acertado, a linha abaixo devolveria 'motivo_invalido' ou estouraria o check.
  insert into prova values (80, 'motivo novo: baixar com "teste" é aceito', 'true',
    public.vessel_baixar_peca('PROVAGRAV1', 'teste') ->> 'ok');
  insert into prova values (81, 'motivo novo: o check da tabela deixou gravar "teste"', '1',
    (select count(*)::text from public.vessel_baixas
      where codigo = 'PROVAGRAV1' and motivo = 'teste' and desfeita_em is null));
  insert into prova values (82, 'e motivo inventado CONTINUA recusado (não virou texto livre)', 'motivo_invalido',
    public.vessel_baixar_peca('PROVAGRAV5', 'motivo_inventado') ->> 'motivo');
  insert into prova values (83, 'e os quatro motivos antigos continuam valendo', 'true',
    public.vessel_baixar_peca('PROVAGRAV5', 'etiqueta_perdida') ->> 'ok');

  -- ══════════════════════════════════════════════════════════════════════════
  -- GRUPO F — QUEM PODE CHAMAR (as asserções que nenhuma outra pega)
  -- ══════════════════════════════════════════════════════════════════════════
  -- Todas as asserções acima medem o que a função FAZ. Nenhuma delas enxerga
  -- QUEM consegue chamá-la, e foi exatamente aí que passou o buraco de 30/08.
  --
  -- ⚠️ LEIA ANTES DE "CONSERTAR" O ESPERADO DAS LINHAS 94 E 95: para as duas
  -- funções novas, `has_function_privilege('authenticated', ...)` é TRUE DE
  -- PROPÓSITO — a tela chama as duas, e sem o execute ninguém usaria a
  -- ferramenta. O `= false` que a regra de ouro pede vale para `anon` e para o
  -- PUBLIC (linhas 90 a 93); para `authenticated`, quem faz o papel de trava é o
  -- portão por dentro, provado nas linhas 1 e 2 deste mesmo arquivo. Trocar
  -- estas duas por `false` faria a prova reprovar uma migration correta.
  insert into prova values (90, 'anon NÃO executa vessel_desmarcar_gravada', 'false',
    has_function_privilege('anon', 'public.vessel_desmarcar_gravada(text,text)', 'execute')::text);
  insert into prova values (91, 'anon NÃO executa vessel_sobrescrever_etiqueta', 'false',
    has_function_privilege('anon', 'public.vessel_sobrescrever_etiqueta(text,text,text,text)', 'execute')::text);
  insert into prova values (92, 'anon NÃO executa vessel_baixar_peca (recriada aqui)', 'false',
    has_function_privilege('anon', 'public.vessel_baixar_peca(text,text)', 'execute')::text);

  -- PUBLIC não aparece em `has_function_privilege`: no ACL ele é a entrada de
  -- concessionário VAZIO ("=X/dono"). Contar por aqui é a única forma honesta.
  --
  -- ⚠️ E O `proacl` NULO CONTA COMO ABERTO. Função sem ACL nenhuma não é função
  -- fechada: é função no DEFAULT, e o default do Postgres para função é EXECUTE
  -- PARA PUBLIC. Uma primeira versão desta asserção só procurava a entrada de
  -- concessionário vazio, e teria dado VERDE justamente no caso em que ninguém
  -- revogou nada — o defeito exato que a asserção existe para pegar.
  insert into prova values (93, 'nenhuma das três está aberta ao PUBLIC', '0',
    (select count(*)::text from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname in ('vessel_desmarcar_gravada','vessel_sobrescrever_etiqueta','vessel_baixar_peca')
        and (p.proacl is null
             or exists (select 1 from unnest(p.proacl) a where split_part(a::text, '=', 1) = ''))));

  insert into prova values (94, 'authenticated EXECUTA desmarcar (a tela chama; a trava é o portão)', 'true',
    has_function_privilege('authenticated', 'public.vessel_desmarcar_gravada(text,text)', 'execute')::text);
  insert into prova values (95, 'authenticated EXECUTA sobrescrever (a tela chama; a trava é o portão)', 'true',
    has_function_privilege('authenticated', 'public.vessel_sobrescrever_etiqueta(text,text,text,text)', 'execute')::text);

  -- ── E a trilha, que a tela SÓ LÊ ─────────────────────────────────────────
  insert into prova values (96, 'authenticated NÃO tem INSERT na trilha', 'false',
    has_table_privilege('authenticated', 'public.vessel_edicoes', 'insert')::text);
  insert into prova values (97, 'authenticated NÃO tem UPDATE na trilha', 'false',
    has_table_privilege('authenticated', 'public.vessel_edicoes', 'update')::text);
  insert into prova values (98, 'authenticated NÃO tem DELETE na trilha', 'false',
    has_table_privilege('authenticated', 'public.vessel_edicoes', 'delete')::text);
  insert into prova values (99, 'anon NÃO lê a trilha', 'false',
    has_table_privilege('anon', 'public.vessel_edicoes', 'select')::text);

  -- A TENTATIVA DE VERDADE, não só o catálogo. `has_table_privilege` diz o que
  -- o GRANT permite; isto diz o que acontece quando alguém tenta.
  begin
    set local role authenticated;
    v_quem := current_user;                -- confere que o SET ROLE pegou mesmo
    insert into public.vessel_edicoes (codigo, acao) values ('PROVAGRAV1','desmarcar_gravada');
    v_txt := 'GRAVOU';
  exception when others then
    v_txt := 'barrado ' || sqlstate;
  end;
  reset role;
  insert into prova values (100, 'escrita direta na trilha, logada, é barrada de fato',
    'authenticated / barrado 42501', coalesce(v_quem,'?') || ' / ' || coalesce(v_txt,'?'));

  -- E que a tentativa barrada não deixou lixo
  select count(*) into v_n from public.vessel_edicoes;
  insert into prova values (101, 'a trilha continua com as 5 linhas das passagens', '5', v_n::text);
end $$;

select ordem,
       o_que_prova,
       esperado,
       obtido,
       (obtido is not distinct from esperado) as passou
  from prova
union all
select 999,
       'VEREDITO — asserções que passaram / total',
       (select count(*)::text from prova),
       (select (count(*) filter (where obtido is not distinct from esperado))::text from prova),
       (select bool_and(obtido is not distinct from esperado) from prova)
order by 1;

rollback;

-- DEPOIS DE RODAR, conferir que não sobrou NADA (o rollback já garante, mas a
-- conferência custa dois segundos e pega um `commit` digitado por engano):
--   select count(*) from public.vessel_edicoes;                       -- da migration: 0
--   select count(*) from public.vessel_pecas where codigo like 'PROVA%';  -- 0
--   select count(*) from public.vessel_lotes where modelo like 'PROVA%';  -- 0
--   select count(*) from public.vessel_baixas b
--     join public.vessel_pecas p on p.codigo = b.codigo
--    where p.codigo like 'PROVA%';                                    -- 0
--
-- E a conta de serviço tem de estar EXATAMENTE como estava — a prova mexeu em
-- `features` e `is_superadmin` da primeira linha de `profiles`:
--   select id, is_superadmin, features from public.profiles order by id limit 1;
