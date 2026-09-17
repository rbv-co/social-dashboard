-- AS CONTAS DA CLIENTE DO REGISTERED PIECES.
--
-- Desenho: docs/superpowers/specs/2026-09-17-registered-pieces-contas-design.md
--
-- ⚠️ POR QUE NÃO É O LOGIN DO SUPABASE. Medido em 17/09/2026: 49 tabelas deste
-- banco têm política aberta a QUALQUER logado (a Central e a Vessel dividem o
-- banco). Cliente logada pelo Supabase Auth leria dado interno da consultoria.
-- Aqui a cliente NUNCA é `authenticated`: ela só existe dentro destas funções,
-- que guardam o próprio token de sessão (fora do `auth.users`) e o conferem à
-- mão em cada chamada.
--
-- ⚠️ pgcrypto mora no schema `extensions`: todo `crypt`, `gen_salt`, `digest` e
-- `gen_random_bytes` vem qualificado. Sem isso, quebra com search_path=public
-- (mesma armadilha documentada em 2026-09-16-vessel-pessoas-e-atendimentos.sql,
-- coluna vessel_hash_de_origem). `gen_random_uuid()` é do core do Postgres
-- (pg_catalog) e fica sem prefixo.

create table if not exists public.vessel_clientes (
  id                  uuid primary key default gen_random_uuid(),
  nome                text not null,
  cpf                 text not null unique,          -- só dígitos
  email               text not null unique,          -- sempre minúsculo
  whatsapp            text,
  nascimento          date,
  cidade              text,
  senha_hash          text not null,
  senha_trocada_em    timestamptz,
  email_confirmado_em timestamptz,
  bling_contato_id    bigint,
  pessoa_id           bigint,
  teste               boolean not null default false,
  criado_em           timestamptz not null default now(),
  atualizado_em       timestamptz not null default now()
);

create table if not exists public.vessel_sessoes (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.vessel_clientes(id) on delete cascade,
  token_hash    text not null unique,
  criada_em     timestamptz not null default now(),
  expira_em     timestamptz not null,
  ultimo_uso_em timestamptz,
  agente        text,
  ip_hash       text,
  encerrada_em  timestamptz
);
create index if not exists vessel_sessoes_cliente_idx on public.vessel_sessoes (cliente_id);

create table if not exists public.vessel_tentativas_de_login (
  id      bigserial primary key,
  chave   text not null,          -- login normalizado
  quando  timestamptz not null default now(),
  acertou boolean not null
);
create index if not exists vessel_tentativas_login_idx
  on public.vessel_tentativas_de_login (chave, quando desc);

-- ── trava de linha ───────────────────────────────────────────────────────────
-- ⚠️ CONFERIDO CONTRA AS IRMÃS (vessel_pecas, vessel_registros, ambas em
-- 2026-08-05-vessel-painel.sql): RLS ligada, UMA política, só de SELECT, para
-- `authenticated`, gateada por is_vessel_admin() — é o que deixa o painel
-- Autenticidade ler, e o nome segue o mesmo padrão delas (`<tabela>_read`).
-- Escrita, zero: só por função security definer. Sem essa trava, uma tabela
-- nova nasce sem política e cai na regra geral do projeto — que aqui vazaria
-- CPF, e-mail e telefone de cliente para qualquer `authenticated`.
alter table public.vessel_clientes            enable row level security;
alter table public.vessel_sessoes             enable row level security;
alter table public.vessel_tentativas_de_login enable row level security;

drop policy if exists vessel_clientes_read on public.vessel_clientes;
create policy vessel_clientes_read on public.vessel_clientes
  for select to authenticated using (public.is_vessel_admin());

-- vessel_sessoes e vessel_tentativas_de_login ficam SEM política nenhuma, de
-- propósito: nem o painel precisa, e token de sessão não se lê em tela.

drop trigger if exists vessel_clientes_atualizado on public.vessel_clientes;
create trigger vessel_clientes_atualizado
  before update on public.vessel_clientes
  for each row execute function public.vessel_toca_atualizado_em();

-- ── ajudantes ────────────────────────────────────────────────────────────────

