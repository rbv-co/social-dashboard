-- PROVA DE `2026-09-03-zz-vessel-garantia-com-dono.sql`
--
--   node coletor/provar-migration.mjs \
--     db/migrations/2026-09-03-zz-vessel-garantia-com-dono.sql \
--     docs/provar-garantia-com-dono.sql
--
-- Transacao que SE DESFAZ. O lote e as pecas da prova nascem aqui dentro.
--
-- ⚠️ NAO DESARMA O PORTAO: empresta a chave a uma conta que ja existe, dentro
-- da transacao. `auth.uid()` e nulo numa conexao de admin, e sem isto tudo
-- responderia `sem_permissao` e pareceria defeito da migration.

begin;

create temp table resultado(ordem int, o_que_prova text, esperado text, obtido text, passou boolean)
  on commit drop;

do $$
declare
  v_pessoa uuid; v_lote uuid; v_r json; v_ped uuid; v_ped2 uuid; v_obtido text;
  -- CPFs validos de teste (passam no digito verificador, nao pertencem a ninguem)
  c_ana   text := '52998224725';
  c_outra text := '11144477735';
begin
  perform set_config('request.jwt.claims', '', true);
  select id into v_pessoa from public.profiles order by id limit 1;
  update public.profiles set features = array['autenticidade'], is_superadmin = false where id = v_pessoa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa)::text, true);

  insert into public.vessel_lotes (modelo, cor, sku, quantidade, fabricado_em)
  values ('PROVA GARANTIA', 'Caramelo', 'H0099S', 2, current_date - 30) returning id into v_lote;
  insert into public.vessel_pecas (codigo, lote_id, numero_na_serie)
  values ('PRVGAR0001', v_lote, 1), ('PRVGAR0002', v_lote, 2);

  -- ══════════════════════════════════════════════════════════════════════
  -- 1. O CPF
  -- ══════════════════════════════════════════════════════════════════════
  insert into resultado values (1, 'CPF valido passa', 'true',
    public.vessel_cpf_valido(c_ana)::text, public.vessel_cpf_valido(c_ana));
  insert into resultado values (2, 'CPF com digito errado NAO passa', 'false',
    public.vessel_cpf_valido('52998224724')::text, not public.vessel_cpf_valido('52998224724'));
  insert into resultado values (3, '111.111.111-11 NAO passa (o falso que todo mundo digita)',
    'false', public.vessel_cpf_valido('11111111111')::text,
    not public.vessel_cpf_valido('11111111111'));
  insert into resultado values (4, 'CPF mascarado nunca mostra os 3 primeiros nem os 2 ultimos',
    '***.982.247-**', public.vessel_cpf_mascarado(c_ana),
    public.vessel_cpf_mascarado(c_ana) = '***.982.247-**');

  -- ══════════════════════════════════════════════════════════════════════
  -- 2. ABRIR PEDIDO
  -- ══════════════════════════════════════════════════════════════════════
  v_r := public.vessel_abrir_pedido_de_registro('PRVGAR0001', 'Ana Paula Souza', c_ana,
                                                '11988887777', 'Loja', current_date - 10);
  insert into resultado values (10, 'abre o pedido e devolve o SKU para a edge conferir no Bling',
    'H0099S', coalesce(v_r->>'sku','(nada)'), (v_r->>'ok')='true' and (v_r->>'sku')='H0099S');
  v_ped := (v_r->>'pedido')::uuid;
  insert into resultado values (11, 'nasce PENDENTE, nao aprovado', 'pendente',
    (select estado from public.vessel_pedidos_de_registro where id = v_ped),
    (select estado from public.vessel_pedidos_de_registro where id = v_ped) = 'pendente');
  insert into resultado values (12, 'e a peca AINDA NAO TEM DONO', 'true',
    (select (count(*)=0)::text from public.vessel_registros where codigo='PRVGAR0001'),
    (select count(*)=0 from public.vessel_registros where codigo='PRVGAR0001'));

  insert into resultado values (13, 'CPF invalido e recusado', 'cpf_invalido',
    coalesce(public.vessel_abrir_pedido_de_registro('PRVGAR0001','Fulano','12345678900','11988887777')->>'motivo','(passou!)'),
    public.vessel_abrir_pedido_de_registro('PRVGAR0001','Fulano','12345678900','11988887777')->>'motivo' = 'cpf_invalido');
  insert into resultado values (14, 'compra no FUTURO e recusada (estica a garantia)', 'compra_no_futuro',
    coalesce(public.vessel_abrir_pedido_de_registro('PRVGAR0001','Fulano',c_outra,'11988887777',null,current_date+1)->>'motivo','(passou!)'),
    public.vessel_abrir_pedido_de_registro('PRVGAR0001','Fulano',c_outra,'11988887777',null,current_date+1)->>'motivo' = 'compra_no_futuro');

  v_r := public.vessel_abrir_pedido_de_registro('PRVGAR0001', 'Ana Paula Souza', c_ana,
                                                '11988887777', 'Loja', current_date - 10);
  insert into resultado values (15, 'o MESMO CPF apertando de novo NAO enche a fila',
    v_ped::text, coalesce(v_r->>'pedido','(nada)'), (v_r->>'pedido')::uuid = v_ped);

  -- ══════════════════════════════════════════════════════════════════════
  -- 3. O CORACAO: PENDENTE NAO TRANCA A ETIQUETA
  -- ══════════════════════════════════════════════════════════════════════
  -- Era ISTO o defeito antigo: a primeira pessoa a registrar trancava a peca,
  -- e a dona de verdade lia "ja registrada" e ficava sem garantia.
  v_r := public.vessel_abrir_pedido_de_registro('PRVGAR0001', 'Beatriz Lima', c_outra,
                                                '21977776666', 'Presente', current_date - 5);
  insert into resultado values (20,
    'OUTRA pessoa ainda consegue abrir pedido na MESMA peca (o defeito antigo)',
    'true', coalesce(v_r->>'ok','(nada)'), (v_r->>'ok') = 'true');
  v_ped2 := (v_r->>'pedido')::uuid;
  insert into resultado values (21, 'e sao DOIS pedidos na fila, nao um', '2',
    (select count(*)::text from public.vessel_pedidos_de_registro where codigo='PRVGAR0001' and estado='pendente'),
    (select count(*) from public.vessel_pedidos_de_registro where codigo='PRVGAR0001' and estado='pendente') = 2);

  -- ══════════════════════════════════════════════════════════════════════
  -- 4. DECIDIR
  -- ══════════════════════════════════════════════════════════════════════
  insert into resultado values (30,
    'aprovacao AUTOMATICA sem a prova do Bling anexada e recusada',
    'conferencia_sem_pedido',
    coalesce(public.vessel_decidir_pedido_de_registro(v_ped,'aprovado','bling','{}'::jsonb)->>'motivo','(passou!)'),
    public.vessel_decidir_pedido_de_registro(v_ped,'aprovado','bling','{}'::jsonb)->>'motivo' = 'conferencia_sem_pedido');
  insert into resultado values (31, 'recusar SEM motivo escrito e recusado', 'motivo_obrigatorio',
    coalesce(public.vessel_decidir_pedido_de_registro(v_ped2,'recusado','na_mao')->>'motivo','(passou!)'),
    public.vessel_decidir_pedido_de_registro(v_ped2,'recusado','na_mao')->>'motivo' = 'motivo_obrigatorio');

  v_r := public.vessel_decidir_pedido_de_registro(v_ped, 'aprovado', 'bling',
           jsonb_build_object('pedido','12345','contato','999','quando',current_date::text));
  insert into resultado values (32, 'aprovado pelo Bling: vira dono', 'true',
    coalesce(v_r->>'ok','(nada)'), (v_r->>'ok') = 'true');
  insert into resultado values (33, 'a garantia conta 2 anos DA COMPRA, nao de hoje',
    (current_date - 10 + interval '2 years')::date::text, coalesce(v_r->>'garantia_ate','(nada)'),
    (v_r->>'garantia_ate')::date = (current_date - 10 + interval '2 years')::date);
  insert into resultado values (34, 'e o numero do pedido do Bling fica guardado', '12345',
    coalesce((select bling_pedido from public.vessel_registros where codigo='PRVGAR0001'),'(nada)'),
    (select bling_pedido from public.vessel_registros where codigo='PRVGAR0001') = '12345');
  insert into resultado values (35, 'a decisao entra na trilha que a tela ja le', '1',
    (select count(*)::text from public.vessel_edicoes where codigo='PRVGAR0001' and acao='registro_aprovado'),
    (select count(*) from public.vessel_edicoes where codigo='PRVGAR0001' and acao='registro_aprovado') = 1);
  insert into resultado values (36, 'e a trilha guarda o CPF MASCARADO, nunca o inteiro',
    'true',
    (select (detalhes->>'cpf' = '***.982.247-**')::text from public.vessel_edicoes
      where codigo='PRVGAR0001' and acao='registro_aprovado'),
    (select detalhes->>'cpf' = '***.982.247-**' from public.vessel_edicoes
      where codigo='PRVGAR0001' and acao='registro_aprovado'));
  insert into resultado values (37, 'decidir DE NOVO o mesmo pedido e recusado', 'ja_decidido',
    coalesce(public.vessel_decidir_pedido_de_registro(v_ped,'recusado','na_mao','{}'::jsonb,'x')->>'motivo','(passou!)'),
    public.vessel_decidir_pedido_de_registro(v_ped,'recusado','na_mao','{}'::jsonb,'x')->>'motivo' = 'ja_decidido');

  -- ══════════════════════════════════════════════════════════════════════
  -- 5. A PAGINA DA CLIENTE — O QUE ELA MOSTRA E O QUE ELA NAO VAZA
  -- ══════════════════════════════════════════════════════════════════════
  v_r := public.vessel_verificar('PRVGAR0001');
  insert into resultado values (40, 'mostra "Ana P.", nao "Ana***" e nao o nome inteiro',
    'Ana P.', coalesce(v_r->>'dono_curto','(nada)'), (v_r->>'dono_curto') = 'Ana P.');
  insert into resultado values (41, 'e avisa a pagina que da para provar quem e', 'true',
    coalesce(v_r->>'pode_revelar','(nada)'), (v_r->>'pode_revelar') = 'true');

  -- ⚠️ A ASSERCAO MAIS IMPORTANTE DESTE ARQUIVO. Esta funcao responde a `anon`:
  -- qualquer pessoa do mundo com o codigo da etiqueta. A lista e FECHADA, e o
  -- teste reprova quem acrescentar campo sem pensar nisso.
  select string_agg(k, ',' order by k) into v_obtido from json_object_keys(v_r) k;
  insert into resultado values (42,
    'vessel_verificar devolve SO estas chaves — nada de CPF, WhatsApp ou onde comprou',
    'cor,dono_curto,fabricado_em,fotos,garantia_ate,modelo,numero,ok,pode_revelar,registrada,registrada_em,sku,total',
    v_obtido,
    v_obtido = 'cor,dono_curto,fabricado_em,fotos,garantia_ate,modelo,numero,ok,pode_revelar,registrada,registrada_em,sku,total');

  insert into resultado values (43, 'a pagina VELHA nao grava mais nada, e diz por que',
    'pagina_velha',
    coalesce(public.vessel_registrar('PRVGAR0002','Alguem','11988887777')->>'motivo','(gravou!)'),
    public.vessel_registrar('PRVGAR0002','Alguem','11988887777')->>'motivo' = 'pagina_velha');

  -- ⚠️ OS MESMOS CASOS ESTAO EM `vessel-brasil/verify/regras.test.mjs`, do lado
  -- da pagina. As duas contas TEM de dar o mesmo resultado: divergindo, a mesma
  -- pessoa aparece de um jeito no segundo seguinte ao registro (quando a pagina
  -- calcula sozinha) e de outro quando ela voltar depois (quando quem responde
  -- e o banco) — e quem ve isso desconfia do certificado inteiro.
  insert into resultado values (44, 'nome curto: "Ana Paula Souza" vira "Ana P."',
    'Ana P.', public.vessel_nome_curto('Ana Paula Souza'),
    public.vessel_nome_curto('Ana Paula Souza') = 'Ana P.');
  insert into resultado values (45, 'nome curto: "Erick Martins" vira "Erick M."',
    'Erick M.', public.vessel_nome_curto('Erick Martins'),
    public.vessel_nome_curto('Erick Martins') = 'Erick M.');
  insert into resultado values (46, 'nome curto: um nome so devolve ele mesmo',
    'Madonna', public.vessel_nome_curto('Madonna'),
    public.vessel_nome_curto('Madonna') = 'Madonna');
  insert into resultado values (47, 'nome curto: espaco a mais nao muda a resposta',
    'maria D.', public.vessel_nome_curto('  maria   das   dores  '),
    public.vessel_nome_curto('  maria   das   dores  ') = 'maria D.');
  insert into resultado values (48, 'nome curto: vazio nao vira pontuacao solta',
    '(nulo)', coalesce(public.vessel_nome_curto('   '), '(nulo)'),
    public.vessel_nome_curto('   ') is null);

  -- ══════════════════════════════════════════════════════════════════════
  -- 6. REVELAR O NOME INTEIRO
  -- ══════════════════════════════════════════════════════════════════════
  v_r := public.vessel_revelar_dono('PRVGAR0001', c_ana);
  insert into resultado values (50, 'com o CPF certo, sai o nome inteiro', 'Ana Paula Souza',
    coalesce(v_r->>'nome','(nada)'), (v_r->>'nome') = 'Ana Paula Souza');
  select string_agg(k, ',' order by k) into v_obtido from json_object_keys(v_r) k;
  insert into resultado values (51, 'e SO o nome: nem CPF, nem WhatsApp, nem onde comprou',
    'garantia_ate,nome,ok', v_obtido, v_obtido = 'garantia_ate,nome,ok');
  insert into resultado values (52, 'o WhatsApp inteiro tambem serve de prova', 'true',
    coalesce(public.vessel_revelar_dono('PRVGAR0001','11988887777')->>'ok','(nada)'),
    public.vessel_revelar_dono('PRVGAR0001','11988887777')->>'ok' = 'true');
  insert into resultado values (53, 'os 4 ULTIMOS do WhatsApp NAO servem (10 mil tentativas)',
    'nao_confere', coalesce(public.vessel_revelar_dono('PRVGAR0001','7777')->>'motivo','(revelou!)'),
    public.vessel_revelar_dono('PRVGAR0001','7777')->>'motivo' = 'nao_confere');
  insert into resultado values (54,
    'peca SEM dono responde IGUAL a prova errada (nao conta quais ja foram vendidas)',
    'nao_confere', coalesce(public.vessel_revelar_dono('PRVGAR0002',c_ana)->>'motivo','(vazou!)'),
    public.vessel_revelar_dono('PRVGAR0002',c_ana)->>'motivo' = 'nao_confere');

  -- rate limit: ja houve 5 tentativas acima nesta peca; mais 6 estouram as 10
  for i in 1..6 loop perform public.vessel_revelar_dono('PRVGAR0001','00000000000'); end loop;
  insert into resultado values (55, 'depois de 10 tentativas numa hora, para de responder',
    'muitas_tentativas', coalesce(public.vessel_revelar_dono('PRVGAR0001',c_ana)->>'motivo','(respondeu!)'),
    public.vessel_revelar_dono('PRVGAR0001',c_ana)->>'motivo' = 'muitas_tentativas');

  -- ══════════════════════════════════════════════════════════════════════
  -- 7. TROCAR O DONO
  -- ══════════════════════════════════════════════════════════════════════
  insert into resultado values (60, 'sem digitar o codigo da peca, recusa', 'confirmacao_nao_bate',
    coalesce(public.vessel_trocar_dono('PRVGAR0001','Carla Dias',c_outra,'31955554444','revenda','ERRADO')->>'motivo','(trocou!)'),
    public.vessel_trocar_dono('PRVGAR0001','Carla Dias',c_outra,'31955554444','revenda','ERRADO')->>'motivo' = 'confirmacao_nao_bate');
  insert into resultado values (61, 'sem motivo escrito, recusa', 'motivo_obrigatorio',
    coalesce(public.vessel_trocar_dono('PRVGAR0001','Carla Dias',c_outra,'31955554444','','PRVGAR0001')->>'motivo','(trocou!)'),
    public.vessel_trocar_dono('PRVGAR0001','Carla Dias',c_outra,'31955554444','','PRVGAR0001')->>'motivo' = 'motivo_obrigatorio');

  v_obtido := (select garantia_ate::text from public.vessel_registros where codigo='PRVGAR0001');
  v_r := public.vessel_trocar_dono('PRVGAR0001','Carla Dias',c_outra,'31955554444',
                                   'revendeu para a Carla','PRVGAR0001');
  insert into resultado values (62, 'com codigo e motivo, troca', 'true',
    coalesce(v_r->>'ok','(nada)'), (v_r->>'ok') = 'true');
  insert into resultado values (63, 'a garantia NAO recomeca: continua contando da compra original',
    v_obtido, (select garantia_ate::text from public.vessel_registros where codigo='PRVGAR0001'),
    (select garantia_ate::text from public.vessel_registros where codigo='PRVGAR0001') = v_obtido);
  insert into resultado values (64, 'o vinculo com o pedido do Bling do dono ANTIGO e desfeito',
    'true', (select (bling_pedido is null)::text from public.vessel_registros where codigo='PRVGAR0001'),
    (select bling_pedido is null from public.vessel_registros where codigo='PRVGAR0001'));
  insert into resultado values (65, 'e a trilha guarda de quem para quem', 'true',
    (select (detalhes->'de'->>'nome' = 'Ana Paula Souza'
             and detalhes->'para'->>'nome' = 'Carla Dias')::text
       from public.vessel_edicoes where codigo='PRVGAR0001' and acao='dono_trocado'),
    (select detalhes->'de'->>'nome' = 'Ana Paula Souza' and detalhes->'para'->>'nome' = 'Carla Dias'
       from public.vessel_edicoes where codigo='PRVGAR0001' and acao='dono_trocado'));

  -- ══════════════════════════════════════════════════════════════════════
  -- 8. A FILA DO PAINEL
  -- ══════════════════════════════════════════════════════════════════════
  v_r := public.vessel_fila_de_registros('PRVGAR0001');
  insert into resultado values (70, 'a fila devolve os dois pedidos da peca', '2',
    json_array_length(v_r->'pedidos')::text, json_array_length(v_r->'pedidos') = 2);
  insert into resultado values (71, 'e o CPF sai MASCARADO ate para quem tem a chave',
    '***.982.247-**',
    coalesce((select x->>'cpf' from json_array_elements(v_r->'pedidos') x
               where x->>'nome' = 'Ana Paula Souza'), '(nada)'),
    (select x->>'cpf' from json_array_elements(v_r->'pedidos') x
      where x->>'nome' = 'Ana Paula Souza') = '***.982.247-**');

  -- ══════════════════════════════════════════════════════════════════════
  -- 9. OS PORTOES
  -- ══════════════════════════════════════════════════════════════════════
  perform set_config('request.jwt.claims', '', true);
  update public.profiles set features = array[]::text[] where id = v_pessoa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pessoa)::text, true);

  insert into resultado values (80, 'sem a chave: nao decide pedido', 'sem_permissao',
    coalesce(public.vessel_decidir_pedido_de_registro(v_ped2,'recusado','na_mao','{}'::jsonb,'x')->>'motivo','(decidiu!)'),
    public.vessel_decidir_pedido_de_registro(v_ped2,'recusado','na_mao','{}'::jsonb,'x')->>'motivo' = 'sem_permissao');
  insert into resultado values (81, 'sem a chave: nao troca dono', 'sem_permissao',
    coalesce(public.vessel_trocar_dono('PRVGAR0001','X',c_ana,'11988887777','y','PRVGAR0001')->>'motivo','(trocou!)'),
    public.vessel_trocar_dono('PRVGAR0001','X',c_ana,'11988887777','y','PRVGAR0001')->>'motivo' = 'sem_permissao');
  insert into resultado values (82, 'sem a chave: nao ve a fila', 'sem_permissao',
    coalesce(public.vessel_fila_de_registros()->>'motivo','(viu!)'),
    public.vessel_fila_de_registros()->>'motivo' = 'sem_permissao');
