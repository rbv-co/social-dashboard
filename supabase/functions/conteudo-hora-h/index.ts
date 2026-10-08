// supabase/functions/conteudo-hora-h/index.ts
//
// Roda de 5 em 5 minutos. Pega as peças cuja hora chegou e manda um push para
// quem pode publicar, com a arte e a legenda prontas.
//
// POR QUE ELA AINDA NÃO PUBLICA: a publicação está IMPLEMENTADA em
// _shared/publicar-instagram.js, mas desligada no interruptor
// ESCOPOS_DE_PUBLICACAO_LIBERADOS — o aplicativo da Meta ainda não tem o escopo
// `instagram_content_publish` (ver docs/app-review-meta.md). Quando o interruptor
// virar, só o `modo` que volta de publicarPeca() muda; esta função já ramifica
// nele e nada mais precisa mexer.
//
// A ARMADILHA QUE ESTA FUNÇÃO RESOLVE: avisar duas vezes. O cron dispara a cada
// 5 minutos e uma execução pode demorar; duas rodadas podem se cruzar. Se a
// função fizesse "SELECT quem está na hora" e depois "UPDATE marcando avisado",
// as duas leriam a mesma peça e mandariam dois pushes.
//
// A solução é reivindicar ANTES de enviar, num UPDATE ... RETURNING: o banco
// serializa, e a segunda execução simplesmente não encontra a linha. O preço é
// que um envio que falhe depois da reivindicação fica sem aviso — de propósito.
// Melhor um aviso perdido (com botão "reavisar" na tela) do que uma enxurrada
// de repetidos, que é o jeito mais rápido de a pessoa desligar a notificação.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';
import { atrasadaDemais, montarAvisoDePeca, alvosDoAviso } from '../_shared/aviso-de-conteudo.js';
import { publicarPeca, publicacaoAutomaticaLigada } from '../_shared/publicar-instagram.js';
import { metaDoCore } from '../_shared/core-meta.js';

