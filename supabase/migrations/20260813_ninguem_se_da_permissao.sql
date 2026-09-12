-- Impede que um admin se dê permissão sozinho.
-- Aplicado em producao em 2026-08-13 (projeto kounqtdoioootxqegkij).
-- Terceiro e ultimo aperto da mesma familia, no mesmo dia:
--   1. 27/07 -- ninguem se promove a super-admin nem troca o proprio cargo;
--   2. 13/08 -- ninguem tira a propria trava de loja (`escopo_por_equipe`);
--   3. este  -- ninguem se da permissao, conta de anuncio, perfil de acesso
--      nem excecao.
--
-- O BURACO, medido em 13/08 e provado com mudanca de verdade (desfeita):
-- a policy `admin_update_profiles` deixa qualquer admin dar PATCH em qualquer
-- perfil, inclusive no dele, e NENHUM dos dois gatilhos da tabela olhava a
-- coluna `permissions`. Num comando so, uma conta admin comum saiu de
-- "so ver o Banco de Arquivos" para "criar e excluir", e de "so ver Acessos"
-- para "criar, editar e excluir". Alcance: as 6 contas que sao admin sem ser
-- super-admin.
--
-- AS CINCO COLUNAS QUE ENTRAM, e por que cada uma:
--   permissions         -- o que a pessoa pode em cada ferramenta;
--   allowed_accounts    -- de quais contas de anuncio ela ve os numeros;
--   perfil_id           -- em qual perfil de acesso ela esta (o perfil regrava
--                          `permissions` de quem esta dentro);
--   permissions_excecao -- o que foi dado a mao e SOBREVIVE a regravacao do
--                          perfil; dar excecao a si mesmo e o mesmo buraco por
--                          outra porta;
--   features            -- o modelo ANTIGO, que ainda esta vivo: a Edge
--                          Function `bling-proxy` libera por
--                          `features inclui 'sales' ou 'gestor'`. Sem esta
--                          coluna na trava, bastava se dar 'gestor'.
--
-- POR QUE ISTO NAO ATRAPALHA O PAINEL -- conferido linha a linha antes:
--   - o botao "Permissoes" NAO aparece na sua propria linha
--     (`if (!isSelf && canEdit)`, tela-de-admin.vue ~L2720). Para voce mesmo so
--     existe "Minhas notificacoes", que nem chega a gravar em `profiles`;
--   - os Perfis de Acesso (que regravam permissao de varias pessoas de uma vez)
--     sao so de super-admin (~L1626), e super-admin passa livre por esta trava;
--   - trocar cargo, desativar e pôr alguem num perfil sao todos `!isSelf` ou
--     so de super-admin;
--   - o unico PATCH que a pessoa faz na PROPRIA linha e o do avatar
--     (`avatar_url`, ~L376), coluna que nao esta aqui.
--   Ou seja: no caminho normal esta trava nunca e acionada. Ela so barra quem
--   fala direto com o banco.
--
-- O que ela tambem NAO faz: nao mexe em editar o perfil dos OUTROS (trabalho
-- normal do painel), nao mexe no `guard_profiles`, e o service_role dos robos
-- passa livre porque neles `auth.uid()` e nulo.
--
-- VALIDADO ANTES DE APLICAR contra o banco de producao, dentro de transacao
-- desfeita no fim (nada ficou gravado), simulando o JWT de contas reais.

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
          or new.escopo_por_equipe is distinct from old.escopo_por_equipe
          or new.permissions is distinct from old.permissions
          or new.allowed_accounts is distinct from old.allowed_accounts
          or new.perfil_id is distinct from old.perfil_id
          or new.permissions_excecao is distinct from old.permissions_excecao
          or new.features is distinct from old.features)
     and not public.is_superadmin()
  then
    raise exception 'Voce nao pode alterar o seu proprio acesso (permissoes, contas, perfil, cargo, super-admin ou limite de loja). Peca a um super-admin.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Comparar e de graca quando nada muda: gravar o MESMO valor nao dispara a
-- trava, entao um salvamento que nao mexeu em acesso continua passando.
-- O gatilho `trg_impedir_autopromocao` ja existe desde 27/07 e aponta para
-- esta funcao; nao e recriado aqui, para nao haver janela sem trava.
