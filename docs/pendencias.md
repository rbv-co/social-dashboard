# Pendências do iamundi

Última revisão: **20/08/2026**

O que é este arquivo: a lista viva do que está **em aberto** no projeto. Cada item
diz o que falta, **por que importa** e **onde** se resolve. É a memória escrita —
se não estiver aqui, some.

Como ler:
- **Parte A — Só o dono resolve.** É clique em painel/tela. Não tem código pra fazer.
- **Parte B — Precisa programar.** Alguém tem que mexer no código.
- **Parte C — Ideias guardadas.** Ninguém pediu ainda; está aqui pra não esquecer.

Cada item tem um código fixo (A1, B3...) pra dar pra citar em conversa.

---

## O que o dono decidiu em 18/08 (para não virar dúvida de novo)

Numa triagem item a item, ele **encerrou** dez itens da Parte A. Fica aqui o
motivo, porque "sumiu da lista" sem explicação é o que faz alguém reabrir o
assunto daqui a um mês:

| Item | Por que saiu |
|---|---|
| A2b · carro sem dono | **É de propósito.** O `OLW4I46` não tem dono fixo por decisão. |
| A2c · seguro vazio nos 10 | **É de propósito.** Não vão preencher valor de seguro. |
| A3 · empresa e local | **FEITO em 18/08.** Os 10 carros têm empresa e local — zero vazios. |
| A12 · Status do Claude | **É de propósito.** O `breno@` não vai receber a permissão. |
| A13 · anúncios parados | Encerrado a pedido dele. |
| A1, A4, A5, A6, A7 | Mandou apagar. Eram os que já estavam fora de recomendação. |
| A2 · 3 donos sem login | Mandou apagar (18/08, à noite). **Não estava resolvido** — ver o aviso abaixo. |
| A3c · teste dos Perfis de Acesso | Mandou apagar (18/08, à noite). **Não estava feito** — ver o aviso abaixo. |

**Correção de dado em 18/08 — o KM da Bravo Blackmotion.** A tela mostrava
**188.000 km**; o certo é **185.359** (o último checklist). A causa: uma ficha de
teste de 07/08, **não assinada**, com o hodômetro digitado acima do real — e a
regra da tela (`ultimoHodometro`) pega o **MAIOR** hodômetro de propósito, porque
"odômetro só anda pra frente". A própria ficha assinada de 17/08 registra o erro:
*"O teste foi feito com o km acima do correto."*

⚠️ **O gotcha, para a próxima vez:** `frota_checklist.hodometro` é **obrigatório**,
então não dá para esvaziar um número errado. As únicas saídas são **corrigir** ou
**apagar** a ficha. O dono escolheu apagar (18/08); a ficha não era assinada,
então não havia prova a destruir e a corrente de códigos não foi tocada — ela
continua ligando 14/08 → 17/08. Foram junto as 15 respostas dela. Cópia do que
foi apagado ficou fora do repositório, no scratchpad da sessão.

**Risco aceito em 18/08 — o token da purga da Fábrica.** Ele apareceu na tela
numa sessão de trabalho. O dono escolheu **tirá-lo do texto puro sem trocá-lo**,
porque trocar exige colar o valor novo em `FABRICA_PURGA_SECRET` no painel do
Supabase, e só ele tem esse privilégio. O token continua conhecido. Se um dia
quiser fechar: gerar um hex de 64, atualizar a linha `fabrica-purga` em
`segredos_de_cron` e colar o mesmo valor no painel — nessa ordem.

⚠️ **A2 e A3c saíram ABERTOS, por decisão da noite de 18/08.** Os dois tinham
trabalho pendente medido, e é justamente por isso que ficam escritos aqui:

- **A2** — Barbara Franco, Marcus Vinicius e Thiago Siqueira **continuam sem
  login**. Os três já têm e-mail na ficha, então o botão *"Dar acesso"* aparece no
  card do checklist de cada carro. Enquanto não houver login, **push nenhum chega
  para eles** e o quadro da aba Gestão é o único canal — por isso quem administra
  a Frota pode preencher o checklist por qualquer carro. Se um dia alguém
  perguntar "por que fulano não recebe aviso do carro dele", **é isto.**
