# Frota — A ferramenta fica didática (F10)

Complemento de `2026-08-04-frota-design.md`, `2026-08-05-frota-checklist-motorista-design.md`
e `2026-08-06-frota-checklist-assinatura-design.md`, que continuam valendo.
As decisões deste documento começam em **D24** — D1 a D23 são dos anteriores.

## De onde veio

**Quem usa a Frota principalmente é um policial aposentado, com dificuldade de
uso.** Isso não é um detalhe do contexto: é o critério de aceitação deste
documento. Uma tela que exige adivinhar não está pronta, mesmo que grave certo.

O dono trouxe as queixas dele, e mais o que ele mesmo esbarrou:

> "às vezes salva algo e salva" · "registrar histórico de manutenção é difícil
> por ter que fazer um a um" · "vi que alguns campos tem informação de 'máscara'
> tipo JHM, sei lá, n entendi mt bem" · "ainda consigo arrastar a tela do modal
> para os lados" · "na ficha dos veículos tem duas sessões que são praticamente
> a mesma coisa" · "eu emprestei a bravo blackmotion para gabriel e ai ele
> esqueceu de devolver" · "os cards com falta de informação" · "a aba de revisões
> antes mostrava somente quando estava chegando a data de vencimento... agora eu
> quero que mostre tudo mesmo" · "uma pessoa que não é do grupo irá usar o carro
> ... preciso ter a opção de colocar um nome qualquer para registro" · "pensar na
> melhor forma de deixar a ferramenta de gestão de frota didática"

## O que foi medido antes de desenhar (12/08/2026)

Contra o banco de produção, por `select`. Nenhuma linha foi alterada.

| Medida | Número |
|---|---|
| Veículos | 10, todos `ativo` |
| Veículos sem dono fixo | 2 — Bravo Essence (`OLW4I46`) e Doblo (`QQT9B68`) |
| Posses abertas | 8 |
| Posses abertas **sem `pessoa_nome`** | **5** — XC90, Porsche, Punto, Fiesta Sedan, XC60 |
| Carros com `local_id` apontado na árvore | **9 de 10** |
| Carros com quilometragem conhecida | **2** — Bravo Black 188.000 e BMW X1 54.000 |
| Trocas registradas na frota inteira (`frota_revisoes`) | **2** |
| Itens do plano de revisão ativos | 8 |
| Checklists gravados desde 06/08 | 2, o último em 07/08. Hoje: **0** |
| Requisições pendentes | **2, ambas do próprio dono** — travadas desde 11/08 |
| Pessoas ativas no cadastro | 22 · com login: 9 · **com telefone: 5** |
| Campos com exemplo de valor dentro da caixa | 17, dos quais **8 parecem dado preenchido** |
| `tela-de-frota.vue` | **2.976 linhas** — o maior arquivo da Central |

Duas consequências que decidem fases inteiras:

1. **Sem quilometragem, a aba Revisões não tem o que calcular.** 8 dos 10 carros
   caem em `sem-km` nos 8 itens do plano. A aba não está escondendo alerta: ela
   não tem alerta pra mostrar. Ver D29.
2. **A maior parte das travas que incomodam o dono é da tela** — mas não todas,
   e a frase original desta linha estava errada. `is_frota_admin()`
   (migration 022) já permite `for all` em `frota_veiculos`, `frota_uso` e
   `frota_requisicoes` pra quem tem a chave `frota`, então encerrar posse e
   registrar uso no lugar de outro (D25, D26) são de fato só de tela.

   ⚠️ **Aprovar a própria requisição (D24) NÃO é.** Existe um gatilho —
   `trg_frota_checar_decisao`, migration 023 — que rejeita a decisão da própria
   requisição no banco, com superadmin explicitamente incluído. Ler a política de
   RLS e concluir "a escrita está liberada" **dá uma resposta incompleta**:
   gatilho também barra escrita, e este barrava. Achado pela revisão da Fase D-1,
   depois de a tela já estar pronta. Corrigido pela migration
   `040_frota_aprovar_a_propria.sql`.

   **A regra que sai daqui:** antes de afirmar que algo é "só de tela", conferir
   os GATILHOS da tabela, não só as políticas.

## Os defeitos achados

Dois deles vêm da queixa *"salva e não aparece, na ficha do veículo"*: são
independentes entre si, e **os dois são de leitura** — o dado do dono está
gravado e está certo, nada precisa ser reescrito no banco. O terceiro é o modal
que arrasta pros lados.

