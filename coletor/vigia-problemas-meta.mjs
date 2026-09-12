#!/usr/bin/env node
// O VIGIA DIÁRIO DO QUE A META RECLAMA.
//
// POR QUE EXISTE: `gt_problemas_meta` é a memória que a Meta não tem — o
// `issues_info` do Graph SOME quando o anúncio é excluído ou o problema é
// resolvido. Mas até agora quem gravava era A TELA: só ficava registrado o que
// alguém viu ao abrir a Gestão de Tráfego. Um problema que nasce e morre entre
// duas visitas não deixava rastro nenhum — e foi exatamente esse o caso que deu
// origem a tudo isto, a campanha barrada que ninguém viu a tempo.
//
// Este robô faz a MESMA leitura e chama a MESMA função (`gt_registrar_problemas`),
// sem depender de gente. Custo: zero de IA, é só leitura do Graph.
//
// AS TRÊS REGRAS QUE NÃO SE NEGOCIAM:
//
// 1. CONTA CUJA LEITURA FALHOU É PULADA — nunca mandada vazia. A lista vazia é
//    o que FECHA o que sumiu; se um erro de rede virasse lista vazia, o robô
//    daria por resolvido um problema que continua aberto, e todo dia. Este
//    projeto já teve limite de taxa virando lista vazia uma vez.
// 2. CONTA LIDA COM SUCESSO E SEM PROBLEMA NENHUM É MANDADA VAZIA, de propósito.
//    É assim que problema resolvido para de aparecer como aberto.
// 3. RITMO. As chamadas dividem o limite da Meta com o painel ao vivo. Pausa
//    entre contas, e de madrugada.
//
// Uso:
//   node coletor/vigia-problemas-meta.mjs           (lê e grava)
//   node coletor/vigia-problemas-meta.mjs --dry     (lê, mostra, NÃO grava)
//   node coletor/vigia-problemas-meta.mjs --pausa 3000
//
// Bandeira que o robô não conhece FAZ ELE PARAR, em vez de ser ignorada.
import './lib/carregar-env.mjs';
import { linhasDaConta } from './lib/problemas-por-conta.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const GRAPH = 'https://graph.facebook.com/v21.0';
const sb = { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' };

const PAUSA_MINIMA = 250;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------- argumentos

function interpretarArgumentos(argv) {
  const saida = { dry: false, pausa: 1500 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry' || a === '--dry-run') { saida.dry = true; continue; }
    if (a === '--pausa') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n)) return { erro: '--pausa precisa de um número em milissegundos' };
      saida.pausa = Math.max(PAUSA_MINIMA, n);
      continue;
    }
    return { erro: `não conheço a opção "${a}"` };
  }
  return saida;
}

const ARGS = interpretarArgumentos(process.argv.slice(2));
if (ARGS.erro) {
  console.error(`✗ ${ARGS.erro}`);
  console.error('  node coletor/vigia-problemas-meta.mjs [--dry|--dry-run] [--pausa <ms>]');
  process.exit(1);
}

// ------------------------------------------------------------- Supabase

