# Pedidos da Loja Shopify direto da API, sem passar pelo Bling — design

Data: 03/10/2026. Estado: **rascunho para revisão do dono** (desenho aprovado em conversa; esta especificação ainda não).

## Objetivo

A "Loja Shopify" (`loja_id` 205512275 no Bling, grupo Varejo) tem seus pedidos lidos hoje
pelas telas de venda (Gestão à Vista, Análise de Vendas) através do Bling, igual a qualquer
outra loja. O dono quer parar de depender do Bling para esta loja específica e passar a
ler os pedidos direto da API da própria Shopify.

Achado relevante: todo pedido desta loja hoje cai num vendedor-placeholder chamado "Fábrica"
(`vendor_id` 15596565431) — não tem vendedora de verdade atribuída. Por isso esta fundação
NÃO precisa replicar a lógica de vendedor/forma-de-pagamento/troca construída para as outras
lojas (ver `2026-10-03-valor-liquido-de-troca-design.md`): é só total por dia, sem ranking de
pessoa.

## Decisões do dono (registradas em 03/10/2026)

- **Só daqui pra frente.** Sem backfill do histórico que já está no Bling — a mudança vale a
  partir do dia em que entrar no ar.
- **Mecanismo: robô periódico + webhook, os dois.** Webhook para velocidade, robô de hora em
  hora como rede de segurança — mesmo desenho de confiança que `trazer-pedidos-do-bling.mjs`
  já usa (varredura funda diária + conferência de hora em hora).
- **Tabela nova e isolada** (`shopify_pedidos`), não uma coluna `fonte` dentro de
  `vessel_pedidos` — menor risco de efeito colateral em quem já lê `vessel_pedidos`
  (Stylist Circle, `vessel_vendas_dos_encontros`).
- **Reaproveitar o `loja_id` 205512275** como identificador de canal também na tabela nova,
  para que o agrupamento por canal das telas não precise de nenhuma mudança — só o
  carregamento de dados ganha uma fonte a mais.

## Suposições a confirmar com o dono (assumidas no design, sinalizadas, não travadas)

- **O que conta como venda**: `financial_status` do pedido Shopify em `paid` ou
  `partially_refunded`. Fica de fora: `pending`, `refunded`, `voided`.
- **Dia da venda**: `created_at` do pedido (convertido para `America/Sao_Paulo`). A Shopify
  não tem o problema de defasagem de nota fiscal que o Bling tem (o gatilho da migration de
  `data-da-venda.js`), então não há correção de data equivalente aqui.
- **Troca/devolução** (a API de `refunds` da Shopify) fica **fora do escopo** desta fundação —
  pode entrar depois, no mesmo espírito do valor líquido de troca já feito para o Bling.

## Fora do escopo (agora)

- Qualquer mudança em como a Shopify hoje sincroniza (ou não) pedido para o Bling — se essa
  sincronização nativa existe fora deste repositório, ela não é desligada por este trabalho;
  só paramos de LER esta loja através do Bling nas nossas telas.
- Replicar vendedor/forma-de-pagamento/troca para pedidos Shopify (não há vendedora real
  atribuída a eles).
- Nota fiscal / emissão de NFe-NFCe para estes pedidos — client já trata isso por fora.
- Backfill de pedidos antigos.
- Stylist Circle / `vessel_pedidos` — esta loja não aparece lá hoje (vendedor "Fábrica" é
  filtrado pela própria regra de "vendedor que não é gente" em `vessel_ligar_vendedor`), e
  esta fundação não muda isso.

## Arquitetura

### 1. Tabela nova

```sql
create table public.shopify_pedidos (
  id                 bigint        primary key,  -- order id da própria Shopify
  numero             text,                        -- order_number / name (ex: "#1042")
  loja_id            bigint        not null default 205512275,
  total              numeric(12,2) not null,
  moeda              text          not null default 'BRL',
  status_financeiro  text          not null,      -- financial_status cru da Shopify
  cliente_nome       text,
  cliente_email      text,
  criado_em_shopify  timestamptz   not null,       -- created_at do pedido na Shopify
  bruto              jsonb         not null,       -- payload cru, para auditoria/replay
  atualizado_em      timestamptz   not null default now()
);
```