- **A3c** — a ferramenta de Perfis de Acesso **está no ar e nunca foi usada**. O
  roteiro de teste (conta descartável → perfil de teste → conferir que Cancelar
  não muda nada no banco) não foi rodado. Então **o primeiro perfil de verdade é
  também o primeiro teste da trava.** Se algo falhar ao criar um perfil com gente
  dentro, é aqui que a investigação começa.

⚠️ **A2c e A12 tinham número medido contra eles** (10 de 10 carros sem seguro; a
permissão faltando de fato). Não saíram por estarem resolvidos — saíram porque o
dono decidiu que é assim que fica. Se um dia alguém estranhar o custo do carro sair
por baixo, ou você não enxergar o Status do Claude, **é isto, e é intencional.**

---

## Parte A — Só o dono resolve (clique, sem código)

*(Estava vazia em 18/08. Voltou a ter itens em 20/08, com a via de mão dupla
entre Frota e Patrimônio.)*

### A14 · os 9 carros antigos não têm etiqueta de patrimônio
Medido em 20/08/2026: o sistema tem **362 itens, 353 com número**, e os **9 sem
número são exatamente os 9 carros antigos** — nenhum outro item da empresa
ficou de fora. Eles carregam o código `RBB-00X`, que é só da Frota e nenhum
leitor de código lê.

Desde 20/08 carro novo já nasce com número de etiqueta pelos dois caminhos.
Falta o passado: **colar o adesivo nesses 9 e escrever o número na ficha do
carro** (campo "Nº de patrimônio", na ficha do veículo).

Enquanto não for feito, o leitor de código não acha carro nenhum, e o `RBB-00X`
continua sendo a única identificação que eles têm — **por isso ele não foi
aposentado.**

Os 9: VOLVO XC60, FIAT DOBLO, FIAT BRAVO ESSENCE, FIAT BRAVO BLACKMOTION, HONDA
FIT, FORD FIESTA SEDAN, VOLVO XC90, PORSCHE CAYENNE PHEV, BMW X1.
*(O FIAT PUNTO escapou: já tem o nº 14.)*

### A15 · o quarto KWID (item nº 291) está sem placa
Decisão do dono em 20/08: são **quatro KWIDs**, e o item **nº 291** fica sem
placa por enquanto, porque o carro dele ainda não foi levantado. Os outros três
já estão na Frota com os números **298, 299 e 300**.

Enquanto o 291 estiver sem placa, ele é um item do Patrimônio **sem carro na
Frota** — não aparece pra reservar, não entra em checklist e não recebe multa.
Para resolver: abrir o item nº 291 no Patrimônio, preencher a **Placa** e
salvar; o carro nasce na Frota sozinho.

⚠️ A obrigatoriedade da placa vale só pro **cadastro novo**, justamente pra que
este item possa ser editado sem inventar placa. Placa inventada é pior que
placa faltando: ela é UNIQUE, ocupa o lugar de uma real e some sem ninguém
notar.

### A16 · o status de item de veículo volta sozinho, sem avisar
Desde 20/08 o status do carro manda no do item (migration 051). O campo de
status na ficha do Patrimônio **continua editável** — decisão do dono, que
preferiu não travar campo.

A consequência aceita: mexer no status de um item que **tem carro ligado** salva
e o valor **volta ao da Frota, sem nenhum aviso na tela**. Funciona como
desenhado, mas é do tipo silencioso — a família de defeito que mais custou caro
neste projeto.

Não está quebrado e não precisa de conserto agora. Fica escrito para quando
alguém estranhar: **é intencional, e o conserto é uma frase no rodapé** dizendo
que o status veio da Frota, não travar o campo.

---

### A17 · Selo Vessel › subir as fotos das duas bolsas no Bling 🟡 *aberto em 03/09*

O robô das fotos (`coletor/fotos-do-selo-do-bling.mjs`, 8h05 todo dia) está no ar
e funcionando — provado com um lote de teste. Mas **o Bling não tem foto destes
dois produtos**, então ele não acha nada até você subir:

| Bolsa | Produto no Bling | Código |
|---|---|---|
| De Ombro Grande Nice | Bolsa De Ombro Grande Nice Caramelo | `SS1025-Fly Rum` |
| De Mão Média Lódz | Bolsa De Mão Média Lódz Memphis Preto | `SS-1162-Memphis Preto-Fly Olivia` |

