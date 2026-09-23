<template>
  <div class="tela-sty cv-identidade">
    <barra-de-topo :voltar="ROTULO_DO_PAI[paiDaTela('stylist-circle')]"
                   titulo="Vessel — Stylist Circle"
                   :subtitulo="subtitulo" @voltar="voltar" />

    <div class="cv-largo cv-body">
      <faixa-de-erro :erro="erro" @tentar-de-novo="carregar" />

      <!-- ── A PORTA DO PROGRAMA ────────────────────────────────────────── -->
      <section class="cv-bloco">
        <h2 class="cv-etiqueta"><icone-do-bloco nome="porta" />A porta de entrada</h2>
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

      <!-- ── O PLACAR (T11) ─────────────────────────────────────────────────
           ⚠️ NENHUM NÚMERO DAQUI SE DIGITA: sai das três bases e dos pedidos,
           por `vessel_placar_do_stylist_circle`. E TODA TAXA VEM COM DE
           QUANTOS ELA SAIU — `taxasDoPlacar` (t11-regras.js, testada). -->
      <section v-if="!erro" class="cv-bloco">
        <div class="cv-cabeca">
          <div class="cv-cabeca-texto">
            <h2 class="cv-etiqueta"><icone-do-bloco nome="placar" />O placar do Stylist Circle</h2>
          </div>
          <label class="cv-campo cv-campo-periodo" for="sty-periodo"><span>Período</span>
            <select id="sty-periodo" v-model="periodoDoPlacarEscolhido">
              <option v-for="(rotulo, chave) in PERIODOS_DO_PLACAR" :key="chave" :value="chave">{{ rotulo }}</option>
            </select></label>
        </div>
        <p v-if="erroDoPlacar" class="cv-nota cv-nota-erro">{{ erroDoPlacar }}</p>
        <div v-else-if="carregandoPlacar && !placar" class="cv-carregando">Carregando o placar…</div>
        <template v-else-if="placar">
          <div class="cv-grupo cv-grupo-parceiras">
          <h3 class="cv-etiqueta cv-etiqueta-interna"><icone-do-bloco nome="parceiras" />As parceiras</h3>
          <div class="cv-numeros cv-numeros-placar">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ placar.prospectadas }}</span>
              <span class="cv-numero-rotulo">Prospectadas</span>
              <span class="cv-numero-base">pela data da prospecção</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ placar.ativadas }}</span>
              <span class="cv-numero-rotulo">Ativadas</span>
              <!-- ⚠️ O NÚMERO GRANDE E A TAXA SÃO DE TURMAS DIFERENTES: o número
                   é quem ativou no período (pela data da ativação); a taxa é
                   das prospectadas no período, quantas já ativaram. -->
              <span class="cv-numero-base">{{ legendaDaTaxa('ativacao', taxas.ativacao) }}</span>
              <span v-if="margemEscrita(taxas.ativacao)" class="cv-numero-margem">{{ margemEscrita(taxas.ativacao) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ placar.recorrentes_no_periodo }}</span>
              <span class="cv-numero-rotulo">Ficaram recorrentes</span>
              <span class="cv-numero-base">2º encontro realizado no período</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emPorcento(taxas.repeticao.valor) }}</span>
              <span class="cv-numero-rotulo">Taxa de repetição</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxas.repeticao) }}, desde o início</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ placar.intervalos ? `${formatarDias(placar.intervalo_medio_em_dias)}` : '—' }}</span>
              <span class="cv-numero-rotulo">Intervalo entre encontros</span>
              <span class="cv-numero-base">{{ placar.intervalos ? `média de ${placar.intervalos} intervalo(s)` : 'sem base ainda' }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ placar.contatos_ate_ativar ?? '—' }}</span>
              <span class="cv-numero-rotulo">Contatos até ativar</span>
              <span class="cv-numero-base">{{ placar.stylists_com_contatos_ate_ativar
                ? `média de ${placar.stylists_com_contatos_ate_ativar} stylist(s)` : 'sem base ainda' }}</span>
            </div>
          </div>
          </div>

          <div class="cv-grupo cv-grupo-encontros">
          <h3 class="cv-etiqueta cv-etiqueta-interna"><icone-do-bloco nome="encontros" />Os encontros e as convidadas</h3>
          <div class="cv-numeros cv-numeros-placar">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ placar.encontros_agendados }}</span>
              <span class="cv-numero-rotulo">Encontros agendados</span>
              <span class="cv-numero-base">{{ placar.encontros_cancelados }} cancelado(s) ou não realizado(s)</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ placar.encontros_realizados }}</span>
              <span class="cv-numero-rotulo">Realizados</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxas.realizacao) }} dos agendados</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ placar.convidadas }}</span>
              <span class="cv-numero-rotulo">Convidadas</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ placar.confirmadas }}</span>
              <span class="cv-numero-rotulo">Confirmadas</span>
              <span class="cv-numero-base">inclui quem confirmou e faltou</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ placar.presentes }}</span>
              <span class="cv-numero-rotulo">Presentes</span>
              <span class="cv-numero-base">{{ legendaDaTaxa('showRate', taxas.showRate) }}</span>
              <span v-if="margemEscrita(taxas.showRate)" class="cv-numero-margem">{{ margemEscrita(taxas.showRate) }}</span>
            </div>
          </div>
          </div>

          <div class="cv-grupo cv-grupo-venda">
          <h3 class="cv-etiqueta cv-etiqueta-interna"><icone-do-bloco nome="venda" />A venda ({{ janelaEscrita(placar.janela_de_venda_em_dias) }})</h3>
          <div class="cv-numeros cv-numeros-placar">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ emReais(placar.receita) }}</span>
              <span class="cv-numero-rotulo">Receita atribuída</span>
              <span class="cv-numero-base">{{ placar.vendas }} venda(s) · {{ formatarPecas(placar.pecas) }} peça(s)</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ placar.compradoras }}</span>
              <span class="cv-numero-rotulo">Compradoras</span>
              <span class="cv-numero-base">{{ taxaEscrita(taxas.conversao) }} das presentes</span>
              <span v-if="margemEscrita(taxas.conversao)" class="cv-numero-margem">{{ margemEscrita(taxas.conversao) }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ taxas.ticket.temBase ? emReais(taxas.ticket.valor) : '—' }}</span>
              <span class="cv-numero-rotulo">Ticket médio</span>
              <span class="cv-numero-base">{{ taxas.ticket.temBase ? `sobre ${taxas.ticket.n} venda(s)` : 'sem base ainda' }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ taxas.receitaPorConvidada.temBase ? emReais(taxas.receitaPorConvidada.valor) : '—' }}</span>
              <span class="cv-numero-rotulo">Receita por presente</span>
              <span class="cv-numero-base">{{ taxas.receitaPorConvidada.temBase ? `sobre ${taxas.receitaPorConvidada.n} presente(s)` : 'sem base ainda' }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ taxas.receitaPorEncontro.temBase ? emReais(taxas.receitaPorEncontro.valor) : '—' }}</span>
              <span class="cv-numero-rotulo">Receita por encontro</span>
              <span class="cv-numero-base">{{ taxas.receitaPorEncontro.temBase ? `sobre ${taxas.receitaPorEncontro.n} realizado(s)` : 'sem base ainda' }}</span>
            </div>
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ razaoEscrita(taxas.pecasPorCliente).split(' (')[0] }}</span>
              <span class="cv-numero-rotulo">Peças por compradora</span>
              <span class="cv-numero-base">{{ taxas.pecasPorCliente.temBase ? `${formatarPecas(taxas.pecasPorCliente.x)} peça(s) em ${taxas.pecasPorCliente.n}` : 'sem base ainda' }}</span>
            </div>
          </div>
          </div>

          <template v-if="placar.por_stylist && placar.por_stylist.length">
            <h3 class="cv-etiqueta cv-etiqueta-interna">Receita por stylist</h3>
            <!-- ⚠️ LISTA, NÃO TABELA: medido a 375px, a coluna do nome empurrava
                 as outras três para fora da tela. -->
            <ul class="cv-convidadas">
              <li v-for="p in placar.por_stylist" :key="p.codigo" class="cv-convidada">
                <p class="cv-convidada-nome">{{ p.nome }}</p>
                <p class="cv-sub">
                  <span class="cv-codigo">{{ p.codigo }}</span>
                  · {{ p.encontros_realizados }} realizado(s) · {{ p.vendas }} venda(s) ·
                  <b>{{ emReais(p.receita) }}</b>
                </p>
              </li>
            </ul>
          </template>

          <p class="cv-nota">
            Cada número usa a sua data: <b>prospectadas</b> pela data da
            prospecção, <b>ativadas</b> pelo dia do primeiro encontro agendado, e
            <b>encontros, convidadas e venda</b> pelo dia do encontro.
            A <b>taxa de ativação</b> olha uma turma só: das prospectadas no
            período, quantas já ativaram — por isso ela não bate com a divisão
            dos dois números grandes, e nunca passa de 100%. A taxa de
            <b>presentes</b> conta só as confirmadas de encontros que
            aconteceram: quem confirmou para um encontro cancelado nunca pôde
            ir.
            <b>Agendados</b> inclui os que depois caíram — eles chegaram a ter
            data, e tirá-los faria a taxa de realização subir justamente quando
            a operação cancela.
          </p>
          <p class="cv-nota">
            <b>A venda</b> é o pedido atendido no Bling de uma convidada que
            <b>esteve presente</b>, até 14 dias depois do encontro. Quem foi a
            dois encontros tem a compra contada no <b>primeiro</b>, uma vez só.
            A cliente é reconhecida pelo WhatsApp do convite, na conferência de
            pedidos de toda madrugada.
          </p>
        </template>
      </section>

      <!-- ── CADASTRAR ──────────────────────────────────────────────────── -->
      <section v-if="podeExecutarAcao('criar', podeEditar)" class="cv-bloco cv-bloco-form">
        <h2 class="cv-etiqueta"><icone-do-bloco nome="novo" />Cadastrar parceira</h2>
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
              <option v-for="(nome, sigla) in PRACAS" :key="sigla" :value="sigla">{{ nome }}</option>
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
          <label class="cv-campo" for="sty-prospectado"><span>Data da prospecção</span>
            <input id="sty-prospectado" type="date" :max="hojeLocal" v-model="novo.prospectadoEm"></label>
          <label class="cv-campo cv-campo-largo" for="sty-proxima"><span>Próxima ação</span>
            <input id="sty-proxima" type="text" maxlength="120" v-model="novo.proximaAcao"
                   placeholder="Ex.: ligar para apresentar o Circle"></label>
          <label class="cv-campo" for="sty-proxima-em"><span>Até quando</span>
            <input id="sty-proxima-em" type="date" v-model="novo.proximaAcaoEm"></label>
        </div>

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
      <barra-de-lista v-model="filtro" :estagios="ESTAGIOS"
                      :mostrar="['busca', 'situacao', 'estagio', 'ordem']"
                      placeholder-busca="nome, cidade ou código"
                      :situacoes="[
                        { valor: 'abertas', rotulo: 'Só ativas' },
                        { valor: 'encerradas', rotulo: 'Só desativadas' },
                        { valor: 'todas', rotulo: 'Todas' },
                      ]"
                      :ordens="[
                        { valor: 'nome', rotulo: 'Nome' },
                        { valor: 'aberturas', rotulo: 'Quem traz mais tráfego' },
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
      <quadro-do-stylist-circle v-if="vista === 'quadro' && !carregando && !erro" :stylists="stylistsNaTela"
                                :pode-editar="podeExecutarAcao('editar', podeEditar)" :hoje="hojeLocal"
                                :movendo-codigo="movendoCodigo"
                                @abrir="fichaAberta = $event" @mover="mover" />

      <div v-if="carregando" class="cv-carregando">Carregando…</div>

      <!-- ⚠️ O QUE VEM AQUI SÓ APARECE NA VISTA "LISTA" — o carregando de cima
           sobe para fora, porque ele vale para as duas vistas. -->
      <template v-if="vista === 'lista'">
        <!-- ── COMO LER ─────────────────────────────────────────────────── -->
        <section v-if="!carregando && !erro && stylists.length" class="cv-bloco cv-bloco-leitura">
          <h2 class="cv-etiqueta"><icone-do-bloco nome="leitura" />Como ler os números</h2>
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
          <h2 class="cv-etiqueta"><icone-do-bloco nome="conjunto" />Todas as stylists juntas</h2>
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
        <section v-for="s in stylistsNaTela" :key="s.codigo" class="cv-bloco cv-cartao" :class="`cv-tom-${tomDaStylist(s)}`">
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
            </div>
            <!-- ⚠️ ESTÁGIO E SITUAÇÃO SÃO DUAS COISAS. Desde a T11 o `estagio`
                 é uma lista fechada do banco (os onze do funil, CHECK na
                 migration), e "Evento agendado e ativado" (onde ela está na
                 jornada) não tem nada a ver com "ativa" como SITUAÇÃO da
                 parceria (ela continua com a gente). Quando as duas
                 coincidiam, as regras antigas imprimiam "Ativa" duas vezes
                 empilhado — lido na tela, parece bug de renderização
                 duplicada, não duas informações. A situação só é digna de um
                 selo à parte quando é a exceção: "Desativada". Continuar
                 ativa é o normal, não precisa de selo — só o estágio aparece
                 sozinho nesse caso, sem duplicar a palavra. -->
            <div class="cv-selos">
              <span v-if="s.ativa === false" class="cv-selo cv-selo-fim cv-tom-parada">Desativada</span>
              <span class="cv-selo" :class="[seloDoEstagio(s.estagio).classe, `cv-tom-${seloDoEstagio(s.estagio).tom}`]">
                {{ seloDoEstagio(s.estagio).texto }}</span>
            </div>
          </div>

          <p v-if="s.proxima_acao" class="cv-nota cv-nota-aviso cv-nota-primeira">
            <b>Próxima ação:</b> {{ s.proxima_acao }}<span v-if="s.proxima_acao_em">
              — até {{ dataLegivel(s.proxima_acao_em) }}</span>
          </p>

          <h3 class="cv-etiqueta cv-etiqueta-interna">Os encontros dela</h3>
          <div class="cv-numeros">
            <div class="cv-numero">
              <span class="cv-numero-valor">{{ s.encontros_realizados || 0 }}</span>
              <span class="cv-numero-rotulo">Realizados</span>
              <span class="cv-numero-base">{{ s.ativada_em ? `ativada em ${dataLegivel(dataDoInstante(s.ativada_em))}` : 'ainda não ativada' }}</span>
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

          <h3 class="cv-etiqueta cv-etiqueta-interna">O link dela, em números</h3>
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

          <h3 class="cv-etiqueta cv-etiqueta-interna">O link dela</h3>
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
          <div v-if="podeExecutarAcao('editar', podeEditar) && editando === s.codigo" class="cv-caixa-form">
            <h3 class="cv-etiqueta cv-etiqueta-interna"><icone-do-bloco nome="editar" />Corrigir</h3>
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
              <!-- ⚠️ LISTA, NÃO TEXTO LIVRE (T11). Os três degraus que saem dos
                   encontros não aparecem: "Manter" é o jeito de não mexer. -->
              <label class="cv-campo" :for="`ed-estagio-${s.codigo}`"><span>Estágio</span>
                <select :id="`ed-estagio-${s.codigo}`" v-model="rascunho.estagio">
                  <option value="">Manter: {{ seloDoEstagio(s.estagio).texto }}</option>
                  <option v-for="k in estagiosDeEscolher(s.ativada_em)" :key="k" :value="k"
                          :disabled="k === s.estagio">{{ ESTAGIOS_DA_STYLIST[k] }}</option>
                </select></label>
              <label class="cv-campo" :for="`ed-praca-${s.codigo}`"><span>Praça</span>
                <select :id="`ed-praca-${s.codigo}`" v-model="rascunho.praca">
                  <option value="">Escolha…</option>
                  <option v-for="(nome, sigla) in PRACAS" :key="sigla" :value="sigla">{{ nome }}</option>
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
              <label class="cv-campo" :for="`ed-prospectado-${s.codigo}`"><span>Data da prospecção</span>
                <input :id="`ed-prospectado-${s.codigo}`" type="date" :max="hojeLocal" v-model="rascunho.prospectadoEm"></label>
              <label class="cv-campo cv-campo-largo" :for="`ed-proxima-${s.codigo}`"><span>Próxima ação</span>
                <input :id="`ed-proxima-${s.codigo}`" type="text" maxlength="120" v-model="rascunho.proximaAcao"
                       :disabled="rascunho.acaoFeita"></label>
              <label class="cv-campo" :for="`ed-proxima-em-${s.codigo}`"><span>Até quando</span>
                <input :id="`ed-proxima-em-${s.codigo}`" type="date" v-model="rascunho.proximaAcaoEm"
                       :disabled="rascunho.acaoFeita"></label>
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

    <ficha-da-stylist v-if="fichaAberta && stylistDaFicha" :stylist="stylistDaFicha"
                      :pode-editar="podeExecutarAcao('editar', podeEditar)" :chamar="chamar"
                      @fechar="fichaAberta = null" @mudou="carregar({ silencioso: true })"
                      @corrigir="corrigirDaFicha" />
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
import IconeDoBloco from './icone-do-bloco.vue'
import { estado, hasPermission } from '../../compartilhado/controle-de-login-e-usuario.js'
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { classificarErro } from '../../compartilhado/classificar-erro.js'
import { enderecoDaStylist, ENDERECO_DO_CIRCLE, ESTAGIOS, dataLegivel } from './enderecos-publicos.js'
import {
  proporcao, razao, razaoEscrita, taxaEscrita, margemEscrita,
  emPorcento, emReais, janelaEscrita,
} from './estatistica.js'
import { filtrar, FILTRO_VAZIO } from './filtros.js'
import {
  podeExecutarAcao, calcularConjunto, precisaDasDesativadas, problemasDaParceira,
  mensagemDeCriar, mensagemDeEditar, mensagemDeDesativar,
} from './stylist-circle-regras.js'
import { paiDaTela, ROTULO_DO_PAI } from './navegacao.js'
import {
  ESTAGIOS_DA_STYLIST, estagiosDeEscolher, seloDoEstagio, tomDaStylist, ORIGENS_DE_CONTATO, LOJAS,
  PERIODOS_DO_PLACAR, periodoDoPlacar, taxasDoPlacar, legendaDaTaxa,
} from './t11-regras.js'

