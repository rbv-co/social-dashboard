# Leads do Chatwoot alimentando o OPR

24/09/2026. Pedido do dono: "cria um endpoint que vai receber do chatwoot
sempre que um lead chega e lead quente também, esse vai alimentar o
relatório com os dados corretos."

## Problema

Hoje "Leads Gerados" no OPR (`relatorio-diario-opr.js`) vem inteiramente da
própria Meta — a ação `onsite_conversion.messaging_conversation_started` do
anúncio, somada com `cadastros` de campanha objective=Leads. Isso mede
"o anúncio abriu uma conversa", não "chegou um lead de verdade na caixa do
Chatwoot" — e já achamos um caso real (22/09) em que o maior gerador de
conversa do dia era uma campanha de Tráfego, não de Leads.

"Leads Quentes" nunca teve fonte nenhuma — é `null` fixo, documentado como
"reservado pro Chatwoot" desde a spec original do OPR
(`2026-09-17-relatorio-opr-diario-design.md`).

## Decisão

Um serviço do lado do Chatwoot (`Custom::CrmEventWebhookService`, fora deste
repositório) manda um POST pra gente em dois momentos: conversa nova
(`lead_novo`) e conversa marcada com a etiqueta de "quente" por quem atende
(`lead_quente`). A gente grava cru e o OPR passa a contar por dia — sem
tentar prender o lead a uma campanha específica (mesmo espírito de "um
número só por dia" que já vale pro resto do relatório: CTR/CPM/Frequência
também não são por campanha).

Alternativa descartada: puxar da API do Chatwoot por polling (como a Meta é
lida hoje). Pra descobrir "virou quente" por polling seria preciso comparar
etiquetas a cada consulta pra achar a transição — mais frágil e mais
trabalho que simplesmente receber o evento na hora que ele acontece.

## Contrato do payload (definido do lado do Chatwoot, não deste repo)

```json
{
  "tipo": "lead_quente",
  "account_id": 1,
  "conversation_id": 4821,
  "conversation_display_id": 2887,
  "contact_id": 933,
  "contact_name": "Maria Silva",
  "contact_phone_number": "+5511999998888",
  "loja": "Loja Shopping XYZ",
  "classificacao_ia": "quente",
  "created_at": "2026-09-24T14:32:07-03:00"
}
```

`tipo` é `"lead_novo"` ou `"lead_quente"`. `loja` e `classificacao_ia` podem
vir `null`. Content-Type `application/json`, sem assinatura HMAC (Chatwoot
não assina webhook nativamente, diferente da Shopify) — autenticação por um
segredo fixo (`CHATWOOT_WEBHOOK_SEGREDO`) na própria URL
(`?token=<segredo>`), comparado em tempo constante.

## Tabela nova: `chatwoot_eventos`

Mesmo desenho de `carrinho_eventos`
(`db/migrations/2026-09-17-carrinho-eventos.sql`): evento cru, RLS
ligado, sem policy de insert (só a chave de serviço grava), select liberado
por permissão (`meta.opr`, a mesma que já guarda a tela do OPR).

Índice único em `(conversation_id, tipo)`: cada conversa conta **uma vez**
como `lead_novo` e **uma vez** como `lead_quente`, pra sempre — reenvio de
webhook (timeout, retry da Shopify... digo, do Chatwoot) ou etiqueta
removida/reaplicada não infla o número do relatório. Decisão: se a etiqueta
"quente" for removida e reaplicada de propósito (ex.: lead esfriou e
esquentou nos dois num mesmo dia), NÃO conta de novo. Avaliar se isso vira
problema na prática depois de rodar um tempo.

`dia_br` (data BRT) vem do `created_at` do payload, não do momento em que a
gente recebeu — é o que decide em qual dia do relatório o evento entra.

## Mudança no relatório (segunda entrega, NÃO nesta)

`calcularDadosOpr` passa a receber a contagem do dia
(`{ leadNovo, leadQuente }`) no lugar do cálculo via `conversas`/`cadastros`
da Meta:

- `header.leadsGerados` / `leadsEVendas.leads` = contagem de `lead_novo`.
- `leadsEVendas.leadsQuentes` = contagem de `lead_quente` (deixa de ser
  `null` fixo).
- `leadsEVendas.custoPorLead` = **investimento TOTAL do dia** ÷ leads —
  antes era só o investimento do balde Leads; deixou de fazer sentido
  porque o lead pode vir de qualquer tipo de campanha (confirmado pelo
  dono, 24/09/2026).

`vendas`/`compras`/`custoPorVenda` não mudam (continuam do pixel da Meta,
fora de escopo aqui).

## Ordem de entrega

1. **Esta entrega**: tabela + Edge Function `receber-webhook-chatwoot`,
   sem tocar no relatório. Dono testa com um POST de mentira, confirma que
   a linha aparece certa, configura as duas Automation Rules no Chatwoot
   (URL + segredo).
2. **Próxima entrega**: troca o relatório pra ler daqui — só depois de
   confirmar que o Chatwoot está mandando evento de verdade, pra não ficar
   um dia com "Leads Gerados = 0" só por falta de dado ainda chegando.
