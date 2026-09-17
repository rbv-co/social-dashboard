// supabase/functions/vessel-conta/porta.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const FONTE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'index.ts'), 'utf8');

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
  // chamada a `responder(`.
  const chamadasDeResponder = FONTE.match(/responder\([^)]*\)/gs) ?? [];
  assert.ok(chamadasDeResponder.length > 0, 'não achei nenhuma chamada a responder() no arquivo');
  for (const chamada of chamadasDeResponder) {
    assert.ok(!/\bsenha\s*[,:]/.test(chamada),
      `a resposta não pode conter a senha em claro: ${chamada}`);
  }
});

test('⚠️ a edge não responde nada sem passar pelas funções do banco', () => {
  assert.ok(!/from\('vessel_clientes'\)/.test(FONTE),
    'acesso direto à tabela contorna as travas — tem de ser por rpc');
  assert.match(FONTE, /rpc\('vessel_conta_entrar'/);
});

test('a edge trata as seis ações', () => {
  for (const acao of ['criar', 'entrar', 'sair', 'esqueci', 'editar', 'eu']) {
    assert.ok(FONTE.includes(`'${acao}'`), `falta a ação ${acao}`);
  }
});

test('⚠️ "esqueci" responde IGUAL exista ou não o perfil: sem e-mail, sem motivo', () => {
  // Requisito extra de uma revisão do banco (17/09/2026): a função
  // `vessel_conta_nova_senha` devolve o e-mail real quando o perfil existe —
  // é assim que a edge sabe para onde mandar a senha nova. Mas esse e-mail
  // NUNCA pode chegar na resposta para a página: se chegasse, "esqueci minha
  // senha" virava um jeito de descobrir se um CPF/e-mail é cliente da marca
  // (perfil existe → resposta com email; perfil não existe → resposta sem
  // email). A página só pode receber `{ok:true}` seco, sempre igual.
  //
  // Isola o bloco da ação "esqueci" (do próprio `if` até o próximo `if
  // (corpo.acao ===` ou o fim do arquivo), para não confundir com as outras
  // ações — "criar", por exemplo, devolve `email_mascarado` de propósito.
  const inicio = FONTE.indexOf("corpo.acao === 'esqueci'");
  assert.ok(inicio > -1, 'não achei o bloco da ação esqueci');
  const resto = FONTE.slice(inicio);
  const proximoIf = resto.indexOf('corpo.acao ===', 1);
  const bloco = proximoIf > -1 ? resto.slice(0, proximoIf) : resto;

  // Toda chamada a responder(...) dentro do bloco é o que a página recebe.
  const chamadas = bloco.match(/responder\([^)]*\)/gs) ?? [];
  assert.ok(chamadas.length > 0, 'não achei nenhuma chamada a responder() no bloco de "esqueci"');
  for (const chamada of chamadas) {
    assert.ok(!/email/i.test(chamada), `resposta de "esqueci" vazou email: ${chamada}`);
    assert.ok(!/motivo/i.test(chamada), `resposta de "esqueci" vazou motivo: ${chamada}`);
  }
});
