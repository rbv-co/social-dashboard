import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * A transferência de propriedade é a única porta pela qual uma peça troca de
 * dona SEM ninguém da equipe olhar. Se ela nascer torta, a bolsa de uma
 * cliente vai para o nome de outra pessoa — e é o tipo de estrago que só
 * aparece quando a dona de verdade reclama.
 *
 * Cada teste aqui guarda uma coisa que já quebrou no projeto:
 *   · função nova nascendo alcançável por `anon`/`authenticated`
 *     (2026-09-17-vessel-contas-base.sql, "Grant não é o portão");
 *   · pgcrypto chamada sem `extensions.` com `search_path = public`
 *     (2026-09-16-vessel-pessoas-e-atendimentos.sql);
 *   · ação nova na trilha fora do CHECK, derrubando a transação inteira
 *     (2026-09-05-vessel-edicoes-aceita-baixar-garantia.sql — aquela guarda
 *     mora em db/trilha-de-edicoes.test.mjs e continua valendo);
 *   · tabela nova nascendo sem RLS (2026-09-17-vessel-contas-base.sql).
 */

const ARQUIVO = '2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql';
const BRUTO = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'migrations', ARQUIVO), 'utf8');
const SQL = BRUTO.toLowerCase();
// ⚠️ ALGUMAS GUARDAS TÊM DE OLHAR SÓ O CÓDIGO. Este arquivo explica, em
// comentário, por que NÃO usa `random()` e por que NÃO chama `is_vessel_admin`
// — e uma guarda que procura a palavra no texto inteiro reprovaria justamente
// a explicação que a torna desnecessária. Aqui os comentários saem antes.
const SO_CODIGO = SQL.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');

// Recorta o corpo de uma função pelo nome, do `create ... function` dela até o
// próximo `create ... function` (ou o fim do arquivo).
function corpo(nome) {
  const inicio = SQL.indexOf(`function public.${nome}(`);
  assert.ok(inicio > -1, `não achei a função ${nome}`);
  const resto = SQL.slice(inicio);
  const proxima = resto.indexOf('create or replace function', 1);
  return proxima > -1 ? resto.slice(0, proxima) : resto;
}

// O mesmo recorte, mas sem os comentários.
function corpoSoCodigo(nome) {
  return corpo(nome).split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
}

const AS_QUATRO = [
  'vessel_transferencia_gerar',
  'vessel_transferencia_aberta',
  'vessel_transferencia_cancelar',
  'vessel_transferencia_aceitar',
];

test('⚠️ o arquivo ordena DEPOIS do zzzz- de 18/09 — senão roda antes da trava da dona', () => {
  // "zzzz-" < "zzzzz" porque o hífen é menor que a letra. A regra é a mesma
  // que 2026-09-18-zzzz-vessel-registro-nao-toma-peca-com-dona.sql explica no
  // cabeçalho dele, e já custou uma migration rodando fora de ordem.
  assert.ok(ARQUIVO > '2026-09-18-zzzz-vessel-registro-nao-toma-peca-com-dona.sql',
    'o nome tem de ordenar depois do zzzz- do mesmo dia');
});

test('⚠️ as duas tabelas novas nascem com RLS ligada e sem política nenhuma', () => {
  for (const t of ['vessel_transferencias', 'vessel_tentativas_de_transferencia']) {
    assert.match(SQL, new RegExp(`alter table public\\.${t}\\s+enable row level security`),
      `${t} sem RLS cai na regra geral do projeto e vaza para qualquer logado`);
    assert.ok(!new RegExp(`create policy[^;]+on public\\.${t}`).test(SQL),
      `${t} não pode ter política: convite e tentativa não se leem em tela`);
  }
});

test('⚠️ um convite aberto por peça — índice único PARCIAL', () => {
  const m = SQL.match(/create unique index[^;]+on public\.vessel_transferencias[^;]+;/);
  assert.ok(m, 'falta o índice único de "um convite aberto por peça"');
  assert.match(m[0], /\(\s*peca_codigo\s*\)/);
  assert.match(m[0], /where\s+usado_em is null and cancelado_em is null/);
});