const router = useRouter()
function voltar() { router.push({ name: paiDaTela('stylist-circle') }) }

const PRACAS = { CPS: 'Campinas', SAO: 'São Paulo', SBO: 'Santa Bárbara', BSB: 'Brasília' }

// ⚠️ A JANELA DE ATRIBUIÇÃO DE VENDA — não é o período da barra (que nem
// existe nesta tela). T11: D0 a D+14, a MESMA do Private Edit e do placar.
// Antes era 7 aqui e 14 lá, e a mesma stylist tinha duas receitas.
const P_DIAS = 14

const podeEditar = computed(() => hasPermission('atendimentos', 'editar'))

const stylists = ref([])
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
const stylistsNaTela = computed(() =>
  filtrar(stylists.value, filtro.value, { busca: ['nome', 'cidade', 'codigo'], estagio: 'estagio' }))

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
    const r = await chamar('vessel_rastreio_dos_stylists',
      { p_dias: P_DIAS, p_incluir_desativadas: incluirDesativadas })
    stylists.value = r || []
    carregarPlacar()
  } catch (e) {
    erro.value = classificarErro(e)
  } finally {
    if (!silencioso) carregando.value = false
  }
}

// ⚠️ O ÚNICO GATILHO DE VOLTAR AO BANCO É A SITUAÇÃO PEDIR DESATIVADA — nunca
// busca, estágio ou ordem: esses três filtram o que já está em memória.
watch(() => precisaDasDesativadas(filtro.value.situacao), (precisaAgora, precisavaAntes) => {
  if (precisaAgora !== precisavaAntes) carregar()
})

