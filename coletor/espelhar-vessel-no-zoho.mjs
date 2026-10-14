// O ENSAIO DA PLANILHA DA VESSEL — e o resgate, se a edge cair.
//
//   node coletor/espelhar-vessel-no-zoho.mjs --ensaio                  # monta e não envia
//   node coletor/espelhar-vessel-no-zoho.mjs --ensaio --mostrar        # imprime as abas
//   node coletor/espelhar-vessel-no-zoho.mjs --ensaio --gravar-em x.xlsx
//   node coletor/espelhar-vessel-no-zoho.mjs                           # ⚠️ ESCREVE no Zoho
//
// ⚠️ QUEM ESCREVE A PLANILHA NO DIA A DIA NÃO É ESTE ARQUIVO.
// É a edge `vessel-espelhar-lista`, e ela escreve AO VIVO: um gatilho no banco
// (`vessel_lista_espera_espelhar`) a dispara no segundo em que alguém se
// cadastra, e o cron a chama de 3 em 3 minutos. Foi pedido do dono em 12/09/2026.
// Havia também um robô deste repositório escrevendo de hora em hora, no GitHub
// Actions; ele foi desligado em 21/09/2026 para não existirem DOIS escritores no
// mesmo arquivo — o último a subir venceria, e a planilha ficaria pulando entre
// duas versões sem ninguém entender por quê.
//
// Este arquivo continua existindo por dois motivos que valem a manutenção:
//   1. ENSAIO: monta a planilha contra o banco de verdade e imprime, sem enviar
//      nada. É como se confere uma coluna nova antes de publicar a edge.
//   2. RESGATE: se a edge estiver quebrada e o dono precisar da planilha agora,
//      rodar sem `--ensaio` grava o mesmo arquivo, pelo mesmo código.
//
// As abas, as colunas e o fuso moram em `supabase/functions/_shared/`, porque a
// edge (Deno) e o node precisam dos MESMOS. Ver `abas-da-vessel.js`.
import './lib/carregar-env.mjs';
import { conexaoZoho } from './lib/zoho-da-central.mjs';
import { rodada } from './lib/espelho-da-vessel.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const cab = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

const ensaio = process.argv.includes('--ensaio');
const mostrar = process.argv.includes('--mostrar');
const gravarEm = (() => {
  const i = process.argv.indexOf('--gravar-em');
  return i > 0 ? process.argv[i + 1] : null;
})();

/**
 * ⚠️ TRÊS TENTATIVAS, E NÃO UMA. Medido em 12/09/2026: na virada do minuto
 * vários cron disparam juntos e o PostgREST devolve `Gateway Timeout`. Com 15
 * leituras por rodada, uma falha solta derrubaria a rodada inteira.
 */
async function ler({ tabela, colunas }) {
  const linhas = [];
  for (let inicio = 0; ; inicio += 1000) {
    // Sem `order`: quem ordena é a aba (ver o aviso em `CONSULTAS`).
    const url = `${REST}/${tabela}?select=${colunas}&limit=1000&offset=${inicio}`;
    let parte = null;
    let ultimoErro = '';
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      const r = await fetch(url, { headers: cab });
      if (r.ok) { parte = await r.json(); break; }
      ultimoErro = `HTTP ${r.status} ${(await r.text()).slice(0, 120)}`;
      if (tentativa < 3) await new Promise((ok) => setTimeout(ok, 600 * tentativa));
    }
    if (parte === null) throw new Error(`${tabela}: ${ultimoErro}`);
    linhas.push(...parte);
    if (parte.length < 1000) break;
  }
  return linhas;
}

if (!SERVICE_KEY) { console.error('⛔ Falta SUPABASE_SERVICE_KEY.'); process.exit(1); }

if (!ensaio) {
  console.log('\n⚠️ ESCREVENDO NO ZOHO À MÃO. No dia a dia quem faz isso é a edge `vessel-espelhar-lista`, ao vivo.');
}
await rodada({ ler, conexao: () => conexaoZoho(REST, cab), ensaio, mostrar, gravarEm });
