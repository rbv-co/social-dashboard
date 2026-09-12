-- Frota: reserva encerrada pode sair da tela SEM sair do banco.
--
-- Desenho: docs/superpowers/specs/2026-08-19-frota-gestao-refino-design.md (D4)
--
-- O PEDIDO DO DONO (19/08/2026): "solicitações recusadas eu quero poder excluir
-- para limpar espaço".
--
-- POR QUE ARQUIVAR E NÃO APAGAR — decisão dele, na mesma conversa, depois de eu
-- mostrar o que se perderia. Uma reserva recusada guarda QUEM pediu, QUEM
-- recusou e POR QUÊ ("Duplicado", no caso real). Apagar limpa a tela e destrói
-- a única resposta que existe pra "por que negaram o carro pra mim em agosto?".
-- Esta ferramenta nasceu pra ser o histórico que a pasta de papéis nunca teve;
-- apagar seria a folha sumindo da gaveta de novo.
--
-- ── O QUE ESTA MIGRATION *NÃO* PRECISOU FAZER, e por que fica escrito ───────
--
-- Não há `grant` aqui. A regra decorada desta central é "coluna nova precisa de
-- GRANT próprio, senão a linha inteira cai" — ela vem do `accounts`, e lá é
-- verdade. Medido em 19/08 antes de escrever:
--
--   accounts           relacl anon=awdDxtm  (SEM o `r`)  · 12 colunas com ACL própria
--   frota_requisicoes  relacl anon=arwdDxtm              ·  0 colunas com ACL própria
--
-- Em `accounts` o SELECT é concedido COLUNA A COLUNA, e por isso uma coluna
-- nova sem grant derruba a leitura da linha toda. Em `frota_requisicoes` o
-- grant é DA TABELA, e coluna nova herda sozinha. Escrever um `grant` aqui por
-- decoreba não seria inofensivo: passaria a existir ACL de coluna nesta tabela,
-- e aí a próxima coluna nova PASSARIA a precisar de grant — eu teria criado a
-- armadilha que vim evitar.
--
-- ── A TRAVA MORA NO BANCO ───────────────────────────────────────────────────
--
-- A tela só oferece "Arquivar" no que está encerrado. Isso é conveniência, não
-- garantia: invariante que importa se guarda no banco, do mesmo jeito que a
-- 023 (frota_checar_decisao) e a 029 (frota_fechar_posse_orfa) fazem. Sem o
-- gatilho, uma reserva PENDENTE poderia ser arquivada por qualquer caminho que
-- não fosse a tela — e sumiria da fila de aprovação sem ter sido decidida, que
-- é a pior coisa que pode acontecer com um pedido.

-- ── 1. As duas colunas ──────────────────────────────────────────────────────
alter table public.frota_requisicoes
  add column if not exists arquivada_em  timestamptz,
  add column if not exists arquivada_por uuid references auth.users(id);

comment on column public.frota_requisicoes.arquivada_em is
  'Quando saiu da lista. Nulo = aparece normalmente. Só reserva encerrada '
  '(recusada/cancelada/revogada) pode ser arquivada — ver frota_checar_arquivamento.';
comment on column public.frota_requisicoes.arquivada_por is
  'Quem arquivou. Preenchido pelo gatilho, nunca pela tela.';

-- ── 2. O gatilho ────────────────────────────────────────────────────────────
create or replace function public.frota_checar_arquivamento()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Só age quando o arquivamento muda. Um update que mexe noutra coisa passa
  -- reto — senão esta função viraria pedágio de toda edição de reserva.
  if new.arquivada_em is not distinct from old.arquivada_em then
    return new;
  end if;

  if not public.pode_aprovar_frota() then
    raise exception 'Você não pode arquivar reserva de veículo. Peça a quem aprova.'
      using errcode = 'check_violation';
  end if;

  if new.arquivada_em is not null then
    -- ARQUIVANDO. A situação é lida de `new` e não de `old` de propósito: assim
    -- recusar e arquivar podem acontecer no MESMO update sem o gatilho reclamar
    -- de uma situação que já mudou nesta mesma transação.
    if new.situacao not in ('recusada', 'cancelada', 'revogada') then
      raise exception
        'Só reserva encerrada pode ser arquivada. Esta está %, e pedido em aberto não some da lista.',
        new.situacao
        using errcode = 'check_violation';
    end if;
    new.arquivada_por := auth.uid();
  else
    -- DESARQUIVANDO: volta pra lista, e o rastro de quem tinha arquivado sai
    -- junto. Deixá-lo apontaria pra uma ação que não vale mais.
    new.arquivada_por := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_frota_checar_arquivamento on public.frota_requisicoes;
create trigger trg_frota_checar_arquivamento
  before update on public.frota_requisicoes
  for each row
  execute function public.frota_checar_arquivamento();

-- ── 3. O índice ─────────────────────────────────────────────────────────────
-- A tela lê SEMPRE filtrando por "não arquivada". Parcial porque o normal é a
-- coluna ser nula: indexar as arquivadas seria indexar a minoria que quase
-- ninguém consulta.
create index if not exists idx_frota_requisicoes_nao_arquivadas
  on public.frota_requisicoes (veiculo_id)
  where arquivada_em is null;
