# LP VESSEL BRASIL — lista de espera

Página pública de captação para o lançamento da marca **VESSEL BRASIL**, no endereço
`vesselbrasil.com.br`. Quem chega lê a narrativa da marca e deixa nome, e-mail e
WhatsApp para entrar na lista de espera.

**Escopo desta spec: a LP, mais a mudança de casa da página do selo (`/verify`)**, que
vem junto porque ela foi desenhada para o mesmo domínio. O catálogo em PDF automático é
um projeto separado (ver "O que ficou de fora", no fim) e não depende desta página em
nada.

---

## O que já é fato (medido em 28/08/2026, não suposto)

Tudo abaixo foi conferido nesta sessão, com o comando ao lado. Nada aqui é lembrança.

### O domínio

- `vesselbrasil.com.br` **existe e está pago**: dono Breno Oliveira do Vale, situação
  ativa, vence em **10/02/2028** (`whois`).
- O DNS está hospedado nos servidores do próprio Registro.br (`a.sec.dns.br` /
  `b.sec.dns.br`), e a zona **só tem e-mail**: três MX do Zoho, o SPF
  (`v=spf1 include:zohomail.com ~all`) e o registro de verificação.
- **Não existe registro A nem CNAME**, nem na raiz nem no `www`. O endereço não
  resolve para ninguém: `curl` devolve `Could not resolve host`.
- Na Vercel, a conta `brenoov-7581` tem **um** domínio: `rbvcompany.com`.
  `vesselbrasil.com.br` **não está cadastrado**, e não está reivindicado em nenhuma
  outra conta (`vercel domains ls`, `vercel domains inspect`).

### O perigo que existe hoje no iamundi (e que esta spec elimina)

O `vercel.json` do iamundi tem um desvio da raiz do host `vesselbrasil.com.br` para
`https://lavessel.com.br`. **Ele cobre apenas `/`.** Qualquer outro caminho cai na
regra pega-tudo e serve o painel interno. Medido:

```
GET https://central.rbvcompany.com/qualquer-coisa-que-nao-existe
→ HTTP 200, <title>Central de Inteligência RBV</title>
```

Ou seja: se o domínio da Vessel fosse apontado para o projeto do iamundi,
`vesselbrasil.com.br/frota` — ou qualquer palavra digitada — abriria a Central de
Inteligência RBV debaixo da marca da cliente. Não é vazamento de dado (a tela exige
login), mas é a consultoria aparecendo no endereço da marca.

Piora com dois detalhes:
- **não existe `robots.txt`**: pedir `/robots.txt` devolve o HTML do painel com HTTP
  200, o que um buscador lê como "pode indexar tudo";
- o cabeçalho `Strict-Transport-Security` sai com `max-age=63072000; includeSubDomains;
  preload` — dois anos gravados no navegador de quem visitar.

**Esta spec resolve isso pela raiz: o painel não vai morar no mesmo servidor.**

### O banco já protege o que precisa ser protegido

A chave pública que a página do selo carrega hoje (e que a LP vai carregar) **não lê
tabela nenhuma**. Medido com a própria chave, extraída do HTML no ar:

```
vessel_pecas   → []                       (RLS barra, devolve vazio)
vessel_lotes   → []
profiles       → []
accounts       → 42501 permission denied  (nem chega a consultar)
```

Isso importa por dois motivos: é a fundação de segurança da LP, e prova que **a LP não
expõe nada novo** — essa chave já está pública em `public/verify/index.html` desde
04/08/2026.

### O design já existe, inteiro

`~/Downloads/Vessel - LP.pdf`, uma página, com os sete blocos e todos os textos
finais. Extraído com PDFKit do macOS. Não há nada a inventar de conteúdo.

### O que NÃO existe

- **Escrita no Bling.** `supabase/functions/bling-proxy/index.ts` traz, no cabeçalho:
  *"Só leitura — nada aqui emite nem cancela nota."* A lista `CAMINHOS_PERMITIDOS`
  tem `pedidos/vendas`, `vendedores`, `produtos`, `estoques/saldos`, `nfe` e `nfce` —
  **não tem `contatos`** — e a função só repassa leitura.
- **Permissão de planilha no Zoho.** A conexão tem `WorkDrive.files.ALL` e
  `WorkDrive.teamfolders.ALL` (arquivos, provados no ar em 18/08 pelo robô de PDF do
  checklist) e `ZohoMail.organization.accounts.READ`. **Planilha do Zoho Sheet é outro
  produto e outra permissão**, e ela não foi concedida.
