-- Frota: quem administra passa a poder EDITAR, CANCELAR e REVOGAR uma reserva —
-- e, pela primeira vez, isso deixa rastro.
--
-- Desenho: docs/superpowers/specs/2026-08-13-frota-gestao-reservas-design.md
--
-- O PEDIDO DO DONO (13/08/2026): "na aba gestão precisa mostrar o histórico de
-- reservas feitas com o admin podendo editar, revogar e cancelar cada uma
-- delas".
--
-- ── O BURACO QUE ESTA MIGRATION FECHA, e que ninguém tinha visto ────────────
--
-- Hoje a política de RLS desta tabela é:
--
--     create policy frota_req_atualizar on public.frota_requisicoes for update
--       using (public.is_frota_admin()) with check (public.is_frota_admin());
--
-- ou seja, QUALQUER pessoa com acesso à Frota pode alterar QUALQUER reserva —
-- mudar a data, trocar o carro, reescrever o destino da viagem de outra pessoa.
-- O gatilho da 023 só barrava a mudança para 'aprovada'/'recusada'. O
-- comentário de lá dizia "atualizar passa pelo gatilho acima, que é quem decide
-- o que pode mudar" — e o gatilho não decidia: ele olhava a situação e nada
-- mais. Está assim desde que a tabela nasceu, em 04/08/2026.
--
-- Não dava pra abrir "editar" na tela sem fechar isto antes: um botão novo
-- transformaria um buraco teórico em caminho de uso.
--
-- ── POR QUE O RASTRO É GATILHO, E NÃO A TELA ───────────────────────────────
--
-- Rastro que depende de o aplicativo lembrar de gravar é rastro que a próxima
-- tela esquece. Esta ferramenta existe pra ser o histórico que a pasta de
-- papéis nunca teve — o registro de quem mudou o quê tem de nascer no mesmo
-- lugar em que a mudança acontece.

-- ── 1. A situação nova: 'revogada' ─────────────────────────────────────────
--
-- CANCELAR e REVOGAR são coisas diferentes, e a diferença é do dono (escolhida
-- por ele em 13/08/2026):
--   cancelada — a reserva ainda NÃO tinha começado. Desmarcou-se.
--   revogada  — a reserva JÁ estava valendo (ou já virou viagem), e alguém
--               tirou o direito no meio do caminho.
--
-- Duas palavras, e não uma com um campo "tipo": quem lê o histórico seis meses
-- depois lê a palavra, não a coluna auxiliar.
alter table public.frota_requisicoes
  drop constraint if exists frota_requisicoes_situacao_check;
alter table public.frota_requisicoes
  add constraint frota_requisicoes_situacao_check
  check (situacao in ('pendente','aprovada','recusada','cancelada','revogada','usada'));

-- ── 2. Quem encerrou, quando e por quê ─────────────────────────────────────
--
-- Colunas PRÓPRIAS, e não reaproveitar `decidida_por`/`motivo_decisao`.
-- Decidir e encerrar são dois momentos: uma reserva pode ser aprovada pela
-- Juliana na segunda e revogada pelo dono na quarta, e o papel tem de continuar
-- dizendo as duas coisas. Reaproveitar a coluna apagaria quem aprovou.
alter table public.frota_requisicoes
  add column if not exists encerrada_por uuid references auth.users(id) on delete set null,
  add column if not exists encerrada_em timestamptz,
  add column if not exists encerrada_motivo text;

comment on column public.frota_requisicoes.encerrada_motivo is
  'Por que a reserva foi cancelada ou revogada. Obrigatório — o gatilho recusa vazio.';

-- ── 3. O rastro de cada mudança ────────────────────────────────────────────
create table if not exists public.frota_requisicoes_historico(
  id uuid primary key default gen_random_uuid(),
  requisicao_id uuid not null references public.frota_requisicoes(id) on delete cascade,
  -- Uma linha POR CAMPO alterado, não uma linha por gravação com um JSON
  -- dentro. Quem lê o histórico quer "a data mudou de X pra Y", e isso é uma
  -- frase — não um objeto pra alguém decifrar na tela.
  campo text not null,
  de text,
  para text,
  motivo text,
  quem uuid references auth.users(id) on delete set null,
  quando timestamptz not null default now()
);
create index if not exists idx_frota_req_hist_requisicao
  on public.frota_requisicoes_historico(requisicao_id, quando desc);