test('⚠️ o código de 6 dígitos é SORTEADO com gen_random_bytes, nunca com random()', () => {
  const f = corpo('vessel_transferencia_gerar');
  assert.match(f, /extensions\.gen_random_bytes\(/,
    'random() do Postgres é previsível: quem vê alguns códigos continua a sequência');
  assert.ok(!/\brandom\s*\(\s*\)/.test(corpoSoCodigo('vessel_transferencia_gerar')),
    'random() não serve para esconder nada');
  // Rejeição, não resto direto: 256 não é múltiplo de 10, e `byte % 10` faria
  // os dígitos 0..5 saírem mais que 6..9 (mesma lição de
  // 2026-09-18-vessel-chave-do-convite-sorteada-a-serio.sql).
  assert.match(f, /256\s*-\s*\(\s*256\s*%/, 'falta a rejeição que tira o viés do sorteio');
});

test('⚠️ o código só existe em HASH — e só aparece na resposta da geração', () => {
  assert.match(SQL, /codigo_hash\s+text not null/);
  const gerar = corpo('vessel_transferencia_gerar');
  assert.match(gerar, /extensions\.crypt\([^)]*extensions\.gen_salt\('bf'/,
    'o código tem de ser guardado com bcrypt, como a senha');
  assert.match(gerar, /'codigo_transferencia'/, 'a geração é a única que devolve o código');

  for (const nome of ['vessel_transferencia_aberta', 'vessel_transferencia_cancelar',
                      'vessel_transferencia_aceitar']) {
    assert.ok(!/'codigo_transferencia'/.test(corpo(nome)),
      `${nome} não pode devolver o código: ele aparece UMA vez, na geração`);
  }
  // E nunca na trilha: vessel_edicoes é lida pelo painel.
  const trilha = SQL.match(/insert into public\.vessel_edicoes[\s\S]*?;/g) ?? [];
  assert.ok(trilha.length > 0, 'a transferência tem de deixar trilha');
  for (const linha of trilha) {
    assert.ok(!/codigo_transferencia|v_sorteado/.test(linha),
      `o código de transferência não pode ir para a trilha: ${linha}`);
  }
});

test('⚠️ pgcrypto sempre qualificada com extensions.', () => {
  for (const f of ['crypt(', 'gen_salt(', 'digest(', 'gen_random_bytes(']) {
    const solto = new RegExp(`(?<!extensions\\.)\\b${f.replace('(', '\\(')}`);
    assert.ok(!solto.test(SQL), `${f} sem o prefixo extensions. quebra com search_path=public`);
  }
});

test('⚠️ as quatro funções são security definer com search_path fixo', () => {
  for (const nome of AS_QUATRO) {
    const f = corpo(nome);
    assert.match(f, /security definer/, `${nome} sem security definer`);
    assert.match(f, /set search_path to 'public'/, `${nome} sem search_path fixo`);
  }
});

test('⚠️ as quatro funções são revogadas de anon E authenticated, uma a uma', () => {
  const bloco = SQL.match(/do \$\$[\s\S]*?end \$\$;/g)?.at(-1);
  assert.ok(bloco, 'falta o bloco do $$ que revoga e concede');
  const assinaturas = [
    'vessel_transferencia_gerar(text,text)',
    'vessel_transferencia_aberta(text,text)',
    'vessel_transferencia_cancelar(text,text)',
    'vessel_transferencia_aceitar(text,text,text)',
    'vessel_tentativa_de_transferencia(text)',
  ];
  for (const a of assinaturas) {
    assert.ok(bloco.includes(`'${a}'`), `falta ${a} no array que revoga/concede`);
  }
  assert.match(bloco, /revoke all on function public\.%s from public, anon, authenticated/);
  assert.match(bloco, /grant execute on function public\.%s to service_role/);
  assert.ok(!/grant execute on function[^;]*\bto\b[^;]*\b(anon|authenticated)\b/.test(SQL),
    'nenhuma função nova pode ganhar grant para anon ou authenticated');
});

test('⚠️ NADA aqui se passa por admin', () => {
  assert.ok(!/is_vessel_admin/.test(SO_CODIGO),
    'a transferência é da cliente: não usa nem desarma o portão de admin');
});

test('⚠️ o teto de tentativas vem ANTES de qualquer conferência', () => {
  const f = corpo('vessel_transferencia_aceitar');
  const teto = f.indexOf('vessel_tentativa_de_transferencia');
  const sessao = f.indexOf('vessel_conta_da_sessao');
  const convite = f.indexOf('from public.vessel_transferencias');
  const hash = f.indexOf('extensions.crypt');
  assert.ok(teto > -1, 'aceitar tem de consultar o teto');
  assert.ok(sessao > -1 && sessao < teto, 'a sessão é conferida antes do teto');
  assert.ok(convite > teto, 'o convite não pode ser procurado antes do teto');
  assert.ok(hash > teto, 'o hash não pode ser conferido antes do teto');
  assert.match(f, /'muitas_tentativas'/);
});

test('⚠️ o teto é de 5 por peça a cada 24h, no padrão de vessel_tentativa_de_presente', () => {
  const f = corpo('vessel_tentativa_de_transferencia');
  assert.match(f, /interval '24 hours'/);
  assert.match(f, /<=\s*5/, 'teto 5 (o do presente é 3; este é o da transferência)');
  // A contagem inclui a tentativa que está sendo feita: insere, depois conta —
  // é o que faz a 6ª errada cair no teto, e não a 7ª.
  const insere = f.indexOf('insert into public.vessel_tentativas_de_transferencia');
  const conta = f.indexOf('select count(*)');
  assert.ok(insere > -1 && conta > insere, 'insere primeiro, conta depois');
});

test('⚠️ aceitar confere prazo, cancelado, usado e a dona atual — e recusa sua_ja', () => {
  const f = corpo('vessel_transferencia_aceitar');
  assert.match(f, /vale_ate\s*>\s*now\(\)/, 'convite vencido não vale');
  assert.match(f, /usado_em is null/, 'convite usado não vale');
  assert.match(f, /cancelado_em is null/, 'convite cancelado não vale');
  assert.match(f, /'sua_ja'/, 'quem já é a dona não aceita o próprio convite');
  assert.match(f, /cliente_de/, 'a dona atual tem de continuar sendo quem gerou');
  assert.match(f, /'codigo_invalido'/);
});

test('⚠️ quem digita errado vê SEMPRE "codigo_invalido" — nunca um motivo que conte algo', () => {
  const f = corpo('vessel_transferencia_aceitar');
  const motivos = new Set((f.match(/'motivo',\s*'([a-z_]+)'/g) ?? [])
    .map((m) => m.match(/'([a-z_]+)'\s*$/)[1]));
  const permitidos = new Set(['sem_sessao', 'muitas_tentativas', 'codigo_invalido', 'sua_ja']);
  for (const m of motivos) {
    assert.ok(permitidos.has(m),
      `"${m}" conta para quem digitou errado algo que ele não deveria saber`);
  }
});

test('⚠️ a troca preserva garantia_ate, comprado_em, pedido_id, bling_pedido e bling_contato_id', () => {
  // ⚠️ MEDIDO EM 18/09/2026: `vessel_trocar_dono` (a função do painel) ZERA
  // pedido_id, bling_pedido e bling_contato_id — exatamente os campos que este
  // desenho manda preservar — e exige `is_vessel_admin()`, que a cliente nunca
  // tem. Por isso a troca é gravada aqui, direto, e não por ela.
  const f = corpo('vessel_transferencia_aceitar');
  const update = f.match(/update public\.vessel_registros[\s\S]*?where codigo/);
  assert.ok(update, 'falta o update de vessel_registros');
  for (const coluna of ['garantia_ate', 'comprado_em', 'pedido_id',
                        'bling_pedido', 'bling_contato_id', 'onde_comprou', 'registrado_em']) {
    assert.ok(!new RegExp(`\\b${coluna}\\s*=`).test(update[0]),
      `${coluna} não pode ser reescrito na transferência — a garantia é a original`);
  }
  // E o que MUDA de verdade tem de mudar: senão a peça continua no nome antigo.
  for (const coluna of ['nome', 'cpf', 'cliente_id']) {
    assert.match(update[0], new RegExp(`\\b${coluna}\\s*=`),
      `${coluna} tem de ser trocado: é o que faz a peça mudar de nome`);
  }
  // A função do painel pode ser CITADA no comentário que explica a decisão,
  // mas não pode ser CHAMADA: ela zera o elo com o Bling e exige admin.
  assert.ok(!/(select|perform)\s+(public\.)?vessel_trocar_dono\s*\(/.test(SO_CODIGO),
    'a função do painel zera o elo com o Bling e exige admin — não serve aqui');
});

test('⚠️ a ação nova da trilha está no MESMO arquivo, dentro do CHECK', () => {
  // Uma ação fora da lista fechada derruba a transação INTEIRA — e a tela só
  // diz "não consegui". Já aconteceu com `baixar_garantia` em 05/09/2026.
  const escrita = SQL.match(/insert into public\.vessel_edicoes[\s\S]{0,200}?values\s*\(\s*[^,]+,\s*'([a-z_]+)'/);
  assert.ok(escrita, 'não achei a escrita na trilha');
  const acao = escrita[1];
  const check = SQL.slice(SQL.lastIndexOf('vessel_edicoes_acao_check'));
  const lista = check.match(/array\s*\[([^\]]+)\]/);
  assert.ok(lista, `a ação "${acao}" é escrita mas o CHECK não é redefinido neste arquivo`);
  assert.ok(lista[1].includes(`'${acao}'`), `"${acao}" não está no CHECK deste arquivo`);
  // A lista só CRESCE: as onze anteriores continuam todas lá.
  for (const antiga of ['desmarcar_gravada', 'sobrescrever_para_fila', 'sobrescrever_para_baixa',
                        'registro_aprovado', 'registro_recusado', 'dono_trocado', 'baixar_garantia',
                        'lote_excluido', 'peca_excluida', 'etiqueta_adotada', 'numero_trocado']) {
    assert.ok(lista[1].includes(`'${antiga}'`), `sumiu "${antiga}" do CHECK`);
  }
});

test('⚠️ gerar e cancelar só funcionam para a dona ATUAL da peça', () => {
  for (const nome of ['vessel_transferencia_gerar', 'vessel_transferencia_aberta',
                      'vessel_transferencia_cancelar']) {
    const f = corpo(nome);
    assert.match(f, /'nao_e_sua'/, `${nome} tem de recusar quem não é a dona`);
    assert.match(f, /cliente_id/, `${nome} confere a dona pelo cliente_id do registro`);
  }
});

test('⚠️ gerar cancela o convite anterior antes de abrir o novo', () => {
  const f = corpo('vessel_transferencia_gerar');
  const cancela = f.indexOf('cancelado_em = now()');
  const insere = f.indexOf('insert into public.vessel_transferencias');
  assert.ok(cancela > -1 && insere > cancela,
    'sem cancelar antes, o índice único recusa o segundo convite e a tela trava');
});

test('⚠️ a peça precisa ser do lote de TESTE, como em vessel_registrar_como_cliente', () => {
  // A fase é de ensaio (/verify/novo). A trava mora no BANCO, não na tela:
  // "o padrão tem de ser SEGURO por si só, nunca depender de a chamadora
  // lembrar de pedir a trava" (2026-09-17-vessel-registro-com-conta.sql).
  const f = corpo('vessel_transferencia_gerar');
  assert.match(f, /l\.teste/);
  assert.match(f, /'fora_do_teste'/);
});

test('⚠️ o código digitado é normalizado só para dígitos antes de conferir', () => {
  const f = corpo('vessel_transferencia_aceitar');
  assert.match(f, /regexp_replace\(coalesce\(p_codigo_transferencia, ''\), '\\d', '', 'g'\)/);
});
