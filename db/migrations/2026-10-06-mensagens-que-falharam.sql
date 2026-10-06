-- 2026-10-06-mensagens-que-falharam.sql
-- A TELA DE CHECKOUTS ABANDONADOS PASSA A VER AS MENSAGENS QUE NÃO SAÍRAM.
--
-- Em 04/10/2026 a mensagem de início de checkout da Camila Altran voltou 422 do Chatwoot
-- ("Este template so pode ser enviado pelo fluxo automatico") e ficou `falhou` em
-- `mensagem_fila`. Ninguém viu em dois dias: `mensagem_fila` tem RLS sem policy (só o service
-- role lê, porque guarda telefone) e a tela só lia `checkout_abandono`.
--
-- Esta função devolve SÓ o que a faixa precisa (quem, quando, motivo) e checa a mesma permissão
-- da leitura de `checkout_abandono`. Não devolve telefone. Só lê; não grava nada.

create or replace function public.mensagens_que_falharam(p_horas int default 48)
returns table (tipo text, chave text, nome text, quando timestamptz, motivo text)
language sql
stable
security definer
set search_path = public
as $$
  select f.tipo, f.chave, f.nome, f.criado_em, f.mensagem_motivo
    from public.mensagem_fila f
   where f.mensagem_status = 'falhou'
     and f.criado_em >= now() - make_interval(hours => greatest(p_horas, 1))
     and exists (
       select 1 from public.profiles p
        where p.id = auth.uid()
          and (p.role = 'admin' or p.is_superadmin or 'abandono-carrinho' = any (p.features))
     )
  union all
  select 'abandono', c.token, c.nome, c.iniciado_em, c.mensagem_motivo
    from public.checkout_abandono c
   where c.mensagem_status = 'falhou'
     and c.iniciado_em >= now() - make_interval(hours => greatest(p_horas, 1))
     and exists (
       select 1 from public.profiles p
        where p.id = auth.uid()
          and (p.role = 'admin' or p.is_superadmin or 'abandono-carrinho' = any (p.features))
     )
  order by 4 desc;
$$;

revoke execute on function public.mensagens_que_falharam(int) from public, anon;
grant execute on function public.mensagens_que_falharam(int) to authenticated;
comment on function public.mensagens_que_falharam(int) is
  'Mensagens de WhatsApp com status falhou nas ultimas N horas (sem telefone). So com a permissao abandono-carrinho.';
