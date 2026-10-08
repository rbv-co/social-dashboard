-- O TETO DE CHAMADAS DA PORTA DA CONTA (por IP e global).
--
-- A chave anônima mora dentro do HTML da página pública e a edge `vessel-conta`
-- tem `verify_jwt` desligado: qualquer um chama `criar`, `entrar` e `esqueci`
-- em laço. Os tetos que existiam eram POR PERFIL (5 erros de senha em 15 min,
-- 3 pedidos de nova senha por hora) — nada limitava QUEM chamava. Resultado
-- possível: disparar e-mail de `vesselbrasil.com.br` para qualquer endereço
-- (cadastro com e-mail alheio), queimando crédito do ZeptoMail e a reputação
-- do domínio, ou chutar senha de muitos perfis de um IP só.
--
-- Esta função é o contador: a edge manda uma chave (`teto:criar:ip:<hash>`,
-- `teto:criar:global`...), o máximo e a janela, e ela diz se pode passar.
--
-- ⚠️ REAPROVEITA `vessel_tentativas_de_login` (RLS ligada, sem política), mas
-- com DUAS travas contra forjar a chave:
--   1. as linhas deste teto são gravadas com `acertou = true` e SÓ elas são
--      contadas. `vessel_conta_entrar` grava a chave como o login foi
--      DIGITADO, sem filtro: quem digitasse `teto:criar:global` como login
--      encheria o contador alheio. Erro de login grava `false`; `true`
--      exigiria uma conta cujo e-mail fosse `teto:...`, e o formato de e-mail
--      (`vessel_conta_criar`) rejeita isso.
--   2. o prefixo `teto:` não colide com `esqueci:` nem com CPF/e-mail.
--
-- ⚠️ Contagem e gravação não são atômicas: duas chamadas simultâneas podem
-- passar juntas e estourar o teto por 1 ou 2. Para este uso (conter abuso, não
-- cobrar) isso basta. ponytail: se virar cobrança exata, trocar por
-- pg_advisory_xact_lock(hashtext(p_chave)).
--
-- ⚠️ NÃO APLICADA por este commit. Migrations desta fase entram à mão
-- (`apply_migration`); quem aplica é o dono. Aplicar ANTES de publicar a edge
-- que a chama — sem ela, a edge segue sem teto (falha aberta, com log), não
-- quebra.
create or replace function public.vessel_teto_de_chamadas(
  p_chave text, p_max int, p_janela_segundos int
) returns boolean language plpgsql security definer set search_path to 'public' as $$
declare v_n int;
begin
  if p_chave is null or p_chave !~ '^teto:' or p_max < 1 or p_janela_segundos < 1 then
    raise exception 'vessel_teto_de_chamadas: parametros invalidos';
  end if;

  -- limpa só a PRÓPRIA chave, só o que já saiu da janela: a tabela não cresce
  -- sem fim e a limpeza usa o índice (chave, quando).
  delete from public.vessel_tentativas_de_login
   where chave = p_chave and acertou = true
     and quando < now() - make_interval(secs => p_janela_segundos);

  select count(*) into v_n from public.vessel_tentativas_de_login
   where chave = p_chave and acertou = true;
  if v_n >= p_max then
    return false;
  end if;

  insert into public.vessel_tentativas_de_login (chave, acertou) values (p_chave, true);
  return true;
end;
$$;

-- ⚠️ `revoke from public` NÃO fecha `anon`/`authenticated` (ver o portão em
-- 2026-09-17-vessel-contas-base.sql): revogar dos três e conceder só a
-- `service_role`, que é quem a edge usa.
revoke all on function public.vessel_teto_de_chamadas(text, int, int) from public, anon, authenticated;
grant execute on function public.vessel_teto_de_chamadas(text, int, int) to service_role;
