// A aba FILA: tudo que o robô propôs e ainda espera uma decisão, das cinco
// contas numa lista só.
//
// PURO no sentido que importa aqui: monta innerHTML e liga listeners no
// elemento que recebe, mas não lê `window`, não vai à rede e não conhece o
// Supabase. Quem busca dado e quem aplica na Meta é a tela — este arquivo
// recebe os itens prontos e devolve as decisões por callback. Mesmo contrato de
// painel-regua.js.
import { opcoesDaLinha, frasePasso } from './acoes-da-fila.js';
import { gastoDaLinha, usoDoOrcamento } from './gastos-da-fila.js';

import { distribuirEntreConjuntos } from './fila.js';

// TEXTO DE FORA VAI TODO POR `esc`. Vale pro nome da campanha e do conjunto (vêm
// da Meta) e principalmente pra `justificativa` e `impacto_estimado`, que são
// escritos pelo MODELO — texto que ninguém revisou antes de virar innerHTML.
// Nenhuma interpolação abaixo escapa dessa regra; a única exceção é `ajudaBtn`,
// que é HTML montado pela própria tela.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reais = (cent) => cent == null ? '—' : 'R$ ' + (Number(cent) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Cor e palavra de cada veredito. 'reduzir' e 'pausar' são avisos, não boas
// notícias — mesma família visual do cartão da campanha.
const VEREDITO = {
  escalar: { texto: 'Subir orçamento', cor: 'positivo' },
  reduzir: { texto: 'Baixar orçamento', cor: 'reduzir' },
  pausar: { texto: 'Pausar campanha', cor: 'pausar' },
  // Campanha que só tem criativo fraco: não é sobre verba, é sobre o anúncio.
  criativos: { texto: 'Trocar criativos', cor: 'reduzir' },
};

// A leitura de SAÚDE, grudada na sugestão. Três formas, por ordem de urgência:
//
// - CONFLITO: o robô manda escalar e a saúde diz que a audiência está queimada.
//   É o caso mais perigoso da tela — aprovar ali é pagar mais para repetir o
//   anúncio para quem já cansou —, então ganha destaque de verdade, não uma nota
//   de rodapé.
// - ALERTA sozinho: pede ação por si.
// - ATENÇÃO: observação; fica discreta.
function blocoSaude(item) {
  const s = item.saude;
  if (!s || (s.nivel !== 'alerta' && s.nivel !== 'atencao')) return '';
  if (item.conflito) {
    return `<p class="gtf-saude conflito"><b>Atenção:</b> ${esc(s.porque)} O robô sugeriu subir mesmo assim — vale conferir antes de aprovar.</p>`;
  }
  // Item que nasceu DA saúde já tem esse texto como justificativa; repetir seria
  // dizer a mesma coisa duas vezes no mesmo cartão.
  if (item.origem === 'saude') return '';
  return `<p class="gtf-saude ${s.nivel}">${esc(s.porque)}</p>`;
}

const diasAtras = (iso, agoraMs) => {
  const t = Date.parse(iso || '');
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.round((agoraMs - t) / 86400000));
};

// A quebra por conjunto de um item ABO — o que o dono vê ANTES de aprovar.
// Fica dobrada num <details>: em lista, abrir a quebra de todos de uma vez
// empurraria as decisões seguintes pra fora da tela. Devolve '' quando é CBO
// (aplica direto na campanha) ou quando não há conjunto.
function blocoConjuntos(item) {
  const partes = item.conjuntos && item.conjuntos.length
    ? distribuirEntreConjuntos(item.conjuntos, item.budget_sugerido_centavos)
    : [];
  if (!partes.length) return '';
  const linhas = partes.map((p) => `
    <tr>
      <td class="gtf-cj-nome">${esc(p.nome || '—')}</td>
      <td class="gtf-cj-de">${reais(p.deCentavos)}</td>
      <td class="gtf-cj-seta">→</td>
      <td class="gtf-cj-para">${reais(p.paraCentavos)}</td>
    </tr>`).join('');
  return `
    <details class="gtf-conjuntos">
      <summary>O orçamento está em ${partes.length} conjunto${partes.length > 1 ? 's' : ''} — ver como fica cada um</summary>
      <table class="gtf-cj-tabela"><tbody>${linhas}</tbody></table>
    </details>`;
}

