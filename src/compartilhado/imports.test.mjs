import { guardarImports } from './guarda-de-imports.mjs'

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
//
// Aqui não há uma tela principal: há um punhado de peças que todas as
// ferramentas usam, e uma peça compartilhada em branco apaga a tela de quem a
// usa. O `nova-opcao.js` mostrou o outro lado disso em 13/08: ele nasceu no
// Patrimônio, era coberto lá, e ao MUDAR para cá deixou de ser — arquivo que
// troca de pasta não pode levar embora a guarda de quem ficou.

guardarImports(import.meta.url, {
  // Quantas telas a pasta tem hoje. Se cair, é `.vue` sumindo — e o guarda
  // passaria por estar vazio, que é o mesmo que não existir. Mexer aqui é de
  // propósito, nunca de passagem.
  minimoDeTelas: 6,
})
