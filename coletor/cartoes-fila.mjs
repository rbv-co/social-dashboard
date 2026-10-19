// Quantos pedidos de cartão esperam na fila (no máximo o limite do argumento), para o vigia (coletor/vps/cartoes-ean-vigia.sh).
// Sai com erro se a leitura falhar: leitura que falhou NÃO é fila vazia.
import { abrirDados } from './lib/cartoes-dados.mjs';

try {
  console.log((await (await abrirDados()).naFila(process.argv[2] || 2)).length);
} catch (e) {
  console.error('cartoes-fila: ' + e.message);
  process.exit(1);
}
