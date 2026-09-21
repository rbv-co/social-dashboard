// LER DE VOLTA O .XLSX QUE NÓS ESCREVEMOS — é o que transforma "gerei o
// arquivo" em prova.
//
// ⚠️ POR QUE ISTO EXISTE
// Contar linhas não prova nada: uma planilha com as colunas trocadas tem o
// mesmo número de linhas de uma correta, e uma data gravada em UTC tem o mesmo
// número de dígitos da certa. Este módulo abre o zip, lê o XML e devolve o que
// o Excel MOSTRARIA na célula — inclusive desfazendo a conta do número que o
// Excel chama de data. É com ele que o teste do gerador e a prova ao vivo
// conferem célula por célula.
//
// Ele NÃO é um leitor de xlsx de mercado: entende só o que o nosso gerador
// escreve (texto embutido, número, e data pelo formato da coluna). Arquivo de
// fora, com `sharedStrings`, não é assunto dele.
// ⚠️ `.mjs` e não `.js`: este é o único destes arquivos que NÃO roda na edge.
// Ele usa `Buffer` e `node:zlib`, que são do node, e serve só para os testes e
// para a prova ao vivo lerem de volta o que o gerador escreveu.
import { inflateRawSync } from 'node:zlib';

/** Nome do arquivo interno → texto. Lê pelo índice central, como manda o zip. */
export function arquivosDoXlsx(bytes) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  // O fim do índice central está nos últimos 22 bytes (não usamos comentário).
  let fim = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { fim = i; break; }
  }
  if (fim < 0) throw new Error('não é zip: falta o fim do índice central');
  const quantos = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);   // onde o índice central começa

  const dentro = new Map();
  for (let i = 0; i < quantos; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('índice central corrompido');
    // ⚠️ O ZIP PODE VIR GUARDADO (método 0) OU COMPRIMIDO (método 8): o gerador
    // usa o segundo quando o runtime tem `node:zlib` e o primeiro quando não
    // tem. Chamar `inflate` num arquivo guardado estoura com "incorrect header
    // check", que não diz nada a quem lê o erro.
    const metodo = buf.readUInt16LE(p + 10);
    const tamanhoNome = buf.readUInt16LE(p + 28);
    const tamanhoExtra = buf.readUInt16LE(p + 30);
    const tamanhoComentario = buf.readUInt16LE(p + 32);
    const ondeComeca = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + tamanhoNome);

    const nomeLocal = buf.readUInt16LE(ondeComeca + 26);
    const extraLocal = buf.readUInt16LE(ondeComeca + 28);
    const comprimido = buf.readUInt32LE(ondeComeca + 18);
    const inicio = ondeComeca + 30 + nomeLocal + extraLocal;
    const pedaco = buf.subarray(inicio, inicio + comprimido);
    dentro.set(nome, (metodo === 0 ? pedaco : inflateRawSync(pedaco)).toString('utf8'));

    p += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario;
  }
  return dentro;
}

const desxml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&amp;/g, '&');

// A volta da conta do Excel: número → 'DD/MM/AAAA' ou 'DD/MM/AAAA HH:MM'.
const ZERO_DO_EXCEL = Date.UTC(1899, 11, 30);
const dois = (n) => String(n).padStart(2, '0');
function deSerial(n, comHora) {
  const d = new Date(ZERO_DO_EXCEL + Math.round(Number(n) * 86400000));
  const data = `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`;
  return comHora ? `${data} ${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}` : data;
}

// ⚠️ O FORMATO SAI DO ARQUIVO, NÃO DE UM NÚMERO CRAVADO AQUI.
// Antes este leitor sabia de cor que o estilo 2 era data e o 3 era data-hora. Em
// 21/09/2026 o gerador ganhou linhas listradas, os estilos dobraram e esses
// números viraram outros. Agora ele abre o `styles.xml`, lê o formato de cada
// estilo e decide por ele — e passa a valer para qualquer estilo que apareça
// depois, sem ninguém ter de lembrar de mexer aqui.
const FORMATO_DIA = '164';
const FORMATO_INSTANTE = '165';

/** índice do estilo -> numFmtId, na ordem em que os `<xf>` aparecem. */
function formatoPorEstilo(estilosXml) {
  const bloco = /<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/.exec(estilosXml || '');
  if (!bloco) return [];
  return [...bloco[1].matchAll(/<xf[^>]*\bnumFmtId="(\d+)"/g)].map((m) => m[1]);
}

/**
 * As abas, com cada célula já como o Excel a mostraria.
 * Devolve `[{ nome, colunas, linhas }]` — `linhas` sem o cabeçalho.
 */
export function abasDoXlsx(bytes) {
  const dentro = arquivosDoXlsx(bytes);
  const formatos = formatoPorEstilo(dentro.get('xl/styles.xml'));
  const livro = dentro.get('xl/workbook.xml') || '';
  const nomes = [...livro.matchAll(/<sheet name="([^"]*)"/g)].map((m) => desxml(m[1]));

  return nomes.map((nome, i) => {
    const folha = dentro.get(`xl/worksheets/sheet${i + 1}.xml`) || '';
    const linhas = [];
    for (const m of folha.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
      const numero = Number(m[1]);
      const celulas = [];
      for (const c of m[2].matchAll(/<c r="([A-Z]+)(\d+)"(?:\s+s="(\d+)")?(?:\s+t="([^"]*)")?\s*(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const coluna = c[1].split('').reduce((a, l) => a * 26 + (l.charCodeAt(0) - 64), 0);
        const estilo = c[3];
        const miolo = c[5] ?? '';
        let valor = '';
        if (c[4] === 'inlineStr') {
          valor = desxml((/<t[^>]*>([\s\S]*?)<\/t>/.exec(miolo) || [, ''])[1]);
        } else {
          const cru = (/<v>([\s\S]*?)<\/v>/.exec(miolo) || [, ''])[1];
          const formato = formatos[Number(estilo ?? 0)];
          if (cru === '') valor = '';
          else if (formato === FORMATO_DIA) valor = deSerial(cru, false);
          else if (formato === FORMATO_INSTANTE) valor = deSerial(cru, true);
          else valor = cru;
        }
        celulas[coluna - 1] = valor;
      }
      // Célula ausente é célula vazia — o gerador não escreve as vazias.
      for (let x = 0; x < celulas.length; x++) if (celulas[x] === undefined) celulas[x] = '';
      linhas[numero - 1] = celulas;
    }
    const [cabecalho = [], ...corpo] = linhas;
    return { nome, colunas: cabecalho, linhas: corpo };
  });
}
