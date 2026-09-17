# Registered Pieces — contas da cliente no selo (desenho)

**Data:** 17/09/2026 · **Estado:** desenho aprovado em conversa, aguardando plano
**Projeto:** selo `/verify` da Vessel + Growth Plan "Registered Pieces"

## 1. O que é e por que agora

Hoje a cliente registra a garantia por um formulário solto: nome, CPF, WhatsApp,
nascimento, onde comprou, data da compra. Não existe conta, então ela não
consegue ver o que já registrou, corrigir um dado ou passar a peça adiante.

O dono pediu (17/09/2026) contas de verdade: **entrar com e-mail ou CPF, senha
gerada na hora, recuperação de senha**, e o cruzamento com a compra no Bling
continuando a ser o que prova que a peça é dela.

O Growth Plan (`~/Downloads/Growth Vessel`) já previa o resto: "Register Later /
Make it yours" para presentes e "transferência futura de propriedade".

**Ordem combinada:** as contas vêm primeiro, num ambiente de teste. O certificado
real (157 etiquetas gravadas em bolsas vendidas) só muda **depois que o dono
encerrar a fase de testes**.

## 2. ⚠️ A medida que decidiu a estrutura

O banco da Vessel é o mesmo da Central de Inteligência RBV. Medido em
17/09/2026:

```sql
select count(*) from pg_policies where schemaname='public'
  and ('authenticated' = any(roles) or 'public' = any(roles))
  and (qual is null or qual in ('true','(true)'));
-- 58 políticas, em 49 tabelas
```

**49 tabelas se abrem para QUALQUER pessoa logada.** Hoje isso não é problema
porque só a equipe tem login. Se a cliente virasse usuária do mesmo login
(Supabase Auth deste projeto), ela passaria a ler essas 49 tabelas — dados
internos da consultoria, de outros clientes da RBV.

Por isso o desenho escolhido é o **caminho A**: contas próprias, em tabelas
fechadas, manipuladas só por funções `security definer` e edges. **A cliente
nunca vira `authenticated` do banco.** A proteção é estrutural, não uma regra que
alguém pode esquecer ao criar a próxima tabela.

Descartados: projeto Supabase separado (ponte entre dois bancos para cruzar
peças e pedidos) e Supabase Auth no mesmo banco (exigiria fechar as 49 tabelas
antes, e o risco voltaria a cada tabela nova).

## 3. Dados

### 3.1. Tabelas novas

⚠️ **Conferir contra as tabelas irmãs** (`vessel_pecas`, `vessel_registros`,
`vessel_pedidos_de_registro`): elas têm RLS ligada com **uma política, só de
SELECT, para `authenticated`, gateada por `is_vessel_admin()`** — é isso que
deixa o painel Autenticidade ler. As tabelas novas nascem iguais: **nenhuma
política de escrita** (escrita só por função `security definer`) e **nenhum
acesso a `anon`**. Tabela nova sem a política de leitura fica invisível para o
painel; tabela nova com política aberta vaza dado de cliente.

Exceção: `vessel_sessoes` e `vessel_tentativas_de_login` **não recebem nem
leitura** — nem o painel precisa delas, e token de sessão não se lê em tela.

**`vessel_clientes`**
`id uuid pk`, `nome`, `cpf` (só dígitos, único), `email` (minúsculo, único),
`whatsapp`, `nascimento date`, `cidade`, `senha_hash`, `senha_trocada_em`,
`email_confirmado_em`, `criado_em`, `atualizado_em`, `bling_contato_id`,
`pessoa_id` (liga ao CRM `vessel_pessoas`), `teste boolean default false`.

- `senha_hash` usa `extensions.crypt(senha, extensions.gen_salt('bf', 10))`.
  ⚠️ `pgcrypto` mora no schema `extensions` — chamar qualificado, senão quebra
  com `search_path = public` (mesmo tropeço de `digest()` em `vessel_verificar`).
- CPF e e-mail são únicos: é o que impede perfil duplicado na segunda peça.

**`vessel_sessoes`**
`id uuid pk`, `cliente_id`, `token_hash` (sha256 do código sorteado), `criada_em`,
`expira_em`, `ultimo_uso_em`, `agente`, `ip_hash`, `encerrada_em`.
- "Manter conectado" → 90 dias; sem ele → 12 horas.
- O código em claro só existe no aparelho da cliente. O banco guarda a
  impressão digital: cópia do banco não vira acesso.

**`vessel_transferencias`**
`id uuid pk`, `codigo` (a peça), `de_cliente_id`, `para_email`,
`para_cliente_id`, `token_hash`, `criada_em`, `expira_em` (7 dias),
`confirmada_em`, `cancelada_em`, `motivo`.

