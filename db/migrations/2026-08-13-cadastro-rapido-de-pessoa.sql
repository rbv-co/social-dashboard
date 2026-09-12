-- Cadastro rápido de colaborador nos campos de pessoa do Patrimônio e da Frota.
-- Desenho: docs/superpowers/specs/2026-08-13-cadastro-rapido-de-pessoa-design.md
--
-- POR QUE ESTE ARQUIVO EXISTE: em 13/08/2026 o dono pediu para cadastrar na hora
-- o colaborador que ainda não existe, sem sair do formulário do bem ou do carro.
-- Ao medir, apareceu um defeito maior por trás: Gabriel Alves, Guilherme Cardoso
-- e Jeremias Vieira mexem na Frota e enxergam ZERO colaboradores e ZERO setores,
-- porque `acessos_pessoas` e `acessos_setores` só abrem para is_acessos_admin().
-- Para os três, o campo "Responsável — de quem é o carro" já está vazio hoje.
--
-- A SAÍDA ESCOLHIDA foi a PORTA ESTREITA: nenhuma policy é afrouxada. Quem mexe
-- em Patrimônio/Frota passa por estas funções, que entregam nome, cargo,
-- situação e o elo com o login — e NUNCA e-mail, celular ou conta Apple.

-- ── Quem pode ───────────────────────────────────────────────────────────────
-- Uma função só, para a regra não divergir entre os quatro lugares que a usam.
create or replace function public.pode_cadastrar_pessoa_rapida()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.is_acessos_admin(), false)
      or coalesce(public.is_patrimonio_admin(), false)
      or coalesce(public.is_frota_admin(), false);
$$;

revoke execute on function public.pode_cadastrar_pessoa_rapida() from public;
revoke execute on function public.pode_cadastrar_pessoa_rapida() from anon;
grant  execute on function public.pode_cadastrar_pessoa_rapida() to authenticated;

-- ── Ler os nomes ────────────────────────────────────────────────────────────
-- ESTOURA em vez de devolver lista vazia. Vazio silencioso é o defeito que já
-- mostrou R$ 0,00 na tela do dono por 17 horas: "não tenho acesso" e "não tem
-- ninguém cadastrado" não podem chegar iguais na tela.
create or replace function public.pessoas_para_escolher()
returns table(id uuid, nome text, status text, cargo text, profile_id uuid)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.pode_cadastrar_pessoa_rapida() then
    raise exception 'Sem acesso à lista de colaboradores' using errcode = '42501';
  end if;
  return query
    select p.id, p.nome, p.status, p.cargo, p.profile_id
      from public.acessos_pessoas p
     order by p.nome;
end;
$$;

revoke execute on function public.pessoas_para_escolher() from public;
revoke execute on function public.pessoas_para_escolher() from anon;
grant  execute on function public.pessoas_para_escolher() to authenticated;

create or replace function public.setores_para_escolher()
returns table(id uuid, nome text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.pode_cadastrar_pessoa_rapida() then
    raise exception 'Sem acesso à lista de setores' using errcode = '42501';
  end if;
  return query
    select s.id, s.nome from public.acessos_setores s order by s.ordem, s.nome;
end;
$$;

revoke execute on function public.setores_para_escolher() from public;
revoke execute on function public.setores_para_escolher() from anon;
grant  execute on function public.setores_para_escolher() to authenticated;

-- ── Criar o colaborador que faltou ──────────────────────────────────────────
-- NOME REPETIDO NÃO ENTRA, e a checagem mora AQUI e não só na tela: duas
-- pessoas cadastrando em janelas diferentes é justamente o caso que a tela
-- sozinha não cobre.
--
-- `acessos_pessoas.nome` NÃO ganha unique de propósito: um dia pode existir
-- homônimo de verdade, e uma trava dura impediria o cadastro legítimo. Quem
-- precisa do homônimo cria pela tela de Colaboradores, decidindo com calma.
-- Por isso a trava aqui é uma FILA por nome (advisory lock da transação): duas
-- chamadas simultâneas com o mesmo nome entram uma de cada vez, e a segunda
-- encontra o que a primeira criou em vez de criar a segunda linha.
create or replace function public.criar_pessoa_rapida(
  p_nome     text,
  p_cargo    text default null,
  p_marca_id uuid default null,
  p_setor_id uuid default null)
returns table(id uuid, nome text, status text, cargo text, profile_id uuid, ja_existia boolean)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_nome   text := btrim(coalesce(p_nome, ''));
  v_cargo  text := nullif(btrim(coalesce(p_cargo, '')), '');
  v_achada public.acessos_pessoas%rowtype;
begin
  if not public.pode_cadastrar_pessoa_rapida() then
    raise exception 'Sem acesso para cadastrar colaborador' using errcode = '42501';
  end if;
  if v_nome = '' then
    raise exception 'Digite o nome antes de criar.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('pessoa-rapida:' || lower(v_nome)));

  select * into v_achada
    from public.acessos_pessoas p
   where lower(btrim(p.nome)) = lower(v_nome)
   limit 1;

  if found then
    return query select v_achada.id, v_achada.nome, v_achada.status,
                        v_achada.cargo, v_achada.profile_id, true;
    return;
  end if;

  return query
    insert into public.acessos_pessoas (nome, cargo, marca_id, setor_id)
    values (v_nome, v_cargo, p_marca_id, p_setor_id)
    returning acessos_pessoas.id, acessos_pessoas.nome, acessos_pessoas.status,
              acessos_pessoas.cargo, acessos_pessoas.profile_id, false;
end;
$$;

revoke execute on function public.criar_pessoa_rapida(text, text, uuid, uuid) from public;
revoke execute on function public.criar_pessoa_rapida(text, text, uuid, uuid) from anon;
grant  execute on function public.criar_pessoa_rapida(text, text, uuid, uuid) to authenticated;

-- ── Criar o setor que faltou ────────────────────────────────────────────────
-- `acessos_setores.nome` já é unique; devolver o que existe evita o erro cru do
-- banco chegar à tela ("duplicate key value violates...").
create or replace function public.criar_setor_rapido(p_nome text)
returns table(id uuid, nome text, ja_existia boolean)
language plpgsql volatile security definer set search_path = public
as $$
declare
  v_nome   text := btrim(coalesce(p_nome, ''));
  v_achado public.acessos_setores%rowtype;
begin
  if not public.pode_cadastrar_pessoa_rapida() then
    raise exception 'Sem acesso para cadastrar setor' using errcode = '42501';
  end if;
  if v_nome = '' then
    raise exception 'Digite o nome antes de criar.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('setor-rapido:' || lower(v_nome)));

  select * into v_achado
    from public.acessos_setores s
   where lower(btrim(s.nome)) = lower(v_nome)
   limit 1;

  if found then
    return query select v_achado.id, v_achado.nome, true;
    return;
  end if;

  return query
    insert into public.acessos_setores (nome, ordem)
    values (v_nome, coalesce((select max(ordem) from public.acessos_setores), 0) + 1)
    returning acessos_setores.id, acessos_setores.nome, false;
end;
$$;

revoke execute on function public.criar_setor_rapido(text) from public;
revoke execute on function public.criar_setor_rapido(text) from anon;
grant  execute on function public.criar_setor_rapido(text) to authenticated;

-- MARCA não precisa de função nova: patrimonio_empresas já tem
-- `patrimonio_empresas_leitura_frota` e `patrimonio_empresas_criar_frota`, além
-- da policy do Patrimônio. Quem mexe em qualquer um dos dois já lê e cria marca.
