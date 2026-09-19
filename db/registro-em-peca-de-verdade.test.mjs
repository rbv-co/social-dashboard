import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/* ⚠️ POR QUE ESTE ARQUIVO EXISTE
 *
 * A Fase 2 TIRA uma trava. É o tipo de mudança em que o perigo não está no que
 * foi escrito, e sim no que sumiu junto sem ninguém notar. Cada teste aqui
 * guarda uma coisa que NÃO pode ter ido embora com a trava de lote de teste:
 *
 *   · a trava da dona (`ja_tem_dona`, `pedido_ja_usado`) e o portão do
 *     'bling', que moram em `vessel_decidir_pedido_de_registro` — esta
 *     migration não pode encostar nessa função
 *     (2026-09-18-zzzz-vessel-registro-nao-toma-peca-com-dona.sql);
 *   · o `nao_e_sua`, o teto de tentativas, o prazo do convite e "um convite
 *     aberto por peça" da transferência
 *     (2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql);
 *   · a assinatura de `vessel_registrar_como_cliente`: `create or replace`
 *     com assinatura diferente cria SOBRECARGA, e a versão velha — com a
 *     trava dentro — continuaria no ar e chamável
 *     (2026-09-17-vessel-registro-com-conta.sql, menor N4);
 *   · ação nova na trilha fora do CHECK derruba a transação inteira, e aqui
 *     isso significaria a CONTA não nascer
 *     (2026-09-05-vessel-edicoes-aceita-baixar-garantia.sql);
 *   · função nova nascendo alcançável por `anon`/`authenticated`
 *     (2026-09-17-vessel-contas-base.sql, "Grant não é o portão");
 *   · pgcrypto chamada sem `extensions.` com `search_path = public`;
 *   · e a regra do desenho: criar conta NÃO pode virar um jeito de descobrir
 *     se um CPF tem peça.
 */

const ARQUIVO = '2026-09-19-vessel-registro-em-peca-de-verdade.sql';
const BRUTO = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'migrations', ARQUIVO), 'utf8');
const SQL = BRUTO.toLowerCase();

// ⚠️ ALGUMAS GUARDAS TÊM DE OLHAR SÓ O CÓDIGO. Este arquivo EXPLICA, em
// comentário, onde a trava `fora_do_teste` morava e por que saiu — uma guarda
// que procurasse a palavra no texto inteiro reprovaria justamente a
// explicação que torna a mudança legível.
const semComentarios = (t) => t.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n');
const SO_CODIGO = semComentarios(SQL);

// Recorta o corpo de uma função pelo nome, do `create ... function` dela até o
// próximo `create ... function` (ou o fim do arquivo).
function corpo(nome) {
  const inicio = SQL.indexOf(`function public.${nome}(`);
  assert.ok(inicio > -1, `não achei a função ${nome}`);
  const resto = SQL.slice(inicio);
  const proxima = resto.indexOf('create or replace function', 1);
  return proxima > -1 ? resto.slice(0, proxima) : resto;
}
const corpoSoCodigo = (nome) => semComentarios(corpo(nome));

const AS_TRES = [
  'vessel_registrar_como_cliente',
  'vessel_transferencia_gerar',
  'vessel_conta_criar',
];

test('⚠️ o arquivo ordena DEPOIS dos zzzzz- de 18/09 — senão desfaz a trava da dona e a transferência', () => {
  // "zzzz-" e "zzzzz-" de 18/09 redefinem funções que esta migration também
  // redefine. Data maior ordena depois de qualquer sufixo "z" do dia anterior.
  assert.ok(ARQUIVO > '2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql',
    'o nome tem de ordenar depois dos arquivos de 18/09 que mexem nas mesmas funções');
  assert.ok(ARQUIVO > '2026-09-18-zzzz-vessel-registro-nao-toma-peca-com-dona.sql');
});

test('⚠️ a trava de lote de teste SAIU das duas funções', () => {
  for (const f of ['vessel_registrar_como_cliente', 'vessel_transferencia_gerar']) {
    const c = corpoSoCodigo(f);
    assert.ok(!/fora_do_teste/.test(c),
      `${f} ainda responde fora_do_teste — hoje NENHUM lote é marcado teste, então isso desliga a ferramenta inteira`);
    assert.ok(!/\bl\.teste\b/.test(c), `${f} ainda confere l.teste`);
  }
});