// UMA LINHA por sugestão (pedido do dono, 2026-07-29: lista, não blocos). A
// linha carrega o essencial na horizontal — conta, campanha, de → para, ação —
// e o que é leitura (justificativa, quebra por conjunto) desce abaixo, sem
// disputar espaço com a decisão.
// Os criativos sem tração da campanha, dobrados. Cada um com o motivo e os
// números que o robô olhou — sem isso "pausar" seria um pedido de fé.
function blocoCriativos(item, editavel) {
  const lista = item.criativos || [];
  if (!lista.length) return '';
  // SÓ o nome e o motivo. O motivo já traz os números que o robô olhou, na
  // janela DELE — mostrar CTR/gasto ao lado, vindos dos últimos 30 dias, punha
  // dois valores diferentes de CTR na mesma linha ("CTR 1,52%" seguido de "CTR
  // 1,11% e CPC R$ 2,49 abaixo do padrão"). Um número que contradiz o outro a um
  // centímetro de distância destrói a confiança nos dois.
  // A LUPA (pedido do dono, 2026-08-03): a fila dizia "3 criativos sem tração" e
  // a pessoa tinha de acreditar. O modal de prévia já existia na lista de
  // anúncios da campanha — aqui ele só passou a ser alcançável de onde a decisão
  // é tomada. Mostra o anúncio RENDERIZADO, não a nossa descrição dele.
  const linhas = lista.map((c) => `
    <li class="gtf-cr">
      <span class="gtf-cr-nome">${esc(c.nome || c.ad_id)}</span>
      ${c.porque ? `<span class="gtf-cr-pq">${esc(c.porque)}</span>` : ''}
      ${editavel && c.ad_id ? `<button class="gtf-cr-lupa" data-gtf-lupa="${esc(c.ad_id)}" data-gtf-lupa-nome="${esc(c.nome || '')}" title="Ver o anúncio como ele aparece">🔍 ver</button>` : ''}
    </li>`).join('');
  const n = lista.length;
  return `
    <details class="gtf-criativos">
      <summary>${n} criativo${n > 1 ? 's' : ''} sem tração — ver ${n > 1 ? 'quais' : 'qual'}</summary>
      <ul class="gtf-cr-lista">${linhas}</ul>
      ${editavel ? `<button class="gtf-btn pausar-criativos" data-gtf-criativos="1">Pausar ${n > 1 ? `os ${n}` : 'o criativo'}</button>` : ''}
    </details>`;
}

// AS TRÊS ESCOLHAS, lado a lado (pedido do dono, 2026-08-03).
//
// Antes havia UMA: a que o robô escolheu. Quem discordava não tinha caminho —
// para baixar uma verba que o robô mandou subir era preciso dispensar a sugestão
// e ir mexer na aba Campanhas. Na prática, a fila decidia.
//
// A recomendada fica DESTACADA, não sozinha: o conselho do robô é informação
// útil, mas não pode ser o único caminho aberto.
//
// O impacto de cada uma vai no `title` E numa linha abaixo do grupo, porque
// `title` não existe em tela de toque — e a explicação é justamente o que o dono
// pediu junto com os botões.
function blocoAcoes(item, opcoes) {
  const o = opcoes || {};
  // Pausar não é uma das três, mas continua existindo quando o robô recomenda:
  // tirar o botão seria tirar uma capacidade que a fila já tinha.
  const pausar = item.veredito === 'pausar'
    ? `<button class="gtf-btn aprovar pausar" data-gtf-acao="pausar" title="A campanha para de rodar hoje. O que já foi gasto não volta.">Pausar campanha</button>`
    : '';
  // A RECOMENDADA VEM CHEIA, as outras vêm apagadas (pedido do dono,
  // 2026-08-03: "deixe evidente qual a recomendação da IA e aí chamando menos
  // atenção os botões inversos"). O caminho contrário continua a UM clique — o
  // que muda é o peso visual, não o acesso.
  const bt = (op, cor) => {
    if (!op) return '';
    const rec = o.recomendada === op.chave;
    const classes = rec ? `aprovar${cor} recomendada` : `alternativa${cor}`;
    return `<button class="gtf-btn ${classes}" data-gtf-acao="${op.chave}" title="${esc(op.impacto)}">`
      + `${rec ? '<span class="gtf-estrela" aria-hidden="true">★</span> ' : ''}${esc(op.rotulo)}</button>`;
  };
  return `
    <div class="gtf-acoes">
      ${bt(o.subir, '')}
      ${bt(o.baixar, ' reduzir')}
      ${pausar}
      <button class="gtf-btn alternativa" data-gtf-acao="manter" title="${esc(o.manter.impacto)}">Manter como está</button>
    </div>`;
}