### B1 · O local apontado na árvore não aparece em lugar nenhum

`estadoDoVeiculo()` (`estado-do-veiculo.js:85`) monta `ondeEsta` a partir de
`veiculo.local_texto` — o texto digitado à mão antes da árvore existir. O
`local_id` que a ficha grava desde a migration 034 **nunca é lido pela lista**.

Medido: 9 dos 10 carros têm `local_id`. Em **4 deles** (`BDN3A67`, `ERO3G55`,
`EDC6H82`, `OLW4I46`) o `local_texto` está vazio — o dono apontou o local e a
tela ficou em branco. Nos outros 5 é pior de diagnosticar: a tela mostra o texto
antigo ("Casa RB", "Barracão", "Conchal"), então parece que a gravação não pegou.

**Conserto:** `ondeEsta` passa a preferir o local da árvore (Local › Ambiente,
resolvido contra `patrimonio_locais`/`patrimonio_comodos`, que `carregar()` já
traz na mesma leva — linha 514) e cai no `local_texto` só quando não houver
árvore apontada. `local_texto` **continua gravado e intacto**, pela mesma razão
do D-original: é a única pista de onde o carro estava.

### B2 · A posse sem nome apaga quem está com o carro

`quemEstaComOCarro()` (`_shared/posse.js:68`) devolve `posse.pessoa_nome || null`
quando há posse aberta — e **ignora o dono fixo nesse caso**. Nas 5 posses
abertas em 06/08 o `pessoa_nome` ficou em branco (gravaram só o `pessoa_id`).
Resultado: 5 carros com dono cadastrado aparecem sem ninguém, e trocar o
responsável na ficha não muda nada na tela.

**Conserto:** quando a posse tem `pessoa_id` e não tem `pessoa_nome`, o nome é
resolvido pelo identificador contra a lista de pessoas, na tela. **Não se
escreve no banco**: dado real de produção não se conserta por script, e a
leitura corrigida resolve os 5 casos de hoje e qualquer outro que apareça
depois — inclusive posses que outra tela venha a abrir sem o nome.

### B3 · O modal arrasta pros lados

`.fr-ficha-corpo` tem `overflow-y:auto`. Pela regra do CSS, um eixo em `auto`
com o outro em `visible` faz o outro virar `auto` também — ou seja, a rolagem
horizontal apareceu **sem ninguém pedir**, e qualquer conteúdo mais largo que a
caixa deixa a ficha arrastável pro lado. O `touch-action:pan-y` que existe hoje
está em `.fr-ficha-fundo > *`, que pega a moldura da ficha e **não** o corpo
que rola.

**Conserto:** travar o eixo horizontal no corpo e prender o dedo na vertical,
com `min-width:0` nos filhos da grade pra nada estourar a caixa.

**Isto é hipótese até ser visto na tela.** A causa está lida no CSS, não medida
no navegador — e o padrão da casa manda medir a 375px num navegador de verdade
antes de dizer que acabou.

## As decisões

### D24 · Quem administra a Frota aprova a própria requisição, sem selo

⚠️ **ERRO DESTE DESENHO, achado pela revisão em 12/08:** as duas afirmações de
que esta decisão "não mexe no banco" **estavam erradas**. `is_frota_admin()`
libera a escrita pela RLS, sim — mas o **gatilho `trg_frota_checar_decisao`**
(migration 023) rejeita a decisão da própria requisição, e o comentário dele diz
que superadmin não é exceção. Sem migration, a tela mostraria o botão e o clique
falharia com a mensagem da regra velha — pior que não ter botão.
**Corrigido pela migration `040_frota_aprovar_a_propria.sql`.** A lição:
`for all` na RLS não é a única trava de escrita; gatilho também barra, e ler a
política sem ler os gatilhos da tabela dá uma resposta incompleta.

`podeDecidir()` deixa de devolver `{ pode: false, motivo: 'propria' }` para quem
tem permissão de administrar. A aprovação da própria requisição fica **igual a
qualquer outra na tela** — decisão do dono, consultado sobre a alternativa de
marcar visualmente.

O que se perde e fica registrado aqui: a versão original bloqueava de propósito
("o sentido da aprovação é um segundo par de olhos"). O que **não** se perde:
`frota_requisicoes.decidida_por` e `decidida_em` continuam gravando quem decidiu
— o rastro existe no banco, só não vira aviso na tela.

