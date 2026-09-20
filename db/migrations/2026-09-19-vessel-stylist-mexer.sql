-- MEXER NA PARCEIRA DO STYLIST CIRCLE: cadastrar, corrigir e desativar.
--
-- ⚠️ ATE AGORA ISTO SO EXISTIA A MAO, DENTRO DO BANCO. Cadastrar uma parceira
-- nova, arrumar o telefone que veio errado no formulario ou tirar da lista
-- quem saiu do Circle eram tres `insert`/`update` escritos na unha por quem
-- tem a senha do banco. Estas tres funcoes sao esses tres gestos, com a mesma
-- trava que o resto do Comercial Vessel ja usa.
--
-- ⚠️ DUAS COISAS NAO SE EDITAM, E ESTA ESCRITO AQUI POR QUE:
--   · `codigo` — e ele que vai dentro de TODO link de rastreio ja colado por
--     ai (`/s/STY-0001`). Mudar o codigo mata os links em circulacao E quebra
--     a atribuicao das aberturas antigas, que estao penduradas pelo codigo em
--     `vessel_stylist_aberturas` — as aberturas ficariam orfas, apontando para
--     um codigo que nao existe mais, e a conta de rastreio passaria a mostrar
--     zero para uma parceira que trouxe gente.
--   · `origem_canal` / `origem_campanha` / `origem_utm` — primeiro toque e
--     primeiro toque, e a propria tabela ja diz isso na linha 33 de
--     `2026-09-18-vessel-stylist-circle.sql`: "SO E PREENCHIDA NA CRIACAO".
--     Reescrever faz a atribuicao somar o mesmo canal duas vezes.
-- Por isso NENHUMA das quatro existe como parametro de `editar`: uma funcao
-- que NAO RECEBE o campo nao tem como grava-lo por engano num refactor. A
-- ausencia e a trava; um `if` dentro do corpo seria uma trava que alguem apaga
-- sem perceber.
--
-- ⚠️ E DESATIVAR NAO APAGA. Nao existe `delete` em lugar nenhum deste arquivo.
-- As aberturas de link e os atendimentos que a parceira trouxe continuam
-- contando no historico da marca; ela so sai da lista de escolher e do topo da
-- tela.

-- ── A COLUNA QUE FALTAVA ────────────────────────────────────────────────────
-- ⚠️ MEDIDO NO BANCO, NAO SUPOSTO: `vessel_stylists` nao tinha coluna nenhuma
-- de ativa/inativa ate aqui (as 17 colunas de hoje sao id, codigo, nome,
-- whatsapp, cidade, instagram, atuacao, quer_sessao, convidadas,
-- praca_preview, estagio, origem_canal, origem_campanha, origem_utm,
-- criado_em, atualizado_em, teste). `default true` e obrigatorio: sem ele,
-- `not null` num `alter table` de tabela com linhas quebraria — e, pior, toda
-- parceira ja cadastrada nasceria desativada e sumiria da tela de uma vez.
alter table public.vessel_stylists
  add column if not exists ativa boolean not null default true;

comment on column public.vessel_stylists.ativa is
  'Desativada sai da lista de escolher e do topo da tela. NAO apaga: as '
  'aberturas de link e os atendimentos que ela trouxe continuam contando no '
  'historico.';