// ── o placar (T11) ───────────────────────────────────────────────────────────
// ⚠️ ERRO DO PLACAR NÃO DERRUBA A LISTA, e a lista não derruba o placar: são
// duas leituras, e cada uma mostra o próprio erro no próprio bloco.
const periodoDoPlacarEscolhido = ref('mes')
const placar = ref(null)
const carregandoPlacar = ref(false)
const erroDoPlacar = ref('')
const taxas = computed(() => taxasDoPlacar(placar.value))

async function carregarPlacar() {
  carregandoPlacar.value = true
  erroDoPlacar.value = ''
  try {
    const { p_de, p_ate } = periodoDoPlacar(periodoDoPlacarEscolhido.value)
    placar.value = await chamar('vessel_placar_do_stylist_circle', { p_de, p_ate, p_dias: P_DIAS })
  } catch {
    // ⚠️ Nunca zeros no lugar do erro: um placar zerado é uma afirmação.
    placar.value = null
    erroDoPlacar.value = 'Não consegui ler o placar agora. Recarregue a página em um instante.'
  } finally {
    carregandoPlacar.value = false
  }
}
watch(periodoDoPlacarEscolhido, carregarPlacar)

// ── as duas vistas (T11) — Quadro e Lista ─────────────────────────────────────
// A vista escolhida fica no aparelho (conveniência, não dado).
const lerVista = () => { try { return localStorage.getItem('sty-vista') || 'quadro' } catch { return 'quadro' } }
const vista = ref(lerVista())
function trocarVista(v) { vista.value = v; try { localStorage.setItem('sty-vista', v) } catch { /* modo privado */ } }