end $$;

-- ── OS GRANTS: estado do banco, fora do bloco acima ──
insert into resultado values (90, 'anon LE a pagina do certificado', 'true',
  has_function_privilege('anon','public.vessel_verificar(text)','execute')::text,
  has_function_privilege('anon','public.vessel_verificar(text)','execute'));
insert into resultado values (91, 'anon PROVA quem e (com limite de tentativas)', 'true',
  has_function_privilege('anon','public.vessel_revelar_dono(text,text)','execute')::text,
  has_function_privilege('anon','public.vessel_revelar_dono(text,text)','execute'));
insert into resultado values (92,
  'anon NAO abre pedido direto — so a edge, que e quem confere no Bling', 'false',
  has_function_privilege('anon','public.vessel_abrir_pedido_de_registro(text,text,text,text,text,date)','execute')::text,
  not has_function_privilege('anon','public.vessel_abrir_pedido_de_registro(text,text,text,text,text,date)','execute'));
insert into resultado values (93, 'authenticated TAMBEM nao abre pedido direto', 'false',
  has_function_privilege('authenticated','public.vessel_abrir_pedido_de_registro(text,text,text,text,text,date)','execute')::text,
  not has_function_privilege('authenticated','public.vessel_abrir_pedido_de_registro(text,text,text,text,text,date)','execute'));
insert into resultado values (94, 'anon NAO ve a fila do painel', 'false',
  has_function_privilege('anon','public.vessel_fila_de_registros(text)','execute')::text,
  not has_function_privilege('anon','public.vessel_fila_de_registros(text)','execute'));
insert into resultado values (95, 'anon NAO troca dono', 'false',
  has_function_privilege('anon','public.vessel_trocar_dono(text,text,text,text,text,text)','execute')::text,
  not has_function_privilege('anon','public.vessel_trocar_dono(text,text,text,text,text,text)','execute'));
insert into resultado values (96, 'ninguem le a tabela de tentativas — nem logado', '0',
  (select count(*)::text from pg_policies where schemaname='public' and tablename='vessel_tentativas_de_revelar'),
  (select count(*) from pg_policies where schemaname='public' and tablename='vessel_tentativas_de_revelar') = 0);

select * from resultado order by ordem;

select 999 as ordem, 'VEREDITO — assercoes que passaram / total' as o_que_prova,
       count(*)::text as esperado,
       count(*) filter (where passou)::text as obtido,
       count(*) = count(*) filter (where passou) as passou
  from resultado;

rollback;
