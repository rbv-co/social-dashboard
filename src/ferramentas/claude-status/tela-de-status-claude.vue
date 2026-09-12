<template>
  <!-- Painel de Status da IA: mission control em linguagem simples (pra quem não é
       técnico). Robôs de IA em produção (custo/tempo/volume reais de ia_execucoes) +
       status dos projetos (projetos_status, derivado dos planos). Classes .csc- para não
       colidir com o CSS global. Full-bleed e responsivo. -->
  <div class="csc-tela">
    <barra-de-topo voltar="Central" titulo="Status da IA" @voltar="voltar">
      <template #acoes>
        <span class="csc-live"><i></i>Ao vivo</span>
        <span class="csc-upd">{{ statusCarga }}</span>
      </template>
    </barra-de-topo>

    <div class="csc-body">
      <!-- Abas: Visão geral | Extrato de gastos -->
      <div class="csc-tabs">
        <button :class="{ on: aba === 'visao' }" @click="aba = 'visao'">Visão geral</button>
        <button :class="{ on: aba === 'extrato' }" @click="aba = 'extrato'">Extrato de gastos</button>
      </div>

      <div v-show="aba === 'visao'" class="csc-wrap">
      <!-- HERO: resumo do mês em uma frase + total gasto -->
      <section class="csc-hero">
        <div class="csc-hero-txt">
          <span class="csc-hero-eyebrow">Central de robôs de inteligência artificial</span>
          <h1 class="csc-hero-h1">O que a IA fez por você</h1>
          <p class="csc-hero-p">
            Nos últimos 30 dias, os robôs fizeram <b>{{ kpis.acoes }} tarefas</b>,
            produziram <b>{{ fmtNum(kpis.itens) }} itens</b> (criativos, anúncios, relatórios…)
            e trabalharam por <b>{{ fmtDur(kpis.tempoMs) }}</b> no total.
          </p>
        </div>
        <div class="csc-hero-gasto">
          <span class="csc-hero-gasto-lbl">Gasto real de IA · últimos 30 dias</span>
          <span v-if="carregandoAlgumRealMes" class="csc-hero-gasto-val csc-carregando">…</span>
          <span v-else-if="totalRealMes.total !== null" class="csc-hero-gasto-val">{{ fmtBRL(totalRealMes.total) }}</span>
          <span v-else class="csc-hero-gasto-val csc-hero-gasto-indisp">indisponível</span>
          <span v-if="!carregandoAlgumRealMes && totalRealMes.total !== null && !totalRealMes.completo" class="csc-hero-gasto-parcial">total <b>parcial</b>: falta a conta {{ totalRealMes.faltando.length === 1 ? 'da' : 'de' }} <b>{{ totalRealMes.faltando.join(' e ') }}</b>, então o de verdade é maior que este.</span>
          <span v-if="!carregandoAlgumRealMes" class="csc-hero-gasto-quebra">
            <span class="csc-hero-forn"><i>Anthropic</i>{{ gastoRealMes ? fmtBRL(gastoRealMes.totalBrl) : 'indisponível' }}</span>
            <span class="csc-hero-forn"><i>OpenAI</i>{{ gastoOaMes ? fmtBRL(gastoOaMes.totalBrl) : 'indisponível' }}</span>
          </span>
          <span v-if="!carregandoAlgumRealMes && totalRealMes.total !== null" class="csc-hero-gasto-sub">valor de verdade cobrado pelas duas — inclui <b>tudo</b>: os robôs, as imagens da Fábrica, as buscas na web e as sessões de desenvolvimento com IA.</span>
          <span v-if="(gastoRealMesErro || gastoOaMesErro) && !carregandoAlgumRealMes" class="csc-hero-gasto-erro">Não consegui puxar {{ gastoRealMesErro && gastoOaMesErro ? 'nenhuma das duas contas' : (gastoRealMesErro ? 'a conta da Anthropic' : 'a conta da OpenAI') }} agora. Tente recarregar a página em instantes.</span>
          <span class="csc-hero-gasto-est">Estimativa só dos robôs deste painel: <b>{{ fmtBRL(kpis.usdMes * CAMBIO) }}</b>. O número real acima costuma ser maior porque inclui muito mais que os robôs.<template v-if="kpis.semCustoMes"> E <b>{{ kpis.semCustoMes }}</b> {{ kpis.semCustoMes === 1 ? 'execução ficou' : 'execuções ficaram' }} de fora desta estimativa: {{ kpis.semCustoMes === 1 ? 'ela usou' : 'elas usaram' }} a API paga da OpenAI: o custo <b>de cada uma</b> segue desconhecido, mas o <b>total</b> cobrado pela OpenAI já está contado no número acima.</template></span>
        </div>
      </section>

      <!-- LEGENDA: o que é "custo zero" -->
      <div class="csc-legenda">
        <span class="csc-tag csc-tag-zero">Custo zero</span>
        <p><b>Sobem anúncios</b> não usa API paga nenhuma: custa <b>R$ 0</b> de verdade. Os <b>textos</b> (relatórios, análises, resumos) usam a API paga da Anthropic e têm custo em reais.</p>
          <p><b>Criar imagens usa a API paga da OpenAI</b> (gpt-image-2) e <b>tem custo</b> — até 18/08/2026 esta tela dizia que era R$ 0, e estava errada. Desde então o <b>total cobrado pela OpenAI</b> aparece aqui, ao lado do da Anthropic. O que ainda não dá para saber é <b>quanto custou cada tarefa</b> separadamente: por isso elas continuam marcadas como <b>“custo ainda não conhecido”</b> no extrato detalhado, e <b>nunca</b> voltam a aparecer como R$ 0.</p>
      </div>

      <!-- SAÚDE DOS ROBÔS: só aparece quando há problema.
           Fica ANTES de tudo de propósito. Um alarme no rodapé não é alarme —
           e a razão de esta seção existir é que a falha era invisível: o painel
           do cron marca "succeeded" mesmo quando a função devolve erro. -->
      <section v-if="robosComProblema.length" class="csc-alerta">
        <h2 class="csc-alerta-t">⚠ Robô sem rodar direito</h2>
        <div v-for="r in robosComProblema" :key="r.robo" class="csc-alerta-item">
          <div class="csc-alerta-cab">
            <b>{{ r.robo }}</b>
            <span class="csc-alerta-selo" :class="{ critico: r.critico }">
              {{ r.critico ? 'crítico' : 'atenção' }}
            </span>
          </div>
          <p class="csc-alerta-txt">
            <template v-if="r.ultimo_sucesso">
              A última vez que funcionou foi {{ tempoRel(r.ultimo_sucesso) }}.
            </template>
            <template v-else>Nunca funcionou desde que passamos a medir.</template>
            <template v-if="r.falhas_24h"> Falhou {{ r.falhas_24h }}× nas últimas 24 horas.</template>
          </p>
          <!-- Um robô como o coletar-dados roda para 8 perfis, 4 vezes por dia.
               Dizer só "coletar-dados parou" manda procurar agulha em 32 rodadas
               — quando o banco já sabe exatamente qual delas travou. -->
          <p v-if="r.quem_falhou && r.quem_falhou.length" class="csc-alerta-txt">
            Parou {{ r.quem_falhou.length === 1 ? 'em' : 'em' }}
            <b>{{ r.quem_falhou.join(', ') }}</b>{{ r.variantes_vivas > r.quem_falhou.length
              ? ' — as outras ' + (r.variantes_vivas - r.quem_falhou.length) + ' rodadas deste robô estão em dia.'
              : '.' }}
          </p>
          <p class="csc-alerta-porque">{{ r.porque }}</p>
        </div>
      </section>

      <!-- ROBÔS -->
      <div class="csc-sec">
        <h2 class="csc-sec-t">Os robôs de IA</h2>
        <p class="csc-sec-d">Programas que trabalham sozinhos pra você. Aqui está o que cada um fez por último.</p>
      </div>
      <div class="csc-robos">
        <article v-for="r in robosView" :key="r.slug" class="csc-robo" :class="'st-' + (r.ult ? r.ult.status : 'idle')">
          <header class="csc-robo-head">
            <span class="csc-robo-dot"></span>
            <div>
              <h3 class="csc-robo-nome">{{ r.label }}</h3>
              <p class="csc-robo-faz">{{ r.faz }}</p>
            </div>
          </header>
          <div v-if="r.ult" class="csc-robo-corpo">
            <p class="csc-robo-frase"><b>{{ r.verbo }} {{ fmtNum(r.ult.itens) }} {{ unid(r.ult.itens, r.ult.unidade) }}</b><span v-if="r.ult.status==='erro'"> — mas deu erro</span>.</p>
            <ul class="csc-robo-detalhes">
              <li><span class="csc-di-lbl">Última vez</span><span class="csc-di-val">{{ tempoRel(r.ult.run_at) }}</span></li>
              <li v-if="r.ult.duracao_ms"><span class="csc-di-lbl">Tempo que levou</span><span class="csc-di-val">{{ fmtDur(r.ult.duracao_ms) }}</span></li>
              <li><span class="csc-di-lbl">Custo</span><span class="csc-di-val" :class="{ 'csc-zero': ehZeroDeVerdade(r.ult.usd) }">{{ custoFrase(r.ult.usd) }}</span></li>
            </ul>
          </div>
          <div v-else class="csc-robo-corpo csc-robo-vazio">Ainda não rodou nenhuma vez.</div>
          <footer class="csc-robo-foot">Roda: {{ r.quando }}</footer>
        </article>
      </div>

      <faixa-de-erro :erro="erroCarregar" @tentar-de-novo="carregar" />

      <!-- LINHA DO TEMPO -->
      <div class="csc-sec">
        <h2 class="csc-sec-t">Linha do tempo</h2>
        <p class="csc-sec-d">Tudo que os robôs fizeram recentemente, do mais novo para o mais antigo.</p>
      </div>
      <div class="csc-feed">
        <div v-for="(e, i) in feed" :key="e.id || i" class="csc-fi" :class="'st-' + e.status">
          <span class="csc-fi-dot"></span>
          <div class="csc-fi-main">
            <p class="csc-fi-frase"><b>{{ nomeRobo(e.robo) }}</b> {{ fraseAcao(e) }}</p>
            <p class="csc-fi-det">
              <span v-if="e.duracao_ms">Levou {{ fmtDur(e.duracao_ms) }}.</span>
              <span :class="{ 'csc-zero': ehZeroDeVerdade(e.usd) }">{{ custoFrase(e.usd) }}</span>
            </p>
          </div>
          <span class="csc-fi-quando">{{ tempoRel(e.run_at) }}</span>
        </div>
        <div v-if="!feed.length" class="csc-fi-vazio">Nenhuma tarefa registrada ainda. Quando um robô rodar, aparece aqui.</div>
      </div>
      </div><!-- fim aba visão geral -->

      <!-- ABA: EXTRATO DE GASTOS -->
      <div v-show="aba === 'extrato'" class="csc-wrap">
        <div class="csc-ex-head">
          <div>
            <h2 class="csc-sec-t">Extrato de gastos</h2>
            <p class="csc-sec-d">Quanto a IA custou, por período e por área. Só as tarefas que usam a API paga têm valor; as de "custo zero" entram como R$ 0.</p>
          </div>
          <div class="csc-periodo">
            <button v-for="op in periodos" :key="op.d" :class="{ on: periodo === op.d }" @click="periodo = op.d">{{ op.label }}</button>
          </div>
        </div>

        <!-- GASTO REAL: o número que realmente importa — as DUAS faturas, e o total.
             Cada fornecedor tem a sua própria chamada de rede: uma pode falhar sem a
             outra. Por isso cada card diz o seu próprio estado, e o total lá em cima
             se declara PARCIAL quando falta alguém, em vez de encolher calado. -->
        <div class="csc-real">
          <div class="csc-real-main">
            <span class="csc-real-lbl">Gasto real de IA · {{ periodoLabel }}</span>
            <span v-if="carregandoAlgumReal" class="csc-real-val csc-carregando">…</span>
            <span v-else-if="totalRealPeriodo.total !== null" class="csc-real-val">{{ fmtBRL(totalRealPeriodo.total) }}</span>
            <span v-else class="csc-real-val csc-real-indisp">indisponível</span>
            <span v-if="!carregandoAlgumReal && totalRealPeriodo.total !== null && !totalRealPeriodo.completo" class="csc-real-parcial">Total <b>parcial</b>: falta a conta {{ totalRealPeriodo.faltando.length === 1 ? 'da' : 'de' }} <b>{{ totalRealPeriodo.faltando.join(' e ') }}</b> — o valor de verdade é maior que este.</span>
          </div>

          <div class="csc-real-cards">
            <div class="csc-real-card">
              <span class="csc-real-card-lbl">Anthropic</span>
              <span v-if="gastoRealCarregando" class="csc-real-card-val csc-carregando">…</span>
              <span v-else-if="gastoReal" class="csc-real-card-val">{{ fmtBRL(gastoReal.totalBrl) }}</span>
              <span v-else class="csc-real-card-val csc-real-indisp">indisponível</span>
              <span v-if="gastoReal && !gastoRealCarregando" class="csc-real-sub">{{ fmtUsd(gastoReal.totalUsd) }} · de {{ fmtDataCurta(gastoReal.desde) }} a {{ fmtDataCurta(gastoReal.ate) }}</span>
              <span class="csc-real-card-oq">textos, análises e as sessões de desenvolvimento com IA</span>
            </div>
            <div class="csc-real-card">
              <span class="csc-real-card-lbl">OpenAI</span>
              <span v-if="gastoOaCarregando" class="csc-real-card-val csc-carregando">…</span>
              <span v-else-if="gastoOa" class="csc-real-card-val">{{ fmtBRL(gastoOa.totalBrl) }}</span>
              <span v-else class="csc-real-card-val csc-real-indisp">indisponível</span>
              <span v-if="gastoOa && !gastoOaCarregando" class="csc-real-sub">{{ fmtUsd(gastoOa.totalUsd) }} · de {{ fmtDataCurta(gastoOa.desde) }} a {{ fmtDataCurta(gastoOa.ate) }}</span>
              <span class="csc-real-card-oq">as imagens da Fábrica de Anúncios (gpt-image-2)</span>
            </div>
          </div>

          <p class="csc-real-exp">Este é o <b>valor de verdade</b> que os dois fornecedores cobraram no período. Inclui <b>tudo</b>: os robôs deste painel, os criativos que a Fábrica gerou, as buscas na web, o cache e, principalmente, as <b>sessões de desenvolvimento com IA</b> (quando alguém programa junto com o Claude). Por isso costuma ser bem maior que a estimativa dos robôs logo abaixo.</p>
          <p v-if="(gastoRealErro || gastoOaErro) && !carregandoAlgumReal" class="csc-real-erro-box">Não consegui puxar {{ gastoRealErro && gastoOaErro ? 'nenhuma das duas contas' : (gastoRealErro ? 'a conta da Anthropic' : 'a conta da OpenAI') }} agora — tente recarregar em instantes. O total acima está <b>incompleto</b>, e os números abaixo são só a <b>estimativa dos robôs</b>.</p>
        </div>

        <!-- DETALHAMENTO 1 — "Para onde o dinheiro foi" (por categoria): é o valor REAL
             cobrado pela Anthropic, quebrado por modelo e tipo de uso. Mesmo período do
             gasto real acima. Se a função devolver a lista vazia, mostramos "indisponível"
             — nunca inventamos um valor. -->
        <div class="csc-det">
          <div class="csc-det-head">
            <h2 class="csc-sec-t">Para onde o dinheiro foi · Anthropic</h2>
            <span class="csc-det-selo csc-det-selo-real">valor real</span>
          </div>
          <p class="csc-sec-d">É o valor <b>real</b> cobrado pela Anthropic, quebrado por modelo e tipo de uso (texto que entra, resposta que sai, cache…). A Anthropic não detalha chamada por chamada — <b>isto é o mais fino que existe</b>.</p>
          <div v-if="gastoRealCarregando" class="csc-det-vazio">Carregando…</div>
          <div v-else-if="detCategoria.length" class="csc-det-lista">
            <div v-for="(c, i) in detCategoria" :key="'cat' + i" class="csc-det-linha">
              <span class="csc-det-nome">{{ traduzCategoria(c.item) }}</span>
              <span class="csc-det-val">{{ fmtBRL(Number(c.usd) * CAMBIO) }}</span>
            </div>
          </div>
          <div v-else class="csc-det-vazio">Detalhamento por categoria indisponível agora.</div>
        </div>

        <!-- DETALHAMENTO 2 — "Quem gastou" (por robô): a Anthropic NÃO cobra separado por
             robô. Este valor é o custo real RATEADO pelo uso de cada chave — estimativa de
             atribuição, não fatura por robô. Deixamos isso explícito, sem esconder. -->
        <div class="csc-det">
          <div class="csc-det-head">
            <h2 class="csc-sec-t">Quem gastou · Anthropic</h2>
            <span class="csc-det-selo csc-det-selo-rateado">rateado por uso</span>
          </div>
          <p class="csc-sec-d">A Anthropic <b>não</b> cobra separado por robô. Este valor é o custo real <b>rateado</b> pelo uso de cada chave (quanto cada uma consumiu) — é uma <b>estimativa de atribuição, não uma fatura por robô</b>.</p>
          <div v-if="gastoRealCarregando" class="csc-det-vazio">Carregando…</div>
          <div v-else-if="detChave.length" class="csc-det-lista">
            <div v-for="(k, i) in detChave" :key="'chave' + i" class="csc-det-linha">
              <div class="csc-det-nome-wrap">
                <span class="csc-det-nome">{{ traduzChave(k.nome) }}</span>
                <span class="csc-det-tokens">{{ fmtNum(k.tokensIn) }} tokens enviados · {{ fmtNum(k.tokensOut) }} gerados</span>
              </div>
              <span class="csc-det-val">{{ fmtBRL(Number(k.usdEstimado) * CAMBIO) }}</span>
            </div>
          </div>
          <div v-else class="csc-det-vazio">Detalhamento por robô indisponível agora.</div>
        </div>

        <!-- DETALHAMENTO 3 — a OpenAI por modelo. Mesma ideia do da Anthropic, e
             também valor REAL cobrado. -->
        <div class="csc-det">
          <div class="csc-det-head">
            <h2 class="csc-sec-t">Para onde o dinheiro foi · OpenAI</h2>
            <span class="csc-det-selo csc-det-selo-real">valor real</span>
          </div>
          <p class="csc-sec-d">É o valor <b>real</b> cobrado pela OpenAI, quebrado por modelo e tipo de uso. <b>Imagem</b> é o que a Fábrica gera; <b>texto</b> é o que o modelo lê e escreve em volta.</p>
          <div v-if="gastoOaCarregando" class="csc-det-vazio">Carregando…</div>
          <div v-else-if="detCategoriaOa.length" class="csc-det-lista">
            <div v-for="(c, i) in detCategoriaOa" :key="'oacat' + i" class="csc-det-linha">
              <span class="csc-det-nome">{{ traduzCategoriaOa(c.item) }}</span>
              <span class="csc-det-val">{{ fmtBRL(Number(c.usd) * CAMBIO) }}</span>
            </div>
          </div>
          <div v-else class="csc-det-vazio">Detalhamento por modelo indisponível agora.</div>
        </div>

        <!-- DETALHAMENTO 4 — quem gastou, na OpenAI. Aqui, ao contrário da
             Anthropic, NÃO é rateio: a OpenAI cobra separado por chave de API,
             então cada linha é a conta de verdade daquela chave. -->
        <div class="csc-det">
          <div class="csc-det-head">
            <h2 class="csc-sec-t">Quem gastou · OpenAI</h2>
            <span class="csc-det-selo csc-det-selo-real">valor real</span>
          </div>
          <p class="csc-sec-d">A OpenAI <b>cobra separado por chave</b> — então, diferente da Anthropic logo acima, isto <b>não é rateio</b>: cada linha é a conta de verdade daquela chave.</p>
          <div v-if="gastoOaCarregando" class="csc-det-vazio">Carregando…</div>
          <div v-else-if="detChaveOa.length" class="csc-det-lista">
            <div v-for="(k, i) in detChaveOa" :key="'oachave' + i" class="csc-det-linha">
              <span class="csc-det-nome">{{ traduzChaveOa(k.nome) }}</span>
              <span class="csc-det-val">{{ fmtBRL(Number(k.usd) * CAMBIO) }}</span>
            </div>
          </div>
          <div v-else class="csc-det-vazio">Detalhamento por chave indisponível agora.</div>
        </div>

        <div class="csc-kpis">
          <div class="csc-kpi"><span class="csc-kpi-lbl">Estimativa dos robôs no período</span><span class="csc-kpi-val">{{ fmtBRL(exResumo.usd * CAMBIO) }}</span><span class="csc-kpi-sub">só as tarefas dos robôs abaixo — o real acima é maior</span></div>
          <div class="csc-kpi"><span class="csc-kpi-lbl">Tarefas que custaram</span><span class="csc-kpi-val">{{ exResumo.pagas }}</span><span class="csc-kpi-sub">de {{ exResumo.total }} no total</span></div>
          <div class="csc-kpi"><span class="csc-kpi-lbl">Tarefas de custo zero</span><span class="csc-kpi-val">{{ exResumo.zero }}</span><span class="csc-kpi-sub">não usaram API paga</span></div>
          <div class="csc-kpi"><span class="csc-kpi-lbl">Média por tarefa paga</span><span class="csc-kpi-val">{{ fmtBRL(exResumo.mediaPaga * CAMBIO) }}</span><span class="csc-kpi-sub">no período</span></div>
        </div>

        <div class="csc-sec"><h2 class="csc-sec-t">Quem está gastando mais</h2><p class="csc-sec-d">Total por área no período, do maior para o menor. Fábrica e Painel aparecem em R$ 0 (não usam API paga).</p></div>
        <div class="csc-ranking">
          <div v-for="(a, i) in gastoPorArea" :key="a.area" class="csc-rank" :class="{ topo: i === 0 && a.usd > 0 }">
            <div class="csc-rank-top">
              <span class="csc-rank-nome"><b>{{ i + 1 }}º</b> {{ a.area }}</span>
              <span class="csc-rank-val">{{ a.usd === 0 ? 'R$ 0' : fmtBRL(a.usd * CAMBIO) }}</span>
            </div>
            <div class="csc-rank-bar"><i :style="{ width: a.barPct + '%' }"></i></div>
            <div class="csc-rank-sub">{{ a.pct }}% do total · {{ a.acoes }} tarefa{{ a.acoes === 1 ? '' : 's' }}</div>
          </div>
          <div v-if="!gastoPorArea.length" class="csc-col-vazio">Nenhuma tarefa no período.</div>
        </div>

        <div class="csc-sec"><h2 class="csc-sec-t">Extrato detalhado</h2><p class="csc-sec-d">Cada tarefa do período, da mais recente para a mais antiga — como um extrato de banco.</p></div>
        <div class="csc-extrato">
          <div class="csc-ex-row csc-ex-cab"><span>Quando</span><span>Área</span><span>O que a IA fez</span><span class="csc-ex-v">Valor</span></div>
          <div v-for="(e, i) in execucoesPeriodo" :key="e.id || i" class="csc-ex-row">
            <span class="csc-ex-data">{{ fmtData(e.run_at) }}</span>
            <span class="csc-ex-area">{{ areaDe(e.robo) }}</span>
            <span class="csc-ex-oque">{{ fraseAcaoMaiuscula(e) }}</span>
            <span class="csc-ex-v" :class="{ 'csc-zero': ehZeroDeVerdade(e.usd) }">{{ custoCurto(e.usd) }}</span>
          </div>
          <div v-if="execucoesPeriodo.length" class="csc-ex-row csc-ex-tot"><span></span><span></span><span>Total estimado (só robôs)</span><span class="csc-ex-v">{{ fmtBRL(exResumo.usd * CAMBIO) }}</span></div>
          <div v-if="!execucoesPeriodo.length" class="csc-fi-vazio">Nenhuma tarefa nesse período.</div>
        </div>
      </div><!-- fim aba extrato -->
    </div>
  </div>
