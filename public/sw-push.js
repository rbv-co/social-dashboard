// public/sw-push.js
// Service worker MÍNIMO só para Web Push. NÃO cacheia nada (evita servir index.html
// velho — gotcha de PWA já visto no erickIA). Ativa na hora.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch { d = {}; }
  const title = d.title || 'Vendas de hoje';
  const options = {
    body: d.body || '',
    tag: d.tag || 'vendas-do-dia',
    renotify: true,
    // O ícone e o EMBLEMA do aviso. O emblema é desenhado bem pequeno (na barra
    // de status do Android é um risco de ~24px), e ali o logotipo inteiro não
    // aparecia — mesmo motivo do favicon, corrigido em 13/08/2026.
    icon: '/midia/icone-192.png',
    badge: '/midia/icone-48.png',
    data: { url: d.url || '/gestao-vista' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/gestao-vista';
  event.waitUntil((async () => {
    const clientsArr = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientsArr) {
      if ('focus' in c) { c.navigate(url); return c.focus(); }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
