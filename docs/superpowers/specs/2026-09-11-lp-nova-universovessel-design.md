# A LP nova da VESSEL — o desenho

**Data:** 11/09/2026
**Substitui:** a página que hoje está em `vesselbrasil.com.br/universovessel`
**Pedido por:** o dono, em 11/09/2026

---

## O que é, em uma frase

Uma página nova para `vesselbrasil.com.br`, institucional e comercial ao mesmo
tempo, que apresenta a marca em sete blocos e termina sempre na mesma pergunta:
**visitar uma loja ou comprar pelo site.**

A página de hoje existe para captar contato. A nova continua captando — o
convite não morre —, mas o cadastro deixa de ser o fim e passa a ser **a porta**:
quem se cadastra é levado, na hora, a escolher um dos dois caminhos.

---

## Por que existe

A página de hoje foi feita para um lançamento: lista de espera, contagem
regressiva, "saber primeiro". O lançamento aconteceu. O que a marca precisa
agora é diferente — mostrar que existe autoria, ateliê próprio e processo, e
levar a pessoa a uma loja ou à loja online.

O dono resumiu o alvo: *"a landing precisa deixar a pessoa desejar antes de
explicar."*

---

## Onde o trabalho acontece

Em **dois repositórios**. Não é escolha de desenho; é onde as coisas moram.

| repositório | o que entra |
|---|---|
| `vessel-brasil` | a página, o estilo, os textos, o vídeo, as fotos |
| `iamundi` | a migração do banco e a mudança na função `vessel_entrar_na_lista` |

As migrações da Vessel sempre moraram no `iamundi/db/migrations/`, junto das
irmãs. Separá-las agora criaria um segundo lugar para procurar.

**Bancadas isoladas, uma em cada repositório**, porque há outras janelas
trabalhando nos dois ao mesmo tempo:

- `vessel-brasil/arvores/lp-nova` — branch `feat/lp-nova`
- `iamundi/arvores/lp-nova-banco` — branch `feat/lp-nova-objetivo-e-loja`

---

## Como vai ao ar

A página nova nasce em **`/universovessel-novo`**, publicada de verdade, com a
atual intacta ao lado. O dono abre no celular dele, reprova, corrige-se, olha de
novo — sem que nenhum visitante veja obra em andamento.

Enquanto estiver em teste ela leva `<meta name="robots" content="noindex">`. Sem
isso o Google acha a página inacabada e passa a mostrá-la nos resultados, e
tirar de lá depois é lento.

**A virada, quando aprovada:** o conteúdo passa a ocupar `/universovessel` e o
endereço de teste sai. Quem tiver o link antigo continua chegando; quem entra
pela raiz cai no lugar certo, pelo desvio que já existe.

⚠️ **Os desvios são temporários (307), nunca permanentes.** Este domínio já
mudou de capa três vezes (save the date → `/prevenda` → `/universovessel`).
Desvio permanente fica gravado no navegador de quem visitou e não sai quando o
destino muda de novo.

⚠️ **Duas regras por caminho, com e sem a barra no fim.** A Vercel casa o
caminho exato: `/universovessel` e `/universovessel/` são endereços diferentes.
Uma regra só deixaria metade das pessoas na página velha, calado. Já mordeu
neste domínio; tem teste.

---

## Os arquivos

A página de hoje é **um arquivo de 1.301 linhas** — 599 de estilo e 430 de
comportamento, tudo embutido. A nova é maior (sete blocos em vez de seis, vídeo,
modal e dois idiomas) e no mesmo formato passaria de duas mil linhas.

Ela se divide em quatro, servidos direto, sem etapa de build (o projeto não tem
nenhuma, e não é hora de introduzir uma):

| arquivo | o que guarda |
|---|---|
| `universovessel-novo/index.html` | só a estrutura e o conteúdo |
| `universovessel-novo/estilo.css` | cores, medidas, os sete blocos |
| `universovessel-novo/textos.mjs` | português e inglês, frase por frase, lado a lado |
| `universovessel-novo/pagina.mjs` | revelação, vídeo, troca de idioma, convite |