// CORE_META=true: a publicação (desligada hoje) passa pelo proxy do `core` (token global; não lê accounts.access_token).
const META = metaDoCore(Deno.env.toObject());

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const negado = await exigirSegredoDeCron(req, 'conteudo-hora-h');
  if (negado) return negado;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const agora = new Date();

  // ── 1. Reivindica ─────────────────────────────────────────────────────────
  // Uma função no banco porque o PostgREST não faz "UPDATE ... RETURNING" com
  // filtro composto de forma atômica pelo cliente.
  const { data: reivindicadas, error: erroClaim } = await sb.rpc('conteudo_reivindicar_hora_h');
  if (erroClaim) return json({ error: 'falha_ao_reivindicar', detalhe: erroClaim.message }, 500);

  const pecas = reivindicadas || [];
  if (!pecas.length) return json({ ok: true, enviado: false, motivo: 'nada_na_hora' });

  // ── 2. Separa o que está atrasado demais ──────────────────────────────────
  const naHora = pecas.filter((p: any) => !atrasadaDemais(p.publicar_em, agora));
  const atrasadas = pecas.filter((p: any) => atrasadaDemais(p.publicar_em, agora));

  for (const p of atrasadas) {
    await sb.from('conteudo_eventos').insert({
      peca_id: p.id, acao: 'avisou',
      detalhe: 'Passou mais de 12 horas do horário marcado — não avisei para não encher o celular de aviso velho.',
    });
  }
  if (!naHora.length) {
    return json({ ok: true, enviado: false, motivo: 'so_atrasadas', atrasadas: atrasadas.length });
  }

  // ── 3. Publicação automática (hoje sempre devolve 'manual') ───────────────
  const contasIds = [...new Set(naHora.map((p: any) => p.account_id))];
  const { data: contas } = await sb
    .from('accounts')
    .select(META.colunas('id,name,instagram_id,access_token,publicacao_automatica'))
    .in('id', contasIds);
  const porConta = Object.fromEntries((contas || []).map((c: any) => [c.id, { ...c, access_token: META.token(c) }]));

  const paraAvisar: any[] = [];
  const publicadas: any[] = [];

  for (const p of naHora) {
    const conta = porConta[p.account_id];
    if (!publicacaoAutomaticaLigada(conta)) { paraAvisar.push(p); continue; }
    try {
      const { data: arquivos } = await sb.from('conteudo_arquivos')
        .select('caminho,tipo,ordem').eq('peca_id', p.id).order('ordem');
      // A URL TEMPORÁRIA É INJETADA AQUI, e não montada lá dentro: o bucket
      // `conteudo` é PRIVADO e a Meta baixa o arquivo pelo lado dela, então
      // precisa de um link assinado. Quem tem o cliente do Storage é esta
      // função — o módulo de publicar continua sem saber o que é Supabase, e
      // por isso continua testável sem conta nenhuma.
      const urlAssinada = async (caminho: string, segundos: number) => {
        const { data, error } = await sb.storage.from('conteudo').createSignedUrl(caminho, segundos);
        if (error) throw new Error(`não consegui assinar a URL de "${caminho}": ${error.message}`);
        return data?.signedUrl || '';
      };
      const r = await publicarPeca(p, arquivos || [], conta, { urlAssinada, fetch: META.fetch });
      if (r.modo === 'automatico') {
        await sb.from('conteudo_pecas').update({
          status: 'publicada', publicado_em: new Date().toISOString(), ig_media_id: r.ig_media_id,
        }).eq('id', p.id);
        await sb.from('conteudo_eventos').insert({
          peca_id: p.id, de: 'agendada', para: 'publicada', acao: 'publicou',
          detalhe: 'Publicada automaticamente na Meta.',
        });
        publicadas.push(p.id);
      } else {
        paraAvisar.push(p);
      }
    } catch (e) {
      // Falhou publicando? Vira aviso. A peça precisa sair de um jeito ou de outro.
      await sb.from('conteudo_eventos').insert({
        peca_id: p.id, acao: 'erro', detalhe: `Publicação automática falhou: ${String(e)}`,
      });
      paraAvisar.push(p);
    }
  }

  if (!paraAvisar.length) {
    return json({ ok: true, enviado: false, motivo: 'tudo_publicado', publicadas: publicadas.length });
  }

  // ── 4. Manda o push ───────────────────────────────────────────────────────
  const { data: segr } = await sb.from('segredos_de_cron').select('nome, segredo')
    .in('nome', ['vapid_public_key', 'vapid_private_key', 'vapid_subject']);
  const seg = Object.fromEntries((segr || []).map((r: any) => [r.nome, r.segredo]));
  if (!seg.vapid_public_key || !seg.vapid_private_key) return json({ error: 'vapid_nao_configurado' }, 500);
  webpush.setVapidDetails(
    seg.vapid_subject || 'mailto:breno@rbvcompany.com', seg.vapid_public_key, seg.vapid_private_key,
  );

  const [{ data: subs }, { data: prefs }, { data: perfis }] = await Promise.all([
    sb.from('push_subs').select('*'),
    sb.from('push_preferencias').select('user_id,tipo,ativo'),
    // O cruzamento com a permissão: querer o tipo não basta, tem que poder abrir
    // a peça — senão o título dela chega no celular de quem perdeu o acesso.
    sb.from('profiles').select('id,role,is_superadmin,features'),
  ]);
  let enviados = 0, podados = 0, semAlvo = 0;
  const mortas = new Set<string>();

  for (const p of paraAvisar) {
    // OS ALVOS SÃO POR PEÇA, não da rodada inteira: com responsável definido, o
    // aviso é só dele. Calcular uma vez para todas mandaria a peça de uma marca
    // para quem cuida de outra.
    const alvos = alvosDoAviso(subs, prefs, perfis, p.responsavel);

    if (!alvos.length) {
      // Dois casos, uma mensagem para cada — porque o conserto é diferente.
      // A peça JÁ foi reivindicada (não será tentada de novo), então o motivo
      // fica na trilha: senão a pessoa abriria a peça, veria "chegou a hora" e
      // nenhum aviso, sem nenhuma explicação.
      semAlvo++;
      await sb.from('conteudo_eventos').insert({
        peca_id: p.id, acao: 'avisou',
        detalhe: p.responsavel
          ? 'Chegou a hora, mas quem é responsável por esta peça está com o aviso de conteúdo desligado (Administração › Usuários).'
          : 'Chegou a hora, mas ninguém tem o aviso de conteúdo ligado (Administração › Usuários).',
      });
      continue;
    }

    const payload = JSON.stringify(montarAvisoDePeca(p, porConta[p.account_id] || {}));
    for (const s of alvos) {
      if (mortas.has(s.endpoint)) continue;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
        enviados++;
      } catch (err: any) {
        // 410/404 = inscrição morta (app desinstalado, permissão revogada).
        // Marca em memória para não tentar de novo nas peças seguintes desta
        // mesma rodada — três peças na mesma hora fariam três tentativas fadadas.
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          mortas.add(s.endpoint);
          await sb.from('push_subs').delete().eq('endpoint', s.endpoint);
          podados++;
        }
      }
    }
    await sb.from('conteudo_eventos').insert({
      peca_id: p.id, acao: 'avisou', detalhe: `Aviso enviado para ${alvos.length - mortas.size} aparelho(s).`,
    });
  }

  return json({
    // `enviado` reflete o que ACONTECEU, não o que se tentou: com responsável
    // sem a notificação ligada, a rodada termina sem push nenhum — e dizer
    // "enviado: true" ali faria o diagnóstico mentir.
    ok: true, enviado: enviados > 0,
    avisadas: paraAvisar.length, publicadas: publicadas.length,
    atrasadas: atrasadas.length, enviados, podados, sem_alvo: semAlvo,
  });
});
