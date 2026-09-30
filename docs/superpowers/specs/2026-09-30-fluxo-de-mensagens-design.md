# Fluxo de mensagens de WhatsApp: pedido recebido, abandono às 24 h e follow-up — design

Data: 30/09/2026. Estado: **rascunho para revisão do dono** (desenho aprovado em conversa; esta especificação ainda não).
Base: o robô de recuperação já em produção (`docs/superpowers/specs/2026-09-29-mensagem-de-abandono-design.md`) e o PR #290
(uma mensagem por telefone, compra por outro checkout, status relido no envio, 500 no webhook). **O #290 entra antes.**

## Objetivo

Trocar a mensagem única de 10 minutos por um fluxo de três mensagens, cada uma no seu momento e com o seu tom:

1. **Pedido criado** (utilidade): confirma que a loja recebeu o pedido. Curta.
2. **Checkout abandonado, 24 h depois** (marketing): tom de curadoria, no lugar da mensagem de 10 minutos.
3. **Follow-up do abandono** (marketing): segunda e última cobrança, se não comprou e não respondeu.

## Decisões do dono (registradas em 30/09/2026)

- A mensagem das 24 h **substitui** a de 10 minutos (uma só por abandono na primeira etapa).
- "Pedido criado" sai **ao criar o pedido** (`orders/create`), inclusive com Pix ou boleto pendente.
- O follow-up é **depois do abandono**.
- O robô atual (10 min) **continua ligado** até a troca.
- Consentimento e webhook de "Não quero receber" seguem **ignorados** (decisão anterior, ciente do risco à nota do número).

## Padrões adotados por mim (o dono não respondeu; corrigir aqui se discordar)

| Ponto | Padrão | Por quê |
|---|---|---|
| Prazo do follow-up | 48 h depois da mensagem de 24 h (≈ 72 h do abandono), uma vez | Dá tempo de a cliente decidir sem parecer insistência |
| Texto do abandono | ~~"ainda estão disponíveis"~~ **Decidido pelo dono em 30/09: "Nós reservamos sua bolsa"** | O dono afirma que reserva a bolsa. O texto cita "bolsa" fixo: se o carrinho tiver outro produto, a frase fica errada |
| Pedido: número do pedido | Inclui `{{2}}` (número do pedido) | Confirmação sem número parece mensagem genérica |
| Pedido: janela | Respeita 08:00–21:00 (espera até de manhã, teto de 14 h) | Confirmação às 23 h incomoda mais do que ajuda |
| Texto do follow-up | Ajuda, sem desconto e sem "última chance" (proposto abaixo) | Intenção real ainda não definida |

## Fora do escopo (agora)

- Tela: mostrar o estado do follow-up e a fila de pedidos. Nesta fase consulta-se pelo banco. Fica para a fase seguinte.
- Webhook de bloqueio, consentimento (decididos: ignorar).
- Mensagem de pedido pago, enviado ou entregue (só "recebido").
- Pedido pendente que não é Pix reabrindo em 35 min (achado 5 do review).

## Modelos da Meta (a criar; a troca só entra depois de aprovados)

Criados pela API do Chatwoot (`feat/template-com-botoes`), como o v3. Em português, `pt_BR`, parâmetros posicionais.

| Modelo | Categoria | Corpo (proposto) | Botões |
|---|---|---|---|
| `pedido_recebido_v1` | UTILIDADE | Olá, {{1}}, tudo bem? Já recebemos o seu pedido {{2}}. | nenhum |
| `abandono_curadoria_v3` (o v1 e o v2, submetidos antes, com outro texto ou botão, não serão usados) | MARKETING | Oi, {{1}}! Nós reservamos sua bolsa. Aconteceu alguma coisa? | "Finalizar compra" (URL dinâmica, índice 0), "Falar c/ personal shopper" (resposta rápida), "Não quero receber" (resposta rápida) |
| `abandono_followup_v1` | MARKETING | Oi, {{1}}! Passando para saber se ficou alguma dúvida sobre as peças que você escolheu. Se preferir, é só responder por aqui que a gente te ajuda. | "Finalizar compra" (URL dinâmica, índice 0), "Não quero receber" |

