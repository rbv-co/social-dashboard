// O BUILD DA DEMONSTRAÇÃO — separado do build da Central de propósito.
//
// ⚠️ `vite build` (o normal) usa `vite.config.js` e NUNCA vê este arquivo: a
// Central de verdade não sabe que a demonstração existe. Este aqui gera
// `dist-demonstracao/` com duas páginas — o roteiro (`demonstracao/index.html`)
// e a Central no banco de mentira (`demonstracao/central.html`) — e liga
// `VITE_DEMONSTRACAO`, que só duas linhas da Central leem (o roteador vai para
// o endereço com "#", e o cartão da convidada não abre o WhatsApp).
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const aqui = (caminho) => fileURLToPath(new URL(caminho, import.meta.url))

// O `vercel.json` da demonstração vai para a RAIZ da saída: é o projeto da
// Vercel da demonstração que o lê (com `noindex`), não o da Central.
const vercelDaDemonstracao = {
  name: 'vercel-da-demonstracao',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'vercel.json', source: readFileSync(aqui('./demonstracao/vercel.json'), 'utf8') })
  },
}

// ⚠️ PELO AMBIENTE: o Vite junta a `import.meta.env` tudo o que começa com
// VITE_ no ambiente. No build normal a variável não existe, a comparação vira
// `false` já na compilação e o ramo da demonstração nem entra no pacote.
process.env.VITE_DEMONSTRACAO = '1'

export default defineConfig({
  base: '/',
  plugins: [vue(), vercelDaDemonstracao],
  build: {
    outDir: 'dist-demonstracao',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        roteiro: aqui('./demonstracao/index.html'),
        central: aqui('./demonstracao/central.html'),
      },
    },
  },
  preview: {
    // `vite preview` abre a raiz; a demonstração mora em /demonstracao/.
    open: false,
  },
})
