# Mensagem de recuperação de checkout (WhatsApp, via Chatwoot) — design

Rascunho para revisão · 29/09/2026 · depende da fila de abandono (PRs #276–#282, já em produção).

## Objetivo

Quem entrou na **Fila de mensagens** (checkout com contato, 10 min sem evento, sem compra) recebe **uma** mensagem de WhatsApp com o link para finalizar. Sucesso: o lead volta e compra, sem receber a mesma mensagem duas vezes e sem mensagem para quem já comprou.

## Decisões do dono (registradas)

- **Consentimento: enviar sem registrar aceite** (decidido em 29/09/2026, depois de o risco ser explicado: a Meta exige opt-in para mensagem de marketing; sem ele a nota de qualidade do número pode cair e o número ser limitado ou bloqueado). Por isso **este design não guarda aceite**. O robô nasce **desligado**, com travas (abaixo).
- Canal: **WhatsApp oficial (Cloud API da Meta)**, dentro do Chatwoot. Só sai mensagem com **template aprovado pela Meta**.

## Fora do escopo (agora)

Nome do produto no texto (a fila não guarda os itens), cupom, mais de uma mensagem por checkout, e-mail como canal, guardar o aceite do cliente.

## O que já existe

`checkout_abandono` com status `aguardando | pagamento_pendente | fila_envio | comprou`. `fila_envio` **é a "Fila de mensagens"** (o nome interno não mudou de propósito: `fila_envio`, `fila_envio_em`, `filaEnvio`). Um checkout volta para `fila_envio` também quando um Pix expira e ele já tinha ido antes.

## Verificado no código do Chatwoot (`/lavessel/chatwoot`)

- A mensagem aceita `template_params: { name, category, language, namespace?, processed_params }` (`app/models/message.rb`, `builders/messages/message_builder.rb`).
- `processed_params` no formato por componente: `{ "body": {"1": "Ana"}, "buttons": [{"type":"url","parameter":"<sufixo>"}] }`. Botão de resposta rápida não leva parâmetro (`services/whatsapp/template_processor_service.rb`).
- ⚠️ **O template só é enviado se estiver `approved` e sincronizado no canal, com o mesmo `language`** (`find_template`). Template não aprovado ou com idioma diferente: a mensagem não sai.
- Trava do Chatwoot: excesso de mensagens por minuto na mesma conversa é recusado (`prevent_message_flooding`).
- O Chatwoot tem `template_creation_service`: **talvez** dê para criar o template pela própria tela dele, e não só na Meta. **Não verificado.**

## NÃO verificado (a confirmar antes de depender)

1. Os endereços HTTP e o corpo exato para **achar/criar contato** e **criar conversa** na caixa do WhatsApp (versão instalada do Chatwoot).
2. O **formato do payload** que o webhook padrão do Chatwoot ("Message created") manda quando o cliente responde "Não quero receber" (o plano o reconhece por `event`, `message_type: incoming`, `content` e `sender.phone_number`, de memória da documentação).
3. O formato do `abandoned_checkout_url` contra o domínio da loja: o link dinâmico do template só aceita **parte fixa + um sufixo variável**.

Esses três entram como passo de verificação no plano, em **modo seco** e com **o número do dono**, antes de qualquer cliente.

## Arquitetura

```
pg_cron (1/min) -> disparar_robo -> edge enviar-mensagem-abandono
   |- pegar_para_mensagem()   (banco: trava e marca 'enviando')
   |- regras puras (_shared/mensagem-de-abandono.js)
   |- Chatwoot API: contato -> conversa -> mensagem com template_params
   '- grava o resultado em checkout_abandono
receber-opt-out-chatwoot (NOVA; webhook padrão "Message created" do Chatwoot) -> reconhece
   "Não quero receber" -> contatos_sem_mensagem
```

> **Correção (29/09/2026):** a versão anterior deste design dizia que o bloqueio estenderia o
> `receber-webhook-chatwoot`. Não dá: aquele é um webhook de **CRM customizado** que só aceita
> `lead_novo`/`lead_quente` e **não recebe respostas de clientes**. O bloqueio é uma função nova,
> ligada pelo dono a um webhook padrão do Chatwoot (Configurações → Integrações → Webhooks).

## Dados

Em `checkout_abandono`: `mensagem_status` (`null | enviando | enviada | falhou | ignorada`), `mensagem_enviada_em`, `mensagem_motivo`, `mensagem_tentativas int default 0`, `chatwoot_conversation_id`.
Nova tabela `contatos_sem_mensagem (telefone pk, motivo, criado_em)`. RLS ligada e só o `service_role` acessa; **mesma regra de dado pessoal** da tabela principal.

`pegar_para_mensagem(p_limite, p_atraso_min)` (security definer, só `service_role`): seleciona `status = 'fila_envio' and mensagem_status is null and fila_envio_em <= now() - p_atraso_min` com `for update skip locked`, marca `enviando` e devolve as linhas. **Duas execuções nunca pegam o mesmo checkout.**

**Sem reenvio:** quem voltou para `fila_envio` depois de um Pix expirado mantém `mensagem_status = 'enviada'`, então **não** é escolhido de novo.

## Fluxo por item

1. Relê o status. Se não estiver mais em `fila_envio`: `ignorada / nao_esta_mais_na_fila`.
2. Telefone para o formato internacional (+55, DDD + celular com 9). Sem telefone ou inválido: `ignorada / sem_telefone | telefone_invalido`. **Quem só deixou e-mail não recebe WhatsApp.**
3. Está em `contatos_sem_mensagem`: `ignorada / pediu_para_nao_receber`.
4. Fora de 8h–21h (Brasília): devolve para `null` e espera o cron seguinte.
5. Chatwoot: acha/cria o contato, abre a conversa na caixa do WhatsApp, envia o template. Guarda `chatwoot_conversation_id`.
6. Sucesso: `enviada`. Erro de rede ou 5xx: volta a `null` com `tentativas + 1`, até 3. Erro 4xx: `falhou` com o motivo. **401/403: a função para e não insiste.**

## Travas de segurança

`ENVIO_MODO`: `desligado` (padrão, não faz nada) · `seco` (calcula e devolve o que enviaria, sem chamar o Chatwoot e sem mudar status) · `lista` (só telefones em `ENVIO_SO_PARA`) · `ligado`. Máximo de mensagens por execução. Atraso configurável entre entrar na fila e enviar (`ENVIO_ATRASO_MINUTOS`, padrão 0, como o dono pediu; atrasar 30–60 min é uma escolha possível, reversível só mudando o segredo).

## Configuração

Segredos do Supabase (gravados **pelo dono**): URL do Chatwoot, id da conta, id da caixa do WhatsApp, token de API, nome e idioma do template, `ENVIO_MODO`, `ENVIO_SO_PARA`, `ENVIO_ATRASO_MINUTOS`. **Nada disso é procurado nos projetos por quem implementa.**

## Tela

Em cada item da Fila de mensagens: `enviada` (horário), `falhou` (motivo) ou `ignorada` (motivo), como selo. Tokens de cor e o padrão da Central, como o resto.

## Testes

Funções puras com teste: `primeiroNome`, `normalizarTelefone`, `dentroDaJanela`, `montarTemplateParams`, `decidirEnvio`. Chatwoot atrás de `fetch` injetável (teste sem enviar nada). Teste de texto da migration (RLS, `skip locked`, privilégios). Verificação ao vivo, em ordem: **seco** → **lista** com o número do dono → só então `ligado`.

## Riscos

- **Consentimento ausente** (decisão do dono): risco de queda de qualidade e bloqueio do número da loja, e de questionamento pela LGPD. Mitigação: bloqueio permanente pelo botão, uma mensagem por checkout, horário comercial, modo desligado por padrão.
- **Template reprovado ou mudado pela Meta:** nenhuma mensagem sai. O robô tem que registrar o erro claramente e parar.
- **Cliente não é o dono do telefone** (o número do checkout pode ser de terceiro): mensagem indevida. Sem mitigação total.
- **Checkout recriado pelo Shopify** com o contato guardado (visto em 29/09/2026, "Luis Magrin"): pode disparar mensagem para quem não estava comprando.

## Perguntas em aberto

1. Nome exato do template aprovado e suas variáveis.
2. Credenciais do Chatwoot (grava o dono).
3. Atraso entre entrar na fila e enviar: 0 (padrão) ou 30–60 min.
4. O template será criado na Meta ou pelo Chatwoot?
