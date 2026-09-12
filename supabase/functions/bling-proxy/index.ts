import { createClient } from 'jsr:@supabase/supabase-js@2';
// A regra de quais canais de venda a pessoa vê. Mora em `_shared` porque as duas
// telas de venda usam a MESMA — ver o cabeçalho do módulo.
import { canaisDoEscopo, recortarRespostaDoBling } from '../_shared/canais-de-venda-permitidos.js';
// Quando vale tentar de novo, e quanto esperar. A decisão mora lá, com teste:
// solta aqui dentro, ela não teria como quebrar teste nenhum.
import {
  decidirRepeticao,
  fraseDeDesistencia,
  PRAZO_POR_TENTATIVA_MS,
} from '../_shared/tentar-de-novo.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const BLING_BASE = 'https://api.bling.com.br/Api/v3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Lista de caminhos permitidos do Bling.
//
// Por que existe: este proxy chama o Bling com o token da EMPRESA, que enxerga
// o ERP inteiro (pedidos, clientes, produtos, estoque, financeiro). Sem esta
// lista, qualquer caminho da API do Bling seria alcançável por aqui. Então só
// liberamos os caminhos que as telas realmente usam hoje.
//
// Quem usa cada caminho:
//   - pedidos/vendas e pedidos/vendas/{id} → Gestão à Vista, Análise de Vendas,
//     e os robôs do coletor (gestor-comercial, relatorios-comerciais).
//   - vendedores/{id}                      → Gestão à Vista.
//   - produtos e produtos/{id}             → Gestão Comercial e os robôs
//     (baixar-fotos-bling, foto-produto).
//   - estoques/saldos                      → robô relatorios-comerciais.
//   - nfe, nfe/{id}, nfce, nfce/{id}       → robô notas-dos-pedidos, que
//     descobre em que dia a venda foi FATURADA. O pedido sozinho não conta essa
//     história: ele guarda o dia em que foi gerado, e a nota do Atacado costuma
//     sair no dia seguinte. Só leitura — nada aqui emite nem cancela nota.
//
// O trecho do id aceita letras, números, hífen e underline. Não aceita ponto
// nem barra, então não dá pra escapar do caminho (ex.: "produtos/../oauth/token").
// Ao adicionar uma tela nova que use um caminho novo do Bling, inclua o caminho
// aqui — senão a tela recebe 403.
const CAMINHOS_PERMITIDOS: RegExp[] = [
  /^pedidos\/vendas$/,
  /^pedidos\/vendas\/[A-Za-z0-9_-]+$/,
  /^vendedores\/[A-Za-z0-9_-]+$/,
  /^produtos$/,
  /^produtos\/[A-Za-z0-9_-]+$/,
  /^estoques\/saldos$/,
  // `depositos` entrou em 05/09/2026: e a LISTA DOS DEPOSITOS com os nomes.
  // Ate entao os nomes viviam cravados em tres arquivos do repositorio, e loja
  // nova exigia mexer em codigo. Aqui e so leitura de nome de deposito — nao
  // traz saldo, preco nem cliente.
  /^depositos$/,
  /^nfe$/,
  /^nfe\/[A-Za-z0-9_-]+$/,
  /^nfce$/,
  /^nfce\/[A-Za-z0-9_-]+$/,
];

function caminhoPermitido(endpoint: string): boolean {
  return CAMINHOS_PERMITIDOS.some((re) => re.test(endpoint));
}