**Botão "Falar c/ personal shopper":** é uma resposta rápida da Meta. Ao tocar, o WhatsApp coloca o texto do botão como mensagem da
cliente na conversa do Chatwoot (caixa "Whatsapp Varejo"), sem automação: quem atende é a personal shopper. O texto do botão tem
no máximo 25 caracteres (a Meta recusou "Falar com personal shopper", 26, por isso "Falar c/ personal shopper", 25). As respostas rápidas ficam juntas, depois do botão de
link, que precisa continuar sendo o primeiro. Como qualquer mensagem recebida conta como "respondeu", quem toca no botão também
não recebe o follow-up.

Regras do modelo de utilidade: sem link, sem promoção, sem convite à compra. Texto comercial faz a Meta reclassificar
como marketing (mais caro e sujeito ao teto de marketing).

## Arquitetura

Uma única edge (`enviar-mensagem-abandono`, cron a cada minuto) passa a fazer **três passadas por rodada**, na ordem
pedido → abandono → follow-up, cada uma com o seu modo, o seu limite e o seu modelo. Reaproveita `processarRodada`
(reserva, janela, Chatwoot, falha fechada) parametrizada por tipo, em vez de três robôs.

```
webhook orders/create ─► registrar_pedido_para_mensagem ─► mensagem_pedido ──┐
webhook checkouts/*   ─► checkout_abandono (fila_envio) ─► 24 h ─────────────┼─► edge (3 passadas) ─► Chatwoot ─► Meta
                                                        └► +48 h, sem compra, sem resposta ┘
```

## Dados

- `checkout_abandono` ganha o estado do follow-up, com o mesmo formato do da mensagem:
  `followup_status` (null | enviando | enviada | falhou | ignorada), `followup_reservada_em`, `followup_enviada_em`,
  `followup_motivo`, `followup_tentativas`.
- Tabela nova `mensagem_pedido` (RLS ligada, sem policy, só o service role): `pedido_id bigint` (chave; o id do pedido na
  Shopify, o que torna o reenvio do webhook inofensivo), `numero text`, `nome`, `telefone`, `criado_em`, e o mesmo estado
  (`mensagem_status`, reservada em, enviada em, motivo, tentativas, conversa do Chatwoot).
- Funções (todas `security definer`, `search_path` fixo, só o `service_role`):
  - `registrar_pedido_para_mensagem(p_pedido_id, p_numero, p_nome, p_telefone, p_criado_em)`: idempotente.
  - `cancelar_mensagem_pedido(p_pedido_id)`: se ainda não saiu, vira `ignorada / pedido_cancelado`.
  - `pegar_pedidos_para_mensagem(...)`, `pegar_para_followup(...)`, mais `marcar_*` e `devolver_*` por tipo (ou as
    atuais generalizadas por tipo; decidir no plano pelo menor diff).
  - `pegar_para_mensagem` ganha o teto em parâmetro (hoje fixo em 24 h): o abandono passa a ser elegível entre 24 h e 48 h
    depois de entrar na fila. Antes de 24 h ninguém entra; depois de 48 h ninguém recebe (a fila velha nunca é
    mensageada, como hoje).

## Regras por tipo

**Pedido criado**
- Só pedido da loja online com celular BR válido. Pedido de teste (`test: true`) é ignorado.
- Uma vez por pedido. Cap de 14 h desde a criação (pedido mais velho nunca recebe).
- Fora da janela 08:00–21:00 espera. Pedido cancelado antes do envio não recebe.
- Não conta na regra de "uma mensagem por telefone em 7 dias" (é transacional).
- Se a mesma pessoa criar dois pedidos, recebe uma confirmação por pedido.

**Abandono às 24 h**
- Igual ao robô atual (celular válido, janela, link de recuperação, um por telefone em 7 dias, status relido no envio),
  com elegibilidade entre 24 h e 48 h depois de `fila_envio_em` e o modelo `abandono_curadoria_v3`.