Até 4 fotos, e a **ordem importa**: a primeira é a que aparece grande no
certificado. Depois de subir, o robô pega na manhã seguinte — ou é só pedir para
eu rodar na hora.

⚠️ Não é urgente para a etiqueta funcionar: as duas bolsas do lote Nice **já
estão gravadas e no mundo**, e o certificado delas abre normalmente com modelo,
cor e número de série. Só falta a foto.

⚠️ E o Bling está quase sem foto no catálogo em geral: **28 de 100 produtos**, e do
catálogo novo (SS) **3 de 9**. Vale saber antes de esperar que o robô encha todos.

## Parte B — Precisa programar

### B20 · Bling › o `bling-proxy` falha em 2% das chamadas ✅ *fechado em 18/08 — prazo próprio e segunda chance*
Este item **substitui o B7**, que dizia que a causa do erro `546
WORKER_RESOURCE_LIMIT` ainda era hipótese. Medido em 18/08, a hipótese
**envelheceu**: o 546 não aparece em **~8.000 disparos** desde 31/07, nem em 24h
do registro da Supabase. E a suspeita de que "a função roda ~120s" está errada —
o `coletar-dados` roda em **21,4s de média**, com **0 erros** em 29 chamadas.

**O que falha de verdade, hoje**, nas últimas 24h de registro:

| Função | Chamadas | Não-200 | Taxa |
|---|---|---|---|
| **bling-proxy** | 721 | **16** | **2,2%** |
| todas as outras (13) | 626 | 0 | 0% |

Os 16 são: **8 tempos esgotados** (504, batendo em ~30s), **5 recusas por excesso**
(429, o Bling limitando) e **3 não encontrado** (404).

**Por que isso importa mais do que parece:** este projeto já teve falha virando
número — 500 virando R$ 0,00 por 17 horas. O caminho compartilhado
(`src/compartilhado/chamada-do-bling.js`) **já foi endurecido** e hoje levanta o
erro em vez de devolver lista vazia; as telas de dinheiro estão cobertas.

✅ **A parte que era nossa foi consertada em 18/08.** As duas chamadas da Gestão
Comercial engoliam a falha, e o mecanismo era pior do que "um catch mal escrito":
`functions.invoke` **não joga erro**, devolve `{ data: null, error }`, então o
`|| []` transformava queda do Bling em lista vazia. A `gcAbrirItem` **já tinha** o
`try/catch` certo, escrevendo "Não consegui consultar o Bling agora" — e ele nunca
disparava. O usuário lia **"Item não encontrado no Bling"**: uma queda anunciada
como "esse produto não existe", com a mensagem certa escrita e inalcançável.

A regra de leitura virou `resposta-do-bling.js`, com 7 testes, fora do `.vue`
(onde não teria como quebrar teste nenhum). Vazio continua sendo vazio — o item
pode não existir mesmo; o que mudou é que **falha agora sobe**.

✅ **A OUTRA METADE TAMBÉM ERA NOSSA, e foi consertada em 18/08.** O item dizia
que o resto "não era nosso". Remedindo hoje (759 chamadas, 15 falhas, 1,98% —
o número se confirmou), a repartição mostrou o contrário: **8 × 504** (a chamada
pendurada até a plataforma matar em ~30s), **5 × 429** (o Bling limitando, e
respondendo em 762ms) e **2 × 404** (item que não existe — isso é resposta, não
falha). O nosso proxy chamava o Bling **sem prazo próprio e sem tentar de novo**:
uma chamada lenta ficava presa até morrer, e quem estava na tela esperava o meio
minuto inteiro para receber um erro.

**O prazo saiu de medição, não de gosto.** Nas 744 chamadas que deram certo:
p50 1,0s · p90 2,0s · p99 3,9s · a mais lenta 12,7s · só 2 acima de 10s. O prazo
ficou em **11s**, muito acima do p99; o preço é cortar ~1 chamada honesta por
dia, e mesmo essa é repetida e volta em ~1s.

A política mora em `supabase/functions/_shared/tentar-de-novo.js` (16 testes), e
não solta dentro do `.ts`. As três regras: **404 e 403 não se repetem** (são a
resposta do Bling); **só se repete GET** — o único POST é o refresh do token, e
repeti-lo queimaria o token da empresa; e **nunca se começa uma tentativa que não
cabe no tempo**, porque ser morto aos 30s devolve NADA, e "nada" na tela vira
"não sei o que aconteceu". Quando desiste, devolve 504 com frase de gente.

