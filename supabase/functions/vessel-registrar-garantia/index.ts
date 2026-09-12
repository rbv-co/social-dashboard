// supabase/functions/vessel-registrar-garantia/index.ts
//
// A PORTA DA GARANTIA. A página do certificado chama AQUI, e não o banco
// direto — e essa é a decisão que segura a trava inteira.
//
// ── O DEFEITO QUE ISTO CONSERTA ─────────────────────────────────────────────
//
// A tag NFC não tem senha: quem encosta o celular na bolsa abre a página.
// Antes, registrar a garantia era "quem chegar primeiro leva" — qualquer
// pessoa que segurasse a bolsa punha o nome dela, e a dona de verdade lia "já
// registrada" e ficava sem garantia. A vendedora curiosa queimava a garantia
// de uma bolsa sem perceber.
//
// A prova de que a bolsa é sua não é TER A BOLSA NA MÃO — o ladrão também tem.
// É ter COMPRADO. E essa prova está no Bling.
//
// ── O CAMINHO ───────────────────────────────────────────────────────────────
//
//   1. abre um pedido PENDENTE no banco (nada vira dono ainda);
//   2. procura no Bling um contato com aquele CPF;
//   3. procura, nos pedidos de venda desse contato, um item do modelo da bolsa;
//   4. achou  → aprova na hora, guardando o número do pedido como prova;
//      não achou → deixa pendente, e o dono da marca decide no painel.
//
// ⚠️ QUALQUER FALHA DAQUI PRA FRENTE DEIXA PENDENTE, NUNCA RECUSA. Bling fora
// do ar, token vencido, resposta estranha: o pedido da cliente já está guardado
// e cai na fila de gente. O contrário — recusar porque um sistema de terceiro
// piscou — mandaria embora uma cliente legítima com a bolsa na mão.
//
// ⚠️ NADA DO BLING VOLTA PARA A PÁGINA. A resposta diz "ativada" ou "estamos
// conferindo", e só. Devolver o pedido de venda contaria, a quem digitou um CPF
// qualquer, o que aquela pessoa comprou — e a página responde a qualquer um.
//
// ⚠️ POR QUE UMA EDGE E NÃO UMA RPC: `vessel_abrir_pedido_de_registro` não é
// concedida a `anon` nem a `authenticated`. Só esta função a chama, com a chave
// de serviço. Se a página pudesse abrir pedidos direto, a fila encheria de
// pedidos que ninguém tentou casar com uma venda — que é metade do valor disto.
import { createClient } from 'jsr:@supabase/supabase-js@2';
// A regra do casamento mora fora daqui, em `_shared`, porque e ela que decide
// se a cliente ganha a garantia na hora ou espera na fila — e la ela tem teste.
import { casaComOSku } from '../_shared/casar-sku-do-bling.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const BLING = 'https://api.bling.com.br/Api/v3';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/**
 * O token do Bling, renovado se estiver vencido.
 *
 * ⚠️ COPIADO DE `bling-proxy/getValidToken`, e não reescrito de cabeça: a
 * versão que eu tinha escrito lia `expires_in` + `updated_at`, mas a coluna que
 * existe é `expires_at`. Ela teria "funcionado" — `new Date(undefined)` dá
 * `NaN`, `Date.now() < NaN` é falso, então TODA chamada renovaria o token,
 * gastando um refresh por registro e podendo derrubar o acesso do painel
 * inteiro. Erro que não dá erro é o caro.
 */
