// DE QUAL LEAD VEIO ESTE PEDIDO? — a regra, pura, com teste ao lado.
//
// ⚠️ POR QUE ISTO EXISTE (medido em 23/09/2026)
// Os 170 cadastros da LP sobem ao Bling como "Lead", e a ideia era que a loja
// escolhesse essa ficha no dia da venda. Não escolhe: dos 130 pedidos desde
// 28/08, NENHUM veio na ficha de um lead. A vendedora cria outra, com CPF.
// Então "quantos leads viraram venda" não se responde pelo Bling — só cruzando
// o que a pessoa deixou na LP com a ficha de quem comprou.
//
// ⚠️ A ESCADA, da prova mais forte para a mais fraca:
//   1. ficha  — o pedido saiu na ficha que o nosso robô criou para o lead
//   2. email  — é único na lista de espera
//   3. telefone — WhatsApp da LP contra celular/telefone da ficha, com ou sem
//      o nono dígito (ficha antiga da loja às vezes está sem)
// NÃO casa por nome: "Cristiane" sozinha casaria com meia base.
//
// ⚠️ SÓ CONTA PEDIDO NO DIA DO CADASTRO OU DEPOIS. Quem já era cliente e se
// cadastrou depois não é conversão do lead — contar isso inflaria o número que
// o dono vai usar para julgar os anúncios.

/** Telefone do jeito que o resto do sistema guarda: só dígitos, com o país. */
export function telefoneCanonico(bruto) {
  const d = String(bruto || '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return '55' + d;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

// Celular com e sem o 9 vira a mesma chave: país + DDD + 8 finais.
const semNono = (t) => (t && t.length === 13 ? t.slice(0, 4) + t.slice(5) : t);
const emailLimpo = (e) => String(e || '').trim().toLowerCase();

/** O dia do cadastro em São Paulo (a LP é brasileira; UTC erraria à noite). */
function diaEmSaoPaulo(instante) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' })
    .format(new Date(instante));
}

/** Monta os índices uma vez por rodada. Leads mais antigos primeiro. */
export function indiceDeLeads(leads) {
  const porFicha = new Map(), porEmail = new Map(), porTelefone = new Map();
  const ordenados = [...leads].sort((a, b) => String(a.criado_em).localeCompare(String(b.criado_em)));
  const junta = (mapa, chave, lead) => {
    if (!chave) return;
    if (!mapa.has(chave)) mapa.set(chave, []);
    mapa.get(chave).push(lead);
  };
  for (const l of ordenados) {
    const lead = { id: l.id, dia: diaEmSaoPaulo(l.criado_em) };
    junta(porFicha, l.bling_id ? String(l.bling_id) : null, lead);
    junta(porEmail, emailLimpo(l.email) || null, lead);
    junta(porTelefone, semNono(telefoneCanonico(l.whatsapp)), lead);
  }
  return { porFicha, porEmail, porTelefone };
}

/**
 * @param idx       o que `indiceDeLeads` devolveu
 * @param ficha     `{ contatoId, telefones: [...canônicos], email }` de quem comprou
 * @param diaDoPedido 'AAAA-MM-DD'
 * @returns `{ leadId, por }` ou `null`
 */
export function leadDoPedido(idx, ficha, diaDoPedido) {
  // O mais antigo que já existia no dia da compra.
  const primeiro = (lista) => (lista || []).find((l) => l.dia <= diaDoPedido) || null;

  const f = ficha?.contatoId ? primeiro(idx.porFicha.get(String(ficha.contatoId))) : null;
  if (f) return { leadId: f.id, por: 'ficha' };

  const e = emailLimpo(ficha?.email) ? primeiro(idx.porEmail.get(emailLimpo(ficha.email))) : null;
  if (e) return { leadId: e.id, por: 'email' };

  for (const t of ficha?.telefones || []) {
    const chave = semNono(telefoneCanonico(t));
    const achou = chave ? primeiro(idx.porTelefone.get(chave)) : null;
    if (achou) return { leadId: achou.id, por: 'telefone' };
  }
  return null;
}