</template>

<script setup>
import { fraseDoCusto, ehZeroDeVerdade, somarFornecedores } from './custo-do-extrato.js'
import { criarCacheDeCusto } from './cache-de-custo.js'
import { onMounted, onUnmounted, ref, computed, watch } from 'vue'
import BarraDeTopo from '../../compartilhado/barra-de-topo.vue'
import { useRouter } from 'vue-router'
import { sb } from '../../compartilhado/buscar-e-salvar-dados.js'
import { sbClient } from '../../compartilhado/conectar-no-banco-de-dados.js'
import FaixaDeErro from '../../compartilhado/faixa-de-erro.vue'

const router = useRouter()
const voltar = () => router.push({ name: 'inicio' })
const logoClaroUrl = '/midia/LOGOTIPOBRENOPRETO.png'
const logoEscuroUrl = '/midia/LOGOTIPOBRENOBRANCO.png'

const CAMBIO = 5.5 // US$ -> R$ (mesmo valor usado nos logs dos robôs)

// Robôs conhecidos: rótulo, o que faz (leigo), quando roda (leigo) e o verbo da produção.
const ROBOS = [
  { slug: 'gestor-comercial', label: 'Gestor Comercial', faz: 'Escreve o relatório comercial da semana (metas, concorrência, estoque).', quando: 'toda segunda de manhã', verbo: 'Escreveu' },
  { slug: 'budget-ia',        label: 'Consultor de Anúncios', faz: 'Analisa as campanhas do Meta e sugere o orçamento de cada uma.', quando: 'toda segunda de manhã', verbo: 'Analisou' },
  { slug: 'coletor-noticias', label: 'Coletor de Notícias', faz: 'Lê e resume as novidades dos concorrentes.', quando: 'toda segunda de manhã', verbo: 'Resumiu' },
  { slug: 'panorama',         label: 'Panorama do Mercado', faz: 'Escreve o resumão do que rolou no mercado.', quando: 'quando você pede', verbo: 'Escreveu' },
  { slug: 'fabrica-gerar',    label: 'Fábrica · Criar Criativos', faz: 'Cria as imagens (criativos) dos anúncios.', quando: 'quando você manda', verbo: 'Criou' },
  { slug: 'fabrica-subir',    label: 'Fábrica · Subir Campanha', faz: 'Monta a campanha e sobe os anúncios para o Meta.', quando: 'quando você manda', verbo: 'Subiu' },
  { slug: 'fabrica-ativar',   label: 'Fábrica · Ligar Anúncios', faz: 'Liga os anúncios no Gerenciador do Meta.', quando: 'quando você manda', verbo: 'Ligou' },
  { slug: 'status-projetos',  label: 'Andamento dos Projetos', faz: 'Lê os planos e anota em que pé está cada projeto. O quadro saiu desta tela em 19/08/2026; ele segue guardando o andamento, que fica no banco.', quando: 'a cada mudança nos planos', verbo: 'Anotou' },
  { slug: 'sugerir-interesses', label: 'Sugestões de Interesse', faz: 'Descobre os interesses de público de cada objetivo buscando no catálogo do Meta, e mostra na Fábrica.', quando: 'todo domingo de manhã', verbo: 'Sugeriu' },
]
const META = Object.fromEntries(ROBOS.map(r => [r.slug, r]))
const nomeRobo = (slug) => (META[slug]?.label) || slug