**`vessel_tentativas_de_login`**
`id bigint`, `chave` (e-mail/CPF normalizado ou hash do IP), `quando`,
`acertou`. Serve ao teto de tentativas. Espelha `vessel_tentativas_de_revelar`,
que já existe.

### 3.2. Mudanças em tabelas existentes

- `vessel_registros`: ganha `cliente_id uuid` (a dona). O registro que já existe
  (1 em 17/09/2026) é ligado quando aquela cliente criar perfil com o mesmo CPF.
- `vessel_pedidos_de_registro`: ganha `cliente_id` e `presente_de_nome`.
- `vessel_pedidos` (cópia local dos pedidos do Bling): ganha `observacoes` e
  `observacoes_internas`. É onde a palavra **PRESENTE** é lida.

### 3.3. CRM — os campos não são burocracia

O registro é o momento em que a própria cliente completa o cadastro que a loja
não conseguiu tirar no caixa. Continuam obrigatórios, agora no perfil:
**nome, CPF, e-mail, WhatsApp e data de nascimento**; e, no registro da peça,
**onde comprou** e **data da compra** (esta última opcional, decisão de
06/09/2026 — sem data, a garantia conta de hoje).

Consentimento de marketing é gravado em `vessel_permissoes` (finalidade, canal,
versão do texto), separado do aceite de uso da conta. Registro de peça **não é**
consentimento para marketing.

## 4. Funções e robôs

Uma edge por porta de escrita, chamando funções `security definer` que não são
concedidas a `anon` — o mesmo desenho de `vessel-registrar-garantia`, que existe
porque, se a página pudesse gravar direto, a fila encheria de pedidos que
ninguém tentou casar com uma venda.

| Porta | O que faz |
|---|---|
| `vessel-conta-criar` | valida CPF/e-mail, gera senha, grava, manda e-mail |
| `vessel-conta-entrar` | confere senha, aplica teto de tentativas, abre sessão |
| `vessel-conta-sair` | encerra a sessão (ou todas) |
| `vessel-conta-esqueci` | gera senha nova, encerra sessões, manda e-mail |
| `vessel-conta-editar` | nome, WhatsApp, senha, e-mail (com confirmação por link) |
| `vessel-conta-minhas-pecas` | lista as peças da sessão |
| `vessel-registrar-garantia` | o de hoje, agora com `cliente_id` e "É presente?" |
| `vessel-transferir` | cria o convite e confirma pelo link |

**E-mail:** ZeptoMail (Zoho), conta já criada pelo dono em 17/09/2026. Remetente
`nao-responda@vesselbrasil.com.br`. Falta o dono publicar os registros de DNS no
Registro.br. Três mensagens: senha do cadastro, senha nova, convite de
transferência. ⚠️ O texto do e-mail nunca repete o CPF nem diz o que a pessoa
comprou.

## 5. Os caminhos da cliente

### 5.1. Criar perfil
Nome, CPF, e-mail, WhatsApp, nascimento → senha de 12 caracteres gerada na hora
(alfabeto sem `0/O` e `1/l`) → e-mail. A tela mostra o e-mail mascarado
(`t•••@exemplo.com`). Se o CPF ou o e-mail já existirem, a tela oferece entrar ou
recuperar a senha — **nunca** nasce perfil duplicado.

### 5.2. Entrar
E-mail **ou** CPF + senha. Cinco erros seguidos (por perfil ou por aparelho) →
espera de 15 minutos. Na primeira entrada, a página oferece trocar a senha; não
obriga.

### 5.3. Esqueci a senha
Senha nova por e-mail, a antiga morre, as sessões abertas caem. Teto de 3
pedidos por hora por perfil. ⚠️ **A resposta na tela é idêntica exista ou não o
perfil** — senão a página vira um confirmador de quem é cliente da marca.

### 5.4. Registrar a peça
1. Logada, toca em "Registrar em meu nome".
2. O CPF do perfil é procurado no Bling; achou pedido com o SKU da peça →
   **aprovado na hora**.
3. Não achou → **aguardando aprovação**, e aparece **"É presente?"**.
4. Qualquer falha (Bling fora do ar, token vencido) → pendente, **nunca recusa**.
   Regra que já vale hoje.

### 5.5. A segunda peça
Com "manter conectado", a página reconhece a sessão e o registro é **um toque
só**. Em outro aparelho, só entrar. Duas peças na mesma compra: uma etiqueta de
cada vez.

