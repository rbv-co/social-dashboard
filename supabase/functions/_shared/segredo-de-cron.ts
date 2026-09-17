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

import { decidirRepeticao } from "./tentar-de-novo.js";
import { decidirAutorizacao } from "./autorizacao-de-cron.js";

// ⚠️ A DECISÃO NÃO MORA MAIS AQUI. As regras (o que entra, o que nega, quando
// vale reler o banco) vivem em `autorizacao-de-cron.js`, puras e com teste de
// verdade — este arquivo fala com a rede e com o Deno, e isso não se prova num
// teste de `node`. Aqui ficou só o encanamento.
// A comparação em tempo constante continua exportada para quem já a importava.
export { igualTempoConstante } from "./autorizacao-de-cron.js";

const naoAutorizado = () =>
  new Response(JSON.stringify({ error: "nao_autorizado" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });

/* ⚠️ POR QUE ISTO DEIXOU DE SER UMA LEITURA SÓ (medido em 12/09/2026)
 *
 * Fail-closed é a regra certa para segredo ERRADO. Mas ela estava negando também
 * quando o segredo apenas DEMOROU — e isso acontecia o tempo todo:
 *
 *   18:24:01  GET  504  /rest/v1/segredos_de_cron?nome=eq.vessel-espelhar-lista
 *   18:24:06  POST 401  /functions/v1/vessel-espelhar-lista
 *   18:25:01  GET  504  /rest/v1/segredos_de_cron?nome=eq.conteudo-espelho
 *
 * Nas 12 horas anteriores, de cada ~20 rodadas do espelho da Vessel, 2 a 4
 * morriam assim — e o `conteudo-espelho` levou o mesmo 504 um minuto depois, ou
 * seja: NÃO É DE UM ROBÔ, é da casa. A causa é a virada do minuto, quando vários
 * cron disparam juntos e o PostgREST engasga numa leitura de UMA linha.
 *
 * Duas mudanças, e nenhuma afrouxa a tranca:
 *
 *  1. TENTA DE NOVO quando a leitura falha por 5xx/429/mudo. A política vem de
 *     `tentar-de-novo.js`, que já existia e já distingue "resposta dele" de
 *     "falha dele" — 404 continua não se repetindo.
 *
 *  2. GUARDA EM MEMÓRIA por 5 minutos. O isolate que já leu não volta ao banco,
 *     então a maior parte das rodadas nem chega a depender do PostgREST.
 *
 * ⚠️ E A ROTAÇÃO DO SEGREDO CONTINUA FUNCIONANDO. Se a comparação falhar com um
 * valor que veio da memória, ele é descartado e o banco é lido de novo ANTES de
 * negar. Sem isso, trocar o segredo derrubaria os robôs por até 5 minutos — um
 * defeito que só apareceria no dia da troca, que é o pior dia para descobrir.
 *
 * O MESMO SOLUÇO FOI ACHADO DUAS VEZES, POR DUAS PESSOAS, NO MESMO DIA. Em
 * 12/09/2026 o `enviar-relatorio-hora` também tomou um 401 numa rodada isolada —
 * sem timeout, sem segredo errado, a mesma leitura funcionando um minuto antes e
 * depois — e o conserto (c5ab4b7) foi repetir a leitura 3 vezes. Em 13/09 o
 * `coletar-dados-hora` perdeu três horas seguidas pelo mesmo motivo. As duas
 * correções foram juntadas aqui em 14/09: a repetição dele virou a política de
 * `tentar-de-novo.js`, e a linha de log que ele pôs quando a leitura desiste
 * continua lá embaixo. NÃO se repete a COMPARAÇÃO: chave errada é chave errada. */
const TTL_DA_MEMORIA_MS = 5 * 60 * 1000;
const memoria = new Map<string, { segredo: string; ate: number }>();

// Prazo curto: é uma linha de uma tabela minúscula. Se não veio em 4s, não vem.
const PRAZO_MS = 4000;
const ORCAMENTO_MS = 15000;

const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Lê o segredo no banco, tentando de novo enquanto a falha for do banco. */
async function lerDoBanco(nome: string): Promise<string | null> {
  const url = `${Deno.env.get("SUPABASE_URL")}/rest/v1/segredos_de_cron`
    + `?select=segredo&nome=eq.${encodeURIComponent(nome)}`;
  const chave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const comeco = Date.now();

  for (let tentativa = 1; ; tentativa++) {
    let status: number | null = null;
    let estourouOPrazo = false;
    try {
      const r = await fetch(url, {
        headers: { apikey: chave, Authorization: `Bearer ${chave}` },
        signal: AbortSignal.timeout(PRAZO_MS),
      });
      status = r.status;
      if (r.ok) {
        const linhas = await r.json();
        const segredo = Array.isArray(linhas) ? linhas[0]?.segredo : null;
        return typeof segredo === "string" && segredo ? segredo : null;
      }
    } catch {
      estourouOPrazo = true;
    }
    const { repetir, esperarMs } = decidirRepeticao({
      tentativa, status, estourouOPrazo,
      msDecorridos: Date.now() - comeco,
      fornecedor: "banco",
      prazoPorTentativaMs: PRAZO_MS,
      orcamentoMs: ORCAMENTO_MS,
    });
    if (!repetir) {
      // Sem esta linha a desistência fica calada: o robô só devolve 401 e ninguém
      // sabe se foi segredo errado ou banco engasgado. (Log trazido de c5ab4b7.)
      console.error(`exigirSegredoDeCron: não leu o segredo "${nome}" depois de ${tentativa} tentativa(s)`,
        { status, estourouOPrazo });
      return null;
    }
    await dormir(esperarMs);
  }
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

  try {
    const guardado = memoria.get(nome);
    const naMemoria = guardado && guardado.ate > Date.now() ? guardado.segredo : null;

    const comMemoria = decidirAutorizacao({ auth, segredoNaMemoria: naMemoria });
    if (comMemoria.acao === "autorizar") return null;
    if (comMemoria.acao === "negar") return naoAutorizado();
    if (comMemoria.descartarMemoria) memoria.delete(nome);

    // `lerDoBanco` devolve `null` tanto para "não existe" quanto para "não
    // consegui ler nem tentando". Os dois negam — fail-closed —, e é a repetição
    // lá dentro que faz o segundo caso ser raro.
    const doBanco = await lerDoBanco(nome);
    if (doBanco) memoria.set(nome, { segredo: doBanco, ate: Date.now() + TTL_DA_MEMORIA_MS });
    return decidirAutorizacao({ auth, segredoDoBanco: doBanco }).acao === "autorizar"
      ? null
      : naoAutorizado();
  } catch {
    return naoAutorizado();
  }
}
