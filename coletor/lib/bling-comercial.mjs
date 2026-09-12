// coletor/lib/bling-comercial.mjs
// Helpers compartilhados do Bling: login (conta de serviço) → bling-proxy →
// coletas (pedidos/produtos/saldo) + classificarItem. Extraído de
// gestor-comercial.mjs para reuso pelo job relatorios-comerciais.mjs.
// Comportamento IDÊNTICO: retry 429/5xx, throttle ~380ms (via _lastBling),
// idsSituacoes[]=9. Sem deps externas — fetch nativo (Node 18+).

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtvdW5xdGRvaW9vb3R4cWVna2lqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkyMDMwMDUsImV4cCI6MjA5NDc3OTAwNX0.MVXa6jngjKXkH3eZ7as_j_k8Eb7lJKcFmO4kCKAnuHM';
const GESTOR_EMAIL = process.env.GESTOR_USER_EMAIL;
const GESTOR_PASS = process.env.GESTOR_USER_PASSWORD;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// A regra de qual dia a venda conta + o leitor das linhas. Ver notas-bling.mjs.
import { ajustarPelaDataDaNota, linhasDaJanela } from './notas-bling.mjs';

// Depósito de cada canal foco (mapeado no Bling):
// ⚠️ ESTA LISTA DEIXOU DE SER A VERDADE em 05/09/2026. Ela ficou só como
// SEMENTE, para o caso de a chamada de depósitos ao Bling falhar — assim o robô
// continua coletando os três de sempre em vez de coletar nada.
//
// A verdade agora é a tabela `bling_depositos`, alimentada pelo próprio Bling
// (ver `blingDepositos`). Depósito novo entra sozinho; ninguém mexe em código.
export const DEP_FOCO = [
  { canal: 'Shopping Tivoli (Santa Bárbara)', deposito_id: '14888726315' },
  { canal: 'Shopping Dom Pedro',              deposito_id: '14888617206' },
  { canal: 'Atacado Nuvem Shop (Estoque Pulmão)', deposito_id: '14888248253' },
];

// OS DEPOSITOS QUE O BLING TEM, com nome. É o que substitui a lista de cima.
// `situacao` do Bling: 1 = ativo. Depósito inativo continua vindo, marcado —
// sumir com ele daqui esconderia estoque parado que ainda existe.
export async function blingDepositos(token) {
  const resp = await blingProxy(token, 'depositos', { pagina: 1, limite: 100 });
  const d = resp.data;
  if (!Array.isArray(d)) return [];
  return d.map((x) => ({
    deposito_id: Number(x.id),
    nome: String(x.descricao || x.nome || '').slice(0, 120) || `Depósito ${x.id}`,
    ativo: Number(x.situacao) === 1,
    padrao: !!x.padrao,
  })).filter((x) => Number.isFinite(x.deposito_id) && x.deposito_id > 0);
}

// ── Conta de serviço: login → access_token ──
export async function loginServico() {
  const r = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: GESTOR_EMAIL, password: GESTOR_PASS }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('login conta de serviço falhou: ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  return j.access_token;
}

// ── Bling via edge function bling-proxy (throttle global + retry 429/5xx) ──
let _lastBling = 0;
export async function blingProxy(token, endpoint, params) {
  for (let attempt = 0; attempt < 7; attempt++) {
    const espera = 450 - (Date.now() - _lastBling);
    if (espera > 0) await sleep(espera);
    _lastBling = Date.now();
    const r = await fetch(SUPABASE_URL + '/functions/v1/bling-proxy', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, params: params || {} }),
    });
    if (r.status === 429) { await sleep(1200 * (attempt + 1)); continue; }
    if (r.status >= 500) { console.log('  bling-proxy ' + endpoint + ' -> ' + r.status + ' (gateway); aguardando…'); await sleep(2000 * (attempt + 1)); continue; }
    if (!r.ok) throw new Error('bling-proxy ' + endpoint + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 200));
    return r.json();
  }
  throw new Error('bling-proxy ' + endpoint + ' -> falhou (429/5xx repetido)');
}