alter table public.frota_requisicoes_historico enable row level security;

do $$ begin
  -- SÓ LEITURA, e para quem tem a Frota. Ninguém escreve aqui pela mão: quem
  -- escreve é o gatilho, que roda como dono da tabela. Histórico que o
  -- aplicativo pode editar não é histórico.
  if not exists (select 1 from pg_policies
                  where tablename='frota_requisicoes_historico' and policyname='frota_req_hist_ler') then
    create policy frota_req_hist_ler on public.frota_requisicoes_historico
      for select using (public.is_frota_admin());
  end if;
end $$;

create or replace function public.frota_gravar_historico()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  quem_mudou uuid := auth.uid();
  -- O motivo escrito nesta gravação acompanha TODAS as linhas dela: quem
  -- revoga uma reserva e de quebra corrige o destino fez as duas coisas pelo
  -- mesmo motivo, e separar isso daria a impressão de duas decisões.
  o_motivo text := coalesce(new.encerrada_motivo, new.motivo_decisao);
  -- Data e hora saem no formato de quem vai LER, não no ISO cru do banco.
  -- Brasília o ano inteiro: o Brasil não tem mais horário de verão.
  fmt constant text := 'DD/MM/YYYY HH24:MI';
begin
  if new.veiculo_id is distinct from old.veiculo_id then
    insert into public.frota_requisicoes_historico(requisicao_id, campo, de, para, motivo, quem)
    values (new.id, 'carro',
            (select v.nome from public.frota_veiculos v where v.id = old.veiculo_id),
            (select v.nome from public.frota_veiculos v where v.id = new.veiculo_id),
            o_motivo, quem_mudou);
  end if;
  if new.pessoa_nome is distinct from old.pessoa_nome then
    insert into public.frota_requisicoes_historico(requisicao_id, campo, de, para, motivo, quem)
    values (new.id, 'quem vai dirigir', old.pessoa_nome, new.pessoa_nome, o_motivo, quem_mudou);
  end if;
  if new.retirada_prevista is distinct from old.retirada_prevista then
    insert into public.frota_requisicoes_historico(requisicao_id, campo, de, para, motivo, quem)
    values (new.id, 'retirada',
            to_char(old.retirada_prevista at time zone 'America/Sao_Paulo', fmt),
            to_char(new.retirada_prevista at time zone 'America/Sao_Paulo', fmt),
            o_motivo, quem_mudou);
  end if;
  if new.devolucao_prevista is distinct from old.devolucao_prevista then
    insert into public.frota_requisicoes_historico(requisicao_id, campo, de, para, motivo, quem)
    values (new.id, 'devolução',
            to_char(old.devolucao_prevista at time zone 'America/Sao_Paulo', fmt),
            to_char(new.devolucao_prevista at time zone 'America/Sao_Paulo', fmt),
            o_motivo, quem_mudou);
  end if;
  if new.destino is distinct from old.destino then
    insert into public.frota_requisicoes_historico(requisicao_id, campo, de, para, motivo, quem)
    values (new.id, 'destino', old.destino, new.destino, o_motivo, quem_mudou);
  end if;
  if new.finalidade is distinct from old.finalidade then
    insert into public.frota_requisicoes_historico(requisicao_id, campo, de, para, motivo, quem)
    values (new.id, 'finalidade', old.finalidade, new.finalidade, o_motivo, quem_mudou);
  end if;
  if new.departamento is distinct from old.departamento then
    insert into public.frota_requisicoes_historico(requisicao_id, campo, de, para, motivo, quem)
    values (new.id, 'departamento', old.departamento, new.departamento, o_motivo, quem_mudou);
  end if;
  if new.observacao is distinct from old.observacao then
    insert into public.frota_requisicoes_historico(requisicao_id, campo, de, para, motivo, quem)
    values (new.id, 'observação', old.observacao, new.observacao, o_motivo, quem_mudou);
  end if;
  if new.situacao is distinct from old.situacao then
    insert into public.frota_requisicoes_historico(requisicao_id, campo, de, para, motivo, quem)
    values (new.id, 'situação', old.situacao, new.situacao, o_motivo, quem_mudou);
  end if;
  return null;   -- AFTER trigger: o retorno não é usado.
