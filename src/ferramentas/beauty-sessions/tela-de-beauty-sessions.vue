<template>
  <div class="tela-bs id-ferramenta">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('beauty-sessions')]"
                   titulo="Vessel — Beauty Sessions"
                   :subtitulo="subtitulo" @voltar="voltar" />

    <div class="cv-largo bs-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <!-- ── CRIAR ──────────────────────────────────────────────────────── -->
      <section class="bs-bloco id-bloco-form">
        <h2 class="bs-etiqueta id-titulo"><icone-do-bloco nome="novo" />Criar uma sessão</h2>
        <div class="bs-form">
          <label class="bs-campo" for="bs-quando"><span>Quando</span>
            <input id="bs-quando" type="date" v-model="nova.quando" @change="sugerir"></label>
          <label class="bs-campo" for="bs-loja"><span>Loja</span>
            <select id="bs-loja" v-model="nova.loja" @change="sugerir">
              <option value="">Escolha…</option>
              <option v-for="(nome, chave) in LOJAS" :key="chave" :value="chave">{{ nome }}</option>
            </select></label>
          <label class="bs-campo" for="bs-seq"><span>Número ou apelido</span>
            <input id="bs-seq" type="text" maxlength="4" v-model="nova.sequencia"
                   @input="sugerir" placeholder="01"></label>
          <label class="bs-campo bs-campo-largo" for="bs-parceiro"><span>Salão parceiro</span>
            <input id="bs-parceiro" type="text" maxlength="80" v-model="nova.parceiro"
                   placeholder="O nome do salão"></label>
          <label class="bs-campo bs-campo-largo" for="bs-codigo"><span>Código</span>
            <input id="bs-codigo" type="text" maxlength="24" v-model="nova.codigo"></label>
        </div>

        <!-- ⚠️ O aviso do parceiro só aparece quando ele falta. Aviso que
             aparece sempre vira paisagem. -->
        <p v-if="!nova.parceiro.trim()" class="bs-nota bs-nota-atencao">
          Sem o nome do salão, depois do dia não dá mais para saber qual parceiro
          trouxe qual cliente.
        </p>
        <ul v-if="problemas.length" class="bs-problemas">
          <li v-for="p in problemas" :key="p">{{ p }}</li>
        </ul>
        <p v-if="erroAoCriar" class="bs-nota bs-nota-erro">{{ erroAoCriar }}</p>

        <div class="bs-acoes">
          <button class="btn btn-principal" :disabled="problemas.length > 0 || criando"
                  @click="criar">{{ criando ? 'Criando…' : 'Criar sessão' }}</button>
        </div>
      </section>

      <!-- ── BUSCAR, FILTRAR, PERÍODO E ORDENAR ────────────────────────────
           ⚠️ A BARRA NUNCA VAI SOZINHA AO BANCO, salvo o caso de baixo
           (`precisaDoBanco`). Busca, situação (fora arquivada/todas), loja e
           ordem acontecem sobre o que já está em memória — ver filtros.js. -->
      <barra-de-lista v-model="filtro" :lojas="LOJAS"
                      :mostrar="['busca', 'periodo', 'situacao', 'loja', 'ordem']"
                      placeholder-busca="código, loja ou salão parceiro" />

      <!-- ⚠️ ESTAS DUAS NOTAS FICAM AQUI, UMA VEZ. Elas estavam repetidas dentro
           de cada sessão — com três sessões na tela, o mesmo parágrafo aparecia
           três vezes e virava paisagem, que é exatamente o que o item 9 do
           padrão proíbe. Aviso que aparece sempre ninguém lê. -->
      <section v-if="!carregando && !erro && sessoes.length" class="bs-bloco bs-bloco-leitura id-bloco-leitura">
        <h2 class="bs-etiqueta id-titulo"><icone-do-bloco nome="leitura" />Como ler os números</h2>
        <p class="bs-nota bs-nota-primeira">
          <b>Leram o QR</b> é leitura, não pessoa: a mesma cliente abrindo duas
          vezes conta duas. Quem vira gente com nome e WhatsApp é <b>Se
          identificaram</b> — pelo QR ou <b>pela equipe</b>, que cadastra a lead
          ali mesmo, no cartão da sessão. Cada sessão tem <b>um QR só, o da mesa</b> (o display
          do salão); as leituras que o antigo QR do cartão já teve continuam
          somadas aqui, para nenhuma sumir da conta.
        </p>
        <p class="bs-nota">
          <b>Encerrada</b> e <b>arquivada</b> são coisas diferentes. Encerrada
          aconteceu e continua contando na receita e nos números. Arquivada é o
          que não devia ter ficado ali — duplicata, engano — e por isso sai das
          contas e da lista por padrão; o filtro "Situação" traz de volta quem
          precisar olhar para ela.
        </p>
        <p class="bs-nota">
          O QR de cada sessão se baixa aqui mesmo, sem fundo, em PNG e SVG — e
          também no <b>Material Gráfico</b>, junto dos QR das outras ações. O
          desenho é o mesmo do site e é <b>lido de volta por um leitor de QR</b> nos
          testes do sistema; ainda assim, leia com o celular a prova impressa
          antes de mandar rodar — material impresso não tem segunda chance.
        </p>
      </section>

      <div v-if="carregando" class="bs-carregando">Carregando…</div>

      <template v-else-if="!erro">
        <!-- ── O CONJUNTO ───────────────────────────────────────────────── -->
        <section v-if="sessoes.length" class="bs-bloco">
          <h2 class="bs-etiqueta id-titulo"><icone-do-bloco nome="conjunto" />Todas as sessões juntas</h2>
          <!-- ⚠️ O CONJUNTO É SOBRE O QUE ESTÁ NA TELA, NÃO SOBRE O QUE VEIO
               DO BANCO: se a pessoa filtrou por loja ou período, o total tem
               de acompanhar — reusar o total de antes do filtro é a tela
               mentindo com número certo. `calcularConjunto` só soma o que
               RECEBE (beauty-sessions-regras.js), e aqui ela sempre recebe
               `sessoesNaTela`, nunca `sessoes`. -->
          <p class="bs-nota bs-nota-primeira">
            {{ sessoesNaTela.length }} de {{ sessoes.length }} sessões
            (o filtro de cima decide quais).
          </p>
          <div class="bs-numeros">
            <div class="bs-numero">
              <span class="bs-numero-valor">{{ conjunto.totalSessoes }}</span>
              <span class="bs-numero-rotulo">Sessões</span>
            </div>
            <div class="bs-numero">
              <span class="bs-numero-valor">{{ conjunto.totalLeituras }}</span>
              <span class="bs-numero-rotulo">Leram o QR</span>
            </div>
            <div class="bs-numero">
              <span class="bs-numero-valor">{{ conjunto.totalPessoas }}</span>
              <span class="bs-numero-rotulo">Se identificaram</span>
              <span v-if="conjunto.totalPessoasQr !== null" class="bs-numero-base">
                {{ portasEscritas({ pessoas_qr: conjunto.totalPessoasQr, pessoas_equipe: conjunto.totalPessoasEquipe }) }}</span>
            </div>
            <div class="bs-numero">
              <span class="bs-numero-valor">{{ conjunto.totalCompareceram }}</span>
              <span class="bs-numero-rotulo">Foram à loja</span>
            </div>
            <div class="bs-numero bs-numero-destaque">
              <span v-if="!conjunto.conversao.temBase" class="bs-numero-vazio">sem leitura ainda</span>
              <span v-else class="bs-numero-valor">{{ emPorcento(conjunto.conversao.valor) }}</span>
              <span class="bs-numero-rotulo">Leram → se identificaram</span>
              <span v-if="conjunto.conversao.temBase" class="bs-numero-base">
                {{ taxaEscrita(conjunto.conversao) }}</span>
              <span v-if="margemEscrita(conjunto.conversao)" class="bs-numero-margem">
                {{ margemEscrita(conjunto.conversao) }}</span>
            </div>
            <div class="bs-numero">
              <span class="bs-numero-valor">{{ emReais(conjunto.totalReceita) }}</span>
              <span class="bs-numero-rotulo">Receita somada</span>
              <span class="bs-numero-base">{{ janelaEscrita(P_DIAS) }}</span>
            </div>
          </div>
          <!-- ⚠️ A conversão do conjunto é a SOMA dos numeradores sobre a SOMA
               dos denominadores, nunca a média das taxas de cada sessão: uma
               sessão de 4 leituras pesaria igual a uma de 200. -->
          <p class="bs-nota">
            A conversão do conjunto soma leituras e identificações — não é a
            média das taxas de cada sessão, que daria a uma sessão pequena o
            mesmo peso de uma cheia.
          </p>
        </section>

        <!-- ── AS SESSÕES ───────────────────────────────────────────────── -->
        <section v-for="s in sessoesNaTela" :key="s.codigo" class="bs-bloco bs-sessao id-cartao"
                 :class="`id-tom-${seloDaSessao(s).tom}`">
          <div class="bs-cabeca">
            <div class="bs-cabeca-texto">
              <h2 class="bs-titulo">{{ dataLegivel(s.quando) }} · {{ LOJAS[s.loja] || s.loja }}</h2>
              <p class="bs-sub">
                <span class="bs-codigo">{{ s.codigo }}</span>
                <span v-if="s.parceiro"> · {{ s.parceiro }}</span>
                <span v-else class="bs-sem-parceiro"> · sem salão informado</span>
              </p>
            </div>
            <span class="bs-selo id-selo" :class="[seloDaSessao(s).classe, `id-tom-${seloDaSessao(s).tom}`]">{{ seloDaSessao(s).texto }}</span>
          </div>

          <div class="bs-numeros">
            <!-- ⚠️ UM NÚMERO SÓ: mesa + cartão (resumoDaSessao().leituras). O
                 cartão saiu em 23/09/2026, e o que ele já leu continua somado. -->
            <div class="bs-numero">
              <span class="bs-numero-valor">{{ conta(s).leituras }}</span>
              <span class="bs-numero-rotulo">Leram o QR</span>
            </div>
            <div class="bs-numero">
              <span class="bs-numero-valor">{{ conta(s).pessoas }}</span>
              <span class="bs-numero-rotulo">Se identificaram</span>
              <!-- ⚠️ AS DUAS PORTAS (24/09/2026): o QR e o cadastro da equipe.
                   Some se o banco ainda não as manda — ver `portasEscritas`. -->
              <span v-if="portasEscritas(s)" class="bs-numero-base">{{ portasEscritas(s) }}</span>
            </div>
            <div class="bs-numero">
              <span class="bs-numero-valor">{{ conta(s).compareceram }}</span>
              <span class="bs-numero-rotulo">Foram à loja</span>
            </div>
            <div class="bs-numero bs-numero-destaque">
              <!-- ⚠️ SEM LEITURA NÃO É 0%: "0%" faria uma sessão que ninguém
                   abriu parecer uma que fracassou, e só a segunda pede decisão.
                   ⚠️ E A TAXA NUNCA SAI SOZINHA — vem com de quantos saiu, e com
                   a faixa quando a base é pequena demais para decidir. Uma
                   sessão de salão tem dezenas de leituras: "50%" sobre 4 é duas
                   pessoas, e sem o denominador vira tendência na cabeça de quem
                   lê. -->
              <span v-if="!conversao(s).temBase" class="bs-numero-vazio">sem leitura ainda</span>
              <span v-else class="bs-numero-valor">{{ emPorcento(conversao(s).valor) }}</span>
              <span class="bs-numero-rotulo">Leram → se identificaram</span>
              <span v-if="conversao(s).temBase" class="bs-numero-base">
                {{ taxaEscrita(conversao(s)) }}</span>
              <span v-if="margemEscrita(conversao(s))" class="bs-numero-margem">
                {{ margemEscrita(conversao(s)) }}</span>
            </div>
          </div>

          <!-- ⚠️ A RECEITA SÓ APARECE COM A RÉGUA JUNTO. Não existe no dado
               campo dizendo "esta compra veio desta sessão": o que existe é a
               mesma cliente comprando perto da visita. A janela vem do banco,
               dentro da resposta, para não divergir da conta que a produziu. -->
          <p v-if="janelaEscrita(s.janela_de_venda_em_dias)" class="bs-nota">
            Receita atribuída: <b>{{ emReais(s.receita) }}</b> —
            {{ janelaEscrita(s.janela_de_venda_em_dias) }}.
          </p>

          <!-- ── AS AÇÕES DA SESSÃO (24/09/2026) ─────────────────────────────
               Pedido do dono: botões "mais evidentes", cada um pelo sentido.
               Aqui mora o que se faz COM a sessão: cadastrar lead (a principal
               do cartão), ver as leads, editar, encerrar/reabrir. Arquivar e
               apagar ficam no fim do cartão, separados, para não se clicar por
               engano. Os tons são de `identidade-da-ferramenta.css`. -->
          <div class="bs-acoes bs-acoes-sessao">
            <template v-if="podeExecutarAcao('cadastrar_lead', podeEditar)">
              <button class="btn btn-principal id-btn-principal" :disabled="s.arquivada"
                      :aria-expanded="cadastroAberto === s.codigo"
                      @click="alternarCadastro(s)"><icone-do-bloco nome="lead-mais" />Cadastrar lead</button>
            </template>
            <button class="btn id-btn-editar" :disabled="carregandoLeads === s.codigo"
                    :aria-expanded="leadsAbertas === s.codigo"
                    @click="alternarLeads(s)"><icone-do-bloco nome="lista" />{{ carregandoLeads === s.codigo ? 'Buscando…'
                      : (leadsAbertas === s.codigo ? 'Fechar as leads' : 'Leads desta sessão') }}</button>

            <template v-if="podeExecutarAcao('editar', podeEditar)">
              <button v-if="editando !== s.codigo" class="btn id-btn-editar"
                      @click="abrirEditar(s)"><icone-do-bloco nome="editar" />Editar…</button>
            </template>

            <!-- ⚠️ R13: Encerrar/Reabrir agora EXIGEM a mesma permissão de
                 editar que Editar/Arquivar/Apagar já exigiam —
                 `vessel_beauty_session_encerrar` passou a checar
                 `is_vessel_atendimentos_editar()`
                 (2026-09-19-vessel-encerrar-exige-editar.sql). A regra mora em
                 `podeExecutarAcao` (beauty-sessions-regras.js), testada — não
                 reescrita aqui como um `v-if` solto de novo, que foi
                 exatamente o Critical que a tela irmã levou. -->
            <template v-if="podeExecutarAcao('encerrar', podeEditar)">
              <template v-if="s.ativa">
                <button v-if="confirmando !== s.codigo" class="btn id-btn-parar"
                        @click="confirmando = s.codigo"><icone-do-bloco nome="parar" />Encerrar…</button>
                <template v-else>
                  <span class="bs-confirma">Encerrar faz o QR parar de aceitar contato novo.
                    Os números ficam, e a equipe ainda pode cadastrar.</span>
                  <button class="btn" @click="confirmando = null">Deixar como está</button>
                  <button class="btn btn-perigo id-btn-perigo" :disabled="mexendo === s.codigo"
                          @click="encerrar(s, false)"><icone-do-bloco nome="parar" />Encerrar</button>
                </template>
              </template>
              <button v-else class="btn id-btn-voltar" :disabled="mexendo === s.codigo"
                      @click="encerrar(s, true)"><icone-do-bloco nome="reabrir" />Reabrir</button>
            </template>
          </div>
          <p v-if="erroAoMexer === s.codigo" class="bs-nota bs-nota-erro">
            Não consegui gravar agora. Tente de novo em um instante.
          </p>
          <!-- ⚠️ CAMPO QUE NÃO PODE GRAVAR FICA TRAVADO, COM O MOTIVO (item 9). -->
          <p v-if="s.arquivada && podeExecutarAcao('cadastrar_lead', podeEditar)" class="bs-nota bs-recado bs-recado-aviso">
            Sessão arquivada não recebe lead nova. Desarquive para cadastrar.
          </p>

          <!-- ── EDITAR (inline, sem modal) ───────────────────────────────
               ⚠️ SÓ "QUANDO" E "LOJA" — o `codigo` nunca entra aqui: ele está
               dentro do link do QR da mesa (e do antigo QR do cartão), e os
               dois podem estar IMPRESSOS. `vessel_beauty_session_editar` nem aceita
               `p_codigo` de novo por acaso: a garantia é a ausência dele. -->
          <div v-if="podeExecutarAcao('editar', podeEditar) && editando === s.codigo" class="id-caixa-form">
            <h3 class="bs-etiqueta bs-etiqueta-interna id-titulo"><icone-do-bloco nome="editar" />Editar</h3>
            <div class="bs-form">
              <label class="bs-campo" :for="`ed-quando-${s.codigo}`"><span>Quando</span>
                <input :id="`ed-quando-${s.codigo}`" type="date" v-model="rascunho.quando"></label>
              <label class="bs-campo" :for="`ed-loja-${s.codigo}`"><span>Loja</span>
                <select :id="`ed-loja-${s.codigo}`" v-model="rascunho.loja">
                  <option value="">Escolha…</option>
                  <option v-for="(nome, chave) in LOJAS" :key="chave" :value="chave">{{ nome }}</option>
                </select></label>
            </div>
            <p class="bs-nota">
              <b>Código nunca muda</b>: ele está dentro do QR já impresso no
              display do salão.
            </p>
            <p v-if="erroDeEditar === s.codigo" class="bs-nota bs-nota-erro">{{ mensagemEditar }}</p>
            <div class="bs-acoes">
              <button class="btn" :disabled="salvandoEdicao === s.codigo" @click="fecharEditar">Cancelar</button>
              <button class="btn btn-principal" :disabled="salvandoEdicao === s.codigo"
                      @click="salvarEdicao(s)">{{ salvandoEdicao === s.codigo ? 'Salvando…' : 'Salvar' }}</button>
            </div>
          </div>

          <!-- ── CADASTRAR LEAD (24/09/2026) ──────────────────────────────
               ⚠️ O MESMO CAMINHO DA LEAD DO QR (`vessel_beauty_session_cadastrar_lead`
               chama o miolo da página do QR): mesma ficha, base de clientes,
               planilha e pedido de visita na loja da sessão. Os campos são os
               do site, na mesma ordem — ver `cadastro-de-lead.js`. -->
          <div v-if="podeExecutarAcao('cadastrar_lead', podeEditar) && cadastroAberto === s.codigo"
               class="id-caixa-form bs-lead-form">
            <h3 class="bs-etiqueta bs-etiqueta-interna id-titulo"><icone-do-bloco nome="lead-mais" />Cadastrar lead nesta sessão</h3>
            <div class="bs-form">
              <label class="bs-campo bs-campo-largo" :for="`bsl-nome-${s.codigo}`"><span>Nome</span>
                <input :id="`bsl-nome-${s.codigo}`" type="text" maxlength="120" autocomplete="off"
                       v-model="formDe(s).nome"></label>
              <div class="bs-campo bs-campo-largo"><span>WhatsApp com DDD</span>
                <div class="bs-fone">
                  <span class="bs-fone-mais" aria-hidden="true">+</span>
                  <input :id="`bsl-pais-${s.codigo}`" class="bs-fone-pais" type="tel" inputmode="numeric"
                         maxlength="3" aria-label="Código do país" v-model="formDe(s).pais">
                  <input :id="`bsl-ddd-${s.codigo}`" class="bs-fone-ddd" type="tel" inputmode="numeric"
                         maxlength="2" placeholder="19" aria-label="DDD" v-model="formDe(s).ddd">
                  <input :id="`bsl-numero-${s.codigo}`" class="bs-fone-numero" type="tel" inputmode="numeric"
                         maxlength="10" placeholder="99999-9999" aria-label="Número do WhatsApp"
                         v-model="formDe(s).numero">
                </div>
              </div>
              <label class="bs-campo" :for="`bsl-insta-${s.codigo}`"><span>Instagram, se ela quiser</span>
                <input :id="`bsl-insta-${s.codigo}`" type="text" maxlength="120" autocomplete="off"
                       placeholder="@perfil" v-model="formDe(s).instagram"></label>
              <label class="bs-campo" :for="`bsl-interesse-${s.codigo}`"><span>O que ela gostaria agora?</span>
                <select :id="`bsl-interesse-${s.codigo}`" v-model="formDe(s).interesse">
                  <option value="">Prefere contar na conversa</option>
                  <option v-for="i in INTERESSES" :key="i.valor" :value="i.valor">{{ i.rotulo }}</option>
                </select></label>
            </div>
            <!-- ⚠️ DECISÃO DO DONO: o cadastro pela equipe grava a autorização de
                 marketing SEMPRE. A frase existe para a equipe perguntar antes. -->
            <p class="bs-nota">
              Ao cadastrar, fica registrado que <b>ela autorizou receber convites e
              novidades da VESSEL pelo WhatsApp</b>. Confirme com ela antes.
            </p>
            <ul v-if="formDe(s).tocado && problemasDaLead(formDe(s)).length" class="bs-problemas">
              <li v-for="p in problemasDaLead(formDe(s))" :key="p">{{ p }}</li>
            </ul>
            <p v-if="recadoDoCadastrar[s.codigo]" class="bs-nota bs-recado" role="status"
               :class="`bs-recado-${recadoDoCadastrar[s.codigo].tom}`">{{ recadoDoCadastrar[s.codigo].texto }}</p>
            <div class="bs-acoes">
              <button class="btn" :disabled="cadastrando === s.codigo" @click="cadastroAberto = null">Fechar</button>
              <button class="btn btn-principal" :disabled="cadastrando === s.codigo"
                      @click="cadastrar(s)">{{ cadastrando === s.codigo ? 'Cadastrando…' : 'Cadastrar' }}</button>
            </div>
          </div>

          <!-- ── AS LEADS DA SESSÃO (24/09/2026) ──────────────────────────
               ⚠️ CARTÕES, NÃO TABELA: a equipe olha isto no celular, no salão.
               ⚠️ ERRO DE LEITURA NÃO VIRA LISTA VAZIA (item 9 do padrão). -->
          <template v-if="leadsAbertas === s.codigo">
            <h3 class="bs-etiqueta bs-etiqueta-interna id-subtitulo">As leads desta sessão</h3>
            <p v-if="leadsErro[s.codigo]" class="bs-nota bs-nota-erro">
              Não consegui buscar as leads agora ({{ leadsErro[s.codigo] }}). Tente de novo em um instante.
            </p>
            <p v-else-if="leads[s.codigo] && !leads[s.codigo].length" class="bs-nota">
              Ninguém se identificou nesta sessão ainda — nem pelo QR, nem pela equipe.
            </p>
            <ul v-else-if="leads[s.codigo]" class="bs-leads">
              <li v-for="l in leads[s.codigo]" :key="l.pessoa_id" class="bs-lead id-cartao"
                  :class="`id-tom-${portaDaLead(l).tom}`">
                <div class="bs-cabeca">
                  <div class="bs-cabeca-texto">
                    <p class="bs-lead-nome">{{ l.nome }}</p>
                    <p class="bs-sub">{{ telefoneLegivel(l.telefone) }}<span v-if="l.instagram"> · {{ l.instagram }}</span></p>
                    <p class="bs-sub">
                      Entrou em {{ dataHoraLegivel(l.entrou_em) }}
                      · {{ l.foi_a_loja ? 'foi à loja' : 'ainda não foi à loja' }}<span v-if="l.comprou"> · <b>comprou</b></span>
                    </p>
                  </div>
                  <span class="bs-selo id-selo" :class="`id-tom-${portaDaLead(l).tom}`">{{ portaDaLead(l).texto }}</span>
                </div>
              </li>
            </ul>
          </template>

          <!-- ── O QR DA SESSÃO (um só: o da mesa) ─────────────────────────
               ⚠️ O MESMO componente do Material Gráfico, com o MESMO item
               (`itemDaBeauty`): os dois lugares baixam o mesmo arquivo, com o
               mesmo nome, para o mesmo link. `apoio`: aqui os botões do QR são
               o grupo de apoio — a principal do cartão é "Cadastrar lead". -->
          <h3 class="bs-etiqueta bs-etiqueta-interna id-subtitulo">O QR desta sessão — a mesa, o display do salão</h3>
          <qr-para-baixar class="bs-qr" :endereco="itemDaBeauty(s).endereco" apoio
                          :legenda="itemDaBeauty(s).legenda" :arquivo="itemDaBeauty(s).arquivo" />
          <router-link class="bs-atalho"
                       :to="{ name: 'material-grafico', query: { busca: s.codigo, ...(s.ativa === false || s.arquivada ? { todos: '1' } : {}) } }">
            Ver no Material Gráfico →</router-link>

          <!-- ── APAGAR: tem_gente / tem_leads viram explicação, nunca erro ── -->
          <template v-if="podeExecutarAcao('apagar', podeEditar) && bloqueioDeApagar[s.codigo]">
            <p class="bs-nota bs-nota-aviso">{{ bloqueioDeApagar[s.codigo] }}</p>
          </template>

          <!-- ⚠️ ARQUIVAR E APAGAR NO FIM, SEPARADOS, com respiro e um filete
               em cima: são os dois que tiram a sessão de cena. Botão de perigo
               NÃO fica solto na lista: pede um passo a mais. -->
          <div class="bs-acoes bs-acoes-fim">
            <template v-if="podeExecutarAcao('arquivar', podeEditar)">
              <button class="btn id-btn-arquivar" :disabled="arquivando === s.codigo"
                      @click="alternarArquivar(s)"><icone-do-bloco nome="arquivar" />
                {{ arquivando === s.codigo ? 'Gravando…' : rotuloDeArquivar(s.arquivada) }}
              </button>
            </template>
            <template v-if="podeExecutarAcao('apagar', podeEditar)">
              <template v-if="!bloqueioDeApagar[s.codigo]">
                <button v-if="apagando !== s.codigo" class="btn btn-perigo id-btn-perigo"
                        @click="apagando = s.codigo"><icone-do-bloco nome="lixeira" />Apagar…</button>
                <template v-else>
                  <span class="bs-confirma">Apagar não pode ser desfeito.</span>
                  <button class="btn" @click="apagando = null">Deixar como está</button>
                  <button class="btn btn-perigo id-btn-perigo" :disabled="mexendoApagar === s.codigo"
                          @click="apagar(s)"><icone-do-bloco nome="lixeira" />Apagar de vez</button>
                </template>
              </template>
            </template>
          </div>
          <p v-if="erroDeArquivar === s.codigo" class="bs-nota bs-nota-erro">{{ mensagemArquivar }}</p>
          <p v-if="erroDeApagar === s.codigo" class="bs-nota bs-nota-erro">{{ mensagemApagar }}</p>
        </section>

        <p v-if="!sessoesNaTela.length && sessoes.length" class="bs-vazio">
          Nenhuma sessão passa neste filtro. Experimente "Todas, inclusive
          arquivadas" ou um período maior.
        </p>
        <p v-if="!sessoes.length" class="bs-vazio">
          Nenhuma Beauty Session criada ainda. Crie a primeira no bloco de cima.
        </p>
      </template>
    </div>
  </div>