**No ar em 18/08** (bling-proxy v11, pelo MCP). Medido depois de subir: 32
chamadas reais, **todas 200**, média 1,35s.

⚠️ **O que ainda não foi visto acontecer:** uma repetição de verdade. Os 429 vêm
em rajada e os 504 são esporádicos — o efeito só se comprova no próximo episódio,
e ele fica registrado (`[bling-proxy] tentativa N: …`) no log da função.

### B8 · Status do Claude › o gasto da OpenAI ✅ *fechado em 18/08 — o valor está na tela*
Pedido do dono em 27/07. Medido em 18/08, e o item era **maior do que dizia**: a
tela não só omitia a OpenAI — ela **afirmava** que "tarefas que criam imagens não
usam a API paga, então custam R$ 0". A Fábrica gera criativo com **gpt-image-2**,
que é API paga da OpenAI.

**A raiz, e ela é da família que já custou caro aqui:** `ia_execucoes.usd` era
**NOT NULL com padrão 0**. "Não sei" era obrigado a virar "zero". E em JavaScript
`Number(null) === 0` é **true**, então bastava um `Number(e.usd) === 0` espalhado
pela tela para a mentira se recompor sozinha.

**Feito em 18/08:**
- A coluna aceita **nulo** = "ainda não se sabe". Zero passou a significar só o
  que significa: não custou mesmo
- As **26 execuções** da Fábrica (473 criativos) foram corrigidas de R$ 0 para
  "não sei", e ganharam o nome do motor. As outras tarefas da Fábrica (subir,
  excluir, preview) continuam zero — essas não chamam IA nenhuma
- `coletor/lib/custo-da-execucao.mjs` (7 testes): motor da Anthropic calcula;
  motor pago de fora, ou **motor novo que ninguém precificou**, devolve nulo
- `src/ferramentas/claude-status/custo-do-extrato.js` (8 testes): as três
  situações, e a segmentação por fornecedor
- A legenda da tela foi reescrita e agora diz a verdade, inclusive que **estava
  errada até 18/08**

**O que a tela mostra agora**, medido no banco: nos últimos 30 dias há
**US$ 24,79 conhecidos** e **23 execuções · 397 imagens sem custo conhecido**,
todas de `gpt-image-2`. Antes, essas 397 apareciam como R$ 0.

💰 **QUANTO ERA, afinal — medido em 18/08 com a chave do dono:**
**US$ 98,71 em 60 dias** (≈ R$ 542,90 ao câmbio de 5,5), em **19 dias com gasto**.
Os picos — 16/07 (US$ 29,29), 21/07 (US$ 24,89), 17/07 (US$ 15,86) — caem
exatamente dentro da janela em que a Fábrica rodou (13/07 a 29/07). **Era isto que
a tela mostrava como R$ 0,00.**

✅ **A chave já está no cofre** (`openai_admin_key`, 133 caracteres, formato
`sk-admin`), guardada em 18/08 e provada contra o relatório de custos (HTTP 200).
Ela nunca passou pela transcrição da sessão: o dono a deixou como **nome de uma
pasta no Downloads**, e ela foi lida do disco direto para o cofre.

✅ **A pasta do Downloads foi apagada em 18/08**, depois de conferir que a chave
já estava no cofre (133 caracteres, formato `sk-admin`). Nome de pasta é texto
puro — aparece em listagem, captura de tela e backup. Não sobrou vestígio no
histórico do terminal nem no Lixo.

✅ **FECHADO em 18/08: o valor está na tela.**
- **Edge Function `custo-openai`** (172 linhas), irmã da `custo-anthropic`:
  mesma segurança (verify_jwt + só admin), lê `openai_admin_key` do cofre.
  **Subiu pelo MCP** — a trava do deploy era da CLI (conta errada, 403), e o MCP
  nunca dependeu dela. Não era preciso esperar o B14.
- **A pegadinha que mudaria o valor em 100×:** na Anthropic o `amount` vem em
  CENTAVOS; na OpenAI, `amount.value` vem em DÓLARES. Medido contra a API antes
  de escrever: 90 dias = **US$ 98,71**, o mesmo número da medição manual.
