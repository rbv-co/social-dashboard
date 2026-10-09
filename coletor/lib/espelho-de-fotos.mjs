// coletor/lib/espelho-de-fotos.mjs
// O espelho em disco das fotos do Zoho, que pode ser PERMANENTE (VPS: env FOTOS_CACHE) em vez de refeito a cada pedido.
//
// ⚠️ CACHE QUE FICA VELHO É CARTÃO ERRADO, e ninguém percebe olhando um cartão sozinho. Por isso:
//  - a foto só é reaproveitada se a "versão" dela no Zoho (modificação + tamanho) for a mesma de quando baixou;
//  - foto trocada ou sumida => `trocados > 0` => o chamador apaga TUDO que o gerador derivou dela (recorte, foto tratada,
//    desenho tratado), que ele guarda por NOME de arquivo e por isso não percebe a troca sozinho;
//  - o mesmo vale para a versão do próprio tratamento (ver `versaoDoTratamento`).
import { mkdirSync, readdirSync, rmSync, writeFileSync, existsSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createHash } from 'node:crypto';

/** `fn` em cada item, no máximo `n` ao mesmo tempo; o primeiro erro derruba tudo (leitura que falhou não é pasta vazia). */
export async function emParalelo(itens, n, fn) {
  const fila = [...itens];
  await Promise.all(Array.from({ length: Math.min(n, fila.length) }, async () => {
    while (fila.length) await fn(fila.shift());
  }));
}

/**
 * Deixa `dir` igual ao Zoho: baixa o que falta ou mudou, apaga o que não existe mais lá.
 * @param {string} dir                    pasta local do produto
 * @param {{nome:string,versao?:string}[]} remotos  os arquivos que se QUER aqui (já filtrados por tipo)
 * @param {Set<string>} todosNomes        TODOS os nomes de arquivo da pasta no Zoho (filtrados ou não): só o que não está
 *                                        nem aqui é apagado do disco
 * @param {Record<string,string>} manifesto  "pasta/arquivo" -> versão baixada; é alterado aqui
 * @param {(f:object)=>Promise<Buffer>} baixar
 * @returns {Promise<{baixados:number,apagados:number,trocados:number}>} `trocados` = arquivo que já estava no disco e
 *   foi substituído ou sumiu: o que foi derivado dele está velho
 */
export async function sincronizarPasta({ dir, remotos, todosNomes, manifesto, baixar, simultaneas = 6 }) {
  mkdirSync(dir, { recursive: true });
  const pasta = basename(dir);
  let baixados = 0, apagados = 0, trocados = 0;
  for (const local of readdirSync(dir)) {
    if (todosNomes.has(local)) continue;
    rmSync(join(dir, local), { recursive: true, force: true });
    delete manifesto[`${pasta}/${local}`];
    apagados++; trocados++;
  }
  await emParalelo(remotos, simultaneas, async (f) => {
    const chave = `${pasta}/${f.nome}`;
    // Sem versão (atributo ausente) NÃO dá para provar que não mudou: baixa de novo.
    if (f.versao && manifesto[chave] === f.versao && existsSync(join(dir, f.nome))) return;
    writeFileSync(join(dir, f.nome), await baixar(f));
    if (chave in manifesto) trocados++;
    manifesto[chave] = f.versao || '';
    baixados++;
  });
  return { baixados, apagados, trocados };
}

/** Pastas locais que não existem mais no Zoho (apagadas ou renomeadas): somem, com as entradas do manifesto. */
export function podarPastas(raiz, nomesNoZoho, manifesto) {
  let podadas = 0;
  for (const d of readdirSync(raiz)) {
    const caminho = join(raiz, d);
    if (!statSync(caminho).isDirectory() || nomesNoZoho.has(d)) continue;
    rmSync(caminho, { recursive: true, force: true });
    for (const k of Object.keys(manifesto)) if (k.startsWith(d + '/')) delete manifesto[k];
    podadas++;
  }
  return podadas;
}

/** Impressão digital de tudo que MUDA o resultado do tratamento: scripts e recortes à mão. Mudou = derivados velhos. */
export function versaoDoTratamento(caminhos) {
  const h = createHash('sha256');
  const visita = (c) => {
    if (!existsSync(c)) { h.update('ausente:' + c); return; }
    if (statSync(c).isDirectory()) { for (const f of readdirSync(c).sort()) { h.update(f); visita(join(c, f)); } return; }
    h.update(readFileSync(c));
  };
  caminhos.forEach(visita);
  return h.digest('hex');
}
