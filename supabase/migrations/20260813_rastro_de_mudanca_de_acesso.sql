-- Mudanca de acesso passa a deixar rastro no `audit_log`.
-- Aplicado em producao em 2026-08-13 (projeto kounqtdoioootxqegkij). Item B1g.
--
-- O QUE FALTAVA:
-- de tudo que diz respeito a acesso de uma pessoa, so a troca de CARGO era
-- registrada (`guard_profiles` ja escrevia `role_change`). Ligar ou desligar a
-- trava de loja de alguem, mudar as permissoes, mudar de quais contas de anuncio
-- a pessoa ve os numeros, pôr ou tirar de um perfil de acesso: tudo isso mudava
-- em silencio.
--
-- Custou concreto no dia em que isto foi escrito: a trava de loja de uma pessoa
-- foi desligada durante a sessao e NAO havia como dizer quem desligou nem a que
-- horas. So deu pra descartar o robô por eliminacao, comparando com outra linha.
--
-- O QUE ESTA MIGRATION FAZ, e so isso:
--   - acrescenta um segundo `insert` no `audit_log`, com a acao `acesso_change`,
--     quando qualquer uma das SETE colunas de acesso muda;
--   - registra tambem quando quem muda e ROBÔ (`auth.uid()` nulo). Por isso o
--     trecho do rastro fica ANTES do "contexto de servico: confia" -- confiar em
--     quem grava e uma coisa, nao anotar o que foi gravado e outra.
--
-- O QUE ELA NAO FAZ:
--   - nao muda nenhuma regra de quem pode o que. As tres travas do
--     `guard_profiles` continuam identicas, na mesma ordem;
--   - nao mexe no `role_change` que ja existia -- ele continua saindo igual,
--     com o mesmo nome de acao, pra nao quebrar nada que um dia leia por ele.
--     Hoje ninguem le o `audit_log` (conferido em 13/08: nenhuma tela, nenhum
--     robô, nenhuma edge o consulta) -- ele e so escrito.
--
-- O QUE O REGISTRO NAO MOSTRA, e e bom saber antes de procurar: TENTATIVA
-- BARRADA nao aparece. Os dois gatilhos da tabela rodam em ordem alfabetica
-- (`trg_guard_profiles` antes de `trg_impedir_autopromocao`), entao quando a
-- segunda trava derruba a gravacao, o `insert` que a primeira ja tinha feito cai
-- junto -- e isso e o certo: dentro de uma transacao que foi desfeita nao existe
-- linha nenhuma. O `audit_log` conta o que ACONTECEU, nao o que se tentou.
--
-- POR QUE GUARDAR O VALOR INTEIRO de `permissions`/`features` em vez de so a
-- diferenca: e o jeito que nao tem como errar. Calcular a diferenca dentro do
-- gatilho seria mais bonito de ler e mais facil de ter bug, e o volume aqui e de
-- algumas mudancas por dia, nao por segundo.

create or replace function public.guard_profiles()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  mudou jsonb := '{}'::jsonb;
begin
  -- ── 1) O RASTRO ──────────────────────────────────────────────────────────
  -- Vem antes de tudo, inclusive do "contexto de servico: confia": robô que
  -- muda acesso de gente tambem precisa aparecer no registro.
  if new.is_superadmin is distinct from old.is_superadmin then
    mudou := mudou || jsonb_build_object('super_admin',
      jsonb_build_object('de', old.is_superadmin, 'para', new.is_superadmin));
  end if;
  if new.escopo_por_equipe is distinct from old.escopo_por_equipe then
    mudou := mudou || jsonb_build_object('trava_de_loja',
      jsonb_build_object('de', old.escopo_por_equipe, 'para', new.escopo_por_equipe));
  end if;
  if new.permissions is distinct from old.permissions then
    mudou := mudou || jsonb_build_object('permissoes',
      jsonb_build_object('de', old.permissions, 'para', new.permissions));
  end if;
  if new.permissions_excecao is distinct from old.permissions_excecao then
    mudou := mudou || jsonb_build_object('excecao',
      jsonb_build_object('de', old.permissions_excecao, 'para', new.permissions_excecao));
  end if;
  if new.allowed_accounts is distinct from old.allowed_accounts then
    mudou := mudou || jsonb_build_object('contas_de_anuncio',
      jsonb_build_object('de', to_jsonb(old.allowed_accounts), 'para', to_jsonb(new.allowed_accounts)));
  end if;
  if new.perfil_id is distinct from old.perfil_id then
    mudou := mudou || jsonb_build_object('perfil_de_acesso',
      jsonb_build_object('de', old.perfil_id, 'para', new.perfil_id));
  end if;
  if new.features is distinct from old.features then
    mudou := mudou || jsonb_build_object('features',
      jsonb_build_object('de', to_jsonb(old.features), 'para', to_jsonb(new.features)));
  end if;

  if mudou <> '{}'::jsonb then
    insert into public.audit_log(actor_id, actor_email, action, detail)
    values (
      auth.uid(),
      -- Sem login e robô: dizer isso com todas as letras vale mais do que uma
      -- coluna vazia, que se confunde com "nao consegui descobrir".
      coalesce((select email from public.profiles where id = auth.uid()), 'robo/servico'),
      'acesso_change',
      jsonb_build_object('target_id', old.id, 'target_email', old.email, 'mudou', mudou)
    );
  end if;

  -- ── 2) AS TRAVAS, exatamente como estavam ────────────────────────────────
  if auth.uid() is null then return new; end if;  -- contexto servidor/service: confia
  if old.email = 'erick@rbvcompany.com' and not public.is_superadmin() then
    raise exception 'Apenas o superadmin pode alterar o perfil do superadmin';
  end if;
  if new.role is distinct from old.role and not public.is_superadmin() then
    raise exception 'Apenas o superadmin pode alterar o cargo de usuarios';
  end if;
  if new.role is distinct from old.role then
    insert into public.audit_log(actor_id,actor_email,action,detail)
    values (auth.uid(), (select email from public.profiles where id=auth.uid()), 'role_change',
            jsonb_build_object('target_id', old.id, 'target_email', old.email, 'from', old.role, 'to', new.role));
  end if;
  return new;
end;
$$;