// A explicação de cada escolha, por extenso e sempre visível.
// Fica FORA do `title` porque tela de toque não tem o que passar o mouse — e foi
// o dono quem pediu "explique o impacto caso eu escolha qualquer uma delas".
function blocoImpactos(opcoes, editavel) {
  const o = opcoes || {};
  if (!editavel || (!o.subir && !o.baixar)) return '';
  // O TEXTO DA IA VEM PRIMEIRO E SOZINHO NA LINHA; a conta (de → para, no mês)
  // desce para uma linha menor embaixo. O dono foi direto: "não é pra falar só
  // de orçamento... senão conta de porcentagem eu mesmo fazia". A conta continua
  // porque o valor mensal é o que se sente — mas ela não é a informação.
  const linha = (op, rotulo) => {
    if (!op) return '';
    const conta = op.conta && op.daIA ? `<span class="gtf-conta-simples">${esc(op.conta)}</span>` : '';
    const piso = op.noPiso ? ' <i>(o valor parou no mínimo que a Meta aceita)</i>' : '';
    return `<li${o.recomendada === op.chave ? ' class="rec"' : ''}>`
      + `<b>${esc(rotulo || op.rotulo)}</b>${o.recomendada === op.chave ? ' <span class="gtf-tag-rec">recomendado</span>' : ''}`
      + `<span class="gtf-impacto-txt">${esc(op.impacto)}${piso}</span>${conta}</li>`;
  };
  // Quando NENHUM texto veio da IA, a lista é a conta — e isso fica dito. Vender
  // multiplicação como análise seria pior que não ter o bloco.
  const semIA = ![o.subir, o.baixar, o.manter].some((x) => x && x.daIA);
  return `
    <details class="gtf-impactos">
      <summary>O que acontece em cada escolha</summary>
      <ul>
        ${linha(o.subir)}
        ${linha(o.baixar)}
        ${linha(o.manter)}
      </ul>
      <p class="gtf-passo-origem">${esc(frasePasso(o))}${semIA ? ' A leitura de impacto desta linha ainda não foi feita pela IA — o que está acima é só a conta.' : ''}</p>
    </details>`;
}

// O GASTO DE VERDADE, ao lado do teto (pedido do dono, 2026-08-03).
//
// A fila mostrava só ORÇAMENTO — o teto que se autoriza. Gasto é outra coisa, e
// a diferença entre os dois é a informação: campanha com teto de R$ 230 que
// gastou R$ 104 ontem não vai gastar mais só porque o teto sobe.
//
// O botão abre o detalhamento; o número fica na linha porque ler a fila sem
// abrir nada já tem de dizer o essencial.
function blocoGasto(item) {
  const g = gastoDaLinha(item.gastos);
  if (!g) return '';
  const uso = usoDoOrcamento(item.gastos, item.budget_atual_centavos);
  return `
    <div class="gtf-gasto${uso && uso.aperta ? ' sobrando' : ''}">
      <span class="gtf-gasto-num">${esc(g.texto)}</span>
      <button class="gtf-gasto-btn" data-gtf-gastos="1" title="Ver o gasto por período">gastos</button>
    </div>`;
}

