-- 2026-10-09-trava-cruzada-considera-enviando.sql
-- TRAVA CRUZADA x DISPARO IMEDIATO. `recebeu_mensagem_automatica` só olha linhas `enviada`. Com o disparo imediato, duas
-- rodadas concorrentes que pegam linhas DIFERENTES do mesmo telefone (ex.: `inicio` e `followup`, ou o abandono 24 h) veem
-- "não recebeu" (a outra ainda é `enviando`) e AMBAS enviam. `candidatos_da_fila` só protege linhas do MESMO tipo.
--
-- Esta migration NÃO altera nem derruba nada que existe: cria `avaliar_trava_cruzada`, função nova que a edge passa a
-- chamar. `recebeu_mensagem_automatica` continua como está (ela é reaproveitada aqui). Só LEITURA de dados, sem tabela nova.
--
-- Resultado (text): 'barrar'  = o telefone já recebeu outra automática na janela (comportamento de sempre);
--                   'esperar' = há OUTRA linha `enviando` do mesmo telefone (reservada há < 10 min) com prioridade sobre a de
--                               quem pergunta: a rodada devolve a linha à fila sem gastar tentativa (se a outra enviar, a
--                               próxima rodada recebe 'barrar'; se falhar, recebe 'liberar');
--                   'liberar' = pode enviar.
-- PRIORIDADE entre duas `enviando` (determinística, para as duas rodadas nunca esperarem uma pela outra): o `pedido`
-- sempre vence (é transacional); senão vence quem foi reservado primeiro (mensagem_reservada_em, depois tipo, depois chave).
-- Quem pergunta é identificado por (p_tipo, p_chave): 'inicio'|'followup'|'pedido' em mensagem_fila, 'abandono' = token em
-- checkout_abandono. Linha desconhecida conta como reservada agora (a mais nova: espera).
-- `pg_advisory_xact_lock` por telefone serializa as consultas do mesmo telefone durante a avaliação.
create or replace function public.avaliar_trava_cruzada(
  p_telefone text, p_horas int default 20, p_tipo text default null, p_chave text default null
) returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_fone  text := public.fone11(p_telefone);
  v_minha timestamptz;
begin
  if v_fone = '' then return 'liberar'; end if;
  perform pg_advisory_xact_lock(hashtext('trava_cruzada:' || v_fone));

  if public.recebeu_mensagem_automatica(p_telefone, p_horas) then return 'barrar'; end if;

  if p_tipo = 'abandono' then
    select c.mensagem_reservada_em into v_minha from public.checkout_abandono c where c.token = p_chave;
  elsif p_tipo is not null then
    select f.mensagem_reservada_em into v_minha from public.mensagem_fila f where f.tipo = p_tipo and f.chave = p_chave;
  end if;
  v_minha := coalesce(v_minha, now());

  if exists (
       select 1 from public.mensagem_fila o
        where o.mensagem_status = 'enviando' and o.mensagem_reservada_em > now() - interval '10 minutes'
          and public.fone11(o.telefone) = v_fone
          and not (o.tipo is not distinct from p_tipo and o.chave is not distinct from p_chave)
          and (o.tipo = 'pedido' or (o.mensagem_reservada_em, o.tipo, o.chave) < (v_minha, coalesce(p_tipo, ''), coalesce(p_chave, ''))))
     or exists (
       select 1 from public.checkout_abandono o
        where o.mensagem_status = 'enviando' and o.mensagem_reservada_em > now() - interval '10 minutes'
          and public.fone11(o.telefone) = v_fone
          and not (p_tipo = 'abandono' and o.token = p_chave)
          and (o.mensagem_reservada_em, 'abandono', o.token) < (v_minha, coalesce(p_tipo, ''), coalesce(p_chave, '')))
  then
    return 'esperar';
  end if;
  return 'liberar';
end;
$$;

revoke all on function public.avaliar_trava_cruzada(text, int, text, text) from public, anon, authenticated;
grant execute on function public.avaliar_trava_cruzada(text, int, text, text) to service_role;
