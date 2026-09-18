// supabase/functions/_shared/email-zeptomail.ts
// O ENVIO DE E-MAIL DA CONTA, pelo ZeptoMail (Zoho).
//
// O domínio vesselbrasil.com.br está verificado lá desde 17/09/2026 (DKIM
// `171134._domainkey` e bounce `bounce-zem` publicados no Registro.br).
//
// ⚠️ FALHA DE ENVIO NÃO DERRUBA A CHAMADA: quem chama decide o que dizer à
// cliente. Aqui devolve-se apenas true/false.
//
// ⚠️ A CHAVE NÃO MORA AQUI. `ZEPTOMAIL_TOKEN` vem do segredo da Supabase (quem
// grava é o dono, pelo `supabase secrets set` — nunca em arquivo do
// repositório, nunca em `vessel-brasil`, que é público). Sem o segredo, a
// função devolve `false` em vez de mandar a chamada sem autorização.
const TOKEN = Deno.env.get('ZEPTOMAIL_TOKEN') ?? '';
const REMETENTE = Deno.env.get('ZEPTOMAIL_DE') ?? 'nao-responda@vesselbrasil.com.br';

// O ZeptoMail exige o esquema `Zoho-enczapikey <chave>` no cabeçalho — não
// aceita a chave crua. O painel do Zoho às vezes já entrega a chave COM esse
// prefixo e às vezes só a chave; se a gente sempre concatenasse o prefixo,
// no dia em que o dono colar a chave já prefixada o cabeçalho ficaria
// duplicado e a Supabase devolveria 401 — calado, porque `mandarEmail` só
// devolve `true`/`false`. Por isso aceita os dois formatos de entrada.
function cabecalhoDeAutorizacao(token: string): string {
  return token.startsWith('Zoho-enczapikey') ? token : `Zoho-enczapikey ${token}`;
}

export async function mandarEmail(
  para: string,
  msg: { assunto: string; html: string; texto: string },
): Promise<boolean> {
  if (!TOKEN) return false;
  try {
    const r = await fetch('https://api.zeptomail.com/v1.1/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json',
                 Authorization: cabecalhoDeAutorizacao(TOKEN) },
      body: JSON.stringify({
        from: { address: REMETENTE, name: 'VESSEL Brasil' },
        to: [{ email_address: { address: para } }],
        subject: msg.assunto,
        htmlbody: msg.html,
        textbody: msg.texto,
      }),
    });
    return r.ok;
  } catch {
    // Rede fora, DNS, timeout: qualquer coisa aqui é "não conseguimos
    // mandar agora", não um erro para propagar — quem chama decide o que
    // fazer (tentar de novo, avisar em tela, etc.).
    return false;
  }
}
