-- 2026-10-08-trava-cruzada-de-mensagens.sql
-- TRAVA CRUZADA do abandono: nenhuma mensagem automática (inicio / 24 h / follow-up / pedido) sai se o mesmo
-- telefone (fone11) já recebeu OUTRA mensagem automática nas últimas `p_horas` (padrão 20 h), de qualquer tipo.
-- As dedupes que já existem são por tipo (mensagem_fila (tipo,chave), 12 h no inicio, 7 dias no abandono); esta
-- cruza os tipos e os dois lugares onde a mensagem é registrada: `mensagem_fila` e `checkout_abandono`.
-- Só LEITURA, sem tabela nova: segura em tabela viva. Quem barra é a rodada (marca `ignorada_trava_cruzada`).
create or replace function public.recebeu_mensagem_automatica(p_telefone text, p_horas int default 20)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.fone11(p_telefone) <> '' and (
    exists (select 1 from public.mensagem_fila f
             where f.mensagem_status = 'enviada' and public.fone11(f.telefone) = public.fone11(p_telefone)
               and f.mensagem_enviada_em > now() - make_interval(hours => p_horas))
    or exists (select 1 from public.checkout_abandono c
                where c.mensagem_status = 'enviada' and public.fone11(c.telefone) = public.fone11(p_telefone)
                  and c.mensagem_enviada_em > now() - make_interval(hours => p_horas)));
$$;

revoke all on function public.recebeu_mensagem_automatica(text, int) from public, anon, authenticated;
grant execute on function public.recebeu_mensagem_automatica(text, int) to service_role;