O motivo de separar os textos não é arrumação: com dois idiomas, frase solta no
meio do HTML significa procurar a mesma frase em dois lugares e esquecer um.

**Reaproveitado de fora:** `/regras-da-lista.mjs` (validação do cadastro e forma
canônica do WhatsApp), as cores e a fonte da marca, e o vocabulário de movimento.

⚠️ **Uma duplicação deliberada.** A máquina do convite e do formulário está hoje
escrita dentro de `universovessel/index.html`. Ela é **copiada** para a página
nova, não extraída. Extrair exigiria mexer no que está no ar agora; a repetição
dura poucos dias e morre quando a página velha se aposenta.

---

## Os sete blocos

**Regra que atravessa a página:** os dois caminhos aparecem em três lugares
(topo, depois do cadastro, fechamento) e se comportam igual. Quem já se
cadastrou vai direto ao destino; quem não, abre o convite primeiro e cai nos
dois cartões ao terminar. Sem isso, o botão do topo seria um furo na captação —
a pessoa clicaria em SHOP NOW e sairia do site sem nunca entrar no banco.

### 1 · Hero
Foto do ensaio de 07/09 sangrando na tela inteira. `VESSEL` e
*A new expression of Brazilian luxury.* O título se escreve palavra por palavra,
atrás de máscara. Os dois caminhos embaixo. O convite abre sobre ele quando a
cortina de carregamento sai.

**Em aberto:** a foto. São 424 candidatas; entram como proposta com a imagem ao
lado, e o dono escolhe.

### 2 · Autoralidade
*Designed by hand. Created with intention.*

⚠️ **Diverge do que o dono descreveu, e o motivo está medido.** Ele pediu
"desenho/esboço da Raíssa + produto final". Os 9 desenhos que existem no
repositório (`fotos/cartao/desenhos/`: ALBA, CERNE, ELARA, LINEAR, LUNEA,
MAELLE, MAREA, ORIANE, SOLENNE) são **desenho técnico** — o mesmo que vai
impresso no cartão EAN. Ao lado do produto pronto, isso lê como catálogo, não
como autoria.

**O vídeo tem material melhor:** aos ~4 segundos aparecem os moldes de papel
sobre o couro, com o cartão **ELARA MINI** ao fundo. É trabalho real,
fotografado. Proposta: esse quadro ao lado da ELARA pronta.

Se houver esboço em papel, ele ganha dos dois.

### 3 · Ateliê
*Handmade. Technology perfected.*

O vídeo, em repetição, mudo, 10 a 12 segundos: molde → marcação → máquina →
acabamento. Detalhes em "O vídeo", abaixo.

### 4 · Os objetos de desejo
Três ou quatro modelos, foto grande, nome, uma linha. Sem descrição técnica.

**Quais:** os que aparecem no ensaio de 07/09 — a direção do ensaio já escolheu
o que mostrar, e a página fica coerente com a campanha. Identificar os modelos
nas 424 fotos é trabalho de olhar imagem, feito na execução.

**Em aberto:** o "Shop" de cada bolsa pode ir para a página daquele produto na
Shopify, mas exige casar cada modelo com o endereço dele na loja. Se não der,
vai para a coleção inteira.

### 5 · Rastreabilidade
*Every piece has an identity.*

É o bloco que a Vessel **pode provar** e quase nenhuma marca pode: etiqueta NFC,
número de série por peça, certificado no ar em `/verify/<código>`.

Mostrar um certificado de verdade, não uma ilustração. ⚠️ Usar um código de
demonstração, **nunca a peça de uma cliente real** — a página do selo mostra
onde a peça foi comprada.

### 6 · Made in Brazil
*Designed. Crafted. Made in Brazil.* Bloco limpo, uma imagem só.

Candidata: o último quadro do vídeo — mãos assentando a costura de uma bolsa
amarela a martelo —, parado.

