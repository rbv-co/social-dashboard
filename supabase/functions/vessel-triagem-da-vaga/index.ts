// supabase/functions/vessel-triagem-da-vaga/index.ts
//
// A TRIAGEM DA VAGA DO TIVOLI, A CADA MINUTO (pedido do dono em 25/09/2026:
// "robô de minuto em minuto sempre").
//
// Leva as candidaturas da página `vesselbrasil.com.br/vaga-tivoli`
// (`vessel_candidaturas`) para `04. Vessel Brasil / 10. RH-DP /
// Triagem Tivoli Vendedora.xlsx`, e os currículos anexados para a pasta
// "Triagem Tivoli - Currículos", ao lado.
//
// ⚠️ A RODADA COMUM É UMA CONSULTA SÓ. Ela pergunta ao banco se há candidata
// que ainda não foi para a planilha (`na_planilha_em` vazio). Sem nenhuma, para
// ali: não abre o Zoho, não baixa nem sobe nada. Dois motivos: 1.440 rodadas
// por dia batendo no Zoho gastariam cota à toa; e subir o arquivo sem motivo,
// com o RH editando no Zoho naquele minuto, é o jeito mais fácil de brigar com
// a edição dele.
//
// ⚠️ ACRESCENTA, NÃO REESCREVE. O que o RH mexeu fica — a regra, com teste,
// mora em `_shared/abas-da-triagem.js`.
//
// `{"forcar": true}` no corpo faz a rodada inteira mesmo sem candidata nova —
// serve para criar a planilha vazia na primeira vez.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { montarXlsx, bytesIguais } from '../_shared/planilha-xlsx.js';
import { abasDoXlsx } from '../_shared/ler-xlsx.mjs';
import { montarAbasDaTriagem, nomeDoCurriculo, VAGA, PASTA_DOS_CURRICULOS }
  from '../_shared/abas-da-triagem.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WD = 'https://www.zohoapis.com/workdrive/api/v1';

// Caminho por NOME, nunca por id: pasta recriada no Zoho muda de id.
const RAIZ = 'wbp6sefe483fe7da14c6ebe53225105f1f389'; // espaço "01. RBV and Company"
const CAMINHO = ['04. Vessel Brasil', '10. RH-DP'];
const ARQUIVO = 'Triagem Tivoli Vendedora.xlsx';
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const CAMPOS = 'id,criado_em,nome,whatsapp,cidade,experiencia,fim_de_semana,curriculo,origem,na_planilha_em';

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

// ── Zoho (o mesmo desenho da `vessel-espelhar-lista`) ───────────────────────
async function tokenZoho(c: any): Promise<string> {
  let dc = String(c.data_center || '.com');
  if (!dc.startsWith('.')) dc = '.' + dc;
  const r = await fetch(`https://accounts.zoho${dc}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: c.client_id,
      client_secret: c.client_secret, refresh_token: c.refresh_token }),
  });
  const j = await r.json().catch(() => null);
  if (!j?.access_token) throw new Error('Não consegui entrar no Zoho. Abra Acessos → Zoho e clique em conectar.');
  return j.access_token as string;
}

async function filhosDe(t: string, paiId: string): Promise<any[]> {
  const todos: any[] = [];
  for (let pagina = 0; pagina < 10; pagina++) {
    const r = await fetch(`${WD}/files/${encodeURIComponent(paiId)}/files`
      + `?page%5Blimit%5D=100&page%5Boffset%5D=${pagina * 100}`,
      { headers: { Authorization: `Zoho-oauthtoken ${t}`, Accept: 'application/vnd.api+json' } });
    // Falha de leitura NÃO autoriza criar às cegas: criaria pasta repetida.
    if (!r.ok) throw new Error(`Não consegui ler uma pasta do Zoho (código ${r.status}).`);
    const lote = (await r.json().catch(() => null))?.data ?? [];
    todos.push(...lote);
    if (lote.length < 100) break;
  }
  return todos;
}

const ehPasta = (f: any) => {
  const a = f?.attributes ?? {};
  return a.is_folder === true || a.type === 'folder' || a.resource_type === 'folder';
};
const nomeDe = (f: any) => String(f?.attributes?.name ?? '').trim();

async function pasta(t: string, paiId: string, nome: string, podeCriar: boolean): Promise<string> {
  const achada = (await filhosDe(t, paiId)).find((f) => ehPasta(f) && nomeDe(f) === nome);
  if (achada) return String(achada.id);
  // Só a pasta dos currículos pode nascer aqui. As de cima são do dono: criar
  // uma delas por engano esconderia um erro de caminho.
  if (!podeCriar) throw new Error(`Não achei a pasta "${nome}" no Zoho — renomearam ou moveram?`);
  const r = await fetch(`${WD}/files`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${t}`, Accept: 'application/vnd.api+json',
               'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { attributes: { name: nome, parent_id: paiId }, type: 'files' } }),
  });
  const corpo = await r.json().catch(() => null);
  const nova = Array.isArray(corpo?.data) ? corpo.data[0] : corpo?.data;
  if (!r.ok || !nova?.id) throw new Error(`Não consegui criar a pasta "${nome}" no Zoho (código ${r.status}).`);
  return String(nova.id);
}

