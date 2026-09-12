// supabase/functions/enviar-push-frota/index.ts
// Cron de manhã, segunda a sexta: avisa quem ainda não fez o checklist do
// carro de hoje.
//
// QUEM É AVISADO (D9b, decisão do dono durante a revisão da F6b): não é
// sempre o dono fixo do carro. Quem responde pelo carro HOJE é quem está com
// ele — a posse aberta em frota_uso, se houver; só na falta dela cai no dono
// fixo (pessoa_id). Se o Marcus emprestou o Volvo pra Barbara, o aviso vai
// pra ela, porque é ela quem vai preencher a ficha, não ele.
//
// Por isso esta função usa quemFaltaHoje() de _shared/checklist.js — a MESMA
// função que o quadro de cobrança da tela usa (tela-de-frota.vue) — em vez de
// reimplementar o laço à mão. Se a lógica daqui divergisse da lógica da tela,
// o robô cobraria uma pessoa e a tela mostraria outra devendo, e as duas não
// podem discordar sobre quem está com cada carro.
//
// SÓ QUEM PRECISA. Um aviso por pessoa, do carro dela — não um aviso geral pra
// todo mundo. Foi assim que o "Vessel está sem saldo" chegou em três pessoas
// que não tinham nada com aquilo, e é o problema que push_preferencias existe
// pra resolver.
//
// NÃO ENVIA quando não tem certeza: se a lista de itens ou a configuração não
// vierem, a função não manda nada. Aviso com contagem errada de itens é pior
// do que silêncio — a pessoa abre, vê outra coisa, e para de confiar.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { inscricoesDoTipo } from '../_shared/notificacoes.js';
import { cadenciasDoDia, itensDaFicha, quemFaltaHoje } from '../_shared/checklist.js';
import { montarAviso } from '../_shared/aviso-de-checklist.js';
import { loginDaPessoa, pessoasSemLogin } from '../_shared/quem-loga.js';
import { exigirSegredoDeCron } from '../_shared/segredo-de-cron.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