function linha(item, agoraMs, editavel) {
  const v = VEREDITO[item.veredito] || { texto: item.veredito, cor: 'neutro' };
  const opcoes = opcoesDaLinha(item);
  // Quem propôs: o robô (padrão) ou a leitura de saúde da própria ferramenta.
  // Dizer isso importa porque item de saúde não traz valor sugerido — ninguém
  // calculou um número ali.
  const fonte = item.origem === 'saude' ? 'saúde da campanha' : 'robô';
  // Só dá pra APROVAR o que tem uma ação concreta: um valor novo de orçamento ou
  // uma pausa. Alerta de saúde do tipo "reduzir" não traz número — ninguém
  // calculou um —, então não existe botão de aplicar: seria um botão que promete
  // agir e não sabe o quê. Ali o caminho é o dono ajustar na aba Campanhas.
  const podeAplicar = item.veredito === 'pausar' || item.budget_sugerido_centavos != null;
  const de = item.budget_atual_centavos;
  const para = item.budget_sugerido_centavos;
  const pct = (de > 0 && para > 0) ? Math.round(((para - de) / de) * 100) : null;
  // O botão DIZ O QUE VAI FAZER, com o número. "Aprovar" sozinho é ambíguo numa
  // linha que corta verba — o dono perguntou "e tem o botão reduzir também?"
  // justamente olhando uma sugestão de reduzir (2026-07-29). Ler o botão tem que
  // bastar para saber o que acontece ao clicar; o valor no texto é a última
  // chance de perceber que se está aprovando o número errado.
  const rotuloAcao = item.veredito === 'pausar' ? 'Pausar'
    : item.veredito === 'reduzir' ? `Baixar para ${reais(para)}`
    : `Subir para ${reais(para)}`;
  const idade = diasAtras(item.gerado_em, agoraMs);
  const valores = item.veredito === 'pausar'
    ? `<span class="gtf-pausar-nota">para de rodar</span>`
    : para == null
    // Item vindo da saúde não tem número sugerido: mostra só o que se gasta hoje.
    // Inventar um valor multiplicando o atual seria chutar.
    ? `<span class="gtf-para">${reais(de)}</span><span class="gtf-hoje">hoje</span>`
    : `<span class="gtf-de">${reais(de)}</span><span class="gtf-seta">→</span><span class="gtf-para">${reais(para)}</span>${pct != null ? `<span class="gtf-pct ${pct < 0 ? 'neg' : ''}">${pct > 0 ? '+' : ''}${pct}%</span>` : ''}`;

  return `
    <li class="gtf-item ${v.cor}${item.conflito ? ' conflito' : ''}" data-gtf-id="${esc(item.campaign_id)}">
      <div class="gtf-linha">
        <span class="gtf-selo">${esc(v.texto)}</span>
        <div class="gtf-ident">
          <span class="gtf-nome">${esc(item.campaign_name || item.campaign_id)}</span>
          <span class="gtf-conta">${esc(item.conta_nome || '')} · ${esc(fonte)}${idade == null ? '' : ` · ${idade === 0 ? 'hoje' : idade === 1 ? 'ontem' : `há ${idade} dias`}`}</span>
          <!-- O GASTO FICA COLADO NO NOME (pedido do dono, 2026-08-03), e não na
               ponta direita junto das ações. É informação sobre a campanha, como
               a conta e a data — quem lê o nome quer saber quanto ela está
               gastando ali mesmo, não do outro lado da linha. -->
          ${blocoGasto(item)}
        </div>
        <div class="gtf-valores">${valores}</div>
        ${editavel ? blocoAcoes(item, opcoes) : '<span class="gtf-sem-permissao" title="Só quem tem permissão de editar a Gestão de Tráfego pode aprovar ou recusar.">você não tem permissão para decidir</span>'}
      </div>
      ${item.justificativa ? `<p class="gtf-just">${esc(item.justificativa)}</p>` : ''}
      ${blocoSaude(item)}
      ${(() => { const u = usoDoOrcamento(item.gastos, item.budget_atual_centavos); return u && u.aperta ? `<p class="gtf-uso">${esc(u.texto)}</p>` : ''; })()}
      ${blocoImpactos(opcoes, editavel)}
      ${blocoCriativos(item, editavel)}
      ${editavel && !opcoes.subir && !opcoes.baixar ? '<p class="gtf-sem-numero">Esta campanha não tem orçamento conhecido: ajuste na aba Campanhas, ou mantenha como está.</p>' : ''}
      ${item.impacto_estimado ? `<p class="gtf-impacto"><b>Impacto esperado:</b> ${esc(item.impacto_estimado)}</p>` : ''}
      ${blocoConjuntos(item)}
    </li>`;
}