- **A OpenAI dá o que a Anthropic não dá:** custo REAL por chave de API
  (`group_by=api_key_id`). O "quem gastou" da OpenAI é a conta de verdade, não
  um rateio — e a tela diz essa diferença em letras.
- **Na tela:** o número grande do topo virou **gasto real de IA** (as duas contas
  somadas), com Anthropic e OpenAI discriminadas embaixo; o Extrato ganhou os dois
  cards e mais dois detalhamentos ("para onde o dinheiro foi" e "quem gastou", da
  OpenAI). A legenda que dizia *"falta a chave"* foi reescrita.
- **A soma tem teste** (`somarFornecedores`, 4 casos): fornecedor que falhou
  **não entra como zero** — o total se declara *parcial* e diz quem faltou. Sem
  isso, uma falha de rede viraria um total menor com cara de número exato, que é
  a mesma família de defeito que este item veio consertar.

**O que ainda NÃO se sabe, e continua honesto na tela:** quanto custou **cada
execução** da Fábrica. A OpenAI não dá custo por chamada; só por dia, modelo e
chave. As 23 execuções seguem marcadas como *"custo ainda não conhecido"*.

---

### B21 · Status da IA › o caminho feliz da `custo-openai` v2 não foi visto rodar ⚠️ *aberto em 19/08*
A função subiu com prazo próprio (8s), até 3 tentativas e registro do motivo — o
mesmo remédio do B20. O que **não** deu para provar: a chamada de verdade, com um
admin logado. Ela exige JWT de administrador, e copiar a sessão do dono derruba o
painel dele (o token rotaciona), então a prova parou no 401 de porta fechada.

**Como fechar, em um minuto:** o dono abre o Status da IA e olha o número grande do
topo. Se aparecer "R$ …" com Anthropic e OpenAI embaixo, está fechado. Se aparecer
"Não consegui puxar a conta da OpenAI", agora o motivo fica escrito no registro da
função (`[custo-openai] …`) — e aí dá para saber, pela primeira vez, se é limite de
taxa, queda ou chave vencida.

⚠️ **A causa dos 3 erros em 26 chamadas (11,5%) segue sendo HIPÓTESE.** O suspeito
é limite de taxa em rajada: os 500 vinham em PAR, das duas janelas que a tela pedia
ao mesmo tempo. As duas coisas que atacariam isso já foram feitas (a tela parou de
perguntar quatro vezes por minuto; a função tenta de novo), mas o que confirma é o
próximo episódio no registro.

### B22 · `bling-proxy` no ar está com uma cópia anterior do `tentar-de-novo.js` 🟡 *aberto em 19/08*
Ao reaproveitar a política de repetição para a OpenAI, o arquivo
`_shared/tentar-de-novo.js` ganhou três parâmetros novos (fornecedor, prazo,
orçamento), **todos com o valor antigo como padrão** — os 19 testes provam que
quem não passa nada continua tendo exatamente o comportamento de antes.

O `bling-proxy` v11, que está no ar, subiu com a cópia de 18/08 embutida. O
comportamento dele é idêntico, então **não há defeito** — o que há é código do
repositório diferente do código no ar, e isso é o tipo de coisa que morde daqui a
três meses. Fecha sozinho no próximo deploy da `bling-proxy`; não vale subir só
por isso, porque ela acabou de ser estabilizada.

### B23 · Barra de Topo › o lado das ações não encolhia ✅ *fechado em 20/08*

**O que era.** `.bt-dir` — o lado direito da `barra-de-topo`, onde as ações
moram — era `flex: 0 0 auto`. Ela reservava sempre o *conteúdo máximo* dos
filhos, e o `.bt-meio` (título + subtítulo) ficava com o que sobrasse. Nas telas
de faixa larga o título era esmagado até zerar. Medido a 768px, antes:

| Tela | altura da barra | título |
|---|---|---|
| Gestão à Vista | 732px | 0px, **19 linhas** |
| Análise de Campanhas | 685px | 0px, 18 linhas |
| Gestão de Tráfego | 632px | 0px, 15 linhas |
| Análise de Vendas | 513px | 0px, 15 linhas |

Uma letra por linha, e a barra comendo 600–700px de uma tela de 900px. Não era
um caso extremo: era o estado normal dessas quatro telas em tablet.

**O conserto.** `flex: 0 1 auto; min-width: 0` em `.bt-dir`. As mesmas quatro
telas passam a ter barra de 93 a 108px e título em 2 linhas legíveis.

