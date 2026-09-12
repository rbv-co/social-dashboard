// OS ENDEREÇOS EM QUE O APP ATENDE.
//
// A Central mudou de endereço: nasceu em `socialdashboard.rbvcompany.com` e vai
// passar a se chamar `central.rbvcompany.com`. Durante a mudança os DOIS ficam
// vivos, servindo exatamente o mesmo app — quem já usa o antigo não perde nada.
//
// Esta lista mora AQUI, e não copiada dentro de cada função, porque três cópias
// na mão envelhecem: bastaria alguém acrescentar um endereço num arquivo e
// esquecer dos outros dois para o Controle de Acessos parar em silêncio.
//
// Quem depende desta lista:
//   • acessos-proxy   — a origem liberada no CORS. Sem o endereço aqui, o
//                       módulo Controle de Acessos NÃO ABRE nesse endereço.
//   • acessos-oauth   — para onde a volta do Zoho / OneDrive joga a pessoa.
//   • invite-user     — o link do convite e o da troca de senha.
//
// Um endereço a mais aqui não basta sozinho: o mesmo endereço precisa estar
// também na lista de retornos permitidos do Supabase Auth (Authentication →
// URL Configuration), senão o convite e a troca de senha são recusados.
export const ENDERECOS_DO_APP = [
  'https://socialdashboard.rbvcompany.com',
  'https://central.rbvcompany.com',
];

// O endereço usado quando não dá para saber de onde a pessoa veio — links de
// e-mail, por exemplo, que são montados no servidor sem navegador nenhum.
//
// AINDA É O ANTIGO de propósito. Enquanto o endereço novo não estiver de pé e
// provado, um link de convite apontando para ele seria um link morto. Trocar
// esta linha (e só ela) é o que vira a chave da mudança.
export const ENDERECO_PADRAO = 'https://socialdashboard.rbvcompany.com';

// A origem é permitida? Devolve a própria origem, ou null.
// Compara texto exato: nada de "termina com rbvcompany.com", que aceitaria
// `rbvcompany.com.site-de-outro.net` e qualquer subdomínio de terceiro.
export function enderecoPermitido(origem) {
  if (typeof origem !== 'string') return null;
  return ENDERECOS_DO_APP.includes(origem) ? origem : null;
}

// Para onde devolver a pessoa: o endereço de onde ela veio, se for um dos
// nossos; senão o padrão. Nunca o que o pedido mandou sem conferir — seria
// mandar gente (e link de troca de senha) para um site qualquer.
export function enderecoDeRetorno(origem) {
  return enderecoPermitido(origem) || ENDERECO_PADRAO;
}

// Os cabeçalhos de CORS de UM pedido, devolvendo a origem que perguntou.
// `Vary: Origin` é obrigatório: sem ele, um cache guardaria a resposta com a
// liberação de um endereço e a entregaria para o outro.
export function corsDoPedido(req, metodos = 'POST, OPTIONS') {
  const origem = enderecoDeRetorno(req?.headers?.get?.('Origin'));
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Methods': metodos,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    Vary: 'Origin',
  };
}
