// custo-openai — devolve o GASTO REAL da conta OpenAI (Costs API), pro painel
// Claude Status mostrar o número verdadeiro das tarefas que criam imagem.
//
// Por que existe: a Fábrica gera criativo com gpt-image-2, que é API PAGA da
// OpenAI, e até 18/08/2026 a tela afirmava que isso custava R$ 0. O custo por
// execução continua desconhecido (ninguém precificou o motor), mas o TOTAL
// cobrado é conhecido — é o que esta função traz.
//
// Segurança: igual à custo-anthropic. verify_jwt=true + checagem de ADMIN (dado
// de faturamento é só pra admin), e a chave (sk-admin) vive na tabela
// segredos_de_cron, lida aqui pelo service role. O front nunca a vê.
//
// ⚠️ A PEGADINHA QUE MUDA O VALOR EM 100×: na Anthropic o `amount` vem em
// CENTAVOS de dólar; na OpenAI, `amount.value` vem em DÓLARES. Medido ao vivo em
// 18/08/2026: 60 dias somam US$ 98,71 — bate com a medição feita pela chave do
// dono. Não copie a divisão por 100 da outra função.
//
// O que a OpenAI dá de melhor que a Anthropic: custo REAL por chave de API
// (group_by=api_key_id). Lá o "quem gastou" é rateado por uso; aqui é a conta de
// verdade. Por isso este retorno usa `usd`, e não `usdEstimado`.
//
// ── 19/08/2026: PRAZO PRÓPRIO, SEGUNDA CHANCE E O MOTIVO REGISTRADO ─────────
// Bronca do dono: "sempre que abro a ferramenta demora para carregar os dados
// da OpenAI e fica dizendo que teve erro." Medido nas 24h do registro da
// Supabase: das 26 chamadas de verdade (o resto são preflights de CORS), **3
// devolveram 500 — 11,5%**. As boas levaram 2,1s em média.
//
// E não dava para saber POR QUÊ: quando o `catch` lá embaixo devolvia 500, o
// motivo ia só para a resposta HTTP, que ninguém lê. No registro sobrava um
// "500" pelado. Por isso a primeira coisa que entra aqui não é conserto, é
// TESTEMUNHA: todo tropeço agora vai para o log da função, com o status e a
// tentativa. O próximo episódio não vai ser mistério.
//
// O conserto é o mesmo do bling-proxy (B20, 18/08): esta função chamava a
// OpenAI **sem prazo e sem tentar de novo**, então um 429 em rajada — que é o
// suspeito número um, já que os 500 vinham em PAR, das duas janelas que a tela
// pedia ao mesmo tempo — derrubava a resposta inteira. A política mora em
// `_shared/tentar-de-novo.js` e é a mesma, só que dizendo "OpenAI".
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { decidirRepeticao, fraseDeDesistencia } from '../_shared/tentar-de-novo.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CAMBIO = 5.5; // US$ -> R$ (mesmo valor da custo-anthropic e dos logs dos robôs)
const API = 'https://api.openai.com/v1/organization';

// Prazo de UMA chamada à OpenAI. As chamadas que dão certo somam 2,1s para a
// função INTEIRA (que faz de 5 a 10 idas à OpenAI), então 8s é folga larga para
// uma só. Serve para não ficar pendurado até a plataforma matar em ~30s e
// devolver NADA — e "nada" na tela vira "não sei o que aconteceu".
const PRAZO_MS = 8000;
// Quanto a função aceita gastar repetindo, no total. Abaixo do teto da
// plataforma de propósito: melhor devolver o erro aos 20s, com frase de gente,
// do que ser morto aos 30s sem devolver coisa alguma.
const ORCAMENTO_MS = 20000;

/** Uma ida à OpenAI, com prazo próprio e até 3 tentativas.
 *
 * Devolve a resposta OK. Se desistir, levanta erro com frase de gente — e, em
 * qualquer tropeço, ESCREVE no log: sem isso, um 500 no painel da Supabase não
 * diz se foi limite de taxa, queda ou chave vencida. */