</template>

<script setup>
/* VESSEL — BEAUTY SESSIONS: criar, filtrar, editar, arquivar, apagar e encerrar.
 *
 * POR QUE ESTA TELA EXISTE: em 18/09/2026 o dono disse que sentia "perda de
 * controle" nas gerações de link, cartão e QR. O levantamento deu razão a ele —
 * de cinco famílias de endereço público, três nasciam à mão, por migration, sem
 * tela nenhuma. Criar uma sessão dependia de alguém escrever SQL, ou seja,
 * dependia de alguém estar disponível.
 *
 * ⚠️ LÊ COM O TOKEN DA SESSÃO, NUNCA COM A CHAVE ANÔNIMA. As funções conferem
 * `is_vessel_atendimentos()` por dentro; com a chave anônima o PostgREST
 * responde 200 com lista VAZIA, e a tela diria "nenhuma sessão" para uma agenda
 * cheia. É o estrago do item 9 do PADRAO-DA-CENTRAL.
 *
 * ⚠️ O QR AGORA SAI DAQUI (23/09/2026), UM SÓ POR SESSÃO — o da mesa. O
 * dono decidiu tirar o do cartão ("concordo em ser só da mesa"). O desenho vem
 * de `src/compartilhado/qr.js`, cópia do codificador do site com a mesma
 * impressão digital, e `qr.test.mjs` LÊ CADA QR DE VOLTA com um leitor
 * independente (zxing) — a conferência que antes só o comando do site fazia.
 * O mesmo botão mora no Material Gráfico (`qr-para-baixar.vue`).
 *
 * ⚠️ O PERÍODO DA BARRA RECORTA A LISTA, NÃO O BANCO (R10/R17/R18). As duas
 * funções de conta do Comercial Vessel recebem `p_dias`, mas ele NUNCA filtra
 * linha nenhuma — só decide a janela de atribuição de venda
 * (`janela_de_venda_em_dias` na resposta). As três Beauty Sessions reais estão
 * marcadas para DEPOIS de hoje (19/09/2026): ligar "Período" ao `p_dias` do
 * banco não tiraria nem poria linha nenhuma, e um filtro de dois lados (ver
 * `filtros.js`) apagaria a tela inteira. Por isso não existe
 * `watch(() => filtro.value.dias, ...)` aqui — quem recorta por data é
 * `filtrar()`, sobre o que já voltou.
 *
 * ⚠️ ARQUIVADA PRECISA DE RE-FETCH, NÃO DE FILTRO (R1). A função de conta já
 * chega SEM as arquivadas (`p_incluir_arquivadas` nasce `false`). Só quando a
 * situação escolhida precisa delas a tela volta ao banco pedindo
 * `p_incluir_arquivadas: true` — ver `precisaDoBanco` em `filtros.js`.
 *
 * ⚠️ R14: UMA RÉGUA SÓ. `P_DIAS` é a mesma constante mandada para a (única)
 * chamada de conta desta tela — não há aqui uma segunda chamada com janela
 * diferente para divergir dela.
 */
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'
import BarraDeLista from '../comercial-vessel/barra-de-lista.vue'
import IconeDoBloco from '../../compartilhado/icone-do-bloco.vue'
import { estado, hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import {
  LOJAS, codigoSugerido, problemasDaSessao, resumoDaSessao, dataLegivel,
} from './contas-das-sessoes.js'
import QrParaBaixar from '../comercial-vessel/qr-para-baixar.vue'
import { itemDaBeauty } from '../comercial-vessel/material-grafico-regras.js'
import {
  podeExecutarAcao, calcularConjunto, mensagemDeEditar, mensagemDeArquivar,
  mensagemDeApagar, mensagemDeTemGente, mensagemDeTemLeads, seloDaSessao, rotuloDeArquivar,
} from './beauty-sessions-regras.js'
import {
  INTERESSES, FORMULARIO_VAZIO, problemasDaLead, corpoDoCadastro, recadoDoCadastro,
  portaDaLead, portasEscritas, telefoneLegivel,
} from './cadastro-de-lead.js'
// ⚠️ AS CONTAS DE PROPORÇÃO SÃO AS DA FAMÍLIA, e não uma versão local: as três
// telas do Comercial Vessel mostram taxa sobre base pequena, e a regra de
// quando a base deixa de servir tem de ser a MESMA nas três.
import {
  proporcao, taxaEscrita, margemEscrita, emPorcento, emReais, janelaEscrita,
} from '../comercial-vessel/estatistica.js'
import { filtrar, FILTRO_VAZIO, precisaDoBanco } from '../comercial-vessel/filtros.js'
import { paiDaTela, ROTULO_DO_PAI } from '../comercial-vessel/navegacao.js'

const router = useRouter()
function voltar() { router.push({ name: paiDaTela('beauty-sessions') }) }

// ⚠️ A JANELA DE ATRIBUIÇÃO DE VENDA (R14) — não é o período da barra. Mantida
// no valor de sempre desta tela (era `p_dias: 7` cravado antes desta tarefa).
const P_DIAS = 7

const podeEditar = computed(() => hasPermission('atendimentos.beauty-sessions', 'editar'))

const sessoes = ref([])
const carregando = ref(true)
const erro = ref(null)
const criando = ref(false)
const erroAoCriar = ref('')
const mexendo = ref(null)
const erroAoMexer = ref(null)
const confirmando = ref(null)

const filtro = ref({ ...FILTRO_VAZIO })

const nova = reactive({ quando: '', loja: '', sequencia: '01', parceiro: '', codigo: '' })

const problemas = computed(() => problemasDaSessao(nova))

// ⚠️ O FILTRO E O TOTAL AGEM SOBRE O QUE ESTÁ NA TELA: busca por
// código/loja/parceiro, situação, loja e ordem — tudo client-side, sobre
// `sessoes`, que só volta ao banco quando a situação exige arquivada (ver o
// watch abaixo).
const sessoesNaTela = computed(() =>
  filtrar(sessoes.value, filtro.value, { busca: ['codigo', 'loja', 'parceiro'], loja: 'loja' }))

// ⚠️ MESMO CUIDADO DA IRMÃ (Private Edit, Critical da rodada anterior): o
// conjunto tem de somar SEMPRE a lista filtrada, nunca a cheia.
// `calcularConjunto` (beauty-sessions-regras.js, testada) só soma o que
// RECEBE — aqui ela sempre recebe `sessoesNaTela`.
const conjunto = computed(() => calcularConjunto(sessoesNaTela.value))

const subtitulo = computed(() => {
  if (carregando.value || erro.value) return ''
  return `${conjunto.value.totalSessoes} sessão(ões) de ${sessoes.value.length} · `
    + `${conjunto.value.totalPessoas} identificação(ões)`
})

function conta(s) { return resumoDaSessao(s) }

/* ⚠️ APROXIMADA, E A TELA DIZ ISSO: o denominador são LEITURAS, e a mesma
 * pessoa lendo duas vezes entra duas. O intervalo de Wilson pressupõe uma
 * decisão por unidade, então ele é uma boa aproximação aqui — não uma
 * garantia. É melhor do que mostrar a taxa pelada, que é o que havia antes. */
function conversao(s) {
  const c = resumoDaSessao(s)
  return proporcao(c.pessoas, c.leituras)
}

/* A tela monta o código; a pessoa confere. Digitar à mão é onde nasce o erro
 * que ninguém vê — uma letra trocada vira campanha órfã no painel. */
function sugerir() {
  nova.codigo = codigoSugerido(nova.quando, nova.loja, nova.sequencia)
}

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

// ⚠️ `silencioso`: depois de cadastrar uma lead, os números do cartão
// precisam voltar do banco SEM a tela trocar tudo por "Carregando…" — o
// formulário aberto sumiria da mão de quem está cadastrando a próxima.
async function carregar(opcoes) {
  const silencioso = opcoes?.silencioso === true
  if (!silencioso) carregando.value = true
  erro.value = null
  try {
    // ⚠️ SEM SESSÃO NÃO SE TENTA LER: a resposta seria 200 com lista vazia, e a
    // tela mentiria dizendo que não há sessão nenhuma.
    if (!estado.currentSession?.access_token) {
      erro.value = { tipo: 'sem-sessao', acao: null,
        mensagem: 'Sua sessão expirou. Recarregue a página e entre de novo.' }
      return
    }
    // ⚠️ SÓ PEDE AS ARQUIVADAS QUANDO A SITUAÇÃO PRECISA (R1): a função de
    // conta chega sem elas por padrão, e um array que nunca as recebeu não
    // passa a tê-las só porque o filtro de tela mudou — ver `filtros.js`.
    const incluirArquivadas = precisaDoBanco(filtro.value.situacao)
    sessoes.value = await chamar('vessel_conta_das_beauty_sessions',
      { p_dias: P_DIAS, p_incluir_arquivadas: incluirArquivadas }) || []
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
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vessel_beauty_session_criar`, {
      method: 'POST', headers: cabecalho(),
      body: JSON.stringify({
        p_codigo: nova.codigo, p_quando: nova.quando, p_praca: nova.codigo.slice(12, 15),
        p_loja: nova.loja, p_parceiro: nova.parceiro || null,
      }),
    })
    const resposta = r.ok ? await r.json().catch(() => null) : null
    // ⚠️ A MENSAGEM DO BANCO VEM PARA A TELA. Ela já explica em português qual
    // conferência falhou; trocá-la por "não foi possível" esconde o motivo de
    // quem pode consertar.
    if (!resposta?.ok) {
      erroAoCriar.value = resposta?.erro
        || `Não consegui criar agora${r.ok ? '' : ` (o banco respondeu ${r.status})`}.`
      return
    }
    nova.parceiro = ''
    await carregar()
  } catch {
    erroAoCriar.value = 'Não consegui falar com o banco agora. Tente de novo em um instante.'
  } finally {
    criando.value = false
  }
}

async function encerrar(sessao, ativa) {
  mexendo.value = sessao.codigo
  erroAoMexer.value = null
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vessel_beauty_session_encerrar`, {
      method: 'POST', headers: cabecalho(),
      body: JSON.stringify({ p_codigo: sessao.codigo, p_ativa: ativa }),
    })
    const resposta = r.ok ? await r.json().catch(() => null) : null
    // ⚠️ SE A GRAVAÇÃO FALHA, O SELO NÃO MUDA. Tela que parece salva e não
    // salvou é o defeito mais caro de perceber (item 9 do padrão).
    if (!resposta?.ok) { erroAoMexer.value = sessao.codigo; return }
    confirmando.value = null
    // ⚠️ `await carregar()` — a memória não é a tela (a explicação de
    // "tem_gente", se estava na tela, também fica desatualizada; some junto).
    delete bloqueioDeApagar[sessao.codigo]
    await carregar()
  } catch {
    erroAoMexer.value = sessao.codigo
  } finally {
    mexendo.value = null
  }
}

