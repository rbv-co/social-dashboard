-- A CENTRAL PASSA A LER OS ATENDIMENTOS — só quem tem login E permissão
--
-- Até aqui estas tabelas tinham a trava ligada e ZERO política: ninguém lia,
-- nem logado. Era o certo enquanto só a página pública escrevia — a chave
-- anônima está dentro do HTML do site, e uma política mal escrita entregaria a
-- lista de clientes a qualquer visitante.
--
-- Agora a Central precisa ler para a Ionara e a loja trabalharem. Então entra
-- UMA frase no porteiro: "logado E com permissão de Atendimentos pode LER".
--
-- ⚠️ QUATRO COISAS QUE ESTA MIGRATION NÃO FAZ, DE PROPÓSITO:
--
-- 1. Não abre ESCRITA. Marcar presença continua passando por
--    `vessel_marcar_presenca`, que valida e decide. Política de update seria
--    uma segunda porta com regras diferentes da primeira.
-- 2. Não usa a permissão do SELO (`is_vessel_admin`, que olha 'autenticidade').
--    Quem cuida das etiquetas das bolsas não precisa ver nome e telefone de
--    cliente. São coisas diferentes e não devem andar juntas.
-- 3. Não vale para `anon`. As políticas são `to authenticated`, e a chave
--    pública do site não está logada — para ela nada muda.
-- 4. Não concede a ninguém. A permissão nasce desmarcada; o dono liga pessoa
--    por pessoa no painel de Acessos.
--
-- ⚠️ A CHAVE 'atendimentos' É A MESMA STRING EM TRÊS LUGARES: aqui, em
-- RECURSOS (controle-de-login-e-usuario.js) e na árvore de permissões.
-- Renomear num só tira o acesso nos outros, em silêncio — foi o que o
-- comentário do selo já avisava.

create or replace function public.is_vessel_atendimentos()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select 'atendimentos' = any(p.features) or p.is_superadmin
       from public.profiles p where p.id = auth.uid()),
    false);
$$;

-- ⚠️ `from public` SOZINHO NÃO FECHA `anon`: no Supabase os papéis anon e
-- authenticated recebem execute por privilégio padrão do schema, que é uma
-- concessão SEPARADA. Já custou um buraco aqui em 16/09, e a conferência desta
-- própria migration pegou o mesmo erro de novo.
revoke all on function public.is_vessel_atendimentos() from public, anon, authenticated;
grant execute on function public.is_vessel_atendimentos() to authenticated;

-- ⚠️ As políticas precisam chamar a função como o USUÁRIO que consulta — por
-- isso `authenticated` recebe execute acima. Sem esse grant, toda consulta da
-- Central falharia com "permission denied for function", e não com lista vazia.

do $$
declare t text;
begin
  foreach t in array array['vessel_pessoas', 'vessel_atendimentos',
                           'vessel_convite_aberturas', 'vessel_client_advisors',
                           'vessel_pedidos', 'vessel_pedido_itens']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_le_central', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_vessel_atendimentos())',
      t || '_le_central', t);
  end loop;
end $$;

comment on function public.is_vessel_atendimentos() is
  'Quem pode LER os atendimentos na Central: tem "atendimentos" em features[] '
  'ou e superadmin. ⚠️ A string "atendimentos" e a MESMA de RECURSOS no front — '
  'renomear num lugar so tira o acesso no outro, em silencio.';
