# Funil de Carrinho (Shopify)

**Data:** 17/09/2026
**Estado:** desenhado, aguardando plano de implementação.

---

## 1. O que foi pedido

O dono quer acompanhamento ponta a ponta do carrinho na loja Shopify: quais
produtos são mais colocados no carrinho, quais são mais removidos, e quais
carrinhos são abandonados **antes de entrar no checkout**. Confirmado no
desenho: a Shopify não expõe nada disso nativamente — o que ela chama de
"checkout abandonado" só existe a partir do momento em que a pessoa clica em
finalizar compra (webhook `checkouts/create`). Antes disso, adicionar/remover
item do carrinho não gera evento nenhum do lado da loja. A única forma de
enxergar esse trecho do funil é instrumentar o client-side.

## 2. Escopo desta entrega (MVP)

- **Uma loja Shopify só** (não é multi-loja).
- Três tipos de evento, todos garantidos pela Web Pixels API do Shopify:
  `produto_adicionado`, `produto_removido`, `checkout_iniciado`.
  - **Fora do MVP:** "carrinho visualizado" — cortado porque o Shopify não
    tem um evento nativo confiável de visualização de carrinho (a própria
    documentação já avisa que ele é instável).
  - **Fora do MVP:** valor em R$ parado no carrinho (só contagem/ranking por
    enquanto — "com o tempo vamos pensando em mais coisas", palavras do
    dono).
  - **Fora do MVP:** reconciliação com pedido de verdade (o Bling já é a
    fonte de venda confirmada; este funil cobre só o trecho pré-checkout).
- **Rate limit por IP** (60 eventos/minuto), não por `cart_token` — pedido
  explícito do dono, pra nunca acabar barrando um cliente real por conta de
  demanda alta.

## 3. Arquitetura

```
Loja Shopify (visitante anônimo)
   → Web Pixel Extension (código no repo, deploy via Shopify CLI)
   → escuta analytics.subscribe: product_added_to_cart,
     product_removed_from_cart, checkout_started
   → fetch() para Edge Function pública nova: capturar-evento-carrinho
        → valida payload + rate limit por IP
        → insere 1 linha crua em carrinho_eventos
   → Tela nova (ferramenta) lê carrinho_eventos + view carrinho_abandonados
```

Sem robô, sem fila, sem tabela intermediária de agregação: o pixel manda, a
function grava cru, a tela agrega na consulta. "Abandonado" é calculado por
uma view SQL relativa a `now()`, não por um job — decisão deliberada
(YAGNI): o volume de eventos de carrinho de uma loja não justifica
pré-calcular nada hoje. Se um dia a consulta ficar pesada, aí sim vira robô.

**Chave de agrupamento:** `cart_token`, o próprio identificador de carrinho
da Shopify — sobrevive a reload de página, não precisamos inventar sessão
nossa.

## 4. Modelo de dados

```sql
create table carrinho_eventos (
  id             bigint generated always as identity primary key,
  cart_token     text not null,
  tipo           text not null check (tipo in (
                   'produto_adicionado', 'produto_removido', 'checkout_iniciado'
                 )),
  produto_id     text,          -- null em checkout_iniciado
  produto_titulo text,
  variante_id    text,
  quantidade     int,
  preco          numeric,
  ip             text,          -- só pra rate limit; não exposto na tela
  criado_em      timestamptz not null default now()
);

create index on carrinho_eventos (cart_token, criado_em);
create index on carrinho_eventos (tipo, criado_em);
create index on carrinho_eventos (ip, criado_em);
```

```sql
create view carrinho_abandonados as
select cart_token, min(criado_em) as iniciado_em, max(criado_em) as ultimo_evento
from carrinho_eventos
where tipo = 'produto_adicionado'
group by cart_token
having not exists (
  select 1 from carrinho_eventos e2
  where e2.cart_token = carrinho_eventos.cart_token and e2.tipo = 'checkout_iniciado'
)
and max(criado_em) < now() - interval '30 minutes';
```

30 minutos é o padrão de mercado pra "abandonou" — ajustável depois se o
dono achar cedo/tarde demais; não é um número medido neste projeto.

**RLS:** só a Edge Function grava (chave de serviço). Leitura só pra quem já
é usuário logado da Central, mesma regra das outras tabelas. O pixel nunca
lê, só escreve.

## 5. Edge Function `capturar-evento-carrinho`

Primeira função do repo chamada por **visitante anônimo, sem login** — muda
o modelo de ameaça de toda a família de Edge Functions daqui:

- `verify_jwt` **desligado** (não existe usuário logado do lado de quem
  chama).
