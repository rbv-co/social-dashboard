// supabase/functions/_shared/email-textos.js
// OS TEXTOS DOS E-MAILS DA CONTA.
//
// ⚠️ NADA DE CPF, PEDIDO OU PRODUTO AQUI. E-mail passa por servidores que não
// são nossos e fica na caixa da pessoa para sempre. Há teste que reprova essas
// palavras. O que o e-mail carrega é o mínimo: quem somos e a senha.
//
// ⚠️ NUNCA dizer que registrar é obrigatório. A garantia legal (90 dias) já
// existe sem registro; o registro só ESTENDE para 2 anos a partir da compra.
// Prometer o contrário no e-mail é a mesma mentira que o padrão já proíbe na
// tela — só que aqui ela fica gravada na caixa de entrada da cliente.

const ASSINATURA = 'VESSEL Brasil · vesselbrasil.com.br';

function montar(assunto, titulo, miolo, senha) {
  const texto = `${titulo}\n\n${miolo}\n\nSua senha: ${senha}\n\n${ASSINATURA}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#2A2823;line-height:1.6">
  <p style="letter-spacing:.2em;font-size:12px;color:#5E6851">VESSEL</p>
  <h1 style="font-weight:300;font-size:22px">${titulo}</h1>
  <p>${miolo}</p>
  <p style="font-size:20px;letter-spacing:.08em;background:#F2EFE6;padding:12px 16px;display:inline-block">${senha}</p>
  <p style="font-size:12px;color:#6B685F">${ASSINATURA}</p>
</div>`;
  return { assunto, html, texto };
}

export function textoDoPrimeiroAcesso(nome, senha) {
  return montar(
    'Seu acesso VESSEL',
    `Bem-vinda, ${String(nome || '').split(' ')[0]}`,
    'Criamos seu perfil VESSEL. Use o e-mail ou o seu documento e a senha abaixo para entrar. '
    + 'Você pode trocar a senha assim que entrar.',
    senha,
  );
}

export function textoDaSenhaNova(nome, senha) {
  return montar(
    'Sua nova senha VESSEL',
    'Nova senha',
    'Geramos uma senha nova para o seu perfil. A senha anterior deixou de valer. '
    + 'Se não foi você quem pediu, fale com a gente.',
    senha,
  );
}

// Mostra a primeira letra e o domínio, escondendo o resto do usuário do
// e-mail — usada em tela/log para confirmar "para onde foi" sem expor o
// endereço inteiro (o mesmo motivo por trás de mascarar CPF/telefone em tela).
export function mascararEmail(email) {
  const e = String(email || '');
  const i = e.indexOf('@');
  if (i < 1) return '';
  return `${e[0]}•••${e.slice(i)}`;
}
