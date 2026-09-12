-- A pessoa consegue apagar a PRÓPRIA marca de "precisa trocar a senha".
--
-- O DEFEITO QUE ISTO CONSERTA (13/08/2026): `profiles` tem uma única política de
-- UPDATE — `admin_update_profiles`, com `get_my_role() = 'admin'`. Quem não é
-- admin não escreve na própria linha. E o PostgREST devolve SUCESSO SEM ERRO
-- quando nenhuma linha casa com a política. Então a tela de troca obrigatória
-- gravava zero linhas, achava que tinha dado certo, fechava o modal — e no login
-- seguinte cobrava de novo. Duas pessoas do time de vendas trocaram a senha
-- todos os dias sem nunca sair dessa parede. (A senha trocava de verdade:
-- auth.updateUser é outra API. Só a marca de "já fez" não gravava.)
--
-- POR QUE NÃO UMA POLÍTICA DE "CADA UM EDITA SEU PERFIL": os gatilhos que já
-- existem (guard_profiles, impedir_autopromocao) barram só `role` e
-- `is_superadmin`. Uma política ampla deixaria a pessoa gravar `features` na
-- própria linha — e o `bling-proxy` libera Vendas para quem tem
-- features: ['sales']. Seria trocar um incômodo por uma porta aberta.
--
-- Esta função sabe fazer UMA coisa: apagar essa marca, na linha de quem chamou.
-- Não recebe parâmetro, então não há como apontá-la para outra pessoa.
create or replace function public.marcar_senha_trocada()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  linhas int;
begin
  if auth.uid() is null then
    return false;   -- sem sessão não há o que marcar
  end if;
  update public.profiles set precisa_trocar_senha = false where id = auth.uid();
  get diagnostics linhas = row_count;
  return linhas > 0;
end;
$function$;

-- Ninguém anônimo executa. Só quem está logado, e só para si mesmo.
revoke all on function public.marcar_senha_trocada() from public;
revoke all on function public.marcar_senha_trocada() from anon;
grant execute on function public.marcar_senha_trocada() to authenticated;