async function tokenDoBling(sb: ReturnType<typeof createClient>): Promise<string | null> {
  const { data, error } = await sb.from('bling_tokens').select('*')
    .order('id', { ascending: false }).limit(1).single();
  if (error || !data) return null;

  if (new Date(data.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) {
    return data.access_token as string;
  }

  const creds = btoa(`${data.client_id}:${data.client_secret}`);
  const resp = await fetch(`${BLING}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: `grant_type=refresh_token&refresh_token=${data.refresh_token}`,
  });
  if (!resp.ok) return null;

  const tokens = await resp.json();
  await sb.from('bling_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', data.id);
  return tokens.access_token as string;
}

type Achado = { pedido: string; contato: string; quando: string | null } | null;

/** Procura uma compra daquele CPF com aquele modelo. `null` = não achou. */
async function procurarACompra(t: string, cpf: string, sku: string): Promise<Achado> {
  const busca = await fetch(`${BLING}/contatos?numeroDocumento=${encodeURIComponent(cpf)}`,
    { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } });
  if (!busca.ok) return null;
  const contatos = (await busca.json())?.data;
  if (!Array.isArray(contatos) || !contatos.length) return null;

  // Mais de um contato com o mesmo CPF acontece (cadastro duplicado no ERP), e
  // a compra pode estar em qualquer um deles.
  for (const contato of contatos.slice(0, 5)) {
    const lista = await fetch(`${BLING}/pedidos/vendas?idContato=${contato.id}&limite=50`,
      { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } });
    if (!lista.ok) continue;
    const pedidos = (await lista.json())?.data;
    if (!Array.isArray(pedidos)) continue;

    // Do mais novo para o mais antigo: quem tem várias compras costuma estar
    // registrando a última. E o teto de 20 existe para a página não ficar
    // pendurada em cliente antigo de cinquenta pedidos.
    for (const p of pedidos.slice(0, 20)) {
      const det = await fetch(`${BLING}/pedidos/vendas/${p.id}`,
        { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } });
      if (!det.ok) continue;
      const itens = (await det.json())?.data?.itens;
      if (!Array.isArray(itens)) continue;
      if (itens.some((i: any) => casaComOSku(i?.codigo, sku))) {
        return { pedido: String(p.numero ?? p.id), contato: String(contato.id), quando: p.data ?? null };
      }
    }
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ ok: false, motivo: 'metodo' }, 405);

  const corpo = await req.json().catch(() => null);
  if (!corpo) return responder({ ok: false, motivo: 'dados_invalidos' }, 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── 1. guardar o pedido ANTES de falar com qualquer sistema de fora ──
  // Se o Bling cair no meio, a cliente não perde o que digitou.
  const { data: aberto, error } = await sb.rpc('vessel_abrir_pedido_de_registro', {
    p_codigo: corpo.codigo, p_nome: corpo.nome, p_cpf: corpo.cpf,
    p_whatsapp: corpo.whatsapp, p_onde: corpo.onde ?? null,
    p_comprado_em: corpo.comprado_em ?? null,
    // A DATA DE NASCIMENTO entrou em 06/09/2026. Ela existe por um motivo de
    // operação, e não de cadastro: na hora da venda a vendedora quase nunca
    // consegue tirar todos os dados, e validar a garantia é o momento em que a
    // própria cliente preenche o que faltou. Daí o robô completa o cadastro
    // dela no Bling.
    p_nascimento: corpo.nascimento ?? null,
  });
  if (error) return responder({ ok: false, motivo: 'falha_ao_guardar' }, 500);
  if (!aberto?.ok) return responder(aberto, 200);

  // ── 2. tentar casar com uma compra ──
  let achado: Achado = null;
  try {
    const t = await tokenDoBling(sb);
    if (t) achado = await procurarACompra(t, String(corpo.cpf).replace(/\D/g, ''), String(aberto.sku ?? ''));
  } catch {
    // De propósito sem tratamento: qualquer tropeço aqui deixa PENDENTE, que é
    // o caminho seguro. O `catch` vazio é a decisão, não o esquecimento.
    achado = null;
  }

  if (!achado) {
    return responder({
      ok: true, estado: 'pendente',
      ja_tem_dono: aberto.ja_tem_dono === true, dono_curto: aberto.dono_curto ?? null,
    });
  }

  // ── 3. bateu: aprova, guardando a prova junto ──
  const { data: decidido } = await sb.rpc('vessel_decidir_pedido_de_registro', {
    p_pedido: aberto.pedido, p_estado: 'aprovado', p_quem_decidiu: 'bling',
    p_conferencia: achado, p_motivo: null,
  });
  if (!decidido?.ok) {
    // A conferência bateu mas a aprovação não passou (a peça pode ter ganhado
    // dono entre uma coisa e outra). Fica pendente: uma pessoa decide.
    return responder({ ok: true, estado: 'pendente', ja_tem_dono: true,
                       dono_curto: aberto.dono_curto ?? null });
  }
  return responder({ ok: true, estado: 'aprovado', garantia_ate: decidido.garantia_ate });
});