async function contasComAnuncio() {
  const r = await fetch(`${REST}/accounts?select=id,name,ad_account_id,access_token`, { headers: sb });
  if (!r.ok) throw new Error(`GET accounts -> ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).filter((c) => c && c.ad_account_id && c.access_token);
}

// A MESMA função que a tela chama. Ela é `security definer`, sabe fechar o que
// sumiu, e o `service_role` já tem permissão de executar (conferido em 18/08/2026).
async function registrar(contaId, linhas) {
  const r = await fetch(`${REST}/rpc/gt_registrar_problemas`, {
    method: 'POST',
    headers: sb,
    body: JSON.stringify({ p_conta: contaId, p_itens: linhas }),
  });
  if (!r.ok) throw new Error(`RPC -> ${r.status} ${(await r.text()).slice(0, 200)}`);
}

// ------------------------------------------------------------- Meta

async function graphTudo(caminho, campos, token) {
  const url = new URL(`${GRAPH}/${caminho}`);
  url.searchParams.set('fields', campos);
  url.searchParams.set('limit', '500');
  url.searchParams.set('access_token', token);

  const todos = [];
  let proxima = url.toString();
  let pagina = 0;
  // Teto de páginas: a Meta já devolveu cursor que gira sozinho neste projeto.
  while (proxima && pagina < 40) {
    if (pagina++) await dormir(ARGS.pausa);
    const r = await fetch(proxima);
    const j = await r.json().catch(() => null);
    if (!r.ok || !j?.data) throw new Error(j?.error?.message || `HTTP ${r.status}`);
    todos.push(...j.data);
    proxima = j.paging?.next || null;
  }
  return todos;
}

// ------------------------------------------------------------- rodada

async function principal() {
  if (!SERVICE_KEY) {
    console.error('✗ falta SUPABASE_SERVICE_KEY no ambiente.');
    process.exit(1);
  }

  const contas = await contasComAnuncio();
  console.log(`${contas.length} conta(s) com conta de anúncio.${ARGS.dry ? '  [--dry: não grava]' : ''}`);

  let gravadas = 0;
  let totalLinhas = 0;
  const falharam = [];

  for (const conta of contas) {
    const acc = String(conta.ad_account_id).replace(/^act_/, '');
    let campanhas;
    let anuncios;
    try {
      campanhas = await graphTudo(`act_${acc}/campaigns`, 'id,name', conta.access_token);
      await dormir(ARGS.pausa);
      // `anúncios TODOS`, sem filtrar por ativo: medido em 17/08/2026, dos 13
      // anúncios com `issues_info` nas 5 contas, ZERO estavam ACTIVE. Um problema
      // grave tira o anúncio do ar por definição — exigir que ele esteja no ar
      // para aparecer é pedir a contradição.
      anuncios = await graphTudo(`act_${acc}/ads`, 'id,name,campaign_id,effective_status,issues_info', conta.access_token);
    } catch (e) {
      // REGRA 1: pular, NÃO mandar vazio.
      falharam.push({ nome: conta.name, porque: (e && e.message) || String(e) });
      console.log(`  ! ${conta.name}  leitura falhou, PULADA (nada foi fechado): ${(e && e.message) || e}`);
      await dormir(ARGS.pausa);
      continue;
    }

    const linhas = linhasDaConta(conta, campanhas, anuncios);
    totalLinhas += linhas.length;
    const resumo = `${anuncios.length} anúncio(s) lidos · ${linhas.length} problema(s)`;

    if (ARGS.dry) {
      console.log(`  · ${conta.name}  ${resumo}  [não gravado]`);
      for (const l of linhas) console.log(`      ${l.ad_nome || l.ad_id}: ${l.titulo}${l.grave ? ' (impede de rodar)' : ''}`);
    } else {
      try {
        // REGRA 2: vai mesmo vazia — é ela que fecha o que sumiu.
        await registrar(conta.id, linhas);
        gravadas++;
        console.log(`  ✓ ${conta.name}  ${resumo}`);
      } catch (e) {
        falharam.push({ nome: conta.name, porque: (e && e.message) || String(e) });
        console.log(`  ! ${conta.name}  não consegui gravar: ${(e && e.message) || e}`);
      }
    }
    await dormir(ARGS.pausa);
  }

  console.log(`\ncontas gravadas: ${gravadas}/${contas.length} · problemas encontrados: ${totalLinhas}`);
  if (falharam.length) {
    console.log('contas que ficaram de fora desta rodada (a história delas continua como estava):');
    for (const f of falharam) console.log(`  - ${f.nome}: ${f.porque}`);
  }

  // Vermelho só quando NENHUMA conta entrou: aí não foi uma conta com problema,
  // foi o robô que não rodou. Uma conta oscilando não pode pintar de vermelho
  // todo dia até ninguém mais olhar.
  if (!ARGS.dry && contas.length && gravadas === 0) {
    console.error('✗ nenhuma conta foi gravada nesta rodada.');
    process.exit(1);
  }
}

principal().catch((e) => {
  console.error('✗', (e && e.message) || e);
  process.exit(1);
});