Efeito imediato e verificável: as 2 requisições de `OLW4I46` paradas desde 11/08
passam a ter botão.

### D25 · Pessoa de fora do grupo: nome escrito na hora, sem cadastro

Ao reservar ou registrar uso, além de escolher um colaborador, dá pra **escrever
um nome livre** (o caso real: *"Felipe usará durante consultoria"*, hoje enfiado
no campo de finalidade porque não havia onde escrever a pessoa).

Não há tabela nova e não há cadastro. `frota_uso.pessoa_id`,
`frota_requisicoes.pessoa_id` e os dois `pessoa_nome` **já são nulos-permitidos**
(medido em `information_schema`) — o nome livre grava com `pessoa_id` nulo e
`pessoa_nome` preenchido, que é exatamente o formato que o histórico já usa.

**Facilidade barata:** os nomes livres já digitados antes aparecem como sugestão
(`<datalist>` montado das linhas existentes), pra não virar "Felipe", "felipe
modelista" e "Felipe M." como três pessoas. É leitura do que já existe, não
cadastro.

O que o dono aceitou perder ao escolher isto: pessoa sem cadastro **não tem
telefone**, então o quadro de cobrança do checklist não consegue chamá-la, e ela
não recebe o aviso das 7h30. A cobrança dela é por fora.

### D26 · Quem administra encerra ou passa a posse de qualquer carro

Na aba Gestão, cada veículo ganha **"Passar para outra pessoa"** e **"Encerrar
posse"**, valendo pra qualquer carro e qualquer pessoa — inclusive nome livre
(D25).

O caso real: a **Bravo Blackmotion (`FFK9E60`) está com Gabriel Alves desde
11/08**, posse aberta, e não havia caminho na tela pro dono trazê-la de volta.

A troca reaproveita `trocarDonoFixo()` (`_shared/posse.js`) e a regra do D9c —
fechar a posse anterior antes de abrir a nova, conferindo os dois passos um a um.
Duas posses abertas no mesmo carro é o estado que o gatilho
`trg_frota_fechar_posse_orfa` (migration 029) existe pra impedir, e a tela não
pode produzi-lo por outro caminho.

### D27 · Lançamento de manutenção: um serviço, várias trocas

Uma ficha só, aberta do card do carro ou de dentro da sanfona de Revisões:
data · **KM do painel** · oficina · **valor total** · observação · e a lista dos
itens do plano com caixa de marcar, cada um com **valor unitário opcional**.

- **O KM é obrigatório.** Revisão gravada sem KM é invisível pro alerta
  (`ultimaRevisao()` só considera `Number.isInteger(r.km)`), então o item
  continuaria "vencido" pra sempre depois de trocado. A tela diz isso com essas
  palavras em vez de só pintar o campo de vermelho.
- **KM menor que o já conhecido avisa e não bloqueia.** Painel trocado zera
  odômetro de verdade — mesmo tratamento do `hodometro_justificativa` do
  checklist.
