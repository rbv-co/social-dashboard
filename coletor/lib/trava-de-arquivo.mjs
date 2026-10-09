// coletor/lib/trava-de-arquivo.mjs
// Exclusão mútua ENTRE PROCESSOS na mesma máquina (VPS: dois robôs de cartão ao mesmo tempo). `mkdir` é atômico: quem
// cria a pasta é o dono. Sem dependência, sem `flock`.
//
// ⚠️ O QUE ISTO PROTEGE: o espelho de fotos e o que o gerador guarda por NOME de arquivo (recorte, foto tratada) —
// dois processos escrevendo o mesmo arquivo deixam um PNG pela metade que o outro lê como pronto (`existsSync`) —, e o
// "achar ou criar pasta" do Zoho, que com dois processos cria a mesma subpasta duas vezes.
import { mkdirSync, rmSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** A trava é de processo morto? Só `ESRCH` prova que morreu; trava sem `pid` vale pela idade (crash entre mkdir e escrita). */
function abandonada(caminho) {
  try {
    process.kill(Number(readFileSync(join(caminho, 'pid'), 'utf8')), 0);
    return false;
  } catch (e) {
    if (e.code === 'ESRCH') return true;
    if (e.code === 'ENOENT') { try { return Date.now() - statSync(caminho).mtimeMs > 30000; } catch { return false; } }
    return false; // EPERM = o processo existe
  }
}

/** Roda `fn` com a trava `caminho` (uma pasta que ainda não existe). Espera até `esperaMaxMs` e então desiste com erro. */
export async function comTrava(caminho, fn, { esperaMaxMs = 15 * 60 * 1000, passoMs = 200 } = {}) {
  const ate = Date.now() + esperaMaxMs;
  for (;;) {
    try { mkdirSync(caminho); writeFileSync(join(caminho, 'pid'), String(process.pid)); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      if (abandonada(caminho)) { rmSync(caminho, { recursive: true, force: true }); continue; }
      if (Date.now() > ate) throw new Error('trava ocupada há mais de ' + Math.round(esperaMaxMs / 1000) + ' s: ' + caminho);
      await new Promise((r) => setTimeout(r, passoMs));
    }
  }
  try { return await fn(); } finally { rmSync(caminho, { recursive: true, force: true }); }
}
