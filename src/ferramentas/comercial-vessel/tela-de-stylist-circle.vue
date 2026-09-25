<template>
  <div class="tela-sty id-ferramenta">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('stylist-circle')]"
                   titulo="Vessel — Stylist Circle"
                   :subtitulo="subtitulo" @voltar="voltar">
      <!-- ── 24/09: a engrenagem que abre "Etapas do funil" (funil configurável). -->
      <template #acoes>
        <button type="button" class="btn id-btn-editar" aria-label="Etapas do funil" @click="etapasAbertas = true">
          <icone-do-bloco nome="engrenagem" /><span class="sty-rotulo-engrenagem">Etapas do funil</span></button>
      </template>
    </barra-de-topo>

    <div class="cv-largo cv-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <!-- ── A PORTA DO PROGRAMA ────────────────────────────────────────── -->
      <section class="cv-bloco">
        <h2 class="cv-etiqueta id-titulo"><icone-do-bloco nome="porta" />A porta de entrada</h2>
        <div class="cv-link">
          <div class="cv-link-texto">
            <span class="cv-link-nome">Onde a stylist se inscreve sozinha — uma vez, na vida</span>
            <code class="cv-link-url">{{ ENDERECO_DO_CIRCLE }}</code>
          </div>
          <button class="btn" @click="copiar(ENDERECO_DO_CIRCLE, 'circle')">
            {{ copiado === 'circle' ? 'Copiado' : 'Copiar' }}</button>
        </div>
        <p class="cv-nota">
          A maioria entra por aqui, e o código dela nasce sozinho. O bloco
          abaixo é para quem chega por outro caminho — telefone, indicação,
          balcão — e precisa ser cadastrada à mão.
        </p>
      </section>

      <!-- ── A BARRA "PRAÇA · EDIÇÃO" (Task 7) ────────────────────────────
           Fica acima de tudo: recorta o placar, o quadro e a lista de baixo. -->
      <barra-de-praca-e-edicao v-model:praca="pracaEscolhidaId" v-model:edicao="edicaoEscolhidaId"
                               :pracas="pracas" :edicoes="edicoesDaPraca" :sem-praca="pendenciaDePraca.semPraca.length" />
      <p v-if="erroDasPracas" class="cv-nota cv-nota-erro">{{ erroDasPracas }}</p>
      <p v-if="erroDasEdicoesDaPraca" class="cv-nota cv-nota-erro">{{ erroDasEdicoesDaPraca }}</p>

      <!-- ── O PLACAR DA EDIÇÃO (T11 → Task 7) ─────────────────────────────
           ⚠️ NENHUM NÚMERO DAQUI SE DIGITA — sai de `vessel_placar_da_edicao`,
           e TODA TAXA VEM COM DE QUANTOS ELA SAIU (`taxasDoPlacar`, testada). -->
      <placar-do-stylist-circle v-if="!erro" :edicao-id="edicaoEscolhidaId" :placar="placar"
                                :carregando="carregandoPlacar" :erro="erroDoPlacar"
                                :pracas-abertas="pracasAbertas" :carregando-pracas-abertas="carregandoPracasAbertas"
                                :erro-pracas-abertas="erroPracasAbertas"
                                @escolher="({ pracaId, edicaoId }) => { pracaEscolhidaId = pracaId; edicaoEscolhidaId = edicaoId }" />

      <!-- ⚠️ 24/09/2026: QUEM ESTÁ HOJE EM CADA SAÍDA, POR MOTIVO. Não é da
           edição (é o retrato de hoje, de TODAS as stylists da tela); zeros
           escondidos; sem ninguém em saída, o bloco some. -->
      <section v-if="!erro && saidas.length" class="cv-bloco">
        <div class="id-grupo cv-grupo-saidas">
          <h3 class="cv-etiqueta id-titulo"><icone-do-bloco nome="funil" />Saídas por motivo</h3>
          <div class="cv-saidas">
            <div v-for="sd in saidas" :key="sd.etapa" class="cv-saida">
              <p class="cv-saida-titulo"><b>{{ sd.etapa }}</b> · {{ sd.total === 1 ? '1 parceira' : `${sd.total} parceiras` }} hoje</p>
              <ul v-if="sd.linhas.length" class="cv-saida-linhas">
                <li v-for="l in sd.linhas" :key="l.nome"><span>{{ l.nome }}</span><b>{{ l.n }}</b></li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <!-- ── CADASTRAR ──────────────────────────────────────────────────── -->
      <section v-if="podeExecutarAcao('criar', podeEditar)" class="cv-bloco id-bloco-form">
        <h2 class="cv-etiqueta id-titulo"><icone-do-bloco nome="novo" />Cadastrar parceira</h2>
        <div class="cv-form">
          <label class="cv-campo" for="sty-nome"><span>Nome</span>
            <input id="sty-nome" type="text" maxlength="120" v-model="novo.nome"></label>
          <label class="cv-campo" for="sty-whatsapp"><span>WhatsApp</span>
            <input id="sty-whatsapp" type="text" maxlength="20" v-model="novo.whatsapp"
                   placeholder="(19) 99999-9999"></label>
          <label class="cv-campo" for="sty-cidade"><span>Cidade</span>
            <input id="sty-cidade" type="text" maxlength="80" v-model="novo.cidade"></label>
          <label class="cv-campo" for="sty-instagram"><span>Instagram</span>
            <input id="sty-instagram" type="text" maxlength="60" v-model="novo.instagram"
                   placeholder="@perfil"></label>
          <label class="cv-campo" for="sty-atuacao"><span>Atuação</span>
            <input id="sty-atuacao" type="text" maxlength="60" v-model="novo.atuacao"
                   placeholder="stylist, personal shopper…"></label>
          <label class="cv-campo" for="sty-praca"><span>Praça</span>
            <select id="sty-praca" v-model="novo.praca">
              <option value="">Escolha…</option>
              <option v-for="p in pracas" :key="p.id" :value="p.sigla">{{ p.nome }}</option>
            </select></label>
          <label class="cv-campo" for="sty-loja"><span>Loja relacionada</span>
            <select id="sty-loja" v-model="novo.loja">
              <option value="">Escolha…</option>
              <option v-for="(nome, chave) in LOJAS" :key="chave" :value="chave">{{ nome }}</option>
            </select></label>
          <label class="cv-campo" for="sty-origem"><span>Como ela chegou</span>
            <select id="sty-origem" v-model="novo.comoChegou">
              <option value="">Escolha…</option>
              <option v-for="(rotulo, chave) in ORIGENS_DE_CONTATO" :key="chave" :value="chave">{{ rotulo }}</option>
            </select></label>
          <label class="cv-campo" for="sty-responsavel"><span>Responsável</span>
            <input id="sty-responsavel" type="text" maxlength="80" v-model="novo.responsavel"></label>
          <label class="cv-campo cv-campo-largo" for="sty-proxima"><span>Próxima ação</span>
            <input id="sty-proxima" type="text" maxlength="120" v-model="novo.proximaAcao"
                   placeholder="Ex.: ligar para apresentar o Circle"></label>
          <label class="cv-campo" for="sty-proxima-em"><span>Até quando</span>
            <input id="sty-proxima-em" type="date" v-model="novo.proximaAcaoEm"></label>
          <label class="cv-campo cv-campo-largo" for="sty-observacoes"><span>Observações</span>
            <textarea id="sty-observacoes" maxlength="2000" v-model="novo.observacoes"
                      placeholder="E-mail, site, o que se sabe dela e não tem campo"></textarea></label>
        </div>
        <!-- ⚠️ WHATSAPP OU INSTAGRAM (24/09/2026): um dos dois basta. -->
        <p class="cv-nota">Sem WhatsApp? O Instagram basta — escreva o @ ou o endereço do perfil.</p>
        <!-- ⚠️ SEM CONTATO AINDA (24/09/2026, decisão do dono): com a caixa
             marcada ela entra sem os dois, com o selo "Sem contato ainda", e
             alguém completa depois. Escrever um contato desliga a marca. -->
        <label class="cv-marcar" for="sty-sem-contato">
          <input id="sty-sem-contato" type="checkbox" v-model="novo.semContato">
          <span>Ainda sem contato — alguém vai completar</span></label>
        <!-- ⚠️ 24/09: SEM DATA DA PROSPECÇÃO NO FORMULÁRIO — quem a põe é a
             etapa marcada "conta como prospectada" (tela Etapas do funil). -->
        <p class="cv-nota">Ela entra em <b>{{ primeiraEtapa(etapas)?.nome || 'a primeira etapa do funil' }}</b>.
          A data da prospecção nasce sozinha, quando ela chegar na etapa que conta como prospectada.</p>

        <!-- ⚠️ O CÓDIGO NÃO EXISTE COMO CAMPO: quem gera é o banco, no formato
             STY-0000, e a resposta abaixo mostra o que ele criou. -->
        <ul v-if="problemas.length" class="cv-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <p v-if="erroAoCriar" class="cv-nota cv-nota-erro">{{ erroAoCriar }}</p>
        <p v-if="criado" class="cv-nota cv-nota-ok">
          Parceira <b>{{ criado.codigo }}</b> cadastrada. O link dela está logo abaixo.
        </p>
        <div v-if="criado" class="cv-link">
          <div class="cv-link-texto">
            <span class="cv-link-nome">O link dela — story, bio, conversa</span>
            <code class="cv-link-url">{{ enderecoDaStylist(criado.codigo) }}</code>
          </div>
          <button class="btn" @click="copiar(enderecoDaStylist(criado.codigo), 'novo')">
            {{ copiado === 'novo' ? 'Copiado' : 'Copiar' }}</button>
        </div>

        <div class="cv-acoes">
          <button class="btn btn-principal" :disabled="problemas.length > 0 || criando"
                  @click="criar">{{ criando ? 'Cadastrando…' : 'Cadastrar parceira' }}</button>
        </div>
      </section>

      <!-- ── BUSCAR, FILTRAR E ORDENAR ──────────────────────────────────────
           ⚠️ SEM PERÍODO E SEM LOJA: esta é uma lista de PARCEIRAS, não de
           eventos numa loja — ligar um "Período" da barra a algo aqui não
           faria sentido nenhum e não tem para onde apontar no banco.
           ⚠️ SEM "Mais nova primeiro" TAMBÉM, DE PROPÓSITO:
           `vessel_rastreio_dos_stylists` não devolve data de criação nenhuma
           (nem `criado_em`, nem `quando`) — `filtrar()` (`filtros.js`)
           ordenaria por uma data que não existe, e o resultado seria a MESMA
           ordem de sempre, sem avisar ninguém. Uma opção que a pessoa escolhe
           e que não muda nada na tela é a mesma família de mentira que os
           campos que o banco escondia: oferecer o que a tela não consegue
           entregar. Quando a função devolver uma data de cadastro de
           verdade, esta opção volta. -->
      <barra-de-lista v-model="filtro" :estagios="etapasParaFiltrar(etapas)"
                      :mostrar="['busca', 'situacao', 'estagio', 'ordem']"
                      placeholder-busca="nome, cidade ou código"
                      :situacoes="[
                        { valor: 'abertas', rotulo: 'Só ativas' },
                        { valor: 'encerradas', rotulo: 'Só desativadas' },
                        { valor: 'todas', rotulo: 'Todas' },
                        { valor: SITUACAO_SEM_CONTATO, rotulo: 'Sem contato ainda' },
                      ]"
                      :ordens="[
                        { valor: 'nome', rotulo: 'Nome' },
                        { valor: 'aberturas', rotulo: 'Quem traz mais tráfego' },
                        { valor: 'faixa', rotulo: 'Faixa da nota (A primeiro)' },
                      ]" />

      <!-- ── AS DUAS VISTAS (T11) — o quadro é a leitura padrão; a lista
           inteira (placar por pessoa, corrigir, desativar) continua igual,
           atrás da aba "Lista". A escolha fica no aparelho. -->
      <div class="cv-escolha cv-vistas" role="tablist" aria-label="Vista">
        <button type="button" role="tab" class="btn" :class="{ ativa: vista === 'quadro' }"
                :aria-selected="vista === 'quadro'" @click="trocarVista('quadro')">Quadro</button>
        <button type="button" role="tab" class="btn" :class="{ ativa: vista === 'lista' }"
                :aria-selected="vista === 'lista'" @click="trocarVista('lista')">Lista</button>
      </div>
      <!-- ⚠️ A RECUSA DE MOVER FICA AQUI, PERTO DO QUADRO — não na faixa de
           erro da tela (essa é só para falha de LEITURA). Some sozinha na
           próxima gravação que der certo, ou no "Dispensar". -->
      <template v-if="vista === 'quadro' && erroDoQuadro">
        <p class="cv-nota cv-nota-erro">{{ erroDoQuadro }}</p>
        <div class="cv-acoes">
          <button type="button" class="btn" @click="erroDoQuadro = ''">Dispensar</button>
        </div>
      </template>
      <!-- ⚠️ 24/09: A NOTA DA QUALIFICAÇÃO SÓ APARECE SE A LEITURA DELA DEU
           CERTO. Com a leitura falhando, "Sem nota" em todo mundo seria uma
           afirmação falsa: o selo some e o aviso diz por quê. -->
      <p v-if="erroDasFaixas && !carregando && !erro" class="cv-nota cv-nota-erro">{{ erroDasFaixas }}</p>
      <p v-if="vista === 'quadro' && avisoDoQuadro" class="cv-nota cv-nota-ok" role="status">{{ avisoDoQuadro }}</p>
      <quadro-do-stylist-circle v-if="vista === 'quadro' && !carregando && !erro" :stylists="stylistsNaTela" :etapas="etapas"
                                :pode-editar="podeExecutarAcao('editar', podeEditar)" :hoje="hojeLocal"
                                :movendo-codigo="movendoCodigo" :mostrar-faixa="vigentes !== null"
                                :ordem="filtro.ordem"
                                @abrir="fichaAberta = $event" @mover="mover" />

      <div v-if="carregando" class="cv-carregando">Carregando…</div>

      <!-- ⚠️ O QUE VEM AQUI SÓ APARECE NA VISTA "LISTA" — o carregando de cima
           sobe para fora, porque ele vale para as duas vistas. -->
      <template v-if="vista === 'lista'">
        <!-- ── COMO LER ─────────────────────────────────────────────────── -->
        <section v-if="!carregando && !erro && stylists.length" class="cv-bloco cv-bloco-leitura id-bloco-leitura">
          <h2 class="cv-etiqueta id-titulo"><icone-do-bloco nome="leitura" />Como ler os números</h2>
          <p class="cv-nota cv-nota-primeira">
            <b>Aberturas</b> é leitura do link, não pessoa: a mesma cliente abrindo
            duas vezes conta duas. <b>Clientes</b> é gente com nome e WhatsApp.
            A conta entre as duas é aproximada justamente por isso — e por isso ela
            vem sempre com o número de quem a compõe.
          </p>
          <p class="cv-nota">
            <b>Pedidos por cliente</b> não é percentual, e é de propósito: a mesma
            cliente pode pedir visita duas vezes, então o número pode passar de 1.
            Mostrar isso como “taxa de 140%” faria quem lê desconfiar da tela — com
            razão.
          </p>
          <p class="cv-nota">
            <b>Receita</b> é a compra das clientes da stylist na janela declarada ao
            lado do valor. Não existe no dado nenhum campo dizendo “esta compra veio
            desta stylist”: o que existe é a mesma pessoa comprando perto da visita
            que ela trouxe.
          </p>
          <p class="cv-nota">
            <b>Desativada</b> não é apagada: ela sai da lista de escolher (quem
            marca um encontro não vê mais o código dela) e do topo desta tela, mas
            as aberturas e os atendimentos que ela já trouxe continuam contando no
            histórico. O filtro "Situação" traz ela de volta para quem precisar
            olhar.
          </p>
        </section>

        <template v-if="!carregando && !erro">
        <!-- ── O CONJUNTO ───────────────────────────────────────────────── -->
        <section v-if="stylists.length" class="cv-bloco">
          <h2 class="cv-etiqueta id-titulo"><icone-do-bloco nome="conjunto" />Todas as stylists juntas</h2>
          <!-- ⚠️ O CONJUNTO É SOBRE O QUE ESTÁ NA TELA, NÃO SOBRE O QUE VEIO
               DO BANCO: se a pessoa filtrou por situação ou estágio, o total
               tem de acompanhar — reusar o total de antes do filtro é a tela
               mentindo com número certo. `calcularConjunto` só soma o que
               RECEBE (stylist-circle-regras.js), e aqui ela sempre recebe
               `stylistsNaTela`, nunca `stylists`. -->
          <p class="cv-nota cv-nota-primeira">
            {{ stylistsNaTela.length }} de {{ stylists.length }} stylists
            (o filtro de cima decide quais).
          </p>
          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ conjunto.totalStylists }}</span>
              <span class="cv-numero-rotulo">Stylists</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ conjunto.totalAberturas }}</span>
              <span class="cv-numero-rotulo">Aberturas de link</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emPorcento(conjunto.conjuntoClientes.valor) }}</span>
              <span class="cv-numero-rotulo">Viraram cliente</span>
              <span class="cv-numero-base">{{ taxaEscrita(conjunto.conjuntoClientes) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emReais(conjunto.totalReceita) }}</span>
              <span class="cv-numero-rotulo">Receita pelo link, somada</span>
              <span class="cv-numero-base">{{ janelaEscrita(conjunto.janela) }}</span>
            </div>
          </div>
          <p class="cv-nota">
            As taxas do conjunto somam numeradores e denominadores — não é a média
            das taxas de cada stylist, que daria a quem teve 2 aberturas o mesmo
            peso de quem teve 200.
          </p>
        </section>

        <!-- ── CADA STYLIST ─────────────────────────────────────────────── -->
        <section v-for="s in stylistsNaTela" :key="s.codigo" class="cv-bloco id-cartao" :class="`id-tom-${tomDaStylist(s)}`">
          <div class="cv-cabeca">
            <div class="cv-cabeca-texto">
              <h2 class="cv-titulo">{{ s.nome || s.codigo }}</h2>
              <p class="cv-sub">
                <span class="cv-codigo">{{ s.codigo }}</span>
                <span v-if="s.cidade"> · {{ s.cidade }}</span>
                <span v-if="s.praca_preview"> · preview em {{ s.praca_preview }}</span>
                <span v-if="s.loja"> · loja {{ LOJAS[s.loja] || s.loja }}</span>
              </p>
              <p class="cv-sub">
                {{ ORIGENS_DE_CONTATO[s.origem_contato] || s.origem_contato }}
                <span v-if="s.prospectado_em"> · prospectada em {{ dataLegivel(s.prospectado_em) }}</span>
                <span v-if="s.responsavel"> · com {{ s.responsavel }}</span>
              </p>
              <!-- 24/09: o contato fácil (abre o WhatsApp/Instagram; NÃO registra contato). -->
              <div class="cv-acoes"><contato-facil :stylist="s" /></div>
            </div>
            <!-- ⚠️ ETAPA E SITUAÇÃO SÃO DUAS COISAS. A etapa é uma linha de
                 `vessel_stylist_etapas` (configurável desde 24/09/2026), e
                 onde ela está na jornada não tem nada a ver com "ativa" como SITUAÇÃO da
                 parceria (ela continua com a gente). Quando as duas
                 coincidiam, as regras antigas imprimiam "Ativa" duas vezes
                 empilhado — lido na tela, parece bug de renderização
                 duplicada, não duas informações. A situação só é digna de um
                 selo à parte quando é a exceção: "Desativada". Continuar
                 ativa é o normal, não precisa de selo — só o estágio aparece
                 sozinho nesse caso, sem duplicar a palavra. -->
            <div class="cv-selos">
              <span v-if="s.ativa === false" class="cv-selo id-selo cv-selo-fim id-tom-parada">Desativada</span>
              <span v-if="seloSemContato(s)" class="cv-selo id-selo cv-selo-sem-contato" :class="`id-tom-${seloSemContato(s).tom}`">
                {{ seloSemContato(s).texto }}</span>
              <span class="cv-selo id-selo" :class="[seloDaEtapa(s).classe, `id-tom-${seloDaEtapa(s).tom}`]">
                {{ seloDaEtapa(s).texto }}</span>
              <span v-if="vigentes !== null" class="cv-selo id-selo cv-selo-faixa" :class="`id-tom-${seloDaFaixa(s).tom}`">
                {{ seloDaFaixa(s).texto }}</span>
            </div>
          </div>

          <p v-if="s.proxima_acao" class="cv-nota cv-nota-aviso cv-nota-primeira">
            <b>Próxima ação:</b> {{ s.proxima_acao }}<span v-if="s.proxima_acao_em">
              — até {{ dataLegivel(s.proxima_acao_em) }}</span>
          </p>

          <h3 class="cv-etiqueta cv-etiqueta-interna id-subtitulo">Os encontros dela</h3>
          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.encontros_realizados || 0 }}</span>
              <span class="cv-numero-rotulo">Realizados</span>
              <span class="cv-numero-base">{{ s.ativada_em ? `ativada em ${dataLegivel(dataDoInstante(s.ativada_em))}` : 'ainda não ativada' }}</span>
              <span v-if="s.private_edit_agendado_em" class="cv-numero-base">1º Private Edit agendado em {{ dataLegivel(dataDoInstante(s.private_edit_agendado_em)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.ultima_private_edit ? dataLegivel(s.ultima_private_edit) : '—' }}</span>
              <span class="cv-numero-rotulo">Última Private Edit</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.proxima_data_permitida ? dataLegivel(s.proxima_data_permitida) : '—' }}</span>
              <span class="cv-numero-rotulo">Próxima data permitida</span>
              <span class="cv-numero-base">último encontro + 45 dias</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emReais(s.receita_dos_encontros) }}</span>
              <span class="cv-numero-rotulo">Receita dos encontros</span>
              <span class="cv-numero-base">{{ janelaEscrita(s.janela_de_venda_em_dias) }}</span>
            </div>
          </div>

          <h3 class="cv-etiqueta cv-etiqueta-interna id-subtitulo">O link dela, em números</h3>
          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.aberturas }}</span>
              <span class="cv-numero-rotulo">Abriram o link</span>
              <span class="cv-numero-base">leituras, não pessoas</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.clientes }}</span>
              <span class="cv-numero-rotulo">Viraram cliente</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaCliente(s)) }}</span>
              <span v-if="margemEscrita(taxaCliente(s))" class="cv-numero-margem">
                {{ margemEscrita(taxaCliente(s)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.pedidos }}</span>
              <span class="cv-numero-rotulo">Pedidos de visita</span>
              <!-- ⚠️ RAZÃO, não taxa: a mesma cliente pode pedir duas vezes. -->
              <span class="cv-numero-base">{{ razaoEscrita(pedidosPorCliente(s), 'por cliente') }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.compareceram }}</span>
              <span class="cv-numero-rotulo">Foram à loja</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaPresenca(s)) }} dos pedidos</span>
              <span v-if="margemEscrita(taxaPresenca(s))" class="cv-numero-margem">
                {{ margemEscrita(taxaPresenca(s)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emReais(s.receita) }}</span>
              <span class="cv-numero-rotulo">Receita pelo link</span>
              <span class="cv-numero-base">{{ janelaEscrita(s.janela_de_venda_em_dias) }}</span>
            </div>
          </div>

          <h3 class="cv-etiqueta cv-etiqueta-interna id-subtitulo">O link dela</h3>
          <div class="cv-link">
            <div class="cv-link-texto">
              <span class="cv-link-nome">O permanente — story, bio, conversa</span>
              <code class="cv-link-url">{{ enderecoDaStylist(s.codigo) }}</code>
            </div>
            <button class="btn" @click="copiar(enderecoDaStylist(s.codigo), s.codigo)">
              {{ copiado === s.codigo ? 'Copiado' : 'Copiar' }}</button>
          </div>
          <p class="cv-nota">
            <b>Código nunca muda</b>: ele está dentro deste link, já colado em
            stories e conversas antigas — trocá-lo mataria os links em
            circulação e a atribuição das aberturas já contadas.
          </p>

          <!-- ── CORRIGIR (inline, sem modal) ─────────────────────────────
               ⚠️ ORIGEM NÃO ENTRA AQUI, DE PROPÓSITO: `origem_canal`,
               `origem_campanha` e `origem_utm` nem existem como parâmetro de
               `vessel_stylist_editar` — primeiro toque é primeiro toque, e
               reescrever faria a atribuição contar o mesmo canal duas vezes. -->
          <div v-if="podeExecutarAcao('editar', podeEditar) && editando === s.codigo" class="id-caixa-form">
            <h3 class="cv-etiqueta cv-etiqueta-interna id-titulo"><icone-do-bloco nome="editar" />Corrigir</h3>
            <div class="cv-form">
              <label class="cv-campo" :for="`ed-nome-${s.codigo}`"><span>Nome</span>
                <input :id="`ed-nome-${s.codigo}`" type="text" maxlength="120" v-model="rascunho.nome"></label>
              <label class="cv-campo" :for="`ed-whatsapp-${s.codigo}`"><span>WhatsApp</span>
                <input :id="`ed-whatsapp-${s.codigo}`" type="text" maxlength="20" v-model="rascunho.whatsapp"></label>
              <label class="cv-campo" :for="`ed-cidade-${s.codigo}`"><span>Cidade</span>
                <input :id="`ed-cidade-${s.codigo}`" type="text" maxlength="80" v-model="rascunho.cidade"></label>
              <label class="cv-campo" :for="`ed-instagram-${s.codigo}`"><span>Instagram</span>
                <input :id="`ed-instagram-${s.codigo}`" type="text" maxlength="60" v-model="rascunho.instagram"></label>
              <label class="cv-campo" :for="`ed-atuacao-${s.codigo}`"><span>Atuação</span>
                <input :id="`ed-atuacao-${s.codigo}`" type="text" maxlength="60" v-model="rascunho.atuacao"></label>
              <!-- ⚠️ A ETAPA NÃO SE CORRIGE AQUI (24/09/2026): é na ficha ou
                   no quadro, e cada mudança fica no histórico de etapas. -->
              <label class="cv-campo" :for="`ed-praca-${s.codigo}`"><span>Praça</span>
                <select :id="`ed-praca-${s.codigo}`" v-model="rascunho.praca">
                  <option value="">Escolha…</option>
                  <option v-for="p in pracas" :key="p.id" :value="p.sigla">{{ p.nome }}</option>
                </select></label>
              <label class="cv-campo" :for="`ed-loja-${s.codigo}`"><span>Loja relacionada</span>
                <select :id="`ed-loja-${s.codigo}`" v-model="rascunho.loja">
                  <option value="">Escolha…</option>
                  <option v-for="(nome, chave) in LOJAS" :key="chave" :value="chave">{{ nome }}</option>
                </select></label>
              <label class="cv-campo" :for="`ed-chegou-${s.codigo}`"><span>Como ela chegou</span>
                <select :id="`ed-chegou-${s.codigo}`" v-model="rascunho.comoChegou">
                  <option v-for="(rotulo, chave) in ORIGENS_DE_CONTATO" :key="chave" :value="chave">{{ rotulo }}</option>
                </select></label>
              <label class="cv-campo" :for="`ed-responsavel-${s.codigo}`"><span>Responsável</span>
                <input :id="`ed-responsavel-${s.codigo}`" type="text" maxlength="80" v-model="rascunho.responsavel"></label>
              <label class="cv-campo cv-campo-largo" :for="`ed-proxima-${s.codigo}`"><span>Próxima ação</span>
                <input :id="`ed-proxima-${s.codigo}`" type="text" maxlength="120" v-model="rascunho.proximaAcao"
                       :disabled="rascunho.acaoFeita"></label>
              <label class="cv-campo" :for="`ed-proxima-em-${s.codigo}`"><span>Até quando</span>
                <input :id="`ed-proxima-em-${s.codigo}`" type="date" v-model="rascunho.proximaAcaoEm"
                       :disabled="rascunho.acaoFeita"></label>
              <label class="cv-campo cv-campo-largo" :for="`ed-observacoes-${s.codigo}`"><span>Observações</span>
                <textarea :id="`ed-observacoes-${s.codigo}`" maxlength="2000" v-model="rascunho.observacoes"></textarea></label>
              <!-- ⚠️ SEM CONTATO AINDA: escrever o WhatsApp ou o Instagram
                   desliga a marca sozinho, no banco. -->
              <label v-if="s.sem_contato || (!s.whatsapp && !s.instagram)" class="cv-marcar" :for="`ed-sem-contato-${s.codigo}`">
                <input :id="`ed-sem-contato-${s.codigo}`" type="checkbox" v-model="rascunho.semContato">
                <span>Ainda sem contato — alguém vai completar</span></label>
              <label v-if="s.proxima_acao" class="cv-marcar" :for="`ed-feita-${s.codigo}`">
                <input :id="`ed-feita-${s.codigo}`" type="checkbox" v-model="rascunho.acaoFeita">
                <span>A próxima ação foi feita — apagar</span></label>
            </div>
            <p class="cv-nota">
              <b>Código nunca muda</b> — está dentro do link já colado por aí.
              <b>Origem não se corrige</b>: primeiro toque é primeiro toque.
            </p>
            <p v-if="erroDeEditar === s.codigo" class="cv-nota cv-nota-erro">{{ mensagemEditar }}</p>
            <div class="cv-acoes">
              <button class="btn" :disabled="salvandoEdicao === s.codigo" @click="fecharEditar">Cancelar</button>
              <button class="btn btn-principal" :disabled="salvandoEdicao === s.codigo"
                      @click="salvarEdicao(s)">{{ salvandoEdicao === s.codigo ? 'Salvando…' : 'Salvar' }}</button>
            </div>
          </div>

          <div class="cv-acoes">
            <template v-if="podeExecutarAcao('editar', podeEditar)">
              <button v-if="editando !== s.codigo" class="btn" @click="abrirEditar(s)">Corrigir…</button>
            </template>

            <!-- ⚠️ R13: Desativar E Reativar são o MESMO botão (a mesma
                 chamada, com `p_ativa` trocado) atrás do MESMO gate de
                 editar — as duas telas irmãs (Private Edit, Beauty Session)
                 levaram Critical exatamente por deixar o `v-else` desta
                 dupla fora do `v-if` que já protegia a outra metade. A regra
                 mora em `podeExecutarAcao` (stylist-circle-regras.js),
                 testada — não reescrita aqui como um `v-if` solto de novo. -->
            <template v-if="podeExecutarAcao('desativar', podeEditar)">
              <template v-if="s.ativa !== false">
                <button v-if="confirmando !== s.codigo" class="btn"
                        @click="confirmando = s.codigo">Desativar…</button>
                <template v-else>
                  <span class="cv-confirma">Ela sai da lista de escolher. As
                    aberturas e os atendimentos que ela trouxe continuam
                    contando no histórico.</span>
                  <button class="btn" @click="confirmando = null">Deixar como está</button>
                  <button class="btn" :disabled="mexendo === s.codigo"
                          @click="desativar(s, false)">Desativar</button>
                </template>
              </template>
              <button v-else class="btn" :disabled="mexendo === s.codigo"
                      @click="desativar(s, true)">Reativar</button>
            </template>
          </div>
          <p v-if="erroAoMexer === s.codigo" class="cv-nota cv-nota-erro">{{ mensagemMexer }}</p>
        </section>

        <p v-if="!stylistsNaTela.length && stylists.length" class="cv-vazio">
          Nenhuma stylist passa neste filtro. Experimente "Todas" ou outra busca.
        </p>
        <p v-if="!stylists.length" class="cv-vazio">
          Nenhuma stylist inscrita ainda. Ela entra pela porta de cima, ou
          cadastre a primeira no bloco acima.
        </p>
        </template>
      </template>
    </div>

    <ficha-da-stylist v-if="fichaAberta && stylistDaFicha" :stylist="stylistDaFicha" :etapas="etapas"
                      :pode-editar="podeExecutarAcao('editar', podeEditar)" :chamar="chamar"
                      @fechar="fichaAberta = null" @mudou="carregar({ silencioso: true })"
                      @corrigir="corrigirDaFicha" />
    <!-- 24/09/2026: soltar numa saída com motivos pergunta o motivo antes de gravar. -->
    <escolha-do-motivo v-if="motivoPendente" :etapa="motivoPendente.etapa" :nome="motivoPendente.nome"
                       :gravando="movendoCodigo === motivoPendente.codigo" :erro="erroDoMotivo"
                       @cancelar="motivoPendente = null; erroDoMotivo = ''"
                       @confirmar="(m) => gravarMovimento(motivoPendente.codigo, motivoPendente.etapa.id, m)" />
    <etapas-do-funil v-if="etapasAbertas" :etapas="etapas" :chamar="chamar"
                     :pode-editar="podeExecutarAcao('editar', podeEditar)"
                     @fechar="etapasAbertas = false" @mudou="carregar({ silencioso: true })" />
  </div>
</template>

<script setup>
/* VESSEL — STYLIST CIRCLE: o que cada stylist trouxe, e agora também
 * cadastrar, corrigir e desativar uma parceira.
 *
 * ⚠️ A INSCRIÇÃO PELA PORTA PÚBLICA CONTINUA SENDO O CAMINHO PRINCIPAL — o
 * bloco "Cadastrar parceira" é para quem chega por outro canal (telefone,
 * indicação, balcão) e não passou pela LP. As duas portas geram o MESMO
 * formato de código (`vessel_stylist_criar` gera do mesmo jeito que
 * `vessel_stylist_entrar`), e a diferença fica só em `origem_canal`: quem
 * entra pela LP carrega canal/campanha/UTM; quem é cadastrada aqui nasce com
 * origem nula, de propósito (ninguém "adquiriu" essa parceira por campanha
 * nenhuma) — ver o comentário de `vessel_stylist_criar` na migration.
 *
 * ⚠️ LÊ COM O TOKEN DA SESSÃO, NUNCA COM A CHAVE ANÔNIMA: a função confere
 * `is_vessel_atendimentos()` por dentro, e com a chave anônima o PostgREST
 * responde 200 com lista VAZIA — "nenhuma stylist" para um programa cheio.
 *
 * ⚠️ T11 (22/09/2026): o funil virou lista fechada, a ficha ganhou loja,
 * origem do contato, responsável e próxima ação, e a tela ganhou O PLACAR —
 * que TEM período, só dele, num seletor próprio dentro do bloco. A barra da
 * lista continua sem período nenhum.
 *
 * ⚠️ SEM PERÍODO NENHUM NESTA BARRA (R do controlador): esta tela é uma lista
 * de PARCEIRAS, não de eventos numa loja/data. `p_dias` (14, cravado abaixo)
 * só decide a janela de atribuição de venda que já vem dentro de cada linha
 * (`janela_de_venda_em_dias`) — nunca filtra quem aparece. Por isso não existe
 * aqui nenhum observador sobre o campo de dias do filtro.
 *
 * ⚠️ DESATIVADA PRECISA DE RE-FETCH, NÃO DE FILTRO CLIENT-SIDE (o mesmo R1 das
 * irmãs, com outro nome): `vessel_rastreio_dos_stylists` já chega SEM quem
 * está desativada (`p_incluir_desativadas boolean default false`). Só quando
 * a situação escolhida é "Só desativadas" ou "Todas" a tela volta ao banco
 * pedindo `p_incluir_desativadas: true` — ver `precisaDasDesativadas` em
 * `stylist-circle-regras.js` (NÃO é `precisaDoBanco` de `filtros.js`: aquela
 * fala de "arquivada", que esta tela não tem).
 *
 * ⚠️ E "PEDIDOS ÷ CLIENTES" NÃO É TAXA. A mesma cliente pode pedir visita duas
 * vezes, então o número passa de 1 — mostrar "140%" num campo rotulado como
 * taxa faz quem lê desconfiar da tela inteira, com razão. Vai como razão.
 */
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import BarraDeLista from './barra-de-lista.vue'
import QuadroDoStylistCircle from './quadro-do-stylist-circle.vue'
import FichaDaStylist from './ficha-da-stylist.vue'
import EtapasDoFunil from './etapas-do-funil.vue'
import ContatoFacil from './contato-facil.vue'
import EscolhaDoMotivo from './escolha-do-motivo.vue'
import BarraDePracaEEdicao from './barra-de-praca-e-edicao.vue'
import PlacarDoStylistCircle from './placar-do-stylist-circle.vue'
import {
  etapasParaFiltrar, primeiraEtapa, mensagemDasEtapas, pedeMotivo, avisoDeLiberada, saidasPorMotivo,
} from './crm-da-stylist-regras.js'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import { estado, hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import { enderecoDaStylist, ENDERECO_DO_CIRCLE, dataLegivel } from './enderecos-publicos.js'
import {
  proporcao, razao, razaoEscrita, taxaEscrita, margemEscrita,
  emPorcento, emReais, janelaEscrita,
} from './estatistica.js'
import { filtrar, FILTRO_VAZIO } from './filtros.js'
import {
  podeExecutarAcao, calcularConjunto, precisaDasDesativadas, problemasDaParceira,
  mensagemDeCriar, mensagemDeEditar, mensagemDeDesativar,
  semContatoParaMandar, seloSemContato, SITUACAO_SEM_CONTATO, filtroDaBarra, soAsSemContato,
} from './stylist-circle-regras.js'
import { paiDaTela, ROTULO_DO_PAI } from './navegacao.js'
import { seloDaEtapa, tomDaStylist, ORIGENS_DE_CONTATO, LOJAS } from './t11-regras.js'
import { comFaixa, seloDaFaixa } from './qualificacao-regras.js'
import { pendenciasDePraca } from './praca-regras.js'

const router = useRouter()
function voltar() { router.push({ name: paiDaTela('stylist-circle') }) }

// ⚠️ 25/09/2026 (Task 7): A LISTA DE PRAÇAS CRAVADA NO CÓDIGO SAIU DAQUI —
// as quatro siglas fixas de antes faziam ninguém cadastrar stylist de
// Limeira ou Piracicaba pela tela. Agora é `pracas` (abaixo), lida do
// cadastro de verdade (`vessel_pracas_listar`).

// ⚠️ A JANELA DE ATRIBUIÇÃO DE VENDA — não é o período da barra (que nem
// existe nesta tela). T11: D0 a D+14, a MESMA do Private Edit e do placar.
// Antes era 7 aqui e 14 lá, e a mesma stylist tinha duas receitas.
const P_DIAS = 14

const podeEditar = computed(() => hasPermission('atendimentos.stylist-circle', 'editar'))

// ── PRAÇA · EDIÇÃO (Task 7) — a barra manda ─────────────────────────────────
// `null` nos dois é "todas as praças, sem edição escolhida" — o comportamento
// de sempre. Trocar de praça já chega com a edição limpa (a própria barra
// emite os dois: ver barra-de-praca-e-edicao.vue).
const pracas = ref([])
const erroDasPracas = ref('')
const pracaEscolhidaId = ref(null)
const edicaoEscolhidaId = ref(null)
const edicoesDaPraca = ref([])
const erroDasEdicoesDaPraca = ref('')

async function carregarPracas() {
  erroDasPracas.value = ''
  try {
    pracas.value = await chamar('vessel_pracas_listar', {}) || []
  } catch {
    pracas.value = []
    erroDasPracas.value = 'Não consegui ler o cadastro de praças agora. Tente de novo em um instante.'
  }
  carregarPracasAbertas()
}

async function carregarEdicoesDaPraca() {
  erroDasEdicoesDaPraca.value = ''
  if (!pracaEscolhidaId.value) { edicoesDaPraca.value = []; return }
  try {
    edicoesDaPraca.value = await chamar('vessel_edicoes_listar', { p_praca_id: pracaEscolhidaId.value }) || []
  } catch {
    // ⚠️ RODADA 1 DE CONSERTO (CRÍTICO 1): antes o catch só esvaziava a
    // lista, calado — o select ficava só com "Todas as edições desta praça"
    // e quem olhava concluía "esta praça não tem edição". A tela nunca mente
    // (PADRAO, item 9): a falha de leitura escreve a própria mensagem.
    edicoesDaPraca.value = []
    erroDasEdicoesDaPraca.value = 'Não consegui ler as edições desta praça agora. Tente de novo em um instante.'
  }
}
watch(pracaEscolhidaId, carregarEdicoesDaPraca, { immediate: true })

// ⚠️ DECISÃO 1 DO DONO: sem edição escolhida, o placar mostra uma linha por
// praça com edição ABERTA (nunca soma edição de praça diferente).
// ⚠️ RODADA 1 DE CONSERTO (MENOR 8): UMA chamada só — `vessel_edicoes_listar`
// com `p_praca_id` nulo já devolve TODAS as edições, ordenadas por praça —
// nada de uma chamada por praça (o N+1 de antes).
const pracasAbertas = ref([])
const carregandoPracasAbertas = ref(false)
const erroPracasAbertas = ref('')
async function carregarPracasAbertas() {
  if (edicaoEscolhidaId.value || !pracas.value.length) { pracasAbertas.value = []; return }
  carregandoPracasAbertas.value = true
  erroPracasAbertas.value = ''
  try {
    const todas = await chamar('vessel_edicoes_listar', { p_praca_id: null }) || []
    const abertas = todas.filter((e) => e.situacao === 'aberta')
    // ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 2): a barra recorta O PLACAR
    // também, não só o quadro e a lista — com uma praça JÁ ESCOLHIDA (mas
    // ainda sem edição), esta lista mostra só a praça escolhida. Antes ela
    // sempre mostrava TODAS as praças, e clicar em outra trocava a barra de
    // volta calado.
    const pracasParaMostrar = pracaEscolhidaId.value
      ? pracas.value.filter((p) => p.id === pracaEscolhidaId.value)
      : pracas.value
    pracasAbertas.value = pracasParaMostrar
      .map((p) => ({ praca: p, edicao: abertas.find((e) => e.praca_id === p.id) || null }))
      .filter((x) => x.edicao)
  } catch {
    pracasAbertas.value = []
    erroPracasAbertas.value = 'Não consegui ler as edições abertas agora. Tente de novo em um instante.'
  } finally {
    carregandoPracasAbertas.value = false
  }
}

// ⚠️ DECISÃO 5 DO DONO: quantas stylists estão sem praça — a barra só mostra
// o aviso quando há o que dizer. Sobre `stylists`, que já respeita o recorte
// de praça escolhido (com uma praça escolhida, todas as linhas têm
// `praca_id`, e a contagem já vem zero sozinha).
const pendenciaDePraca = computed(() => pendenciasDePraca(stylists.value))

const stylists = ref([])
// ⚠️ 24/09: AS ETAPAS DO FUNIL vêm do banco (`vessel_stylist_etapas`), lidas
// junto com a lista — o quadro, o filtro e a ficha dependem delas.
const etapas = ref([])
const etapasAbertas = ref(false)
const carregando = ref(true)
const erro = ref(null)
const copiado = ref(null)

// ⚠️ `ordem: 'nome'` SOBRESCREVE O PADRÃO DE `FILTRO_VAZIO` ('data-nova'): essa
// opção não existe na barra desta tela (ver o comentário no template) — um
// valor inicial que não é nenhuma das opções mostradas deixaria o <select>
// sem nada selecionado visualmente.
const filtro = ref({ ...FILTRO_VAZIO, situacao: 'abertas', ordem: 'nome' })

// ⚠️ O FILTRO E O TOTAL AGEM SOBRE O QUE ESTÁ NA TELA: busca por
// nome/cidade/código, estágio e ordem — tudo client-side, sobre `stylists`,
// que só volta ao banco quando a situação exige desativada (ver o watch
// abaixo). Sem período, sem loja: não existem nesta tela.
// ⚠️ 24/09: cada stylist ganha a nota VIGENTE (`comFaixa`) antes do filtro —
// é ela que a ordem "Faixa da nota" usa, e o selo do quadro e da lista.
const vigentes = ref(null)
const erroDasFaixas = ref('')
// ⚠️ 24/09: "Sem contato ainda" é uma opção da SITUAÇÃO (`filtroDaBarra`,
// stylist-circle-regras.js): filtra como "Só ativas" e fica com as marcadas.
const stylistsNaTela = computed(() => {
  const { base, soSemContato } = filtroDaBarra(filtro.value)
  return soAsSemContato(filtrar(comFaixa(stylists.value, vigentes.value), base,
    { busca: ['nome', 'cidade', 'codigo'], estagio: 'etapa_chave' }), soSemContato)
})

// ⚠️ MESMO CUIDADO DAS DUAS IRMÃS (Critical da rodada anterior nelas): o
// conjunto tem de somar SEMPRE a lista filtrada, nunca a cheia.
// `calcularConjunto` (stylist-circle-regras.js, testada) só soma o que
// RECEBE — aqui ela sempre recebe `stylistsNaTela`.
const conjunto = computed(() => calcularConjunto(stylistsNaTela.value))

const subtitulo = computed(() => {
  if (carregando.value || erro.value) return ''
  return `${conjunto.value.totalStylists} de ${stylists.value.length} stylist(s) na tela · `
    + `${conjunto.value.totalAberturas} abertura(s)`
})

/* Proporções de verdade: cada pedido aconteceu ou não. */
const taxaCliente = (s) => proporcao(s.clientes, s.aberturas)
const taxaPresenca = (s) => proporcao(s.compareceram, s.pedidos)
/* ⚠️ RAZÃO, não proporção — pode passar de 1. Ver o cabeçalho. */
const pedidosPorCliente = (s) => razao(s.pedidos, s.clientes)

function cabecalho() {
  const token = estado.currentSession?.access_token
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${token || SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function chamar(funcao, corpo) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${funcao}`, {
    method: 'POST', headers: cabecalho(), body: JSON.stringify(corpo || {}),
  })
  if (!r.ok) throw new Error(`o banco respondeu ${r.status}`)
  return r.json()
}

// ⚠️ `silencioso` (mesmo padrão de tela-de-private-edit.vue): depois de mover
// uma stylist no quadro, a lista se atualiza SEM `carregando` ligar — senão o
// quadro inteiro desmonta e remonta (ver `mover`, acima) e a pessoa perde o
// lugar em que estava no celular.
async function carregar(opcoes) {
  const silencioso = opcoes?.silencioso === true
  if (!silencioso) carregando.value = true
  erro.value = null
  try {
    if (!estado.currentSession?.access_token) {
      erro.value = { tipo: 'sem-sessao', acao: null,
        mensagem: 'Sua sessão expirou. Recarregue a página e entre de novo.' }
      return
    }
    // ⚠️ SÓ PEDE AS DESATIVADAS QUANDO A SITUAÇÃO PRECISA: a função de
    // rastreio já chega sem elas por padrão — ver `precisaDasDesativadas`.
    const incluirDesativadas = precisaDasDesativadas(filtro.value.situacao)
    // ⚠️ TASK 7: A BARRA RECORTA A LISTA — `p_praca_id`/`p_edicao_id` nulos
    // (nenhuma escolhida) é o comportamento de sempre: tudo aparece.
    const [r, et] = await Promise.all([
      chamar('vessel_rastreio_dos_stylists', {
        p_dias: P_DIAS, p_incluir_desativadas: incluirDesativadas,
        p_praca_id: pracaEscolhidaId.value, p_edicao_id: edicaoEscolhidaId.value,
      }),
      chamar('vessel_stylist_etapas', {}),
    ])
    etapas.value = et || []
    // `etapa_chave`: o id da etapa em texto, que é o valor do filtro "Etapa".
    stylists.value = (r || []).map((s) => ({ ...s, etapa_chave: String(s.etapa_id) }))
    carregarFaixas()
  } catch (e) {
    erro.value = classificarErro(e)
  } finally {
    if (!silencioso) carregando.value = false
  }
}

// ⚠️ OS GATILHOS DE VOLTAR AO BANCO: a situação pedir desativada, ou a barra
// Praça · Edição mudar — busca, estágio e ordem continuam só filtrando o que
// já está em memória.
watch(() => precisaDasDesativadas(filtro.value.situacao), (precisaAgora, precisavaAntes) => {
  if (precisaAgora !== precisavaAntes) carregar()
})
watch([pracaEscolhidaId, edicaoEscolhidaId], () => carregar())

// O retrato de hoje das saídas (sai das etapas, que já vêm com a contagem) —
// não é da edição, é de TODAS as stylists da tela (ver o comentário no template).
const saidas = computed(() => saidasPorMotivo(etapas.value))

// ── o placar DA EDIÇÃO (T11 → Task 7) ───────────────────────────────────────
// ⚠️ ERRO DO PLACAR NÃO DERRUBA A LISTA, e a lista não derruba o placar: são
// duas leituras, e cada uma mostra o próprio erro no próprio bloco.
// ⚠️ O placar é SEMPRE de uma edição (decisão 1 do dono) — sem
// `edicaoEscolhidaId`, não há o que buscar: `placar-do-stylist-circle.vue`
// mostra a lista de praças com edição aberta (`pracasAbertas`, abaixo).
const placar = ref(null)
const carregandoPlacar = ref(false)
const erroDoPlacar = ref('')

async function carregarPlacar() {
  if (!edicaoEscolhidaId.value) { placar.value = null; erroDoPlacar.value = ''; return }
  carregandoPlacar.value = true
  erroDoPlacar.value = ''
  try {
    placar.value = await chamar('vessel_placar_da_edicao', { p_edicao_id: edicaoEscolhidaId.value })
  } catch {
    // ⚠️ Nunca zeros no lugar do erro: um placar zerado é uma afirmação.
    placar.value = null
    erroDoPlacar.value = 'Não consegui ler o placar agora. Recarregue a página em um instante.'
  } finally {
    carregandoPlacar.value = false
  }
}
// ⚠️ RODADA 1 DE CONSERTO (IMPORTANTE 2): observa OS DOIS — trocar de praça
// sem edição escolhida também precisa recarregar `pracasAbertas` (recortada
// pela praça nova), e antes só `edicaoEscolhidaId` disparava. Como a barra
// muda praça e edição no mesmo instante (a edição volta a nulo), um watcher
// só em `edicaoEscolhidaId` não via a troca de praça quando a edição já
// estava nula dos dois lados.
watch([pracaEscolhidaId, edicaoEscolhidaId], ([, id]) => {
  placar.value = null
  if (id) carregarPlacar()
  else carregarPracasAbertas()
})

// ── a nota de qualificação vigente de cada uma (24/09) ──────────────────────
// ⚠️ A FALHA NÃO VIRA "SEM NOTA": `vigentes` fica nulo, o selo some e a tela
// diz que não conseguiu ler. Lista vazia só quando o banco disse vazia.
async function carregarFaixas() {
  erroDasFaixas.value = ''
  try {
    const r = await chamar('vessel_qualificacoes_vigentes', {})
    vigentes.value = Array.isArray(r) ? r : []
  } catch {
    vigentes.value = null
    erroDasFaixas.value = 'Não consegui ler as notas de qualificação agora — o selo da faixa volta quando a leitura voltar.'
  }
}

// ── as duas vistas (T11) — Quadro e Lista ─────────────────────────────────────
// A vista escolhida fica no aparelho (conveniência, não dado).
const lerVista = () => { try { return localStorage.getItem('sty-vista') || 'quadro' } catch { return 'quadro' } }
const vista = ref(lerVista())
function trocarVista(v) { vista.value = v; try { localStorage.setItem('sty-vista', v) } catch { /* modo privado */ } }

const fichaAberta = ref(null)
const stylistDaFicha = computed(() => stylists.value.find((s) => s.codigo === fichaAberta.value) || null)

// ⚠️ RODADA 1 DE REVISÃO (T11): a recusa de mover NÃO usa `erro` — `erro` é a
// faixa que apaga o placar, o quadro e a lista inteiros, e uma recusa (ex.:
// "esta etapa não existe mais") não é motivo para sumir com a tela toda, e
// `erro` nem tem retentativa (`acao: null`). A recusa mora perto do quadro,
// em `erroDoQuadro`, com a frase de `mensagemDasEtapas`. `erro` continua só
// para falha de LEITURA.
const erroDoQuadro = ref('')
// ⚠️ GUARDA DE TOQUE DUPLO: sem isto, dois toques rápidos no mesmo botão
// disparam duas gravações — a segunda moveria a parceira DUAS etapas para a
// frente, contra a vontade de quem só queria mover uma vez. Também dá o aviso "Movendo…" no botão certo.
const movendoCodigo = ref(null)
// ⚠️ 24/09/2026: o botão e o ARRASTAR chegam aqui igual. Saída com motivos
// abre a escolha (a mesma da ficha); cancelar não move nada — o cartão nunca
// saiu do lugar. Etapa que libera Private Edit dá o aviso curto.
const motivoPendente = ref(null)
const erroDoMotivo = ref('')
const avisoDoQuadro = ref('')
function mover({ codigo, etapaId }) {
  if (movendoCodigo.value) return
  const destino = etapas.value.find((e) => e.id === etapaId)
  avisoDoQuadro.value = ''
  if (pedeMotivo(destino)) {
    erroDoMotivo.value = ''
    motivoPendente.value = { codigo, etapa: destino, nome: stylists.value.find((s) => s.codigo === codigo)?.nome || '' }
    return
  }
  return gravarMovimento(codigo, etapaId, null)
}
async function gravarMovimento(codigo, etapaId, motivo) {
  if (movendoCodigo.value) return
  movendoCodigo.value = codigo
  try {
    const r = await chamar('vessel_stylist_mover_de_etapa', {
      p_codigo: codigo, p_etapa_id: etapaId, p_motivo_id: motivo?.motivoId ?? null, p_nota: motivo?.nota ?? null,
    }).catch(() => null)
    if (!r?.ok) {
      const frase = mensagemDasEtapas(r?.situacao || 'erro_de_rede')
      if (motivoPendente.value) erroDoMotivo.value = frase
      else erroDoQuadro.value = frase
      return
    }
    erroDoQuadro.value = ''
    motivoPendente.value = null
    if (r.libera_private_edit) {
      avisoDoQuadro.value = avisoDeLiberada(stylists.value.find((s) => s.codigo === codigo)?.nome, etapas.value.find((e) => e.id === etapaId))
    }
    // ⚠️ SILENCIOSO: sem isto, `carregando` liga e desliga o quadro
    // (`v-if … !carregando`), o componente REMONTA, e `etapaNoCelular` /
    // `saidasAbertas` (estado interno dele) voltam do zero — no celular a
    // pessoa é jogada de volta para outra etapa no meio do toque.
    await carregar({ silencioso: true })
  } finally {
    movendoCodigo.value = null
  }
}

function corrigirDaFicha(codigo) {
  fichaAberta.value = null
  trocarVista('lista')
  const s = stylists.value.find((x) => x.codigo === codigo)
  if (s) abrirEditar(s)
}

const doisDigitos = (n) => String(n).padStart(2, '0')
const hojeLocal = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`
})()
/* O dia (local) de um instante do banco — `ativada_em` é timestamptz. */
function dataDoInstante(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`
}
// ── cadastrar ────────────────────────────────────────────────────────────────
const nomeDeQuemUsa = () => estado.user?.user_metadata?.name || estado.user?.email || ''
const NOVA_VAZIA = () => ({
  nome: '', whatsapp: '', cidade: '', instagram: '', atuacao: '', praca: '',
  loja: '', comoChegou: '', responsavel: nomeDeQuemUsa(),
  proximaAcao: '', proximaAcaoEm: '', observacoes: '', semContato: false,
})
const novo = reactive(NOVA_VAZIA())
const problemas = computed(() => problemasDaParceira({ ...novo, origem: novo.comoChegou }))
const criando = ref(false)
const criado = ref(null)
const erroAoCriar = ref('')

async function criar() {
  if (problemas.value.length) return
  criando.value = true
  erroAoCriar.value = ''
  criado.value = null
  try {
    const r = await chamar('vessel_stylist_criar', {
      p_nome: novo.nome,
      p_whatsapp: novo.whatsapp,
      p_cidade: novo.cidade || null,
      p_instagram: novo.instagram || null,
      p_atuacao: novo.atuacao || null,
      p_praca: novo.praca || null,
      p_loja: novo.loja || null,
      p_origem_contato: novo.comoChegou || null,
      p_responsavel: novo.responsavel || null,
      p_proxima_acao: novo.proximaAcao || null,
      p_proxima_acao_em: novo.proximaAcaoEm || null,
      p_observacoes: novo.observacoes || null,
      p_sem_contato: semContatoParaMandar(novo),
    })
    if (!r?.ok) {
      erroAoCriar.value = mensagemDeCriar(r?.situacao)
        + (['whatsapp_repetido', 'instagram_repetido'].includes(r?.situacao) && r?.codigo ? ` (${r.codigo})` : '')
      return
    }
    criado.value = r
    Object.assign(novo, NOVA_VAZIA())
    await carregar()
  } catch {
    erroAoCriar.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    criando.value = false
  }
}

// ── corrigir (inline) ────────────────────────────────────────────────────────
const editando = ref(null)
const rascunho = reactive({
  nome: '', whatsapp: '', cidade: '', instagram: '', atuacao: '', praca: '',
  loja: '', comoChegou: '', responsavel: '', proximaAcao: '', proximaAcaoEm: '',
  observacoes: '', acaoFeita: false, semContato: false,
})
const salvandoEdicao = ref(null)
const erroDeEditar = ref(null)
const mensagemEditar = ref('')

function abrirEditar(s) {
  editando.value = s.codigo
  erroDeEditar.value = null
  confirmando.value = null
  Object.assign(rascunho, {
    nome: s.nome || '',
    whatsapp: s.whatsapp || '',
    cidade: s.cidade || '',
    instagram: s.instagram || '',
    atuacao: s.atuacao || '',
    praca: s.praca_preview || '',
    loja: s.loja || '',
    comoChegou: s.origem_contato || 'inbound',
    responsavel: s.responsavel || '',
    proximaAcao: s.proxima_acao || '',
    proximaAcaoEm: s.proxima_acao_em || '',
    observacoes: s.observacoes || '',
    acaoFeita: false,
    semContato: s.sem_contato === true,
  })
}

function fecharEditar() {
  editando.value = null
  erroDeEditar.value = null
}

async function salvarEdicao(s) {
  salvandoEdicao.value = s.codigo
  erroDeEditar.value = null
  try {
    const r = await chamar('vessel_stylist_editar', {
      p_codigo: s.codigo,
      p_nome: rascunho.nome || null,
      p_whatsapp: rascunho.whatsapp || null,
      p_cidade: rascunho.cidade || null,
      p_instagram: rascunho.instagram || null,
      p_atuacao: rascunho.atuacao || null,
      p_praca: rascunho.praca || null,
      p_loja: rascunho.loja || null,
      p_origem_contato: rascunho.comoChegou || null,
      p_responsavel: rascunho.responsavel || null,
      p_proxima_acao: rascunho.acaoFeita ? null : (rascunho.proximaAcao || null),
      p_proxima_acao_em: rascunho.acaoFeita ? null : (rascunho.proximaAcaoEm || null),
      p_sem_proxima_acao: rascunho.acaoFeita,
      // ⚠️ STRING, NUNCA NULO: vazio apaga (a regra de `vessel_stylist_editar`,
      // a mesma da irmã `vessel_private_edit_situacao`) — é o jeito de limpar.
      p_observacoes: rascunho.observacoes ?? '',
      // ⚠️ SÓ QUANDO A CAIXA APARECEU (ela não tem contato): nas outras fica
      // de fora, e o banco não mexe na marca (nulo = não mexe).
      ...((s.sem_contato || (!s.whatsapp && !s.instagram)) ? { p_sem_contato: semContatoParaMandar(rascunho) } : {}),
    })
    if (!r?.ok) {
      erroDeEditar.value = s.codigo
      mensagemEditar.value = mensagemDeEditar(r?.situacao)
      return
    }
    editando.value = null
    await carregar()
  } catch {
    erroDeEditar.value = s.codigo
    mensagemEditar.value = mensagemDeEditar('erro_de_rede')
  } finally {
    salvandoEdicao.value = null
  }
}

// ── desativar / reativar ─────────────────────────────────────────────────────
const confirmando = ref(null)
const mexendo = ref(null)
const erroAoMexer = ref(null)
const mensagemMexer = ref('')

async function desativar(s, ativa) {
  mexendo.value = s.codigo
  erroAoMexer.value = null
  try {
    const r = await chamar('vessel_stylist_desativar', { p_codigo: s.codigo, p_ativa: ativa })
    if (!r?.ok) {
      erroAoMexer.value = s.codigo
      mensagemMexer.value = mensagemDeDesativar(r?.situacao)
      return
    }
    confirmando.value = null
    await carregar()
  } catch {
    erroAoMexer.value = s.codigo
    mensagemMexer.value = mensagemDeDesativar('erro_de_rede')
  } finally {
    mexendo.value = null
  }
}

async function copiar(texto, marca) {
  try {
    await navigator.clipboard.writeText(texto)
    copiado.value = marca
    setTimeout(() => { if (copiado.value === marca) copiado.value = null }, 2000)
  } catch { /* o endereço segue na tela para ser selecionado à mão */ }
}

onMounted(() => { carregar(); carregarPracas() })
</script>

<style scoped>
@import './estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';

/* A engrenagem do topo: no celular fica só o ícone (o nome está no aria-label). */
@media (max-width: 480px) { .sty-rotulo-engrenagem { display: none; } }

/* ⚠️ DUAS SELOS NO MESMO CARD (situação da parceira + estágio do funil) SÃO
   DUAS COISAS DIFERENTES: "ativa/desativada" é a parceria em si; "estágio" é
   onde ela está no funil. Empilhados aqui para contarem como UM item de
   flexbox ao lado de `cv-cabeca-texto` — soltos, o `justify-content:
   space-between` de `.cv-cabeca` os espalharia pela largura toda. */
.cv-selos {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: var(--sp-2);
}
</style>
