import { guardarImports } from '../../compartilhado/guarda-de-imports.mjs'

// TODO NOME DE MÓDULO USADO NUMA TELA DESTA PASTA PRECISA ESTAR IMPORTADO.
//
// Chamar uma função de um vizinho e esquecer de importá-la NÃO quebra o
// `npm run build`: o Vite supõe que é global do navegador. O erro só nasce
// quando alguém clica — o Vue aborta o desenho no meio e o painel fica EM
// BRANCO, muitas vezes sem nada no console.
//
// Já derrubou tela quatro vezes: Gestão de Tráfego (29/07, duas no mesmo dia),
// Admin (05/08) e Patrimônio (10/08, as abas Planilha e Resumo em branco).
//
// O motor mora em `src/compartilhado/guarda-de-imports.mjs` e se testa em
// `guarda-de-imports.test.mjs`. Pasta nova nasce com este arquivo.

guardarImports(import.meta.url, {
  // Quantas telas a pasta tem hoje. Se cair, é `.vue` sumindo — e o guarda
  // passaria por estar vazio, que é o mesmo que não existir. Mexer aqui é de
  // propósito, nunca de passagem.
  //
  // Passou de 1 para 2 em 01/09: `painel-de-busca.vue` é o bloco de busca que
  // as abas Lotes, Gravar e Etiquetas compartilham. Ele conta como tela para o
  // guarda porque tem `<script setup>` e pode chamar vizinho sem importar,
  // exatamente como a tela grande.
  minimoDeTelas: 2,
})
