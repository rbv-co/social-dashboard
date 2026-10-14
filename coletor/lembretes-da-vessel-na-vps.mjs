// O ROBÔ DO LEMBRETE ("Register Later", Registered Pieces) NA VPS, no lugar da edge `vessel-lembretes` + pg_cron.
//
// Uma vez por dia (o cron de antes era `0 12 * * *` UTC): pergunta ao banco quais lembretes venceram (7 ou 30 dias) e cuja peça
// CONTINUA sem registro, manda o e-mail com o link do certificado e marca o envio. ELE NÃO DECIDE NADA: quem escolhe as linhas,
// conta os dias, confere a dona e sorteia o token do link de parar é o BANCO (`vessel_lembretes_a_enviar`).
//
//   0 12 * * *  cd /opt/central && DATABASE_URL=... ZEPTOMAIL_TOKEN=... node coletor/lembretes-da-vessel-na-vps.mjs     (cron ou systemd timer)
//
// ⚠️ E-MAIL QUE FALHA NÃO SOME: a marca de envio só é gravada DEPOIS que o ZeptoMail aceitou; o que falhou volta na próxima rodada.
//    Se marcar falhar com o e-mail já enviado, a cliente recebe duas vezes (melhor que nunca).
// ⚠️ O TOKEN DO LINK vem em claro SÓ na resposta do banco e vai SÓ para o corpo do e-mail daquela cliente: nunca para log. O
//    e-mail no log vai mascarado. Um processo por banco (advisory lock). Os textos são os do JS (`_shared/email-textos.js`).
import { textoDoLembrete, mascararEmail } from '../supabase/functions/_shared/email-textos.js';

export const ROBO = 'vessel-lembretes';
const SITE = 'https://vesselbrasil.com.br';
const linkDoCertificado = (codigo) => `${SITE}/verify/${encodeURIComponent(codigo)}`;
// `?t=` é o nome na barra do navegador; a tela o manda à `vessel-conta` como `token_lembrete` (ver o comentário da edge original)
const linkDeParar = (token) => `${SITE}/verify/parar-lembrete?t=${encodeURIComponent(token)}`;

/** ZeptoMail: true se aceitou. Nunca loga token, destinatário nem texto. `http` é injetável no teste. */
export function mandadorZepto({ token, de = 'nao-responda@vesselbrasil.com.br', http = fetch, log = console.error }) {
  return async (para, msg) => {
    if (!token) { log('zeptomail: ZEPTOMAIL_TOKEN ausente'); return false; }
    const auth = token.startsWith('Zoho-enczapikey') ? token : `Zoho-enczapikey ${token}`;
    try {
      const r = await http('https://api.zeptomail.com/v1.1/email', {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: auth },
        body: JSON.stringify({ from: { address: de, name: 'VESSEL Brasil' }, to: [{ email_address: { address: para } }],
          subject: msg.assunto, htmlbody: msg.html, textbody: msg.texto }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) return true;
      const c = await r.json().catch(() => null);
      log('zeptomail recusou', r.status, c?.error?.code, c?.error?.message);
      return false;
    } catch (e) { log('zeptomail sem resposta', e?.message); return false; }
  };
}

/** Uma rodada. `cli` = cliente pg; `enviar(para, msg)` → boolean; `respiro` em ms entre e-mails (o ZeptoMail limita por segundo). */
export async function rodada(cli, enviar, { respiro = 250, log = console.error, dorme = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const { rows: [{ r }] } = await cli.query('select vessel_lembretes_a_enviar() as r');
  const linhas = Array.isArray(r?.linhas) ? r.linhas : [];
  let mandados = 0, falharam = 0;
  for (const l of linhas) {
    if (mandados + falharam > 0) await dorme(respiro);
    const enviou = await enviar(l.email, textoDoLembrete(l.peca_codigo, linkDoCertificado(l.peca_codigo), linkDeParar(l.token)));
    if (!enviou) {
      falharam++;
      log(`${ROBO}: envio de ${l.qual} dias falhou para ${mascararEmail(l.email)} (peça ${l.peca_codigo}): fica para a próxima rodada`);
      continue;
    }
    try {
      const { rows: [{ m }] } = await cli.query('select vessel_lembrete_marcar_enviado($1::uuid, $2::int) as m', [l.id, l.qual]);
      if (m && m.marcado === false) log(`${ROBO}: o de ${l.qual} dias da peça ${l.peca_codigo} já estava marcado`);
      mandados++;
    } catch (e) {
      falharam++;
      log(`${ROBO}: mandei o de ${l.qual} dias e NÃO consegui marcar (peça ${l.peca_codigo}): ${e.message}`);
    }
  }
  return { mandados, falharam };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.env.DATABASE_URL) { console.error('⛔ Falta DATABASE_URL.'); process.exit(1); }
  const { default: pg } = await import('pg');
  const cli = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await cli.connect();
  const inicio = new Date();
  let saida = 0, resposta = 'ok';
  try {
    const { rows: [{ ok }] } = await cli.query(`select pg_try_advisory_lock(hashtext('robo:vessel-lembretes')) as ok`);
    if (!ok) { console.error('outra rodada do lembrete já está em andamento'); process.exit(2); }
    const r = await rodada(cli, mandadorZepto({ token: (process.env.ZEPTOMAIL_TOKEN || '').trim(), de: process.env.ZEPTOMAIL_DE || undefined }));
    console.log(JSON.stringify(r));
    if (r.falharam > 0) { saida = 1; resposta = `${r.mandados} mandados, ${r.falharam} falharam`; }
    else resposta = `${r.mandados} mandados`;
  } catch (e) { saida = 1; resposta = String(e.message).slice(0, 400); console.error(`${ROBO}: ${resposta}`); }
  try {
    await cli.query(`insert into robos_execucoes (robo, disparado_em, status_code, ok, resposta, conferido_em) values ($1, $2, $3, $4, $5, now())`,
      [ROBO, inicio, saida ? 500 : 200, !saida, resposta]);
  } catch { /* a linha de saúde não derruba o robô */ }
  await cli.end();
  process.exit(saida);
}