end $$;

drop trigger if exists trg_frota_gravar_historico on public.frota_requisicoes;
create trigger trg_frota_gravar_historico
  after update on public.frota_requisicoes
  for each row execute function public.frota_gravar_historico();

-- ── 4. O portão: quem pode mexer no quê ────────────────────────────────────
--
-- Substitui a função da 023/040 mantendo tudo o que ela já fazia (aprovar e
-- recusar seguem exigindo `frota.aprovar`, e seguem gravando `decidida_por` e
-- `decidida_em`) e acrescentando os três caminhos novos.
create or replace function public.frota_checar_decisao()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  mudou_conteudo boolean;
begin
  -- DECIDIR: aprovar ou recusar. Igual à 040, sem mudança nenhuma.
  if new.situacao is distinct from old.situacao
     and new.situacao in ('aprovada','recusada') then

    if not public.pode_aprovar_frota() then
      raise exception 'Você não tem permissão para aprovar requisições de veículo.'
        using errcode = 'check_violation';
    end if;

    new.decidida_por := auth.uid();
    new.decidida_em := now();
  end if;

  -- ENCERRAR: cancelar ou revogar.
  if new.situacao is distinct from old.situacao
     and new.situacao in ('cancelada','revogada') then

    if not public.pode_aprovar_frota() then
      raise exception 'Você não pode cancelar nem revogar reserva de veículo. Peça a quem aprova.'
        using errcode = 'check_violation';
    end if;

    -- MOTIVO OBRIGATÓRIO, e no banco. Reserva que some sem explicação é
    -- exatamente o que a pasta de papéis fazia: a folha sumia da gaveta e
    -- ninguém sabia dizer por quê. Quem for ler isto daqui a seis meses
    -- precisa da frase, não do carimbo.
    if coalesce(btrim(new.encerrada_motivo), '') = '' then
      raise exception 'Escreva o motivo do cancelamento ou da revogação.'
        using errcode = 'check_violation';
    end if;

    new.encerrada_por := auth.uid();
    new.encerrada_em := now();
  end if;

  -- EDITAR o conteúdo do pedido.
  mudou_conteudo :=
       new.veiculo_id         is distinct from old.veiculo_id
    or new.pessoa_id          is distinct from old.pessoa_id
    or new.pessoa_nome        is distinct from old.pessoa_nome
    or new.departamento       is distinct from old.departamento
    or new.destino            is distinct from old.destino
    or new.finalidade         is distinct from old.finalidade
    or new.retirada_prevista  is distinct from old.retirada_prevista
    or new.devolucao_prevista is distinct from old.devolucao_prevista
    or new.observacao         is distinct from old.observacao;

  if mudou_conteudo then
    if not public.pode_aprovar_frota() then
      raise exception 'Você não pode alterar reserva de veículo. Peça a quem aprova.'
        using errcode = 'check_violation';
    end if;

    -- Reserva encerrada não se edita. O histórico tem de continuar dizendo o
    -- que foi combinado — corrigir o passado é justamente o que uma ferramenta
    -- de prova não pode deixar acontecer.
    if old.situacao not in ('pendente','aprovada') then
      raise exception 'Esta reserva já está %. Reserva encerrada não se edita.', old.situacao
        using errcode = 'check_violation';
    end if;

    -- E reserva que já virou viagem também não: o carro já saiu, e mudar o
    -- pedido depois faria o papel discordar do que aconteceu.
    if old.uso_id is not null then
      raise exception 'Esta reserva já virou viagem. Não dá pra mudar o pedido depois que o carro saiu.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

-- O gatilho não muda de forma; recriado por garantia, pelo mesmo motivo da 040:
-- as migrations precisam poder rodar em qualquer ordem num banco novo.
drop trigger if exists trg_frota_checar_decisao on public.frota_requisicoes;
create trigger trg_frota_checar_decisao
  before update on public.frota_requisicoes
  for each row execute function public.frota_checar_decisao();