const execucoes = ref([])
const relogio = ref('')
const statusCarga = ref('carregando…')

// ── formatação ──
const fmtUsd = (v) => 'US$ ' + Number(v || 0).toFixed(2)
const fmtBRL = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtNum = (v) => Number(v || 0).toLocaleString('pt-BR')
function fmtDur(ms) {
  const s = Math.round((ms || 0) / 1000)
  if (s < 1) return 'menos de 1 segundo'
  if (s < 60) return s + (s === 1 ? ' segundo' : ' segundos')
  const m = Math.floor(s / 60), r = s % 60
  if (m < 60) return r ? `${m} min e ${r}s` : `${m} minuto${m === 1 ? '' : 's'}`
  const h = Math.floor(m / 60), mm = m % 60
  return `${h}h${mm ? ' e ' + mm + 'min' : ''}`
}
function tempoRel(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.round(diff / 1000)
  if (s < 60) return 'agora há pouco'
  const m = Math.floor(s / 60); if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60); if (h < 24) return `há ${h} hora${h === 1 ? '' : 's'}`
  const d = Math.floor(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}
// Frase do custo, em reais e explicando o "custo zero".
// Compacto (cabe numa linha nos cards). A explicação completa do "custo zero"
// (não usou API paga, só a assinatura) fica na legenda do topo.
// A regra das TRÊS situações (valor / zero de verdade / não sei) mora em
// custo-do-extrato.js, com teste. Aqui ela virava `Number(usd) === 0`, e
// `Number(null) === 0` é TRUE — foi assim que "não sei" virou "R$ 0".
function custoFrase(usd) { return fraseDoCusto(usd, CAMBIO) }
function custoCurto(usd) {
  if (!Number.isFinite(Number(usd)) || usd === null || usd === undefined) return 'não conhecido'
  return Number(usd) === 0 ? 'R$ 0' : fmtBRL(Number(usd) * CAMBIO)
}
// Coloca a unidade no singular quando a quantidade é 1 ("1 relatório", não "1 relatórios").
function unid(n, u) {
  return Number(n) === 1 ? String(u || '').replace(/s$/, '') : u
}
// Frase de ação para a linha do tempo, ex.: "criou 100 criativos".
function fraseAcao(e) {
  const verbo = (META[e.robo]?.verbo || 'Fez').toLowerCase()
  if (e.itens != null && e.unidade) return `${verbo} ${fmtNum(e.itens)} ${unid(e.itens, e.unidade)}`
  return e.acao
}

