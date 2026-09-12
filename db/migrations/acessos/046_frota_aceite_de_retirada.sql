-- Frota: a assinatura passa a ser de QUEM PEGA o carro.
--
-- Desenho: docs/superpowers/specs/2026-08-13-frota-gestao-reservas-design.md
--
-- ── O QUE FOI MEDIDO, e que provocou esta migration ────────────────────────
--
-- Em 13/08/2026, no banco de produção: das 5 retiradas reais, **uma** tinha
-- checklist assinado no mesmo dia. E nessa única, quem assinou foi Erick
-- Martins e quem pegou o carro foi Breno. Ou seja: **zero das 5 retiradas
-- tinham a assinatura de quem pegou o carro.**
--
-- A causa não é desleixo, é a regra: `precisaDeChecklist` (checklist.js) olha
-- só se AQUELE CARRO já tem checklist NAQUELE DIA. Se o dono do carro assinou
-- às 7h30, quem pega às 17h49 não assina nada. E a tabela `frota_checklist` tem
-- `unique (veiculo_id, feita_em)` — um checklist por carro por dia, de
-- propósito: ninguém confere o mesmo carro duas vezes no mesmo dia.
--
-- ── POR QUE UM ACEITE, E NÃO UM SEGUNDO CHECKLIST ──────────────────────────
--
-- São duas frases diferentes:
--   o checklist diz  "o carro estava assim neste dia, e fulano viu";
--   a retirada diz   "eu, fulano, recebi este carro assim e respondo por ele".
--
-- Quando é a mesma pessoa, uma frase basta — e é por isso que quem já assinou
-- o checklist de hoje NÃO é perguntado de novo. Quando é outra pessoa, falta a
-- segunda frase, e ela é curta: não repete a lista, aponta pra ficha do dia.
--
-- O DONO APROVOU ASSIM, com todas as letras: uma assinatura por viagem, e
-- NENHUM PDF a mais. O aceite vale gravado aqui — é onde a prova mora; o PDF
-- sempre foi cópia.

alter table public.frota_uso
  add column if not exists aceite_em timestamptz,
  add column if not exists aceite_por uuid references auth.users(id) on delete set null,
  -- O NOME ESCRITO, e não só o id. Pessoa de fora pega carro (é o caso do
  -- Felipe, que fez a Frota aceitar nome digitado na hora) e não tem login
  -- nenhum pra apontar. Sem esta coluna, o aceite dela não teria de quem ser.
  add column if not exists aceite_nome text,
  add column if not exists aceite_rabisco jsonb,
  -- A FICHA DO DIA que este aceite está aceitando, e o código dela CONGELADO
  -- no instante do aceite. O id sozinho não bastaria: se a ficha for alterada
  -- depois, o código muda, e o aceite passaria a apontar pra um estado do carro
  -- diferente do que a pessoa viu quando assinou. Guardando o código do
  -- momento, a divergência fica visível em vez de sumir.
  add column if not exists aceite_checklist_id uuid references public.frota_checklist(id) on delete set null,
  add column if not exists aceite_checklist_hash text;

comment on column public.frota_uso.aceite_em is
  'Quando quem pegou o carro assinou o aceite de retirada. Nulo = não houve aceite.';
comment on column public.frota_uso.aceite_checklist_hash is
  'Código da ficha do dia NO INSTANTE do aceite. Se divergir do código atual da ficha, alguém mexeu depois.';

-- ── O aceite não se desfaz ─────────────────────────────────────────────────
--
-- Mesmo princípio que já protege as respostas do checklist (033): assinatura
-- que o aplicativo pode reescrever depois não é assinatura, é rascunho. Uma vez
-- gravado, o aceite só existe — não muda e não volta a ser nulo.
-- INSERT **E** UPDATE, e isso não é excesso de zelo: o aceite nasce junto com a
-- viagem, na mesma gravação (a pessoa assina na ficha de retirada, e a linha de
-- `frota_uso` é criada ali). Um gatilho só de UPDATE deixaria o caminho normal
-- — o INSERT — passar sem carimbo nenhum de quem assinou.
create or replace function public.frota_aceite_imutavel()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  nascendo boolean := (tg_op = 'INSERT') or (old.aceite_em is null);
begin
  if tg_op = 'UPDATE' and old.aceite_em is not null and (
       new.aceite_em             is distinct from old.aceite_em
    or new.aceite_por            is distinct from old.aceite_por
    or new.aceite_nome           is distinct from old.aceite_nome
    or new.aceite_rabisco        is distinct from old.aceite_rabisco
    or new.aceite_checklist_id   is distinct from old.aceite_checklist_id
    or new.aceite_checklist_hash is distinct from old.aceite_checklist_hash) then
    raise exception 'O aceite de retirada já foi assinado e não pode ser alterado.'
      using errcode = 'check_violation';
  end if;

  if new.aceite_em is not null and nascendo then
    -- Assinar exige estar logado: aceite sem dono não prova nada. Quem não tem
    -- login continua pegando o carro normalmente — o que ele não faz é
    -- assinar, e a tela diz isso em vez de fingir que assinou.
    if auth.uid() is null then
      raise exception 'Para assinar o aceite de retirada é preciso estar logado.'
        using errcode = 'check_violation';
    end if;
    -- QUEM e QUANDO saem do servidor, nunca do que a tela mandou. O relógio do
    -- celular de quem assina não é prova de nada.
    new.aceite_por := auth.uid();
    new.aceite_em := now();
  end if;

  return new;
end $$;

drop trigger if exists trg_frota_aceite_imutavel on public.frota_uso;
create trigger trg_frota_aceite_imutavel
  before insert or update on public.frota_uso
  for each row execute function public.frota_aceite_imutavel();