- Quem já recebeu a mensagem antiga de 10 min não recebe esta (regra de telefone do #290).

**Follow-up**
- Elegível se: `mensagem_status = 'enviada'` há 48 h ou mais (teto de 24 h depois disso), checkout ainda em
  `fila_envio` (não comprou, não está em pagamento pendente) e `followup_status is null`.
- **Não envia se a cliente respondeu.** Antes de enviar, lê a conversa no Chatwoot (`chatwoot_conversation_id`); se há
  mensagem recebida depois da nossa, vira `ignorada / respondeu`. Falha na leitura **não envia** (devolve contando
  tentativa; na terceira, `falhou`). Falha fechada.
- Uma vez por checkout. Mesma janela 08:00–21:00.

## Travas de segurança (herdadas e novas)

- Falha fechada na configuração (`validarConfig` cobre os três modelos e os três modos).
- Modo por tipo (`desligado | seco | lista | ligado`), para ligar um de cada vez. `lista` usa `ENVIO_SO_PARA`.
- Reserva com `for update skip locked` e lock por passada; `enviando` travado há mais de 10 min vira `falhou`.
- Limite por rodada por tipo.

## Configuração (segredos do Supabase)

Novos: `ENVIO_MODO_PEDIDO`, `ENVIO_MODO_FOLLOWUP`, `TEMPLATE_PEDIDO`, `TEMPLATE_FOLLOWUP`, `TEMPLATE_TEXTO_PEDIDO`,
`TEMPLATE_TEXTO_FOLLOWUP`, `ENVIO_MAX_HORAS` (48), `FOLLOWUP_APOS_HORAS` (48). Existentes que mudam na troca:
`ENVIO_ATRASO_MINUTOS` (0 → 1440) e `TEMPLATE_NOME` (v3 → `abandono_curadoria_v3`).
**Isso torna obsoleto o ajuste `ENVIO_ATRASO_MINUTOS=3` pedido antes**: a troca leva o valor a 1440.

## Implantação (ordem)

1. Merge do #290 e aplicar a migration dele.
2. Criar os três modelos e esperar a aprovação da Meta.
3. Publicar migration e edge desta fase com tudo novo em `desligado` (o robô de 10 min segue como está).
4. `pedido` em `lista` (número do dono) → validar → `ligado`.
5. Troca do abandono: `ENVIO_ATRASO_MINUTOS=1440`, `ENVIO_MAX_HORAS=48`, `TEMPLATE_NOME` novo. Ninguém recebe nada novo por 24 h; é esperado.
6. Follow-up em `lista` → validar → `ligado`.

## Testes

- SQL contra Postgres descartável (padrão de `db/abandono-sem-duplicidade.test.mjs`): elegibilidade de cada passada
  (janelas 24–48 h e 48–72 h), idempotência do pedido, cancelamento, "uma por telefone", reserva sem duplicar.
- JS com `sb` e `cliente` injetados: modelo certo por tipo, corpo `{1: nome, 2: numero}` sem botões no pedido,
  resposta detectada não envia, leitura da conversa falhando não envia, falha de config barra tudo.
- `npm test`: não subir o número de falhas em relação à `main`.

## Riscos

- **A Meta pode reclassificar o modelo de pedido como marketing** se o texto parecer comercial. Mantê-lo seco.
- **"Recebemos o seu pedido" com Pix pendente** pode ser lido como pago. Aceito pelo dono; a frase não diz "pago".
- **Nota do número:** passa a haver até três mensagens por pessoa (pedido, 24 h, follow-up). O follow-up é o de maior
  risco de denúncia; o "Não quero receber" não bloqueia ninguém (decisão do dono).
- **Atendimento:** respostas chegam à caixa "Whatsapp Varejo"; alguém precisa atender.
- **Troca do abandono:** quem recebeu a de 10 min e nunca a de 24 h ainda pode receber o follow-up 48 h depois da antiga.
  Aceito, custo baixo.
- **Quem cria o pedido por telefone/PDV** sem celular válido não recebe; comportamento esperado.

## Perguntas em aberto

1. Intenção e texto finais do follow-up (o proposto é só ajuda). Prazo de 48 h serve?
2. O estoque é reservado de fato? Se for, o abandono pode dizer "reservado".
3. Pedido: incluir o número do pedido e respeitar a janela (padrões acima) está certo?
4. Pedido criado em admin/PDV com celular válido também recebe, ou só o da loja online?

## NÃO verificado (a confirmar antes de depender)

- Que a API do Chatwoot permite listar as mensagens de uma conversa e distinguir a mensagem recebida da enviada
  (`GET /api/v1/accounts/{id}/conversations/{id}/messages`, `message_type`). A confirmar no fork antes de implementar o follow-up.
- Que o `orders/create` traz `phone`, `shipping_address.phone`, `source_name` e `test` como esperado (o `decidir` atual já lê
  os telefones; `source_name` e `test` ainda não).
- Tempo de aprovação da Meta para o modelo de utilidade.
