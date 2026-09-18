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

test('⚠️ a edge NUNCA devolve a senha gerada para a página', () => {
  // A senha vai por e-mail, e só. Devolvê-la no JSON deixaria a senha no
  // histórico do navegador e em qualquer registro de rede pelo caminho.
  //
  // A forma ingênua do brief (`/senha:\s*senha/` no ARQUIVO INTEIRO) dá FALSO
  // POSITIVO: ela também casa com `p_senha: senha`, que é a passagem legítima
  // da senha gerada como PARÂMETRO DO RPC (`vessel_conta_criar` e
  // `vessel_conta_nova_senha` recebem a senha para gravar o hash — a edge
  // TEM de mandar isso para o banco). Aquele regex reprovava a edge correta.
  //
  // A prova de verdade é isolar só o que vai para `responder(...)` — que é o
  // JSON que sai para a página — e checar que a chave `senha` não aparece
  // ali. O parâmetro do rpc fica de fora porque nunca está dentro de uma
  // chamada a `responder(`. E a chamada é lida INTEIRA (ver
  // `chamadasDeResponder` acima), não só até o primeiro `)`.
  const chamadas = chamadasDeResponder(FONTE);
  assert.ok(chamadas.length > 0, 'não achei nenhuma chamada a responder() no arquivo');
  for (const chamada of chamadas) {
    assert.ok(!/\bsenha\s*[,:]/.test(chamada),
      `a resposta não pode conter a senha em claro: ${chamada}`);
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