test('⚠️ a assinatura de vessel_registrar_como_cliente NÃO muda — senão vira sobrecarga', () => {
  // `create or replace` com assinatura diferente deixa as DUAS versões no ar,
  // e a velha (com a trava dentro, e com grant) continuaria chamável.
  const c = corpo('vessel_registrar_como_cliente');
  for (const p of ['p_token text', 'p_codigo text', 'p_onde text', 'p_comprado_em date',
                   'p_so_teste boolean', 'p_presente_de_nome text']) {
    assert.ok(c.includes(p), `sumiu o parâmetro ${p} — a assinatura tem de ficar idêntica`);
  }
  assert.ok(!/drop function[^;]*vessel_registrar_como_cliente/.test(SO_CODIGO),
    'um drop aqui apagaria os grants junto e deixaria a função sem portão até o bloco do fim');
});

test('⚠️ o que segura a peça continua de pé na geração do convite', () => {
  const c = corpoSoCodigo('vessel_transferencia_gerar');
  assert.match(c, /'nao_e_sua'/, 'só a dona registrada gera convite');
  assert.match(c, /for no key update/, 'sem travar a linha da peça, gerar e aceitar se cruzam');
  assert.match(c, /update public\.vessel_transferencias\s+set cancelado_em = now\(\)/,
    'gerar de novo tem de cancelar o convite anterior, senão o índice único trava a tela');
  assert.match(c, /extensions\.gen_random_bytes\(/, 'o sorteio é criptográfico');
  assert.ok(!/\brandom\s*\(\s*\)/.test(c), 'random() do Postgres é previsível');
  assert.match(c, /256\s*-\s*\(\s*256\s*%/, 'falta a rejeição que tira o viés do sorteio');
  assert.match(c, /interval '7 days'/, 'o prazo do convite continua sendo 7 dias');
});

test('⚠️ esta migration NÃO encosta na trava da dona nem no portão do bling', () => {
  for (const f of ['vessel_decidir_pedido_de_registro', 'vessel_tentativa_de_transferencia',
                   'vessel_transferencia_aceitar', 'vessel_abrir_pedido_de_registro']) {
    assert.ok(!new RegExp(`create or replace function public\\.${f}\\(`).test(SO_CODIGO),
      `${f} não pode ser redefinida aqui: é dela que vêm ja_tem_dona, pedido_ja_usado, o portão do 'bling' e o teto de tentativas`);
  }
  assert.ok(!/is_vessel_admin/.test(SO_CODIGO),
    'estas são as portas da CLIENTE: nada aqui se passa por admin');
});

test('⚠️ a ação nova da trilha entra no CHECK, no MESMO arquivo, sem perder nenhuma antiga', () => {
  const m = SO_CODIGO.match(/add constraint vessel_edicoes_acao_check[\s\S]*?\)\);/);
  assert.ok(m, 'faltou refazer o CHECK — ação nova fora dele derruba a transação e a conta não nasce');
  const lista = m[0];
  const AS_DOZE = ['desmarcar_gravada', 'sobrescrever_para_fila', 'sobrescrever_para_baixa',
    'registro_aprovado', 'registro_recusado', 'dono_trocado', 'baixar_garantia',
    'lote_excluido', 'peca_excluida', 'etiqueta_adotada', 'numero_trocado',
    'transferida_pela_dona'];
  for (const a of AS_DOZE) assert.ok(lista.includes(`'${a}'`), `a ação ${a} sumiu da lista`);
  assert.ok(lista.includes("'conta_ligada_pelo_cpf'"), 'faltou a ação nova');
  assert.match(corpoSoCodigo('vessel_conta_criar'), /'conta_ligada_pelo_cpf'/,
    'quem escreve a ação e quem a põe na lista têm de estar no mesmo arquivo');
});

