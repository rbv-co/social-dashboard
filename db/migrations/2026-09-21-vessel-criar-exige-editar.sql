-- CRIAR PASSA A EXIGIR A TRAVA DE EDITAR, NAO A DE VER.
--
-- ⚠️ O BURACO, e o item B10 de docs/pendencias.md. Nesta entrega (o R13), a
-- permissao de "editar" passou a proteger toda acao que muda dado nas tres
-- telas do Comercial Vessel: Encerrar, Reabrir, Editar, Arquivar e Apagar.
-- Duas funcoes de CRIAR ficaram de fora dessa regua e continuavam na
-- permissao mais fraca, a de "ver":
--   · `vessel_criar_private_edit`     — o botao "Criar encontro" da tela
--     Private Edit;
--   · `vessel_beauty_session_criar`   — o botao "Criar sessao" da tela
--     Beauty Sessions.
--
-- ⚠️ POR QUE CRIAR PRECISA DA TRAVA DE MUDAR. O mesmo argumento que
-- justificou apertar "Encerrar" em `2026-09-19-vessel-encerrar-exige-editar.sql`
-- — encerrar muda o encontro, entao precisa de permissao para editar — vale
-- palavra por palavra para CRIAR: marcar um encontro novo ou abrir uma sessao
-- nova e tanto mudanca de dado quanto fechar um ja existente. Sem esta
-- migration, quem tivesse so "ver" nao conseguiria editar, arquivar, encerrar
-- ou apagar um encontro — mas ainda conseguiria criar um novo. Um degrau fora
-- de ordem: a porta mais facil de todas ficava sendo justamente a de criar.
-- A irma das duas, `vessel_stylist_criar` (Stylist Circle), ja usa a
-- permissao certa — e a unica das tres que nasceu depois de essa regua
-- existir.
--
-- ⚠️ MEDIDO ANTES DE APERTAR, NAO SUPOSTO: dos 24 perfis do sistema, ZERO tem
-- `atendimentos` em `features` e ZERO tem `editar` em
-- `permissions.atendimentos`. Quem passa hoje pelos dois portoes sao so os 3
-- superadmins — e superadmin passa nos DOIS, porque
-- `is_vessel_atendimentos_editar()` comeca chamando `is_vessel_atendimentos()`
-- e depois aceita `p.is_superadmin`. Ou seja: este aperto NAO TIRA ACESSO DE
-- NINGUEM hoje. Se algum dia alguem receber so a permissao de ver, esta e a
-- linha que impede essa pessoa de criar um encontro ou uma sessao novos.
--
-- ⚠️ SO A LINHA DO PORTAO MUDA. O corpo das duas funcoes e byte a byte o que
-- ja estava no banco (conferido com `pg_get_functiondef`, nao com o arquivo de
-- migration que as criou — a ordem de aplicacao NAO e a ordem alfabetica dos
-- nomes de arquivo) — a mesma normalizacao, a mesma geracao de codigo, as
-- mesmas validacoes, o mesmo JSON de volta, as mesmas mensagens em portugues.
-- Aproveitar este `create or replace` para "melhorar" qualquer outra coisa
-- faria uma mudanca de seguranca carregar mudanca de comportamento junto, e a
-- prova desta migration nao teria como separar as duas.

-- ── 1. o encontro do Private Edit ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vessel_criar_private_edit(p_stylist text, p_quando timestamp with time zone, p_local text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_vagas integer DEFAULT 8, p_teste boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_alfabeto text := 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  v_tam      int  := length(v_alfabeto);          -- 30
  -- O maior múltiplo de 30 que cabe em 256: 240. Byte de 240 para cima é
  -- descartado, e é isso que tira o viés.
  v_teto     int  := 256 - (256 % v_tam);
  v_stylist  bigint;
  v_praca    text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_codigo   text;
  v_chave    text;
  v_seq      int;
  v_byte     int;
begin
  -- ⚠️ A TRANCA MORA AQUI DENTRO, não no grant. Ver o cabeçalho.
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'situacao', 'sem_permissao',
      'erro', 'Você não tem a permissão de Atendimentos para criar um encontro.');
  end if;

  select id into v_stylist from public.vessel_stylists
   where codigo = upper(nullif(trim(coalesce(p_stylist, '')), ''));
  if v_stylist is null then
    return json_build_object('ok', false, 'situacao', 'stylist_nao_encontrada',
      'erro', 'Não achei esta stylist. O código é o STY-0000 dela.');
  end if;
  if p_quando is null then
    return json_build_object('ok', false, 'situacao', 'sem_data',
      'erro', 'Escolha o dia e a hora do encontro.');
  end if;
  -- ⚠️ ENCONTRO NO PASSADO NÃO SE CRIA. O convite tem data e avisa quando
  -- passou: nascer já vencido produz um link que só serve para confundir quem
  -- recebe. (A regra é do CRIAR; encontro que já aconteceu continua na lista.)
  if p_quando < now() - interval '1 day' then
    return json_build_object('ok', false, 'situacao', 'data_no_passado',
      'erro', 'Esta data já passou. O convite nasceria vencido.');
  end if;
  if v_praca is null or v_praca not in ('CPS', 'SAO', 'SBO', 'BSB') then
    return json_build_object('ok', false, 'situacao', 'praca_invalida',
      'erro', 'A praça precisa ser CPS, SAO, SBO ou BSB.');
  end if;
  if p_loja is not null and p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida',
      'erro', 'Escolha uma loja válida.');
  end if;
  -- ⚠️ VAGAS É O DENOMINADOR DA TAXA DE COMPARECIMENTO na tela. Zero ou
  -- negativo viraria divisão por zero lá na frente; número absurdo estraga a
  -- leitura. O plano fala em 5 a 8 convidadas, e o teto aqui é folgado.
  if p_vagas is null or p_vagas < 1 or p_vagas > 60 then
    return json_build_object('ok', false, 'situacao', 'vagas_invalidas',
      'erro', 'O número de vagas precisa estar entre 1 e 60.');
  end if;

  -- A sequência é POR DIA E POR PRAÇA, como manda o formato do módulo 10.
  select count(*) + 1 into v_seq from public.vessel_private_edits
   where praca = v_praca
     and (quando at time zone 'America/Sao_Paulo')::date
         = (p_quando at time zone 'America/Sao_Paulo')::date;
  v_codigo := 'PE-'
    || to_char(p_quando at time zone 'America/Sao_Paulo', 'YYYYMMDD')
    || '-' || v_praca || '-' || lpad(v_seq::text, 2, '0');

  loop
    v_chave := '';
    while length(v_chave) < 8 loop
      v_byte := get_byte(extensions.gen_random_bytes(1), 0);
      continue when v_byte >= v_teto;      -- descarta e sorteia outro
      v_chave := v_chave || substr(v_alfabeto, 1 + (v_byte % v_tam), 1);
    end loop;
    exit when not exists (select 1 from public.vessel_private_edits where chave = v_chave);
  end loop;

  insert into public.vessel_private_edits
    (codigo, chave, stylist_id, quando, local, praca, loja, vagas, teste)
  values (v_codigo, v_chave, v_stylist, p_quando,
          nullif(trim(coalesce(p_local, '')), ''), v_praca, p_loja, p_vagas, p_teste);

  return json_build_object('ok', true, 'codigo', v_codigo, 'chave', v_chave);
