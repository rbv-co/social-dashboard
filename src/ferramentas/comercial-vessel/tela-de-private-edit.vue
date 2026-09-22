<template>
  <div class="tela-pe">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('private-edit')]"
                   titulo="Vessel — Private Edit"
                   :subtitulo="subtitulo" @voltar="voltar" />

    <div class="cv-largo cv-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <!-- ── CRIAR ──────────────────────────────────────────────────────── -->
      <section class="cv-bloco">
        <h2 class="cv-etiqueta">Marcar um encontro</h2>
        <div class="cv-form">
          <label class="cv-campo cv-campo-largo" for="pe-stylist"><span>Anfitriã</span>
            <select id="pe-stylist" v-model="novo.stylist">
              <option value="">Escolha a stylist…</option>
              <option v-for="s in stylists" :key="s.codigo" :value="s.codigo">
                {{ s.codigo }} — {{ s.nome }}<span v-if="s.cidade"> · {{ s.cidade }}</span>
              </option>
            </select></label>
          <label class="cv-campo" for="pe-quando"><span>Dia e hora</span>
            <input id="pe-quando" type="datetime-local" v-model="novo.quando"></label>
          <label class="cv-campo" for="pe-praca"><span>Praça</span>
            <select id="pe-praca" v-model="novo.praca">
              <option value="">Escolha…</option>
              <option v-for="(nome, sigla) in PRACAS" :key="sigla" :value="sigla">{{ nome }}</option>
            </select></label>
          <label class="cv-campo" for="pe-vagas"><span>Vagas</span>
            <input id="pe-vagas" type="number" min="7" max="10" v-model.number="novo.vagas"></label>
          <label class="cv-campo cv-campo-largo" for="pe-local"><span>Lugar</span>
            <input id="pe-local" type="text" maxlength="90" v-model="novo.local"
                   placeholder="Onde o encontro acontece"></label>
        </div>

        <p class="cv-nota">
          <b>Vagas</b> é a capacidade planejada: de 7 a 10 convidadas. A taxa de
          resposta é sobre quem foi convidada, e não sobre as vagas.
        </p>
        <p v-if="avisoDaCadencia" class="cv-nota cv-nota-aviso">{{ avisoDaCadencia }}</p>
        <ul v-if="problemas.length" class="cv-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <p v-if="erroAoCriar" class="cv-nota cv-nota-erro">{{ erroAoCriar }}</p>
        <p v-if="criado" class="cv-nota cv-nota-ok">
          Encontro <b>{{ criado.codigo }}</b> criado. O convite está na lista abaixo.
        </p>

        <div class="cv-acoes">
          <button class="btn btn-principal" :disabled="problemas.length > 0 || criando"
                  @click="criar">{{ criando ? 'Criando…' : 'Criar encontro' }}</button>
        </div>
      </section>

      <!-- ── BUSCAR, FILTRAR, PERÍODO E ORDENAR ────────────────────────────
           ⚠️ A BARRA NUNCA VAI SOZINHA AO BANCO, salvo o caso de baixo
           (`precisaDoBanco`). Busca, situação (fora arquivada/todas), loja e
           ordem acontecem sobre o que já está em memória — ver filtros.js. -->
      <barra-de-lista v-model="filtro" :lojas="LOJAS"
                      :mostrar="['busca', 'periodo', 'situacao', 'loja', 'ordem']"
                      placeholder-busca="código ou anfitriã" />

      <!-- ── COMO LER ───────────────────────────────────────────────────── -->
      <section v-if="!carregando && !erro && encontros.length" class="cv-bloco cv-bloco-leitura">
        <h2 class="cv-etiqueta">Como ler os números</h2>
        <p class="cv-nota cv-nota-primeira">
          Toda taxa aqui vem com <b>de quantos</b> ela saiu. Um encontro tem 7 a 10
          convidadas: <b>“67%” sobre 3 pessoas é uma pessoa</b>, não uma tendência —
          quando a base é pequena demais para separar um cenário do outro, a tela
          escreve a faixa em que a taxa real pode estar.
        </p>
        <p class="cv-nota">
          <b>Receita</b> é a compra das convidadas na janela declarada ao lado do
          valor. Não existe no dado nenhum campo dizendo “esta compra veio deste
          encontro” — o que existe é a mesma pessoa comprando perto da visita.
          Só conta pedido atendido no Bling, e quem foi a dois encontros tem a
          compra contada no <b>primeiro</b>, uma vez só.
        </p>
        <p class="cv-nota">
          <b>Confirmadas</b> inclui quem confirmou e faltou — sem ela no
          denominador, o comparecimento daria perto de 100% sempre.
        </p>
        <p class="cv-nota">
          <b>Encerrada</b> e <b>arquivada</b> são coisas diferentes. Encerrada
          aconteceu e continua contando na receita e nos números. Arquivada é o
          que não devia ter ficado ali — duplicata, engano — e por isso sai das
          contas e da lista por padrão; o filtro "Situação" traz de volta quem
          precisar olhar para ela.
        </p>
      </section>

      <div v-if="carregando" class="cv-carregando">Carregando…</div>

      <template v-else-if="!erro">
        <!-- ── O CONJUNTO ───────────────────────────────────────────────── -->
        <section v-if="encontros.length" class="cv-bloco">
          <h2 class="cv-etiqueta">Todos os encontros juntos</h2>
          <!-- ⚠️ O CONJUNTO É SOBRE O QUE ESTÁ NA TELA, NÃO SOBRE O QUE VEIO
               DO BANCO: se a pessoa filtrou por loja ou período, o total tem
               de acompanhar — reusar o total de antes do filtro é a tela
               mentindo com número certo. -->
          <p class="cv-nota cv-nota-primeira">
            {{ encontrosNaTela.length }} de {{ encontros.length }} encontros
            (o filtro de cima decide quais).
          </p>
          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ conjunto.totalEncontros }}</span>
              <span class="cv-numero-rotulo">Encontros</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ conjunto.totalVagas }}</span>
              <span class="cv-numero-rotulo">Vagas somadas</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emPorcento(conjunto.resposta.valor) }}</span>
              <span class="cv-numero-rotulo">Responderam</span>
              <span class="cv-numero-base">{{ taxaEscrita(conjunto.resposta) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emPorcento(conjunto.presenca.valor) }}</span>
              <span class="cv-numero-rotulo">Foram, de quem confirmou</span>
              <span class="cv-numero-base">{{ taxaEscrita(conjunto.presenca) }}</span>
            </div>
          </div>
          <!-- ⚠️ A taxa do conjunto é a SOMA dos numeradores sobre a SOMA dos
               denominadores, nunca a média das taxas: um encontro de 2 vagas
               pesaria igual a um de 8. -->
          <p class="cv-nota">
            As taxas do conjunto somam numeradores e denominadores — não é a média
            das taxas de cada encontro, que daria a um encontro pequeno o mesmo
            peso de um cheio.
          </p>
        </section>

        <!-- ── CADA ENCONTRO ────────────────────────────────────────────── -->
        <section v-for="e in encontrosNaTela" :key="e.codigo" class="cv-bloco">
          <div class="cv-cabeca">
            <div class="cv-cabeca-texto">
              <h2 class="cv-titulo">{{ dataHoraLegivel(e.quando) }}</h2>
              <p class="cv-sub">
                <span class="cv-codigo">{{ e.codigo }}</span>
                <span v-if="e.anfitria || e.stylist"> · {{ e.anfitria || e.stylist }}</span>
                <span v-if="e.local"> · {{ e.local }}</span>
              </p>
            </div>
            <span class="cv-selo" :class="seloDoStatus(e).classe">{{ seloDoStatus(e).texto }}</span>
          </div>

          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ e.vagas }}</span>
              <span class="cv-numero-rotulo">Vagas</span>
              <span class="cv-numero-base">{{ e.convidadas || 0 }} convidada(s) na lista</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ e.responderam }}</span>
              <span class="cv-numero-rotulo">Responderam</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaResposta(e)) }} das convidadas</span>
              <span v-if="margemEscrita(taxaResposta(e))" class="cv-numero-margem">
                {{ margemEscrita(taxaResposta(e)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ e.confirmadas }}</span>
              <span class="cv-numero-rotulo">Confirmadas</span>
              <span class="cv-numero-base">{{ e.disseram_sim }} disseram sim no convite</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ e.compareceram }}</span>
              <span class="cv-numero-rotulo">Foram</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxaPresenca(e)) }} de quem confirmou</span>
              <span v-if="margemEscrita(taxaPresenca(e))" class="cv-numero-margem">
                {{ margemEscrita(taxaPresenca(e)) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emReais(e.receita) }}</span>
              <span class="cv-numero-rotulo">Receita</span>
              <span class="cv-numero-base">{{ janelaEscrita(e.janela_de_venda_em_dias) }}</span>
            </div>
          </div>

          <h3 class="cv-etiqueta cv-etiqueta-interna">O convite</h3>
          <div class="cv-link">
            <div class="cv-link-texto">
              <span class="cv-link-nome">O que a anfitriã manda para as convidadas</span>
              <code class="cv-link-url">{{ enderecoDoConvite(e.chave) || '(sem chave)' }}</code>
            </div>
            <button v-if="enderecoDoConvite(e.chave)" class="btn"
                    @click="copiar(enderecoDoConvite(e.chave), e.codigo)">
              {{ copiado === e.codigo ? 'Copiado' : 'Copiar' }}</button>
          </div>
          <p class="cv-nota">
            {{ e.ativa !== false ? 'O convite está aceitando respostas.' : 'O convite parou de aceitar respostas.' }}
            O endereço vai pela <b>chave sorteada</b>, e não pelo código do encontro:
            o código é adivinhável, e quem recebesse um convite listaria os outros
            trocando a data.
          </p>

          <!-- ── A SITUAÇÃO DO ENCONTRO (T11) ──────────────────────────────
               ⚠️ O QUE ESTÁ GRAVADO APARECE PARA TODOS; MUDAR, SÓ COM EDITAR.
               O motivo e a data de realização são exigidos pelo BANCO (CHECK
               na tabela) — a tela só pede antes para poupar a ida e volta. -->
          <h3 class="cv-etiqueta cv-etiqueta-interna">A situação</h3>
          <!-- Quem não pode mudar LÊ o que está gravado; quem pode, vê nos
               próprios campos — escrever as duas coisas repetia a mesma frase. -->
          <template v-if="!podeExecutarAcao('situacao', podeEditar)">
            <p class="cv-nota cv-nota-primeira">{{ seloDoStatus(e).texto }}<span
               v-if="e.status === 'realizado' && e.realizado_em"> em <b>{{ dataLegivel(e.realizado_em) }}</b></span>.</p>
            <p v-if="e.motivo" class="cv-nota cv-nota-primeira"><b>Motivo:</b> {{ e.motivo }}</p>
            <p v-if="e.observacoes" class="cv-nota cv-nota-primeira"><b>Observações:</b> {{ e.observacoes }}</p>
          </template>
          <template v-if="podeExecutarAcao('situacao', podeEditar)">
            <div class="cv-form">
              <label class="cv-campo" :for="`sit-status-${e.codigo}`"><span>Situação</span>
                <select :id="`sit-status-${e.codigo}`" :value="situacaoDe(e).status"
                        @change="situacaoDe(e).status = $event.target.value">
                  <option v-for="(rotulo, chave) in STATUS_DO_ENCONTRO" :key="chave" :value="chave">{{ rotulo }}</option>
                </select></label>
              <label v-if="situacaoDe(e).status === 'realizado'" class="cv-campo" :for="`sit-data-${e.codigo}`">
                <span>Data em que aconteceu</span>
                <input :id="`sit-data-${e.codigo}`" type="date" :max="hojeLocal" v-model="situacaoDe(e).realizadoEm"></label>
              <label v-if="precisaDeMotivo(situacaoDe(e).status)" class="cv-campo cv-campo-largo" :for="`sit-motivo-${e.codigo}`">
                <span>Motivo</span>
                <input :id="`sit-motivo-${e.codigo}`" type="text" maxlength="200" v-model="situacaoDe(e).motivo"></label>
              <label class="cv-campo cv-campo-largo" :for="`sit-obs-${e.codigo}`"><span>Observações do dia</span>
                <input :id="`sit-obs-${e.codigo}`" type="text" maxlength="300" v-model="situacaoDe(e).observacoes"
                       placeholder="Exceções e ocorrências relevantes"></label>
            </div>
            <p v-if="erroDaSituacao[e.codigo]" class="cv-nota cv-nota-erro">{{ erroDaSituacao[e.codigo] }}</p>
            <div class="cv-acoes">
              <button class="btn" :disabled="gravandoSituacao === e.codigo || !situacaoMudou(e)"
                      @click="gravarSituacao(e)">
                {{ gravandoSituacao === e.codigo ? 'Gravando…' : 'Gravar situação' }}</button>
            </div>
          </template>

          <!-- ── EDITAR (inline, sem modal) ──────────────────────────────── -->
          <template v-if="podeExecutarAcao('editar', podeEditar) && editando === e.codigo">
            <h3 class="cv-etiqueta cv-etiqueta-interna">Editar</h3>
            <div class="cv-form">
              <label class="cv-campo cv-campo-largo" :for="`ed-stylist-${e.codigo}`"><span>Anfitriã</span>
                <select :id="`ed-stylist-${e.codigo}`" v-model="rascunho.stylist">
                  <option v-for="s in stylists" :key="s.codigo" :value="s.codigo">
                    {{ s.codigo }} — {{ s.nome }}</option>
                </select></label>
              <label class="cv-campo" :for="`ed-quando-${e.codigo}`"><span>Dia e hora</span>
                <input :id="`ed-quando-${e.codigo}`" type="datetime-local" v-model="rascunho.quando"></label>
              <label class="cv-campo" :for="`ed-praca-${e.codigo}`"><span>Praça</span>
                <select :id="`ed-praca-${e.codigo}`" v-model="rascunho.praca">
                  <option value="">Escolha…</option>
                  <option v-for="(nome, sigla) in PRACAS" :key="sigla" :value="sigla">{{ nome }}</option>
                </select></label>
              <label class="cv-campo" :for="`ed-loja-${e.codigo}`"><span>Loja</span>
                <select :id="`ed-loja-${e.codigo}`" v-model="rascunho.loja">
                  <option value="">Escolha…</option>
                  <option v-for="(nome, chave) in LOJAS" :key="chave" :value="chave">{{ nome }}</option>
                </select></label>
              <label class="cv-campo" :for="`ed-vagas-${e.codigo}`"><span>Vagas</span>
                <input :id="`ed-vagas-${e.codigo}`" type="number" min="7" max="10" v-model.number="rascunho.vagas"></label>
              <label class="cv-campo cv-campo-largo" :for="`ed-local-${e.codigo}`"><span>Lugar</span>
                <input :id="`ed-local-${e.codigo}`" type="text" maxlength="90" v-model="rascunho.local"></label>
            </div>
            <p class="cv-nota">
              <b>Código e chave nunca mudam</b>: a chave já está dentro de um
              convite que pode já ter sido mandado.
            </p>
            <p v-if="erroDeEditar === e.codigo" class="cv-nota cv-nota-erro">{{ mensagemEditar }}</p>
            <div class="cv-acoes">
              <button class="btn" :disabled="salvandoEdicao === e.codigo" @click="fecharEditar">Cancelar</button>
              <button class="btn btn-principal" :disabled="salvandoEdicao === e.codigo"
                      @click="salvarEdicao(e)">{{ salvandoEdicao === e.codigo ? 'Salvando…' : 'Salvar' }}</button>
            </div>
          </template>

          <!-- ── APAGAR: tem_gente vira explicação, nunca erro vermelho ──── -->
          <template v-else-if="podeExecutarAcao('apagar', podeEditar) && bloqueioDeApagar[e.codigo]">
            <p class="cv-nota cv-nota-aviso">{{ bloqueioDeApagar[e.codigo] }}</p>
          </template>

          <div class="cv-acoes">
            <!-- ⚠️ R13: Encerrar/Reabrir agora EXIGEM a mesma permissão de
                 editar que Editar/Arquivar/Apagar já exigiam —
                 `vessel_private_edit_encerrar` passou a checar
                 `is_vessel_atendimentos_editar()`. A regra mora em
                 `podeExecutarAcao` (private-edit-regras.js), testada — não
                 reescrita aqui como um `v-if` solto de novo. -->
            <template v-if="podeExecutarAcao('encerrar', podeEditar)">
              <template v-if="e.ativa !== false">
                <button v-if="confirmando !== e.codigo" class="btn"
                        @click="confirmando = e.codigo">Encerrar…</button>
                <template v-else>
                  <span class="cv-confirma">Encerrar faz o convite parar de aceitar
                    resposta. Os números ficam.</span>
                  <button class="btn" @click="confirmando = null">Deixar como está</button>
                  <button class="btn btn-perigo" :disabled="mexendo === e.codigo"
                          @click="encerrar(e, false)">Encerrar</button>
                </template>
              </template>
              <button v-else class="btn" :disabled="mexendo === e.codigo"
                      @click="encerrar(e, true)">Reabrir</button>
            </template>

            <template v-if="podeExecutarAcao('editar', podeEditar)">
              <button v-if="editando !== e.codigo" class="btn" @click="abrirEditar(e)">Editar…</button>

              <button class="btn" :disabled="arquivando === e.codigo"
                      @click="alternarArquivar(e)">
                {{ arquivando === e.codigo ? 'Gravando…' : rotuloDeArquivar(e.arquivada) }}
              </button>

              <template v-if="!bloqueioDeApagar[e.codigo]">
                <button v-if="apagando !== e.codigo" class="btn btn-perigo"
                        @click="apagando = e.codigo">Apagar…</button>
                <template v-else>
                  <span class="cv-confirma">Apagar não pode ser desfeito.</span>
                  <button class="btn" @click="apagando = null">Deixar como está</button>
                  <button class="btn btn-perigo" :disabled="mexendoApagar === e.codigo"
                          @click="apagar(e)">Apagar de vez</button>
                </template>
              </template>
            </template>

            <button class="btn" :disabled="carregandoConvidadas === e.codigo"
                    @click="verQuemFoi(e)">
              {{ carregandoConvidadas === e.codigo ? 'Buscando…'
                 : (convidadasAbertas === e.codigo ? 'Fechar convidadas' : 'Convidadas e presença') }}
            </button>
          </div>
          <p v-if="erroAoMexer === e.codigo" class="cv-nota cv-nota-erro">
            Não consegui gravar agora. Tente de novo em um instante.
          </p>
          <p v-if="erroDeArquivar === e.codigo" class="cv-nota cv-nota-erro">{{ mensagemArquivar }}</p>
          <p v-if="erroDeApagar === e.codigo" class="cv-nota cv-nota-erro">{{ mensagemApagar }}</p>

          <!-- ── AS CONVIDADAS (T11) ──────────────────────────────────────
               ⚠️ CARTÕES, NÃO TABELA: a gerente marca presença NO CELULAR, na
               porta da loja. Uma tabela de cinco colunas com botões dentro não
               cabe em 375px sem rolar de lado.
               ⚠️ O NÚMERO DA CONVIDADA (Guest ID) NASCE NO CONVITE e não é o
               número da ficha de cliente — o documento manda não misturar. -->
          <template v-if="convidadasAbertas === e.codigo">
            <h3 class="cv-etiqueta cv-etiqueta-interna">As convidadas</h3>

            <template v-if="podeExecutarAcao('convidar', podeEditar) && e.status !== 'cancelado' && !e.arquivada">
              <div class="cv-form">
                <label class="cv-campo" :for="`cv-nome-${e.codigo}`"><span>Nome completo</span>
                  <input :id="`cv-nome-${e.codigo}`" type="text" maxlength="120" v-model="convidarDe(e).nome"></label>
                <label class="cv-campo" :for="`cv-whats-${e.codigo}`"><span>WhatsApp</span>
                  <input :id="`cv-whats-${e.codigo}`" type="tel" maxlength="20" v-model="convidarDe(e).whatsapp"
                         placeholder="(19) 99999-9999"></label>
                <label class="cv-campo" :for="`cv-mail-${e.codigo}`"><span>E-mail (se tiver)</span>
                  <input :id="`cv-mail-${e.codigo}`" type="email" maxlength="120" v-model="convidarDe(e).email"></label>
              </div>
              <ul v-if="convidarDe(e).tocado && problemasDaConvidada(convidarDe(e)).length" class="cv-problemas">
                <li v-for="p in problemasDaConvidada(convidarDe(e))" :key="p">{{ p }}</li>
              </ul>
              <p v-if="respostaDoConvidar[e.codigo]" class="cv-nota"
                 :class="respostaDoConvidar[e.codigo].ok ? 'cv-nota-ok' : 'cv-nota-erro'">
                {{ respostaDoConvidar[e.codigo].texto }}</p>
              <div class="cv-acoes">
                <button class="btn btn-principal" :disabled="convidando === e.codigo"
                        @click="convidar(e)">{{ convidando === e.codigo ? 'Incluindo…' : 'Incluir convidada' }}</button>
              </div>
            </template>

            <div v-if="convidadasErro[e.codigo]" class="cv-nota cv-nota-erro">
              Deu erro ao buscar as convidadas. Tente de novo em um instante.
            </div>
            <p v-else-if="convidadasVazias[e.codigo]" class="cv-vazio">
              Ninguém na lista deste encontro ainda.
            </p>
            <ul v-else-if="convidadas[e.codigo]" class="cv-convidadas">
              <li v-for="c in convidadas[e.codigo]" :key="c.id" class="cv-convidada">
                <div class="cv-cabeca">
                  <div class="cv-cabeca-texto">
                    <p class="cv-convidada-nome">{{ c.nome }}</p>
                    <p class="cv-sub">
                      <span class="cv-codigo">Convidada nº {{ c.id }}</span>
                      · {{ telefoneLegivel(c.telefone) }}<span v-if="c.email"> · {{ c.email }}</span>
                    </p>
                    <p class="cv-sub">
                      Ficha de cliente nº {{ c.pessoa_id }}
                      <span v-if="c.rsvp === 'falar-com-equipe'"> · pediu para falar com a equipe</span>
                      <span v-if="c.comprou"> · <b>comprou</b></span>
                    </p>
                  </div>
                  <span class="cv-selo" :class="seloDoConvite(c.situacao).classe">{{ seloDoConvite(c.situacao).texto }}</span>
                </div>
                <div class="cv-acoes">
                  <button v-for="g in gestosDaConvidada(c)" :key="g.gesto" class="btn"
                          :disabled="marcando === c.id" @click="marcar(e, c, g.gesto)">{{ g.rotulo }}</button>
                </div>
                <p v-if="erroDeMarcar[c.id]" class="cv-nota cv-nota-erro">{{ erroDeMarcar[c.id] }}</p>
              </li>
            </ul>
          </template>
        </section>

        <p v-if="!encontrosNaTela.length && encontros.length" class="cv-vazio">
          Nenhum encontro passa neste filtro. Experimente "Todas, inclusive
          arquivadas" ou um período maior.
        </p>
        <p v-if="!encontros.length" class="cv-vazio">
          Nenhum encontro marcado ainda. Marque o primeiro no bloco de cima.
        </p>
      </template>
    </div>
  </div>