async function baixar(t: string, pastaId: string, nome: string): Promise<Uint8Array | null> {
  const achado = (await filhosDe(t, pastaId)).find((f) => !ehPasta(f) && nomeDe(f) === nome);
  if (!achado) return null;
  const r = await fetch(`${WD}/download/${encodeURIComponent(achado.id)}`,
    { headers: { Authorization: `Zoho-oauthtoken ${t}` } });
  // ⚠️ Arquivo que existe e não baixa NÃO é "arquivo novo": seguir como se não
  // existisse reescreveria a planilha do RH do zero.
  if (!r.ok) throw new Error(`O Zoho não deixou baixar "${nome}" (código ${r.status}); não mexi em nada.`);
  return new Uint8Array(await r.arrayBuffer());
}

async function subir(t: string, pastaId: string, nome: string, bytes: Uint8Array, tipo: string) {
  const fd = new FormData();
  fd.append('content', new Blob([bytes], { type: tipo }), nome);
  // `override-name-exist=true`: com `false` o Zoho cria cópia com data no nome.
  const r = await fetch(`${WD}/upload?filename=${encodeURIComponent(nome)}`
    + `&parent_id=${encodeURIComponent(pastaId)}&override-name-exist=true`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${t}`, Accept: 'application/vnd.api+json' },
    body: fd,
  });
  if (!r.ok) throw new Error(`O Zoho recusou "${nome}" (código ${r.status}).`);
}

// ── a rodada ────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  const negado = await exigirSegredoDeCron(req, 'vessel-triagem-da-vaga');
  if (negado) return negado;
  const forcar = Boolean((await req.json().catch(() => ({})))?.forcar);
  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  try {
    // A pergunta de toda rodada: tem alguém esperando para entrar?
    const { count, error: e1 } = await sb.from('vessel_candidaturas')
      .select('id', { count: 'exact', head: true })
      .eq('vaga', VAGA).eq('teste', false).is('na_planilha_em', null);
    if (e1) throw new Error(e1.message);
    if (!count && !forcar) return json({ ok: true, novas: 0 });

    // ⚠️ LEITURA QUE FALHA PARA A RODADA. Com lista vazia por erro, a planilha
    // subiria sem ninguém novo — e a candidata ficaria marcada como entregue.
    const { data: candidaturas, error: e2 } = await sb.from('vessel_candidaturas')
      .select(CAMPOS).eq('vaga', VAGA).eq('teste', false)
      .order('criado_em', { ascending: false }).limit(5000);
    if (e2) throw new Error(e2.message);

    const { data: conexao } = await sb.from('acessos_conexoes')
      .select('client_id, client_secret, refresh_token, data_center')
      .eq('provedor', 'zoho').maybeSingle();
    if (!conexao?.refresh_token) throw new Error('A central não está conectada ao Zoho (Acessos → Zoho).');
    const tz = await tokenZoho(conexao);

    let rh = RAIZ;
    for (const nome of CAMINHO) rh = await pasta(tz, rh, nome, false);

    // Os currículos das que ainda não foram entregues, e só os que faltam lá.
    const pendentes = (candidaturas ?? []).filter((c: any) => !c.na_planilha_em && c.curriculo);
    let levados = 0;
    if (pendentes.length) {
      const pastaCv = await pasta(tz, rh, PASTA_DOS_CURRICULOS, true);
      const jaLa = new Set((await filhosDe(tz, pastaCv)).map(nomeDe));
      for (const c of pendentes) {
        const nome = nomeDoCurriculo(c);
        if (jaLa.has(nome)) continue;
        const { data: arq, error } = await sb.storage.from('vessel-curriculos').download(c.curriculo);
        // ⚠️ Um currículo que não baixa não segura a candidata fora da planilha:
        // ela entra, e o RH pede o currículo pelo WhatsApp.
        if (error || !arq) { console.warn(`currículo de ${c.id} não baixou: ${error?.message}`); continue; }
        await subir(tz, pastaCv, nome, new Uint8Array(await arq.arrayBuffer()),
          arq.type || 'application/octet-stream');
        levados++;
      }
    }

    const laDentro = await baixar(tz, rh, ARQUIVO);
    // Sem aba "Candidatos" ou sem a coluna do ID, isto LANÇA e nada sobe.
    const { abas, entregues, novas } = montarAbasDaTriagem(candidaturas, laDentro ? abasDoXlsx(laDentro) : null);
    const bytes = await montarXlsx(abas);
    const subiu = !bytesIguais(laDentro, bytes) && (novas > 0 || !laDentro);
    if (subiu) await subir(tz, rh, ARQUIVO, bytes, TIPO_XLSX);

    // Só DEPOIS de subir. Marcar antes, e o envio falhar, faria a candidata
    // parecer "apagada pelo RH" — e ela nunca entraria.
    const marcar = entregues.filter((id: string) =>
      !(candidaturas ?? []).find((c: any) => String(c.id) === id)?.na_planilha_em);
    if (marcar.length) {
      const { error } = await sb.from('vessel_candidaturas')
        .update({ na_planilha_em: new Date().toISOString() }).in('id', marcar);
      if (error) throw new Error(`subi a planilha mas não marquei as entregues: ${error.message}`);
    }
    const resumo = { ok: true, novas, curriculos: levados, subiu, marcadas: marcar.length };
    console.log(JSON.stringify(resumo));
    return json(resumo);
  } catch (e) {
    console.error('vessel-triagem-da-vaga:', (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});