### 7 · Fechamento
*Experience Vessel.* A frase e os dois caminhos pela última vez. Sem formulário,
por decisão do dono.

---

### Observação registrada, e recusada pelo dono

Na ordem pedida, os blocos 2, 3, 5 e 6 são todos argumento de marca — quatro
seguidos explicando, com um único bloco comercial no meio. Foi levantado que
subir as bolsas para logo depois da autoralidade serviria melhor ao próprio alvo
dele ("desejar antes de explicar").

**O dono manteve a ordem** ("mantém o plano", 11/09). Fica escrito para não
virar dúvida de novo.

---

## O convite e os dois caminhos

1. A cortina de carregamento sai → o convite abre.
2. Nome, e-mail, WhatsApp — com o código do país como campo separado e a máscara
   dependendo dele (conserto de 11/09/2026).
3. Grava.
4. **O mesmo cartão troca de conteúdo**: no lugar do formulário, os dois
   caminhos. Não é fechar uma janela e abrir outra — é a mesma janela virando a
   página, senão a pessoa sente que foi jogada em outro lugar.
5. A escolha grava o objetivo (e a loja, no caso da visita).

**Os dois cartões:**

| cartão | texto | destino |
|---|---|---|
| Visita | agendar sua visita à loja para uma experiência exclusiva com nossa personal shopper | grava `objetivo=visita` + `loja`; a equipe entra em contato pelo WhatsApp deixado |
| Loja online | garantir sua peça Vessel pelo site, na comodidade de sua casa | grava `objetivo=ecommerce` e leva à loja |

Quem fecha o convite sem se cadastrar não o vê de novo (memória do navegador),
mas os botões do topo e do fechamento o reabrem.

⚠️ A memória do navegador **estoura em janela anônima**. A leitura vai em
try/catch; sem isso o erro derruba a página inteira junto.

---

## O banco

### O problema que a decisão de cadastrar primeiro cria

O dono decidiu **cadastrar primeiro e perguntar depois** — e está certo: se a
escolha viesse antes, quem desistisse no meio sumiria sem deixar contato.

Isso significa **duas escritas**: a pessoa entra no banco, e só depois diz o que
quer.

⚠️ **A segunda escrita é o risco.** Se a página puder dizer "grave visita na
linha 412", qualquer visitante pode dizer isso sobre qualquer linha — e a lista
de espera é dado de cliente.

**A saída:** `vessel_entrar_na_lista` passa a devolver uma **senha de uso único**,
guardada no banco só como impressão digital. A segunda escrita
(`vessel_marcar_objetivo`) só é aceita com ela na mão. A porta pública continua
sendo porta pública: RLS ligada, zero políticas, escrita só por função
`security definer` — o mesmo padrão do selo.

### As colunas

Em `vessel_lista_espera`:

| coluna | o que guarda |
|---|---|
| `objetivo` | `visita`, `ecommerce`, ou nulo (cadastrou e não escolheu) |
| `loja` | qual loja, quando o objetivo é visita |

⚠️ **`loja` já nasce aceitando as duas lojas abertas** (Tivoli Santa Bárbara e
Iguatemi Campinas). A tela grava Iguatemi por ora, porque foi o que o dono
pediu; o seletor é trabalho de tela depois, sem migração nova. **Não cravar
"Iguatemi" no código** — lista escrita à mão envelhece, e duas lojas fecharam
este ano.

⚠️ **Cuidado com lista fechada (`CHECK`) no valor do objetivo.** Já aconteceu
neste projeto de um `CHECK` na trilha derrubar a transação inteira quando chegou
um valor novo. Se houver trava, ela tem que ser fácil de estender, e a trilha de
auditoria não pode recusar valor desconhecido.

⚠️ **Conferir a migração contra as irmãs** antes de aplicar — já subiu tabela
sem a trava que todas as outras tinham, e nove revisões não pegaram.