// Lista os pedidos de venda cuja venda CONTA no intervalo.
//
// Não é a mesma coisa que "pedidos feitos no intervalo": a venda conta no dia em
// que a NOTA saiu. A loja emite NFC-e na hora, mas o Atacado emite NF-e no dia
// seguinte — então a venda de sexta caía na quinta. Medido em 11/08/2026 sobre
// 12 meses: 197 dos 325 dias com venda mostravam valor errado.
//
// O AJUSTE MORA AQUI, e não em cada robô, DE PROPÓSITO: três robôs chamam esta
// função (gestor-comercial, relatorios-comerciais e atualizar-cards-comercial).
// Corrigir um a um deixaria o esquecido publicando outro número — e dois lugares
// discordando é pior que um errado, porque ninguém sabe em qual acreditar.
//
// Se não der para ler a data certa, esta função LANÇA (ver linhasDaJanela).
export async function blingPedidos(token, dataInicial, dataFinal) {
  const all = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    let items = [];
    for (let retry = 0; retry < 3; retry++) {
      const resp = await blingProxy(token, 'pedidos/vendas', { dataInicial, dataFinal, 'idsSituacoes[]': 9, pagina, limite: 100 });
      const d = resp.data;
      if (Array.isArray(d) && d.length) { items = d; break; }
      if (retry < 2) await sleep(700);
    }
    if (!items.length) break;
    all.push(...items);
    if (items.length < 100) break;
  }

  // A chave de serviço passa por cima do RLS. Sem ela, a leitura iria pelo JWT
  // da conta de serviço — que hoje enxerga tudo, mas passaria a enxergar nada se
  // um dia alguém ligasse o escopo por equipe nessa conta, e o robô ficaria
  // errado em silêncio. Com a chave, isso não depende de configuração de conta.
  const chave = process.env.SUPABASE_SERVICE_KEY || token;
  const linhas = await linhasDaJanela(SUPABASE_URL, chave, dataInicial, dataFinal);
  return ajustarPelaDataDaNota(all, linhas, dataInicial, dataFinal).pedidos;
}

// Lista o catálogo de produtos (id → nome/código/preço). Bounded por segurança.
export async function blingProdutos(token, maxPaginas = 20) {
  const prod = {};
  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    let resp;
    try { resp = await blingProxy(token, 'produtos', { pagina, limite: 100 }); }
    catch (e) { console.warn('  produtos pág ' + pagina + ' falhou (segue com o que tem):', e.message); break; }
    const d = resp.data;
    if (!Array.isArray(d) || !d.length) break;
    for (const p of d) prod[String(p.id)] = { nome: (p.nome || '').slice(0, 60), codigo: p.codigo || '', preco: Number(p.preco) || 0 };
    if (d.length < 100) break;
  }
  return prod;
}

// Saldo físico por depósito foco, por produto (em lotes de idsProdutos).
// ⚠️ ATE 05/09/2026 ESTA FUNCAO JOGAVA FORA o saldo de todo deposito que nao
// estivesse na lista cravada — e o Bling MANDA TODOS eles na mesma resposta. O
// deposito de uma loja nova chegava aqui e era descartado numa linha, sem erro
// nenhum: a loja simplesmente nao existia na Gestao a Vista ate alguem editar
// codigo. Agora nada e descartado; quem decide o que mostrar e a tela.
export async function blingSaldoFoco(token, prodMap) {
  const ids = Object.keys(prodMap);
  const saldoPorDep = {};            // deposito_id → { produtoId → saldo }
  for (let i = 0; i < ids.length; i += 40) {
    const batch = ids.slice(i, i + 40);
    const params = {};
    batch.forEach((id, k) => { params['idsProdutos[' + k + ']'] = id; });
    let resp;
    try { resp = await blingProxy(token, 'estoques/saldos', params); }
    catch (e) { console.warn('  saldo lote ' + (i / 40 | 0) + ' falhou (segue):', e.message); continue; }
    for (const row of (resp.data || [])) {
      const pid = String(row.produto?.id || '');
      for (const dep of (row.depositos || [])) {
        const did = String(dep.id);
        const saldo = Number(dep.saldoFisico) || 0;
        if (saldo > 0) {
          if (!saldoPorDep[did]) saldoPorDep[did] = {};
          saldoPorDep[did][pid] = saldo;
        }
      }
    }
  }
  return saldoPorDep;
}

