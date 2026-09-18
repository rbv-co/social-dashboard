// ESTA É A VERSÃO QUE RODA DE VERDADE — colada em Configurações → Customer
// events → Add custom pixel, no admin da loja Vessel Brasil.
//
// POR QUÊ ISTO EXISTE FORA DO extensions/pixel-carrinho/ (App Extension):
// o caminho de App Extension (funil-carrinho-pixel/) foi escrito, publicado
// (`shopify app deploy`) e confirmado correto — mas instalar exige um OAuth
// contra um `application_url` de verdade, e este app não tem backend
// hospedado nenhum (não precisa, pra um pixel só). `shopify app dev` também
// não aceita a loja de produção sem ela estar marcada como loja de
// desenvolvimento na organização. Sem hospedar um servidor só pra completar
// esse handshake, a instalação não sai do `example.com` do template.
//
// Trocado para Custom Pixel: mesma API (analytics/browser), mesmo
// comportamento, zero infraestrutura — só que colado direto no admin, fora
// do git. É exatamente por isso que o desenho original preferia a App
// Extension (código versionado e testado); ficou registrado como corte
// deliberado, não esquecimento — ver
// docs/superpowers/specs/2026-09-17-funil-carrinho-shopify-design.md §6.
//
// DIFERENÇA DE SINTAXE (só isso muda): Custom Pixel roda num sandbox "lax"
// (não "strict") e a Shopify já entrega `analytics`/`browser` prontos,
// sem `import` nem `register(...)` — colar exatamente como está abaixo,
// sem editar as duas primeiras linhas de código.
//
// QUALQUER MUDANÇA FUTURA: editar aqui E colar de novo no admin — os dois
// lados não se sincronizam sozinhos.

const URL_DA_EDGE = 'https://kounqtdoioootxqegkij.supabase.co/functions/v1/capturar-evento-carrinho';
const CHAVE_DO_ID = 'rbv_carrinho_id';

// NÃO usar init.data.cart.id: `init` é só uma FOTO tirada no carregamento
// da página (doc oficial: "a snapshot of the page at time of page
// render"), nunca atualiza. No primeiro "adicionar ao carrinho" da sessão,
// o carrinho ainda não existia quando a página carregou — init.data.cart
// vinha `null`, e cart_token saía undefined bem no evento mais importante
// do funil.
//
// Em vez de depender do carrinho da Shopify, geramos e guardamos o NOSSO
// próprio identificador por navegador, com browser.localStorage (API
// padrão do Web Pixel). `crypto.randomUUID()` foi descartado depois de
// conferir a doc: não está na lista de globais garantidos (mesmo estando
// num sandbox mais aberto aqui, Math/Date bastam e não dependem de sandbox
// nenhum).
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
