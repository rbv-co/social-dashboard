-- Private Edit Card: a PRÓPRIA STYLIST gera o cartão, e cada leitura do QR é
-- anotada no encontro (28/09/2026, pedido do dono).
--
-- Até aqui o gerador do site (vesselbrasil.com.br/geradorprivateeditcard/)
-- pedia anfitriã/data/hora/loja digitadas à mão, e o QR levava a
-- /cp/<PRACA>/<DDMMHHMM> — nada ligava o cartão ao encontro de verdade.
-- Agora:
--   A. `vessel_card_da_stylist(p_quem)` — ela se identifica (WhatsApp, nome
--      completo ou, quando existir, e-mail) e recebe os Private Edits dela.
--   B. `vessel_leitura_do_card(p_chave)` — o QR passa a levar a CHAVE do
--      encontro (/cp/<chave>); cada leitura é anotada.
--   C. `vessel_conta_das_private_edits` devolve `leituras_do_card` (linhas) e
--      `leitoras_do_card` (pessoas distintas, por ip_hash) — só isso muda nela.
--
-- ⚠️ O SITE (outro repositório) FOI FEITO CONTRA ESTE CONTRATO, em paralelo.
-- Mudar nome de chave, de situação ou a forma do json aqui quebra o gerador
-- no ar sem erro nenhum na Central. Mude os dois lados juntos, ou não mude.
--
-- Idempotente.

-- ── 1. A TABELA DO ANTI-ABUSO DA CONSULTA ───────────────────────────────────
-- ⚠️ SÓ O HASH E O MOMENTO. Nada do que foi digitado (nome, telefone) fica
-- guardado: a tabela existe só para contar consultas por origem na última hora.
-- As linhas com mais de um dia saem na própria consulta (não servem para mais
-- nada — guardar seria juntar rastro sem motivo).
create table if not exists public.vessel_card_consultas (
  id       bigserial primary key,
  ip_hash  text not null,
  momento  timestamptz not null default now()
);
create index if not exists vessel_card_consultas_ip_momento
  on public.vessel_card_consultas (ip_hash, momento);
create index if not exists vessel_card_consultas_momento
  on public.vessel_card_consultas (momento);
alter table public.vessel_card_consultas enable row level security;
-- RLS ligada e SEM política: só as funções (security definer) mexem.
-- ⚠️ O Supabase dá tudo a anon/authenticated em tabela nova (default privileges):
-- tirar, não só confiar na RLS.
revoke all on table public.vessel_card_consultas from public, anon, authenticated;
revoke all on sequence public.vessel_card_consultas_id_seq from public, anon, authenticated;
comment on table public.vessel_card_consultas is
  'Anti-abuso de vessel_card_da_stylist: so o hash da origem e o momento. RLS ligada e SEM politica.';

-- ── 2. AS LEITURAS DO QR DO CARTÃO ──────────────────────────────────────────
create table if not exists public.vessel_private_edit_card_leituras (
  id               bigserial primary key,
  private_edit_id  bigint not null references public.vessel_private_edits(id) on delete cascade,
  momento          timestamptz not null default now(),
  ip_hash          text not null
);
create index if not exists vessel_pe_card_leituras_encontro
  on public.vessel_private_edit_card_leituras (private_edit_id, ip_hash, momento);
alter table public.vessel_private_edit_card_leituras enable row level security;
revoke all on table public.vessel_private_edit_card_leituras from public, anon, authenticated;
revoke all on sequence public.vessel_private_edit_card_leituras_id_seq from public, anon, authenticated;
comment on table public.vessel_private_edit_card_leituras is
  'Cada leitura do QR do Private Edit Card (/cp/<chave>). RLS ligada e SEM politica.';

