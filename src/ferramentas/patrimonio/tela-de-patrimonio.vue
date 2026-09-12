<template>
  <div class="tela-patrimonio" :class="{ 'com-barra': modoSelecao && selecionados.size }">
    <!-- O "voltar" sobe UM nível da árvore; só na raiz é que ele sai do módulo.
         Assim o mesmo botão serve pra subir e pra sair, sem decorar dois.

         O TÍTULO AQUI É O CAMINHO onde a pessoa está. Foi cortá-lo com
         reticências que fez a primeira versão desta barra ser revertida — ele
         quebra em linhas agora, e nunca some. -->
    <barra-de-topo :voltar="rotuloDoVoltar" :titulo="rotuloDoCaminho(caminho, listas)" @voltar="voltar">
      <template #acoes>
        <button class="bt-acao" v-if="visao === 'planilha'" @click="exportarPlanilha">Exportar Excel</button>
        <button class="pat-btn-ajuda" @click="abrirPasseio" title="Como usar esta tela">?</button>
      </template>
    </barra-de-topo>

    <!-- Contagem e ações na MESMA linha: contagem à esquerda, botões à direita.
         Estavam em faixas separadas e comiam duas alturas do celular à toa. -->
    <div class="pat-linha-topo">
      <div class="pat-resumo">
        <span class="pat-resumo-qtd">{{ resumo.quantidade }}</span>
        <span class="pat-resumo-lab">{{ resumo.quantidade === 1 ? 'item' : 'itens' }}</span>
        <span class="pat-resumo-sep">·</span>
        <span class="pat-resumo-total">{{ formatarValor(resumo.totalCentavos) }}</span>
        <span class="pat-resumo-onde">{{ ondeEstouContando }}</span>
      </div>
      <div class="pat-acoes">
        <button class="pat-btn-sel" :class="{ ativo: modoSelecao }" @click="alternarModoSelecao" v-if="podeEditar"
              :title="modoSelecao ? 'Sair da seleção' : 'Selecionar vários'">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      </button>
        <button class="pat-btn-listas" @click="listasAbertas = true" v-if="podeEditar" title="Listas">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      </button>
        <button class="pat-btn-novo" @click="abrirNovo" v-if="podeCriar" title="Cadastrar bem">+</button>
      </div>
    </div>

    <!-- As três visões do mesmo dado: navegar por lugar, ver tudo detalhado
         como a planilha, ou ver onde está o dinheiro. -->
    <!-- O mesmo menu de abas da Frota (classe compartilhada `.abas`), a pedido
         do dono. Antes eram "chips" numa faixa que rolava — e "Exportar Excel"
         estava misturado com elas, parecendo mais uma visão quando é uma AÇÃO.
         Ele subiu pra barra de topo, que é o lugar das ações. -->
    <div class="abas" role="tablist">
      <button role="tab" :class="{ on: visao === 'arvore' }" @click="visao = 'arvore'">Navegar</button>
      <button role="tab" :class="{ on: visao === 'planilha' }" @click="visao = 'planilha'">Planilha</button>
      <button role="tab" :class="{ on: visao === 'resumo' }" @click="visao = 'resumo'">Resumo</button>
      <button role="tab" :class="{ on: visao === 'etiquetas' }" @click="visao = 'etiquetas'">Etiquetas</button>
      <button role="tab" v-if="podeRelatorios" :class="{ on: visao === 'relatorios' }"
              @click="visao = 'relatorios'">Relatórios</button>
    </div>

    <div class="pat-busca-wrap" v-if="visao !== 'resumo' && visao !== 'etiquetas' && visao !== 'relatorios'">
      <input
        class="pat-busca"
        v-model="filtro.busca"
        type="search"
        inputmode="search"
        placeholder="Buscar por item, etiqueta, pessoa, local…"
        aria-label="Buscar bem">
      <!-- O botao aparece SEMPRE. Antes ele sumia quando o navegador nao expunha
           a camera — e isso acontece justamente onde algo esta errado (pagina
           fora de endereco seguro, navegador sem o recurso). O dono relatou
           "nao funciona no Android"; parte era isso: nao era nao funcionar, era
           nao aparecer, sem nada explicando. Agora quem explica e a janela. -->
      <button class="pat-btn-camera" type="button" @click="lendoEtiqueta = true"
              title="Ler a etiqueta com a camera" aria-label="Ler a etiqueta com a camera">
        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><line x1="7" y1="12" x2="7" y2="12"/><line x1="7" y1="8" x2="7" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="13" y1="8" x2="13" y2="16"/><line x1="17" y1="8" x2="17" y2="16"/></svg>
      </button>
    </div>
    <p class="pat-aviso-leitura" v-if="avisoDaLeitura">{{ avisoDaLeitura }}</p>

    <leitor-de-etiqueta v-model="lendoEtiqueta" @leu="aoLerEtiqueta" />

    <!-- Trilha do caminho: mostra a descida inteira e permite pular de volta pra
         qualquer nível com um toque, sem subir de um em um. -->
    <div class="pat-trilha rolagem-x" v-if="temCaminho && visao === 'arvore'">
      <button class="pat-trilha-item" @click="irParaNivel(0)">Tudo</button>
      <span class="pat-trilha-sep" v-if="caminho.empresaId">›</span>
      <button class="pat-trilha-item" v-if="caminho.empresaId" @click="irParaNivel(1)">{{ nomeDoNivel('empresaId') }}</button>
      <span class="pat-trilha-sep" v-if="caminho.localId">›</span>
      <button class="pat-trilha-item" v-if="caminho.localId" @click="irParaNivel(2)">{{ nomeDoNivel('localId') }}</button>
      <span class="pat-trilha-sep" v-if="caminho.comodoId">›</span>
      <button class="pat-trilha-item atual" v-if="caminho.comodoId">{{ nomeDoNivel('comodoId') }}</button>
    </div>

    <!-- Filtros. Empresa e Local saíram daqui: agora eles SÃO a navegação, e
         repetir o mesmo recorte em dois lugares faria os dois brigarem entre si.
         Sobraram dois, então no celular eles OCUPAM a largura toda, lado a lado,
         em vez de ficarem estreitos numa faixa que rola. No desktop, onde há
         espaço de sobra, seguem em linha. -->
    <div class="pat-filtros rolagem-x" v-if="visao !== 'resumo' && visao !== 'etiquetas' && visao !== 'relatorios'">
      <select class="pat-select" v-model="filtro.categoriaId" aria-label="Categoria">
        <option value="">Todas as categorias</option>
        <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nome }}</option>
      </select>
      <select class="pat-select" v-model="filtro.situacao" aria-label="Situação">
        <option value="">Todas as situações</option>
        <option v-for="s in SITUACOES" :key="s.valor" :value="s.valor">{{ s.rotulo }}</option>
      </select>
      <button class="pat-chip" v-if="temFiltro" @click="limparFiltros">Limpar</button>
    </div>

    <div class="pat-body">
      <!-- Barra do modo de seleção: marcar/desmarcar tudo que está na tela AGORA
           (respeitando busca, filtros e o nível da árvore em que a pessoa está).
           Fica ANTES da cadeia v-if/v-else-if/v-else abaixo, de propósito: um
           v-if solto no meio da cadeia a parte em duas, e a lista de itens some
           justamente quando o modo de seleção está ligado. Já aconteceu. -->
      <div class="pat-selbar" v-if="modoSelecao && !carregando && !erro && bensFiltrados.length">
        <button class="pat-chip" :class="{ ativo: estadoVisivel === 'cheio' }" @click="alternarVisiveis">
          {{ estadoVisivel === 'cheio' ? 'Desmarcar' : 'Marcar' }} os {{ bensFiltrados.length }} daqui
        </button>
        <span class="pat-selbar-info" v-if="estadoVisivel === 'parcial'">alguns marcados</span>
        <button class="pat-chip" v-if="selecionados.size" @click="selecionados = new Set()">Limpar seleção</button>
      </div>

      <div class="pat-aviso" v-if="carregando">Carregando os bens…</div>

      <div class="pat-aviso pat-aviso-erro" v-else-if="erro">
        Não consegui carregar o patrimônio: {{ erro }}
      </div>

      <!-- Tela vazia que ENSINA: diz o que fazer e por quê, não só "vazio". -->
      <div class="pat-vazio" v-else-if="!bens.length">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        <h3>Nenhum bem cadastrado ainda</h3>
        <p>
          Aqui fica tudo que a empresa tem: computador, celular, mesa, máquina, carro.
          Cada bem guarda onde está, quanto custou e com quem está — e quando alguém
          é desligado, você sabe na hora o que precisa voltar.
        </p>
        <button class="pat-btn primario" @click="abrirNovo" v-if="podeCriar">Cadastrar o primeiro bem</button>
      </div>

      <!-- O Resumo olha o patrimônio inteiro, então não pode cair no vazio de
           filtro: com uma busca sem resultado ele ainda tem o que mostrar. -->
      <div class="pat-vazio" v-else-if="!bensFiltrados.length && visao !== 'resumo' && visao !== 'etiquetas' && visao !== 'relatorios'">
        <h3>Nenhum bem para esses filtros</h3>
        <p>Tente limpar a busca ou escolher outra empresa, local ou situação.</p>
        <button class="pat-btn" @click="limparFiltros">Limpar filtros</button>
      </div>

      <template v-else-if="visao === 'arvore'">
        <!-- Os grupos do nível atual (empresas, depois locais, depois cômodos).
             Só aparecem quando NÃO há busca em texto: buscar é um pedido de
             "ache em tudo", e nesse momento a árvore só atrapalharia. -->
        <div class="pat-grupos" v-if="mostrarGrupos">
          <button class="pat-grupo" v-for="g in grupos" :key="g.id" @click="entrarNoGrupo(g)">
            <span class="pat-grupo-ico" :class="{ orfao: g.id === SEM_VALOR }">
              <svg v-if="g.id !== SEM_VALOR" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
              <svg v-else width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            </span>
            <span class="pat-grupo-nome">{{ g.nome }}</span>
            <span class="pat-grupo-num">
              {{ g.quantidade }} {{ g.quantidade === 1 ? 'item' : 'itens' }}
              <em v-if="g.totalCentavos">· {{ formatarValor(g.totalCentavos) }}</em>
            </span>
            <span class="pat-grupo-seta">›</span>
          </button>
        </div>

        <!-- Escape em qualquer nível: ver os bens de tudo que está aqui embaixo,
             sem ter que descer até o último cômodo um por um. -->
        <button class="pat-ver-todos" v-if="mostrarGrupos && bensFiltrados.length" @click="verTudoAqui = true">
          Ver os {{ bensFiltrados.length }} itens daqui, sem separar
        </button>

        <!-- CELULAR e TABLET: cartões. É a única forma que funciona com uma mão. -->
        <div class="pat-cards" v-if="mostrarBens">
          <button class="pat-card" :class="{ marcado: selecionados.has(bem.id) }"
                  v-for="bem in bensNaTela" :key="bem.id" @click="tocarNoBem(bem)">
            <div class="pat-card-topo">
              <span class="pat-check-caixa" v-if="modoSelecao">{{ selecionados.has(bem.id) ? '✓' : '' }}</span>
              <span class="pat-card-nome">{{ bem.nome }}</span>
              <span class="pat-selo-novo" v-if="ehNovo(bem)">novo</span>
              <span class="pat-pill" :class="classeDaSituacao(bem.situacao)">{{ rotuloDaSituacao(bem.situacao) }}</span>
            </div>
            <div class="pat-card-meta">
              <span v-if="bem.numero">Nº {{ bem.numero }}</span>
              <span v-if="bem.numero" class="pat-card-sep">·</span>
              <span>{{ formatarValor(bem.valor_centavos) }}</span>
            </div>
            <div class="pat-card-linha">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              {{ nomeDoLocal(bem) }}
            </div>
            <div class="pat-card-linha">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              {{ textoDoDono(bem, pessoasById, pessoasErro) }}
            </div>
          </button>
        </div>

        <!-- DESKTOP (≥1025px): a tabela larga, que só faz sentido com mouse e tela grande. -->
        <div class="pat-tabela-wrap rolagem-x" v-if="mostrarBens">
          <table class="pat-tabela">
            <thead>
              <tr>
                <th v-if="modoSelecao"></th><th>Nº</th><th>Item</th><th>Categoria</th><th>Empresa</th>
                <th>Local</th><th>Com quem</th><th>Situação</th><th class="pat-dir">Valor</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="bem in bensNaTela" :key="bem.id" :class="{ marcado: selecionados.has(bem.id) }" @click="tocarNoBem(bem)">
                <td v-if="modoSelecao"><span class="pat-check-caixa">{{ selecionados.has(bem.id) ? '✓' : '' }}</span></td>
                <td>{{ bem.numero ?? '—' }}</td>
                <td>{{ bem.nome }}<span class="pat-selo-novo" v-if="ehNovo(bem)">novo</span></td>
                <td>{{ nomeDe(categorias, bem.categoria_id) }}</td>
                <td>{{ nomeDe(empresas, bem.empresa_id) }}</td>
                <td>{{ nomeDoLocal(bem) }}</td>
                <td>{{ textoDoDono(bem, pessoasById, pessoasErro) }}</td>
                <td><span class="pat-pill" :class="classeDaSituacao(bem.situacao)">{{ rotuloDaSituacao(bem.situacao) }}</span></td>
                <td class="pat-dir">{{ formatarValor(bem.valor_centavos) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- PLANILHA: tudo detalhado, com as colunas que a árvore não mostra
           (tipo, marca/modelo, etiquetado, data de compra, observação). Ignora o
           nível da árvore de propósito — é a planilha INTEIRA; busca e filtros
           continuam valendo. Rola de lado, como planilha rola. -->
      <template v-else-if="visao === 'planilha'">
        <div class="pat-plan-topo">
          {{ linhasPlanilha.length }} {{ linhasPlanilha.length === 1 ? 'linha' : 'linhas' }}
          · total {{ formatarValor(totalPlanilha) }}
          <span class="pat-plan-dica">toque no título da coluna para ordenar</span>
        </div>
        <div class="pat-plan-wrap rolagem-x">
          <table class="pat-plan">
            <thead>
              <tr>
                <th v-for="col in COLUNAS_PLANILHA" :key="col.chave"
                    :class="{ num: col.tipo !== 'texto', ativa: ordem.chave === col.chave }"
                    @click="ordenarPor(col.chave)">
                  {{ col.titulo }}<span v-if="ordem.chave === col.chave">{{ ordem.crescente ? ' ▲' : ' ▼' }}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="l in linhasPlanilha" :key="l.id" @click="abrirPelaPlanilha(l.id)">
                <td v-for="col in COLUNAS_PLANILHA" :key="col.chave" :class="{ num: col.tipo !== 'texto' }">
                  {{ col.tipo === 'dinheiro' ? formatarValor(l[col.chave]) : (l[col.chave] || '—') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ETIQUETAS: quais números já estão colados num bem e quais sobraram.
           Existe porque "qual número eu uso agora?" não tinha resposta em lugar
           nenhum — a pessoa teria que varrer 341 linhas procurando buraco. -->
      <template v-else-if="visao === 'etiquetas'">
        <div class="pat-kpis">
          <div class="pat-kpi">
            <span class="pat-kpi-lab">Próximo livre</span>
            <strong class="pat-kpi-val">{{ numeros.proximoLivre ?? '—' }}</strong>
            <span class="pat-kpi-fine">use este no próximo bem</span>
          </div>
          <div class="pat-kpi">
            <span class="pat-kpi-lab">Em uso</span>
            <strong class="pat-kpi-val">{{ numeros.usados }}</strong>
            <span class="pat-kpi-fine">de 1 a {{ numeros.teto }}</span>
          </div>
          <div class="pat-kpi">
            <span class="pat-kpi-lab">Disponíveis</span>
            <strong class="pat-kpi-val">{{ numeros.livres }}</strong>
            <span class="pat-kpi-fine" v-if="numeros.semNumero">{{ numeros.semNumero }} bem(ns) ainda sem etiqueta</span>
            <span class="pat-kpi-fine" v-else>todos os bens têm etiqueta</span>
          </div>
        </div>

        <div class="pat-ajuda-txt">
          A numeração vai de 1 a {{ numeros.teto }}. Quando acabar, o botão abaixo
          libera mais 100 números para você continuar etiquetando.
        </div>

        <div class="pat-secao-num">Disponíveis</div>
        <div class="pat-faixas">
          <span class="pat-faixa livre" v-for="f in numeros.faixasLivres" :key="'l' + f.de">{{ textoDaFaixa(f) }}</span>
          <span class="pat-faixa-vazio" v-if="!numeros.faixasLivres.length">
            Nenhum número livre — amplie a numeração abaixo.
          </span>
        </div>

        <div class="pat-secao-num">Já em uso</div>
        <div class="pat-faixas">
          <span class="pat-faixa usada" v-for="f in numeros.faixasUsadas" :key="'u' + f.de">{{ textoDaFaixa(f) }}</span>
          <span class="pat-faixa-vazio" v-if="!numeros.faixasUsadas.length">Nenhuma etiqueta usada ainda.</span>
        </div>

        <!-- Etiqueta acima do teto existe de verdade e não pode sumir do
             relatório só porque não cabe na régua. -->
        <template v-if="numeros.acimaDoTeto.length">
          <div class="pat-secao-num">Fora da numeração atual</div>
          <div class="pat-faixas">
            <span class="pat-faixa fora" v-for="f in numeros.acimaDoTeto" :key="'f' + f.de">{{ textoDaFaixa(f) }}</span>
          </div>
          <div class="pat-ajuda-txt">
            Estas etiquetas estão coladas em bens, mas passam do limite de
            {{ numeros.teto }}. Amplie a numeração para que entrem na conta.
          </div>
        </template>

        <button class="pat-btn primario pat-btn-ampliar" v-if="podeEditar" :disabled="salvandoTeto"
                @click="ampliarNumeracao">
          {{ salvandoTeto ? 'Ampliando…' : `Liberar mais 100 números (até ${numeros.teto + 100})` }}
        </button>
      </template>

      <!-- RELATÓRIOS: a casca compartilhada com a Frota. Entra como mais um
           v-else-if da cadeia, ANTES do v-else do Resumo — um v-if solto aqui
           partiria a cadeia em duas, e é o defeito que o comentário lá em cima
           registra como já acontecido. -->
      <template v-else-if="visao === 'relatorios'">
        <aba-de-relatorios
          :relatorios="RELATORIOS_DO_PATRIMONIO"
          :contexto="{ sbClient, linhasAchatadas }"
          :empresas="empresas"
          :locais="locais"
          :comodos="comodos"
          nome-do-arquivo="patrimonio"
          :pode-exportar="podeExportarRelatorio" />
      </template>

      <!-- RESUMO: onde está o dinheiro. É a aba Dinâmica da planilha, viva. -->
      <template v-else>
        <div class="pat-kpis">
          <div class="pat-kpi">
            <span class="pat-kpi-lab">Patrimônio total</span>
            <strong class="pat-kpi-val">{{ formatarValor(totais.totalCentavos) }}</strong>
            <span class="pat-kpi-fine">{{ totais.itens }} itens<template v-if="totais.semValor"> · {{ totais.semValor }} sem valor informado</template></span>
          </div>
          <div class="pat-kpi">
            <span class="pat-kpi-lab">Em uso</span>
            <strong class="pat-kpi-val">{{ formatarValor(totais.emUsoCentavos) }}</strong>
            <span class="pat-kpi-fine">{{ totais.emUso }} itens</span>
          </div>
          <div class="pat-kpi">
            <span class="pat-kpi-lab">Em estoque</span>
            <strong class="pat-kpi-val">{{ formatarValor(totais.emEstoqueCentavos) }}</strong>
            <span class="pat-kpi-fine">{{ totais.emEstoque }} itens</span>
          </div>
        </div>

        <div class="pat-eixos rolagem-x">
          <button class="pat-chip" v-for="e in EIXOS" :key="e.chave"
                  :class="{ ativo: eixo === e.chave }" @click="eixo = e.chave">{{ e.titulo }}</button>
        </div>

        <div class="pat-rank">
          <div class="pat-rank-linha" v-for="g in ranking" :key="g.chave">
            <div class="pat-rank-topo">
              <span class="pat-rank-nome">{{ g.chave }}</span>
              <span class="pat-rank-val">{{ formatarValor(g.totalCentavos) }}</span>
            </div>
            <div class="pat-rank-barra"><i :style="{ width: Math.max(g.fatia * 100, 1) + '%' }"></i></div>
            <div class="pat-rank-pe">
              {{ g.quantidade }} {{ g.quantidade === 1 ? 'item' : 'itens' }}
              · {{ (g.fatia * 100).toFixed(1).replace('.', ',') }}% do total
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- Barra do que está marcado. Fica colada embaixo porque é lá que o polegar
         alcança, e some sozinha quando nada está marcado. -->
    <div class="pat-massa-barra" v-if="modoSelecao && selecionados.size">
      <div class="pat-massa-conta">
        <strong>{{ resumoSelecao.quantidade }}</strong>
        {{ resumoSelecao.quantidade === 1 ? 'item' : 'itens' }}
        <em v-if="resumoSelecao.totalCentavos">· {{ formatarValor(resumoSelecao.totalCentavos) }}</em>
      </div>
      <button class="pat-btn primario" @click="abrirEmMassa">Alterar</button>
    </div>

    <!-- Painel de alteração em massa. Todo campo começa VAZIO, e vazio quer
         dizer "não mexe nisso" — é o que impede alterar a situação de 80 itens
         e apagar o dono, o local e a categoria dos 80 sem querer. -->
    <div class="pat-ficha-fundo" v-if="massaAberta" v-trava-rolagem @click.self="massaAberta = false">
      <div class="pat-ficha">
        <div class="pat-ficha-topo">
          <button class="pat-ficha-fechar" @click="massaAberta = false" aria-label="Fechar">✕</button>
          <span class="pat-ficha-titulo" data-tour="massa-titulo">Alterar {{ resumoSelecao.quantidade }} itens</span>
          <button class="pat-btn-ajuda" @click="passeioMassaAberto = true" title="Passeio pelos campos">?</button>
        </div>
        <PasseioGuiado v-model="passeioMassaAberto" :passos="PASSOS_MASSA" />

        <div class="pat-ficha-corpo">
          <p class="pat-tutorial-fixo">{{ TEXTOS.massaAberta }}</p>
          <div class="pat-ajuda-txt">{{ AJUDAS.massa }}</div>

          <label class="pat-campo" data-tour="massa-campo">
            <span>Situação</span>
            <select v-model="massa.situacao">
              <option value="">— não mudar —</option>
              <option v-for="s in SITUACOES" :key="s.valor" :value="s.valor">{{ s.rotulo }}</option>
            </select>
          </label>

          <div class="pat-campo">
            <span class="pat-campo-titulo">Com quem está</span>
            <div class="pat-nota" v-if="pessoasErro">
              Não consegui carregar a lista de colaboradores. O campo pode estar vazio por
              causa disso, e não porque não haja ninguém cadastrado. Recarregue a página; se
              continuar, peça acesso a Colaboradores e Acessos (ou a Patrimônio/Frota) a quem
              administra.
            </div>
            <EscolhaDePessoa
              v-model="massa.pessoaId"
              :pessoas="comSelecionada(pessoasAtivas, pessoas, massa.pessoaId)" :todas="pessoas"
              :marcas="empresas" :setores="setores"
              :pode-criar="podeEditar" :criando="criandoPessoa && campoDeCriacao === 'massa'"
              :recado-de-erro="campoDeCriacao === 'massa' ? erroDePessoa : ''"
              :aviso="campoDeCriacao === 'massa' ? avisoDeCriacao : ''"
              rotulo="Com quem está" texto-vazio="— não mudar —"
              @criar="(p) => criarPessoaRapida(p, 'massa')" @criar-setor="(p) => criarSetorRapido(p, 'massa')"
              @criar-marca="(p) => criarMarcaRapida(p, 'massa')" @abrir="limparAvisoDeCriacao">
              <!-- Vai no slot "antes" porque tirar o dono NÃO é escolher uma
                   pessoa: ela sempre foi o segundo item da lista, e depois dos
                   ~24 nomes ninguém a acha. -->
              <template #antes>
                <option :value="LIMPAR">Tirar o dono (ninguém)</option>
              </template>
            </EscolhaDePessoa>
          </div>

          <label class="pat-campo">
            <span>Categoria</span>
            <select v-model="massa.categoriaId">
              <option value="">— não mudar —</option>
              <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nome }}</option>
            </select>
          </label>

          <div class="pat-campo-par" data-tour="massa-local">
            <label class="pat-campo">
              <span>Marca</span>
              <select v-model="massa.empresaId">
                <option value="">— não mudar —</option>
                <option v-for="e in empresas" :key="e.id" :value="e.id">{{ e.nome }}</option>
              </select>
            </label>
            <label class="pat-campo">
              <span>Local</span>
              <select v-model="massa.localId" :disabled="!massa.empresaId">
                <option value="">{{ massa.empresaId ? '— não mudar —' : 'escolha a marca' }}</option>
                <option v-for="l in locaisDaMassa" :key="l.id" :value="l.id">{{ l.nome }}</option>
              </select>
            </label>
          </div>

          <label class="pat-campo">
            <span>Ambiente</span>
            <select v-model="massa.comodoId" :disabled="!massa.localId">
              <option value="">{{ massa.localId ? '— não mudar —' : 'escolha o local' }}</option>
              <option v-for="k in comodosDaMassa" :key="k.id" :value="k.id">{{ k.nome }}</option>
            </select>
          </label>

          <div class="pat-nota" v-for="(a, i) in avisosDaMassa" :key="i">{{ a }}</div>

          <div class="pat-massa-vazia" v-if="!temAlgoParaMudar(massa)">
            Nada escolhido ainda — nenhum item será alterado.
          </div>
        </div>

        <div class="pat-ficha-pe">
          <button class="pat-btn" @click="massaAberta = false">Cancelar</button>
          <button class="pat-btn perigo" v-if="podeExcluir" @click="apagarEmMassa">
            Apagar os {{ resumoSelecao.quantidade }}
          </button>
          <button class="pat-btn primario" :disabled="!temAlgoParaMudar(massa) || salvandoMassa"
                  @click="salvarEmMassa">
            {{ salvandoMassa ? 'Aplicando…' : 'Aplicar' }}
          </button>
        </div>
      </div>
    </div>

    <!-- O passeio guiado. Abre sozinho na primeira visita e depois só pelo "?".
         O componente é compartilhado — a Frota vai usar o mesmo. -->
    <PasseioGuiado v-model="passeioAberto" :passos="PASSOS" />

    <!-- Confirmação da tela. Fica por cima de tudo (inclusive do painel de
         Listas) porque é ela que segura uma ação destrutiva em cascata. -->
    <div class="pat-confirm-fundo" v-if="confirmacao" v-trava-rolagem>
      <div class="pat-confirm">
        <p>{{ confirmacao.texto }}</p>
        <p class="pat-confirm-pergunta">Quer apagar mesmo assim?</p>
        <div class="pat-confirm-pe">
          <button class="pat-btn" @click="responderConfirmacao(false)">Cancelar</button>
          <button class="pat-btn perigo" @click="responderConfirmacao(true)">Apagar</button>
        </div>
      </div>
    </div>

    <!-- Ficha do bem. É um painel DENTRO do componente (v-if), não um elemento
         anexado em document.body: assim o CSS escopado alcança sempre. -->
    <div class="pat-ficha-fundo" v-if="bemAberto" v-trava-rolagem @click.self="fecharFicha">
      <div class="pat-ficha">
        <div class="pat-ficha-topo">
          <button class="pat-ficha-fechar" @click="fecharFicha" aria-label="Fechar">✕</button>
          <span class="pat-ficha-titulo">{{ bemAberto.novo ? 'Novo bem' : 'Editar bem' }}</span>
          <button class="pat-btn-ajuda" @click="passeioBemAberto = true" title="Passeio pelos campos">?</button>
        </div>
        <PasseioGuiado v-model="passeioBemAberto" :passos="PASSOS_BEM" />

        <div class="pat-ficha-corpo">
          <p class="pat-tutorial-fixo">{{ TEXTOS.bemAberto }}</p>
          <label class="pat-campo">
            <span>Nome do bem</span>
            <input v-model="form.nome" type="text" placeholder="Ex.: Macbook Air M4">
          </label>

          <div class="pat-campo-par">
            <label class="pat-campo" data-tour="bem-numero">
              <span>Nº da etiqueta <button type="button" class="pat-ajuda-q" @click.prevent="alternarAjuda('etiqueta')" title="O que é isso?">?</button></span>
              <input v-model="form.numero" type="text" inputmode="numeric" placeholder="Ex.: 47">
            </label>
            <label class="pat-campo">
              <span>Valor de compra <button type="button" class="pat-ajuda-q" @click.prevent="alternarAjuda('valor')" title="O que é isso?">?</button></span>
              <input v-model="form.valor" type="text" inputmode="decimal" placeholder="R$ 0,00">
            </label>
          </div>
          <div class="pat-ajuda-txt" v-if="ajudaAberta === 'etiqueta' || ajudaAberta === 'valor'">
            {{ AJUDAS[ajudaAberta] }}
          </div>

          <!-- Colado no Nº da etiqueta de propósito (pedido do dono): são os dois
               jeitos de dizer QUAL aparelho é este. A etiqueta é da empresa e pode
               cair; o IMEI é do aparelho e não sai nunca. -->
          <label class="pat-campo">
            <span>IMEI / Nº de série <em>(opcional)</em></span>
            <input v-model="form.numero_serie" type="text" placeholder="Ex.: 356938035643809">
          </label>

          <label class="pat-campo">
            <span>Data da compra <em>(opcional)</em></span>
            <input v-model="form.data_compra" type="date">
          </label>

          <div class="pat-campo-par">
            <label class="pat-campo" data-tour="bem-local">
              <span>Empresa</span>
              <div class="pat-campo-mais">
                <select v-model="form.empresa_id">
                  <option value="">—</option>
                  <option v-for="e in empresas" :key="e.id" :value="e.id">{{ e.nome }}</option>
                </select>
                <button type="button" class="pat-btn-mais" @click="abrirNovaOpcao('empresa')" title="Cadastrar uma empresa nova">+</button>
              </div>
            </label>
            <label class="pat-campo">
              <span>Categoria</span>
              <div class="pat-campo-mais">
                <select v-model="form.categoria_id">
                  <option value="">—</option>
                  <option v-for="c in categorias" :key="c.id" :value="c.id">{{ c.nome }}</option>
                </select>
                <button type="button" class="pat-btn-mais" @click="abrirNovaOpcao('categoria')" title="Cadastrar uma categoria nova">+</button>
              </div>
            </label>
          </div>

          <!-- PLACA (20/08/2026). Só aparece pra Veículos, e é obrigatória: é
               ela que faz o carro nascer na Frota. Sem ela o item fica órfão,
               como o nº 291 "KWID" ficou.

               NÃO é coluna de `patrimonio_bens` — é gravada do outro lado, em
               `frota_veiculos.placa`, por `sincronizar_carro_e_bem`. Num item
               que já tem carro, ela vem preenchida sozinha do carro ligado. -->
          <div class="pat-placa-destaque" v-if="exigePlacaNoBem(form, categoriaVeiculoId)">
            <label class="pat-campo">
              <span>Placa
                <em class="pat-obrigatorio" v-if="bemAberto.novo">obrigatória</em>
              </span>
              <input v-model="form.placa" type="text" placeholder="Ex.: RVU6B06">
            </label>
            <span class="pat-dica">
              Com a placa, este item já aparece na Frota como carro. Se a placa já existir
              lá, eu ligo os dois em vez de criar outro.<template v-if="!bemAberto.novo && !form.placa">
              Sem ela, este item fica registrado aqui mas não vira carro na Frota.</template>
            </span>
          </div>

          <!-- A caixinha do "+" nasce e morre aqui: some ao criar, cancelar, ou
               fechar a ficha (cancelarNovaOpcao), pra nunca ficar aberta numa
               pergunta que já foi respondida. -->
          <div class="pat-nova-opcao" v-if="novaOpcaoAberta === 'empresa' || novaOpcaoAberta === 'categoria'">
            <input v-model="novaOpcaoNome" type="text" autofocus
                   :placeholder="novaOpcaoAberta === 'empresa' ? 'Nome da empresa nova…' : 'Nome da categoria nova…'"
                   @keyup.enter="confirmarNovaOpcao" @keyup.esc="cancelarNovaOpcao">
            <button type="button" class="pat-btn primario" :disabled="salvandoNovaOpcao" @click="confirmarNovaOpcao">
              {{ salvandoNovaOpcao ? 'Criando…' : 'Criar' }}
            </button>
            <button type="button" class="pat-btn" @click="cancelarNovaOpcao">Cancelar</button>
          </div>

          <!-- Local só mostra os da marca escolhida; cômodo só os do local
               escolhido. Sem isso a pessoa conseguiria pôr um bem da Vessel numa
               sala da Moto Easy — e a árvore da tela principal viraria mentira. -->
          <div class="pat-campo-par">
            <label class="pat-campo">
              <span>Local</span>
              <div class="pat-campo-mais">
                <select v-model="form.local_id" :disabled="!form.empresa_id">
                  <option value="">{{ form.empresa_id ? '—' : 'escolha a marca antes' }}</option>
                  <option v-for="l in locaisDoForm" :key="l.id" :value="l.id">{{ l.nome }}</option>
                </select>
                <button type="button" class="pat-btn-mais" :disabled="!form.empresa_id"
                        @click="abrirNovaOpcao('local')" title="Cadastrar um local novo nesta marca">+</button>
              </div>
            </label>
            <label class="pat-campo">
              <span>Ambiente</span>
              <div class="pat-campo-mais">
                <select v-model="form.comodo_id" :disabled="!form.local_id">
                  <option value="">{{ form.local_id ? '—' : 'escolha o local antes' }}</option>
                  <option v-for="c in comodosDoForm" :key="c.id" :value="c.id">{{ c.nome }}</option>
                </select>
                <button type="button" class="pat-btn-mais" :disabled="!form.local_id"
                        @click="abrirNovaOpcao('comodo')" title="Cadastrar um ambiente novo neste local">+</button>
              </div>
            </label>
          </div>

          <div class="pat-nova-opcao" v-if="novaOpcaoAberta === 'local' || novaOpcaoAberta === 'comodo'">
            <input v-model="novaOpcaoNome" type="text" autofocus
                   :placeholder="novaOpcaoAberta === 'local' ? 'Nome do local novo…' : 'Nome do ambiente novo…'"
                   @keyup.enter="confirmarNovaOpcao" @keyup.esc="cancelarNovaOpcao">
            <button type="button" class="pat-btn primario" :disabled="salvandoNovaOpcao" @click="confirmarNovaOpcao">
              {{ salvandoNovaOpcao ? 'Criando…' : 'Criar' }}
            </button>
            <button type="button" class="pat-btn" @click="cancelarNovaOpcao">Cancelar</button>
          </div>

          <div class="pat-nota" v-if="form.empresa_id && !locaisDoForm.length && novaOpcaoAberta !== 'local'">
            Esta marca ainda não tem nenhum local cadastrado. Toque no <strong>+</strong> ao
            lado de Local pra criar um agora, sem sair daqui.
          </div>

          <!-- Classificação de 3 níveis que o dono já usava na planilha:
               Categoria (Computadores) → Tipo (Notebook) → Marca/modelo (Macbook).
               Tipo só lista os da categoria escolhida, mesma regra de local/cômodo. -->
          <div class="pat-campo-par">
            <label class="pat-campo" data-tour="bem-categoria">
              <span>Tipo</span>
              <div class="pat-campo-mais">
                <select v-model="form.tipo_id" :disabled="!form.categoria_id">
                  <option value="">{{ form.categoria_id ? '—' : 'escolha a categoria antes' }}</option>
                  <option v-for="t in tiposDoForm" :key="t.id" :value="t.id">{{ t.nome }}</option>
                </select>
                <button type="button" class="pat-btn-mais" :disabled="!form.categoria_id"
                        @click="abrirNovaOpcao('tipo')" title="Cadastrar um tipo novo nesta categoria">+</button>
              </div>
            </label>
            <label class="pat-campo">
              <span>Marca / modelo</span>
              <input v-model="form.marca" type="text" placeholder="Ex.: Macbook">
            </label>
          </div>

          <div class="pat-nova-opcao" v-if="novaOpcaoAberta === 'tipo'">
            <input v-model="novaOpcaoNome" type="text" autofocus placeholder="Nome do tipo novo…"
                   @keyup.enter="confirmarNovaOpcao" @keyup.esc="cancelarNovaOpcao">
            <button type="button" class="pat-btn primario" :disabled="salvandoNovaOpcao" @click="confirmarNovaOpcao">
              {{ salvandoNovaOpcao ? 'Criando…' : 'Criar' }}
            </button>
            <button type="button" class="pat-btn" @click="cancelarNovaOpcao">Cancelar</button>
          </div>

          <label class="pat-campo" data-tour="bem-situacao">
            <span>Situação <button type="button" class="pat-ajuda-q" @click.prevent="alternarAjuda('situacao')" title="O que é isso?">?</button></span>
            <select v-model="form.situacao">
              <option v-for="s in SITUACOES" :key="s.valor" :value="s.valor">{{ s.rotulo }}</option>
            </select>
          </label>
          <div class="pat-ajuda-txt" v-if="ajudaAberta === 'situacao'">{{ AJUDAS.situacao }}</div>

          <div class="pat-campo" data-tour="bem-responsavel">
            <span class="pat-campo-titulo">Com quem está <em>(opcional)</em> <button type="button" class="pat-ajuda-q" @click.prevent="alternarAjuda('dono')" title="O que é isso?">?</button></span>
            <div class="pat-nota" v-if="pessoasErro">
              Não consegui carregar a lista de colaboradores. O campo pode estar vazio por
              causa disso, e não porque não haja ninguém cadastrado. Recarregue a página; se
              continuar, peça acesso a Colaboradores e Acessos (ou a Patrimônio/Frota) a quem
              administra.
            </div>
            <EscolhaDePessoa
              v-model="form.pessoa_id"
              :pessoas="comSelecionada(pessoasAtivas, pessoas, form.pessoa_id)" :todas="pessoas"
              :marcas="empresas" :setores="setores"
              :pode-criar="podeEditar" :criando="criandoPessoa && campoDeCriacao === 'ficha'"
              :recado-de-erro="campoDeCriacao === 'ficha' ? erroDePessoa : ''"
              :aviso="campoDeCriacao === 'ficha' ? avisoDeCriacao : ''"
              rotulo="Com quem está" texto-vazio="Ninguém"
              @criar="(p) => criarPessoaRapida(p, 'ficha')" @criar-setor="(p) => criarSetorRapido(p, 'ficha')"
              @criar-marca="(p) => criarMarcaRapida(p, 'ficha')" @abrir="limparAvisoDeCriacao" />
          </div>
          <div class="pat-ajuda-txt" v-if="ajudaAberta === 'dono'">{{ AJUDAS.dono }}</div>

          <div class="pat-nota" v-if="avisoDono">{{ avisoDono }}</div>

          <div class="pat-nota" v-if="!bemAberto.novo && bemAberto.dono_texto && !bemAberto.pessoa_id">
            Na planilha este bem estava com <strong>{{ bemAberto.dono_texto }}</strong>, que não
            é um colaborador cadastrado. Escolha a pessoa acima para ligar de vez.
          </div>

          <label class="pat-campo">
            <span>Observação</span>
            <textarea v-model="form.observacao" rows="2" placeholder="Qualquer detalhe que ajude a identificar o bem"></textarea>
          </label>

          <label class="pat-check">
            <input type="checkbox" v-model="form.etiquetado">
            <span>Já está etiquetado</span>
          </label>

          <!-- Situação na Frota (Bronca 2 do dono): "criei a BMW X1 no
               Patrimônio mas só a Frota consegue linkar como bem — precisa
               ter essa via de mão dupla". Só aparece pra bem da categoria
               Veículos, e só depois do bem já existir (precisa de um id pra
               ligar). A tabela é da Frota — ver e mexer aqui exige a mesma
               permissão que a tela da Frota já cobra, não uma nova. -->
          <div class="pat-frota" v-if="mostrarLigacaoFrota">
            <h4>Situação na Frota</h4>

            <!-- Sem a feature "frota", a consulta volta vazia pela RLS —
                 dizer "não ligado" aqui seria inventar dado que a tela não
                 tem como saber. Ela admite o que não vê, em vez disso. -->
            <p class="pat-frota-aviso" v-if="!temAcessoFrota(estado)">
              Você não tem acesso à Frota, então não dá pra saber se este bem está ligado a um veículo.
              Peça acesso ao módulo Frota, ou peça a quem administra pra conferir por lá.
            </p>
            <p class="pat-frota-aviso" v-else-if="frotaErro">
              Não consegui carregar os dados da Frota agora. Recarregue a página; se continuar assim, avise quem administra.
            </p>
            <template v-else>
              <div class="pat-frota-estado" v-if="veiculoDoBem">
                <p>Ligado ao veículo <strong>{{ veiculoDoBem.nome }}</strong> · {{ veiculoDoBem.placa }}.</p>
                <button type="button" class="pat-btn" v-if="podeGerenciarFrota"
                        :disabled="gravandoLigacaoFrota" @click="desfazerLigacaoFrota">
                  {{ gravandoLigacaoFrota ? 'Desfazendo…' : 'Desfazer a ligação' }}
                </button>
              </div>

              <div class="pat-frota-estado" v-else>
                <p>Não ligado a nenhum veículo da Frota.</p>
                <p class="pat-frota-sem-permissao" v-if="!podeGerenciarFrota">
                  Você não tem permissão para editar a Frota, então não dá pra ligar por aqui.
                </p>
                <template v-else>
                  <div class="pat-frota-ligar" v-if="!criandoVeiculoDoBem">
                    <div class="pat-campo-mais" v-if="veiculosParaEscolher.length">
                      <select v-model="ligandoVeiculoId">
                        <option value="">Escolha um veículo da Frota…</option>
                        <option v-for="v in veiculosParaEscolher" :key="v.id" :value="v.id">{{ v.nome }} · {{ v.placa }}</option>
                      </select>
                      <button type="button" class="pat-btn-mais" :disabled="!ligandoVeiculoId || gravandoLigacaoFrota"
                              @click="ligarVeiculoExistente" title="Ligar a este veículo">→</button>
                    </div>
                    <p class="pat-frota-sem-permissao" v-else>
                      Não há veículo livre na Frota para ligar — todos já estão ligados a outro bem.
                    </p>
                    <button type="button" class="pat-btn" @click="abrirCriarVeiculoDoBem">
                      Criar veículo na Frota a partir deste bem
                    </button>
                  </div>

                  <div class="pat-frota-criar" v-else>
                    <label class="pat-campo">
                      <span>Nome do carro</span>
                      <input v-model="novoVeiculoForm.nome" type="text" placeholder="Ex.: BMW X1">
                    </label>
                    <label class="pat-campo">
                      <span>Placa</span>
                      <input v-model="novoVeiculoForm.placa" type="text" placeholder="Ex.: ABC1D23">
                    </label>
                    <label class="pat-campo">
                      <span>Marca</span>
                      <input v-model="novoVeiculoForm.marca" type="text" placeholder="Ex.: BMW">
                    </label>
                    <div class="pat-frota-criar-acoes">
                      <button type="button" class="pat-btn" @click="fecharCriarVeiculoDoBem">Cancelar</button>
                      <button type="button" class="pat-btn primario" :disabled="gravandoLigacaoFrota" @click="criarVeiculoDoBem">
                        {{ gravandoLigacaoFrota ? 'Criando…' : 'Criar e ligar' }}
                      </button>
                    </div>
                  </div>
                </template>
              </div>
            </template>
          </div>

          <!-- Histórico de posse: só faz sentido em bem que já existe. -->
          <div class="pat-hist" v-if="!bemAberto.novo">
            <h4>Histórico de posse</h4>
            <div class="pat-hist-vazio" v-if="!historico.length">
              Ninguém pegou este bem ainda. Quando você colocar uma pessoa em "com quem está",
              a troca fica registrada aqui com a data.
            </div>
            <div class="pat-hist-linha" v-for="h in historico" :key="h.id">{{ textoLinhaHistorico(h) }}</div>
          </div>
        </div>

        <div class="pat-ficha-pe">
          <button class="pat-btn" @click="fecharFicha">Cancelar</button>
          <button class="pat-btn perigo" v-if="!bemAberto.novo && podeExcluir" @click="excluirBem">Excluir</button>
          <button class="pat-btn primario" :disabled="salvando" @click="salvarBem">
            {{ salvando ? 'Salvando…' : 'Salvar' }}
          </button>
        </div>
      </div>
    </div>

    <!-- Listas editáveis: o dono cria/renomeia/apaga as opções que aparecem nos
         campos do bem. Sem isto ele ficaria preso nos valores semeados. -->
    <div class="pat-ficha-fundo" v-if="listasAbertas" v-trava-rolagem @click.self="listasAbertas = false">
      <div class="pat-ficha">
        <div class="pat-ficha-topo">
          <button class="pat-ficha-fechar" @click="listasAbertas = false" aria-label="Fechar">✕</button>
          <span class="pat-ficha-titulo">Listas</span>
          <button class="pat-btn-ajuda" @click="passeioListasAberto = true" title="Passeio pelos campos">?</button>
        </div>
        <PasseioGuiado v-model="passeioListasAberto" :passos="PASSOS_LISTAS" />
        <div class="pat-ficha-corpo">
          <p class="pat-tutorial-fixo">{{ TEXTOS.listasAbertas }}</p>
          <div class="pat-ajuda-txt">{{ AJUDAS.arvore }}</div>

          <!-- Árvore de cadastro, aberta um galho por vez. Fechado por padrão
               pra não despejar 47 caixas de texto na cara de quem só quer
               renomear uma coisa — que era a reclamação. -->
          <div class="pat-arv" v-for="marca in empresas" :key="marca.id">
            <div class="pat-arv-linha nivel1">
              <button class="pat-arv-abrir" @click="alternarGalho('m' + marca.id)" :aria-expanded="galhoAberto('m' + marca.id)">
                {{ galhoAberto('m' + marca.id) ? '▾' : '▸' }}
              </button>
              <input class="pat-lista-nome" :value="marca.nome" data-tour="listas-por-que"
                     @change="renomearItem(DEF_MARCAS, marca, $event.target.value)">
              <button class="pat-lista-del" @click="apagarItem(DEF_MARCAS, marca)" aria-label="Apagar marca" data-tour="listas-apagar">✕</button>
            </div>

            <div class="pat-arv-filhos" v-if="galhoAberto('m' + marca.id)">
              <div class="pat-arv-vazio" v-if="!locaisDaMarca(marca.id).length">
                Nenhum local nesta marca ainda.
              </div>

              <div v-for="local in locaisDaMarca(marca.id)" :key="local.id">
                <div class="pat-arv-linha nivel2">
                  <button class="pat-arv-abrir" @click="alternarGalho('l' + local.id)" :aria-expanded="galhoAberto('l' + local.id)">
                    {{ galhoAberto('l' + local.id) ? '▾' : '▸' }}
                  </button>
                  <input class="pat-lista-nome" :value="local.nome"
                         @change="renomearItem(DEF_LOCAIS, local, $event.target.value)">
                  <button class="pat-lista-del" @click="apagarItem(DEF_LOCAIS, local)" aria-label="Apagar local">✕</button>
                </div>

                <div class="pat-arv-filhos" v-if="galhoAberto('l' + local.id)">
                  <div class="pat-arv-vazio" v-if="!comodosDoLocal(local.id).length">
                    Nenhum ambiente neste local ainda.
                  </div>
                  <div class="pat-arv-linha nivel3" v-for="comodo in comodosDoLocal(local.id)" :key="comodo.id">
                    <span class="pat-arv-vaga"></span>
                    <input class="pat-lista-nome" :value="comodo.nome"
                           @change="renomearItem(DEF_COMODOS, comodo, $event.target.value)">
                    <button class="pat-lista-del" @click="apagarItem(DEF_COMODOS, comodo)" aria-label="Apagar ambiente">✕</button>
                  </div>
                  <div class="pat-arv-linha nivel3">
                    <span class="pat-arv-vaga"></span>
                    <input class="pat-lista-nome" v-model="novoComodo[local.id]"
                           placeholder="novo ambiente aqui…"
                           @keyup.enter="criarFilho(DEF_COMODOS, { local_id: local.id }, novoComodo, local.id)"
                           @blur="criarFilho(DEF_COMODOS, { local_id: local.id }, novoComodo, local.id)">
                    <button class="pat-btn" @click="criarFilho(DEF_COMODOS, { local_id: local.id }, novoComodo, local.id)">+</button>
                  </div>
                </div>
              </div>

              <div class="pat-arv-linha nivel2">
                <span class="pat-arv-vaga"></span>
                <input class="pat-lista-nome" v-model="novoLocal[marca.id]"
                       placeholder="novo local nesta marca…"
                       @keyup.enter="criarFilho(DEF_LOCAIS, { empresa_id: marca.id }, novoLocal, marca.id)"
                       @blur="criarFilho(DEF_LOCAIS, { empresa_id: marca.id }, novoLocal, marca.id)">
                <button class="pat-btn" @click="criarFilho(DEF_LOCAIS, { empresa_id: marca.id }, novoLocal, marca.id)">+</button>
              </div>
            </div>
          </div>

          <div class="pat-arv-linha nivel1">
            <span class="pat-arv-vaga"></span>
            <input class="pat-lista-nome" v-model="novos.patrimonio_empresas"
                   placeholder="nova marca…" @keyup.enter="criarItem(DEF_MARCAS)"
                   @blur="criarItem(DEF_MARCAS)">
            <button class="pat-btn" @click="criarItem(DEF_MARCAS)">Adicionar marca</button>
          </div>

          <!-- Categoria é lista SOLTA de propósito: ela classifica o que o bem É
               (notebook, mesa, carro), não onde ele está. Aninhar dentro de local
               obrigaria a recadastrar "Computadores" em cada sala. -->
          <div class="pat-lista-bloco">
            <h4>Categorias</h4>
            <p class="pat-listas-ajuda">O que o bem é. Não depende de onde ele está.</p>
            <div class="pat-lista-item" v-for="item in categorias" :key="item.id">
              <input class="pat-lista-nome" :value="item.nome"
                     @change="renomearItem(DEF_CATEGORIAS, item, $event.target.value)">
              <button class="pat-lista-del" @click="apagarItem(DEF_CATEGORIAS, item)" aria-label="Apagar">✕</button>
            </div>
            <div class="pat-lista-novo">
              <input class="pat-lista-nome" v-model="novos.patrimonio_categorias"
                     placeholder="nova categoria…" @keyup.enter="criarItem(DEF_CATEGORIAS)"
                     @blur="criarItem(DEF_CATEGORIAS)">
              <button class="pat-btn" @click="criarItem(DEF_CATEGORIAS)">Adicionar</button>
            </div>
          </div>
        </div>
        <div class="pat-ficha-pe">
          <button class="pat-btn primario" @click="listasAbertas = false">Pronto</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import { adminToast } from '../../compartilhado/avisos.js'
import { hasPermission, estado } from '../../compartilhado/controle-de-login-e-usuario.js'
import { hojeLocal } from '../../compartilhado/datas.js'
import { formatarValor, parsearValor, fecharEAbrirHistorico } from './patrimonio.js'
import { textoLinhaHistorico, formatarDataBR } from './patrimonio-lista.js'
import { SITUACOES, rotuloDaSituacao, classeDaSituacao, textoDoDono, avisoDeDonoVazio } from './rotulos-do-bem.js'
import { FILTRO_VAZIO, filtrarBens, resumoDaLista } from './filtro-de-bens.js'
import { SEM_VALOR, agruparBens, bensDoCaminho, rotuloDoCaminho } from './arvore-de-bens.js'
import PasseioGuiado from '../../compartilhado/passeio-guiado.vue'
import {
  PASSOS, TEXTOS, PASSOS_MASSA, PASSOS_BEM, PASSOS_LISTAS, AJUDAS, deveAbrirSozinho, marcarComoVisto,
} from './tutorial.js'
import { TETO_PADRAO, textoDaFaixa, mapaDeNumeros, aumentarTeto, ehRecente } from './numeros-de-etiqueta.js'
import LeitorDeEtiqueta from './leitor-de-etiqueta.vue'
import { resultadoDaLeitura, mensagemDoResultado, etiqueta as etiquetaImpressa } from './leitor-de-codigo.js'
import { COLUNAS_PLANILHA, ordenarPlanilha, resumirPor, totaisGerais, montarLinhasParaExcel } from './planilha-e-resumo.js'
import AbaDeRelatorios from '../../compartilhado/relatorios/aba-de-relatorios.vue'
import { RELATORIOS_DO_PATRIMONIO } from './relatorios-do-patrimonio.js'
import { LIMPAR, montarAlteracaoEmMassa, temAlgoParaMudar, resumoDaSelecao,
  alternarTodosVisiveis, estadoDaSelecaoVisivel } from './acao-em-massa.js'
import { resolverNovaOpcao } from '../../compartilhado/nova-opcao.js'
import {
  temAcessoFrota, categoriaVeiculoEntre, bemEhCategoriaVeiculo,
  veiculoLigadoAoBem, veiculosParaLigar, patchVeiculoDoBem,
  exigePlacaNoBem, placaObrigatoria,
} from './ligacao-com-frota.js'
// Da Frota, e NÃO reescrito aqui: normalizar placa diferente nos dois lados
// criaria carro duplicado por causa de um hífen — `placa` é UNIQUE. Import
// entre pastas de ferramenta já é prática desta base (tela-de-acessos.vue
// importa deste mesmo arquivo).
import { normalizarPlaca, fraseDaSincronia } from '../frota/etiqueta-do-veiculo.js'
// Trava a rolagem do fundo enquanto um destes 4 modais estiver aberto (bronca
// do dono: "abro um modal e a tela atrás continua rolando").
import { vTravaRolagem } from '../../compartilhado/travar-rolagem-de-fundo.js'
import EscolhaDePessoa from '../../compartilhado/escolha-de-pessoa.vue'
import { mesclarPessoas, apenasAtivas, comSelecionada } from '../../compartilhado/pessoas-para-escolher.js'

const router = useRouter()

const carregando = ref(true)
const erro = ref('')
const bens = ref([])
const empresas = ref([])
const locais = ref([])
const comodos = ref([])
const categorias = ref([])
const tipos = ref([])
const pessoas = ref([])
const setores = ref([])
const criandoPessoa = ref(false)
const erroDePessoa = ref('')
// Recado sobre como a criação TERMINOU ("já existia"/"cadastrada"), pra
// alimentar a prop `aviso` do EscolhaDePessoa — mesmo parágrafo de fora que a
// Frota usa (item D do fix de 13/08/2026). O Patrimônio mantém o `adminToast`
// que já tinha, mas as duas telas passam a dizer a mesma coisa no mesmo lugar.
const avisoDeCriacao = ref('')
// Qual campo de pessoa está criando agora ('' = nenhum). O aviso de erro e o
// "Criando…" pertencem ao campo que pediu, não à tela: são dois campos de
// pessoa aqui (a ficha e a alteração em massa) e o erro de um aparecia no
// outro na primeira vez que a caixinha dele abria.
const campoDeCriacao = ref('')   // '' | 'ficha' | 'massa'
// A RPC `pessoas_para_escolher()` ESTOURA (42501) pra quem não é
// is_frota_admin, is_patrimonio_admin nem is_acessos_admin — de propósito
// (migration 2026-08-13, linha ~31: "vazio silencioso é o defeito que já
// mostrou R$ 0,00 na tela do dono por 17 horas"). Aqui não há leitura direta
// de `acessos_pessoas` de reserva — a lista de pessoas vem só desta função —,
// então o erro dela sozinho já é o "eu não vejo essa lista", mesmo
// raciocínio do `frotaErro` logo abaixo: lista vazia sozinha não distingue
// "ninguém pra escolher" de "eu não vejo essa lista".
const pessoasErro = ref(false)
// A ligação com a Frota (Bronca 2 do dono): carros que já apontam pra um bem
// daqui. `frotaErro` distingue "a consulta falhou de verdade" (rede, banco
// fora do ar) de "vazio porque não tenho a feature frota" — as duas
// produzem lista vazia, mas só a primeira é uma FALHA que a tela precisa
// admitir; a segunda é resolvida à parte por `temAcessoFrota()`.
const veiculosFrota = ref([])
const frotaErro = ref(false)

const filtro = reactive({ ...FILTRO_VAZIO })

const podeCriar = computed(() => hasPermission('patrimonio', 'criar'))
// Chave PRÓPRIA, e não uma ação de 'patrimonio': quem mexe no cadastro não é
// necessariamente quem pode tirar a base inteira em planilha. Nasce desmarcada
// para todo mundo — nenhuma migration concede, quem libera é o Config de Admin.
const podeRelatorios = computed(() => hasPermission('patrimonio.relatorios', 'ver'))
const podeExportarRelatorio = computed(() => hasPermission('patrimonio.relatorios', 'exportar'))

const pessoasById = computed(() => {
  const mapa = {}
  pessoas.value.forEach((p) => { mapa[p.id] = p })
  return mapa
})

// ------------------------------------------------ navegação Empresa→Local→Ambiente
// ATENÇÃO ao ler o código: na TELA o terceiro nível chama "Ambiente" (pedido do
// dono — "cômodo" soava doméstico demais pra Produção, Estoque e Sala de
// Reunião). No BANCO e aqui no código ele continua `comodo`/`comodo_id`:
// renomear tabela e coluna com 341 bens apontando pra elas, com o app no ar, é
// risco sem retorno. Se um dia valer a pena, é um `alter table rename`.
// Onde a pessoa está agora na árvore. Vazio = raiz (lista de empresas).
const caminho = reactive({ empresaId: '', localId: '', comodoId: '' })
// "Ver os N itens daqui, sem separar": escape pra ver os bens sem descer mais.
const verTudoAqui = ref(false)

const listas = computed(() => ({
  empresas: empresas.value, locais: locais.value, comodos: comodos.value,
}))

const temCaminho = computed(() => !!(caminho.empresaId || caminho.localId || caminho.comodoId))

// Os filtros (categoria/situação/sem dono/busca) valem SEMPRE, em qualquer nível:
// eles recortam o conteúdo, a árvore recorta o lugar. São perguntas diferentes.
// Tudo que o bem NÃO carrega em si, mas que a pessoa vai digitar na busca: o
// nome de quem está com ele, a marca, o local, o ambiente, a categoria e o tipo.
// No banco o bem guarda só os identificadores; sem resolver aqui, procurar por
// "erick" ou por "conchal" não acha nada.
// Existe um nomeDe() mais abaixo que devolve '—' quando não há valor — bom pra
// exibir, ruim pra buscar (ninguém procura por travessão). Este devolve vazio.
const nomeParaBusca = (lista, id) => (id ? (lista.find((x) => x.id === id)?.nome || '') : '')
function textoDeBusca(bem) {
  return [
    bem.pessoa_id ? (pessoasById.value[bem.pessoa_id]?.nome || '') : '',
    nomeParaBusca(empresas.value, bem.empresa_id),
    nomeParaBusca(locais.value, bem.local_id),
    nomeParaBusca(comodos.value, bem.comodo_id),
    nomeParaBusca(categorias.value, bem.categoria_id),
    nomeParaBusca(tipos.value, bem.tipo_id),
    rotuloDaSituacao(bem.situacao),
  ].filter(Boolean).join(' ')
}

const bensFiltrados = computed(() =>
  filtrarBens(bensDoCaminho(bens.value, caminho), filtro, textoDeBusca))

// O que o contador do topo conta depende da visão: a árvore mostra a pasta em
// que a pessoa está, a Planilha mostra tudo que passou pelos filtros (ignorando
// a pasta) e o Resumo mostra o patrimônio inteiro. Ter um número fixo em cima
// enquanto a lista mostrava outro foi exatamente o que confundiu o dono.
const bensDoContador = computed(() => {
  if (visao.value === 'resumo') return bens.value
  if (visao.value === 'planilha') return filtrarBens(bens.value, filtro, textoDeBusca)
  return bensFiltrados.value
})
const resumo = computed(() => resumoDaLista(bensDoContador.value))

// E o contador DIZ de onde é o número, pra não haver dúvida na tela.
const ondeEstouContando = computed(() => {
  if (visao.value === 'resumo') return 'no total'
  if (visao.value === 'planilha') return temFiltro.value ? 'na busca' : 'no total'
  if (temCaminho.value) return 'em ' + rotuloDoCaminho(caminho, listas.value)
  return temFiltro.value ? 'na busca' : 'no total'
})

// Os cadastros agora são uma ÁRVORE: local pertence a uma marca, cômodo a um
// local. Estes dois filtros são a base de tudo — a navegação, os seletores da
// ficha e a tela de Listas usam os mesmos.
const locaisDaMarca = (empresaId) =>
  empresaId && empresaId !== SEM_VALOR ? locais.value.filter((l) => l.empresa_id === empresaId) : []
const comodosDoLocal = (localId) =>
  localId && localId !== SEM_VALOR ? comodos.value.filter((c) => c.local_id === localId) : []

// Qual campo agrupa no nível atual: sem marca escolhida agrupa por marca, com
// marca agrupa pelos locais DELA, com local agrupa pelos cômodos DELE. No cômodo
// acaba. Passar só os filhos do pai atual é o que impede "Sala de Reunião" de
// outro local aparecer aqui dentro.
const nivelAtual = computed(() => {
  if (!caminho.empresaId) return { campo: 'empresa_id', cadastro: empresas.value }
  if (!caminho.localId) return { campo: 'local_id', cadastro: locaisDaMarca(caminho.empresaId) }
  if (!caminho.comodoId) return { campo: 'comodo_id', cadastro: comodosDoLocal(caminho.localId) }
  return null
})

const grupos = computed(() =>
  nivelAtual.value ? agruparBens(bensFiltrados.value, nivelAtual.value.campo, nivelAtual.value.cadastro) : [])

// Buscar é um pedido de "ache em TUDO": nesse momento a árvore sai da frente e a
// resposta vem em lista, senão a pessoa digita o nome do bem e ainda tem que
// adivinhar em que pasta ele mora.
const buscando = computed(() => !!(filtro.busca || '').trim())

// Grupos aparecem quando há mais de um lugar pra escolher e a pessoa não pediu
// pra ver tudo nem está buscando. Um grupo só não é escolha — é um toque à toa.
const mostrarGrupos = computed(() =>
  !buscando.value && !verTudoAqui.value && grupos.value.length > 1)

// Ou se mostram as pastas, ou se mostram os bens — nunca os dois.
// Havia aqui uma segunda lista ("N itens sem local") com os bens deste nível que
// não caem em nenhuma pasta abaixo. Era REDUNDANTE: esses são exatamente os
// mesmos itens que já estão dentro da pasta "Sem local", que aparece na lista de
// pastas com contagem, valor e entrada própria. O dono viu o mesmo item duas
// vezes na mesma tela. Um caminho só por item.
const mostrarBens = computed(() => !mostrarGrupos.value)
const bensNaTela = computed(() => bensFiltrados.value)

function entrarNoGrupo(g) {
  if (!caminho.empresaId) caminho.empresaId = g.id
  else if (!caminho.localId) caminho.localId = g.id
  else caminho.comodoId = g.id
  verTudoAqui.value = false
}

// Volta pro nível N da trilha: 0 = tudo, 1 = dentro da empresa, 2 = dentro do local.
function irParaNivel(n) {
  if (n < 3) caminho.comodoId = ''
  if (n < 2) caminho.localId = ''
  if (n < 1) caminho.empresaId = ''
  verTudoAqui.value = false
}

function nomeDoNivel(nivel) {
  const cortes = { empresaId: 1, localId: 2, comodoId: 3 }
  const parcial = { empresaId: '', localId: '', comodoId: '' }
  const ate = cortes[nivel]
  if (ate >= 1) parcial.empresaId = caminho.empresaId
  if (ate >= 2) parcial.localId = caminho.localId
  if (ate >= 3) parcial.comodoId = caminho.comodoId
  return rotuloDoCaminho(parcial, listas.value)
}

// O "voltar" sobe um degrau; na raiz é que sai do módulo. Um botão só.
const rotuloDoVoltar = computed(() => (temCaminho.value ? 'Voltar' : 'Gestão Interna'))


const temFiltro = computed(() =>
  !!filtro.busca || !!filtro.empresaId || !!filtro.localId ||
  !!filtro.categoriaId || !!filtro.situacao || !!filtro.pessoaId || filtro.semDono)

function limparFiltros() {
  Object.assign(filtro, FILTRO_VAZIO)
}

function nomeDe(lista, id) {
  if (!id) return '—'
  const achou = lista.find((x) => x.id === id)
  return achou ? achou.nome : '—'
}

// Local e cômodo juntos numa linha só: no cartão do celular não cabe uma linha
// pra cada, e "Sede Limeira · RH" é como a pessoa fala.
function nomeDoLocal(bem) {
  const local = nomeDe(locais.value, bem.local_id)
  const comodo = nomeDe(comodos.value, bem.comodo_id)
  if (local === '—' && comodo === '—') return 'Local não informado'
  if (comodo === '—') return local
  if (local === '—') return comodo
  return `${local} · ${comodo}`
}

// Sobe um degrau da árvore; só sai do módulo quando já está na raiz. Se a pessoa
// estava vendo "tudo daqui, sem separar", o primeiro voltar desfaz isso — senão
// ela apertaria voltar e pularia um nível sem entender por quê.
function voltar() {
  if (verTudoAqui.value) { verTudoAqui.value = false; return }
  if (caminho.comodoId) { caminho.comodoId = ''; return }
  if (caminho.localId) { caminho.localId = ''; return }
  if (caminho.empresaId) { caminho.empresaId = ''; return }
  router.push({ name: 'gestao-interna' })
}

// Qual bem está aberto na ficha (null = ficha fechada). Declarado ANTES das
// funções que mexem nele — `const` não sobe (hoisting), e usá-lo antes daria
// ReferenceError em runtime, não erro de build.
/* ── LER A ETIQUETA COM A CÂMERA ────────────────────────────────────────────
   A etiqueta da RBV & Co. guarda o número de patrimônio num código de barras
   Code 128 — a de nº 19 contém "000019" (lido de uma etiqueta de verdade). Ler
   e abrir o item é o caminho curto pro que essa ferramenta serve: você está de
   pé na frente do bem e quer saber de quem ele é.

   O que decidir a partir do texto lido mora em leitor-de-codigo.js, que é
   testado sem câmera nenhuma. Aqui só se liga uma coisa na outra. */
const lendoEtiqueta = ref(false)
const avisoDaLeitura = ref('')
function aoLerEtiqueta(texto) {
  const r = resultadoDaLeitura(bens.value, texto)
  if (r.ok) {
    avisoDaLeitura.value = ''
    // A busca também recebe o número: assim, ao fechar a ficha, a pessoa vê o
    // item na lista em vez de voltar pra uma tela que não mudou.
    filtro.busca = etiquetaImpressa(r.numero)
    abrirBem(r.bem)
    return
  }
  // Erro não vira modal: ela está de pé, com o celular numa mão. Um aviso na
  // tela, e o botão continua ali pra tentar de novo.
  avisoDaLeitura.value = mensagemDoResultado(r)
}
// O aviso some assim que a pessoa faz qualquer outra coisa na busca.
watch(() => filtro.busca, () => { avisoDaLeitura.value = '' })

const bemAberto = ref(null)

function abrirBem(bem) {
  bemAberto.value = bem
}
function abrirNovo() {
  bemAberto.value = { novo: true }
}

// ---------------------------------------------------------------- ficha do bem
const salvando = ref(false)
const historico = ref([])
const podeExcluir = computed(() => hasPermission('patrimonio', 'excluir'))
// `apenasAtivas` trata ficha sem `status` como ativa: a coluna tem padrão
// 'ativo' no banco, e sumir com alguém por campo vazio seria dado a menos sem
// avisar. Pessoa recém-criada pelo "+" cai exatamente nesse caso.
const pessoasAtivas = computed(() => apenasAtivas(pessoas.value))

const FORM_VAZIO = {
  nome: '', numero: '', numero_serie: '', valor: '', data_compra: '',
  empresa_id: '', local_id: '', comodo_id: '', categoria_id: '',
  tipo_id: '', marca: '',
  pessoa_id: '', situacao: 'em_estoque', observacao: '', etiquetado: false,
}
const form = reactive({ ...FORM_VAZIO })

// O aviso de "aparelho pessoal em uso sem ninguém". É aviso, não trava: móvel e
// máquina ficam em uso sem dono o tempo todo, e são a maioria do patrimônio.
const avisoDono = computed(() => avisoDeDonoVazio({
  situacao: form.situacao,
  categoria: categorias.value.find((c) => c.id === form.categoria_id)?.nome || null,
  temDono: !!form.pessoa_id,
}))

/* ── Ligação com a Frota (Bronca 2) ───────────────────────────────────────
   Via de mão dupla: até aqui só a tela da Frota linkava bem↔veículo. Aqui a
   ficha do bem mostra a mesma ligação e oferece desfazer, ligar a um
   veículo existente, ou criar o veículo a partir deste bem. A decisão de
   QUE MOSTRAR mora em ligacao-com-frota.js, testada; aqui só estado de tela
   e as chamadas ao banco — que continuam escrevendo em `frota_veiculos`,
   porque é lá que o vínculo mora (não dá pra inventar uma segunda coluna
   duplicando o mesmo dado nos dois lados). */
const categoriaVeiculoId = computed(() => categoriaVeiculoEntre(categorias.value))
// Um bem "novo" (ainda sendo criado, sem id) não tem o que ligar — ligar
// precisa de um `frota_veiculos.bem_id` apontando pra um id que já existe.
const mostrarLigacaoFrota = computed(() =>
  !!bemAberto.value && !bemAberto.value.novo && bemEhCategoriaVeiculo(bemAberto.value, categoriaVeiculoId.value))
const veiculoDoBem = computed(() =>
  bemAberto.value ? veiculoLigadoAoBem(veiculosFrota.value, bemAberto.value.id) : null)
const veiculosParaEscolher = computed(() => veiculosParaLigar(veiculosFrota.value))
// Escrever em frota_veiculos exige a mesma permissão que a tela da Frota já
// respeita (RLS `is_frota_admin()`, ligada à feature "frota" do perfil) —
// não é uma permissão nova pro Patrimônio, é a MESMA que só existia do
// outro lado até agora.
const podeGerenciarFrota = computed(() => hasPermission('frota', 'editar'))

const ligandoVeiculoId = ref('')
const gravandoLigacaoFrota = ref(false)
const criandoVeiculoDoBem = ref(false)
const novoVeiculoForm = reactive({ nome: '', placa: '', marca: '' })

function abrirCriarVeiculoDoBem() {
  Object.assign(novoVeiculoForm, { nome: '', placa: '', marca: '' })
  if (bemAberto.value) Object.assign(novoVeiculoForm, patchVeiculoDoBem(novoVeiculoForm, bemAberto.value))
  criandoVeiculoDoBem.value = true
}
function fecharCriarVeiculoDoBem() { criandoVeiculoDoBem.value = false }

async function ligarVeiculoExistente() {
  if (gravandoLigacaoFrota.value || !ligandoVeiculoId.value || !bemAberto.value) return
  gravandoLigacaoFrota.value = true
  const { error } = await sbClient.from('frota_veiculos')
    .update({ bem_id: bemAberto.value.id, atualizado_em: new Date().toISOString() })
    .eq('id', ligandoVeiculoId.value)
  gravandoLigacaoFrota.value = false
  // A tela NUNCA pode parecer que deu certo quando a gravação falhou — o
  // toast vermelho é o mesmo caminho que salvarBem()/criarItem() já usam
  // nesta tela pra erro de escrita, sem inventar um padrão novo aqui.
  if (error) { adminToast('Não consegui ligar o veículo. Confira se você tem permissão para editar a Frota, ou tente de novo.', false); return }
  ligandoVeiculoId.value = ''
  adminToast('Veículo ligado a este bem')
  await carregar()
}

async function desfazerLigacaoFrota() {
  if (gravandoLigacaoFrota.value || !veiculoDoBem.value) return
  gravandoLigacaoFrota.value = true
  const { error } = await sbClient.from('frota_veiculos')
    .update({ bem_id: null, atualizado_em: new Date().toISOString() })
    .eq('id', veiculoDoBem.value.id)
  gravandoLigacaoFrota.value = false
  if (error) { adminToast('Não consegui desfazer a ligação. Tente de novo.', false); return }
  adminToast('Ligação desfeita')
  await carregar()
}

async function criarVeiculoDoBem() {
  if (gravandoLigacaoFrota.value || !bemAberto.value) return
  if (!String(novoVeiculoForm.nome || '').trim() || !String(novoVeiculoForm.placa || '').trim()) {
    adminToast('Nome e placa são obrigatórios — é por eles que o carro é reconhecido na Frota.', false)
    return
  }
  gravandoLigacaoFrota.value = true
  const { error } = await sbClient.from('frota_veiculos').insert({
    nome: novoVeiculoForm.nome.trim(),
    placa: String(novoVeiculoForm.placa).toUpperCase().replace(/[^A-Z0-9]/g, ''),
    marca: novoVeiculoForm.marca.trim() || null,
    bem_id: bemAberto.value.id,
    situacao: 'ativo',
  })
  gravandoLigacaoFrota.value = false
  if (error) {
    adminToast(/duplicate|unique/i.test(error.message || '')
      ? 'Já existe outro veículo da Frota com essa placa.'
      : 'Não consegui criar o veículo na Frota. Tente de novo.', false)
    return
  }
  criandoVeiculoDoBem.value = false
  adminToast('Veículo criado na Frota e ligado a este bem')
  await carregar()
}

// Os seletores em cascata da ficha.
const tiposDaCategoria = (categoriaId) =>
  categoriaId ? tipos.value.filter((t) => t.categoria_id === categoriaId) : []
const tiposDoForm = computed(() => tiposDaCategoria(form.categoria_id))
watch(() => form.categoria_id, () => {
  if (!tiposDoForm.value.some((t) => t.id === form.tipo_id)) form.tipo_id = ''
})

const locaisDoForm = computed(() => locaisDaMarca(form.empresa_id))
const comodosDoForm = computed(() => comodosDoLocal(form.local_id))

// Trocou a marca: o local escolhido pode não existir mais nela — e o cômodo
// junto. Limpar é obrigatório, senão o bem fica com um local de outra marca.
watch(() => form.empresa_id, () => {
  if (!locaisDoForm.value.some((l) => l.id === form.local_id)) {
    form.local_id = ''
    form.comodo_id = ''
  }
})
watch(() => form.local_id, () => {
  if (!comodosDoForm.value.some((c) => c.id === form.comodo_id)) form.comodo_id = ''
})

// -------------------------------------------------- "+" nos campos do bem
// O mesmo travamento do caso da BMW existe em qualquer lista de seleção do
// formulário: quem cadastra o bem não pode ficar preso ao que já foi
// cadastrado antes. Quem já pode criar o bem já pode criar a opção que
// falta — não é ação de admin, e por isso usa a MESMA permissão de escrita
// destas 5 tabelas que a tela de Listas já usa (RLS via is_patrimonio_admin,
// idêntica à de patrimonio_bens: quem cria bem hoje já teria acesso).
// Local/ambiente/tipo têm PAI (marca/local/categoria): a opção nova nasce
// ligada a ele, e sem o pai escolhido o "+" nem abre.
const DEFS_CAMPO = {
  empresa:   { tabela: 'patrimonio_empresas',  campoForm: 'empresa_id' },
  categoria: { tabela: 'patrimonio_categorias', campoForm: 'categoria_id' },
  local:     { tabela: 'patrimonio_locais',    campoForm: 'local_id',
               paiCampo: 'empresa_id', mensagemPai: 'Escolha a marca antes de criar um local novo.' },
  comodo:    { tabela: 'patrimonio_comodos',   campoForm: 'comodo_id',
               paiCampo: 'local_id', mensagemPai: 'Escolha o local antes de criar um ambiente novo.' },
  tipo:      { tabela: 'patrimonio_tipos',     campoForm: 'tipo_id',
               paiCampo: 'categoria_id', mensagemPai: 'Escolha a categoria antes de criar um tipo novo.' },
}

// A lista certa pra comparar duplicata (e o vínculo pro insert) é a mesma
// já filtrada pelo pai que os <select> em cascata usam — reaproveitar evita
// um segundo jeito de "quais locais são desta marca" divergir do primeiro.
function listaEVinculoDoCampo(chave) {
  if (chave === 'local') return { lista: locaisDoForm.value, vinculo: { empresa_id: form.empresa_id } }
  if (chave === 'comodo') return { lista: comodosDoForm.value, vinculo: { local_id: form.local_id } }
  if (chave === 'tipo') return { lista: tiposDoForm.value, vinculo: { categoria_id: form.categoria_id } }
  if (chave === 'empresa') return { lista: empresas.value, vinculo: {} }
  return { lista: categorias.value, vinculo: {} }
}

// Qual "+" está com a caixinha de nome aberta ('' = nenhum).
const novaOpcaoAberta = ref('')
const novaOpcaoNome = ref('')
const salvandoNovaOpcao = ref(false)

function abrirNovaOpcao(chave) {
  const def = DEFS_CAMPO[chave]
  if (def.paiCampo && !form[def.paiCampo]) { adminToast(def.mensagemPai, false); return }
  novaOpcaoAberta.value = chave
  novaOpcaoNome.value = ''
}
function cancelarNovaOpcao() {
  novaOpcaoAberta.value = ''
  novaOpcaoNome.value = ''
}

async function confirmarNovaOpcao() {
  const chave = novaOpcaoAberta.value
  const def = DEFS_CAMPO[chave]
  if (!def) return
  // Checa de novo: o pai pode ter sido limpo enquanto a caixinha estava aberta.
  if (def.paiCampo && !form[def.paiCampo]) { adminToast(def.mensagemPai, false); return }

  const { lista, vinculo } = listaEVinculoDoCampo(chave)
  const r = resolverNovaOpcao(novaOpcaoNome.value, lista)
  if (!r.ok) { adminToast(r.mensagem, false); return }

  if (r.jaExistia) {
    form[def.campoForm] = r.item.id
    adminToast(`"${r.item.nome}" já existia — selecionei ela para você`)
    cancelarNovaOpcao()
    return
  }

  salvandoNovaOpcao.value = true
  const { data, error } = await sbClient.from(def.tabela)
    .insert({ nome: r.nome, ordem: lista.length + 1, ...vinculo })
    .select('id, nome')
    .single()
  salvandoNovaOpcao.value = false

  if (error) {
    // unique(nome) violado por uma corrida com outra pessoa: a opção passou a
    // existir entre o "resolver" e o "gravar". Recarrega e avisa — não finge
    // que criou o que não criou.
    const jaExiste = /duplicate key|unique/i.test(error.message)
    if (jaExiste) {
      await carregar()
      const { lista: listaAtualizada } = listaEVinculoDoCampo(chave)
      const achado = listaAtualizada.find((item) => item.nome === r.nome)
        || resolverNovaOpcao(r.nome, listaAtualizada).item
      if (achado) form[def.campoForm] = achado.id
      adminToast(`"${r.nome}" já tinha sido criado — selecionei ela para você`)
      cancelarNovaOpcao()
      return
    }
    adminToast('Erro ao criar: ' + error.message, false)
    return
  }

  await carregar()
  form[def.campoForm] = data.id
  adminToast(`"${data.nome}" criado`)
  cancelarNovaOpcao()
}

/* CADASTRO RÁPIDO DE COLABORADOR (13/08/2026).
 *
 * Quem grava é a tela, não o componente — mesmo contrato do "+" de local. O
 * banco é quem decide se pode: `criar_pessoa_rapida` recusa quem não mexe em
 * Patrimônio, Frota ou Acessos, e devolve `ja_existia` quando o nome já estava
 * lá (comparando sem caixa e sem espaço nas pontas).
 *
 * SEM try/catch DE PROPÓSITO, nas três funções abaixo: o supabase-js v2 não
 * rejeita a promessa quando o fetch falha — ele DEVOLVE `{ error }`, que é
 * justamente o que estas funções já tratam. E o `criandoPessoa = false` vem
 * ANTES do `await carregar()`, então nem um erro no recarregamento deixa o
 * botão preso em "Criando…". Um try/catch aqui não pegaria nada e só esconderia
 * o caminho de erro que existe. */
async function criarPessoaRapida({ nome, cargo, marcaId, setorId }, campo) {
  if (criandoPessoa.value) return
  criandoPessoa.value = true
  erroDePessoa.value = ''
  avisoDeCriacao.value = ''
  campoDeCriacao.value = campo

  const { data, error } = await sbClient.rpc('criar_pessoa_rapida', {
    p_nome: nome, p_cargo: cargo, p_marca_id: marcaId, p_setor_id: setorId,
  })
  criandoPessoa.value = false

  if (error) {
    erroDePessoa.value = 'Não consegui cadastrar. Tente de novo; se continuar, confirme '
      + 'com quem administra se você pode cadastrar colaborador.'
    return
  }

  const criada = Array.isArray(data) ? data[0] : data
  await carregar()
  // `campoDeCriacao` continua apontando pra este campo (não zera mais aqui):
  // é ele quem decide, no template, qual EscolhaDePessoa recebe este aviso
  // pela prop `aviso`. O `adminToast` continua — o dono já está acostumado a
  // olhar pra ele — mas agora as duas telas (Frota e Patrimônio) dizem a
  // mesma coisa no mesmo parágrafo de fora, e não só no toast que passa.
  if (criada && criada.ja_existia) {
    avisoDeCriacao.value = `«${criada.nome}» já estava cadastrada — deixei essa selecionada.`
    adminToast(`"${criada.nome}" já estava cadastrada`)
  } else if (criada) {
    avisoDeCriacao.value = `«${criada.nome}» cadastrada`
    adminToast(`"${criada.nome}" cadastrada`)
  }
}

async function criarSetorRapido({ nome }, campo) {
  if (criandoPessoa.value) return
  criandoPessoa.value = true
  erroDePessoa.value = ''
  campoDeCriacao.value = campo
  const { error } = await sbClient.rpc('criar_setor_rapido', { p_nome: nome })
  criandoPessoa.value = false
  if (error) { erroDePessoa.value = 'Não consegui cadastrar o setor. Tente de novo.'; return }
  campoDeCriacao.value = ''
  await carregar()
}

// Marca reaproveita a tabela que o Patrimônio já cadastra por aqui — não há
// função nova no banco pra ela.
async function criarMarcaRapida({ nome }, campo) {
  if (criandoPessoa.value) return
  criandoPessoa.value = true
  erroDePessoa.value = ''
  campoDeCriacao.value = campo
  const { error } = await sbClient.from('patrimonio_empresas')
    .insert({ nome, ordem: empresas.value.length + 1 })
  criandoPessoa.value = false
  if (error) { erroDePessoa.value = 'Não consegui cadastrar a marca. Tente de novo.'; return }
  campoDeCriacao.value = ''
  await carregar()
}

// Abrir a caixinha começa uma tentativa nova: o aviso da tentativa anterior
// não pertence a ela.
function limparAvisoDeCriacao() {
  erroDePessoa.value = ''
  avisoDeCriacao.value = ''
  campoDeCriacao.value = ''
}

function fecharFicha() {
  bemAberto.value = null
  passeioBemAberto.value = false
  historico.value = []
  cancelarNovaOpcao()
  // Sem isto, abrir a ficha de OUTRO bem depois de mexer na ligação da Frota
  // reaproveitaria o veículo escolhido ou o mini-formulário de criar — de um
  // bem que não é mais o que está na tela.
  ligandoVeiculoId.value = ''
  criandoVeiculoDoBem.value = false
}

async function carregarHistorico(bemId) {
  const { data } = await sbClient
    .from('patrimonio_posse').select('*').eq('bem_id', bemId).order('de', { ascending: false })
  historico.value = data || []
}

// Preenche o formulário quando a ficha abre (bem existente ou novo).
watch(bemAberto, async (bem) => {
  // Mesmo defensivo de fecharFicha(): a ficha de um bem NUNCA deve carregar
  // o estado de ligação que sobrou da ficha do bem anterior.
  ligandoVeiculoId.value = ''
  criandoVeiculoDoBem.value = false
  if (!bem) return
  if (bem.novo) {
    Object.assign(form, FORM_VAZIO)
    historico.value = []
    return
  }
  Object.assign(form, {
    nome: bem.nome || '',
    numero: bem.numero === null || bem.numero === undefined ? '' : String(bem.numero),
    // A placa vem do CARRO ligado, não de coluna do item — ela não existe em
    // `patrimonio_bens`. Assim editar um item antigo não pede digitação
    // nenhuma: dos 11 itens de veículo, 10 já têm carro.
    placa: (veiculoLigadoAoBem(veiculosFrota.value, bem.id) || {}).placa || '',
    numero_serie: bem.numero_serie || '',
    valor: bem.valor_centavos === null || bem.valor_centavos === undefined ? '' : formatarValor(bem.valor_centavos),
    data_compra: bem.data_compra ? String(bem.data_compra).slice(0, 10) : '',
    empresa_id: bem.empresa_id || '',
    local_id: bem.local_id || '',
    comodo_id: bem.comodo_id || '',
    categoria_id: bem.categoria_id || '',
    tipo_id: bem.tipo_id || '',
    marca: bem.marca || '',
    pessoa_id: bem.pessoa_id || '',
    situacao: bem.situacao || 'em_estoque',
    observacao: bem.observacao || '',
    etiquetado: !!bem.etiquetado,
  })
  await carregarHistorico(bem.id)
})

async function registrarLog(acao, alvo, detalhe) {
  await sbClient.from('patrimonio_log').insert({ acao, alvo, resultado: 'ok', detalhe: detalhe || null })
}

// Toda troca de dono passa por aqui: fecha o registro do dono anterior e abre o
// do novo. A decisão do que gravar é da função pura fecharEAbrirHistorico, que
// já tem teste — aqui só se executa o plano que ela devolve.
async function sincronizarPosse(bemId, novoDonoId) {
  const { data: atual } = await sbClient.from('patrimonio_posse').select('*').eq('bem_id', bemId)
  const pessoa = pessoas.value.find((p) => p.id === novoDonoId)
  const plano = fecharEAbrirHistorico({
    historicoAtual: atual || [],
    novoDonoId: novoDonoId || null,
    novoDonoNome: pessoa ? pessoa.nome : null,
    hoje: hojeLocal(),
  })
  if (plano.aFechar) {
    await sbClient.from('patrimonio_posse').update({ ate: plano.aFechar.ate }).eq('id', plano.aFechar.id)
  }
  // Sem dono novo: só fecha o anterior, não abre registro de "ninguém".
  if (plano.aAbrir && novoDonoId) {
    await sbClient.from('patrimonio_posse').insert({
      bem_id: bemId,
      pessoa_id: plano.aAbrir.pessoa_id,
      pessoa_nome: plano.aAbrir.pessoa_nome,
      de: plano.aAbrir.de,
      ate: null,
    })
  }
}

async function salvarBem() {
  const nome = (form.nome || '').trim()
  if (!nome) { adminToast('Dê um nome ao bem', false); return }
  const numeroTexto = (form.numero || '').trim()
  if (numeroTexto && !/^\d+$/.test(numeroTexto)) {
    adminToast('O nº da etiqueta é só número', false); return
  }
  const valorTexto = (form.valor || '').trim()
  const valorCentavos = valorTexto ? parsearValor(valorTexto) : null
  if (valorTexto && valorCentavos === null) {
    adminToast('Não entendi o valor. Use algo como 1.234,56', false); return
  }

  // A PLACA, quando é veículo. `ehVeiculo` decide se há costura a fazer;
  // `placaObrigatoria` decide se a falta dela BARRA — e ela só barra no
  // cadastro novo. Ver ligacao-com-frota.js: item que já existe fica sem placa
  // sem travar, porque o nº 291 vai ficar assim até o carro dele aparecer.
  const ehVeiculo = exigePlacaNoBem(form, categoriaVeiculoId.value)
  const placa = normalizarPlaca(form.placa)
  if (placaObrigatoria(form, categoriaVeiculoId.value, bemAberto.value.novo) && !placa) {
    adminToast('Item de veículo precisa da placa — é ela que cria o carro na Frota', false)
    return
  }

  salvando.value = true
  const linha = {
    nome,
    numero: numeroTexto ? parseInt(numeroTexto, 10) : null,
    numero_serie: (form.numero_serie || '').trim() || null,
    valor_centavos: valorCentavos,
    data_compra: form.data_compra || null,
    empresa_id: form.empresa_id || null,
    local_id: form.local_id || null,
    comodo_id: form.comodo_id || null,
    categoria_id: form.categoria_id || null,
    tipo_id: form.tipo_id || null,
    marca: (form.marca || '').trim() || null,
    pessoa_id: form.pessoa_id || null,
    // Ligou numa pessoa de verdade: o nome solto da planilha perde a razão de existir.
    dono_texto: form.pessoa_id ? null : (bemAberto.value.dono_texto || null),
    situacao: form.situacao,
    observacao: (form.observacao || '').trim() || null,
    etiquetado: !!form.etiquetado,
    atualizado_em: new Date().toISOString(),
  }

  let bemId = bemAberto.value.novo ? null : bemAberto.value.id
  if (bemId) {
    const { error } = await sbClient.from('patrimonio_bens').update(linha).eq('id', bemId)
    if (error) { adminToast('Erro ao salvar: ' + error.message, false); salvando.value = false; return }
    await registrarLog('bem.editar', 'bem:' + bemId, nome)
  } else {
    const { data, error } = await sbClient.from('patrimonio_bens').insert(linha).select('id').single()
    if (error) { adminToast('Erro ao criar: ' + error.message, false); salvando.value = false; return }
    bemId = data.id
    await registrarLog('bem.criar', 'bem:' + bemId, nome)
  }

  await sincronizarPosse(bemId, form.pessoa_id || null)

  // A VIA DE MÃO DUPLA. Só quando é veículo E há placa: sem placa não há o que
  // costurar, e o item fica esperando (é o caso do nº 291, por decisão do dono).
  // Só depois do item existir, porque a função precisa do `bem_id` gravado.
  let seloDaFrota = null
  if (ehVeiculo && placa) {
    const { data: sinc, error: erroSinc } = await sbClient.rpc('sincronizar_carro_e_bem', {
      p_bem_id: bemId,
      p_placa: placa,
      p_nome: nome,
      p_marca: linha.marca,
      p_valor_centavos: valorCentavos,
    })
    if (erroSinc) {
      // O ITEM JÁ ESTÁ GRAVADO, e a mensagem diz isso na cara. Senão a pessoa
      // cadastra de novo e cria item duplicado — `numero` é UNIQUE, mas nome
      // repetido passa liso, e foi assim que os KWIDs soltos nasceram.
      // A frase do banco já vem em português de leigo (migrations 049/050).
      salvando.value = false
      adminToast('O item foi salvo, mas não consegui criar o carro na Frota: '
        + erroSinc.message, false)
      await carregar()
      return
    }
    seloDaFrota = fraseDaSincronia(sinc)
  }

  salvando.value = false
  fecharFicha()
  // A frase DIZ o que aconteceu do outro lado, em vez de um "Bem salvo" que
  // esconde metade do trabalho que a gravação fez.
  adminToast(seloDaFrota || 'Bem salvo')
  await carregar()
}

// ------------------------------------------------------ números das etiquetas
const teto = ref(TETO_PADRAO)
const salvandoTeto = ref(false)
const numeros = computed(() => mapaDeNumeros(bens.value, teto.value))

async function ampliarNumeracao() {
  salvandoTeto.value = true
  const novo = aumentarTeto(teto.value, 100)
  const { error } = await sbClient.from('patrimonio_config')
    .upsert({ chave: 'numero_maximo', valor: String(novo), atualizado_em: new Date().toISOString() })
  salvandoTeto.value = false
  if (error) { adminToast('Erro ao ampliar: ' + error.message, false); return }
  teto.value = novo
  await registrarLog('numeracao.ampliar', 'até ' + novo, null)
  adminToast(`Numeração vai até ${novo} agora`)
}

// O selo verde: serve pra achar de volta o que acabou de ser cadastrado no meio
// de 341 itens. `agoraNaTela` é fixado na carga em vez de ler o relógio a cada
// render — senão o selo poderia sumir no meio de um scroll.
const agoraNaTela = ref(new Date().toISOString())
const ehNovo = (bem) => ehRecente(bem?.criado_em, agoraNaTela.value, 24)

// -------------------------------------------------------------------- tutorial
const passeioAberto = ref(false)
// Um passeio por modal, pelos campos DAQUELE modal — independente do passeio
// da tela inteira, e independente uns dos outros.
const passeioMassaAberto = ref(false)
const passeioBemAberto = ref(false)
const passeioListasAberto = ref(false)
const ajudaAberta = ref('')            // qual "?" está aberto (vazio = nenhum)
function alternarAjuda(chave) { ajudaAberta.value = ajudaAberta.value === chave ? '' : chave }
function abrirPasseio() { passeioAberto.value = true }
// Fechou o passeio (concluiu ou pulou): não abre mais sozinho. Só o passeio
// DA TELA marca como visto — os passeios de dentro dos modais são sempre por
// pedido (o "?"), nunca abrem sozinhos.
watch(passeioAberto, (aberto) => {
  if (!aberto) marcarComoVisto(typeof localStorage !== 'undefined' ? localStorage : null, estado.user?.id)
})

// -------------------------------------------------- visões: planilha e resumo
const visao = ref('arvore')
const ordem = reactive({ chave: 'numero', crescente: true })
const eixo = ref('categoria')

const EIXOS = [
  { chave: 'categoria', titulo: 'Por categoria' },
  { chave: 'empresa', titulo: 'Por marca' },
  { chave: 'local', titulo: 'Por local' },
  { chave: 'comodo', titulo: 'Por ambiente' },
  { chave: 'dono', titulo: 'Por pessoa' },
  { chave: 'tipo', titulo: 'Por tipo' },
  { chave: 'situacao', titulo: 'Por situação' },
]

// O bem "achatado": os ids viram nomes de uma vez só, e daí saem a tabela da
// planilha, o resumo e o arquivo do Excel — todos lendo a MESMA linha, sem três
// jeitos diferentes de resolver o mesmo id.
const linhasAchatadas = computed(() => {
  const nome = (lista, id) => (id ? (lista.find((x) => x.id === id)?.nome || '') : '')
  return bens.value.map((b) => ({
    id: b.id,
    numero: b.numero,
    numero_serie: b.numero_serie || '',
    nome: b.nome,
    categoria: nome(categorias.value, b.categoria_id),
    tipo: nome(tipos.value, b.tipo_id),
    marca: b.marca || '',
    empresa: nome(empresas.value, b.empresa_id),
    local: nome(locais.value, b.local_id),
    comodo: nome(comodos.value, b.comodo_id),
    // O "Pessoa removida" daqui sai também no arquivo exportado, onde não há
    // aviso de erro nenhum em volta pra desmentir — então ele obedece à mesma
    // trava do cartão e da tabela: com a lista de colaboradores falhando, dizer
    // que a pessoa foi removida é mentir sobre gente que existe.
    // (Bem sem dono nenhum continua saindo com a célula VAZIA na planilha, que
    //  é o que sempre saiu — não é "Sem dono" escrito em 88% das linhas.)
    dono: (b.pessoa_id || b.dono_texto)
      ? textoDoDono(b, pessoasById.value, pessoasErro.value) : '',
    situacao: rotuloDaSituacao(b.situacao),
    etiquetado: b.etiquetado ? 'Sim' : 'Não',
    data_compra: b.data_compra ? formatarDataBR(b.data_compra) : '',
    valor_centavos: b.valor_centavos,
    observacao: b.observacao || '',
    _bem: b,
  }))
})

// A planilha ignora o nível da árvore (é a planilha INTEIRA), mas respeita busca
// e filtros — senão o campo de busca em cima dela não faria nada.
const linhasPlanilha = computed(() => {
  const permitidos = new Set(filtrarBens(bens.value, filtro, textoDeBusca).map((b) => b.id))
  return ordenarPlanilha(
    linhasAchatadas.value.filter((l) => permitidos.has(l.id)), ordem.chave, ordem.crescente)
})
const totalPlanilha = computed(() =>
  linhasPlanilha.value.reduce((a, l) => a + (typeof l.valor_centavos === 'number' ? l.valor_centavos : 0), 0))

function ordenarPor(chave) {
  if (ordem.chave === chave) ordem.crescente = !ordem.crescente
  else { ordem.chave = chave; ordem.crescente = true }
}
function abrirPelaPlanilha(id) {
  const b = bens.value.find((x) => x.id === id)
  if (b) abrirBem(b)
}

// O resumo olha o patrimônio INTEIRO, sem filtro nem caminho: é o retrato geral.
const totais = computed(() => totaisGerais(bens.value))
const ranking = computed(() => resumirPor(linhasAchatadas.value, (l) => l[eixo.value]))

function exportarPlanilha() {
  if (typeof XLSX === 'undefined') { adminToast('Exportador não carregou. Recarregue a página.', false); return }
  const matriz = montarLinhasParaExcel(linhasPlanilha.value)
  const ws = XLSX.utils.aoa_to_sheet(matriz)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Patrimônio')
  XLSX.writeFile(wb, `patrimonio-${hojeLocal()}.xlsx`)
  registrarLog('planilha.exportar', linhasPlanilha.value.length + ' linhas', null)
}

// ------------------------------------------------------- alteração em massa
const modoSelecao = ref(false)
const selecionados = ref(new Set())
const massaAberta = ref(false)
const salvandoMassa = ref(false)
const MASSA_VAZIA = { situacao: '', pessoaId: '', categoriaId: '', empresaId: '', localId: '', comodoId: '' }
const massa = reactive({ ...MASSA_VAZIA })

const resumoSelecao = computed(() => resumoDaSelecao(bens.value, selecionados.value))
const estadoVisivel = computed(() => estadoDaSelecaoVisivel(selecionados.value, bensNaTela.value))
const avisosDaMassa = computed(() =>
  montarAlteracaoEmMassa(massa, { quantidade: resumoSelecao.value.quantidade }).avisos)

const locaisDaMassa = computed(() => locaisDaMarca(massa.empresaId))
const comodosDaMassa = computed(() => comodosDoLocal(massa.localId))
watch(() => massa.empresaId, () => { massa.localId = ''; massa.comodoId = '' })
watch(() => massa.localId, () => { massa.comodoId = '' })

function alternarModoSelecao() {
  modoSelecao.value = !modoSelecao.value
  if (!modoSelecao.value) selecionados.value = new Set()
}

// No modo de seleção, tocar no bem MARCA em vez de abrir a ficha. Dois gestos
// diferentes no mesmo toque confundiriam; o modo deixa claro qual está valendo.
function tocarNoBem(bem) {
  if (!modoSelecao.value) { abrirBem(bem); return }
  const s = new Set(selecionados.value)
  if (s.has(bem.id)) s.delete(bem.id); else s.add(bem.id)
  selecionados.value = s
}

function alternarVisiveis() {
  selecionados.value = alternarTodosVisiveis(
    selecionados.value, bensNaTela.value, estadoVisivel.value !== 'cheio')
}

function abrirEmMassa() {
  Object.assign(massa, MASSA_VAZIA)
  massaAberta.value = true
}

async function salvarEmMassa() {
  const ids = [...selecionados.value]
  const { alteracao } = montarAlteracaoEmMassa(massa, { quantidade: ids.length })
  if (!Object.keys(alteracao).length || !ids.length) return
  salvandoMassa.value = true
  const { error } = await sbClient.from('patrimonio_bens')
    .update({ ...alteracao, atualizado_em: new Date().toISOString() }).in('id', ids)
  if (error) { adminToast('Erro ao alterar: ' + error.message, false); salvandoMassa.value = false; return }

  // Trocou o dono de todo mundo: o histórico de posse tem que acompanhar, senão
  // a base passa a dizer quem tem o quê sem registrar quando mudou.
  if ('pessoa_id' in alteracao) {
    const hoje = hojeLocal()
    await sbClient.from('patrimonio_posse').update({ ate: hoje }).in('bem_id', ids).is('ate', null)
    if (alteracao.pessoa_id) {
      const p = pessoas.value.find((x) => x.id === alteracao.pessoa_id)
      await sbClient.from('patrimonio_posse').insert(ids.map((bemId) => ({
        bem_id: bemId, pessoa_id: p.id, pessoa_nome: p.nome, de: hoje, motivo: 'alteração em massa',
      })))
    }
  }
  await registrarLog('bem.alterar_em_massa', ids.length + ' bens', Object.keys(alteracao).join(', '))
  salvandoMassa.value = false
  massaAberta.value = false
  selecionados.value = new Set()
  modoSelecao.value = false
  adminToast(ids.length + ' itens alterados')
  await carregar()
}

async function apagarEmMassa() {
  const ids = [...selecionados.value]
  if (!ids.length) return
  const total = formatarValor(resumoSelecao.value.totalCentavos)
  if (!(await _confirmar(`Apagar ${ids.length} itens (${total}) do patrimônio. O histórico de posse deles some junto.`))) return
  const { error } = await sbClient.from('patrimonio_bens').delete().in('id', ids)
  if (error) { adminToast('Erro ao apagar: ' + error.message, false); return }
  await registrarLog('bem.apagar_em_massa', ids.length + ' bens', total)
  massaAberta.value = false
  selecionados.value = new Set()
  modoSelecao.value = false
  adminToast(ids.length + ' itens apagados')
  await carregar()
}

// ------------------------------------------------------------ listas editáveis
const listasAbertas = ref(false)
// massaAberta e listasAbertas fecham em VÁRIOS pontos do template e do script
// (cancelar, aplicar com sucesso, apagar com sucesso, clique fora) — um watch
// aqui é mais seguro do que caçar cada `= false` e lembrar de resetar o
// passeio do modal em cada um deles.
watch(massaAberta, (aberto) => { if (!aberto) passeioMassaAberto.value = false })
watch(listasAbertas, (aberto) => { if (!aberto) passeioListasAberto.value = false })
const podeEditar = computed(() => hasPermission('patrimonio', 'editar'))
const novos = reactive({ patrimonio_empresas: '', patrimonio_categorias: '' })
// Um campo de "novo" por PAI: cada marca tem sua caixa de novo local, cada local
// a sua de novo cômodo. Um campo só, compartilhado, escreveria no galho errado.
const novoLocal = reactive({})
const novoComodo = reactive({})

const DEF_MARCAS = { tabela: 'patrimonio_empresas', titulo: 'Marcas', ref: empresas }
const DEF_LOCAIS = { tabela: 'patrimonio_locais', titulo: 'Locais', ref: locais }
const DEF_COMODOS = { tabela: 'patrimonio_comodos', titulo: 'Ambientes', ref: comodos }
const DEF_CATEGORIAS = { tabela: 'patrimonio_categorias', titulo: 'Categorias', ref: categorias }

// Quais galhos da árvore estão abertos. Tudo fechado por padrão: abrir os 12
// locais e 47 cômodos de uma vez é exatamente a bagunça que esta tela resolve.
const galhosAbertos = ref(new Set())
const galhoAberto = (chave) => galhosAbertos.value.has(chave)
function alternarGalho(chave) {
  const s = new Set(galhosAbertos.value)
  if (s.has(chave)) s.delete(chave); else s.add(chave)
  galhosAbertos.value = s
}

// Cria um filho já amarrado no pai (local dentro da marca, cômodo dentro do local).
async function criarFilho(def, vinculo, mapaDeNovos, chaveDoPai) {
  const nome = (mapaDeNovos[chaveDoPai] || '').trim()
  if (!nome) return
  const irmaos = def.ref.value.filter((x) => {
    const [campo, valor] = Object.entries(vinculo)[0]
    return x[campo] === valor
  })
  const { error } = await sbClient.from(def.tabela).insert({ nome, ordem: irmaos.length + 1, ...vinculo })
  if (error) {
    const jaExiste = /duplicate key|unique/i.test(error.message)
    adminToast(jaExiste ? `"${nome}" já existe aqui` : 'Erro: ' + error.message, false)
    return
  }
  mapaDeNovos[chaveDoPai] = ''
  adminToast(`"${nome}" criado`)
  await carregar()
}

async function criarItem(def) {
  const nome = (novos[def.tabela] || '').trim()
  if (!nome) return
  const { error } = await sbClient.from(def.tabela).insert({ nome, ordem: def.ref.value.length + 1 })
  if (error) {
    // unique(nome) violado = a opção já existe. Dizer isso, não vomitar o erro do banco.
    const jaExiste = /duplicate key|unique/i.test(error.message)
    adminToast(jaExiste ? `"${nome}" já está na lista` : 'Erro: ' + error.message, false)
    return
  }
  novos[def.tabela] = ''
  adminToast(`"${nome}" criado`)
  await carregar()
}

async function renomearItem(def, item, novoNome) {
  const nome = (novoNome || '').trim()
  if (!nome || nome === item.nome) return
  const { error } = await sbClient.from(def.tabela).update({ nome }).eq('id', item.id)
  if (error) { adminToast('Erro ao renomear: ' + error.message, false); await carregar(); return }
  await carregar()
}

// Apagar NÃO apaga bem nenhum: as FKs do bem são "on delete set null", então ele
// fica sem aquele campo e continua lá. Mas apagar um galho da ÁRVORE leva os
// filhos junto (cascade) — apagar uma marca apaga os locais dela e os cômodos
// deles. Isso precisa ser dito ANTES, não descoberto depois.
async function apagarItem(def, item) {
  let aviso = null
  if (def.tabela === 'patrimonio_empresas') {
    const filhos = locaisDaMarca(item.id)
    const netos = filhos.reduce((n, l) => n + comodosDoLocal(l.id).length, 0)
    if (filhos.length) aviso = `Apagar "${item.nome}" apaga junto ${filhos.length} local(is) e ${netos} ambiente(s).`
  } else if (def.tabela === 'patrimonio_locais') {
    const filhos = comodosDoLocal(item.id)
    if (filhos.length) aviso = `Apagar "${item.nome}" apaga junto ${filhos.length} ambiente(s).`
  }
  const usados = bens.value.filter((b) =>
    b.empresa_id === item.id || b.local_id === item.id ||
    b.comodo_id === item.id || b.categoria_id === item.id).length
  if (usados > 0) {
    aviso = (aviso ? aviso + ' ' : '') + `${usados} bem(ns) ficam sem esse campo (nenhum é apagado).`
  }
  if (aviso && !(await _confirmar(aviso))) return

  const { error } = await sbClient.from(def.tabela).delete().eq('id', item.id)
  if (error) { adminToast('Erro ao apagar: ' + error.message, false); return }
  await carregar()
}

// Confirmação própria da tela (nada de confirm() nativo). Promessa que resolve
// no clique — o painel fica DENTRO do componente, como o resto.
const confirmacao = ref(null)
function _confirmar(texto) {
  return new Promise((resolve) => {
    confirmacao.value = { texto, resolve }
  })
}
function responderConfirmacao(ok) {
  const c = confirmacao.value
  confirmacao.value = null
  if (c) c.resolve(ok)
}

async function excluirBem() {
  const id = bemAberto.value.id
  const nome = form.nome
  const { error } = await sbClient.from('patrimonio_bens').delete().eq('id', id)
  if (error) { adminToast('Erro ao excluir: ' + error.message, false); return }
  await registrarLog('bem.excluir', 'bem:' + id, nome)
  fecharFicha()
  adminToast('Bem excluído')
  await carregar()
}

async function carregar() {
  carregando.value = true
  erro.value = ''
  const [rBens, rEmp, rLoc, rCom, rCat, rTip, rPes, rSet, rCfg, rFrota] = await Promise.all([
    sbClient.from('patrimonio_bens').select('*').order('numero', { ascending: true, nullsFirst: false }),
    sbClient.from('patrimonio_empresas').select('id,nome').order('ordem').order('nome'),
    sbClient.from('patrimonio_locais').select('id,nome,empresa_id').order('ordem').order('nome'),
    sbClient.from('patrimonio_comodos').select('id,nome,local_id').order('ordem').order('nome'),
    sbClient.from('patrimonio_categorias').select('id,nome,vida_util_anos').order('ordem').order('nome'),
    sbClient.from('patrimonio_tipos').select('id,nome,categoria_id').order('ordem').order('nome'),
    // PORTA ESTREITA (13/08/2026): a leitura direta de `acessos_pessoas` só
    // abre para quem tem Colaboradores e Acessos, e devolvia lista VAZIA para
    // os demais. A função do banco entrega nome/cargo/situação para quem mexe
    // no Patrimônio, sem abrir e-mail nem telefone de ninguém.
    sbClient.rpc('pessoas_para_escolher'),
    sbClient.rpc('setores_para_escolher'),
    sbClient.from('patrimonio_config').select('chave,valor'),
    // A ligação com a Frota (Bronca 2): id/nome/placa/bem_id de cada carro,
    // só o bastante pra saber quem está ligado a qual bem. A tabela é da
    // Frota (RLS `is_frota_admin()`), então quem não tem essa feature recebe
    // lista vazia sem erro nenhum — é por isso que a tela NÃO decide "não
    // ligado" olhando só pra esse resultado; ela pergunta antes, com
    // `temAcessoFrota()`, se faz sentido interpretar o vazio como "nada
    // ligado" ou como "eu não vejo esse dado".
    sbClient.from('frota_veiculos').select('id,nome,placa,bem_id').order('nome'),
  ])
  if (rBens.error) {
    erro.value = rBens.error.message
    carregando.value = false
    return
  }
  bens.value = rBens.data || []
  empresas.value = rEmp.data || []
  locais.value = rLoc.data || []
  comodos.value = rCom.data || []
  categorias.value = rCat.data || []
  tipos.value = rTip.data || []
  // Colaboradores e Frota vêm de módulos vizinhos — os dois pontos em que
  // Patrimônio depende de outra ferramenta. A leitura de pessoas hoje é a RPC
  // `pessoas_para_escolher()`, que ESTOURA em vez de devolver lista vazia
  // quando falta acesso — por isso `pessoasErro` existe e a tela diz o motivo
  // em vez de mostrar o campo vazio calado. A Frota, essa sim, cai no aviso de
  // "sem acesso" (`temAcessoFrota()`), nunca em "nada ligado".
  pessoas.value = mesclarPessoas(rPes.data || [], [])
  setores.value = rSet && !rSet.error ? (rSet.data || []) : []
  veiculosFrota.value = rFrota && !rFrota.error ? (rFrota.data || []) : []
  frotaErro.value = !!(rFrota && rFrota.error)
  // Sem leitura direta de reserva aqui — a RPC falhando é, sozinha, o "eu não
  // vejo essa lista" (ver o comentário do `pessoasErro` lá em cima).
  pessoasErro.value = !!(rPes && rPes.error)
  const cfgTeto = (rCfg.data || []).find((x) => x.chave === 'numero_maximo')
  teto.value = Number(cfgTeto?.valor) || TETO_PADRAO
  agoraNaTela.value = new Date().toISOString()
  carregando.value = false
}

onMounted(() => {
  if (!hasPermission('patrimonio', 'ver')) {
    adminToast('Sem acesso', false)
    router.push({ name: 'inicio' })
    return
  }
  carregar().then(() => {
    // Só depois dos dados na tela: passeio apontando pra botão que ainda não
    // renderizou realça o vazio.
    if (deveAbrirSozinho(typeof localStorage !== 'undefined' ? localStorage : null, estado.user?.id)) {
      passeioAberto.value = true
    }
  })
})

const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'
</script>

<style scoped>
/* Celular-primeiro: o que está fora de media query É o celular.
   A tabela larga só aparece a partir de 1025px. */
/* Fundo TRANSPARENTE: o #bg-shapes (degradê + ícones) fica fixo atrás de tudo
   pra aparecer, e o body já pinta a cor base nos DOIS temas. Pintar cor sólida
   aqui tapava a decoração e ainda deixava uma faixa visível onde a tela
   terminava. */
.tela-patrimonio{min-height:100vh;display:flex;flex-direction:column;background:transparent;width:100%;}

/* Sem reserva de espaço: o avatar é um filho de verdade desta barra agora. */
.tela-patrimonio .pat-topbar .rbv-logo{height:22px;width:auto;flex-shrink:0;}
.tela-patrimonio .pat-topbar{display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);background:var(--surface);position:sticky;top:0;z-index:10;}
.tela-patrimonio .pat-back{font-family:var(--fonte-principal);font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:var(--accent);cursor:pointer;background:none;border:1px solid var(--accent-mid);border-radius:5px;padding:6px 10px;display:flex;align-items:center;gap:5px;white-space:nowrap;touch-action:manipulation;}
.tela-patrimonio .pat-title{font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:600;letter-spacing:2px;text-transform:uppercase;color:var(--text);flex:1;min-width:0;}
/* Contagem e ações na mesma linha: o número puxa pra esquerda, os botões pra
   direita. Antes eram duas faixas empilhadas, comendo altura à toa no celular. */
.tela-patrimonio .pat-linha-topo{display:flex;align-items:center;gap:10px;padding:10px 14px 2px;}
.tela-patrimonio .pat-acoes{display:flex;gap:8px;flex-shrink:0;}
.tela-patrimonio .pat-resumo-onde{font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-patrimonio .pat-ajuda-q{width:16px;height:16px;padding:0;border-radius:50%;border:1px solid var(--border);background:none;color:var(--muted);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;cursor:pointer;vertical-align:1px;}
.tela-patrimonio .pat-ajuda-q:hover{color:var(--accent);border-color:var(--accent);}
/* A explicação nasce colada no campo que a pessoa tocou — antes ela aparecia
   sempre no mesmo lugar, lá no fim do formulário, e quem tocava no "?" do
   número da etiqueta não via nada acontecer. A setinha em cima amarra
   visualmente o texto ao campo de onde ele veio. */
.tela-patrimonio .pat-ajuda-txt{position:relative;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));line-height:1.65;color:var(--text);background:var(--accent-light);border:1px solid var(--accent-mid);border-radius:8px;padding:10px 12px;margin-top:-4px;}
.tela-patrimonio .pat-ajuda-txt::before{content:'';position:absolute;top:-6px;left:16px;width:10px;height:10px;background:var(--accent-light);border-left:1px solid var(--accent-mid);border-top:1px solid var(--accent-mid);transform:rotate(45deg);}
.tela-patrimonio .pat-btn-ajuda{width:24px;height:24px;flex-shrink:0;border-radius:50%;border:1px solid var(--border);background:var(--surface);color:var(--muted);font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:700;cursor:pointer;touch-action:manipulation;}
.tela-patrimonio .pat-btn-ajuda:hover{color:var(--accent);border-color:var(--accent);}
.tela-patrimonio .pat-btn-novo{width:46px;height:46px;flex-shrink:0;border-radius:10px;border:none;background:var(--accent);color:var(--sobre-cor);font-size:max(16px, calc(26px * var(--escala-texto, 1)));line-height:1;cursor:pointer;touch-action:manipulation;}

