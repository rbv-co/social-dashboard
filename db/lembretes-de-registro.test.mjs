import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * O lembrete é a única coisa deste projeto que manda e-mail para um endereço
 * que QUALQUER pessoa digitou numa página aberta, sem login. Se ele nascer
 * torto, vira uma porta de incomodar a dona de uma peça pela caixa de entrada
 * dela — e, pior, uma porta de PERGUNTAR ao sistema se uma bolsa já tem dona,
 * bastando ler a resposta da tela.
 *
 * Cada teste aqui guarda uma coisa que já quebrou no projeto:
 *   · função nova nascendo alcançável por `anon`/`authenticated`
 *     (2026-09-17-vessel-contas-base.sql, "Grant não é o portão");
 *   · pgcrypto chamada sem `extensions.` com `search_path = public`
 *     (2026-09-16-vessel-pessoas-e-atendimentos.sql);
 *   · tabela nova nascendo sem RLS (2026-09-17-vessel-contas-base.sql);
 *   · a LISTA FECHADA de `vessel_edicoes.acao` redigitada por cima, apagando a
 *     ação de outra entrega (19/09/2026 — aconteceu no dia anterior a este).
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const ARQUIVO = '2026-09-19-zzz-vessel-lembretes-register-later.sql';
const BRUTO = readFileSync(join(AQUI, 'migrations', ARQUIVO), 'utf8');
const SQL = BRUTO.toLowerCase();
// ⚠️ ALGUMAS GUARDAS TÊM DE OLHAR SÓ O CÓDIGO. Este arquivo EXPLICA, em
// comentário, por que não mexe na lista de ações e por que não usa `random()`
// — e uma guarda que procura a palavra no texto inteiro reprovaria justamente
// a explicação que a torna desnecessária.
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

const AS_QUATRO = [
  'vessel_lembrete_criar',
  'vessel_lembrete_cancelar_por_token',
  'vessel_lembretes_a_enviar',
  'vessel_lembrete_marcar_enviado',
];

test('⚠️ o arquivo ordena DEPOIS das migrations de hoje — senão roda antes delas', () => {
  const doDia = readdirSync(join(AQUI, 'migrations'))
    .filter((n) => n.startsWith('2026-09-19-') && n !== ARQUIVO);
  for (const n of doDia) {
    assert.ok(ARQUIVO > n, `o nome tem de ordenar depois de ${n}`);
  }
});

test('⚠️ a tabela nova nasce com RLS ligada', () => {
  assert.match(SQL, /alter table public\.vessel_lembretes\s+enable row level security/,
    'tabela sem RLS cai na regra geral do projeto e vaza para qualquer logado');
});

test('⚠️ a única política é de SELECT, para admin do painel — escrita, zero', () => {
  const politicas = SQL.match(/create policy[^;]+on public\.vessel_lembretes[^;]+;/g) ?? [];
  assert.equal(politicas.length, 1, 'esperava UMA política só');
  assert.match(politicas[0], /for select to authenticated/);
  assert.match(politicas[0], /is_vessel_admin\(\)/);
  for (const escrita of ['for insert', 'for update', 'for delete', 'for all']) {
    assert.ok(!politicas[0].includes(escrita),
      `a tabela não pode aceitar ${escrita} por política: só por função security definer`);
  }
});

test('⚠️ UM lembrete aberto por peça — índice único PARCIAL, como o desenho manda', () => {
  const m = SQL.match(/create unique index[^;]+on public\.vessel_lembretes[^;]+;/);
  assert.ok(m, 'falta o índice único de "um lembrete aberto por peça"');
  assert.match(m[0], /\(\s*peca_codigo\s*\)/, 'a chave é a PEÇA, não a peça mais o e-mail');
  assert.match(m[0], /where\s+cancelado_em is null and enviado_30_em is null/);
});

