// supabase/functions/vessel-conta/porta.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');

// ⚠️ Achador de chamadas a responder(...) que CONTA PARÊNTESES, em vez de
// regex que para no primeiro `)`.
//
// O regex ingênuo (`/responder\([^)]*\)/`) foi provado errado por mutação
// numa rodada de revisão: `responder({ ok: true, email_mascarado:
// mascararEmail(data.email), senha: senha })` passava LIMPO, porque o regex
// parava no `)` de `mascararEmail(data.email)` — tudo que vem depois (o
// `senha: senha` que a gente quer pegar) fica FORA do trecho analisado. Ou
// seja: o teste que existe para impedir vazamento de senha não mordia no
// caso mais provável de acontecer de verdade, que é alguém acrescentar um
// campo novo logo depois de uma chamada de função dentro do objeto.
//
// Este achador anda pelo texto a partir de cada `responder(`, contando `(` e
// `)` até a profundidade voltar a zero — a chamada inteira, com qualquer
// aninhamento dentro, e não só até o primeiro parêntese que fecha.
function chamadasDeResponder(fonte) {
  const chamadas = [];
  const marcador = 'responder(';
  let pos = 0;
  while ((pos = fonte.indexOf(marcador, pos)) !== -1) {
    let i = pos + marcador.length;
    let profundidade = 1;
    while (i < fonte.length && profundidade > 0) {
      if (fonte[i] === '(') profundidade++;
      else if (fonte[i] === ')') profundidade--;
      i++;
    }
    chamadas.push(fonte.slice(pos, i));
    pos = i;
  }
  return chamadas;
}

// Isola o bloco de uma ação: do próprio `if` até o próximo `if (corpo.acao ===`.
function blocoDaAcao(fonte, acao) {
  const inicio = fonte.indexOf(`corpo.acao === '${acao}'`);
  assert.ok(inicio > -1, `não achei o bloco da ação ${acao}`);
  const resto = fonte.slice(inicio);
  const proximoIf = resto.indexOf('corpo.acao ===', 1);
  return proximoIf > -1 ? resto.slice(0, proximoIf) : resto;
}
const levaSenha = (chamada) => /\bsenha\s*[,:}]/.test(chamada);

test('⚠️ a senha só volta para a página numa resposta: a de SUCESSO de "criar"', () => {
  // Pedido do dono (18/09/2026): mostrar a senha na tela ao criar a conta.
  // Até então nenhuma resposta podia levar `senha`; agora UMA pode, e só ela.
  //
  // `p_senha: senha` (o parâmetro do rpc que grava o hash) nunca está dentro
  // de `responder(`, por isso não conta. E a chamada é lida INTEIRA (ver
  // `chamadasDeResponder`), não só até o primeiro `)` — o caso real de
  // `mascararEmail(data.email), senha` é exatamente o que o regex ingênuo
  // deixava passar.
  const comSenha = chamadasDeResponder(FONTE).filter(levaSenha);
  assert.equal(comSenha.length, 1, `esperava UMA resposta com senha, achei: ${comSenha.join(' | ')}`);
  assert.match(comSenha[0], /ok:\s*true/, 'a resposta com senha tem de ser a de sucesso');

  const criar = chamadasDeResponder(blocoDaAcao(FONTE, 'criar')).filter(levaSenha);
  assert.equal(criar.length, 1, 'a resposta com senha tem de estar no bloco de "criar"');
});

test('⚠️ nenhuma outra ação devolve senha — "esqueci" continua SÓ por e-mail', () => {
  // Em "esqueci" o e-mail é a prova de quem é: devolver a senha na tela
  // entregaria a conta a quem só sabe o CPF ou o e-mail de outra pessoa.
  for (const acao of ['entrar', 'eu', 'sair', 'esqueci', 'editar', 'minhas-pecas']) {
    for (const chamada of chamadasDeResponder(blocoDaAcao(FONTE, acao))) {
      assert.ok(!levaSenha(chamada), `a ação ${acao} não pode devolver senha: ${chamada}`);
    }
  }
});

