-- A TRAVA DE EDITAR DO COMERCIAL VESSEL.
--
-- ⚠️ EXISTEM DOIS MODELOS DE PERMISSAO NESTE SISTEMA, E ELES NAO CONVERSAM.
--   · `profiles.features` — lista de CHAVES, sem acao. E o que
--     `is_vessel_atendimentos()` le hoje: ela responde igual para quem so ve e
--     para quem mexe.
--   · `profiles.permissions` — jsonb `recurso -> [acoes]`. E o que a TELA le.
--
-- Sem esta funcao, esconder o botao de apagar na tela seria SO ESCONDER: a
-- funcao aceitaria a chamada de qualquer um com `atendimentos`, por fora da
-- tela.
--
-- ⚠️ E AS DUAS COISAS JUNTAS, comecando pelo portao de hoje: assim editar nunca
-- fica MAIS FROUXO que ver, mesmo quando os dois modelos discordam entre si.
--
-- ⚠️ A ARMADILHA DO NULO: quando `permissions` e `'{}'::jsonb` (a chave
-- `atendimentos` nem existe), `p.permissions -> 'atendimentos'` devolve NULL,
-- e `NULL ? 'editar'` tambem devolve NULL — nao `false`. Um `if not <isto>`
-- em volta de um NULL nao dispara (`not null` e `null`), e a execucao cairia
-- direto para a escrita. O `coalesce(..., false)` abaixo envolve a
-- SUBCONSULTA INTEIRA (o `or` incluso) exatamente para fechar essa fresta:
-- `false or NULL` vira `NULL`, e so entao o `coalesce` converte para `false`.
create or replace function public.is_vessel_atendimentos_editar()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_vessel_atendimentos()
     and coalesce(
       (select p.is_superadmin or (p.permissions -> 'atendimentos') ? 'editar'
          from public.profiles p where p.id = auth.uid()),
       false);
$$;

comment on function public.is_vessel_atendimentos_editar() is
  'Quem pode MEXER no Comercial Vessel. Exige o portao de ver (features) E a acao editar (permissions). Nunca mais frouxa que is_vessel_atendimentos().';

-- ⚠️ AS DUAS LINHAS SAO OBRIGATORIAS: `revoke ... from public` NAO fecha
-- `authenticated`.
revoke all on function public.is_vessel_atendimentos_editar() from public, anon, authenticated;
grant execute on function public.is_vessel_atendimentos_editar() to authenticated;
