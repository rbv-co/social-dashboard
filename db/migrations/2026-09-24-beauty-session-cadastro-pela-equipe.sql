-- A EQUIPE CADASTRA A LEAD DENTRO DA BEAUTY SESSION.
--
-- Pedido do dono em 23–24/09/2026: "só faltou a feature onde ela possa
-- cadastrar as leads, para não ter só a possibilidade de depender da lead ler o
-- QR code, e aí fazendo esse cadastro também segue a mesma dinâmica, vai para
-- base de leads/clientes, vai pra planilha, porém acredito que terá que ter uma
-- feature dentro dos eventos de beauty sessions para trackear."
--
-- As duas decisões dele, cravadas aqui:
--   · a autorização de marketing é SEMPRE gravada no cadastro pela equipe, com
--     uma versão PRÓPRIA (`equipe-beauty-session-2026-09-24`) — assim dá para
--     saber, depois, que ela não marcou a caixinha sozinha: foi a equipe;
--   · o cadastro vale até a sessão ser ARQUIVADA. Aberta ou encerrada, aceita.
--     Arquivada (ou apagada, que é não existir) recusa.
--
-- ── O MESMO CAMINHO DO QR, E NÃO UMA RECEITA NOVA ──────────────────────────
--
-- A porta nova chama o MESMO miolo da página do QR (`vessel_anotar_interesse`):
-- a mesma ficha por telefone (`vessel_pessoa_por_telefone`, que só completa o
-- que falta), a mesma origem só-acrescenta, o mesmo pedido de atendimento na
-- loja da sessão, as mesmas permissões. Duas receitas para a mesma coisa é uma
-- delas envelhecendo em silêncio — foi o que o cabeçalho da primeira migration
-- das Beauty Sessions já avisava.
--
-- O que muda é só a MARCA de quem trouxe:
--   · `vessel_origens.utm_medium = 'offline_equipe'` (o QR grava `offline_qr`);
--   · `vessel_atendimentos.origem_registro = 'beauty-session-equipe'` (o QR
--     grava `beauty-session`) — e a mesma palavra vai em `vessel_consentimentos.fonte`;
--   · e uma linha nesta tabela nova, `vessel_beauty_session_cadastros`, com
--     QUEM da equipe cadastrou.
--
-- ⚠️ NENHUMA DESSAS COLUNAS TEM `CHECK` DE LISTA FECHADA — conferido no banco
-- (`pg_constraint`) antes de escrever: `vessel_atendimentos` só tem as travas de
-- `status` e `loja`, `vessel_origens` nenhuma, `vessel_consentimentos` só a de
-- "é de alguém". A lição de `vessel_edicoes` (ação nova derrubando a transação
-- inteira) foi conferida, não suposta.
--
-- ── ⚠️ POR QUE O IP VAI NULO ───────────────────────────────────────────────
--
-- A página do QR limita a 20 pedidos por hora POR IP (`ip_hash`), e responde
-- "recebido" calada quando passa disso. A equipe cadastra do celular DELA, no
-- mesmo Wi-Fi do salão em que as clientes leem o QR. Se o cadastro da equipe
-- gravasse o `ip_hash`, vinte cadastros dela numa hora fariam o QR das clientes
-- começar a "receber" sem gravar nada — a cliente vê o obrigado e a lead some.
-- Por isso o `p_ip` do miolo vai nulo aqui, de propósito.
--
-- ── ⚠️ QUEM É "DA EQUIPE": a linha nesta tabela, não o `utm_medium` ────────
--
-- A página pública do QR recebe a origem do navegador (`p_origem`) e só crava
-- `canal` e `evento_id` por cima; um pedido forjado poderia escrever
-- `utm_medium: 'offline_equipe'` sozinho. A linha em
-- `vessel_beauty_session_cadastros` NÃO: ela só nasce por esta porta, atrás da
-- trava de editar. É ela que a Central lê para separar QR × equipe.
--
-- A planilha (que não lê esta tabela, para não depender da ordem de publicação
-- entre a migration e a edge) separa pela marca da ORIGEM. As duas regras dão o
-- mesmo número em todo cadastro de verdade: a equipe só consegue cadastrar
-- quem AINDA NÃO se identificou nesta sessão, então a primeira origem dela na
-- sessão é sempre a da equipe.
--
-- ── E O CONSERTO QUE VEIO JUNTO ────────────────────────────────────────────
--
-- `vessel_conta_das_beauty_sessions`: "Se identificaram" (`pessoas`) passa a
-- EXCLUIR a ficha de teste. Os outros números da mesma função (`pedidos`,
-- `compareceram`, `receita`) já excluíam — só este contava o teste, e a
-- conversão "leram → se identificaram" saía inflada.
--
-- E `vessel_beauty_session_apagar` passa a recusar sessão com lead
-- identificada (`tem_leads`). Antes só olhava leitura do QR; com o cadastro
-- pela equipe, uma sessão pode ter gente sem ter NENHUMA leitura, e apagá-la
-- deixaria a origem dessas pessoas apontando para uma sessão que não existe.