### 5.6. "É presente?" (ideia do dono, 17/09/2026)
A presenteada informa **o nome de quem deu**. O sistema procura, entre os
pedidos que contêm aquele SKU, um que case. Aprova na hora se, e só se, houver
**um único** candidato e:

- **o nome bater** — comparação tolerante: sem acento, sem maiúscula, ignorando
  nome do meio e partículas ("de", "da", "dos"); ou
- **o pedido estiver marcado `PRESENTE`** nas observações e o nome chegar
  **perto** (primeiro nome e sobrenome final conferem). A marca compensa o nome
  escrito errado, que é o caso que o dono levantou.

Vai para a fila quando: nenhum candidato, **mais de um**, ou dúvida. ⚠️ Um
pedido marcado `PRESENTE` aprova **uma** presenteada por unidade daquele item —
a segunda tentativa no mesmo pedido cai na fila.

⚠️ A comparação de nomes é regra pura, testada em arquivo próprio. Ela decide
quem ganha garantia sem gente olhar: é o pedaço mais fácil de errar calado.

### 5.7. Transferir
Dona → e-mail de quem recebe → link de 7 dias → quem recebe confirma (criando
perfil, se não tiver). A garantia **continua contando da compra original**:
transferir não reinicia prazo. A dona pode cancelar enquanto não for confirmada.
O histórico de donas fica para a equipe.

### 5.8. Editar
Nome e WhatsApp direto; e-mail com confirmação por link; senha pedindo a atual.
**CPF não muda pelo perfil** — é a prova de compra; só a equipe altera, pelo
painel, e a alteração vai para a trilha.

## 6. Proteção

- Senha: bcrypt (`crypt`/`gen_salt('bf',10)`), qualificado em `extensions`.
- Sessão: código sorteado com `gen_random_bytes` (⚠️ `random()` do Postgres é
  previsível — mesmo motivo pelo qual os códigos das peças já nascem assim).
- Nenhuma função devolve dado de outra cliente: tudo parte da sessão.
- Nenhuma resposta pública devolve CPF, e-mail ou telefone. O que a página mostra
  da dona é o **nome completo** (decisão do dono, 17/09/2026). ⚠️ Isso contraria
  o QA17 do Growth Plan ("URLs/telas públicas não expõem titular") — decisão
  consciente, registrada aqui.
- As 49 tabelas internas seguem intocadas: a cliente não é `authenticated`.
- Trilha de auditoria para criar perfil, entrar, trocar senha, registrar e
  transferir.

## 7. Falhas

| Falha | O que a cliente vê | O que o sistema faz |
|---|---|---|
| Bling fora do ar | "estamos conferindo" | pedido pendente na fila |
| E-mail não saiu | "não conseguimos enviar agora" | perfil não fica pela metade |
| Link de transferência vencido/usado | diz isso, e oferece pedir outro | nada muda de dono |
| Senha errada demais | "tente em 15 minutos" | teto por perfil e por aparelho |

## 8. Testes

- **Regras puras** (`*.test.mjs`): comparar nomes, gerar senha, mascarar e-mail,
  validar CPF (já existe), regras de presente e de transferência.
- **Funções do banco:** dentro de `do $$ ... rollback`, com a conta de robô
  `claudecode@rbvcompany.com`. ⚠️ Service role **não** contorna portão de sessão:
  a prova tem de criar a sessão, senão mede o portão e não a regra.
- **Telas:** Playwright pelo módulo node com `channel:'chrome'`, 375px, do
  cadastro à transferência, com o envio de e-mail **fingido**.
- **Presente:** pedido de teste marcado `PRESENTE` e nome escrito errado de
  propósito.
- ⚠️ Nenhum teste toca peça, cliente ou pedido de verdade.

## 9. Entrada no ar

1. **Teste:** endereço de teste, só com peças de um lote marcado `teste`. A demo
   de gravação (`/verify/demo`) continua como está, sem banco.
2. **O dono encerra os testes:** o certificado real recebe o layout novo e as
   contas, **no mesmo endereço** — as 157 etiquetas não são regravadas.
3. **O formulário antigo sai.** O registro que já existe é ligado ao perfil da
   dona quando ela entrar com o mesmo CPF.

**Depende do dono:** publicar os registros de DNS do ZeptoMail no Registro.br e
orientar as vendedoras a escrever `PRESENTE` nas observações do pedido.

## 10. Fora deste desenho (YAGNI)

Login por WhatsApp (adiado pelo dono: só e-mail por enquanto), login social,
perfil com foto, histórico público de donas, app, e qualquer aviso automático de
marketing.
