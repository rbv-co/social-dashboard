// supabase/functions/vessel-lembretes/index.ts
//
// O ROBÔ DO LEMBRETE ("Register Later", Registered Pieces).
//
// Desenho: docs/superpowers/specs/2026-09-19-register-later-design.md
// Banco:   db/migrations/2026-09-19-zzz-vessel-lembretes-register-later.sql
//
// Uma vez por dia o cron chama aqui. O robô pergunta ao banco quais lembretes
// venceram (7 ou 30 dias) e cuja peça CONTINUA sem registro, manda para cada
// um o e-mail com o link do certificado daquela peça e marca o envio.
//
// ⚠️ ELE NÃO DECIDE NADA. Quem escolhe as linhas, quem conta os 7 e os 30
// dias, quem confere se a peça ganhou dona e quem sorteia o token do link de
// parar é o BANCO. Aqui só se lê a lista, manda-se o e-mail e volta-se para
// dizer que saiu. Uma Edge Function não guarda estado entre chamadas — regra
// escrita em JavaScript aqui pareceria existir sem existir, e quem chamasse a
// edge por fora passaria por cima dela.
//
// ⚠️ E-MAIL QUE FALHA NÃO SOME. A marca de envio (`vessel_lembrete_marcar_
// enviado`) só é gravada depois que o ZeptoMail aceitou. O que falhou fica na
// fila e volta na próxima rodada, com o motivo no log. Marcar antes seria a
// pior falha possível: a cliente nunca recebe e a linha some da fila.
//
// ⚠️ NENHUM PRAZO DE GARANTIA NO E-MAIL. A regra é 2 anos para canvas e 6
// meses para couro, contados da compra — e este robô não recebe o material da
// peça. O texto mora em `_shared/email-textos.js` e há teste que reprova
// qualquer prazo dentro dele.
//
// ⚠️ O PORTÃO É O MESMO DOS OUTROS 12 ROBÔS (`_shared/segredo-de-cron.ts`), e
// vem antes da primeira ida ao banco. Publicar com `--no-verify-jwt`: a tranca
// de verdade é o segredo do cron, não o toggle do gateway (ver CLAUDE.md).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { textoDoLembrete, mascararEmail } from '../_shared/email-textos.js';
import { mandarEmail } from '../_shared/email-zeptomail.ts';

const ROBO = 'vessel-lembretes';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// O endereço do certificado é o mesmo desde 30/08/2026, e é o que está gravado
// na etiqueta NFC de cada peça: vesselbrasil.com.br/verify/<CÓDIGO>.
// A tela de parar de receber é irmã dele e não pede login — o token é a prova.
const SITE = 'https://vesselbrasil.com.br';
const linkDoCertificado = (codigo: string) => `${SITE}/verify/${encodeURIComponent(codigo)}`;
const linkDeParar = (token: string) =>
  `${SITE}/verify/parar-lembrete?t=${encodeURIComponent(token)}`;

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status, headers: { 'Content-Type': 'application/json' },
  });

type Linha = { id: string; peca_codigo: string; email: string; qual: number; token: string };

Deno.serve(async (req) => {
  const barrado = await exigirSegredoDeCron(req, ROBO);
  if (barrado) return barrado;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ⚠️ O TOKEN DO LINK É SORTEADO AQUI DENTRO, pelo banco, a cada rodada — e
  // vem em claro NESTA resposta e em lugar nenhum mais. Ele não vai para log,
  // não fica em variável guardada e não volta para ninguém: só entra no corpo
  // do e-mail daquela cliente.
  const { data, error } = await sb.rpc('vessel_lembretes_a_enviar');
  if (error) {
    console.error(`${ROBO}: não consegui ler a fila —`, error.message);
    return json({ ok: false, motivo: 'fila_indisponivel' }, 500);
  }

  const linhas: Linha[] = Array.isArray(data?.linhas) ? data.linhas : [];
  if (linhas.length === 0) return json({ ok: true, mandados: 0, falharam: 0 });

  let mandados = 0;
  let falharam = 0;

  for (const l of linhas) {
    // ⚠️ RESPIRO ENTRE UM E OUTRO. O ZeptoMail limita chamadas por segundo, e
    // um lote grande sem pausa volta 429 — que pareceria "e-mail recusado" e
    // deixaria a linha na fila para sempre. 250ms dá 4 por segundo, com folga.
    // (Mesma lição do respiro de 400ms da `vessel-espelhar-lista` contra o
    // Bling.)
    if (mandados + falharam > 0) await new Promise((ok) => setTimeout(ok, 250));

    const enviou = await mandarEmail(
      l.email,
      textoDoLembrete(l.peca_codigo, linkDoCertificado(l.peca_codigo), linkDeParar(l.token)),
    );

    if (!enviou) {
      falharam++;
      // ⚠️ O E-MAIL VAI MASCARADO E O TOKEN NÃO VAI. O log do projeto é lido
      // por gente da Central; o endereço inteiro de uma cliente não precisa
      // estar lá, e o token vale por um cancelamento.
      console.error(`${ROBO}: envio de ${l.qual} dias falhou para `
        + `${mascararEmail(l.email)} (peça ${l.peca_codigo}) — fica para a próxima rodada`);
      continue;
    }

    // Só agora. Se esta chamada falhar, o e-mail já saiu e a linha continua na
    // fila: a cliente recebe duas vezes, que é MUITO melhor do que nunca
    // receber e ninguém ficar sabendo.
    const { data: marca, error: erroMarca } = await sb.rpc('vessel_lembrete_marcar_enviado', {
      p_id: l.id, p_qual: l.qual,
    });
    if (erroMarca) {
      falharam++;
      console.error(`${ROBO}: mandei o de ${l.qual} dias e NÃO consegui marcar `
        + `(peça ${l.peca_codigo}) —`, erroMarca.message);
      continue;
    }
    if (marca && marca.marcado === false) {
      console.warn(`${ROBO}: o de ${l.qual} dias da peça ${l.peca_codigo} já estava marcado`);
    }
    mandados++;
  }

  return json({ ok: true, mandados, falharam });
});
