<template>
  <div class="tela-autenticidade">
    <barra-de-topo voltar="Gestão Interna" titulo="Autenticidade e Garantia" @voltar="voltar" />

    <!-- ── O MENU DE ABAS ───────────────────────────────────────────────
         É A BARRA `.abas` DA CASA, a mesma da Frota, do Patrimônio e dos
         Acessos — e não uma barra própria. A entrega anterior inventou uma
         (`.abas-barra`, com fundo e moldura, rolando por dentro) e o dono viu
         na hora que esta tela tinha ficado diferente das irmãs. A barra global
         já resolve o que a nova foi inventar, inclusive os 40px de alvo de
         toque, corrigidos para as quatro telas em 19/08.
         Ela tem `flex-wrap:wrap`: com cinco itens quebra em duas linhas no
         celular, e é assim que as irmãs se comportam.

         A BARRA MOSTRA A SEQUÊNCIA, porque a ferramenta é um caminho e não um
         armário: 1 Lotes → 2 Gravar → 3 Etiquetas é a ordem em que se faz.
         Garantias e Alertas ficam do outro lado do separador porque não são
         passos: são consulta. Numerar os cinco mentiria sobre o fluxo.

         O `aria-selected` continua: a ativa não se distingue só pela cor (o
         sublinhado do global também é cor), e é isso que o leitor de tela
         anuncia. O número é `aria-hidden` e volta no `aria-label` como
         "Passo 1: Lotes" — ouvir "um lotes" não ajuda ninguém. -->
    <!-- A BARRA FICA SEMPRE. Ela sumia no "modo bancada" — o remendo que esta
         entrega desfez: se a aba precisava de um modo para ficar usável, a aba
         devia SER aquilo. Agora a aba 2 já é a bancada, não há modo para entrar
         nem para sair, e a barra não tem por que sumir. -->
    <div class="abas" role="tablist">
      <template v-for="ab in ABAS" :key="ab.chave">
        <span v-if="ab.separaAntes" class="au-abas-sep" aria-hidden="true">·</span>
        <button role="tab" type="button" :data-aba="ab.chave" :aria-label="ab.leitura"
                :aria-selected="String(aba === ab.chave)"
                :class="{ on: aba === ab.chave }" @click="aba = ab.chave">
          <span v-if="ab.n" class="au-aba-n" aria-hidden="true">{{ ab.n }}</span>{{ ab.rotulo }}
        </button>
      </template>
    </div>

    <!-- A AJUDA CURTA DA ABA, dentro dela. O guia inteiro ninguém reabre: quem
         cai na aba Alertas seis meses depois não vai procurar um guia para
         descobrir o que aquela lista significa. Os textos moram em
         `tutorial.js`, e há teste que reprova aba sem verbete. -->
    <!-- NA ABA GRAVAR ELA NÃO APARECE, e é o único lugar em que isso vale: ali a
         tela é uma bancada, e quem grava a terceira etiqueta não lê parágrafo
         nenhum. O que ela dizia continua inteiro no guia, atrás do "?" do alto
         do painel — que é o que o PADRÃO manda fazer com instrução. -->
    <p v-if="aba !== 'gravar'" class="au-ajuda">{{ AJUDA_DA_ABA[aba] }}</p>

    <p v-if="carregando" class="au-vazio">Carregando…</p>
    <p v-else-if="falha" class="au-erro">{{ falha }}</p>

    <!-- ── LOTES ────────────────────────────────────────────────────────── -->
    <template v-else-if="aba === 'lotes'">
      <div class="au-topo-acao" v-if="podeCriar">
        <button class="au-botao" type="button" @click="abrirFormulario">Gerar lote de etiquetas</button>
      </div>

      <p v-if="!lotes.length" class="au-vazio">
        Nenhum lote criado ainda. Um lote é uma fornada de bolsas do mesmo modelo — cada
        peça sai com o seu próprio código.
      </p>

      <!-- ── A BUSCA E O ARQUIVAMENTO ────────────────────────────────────
           A aba abre nos EM ANDAMENTO. Com 50 lotes ela virava um muro, e o
           que a pessoa procura é sempre a fornada que está na bancada.
           NADA SOME DE VERDADE: o botão logo abaixo diz quantos estão
           encerrados e traz todos de volta, e a contagem do painel diz sempre
           "N de M". Não há coluna nova no banco: encerrado é o lote em que toda
           peça já foi gravada ou baixada, contado na hora. -->
      <PainelDeBusca v-else v-model:filtro="filtroDeLotes"
                     :atalhos="ATALHOS_DE_DATA" :estados="ESTADOS_DE_LOTE"
                     rotulo-da-data="Fabricado em" estado-padrao="andamento"
                     dica="Número de série, código, modelo, cor, data — ou qualquer campo"
                     :contagem="contagemDeLotes" />

      <div v-if="lotes.length" class="au-acoes">
        <button v-if="filtroDeLotes.estado === 'andamento'" class="au-botao secundario" type="button"
                :disabled="!lotesEncerrados" @click="verEncerrados">
          Ver encerrados ({{ lotesEncerrados }})
        </button>
        <button v-else class="au-botao secundario" type="button" @click="verEmAndamento">
          Voltar aos em andamento
        </button>
      </div>

      <!-- A tela nunca mente: "nada encontrado" e "não há lote nenhum" são
           coisas diferentes, e a segunda já foi dita lá em cima. -->
      <p v-if="lotes.length && !lotesVisiveis.length" class="au-vazio">
        Nenhum lote com esse recorte. Há {{ lotes.length }} lote(s) no total — mude a busca,
        o período ou o estado, ou aperte “Limpar a busca”.
      </p>

      <!-- NO COMPUTADOR ESTA LISTA VIRA GRADE (duas colunas por volta de 1000px,
           três a partir de 1400px). A classe é só o gancho do `@media
           (min-width)` do fim do arquivo: no celular ela não pinta nada, e a
           coluna única de hoje fica exatamente como está. -->
      <div class="au-lista au-grade-de-lotes">
        <!-- `data-lote` é o gancho de `trazerOLoteParaAVista`: quando o cartão
             abre, ele sobe para a primeira linha da grade (o `order:-1` do CSS)
             e a tela rola até ele. Sem o atributo, a rolagem não tem como achar
             o cartão certo entre seis iguais. -->
        <div v-for="l in lotesVisiveis" :key="l.id" class="au-card" :data-lote="l.id">
          <div class="au-card-topo">
            <span class="au-modelo">{{ l.modelo }}</span>
            <span class="au-progresso">{{ progressoDoLote(pecasDoLote(l.id)).texto }} gravadas</span>
          </div>
          <div class="au-card-linha">
            <!-- O ESTADO DO LOTE, ESCRITO. Sem ele, "encerrado" seria uma regra
                 invisível que só se percebe quando o lote some da lista. O selo
                 sai das classes prontas do PADRAO, nunca de cor à mão. -->
            <span class="selo" :class="marcaDoLote(l.id).selo">{{ marcaDoLote(l.id).rotulo }}</span>
            <span v-if="l.cor">{{ l.cor }}</span>
            <!-- A REFERÊNCIA CRUA CONTINUA AQUI, e é de propósito (PADRÃO item 8).
                 O número de série leva só os DÍGITOS dela: as letras ("H", "S")
                 não entram nele em lugar nenhum, e sem esta linha elas sumiriam
                 da tela inteira. Este é o lugar delas — junto do modelo e da cor,
                 que também são do lote e não da peça. -->
            <span v-if="l.sku" class="au-ref">ref. {{ l.sku }}</span>
            <!-- ⚠️ O AVISO DA AMBIGUIDADE, no lugar em que se VÊ o lote.
                 O texto inteiro está a um clique de "Editar", logo abaixo, e é
                 lá que ele mora — aqui caberia um parágrafo por cartão. O selo
                 existe porque sem ele, para achar a referência problemática,
                 seria preciso abrir a edição de um lote por vez.
                 Ele não aparece hoje em lote nenhum: toda referência tem quatro
                 dígitos. Aviso que aparece sempre vira paisagem (PADRÃO item 9). -->
            <span>{{ l.quantidade }} {{ l.quantidade === 1 ? 'peça' : 'peças' }}</span>
            <span>{{ dataCurta(l.fabricado_em) }}</span>
          </div>
          <!-- A AÇÃO PRINCIPAL DO CARTÃO, e a única com desenho de botão. As
               outras três — ver as peças, editar, excluir — continuam links, e é
               essa diferença que diz qual delas a tela quer que você faça
               (PADRÃO item 3: uma ação principal por bloco). Como link, ela tinha
               exatamente o mesmo peso das outras três, e quatro do mesmo peso é o
               mesmo que nenhuma. -->
          <button class="au-botao secundario au-card-acao" type="button"
                  @click="irGravar(l.id)">Gravar as etiquetas deste lote →</button>

          <!-- AS AÇÕES DO LOTE FICAM TODAS NA MESMA LINHA. "Ver as peças" entra
               aqui e não numa linha própria: duas fileiras de link uma embaixo
               da outra empurram o cartão seguinte para fora da vista no
               celular. Editar e Excluir continuam atrás de `podeEditar`. -->
          <div class="au-lote-acoes">
            <button class="au-link" type="button" :aria-expanded="String(loteAberto === l.id)"
                    @click="alternarPecas(l.id)">
              {{ loteAberto === l.id ? 'Esconder as peças' : 'Ver as peças e os links' }}
            </button>
            <template v-if="podeEditar">
              <button class="au-link" type="button" @click="abrirEdicao(l)">Editar</button>
              <button class="au-link" type="button" @click="pedirExcluir(l.id)">Excluir</button>
            </template>
          </div>

          <!-- A PERGUNTA DE EXCLUIR MORA NA PRÓPRIA TELA: a caixinha nativa do
               navegador é proibida neste projeto e `uiConfirm` não existe aqui — e
               há um teste que reprova até a palavra escrita. Quem recusa de verdade
               é o banco; a tela só traduz a recusa para português.

               SÃO DUAS PERGUNTAS, E A SEGUNDA NÃO REPETE A PRIMEIRA. A primeira
               diz o que vai acontecer; a segunda diz o que se PERDE, com o
               número de peças, e pede a senha. Duas vezes a mesma frase vira um
               "sim, sim" automático, e o segundo clique não decide nada. -->
          <div v-if="excluindo === l.id" class="au-confirma">
            <template v-if="etapaDeExcluir === 1">
              <p class="au-confirma-texto">
                Excluir o lote <strong>{{ l.modelo }}</strong> e as {{ l.quantidade }} etiquetas dele?
              </p>
              <p class="au-aviso-menor">
                Só dá para excluir lote em que nenhuma etiqueta foi gravada. Se alguma já foi,
                a tela vai dizer quantas.
              </p>
              <div class="au-acoes">
                <button class="au-botao secundario" type="button" @click="fecharExcluir">Cancelar</button>
                <button class="au-botao" type="button" @click="etapaDeExcluir = 2">Continuar</button>
              </div>
            </template>

            <template v-else>
              <p class="au-confirma-texto">
                Tem certeza? Somem para sempre os <strong>{{ pecasDoLote(l.id).length }} código(s)</strong>
                deste lote, o endereço que cada um abre e a lista de produção dele. Não dá para
                desfazer: quem encostar o celular numa etiqueta apagada passa a ler
                “este código não consta”.
              </p>
              <!-- A SENHA É FRICÇÃO, NÃO COFRE — ver `fraseDaSenha`, em lotes.js.
                   Ela segura o clique sem pensar e quem senta no computador
                   destravado. Quem manda de verdade é o portão do banco. -->
              <label class="au-campo"><span class="au-rot">Sua senha</span>
                <input v-model="senhaDaExclusao" type="password" autocomplete="current-password"
                       :disabled="exclusaoDeLoteEmVoo" @keydown.enter.prevent="excluirLote(l.id)"></label>
              <p class="au-aviso-menor">É a mesma senha com que você entra no aplicativo.</p>
              <p v-if="erroDaSenha" class="au-recusa">{{ erroDaSenha }}</p>
              <div class="au-acoes">
                <button class="au-botao secundario" type="button" @click="fecharExcluir">Cancelar</button>
                <button class="au-botao" type="button" :disabled="exclusaoDeLoteEmVoo"
                        @click="excluirLote(l.id)">
                  {{ exclusaoDeLoteEmVoo ? 'Conferindo…' : 'Excluir para sempre' }}
                </button>
              </div>
            </template>
          </div>

          <div v-if="editando === l.id" class="au-edicao">
            <label class="au-campo"><span class="au-rot">Modelo</span>
              <input v-model="edicao.modelo" type="text" maxlength="80"></label>
            <label class="au-campo"><span class="au-rot">Cor</span>
              <input v-model="edicao.cor" type="text" maxlength="60"></label>
            <label class="au-campo"><span class="au-rot">Referência</span>
              <input v-model="edicao.sku" type="text" maxlength="40"></label>
            <!-- EDITÁVEL DE PROPÓSITO: um número que só pode ser digitado na
                 criação e nunca corrigido fica errado para sempre no primeiro
                 dedo trocado — e é justamente ele que amarra a bolsa ao papel. -->
            <label class="au-campo"><span class="au-rot">O.S. (opcional)</span>
              <input v-model="edicao.os" type="text" maxlength="40"></label>
            <label class="au-campo"><span class="au-rot">Finalizado em</span>
              <input v-model="edicao.fabricado_em" type="date"></label>
            <label class="au-campo"><span class="au-rot">Quantidade</span>
              <input v-model="edicao.quantidade" type="number" min="1" max="500"></label>
            <p class="au-aviso-menor">
              Aumentar cria etiquetas novas. Diminuir tira só as que ainda não foram gravadas.
            </p>
            <div class="au-acoes">
              <button class="au-botao secundario" type="button" @click="editando = null">Cancelar</button>
              <button class="au-botao" type="button" @click="salvarEdicao">Salvar</button>
            </div>
          </div>

          <div v-if="loteAberto === l.id" class="au-pecas">
            <div class="au-pecas-topo">
              <span class="au-pecas-conta">
                Mostrando {{ pecasVisiveis.length }} de {{ pecasDoLoteAberto.length }} peça(s)
              </span>
              <button class="au-botao secundario" type="button" @click="baixarListaDoLote(l)">
                Baixar a lista inteira
              </button>
            </div>

            <p v-if="!pecasDoLoteAberto.length" class="au-aviso-menor">
              Este lote não tem peça nenhuma.
            </p>

            <!-- ── A LISTA DAS PEÇAS VIRA TABELA NO COMPUTADOR ──────────────
                 O cabeçalho mora DENTRO do `<ul>`, como primeiro item, por dois
                 motivos: o `<p v-if>` e o `<ul v-else>` são vizinhos diretos de
                 uma corrente `v-if`/`v-else` — um elemento no meio a partiria —
                 e, dentro da lista que rola (`max-height:60dvh`), ele fica
                 `position:sticky` e continua no alto enquanto a pessoa varre
                 500 peças.
                 `aria-hidden` porque ele não acrescenta informação nenhuma:
                 cada linha já diz o número e "Gravada em 12/08" por escrito. Ele
                 é ajuda de OLHO, para varrer coluna. No celular não existe:
                 `display:none` na regra-base, e só o `@media (min-width)` o
                 acende.

                 ⚠️ A PRIMEIRA COLUNA VIROU "Nº DE SÉRIE", e não ganhou uma sétima
                 coluna ao lado do código. O número da peça sozinho ("nº 3") só é
                 único DENTRO de um lote: dois lotes diferentes têm uma peça 3
                 cada. O número de série é único entre todos, é o que está
                 impresso na bolsa e é o que a cliente vê ao encostar o celular —
                 ele é o que aquela coluna sempre quis ser. Uma sétima coluna
                 mostraria o mesmo dado duas vezes e espremeria a do endereço,
                 que é a mais apertada da tabela e já tem piso medido em pixel.
                 O NÚMERO DA PEÇA NÃO SE PERDE (PADRÃO item 8): ele continua na
                 planilha que se baixa aqui do lado, em coluna própria, e volta a
                 aparecer na tela inteira quando o lote não tem referência. -->
            <ul v-else class="au-pecas-lista au-tabela-pecas">
              <li class="au-tabela-cab" aria-hidden="true">
                <span>Nº de série</span><span>Código</span><span>Estado</span>
                <span>Situação</span><span>Endereço</span><span>Ações</span>
              </li>
              <li v-for="pc in pecasVisiveis" :key="pc.codigo" class="au-peca">
                <div class="au-peca-topo">
                  <!-- O PREFIXO VEM JUNTO NO CELULAR, e some no computador: lá
                       a coluna "Nº DE SÉRIE" já diz o que o número é; aqui a
                       tabela virou cartão e o cabeçalho não existe. -->
                  <span class="au-peca-n"><span class="au-rot-serie">{{ prefixoDaSerie(pc, l) }}</span>{{ rotuloDaSerie(pc, l, { curto: true }) }}</span>
                  <span class="au-ref au-peca-cod">{{ pc.codigo }}</span>
                  <span class="selo" :class="estadoDaPeca(pc).selo">{{ estadoDaPeca(pc).rotulo }}</span>
                </div>
                <!-- o estado por escrito, nunca só pela cor do selo: gravada
                     diz QUANDO, e baixada diz POR QUÊ -->
                <p class="au-peca-estado">
                  <template v-if="pc.baixada">Baixada — {{ rotuloDoMotivo(pc.baixa_motivo) }}</template>
                  <template v-else-if="pc.gravada_em">Gravada em {{ dataCurta(pc.gravada_em) }}</template>
                  <template v-else>Ainda não gravada</template>
                </p>
                <!-- o endereço é O QUE VAI DENTRO DA BOLSA: sai de
                     `enderecoDaTag`, nunca do domínio escrito à mão -->
                <div class="au-peca-end">{{ enderecoDaTag(pc.codigo) }}</div>
                <div class="au-peca-links">
                  <button class="au-link au-peca-botao" type="button"
                          @click="copiarEnderecoDaPeca(pc.codigo)">
                    {{ enderecoCopiado === pc.codigo ? 'Copiado!' : 'Copiar endereço' }}
                  </button>
                  <!-- abre o que a CLIENTE vê, para conferir na hora. Aba nova
                       com `rel="noopener"`: sem ele a página aberta ganha uma
                       alça para esta aqui. -->
                  <a class="au-link au-peca-botao" :href="enderecoDaTag(pc.codigo)"
                     target="_blank" rel="noopener">Abrir a página da cliente</a>
                </div>
              </li>
            </ul>

            <!-- 500 peças desenhadas de uma vez travam a tela do celular. O
                 botão diz quantas ainda faltam: lista que esconde sem avisar é
                 lista que mente. -->
            <button v-if="pecasQueFaltamMostrar" class="au-botao secundario" type="button"
                    @click="mostrarMaisPecas">
              Mostrar mais {{ Math.min(pecasQueFaltamMostrar, DE_CADA_VEZ) }} (faltam {{ pecasQueFaltamMostrar }})
            </button>
          </div>
        </div>
      </div>
    </template>

    <!-- ── GRAVAR ───────────────────────────────────────────────────────── -->
    <!-- ══════════════════════════════════════════════════════════════════
         A ABA É A BANCADA. Não há mais "modo bancada".
         ══════════════════════════════════════════════════════════════════
         POR QUÊ. O dono reclamou desta aba QUATRO vezes, a última assim: "a aba
         gravar assim como as outras está uma bosta mesmo, faz o layout do zero,
         deixando 100% funcional, sem confusão, respeitando hierarquias e
         centralização".

         MEDIDO NA TELA RENDERIZADA, a 1440px, antes desta entrega: OITO blocos
         empilhados antes de a pessoa poder fazer qualquer coisa —
           1. um parágrafo de explicação
           2. os três passos (Criar / Gravar / Conferir)
           3. o link "Rever o guia de bancada"
           4. o painel de busca INTEIRO, numa aba onde se escolhe UM lote
           5. o seletor de lote
           6. o botão "Entrar no modo bancada"
           7. um parágrafo explicando esse botão
           8. a barra de progresso
         A área de trabalho começava a dois terços da página. E o progresso
         aparecia TRÊS vezes: no rótulo do seletor, na barra, e em
         "PEÇA 8 DE 20 · 6 DE 19 PRONTAS".

         A CONCLUSÃO, E ELA É O DESENHO INTEIRO: o "modo bancada" era um
         remendo. Se a aba precisa de um modo para ficar usável, a aba deveria
         SER aquilo. Escolheu o lote → trabalha. Sem entrar em modo nenhum.

         O QUE SAIU DAQUI, E PARA ONDE FOI (PADRÃO item 8, conferido item a
         item — nada some da ferramenta, tudo muda de endereço):
           · o painel de busca, os atalhos de data e o seletor de estado → a aba
             1 Lotes, que é onde se procura entre muitos. De lá, "Gravar as
             etiquetas deste lote →" traz para cá com o lote já escolhido;
           · a única coisa que a busca daqui fazia e a de lá não faz — trazer
             lote ENCERRADO de volta para o seletor, o único caminho para
             desfazer uma baixa num lote fechado — virou um interruptor escrito
             dentro do "Mais opções deste lote";
           · os três passos (Criar / Gravar / Conferir) → a barra de abas já é a
             mesma sequência, com os mesmos números. Duas numerações eram duas
             verdades. O texto por extenso continua no guia;
           · os dois parágrafos de instrução e o "Rever o guia de bancada" → o
             "?" do alto, que abre o guia inteiro, inclusive o socorro;
           · "Entrar no modo bancada" e o parágrafo que o explicava → não existem
             mais: a aba já é o painel;
           · dar baixa, excluir a peça, trocar o jeito de gravar, a trava
             permanente, o gravador de mesa e as peças baixadas com o "Desfazer"
             → UM ponto de acesso discreto, o "Mais opções deste lote".

         O PROGRESSO APARECE UMA VEZ SÓ, na barra com o "N de M" ao lado dela. O
         "nº 8 de 20" em letra grande NÃO é progresso: é qual peça está na mão. -->
    <template v-else-if="aba === 'gravar'">

      <p v-if="!lotes.length" class="au-vazio">
        Ainda não existe lote. Um lote é uma fornada de bolsas do mesmo modelo, e cada
        bolsa dele ganha um código diferente. Abra a aba <strong>Lotes</strong> para criar o primeiro.
      </p>

      <template v-else>
        <!-- Frase útil no lugar de lista vazia: dizer "nenhum lote" com 50 lotes
             encerrados na mão seria mentira, e sem explicação a pessoa acharia
             que a ferramenta quebrou. -->
        <p v-if="!lotesComPecaPorGravar(lotes, pecasDoLote)" class="au-pronto">
          Não há nenhuma etiqueta por gravar: os {{ lotes.length }} lote(s) estão encerrados —
          cada peça já foi gravada ou baixada. Crie um lote novo na aba <strong>1 Lotes</strong>,
          ou ligue “Mostrar também os lotes encerrados”, em “Mais opções deste lote”,
          se veio desfazer uma baixa.
        </p>

        <section class="au-bancada" :class="'au-bancada-' + estadoDaBancadaAgora.tom">

          <!-- 0. O ALTO. Não é conteúdo: é qual lote está na mão, por onde se
               grava, e a porta do guia. Tudo no tamanho do "resto" — nada aqui
               compete com o número da peça. -->
          <div class="au-bancada-topo">
            <label class="au-campo au-bancada-lote">
              <span class="au-rot">Lote</span>
              <!-- travado durante a gravação: trocar de lote no meio dos 8 segundos
                   era o caminho que gravava uma peça e marcava outra.
                   A OPÇÃO NÃO REPETE O PROGRESSO. Ela dizia "— 6 de 20", e essa
                   era a primeira das três cópias do progresso nesta aba. O
                   "encerrado" fica: é estado, e é o que explica por que um lote
                   sem trabalho está sendo oferecido. -->
              <select v-model="loteEscolhido" :disabled="gravando">
                <option v-for="l in lotesDoSeletor" :key="l.id" :value="l.id">
                  {{ l.modelo }}<span v-if="l.cor"> · {{ l.cor }}</span><span v-if="loteEstaEncerrado(l.id)"> · encerrado</span>
                </option>
              </select>
            </label>
            <div class="au-bancada-saidas">
              <!-- POR ONDE SE ESTÁ GRAVANDO, ESCRITO. Sem esta linha, quem abre a
                   tela com o leitor fora do ar aperta o botão e não entende por
                   que nada acontece. O nome sai da conta pura (`nomeDoModo`). -->
              <p class="au-bancada-onde">{{ nomeDoModo(modoDaBancada) }}</p>
              <!-- A INSTRUÇÃO MORA ATRÁS DO "?". Era um link de uma linha e meia
                   ocupando o melhor espaço da tela toda vez, para sempre. O
                   rótulo inteiro continua no `title` e no `aria-label`: quem
                   passa o mouse e quem usa leitor de tela leem a frase completa,
                   e o olho vê um alvo pequeno. -->
              <button class="au-bancada-menor" type="button" @click="abrirGuia"
                      title="Guia de bancada — inclusive o “deu errado, e agora?”"
                      aria-label="Guia de bancada — inclusive o “deu errado, e agora?”">
                <svg class="au-icone-guia" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"
                     fill="none" stroke="currentColor" stroke-width="2.2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="9.2" />
                  <path d="M9.4 9.4a2.7 2.7 0 1 1 3.4 2.6c-.6.2-.9.7-.9 1.3v.4" />
                  <path d="M12 17.1h.01" />
                </svg>
                <span>Guia</span>
              </button>
            </div>
          </div>

          <!-- ── AS DUAS COLUNAS: o que ACONTECE, e o que VOCÊ FAZ ───────────
               ══════════════════════════════════════════════════════════════
               O DESENHO É DO DONO, com estas palavras: "na aba gravar no
               computador ainda não está usando toda a lateral, acredito que se
               você fizer duas colunas, de um lado a animação de gravação e na
               direita o link e os botões".

               ESQUERDA — O QUE ESTÁ ACONTECENDO (`.au-bancada-obra`):
                 1. QUAL PEÇA É AGORA — o número, legível de pé, a um metro
                 2. O ESTADO: os anéis grandes e o mesmo estado por escrito
               DIREITA — O QUE VOCÊ FAZ (`.au-bancada-comandos`):
                 3. o endereço da peça
                 4. UMA ação principal, e a secundária ao lado dela
                 5. o progresso do lote, uma vez só
               A fila do lote vira uma FAIXA embaixo das duas — ver o porquê
               medido, junto do `@media (min-width:900px)` lá no estilo.

               ⚠️ A ORDEM DO HTML NÃO MUDOU, e isso é o que segura o celular.
               Empilhado, sai exatamente a sequência de hoje: peça → estado →
               endereço → ação → progresso → fila. As duas caixas novas são
               `flex` em coluna com o MESMO `gap` do painel, então nem o
               espaçamento muda: medido a 375px antes e depois, os dois lados
               batem pixel a pixel. Quem separa as colunas é só o
               `@media (min-width:900px)`.
               O QUE MUDOU DE ENDEREÇO (PADRÃO item 8): nada saiu da tela — o
               endereço, os dois botões e o progresso trocaram de caixa (da obra
               para os comandos) e, no computador, de lado (da coluna da
               esquerda para a da direita). A fila desceu da coluna estreita da
               direita para a faixa embaixo. Nenhum texto, nenhum botão e nenhum
               dado foi removido. -->
          <div class="au-bancada-obra">

            <!-- 1. QUAL PEÇA É AGORA. O maior elemento da tela, e o único desse
                 tamanho. ELE NÃO É O PROGRESSO: é qual peça está na mão agora.

                 ⚠️ ELE CONTINUA SENDO O NÚMERO DA PEÇA, e NÃO virou número de
                 série em 02/09/2026, quando toda a ferramenta virou. A decisão é
                 deliberada, e o motivo é o trabalho que ele faz:

                 · ELE NÃO IDENTIFICA A BOLSA, aponta a posição na fila — é a
                   resposta para "qual peça está na minha mão agora", lida de pé,
                   de longe, no meio de um gesto. Quem identifica a bolsa é o
                   endereço logo ao lado e o código, e desde esta entrega também
                   a fila logo abaixo, que diz o número de série de cada uma.
                 · O NÚMERO DE SÉRIE É PIOR NA ÚNICA COISA QUE ELE FAZ. Duas
                   peças seguidas são "001517" e "001518": a 32px, do outro lado
                   da bancada, elas são a mesma mancha, e só o último dígito
                   separa uma da outra. "7 de 20" e "8 de 20" não se confundem.
                 · O "de 20" só existe com a sequência. "001518 de 20" não é
                   frase nenhuma.

                 ⚠️ O "de 20" PODE SUMIR, desde 03/09/2026. A série passou a
                 aceitar buraco — peça gravada ou com garantia congela no número
                 dela, porque ele virou o número de série da cliente — e um lote
                 de nove peças pode ter uma numerada 10. `nº 10 de 9` é frase
                 impossível. Quem decide é `fraseDaPecaNaMao`, com teste.

                 Trocá-lo seria trocar um número que se lê de longe por um que
                 não se lê, para responder uma pergunta que ele não faz.

                 COM A FILA ACABADA ELE SAI, e quem vira o elemento dominante é o
                 estado — "Lote pronto", em verde, com o ✓ desenhado. Antes ele
                 mostrava aqui o "6 de 20" do lote, que é exatamente o que a
                 barra logo abaixo já diz: era a segunda cópia do progresso na
                 mesma tela, e repetição é metade da confusão que o dono
                 reclamou. O bloco de trabalho não some junto: ele nunca teve
                 `v-if`, então o ✓ da última etiqueta continua na tela. -->
            <p v-if="proxima" class="au-bancada-peca">
              {{ fraseDaPecaNaMao(proxima, loteAtual) }}
            </p>

            <!-- 2. O ESTADO. A COR E O MOVIMENTO SÃO O SINAL, O TEXTO É A
                 INFORMAÇÃO (PADRÃO item 2). Os anéis contam o que está
                 acontecendo pelo canto do olho — largos e lentos em "encoste",
                 apertados e quentes em "não tire", recolhidos num ✓ em "pode
                 tirar", travados e trêmulos em "para" — e o título ao lado diz o
                 MESMO estado por escrito. Quem não distingue a cor, quem
                 desligou animação e quem usa leitor de tela leem a mesma coisa.
                 `role="status"` para o leitor de tela anunciar a troca sem
                 roubar o foco de quem está com a etiqueta na mão. -->
            <div class="au-bancada-estado" role="status">
              <div class="au-aneis-caixa" :class="'au-aneis-' + estadoDaBancadaAgora.chave">
                <svg class="au-aneis" viewBox="0 0 120 120" width="104" height="104" aria-hidden="true"
                     fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
                  <circle class="au-anel-1" cx="60" cy="60" r="54" stroke-width="2" />
                  <circle class="au-anel-2" cx="60" cy="60" r="40" stroke-width="2.6" />
                  <circle class="au-anel-3" cx="60" cy="60" r="26" stroke-width="3.2" />
                  <circle class="au-anel-nucleo" cx="60" cy="60" r="11" stroke-width="3.2" />
                  <polyline class="au-anel-visto" points="42 61 55 74 80 45" stroke-width="7" />
                </svg>
              </div>
              <div class="au-bancada-dito">
                <p class="au-bancada-titulo">{{ estadoDaBancadaAgora.titulo }}</p>
                <!-- O DETALHE É O QUE FAZER, e ele vem da sequência sempre que ela
                     falou: é a única frase que sabe a diferença entre "a etiqueta
                     ficou pela metade, separe" e "o leitor está ocupado, a
                     etiqueta está boa". Este é o ÚNICO lugar da tela em que o
                     recado da gravação aparece — antes ele era desenhado duas
                     vezes, aqui e num bloco próprio logo acima. -->
                <p class="au-bancada-detalhe">{{ estadoDaBancadaAgora.detalhe }}</p>

                <!-- ⚠️ O BOTÃO DE RELIGAR SÓ APARECE NO ERRO CERTO. Ele abre a
                     janelinha de autorização do Windows, e isso não pode virar
                     rotina: botão sempre visível convida a apertar quando nada
                     está errado. `pedeParaReligar` só diz sim quando a frase
                     fala do serviço de Cartão Inteligente — nunca em "encoste a
                     etiqueta", que não tem nada a ver com o Windows. -->
                <div v-if="mostrarReligar" class="au-religar">
                  <!-- ⚠️ `au-link` E NÃO `au-botao`, de propósito. A obra tem UMA
                       ação principal — o teste `modo-bancada` reprova a segunda,
                       e a regra é boa: duas competindo é o mesmo que nenhuma.
                       Religar é saída de emergência, não a ação do trabalho. -->
                  <button class="au-link" type="button"
                          :disabled="religando" @click="religarOServicoDoLeitor">
                    {{ religando ? 'Religando…' : 'Religar o leitor' }}
                  </button>
                  <p class="au-religar-dica">
                    O Windows vai pedir autorização. Isto liga o serviço, deixa ele ligando
                    sozinho e desliga a economia de energia das portas USB.
                  </p>
                  <p v-if="recadoDoReligar" class="au-religar-recado">{{ recadoDoReligar }}</p>
                </div>
              </div>
            </div>
          </div>

          <!-- ── A COLUNA DA DIREITA: O QUE VOCÊ FAZ ─────────────────────────
               O endereço, os dois botões e o progresso. Ela NÃO tem `v-if`
               nenhum, pelo mesmo motivo que a obra não tem: ao gravar a última
               peça `proxima` vira nulo, e uma coluna que sumisse nesse instante
               levaria junto o ✓ da etiqueta que a pessoa acabou de encostar e a
               barra que diz que o lote fechou. -->
          <div class="au-bancada-comandos">

            <!-- O ENDEREÇO GRANDE, E SÓ NO MODO DE COPIAR. Ali a pessoa REALMENTE
                 copia — então ele é selecionável, fica no degrau do ESTADO (nunca
                 num quarto tamanho) e vem ANTES do botão, porque a ordem do gesto é
                 copiar → gravar no aplicativo → confirmar aqui.
                 Nos modos automáticos ele não aparece aqui: quem lê é a máquina, e
                 ele desce para o pé do bloco como CONFERÊNCIA. -->
            <div v-if="proxima && modoDaBancada === 'copiar'" class="au-endereco">
              {{ enderecoDaTag(proxima.codigo) }}
            </div>

            <!-- 3. UMA AÇÃO PRINCIPAL, COLADA NO ESTADO. Quem lê "ponha a etiqueta"
                 precisa ter o botão no campo de visão, sem procurar.
                 Quem diz o que o botão faz é `acaoDaBancada` — a mesma conta pura
                 que o teste prova. Ele fica TRAVADO enquanto grava, e nunca some:
                 botão que some no meio faz a pessoa procurar, e procurar com a
                 etiqueta na mão é tirar a etiqueta de cima do leitor.
                 ELE SOME ENQUANTO A PERGUNTA DE SOBRESCREVER ESTÁ ABERTA:
                 "Gravar nesta etiqueta" ali do lado leria a MESMA etiqueta de novo
                 e devolveria a MESMA pergunta, e a pessoa acharia que travou. -->
            <div v-if="!sobrescrita" class="au-bancada-acao">
              <button class="au-botao au-bancada-botao" type="button"
                      :disabled="acaoDaBancadaAgora.ocupado || !podeEditar"
                      @click="tocarNaBancada">{{ acaoDaBancadaAgora.rotulo }}</button>
              <button v-if="proxima && modoDaBancada === 'copiar'" class="au-bancada-menor"
                      type="button" @click="copiar">{{ textoCopiar }}</button>
            </div>

            <!-- 4. O PROGRESSO — UMA VEZ SÓ NESTA ABA.
                 A barra é para o canto do olho; o texto é o que se lê em voz alta
                 do outro lado da bancada. Os dois juntos, sempre, porque barra
                 sozinha não diz quantas faltam. O endereço vem junto e pequeno
                 nos modos automáticos: ele existe para conferir com o olho,
                 encostado no botão que o usa. -->
            <div class="au-bancada-progresso">
              <div class="au-barra" role="progressbar" aria-valuemin="0"
                   :aria-valuenow="progressoDoLoteAtual.gravadas"
                   :aria-valuemax="progressoDoLoteAtual.total"
                   :aria-label="`${progressoDoLoteAtual.texto} etiquetas gravadas neste lote`">
                <i class="au-barra-cheia" :style="{ width: larguraDoProgresso }"></i>
              </div>
              <p class="au-bancada-conta">{{ progressoDoLoteAtual.texto }} gravadas neste lote</p>
              <p v-if="proxima && modoDaBancada !== 'copiar'" class="au-bancada-endereco">
                {{ enderecoDaTag(proxima.codigo) }}
              </p>
            </div>
          </div>

          <!-- ── A FILA DO LOTE ──────────────────────────────────────────────
               A que acabou de sair e as próximas. ELA É UMA SÓ: até esta entrega
               havia DUAS listas de fila escritas neste arquivo, uma para o modo
               bancada e outra para fora dele, e duas cópias divergem.
               A da vez NÃO se distingue só pela cor: ela ganha fundo, borda e o
               selo escrito "Agora".
               Com uma peça só a lista não aparece: um bloco que mostra apenas a
               peça que já está em letra garrafal logo acima vira paisagem.

               ⚠️ A CLASSE MUDOU DE `au-bancada-lado` PARA `au-bancada-fila`, e
               a troca é honestidade: ela não é mais o trilho LATERAL de uma
               terceira coluna estreita — no computador ela é a FAIXA embaixo
               das duas colunas. Nome que diz o lugar errado é o que faz o
               próximo leitor procurar uma coluna que não existe. -->
          <div v-if="filaAoRedor.length > 1" class="au-bancada-fila">
            <p class="au-fila-titulo">A fila deste lote</p>
            <ul class="au-fila-lista">
              <li v-for="pf in filaAoRedor" :key="pf.codigo"
                  :class="['au-fila-item', { atual: pf.codigo === proxima.codigo }]">
                <!-- AQUI O RÓTULO É O LONGO ("nº de série 001512"), e na tabela
                     de peças é o curto. A diferença não é descuido: lá existe um
                     cabeçalho de coluna dizendo o que o número é; aqui não há
                     cabeçalho nenhum, e um número pelado encostado no código ao
                     lado leria como se fossem dois códigos. -->
                <span class="au-fila-n">{{ rotuloDaSerie(pf, loteAtual) }}</span>
                <span class="au-ref au-fila-cod">{{ pf.codigo }}</span>
                <span class="selo"
                      :class="pf.codigo === proxima.codigo ? 'selo-info' : estadoDaPeca(pf).selo">
                  {{ pf.codigo === proxima.codigo ? 'Agora' : estadoDaPeca(pf).rotulo }}
                </span>
              </li>
            </ul>
          </div>

          <!-- ── ETIQUETA JÁ GRAVADA: SOBRESCREVER? ──────────────────────────
               A PERGUNTA MAIS PERIGOSA DA FERRAMENTA, e por isso ela ocupa a
               largura inteira do painel e o botão de gravar sai de cena enquanto
               ela está na tela: ela apaga a identidade de uma bolsa.
               Ela diz QUAL BOLSA está prestes a perder a identidade — modelo,
               cor e número na série, não só o código: "K7M4X9QP2R" não é bolsa
               nenhuma. E pergunta o que fazer com a peça antiga, nos dois
               caminhos que o dono pediu.
               A gravação física só acontece DEPOIS de o banco confirmar.
               ELA NÃO TIRA MAIS A TELA DE MODO NENHUM, porque não há mais modo:
               ela nasce onde a pessoa já está olhando, com todo o contexto. -->
          <div v-if="sobrescrita" class="au-confirma au-sobrescrita">
            <p class="au-confirma-texto">
              Esta etiqueta já está gravada com <strong>{{ sobrescrita.descricaoAntiga }}</strong>.
              Sobrescrever apaga a identidade dessa peça desta etiqueta e grava
              <strong>{{ sobrescrita.descricaoNova }}</strong> no lugar.
            </p>
            <p v-if="sobrescrita.temGarantia" class="au-aviso-menor">
              <strong>A peça antiga tem garantia registrada por uma cliente.</strong>
              A garantia continua valendo no código dela — por isso o motivo escrito é
              obrigatório aqui.
            </p>

            <label class="au-campo"><span class="au-rot">O que fazer com a peça antiga</span>
              <select v-model="destinoDaAntiga" :disabled="gravando">
                <option value="fila">Volta para a fila — ela ganha outra etiqueta depois</option>
                <option value="baixa">Dar baixa — ela não vira bolsa</option>
              </select>
            </label>

            <label v-if="destinoDaAntiga === 'baixa'" class="au-campo">
              <span class="au-rot">Motivo da baixa</span>
              <select v-model="motivoDaSobrescrita" :disabled="gravando">
                <option value="">Escolha o motivo…</option>
                <option v-for="m in MOTIVOS_DE_BAIXA" :key="m.chave" :value="m.chave">{{ m.rotulo }}</option>
              </select>
            </label>
            <!-- `v-else-if` GRUDA no `v-if` de cima, e é de propósito: no
                 destino 'fila' o motivo é texto livre, e só é cobrado quando
                 há garantia de cliente. -->
            <label v-else-if="sobrescrita.temGarantia" class="au-campo">
              <span class="au-rot">Motivo</span>
              <input v-model="motivoDaSobrescrita" type="text" maxlength="200" :disabled="gravando"
                     placeholder="Ex.: etiqueta ficou de lado antes de costurar"></label>

            <p v-if="erroDaSobrescrita" class="au-recusa">{{ erroDaSobrescrita }}</p>

            <div class="au-acoes">
              <button class="au-botao secundario" type="button" :disabled="gravando"
                      @click="desistirDaSobrescrita">Não sobrescrever</button>
              <button class="au-botao" type="button" :disabled="gravando"
                      @click="sobrescreverEtiqueta">
                {{ gravando ? 'Encoste a etiqueta…' : 'Sobrescrever esta etiqueta' }}
              </button>
            </div>
          </div>
        </section>

        <!-- ══════════════════════════════════════════════════════════════════
             O ÚNICO PONTO DE ACESSO DISCRETO
             ══════════════════════════════════════════════════════════════════
             Aqui mora TUDO o que é raro: dar baixa, excluir a peça, trocar o
             jeito de gravar, a trava permanente, a lista para a máquina, quais
             lotes o seletor oferece e as peças baixadas com o "Desfazer".
             É UMA gaveta, e não seis links do mesmo peso soltos na bancada —
             seis links do mesmo peso é o mesmo que nenhuma ação principal.
             Nada aqui dentro é botão principal: todos são `.au-botao secundario`
             ou link. O único botão principal desta aba é o de gravar, lá em
             cima. As perguntas que abrem aqui dentro têm o botão principal
             DELAS, porque cada pergunta é um bloco com uma decisão só. -->
        <details class="au-mais au-mais-da-bancada">
          <!-- A seta é desenhada aqui porque `display:flex` no <summary> apaga o
               triângulo que o Chrome desenha sozinho — e o triângulo era a única
               pista de que esta gaveta abre. Em SVG, nunca emoji. -->
          <summary>
            <svg class="au-seta" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
                 fill="none" stroke="currentColor" stroke-width="2.4"
                 stroke-linecap="round" stroke-linejoin="round"><polyline points="9 5 16 12 9 19" /></svg>
            <span>Mais opções deste lote</span>
          </summary>

          <div class="au-mais-miolo">
            <!-- ── OS DOIS CAMINHOS DA PEÇA DA VEZ ───────────────────────────
                 DAR BAIXA é o caminho de quem NÃO pode excluir: peça gravada pode
                 estar dentro de uma bolsa, e excluir faria a página da cliente
                 dizer "não consta".
                 EXCLUIR é o caminho certo para a peça que ainda NÃO foi gravada —
                 nada dela existe no mundo, e um lote com peça sobrando é para
                 diminuir, não para encher de baixa.
                 As duas perguntas moram na própria tela: a caixinha nativa do
                 navegador é proibida neste projeto. -->
            <template v-if="proxima">
              <p class="au-mais-titulo">A peça da vez</p>
              <div v-if="podeEditar && !gravando && !baixando && !excluindoPeca" class="au-peca-acoes">
                <button class="au-link au-baixar" type="button"
                        @click="baixando = true">Dar baixa nesta peça</button>
                <!-- `proxima` é a primeira SEM gravação, então esta guarda é
                     redundante hoje — e está escrita assim de propósito: o dia em
                     que a fila mudar de regra, o botão de excluir some sozinho em
                     vez de aparecer sobre uma peça que já está dentro de uma bolsa. -->
                <button v-if="!proxima.gravada_em" class="au-link au-baixar" type="button"
                        @click="excluindoPeca = true">Excluir esta peça</button>
              </div>

              <div v-if="excluindoPeca" class="au-confirma">
                <p class="au-confirma-texto">
                  Excluir a peça {{ rotuloDaSerie(proxima, loteAtual) }}, de código
                  <strong>{{ proxima.codigo }}</strong>?
                </p>
                <p class="au-aviso-menor">
                  O código deixa de existir, e a página da cliente passa a dizer que ele não
                  consta. Quem recusa é o banco: peça já gravada, ou com garantia registrada
                  por uma cliente, não sai — nesses casos o caminho é dar baixa. As peças
                  seguintes do lote são renumeradas.
                </p>
                <div class="au-acoes">
                  <button class="au-botao secundario" type="button"
                          @click="excluindoPeca = false">Cancelar</button>
                  <button class="au-botao" type="button" :disabled="exclusaoEmVoo"
                          @click="excluirPeca(proxima.codigo)">Sim, excluir</button>
                </div>
              </div>

              <div v-if="baixando" class="au-confirma">
                <p class="au-confirma-texto">Dar baixa na peça {{ rotuloDaSerie(proxima, loteAtual) }}?</p>
                <label class="au-campo"><span class="au-rot">Motivo</span>
                  <select v-model="motivoDaBaixa">
                    <option v-for="m in MOTIVOS_DE_BAIXA" :key="m.chave" :value="m.chave">{{ m.rotulo }}</option>
                  </select>
                </label>
                <p class="au-aviso-menor">
                  A peça sai da fila de gravação e continua respondendo normalmente para a cliente.
                  Dá para desfazer depois.
                </p>
                <div class="au-acoes">
                  <button class="au-botao secundario" type="button" @click="baixando = false">Cancelar</button>
                  <button class="au-botao" type="button" :disabled="baixaEmVoo"
                          @click="baixarPeca(proxima.codigo)">Dar baixa</button>
                </div>
              </div>
            </template>

            <!-- ── POR ONDE GRAVAR ───────────────────────────────────────────
                 Os três jeitos continuam inteiros, e cada botão só aparece quando
                 o caminho dele existe de verdade naquela máquina: botão que não
                 leva a lugar nenhum é pior que botão que não existe.
                 Eles saíram da frente porque trocar de jeito de gravar é decisão
                 de ANTES — no meio de cinquenta etiquetas ela só atrapalha. Por
                 isso o jeito em uso fica ESCRITO no alto do painel, e a troca
                 mora aqui.
                 Travados durante a gravação: o estado (inclusive o "PARE: esta
                 etiqueta já tem OUTRA peça") fala do jeito em uso, e trocar no
                 meio o faria falar de uma etiqueta que não está mais na história. -->
            <!-- O TÍTULO SÓ APARECE COM ALGUM BOTÃO EMBAIXO. Nesta máquina pode não
                 haver caminho nenhum para trocar (um computador sem o programa e
                 sem NFC no navegador), e um título sozinho é uma pergunta sem
                 resposta: "por onde gravar" com nada abaixo faz a pessoa procurar
                 um botão que não existe. Medido na tela, a 1440px. -->
            <template v-if="temLeitorDeMesaAqui || temSuporte() || gravaAoVivo">
              <p class="au-mais-titulo">Por onde gravar</p>
              <div class="au-acoes">
                <button v-if="!gravaPorMesa && temLeitorDeMesaAqui" class="au-botao secundario" type="button"
                        :disabled="gravando" @click="usarOLeitorDeMesa">
                  Gravar pelo leitor de mesa
                </button>
                <button v-if="!gravaPorNfc && temSuporte()" class="au-botao secundario" type="button"
                        :disabled="gravando" @click="usarOCelular">
                  Gravar encostando o celular
                </button>
                <button v-if="gravaAoVivo" class="au-botao secundario" type="button"
                        :disabled="gravando" @click="usarOAplicativo">
                  Gravar pelo aplicativo
                </button>
              </div>
            </template>
            <!-- A TRAVA NÃO APARECE NO LEITOR DE MESA, de propósito: travar mexe
                 na página 40 e no Capability Container, é irreversível, e o motor
                 do leitor de mesa NÃO faz isso (é outro módulo, que não existe).
                 Um interruptor que não trava nada seria uma promessa falsa numa
                 ação que não tem volta.
                 O alvo do dedo é a linha inteira, não o quadradinho. -->
            <template v-if="!gravaPorMesa">
              <p class="au-mais-titulo">A trava da etiqueta</p>
              <label class="au-trava">
                <input type="checkbox" v-model="travarDepois">
                <span>Travar a etiqueta depois de gravar — <strong>não tem volta</strong></span>
              </label>
            </template>

            <!-- ══════════════════════════════════════════════════════════════
                 A GAVETA "GRAVADOR DE MESA" SAIU DAQUI (02/09/2026)
                 ══════════════════════════════════════════════════════════════
                 O dono perguntou se ela ainda fazia sentido. Metade não fazia.

                 · "Baixar a lista das que faltam" — SAIU DA FERRAMENTA, e é o
                   único pedaço desta entrega que sai de verdade. Ele nasceu
                   quando não existia programa de gravação: o jeito de alimentar
                   a máquina era um .txt com os endereços que faltavam. Hoje há
                   três caminhos melhores e escritos logo acima, em "Por onde
                   gravar" (leitor de mesa, celular, copiar), e a lista em
                   arquivo já existe COMPLETA e mais informativa na aba 1 Lotes:
                   "Baixar a lista inteira", dentro de "Ver as peças e os
                   links", que sai em CSV com número, código, estado e endereço
                   de TODAS as peças. Nada ficou inalcançável.

                 · O CAMPO DE COLAR O RETORNO — NÃO saiu: mudou de casa, para a
                   aba 3 Etiquetas, logo abaixo do seletor de lote. Ele marca
                   cinquenta peças de uma vez a partir de um log, e sem o
                   programa instalado é o único jeito de fazer isso sem
                   cinquenta cliques. O motivo da mudança é que ele NUNCA foi da
                   bancada: quem está com a etiqueta na mão grava uma por vez,
                   e colar um log é conserto em bloco — que é o assunto da aba
                   Etiquetas. Lá ele ganhou de graça o que aqui não tinha:
                   funciona com "Todos os lotes", e não só com o lote da
                   bancada. -->

            <!-- ── QUAIS LOTES O SELETOR OFERECE ─────────────────────────────
                 A ÚNICA COISA QUE A BUSCA DESTA ABA FAZIA E A DA ABA LOTES NÃO
                 FAZ. O seletor só oferece lote com peça POR GRAVAR — e a lista
                 das peças BAIXADAS mora aqui, então este interruptor é o único
                 caminho para desfazer uma baixa num lote já encerrado.
                 Ele é um interruptor escrito, e não um painel de filtros: o
                 painel inteiro numa aba onde se escolhe UM lote era 260px de
                 altura que quem grava nunca usa. -->
            <p class="au-mais-titulo">Quais lotes o seletor oferece</p>
            <label class="au-trava">
              <input type="checkbox" :checked="filtroDeGravar.estado === 'todos'"
                     @change="mostrarEncerrados($event.target.checked)">
              <span>Mostrar também os lotes encerrados — é por aqui que se desfaz uma baixa</span>
            </label>

            <!-- ── AS PEÇAS BAIXADAS ─────────────────────────────────────────
                 As baixadas saem da fila de gravação, então precisam de um lugar
                 PRÓPRIO para aparecer: sem esta lista, dar baixa por engano não
                 teria como ser desfeito. -->
            <template v-if="baixadasDoLote.length">
              <p class="au-mais-titulo">{{ baixadasDoLote.length }} peça(s) baixada(s) neste lote</p>
              <ul class="au-baixadas">
                <li v-for="pc in baixadasDoLote" :key="pc.codigo">
                  <span>Peça {{ rotuloDaSerie(pc, loteAtual) }} — {{ rotuloDoMotivo(pc.baixa_motivo) }}</span>
                  <button v-if="podeEditar" class="au-link" type="button" :disabled="baixaEmVoo"
                          @click="desfazerBaixa(pc.codigo)">Desfazer</button>
                </li>
              </ul>
            </template>
          </div>
        </details>
      </template>
    </template>

    <!-- ── ETIQUETAS ────────────────────────────────────────────────────
         A aba de consertar o que foi gravado errado.

         ⚠️ `v-else-if` GRUDA NO `v-if` ANTERIOR: este bloco entra ENTRE a aba
         Gravar e a aba Registros, e as duas continuam sendo os vizinhos diretos
         dele na corrente. Um `v-if` solto no meio partiria a corrente em duas, e
         o `v-else` do fim — a aba Alertas inteira — passaria a ser desenhado
         embaixo das outras abas. Já aconteceu nesta tela, em 30/08. -->
    <template v-else-if="aba === 'etiquetas'">
      <!-- ⚠️ ESTE PARÁGRAFO ENCOLHEU, e o que saiu dele não se perdeu: a primeira
           metade ("apagar a gravação devolve a peça para a fila, e nem o código
           nem a garantia de ninguém são apagados") já está escrita, quase com as
           mesmas palavras, na ajuda da aba logo acima — que sai de
           `AJUDA_DA_ABA` e é a mesma frase nas cinco abas. Duas frases dizendo o
           mesmo, uma embaixo da outra, é metade do que o dono chamou de confuso.
           O que sobrou é a única coisa que a ajuda NÃO diz, e é a mais cara. -->
      <p class="au-instrucao">
        A etiqueta apagada <strong>continua costurada dentro da bolsa</strong>, e alguém vai
        precisar achá-la.
      </p>

      <!-- O AVISO DA GARANTIA FICA NA TELA, e não só no recado que some: uma
           bolsa que já está com uma cliente voltar para a fila é coisa que
           alguém vai precisar explicar. Ele só aparece quando houve garantia —
           aviso que aparece sempre vira paisagem (PADRAO item 9). -->
      <div v-if="avisoDaGarantia" class="au-confirma au-aviso-garantia" role="status">
        <p class="au-confirma-texto">{{ avisoDaGarantia }}</p>
        <div class="au-acoes">
          <button class="au-botao secundario" type="button" @click="avisoDaGarantia = ''">Entendi</button>
        </div>
      </div>

      <!-- ══════════════════════════════════════════════════════════════════
           LER QUALQUER ETIQUETA — a porta de entrada pela ETIQUETA
           ══════════════════════════════════════════════════════════════════
           Fica ACIMA do seletor de lote de propósito: aqui não se escolhe nada
           antes, é a etiqueta que diz quem é. Pedir um lote primeiro seria
           pedir justamente a informação que a pessoa veio buscar. -->
      <!-- UM BOTÃO, E O RESTO NO MODAL. A primeira versão punha o painel
           inteiro aberto na aba: ocupava a tela para uma ação que é rápida e
           rara, e brigava com a lista que é o assunto da aba. O `.au-acoes` é o
           irmão dos outros blocos e já carrega o recuo desta aba — o defeito da
           margem não volta por esquecimento. -->
      <div class="au-acoes">
        <button class="au-botao secundario" type="button" @click="abrirLeituraDeEtiqueta">
          <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M4 9a12 12 0 0 1 16 0" /><path d="M7.5 12.5a7 7 0 0 1 9 0" />
            <circle cx="12" cy="16.5" r="1.2" fill="currentColor" stroke="none" />
          </svg>
          Ler etiqueta
        </button>
      </div>

      <label class="au-campo"><span class="au-rot">Lote</span>
        <select v-model="loteDaEtiqueta">
          <option value="">Todos os lotes</option>
          <option v-for="l in lotes" :key="l.id" :value="l.id">
            {{ l.modelo }}<span v-if="l.cor"> · {{ l.cor }}</span>
          </option>
        </select>
      </label>

      <!-- ══════════════════════════════════════════════════════════════════
           MARCAR EM BLOCO PELO GRAVADOR DE MESA — chegou aqui em 02/09/2026
           ══════════════════════════════════════════════════════════════════
           ELE MORAVA NA ABA GRAVAR, dentro de "Mais opções deste lote", ao lado
           de um botão de baixar lista que esta entrega apagou. Veio para cá
           porque nunca foi da bancada: lá se grava UMA peça por vez, com a
           etiqueta na mão; colar um log do gravador de mesa é conserto EM
           BLOCO, e conserto em bloco é o assunto desta aba — a mesma que apaga
           uma gravação. As duas são a mesma decisão, em direções opostas.

           ELE FICA LOGO ABAIXO DO SELETOR DE LOTE porque é dele que sai o
           recorte, e isso é ganho: na bancada ele só conferia contra o lote da
           bancada; aqui, com "Todos os lotes", ele confere contra a ferramenta
           inteira — quem colou o log de duas fornadas juntas não precisa mais
           colar duas vezes.

           A GAVETA NASCE FECHADA. É uma ação rara e destrutiva à sua maneira
           (marca sem conferir etiqueta nenhuma), e ação rara não ocupa espaço
           de tela para sempre — é a mesma regra do "Mais opções deste lote". -->
      <details class="au-mais au-marcar-bloco">
        <summary>
          <svg class="au-seta" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
               fill="none" stroke="currentColor" stroke-width="2.4"
               stroke-linecap="round" stroke-linejoin="round"><polyline points="9 5 16 12 9 19" /></svg>
          <span>Marcar várias de uma vez, pelo gravador de mesa</span>
        </summary>
        <div class="au-mais-miolo">
          <p class="au-aviso-menor">
            Cole o que o gravador de mesa devolveu — arquivo, planilha ou log solto, tanto
            faz o formato. A tela procura os códigos lá dentro e confere contra
            <strong>{{ escopoDeMarcarEmBloco }}</strong>.
          </p>
          <textarea v-model="textoDoGravador" class="au-colar"
                    aria-label="Cole aqui o que o gravador devolveu"
                    placeholder="Cole aqui o que o gravador devolveu"></textarea>
          <div v-if="podeEditar && !confirmacaoDoGravador" class="au-acoes">
            <button class="au-botao secundario" type="button"
                    @click="pedirParaMarcarPeloGravador">
              Marcar as gravadas
            </button>
          </div>
          <div v-if="podeEditar && confirmacaoDoGravador" class="au-confirma">
            <p class="au-confirma-texto">
              Marcar {{ confirmacaoDoGravador.reconhecidos.length }} peça(s) como gravadas?
              Isso não confere etiqueta nenhuma — só use depois de gravar de verdade
              no gravador de mesa.
            </p>
            <div class="au-acoes">
              <button class="au-botao secundario" type="button"
                      @click="confirmacaoDoGravador = null">Cancelar</button>
              <button class="au-botao" type="button" @click="marcarPeloGravador">
                Sim, marcar
              </button>
            </div>
          </div>
        </div>
      </details>

      <!-- ── A BUSCA ─────────────────────────────────────────────────────
           A aba abre nos ÚLTIMOS 30 DIAS, e o resto fica atrás da busca: quem
           vem aqui acabou de gravar errado, e a peça dele é de hoje. O atalho
           "Qualquer data" (ou o "Limpar a busca") traz a história inteira de
           volta, e a contagem diz sempre quantas de quantas. -->
      <PainelDeBusca v-model:filtro="filtroDeEtiquetas"
                     :atalhos="ATALHOS_DE_DATA" :estados="ESTADOS_DE_ETIQUETA"
                     rotulo-da-data="Gravada em" estado-padrao="todas"
                     dica="Número de série, código, modelo, cor, data — ou qualquer campo"
                     :contagem="contagemDeEtiquetas" />

      <!-- ⚠️ A PLANILHA SAI DO QUE ESTÁ NA TELA, e não da tabela inteira: quem
           acabou de filtrar por lote, período ou estado está olhando exatamente
           a lista que quer levar. Botão que ignora o filtro logo acima dele faz
           a pessoa baixar 400 linhas quando pediu 12, e ela não descobre — só
           percebe depois de abrir. A contagem no rótulo diz quantas vão. -->
      <div v-if="numerosAtivos.length" class="au-acoes-etiquetas">
        <button class="au-botao secundario" type="button" @click="baixarNumerosAtivos">
          Baixar planilha ({{ numerosAtivos.length }} ativos)
        </button>
      </div>

      <p v-if="!etiquetasDaAba.length" class="au-vazio">
        Nenhuma etiqueta gravada {{ loteDaEtiqueta ? 'neste lote' : 'ainda' }}. Esta aba só mostra
        peça que está marcada como gravada — é o que dá para desfazer.
      </p>

      <!-- "Nada encontrado" e "não há nada" são coisas diferentes, e a tela não
           pode dizer uma pela outra. -->
      <p v-else-if="!etiquetasFiltradas.length" class="au-vazio">
        Nenhuma etiqueta com esse recorte. Há {{ etiquetasDaAba.length }} gravada(s)
        {{ loteDaEtiqueta ? 'neste lote' : 'no total' }} — mude a busca, o período ou o estado,
        ou aperte “Limpar a busca”.
      </p>

      <!-- NO COMPUTADOR ESTES CARTÕES VIRAM TABELA. O cabeçalho é o PRIMEIRO
           FILHO da lista, e não um irmão antes dela: este `<div>` é o `v-else`
           de uma corrente `v-if`/`v-else-if`, e qualquer elemento colocado
           entre os dois partiria a corrente — já aconteceu nesta tela, em
           30/08. `aria-hidden` porque cada linha já diz tudo por escrito
           ("Gravada em 12/08"); ele é ajuda de olho para varrer coluna. -->
      <!-- ══════════════════════════════════════════════════════════════
           A ÁRVORE: o lote é a linha, as etiquetas ficam dentro
           ══════════════════════════════════════════════════════════════
           `<details>` é o que esta tela já usa para abrir e fechar (três vezes
           nela mesma) — abre com teclado, é lido por leitor de tela e não
           precisa de JavaScript nenhum para funcionar. -->
      <div v-else class="au-lista au-arvore">
        <details v-for="g in gruposDeEtiquetas" :key="g.chave" class="au-mais au-lote-no"
                 :open="gruposAbertos.has(g.chave)"
                 @toggle="alternarGrupo(g.chave, $event.target.open)">
          <summary>
            <svg class="au-seta" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"
                 fill="none" stroke="currentColor" stroke-width="2.4"
                 stroke-linecap="round" stroke-linejoin="round"><polyline points="9 6 15 12 9 18"/></svg>
            <span class="au-lote-nome">{{ g.lote.modelo || 'Lote que não existe mais' }}<template v-if="g.lote.cor"> · {{ g.lote.cor }}</template></span>
            <span class="au-ref au-lote-ref" v-if="g.lote.sku">{{ g.lote.sku }}</span>
            <!-- A O.S. E A DATA DE CRIACAO no card FECHADO: e o que o dono pediu
                 para reconhecer o lote sem precisar abrir. A data sai de
                 `criado_em`, que o banco ja guarda sozinho — nao e campo para
                 preencher, entao nao tem como estar errada nem esquecida. -->
            <span class="au-lote-os" v-if="g.lote.os">O.S. {{ g.lote.os }}</span>
            <span class="au-lote-data" v-if="g.lote.criado_em">criado em {{ dataCurta(g.lote.criado_em) }}</span>
            <span class="au-lote-conta">{{ contagemDoGrupo(g) }}</span>
          </summary>

        <div class="au-tabela au-tabela-etiquetas">
        <div class="au-tabela-cab" aria-hidden="true">
          <span>Peça</span><span>Estado</span><span>Situação</span>
          <span>Endereço da etiqueta</span><span>Ações</span>
        </div>
        <div v-for="pc in g.etiquetas" :key="pc.codigo" class="au-card">
          <div class="au-card-topo">
            <span class="au-modelo">{{ descricaoDaPeca(pc, loteDaPeca(pc.lote_id)) }}</span>
            <span class="selo" :class="estadoDaPeca(pc).selo">{{ estadoDaPeca(pc).rotulo }}</span>
          </div>
          <div class="au-card-linha">
            <span>Gravada em {{ dataCurta(pc.gravada_em) }}</span>
            <span v-if="pc.baixada">Baixada — {{ rotuloDoMotivo(pc.baixa_motivo) }}</span>
            <!-- A PEÇA COM GARANTIA APARECE MARCADA. Sem isto, quem vai apagar a
                 gravação não tem como saber que do outro lado há uma cliente. -->
            <span v-if="temGarantia(pc.codigo)" class="selo selo-atencao">Garantia de cliente</span>
          </div>
          <div class="au-peca-end">
            <span class="au-peca-end-texto">{{ enderecoDaTag(pc.codigo) }}</span>
            <!-- O ENDEREÇO ERA SÓ TEXTO PARA CONFERIR LETRA POR LETRA. Continua
                 sendo — e agora tem também o caminho de UM CLIQUE para ver a
                 página como a cliente vê. `rel="noopener"` porque a página aberta
                 não tem por que ter acesso a esta; dentro do programa da bancada
                 o próprio Electron manda o link para o navegador do computador,
                 longe do leitor. -->
            <a class="au-botao secundario au-abrir-pagina" :href="enderecoDaTag(pc.codigo)"
               target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
                   stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 4h6v6"/><path d="M20 4l-9 9"/>
                <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>
              </svg>
              Abrir a página
            </a>
          </div>

          <div v-if="podeEditar && apagando?.codigo !== pc.codigo" class="au-peca-acoes">
            <button class="au-link au-baixar" type="button"
                    @click="pedirApagarGravacao(pc)">Apagar a gravação</button>
          </div>

          <!-- DUAS PERGUNTAS E A SENHA, como no excluir lote: apagar a gravação
               de uma peça costurada dentro de uma bolsa é destrutivo, e a
               etiqueta continua existindo no mundo depois disso. -->
          <div v-if="apagando?.codigo === pc.codigo" class="au-confirma">
            <template v-if="etapaDeApagar === 1">
              <p class="au-confirma-texto">
                Apagar a gravação de <strong>{{ apagando.descricao }}</strong>?
              </p>
              <p class="au-aviso-menor">
                A peça volta para a fila de gravação. O código continua existindo e a página da
                cliente continua respondendo igual.
              </p>
              <div class="au-acoes">
                <button class="au-botao secundario" type="button" @click="fecharApagar">Cancelar</button>
                <button class="au-botao" type="button" @click="etapaDeApagar = 2">Continuar</button>
              </div>
            </template>

            <template v-else>
              <p class="au-confirma-texto">
                Tem certeza? A etiqueta desta peça <strong>continua costurada dentro de uma bolsa</strong>,
                gravada com este mesmo endereço — e o sistema vai passar a dizer que a peça está por
                gravar. Quem pegar a fila depois vai procurar uma etiqueta que já existe.
              </p>
              <p v-if="apagando.temGarantia" class="au-aviso-menor">
                <strong>Esta peça tem garantia registrada por uma cliente.</strong> A garantia continua
                valendo no código dela — por isso o motivo escrito é obrigatório aqui.
              </p>

              <label class="au-campo">
                <span class="au-rot">Motivo{{ motivoEhObrigatorio ? '' : ' (opcional)' }}</span>
                <input v-model="motivoDeApagar" type="text" maxlength="200"
                       :disabled="apagarEmVoo"
                       placeholder="Ex.: cliquei na peça errada no meio do lote"></label>

              <label class="au-campo"><span class="au-rot">Sua senha</span>
                <input v-model="senhaDeApagar" type="password" autocomplete="current-password"
                       :disabled="apagarEmVoo" @keydown.enter.prevent="apagarGravacao"></label>
              <p class="au-aviso-menor">É a mesma senha com que você entra no aplicativo.</p>
              <p v-if="erroDeApagar" class="au-recusa">{{ erroDeApagar }}</p>

              <div class="au-acoes">
                <button class="au-botao secundario" type="button" @click="fecharApagar">Cancelar</button>
                <button class="au-botao" type="button" :disabled="apagarEmVoo" @click="apagarGravacao">
                  {{ apagarEmVoo ? 'Conferindo…' : 'Apagar a gravação' }}
                </button>
              </div>
            </template>
          </div>
        </div>
        </div>
        </details>
      </div>

      <!-- lista que esconde sem avisar é lista que mente: o botão diz quantas
           ainda faltam, como o da aba Lotes -->
      <div v-if="etiquetasQueFaltamMostrar" class="au-acoes">
        <button class="au-botao secundario" type="button" @click="mostrarMaisEtiquetas">
          Mostrar mais {{ Math.min(etiquetasQueFaltamMostrar, DE_CADA_VEZ) }}
          (faltam {{ etiquetasQueFaltamMostrar }})
        </button>
      </div>
    </template>

    <!-- ── CARTÕES EAN ──────────────────────────────────────────────────── -->
    <template v-else-if="aba === 'cartoes'">
      <!-- ⚠️ ESTE PARÁGRAFO É O ÚNICO AVISO DE UMA COISA IRREVERSÍVEL, e por isso
           fica na tela e não só na ajuda da aba. A etiqueta NFC se regrava; o
           papel dentro da bolsa, não. Depois de o cartão sair, aquela peça não
           pode mais ser renumerada nem apagada — e quem descobre isso na recusa
           de um botão, três semanas depois, descobre tarde. -->
      <p class="au-instrucao">
        Depois de o cartão sair, <strong>o número de série daquela peça não muda mais</strong>.
      </p>

      <label class="au-campo"><span class="au-rot">Lote</span>
        <select v-model="loteDosCartoes">
          <option value="">Todos os lotes</option>
          <option v-for="l in lotes" :key="l.id" :value="l.id">
            {{ l.modelo }}<span v-if="l.cor"> · {{ l.cor }}</span>
          </option>
        </select>
      </label>

      <p v-if="erroDosCartoes" class="au-erro">{{ erroDosCartoes }}</p>

      <!-- A FILA, QUANDO HÁ ALGO NELA. Some quando está vazia: aviso que
           aparece sempre vira paisagem. -->
      <div v-if="pedidosEmAndamento.length" class="au-confirma" role="status">
        <p class="au-confirma-texto" v-for="q in pedidosEmAndamento" :key="q.id">
          <strong>{{ situacaoDoPedido(q).rotulo }}</strong> — {{ situacaoDoPedido(q).detalhe }}
        </p>
      </div>

      <p v-if="carregandoOsCartoes" class="au-vazio">Carregando os produtos publicados…</p>
      <p v-else-if="!linhasDosCartoes.length" class="au-vazio">
        Nenhuma peça neste recorte. Escolha outro lote, ou crie o lote no passo 1.
      </p>

      <div v-else class="au-lista au-tabela au-tabela-cartoes">
        <div class="au-tabela-cab" aria-hidden="true">
          <span>Peça</span><span>Nº de série</span><span>Cartão</span><span>Prévia</span>
        </div>
        <div v-for="ln in linhasDosCartoes" :key="ln.codigo" class="au-card">
          <div class="au-card-topo">
            <!-- ⚠️ A MARCA É UM `checkbox` DE VERDADE, e não uma div clicável: é
                 o que o leitor de tela anuncia e o que o teclado alcança. -->
            <label class="au-marca-cartao">
              <input type="checkbox" :value="ln.codigo" v-model="marcadasParaCartao"
                     :disabled="!ln.podeGerar || !podeEditar"
                     :aria-label="'Gerar cartão de ' + (ln.numeroDeSerie || ln.codigo)">
              <span class="au-modelo">{{ ln.nome || ln.modelo || ln.codigo }}</span>
            </label>
          </div>
          <div class="au-card-linha">
            <span class="au-serie-cartao">{{ ln.numeroDeSerie || '—' }}</span>
          </div>
          <div class="au-card-linha">
            <span v-if="ln.jaTemCartao" class="selo selo-ok">Já impresso</span>
            <span v-else-if="!ln.podeGerar" class="selo selo-atencao">Não dá</span>
            <span v-else class="selo">Sem cartão</span>
          </div>
          <div class="au-acoes">
            <button v-if="ln.podeGerar" class="au-link" type="button"
                    @click="verOCartao(ln)">Ver o cartão</button>
            <!-- Botão desabilitado calado faz a pessoa achar que a ferramenta
                 quebrou. Cada impedimento tem a frase que diz o que fazer. -->
            <span v-else class="au-aviso-menor">{{ MOTIVO_DO_IMPEDIMENTO[ln.impedimento] }}</span>
          </div>
        </div>
      </div>

      <!-- ── A PRÉVIA ──────────────────────────────────────────────────────
           ⚠️ ELA É O CARTÃO, E NÃO UM DESENHO PARECIDO. O que está dentro deste
           quadro é montado pelo MESMO arquivo que o robô usa para gerar o que
           vai para a gráfica, com a mesma foto tratada, o mesmo enquadramento e
           a mesma fonte. Uma segunda conta do mesmo cartão acertaria no começo
           e divergiria depois, calada.

           POR QUE UM `iframe` DE OUTRO ENDEREÇO: o desenho mora no repositório
           do SITE, que não chega à máquina que faz o build deste aplicativo.
           Copiar o desenho para cá seria criar a segunda conta. Aqui a tela
           EMBUTE a página, e não executa o código dela.

           ⚠️ O `sandbox` LEVA `allow-same-origin`, e isso NÃO afrouxa a trava
           aqui: `allow-same-origin` só é perigoso quando o iframe é do MESMO
           endereço do pai — aí ele conseguiria tirar o próprio sandbox. Este é
           de vesselbrasil.com.br, outro endereço: ele continua sem alcançar
           nada desta tela nem a sessão de quem está logado, e o sandbox segue
           barrando o que importa — navegar a janela de cima para fora do
           aplicativo, abrir pop-up e baixar arquivo.

           Sem ele a prévia não consegue nem conferir o próprio desenho: com
           origem opaca ela perde o acesso ao quadro interno onde o cartão é
           montado, e a checagem de imagem que não carregou morre — que é
           justamente a que impede o cartão sair com um vazio no lugar da
           bolsa. Medido: `Cannot read properties of null (reading 'images')`. -->
      <div v-if="pecaNaPrevia" class="au-previa-cartao">
        <div class="au-card-topo">
          <span class="au-modelo">Cartão de {{ pecaNaPrevia.numeroDeSerie }}</span>
          <button class="au-link" type="button" @click="fecharAPrevia">Fechar</button>
        </div>
        <p v-if="erroDaPrevia" class="au-erro">{{ erroDaPrevia }}</p>
        <iframe class="au-previa-folha" :src="enderecoDaPrevia"
                sandbox="allow-scripts allow-same-origin"
                title="Prévia do cartão desta peça" loading="lazy"></iframe>
      </div>

      <!-- ── O PEDIDO ────────────────────────────────────────────────────── -->
      <div v-if="podeEditar" class="au-acoes au-pedir-cartoes">
        <p class="au-aviso-menor">
          {{ resumoDosCartoes.total }} peça(s) marcada(s) — {{ resumoDosCartoes.arquivos }} arquivos
          (frente e verso, PNG e PDF).
          <!-- REFAZER É PERMITIDO (cartão rasga, mancha, some), mas a tela tem de
               DIZER: senão a pasta do Zoho volta com o dobro dos arquivos e
               ninguém sabe qual é o bom. -->
          <strong v-if="resumoDosCartoes.refazendo">
            {{ resumoDosCartoes.refazendo }} já tinha(m) cartão e será(ão) refeito(s).
          </strong>
        </p>
        <button class="au-botao" type="button"
                :disabled="!resumoDosCartoes.total || pedindoCartoes"
                @click="pedirOsCartoes">
          {{ pedindoCartoes ? 'Mandando…' : 'Gerar ' + resumoDosCartoes.total + ' cartão(ões)' }}
        </button>
      </div>
    </template>

    <!-- ── REGISTROS ────────────────────────────────────────────────────── -->
    <template v-else-if="aba === 'registros'">
      <!-- ── A FILA, ANTES DE TUDO ────────────────────────────────────────
           Ela fica ACIMA da busca e da lista de propósito: é a única coisa
           desta aba que espera por uma pessoa. Quem abre "Garantias" quase
           sempre vem por causa dela; a lista de quem já está registrado é
           consulta, e consulta espera.

           ⚠️ POR QUE ELA EXISTE. A tag não tem senha: quem encosta o celular
           na bolsa abre a página. Até 03/09/2026 registrar era "quem chegar
           primeiro leva" — qualquer pessoa que segurasse a bolsa punha o nome
           dela, e a dona de verdade lia "já registrada" e ficava sem garantia.
           Agora o sistema procura a compra no Bling: bateu, entra na hora;
           não bateu, cai aqui.

           ⚠️ E "NÃO BATEU" NÃO QUER DIZER "MENTIU". Feira, presente, revenda,
           pedido lançado sem CPF: é a maioria dos casos honestos. Por isso
           nenhuma palavra desta caixa acusa quem está esperando. -->
      <section v-if="filaDeGarantias.length" class="au-fila-garantias">
        <h2 class="au-fila-titulo">
          {{ filaDeGarantias.length }}
          {{ filaDeGarantias.length === 1 ? 'registro esperando você' : 'registros esperando você' }}
        </h2>
        <p class="au-instrucao">
          Não achamos a compra destas pessoas pelo CPF. Confira e decida — a garantia delas
          só começa a valer no seu nome depois disso.
        </p>

        <div class="au-lista">
          <article v-for="pd in filaDeGarantias" :key="pd.id" class="au-card">
            <div class="au-card-topo">
              <span class="au-modelo">{{ pd.nome }}</span>
              <span class="au-progresso">{{ dataCurta(pd.criado_em) }}</span>
            </div>
            <div class="au-card-linha">
              <span class="au-ref">{{ pd.modelo }}<template v-if="pd.cor"> · {{ pd.cor }}</template></span>
              <span>{{ rotuloDaSerie({ numero_na_serie: pd.numero_na_serie }, pd) }}</span>
              <span>{{ pd.codigo }}</span>
            </div>
            <div class="au-card-linha">
              <span>CPF {{ pd.cpf }}</span>
              <span>{{ pd.whatsapp }}</span>
              <span v-if="pd.onde_comprou">comprou em {{ pd.onde_comprou }}</span>
              <span v-if="pd.comprado_em">na data {{ dataCurta(pd.comprado_em) }}</span>
            </div>

            <!-- ⚠️ ESTA PEÇA JÁ TEM DONO é o aviso mais importante da tela: é
                 aqui que se decide entre duas pessoas que dizem ser a mesma
                 dona, e era exatamente isso que o sistema antigo resolvia
                 sozinho, do jeito errado, dando para quem chegou primeiro. -->
            <p v-if="pd.e_o_dono_atual === false && donoDe(pd.codigo)" class="au-aviso-menor">
              <strong>Esta peça já está registrada em nome de {{ donoDe(pd.codigo).nome }}.</strong>
              Aprovar aqui troca o dono.
            </p>

            <details class="au-como-conferir">
              <summary>Como conferir</summary>
              <ul>
                <li v-for="(passo, i) in comoConferir(pd, pd)" :key="i">{{ passo }}</li>
              </ul>
            </details>

            <div v-if="decidindo?.id !== pd.id" class="au-acoes">
              <button class="au-botao secundario" type="button"
                      @click="abrirDecisao(pd, 'recusado')">Recusar</button>
              <button class="au-botao" type="button"
                      @click="abrirDecisao(pd, 'aprovado')">Aprovar garantia</button>
            </div>

            <div v-else class="au-confirma">
              <p class="au-confirma-texto">
                <template v-if="decidindo.estado === 'aprovado'">
                  Aprovar a garantia de <strong>{{ pd.nome }}</strong> nesta peça?
                </template>
                <template v-else>
                  Recusar o registro de <strong>{{ pd.nome }}</strong>?
                </template>
              </p>
              <p class="au-aviso-menor">
                <template v-if="decidindo.estado === 'aprovado'">
                  A garantia passa a valer no nome dela, contando 2 anos da data da compra.
                </template>
                <template v-else>
                  Ela continua podendo registrar de novo. A recusa fica no histórico da peça.
                </template>
              </p>

              <label class="au-campo">
                <span class="au-rot">Motivo{{ decidindo.estado === 'recusado' ? '' : ' (opcional)' }}</span>
                <input v-model="motivoDaDecisao" type="text" maxlength="200" :disabled="decisaoEmVoo"
                       :placeholder="decidindo.estado === 'aprovado'
                         ? 'Ex.: conferi a venda na feira de agosto'
                         : 'Ex.: a cliente confirmou que não é a bolsa dela'"></label>

              <p v-if="erroDaDecisao" class="au-erro">{{ erroDaDecisao }}</p>
              <div class="au-acoes">
                <button class="au-botao secundario" type="button" :disabled="decisaoEmVoo"
                        @click="fecharDecisao">Cancelar</button>
                <button class="au-botao" type="button" :disabled="decisaoEmVoo || !podeDecidir"
                        @click="confirmarDecisao">
                  {{ decisaoEmVoo ? 'Salvando…' : (decidindo.estado === 'aprovado' ? 'Aprovar' : 'Recusar') }}
                </button>
              </div>
            </div>
          </article>
        </div>
      </section>

      <div class="au-topo-acao">
        <input v-model="busca" class="au-busca" type="search" placeholder="Buscar por nome ou código">
        <button class="au-botao secundario" type="button" v-if="registros.length" @click="baixarPlanilha">
          Baixar planilha
        </button>
      </div>

      <p v-if="!registros.length" class="au-vazio">
        Nenhuma cliente registrou a garantia ainda.
      </p>
      <p v-else-if="!registrosFiltrados.length" class="au-vazio">
        Nada encontrado para “{{ busca }}”.
      </p>

      <!-- Tabela no computador; cartão no celular. As duas últimas colunas são
           as únicas opcionais desta linha, e ficam no FIM de propósito: quando
           faltam, sobram células vazias no fim e as quatro primeiras continuam
           alinhadas de linha para linha. -->
      <div class="au-lista au-tabela au-tabela-garantias">
        <div class="au-tabela-cab" aria-hidden="true">
          <span>Cliente</span><span>Garantia até</span><span>Código</span>
          <span>WhatsApp</span><span>Onde comprou</span><span>Comprou em</span>
        </div>
        <div v-for="r in registrosFiltrados" :key="r.codigo" class="au-card">
          <div class="au-card-topo">
            <span class="au-modelo">{{ r.nome }}</span>
            <span class="au-progresso">até {{ dataCurta(r.garantia_ate) }}</span>
          </div>
          <div class="au-card-linha">
            <span class="au-ref">{{ r.codigo }}</span>
            <span>{{ r.whatsapp }}</span>
            <span v-if="r.onde_comprou">{{ r.onde_comprou }}</span>
            <span v-if="r.comprado_em">comprou {{ dataCurta(r.comprado_em) }}</span>
          </div>
          <!-- DE ONDE ESTA GARANTIA VEIO. Sem isto, daqui a um ano ninguém sabe
               quais foram conferidas de verdade e quais alguém aprovou no olho —
               e é essa diferença que importa no dia de uma disputa. -->
          <p v-if="r.bling_pedido" class="au-aviso-menor">
            Compra conferida: pedido {{ r.bling_pedido }} no Bling.
          </p>

          <div v-if="podeEditar && trocando !== r.codigo && baixandoGarantia !== r.codigo" class="au-acoes">
            <button class="au-botao secundario" type="button" @click="abrirTroca(r)">
              Trocar de dono
            </button>
            <!-- ⚠️ TROCAR E BAIXAR SAO COISAS DIFERENTES, e ficam lado a lado de
                 proposito: bolsa que mudou de mao TROCA de dono e a garantia segue;
                 bolsa que VOLTOU tem a garantia encerrada. Quem confunde as duas apaga
                 a garantia de uma cliente que continua com a bolsa — por isso os
                 rotulos dizem o que ACONTECE, e nao "editar". -->
            <button class="au-botao secundario" type="button" @click="abrirBaixaDeGarantia(r)">
              Encerrar garantia (devolução)
            </button>
          </div>

          <!-- A PERGUNTA DA BAIXA. Motivo SEMPRE obrigatorio e senha, como o resto da
               tela: isto apaga o vinculo de uma pessoa de verdade com a bolsa dela. -->
          <div v-if="baixandoGarantia === r.codigo" class="au-confirma">
            <p class="au-confirma-texto">
              A garantia de <strong>{{ r.nome }}</strong> vai ser encerrada.
              A página do selo volta a mostrar a bolsa <strong>sem dona</strong> — as iniciais
              dela somem de lá — e a peça pode ser registrada de novo por quem comprar.
              O histórico fica guardado aqui dentro.
            </p>
            <label class="au-campo"><span class="au-rot">Por que a garantia está sendo encerrada</span>
              <select v-model="motivoEscolhidoDaDevolucao" :disabled="baixaDeGarantiaEmVoo">
                <option value="">Escolha o motivo…</option>
                <option v-for="m in MOTIVOS_DE_DEVOLUCAO" :key="m.chave" :value="m.chave">{{ m.rotulo }}</option>
              </select>
            </label>
            <!-- A observação é OPCIONAL quando o motivo veio da lista, e
                 OBRIGATÓRIA em "Outro" — que sem texto não explica nada. -->
            <label v-if="motivoEscolhidoDaDevolucao" class="au-campo">
              <span class="au-rot">{{ motivoEscolhidoDaDevolucao === 'outro' ? 'Escreva o motivo' : 'Observação (opcional)' }}</span>
              <input v-model="motivoDaBaixaDeGarantia" type="text" :disabled="baixaDeGarantiaEmVoo"
                     :placeholder="motivoEscolhidoDaDevolucao === 'outro' ? 'Escreva o que aconteceu' : 'Algum detalhe que ajude a entender depois'"></label>
            <label class="au-campo"><span class="au-rot">Sua senha</span>
              <input v-model="senhaDaBaixa" type="password" autocomplete="current-password"
                     :disabled="baixaDeGarantiaEmVoo"></label>
            <p v-if="erroDaBaixa" class="au-erro" role="alert">{{ erroDaBaixa }}</p>
            <div class="au-acoes">
              <button class="au-botao" type="button"
                      :disabled="baixaDeGarantiaEmVoo || !senhaDaBaixa || !motivoDaDevolucaoPronto"
                      @click="confirmarBaixaDeGarantia(r)">
                {{ baixaDeGarantiaEmVoo ? 'Encerrando…' : 'Encerrar a garantia' }}
              </button>
              <button class="au-botao secundario" type="button" :disabled="baixaDeGarantiaEmVoo"
                      @click="fecharBaixaDeGarantia">Cancelar</button>
            </div>
          </div>

          <!-- ⚠️ REVENDA E PRESENTE SÃO O CASO NORMAL DISTO, não a exceção: uma
               bolsa muda de mão e a garantia tem de acompanhar. Por isso a troca
               existe na tela em vez de virar chamado — e por isso ela exige
               motivo escrito e o código digitado, do mesmo jeito que excluir um
               lote. É história que se vai querer consultar. -->
          <div v-else-if="trocando === r.codigo" class="au-confirma">
            <p class="au-confirma-texto">
              Trocar o dono desta peça? Hoje ela está em nome de <strong>{{ r.nome }}</strong>.
            </p>
            <p class="au-aviso-menor">
              A garantia <strong>não recomeça</strong>: continua valendo até
              {{ dataCurta(r.garantia_ate) }}, contando da compra original.
            </p>

            <label class="au-campo"><span class="au-rot">Nome do novo dono</span>
              <input v-model="troca.nome" type="text" maxlength="120" :disabled="trocaEmVoo"></label>
            <label class="au-campo"><span class="au-rot">CPF</span>
              <input :value="troca.cpf" type="text" inputmode="numeric" maxlength="14"
                     :disabled="trocaEmVoo" placeholder="000.000.000-00"
                     @input="troca.cpf = cpfComMascara($event.target.value)"></label>
            <label class="au-campo"><span class="au-rot">WhatsApp</span>
              <input v-model="troca.whatsapp" type="tel" inputmode="numeric" maxlength="15"
                     :disabled="trocaEmVoo" placeholder="(19) 99999-9999"></label>
            <label class="au-campo"><span class="au-rot">Motivo</span>
              <input v-model="troca.motivo" type="text" maxlength="200" :disabled="trocaEmVoo"
                     placeholder="Ex.: a cliente revendeu e a compradora pediu a garantia"></label>
            <label class="au-campo">
              <span class="au-rot">Digite o código da etiqueta para confirmar</span>
              <input v-model="troca.confirmacao" type="text" maxlength="20" :disabled="trocaEmVoo"
                     :placeholder="r.codigo"></label>

            <p v-if="erroDaTroca" class="au-erro">{{ erroDaTroca }}</p>
            <div class="au-acoes">
              <button class="au-botao secundario" type="button" :disabled="trocaEmVoo"
                      @click="fecharTroca">Cancelar</button>
              <button class="au-botao" type="button"
                      :disabled="trocaEmVoo || !podeTrocarDono(troca, r.codigo)"
                      @click="confirmarTroca(r)">
                {{ trocaEmVoo ? 'Trocando…' : 'Trocar de dono' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ── ALERTAS ──────────────────────────────────────────────────────── -->
    <template v-else>
      <!-- ⚠️ MESMO CORTE DA ABA ETIQUETAS: a segunda metade deste parágrafo
           ("o que denuncia a cópia é o mesmo código lido de muitos aparelhos, ou
           alguém tentando adivinhar códigos") é exatamente o que a ajuda da aba
           logo acima já lista. Sobrou o PORQUÊ, que é o que a ajuda não diz — e é
           ele que explica por que esta aba existe. -->
      <p class="au-instrucao">
        A etiqueta guarda um endereço, e endereço se copia: por isso a etiqueta sozinha
        não impede falsificação. Quem denuncia a cópia é esta lista.
      </p>

      <p v-if="resumo.limpo" class="au-pronto">
        Nada suspeito nos últimos 30 dias. Foram {{ alertas?.total_leituras || 0 }} leituras.
      </p>

      <template v-else>
        <h2 class="au-secao" v-if="resumo.repetidas">Peças lidas de muitos aparelhos</h2>
        <!-- Tabela no computador, cartão no celular: as três listas desta aba
             são de varredura, e coluna alinhada é o que deixa a linha estranha
             saltar aos olhos. -->
        <div class="au-lista au-tabela au-tabela-repetidas">
          <div class="au-tabela-cab" aria-hidden="true">
            <span>Código</span><span>Aparelhos</span><span>Leituras</span><span>Última leitura</span>
          </div>
          <div v-for="a in (alertas?.repetidas || [])" :key="a.codigo" class="au-card alerta">
            <div class="au-card-topo">
              <span class="au-modelo">{{ a.codigo }}</span>
              <span class="au-progresso">{{ a.aparelhos }} aparelhos</span>
            </div>
            <div class="au-card-linha">
              <span>{{ a.leituras }} leituras</span>
              <span>última em {{ dataCurta(a.ultima) }}</span>
            </div>
          </div>
        </div>

        <h2 class="au-secao" v-if="resumo.invalidas">Códigos que não existem, tentados</h2>
        <div class="au-lista au-tabela au-tabela-invalidas">
          <div class="au-tabela-cab" aria-hidden="true">
            <span>Código tentado</span><span>Tentativas</span><span>Última tentativa</span>
          </div>
          <div v-for="a in (alertas?.invalidas || [])" :key="a.codigo" class="au-card alerta">
            <div class="au-card-topo">
              <span class="au-modelo">{{ a.codigo }}</span>
              <span class="au-progresso">{{ a.tentativas }} tentativas</span>
            </div>
            <div class="au-card-linha"><span>última em {{ dataCurta(a.ultima) }}</span></div>
          </div>
        </div>

        <!-- O ALERTA MAIS IMPORTANTE DESTA TELA. A página da cliente não avisa
             nada sobre baixa (decisão do dono) — então quem avisa é o painel,
             usando as leituras que a página já registra. Assim o dono fica
             sabendo que a bolsa extraviada apareceu, sem incomodar quem está
             com ela. -->
        <template v-if="resumo.baixadasLidas">
          <h2 class="au-secao">Peças baixadas que foram lidas</h2>
          <p class="au-instrucao">
            Estas peças estão baixadas e alguém encostou o celular nelas depois disso.
            Vale conferir onde a bolsa apareceu.
          </p>
          <div class="au-lista au-tabela au-tabela-baixadas">
            <div class="au-tabela-cab" aria-hidden="true">
              <span>Código</span><span>Leituras</span><span>Motivo da baixa</span><span>Última leitura</span>
            </div>
            <div v-for="b in (alertas?.baixadas_lidas || [])" :key="b.codigo" class="au-card alerta">
              <div class="au-card-topo">
                <span class="au-modelo">{{ b.codigo }}</span>
                <span class="au-progresso">{{ b.leituras }} leitura(s)</span>
              </div>
              <div class="au-card-linha">
                <span>{{ rotuloDoMotivo(b.motivo) }}</span>
                <span>última em {{ dataCurta(b.ultima) }}</span>
              </div>
            </div>
          </div>
        </template>
      </template>
    </template>

    <!-- O GUIA FICA FORA DA CORRENTE DAS ABAS. Ele estava ENTRE a aba Gravar e
         a aba Registros, e um `v-if` no meio de um `v-if`/`v-else-if` PARTE a
         corrente em duas: a segunda metade recomeçava do zero e o `v-else` dela
         — a aba Alertas inteira — vinha desenhado embaixo das abas Lotes e
         Gravar, e também embaixo do "Carregando…". Medido no navegador, a
         375px, em 30/08.
         Ele é sobreposição de tela cheia: onde mora no HTML não muda o desenho,
         muda só a corrente. -->
    <!-- ── O GUIA DE BANCADA ───────────────────────────────────────────────
         Abre sozinho na primeira visita e some depois; o botão "Rever o guia de
         bancada" da aba Gravar o traz de volta. O "pular" fica sempre visível:
         guia que prende a pessoa vira estorvo, não ajuda.
         O "Voltar" nasceu com o guia longo: passar direto pela tela que
         interessava obrigava a recomeçar o guia inteiro.
         O MIOLO ROLA DENTRO DA CAIXA, e nunca a página atrás (PADRAO item 4):
         as telas do socorro têm quatro casos, e no celular elas passam da
         altura da tela. -->
    <div v-if="guiaAberto" v-trava-rolagem class="au-guia-fundo" role="dialog" aria-modal="true"
         aria-label="Guia de bancada da gravação">
      <div class="au-guia">
        <p class="au-guia-conta">{{ telaDoGuia + 1 }} de {{ TELAS_DO_GUIA.length }}</p>
        <h3 class="au-guia-titulo">{{ TELAS_DO_GUIA[telaDoGuia].titulo }}</h3>
        <div class="au-guia-miolo">
          <p class="au-guia-texto">{{ TELAS_DO_GUIA[telaDoGuia].texto }}</p>
          <!-- Os itens são o que separa "guia de bancada" de "tela de texto":
               cada um tem um rótulo que se acha com o olho, de pé, com o
               celular na mão. -->
          <dl v-if="TELAS_DO_GUIA[telaDoGuia].itens" class="au-guia-itens">
            <template v-for="i in TELAS_DO_GUIA[telaDoGuia].itens" :key="i.rotulo">
              <dt>{{ i.rotulo }}</dt>
              <dd>{{ i.texto }}</dd>
            </template>
          </dl>
        </div>
        <div class="au-guia-acoes">
          <button class="au-botao secundario" type="button" @click="fecharGuia">Pular</button>
          <button class="au-botao secundario" type="button" :disabled="telaDoGuia === 0"
                  @click="voltarGuia">Voltar</button>
          <button class="au-botao" type="button" @click="avancarGuia">
            {{ telaDoGuia + 1 === TELAS_DO_GUIA.length ? 'Entendi, começar' : 'Continuar' }}
          </button>
        </div>
      </div>
    </div>

    <!-- ── FORMULÁRIO DE LOTE ───────────────────────────────────────────── -->
    <!-- ══════════════════════════════════════════════════════════════════
         LER UMA ETIQUETA — modal
         ══════════════════════════════════════════════════════════════════
         ⚠️ `v-trava-rolagem` (PADRÃO item 4). A diretiva está registrada em
         `ponto-de-partida.js`; sem ela a página atrás rola por baixo do modal e,
         no celular, o dedo escorrega a tela para os lados. Os outros dois modais
         desta tela ainda não a têm — é anterior a este bloco e está anotado. -->
    <div v-if="leituraAberta" v-trava-rolagem class="au-fundo"
         @click.self="fecharLeituraDeEtiqueta">
      <div class="au-folha au-folha-leitura" role="dialog" aria-modal="true"
           aria-label="Ler uma etiqueta">
        <div class="au-folha-topo">
          <h2>Ler uma etiqueta</h2>
          <button class="au-fechar" type="button" aria-label="Fechar"
                  :disabled="ocupadoNaLeitura" @click="fecharLeituraDeEtiqueta">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
                 stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <!-- OS ANÉIS DA BANCADA, no meio, que é o que a pessoa olha enquanto
             segura a etiqueta. O anel NUNCA é o único aviso: título e detalhe
             vão sempre escritos ao lado (PADRÃO item 9). -->
        <div class="au-leitura-corpo">
          <div class="au-aneis-caixa au-leitura-aneis" :class="'au-aneis-' + estadoDaLeituraAneis.chave"
               role="status">
            <svg class="au-aneis" viewBox="0 0 120 120" width="120" height="120" aria-hidden="true"
                 fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
              <circle class="au-anel-1" cx="60" cy="60" r="54" stroke-width="2" />
              <circle class="au-anel-2" cx="60" cy="60" r="40" stroke-width="2.6" />
              <circle class="au-anel-3" cx="60" cy="60" r="26" stroke-width="3.2" />
              <circle class="au-anel-nucleo" cx="60" cy="60" r="11" stroke-width="3.2" />
              <polyline class="au-anel-visto" points="42 61 55 74 80 45" stroke-width="7" />
            </svg>
          </div>
          <p class="au-bancada-titulo au-leitura-titulo">{{ estadoDaLeituraAneis.titulo }}</p>
          <p class="au-bancada-detalhe au-leitura-detalhe">{{ estadoDaLeituraAneis.detalhe }}</p>
        </div>

        <!-- O QUE A ETIQUETA É — quatro respostas -->
        <template v-if="leituraLivre && !confirmandoReset">
          <div v-if="leituraLivre.tipo === 'conhecida'" class="au-leitura-achado">
            <p class="au-modelo">
              {{ descricaoDaPeca(leituraLivre.peca, loteDaPeca(leituraLivre.peca.lote_id)) }}
            </p>
            <p class="au-card-linha"><span class="au-ref">{{ leituraLivre.codigo }}</span></p>
            <p v-if="leituraPedeGarantia" class="au-confirma-texto au-aviso-garantia" role="alert">
              Esta bolsa tem <strong>garantia registrada por uma cliente</strong>. Resetar tira a
              identidade da bolsa dela.
            </p>
          </div>
          <p v-else-if="leituraLivre.tipo === 'desconhecida'" class="au-leitura-achado au-card-linha">
            É uma etiqueta nossa, mas o código <span class="au-ref">{{ leituraLivre.codigo }}</span>
            não existe neste sistema. Dá para apagá-la e reaproveitar.
          </p>
        </template>

        <!-- AS AÇÕES. Etiqueta virgem e de terceiro não aparecem aqui, e quem só
             pode ver também não — `acoesDaLeitura` decide, e tem teste. -->
        <div v-if="acoesDaLeituraAgora.length && !confirmandoReset" class="au-acoes">
          <button v-if="acoesDaLeituraAgora.includes('regravar')" class="au-botao secundario"
                  type="button" :disabled="ocupadoNaLeitura" @click="regravarDaLeitura">
            Regravar o mesmo código
          </button>
          <button v-if="acoesDaLeituraAgora.includes('resetar') || acoesDaLeituraAgora.includes('apagar-chip')"
                  class="au-botao secundario" type="button"
                  :disabled="ocupadoNaLeitura" @click="confirmandoReset = true">
            {{ acoesDaLeituraAgora.includes('resetar') ? 'Resetar' : 'Apagar esta etiqueta' }}
          </button>
        </div>

        <!-- LER OUTRA: sem fechar e reabrir o modal, que é o que a bancada faz
             uma etiqueta atrás da outra. -->
        <div v-if="!lendoEtiqueta && !ocupadoNaLeitura && !confirmandoReset" class="au-acoes">
          <button class="au-botao" type="button" @click="lerEtiquetaLivre">
            {{ leituraLivre ? 'Ler outra etiqueta' : 'Ler etiqueta' }}
          </button>
        </div>

        <!-- A PERGUNTA. Apagar o chip não tem desfazer, então cobra senha — a
             mesma que a lista cobra. Esta ação é MAIS destrutiva que aquela
             (apaga o chip junto) e não pode ser mais fácil. -->
        <div v-if="confirmandoReset" class="au-confirma">
          <p class="au-confirma-texto">
            <span v-if="leituraLivre?.tipo === 'conhecida'">
              A etiqueta vai ser <strong>apagada</strong> e a peça volta para a fila de gravação.
              A etiqueta apagada continua costurada dentro da bolsa.
            </span>
            <span v-else>
              A etiqueta vai ser <strong>apagada</strong> e poderá ser reaproveitada.
            </span>
          </p>

          <label v-if="leituraPedeGarantia" class="au-campo"><span class="au-rot">Motivo</span>
            <input v-model="motivoDaLeitura" type="text" :disabled="ocupadoNaLeitura"
                   placeholder="Por que esta bolsa perde a identidade?">
          </label>

          <label class="au-campo"><span class="au-rot">Sua senha</span>
            <input v-model="senhaDaLeitura" type="password" autocomplete="current-password"
                   :disabled="ocupadoNaLeitura">
          </label>

          <div class="au-acoes">
            <button class="au-botao" type="button" :disabled="ocupadoNaLeitura || !senhaDaLeitura"
                    @click="leituraLivre?.tipo === 'conhecida' ? confirmarResetDaLeitura() : apagarChipOrfao()">
              {{ ocupadoNaLeitura ? 'Apagando…' : 'Apagar a etiqueta' }}
            </button>
            <button class="au-botao secundario" type="button" :disabled="ocupadoNaLeitura"
                    @click="confirmandoReset = false; senhaDaLeitura = ''">Cancelar</button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="formulario" v-trava-rolagem class="au-fundo" @click.self="formulario = false">
      <!-- ⚠️ ESTE e o modal que precisa de tela: e dentro DELE que a lista de
           centenas de produtos aparece. Era 420px de largura com a lista
           espremida — ver a variante `larga` no CSS, e o porque da excecao ao
           PADRAO item 4 escrito la. -->
      <form class="au-folha au-folha-larga" @submit.prevent="gerarLote">
        <!-- O BOTÃO DE FECHAR TEM 40px DE ALVO E MORA NO CANTO (PADRÃO item 4).
             Clicar no fundo já fechava, mas isso não é um alvo que se vê: no
             celular a caixa ocupa a tela e não sobra fundo nenhum para clicar.
             Ícone em SVG, nunca emoji. -->
        <div class="au-folha-topo">
          <h2>Gerar lote de etiquetas</h2>
          <button class="au-fechar" type="button" aria-label="Fechar"
                  @click="formulario = false">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
                 stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        <p class="au-instrucao">
          Um código diferente para cada peça. Depois de criar, a aba “Gravar” conduz
          etiqueta por etiqueta.
        </p>

        <!-- ── ESCOLHER O PRODUTO NO BLING ───────────────────────────────
             Os três campos abaixo eram digitados à mão, e o que se digita aqui
             é o que a CLIENTE lê na página do selo — um erro de digitação vira
             uma bolsa original mostrando o nome errado, e ninguém descobre até
             alguém encostar o celular.
             Os campos continuam editáveis depois de escolher: o Bling preenche,
             a pessoa confere. -->
        <div class="au-escolha-produto">
          <label class="au-campo"><span class="au-rot">Produto no Bling</span>
            <!-- Enter num campo de busca é o gesto mais natural que existe, e este
                 campo mora dentro do `<form @submit.prevent="gerarLote">`: sem esta
                 linha, apertar Enter GRAVA o lote inteiro no banco, com a
                 quantidade padrão, sem ninguém ter pedido. -->
            <input v-model="buscaProduto" type="search" @keydown.enter.prevent
                   @focus="listaDeProdutosAberta = true"
                   :placeholder="carregandoProdutos ? 'Carregando os produtos…' : 'Clique para ver a lista, ou busque por nome/referência'"></label>

          <p v-if="erroProdutos" class="au-aviso-menor">
            {{ erroProdutos.titulo }}
            <template v-if="erroProdutos.detalhe">{{ erroProdutos.detalhe }}</template>
            Você ainda pode escrever à mão nos campos abaixo.
          </p>

          <p class="au-aviso-menor au-produtos-conta">
            <template v-if="carregandoProdutos">
              Procurando no Bling… {{ produtosLidos }} produto(s) lidos até agora.
            </template>
            <template v-else-if="produtoEscolhido">
              Escolhido: <strong>{{ produtoEscolhido.nome }}</strong>. Clique na busca para trocar.
            </template>
            <template v-else>
              {{ produtosAchados.length }} de {{ produtos.length }} produto(s)<template
                v-if="paginaAtualDeProdutos.paginas > 1"> · página {{ paginaAtualDeProdutos.pagina }}
                de {{ paginaAtualDeProdutos.paginas }}</template>.
            </template>
          </p>

          <!-- A LISTA SÓ OCUPA ESPAÇO QUANDO ESTÁ SENDO USADA: abre ao clicar na
               busca e fecha ao escolher. Aberta o tempo todo, empurraria os
               campos do lote para fora da tela. -->
          <ul v-if="listaDeProdutosAberta && paginaAtualDeProdutos.itens.length" class="au-produtos">
            <li v-for="p in paginaAtualDeProdutos.itens" :key="p.codigo">
              <button class="au-produto" type="button"
                      @click="usarProduto(p); listaDeProdutosAberta = false">
                <!-- A MINIATURA VEM DA PRÓPRIA LISTA DO BLING (70px, 1,3 KB) —
                     nenhuma chamada a mais. Nem todo produto tem foto lá: 3 de 9
                     da linha nova, medido em 03/09/2026. Sem foto mostra o
                     quadrinho vazio, e não um ícone de erro. -->
                <img v-if="p.foto" :src="p.foto" alt="" class="au-produto-foto" loading="lazy">
                <span v-else class="au-produto-foto au-produto-sem-foto" aria-hidden="true"></span>
                <!-- TUDO NUMA LINHA: nome e referência lado a lado. Sem
                     `text-overflow`, que o PADRÃO item 5 proíbe em nome — se não
                     couber, quebra; nunca corta com reticência. -->
                <span class="au-produto-texto">
                  <strong>{{ p.nome }}</strong>
                  <span class="au-produto-ref">{{ p.codigo }}</span>
                </span>
                <!-- A LUPA NÃO ESCOLHE O PRODUTO: ela abre a foto grande. Sem o
                     `.stop`, clicar para VER preencheria os campos do lote. -->
                <span v-if="p.foto" class="au-produto-lupa" role="button" tabindex="0"
                      aria-label="Ver a foto maior"
                      @click.stop="verFotoGrande(p)" @keydown.enter.stop.prevent="verFotoGrande(p)">
                  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none"
                       stroke="currentColor" stroke-width="2" stroke-linecap="round">
                    <circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/>
                    <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
                  </svg>
                </span>
              </button>
            </li>
          </ul>

          <!-- OS NÚMEROS, como nas páginas de busca: primeira, última e a janela
               em volta da atual. Sem eles a lista mentia — mostrava um pedaço e
               não dizia que havia mais. -->
          <nav v-if="listaDeProdutosAberta && paginaAtualDeProdutos.paginas > 1"
               class="au-paginas" aria-label="Páginas de produtos">
            <button class="au-pagina" type="button" :disabled="paginaAtualDeProdutos.pagina === 1"
                    @click="paginaDeProdutos = paginaAtualDeProdutos.pagina - 1">‹</button>
            <template v-for="(n, i) in numerosDasPaginas" :key="i">
              <span v-if="n === null" class="au-pagina-vazio" aria-hidden="true">…</span>
              <button v-else class="au-pagina" type="button"
                      :class="{ on: n === paginaAtualDeProdutos.pagina }"
                      :aria-current="n === paginaAtualDeProdutos.pagina ? 'page' : null"
                      @click="paginaDeProdutos = n">{{ n }}</button>
            </template>
            <button class="au-pagina" type="button"
                    :disabled="paginaAtualDeProdutos.pagina === paginaAtualDeProdutos.paginas"
                    @click="paginaDeProdutos = paginaAtualDeProdutos.pagina + 1">›</button>
          </nav>

          <p v-else-if="listaDeProdutosAberta && !carregandoProdutos && buscaProduto"
             class="au-aviso-menor au-produtos-conta">
            Nenhum produto da linha nova com esse nome ou referência.
          </p>
        </div>

        <label class="au-campo"><span class="au-rot">Modelo</span>
          <input v-model="novo.modelo" type="text" maxlength="80" required placeholder="Mônaco"></label>
        <label class="au-campo"><span class="au-rot">Cor</span>
          <input v-model="novo.cor" type="text" maxlength="60" placeholder="Quartz"></label>
        <label class="au-campo"><span class="au-rot">Referência</span>
          <input v-model="novo.sku" type="text" maxlength="40" placeholder="LV1021"></label>
        <!-- A O.S. É OPCIONAL e é o número que amarra a bolsa ao papel da
             oficina. Fica ao lado da Referência porque as duas são o mesmo tipo
             de coisa: um código de fora que identifica este lote. -->
        <label class="au-campo"><span class="au-rot">O.S. (opcional)</span>
          <input v-model="novo.os" type="text" maxlength="40" placeholder="Número da ordem de serviço"></label>
        <!-- ⚠️ AVISA, NÃO IMPEDE. A referência pode estar certa assim, e quem
             sabe disso é o dono — o campo continua aceitando e o botão "Gerar"
             continua ligado. O que a tela não pode é deixar entrar em silêncio
             uma referência que faz dois números de série iguais. -->
        <label class="au-campo"><span class="au-rot">Quantidade de peças</span>
          <input v-model.number="novo.quantidade" type="number" min="1" max="500" required></label>
        <label class="au-campo"><span class="au-rot">Finalizado em</span>
          <input v-model="novo.fabricado_em" type="date"></label>

        <p class="au-erro" v-if="erroForm">{{ erroForm }}</p>

        <div class="au-acoes">
          <button class="au-botao secundario" type="button" @click="formulario = false">Cancelar</button>
          <button class="au-botao" type="submit" :disabled="salvando">
            {{ salvando ? 'Gerando…' : 'Gerar' }}
          </button>
        </div>
      </form>
    </div>

    <!-- ══════════════════════════════════════════════════════════════════════
         A FOTO GRANDE DO PRODUTO
         ══════════════════════════════════════════════════════════════════════
         ⚠️ FICA DEPOIS DO MODAL DE GERAR LOTE NO TEMPLATE, E ISSO NAO E ESTILO.
         Os dois usam `.au-fundo`, que tem a MESMA `z-index` — entao quem pinta
         por cima e quem vem DEPOIS no DOM. Foi exatamente assim que o modal de
         produtos abriu ATRAS do de gerar lote e pareceu que nada acontecia. -->
    <div v-if="fotoGrande" v-trava-rolagem class="au-fundo au-fundo-foto"
         @click.self="fotoGrande = null">
      <div class="au-folha au-folha-foto" role="dialog" aria-modal="true"
           :aria-label="'Foto de ' + fotoGrande.nome">
        <div class="au-folha-topo">
          <h2>{{ fotoGrande.nome }}</h2>
          <button class="au-fechar" type="button" aria-label="Fechar" @click="fotoGrande = null">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none"
                 stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>
        <img :src="fotoGrande.url" :alt="'Foto de ' + fotoGrande.nome" class="au-foto-grande">
        <p class="au-aviso-menor au-produtos-conta">
          <template v-if="fotoGrande.carregando">Buscando a foto maior no Bling…</template>
          <template v-else-if="fotoGrande.so_miniatura">
            Este produto só tem a miniatura no Bling — é esta a maior que existe.
          </template>
          <template v-else>{{ fotoGrande.codigo }}</template>
        </p>
      </div>
    </div>
  </div>
</template>

<script setup>
/*
 * Painel do Selo Vessel — o lado de dentro da página pública /verify.
 *
 * A tela não inventa código nenhum: quem sorteia é o banco (vessel_gerar_lote),
 * porque a garantia de "nenhum código repetido" é da chave primária. Ver
 * db/migrations/2026-08-05-vessel-painel.sql.
 */
import { ref, reactive, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { adminToast } from '../../compartilhado/avisos.js'
import { planilhaXlsx } from '../../compartilhado/planilha-xlsx.js'
import {
  enderecoDaTag, progressoDoLote, proximaPorGravar, linhasDoCsv, resumoDeAlertas,
  linhasDosNumerosAtivos,
  MOTIVOS_DE_BAIXA, fraseDaRecusa, fraseDaSenha, naFila,
  rotuloDoMotivo, pecasEmOrdem, estadoDaPeca, linhasDaListaDoLote,
  codigosComGarantia, etiquetasGravadas, motivoObrigatorio, descricaoDaPeca,
  agruparPorLote, abrirPorPadrao, contagemDoGrupo,
  rotuloDaSerie, prefixoDaSerie, fraseDaPecaNaMao,
  MOTIVOS_DE_DEVOLUCAO, motivoDaDevolucaoEscrito,
} from './lotes.js'
import {
  filaDeGarantia, comoConferir, fraseDaRecusaDeGarantia,
  podeTrocarDono, cpfComMascara, cpfLimpo,
} from './registros-de-garantia.js'
import {
  // ⚠️ `listaParaGravadorDeMesa` NÃO entra mais aqui, e não é esquecimento: o
  // botão "Baixar a lista das que faltam" saiu da ferramenta em 02/09/2026 (o
  // porquê está escrito na gaveta da aba Gravar e em `baixarListaDoLote`). A
  // função continua em `nfc-fila.js`, com os testes dela — importar sem chamar
  // deixaria um aviso de `unused` e esconderia a decisão.
  conferirLeitura, codigoDoEndereco, codigosNoTextoDoGravador,
} from './nfc-fila.js'
// `PASSOS` e `passoAtual` NÃO entram mais aqui, e isso não é esquecimento: a
// lista dos três passos (Criar / Gravar / Conferir) era o bloco 2 dos OITO que
// vinham antes da área de trabalho na aba Gravar — e ela dizia a MESMA coisa que
// a barra de abas, com os MESMOS números. Duas numerações são duas verdades. O
// texto por extenso continua no guia (`ESTAGIOS` → `TELAS_DO_GUIA`), que é para
// onde a instrução vai neste projeto.
import {
  TELAS_DO_GUIA, AJUDA_DA_ABA, guiaJaVisto, marcarGuiaVisto,
  proximaTelaDoGuia, telaAnteriorDoGuia,
} from './tutorial.js'
import {
  ATALHOS_DE_DATA, ESTADOS_DE_LOTE, ESTADOS_DE_ETIQUETA, intervaloDoAtalho,
  estadoDoLote, seloDoLote, filtrarLotes, lotesParaGravar, lotesComPecaPorGravar,
  filtrarEtiquetas, fraseDaContagem,
} from './busca-e-arquivamento.js'
import PainelDeBusca from './painel-de-busca.vue'
import {
  produtosParaEscolher, procurarProduto, fatiarProdutos, numerosDePagina,
} from './produtos-do-bling.js'
import { paginasDoBling, chamarBling, avisoDoErro } from '../../compartilhado/chamada-do-bling.js'
import { temSuporte, traduzirFalha, criarGravador } from './gravador-nfc.js'
import {
  classificarLeitura, acoesDaLeitura, precisaConfirmarGarantia, resetar, regravar,
} from './ler-etiqueta.js'
// O LEITOR DE MESA. `porta-do-gravador-de-mesa.js` é o irmão de `gravador-nfc.js`
// — a única que fala com `window.gravadorDeMesa`, que só existe dentro do
// programa da janela (gravador/janela/). Fora dele, `temLeitorDeMesa()` é falso e
// nada disto aparece na tela.
import {
  temLeitorDeMesa,
  criarGravadorDeMesa,
  traduzirFalha as traduzirFalhaDoLeitorDeMesa,
  pedeParaReligar, sabeReligar, religarOLeitor,
} from './gravador-de-mesa/porta-do-gravador-de-mesa.js'
// A SEQUÊNCIA — ler antes, planejar em cima do que leu, escrever, ler de volta e
// conferir, e só então marcar. Mora fora do `.vue` porque `node --test` não
// compila `.vue`, e o que precisa de prova aqui é justamente o que não se vê
// olhando a tela: a etiqueta que sai no meio, a que responde bem e não guarda
// nada, a leitura que falhou.
import { gravarPeloLeitorDeMesa, escreverEConferir, apagarEConferir } from './gravador-de-mesa/gravar-pelo-leitor-de-mesa.js'
// A BANCADA. Só conta pura: qual estado sai de qual fase, qual frase sai de cada
// estado, e qual é a única ação. Fica fora do `.vue` pelo mesmo motivo da
// sequência: `node --test` não compila `.vue`.
//
// ⚠️ TRÊS FUNÇÕES DESTE MÓDULO NÃO SÃO MAIS CHAMADAS AQUI, e o motivo é o
// desenho novo: `podeEntrarNaBancada`, `bancadaLembrada` e `lembrarBancada`
// gateavam e lembravam um MODO — e não há mais modo, porque a aba Gravar VIROU a
// bancada. `precisaSairDaBancada` também saiu: ela tirava a tela do modo quando
// a pergunta de sobrescrever aparecia, e agora essa pergunta nasce dentro da
// própria bancada, com todo o contexto dela. As quatro continuam no módulo, com
// os testes delas — quem apagar tem de apagar as duas coisas de propósito, e não
// de passagem.
import { estadoDaBancada, acaoDaBancada, nomeDoModo } from './modo-bancada.js'

// A ABA DOS CARTÕES. Só conta pura: qual peça pode ter cartão, qual já tem, e o
// que vai para a fila. Fica fora do `.vue` pelo mesmo motivo dos outros — e
// porque é aqui que mora a regra de que nada do DESENHO do cartão se recalcula
// nesta tela. O desenho é o do site, e um só.
import {
  BASE_DOS_RECURSOS, MOTIVO_DO_IMPEDIMENTO, linhasDeCartao, marcadasPorPadrao,
  resumoDoPedido, pecaParaODesenho, fraseDoPedidoRecusado, situacaoDoPedido,
} from './cartoes-ean.js'

// A BARRA DE ABAS É UMA SEQUÊNCIA, e não um armário: os três primeiros são
// PASSOS numerados, na ordem em que se faz — cria o lote, grava as etiquetas,
// conserta o que saiu errado. Garantias e Alertas vêm depois do separador
// porque não são passos: são consulta, e numerá-los mentiria sobre o fluxo.
//
// `Registros` virou `Garantias` na tela: é o que aquela lista É — as garantias
// que as clientes registraram. A CHAVE continua `registros`, porque é o nome da
// tabela e de metade dos comentários deste arquivo.
//
// `leitura` é o que o leitor de tela anuncia: ouvir "um lotes" não ajuda
// ninguém, e o número sozinho não diz que é um passo.
const ABAS = [
  { chave: 'lotes', n: 1, rotulo: 'Lotes', leitura: 'Passo 1: Lotes' },
  { chave: 'gravar', n: 2, rotulo: 'Gravar', leitura: 'Passo 2: Gravar' },
  { chave: 'etiquetas', n: 3, rotulo: 'Etiquetas', leitura: 'Passo 3: Etiquetas' },
  // O CARTÃO É O QUARTO PASSO, e não uma consulta: é uma ação que produz coisa
  // física. Vem depois de Etiquetas porque o número de série tem de estar
  // resolvido antes de virar papel — depois de impresso, ele não muda mais.
  { chave: 'cartoes', n: 4, rotulo: 'Cartões EAN', leitura: 'Passo 4: Cartões EAN' },
  { chave: 'registros', rotulo: 'Garantias', leitura: 'Garantias', separaAntes: true },
  { chave: 'alertas', rotulo: 'Alertas', leitura: 'Alertas' },
]

const router = useRouter()
const aba = ref('lotes')

const carregando = ref(true)
const falha = ref('')

const lotes = ref([])
const pecas = ref([])
const registros = ref([])
const pedidosDeGarantia = ref([])
const alertas = ref(null)

const loteEscolhido = ref('')
const busca = ref('')

// ── A ABA DOS CARTÕES EAN ──────────────────────────────────────────────────
// O índice dos produtos publicados (foto tratada, desenho, GTIN, medidas) é
// baixado do site, e só quando a aba abre: são 37 KB que não têm por que pesar
// em quem entrou para gravar uma etiqueta.
const indiceDosCartoes = ref(null)
const carregandoOsCartoes = ref(false)
const erroDosCartoes = ref('')
const loteDosCartoes = ref('')
const marcadasParaCartao = ref([])
const pedidosDeCartao = ref([])
const pedindoCartoes = ref(false)
const pecaNaPrevia = ref(null)
const erroDaPrevia = ref('')
const formulario = ref(false)
const salvando = ref(false)
const erroForm = ref('')
const textoCopiar = ref('Copiar endereço')

// Chrome no Android grava NFC pelo navegador; iPhone e computador não. Quem
// não grava cai no modo de hoje, que continua inteiro logo abaixo.
const gravaPorNfc = ref(temSuporte())

// O LEITOR DE MESA só existe dentro do programa da janela, que abre ESTA MESMA
// tela e empresta o ACR122U para ela. Constante, e não `ref`: ou a janela abriu
// com o programa do outro lado, ou não abriu — isso não muda no meio do turno.
const temLeitorDeMesaAqui = temLeitorDeMesa()
// E ONDE ELE EXISTE, ELE É O PREFERIDO. É o caminho automático da bancada: lê a
// etiqueta antes, monta o plano em cima do que leu, escreve, lê de volta,
// confere e marca — sem ninguém encostar celular em nada, cinquenta vezes.
const gravaPorMesa = ref(temLeitorDeMesaAqui)
// Os DOIS modos que gravam a etiqueta aqui mesmo, agora. O terceiro — o do
// aplicativo — é de quem não tem nem um nem outro (iPhone, computador sem o
// programa) e continua inteiro.
const gravaAoVivo = computed(() => gravaPorMesa.value || gravaPorNfc.value)
// O RÓTULO DO BOTÃO NÃO MORA MAIS AQUI. Ele era um `computed` desta tela
// ("Segure a etiqueta no leitor…" / "Encoste a etiqueta…") escrito ao lado de um
// ternário no template, e o mesmo par de frases já existia — provado — em
// `acaoDaBancada`, no módulo. Duas cópias da mesma frase é como uma delas fica
// para trás: agora o botão desenha o que a conta pura mandou, e só.

// TROCAR DE MODO É UM LUGAR SÓ. Mexer nos dois interruptores à mão em cada
// botão é como nasce o estado impossível — os dois ligados, ou nenhum, com a
// tela mostrando o bloco errado. E o recado do modo anterior sai junto: ele fala
// de uma etiqueta que não está mais na história.
function usarOLeitorDeMesa() { gravaPorMesa.value = true; gravaPorNfc.value = false; recadoNfc.value = '' }
function usarOCelular() { gravaPorMesa.value = false; gravaPorNfc.value = true; recadoNfc.value = '' }
function usarOAplicativo() { gravaPorMesa.value = false; gravaPorNfc.value = false }

const travarDepois = ref(false)            // ⚠️ PERMANENTE — nasce desligado

// ── O GUIA ────────────────────────────────────────────────────────────────
// Ele abre uma vez só, e depois mora atrás do "?" do alto da bancada. O "já vi"
// mora no aparelho e não no banco: é conveniência de quem está usando, não dado
// da empresa. Quem trocar de celular vê de novo, e tudo bem.
const guiaAberto = ref(false)
const telaDoGuia = ref(0)

function abrirGuia() { telaDoGuia.value = 0; guiaAberto.value = true }
function fecharGuia() { guiaAberto.value = false; marcarGuiaVisto() }
function avancarGuia() {
  const proxima = proximaTelaDoGuia(telaDoGuia.value)
  if (proxima === null) fecharGuia()
  else telaDoGuia.value = proxima
}
// VOLTAR UMA TELA. Com o guia de bancada são mais de dez telas, e sem isto quem
// passasse direto pela que interessava tinha de recomeçar o guia inteiro.
function voltarGuia() {
  const anterior = telaAnteriorDoGuia(telaDoGuia.value)
  if (anterior !== null) telaDoGuia.value = anterior
}
const gravando = ref(false)
const recadoNfc = ref('')

// ── RELIGAR O LEITOR (07/09/2026) ──────────────────────────────────────────
// O serviço de Cartão Inteligente do Windows caiu na bancada em 06/09 e o
// conserto — abrir "Serviços", achar o nome certo, clicar em Iniciar — é longe
// demais de quem está com uma bolsa na mão.
const religando = ref(false)
const recadoDoReligar = ref('')
// Três condições, e as três importam: a frase tem de ser a do serviço, o
// programa instalado tem de saber religar (versão antiga não sabe, e botão que
// não faz nada é pior que botão nenhum), e não pode estar religando agora.
const mostrarReligar = computed(
  () => pedeParaReligar(estadoDaBancadaAgora.value?.detalhe || recadoNfc.value) && sabeReligar(),
)

async function religarOServicoDoLeitor() {
  religando.value = true
  recadoDoReligar.value = ''
  try {
    const r = await religarOLeitor()
    recadoDoReligar.value = r.frase
    // Deu certo: limpa o recado antigo para o botão sumir sozinho — deixá-lo na
    // tela faria a pessoa apertar de novo achando que não funcionou.
    if (r.ok) recadoNfc.value = ''
  } finally {
    religando.value = false
  }
}

// ── A BANCADA ─────────────────────────────────────────────────────────────
// A aba Gravar É o painel de máquina: a peça da vez em letra garrafal, o estado
// com cor de estado e movimento, o progresso, e UM botão. Por quê, e o que saiu
// da frente: está escrito por extenso no template, junto do bloco.
//
// NÃO HÁ MAIS `modoBancada`. Ele era um interruptor que ligava este desenho por
// cima do outro — e o dono reclamou quatro vezes da aba assim. Se a aba precisa
// de um modo para ficar usável, a aba deveria SER aquilo: escolheu o lote,
// trabalha. Com isso saíram junto o "Entrar no modo bancada", o parágrafo que o
// explicava, o "Sair do modo bancada" e a lembrança do modo no aparelho.

// A FASE É DA TELA, e não da etiqueta. A sequência do leitor de mesa tem NOVE
// estados de etiqueta; aqui são as cinco coisas que a pessoa de pé precisa
// distinguir a um metro: parado → esperando → gravando → ok/erro.
//
// ⚠️ ELA NÃO SAI DE `sinalDaGravacao`, e a diferença é o que a tela promete. O
// sinal some sozinho em 2,6 segundos porque é desenho de canto de olho; a fase é
// a FRASE GRANDE do painel, e frase de erro que some em dois segundos é a tela
// escondendo justamente o que a pessoa precisa ler com a bolsa na mão.
const faseDaBancada = ref('parado')

// Qual dos três jeitos está em uso. Sai dos MESMOS interruptores do resto da
// aba — reescrever a regra aqui seria a segunda cópia que diverge.
const modoDaBancada = computed(() => {
  if (gravaPorMesa.value) return 'mesa'
  return gravaPorNfc.value ? 'celular' : 'copiar'
})

// SEM PEÇA POR GRAVAR A FASE É 'fim', E O MODO NÃO SE DESLIGA. Pelo mesmo motivo
// que o farol do lote mora fora do bloco de gravação: ao gravar a última peça,
// `proxima` vira nulo, e um modo que sumisse nesse instante levaria junto o ✓ da
// etiqueta que a pessoa acabou de encostar.
const faseAtualDaBancada = computed(() => (proxima.value ? faseDaBancada.value : 'fim'))

const estadoDaBancadaAgora = computed(() => estadoDaBancada({
  fase: faseAtualDaBancada.value, modo: modoDaBancada.value, recado: recadoNfc.value,
}))
const acaoDaBancadaAgora = computed(() => acaoDaBancada({
  fase: faseAtualDaBancada.value, modo: modoDaBancada.value,
}))

// QUAIS LOTES O SELETOR OFERECE. É a única coisa que a busca desta aba fazia e a
// da aba Lotes não faz: trazer lote ENCERRADO de volta, que é o único caminho
// para desfazer uma baixa num lote fechado. Vira um interruptor escrito dentro
// de "Mais opções deste lote", em vez de um painel de filtros de 260px de altura
// numa aba onde se escolhe UM lote.
// O filtro sai INTEIRO, e não campo a campo: um objeto novo é o que o Vue
// enxerga como mudança.
function mostrarEncerrados(ligado) {
  filtroDeGravar.value = {
    ...filtroDeGravar.value, estado: ligado ? 'todos' : 'por_gravar',
  }
}

// A ÚNICA AÇÃO PRINCIPAL, E QUEM DECIDE QUAL É ELA É A CONTA PURA. O template
// não carrega regra dentro: ele desenha o rótulo que veio e chama isto.
function tocarNaBancada() {
  const { chave } = acaoDaBancadaAgora.value
  // 'sair' já foi "sair do modo bancada". Sem modo nenhum, o lote acabado manda
  // para onde se escolhe outro: a aba 1 Lotes, que é a aba de ver, criar,
  // buscar e abrir lote. O seletor do alto continua ali para quem quiser trocar
  // sem sair daqui.
  if (chave === 'sair') { aba.value = 'lotes'; return }
  // `marcarGravada()` sem argumento é o caminho do modo do aplicativo, o mesmo
  // do "✓ Gravei essa": ali não há gravação em voo para trocar a peça por baixo.
  if (chave === 'marcar') { marcarGravada(); return }
  gravarAgora()
}

// ── O SINAL DA GRAVAÇÃO ───────────────────────────────────────────────────
// ⚠️ ELE NÃO É MAIS DESENHADO EM LUGAR NENHUM, e isso é de propósito. Ele tinha
// um bloco próprio (anel + ✓ + ✗ + uma frase) que dizia, em outras palavras,
// exatamente o que o estado do painel já diz: "Esperando a etiqueta encostar…"
// ao lado de "Encoste a etiqueta". Cada informação aparece UMA vez, então o
// desenho mudou de casa: quem conta o estado pelo canto do olho agora são os
// ANÉIS, dentro do próprio bloco de estado, e quem conta por escrito continua
// sendo o `titulo`/`detalhe` da conta pura.
//
// O QUE ELE CONTINUA FAZENDO, e por que ele fica: `avisarNaTela` é o ÚNICO ponto
// da tela que sabe se a gravação terminou bem ou mal, e é dele que nasce a fase
// do painel. Sem esta variável a tradução de "o banco confirmou" para "a fase é
// ok" se espalharia por cada caminho de gravação, e a cópia que ficasse para trás
// deixaria o painel dizendo "Gravando…" com a etiqueta já fora do leitor.
//
// '' · 'ok' · 'falha' — o 'esperando' não mora aqui, é o próprio `gravando`,
// senão os dois sairiam de sincronia no dia em que um deles esquecesse de zerar.
const sinalDaGravacao = ref('')
let relogioDoSinal = null

function avisarNaTela(sinal) {
  sinalDaGravacao.value = sinal
  // ⚠️ A FASE DA BANCADA NASCE AQUI, e neste lugar só. Este é o único ponto da
  // tela que sabe se a gravação terminou bem ou mal — os nove estados da
  // sequência já foram traduzidos para ✓ ou ✗ antes de chegar. Escrever a fase
  // em cada caminho de gravação seria a segunda cópia da mesma decisão, e a que
  // ficasse para trás deixaria o painel dizendo "Gravando…" com a etiqueta já
  // fora do leitor.
  //
  // O SINAL SOME EM 2,6s, A FASE NÃO. É de propósito: o desenho é canto de olho,
  // a frase é o que se lê com a bolsa na mão.
  if (sinal === 'ok' || sinal === 'falha') faseDaBancada.value = sinal === 'ok' ? 'ok' : 'erro'
  clearTimeout(relogioDoSinal)
  // O SINAL SOME SOZINHO. ✓ que fica na tela vira paisagem e, pior, passa a ser
  // lido como se fosse da PRÓXIMA etiqueta — e aí ele mente. O recado grande
  // continua na tela: quem some é o desenho, não a informação.
  relogioDoSinal = setTimeout(() => { sinalDaGravacao.value = '' }, 2600)
}

// A BARRA DO LOTE, no lugar do "3 de 20" solto — e COM ele: o texto continua
// ao lado, porque barra sozinha não diz quantas faltam nem dá para ler em voz
// alta para quem está do outro lado da bancada.
// ELES SÃO A ÚNICA APARIÇÃO DO PROGRESSO NESTA ABA. Ele aparecia TRÊS vezes: no
// rótulo de cada opção do seletor de lote, aqui na barra, e num
// "PEÇA 8 DE 20 · 6 DE 19 PRONTAS" logo acima do endereço.
const progressoDoLoteAtual = computed(() => progressoDoLote(pecasDoLote(loteEscolhido.value)))
const larguraDoProgresso = computed(() => {
  const { gravadas, total } = progressoDoLoteAtual.value
  return `${total ? Math.round((gravadas / total) * 100) : 0}%`
})
const textoDoGravador = ref('')
const confirmacaoDoGravador = ref(null)  // { reconhecidos, ignorados } enquanto a pergunta está na tela

const novo = reactive({ modelo: '', cor: '', sku: '', quantidade: 20, fabricado_em: '', os: '' })

// EDITAR E EXCLUIR ABREM DENTRO DO MESMO CARTÃO, e só um de cada vez: dois
// blocos empilhados no mesmo lote fazem a tela perguntar duas coisas ao mesmo
// tempo, e aí nenhuma das duas é a pergunta principal.
const editando = ref(null)    // o lote com o formulário de editar aberto, ou null
const excluindo = ref(null)   // o lote com a pergunta de excluir na tela, ou null
const edicao = reactive({ modelo: '', cor: '', sku: '', fabricado_em: '', quantidade: 1, os: '' })

// ── AS DUAS PERGUNTAS DE EXCLUIR, E A SENHA ───────────────────────────────
// 1 = "vai excluir o lote?"  ·  2 = o que se PERDE, com o número de peças, e a
// senha. A segunda NÃO repete a primeira de propósito: duas vezes a mesma frase
// vira um "sim, sim" automático e o segundo clique não decide nada.
const etapaDeExcluir = ref(1)
// ⚠️ A SENHA NUNCA SOBREVIVE À AÇÃO. Ela é apagada no `finally` de
// `excluirLote`, ao cancelar e ao trocar de lote — e NUNCA vai para
// `localStorage`, nem para o banco, nem para lugar nenhum além do corpo da
// chamada à edge que a confere.
const senhaDaExclusao = ref('')
const erroDaSenha = ref('')
const exclusaoDeLoteEmVoo = ref(false)

// A PERGUNTA DE DAR BAIXA, na aba Gravar. Ela é da peça da vez, então basta um
// sim/não: só existe uma peça da vez. O motivo nasce em "Extraviada" porque é o
// que o dono mais vai usar, e a lista inteira fica à vista para trocar.
const baixando = ref(false)
const motivoDaBaixa = ref('extraviada')
// A TRAVA DE "EM VOO". Dois toques rápidos disparam duas chamadas. O índice
// único do banco segura a segunda, então o dado nunca corrompe — mas a pessoa
// lê "Esta peça já está baixada" logo depois de baixá-la, e a tela parece estar
// contradizendo o que ela acabou de fazer.
const baixaEmVoo = ref(false)

// EXCLUIR A PEÇA DA VEZ. Mesma forma da pergunta de baixa, e as duas nunca
// aparecem juntas: duas perguntas na tela ao mesmo tempo é o mesmo que nenhuma
// ser a principal. A trava de "em voo" existe pelo mesmo motivo da baixa —
// dois toques rápidos disparam duas chamadas, e a segunda volta com
// "não encontrei esse registro" logo depois de a peça ter saído.
const excluindoPeca = ref(false)
const exclusaoEmVoo = ref(false)

const podeCriar = computed(() => hasPermission('autenticidade', 'criar'))
const podeEditar = computed(() => hasPermission('autenticidade', 'editar'))

const pecasDoLote = (id) => pecas.value.filter((p) => p.lote_id === id)
const loteAtual = computed(() => lotes.value.find((l) => l.id === loteEscolhido.value) || null)

// ── O AVISO DE QUE O NÚMERO DE SÉRIE FICARIA AMBÍGUO ──────────────────────
// O número de série é COLADO — os dígitos da referência seguidos da sequência da
// peça, sem separador. Isso só aponta para uma bolsa só enquanto TODA referência
// tiver a mesma quantidade de dígitos (hoje quatro). Com uma de cinco, "001512"
// passa a poder ser duas bolsas diferentes.
//
// AS DUAS PORTAS DO LOTE TÊM O AVISO, e as duas leem o que está DIGITADO: só a
// criação não basta, porque a referência também se corrige na edição, e só a
// edição não basta, porque é na criação que ela entra. A frase é uma só, e mora
// em `lotes.js`, junto da regra — frase escrita em dois lugares diverge no dia
// em que uma delas muda.
// ── ENCERRAR A GARANTIA DE UMA PEÇA QUE VOLTOU ────────────────────────────
// Pedido do dono em 05/09/2026. BAIXAR É MOVER, e não marcar: a linha sai de
// `vessel_registros` e vai para o histórico. Por isso a página do selo volta a
// mostrar a bolsa sem dona SOZINHA, e a peça pode ser registrada de novo — sem
// que nenhuma das 12 funções que leem registros precise aprender nada.
const baixandoGarantia = ref(null)
// A ESCOLHA da lista e o TEXTO livre são dois campos, e não um só: guardar os
// dois juntos impediria saber se "" quer dizer "não escolheu" ou "escolheu e
// não escreveu observação" — e é essa diferença que libera o botão.
const motivoEscolhidoDaDevolucao = ref('')
const motivoDaBaixaDeGarantia = ref('')
const senhaDaBaixa = ref('')
const erroDaBaixa = ref('')
const baixaDeGarantiaEmVoo = ref(false)

// O TEXTO FINAL que vai para o histórico, montado num lugar só: a trava do
// botão e o que é gravado leem daqui, então não há como o botão liberar uma
// coisa e o banco receber outra.
const motivoDaDevolucaoPronto = computed(
  () => motivoDaDevolucaoEscrito(motivoEscolhidoDaDevolucao.value, motivoDaBaixaDeGarantia.value),
)

function abrirBaixaDeGarantia(r) {
  baixandoGarantia.value = r.codigo
  // ⚠️ NASCE LIMPO. Motivo e senha da vez anterior sobrando aqui seriam a baixa
  // seguinte acontecendo com a justificativa da anterior — e ninguém veria.
  motivoEscolhidoDaDevolucao.value = ''
  motivoDaBaixaDeGarantia.value = ''
  senhaDaBaixa.value = ''
  erroDaBaixa.value = ''
  trocando.value = null   // as duas perguntas nunca ficam abertas juntas
}

function fecharBaixaDeGarantia() {
  baixandoGarantia.value = null
  motivoEscolhidoDaDevolucao.value = ''
  motivoDaBaixaDeGarantia.value = ''
  senhaDaBaixa.value = ''
  erroDaBaixa.value = ''
}

async function confirmarBaixaDeGarantia(r) {
  const motivo = motivoDaDevolucaoPronto.value
  // A TELA COBRA O MOTIVO ANTES DO BANCO. Sem isto a pessoa digita a senha,
  // espera a rede, e descobre que faltava um campo que estava na tela o tempo todo.
  if (!motivo) { erroDaBaixa.value = fraseDaRecusa('motivo_obrigatorio'); return }

  baixaDeGarantiaEmVoo.value = true
  erroDaBaixa.value = ''
  try {
    const conferida = await conferirASenha(senhaDaBaixa.value)
    if (!conferida.ok) { erroDaBaixa.value = fraseDaSenha(conferida.erro); return }

    const { data, error } = await sbClient.rpc('vessel_baixar_garantia', {
      p_codigo: r.codigo, p_motivo: motivo,
    })
    if (error) {
      // ⚠️ A frase amigável sozinha ESCONDEU um defeito real por horas: a trilha
      // recusava a ação nova e a tela só dizia "não consegui". O recado do banco
      // vem junto agora — feio, mas é ele que diz o que consertar.
      erroDaBaixa.value = 'Não consegui encerrar agora. Nada foi alterado. '
        + `O banco recusou assim: ${error.message || 'sem detalhe'}`
      return
    }
    if (!data?.ok) { erroDaBaixa.value = fraseDaRecusa(data?.motivo, data); return }

    fecharBaixaDeGarantia()
    adminToast('Garantia encerrada. A página do selo já não mostra dona.', true)
    await carregar()
  } finally {
    baixaDeGarantiaEmVoo.value = false
  }
}

const listaDeProdutosAberta = ref(false)
const produtosLidos = ref(0)
// A foto grande do produto, quando se clica na lupa. `null` = ninguem pediu.
const fotoGrande = ref(null)
// O que o botão do formulário mostra: o produto que foi escolhido, achado pela
// referência que ele gravou. Sai do que JÁ está na tela — nada de guardar uma
// segunda cópia do produto, que é como duas verdades comecam a divergir.
const produtoEscolhido = computed(
  () => (produtos.value || []).find((p) => p && p.codigo === novo.sku) || null)

// ⚠️ A FOTO GRANDE PEDE UMA CHAMADA A MAIS, e por isso so acontece no clique da
// lupa. A lista do Bling so traz MINIATURA de 70px; a imagem cheia mora no
// detalhe do produto (`produtos/{id}`), e buscar o detalhe de trezentos itens
// para mostrar uma lista seria trezentas chamadas para nada.
//
// ⚠️ E AS URLS DO BLING EXPIRAM EM 7 DIAS. Aqui isso nao machuca: a foto e
// buscada na hora e some quando a janela fecha — nada e guardado apontando para
// la. Guardar seria quebrar em uma semana.
async function verFotoGrande(produto) {
  fotoGrande.value = { nome: produto.nome, codigo: produto.codigo, url: produto.foto, carregando: true }
  try {
    const det = await chamarBling(sbClient, `produtos/${produto.id}`, {})
    const cheia = det?.data?.midia?.imagens?.internas?.[0]?.link
    if (cheia) fotoGrande.value = { ...fotoGrande.value, url: cheia, carregando: false }
    else fotoGrande.value = { ...fotoGrande.value, carregando: false, so_miniatura: true }
  } catch {
    // Falhar em ampliar NAO pode tirar a miniatura da tela: fica o que ja havia.
    fotoGrande.value = { ...fotoGrande.value, carregando: false, so_miniatura: true }
  }
}

const proxima = computed(() => proximaPorGravar(pecasDoLote(loteEscolhido.value)))
const resumo = computed(() => resumoDeAlertas(alertas.value))

// ── A BUSCA E O ARQUIVAMENTO AUTOMÁTICO ───────────────────────────────────
//
// A tela acumulava tudo para sempre. As contas moram em
// `busca-e-arquivamento.js`, testadas sem navegador; aqui fica só o estado do
// que a pessoa pediu, e cada aba tem o SEU: o recorte da aba Etiquetas
// (últimos 30 dias) não é o mesmo da aba Lotes (em andamento), e um filtro só
// para as três faria uma aba mudar a outra pelas costas.
//
// NADA DISSO TOCA O BANCO. "Encerrado" é contado na hora — lote em que toda
// peça já foi gravada ou baixada. Desfazer uma baixa devolve o lote para "em
// andamento" sozinho, sem ninguém precisar destravar nada.
const FILTRO_LIMPO = { texto: '', de: '', ate: '', atalho: 'tudo', estado: '' }

const filtroDeLotes = ref({ ...FILTRO_LIMPO, estado: 'andamento' })
const filtroDeGravar = ref({ ...FILTRO_LIMPO, estado: 'por_gravar' })
// A ABA ETIQUETAS ABRE NOS ÚLTIMOS 30 DIAS. Quem vem aqui acabou de gravar
// errado, e a peça dele é de hoje — a história inteira continua a um toque, no
// atalho "Qualquer data" ou no "Limpar a busca".
const filtroDeEtiquetas = ref({
  ...FILTRO_LIMPO, estado: 'todas', atalho: '30d', ...intervaloDoAtalho('30d', new Date()),
})

// O "estado" da aba Gravar continua existindo em `filtroDeGravar`, mas deixou de
// ser um seletor com dois rótulos: virou um interruptor escrito dentro de "Mais
// opções deste lote" (`mostrarEncerrados`). O painel de busca inteiro numa aba
// onde se escolhe UM lote era 260px de altura que quem grava nunca usa.

const marcaDoLote = (id) => seloDoLote(estadoDoLote(pecasDoLote(id)))
const loteEstaEncerrado = (id) => estadoDoLote(pecasDoLote(id)).encerrado

const lotesVisiveis = computed(() => filtrarLotes(lotes.value, {
  pecasDoLote,
  texto: filtroDeLotes.value.texto,
  de: filtroDeLotes.value.de,
  ate: filtroDeLotes.value.ate,
  estado: filtroDeLotes.value.estado,
}))
const lotesEncerrados = computed(
  () => lotes.value.length - lotesComPecaPorGravar(lotes.value, pecasDoLote))
const contagemDeLotes = computed(() => fraseDaContagem(
  lotesVisiveis.value.length, lotes.value.length, { um: 'lote', muitos: 'lotes' }))

// Os dois botões são o mesmo controle do painel, por outra porta: quem procura
// um lote encerrado procura um botão escrito, não um seletor de estado.
function verEncerrados() { filtroDeLotes.value = { ...filtroDeLotes.value, estado: 'encerrado' } }
function verEmAndamento() { filtroDeLotes.value = { ...filtroDeLotes.value, estado: 'andamento' } }

const lotesDoSeletor = computed(() => lotesParaGravar(lotes.value, {
  pecasDoLote,
  texto: filtroDeGravar.value.texto,
  de: filtroDeGravar.value.de,
  ate: filtroDeGravar.value.ate,
  // o lote escolhido nunca sai da lista: ao gravar a última peça ele encerra na
  // hora, e o seletor ficaria em branco com o ✓ ainda na tela
  escolhido: loteEscolhido.value,
  incluirEncerrados: filtroDeGravar.value.estado === 'todos',
}))
// A CONTAGEM "N de M lotes" SAIU DESTA ABA junto com o painel de busca: ela
// existe para lista RECORTADA por busca — e aqui não há mais busca. Quem procura
// entre muitos lotes faz isso na aba 1 Lotes, onde a contagem continua inteira.

// ── A FILA AO REDOR DA PEÇA DA VEZ ────────────────────────────────────────
// Quem grava 50 seguidas se perde: a tela mostrava SÓ a peça da vez, e o único
// jeito de saber onde parou era contar etiqueta na mão. Aqui aparecem a que
// acabou de sair e as próximas, com a da vez marcada.
//
// SÃO POUCAS LINHAS DE PROPÓSITO. A lista inteira do lote é da aba Lotes, e vai
// a 500: aqui, no meio da gravação, uma lista longa empurraria o botão de gravar
// para fora da tela do celular — e o botão é o que a pessoa está procurando.
const QUANTAS_ADIANTE = 4
const filaAoRedor = computed(() => {
  const atual = proxima.value
  if (!atual) return []
  // A BAIXADA SAI, pela mesma regra da fila de gravação (`naFila`, em lotes.js):
  // ela não vai virar bolsa, e mostrá-la aqui como "a próxima" mandaria alguém
  // gravar a etiqueta de uma peça dada como refugo.
  const lista = pecasEmOrdem(pecasDoLote(loteEscolhido.value)).filter(naFila)
  const i = lista.findIndex((p) => p.codigo === atual.codigo)
  if (i === -1) return []
  // uma para trás — a que acabou de sair — e as próximas
  return lista.slice(Math.max(0, i - 1), i + 1 + QUANTAS_ADIANTE)
})

// As baixadas saem da fila de gravação, então precisam de um lugar PRÓPRIO para
// aparecer: sem esta lista, dar baixa por engano não teria como ser desfeito.
const baixadasDoLote = computed(() => pecasDoLote(loteEscolhido.value)
  .filter((p) => p.baixada)
  .sort((a, b) => (a.numero_na_serie || 0) - (b.numero_na_serie || 0)))

// ── VER AS PEÇAS DE UM LOTE ───────────────────────────────────────────────
// O buraco que o dono apontou: "não consigo ver os links que já foram gravados
// em lotes". A tela inteira mostrava UM código — o da próxima peça da fila —, e
// depois de gravar e costurar ninguém respondia "qual link ficou na bolsa nº 7".
//
// UM LOTE ABERTO POR VEZ, pelo mesmo motivo de editar e excluir: duas listas
// longas abertas ao mesmo tempo empurram o resto da tela para fora da vista.
const loteAberto = ref(null)

// UM LOTE PODE TER 500 PEÇAS, e desenhar 500 linhas de uma vez trava a tela no
// celular. Ela abre com um punhado e cresce a pedido — a lista nunca mente
// sobre o tamanho, porque o botão diz quantas ainda faltam.
const DE_CADA_VEZ = 50
const quantasMostrar = ref(DE_CADA_VEZ)
// qual endereço acabou de ser copiado, para o botão dizer "Copiado!" só nele
const enderecoCopiado = ref('')

const pecasDoLoteAberto = computed(() => pecasEmOrdem(pecasDoLote(loteAberto.value)))
const pecasVisiveis = computed(() => pecasDoLoteAberto.value.slice(0, quantasMostrar.value))
const pecasQueFaltamMostrar = computed(
  () => Math.max(0, pecasDoLoteAberto.value.length - pecasVisiveis.value.length))

// O CARTÃO ABERTO SOBE PARA A PRIMEIRA LINHA DA GRADE (o `order:-1` do CSS da
// tela grande, que é o conserto do buraco que ficava na fileira dele). Sem esta
// rolagem, abrir um lote da terceira fileira o mandaria para cima da vista e a
// pessoa acharia que o cartão sumiu.
//
// `block:'nearest'` de propósito: ele só rola o quanto for preciso para o
// cartão caber na tela, e NÃO faz nada quando ele já está visível — que é
// exatamente o caso do celular, onde não há grade e nada se move de lugar.
async function trazerOLoteParaAVista(id) {
  await nextTick()
  document.querySelector(`.au-grade-de-lotes > [data-lote="${id}"]`)
    ?.scrollIntoView({ block: 'nearest' })
}

function alternarPecas(id) {
  const abrindo = loteAberto.value !== id
  loteAberto.value = abrindo ? id : null
  // recomeça do topo: deixar o limite crescido de um lote de 500 faria o lote
  // seguinte desenhar 500 linhas de uma vez, que é o que este limite evita
  quantasMostrar.value = DE_CADA_VEZ
  enderecoCopiado.value = ''
  if (abrindo) trazerOLoteParaAVista(id)
}

function mostrarMaisPecas() { quantasMostrar.value += DE_CADA_VEZ }

// ── A ABA ETIQUETAS: consertar o que foi gravado errado ───────────────────
//
// Ela NÃO lê nada de novo do banco. As peças, os lotes e os registros de
// garantia já vêm de `carregar()` — o que muda aqui é o recorte:
// `etiquetasGravadas` fica só com as que TÊM gravação, que são as únicas que
// `vessel_desmarcar_gravada` aceita.
// ══════════════════════════════════════════════════════════════════════════
// LER QUALQUER ETIQUETA — a porta de entrada pela ETIQUETA, e não pela lista
// ══════════════════════════════════════════════════════════════════════════
// A aba Gravar já sabia ler, mas sempre conferindo contra uma peça escolhida
// ANTES. Aqui é o contrário: encosta-se a etiqueta sem escolher nada, e é ela
// quem diz quem é. As regras moram em `ler-etiqueta.js`, com teste; aqui só se
// liga o leitor de verdade nelas.
const leituraLivre = ref(null)      // o que a última leitura disse que a etiqueta é
const lendoEtiqueta = ref(false)
const recadoDaLeitura = ref('')
const erroDaLeitura = ref('')
const ocupadoNaLeitura = ref(false)
const confirmandoReset = ref(false)
const senhaDaLeitura = ref('')
const motivoDaLeitura = ref('')

// A peça sai do que a tela JÁ carregou — nada de ida nova ao banco para uma
// pergunta que a memória já responde.
function acharPecaPeloCodigo(codigo) {
  return (pecas.value || []).find((p) => p.codigo === codigo) || null
}

// O MESMO COMPONENTE DE ANÉIS DA BANCADA, com os mesmos estados. Não é enfeite
// repetido: quem grava na aba Gravar e quem lê aqui é a mesma pessoa, com a
// mesma etiqueta na mão — dois vocabulários visuais para o mesmo gesto seria
// ela ter de aprender a ferramenta duas vezes.
//
// ⚠️ O ANEL NUNCA É O ÚNICO AVISO. Vai sempre com título e detalhe escritos, do
// mesmo jeito que na bancada: quem desligou animação, quem não distingue cor e
// quem usa leitor de tela leem a mesma coisa (PADRÃO item 9).
const estadoDaLeituraAneis = computed(() => {
  if (ocupadoNaLeitura.value) {
    return { chave: 'gravando', titulo: 'Escrevendo na etiqueta…', detalhe: 'Segure parada até acabar.' }
  }
  if (lendoEtiqueta.value) {
    return {
      chave: 'esperando',
      titulo: gravaPorMesa.value ? 'Ponha a etiqueta no leitor' : 'Encoste a etiqueta',
      detalhe: 'Segure parada — vou dizer de quem ela é.',
    }
  }
  if (erroDaLeitura.value) return { chave: 'erro', titulo: 'Não deu', detalhe: erroDaLeitura.value }
  if (leituraLivre.value || recadoDaLeitura.value) {
    return { chave: 'ok', titulo: 'Etiqueta lida', detalhe: recadoDaLeitura.value || 'Veja abaixo o que ela é.' }
  }
  return { chave: 'parado', titulo: 'Pronto para ler', detalhe: 'Aperte e encoste qualquer etiqueta.' }
})

const acoesDaLeituraAgora = computed(
  () => acoesDaLeitura(leituraLivre.value, { podeMexer: podeEditar.value }),
)
const leituraPedeGarantia = computed(() => precisaConfirmarGarantia(leituraLivre.value))

const leituraAberta = ref(false)

// ABRE E JÁ COMEÇA A LER. Na bancada a pessoa chega com a etiqueta na mão: um
// segundo clique dentro do modal para "agora sim, leia" seria um passo que só
// existe porque o programa quis.
function abrirLeituraDeEtiqueta() {
  leituraAberta.value = true
  lerEtiquetaLivre()
}

// FECHAR LIMPA TUDO, inclusive a senha. Senha que sobrevive ao fecha-e-abre é
// senha esperando ser usada por engano na próxima etiqueta — a mesma regra que
// a aba já segue no apagar da lista.
function fecharLeituraDeEtiqueta() {
  if (ocupadoNaLeitura.value) return   // no meio de uma escrita não se fecha
  leituraAberta.value = false
  limparLeitura()
}

function limparLeitura() {
  leituraLivre.value = null
  recadoDaLeitura.value = ''
  erroDaLeitura.value = ''
  confirmandoReset.value = false
  senhaDaLeitura.value = ''
  motivoDaLeitura.value = ''
}

// LÊ UMA VEZ, pelos dois caminhos que a tela já conhece. Devolve o texto lido e,
// no leitor de mesa, TAMBÉM a memória — para o apagamento montar o plano em
// cima do Lock Control que a etiqueta tem, sem uma segunda ida ao chip.
async function lerOChipUmaVez() {
  if (gravaPorMesa.value) {
    const porta = criarGravadorDeMesa()
    if (!porta) throw new Error('O programa do gravador de mesa saiu do ar.')
    try {
      await porta.conectar()
      const lida = await porta.lerAEtiqueta()
      return { texto: lida.endereco, memoria: lida.memoria }
    } finally {
      await porta.desconectar()
    }
  }
  const gravador = criarGravador()
  if (!gravador) throw new Error('Este aparelho não lê etiqueta. Use o celular ou o leitor de mesa.')
  return { texto: await gravador.lerUmaVez(), memoria: null }
}

async function lerEtiquetaLivre() {
  limparLeitura()
  lendoEtiqueta.value = true
  recadoDaLeitura.value = gravaPorMesa.value
    ? 'Ponha a etiqueta no leitor e segure parada…'
    : 'Encoste a etiqueta no celular e segure parado…'
  try {
    const { texto, memoria } = await lerOChipUmaVez()
    const achado = classificarLeitura(texto, acharPecaPeloCodigo)
    // a memória viaja junto: é ela que o apagamento usa, sem reler o chip à toa
    leituraLivre.value = { ...achado, memoria }
    recadoDaLeitura.value = ''
  } catch (erro) {
    erroDaLeitura.value = gravaPorMesa.value
      ? traduzirFalhaDoLeitorDeMesa(erro)
      : traduzirFalha(erro)
    recadoDaLeitura.value = ''
  } finally {
    lendoEtiqueta.value = false
  }
}

// ⚠️ APAGA O CHIP E SÓ DEPOIS SOLTA NO BANCO — a ordem está presa por teste em
// `ler-etiqueta.js`, e o porquê está escrito lá: soltar no banco primeiro
// deixaria ETIQUETA ÓRFÃ se o apagamento falhasse.
async function confirmarResetDaLeitura() {
  const alvo = leituraLivre.value
  if (!alvo || alvo.tipo !== 'conhecida') return
  erroDaLeitura.value = ''

  // O MOTIVO É COBRADO AQUI, ANTES DO BANCO — igual ao resto da tela.
  const motivo = motivoDaLeitura.value.trim()
  if (leituraPedeGarantia.value && !motivo) {
    erroDaLeitura.value = fraseDaRecusa('motivo_obrigatorio')
    return
  }

  ocupadoNaLeitura.value = true
  try {
    // A SENHA É CONFERIDA NO SERVIDOR ANTES DE QUALQUER COISA. Esta ação é MAIS
    // destrutiva que apagar da lista — ela também apaga o chip — então não pode
    // ser mais fácil que aquela.
    const conferida = await conferirASenha(senhaDaLeitura.value)
    if (!conferida.ok) { erroDaLeitura.value = fraseDaSenha(conferida.erro); return }

    const saida = await resetar({
      leitura: alvo,
      apagarOChip: async () => {
        if (gravaPorMesa.value) {
          const porta = criarGravadorDeMesa()
          if (!porta) throw new Error('O programa do gravador de mesa saiu do ar.')
          try {
            await porta.conectar()
            // ⚠️ LÊ DE NOVO E CONFERE ANTES DE APAGAR. Entre o clique e agora a
            // pessoa pôs a etiqueta de volta — e pode ser OUTRA. Apagar a errada
            // não tem desfazer.
            const agora = await porta.lerAEtiqueta()
            if (classificarLeitura(agora.endereco, acharPecaPeloCodigo).codigo !== alvo.codigo) {
              throw new Error('A etiqueta que está no leitor agora não é a mesma que foi lida. Nada foi apagado.')
            }
            const r = await apagarEConferir({ porta, memoria: agora.memoria })
            if (!r.ok) throw new Error(r.frase)
          } finally {
            await porta.desconectar()
          }
          return
        }
        const gravador = criarGravador()
        if (!gravador) throw new Error('Este aparelho não grava etiqueta.')
        const antes = await gravador.lerUmaVez()
        if (classificarLeitura(antes, acharPecaPeloCodigo).codigo !== alvo.codigo) {
          throw new Error('A etiqueta encostada agora não é a mesma que foi lida. Nada foi apagado.')
        }
        await gravador.apagar()
        const depois = await gravador.lerUmaVez()
        if (classificarLeitura(depois, acharPecaPeloCodigo).tipo !== 'vazia') {
          throw new Error('Apaguei, mas ao ler de volta a etiqueta ainda devolveu conteúdo. NÃO considere apagada.')
        }
      },
      desmarcarNoBanco: async (codigo) => {
        const { data, error } = await sbClient.rpc('vessel_desmarcar_gravada',
          { p_codigo: codigo, p_motivo: motivo || null })
        if (error) throw new Error('não consegui falar com o sistema')
        if (!data?.ok) throw new Error(fraseDaRecusa(data?.motivo, data))
      },
    })

    if (!saida.ok) { erroDaLeitura.value = saida.frase; avisarNaTela('falha'); return }
    recadoDaLeitura.value = saida.frase
    confirmandoReset.value = false
    senhaDaLeitura.value = ''
    motivoDaLeitura.value = ''
    leituraLivre.value = null
    avisarNaTela('ok')
    await carregar()
  } finally {
    ocupadoNaLeitura.value = false
  }
}

// ETIQUETA ÓRFÃ: endereço nosso, código que o sistema não conhece. Não há peça
// para soltar no banco — só o chip a apagar. A senha continua sendo cobrada:
// apagar é apagar, e não ter dono aqui dentro não torna a ação reversível.
async function apagarChipOrfao() {
  const alvo = leituraLivre.value
  if (!alvo || alvo.tipo !== 'desconhecida') return
  erroDaLeitura.value = ''
  ocupadoNaLeitura.value = true
  try {
    const conferida = await conferirASenha(senhaDaLeitura.value)
    if (!conferida.ok) { erroDaLeitura.value = fraseDaSenha(conferida.erro); return }

    if (gravaPorMesa.value) {
      const porta = criarGravadorDeMesa()
      if (!porta) { erroDaLeitura.value = 'O programa do gravador de mesa saiu do ar.'; return }
      try {
        await porta.conectar()
        const agora = await porta.lerAEtiqueta()
        const r = await apagarEConferir({ porta, memoria: agora.memoria })
        if (!r.ok) { erroDaLeitura.value = r.frase; avisarNaTela('falha'); return }
      } finally { await porta.desconectar() }
    } else {
      const gravador = criarGravador()
      if (!gravador) { erroDaLeitura.value = 'Este aparelho não grava etiqueta.'; return }
      await gravador.apagar()
      const depois = await gravador.lerUmaVez()
      if (classificarLeitura(depois, acharPecaPeloCodigo).tipo !== 'vazia') {
        erroDaLeitura.value = 'Apaguei, mas ao ler de volta a etiqueta ainda devolveu conteúdo.'
        avisarNaTela('falha'); return
      }
    }
    recadoDaLeitura.value = 'Etiqueta apagada. Ela pode ser reaproveitada.'
    confirmandoReset.value = false
    senhaDaLeitura.value = ''
    leituraLivre.value = null
    avisarNaTela('ok')
  } catch (erro) {
    erroDaLeitura.value = gravaPorMesa.value ? traduzirFalhaDoLeitorDeMesa(erro) : traduzirFalha(erro)
  } finally {
    ocupadoNaLeitura.value = false
  }
}

// REGRAVAR NÃO TOCA NO BANCO: a peça já é dona desta etiqueta. Serve para
// gravação que saiu pela metade.
async function regravarDaLeitura() {
  const alvo = leituraLivre.value
  if (!alvo || alvo.tipo !== 'conhecida') return
  erroDaLeitura.value = ''
  ocupadoNaLeitura.value = true
  recadoDaLeitura.value = gravaPorMesa.value
    ? 'Ponha a MESMA etiqueta no leitor e segure parada…'
    : 'Encoste a MESMA etiqueta e segure parado…'
  try {
    const saida = await regravar({
      leitura: alvo,
      gravarNoChip: async (codigo) => {
        if (gravaPorMesa.value) {
          const porta = criarGravadorDeMesa()
          if (!porta) throw new Error('O programa do gravador de mesa saiu do ar.')
          try {
            await porta.conectar()
            const r = await escreverEConferir({ porta, endereco: enderecoDaTag(codigo) })
            if (!r.ok) throw new Error(r.frase)
          } finally {
            await porta.desconectar()
          }
          return
        }
        const gravador = criarGravador()
        if (!gravador) throw new Error('Este aparelho não grava etiqueta.')
        await gravador.gravar(enderecoDaTag(codigo))
      },
      // No leitor de mesa o `escreverEConferir` JÁ leu de volta e conferiu; reler
      // aqui seria uma terceira ida ao chip, e cada ida é uma chance a mais de a
      // etiqueta sair do leitor no meio.
      lerDeVolta: async () => (gravaPorMesa.value
        ? enderecoDaTag(alvo.codigo)
        : criarGravador().lerUmaVez()),
    })
    recadoDaLeitura.value = saida.ok ? saida.frase : ''
    if (!saida.ok) erroDaLeitura.value = saida.frase
    avisarNaTela(saida.ok ? 'ok' : 'falha')
  } finally {
    ocupadoNaLeitura.value = false
  }
}

const loteDaEtiqueta = ref('')
const quantasEtiquetas = ref(DE_CADA_VEZ)

// ── O RECORTE DE "MARCAR VÁRIAS DE UMA VEZ" ────────────────────────────────
// Quando a gaveta chegou aqui vinda da aba Gravar, ela deixou de ter um lote
// obrigatório: o seletor desta aba abre em "Todos os lotes". Isso é ganho, e
// não folga — o log do gravador de mesa pode ter duas fornadas juntas, e antes
// a pessoa tinha de colar duas vezes.
//
// O QUE NÃO MUDOU: só entra código que EXISTE como peça. `codigosNoTextoDoGravador`
// confere contra esta lista, então lixo no texto continua não virando marcação.
const pecasDeMarcarEmBloco = computed(
  () => (loteDaEtiqueta.value ? pecasDoLote(loteDaEtiqueta.value) : pecas.value))
// A frase que a gaveta mostra, para a pessoa saber contra o que está conferindo
// ANTES de apertar — e não depois, no aviso.
const escopoDeMarcarEmBloco = computed(() => (loteDaEtiqueta.value
  ? `as ${pecasDeMarcarEmBloco.value.length} peça(s) deste lote`
  : `as ${pecasDeMarcarEmBloco.value.length} peça(s) de todos os lotes`))

// A pergunta aberta, ou null. Guarda a peça CONTADA no momento do clique
// (código, descrição e se tinha garantia): com a lista recarregando por baixo,
// ler a peça de novo lá no fim faria a pergunta falar de uma e apagar outra.
const apagando = ref(null)
const etapaDeApagar = ref(1)
const motivoDeApagar = ref('')
// ⚠️ Mesma regra da senha da exclusão: nunca sobrevive à ação, nunca vai para
// `localStorage`. É fricção, não cofre.
const senhaDeApagar = ref('')
const erroDeApagar = ref('')
const apagarEmVoo = ref(false)
// o que a tela continua dizendo depois que a garantia apareceu na resposta do
// banco. Fica até a pessoa dispensar: recado que some não é aviso de garantia.
const avisoDaGarantia = ref('')

// OS CÓDIGOS COM GARANTIA saem de `vessel_registros`, que a aba Registros já lê.
const comGarantia = computed(() => codigosComGarantia(registros.value))
const temGarantia = (codigo) => comGarantia.value.has(String(codigo ?? '').trim().toUpperCase())

const loteDaPeca = (id) => lotes.value.find((l) => l.id === id) || null
const etiquetasDaAba = computed(() => etiquetasGravadas(pecas.value, loteDaEtiqueta.value || null))
// DOIS RECORTES EM SEQUÊNCIA, e não um só: `etiquetasDaAba` é o que EXISTE (o
// que a aba pode consertar), e `etiquetasFiltradas` é o que a pessoa PEDIU.
// Guardar só o segundo faria a tela dizer "nenhuma etiqueta gravada" para uma
// busca que não achou nada — e "não há" e "não achei" são coisas diferentes.
const etiquetasFiltradas = computed(() => filtrarEtiquetas(etiquetasDaAba.value, {
  loteDaPeca,
  comGarantia: comGarantia.value,
  texto: filtroDeEtiquetas.value.texto,
  de: filtroDeEtiquetas.value.de,
  ate: filtroDeEtiquetas.value.ate,
  estado: filtroDeEtiquetas.value.estado,
}))
const etiquetasVisiveis = computed(() => etiquetasFiltradas.value.slice(0, quantasEtiquetas.value))
const etiquetasQueFaltamMostrar = computed(
  () => Math.max(0, etiquetasFiltradas.value.length - etiquetasVisiveis.value.length))
const contagemDeEtiquetas = computed(() => fraseDaContagem(
  etiquetasFiltradas.value.length, etiquetasDaAba.value.length,
  { um: 'etiqueta gravada', muitos: 'etiquetas gravadas' }))
function mostrarMaisEtiquetas() { quantasEtiquetas.value += DE_CADA_VEZ }

// ── A ÁRVORE: LOTE FORA, ETIQUETAS DENTRO ─────────────────────────────────
// Agrupa o que JÁ ESTÁ NA TELA (a fatia paginada), e não a lista inteira: o
// botão "mostrar mais" continua mandando em quantas aparecem, e a árvore não
// promete um lote cheio que ainda não foi carregado.
const gruposDeEtiquetas = computed(() => agruparPorLote(etiquetasVisiveis.value, {
  loteDaPeca,
  totalDoLote: (id) => (pecas.value || []).filter((p) => p && p.lote_id === id).length,
}))

// ⚠️ ÁRVORE FECHADA COM BUSCA ATIVA PARECE QUE NÃO ACHOU NADA. Quem digita um
// código vê uma linha de lote fechada e conclui que a busca quebrou, com a peça
// ali dentro. Por isso o estado de aberto é RECALCULADO a cada busca, e não
// guardado para sempre: a decisão de `abrirPorPadrao` tem teste.
const gruposAbertos = ref(new Set())
watch([gruposDeEtiquetas, () => filtroDeEtiquetas.value.texto], () => {
  gruposAbertos.value = new Set(abrirPorPadrao(gruposDeEtiquetas.value, {
    buscando: Boolean(String(filtroDeEtiquetas.value.texto || '').trim()),
  }))
}, { immediate: true })

// Abrir e fechar na mão continua valendo — o padrão é ponto de partida, não cela.
function alternarGrupo(chave, aberto) {
  const novo = new Set(gruposAbertos.value)
  if (aberto) novo.add(chave); else novo.delete(chave)
  gruposAbertos.value = novo
}

// MUDAR A BUSCA RECOMEÇA A LISTA DO TOPO, pelo mesmo motivo do watch de
// `loteDaEtiqueta`: com o limite crescido de uma busca larga, a busca seguinte
// desenharia 500 linhas de uma vez. O watch NÃO precisa ser profundo porque o
// painel troca o objeto inteiro a cada mudança — é isso que o Vue enxerga.
watch(filtroDeEtiquetas, () => { quantasEtiquetas.value = DE_CADA_VEZ })

// A TELA AVISA ANTES, EM VEZ DE DEIXAR O BANCO DAR A BRONCA. O banco recusa com
// `motivo_obrigatorio` quando falta motivo numa peça com garantia — mas aí a
// pessoa já apertou o botão, digitou a senha e esperou a rede para descobrir que
// faltava um campo que estava na tela o tempo todo.
const motivoEhObrigatorio = computed(
  () => motivoObrigatorio({ temGarantia: apagando.value?.temGarantia }))

// TROCAR DE LOTE RECOMEÇA A LISTA E FECHA A PERGUNTA, pelo mesmo cuidado do
// watch de `loteEscolhido`: a pergunta diz o código de UMA peça, e peça errada
// na pergunta é pior que pergunta nenhuma. E o limite crescido de um lote de 500
// faria o lote seguinte desenhar 500 linhas de uma vez.
watch(loteDaEtiqueta, () => {
  quantasEtiquetas.value = DE_CADA_VEZ
  fecharApagar()
})

function pedirApagarGravacao(pc) {
  apagando.value = {
    codigo: pc.codigo,
    temGarantia: temGarantia(pc.codigo),
    descricao: descricaoDaPeca(pc, loteDaPeca(pc.lote_id)),
  }
  etapaDeApagar.value = 1
  motivoDeApagar.value = ''
  senhaDeApagar.value = ''
  erroDeApagar.value = ''
}

function fecharApagar() {
  apagando.value = null
  etapaDeApagar.value = 1
  motivoDeApagar.value = ''
  // a senha sai da memória junto com a pergunta
  senhaDeApagar.value = ''
  erroDeApagar.value = ''
}

// APAGAR A GRAVAÇÃO DE UMA PEÇA. Quem recusa continua sendo o banco; a tela só
// se adianta nas duas recusas que ela consegue ver daqui (motivo faltando e
// senha), para não fazer a pessoa esperar a rede por um campo em branco.
async function apagarGravacao() {
  const alvo = apagando.value
  if (!alvo || apagarEmVoo.value) return
  erroDeApagar.value = ''

  const motivo = motivoDeApagar.value.trim()
  if (motivoObrigatorio({ temGarantia: alvo.temGarantia }) && !motivo) {
    erroDeApagar.value = fraseDaRecusa('motivo_obrigatorio')
    return
  }
  const senha = senhaDeApagar.value
  if (!senha) { erroDeApagar.value = fraseDaSenha('sem_senha'); return }

  apagarEmVoo.value = true
  try {
    const conferida = await conferirASenha(senha)
    if (!conferida.ok) { erroDeApagar.value = fraseDaSenha(conferida.erro); return }

    const { data, error } = await sbClient.rpc('vessel_desmarcar_gravada',
      // motivo em branco vai NULO, e não string vazia: é o que o banco entende
      // por "não escreveram motivo" (`nullif(trim(...), '')`)
      { p_codigo: alvo.codigo, p_motivo: motivo || null })
    if (error) { adminToast('Não consegui apagar a gravação agora', false); return }
    // a recusa do banco fica DENTRO da pergunta, e não num recado que some: é
    // ali que a pessoa está olhando, e é ali que ela conserta
    if (!data?.ok) { erroDeApagar.value = fraseDaRecusa(data?.motivo, data); return }

    // `tinha_garantia` vem do BANCO, e não do conjunto montado aqui: entre o
    // clique e a resposta, uma cliente pode ter registrado a garantia. Quem
    // sabe a verdade no instante da escrita é quem escreveu.
    const codigo = alvo.codigo
    const eraDeCliente = data.tinha_garantia
    fecharApagar()
    await carregar()
    if (eraDeCliente) {
      avisoDaGarantia.value = `A peça ${codigo} tinha garantia registrada por uma cliente. `
        + 'A garantia CONTINUA VALENDO no código dela — nada foi apagado do lado da cliente. '
        + 'O que mudou é que a peça voltou para a fila de gravação, e a ação ficou na trilha.'
      adminToast('Gravação apagada. Havia garantia de cliente — leia o aviso na tela.')
      return
    }
    adminToast('Gravação apagada. A peça voltou para a fila de gravação.')
  } finally {
    apagarEmVoo.value = false
    // ⚠️ A senha não sobrevive à ação, em nenhum caminho.
    senhaDeApagar.value = ''
  }
}

// O MESMO "Copiado!" do modo do aplicativo, mas por peça: com uma frase só para
// a lista inteira, a pessoa não saberia QUAL endereço foi para a área de
// transferência — e ia costurar a etiqueta errada achando que conferiu.
async function copiarEnderecoDaPeca(codigo) {
  try {
    await navigator.clipboard.writeText(enderecoDaTag(codigo))
    enderecoCopiado.value = codigo
    setTimeout(() => {
      if (enderecoCopiado.value === codigo) enderecoCopiado.value = ''
    }, 1800)
  } catch (e) {
    adminToast('Não consegui copiar — selecione o endereço na mão', false)
  }
}

const registrosFiltrados = computed(() => {
  const termo = busca.value.trim().toLowerCase()
  if (!termo) return registros.value
  return registros.value.filter((r) =>
    (r.nome || '').toLowerCase().includes(termo) || (r.codigo || '').toLowerCase().includes(termo))
})

// Data sempre no fuso de São Paulo: o banco guarda em UTC, e sem isso um
// registro feito às 22h aparece com a data do dia seguinte.
function dataCurta(valor) {
  if (!valor) return '—'
  const d = new Date(String(valor).length === 10 ? `${valor}T12:00:00Z` : valor)
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(d)
}

// TROCAR DE LOTE APAGA OS RECADOS DO LOTE ANTERIOR.
// Os dois falam de uma peça específica: o `recadoNfc` (inclusive o "PARE: esta
// etiqueta já tem OUTRA peça gravada") e a pergunta do gravador de mesa, que já
// carrega a lista de códigos contada. Deixados na tela sob um lote novo, viram
// aviso do lote errado — e aviso do lote errado é pior que aviso nenhum.
// O seletor fica travado enquanto `gravando`, então isto nunca apaga o recado
// de uma gravação em curso.
watch(loteEscolhido, () => {
  recadoNfc.value = ''
  // o ✓ (ou o ✗) do lote anterior sob um lote novo é sinal do lote errado, que
  // é pior que sinal nenhum — mesmo motivo do recado logo acima
  sinalDaGravacao.value = ''
  // a frase grande do painel de bancada fala da etiqueta de UM lote; sob um lote
  // novo ela é o estado do lote errado, que é pior que estado nenhum
  faseDaBancada.value = 'parado'
  confirmacaoDoGravador.value = null
  // a pergunta de sobrescrever fala de DUAS peças pelo nome; sob um lote novo
  // ela é pergunta do lote errado, que é pior que pergunta nenhuma
  sobrescrita.value = null
  baixando.value = false
  excluindoPeca.value = false
})

// TROCAR A PEÇA DA VEZ FECHA A PERGUNTA DE BAIXA, pelo mesmo cuidado do watch
// acima: a pergunta diz o número de UMA peça, e peça errada na pergunta é pior
// que pergunta nenhuma.
// Dois caminhos concretos: com a pergunta aberta, "Gravei essa" continua
// clicável — gravando a última, `proxima` vira nulo, o bloco todo some e
// `baixando` fica preso em `true`; depois um "Desfazer" devolve uma peça à fila
// e o bloco voltava COM A PERGUNTA JÁ ABERTA, para a peça que a pessoa acabou de
// restaurar. O outro é a pergunta trocar de peça calada por baixo da mão.
// O watch é pelo CÓDIGO, não pelo objeto: `carregar()` refaz `pecas.value`
// inteiro, e pelo objeto isto dispararia a cada recarga sem a peça ter mudado.
watch(() => proxima.value?.codigo, () => {
  baixando.value = false
  excluindoPeca.value = false
  // a pergunta diz o nome da bolsa que vai ENTRAR na etiqueta: com a peça da vez
  // trocada por baixo, ela prometeria uma e gravaria outra
  sobrescrita.value = null
})

function voltar() { router.push({ name: 'gestao-interna' }) }

function irGravar(id) {
  loteEscolhido.value = id
  aba.value = 'gravar'
}

// ── OS PRODUTOS DO BLING ──────────────────────────────────────────────────
// Carregam UMA vez, quando o formulário abre pela primeira vez. Não no boot da
// tela: quem só vem gravar etiqueta não precisa esperar o Bling.
const produtos = ref([])
const buscaProduto = ref('')
const carregandoProdutos = ref(false)
const erroProdutos = ref(null)

// ⚠️ SEM BUSCA MOSTRA TUDO, e nao lista vazia. Antes era
// `busca ? procurar(...).slice(0, 12) : []` — dois cortes silenciosos no mesmo
// lugar: abrir sem digitar nada nao mostrava produto nenhum, e digitar mostrava
// no maximo doze de trezentos, sem nada dizendo que havia mais.
const produtosAchados = computed(() => procurarProduto(produtos.value, buscaProduto.value))
const paginaDeProdutos = ref(1)
const paginaAtualDeProdutos = computed(
  () => fatiarProdutos(produtosAchados.value, paginaDeProdutos.value))
const numerosDasPaginas = computed(
  () => numerosDePagina(paginaAtualDeProdutos.value.pagina, paginaAtualDeProdutos.value.paginas))
// Buscar volta para a primeira pagina: continuar na 9 depois de filtrar deixaria
// a pessoa olhando o vazio com resultados existindo.
watch(buscaProduto, () => { paginaDeProdutos.value = 1 })

async function carregarProdutos() {
  if (produtos.value.length || carregandoProdutos.value) return
  carregandoProdutos.value = true
  erroProdutos.value = null
  produtosLidos.value = 0
  try {
    // `paginasDoBling` sobe a falha em vez de devolver lista vazia. Isso importa
    // aqui: "o Bling caiu" e "não há produto novo" ficariam iguais na tela, e a
    // pessoa criaria o lote à mão achando que a linha nova está vazia.
    // `criterio: 2` é "Ativos" na listagem de produtos da API v3 do Bling
    // (1 últimos incluídos · 2 ativos · 3 inativos · 4 excluídos · 5 todos).
    // Produto inativo é produto que saiu de linha: etiqueta de autenticidade
    // não se costura em bolsa que não se fabrica mais.
    // ⚠️ O TETO SUBIU DE 10 PARA 60 PÁGINAS (1.000 → 6.000 produtos), e o
    // motivo não é folga: `produtosParaEscolher` FILTRA para a linha nova
    // DEPOIS de a busca terminar. Filtrar depois de paginar é o que faz um teto
    // baixo esconder justamente o que se procura — e aqui esconde o pior
    // pedaço, porque `SS` vem depois de `LV` em ordem alfabética e os SKU novos
    // moram no fim da lista.
    let truncou = 0
    const itens = await paginasDoBling(sbClient, 'produtos', { criterio: 2 }, {
      maxPaginas: 60,
      aoTruncar: (quantos) => { truncou = quantos },
      aoProgredir: (quantos) => { produtosLidos.value = quantos },
    })
    produtos.value = produtosParaEscolher(itens)
    if (!produtos.value.length) {
      erroProdutos.value = { titulo: 'Não encontrei nenhum produto da linha nova no Bling.', detalhe: '' }
    } else if (truncou) {
      // NÃO É ERRO, É AVISO: a lista veio, só não veio inteira. Quem está
      // criando um lote precisa saber que o produto pode existir e não estar
      // aqui — senão cadastra à mão achando que ele não existe.
      erroProdutos.value = {
        titulo: `O Bling tem mais produtos do que eu consigo ler de uma vez (parei em ${truncou}).`,
        detalhe: 'Se o produto que você procura não aparecer, ele pode estar além desse limite. Me avise.',
      }
    }
  } catch (e) {
    // A FÁBRICA NÃO PODE FICAR REFÉM DO BLING: a busca some, os campos à mão
    // ficam. Mesma regra do modo de queda da gravação.
    //
    // Quem traduz o erro em duas frases é o `avisoDoErro`, e não este `catch`:
    // aqui já se passou `e.message` (que é o texto TÉCNICO, nunca a causa) e já
    // se jogou o objeto do aviso inteiro na tela, onde a pessoa lia
    // `[object Object]`. Ver `src/compartilhado/chamada-do-bling.js`.
    //
    // O `ehAdmin` SEGUE QUEM ABRE O FORMULÁRIO, que é `podeCriar`. Com
    // `podeEditar` aqui, quem tem `criar` sem `editar` caía no ramo não-admin do
    // `textoDoAviso` e lia "Não foi possível buscar as vendas agora." — numa
    // tela de etiqueta, que não tem venda nenhuma.
    erroProdutos.value = avisoDoErro(e, { ehAdmin: podeCriar.value })
  } finally {
    carregandoProdutos.value = false
  }
}

// O Bling PREENCHE, a pessoa CONFERE. Os campos continuam editáveis de
// propósito: a cor sai vazia quando o código e o nome do produto não
// concordam, e é melhor a pessoa completar do que a tela chutar.
function usarProduto(p) {
  novo.modelo = p.modelo || p.nome
  novo.cor = p.cor
  novo.sku = p.codigo
  buscaProduto.value = ''
}

function abrirFormulario() {
  erroForm.value = ''
  formulario.value = true
  carregarProdutos()
}

// ── A FILA DE GARANTIAS ────────────────────────────────────────────────────
// A regra de quem entra e em que ordem mora em `registros-de-garantia.js`, com
// teste. Aqui fica só o que precisa de tela.
const filaDeGarantias = computed(() => filaDeGarantia(pedidosDeGarantia.value))

// QUEM É O DONO ATUAL de uma peça, para o aviso "esta peça já está registrada
// em nome de…". Esse aviso é o mais importante da fila: é aqui que se decide
// entre duas pessoas que dizem ser a mesma dona — exatamente o que o sistema
// antigo resolvia sozinho, do jeito errado, dando para quem chegou primeiro.
const donoPorCodigo = computed(() => new Map(registros.value.map((r) => [r.codigo, r])))
const donoDe = (codigo) => donoPorCodigo.value.get(codigo) || null

const decidindo = ref(null)
const motivoDaDecisao = ref('')
const decisaoEmVoo = ref(false)
const erroDaDecisao = ref('')

// RECUSAR EXIGE MOTIVO ESCRITO; aprovar não. O banco cobra a mesma coisa —
// aqui é só para o botão não convidar a um clique que vai voltar com erro.
// Aprovar é o caminho normal, e exigir justificativa do caminho normal ensina a
// escrever "ok" em tudo, que é o mesmo que não ter justificativa nenhuma.
const podeDecidir = computed(() =>
  decidindo.value?.estado === 'aprovado' || motivoDaDecisao.value.trim().length > 0)

// ⚠️ O PARAMETRO NAO SE CHAMA `estado`, e nao e capricho: `estado` e exportado
// por `controle-de-login-e-usuario.js`, e a guarda de imports reprova o arquivo
// inteiro por causa da colisao — ela nao tem como saber que este `estado` e um
// parametro local. O nome daqui e `decisao`, que alias diz melhor o que e.
function abrirDecisao(pedido, decisao) {
  decidindo.value = { id: pedido.id, estado: decisao }
  motivoDaDecisao.value = ''
  erroDaDecisao.value = ''
}
function fecharDecisao() {
  decidindo.value = null
  motivoDaDecisao.value = ''
  erroDaDecisao.value = ''
}

async function confirmarDecisao() {
  if (!decidindo.value || decisaoEmVoo.value || !podeDecidir.value) return
  decisaoEmVoo.value = true
  erroDaDecisao.value = ''
  try {
    const { data, error } = await sbClient.rpc('vessel_decidir_pedido_de_registro', {
      p_pedido: decidindo.value.id,
      p_estado: decidindo.value.estado,
      // 'na_mao' é o único valor que esta tela pode mandar: 'bling' significa
      // "a conferência automática achou a venda", e quem diz isso é a edge, com
      // o número do pedido em mãos. A tela dizendo 'bling' seria a tela dando a
      // si mesma um selo de conferido.
      p_quem_decidiu: 'na_mao',
      p_conferencia: null,
      p_motivo: motivoDaDecisao.value.trim() || null,
    })
    if (error) throw error
    if (!data?.ok) {
      erroDaDecisao.value = fraseDaRecusaDeGarantia(data?.motivo, data)
      return
    }
    adminToast(decidindo.value.estado === 'aprovado'
      ? 'Garantia aprovada.' : 'Registro recusado.')
    fecharDecisao()
    // RECARREGA TUDO, e não só a fila: aprovar cria um dono novo em
    // `vessel_registros`, e a lista de baixo mostraria a peça sem dono até a
    // próxima visita. Duas listas da mesma verdade em estados diferentes na
    // mesma tela é o defeito que faz a pessoa desconfiar do painel.
    await carregar()
  } catch (e) {
    erroDaDecisao.value = fraseDaRecusaDeGarantia(e?.message)
  } finally {
    decisaoEmVoo.value = false
  }
}

// ── TROCAR O DONO ─────────────────────────────────────────────────────────
// Revenda e presente são o caso NORMAL disto, não a exceção. As regras de
// quando o botão libera moram em `registros-de-garantia.js`, com teste — e o
// banco cobra as mesmas de novo, porque a trava da tela é conforto e a do banco
// é a que vale.
const trocando = ref('')
const troca = ref({ nome: '', cpf: '', whatsapp: '', motivo: '', confirmacao: '' })
const trocaEmVoo = ref(false)
const erroDaTroca = ref('')

function abrirTroca(registro) {
  trocando.value = registro.codigo
  troca.value = { nome: '', cpf: '', whatsapp: '', motivo: '', confirmacao: '' }
  erroDaTroca.value = ''
}
function fecharTroca() {
  trocando.value = ''
  erroDaTroca.value = ''
}

async function confirmarTroca(registro) {
  if (trocaEmVoo.value || !podeTrocarDono(troca.value, registro.codigo)) return
  trocaEmVoo.value = true
  erroDaTroca.value = ''
  try {
    const { data, error } = await sbClient.rpc('vessel_trocar_dono', {
      p_codigo: registro.codigo,
      p_nome: troca.value.nome.trim(),
      p_cpf: cpfLimpo(troca.value.cpf),
      p_whatsapp: troca.value.whatsapp,
      p_motivo: troca.value.motivo.trim(),
      p_confirmacao: troca.value.confirmacao.trim(),
    })
    if (error) throw error
    if (!data?.ok) {
      erroDaTroca.value = fraseDaRecusaDeGarantia(data?.motivo, data)
      return
    }
    adminToast(`Dono trocado: de ${data.de} para ${data.para}.`)
    fecharTroca()
    await carregar()
  } catch (e) {
    erroDaTroca.value = fraseDaRecusaDeGarantia(e?.message)
  } finally {
    trocaEmVoo.value = false
  }
}

// ── A ABA DOS CARTÕES EAN ──────────────────────────────────────────────────

/** Os lotes por id, que é como as linhas acham o SKU da peça. */
const lotesPorId = computed(() =>
  Object.fromEntries(lotes.value.map((l) => [l.id, l])))

const linhasDosCartoes = computed(() => {
  const daVez = loteDosCartoes.value
    ? pecas.value.filter((p) => p.lote_id === loteDosCartoes.value)
    : pecas.value
  return linhasDeCartao(daVez, lotesPorId.value, indiceDosCartoes.value || {})
})

const resumoDosCartoes = computed(() =>
  resumoDoPedido(linhasDosCartoes.value, marcadasParaCartao.value))

/** Só os pedidos que ainda dizem alguma coisa: fila vazia não ocupa tela. */
const pedidosEmAndamento = computed(() => pedidosDeCartao.value
  .filter((q) => q.situacao !== 'pronto' || Date.now() - Date.parse(q.terminou_em || 0) < 36e5)
  .slice(0, 5))

/**
 * O endereço da prévia.
 *
 * ⚠️ A PEÇA VAI NO HASH, e não na query. O hash não é mandado ao servidor —
 * nem para o do site, nem para nenhum intermediário — e o que viaja aqui é o
 * número de série de uma peça. Ele é impresso no cartão, mas não há motivo
 * nenhum para ele aparecer num log de acesso.
 */
const enderecoDaPrevia = computed(() => {
  if (!pecaNaPrevia.value) return ''
  return BASE_DOS_RECURSOS + 'previa.html#' + encodeURIComponent(JSON.stringify(pecaNaPrevia.value))
})

/**
 * ⚠️ O ÍNDICE É BAIXADO UMA VEZ, E A FALHA APARECE. Sem ele, TODA peça cairia
 * em "sem foto" e a aba diria que nenhum produto pode ter cartão — uma falha de
 * rede virando um fato sobre o catálogo. É a mesma família do `erro virando
 * zero` que já custou caro nesta casa: falha que vira resposta.
 */
async function carregarOsCartoes() {
  if (indiceDosCartoes.value) return
  carregandoOsCartoes.value = true
  erroDosCartoes.value = ''
  try {
    const r = await fetch(BASE_DOS_RECURSOS + 'indice.json', { cache: 'no-store' })
    if (!r.ok) throw new Error('o site respondeu ' + r.status)
    indiceDosCartoes.value = await r.json()
    marcadasParaCartao.value = marcadasPorPadrao(linhasDosCartoes.value)
  } catch (e) {
    erroDosCartoes.value = 'Não consegui ler a lista de produtos publicados no site ('
      + (e?.message || e) + '). Sem ela não dá para saber quais produtos têm foto, '
      + 'e a aba mostraria todos como "sem foto". Recarregue a tela.'
  } finally {
    carregandoOsCartoes.value = false
  }
}

async function carregarAFilaDeCartoes() {
  const { data, error } = await sbClient.from('vessel_cartao_pedidos')
    .select('*').order('criado_em', { ascending: false }).limit(20)
  // Falhar aqui não pode apagar a aba: a lista de peças continua servindo. Mas
  // também não pode sumir calada — a pessoa mandaria gerar de novo achando que
  // o primeiro pedido se perdeu.
  if (error) { erroDosCartoes.value = 'Não consegui ler a fila de cartões: ' + error.message; return }
  pedidosDeCartao.value = data || []
}

function verOCartao(linha) {
  erroDaPrevia.value = ''
  pecaNaPrevia.value = pecaParaODesenho(linha, indiceDosCartoes.value || {})
  if (!pecaNaPrevia.value) {
    erroDaPrevia.value = MOTIVO_DO_IMPEDIMENTO.sem_foto
  }
}

function fecharAPrevia() {
  pecaNaPrevia.value = null
  erroDaPrevia.value = ''
}

async function pedirOsCartoes() {
  if (!resumoDosCartoes.value.total || pedindoCartoes.value) return
  // ⚠️ PEÇA MARCADA QUE NÃO PODE GERAR DERRUBARIA A LEVA INTEIRA no banco, e a
  // pessoa perderia a seleção toda. Parar aqui custa um aviso.
  if (resumoDosCartoes.value.impedidas) {
    erroDosCartoes.value = `${resumoDosCartoes.value.impedidas} peça(s) marcada(s) não podem `
      + 'ter cartão. Desmarque-as antes de gerar — o banco recusaria a leva inteira.'
    return
  }
  pedindoCartoes.value = true
  erroDosCartoes.value = ''
  try {
    const { data, error } = await sbClient.rpc('vessel_pedir_cartoes',
      { p_pecas: marcadasParaCartao.value })
    if (error) throw error
    if (!data?.ok) { erroDosCartoes.value = fraseDoPedidoRecusado(data?.motivo, data); return }
    adminToast(`${data.pecas} cartão(ões) na fila. O robô avisa aqui quando entregar no Zoho.`)
    marcadasParaCartao.value = []
    await carregarAFilaDeCartoes()
  } catch (e) {
    erroDosCartoes.value = 'Não consegui mandar o pedido: ' + (e?.message || e)
  } finally {
    pedindoCartoes.value = false
  }
}

// A PRÉVIA AVISA QUANDO NÃO CONSEGUE DESENHAR. Prévia que falha em silêncio é
// pior que prévia nenhuma: o quadro fica branco, a pessoa acha que é o cartão
// carregando e manda gerar uma leva de uma coisa que não viu.
function ouvirAPrevia(evento) {
  // ⚠️ CONFERE A ORIGEM. `postMessage` chega de qualquer iframe e de qualquer
  // aba aberta; sem esta linha, qualquer página poderia escrever um recado na
  // tela da bancada.
  if (!BASE_DOS_RECURSOS.startsWith(evento.origin + '/')) return
  const recado = evento.data
  if (recado?.previaDoCartao === 'falhou') erroDaPrevia.value = recado.motivo
  if (recado?.previaDoCartao === 'pronto') erroDaPrevia.value = ''
}

// Ao abrir a aba, e não antes: são 37 KB de índice que não têm por que pesar em
// quem entrou para gravar uma etiqueta.
watch(aba, (agora) => {
  if (agora !== 'cartoes') return
  carregarOsCartoes()
  carregarAFilaDeCartoes()
})
// Trocar de lote refaz a marcação — senão fica marcada peça que não está mais
// na lista, e o pedido leva peça que a pessoa não está vendo.
watch(loteDosCartoes, () => {
  marcadasParaCartao.value = marcadasPorPadrao(linhasDosCartoes.value)
  fecharAPrevia()
})

async function carregar() {
  carregando.value = true
  falha.value = ''
  try {
    const [l, p, r, a, fila, baixas] = await Promise.all([
      sbClient.from('vessel_lotes').select('*').order('criado_em', { ascending: false }),
      // `cartao_gerado_em` entrou em 11/09/2026: é o que separa a peça que já
      // tem cartão impresso da que ainda espera. Sem ele a aba Cartões EAN
      // marcaria TODAS por padrão e reimprimiria a leva inteira a cada clique.
      sbClient.from('vessel_pecas').select('codigo,lote_id,numero_na_serie,gravada_em,cartao_gerado_em'),
      sbClient.from('vessel_registros').select('*').order('registrado_em', { ascending: false }),
      sbClient.rpc('vessel_alertas'),
      // A FILA VEM POR FUNÇÃO, e não por `select` na tabela, porque ela MASCARA
      // o CPF: a tela nunca recebe o número inteiro, nem para quem tem a chave
      // da ferramenta. Sai o que basta para reconhecer a pessoa e decidir.
      sbClient.rpc('vessel_fila_de_registros'),
      // baixa ATIVA é a linha com `desfeita_em` nula. `vessel_baixas` tem a
      // mesma política de SELECT de `vessel_pecas`, então se lê do mesmo jeito.
      sbClient.from('vessel_baixas').select('codigo,motivo,baixada_em').is('desfeita_em', null),
    ])
    // NENHUMA DESTAS LEITURAS PODE FALHAR EM SILÊNCIO, e cada uma mente de um
    // jeito diferente quando falha (PADRAO-DA-CENTRAL item 9: a tela nunca
    // mente). Falhar à vista é sempre melhor:
    //
    //  · `baixas`  — sem a lista, nenhuma peça sai marcada e a peça baixada
    //                volta para a fila como se nada tivesse acontecido: alguém
    //                gravaria a etiqueta de uma peça dada como refugo;
    //  · `p`       — sem as peças, o lote aparece com a fila VAZIA, e a tela
    //                diz "todas as etiquetas já foram gravadas" sem nenhuma ter
    //                sido;
    //  · `a`       — sem os alertas, `resumoDeAlertas(null).limpo` dá `true` e a
    //                aba anuncia "Nada suspeito nos últimos 30 dias. Foram 0
    //                leituras" com uma bolsa extraviada sendo lida. Falha
    //                virando "está tudo bem" é o defeito mais caro deste
    //                projeto;
    //  · `r`       — sem os registros, a tela diz "Nenhuma cliente registrou a
    //                garantia ainda" para uma lista que existe.
    //
    // E `error` NÃO É A ÚNICA FORMA DE FALHAR. As funções do banco deste painel
    // respondem 200 com `{ ok:false, motivo:'sem_permissao' }` quando o portão
    // recusa — não é erro de rede, é a função dizendo não. `resumoDeAlertas`
    // desse objeto não acha NENHUMA das três chaves e devolve `limpo: true`: a
    // aba anunciava "Nada suspeito nos últimos 30 dias" para quem simplesmente
    // não podia ver os alertas. O caminho é real e tem nome: quem tem a chave
    // `autenticidade` no front e NÃO no `features[]` do banco — são dois
    // lugares, e o LEIA-ME desta pasta avisa disso.
    //  · `fila`    — sem ela, os registros que esperam decisão somem da tela e
    //                ninguém fica sabendo que há gente sem a garantia dela. É a
    //                mesma família de defeito do `a`: falha virando silêncio.
    for (const leitura of [l, p, r, a, fila, baixas]) {
      if (leitura.error) throw leitura.error
      if (leitura.data && leitura.data.ok === false) throw Object.assign(
        new Error(leitura.data.motivo), { recusa: leitura.data.motivo })
    }
    lotes.value = l.data || []
    pecas.value = p.data || []
    registros.value = r.data || []
    alertas.value = a.data || null
    pedidosDeGarantia.value = fila.data?.pedidos || []
    // A PEÇA CARREGA A BAIXA JUNTO: é o campo `baixada` — este nome exato, e
    // booleano — que `naFila` usa em lotes.js para tirar a peça da fila de
    // gravação. Trocar o nome aqui não quebra teste nenhum: a fila simplesmente
    // pararia de filtrar, em silêncio.
    const porCodigo = new Map((baixas.data || []).map((b) => [b.codigo, b]))
    pecas.value.forEach((p2) => {
      const b = porCodigo.get(p2.codigo)
      p2.baixada = Boolean(b)
      p2.baixa_motivo = b?.motivo || null
      p2.baixada_em = b?.baixada_em || null
    })
    // O LOTE QUE A ABA GRAVAR ABRE É O PRIMEIRO COM PEÇA POR GRAVAR, e não o
    // mais recente: com o lote de ontem já encerrado, a aba abria numa fila
    // vazia dizendo "nada a fazer aqui" com trinta etiquetas esperando no lote
    // de baixo. Sem nenhum pendente, cai no mais recente — que é o que o
    // seletor mostra para quem veio desfazer uma baixa.
    if (!loteEscolhido.value && lotes.value.length) {
      const pendente = lotes.value.find((l) => !estadoDoLote(pecasDoLote(l.id)).encerrado)
      loteEscolhido.value = (pendente || lotes.value[0]).id
    }
  } catch (e) {
    // `e.recusa` só existe quando quem disse não foi a rede, e sim o BANCO.
    // Mandar "confira sua conexão" para quem está sem a chave `autenticidade`
    // é apontar o defeito errado, e a pessoa mexe na internet a manhã inteira.
    falha.value = e?.recusa
      ? fraseDaRecusa(e.recusa)
      : 'Não consegui carregar. Confira sua conexão e tente de novo.'
  } finally {
    carregando.value = false
  }
}

async function gerarLote() {
  erroForm.value = ''
  if (!novo.modelo.trim()) { erroForm.value = 'Escreva o modelo da bolsa.'; return }
  if (!(novo.quantidade >= 1 && novo.quantidade <= 500)) {
    erroForm.value = 'A quantidade precisa ser de 1 a 500 peças.'; return
  }
  salvando.value = true
  try {
    const { data, error } = await sbClient.rpc('vessel_gerar_lote', {
      p_modelo: novo.modelo, p_cor: novo.cor, p_sku: novo.sku,
      p_quantidade: novo.quantidade,
      p_fabricado_em: novo.fabricado_em || null,
      p_fotos: null,
      // O.S. em branco vai como string vazia, e o banco a transforma em NULA.
      p_os: novo.os,
    })
    if (error) throw error
    if (!data?.ok) {
      erroForm.value = data?.motivo === 'sem_permissao'
        ? 'Você não tem permissão para gerar lotes.'
        : 'Não consegui gerar. Confira os dados.'
      return
    }
    formulario.value = false
    adminToast(`Lote criado com ${novo.quantidade} códigos`)
    novo.modelo = ''; novo.cor = ''; novo.sku = ''; novo.quantidade = 20; novo.fabricado_em = ''
    await carregar()
    irGravar(data.lote_id)
  } catch (e) {
    erroForm.value = 'Não consegui gerar o lote agora. Tente de novo.'
  } finally {
    salvando.value = false
  }
}

function abrirEdicao(l) {
  // `fecharExcluir()` e não `excluindo.value = null`: abrir o editor com a
  // pergunta de excluir pela metade deixaria a senha digitada viva na memória
  // da tela, esperando o próximo clique.
  fecharExcluir()
  editando.value = l.id
  edicao.modelo = l.modelo || ''
  edicao.cor = l.cor || ''
  edicao.sku = l.sku || ''
  edicao.fabricado_em = l.fabricado_em || ''
  edicao.quantidade = l.quantidade || 1
  // ⚠️ SEM ESTA LINHA, ABRIR E SALVAR APAGARIA A O.S.: o campo nasceria vazio,
  // e vazio quer dizer "limpe" para a função do banco.
  edicao.os = l.os || ''
  // o cartão em edição também vira faixa e sobe para a primeira linha
  trazerOLoteParaAVista(l.id)
}

function pedirExcluir(id) {
  editando.value = null
  excluindo.value = id
  // toda pergunta recomeça da primeira etapa, com o campo de senha limpo: uma
  // pergunta que abre já na etapa 2, com a senha de antes escrita, é um clique
  // de distância de apagar o lote errado
  etapaDeExcluir.value = 1
  senhaDaExclusao.value = ''
  erroDaSenha.value = ''
  // e o cartão com a pergunta aberta idem: perder de vista a pergunta que se
  // acabou de abrir é pior aqui do que em qualquer outro lugar desta tela
  trazerOLoteParaAVista(id)
}

function fecharExcluir() {
  excluindo.value = null
  etapaDeExcluir.value = 1
  // a senha sai da memória junto com a pergunta
  senhaDaExclusao.value = ''
  erroDaSenha.value = ''
}

// ── CONFERIR A SENHA DE QUEM ESTÁ LOGADO, NO SERVIDOR ─────────────────────
//
// PASSA PELA EDGE `conferir-senha`, e NÃO por `sbClient.auth.signInWithPassword`
// aqui na tela. O motivo está escrito no cabeçalho da própria edge e já custou
// caro na Frota: o único jeito de conferir senha pelo cliente é o
// `signInWithPassword`, e ele TROCA A SESSÃO — token novo, com a pergunta e o
// lote pela metade na tela. A edge descobre quem é a pessoa pelo TOKEN (nunca
// por e-mail vindo do cliente, senão isto vira um oráculo para testar senha dos
// outros), refaz o login num cliente isolado que morre com a função, e devolve
// só sim ou não. Ela também conta as tentativas e bloqueia por dez minutos.
//
// ⚠️ ISTO É FRICÇÃO, NÃO COFRE. Ver o comentário de `fraseDaSenha` em lotes.js:
// quem manda de verdade é `is_vessel_admin()` por dentro da função do banco.
async function conferirASenha(senha) {
  if (!senha) return { ok: false, erro: 'sem_senha' }
  try {
    const { data, error } = await sbClient.functions.invoke('conferir-senha', { body: { senha } })
    if (error) {
      // A edge responde 429 (bloqueado), 401 (sem sessão) e 400 (sem senha) FORA
      // do 2xx, e o supabase-js transforma isso em `error` com `data` NULO. Lendo
      // o motivo só do `data`, "bloqueado por dez minutos" apareceria como
      // "senha incorreta" e a pessoa tentaria de novo sem parar.
      const detalhe = await error.context?.json?.().catch(() => null)
      return { ok: false, erro: detalhe?.erro || 'falha_interna' }
    }
    if (!data?.ok) return { ok: false, erro: data?.erro || 'falha_interna' }
    return { ok: true }
  } catch (e) {
    // falha em conferir é senha RECUSADA, nunca senha concedida por acidente
    return { ok: false, erro: 'falha_interna' }
  }
}

// `sbClient.rpc` NÃO ESTOURA: devolve `{ data, error }`. `error` é falha de rede
// ou de permissão; `data.ok === false` é a regra de negócio do banco recusando.
// Os dois precisam aparecer, e com frases diferentes — tratar só o `error` foi
// defeito real deste mesmo arquivo, e a tela anunciava sucesso quando nada
// tinha acontecido (PADRAO-DA-CENTRAL, item 9: a tela nunca mente).
async function salvarEdicao() {
  const { data, error } = await sbClient.rpc('vessel_editar_lote', {
    p_lote: editando.value,
    p_modelo: edicao.modelo,
    p_cor: edicao.cor,
    p_sku: edicao.sku,
    p_fabricado_em: edicao.fabricado_em || null,
    p_quantidade: Number(edicao.quantidade),
    // ⚠️ MANDA STRING, NUNCA `|| null`. Para esta função, NULO quer dizer "não
    // mexa na O.S." — então `edicao.os || null` faria apagar um número virar
    // impossível: quem limpasse o campo veria o valor antigo voltar.
    p_os: String(edicao.os ?? ''),
  })
  if (error) { adminToast('Não consegui salvar agora', false); return }
  if (!data?.ok) { adminToast(fraseDaRecusa(data?.motivo, data), false); return }
  editando.value = null
  await carregar()
  adminToast('Lote atualizado')
}

// QUEM RECUSA É O BANCO, NÃO A TELA. Lote com etiqueta já gravada não se exclui:
// a página da cliente passaria a dizer "não consta" e uma bolsa original
// pareceria falsa. A tela só traduz a recusa, com o número que o banco devolveu.
//
// A SENHA VEM ANTES DA PRIMEIRA ESCRITA, e o erro dela é DIFERENTE do erro da
// exclusão: senha errada não apagou nada e se resolve ali mesmo, no campo, sem
// fechar a pergunta. Recusa do banco fecha a pergunta, porque apertar de novo
// traria a mesma resposta.
async function excluirLote(id) {
  if (exclusaoDeLoteEmVoo.value) return
  const senha = senhaDaExclusao.value
  erroDaSenha.value = ''
  if (!senha) { erroDaSenha.value = fraseDaSenha('sem_senha'); return }
  exclusaoDeLoteEmVoo.value = true
  try {
    const conferida = await conferirASenha(senha)
    if (!conferida.ok) { erroDaSenha.value = fraseDaSenha(conferida.erro); return }

    const { data, error } = await sbClient.rpc('vessel_excluir_lote', { p_lote: id })
    if (error) { adminToast('Não consegui excluir agora', false); return }
    if (!data?.ok) { fecharExcluir(); adminToast(fraseDaRecusa(data?.motivo, data), false); return }
    fecharExcluir()
    await carregar()
    adminToast(`Lote excluído, com ${data.excluidas} etiqueta(s).`)
  } finally {
    exclusaoDeLoteEmVoo.value = false
    // ⚠️ A SENHA NÃO SOBREVIVE À AÇÃO, em nenhum caminho — nem no que deu certo,
    // nem no que falhou. Ela nunca esteve em `localStorage` e não fica na
    // memória da tela esperando o próximo clique.
    senhaDaExclusao.value = ''
  }
}

// DAR BAIXA É O CAMINHO DE QUEM NÃO PODE EXCLUIR. Peça gravada pode estar
// dentro de uma bolsa: excluir faria a página da cliente dizer "não consta" e
// uma bolsa original pareceria falsa. A baixa tira a peça da fila, guarda o
// motivo, e a página da cliente continua respondendo igual.
//
// `sbClient.rpc` NÃO ESTOURA: devolve `{ data, error }`. `error` é rede ou
// permissão; `data.ok === false` é a regra do banco recusando. Os dois aparecem,
// com frases diferentes.
async function baixarPeca(codigo) {
  if (baixaEmVoo.value) return
  baixaEmVoo.value = true
  try {
    const { data, error } = await sbClient.rpc('vessel_baixar_peca',
      { p_codigo: codigo, p_motivo: motivoDaBaixa.value })
    if (error) { adminToast('Não consegui dar baixa agora', false); return }
    if (!data?.ok) { adminToast(fraseDaRecusa(data?.motivo, data), false); return }
    baixando.value = false
    await carregar()
    const rotulo = rotuloDoMotivo(motivoDaBaixa.value)
    adminToast(`Peça baixada como ${rotulo}. Ela sai da fila e continua respondendo para a cliente.`)
  } finally {
    baixaEmVoo.value = false
  }
}

// EXCLUIR UMA PEÇA. Vale para a que ainda NÃO foi gravada: nada dela existe no
// mundo. Quem recusa continua sendo o banco — peça gravada volta 'esta_gravada'
// e peça com garantia registrada volta 'tem_garantia' —, e a tela só traduz.
// Esta é a razão de a frase `esta_gravada` existir: até aqui ela era
// inalcançável, porque `vessel_excluir_peca` não tinha nenhum chamador.
async function excluirPeca(codigo) {
  if (exclusaoEmVoo.value) return
  exclusaoEmVoo.value = true
  try {
    const { data, error } = await sbClient.rpc('vessel_excluir_peca', { p_codigo: codigo })
    if (error) { adminToast('Não consegui excluir agora', false); return }
    // a pergunta fecha ANTES do recado da recusa: deixá-la aberta convida a
    // apertar de novo, e a resposta seria a mesma
    excluindoPeca.value = false
    if (!data?.ok) { adminToast(fraseDaRecusa(data?.motivo, data), false); return }
    await carregar()
    adminToast('Peça excluída. As seguintes do lote foram renumeradas.')
  } finally {
    exclusaoEmVoo.value = false
  }
}

async function desfazerBaixa(codigo) {
  if (baixaEmVoo.value) return
  baixaEmVoo.value = true
  try {
    const { data, error } = await sbClient.rpc('vessel_desfazer_baixa', { p_codigo: codigo })
    if (error) { adminToast('Não consegui desfazer agora', false); return }
    if (!data?.ok) { adminToast(fraseDaRecusa(data?.motivo, data), false); return }
    await carregar()
    adminToast('Baixa desfeita. A peça voltou para a fila.')
  } finally {
    baixaEmVoo.value = false
  }
}

async function copiar() {
  if (!proxima.value) return
  try {
    await navigator.clipboard.writeText(enderecoDaTag(proxima.value.codigo))
    textoCopiar.value = 'Copiado!'
    setTimeout(() => { textoCopiar.value = 'Copiar endereço' }, 1800)
  } catch (e) {
    adminToast('Não consegui copiar — selecione o endereço na mão', false)
  }
}

// O CÓDIGO ENTRA POR ARGUMENTO, e isto não é preferência de estilo.
// `gravarNaEtiqueta` escolhe a peça no começo e leva até 8 segundos com o
// "Encoste a etiqueta…" na tela. Relendo `proxima.value` aqui no fim, quem
// trocasse de lote no meio gravava a etiqueta do lote A e marcava como pronta a
// peça do lote B — e a bolsa B saía da fábrica marcada como pronta com a
// etiqueta em branco costurada dentro. A leitura de volta não protegia nada
// nesse caminho: conferia A e marcava B.
//
// Devolve `true` só quando o banco confirmou. Quem chama decide o que dizer —
// recado de "pronta" sem marcação é a mesma mentira que a tela não conta.
async function marcarGravada(codigo = proxima.value?.codigo) {
  if (!codigo) return false
  try {
    const { data, error } = await sbClient.rpc('vessel_marcar_gravada', { p_codigo: codigo })
    if (error) throw error
    // O MOTIVO VEM DO BANCO, não é mais adivinhado. Até 01/09/2026 esta linha
    // dizia "Sem permissão para marcar" para QUALQUER recusa — e o banco só
    // sabia recusar por permissão, porque respondia `ok:true` mesmo quando não
    // mudava linha nenhuma. Código inexistente passava por gravado.
    if (!data?.ok) {
      adminToast(fraseDaRecusa(data?.motivo) || 'Não consegui marcar esta peça.', false)
      avisarNaTela('falha')
      return false
    }
    // atualiza só a peça, sem recarregar tudo: a equipe está gravando em
    // sequência e uma recarga inteira a cada etiqueta trava o ritmo
    const alvo = pecas.value.find((p) => p.codigo === codigo)
    if (alvo) alvo.gravada_em = new Date().toISOString()
    textoCopiar.value = 'Copiar endereço'
    // O ✓ NASCE AQUI, e não no chamador: este é o único ponto que sabe se o
    // BANCO confirmou. Acendendo lá em cima, o "Gravei essa" do modo do
    // aplicativo ficaria sem sinal nenhum — e ele é o modo do iPhone.
    avisarNaTela('ok')
    return true
  } catch (e) {
    adminToast('Não consegui marcar agora', false)
    avisarNaTela('falha')
    return false
  }
}

// O BOTÃO É UM SÓ E OS CAMINHOS SÃO DOIS. Quem escolhe é o modo em uso — e a
// escolha mora aqui, num lugar só, para o template não ficar com regra dentro.
function gravarAgora() {
  return gravaPorMesa.value ? gravarNoLeitorDeMesa() : gravarNaEtiqueta()
}

// ── GRAVAR PELO LEITOR DE MESA ────────────────────────────────────────────
// A REGRA INTEIRA MORA EM `gravar-pelo-leitor-de-mesa.js`, que se prova com
// `node --test`: ler antes, montar o plano A PARTIR DO QUE LEU, escrever, ler de
// volta, conferir, e só então marcar. Aqui só se liga a porta, a peça e a tela.
//
// ⚠️ MONTAR O PLANO SEM LER É O ESTRAGO MEDIDO NA BANCADA em 01/09/2026: bytes
// montados supondo etiqueta de fábrica, gravados numa etiqueta reaproveitada —
// o leitor respondeu `90 00` doze vezes e a etiqueta ficou com uma mensagem
// quebrada, ilegível para o celular da cliente.
async function gravarNoLeitorDeMesa() {
  const peca = proxima.value
  if (!peca || gravando.value) return
  const porta = criarGravadorDeMesa()
  // sem o programa do outro lado não há leitor: cai para o modo do aplicativo em
  // vez de deixar um botão que não faz nada
  if (!porta) { gravaPorMesa.value = false; return }

  gravando.value = true
  recadoNfc.value = ''
  // a etiqueta ainda não encostou: é o que o painel de bancada diz em letra
  // grande até a sequência avisar que começou a escrever
  faseDaBancada.value = 'esperando'
  try {
    const r = await gravarPeloLeitorDeMesa({
      porta,
      peca,
      endereco: enderecoDaTag(peca.codigo),
      // MARCAR É O MESMO CAMINHO DO CELULAR. `marcarGravada` fala com o banco e
      // só devolve verdadeiro quando o BANCO confirmou — e o `auth.uid()` sai da
      // sessão de quem entrou NESTA janela. É por isso que o programa não guarda
      // senha nem chave: quem gravou cada peça fica registrado pela conta dela.
      //
      // `peca.codigo` explícito, e não `marcarGravada()`: sem o argumento ela
      // relê `proxima.value`, que pode ter virado outra peça no meio.
      marcar: () => marcarGravada(peca.codigo),
      // A FASE VEM PELO SEGUNDO ARGUMENTO, e não de ler a frase. Adivinhar o
      // estado pelo texto faria alguém melhorar uma palavra lá dentro e o painel
      // parar de mudar de estado, em silêncio.
      aoContar: (frase, fase) => { recadoNfc.value = frase; if (fase) faseDaBancada.value = fase },
    })

    // A ETIQUETA JÁ TEM OUTRA PEÇA: a decisão é de quem está com a bolsa na mão.
    // A pergunta é a MESMA do caminho do celular, com o nome da bolsa que vai
    // perder a identidade.
    if (r.estado === 'outra-peca') {
      abrirPerguntaDeSobrescrita(peca, r.codigoAntigo)
      avisarNaTela('falha')
      return
    }

    recadoNfc.value = r.frase
    // `marcarGravada` já acende o sinal nos estados que passaram pelo banco.
    // Acender de novo aqui daria DOIS sinais para a mesma gravação; não acender
    // nos outros deixaria a recusa sem sinal nenhum.
    const passouPeloBanco = ['gravada', 'ja-era-dela', 'gravada-sem-marcar'].includes(r.estado)
    if (!passouPeloBanco) avisarNaTela('falha')
  } catch (erro) {
    recadoNfc.value = traduzirFalhaDoLeitorDeMesa(erro)
    avisarNaTela('falha')
  } finally {
    gravando.value = false
  }
}

// A REGRA INTEIRA ESTÁ AQUI: lê antes, grava, lê depois, e só então marca.
// Marcar porque o `write` não deu erro é marcar no escuro — e no escuro a peça
// entra como pronta com a etiqueta em branco costurada dentro da bolsa.
async function gravarNaEtiqueta() {
  const peca = proxima.value
  if (!peca || gravando.value) return
  const gravador = criarGravador()
  if (!gravador) { gravaPorNfc.value = false; return }

  gravando.value = true
  recadoNfc.value = 'Encoste a etiqueta no celular e segure parado…'
  faseDaBancada.value = 'esperando'
  try {
    // 1. LER ANTES: etiqueta com outra peça não pode ser sobrescrita
    const antes = await gravador.lerUmaVez()
    const situacao = conferirLeitura(antes, peca.codigo)
    if (situacao === 'outra-peca') {
      // A ETIQUETA JÁ TEM OUTRA PEÇA. Antes isto era o fim da linha: "separe ela
      // e pegue uma etiqueta em branco". O dono pediu para OFERECER a
      // sobrescrita — o caso comum é a etiqueta que foi gravada e ficou de lado
      // antes de costurar.
      //
      // A DECISÃO NÃO CABE AQUI DENTRO. Ela vira uma pergunta na tela, com o
      // NOME DA BOLSA que vai perder a identidade, e a gravação física só
      // acontece em `sobrescreverEtiqueta`, depois de o banco confirmar.
      // A PERGUNTA É MONTADA EM UM LUGAR SÓ (`abrirPerguntaDeSobrescrita`),
      // porque os DOIS caminhos que gravam ao vivo — o celular e o leitor de
      // mesa — chegam aqui. Duas cópias divergiriam, e a que ficasse para trás
      // perguntaria sobre a bolsa errada antes de apagar a identidade dela.
      abrirPerguntaDeSobrescrita(peca, codigoDoEndereco(antes))
      // este caminho não passa por `marcarGravada`, então acende o sinal aqui
      avisarNaTela('falha')
      return
    }
    if (situacao === 'confere') {
      // já estava gravada com esta peça: marca sem regravar
      recadoNfc.value = await marcarGravada(peca.codigo)
        ? 'Esta etiqueta já estava certa. Marquei e passei para a próxima.'
        : 'Esta etiqueta já estava certa, mas não consegui marcar a peça. Encoste de novo.'
      return
    }

    // 2. GRAVAR
    recadoNfc.value = 'Gravando… não tire o celular.'
    faseDaBancada.value = 'gravando'
    await gravador.gravar(enderecoDaTag(peca.codigo))

    // 3. LER DEPOIS: a prova de que gravou é a etiqueta devolver
    const depois = await gravador.lerUmaVez()
    if (conferirLeitura(depois, peca.codigo) !== 'confere') {
      recadoNfc.value = 'Gravei, mas a etiqueta não devolveu o endereço certo. '
        + 'Não marquei a peça. Encoste de novo.'
      avisarNaTela('falha')
      return
    }

    if (travarDepois.value) await gravador.travar()
    recadoNfc.value = await marcarGravada(peca.codigo)
      ? `Peça ${rotuloDaSerie(peca, loteAtual.value)} pronta. Pegue a próxima etiqueta.`
      : `Gravei a etiqueta da peça ${rotuloDaSerie(peca, loteAtual.value)}, mas não consegui marcá-la `
        + 'como pronta. NÃO pegue outra etiqueta: encoste esta de novo.'
  } catch (erro) {
    recadoNfc.value = traduzirFalha(erro)
    avisarNaTela('falha')
  } finally {
    gravando.value = false
  }
}

// ── SOBRESCREVER UMA ETIQUETA QUE JÁ TEM OUTRA PEÇA ───────────────────────
//
// A pergunta aberta, ou null. Guarda o que foi CONTADO no momento da leitura:
// os dois códigos, a descrição de cada bolsa e se a antiga tem garantia.
const sobrescrita = ref(null)
// A decisão do dono sobre a peça ANTIGA. Ele pediu os dois caminhos: 'fila' é o
// caso normal (etiqueta gravada que ficou de lado antes de costurar) e 'baixa' é
// a peça que não vira bolsa. Nasce em 'fila' porque é o caso comum.
const destinoDaAntiga = ref('fila')
// No destino 'baixa' isto guarda uma CHAVE de MOTIVOS_DE_BAIXA; no 'fila', o
// texto livre que a garantia exige. Trocar de destino limpa o campo, senão a
// chave 'extraviada' viraria o "motivo escrito" de uma peça que voltou à fila.
const motivoDaSobrescrita = ref('')
const erroDaSobrescrita = ref('')

watch(destinoDaAntiga, () => { motivoDaSobrescrita.value = '' })

const motivoDaSobrescritaObrigatorio = computed(() => motivoObrigatorio({
  temGarantia: sobrescrita.value?.temGarantia, destino: destinoDaAntiga.value,
}))

// ABRIR A PERGUNTA DE SOBRESCREVER — a MESMA para os dois caminhos que gravam
// ao vivo. Ela guarda o que foi CONTADO no momento da leitura: os dois códigos,
// a descrição de cada bolsa e se a antiga tem garantia.
//
// A pergunta diz QUAL BOLSA vai perder a identidade — modelo, cor e número na
// série, não só o código: "K7M4X9QP2R" não é bolsa nenhuma.
function abrirPerguntaDeSobrescrita(peca, codigoAntigo) {
  const antiga = pecas.value.find((pa) => pa.codigo === codigoAntigo) || null
  sobrescrita.value = {
    codigoAntigo,
    codigoNovo: peca.codigo,
    // a peça antiga pode não estar nesta tela (lote excluído, banco de outro
    // ambiente): `descricaoDaPeca` diz isso em vez de inventar modelo
    descricaoAntiga: descricaoDaPeca(antiga || { codigo: codigoAntigo },
      antiga ? loteDaPeca(antiga.lote_id) : null),
    descricaoNova: descricaoDaPeca(peca, loteAtual.value),
    temGarantia: temGarantia(codigoAntigo),
  }
  destinoDaAntiga.value = 'fila'
  motivoDaSobrescrita.value = ''
  erroDaSobrescrita.value = ''
  recadoNfc.value = 'PARE: esta etiqueta já tem OUTRA peça gravada. '
    + 'Escolha abaixo o que fazer com ela antes de gravar por cima.'
  // ⚠️ A PERGUNTA NASCE ONDE A PESSOA JÁ ESTÁ OLHANDO. Ela é a mais perigosa da
  // ferramenta — dois seletores, o aviso de garantia de cliente e um motivo
  // obrigatório — e apaga a identidade de uma bolsa. Enquanto havia "modo
  // bancada" ela tirava a tela do modo, porque não cabia num painel de máquina;
  // agora a bancada É a aba, e a pergunta é desenhada dentro dela, na largura
  // inteira, com o botão de gravar fora de cena. Continua sendo UMA pergunta só,
  // escrita num lugar só: duas cópias divergiriam, e a que ficasse para trás
  // gravaria por cima de uma bolsa que já tem dono.
}

function desistirDaSobrescrita() {
  sobrescrita.value = null
  motivoDaSobrescrita.value = ''
  erroDaSobrescrita.value = ''
  recadoNfc.value = 'Não sobrescrevi nada. Separe esta etiqueta e pegue uma em branco.'
}

// ⚠️ A ORDEM AQUI É A REGRA INTEIRA: O BANCO PRIMEIRO, A ETIQUETA DEPOIS.
//
// Gravando primeiro e registrando depois, uma falha na segunda metade — rede
// caindo, aba fechada, token expirando — deixaria a peça ANTIGA marcada como
// gravada com a etiqueta que acabou de ser reciclada, e a NOVA sem marca
// nenhuma: duas bolsas com a mesma identidade. Nesta ordem, o pior caso é a
// etiqueta ficar com o endereço velho e o banco já dizer a verdade nova — e isso
// a tela CONTA, com o caminho do conserto escrito.
//
// A troca inteira é UMA chamada só (`vessel_sobrescrever_etiqueta`), e não duas
// da tela, porque entre "desmarcar a antiga" e "marcar a nova" haveria uma
// janela. O corpo de uma função plpgsql é uma transação só.
async function sobrescreverEtiqueta() {
  const pedido = sobrescrita.value
  if (!pedido || gravando.value) return
  erroDaSobrescrita.value = ''

  const destino = destinoDaAntiga.value
  const motivo = motivoDaSobrescrita.value.trim()
  // A TELA COBRA ANTES DO BANCO, pelo mesmo motivo da aba Etiquetas: o banco
  // recusaria com `motivo_obrigatorio`/`motivo_invalido`, mas só depois de a
  // pessoa esperar a rede por um campo que estava na tela o tempo todo.
  if (motivoObrigatorio({ temGarantia: pedido.temGarantia, destino }) && !motivo) {
    erroDaSobrescrita.value = destino === 'baixa'
      ? 'Escolha o motivo da baixa da peça antiga: sem ele o banco não aceita a baixa.'
      : fraseDaRecusa('motivo_obrigatorio')
    return
  }

  // NO MODO DO LEITOR DE MESA quem escreve é o programa da janela, e o navegador
  // não precisa saber gravar NFC. Sem esta condição a sobrescrita no computador
  // desistia AQUI, calada, com a pergunta ainda na tela e a pessoa esperando.
  const gravador = gravaPorMesa.value ? null : criarGravador()
  if (!gravaPorMesa.value && !gravador) { gravaPorNfc.value = false; return }

  gravando.value = true
  // A recarga no fim só acontece se o BANCO tiver mudado. Recarregando sempre,
  // uma recusa (que não mudou nada) dispararia uma leitura que pode falhar — e
  // `carregar()` pinta a tela inteira de erro, levando junto a frase da recusa
  // que a pessoa precisa ler.
  let oBancoMudou = false
  try {
    // 1. O BANCO. Nada foi tocado na etiqueta ainda.
    const { data, error } = await sbClient.rpc('vessel_sobrescrever_etiqueta', {
      p_codigo_antigo: pedido.codigoAntigo,
      p_codigo_novo: pedido.codigoNovo,
      p_destino: destino,
      // motivo em branco vai NULO, como o banco entende (`nullif(trim(...), '')`)
      p_motivo: motivo || null,
    })
    if (error) {
      erroDaSobrescrita.value = 'Não consegui registrar a troca agora. '
        + 'NADA foi gravado na etiqueta — ela continua com a peça antiga. Tente de novo.'
      avisarNaTela('falha')
      return
    }
    if (!data?.ok) {
      erroDaSobrescrita.value = fraseDaRecusa(data?.motivo, data)
      avisarNaTela('falha')
      return
    }

    // 2. SÓ AGORA A ETIQUETA. A pergunta sai da tela: o que ela perguntava já
    // foi decidido, e o banco já mudou.
    oBancoMudou = true
    const eraDeCliente = data.tinha_garantia
    sobrescrita.value = null
    if (gravaPorMesa.value) {
      // O CAMINHO DO LEITOR DE MESA. `escreverEConferir` lê a etiqueta antes de
      // montar o plano — de novo, e é preciso: entre o clique e agora a pessoa
      // pôs a etiqueta no leitor, e pode ser OUTRA. Ele já lê de volta e confere.
      recadoNfc.value = 'Registrado. Ponha a MESMA etiqueta no leitor e segure parada…'
      const porta = criarGravadorDeMesa()
      let escrita = { ok: false, frase: 'O programa do gravador de mesa saiu do ar.' }
      if (porta) {
        try {
          await porta.conectar()
          escrita = await escreverEConferir({ porta, endereco: enderecoDaTag(pedido.codigoNovo) })
        } catch (erro) {
          escrita = { ok: false, frase: traduzirFalhaDoLeitorDeMesa(erro) }
        } finally {
          await porta.desconectar()
        }
      }
      if (!escrita.ok) {
        recadoNfc.value = `${escrita.frase} ${avisoDeMeiaSobrescrita(pedido)}`
        avisarNaTela('falha')
        return
      }
    } else {
      recadoNfc.value = 'Registrado. Encoste a MESMA etiqueta de novo e segure parado…'
      await gravador.gravar(enderecoDaTag(pedido.codigoNovo))

      // 3. LER DEPOIS: a prova de que gravou é a etiqueta devolver
      const depois = await gravador.lerUmaVez()
      if (conferirLeitura(depois, pedido.codigoNovo) !== 'confere') {
        recadoNfc.value = avisoDeMeiaSobrescrita(pedido)
        avisarNaTela('falha')
        return
      }
      if (travarDepois.value) await gravador.travar()
    }

    recadoNfc.value = `Etiqueta sobrescrita. Agora ela é ${pedido.descricaoNova}.`
      + (destino === 'baixa'
        ? ` A peça antiga saiu da fila, baixada como ${rotuloDoMotivo(motivo)}.`
        : ' A peça antiga voltou para a fila e espera outra etiqueta.')
    avisarNaTela('ok')
    if (eraDeCliente) {
      avisoDaGarantia.value = `A peça ${pedido.codigoAntigo} tinha garantia registrada por uma `
        + 'cliente. A garantia CONTINUA VALENDO no código dela — nada foi apagado do lado da '
        + 'cliente. O que mudou é que a etiqueta dela foi reciclada, e a ação ficou na trilha.'
      adminToast('Etiqueta sobrescrita. Havia garantia de cliente — leia o aviso na aba Etiquetas.')
    }
  } catch (erro) {
    // Falha do chip DEPOIS de o banco já ter registrado: a tela não pode dizer
    // "tente de novo" e ficar por isso, porque o banco já mudou.
    recadoNfc.value = `${traduzirFalha(erro)} ${avisoDeMeiaSobrescrita(pedido)}`
    avisarNaTela('falha')
  } finally {
    gravando.value = false
    // a lista tem de refletir o que o banco fez — inclusive quando a etiqueta
    // falhou DEPOIS de o registro entrar, que é o caso que a tela precisa contar
    if (oBancoMudou) await carregar()
  }
}

// O RECADO DA METADE QUE FALTOU. A troca ficou registrada e a etiqueta não. A
// tela nunca mente: ela diz exatamente o que sobrou e por onde se conserta.
function avisoDeMeiaSobrescrita(pedido) {
  return `A TROCA JÁ FOI REGISTRADA, mas a etiqueta NÃO recebeu o endereço novo: `
    + `ela ainda abre a peça ${pedido.codigoAntigo}. No sistema, ${pedido.descricaoNova} `
    + 'já consta como gravada. Para consertar: vá à aba Etiquetas, apague a gravação dessa '
    + 'peça — ela volta para a fila — e grave esta MESMA etiqueta de novo.'
}

// ── O GRAVADOR DE MESA: só a volta ─────────────────────────────────────────
//
// ⚠️ A IDA ACABOU EM 02/09/2026. `baixarListaDoGravador` escrevia um .txt com
// os endereços que faltavam, para alimentar a máquina — e ela nasceu quando não
// existia programa de gravação nenhum. Hoje há três caminhos melhores ("Por
// onde gravar", na aba Gravar) e a lista em arquivo já existe COMPLETA logo
// aqui embaixo, em `baixarListaDoLote`, que a aba Lotes oferece como "Baixar a
// lista inteira" e sai com todas as peças, o estado e o endereço de cada uma.
// Duas listas para o mesmo dedo era uma a mais.
//
// `listaParaGravadorDeMesa`, em `nfc-fila.js`, CONTINUA LÁ com os testes dela.
// Está sem chamador de propósito, e não por esquecimento: ela é a única cópia
// da regra "a fila do que falta são as não gravadas e não baixadas", e quem for
// apagá-la tem de apagar os testes junto — de propósito, não de passagem.

// A LISTA INTEIRA DO LOTE, para arquivar junto da ordem de produção. Ela é
// também, desde 02/09/2026, o ÚNICO caminho para ter os endereços em arquivo:
// sai com TODAS as peças, e não só com a fila do que falta.
function baixarListaDoLote(l) {
  const doLote = pecasDoLote(l.id)
  if (!doLote.length) { adminToast('Este lote não tem peça nenhuma', false); return }
  // A REFERÊNCIA DO LOTE VAI JUNTO: é dela que sai o número de série de cada
  // peça, e é por ele que se procura a bolsa depois de arquivada a ordem.
  const csv = linhasDaListaDoLote(doLote, { formatarData: dataCurta, sku: l.sku })
  // BOM na frente: sem ele o Excel abre "Mônaco" como "MÃ´naco"
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // A DATA DE FABRICAÇÃO VAI NO NOME porque dois lotes do MESMO modelo baixavam
  // com o mesmo nome, e o segundo virava "(1)" na pasta de Downloads — ou pior,
  // substituía o primeiro. O arquivo é o registro de qual link foi para qual
  // bolsa: nome repetido aqui é registro de produção perdido.
  a.download = `lote-${l.modelo || 'sem-modelo'}-${l.fabricado_em || 'sem-data'}-completo.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// A PLANILHA DOS NÚMEROS DE SÉRIE ATIVOS (aba Etiquetas).
//
// ⚠️ SAI EM .XLSX, NÃO EM CSV, e isso é decisão de 07/09/2026: o dono disse que
// "o CSV está dando muito problema". Num CSV o Excel come o zero da frente de
// `00011001`, transforma o WhatsApp em notação científica e, em máquina em
// português, nem separa as colunas direito. No .xlsx cada célula vai declarada
// como TEXTO e chega inteira. Ver `compartilhado/planilha-xlsx.js`.
const numerosAtivos = computed(() => linhasDosNumerosAtivos(etiquetasFiltradas.value, {
  loteDaPeca, comGarantia: comGarantia.value, formatarData: dataCurta,
}).slice(1))

function baixarNumerosAtivos() {
  const linhas = linhasDosNumerosAtivos(etiquetasFiltradas.value, {
    loteDaPeca, comGarantia: comGarantia.value, formatarData: dataCurta,
  })
  if (linhas.length <= 1) { adminToast('Não há número de série ativo neste recorte', false); return }
  const bytes = planilhaXlsx(linhas, { nomeDaAba: 'Numeros de serie' })
  const blob = new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  // A DATA VAI NO NOME: esta lista muda todo dia, e dois arquivos com o mesmo
  // nome na pasta de Downloads viram "(1)" — ou pior, um substitui o outro, e
  // ninguém sabe qual foto do estoque está olhando.
  a.download = `numeros-de-serie-ativos-${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

// ESTE É O ÚNICO CAMINHO QUE MARCA PEÇA SEM CONFERIR ETIQUETA NENHUMA.
// `codigosNoTextoDoGravador` aceita qualquer texto que contenha os códigos —
// colar de volta o próprio arquivo que acabou de ser baixado marcaria o lote
// inteiro num clique, sem nenhuma etiqueta ter sido tocada. Por isso passa por
// uma pergunta que diz o número e diz o que NÃO foi conferido.
function pedirParaMarcarPeloGravador() {
  const { reconhecidos, ignorados } = codigosNoTextoDoGravador(
    textoDoGravador.value, pecasDeMarcarEmBloco.value)
  if (!reconhecidos.length) {
    adminToast(`Não achei nenhum código ${loteDaEtiqueta.value ? 'deste lote' : 'da ferramenta'} `
      + 'no texto colado', false)
    return
  }
  // guarda o que foi contado: é exatamente isso que a pergunta promete marcar,
  // mesmo que alguém mexa na caixa de colar antes de responder
  confirmacaoDoGravador.value = { reconhecidos, ignorados }
}

async function marcarPeloGravador() {
  const pedido = confirmacaoDoGravador.value
  if (!pedido) return
  const { reconhecidos, ignorados } = pedido
  confirmacaoDoGravador.value = null
  // `sbClient.rpc` NÃO estoura: devolve `{ data, error }`. Sem contar o que deu
  // certo, um bloco inteiro barrado pela permissão sairia com o aviso de
  // "marcadas" — e a tela nunca mente (PADRAO-DA-CENTRAL, item 9).
  let feitas = 0
  for (const codigo of reconhecidos) {
    const { data, error } = await sbClient.rpc('vessel_marcar_gravada', { p_codigo: codigo })
    if (!error && data?.ok) feitas += 1
  }
  // Aqui recarregar É certo: veio um bloco inteiro de uma vez. No caminho de
  // uma etiqueta por vez, `marcarGravada` atualiza SÓ a peça de propósito —
  // recarga inteira a cada etiqueta trava o ritmo de quem está gravando em
  // sequência.
  await carregar()
  textoDoGravador.value = ''
  if (feitas < reconhecidos.length) {
    adminToast(`Marquei ${feitas} de ${reconhecidos.length}. As outras não deram certo `
      + '— confira sua permissão e tente de novo.', false)
    return
  }
  // O AVISO DIZ O QUE OS IGNORADOS SÃO, e isso depende do recorte: com um lote
  // escolhido eles são códigos de OUTRO lote (normalmente o arquivo errado);
  // com "Todos os lotes" eles não são de peça nenhuma da ferramenta, que é
  // outra história e pede outra conferência. Uma frase só para os dois casos
  // mandaria a pessoa procurar o defeito no lugar errado.
  adminToast(ignorados.length
    ? `${reconhecidos.length} marcadas. ${ignorados.length} código(s) ${loteDaEtiqueta.value
      ? 'de OUTRO lote foram ignorados — confira se o arquivo é deste lote.'
      : 'não constam em peça nenhuma e foram ignorados — confira se o arquivo é desta ferramenta.'}`
    : `${reconhecidos.length} etiqueta(s) marcadas como gravadas.`)
}

function baixarPlanilha() {
  const csv = linhasDoCsv(registrosFiltrados.value)
  // BOM na frente: sem ele o Excel abre "Mônaco" como "MÃ´naco"
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'garantias-vessel.csv'
  a.click()
  URL.revokeObjectURL(url)
}

onMounted(() => {
  carregar()
  // só na primeira visita de quem grava — e nunca se o depósito estiver
  // bloqueado, porque aí `guiaJaVisto` devolve falso para sempre e o guia
  // voltaria a cada abertura, virando estorvo.
  if (podeEditar.value && !guiaJaVisto()) guiaAberto.value = true
  // A prévia do cartão fala por `postMessage` quando não consegue desenhar.
  window.addEventListener('message', ouvirAPrevia)
})

// ⚠️ E O OUVINTE SAI JUNTO COM A TELA. Sem isto ele fica pendurado em `window`
// depois de a pessoa voltar para a Gestão Interna, e cada visita à ferramenta
// pendura mais um — todos escrevendo num `erroDaPrevia` que não existe mais.
onUnmounted(() => window.removeEventListener('message', ouvirAPrevia))
</script>

<style scoped>
/* ══════════════════════════════════════════════════════════════════════════
   O TAMANHO DE TEXTO SAI DA ESCALA, NUNCA DE UM NÚMERO ESCRITO À MÃO
   ══════════════════════════════════════════════════════════════════════════
   Esta tela tinha QUINZE tamanhos distintos — 10 · 11 · 12 · 12,5 · 13 · 13,5 ·
   14 · 15 · 16 · 17 · 19 · 26px, mais os três do modo bancada. Doze deles entre
   10 e 26 pixels, vários separados por MEIO PIXEL. O dono reclamou dela quatro
   vezes; numa delas, com estas palavras: "vários tamanhos de fonte, uma bosta,
   confuso". Meio pixel de diferença o olho não lê como hierarquia: lê como
   bagunça.

   Agora são CINCO degraus, e eles moram em `src/estilos/estilos-globais.css`
   junto dos outros tokens — não aqui, porque escala de uma tela só é como se
   chega a quinze tamanhos:

     --texto-etiqueta (11px)  rótulo em maiúsculas, cabeçalho de coluna, botão
     --texto-corpo    (13px)  o texto comum: parágrafo, linha de lista, célula
     --texto-campo    (16px)  campo de formulário, e o que se lê de pé
     --texto-titulo   (20px)  título de caixa, e o endereço que se confere
     --texto-numero   (32px)  o número da peça na bancada

   `--texto-campo` NUNCA desce de 16px: abaixo disso o iOS dá zoom ao focar e a
   tela salta na cara de quem digita (PADRAO-DA-CENTRAL, item 6).

   NENHUMA regra deste arquivo escreve `font-size` de outro jeito, e há teste
   que reprova número solto (`escala-de-texto.test.mjs`). Precisa de um degrau
   que não existe? Ele entra na escala, em globais, com o motivo escrito — não
   aqui, e nunca "só desta vez".

   ══════════════════════════════════════════════════════════════════════════
   A ORDEM DESTE ARQUIVO, e ela não é gosto
   ══════════════════════════════════════════════════════════════════════════
     1. as regras-base (celular primeiro)
     2. `@media (min-width:900px)` — a tela grande
     3. `@media (max-width:520px)` — os ajustes de celular, POR ÚLTIMO
   Duas regras de mesma especificidade: ganha a última. Uma regra-base escrita
   depois do `@media` de celular o apaga em silêncio — sem erro, sem aviso, e só
   se vê no aparelho. Há três testes que travam esta ordem. */
.tela-autenticidade{min-height:100vh;background:transparent;position:relative;z-index:1;padding-bottom:48px;}

/* ── O MENU DE ABAS ────────────────────────────────────────────────────────
   AQUI NÃO HÁ REGRA DE `.abas` NENHUMA, E É DE PROPÓSITO.
   A barra é a `.abas` GLOBAL de `estilos-globais.css` — a mesma da Frota, do
   Patrimônio e dos Acessos: mesma altura, mesmo peso de fonte, mesmo
   sublinhado, e os 40px de alvo de toque que foram corrigidos para as quatro
   telas em 19/08.

   Uma entrega anterior escreveu uma barra própria aqui (`.abas-barra` com fundo
   e moldura, `flex-wrap:nowrap`, `overflow-x:auto`) e o dono viu na hora que
   esta tela tinha ficado diferente das irmãs. O `nowrap` era o que criava o
   problema que o resto dos overrides existia para consertar: a barra global
   QUEBRA em duas linhas no celular, e com isso não transborda, não rola e não
   esconde a primeira aba. Regra local aqui é o caminho de volta para aquele
   defeito.

   Os dois únicos acréscimos são coisas que a barra global não tem porque
   nenhuma tela irmã precisou: o número do passo e o separador. Nenhum dos dois
   mexe em altura, fonte ou sublinhado. */
/* O número do passo, colado no nome da aba. Herda cor, peso e tamanho do botão
   — pintá-lo de outra cor faria o "1" competir com "LOTES" pela leitura. */
.au-aba-n{margin-right:var(--sp-1);font-variant-numeric:tabular-nums;}
/* O SEPARADOR ENTRE OS PASSOS E AS CONSULTAS. Um `·` discreto, com a cor de
   texto secundário — e não uma barra desenhada, que viraria mais uma linha
   brigando com o sublinhado da aba ativa. Ele é enfeite de leitura, então sai
   da árvore de acessibilidade (`aria-hidden`) e não recebe toque. */
.au-abas-sep{flex:0 0 auto;align-self:center;padding:0 var(--sp-1);color:var(--muted);font-size:var(--texto-etiqueta);user-select:none;pointer-events:none;}

/* A AJUDA CURTA DA ABA, logo abaixo da barra. Ela fica sempre à vista nas
   quatro abas de consulta e de lista: guia único ninguém reabre.
   NA ABA GRAVAR ELA NÃO EXISTE — ali a tela é uma bancada, e quem grava a
   terceira etiqueta não lê parágrafo. O que ela dizia mora no guia, atrás do
   "?" do alto do painel. */
/* O TEXTO DO TOPO VAI ATE A BORDA, e quebra la — decisao do dono em 02/09/2026.
   Ele estava preso a 680px e quebrava no meio da tela, com metade vazia a
   direita, o que parece defeito. A linha longa e o preco: o olho se perde na
   volta em linha muito larga, e por isso texto corrido costuma ter teto. Como
   este e um paragrafo curto de tres linhas no topo, o preco e pequeno e o
   ganho — a tela nao parecer quebrada — e maior. */
.au-ajuda{font-family:var(--fonte-principal);font-size:var(--texto-corpo);color:var(--muted);line-height:1.6;padding:var(--sp-3) 24px 0;overflow-wrap:anywhere;}

.au-vazio,.au-erro,.au-pronto{font-family:var(--fonte-principal);font-size:var(--texto-corpo);color:var(--muted);padding:28px 24px;line-height:1.7;}
.au-erro{color:var(--red);}
.au-pronto{color:var(--accent);}
.au-instrucao{font-family:var(--fonte-principal);font-size:var(--texto-corpo);color:var(--muted);line-height:1.7;padding:16px 24px 0;}
.au-secao{font-family:var(--fonte-principal);font-size:var(--texto-etiqueta);font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--text);padding:24px 24px 4px;}

.au-topo-acao{display:flex;gap:10px;align-items:center;padding:18px 24px 0;flex-wrap:wrap;}
/* Medido a 375px: o campo de busca da aba Garantias saía com 37px de altura e
   13px de fonte — abaixo dos 40px de alvo de dedo e dos 16px abaixo dos quais o
   iOS dá zoom ao focar. */
.au-busca{flex:1;min-width:180px;box-sizing:border-box;min-height:40px;font-family:var(--fonte-principal);font-size:var(--texto-campo);padding:9px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);}

/* 40px DE ALTURA NA REGRA-BASE, e não em cada bloco. Ela já estava repetida em
   quatro lugares porque o botão nascia com 35,5px — medido a 375px. Cada bloco
   novo desta tela precisava lembrar de repetir, e nunca lembrava.
   Dedo não acerta menos que 40 (PADRAO item 6). */
.au-botao{font-family:var(--fonte-principal);font-size:var(--texto-etiqueta);font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--sobre-cor);background:var(--accent);border:1px solid var(--accent);border-radius:6px;padding:10px 16px;min-height:40px;box-sizing:border-box;cursor:pointer;}
.au-botao[disabled]{opacity:.6;cursor:default;}
/* O LINK DESABILITADO PRECISA PARECER DESABILITADO. O "Desfazer" das baixadas
   fica `:disabled` durante a chamada e continuava com a MESMA cara de clicável,
   sem efeito nenhum — botão desabilitado calado faz a pessoa achar que a
   ferramenta está quebrada. */
.au-link[disabled]{opacity:.6;cursor:default;}
.au-botao.secundario{color:var(--accent);background:transparent;}

.au-lista{display:flex;flex-direction:column;gap:var(--sp-4);padding:16px 24px 0;max-width:720px;}
.au-card{border:1px solid color-mix(in srgb,var(--accent) 25%,var(--border));border-radius:var(--card-radius);background:var(--surface);padding:var(--card-pad);box-shadow:var(--shadow-sm);transition:box-shadow .18s ease,border-color .18s ease;}
.au-card:hover{box-shadow:var(--shadow-md);border-color:color-mix(in srgb,var(--accent) 55%,var(--border));}
.au-card.alerta{border-color:color-mix(in srgb,var(--orange) 45%,var(--border));background:color-mix(in srgb,var(--orange) 8%,var(--surface));}
.au-card-topo{display:flex;justify-content:space-between;align-items:baseline;gap:var(--sp-3);flex-wrap:wrap;padding-bottom:var(--sp-2);border-bottom:1px solid color-mix(in srgb,var(--accent) 40%,var(--border));}
.au-modelo{font-family:var(--fonte-principal);font-size:var(--texto-titulo);font-weight:700;line-height:1.3;color:var(--text);overflow-wrap:anywhere;}
.au-progresso{font-family:var(--fonte-principal);font-size:var(--texto-corpo);color:var(--accent);white-space:nowrap;}
.au-card-linha{display:flex;gap:var(--sp-4);flex-wrap:wrap;margin-top:var(--sp-3);font-family:var(--fonte-principal);font-size:var(--texto-corpo);color:var(--muted);}
.au-ref{font-family:var(--fonte-dados);}

/* ── LER QUALQUER ETIQUETA ────────────────────────────────────────────────
   O bloco é o primeiro da aba e é uma FERRAMENTA, não um item de lista: um fio
   de cor na lateral o separa dos cards de dado que vêm abaixo, sem inventar
   fundo novo. Cor sai de token misturado com a superfície, para os dois temas
   se cuidarem sozinhos (PADRÃO item 2). */
/* ── LER UMA ETIQUETA: O MODAL ─────────────────────────────────────────────
   A primeira versão era um painel aberto na aba, e o dono reprovou: ocupava a
   tela para uma ação rápida e rara, e brigava com a lista, que é o assunto da
   aba. Agora é um botão e um modal — e o modal é o `.au-fundo`/`.au-folha` que
   esta tela já tinha, com as regras do PADRÃO item 4 já resolvidas dentro dele
   (dvh, o par touch-action/overscroll, fechar no fundo, alvo de 40px).

   O RECUO DE 24px é o mesmo do `.au-folha-topo`: dentro da folha, quem tem
   recuo próprio é cada bloco, porque a folha rola e o cabeçalho não. */
.au-leitura-corpo{
  display:flex; flex-direction:column; align-items:center;
  gap:var(--sp-2); padding:var(--sp-5) 24px 0; text-align:center;
}
.au-leitura-aneis{width:120px; flex:none}
.au-leitura-titulo, .au-leitura-detalhe{margin:0; max-width:34ch}
.au-leitura-achado{padding:var(--sp-4) 24px 0}
.au-leitura-achado .au-modelo{display:block}
.au-link{margin-top:10px;font-family:var(--fonte-principal);font-size:var(--texto-corpo);font-weight:600;color:var(--accent);background:none;border:none;padding:0;cursor:pointer;text-align:left;overflow-wrap:anywhere;}

.au-campo{display:block;padding:16px 24px 0;max-width:520px;}
.au-rot{display:block;font-family:var(--fonte-principal);font-size:var(--texto-etiqueta);font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);margin-bottom:6px;}
.au-campo input,.au-campo select{width:100%;box-sizing:border-box;min-height:40px;font-family:var(--fonte-principal);font-size:var(--texto-campo);padding:9px 12px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--text);}

.au-acoes{display:flex;gap:10px;padding:16px 24px 0;flex-wrap:wrap;}

/* O endereço é o que a pessoa vai conferir letra por letra na hora de gravar:
   fonte de dados, tamanho de título e quebra garantida em tela de celular. */
.au-endereco{font-family:var(--fonte-dados);font-size:var(--texto-titulo);line-height:1.6;color:var(--text);background:var(--surface);border:1px solid var(--accent);border-radius:8px;padding:16px;word-break:break-all;user-select:all;}
/* O alvo do dedo é a linha inteira, não o quadradinho: min-height 40px. */
.au-trava{display:flex;gap:8px;align-items:center;min-height:40px;font-family:var(--fonte-principal);font-size:var(--texto-corpo);line-height:1.5;color:var(--text);cursor:pointer;}
.au-trava input{width:20px;height:20px;flex-shrink:0;}

/* `display:flex` no <summary> APAGA o triângulo que o Chrome desenha sozinho, e
   sem ele nada dizia que a gaveta abre. O marcador nativo sai de cena nos dois
   motores (`list-style` no padrão, `::-webkit-details-marker` no WebKit velho) e
   a seta vira o SVG do template, que gira ao abrir e existe igual em todo
   navegador. */
/* ⚠️ ESTAS TRÊS REGRAS ERAM `.au-mesa`, E VIRARAM `.au-mais` EM 02/09/2026.
   `au-mesa` era o resto do nome do bloco "gravador de mesa", que já tinha virado
   a gaveta genérica das ações raras — e nesta entrega o gravador de mesa saiu de
   lá de vez. Classe cujo nome não diz mais o que ela faz é a que alguém
   "conserta" errado depois. `.au-mais` é a gaveta, e agora são DUAS na
   ferramenta: "Mais opções deste lote", na aba Gravar, e "Marcar várias de uma
   vez", na aba Etiquetas — as duas com o mesmo desenho, pela mesma regra.
   `display:flex` no <summary> apaga o marcador nativo nos dois motores, e a
   seta vira o SVG do template. 40px de alvo. */
.au-mais summary{display:flex;align-items:center;gap:8px;min-height:40px;cursor:pointer;font-family:var(--fonte-principal);font-size:var(--texto-corpo);font-weight:600;color:var(--text);list-style:none;}
.au-mais summary::-webkit-details-marker{display:none;}
.au-seta{flex-shrink:0;color:var(--accent);transition:transform .15s;}
.au-mais[open] > summary .au-seta{transform:rotate(90deg);}
/* 16px no campo não é estética: abaixo disso o iOS dá zoom ao focar e a tela
   salta na cara de quem está digitando. */
.au-colar{display:block;width:100%;min-height:90px;margin:10px 0;box-sizing:border-box;font-family:var(--fonte-principal);font-size:var(--texto-campo);line-height:1.5;padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface);color:var(--text);}

/* Bloco de aviso pelo desenho do PADRAO-DA-CENTRAL: a cor é o sinal, o texto é
   para ler — por isso o `--text` e não o `--orange` na letra. */
/* ── A FILA DE GARANTIAS ──────────────────────────────────────────────────
   Ela fica no TOPO da aba e é a única coisa desta tela que espera por uma
   pessoa. O filete embaixo a separa da lista de consulta que vem depois —
   sem ele, as duas viram uma lista só e a fila deixa de ser uma fila. */
.au-fila-garantias{padding-bottom:var(--sp-4);margin-bottom:var(--sp-4);
  border-bottom:1px solid var(--border);}
.au-fila-titulo{margin:0 0 var(--sp-2);font-family:var(--fonte-principal);
  font-size:var(--texto-titulo);font-weight:600;color:var(--text);}

/* "Como conferir" nasce FECHADO de propósito: quem já sabe o caminho não
   precisa dele ocupando altura em cada cartão da fila, e quem não sabe abre
   uma vez e aprende. */
.au-como-conferir{margin-top:var(--sp-2);}
.au-como-conferir summary{font-family:var(--fonte-principal);font-size:var(--texto-corpo);
  color:var(--accent-forte);cursor:pointer;padding:var(--sp-1) 0;
  /* 44px de alvo: o PADRAO manda, e aqui é um `summary`, que nasce sem altura. */
  min-height:44px;display:flex;align-items:center;}
.au-como-conferir ul{margin:0;padding:0 0 0 var(--sp-4);}
.au-como-conferir li{font-family:var(--fonte-principal);font-size:var(--texto-corpo);
  line-height:1.55;color:var(--text-muted);margin-bottom:var(--sp-1);}

.au-confirma{margin-top:10px;padding:12px 14px;border-radius:var(--radius-md);background:color-mix(in srgb, var(--orange) 10%, var(--surface));border:1px solid color-mix(in srgb, var(--orange) 38%, var(--surface));}
.au-confirma-texto{font-family:var(--fonte-principal);font-size:var(--texto-campo);line-height:1.5;color:var(--text);overflow-wrap:anywhere;}
.au-confirma .au-acoes{padding:12px 0 0;}
/* O recuo lateral já vem do bloco: sem isto o seletor de motivo sai 24px mais
   para dentro que o resto da caixa. */
.au-confirma .au-campo{padding:var(--sp-2) 0 0; max-width:none}
/* O "Cancelar"/"Não sobrescrever" destas caixas mede 4,46 de contraste no tema
   escuro com o `--accent` puro — reprova por pouco, e "por pouco" continua
   sendo reprovado. `--accent-forte` é o par que o PADRAO manda usar para cor
   sobre o próprio tom aguado, e ele já vem medido. Medido aqui: 4,46 → 6,3 no
   escuro, 5,87 → 9,0 no claro. Vale para as CINCO perguntas desta tela. */
.au-confirma .au-botao.secundario{color:var(--accent-forte)}
/* O campo de senha não mora dentro de um `.au-campo`, então a regra-base dos
   campos não o alcança. 40px de altura porque dedo não acerta menos que isso, e
   `--texto-campo` porque abaixo de 16px o iOS dá zoom ao focar. */
.au-confirma input{min-height:40px; box-sizing:border-box; font-size:var(--texto-campo)}
.au-aviso-menor{
  margin:var(--sp-2) 0 0; font-family:var(--fonte-principal);
  font-size:var(--texto-corpo);
  line-height:1.45; color:var(--muted); overflow-wrap:anywhere;
}
/* A RECUSA DA SENHA. Segue o desenho de aviso do PADRAO-DA-CENTRAL: a cor é o
   SINAL, o texto fica em `--text` para ser lido. O `--red` como letra sobre o
   fundo desta caixa mede 4,50 no tema escuro — passa raspando, e "por pouco"
   continua sendo por pouco. */
.au-recusa{
  margin:var(--sp-2) 0 0; padding:var(--sp-2) var(--sp-3);
  border-radius:var(--radius-md);
  background:color-mix(in srgb, var(--red) 12%, var(--surface));
  border:1px solid color-mix(in srgb, var(--red) 38%, var(--surface));
  color:var(--text); font-family:var(--fonte-principal);
  font-size:var(--texto-corpo);
  line-height:1.45; overflow-wrap:anywhere;
}
/* O aviso da garantia é o único `.au-confirma` que vive solto na tela, e não
   dentro de um cartão: ele carrega o próprio recuo. */
.au-aviso-garantia{margin:var(--sp-4) 24px 0; max-width:620px}

/* O AVISO DE NÚMERO DE SÉRIE AMBÍGUO. Ele REAPROVEITA `.au-confirma`, que já é o
   desenho de aviso desta tela (cor de sinal misturada à superfície, texto em
   `--text` para se ler — PADRÃO item 2). O que ele acrescenta é só o recuo:
   ele é vizinho de `.au-campo`, que traz 24px de cada lado, e um bloco com borda
   colado na margem da folha ficaria 24px mais largo que os campos acima dele.
   MARGEM, e não `padding`: a borda tem de recuar junto, senão a caixa encosta
   na beirada e só o texto de dentro respeita o alinhamento. */
.au-aviso-serie{margin:var(--sp-2) 24px 0; max-width:520px}
/* Dentro da edição o recuo lateral já vem do bloco, como nos campos de lá. */
.au-aviso-serie-edicao{margin-left:0; margin-right:0; max-width:none}

/* ── EDITAR E EXCLUIR O LOTE ───────────────────────────────────────────────
   A pergunta de excluir REAPROVEITA `.au-confirma`, o bloco de aviso que esta
   tela já tem. */
.au-lote-acoes{display:flex; gap:var(--sp-3); margin-top:var(--sp-2); flex-wrap:wrap}
/* O link nasce com 13px de altura. Alvo de dedo abaixo de 40px é defeito
   (PADRAO item 6) — cresce a área, o texto continua link. */
.au-lote-acoes .au-link{display:inline-flex; align-items:center; min-height:40px; margin-top:0}
.au-edicao{
  margin-top:var(--sp-2); padding:var(--sp-3);
  border:1px solid var(--border); border-radius:var(--radius-md);
  background:var(--surface2);
}
/* O recuo lateral já vem do bloco. Sem isto os campos saem 24px mais para
   dentro que o resto do cartão. */
.au-edicao .au-campo{padding:var(--sp-2) 0 0; max-width:none}
.au-edicao .au-acoes{padding:var(--sp-3) 0 0}
/* Os botões destes dois blocos vivem dentro do cartão do lote; sem isto saem
   com 35,5px de altura. */
.au-card .au-botao{min-height:40px; box-sizing:border-box}
/* O link nasce com 13px de altura, e este é apertado com o celular na mão. */
.au-baixar{display:inline-flex; align-items:center; min-height:40px}
/* "Dar baixa" e "Excluir esta peça" ficam lado a lado, e empilham a 375px em
   vez de encolher: alvo de dedo abaixo de 40px é defeito (PADRAO item 6). */
.au-peca-acoes{display:flex; gap:var(--sp-3); flex-wrap:wrap}

/* ── A LISTA DAS BAIXADAS ────────────────────────────────────────────────── */
.au-baixadas{list-style:none; margin:var(--sp-2) 0 0; padding:0}
.au-baixadas li{
  display:flex; justify-content:space-between; align-items:center;
  gap:var(--sp-2); padding:var(--sp-1) 0;
  font-family:var(--fonte-principal); color:var(--text);
  font-size:var(--texto-campo);
  overflow-wrap:anywhere;
  border-bottom:1px solid var(--border);
}
/* Mesma história do `.au-baixar`: o "Desfazer" precisa de 40px de área de dedo,
   e o `margin-top` do `.au-link` o desalinharia da linha. */
.au-baixadas .au-link{min-height:40px; display:inline-flex; align-items:center; margin-top:0; flex:none}

/* ── A BUSCA DE PRODUTO NO BLING ───────────────────────────────────────────
   Alvo de toque de 40px: quem cria lote pode estar no celular, e o resultado da
   busca é uma lista de alvos pequenos por natureza. */
.au-escolha-produto{
  margin-bottom:var(--sp-4); padding-bottom:var(--sp-3);
  border-bottom:1px solid var(--border);
}
/* O RECUO LATERAL DE CADA FILHO É POR CONTA DELE: a `.au-folha` tem
   `padding:22px 0`, e quem não pede recuo encosta na borda da caixa. */
.au-escolha-produto > .au-aviso-menor{padding-left:24px; padding-right:24px}
.au-produtos{list-style:none; margin:var(--sp-2) 0 0; padding:0 16px; max-height:240px; overflow-y:auto}
.au-produtos li + li{border-top:1px solid var(--border)}
.au-produto{
  display:flex; flex-direction:column; gap:2px; width:100%;
  min-height:44px; padding:var(--sp-2); text-align:left;
  background:none; border:0; cursor:pointer; color:var(--text); font:inherit;
}
.au-produto:hover, .au-produto:focus-visible{background:var(--surface2)}
.au-produto strong{font-size:var(--texto-campo); font-weight:600; line-height:1.3}

/* ── AS PEÇAS DE UM LOTE ───────────────────────────────────────────────────
   O bloco reaproveita `.selo` das classes prontas — estado com cor inventada é o
   que o padrão proíbe, e o selo já vem com contraste medido nos dois temas. */
.au-pecas{
  margin-top:var(--sp-3); padding:var(--sp-3);
  border:1px solid var(--border); border-radius:var(--radius-md);
  background:var(--surface2);
}
.au-pecas-topo{
  display:flex; align-items:center; justify-content:space-between;
  gap:var(--sp-3); flex-wrap:wrap;
}
.au-pecas-conta{
  font-family:var(--fonte-principal);
  font-size:var(--texto-corpo);
  color:var(--muted); overflow-wrap:anywhere;
}
/* A LISTA ROLA DENTRO DA PRÓPRIA CAIXA. Um lote pode ter 500 peças: sem esta
   altura, abrir um lote empurraria os outros lotes para 50 telas abaixo e o
   cartão viraria a página inteira. `dvh` e nunca `vh` — no celular o `vh` é
   calculado com a barra de endereço escondida, e o fim fica atrás dela. */
.au-pecas-lista{
  list-style:none; margin:var(--sp-3) 0 0; padding:0;
  max-height:60dvh; overflow-y:auto; overscroll-behavior:contain;
}
.au-peca{padding:var(--sp-2) 0; border-bottom:1px solid var(--border)}
.au-peca:last-child{border-bottom:0}
.au-peca-topo{display:flex; align-items:center; gap:var(--sp-2); flex-wrap:wrap}
.au-peca-n{
  font-family:var(--fonte-principal); font-weight:700;
  font-size:var(--texto-corpo);
  color:var(--text); white-space:nowrap;
}
.au-peca-cod{
  font-size:var(--texto-corpo);
  color:var(--text); overflow-wrap:anywhere;
}
.au-peca-estado{
  margin:var(--sp-1) 0 0; font-family:var(--fonte-principal);
  font-size:var(--texto-corpo);
  color:var(--muted); line-height:1.45; overflow-wrap:anywhere;
}
/* O endereço é o que se confere letra por letra na hora de costurar: fonte de
   dados e quebra garantida. */
.au-peca-end{
  margin-top:var(--sp-1); font-family:var(--fonte-dados);
  font-size:var(--texto-corpo);
  line-height:1.5; color:var(--text); word-break:break-all; user-select:all;
}
.au-peca-links{display:flex; gap:var(--sp-3); flex-wrap:wrap}
/* Alvo de dedo de 40px sem virar botão: cresce a área, o texto continua link
   (PADRAO item 6). O `text-decoration` existe porque um deles é `<a>`. */
.au-peca-botao{
  display:inline-flex; align-items:center; min-height:40px; margin-top:0;
  text-decoration:none;
}
.au-pecas > .au-botao{margin-top:var(--sp-3)}
/* A AÇÃO PRINCIPAL DO CARTÃO. Ela era um `.au-link` com 13px de altura — alvo de
   dedo abaixo de 40px é defeito (PADRAO item 6) — e, pior, tinha o MESMO peso
   visual das outras três ações do cartão. Agora é o botão comum do PADRÃO: borda
   e fundo transparente, nunca cinza. */
.au-card-acao{display:inline-flex; align-items:center; margin-top:var(--sp-3)}
.au-card > .au-link{display:inline-flex; align-items:center; min-height:40px}

/* ── OS DOIS MODAIS ────────────────────────────────────────────────────────
   PADRAO item 4: fundo escurecido que fecha ao clique, `dvh` e nunca `vh`, e o
   par `touch-action`/`overscroll-behavior` nos DOIS — sem ele o dedo arrasta a
   tela para os lados por dentro do modal, e o dono já viu isso no aparelho. */
.au-fundo{
  position:fixed; inset:0; z-index:50;
  display:flex; align-items:center; justify-content:center; padding:12px;
  background:rgba(0,0,0,.55);
  touch-action:none; overscroll-behavior:contain;
}
.au-folha{
  background:var(--surface); border:1px solid var(--border);
  border-radius:var(--radius-lg);
  max-width:420px; width:100%; max-height:88dvh; overflow-y:auto; padding:22px 0;
  overscroll-behavior:contain; touch-action:pan-y;
}
.au-folha-topo{
  display:flex; align-items:flex-start; justify-content:space-between;
  gap:var(--sp-3); padding:0 24px;
}
.au-folha h2{font-family:var(--fonte-principal);font-size:var(--texto-titulo);font-weight:600;color:var(--text);overflow-wrap:anywhere;}
/* O botão de fechar tem 40px de alvo e mora no canto (PADRAO item 4). Ele é
   ícone em SVG, nunca emoji. */
.au-fechar{
  flex:none; width:40px; height:40px; display:inline-flex;
  align-items:center; justify-content:center;
  background:none; border:0; border-radius:var(--radius-md);
  color:var(--muted); cursor:pointer;
}
.au-fechar:hover, .au-fechar:focus-visible{background:var(--surface2); color:var(--text)}
.au-folha .au-erro{padding:12px 24px 0;}

/* ── O MODAL LARGO DE PRODUTOS ────────────────────────────────────────────
   ⚠️ EXCEÇÃO DELIBERADA AO PADRÃO item 4 (420px no computador), e ela vale só
   para modal cujo conteúdo é LISTA. O 420px do PADRÃO serve para modal de
   PERGUNTA — meia dúzia de campos, onde a linha curta ajuda a ler. Uma lista de
   centenas de produtos dentro de 420px, com uma caixinha de 240px rolando
   dentro dela, era um buraco de fechadura: foi a queixa do dono em 04/09/2026.

   No celular nada disto vale: o `@media` do fim do arquivo já faz TODA `.au-folha`
   ocupar a tela, que é o que se quer aqui de qualquer jeito. */
.au-folha-larga{
  /* ⚠️ `max-height`, NUNCA `height`, e a rolagem CONTINUA sendo a da folha.
     A primeira versao desta regra tinha `height` fixa e `overflow:hidden` — ela
     foi escrita para um modal cujo unico conteudo era a lista, que rolava
     sozinha. Aplicada ao FORMULARIO inteiro, prendia a altura e travava a
     rolagem: os campos de baixo (Quantidade, Finalizado em) ficariam
     inalcancaveis, e a caixa ficaria enorme e vazia num formulario curto. */
  width:80vw; max-width:80vw; max-height:88dvh;
}
.au-folha-larga > .au-campo{max-width:none}
.au-produtos-conta{padding:var(--sp-2) 24px 0; margin:0}
/* ⚠️ SÓ A LISTA ROLA, e o campo de busca fica parado em cima. Deixando a folha
   inteira rolar, a busca sumiria na primeira raspada de dedo — e quem procura
   entre centenas precisa dela sempre à mão. `min-height:0` é o que permite um
   filho de flex encolher e criar a própria rolagem. */
/* ── A MINIATURA E A LUPA ────────────────────────────────────────────────
   A foto e de 70px e vem da propria lista do Bling. O quadrinho tem tamanho
   FIXO com ou sem foto: sem isso cada linha teria uma altura, e a lista inteira
   dancaria conforme os produtos com foto entrassem e saissem da busca. */
/* ── A LINHA DA LISTA: FINA, E TUDO NUMA LINHA SÓ ────────────────────────
   A regra-base lá em cima é `flex-direction:column` — nome em cima, código
   embaixo, duas alturas por item. Aqui vira linha: foto à esquerda, nome e
   referência lado a lado, lupa à direita. */
.au-produto{
  display:flex; flex-direction:row; align-items:center;
  gap:var(--sp-3); text-align:left; width:100%;
  min-height:0; padding:var(--sp-1) var(--sp-2);
}
.au-produto strong{font-size:var(--texto-corpo); font-weight:600}
/* ⚠️ SEM `text-overflow:ellipsis` — o PADRÃO item 5 proíbe cortar NOME. Se não
   couber, quebra a linha; nunca some com reticência. Com o modal a 80% da tela,
   praticamente todo nome cabe. */
.au-produto-texto{
  display:flex; flex-direction:row; align-items:baseline;
  gap:var(--sp-2); flex-wrap:wrap; min-width:0; flex:1;
}
.au-produto-ref{font-family:var(--fonte-dados); font-size:var(--texto-etiqueta); color:var(--muted)}
/* A lista rola por dentro para os NÚMEROS continuarem à vista: rolando a folha
   inteira, eles ficariam lá embaixo, depois de trinta linhas.

   ⚠️ `overscroll-behavior:contain` NÃO É ENFEITE — É A CORREÇÃO DO QUE O DONO
   DESCREVEU em 04/09/2026: "quando vou rolando e chega ao fim, força rolar
   abaixo e aí sai da lista, desce para o resto dos campos".
   Isso é ENCADEAMENTO DE ROLAGEM: chegando ao fim de uma área que rola, o
   navegador entrega o resto do gesto ao pai — e o formulário deslizava por baixo
   da lista, tirando da tela o que a pessoa estava lendo. `contain` faz a rolagem
   MORRER no fim da lista, em vez de vazar para fora.
   É a mesma linha que o PADRÃO item 4 já exige nos fundos de modal, pelo mesmo
   motivo: lá o dedo arrastava a página para os lados por dentro do modal.

   E A LISTA OCUPA A ALTURA TODA quando está aberta, que foi o outro pedido: com
   70dvh ela domina o modal e a rolagem acontece dentro dela, não em volta. */
.au-produtos{
  /* ⚠️ 56dvh, E NÃO 70. Com 70 os NÚMEROS saíam da tela — foi o defeito que o
     dono viu, e eu o criei subindo esta altura depois de ter escrito, aqui
     mesmo, que a lista rola por dentro JUSTAMENTE para eles continuarem à
     vista. Altura de lista não é decisão isolada: ela divide o modal com o
     cabeçalho, a busca, a contagem e os números. */
  max-height:min(56dvh, 620px);
  overscroll-behavior:contain;
}
.au-produto-foto{
  width:34px; height:34px; flex:none; border-radius:var(--radius-sm);
  object-fit:cover; background:var(--surface2); border:1px solid var(--border);
}
.au-produto-sem-foto{display:block}
/* A lupa e alvo de dedo de 40px, como tudo nesta tela (PADRAO item 6). */
.au-produto-lupa{
  /* 40px de alvo mesmo numa linha fina: PADRAO item 6 nao abre excecao para
     lista comprida. O botao e maior que o desenho dentro dele. */
  flex:none; width:40px; height:40px; display:inline-flex;
  align-items:center; justify-content:center; border-radius:var(--radius-md);
  color:var(--muted); cursor:zoom-in;
}
.au-produto-lupa:hover, .au-produto-lupa:focus-visible{background:var(--surface2); color:var(--text)}

/* ── A FOTO GRANDE ───────────────────────────────────────────────────────
   `z-index` acima do resto: ela abre POR CIMA do modal de gerar lote, que ja
   esta aberto. A ordem no DOM ja resolve, e o numero e cinto e suspensorio. */
.au-fundo-foto{z-index:60}
.au-folha-foto{max-width:min(720px, 94vw)}
.au-foto-grande{display:block; width:calc(100% - 48px); margin:var(--sp-3) 24px 0;
  height:auto; border-radius:var(--radius-md); background:var(--surface2)}

/* ── O ENDERECO DA ETIQUETA, com o botao de abrir ────────────────────────
   O endereco continua inteiro e selecionavel — e ele que se confere letra por
   letra antes de gravar. O botao e um caminho A MAIS, nunca um substituto. */
.au-peca-end{display:flex; align-items:center; gap:var(--sp-3); flex-wrap:wrap}
.au-peca-end-texto{min-width:0; overflow-wrap:anywhere}
.au-abrir-pagina{flex:none; text-decoration:none; min-height:40px}

/* ── OS NÚMEROS DE PÁGINA ────────────────────────────────────────────────
   Alvo de 40px em cada um (PADRÃO item 6) e quebra de linha quando são muitos:
   numa lista de trinta páginas, no celular, eles não cabem numa fileira só. */
/* ⚠️ OS NÚMEROS GRUDAM NO RODAPÉ. Só encolher a lista não bastava: numa tela
   baixa, ou com o zoom de letra do sistema aumentado, eles voltariam a sair. Com
   `sticky` eles ficam visíveis enquanto o modal rola, aconteça o que acontecer
   com a altura. O fundo é obrigatório — sem ele a lista passa por baixo e os
   números ficam ilegíveis. */
.au-paginas{display:flex; flex-wrap:wrap; gap:var(--sp-1);
  justify-content:center; align-items:center; padding:var(--sp-3) 24px;
  position:sticky; bottom:0; z-index:1;
  background:var(--surface); border-top:1px solid var(--border)}
.au-pagina{
  min-width:40px; min-height:40px; padding:0 var(--sp-2);
  display:inline-flex; align-items:center; justify-content:center;
  background:none; color:var(--text); cursor:pointer; font:inherit;
  border:1px solid var(--border); border-radius:var(--radius-md);
}
.au-pagina:hover:not(:disabled){background:var(--surface2)}
.au-pagina:disabled{opacity:.4; cursor:default}
/* A página atual é a única com fundo cheio: sem isso, "onde eu estou" some. */
.au-pagina.on{background:var(--accent); border-color:var(--accent); color:var(--surface); font-weight:700}
.au-pagina-vazio{min-width:24px; text-align:center; color:var(--muted)}

/* ⚠️ ESTE BLOCO MORA DEPOIS DE `.au-folha` DE PROPOSITO, e nao por arrumacao.
   `.au-folha` e `.au-folha-larga` tem a MESMA especificidade — uma classe cada —
   entao quem vence e quem vem DEPOIS. Escrito antes, o `max-width:420px` da base
   sobrescrevia a variante inteira e o modal saia estreito, com a regra larga ali
   no arquivo parecendo certa. Foi o defeito que o dono viu em 04/09/2026. */

/* ── O GUIA DE BANCADA ─────────────────────────────────────────────────────
   `position:fixed` com inset zero, e não `absolute`: dentro de um pai que rola,
   o absolute acompanha a rolagem e o guia sai da tela. */
.au-guia-fundo{
  position:fixed; inset:0; z-index:60;
  display:flex; align-items:center; justify-content:center;
  padding:var(--sp-3); background:rgba(0,0,0,.55);
  touch-action:none; overscroll-behavior:contain;
}
/* O GUIA passou de 5 telas de texto para 11, algumas com quatro casos dentro.
   Por isso a caixa ganhou teto de altura e o MIOLO rola dentro dela — nunca a
   página atrás (PADRAO item 4). `dvh` e nunca `vh`. */
.au-guia{
  width:100%; max-width:420px; max-height:88dvh; padding:var(--sp-4);
  display:flex; flex-direction:column;
  border-radius:var(--radius-lg); border:1px solid var(--border);
  background:var(--surface); color:var(--text);
  overscroll-behavior:contain; touch-action:pan-y;
}
.au-guia-conta{margin:0 0 var(--sp-1); font-size:var(--texto-etiqueta); color:var(--muted); letter-spacing:.06em}
.au-guia-titulo{margin:0 0 var(--sp-2); font-size:var(--texto-titulo); line-height:1.25; overflow-wrap:anywhere}
/* O cabeçalho e os botões não rolam junto: quem está no meio de uma tela longa
   precisa do "Continuar" na mão o tempo todo. */
.au-guia-miolo{flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; -webkit-overflow-scrolling:touch}
.au-guia-texto{margin:0 0 var(--sp-3); font-size:var(--texto-campo); line-height:1.55}
/* OS ITENS SÃO O QUE SEPARA GUIA DE BANCADA DE TELA DE TEXTO: o rótulo se acha
   com o olho, de pé, com o celular na mão. `<dl>` porque é isso que eles são —
   um termo e a explicação dele. */
.au-guia-itens{margin:0 0 var(--sp-3)}
.au-guia-itens dt{
  margin-top:var(--sp-3); font-family:var(--fonte-principal);
  font-size:var(--texto-corpo);
  font-weight:700; color:var(--text); overflow-wrap:anywhere;
}
.au-guia-itens dd{
  margin:var(--sp-1) 0 0; font-size:var(--texto-corpo);
  line-height:1.5; color:var(--muted); overflow-wrap:anywhere;
}
/* Os botões embaixo e lado a lado; a 375px eles empilham em vez de encolher,
   porque alvo de toque abaixo de 40px é defeito. */
.au-guia-acoes{display:flex; gap:var(--sp-2); flex-wrap:wrap; padding-top:var(--sp-3)}
.au-guia-acoes .au-botao{flex:1 1 120px; min-height:40px}

/* ── O CABEÇALHO DE TABELA NÃO EXISTE NO CELULAR ───────────────────────────
   No celular a forma certa é o cartão: cada linha se lê sozinha, com o rótulo
   escrito junto do dado ("Gravada em 12/08", "nº 3"). Um cabeçalho ali seria
   uma fileira de palavras soltas em cima de nada.
   Por isso a regra-base é `display:none`, e só o `@media (min-width:900px)` o
   acende. A 375px ele não ocupa uma linha, não conta como alvo de toque e não
   entra na medição — medido, não deduzido. */
.au-tabela-cab{display:none}

/* ══════════════════════════════════════════════════════════════════════════
   A BANCADA — A ABA GRAVAR INTEIRA
   ══════════════════════════════════════════════════════════════════════════
   O dono reclamou desta aba QUATRO vezes. A última: "a aba gravar assim como as
   outras está uma bosta mesmo, faz o layout do zero, deixando 100% funcional,
   sem confusão, respeitando hierarquias e centralização".

   As queixas viraram regras, e elas estão escritas em CSS aqui embaixo:

   1. TRÊS TAMANHOS DE TEXTO, E TRÊS SÓ — três degraus da ESCALA DA CASA:
        · `--texto-numero` — o número da peça, o maior elemento do painel;
        · `--texto-titulo` — o estado, e o endereço no modo de copiar;
        · `--texto-corpo`  — todo o resto.
      NENHUMA regra deste bloco escreve `font-size` de outro jeito, e é por isso
      que dá para contar os tamanhos lendo o CSS — é isso que o teste conta.

   2. UM SÓ ELEMENTO DOMINANTE. O número da peça é o maior, e é o único desse
      tamanho. Ele NÃO é o progresso: é qual peça está na mão agora.

   3. NADA DE ESPAÇO MORTO. No computador o bloco de trabalho é UM só, centrado
      na horizontal e na vertical, com a fila num trilho ao lado. O que sobra é
      MARGEM em volta do bloco — respiro, e não buraco dentro do desenho.

   4. UMA AÇÃO PRINCIPAL. Um botão `.au-botao`, e um só, dentro da obra. Tudo o
      que é raro está atrás de "Mais opções deste lote", lá embaixo.

   A COR DE ESTADO SAI DE TOKEN (PADRAO item 2), por uma variável só
   (`--bancada-cor`) que a classe do `tom` troca. A cor é o SINAL; o texto é a
   informação, e por isso ele fica sempre em `--text`. */
.au-bancada{
  --bancada-cor: var(--border);
  display:flex; flex-direction:column; gap:var(--sp-4);
  padding:var(--sp-4) 24px 0;
  font-family:var(--fonte-principal); color:var(--text);
}
/* O TOM DO ESTADO. Cada um é um token, nenhum é um hex — e nenhum deles é a
   única forma de saber o que aconteceu: o título ao lado diz por escrito. */
.au-bancada-neutro{--bancada-cor:var(--border)}
.au-bancada-agindo{--bancada-cor:var(--accent)}
.au-bancada-ok{--bancada-cor:var(--green)}
.au-bancada-erro{--bancada-cor:var(--red)}
.au-bancada > *{margin:0}
/* AS TRÊS CAIXAS DO PAINEL — e no celular elas NÃO são caixas de nada.
   `.au-bancada-obra` (o que acontece), `.au-bancada-comandos` (o que você faz) e
   `.au-bancada-fila` (onde você está no lote). No celular as três são pilhas
   simples, uma embaixo da outra, com o MESMO `gap:var(--sp-4)` do painel em
   volta — por isso empilhar as três dá exatamente a mesma sequência e o mesmo
   espaçamento de quando tudo morava numa caixa só. Quem as separa em colunas é
   só o `@media (min-width:900px)`.
   `min-width:0` porque filho de grade nasce com largura mínima do conteúdo, e
   sem isto o endereço em fonte de dados empurraria a coluna e a página ganharia
   rolagem para os lados. */
.au-bancada-obra, .au-bancada-comandos, .au-bancada-fila{
  display:flex; flex-direction:column; gap:var(--sp-4); min-width:0;
}
.au-bancada-obra > *, .au-bancada-comandos > *, .au-bancada-fila > *{margin:0}

/* ── 0. O ALTO: qual lote, por onde se grava, e o guia ─────────────────────
   Ele não é conteúdo, e o desenho diz isso: tudo aqui está no tamanho do
   "resto", e nada compete com o número da peça. */
.au-bancada-topo{
  display:flex; align-items:flex-end; justify-content:space-between;
  gap:var(--sp-3); flex-wrap:wrap;
  padding-bottom:var(--sp-3); border-bottom:1px solid var(--border);
}
/* O recuo lateral já vem do `.au-bancada`: sem isto o seletor sai 24px mais
   para dentro que o resto do painel. */
.au-bancada-lote{padding:0; flex:1 1 260px; max-width:380px}
.au-bancada-onde{
  font-size:var(--texto-corpo); line-height:1.45;
  color:var(--muted); overflow-wrap:anywhere;
}
.au-bancada-saidas{display:flex; align-items:center; gap:var(--sp-3); flex-wrap:wrap}
/* A SAÍDA PARA O GUIA É SECUNDÁRIA, e é o desenho que diz isso: borda e fundo
   transparente, nunca cinza (PADRAO item 3), no tamanho do "resto". Ela não
   compete com o botão de gravar. 40px de alvo porque dedo não acerta menos que
   isso, e `--accent-forte` porque `--accent` puro sobre superfície reprova por
   pouco no tema escuro — e "por pouco" continua sendo reprovado. */
.au-bancada-menor{
  display:inline-flex; align-items:center; gap:var(--sp-2);
  min-height:40px; box-sizing:border-box;
  padding:0 var(--sp-3);
  font-family:var(--fonte-principal); font-size:var(--texto-corpo); font-weight:600;
  color:var(--accent-forte); background:transparent;
  border:1px solid var(--border); border-radius:var(--radius-md); cursor:pointer;
}
.au-icone-guia{flex:none}

/* ── 1. QUAL PEÇA É AGORA — o maior elemento da tela ─────────────────────── */
.au-bancada-peca{
  font-family:var(--fonte-dados); font-size:var(--texto-numero);
  font-weight:600; line-height:1.05; letter-spacing:-.01em;
  color:var(--text); font-variant-numeric:tabular-nums; overflow-wrap:anywhere;
}

/* ── 2. O ESTADO — o que a pessoa olha o tempo todo ────────────────────────
   Os anéis à esquerda, o texto à direita. A moldura é a cor do estado; a faixa
   grossa à esquerda é a cor lida de longe, sem depender de ler nada. Ela SOMA
   ao texto, nunca o substitui. */
.au-bancada-estado{
  display:flex; align-items:center; gap:var(--sp-4);
  padding:var(--sp-4); border-radius:var(--radius-lg);
  background:color-mix(in srgb, var(--bancada-cor) 10%, var(--surface));
  border:1px solid color-mix(in srgb, var(--bancada-cor) 38%, var(--surface));
  box-shadow:inset 4px 0 0 var(--bancada-cor);
}
/* ⚠️ "GRAVANDO" ESQUENTA A CAIXA INTEIRA, e não só os anéis. O `tom` da conta
   pura é 'agindo' para "encoste a etiqueta" E para "gravando…" — é a mesma
   família de estado, e mexer nisso seria reescrever a decisão que se prova no
   módulo. A diferença entre os dois é de DESENHO: um é "pode encostar", o outro
   é "NÃO tire agora". Sem esta linha a caixa ficava azul com os anéis laranja
   dentro — duas cores discordando sobre o mesmo estado, medido na tela.
   `:has()` é suportado desde o Safari 15.4 e já é usado neste arquivo; sem ele a
   caixa fica azul e os anéis continuam contando a diferença. */
.au-bancada-estado:has(.au-aneis-gravando){--bancada-cor:var(--orange)}
.au-bancada-dito{min-width:0}
.au-bancada-titulo{
  font-size:var(--texto-titulo); font-weight:700; line-height:1.2;
  color:var(--text); overflow-wrap:anywhere;
}
/* O DETALHE É O QUE FAZER. Ele fica no tamanho do "resto", mas em `--text` e não
   em `--muted`: numa bancada, "separe esta etiqueta" não é texto secundário. */
.au-bancada-detalhe{
  margin-top:var(--sp-2); font-size:var(--texto-corpo); line-height:1.5;
  color:var(--text); overflow-wrap:anywhere;
}

/* O BLOCO DE RELIGAR. Ele nasce escondido e só aparece no erro do serviço — por
   isso não tem `display` próprio: quem o mostra é o `v-if`. Fica embaixo do
   detalhe, com filete em cima, para ler como "e o que fazer sobre isso". */
.au-religar{margin-top:var(--sp-3);padding-top:var(--sp-3);
  border-top:1px solid color-mix(in srgb,var(--accent) 30%,var(--border));}
.au-religar-dica{margin-top:var(--sp-2);font-size:var(--texto-corpo);color:var(--muted);}
.au-religar-recado{margin-top:var(--sp-2);font-size:var(--texto-corpo);color:var(--text);}

/* ══════════════════════════════════════════════════════════════════════════
   OS ANÉIS — a animação que CONTA o que está acontecendo
   ══════════════════════════════════════════════════════════════════════════
   O pedido do dono foi "animação tipo frequência em círculo, algo foda, digno
   de app da JBL". Ela não é enfeite: cada estado tem um comportamento, e o
   comportamento é a informação.

     esperando  anéis largos, lentos, calmos ......... "encoste"
     gravando   aceleram e apertam, a cor esquenta ... "não tire"
     gravou     colapsam e viram um ✓ que cresce ..... "pode tirar"
     erro       travam, tremem, cor de recusa ........ "para"

   AS QUATRO REGRAS QUE ELA NÃO PODE QUEBRAR:

   1. CSS E SVG PUROS, sem biblioteca, e só `transform` e `opacity`. A máquina
      vai gravar cinquenta etiquetas seguidas: `transform`/`opacity` são as duas
      propriedades que o navegador anima sem recalcular layout nem repintar.

   2. `prefers-reduced-motion` MOSTRA OS MESMOS ESTADOS PARADOS, e
      DISTINGUÍVEIS — não "some tudo". Sem movimento, o que separa um estado do
      outro continua existindo: a COR do anel (token), o núcleo VAZIO em
      "encoste" e CHEIO em "não tire" e em "para", e o ✓ desenhado em "pode
      tirar". Ver o `@media` logo abaixo dos keyframes.

   3. A ANIMAÇÃO NUNCA É O ÚNICO AVISO. O título e o detalhe do estado — que
      saem da conta pura, e não daqui — dizem a mesma coisa por escrito, sempre,
      ao lado dos anéis. Por isso o SVG é `aria-hidden`.

   4. NADA PISCANDO ACIMA DE 3 VEZES POR SEGUNDO — é gatilho de convulsão
      fotossensível. Contado: em "gravando", que é o mais rápido, cada anel
      acende uma vez a cada 1,2s (0,83/s) e são três anéis defasados em 0,4s —
      2,5 acendimentos por segundo no conjunto. Em "esperando", 1,07/s. O tremor
      do erro roda UMA vez e para. */
.au-aneis-caixa{
  flex:none; width:104px; height:104px; line-height:0;
  color:var(--accent);
}
.au-aneis{display:block; width:100%; height:auto; overflow:visible}
/* `transform-box:fill-box` para o `transform-origin:center` valer dentro do SVG:
   sem ele o motor escala a partir do canto do viewBox e os anéis saem de cena. */
.au-aneis circle, .au-aneis polyline{transform-box:fill-box; transform-origin:center}
/* O REPOUSO, e ele é o que sobra quando não há animação nenhuma: quatro anéis
   concêntricos, do mais apagado (fora) ao mais forte (dentro). */
.au-anel-1{opacity:.28}
.au-anel-2{opacity:.5}
.au-anel-3{opacity:.78}
.au-anel-nucleo{opacity:1}
.au-anel-visto{opacity:0}

/* ESPERANDO (e o repouso antes do primeiro toque): largos, lentos, calmos. */
.au-aneis-parado, .au-aneis-esperando{color:var(--accent)}
.au-aneis-esperando .au-anel-1{animation:au-onda 2.8s ease-out infinite}
.au-aneis-esperando .au-anel-2{animation:au-onda 2.8s ease-out .93s infinite}
.au-aneis-esperando .au-anel-3{animation:au-onda 2.8s ease-out 1.86s infinite}
.au-aneis-esperando .au-anel-nucleo{animation:au-respira 2.8s ease-in-out infinite}

/* GRAVANDO: aceleram, apertam, e a cor esquenta. O núcleo fica CHEIO — é a
   diferença que se lê sem movimento nenhum. */
.au-aneis-gravando{color:var(--orange)}
.au-aneis-gravando .au-anel-nucleo{fill:currentColor}
.au-aneis-gravando .au-anel-1{animation:au-onda-curta 1.2s ease-out infinite}
.au-aneis-gravando .au-anel-2{animation:au-onda-curta 1.2s ease-out .4s infinite}
.au-aneis-gravando .au-anel-3{animation:au-onda-curta 1.2s ease-out .8s infinite}
.au-aneis-gravando .au-anel-nucleo{animation:au-respira 1.2s ease-in-out infinite}

/* GRAVOU: os anéis de dentro colapsam e o ✓ cresce UMA vez. O anel de fora fica
   parado, como a moldura do que ficou pronto. */
.au-aneis-ok, .au-aneis-fim{color:var(--green)}
.au-aneis-ok .au-anel-1, .au-aneis-fim .au-anel-1{opacity:.45}
.au-aneis-ok .au-anel-2, .au-aneis-ok .au-anel-3, .au-aneis-ok .au-anel-nucleo,
.au-aneis-fim .au-anel-2, .au-aneis-fim .au-anel-3, .au-aneis-fim .au-anel-nucleo{
  animation:au-recolhe .34s cubic-bezier(.4,0,.2,1) both;
}
.au-aneis-ok .au-anel-visto, .au-aneis-fim .au-anel-visto{
  animation:au-cresce .42s cubic-bezier(.22,1,.36,1) .1s both;
}

/* ERRO: travam, tremem uma vez, e a cor é de recusa. O núcleo cheio some da
   dúvida: é o mesmo desenho de "gravando", em vermelho e parado. */
.au-aneis-erro{color:var(--red)}
.au-aneis-erro .au-anel-nucleo{fill:currentColor}
.au-aneis-erro > .au-aneis{animation:au-treme .5s ease-in-out}

@keyframes au-onda{
  0%{transform:scale(.5); opacity:0}
  22%{opacity:.85}
  100%{transform:scale(1.06); opacity:0}
}
@keyframes au-onda-curta{
  0%{transform:scale(.72); opacity:0}
  25%{opacity:1}
  100%{transform:scale(.98); opacity:0}
}
@keyframes au-respira{
  0%,100%{transform:scale(.88); opacity:.65}
  50%{transform:scale(1); opacity:1}
}
@keyframes au-recolhe{from{transform:scale(1); opacity:.8} to{transform:scale(.2); opacity:0}}
@keyframes au-cresce{from{transform:scale(.3); opacity:0} to{transform:scale(1); opacity:1}}
@keyframes au-treme{
  0%,100%{transform:translateX(0)} 20%{transform:translateX(-5px)}
  40%{transform:translateX(5px)} 60%{transform:translateX(-3px)} 80%{transform:translateX(3px)}
}

/* QUEM DESLIGA ANIMAÇÃO NO SISTEMA COSTUMA TER MOTIVO — e nesses casos o estado
   aparece sem se mexer, mas APARECE. Cada linha abaixo é um estado desenhado
   PARADO, e os quatro continuam distinguíveis um do outro:
     · esperando → anéis azuis, núcleo VAZIO
     · gravando  → anéis laranja, núcleo CHEIO
     · gravou    → anel de fora + o ✓ verde inteiro
     · erro      → anéis vermelhos, núcleo cheio, sem tremor
   `animation:none` num `@keyframes` de entrada deixaria o elemento no estado
   INICIAL dele — que é `opacity:0`, ou seja, invisível. Por isso a opacidade é
   devolvida à mão aqui. Sai o movimento, fica o sinal. */
/* ⚠️ O `!important` AQUI NÃO É PREGUIÇA, E FOI MEDIDO. Sem ele este bloco não
   desligava nada: as regras de estado têm DUAS classes no seletor
   (`.au-aneis-gravando .au-anel-2`) e a de desligar tinha uma
   (`.au-aneis circle`) — quem tem mais especificidade ganha, esteja onde
   estiver no arquivo. Medido no navegador com `prefers-reduced-motion: reduce`
   ligado: `animationName` continuava `au-onda`, e a animação rodava inteira para
   quem pediu ao sistema para não ver movimento. O defeito não aparece no CSS
   lido de cima a baixo, e nenhum navegador reclama. Há teste que exige o
   `!important` justamente por isso. */
@media (prefers-reduced-motion: reduce){
  .au-aneis, .au-aneis circle, .au-aneis polyline{animation:none!important; transform:none!important}
  .au-aneis-esperando .au-anel-1, .au-aneis-gravando .au-anel-1{opacity:.28!important}
  .au-aneis-esperando .au-anel-2, .au-aneis-gravando .au-anel-2{opacity:.5!important}
  .au-aneis-esperando .au-anel-3, .au-aneis-gravando .au-anel-3{opacity:.78!important}
  .au-aneis-esperando .au-anel-nucleo, .au-aneis-gravando .au-anel-nucleo{opacity:1!important}
  .au-aneis-ok .au-anel-2, .au-aneis-ok .au-anel-3, .au-aneis-ok .au-anel-nucleo,
  .au-aneis-fim .au-anel-2, .au-aneis-fim .au-anel-3, .au-aneis-fim .au-anel-nucleo{opacity:0!important}
  .au-aneis-ok .au-anel-visto, .au-aneis-fim .au-anel-visto{opacity:1!important}
  .au-barra-cheia{transition:none!important}
}

/* ── 3. A ÚNICA AÇÃO PRINCIPAL ─────────────────────────────────────────────
   O BOTÃO OCUPA A LARGURA DA COLUNA. Ele é o único botão principal do painel, e
   um alvo largo é o que o dedo acerta com a bolsa na outra mão. O tamanho da
   letra é o do "resto" — o que precisa ser grande é o alvo, não o rótulo, e um
   quarto tamanho de texto aqui é justamente o que o dono reprovou. */
.au-bancada-acao{display:flex; gap:var(--sp-3); flex-wrap:wrap}
.au-bancada-botao{
  flex:1 1 200px; min-height:64px; font-size:var(--texto-corpo);
}

/* ── 4. O PROGRESSO, UMA VEZ SÓ ────────────────────────────────────────────
   A barra é para o canto do olho; o texto é o que se lê em voz alta do outro
   lado da bancada. A BARRA NÃO SUBSTITUI O TEXTO, soma a ele: barra sozinha não
   diz quantas faltam. */
.au-bancada-progresso{display:flex; flex-direction:column; gap:var(--sp-2)}
.au-barra{
  height:8px; border-radius:999px; box-sizing:border-box;
  background:var(--surface2); border:1px solid var(--border); overflow:hidden;
}
.au-barra-cheia{display:block; height:100%; background:var(--accent); transition:width .3s ease}
.au-bancada-conta{
  font-size:var(--texto-corpo); color:var(--muted); overflow-wrap:anywhere;
}
/* ── O ENDEREÇO ───────────────────────────────────────────────────────────
   NOS MODOS AUTOMÁTICOS ELE É CONFERÊNCIA, NÃO LEITURA: quem lê é a máquina. Ele
   já foi o MAIOR elemento desta tela, em fonte de dados e caixa própria — e era
   metade da queixa do dono. Aqui é uma linha discreta, no tamanho do "resto".
   NO MODO DE COPIAR o `.au-endereco` de sempre volta, porque ali a pessoa
   realmente copia — e ele fica no degrau do ESTADO, não num quarto tamanho. */
.au-bancada-endereco{
  font-family:var(--fonte-dados); font-size:var(--texto-corpo);
  line-height:1.5; color:var(--muted); word-break:break-all; user-select:all;
}
.au-bancada .au-endereco{font-size:var(--texto-titulo); margin-top:0}

/* ── 5. A FILA AO REDOR, discreta ──────────────────────────────────────────
   Ela é só para saber onde se está. A da vez NÃO se distingue só pela cor:
   ganha fundo, borda e o selo escrito "Agora". */
.au-fila-titulo{
  margin:0 0 var(--sp-2); font-family:var(--fonte-principal);
  font-size:var(--texto-etiqueta);
  font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted);
}
.au-fila-lista{list-style:none; margin:0; padding:0; display:flex;
  flex-direction:column; gap:var(--sp-1)}
.au-fila-item{
  display:flex; align-items:center; gap:var(--sp-3); flex-wrap:wrap;
  padding:var(--sp-2) var(--sp-3); border:1px solid transparent;
  border-radius:var(--radius-md);
  font-family:var(--fonte-principal);
  font-size:var(--texto-corpo); color:var(--muted); overflow-wrap:anywhere;
}
.au-fila-item.atual{
  background:var(--surface2); color:var(--text); font-weight:700;
  border-color:color-mix(in srgb, var(--accent) 38%, var(--surface));
}
.au-fila-n{white-space:nowrap}
.au-fila-cod{font-size:var(--texto-corpo)}

/* ── A PERGUNTA DE SOBRESCREVER ────────────────────────────────────────────
   Ela é a mais perigosa da ferramenta, e por isso ocupa a largura inteira do
   painel: dois seletores, o aviso de garantia de cliente e um motivo
   obrigatório não cabem numa coluna estreita, e é ali que o dedo erra o botão. */
.au-sobrescrita{margin-top:0}

/* ══════════════════════════════════════════════════════════════════════════
   "MAIS OPÇÕES DESTE LOTE" — o único ponto de acesso discreto
   ══════════════════════════════════════════════════════════════════════════
   Dar baixa, excluir a peça, trocar o jeito de gravar, a trava permanente, a
   lista para a máquina, quais lotes o seletor oferece e as peças baixadas com o
   "Desfazer". Antes eram seis links do MESMO peso espalhados pela bancada —
   seis ações do mesmo peso é o mesmo que nenhuma ação principal.
   Nada aqui dentro é botão principal: todos são `.au-botao secundario` ou link.
   As perguntas que abrem aqui dentro têm o botão principal DELAS, porque cada
   pergunta é um bloco com uma decisão só. */
.au-mais{
  margin:var(--sp-5) 24px 0; max-width:720px;
  border:1px solid var(--border); border-radius:var(--radius-md);
  background:var(--surface);
}
.au-mais > summary{padding:0 var(--sp-3)}
.au-mais-miolo{padding:0 var(--sp-3) var(--sp-4); border-top:1px solid var(--border)}

/* ── A ÁRVORE DA ABA ETIQUETAS ────────────────────────────────────────────
   Reusa o `.au-mais` inteiro — a seta que gira, o marcador escondido, a borda
   e o fundo já vêm de lá. O que muda é só o que é da árvore.

   ⚠️ O RECUO VOLTA A ZERO AQUI. O `.au-mais` solto carrega `margin: sp-5 24px`
   porque ele fica direto na aba; dentro da `.au-lista`, que JÁ tem o recuo de
   24px dos irmãos, aquela margem viraria recuo dobrado. Foi o mesmo tropeço do
   bloco de ler etiqueta hoje de manhã: recheio e recuo são medidas diferentes. */
.au-lote-no{margin:0; max-width:none}
.au-lote-no > summary{padding:var(--sp-2) var(--sp-3); gap:var(--sp-3); flex-wrap:wrap}
.au-lote-nome{font-size:var(--texto-campo); font-weight:700; overflow-wrap:anywhere}
.au-lote-ref{font-weight:400; color:var(--muted)}
.au-lote-os{font-family:var(--fonte-dados); font-weight:600; color:var(--text);
  background:color-mix(in srgb,var(--accent) 12%,var(--surface));
  border-radius:var(--radius-sm); padding:2px var(--sp-2)}
.au-lote-data{color:var(--muted); font-weight:400}
/* A contagem vai para a direita e NUNCA quebra no meio: "2 de 12" partido em
   duas linhas lê como dois números diferentes. A 375px o summary inteiro quebra
   antes disso (flex-wrap acima), e ela desce inteira. */
.au-lote-conta{margin-left:auto; white-space:nowrap; color:var(--accent);
  font-size:var(--texto-corpo); font-weight:600}
.au-lote-no > .au-tabela{border-top:1px solid var(--border); padding:var(--sp-3)}
.au-mais-titulo{
  margin:var(--sp-4) 0 var(--sp-2); font-family:var(--fonte-principal);
  font-size:var(--texto-etiqueta);
  font-weight:700; letter-spacing:1.5px; text-transform:uppercase; color:var(--muted);
  overflow-wrap:anywhere;
}
/* O recuo lateral já vem do miolo: sem isto tudo aqui dentro sairia 24px mais
   para dentro que o resto da gaveta. */
.au-mais .au-acoes, .au-mais .au-peca-acoes{padding:0}
.au-mais .au-campo{padding:var(--sp-2) 0 0; max-width:none}
.au-mais .au-botao{min-height:40px; box-sizing:border-box}

/* ══════════════════════════════════════════════════════════════════════════
   A TELA GRANDE — TUDO O QUE VEM DAQUI ATÉ O `@media` DO CELULAR
   ══════════════════════════════════════════════════════════════════════════
   Sem este bloco tudo ficaria travado em 520–720px, e num monitor de 1440px o
   conteúdo viraria uma faixa à esquerda: MEDIDO, antes de ele existir — a lista
   usava 720 de 1440 (50%) e a bancada 620 de 1440 (43%). O dono viu e disse "no
   computador está horrível, mal distribuído". É também o item 7 do
   PADRAO-DA-CENTRAL: "Tela é full-bleed: nada de coluna estreita centralizada".

   ONDE ELE MORA, E POR QUÊ. Aqui, DEPOIS de todas as regras-base e ANTES do
   `@media (max-width:520px)` do fim do arquivo. As duas coisas importam:
     · depois das regras-base, senão o `max-width` de lá ganharia por vir por
       último com a mesma especificidade — defeito silencioso que já aconteceu
       duas vezes neste arquivo;
     · antes do `@media` do celular, porque HÁ TESTE que exige que aquele bloco
       seja a última coisa do CSS.

   O CELULAR NÃO REGRIDE. Nada aqui vale abaixo de 900px.

   POR QUE 900px. É o mesmo corte que a Frota usa — telas irmãs que mudam de
   forma na mesma largura é o que faz a Central parecer uma coisa só. */
@media (min-width:900px){

  /* ── 1. FULL-BLEED: CAI O TETO DE LARGURA ──────────────────────────────
     O recuo continua sendo 24px, o mesmo da Frota e do Patrimônio. */
  .au-lista{max-width:none;}

  /* A PROSA NÃO ACOMPANHA, E É DE PROPÓSITO. `.au-ajuda`, `.au-instrucao`,
     `.au-vazio`, `.au-erro` e `.au-pronto` são frases para LER, e linha de
     texto corrida com 1400px de largura o olho não acompanha — ele perde a
     linha na volta. Full-bleed vale para o que se VARRE (lista, tabela,
     grade); texto corrido mantém a medida de leitura. */

  /* A busca do topo (aba Garantias) esticava de ponta a ponta: um campo de
     busca de 1392px não fica melhor que um de 420px, só fica maior. */
  .au-topo-acao .au-busca{max-width:420px;}

  /* ── 2. LOTES: GRADE, NÃO FILEIRA ──────────────────────────────────────
     `auto-fill` com mínimo de 440px dá 1 coluna até ~1000px, DUAS a partir de
     1000px (2×440+16 = 896 cabem em 952) e TRÊS a partir de ~1400px
     (3×440+32 = 1352). Contado, não estimado.

     `align-items:start` é o conserto que a Frota já pagou caro: sem ele toda a
     linha fica com a altura do cartão mais alto dela, e um cartão com a
     pergunta de excluir aberta ao lado de dois curtos viraria duas caixas
     brancas com 250px de nada dentro. */
  .au-grade-de-lotes{
    display:grid; grid-template-columns:repeat(auto-fill, minmax(440px, 1fr));
    gap:var(--sp-4); align-items:start;
  }
  /* O CARTÃO ABERTO OCUPA A LARGURA TODA, E SOBE PARA A PRIMEIRA LINHA.
     Dentro dele mora a tabela das peças, com seis colunas e o endereço inteiro:
     espremida em 440px ela não seria tabela nenhuma. O mesmo vale para o
     formulário de editar e para as duas perguntas de excluir, que são conversas
     — e conversa espremida numa coluna de grade é onde o dedo erra o botão.

     ⚠️ O `order:-1` É O CONSERTO DE UM BURACO NA GRADE, e sem ele a largura
     inteira sozinha é um defeito. O dono: "os cartões ficam em grade, mas o
     cartão aberto ocupa a largura toda e os outros voltam para a grade abaixo
     dele; fica desalinhado e parece defeito".

     MEDIDO a 1440px, com o terceiro de seis lotes aberto e três colunas:
       lote 1 → x=24    lote 2 → x=493   [ VAZIO em x=963 ]
       lote 3 → x=24, largura 1392 (o aberto, sozinho na sua linha)
       lote 4 → x=24    lote 5 → x=493   lote 6 → x=963
     O buraco na primeira linha é o que se vê como "defeito": um item que ocupa
     a linha inteira não cabe no que sobrou da linha em que ele estava, então
     ele desce — e o que sobrou fica vazio para sempre.

     `order:-1` põe o aberto na FRENTE de todos: ele vira a primeira linha, de
     ponta a ponta, e os fechados descem para uma grade inteira embaixo, sem
     nenhum vão. Foi a saída escolhida entre três:
       · `grid-auto-flow:dense` tapa o buraco puxando cartões de baixo para
         cima — mas a ordem que o olho lê deixa de ser a do HTML, e quem usa
         teclado passa a andar em ziguezague;
       · deixar o aberto na coluna dele espremeria a tabela de seis colunas em
         440px, que é o que a largura inteira existe para evitar;
       · o aberto na frente mantém as duas ordens iguais e a grade inteira.
     A pessoa não perde o cartão de vista: `trazerOLoteParaAVista` rola até ele.

     Vale SÓ no computador, e é por isso que estas duas linhas moram dentro do
     `@media (min-width:900px)`: no celular a lista é uma coluna, não há grade,
     não há buraco — e `order:-1` ali faria o cartão saltar para o alto da tela
     sem motivo nenhum. */
  .au-grade-de-lotes > .au-card:has(.au-pecas),
  .au-grade-de-lotes > .au-card:has(.au-edicao),
  .au-grade-de-lotes > .au-card:has(.au-confirma){grid-column:1 / -1; order:-1;}

  /* ── 3. AS LISTAS DE VARREDURA VIRAM TABELA ────────────────────────────
     Cartão é a forma certa para UMA coisa por vez, e continua sendo a do
     celular. Numa tela larga com dezenas de linhas a forma certa é a tabela:
     cabeçalho em cima, colunas alinhadas, o olho descendo por uma coluna só.

     COMO AS COLUNAS SE ALINHAM SEM MUDAR O HTML DO CELULAR: cada cartão vira
     uma grade com o MESMO `grid-template-columns` do cabeçalho, e as caixas
     que só serviam para agrupar viram `display:contents` — elas somem da grade
     e os filhos delas passam a ser as células.

     `overflow-wrap:anywhere` em tudo: texto cortado é defeito (PADRAO item 5).
     Por isso também nenhuma coluna tem mínimo em pixel — todas são
     `minmax(0, Nfr)`: fração não estoura a largura, e a página nunca ganha
     rolagem horizontal por causa da tabela. */
  .au-lista.au-tabela{
    gap:0; padding-top:var(--sp-4);
    display:block;
  }
  .au-tabela .au-tabela-cab{
    display:grid; align-items:end; gap:var(--sp-2) var(--sp-4);
    padding:var(--sp-3) var(--sp-4);
    border:1px solid var(--border); border-bottom:0;
    border-radius:var(--card-radius) var(--card-radius) 0 0;
    background:var(--surface2);
    font-family:var(--fonte-principal);
    font-size:var(--texto-etiqueta);
    font-weight:700; letter-spacing:1.5px; text-transform:uppercase;
    color:var(--muted); overflow-wrap:anywhere;
  }
  .au-tabela .au-card{
    display:grid; align-items:center; gap:var(--sp-2) var(--sp-4);
    padding:var(--sp-3) var(--sp-4);
    border-radius:0; border-width:1px 1px 0 1px;
  }
  .au-tabela .au-card:last-child{
    border-bottom-width:1px;
    border-radius:0 0 var(--card-radius) var(--card-radius);
  }
  /* A COR DE ALERTA VAI PARA A LINHA INTEIRA, e não para uma borda de baixo
     que se leria como divisória. Filete à esquerda, na cor do token. */
  .au-tabela .au-card.alerta{
    border-color:var(--border);
    box-shadow:inset 3px 0 0 var(--orange);
  }
  .au-tabela .au-card-topo{display:contents;}
  /* CÉLULA NÃO ESTICA O SELO. Filho de grade nasce com `justify-self:stretch`,
     e a etiqueta de estado saía como uma pílula de 160px com uma palavra
     perdida no meio. */
  .au-tabela .selo, .au-tabela-pecas .selo{justify-self:start;}
  .au-tabela .au-modelo, .au-tabela .au-progresso, .au-tabela .au-ref,
  .au-tabela .au-card-linha, .au-tabela .au-peca-end{min-width:0; overflow-wrap:anywhere;}
  /* `white-space:nowrap` na regra-base do `.au-progresso` cortaria a célula. */
  .au-tabela .au-progresso{white-space:normal;}
  .au-tabela .au-card-linha{margin-top:0;}
  .au-tabela .au-peca-end{margin-top:0;}
  .au-tabela .au-peca-acoes, .au-tabela .au-confirma{margin-top:0;}
  /* A conversa (apagar a gravação) ocupa a linha inteira, embaixo das células:
     ela tem duas etapas, senha e recusa escrita, e não é uma célula. */
  .au-tabela .au-card > .au-confirma{grid-column:1 / -1; margin-top:var(--sp-3);}

  /* ⚠️ PELO MESMO MOTIVO, OS BOTÕES DE AÇÃO. Filho direto de `.au-card` vira UMA
     célula da grade, e a caixa dos botões caía numa coluna de ~1fr: os dois
     botões não cabiam lado a lado ali, quebravam a linha por causa do
     `flex-wrap:wrap` da regra-base e empilhavam um sobre o outro, esticando a
     ALTURA DA LINHA INTEIRA. Medido no navegador em 05/09/2026, a 1440px.
     Ocupando a linha toda eles voltam a ficar lado a lado.
     O `padding` horizontal da regra-base (24px, pensado para fora de card)
     também sai: aqui quem dá o respiro é o `padding` do próprio card. */
  .au-tabela .au-card > .au-acoes{
    grid-column:1 / -1; padding:0; margin-top:var(--sp-2);
  }

  .au-tabela-etiquetas .au-tabela-cab, .au-tabela-etiquetas .au-card{
    grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1.3fr) minmax(0,2.4fr) minmax(0,1.4fr);
  }
  .au-tabela-garantias .au-tabela-cab, .au-tabela-garantias .au-card{
    grid-template-columns:minmax(0,2fr) minmax(0,1fr) minmax(0,1.1fr) minmax(0,1.2fr) minmax(0,1.3fr) minmax(0,1fr);
  }
  /* Nas três tabelas de Alertas a linha de baixo do cartão tem sempre o mesmo
     número de células, então ela também vira `display:contents` e as colunas
     ficam alinhadas de ponta a ponta. Em Garantias as duas últimas são
     opcionais — e por serem as ÚLTIMAS, quando faltam sobra célula vazia no
     fim e as quatro primeiras continuam no lugar. */
  .au-tabela-garantias .au-card-linha, .au-tabela-repetidas .au-card-linha,
  .au-tabela-invalidas .au-card-linha, .au-tabela-baixadas .au-card-linha{display:contents;}
  .au-tabela-repetidas .au-tabela-cab, .au-tabela-repetidas .au-card{
    grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.4fr);
  }
  .au-tabela-invalidas .au-tabela-cab, .au-tabela-invalidas .au-card{
    grid-template-columns:minmax(0,1.8fr) minmax(0,1fr) minmax(0,1.4fr);
  }
  .au-tabela-baixadas .au-tabela-cab, .au-tabela-baixadas .au-card{
    grid-template-columns:minmax(0,1.6fr) minmax(0,1fr) minmax(0,1.4fr) minmax(0,1.4fr);
  }
  .au-tabela-cartoes .au-tabela-cab, .au-tabela-cartoes .au-card{
    grid-template-columns:minmax(0,2.4fr) minmax(0,1.4fr) minmax(0,1fr) minmax(0,1.6fr);
  }
  .au-tabela-cartoes .au-card-linha{display:contents;}

  /* ── 4. AS PEÇAS DO LOTE, TAMBÉM EM TABELA ─────────────────────────────
     Um lote tem até 500 peças, e é a lista mais varrida da ferramenta.
     O cabeçalho é o primeiro `<li>` e fica `position:sticky` no alto: a lista
     rola dentro da própria caixa (`max-height:60dvh`), e cabeçalho que sobe
     junto com a rolagem não serve para nada depois da décima linha. */
  .au-pecas{padding:var(--sp-4);}
  .au-tabela-pecas .au-tabela-cab{
    display:grid; align-items:end; gap:var(--sp-2) var(--sp-4);
    position:sticky; top:0; z-index:1;
    padding:var(--sp-2) var(--sp-3);
    background:var(--surface2); border-bottom:1px solid var(--border);
    font-family:var(--fonte-principal);
    font-size:var(--texto-etiqueta);
    font-weight:700; letter-spacing:1.5px; text-transform:uppercase;
    color:var(--muted); overflow-wrap:anywhere;
  }
  .au-tabela-pecas{margin-top:var(--sp-3);}
  .au-tabela-pecas .au-peca{
    display:grid; align-items:center; gap:var(--sp-2) var(--sp-4);
    padding:var(--sp-2) var(--sp-3);
  }
  /* ⚠️ A COLUNA DO ENDEREÇO TEM PISO EM PIXEL, E A DO "Nº" TAMBÉM.
     O dono viu o endereço quebrando a ÚLTIMA LETRA sozinha na linha de baixo
     ("…K7M4X001Q / P") e disse que endereço cortado atrapalha quem confere.
     MEDIDO no navegador a 1440px, e a conta é de dar raiva de tão apertada:
       · o endereço inteiro numa linha, em `--fonte-dados` a 13px: 353px
       · a coluna, com `minmax(0, 2.4fr)`:                          349px
     Faltavam QUATRO pixels, e é por isso que caía exatamente uma letra.
     `minmax(380px, 2.4fr)` dá 27px de folga sobre a medida — o bastante para o
     tema escuro, onde `--fonte-dados` é outra família (Oswald), e para quem
     aumentou a letra do sistema em um degrau.
     O SEGUNDO PISO É CONSEQUÊNCIA DO PRIMEIRO, e foi medido depois dele: com o
     endereço tomando 380px numa janela de 900px, a coluna do "Nº" (`.5fr`)
     caía para 28px e passava a cortar "nº 10" em VINTE E UMA linhas seguidas.
     Trocar um texto cortado por outro não é conserto. `minmax(48px, .5fr)` era
     o que "nº 500" precisava — o maior número que um lote pode ter, porque a
     quantidade vai até 500.
     ELE SUBIU PARA 76px EM 02/09/2026, quando a coluna virou "Nº de série": o
     texto mais largo que ela carrega deixou de ser "nº 500" (48px) e passou a
     ser "0015500" — os quatro dígitos da referência mais a peça 500 —, que em
     `--fonte-principal` a 13px em negrito mede 55px. Quem manda no piso, porém,
     não é a célula: é o CABEÇALHO, "Nº DE SÉRIE" em 11px com 1,5px de
     entreletra, cuja maior palavra ("SÉRIE") mede 51px e cuja quebra em duas
     linhas ("Nº DE" / "SÉRIE") pede 51px de largura útil. 76px dá folga para o
     tema escuro, onde a família muda, e para quem aumentou a letra do sistema.
     Os dois pisos somados vão de 428px para 456px, e a 900px continuam sobrando
     mais de 250px para as outras quatro colunas encolherem — medido, sem
     rolagem lateral.

     As outras quatro continuam `minmax(0, Nfr)` de propósito: fração não
     estoura a largura, e a página nunca ganha rolagem horizontal por causa da
     tabela. Os dois pisos somados dão 428px, e a 900px sobram mais de 280px
     para as outras quatro encolherem — medido, sem rolagem lateral. */
  .au-tabela-pecas .au-tabela-cab, .au-tabela-pecas .au-peca{
    grid-template-columns:minmax(76px,.5fr) minmax(0,1.3fr) minmax(0,1fr) minmax(0,1.4fr) minmax(380px,2.4fr) minmax(0,1.8fr);
  }
  /* O rótulo "nº de série" sai aqui, e SÓ aqui: a coluna acima já o diz, e
     repeti-lo em 500 linhas roubaria a largura da coluna do endereço. No
     celular ele fica, porque lá não há cabeçalho nenhum. */
  .au-tabela-pecas .au-rot-serie{display:none}
  .au-tabela-pecas .au-peca-topo{display:contents;}
  .au-tabela-pecas .au-peca-estado, .au-tabela-pecas .au-peca-end{margin-top:0; min-width:0;}
  /* Os dois links de ação, um debaixo do outro: lado a lado nesta coluna eles
     ficariam com metade da largura do texto que carregam. */
  .au-tabela-pecas .au-peca-links{flex-direction:column; align-items:flex-start; gap:0;}

  /* ── 5. A LISTA DAS BAIXADAS ───────────────────────────────────────────
     A linha em si não precisa de 1400px: ela é "Peça 7 — defeito" com um
     "Desfazer" do outro lado. */
  .au-baixadas li{max-width:720px;}

  /* ── 6. O GUIA DE BANCADA RESPIRA ──────────────────────────────────────
     No celular ele ocupa a tela; no computador ele era uma caixa de 420px com
     onze telas de texto dentro, com o miolo rolando à toa. Em 640px o texto
     cabe, e os itens viram o que eles são: uma lista de termo e explicação. */
  .au-guia{max-width:640px; padding:var(--sp-5);}
  .au-guia-itens{
    display:grid; grid-template-columns:minmax(120px, max-content) minmax(0,1fr);
    column-gap:var(--sp-4); row-gap:var(--sp-2);
  }
  .au-guia-itens dt{margin-top:0;}
  .au-guia-itens dd{margin:0;}

  /* ── 7. A BANCADA NO COMPUTADOR: DUAS COLUNAS GRANDES ──────────────────
     Esta é a tela mais importante da ferramenta e a única usada DE PÉ: a pessoa
     está com a bolsa numa mão e o celular na outra.

     ⚠️ O DESENHO É DO DONO, e são estas as palavras dele: "na aba gravar no
     computador ainda não está usando toda a lateral, acredito que se você fizer
     duas colunas, de um lado a animação de gravação e na direita o link e os
     botões". É a SEXTA vez que ele reclama desta aba.

     POR QUE AS ENTREGAS ANTERIORES NÃO CONVENCERAM, medido a 1440px na tela
     renderizada, no commit anterior a este:
       · a largura aproveitada já estava boa — 1392 de 1440 (96,7%);
       · mas a divisão era obra 942px + fila 418px, e a fila é uma LISTA de
         linhas curtas: uma coluna de 418px para "nº 5 · código · Pendente";
       · e a obra de 942px tinha tudo empilhado numa pilha só, então o vazio
         mudou de lugar em vez de sumir. O MAIOR VAZIO CONTÍNUO do painel era de
         1224 × 72px, a faixa à direita do "nº 5 de 12", e o botão de 360px
         morava numa coluna de 942 com 582px de nada ao lado.
     Aproveitar a largura não é esticar a moldura: é ter DUAS coisas para pôr
     lado a lado. Agora há.

     ESQUERDA — O QUE ESTÁ ACONTECENDO. O número da peça e o bloco de estado,
     com os anéis GRANDES (200px, contra 104) no alto dele. É o elemento que se
     vê de longe, de pé na bancada, e é o que o dono chamou de "a animação de
     gravação".
     DIREITA — O QUE VOCÊ FAZ. O endereço, o botão principal, o botão secundário
     e o progresso do lote. É o "link e os botões" do pedido.

     AS DUAS COLUNAS ENCHEM A LARGURA, e os números são medidos:
       · a da direita é `min(680px, 47%)` — 654,2px a 1440. QUEM MANDOU NESSE
         NÚMERO FOI O ENDEREÇO, e não o gosto: "https://vesselbrasil.com.br/
         verify/K7M4X05QP2" mede 541,9px em `--fonte-dados` no degrau
         `--texto-titulo`, e com os 32px de recuo da caixa e a moldura pede 576.
         A primeira tentativa desta entrega deu 556,8 à coluna e o endereço saiu
         QUEBRADO no meio do código ("…K7M4X05Q / P2") — é justamente ele que a
         pessoa lê e copia no modo do aplicativo, e código partido em duas
         linhas é o defeito que a versão anterior desta tela já tinha pago.
         A segunda tentativa deu 44%, que a 1440 são 612,5: cabia, com 2,5px de
         folga — folga que uma fonte de reserva come inteira. Com 47% sobram 620
         de espaço útil contra os 542 do endereço, e ele continua numa linha só
         até 1280px de tela. O botão principal (teto de 360px, pedido do dono) e
         a secundária "Copiar endereço" dividem a mesma linha dentro dela;
       · a da esquerda fica com o resto: 705,8px a 1440. É onde moram os anéis
         de 200px e as duas frases do estado. ELA É SEMPRE A MAIOR DAS DUAS, em
         qualquer largura: com 47% para a direita, a esquerda fica com 53% menos
         o `gap`, e isso só empataria numa tela de 581px — que já é celular, e lá
         não há colunas.

     ⚠️ ABAIXO DE 1280px O ENDEREÇO VOLTA A QUEBRAR EM DUAS LINHAS, e é o menor
     dos males, medido: para caber a 1180px a coluna da direita precisaria de
     610 dos 1132 disponíveis, ou seja ficaria MAIOR que a do trabalho — que é
     exatamente o defeito que derrubou a primeira forma deste painel. A quebra
     não perde nada: a caixa é `user-select:all`, então um clique continua
     selecionando o endereço inteiro, e o "Copiar endereço" ao lado nunca
     dependeu de o texto caber.

     SOMADAS COM O `gap` DE 32: 1392 de 1440, os mesmos 96,7% de antes — só que
     agora divididos entre duas colunas que têm o que mostrar, e nenhuma delas é
     uma tira: 705,8 e 654,2 são as duas grandes que o dono pediu.

     ⚠️ A FILA DESCEU PARA UMA FAIXA, E NÃO SUMIU (PADRÃO item 8). Três colunas
     a 1440 dariam ~437px cada, e o bloco de estado com os anéis grandes mais a
     frase de socorro não cabe em 437 — foi medir para ver: a frase de 'erro'
     tem 150 caracteres. A fila, ao contrário, é feita de SEIS linhas curtas:
     em faixa ela usa os 1392px inteiros com seis fichas lado a lado, em vez de
     empilhar seis linhas numa tira de 418px de largura. Ela continua dizendo o
     mesmo:
     a que saiu, a da vez marcada com "Agora", e as quatro seguintes.

     A CENTRALIZAÇÃO QUE IMPORTA CONTINUA SENDO A VERTICAL — `align-self:center`
     com o teto de altura logo abaixo. */
  .au-bancada{
    display:grid;
    /* ⚠️ `min(680px, 47%)` E NÃO `680px` FIXO, pelo mesmo motivo que a forma
       anterior usava `min(420px, 30%)`: com a coluna travada em pixel, a 900px
       de tela a coluna da direita ficaria com 680 e a do trabalho com 140 — a
       lateral MAIS LARGA que o trabalho. Com os 47% as duas encolhem juntas:
       654,2 a 1440px, 400,4 a 900px, e a da esquerda nunca fica menor. O teto
       em pixel só entra a partir de 1495px de tela, e é ele que impede a coluna
       da ação de virar uma faixa de 900px num monitor grande para segurar um
       botão de 360. */
    grid-template-columns:minmax(0,1fr) minmax(0,min(680px, 47%));
    /* SÓ DUAS LINHAS DECLARADAS. A faixa da fila (linha 3) e a pergunta de
       sobrescrever (linha 4) entram como linhas IMPLÍCITAS, e é de propósito:
       linha declarada que fica vazia continua gerando `row-gap`, e isso é 24px
       de nada no pé do painel toda vez que a pergunta não está na tela. */
    grid-template-rows:auto minmax(0,1fr);
    column-gap:var(--sp-6); row-gap:var(--sp-5);
    /* O TETO DE ALTURA É O QUE DÁ SENTIDO AO `align-self:center`. Sem ele a
       grade teria a altura do conteúdo e "centrar" não centraria nada. Não é a
       tela inteira de propósito: a faixa da fila e a gaveta "Mais opções" ficam
       logo abaixo, e um painel de 100dvh as empurraria para fora da vista.
       ELE ENCOLHEU DE 560 PARA 460 NESTA ENTREGA, e a conta é a razão: a faixa
       da fila passou a ocupar uma linha inteira embaixo das colunas, e com os
       560 antigos a gaveta "Mais opções" saía da primeira tela a 1440x900. */
    min-height:min(52dvh, 460px);
    padding:var(--sp-5) 24px 0;
  }
  /* O ALTO E A GAVETA COMEÇAM E ACABAM NA MESMA LINHA VERTICAL DO BLOCO.
     Soltos, o seletor de lote encostava na borda esquerda da tela e o "?" na
     direita, enquanto o painel ficava centrado 150px para dentro — três
     alinhamentos diferentes na mesma tela. Com as duas colunas ocupando a
     largura, a linha vertical do bloco É a da página. */
  .au-mais{max-width:none; margin-left:24px; margin-right:24px;}
  .au-bancada-topo{grid-column:1 / -1; grid-row:1; align-self:start;}
  /* AS DUAS COLUNAS, no centro óptico VERTICAL da faixa que sobra.
     O NÚMERO DA PEÇA COLA NO BLOCO DE ESTADO — `--sp-3` e não `--sp-4`. Ele é o
     título daquele bloco, não um terceiro assunto, e cada pixel que ele ganha de
     folga vira faixa vazia ao lado dele, que é o defeito que esta entrega veio
     desfazer. */
  .au-bancada-obra{grid-column:1; grid-row:2; align-self:center; gap:var(--sp-3);}
  /* A COLUNA DA AÇÃO RESPIRA MAIS QUE A DO CELULAR — `--sp-6` no lugar de
     `--sp-4`, e o motivo é medido, não estético. Ela tem três assuntos (o
     endereço, os botões, o progresso) e é MAIS BAIXA que a coluna da esquerda,
     que carrega os anéis de 200px. Centrada, a diferença de altura vira vão
     acima e abaixo dela: com `--sp-4` o maior vazio contínuo do painel media
     664 × 96px; com `--sp-6` a coluna cresce 32px e o vazio cai junto. O espaço
     que sobrava virou respiro entre os três blocos. */
  .au-bancada-comandos{grid-column:2; grid-row:2; align-self:center; gap:var(--sp-6);}
  .au-bancada-topo > *:last-child{margin-left:auto;}

  /* ── O BLOCO DE ESTADO VIRA UMA COLUNA, E A ANIMAÇÃO CRESCE ────────────
     No celular os anéis ficam ao LADO do texto, porque ali a largura é o
     recurso escasso. No computador o escasso é a distância: quem está de pé a
     um metro da tela lê o movimento antes de ler a palavra. Então os anéis
     sobem para o alto do bloco, com 200px em vez de 104, e o texto fica embaixo
     deles — os dois centrados, que é como um painel de máquina se lê.
     O texto tem teto de largura: uma frase de socorro com 150 caracteres numa
     linha de 658px o olho perde na volta. */
  .au-bancada-estado{
    flex-direction:column; align-items:center; text-align:center;
    gap:var(--sp-4); padding:var(--sp-5);
  }
  .au-aneis-caixa{width:200px; height:200px;}
  .au-bancada-dito{max-width:520px;}
  /* O NÚMERO DA PEÇA acompanha o eixo do bloco de estado: solto à esquerda de
     uma coluna de 706px, ele ficava longe do que ele nomeia. */
  .au-bancada-peca{text-align:center;}

  /* ── A FILA, EM FAIXA ──────────────────────────────────────────────────
     A lista vira uma fileira de fichas de largura igual, todas com moldura. A
     DA VEZ CONTINUA SE DISTINGUINDO POR QUATRO COISAS, e nenhuma delas é só a
     cor: fundo próprio, moldura na cor de ação, negrito e o selo escrito
     "Agora". A moldura das outras é o que separa uma ficha da vizinha — em
     linha, sem moldura, seis linhas curtas viram uma sopa de palavras. */
  .au-bancada-fila{
    grid-column:1 / -1; grid-row:3; gap:var(--sp-3);
    padding-top:var(--sp-4); border-top:1px solid var(--border);
  }
  .au-bancada-fila .au-fila-lista{flex-direction:row; flex-wrap:wrap; gap:var(--sp-2);}
  /* `flex:1 1 auto` e não um piso em pixel. MEDIDO: com `flex:1 1 200px` as seis
     fichas saíam com 225px cada e o selo "Pendente" (66px) não cabia na mesma
     linha do código — três das seis quebravam em duas linhas e as outras três
     não, e a faixa ficava serrilhada. Com `auto`, cada ficha nasce do tamanho do
     que ela tem dentro e o que sobra da faixa é dividido entre elas: as seis
     ficam numa linha só, cada uma com uma linha só. Quando não couberem, o
     `flex-wrap` desce as que sobram — sem espremer código nenhum. */
  .au-bancada-fila .au-fila-item{flex:1 1 auto; border-color:var(--border);}
  /* O SELO ENCOSTA NA DIREITA DA FICHA: o estado de cada peça vira uma coluna
     que o olho desce, em vez de três pedaços amontoados à esquerda. */
  .au-bancada-fila .au-fila-item .selo{margin-left:auto;}

  /* A pergunta de sobrescrever atravessa as duas colunas: ela tem dois
     seletores e um motivo, e numa coluna estreita é onde o dedo erra o botão. */
  .au-sobrescrita{grid-column:1 / -1; grid-row:4;}
  /* ⚠️ O BOTÃO TEM TETO DE LARGURA, E ISSO É O PEDIDO DO DONO: "botão grande é
     bom na bancada, mas botão que atravessa meia tela vira faixa, não botão".
     Medido antes: com `flex:1 1 200px` ele esticava para a coluna inteira — 720
     de 1440px, exatamente meia tela. Agora ele fica em 360px, com os mesmos
     72px de altura: o que precisa ser grande é o ALVO, e a altura é que dá o
     alvo. `flex:0 1 360px` e não `width`, para no celular a regra-base
     (`flex:1 1 200px`, largura toda) continuar valendo.
     E A COLUNA DA DIREITA FOI MEDIDA PARA ELE: 360 + `gap` + a secundária dá
     527 numa coluna de 557 — o teto do botão deixou de ser um vão de 582px ao
     lado, como era quando ele morava numa coluna de 942. */
  .au-bancada-botao{flex:0 1 360px; min-height:72px;}
  /* A SECUNDÁRIA ABSORVE O QUE SOBRA DA LINHA. Sem isto restava uma tira de
     ~30px no fim da linha do botão — pouco, mas é exatamente o tipo de sobra
     que o dono enxerga. */
  .au-bancada-comandos .au-bancada-menor{flex:1 1 auto; justify-content:center;}
  /* A frase de "não há nada por gravar" e a gaveta acompanham o recuo do
     painel, para tudo começar na mesma linha vertical. */
  .au-mais{margin-top:var(--sp-4);}
}

/* O `/* ══════════════════════════════════════════════════════════════════════════
   A ABA DOS CARTÕES EAN
   ══════════════════════════════════════════════════════════════════════════ */

/* A MARCA E O NOME ANDAM JUNTOS, e o rótulo inteiro é o alvo de toque: marcar
   uma peça mirando um quadradinho de 13px no celular é a diferença entre a
   pessoa marcar a peça certa e a de baixo. 40px é o mínimo da casa. */
.au-marca-cartao{
  display:flex; align-items:center; gap:var(--sp-2);
  min-height:40px; cursor:pointer; min-width:0;
}
.au-marca-cartao input{width:18px; height:18px; flex:0 0 auto; accent-color:var(--cor-acento);}
.au-marca-cartao input:disabled{cursor:not-allowed;}
.au-marca-cartao .au-modelo{min-width:0; overflow-wrap:anywhere;}

/* ⚠️ O NÚMERO DE SÉRIE EM FONTE DE LARGURA FIXA. Ele é o que se confere contra
   o papel, caractere a caractere — e em fonte proporcional o 0 e o O, o 1 e o
   l, ficam do mesmo tamanho e a conferência falha justamente onde importa. */
.au-serie-cartao{
  font-family:ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size:var(--texto-corpo); overflow-wrap:anywhere;
}

/* A PRÉVIA. A proporção é a do cartão de verdade — 86,6 × 54,98 mm, as duas
   faces empilhadas —, então o quadro nunca corta nem sobra: 86,6 / (54,98 × 2).
   Escrito como `aspect-ratio`, ele acompanha a largura em qualquer tela sem
   ninguém precisar recalcular altura. */
.au-previa-cartao{
  margin-top:var(--sp-4);
  padding:var(--sp-3);
  border:1px solid var(--cor-borda);
  border-radius:var(--raio);
  background:var(--cor-superficie);
}
.au-previa-folha{
  width:100%; max-width:420px; aspect-ratio:86.6 / 109.96;
  border:0; display:block; margin:var(--sp-2) auto 0;
  /* O cartão tem fundo próprio (verde na frente, branco no verso). O quadro fica
     claro para a borda do cartão se ver — sem isto, o verso branco some dentro
     de um painel branco e parece que a prévia não carregou. */
  background:var(--cor-fundo);
  border-radius:var(--raio-pequeno, 6px);
}

/* O PEDIDO FICA GRUDADO NO FIM DA LISTA, e não flutuando: numa lista de 160
   peças, botão fixo na base cobre a última linha — que é justamente a que a
   pessoa acabou de marcar. */
.au-pedir-cartoes{
  flex-wrap:wrap; align-items:center; gap:var(--sp-3);
  margin-top:var(--sp-4);
}
.au-pedir-cartoes .au-aviso-menor{flex:1 1 16em; min-width:0;}
@media` do celular é a ÚLTIMA coisa deste arquivo, e tem de continuar
   sendo: duas regras de mesma especificidade, ganha a última — uma regra-base
   escrita depois daqui apagaria o ajuste de celular em silêncio.
   Medido no CSS do build antes de escrever esta linha. */
@media (max-width:520px){
  .au-topo-acao,.au-lista,.au-campo,.au-acoes{padding-left:16px;padding-right:16px;}
  .au-vazio,.au-erro,.au-instrucao,.au-secao,.au-ajuda,.au-pronto{padding-left:16px;padding-right:16px;}
  .au-botao{flex:1;}
  .au-escolha-produto > .au-aviso-menor{padding-left:16px;padding-right:16px;}
  .au-produtos{padding-left:8px;padding-right:8px;}
  /* Medido a 375px: com o `.au-botao{flex:1}` do celular, "Baixar a lista
     inteira" disputava a linha com a contagem e saía quebrado em TRÊS linhas.
     Em coluna cada um tem a sua, e o botão ocupa a largura toda. O `flex:none`
     é obrigatório: em coluna, o `flex:1` cresceria a ALTURA do botão. */
  .au-pecas-topo{flex-direction:column; align-items:stretch;}
  .au-pecas-topo .au-botao{flex:none;}
  .au-aviso-garantia{margin-left:16px; margin-right:16px;}
  /* Mesmo recuo dos campos ao lado dele, que a 520px caem para 16px. O da
     edição não entra aqui: lá o recuo é do bloco, e continua sendo. */
  .au-aviso-serie{margin-left:16px; margin-right:16px;}
  .au-aviso-serie-edicao{margin-left:0; margin-right:0;}
  /* O MODAL OCUPA A TELA NO CELULAR, com 12px de cada lado (PADRAO item 4) — os
     12px são o `padding` do fundo. `dvh` e nunca `vh`. */
  .au-guia{max-width:none; max-height:calc(100dvh - 24px);}
  .au-folha{max-width:none; max-height:calc(100dvh - 24px);}
  /* Três botões a 375px não cabem lado a lado sem espremer o alvo do dedo: aqui
     cada um ocupa a linha inteira. */
  .au-guia-acoes .au-botao{flex:1 1 100%;}

  /* ── A BANCADA A 375px ────────────────────────────────────────────────
     Vai AQUI, e não no `@media` de cima, porque as regras-base do `.au-bancada`
     são escritas DEPOIS daquele bloco: com a mesma especificidade, quem vem por
     último ganha, e lá em cima estes ajustes seriam ignorados em silêncio. */
  .au-bancada{padding-left:16px; padding-right:16px;}
  .au-mais{margin-left:16px; margin-right:16px;}
  /* O ALTO DIVIDE UMA LINHA SÓ. O seletor de lote ocupa a largura, e o nome do
     jeito de gravar e o "?" ficam lado a lado embaixo dele: empilhados, os três
     comiam 140px do alto da tela — o lugar do número da peça. */
  .au-bancada-lote{max-width:none; flex:1 1 100%;}
  .au-bancada-saidas{width:100%; justify-content:space-between;}
  /* Os anéis encolhem para a caixa do estado caber em uma linha a 375px: com
     104px sobravam 200px para o título, e "Ponha a etiqueta no leitor" saía em
     quatro linhas. Medido. */
  .au-aneis-caixa{width:72px; height:72px;}
  .au-bancada-estado{gap:var(--sp-3); padding:var(--sp-3);}
}

</style>