test('⚠️ "criar" só mostra a senha DEPOIS de o e-mail sair; se não saiu, apaga a conta e responde erro', () => {
  const bloco = blocoDaAcao(FONTE, 'criar');
  const envio = bloco.indexOf('await mandarEmail(');
  const falhou = bloco.indexOf('if (!enviou)');
  const apaga = bloco.indexOf("rpc('vessel_conta_apagar_recem_criada'");
  const erro = bloco.indexOf("motivo: 'email_nao_saiu'");
  const comSenha = chamadasDeResponder(bloco).find(levaSenha);
  const posSenha = bloco.indexOf(comSenha);
  assert.ok(envio > -1 && falhou > envio, 'o envio do e-mail tem de ser conferido');
  assert.ok(apaga > falhou && erro > apaga, 'e-mail que não sai: apaga a conta recém-criada e responde erro');
  assert.ok(posSenha > erro, 'a senha só pode sair depois do desvio de "e-mail não saiu"');
  // O desvio de erro não pode levar a senha.
  const desvio = bloco.slice(falhou, posSenha);
  for (const chamada of chamadasDeResponder(desvio)) {
    assert.ok(!levaSenha(chamada), `o desvio de e-mail que falhou não pode levar a senha: ${chamada}`);
  }
});

test('⚠️ a senha nunca vai para log', () => {
  // Nada de console.log/info/debug/warn nesta edge; console.error leva só o
  // nome do rpc e a mensagem do Postgres (o teste de rpc abaixo confere o
  // conteúdo). E nenhum log recebe a resposta, o corpo ou o `data` inteiro.
  assert.doesNotMatch(FONTE, /console\.(log|info|debug|warn|trace)\s*\(/);
  for (const log of FONTE.match(/console\.error\([^)]*\)/gs) ?? []) {
    assert.match(log, /^console\.error\('vessel_[a-z_]+',\s*\w+\.message\)$/,
      `log fora do formato (nome do rpc, mensagem do erro): ${log}`);
  }
});

