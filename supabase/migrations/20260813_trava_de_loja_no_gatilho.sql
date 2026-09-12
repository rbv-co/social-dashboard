-- Impede que um admin tire a PROPRIA trava de loja (`escopo_por_equipe`).
-- Aplicado em producao em 2026-08-13 (projeto kounqtdoioootxqegkij).
--
-- O BURACO:
-- o gatilho `impedir_autopromocao` (migration 20260727) fechou o caminho de
-- alguem se promover sozinho, mas comparava old x new de DUAS colunas so:
-- `is_superadmin` e `role`. A coluna `escopo_por_equipe` -- que e o que
-- limita a pessoa a ver o faturamento apenas da loja dela -- ficou de fora.
--
-- Como a policy `admin_update_profiles` deixa qualquer admin dar PATCH em
-- qualquer perfil (inclusive no dele), um admin limitado a uma loja podia
-- desligar a propria trava e passar a ver o faturamento de todas.
--
-- E a MESMA classe do buraco de 27/07: mudar o proprio nivel de acesso.
-- Na tela ja estava travado (so super-admin ve a caixinha, em Permissoes >
-- CANAIS DE VENDA), mas tela e conforto, nao tranca: quem abre o console
-- fala direto com o banco.
--
-- POR QUE NAO DEU PRA RESOLVER SO COM RLS: mesma razao de 27/07 -- o
-- `WITH CHECK` de uma policy so enxerga a linha NOVA, e aqui e preciso
-- comparar com a antiga. Por isso a trava e gatilho BEFORE UPDATE.
--
-- O TAMANHO REAL DISTO, medido no banco em 13/08/2026 antes de mexer:
-- 18 perfis; 9 admins (3 super-admins); 3 pessoas limitadas a uma loja.
-- Das tres, duas sao `viewer` -- e viewer nem chega a dar PATCH em perfil,
-- porque a policy exige admin. Sobra UMA pessoa que era admin e limitada
-- ao mesmo tempo (caio.dias@). Ou seja: o buraco alcancava uma conta.
--
-- O QUE ESTA MUDANCA NAO FAZ:
--   - nao mexe em quem edita o perfil dos OUTROS. Um admin continua podendo
--     ligar e desligar a trava de loja de outra pessoa: e o trabalho normal
--     do painel Admin > Usuarios.
--   - nao mexe no `guard_profiles`, o outro gatilho da tabela (protege o
--     perfil do erick@ e so deixa super-admin trocar cargo).
--   - super-admin (funcao is_superadmin(), lista fixa de e-mails) segue
--     passando livre, e o service_role tambem: nele `auth.uid()` e nulo,
--     entao a condicao "a linha e a minha" nunca da verdadeira.
--
-- VALIDADO ANTES DE APLICAR, contra o banco de producao, dentro de uma
-- transacao desfeita no fim (nada ficou gravado), simulando o JWT das
-- contas reais:
--   - caio.dias@ tirando a PROPRIA trava        -> BLOQUEADO (42501);
--   - caio.dias@ tirando a trava de OUTRA pessoa -> PASSOU (1 linha);
--   - caio.dias@ mudando o proprio nome          -> PASSOU (1 linha);
--   - super-admin tirando a propria trava        -> PASSOU (1 linha).

create or replace function public.impedir_autopromocao()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.id = auth.uid()
     and (new.is_superadmin is distinct from old.is_superadmin
          or new.role is distinct from old.role
          or new.escopo_por_equipe is distinct from old.escopo_por_equipe)
     and not public.is_superadmin()
  then
    raise exception 'Voce nao pode alterar o seu proprio nivel de acesso (super-admin, papel ou limite de loja). Peca a um super-admin.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- O gatilho ja existe desde 27/07 e aponta para esta funcao; nao e recriado
-- aqui de proposito, para nao haver janela sem trava durante o deploy.
