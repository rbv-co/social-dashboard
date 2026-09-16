// PROVA QUE A PORTA ESTÁ FECHADA — com a chave que qualquer visitante tem.
//
//   node coletor/provar-porta-de-vessel-pessoas.mjs
//
// A chave anônima da Supabase está DENTRO do JavaScript de vesselbrasil.com.br.
// Qualquer pessoa que abra a página tem essa chave. Então a única pergunta que
// importa sobre estas tabelas é: com essa chave na mão, dá para ler a lista de
// nomes e telefones das clientes?
//
// ⚠️ TESTAR PELA PORTA PÚBLICA, NUNCA POR DENTRO. Um `select` com a chave de
// serviço provaria o caminho errado — ela passa por cima de tudo. Aqui se usa
// exatamente o que está no HTML.
//
// A prova cria UMA linha de teste e a APAGA no fim, dos dois lados.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const PAGINA = new URL('../vessel-brasil/vesseluniverse/pagina.mjs', import.meta.url)
const fonte = readFileSync(PAGINA, 'utf8')
const URL_BANCO = fonte.match(/https:\/\/[a-z0-9]+\.supabase\.co/)[0]
const CHAVE = fonte.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/)[0]

const cab = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' };
const TABELAS = ['vessel_pessoas', 'vessel_origens', 'vessel_atendimentos',
                 'vessel_permissoes', 'vessel_convite_aberturas'];
// ⚠️ COM ARGUMENTOS DE VERDADE. A primeira versão desta prova chamava as
// internas sem argumento nenhum, levava 404 ("não achei função com essa
// assinatura") e eu li como "fechada". Chamada com os argumentos certos,
// `vessel_pessoa_por_telefone` respondia 200 E GRAVAVA — qualquer visitante
// podia criar pessoas à vontade. Prova que passa por engano é pior que prova
// nenhuma.
const INTERNAS = [
  ['vessel_pessoa_por_telefone', { p_nome: 'SONDA APAGAR', p_telefone: '(19) 90000-0009' }],
  ['vessel_novo_codigo_de_convite', {}],
  ['vessel_hash_de_origem', {}],
  ['vessel_telefone_canonico', { p_bruto: '(19) 99999-8888' }],
];

let falhas = 0;
const conta = (ok, texto) => { console.log(`  ${ok ? 'ok  ' : '⛔  '} ${texto}`); if (!ok) falhas++; };

console.log(`\nusando a chave que está no HTML de ${URL_BANCO}\n`);
console.log('LER as tabelas, como um visitante faria:');
for (const t of TABELAS) {
  const r = await fetch(`${URL_BANCO}/rest/v1/${t}?select=*&limit=1`, { headers: cab });
  const corpo = await r.text();
  // Sem política, o PostgREST devolve 200 com lista VAZIA — não erro. Lista
  // vazia é o resultado certo, e é fácil confundir com "a tabela está vazia".
  conta(r.ok ? corpo.trim() === '[]' : true,
    `${t.padEnd(26)} HTTP ${r.status}  ${corpo.slice(0, 40)}`);
}

console.log('\nESCREVER direto na tabela, pulando a função:');
const r = await fetch(`${URL_BANCO}/rest/v1/vessel_pessoas`, {
  method: 'POST', headers: cab,
  body: JSON.stringify({ nome: 'invasao', telefone: '5519000000000' }),
});
conta(!r.ok, `insert direto            HTTP ${r.status} (tem de ser recusado)`);

console.log('\nCHAMAR as funções internas, que ninguém de fora deveria alcançar:');
for (const [f, argumentos] of INTERNAS) {
  const r = await fetch(`${URL_BANCO}/rest/v1/rpc/${f}`, {
    method: 'POST', headers: cab, body: JSON.stringify(argumentos),
  });
  const corpo = (await r.text()).slice(0, 50);
  // 404 aqui é resposta legítima: sem permissão, o PostgREST nem enxerga a
  // função. O que NÃO pode é 200.
  conta(r.status !== 200, `${f.padEnd(30)} HTTP ${r.status}  ${corpo}`);
}

console.log('\nA PORTA QUE DEVE ABRIR — registrar um cartão:');
const quando = new Date(Date.now() + 86400000).toISOString();
const reg = await fetch(`${URL_BANCO}/rest/v1/rpc/vessel_registrar_cartao`, {
  method: 'POST', headers: cab,
  body: JSON.stringify({
    p_nome: 'PROVA APAGAR', p_whatsapp: '(19) 90000-0001', p_loja: 'iguatemi',
    p_quando: quando, p_client_advisor: 'CA-99',
  }),
});
const resposta = await reg.json();
conta(reg.ok && resposta.ok === true && /^[A-Z0-9]{6}$/.test(resposta.codigo || ''),
  `vessel_registrar_cartao  HTTP ${reg.status}  ${JSON.stringify(resposta)}`);

console.log('\nA ARMADILHA — responde sucesso e NÃO grava:');
const robo = await fetch(`${URL_BANCO}/rest/v1/rpc/vessel_registrar_cartao`, {
  method: 'POST', headers: cab,
  body: JSON.stringify({
    p_nome: 'ROBO NAO GRAVAR', p_whatsapp: '(19) 90000-0002', p_loja: 'iguatemi',
    p_quando: quando, p_client_advisor: 'CA-99', p_armadilha: 'sou um robo',
  }),
});
conta(robo.ok && (await robo.json()).ok === true, `armadilha                HTTP ${robo.status}`);

// ── agora por dentro, com a chave de serviço, para CONFERIR e LIMPAR ─────────
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();
const { rows: [c] } = await cli.query(
  `select
     (select count(*) from vessel_pessoas where nome = 'PROVA APAGAR') as gravou,
     (select count(*) from vessel_pessoas where nome = 'ROBO NAO GRAVAR') as armadilha_gravou,
     (select count(*) from vessel_atendimentos a join vessel_pessoas p on p.id = a.pessoa_id
       where p.nome = 'PROVA APAGAR' and a.status = 'confirmado') as atendimento`);
console.log('\nconferindo por dentro:');
conta(Number(c.gravou) === 1, `a porta certa gravou 1 pessoa (achei ${c.gravou})`);
conta(Number(c.atendimento) === 1, `com 1 atendimento CONFIRMADO (achei ${c.atendimento})`);
conta(Number(c.armadilha_gravou) === 0, `a armadilha NAO gravou (achei ${c.armadilha_gravou})`);

const { rowCount } = await cli.query(`delete from vessel_pessoas where nome in ('PROVA APAGAR','ROBO NAO GRAVAR','invasao','SONDA APAGAR')`);
const { rows: [z] } = await cli.query(`select count(*) as sobrou from vessel_pessoas`);
conta(Number(z.sobrou) === 0, `limpeza: apaguei ${rowCount}, sobrou ${z.sobrou} (o atendimento vai junto, em cascata)`);
await cli.end();

console.log(falhas === 0 ? '\nA PORTA ESTA FECHADA. Nenhuma falha.\n'
                         : `\n⛔ ${falhas} FALHA(S).\n`);
process.exitCode = falhas === 0 ? 0 : 1;
