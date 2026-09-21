// UM ARQUIVO .XLSX DE VERDADE, SEM BIBLIOTECA NENHUMA.
//
// Um .xlsx é um zip com XML dentro. São ~200 linhas de código nosso contra uma
// dependência nova, e a dependência custaria caro aqui: o robô das planilhas
// roda no GitHub Actions SEM `npm ci` (confira o `.yml`), e o repo inteiro tem
// só vue e vite. Trazer pacote obrigaria a mexer no CI de todo mundo.
//
// ⚠️ O TIPO MORA NA COLUNA, NÃO NA CÉLULA — E ISSO É O CONSERTO DO FUSO.
// Quem monta a planilha declara `{ titulo: 'Entrou em', tipo: 'instante' }` e
// entrega o valor CRU do banco. A conversão para a hora do Brasil acontece aqui
// dentro, num lugar só. Antes cada planilha cortava a string do jeito dela com
// `slice(0, 16)` e imprimia UTC; espalhado assim, o defeito volta na próxima
// coluna que alguém adicionar. Agora não há como imprimir hora errada sem mudar
// este arquivo.
//
// ⚠️ SÃO TRÊS TIPOS DE DATA, E TROCÁ-LOS PERDE UM DIA.
//   `dia`             → coluna `date` do Postgres ('2026-09-20'). Vai intocada.
//   `instante`        → coluna `timestamptz`. Convertida, sai com hora.
//   `dia-de-instante` → coluna `timestamptz` que o dono quer ver SÓ como dia.
// Passar uma data pura como `instante` a leria como meia-noite em UTC e
// devolveria o dia anterior. São 7 colunas `date` no banco da Vessel.
// E o contrário morde igual: "Entrou em" era um `timestamptz` cortado em 10
// letras, então todo cadastro feito depois das 21h saía no dia seguinte. Por
// isso existe o terceiro tipo em vez de cortar a string na mão.
//
// ⚠️ OS BYTES SÃO SEMPRE OS MESMOS PARA O MESMO CONTEÚDO (determinismo).
// O robô só sobe quando o arquivo difere do que está no Zoho, e a comparação é
// byte a byte. Zip guarda data e hora de cada arquivo interno: se eu usasse "a
// hora de agora", CADA rodada geraria bytes diferentes, o robô acharia que a
// planilha mudou e subiria versão nova a cada rodada, para sempre. Por isso a
// data interna é fixa (01/01/1980) e não há nada de aleatório aqui.
//
// ⚠️ ELE RODA EM DOIS LUGARES: no node (os testes e o ensaio) e no Deno da
// Supabase (a edge que escreve de verdade). Por isso NÃO PODE depender de
// `node:zlib` num `import` de topo: se aquele runtime não tiver o módulo, a
// função nem sobe — e cairia junto o cadastro no Bling, que mora na mesma edge.
// A compressão é TENTADA e, se não houver, o zip sai SEM COMPRIMIR (o formato
// zip aceita as duas coisas). Medido: 42 KB comprimido contra 379 KB sem. As
// duas saídas abrem no Excel, e há teste para cada uma.
//
// ✅ MEDIDO EM PRODUÇÃO (21/09/2026): o runtime da Supabase TEM `node:zlib`. A
// rodada de verdade gravou 42,8 KB, e não os 379 KB do caminho sem compressão.
//
// ⚠️ MAS OS BYTES NÃO SÃO IGUAIS ENTRE OS DOIS RUNTIMES: o mesmo conteúdo deu
// 42,4 KB no node e 42,8 KB no Deno, porque cada um traz a sua compilação do
// zlib. O determinismo que o robô precisa é DENTRO de um runtime só (a edge
// compara o que ela mesma gerou), e é isso que os testes provam. A consequência
// prática, pequena e conhecida: se alguém rodar o resgate manual em node, a
// rodada seguinte da edge vai achar que o arquivo mudou e regravar UMA vez.
import { paredeEmSaoPaulo } from './hora-de-sao-paulo.js';

// `null` = ainda não tentei; `false` = tentei e não existe.
let compressor;
async function acharCompressor() {
  if (compressor !== undefined) return compressor;
  try {
    const zlib = await import('node:zlib');
    compressor = zlib.deflateRawSync ?? false;
  } catch {
    compressor = false;
  }
  return compressor;
}