async function getValidToken(sb: ReturnType<typeof createClient>): Promise<string> {
  const { data, error } = await sb
    .from('bling_tokens')
    .select('*')
    .order('id', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) throw new Error('No Bling token found');

  if (new Date(data.expires_at) > new Date(Date.now() + 5 * 60 * 1000)) {
    return data.access_token;
  }

  const creds = btoa(`${data.client_id}:${data.client_secret}`);
  const resp = await fetch(`${BLING_BASE}/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${creds}`,
    },
    body: `grant_type=refresh_token&refresh_token=${data.refresh_token}`,
  });

  if (!resp.ok) throw new Error(`Token refresh failed: ${await resp.text()}`);

  const tokens = await resp.json();

  await sb.from('bling_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', data.id);

  return tokens.access_token;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  try {
    // Quem está chamando? Resolvemos o usuário pelo JWT de quem chamou.
    // Cuidado: a chave anon é um JWT válido do projeto e está publicada no site,
    // então "ter um JWT" não basta — precisa ser um JWT de USUÁRIO logado.
    // auth.getUser() só devolve usuário nesse caso; com a anon key devolve nada.
    const authHeader = req.headers.get('Authorization') || '';
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'nao autenticado' }, 401);

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // O CORPO É LIDO AQUI, e não lá embaixo, porque a permissão passou a
    // depender do CAMINHO. `req.json()` só pode ser chamado uma vez.
    const { endpoint, params } = await req.json();
    if (!endpoint || typeof endpoint !== 'string') {
      return json({ error: 'endpoint required' }, 400);
    }
    if (!caminhoPermitido(endpoint)) {
      return json({ error: 'endpoint nao permitido' }, 403);
    }

    // ── QUEM PODE, E ATÉ ONDE ────────────────────────────────────────────
    //
    // Este proxy alimenta Vendas ('sales' → Gestão à Vista e Análise de Vendas)
    // e Gestão Comercial ('gestor'). Quem tem qualquer uma das duas pode
    // consultar; admin passa direto. Tem gente com 'sales' e sem 'gestor',
    // então exigir só uma das chaves derrubaria telas legítimas.
    //
    // ATÉ 31/08/2026 ISTO ERA UMA PERGUNTA SÓ — "pode ou não pode?" — e quem
    // passava alcançava todos os caminhos da lista. Agora são duas, porque
    // entrou um consumidor que precisa de MENOS.
    //
    // O painel de Autenticidade cria lotes de etiqueta NFC e precisa do NOME e
    // do código dos produtos. De faturamento não precisa de nada. Medido em
    // `profiles`: das três pessoas com a chave 'autenticidade', uma não tem
    // 'sales' nem 'gestor' — ou ela ganhava acesso ao faturamento inteiro para
    // escolher um produto numa lista, ou o seletor nunca funcionava para ela.
    // As duas saídas eram ruins, e a segunda ainda apontaria o culpado errado.
    //
    // Então 'autenticidade' abre SÓ os caminhos de produto. Quem tem essa chave
    // e pedir pedidos de venda continua levando 403, como antes.
    const CAMINHO_DE_PRODUTO = /^produtos(\/[A-Za-z0-9_-]+)?$/;

    const { data: prof } = await sb
      .from('profiles')
      .select('role, features, is_superadmin, escopo_por_equipe')
      .eq('id', user.id)
      .single();
    const features = Array.isArray(prof?.features) ? prof.features : [];
    const podeVendas = !!prof && (prof.role === 'admin'
      || features.includes('sales') || features.includes('gestor'));
    const podeProdutos = podeVendas || (!!prof && features.includes('autenticidade'));
    const allowed = CAMINHO_DE_PRODUTO.test(endpoint) ? podeProdutos : podeVendas;
    if (!allowed) return json({ error: 'sem permissao' }, 403);

    // ── DE QUAIS CANAIS ESSA PESSOA VÊ O FATURAMENTO (B1f, 13/08/2026) ───────
    //
    // Até aqui a edge perguntava só "essa pessoa PODE?" e devolvia os pedidos de
    // TODOS os canais. Quem estava limitada a uma loja via o faturamento das
    // outras — bastava abrir o console, porque o recorte existia só na tela.
    //
    // Quem decide é o módulo puro, não um `if` reescrito aqui: é o jeito de a
    // tela e a edge não contarem histórias diferentes sobre a mesma pessoa.
    // O `if` abaixo é só economia de consulta para os 16 perfis não limitados —
    // ele não pode mudar a resposta, porque a regra devolve `null` de qualquer
    // jeito quando `escopo_por_equipe` não é `true`.
    let times: { id: string; canal_loja_id: number | null }[] = [];
    let membros: { equipe_id: string; profile_id: string; papel?: string }[] = [];
    let canaisDoBling: { loja_id: number; grupo: string | null; grupo_id?: string | null }[] = [];
    let membrosDeGrupo: { grupo_id: string; profile_id: string; papel?: string }[] = [];
    if (prof.escopo_por_equipe === true) {
      // `papel` (20/08/2026): sem ele a supervisora é tratada como vendedora, e
      // a edge devolveria MENOS do que a tela mostra — as duas contando
      // histórias diferentes sobre a mesma pessoa.
      const { data: m } = await sb.from('equipes_membros').select('equipe_id, profile_id, papel').eq('profile_id', user.id);
      membros = m || [];
      const ids = membros.map((x) => x.equipe_id);
      if (ids.length) {
        const { data: t } = await sb.from('equipes').select('id, canal_loja_id').in('id', ids);
        times = t || [];
      }
      // TODOS os canais com o grupo deles, e não só os dos meus times: é isto
      // que permite à supervisora enxergar o grupo inteiro. São 14 linhas.
      // `grupo_id` entrou em 27/08: é por ele que casa o vínculo de GRUPO, do
      // mesmo jeito que `public.pode_ver_canal` faz no banco.
      const { data: c } = await sb.from('bling_lojas').select('loja_id, grupo, grupo_id');
      canaisDoBling = c || [];
      // A supervisora que mora no GRUPO (e não num time).
      //
      // ⚠️ `sb` AQUI É SERVICE ROLE — ele IGNORA o RLS. Quem limita a leitura às
      // linhas desta pessoa é o `.eq('profile_id', user.id)` abaixo, e mais nada.
      // Tirar esse filtro não daria erro: traria o vínculo de TODO MUNDO, e a
      // regra passaria a ampliar o acesso de quem não devia. Mesmo cuidado da
      // leitura de `equipes_membros` logo acima, pelo mesmo motivo.
      const { data: gm } = await sb.from('canais_grupos_membros')
        .select('grupo_id, profile_id, papel').eq('profile_id', user.id);
      membrosDeGrupo = gm || [];
    }
    // `null` = vê todos os canais (quase todo mundo, e a conta de serviço dos
    // robôs). `[]` = não vê canal nenhum, que é DIFERENTE de `null`.
    const canais = canaisDoEscopo({
      isSuperadmin: !!prof.is_superadmin,
      escopoPorEquipe: prof.escopo_por_equipe === true,
      meuId: user.id,
      times,
      membros,
      canais: canaisDoBling,
      membrosDeGrupo,
    });

    const token = await getValidToken(sb);

    const chamarBling = async (paramsDaVez: Record<string, unknown> | null) => {
      const url = new URL(`${BLING_BASE}/${endpoint}`);
      if (paramsDaVez) {
        for (const [k, v] of Object.entries(paramsDaVez)) {
          if (v === undefined || v === null) continue;
          if (Array.isArray(v)) {
            for (const item of v) url.searchParams.append(k, String(item));
          } else {
            url.searchParams.set(k, String(v));
          }
        }
      }
      /* PRAZO PRÓPRIO E SEGUNDA CHANCE (B20, 18/08/2026).
       *
       * Antes daqui a chamada saía sem prazo nenhum: quando o Bling demorava,
       * ela ficava pendurada até a plataforma matar em ~30s — e quem estava na
       * tela esperava o meio minuto inteiro para receber um erro. Aconteceu 8
       * vezes nas últimas 24h, junto de 5 recusas por excesso (429).
       *
       * Só se repete GET, e é o que existe aqui: o único POST desta função é o
       * refresh do token, que NÃO passa por este caminho — no Bling o refresh é
       * de uso único, e repeti-lo queimaria o token da empresa.
       *
       * Quem decide repetir é `decidirRepeticao`, que tem teste. Aqui só se
       * obedece — inclusive quando ela manda parar. */
      const comeco = Date.now();
      let tentativa = 0;
      let causa = 'o Bling não respondeu';
      for (;;) {
        tentativa++;
        // O prazo é do NAVEGADOR desta chamada, não do Bling: sem `abort`, o
        // `fetch` espera para sempre e a trava de tempo nunca chega a rodar.
        const cortar = new AbortController();
        const alarme = setTimeout(() => cortar.abort(), PRAZO_POR_TENTATIVA_MS);
        let status: number | null = null;
        let corpo: unknown = null;
        let estourouOPrazo = false;
        let retryAfterSegundos: number | null = null;
        try {
          const resp = await fetch(url.toString(), {
            headers: { 'Authorization': `Bearer ${token}` },
            signal: cortar.signal,
          });
          status = resp.status;
          const pedido = Number(resp.headers.get('retry-after'));
          retryAfterSegundos = Number.isFinite(pedido) && pedido > 0 ? pedido : null;
          const text = await resp.text();
          try { corpo = JSON.parse(text); } catch { corpo = { raw: text }; }
          causa = status >= 400 ? `o Bling respondeu ${status}` : causa;
        } catch {
          // Prazo cortado ou rede caiu. Os dois se resolvem do mesmo jeito:
          // tentando de novo. E os dois são DIFERENTES de "o Bling respondeu".
          estourouOPrazo = true;
          causa = 'o Bling não respondeu no prazo';
        } finally {
          clearTimeout(alarme);
        }

        const decisao = decidirRepeticao({
          tentativa,
          status,
          estourouOPrazo,
          msDecorridos: Date.now() - comeco,
          retryAfterSegundos,
        });

        if (!decisao.repetir) {
          // NUNCA houve resposta: não dá para devolver "status 0" nem corpo
          // vazio, que na tela viram "não sei o que aconteceu". Devolve 504 com
          // frase de gente, que é o que o caminho compartilhado sabe mostrar.
          if (status === null) {
            console.error(`[bling-proxy] desisti: ${causa} (${decisao.motivo}), ${tentativa} tentativa(s)`);
            return { status: 504, corpo: { error: fraseDeDesistencia(causa, tentativa) } };
          }
          return { status, corpo };
        }

        console.log(`[bling-proxy] tentativa ${tentativa}: ${decisao.motivo} — espero ${decisao.esperarMs}ms`);
        await new Promise((resolver) => setTimeout(resolver, decisao.esperarMs));
      }
    };

    const limitada = Array.isArray(canais);
    const devolver = (corpo: unknown, status = 200) =>
      new Response(JSON.stringify(corpo), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    // ── A LISTA DE PEDIDOS, para quem está limitada a uma loja ───────────────
    //
    // AQUI MORA O CUIDADO QUE QUASE VIROU DEFEITO. O primeiro jeito óbvio é
    // pedir a lista inteira ao Bling e jogar fora o que não é dela. Só que a
    // tela pagina assim (`paginasDoBling`, src/compartilhado/chamada-do-bling.js):
    // pede de 100 em 100 e PARA quando a página vem com menos de 100. Jogando
    // fora depois, a página de 100 chegaria com 30 na tela dela e a busca
    // pararia na primeira página — a vendedora veria MENOS venda da PRÓPRIA
    // loja, calada. Número errado é pior que tela travada.
    //
    // Então quem recorta é o Bling: `idLoja` (no singular). Medido contra a API
    // em 13/08/2026, com a conta de serviço: `idLoja` é honrado, e nem
    // `idsLojas[]` nem `idsLojas` nem `loja` são — os três voltam com tudo.
    //
    // `idLoja` aceita UMA loja por chamada, então quem estiver em dois times com
    // canais diferentes vira duas chamadas, e as páginas se somam. Isso continua
    // certo com a parada da tela: uma página só fica curta quando aquela loja
    // acabou, então a soma só fica curta quando TODAS acabaram. Hoje as duas
    // pessoas limitadas têm um canal cada (medido em 13/08) — o laço existe para
    // o dia em que alguém tiver dois, não para hoje.
    if (limitada && endpoint === 'pedidos/vendas') {
      // Sem canal nenhum não se pergunta ao Bling: a resposta já é conhecida, e
      // é vazia. A tela explica o porquê (`fraseDoRecorte`).
      if (!canais.length) return devolver({ data: [] });

      const pedidos: unknown[] = [];
      for (const canal of canais) {
        const r = await chamarBling({ ...(params || {}), idLoja: canal });
        // Erro do Bling sobe como veio: a tela sabe distinguir "deu ruim" de
        // "não vendeu nada", e essa diferença foi cara de conquistar.
        if (r.status >= 400) return devolver(r.corpo, r.status);
        if (Array.isArray(r.corpo?.data)) pedidos.push(...r.corpo.data);
      }

      // CINTO E SUSPENSÓRIO: recorta de novo, agora do nosso lado. Se isto
      // tirar alguma coisa, quer dizer que o `idLoja` deixou de ser honrado —
      // e aí a resposta certa é um erro visível, não uma lista que parece boa e
      // está torta pela paginação.
      const conferido = recortarRespostaDoBling(endpoint, { data: pedidos }, canais);
      if (conferido.corpo.data.length !== pedidos.length) {
        return devolver({
          error: 'O filtro de loja do Bling parou de funcionar. Nao vou devolver '
            + 'uma lista pela metade: avise quem cuida do sistema.',
        }, 502);
      }
      return devolver(conferido.corpo);
    }

    // ── Todo o resto ────────────────────────────────────────────────────────
    const r = await chamarBling(params);
    const { corpo, negado } = recortarRespostaDoBling(endpoint, r.corpo, canais);
    if (negado) return json({ error: 'sem permissao para este canal' }, 403);
    return devolver(corpo, r.status);
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