create or replace function public.vessel_cpf_digitos(p_bruto text)
returns text language sql immutable as $$
  select nullif(regexp_replace(coalesce(p_bruto, ''), '\D', '', 'g'), '');
$$;

-- ── criar perfil ─────────────────────────────────────────────────────────────

create or replace function public.vessel_conta_criar(
  p_nome text, p_cpf text, p_email text, p_whatsapp text,
  p_nascimento date, p_senha text
) returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_cpf   text := public.vessel_cpf_digitos(p_cpf);
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id    uuid;
begin
  if v_cpf is null or length(v_cpf) <> 11 then
    return json_build_object('ok', false, 'motivo', 'cpf_invalido');
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return json_build_object('ok', false, 'motivo', 'email_invalido');
  end if;
  if coalesce(trim(p_nome), '') = '' then
    return json_build_object('ok', false, 'motivo', 'nome_vazio');
  end if;
  -- ⚠️ NASCIMENTO É OBRIGATÓRIO, e não é burocracia: na venda a loja quase
  -- nunca consegue tirar todos os dados, e o registro é o momento em que a
  -- própria cliente completa o cadastro (decisão do dono, 06/09 e 17/09/2026).
  if p_nascimento is null
     or p_nascimento > current_date
     or p_nascimento < current_date - interval '120 years' then
    return json_build_object('ok', false, 'motivo', 'nascimento_invalido');
  end if;
  if exists (select 1 from public.vessel_clientes
              where cpf = v_cpf or email = v_email) then
    return json_build_object('ok', false, 'motivo', 'ja_existe');
  end if;

  -- ⚠️ CORRIDA ENTRE O EXISTS() E O INSERT: duplo clique, ou duas abas abertas
  -- ao mesmo tempo, passam pelo exists() acima antes de qualquer um dos dois
  -- ter inserido — e o segundo insert bate na unique de cpf/email como erro
  -- cru do Postgres (`unique_violation`), não como o {ok:false} que a edge
  -- espera. Este bloco pega esse erro e devolve a MESMA resposta do exists().
  begin
    insert into public.vessel_clientes (nome, cpf, email, whatsapp, nascimento, senha_hash)
    values (trim(p_nome), v_cpf, v_email, p_whatsapp, p_nascimento,
            extensions.crypt(p_senha, extensions.gen_salt('bf', 10)))
    returning id into v_id;
  exception
    when unique_violation then
      return json_build_object('ok', false, 'motivo', 'ja_existe');
  end;

  return json_build_object('ok', true, 'cliente_id', v_id, 'email', v_email);
end;
$$;

-- ── entrar ───────────────────────────────────────────────────────────────────

create or replace function public.vessel_conta_entrar(
  p_login text, p_senha text, p_lembrar boolean,
  p_agente text default null, p_ip_hash text default null
) returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_login  text := lower(trim(coalesce(p_login, '')));
  v_cpf    text := public.vessel_cpf_digitos(p_login);
  -- ⚠️ A CHAVE DO TETO TEM DE SER A MESMA PARA A MESMA CONTA, em qualquer
  -- formato que a cliente digitar o CPF. '390.533.447-05', '39053344705' e
  -- '390-533-447.05' são O MESMO CPF, mas três strings diferentes — contando
  -- por v_login cru, cada formato ganhava sua própria cota de 5 tentativas, e
  -- a trava de "5 erros em 15 minutos" virava, na prática, "5 erros por
  -- formato de CPF digitado". A chave usada para CONTAR, para GRAVAR o erro e
  -- para GRAVAR o acerto é sempre a mesma: o CPF normalizado quando o login
  -- veio como CPF (11 dígitos), e o e-mail normalizado nos outros casos.
  v_chave  text := case when v_cpf is not null and length(v_cpf) = 11
                        then v_cpf else v_login end;
  v_c      record;
  v_erros  int;
  v_token  text;
  v_expira timestamptz;