- **Termos de Uso e Política de Privacidade.** O formulário desenhado já promete os
  dois, e eles não existem em lugar nenhum.

---

## O que a página é

Uma página só, estática, sem framework e sem etapa de construção — **o mesmo padrão de
`public/verify/index.html`**, que já roda em produção. O menu do topo é âncora: não há
navegação a resolver.

Sete blocos, na ordem do PDF:

| # | Bloco | Fundo | Conteúdo |
|---|---|---|---|
| 0 | Topo | claro | logo VESSEL BRASIL · `NARRATIVA` `A VESSEL` `COLEÇÃO` · botão `ACESSO PRIVADO` |
| 1 | Herói | escuro, foto | *"Para mulheres que carregam mais."* + botão `CONHEÇA A VESSEL` |
| 2 | A NARRATIVA | verde escuro | *"Presença não se anuncia."* + três parágrafos numerados I, II, III |
| 3 | A VESSEL | claro | *"Uma marca brasileira criada para acompanhar mulheres em movimento."* |
| 4 | A COLEÇÃO | verde escuro | *"The Vessel Collection."* + peças `VESSEL 01 / MAREA` e `VESSEL 02 / LUNEA` |
| 5 | Design codes | claro | *"O que fica quando tudo mais passa."* + `RECOGNIZABLE BY DESIGN. NOT BY LOGOS.` |
| 6 | ACESSO PRIVADO | verde escuro | **o formulário**: NOME · E-MAIL · WHATSAPP + `ENTRAR PARA A LISTA` |
| 7 | Rodapé | claro | logo · redes · `PRIVACIDADE` `TERMOS` `CONTATO` · `© 2026 / VESSEL` |

Os botões `ACESSO PRIVADO` (topo) e `CONHEÇA A VESSEL` (herói) são âncoras internas —
o primeiro para o bloco 6, o segundo para o bloco 2.

**Não há link para a loja.** Foi decisão do dono em 28/08: a página é lista de espera de
uma marca que ainda não vende, não isca de venda imediata. Não existe cupom nesta
página, e nada aqui aponta para `lavessel.com.br`.

**Responsividade:** funciona a partir de 375px sem estourar a largura, e no desktop
mantém a composição deslocada que o design pede. Medida na tela, não no código.

---

## Onde o cadastro cai

### Tabela `vessel_lista_espera`

Colunas: `id`, `nome`, `email`, `whatsapp`, `origem`, `criado_em`, mais o registro do
consentimento (`aceite_em`, `aceite_versao`) e o estado de cada espelho
(`bling_id`, `bling_em`, `planilha_em`, `ultimo_erro`).

**RLS ligada, ZERO políticas** — o mesmo desenho de `vessel_pecas`, pelo mesmo motivo:
a chave pública está dentro do HTML, e com leitura direta qualquer pessoa baixaria a
lista de e-mails e telefones. A prova acima mostra que o desenho funciona.

`email` é único: quem se cadastrar duas vezes não vira duas linhas.

### Função `vessel_entrar_na_lista(nome, email, whatsapp, aceite_versao, armadilha)`

`security definer`, é o único caminho de escrita, exatamente como `vessel_registrar` já
faz na página do selo. Dentro dela:

1. **campo-armadilha** — um campo invisível que robô preenche e gente não. Preenchido,
   a função responde sucesso e **não grava**. Robô não descobre que foi barrado.
2. **limite por origem — no padrão que o selo já usa.** `vessel_registrar` lê o IP em
   `current_setting('request.headers', true)::json ->> 'x-forwarded-for'` e guarda
   **só o hash** (`encode(extensions.digest(ip, 'sha256'), 'hex')`), nunca o IP cru —
   o que também é o comportamento certo pela LGPD. A LP faz igual: **teto de 5
   cadastros por hash de IP por hora**. Estourado o teto, a função responde sucesso e
   não grava, pelo mesmo motivo do campo-armadilha.
3. **e-mail repetido responde sucesso**, sem criar linha nova e sem dizer que o e-mail
   já existe — dizer isso transformaria a página num verificador de "fulana está na
   lista?".
4. **consentimento gravado**: quando aceitou e **qual versão do texto** estava no ar.
   Sem a versão, o consentimento não prova nada quando o texto mudar.