**Conferido nas 25 telas que usam a barra**, em 7 larguras (1920, 1440, 1280,
1024, 768, 640, 375), comparando antes × depois na mesma página: **6 melhoraram,
19 ficaram idênticas, nenhuma piorou.** O único custo são 26–27px a mais de
barra a 1024px na Análise de Campanhas e na Gestão de Tráfego, onde a faixa de
controles passa a quebrar em duas fileiras em vez de esmagar o título — que é
exatamente o que esta barra promete fazer.

⚠️ **A regra nova para quem puser faixa larga na barra:** o que não encolhe não
fica menor, **vaza para fora da barra**. Uma régua de botões precisa de
`min-width: 0` e `overflow-x: auto`. A Análise de Campanhas não tinha e ficou com
três botões pendurados 17px além da borda; foi corrigida junto.

### B24 · Separação atacado/varejo ✅ *fechada em 20-21/08 — as quatro peças no ar*

Cada canal do Bling tem um **grupo** (`bling_lojas.grupo`), configurável em
**Config de Admin › Canais de venda**. O grupo é do CANAL, não do time: dos 14
canais só 3 têm time, e o time herda pelo `canal_loja_id`.

| Peça | O que entrou |
|---|---|
| 1 | a coluna, a política de escrita e a tela de configuração |
| 2 | o seletor das dashboards com um bloco por grupo e marcar/desmarcar todos |
| 4 | os cards de time da gestão de usuários sob cabeçalho de grupo |
| 3 | **o alcance da supervisora**, nas três camadas |

**A regra da Peça 3:** supervisora vê todos os canais do **grupo** dos times onde
ela é supervisora; **gestor** (a "gerente" da fala do dono) e **vendedora** seguem
vendo só a loja delas. Canal sem grupo **não amplia nada** — e isso jamais pode
virar "vê tudo".

Entrou nos três lugares, porque só na tela não vale (o front é público):
`_shared/canais-de-venda-permitidos.js`, a edge `bling-proxy` e `pode_ver_canal`.
Provado no banco com a trava armada, dentro de `rollback`, nos quatro cenários —
`docs/provar-alcance-da-supervisora.sql`.

⚠️ **Hoje isso não muda nada para ninguém:** os 4 membros de time são todos
`vendedora` e nenhum canal tem grupo. A regra só passa a valer quando o dono
marcar os grupos e promover alguém a supervisora.

**O estoque não entrou.** `pode_ver_estoque` tem regra própria e mais apertada
("estar no time não basta"), escrita de propósito.

⚠️ **Achado de segurança que continua aberto:** existem **dois "superadmin"** —
a coluna `profiles.is_superadmin`, que é o que a tela usa, e a função
`public.is_superadmin()`, que confere o e-mail contra uma **lista de três cravada
no código**. Hoje concordam. Se alguém marcar a coluna para uma quarta pessoa,
divergem, e essa pessoa vê telas onde não consegue salvar. Unificar é decisão do
dono.

### B25 · A `bling-proxy` ficou fora do ar por alguns minutos em 21/08 ✅ *fechado no mesmo dia*

**O que houve.** Ao subir a Peça 3, a edge ganhou uma variável `canais`… e já
havia um `const canais` logo abaixo, com o resultado de `canaisDoEscopo`.
`Identifier 'canais' has already been declared`. A função entrou em BOOT_ERROR —
**503 em toda chamada** — e com ela as duas dashboards de venda, porque é a
`bling-proxy` que busca os pedidos no Bling. Foi por volta de meia-noite (03:00Z),
a janela mais vazia, e durou poucos minutos até o conserto.

**Por que passou.** `npm test` roda os `.js` de regra do `_shared` e `npm run
build` compila o `src/`. **Nenhum dos dois olhava os `index.ts` das edges** — e
elas não sobem com push, vão à mão. Dava para ter suíte verde, build limpo,
subir, e só descobrir no primeiro clique.

**O que fechou o buraco.** `supabase/functions/toda-edge-compila.test.mjs`, irmã
de `todo-vue-compila.test.mjs`: manda cada `.ts`/`.js` das edges pelo esbuild só
para parsear. Foi conferido que ela REPROVA o defeito real — o `canais`
duplicado foi reintroduzido de propósito e ela pegou.