- **Total e unitários convivem.** Se os unitários não somarem o total, a tela
  **diz a diferença em reais e deixa gravar** ("sobram R$ 170,00, que devem ser
  mão de obra"). Não rateia o total entre os itens (inventaria preço de peça) e
  não repete o total em cada linha (somar o ano daria o triplo).
- **Marcar pelo menos um item** é obrigatório.

### D28 · Item de mecânica novo sempre pede o intervalo em km

Criar "Amortecedor" na hora pergunta **de quantos em quantos quilômetros se
troca**, e o item entra em `frota_plano_revisao` — passando a avisar sozinho em
toda a frota. É o que o dono quis dizer com *"vira parâmetro no banco"*.

Validação reaproveita `problemasDoItem()` (`revisoes.js`), que já barra nome
curto, nome repetido, e intervalo abaixo de 500 km ou acima de 500.000.

Consequência assumida: **conserto de uma vez só** (parachoque batido, vidro)
não tem item próprio — vai na observação do lançamento. Se incomodar, se revê.

### D29 · O KM do lançamento passa a contar como quilometragem do carro

`estadoDoVeiculo()` hoje deriva o KM de três fontes: última devolução, saída em
aberto, e hodômetro de checklist. Ganha a **quarta: o maior KM registrado em
`frota_revisoes` daquele carro**.

Sem isso, a Fase C grava manutenção e a aba Revisões continua dizendo "ainda não
sei a quilometragem" nos mesmos 8 carros — o dono registraria a troca e nada
mudaria na tela. Com isso, registrar a troca de óleo com 92.000 km acorda a aba.
O critério é o mesmo das outras fontes e da `ultimaRevisao()`: **o maior KM,
nunca o mais recente por data** — data digitada errada acontece, odômetro só
anda pra frente.

### D30 · Revisões mostra tudo, em sanfona por carro

Escolha do dono entre três desenhos apresentados. A aba lista os 10 carros; cada
um mostra o resumo na frente (`resumoDeRevisoes()`, que já existe) e abre os 8
itens ao toque, **todos**, não só os que estão perto de vencer. Dentro da
sanfona aberta, o botão **"Lançar manutenção"** (D27).

Não some nada do que já existia: "Chegando a hora" continua no topo como
atalho pro que urge.

Descartados, com o motivo: a **lista corrida** de 80 linhas rola demais no
celular; a **grade carros × itens** só cabe arrastando pro lado no celular, que
é exatamente a queixa do B3.

### D31 · Exemplo sai de dentro do campo

**Contado com precisão:** `tela-de-frota.vue` tem 20 `placeholder`. Destes, **8
parecem dado preenchido** — `JHM Auto Center` (2×), `(19) 3033-9837` (2×),
`CTR-007`, `RBB-007`, `145928`, `20000` — e outros 9 são listas de exemplo
dentro da caixa ("Conchal, Campinas…", "Oficina, locadora, seguro, guincho…").

**Os 17 saem da caixa** e viram texto de ajuda embaixo dela, escrito como
exemplo: *"Ex.: JHM Auto Center"*.

**O que fica onde está:** `placeholder` que é *instrução*, não valor — "opcional"
e "a mesma senha com que você entra" (`painel-de-checklist.vue`). Ninguém
confunde instrução com dado gravado, e tirá-los da caixa só ocuparia altura de
celular. O `'— — —'` do hodômetro também fica: ele já foi decidido assim de
propósito, justamente por este motivo.

É a mesma decisão que `painel-de-checklist.vue:242` já tinha tomado sozinho pro
hodômetro (*"na fonte de números ele parece dado preenchido"*) — aqui ela vira
regra da ferramenta inteira.

### D32 · "Contato" entra em "De quem é e onde está"; Oficina fica, e ganha o histórico

**Esta decisão foi revista pelo dono em 12/08, depois de ver a primeira versão
na tela — e a revisão dele vale.** Fica registrado o caminho, porque o erro é
instrutivo: ele pediu desde o início pra unir "De quem é e onde está" com
"Contato". Eu argumentei que a repetição *de fato* era outra — "Contato" e
"Oficina" pedem os dois nome + telefone, com o mesmo exemplo `JHM Auto Center` —
e implementei assim. Vendo pronto, ele corrigiu: **as duas perguntas que se
repetem na cabeça de quem usa são "de quem é o carro" e "com quem eu falo",
não "qual oficina" e "qual contato".** Oficina é outra coisa, e é a seção onde
mora o histórico de manutenção.

A forma que vale:

```
DE QUEM É, ONDE FICA E COM QUEM FALAR
  Responsável · De qual empresa é · Onde fica (Marca › Local › Ambiente)
  Contato: quem é · o que faz · telefone

OFICINA
  Mecânica · Telefone da oficina
  Histórico de manutenção   ← sai de seção solta e vem pra cá
```

**Nenhuma coluna do banco é removida ou renomeada** — `contato_nome`,
`contato_papel`, `contato_telefone`, `oficina_nome` e `oficina_telefone`
continuam existindo e sendo gravados; o que muda é como a ficha os agrupa.
`contatoParaCobranca()` continua lendo `contato_nome`/`contato_telefone` como
sempre, e o rótulo do contato continua sendo o nome de **quem** é o telefone —
é disso que aquele módulo depende pra não cobrar a pessoa errada.

### D33 · Botões rápidos com o estado embaixo

Cada aba abre com botões grandes do que se vai fazer ali, e **cada um diz o
estado** — é o que separa um menu de uma orientação.

```
MOTORISTA   [ ✓ FAZER MEU CHECKLIST ]   [ 🚗 PRECISO USAR UM CARRO ]
              Bravo · falta hoje           3 carros livres

GESTÃO      [ 📅 RESERVAR UM CARRO  ]   [ ✓ CONFERIR CHECKLISTS   ]
            [ + ACRESCENTAR VEÍCULO ]   [ 🚗 VEÍCULOS DO GRUPO    ]

            PRECISA DA SUA APROVAÇÃO (2)   ← a fila, logo abaixo dos botões
```

Os botões **não criam tela nova**: Reservar e Acrescentar abrem fichas que já
existem; Conferir checklists e Veículos do grupo rolam até seções que já estão
mais abaixo. O que muda é ter um lugar óbvio pra começar.

Ícones em **SVG próprio, nunca emoji** (`feedback_sem_emoji_icones`) — os emoji
no bloco acima são só rascunho.

### D34 · O card do checklist resolve a falta ali mesmo

Hoje o card mostra o que falta e não dá o que fazer. Passa a permitir, dentro
dele: **apontar o dono do carro** (resolve Bravo Essence e Doblo, sem ninguém),
**cadastrar a pessoa** se ela não existir, **salvar o telefone** no cadastro (o
botão de copiar telefone já existe e continua valendo), e **convidar o login**.

O convite manda e-mail de verdade pra pessoa de verdade — Barbara Franco
(`@vesselbrasil.com.br`), Marcus Vinicius e Thiago Siqueira. Por isso ele **pede
confirmação na tela antes de disparar**, dizendo o nome e o endereço pra quem
vai. Reaproveita a Edge `invite-user`, sem caminho novo de convite.

### D35 · As peças novas nascem em arquivo próprio

`tela-de-frota.vue` tem 2.976 linhas e tudo o que foi pedido cai nele. Três
caminhos foram apresentados ao dono; escolhido o terceiro:

1. Enfiar tudo no mesmo arquivo → passa de 4.000 linhas.
2. Quebrar as 5 abas em arquivos → o arrumado, mas mexe em tudo que está no ar
   (checklist assinado, cobrança, tutorial) numa entrega que era pra ser sobre
   facilitar.
3. **Só as peças novas em arquivo próprio**, encostando no velho apenas onde for
   necessário. ← escolhido

Arquivos novos, com teste ao lado:

| Arquivo | Do que cuida |
|---|---|
| `lancamento-de-manutencao.js` | montar e validar o lançamento (D27), conferir total × unitários |
| `lancamento-de-manutencao.vue` | a ficha do lançamento |
| `sanfona-de-revisoes.vue` | a aba Revisões mostrando tudo (D30) |
| `botoes-rapidos.js` | o que cada botão diz embaixo do nome (D33) |
| `nomes-de-fora.js` | sugestões de nome livre a partir do que já foi digitado (D25) |
| `onde-o-carro-fica.js` | resolver o local da árvore, com queda pro texto antigo (B1) |

O que se encosta no arquivo velho: `podeDecidir` (D24), os 12 `placeholder`
(D31), o agrupamento da ficha (D32), os botões rápidos (D33), o card de cobrança
(D34), e o ponto onde `linhas` monta o estado (B1/B2).

## O que muda no banco

**Só a Fase C mexe.** Fases A, B e D são inteiramente de tela.

⚠️ **039 e 040 já foram usados** — a 039 pela frente de perfis de acesso, e a
040 pelo conserto do gatilho de aprovação (ver D24 acima). A migration da Fase C
é a **041**. Conferir o maior número em `db/migrations/acessos/` na hora de
escrevê-la: há mais de uma frente mexendo neste repositório, e este número já
mudou duas vezes.

```sql
-- 041_frota_manutencao.sql
create table public.frota_manutencoes(
  id uuid primary key default gen_random_uuid(),
  veiculo_id uuid not null references public.frota_veiculos(id) on delete cascade,
  km int not null check (km >= 0),
  feita_em date,
  oficina text,
  total_centavos bigint,
  observacao text,
  criada_em timestamptz not null default now(),
  criada_por uuid references auth.users(id) on delete set null
);
alter table public.frota_revisoes
  add column manutencao_id uuid references public.frota_manutencoes(id) on delete cascade;
```

**Por que a tabela de cabeçalho existe:** hoje só há "uma troca de um item". O
lançamento do dono é *um serviço com várias trocas e um valor de nota*. Sem
cabeçalho, o total de R$ 1.240 teria que ser rateado entre os itens (mentindo
sobre o preço de cada peça) ou repetido em cada linha (e somar o ano daria o
triplo). Com ele, o lançamento também pode ser **reaberto e corrigido** — o que
o dono não tem hoje.

`frota_revisoes` **não muda de forma**: continua sendo uma linha por item
trocado, com `item` em texto (o histórico não pode sumir quando o dono renomeia
um item do plano), e as 2 linhas já gravadas continuam válidas com
`manutencao_id` nulo. RLS igual à das outras tabelas da Frota:
`for all using (public.is_frota_admin())`.

## Erros e caminhos ruins

| Situação | O que a tela faz |
|---|---|
| KM em branco no lançamento | Não grava, e explica que sem KM o alerta nunca se apaga |
| KM menor que o conhecido | Avisa a diferença, pede o porquê, deixa gravar |
| Unitários ≠ total | Diz a diferença em reais e deixa gravar |
| Nenhum item marcado | Não grava: "marque o que foi trocado" |
| Item novo com nome repetido ou intervalo absurdo | `problemasDoItem()`, que já existe |
| Gravou o cabeçalho e falhou nos itens | Não fecha a ficha, diz o que ficou pela metade e o que fazer — mesmo critério de `salvarVeiculo()` e `gravarChecklist()` |
| Encerrar posse falha | Não abre a posse nova (duas abertas é o estado proibido do D9c) |
| Convite de login falha | Diz que o convite **não** foi enviado, com o endereço tentado |
| Árvore de locais não carrega | `falhaArvore` já existe; "Onde fica" cai no texto antigo e a tela diz por quê |
| **Plano de revisão vazio ou que não carregou** | A aba diz que **não sabe**, nunca que está em dia. `resumoDeRevisoes([])` respondia `em-dia` — a antiga aba escondia isso por acidente, ao descartar carro sem item vencendo, e a D30 removeu esse acidente junto com o filtro. Sem esta linha, uma falha de leitura do plano pinta os 10 carros de verde |

Regra que vale pras nove telas: **a tela nunca diz que deu certo sem ter
conferido**. "Duas gravações e só a primeira conferida" apareceu 4× na fase do
checklist, e em todas elas a tela dizia que tinha dado certo.

## Como se testa

- **Lógica pura com teste ao lado** (`*.test.mjs`, `node --test`): a conta do
  lançamento e a divergência total × unitários, as sugestões de nome livre, a
  resolução do local (B1), o nome pela posse sem nome (B2), o KM como quarta
  fonte (D29), o texto de cada botão rápido (D33), e `podeDecidir` com a regra
  nova (D24).
- **`todo-vue-compila.test.mjs` é obrigatório.** `node --test` não compila
  `.vue`: já houve 1.895 testes verdes com a branch sem compilar.
- **Medição no navegador, a 375px**, do modal que arrasta (B3) e das duas abas
  novas. O padrão da casa manda medir, não deduzir.
- **Nenhum teste escreve em conta real.** O navegador de teste entra com a
  sessão de verdade: só leitura, e toda escrita abortada antes de sair.

## Fora de escopo

- **F3 multas** e **F5 custo por km** continuam travadas pelo mesmo motivo de
  sempre: ninguém registra quem estava com o carro no dia. O que destrava é o
  checklist diário, que depende de o dono ligar o aviso (A1 da lista de
  pendências) — não de código.
- **Cadastro de pessoa esporádica** com telefone: recusado nesta rodada (D25).
- **Quebrar `tela-de-frota.vue` por aba**: recusado nesta rodada (D35).
- **Conserto de uma vez só** como item próprio: não entra (D28).

## As quatro fases

| Fase | O que entrega | Banco |
|---|---|---|
| **A** | B1, B2, B3, D30, D31, D32 | não mexe |
| **B** | D24, D25, D26 | não mexe |
| **C** | D27, D28, D29 | migration 039 |
| **D** | D33, D34 | não mexe |

Cada fase vai pro ar sozinha. A ordem importa em um ponto: **D29 (Fase C) é o
que faz a Fase A ter o que mostrar** na aba Revisões — até lá, a sanfona mostra
tudo, e o que ela mostra em 8 dos 10 carros é "ainda não sei a quilometragem
deste carro", que é a verdade.