// ── XML ──────────────────────────────────────────────────────────────────────
// ⚠️ `&` PRIMEIRO, senão `&lt;` viraria `&amp;lt;`.
const xml = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  // Caractere de controle quebra o arquivo e o Excel se recusa a abrir, dizendo
  // só "conteúdo ilegível". Nome copiado de WhatsApp às vezes traz um.
  .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

const CABECA = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** A1, B1, ... Z1, AA1. Planilha com mais de 26 colunas existe (atribuição tem 14). */
export function letraDaColuna(n) {
  let s = '';
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) {
    s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  }
  return s;
}

// ── a conta do número que o Excel chama de data ──────────────────────────────
// O Excel conta dias desde 30/12/1899. Não é erro de digitação: ele acredita
// que 1900 foi bissexto (não foi), e o dia 0 em 30/12/1899 é o ajuste que faz
// todas as datas de 1900 para cá fecharem.
const ZERO_DO_EXCEL = Date.UTC(1899, 11, 30);
const DIA_EM_MS = 86400000;

const serialDeParede = ({ ano, mes, dia, hora = 0, minuto = 0, segundo = 0 }) =>
  (Date.UTC(ano, mes - 1, dia, hora, minuto, segundo) - ZERO_DO_EXCEL) / DIA_EM_MS;

/** 'AAAA-MM-DD' (ou 'AAAA-MM-DDT...') vindo de coluna `date`. SEM fuso. */
function serialDeDiaPuro(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  if (!m) return null;
  return serialDeParede({ ano: +m[1], mes: +m[2], dia: +m[3] });
}

// ── os estilos ───────────────────────────────────────────────────────────────
// A ordem aqui é a ordem dos `s="n"` nas células. Mexer na ordem sem mexer nos
// números troca o formato de todas as colunas de uma vez.
const ESTILO = { TEXTO: 0, CABECALHO: 1, DIA: 2, INSTANTE: 3, DINHEIRO: 4, NUMERO: 5 };