.tela-patrimonio .pat-resumo{flex:1;min-width:0;display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;font-family:var(--fonte-principal);}
.tela-patrimonio .pat-resumo-qtd{font-size:max(16px, calc(22px * var(--escala-texto, 1)));font-weight:700;color:var(--text);}
.tela-patrimonio .pat-resumo-lab,.tela-patrimonio .pat-resumo-sep{font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}
.tela-patrimonio .pat-resumo-total{font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:600;color:var(--accent);}

.tela-patrimonio .pat-busca-wrap{padding:8px 14px;display:flex;align-items:center;gap:8px;}
/* 44px de lado: e o alvo minimo que um dedo acerta sem errar. */
.tela-patrimonio .pat-btn-camera{flex:0 0 auto;width:44px;height:44px;display:flex;align-items:center;justify-content:center;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);cursor:pointer;touch-action:manipulation;}
.tela-patrimonio .pat-btn-camera:hover{border-color:var(--accent);color:var(--accent);}
.tela-patrimonio .pat-aviso-leitura{margin:0;padding:0 14px 8px;font-family:var(--fonte-principal);font-size:max(9px, calc(12.5px * var(--escala-texto, 1)));line-height:1.5;color:var(--orange,#b26a00);}

/* 16px obrigatório: abaixo disso o iOS dá zoom sozinho ao focar o campo. */
.tela-patrimonio .pat-busca{width:100%;font-size:max(16px, calc(16px * var(--escala-texto, 1)));font-family:var(--fonte-principal);padding:11px 13px;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text);}

.tela-patrimonio .pat-filtros{display:flex;gap:8px;padding:4px 14px 12px;white-space:nowrap;}
.tela-patrimonio .pat-select{font-size:max(16px, calc(16px * var(--escala-texto, 1)));font-family:var(--fonte-principal);padding:9px 11px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);flex-shrink:0;max-width:190px;}
.tela-patrimonio .pat-chip{font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-family:var(--fonte-principal);font-weight:600;padding:9px 14px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);cursor:pointer;flex-shrink:0;touch-action:manipulation;}
.tela-patrimonio .pat-chip.ativo{background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}