-- ── 3. A. QUEM É A STYLIST E QUAIS SÃO OS ENCONTROS DELA ────────────────────
create or replace function public.vessel_card_da_stylist(p_quem text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_quem     text := btrim(coalesce(p_quem, ''));
  v_ip       text;
  v_recentes int;
  v_fone     text;
  v_achadas  int;
  v_sty      record;
  v_encontros json;
begin
  -- Nada digitado: responde antes de contar (não gasta a cota de ninguém).
  if v_quem = '' then
    return json_build_object('ok', false, 'situacao', 'vazio');
  end if;

  -- ⚠️ ANTI-ABUSO ANTES DE QUALQUER BUSCA: 30 consultas por hora por origem.
  -- Sem isto a função vira um oráculo de "este telefone é de uma stylist?".
  -- A consulta recusada NÃO é anotada (senão quem insiste nunca sai da trava).
  v_ip := public.vessel_hash_de_origem();
  delete from public.vessel_card_consultas where momento < now() - interval '1 day';
  select count(*) into v_recentes from public.vessel_card_consultas
   where ip_hash = v_ip and momento > now() - interval '1 hour';
  if v_recentes >= 30 then
    return json_build_object('ok', false, 'situacao', 'devagar');
  end if;
  insert into public.vessel_card_consultas (ip_hash) values (v_ip);

  -- Texto enorme não é nome de ninguém.
  if length(v_quem) > 200 then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  v_fone := public.vessel_telefone_canonico(v_quem);

  if v_fone is not null then
    -- ── por WHATSAPP ── `vessel_stylists.whatsapp` está gravado canônico
    -- (55 + DDD + número, só dígitos — medido em 28/09/2026: 29 de 29), mas a
    -- comparação passa pelos DOIS lados do canônico: linha antiga gravada com
    -- máscara casaria do mesmo jeito.
    select count(*) into v_achadas from public.vessel_stylists s
     where s.ativa and not coalesce(s.teste, false)
       and public.vessel_telefone_canonico(s.whatsapp) = v_fone;
    if v_achadas > 1 then
      return json_build_object('ok', false, 'situacao', 'varias');
    end if;
    select s.id, s.codigo, s.nome into v_sty from public.vessel_stylists s
     where s.ativa and not coalesce(s.teste, false)
       and public.vessel_telefone_canonico(s.whatsapp) = v_fone;

  elsif position('@' in v_quem) > 0 then
    -- ── por E-MAIL ── ⚠️ HOJE A STYLIST NÃO TEM E-MAIL (`vessel_stylists` não
    -- tem a coluna). Responde "não achei" em vez de adivinhar pelo nome.
    -- QUANDO A COLUNA EXISTIR, é aqui (e só aqui):
    --   select count(*) into v_achadas from public.vessel_stylists s
    --    where s.ativa and not coalesce(s.teste, false)
    --      and public.vessel_email_canonico(s.email) = public.vessel_email_canonico(v_quem);
    --   (e as mesmas duas saídas: > 1 → 'varias'; 1 → segue para os encontros)
    return json_build_object('ok', false, 'situacao', 'nao_achei');

  else
    -- ── por NOME COMPLETO ── ⚠️ IGUAL, nunca parcial/like: "Juliana" não
    -- pode devolver os encontros da Juliana Costa para quem digitou só o
    -- primeiro nome. A normalização (minúsculas, sem acento — inclusive o
    -- acento decomposto que o macOS cola —, espaços colapsados) é a MESMA
    -- `vessel_achatar_cidade` das praças: uma conta só no banco.
    select count(*) into v_achadas from public.vessel_stylists s
     where s.ativa and not coalesce(s.teste, false)
       and public.vessel_achatar_cidade(s.nome) = public.vessel_achatar_cidade(v_quem);
    if v_achadas > 1 then
      -- Duas stylists com o mesmo nome: não escolhe por ela.
      return json_build_object('ok', false, 'situacao', 'varias');
    end if;
    select s.id, s.codigo, s.nome into v_sty from public.vessel_stylists s
     where s.ativa and not coalesce(s.teste, false)
       and public.vessel_achatar_cidade(s.nome) = public.vessel_achatar_cidade(v_quem);
  end if;

  if v_sty.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ── OS ENCONTROS DELA ── ativos, não arquivados, não teste, que ainda vão
  -- acontecer: fora 'cancelado', 'realizado' e 'nao_realizado' (os valores do
  -- CHECK `vessel_private_edits_status_valido`; ficam em_planejamento,
  -- agendado, confirmado e reagendado). As 12 horas para trás deixam gerar o
  -- cartão NO DIA, com o encontro já começado.
  select coalesce(json_agg(json_build_object(
           'chave', e.chave, 'codigo', e.codigo, 'quando', e.quando,
           'loja', e.loja, 'praca', e.praca) order by e.quando, e.codigo), '[]'::json)
    into v_encontros
    from public.vessel_private_edits e
   where e.stylist_id = v_sty.id
     and e.ativa
     and not coalesce(e.arquivada, false)
     and not coalesce(e.teste, false)
     and e.status not in ('cancelado', 'realizado', 'nao_realizado')
     and e.quando >= now() - interval '12 hours';

  if json_array_length(v_encontros) = 0 then
    return json_build_object('ok', false, 'situacao', 'sem_encontro',
      'stylist', json_build_object('codigo', v_sty.codigo, 'nome', v_sty.nome));
  end if;

  return json_build_object('ok', true,
    'stylist', json_build_object('codigo', v_sty.codigo, 'nome', v_sty.nome),
    'encontros', v_encontros);
end;
$function$;

revoke all on function public.vessel_card_da_stylist(text) from public, anon, authenticated;
grant execute on function public.vessel_card_da_stylist(text) to anon;

-- ── 4. B. UMA LEITURA DO QR DO CARTÃO ───────────────────────────────────────
create or replace function public.vessel_leitura_do_card(p_chave text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_chave text := upper(btrim(coalesce(p_chave, '')));
  v_ip    text;
  v_e     record;
begin
  select e.id, e.codigo, e.quando, e.loja, e.praca, e.teste, s.nome as anfitria
    into v_e
    from public.vessel_private_edits e
    join public.vessel_stylists s on s.id = e.stylist_id
   where e.chave = v_chave and not coalesce(e.arquivada, false);

  if v_e.id is null then
    return json_build_object('ok', false, 'situacao', 'nao_achei');
  end if;

  -- ⚠️ ENCONTRO DE TESTE NÃO ANOTA (a resposta é a mesma: o site não precisa
  -- saber). E a mesma pessoa relendo o mesmo QR em menos de 10 minutos não é
  -- uma leitura nova — é a câmera que leu duas vezes, ou o voltar do navegador.
  -- ⚠️ ENCONTRO ENCERRADO (ativa = false) ANOTA: o cartão impresso continua na
  -- mão das convidadas, e ler depois do dia também é leitura.
  if not coalesce(v_e.teste, false) then
    v_ip := public.vessel_hash_de_origem();
    if not exists (select 1 from public.vessel_private_edit_card_leituras l
                    where l.private_edit_id = v_e.id and l.ip_hash = v_ip
                      and l.momento > now() - interval '10 minutes') then
      insert into public.vessel_private_edit_card_leituras (private_edit_id, ip_hash)
      values (v_e.id, v_ip);
    end if;
  end if;

  return json_build_object('ok', true, 'codigo', v_e.codigo, 'anfitria', v_e.anfitria,
    'quando', v_e.quando, 'loja', v_e.loja, 'praca', v_e.praca);
end;
$function$;

revoke all on function public.vessel_leitura_do_card(text) from public, anon, authenticated;
grant execute on function public.vessel_leitura_do_card(text) to anon;

-- ── 5. C. A CONTA DA CENTRAL GANHA AS LEITURAS DO CARTÃO ────────────────────
-- ⚠️ CORPO = O DE PRODUÇÃO (lido do banco em 28/09/2026, igual ao da T11
-- `2026-09-22-vessel-t11-bases-do-stylist-circle.sql` com a trava por tela do
-- B13) + as duas chaves novas no fim. Nada mais muda.
create or replace function public.vessel_conta_das_private_edits(p_dias integer DEFAULT 14, p_incluir_arquivadas boolean DEFAULT false)
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
        'janela_de_venda_em_dias', v_dias,
        -- 28/09/2026: o QR do Private Edit Card. LEITURAS = linhas (já sem a
        -- releitura de menos de 10 min); LEITORAS = origens distintas — é
        -- este o número que a agenda mostra.
        'leituras_do_card', (select count(*)::int from public.vessel_private_edit_card_leituras l
                               where l.private_edit_id = e.id),
        'leitoras_do_card', (select count(distinct l.ip_hash)::int from public.vessel_private_edit_card_leituras l
                               where l.private_edit_id = e.id)
      ) as linha
      from public.vessel_private_edits e
      join public.vessel_stylists s on s.id = e.stylist_id
      where not coalesce(e.teste, false)
        and (v_incluir or not coalesce(e.arquivada, false))
    ) as linhas;

  return v_saida;
end;
$function$;

-- Os mesmos grants de produção: só quem está logado (a trava por tela decide).
revoke all on function public.vessel_conta_das_private_edits(integer, boolean) from public, anon;
grant execute on function public.vessel_conta_das_private_edits(integer, boolean) to authenticated;