**Gotcha herdado:** se a função precisar de `digest()`/`gen_random_bytes` do
`pgcrypto`, tem de chamar qualificado (`extensions.digest`) — a extensão mora no schema
`extensions` e a função quebra com `search_path = public`. Foi o que derrubou
`vessel_verificar` na primeira vez.

---

## Os dois espelhos: Bling e planilha

**A LP nunca escreve no Bling nem no Zoho.** Quem escreve é um robô agendado, lendo as
linhas ainda não espelhadas. Três razões, e nenhuma é preciosismo:

1. a portaria pública do Bling **continua fechada para escrita**, como está hoje;
2. se o Bling ou o Zoho estiverem fora do ar, **o cadastro não se perde** — já está
   gravado, e o robô tenta de novo;
3. a página responde na hora, sem esperar dois sistemas de terceiro.

O robô é uma Edge Function nova, `vessel-espelhar-lista`, agendada por `pg_cron`. Ela
lê o token do Bling direto de `bling_tokens`, **sem passar pelo `bling-proxy`** — assim
a portaria pública nunca ganha escrita. Toda falha é gravada em português na própria
linha (`ultimo_erro`) e a linha volta para a fila, no padrão já usado por
`enviar-pdf-checklist`.

### A marca de origem no Bling

Requisito do dono: o contato tem de ser **identificável como vindo da LP**.

Como o campo exato da API v3 do Bling não foi verificado nesta sessão, a **primeira
tarefa da implementação** é provar isso contra a API de verdade, com um contato de
teste, e só então escrever o código. Regra: **nada é escrito no Bling antes da sonda
confirmar o campo.** Se nenhum campo de observação/marcação servir, o robô para e o
assunto volta ao dono — não inventa campo nem enfia a origem no nome.

### A planilha do Zoho

Depende de o dono autorizar a permissão nova. Até lá o robô grava `ultimo_erro` dizendo
exatamente isso, em português, e segue espelhando o Bling. **A falta dessa permissão não
impede a página de ir ao ar.**

---

## Onde a LP mora, e a blindagem

**Repositório próprio e projeto Vercel próprio.** Não é preferência de organização: é a
blindagem que o dono pediu, e ela é estrutural.

**Parede 1 — os arquivos da Central não existem naquele servidor.** O que é publicado é
só a LP. Não há caminho digitado, robô de busca ou erro de configuração que sirva um
arquivo que não foi enviado. É garantia por ausência, não por regra — e regra é o que
falha.

**Parede 2 — domínios que não se conhecem.** `vesselbrasil.com.br` cadastrado só no
projeto da LP; `central.rbvcompany.com` só no do painel.

**Parede 3 — banco compartilhado, fechado.** É o mesmo Supabase, de propósito: as
tabelas `vessel_*` já moram lá e o painel de Autenticidade já as usa. A proteção é a
provada no início desta spec.

**Consequência boa:** o desvio `vesselbrasil.com.br → lavessel.com.br` do `vercel.json`
do iamundi **deve ser removido** junto com esta entrega. Ele existe só para tapar um
buraco que deixa de existir, e deixá-lo lá é deixar uma regra morta que confunde quem
ler depois.

### DNS: o que apontar, sem derrubar o e-mail

O apontamento vai por **A na raiz e CNAME no `www`**, adicionados no painel do
Registro.br. **Nunca trocar os servidores de DNS para os da Vercel:** isso descarta os
MX do Zoho e mata o e-mail do domínio. Os valores exatos saem da Vercel no cadastro do
domínio e serão entregues ao dono prontos para colar, com a instrução de **não remover
nada** do que já está lá.

---

## O `/verify` muda de casa junto (decidido pelo dono em 28/08/2026)

A página do selo de autenticidade foi desenhada para
`vesselbrasil.com.br/verify/<código>` e hoje mora dentro do iamundi. Com o domínio
apontando para a casa nova, esse endereço deixaria de existir. **Decisão: o `/verify`
vai junto com a LP.**

O motivo é que as duas páginas são a mesma coisa em natureza — estáticas, públicas, sem
login, com a marca VESSEL BRASIL, conversando com o Supabase por função fechada. Elas
pertencem ao mesmo lugar. E mover tira do iamundi a última razão de ele conhecer o
domínio da Vessel, o que fecha o assunto da blindagem de vez.

**O que se move:**