.tela-patrimonio .pat-body{flex:1;padding:0 14px 40px;}
.tela-patrimonio.com-barra .pat-body{padding-bottom:100px;}
.tela-patrimonio .pat-aviso{padding:26px 4px;color:var(--muted);font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
.tela-patrimonio .pat-aviso-erro{color:var(--red);}

.tela-patrimonio .pat-vazio{display:flex;flex-direction:column;align-items:center;text-align:center;gap:12px;padding:48px 18px;color:var(--muted);}
.tela-patrimonio .pat-vazio h3{font-family:var(--fonte-principal);font-size:max(16px, calc(16px * var(--escala-texto, 1)));font-weight:600;color:var(--text);}
.tela-patrimonio .pat-vazio p{font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));line-height:1.7;max-width:420px;}

.tela-patrimonio .pat-btn{font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:600;padding:11px 18px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);cursor:pointer;touch-action:manipulation;}
.tela-patrimonio .pat-btn.primario{background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}

/* ---- árvore: trilha e pastas de nível ---- */
.tela-patrimonio .pat-trilha{display:flex;align-items:center;gap:5px;padding:0 14px 8px;white-space:nowrap;}
.tela-patrimonio .pat-trilha-item{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;color:var(--accent);background:none;border:none;padding:4px 2px;cursor:pointer;flex-shrink:0;touch-action:manipulation;}
.tela-patrimonio .pat-trilha-item.atual{color:var(--muted);cursor:default;}
.tela-patrimonio .pat-trilha-sep{color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)));flex-shrink:0;}