⚠️ **Nunca mandar o runner aplicar as migrações pendentes.** Neste projeto o
registro está zerado; aplica-se uma por uma, à mão.

### O espelho

O robô `vessel-espelhar-lista` (cron a cada 15 min) leva os cadastros ao Bling e
ao CSV do Zoho. Quem trabalha nessas duas ferramentas precisa **ver** o objetivo,
senão a informação existe e ninguém usa.

**Proposta:** coluna nova no CSV do Zoho; o campo `codigo` do Bling fica como
está (`LP-<AAAAMMDD>-<id>`) — mexer no formato quebraria o padrão das linhas que
já existem.

---

## O Chatwoot

⚠️ **Chegou em 11/09/2026, de outra janela, enquanto este desenho era escrito.**

Cada cadastro, além do banco, é repassado a `/api/lista-espera` — um endereço no
próprio servidor que guarda `CHATWOOT_LISTA_ESPERA_SECRET` e repassa ao Chatwoot.
Não dá para chamar o Chatwoot do navegador: exporia o segredo, e o CORS dele só
libera `/api/*`.

É **disparo sem espera**: se o Chatwoot cair, o cadastro não se perde, o erro só
vai ao console. O que importa é o Supabase.

**A página nova tem que fazer o mesmo.** Sem isso, todo cadastro vindo dela
sumiria do atendimento.

⚠️ **A medir, não supor:** se o Chatwoot aceita o campo de objetivo ou o
descarta calado. O Bling fez exatamente isso com `observacoes` — aceitou no
envio, respondeu sem reclamar, e descartou. Medir antes de prometer ao dono que
o atendimento vai saber quem pediu visita.

---

## O vídeo

**Origem:** `WhatsApp Video 2026-09-10 at 14.24.03.mp4` — 576×1024, 19,9s, 30
quadros por segundo, 3,9 MB, **sem faixa de áudio**.

**O que tem dentro,** conferido quadro a quadro:

| momento | o que aparece |
|---|---|
| ~0–2s | o rolo de material sendo aberto na mesa de corte (aparece um rosto) |
| ~4s | moldes de papel sobre o material, cartão **ELARA MINI** ao fundo |
| ~8s | **a mão marcando o molde à caneta** — o quadro mais forte |
| ~12s | **a máquina** — o lado "technology" da frase |
| ~16s | mesa com cola, material sendo levantado |
| ~19s | **mãos assentando a costura de uma bolsa amarela a martelo** |

**Tratamento:** corte para 10–12 segundos, ficando com molde, marcação, máquina
e acabamento. Saem o rosto do começo e a mesa com cola. Volta sem começo nem fim
perceptíveis. Alvo de peso: ~2 MB.

⚠️ **576×1024 é resolução de WhatsApp.** Em pé, no celular, ocupando a tela,
funciona. Esticado na largura de um monitor, fica mole. **No computador entra
como painel em pé ao lado do texto**, no tamanho que a imagem aguenta. Se
aparecer o arquivo original, ele pode ocupar mais.

⚠️ **Quadro de capa obrigatório**, e ele é o que fica para quem pediu menos
animação no sistema. Nunca apostar conteúdo em vídeo que talvez não toque.

Ferramenta: `ffmpeg` (8.1.2), já instalado na máquina.

---

## Os dois idiomas

**Padrão:** português, com os títulos em inglês, como o dono escreveu. Botão
`PT · EN` no topo troca a página inteira.

A escolha fica lembrada no navegador (dentro de try/catch, ver acima) **e
aparece no endereço** (`?idioma=en`).

O endereço não é enfeite: sem ele não há como mandar a versão em inglês para
ninguém — o link sempre abriria em português. O atributo `lang` da página muda
junto, que é o que leitor de tela e buscador leem.

---

## O vocabulário de movimento (herdado, não reinventado)

O dono reprovou uma versão anterior com uma frase que vale repetir:
**"a animação seca de aparecer das coisas está feia".**

