// PROVA QUE O TELEFONE É NORMALIZADO IGUAL EM TODO LUGAR.
//
//   node coletor/provar-telefone-bate-em-todo-lugar.mjs
//
// ⚠️ POR QUE ISTO EXISTE
// O telefone é a chave que liga a venda à pessoa. Ele é normalizado em TRÊS
// lugares hoje:
//
//   1. no banco       — `vessel_telefone_canonico`, que grava a pessoa;
//   2. no robô        — `coletor/trazer-pedidos-do-bling.mjs`, que casa a venda;
//   3. no site        — `vessel-brasil/regras-da-lista.mjs`, que valida o form.
//
// Se as três divergirem um dia, o casamento passa a dar ZERO — e dá zero
// CALADO: não há erro, não há exceção, só uma coluna `pessoa_id` que nunca
// preenche e um painel que diz que ninguém que preencheu formulário comprou.
//
// Este programa passa os mesmos números pelas três e exige o mesmo resultado.
import './lib/carregar-env.mjs';
import pg from 'pg';
import { whatsappCanonico } from '../vessel-brasil/regras-da-lista.mjs';

/** A cópia que vive no robô dos pedidos. Se mudar lá, mude aqui e o teste cai. */
function noRobo(bruto) {
  const d = String(bruto || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return '55' + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

const CASOS = [
  '(19) 99999-8888',      // como a loja digita
  '19999998888',          // só dígitos, com DDD
  '5519999998888',        // já canônico
  '+55 19 99999-8888',    // com o mais
  '19 3232-1010',         // fixo, 10 dígitos
  '551932321010',         // fixo já canônico
  ' 19  99999 8888 ',     // espaços a mais
  '9999-8888',            // sem DDD — não dá para usar
  '123',                  // lixo
  '',                     // vazio
];

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();
let falhas = 0;
console.log(`\n${'entrada'.padEnd(22)} ${'banco'.padEnd(15)} ${'robô'.padEnd(15)} site`);
for (const bruto of CASOS) {
  const { rows: [r] } = await cli.query('select vessel_telefone_canonico($1) as saida', [bruto]);
  const banco = r.saida;
  const robo = noRobo(bruto);
  // ⚠️ O do site tem uma finalidade diferente: ele valida o que a pessoa digita
  // num formulário e SEMPRE assume Brasil. Comparo só quando os outros dois
  // acharam um número usável — é o caso que importa para o casamento.
  let site = null;
  try { site = whatsappCanonico(bruto); } catch { site = null; }

  const bateEntreOsDois = banco === robo;
  const bateComOSite = banco === null || site === banco;
  const ok = bateEntreOsDois && bateComOSite;
  if (!ok) falhas++;
  console.log(`${(bruto || '(vazio)').padEnd(22)} ${String(banco).padEnd(15)} `
    + `${String(robo).padEnd(15)} ${String(site)}  ${ok ? '' : '⛔'}`);
}
await cli.end();

console.log(falhas === 0
  ? '\nAS TRES CONCORDAM. O casamento da venda com a pessoa nao vai dar zero por isso.\n'
  : `\n⛔ ${falhas} caso(s) em que elas discordam — o casamento daria zero, calado.\n`);
process.exit(falhas === 0 ? 0 : 1);