begin
  -- ⚠️ O TETO É POR LOGIN E VEM ANTES DE QUALQUER COMPARAÇÃO DE SENHA: sem ele
  -- esta função vira um chutador de senhas com a chave anônima na mão.
  select count(*) into v_erros from public.vessel_tentativas_de_login
   where chave = v_chave and acertou = false and quando > now() - interval '15 minutes';
  if v_erros >= 5 then
    return json_build_object('ok', false, 'motivo', 'muitas_tentativas');
  end if;

  select * into v_c from public.vessel_clientes
   where email = v_login or cpf = v_cpf limit 1;

  if v_c.id is null then
    -- ⚠️ CANAL DE TEMPO: sem isto, "conta não existe" responde na hora (nunca
    -- chega a rodar o bcrypt) e "senha errada" responde devagar (rodou o
    -- bcrypt de verdade contra o hash da cliente) — e só o TEMPO da resposta
    -- já entrega quem é cliente da marca, sem nenhuma mensagem diferente na
    -- tela. Rodar o mesmo `crypt` contra um hash de descarte fixo (nunca
    -- gravado, de ninguém) e jogar o resultado fora deixa as duas respostas
    -- com o mesmo custo.
    perform extensions.crypt(p_senha,
      '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');
    insert into public.vessel_tentativas_de_login (chave, acertou) values (v_chave, false);
    return json_build_object('ok', false, 'motivo', 'senha_errada');
  end if;

  if v_c.senha_hash <> extensions.crypt(p_senha, v_c.senha_hash) then
    insert into public.vessel_tentativas_de_login (chave, acertou) values (v_chave, false);
    return json_build_object('ok', false, 'motivo', 'senha_errada');
  end if;

  insert into public.vessel_tentativas_de_login (chave, acertou) values (v_chave, true);

  v_token  := encode(extensions.gen_random_bytes(32), 'hex');
  v_expira := now() + case when coalesce(p_lembrar, false) then interval '90 days'
                           else interval '12 hours' end;
  insert into public.vessel_sessoes (cliente_id, token_hash, expira_em, agente, ip_hash)
  values (v_c.id, encode(extensions.digest(v_token, 'sha256'), 'hex'),
          v_expira, left(coalesce(p_agente, ''), 300), p_ip_hash);

  return json_build_object('ok', true, 'token', v_token, 'expira_em', v_expira,
                           'nome', v_c.nome, 'cliente_id', v_c.id);
end;
$$;

-- ── quem é a sessão ──────────────────────────────────────────────────────────

