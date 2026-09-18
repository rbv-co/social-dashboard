-- PROVA POR ROLLBACK das funções de conta do Registered Pieces
-- (vessel_conta_criar, vessel_conta_entrar, vessel_conta_da_sessao,
-- vessel_conta_sair, vessel_conta_pedido_de_nova_senha,
-- vessel_conta_efetivar_nova_senha, e as travas de CPF repetido/inválido,
-- nascimento obrigatório e senha errada).
--
-- ⚠️ ATUALIZADA NA ONDA FINAL DE CORREÇÃO (17/09/2026, achados C4 e C6 da
-- revisão da branch inteira): `vessel_conta_nova_senha` deixou de existir —
-- virou dois passos (`vessel_conta_pedido_de_nova_senha` e
-- `vessel_conta_efetivar_nova_senha`); e `vessel_conta_criar` passou a exigir
-- CPF com dígito verificador válido, não só 11 dígitos.
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
-- Nenhum dado real é usado: os CPFs e os e-mails abaixo são fictícios (o CPF
-- '390.533.447-05' é um CPF de teste, matematicamente válido, que não
-- pertence a ninguém; o mesmo vale para '484.523.220-73').

do $$
declare v json; v_token text; v_erros int;
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

  -- ── A TRAVA DE TENTATIVAS É POR CPF NORMALIZADO, NÃO POR FORMATO ─────────
  -- Correção da Tarefa 3, rodada 1: '484.523.220-73', '48452322073' e
  -- '484-523-220.73' são O MESMO CPF, mas eram TRÊS CHAVES diferentes na
  -- versão original — cada formato tinha sua própria cota de 5 erros, e
  -- misturar formatos dava chute de senha praticamente ilimitado. Esta conta
  -- é NOVA, só para não misturar contagem com a de cima.
  v := public.vessel_conta_criar('Cliente Formatos','484.523.220-73',
        'formatos@exemplo.com.br',null,'1990-01-01','senha-de-teste-2');
  assert (v->>'ok')::boolean, 'criar (conta dos formatos) falhou: ' || v::text;

  -- 5 erros, um em cada formato diferente do MESMO CPF.
  v := public.vessel_conta_entrar('484.523.220-73','errada',false,null,null);
  assert (v->>'motivo') = 'senha_errada', 'formato 1 deveria falhar por senha';
  v := public.vessel_conta_entrar('48452322073','errada',false,null,null);
  assert (v->>'motivo') = 'senha_errada', 'formato 2 deveria falhar por senha';
  v := public.vessel_conta_entrar('484-523-220.73','errada',false,null,null);
  assert (v->>'motivo') = 'senha_errada', 'formato 3 deveria falhar por senha';
  v := public.vessel_conta_entrar('484 523 220 73','errada',false,null,null);
  assert (v->>'motivo') = 'senha_errada', 'formato 4 deveria falhar por senha';
  v := public.vessel_conta_entrar('484.523.220.73','errada',false,null,null);
  assert (v->>'motivo') = 'senha_errada', 'formato 5 deveria falhar por senha';

  select count(*) into v_erros from public.vessel_tentativas_de_login
   where chave = '48452322073' and acertou = false;
  assert v_erros = 5, 'os 5 erros deveriam ter caido na MESMA chave (o CPF), e caiu ' || v_erros::text;

  -- 6º erro, num SEXTO formato — mesmo com a SENHA CERTA, tem de barrar por
  -- excesso de tentativas. Se isto voltar 'senha_errada' ou 'ok:true', a
  -- trava voltou a ser furável por formato.
  v := public.vessel_conta_entrar('484.523.220-73 ','senha-de-teste-2',false,null,null);
  assert (v->>'motivo') = 'muitas_tentativas',
    'a trava deveria ter barrado por formato-diferente-mesmo-cpf, devolveu: ' || v::text;

  -- ── C6: CPF com 11 dígitos mas SEM dígito verificador válido é recusado ──
  -- Antes, só a CONTAGEM de dígitos era conferida — '111.111.111-11' (11
  -- dígitos repetidos) passava aqui e só quebrava depois, ao tentar
  -- registrar uma peça: conta morta, sem formulário na tela para consertar.
  v := public.vessel_conta_criar('CPF Repetido','111.111.111-11',
        'cpf-repetido@exemplo.com.br',null,'1990-01-01','x');
  assert (v->>'motivo') = 'cpf_invalido',
    'CPF com dígitos repetidos (sem verificador válido) deveria ser recusado, devolveu: ' || v::text;

  -- ── C4: "esqueci a senha" em dois passos ─────────────────────────────────
  declare
    v_cliente_teste record;
    v_senha_antiga  text;
    v_pedido        json;
  begin
    select id, senha_hash into v_cliente_teste
      from public.vessel_clientes where cpf = '39053344705';
    v_senha_antiga := v_cliente_teste.senha_hash;

    -- resposta IDÊNTICA para login que não existe: {ok:true, cliente_id:null}
    v_pedido := public.vessel_conta_pedido_de_nova_senha('nao-existe@exemplo.com.br');
    assert (v_pedido->>'ok')::boolean and (v_pedido->>'cliente_id') is null,
      'login inexistente tem de responder ok:true com cliente_id nulo, devolveu: ' || v_pedido::text;

    -- pedido de verdade: diz para onde mandar, mas NÃO troca nada ainda.
    v_pedido := public.vessel_conta_pedido_de_nova_senha('teste-conta@exemplo.com.br');
    assert (v_pedido->>'ok')::boolean and (v_pedido->>'cliente_id') = v_cliente_teste.id::text,
      'pedido para login existente tem de devolver cliente_id, devolveu: ' || v_pedido::text;

    select senha_hash into v_senha_antiga from public.vessel_clientes where id = v_cliente_teste.id;
    assert v_senha_antiga = v_cliente_teste.senha_hash,
      'vessel_conta_pedido_de_nova_senha NÃO PODE mexer na senha — só o passo 2 troca';

    -- teto de 3 por hora: já gastamos 1 tentativa acima com o login que
    -- existe (mais 1 com o que não existe, chave diferente). Mais 2 no MESMO
    -- login ainda cabem no teto (total 3); a 4ª tem de barrar.
    v_pedido := public.vessel_conta_pedido_de_nova_senha('teste-conta@exemplo.com.br');
    assert (v_pedido->>'ok')::boolean, '2º pedido do mesmo login ainda deveria caber no teto';
    v_pedido := public.vessel_conta_pedido_de_nova_senha('teste-conta@exemplo.com.br');
    assert (v_pedido->>'ok')::boolean, '3º pedido do mesmo login ainda deveria caber no teto';
    v_pedido := public.vessel_conta_pedido_de_nova_senha('teste-conta@exemplo.com.br');
    assert (v_pedido->>'motivo') = 'muitas_tentativas',
      '4º pedido em menos de uma hora tem de estourar o teto, devolveu: ' || v_pedido::text;

    -- passo 2: só agora a senha troca de verdade, e as sessões caem.
    v := public.vessel_conta_entrar('teste-conta@exemplo.com.br','senha-de-teste',true,'teste',null);
    assert (v->>'ok')::boolean, 'precisava logar de novo para ter sessão a derrubar';
    v := public.vessel_conta_efetivar_nova_senha(v_cliente_teste.id, 'senha-novissima');
    assert (v->>'ok')::boolean, 'efetivar a senha nova falhou: ' || v::text;

    select senha_hash into v_senha_antiga from public.vessel_clientes where id = v_cliente_teste.id;
    assert v_senha_antiga <> v_cliente_teste.senha_hash, 'a senha tinha de ter mudado';

    v := public.vessel_conta_entrar('teste-conta@exemplo.com.br','senha-novissima',false,null,null);
    assert (v->>'ok')::boolean, 'a senha nova deveria funcionar para logar';

    -- efetivar para um cliente_id que não existe: não quebra, só avisa.
    v := public.vessel_conta_efetivar_nova_senha(gen_random_uuid(), 'x');
    assert (v->>'motivo') = 'nao_existe', 'cliente_id inexistente deveria devolver nao_existe';
  end;

  raise exception 'rollback proposital: todas as asserções passaram';
end $$;
