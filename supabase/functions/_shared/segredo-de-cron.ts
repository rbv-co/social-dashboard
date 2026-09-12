// Autorização das funções chamadas pelo pg_cron.
//
// POR QUE ISTO EXISTE
//
// O toggle `verify_jwt` do gateway NÃO protege nada aqui: ele só confere que o JWT
// foi assinado pelo projeto — e a chave anon É um JWT desses, publicada no bundle
// público do site (o repositório é público). Quem abre o site copia a chave.
//
// Isso não era teoria: o cron do `coletar-dados` mandava exatamente a anon key, e o
// do `auditar-dados` não mandava cabeçalho de autorização nenhum, com
// verify_jwt=false — ou seja, era um endpoint aberto na internet que apagava a
// trilha de auditoria, gastava a cota da Graph API e disparava o webhook de alerta.
//
// A auth aqui é SELF-CONTAINED (não depende de toggle do gateway) e FAIL-CLOSED
// (qualquer erro nega). O segredo vive na tabela `segredos_de_cron`, que tem RLS
// ligada e zero policies: só o service role lê. O pg_cron monta o cabeçalho lendo
// dessa tabela na hora de disparar, então o segredo também não aparece no texto de
// `cron.job.command`.
//
// Mesmo espírito da `fabrica-purga`, que já usava segredo dedicado + comparação em
// tempo constante — só que sem depender de variável de ambiente.

import { createClient } from "jsr:@supabase/supabase-js@2";

// Comparação em tempo constante: evita que o atacante descubra o segredo medindo
// quanto tempo a comparação leva a cada caractere certo.
export function igualTempoConstante(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

const naoAutorizado = () =>
  new Response(JSON.stringify({ error: "nao_autorizado" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });

// A LEITURA do segredo tenta 3 vezes (com folga curta entre elas) antes de
// desistir. Achado em 12/09/2026: enviar-relatorio-hora recebeu um 401 numa
// rodada isolada de cron — sem timeout, sem erro de segredo errado (a mesma
// leitura funcionou normal um minuto antes e depois) — cara de soluço
// passageiro no meio de caminho (PostgREST/rede), não de configuração. Sem
// retry, um soluço desses vira uma rodada inteira perdida, silenciosa.
//
// NÃO retenta a COMPARAÇÃO do segredo (isso é fail-closed de propósito: chave
// errada é chave errada, tentar de novo não muda o resultado) — só a leitura
// que pode falhar por causa de rede/serviço.
async function buscarSegredo(nome: string): Promise<string | null> {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  let ultimoErro: unknown;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const { data, error } = await sb
        .from("segredos_de_cron")
        .select("segredo")
        .eq("nome", nome)
        .single();
      if (!error && data?.segredo) return data.segredo;
      ultimoErro = error;
    } catch (e) {
      ultimoErro = e;
    }
    if (tentativa < 2) await new Promise((r) => setTimeout(r, 300 * (tentativa + 1)));
  }
  console.error(`exigirSegredoDeCron: não leu o segredo "${nome}" depois de 3 tentativas`, ultimoErro);
  return null;
}

/**
 * Devolve `null` se o chamador está autorizado, ou a Response 401 pronta se não.
 *
 * Uso:
 *   const negado = await exigirSegredoDeCron(req, "auditar-dados");
 *   if (negado) return negado;
 *
 * @param req  a requisição recebida
 * @param nome a chave em `segredos_de_cron` (ex.: "auditar-dados")
 */
export async function exigirSegredoDeCron(req: Request, nome: string): Promise<Response | null> {
  const auth = req.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return naoAutorizado();

  // Fail-closed: sem segredo cadastrado (ou sem conseguir ler depois das
  // tentativas), ninguém entra. Melhor a coleta parar barulhentamente (401
  // visível em cron.job_run_details) do que o endpoint ficar aberto por
  // causa de um erro de configuração.
  const segredo = await buscarSegredo(nome);
  if (!segredo) return naoAutorizado();

  if (!igualTempoConstante(auth, `Bearer ${segredo}`)) return naoAutorizado();
  return null;
}