</template>

<script setup>
/* VESSEL — PRIVATE EDIT: marcar o encontro, acompanhar, editar, arquivar,
 * apagar e ver quem foi.
 *
 * ⚠️ LÊ COM O TOKEN DA SESSÃO, NUNCA COM A CHAVE ANÔNIMA: as funções conferem
 * `is_vessel_atendimentos()` por dentro, e com a chave anônima o PostgREST
 * responde 200 com lista VAZIA — a tela diria "nenhum encontro" para uma agenda
 * cheia (item 9 do PADRAO-DA-CENTRAL).
 *
 * ⚠️ TODA TAXA AQUI SAI COM O DENOMINADOR E, QUANDO A BASE É PEQUENA, COM A
 * FAIXA. Um encontro tem 5 a 8 convidadas: sem isso, "67%" sobre 3 pessoas
 * viraria uma tendência na cabeça de quem lê, e é uma pessoa.
 *
 * ⚠️ O PERÍODO DA BARRA RECORTA A LISTA, NÃO O BANCO. As duas chamadas
 * (`vessel_conta_das_private_edits` e `vessel_convidadas_do_encontro`) usam a
 * MESMA régua de `p_dias` (14, o padrão das duas) só para a janela de
 * atribuição de venda — nunca para decidir quais linhas aparecem. Quem decide
 * isso é `filtrar()`, sobre o que já voltou. Ver `filtros.js`.
 *
 * ⚠️ T11 (22/09/2026): o encontro ganhou SITUAÇÃO (agendado → realizado…,
 * com motivo quando cai), e "Ver quem foi" virou a lista de CONVIDADAS — a
 * equipe inclui quem convidou, e a gerente marca convite e presença pelo
 * celular. Presença passa por `vessel_situacao_do_atendimento`, a MESMA porta
 * da Central de Atendimentos: duas portas para a mesma presença seriam duas
 * regras de "veio".
 *
 * ⚠️ ARQUIVADA PRECISA DE RE-FETCH, NÃO DE FILTRO: a função de conta já chega
 * SEM as arquivadas (`p_incluir_arquivadas` nasce `false`). Só quando a
 * situação escolhida é "Só arquivadas" ou "Todas, inclusive arquivadas" a
 * tela volta ao banco pedindo `p_incluir_arquivadas: true` — ver
 * `precisaDoBanco` em `filtros.js`.
 */
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import BarraDeLista from './barra-de-lista.vue'
import { estado, hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import { enderecoDoConvite, dataHoraLegivel, dataLegivel, problemasDoEncontro } from './enderecos-publicos.js'
import {
  proporcao, taxaEscrita, margemEscrita, emPorcento, emReais, janelaEscrita,
} from './estatistica.js'
import { filtrar, FILTRO_VAZIO, precisaDoBanco } from './filtros.js'
import {
  mensagemDeEditar, mensagemDeArquivar, mensagemDeTemGente, mensagemDeApagar,
  rotuloDeArquivar, paraCampoDatetimeLocal, podeExecutarAcao, calcularConjunto,
} from './private-edit-regras.js'
import {
  STATUS_DO_ENCONTRO, precisaDeMotivo, seloDoStatus, mensagemDeSituacaoDoEncontro,
  seloDoConvite, gestosDaConvidada, problemasDaConvidada, mensagemDeConvidar,
  mensagemDeMarcar, telefoneLegivel, avisoDos45Dias, proximaDataPermitidaDaLista,
} from './t11-regras.js'
import { paiDaTela, ROTULO_DO_PAI } from './navegacao.js'

const router = useRouter()
function voltar() { router.push({ name: paiDaTela('private-edit') }) }

const PRACAS = { CPS: 'Campinas', SAO: 'São Paulo', SBO: 'Santa Bárbara', BSB: 'Brasília' }
const LOJAS = { iguatemi: 'Iguatemi', tivoli: 'Tivoli', parkshopping: 'ParkShopping' }

// ⚠️ A MESMA JANELA PARA AS DUAS CHAMADAS (R14): a receita do topo e a coluna
// "Comprou" da lista de convidadas medem com a MESMA régua. Um número
// diferente em cada uma faria as duas se contradizerem na mesma tela.
const P_DIAS = 14

const podeEditar = computed(() => hasPermission('atendimentos', 'editar'))

const encontros = ref([])
const stylists = ref([])
const carregando = ref(true)
const erro = ref(null)
const criando = ref(false)
const criado = ref(null)
const erroAoCriar = ref('')
const mexendo = ref(null)
const erroAoMexer = ref(null)
const confirmando = ref(null)
const copiado = ref(null)

const filtro = ref({ ...FILTRO_VAZIO })

const novo = reactive({ stylist: '', quando: '', praca: '', loja: '', vagas: 8, local: '' })

const problemas = computed(() => problemasDoEncontro(novo))

// ⚠️ O FILTRO E O TOTAL AGEM SOBRE O QUE ESTÁ NA TELA (R do bloco "Todos os
// encontros juntos"): busca por código/anfitriã, situação, loja e ordem — tudo
// client-side, sobre `encontros`, que só volta ao banco quando a situação
// exige arquivada (ver o watch abaixo).
const encontrosNaTela = computed(() =>
  filtrar(encontros.value, filtro.value, { busca: ['codigo', 'anfitria', 'stylist'], loja: 'loja' }))

// ⚠️ CRITICAL DA RODADA ANTERIOR: `totalVagas` somava sobre `encontros.value`
// (a lista CHEIA) enquanto a contagem ao lado já seguia o filtro — "3
// Encontros" ao lado da soma de vagas dos 10. `calcularConjunto` (testada em
// private-edit-regras.test.mjs) só soma o que RECEBE; aqui ela sempre recebe
// `encontrosNaTela`, nunca `encontros`.
const conjunto = computed(() => calcularConjunto(encontrosNaTela.value))

// ⚠️ O SUBTÍTULO TEM DE CONCORDAR COM O QUE ESTÁ NA TELA — mesma razão do
// bloco do conjunto: contar `encontros.value` (a lista cheia) enquanto a tela
// abaixo mostra a filtrada é a mesma mentira com número certo, só que no
// cabeçalho em vez do corpo.
const subtitulo = computed(() => {
  if (carregando.value || erro.value) return ''
  return `${conjunto.value.totalEncontros} encontro(s) · ${conjunto.value.totalVagas} vagas somadas`
})

/* Cada uma é uma proporção de verdade: cada convidada responde ou não, diz sim
 * ou não, vai ou não. Por isso o intervalo de Wilson se aplica. */
// ⚠️ T11: sobre as CONVIDADAS, não as vagas — ver `calcularConjunto`.
const taxaResposta = (e) => proporcao(e.responderam, e.convidadas)
// ⚠️ T11: sobre quem CONFIRMOU (inclusive quem faltou), não sobre o "sim" do
// convite — a mesma régua do placar e de `calcularConjunto`.
const taxaPresenca = (e) => proporcao(e.compareceram, e.confirmadas)

const doisDigitos = (n) => String(n).padStart(2, '0')
const hojeLocal = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${doisDigitos(d.getMonth() + 1)}-${doisDigitos(d.getDate())}`
})()

// ⚠️ OS 45 DIAS SÃO AVISO, NÃO TRAVA: o banco não recusa. A conta sai da lista
// que a tela já tem (`proximaDataPermitidaDaLista`, testada).
const avisoDaCadencia = computed(() =>
  avisoDos45Dias(proximaDataPermitidaDaLista(encontros.value, novo.stylist), novo.quando))

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

// ⚠️ `silencioso`: depois de marcar presença, a lista se atualiza SEM virar
// "Carregando…". Na porta da loja, marcando uma convidada atrás da outra, a
// tela piscando e fechando o bloco a cada toque seria inusável.
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
    // ⚠️ SÓ PEDE AS ARQUIVADAS QUANDO A SITUAÇÃO PRECISA (R1): a função de
    // conta chega sem elas por padrão, e um array que nunca as recebeu não
    // passa a tê-las só porque o filtro de tela mudou — ver `filtros.js`.
    const incluirArquivadas = precisaDoBanco(filtro.value.situacao)
    const [lista, quem] = await Promise.all([
      chamar('vessel_conta_das_private_edits',
        { p_dias: P_DIAS, p_incluir_arquivadas: incluirArquivadas }),
      chamar('vessel_stylists_para_escolher', {}),
    ])
    encontros.value = lista || []
    stylists.value = quem || []
    // O que está gravado mudou: os rascunhos de situação voltam ao banco.
    // ⚠️ NASCEM AQUI, e não durante o desenho: escrever em estado reativo no
    // meio do render faz o Vue redesenhar de novo.
    for (const k of Object.keys(rascunhosDaSituacao)) delete rascunhosDaSituacao[k]
    for (const e of encontros.value) {
      rascunhosDaSituacao[e.codigo] = {
        status: e.status || 'agendado',
        realizadoEm: e.realizado_em || '',
        motivo: e.motivo || '',
        observacoes: e.observacoes || '',
      }
      if (!formulariosDeConvidar[e.codigo]) {
        formulariosDeConvidar[e.codigo] = { nome: '', whatsapp: '', email: '', tocado: false }
      }
    }
  } catch (e) {
    erro.value = classificarErro(e)
  } finally {
    carregando.value = false
  }
}

// ⚠️ O ÚNICO GATILHO DE VOLTAR AO BANCO É A SITUAÇÃO PEDIR ARQUIVADA — nunca
// busca, loja, ordem ou período: essas quatro filtram o que já está em
// memória. Recarregar a cada letra digitada seria uma chamada ao banco por
// tecla (ver o cabeçalho de `filtros.js`).
watch(() => precisaDoBanco(filtro.value.situacao), (precisaAgora, precisavaAntes) => {
  if (precisaAgora !== precisavaAntes) carregar()
})

async function criar() {
  if (problemas.value.length) return
  criando.value = true
  erroAoCriar.value = ''
  criado.value = null
  try {
    // ⚠️ O campo datetime-local devolve hora LOCAL sem fuso. Mandar a string
    // crua faria o banco ler como UTC e o encontro nasceria 3 horas adiantado.
    const quandoISO = new Date(novo.quando).toISOString()
    const r = await chamar('vessel_criar_private_edit', {
      p_stylist: novo.stylist, p_quando: quandoISO,
      p_local: novo.local || null, p_praca: novo.praca,
      p_loja: novo.loja || null, p_vagas: novo.vagas, p_teste: false,
    })
    // A mensagem do banco vem para a tela: ela já explica em português qual
    // conferência falhou.
    if (!r?.ok) { erroAoCriar.value = r?.erro || 'Não consegui criar agora.'; return }
    criado.value = r
    novo.local = ''
    await carregar()
  } catch {
    erroAoCriar.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    criando.value = false
  }
}

async function encerrar(encontro, ativa) {
  mexendo.value = encontro.codigo
  erroAoMexer.value = null
  try {
    const r = await chamar('vessel_private_edit_encerrar',
      { p_codigo: encontro.codigo, p_ativa: ativa })
    // ⚠️ Se a gravação falha, o selo NÃO muda: tela que parece salva e não
    // salvou é o defeito mais caro de perceber.
    if (!r?.ok) { erroAoMexer.value = encontro.codigo; return }
    confirmando.value = null
    // ⚠️ O encontro mudou de estado: a explicação de "tem_gente" (se estava
    // na tela) fica desatualizada — encerrar não muda quem está pendurado,
    // mas deixar a frase parada ali depois de uma ação bem-sucedida confunde
    // mais do que ajuda. Some junto; se a pessoa tentar apagar de novo, a
    // recusa (e a frase) voltam do zero, com o estado atual.
    delete bloqueioDeApagar[encontro.codigo]
    await carregar()
  } catch {
    erroAoMexer.value = encontro.codigo
  } finally {
    mexendo.value = null
  }
}

// ── editar (inline) ─────────────────────────────────────────────────────────
const editando = ref(null)
const rascunho = reactive({ stylist: '', quando: '', local: '', praca: '', loja: '', vagas: 8 })
const salvandoEdicao = ref(null)
const erroDeEditar = ref(null)
const mensagemEditar = ref('')

function abrirEditar(e) {
  editando.value = e.codigo
  erroDeEditar.value = null
  apagando.value = null
  Object.assign(rascunho, {
    stylist: e.stylist || '',
    quando: paraCampoDatetimeLocal(e.quando),
    local: e.local || '',
    praca: e.praca || '',
    loja: e.loja || '',
    vagas: e.vagas,
  })
}

function fecharEditar() {
  editando.value = null
  erroDeEditar.value = null
}

async function salvarEdicao(e) {
  salvandoEdicao.value = e.codigo
  erroDeEditar.value = null
  try {
    const quandoISO = rascunho.quando ? new Date(rascunho.quando).toISOString() : null
    const r = await chamar('vessel_private_edit_editar', {
      p_codigo: e.codigo,
      p_quando: quandoISO,
      p_local: rascunho.local || null,
      p_praca: rascunho.praca || null,
      p_loja: rascunho.loja || null,
      p_vagas: rascunho.vagas || null,
      p_stylist: rascunho.stylist || null,
    })
    if (!r?.ok) {
      erroDeEditar.value = e.codigo
      mensagemEditar.value = mensagemDeEditar(r?.situacao)
      return
    }
    editando.value = null
    await carregar()
  } catch {
    erroDeEditar.value = e.codigo
    mensagemEditar.value = mensagemDeEditar('erro_de_rede')
  } finally {
    salvandoEdicao.value = null
  }
}

// ── arquivar / desarquivar ───────────────────────────────────────────────────
const arquivando = ref(null)
const erroDeArquivar = ref(null)
const mensagemArquivar = ref('')

async function alternarArquivar(e) {
  arquivando.value = e.codigo
  erroDeArquivar.value = null
  try {
    const r = await chamar('vessel_private_edit_arquivar',
      { p_codigo: e.codigo, p_arquivada: !e.arquivada })
    if (!r?.ok) {
      erroDeArquivar.value = e.codigo
      mensagemArquivar.value = mensagemDeArquivar(r?.situacao)
      return
    }
    // ⚠️ MESMO MOTIVO DE `encerrar()`: o estado mudou, a explicação de
    // "tem_gente" (se estava visível) não pode ficar parada na tela.
    delete bloqueioDeApagar[e.codigo]
    await carregar()
  } catch {
    erroDeArquivar.value = e.codigo
    mensagemArquivar.value = mensagemDeArquivar('erro_de_rede')
  } finally {
    arquivando.value = null
  }
}

// ── apagar ───────────────────────────────────────────────────────────────────
const apagando = ref(null)
const mexendoApagar = ref(null)
const erroDeApagar = ref(null)
const mensagemApagar = ref('')
// codigo -> frase (quando a resposta foi `tem_gente`; NÃO é um erro).
const bloqueioDeApagar = reactive({})

async function apagar(e) {
  mexendoApagar.value = e.codigo
  erroDeApagar.value = null
  try {
    const r = await chamar('vessel_private_edit_apagar', { p_codigo: e.codigo })
    if (r?.ok) {
      apagando.value = null
      await carregar()
      return
    }
    if (r?.situacao === 'tem_gente') {
      // ⚠️ NÃO é erro vermelho: é a explicação de por que apagar está fora de
      // questão, com as duas saídas de verdade — ver private-edit-regras.js.
      bloqueioDeApagar[e.codigo] = mensagemDeTemGente(e.responderam)
      apagando.value = null
      return
    }
    erroDeApagar.value = e.codigo
    mensagemApagar.value = mensagemDeApagar(r?.situacao)
  } catch {
    erroDeApagar.value = e.codigo
    mensagemApagar.value = mensagemDeApagar('erro_de_rede')
  } finally {
    mexendoApagar.value = null
  }
}

// ── ver quem foi ─────────────────────────────────────────────────────────────
const convidadasAbertas = ref(null)
const carregandoConvidadas = ref(null)
const convidadas = reactive({})
const convidadasVazias = reactive({})
const convidadasErro = reactive({})

async function verQuemFoi(e) {
  // Um segundo clique no mesmo encontro fecha o bloco, sem ir ao banco de novo.
  if (convidadasAbertas.value === e.codigo) { convidadasAbertas.value = null; return }
  convidadasAbertas.value = e.codigo
  if (convidadas[e.codigo] || convidadasVazias[e.codigo]) return // já tem, não busca de novo
  await buscarConvidadas(e)
}

async function buscarConvidadas(e, opcoes) {
  if (opcoes?.silencioso !== true) carregandoConvidadas.value = e.codigo
  convidadasErro[e.codigo] = false
  try {
    // ⚠️ MESMA JANELA (P_DIAS) da conta do topo — R14: a régua da receita e a
    // régua da coluna "Comprou" têm de ser a mesma, na mesma tela.
    const lista = await chamar('vessel_convidadas_do_encontro',
      { p_codigo: e.codigo, p_dias: P_DIAS })
    if (Array.isArray(lista) && lista.length) {
      convidadas[e.codigo] = lista
      convidadasVazias[e.codigo] = false
    } else {
      // ⚠️ LISTA VAZIA NÃO É ERRO — é "ninguém respondeu ainda", diferente de
      // "deu erro ao buscar". As duas precisam de telas diferentes.
      convidadas[e.codigo] = null
      convidadasVazias[e.codigo] = true
    }
  } catch {
    convidadasErro[e.codigo] = true
  } finally {
    carregandoConvidadas.value = null
  }
}

// ── a situação do encontro (T11) ─────────────────────────────────────────────
const rascunhosDaSituacao = reactive({})
const gravandoSituacao = ref(null)
const erroDaSituacao = reactive({})

const SEM_RASCUNHO = Object.freeze({ status: 'agendado', realizadoEm: '', motivo: '', observacoes: '' })
function situacaoDe(e) {
  return rascunhosDaSituacao[e.codigo] || SEM_RASCUNHO
}

function situacaoMudou(e) {
  const r = situacaoDe(e)
  return r.status !== (e.status || 'agendado') || (r.realizadoEm || '') !== (e.realizado_em || '')
    || (r.motivo || '') !== (e.motivo || '') || (r.observacoes || '') !== (e.observacoes || '')
}

async function gravarSituacao(e) {
  const r = situacaoDe(e)
  erroDaSituacao[e.codigo] = ''
  if (precisaDeMotivo(r.status) && !String(r.motivo || '').trim()) {
    erroDaSituacao[e.codigo] = mensagemDeSituacaoDoEncontro('sem_motivo')
    return
  }
  gravandoSituacao.value = e.codigo
  try {
    const resp = await chamar('vessel_private_edit_situacao', {
      p_codigo: e.codigo,
      p_status: r.status,
      p_realizado_em: r.status === 'realizado' ? (r.realizadoEm || null) : null,
      p_motivo: precisaDeMotivo(r.status) ? r.motivo : null,
      // ⚠️ String vazia APAGA a observação no banco; nula não mexe. Aqui o
      // campo sempre vai como está, então apagar o texto apaga de verdade.
      p_observacoes: r.observacoes ?? '',
    })
    if (!resp?.ok) { erroDaSituacao[e.codigo] = mensagemDeSituacaoDoEncontro(resp?.situacao); return }
    await carregar({ silencioso: true })
  } catch {
    erroDaSituacao[e.codigo] = mensagemDeSituacaoDoEncontro('erro_de_rede')
  } finally {
    gravandoSituacao.value = null
  }
}

// ── incluir convidada (T11) ──────────────────────────────────────────────────
const formulariosDeConvidar = reactive({})
const convidando = ref(null)
const respostaDoConvidar = reactive({})

const SEM_FORMULARIO = Object.freeze({ nome: '', whatsapp: '', email: '', tocado: false })
function convidarDe(e) {
  return formulariosDeConvidar[e.codigo] || SEM_FORMULARIO
}

async function convidar(e) {
  const f = convidarDe(e)
  f.tocado = true
  respostaDoConvidar[e.codigo] = null
  if (problemasDaConvidada(f).length) return
  convidando.value = e.codigo
  try {
    const r = await chamar('vessel_convidar_para_encontro', {
      p_codigo: e.codigo, p_nome: f.nome, p_whatsapp: f.whatsapp, p_email: f.email || null,
    })
    if (!r?.ok) {
      respostaDoConvidar[e.codigo] = { ok: false, texto: mensagemDeConvidar(r?.situacao) }
      return
    }
    respostaDoConvidar[e.codigo] = {
      ok: true,
      texto: r.situacao === 'ja_estava' ? mensagemDeConvidar('ja_estava')
        : `${f.nome.trim()} entrou na lista como convidada nº ${r.id}.`,
    }
    Object.assign(f, { nome: '', whatsapp: '', email: '', tocado: false })
    await Promise.all([buscarConvidadas(e, { silencioso: true }), carregar({ silencioso: true })])
  } catch {
    respostaDoConvidar[e.codigo] = { ok: false, texto: mensagemDeConvidar('erro_de_rede') }
  } finally {
    convidando.value = null
  }
}

// ── marcar convite e presença (T11) ──────────────────────────────────────────
const marcando = ref(null)
const erroDeMarcar = reactive({})

async function marcar(e, c, gesto) {
  marcando.value = c.id
  erroDeMarcar[c.id] = ''
  try {
    // ⚠️ DUAS PORTAS, CADA UMA COM O SEU DADO: o convite (enviado / sim / não)
    // em `vessel_convite_marcar`; a presença (veio / não veio) na porta da
    // Central de Atendimentos, que carimba e descarimba a hora de chegada.
    const r = ['realizado', 'no_show'].includes(gesto)
      ? await chamar('vessel_situacao_do_atendimento', { p_id: c.id, p_situacao: gesto })
      : await chamar('vessel_convite_marcar', { p_id: c.id, p_marca: gesto })
    if (!r?.ok) { erroDeMarcar[c.id] = mensagemDeMarcar(r?.situacao); return }
    await Promise.all([buscarConvidadas(e, { silencioso: true }), carregar({ silencioso: true })])
  } catch {
    erroDeMarcar[c.id] = mensagemDeMarcar('erro_de_rede')
  } finally {
    marcando.value = null
  }
}

async function copiar(texto, marca) {
  try {
    await navigator.clipboard.writeText(texto)
    copiado.value = marca
    setTimeout(() => { if (copiado.value === marca) copiado.value = null }, 2000)
  } catch { /* o endereço segue na tela para ser selecionado à mão */ }
}

onMounted(carregar)
</script>

<style scoped>
@import './estilo-comercial.css';
</style>
