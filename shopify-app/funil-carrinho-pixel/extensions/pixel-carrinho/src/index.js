// O PIXEL DA LOJA. Roda no navegador do visitante (sandbox da Shopify),
// escuta os três eventos do MVP e manda cada um pra
// capturar-evento-carrinho. Sem lógica de negócio aqui — quem valida e decide
// é a Edge Function (Task 3). Ver spec
// docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md.
import { register } from '@shopify/web-pixels-extension';

const URL_DA_EDGE = 'https://kounqtdoioootxqegkij.supabase.co/functions/v1/capturar-evento-carrinho';

register(({ analytics, init }) => {
  // O tipo Cart da Web Pixels API não tem campo "token" (isso é da Cart AJAX
  // API, outra API) — o identificador aqui é `id`, um GID
  // (gid://shopify/Cart/...). Confirmado na doc oficial antes de escrever
  // isto: https://shopify.dev/docs/api/web-pixels-api/standard-api/init.
  const cartId = () => init?.data?.cart?.id;

  const enviar = (tipo, dados = {}) => {
    fetch(URL_DA_EDGE, {
      method: 'POST',
      body: JSON.stringify({ tipo, cart_token: cartId(), ...dados }),
    }).catch(() => {
      // Falha de rede do lado do visitante nunca deve aparecer pra ele —
      // é telemetria, não é o fluxo de compra. Silenciada de propósito.
    });
  };

  analytics.subscribe('product_added_to_cart', (evento) => {
    const item = evento.data.cartLine;
    if (!item) return; // cartLine é nullable na doc oficial; sem isto o evento derruba o pixel
    enviar('produto_adicionado', {
      produto_id: item.merchandise.product.id,
      produto_titulo: item.merchandise.product.title,
      variante_id: item.merchandise.id,
      quantidade: item.quantity,
      preco: item.cost.totalAmount.amount,
    });
  });

  analytics.subscribe('product_removed_from_cart', (evento) => {
    const item = evento.data.cartLine;
    if (!item) return; // cartLine é nullable na doc oficial; sem isto o evento derruba o pixel
    enviar('produto_removido', {
      produto_id: item.merchandise.product.id,
      produto_titulo: item.merchandise.product.title,
      variante_id: item.merchandise.id,
      quantidade: item.quantity,
      preco: item.cost.totalAmount.amount,
    });
  });

  analytics.subscribe('checkout_started', () => enviar('checkout_iniciado'));
});