-- ── 1. quem da equipe cadastrou ─────────────────────────────────────────────
create table if not exists public.vessel_beauty_session_cadastros (
  id                  bigserial primary key,
  -- ⚠️ SEM `on delete cascade`: apagar a sessão com lead dentro é recusado
  -- por `vessel_beauty_session_apagar` (`tem_leads`), e a chave estrangeira é a
  -- segunda trava caso alguém apague por fora.
  codigo              text not null references public.vessel_beauty_sessions(codigo),
  -- ⚠️ COM cascade: a pessoa que pede para sair da base some daqui junto — é
  -- o que a Política de Privacidade promete.
  pessoa_id           bigint not null references public.vessel_pessoas(id) on delete cascade,
  atendimento_id      bigint references public.vessel_atendimentos(id) on delete set null,
  cadastrado_por      uuid,
  cadastrado_por_nome text,
  criado_em           timestamptz not null default now(),
  constraint vessel_beauty_session_cadastros_uma_vez unique (codigo, pessoa_id)
);

alter table public.vessel_beauty_session_cadastros enable row level security;
-- ⚠️ RLS ligada e SEM política, como as irmãs (`vessel_stylist_contatos`): só
-- as funções `security definer` leem e escrevem. E o `revoke` explícito faz a
-- leitura pela API RECUSAR em vez de devolver lista vazia calada.
revoke all on table public.vessel_beauty_session_cadastros from anon, authenticated;

comment on table public.vessel_beauty_session_cadastros is
  'Uma linha por lead que a EQUIPE cadastrou dentro de uma Beauty Session, com '
  'quem cadastrou. So nasce por vessel_beauty_session_cadastrar_lead (trava de '
  'editar). E a prova de que a lead entrou pela equipe e nao pelo QR.';

