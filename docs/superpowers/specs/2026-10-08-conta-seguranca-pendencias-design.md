# Cadastro da conta Vessel — o que a revisão de 08/10/2026 deixou para decidir

**Origem:** o cadastro da cliente falhou com "Não conseguimos enviar o e-mail agora"
(ZeptoMail sem dono + DKIM novo pendente). Ao investigar, a revisão do fluxo achou os
pontos abaixo. **Feito:** log do motivo da recusa do ZeptoMail (PR #314, no ar) e
**tetos por IP** em `criar`/`entrar`/`esqueci` (`2026-10-08-vessel-teto-de-chamadas.sql`
+ `vessel-conta`, neste PR). O resto precisa de decisão.

## 1. O e-mail não é confirmado (o principal)

Hoje o perfil nasce **usável na hora** e a senha aparece na tela (decisão do dono,
18/09/2026). Nada prova que o e-mail é da pessoa. Consequência: quem digita o CPF de
terceiros + um e-mail qualquer cria o perfil com a identidade dele; a cliente de verdade
depois recebe "já existe". "Já existe" também confirma se um CPF/e-mail é cliente.

**Proposta (mantém a senha na tela):**
- perfil nasce `email_confirmado_em = null`;
- o e-mail leva, além da senha, um link `…/verify/confirmar?t=<token de uso único>`;
- **registrar peça / garantia exige e-mail confirmado**; entrar e ver o certificado, não;
- sem confirmar em N dias, o perfil sem peça é apagado.
- "já existe" para perfil **não confirmado** deixa a cliente real tomar o perfil: reenvia
  o link ao e-mail do cadastro e, ao confirmar, a posse é provada.

**Decisão do dono:** aceitar que registrar exija confirmar o e-mail. Muda a página
pública (repositório `vessel-brasil`) e o banco (coluna + função de confirmar).

## 2. Captcha

Cloudflare Turnstile no formulário de cadastro. Precisa de conta/chave no Cloudflare
(site key na página, secret key como segredo da Supabase). O teto por IP já contém o
abuso simples; o captcha contém botnet.

## 3. Trava de login pode ser usada contra a cliente

`vessel_conta_entrar` conta 5 erros / 15 min **por login**. Qualquer um tranca a conta de
uma cliente errando a senha dela de propósito. Correção: chave `login + ip`. Mexe numa
função grande e já testada; fazer com teste de banco, não só estático.

## 4. Retorno do ZeptoMail (bounce / spam)

Nada no projeto consome os webhooks do ZeptoMail. Um `receber-webhook-zeptomail` marcaria
e-mail com bounce duro como inválido e protegeria a reputação do domínio. **Antes:**
conferir na documentação do ZeptoMail como o webhook é assinado, e autenticar como os
da Shopify (HMAC sobre o corpo cru, comparação em tempo constante).

## 5. Senha por e-mail

Substituir a senha em texto no e-mail por link de uso único para a cliente **definir** a
senha. Prioridade menor que o item 1; faz sentido junto com ele (mesmo link).

## 6. Alerta de falha de e-mail

O log já diz o motivo (`zeptomail recusou <status> <código> <mensagem>`). Falta o aviso
ativo: contar `email_nao_saiu` por hora e avisar passando de N.

## Não é código

O Mail Agent do ZeptoMail precisa pertencer a uma conta que não saia da empresa. Foi um
usuário removido do Zoho que o deixou órfão.
