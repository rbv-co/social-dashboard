// supabase/functions/vessel-log-de-carocos/index.ts
//
// O LOG DOS CAROÇOS NO ANGU, ao vivo.
//
// Roda as 15 conferências do que PARECE errado no sistema e mantém a planilha
// "Log de caroços.xlsx" no Zoho, em
// 04. Vessel Brasil / 17. Marketing / Acompanhamento.
//
// Pedido do dono: "um log de possíveis erros, o que PARECE ser erro, caroço no
// angu" (21/09/2026) e, no dia seguinte, "pode ser ao vivo tá".
//
// ⚠️ ELE NÃO CONSERTA NADA, e é de propósito. Um robô que arruma sozinho o que
// "parece" errado vai um dia apagar dado bom — venda duplicada pode ser duas
// bolsas iguais no mesmo dia. Ele aponta e diz o que fazer; quem decide é gente.
//
// ONDE MORA CADA COISA, e o motivo da divisão:
//   • as CONSULTAS → `public.vessel_carocos()`, no banco. A edge é Deno e não
//     abre conexão de Postgres para rodar SQL solta; ela chama função.
//   • os TEXTOS e a montagem das abas → `_shared/carocos-no-angu.js`, que roda
//     em node e por isso tem teste de verdade.
//   • o arquivo → o gerador de xlsx da casa, o mesmo das outras planilhas.
//
// ⚠️ UMA CONFERÊNCIA QUE FALTA NÃO DERRUBA A RODADA. Se a função do banco não
// devolver alguma chave (migration nova pela metade, por exemplo), aquela aba
// sai vazia e o Resumo diz "0" — em vez de o dono ficar sem log nenhum e sem
// saber por quê.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { CONFERENCIAS, montarAbasDoLog } from '../_shared/carocos-no-angu.js';
import { montarXlsx, bytesIguais } from '../_shared/planilha-xlsx.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const WD = 'https://www.zohoapis.com/workdrive/api/v1';

const RAIZ = 'wbp6sefe483fe7da14c6ebe53225105f1f389'; // espaço "01. RBV and Company"
// ⚠️ FORA da "Base de clientes", por pedido do dono: aquela é a base que ele lê
// todo dia; esta pasta é a que ele abre quando desconfia de alguma coisa.
const CAMINHO = ['04. Vessel Brasil', '17. Marketing', 'Acompanhamento'];
const ARQUIVO = 'Log de caroços.xlsx';
const TIPO_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

// ── Zoho ────────────────────────────────────────────────────────────────────
async function tokenZoho(conexao: any): Promise<string> {
  let dc = String(conexao.data_center || '.com');
  if (!dc.startsWith('.')) dc = '.' + dc;
  const r = await fetch(`https://accounts.zoho${dc}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: conexao.client_id,
      client_secret: conexao.client_secret,
      refresh_token: conexao.refresh_token,
    }),
  });
  const j = await r.json().catch(() => null);
  if (!j?.access_token) {
    throw new Error('Não consegui entrar no Zoho para atualizar o log. Abra Acessos → Zoho '
      + 'e clique em conectar; a próxima rodada tenta de novo sozinha.');
  }
  return j.access_token as string;
}

async function wdGet(t: string, caminho: string) {
  const r = await fetch(WD + caminho, {
    headers: { Authorization: `Zoho-oauthtoken ${t}`, Accept: 'application/vnd.api+json' },
  });
  const txt = await r.text();
  try { return { ok: r.ok, status: r.status, corpo: JSON.parse(txt) }; }
  catch { return { ok: r.ok, status: r.status, corpo: null }; }
}

async function acharPasta(t: string, paiId: string, nome: string, podeCriar: boolean): Promise<string> {
  for (let pagina = 0; pagina < 5; pagina++) {
    const r = await wdGet(t, `/files/${encodeURIComponent(paiId)}/files`
      + `?page%5Blimit%5D=100&page%5Boffset%5D=${pagina * 100}`);
    // Falha de leitura NÃO autoriza criar às cegas: criaria pasta repetida.
    if (!r.ok) {
      throw new Error(`Não consegui ler a pasta do Zoho (código ${r.status}) para achar "${nome}". `
        + 'Costuma ser instabilidade do Zoho — a próxima rodada tenta de novo.');
    }
    const filhas: any[] = Array.isArray(r.corpo?.data) ? r.corpo.data : [];
    for (const f of filhas) {
      const a = f?.attributes ?? {};
      const ehPasta = a.is_folder === true || a.type === 'folder' || a.resource_type === 'folder';
      if (ehPasta && String(a.name ?? '').trim() === nome) return String(f.id ?? a.resource_id);
    }
    if (filhas.length < 100) break;
  }
  if (!podeCriar) {
    throw new Error(`Não achei a pasta "${nome}" no Zoho. Ela faz parte do caminho `
      + `${CAMINHO.join(' / ')} e não deve ser renomeada nem movida.`);
  }
  const r = await fetch(`${WD}/files`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${t}`, Accept: 'application/vnd.api+json',
               'Content-Type': 'application/json' },
    body: JSON.stringify({ data: { attributes: { name: nome, parent_id: paiId }, type: 'files' } }),
  });
  const corpo = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`Não consegui criar a pasta "${nome}" no Zoho (código ${r.status}).`);
  const nova = Array.isArray(corpo?.data) ? corpo.data[0] : corpo?.data;
  const id = nova?.id ?? nova?.attributes?.resource_id;
  if (!id) throw new Error(`O Zoho criou "${nome}" mas não disse o identificador dela.`);
  return String(id);
}