// opcoes: { pendentes, vencidas, silenciadas, contas, contaFiltro, agora,
//           editavel, aoAprovar(item, botao, opcao), aoRecusar(item, botao),
//           aoVerCriativo(item, adId, nome), aoVerGastos(item, botao),
//           aoFiltrar(contaId), ajudaBtn }
// O QUE A META ESTA RECLAMANDO. Fora da lista de decisoes pelo mesmo motivo do
// farol: nao ha o que aprovar, e o numero da aba conta DECISOES pendentes.
//
// MEDIDO em 12/08/2026: 13 problemas reais nas 7 contas, e NENHUM aparecia na
// tela — inclusive 5 conjuntos que a Meta pausou sozinha. Dinheiro parado que
// ninguem via.
function problemasDaMeta(o) {
  const grupos = o.problemas || [];
  if (!grupos.length) return '';
  const linhas = grupos.map((g) => `
    <li class="gtf-pb-item ${g.grave ? 'gtf-pb--grave' : 'gtf-pb--leve'}">
      <div class="gtf-pb-cab">
        <span class="gtf-pb-tit">${esc(g.titulo)}</span>
        <span class="gtf-pb-selo">${g.grave ? 'impede de rodar' : 'roda com limitação'}</span>
        <span class="gtf-pb-quantos">${g.quantos} ${g.nivel === 'conjunto' ? (g.quantos > 1 ? 'conjuntos' : 'conjunto') : (g.quantos > 1 ? 'anúncios' : 'anúncio')}</span>
      </div>
      ${g.detalhe ? `<p class="gtf-pb-det">${esc(g.detalhe)}</p>` : ''}
      ${g.oQueFazer ? `<p class="gtf-pb-fazer"><b>O que fazer:</b> ${esc(g.oQueFazer)}</p>` : ''}
      ${g.onde.length ? `<p class="gtf-pb-onde">${esc(g.onde.slice(0, 6).join(' · '))}${g.onde.length > 6 ? ` … e mais ${g.onde.length - 6}` : ''}</p>` : ''}
    </li>`).join('');
  return `
    <section class="gtf-pb">
      <h3 class="gtf-pb-h">A Meta está reclamando de alguns anúncios</h3>
      <p class="gtf-pb-frase">${esc(o.fraseProblemas || '')}</p>
      <ul class="gtf-pb-lista">${linhas}</ul>
      <p class="gtf-pb-nota">Isto vem direto da Meta, e não muda nada sozinho — o conserto é no Gerenciador de Anúncios. Recusa por política, quando houver, aparece aqui também.</p>
    </section>`;
}