test('⚠️ a edge não responde nada sem passar pelas funções do banco', () => {
  assert.ok(!/from\('vessel_clientes'\)/.test(FONTE),
    'acesso direto à tabela contorna as travas — tem de ser por rpc');
  assert.match(FONTE, /rpc\('vessel_conta_entrar'/);
});

test('a edge trata as sete ações', () => {
  // 'minhas-pecas' entrou na Tarefa 9 (Registered Pieces — Contas Fase 1):
  // a tela "Minhas peças" lista o que está no nome da cliente logada.
  for (const acao of ['criar', 'entrar', 'sair', 'esqueci', 'editar', 'eu', 'minhas-pecas']) {
    assert.ok(FONTE.includes(`'${acao}'`), `falta a ação ${acao}`);
  }
});

test('⚠️ "esqueci" nunca devolve o e-mail da cliente, e a resposta de sucesso é igual exista ou não o perfil', () => {
  // Requisito extra de uma revisão do banco (17/09/2026): a função
  // `vessel_conta_nova_senha` devolve o e-mail real quando o perfil existe —
  // é assim que a edge sabe para onde mandar a senha nova. Mas esse e-mail
  // NUNCA pode chegar na resposta para a página: se chegasse, "esqueci minha
  // senha" virava um jeito de descobrir se um CPF/e-mail é cliente da marca
  // (perfil existe → resposta com email; perfil não existe → resposta sem
  // email).
  //
  // ⚠️ Sobre `motivo`: numa rodada de correção posterior, as seis chamadas de
  // rpc passaram a conferir `error` (falha de infraestrutura — parâmetro
  // divergente, banco fora do ar) e responder `{ok:false, motivo:'falhou'}`
  // nesse caso, IGUAL nas seis ações. Isso NÃO reabre o vazamento: um erro de
  // rpc é o MESMO para qualquer login, exista ou não o perfil — não é o rpc
  // dizendo "achei"/"não achei", é o rpc dizendo "não consegui nem tentar".
  // Por isso este teste não bane `motivo` em qualquer lugar do bloco (isso
  // reprovaria a guarda de erro, que é comportamento correto e pedido à
  // parte); ele prova as duas coisas que IMPORTAM: (1) `email` nunca aparece
  // em nenhuma resposta da ação, e (2) a resposta de SUCESSO — a que de fato
  // diferenciaria perfil existente de inexistente, se vazasse algo — continua
  // sendo o `{ok:true}` seco, sem motivo, sem email.
  //
  // Isola o bloco da ação "esqueci" (do próprio `if` até o próximo `if
  // (corpo.acao ===` ou o fim do arquivo), para não confundir com as outras
  // ações — "criar", por exemplo, devolve `email_mascarado` de propósito.
  const inicio = FONTE.indexOf("corpo.acao === 'esqueci'");
  assert.ok(inicio > -1, 'não achei o bloco da ação esqueci');
  const resto = FONTE.slice(inicio);
  const proximoIf = resto.indexOf('corpo.acao ===', 1);
  const bloco = proximoIf > -1 ? resto.slice(0, proximoIf) : resto;

  const chamadas = chamadasDeResponder(bloco);
  assert.ok(chamadas.length > 0, 'não achei nenhuma chamada a responder() no bloco de "esqueci"');

  // (1) email nunca vaza, em NENHUMA chamada do bloco (sucesso ou erro).
  for (const chamada of chamadas) {
    assert.ok(!/\bemail\b/i.test(chamada), `resposta de "esqueci" vazou email: ${chamada}`);
  }

  // (2) a resposta de sucesso continua {ok:true} seca — sem motivo.
  const sucesso = chamadas.filter((c) => /ok:\s*true/.test(c) && !/motivo/i.test(c));
  assert.ok(sucesso.length > 0,
    'não achei a resposta de sucesso {ok:true} seca (sem motivo) em "esqueci"');
  for (const chamada of sucesso) {
    assert.match(chamada, /responder\(\s*\{\s*ok:\s*true\s*\}\s*\)/,
      `a resposta de sucesso de "esqueci" tem de ser {ok:true} e nada mais: ${chamada}`);
  }
});

test('⚠️ as chamadas de rpc conferem `error` e não deixam falha de infraestrutura calada', () => {
  // Achado de revisão: sem olhar `error`, um parâmetro que um dia divergir do
  // banco faz o erro do Postgres sumir — a edge devolve o mesmo {ok:false}
  // genérico de uma tentativa legítima, e ninguém percebe. Cada rpc tem de
  // desestruturar `error` (não só `data`) e tratar o caso.
  //
  // ⚠️ C4 (revisão final): "esqueci" deixou de ser UM rpc e virou DOIS —
  // `vessel_conta_pedido_de_nova_senha` (sempre chamado) e
  // `vessel_conta_efetivar_nova_senha` (só chamado se o e-mail saiu). Por
  // isso a lista cresceu de sete para oito.
  const nomesDeRpc = [
    'vessel_conta_criar', 'vessel_conta_entrar', 'vessel_conta_da_sessao',
    'vessel_conta_sair', 'vessel_conta_pedido_de_nova_senha',
    'vessel_conta_efetivar_nova_senha', 'vessel_conta_editar', 'vessel_minhas_pecas',
  ];
  for (const nome of nomesDeRpc) {
    const marcador = `rpc('${nome}'`;
    const pos = FONTE.indexOf(marcador);
    assert.ok(pos > -1, `não achei a chamada a ${nome}`);
    // A desestruturação vem sempre logo antes de `await sb.rpc(`, na mesma
    // janela de texto.
    const janela = FONTE.slice(Math.max(0, pos - 100), pos + marcador.length);
    assert.match(janela, /const\s*\{[^}]*\berror\b[^}]*\}\s*=\s*await\s+sb\.rpc\(/,
      `${nome}: falta desestruturar "error" (só "data" deixa erro do rpc calado)`);
  }

  // ⚠️ Nada de dado da cliente no log de erro — nem senha, nem token, nem
  // CPF, nem e-mail. Só o nome do rpc e a mensagem do Postgres.
  const logs = FONTE.match(/console\.error\([^)]*\)/gs) ?? [];
  assert.ok(logs.length >= 8, `esperava pelo menos 8 console.error (um por rpc), achei ${logs.length}`);
  for (const log of logs) {
    for (const proibido of [/\bsenha\b/i, /\btoken\b/i, /\bcpf\b/i, /\bemail\b/i]) {
      assert.ok(!proibido.test(log), `log de erro carrega dado da cliente: ${log}`);
    }
  }
});
