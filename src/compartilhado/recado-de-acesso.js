/* A MENSAGEM QUE SE MANDA PARA QUEM ACABOU DE GANHAR ACESSO.
 *
 * Existe porque o que a tela copiava era a senha CRUA, sozinha. Quem recebia
 * um "7yQm-4vTn-2Kd" no WhatsApp não sabia onde usar aquilo, e o dono acabava
 * digitando o resto do recado à mão toda vez — e cada digitação é uma chance de
 * mandar o endereço errado.
 *
 * O ENDEREÇO ENTRA NA MENSAGEM de propósito. Sem ele a pessoa tem e-mail e
 * senha e nenhum lugar para usá-los; o aplicativo não é achável por busca. */

export const ENDERECO_DA_CENTRAL = 'central.rbvcompany.com';

/**
 * O recado pronto para colar no WhatsApp.
 *
 * Sem senha, devolve a versão de convite — porque a conta criada sem senha
 * recebe um link por e-mail, e mandar "Senha: " vazio faria a pessoa procurar
 * uma senha que não existe.
 */
export function recadoDeAcesso({ email, senha, endereco } = {}) {
  const onde = String(endereco || ENDERECO_DA_CENTRAL).trim();
  const quem = String(email || '').trim();
  const chave = String(senha || '').trim();

  const cabeca = `Acesso à Central RBV\n\nEndereço: ${onde}`;
  if (!chave) {
    return `${cabeca}\nE-mail: ${quem}\n\n`
      + 'Você vai receber um link nesse e-mail para criar a sua senha. '
      + 'Se não chegar, olhe no lixo eletrônico.';
  }
  return `${cabeca}\nE-mail: ${quem}\nSenha: ${chave}\n\n`
    + 'No primeiro acesso o aplicativo pede pra você trocar a senha por uma sua.';
}
