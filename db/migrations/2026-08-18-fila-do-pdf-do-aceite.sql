-- B14 · O ACEITE DE RETIRADA PASSA A VIRAR PAPEL NO ZOHO.
--
-- Desde 13/08/2026 quem pega um carro conferido por OUTRA pessoa assina um
-- aceite, que fica gravado em `frota_uso` com o rabisco e o código da ficha de
-- vistoria congelado. O papel não existia — foi decisão consciente na época
-- ("uma assinatura por viagem e nenhum PDF a mais"), e o dono mudou de ideia em
-- 18/08: precisa virar PDF e ir para o Zoho WorkDrive.
--
-- ESTE ARQUIVO É A CÓPIA FIEL da fila do checklist (`frota_checklist_pdf`), de
-- propósito: mesma forma, mesmas situações, mesma trava de dono. Quem já entende
-- uma entende a outra, e a Edge Function processa as duas com o mesmo código.
--
-- ⚠️ MEDIDO EM 18/08/2026: **não existe nenhum aceite assinado** (0 de 12 linhas
--    de `frota_uso`). Esta fila nasce vazia e continua vazia até alguém assinar o
--    primeiro. Isso é esperado, não é defeito.

create table if not exists public.frota_uso_pdf (
  id          uuid primary key default gen_random_uuid(),
  -- Um aceite, um papel. O UNIQUE é o que faz o gatilho poder ser burro e o
  -- `on conflict do nothing` resolver corrida sem duplicar arquivo no Zoho.
  uso_id      uuid not null unique references public.frota_uso(id) on delete cascade,
  situacao    text not null default 'na_fila'
              check (situacao in ('na_fila','enviando','enviado','falhou')),
  tentativas  integer not null default 0,
  ultimo_erro text,
  tentado_em  timestamptz,
  zoho_file_id text,
  criado_em   timestamptz not null default now(),
  enviado_em  timestamptz
);

comment on table public.frota_uso_pdf is
  'Fila dos PDFs do aceite de retirada, arquivados no Zoho WorkDrive. Espelha frota_checklist_pdf.';

alter table public.frota_uso_pdf enable row level security;

-- A MESMA TRAVA DA FILA DO CHECKLIST: só quem administra a Frota vê e mexe. A
-- Edge Function usa a chave de serviço e não passa por aqui.
drop policy if exists frota_uso_pdf_ler      on public.frota_uso_pdf;
drop policy if exists frota_uso_pdf_escrever on public.frota_uso_pdf;
create policy frota_uso_pdf_ler      on public.frota_uso_pdf for select using (is_frota_admin());
create policy frota_uso_pdf_escrever on public.frota_uso_pdf for all    using (is_frota_admin());

-- ── O gatilho ───────────────────────────────────────────────────────────────
--
-- A REGRA QUE MANDA, e é a mesma do checklist: **a assinatura nunca espera pela
-- fila.** Se pôr na fila falhar, o aceite já está gravado e válido; o erro vira
-- aviso no log e a viagem segue. Fila é papel, não é prova.
create or replace function public.frota_uso_enfileirar_pdf()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.aceite_em is null then
    return null;
  end if;
  -- Só na PRIMEIRA vez que o aceite aparece. Sem isto, qualquer update na linha
  -- (a volta do carro, o hodômetro) tentaria enfileirar de novo.
  if tg_op = 'UPDATE' and old.aceite_em is not null then
    return null;
  end if;

  begin
    insert into public.frota_uso_pdf(uso_id) values (new.id)
    on conflict (uso_id) do nothing;
  exception when others then
    raise warning 'Frota: nao consegui por o aceite % na fila do PDF (%). O aceite foi gravado assim mesmo.',
      new.id, sqlerrm;
  end;
  return null;
end $function$;

drop trigger if exists trg_frota_uso_enfileirar_pdf on public.frota_uso;
create trigger trg_frota_uso_enfileirar_pdf
  after insert or update of aceite_em on public.frota_uso
  for each row execute function public.frota_uso_enfileirar_pdf();