.tela-patrimonio .pat-grupos{display:flex;flex-direction:column;gap:8px;}
.tela-patrimonio .pat-grupo{display:flex;align-items:center;gap:10px;width:100%;text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px;cursor:pointer;font-family:var(--fonte-principal);color:var(--text);touch-action:manipulation;}
.tela-patrimonio .pat-grupo:active{border-color:var(--accent);}
.tela-patrimonio .pat-grupo-ico{width:34px;height:34px;flex-shrink:0;border-radius:9px;background:var(--surface2);color:var(--accent);display:flex;align-items:center;justify-content:center;}
.tela-patrimonio .pat-grupo-ico.orfao{color:var(--orange);}
.tela-patrimonio .pat-grupo-nome{flex:1;min-width:0;font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tela-patrimonio .pat-grupo-num{font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);text-align:right;flex-shrink:0;}
.tela-patrimonio .pat-grupo-num em{font-style:normal;display:block;}
.tela-patrimonio .pat-grupo-seta{color:var(--muted);font-size:max(16px, calc(17px * var(--escala-texto, 1)));flex-shrink:0;}

.tela-patrimonio .pat-ver-todos{width:100%;margin-top:10px;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;color:var(--accent);background:none;border:1px dashed var(--border);border-radius:10px;padding:11px;cursor:pointer;touch-action:manipulation;}