// DUAS PERGUNTAS DIFERENTES, E ELAS NÃO TÊM A MESMA RESPOSTA.
//
//   · "que categoria é este produto?"  — VENDAS. Aqui o pega-tudo está CERTO:
//     se o item foi vendido, ele é produto; perder a categoria dele estragaria
//     o relatório. `classificarItem()` responde a esta.
//   · "isto é um produto vendável?"    — ESTOQUE. Aqui o pega-tudo É o defeito.
//     `categoriaDeEstoque()` responde a esta.
//
// Enquanto as duas foram a MESMA função, todo insumo cujo nome não estava nas
// palavras de matéria-prima caía no pega-tudo, virava 'Outros acessórios' e
// aparecia no telão da Gestão à Vista — 213 das 1.386 linhas visíveis em
// 20/08/2026: argola, botão, corrente, couro, camurça, espuma, retalho, bobina,
// caixa, aplicador, fivela injetada, alça. Conferidas uma a uma nos três
// depósitos, nenhuma era produto de venda.
//
// ⚠️ A lista abaixo é escrita à MÃO e vai envelhecer — é da natureza dela. O que
// mudou é para que lado ela erra: no estoque, o que ela não reconhece fica de
// FORA em vez de entrar como produto. Por isso o `reconhecido` existe e por isso
// o robô conta quantos caíram no pega-tudo (ver relatorios-comerciais.mjs): uma
// linha de produto nova que ninguém cadastrou na lista some da tela, e some
// CALADA se ninguém estiver contando.
const CATEGORIA_PEGA_TUDO = 'Outros acessórios';

export function classificarItemDetalhado(nome) {
  const n = (nome || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const reconheci = (categoria) => ({ categoria, reconhecido: true });
  if (!n.trim()) return { categoria: null, reconhecido: true };
  // `insumo` entrou em 20/08: "INSUMOS DE PRODUCAO - BOLSAS" escapava por match
  // POSITIVO em /bolsa|bag/, não pelo pega-tudo. Não há venda com esse nome, então
  // acrescentá-lo não mexe em nada do lado de vendas (medido antes).
  if (/(sacola|tnt|embalagem|caixa|linha|poliamida|poliester|nylon|tinta|materia.?prima|insumo|aviamento|ziper|ziper|tecido|forro|cola|verniz|fivela a granel)/.test(n)) return reconheci(null);
  if (/carteira/.test(n)) return reconheci('Carteira');
  if (/transversal|tiracolo|crossbody/.test(n)) return reconheci('Transversal');
  if (/tote/.test(n)) return reconheci('Tote');
  if (/mochila/.test(n)) return reconheci('Mochila');
  if (/clutch|festa|baguete/.test(n)) return reconheci('Festa/Clutch');
  if (/ombro/.test(n)) return reconheci('Bolsa de ombro');
  if (/(alca de mao|de mao|handbag)/.test(n)) return reconheci('Bolsa de mão');
  if (/(porta.?cartao|porta cartao| cartao)/.test(n)) return reconheci('Porta-cartão');
  if (/(porta.?niquel|niquel|porta.?moeda|moedeir)/.test(n)) return reconheci('Porta-níquel');
  if (/necessaire|nessaire/.test(n)) return reconheci('Necessaire');
  if (/oculos/.test(n)) return reconheci('Óculos');
  if (/cinto/.test(n)) return reconheci('Cinto');
  if (/chaveiro/.test(n)) return reconheci('Chaveiro');
  if (/mala/.test(n)) return reconheci('Mala/Viagem');
  if (/bolsa|bag/.test(n)) return reconheci('Bolsa (outros)');
  return { categoria: CATEGORIA_PEGA_TUDO, reconhecido: false };
}

// VENDAS — comportamento inalterado, inclusive o pega-tudo.
export function classificarItem(nome) {
  return classificarItemDetalhado(nome).categoria;
}

// ESTOQUE — só entra o que foi reconhecido como produto. O que a lista não
// conhece fica de fora, e a seção de estoque da Gestão à Vista continua com a
// regra de sempre: categoria vazia não aparece.
export function categoriaDeEstoque(nome) {
  const d = classificarItemDetalhado(nome);
  return d.reconhecido ? d.categoria : null;
}

