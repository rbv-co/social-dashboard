// coletor/lib/cartao-de-uma-peca.mjs
// Gera UM cartão EAN: HTML -> exporta (Chrome, 600 dpi) -> LÊ o código de barras do PNG impresso.
// Quem sobe no Zoho e marca a peça é o robô (coletor/robo-de-cartoes.mjs); aqui só se fabrica e se confere.
import { mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { rotuloDoCartao, arquivosDoCartao } from './cartoes-da-fila.js';

/**
 * @param {object} p
 * @param {Function} p.gerarCartao  `gerarCartao` de vessel-brasil/cartao/gerar.mjs
 * @param {string} p.vessel         pasta do repositório do site (tem cartao/exportar.mjs e conferir-barras.py)
 * @param {string} p.trabalho       pasta temporária onde o HTML e os arquivos nascem
 * @returns {Promise<{ tempos: Record<string, number>, rotulo: string, saida: string, arquivos: string[], gtin: string, serie: string, vista: string }>}
 * Lança se o cartão não puder ser considerado BOM: foto achada só pelo nome, arquivo faltando ou código de barras
 * que não bate com o GTIN do Bling. "Tem arquivo" não é "tem cartão bom" (foram 5 cartões sem barras por 3 semanas).
 */
export async function fazerCartao({ gerarCartao, vessel, trabalho, sku, numero }) {
  const rotulo = rotuloDoCartao(sku, numero);
  const tempos = {}; // segundos por etapa, para o log mostrar onde o tempo vai
  let t = Date.now();
  const marca = (etapa) => { tempos[etapa] = +((Date.now() - t) / 1000).toFixed(1); t = Date.now(); };
  const html = join(trabalho, 'html', `${rotulo}.html`);
  const r = await gerarCartao(sku, numero, { saida: html });
  marca('bling+recorte');
  if (r.foto.confiavel === false) throw new Error('a pasta de fotos só foi achada pelo nome do produto, não pelo SKU');

  const saida = join(trabalho, 'saida', rotulo);
  mkdirSync(saida, { recursive: true });
  execFileSync(process.execPath, [join(vessel, 'cartao', 'exportar.mjs'), html, saida], { env: { ...process.env, DPI: '600' }, stdio: 'pipe', timeout: 240000 });
  marca('chrome');
  const arquivos = arquivosDoCartao(rotulo);
  for (const f of arquivos) if (!existsSync(join(saida, f))) throw new Error(`o arquivo ${f} não foi gerado`);
  execFileSync('python3', [join(vessel, 'cartao', 'conferir-barras.py'), join(saida, `${rotulo}_verso.png`), r.peca.gtin], { stdio: 'pipe', timeout: 60000 });
  marca('barras');
  return { tempos, rotulo, saida, arquivos, gtin: r.peca.gtin, serie: r.peca.numeroDeSerie, vista: r.foto.vista };
}