/* ---- selecao em massa ---- */
.tela-patrimonio .pat-btn-sel{width:46px;height:46px;flex-shrink:0;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;}
.tela-patrimonio .pat-btn-sel.ativo{background:var(--accent);border-color:var(--accent);color:var(--sobre-cor);}
.tela-patrimonio .pat-selbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:0 0 12px;}
.tela-patrimonio .pat-selbar-info{font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-patrimonio .pat-check-caixa{width:22px;height:22px;flex-shrink:0;border:2px solid var(--border);border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:700;color:#fff;line-height:1;}
.tela-patrimonio .pat-card.marcado{border-color:var(--accent-forte);background:var(--accent-light);}
.tela-patrimonio .pat-card.marcado .pat-check-caixa,
.tela-patrimonio .pat-tabela tbody tr.marcado .pat-check-caixa{background:var(--accent);border-color:var(--accent);}
.tela-patrimonio .pat-tabela tbody tr.marcado{background:var(--accent-light);}
/* A barra fica colada embaixo: e onde o polegar alcanca no celular. */
.tela-patrimonio .pat-massa-barra{position:fixed;left:0;right:0;bottom:0;z-index:40;display:flex;align-items:center;gap:12px;padding:12px 14px calc(12px + env(safe-area-inset-bottom,0px));background:var(--surface);border-top:1px solid var(--border);box-shadow:0 -6px 20px rgba(0,0,0,.10);}
.tela-patrimonio .pat-massa-conta{flex:1;min-width:0;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text);}
.tela-patrimonio .pat-massa-conta em{font-style:normal;color:var(--muted);}
.tela-patrimonio .pat-massa-vazia{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);text-align:center;padding:6px;}

