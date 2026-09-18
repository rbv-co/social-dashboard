// supabase/functions/_shared/email-textos.js
// OS TEXTOS DOS E-MAILS DA CONTA.
//
// ⚠️ NADA DE CPF, PEDIDO OU PRODUTO AQUI. E-mail passa por servidores que não
// são nossos e fica na caixa da pessoa para sempre. Há teste que reprova essas
// palavras. O que o e-mail carrega é o mínimo: quem somos e a senha.
//
// ⚠️ NUNCA dizer que registrar é obrigatório, nem que o registro dá ou estende
// a garantia. A regra (decisão do dono, 18/09/2026): 2 anos para peça em
// canvas e 6 meses para peça em couro, contados da DATA DA COMPRA, e vale com
// a nota ou o cupom fiscal — NÃO depende de registro.
// ⚠️ E NUNCA ESCREVER UM PRAZO FIXO AQUI. Quem monta estes e-mails
// (`vessel-conta`) não recebe o material da peça; um "2 anos" cravado seria
// mentira para toda cliente de bolsa de couro. Se um dia o e-mail falar de
// prazo, que seja o texto geral acima — ou o prazo da peça vindo do banco.
// Prometer errado no e-mail é a mesma mentira que o padrão já proíbe na tela —
// só que aqui ela fica gravada na caixa de entrada da cliente.

const ASSINATURA = 'VESSEL Brasil · vesselbrasil.com.br';

// O NOME vem digitado pela cliente (cadastro/formulário), não é texto nosso.
// Sem escapar, `José <img src=x onerror=...>` entra cru no HTML do e-mail:
// quebra o layout e abre porta para rastreamento por imagem externa (o
// onerror dispara sozinho quando o cliente de e-mail renderiza a tag). O
// `.texto` (texto puro) não precisa disso — lá `<` e `&` são só caracteres.
function escaparHtml(t) {
  return String(t ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function montar(assunto, titulo, miolo, senha) {
  const texto = `${titulo}\n\n${miolo}\n\nSua senha: ${senha}\n\n${ASSINATURA}`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#2A2823;line-height:1.6">
  <p style="letter-spacing:.2em;font-size:12px;color:#5E6851">VESSEL</p>
  <h1 style="font-weight:300;font-size:22px">${escaparHtml(titulo)}</h1>
  <p>${escaparHtml(miolo)}</p>
  <p style="font-size:20px;letter-spacing:.08em;background:#F2EFE6;padding:12px 16px;display:inline-block">${escaparHtml(senha)}</p>
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