end;
$function$;

-- ⚠️ AS DUAS LINHAS DE NOVO, IGUAIS AS QUE JA ESTAVAM. `create or replace` nao
-- mexe na porta de uma funcao que ja existe, entao em tese estas linhas nao
-- fariam falta — mas elas ficam porque o dia em que esta funcao for recriada
-- do zero (um banco novo, um restore) ela nasce ABERTA para `public`, e
-- `revoke ... from public` NAO fecha `authenticated`. A porta aqui e a MESMA
-- de hoje, conferida antes de escrever esta linha: `authenticated` executa,
-- `anon` e `public` nao. Este arquivo aperta o PORTAO DE DENTRO da funcao, nao
-- a porta de fora.
revoke all on function public.vessel_criar_private_edit(
  text, timestamptz, text, text, text, integer, boolean
) from public, anon, authenticated;
grant execute on function public.vessel_criar_private_edit(
  text, timestamptz, text, text, text, integer, boolean
) to authenticated;

-- ── 2. a sessao da Beauty Session ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.vessel_beauty_session_criar(p_codigo text, p_quando date, p_praca text, p_loja text, p_parceiro text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_praca  text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_data   text;
begin
  -- A permissão mora AQUI DENTRO, não no grant: `security definer` roda como
  -- dono, e `authenticated` é todo mundo que fez login na Central.
  if not public.is_vessel_atendimentos_editar() then
    return json_build_object('ok', false, 'erro',
      'Você não tem a permissão de Atendimentos para criar uma sessão.');
  end if;

  if v_codigo is null or v_codigo !~ '^BS-\d{8}-[A-Z]{3}-[A-Z0-9]{1,4}$' then
    return json_build_object('ok', false, 'erro',
      'O código precisa ter o formato BS-AAAAMMDD-PRACA-NUMERO, como BS-20260925-CPS-01.');
  end if;
  if p_quando is null then
    return json_build_object('ok', false, 'erro', 'Escolha a data da sessão.');
  end if;

  -- a data escrita DENTRO do código, contra a data da sessão
  v_data := substring(v_codigo from 4 for 8);
  if v_data <> to_char(p_quando, 'YYYYMMDD') then
    return json_build_object('ok', false, 'erro',
      'A data do código (' || v_data || ') não é a data da sessão ('
      || to_char(p_quando, 'YYYYMMDD') || '). Uma das duas está errada.');
  end if;

  if v_praca is null or v_praca !~ '^[A-Z]{3}$' then
    return json_build_object('ok', false, 'erro', 'A praça tem três letras, como CPS.');
  end if;
  if substring(v_codigo from 13 for 3) <> v_praca then
    return json_build_object('ok', false, 'erro',
      'A praça do código não é a praça escolhida.');
  end if;
  if p_loja is null or p_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'erro', 'Escolha a loja.');
  end if;

  if exists (select 1 from public.vessel_beauty_sessions where codigo = v_codigo) then
    return json_build_object('ok', false, 'erro',
      'Já existe uma sessão com este código. Código não se reaproveita: a leitura '
      || 'de dois eventos diferentes cairia na mesma linha do painel.');
  end if;

  insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro, ativa)
  values (v_codigo, p_quando, v_praca,
          p_loja, nullif(trim(coalesce(p_parceiro, '')), ''), true);

  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$function$;

revoke all on function public.vessel_beauty_session_criar(
  text, date, text, text, text
) from public, anon, authenticated;
grant execute on function public.vessel_beauty_session_criar(
  text, date, text, text, text
) to authenticated;
