-- 055 — A CONTA PRECISA SABER QUE ESTÁ DESATIVADA (21/09/2026)
--
-- A 054 fez "Desativado" fechar o acesso de verdade, inclusive a leitura do
-- próprio perfil — que é o que derruba as 46 políticas que consultam
-- `profiles` direto.
--
-- Efeito colateral medido na hora: o aplicativo pergunta o perfil e recebe
-- LISTA VAZIA. E lista vazia, para ele, é a mesma coisa que "perfil não
-- cadastrado" — um caso que EXISTE e é legítimo: em 21/09 duas contas reais
-- (Gabriel Alves e Marcio Franco) entram sem linha em `profiles` e recebem o
-- Banco de Arquivos pelo valor padrão do código. Tratar as duas situações como
-- uma só tiraria o acesso deles sem ninguém ter pedido — e diria "sua conta foi
-- desativada" para quem não foi.
--
-- Esta função é a segunda pergunta, e a única que a conta desativada consegue
-- responder sobre si mesma: **"eu fui desativado?"**. Ela não devolve nome,
-- papel, permissão nem a existência de mais ninguém — só sim ou não sobre quem
-- está perguntando.

create or replace function public.minha_conta_esta_desativada()
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select coalesce(p.disabled, false) from public.profiles p where p.id = auth.uid()),
    false);
$function$;

comment on function public.minha_conta_esta_desativada() is
  'Sim ou não sobre a PRÓPRIA conta. É o que separa "desativado" de "sem perfil" quando a leitura de profiles volta vazia.';

-- Sem login não há pergunta a fazer: `auth.uid()` é nulo e a função responde
-- falso. O acesso é dado a `authenticated` apenas.
revoke all on function public.minha_conta_esta_desativada() from public;
grant execute on function public.minha_conta_esta_desativada() to authenticated;
