// supabase/functions/vessel-baixar-cartao/index.ts
//
// ENTREGA AO NAVEGADOR O ARQUIVO REAL DE UM CARTÃO EAN que o robô já deixou no Zoho (o PNG/PDF a 600 dpi que foi
// para a gráfica) — frente ou verso. É o botão "Baixar" do modal da aba Cartões EAN (Autenticidade).
//
// ⚠️ POR QUE EDGE: o navegador não pode falar com o Zoho (o `client_secret` e o token moram no servidor). Por que
// uma edge NOVA e não uma ação do `acessos-proxy`: aquele só aceita admin/"acessos", e este botão é da Autenticidade;
// e o `acessos-proxy` é um arquivo compartilhado, onde "quem publica por último vence" (ver CLAUDE.md).
//
// ⚠️ NÃO GERA CARTÃO E NÃO INVENTA ARQUIVO. Só entrega peça com `cartao_gerado_em` preenchido, e só o arquivo que está
// de fato na pasta do dia. Se o banco diz "gerado" e o Zoho não tem, a resposta diz isso (404 arquivo_nao_achado).
//
// ⚠️ QUEM PODE: `is_vessel_admin()` — a MESMA regra de `vessel_pedir_cartoes` (chave "autenticidade" ou superadmin),
// perguntada ao banco COM o token de quem chamou. O pedido nunca escolhe o caminho: face e formato vêm de uma lista
// fechada e o nome do arquivo é montado aqui (ver `_shared/cartao-no-zoho.js`), então `../` não chega ao Zoho.
//
// Onde o robô guarda: Fotos por SKU (coletor)/Vessel Brasil/Cartões com EAN/<AAAA-MM-DD>/<SKU - Nome>/<arquivo>.
// Se a peça foi refeita em outro dia, vale o dia mais NOVO que tiver o arquivo.
//
// Publicar com o `verify_jwt` LIGADO (é chamada por gente logada, não por cron).
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { corsDoPedido } from '../_shared/enderecos-do-app.js';
import {
  nomeDoArquivo, diasEmOrdem, pastaDoSku, ehPastaDosCartoes, diaDaPasta, diasComDicaPrimeiro,
} from '../_shared/cartao-no-zoho.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
// "Fotos por SKU (coletor)", a mesma raiz que o robô usa (coletor/robo-de-cartoes.mjs).
const RAIZ_FOTOS = Deno.env.get('ZOHO_PASTA_FOTOS') || '6kuqn469a1e0841ee49e0bd0d18cab60c9cd5';

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } });

type Conexao = { client_id: string; client_secret: string; refresh_token: string; data_center: string | null };
type Item = { id: string; name: string; folder: boolean };

const sufixo = (dc: string | null) => {
  const d = String(dc || '.com');
  return d.startsWith('.') ? d : '.' + d;
};

// ── O token do Zoho ─────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ O refresh_token do Zoho NÃO rotaciona (o do Bling sim): não regravar. O access token fica na memória desta instância
// por 50 min — o Zoho limita quantos tokens novos se pedem por janela, e cada clique em "Baixar" pedindo um novo estouraria
// isso. ponytail: cache por instância; se o limite incomodar, guardar o token no banco.
let cacheToken: { t: string; ate: number } | null = null;