create or replace function public.vessel_conta_da_sessao(p_token text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_s record; v_c record;
begin
  select * into v_s from public.vessel_sessoes
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
     and encerrada_em is null and expira_em > now();
  if v_s.id is null then return json_build_object('ok', false); end if;

  update public.vessel_sessoes set ultimo_uso_em = now() where id = v_s.id;
  select * into v_c from public.vessel_clientes where id = v_s.cliente_id;
  return json_build_object('ok', true, 'cliente_id', v_c.id, 'nome', v_c.nome,
                           'email', v_c.email, 'whatsapp', v_c.whatsapp,
                           'cpf_fim', right(v_c.cpf, 2));
end;
$$;

create or replace function public.vessel_conta_sair(p_token text, p_todas boolean default false)
returns json language plpgsql security definer set search_path to 'public' as $$
declare v_s record;
begin
  select * into v_s from public.vessel_sessoes
   where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex');
  if v_s.id is null then return json_build_object('ok', true); end if;
  if coalesce(p_todas, false) then
    update public.vessel_sessoes set encerrada_em = now()
     where cliente_id = v_s.cliente_id and encerrada_em is null;
  else
    update public.vessel_sessoes set encerrada_em = now() where id = v_s.id;
  end if;
  return json_build_object('ok', true);
end;
$$;

-- ── esqueci a senha ──────────────────────────────────────────────────────────
-- ⚠️ A RESPOSTA É IGUAL EXISTINDO OU NÃO O PERFIL. Diferenciar transformaria a
-- página num confirmador de quem é cliente da marca.
--
-- ⚠️ NÃO "CONSERTAR" O E-MAIL REAL NO RETORNO ABAIXO. Esta função é
-- concedida SÓ a `service_role` (ver o portão no fim do arquivo) — quem a
-- chama é a edge, nunca a página direto. É a edge que usa o e-mail devolvido
-- aqui para SABER PARA ONDE MANDAR o link de troca de senha, e é ela quem
-- responde à página só com `{ok:true}`, sem e-mail nenhum. A página nunca
-- enxerga esta diferença. Trocar por um retorno "cego" aqui quebraria o envio
-- do link (decisão registrada na correção da Tarefa 3, rodada 1).

create or replace function public.vessel_conta_nova_senha(p_login text, p_senha text)
returns json language plpgsql security definer set search_path to 'public' as $$
declare
  v_login text := lower(trim(coalesce(p_login, '')));
  v_cpf   text := public.vessel_cpf_digitos(p_login);
  v_c     record;
begin
  select * into v_c from public.vessel_clientes
   where email = v_login or cpf = v_cpf limit 1;
  if v_c.id is null then
    return json_build_object('ok', true, 'email', null);   -- resposta idêntica
  end if;

  update public.vessel_clientes
     set senha_hash = extensions.crypt(p_senha, extensions.gen_salt('bf', 10)),
         senha_trocada_em = now()
   where id = v_c.id;
  -- a senha nova derruba as sessões abertas: se alguém entrou, perde o acesso
  update public.vessel_sessoes set encerrada_em = now()
   where cliente_id = v_c.id and encerrada_em is null;

  return json_build_object('ok', true, 'email', v_c.email);
end;
$$;

-- ── editar os próprios dados ─────────────────────────────────────────────────
-- ⚠️ CPF NÃO MUDA AQUI: é a prova de compra. Só a equipe altera, pelo painel.

create or replace function public.vessel_conta_editar(
  p_token text, p_nome text default null, p_whatsapp text default null,
  p_senha_atual text default null, p_senha_nova text default null
) returns json language plpgsql security definer set search_path to 'public' as $$
declare v_sessao json; v_id uuid; v_c record;
begin
  v_sessao := public.vessel_conta_da_sessao(p_token);
  if not (v_sessao ->> 'ok')::boolean then
    return json_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;
  v_id := (v_sessao ->> 'cliente_id')::uuid;

  if p_senha_nova is not null then
    select * into v_c from public.vessel_clientes where id = v_id;
    if v_c.senha_hash <> extensions.crypt(coalesce(p_senha_atual, ''), v_c.senha_hash) then
      return json_build_object('ok', false, 'motivo', 'senha_atual_errada');
    end if;
    if length(coalesce(p_senha_nova, '')) < 8 then
      return json_build_object('ok', false, 'motivo', 'senha_curta');
    end if;
    update public.vessel_clientes
       set senha_hash = extensions.crypt(p_senha_nova, extensions.gen_salt('bf', 10)),
           senha_trocada_em = now()
     where id = v_id;
  end if;

  update public.vessel_clientes
     set nome = coalesce(nullif(trim(coalesce(p_nome, '')), ''), nome),
         whatsapp = coalesce(nullif(trim(coalesce(p_whatsapp, '')), ''), whatsapp)
   where id = v_id;

  return json_build_object('ok', true);
end;
$$;

-- ── o portão ─────────────────────────────────────────────────────────────────
-- ⚠️ `revoke from public` NÃO fecha `anon`/`authenticated`: os papéis herdam
-- direito próprio (a mesma lição de "Grant não é o portão", já custou uma
-- função de administração executável por qualquer logado em 30/08/2026).
-- Revogar dos três, um a um, e conceder só a service_role (que é quem a edge
-- usa) — nenhuma destas seis funções fica alcançável pela chave anônima que
-- mora dentro do HTML da página pública.
do $$
declare f text;
begin
  foreach f in array array[
    'vessel_conta_criar(text,text,text,text,date,text)',
    'vessel_conta_entrar(text,text,boolean,text,text)',
    'vessel_conta_da_sessao(text)',
    'vessel_conta_sair(text,boolean)',
    'vessel_conta_nova_senha(text,text)',
    'vessel_conta_editar(text,text,text,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
