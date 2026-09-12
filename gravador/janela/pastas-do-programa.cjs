// AS PASTAS E ARQUIVOS QUE ENTRAM NO PACOTE.
// Ver `modulos-do-programa.cjs` para o porque de a lista morar fora da
// configuracao do empacotador.
module.exports = {
  'gravador/janela': [
    'principal.cjs',
    'preload.cjs',
    'abrir-a-janela.js',
    'atendente-do-leitor.js',
    'enderecos-permitidos.js',
    'atualizacao.js',
    // Entrou em 07/09/2026 junto do botão de religar o leitor. Sem esta linha o
    // programa morreria na bancada com "Cannot find module" — e foi o teste
    // `o-instalador-tem-tudo` que pegou, antes de virar instalador.
    'religar-o-servico.js',
  ],
  gravador: [
    'leitor-de-mesa.js',
    'comandos-do-acr122u.js',
    'ponte-do-powershell.js',
  ],
  'src/ferramentas/autenticidade/gravador-de-mesa': [
    'ndef-para-ntag213.js',
  ],
}
