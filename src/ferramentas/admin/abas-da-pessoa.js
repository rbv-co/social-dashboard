// AS TRÊS NATUREZAS DENTRO DA PESSOA (D6 do desenho de 11/08/2026).
//
// Estavam as três numa janela só, e foi uma das quatro queixas do dono. São
// coisas que quebram de formas diferentes:
//   ferramentas → o que ela ABRE (permissão)
//   avisos      → se o celular dela TOCA (não é permissão)
//   cadastro    → a qual colaborador este login pertence
//
// A terceira existe porque a falta do elo já custou caro: o aviso do checklist
// não chegava em quem TINHA login, porque a tela achava a pessoa pelo e-mail e
// o robô exigia o elo. Medido em 11/08/2026: 6 dos 15 logins sem elo. Aqui
// isso para de ser silencioso.
//
// ESTE MÓDULO NÃO DESCOBRE O VÍNCULO. Quem responde se o elo existe é
// `vinculo-de-cadastro.js` (`estadoDoVinculo`), que é a regra única do
// projeto — aqui só entra a resposta pronta, em `temVinculo`.
export function abasDaPessoa({ soNotificacoes = false, temVinculo = true } = {}) {
  if (soNotificacoes) {
    return [{ chave: 'avisos', rotulo: 'Avisos no celular', aviso: null }]
  }
  return [
    { chave: 'ferramentas', rotulo: 'O que ela abre', aviso: null },
    { chave: 'avisos', rotulo: 'Avisos no celular', aviso: null },
    {
      chave: 'cadastro',
      rotulo: 'Cadastro',
      aviso: temVinculo ? null
        : 'Este login não está ligado a nenhum colaborador. Enquanto estiver assim, '
          + 'aviso no celular pode não chegar nesta pessoa, sem dar erro.',
    },
  ]
}
