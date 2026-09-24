// AS CHAVES QUE MORAM DENTRO DA GESTÃO INTERNA — em UM lugar só.
//
// POR QUE ESTE ARQUIVO EXISTE, e a cicatriz é dupla:
//
// A porta da Gestão Interna, na tela de Início, decidia quem entra com uma
// lista escrita à mão:
//
//     podeAcessos || podePatrimonio || podeFrota
//
// E o menu lá dentro tinha OUTRA lista, a dos cartões. Duas listas para a mesma
// verdade — e foi uma delas envelhecendo, duas vezes:
//
//  · 19/08/2026 — a FROTA faltava na porta. Das 8 pessoas com a chave, CINCO
//    não tinham Acessos nem Patrimônio: abriam o aplicativo e liam "Você ainda
//    não tem acesso a nenhuma ferramenta", com a permissão concedida e
//    funcionando. O menu de dentro já mostrava o cartão da Frota; faltava só a
//    porta, e sem ela não existe caminho de clique nenhum.
//
//  · 01/09/2026 — a AUTENTICIDADE nasceu depois do conserto da Frota e caiu no
//    MESMO buraco. O dono criou `estacaonfc@vesselbrasil.com.br`, concedeu a
//    ferramenta, e a conta leu a mesma mentira. Conferido no banco: a chave
//    estava nos dois lugares, `features` e `permissions`. Não faltava permissão
//    — faltava caminho.
//
// A LIÇÃO: a porta e o menu não podem ser listas diferentes. Ferramenta nova
// entra NO CATÁLOGO, uma vez, e os dois lados obedecem. Há teste que reprova cartão no
// menu cuja chave não esteja nesta lista — porque o defeito é silencioso: a
// ferramenta funciona, só não é alcançável, e quem a concedeu jura que concedeu.
//
// 24/09/2026: a lista deixou de ser escrita aqui também. Ela é o grupo
// 'gestao-interna' do catálogo (compartilhado/catalogo-de-ferramentas.js), de
// onde o editor de permissões, o roteador e os cartões leem. Este arquivo fica
// com os mesmos nomes para quem já o importa.
import { chavesDaPorta } from '../../compartilhado/catalogo-de-ferramentas.js'

export const CHAVES_DA_GESTAO_INTERNA = chavesDaPorta('gestao-interna')

// Quem vê a porta: quem puder ver QUALQUER submódulo. O menu de dentro é que
// mostra só os que a pessoa pode — a porta é generosa de propósito, porque
// esconder a porta de quem tem um submódulo é o defeito que este arquivo cura.
export function podeVerGestaoInterna(temPermissao) {
  return CHAVES_DA_GESTAO_INTERNA.some((chave) => temPermissao(chave, 'ver'))
}
