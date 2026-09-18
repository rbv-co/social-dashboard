// O PIXEL DA LOJA. Roda no navegador do visitante (sandbox da Shopify),
// escuta os três eventos do MVP e manda cada um pra
// capturar-evento-carrinho. Sem lógica de negócio aqui — quem valida e decide
// é a Edge Function (Task 3). Ver spec
// docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md.
import { register } from '@shopify/web-pixels-extension';

const URL_DA_EDGE = 'https://kounqtdoioootxqegkij.supabase.co/functions/v1/capturar-evento-carrinho';
const CHAVE_DO_ID = 'rbv_carrinho_id';

register(({ analytics, browser }) => {
  // NÃO usar init.data.cart.id: `init` é só uma FOTO tirada no carregamento
  // da página (doc oficial: "a snapshot of the page at time of page
  // render"), nunca atualiza. No primeiro "adicionar ao carrinho" da
  // sessão, o carrinho ainda não existia quando a página carregou —
  // init.data.cart vinha `null`, e cart_token saía undefined bem no evento
  // mais importante do funil. Corrigido depois de revisão que pegou isso.
  //
  // Em vez de depender do carrinho da Shopify, geramos e guardamos o NOSSO
  // próprio identificador por navegador, com o localStorage do próprio Web
  // Pixel (`browser.localStorage`, acesso padrão da API — doc:
  // https://shopify.dev/docs/api/web-pixels-api/standard-api/browser).
  // Sempre disponível desde o primeiro evento, e persiste entre páginas do
  // mesmo jeito que o cookie de carrinho da Shopify persistiria.
  // `crypto` NÃO está na lista de globais garantidos do sandbox estrito
  // (só self, console, setTimeout/clearInterval e fetch são garantidos —
  // doc oficial: https://shopify.dev/docs/apps/build/marketing/pixels).
  // `crypto.randomUUID()` quebraria aqui. Math/Date são da linguagem, não
  // API de navegador, e por isso continuam garantidos.
  const gerarId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

  let idEmCache = null;
  const cartId = async () => {
    if (idEmCache) return idEmCache;
    const existente = await browser.localStorage.getItem(CHAVE_DO_ID);
    if (existente) { idEmCache = existente; return existente; }
    const novo = gerarId();
    await browser.localStorage.setItem(CHAVE_DO_ID, novo);
    idEmCache = novo;
    return novo;
  };

  const enviar = (tipo, dados = {}) => {
    cartId()
      .then((cart_token) => fetch(URL_DA_EDGE, {
        method: 'POST',
        body: JSON.stringify({ tipo, cart_token, ...dados }),
      }))
      .catch(() => {
        // Falha de rede ou de storage do lado do visitante nunca deve
        // aparecer pra ele — é telemetria, não é o fluxo de compra.
        // Silenciada de propósito.
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
