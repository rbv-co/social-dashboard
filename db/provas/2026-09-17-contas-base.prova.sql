-- PROVA POR ROLLBACK das seis funções de conta do Registered Pieces
-- (vessel_conta_criar, vessel_conta_entrar, vessel_conta_da_sessao,
-- vessel_conta_sair, e as travas de CPF repetido, nascimento obrigatório e
-- senha errada).
--
-- Rode inteiro, de uma vez, DEPOIS de aplicar
-- db/migrations/2026-09-17-vessel-contas-base.sql. Ele mesmo desfaz tudo:
-- ⚠️ TERMINA EM ERRO DE PROPÓSITO. A última linha do bloco é um
-- `raise exception` disparado só depois de todas as asserções passarem — é o
-- que devolve o banco ao estado de antes, sem precisar de `begin`/`rollback`
-- em volta (o `do $$ ... end $$` inteiro é uma única instrução: se ela levanta
-- exceção, a transação implícita que a envolve desfaz sozinha tudo que foi
-- inserido lá dentro). A mensagem esperada no fim é exatamente
-- "rollback proposital: todas as asserções passaram" — qualquer outra
-- mensagem de erro é defeito de verdade, não o fim combinado da prova.
--
-- Depois de rodar, confira que nada sobrou:
--   select count(*) from public.vessel_clientes;
-- Esperado: 0.
--
-- Nenhum dado real é usado: os dois CPFs e os dois e-mails abaixo são
-- fictícios (o CPF '390.533.447-05' é um CPF de teste, matematicamente válido,
-- que não pertence a ninguém).

do $$
declare v json; v_token text;
begin
  v := public.vessel_conta_criar('Cliente Teste','390.533.447-05',
        'teste-conta@exemplo.com.br','(19) 99999-0000','1990-01-01','senha-de-teste');
  assert (v->>'ok')::boolean, 'criar falhou: ' || v::text;

  v := public.vessel_conta_criar('Outra','390.533.447-05',
        'outro@exemplo.com.br',null,'1990-01-01','x');
  assert (v->>'motivo') = 'ja_existe', 'CPF repetido deveria ser recusado';

  v := public.vessel_conta_criar('Sem Nascimento','111.444.777-35',
        'sem-nascimento@exemplo.com.br',null,null,'x');
  assert (v->>'motivo') = 'nascimento_invalido', 'nascimento é obrigatório';

  v := public.vessel_conta_entrar('teste-conta@exemplo.com.br','senha-errada',false,null,null);
  assert (v->>'motivo') = 'senha_errada', 'senha errada deveria falhar';

  v := public.vessel_conta_entrar('39053344705','senha-de-teste',true,'teste',null);
  assert (v->>'ok')::boolean, 'entrar por CPF falhou: ' || v::text;
  v_token := v->>'token';

  v := public.vessel_conta_da_sessao(v_token);
  assert (v->>'ok')::boolean, 'sessao nao reconhecida';

  v := public.vessel_conta_sair(v_token, false);
  v := public.vessel_conta_da_sessao(v_token);
  assert not (v->>'ok')::boolean, 'sessao encerrada ainda responde';

  raise exception 'rollback proposital: todas as asserções passaram';
end $$;
