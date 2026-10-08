// supabase/functions/conteudo-espelho/index.ts
//
// O espelho: liga a peça planejada aqui ao post que saiu lá, e traz o
// desempenho de volta.
//
// Roda de 30 em 30 minutos. Dois passos independentes:
//   A) CASAR  — peças agendadas/publicadas sem vínculo × /{ig}/media
//   B) MEDIR  — peças já vinculadas × /{media}/insights
//
// POR QUE UMA FUNÇÃO NOVA e não um pedaço dentro de coletar-dados: aquela
// função tem 27 KB, roda 4x por dia e é o que alimenta o painel inteiro. Uma
// falha aqui não pode derrubar a coleta de seguidores e engajamento — e a
// cadência é outra (30 min contra 6 horas).
//
// TOKEN: relido do banco a cada execução, sempre. `coletar-dados` renova o
// token da Meta e regrava em accounts.access_token; guardar o valor em qualquer
// lugar dá 190 (OAuthException) dias depois, sem explicação aparente.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { casar } from '../_shared/casar-publicacao.js';
import { precisaMedir, lerMetricas, DIAS_DE_ACOMPANHAMENTO } from '../_shared/cadencia-de-medicao.js';
import { metaDoCore } from '../_shared/core-meta.js';

// CORE_META=true: a Graph passa pelo proxy do `core` (token global; não lê accounts.access_token). Ver _shared/core-meta.js.
const META = metaDoCore(Deno.env.toObject());

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GRAPH = 'https://graph.facebook.com/v21.0';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

