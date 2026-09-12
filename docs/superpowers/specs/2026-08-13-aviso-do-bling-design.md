# Vendas — a tela avisa quando o Bling não responde

Data: 13/08/2026 · Branch: `aviso-do-bling` · Worktree: `~/iamundi-aviso-bling`

## De onde veio

O dono abriu a conversa perguntando por que uma venda de ontem no Dom Pedro não
apareceu na dashboard, e desconfiou da regra de "só conta quando faturado".

Não era a regra. O Bling estava **recusando o token do iamundi desde 12/08
17h41** (permissão de escopo do usuário, ver
`project_iamundi_bling_token_escopos` na memória). Foram **17 horas de apagão** e
a tela não disse nada: mostrou R$ 0,00 com a mesma cara de um dia sem venda.

A venda existia: 4 pedidos, todos Dom Pedro, **R$ 1.132,60**, atendidos e com
nota do próprio dia.

O pedido do dono, com estas palavras: *"pode acrescentar um aviso de token
expirado ou com erro de permissão"*.

## O que foi medido antes de desenhar (13/08/2026)

**O defeito, medido no código.** `blingCall` devolve `r.json()` **sem olhar o
status HTTP** — em `tela-de-gestao-a-vista.vue:184` e
`tela-de-analise-vendas.vue:144`, duas cópias idênticas. Um 500 vira um objeto
sem `.data`; `blingPages` (também duplicado) lê isso como "lista vazia", tenta 3
vezes por página e desiste devolvendo `[]`. Zero pedido → R$ 0,00.

**O `catch` existe e nunca é alcançado.** As duas telas já têm tratamento de erro
(`gestao-a-vista:721` escreve "Erro ao carregar"; `analise-vendas:466` escreve
"Erro: msg"). Nunca roda, porque ninguém lança nada. Não falta tela de erro:
falta *detectar* o erro.

**Quem gritou.** Só os robôs, que checam status: notas-dos-pedidos (9 falhas
seguidas), Relatórios Comerciais e Cards Comerciais. Nenhum humano foi avisado.

**As duas telas NÃO se comportam igual, e isso decide o desenho.**

| | Gestão à Vista | Análise de Vendas |
|---|---|---|
| Recarrega sozinha | sim, 5 min (`:715`) | sim, 5 min (`:446`) |
| Apaga o painel antes de buscar | **não** (só escreve no fim) | **sim** (`sa-body.textContent=''`, `:302`) |
| Sobra número pra segurar na falha | sim, de graça | não |

**O que a tela já sabe da pessoa.** `estado` carrega `role`, `features` e
`is_superadmin` (`controle-de-login-e-usuario.js:9,10,16`), e as duas telas já
leem `estado.is_superadmin` (`:653` e `:368`). Não precisa buscar nada novo.

**Dois "sem permissão" que não são a mesma coisa.** O `bling-proxy` devolve 403
`{"error":"sem permissao"}` quando **a pessoa** não tem `sales`/`gestor`; e 500
com `Token refresh failed: ...escopo...` quando **o Bling** recusa o iamundi.
Confundir os dois manda quem for consertar para o lugar errado — foi o que
aconteceu nesta sessão, e custou horas.

## Os defeitos achados

### B1 · Erro de rede vira número de dinheiro

Status HTTP ignorado, corpo interpretado de qualquer jeito, ausência de dado
tratada como zero. É o defeito de origem; tudo abaixo é consequência.

### B2 · A decisão está duplicada

`blingCall` e `blingPages` existem em duas telas, iguais. Consertar uma e
esquecer a outra é o resultado mais provável — e o repo já tem a lição escrita
em `_shared/data-da-venda.js`: "duas cópias da mesma regra é como duas telas
decidindo o mesmo".

### B3 · A Análise de Vendas apaga o que tinha antes de saber se vai conseguir

A cada 5 minutos ela zera o corpo e mostra spinner. Se a busca falhar, não há
para onde voltar.

## As decisões

### D1 · A chamada ao Bling passa a morar num lugar só

Novo `src/compartilhado/chamada-do-bling.js`, com três peças:

- `chamarBling(sbClient, endpoint, params)` — faz a chamada, **confere `r.ok`** e,
  na falha, LANÇA um erro que carrega a causa já classificada.
- `classificarFalhaDoBling(status, corpo)` — função pura. Devolve uma de quatro
  causas: `bling-recusou-token`, `bling-fora`, `sem-acesso-a-vendas`,
  `sem-resposta`.
