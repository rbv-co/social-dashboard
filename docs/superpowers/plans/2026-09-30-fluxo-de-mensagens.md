# Fluxo de mensagens (pedido recebido, abandono 24 h, follow-up) Implementation Plan

> Execução inline, task a task, com TDD (teste vermelho antes do código). Marque `- [x]` ao concluir.

**Goal:** implementar o desenho de `docs/superpowers/specs/2026-09-30-fluxo-de-mensagens-design.md`.

**Architecture:** o robô de abandono que está no ar **não é refatorado**. Pedido e follow-up entram por uma fila genérica
nova (`mensagem_fila`) e um módulo novo (`rodada-da-fila.js`). O abandono só ganha um parâmetro (`p_max_horas`) para a troca
dos 10 min pelas 24 h ser configuração.

**Tech Stack:** Postgres/Supabase (pg_cron, RPC `security definer`), Edge Functions Deno, JS puro testado com `node --test`,
Chatwoot (API), Meta (modelos).

**Spec:** `docs/superpowers/specs/2026-09-30-fluxo-de-mensagens-design.md`

## Global Constraints

- Tudo novo nasce `desligado`: `ENVIO_MODO_PEDIDO` e `ENVIO_MODO_FOLLOWUP` vazios = não faz nada. O abandono de 10 min segue como está.
- Falha fechada: configuração inválida não toca em ninguém. Erro de leitura antes do envio **não envia**.
- Funções de escrita: `security definer`, `set search_path = public`, `revoke ... from public, anon, authenticated`, `grant ... to service_role`.
- Nada de `remove-funil-de-carrinho`: aplicar migrations só com script restrito.
- Baseline `npm test`: não subir o número de falhas em relação à `main`.

## Rulings (decisões de plano, com o custo se estiverem erradas)

- **R1: tabela genérica `mensagem_fila` (tipo, chave) para pedido e follow-up, em vez de colunas em `checkout_abandono`.**
  Menor diff, abandono intocado. Custo se errado: um segundo lugar onde o estado da mensagem mora.
- **R2: módulo novo `rodada-da-fila.js`, sem refatorar `rodada-de-mensagens.js`.** Custo: ~80 linhas parecidas nos dois.
  Preferido a arriscar o laço que está enviando a clientes.
- **R3: pedido só com `source_name = 'web'` e `test` falso** (a especificação diz "loja online"). Custo: pedido de outro canal não recebe.
- **R4: follow-up detecta resposta por qualquer mensagem recebida (`message_type` 0) entre as últimas 20 da conversa.** Quem tocou em
  "Não quero receber" (que chega como mensagem recebida) também não recebe o follow-up. Custo: resposta antiga fora das 20 últimas passa.
- **R5: `agendar_followups` roda a cada rodada da edge (só se o modo do follow-up não for desligado)**, sem cron novo.

## Tasks

### Task 1: SQL (fila genérica, follow-up, pedido, teto configurável do abandono)

**Files:**
- Create: `db/migrations/2026-09-30-zzzzz-fila-de-mensagens.sql`
- Create: `db/fila-de-mensagens.test.mjs` (Postgres descartável, como `db/abandono-sem-duplicidade.test.mjs`)

**Interfaces (produz):**
- `mensagem_fila(tipo text, chave text, numero text, nome text, telefone text, url_de_recuperacao text, conversa_origem bigint, criado_em timestamptz, mensagem_status text, mensagem_reservada_em, mensagem_enviada_em, mensagem_motivo, mensagem_tentativas int, chatwoot_conversation_id bigint)`, PK `(tipo, chave)`, `tipo in ('pedido','followup')`. RLS ligada, sem policy.
- `registrar_pedido_para_mensagem(p_pedido_id bigint, p_numero text, p_nome text, p_telefone text, p_criado_em timestamptz)` (idempotente).
- `cancelar_mensagem_pedido(p_pedido_id bigint)`: se ainda `null`, vira `ignorada / pedido_cancelado`.
- `agendar_followups(p_apos_horas int default 48, p_teto_horas int default 24) returns int`.
- `pegar_da_fila(p_tipo text, p_limite int, p_max_horas int, p_reservar boolean default true, p_ultimos11 text[] default null) returns setof mensagem_fila`.
- `marcar_da_fila(p_tipo text, p_chave text, p_status text, p_motivo text default null, p_conversa bigint default null)`, `devolver_da_fila(p_tipo text, p_chave text, p_contar boolean)`, `liberar_travadas_da_fila() returns int`.
- `candidatos_para_mensagem` e `pegar_para_mensagem` ganham `p_max_horas int default 24` (a assinatura antiga sai; senão a chamada com nomes fica ambígua).