// O FAROL DE PÚBLICO — leitura da conta, fora da lista de decisões.
//
// FICA FORA DA LISTA de propósito: ele aparece mesmo quando o veredito é
// "manter" (pedido do dono), e o número da aba conta DECISÕES pendentes. Somar
// aqui faria a aba dizer que há trabalho esperando quando não há.
//
// NÃO TEM BOTÃO DE APROVAR: a leitura é da conta inteira, e aplicar idade em
// todos os conjuntos de uma vez reiniciaria o aprendizado de todas as campanhas
// juntas. Mesma política do alerta de saúde. O que ele oferece é levar a receita
// pronta pro editor de público.
function leituraDePublico(o) {
  // ⚠️ `reais()` deste arquivo recebe CENTAVOS (a fila inteira fala em centavos).
  // Aqui os números vêm do Graph em REAIS — passar por ele mostraria R$ 4,30 onde
  // são R$ 430,14. Formatador próprio, e o nome diz a unidade.
  const emReais = (v) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const L = o.leituraPublico;
  if (!L) return '';
  const conta = o.contaNome ? ` — ${esc(o.contaNome)}` : '';
  const selo = { ajustar: 'gtf-lp--ajustar', manter: 'gtf-lp--manter', 'sem-dados': 'gtf-lp--neutro' }[L.veredito] || 'gtf-lp--neutro';

  const linhas = (L.faixas || []).map((f) => `
    <tr class="${f.confiavel ? '' : 'gtf-lp-fraca'}">
      <td>${esc(f.faixa)}</td>
      <td class="gtf-lp-num">${emReais(f.gasto)}</td>
      <td class="gtf-lp-num">${Number(f.resultados || 0).toLocaleString('pt-BR')}</td>
      <td class="gtf-lp-num">${emReais(f.custo)}</td>
      <td>${f.confiavel ? '' : 'poucos dados'}</td>
    </tr>`).join('');

  const receita = L.receita ? `
    <div class="gtf-lp-receita">
      <b>Se virar público novo:</b> idade de ${L.receita.idadeMin} a ${L.receita.idadeMax} anos${
        L.receita.cidades.length ? `, ${L.receita.cidades.length} cidade${L.receita.cidades.length > 1 ? 's' : ''}` : ''}${
        L.receita.interesses.length ? ` e ${L.receita.interesses.length} interesse${L.receita.interesses.length > 1 ? 's' : ''}` : ''}.
      ${L.receita.porqueDosConjuntos ? `<span class="gtf-lp-porque">${esc(L.receita.porqueDosConjuntos)}</span>` : ''}
      <button class="gtf-btn gtf-lp-usar" type="button">Usar este público numa campanha nova</button>
    </div>` : '';

  return `
    <section class="gtf-lp ${selo}">
      <div class="gtf-lp-cab">
        <h3 class="gtf-lp-tit">Leitura de público${conta}</h3>
        <span class="gtf-lp-janela">últimos 90 dias${L.contando ? ` · contando ${esc(L.contando)}` : ''}</span>
      </div>
      <p class="gtf-lp-titulo2">${esc(L.titulo)}</p>
      <p class="gtf-lp-frase">${esc(L.frase)}</p>
      ${L.fraseDoDinheiro ? `<p class="gtf-lp-dinheiro">${esc(L.fraseDoDinheiro)}</p>` : ''}
      ${L.alerta ? `<p class="gtf-lp-alerta">${esc(L.alerta)}</p>` : ''}
      ${linhas ? `<table class="gtf-lp-tabela"><thead><tr><th>Idade</th><th class="gtf-lp-num">Gasto</th><th class="gtf-lp-num">Resultados</th><th class="gtf-lp-num">Custo</th><th></th></tr></thead><tbody>${linhas}</tbody></table>` : ''}
      ${receita}
      <p class="gtf-lp-nota">Esta leitura não muda nada sozinha: mexer na idade de todos os conjuntos de uma vez reiniciaria o aprendizado de todas as campanhas juntas.</p>
    </section>`;
}