- `paginasDoBling(...)` — a paginação, uma vez só. Continua parando quando a
  página vem vazia (fim da lista é legítimo), mas agora a **falha** não passa por
  vazio: ela sobe como erro.

As duas telas importam daí e **perdem suas cópias**. Guarda de import nas duas
pastas, cobrindo `src/compartilhado/` (o padrão que a Etapa 2 da data-da-venda já
usa).

### D2 · Na falha, a tela segura o último número e põe uma faixa

Escolha do dono, entre três opções (apagar os números / trocar a tela pela
mensagem / segurar e avisar):

- **Recarga automática:** os números da última busca boa **ficam na tela**, e uma
  faixa no topo diz de que hora eles são. Telão em TV que fica em branco é pior
  que telão com número de 5 minutos atrás — desde que esteja **rotulado**.
- **Primeira carga**, quando não existe número anterior: mostra **só o recado**.
  Nunca R$ 0,00.

Na Gestão à Vista isso sai de graça (ela não apaga o painel). Na Análise de
Vendas, **D3**.

### D3 · A Análise de Vendas só apaga quando o dado chega

`sa-body.textContent=''` sai do começo da carga e vai para junto da renderização.
Enquanto busca, o conteúdo anterior fica e o spinner aparece como faixa. Na
falha, o conteúdo anterior permanece com a faixa de aviso. Na primeira carga
(corpo vazio) o comportamento é o de hoje: spinner e, na falha, o recado.

É a única parte não-trivial do serviço.

### D4 · Duas frases, escolhidas por quem está olhando

Quem é `role === 'admin'` ou `is_superadmin` lê a causa e o que fazer. Todos os
outros — e a TV da loja — leem só que o número está velho. Sem jargão na frente
de cliente, e sem esconder do dono o que ele precisa saber.

| Causa | Admin lê | Os outros leem |
|---|---|---|
| `bling-recusou-token` | O Bling recusou o acesso do iamundi (token vencido ou escopo sem permissão). Precisa reautorizar no Bling. Números de HH:MM. | ⚠ Números de HH:MM — aguardando o Bling. |
| `bling-fora` | O Bling não respondeu (erro no servidor dele). Números de HH:MM. | ⚠ Números de HH:MM — aguardando o Bling. |
| `sem-acesso-a-vendas` | Este login não tem acesso a Vendas. | Você não tem acesso a Vendas — fale com quem administra. |
| `sem-resposta` | Sem resposta (internet ou Supabase). Números de HH:MM. | ⚠ Números de HH:MM — sem conexão. |

`sem-acesso-a-vendas` é o único caso em que **não** faz sentido segurar número
nem falar do Bling: o problema é o crachá de quem olha.

### D5 · A hora que aparece na faixa é a da última busca BOA

A Gestão à Vista já guarda `_gvLastLoadTime` e mostra `ULT. hh:mm · PRÓX. hh:mm`
(`:577`). Esse carimbo **não pode** ser atualizado por uma tentativa que falhou —
senão a faixa diz "números de agora" sobre número velho, que é a mentira que
estamos consertando, só mais bem vestida. A Análise de Vendas ganha o mesmo
carimbo.

## O que NÃO entra

- **A Edge `bling-proxy` não muda.** O corpo que ela já devolve tem o que precisa
  para classificar, e o deploy dela é manual (risco sem ganho).
- **Robôs e push não mudam** — já checam status e já falham alto.
- **Nada de aviso por push ou e-mail.** O pedido foi aviso na tela. Se depois o
  dono quiser um push quando o Bling cair, é outra conversa (e o lugar natural é
  `robos_saude`).
- **Nenhum encosto no filtro de canais** commitado hoje em `b638920`.

## Como isto vai ser provado

- **Testes de unidade** (`node --test`) de `classificarFalhaDoBling` e dos textos:
  um caso por formato real de falha (500 com "Token refresh failed" + escopo; 500
  genérico; 403 `sem permissao`; `fetch` lançando; 200 com lista vazia, que
  **não** é falha).
- **Guarda de import** nas duas pastas, cobrindo `src/compartilhado/`.
- **`npm run build`** — porque `node --test` não compila `.vue` (lição de
  `feedback_teste_verde_nao_e_tela`).
- **Falha forçada num HTML de laboratório** (`public/lab-*`, já ignorado pelo
  git): a faixa renderizada nos quatro casos, print enviado ao dono antes de
  encostar no app.
- **Limite declarado:** não há Playwright logado no iamundi, então a tela aberta
  e logada não será verificada por automação. O laboratório cobre a aparência; o
  build e a guarda cobrem a ligação.
