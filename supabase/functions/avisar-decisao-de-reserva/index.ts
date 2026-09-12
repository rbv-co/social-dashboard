// supabase/functions/avisar-decisao-de-reserva/index.ts
//
// Avisa no celular de quem PEDIU o carro que a reserva dele foi decidida.
//
// POR QUE ISTO EXISTE. Medido em 20/08/2026: aprovar ou recusar uma reserva é
// um UPDATE e nada mais — não sai push, não sai e-mail. Quem pediu o carro só
// descobre a resposta se abrir o aplicativo e olhar em "Seus pedidos". E quem
// recusa é OBRIGADO pela tela a escrever o motivo ("quem pediu precisa saber o
// que fazer diferente"), motivo esse que ficava esperando alguém passar por
// ele. Alcance medido no mesmo dia: das 14 pessoas que podem pedir carro, 8
// têm aparelho registrado para push — mais do que qualquer outro canal
// (WhatsApp alcançaria 6, e 2 delas nem ficha de colaborador têm).
//
// QUEM MANDA NÃO ESCOLHE O TEXTO. A função recebe só o id da requisição; o
// conteúdo do aviso sai do que está GRAVADO no banco. Aceitar título e corpo
// do cliente transformaria isto num jeito de mandar push arbitrário para o
// celular de qualquer pessoa da empresa.
//
// A PERMISSÃO É CONFERIDA AQUI, no servidor, e não só na tela: quem chama
// precisa ter `frota.aprovar` ou ser superadmin — as mesmas chaves que a tela
// exige para mostrar os botões Aprovar e Recusar.
//
// FALHAR AQUI NÃO DESFAZ NADA. A decisão já está gravada quando esta função é
// chamada; se o push não sair, a resposta diz por quê e a tela segue em frente.
// Um aviso que não foi entregue é ruim; uma aprovação que se perde porque o
// aviso falhou é pior.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';
import { inscricoesDoTipo } from '../_shared/notificacoes.js';
import { montarAvisoDeReserva } from '../_shared/aviso-de-reserva.js';
import { loginDaPessoa } from '../_shared/quem-loga.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return json({ ok: false, erro: 'sem_sessao' }, 401);

    const comToken = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: erroUser } = await comToken.auth.getUser();
    if (erroUser || !user?.id) return json({ ok: false, erro: 'sem_sessao' }, 401);

    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Quem chamou pode mesmo decidir reserva? A tela já esconde os botões, mas
    // esconder botão não é portão: a função é alcançável direto.
    const { data: quemChamou } = await sb.from('profiles')
      .select('is_superadmin,permissions').eq('id', user.id).maybeSingle();
    const chaves = (quemChamou?.permissions || {})['frota.aprovar'] || [];
    const podeDecidir = !!quemChamou?.is_superadmin || (Array.isArray(chaves) && chaves.includes('ver'));
    if (!podeDecidir) return json({ ok: false, erro: 'sem_permissao' }, 403);

    let requisicaoId = '';
    try { requisicaoId = String((await req.json())?.requisicaoId || ''); } catch { /* corpo inválido */ }
    if (!requisicaoId) return json({ ok: false, erro: 'sem_requisicao' }, 400);

    const { data: r } = await sb.from('frota_requisicoes')
      .select('*').eq('id', requisicaoId).maybeSingle();
    if (!r) return json({ ok: false, erro: 'requisicao_nao_encontrada' }, 404);

    const { data: veiculo } = await sb.from('frota_veiculos')
      .select('id,nome').eq('id', r.veiculo_id).maybeSingle();

    // O texto sai do que está gravado. Situação que não é decisão devolve
    // `null` e não vira aviso nenhum.
    const aviso = montarAvisoDeReserva({ requisicao: r, veiculo });
    if (!aviso) return json({ ok: true, enviados: 0, motivo: 'situacao_nao_avisavel', situacao: r.situacao });

    // Quem PEDIU. `pessoa_id` na frente; `criada_por` como resgate, para o
    // pedido que a Gestão abriu em nome de outra pessoa — nesse caso quem
    // espera a resposta é quem abriu.
    let userIdDestino: string | null = null;
    if (r.pessoa_id) {
      const [{ data: pessoa }, { data: usuarios }] = await Promise.all([
        sb.from('acessos_pessoas').select('id,nome,profile_id,email_corporativo').eq('id', r.pessoa_id).maybeSingle(),
        sb.from('profiles').select('id,email'),
      ]);
      userIdDestino = pessoa ? loginDaPessoa(pessoa, usuarios) : null;
    }
    if (!userIdDestino) userIdDestino = r.criada_por || null;
    if (!userIdDestino) {
      // Sai NOMEADO, nunca em silêncio: "0 enviados" com cara de sucesso é como
      // se descobre tarde demais que ninguém foi avisado.
      return json({ ok: true, enviados: 0, motivo: 'quem_pediu_nao_tem_login', pessoa: r.pessoa_nome || null });
    }
    // Quem decide a própria reserva não precisa de push de si mesmo.
    if (String(userIdDestino) === String(user.id)) {
      return json({ ok: true, enviados: 0, motivo: 'decidiu_a_propria' });
    }

    const [{ data: subs }, { data: prefs }] = await Promise.all([
      sb.from('push_subs').select('endpoint,p256dh,auth,user_id').eq('user_id', userIdDestino),
      sb.from('push_preferencias').select('user_id,tipo,ativo').eq('user_id', userIdDestino),
    ]);
    const inscritos = inscricoesDoTipo(subs || [], prefs || [], 'frota_reserva');
    if (!inscritos.length) {
      return json({ ok: true, enviados: 0, motivo: 'sem_aparelho_ou_aviso_desligado' });
    }

    // O VAPID VEM DA TABELA `segredos_de_cron`, NÃO de variável de ambiente.
    // A primeira versão desta função lia `Deno.env` — que é o jeito comum em
    // outros projetos e está ERRADO neste: as chaves nunca foram gravadas como
    // secret, então `setVapidDetails` receberia `undefined` e todo envio
    // morreria com 500. Passou despercebido porque a prova ao vivo parou no
    // portão de permissão, três linhas antes daqui. É o mesmo padrão do
    // enviar-push-frota e do enviar-push-vendas; a tabela tem RLS ligada e
    // zero policies, então só o service role lê.
    const { data: segr } = await sb.from('segredos_de_cron').select('nome,segredo')
      .in('nome', ['vapid_public_key', 'vapid_private_key', 'vapid_subject']);
    const seg = Object.fromEntries((segr || []).map((r: { nome: string; segredo: string }) =>
      [r.nome, r.segredo]));
    if (!seg.vapid_public_key || !seg.vapid_private_key) {
      // Nunca `ok: true` com zero enviados aqui: isso é defeito de
      // configuração, e a tela precisa mandar avisar a pessoa pessoalmente.
      return json({ ok: false, erro: 'vapid_nao_configurado' }, 500);
    }
    webpush.setVapidDetails(
      seg.vapid_subject || 'mailto:breno@rbvcompany.com',
      seg.vapid_public_key, seg.vapid_private_key);
    const carga = JSON.stringify(aviso);
    let enviados = 0, podados = 0;
    for (const s of inscritos) {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, carga);
        enviados++;
      } catch (err) {
        // Inscrição morta (aparelho trocado, app desinstalado) some da tabela,
        // como as outras funções de push desta base já fazem.
        const st = (err as { statusCode?: number })?.statusCode;
        if (st === 410 || st === 404) {
          await sb.from('push_subs').delete().eq('endpoint', s.endpoint);
          podados++;
        }
      }
    }
    return json({ ok: true, enviados, podados, situacao: r.situacao });
  } catch (e) {
    // Nunca uma exceção crua: o navegador mostraria como erro de CORS e
    // esconderia a causa.
    return json({ ok: false, erro: String((e as Error)?.message || e) }, 500);
  }
});
