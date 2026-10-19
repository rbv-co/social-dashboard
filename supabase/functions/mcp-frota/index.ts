// supabase/functions/mcp-frota/index.ts
//
// O MCP da Frota para o ChatGPT (Streamable HTTP sem estado: cada POST é uma mensagem JSON-RPC e a resposta é
// JSON). As ferramentas e o JSON-RPC moram em ../_shared/mcp-frota.js; aqui só HTTP, token e banco.
//
// PONTE ATÉ A VIRADA. Na virada (19/10, 22h40) o Supabase congela e isto para de gravar; o lugar definitivo é
// a API Go (api/internal/mcp, PR #418). Depois da virada: desligar o OAuth Server do Supabase Auth.
//
// QUEM ENTRA. O login é o servidor OAuth 2.1 do PRÓPRIO Supabase Auth (registro dinâmico + consentimento em
// /oauth/consentimento do front). O token que ele emite é um token comum da pessoa, então:
//   - o banco é chamado COM ESSE TOKEN: valem o RLS e os gatilhos da Frota, como na tela;
//   - só passa token com client_id (emitido pelo OAuth): a sessão da tela não serve aqui;
//   - só passa gestor da Frota (aba Gestão), conferido AQUI e a cada chamada: tirar a permissão vale na hora.
// verify_jwt DESLIGADO (--no-verify-jwt): sem sessão o ChatGPT precisa do 401 desta função com o
// WWW-Authenticate, e o do gateway não traz. A assinatura quem confere é o auth.getClaims().
// O conector usa https://central.rbvcompany.com/mcp-frota (nginx do central repassa para cá e serve os
// metadados na raiz: /etc/nginx/snippets/central-mcp-frota.conf); o /.well-known daqui fica para quem chamar direto.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { responder, gestorDaFrota, clienteOAuth } from '../_shared/mcp-frota.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const AQUI = `${SUPABASE_URL}/functions/v1/mcp-frota`;
const METADADOS = `${AQUI}/.well-known/oauth-protected-resource`;
const FRASE_SO_GESTOR = 'Só quem administra a Frota (aba Gestão) pode ligar o ChatGPT a ela.';
// um só por instância: guarda a JWKS entre chamadas enquanto a edge está quente
const verificador = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const json = (b: unknown, s = 200, h: Record<string, string> = {}) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...h } });
const naoAutenticado = () =>
  json({ error: 'nao_autenticado' }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${METADADOS}"` });

// deno-lint-ignore no-explicit-any
function banco(sb: any, auth: string) {
  // deno-lint-ignore no-explicit-any
  const ou = ({ data, error }: any) => { if (error) throw new Error(error.message); return data; };
  return {
    // deno-lint-ignore no-explicit-any
    async listar(tabela: string, { colunas, filtros, ordem, limite }: any) {
      let q = sb.from(tabela).select(colunas || '*');
      for (const [c, op, v] of filtros) {
        if (op === 'eq') q = q.eq(c, v);
        else if (op === 'is_null') q = q.is(c, null);
        else if (op === 'not_null') q = q.not(c, 'is', null);
        else if (op === 'ilike_qualquer') q = q.or(Object.entries(v).map(([col, t]) => `${col}.ilike.*${t}*`).join(','));
        else throw new Error('filtro desconhecido: ' + op);
      }
      return ou(await q.order(ordem[0], { ascending: !ordem[1], nullsFirst: false }).limit(limite));
    },
    async inserir(tabela: string, linhas: unknown) { return ou(await sb.from(tabela).insert(linhas).select()); },
    async editar(tabela: string, id: string, campos: unknown) { return ou(await sb.from(tabela).update(campos).eq('id', id).select()); },
    async apagar(tabela: string, id: string) { ou(await sb.from(tabela).delete().eq('id', id)); },
    // o maior km já registrado do carro (estado-do-veiculo.js): devolução, saída, hodômetro do checklist,
    // manutenção e abastecimento. Leitura que falha derruba a gravação: não se grava às cegas.
    async maiorKm(veiculo: string) {
      const fontes = [['frota_uso', 'km_volta'], ['frota_uso', 'km_saida'], ['frota_checklist', 'hodometro'],
        ['frota_revisoes', 'km'], ['frota_abastecimentos', 'km']];
      const vistos = await Promise.all(fontes.map(async ([t, c]) => {
        const { data, error } = await sb.from(t).select(c).eq('veiculo_id', veiculo).not(c, 'is', null)
          .order(c, { ascending: false }).limit(1);
        if (error) throw new Error(`não consegui ler ${t}: ${error.message}`);
        return data[0]?.[c] ?? null;
      }));
      const ns = vistos.filter((v) => v != null).map(Number);
      return ns.length ? Math.max(...ns) : null;
    },
    // o mesmo aviso que a tela manda (avisar-decisao-de-reserva confere frota.aprovar de novo)
    async avisar(requisicaoId: string) {
      const r = await fetch(`${SUPABASE_URL}/functions/v1/avisar-decisao-de-reserva`, {
        method: 'POST', headers: { Authorization: auth, apikey: ANON_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requisicaoId }), signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new Error(`aviso HTTP ${r.status}`);
      return await r.json();
    },
  };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET' && url.pathname.endsWith('/.well-known/oauth-protected-resource')) {
    return json({ resource: AQUI, authorization_servers: [`${SUPABASE_URL}/auth/v1`], bearer_methods_supported: ['header'], resource_name: 'Frota RBV' });
  }
  if (req.method !== 'POST') return new Response('use POST', { status: 405, headers: { Allow: 'POST' } });

  const auth = req.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token || !clienteOAuth(token)) return naoAutenticado();
  // getClaims confere assinatura e validade AQUI, pela chave pública do projeto (ES256, JWKS em cache no
  // cliente do módulo): sem a ida ao Auth que o getUser fazia a cada chamada (~0,3 s medido em 19/10).
  // Conta desativada continua barrada: o perfil abaixo e cada consulta passam pelo RLS (conta_ativa).
  const { data: verificado, error: erroToken } = await verificador.auth.getClaims(token);
  const sub = verificado?.claims?.sub;
  if (erroToken || !sub || !verificado?.claims?.client_id) return naoAutenticado();
  const sb = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  // perfil e corpo em paralelo
  const [{ data: perfil, error: erroPerfil }, m] = await Promise.all([
    sb.from('profiles').select('is_superadmin,permissions').eq('id', sub).maybeSingle(),
    req.json().catch(() => null),
  ]);
  if (erroPerfil) return json({ error: 'erro_interno' }, 500);
  if (!gestorDaFrota(perfil)) return json({ error: 'sem_permissao', mensagem: FRASE_SO_GESTOR }, 403);

  if (!m || typeof m !== 'object' || Array.isArray(m) || m.jsonrpc !== '2.0' || typeof m.method !== 'string') {
    return json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'mensagem JSON-RPC inválida (lote não é aceito)' } }, 400);
  }
  if (m.id === undefined || m.id === null) return new Response(null, { status: 202 }); // notificação
  const r = await responder(m, { db: banco(sb, `Bearer ${token}`), usuario: sub, agora: new Date() });
  return json({ jsonrpc: '2.0', id: m.id, ...r });
});