-- ── 2. a porta da equipe ────────────────────────────────────────────────────
create or replace function public.vessel_beauty_session_cadastrar_lead(
  p_codigo    text,
  p_nome      text,
  p_whatsapp  text,
  p_instagram text default null,
  p_interesse text default null
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
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
  if not public.is_vessel_atendimentos_editar() then
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

revoke all on function public.vessel_beauty_session_cadastrar_lead(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.vessel_beauty_session_cadastrar_lead(text, text, text, text, text)
  to authenticated;

comment on function public.vessel_beauty_session_cadastrar_lead(text, text, text, text, text) is
  'A equipe cadastra uma lead dentro da Beauty Session, pelo MESMO miolo do QR '
  '(vessel_anotar_interesse): ficha por telefone, origem utm_medium=offline_equipe, '
  'atendimento na loja da sessao com origem_registro=beauty-session-equipe, '
  'marketing sempre com a versao equipe-beauty-session-2026-09-24. Aceita sessao '
  'aberta ou encerrada; arquivada recusa. Trava de editar por dentro.';

-- ── 3. a lista das leads da sessão ──────────────────────────────────────────
create or replace function public.vessel_leads_da_beauty_session(p_codigo text, p_dias integer default 7)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
  v_dias   int := greatest(coalesce(p_dias, 7), 0);
  v_saida  json;
begin
  -- ⚠️ DADO PESSOAL (nome e WhatsApp), atrás da mesma trava de ver da conta.
  -- E RECUSA com erro, não com lista vazia: "ninguém se identificou" e "você
  -- não pode ver" decidem coisas opostas na tela.
  if not public.is_vessel_atendimentos() then
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

revoke all on function public.vessel_leads_da_beauty_session(text, integer)
  from public, anon, authenticated;
grant execute on function public.vessel_leads_da_beauty_session(text, integer) to authenticated;

comment on function public.vessel_leads_da_beauty_session(text, integer) is
  'As leads de uma Beauty Session (QR e equipe), sem teste: nome, WhatsApp, por '
  'onde entrou, quem da equipe cadastrou, foi a loja e comprou (mesmas reguas de '
  'vessel_conta_das_beauty_sessions). Trava de ver por dentro; recusa com 42501.';

-- ── 4. a conta, com as duas portas e sem o teste ────────────────────────────
-- ⚠️ MESMA ASSINATURA (integer, boolean): `create or replace` basta. O corpo é
-- o de `2026-09-19-vessel-beauty-sessions-lista-devolve-arquivada.sql`
-- (conferido igual ao de produção com `pg_get_functiondef` em 24/09/2026), com
-- `pessoas` trocado e DUAS chaves novas logo depois dele. Nada mais mudou.
create or replace function public.vessel_conta_das_beauty_sessions(p_dias integer DEFAULT 7, p_incluir_arquivadas boolean DEFAULT false)
 returns json
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare
  v_dias int := greatest(coalesce(p_dias, 7), 0);
  -- ⚠️ Mesmo cuidado da outra: NULL vindo de fora nao cai no default, e um
  -- `where NULL` devolveria lista vazia sem erro nenhum.
  v_incluir boolean := coalesce(p_incluir_arquivadas, false);
  v_saida json;
begin
  -- A permissão mora AQUI DENTRO, não no grant: `security definer` roda como
  -- dono, e `authenticated` é todo mundo que fez login no iamundi.
  if not public.is_vessel_atendimentos() then
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

revoke all on function public.vessel_conta_das_beauty_sessions(int, boolean)
  from public, anon, authenticated;
grant execute on function public.vessel_conta_das_beauty_sessions(int, boolean) to authenticated;

comment on function public.vessel_conta_das_beauty_sessions(int, boolean) is
  'Leituras (mesa e cartao separados), pessoas (sem teste, desde 24/09/2026), '
  'pessoas_qr e pessoas_equipe (as duas portas, que somam pessoas), pedidos, '
  'comparecimento e venda por Beauty Session. p_dias so governa a janela de venda '
  '(janela_de_venda_em_dias na resposta) — nunca filtra linha, ver filtros.js. '
  'p_incluir_arquivadas (padrao false) tira a arquivada das contas por padrao; '
  'cada linha devolvida traz ativa E arquivada. A permissao e conferida DENTRO '
  'da funcao; o grant a authenticated e so a porta, nao a tranca.';

-- ── 5. apagar recusa sessão com lead ────────────────────────────────────────
-- ⚠️ MESMA ASSINATURA (text): o corpo é o de
-- `2026-09-19-vessel-beauty-session-mexer.sql` com UMA conferência a mais,
-- depois da de leitura e antes do `delete`.
create or replace function public.vessel_beauty_session_apagar(p_codigo text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- ⚠️ MESMA EXPRESSAO E MESMA ORDEM da irma `vessel_beauty_session_encerrar`.
  v_codigo text := upper(nullif(trim(coalesce(p_codigo, '')), ''));
begin
  if not public.is_vessel_atendimentos_editar() then
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

revoke all on function public.vessel_beauty_session_apagar(text) from public, anon, authenticated;
grant execute on function public.vessel_beauty_session_apagar(text) to authenticated;
