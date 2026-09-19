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
  for (const acao of ['entrar', 'eu', 'sair', 'esqueci', 'editar', 'minhas-pecas',
                      'transferir-gerar', 'transferir-aberta', 'transferir-cancelar',
                      'transferir-aceitar']) {
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

test('a edge trata as treze ações', () => {
  // 'minhas-pecas' entrou na Tarefa 9 (Registered Pieces — Contas Fase 1):
  // a tela "Minhas peças" lista o que está no nome da cliente logada.
  // As quatro 'transferir-*' entraram em 18/09/2026, com a transferência de
  // propriedade (docs/superpowers/specs/2026-09-18-transferencia-de-propriedade-design.md).
  // 'lembrete-criar' e 'lembrete-parar' entraram em 19/09/2026, com o
  // "Register Later" (docs/superpowers/specs/2026-09-19-register-later-design.md).
  // São as duas ÚNICAS desta edge que funcionam sem sessão: a de criar aceita
  // o token de sessão como opcional (só para ligar o lembrete à conta), e a de
  // parar não usa sessão nenhuma — o token do e-mail é a prova.
  //
  // ⚠️ Entrega nova NÃO mexe no que já está no ar: esta lista é fechada, e
  // apagar um `if` sem querer derruba uma tela inteira, calada.
  for (const acao of ['criar', 'entrar', 'sair', 'esqueci', 'editar', 'eu', 'minhas-pecas',
                      'transferir-gerar', 'transferir-aberta', 'transferir-cancelar',
                      'transferir-aceitar', 'lembrete-criar', 'lembrete-parar']) {
    assert.ok(FONTE.includes(`'${acao}'`), `falta a ação ${acao}`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * TRANSFERÊNCIA DE PROPRIEDADE (18/09/2026)
 * ══════════════════════════════════════════════════════════════════════════
 * O código de 6 dígitos vale por uma bolsa. Ele aparece UMA vez — na resposta
 * de sucesso de `transferir-gerar` — e nunca mais: nem em outra resposta, nem
 * em log, nem na trilha do banco. É a mesma regra da senha, e por isso as
 * guardas abaixo são as mesmas, na letra. */

const levaCodigoDeTransferencia = (chamada) => /\bcodigo_transferencia\b/.test(chamada);

test('⚠️ a edge NUNCA toca no código de transferência — ele só atravessa dentro do `data`', () => {
  // ⚠️ A PRIMEIRA VERSÃO DESTE TESTE PROCURAVA `codigo_transferencia` DENTRO DE
  // UM `responder(...)` — e não achava nada, porque a edge devolve o `data` do
  // banco inteiro, sem montar objeto nenhum. Achar zero seria "passou por
  // vacuidade": o teste pareceria guardar o código e não guardava nada.
  //
  // O que realmente importa aqui: o código só existe dentro do `data` que veio
  // do rpc de geração e vai direto para a página. A edge nunca o lê, nunca o
  // copia para outro objeto, nunca o guarda. A única menção permitida é o
  // PARÂMETRO de entrada de "transferir-aceitar" — o que a cliente digitou,
  // indo para o banco conferir.
  const mencoes = FONTE.split('\n').filter(levaCodigoDeTransferencia);
  assert.ok(mencoes.length > 0, 'não achei menção nenhuma — o nome do campo mudou?');
  for (const linha of mencoes) {
    assert.match(linha.trim(), /^p_codigo_transferencia:\s*corpo\.codigo_transferencia,?$/,
      `a edge só pode NOMEAR o código ao repassá-lo para o banco: ${linha.trim()}`);
  }

  // E o `data` cru só vira resposta pelo caminho de sempre: `responder(data ...)`.
  const gerar = blocoDaAcao(FONTE, 'transferir-gerar');
  assert.match(gerar, /return responder\(data \?\? \{ ok: false, motivo: 'falhou' \}\);/,
    '"transferir-gerar" devolve o data do banco como está — sem remontar');
});

test('⚠️ nenhuma resposta da edge monta um campo com o código', () => {
  for (const chamada of chamadasDeResponder(FONTE)) {
    assert.ok(!levaCodigoDeTransferencia(chamada),
      `resposta montada à mão com o código: ${chamada}`);
  }
});

test('⚠️ o código de transferência nunca vai para log', () => {
  // A guarda geral de log ('a senha nunca vai para log') já exige o formato
  // `console.error('vessel_x', erro.message)`. Esta aqui diz a mesma coisa com
  // a palavra desta tarefa, para quem for mexer na edge amanhã ler o motivo.
  // O NOME do rpc pode conter "transferencia" (é o nome da função); o que não
  // pode é o campo com o código, nem o corpo da chamada, nem o `data`.
  for (const log of FONTE.match(/console\.error\([^)]*\)/gs) ?? []) {
    for (const proibido of [/codigo_transferencia/i, /\bcorpo\b/, /\bdata\b/]) {
      assert.ok(!proibido.test(log), `log carrega o código de transferência: ${log}`);
    }
  }
});

test('⚠️ as quatro ações novas chamam o rpc certo e conferem `error`', () => {
  const esperado = {
    'transferir-gerar': 'vessel_transferencia_gerar',
    'transferir-aberta': 'vessel_transferencia_aberta',
    'transferir-cancelar': 'vessel_transferencia_cancelar',
    'transferir-aceitar': 'vessel_transferencia_aceitar',
  };
  for (const [acao, rpc] of Object.entries(esperado)) {
    const bloco = blocoDaAcao(FONTE, acao);
    assert.ok(bloco.includes(`rpc('${rpc}'`), `${acao} tem de chamar ${rpc}`);
    assert.match(bloco, /const\s*\{[^}]*\berror\b[^}]*\}\s*=\s*await\s+sb\.rpc\(/,
      `${acao}: falta desestruturar "error" (só "data" deixa erro do rpc calado)`);
    assert.match(bloco, /motivo:\s*'falhou'/,
      `${acao}: falha de infraestrutura tem de virar {ok:false, motivo:'falhou'}`);
  }
});

test('⚠️ a edge não decide nada sobre transferência: quem decide é o banco', () => {
  // ⚠️ POR QUE ISTO É UM TESTE. Uma Edge Function não guarda estado entre
  // chamadas: qualquer contagem de tentativa, comparação de código ou conta de
  // prazo escrita aqui seria decoração — e pior, esconderia que a trava de
  // verdade nunca existiu. O teto de 5/24h, o prazo de 7 dias e a comparação
  // do hash moram TODOS no banco (2026-09-18-zzzzz-vessel-transferencia-de-
  // propriedade.sql). A edge só repassa.
  for (const acao of ['transferir-gerar', 'transferir-aberta', 'transferir-cancelar',
                      'transferir-aceitar']) {
    const bloco = blocoDaAcao(FONTE, acao);
    assert.ok(!/crypt|bcrypt|Math\.random|Date\.now\(\)|new Date\(/.test(bloco),
      `${acao}: sorteio, hash e prazo são do banco, não da edge`);
  }
});

test('⚠️ as ações que já existiam não mudaram de rpc', () => {
  // A tarefa da transferência acrescenta; não mexe no que está no ar.
  const antigas = {
    criar: 'vessel_conta_criar', entrar: 'vessel_conta_entrar',
    eu: 'vessel_conta_da_sessao', sair: 'vessel_conta_sair',
    editar: 'vessel_conta_editar', 'minhas-pecas': 'vessel_minhas_pecas',
  };
  for (const [acao, rpc] of Object.entries(antigas)) {
    assert.ok(blocoDaAcao(FONTE, acao).includes(`rpc('${rpc}'`),
      `a ação ${acao} deixou de chamar ${rpc}`);
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

// ── PARAR DE RECEBER O LEMBRETE (19/09/2026) ─────────────────────────────────
// Desenho: docs/superpowers/specs/2026-09-19-register-later-design.md

test('⚠️ "lembrete-criar" funciona COM e SEM sessão, e não inventa motivo', () => {
  const bloco = blocoDaAcao(FONTE, 'lembrete-criar');
  assert.match(bloco, /rpc\('vessel_lembrete_criar'/);

  // O token de sessão é OPCIONAL: quem não tem conta pede o lembrete do mesmo
  // jeito — é justamente para quem ainda não registrou. A edge não confere
  // sessão nenhuma; quem faz isso, e sem derrubar o pedido, é o banco.
  assert.ok(!/vessel_conta_da_sessao/.test(bloco),
    'exigir sessão aqui tiraria o botão de quem não tem conta');
  assert.match(bloco, /p_token_opcional:\s*corpo\.token\s*\?\?\s*null/,
    'o token de sessão entra como opcional, e nunca obrigatório');

  // ⚠️ A EDGE NÃO INVENTA MOTIVO. A regra de "a mesma resposta em qualquer
  // situação da peça" mora no banco; se a edge traduzisse, bastaria um
  // `motivo` a mais aqui para contar que a peça já tem dona.
  for (const chamada of chamadasDeResponder(bloco)) {
    assert.ok(!/motivo:\s*'(ja_registrada|ja_tem_dona|ja_tem_lembrete|sem_sessao)'/.test(chamada),
      `a edge não pode inventar motivo sobre a peça: ${chamada}`);
  }
  // Só `falhou`, que é desta edge, e o que vier do banco.
  assert.match(bloco, /return responder\(data \?\? \{ ok: false, motivo: 'falhou' \}\)/);
});

test('⚠️ "lembrete-criar" e "lembrete-parar" nunca logam o e-mail nem o token', () => {
  for (const acao of ['lembrete-criar', 'lembrete-parar']) {
    for (const log of blocoDaAcao(FONTE, acao).match(/console\.[a-z]+\([^)]*\)/gs) ?? []) {
      assert.ok(!/corpo\.(email|token|t)\b|\bdata\b/.test(log),
        `${acao}: o log só leva o nome do rpc e a mensagem do Postgres: ${log}`);
    }
  }
});

test('⚠️ "lembrete-parar" NÃO exige sessão — o token do e-mail é a prova', () => {
  const bloco = blocoDaAcao(FONTE, 'lembrete-parar');
  assert.match(bloco, /rpc\('vessel_lembrete_cancelar_por_token'/);
  // Quem clica no link do e-mail não está logada — nem precisa ter conta. Uma
  // conferência de sessão aqui deixaria o "não quero mais receber" impossível
  // justamente para quem mais precisa dele.
  assert.ok(!/vessel_conta_da_sessao/.test(bloco),
    'exigir sessão aqui quebra o link do e-mail');
  assert.ok(!/corpo\.token\b/.test(bloco),
    'o campo é o token do LINK (corpo.t), não o token de sessão da conta');
});

test('⚠️ "lembrete-parar" responde sempre a mesma coisa — token errado não conta nada', () => {
  const bloco = blocoDaAcao(FONTE, 'lembrete-parar');
  for (const chamada of chamadasDeResponder(bloco)) {
    assert.ok(!/motivo:\s*'(nao_existe|token_invalido|nao_achei)'/.test(chamada),
      `esta porta é pública e sem login: um "não achei" a transforma num testador de tokens: ${chamada}`);
  }
});

test('⚠️ as ações que já existiam continuam todas lá, e a nova chega inteira', () => {
  for (const acao of ['criar', 'entrar', 'eu', 'sair', 'esqueci', 'editar', 'minhas-pecas',
                      'transferir-gerar', 'transferir-aberta', 'transferir-cancelar',
                      'transferir-aceitar', 'lembrete-criar', 'lembrete-parar']) {
    assert.ok(FONTE.includes(`corpo.acao === '${acao}'`), `a ação ${acao} sumiu`);
  }
  // E o rpc novo confere `error`, como todos os outros.
  const pos = FONTE.indexOf("rpc('vessel_lembrete_cancelar_por_token'");
  assert.ok(pos > -1);
  assert.match(FONTE.slice(Math.max(0, pos - 100), pos + 4),
    /const\s*\{[^}]*\berror\b[^}]*\}\s*=\s*await\s+sb\.rpc\(/,
    'falta desestruturar "error" (só "data" deixa erro do rpc calado)');
});