- CORS liberado só pro domínio da loja, nunca `*`.
- Valida à mão: `tipo` tem que ser um dos 3 valores aceitos, `cart_token`
  obrigatório e string; resto sanitizado via client parametrizado (nunca
  concatenação de string em SQL).
- **Rate limit por IP**: antes de gravar, conta quantos eventos aquele IP
  mandou no último minuto (`ip = $ip and criado_em > now() - interval '1
  minute'`); acima de 60, responde `429` e não grava. Não limita por
  `cart_token` — carrinho não é o alvo do abuso, IP é.
- Responde sempre genérico (`{ok:true}` / `{ok:false}`) — nunca ecoa erro de
  banco pro navegador do visitante.
- `ponytail:` nenhum outro tipo de defesa (captcha, WAF) — se aparecer abuso
  de verdade além do que o rate limit por IP resolve, revisar então.

## 6. Extensão Shopify (Web Pixel Extension)

Não é Node solto como o resto de `coletor/` — é o formato que o Shopify CLI
exige (`shopify app generate extension --type web_pixel_extension`), dentro
de um app próprio (não precisa ser Shopify Plus, não precisa ser um app
público/listado). Vive numa pasta nova de nível raiz (proposta:
`shopify-app/`).

```js
import { register } from "@shopify/web-pixels-extension";

register(({ analytics, init }) => {
  const enviar = (tipo, dados) =>
    fetch("https://<projeto>.supabase.co/functions/v1/capturar-evento-carrinho", {
      method: "POST",
      body: JSON.stringify({ tipo, cart_token: init.cart?.token, ...dados }),
    });

  analytics.subscribe("product_added_to_cart", (evento) => {
    const item = evento.data.cartLine;
    enviar("produto_adicionado", {
      produto_id: item.merchandise.product.id,
      produto_titulo: item.merchandise.product.title,
      variante_id: item.merchandise.id,
      quantidade: item.quantity,
      preco: item.cost.totalAmount.amount,
    });
  });

  analytics.subscribe("product_removed_from_cart", (evento) => { /* mesma forma */ });
  analytics.subscribe("checkout_started", () => enviar("checkout_iniciado", {}));
});
```

Publicação exige conta de parceiro Shopify (grátis) e um app "da casa"; o
cliente instala esse app na loja dele uma vez, com um clique.

## 7. Tela nova: `funil-carrinho`

`src/ferramentas/funil-carrinho/` (nome provisório, ajustável), seguindo o
padrão de pasta das outras ferramentas: `tela-de-funil-carrinho.vue` +
`carregamento-da-tela.js` (lógica pura das queries/agregações) + teste ao
lado + `LEIA-ME.txt`.

Três blocos, um assunto por bloco:

1. **Mais adicionados ao carrinho** — ranking por `produto_titulo`,
   contagem de `produto_adicionado` no período.
2. **Mais removidos** — mesmo ranking, `produto_removido`.
3. **Carrinhos abandonados** — lista/contagem vinda de
   `carrinho_abandonados`, filtrada por `iniciado_em` no período.

Filtro de período compartilhado no topo — reaproveitar o componente de
período já usado em Análise de Vendas, se existir, em vez de criar um novo.
Sem gráfico no MVP: tabela de ranking primeiro.

## 8. Testes

- `carregamento-da-tela.js`: lógica pura das 3 queries/agregações, testada
  com client Supabase mockado — mesmo padrão de
  `analise-vendas/carregamento-da-tela.test.mjs`.
- Edge Function: validação de payload (tipo aceito, `cart_token`
  obrigatório) e a regra de rate limit (60/min por IP, rejeita acima) — como
  função pura testável separada da parte de I/O, seguindo o padrão de
  `notas-bling.mjs` / `notas-bling.test.mjs` (lógica separada do robô,
  testada sem rede).
- `toda-edge-compila.test.mjs` já cobre a nova função automaticamente (é um
  teste de fábrica, roda sobre todas as pastas de `supabase/functions/`).
- Web Pixel Extension: sem teste automatizado — é plumbing fino (3
  `subscribe` chamando `fetch`), a lógica de verdade mora no servidor e essa
  já é testada. Verificação manual via o pixel debugger da própria Shopify
  antes de publicar.

## 9. Fora de escopo (registrado pra não reabrir depois)

- Robô de agregação (rejeitado — YAGNI, ver seção 3).
- "Carrinho visualizado" como evento (rejeitado — Shopify não garante).
- Valor em R$ parado no carrinho (adiado, dono já sabe).
- Reconciliação com pedido/venda confirmada (Bling já resolve isso).
- Rate limit por `cart_token` (rejeitado — dono pediu só por IP).