// Data de hoje em BRT (UTC-3; o Brasil não tem mais horário de verão).
const hojeBrt = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const negado = await exigirSegredoDeCron(req, 'enviar-push-frota');
  if (negado) return negado;

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const hoje = hojeBrt();

  const [veiculos, itens, config, fichas, usos, pessoas, subs, prefs, usuarios] = await Promise.all([
    sb.from('frota_veiculos').select('id,nome,pessoa_id,situacao'),
    sb.from('frota_checklist_itens').select('*').order('ordem'),
    sb.from('frota_checklist_config').select('*').limit(1),
    // 120 dias bastam pra achar a última semanal/mensal de cada carro —
    // cadenciasDoDia só olha atraso além de 7 e 31 dias.
    sb.from('frota_checklist').select('veiculo_id,feita_em,cadencias')
      .gte('feita_em', new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10)),
    // Só o ABERTO importa pra "quem está com o carro agora" (D9b) — uma
    // viagem ou posse com volta_em preenchida já fechou e não decide nada
    // hoje. Filtrar aqui evita puxar o histórico inteiro de frota_uso.
    sb.from('frota_uso').select('*').is('volta_em', null),
    // `email_corporativo` entra na consulta porque é o resgate de quem tem
    // login mas está sem o elo `profile_id` na ficha — ver _shared/quem-loga.js.
    sb.from('acessos_pessoas').select('id,nome,profile_id,email_corporativo'),
    sb.from('push_subs').select('*'),
    sb.from('push_preferencias').select('*'),
    // Quem existe como usuário do app. Sem esta lista não dá pra resgatar
    // ninguém pelo e-mail, e a função voltaria a avisar só quem tem o elo.
    sb.from('profiles').select('id,email'),
  ]);

  // AS CONSULTAS DE QUE A DECISÃO DEPENDE, TODAS CONFERIDAS. O cabeçalho diz
  // "NÃO ENVIA quando não tem certeza", e conferir só duas das oito deixava a
  // promessa valendo pela metade, com duas falhas concretas:
  //
  // - `usos` falha → usos.data vira nulo → quemFaltaHoje() perde o D9b e volta
  //   a apontar o dono no papel. O robô acorda o Marcus enquanto a tela cobra a
  //   Barbara, que é quem está com o carro. As duas versões da verdade que este
  //   arquivo inteiro existe pra impedir.
  // - `veiculos` falha → a lista sai vazia, ninguém é avisado, e a função
  //   responde "0 enviados" com 200. A Saúde dos Robôs marca SUCESSO e fica
  //   verde num dia em que aviso nenhum saiu.
  //
  // Por isso a falha volta com 500: conferir_robos() grava ok = (status entre
  // 200 e 299), então é o código de status — e só ele — que separa "rodou e
  // decidiu certo" de "não rodou". `motivo` diz qual consulta faltou, pra quem
  // for investigar não ter que adivinhar.
  const obrigatorias = {
    'veículos': veiculos,
    'itens do checklist': itens,
    'configuração': config,
    'fichas de checklist': fichas,
    'quem está com cada carro': usos,
    'pessoas': pessoas,
    'aparelhos inscritos': subs,
    'preferências de aviso': prefs,
    // Entra aqui pelo mesmo motivo que `veículos`: sem a lista de usuários,
    // loginDaPessoa() não acha ninguém, a função responde "0 enviados" com 200
    // e a Saúde dos Robôs fica verde num dia em que aviso nenhum saiu.
    'usuários do app': usuarios,
  };
  const faltando = Object.entries(obrigatorias)
    .filter(([, r]) => r.error).map(([nome]) => nome);
  if (faltando.length) {
    return json({
      enviados: 0,
      erro: 'consulta_falhou',
      motivo: `não enviei: não consegui ler ${faltando.join(', ')} — avisar com dado incompleto `
        + 'mandaria a pessoa errada ou a contagem errada',
    }, 500);
  }

  const cfg = config.data?.[0];
  if (!cfg || !itens.data?.length) {
    // Isto NÃO é falha de consulta: a consulta respondeu, e respondeu vazio.
    // Sem lista de itens ou sem configuração não há checklist montado ainda —
    // o robô rodou e decidiu certo ao não mandar nada.
    return json({ enviados: 0, motivo: 'sem lista ou sem configuração — não envio com dado incompleto' });
  }

  const inscritos = inscricoesDoTipo(subs.data, prefs.data, 'frota');
  if (!inscritos.length) {
    // O caso normal enquanto o dono não ligar o aviso pra ninguém (D16). Isso
    // é SUCESSO: a função rodou, leu as inscrições e decidiu certo — não é
    // defeito.
    return json({ enviados: 0, motivo: 'ninguém ligou este aviso ainda' });
  }

  // O VAPID vem da tabela segredos_de_cron, NÃO de variável de ambiente — é
  // assim no enviar-push-vendas (linhas 105-110), e a tabela tem RLS ligada
  // com zero policies: só o service role lê.
  const { data: segr } = await sb.from('segredos_de_cron').select('nome,segredo')
    .in('nome', ['vapid_public_key', 'vapid_private_key', 'vapid_subject']);
  const seg = Object.fromEntries((segr || []).map((r: { nome: string; segredo: string }) =>
    [r.nome, r.segredo]));
  if (!seg.vapid_public_key || !seg.vapid_private_key) {
    return json({ error: 'vapid_nao_configurado' }, 500);
  }
  webpush.setVapidDetails(
    seg.vapid_subject || 'mailto:breno@rbvcompany.com',
    seg.vapid_public_key, seg.vapid_private_key);

  // Só as fichas de HOJE contam como feito — igual ao quadro de cobrança em
  // tela-de-frota.vue: uma ficha de ontem não pode marcar o carro em dia por
  // engano o dia inteiro.
  const fichasDeHoje = (fichas.data || []).filter((f: { feita_em: string }) => f.feita_em === hoje);

  // A mesma função que decide quem o quadro de cobrança da tela mostra como
  // devedor, com `usos` pra aplicar D9b: quem está com o carro emprestado é
  // quem entra aqui, não o dono no papel.
  const linhas = quemFaltaHoje({
    veiculos: veiculos.data, fichasDeHoje, pessoas: pessoas.data, usos: usos.data,
  }).filter((l: { fez: boolean }) => !l.fez);

  const ultima = (veiculoId: string, cadencia: string) => {
    const l = (fichas.data || [])
      .filter((f: { veiculo_id: string; cadencias: string[] }) =>
        f.veiculo_id === veiculoId && (f.cadencias || []).includes(cadencia))
      .map((f: { feita_em: string }) => f.feita_em).sort();
    return l.length ? l[l.length - 1] : null;
  };

  let enviados = 0, podados = 0;
  for (const linha of linhas) {
    const v = linha.veiculo;
    const cadencias = cadenciasDoDia({
      hoje, config: cfg,
      ultimaSemanal: ultima(v.id, 'semanal'), ultimaMensal: ultima(v.id, 'mensal'),
    });
    if (!cadencias.length) continue;   // fim de semana

    // linha.donoId já veio de quemFaltaHoje() com D9b aplicado: é quem está
    // com o carro agora (posse aberta), e só na falta dela o dono fixo.
    const pessoa = (pessoas.data || []).find((p: { id: string }) => p.id === linha.donoId);
    // Quem loga por esta pessoa: o elo `profile_id` na frente, o e-mail
    // corporativo como resgate. A REGRA MORA EM _shared/quem-loga.js, a mesma
    // que a tela usa — antes eram duas, e elas discordavam: a tela reconhecia a
    // Raissa pelo e-mail e este laço a pulava por falta do elo, calado.
    const userId = loginDaPessoa(pessoa, usuarios.data);
    if (!userId) continue;   // sem login mesmo: contado abaixo, nunca em silêncio
    const dela = inscritos.filter((s: { user_id: string }) => String(s.user_id) === String(userId));
    if (!dela.length) continue;

    const aviso = montarAviso({ veiculo: v, itens: itensDaFicha(itens.data, cadencias), cadencias });
    const carga = JSON.stringify({ ...aviso, url: '/frota' });
    for (const s of dela) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga);
        enviados++;
      } catch (err: any) {
        // Inscrição morta (aparelho trocado, app desinstalado) some da
        // tabela, como faz o enviar-push-vendas.
        if (err?.statusCode === 410 || err?.statusCode === 404) {
          await sb.from('push_subs').delete().eq('endpoint', s.endpoint);
          podados++;
        }
      }
    }
  }
  // QUEM DEVIA O CHECKLIST HOJE E NÃO TEM COMO SER AVISADO. O defeito que este
  // arquivo acabou de corrigir não era pular a pessoa — era pular CALADO: a
  // função respondia "0 enviados" com cara de sucesso e ninguém descobria que
  // faltava alguém. Sai nomeado na resposta, que é o que a Saúde dos Robôs
  // guarda e o que quem investiga vai ler.
  const semAviso = pessoasSemLogin(
    linhas.map((l: { donoId: string }) =>
      (pessoas.data || []).find((p: { id: string }) => p.id === l.donoId)).filter(Boolean),
    usuarios.data,
  ).map((p: { nome: string }) => p.nome);

  return json({
    enviados, podados, hoje,
    ...(semAviso.length ? {
      sem_aviso: semAviso,
      motivo_sem_aviso: 'devem o checklist de hoje e não têm login no app — '
        + 'push nenhum alcança essas pessoas; cobrar pelo quadro da aba Gestão',
    } : {}),
  });
});