/** ⚠️ BYTES, e não texto: um .xlsx é um zip, e `.text()` o estraga calado. */
async function baixar(t: string, pastaId: string): Promise<Uint8Array | null> {
  const lista = await wdGet(t, `/files/${encodeURIComponent(pastaId)}/files?page%5Blimit%5D=100`);
  const achado = (lista.corpo?.data ?? []).find((f: any) =>
    String(f?.attributes?.name ?? '').trim() === ARQUIVO);
  if (!achado) return null;
  const r = await fetch(`${WD}/download/${encodeURIComponent(achado.id)}`, {
    headers: { Authorization: `Zoho-oauthtoken ${t}` } });
  return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
}

async function subir(t: string, pastaId: string, bytes: Uint8Array): Promise<void> {
  const fd = new FormData();
  fd.append('content', new Blob([bytes], { type: TIPO_XLSX }), ARQUIVO);
  const r = await fetch(`${WD}/upload?filename=${encodeURIComponent(ARQUIVO)}`
    + `&parent_id=${encodeURIComponent(pastaId)}&override-name-exist=true`, {
    method: 'POST',
    headers: { Authorization: `Zoho-oauthtoken ${t}`, Accept: 'application/vnd.api+json' },
    body: fd,
  });
  if (!r.ok) throw new Error(`O Zoho recusou o log (código ${r.status}).`);
}

// ── a rodada ────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  const portao = await exigirSegredoDeCron(req, 'vessel-log-de-carocos');
  if (portao) return portao;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const resultado: Record<string, unknown> = {};

  try {
    const { data, error } = await sb.rpc('vessel_carocos');
    if (error) throw new Error(`as conferências não rodaram: ${error.message}`);

    const achados: Record<string, any[]> = {};
    const faltando: string[] = [];
    for (const c of CONFERENCIAS) {
      const linhas = (data as any)?.[c.chave];
      if (!Array.isArray(linhas)) { faltando.push(c.chave); achados[c.chave] = []; continue; }
      achados[c.chave] = linhas;
    }
    if (faltando.length) resultado.sem_conferencia = faltando;

    // ⚠️ SÓ O DIA, NUNCA A HORA, no cabeçalho do Resumo. Um relógio dentro da
    // planilha muda os bytes a cada rodada, e o robô passaria a regravar o
    // arquivo TODA VEZ — de 10 em 10 minutos, para sempre. Com o dia, o arquivo
    // só sobe quando um caroço aparece ou some, que é o que interessa.
    const dia = new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    }).format(new Date());

    const abas = montarAbasDoLog(achados, dia);
    const bytes = await montarXlsx(abas);

    const total = Object.values(achados).reduce((t, l) => t + l.length, 0);
    resultado.carocos = total;
    resultado.por_conferencia = Object.fromEntries(
      CONFERENCIAS.filter((c) => achados[c.chave].length > 0)
        .map((c) => [c.titulo, achados[c.chave].length]));

    const { data: conexao } = await sb
      .from('acessos_conexoes')
      .select('client_id, client_secret, refresh_token, data_center')
      .eq('provedor', 'zoho').maybeSingle();
    if (!conexao?.refresh_token) throw new Error('A central não está conectada ao Zoho.');
    const tz = await tokenZoho(conexao);

    let pasta = RAIZ;
    for (let i = 0; i < CAMINHO.length; i++) {
      // Só a última pasta do caminho pode ser criada: as de cima são do dono.
      pasta = await acharPasta(tz, pasta, CAMINHO[i], i === CAMINHO.length - 1);
    }

    const deHoje = await baixar(tz, pasta);
    if (bytesIguais(deHoje, bytes)) {
      resultado.planilha = `em dia (${total} caroço(s))`;
    } else {
      await subir(tz, pasta, bytes);
      resultado.planilha = `regravada, ${(bytes.length / 1024).toFixed(1)} KB (${total} caroço(s))`;
    }
  } catch (e) {
    resultado.planilha = `falhou: ${e instanceof Error ? e.message : String(e)}`;
  }

  // ⚠️ O VIGIA VÊ ESTE ROBÔ (`robos_esperados`), e ele julga pelo código HTTP.
  // Aqui a rodada faz UMA coisa só, então devolver erro quando ela falha é
  // honesto — diferente do espelho, que faz duas e não pode derrubar uma por
  // causa da outra.
  const falhou = String(resultado.planilha ?? '').startsWith('falhou');
  return json(resultado, falhou ? 500 : 200);
});
