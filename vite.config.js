import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  // Só no `npm run dev`: a API em Go local atrás de `/api`, tirando o prefixo —
  // o mesmo que o `location /api/` do nginx faz na VPS (Plano 7). Sem
  // `VITE_API_AREAS`, nenhuma tela chama `/api` e isto não faz nada.
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_API_ALVO || 'http://127.0.0.1:8080',
        rewrite: (caminho) => caminho.replace(/^\/api/, ''),
      },
    },
  },
})