**Casos de teste (SQL de verdade):**
- [ ] pedido: registrar duas vezes o mesmo `pedido_id` cria uma linha; dois pedidos do mesmo telefone são dois; `pegar_da_fila('pedido')` entrega ambos.
- [ ] pedido mais velho que `p_max_horas` não é entregue; cancelar antes do envio vira `ignorada / pedido_cancelado`; depois de `enviando` não muda.
- [ ] follow-up: só agenda checkout `fila_envio` com mensagem `enviada` entre 48 h e 72 h atrás; não agenda quem comprou, quem está em `pagamento_pendente` nem quem já tem follow-up; rodar duas vezes não duplica.
- [ ] follow-up: dois checkouts do mesmo telefone no mesmo lote entregam um só; telefone com follow-up `enviando` bloqueia.
- [ ] reserva: `p_reservar false` não grava nada; `marcar_da_fila` só finaliza quem está `enviando`; `devolver_da_fila` conta tentativa e esgota em 3; `liberar_travadas_da_fila` manda `enviando` há mais de 10 min para `falhou`.
- [ ] abandono: com `p_atraso_min = 1440` e `p_max_horas = 48`, elegível só entre 24 h e 48 h; sem parâmetros o comportamento de hoje (24 h) não muda.
- [ ] permissões: só `service_role` executa as funções novas; tabela sem acesso para `anon`/`authenticated`.

### Task 2: regras puras em JS

**Files:**
- Create: `supabase/functions/_shared/pedido-para-mensagem.js` + `.test.mjs` (`decidirPedido(topico, corpo)`)
- Modify: `supabase/functions/_shared/mensagem-de-abandono.js` + `.test.mjs` (`montarTemplateParamsPedido`, `validarConfigFila`)

**Interfaces (produz):**
- `decidirPedido(topico, corpo) -> {acao:'registrar_pedido', args:{p_pedido_id,p_numero,p_nome,p_telefone,p_criado_em}} | {acao:'cancelar_pedido', pedidoId} | {acao:'ignorar', motivo}`
  - `orders/create`: exige `id`, `source_name === 'web'`, `test !== true`, telefone (o mesmo critério do `decidir`); `orders/cancelled` cancela; o resto ignora.
- `montarTemplateParamsPedido({nomeTemplate, idioma, nome, numero}) -> {name, category:'UTILITY', language, processed_params:{body:{'1': primeiroNome, '2': numero}}}` (sem `buttons`).
- `validarConfigFila({modo, limite, templateNome, chatwoot, soPara, linkBase?, exigeLink})`: reaproveita `validarConfig` por tipo.

### Task 3: cliente do Chatwoot

**Files:** Modify `supabase/functions/_shared/cliente-chatwoot.js` + `.test.mjs`

**Interfaces (produz):** `respondeu({conversaId}) -> Promise<boolean>`: `GET /conversations/{id}/messages`, aceita `{payload:[...]}` ou lista, `true` se alguma tem `message_type === 0`. Erro vira `ErroChatwoot` (o passo é `ler_conversa`).

### Task 4: rodada da fila (pedido e follow-up)

**Files:** Create `supabase/functions/_shared/rodada-da-fila.js` + `.test.mjs`

**Interfaces (consome):** tasks 1 a 3. **(produz):** `processarFila({ sb, cliente, config, tipo, agora })` com `tipo` `'pedido' | 'followup'`.

- Pedido: telefone válido; janela 08:00–21:00 (fora: devolve sem contar); sem link; modelo de pedido; grava `enviada`.
- Follow-up: telefone válido, link de recuperação, janela; **relê** o status do checkout (`fila_envio`, senão `ignorada / nao_esta_mais_na_fila`); pergunta `respondeu` (sim: `ignorada / respondeu`; falhou a leitura: devolve contando tentativa); 401/403 para a rodada.
- Modo `seco` só lê; `lista` filtra por `soPara`; `ligado` envia. Configuração inválida: 500 e ninguém é tocado.

### Task 5: webhook grava pedido

**Files:** Modify `supabase/functions/_shared/aplicar-decisao.js` + `.test.mjs`, `supabase/functions/receber-webhook-abandono/index.ts`

- `aplicarPedido(sb, decisao)`: `registrar_pedido_para_mensagem` / `cancelar_mensagem_pedido`; erro de banco vira 500. O webhook roda a decisão do checkout **e** a do pedido; a resposta é 500 se qualquer uma falhar (ambas idempotentes).

### Task 6: abandono com teto configurável

**Files:** Modify `supabase/functions/_shared/rodada-de-mensagens.js` + `.test.mjs`

- `pegar_para_mensagem` recebe `p_max_horas: config.maxHoras` (padrão 24). O teste que confere os argumentos é atualizado.

### Task 7: edge e documentação

**Files:** Modify `supabase/functions/enviar-mensagem-abandono/index.ts`, `src/ferramentas/abandono-carrinho/LEIA-ME.txt`

- A edge faz as passadas abandono → pedido → follow-up (cada uma com o seu modo, segredos e limite), devolve o resultado combinado e o pior status. `agendar_followups` antes do follow-up. Segredos novos documentados.

### Task 8: modelos na Meta (via Chatwoot)

- `pedido_recebido_v1` (UTILIDADE, sem botões) e `abandono_curadoria_v1` (MARKETING, botões como o v3): criar, sincronizar e esperar `APPROVED`.
- **Follow-up:** só depois de o dono confirmar o texto.

### Task 9: publicar e validar

- Migration só a nova; publicar as duas edges com tudo novo `desligado`; validar cron 200. Depois pedido em `lista` (número do dono), então `ligado`; a troca do abandono por configuração; follow-up quando o modelo existir.