/* ---- visoes: planilha e resumo ---- */
.tela-patrimonio .pat-visoes{display:flex;gap:8px;padding:0 14px 8px;white-space:nowrap;}
.tela-patrimonio .pat-plan-topo{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);padding:2px 0 10px;}
.tela-patrimonio .pat-plan-dica{display:block;font-size:max(9px, calc(11px * var(--escala-texto, 1)));opacity:.8;margin-top:2px;}
/* A planilha ROLA de lado, como planilha rola — 15 colunas nao cabem em tela
   nenhuma, e espremer viraria papa. A rolagem fica no wrap, nunca na pagina. */
.tela-patrimonio .pat-plan-wrap{border:1px solid var(--border);border-radius:10px;background:var(--surface);}
.tela-patrimonio .pat-plan{border-collapse:collapse;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));white-space:nowrap;}
.tela-patrimonio .pat-plan th{position:sticky;top:0;background:var(--surface2);text-align:left;font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.8px;text-transform:uppercase;color:var(--muted);padding:9px 10px;border-bottom:1px solid var(--border);cursor:pointer;user-select:none;}
.tela-patrimonio .pat-plan th.ativa{color:var(--accent);}
.tela-patrimonio .pat-plan th.num,.tela-patrimonio .pat-plan td.num{text-align:right;}
.tela-patrimonio .pat-plan td{padding:8px 10px;border-bottom:1px solid var(--border);color:var(--text);max-width:260px;overflow:hidden;text-overflow:ellipsis;}
.tela-patrimonio .pat-plan tbody tr{cursor:pointer;}
.tela-patrimonio .pat-plan tbody tr:hover{background:var(--surface2);}

