-- LOTE DE TESTE para a validação do dono (Tarefa 10, Fase 1 de contas do
-- Selo Vessel). Ele precisa de 3 peças de mentira, marcadas como TESTE, para
-- percorrer sozinho o roteiro descrito em verify/novo/LEIA-ME.txt sem tocar
-- em nenhuma peça de verdade.
--
-- ⚠️ MEDIDO NO BANCO (17/09/2026): `vessel_lotes` NÃO tem coluna para marcar
-- teste. Esta migration cria `teste boolean not null default false` — o
-- PADRÃO É FALSE, ao contrário da marca de `vessel_pessoas`/`vessel_atendimentos`
-- (2026-09-17-vessel-fase-de-testes.sql, que usa `default true`): aqui quem
-- decide é sempre uma migration ou o próprio SKU escolhido no painel, nunca
-- uma porta pública gravando sem pensar — então o valor seguro por omissão é
-- "isto é um lote de verdade".
--
-- Filtrar o painel e os relatórios por esta coluna FICA PARA A FASE 2. Esta
-- migration só cria a coluna, o índice e a marcação automática por SKU; nada
-- aqui muda o que já é mostrado hoje.
--
-- ══════════════════════════════════════════════════════════════════════════
-- ⚠️ O LOTE DE TESTE NÃO NASCE NESTA MIGRATION — RODADA DE CORREÇÃO 1
-- ══════════════════════════════════════════════════════════════════════════
--
-- A primeira versão deste arquivo chamava `vessel_gerar_lote` de dentro de um
-- `do $$ ... $$`, emprestando a identidade de um super-admin via
-- `set_config('request.jwt.claims', ...)` para passar pelo portão de
-- `is_vessel_admin()`. MEDIDO: `vessel_gerar_lote` e `vessel_criar_pecas` são
-- `security definer` E gateadas por `is_vessel_admin()` de propósito — e uma
-- migration sem sessão real tomaria "sem_permissao".
--
-- Contornar isso fingindo sessão é o problema, não a solução: este projeto já
-- pagou caro por trava de segurança desarmada "só para o teste" (ver o
-- histórico de `vessel_criar_pecas` em
-- 2026-08-30-vessel-zz-fecha-o-portao-e-garantias.sql, sobre um portão que
-- ficou aberto meia hora em produção). Uma migration com
-- `set_config('request.jwt.claims', ...)` no repositório vira exemplo pronto
-- para o próximo golpe de "é só para o teste" — e essa próxima vez pode não
-- ser dentro de uma transação que desfaz o empréstimo sozinha.
--
-- O CAMINHO CERTO: quem cria o lote de teste é o DONO, pelo painel que já
-- existe ("Autenticidade e Garantia" → aba Lotes), logado como superadmin de
-- verdade. É o caminho de produção, com a trava funcionando do começo ao
-- fim — e de quebra já serve de teste do próprio painel de gerar lote. O
-- roteiro para o dono fazer isso está em verify/novo/LEIA-ME.txt (passo 0).

alter table public.vessel_lotes
  add column if not exists teste boolean not null default false;

comment on column public.vessel_lotes.teste is
  'Lote de ensaio (não uma peça de verdade). Marcado sozinho quando o SKU '
  'começa com TESTE- (ver trg_vessel_lotes_marcar_teste). Filtrar painel e '
  'relatórios por esta coluna é trabalho da Fase 2 — ainda não filtram.';

create index if not exists vessel_lotes_teste_idx
  on public.vessel_lotes (teste) where teste;

-- ── A MARCAÇÃO SOZINHA, PELO PREFIXO DO SKU ────────────────────────────────
--
-- Como o lote nasce pelo painel (`vessel_gerar_lote`, que não conhece a
-- coluna `teste`), alguém precisaria lembrar de marcar a linha à mão depois —
-- e "lembrar depois" é exatamente o tipo de passo que se esquece uma vez e
-- vira lote de teste contado como venda de verdade num relatório da Fase 2.
--
-- TRIGGER, e não um `update` de uma vez só: isto tem que valer para TODO lote
-- de teste que nascer daqui pra frente (o de hoje e os próximos, sempre que
-- alguém repetir o teste), não só para a linha que existir no momento em que
-- esta migration rodar. Um `update` cobriria só o passado.
--
-- O contrato com o dono, escrito em verify/novo/LEIA-ME.txt: para gerar um
-- lote de teste pelo painel, o SKU tem que começar com `TESTE-`. É a única
-- coisa que ele precisa lembrar; o resto (marcar `teste = true`) é sozinho.
create or replace function public.vessel_lotes_marcar_teste()
returns trigger
language plpgsql
as $$
begin
  if left(upper(coalesce(new.sku, '')), 6) = 'TESTE-' then
    new.teste := true;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_vessel_lotes_marcar_teste on public.vessel_lotes;
create trigger trg_vessel_lotes_marcar_teste
  before insert on public.vessel_lotes
  for each row
  execute function public.vessel_lotes_marcar_teste();
