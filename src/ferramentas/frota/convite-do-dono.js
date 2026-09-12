/* Dar acesso ao dono do carro, pelo próprio quadro de cobrança.
 *
 * O QUE ISTO RESOLVE, medido em 12/08/2026: três donos de carro não têm login —
 * Marcus Vinicius (Fiat Punto), Thiago Siqueira (Ford Fiesta Sedan) e Barbara
 * Franco (Honda Fit). Sem login eles não recebem o aviso das 7h30, não assinam
 * checklist, e o único canal que sobra é o WhatsApp da aba Gestão. É por isso
 * que quem administra a Frota pode preencher o checklist por qualquer carro
 * (D21b) — uma saída de emergência que virou o normal.
 *
 * O desenho previa "cadastrar quem falta E convidar". A medição mostrou que os
 * três JÁ TÊM cadastro completo: nome, e-mail e telefone. Falta só a conta.
 *
 * O CONVITE NÃO MANDA E-MAIL. A edge `invite-user` cria a conta com uma senha
 * temporária; quem convida recebe a senha na tela e entrega pela mensagem que
 * quiser. Nada sai daqui sozinho, e não há como disparar mensagem sem querer.
 *
 * ⚠️ A EDGE NÃO MARCA `precisa_trocar_senha` — conferido no código dela, e a
 * tela de Admin faz esse passo por fora justamente por isso. Quem grava é a
 * Frota, junto dos outros passos, e conferindo. Sem ele a senha temporária vira
 * permanente, e quem convidou (e todo mundo do grupo onde a senha foi colada)
 * fica com credencial válida da conta de outra pessoa.
 *
 * ⚠️ CRIAR A CONTA NÃO DÁ ACESSO A NADA. `profiles.permissions` nasce vazio e
 * `features` também, então a pessoa entra e não alcança a Frota — a revisão
 * pegou a tela dizendo "já pode entrar" para uma conta que não abria o
 * checklist. São QUATRO passos, não um: conta, senha a trocar, permissão da
 * Frota (nos DOIS modelos que esta central usa), e o aviso das 7h30.
 */

/** Um e-mail que dá pra usar como login. Frouxo de propósito: quem valida de
 *  verdade é o servidor, e barrar aqui um endereço legítimo seria pior. */
export function pareceEmail(txt) {
  const s = String(txt || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/**
 * Este dono de carro pode receber um convite agora?
 *
 * Devolve `{ pode, motivo, email }`. `motivo` é o que a tela mostra quando não
 * dá — e ele existe porque "o botão não apareceu" não explica nada a ninguém.
 */
export function podeConvidar({ pessoa, jaTemLogin, podeAdministrar }) {
  if (!podeAdministrar) {
    return { pode: false, codigo: 'sem-permissao', motivo: 'Só quem administra a Frota cria acesso.', email: null };
  }
  if (!pessoa) {
    return {
      pode: false,
      codigo: 'sem-pessoa',
      motivo: 'Este carro não tem responsável apontado. Aponte um na ficha do veículo primeiro — '
        + 'sem saber de quem é o carro, não há a quem dar acesso.',
      email: null,
    };
  }
  if (jaTemLogin) {
    return { pode: false, codigo: 'ja-tem', motivo: `${pessoa.nome} já tem acesso ao aplicativo.`, email: null };
  }
  const email = String(pessoa.email_corporativo || '').trim();
  if (!pareceEmail(email)) {
    return {
      pode: false,
      codigo: 'sem-email',
      motivo: `${pessoa.nome} está sem e-mail no cadastro, e o e-mail é o login. `
        + 'Preencha em Colaboradores e Acessos e volte aqui.',
      email: null,
    };
  }
  return { pode: true, codigo: null, motivo: null, email };
}

/**
 * A senha inicial. Gerada aqui e entregue na tela pra quem convida repassar.
 *
 * Sem caracteres que se confundem lidos em voz alta ou copiados à mão: sem O e
 * zero, sem l maiúsculo e 1, sem I. Quem recebe esta senha vai digitá-la uma
 * vez, muitas vezes lendo de um WhatsApp no celular — e uma senha que a pessoa
 * erra três vezes vira um chamado pra quem administra.
 */
const ALFABETO = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';

export function senhaInicial(tamanho = 12, aleatorio) {
  const sorteia = typeof aleatorio === 'function'
    ? aleatorio
    : () => {
      // `crypto` quando existe: senha de conta não se tira de Math.random().
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        const v = new Uint32Array(1); crypto.getRandomValues(v);
        return v[0] / 4294967296;
      }
      return Math.random();
    };
  let s = '';
  for (let i = 0; i < tamanho; i++) s += ALFABETO[Math.floor(sorteia() * ALFABETO.length)];
  return s;
}

/** O que a tela mostra depois de criar a conta. */
export function recadoDoConvite({ nome, email, senha }) {
  return `${nome} já pode entrar. Entregue a ela:\n\nE-mail: ${email}\nSenha: ${senha}\n\n`
    + 'No primeiro acesso o aplicativo pede pra ela trocar a senha.';
}