test('⚠️ criar conta liga pelo CPF NORMALIZADO e só o que está sem dona de conta', () => {
  const c = corpoSoCodigo('vessel_conta_criar');
  for (const tabela of ['vessel_registros', 'vessel_pedidos_de_registro']) {
    const bloco = c.slice(c.indexOf(`update public.${tabela}`));
    assert.ok(bloco.includes('cliente_id is null'),
      `${tabela}: sem "cliente_id is null" a conta nova tomaria a peça de quem já é dona por coincidência de CPF`);
    assert.match(bloco.slice(0, 400), /regexp_replace\(coalesce\([a-z_]+\.cpf, ''\), '\\d', '', 'g'\)/,
      `${tabela}: o CPF antigo pode estar gravado com ponto e traço — casar sem normalizar não acha nada`);
  }
  assert.ok(!/order by|limit/.test(c.slice(c.indexOf('update public.vessel_registros'))),
    'ligar é para TODAS as linhas daquele CPF, não para a mais recente');
});

test('⚠️ criar conta NÃO vira um jeito de descobrir se um CPF tem peça', () => {
  const c = corpoSoCodigo('vessel_conta_criar');
  const respostas = c.match(/return json_build_object\([\s\S]*?\);/g) ?? [];
  const okFinal = respostas.filter((r) => r.includes("'ok', true"));
  assert.equal(okFinal.length, 1, 'só existe uma resposta de sucesso');
  assert.match(okFinal[0], /'ok', true, 'cliente_id', v_id, 'email', v_email/,
    'a resposta tem de ser a MESMA de antes: {ok, cliente_id, email} e nada mais');
  for (const proibido of ['pecas', 'quantas', 'ligadas', 'ligados', 'tem_peca', 'registros']) {
    assert.ok(!new RegExp(`'${proibido}'`).test(okFinal[0]),
      `a resposta não pode contar "${proibido}": seria ler, no cadastro, quem tem bolsa em casa`);
  }
});

test('⚠️ a trilha leva o CPF MASCARADO e feito_por nulo — ninguém da Central fez isto', () => {
  const c = corpoSoCodigo('vessel_conta_criar');
  const insercoes = c.match(/insert into public\.vessel_edicoes[\s\S]*?\);/g) ?? [];
  assert.ok(insercoes.length >= 2, 'a trilha grava para registros e para pedidos');
  for (const i of insercoes) {
    assert.match(i, /public\.vessel_cpf_mascarado\(/,
      'vessel_edicoes é lida no painel: CPF inteiro não entra na trilha');
    assert.match(i, /,\s*null\)\s*;/, 'feito_por fica nulo: quem fez foi a cliente, que não tem login do Supabase');
  }
});

test('⚠️ as três funções são security definer com search_path preso', () => {
  for (const f of AS_TRES) {
    const c = corpo(f);
    assert.match(c, /security definer/, `${f} sem security definer não enxerga as tabelas`);
    assert.match(c, /set search_path to 'public'/,
      `${f} sem search_path preso é caminho de escalada por tabela plantada`);
  }
});

test('⚠️ pgcrypto vem sempre qualificada com extensions.', () => {
  for (const chamada of SO_CODIGO.match(/\b(crypt|gen_salt|gen_random_bytes|digest)\s*\(/g) ?? []) {
    const nome = chamada.replace(/\s*\($/, '');
    const solta = new RegExp(`(^|[^.a-z_])${nome}\\s*\\(`, 'g');
    for (const m of SO_CODIGO.matchAll(solta)) {
      const antes = SO_CODIGO.slice(Math.max(0, m.index - 12), m.index + m[0].length);
      assert.ok(antes.includes('extensions.'),
        `${nome} sem "extensions." quebra com search_path = public — perto de: ${antes}`);
    }
  }
});

test('⚠️ o portão: revoke dos TRÊS papéis, grant só para service_role', () => {
  const portao = SO_CODIGO.slice(SO_CODIGO.lastIndexOf('do $$'));
  assert.match(portao, /revoke all on function public\.%s from public, anon, authenticated/,
    '"revoke from public" sozinho NÃO fecha anon/authenticated: eles têm direito próprio');
  assert.match(portao, /grant execute on function public\.%s to service_role/);
  for (const f of AS_TRES) {
    assert.ok(portao.includes(`'${f}(`), `${f} ficou de fora da lista do portão`);
  }
});
