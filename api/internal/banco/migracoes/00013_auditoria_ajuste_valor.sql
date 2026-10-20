-- +goose Up
-- Plano 04 (INTEGRACAO-CORE-2026-10), achado S1-B: o ajuste de valor do pedido 2656 (R$ 1.615, não R$ 1.900) foi
-- gravado em 12/09 e SUMIU por um DELETE avulso, sem rastro de quem nem quando (pg_stat: 1 insert, 1 delete). Esta
-- migration só ACRESCENTA a auditoria: todo insert/update/delete/truncate em bling_pedido_ajuste_valor grava uma linha
-- em audit_log (a mesma tabela dos acessos), com o usuário do banco e a linha antes/depois. Não muda dado, nem a
-- tabela, nem quem lê. Sem a tabela ou o audit_log (testes, instalação nova) não faz nada. Idempotente.
-- +goose StatementBegin
do $mig$
begin
  if to_regclass('public.bling_pedido_ajuste_valor') is null or to_regclass('public.audit_log') is null then
    raise notice 'auditoria do ajuste de valor NÃO instalada: falta bling_pedido_ajuste_valor ou audit_log';
    return;
  end if;
  set local lock_timeout = '5s';   -- reaplicar não pode prender a fila atrás de uma leitura longa
  execute $f$
create or replace function public.auditar_ajuste_valor() returns trigger
language plpgsql
security definer
set search_path = public
as $g$
begin
  insert into public.audit_log (action, detail)
  values ('ajuste_valor_' || lower(TG_OP),
          jsonb_build_object('tabela', TG_TABLE_NAME, 'por', session_user, 'papel', current_setting('role'),
                             'ip', inet_client_addr()::text, 'aplicacao', current_setting('application_name'),
                             'antes', case when TG_OP in ('UPDATE', 'DELETE') then to_jsonb(OLD) end,
                             'depois', case when TG_OP in ('INSERT', 'UPDATE') then to_jsonb(NEW) end));
  return null;
end
$g$;
$f$;
  revoke all on function public.auditar_ajuste_valor() from public;
  drop trigger if exists auditar_ajuste_valor on public.bling_pedido_ajuste_valor;
  create trigger auditar_ajuste_valor after insert or update or delete on public.bling_pedido_ajuste_valor
    for each row execute function public.auditar_ajuste_valor();
  drop trigger if exists auditar_ajuste_valor_truncate on public.bling_pedido_ajuste_valor;
  create trigger auditar_ajuste_valor_truncate after truncate on public.bling_pedido_ajuste_valor
    for each statement execute function public.auditar_ajuste_valor();
end
$mig$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
do $mig$
begin
  if to_regclass('public.bling_pedido_ajuste_valor') is not null then
    drop trigger if exists auditar_ajuste_valor on public.bling_pedido_ajuste_valor;
    drop trigger if exists auditar_ajuste_valor_truncate on public.bling_pedido_ajuste_valor;
  end if;
  drop function if exists public.auditar_ajuste_valor();
end
$mig$;
-- +goose StatementEnd
