import { sbClient } from './conectar-no-banco-de-dados.js';

// VAPID pública (pode ficar no front; a privada vive só nos secrets do Supabase).
// TROCAR pelo valor real gerado na Task 6 antes do deploy.
export const VAPID_PUBLIC_KEY = 'BEsOWWqBquun-DMnYz5T-QktDlHhlxfzroM08dIFq1-bpz2JBcyPFk-ITSfLjwgTedXLQqhB-R0ihTCOxcLew1c';

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSuportado() {
  if (typeof window === 'undefined') return false;
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return false;
  // iOS só entrega push com o app na Tela de Início (standalone). Em aba do Safari
  // o PushManager existe mas o subscribe falha — não oferecemos o opt-in ali.
  const ehIOS = /iP(hone|ad|od)/.test(navigator.userAgent || '');
  const standalone = window.navigator.standalone === true ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);
  return !(ehIOS && !standalone);
}

export function permissaoAtual() {
  if (!pushSuportado()) return 'nao-suportado';
  return Notification.permission; // 'default' | 'granted' | 'denied'
}

export async function registrarSW() {
  return navigator.serviceWorker.register('/sw-push.js');
}

// ── Perguntar ou não perguntar ────────────────────────────────────────────
// Regra pedida pelo dono em 13/08/2026: "sempre está pedindo para ativar
// notificações; se o usuário ou o dispositivo já aceitou não precisa mostrar
// novamente". A regra antiga (`!inscrito && permissao !== 'denied'`) só calava
// com o navegador NEGANDO — quem fechava o convite era perguntado em toda
// abertura, para sempre.
//
// Duas peças puras, para poderem ser testadas sem navegador. A moldura decide
// o que fazer; aqui mora só o critério.
//
// `permissao === 'granted'` NUNCA pergunta: se o aparelho já autorizou, mostrar
// o convite é pedir uma coisa que já foi dada. Se por acaso não houver inscrição
// neste aparelho, o caminho é `deveInscreverEmSilencio` — com permissão dada, o
// navegador não abre prompt nenhum.
//
// `dispensou` é lembrado por aparelho (localStorage). Quem dispensou não perde
// nada: o botão de ativar continua no menu do avatar.
export function devePedirPush({ suportado = false, permissao = 'default', inscrito = false, dispensou = false } = {}) {
  if (!suportado) return false;
  if (permissao === 'granted' || permissao === 'denied') return false;
  if (inscrito) return false;
  if (dispensou) return false;
  return true;
}

export function deveInscreverEmSilencio({ suportado = false, permissao = 'default', inscrito = false } = {}) {
  return !!suportado && permissao === 'granted' && !inscrito;
}

export async function jaInscrito() {
  if (!pushSuportado()) return false;
  const reg = await navigator.serviceWorker.getRegistration('/sw-push.js');
  if (!reg) return false;
  const sub = await reg.pushManager.getSubscription();
  return !!sub;
}

// Quanto tempo esperar antes de desistir e DIZER que desistiu.
//
// Não é chute: os três passos depois da permissão — registrar o service worker,
// esperar ele ativar e assinar no serviço de push — dependem de rede e do
// navegador, e qualquer um deles pode simplesmente não voltar nunca.
// `navigator.serviceWorker.ready` é o pior deles: ele não rejeita, ele espera
// para sempre. Sem este limite, a tela ficava parada sem fim — que foi
// exatamente o que o dono viu no Windows em 13/08/2026.
const LIMITE_MS = 20000;

function comLimite(promessa, ms = LIMITE_MS) {
  let t;
  const relogio = new Promise((_ok, falha) => { t = setTimeout(() => falha(new Error('demorou')), ms); });
  return Promise.race([promessa, relogio]).finally(() => clearTimeout(t));
}

// Devolve `{ ok, motivo }` — e NÃO um booleano solto, como antes.
//
// O booleano era o defeito: negar, ignorar, estourar o tempo e falhar a
// gravação viravam todos `false`, e a tela fechava o convite sem dizer nada.
// Os motivos e as frases de cada um moram em `recado-do-push.js`.
export async function inscrever(userId) {
  if (!pushSuportado()) return { ok: false, motivo: 'nao-suportado' };
  let perm;
  try {
    perm = await Notification.requestPermission();
  } catch {
    // Navegador antigo com a versão de callback, ou chamada fora de gesto.
    perm = permissaoAtual();
  }
  if (perm === 'denied') return { ok: false, motivo: 'negado' };
  // 'default' aqui quer dizer que o navegador NÃO registrou resposta: ou não
  // chegou a perguntar (o modo silencioso do Chrome), ou a janelinha sumiu.
  // Não é a mesma coisa que negar, e a tela não pode tratar como se fosse.
  if (perm !== 'granted') return { ok: false, motivo: 'ignorado' };

  let sub;
  try {
    sub = await comLimite((async () => {
      const reg = await registrarSW();
      await navigator.serviceWorker.ready;
      return reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    })());
  } catch (e) {
    return { ok: false, motivo: e && e.message === 'demorou' ? 'demorou' : 'sem-inscricao' };
  }

  try {
    const j = sub.toJSON();
    const { error } = await comLimite(sbClient.from('push_subs').upsert({
      endpoint: j.endpoint,
      p256dh: j.keys.p256dh,
      auth: j.keys.auth,
      user_id: userId,
    }, { onConflict: 'endpoint' }));
    if (error) return { ok: false, motivo: 'nao-salvou' };
  } catch {
    return { ok: false, motivo: 'nao-salvou' };
  }
  return { ok: true, motivo: 'ok' };
}

// Avisa quando a permissão de notificação mudar POR FORA do app — que é
// justamente o caminho que funcionou para o dono: autorizar pelo ícone ao lado
// do endereço. Sem isto, a Central só percebia na próxima abertura.
// Devolve uma função para desligar o aviso, ou `null` onde não dá para observar.
export async function observarPermissao(aoMudar) {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null;
  try {
    const st = await navigator.permissions.query({ name: 'notifications' });
    const h = () => aoMudar(st.state);
    st.addEventListener('change', h);
    return () => st.removeEventListener('change', h);
  } catch {
    // Firefox antigo e Safari não sabem consultar esta permissão. Sem drama:
    // o caminho da próxima abertura continua existindo.
    return null;
  }
}

export async function desinscrever() {
  const reg = await navigator.serviceWorker.getRegistration('/sw-push.js');
  if (!reg) return;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const j = sub.toJSON();
  await sbClient.from('push_subs').delete().eq('endpoint', j.endpoint);
  await sub.unsubscribe();
}