const ESTILOS = `${CABECA}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="164" formatCode="dd/mm/yyyy"/>
<numFmt numFmtId="165" formatCode="dd/mm/yyyy\\ hh:mm"/>
<numFmt numFmtId="166" formatCode="&quot;R$&quot;\\ #,##0.00"/>
</numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1A1A1A"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ── uma célula ───────────────────────────────────────────────────────────────
/**
 * Devolve o XML de uma célula, já com o tipo da coluna aplicado.
 * ⚠️ Vazio devolve célula AUSENTE, não célula com texto vazio: planilha com
 * milhares de células vazias declaradas fica pesada e o Excel a abre devagar.
 */
function celula(ref, valor, tipo) {
  if (valor === null || valor === undefined || valor === '') return '';

  if (tipo === 'instante' || tipo === 'dia-de-instante') {
    const h = paredeEmSaoPaulo(valor);
    if (!h) return '';
    if (tipo === 'dia-de-instante') {
      // Só o dia, mas o dia CERTO: zera a hora depois de converter o fuso.
      const s = serialDeParede({ ano: h.ano, mes: h.mes, dia: h.dia });
      return `<c r="${ref}" s="${ESTILO.DIA}"><v>${s}</v></c>`;
    }
    return `<c r="${ref}" s="${ESTILO.INSTANTE}"><v>${serialDeParede(h)}</v></c>`;
  }

  if (tipo === 'dia') {
    const s = serialDeDiaPuro(valor);
    // Texto que não é data cai como texto, em vez de sumir. Some, o dono não
    // descobre; texto na coluna de data ele vê na hora.
    if (s === null) return `<c r="${ref}" s="${ESTILO.TEXTO}" t="inlineStr"><is><t>${xml(valor)}</t></is></c>`;
    return `<c r="${ref}" s="${ESTILO.DIA}"><v>${s}</v></c>`;
  }

  if (tipo === 'dinheiro' || tipo === 'numero') {
    const n = Number(valor);
    if (!Number.isFinite(n)) return `<c r="${ref}" s="${ESTILO.TEXTO}" t="inlineStr"><is><t>${xml(valor)}</t></is></c>`;
    const s = tipo === 'dinheiro' ? ESTILO.DINHEIRO : ESTILO.NUMERO;
    return `<c r="${ref}" s="${s}"><v>${n}</v></c>`;
  }

  // Texto. `xml:space="preserve"` senão o Excel come espaço do começo e do fim.
  const t = String(valor);
  return `<c r="${ref}" s="${ESTILO.TEXTO}" t="inlineStr">`
       + `<is><t xml:space="preserve">${xml(t)}</t></is></c>`;
}

// ── uma aba ──────────────────────────────────────────────────────────────────
// ⚠️ NOME DE ABA TEM REGRA DO EXCEL, e quebrá-la faz o arquivo abrir com aviso
// de "conteúdo ilegível" — sem dizer qual aba. Teto de 31 caracteres e sem
// : \ / ? * [ ]
export function nomeDeAba(bruto, jaUsados = new Set()) {
  let n = String(bruto ?? '').replace(/[:\\/?*[\]]/g, '-').trim().slice(0, 31) || 'Aba';
  if (jaUsados.has(n.toLowerCase())) {
    // Sufixo numerado, ainda dentro dos 31.
    for (let i = 2; ; i++) {
      const tentativa = `${n.slice(0, 31 - String(i).length - 1)} ${i}`;
      if (!jaUsados.has(tentativa.toLowerCase())) { n = tentativa; break; }
    }
  }
  jaUsados.add(n.toLowerCase());
  return n;
}

function abaXml({ colunas, linhas }) {
  const ultima = letraDaColuna(colunas.length);
  const alcance = `A1:${ultima}${linhas.length + 1}`;

  const cabecalho = '<row r="1" ht="22" customHeight="1">' + colunas.map((c, i) =>
    `<c r="${letraDaColuna(i + 1)}1" s="${ESTILO.CABECALHO}" t="inlineStr">`
    + `<is><t>${xml(c.titulo)}</t></is></c>`).join('') + '</row>';

  const corpo = linhas.map((linha, y) => {
    const r = y + 2;
    const celulas = colunas.map((c, i) =>
      celula(`${letraDaColuna(i + 1)}${r}`, linha[i], c.tipo)).join('');
    return `<row r="${r}">${celulas}</row>`;
  }).join('');

  const larguras = colunas.map((c, i) =>
    `<col min="${i + 1}" max="${i + 1}" width="${c.largura ?? 18}" customWidth="1"/>`).join('');

  // ⚠️ A ORDEM DAS ETIQUETAS É EXIGIDA PELO FORMATO: dimension, sheetViews,
  // sheetFormatPr, cols, sheetData, autoFilter. Fora de ordem, o Excel recusa.
  return `${CABECA}
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<dimension ref="${alcance}"/>
<sheetViews><sheetView workbookViewId="0">
<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
</sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${larguras}</cols>
<sheetData>${cabecalho}${corpo}</sheetData>
<autoFilter ref="${alcance}"/>
</worksheet>`;
}

// ── o zip, em Uint8Array puro ────────────────────────────────────────────────
// ⚠️ SEM `Buffer`. O Deno não tem `Buffer` no escopo global (é do node), e um
// `Buffer.alloc` aqui derrubaria a edge inteira no primeiro uso — sem erro de
// compilação, só na hora de escrever a planilha.
const TEXTO = new TextEncoder();

const TABELA_CRC = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = -1;
  for (let i = 0; i < bytes.length; i++) c = TABELA_CRC[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function juntar(partes) {
  let total = 0;
  for (const p of partes) total += p.length;
  const fora = new Uint8Array(total);
  let onde = 0;
  for (const p of partes) { fora.set(p, onde); onde += p.length; }
  return fora;
}

// 01/01/1980 cravado: é o menor instante que o formato zip aceita, e é fixo
// porque bytes iguais para conteúdo igual é requisito (leia o topo do arquivo).
const DATA_FIXA = 0x0021;
const HORA_FIXA = 0x0000;

async function zipar(arquivos, comprimir) {
  // `comprimir: false` força o zip guardado. Existe para o teste provar que a
  // saída SEM compressão também abre — sem isso, o caminho que roda quando o
  // runtime não tem `node:zlib` nunca seria exercitado por teste nenhum.
  const deflate = comprimir === false ? false : await acharCompressor();
  const locais = [];
  const central = [];
  let deslocamento = 0;

  for (const { nome, conteudo } of arquivos) {
    const cru = TEXTO.encode(conteudo);
    // Sem compressor, o zip vai "guardado" (método 0) — maior e igualmente
    // válido. Com compressor, `deflate` cru (método 8).
    const comprimido = deflate ? new Uint8Array(deflate(cru, { level: 9 })) : cru;
    const metodo = deflate ? 8 : 0;
    const nomeBytes = TEXTO.encode(nome);
    const soma = crc32(cru);

    const local = new Uint8Array(30 + nomeBytes.length);
    const dl = new DataView(local.buffer);
    dl.setUint32(0, 0x04034b50, true);
    dl.setUint16(4, 20, true);              // versão mínima
    dl.setUint16(6, 0, true);               // sem sinalizadores
    dl.setUint16(8, metodo, true);
    dl.setUint16(10, HORA_FIXA, true);
    dl.setUint16(12, DATA_FIXA, true);
    dl.setUint32(14, soma, true);
    dl.setUint32(18, comprimido.length, true);
    dl.setUint32(22, cru.length, true);
    dl.setUint16(26, nomeBytes.length, true);
    dl.setUint16(28, 0, true);              // sem campo extra
    local.set(nomeBytes, 30);
    locais.push(local, comprimido);

    const c = new Uint8Array(46 + nomeBytes.length);
    const dc = new DataView(c.buffer);
    dc.setUint32(0, 0x02014b50, true);
    dc.setUint16(4, 20, true);
    dc.setUint16(6, 20, true);
    dc.setUint16(8, 0, true);
    dc.setUint16(10, metodo, true);
    dc.setUint16(12, HORA_FIXA, true);
    dc.setUint16(14, DATA_FIXA, true);
    dc.setUint32(16, soma, true);
    dc.setUint32(20, comprimido.length, true);
    dc.setUint32(24, cru.length, true);
    dc.setUint16(28, nomeBytes.length, true);
    dc.setUint32(42, deslocamento, true);   // sem comentário, sem disco
    c.set(nomeBytes, 46);
    central.push(c);

    deslocamento += local.length + comprimido.length;
  }

  const miolo = juntar(locais);
  const indice = juntar(central);
  const fim = new Uint8Array(22);
  const df = new DataView(fim.buffer);
  df.setUint32(0, 0x06054b50, true);
  df.setUint16(8, arquivos.length, true);
  df.setUint16(10, arquivos.length, true);
  df.setUint32(12, indice.length, true);
  df.setUint32(16, miolo.length, true);
  return juntar([miolo, indice, fim]);
}

/** Dois arquivos são o mesmo? Existe porque `Uint8Array` não tem `.equals`. */
export function bytesIguais(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ── a planilha inteira ───────────────────────────────────────────────────────
/**
 * Monta o .xlsx e devolve os bytes.
 *
 * @param {Array<{nome:string, colunas:Array<{titulo:string,tipo?:string,largura?:number}>, linhas:Array<Array<any>>}>} abas
 * @returns {Promise<Uint8Array>}
 */
export async function montarXlsx(abas, { comprimir = 'auto' } = {}) {
  if (!Array.isArray(abas) || abas.length === 0) {
    throw new Error('planilha sem aba nenhuma: o Excel não abre arquivo assim.');
  }
  const usados = new Set();
  const prontas = abas.map((a, i) => ({
    nome: nomeDeAba(a.nome, usados),
    arquivo: `xl/worksheets/sheet${i + 1}.xml`,
    xml: abaXml({ colunas: a.colunas, linhas: a.linhas ?? [] }),
  }));

  const tipos = `${CABECA}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${prontas.map((p) => `<Override PartName="/${p.arquivo}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('\n')}
</Types>`;

  const raizRels = `${CABECA}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const livro = `${CABECA}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${prontas.map((p, i) => `<sheet name="${xml(p.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>
</workbook>`;

  const livroRels = `${CABECA}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${prontas.map((p, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${prontas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  return await zipar([
    { nome: '[Content_Types].xml', conteudo: tipos },
    { nome: '_rels/.rels', conteudo: raizRels },
    { nome: 'xl/workbook.xml', conteudo: livro },
    { nome: 'xl/_rels/workbook.xml.rels', conteudo: livroRels },
    { nome: 'xl/styles.xml', conteudo: ESTILOS },
    ...prontas.map((p) => ({ nome: p.arquivo, conteudo: p.xml })),
  ], comprimir);
}
