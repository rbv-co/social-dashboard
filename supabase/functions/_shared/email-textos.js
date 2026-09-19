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

// ── O LEMBRETE DE "REGISTRAR DEPOIS" (19/09/2026) ────────────────────────────
// Desenho: docs/superpowers/specs/2026-09-19-register-later-design.md
//
// ⚠️ É SÓ O LEMBRETE DAQUELA PEÇA. Nada de marketing junto, nada de novidade
// da marca, nada de "aproveite": a cliente deu o e-mail para UMA coisa, e é
// essa coisa que chega. O desenho diz isso com todas as letras.
//
// ⚠️ NENHUM PRAZO DE GARANTIA AQUI. A regra é 2 anos para canvas e 6 meses
// para couro, contados da compra — e o robô do lembrete não sabe o material da
// peça. Um prazo cravado seria mentira para metade das clientes, gravada na
// caixa de entrada delas. Vale o texto geral, ou nada. Há teste que reprova
// qualquer prazo neste texto.
//
// ⚠️ O LINK DE PARAR É OBRIGATÓRIO em todo e-mail, e ele funciona SEM LOGIN:
// o token é a prova. Um lembrete sem saída em um toque vira spam.
export function textoDoLembrete(codigo, linkCertificado, linkParar) {
  const titulo = 'O certificado da sua peça está aqui';
  const miolo = 'Você pediu para a gente lembrar. Este é o certificado digital da sua '
    + 'peça VESSEL — nele você confere a autenticidade e, se quiser, coloca a peça '
    + 'no seu nome. Leva menos de um minuto, e é você quem decide se faz agora.';

  const texto = `${titulo}\n\n${miolo}\n\n`
    + `Peça ${codigo}\n${linkCertificado}\n\n`
    + `Não quero mais receber sobre esta peça:\n${linkParar}\n\n${ASSINATURA}`;

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;color:#2A2823;line-height:1.6">
  <p style="letter-spacing:.2em;font-size:12px;color:#5E6851">VESSEL</p>
  <h1 style="font-weight:300;font-size:22px">${escaparHtml(titulo)}</h1>
  <p>${escaparHtml(miolo)}</p>
  <p style="font-size:13px;letter-spacing:.08em;color:#6B685F">Peça ${escaparHtml(codigo)}</p>
  <p><a href="${escaparHtml(linkCertificado)}" style="background:#2A2823;color:#F2EFE6;padding:12px 20px;text-decoration:none;display:inline-block">Ver o certificado</a></p>
  <p style="font-size:12px;color:#6B685F"><a href="${escaparHtml(linkParar)}" style="color:#6B685F">Não quero mais receber sobre esta peça</a></p>
  <p style="font-size:12px;color:#6B685F">${ASSINATURA}</p>
</div>`;

  return { assunto: 'O certificado da sua peça VESSEL', html, texto };
}