const fichaAberta = ref(null)
const stylistDaFicha = computed(() => stylists.value.find((s) => s.codigo === fichaAberta.value) || null)

// ⚠️ RODADA 1 DE REVISÃO (T11): a recusa de mover NÃO usa `erro` — `erro` é a
// faixa que apaga o placar, o quadro e a lista inteiros, e uma recusa (ex.:
// "ela já tem encontro marcado") não é motivo para sumir com a tela toda, e
// `erro` nem tem retentativa (`acao: null`). A recusa mora perto do quadro,
// em `erroDoQuadro`, com a frase de `mensagemDeEditar` — nunca "tente de novo"
// para `estagio_contradiz_encontro`. `erro` continua só para falha de LEITURA.
const erroDoQuadro = ref('')
// ⚠️ GUARDA DE TOQUE DUPLO: sem isto, dois toques rápidos no mesmo botão
// disparam duas gravações — a segunda pode chegar com o estágio já mudado
// pela primeira e voltar com `estagio_contradiz_encontro`, confundindo quem
// só queria mover uma vez. Também dá o aviso "Movendo…" no botão certo.
const movendoCodigo = ref(null)
async function mover({ codigo, estagio }) {
  if (movendoCodigo.value) return
  movendoCodigo.value = codigo
  try {
    const r = await chamar('vessel_stylist_editar', { p_codigo: codigo, p_estagio: estagio }).catch(() => null)
    if (!r?.ok) { erroDoQuadro.value = mensagemDeEditar(r?.situacao || 'erro_de_rede'); return }
    erroDoQuadro.value = ''
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
const formatarDias = (n) => `${Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} dias`
const formatarPecas = (n) => Number(n || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })

// ── cadastrar ────────────────────────────────────────────────────────────────
const nomeDeQuemUsa = () => estado.user?.user_metadata?.name || estado.user?.email || ''
const NOVA_VAZIA = () => ({
  nome: '', whatsapp: '', cidade: '', instagram: '', atuacao: '', praca: '',
  loja: '', comoChegou: '', responsavel: nomeDeQuemUsa(), prospectadoEm: hojeLocal,
  proximaAcao: '', proximaAcaoEm: '',
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
      p_prospectado_em: novo.prospectadoEm || null,
      p_proxima_acao: novo.proximaAcao || null,
      p_proxima_acao_em: novo.proximaAcaoEm || null,
    })
    if (!r?.ok) {
      erroAoCriar.value = mensagemDeCriar(r?.situacao)
        + (r?.situacao === 'whatsapp_repetido' && r?.codigo ? ` (${r.codigo})` : '')
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
  nome: '', whatsapp: '', cidade: '', instagram: '', atuacao: '', estagio: '', praca: '',
  loja: '', comoChegou: '', responsavel: '', prospectadoEm: '', proximaAcao: '', proximaAcaoEm: '',
  acaoFeita: false,
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
    // ⚠️ VAZIO = "MANTER". O estágio atual pode ser um dos três automáticos,
    // que não estão na lista — pré-selecioná-lo deixaria o campo em branco e
    // pareceria que ela não tem estágio.
    estagio: '',
    praca: s.praca_preview || '',
    loja: s.loja || '',
    comoChegou: s.origem_contato || 'inbound',
    responsavel: s.responsavel || '',
    prospectadoEm: s.prospectado_em || '',
    proximaAcao: s.proxima_acao || '',
    proximaAcaoEm: s.proxima_acao_em || '',
    acaoFeita: false,
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
      p_estagio: rascunho.estagio || null,
      p_praca: rascunho.praca || null,
      p_loja: rascunho.loja || null,
      p_origem_contato: rascunho.comoChegou || null,
      p_responsavel: rascunho.responsavel || null,
      p_prospectado_em: rascunho.prospectadoEm || null,
      p_proxima_acao: rascunho.acaoFeita ? null : (rascunho.proximaAcao || null),
      p_proxima_acao_em: rascunho.acaoFeita ? null : (rascunho.proximaAcaoEm || null),
      p_sem_proxima_acao: rascunho.acaoFeita,
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

onMounted(carregar)
</script>

<style scoped>
@import './estilo-comercial.css';

/* A COR DA FERRAMENTA NA BARRA DE TOPO (pedido do dono, 23/09/2026). A barra
   é compartilhada por toda a Central e NÃO muda para as outras telas: o
   filete e a tinta vivem aqui, presos a `.tela-sty`. O título continua `--text`. */
.tela-sty :deep(.bt-barra) {
  border-bottom: 3px solid var(--modulo);
  background: color-mix(in srgb, var(--modulo) 8%, var(--surface));
}

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