⚠️ **A regra que fica:** depois de subir edge, **chamar a função** e conferir que
volta o erro da PRÓPRIA função (aqui, `401 "nao autenticado"`) e não o `503
BOOT_ERROR` da plataforma. Deploy que não boota só aparece no primeiro clique.

---

### B25 · Frota › o aviso de reserva decidida 🟡 *banco e servidor prontos em 21/08; falta o deploy da tela*

**O que é.** Aprovar ou recusar uma reserva não avisava ninguém — quem pediu só
descobria abrindo o app.

**Já está feito (21/08):**

- ✅ **Migration `052_push_tipo_reserva.sql` aplicada.** O CHECK de
  `push_preferencias.tipo` aceita `frota_reserva`. Provado com `rollback`:
  dentro da transação o insert passou, e o banco ficou com zero linha do tipo.
- ✅ **Edge `avisar-decisao-de-reserva` publicada** (com as três deps de
  `_shared`). Provada rodando: chamada sem crachá é barrada pela porta de fora
  (401), e com o crachá de quem não aprova ela mesma responde
  `{"ok":false,"erro":"sem_permissao"}` — ou seja, o portão do servidor fecha,
  e não só o da tela.

**Falta:**

1. **Subir a tela** (as mudanças estão na branch `melhoria/frota-retirada-e-tutorial`,
   não na main). Enquanto não subir, o interruptor novo não aparece e a tela não
   chama a função — nada muda para ninguém.
2. Depois disso, ligar **"Resposta do pedido de carro"** em Administração ›
   Usuários para quem pede carro — ela nasce desligada, como toda chave nova.

**Não há risco em ficar como está.** Provado na tela nos dois desfechos: com a
função fora do ar, a decisão é gravada do mesmo jeito e quem decidiu lê *"Reserva
aprovada. Não consegui avisar quem pediu — fale com a pessoa."* Já é melhor que
hoje, que é silêncio.

**Alcance medido em 20/08:** das 14 pessoas que podem pedir carro, **8 têm
aparelho registrado** para push. WhatsApp alcançaria 6, e 2 dessas nem ficha de
colaborador têm — o push é o melhor canal único. As 6 restantes continuam
dependendo de alguém avisar, e é por isso que a tela diz isso a quem decide.

## Parte C — Ideias guardadas (ninguém pediu ainda)

### C2 · Gestor de Tráfego › subir campanha por upload 🟡 *metade já está de pé — conferido em 18/08*
Ideia do dono (12/07). **Conferido no código em 18/08, e a premissa mudou: o
upload de UM arquivo já existe e funciona.**

**O que já está no ar** (`_gtNovoEnviarImagem`, na tela da Gestão de Tráfego):
escolher um arquivo → Storage do projeto → Meta → hash. Aceita PNG, JPEG, MP4 e
MOV. Vídeo segue outro caminho de propósito (quem baixa é a Meta, pelo `file_url`,
porque dezenas de MB estourariam o limite da função). Confere o tamanho **antes**
de subir (`imagemServe`), porque descobrir que a Meta recusa depois do upload é o
pior momento. Provado em `validar-envio-de-imagem.mjs` (4/4).

**O que falta, e é o que sobra do C2:**
1. **Em massa.** O seletor não tem `multiple` — é um arquivo por vez.
2. **Normalizar o formato sozinho.** Hoje `imagemServe` só **recusa** o que não
   serve. O pedido era converter: PNG→JPG, achatar transparência e redimensionar
   para Feed 1:1 e Story 9:16. Nada disso existe.

Reaproveitar, não reconstruir: `fabrica_objetivos`, `criarCampanhaNova` e
`coletor/lib/meta-subir.mjs` já fazem a subida.

## Como manter esta lista

- Item que fecha **sai** daqui (a história fica no commit e nos planos de
  `docs/superpowers/`). Não deixar item morto ocupando espaço.
- Item que o dono **adia** fica, com a data e o motivo — como o A7 e o A9.
- Item novo entra com **o porquê**, não só o quê. "Falta X" sem o motivo vira
  item que ninguém entende em duas semanas.
- Ao encostar num assunto, reler o item aqui **antes** — vários guardam um
  cuidado que já custou caro (o "Marca" do A3, o `pages_manage_posts` do A7, o
  `balance` do C1).