.tela-patrimonio .pat-kpis{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:14px;}
.tela-patrimonio .pat-kpi{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px;display:flex;flex-direction:column;gap:3px;font-family:var(--fonte-principal);}
.tela-patrimonio .pat-kpi-lab{font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);}
.tela-patrimonio .pat-kpi-val{font-size:max(16px, calc(21px * var(--escala-texto, 1)));font-weight:700;color:var(--text);}
.tela-patrimonio .pat-kpi-fine{font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}
.tela-patrimonio .pat-eixos{display:flex;gap:8px;padding-bottom:12px;white-space:nowrap;}
.tela-patrimonio .pat-rank{display:flex;flex-direction:column;gap:12px;}
.tela-patrimonio .pat-rank-linha{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:12px 14px;font-family:var(--fonte-principal);}
.tela-patrimonio .pat-rank-topo{display:flex;gap:10px;align-items:baseline;}
.tela-patrimonio .pat-rank-nome{flex:1;min-width:0;font-size:max(9px, calc(14px * var(--escala-texto, 1)));font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tela-patrimonio .pat-rank-val{font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:700;color:var(--accent);white-space:nowrap;}
.tela-patrimonio .pat-rank-barra{height:6px;border-radius:999px;background:var(--surface2);margin:8px 0 6px;overflow:hidden;}
.tela-patrimonio .pat-rank-barra i{display:block;height:100%;background:var(--accent);border-radius:999px;}
.tela-patrimonio .pat-rank-pe{font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);}

/* ---- etiquetas ---- */
.tela-patrimonio .pat-secao-num{font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);margin:18px 0 8px;}
.tela-patrimonio .pat-faixas{display:flex;flex-wrap:wrap;gap:7px;}
.tela-patrimonio .pat-faixa{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));font-weight:600;padding:6px 11px;border-radius:8px;font-variant-numeric:tabular-nums;white-space:nowrap;}
.tela-patrimonio .pat-faixa.livre{background:color-mix(in srgb,var(--green) 12%,var(--surface));color:color-mix(in srgb,var(--green) 75%,var(--text));}
.tela-patrimonio .pat-faixa.usada{background:var(--surface2);color:var(--muted);}
.tela-patrimonio .pat-faixa.fora{background:color-mix(in srgb,var(--orange) 12%,var(--surface));color:color-mix(in srgb,var(--orange) 75%,var(--text));}
.tela-patrimonio .pat-faixa-vazio{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}
/* O botão de ampliar a numeração. Nome PRÓPRIO desde 20/08/2026: ele se
   chamava `.pat-btn-mais`, mesmo nome do botãozinho "+" das listas de
   seleção, definido 76 linhas abaixo com `width:38px`. Mesma força, e a de
   baixo vencia — então "Liberar mais 100 números (até 500)" era desenhado
   dentro de uma caixa de 38 pixels, em TODO dispositivo. */
.tela-patrimonio .pat-btn-ampliar{width:100%;margin-top:20px;}

/* A PLACA, destacada (20/08/2026). Mesmo motivo do nº de patrimônio na Frota:
   é o único campo desta ficha que cria registro na OUTRA ferramenta, e precisa
   parecer diferente dos que só guardam texto. */
.tela-patrimonio .pat-placa-destaque{margin:0 0 14px;padding:12px 14px;border:1px solid var(--accent);border-radius:10px;background:color-mix(in srgb,var(--accent) 6%,var(--surface));}
.tela-patrimonio .pat-placa-destaque .pat-campo{margin:0;}
/* `--accent-forte` e não `--accent`: esta etiqueta fica em cima do próprio tom
   aguado do accent (o fundo do bloco), e o accent puro ali reprova por pouco no
   contraste — o par certo já vem medido no padrão (seção 2). */
.tela-patrimonio .pat-obrigatorio{font-style:normal;font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;text-transform:uppercase;letter-spacing:.4px;color:var(--accent-forte);margin-left:6px;}
.tela-patrimonio .pat-dica{display:block;margin-top:8px;font-family:var(--fonte-principal);font-size:max(9px, calc(11.5px * var(--escala-texto, 1)));line-height:1.5;color:var(--muted);}

/* Selo de recém-cadastrado: verde, pequeno, sem competir com a situação. */
.tela-patrimonio .pat-selo-novo{flex-shrink:0;margin-left:6px;background:var(--green);color:var(--sobre-cor);font-family:var(--fonte-principal);font-size:max(9px, calc(9px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.5px;text-transform:uppercase;padding:2px 7px;border-radius:999px;white-space:nowrap;vertical-align:1px;}

.tela-patrimonio .pat-cards{display:flex;flex-direction:column;gap:10px;}
.tela-patrimonio .pat-card{display:flex;flex-direction:column;gap:6px;width:100%;text-align:left;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px;cursor:pointer;font-family:var(--fonte-principal);color:var(--text);touch-action:manipulation;}
.tela-patrimonio .pat-card:active{border-color:var(--accent);}
.tela-patrimonio .pat-card-topo{display:flex;align-items:center;gap:8px;min-width:0;}
.tela-patrimonio .pat-card-nome{font-size:max(9px, calc(15px * var(--escala-texto, 1)));font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.tela-patrimonio .pat-card-meta{font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);display:flex;gap:5px;}
.tela-patrimonio .pat-card-linha{display:flex;align-items:center;gap:6px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--muted);}

/* nowrap OBRIGATORIO: 'EM MANUTENCAO' em caixa alta com espacamento nao cabe
   na largura que sobra e quebra DENTRO da pilula, virando um bloco alto em vez
   de uma pilula. Quem cede espaco e o nome do bem (que tem ellipsis), nunca o badge. */
.tela-patrimonio .pat-pill{font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:.6px;text-transform:uppercase;padding:4px 9px;border-radius:999px;flex-shrink:0;white-space:nowrap;line-height:1.4;}
.tela-patrimonio .pat-pill-uso{background:color-mix(in srgb,var(--green) 12%,var(--surface));color:color-mix(in srgb,var(--green) 75%,var(--text));}
.tela-patrimonio .pat-pill-estoque{background:color-mix(in srgb,var(--accent) 12%,var(--surface));color:color-mix(in srgb,var(--accent) 75%,var(--text));}
.tela-patrimonio .pat-pill-manutencao{background:color-mix(in srgb,var(--orange) 12%,var(--surface));color:color-mix(in srgb,var(--orange) 75%,var(--text));}
.tela-patrimonio .pat-pill-baixado{background:var(--surface2);color:var(--muted);}
.tela-patrimonio .pat-pill-neutro{background:var(--surface2);color:var(--muted);}

/* A tabela NAO existe no celular. */
.tela-patrimonio .pat-tabela-wrap{display:none;}

/* ---- ficha do bem: painel de baixo pra cima no celular, caixa no desktop ---- */
/* Centralizado e com margem, também no celular. Antes ele nascia colado no
   rodapé, de ponta a ponta — parecia uma gaveta presa na borda em vez de uma
   ficha, e no aparelho grande ficava com meia tela vazia em cima. */
.tela-patrimonio .pat-ficha-fundo{position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:50;display:flex;align-items:center;justify-content:center;padding:16px;touch-action:none;overscroll-behavior:contain;}
/* ---- ficha do bem: painel de baixo pra cima no celular, caixa no desktop ---- */
/* Centralizado e com margem, também no celular. Antes ele nascia colado no
   rodapé, de ponta a ponta — parecia uma gaveta presa na borda em vez de uma
   ficha, e no aparelho grande ficava com meia tela vazia em cima. */
.tela-patrimonio .pat-ficha-fundo > *{overscroll-behavior:contain;touch-action:pan-y;}
.tela-patrimonio .pat-ficha{background:var(--surface);width:100%;max-width:520px;max-height:88vh;display:flex;flex-direction:column;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.28);}
.tela-patrimonio .pat-ficha-topo{display:flex;align-items:center;gap:10px;padding:14px;border-bottom:1px solid var(--border);}
/* 34px aqui, 40px no celular (bloco max-width:640px). Este arquivo é
   desktop-first, então o tamanho do dedo entra na media query — o contrário da
   Frota, que é mobile-first. Ver o comentário lá embaixo. */