- **Nada aparece por opacidade.** Desbotar parece template. A revelação é por
  **máscara**: o elemento sobe de trás de uma borda que o esconde.
- **Uma curva só na página inteira:** `cubic-bezier(.16,1,.3,1)`.
- Título palavra por palavra, cada uma com máscara e atraso próprios.
- Foto com contra-movimento: a cortina sobe e a imagem desce ao encontro dela.
- `prefers-reduced-motion` respeitado.
- **Cortina de carregamento com piso de tempo** (~1,4s) e teto (~3s). Loader que
  ninguém vê é loader que não existe — já houve reclamação de que "não colou o
  círculo", e o círculo estava lá, saindo em 120ms.

⚠️ **A armadilha que apaga conteúdo para sempre:** `clip-path` que esconde um
elemento **zera a área dele**, e o observador de entrada na tela calcula por
área visível. Área zero nunca cruza o limite, o gatilho nunca dispara, e a foto
some. **Observar o elemento PAI** e revelar por CSS descendente. E uma rede de
segurança: passados alguns segundos, o que ainda estiver escondido aparece de
qualquer jeito.

⚠️ **Caminho de import sempre absoluto.** Ao mover a LP para `/universovessel` um
import relativo apontou para o lugar errado e quebrou a validação **sem erro na
tela**.

---

## As provas

Antes de chamar o dono para olhar:

1. **Os dois idiomas têm exatamente as mesmas frases.** Teste que quebra se uma
   tradução faltar. É o defeito mais provável de uma página bilíngue, e o mais
   silencioso.
2. **Os desvios de endereço**, com e sem barra no fim.
3. **Medida a 375px em navegador de verdade, com régua** (`getBoundingClientRect`
   pelo DevTools Protocol) — ⚠️ a foto de tela **mente**: renderiza num viewport
   largo e reduz.
4. **O vídeo** toca mudo e em repetição; com movimento reduzido, fica a capa.
5. **A migração** roda numa transação contra a produção e volta atrás no fim.
6. **O caminho inteiro no ar:** cadastro pela **porta pública** (a chave que está
   dentro da própria página — um atalho pelo banco provaria o caminho errado),
   conferir a linha, escolher um dos dois cartões, conferir o objetivo gravado,
   e **apagar a linha de teste dos dois lados**.
7. **Responsivo em todos os aparelhos**, não só no celular e no monitor.

---

## O que depende do dono (bloqueios)

| # | o que é | por que trava |
|---|---|---|
| 1 | **O endereço da loja online.** Ela responde em `y3m93e2yvszg.vesselbrasil.com.br`; `loja.vesselbrasil.com.br` não resolve. | Numa LP de luxo esse endereço aparece na barra do navegador. O conserto é um CNAME no Registro.br — clique do dono, não código. ⚠️ **Nunca trocar os servidores de DNS pelos da Vercel: isso mata o e-mail Zoho.** |
| 2 | **A foto do hero.** | Proposta entre as 424 do ensaio; a escolha é dele. |
| 3 | **Os 3–4 modelos do bloco 4.** | Proposta a partir do ensaio; a escolha é dele. |
| 4 | **O vídeo original**, se existir antes do WhatsApp. | Define o quanto o vídeo pode ocupar no computador. |
| 5 | **Esboço em papel da Raíssa**, se existir. | Melhoraria o bloco 2 mais que qualquer outra imagem. |

---

## Fora de escopo (registrado para não voltar como dúvida)

- **Agendamento de verdade** (dia e horário na página). O dono escolheu que a
  equipe entra em contato. Agendamento seria um sistema próprio: tabela de
  horários, quem atende, o que fazer quando ninguém confirma, aviso para a loja.
- **Seletor de loja na tela.** O banco já nasce pronto; a tela vem depois.
- **Formulário no bloco 7.** Decisão do dono.
- **Aposentar a página de hoje.** Ela só sai depois que a nova for aprovada.
- **Faxina das 30 árvores de trabalho do iamundi**, a maioria de agosto. Assunto
  separado.
