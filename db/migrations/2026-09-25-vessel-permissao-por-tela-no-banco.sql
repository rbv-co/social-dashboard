-- B13 · NO BANCO, CADA FUNÇÃO DO COMERCIAL VESSEL CONFERE A CHAVE DA SUA TELA (25/09/2026).
--
-- O dono (24/09/2026): "fechar essa porta dos fundos no banco (cada função
-- conferindo a permissão da SUA tela)".
--
-- ── O DEFEITO ───────────────────────────────────────────────────────────────
-- Desde 24/09 cada ferramenta do Comercial Vessel tem chave própria em
-- `profiles.permissions` (fonte: src/compartilhado/catalogo-de-ferramentas.js):
--   atendimentos                   Private Appointment   [ver, editar]
--   atendimentos.beauty-sessions   Beauty Sessions       [ver, editar]
--   atendimentos.private-edit      Private Edit          [ver, editar]
--   atendimentos.stylist-circle    Stylist Circle        [ver, editar]
--   atendimentos.material-grafico  Material Gráfico      [ver]
--   atendimentos.appointment-card  Appointment Card      [ver]  (é um link para
--                                  o site; não chama NENHUMA função daqui)
-- A Central abre cada tela pela chave dela. Mas as 49 funções security definer
-- abaixo conferiam a FAMÍLIA (`is_vessel_atendimentos()` / `_editar()`, que
-- aceitam qualquer uma das chaves) — e o `derivar-features.js` põe o pai
-- 'atendimentos' em `features` de quem tem QUALQUER tela. Resultado: quem tinha
-- só o Material Gráfico (só leitura) chamava por fora da Central a lista de
-- contatos das parceiras; quem tinha só Beauty Sessions com "mexer" criava
-- Private Edit e movia parceira no funil. Pela tela, não; pelo PostgREST, sim.
--
-- ── O CONSERTO ──────────────────────────────────────────────────────────────
-- 1. `vessel_pode(ferramenta, nivel)`: a trava POR TELA. Lê `permissions` (o
--    MESMO campo que a Central lê em `permissaoDoPerfil`) e NÃO `features` —
--    em `features` o pai 'atendimentos' aparece para todo mundo que tem uma
--    tela, e a chave do Private Appointment ficaria aberta de novo.
--    Super-admin (a coluna, como a trava da família) passa sempre; conta
--    desativada nunca (`conta_ativa()`, como as outras travas desde a 054).
--    'editar' exige 'ver' E 'editar' na MESMA chave (nunca mais frouxa que ver).
--    Chave ou nível fora da lista fechada = ERRO, não "false" calado: um erro
--    de digitação numa migration futura aparece na prova, não vira porta
--    fechada para todo mundo sem ninguém saber por quê.
-- 2. Cada uma das 49 funções troca UMA expressão — a trava da família pela da
--    sua tela, no MESMO nível de hoje (ver continua ver, editar continua
--    editar). O resto do corpo é o `pg_get_functiondef` de 25/09/2026, letra
--    por letra; o aplicador confere o sha256 de cada uma antes de aplicar e
--    PARA se alguma mudou depois (coletor/aplicar-vessel-permissao-por-tela-
--    no-banco.mjs).
-- 3. As políticas de LEITURA das tabelas de uma tela só passam a pedir a chave
--    dessa tela (seção no fim).
--
-- ── AS COMPARTILHADAS (a regra de cada uma é "qualquer das telas que a CHAMAM
--    de verdade", medido no código da Central em 25/09/2026) ─────────────────
--   vessel_conta_das_beauty_sessions   Beauty Sessions OU Material Gráfico (ver)
--   vessel_conta_das_private_edits     Private Edit    OU Material Gráfico (ver)
--   vessel_rastreio_dos_stylists       Stylist Circle  OU Material Gráfico (ver)
--   vessel_stylist_etapas              Stylist Circle  OU Private Edit     (ver)
--   vessel_situacao_do_atendimento     Private Appointment OU Private Edit (ver)
--   O Material Gráfico é só leitura e mostra os QR das três ações: entra SÓ nas
--   três listas. Não cria sessão, não vê o histórico de contato das parceiras,
--   não vê convidadas.
--
-- ── O QUE FICA DA FAMÍLIA, DE PROPÓSITO ─────────────────────────────────────
--   · `vessel_convite_da_convidada` (página PÚBLICA do convite, anon): usa a
--     família só para "abertura da equipe não conta". Qualquer pessoa do
--     Comercial Vessel abrindo o convite não deve contar como a convidada — e
--     a resposta é a mesma para todos. Não é portão; NÃO é tocada aqui.
--   · As políticas de leitura de vessel_pessoas, vessel_atendimentos,
--     vessel_pedidos e vessel_pedido_itens: são a base comum de clientes,
--     visitas e vendas do Comercial Vessel inteiro. ⚠️ Medido em 25/09/2026:
--     hoje só a tela do Private Appointment as lê direto (tela-de-
--     atendimentos.vue); as outras telas leem por funções. Fechar essas quatro
--     no Private Appointment é uma linha cada — decisão do dono (B13, em
--     docs/pendencias.md).
--   · As duas travas da família continuam existindo, sem mudança: servem a
--     essas quatro políticas e ao convite público.
--
-- ⚠️ As mensagens de recusa ("Você não tem a permissão de Atendimentos …")
-- ficaram iguais de propósito: a Central que está no ar mostra esse texto.

-- ── 1. A trava por tela ─────────────────────────────────────────────────────
create or replace function public.vessel_pode(p_ferramenta text, p_nivel text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- A LISTA FECHADA: as chaves do Comercial Vessel no catálogo que têm tela
  -- chamando o banco, e os dois níveis que o catálogo oferece a elas.
  if p_ferramenta is null or p_ferramenta not in (
       'atendimentos', 'atendimentos.beauty-sessions', 'atendimentos.private-edit',
       'atendimentos.stylist-circle', 'atendimentos.material-grafico') then
    raise exception 'vessel_pode: ferramenta desconhecida (%)', p_ferramenta using errcode = '22023';
  end if;
  if p_nivel is null or p_nivel not in ('ver', 'editar') then
    raise exception 'vessel_pode: nivel desconhecido (%)', p_nivel using errcode = '22023';
  end if;
  if p_ferramenta = 'atendimentos.material-grafico' and p_nivel <> 'ver' then
    raise exception 'vessel_pode: o Material Grafico so tem ver' using errcode = '22023';
  end if;
  -- ⚠️ A ARMADILHA DO NULO: o `coalesce` envolve a subconsulta INTEIRA.
  return public.conta_ativa() and coalesce(
    (select coalesce(p.is_superadmin, false)
         or (jsonb_typeof(p.permissions) = 'object'
             and jsonb_typeof(p.permissions -> p_ferramenta) = 'array'
             and (p.permissions -> p_ferramenta) ? 'ver'
             and (p_nivel = 'ver' or (p.permissions -> p_ferramenta) ? p_nivel))
       from public.profiles p where p.id = auth.uid()),
    false);
end;
$$;

comment on function public.vessel_pode(text, text) is
  'B13: quem pode VER/EDITAR uma tela do Comercial Vessel — permissions[ferramenta] (o mesmo campo que a Central le), super-admin sempre, conta desativada nunca. Toda funcao nova de UMA tela confere a chave dela por aqui (PADRAO-DA-CENTRAL.md).';

-- ⚠️ AS DUAS LINHAS SAO OBRIGATORIAS: `revoke ... from public` NAO fecha
-- `authenticated`. A Central precisa executar (as politicas chamam como o
-- proprio usuario); a pagina publica (anon), nao.
revoke all on function public.vessel_pode(text, text) from public, anon, authenticated;
grant execute on function public.vessel_pode(text, text) to authenticated;

comment on function public.is_vessel_atendimentos() is
  'FAMILIA do Comercial Vessel (qualquer tela). Desde o B13 (25/09/2026) so serve a base comum (politicas de vessel_pessoas/atendimentos/pedidos/pedido_itens) e ao convite publico. Funcao de UMA tela usa vessel_pode(ferramenta, nivel).';
comment on function public.is_vessel_atendimentos_editar() is
  'FAMILIA do Comercial Vessel, nivel editar. Desde o B13 (25/09/2026) nenhuma funcao a usa; fica para nao quebrar quem a chamar. Funcao de UMA tela usa vessel_pode(ferramenta, ''editar'').';

-- ── 2. As 49 funções: a trava da família vira a da tela ─────────────────────

-- ═══ BEAUTY SESSIONS ═══════════════════════════════════════════════════════

-- vessel_beauty_session_apagar — Beauty Sessions · editar
CREATE OR REPLACE FUNCTION public.vessel_beauty_session_apagar(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_beauty_session_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.beauty-sessions', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_beauty_sessions where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ APAGAR UMA SESSAO JA LIDA deixaria as leituras do QR SEM SESSAO (ver a
  -- migration de 19/09 para o resto deste comentario, que continua valendo).
  if exists (select 1 from public.vessel_sessao_aberturas where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'tem_gente');
  end if;

  -- ⚠️ 24/09/2026: E SESSAO COM LEAD TAMBEM NAO SE APAGA. Com o cadastro pela
  -- equipe, uma sessao pode ter gente identificada sem NENHUMA leitura do QR.
  -- Apagar deixaria a origem dessas pessoas (`vessel_origens.evento_id`)
  -- apontando para uma sessao que nao existe, e a receita delas sem dono.
  -- Qualquer origem conta, inclusive a de teste: a recusa protege o dado, e o
  -- dado de teste tambem aponta para ca.
  if exists (select 1 from public.vessel_origens where evento_id = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'tem_leads');
  end if;

  delete from public.vessel_beauty_sessions where codigo = v_codigo;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- vessel_beauty_session_arquivar — Beauty Sessions · editar
CREATE OR REPLACE FUNCTION public.vessel_beauty_session_arquivar(p_codigo text, p_arquivada boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_beauty_session_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.beauty-sessions', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_beauty_sessions where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ ARQUIVAR NAO E ENCERRAR, e `ativa` nao e tocada aqui. Encerrada continua
  -- contando (e historico); arquivada sai das contas e da lista.
  --
  -- ⚠️ `coalesce(p_arquivada, true)`: quando a tela manda so o codigo — ou
  -- quando o PostgREST deixa o segundo parametro de fora e ele chega nulo —
  -- "arquivar" tem de significar ARQUIVAR. Sem o `coalesce`, a coluna e
  -- `not null` e a chamada morreria com erro de banco na cara da pessoa.
  update public.vessel_beauty_sessions
     set arquivada = coalesce(p_arquivada, true)
   where codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok',
                           'codigo', v_codigo, 'arquivada', coalesce(p_arquivada, true));
end;
$function$;

-- vessel_beauty_session_cadastrar_lead — Beauty Sessions · editar
CREATE OR REPLACE FUNCTION public.vessel_beauty_session_cadastrar_lead(p_codigo text, p_nome text, p_whatsapp text, p_instagram text DEFAULT NULL::text, p_interesse text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSÃO E MESMA ORDEM das irmãs desta tela
  -- (`vessel_beauty_session_encerrar`/`editar`/`arquivar`/`apagar`): um código
  -- que faz uma funcionar e a outra responder `nao_achei` é sistema quebrado
  -- na cara de quem está no salão.
  v_codigo    text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  -- ⚠️ A MESMA LIMPEZA DO SITE (`nomeLimpo`): espaço a mais some, e o mínimo
  -- de 2 letras é o de `problemasDoInteresse`.
  v_nome      text := regexp_replace(trim(coalesce(p_nome, '')), '\s+', ' ', 'g');
  v_tel       text := public.vessel_telefone_canonico(p_whatsapp);
  v_insta     text := nullif(trim(coalesce(p_instagram, '')), '');
  v_interesse text := nullif(trim(coalesce(p_interesse, '')), '');
  v_s         record;
  v_pessoa    bigint;
  v_na_base   boolean;
  v_atend     bigint;
  v_origem    jsonb;
  v_porta     text;
  v_nome_base text;
begin
  if not public.vessel_pode('atendimentos.beauty-sessions', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select s.codigo, s.loja, s.ativa, coalesce(s.arquivada, false) as arquivada
    into v_s
    from public.vessel_beauty_sessions s
   where s.codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  -- ⚠️ ENCERRADA ACEITA (decisão do dono): a equipe passa a limpo, depois do
  -- evento, os contatos que anotou no papel. Só ARQUIVADA recusa — arquivada é
  -- "não devia estar ali", e lead nova numa duplicata some das contas.
  if v_s.arquivada then
    return json_build_object('ok', false, 'situacao', 'sessao_arquivada');
  end if;

  if length(v_nome) < 2 then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;
  -- ⚠️ O MESMO TELEFONE CANÔNICO DE TODA A VESSEL (55 + DDD + número). É ele
  -- que faz a mesma cliente não virar duas, e é por ele que o robô dos pedidos
  -- a reconhece na compra do Bling.
  if v_tel is null then
    return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
  end if;
  -- O mesmo teto da página do QR e do Stylist Circle.
  if v_insta is not null and length(v_insta) > 120 then
    return json_build_object('ok', false, 'situacao', 'instagram_longo');
  end if;
  -- As mesmas três opções da página do QR (mais o vazio).
  if v_interesse is not null
     and v_interesse not in ('conhecer-a-loja', 'rever-uma-peca', 'personal-atelier') then
    return json_build_object('ok', false, 'situacao', 'interesse_invalido');
  end if;

  -- ⚠️ DOIS TOQUES AO MESMO TEMPO NÃO VIRAM DUAS LEADS. A conferência "já está
  -- nesta sessão?" e a gravação precisam acontecer em fila para a MESMA pessoa
  -- na MESMA sessão; sem a fila, duas chamadas simultâneas passariam juntas
  -- pela conferência e gravariam duas origens.
  perform pg_advisory_xact_lock(hashtext('vessel-bs-lead:' || v_codigo || ':' || v_tel));

  select id, nome into v_pessoa, v_nome_base from public.vessel_pessoas where telefone = v_tel;
  v_na_base := v_pessoa is not null;

  -- ⚠️ JÁ SE IDENTIFICOU NESTA SESSÃO (pelo QR ou pela equipe): não duplica.
  -- A resposta diz por onde ela entrou, para a equipe não achar que perdeu.
  if v_na_base and exists (select 1 from public.vessel_origens o
                            where o.pessoa_id = v_pessoa and o.evento_id = v_s.codigo) then
    v_porta := case when exists (select 1 from public.vessel_beauty_session_cadastros c
                                  where c.codigo = v_s.codigo and c.pessoa_id = v_pessoa)
                    then 'equipe' else 'qr' end;
    return json_build_object('ok', false, 'situacao', 'ja_estava', 'porta', v_porta,
                             'pessoa_id', v_pessoa, 'nome', v_nome_base);
  end if;

  -- ⚠️ A ORIGEM É MONTADA AQUI, INTEIRA, e não vem da tela: é a marca que a
  -- planilha lê. Os mesmos campos de `origemDaSessao()` do site, trocando só
  -- `offline_qr` por `offline_equipe`.
  v_origem := jsonb_build_object(
    'canal', 'beauty_session',
    'evento_id', v_s.codigo,
    'utm_source', 'beauty_session',
    'utm_medium', 'offline_equipe',
    'utm_campaign', replace(lower(v_s.codigo), '-', '_'));

  v_atend := public.vessel_anotar_interesse(
    v_nome, v_tel, v_s.loja, 'beauty-session-equipe',
    null,                                    -- ⚠️ o IP vai nulo: ver o cabeçalho
    null, null, v_interesse, null,
    true,                                    -- ⚠️ marketing SEMPRE (decisão do dono)
    'equipe-beauty-session-2026-09-24',
    v_origem, false, v_insta);

  select id, nome into v_pessoa, v_nome_base from public.vessel_pessoas where telefone = v_tel;

  insert into public.vessel_beauty_session_cadastros
    (codigo, pessoa_id, atendimento_id, cadastrado_por, cadastrado_por_nome)
  values (v_s.codigo, v_pessoa, v_atend, auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()));

  return json_build_object('ok', true, 'situacao', 'ok', 'pessoa_id', v_pessoa,
                           'atendimento_id', v_atend, 'ja_na_base', v_na_base,
                           'nome', v_nome_base);
end;
$function$;

-- vessel_beauty_session_criar — Beauty Sessions · editar
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
  if not public.vessel_pode('atendimentos.beauty-sessions', 'editar') then
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

  -- ⚠️ 24/09/2026: "usado" é em TODO lugar onde um código de evento aparece —
  -- sessão apagada deixa as leituras do QR e as origens com o código dela.
  if public.vessel_codigo_de_evento_usado(v_codigo) then
    return json_build_object('ok', false, 'erro',
      'Já existe uma sessão com este código. Código não se reaproveita: a leitura '
      || 'de dois eventos diferentes cairia na mesma linha do painel.');
  end if;

  -- ⚠️ O CINTO: duas criações com o mesmo código ao mesmo tempo passam as duas
  -- pela conferência de cima; a segunda batia na chave primária e voltava um
  -- erro cru. Agora volta a mesma frase.
  begin
    insert into public.vessel_beauty_sessions (codigo, quando, praca, loja, parceiro, ativa)
    values (v_codigo, p_quando, v_praca,
            p_loja, nullif(trim(coalesce(p_parceiro, '')), ''), true);
  exception when unique_violation then
    return json_build_object('ok', false, 'erro',
      'Já existe uma sessão com este código. Código não se reaproveita: a leitura '
      || 'de dois eventos diferentes cairia na mesma linha do painel.');
  end;

  return json_build_object('ok', true, 'codigo', v_codigo);
end;
$function$;

-- vessel_beauty_session_editar — Beauty Sessions · editar
CREATE OR REPLACE FUNCTION public.vessel_beauty_session_editar(p_codigo text, p_quando date DEFAULT NULL::date, p_loja text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_beauty_session_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.beauty-sessions', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_beauty_sessions where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ Campo nulo = "nao mexe neste", nunca "apaga o que estava la". No caso de
  -- `loja` o `coalesce` e o que separa uma edicao de dia de um erro de banco na
  -- cara da pessoa: a coluna e `not null`.
  --
  -- ⚠️ A SESSAO NAO TEM ANFITRIA NEM VAGAS — por isso so `quando` e `loja`.
  -- `praca` e `parceiro` ficam de fora de proposito: a praca esta embutida no
  -- proprio codigo impresso (BS-AAAAMMDD-PRACA-SEQ) e mudar uma sem a outra
  -- deixaria a linha discordando do QR.
  update public.vessel_beauty_sessions
     set quando = coalesce(p_quando, quando),
         loja   = coalesce(p_loja, loja)
   where codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- vessel_beauty_session_encerrar — Beauty Sessions · editar
CREATE OR REPLACE FUNCTION public.vessel_beauty_session_encerrar(p_codigo text, p_ativa boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.beauty-sessions', 'editar') then
    return json_build_object('ok', false, 'erro',
      'Você não tem a permissão de Atendimentos para mexer nas sessões.');
  end if;
  update public.vessel_beauty_sessions
     set ativa = coalesce(p_ativa, false)
   where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'erro', 'Não achei esta sessão.');
  end if;
  return json_build_object('ok', true, 'codigo', v_codigo, 'ativa', coalesce(p_ativa, false));
end;
$function$;

-- vessel_leads_da_beauty_session — Beauty Sessions · ver
CREATE OR REPLACE FUNCTION public.vessel_leads_da_beauty_session(p_codigo text, p_dias integer DEFAULT 7)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_dias   int := greatest(coalesce(p_dias, 7), 0);
  v_saida  json;
begin
  -- ⚠️ DADO PESSOAL (nome e WhatsApp), atrás da mesma trava de ver da conta.
  -- E RECUSA com erro, não com lista vazia: "ninguém se identificou" e "você
  -- não pode ver" decidem coisas opostas na tela.
  if not public.vessel_pode('atendimentos.beauty-sessions', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select coalesce(json_agg(linha order by (linha ->> 'entrou_em') desc, (linha ->> 'pessoa_id')::bigint desc),
                  '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'pessoa_id',  pe.id,
        'nome',       pe.nome,
        'telefone',   pe.telefone,
        'instagram',  pe.instagram,
        -- ⚠️ A PORTA É A LINHA DA EQUIPE, não o `utm_medium` (ver o cabeçalho).
        'porta',      case when c.id is not null then 'equipe' else 'qr' end,
        'entrou_em',  o.primeira,
        'cadastrado_por_nome', c.cadastrado_por_nome,
        -- ⚠️ "FOI À LOJA" E "COMPROU" SÃO AS MESMAS RÉGUAS DOS NÚMEROS DO
        -- CARTÃO (`compareceram` e `receita` de `vessel_conta_das_beauty_sessions`),
        -- para a lista e o número ao lado nunca discordarem.
        'foi_a_loja', exists (select 1 from public.vessel_atendimentos t
                               where t.pessoa_id = pe.id and not coalesce(t.teste, false)
                                 and t.status = 'realizado'),
        'comprou',    exists (select 1 from public.vessel_pedidos p
                               where p.pessoa_id = pe.id
                                 and exists (select 1 from public.vessel_atendimentos t
                                              where t.pessoa_id = p.pessoa_id
                                                and not coalesce(t.teste, false)
                                                and t.status = 'realizado'
                                                and p.data_do_pedido
                                                      between (coalesce(t.quando, t.criado_em)
                                                                at time zone 'America/Sao_Paulo')::date
                                                          and (coalesce(t.quando, t.criado_em)
                                                                at time zone 'America/Sao_Paulo')::date
                                                              + v_dias))
      ) as linha
      from (select o.pessoa_id, min(o.momento) as primeira
              from public.vessel_origens o
             where o.evento_id = v_codigo
             group by o.pessoa_id) o
      join public.vessel_pessoas pe on pe.id = o.pessoa_id
      left join public.vessel_beauty_session_cadastros c
             on c.codigo = v_codigo and c.pessoa_id = pe.id
     where not coalesce(pe.teste, false)
    ) as linhas;

  return v_saida;
end;
$function$;

-- vessel_conta_das_beauty_sessions — Beauty Sessions OU Material Gráfico · ver
--   COMPARTILHADA: a lista da tela Beauty Sessions E a dos QR do Material Gráfico (tela-de-material-grafico.vue), que é só leitura.
CREATE OR REPLACE FUNCTION public.vessel_conta_das_beauty_sessions(p_dias integer DEFAULT 7, p_incluir_arquivadas boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dias int := greatest(coalesce(p_dias, 7), 0);
  -- ⚠️ Mesmo cuidado da outra: NULL vindo de fora nao cai no default, e um
  -- `where NULL` devolveria lista vazia sem erro nenhum.
  v_incluir boolean := coalesce(p_incluir_arquivadas, false);
  v_saida json;
begin
  -- A permissão mora AQUI DENTRO, não no grant: `security definer` roda como
  -- dono, e `authenticated` é todo mundo que fez login no iamundi.
  if not (public.vessel_pode('atendimentos.beauty-sessions', 'ver') or public.vessel_pode('atendimentos.material-grafico', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select coalesce(json_agg(linha order by linha ->> 'quando' desc), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', s.codigo,
        'quando', s.quando,
        'praca', s.praca,
        'loja', s.loja,
        'parceiro', s.parceiro,
        'ativa', s.ativa,
        'arquivada', coalesce(s.arquivada, false),
        'leituras_mesa', (select count(*)::int from public.vessel_sessao_aberturas a
                           where a.codigo = s.codigo and a.peca = 'mesa'),
        'leituras_cartao', (select count(*)::int from public.vessel_sessao_aberturas a
                             where a.codigo = s.codigo and a.peca = 'cartao'),
        -- ⚠️ 24/09/2026: SEM A FICHA DE TESTE. Era o único número desta função
        -- que contava o teste — os de baixo já filtravam `t.teste`.
        'pessoas', (select count(distinct o.pessoa_id)::int
                      from public.vessel_origens o
                      join public.vessel_pessoas pe on pe.id = o.pessoa_id
                     where o.evento_id = s.codigo and not coalesce(pe.teste, false)),
        -- ⚠️ AS DUAS PORTAS SOMAM `pessoas`, sempre: quem tem a linha da
        -- equipe é da equipe; o resto se identificou pelo QR.
        'pessoas_qr', (select count(distinct o.pessoa_id)::int
                         from public.vessel_origens o
                         join public.vessel_pessoas pe on pe.id = o.pessoa_id
                        where o.evento_id = s.codigo and not coalesce(pe.teste, false)
                          and not exists (select 1 from public.vessel_beauty_session_cadastros c
                                           where c.codigo = s.codigo and c.pessoa_id = o.pessoa_id)),
        'pessoas_equipe', (select count(distinct o.pessoa_id)::int
                             from public.vessel_origens o
                             join public.vessel_pessoas pe on pe.id = o.pessoa_id
                            where o.evento_id = s.codigo and not coalesce(pe.teste, false)
                              and exists (select 1 from public.vessel_beauty_session_cadastros c
                                           where c.codigo = s.codigo and c.pessoa_id = o.pessoa_id)),
        'pedidos', (select count(*)::int from public.vessel_atendimentos t
                     where not coalesce(t.teste, false)
                       and exists (select 1 from public.vessel_origens o
                                    where o.evento_id = s.codigo
                                      and o.pessoa_id = t.pessoa_id)),
        'confirmados', (select count(*)::int from public.vessel_atendimentos t
                         where not coalesce(t.teste, false)
                           and t.status in ('confirmado', 'realizado', 'no_show')
                           and exists (select 1 from public.vessel_origens o
                                        where o.evento_id = s.codigo
                                          and o.pessoa_id = t.pessoa_id)),
        'compareceram', (select count(*)::int from public.vessel_atendimentos t
                          where not coalesce(t.teste, false) and t.status = 'realizado'
                            and exists (select 1 from public.vessel_origens o
                                         where o.evento_id = s.codigo
                                           and o.pessoa_id = t.pessoa_id)),
        -- ⚠️ `receita_liquida`, nunca `total_do_bling`: o segundo sai ~6% maior
        -- porque não desconta o desconto do item, e inflaria toda sessão.
        'receita', (select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)
                      from public.vessel_pedidos p
                     where exists (select 1 from public.vessel_origens o
                                    where o.evento_id = s.codigo and o.pessoa_id = p.pessoa_id)
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
      from public.vessel_beauty_sessions s
      where (v_incluir or not coalesce(s.arquivada, false))
    ) as linhas;

  return v_saida;
end;
$function$;

-- ═══ PRIVATE EDIT ══════════════════════════════════════════════════════════

-- vessel_criar_private_edit — Private Edit · editar
CREATE OR REPLACE FUNCTION public.vessel_criar_private_edit(p_stylist text, p_quando timestamp with time zone, p_local text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_vagas integer DEFAULT 8, p_teste boolean DEFAULT false, p_confirmar_sobreposicao boolean DEFAULT NULL::boolean)
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
  v_etapa    public.vessel_stylist_etapas%rowtype;
  v_liberam  text;
  v_praca    text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_codigo   text;
  v_chave    text;
  v_seq      int;
  v_byte     int;
  v_prefixo  text;
  v_volta    int;
  v_indice   text;
  v_sobrepoe json;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao',
      'erro', 'Você não tem a permissão de Atendimentos para criar um encontro.');
  end if;

  select id into v_stylist from public.vessel_stylists
   where codigo = upper(nullif(trim(coalesce(p_stylist, '')), ''));
  if v_stylist is null then
    return json_build_object('ok', false, 'situacao', 'stylist_nao_encontrada',
      'erro', 'Não achei esta stylist. O código é o STY-0000 dela.');
  end if;
  -- ⚠️ 24/09/2026: SÓ QUEM ESTÁ NUMA ETAPA QUE LIBERA PRIVATE EDIT (a Ativada).
  select e.* into v_etapa from public.vessel_stylists s
    join public.vessel_stylist_etapas e on e.id = s.etapa_id
   where s.id = v_stylist;
  if not coalesce(v_etapa.libera_private_edit, false) then
    v_liberam := public.vessel_etapas_que_liberam_private_edit();
    return json_build_object('ok', false, 'situacao', 'stylist_nao_liberada',
      'etapa', v_etapa.nome, 'etapas_que_liberam', v_liberam,
      'erro', 'Esta parceira ainda não pode receber um Private Edit: ela está em "'
              || coalesce(v_etapa.nome, 'sem etapa') || '". '
              || case when v_liberam is null
                      then 'Hoje nenhuma etapa libera Private Edit — marque uma em "Etapas do funil".'
                      else 'Mova-a para ' || v_liberam || ' no Stylist Circle antes de marcar o encontro.' end);
  end if;
  if p_quando is null then
    return json_build_object('ok', false, 'situacao', 'sem_data',
      'erro', 'Escolha o dia e a hora do encontro.');
  end if;
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
  -- ⚠️ T11: CAPACIDADE PLANEJADA DE 7 A 10 (decisão 4 do dono). É a cadeira
  -- que a loja prepara, e não trava ninguém na porta do convite.
  if p_vagas is null or p_vagas < 7 or p_vagas > 10 then
    return json_build_object('ok', false, 'situacao', 'vagas_invalidas',
      'erro', 'A capacidade planejada é de 7 a 10 convidadas.');
  end if;

  -- ⚠️ 24/09/2026 (o código sem repetir): o número do dia NÃO é mais só
  -- "quantos há + 1". Um encontro que mudou de dia deixava o número dele livre
  -- no dia de origem, e o próximo criado lá repetia o código (erro de chave
  -- duplicada). Agora: a FILA (trava por dia e praça, até o fim da transação —
  -- duas criações ao mesmo tempo esperam uma pela outra) e, a partir do número
  -- de sempre, o PRÓXIMO LIVRE — livre em todo lugar onde um código de encontro
  -- aparece (`vessel_codigo_de_evento_usado`), inclusive de encontro apagado
  -- que deixou rastro. O cinto: `unique_violation` na inserção avança e tenta
  -- de novo. Códigos que já existem não mudam.
  v_prefixo := 'PE-' || to_char(p_quando at time zone 'America/Sao_Paulo', 'YYYYMMDD') || '-' || v_praca || '-';
  perform pg_advisory_xact_lock(hashtext('vessel.codigo_do_encontro:' || v_prefixo)::bigint);

  -- ⚠️ 25/09/2026: O ENCONTRO SOBREPOSTO. Depois da fila (duas criações no
  -- mesmo dia e praça já esperam uma pela outra, e a segunda enxerga a
  -- primeira), e só quando a tela PEDE (`p_confirmar_sobreposicao` não nulo).
  -- NULL = a Central de antes: nada muda para ela.
  if p_confirmar_sobreposicao is not null then
    v_sobrepoe := public.vessel_encontros_que_sobrepoem(
                    p_quando, public.vessel_lugar_do_encontro(p_loja, v_praca, p_local), null);
    if not p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
      return json_build_object('ok', false, 'situacao', 'sobrepoe',
        'sobrepoe', v_sobrepoe, 'contexto', public.vessel_contexto_da_loja(p_quando, p_loja),
        'erro', 'Já há Private Edit neste lugar neste horário. Confira e confirme para marcar mesmo assim.');
    end if;
  end if;

  select count(*) + 1 into v_seq from public.vessel_private_edits
   where praca = v_praca
     and (quando at time zone 'America/Sao_Paulo')::date
         = (p_quando at time zone 'America/Sao_Paulo')::date;

  for v_volta in 1..5 loop
    loop
      v_codigo := v_prefixo || lpad(v_seq::text, 2, '0');
      exit when not public.vessel_codigo_de_evento_usado(v_codigo);
      v_seq := v_seq + 1;
    end loop;

    loop
      v_chave := '';
      while length(v_chave) < 8 loop
        v_byte := get_byte(extensions.gen_random_bytes(1), 0);
        continue when v_byte >= v_teto;      -- descarta e sorteia outro
        v_chave := v_chave || substr(v_alfabeto, 1 + (v_byte % v_tam), 1);
      end loop;
      exit when not exists (select 1 from public.vessel_private_edits where chave = v_chave);
    end loop;

    begin
      insert into public.vessel_private_edits
        (codigo, chave, stylist_id, quando, local, praca, loja, vagas, teste)
      values (v_codigo, v_chave, v_stylist, p_quando,
              nullif(trim(coalesce(p_local, '')), ''), v_praca, p_loja, p_vagas, p_teste);
      if p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
        return json_build_object('ok', true, 'codigo', v_codigo, 'chave', v_chave, 'sobrepoe', v_sobrepoe);
      end if;
      return json_build_object('ok', true, 'codigo', v_codigo, 'chave', v_chave);
    exception when unique_violation then
      get stacked diagnostics v_indice = constraint_name;
      if v_indice = 'vessel_private_edits_codigo_idx' then
        v_seq := v_seq + 1;                  -- alguém pegou este número: o próximo
      elsif v_indice is distinct from 'vessel_private_edits_chave_idx' then
        raise;                               -- outra coisa: não é para engolir
      end if;                                -- a chave: sorteia outra na volta
    end;
  end loop;

  return json_build_object('ok', false, 'situacao', 'codigo_em_disputa',
    'erro', 'Não consegui dar um código ao encontro agora. Tente de novo em um instante.');
end;
$function$;

-- vessel_convidar_para_encontro — Private Edit · editar
CREATE OR REPLACE FUNCTION public.vessel_convidar_para_encontro(p_codigo text, p_nome text, p_whatsapp text, p_email text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_email  text := lower(nullif(trim(coalesce(p_email, '')), ''));
  v_e      record;
  v_pessoa bigint;
  v_ja     bigint;
  v_id     bigint;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select e.codigo, e.quando, e.loja, e.status, coalesce(e.arquivada, false) as arquivada,
         s.codigo as stylist
    into v_e
    from public.vessel_private_edits e
    join public.vessel_stylists s on s.id = e.stylist_id
   where e.codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if v_e.arquivada or v_e.status = 'cancelado' then
    return json_build_object('ok', false, 'situacao', 'encontro_fechado');
  end if;

  if nullif(trim(coalesce(p_nome, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;
  -- ⚠️ O MESMO TELEFONE CANÔNICO DE TODA A VESSEL (55 + DDD + número). É ele
  -- que faz a mesma cliente não virar duas, e é por ele que o robô dos pedidos
  -- a reconhece na compra do Bling.
  if public.vessel_telefone_canonico(p_whatsapp) is null then
    return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
  end if;
  if v_email is not null and v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'situacao', 'email_invalido');
  end if;

  -- ⚠️ A FICHA DE CLIENTE NASCE AQUI, ANTES DE ELA COMPRAR — é o "cadastro
  -- antes de existir no CRM" do documento. Se ela já existe (o mesmo
  -- telefone), é a mesma ficha, e o que faltava é completado.
  v_pessoa := public.vessel_pessoa_por_telefone(p_nome, p_whatsapp, v_email);

  -- ⚠️ UMA CONVIDADA, UMA CADEIRA — a mesma regra do RSVP. Convidar de novo
  -- quem já está no encontro devolve a cadeira dela, sem criar outra.
  select id into v_ja from public.vessel_atendimentos
   where pessoa_id = v_pessoa and evento_codigo = v_e.codigo
   order by id limit 1;
  if v_ja is not null then
    return json_build_object('ok', true, 'situacao', 'ja_estava', 'id', v_ja);
  end if;

  insert into public.vessel_origens
    (pessoa_id, canal, evento_id, stylist_id, utm_source, utm_medium, utm_campaign)
  values (v_pessoa, 'private_edit', v_e.codigo, v_e.stylist,
          'private_edit', 'convite', replace(lower(v_e.codigo), '-', '_'));

  insert into public.vessel_atendimentos
    (pessoa_id, loja, quando, status, origem_registro, evento_codigo, convidada_em, chave_convite)
  values (v_pessoa, v_e.loja, v_e.quando, 'solicitado', 'private-edit-convite',
          v_e.codigo, now(), public.vessel_sortear_chave_de_convidada())
  returning id into v_id;

  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id, 'pessoa_id', v_pessoa);
end;
$function$;

-- vessel_private_edit_apagar — Private Edit · editar
CREATE OR REPLACE FUNCTION public.vessel_private_edit_apagar(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_private_edit_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_private_edits where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ APAGAR COM GENTE PENDURADA DEIXARIA LINHAS ORFAS em vessel_atendimentos,
  -- e a receita passaria a somar sobre um encontro que nao existe mais. Para
  -- esses, a tela oferece encerrar e arquivar.
  --
  -- ⚠️ E AQUI TAMBEM E `v_codigo`, NAO `p_codigo`. Se esta linha lesse o cru
  -- enquanto o `delete` abaixo le o normalizado, um codigo em minusculas nao
  -- acharia ninguem pendurado e o `delete` apagaria um encontro COM GENTE —
  -- exatamente o estrago que esta conferencia existe para impedir.
  if exists (select 1 from public.vessel_atendimentos where evento_codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'tem_gente');
  end if;

  delete from public.vessel_private_edits where codigo = v_codigo;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- vessel_private_edit_arquivar — Private Edit · editar
CREATE OR REPLACE FUNCTION public.vessel_private_edit_arquivar(p_codigo text, p_arquivada boolean DEFAULT true)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_private_edit_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if not exists (select 1 from public.vessel_private_edits where codigo = v_codigo) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  update public.vessel_private_edits
     set arquivada = coalesce(p_arquivada, true)
   where codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok',
                           'codigo', v_codigo, 'arquivada', coalesce(p_arquivada, true));
end;
$function$;

-- vessel_private_edit_editar — Private Edit · editar
CREATE OR REPLACE FUNCTION public.vessel_private_edit_editar(p_codigo text, p_quando timestamp with time zone DEFAULT NULL::timestamp with time zone, p_local text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_vagas integer DEFAULT NULL::integer, p_stylist text DEFAULT NULL::text, p_confirmar_sobreposicao boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_private_edit_encerrar`.
  v_codigo  text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_stylist bigint;
  v_atual   public.vessel_private_edits%rowtype;
  v_sobrepoe json;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select * into v_atual from public.vessel_private_edits where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if p_stylist is not null then
    select id into v_stylist from public.vessel_stylists where codigo = p_stylist;
    if v_stylist is null then
      return json_build_object('ok', false, 'situacao', 'stylist_nao_achei');
    end if;
    -- ⚠️ 24/09/2026: TROCAR a anfitriã só por uma liberada. Manter a de hoje
    -- passa sempre — o encontro que já existe não é invalidado.
    if v_stylist is distinct from v_atual.stylist_id and not exists (
         select 1 from public.vessel_stylists s join public.vessel_stylist_etapas e on e.id = s.etapa_id
          where s.id = v_stylist and e.libera_private_edit) then
      return json_build_object('ok', false, 'situacao', 'stylist_nao_liberada',
        'etapas_que_liberam', public.vessel_etapas_que_liberam_private_edit());
    end if;
  end if;

  -- ⚠️ T11: a mesma régua de capacidade do criar. Antes daqui, editar não
  -- conferia vagas nenhuma — dava para gravar zero, e zero é o denominador da
  -- taxa de resposta na tela.
  if p_vagas is not null and (p_vagas < 7 or p_vagas > 10) then
    return json_build_object('ok', false, 'situacao', 'vagas_invalidas');
  end if;

  -- ⚠️ 25/09/2026: O ENCONTRO SOBREPOSTO — só quando a tela pede, e só quando o
  -- dia/hora ou o lugar MUDAM (mexer nas vagas não pede confirmação de novo).
  -- O próprio encontro nunca conflita consigo mesmo.
  if p_confirmar_sobreposicao is not null
     and (coalesce(p_quando, v_atual.quando) is distinct from v_atual.quando
          or public.vessel_lugar_do_encontro(coalesce(p_loja, v_atual.loja), coalesce(p_praca, v_atual.praca),
                                             coalesce(p_local, v_atual.local))
             is distinct from public.vessel_lugar_do_encontro(v_atual.loja, v_atual.praca, v_atual.local)) then
    v_sobrepoe := public.vessel_encontros_que_sobrepoem(
                    coalesce(p_quando, v_atual.quando),
                    public.vessel_lugar_do_encontro(coalesce(p_loja, v_atual.loja), coalesce(p_praca, v_atual.praca),
                                                    coalesce(p_local, v_atual.local)),
                    v_codigo);
    if not p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
      return json_build_object('ok', false, 'situacao', 'sobrepoe', 'codigo', v_codigo,
        'sobrepoe', v_sobrepoe,
        'contexto', public.vessel_contexto_da_loja(coalesce(p_quando, v_atual.quando), coalesce(p_loja, v_atual.loja)));
    end if;
  end if;

  -- Campo nulo = "nao mexe neste", nunca "apaga o que estava la".
  update public.vessel_private_edits
     set quando     = coalesce(p_quando, quando),
         local      = coalesce(p_local, local),
         praca      = coalesce(p_praca, praca),
         loja       = coalesce(p_loja, loja),
         vagas      = coalesce(p_vagas, vagas),
         stylist_id = coalesce(v_stylist, stylist_id)
   where codigo = v_codigo;

  if p_confirmar_sobreposicao and json_array_length(v_sobrepoe) > 0 then
    return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo, 'sobrepoe', v_sobrepoe);
  end if;
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- vessel_private_edit_encerrar — Private Edit · editar
CREATE OR REPLACE FUNCTION public.vessel_private_edit_encerrar(p_codigo text, p_ativa boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'erro',
      'Você não tem a permissão de Atendimentos para mexer nos encontros.');
  end if;
  update public.vessel_private_edits
     set ativa = coalesce(p_ativa, false)
   where codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'erro', 'Não achei este encontro.');
  end if;
  return json_build_object('ok', true, 'codigo', v_codigo, 'ativa', coalesce(p_ativa, false));
end;
$function$;

-- vessel_private_edit_situacao — Private Edit · editar
CREATE OR REPLACE FUNCTION public.vessel_private_edit_situacao(p_codigo text, p_status text, p_realizado_em date DEFAULT NULL::date, p_motivo text DEFAULT NULL::text, p_observacoes text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_status text := lower(nullif(trim(coalesce(p_status, '')), ''));
  v_motivo text := nullif(trim(coalesce(p_motivo, '')), '');
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_e      public.vessel_private_edits%rowtype;
  v_data   date;
begin
  -- ⚠️ TRAVA DE MEXER: quem confirma a realização é a gerente, e ela mexe.
  if not public.vessel_pode('atendimentos.private-edit', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select * into v_e from public.vessel_private_edits where codigo = v_codigo;
  if v_e.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if v_status is null or v_status not in ('em_planejamento', 'agendado', 'confirmado',
       'realizado', 'reagendado', 'cancelado', 'nao_realizado') then
    return json_build_object('ok', false, 'situacao', 'status_invalido');
  end if;

  if v_status in ('cancelado', 'nao_realizado') and v_motivo is null then
    return json_build_object('ok', false, 'situacao', 'sem_motivo');
  end if;

  if v_status = 'realizado' then
    -- Sem data escrita, vale o dia marcado — é o caso comum.
    v_data := coalesce(p_realizado_em, v_e.realizado_em,
                       (v_e.quando at time zone 'America/Sao_Paulo')::date);
    if v_data > v_hoje then
      return json_build_object('ok', false, 'situacao', 'realizado_no_futuro');
    end if;
  end if;

  update public.vessel_private_edits
     set status       = v_status,
         realizado_em = case when v_status = 'realizado' then v_data end,
         motivo       = case when v_status in ('cancelado', 'nao_realizado') then v_motivo end,
         -- `observacoes` nula não mexe; string vazia apaga.
         observacoes  = case when p_observacoes is null then observacoes
                             else nullif(trim(p_observacoes), '') end,
         -- ⚠️ ENCONTRO QUE ACABOU PARA DE ACEITAR RESPOSTA NO CONVITE. O
         -- contrário não: reabrir o convite continua sendo um gesto à parte
         -- (`vessel_private_edit_encerrar`), e voltar para "agendado" não
         -- pode reabrir sozinho um convite que alguém fechou de propósito.
         ativa        = case when v_status in ('realizado', 'cancelado', 'nao_realizado')
                             then false else ativa end
   where id = v_e.id;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo,
                           'status', v_status, 'antes', v_e.status);
end;
$function$;

-- vessel_agenda_das_lojas — Private Edit · ver
CREATE OR REPLACE FUNCTION public.vessel_agenda_das_lojas(p_de date, p_ate date, p_loja text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_de   date := coalesce(p_de, (now() at time zone 'America/Sao_Paulo')::date);
  v_ate  date := coalesce(p_ate, coalesce(p_de, (now() at time zone 'America/Sao_Paulo')::date) + 41);
  v_loja text := nullif(lower(trim(coalesce(p_loja, ''))), '');
  v_dur  interval := public.vessel_private_edit_duracao();
  v_saida json;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  if v_ate < v_de then
    raise exception 'o fim vem antes do começo' using errcode = '22023';
  end if;
  -- Uma tela mostra no máximo um mês e as bordas; seis meses é folga de sobra
  -- e impede que um pedido de "todos os anos" segure o banco.
  if v_ate - v_de > 190 then
    raise exception 'periodo longo demais (maximo 190 dias)' using errcode = '22023';
  end if;

  select coalesce(json_agg(x order by x ->> 'dia', x ->> 'hora' nulls first, x ->> 'tipo', x ->> 'codigo'), '[]'::json)
    into v_saida
    from (
      -- Private Edit (o que a tela destaca)
      select json_build_object(
               'tipo', 'private_edit', 'id', e.id, 'codigo', e.codigo,
               'dia', to_char(e.quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
               'hora', to_char(e.quando at time zone 'America/Sao_Paulo', 'HH24:MI'),
               'hora_fim', to_char((e.quando + v_dur) at time zone 'America/Sao_Paulo', 'HH24:MI'),
               'inicio', e.quando, 'fim', e.quando + v_dur,
               'loja', e.loja, 'praca', e.praca, 'local', e.local,
               'lugar', public.vessel_lugar_do_encontro(e.loja, e.praca, e.local),
               'stylist', s.codigo, 'anfitria', s.nome, 'parceiro', null, 'client_advisor', null,
               'status', e.status,
               'sobrepoe', (select coalesce(json_agg(o ->> 'codigo'), '[]'::json)
                              from json_array_elements(public.vessel_encontros_que_sobrepoem(
                                     e.quando, public.vessel_lugar_do_encontro(e.loja, e.praca, e.local), e.codigo)) o)
             ) as x
        from public.vessel_private_edits e
        left join public.vessel_stylists s on s.id = e.stylist_id
       where not coalesce(e.teste, false)
         and not coalesce(e.arquivada, false)
         and coalesce(e.status, 'agendado') not in ('cancelado', 'nao_realizado')
         and (e.quando at time zone 'America/Sao_Paulo')::date between v_de and v_ate
         and (v_loja is null or e.loja = v_loja)
      union all
      -- Beauty Session (o dia inteiro; acontece no salão parceiro, a loja é a
      -- que recebe o interesse)
      select json_build_object(
               'tipo', 'beauty_session', 'id', null, 'codigo', b.codigo,
               'dia', to_char(b.quando, 'YYYY-MM-DD'), 'hora', null, 'hora_fim', null,
               'inicio', null, 'fim', null,
               'loja', b.loja, 'praca', b.praca, 'local', null, 'lugar', b.loja,
               'stylist', null, 'anfitria', null, 'parceiro', b.parceiro, 'client_advisor', null,
               'status', case when coalesce(b.ativa, true) then 'aberta' else 'encerrada' end,
               'sobrepoe', null)
        from public.vessel_beauty_sessions b
       where not coalesce(b.arquivada, false)
         and b.quando between v_de and v_ate
         and (v_loja is null or b.loja = v_loja)
      union all
      -- Private Appointment (a visita marcada; sem o nome da cliente)
      select json_build_object(
               'tipo', 'private_appointment', 'id', t.id, 'codigo', null,
               'dia', to_char(t.quando at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'),
               'hora', to_char(t.quando at time zone 'America/Sao_Paulo', 'HH24:MI'), 'hora_fim', null,
               'inicio', t.quando, 'fim', null,
               'loja', t.loja, 'praca', null, 'local', null, 'lugar', t.loja,
               'stylist', null, 'anfitria', null, 'parceiro', null, 'client_advisor', t.client_advisor,
               'status', t.status, 'sobrepoe', null)
        from public.vessel_atendimentos t
       where t.quando is not null
         and not coalesce(t.teste, false)
         and coalesce(t.evento_codigo, '') not like 'PE-%'
         and t.status not in ('cancelado', 'remarcado')
         and (t.quando at time zone 'America/Sao_Paulo')::date between v_de and v_ate
         and (v_loja is null or t.loja = v_loja)
    ) as itens;

  return v_saida;
end;
$function$;

-- vessel_chave_da_convidada — Private Edit · ver
CREATE OR REPLACE FUNCTION public.vessel_chave_da_convidada(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t record;
  v_chave text;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'ver') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select t.id, t.chave_convite, e.chave as chave_encontro into v_t
    from public.vessel_atendimentos t
    join public.vessel_private_edits e on e.codigo = t.evento_codigo
   where t.id = p_id;
  if not found then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  v_chave := v_t.chave_convite;
  if v_chave is null then
    v_chave := public.vessel_sortear_chave_de_convidada();
    update public.vessel_atendimentos set chave_convite = v_chave where id = v_t.id and chave_convite is null;
    select chave_convite into v_chave from public.vessel_atendimentos where id = v_t.id;
  end if;
  return json_build_object('ok', true, 'situacao', 'ok', 'chave', v_chave, 'chave_encontro', v_t.chave_encontro);
end;
$function$;

-- vessel_convidadas_do_encontro — Private Edit · ver
CREATE OR REPLACE FUNCTION public.vessel_convidadas_do_encontro(p_codigo text, p_dias integer DEFAULT 14)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo   text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_dias     int := greatest(coalesce(p_dias, 14), 0);
  v_e        public.vessel_private_edits%rowtype;
  v_resposta json;
begin
  -- ⚠️ DADO PESSOAL, atrás do portão de ver; lista vazia em vez de erro (ver
  -- `2026-09-19-vessel-convidadas-do-encontro.sql`).
  if not public.vessel_pode('atendimentos.private-edit', 'ver') then
    return '[]'::json;
  end if;

  select * into v_e from public.vessel_private_edits e where e.codigo = v_codigo;
  if v_e.id is null then
    return '[]'::json;
  end if;

  select coalesce(json_agg(linha order by ordem), '[]'::json)
    into v_resposta
    from (
      select json_build_object(
        -- ⚠️ O GUEST ID DO DOCUMENTO É ESTE: nasce no convite, nunca muda, e
        -- não é o mesmo número da ficha de cliente (`pessoa_id`).
        'id',          t.id,
        'pessoa_id',   t.pessoa_id,
        'nome',        pe.nome,
        'telefone',    pe.telefone,
        'email',       pe.email,
        'rsvp',        t.rsvp,
        'status',      t.status,
        'convidada_em', t.convidada_em,
        'convite_enviado_em', t.convite_enviado_em,
        'chave_convite', t.chave_convite, 'convite_aberto_em', t.convite_aberto_em,
        'convite_aberturas', t.convite_aberturas,
        'respondeu_em', case when t.rsvp is not null then t.criado_em end,
        'presenca_em', t.presenca_em,
        'situacao',    public.vessel_situacao_do_convite(t.status, t.rsvp, t.convite_enviado_em,
                                                         v_e.quando, v_e.status),
        -- ⚠️ "COMPROU" É A MESMA REGRA DA RECEITA DO TOPO, pelo mesmo miolo:
        -- venda atribuída a ESTE encontro. Quem já tinha ido a um encontro
        -- anterior tem a compra lá (decisão 2 do dono), e aqui fica "—".
        'comprou', exists (select 1 from public.vessel_vendas_dos_encontros(v_dias) v
                            where v.evento_codigo = v_e.codigo and v.pessoa_id = t.pessoa_id)
      ) as linha,
      t.id as ordem
      from public.vessel_atendimentos t
      join public.vessel_pessoas pe on pe.id = t.pessoa_id
     where t.evento_codigo = v_codigo
       and not coalesce(t.teste, false)
    ) as linhas;

  return v_resposta;
end;
$function$;

-- vessel_convite_marcar — Private Edit · ver
CREATE OR REPLACE FUNCTION public.vessel_convite_marcar(p_id bigint, p_marca text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_marca text := lower(nullif(trim(coalesce(p_marca, '')), ''));
begin
  -- ⚠️ A MESMA TRAVA DE `vessel_situacao_do_atendimento`, que é por onde a
  -- presença é marcada: marcar "convite enviado" e marcar "veio" são o mesmo
  -- tipo de gesto, feitos pela mesma pessoa, no mesmo cartão.
  if not public.vessel_pode('atendimentos.private-edit', 'ver') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_marca is null or v_marca not in ('enviado', 'sim', 'nao', 'sem_resposta') then
    return json_build_object('ok', false, 'situacao', 'marca_invalida');
  end if;
  -- ⚠️ SÓ CONVIDADA DE ENCONTRO. Uma visita comum não tem convite, e esta
  -- função não pode virar um jeito de reescrever `rsvp` de qualquer linha.
  if not exists (select 1 from public.vessel_atendimentos
                  where id = p_id and evento_codigo is not null) then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  update public.vessel_atendimentos
     set convite_enviado_em = case when v_marca = 'enviado'
                                   then coalesce(convite_enviado_em, now())
                                   else convite_enviado_em end,
         rsvp = case v_marca when 'sim' then 'sim' when 'nao' then 'nao'
                             when 'sem_resposta' then null else rsvp end,
         atualizado_em = now()
   where id = p_id;

  return json_build_object('ok', true, 'situacao', 'ok');
end;
$function$;

-- vessel_private_edit_sobreposicoes — Private Edit · ver
CREATE OR REPLACE FUNCTION public.vessel_private_edit_sobreposicoes(p_quando timestamp with time zone, p_loja text, p_ignorar_codigo text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_local text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.vessel_pode('atendimentos.private-edit', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return json_build_object(
    'ok', true,
    'duracao_em_horas', extract(epoch from public.vessel_private_edit_duracao())::int / 3600,
    'sobrepoe', public.vessel_encontros_que_sobrepoem(
                  p_quando, public.vessel_lugar_do_encontro(p_loja, p_praca, p_local), p_ignorar_codigo),
    'contexto', public.vessel_contexto_da_loja(p_quando, nullif(trim(coalesce(p_loja, '')), '')));
end;
$function$;

-- vessel_stylists_para_escolher — Private Edit · ver
CREATE OR REPLACE FUNCTION public.vessel_stylists_para_escolher()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_saida json;
begin
  if not public.vessel_pode('atendimentos.private-edit', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  -- ⚠️ 24/09/2026: + `etapa` e `libera_private_edit`. A lista continua com
  -- TODAS as ativas (o cartão da convidada lê o WhatsApp da anfitriã de
  -- encontros antigos); "só as liberadas" para o encontro novo é a tela.
  select coalesce(json_agg(json_build_object('codigo', s.codigo, 'nome', s.nome,
                                             'cidade', s.cidade, 'whatsapp', s.whatsapp,
                                             'etapa', e.nome,
                                             'libera_private_edit', coalesce(e.libera_private_edit, false))
                           order by s.codigo), '[]'::json)
    into v_saida
    from public.vessel_stylists s
    left join public.vessel_stylist_etapas e on e.id = s.etapa_id
   where not coalesce(s.teste, false)
     and coalesce(s.ativa, true);
  return v_saida;
end;
$function$;

-- vessel_conta_das_private_edits — Private Edit OU Material Gráfico · ver
--   COMPARTILHADA: a lista da tela Private Edit E a dos QR do Material Gráfico.
CREATE OR REPLACE FUNCTION public.vessel_conta_das_private_edits(p_dias integer DEFAULT 14, p_incluir_arquivadas boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dias int := greatest(coalesce(p_dias, 14), 0);
  v_incluir boolean := coalesce(p_incluir_arquivadas, false);
  v_saida json;
begin
  if not (public.vessel_pode('atendimentos.private-edit', 'ver') or public.vessel_pode('atendimentos.material-grafico', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  with vendas as (select * from public.vessel_vendas_dos_encontros(v_dias)),
  convite as (
    select t.evento_codigo, t.status, t.rsvp,
           public.vessel_situacao_do_convite(t.status, t.rsvp, t.convite_enviado_em,
                                             e.quando, e.status) as situacao
      from public.vessel_atendimentos t
      join public.vessel_private_edits e on e.codigo = t.evento_codigo
     where not coalesce(t.teste, false)
  )
  select coalesce(json_agg(linha order by linha ->> 'quando' desc), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', e.codigo,
        'chave', e.chave,
        'quando', e.quando,
        'anfitria', s.nome,
        'stylist', s.codigo,
        'local', e.local,
        'praca', e.praca,
        'loja', e.loja,
        'vagas', e.vagas,
        'ativa', coalesce(e.ativa, true),
        'arquivada', coalesce(e.arquivada, false),
        -- T11: a situação do encontro e o que vem com ela.
        'status', e.status,
        'realizado_em', e.realizado_em,
        'motivo', e.motivo,
        'observacoes', e.observacoes,
        'convidadas', (select count(*)::int from convite c where c.evento_codigo = e.codigo),
        -- ⚠️ "RESPONDERAM" DEIXOU DE SER "TODA LINHA". Até a T11 toda convidada
        -- nascia do RSVP, então contar linhas era contar respostas. Agora a
        -- equipe inclui convidadas antes de elas responderem, e contar linha
        -- diria que responderam quem ainda nem recebeu o convite.
        'responderam', (select count(*)::int from convite c where c.evento_codigo = e.codigo
                          and (c.rsvp is not null or c.status <> 'solicitado')),
        'disseram_sim', (select count(*)::int from convite c where c.evento_codigo = e.codigo
                           and c.rsvp = 'sim'),
        -- ⚠️ CONFIRMADAS = quem confirmou, inclusive quem depois veio ou faltou.
        -- Sem quem faltou no denominador, o comparecimento daria perto de 100%
        -- sempre.
        'confirmadas', (select count(*)::int from convite c where c.evento_codigo = e.codigo
                          and c.situacao in ('confirmada', 'presente', 'nao_compareceu')),
        'compareceram', (select count(*)::int from convite c where c.evento_codigo = e.codigo
                           and c.status = 'realizado'),
        'receita', (select coalesce(sum(v.receita), 0) from vendas v where v.evento_codigo = e.codigo),
        'vendas', (select count(*)::int from vendas v where v.evento_codigo = e.codigo),
        'janela_de_venda_em_dias', v_dias
      ) as linha
      from public.vessel_private_edits e
      join public.vessel_stylists s on s.id = e.stylist_id
      where not coalesce(e.teste, false)
        and (v_incluir or not coalesce(e.arquivada, false))
    ) as linhas;

  return v_saida;
end;
$function$;

-- ═══ STYLIST CIRCLE ════════════════════════════════════════════════════════

-- vessel_stylist_avaliar — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_avaliar(p_codigo text, p_carteira integer, p_portfolio integer, p_mobilizacao integer, p_acesso integer, p_confiabilidade integer, p_observacao text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_obs    text := nullif(trim(coalesce(p_observacao, '')), '');
  v_s      public.vessel_stylists%rowtype;
  v_q      public.vessel_stylist_qualificacoes%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_s from public.vessel_stylists where codigo = v_codigo;
  if v_s.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  if p_carteira is null or p_portfolio is null or p_mobilizacao is null
     or p_acesso is null or p_confiabilidade is null
     or p_carteira not between 1 and 5 or p_portfolio not between 1 and 5
     or p_mobilizacao not between 1 and 5 or p_acesso not between 1 and 5
     or p_confiabilidade not between 1 and 5 then
    return json_build_object('ok', false, 'situacao', 'nivel_invalido');
  end if;
  if v_obs is not null and length(v_obs) > 280 then
    return json_build_object('ok', false, 'situacao', 'observacao_longa');
  end if;

  insert into public.vessel_stylist_qualificacoes
    (stylist_id, carteira, portfolio, mobilizacao, acesso, confiabilidade, observacao,
     avaliado_por, avaliado_por_nome, teste)
  values (v_s.id, p_carteira, p_portfolio, p_mobilizacao, p_acesso, p_confiabilidade, v_obs,
          auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
          coalesce(v_s.teste, false))
  returning * into v_q;

  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_q.id,
    'nota', v_q.nota, 'faixa', v_q.faixa, 'avaliado_em', v_q.avaliado_em);
end;
$function$;

-- vessel_stylist_criar — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_criar(p_nome text, p_whatsapp text, p_cidade text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_atuacao text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_origem_contato text DEFAULT NULL::text, p_responsavel text DEFAULT NULL::text, p_prospectado_em date DEFAULT NULL::date, p_proxima_acao text DEFAULT NULL::text, p_proxima_acao_em date DEFAULT NULL::date, p_observacoes text DEFAULT NULL::text, p_sem_contato boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fone    text;
  v_insta   text := nullif(trim(coalesce(p_instagram, '')), '');
  v_perfil  text := public.vessel_instagram_canonico(p_instagram);
  v_obs     text := nullif(trim(coalesce(p_observacoes, '')), '');
  v_praca   text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_loja    text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem  text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_codigo  text;
  v_n       int;
  v_volta   int;
  v_indice  text;
  v_outra   text;
  -- ⚠️ SEM CONTATO AINDA (24/09/2026): só vale quando não veio NENHUM contato.
  v_sem     boolean := coalesce(p_sem_contato, false);
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  if nullif(trim(coalesce(p_nome, '')), '') is null then
    return json_build_object('ok', false, 'situacao', 'sem_nome');
  end if;

  -- ⚠️ WHATSAPP OU INSTAGRAM (ver `2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql`).
  if nullif(trim(coalesce(p_whatsapp, '')), '') is not null then
    v_fone := public.vessel_telefone_canonico(p_whatsapp);
    if v_fone is null then
      return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
    end if;
  end if;
  if length(coalesce(v_insta, '')) > 120 then
    return json_build_object('ok', false, 'situacao', 'instagram_longo');
  end if;
  -- ⚠️ SEM CONTATO AINDA: só quem MARCOU a caixa entra sem os dois. A Central
  -- antiga não manda `p_sem_contato` (padrão false) e continua recusando igual.
  if v_fone is null and v_insta is null and not v_sem then
    return json_build_object('ok', false, 'situacao', 'sem_contato');
  end if;
  -- Instagram ESCRITO sem WhatsApp continua tendo de ser um perfil de verdade.
  if v_fone is null and v_insta is not null and v_perfil is null then
    return json_build_object('ok', false, 'situacao', 'instagram_invalido');
  end if;
  if v_obs is not null and length(v_obs) > 2000 then
    return json_build_object('ok', false, 'situacao', 'observacoes_longas');
  end if;

  if v_praca is not null and v_praca not in ('CPS', 'SAO', 'SBO', 'BSB') then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  if v_loja is not null and v_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;
  if v_origem is null or v_origem not in ('indicacao', 'pesquisa', 'evento', 'inbound') then
    return json_build_object('ok', false, 'situacao', 'origem_invalida');
  end if;

  if v_fone is not null and exists (select 1 from public.vessel_stylists where whatsapp = v_fone) then
    return json_build_object('ok', false, 'situacao', 'whatsapp_repetido',
      'codigo', (select s.codigo from public.vessel_stylists s where s.whatsapp = v_fone));
  end if;
  if v_perfil is not null then
    select s.codigo into v_outra from public.vessel_stylists s
     where public.vessel_instagram_canonico(s.instagram) = v_perfil
     order by s.id limit 1;
    if v_outra is not null then
      return json_build_object('ok', false, 'situacao', 'instagram_repetido', 'codigo', v_outra);
    end if;
  end if;

  -- ⚠️ A TRAVA DE FILA E O CINTO, sem mudança desde 19/09.
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylists.codigo')::bigint);

  for v_volta in 1..3 loop
    select coalesce(max((substring(s.codigo from '^STY-([0-9]{4})$'))::int), 0)
      into v_n
      from public.vessel_stylists s
     where s.codigo ~ '^STY-[0-9]{4}$';

    v_codigo := null;
    for i in 1..10000 loop
      v_n := v_n + 1;
      if v_n > 9999 then
        v_n := 0;
      end if;
      v_codigo := 'STY-' || lpad(v_n::text, 4, '0');
      exit when not exists (select 1 from public.vessel_stylists s where s.codigo = v_codigo);
      v_codigo := null;
    end loop;

    if v_codigo is null then
      return json_build_object('ok', false, 'situacao', 'sem_codigo_livre');
    end if;

    begin
      -- ⚠️ SEM `etapa_id` E SEM `prospectado_em`: o gatilho põe a primeira
      -- etapa de funil e a data segue a regra da etapa marcada.
      insert into public.vessel_stylists
        (codigo, nome, whatsapp, cidade, instagram, atuacao, praca_preview,
         loja, origem_contato, responsavel, proxima_acao, proxima_acao_em, observacoes,
         sem_contato)
      values
        (v_codigo, trim(p_nome), v_fone,
         nullif(trim(coalesce(p_cidade, '')), ''),
         v_insta,
         nullif(trim(coalesce(p_atuacao, '')), ''),
         v_praca, v_loja, v_origem,
         nullif(trim(coalesce(p_responsavel, '')), ''),
         nullif(trim(coalesce(p_proxima_acao, '')), ''),
         p_proxima_acao_em,
         v_obs,
         v_sem and v_fone is null and v_insta is null);

      return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);

    exception when unique_violation then
      get stacked diagnostics v_indice = constraint_name;

      if v_indice = 'vessel_stylists_whatsapp_idx' then
        return json_build_object('ok', false, 'situacao', 'whatsapp_repetido');
      end if;

      if v_indice is distinct from 'vessel_stylists_codigo_idx' then
        return json_build_object('ok', false, 'situacao', 'conflito_no_cadastro',
                                 'onde', v_indice);
      end if;
    end;
  end loop;

  return json_build_object('ok', false, 'situacao', 'codigo_em_disputa');
end;
$function$;

-- vessel_stylist_desativar — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_desativar(p_codigo text, p_ativa boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  -- ⚠️ `coalesce(p_ativa, false)`: quando a tela manda so o codigo — ou quando
  -- o PostgREST deixa o segundo parametro de fora e ele chega nulo —
  -- "desativar" tem de significar DESATIVAR. A coluna e `not null`, entao sem
  -- o `coalesce` a chamada morreria com erro de banco na cara da pessoa.
  v_ativa  boolean := coalesce(p_ativa, false);
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
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

-- vessel_stylist_editar — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_editar(p_codigo text, p_nome text DEFAULT NULL::text, p_whatsapp text DEFAULT NULL::text, p_cidade text DEFAULT NULL::text, p_instagram text DEFAULT NULL::text, p_atuacao text DEFAULT NULL::text, p_estagio text DEFAULT NULL::text, p_praca text DEFAULT NULL::text, p_loja text DEFAULT NULL::text, p_origem_contato text DEFAULT NULL::text, p_responsavel text DEFAULT NULL::text, p_prospectado_em date DEFAULT NULL::date, p_proxima_acao text DEFAULT NULL::text, p_proxima_acao_em date DEFAULT NULL::date, p_sem_proxima_acao boolean DEFAULT false, p_observacoes text DEFAULT NULL::text, p_sem_contato boolean DEFAULT NULL::boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo  text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_fone    text;
  v_insta   text := nullif(trim(coalesce(p_instagram, '')), '');
  v_perfil  text := public.vessel_instagram_canonico(p_instagram);
  v_praca   text := upper(nullif(trim(coalesce(p_praca, '')), ''));
  v_loja    text := lower(nullif(trim(coalesce(p_loja, '')), ''));
  v_origem  text := lower(nullif(trim(coalesce(p_origem_contato, '')), ''));
  v_fone_atual text;
  v_insta_atual text;
  v_com_contato boolean;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  select s.whatsapp, nullif(btrim(coalesce(s.instagram, '')), '') into v_fone_atual, v_insta_atual
    from public.vessel_stylists s where s.codigo = v_codigo;
  if not found then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  if nullif(trim(coalesce(p_estagio, '')), '') is not null then
    return json_build_object('ok', false, 'situacao', 'etapa_pela_ficha');
  end if;

  if nullif(trim(coalesce(p_whatsapp, '')), '') is not null then
    v_fone := public.vessel_telefone_canonico(p_whatsapp);
    if v_fone is null then
      return json_build_object('ok', false, 'situacao', 'whatsapp_invalido');
    end if;
    if exists (select 1 from public.vessel_stylists s
                where s.whatsapp = v_fone and s.codigo <> v_codigo) then
      return json_build_object('ok', false, 'situacao', 'whatsapp_repetido');
    end if;
  end if;

  if v_insta is not null then
    if length(v_insta) > 120 then
      return json_build_object('ok', false, 'situacao', 'instagram_longo');
    end if;
    if coalesce(v_fone, v_fone_atual) is null and v_perfil is null then
      return json_build_object('ok', false, 'situacao', 'instagram_invalido');
    end if;
    if v_perfil is not null and exists (
         select 1 from public.vessel_stylists s
          where public.vessel_instagram_canonico(s.instagram) = v_perfil
            and s.codigo <> v_codigo) then
      return json_build_object('ok', false, 'situacao', 'instagram_repetido');
    end if;
  end if;

  -- ⚠️ SEM CONTATO AINDA (24/09/2026). NULO = NÃO MEXE (a Central antiga não
  -- manda). Desmarcar sem dar um contato é recusado: a parceira ficaria sem
  -- WhatsApp, sem Instagram e sem a marca — o que a tabela não aceita.
  -- Ganhar um contato DESLIGA a marca sozinho (aqui e no gatilho da tabela).
  v_com_contato := coalesce(v_fone, v_fone_atual) is not null or coalesce(v_insta, v_insta_atual) is not null;
  if p_sem_contato is not null and not p_sem_contato and not v_com_contato then
    return json_build_object('ok', false, 'situacao', 'sem_contato');
  end if;

  if p_observacoes is not null and length(trim(p_observacoes)) > 2000 then
    return json_build_object('ok', false, 'situacao', 'observacoes_longas');
  end if;

  if v_praca is not null and v_praca not in ('CPS', 'SAO', 'SBO', 'BSB') then
    return json_build_object('ok', false, 'situacao', 'praca_invalida');
  end if;
  if v_loja is not null and v_loja not in ('iguatemi', 'tivoli', 'parkshopping') then
    return json_build_object('ok', false, 'situacao', 'loja_invalida');
  end if;
  if v_origem is not null and v_origem not in ('indicacao', 'pesquisa', 'evento', 'inbound') then
    return json_build_object('ok', false, 'situacao', 'origem_invalida');
  end if;

  update public.vessel_stylists s
     set nome            = coalesce(nullif(trim(coalesce(p_nome, '')), ''), s.nome),
         whatsapp        = coalesce(v_fone, s.whatsapp),
         cidade          = coalesce(nullif(trim(coalesce(p_cidade, '')), ''), s.cidade),
         instagram       = coalesce(v_insta, s.instagram),
         atuacao         = coalesce(nullif(trim(coalesce(p_atuacao, '')), ''), s.atuacao),
         praca_preview   = coalesce(v_praca, s.praca_preview),
         loja            = coalesce(v_loja, s.loja),
         origem_contato  = coalesce(v_origem, s.origem_contato),
         responsavel     = coalesce(nullif(trim(coalesce(p_responsavel, '')), ''), s.responsavel),
         proxima_acao    = case when coalesce(p_sem_proxima_acao, false) then null
                                else coalesce(nullif(trim(coalesce(p_proxima_acao, '')), ''),
                                              s.proxima_acao) end,
         proxima_acao_em = case when coalesce(p_sem_proxima_acao, false) then null
                                else coalesce(p_proxima_acao_em, s.proxima_acao_em) end,
         observacoes     = case when p_observacoes is null then s.observacoes
                                else nullif(trim(p_observacoes), '') end,
         sem_contato     = case when v_com_contato then false
                                else coalesce(p_sem_contato, s.sem_contato) end,
         atualizado_em   = now()
   where s.codigo = v_codigo;

  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo);
end;
$function$;

-- vessel_stylist_etapa_criar — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_criar(p_nome text, p_posicao integer DEFAULT NULL::integer, p_tipo text DEFAULT 'funil'::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_tipo text := lower(btrim(coalesce(p_tipo, 'funil')));
  v_n    int;
  v_pos  int;
  v_id   bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome = '' then return json_build_object('ok', false, 'situacao', 'sem_nome'); end if;
  if length(v_nome) > 60 then return json_build_object('ok', false, 'situacao', 'nome_longo'); end if;
  if v_tipo not in ('funil', 'saida') then return json_build_object('ok', false, 'situacao', 'tipo_invalido'); end if;

  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  if exists (select 1 from public.vessel_stylist_etapas where ativa and lower(btrim(nome)) = lower(v_nome)) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  select count(*)::int into v_n from public.vessel_stylist_etapas where ativa;
  v_pos := least(greatest(coalesce(p_posicao, v_n + 1), 1), v_n + 1);
  update public.vessel_stylist_etapas set ordem = ordem + 1 where ativa and ordem >= v_pos;
  insert into public.vessel_stylist_etapas (nome, ordem, tipo, criado_por, criado_por_nome)
  values (v_nome, v_pos, v_tipo, auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()))
  returning id into v_id;
  perform public.vessel_stylist_etapas_renumerar();
  perform public.vessel_stylist_etapas_anotar(v_id, 'criar', null,
    jsonb_build_object('nome', v_nome, 'ordem', v_pos, 'tipo', v_tipo));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id);
end;
$function$;

-- vessel_stylist_etapa_excluir — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_excluir(p_id bigint, p_destino bigint DEFAULT NULL::bigint, p_motivo_id bigint DEFAULT NULL::bigint, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_e      public.vessel_stylist_etapas%rowtype;
  v_n      int;
  v_recusa text;
  v_saida  boolean;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.tipo = 'funil' and (select count(*) from public.vessel_stylist_etapas where ativa and tipo = 'funil') <= 1 then
    return json_build_object('ok', false, 'situacao', 'ultima_do_funil');
  end if;
  if v_e.conta_como_prospectada then
    return json_build_object('ok', false, 'situacao', 'etapa_marcada');
  end if;
  select count(*)::int into v_n from public.vessel_stylists where etapa_id = p_id;
  if v_n > 0 then
    if p_destino is null then
      return json_build_object('ok', false, 'situacao', 'precisa_destino', 'stylists', v_n);
    end if;
    if p_destino = p_id or not exists (select 1 from public.vessel_stylist_etapas where id = p_destino and ativa) then
      return json_build_object('ok', false, 'situacao', 'destino_invalido');
    end if;
    v_recusa := public.vessel_stylist_conferir_motivo(p_destino, p_motivo_id, p_nota);
    if v_recusa is not null then
      return json_build_object('ok', false, 'situacao', v_recusa, 'stylists', v_n);
    end if;
    v_saida := (select tipo = 'saida' from public.vessel_stylist_etapas where id = p_destino);
    -- ⚠️ O HISTÓRICO DIZ POR QUE ELAS MUDARAM (o gatilho lê estas variáveis).
    perform set_config('vessel.motivo_da_etapa', 'etapa_excluida', true);
    perform set_config('vessel.motivo_de_saida', case when v_saida then coalesce(p_motivo_id::text, '') else '' end, true);
    perform set_config('vessel.nota_de_saida', case when v_saida then coalesce(btrim(p_nota), '') else '' end, true);
    update public.vessel_stylists set etapa_id = p_destino, atualizado_em = now() where etapa_id = p_id;
    perform set_config('vessel.motivo_da_etapa', '', true);
    perform set_config('vessel.motivo_de_saida', '', true);
    perform set_config('vessel.nota_de_saida', '', true);
  end if;
  update public.vessel_stylist_etapas set ativa = false, excluida_em = now() where id = p_id;
  perform public.vessel_stylist_etapas_renumerar();
  perform public.vessel_stylist_etapas_anotar(p_id, 'excluir',
    jsonb_build_object('nome', v_e.nome, 'ordem', v_e.ordem, 'tipo', v_e.tipo),
    jsonb_build_object('destino', p_destino, 'stylists_movidas', v_n, 'motivo_id', p_motivo_id));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id, 'movidas', v_n);
end;
$function$;

-- vessel_stylist_etapa_liberar_private_edit — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_liberar_private_edit(p_id bigint, p_libera boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_e public.vessel_stylist_etapas%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_libera is null then return json_build_object('ok', false, 'situacao', 'sem_escolha'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.libera_private_edit = p_libera then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id);
  end if;
  update public.vessel_stylist_etapas set libera_private_edit = p_libera where id = p_id;
  perform public.vessel_stylist_etapas_anotar(p_id, 'libera_private_edit',
    jsonb_build_object('libera_private_edit', v_e.libera_private_edit), jsonb_build_object('libera_private_edit', p_libera));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- vessel_stylist_etapa_marcar_prospectada — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_marcar_prospectada(p_id bigint)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_e     public.vessel_stylist_etapas%rowtype;
  v_antes bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.tipo <> 'funil' then return json_build_object('ok', false, 'situacao', 'saida_nao_conta'); end if;
  if v_e.conta_como_prospectada then return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id); end if;
  select id into v_antes from public.vessel_stylist_etapas where conta_como_prospectada;
  -- Primeiro desmarca, depois marca: o índice único não aceita duas ao mesmo tempo.
  update public.vessel_stylist_etapas set conta_como_prospectada = false where conta_como_prospectada;
  update public.vessel_stylist_etapas set conta_como_prospectada = true where id = p_id;
  perform public.vessel_stylist_etapas_anotar(p_id, 'marcar_prospectada',
    jsonb_build_object('etapa_marcada', v_antes), jsonb_build_object('etapa_marcada', p_id));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- vessel_stylist_etapa_mover — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_mover(p_id bigint, p_direcao text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_ordem  int;
  v_viz    bigint;
  v_ordviz int;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_direcao not in ('subir', 'descer') then
    return json_build_object('ok', false, 'situacao', 'direcao_invalida');
  end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  perform public.vessel_stylist_etapas_renumerar();
  select ordem into v_ordem from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_ordem is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  select id, ordem into v_viz, v_ordviz from public.vessel_stylist_etapas
   where ativa and ordem = v_ordem + case when p_direcao = 'subir' then -1 else 1 end;
  if v_viz is null then return json_build_object('ok', false, 'situacao', 'no_limite'); end if;
  update public.vessel_stylist_etapas set ordem = v_ordviz where id = p_id;
  update public.vessel_stylist_etapas set ordem = v_ordem where id = v_viz;
  perform public.vessel_stylist_etapas_anotar(p_id, 'reordenar',
    jsonb_build_object('ordem', v_ordem), jsonb_build_object('ordem', v_ordviz));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- vessel_stylist_etapa_renomear — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_renomear(p_id bigint, p_nome text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome  text := btrim(coalesce(p_nome, ''));
  v_antes text;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome = '' then return json_build_object('ok', false, 'situacao', 'sem_nome'); end if;
  if length(v_nome) > 60 then return json_build_object('ok', false, 'situacao', 'nome_longo'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select nome into v_antes from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_antes is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if exists (select 1 from public.vessel_stylist_etapas
              where ativa and id <> p_id and lower(btrim(nome)) = lower(v_nome)) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  update public.vessel_stylist_etapas set nome = v_nome where id = p_id;
  perform public.vessel_stylist_etapas_anotar(p_id, 'renomear',
    jsonb_build_object('nome', v_antes), jsonb_build_object('nome', v_nome));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- vessel_stylist_etapa_tipo — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_etapa_tipo(p_id bigint, p_tipo text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tipo  text := lower(btrim(coalesce(p_tipo, '')));
  v_e     public.vessel_stylist_etapas%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_tipo not in ('funil', 'saida') then return json_build_object('ok', false, 'situacao', 'tipo_invalido'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.tipo = v_tipo then return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id); end if;
  if v_tipo = 'saida' then
    if v_e.conta_como_prospectada then
      return json_build_object('ok', false, 'situacao', 'etapa_marcada');
    end if;
    if (select count(*) from public.vessel_stylist_etapas where ativa and tipo = 'funil') <= 1 then
      return json_build_object('ok', false, 'situacao', 'ultima_do_funil');
    end if;
  end if;
  update public.vessel_stylist_etapas set tipo = v_tipo where id = p_id;
  perform public.vessel_stylist_etapas_anotar(p_id, 'tipo',
    jsonb_build_object('tipo', v_e.tipo), jsonb_build_object('tipo', v_tipo));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- vessel_stylist_motivo_ativar — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_motivo_ativar(p_id bigint, p_ativo boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m public.vessel_stylist_motivos_de_saida%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_ativo is null then return json_build_object('ok', false, 'situacao', 'sem_escolha'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id;
  if v_m.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_m.ativo = p_ativo then return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id); end if;
  if p_ativo and exists (select 1 from public.vessel_stylist_motivos_de_saida
                          where etapa_id = v_m.etapa_id and ativo and lower(btrim(nome)) = lower(btrim(v_m.nome))) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  update public.vessel_stylist_motivos_de_saida
     set ativo = p_ativo,
         ordem = case when p_ativo then (select coalesce(max(ordem), 0) + 1 from public.vessel_stylist_motivos_de_saida
                                          where etapa_id = v_m.etapa_id and ativo) else ordem end
   where id = p_id;
  perform public.vessel_stylist_motivos_renumerar(v_m.etapa_id);
  perform public.vessel_stylist_motivo_anotar(p_id, 'motivo_ativar',
    jsonb_build_object('ativo', v_m.ativo), jsonb_build_object('ativo', p_ativo));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- vessel_stylist_motivo_criar — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_motivo_criar(p_etapa_id bigint, p_nome text, p_exige_nota boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_e    public.vessel_stylist_etapas%rowtype;
  v_id   bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome = '' then return json_build_object('ok', false, 'situacao', 'sem_nome'); end if;
  if length(v_nome) > 80 then return json_build_object('ok', false, 'situacao', 'motivo_longo'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_e from public.vessel_stylist_etapas where id = p_etapa_id and ativa;
  if v_e.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_e.tipo <> 'saida' then return json_build_object('ok', false, 'situacao', 'so_saida'); end if;
  if exists (select 1 from public.vessel_stylist_motivos_de_saida
              where etapa_id = p_etapa_id and ativo and lower(btrim(nome)) = lower(v_nome)) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  insert into public.vessel_stylist_motivos_de_saida
    (etapa_id, nome, ordem, exige_nota, criado_por, criado_por_nome, alterado_por, alterado_por_nome)
  values (p_etapa_id, v_nome,
          (select coalesce(max(ordem), 0) + 1 from public.vessel_stylist_motivos_de_saida where etapa_id = p_etapa_id and ativo),
          coalesce(p_exige_nota, false), auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
          auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()))
  returning id into v_id;
  perform public.vessel_stylist_motivo_anotar(v_id, 'motivo_criar', null,
    jsonb_build_object('nome', v_nome, 'exige_nota', coalesce(p_exige_nota, false)));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id);
end;
$function$;

-- vessel_stylist_motivo_exigir_nota — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_motivo_exigir_nota(p_id bigint, p_exige boolean)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m public.vessel_stylist_motivos_de_saida%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_exige is null then return json_build_object('ok', false, 'situacao', 'sem_escolha'); end if;
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id;
  if v_m.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_m.exige_nota = p_exige then return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'id', p_id); end if;
  update public.vessel_stylist_motivos_de_saida set exige_nota = p_exige where id = p_id;
  perform public.vessel_stylist_motivo_anotar(p_id, 'motivo_exige_nota',
    jsonb_build_object('exige_nota', v_m.exige_nota), jsonb_build_object('exige_nota', p_exige));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- vessel_stylist_motivo_mover — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_motivo_mover(p_id bigint, p_direcao text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_m      public.vessel_stylist_motivos_de_saida%rowtype;
  v_viz    bigint;
  v_ordviz int;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if p_direcao not in ('subir', 'descer') then
    return json_build_object('ok', false, 'situacao', 'direcao_invalida');
  end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id and ativo;
  if v_m.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  perform public.vessel_stylist_motivos_renumerar(v_m.etapa_id);
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id;
  select id, ordem into v_viz, v_ordviz from public.vessel_stylist_motivos_de_saida
   where etapa_id = v_m.etapa_id and ativo
     and ordem = v_m.ordem + case when p_direcao = 'subir' then -1 else 1 end;
  if v_viz is null then return json_build_object('ok', false, 'situacao', 'no_limite'); end if;
  update public.vessel_stylist_motivos_de_saida set ordem = v_ordviz where id = p_id;
  update public.vessel_stylist_motivos_de_saida set ordem = v_m.ordem where id = v_viz;
  perform public.vessel_stylist_motivo_anotar(p_id, 'motivo_reordenar',
    jsonb_build_object('ordem', v_m.ordem), jsonb_build_object('ordem', v_ordviz));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- vessel_stylist_motivo_renomear — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_motivo_renomear(p_id bigint, p_nome text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_nome text := btrim(coalesce(p_nome, ''));
  v_m    public.vessel_stylist_motivos_de_saida%rowtype;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  if v_nome = '' then return json_build_object('ok', false, 'situacao', 'sem_nome'); end if;
  if length(v_nome) > 80 then return json_build_object('ok', false, 'situacao', 'motivo_longo'); end if;
  perform pg_advisory_xact_lock(hashtext('public.vessel_stylist_etapas')::bigint);
  select * into v_m from public.vessel_stylist_motivos_de_saida where id = p_id;
  if v_m.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if exists (select 1 from public.vessel_stylist_motivos_de_saida
              where etapa_id = v_m.etapa_id and ativo and id <> p_id and lower(btrim(nome)) = lower(v_nome)) then
    return json_build_object('ok', false, 'situacao', 'nome_repetido');
  end if;
  update public.vessel_stylist_motivos_de_saida set nome = v_nome where id = p_id;
  perform public.vessel_stylist_motivo_anotar(p_id, 'motivo_renomear',
    jsonb_build_object('nome', v_m.nome), jsonb_build_object('nome', v_nome));
  return json_build_object('ok', true, 'situacao', 'ok', 'id', p_id);
end;
$function$;

-- vessel_stylist_mover_de_etapa — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_mover_de_etapa(p_codigo text, p_etapa_id bigint, p_motivo_id bigint DEFAULT NULL::bigint, p_nota text DEFAULT NULL::text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_s      public.vessel_stylists%rowtype;
  v_e      public.vessel_stylist_etapas%rowtype;
  v_recusa text;
  v_saida  boolean;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_s from public.vessel_stylists where codigo = v_codigo;
  if v_s.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;
  select * into v_e from public.vessel_stylist_etapas e where e.id = p_etapa_id and e.ativa;
  if v_e.id is null then
    return json_build_object('ok', false, 'situacao', 'etapa_invalida');
  end if;
  if v_s.etapa_id = p_etapa_id then
    return json_build_object('ok', true, 'situacao', 'sem_mudanca', 'codigo', v_codigo);
  end if;
  v_recusa := public.vessel_stylist_conferir_motivo(p_etapa_id, p_motivo_id, p_nota);
  if v_recusa is not null then
    return json_build_object('ok', false, 'situacao', v_recusa, 'etapa', v_e.nome);
  end if;
  v_saida := v_e.tipo = 'saida';
  perform set_config('vessel.motivo_de_saida', case when v_saida then coalesce(p_motivo_id::text, '') else '' end, true);
  perform set_config('vessel.nota_de_saida', case when v_saida then coalesce(btrim(p_nota), '') else '' end, true);
  update public.vessel_stylists set etapa_id = p_etapa_id, atualizado_em = now() where id = v_s.id;
  perform set_config('vessel.motivo_de_saida', '', true);
  perform set_config('vessel.nota_de_saida', '', true);
  return json_build_object('ok', true, 'situacao', 'ok', 'codigo', v_codigo,
    'etapa', v_e.nome, 'libera_private_edit', v_e.libera_private_edit,
    'prospectado_em', (select prospectado_em from public.vessel_stylists where id = v_s.id));
end;
$function$;

-- vessel_stylist_registrar_contato — Stylist Circle · editar
CREATE OR REPLACE FUNCTION public.vessel_stylist_registrar_contato(p_codigo text, p_canal text, p_resultado text, p_nota text DEFAULT NULL::text, p_proxima_acao text DEFAULT NULL::text, p_proxima_acao_em date DEFAULT NULL::date)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_canal  text := lower(nullif(trim(coalesce(p_canal, '')), ''));
  v_res    text := lower(nullif(trim(coalesce(p_resultado, '')), ''));
  v_nota   text := nullif(trim(coalesce(p_nota, '')), '');
  v_s      public.vessel_stylists%rowtype;
  v_id     bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'editar') then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;
  select * into v_s from public.vessel_stylists where codigo = v_codigo;
  if v_s.id is null then return json_build_object('ok', false, 'situacao', 'nao_achei'); end if;
  if v_canal is null or v_canal not in ('whatsapp', 'ligacao', 'instagram', 'email', 'presencial') then
    return json_build_object('ok', false, 'situacao', 'canal_invalido');
  end if;
  if v_res is null or v_res not in ('sem_resposta', 'conversou', 'interesse', 'proposta', 'marcou_encontro', 'recusou') then
    return json_build_object('ok', false, 'situacao', 'resultado_invalido');
  end if;
  if v_nota is not null and length(v_nota) > 500 then
    return json_build_object('ok', false, 'situacao', 'nota_longa');
  end if;

  insert into public.vessel_stylist_contatos
    (stylist_id, canal, resultado, nota, criado_por, criado_por_nome, teste)
  values (v_s.id, v_canal, v_res, v_nota, auth.uid(),
          (select coalesce(nullif(trim(p.name), ''), p.email) from public.profiles p where p.id = auth.uid()),
          v_s.teste)
  returning id into v_id;

  -- A próxima ação escrita aqui SUBSTITUI a de hoje; vazia, a de hoje fica.
  if nullif(trim(coalesce(p_proxima_acao, '')), '') is not null then
    update public.vessel_stylists
       set proxima_acao = trim(p_proxima_acao), proxima_acao_em = p_proxima_acao_em, atualizado_em = now()
     where id = v_s.id;
  end if;

  -- ⚠️ SEM `sugestao` (24/09/2026): nenhum movimento de etapa sai de um contato.
  return json_build_object('ok', true, 'situacao', 'ok', 'id', v_id);
end;
$function$;

-- vessel_placar_do_stylist_circle — Stylist Circle · ver
CREATE OR REPLACE FUNCTION public.vessel_placar_do_stylist_circle(p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date, p_dias integer DEFAULT 14)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return public.vessel_numeros_do_stylist_circle(p_de, p_ate, p_dias, null);
end;
$function$;

-- vessel_qualificacoes_vigentes — Stylist Circle · ver
CREATE OR REPLACE FUNCTION public.vessel_qualificacoes_vigentes()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_saida json;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  select coalesce(json_agg(json_build_object(
           'codigo', x.codigo, 'nota', x.nota, 'faixa', x.faixa, 'avaliado_em', x.avaliado_em)
         order by x.codigo), '[]'::json)
    into v_saida
    from (select distinct on (q.stylist_id) s.codigo, q.nota, q.faixa, q.avaliado_em
            from public.vessel_stylist_qualificacoes q
            join public.vessel_stylists s on s.id = q.stylist_id
           where not coalesce(s.teste, false)
           order by q.stylist_id, q.avaliado_em desc, q.id desc) x;
  return v_saida;
end;
$function$;

-- vessel_scorecard_da_stylist — Stylist Circle · ver
CREATE OR REPLACE FUNCTION public.vessel_scorecard_da_stylist(p_codigo text, p_de date DEFAULT NULL::date, p_ate date DEFAULT NULL::date, p_dias integer DEFAULT 14)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_ate    date := coalesce(p_ate, 'infinity'::date);
  v_hoje   date := (now() at time zone 'America/Sao_Paulo')::date;
  v_s      public.vessel_stylists%rowtype;
  v_num    jsonb;
  v_ult    date;
  v_real   int;
  v_prox_codigo text;
  v_prox_quando timestamptz;
  v_ativou  timestamptz;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  select * into v_s from public.vessel_stylists s
   where s.codigo = v_codigo and not coalesce(s.teste, false);
  if v_s.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  v_num := public.vessel_numeros_do_stylist_circle(p_de, p_ate, p_dias, v_s.id)::jsonb;

  -- ⚠️ 24/09/2026: A ATIVAÇÃO É `vessel_stylist_ativada_em` — a mesma do
  -- placar (a etapa que libera Private Edit; sem ela, o primeiro encontro).
  v_ativou := public.vessel_stylist_ativada_em(v_s.id);

  -- ⚠️ "RECORRENTE" E "DIAS DESDE O ÚLTIMO" NÃO SÃO DO PERÍODO: são o estado
  -- dela até o fim dele. Quem fez dois encontros em agosto continua
  -- recorrente quando se olha setembro.
  select count(*)::int, max(e.realizado_em) into v_real, v_ult
    from public.vessel_private_edits e
   where e.stylist_id = v_s.id and e.status = 'realizado'
     and not coalesce(e.teste, false) and not coalesce(e.arquivada, false)
     and e.realizado_em <= v_ate;

  -- O próximo encontro MARCADO (não o planejado, não o que caiu).
  select e.codigo, e.quando into v_prox_codigo, v_prox_quando
    from public.vessel_private_edits e
   where e.stylist_id = v_s.id and e.status in ('agendado', 'confirmado', 'reagendado')
     and not coalesce(e.teste, false) and not coalesce(e.arquivada, false)
     and e.quando >= now()
   order by e.quando, e.id
   limit 1;

  return ((v_num - 'por_stylist') || jsonb_build_object(
    'ok', true, 'situacao', 'ok',
    'codigo', v_s.codigo, 'nome', v_s.nome, 'ativada_em', v_ativou,
    'private_edit_agendado_em', v_s.ativada_em,
    'ativada_por_encontro_antigo', v_s.ativada_em is not null and not exists (
      select 1 from public.vessel_stylist_etapas_historico h where h.stylist_id = v_s.id and h.liberava_private_edit),
    'realizados_desde_o_inicio', v_real,
    'recorrente', v_real >= 2,
    'ultimo_realizado_em', v_ult,
    'dias_desde_o_ultimo', case when v_ult is null then null else v_hoje - v_ult end,
    'proximo_encontro_em', v_prox_quando,
    'proximo_encontro_codigo', v_prox_codigo,
    'contatos', (select count(*)::int from public.vessel_stylist_contatos c where c.stylist_id = v_s.id),
    -- A mesma régua de `contatos_ate_ativar` do placar, só que dela: os
    -- contatos registrados ANTES da ativação.
    'contatos_antes_de_ativar', case when v_ativou is null then null else
      (select count(*)::int from public.vessel_stylist_contatos c
        where c.stylist_id = v_s.id and c.criado_em < v_ativou) end,
    -- Para a sugestão de Confiabilidade: parceira que já ativou e some.
    'contatos_sem_resposta_depois_de_ativar', case when v_ativou is null then null else
      (select count(*)::int from public.vessel_stylist_contatos c
        where c.stylist_id = v_s.id and c.resultado = 'sem_resposta'
          and c.criado_em >= v_ativou) end
  ))::json;
end;
$function$;

-- vessel_stylist_contatos — Stylist Circle · ver
CREATE OR REPLACE FUNCTION public.vessel_stylist_contatos(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_saida json;
begin
  -- Lista vazia, não erro: é um bloco dentro de uma ficha já aberta.
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then return '[]'::json; end if;
  select coalesce(json_agg(json_build_object(
           'id', c.id, 'canal', c.canal, 'resultado', c.resultado, 'nota', c.nota,
           'criado_em', c.criado_em, 'criado_por_nome', c.criado_por_nome)
         order by c.criado_em desc, c.id desc), '[]'::json)
    into v_saida
    from public.vessel_stylist_contatos c
    join public.vessel_stylists s on s.id = c.stylist_id
   where s.codigo = upper(nullif(trim(coalesce(p_codigo, '')), ''));
  return v_saida;
end;
$function$;

-- vessel_stylist_historico_de_etapas — Stylist Circle · ver
CREATE OR REPLACE FUNCTION public.vessel_stylist_historico_de_etapas(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id bigint;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  select id into v_id from public.vessel_stylists where codigo = upper(trim(coalesce(p_codigo, '')));
  return coalesce((
    select json_agg(json_build_object(
             'id', h.id, 'de', de.nome, 'para', para.nome, 'motivo', h.motivo,
             'motivo_de_saida_id', h.motivo_id, 'motivo_de_saida', m.nome, 'nota', h.nota,
             'por_nome', h.por_nome, 'em', h.em) order by h.em desc, h.id desc)
      from public.vessel_stylist_etapas_historico h
      left join public.vessel_stylist_etapas de on de.id = h.de_etapa_id
      join public.vessel_stylist_etapas para on para.id = h.para_etapa_id
      left join public.vessel_stylist_motivos_de_saida m on m.id = h.motivo_id
     where h.stylist_id = v_id), '[]'::json);
end;
$function$;

-- vessel_stylist_qualificacoes — Stylist Circle · ver
CREATE OR REPLACE FUNCTION public.vessel_stylist_qualificacoes(p_codigo text)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_saida json;
begin
  if not public.vessel_pode('atendimentos.stylist-circle', 'ver') then return '[]'::json; end if;
  select coalesce(json_agg(json_build_object(
           'id', q.id, 'carteira', q.carteira, 'portfolio', q.portfolio,
           'mobilizacao', q.mobilizacao, 'acesso', q.acesso, 'confiabilidade', q.confiabilidade,
           'nota', q.nota, 'faixa', q.faixa, 'observacao', q.observacao,
           'avaliado_em', q.avaliado_em, 'avaliado_por_nome', q.avaliado_por_nome)
         order by q.avaliado_em desc, q.id desc), '[]'::json)
    into v_saida
    from public.vessel_stylist_qualificacoes q
    join public.vessel_stylists s on s.id = q.stylist_id
   where s.codigo = upper(nullif(trim(coalesce(p_codigo, '')), ''));
  return v_saida;
end;
$function$;

-- vessel_rastreio_dos_stylists — Stylist Circle OU Material Gráfico · ver
--   COMPARTILHADA: a lista da tela Stylist Circle E a dos QR do Material Gráfico. ⚠️ Devolve também WhatsApp/Instagram/observações das parceiras — o Material Gráfico não mostra, mas recebe (o mesmo de hoje; recortar é decisão do dono).
CREATE OR REPLACE FUNCTION public.vessel_rastreio_dos_stylists(p_dias integer DEFAULT 7, p_incluir_desativadas boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_dias int := greatest(coalesce(p_dias, 7), 0);
  v_saida json;
begin
  if not (public.vessel_pode('atendimentos.stylist-circle', 'ver') or public.vessel_pode('atendimentos.material-grafico', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;

  with vendas as (select * from public.vessel_vendas_dos_encontros(v_dias))
  select coalesce(json_agg(linha order by linha ->> 'codigo'), '[]'::json)
    into v_saida
    from (
      select json_build_object(
        'codigo', s.codigo,
        'nome', s.nome,
        'cidade', s.cidade,
        -- ⚠️ 24/09/2026: a etapa é uma linha de `vessel_stylist_etapas`.
        'etapa_id', s.etapa_id,
        'etapa', et.nome,
        'etapa_tipo', et.tipo,
        'etapa_ordem', et.ordem,
        -- ⚠️ 24/09/2026 (Private Edit só com liberada, e os motivos de saída).
        'etapa_libera_private_edit', et.libera_private_edit,
        'saida_motivo_id', case when et.tipo = 'saida' then sa.motivo_id end,
        'saida_motivo', case when et.tipo = 'saida' then ms.nome end,
        'saida_nota', case when et.tipo = 'saida' then sa.nota end,
        'praca_preview', s.praca_preview,
        'ativa', s.ativa,
        'whatsapp', s.whatsapp,
        'instagram', s.instagram,
        'atuacao', s.atuacao,
        -- T11: a ficha operacional.
        'loja', s.loja,
        'origem_contato', s.origem_contato,
        'responsavel', s.responsavel,
        'prospectado_em', s.prospectado_em,
        'proxima_acao', s.proxima_acao,
        'proxima_acao_em', s.proxima_acao_em,
        'observacoes', s.observacoes,
        -- ⚠️ 24/09/2026: "sem contato ainda" — alguém vai completar.
        'sem_contato', s.sem_contato,
        -- ⚠️ 24/09/2026: a ativação é a da etapa (a mesma função do placar); o
        -- primeiro Private Edit agendado continua, com o nome dele.
        'ativada_em', public.vessel_stylist_ativada_em(s.id),
        'private_edit_agendado_em', s.ativada_em,
        'encontros_realizados', ee.realizados,
        'ultima_private_edit', ee.ultima,
        'proxima_data_permitida', ee.ultima + 45,
        'receita_dos_encontros', (select coalesce(sum(v.receita), 0) from vendas v
                                   where v.stylist_id = s.id),
        'contatos', (select count(*)::int from public.vessel_stylist_contatos c where c.stylist_id = s.id),
        'ultimo_contato_em', (select max(c.criado_em) from public.vessel_stylist_contatos c where c.stylist_id = s.id),
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
        'receita', (select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)
                      from public.vessel_pedidos p
                     where p.situacao_id = 9
                       and exists (select 1 from public.vessel_origens o
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
      join public.vessel_stylist_etapas et on et.id = s.etapa_id
      left join lateral public.vessel_stylist_saida_atual(s.id) sa on true
      left join public.vessel_stylist_motivos_de_saida ms on ms.id = sa.motivo_id
      cross join lateral (
        select count(*) filter (where e.status = 'realizado')::int as realizados,
               max(e.realizado_em) filter (where e.status = 'realizado') as ultima
          from public.vessel_private_edits e
         where e.stylist_id = s.id and not coalesce(e.teste, false)
           and not coalesce(e.arquivada, false)
      ) ee
      where not coalesce(s.teste, false)
        and (coalesce(p_incluir_desativadas, false) or coalesce(s.ativa, true))
    ) as linhas;

  return v_saida;
end;
$function$;

-- vessel_stylist_etapas — Stylist Circle OU Private Edit · ver
--   COMPARTILHADA: as etapas do funil: o Stylist Circle mostra o quadro e o Private Edit as lê para saber quais etapas liberam encontro (tela-de-private-edit.vue).
CREATE OR REPLACE FUNCTION public.vessel_stylist_etapas()
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public.vessel_pode('atendimentos.stylist-circle', 'ver') or public.vessel_pode('atendimentos.private-edit', 'ver')) then
    raise exception 'sem permissao' using errcode = '42501';
  end if;
  return coalesce((
    select json_agg(json_build_object(
             'id', e.id, 'nome', e.nome, 'ordem', e.ordem, 'tipo', e.tipo,
             'conta_como_prospectada', e.conta_como_prospectada,
             'libera_private_edit', e.libera_private_edit,
             'stylists', (select count(*)::int from public.vessel_stylists s
                           where s.etapa_id = e.id and not coalesce(s.teste, false)),
             'motivos', coalesce((
               select json_agg(json_build_object(
                        'id', m.id, 'nome', m.nome, 'ordem', m.ordem, 'ativo', m.ativo,
                        'exige_nota', m.exige_nota,
                        'stylists', (select count(*)::int from public.vessel_stylists s
                                      cross join lateral public.vessel_stylist_saida_atual(s.id) a
                                      where s.etapa_id = e.id and not coalesce(s.teste, false)
                                        and a.motivo_id = m.id))
                      order by (not m.ativo), m.ordem, m.id)
                 from public.vessel_stylist_motivos_de_saida m where m.etapa_id = e.id), '[]'::json),
             'stylists_sem_motivo', case when e.tipo = 'saida' then
               (select count(*)::int from public.vessel_stylists s
                  left join lateral public.vessel_stylist_saida_atual(s.id) a on true
                 where s.etapa_id = e.id and not coalesce(s.teste, false) and a.motivo_id is null) end,
             'alterado_em', e.alterado_em, 'alterado_por_nome', e.alterado_por_nome)
           order by e.ordem, e.id)
      from public.vessel_stylist_etapas e where e.ativa), '[]'::json);
end;
$function$;

-- ═══ PRIVATE APPOINTMENT ═══════════════════════════════════════════════════

-- vessel_situacao_do_atendimento — Private Appointment OU Private Edit · ver
--   COMPARTILHADA: a porta da presença: o Private Appointment marca veio/não veio e o Private Edit marca a presença da convidada pela MESMA porta (tela-de-private-edit.vue, marcar()). ⚠️ Hoje ela pede só VER, embora grave — mantido (não apertar além da separação por tela).
CREATE OR REPLACE FUNCTION public.vessel_situacao_do_atendimento(p_id bigint, p_situacao text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_atual public.vessel_atendimentos%rowtype;
begin
  if not (public.vessel_pode('atendimentos', 'ver') or public.vessel_pode('atendimentos.private-edit', 'ver')) then
    return json_build_object('ok', false, 'situacao', 'sem_permissao');
  end if;

  -- A lista fechada mora AQUI, e não num CHECK novo: a coluna já tem o seu, e
  -- este recorte é menor de propósito. 'solicitado' não entra — ninguém
  -- "desmarca" uma visita de volta para pedido; e 'cancelado' entra porque
  -- desistir antes da hora é diferente de faltar.
  if p_situacao is null or p_situacao not in
     ('confirmado', 'realizado', 'no_show', 'remarcado', 'cancelado') then
    return json_build_object('ok', false, 'situacao', 'situacao_invalida');
  end if;

  select * into v_atual from public.vessel_atendimentos where id = p_id;
  if v_atual.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ QA11 DO PLANO: "no-show não vira presença". Só 'realizado' carimba hora
  -- de chegada; todo o resto APAGA o carimbo. Sem isso, marcar "veio" por
  -- engano e corrigir para "não veio" deixaria a hora de chegada para trás, e o
  -- show rate contaria quem não veio.
  update public.vessel_atendimentos
     set status      = p_situacao,
         presenca_em = case when p_situacao = 'realizado'
                            then coalesce(presenca_em, now()) else null end,
         atualizado_em = now()
   where id = p_id;

  return json_build_object('ok', true, 'situacao', p_situacao,
                           'antes', v_atual.status);
end;
$function$;

-- ── 3. As políticas de leitura ──────────────────────────────────────────────
-- Tabela de UMA tela: passa a pedir a chave dela. Nenhuma tela da Central lê
-- estas cinco direto (medido em 25/09/2026: só por funções) — por isso a troca
-- não muda nada para quem usa a Central; fecha a leitura direta pelo PostgREST.
alter policy vessel_private_edits_le_central on public.vessel_private_edits
  using (public.vessel_pode('atendimentos.private-edit', 'ver'));
alter policy vessel_sessao_aberturas_le_central on public.vessel_sessao_aberturas
  using (public.vessel_pode('atendimentos.beauty-sessions', 'ver'));
alter policy vessel_stylist_aberturas_le_central on public.vessel_stylist_aberturas
  using (public.vessel_pode('atendimentos.stylist-circle', 'ver'));
-- O convite da visita (vessel_abrir_convite) e o client advisor (código CA) são
-- do Private Appointment.
alter policy vessel_convite_aberturas_le_central on public.vessel_convite_aberturas
  using (public.vessel_pode('atendimentos', 'ver'));
alter policy vessel_client_advisors_le_central on public.vessel_client_advisors
  using (public.vessel_pode('atendimentos', 'ver'));

-- A base comum fica com a família (ver o cabeçalho): só o registro do porquê.
comment on policy vessel_pessoas_le_central on public.vessel_pessoas is
  'B13: base comum do Comercial Vessel, qualquer tela (is_vessel_atendimentos). Hoje so o Private Appointment le direto; fechar nele e decisao do dono.';
comment on policy vessel_atendimentos_le_central on public.vessel_atendimentos is
  'B13: base comum do Comercial Vessel, qualquer tela (is_vessel_atendimentos). Hoje so o Private Appointment le direto; fechar nele e decisao do dono.';
comment on policy vessel_pedidos_le_central on public.vessel_pedidos is
  'B13: base comum do Comercial Vessel, qualquer tela (is_vessel_atendimentos). Hoje so o Private Appointment le direto; fechar nele e decisao do dono.';
comment on policy vessel_pedido_itens_le_central on public.vessel_pedido_itens is
  'B13: base comum do Comercial Vessel, irma de vessel_pedidos, qualquer tela (is_vessel_atendimentos). Nenhuma tela le direto hoje.';
