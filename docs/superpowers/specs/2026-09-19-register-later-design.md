# "Register Later" — lembrete para registrar depois

**Decidido pelo dono em 19/09/2026.** Última peça da lista da Fase 2.

## O que a cliente vê

- Na peça **ainda não registrada**, ao lado de "Registrar no meu nome", um botão
  discreto: **"Deixar para depois"**.
- A folha diz "A gente te lembra. Deixe seu e-mail.", com o campo de e-mail
  (já preenchido com o da conta, quando ela estiver logada) e uma marcação de
  consentimento explícita: "pode me lembrar por e-mail sobre esta peça".
- Confirmando, a tela agradece e **para de oferecer o registro naquela visita**.

## O que a marca faz

- **Dois e-mails: em 7 dias e em 30 dias**, cada um com o link do certificado
  daquela peça.
- O lembrete **morre sozinho** quando a peça for registrada — por quem for.
- Todo e-mail tem **"não quero mais receber"** em um toque, sem login.
- **Um lembrete aberto por peça** e **no máximo um pedido por peça por dia**,
  para ninguém usar o lembrete para incomodar a dona de uma peça.
- Nada de marketing junto: é só o lembrete daquela peça. Nada de WhatsApp.

## Banco

Tabela `vessel_lembretes`:

| coluna | o que é |
|---|---|
| `id` | uuid |
| `peca_codigo` | a peça (normalizado como nas irmãs) |
| `email` | o e-mail para lembrar |
| `cliente_id` | a conta, quando houver |
| `consentimento_em` | quando ela marcou o consentimento (LGPD) |
| `criado_em` | now() |
| `enviado_7_em`, `enviado_30_em` | marcas de envio |
| `cancelado_em`, `cancelado_por` | 'cliente' (link do e-mail) ou 'registro' |
| `token_hash` | o token do link de cancelar, guardado só em hash |

Índice único parcial: um lembrete aberto por peça
(`cancelado_em is null and enviado_30_em is null`).

Funções `security definer`, `set search_path`, fechadas para `anon` e
`authenticated`, liberadas para `service_role` — como as irmãs do selo:

- `vessel_lembrete_criar(p_codigo, p_email, p_token_opcional, p_consentimento)`
  → `{ok, motivo?}`. Recusa sem consentimento, com e-mail inválido, em peça já
  registrada, e quando já houve pedido para a peça nas últimas 24h.
  Nunca conta à cliente se a peça já tem lembrete de outra pessoa.
- `vessel_lembrete_cancelar_por_token(p_token)` → `{ok}`.
- `vessel_lembretes_a_enviar()` → as linhas vencidas (7 ou 30 dias) cuja peça
  continua sem registro; o robô marca com
  `vessel_lembrete_marcar_enviado(p_id, p_qual)`.
- Ao aprovar um registro, o lembrete aberto daquela peça é cancelado com
  `cancelado_por='registro'` (gatilho ou dentro da função que já grava o
  registro — quem implementa mede e decide, sem mexer no que a função já faz).

## Robô

Edge nova `vessel-lembretes` (Deno), chamada uma vez por dia pelo cron, com o
mesmo portão de segredo que os outros robôs usam (`_shared/segredo-de-cron.ts`),
publicada com `--no-verify-jwt`. Ela pega as linhas vencidas, manda pela
ZeptoMail (`_shared/email-zeptomail.ts`) e marca o envio. E-mail que falha não
some: fica para a próxima rodada, e o robô registra o motivo.

O cancelamento pelo link do e-mail entra como ação na edge `vessel-conta`
(`lembrete-parar`), que não exige sessão — o token é a prova.

## Páginas

- **/verify:** o botão "Deixar para depois", a folha com e-mail e consentimento,
  e o agradecimento.
- **/verify/parar-lembrete:** a tela que o link do e-mail abre, sem login,
  confirmando que não vai mais receber.

## Painel

Na tela de Autenticidade, a lista de lembretes: peça, e-mail, quando pediu, o
que já foi enviado e o estado (aberto, cancelado pela cliente, encerrado pelo
registro). Só leitura nesta entrega.

## Fora deste desenho

WhatsApp, e-mail de marketing, mais de dois lembretes, e lembrete para peça que
já tem dona.