// ── agregações ──
const feed = computed(() => execucoes.value.slice(0, 30))

const kpis = computed(() => {
  const now = Date.now()
  const DIA = 86400000
  const inicioHoje = new Date(); inicioHoje.setHours(0, 0, 0, 0)
  // `execucoesSemCusto` existe para a estimativa não mentir por omissão: sem
  // ela, uma geração de imagem sem preço conhecido simplesmente não entrava na
  // conta e o total parecia completo.
  let usdHoje = 0, usdMes = 0, acoes = 0, itens = 0, tempoMs = 0, semCustoMes = 0
  for (const e of execucoes.value) {
    const t = new Date(e.run_at).getTime()
    const desconhecido = e.usd === null || e.usd === undefined
    const usd = desconhecido ? 0 : (Number(e.usd) || 0)
    if (t >= inicioHoje.getTime()) usdHoje += usd
    if (now - t <= 30 * DIA) { usdMes += usd; acoes++; itens += Number(e.itens) || 0; tempoMs += Number(e.duracao_ms) || 0; if (desconhecido) semCustoMes++ }
  }
  return { usdHoje, usdMes, acoes, itens, tempoMs, semCustoMes }
})

// Robôs: mostra os que já rodaram primeiro (por última execução), depois os conhecidos que faltam.
const robosView = computed(() => {
  const ultimaPorRobo = {}
  for (const e of execucoes.value) if (!ultimaPorRobo[e.robo]) ultimaPorRobo[e.robo] = e // execucoes vem desc
  const lista = ROBOS.map(r => ({ ...r, ult: ultimaPorRobo[r.slug] || null }))
  return lista.sort((a, b) => {
    const ta = a.ult ? new Date(a.ult.run_at).getTime() : -1
    const tb = b.ult ? new Date(b.ult.run_at).getTime() : -1
    return tb - ta
  })
})

// ── extrato de gastos ──
const aba = ref('visao')
const periodos = [{ d: 7, label: '7 dias' }, { d: 14, label: '14 dias' }, { d: 30, label: '30 dias' }, { d: 3650, label: 'Tudo' }]
const periodo = ref(30)
const periodoLabel = computed(() => {
  if (periodo.value >= 3650) return 'últimos 90 dias'
  const p = periodos.find((x) => x.d === periodo.value)
  return p ? p.label : `${periodo.value} dias`
})

// ── GASTO REAL da Anthropic (a fatura de verdade) ──────────────────────────
// O total que a tela calcula (soma do campo `usd` que os robôs anotaram) é só
// uma ESTIMATIVA PARCIAL: conta apenas as tarefas dos robôs deste painel. A
// Anthropic cobra bem mais — a fatura real inclui também as sessões de
// desenvolvimento com IA (Claude Code), as buscas na web e o cache. A edge
// function `custo-anthropic` devolve esse número real (só admin tem acesso).
// Nunca inventamos um número: se a busca falhar, mostramos o erro, nunca R$ 0.
// A fatura é a MESMA pergunta para o total do topo e para o extrato quando os
// dois olham 30 dias — que é como a tela abre. Sem isto, cada abertura fazia as
// quatro chamadas (duas contas × duas janelas), e a mais lenta delas segurava o
// número do topo. Ver `cache-de-custo.js` para os números medidos.
const _cacheCusto = criarCacheDeCusto()

async function _buscarCustoReal(funcao, dias) {
  const guardado = _cacheCusto.ler(funcao, dias, Date.now())
  if (guardado) return { dados: guardado }
  try {
    const { data, error } = await sbClient.functions.invoke(funcao, { body: { dias } })
    if (error) return { erro: error.message || 'não consegui falar com o servidor' }
    if (data && data.error) return { erro: data.detalhe || data.error }
    if (!data || typeof data.totalBrl !== 'number') return { erro: 'resposta sem valor' }
    // Só o que deu certo é guardado: cachear erro grudaria a frase "não consegui
    // puxar a conta" na tela por dez minutos depois de o problema já ter passado.
    _cacheCusto.guardar(funcao, dias, data, Date.now())
    return { dados: data }
  } catch (e) {
    return { erro: (e && e.message) || 'falha inesperada' }
  }
}

// Hero (visão geral): sempre 30 dias, pra casar com a frase "nos últimos 30 dias".
const gastoRealMes = ref(null)
const gastoRealMesCarregando = ref(false)
const gastoRealMesErro = ref(null)
async function carregarGastoRealMes() {
  gastoRealMesCarregando.value = true
  gastoRealMesErro.value = null
  const r = await _buscarCustoReal('custo-anthropic', 30)
  gastoRealMesCarregando.value = false
  if (r.erro) { gastoRealMesErro.value = r.erro; gastoRealMes.value = null }
  else gastoRealMes.value = r.dados
}

// Extrato: segue o período escolhido (7/14/30 dias; "Tudo" → 90, o teto da função).
const gastoReal = ref(null)
const gastoRealCarregando = ref(false)
const gastoRealErro = ref(null)
let _gastoRealSeq = 0 // ignora respostas antigas se o período mudar durante a busca
async function carregarGastoReal() {
  const dias = periodo.value >= 3650 ? 90 : periodo.value
  const seq = ++_gastoRealSeq
  gastoRealCarregando.value = true
  gastoRealErro.value = null
  const r = await _buscarCustoReal('custo-anthropic', dias)
  if (seq !== _gastoRealSeq) return // chegou uma resposta mais nova; descarta esta
  gastoRealCarregando.value = false
  if (r.erro) { gastoRealErro.value = r.erro; gastoReal.value = null }
  else gastoReal.value = r.dados
}
// ── GASTO REAL da OpenAI (a outra fatura) ─────────────────────────────────
// A Fábrica cria os criativos com gpt-image-2, que é API PAGA da OpenAI. O custo
// POR EXECUÇÃO continua desconhecido (ninguém precificou o motor), mas o TOTAL
// cobrado é conhecido desde 18/08/2026 — é o que a função `custo-openai` traz.
// Ela é irmã da `custo-anthropic`: mesma segurança, mesmo formato de resposta.
const gastoOaMes = ref(null)
const gastoOaMesCarregando = ref(false)
const gastoOaMesErro = ref(null)
async function carregarGastoOaMes() {
  gastoOaMesCarregando.value = true
  gastoOaMesErro.value = null
  const r = await _buscarCustoReal('custo-openai', 30)
  gastoOaMesCarregando.value = false
  if (r.erro) { gastoOaMesErro.value = r.erro; gastoOaMes.value = null }
  else gastoOaMes.value = r.dados
}