async function chamarOpenAI(url: string | URL, chave: string, rotulo: string): Promise<Response> {
  const comecou = Date.now();
  let tentativa = 0;
  for (;;) {
    tentativa++;
    let status: number | null = null;
    let estourouOPrazo = false;
    let retryAfterSegundos: number | null = null;
    try {
      const corte = AbortSignal.timeout(PRAZO_MS);
      const r = await fetch(url, { headers: { Authorization: `Bearer ${chave}` }, signal: corte });
      if (r.ok) {
        if (tentativa > 1) console.log(`[custo-openai] ${rotulo}: deu certo na tentativa ${tentativa}`);
        return r;
      }
      status = r.status;
      const ra = Number(r.headers.get('retry-after'));
      if (Number.isFinite(ra) && ra > 0) retryAfterSegundos = ra;
      // O corpo do erro é a única pista de qual limite a OpenAI aplicou.
      const txt = (await r.text()).slice(0, 200);
      console.error(`[custo-openai] ${rotulo}: tentativa ${tentativa} devolveu ${status} — ${txt}`);
    } catch (e) {
      // prazo estourado ou rede caída: os dois entram como "falha dela"
      estourouOPrazo = true;
      console.error(`[custo-openai] ${rotulo}: tentativa ${tentativa} não completou — ${e instanceof Error ? e.message : String(e)}`);
    }

    const d = decidirRepeticao({
      tentativa,
      status,
      estourouOPrazo,
      msDecorridos: Date.now() - comecou,
      retryAfterSegundos,
      fornecedor: 'OpenAI',
      prazoPorTentativaMs: PRAZO_MS,
      orcamentoMs: ORCAMENTO_MS,
    });
    if (!d.repetir) {
      const frase = fraseDeDesistencia(d.motivo, tentativa, 'OpenAI');
      console.error(`[custo-openai] ${rotulo}: desisti — ${d.motivo} (${tentativa}x)`);
      throw new Error(frase);
    }
    console.log(`[custo-openai] ${rotulo}: tentativa ${tentativa} falhou (${d.motivo}); repito em ${d.esperarMs}ms`);
    await new Promise((ok) => setTimeout(ok, d.esperarMs));
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

// Lê a chave admin do segredo (service role). Fail-closed.
async function lerChaveAdmin(sb: ReturnType<typeof createClient>): Promise<string> {
  const { data, error } = await sb.from('segredos_de_cron').select('segredo').eq('nome', 'openai_admin_key').single();
  if (error || !data?.segredo) throw new Error('chave_admin_nao_configurada');
  return String(data.segredo);
}

// Uma varredura da Costs API cobrindo [inicio, fim) em baldes de 1 dia.
// `limit` tem teto de 180 baldes; ainda assim paginamos com next_page, porque
// truncar em silêncio é exatamente o defeito que este painel existe para evitar.
async function varrer(chave: string, inicio: number, fim: number, agrupar?: string) {
  const baldes: Array<{ data: string; results: any[] }> = [];
  let page: string | null = null;
  let guarda = 0; // trava anti-loop
  do {
    const url = new URL(`${API}/costs`);
    url.searchParams.set('start_time', String(inicio));
    url.searchParams.set('end_time', String(fim));
    url.searchParams.set('bucket_width', '1d');
    url.searchParams.set('limit', '180');
    if (agrupar) url.searchParams.append('group_by[]', agrupar);
    if (page) url.searchParams.set('page', page);
    const r = await chamarOpenAI(url, chave, agrupar ? `custos/${agrupar}` : 'custos/total');
    const j = await r.json();
    for (const b of (j.data ?? [])) {
      baldes.push({ data: String(b.start_time_iso ?? '').slice(0, 10) || isoDoUnix(b.start_time), results: b.results ?? [] });
    }
    page = j.has_more ? j.next_page : null;
  } while (page && ++guarda < 50);
  return baldes;
}

const isoDoUnix = (s: unknown) => (s == null ? '' : new Date(Number(s) * 1000).toISOString().slice(0, 10));
// DÓLARES, não centavos. Ver o aviso no topo.
const valor = (x: any) => Number(x?.amount?.value ?? 0);

// Nome de cada chave de API (key_… → "FabricadeAnuncios"). Sem isso o painel
// mostraria um identificador que não diz nada a quem lê.
//
// Isto era uma FILA: pedia a lista de projetos e, para cada um, esperava as
// chaves antes de pedir as do próximo. Com 5 projetos são 6 idas à OpenAI uma
// atrás da outra — e é a parte mais lenta da função, para um dado que só serve
// de enfeite (trocar `key_abc123` por "FabricadeAnuncios"). Agora os projetos
// são perguntados de uma vez só.
async function nomesDasChaves(chave: string): Promise<Record<string, string>> {
  const nomes: Record<string, string> = {};
  try {
    const rp = await chamarOpenAI(`${API}/projects?limit=50`, chave, 'projetos');
    const jp = await rp.json();
    const projetos = (jp.data ?? []).filter((p: any) => p?.id);
    const listas = await Promise.all(projetos.map(async (p: any) => {
      try {
        const rk = await chamarOpenAI(`${API}/projects/${p.id}/api_keys?limit=100`, chave, `chaves/${p.id}`);
        return (await rk.json()).data ?? [];
      } catch {
        // um projeto sem resposta não pode derrubar o nome dos outros
        return [];
      }
    }));
    for (const lista of listas) for (const k of lista) if (k?.id) nomes[k.id] = k.name || k.id;
  } catch { /* segue sem nome: o id ainda identifica */ }
  return nomes;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    // 1) quem chama? (auth.getUser só resolve com JWT de usuário; anon key não resolve)
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'nao_autenticado' }, 401);

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    // 2) só ADMIN vê faturamento
    const { data: prof } = await sb.from('profiles').select('role').eq('id', user.id).single();
    if (!prof || prof.role !== 'admin') return json({ error: 'sem_permissao' }, 403);

    // 3) janela: mesma régua da custo-anthropic — padrão 30 dias, teto 90, e o
    // fim é meia-noite UTC de amanhã, para o dia de hoje entrar inteiro.
    let diasRaw = new URL(req.url).searchParams.get('dias');
    if (!diasRaw) {
      try { const body = await req.json(); if (body && body.dias != null) diasRaw = String(body.dias); } catch { /* sem corpo */ }
    }
    const dias = Math.min(90, Math.max(1, Number(diasRaw || '30')));
    const agora = new Date();
    const fim = Math.floor(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate() + 1) / 1000);
    const inicio = fim - dias * 86400;

    const chave = await lerChaveAdmin(sb);

    // Os dois detalhamentos são acessórios: se falharem, viram lista vazia e a
    // tela diz "indisponível" — nunca inventam número, e não derrubam o total.
    const detalhe = async (agrupar: string, campo: string) => {
      try {
        const bs = await varrer(chave, inicio, fim, agrupar);
        const acc: Record<string, number> = {};
        for (const b of bs) for (const x of b.results) {
          const k = String(x?.[campo] ?? '(sem nome)');
          acc[k] = (acc[k] ?? 0) + valor(x);
        }
        return acc;
      } catch { return {}; }
    };

    // As quatro perguntas vão JUNTAS. Antes o total era uma etapa a mais na
    // fila: ele ia sozinho, e só depois começavam as outras três — tempo de
    // espera empilhado à toa, já que uma não depende da outra.
    //
    // O total continua sendo o único obrigatório, e continua derrubando a
    // resposta se falhar: `Promise.all` rejeita quando ele rejeita, e os
    // detalhamentos, que engolem o próprio erro, nunca chegam a rejeitar.
    // Preferir "sem resposta" a "R$ 0" é a regra que esta tela inteira existe
    // para cumprir.
    const [baldes, catAcc, chaveAcc, nomes] = await Promise.all([
      varrer(chave, inicio, fim),
      detalhe('line_item', 'line_item'),
      detalhe('api_key_id', 'api_key_id'),
      nomesDasChaves(chave),
    ]);
    const porDia = baldes.map((b) => ({ data: b.data, usd: b.results.reduce((s: number, x: any) => s + valor(x), 0) }));
    const totalUsd = porDia.reduce((s, d) => s + d.usd, 0);

    const porCategoria = Object.entries(catAcc)
      .map(([item, usd]) => ({ item, usd: Number(usd.toFixed(6)) }))
      .filter((c) => c.usd > 0)
      .sort((a, b) => b.usd - a.usd);

    const porChave = Object.entries(chaveAcc)
      .map(([id, usd]) => ({ nome: nomes[id] || id, usd: Number(usd.toFixed(6)) }))
      .filter((c) => c.usd > 0)
      .sort((a, b) => b.usd - a.usd);

    return json({
      desde: isoDoUnix(inicio),
      ate: isoDoUnix(fim),
      cambio: CAMBIO,
      totalUsd: Number(totalUsd.toFixed(4)),
      totalBrl: Number((totalUsd * CAMBIO).toFixed(2)),
      dias: porDia,
      porCategoria, // [{item, usd}] — real, por modelo e tipo de token
      porChave,     // [{nome, usd}] — REAL por chave (não é rateio, ao contrário da Anthropic)
    });
  } catch (e) {
    // O 500 tem de deixar rastro: era exatamente por não deixar que ninguém
    // sabia se os 3 de 24h eram limite de taxa, queda ou chave vencida.
    const detalhe = e instanceof Error ? e.message : String(e);
    console.error(`[custo-openai] devolvendo 500 — ${detalhe}`);
    return json({ error: 'falha', detalhe }, 500);
  }
});