async function tokenDoZoho(c: Conexao): Promise<string> {
  if (cacheToken && Date.now() < cacheToken.ate) return cacheToken.t;
  const r = await fetch(`https://accounts.zoho${sufixo(c.data_center)}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token', client_id: c.client_id, client_secret: c.client_secret, refresh_token: c.refresh_token,
    }),
  });
  const j = await r.json().catch(() => null);
  if (!j?.access_token) throw new Error('zoho_sem_token');
  cacheToken = { t: j.access_token, ate: Date.now() + 50 * 60 * 1000 };
  return cacheToken.t;
}

// O Zoho invalida o token ANTES de 1 hora (F7003, visto em 06/10/2026). Quem vê isso renova e tenta UMA vez de novo.
async function zoho(c: Conexao, caminho: string): Promise<Response> {
  const base = `https://www.zohoapis${sufixo(c.data_center)}/workdrive/api/v1`;
  for (let tentativa = 0; ; tentativa++) {
    const r = await fetch(base + caminho, {
      headers: { Authorization: 'Zoho-oauthtoken ' + (await tokenDoZoho(c)), Accept: 'application/vnd.api+json' },
    });
    if (r.ok || tentativa) return r;
    const txt = await r.clone().text().catch(() => '');
    if (r.status !== 401 && !/F7003|invalid.{0,3}oauth/i.test(txt)) return r;
    cacheToken = null;
  }
}

// A API devolve no máximo 50 itens por chamada; sem paginar a pasta "Vessel Brasil" (dezenas de subpastas) perderia itens.
const POR_PAGINA = 50;
async function listar(c: Conexao, pastaId: string): Promise<Item[]> {
  const todos: Item[] = [];
  for (let offset = 0; offset < 5000; offset += POR_PAGINA) {
    const r = await zoho(c, `/files/${encodeURIComponent(pastaId)}/files?page%5Blimit%5D=${POR_PAGINA}&page%5Boffset%5D=${offset}`);
    // Leitura que falhou NÃO é pasta vazia: seria "não achei o cartão" mentindo sobre o Zoho.
    if (!r.ok) throw new Error(`zoho_listar_${r.status}`);
    const j = await r.json();
    const pagina = Array.isArray(j.data) ? j.data : [];
    for (const d of pagina) {
      todos.push({ id: String(d.id), name: String(d.attributes?.name ?? '').trim(), folder: !!d.attributes?.is_folder });
    }
    if (pagina.length < POR_PAGINA) break;
  }
  return todos;
}

let pastaDosCartoes: string | null = null; // o id não muda; poupa 3 chamadas por clique
async function acharPastaDosCartoes(c: Conexao): Promise<string | null> {
  if (pastaDosCartoes) return pastaDosCartoes;
  const vb = (await listar(c, RAIZ_FOTOS)).find((p) => p.folder && p.name.normalize('NFC') === 'Vessel Brasil');
  if (!vb) return null;
  const pasta = (await listar(c, vb.id)).find((p) => p.folder && ehPastaDosCartoes(p.name));
  pastaDosCartoes = pasta?.id ?? null;
  return pastaDosCartoes;
}

// ── O QUE FICA NA MEMÓRIA DA INSTÂNCIA (ponytail: some quando a instância é reciclada; nada vai para o banco) ──────────
// Cada clique em "Baixar" refazia a busca inteira no Zoho em série (dias → pastas do dia → pasta do SKU → arquivo, ~7 s) e
// "frente e verso" a fazia duas vezes. Agora UMA listagem da pasta do SKU guarda o id de TODOS os arquivos dela (frente, verso,
// png, pdf, de todas as peças), e o clique seguinte vai direto ao download.
// ⚠️ A chave leva o DIA: "vale o dia mais NOVO que tiver o arquivo" (peça refeita em outro dia). Sem o dia, o id do cartão
// velho ficaria valendo por 10 min depois de a pessoa refazer. Só se confia no guardado quando o dia é o do último pedido
// da peça; sem esse dia a busca é a completa de sempre. Id guardado que o Zoho recusa é esquecido e a busca é refeita.
const VALE_MS = 10 * 60 * 1000;
const arquivosConhecidos = new Map<string, { id: string; ate: number }>(); // `${dia}/${sku}|${nome}` -> id no Zoho
let diasConhecidos: { itens: Item[]; ate: number } | null = null;

async function listarOsDias(c: Conexao, raiz: string, forcar: boolean): Promise<{ itens: Item[]; doCache: boolean }> {
  if (!forcar && diasConhecidos && Date.now() < diasConhecidos.ate) return { itens: diasConhecidos.itens, doCache: true };
  const itens = diasEmOrdem((await listar(c, raiz)).filter((p) => p.folder));
  diasConhecidos = { itens, ate: Date.now() + VALE_MS };
  return { itens, doCache: false };
}

/**
 * O id do arquivo no dia mais novo que o tem; `null` se nenhum dia tem. `diaDica` é o dia do último pedido da peça: é
 * olhado primeiro (e só ele autoriza usar o id guardado).
 */
async function acharOArquivo(c: Conexao, sku: string, nome: string, diaDica: string | null, semGuardado = false): Promise<string | null> {
  if (diaDica && !semGuardado) {
    const g = arquivosConhecidos.get(`${diaDica}/${sku}|${nome}`);
    if (g && Date.now() < g.ate) return g.id;
  }
  const raiz = await acharPastaDosCartoes(c);
  if (!raiz) return null;
  // Lista de dias velha pode não ter o dia de hoje (a 1ª peça do dia cria a pasta): se não achar, refaz com lista nova.
  for (const forcar of [false, true]) {
    const { itens, doCache } = await listarOsDias(c, raiz, forcar);
    for (const dia of diasComDicaPrimeiro(itens, diaDica)) {
      const pasta = pastaDoSku((await listar(c, dia.id)).filter((p) => p.folder), sku);
      if (!pasta) continue;
      const arquivos = (await listar(c, pasta.id)).filter((a) => !a.folder);
      for (const a of arquivos) arquivosConhecidos.set(`${dia.name.trim()}/${sku}|${a.name}`, { id: a.id, ate: Date.now() + VALE_MS });
      const achado = arquivos.find((a) => a.name === nome);
      if (achado) return achado.id;
    }
    if (!doCache) break; // a lista já era nova: não adianta repetir
  }
  return null;
}

async function tratar(req: Request): Promise<Response> {
  const t0 = Date.now();
  if (req.method !== 'POST') return json({ erro: 'metodo_invalido' }, 405);

  // --- quem é e se pode ---
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ erro: 'sem_token' }, 401);
  const doUsuario = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: auth } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: u, error: eu } = await doUsuario.auth.getUser();
  if (eu || !u?.user) return json({ erro: 'nao_autenticado' }, 401);
  const { data: pode } = await doUsuario.rpc('is_vessel_admin');
  if (pode !== true) return json({ erro: 'sem_permissao' }, 403);

  // --- o pedido ---
  const corpo = await req.json().catch(() => null);
  const codigo = String(corpo?.codigo ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,24}$/.test(codigo)) return json({ erro: 'codigo_invalido' }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: peca, error: ep } = await sb.from('vessel_pecas')
    .select('codigo, numero_na_serie, cartao_gerado_em, vessel_lotes(sku)').eq('codigo', codigo).maybeSingle();
  if (ep) { console.error('vessel-baixar-cartao: leitura da peça —', ep.message); return json({ erro: 'banco_indisponivel' }, 500); }
  if (!peca) return json({ erro: 'peca_nao_existe' }, 404);
  // Só o que o robô entregou. Peça sem cartão não tem arquivo para baixar — a tela manda gerar primeiro.
  if (!peca.cartao_gerado_em) return json({ erro: 'sem_cartao' }, 409);
  const sku = (peca as any).vessel_lotes?.sku;
  const nome = nomeDoArquivo(sku, peca.numero_na_serie, corpo?.face, corpo?.formato);
  if (!nome) return json({ erro: 'pedido_invalido' }, 400);

  // --- o Zoho ---
  const { data: con } = await sb.from('acessos_conexoes')
    .select('client_id, client_secret, refresh_token, data_center').eq('provedor', 'zoho').limit(1).maybeSingle();
  if (!con?.refresh_token) return json({ erro: 'zoho_desconectado' }, 503);

  // O dia do último pedido que entregou a peça (o robô grava "Cartões com EAN/AAAA-MM-DD"). Só uma dica: se faltar, vale a busca completa.
  const { data: ultimo } = await sb.from('vessel_cartao_pedidos').select('pasta')
    .contains('pecas', [codigo]).in('situacao', ['pronto', 'falhou']).not('pasta', 'is', null)
    .order('terminou_em', { ascending: false }).limit(1).maybeSingle();
  const diaDica = diaDaPasta(ultimo?.pasta);

  try {
    let id = await acharOArquivo(con as Conexao, sku, nome, diaDica);
    const msBusca = Date.now() - t0; // tudo até achar o id: login, banco, busca no Zoho
    if (!id) return json({ erro: 'arquivo_nao_achado', arquivo: nome }, 404);
    let r = await zoho(con as Conexao, `/download/${encodeURIComponent(id)}`);
    if (!r.ok) {
      // Pode ser o id guardado que ficou velho (arquivo trocado/apagado): esquece e busca de novo, UMA vez.
      id = await acharOArquivo(con as Conexao, sku, nome, diaDica, true);
      if (!id) return json({ erro: 'arquivo_nao_achado', arquivo: nome }, 404);
      r = await zoho(con as Conexao, `/download/${encodeURIComponent(id)}`);
    }
    if (!r.ok) { console.error('vessel-baixar-cartao: download', nome, r.status); return json({ erro: 'zoho_recusou', status: r.status }, 502); }
    // `application/octet-stream` de propósito: é o que faz o supabase-js entregar um Blob (png/pdf viriam como texto).
    return new Response(r.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${nome}"`,
        'Cache-Control': 'no-store',
        // Aba Network do navegador: "busca" = até achar o arquivo no Zoho; "total" = até começar a devolver.
        'Server-Timing': `busca;dur=${msBusca}, total;dur=${Date.now() - t0}`,
      },
    });
  } catch (e) {
    console.error('vessel-baixar-cartao:', e instanceof Error ? e.message : e);
    return json({ erro: 'zoho_indisponivel' }, 502);
  }
}

Deno.serve(async (req: Request) => {
  const cors = corsDoPedido(req, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const resp = await tratar(req);
  const headers = new Headers(resp.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(resp.body, { status: resp.status, headers });
});