const gastoOa = ref(null)
const gastoOaCarregando = ref(false)
const gastoOaErro = ref(null)
let _gastoOaSeq = 0 // ignora respostas antigas se o período mudar durante a busca
async function carregarGastoOa() {
  const dias = periodo.value >= 3650 ? 90 : periodo.value
  const seq = ++_gastoOaSeq
  gastoOaCarregando.value = true
  gastoOaErro.value = null
  const r = await _buscarCustoReal('custo-openai', dias)
  if (seq !== _gastoOaSeq) return // chegou uma resposta mais nova; descarta esta
  gastoOaCarregando.value = false
  if (r.erro) { gastoOaErro.value = r.erro; gastoOa.value = null }
  else gastoOa.value = r.dados
}

// ── O TOTAL DOS DOIS ──────────────────────────────────────────────────────────
// Somar aqui na mão seria o jeito de repetir o defeito: fornecedor que falhou
// entraria como zero e o total apareceria menor que o verdadeiro, com cara de
// número exato. Quem decide isso é `somarFornecedores`, que tem teste e devolve
// também se a conta está COMPLETA — a tela avisa quando não está.
const totalRealMes = computed(() => somarFornecedores({
  Anthropic: gastoRealMes.value ? gastoRealMes.value.totalBrl : null,
  OpenAI: gastoOaMes.value ? gastoOaMes.value.totalBrl : null,
}))
const totalRealPeriodo = computed(() => somarFornecedores({
  Anthropic: gastoReal.value ? gastoReal.value.totalBrl : null,
  OpenAI: gastoOa.value ? gastoOa.value.totalBrl : null,
}))
const carregandoAlgumReal = computed(() => gastoRealCarregando.value || gastoOaCarregando.value)
const carregandoAlgumRealMes = computed(() => gastoRealMesCarregando.value || gastoOaMesCarregando.value)

// Ao trocar o período, rebusca o gasto real daquela janela — os dois fornecedores.
watch(periodo, () => { carregarGastoReal(); carregarGastoOa() })

function fmtDataCurta(iso) {
  if (!iso) return ''
  const p = String(iso).split('-')
  return p.length === 3 ? `${p[2]}/${p[1]}` : String(iso)
}

// ── DETALHAMENTO do gasto real (por categoria + por robô) ───────────────────
// Ambas as listas já vêm na MESMA resposta da função custo-anthropic (no ref
// gastoReal) — não fazemos uma segunda chamada, só lemos os campos.
//   • porCategoria → valor REAL cobrado, quebrado por modelo e tipo de token.
//   • porChave     → custo real RATEADO pelo uso de cada chave (atribuição, não fatura).
// Se a sub-chamada da função falhar, o campo vem como [] — a tela mostra
// "indisponível", nunca inventa número.
const detCategoria = computed(() => Array.isArray(gastoReal.value?.porCategoria) ? gastoReal.value.porCategoria : [])
const detChave = computed(() => Array.isArray(gastoReal.value?.porChave) ? gastoReal.value.porChave : [])
// Na OpenAI os dois detalhamentos são REAIS: ela cobra separado por chave de API,
// então "quem gastou" aqui é a conta de verdade, não um rateio como na Anthropic.
const detCategoriaOa = computed(() => Array.isArray(gastoOa.value?.porCategoria) ? gastoOa.value.porCategoria : [])
const detChaveOa = computed(() => Array.isArray(gastoOa.value?.porChave) ? gastoOa.value.porChave : [])

// Traduz o nome técnico da categoria da Anthropic pra algo que o dono entende.
// Nomes não reconhecidos voltam como vieram (nunca inventamos rótulo).
function traduzCategoria(item) {
  const raw = String(item || '').trim()
  const low = raw.toLowerCase()
  if (low.includes('web search')) return 'Buscas na web'
  if (low.includes('code execution')) return 'Execução de código'
  // Modelo, ex.: "Claude Opus 4.8" / "Claude Sonnet 4.6" / "Claude Haiku 4.5"
  const mMod = raw.match(/Claude\s+(Opus|Sonnet|Haiku)\s+[\d.]+/i)
  const modelo = mMod ? mMod[0].replace(/^Claude\s+/i, '') : ''
  let tipo = ''
  if (low.includes('cache write') || low.includes('cache creation')) tipo = 'gravação de cache'
  else if (low.includes('cache hit') || low.includes('cache read')) tipo = 'cache reaproveitado (mais barato)'
  else if (low.includes('output')) tipo = 'respostas geradas (saída)'
  else if (low.includes('input')) tipo = 'texto enviado (entrada)'
  if (modelo && tipo) return `${modelo} · ${tipo}`
  if (modelo) return modelo
  return raw
}

// Traduz o nome da chave (robô) pra um rótulo amigável. Chave desconhecida
// aparece como veio.
const ROBO_CHAVE = {
  desenvolvimentopilotos: 'Desenvolvimento & pilotos (sessões de IA, ex.: este trabalho)',
  spyconcorrente: 'Espião de concorrentes',
  gestortrafego: 'Gestor de Tráfego',
  gestorcomercial: 'Gestor Comercial',
  // Esta chave chega com hífen ('sugerir-interesses'). As duas formas ficam
  // mapeadas porque numa tela sobre DINHEIRO não pode aparecer nome técnico de
  // arquivo — e não vale a pena descobrir na produção qual das duas veio.
  'sugerir-interesses': 'Sugestões de Interesse (Fábrica de Anúncios)',
  sugeririnteresses: 'Sugestões de Interesse (Fábrica de Anúncios)',
}
const traduzChave = (nome) => ROBO_CHAVE[String(nome || '').toLowerCase()] || nome || '—'

// ── OpenAI: os mesmos dois tradutores, para o vocabulário DELA ───────────────
// A OpenAI nomeia a linha assim: "gpt-image-2-2026-04-21 image, output". Traduzir
// importa mais aqui do que na Anthropic: numa tela sobre dinheiro, "image,
// output" não diz a ninguém que aquilo é o criativo que a Fábrica gerou.
function traduzCategoriaOa(item) {
  const raw = String(item || '').trim()
  const low = raw.toLowerCase()
  // "gpt-image-2-2026-04-21" → "gpt-image-2" (a data da versão só polui a leitura)
  const modelo = raw.split(',')[0].split(' ')[0].replace(/-\d{4}-\d{2}-\d{2}$/, '')
  let tipo = ''
  if (low.includes('cache write')) tipo = 'gravação de cache'
  else if (low.includes('cached input')) tipo = 'cache reaproveitado (mais barato)'
  else if (low.includes('image, output')) tipo = 'imagens geradas (saída)'
  else if (low.includes('image, input')) tipo = 'imagem enviada (entrada)'
  else if (low.includes('audio, input')) tipo = 'áudio enviado (entrada)'
  else if (low.includes('text, output')) tipo = 'texto gerado (saída)'
  else if (low.includes('text, input')) tipo = 'texto enviado (entrada)'
  else if (low.includes('output')) tipo = 'respostas geradas (saída)'
  else if (low.includes('input')) tipo = 'texto enviado (entrada)'
  return tipo ? `${modelo} · ${tipo}` : (modelo || raw)
}

// Nome da chave na OpenAI (elas foram criadas sem espaço, como "FabricadeAnuncios").
// Chave que ninguém mapeou aparece como veio — some do painel seria pior.
const CHAVE_OA = {
  fabricadeanuncios: 'Fábrica de Anúncios (criativos)',
  engenhariadebolsas: 'Engenharia de Bolsas',
  transiçãoaudioagentemotoeasy: 'Transição de áudio (agente Moto Easy)',
  transicaoaudioagentemotoeasy: 'Transição de áudio (agente Moto Easy)',
}
const traduzChaveOa = (nome) => CHAVE_OA[String(nome || '').toLowerCase()] || nome || '—'

// Cada robô pertence a uma "área" (o que o usuário chama de projeto) — pra consolidar o gasto.
const AREA = {
  'gestor-comercial': 'Gestão Comercial',
  'budget-ia': 'Anúncios (orçamento)',
  'coletor-noticias': 'Notícias',
  'panorama': 'Notícias',
  'fabrica-gerar': 'Fábrica de Anúncios',
  'fabrica-subir': 'Fábrica de Anúncios',
  'fabrica-ativar': 'Fábrica de Anúncios',
  'status-projetos': 'Painel do Sistema',
  'sugerir-interesses': 'Fábrica de Anúncios',
}
const areaDe = (robo) => AREA[robo] || nomeRobo(robo)