// ── editar (inline) ─────────────────────────────────────────────────────────
const editando = ref(null)
const rascunho = reactive({ quando: '', loja: '' })
const salvandoEdicao = ref(null)
const erroDeEditar = ref(null)
const mensagemEditar = ref('')

function abrirEditar(s) {
  editando.value = s.codigo
  erroDeEditar.value = null
  apagando.value = null
  // ⚠️ `s.quando` já chega como "aaaa-mm-dd" (a coluna é `date`) — o mesmo
  // formato que `<input type="date">` espera e que `criar()` já manda direto
  // ao banco, sem passar por `Date`/fuso nenhum. É essa ausência de conversão
  // que evita o gotcha do `p_quando date` (ver comentário da migration
  // `2026-09-19-vessel-beauty-session-mexer.sql`): mandar um instante faria o
  // Postgres gravar o dia do FUSO de quem chamou, não o dia escrito na tela.
  rascunho.quando = String(s.quando || '').slice(0, 10)
  rascunho.loja = s.loja || ''
}

function fecharEditar() {
  editando.value = null
  erroDeEditar.value = null
}

async function salvarEdicao(s) {
  salvandoEdicao.value = s.codigo
  erroDeEditar.value = null
  try {
    const r = await chamar('vessel_beauty_session_editar', {
      p_codigo: s.codigo,
      p_quando: rascunho.quando || null,
      p_loja: rascunho.loja || null,
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

// ── arquivar / desarquivar ───────────────────────────────────────────────────
const arquivando = ref(null)
const erroDeArquivar = ref(null)
const mensagemArquivar = ref('')

async function alternarArquivar(s) {
  arquivando.value = s.codigo
  erroDeArquivar.value = null
  try {
    const r = await chamar('vessel_beauty_session_arquivar',
      { p_codigo: s.codigo, p_arquivada: !s.arquivada })
    if (!r?.ok) {
      erroDeArquivar.value = s.codigo
      mensagemArquivar.value = mensagemDeArquivar(r?.situacao)
      return
    }
    delete bloqueioDeApagar[s.codigo]
    await carregar()
  } catch {
    erroDeArquivar.value = s.codigo
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

async function apagar(s) {
  mexendoApagar.value = s.codigo
  erroDeApagar.value = null
  try {
    const r = await chamar('vessel_beauty_session_apagar', { p_codigo: s.codigo })
    if (r?.ok) {
      apagando.value = null
      await carregar()
      return
    }
    if (r?.situacao === 'tem_gente' || r?.situacao === 'tem_leads') {
      // ⚠️ NÃO é erro vermelho: é a explicação de por que apagar está fora de
      // questão, com as duas saídas de verdade — ver beauty-sessions-regras.js.
      // `tem_leads` (24/09/2026): sem leitura, mas com gente identificada.
      bloqueioDeApagar[s.codigo] = r.situacao === 'tem_gente'
        ? mensagemDeTemGente(conta(s).leituras) : mensagemDeTemLeads()
      apagando.value = null
      return
    }
    erroDeApagar.value = s.codigo
    mensagemApagar.value = mensagemDeApagar(r?.situacao)
  } catch {
    erroDeApagar.value = s.codigo
    mensagemApagar.value = mensagemDeApagar('erro_de_rede')
  } finally {
    mexendoApagar.value = null
  }
}

// ── cadastrar lead (24/09/2026) ─────────────────────────────────────────────
const cadastroAberto = ref(null)
const cadastrando = ref(null)
const formularios = reactive({})
const recadoDoCadastrar = reactive({})

// ⚠️ O FORMULÁRIO NASCE AO ABRIR, não durante o desenho: escrever em estado
// reativo no meio do render faz o Vue redesenhar de novo (a mesma nota da tela
// irmã, Private Edit). Até lá, quem lê recebe o vazio congelado.
function formDe(s) {
  return formularios[s.codigo] || FORMULARIO_VAZIO
}

function alternarCadastro(s) {
  if (cadastroAberto.value === s.codigo) { cadastroAberto.value = null; return }
  if (!formularios[s.codigo]) formularios[s.codigo] = { ...FORMULARIO_VAZIO, tocado: false }
  delete recadoDoCadastrar[s.codigo]
  cadastroAberto.value = s.codigo
}

async function cadastrar(s) {
  // ⚠️ TRAVA CONTRA DUPLO TOQUE: o botão fica travado E a função recusa entrar
  // de novo — o botão travado sozinho não segura dois toques no mesmo quadro.
  if (cadastrando.value) return
  const f = formularios[s.codigo]
  if (!f) return
  f.tocado = true
  delete recadoDoCadastrar[s.codigo]
  if (problemasDaLead(f).length) return
  cadastrando.value = s.codigo
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/vessel_beauty_session_cadastrar_lead`, {
      method: 'POST', headers: cabecalho(), body: JSON.stringify(corpoDoCadastro(s.codigo, f)),
    })
    const resposta = r.ok ? await r.json().catch(() => null) : null
    // ⚠️ O ERRO DO BANCO APARECE, NUNCA CALADO: resposta que não é 200 vira o
    // código do banco na frase (`recadoDoCadastro` mostra a situação crua).
    recadoDoCadastrar[s.codigo] = recadoDoCadastro(resposta || { ok: false, situacao: `o banco respondeu ${r.status}` })
    if (resposta?.ok) {
      // Os campos se esvaziam para a PRÓXIMA; o recado fica, com o nome.
      formularios[s.codigo] = { ...FORMULARIO_VAZIO, tocado: false }
      await carregar({ silencioso: true })
      if (leadsAbertas.value === s.codigo) await buscarLeads(s)
    }
  } catch {
    // ⚠️ Os campos FICAM: fazer a equipe digitar de novo por um erro nosso é
    // perder o contato duas vezes.
    recadoDoCadastrar[s.codigo] = recadoDoCadastro({ ok: false, situacao: 'erro_de_rede' })
  } finally {
    cadastrando.value = null
  }
}

// ── as leads da sessão ──────────────────────────────────────────────────────
const leadsAbertas = ref(null)
const carregandoLeads = ref(null)
const leads = reactive({})
const leadsErro = reactive({})

async function alternarLeads(s) {
  if (leadsAbertas.value === s.codigo) { leadsAbertas.value = null; return }
  leadsAbertas.value = s.codigo
  await buscarLeads(s)
}

async function buscarLeads(s) {
  carregandoLeads.value = s.codigo
  delete leadsErro[s.codigo]
  try {
    // ⚠️ MESMA JANELA (P_DIAS) da conta do cartão: "comprou" na lista e a
    // receita ao lado medem com a mesma régua.
    const lista = await chamar('vessel_leads_da_beauty_session', { p_codigo: s.codigo, p_dias: P_DIAS })
    if (!Array.isArray(lista)) throw new Error('a resposta não é uma lista')
    leads[s.codigo] = lista
  } catch (e) {
    leads[s.codigo] = null
    leadsErro[s.codigo] = e?.message || 'erro desconhecido'
  } finally {
    carregandoLeads.value = null
  }
}

/** dd/mm às hh:mm, no fuso de São Paulo. */
function dataHoraLegivel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit' }).replace(', ', ' às ')
}

onMounted(carregar)
</script>

<style scoped>
@import '../comercial-vessel/estilo-comercial.css';
@import '../../estilos/identidade-da-ferramenta.css';
.bs-body { padding-bottom: var(--sp-6); }

.bs-bloco {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--sp-4);
  margin-top: var(--sp-3);
}

.bs-etiqueta {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  letter-spacing: .08em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 var(--sp-3);
}
.bs-etiqueta-interna { margin-top: var(--sp-4); }

/* ── criar ─────────────────────────────────────────────────────────────── */
.bs-form {
  display: grid;
  grid-template-columns: 1fr;
  gap: var(--sp-3);
}
.bs-campo { display: flex; flex-direction: column; gap: 6px; }
.bs-campo > span {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  color: var(--muted);
}
.bs-campo input, .bs-campo select {
  font-family: var(--fonte-principal);
  font-size: var(--texto-campo);
  color: var(--text);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 10px 12px;
  min-height: 40px;
  width: 100%;
}

.bs-problemas {
  margin: var(--sp-3) 0 0;
  padding-left: 1.1rem;
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
}

.bs-acoes {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--sp-2);
  margin-top: var(--sp-3);
}

/* ── sessão ────────────────────────────────────────────────────────────── */
.bs-cabeca {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--sp-2);
}
.bs-cabeca-texto { min-width: 0; }
.bs-titulo {
  font-family: var(--fonte-principal);
  font-size: var(--texto-titulo);
  color: var(--text);
  margin: 0;
}
.bs-sub {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  margin: 4px 0 0;
  /* texto nunca corta: quebra em vez de sumir */
  overflow-wrap: anywhere;
}
.bs-sem-parceiro { color: var(--red); }

.bs-codigo {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--texto-corpo);
}

.bs-selo {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  letter-spacing: .06em;
  text-transform: uppercase;
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  border: 1px solid var(--border);
  white-space: nowrap;
}
.bs-selo-viva { color: var(--green); border-color: var(--green); }
.bs-selo-fim { color: var(--muted); }

.bs-numeros {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(110px, 1fr));
  gap: var(--sp-3);
  margin-top: var(--sp-4);
}
.bs-numero { display: flex; flex-direction: column; gap: 2px; }
.bs-numero-valor {
  font-family: var(--fonte-principal);
  font-size: var(--texto-numero);
  color: var(--text);
  line-height: 1.1;
}
.bs-numero-rotulo {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  color: var(--muted);
}
/* ⚠️ A BASE FICA COLADA NO NÚMERO, e não numa nota de rodapé: é ela que impede
   a leitura de "50%" como tendência quando são 2 de 4 leituras. */
.bs-numero-base {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  color: var(--muted);
  overflow-wrap: anywhere;
}
.bs-numero-margem {
  font-family: var(--fonte-principal);
  font-size: var(--texto-etiqueta);
  color: var(--orange, var(--red));
  overflow-wrap: anywhere;
}
.bs-numero-destaque .bs-numero-valor { color: var(--accent); }
.bs-numero-vazio {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  /* ocupa a altura do número para a linha não pular */
  min-height: calc(var(--texto-numero) * 1.1);
  display: flex;
  align-items: center;
}

.bs-nota {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  margin: var(--sp-3) 0 0;
  line-height: 1.5;
}
.bs-nota-primeira { margin-top: 0; }
.bs-bloco-leitura { background: var(--bg); }
.bs-nota-atencao { color: var(--red); }
.bs-nota-erro { color: var(--red); }
.bs-nota-aviso { color: var(--orange, var(--red)); }

.bs-qr { margin-top: var(--sp-2); }
/* O atalho para o Material Gráfico: link de verdade (abre noutra aba se a
   pessoa quiser), com 40px de alvo. */
.bs-atalho {
  display: inline-flex;
  align-items: center;
  min-height: 40px;
  margin-top: var(--sp-2);
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--modulo);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.bs-confirma {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  flex: 1 1 14rem;
}

/* ── as ações do cartão (24/09/2026) ─────────────────────────────────────
   As da sessão logo depois dos números; arquivar e apagar no fim, separados
   por um filete e um respiro — são os dois que tiram a sessão de cena. */
.bs-acoes-sessao { margin-top: var(--sp-4); }
.bs-acoes-fim {
  margin-top: var(--sp-5);
  padding-top: var(--sp-3);
  border-top: 1px solid var(--border);
}

/* ── cadastrar lead ────────────────────────────────────────────────────── */
/* O WhatsApp em três pedaços, como na página do QR: +país, DDD e o número. */
.bs-fone { display: flex; align-items: center; gap: var(--sp-2); min-width: 0; }
.bs-fone-mais {
  font-family: var(--fonte-principal);
  font-size: var(--texto-campo);
  color: var(--muted);
}
.bs-campo .bs-fone-pais { flex: 0 0 4.2rem; width: 4.2rem; }
.bs-campo .bs-fone-ddd { flex: 0 0 3.8rem; width: 3.8rem; }
.bs-campo .bs-fone-numero { flex: 1 1 auto; min-width: 0; }
/* ⚠️ o texto do recado é `--text`: a cor é o sinal (a borda e a tinta), o texto
   é para ler — item 2 do padrão. */
.bs-recado {
  color: var(--text);
  border: 1px solid var(--border);
  border-left-width: 4px;
  border-radius: var(--radius-sm);
  padding: var(--sp-2) var(--sp-3);
}
.bs-recado-ok { background: color-mix(in srgb, var(--green) 10%, var(--surface)); border-color: color-mix(in srgb, var(--green) 45%, var(--surface)); }
.bs-recado-aviso { background: color-mix(in srgb, var(--orange) 10%, var(--surface)); border-color: color-mix(in srgb, var(--orange) 45%, var(--surface)); }
.bs-recado-erro { background: color-mix(in srgb, var(--red) 8%, var(--surface)); border-color: color-mix(in srgb, var(--red) 45%, var(--surface)); }

/* ── a lista das leads: cartões, não tabela ────────────────────────────── */
.bs-leads { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--sp-2); }
.bs-lead {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--sp-3);
}
.bs-lead .bs-sub { margin-top: 2px; }
.bs-lead-nome {
  font-family: var(--fonte-principal);
  font-size: var(--texto-campo);
  color: var(--text);
  margin: 0;
  /* nome comprido quebra; nunca corta (item 5 do padrão) */
  overflow-wrap: anywhere;
}
@media (min-width: 64rem) {
  .bs-leads { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

.bs-carregando, .bs-vazio {
  font-family: var(--fonte-principal);
  font-size: var(--texto-corpo);
  color: var(--muted);
  padding: var(--sp-5) 0;
  text-align: center;
}

/* Do celular para cima: os campos ganham colunas quando há espaço. */
@media (min-width: 40rem) {
  .bs-form { grid-template-columns: repeat(3, 1fr); }
  .bs-campo-largo { grid-column: 1 / -1; }
}
</style>