test('⚠️ o token do link de cancelar é SORTEADO no banco e guardado só em hash', () => {
  const enviar = corpo('vessel_lembretes_a_enviar');
  assert.match(enviar, /extensions\.gen_random_bytes\(/,
    'random() do Postgres é semeado por sessão: quem vê alguns tokens continua a sequência');
  assert.ok(!/\brandom\s*\(\s*\)/.test(
    enviar.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')),
    'random() não serve para esconder nada');
  assert.match(enviar, /token_hash\s*=\s*encode\(extensions\.digest\(/,
    'o que fica gravado é o HASH do token, nunca o token');

  // A coluna se chama token_hash e NÃO existe coluna de token em claro.
  assert.match(SQL, /token_hash\s+text/);
  assert.ok(!/^\s*token\s+text/m.test(SQL), 'não pode existir coluna de token em claro');

  // Só `a_enviar` devolve o token em claro — é ela que monta o link do e-mail.
  for (const nome of ['vessel_lembrete_criar', 'vessel_lembrete_cancelar_por_token',
                      'vessel_lembrete_marcar_enviado']) {
    assert.ok(!/'token'/.test(corpo(nome)),
      `${nome} não pode devolver o token: ele só existe dentro do e-mail`);
  }
});

test('⚠️ criar lembrete responde A MESMA COISA quando a peça já tem dona, já tem lembrete ou já foi pedida hoje', () => {
  const f = corpo('vessel_lembrete_criar');

  // As três situações são sobre a PEÇA, e nenhuma pode virar sinal diferente
  // na tela: quem digita um código alheio não pode descobrir, pela resposta,
  // se aquela bolsa já é de alguém.
  for (const vazado of ['ja_registrada', 'ja_tem_dona', 'ja_tem_lembrete',
                        'muitos_pedidos', 'ja_pedido', 'peca_nao_existe']) {
    assert.ok(!f.includes(vazado),
      `"${vazado}" contaria à cliente o estado da peça — a resposta tem de ser sempre a mesma`);
  }

  // Só o que a PRÓPRIA pessoa digitou pode virar recusa: ela precisa saber
  // para corrigir, e nada disso fala da peça.
  assert.match(f, /'sem_consentimento'/);
  assert.match(f, /'email_invalido'/);

  // E a peça já registrada tem de ser conferida de verdade.
  assert.match(f, /from public\.vessel_registros/,
    'peça já registrada não aceita lembrete');
});

test('⚠️ teto de UM pedido por peça a cada 24h', () => {
  const f = corpo('vessel_lembrete_criar');
  assert.match(f, /interval\s+'24 hours'/,
    'sem teto, o lembrete vira uma porta de incomodar a dona de uma peça');
});

test('⚠️ teto de 3 lembretes por E-MAIL a cada 24h', () => {
  // Decisão do dono, 19/09/2026. O teto por peça sozinho não segura o abuso
  // que importa: com uma lista de códigos de peça na mão, um pedido por peça
  // ainda é UM e-mail por peça — e todos podem apontar para o MESMO endereço.
  // Sem este segundo teto, a marca vira um jeito de mandar e-mail para
  // qualquer pessoa, com o remetente da VESSEL.
  const f = corpo('vessel_lembrete_criar');
  assert.match(f, /email = v_email[\s\S]{0,200}interval\s+'24 hours'/,
    'falta o teto por e-mail: contar por peça não impede apontar 50 peças para o mesmo endereço');
  assert.match(f, />=\s*3|>\s*2/, 'o teto do dono é 3 por dia');

  // E ele é CEGO, como os outros do estado da peça: quem estourou não pode
  // descobrir isso pela resposta.
  for (const vazado of ['muitos_lembretes', 'teto_de_email', 'email_demais']) {
    assert.ok(!f.includes(vazado), `"${vazado}" contaria que o teto existe`);
  }
});

test('⚠️ o teto por e-mail tem índice — senão a conferência varre a tabela toda', () => {
  assert.match(SQL, /create index[^;]+on public\.vessel_lembretes\s*\(\s*email\s*,/);
});

test('⚠️ o e-mail é guardado com trim e minúsculo, e a trava é do BANCO', () => {
  const f = corpo('vessel_lembrete_criar');
  assert.match(f, /lower\(\s*btrim\(/, 'o e-mail entra normalizado');
  // E o CHECK impede que outro caminho grave cru.
  assert.match(SQL, /check\s*\(\s*email\s*=\s*lower\(btrim\(email\)\)/,
    'falta o CHECK que garante o e-mail normalizado na tabela');
});

test('⚠️ o código da peça é normalizado, e a trava é do BANCO', () => {
  // O índice único de "um aberto por peça" é sobre esta coluna: um
  // "tbnwxas28a" e um "TBNWXAS-28A" gravados crus seriam DUAS peças para o
  // índice e UMA peça para a cliente.
  assert.match(SQL, /check\s*\(peca_codigo = upper\(regexp_replace\(peca_codigo/);
});

test('⚠️ o lembrete aberto MORRE quando a peça ganha registro — por gatilho', () => {
  // A medição de 19/09/2026 está no cabeçalho da migration: UMA função insere
  // em vessel_registros hoje, e a tabela só aceita escrita por função security
  // definer. O gatilho pega essa e qualquer outra que nasça amanhã, sem tocar
  // no que `vessel_decidir_pedido_de_registro` já faz.
  assert.match(SQL, /after insert on public\.vessel_registros/);
  const g = SQL.match(/create or replace function public\.vessel_lembretes_morre_com_o_registro[\s\S]*?\$\$;/);
  assert.ok(g, 'falta a função do gatilho');
  assert.match(g[0], /cancelado_por\s*=\s*'registro'/);
  assert.match(g[0], /cancelado_em is null/, 'não pode reescrever um cancelamento que já existe');
});

test('⚠️ cancelar por token nunca conta nada — mesma resposta com token certo, errado ou vazio', () => {
  const f = corpo('vessel_lembrete_cancelar_por_token');
  const retornos = f.match(/return json_build_object\([^;]*\);/g) ?? [];
  assert.ok(retornos.length > 0, 'a função tem de devolver alguma coisa');
  for (const r of retornos) {
    assert.match(r, /'ok',\s*true/, `token errado não pode virar resposta diferente: ${r}`);
    assert.ok(!r.includes('motivo'), `nenhum motivo pode sair daqui: ${r}`);
  }
  assert.match(f, /cancelado_por\s*=\s*'cliente'/);
  assert.match(f, /extensions\.digest\(/, 'a busca é pelo HASH do token');
});

test('⚠️ a fila do robô só traz vencido cuja peça continua SEM registro', () => {
  const f = corpo('vessel_lembretes_a_enviar');
  assert.match(f, /interval\s+'7 days'/);
  assert.match(f, /interval\s+'30 days'/);
  assert.match(f, /cancelado_em is null/);
  assert.match(f, /not exists[\s\S]{0,120}vessel_registros/,
    'peça que ganhou dona sai da fila na hora, mesmo que o gatilho falhe');
});

test('⚠️ marcar enviado não repete: a segunda chamada não reescreve a data', () => {
  const f = corpo('vessel_lembrete_marcar_enviado');
  assert.match(f, /enviado_7_em\s*=\s*now\(\)[\s\S]{0,160}enviado_7_em is null/,
    'a marca de 7 dias só é gravada se ainda não existir');
  assert.match(f, /enviado_30_em\s*=\s*now\(\)[\s\S]{0,160}enviado_30_em is null/,
    'a marca de 30 dias só é gravada se ainda não existir');
});

test('⚠️ as quatro funções são security definer com search_path fixo', () => {
  for (const nome of AS_QUATRO) {
    const f = corpo(nome);
    assert.match(f, /security definer/, `${nome} precisa ser security definer`);
    assert.match(f, /set search_path to 'public'/, `${nome} precisa fixar o search_path`);
  }
});

test('⚠️ o portão: revoke de public, anon E authenticated; grant só a service_role', () => {
  for (const nome of AS_QUATRO) {
    const re = new RegExp(`'${nome}\\([^)]*\\)'`);
    assert.match(SO_CODIGO, re, `${nome} tem de estar na lista do portão`);
  }
  assert.match(SO_CODIGO, /revoke all on function public\.%s from public, anon, authenticated/,
    '`revoke from public` NÃO fecha anon/authenticated: os papéis herdam direito próprio');
  assert.match(SO_CODIGO, /grant execute on function public\.%s to service_role/);
});

test('⚠️ pgcrypto sempre qualificada com extensions.', () => {
  for (const f of ['crypt(', 'gen_salt(', 'digest(', 'gen_random_bytes(']) {
    const solto = new RegExp(`(?<!extensions\\.)\\b${f.replace('(', '\\(')}`);
    assert.ok(!solto.test(SQL), `${f} sem o prefixo extensions. quebra com search_path=public`);
  }
});

test('⚠️ esta migration NÃO redigita a lista fechada de vessel_edicoes.acao', () => {
  // 19/09/2026: redigitar a lista por cima apagou a ação de outra entrega. O
  // lembrete não precisa de ação nova na trilha — então não encosta na lista.
  assert.ok(!/vessel_edicoes_acao_check/.test(SO_CODIGO),
    'o lembrete não precisa de ação nova; mexer na lista fechada apagaria a de outra entrega');
  assert.ok(!/insert into public\.vessel_edicoes/.test(SO_CODIGO),
    'o lembrete não escreve na trilha: a lista dele é a própria tabela');
});