const execucoesPeriodo = computed(() => {
  const lim = Date.now() - periodo.value * 86400000
  return execucoes.value.filter((e) => new Date(e.run_at).getTime() >= lim)
})
const exResumo = computed(() => {
  let usd = 0, pagas = 0, zero = 0
  for (const e of execucoesPeriodo.value) {
    const v = Number(e.usd) || 0
    usd += v
    if (v > 0) pagas++; else zero++
  }
  return { usd, pagas, zero, total: execucoesPeriodo.value.length, mediaPaga: pagas ? usd / pagas : 0 }
})
const gastoPorArea = computed(() => {
  const g = {}
  for (const e of execucoesPeriodo.value) {
    const a = areaDe(e.robo)
    if (!g[a]) g[a] = { area: a, usd: 0, acoes: 0 }
    g[a].usd += Number(e.usd) || 0
    g[a].acoes++
  }
  const arr = Object.values(g).sort((x, y) => y.usd - x.usd || y.acoes - x.acoes)
  const max = arr.reduce((m, x) => Math.max(m, x.usd), 0) || 1
  const tot = arr.reduce((s, x) => s + x.usd, 0) || 1
  return arr.map((x) => ({ ...x, pct: Math.round((x.usd / tot) * 100), barPct: Math.max(2, Math.round((x.usd / max) * 100)) }))
})
function fmtData(iso) {
  const d = new Date(iso)
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' · ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
// "Escreveu 1 relatório" (com maiúscula) + nome do robô, pra linha do extrato.
function fraseAcaoMaiuscula(e) {
  const f = fraseAcao(e)
  return nomeRobo(e.robo) + ' — ' + f.charAt(0).toUpperCase() + f.slice(1)
}

// ── carga ──
const erroCarregar = ref(null)

// Saúde dos robôs agendados (pg_cron → Edge Functions). É outra coisa dos robôs
// de IA acima: aqui não se mede custo, mede-se se a rodada DEU CERTO. Existe
// porque cron.job_run_details diz "succeeded" mesmo quando a função devolve erro
// — ver a migration 2026-07-31-saude-dos-robos.sql.
const saudeDosRobos = ref([])

// Só o que está com problema. Robô saudável não vira aviso: um painel que avisa
// sobre o que está normal ensina a ignorar aviso.
const robosComProblema = computed(() =>
  saudeDosRobos.value
    .filter(r => r.situacao === 'ATRASADO' || r.situacao === 'nunca deu certo')
    .sort((a, b) => Number(b.critico) - Number(a.critico)),
)

async function carregar() {
  // `projetos_status` NÃO é lido aqui: o quadro de projetos saiu da tela em
  // 19/08/2026. A tabela e o robô que a alimenta continuam intactos — se o
  // quadro voltar um dia, o dado está lá. Buscar o que ninguém mostra só faz
  // a tela demorar mais para abrir.
  const [ex, sa] = await Promise.all([
    sb('ia_execucoes?select=*&order=run_at.desc&limit=200'),
    // Saúde dos robôs agendados. NÃO entra no erroCarregar abaixo: se esta
    // consulta falhar, o painel inteiro não pode sumir por causa dela — o pior
    // que acontece é o aviso não aparecer.
    sb('robos_saude?select=*'),
  ])
  if (!sa.erro) saudeDosRobos.value = sa
  // Antes: falha virava [] e a tela dizia "0 execuções, R$ 0" como se fosse
  // verdade. Só sobrescreve os dados bons quando a busca deu certo — assim um
  // blip de rede no refresh de 60s não apaga o que já estava na tela.
  erroCarregar.value = ex.erro || null
  if (!ex.erro) execucoes.value = ex
  if (erroCarregar.value) return
  const hh = new Date()
  statusCarga.value = 'atualizado às ' + hh.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
let _clockTimer = null, _refreshTimer = null
function tickRelogio() {
  relogio.value = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
onMounted(() => {
  tickRelogio()
  _clockTimer = setInterval(tickRelogio, 1000)
  carregar()
  carregarGastoRealMes()
  carregarGastoReal()
  carregarGastoOaMes()
  carregarGastoOa()
  // O ciclo de 60s cuida só do que MUDA de minuto a minuto: o que os robôs
  // acabaram de fazer. A fatura das duas contas de IA fica de fora de propósito
  // — ela é fechada por DIA pelos fornecedores, e repuxá-la a cada minuto era o
  // que fazia o número do topo ficar em "…" e a frase de erro piscar. Quem quiser
  // o valor mais novo recarrega a página; passados 10 minutos, o cache vence
  // sozinho e a próxima abertura já busca de novo.
  _refreshTimer = setInterval(() => { carregar() }, 60000)
})
onUnmounted(() => {
  if (_clockTimer) clearInterval(_clockTimer)
  if (_refreshTimer) clearInterval(_refreshTimer)
})
</script>

<style scoped>
/* Fontes (Sora + IBM Plex Mono/Sans) carregadas no index.html, junto das demais do app. */
.csc-tela {
  --fs: 'IBM Plex Sans', system-ui, sans-serif;
  --fd: 'Sora', system-ui, sans-serif;
  --fm: 'IBM Plex Mono', ui-monospace, 'SF Mono', monospace;
  --violet: var(--roxo);
  min-height: 100vh; background: var(--bg); color: var(--text); font-family: var(--fs);
}
@keyframes cscUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

/* Topbar */
.csc-topbar { display: flex; align-items: center; gap: 16px; padding: 13px clamp(16px, 2.5vw, 44px); border-bottom: 1px solid var(--border); background: color-mix(in srgb, var(--surface) 88%, transparent); backdrop-filter: saturate(1.4) blur(10px); position: sticky; top: 0; z-index: 20; }
.csc-tb-left { display: flex; align-items: center; gap: 14px; }
.csc-back { display: inline-flex; align-items: center; gap: 5px; background: none; border: 1px solid var(--border); color: var(--muted); font-size: 12px; font-weight: 500; padding: 6px 11px; border-radius: var(--radius-sm); cursor: pointer; transition: border-color .18s, color .18s; }
.csc-back:hover { border-color: var(--accent); color: var(--text); }
.rbv-logo { height: 22px; width: auto; }
.rbv-logo-light { display: block; } .rbv-logo-dark { display: none; }
:global([data-theme="dark"]) .rbv-logo-light { display: none; }
:global([data-theme="dark"]) .rbv-logo-dark { display: block; }
.csc-title { font-family: var(--fs); font-size: 15px; font-weight: 700; letter-spacing: 3px; text-transform: uppercase; color: var(--text); flex: 1; }
.csc-tb-right { display: flex; align-items: center; gap: 16px; }
.csc-live { display: inline-flex; align-items: center; gap: 6px; font-size: 10px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--green); }
.csc-live i { width: 7px; height: 7px; border-radius: 50%; background: var(--green); animation: cscPulse 1.8s infinite; }
@keyframes cscPulse { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.5); } 70% { box-shadow: 0 0 0 7px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }
.csc-clock { font-family: var(--fm); font-size: 15px; font-weight: 500; letter-spacing: .5px; color: var(--text); font-variant-numeric: tabular-nums; }
.csc-upd { font-size: 10px; color: var(--muted); letter-spacing: .2px; }

.csc-body { padding: clamp(16px, 2vw, 40px) clamp(16px, 2.5vw, 48px) 64px; display: flex; flex-direction: column; gap: clamp(20px, 2.2vw, 32px); width: 100%; }

/* HERO */
.csc-hero { display: flex; flex-wrap: wrap; align-items: stretch; justify-content: space-between; gap: 28px; padding: clamp(24px, 3.2vw, 44px); border-radius: 20px; border: 1px solid var(--border); animation: cscUp .5s cubic-bezier(.22,1,.36,1) both; background:
    radial-gradient(85% 130% at 100% 0%, color-mix(in srgb, var(--accent) 20%, transparent) 0%, transparent 58%),
    radial-gradient(70% 120% at 0% 100%, color-mix(in srgb, var(--violet) 15%, transparent) 0%, transparent 52%),
    var(--surface); box-shadow: var(--shadow-md); overflow: hidden; }
.csc-hero-txt { flex: 1 1 380px; display: flex; flex-direction: column; justify-content: center; }
.csc-hero-eyebrow { font-size: 11px; font-weight: 700; letter-spacing: 2.5px; text-transform: uppercase; color: var(--accent-forte); }
.csc-hero-h1 { font-family: var(--fd); font-size: clamp(30px, 4.6vw, 52px); font-weight: 600; letter-spacing: -.5px; color: var(--text); margin: 10px 0 14px; line-height: 1.02; }
.csc-hero-p { font-size: clamp(14px, 1.1vw, 16px); line-height: 1.65; color: var(--muted); max-width: 620px; }
.csc-hero-p b { color: var(--text); font-weight: 600; }
.csc-hero-gasto { flex: 0 0 auto; display: flex; flex-direction: column; justify-content: center; gap: 5px; padding: 4px 4px 4px 26px; border-left: 1px solid var(--border); }
.csc-hero-gasto-lbl { font-size: 11px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: var(--muted); }
.csc-hero-gasto-val { font-family: var(--fm); font-size: clamp(32px, 5.2vw, 56px); font-weight: 600; color: var(--text); line-height: 1; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
.csc-hero-gasto-sub { font-size: 12px; color: var(--muted); line-height: 1.5; max-width: 300px; }
.csc-hero-gasto-sub b { color: var(--text); font-weight: 600; }
.csc-hero-gasto-indisp { font-size: clamp(20px, 3vw, 28px); color: var(--red); }
.csc-hero-gasto-erro { font-size: 12.5px; color: var(--red); line-height: 1.5; max-width: 300px; font-weight: 500; }
.csc-hero-gasto-parcial { font-size: 12px; line-height: 1.45; color: var(--orange); font-weight: 500; max-width: 300px; }
.csc-hero-gasto-parcial b { font-weight: 700; }
/* As duas contas por baixo do total: rótulo pequeno em cima, valor embaixo. */
.csc-hero-gasto-quebra { display: flex; flex-wrap: wrap; gap: 6px 18px; margin-top: 2px; }
.csc-hero-forn { display: flex; flex-direction: column; font-family: var(--fm); font-size: 14.5px; font-weight: 600; color: var(--text); font-variant-numeric: tabular-nums; }
.csc-hero-forn i { font-family: inherit; font-style: normal; font-size: 10.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
.csc-hero-gasto-est { margin-top: 8px; font-size: 11.5px; color: var(--muted); line-height: 1.5; max-width: 300px; padding-top: 8px; border-top: 1px dashed var(--border); }
.csc-hero-gasto-est b { color: var(--text); font-weight: 600; }
.csc-carregando { color: var(--muted); }

/* SAÚDE DOS ROBÔS: o aviso de que algo parou. Vermelho de propósito — é a única
   coisa nesta tela que pede ação, e só aparece quando existe problema. */
.csc-alerta {
  display: flex; flex-direction: column; gap: 12px;
  border: 1px solid color-mix(in srgb, var(--red) 45%, transparent);
  background: color-mix(in srgb, var(--red) 8%, var(--surface));
  border-radius: 16px; padding: clamp(16px, 2.2vw, 24px);
  animation: cscUp .5s cubic-bezier(.22,1,.36,1) both;
}
.csc-alerta-t { font-family: var(--fd); font-size: 17px; font-weight: 600; color: var(--red); }
.csc-alerta-item {
  display: flex; flex-direction: column; gap: 4px;
  padding-top: 10px; border-top: 1px solid color-mix(in srgb, var(--red) 20%, transparent);
}
.csc-alerta-item:first-of-type { border-top: none; padding-top: 0; }
.csc-alerta-cab { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.csc-alerta-cab b { font-family: var(--fm); font-size: 14px; color: var(--text); }
.csc-alerta-selo {
  font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase;
  padding: 2px 8px; border-radius: 20px; border: 1px solid var(--border); color: var(--muted);
}
.csc-alerta-selo.critico { border-color: var(--red); color: var(--red); }
.csc-alerta-txt { font-size: 13.5px; line-height: 1.6; color: var(--text); }
.csc-alerta-porque { font-size: 12.5px; line-height: 1.55; color: var(--muted); max-width: 80ch; }

/* GASTO REAL (extrato): bloco de destaque com a fatura de verdade da Anthropic */
.csc-real { border-radius: 18px; border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border)); padding: clamp(18px, 2.4vw, 26px); display: flex; flex-direction: column; gap: 12px; box-shadow: var(--shadow-md); animation: cscUp .5s cubic-bezier(.22,1,.36,1) both; background:
    radial-gradient(90% 130% at 100% 0%, color-mix(in srgb, var(--accent) 16%, transparent) 0%, transparent 60%),
    radial-gradient(70% 120% at 0% 100%, color-mix(in srgb, var(--violet) 12%, transparent) 0%, transparent 55%),
    var(--surface); }
.csc-real-main { display: flex; flex-direction: column; gap: 4px; }
.csc-real-lbl { font-size: 11.5px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: var(--accent); }
.csc-real-val { font-family: var(--fm); font-size: clamp(34px, 6vw, 60px); font-weight: 600; color: var(--text); line-height: 1; letter-spacing: -1.5px; font-variant-numeric: tabular-nums; }
.csc-real-indisp { color: var(--red); letter-spacing: -.5px; font-size: clamp(24px, 3.4vw, 34px); }
.csc-real-sub { font-size: 12.5px; color: var(--muted); }
.csc-real-exp { font-size: 13px; line-height: 1.6; color: var(--muted); max-width: 78ch; }
.csc-real-exp b { color: var(--text); font-weight: 600; }
.csc-real-erro-box { font-size: 12.5px; line-height: 1.55; color: var(--red); background: color-mix(in srgb, var(--red) 8%, transparent); border: 1px solid color-mix(in srgb, var(--red) 28%, transparent); border-radius: var(--radius-md); padding: 10px 13px; }
.csc-real-erro-box b { font-weight: 700; }
/* Total parcial: precisa ser visível sem parecer erro — é um número certo,
   só que incompleto. Por isso âmbar, e não vermelho. */
.csc-real-parcial { font-size: 12.5px; line-height: 1.5; color: var(--orange); font-weight: 500; }
.csc-real-parcial b { font-weight: 700; }
/* As duas contas lado a lado; no celular viram uma embaixo da outra sozinhas,
   sem media query — o minmax cuida disso. */
.csc-real-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 210px), 1fr)); gap: 12px; }
.csc-real-card { display: flex; flex-direction: column; gap: 3px; padding: 13px 15px; border: 1px solid var(--border); border-radius: var(--radius-md); background: color-mix(in srgb, var(--accent) 4%, transparent); min-width: 0; }
.csc-real-card-lbl { font-size: 11px; font-weight: 700; letter-spacing: 1.2px; text-transform: uppercase; color: var(--accent); }
.csc-real-card-val { font-family: var(--fm); font-size: clamp(22px, 3.2vw, 30px); font-weight: 600; color: var(--text); line-height: 1.1; letter-spacing: -.8px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.csc-real-card-oq { font-size: 11.5px; color: var(--muted); line-height: 1.45; margin-top: 2px; }

/* DETALHAMENTO do gasto real: por categoria (real) e por robô (rateado) */
.csc-det { display: flex; flex-direction: column; gap: 10px; }
.csc-det-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.csc-det-selo { font-size: 10px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; padding: 3px 10px; border-radius: 20px; flex-shrink: 0; }
.csc-det-selo-real { color: var(--green); background: color-mix(in srgb, var(--green) 12%, transparent); border: 1px solid color-mix(in srgb, var(--green) 32%, transparent); }
.csc-det-selo-rateado { color: var(--yellow); background: color-mix(in srgb, var(--yellow) 14%, transparent); border: 1px solid color-mix(in srgb, var(--yellow) 34%, transparent); }
.csc-det-lista { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
.csc-det-linha { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 18px; border-bottom: 1px solid var(--border); }
.csc-det-linha:last-child { border-bottom: none; }
.csc-det-nome-wrap { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.csc-det-nome { font-size: 13.5px; color: var(--text); font-weight: 500; line-height: 1.35; }
.csc-det-tokens { font-size: 11px; color: var(--muted); font-family: var(--fm); font-variant-numeric: tabular-nums; }
.csc-det-val { font-family: var(--fm); font-size: 15px; font-weight: 600; color: var(--text); letter-spacing: -.3px; font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
.csc-det-vazio { background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius-md); padding: 18px; text-align: center; color: var(--muted); font-size: 13px; font-style: italic; }

/* LEGENDA */
.csc-legenda { display: flex; align-items: center; gap: 14px; padding: 13px 18px; border-radius: var(--radius-md); border: 1px dashed var(--border); background: var(--surface2); }
.csc-legenda p { font-size: 13px; line-height: 1.5; color: var(--muted); }
.csc-legenda b { color: var(--text); font-weight: 600; }
.csc-tag { flex-shrink: 0; font-size: 11px; font-weight: 700; letter-spacing: .5px; padding: 4px 10px; border-radius: 20px; }
.csc-tag-zero { color: var(--green); background: rgba(26,110,69,.10); border: 1px solid rgba(26,110,69,.30); }
:global([data-theme="dark"]) .csc-tag-zero { background: rgba(34,197,94,.14); border-color: rgba(34,197,94,.34); }

/* Seções */
.csc-sec { margin-top: 8px; }
.csc-sec-t { font-family: var(--fd); font-size: clamp(20px, 2.2vw, 26px); font-weight: 600; letter-spacing: -.3px; color: var(--text); line-height: 1.1; }
.csc-sec-d { font-size: 13.5px; color: var(--muted); margin-top: 4px; line-height: 1.5; max-width: 720px; }

/* KPIs (cards de resumo) */
.csc-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
.csc-kpi { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 16px 18px; display: flex; flex-direction: column; gap: 5px; box-shadow: var(--shadow-sm); overflow: hidden; animation: cscUp .5s cubic-bezier(.22,1,.36,1) both; }
.csc-kpi::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 3px; background: linear-gradient(90deg, var(--accent), var(--violet)); opacity: .85; }
.csc-kpi-lbl { font-size: 10.5px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
.csc-kpi-val { font-family: var(--fm); font-size: clamp(24px, 2.6vw, 30px); font-weight: 600; color: var(--text); line-height: 1.05; letter-spacing: -.5px; font-variant-numeric: tabular-nums; }
.csc-kpi-sub { font-size: 11.5px; color: var(--muted); }

/* Robôs */
.csc-robos { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.csc-robo { background: var(--surface); border: 1px solid var(--border); border-radius: 16px; padding: 18px 20px; display: flex; flex-direction: column; gap: 14px; box-shadow: var(--shadow-sm); border-top: 3px solid var(--border); transition: box-shadow .2s, transform .14s, border-color .2s; animation: cscUp .5s cubic-bezier(.22,1,.36,1) both; }
.csc-robo:hover { box-shadow: var(--shadow-lg); transform: translateY(-3px); }
.csc-robo.st-ok { border-top-color: var(--green); }
.csc-robo.st-erro { border-top-color: var(--red); }
.csc-robo.st-parcial { border-top-color: var(--orange); }
.csc-robo-head { display: flex; align-items: flex-start; gap: 10px; }
.csc-robo-head > div { flex: 1; min-width: 0; }
.csc-robo-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex-shrink: 0; margin-top: 5px; }
.csc-robo.st-ok .csc-robo-dot { background: var(--green); }
.csc-robo.st-erro .csc-robo-dot { background: var(--red); }
.csc-robo.st-parcial .csc-robo-dot { background: var(--orange); }
.csc-robo-nome { font-size: 14px; font-weight: 600; color: var(--text); line-height: 1.25; letter-spacing: -.2px; }
.csc-robo-faz { font-size: 12.5px; color: var(--muted); line-height: 1.45; margin-top: 3px; }
.csc-robo-corpo { display: flex; flex-direction: column; gap: 10px; }
.csc-robo-frase { font-size: 15px; color: var(--text); line-height: 1.35; }
.csc-robo-frase b { font-weight: 600; }
.csc-robo-detalhes { list-style: none; display: flex; flex-direction: column; gap: 6px; }
.csc-robo-detalhes li { font-size: 13px; line-height: 1.5; color: var(--text); }
.csc-di-lbl { color: var(--muted); }
.csc-di-lbl::after { content: ': '; }
.csc-di-val { color: var(--text); font-weight: 600; }
.csc-di-val.csc-zero, .csc-zero { color: var(--green); }
.csc-robo-vazio { font-size: 13px; color: var(--muted); font-style: italic; }
.csc-robo-foot { margin-top: auto; font-size: 11px; color: var(--muted); border-top: 1px solid var(--border); padding-top: 9px; }

.csc-col-vazio { text-align: center; color: var(--muted); font-size: 12.5px; padding: 8px 6px; line-height: 1.4; }

.csc-sec-d b { color: var(--text); font-weight: 600; }

/* Abas + extrato */
.csc-wrap { display: contents; }

.csc-tabs { display: flex; gap: 4px; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 4px; width: fit-content; }
.csc-tabs button { border: none; background: none; color: var(--muted); font-family: inherit; font-size: 13.5px; font-weight: 600; padding: 8px 18px; border-radius: var(--radius-sm); cursor: pointer; transition: background .15s, color .15s; }
.csc-tabs button.on { background: var(--surface); color: var(--text); box-shadow: var(--shadow-sm); }
.csc-tabs button:not(.on):hover { color: var(--text); }
.csc-ex-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.csc-periodo { display: flex; gap: 4px; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 4px; flex-shrink: 0; }
.csc-periodo button { border: none; background: none; color: var(--muted); font-family: inherit; font-size: 12.5px; font-weight: 600; padding: 6px 13px; border-radius: var(--radius-sm); cursor: pointer; transition: background .15s, color .15s; }
.csc-periodo button.on { background: var(--accent); color: var(--sobre-cor); }
.csc-periodo button:not(.on):hover { color: var(--text); }

/* Ranking por área */
.csc-ranking { display: flex; flex-direction: column; gap: 11px; }
.csc-rank { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 15px 18px; display: flex; flex-direction: column; gap: 8px; box-shadow: var(--shadow-sm); }
.csc-rank.topo { border-color: color-mix(in srgb, var(--accent) 40%, var(--border)); box-shadow: 0 4px 20px color-mix(in srgb, var(--accent) 12%, transparent); }
.csc-rank-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.csc-rank-nome { font-size: 15px; color: var(--text); }
.csc-rank-nome b { color: var(--accent); font-weight: 700; margin-right: 6px; font-family: var(--fm); }
.csc-rank-val { font-family: var(--fm); font-size: 20px; font-weight: 600; color: var(--text); letter-spacing: -.5px; font-variant-numeric: tabular-nums; }
.csc-rank-bar { height: 9px; background: var(--surface2); border-radius: 6px; overflow: hidden; }
.csc-rank-bar i { display: block; height: 100%; background: var(--accent); border-radius: 6px; opacity: .55; transition: width .6s cubic-bezier(.22,1,.36,1); }
.csc-rank.topo .csc-rank-bar i { opacity: 1; background: linear-gradient(90deg, var(--accent), var(--violet)); box-shadow: 0 0 14px color-mix(in srgb, var(--violet) 45%, transparent); }
.csc-rank-sub { font-size: 11.5px; color: var(--muted); }

/* Extrato (tabela estilo banco) */
.csc-extrato { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
.csc-ex-row { display: grid; grid-template-columns: 130px 160px 1fr 120px; align-items: center; gap: 12px; padding: 11px 18px; border-bottom: 1px solid var(--border); font-size: 13.5px; }
.csc-ex-row:last-child { border-bottom: none; }
.csc-ex-cab { background: var(--surface2); font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: var(--muted); }
.csc-ex-data { color: var(--muted); font-family: var(--fm); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.csc-ex-area { font-weight: 600; color: var(--text); }
.csc-ex-oque { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.csc-ex-v { text-align: right; font-family: var(--fm); font-size: 15px; font-weight: 600; color: var(--text); letter-spacing: -.3px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.csc-ex-v.csc-zero { color: var(--green); }
.csc-ex-tot { background: var(--surface2); font-weight: 700; }
.csc-ex-tot span:nth-child(3) { font-size: 12px; letter-spacing: .5px; text-transform: uppercase; color: var(--muted); }
.csc-ex-tot .csc-ex-v { font-size: 18px; color: var(--text); }

/* Linha do tempo */
.csc-feed { position: relative; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 6px 6px 6px 4px; box-shadow: var(--shadow-sm); }
.csc-fi { display: flex; align-items: flex-start; gap: 14px; padding: 13px 16px; border-bottom: 1px solid var(--border); position: relative; }
.csc-fi:last-child { border-bottom: none; }
.csc-fi-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--green); flex-shrink: 0; margin-top: 3px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--green) 15%, transparent); }
.csc-fi.st-erro .csc-fi-dot { background: var(--red); box-shadow: 0 0 0 4px color-mix(in srgb, var(--red) 15%, transparent); }
.csc-fi.st-parcial .csc-fi-dot { background: var(--orange); }
.csc-fi-main { flex: 1; min-width: 0; }
.csc-fi-frase { font-size: 14px; color: var(--text); line-height: 1.4; }
.csc-fi-frase b { font-weight: 600; }
.csc-fi-det { font-size: 12.5px; color: var(--muted); margin-top: 2px; display: flex; gap: 6px; flex-wrap: wrap; }
.csc-fi-quando { font-size: 12px; color: var(--muted); white-space: nowrap; flex-shrink: 0; margin-top: 1px; }
.csc-fi-vazio { padding: 26px; text-align: center; color: var(--muted); font-size: 13.5px; }

/* Mobile: nada estoura a tela */
@media (max-width: 680px) {
  .csc-topbar { padding: 9px 16px; gap: 10px; }   /* topbar mais baixa no celular */
  .csc-title { font-size: 13px; letter-spacing: 1px; }
  .csc-tb-right { gap: 8px; }
  .csc-clock { font-size: 14px; }
  .csc-upd { display: none; }
  .csc-hero { flex-direction: column; align-items: flex-start; }
  .csc-hero-gasto { text-align: left; padding-left: 16px; border-left-width: 3px; }
  .csc-robos { grid-template-columns: 1fr; }
  /* A legenda é um flex de dois textos lado a lado. No celular isso virava duas
     colunas de ~150px, com palavra quebrada no meio — ninguém lê assim. */
  .csc-legenda { flex-direction: column; align-items: flex-start; gap: 10px; }
  .csc-tabs, .csc-periodo { width: 100%; }
  .csc-tabs button, .csc-periodo button { flex: 1; text-align: center; }
  /* Extrato empilhado no celular */
  .csc-ex-cab { display: none; }
  .csc-ex-row { display: flex; flex-wrap: wrap; align-items: baseline; gap: 3px 10px; padding: 12px 14px; }
  .csc-ex-data { order: 1; flex-basis: 100%; font-size: 11px; }
  .csc-ex-area { order: 2; }
  .csc-ex-oque { order: 3; flex: 1 1 auto; white-space: normal; min-width: 0; }
  .csc-ex-v { order: 4; }
  .csc-ex-tot { flex-wrap: nowrap; justify-content: space-between; }
  .csc-ex-tot span:nth-child(1), .csc-ex-tot span:nth-child(2) { display: none; }
}
</style>