.tela-patrimonio .pat-ficha-fechar{width:34px;height:34px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:max(9px, calc(15px * var(--escala-texto, 1)));cursor:pointer;touch-action:manipulation;}
/* flex:1 empurra o "?" de dentro do modal pro canto direito, junto do X —
   sem isto os 3 filhos do topo (fechar, título, ajuda) ficariam agrupados à
   esquerda, com um vão vazio sobrando à direita. */
.tela-patrimonio .pat-ficha-titulo{flex:1;min-width:0;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));font-weight:600;letter-spacing:1.5px;text-transform:uppercase;color:var(--text);overflow-wrap:anywhere;}
/* O corpo rola SÓ na vertical. Um eixo em `auto` promove o outro a `auto` pela
   regra do CSS, e foi assim que este modal ficou arrastável pros lados sem
   ninguém pedir — o dono relatou em 12/08: "o modal na gestão de patrimônio eu
   consigo arrastar para os lados, pelo jeito você corrigiu só em frota".
   Estava certo: a Frota levou o conserto e o Patrimônio ficou pra trás.
   `clip` e não `hidden` pra não quebrar `position:sticky` de nada aqui dentro.
   ⚠️ `overflow-wrap:anywhere` nos filhos de texto é OBRIGATÓRIO junto: sem ele
   o clip corta em silêncio, que é pior que arrastar. Ver `.pat-ajuda` e
   `.pat-dado-val` abaixo. */
.tela-patrimonio .pat-ficha-corpo{flex:1;overflow-y:auto;overflow-x:clip;touch-action:pan-y;overscroll-behavior:contain;padding:14px;display:flex;flex-direction:column;gap:12px;}
.tela-patrimonio .pat-ficha-corpo .pat-dupla > *{min-width:0;}
.tela-patrimonio .pat-ficha-pe{display:flex;gap:8px;justify-content:flex-end;padding:12px 14px;border-top:1px solid var(--border);background:var(--surface);}

.tela-patrimonio .pat-campo{display:flex;flex-direction:column;gap:5px;font-family:var(--fonte-principal);}
.tela-patrimonio .pat-campo > span{font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);}
.tela-patrimonio .pat-campo em{font-style:normal;text-transform:none;letter-spacing:0;font-weight:400;}
/* Sem margem embaixo: o `.pat-campo` já separa rótulo e controle com gap:5px, e
   a margem somava por cima disso — este rótulo ficava a 10px do campo dele e
   todos os outros a 5px. */
.tela-patrimonio .pat-campo-titulo{display:block;}
.tela-patrimonio .pat-campo input,.tela-patrimonio .pat-campo select,.tela-patrimonio .pat-campo textarea{font-size:max(16px, calc(16px * var(--escala-texto, 1)));font-family:var(--fonte-principal);padding:11px 12px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);width:100%;}
.tela-patrimonio .pat-campo select:disabled{opacity:.5;}
.tela-patrimonio .pat-campo-par{display:grid;grid-template-columns:1fr 1fr;gap:10px;overflow-wrap:anywhere;}

/* ---- "+" nos campos de lista do formulário do bem ---- */
/* min-width:0 no select é o que deixa ele encolher dentro do grid de 2
   colunas em vez de estourar a largura do celular — sem isso o botão "+"
   era empurrado pra fora da tela em nomes compridos. */
.tela-patrimonio .pat-campo-mais{display:flex;gap:6px;align-items:stretch;}
.tela-patrimonio .pat-campo-mais select{min-width:0;flex:1;}
.tela-patrimonio .pat-btn-mais{flex-shrink:0;width:38px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--accent);font-size:max(16px, calc(19px * var(--escala-texto, 1)));line-height:1;cursor:pointer;touch-action:manipulation;}
.tela-patrimonio .pat-btn-mais:hover:not(:disabled){border-color:var(--accent);}
/* Desabilitado = o pai ainda não foi escolhido. O select ao lado já diz qual
   ("escolha a marca antes"); aqui só reduz a chance de o dedo tocar à toa. */
.tela-patrimonio .pat-btn-mais:disabled{opacity:.4;cursor:not-allowed;}
/* Caixinha de criar: mesmo visual de .pat-lista-novo (Listas), pra não
   inventar um segundo jeito de "digitar e criar" na mesma tela. */
.tela-patrimonio .pat-nova-opcao{display:flex;gap:7px;align-items:center;margin-top:-4px;}
.tela-patrimonio .pat-nova-opcao input{flex:1;min-width:0;font-size:max(16px, calc(16px * var(--escala-texto, 1)));font-family:var(--fonte-principal);padding:9px 11px;border:1px solid var(--accent-mid);border-radius:8px;background:var(--surface);color:var(--text);}
.tela-patrimonio .pat-nova-opcao .pat-btn{flex-shrink:0;padding:9px 12px;font-size:max(9px, calc(12px * var(--escala-texto, 1)));}
.tela-patrimonio .pat-check{display:flex;align-items:center;gap:9px;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text);}
.tela-patrimonio .pat-check input{width:19px;height:19px;}
.tela-patrimonio .pat-nota{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));line-height:1.6;color:var(--text);background:color-mix(in srgb,var(--orange) 10%,var(--surface));border-radius:8px;padding:10px 12px;}
.tela-patrimonio .pat-btn.perigo{border-color:color-mix(in srgb,var(--red) 40%,var(--surface));color:var(--red);}

.tela-patrimonio .pat-hist{border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:7px;}
.tela-patrimonio .pat-hist h4{font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);}
.tela-patrimonio .pat-hist-vazio{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));line-height:1.6;color:var(--muted);}
.tela-patrimonio .pat-hist-linha{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));color:var(--text);padding:7px 10px;background:var(--surface2);border-radius:7px;}

/* Situação na Frota (Bronca 2): mesma moldura visual do Histórico de posse
   logo abaixo, pra ler como parte do mesmo tipo de bloco — "extra que só
   aparece quando faz sentido", não um formulário novo. Cor sempre por
   token: nada chumbado, porque a tela tem modo escuro. */
.tela-patrimonio .pat-frota{border-top:1px solid var(--border);padding-top:12px;display:flex;flex-direction:column;gap:9px;}
.tela-patrimonio .pat-frota h4{font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);}
.tela-patrimonio .pat-frota-aviso{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));line-height:1.6;color:var(--orange);background:var(--surface2);border-radius:8px;padding:10px 12px;}
.tela-patrimonio .pat-frota-estado{display:flex;flex-direction:column;gap:9px;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));color:var(--text);}
.tela-patrimonio .pat-frota-estado>.pat-btn{align-self:flex-start;}
.tela-patrimonio .pat-frota-sem-permissao{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));line-height:1.6;color:var(--muted);}
.tela-patrimonio .pat-frota-ligar{display:flex;flex-direction:column;gap:9px;}
.tela-patrimonio .pat-frota-criar{display:flex;flex-direction:column;gap:10px;}
.tela-patrimonio .pat-frota-criar-acoes{display:flex;gap:8px;justify-content:flex-end;}

/* ---- listas editáveis ---- */
.tela-patrimonio .pat-btn-listas{width:46px;height:46px;flex-shrink:0;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:manipulation;}
.tela-patrimonio .pat-listas-ajuda{font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));line-height:1.6;color:var(--muted);}
/* O texto fixo do topo de cada modal (pedido do dono, nos 9 modais da Frota e
   do Patrimônio — mesma classe que fr-tutorial-fixo na Frota, com o prefixo
   desta tela). Curto de propósito: fundo sutil por color-mix, nunca hex, pra
   ler certo nos dois temas sem precisar de uma cor "clara" e uma "escura". */
.tela-patrimonio .pat-tutorial-fixo{margin:0;padding:10px 12px;font-family:var(--fonte-principal);font-size:max(9px, calc(12px * var(--escala-texto, 1)));line-height:1.6;color:var(--text);background:color-mix(in srgb,var(--accent) 8%,var(--surface));border:1px solid color-mix(in srgb,var(--accent) 22%,var(--surface));border-radius:10px;}
.tela-patrimonio .pat-lista-bloco{display:flex;flex-direction:column;gap:7px;border-top:1px solid var(--border);padding-top:12px;}
.tela-patrimonio .pat-lista-bloco h4{font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--muted);}
.tela-patrimonio .pat-lista-item,.tela-patrimonio .pat-lista-novo{display:flex;gap:7px;align-items:center;}
.tela-patrimonio .pat-lista-nome{flex:1;min-width:0;font-size:max(16px, calc(16px * var(--escala-texto, 1)));font-family:var(--fonte-principal);padding:9px 11px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);}
.tela-patrimonio .pat-lista-del{width:36px;height:36px;flex-shrink:0;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--red);cursor:pointer;touch-action:manipulation;}

/* ---- árvore de cadastro (Listas) ---- */
.tela-patrimonio .pat-arv{display:flex;flex-direction:column;}
.tela-patrimonio .pat-arv-linha{display:flex;gap:6px;align-items:center;padding:3px 0;}
/* O recuo é o que faz a hierarquia ser LIDA sem precisar explicar. */
.tela-patrimonio .pat-arv-linha.nivel2{padding-left:10px;}
.tela-patrimonio .pat-arv-linha.nivel3{padding-left:20px;}
/* Linha sem botao de abrir reserva a MESMA largura dele. Sem isso o nivel 3
   (que nao abre nada) volta pra esquerda e empata com o nivel 2 — a
   hierarquia deixa de ser legivel pelo recuo, que e todo o proposito. */
.tela-patrimonio .pat-arv-vaga{width:26px;flex-shrink:0;}
.tela-patrimonio .pat-arv-linha.nivel1 .pat-lista-nome{font-weight:600;}
.tela-patrimonio .pat-arv-abrir{width:26px;height:34px;flex-shrink:0;border:none;background:none;color:var(--muted);font-size:max(9px, calc(12px * var(--escala-texto, 1)));cursor:pointer;touch-action:manipulation;}
.tela-patrimonio .pat-arv-filhos{border-left:2px solid var(--border);margin-left:12px;padding-left:2px;}
.tela-patrimonio .pat-arv-vazio{font-family:var(--fonte-principal);font-size:max(9px, calc(11px * var(--escala-texto, 1)));color:var(--muted);padding:5px 0 5px 16px;}

/* ---- confirmação ---- */
.tela-patrimonio .pat-confirm-fundo{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:60;display:flex;align-items:center;justify-content:center;padding:18px;touch-action:none;overscroll-behavior:contain;}
/* ---- confirmação ---- */
.tela-patrimonio .pat-confirm-fundo > *{overscroll-behavior:contain;touch-action:pan-y;}
.tela-patrimonio .pat-confirm{background:var(--surface);border-radius:14px;padding:18px;max-width:400px;width:100%;font-family:var(--fonte-principal);display:flex;flex-direction:column;gap:10px;}
.tela-patrimonio .pat-confirm p{font-size:max(9px, calc(13px * var(--escala-texto, 1)));line-height:1.6;color:var(--text);}
.tela-patrimonio .pat-confirm-pergunta{font-weight:600;}
.tela-patrimonio .pat-confirm-pe{display:flex;gap:8px;justify-content:flex-end;margin-top:4px;}

/* CELULAR: tudo um degrau menor pra caber na largura, sem apertar o alvo do
   dedo abaixo de ~34px. Os selects em 16px continuam (senão o iOS dá zoom no
   foco) — o que encolhe é o padding e a largura máxima, não a fonte. */
@media(max-width:640px){
  .tela-patrimonio .pat-topbar{padding:9px 12px;}
  /* 40px de alvo no celular, como manda o PADRÃO ("dedo não acerta menos que
     isso"). Fica só no celular porque no computador o ponteiro acerta 24px de
     sobra, e o "?" divide a linha com o ✕ — 40px lá deixaria os dois quase
     encostados. Mesma decisão do fr-btn-ajuda na Frota. */
  .tela-patrimonio .pat-btn-ajuda{width:40px;height:40px;font-size:max(9px, calc(14px * var(--escala-texto, 1)));}
  /* O ✕ dos 3 modais, pela mesma regra: o PADRÃO pede "botão de fechar com 40px
     de alvo", e ele estava em 34px. Fica só no celular — 40px é a medida do
     DEDO; no computador o ponteiro acerta 34px de sobra, e o topo do modal é
     apertado (aqui o ✕ mora à esquerda do título, não junto do "?", então o
     motivo é o do ponteiro, não o de encostar um no outro).
     ⚠️ padrao-da-central.test.mjs NÃO pega isto (ele lê `style=` inline, e a
     medida está em classe). Medido no navegador: 40 a 375px e a 640px, 34 a
     partir de 641px. */
  .tela-patrimonio .pat-ficha-fechar{width:40px;height:40px;}
  /* No celular a logo SAI. Nao e o tamanho dela: e a largura. O titulo desta
     barra e o caminho onde voce esta ("Vessel Conchal > Fabrica > Escritorio"),
     e com a logo ocupando a linha ele quebrava em duas — a barra ia de 49 pra
     64px. Entre ver a marca e ver onde voce esta, numa ferramenta que se usa
     em pe andando pelo predio, ganha saber onde voce esta. No tablet e no
     computador a logo aparece normal. (A Gestao a Vista ja faz o mesmo.) */
  .tela-patrimonio .pat-topbar .rbv-logo{display:none;}
  .tela-patrimonio .pat-back{font-size:max(9px, calc(9px * var(--escala-texto, 1)));letter-spacing:1px;padding:5px 8px;}
  .tela-patrimonio .pat-title{font-size:max(9px, calc(12px * var(--escala-texto, 1)));letter-spacing:1.2px;}
  /* No celular eles ficam MAIORES, nao menores: e onde se usa a ferramenta
     em pe, andando pelo predio, com uma mao so. Antes encolhiam pra 34px —
     bem abaixo dos 44px que o dedo acerta sem errar. */
  .tela-patrimonio .pat-btn-novo,.tela-patrimonio .pat-btn-listas,.tela-patrimonio .pat-btn-sel{width:48px;height:48px;}
  .tela-patrimonio .pat-btn-novo{font-size:max(16px, calc(28px * var(--escala-texto, 1)));}
  .tela-patrimonio .pat-linha-topo{padding:9px 12px 2px;gap:8px;}
  .tela-patrimonio .pat-resumo-qtd{font-size:max(16px, calc(19px * var(--escala-texto, 1)));}
  .tela-patrimonio .pat-busca-wrap,.tela-patrimonio .pat-filtros,.tela-patrimonio .pat-visoes{padding-left:12px;padding-right:12px;}
  .tela-patrimonio .pat-busca{padding:9px 11px;}
  /* Dois filtros, largura toda, lado a lado. Antes eram estreitos (max-width)
     numa faixa rolável — sobrava borda vazia dos dois lados da tela. */
  .tela-patrimonio .pat-filtros{display:grid;grid-template-columns:1fr 1fr;gap:8px;overflow:visible;}
  .tela-patrimonio .pat-select{padding:8px 9px;max-width:none;width:100%;}
  /* "Limpar" só aparece com filtro ativo; quando aparece, pega a linha inteira. */
  .tela-patrimonio .pat-filtros .pat-chip{grid-column:1 / -1;}
  .tela-patrimonio .pat-chip{padding:7px 11px;font-size:max(9px, calc(11px * var(--escala-texto, 1)));}
  .tela-patrimonio .pat-body{padding:0 12px 40px;}
}

@media(min-width:1025px){
  .tela-patrimonio .pat-kpis{grid-template-columns:repeat(3,1fr);}
  .tela-patrimonio .pat-visoes{padding-left:24px;padding-right:24px;}
  .tela-patrimonio .pat-topbar{padding:13px 24px;}
  .tela-patrimonio .pat-linha-topo,.tela-patrimonio .pat-busca-wrap,.tela-patrimonio .pat-filtros{padding-left:24px;padding-right:24px;}
  .tela-patrimonio .pat-body{padding:0 24px 48px;}
  .tela-patrimonio .pat-cards{display:none;}
  .tela-patrimonio .pat-tabela-wrap{display:block;}
  .tela-patrimonio .pat-tabela{width:100%;border-collapse:collapse;font-family:var(--fonte-principal);font-size:max(9px, calc(13px * var(--escala-texto, 1)));}
  .tela-patrimonio .pat-tabela th{text-align:left;font-size:max(9px, calc(10px * var(--escala-texto, 1)));font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--muted);padding:10px 12px;border-bottom:1px solid var(--border);white-space:nowrap;}
  .tela-patrimonio .pat-tabela td{padding:11px 12px;border-bottom:1px solid var(--border);color:var(--text);}
  .tela-patrimonio .pat-tabela tbody tr{cursor:pointer;}
  .tela-patrimonio .pat-tabela tbody tr:hover{background:var(--surface2);}
  .tela-patrimonio .pat-dir{text-align:right;}
  .tela-patrimonio .pat-ficha{max-width:560px;}
}
</style>
