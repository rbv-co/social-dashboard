-- O CANAL PAI E A SUPERVISORA DO GRUPO (21/08/2026)
--
-- PEDIDO DO DONO: "o canal pai precisa ser o 'pai' dos times de vendas... a
-- supervisora fica a nível 'pai', gestora e vendedora fica a nível loja".
--
-- Em 20/08 o grupo nasceu como TEXTO em bling_lojas.grupo, e a justificativa
-- continua de pé: grupo novo é digitação na tela, não evento de engenharia.
-- Esta migration PRESERVA isso — criar grupo continua sendo digitar. O que muda
-- é que o texto passou a decidir ACESSO, e aí ele vira armadilha: trocar
-- "Varejo" por "Varejo Físico" em 3 dos 8 canais partiria o balde e tiraria 3
-- lojas da supervisora em silêncio. Grupo com identidade própria não parte.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. A LISTA DE GRUPOS

create table if not exists public.canais_grupos (
  id         uuid primary key default gen_random_uuid(),
  nome       text not null,
  ordem      int not null default 0,
  ativo      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- É este índice que impede "Varejo", "varejo" e "Varejo " de virarem três
-- grupos que parecem um. A mesma normalização que normalizarGrupo() já faz no
-- JavaScript, agora garantida pelo banco e não pela boa vontade da tela.
create unique index if not exists canais_grupos_nome_unico
  on public.canais_grupos (lower(btrim(nome)));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. O CANAL APONTA PRO GRUPO

alter table public.bling_lojas
  add column if not exists grupo_id uuid references public.canais_grupos(id) on delete set null;

create index if not exists bling_lojas_grupo_id_idx on public.bling_lojas (grupo_id);

-- Os grupos que JÁ existem viram linha. NÃO adivinhar grupo pelo nome do canal:
-- adivinhar por nome é o defeito já catalogado do estoque.
insert into public.canais_grupos (nome)
select distinct btrim(grupo)
  from public.bling_lojas
 where nullif(btrim(grupo), '') is not null
on conflict do nothing;

update public.bling_lojas bl
   set grupo_id = g.id
  from public.canais_grupos g
 where lower(btrim(bl.grupo)) = lower(btrim(g.nome))
   and bl.grupo_id is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. O ESPELHO DO TEXTO — dívida temporária, com data para sair
--
-- bling_lojas.grupo passa a ser CÓPIA. grupo_id é a verdade; ninguém escreve no
-- texto. Ele existe por um motivo só: no minuto do deploy há gente com a tela JÁ
-- ABERTA rodando o pacote anterior, e esse pacote lê o texto. Sem o espelho, o
-- seletor de canais dessas pessoas mostraria "Sem grupo" em tudo.
--
-- SÃO DOIS GATILHOS, e esquecer o segundo é o erro fácil: um quando o canal
-- troca de grupo, outro quando o GRUPO É RENOMEADO — que é justamente o caso que
-- motivou o cadastro existir.

create or replace function public.espelhar_grupo_do_canal()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  new.grupo := (select nome from public.canais_grupos where id = new.grupo_id);
  return new;
end;
$$;

drop trigger if exists trg_espelhar_grupo_do_canal on public.bling_lojas;
create trigger trg_espelhar_grupo_do_canal
  before insert or update of grupo_id on public.bling_lojas
  for each row execute function public.espelhar_grupo_do_canal();

create or replace function public.espelhar_rename_do_grupo()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.nome is distinct from old.nome then
    update public.bling_lojas set grupo = new.nome where grupo_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_espelhar_rename_do_grupo on public.canais_grupos;
create trigger trg_espelhar_rename_do_grupo
  after update on public.canais_grupos
  for each row execute function public.espelhar_rename_do_grupo();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. QUEM SUPERVISIONA QUAL GRUPO
--
-- MESMA FORMA de equipes_membros (vínculo · pessoa · papel · quem concedeu ·
-- quando), de propósito: é isso que faz a soma das duas origens ser uma linha de
-- SQL. concedido_por/concedido_em seguem equipes_permissoes, onde um booleano
-- perderia "quem deixou".
--
-- O check prende o papel em 'supervisora' porque é a decisão do dono: cada papel
-- tem um lugar só. Soltar é uma linha, no dia em que alguém pedir.

create table if not exists public.canais_grupos_membros (
  id            uuid primary key default gen_random_uuid(),
  grupo_id      uuid not null references public.canais_grupos(id) on delete cascade,
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  papel         text not null default 'supervisora' check (papel in ('supervisora')),
  concedido_por uuid references public.profiles(id),
  concedido_em  timestamptz not null default now(),
  unique (grupo_id, profile_id)
);

create index if not exists cgm_profile_idx on public.canais_grupos_membros (profile_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. RLS
--
-- SECURITY DEFINER pelo mesmo motivo das funções de 04/08: elas leem profiles e
-- as tabelas de vínculo de quem está perguntando, e a política que as chama pode
-- estar justamente sobre uma dessas tabelas. Sem isso a política se consulta em
-- círculo.

create or replace function public.pode_ver_grupo(p_grupo uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or exists (select 1 from public.canais_grupos_membros gm
                where gm.grupo_id = p_grupo and gm.profile_id = auth.uid());
$$;

alter table public.canais_grupos enable row level security;
alter table public.canais_grupos_membros enable row level security;

drop policy if exists canais_grupos_leitura on public.canais_grupos;
create policy canais_grupos_leitura on public.canais_grupos
  for select to authenticated using (true);

-- Escrita só de super-admin, igual à política que já protege bling_lojas.grupo.
-- É `superadmin_pela_ficha()`, não `is_superadmin()`: a segunda confere e-mail
-- contra uma lista cravada no corpo dela, que só muda por migration; a coluna
-- é o que a tela administra. Pendurar tabela nova na lista cravada recria a
-- armadilha que este projeto já pagou uma vez.
drop policy if exists canais_grupos_escrever on public.canais_grupos;
create policy canais_grupos_escrever on public.canais_grupos
  for all to authenticated
  using (public.superadmin_pela_ficha()) with check (public.superadmin_pela_ficha());

-- Ninguém deixa de enxergar o PRÓPRIO vínculo — mesma forma de membros_leitura.
drop policy if exists cgm_leitura on public.canais_grupos_membros;
create policy cgm_leitura on public.canais_grupos_membros
  for select to authenticated
  using (profile_id = auth.uid() or public.pode_ver_grupo(grupo_id));

-- A REGRA DE OURO: ninguém concede o que não tem. A gestora da loja não pode
-- criar a própria chefe, então escrever aqui é só de super-admin.
drop policy if exists cgm_escrever on public.canais_grupos_membros;
create policy cgm_escrever on public.canais_grupos_membros
  for all to authenticated
  using (public.superadmin_pela_ficha()) with check (public.superadmin_pela_ficha());