`bruto jsonb` guarda o payload inteiro: dado novo, formato que ainda não foi testado em
produção — melhor poder reprocessar um campo que o desenho inicial não previu do que ter que
pedir pra Shopify mandar de novo.

RLS no mesmo padrão das tabelas irmãs (`bling_pedido_nota`): leitura para `authenticated`,
restritiva por `pode_ver_canal(loja_id)` (que aqui é sempre 205512275), escrita só por
`service_role` (robô e webhook).

Índice por `criado_em_shopify` (leitura por faixa de dia, mesmo padrão de
`idx_bpn_data_da_venda`) e por `status_financeiro` (filtro de "o que conta como venda").

### 2. Robô (`coletor/trazer-pedidos-da-shopify.mjs`)

Busca `GET /admin/api/<versão>/orders.json?status=any&updated_at_min=<janela>`, paginado pelo
cabeçalho `Link` (padrão de paginação da Shopify, diferente da paginação por número de página
do Bling). Upsert por `id` do pedido. Mesmo cron do robô do Bling: varredura funda 1x por dia
+ conferência de janela curta de hora em hora.

### 3. Webhook (`supabase/functions/receber-webhook-pedido-shopify`)

Nova edge function, reaproveitando `verificar-webhook-shopify.js` (já existe, usado por
`receber-webhook-checkout`) para a verificação HMAC. Escuta o evento de pedido pago da
Shopify. Faz o mesmo upsert que o robô faz — não importa quem grava primeiro, a chave é o
`id` do pedido.

### 4. Telas (Gestão à Vista, Análise de Vendas)

No carregamento de cada tela:

1. **Filtra fora** qualquer pedido com `loja.id === 205512275` que vier da listagem AO VIVO
   do Bling — trava contra contagem em dobro, caso a Shopify ainda sincronize nativamente
   pedido para o Bling por fora deste código.
2. **Busca `shopify_pedidos`** do período (filtrado por `status_financeiro` conforme a regra
   acima) e constrói objetos no MESMO formato que um pedido do Bling já tem hoje
   (`{id, total, data, loja:{id:205512275}}`) — esses objetos entram no mesmo array `pedidos`
   ANTES de todo o resto do pipeline (soma por canal, ranking, etc.) rodar. Com isso, nenhuma
   lógica de soma ou renderização precisa mudar — só o carregamento ganha uma fonte extra.

### 5. Credenciais (a configurar pelo dono depois)

- Um token de app da Shopify (Admin API, escopo `read_orders`) e o domínio da loja
  (`*.myshopify.com`) — variáveis novas a definir (ex: `SHOPIFY_ADMIN_TOKEN`,
  `SHOPIFY_SHOP_DOMAIN`).
- Um segredo de webhook para o evento de pedido pago — pode reaproveitar
  `SHOPIFY_WEBHOOK_SECRET` já existente, ou a Shopify pode exigir um por webhook; confirmar
  no cadastro.

## Erros e teste

- Robô sem token configurado: lança e para a busca de pedidos da Shopify especificamente,
  sem afetar a importação de pedidos do Bling (são robôs separados).
- Webhook com assinatura inválida: `401`, mesmo padrão de `receber-webhook-checkout`.
- Página da Shopify que falha no meio: mesma postura de retry com backoff do robô do Bling.
- Teste da função pura que monta o objeto "pedido" a partir do payload cru da Shopify
  (inclusive o filtro de `status_financeiro`) com casos reais de payload.
- Teste do merge nas duas telas: pedido Bling de outra loja não é tocado; pedido Bling da
  loja 205512275 é descartado; pedido Shopify da loja 205512275 entra na soma.