1. `public/verify/index.html` — a página, sem alteração de conteúdo;
2. `public/verify/fotos/lv1021/` — as cinco fotos oficiais. **Confirmado no ar:**
   `GET /verify/fotos/lv1021/1-frente.jpg` responde HTTP 200, `image/jpeg`, 64 KB;
3. a regra de reescrita `/verify/:codigo → /verify/index.html`, que passa a viver no
   `vercel.json` da casa nova.

**O que NÃO se move:** o painel de administração da Autenticidade
(`src/ferramentas/autenticidade/`, rota `/autenticidade`) **fica no iamundi**. Ele é
ferramenta interna, exige login e permissão, e não tem nada a fazer na casa pública.
A permissão `autenticidade` e o `is_vessel_admin()` continuam como estão.

**Cuidado com os caminhos relativos das fotos.** O banco guarda a foto como
`fotos/lv1021/1-frente.jpg` — caminho **relativo**, que o navegador resolve contra a URL
da página. Servida em `/verify/<código>`, a base é `/verify/`, e a foto resolve para
`/verify/fotos/...`. **A casa nova precisa servir o `/verify` no mesmo lugar da árvore**,
senão as fotos somem sem erro nenhum aparecer — o certificado abre bonito e sem bolsa.
Isso entra na lista de provas.

**Limpeza no iamundi, na mesma entrega:** removidos o desvio
`vesselbrasil.com.br → lavessel.com.br` e a exceção `verify` da regra pega-tudo do
`vercel.json`. Os dois existem só para tapar buracos que deixam de existir, e regra
morta confunde quem ler depois.

---

## O que trava o lançamento, e o que não trava

| O que | Depende de | Trava? |
|---|---|---|
| Texto de Termos de Uso e Política de Privacidade | dono | **sim** — não se publica formulário que promete página inexistente, e a LGPD exige |
| Apontar o A e o CNAME no Registro.br | dono | **sim**, para o público |
| ~~Decisão sobre o `/verify`~~ | ~~dono~~ | **resolvido em 28/08**: vai junto para a casa nova |
| Permissão nova do Zoho (planilha) | dono | não — atrasa só o espelho |
| Sonda da API de contatos do Bling | implementação | não — atrasa só o espelho |
| Fotos em alta resolução | dono | não — as do PDF servem |

---

## Como isso é provado

Não vale "está pronto". A entrega inclui:

1. **A página aberta no navegador de verdade**, fotografada a 375px e no desktop.
   Teste que roda não é tela que abre.
2. **Um cadastro de teste gravado e mostrado na tabela** — a prova precisa mudar o
   valor, não só rodar sem erro.
3. **A prova de que `vessel_lista_espera` continua fechada**: a mesma consulta com a
   chave pública que abre esta spec, devolvendo vazio.
4. **O campo-armadilha barrando** um envio preenchido, e o e-mail repetido não criando
   segunda linha.
5. **Nenhum dado real tocado.** Os cadastros de teste são identificáveis e removidos
   ao fim, por `rollback` onde possível.

---

## O que ficou de fora, de propósito

- **O catálogo em PDF automático.** É a segunda máquina, independente desta: não tem
  tela, não precisa de domínio e não precisa de deploy nenhum — é um robô que lê o
  Bling e larga o PDF no WorkDrive. Ganha spec própria. Achado que ela vai precisar
  enfrentar: o montador de PDF do projeto
  (`supabase/functions/_shared/pdf-do-checklist.js`) **não desenha imagem**, por
  decisão registrada no próprio arquivo — até o logotipo é traçado com linhas. A saída é
  que as fotos dos produtos são `.jpg`, e **JPEG entra no PDF sem ser reprocessado**,
  que era justamente o impedimento levantado lá (ele fala de PNG).
- **Cupom e qualquer integração com a Shopify.** Fora de escopo por decisão do dono em
  28/08. Registro do que foi medido, para não ser re-descoberto: a loja é Shopify
  confirmado (`powered-by: Shopify`), mas o catálogo público dela está **fechado** —
  `/products.json` responde **HTTP 401**. Puxar produtos de lá exigiria criar um
  aplicativo e uma chave. Por isso a fonte do catálogo é o Bling, que já está ligado.
- **Área logada.** `ACESSO PRIVADO` é o nome do bloco do formulário, não uma porta de
  login.

---

Ver [[project_vessel_verify]], [[project_iamundi_deploy]],
[[project_iamundi_bling_token_escopos]].
