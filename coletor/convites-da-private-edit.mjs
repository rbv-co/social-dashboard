// OS CONVITES DA VESSEL PRIVATE EDIT — "Hosted by [stylist]".
//
//   node coletor/convites-da-private-edit.mjs                      # lista os encontros e os links
//   node coletor/convites-da-private-edit.mjs --qr [pasta]         # + os QR, lidos de volta pela câmera
//   node coletor/convites-da-private-edit.mjs --criar STY-0001 "2026-10-15 19:00" \
//        --local "Loja do Iguatemi Campinas" --praca CPS --loja iguatemi [--vagas 8]
//
// É o passo D-10 do checklist do módulo 07: "convite e link de origem".
//
// ⚠️ O LINK LEVA UMA CHAVE SORTEADA, NÃO O CÓDIGO DO CRM. `PE-20261015-CPS-01`
// se adivinha trocando a data, e a página do convite mostra o NOME da anfitriã.
// Os dois juntos entregariam a agenda de encontros da marca e quais stylists
// hospedam cada um.
import './lib/carregar-env.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import pg from 'pg';
import { desenharQR } from '../vessel-brasil/qr.mjs';
import { linkDoConvite } from '../vessel-brasil/regras-da-private-edit.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'vessel-brasil');
const arg = (nome) => {
  const i = process.argv.indexOf(nome);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : null;
};
const comQR = process.argv.includes('--qr');
const SAIDA = arg('--qr') || join(SITE, 'entregas', 'O QUE DEPENDE DE VOCE', '4-convites-das-private-edits');

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

// ── criar, quando pedido ────────────────────────────────────────────────────
const criar = process.argv.indexOf('--criar');
if (criar > -1) {
  const stylist = process.argv[criar + 1];
  const quando = process.argv[criar + 2];
  if (!stylist || !quando) {
    console.error('Faltou: --criar STY-0001 "2026-10-15 19:00"');
    await cli.end();
    process.exit(1);
  }
  // ⚠️ A HORA VAI COM O FUSO ESCRITO. Sem o -03 o banco leria como UTC e o
  // encontro das 19h viraria 16h no convite — a convidada chega na hora errada.
  const { rows: [{ r }] } = await cli.query(
    `select public.vessel_criar_private_edit($1, ($2 || '-03')::timestamptz, $3, $4, $5, $6, false) as r`,
    [stylist, quando, arg('--local'), arg('--praca'), arg('--loja'), Number(arg('--vagas') || 8)]);
  if (!r.ok) {
    console.error('⛔ não criei:', r.situacao);
    await cli.end();
    process.exit(1);
  }
  console.log(`✅ ${r.codigo} criado.\n   link do convite: ${linkDoConvite(r.chave)}\n`);
}

// ── listar ──────────────────────────────────────────────────────────────────
const { rows } = await cli.query(
  `select e.codigo, e.chave, e.quando, e.local, e.vagas, e.ativa,
          s.nome as anfitria, s.codigo as stylist,
          (select count(*)::int from public.vessel_atendimentos t
            where t.evento_codigo = e.codigo and not coalesce(t.teste, false)) as responderam
     from public.vessel_private_edits e
     join public.vessel_stylists s on s.id = e.stylist_id
    where not coalesce(e.teste, false)
    order by e.quando`);
await cli.end();

if (!rows.length) {
  console.log('Nenhuma Private Edit marcada ainda.');
  console.log('Marque uma com:  --criar STY-0001 "2026-10-15 19:00" --local "..." --praca CPS --loja iguatemi');
  process.exit(0);
}

if (comQR) mkdirSync(SAIDA, { recursive: true });
let falhou = 0;
for (const e of rows) {
  const dia = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
  }).format(e.quando);
  const link = linkDoConvite(e.chave);
  console.log(`\n${e.codigo}${e.ativa ? '' : '  (DESLIGADA)'}`);
  console.log(`  Hosted by ${e.anfitria} (${e.stylist})`);
  console.log(`  ${dia}${e.local ? ' · ' + e.local : ''}  ·  ${e.responderam}/${e.vagas || '?'} responderam`);
  console.log(`  ${link}`);
  if (!comQR) continue;

  const arquivo = join(SAIDA, `${e.codigo}.png`);
  writeFileSync(arquivo, png(desenharQR(link)));
  // A prova: o leitor do macOS lê a imagem e tem de devolver o mesmo endereço.
  let lido = '(nao leu)';
  try {
    lido = execFileSync('swift', [join(SITE, 'ferramentas/conferir-qr.swift'), arquivo],
      { encoding: 'utf8' }).trim();
  } catch { /* fica como nao leu */ }
  if (lido !== link) { falhou++; console.log(`  ⛔ QR: a camera leu "${lido}"`); }
  else console.log('  ok QR (lido pela camera)');
}

if (comQR) {
  console.log(`\n${rows.length} QR em ${SAIDA}`);
  if (falhou) {
    console.log(`\n⛔ ${falhou} NAO FORAM LIDOS PELA CAMERA. Nao mande imprimir.`);
    process.exitCode = 1;
  }
}