async function graph(caminho: string, params: Record<string, string>, token: string) {
  const u = new URL(`${GRAPH}/${caminho}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await META.fetch(u, { headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json();
  if (j && j.error) throw new Error(j.error.message || 'erro na Meta');
  return j;
}

const CAMPOS_MIDIA =
  'id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const negado = await exigirSegredoDeCron(req, 'conteudo-espelho');
  if (negado) return negado;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const agora = new Date();
  // `midias_vistas` e `pecas_pendentes` existem para diagnóstico: sem eles, uma
  // resposta "0 casadas" não distingue "não achei o post" de "não havia post
  // nenhum para olhar" — e os dois pedem investigações opostas.
  const resumo = {
    casadas: 0, sugeridas: 0, medidas: 0, contas: 0,
    pecas_pendentes: 0, midias_vistas: 0, falhas: [] as any[],
  };

  // ── PASSO A: CASAR ────────────────────────────────────────────────────────
  // Só peças dos últimos 7 dias: mais velho que isso, o post já saiu da primeira
  // página de /media e a janela de casamento (24h) já fechou de qualquer jeito.
  const seteDiasAtras = new Date(agora.getTime() - 7 * 86400000).toISOString();
  // STORY FICA DE FORA. A Graph não devolve story de forma confiável em
  // /{ig}/media, então `casar-publicacao.js` nunca casa um — e sem este filtro
  // toda peça de story era relida a cada 30 minutos, por 7 dias, para dar zero.
  // Trabalho puro, e pior: a peça parecia "em análise" quando na verdade nunca
  // seria analisada. Para story o caminho é colar o link à mão, no painel.
  const { data: semVinculo } = await sb
    .from('conteudo_pecas')
    .select('id,account_id,titulo,formato,legenda,hashtags,publicar_em,status')
    .in('status', ['agendada', 'publicada'])
    .neq('formato', 'stories')
    .is('ig_media_id', null)
    .gte('publicar_em', seteDiasAtras)
    .not('publicar_em', 'is', null);

  resumo.pecas_pendentes = (semVinculo || []).length;

  const porConta = new Map<string, any[]>();
  for (const p of semVinculo || []) {
    if (!porConta.has(p.account_id)) porConta.set(p.account_id, []);
    porConta.get(p.account_id)!.push(p);
  }

  if (porConta.size) {
    const { data: contas } = await sb
      .from('accounts')
      .select(META.colunas('id,name,instagram_id,access_token'))
      .in('id', [...porConta.keys()]);

    for (const conta of contas || []) {
      if (!conta.instagram_id || !META.token(conta)) continue;
      resumo.contas++;
      try {
        const midias = await graph(
          `${conta.instagram_id}/media`, { fields: CAMPOS_MIDIA, limit: '50' }, META.token(conta),
        );
        resumo.midias_vistas += (midias?.data || []).length;

        // Posts já vinculados a alguma peça, ou já recusados para ela. Sem isto
        // o robô ofereceria de novo, toda rodada, o post que a pessoa já disse
        // que não era — e a faixa "É este post?" nunca sairia da tela.
        const pecasDaConta = porConta.get(conta.id)!;
        const [{ data: vinculados }, { data: decididos }] = await Promise.all([
          sb.from('conteudo_pecas').select('ig_media_id').not('ig_media_id', 'is', null),
          sb.from('conteudo_casamentos').select('ig_media_id,peca_id,situacao')
            .in('peca_id', pecasDaConta.map((p: any) => p.id)),
        ]);
        const jaUsados = [
          ...(vinculados || []).map((v: any) => v.ig_media_id),
          ...(decididos || []).map((d: any) => d.ig_media_id),
        ];

        const achados = casar(pecasDaConta, midias?.data || [], { jaUsados });

        for (const a of achados) {
          await sb.from('conteudo_casamentos').upsert({ ...a }, { onConflict: 'peca_id,ig_media_id' });

          if (a.situacao === 'automatico') {
            await sb.from('conteudo_pecas').update({
              ig_media_id: a.ig_media_id,
              ig_permalink: a.ig_permalink,
              status: 'publicada',
              publicado_em: a.ig_timestamp,
            }).eq('id', a.peca_id);
            await sb.from('conteudo_eventos').insert({
              peca_id: a.peca_id, acao: 'casou',
              detalhe: `Encontrei o post no Instagram sozinho. ${a.motivo}`,
            });
            resumo.casadas++;
          } else {
            resumo.sugeridas++;
          }
        }
      } catch (e) {
        // Uma conta que falha não derruba as outras.
        resumo.falhas.push({ etapa: 'casar', conta: conta.name, erro: String(e) });
      }
    }
  }

  // ── PASSO B: MEDIR ────────────────────────────────────────────────────────
  const limiteIdade = new Date(agora.getTime() - DIAS_DE_ACOMPANHAMENTO * 86400000).toISOString();
  const { data: publicadas } = await sb
    .from('conteudo_pecas')
    .select('id,account_id,ig_media_id,publicado_em')
    .not('ig_media_id', 'is', null)
    .gte('publicado_em', limiteIdade);

  if (publicadas?.length) {
    const { data: ultimas } = await sb
      .from('conteudo_metricas')
      .select('peca_id,capturado_em')
      .in('peca_id', publicadas.map((p: any) => p.id))
      .order('capturado_em', { ascending: false });

    const ultimaPorPeca = new Map<string, string>();
    for (const m of ultimas || []) {
      if (!ultimaPorPeca.has(m.peca_id)) ultimaPorPeca.set(m.peca_id, m.capturado_em);
    }

    const aMedir = publicadas.filter((p: any) => precisaMedir(p, ultimaPorPeca.get(p.id) || null, agora));

    if (aMedir.length) {
      const { data: contas } = await sb
        .from('accounts').select(META.colunas('id,name,access_token'))
        .in('id', [...new Set(aMedir.map((p: any) => p.account_id))]);
      const tokens = Object.fromEntries((contas || []).map((c: any) => [c.id, c]));

      for (const p of aMedir) {
        const conta = tokens[p.account_id];
        if (!conta || !META.token(conta)) continue;
        try {
          const [midia, insights] = await Promise.all([
            graph(p.ig_media_id, { fields: 'like_count,comments_count,permalink' }, META.token(conta)),
            // Os insights falham em alguns tipos de mídia (e em post antigo).
            // Isso não pode impedir a gravação de curtidas e comentários, que
            // vieram do objeto da mídia e são o que aparece no cartão.
            graph(`${p.ig_media_id}/insights`, { metric: 'reach,saved,shares,views' }, META.token(conta))
              .catch(() => null),
          ]);

          await sb.from('conteudo_metricas').upsert({
            peca_id: p.id,
            capturado_em: agora.toISOString().slice(0, 10),
            ...lerMetricas(midia, insights),
          }, { onConflict: 'peca_id,capturado_em' });
          resumo.medidas++;
        } catch (e) {
          resumo.falhas.push({ etapa: 'medir', peca: p.id, erro: String(e) });
        }
      }
    }
  }

  return json({ ok: true, ...resumo });
});