-- ── CADASTRAR ───────────────────────────────────────────────────────────────
create or replace function public.vessel_stylist_criar(
  p_nome      text,
  p_whatsapp  text,
  p_cidade    text default null,
  p_instagram text default null,
  p_atuacao   text default null,
  p_praca     text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_fone   text;
  v_praca  text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_codigo text;
  v_n      int;
  v_volta  int;
  v_indice text;
begin
  -- ⚠️ A TRAVA DE MEXER, NAO A DE VER. `is_vessel_atendimentos()` responde
  -- verdadeiro para quem so tem permissao de OLHAR o Comercial Vessel; quem
  -- cadastra parceira precisa da trava de escrita, a mesma que editar, apagar
  -- e arquivar ja usam desde `2026-09-19-vessel-trava-de-editar.sql`.
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if nullif(trim(coalesce(p_nome, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;

  -- ⚠️ O TELEFONE ENTRA CANONICO, pela MESMA funcao que o formulario publico
  -- usa (`vessel_stylist_entrar`). Sem isto, "(19) 93333-3333" digitado na
  -- Central e "5519933333333" vindo da landing seriam DUAS parceiras, e o
  -- indice unico de `whatsapp` nao veria diferenca nenhuma entre elas.
  v_fone := public.vessel_telefone_canonico(p_whatsapp);
  if v_fone is null then
    return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
  end if;

  -- ⚠️ A PRACA E LISTA FECHADA E MAIUSCULA, igual em `vessel_stylist_entrar` e
  -- em `vessel_criar_private_edit`: ela e CHAVE de roteamento (o Private Edit
  -- monta o codigo do encontro com ela dentro, `PE-20260925-CPS-01`). Uma
  -- praca em minusculas ou inventada aqui so apareceria la na frente, na hora
  -- de marcar o encontro.
  -- ⚠️ `atuacao` e `estagio` NAO sao validados de proposito: sao texto
  -- descritivo, ninguem ramifica por eles (o espelho do Zoho ja cai no valor
  -- cru quando nao conhece o rotulo), e uma lista fechada inventada aqui
  -- barraria um estagio novo do pipeline no dia em que ele nascer.
  if v_praca is not null and v_praca not in ('CPS', 'SAO', 'SBO', 'BSB') then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;

  -- Ja cadastrada: devolve QUEM e, em vez de estourar o indice unico na cara
  -- de quem esta preenchendo o formulario.
  if exists (select 1 from public.vessel_stylists where whatsapp = v_fone) then
    return json_build_object('ok', false, 'situacao', 'whatsapp_repetido',
      'codigo', (select s.codigo from public.vessel_stylists s where s.whatsapp = v_fone));
  end if;

  -- ⚠️ O CODIGO E GERADO AQUI DENTRO, NUNCA RECEBIDO, no formato `STY-0000`
  -- que `FORMATO_STYLIST` (/^STY-\d{4}$/, em
  -- `src/ferramentas/comercial-vessel/enderecos-publicos.js`) exige para
  -- montar o link de rastreio. Um codigo fora desse formato faria
  -- `linkDaStylist()` devolver string vazia — a parceira existiria e nao teria
  -- link nenhum, sem erro para denunciar.
  --
  -- ⚠️ E E SEQUENCIAL, NAO SORTEADO. O formulario publico
  -- (`vessel_stylist_entrar`) numera com `count(*) + 1`; um codigo sorteado
  -- daqui ocuparia um numero la na frente e, no dia em que a contagem publica
  -- chegasse nele, o `insert` da landing morreria no indice unico de `codigo`
  -- — na cara de uma parceira de verdade, do lado de fora. Sorteio e o jeito
  -- da `chave` do Private Edit porque aquela precisa ser IMPREVISIVEL; este
  -- codigo nao precisa, precisa e conviver com quem ja numera.
  --
  -- ⚠️⚠️ A TRAVA DE FILA, E ELA E O CORACAO DESTE PEDACO. Ler o maior numero e
  -- so depois gravar sao DUAS operacoes, e entre uma e outra cabe outra
  -- chamada. Duas transacoes abertas ao mesmo tempo NAO enxergam a linha uma da
  -- outra: as duas leem o mesmo maior numero, as duas escolhem `STY-0001`, e a
  -- segunda a commitar levanta `23505 duplicate key ... vessel_stylists_codigo_idx`
  -- — erro CRU do Postgres, que aborta a transacao de quem chamou, em vez do
  -- `{ok:false, situacao:...}` que todo o resto destas funcoes devolve. Medido
  -- com duas conexoes de verdade, nao deduzido.
  --
  -- `pg_advisory_xact_lock` poe as duas chamadas EM FILA: a segunda espera a
  -- primeira terminar (commit ou rollback) e so entao le o maior numero, ja
  -- enxergando a linha da primeira. E `_xact_`, entao solta sozinha no fim da
  -- transacao — nao ha como esquecer de soltar, nem trava presa se o processo
  -- de quem chamou morrer no meio.
  --
  -- ⚠️ A CHAVE DA TRAVA E SO UM NUMERO COMBINADO. Nao precisa significar nada
  -- no banco; precisa ser O MESMO para todo mundo que entra nesta fila. Por
  -- isso sai de `hashtext` de um texto fixo: qualquer um que leia esta linha
  -- escreve a mesma chave sem ter de procurar uma constante em outro arquivo.
  --
  -- ⚠️ E A TRAVA VEM DEPOIS DAS RECUSAS, de proposito: quem vai levar
  -- `sem_nome`, `whatsapp_invalido` ou `praca_invalida` nao tem por que fazer
  -- ninguem esperar na fila.
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylists.codigo')::bigint);

  -- ⚠️ O LACO E O DE `vessel_criar_private_edit`: repete ate nao colidir. So
  -- que com TETO e com volta ao comeco — e sao 10.000 codigos possiveis, de
  -- `STY-0000` a `STY-9999`, porque a volta cai em 0 e nao em 1. Sem o teto um
  -- banco cheio giraria para sempre segurando a transacao.
  -- ⚠️ O PRIMEIRO CODIGO DE UM BANCO VAZIO E `STY-0001`, NAO `STY-0000`: a
  -- numeracao comeca no maior que existe MAIS UM, e num banco vazio o maior e
  -- zero. `STY-0000` so e usado se um dia a numeracao der a volta e ele estiver
  -- livre. E de proposito — e o mesmo primeiro numero que o formulario publico
  -- daria com o seu `count(*) + 1`.
  --
  -- ⚠️ E O `for` DE FORA E O CINTO DA TRAVA. Com a fila, duas chamadas nao
  -- escolhem mais o mesmo numero — mas uma funcao que nunca deixa escapar erro
  -- cru nao pode depender de UMA linha estar no lugar certo. Se a trava sumir
  -- num refactor, o `exception` aqui embaixo transforma a colisao em nova
  -- tentativa; e se nem assim assentar, sai `codigo_em_disputa`, que e contrato
  -- e nao excecao.
  for v_volta in 1..3 loop
    select coalesce(max((substring(s.codigo from '^STY-([0-9]{4})$'))::int), 0)
      into v_n
      from public.vessel_stylists s
     where s.codigo ~ '^STY-[0-9]{4}$';

    v_codigo := null;
    for i in 1..10000 loop
      v_n := v_n + 1;
      if v_n > 9999 then
        v_n := 0;                     -- da a volta e alcanca o `STY-0000`
      end if;
      v_codigo := 'STY-' || lpad(v_n::text, 4, '0');
      exit when not exists (select 1 from public.vessel_stylists s where s.codigo = v_codigo);
      v_codigo := null;
    end loop;

    if v_codigo is null then
      return json_build_object('ok', false, 'situacao', 'sem_codigo_livre');
    end if;

    begin
      -- ⚠️ `origem_canal`, `origem_campanha` e `origem_utm` ficam NULOS aqui de
      -- proposito: esta parceira nao chegou por campanha nenhuma, chegou pela
      -- mao de alguem da casa. Inventar 'central' como canal faria a atribuicao
      -- contar como aquisicao uma pessoa que ninguem adquiriu.
      insert into public.vessel_stylists
        (codigo, nome, whatsapp, cidade, instagram, atuacao, praca_preview)
      values
        (v_codigo, trim(p_nome), v_fone,
         nullif(trim(coalesce(p_cidade, '')), ''),
         nullif(trim(coalesce(p_instagram, '')), ''),
         nullif(trim(coalesce(p_atuacao, '')), ''),
         v_praca);

      return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);

    exception when unique_violation then
      -- ⚠️ SAO DOIS INDICES UNICOS NESTA TABELA, e tratar os dois como a mesma
      -- coisa mentiria para quem chamou: uma chamada que bateu no telefone
      -- repetido receberia "tente de novo" tres vezes e depois um erro sobre
      -- CODIGO, que nao tem nada a ver com o que aconteceu. Por isso o nome do
      -- indice e lido do proprio erro.
      get stacked diagnostics v_indice = constraint_name;

      if v_indice = 'vessel_stylists_whatsapp_idx' then
        -- A conferencia la em cima nao pega este caso: a outra chamada ainda
        -- estava aberta quando ela rodou. A resposta e a MESMA daquela — quem
        -- chamou nao precisa saber se perdeu por milissegundos.
        return json_build_object('ok', false, 'situacao', 'whatsapp_repetido');
      end if;

      if v_indice is distinct from 'vessel_stylists_codigo_idx' then
        -- Indice que esta funcao nao conhece (um que nasca num `alter table`
        -- futuro). Continua saindo CONTRATO, com o nome do indice dentro para
        -- quem for investigar — nunca uma excecao crua na cara de quem chamou.
        return json_build_object('ok', false, 'situacao', 'conflito_no_cadastro',
                                 'onde', v_indice);
      end if;
      -- Codigo levado por outra chamada: volta ao topo e escolhe outro.
    end;
  end loop;

  -- Tres voltas e ainda disputando: e contrato, nao excecao. Quem chamou tenta
  -- de novo, e a tela sabe o que dizer.
  return json_build_object('ok', false, 'situacao', 'codigo_em_disputa');
end;
$function$;

-- ── CORRIGIR ────────────────────────────────────────────────────────────────
-- ⚠️ `p_praca` EXISTE E ESCREVE EM `praca_preview`. A praca esta na lista do
-- que se corrige (a parceira muda de cidade, ou digitou errado na landing) e
-- e o unico campo editavel cujo nome de parametro nao bate com o nome da
-- coluna — por isso este aviso: `set praca_preview = ... p_praca`, e nao
-- `praca = ...`, que nem coluna e.
create or replace function public.vessel_stylist_editar(
  p_codigo    text,
  p_nome      text default null,
  p_whatsapp  text default null,
  p_cidade    text default null,
  p_instagram text default null,
  p_atuacao   text default null,
  p_estagio   text default null,
  p_praca     text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- ⚠️ O CODIGO NORMALIZA UMA VEZ SO, AQUI EM CIMA, e e ESTE valor que vai
  -- para o `exists`, para o `update` e para a resposta. Deixar UM dos tres
  -- lendo `p_codigo` cru e o buraco que, na irma do Private Edit, deixou um
  -- codigo em minusculas passar pela conferencia e apagar um encontro que
  -- tinha gente dentro. A expressao e a mesma das irmas, letra por letra.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_fone   text;
  v_praca  text := upper(nullif(trim(coalesce(p_praca, '')), ''));
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_stylists s where s.codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- Telefone so e trocado se vier um telefone que da para usar.
  if nullif(trim(coalesce(p_whatsapp, '')), '') is not null then
    v_fone := public.vessel_telefone_canonico(p_whatsapp);
    if v_fone is null then
      return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
    end if;
    -- O indice unico de `whatsapp` e o que impede a mesma parceira virar duas;
    -- aqui ele vira uma resposta, nao um erro de banco na cara da pessoa.
    if exists (select 1 from public.vessel_stylists s
                where s.whatsapp = v_fone and s.codigo <> v_codigo) then
      return json_build_object('ok', false, 'situacao', 'whatsapp_repetido');
    end if;
  end if;

  if v_praca is not null and v_praca not in ('CPS', 'SAO', 'SBO', 'BSB') then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;

  -- ⚠️ CAMPO NULO = "NAO MEXE NESTE", nunca "apaga o que estava la". A tela
  -- manda o formulario inteiro, e o que a pessoa nao preencheu chega nulo.
  -- ⚠️ E REPARE NO QUE NAO ESTA AQUI: `codigo`, `origem_canal`,
  -- `origem_campanha` e `origem_utm`. Nao estao porque nem chegam — ver o
  -- aviso no topo do arquivo.
  update public.vessel_stylists s
     set nome          = coalesce(nullif(trim(coalesce(p_nome, '')), ''), s.nome),
         whatsapp      = coalesce(v_fone, s.whatsapp),
         cidade        = coalesce(nullif(trim(coalesce(p_cidade, '')), ''), s.cidade),
         instagram     = coalesce(nullif(trim(coalesce(p_instagram, '')), ''), s.instagram),
         atuacao       = coalesce(nullif(trim(coalesce(p_atuacao, '')), ''), s.atuacao),
         estagio       = coalesce(nullif(trim(coalesce(p_estagio, '')), ''), s.estagio),
         praca_preview = coalesce(v_praca, s.praca_preview),
         -- ⚠️ A MAO E QUEM ATUALIZA `atualizado_em`: esta tabela NAO TEM
         -- trigger nenhum (conferido em `pg_trigger`), e o `default now()` so
         -- vale no `insert`. Sem esta linha, a coluna mentiria para sempre.
         atualizado_em = now()
   where s.codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- ── DESATIVAR (E REATIVAR) ──────────────────────────────────────────────────
create or replace function public.vessel_stylist_desativar(
  p_codigo text,
  p_ativa  boolean default false
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  -- ⚠️ `coalesce(p_ativa, false)`: quando a tela manda so o codigo — ou quando
  -- o PostgREST deixa o segundo parametro de fora e ele chega nulo —
  -- "desativar" tem de significar DESATIVAR. A coluna e `not null`, entao sem
  -- o `coalesce` a chamada morreria com erro de banco na cara da pessoa.
  v_ativa  boolean := coalesce(p_ativa, false);
begin
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_stylists s where s.codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ DESATIVAR NAO APAGA. Nada de `delete` aqui, nem hoje nem num refactor:
  -- as aberturas de link e os atendimentos que ela trouxe continuam contando
  -- no historico da marca. E por isso tem VOLTA: `p_ativa => true` reativa, e
  -- sem isso o botao de reativar seria codigo morto.
  update public.vessel_stylists s
     set ativa         = v_ativa,
         atualizado_em = now()
   where s.codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok',
                           'codigo', v_codigo, 'ativa', v_ativa);
end;
$function$;

-- ⚠️ A PORTA DE CADA UMA, AOS PARES. `create or replace` sobre funcao NOVA a
-- deixa aberta para `public` — ou seja, tambem para `anon`, que e quem abre as
-- paginas publicas do Vessel. `revoke ... from public` sozinho NAO fecha
-- `authenticated`, que e um grant proprio. Sao as duas linhas, com a lista de
-- tipos exata, ou a funcao vai ao ar aberta.
revoke all on function public.vessel_stylist_criar(text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.vessel_stylist_criar(text, text, text, text, text, text)
  to authenticated;

revoke all on function public.vessel_stylist_editar(text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.vessel_stylist_editar(text, text, text, text, text, text, text, text)
  to authenticated;

revoke all on function public.vessel_stylist_desativar(text, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_stylist_desativar(text, boolean)
  to authenticated;

-- ── AS DUAS QUE LEEM: A DESATIVADA SAI DAS DUAS LISTAS ──────────────────────
-- ⚠️ OS DOIS CORPOS ABAIXO SAO COPIA VERBATIM do que esta HOJE no banco (lido
-- com `pg_get_functiondef`), com UMA UNICA linha acrescentada em cada:
--   `     and coalesce(s.ativa, true)`
-- Nada mais mudou — nem as contas de abertura, nem a janela de venda, nem a
-- ordenacao. Reescrever de memoria e como se perde a conta de `receita` que
-- soma um pedido uma vez so. O aplicador
-- (`coletor/aplicar-vessel-stylist-mexer.mjs`) compara o `pg_get_functiondef`
-- de antes com o de depois e exige que a UNICA diferenca seja essa linha.
--
-- ⚠️ O `coalesce(s.ativa, true)` E NAO `s.ativa`: a coluna e `not null`
-- hoje, mas o `coalesce` e o mesmo cinto que o `teste` da linha de cima ja
-- usa — no dia em que a coluna aceitar nulo, NULO NAO E FALSO e um `where
-- s.ativa` sumiria com a parceira sem uma palavra.
--
-- ⚠️ E O PORTAO DELAS CONTINUA SENDO `is_vessel_atendimentos()` (o de VER).
-- Ler a lista e ler; trocar pelo de mexer esconderia a lista de quem so
-- acompanha.
CREATE OR REPLACE FUNCTION public.vessel_rastreio_dos_stylists(p_dias integer DEFAULT 7)
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
        and coalesce(s.ativa, true)
    ) as linhas;

  return v_saida;
end;
$function$;

-- ⚠️ ESTA DEVOLVE EXATAMENTE TRES CHAVES — `cidade`, `codigo`, `nome` — E NAO
-- PODE GANHAR UMA QUARTA. Ha prova COMMITADA que quebra se a resposta crescer:
-- `coletor/aplicar-vessel-private-edit-pela-tela.mjs` compara
-- `Object.keys(lista[0]).sort().join(',')` com a string 'cidade,codigo,nome'.
-- `ativa` entra no `where` e SO no `where`: a tela usa esta lista para
-- preencher um campo de escolha, e um campo de escolha nao precisa saber que a
-- desativada existe — ela simplesmente nao esta la.
CREATE OR REPLACE FUNCTION public.vessel_stylists_para_escolher()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_saida json;
begin
  if not public.is_vessel_atendimentos() then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  select coalesce(json_agg(json_build_object('codigo', s.codigo, 'nome', s.nome,
                                             'cidade', s.cidade)
                           order by s.codigo), '[]'::json)
    into v_saida
    from public.vessel_stylists s
   where not coalesce(s.teste, false)
     and coalesce(s.ativa, true);
  return v_saida;
end;
$function$;

-- ⚠️ E OS GRANTS DAS DUAS RECRIADAS, DE NOVO. `create or replace` NAO devolve
-- o grant de quem foi revogado antes — ele reaproveita as permissoes atuais
-- quando a funcao ja existe, mas basta uma recriacao por outro caminho para a
-- porta voltar ao padrao. Repetir o par com a lista de tipos EXATA e barato e
-- deixa o arquivo honesto: quem le esta migration sabe quem pode chamar o que.
-- Hoje as duas sao `authenticated` e nunca `anon` — e e assim que ficam.
revoke all on function public.vessel_rastreio_dos_stylists(integer)
  from public, anon, authenticated;
grant execute on function public.vessel_rastreio_dos_stylists(integer)
  to authenticated;

revoke all on function public.vessel_stylists_para_escolher()
  from public, anon, authenticated;
grant execute on function public.vessel_stylists_para_escolher()
  to authenticated;
