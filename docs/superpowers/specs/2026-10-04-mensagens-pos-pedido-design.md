# Mensagens de WhatsApp pós-pedido: pagamento, rastreio e entrega — design

Data: 04/10/2026. Estado: **pagamento confirmado implementado (PR #300); falta criar o template na Meta e publicar.
Rastreio e entrega seguem em "fora de escopo", arquitetura de disparo (fase 2) ainda não desenhada.**

**Acompanhamento do template na Meta (04/10/2026):** `pedido_pagamento_confirmado_v1` **ainda não existe** na
Meta (conferido com o dono). O payload já está pronto (categoria UTILIDADE, sem botão, `{{1}}` nome e `{{2}}`
número do pedido) em `supabase/functions/_shared/template-meta.js` (`TEMPLATE_PAGAMENTO`). Para criar e depois
acompanhar o status de aprovação:
```
node coletor/template-meta.mjs criar pagamento --enviar          # cria na Meta (precisa de META_WABA_ID/META_TOKEN)
node coletor/template-meta.mjs consultar pedido_pagamento_confirmado_v1  # status, categoria, motivo de recusa
```

## Motivação

Uma cliente pagou o pedido, o pedido foi separado e entregue, e não recebeu nenhuma mensagem depois da confirmação de
recebimento do pedido — nem aviso de pagamento, nem código de rastreio, nem confirmação de entrega. Hoje o único
momento em que a loja fala com a cliente sobre o pedido em si é "pedido recebido" (ver
`2026-09-30-fluxo-de-mensagens-design.md`), que o próprio doc já registra como fora de escopo para os demais estados
(linha "Fora do escopo (agora): Mensagem de pedido pago, enviado ou entregue").

Este doc fecha a primeira parte do trabalho: **o texto de cada mensagem nova**, decidido com o dono. A segunda parte —
de onde vem o dado que dispara cada uma (pagamento já chega via webhook; rastreio e entrega não têm fonte hoje) — é
objeto de um desenho à parte, ainda não iniciado.

## Decisões do dono (registradas em 04/10/2026)

- São **3 mensagens**, não 4: "pagamento confirmado" e "pedido fechado/separado" foram descartadas como mensagens
  separadas por ficarem ambíguas uma da outra — a confirmação de pagamento já cobre esse momento.
- Mesmo tom nas três: direto, sem emoji, categoria **utilidade** (como o `pedido_recebido_v1` já aprovado) — não
  "vendedora", nem na mensagem de entrega.
- Texto com quebra de linha, mais acolhedor que o `pedido_recebido_v1` atual (que é uma frase só); a mensagem de
  pagamento inclui parabenização pela compra.

## Os 3 modelos (a criar; a troca só entra depois de aprovados pela Meta)

| Modelo | Categoria | Dispara em | Corpo (proposto) |
|---|---|---|---|
| `pedido_pagamento_confirmado_v1` | UTILIDADE | `orders/paid` (webhook já chega hoje, só não é usado para isto) | Olá {{1}}!\n\nParabéns pela compra! Seu pagamento do pedido {{2}} foi confirmado e já estamos preparando tudo com carinho para o envio.\n\nEm breve você recebe o código de rastreio por aqui. |
| `pedido_rastreio_v1` | UTILIDADE | fulfillment com código de rastreio (fonte: **não existe hoje**, ver "Fora do escopo") | Seu pedido {{2}} já está a caminho!\n\nCódigo de rastreio: {{3}}\nAcompanhe em: {{4}}\n\nQualquer dúvida, é só chamar. |
| `pedido_entregue_v1` | UTILIDADE | confirmação de entrega pela transportadora (fonte: **não existe hoje**, ver "Fora do escopo") | Seu pedido {{2}} foi entregue!\n\nEsperamos que você ame cada detalhe.\n\nQualquer dúvida ou se precisar de algo, estamos por aqui. |

Regras do modelo de utilidade (herdadas do doc de 30/09): sem link comercial, sem promoção, sem convite à compra —
texto comercial faz a Meta reclassificar como marketing. O link de rastreio em `pedido_rastreio_v1` é informativo
(rastreio do próprio pedido), não promocional; a confirmar com a Meta na submissão se isso não muda a categoria.

## Fora do escopo (agora)

Tudo que é "de onde vem o dado que dispara a mensagem", exceto pagamento:

- **Pagamento confirmado**: já tem fonte (`orders/paid` no webhook existente), só falta ligar ao envio — mais perto
  de implementação direta que de desenho novo.
- **Código de rastreio**: não existe hoje nenhuma integração com transportadora/fulfillment que leia isso. Precisa de
  desenho: webhook `fulfillments/create` da Shopify (se a loja gera o fulfillment lá) ou outra fonte, a confirmar.
- **Confirmação de entrega**: não existe hoje. Não há webhook de transportadora nem consulta de status integrada.
  Precisa de desenho: Shopify pode repassar status "delivered" se o app de rastreio da loja atualizar o fulfillment,
  ou pode ser necessário consultar a transportadora diretamente — a confirmar antes de desenhar a arquitetura.
- Reaproveitamento (ou não) da fila genérica `mensagem_fila` (`db/migrations/2026-09-30-zzzzz-fila-de-mensagens.sql`),
  que já é parametrizada por `tipo` e pode receber `pagamento`, `rastreio`, `entrega` sem redesenho da fila em si.

## Perguntas em aberto (para o desenho da fase 2)

1. A loja usa algum app de rastreio/fulfillment na Shopify (ex. AfterShip, Melhor Envio) que já centraliza o status de
   entrega, ou isso precisa ser construído do zero contra a transportadora?
2. O código de rastreio é gerado no Bling, na Shopify, ou na transportadora diretamente? Isso decide se o gatilho é
   webhook da Shopify (`fulfillments/create`), leitura do Bling (como `coletor/trazer-pedidos-do-bling.mjs` já faz
   para outro fim) ou outra fonte.
3. Confirmação de entrega: existe assinatura/webhook de transportadora disponível, ou só dá para saber consultando
   API por pedido (custo de polling)?
