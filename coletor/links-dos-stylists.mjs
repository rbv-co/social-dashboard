// OS LINKS E OS QR DE CADA STYLIST DO CIRCLE (T07 do Growth Plan).
//
//   node coletor/links-dos-stylists.mjs                 # so mostra
//   node coletor/links-dos-stylists.mjs --qr [pasta]    # gera os PNG e confere
//
// ⚠️ A LISTA VEM DO BANCO, NUNCA DIGITADA AQUI. O critério de aceite do plano é
// "100% dos stylists ativos com ID próprio" — uma lista escrita à mão responde
// essa pergunta com a data em que alguém a escreveu. Esta ferramenta responde
// com a tabela de hoje, e avisa na cara quando alguma ficou sem código.
//
// ⚠️ CADA QR É LIDO DE VOLTA antes de sair. Teste de unidade prova que a conta
// bate; ele não prova que uma CÂMERA lê o desenho. Aqui o leitor do próprio
// macOS — o mesmo do iPhone — lê cada imagem gerada e o endereço tem de bater
// letra por letra. Material impresso não tem segunda chance.
import './lib/carregar-env.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import pg from 'pg';
import { desenharQR } from '../vessel-brasil/qr.mjs';
import { FORMATO, linkDaStylist, linkDoQr }
  from '../vessel-brasil/regras-do-rastreio-de-stylist.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'vessel-brasil');
const comQR = process.argv.includes('--qr');
const SAIDA = process.argv[process.argv.indexOf('--qr') + 1]?.startsWith('--') === false
  && process.argv[process.argv.indexOf('--qr') + 1]
  || join(SITE, 'entregas', 'O QUE DEPENDE DE VOCE', '3-links-e-qr-das-stylists');

/** PNG preto e branco, sem depender de biblioteca nenhuma. */
function png(matriz, escala = 16, margem = 4) {
  const lado = matriz.length;
  const px = (lado + margem * 2) * escala;
  const linhas = [];
  for (let y = 0; y < px; y++) {
    const linha = Buffer.alloc(px + 1, 255);
    linha[0] = 0;
    for (let x = 0; x < px; x++) {
      const mx = Math.floor(x / escala) - margem;
      const my = Math.floor(y / escala) - margem;
      const escuro = mx >= 0 && my >= 0 && mx < lado && my < lado && matriz[my][mx];
      linha[x + 1] = escuro ? 0 : 255;
    }
    linhas.push(linha);
  }
  const crc = (b) => {
    let c = ~0;
    for (const x of b) { c ^= x; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const pedaco = (tipo, dados) => {
    const t = Buffer.from(tipo, 'ascii');
    const tam = Buffer.alloc(4); tam.writeUInt32BE(dados.length);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, dados])));
    return Buffer.concat([tam, t, dados, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0); ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pedaco('IHDR', ihdr),
    pedaco('IDAT', deflateSync(Buffer.concat(linhas))),
    pedaco('IEND', Buffer.alloc(0)),
  ]);
}

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
await cli.connect();
// ⚠️ `teste` FORA: as stylists de ensaio não recebem material impresso.
const { rows } = await cli.query(
  `select codigo, nome, cidade, estagio, praca_preview
     from public.vessel_stylists
    where not coalesce(teste, false)
    order by codigo`);
await cli.end();

if (!rows.length) {
  console.log('Nenhuma stylist cadastrada ainda — a LP /stylist-circle/ e quem enche esta lista.');
  process.exit(0);
}

// O critério de aceite do plano, medido e não presumido.
const semCodigo = rows.filter((s) => !FORMATO.test(String(s.codigo || '')));
console.log(`${rows.length} stylists; ${rows.length - semCodigo.length} com ID proprio `
  + `(${Math.round((rows.length - semCodigo.length) / rows.length * 100)}%)\n`);

if (comQR) mkdirSync(SAIDA, { recursive: true });
let falhou = 0;
for (const s of rows) {
  const link = linkDaStylist(s.codigo);
  console.log(`${s.codigo}  ${s.nome}${s.cidade ? ' — ' + s.cidade : ''}  [${s.estagio}]`);
  console.log(`     ${link}`);
  if (!comQR) continue;

  const endereco = linkDoQr(s.codigo);
  const arquivo = join(SAIDA, `${s.codigo}.png`);
  writeFileSync(arquivo, png(desenharQR(endereco)));
  let lido = '(nao leu)';
  try {
    lido = execFileSync('swift', [join(SITE, 'ferramentas/conferir-qr.swift'), arquivo],
      { encoding: 'utf8' }).trim();
  } catch { /* fica como nao leu */ }
  if (lido !== endereco) {
    falhou++;
    console.log(`  ⛔ QR: a camera leu "${lido}", esperava "${endereco}"`);
  } else {
    console.log(`  ok QR (lido pela camera): ${endereco}`);
  }
}

if (semCodigo.length) {
  console.log(`\n⛔ ${semCodigo.length} SEM ID PROPRIO: `
    + semCodigo.map((s) => s.nome).join(', ')
    + '\n   O criterio do plano e 100%. Elas nao tem como ser medidas.');
  process.exitCode = 1;
}
if (comQR) {
  console.log(`\n${rows.length} QR em ${SAIDA}`);
  if (falhou) {
    console.log(`\n⛔ ${falhou} NAO FORAM LIDOS PELA CAMERA. Nao mande imprimir.`);
    process.exitCode = 1;
  }
}