export function montarPainelFila(alvo, opcoes) {
  const o = opcoes || {};
  const agoraMs = Date.parse(o.agora || '') || Date.now();
  const pendentes = o.pendentes || [];
  const vencidas = o.vencidas || [];
  const silenciadas = o.silenciadas || [];
  const editavel = !!o.editavel;
  const ajudaBtn = typeof o.ajudaBtn === 'function' ? o.ajudaBtn : () => '';

  // QUEM FILTRA É O SELETOR DA TOPBAR (pedido do dono, 2026-07-29). A fila tinha
  // botões próprios de conta, que duplicavam um seletor que já existe logo
  // acima — dois controles pra mesma coisa, e o de cima com saldo e gasto de
  // cada conta.
  //
  // O preço disso é perder a visão das cinco de uma vez, e por isso o que está
  // nas OUTRAS contas continua sendo dito: some da lista, não do conhecimento.
  const filtroAtual = o.contaFiltro == null ? '' : String(o.contaFiltro);
  const visiveis = filtroAtual ? pendentes.filter((i) => String(i.account_id || '') === filtroAtual) : pendentes;

  const noutrasContas = new Map();
  for (const i of pendentes) {
    const k = String(i.account_id || '');
    if (k === filtroAtual) continue;
    noutrasContas.set(k, (noutrasContas.get(k) || 0) + 1);
  }
  const nomeDaConta = (id) => {
    const c = (o.contas || []).find((x) => String(x.id) === String(id));
    return c ? (c.display_name || c.name || '—') : 'outra conta';
  };
  const totalFora = [...noutrasContas.values()].reduce((a, b) => a + b, 0);
  const avisoOutras = totalFora
    ? `<div class="gtf-outras">Mais ${totalFora} em ${[...noutrasContas.entries()].map(([id, n]) => `<b>${esc(nomeDaConta(id))}</b> (${n})`).join(', ')} — troque a conta lá em cima para ver.</div>`
    : '';

  const blocoPublico = leituraDePublico(o);

  // "Não carregou" e "está vazio" NÃO são a mesma coisa. Dizer "nada esperando
  // decisão" quando a leitura ainda não terminou é afirmar que não há o que
  // decidir — e foi exatamente o que a tela fez quando a fila rodou antes de as
  // contas chegarem (2026-07-29). Quem chama passa `carregou`.
  const carregou = o.carregou !== false;
  const corpo = visiveis.length
    ? visiveis.map((i) => linha(i, agoraMs, editavel)).join('')
    : !carregou
    ? `<div class="gtf-vazio">
         <b>Carregando suas campanhas…</b>
         <span>Assim que elas chegarem, mostro aqui o que está esperando decisão.</span>
       </div>`
    // A fila vazia DIZ o que o robô fez. Sem isso, "nada esperando decisão" é
    // indistinguível de "o robô não rodou nesta conta" — foi o que aconteceu com
    // a Mantova (item 1 da lista do dono): ele analisou e disse 'manter' nas
    // duas campanhas ativas, e 'manter' não entra na fila.
    : `<div class="gtf-vazio">
         <b>Nada esperando decisão${filtroAtual ? ` em ${esc(o.contaNome || 'nesta conta')}` : ''}.</b>
         ${o.explicacaoVazia ? `<span>${esc(o.explicacaoVazia)}</span>` : ''}
         <span>O robô analisa as campanhas toda madrugada. Quando ele propuser mexer em orçamento, aparece aqui.</span>
       </div>`;

  alvo.innerHTML = `
    <div class="gtf-cab">
      <div>
        <h2 class="gtf-tit">Esperando sua decisão${ajudaBtn('fila')}</h2>
        <p class="gtf-sub">${o.contaNome ? `${esc(o.contaNome)} · ` : ''}o robô propõe, você decide. Nada mexe no orçamento sem passar por aqui.</p>
      </div>
    </div>
    <ul class="gtf-lista">${corpo}</ul>
    ${avisoOutras}
    ${vencidas.length ? `
      <details class="gtf-extra">
        <summary>${vencidas.length} sugest${vencidas.length > 1 ? 'ões vencidas' : 'ão vencida'}</summary>
        <p class="gtf-extra-nota">O robô parou de reanalisar estas campanhas, então o número é antigo. Ficam aqui para você não perder de vista uma campanha esquecida.</p>
        <ul class="gtf-lista">${vencidas.map((i) => linha(i, agoraMs, editavel)).join('')}</ul>
      </details>` : ''}
    ${silenciadas.length ? `
      <div class="gtf-silenciadas">${silenciadas.length} sugest${silenciadas.length > 1 ? 'ões recusadas voltam' : 'ão recusada volta'} a aparecer se a situação continuar.</div>` : ''}
    ${/* OCULTO A PEDIDO DO DONO (18/08/2026, à noite).

           Ele não pediu este card. O pedido dele, em 12/08, era outro: DESCOBRIR
           por que os criativos estavam sendo rejeitados. A medição daquele dia
           não achou recusa por política nenhuma, e o que se construiu no lugar
           foi um painel de monitoramento do `issues_info` — útil, mas não é o
           que ele perguntou. Ele deixou isso claro ao ver o card.

           SÓ O DESENHO SAIU. A leitura e a gravação em `gt_problemas_meta`
           continuam: é a única memória de recusa que existe, porque a Meta APAGA
           o `issues_info` quando o anúncio some ou o problema é resolvido. Jogar
           fora a coleta seria apagar justamente o material que responde à
           pergunta original dele.

           Para trazer de volta, é só descomentar. */''}
    ${blocoPublico}
  `;

  if (!editavel) return;
  const todos = pendentes.concat(vencidas);
  for (const el of alvo.querySelectorAll('[data-gtf-id]')) {
    const item = todos.find((i) => String(i.campaign_id) === el.dataset.gtfId);
    if (!item) continue;
    const cr = el.querySelector('[data-gtf-criativos]');
    if (cr && o.aoPausarCriativos) cr.addEventListener('click', () => o.aoPausarCriativos(item, cr));

    // AS TRÊS ESCOLHAS (mais 'pausar', quando o robô recomenda). Cada botão diz
    // no `data-gtf-acao` qual é, e a mesma opção calculada vai junto — assim
    // quem trata o clique não recalcula o valor e não corre o risco de aplicar
    // um número diferente do que o botão mostrava.
    const opcoes = opcoesDaLinha(item);
    for (const b of el.querySelectorAll('[data-gtf-acao]')) {
      const acao = b.dataset.gtfAcao;
      if (acao === 'manter') {
        // 'Manter' é o antigo 'Dispensar' renomeado (confirmado pelo dono,
        // 2026-08-03): mesma gravação, nome que uma pessoa entende.
        if (o.aoRecusar) b.addEventListener('click', () => o.aoRecusar(item, b));
      } else if (o.aoAprovar) {
        const opcao = acao === 'pausar' ? { chave: 'pausar', alvoCentavos: null } : opcoes[acao];
        b.addEventListener('click', () => o.aoAprovar(item, b, opcao));
      }
    }

    const gb = el.querySelector('[data-gtf-gastos]');
    if (gb && o.aoVerGastos) gb.addEventListener('click', (ev) => { ev.stopPropagation(); o.aoVerGastos(item, gb); });

    // A LUPA de cada criativo travado.
    for (const lp of el.querySelectorAll('[data-gtf-lupa]')) {
      if (!o.aoVerCriativo) break;
      lp.addEventListener('click', (ev) => {
        // O botão mora dentro de um <details>; sem isto o clique fecharia a
        // lista de criativos ao mesmo tempo que abre o modal.
        ev.preventDefault(); ev.stopPropagation();
        o.aoVerCriativo(item, lp.dataset.gtfLupa, lp.dataset.gtfLupaNome || '');
      });
    }
  }

  // O FAROL. Fora do laço das linhas: ele não pertence a item nenhum — é a
  // leitura da conta. Fica ligado mesmo sem permissão de editar, porque abrir o
  // formulário de campanha nova não muda nada sozinho.
  // `querySelectorAll` e não `querySelector`: o contrato deste painel com quem o
  // chama é innerHTML + querySelectorAll (está escrito no topo do teste). Alargar
  // o contrato por um botão faria o teste precisar de um DOM de verdade.
  for (const usar of alvo.querySelectorAll('.gtf-lp-usar')) {
    if (!o.aoUsarPublico) break;
    usar.addEventListener('click', () => o.aoUsarPublico());
  }
}
