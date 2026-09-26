// Aba "A régua": as tabelas que governam a métrica ponderada em toda a ferramenta.
// Não fala com o banco — recebe a régua pronta e devolve a editada pelo callback.
// O EXEMPLO VIVO ao lado é o ponto: sem ele o dono editaria peso no escuro.
//
// FIDELIDADE: este arranjo espelha a planilha de origem do dono
// (metrica_ponderada.xlsx), cuja aba Config tem exatamente três blocos —
// PESOS POR MÉTRICA, METAS DE CUSTO POR OBJETIVO e LIMIARES DE DECISÃO. A tela
// agora tem DUAS SEÇÕES, uma por MUNDO (decisão do dono, 2026-07-28, revisando
// o arranjo anterior):
//  - Seção 1, "Engajamento ponderado": o bloco Config inteiro, mas só da parte
//    de engajamento — pesos, o custo por objetivo (as quatro interações MAIS o
//    "engajamento ponderado", que é o custo por PONTO) e os limiares que
//    decidem a cor a partir DESSAS metas. Vale pra toda campanha de
//    engajamento até o dono declarar, no cartão dela, o que ela está
//    comprando.
//  - Seção 2, "Metas por resultado": os demais objetivos — reconhecimento,
//    tráfego, mensagens, leads, vendas — cada um com sua meta de custo por
//    resultado, e os limiares que decidem a cor a partir DESSAS metas.
//
// POR QUE DUAS SEÇÕES E DOIS CONJUNTOS DE LIMIAR: a régua tem duas metas de
// natureza diferente (custo por PONTO de um lado, custo por RESULTADO do
// outro) — e o dono quer poder dizer "escalar forte" em 0,8× pra engajamento
// e 0,9× pra vendas, sem que ajustar um mexa no outro. A REGRA que resume tudo
// isso, e que vale lembrar em qualquer alteração futura: QUEM É DONO DA META É
// DONO DO LIMIAR. `limiares` (Seção 1) multiplica a meta de engajamento/
// interação; `limiares_resultado` (Seção 2) multiplica a meta de resultado —
// nunca o contrário.
//
// (A planilha lista sete pesos; só quatro existem por campanha no Meta Ads —
// o porquê está em ponderada.js, onde os pesos são montados; não repetir aqui.)
//
// ATUALIZAÇÃO 24/09/2026 — a ponderada foi PAUSADA (decisão do dono, ver o
// bloco de `engajamento` em alvos.js): o veredito de campanha de engajamento
// SEM interação declarada não usa mais o ponto ponderado, e sim o custo por
// engajamento bruto. A linha de meta de engajamento saiu da Seção 1 e foi
// para a Seção 2 (chave `engajamento_bruto`, ver ALVOS.engajamento.chaveMeta).
// A Seção 1 CONTINUA na tela — pesos, meta antiga (`metas.engajamento`) e
// limiares intactos — porque campanha com INTERAÇÃO DECLARADA (curtida,
// comentário, salvamento, compartilhamento) ainda é julgada por eles; só o
// ponto ponderado composto (a leitura "no geral", sem declaração) parou de
// decidir. Por isso o aviso no topo da Seção 1 (ver `avisoPausa` abaixo) fala
// em "por padrão" — a seção não virou decoração, só deixou de ser a REGRA
// geral.
import { pastilha } from './pastilha.js';
import { calcularPonderada, PESOS_PADRAO, LIMIARES_PADRAO } from './ponderada.js';
import { metaDoBalde } from './regua.js';
import { ALVOS, alvoDoBalde, avaliarAlvo } from './alvos.js';
// Metas por interação (Fase 3): ALVOS e INTERACOES são DUAS listas que gravam na
// MESMA regua.metas — os baldes são 'engajamento/trafego/...' e as interações são
// 'curtidas/comentarios/...', então as chaves nunca colidem (ver Task 3 do plano
// 2026-07-28-meta-ads-objetivo-por-interacao-f3.md).
import { INTERACOES } from './interacoes.js';
import { resumoPersona, fraseDaPersona, limparPersona, MAXIMO as PERSONA_MAXIMO } from './persona-da-marca.js';

// Só estas quatro: são exatamente as chaves de PESOS_PADRAO. Visita foi
// tentada e RETIRADA a pedido do dono — o porquê de cada peso (e de por que só
// quatro, contra os sete da planilha de origem) está em ponderada.js, onde os
// pesos são montados; não repetir aqui. Não readicionar um rótulo aqui sem
// readicionar o peso lá.
const ROTULO_PESO = {
  curtidas: 'Curtida', comentarios: 'Comentário',
  salvamentos: 'Salvamento', compartilhamentos: 'Compartilhamento',
};
const ROTULO_BALDE = {
  engajamento: 'Engajamento', trafego: 'Tráfego', reconhecimento: 'Reconhecimento',
  mensagens: 'Mensagens', leads: 'Leads', vendas: 'Vendas',
};
// Voltaram a ser editáveis (decisão do dono, 2026-07-28): a tela mostra onde a cor
// muda e ele quer poder mover isso. Cada campo é um MULTIPLICADOR da meta que a
// SUA seção governa — sozinho ele não diz nada ("0,8" de quê?), por isso o preview
// ao lado converte pra reais em tempo real (ver pintarLimiaresSecao1/2). O rótulo
// serve pras DUAS tabelas de limiar (Seção 1 e Seção 2): é a mesma pergunta —
// "até quanto da meta" —, só a meta por trás é que muda.
const ROTULO_LIMIAR = {
  escalarForte: 'Escalar forte até',
  dentroMeta: 'Dentro da meta até',
  manter: 'Manter e observar até',
};
// Cada faixa com o texto e a cor do selo. Sem emoji: a tela usa cor e forma,
// não figurinha (é a regra da casa em elemento visual).
const FAIXA = {
  'escalar-forte': { texto: 'Escalar forte', cor: 'bom' },
  'dentro-da-meta': { texto: 'Dentro da meta', cor: 'bom' },
  'manter': { texto: 'Manter e observar', cor: 'meio' },
  'otimizar': { texto: 'Otimizar ou pausar', cor: 'ruim' },
  'sem-dados': { texto: 'Sem dados suficientes', cor: 'neutro' },
};
const reais = (v) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inteiro = (v) => Number(v || 0).toLocaleString('pt-BR');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// `formato` é a unidade que mora DENTRO da caixa do campo — vem direto de
// ALVOS[balde].unidade ('R$' hoje, pra toda meta) na linha de meta; peso e
// limiar não têm unidade (são números puros), então chamam sem este argumento.
// Sem ela o número fica solto e o rótulo precisa carregar a unidade, o que
// alongava a linha.
function campo(id, valor, passo, editavel, formato) {
  const prefixo = formato || '';
  if (!editavel) {
    // Custo-alvo é dinheiro: mostra "R$ 0,20" igual ao exemplo vivo ao lado,
    // não o número cru. Peso e limiar ficam como número puro (sem unidade).
    const texto = prefixo === 'R$' ? reais(valor === '' ? null : valor) : esc(valor);
    return `<span class="pnd-valor">${texto}</span>`;
  }
  const pre = prefixo ? `<span class="pnd-pre">${prefixo}</span>` : '';
  return `<span class="pnd-campo">${pre}<input class="pnd-input" id="${esc(id)}" type="number" min="0" step="${passo}" value="${esc(valor)}"></span>`;
}

// Baldes da Seção 2: TODO ALVO (ATUALIZAÇÃO 24/09/2026 — antes era todo ALVO
// MENOS engajamento; agora engajamento entrou aqui também, porque passou a
// ser julgado por RESULTADO, custo por engajamento bruto, não mais pelo ponto
// ponderado). Mantém a ORDEM de ALVOS — é a mesma ordem usada pra achar o
// primeiro com meta salva, no preview dos limiares da Seção 2.
const BALDES_SECAO2 = Object.keys(ALVOS);

// Tira o "Custo por " do rótulo do alvo pra virar sufixo do preview ("por
// conversa iniciada", "por lead"...) — nunca um texto novo, só o que ALVOS já
// diz encurtado pra caber ao lado do valor em reais.
function sufixoDoAlvo(balde) {
  const rotulo = (ALVOS[balde] && ALVOS[balde].rotulo) || '';
  return rotulo.replace(/^Custo por\s*/i, 'por ');
}

// DESAMBIGUAÇÃO DE RÓTULO REPETIDO (24/09/2026): "mensagens" e "leads" usam o
// MESMO rótulo — "Custo por lead" — desde que o dono decidiu chamar conversa
// de WhatsApp aberta de lead (ver o comentário de `mensagens` em alvos.js).
// No CARTÃO da campanha isso é exatamente o que ele quer ler. Mas aqui, na
// régua, as duas viram DUAS LINHAS VIZINHAS na mesma tabela — sem desambiguar,
// ele digitaria a meta na linha errada sem ter como perceber (as duas leem
// "Custo por lead"). NÃO mexe em ALVOS[...].rotulo (o cartão continua igual):
// a mudança fica só na montagem desta linha, juntando o nome do balde
// (ROTULO_BALDE, que já é único por construção) só quando há colisão de
// verdade — os demais rótulos, que já são únicos, saem sem sufixo nenhum.
function rotuloDaLinha(baldes) {
  const contagem = {};
  for (const b of baldes) {
    const r = ALVOS[b].rotulo;
    contagem[r] = (contagem[r] || 0) + 1;
  }
  const mapa = {};
  for (const b of baldes) {
    const a = ALVOS[b];
    mapa[b] = contagem[a.rotulo] > 1 ? `${a.rotulo} — ${ROTULO_BALDE[b] || b}` : a.rotulo;
  }
  return mapa;
}
const ROTULO_LINHA_SECAO2 = rotuloDaLinha(BALDES_SECAO2);

// A PERSONA DA MARCA — quem a conta atende, escrito pelo dono.
//
// POR QUE FICA AQUI: esta aba já é a configuração POR CONTA (as metas mudam de
// conta pra conta e o cabeçalho diz qual está aberta). A persona tem exatamente a
// mesma natureza, e é lida pela IA que sugere público.
//
// Botão PRÓPRIO, separado do "Salvar a régua": são coisas independentes, e um
// botão só faria quem quisesse corrigir uma vírgula na persona regravar as metas
// de verba junto.
function blocoPersona(o) {
  // Criterio PROPRIO: a RLS de `accounts` exige role='admin', enquanto a regua
  // aceita a permissao do Gestor. Sao tabelas diferentes com donos diferentes.
  const editavel = !!o.personaEditavel;
  const nome = o.nomeConta || '';
  if (!o.contaId) {
    return `<div class="pnd-grupo pnd-persona">
      <div class="pnd-grupo-cab"><h2 class="pnd-grupo-tit">${pastilha('pessoa')}Persona da marca</h2>
      <p class="pnd-grupo-sub">Escolha uma conta de anúncios lá em cima para escrever a persona dela.</p></div>
    </div>`;
  }
  const texto = typeof o.persona === 'string' ? o.persona : '';
  const r = resumoPersona(texto);
  return `<div class="pnd-grupo pnd-persona">
    <div class="pnd-grupo-cab"><h2 class="pnd-grupo-tit">${pastilha('pessoa')}Persona da marca${nome ? ` — ${esc(nome)}` : ''}</h2>
    <p class="pnd-grupo-sub">Para quem esta marca vende, nas suas palavras. A IA lê isto antes de sugerir idade, lugar e interesses — e o que estiver escrito aqui vale mais do que o padrão que ela encontrar nos números.</p></div>
    <p class="pnd-ajuda">Escreva como explicaria para uma pessoa nova na equipe: quem é, que idade tem de verdade, o que procura, e principalmente <b>o que NÃO combina</b> com a marca. É o "não combina" que impede a sugestão de idade que você vem corrigindo na mão.</p>
    <textarea class="pnd-persona-campo" id="pnd-persona" rows="10"
      data-conta-id="${esc(o.contaId)}"
      ${editavel ? '' : 'disabled'}
      placeholder="Ex.: Mulher de 30 a 55 anos, classe média, que compra bolsa de couro para usar no trabalho e em viagem. Valoriza durabilidade e acabamento, não moda passageira. NÃO é público teen nem de bolsa de festa barata.">${esc(texto)}</textarea>
    <p class="pnd-persona-conta" id="pnd-persona-conta">${r.caracteres} de ${PERSONA_MAXIMO} caracteres</p>
    <p class="pnd-ajuda" id="pnd-persona-frase">${esc(fraseDaPersona(texto, nome))}</p>
    ${editavel ? `
      <div class="pnd-persona-arquivo">
        <label class="pnd-persona-botao" for="pnd-persona-upload">Trazer de um arquivo…</label>
        <input type="file" id="pnd-persona-upload" accept=".txt,.md,.docx,.pdf" hidden>
        <span class="pnd-persona-status" id="pnd-persona-status"></span>
        <p class="pnd-ajuda" style="margin:6px 0 0">Vale .docx (Word), .txt e .md — esses são lidos aqui mesmo, na hora. O .pdf é lido pela IA no servidor e leva alguns segundos. <b>O texto entra no campo acima para você conferir e ajustar; nada é salvo até você clicar em Salvar.</b></p>
      </div>
      <button class="pnd-salvar" id="pnd-persona-salvar">Salvar a persona</button>`
      : '<p class="pnd-nota">Só quem é administrador pode editar a persona.</p>'}
  </div>`;
}

export function montarPainelRegua(alvo, opcoes) {
  const o = opcoes || {};
  const regua = o.regua;
  const editavel = !!o.editavel;
  // Fail-CLOSED de propósito: só conta como "carregou" quando quem chamou passar
  // `true` explicitamente. Isto controla um botão que grava valores de verba
  // reais em cima da linha única de produção — se quem chamou esquecer de
  // passar a opção (ou passar undefined), o padrão tem que ser "não confio",
  // nunca "confio". Antes o padrão era o oposto (fail-OPEN: `!== false`), e é
  // exatamente essa lacuna que permitia salvar `metas: {}` por cima da régua
  // real quando a leitura falhava em silêncio (ver C3 do review final, 2026-07-28).
  const carregouOk = o.carregouOk === true;
  const podeSalvar = editavel && carregouOk;
  const exemplos = o.exemplos || null;
  // De QUEM são as metas desta tela. Cada conta de anúncios tem a sua, porque
  // cada uma pratica um preço muito diferente: medido em 90 dias reais, o ponto
  // de engajamento custa R$ 0,013 na Vessel e R$ 0,372 na Breno Vale — 28× de
  // diferença. Sem o nome à vista, o dono editaria a régua de um cliente
  // achando que mexia na de todos.
  const nomeConta = String(o.nomeConta || '').trim();
  // O card de abertura explica a aba inteira — é longo de propósito, e quem já
  // entendeu não quer rolar por ele toda vez. Vira recolhível, e QUEM LEMBRA da
  // escolha é quem chamou (a tela, que já guarda o zoom em localStorage): este
  // módulo monta HTML e não lê `window`, mesmo motivo pelo qual o botão "?"
  // chega por injeção. Nasce ABERTO — na primeira visita o dono precisa da
  // explicação, e só depois de ler é que ele decide escondê-la.
  const introAberta = o.introAberta !== false;
  const aoAlternarIntro = typeof o.aoAlternarIntro === 'function' ? o.aoAlternarIntro : null;
  // Botão "?" de ajuda contextual (ver ajuda.js e _gtAjudaBtn na tela). Este
  // módulo é puro — só monta innerHTML, nunca lê `window` — então recebe a
  // função pronta de quem chama, em vez de importar do .vue (que importaria
  // este arquivo de volta) ou reimplementar aqui o HTML do botão. Sem o
  // parâmetro (ex.: chamada de teste), vira no-op — nunca quebra o painel.
  const ajudaBtn = typeof o.ajudaBtn === 'function' ? o.ajudaBtn : () => '';
  // O que a conta PAGA por engajamento, medido — mostrado ao lado da meta
  // nova (Seção 2), pra ela ser definida contra o real, e não no escuro. Puro:
  // este módulo não fala com o banco, então o número vem de quem chama. Sem
  // ele (ou inválido), NÃO mostra nada — nunca um traço solto nem um zero
  // inventado (regra da casa, item 9 do padrão: a tela nunca mente).
  const custoEngajamentoPraticado = (() => {
    const v = Number(o.custoEngajamentoPraticado);
    return Number.isFinite(v) && v >= 0 ? v : null;
  })();
  // NÃO é "hoje": o valor acima soma sobre o período que estiver selecionado
  // no filtro do topo da tela (HOJE/7D/30D/.../ATÉ AGORA), e "até agora" pode
  // ser um mês inteiro. Defeito real (rodada 1 de revisão, 24/09/2026):
  // rotular como "hoje" um número que na verdade é de ~24 dias fez a tela
  // mentir sobre a régua mais sensível que ela tem. Por isso o rótulo do
  // período é OBRIGATÓRIO junto do valor: quem chama sem ele ainda vê o
  // número, mas com uma frase honesta em vez de "hoje" chutado.
  const custoEngajamentoPraticadoPeriodo = String(o.custoEngajamentoPraticadoPeriodo || '').trim();

  const linhasPeso = Object.keys(PESOS_PADRAO).map((k) =>
    `<tr><td>${ROTULO_PESO[k]}</td><td>${campo('pnd-peso-' + k, regua.pesos[k], '1', editavel)}</td></tr>`).join('');

  // Uma linha por INTERAÇÃO (curtida/comentário/salvamento/compartilhamento).
  // Só serve pra campanha/anúncio de engajamento em que o dono DECLARAR, no
  // cartão dela, qual interação está comprando (ver o selo de objetivo no
  // cartão, tela-de-gestao-trafego.vue) — sem declaração nada muda, continua
  // julgada pelo custo por engajamento (bruto), na Seção 2.
  const linhasInteracao = Object.keys(INTERACOES).map((k) => {
    const it = INTERACOES[k];
    const temMeta = regua.metas[k] != null;
    const valor = temMeta ? regua.metas[k] : '';
    return `<tr>
      <td><div class="pnd-alvo-nome">${esc(it.rotulo)}</div><div class="pnd-alvo-ajuda">${esc(it.ajuda)}</div></td>
      <td>${campo('pnd-int-' + k, valor, '0.01', editavel, 'R$')}</td>
    </tr>`;
  }).join('');

  // A linha de "engajamento ponderado" (custo por PONTO) SAIU daqui (24/09/2026):
  // ela virou a meta nova de custo por engajamento, na Seção 2 (ver
  // ROTULO_LINHA_SECAO2/linhasMeta abaixo) — não é mais "mundo do ponto". A
  // tabela de custo da Seção 1 fica só com as quatro interações, que continuam
  // valendo para toda campanha que o dono DECLARAR (ver o aviso de pausa
  // logo acima desta seção, na montagem do HTML).
  const linhasCustoSecao1 = linhasInteracao;

  // Uma linha por objetivo da SEÇÃO 2 — reconhecimento, tráfego, mensagens,
  // leads, vendas e (24/09/2026) engajamento, cada uma na unidade do resultado
  // dele (ver alvos.js). Objetivo sem meta salva mostra o campo VAZIO com uma
  // nota — nunca um número de exemplo: campo vazio é honesto, número inventado
  // não. A CHAVE da meta (`a.chaveMeta || b`) é a mesma usada por `metaDoBalde`
  // em regua.js — só diverge do nome do balde em engajamento, cuja meta nova
  // mora em `engajamento_bruto` pra não sobrescrever a antiga (`engajamento`,
  // que só a Seção 1 ainda lê — ver pintarLimiaresSecao1 abaixo).
  const linhasMeta = BALDES_SECAO2.map((b) => {
    const a = ALVOS[b];
    const chave = a.chaveMeta || b;
    const temMeta = regua.metas[chave] != null;
    const valor = temMeta ? regua.metas[chave] : '';
    const nota = temMeta ? '' : '<div class="pnd-alvo-vazio">ainda sem histórico — defina quando começar a rodar esse tipo</div>';
    // "O que você paga", só quando quem chamou souber dizer (por enquanto só
    // engajamento, que acabou de trocar de régua) — ver custoEngajamentoPraticado
    // acima. O período vai SEMPRE junto do número, nunca "hoje" cravado: sem
    // ele, cai no honesto "no período selecionado" em vez de inventar uma
    // janela que não foi medida.
    const praticado = (b === 'engajamento' && custoEngajamentoPraticado != null)
      ? `<div class="pnd-limiar-prev">você paga ${reais(custoEngajamentoPraticado)} por engajamento — ${esc(custoEngajamentoPraticadoPeriodo || 'no período selecionado')}</div>` : '';
    return `<tr>
      <td><div class="pnd-alvo-nome">${esc(ROTULO_BALDE[b] || b)}</div><div class="pnd-alvo-ajuda">${esc(ROTULO_LINHA_SECAO2[b])} — ${esc(a.ajuda)}</div>${nota}</td>
      <td>${campo('pnd-meta-' + chave, valor, '0.01', editavel, a.unidade)}${praticado}</td>
    </tr>`;
  }).join('');

  // Limiares da SEÇÃO 1 (`limiares`): multiplicam a meta ANTIGA de engajamento
  // (custo por ponto, `regua.metas.engajamento`). CORREÇÃO (varredura de
  // comentários, 25/09/2026): não existe mais campo 'pnd-meta-engajamento'
  // NESTA tela para editar esse valor — a linha saiu em 24/09/2026 (ver
  // pintarLimiaresSecao1 abaixo, "sem campo nesta tela desde a pausa"); o
  // número vem congelado do que já estava salvo no banco.
  const linhasLimiar1 = Object.keys(LIMIARES_PADRAO).map((k) =>
    `<tr><td>${esc(ROTULO_LIMIAR[k])}</td><td>${campo('pnd-limiar-eng-' + k, regua.limiares[k], '0.05', editavel)}<div class="pnd-limiar-prev" id="pnd-limiar-eng-prev-${k}"></div></td></tr>`).join('');
  // Limiares da SEÇÃO 2 (`limiares_resultado`): multiplicam a meta de
  // resultado (lead/conversa/venda/visita/mil impressões) — CONJUNTO
  // INDEPENDENTE do de cima, mesma regra "quem é dono da meta é dono do limiar".
  const linhasLimiar2 = Object.keys(LIMIARES_PADRAO).map((k) =>
    `<tr><td>${esc(ROTULO_LIMIAR[k])}</td><td>${campo('pnd-limiar-res-' + k, regua.limiares_resultado[k], '0.05', editavel)}<div class="pnd-limiar-prev" id="pnd-limiar-res-prev-${k}"></div></td></tr>`).join('');

  // Ordem dos cartões: abertura explica o conceito → Seção 1 "Engajamento
  // ponderado" (pesos + custo por objetivo + limiares da própria seção) →
  // Seção 2 "Metas por resultado" (meta por objetivo + os limiares da própria
  // seção). O EXEMPLO VIVO ao lado depende da meta, então ela precisa ser lida
  // antes.
  alvo.innerHTML = `
    <details class="pnd-intro" id="pnd-intro"${introAberta ? ' open' : ''}>
      <summary class="pnd-intro-tit">O que é esta aba</summary>
        <div class="pnd-intro-corpo">
      <p>Aqui você diz <b>quanto aceita pagar por cada resultado</b>. É esse número que faz o cartão da campanha acender verde, amarelo ou vermelho lá na aba Campanhas.</p>
      <p>Existem duas formas de ler o preço. A <b>ponderada</b> é a leitura geral: soma curtida, comentário, salvamento e compartilhamento, cada um valendo o que você decidir, numa nota só. Ela responde "essa campanha comprou engajamento caro ou barato, no geral?". O <b>resultado</b> é a leitura fina: custo por lead, por conversa, por venda, por visita, por mil impressões — responde exatamente o que aquele tipo de campanha comprou.</p>
      <p>Qual das duas vale para uma campanha? Você decide lá em Campanhas, declarando no cartão dela o que ela está comprando. <b>A ponderada está em pausa desde 24/09/2026</b> (ver aviso na seção dela, abaixo): sem declarar, uma campanha de engajamento é julgada pelo custo por engajamento, na Seção "Metas por resultado". Declarando uma interação — curtida, comentário, salvamento ou compartilhamento —, vale o custo daquela interação, que você define na Seção "Engajamento ponderado".</p>
      <p>Peso e meta respondem perguntas diferentes: o <b>peso</b> diz quanto aquilo vale pra você, a <b>meta</b> diz quanto você aceita pagar por aquilo. Por isso, quando você declara uma interação, o peso não entra na conta — quem decide é só a meta.</p>
      <p>Cada seção abaixo tem sua PRÓPRIA meta e seu PRÓPRIO limiar de cor: "escalar forte" pode valer 0,8× numa e 0,9× na outra, sem uma mexer na outra.</p>
      <p><b>As metas são de cada cliente, separadamente.</b> Um mesmo resultado custa preços muito diferentes de uma conta pra outra, então uma meta só valendo pra todas diria mais sobre de quem é a conta do que sobre a campanha ir bem. Os pesos e as cores, esses valem pra todo mundo: peso é o quanto uma interação <i>vale</i>, não o quanto ela <i>custa</i>.</p>
    </div>
      </details>
    ${nomeConta ? `<div class="pnd-conta-tag">Você está editando as metas de <b>${esc(nomeConta)}</b>. Trocar de conta lá em cima troca estes números.</div>`
      : `<div class="pnd-conta-tag pnd-conta-tag--vazio">Escolha uma conta de anúncios lá em cima para ver e editar as metas dela.</div>`}
    <div class="pnd-regua">
      <div>
        <div class="pnd-grupo pnd-g-engaj">
          <div class="pnd-grupo-cab"><h2 class="pnd-grupo-tit">${pastilha('contato')}Engajamento ponderado${nomeConta ? ` — ${esc(nomeConta)}` : ''}${ajudaBtn('ponto')}</h2>
          <p class="pnd-grupo-sub">A leitura geral. Vale para campanha de engajamento só quando você declarar, no cartão dela, qual interação ela está comprando.</p>
          <div class="pnd-conta-tag pnd-conta-tag--vazio">Em pausa desde 24/09/2026: por padrão, o veredito de engajamento passou a ser <b>custo por engajamento</b>, editado em "Metas por resultado" (Seção 2, abaixo). <b>Nada foi apagado</b> — pesos, meta antiga e limiares desta seção continuam aqui, intocados, e só voltam a decidir o veredito quando você declarar, no cartão da campanha, que ela compra uma curtida, comentário, salvamento ou compartilhamento específico.</div></div>
          <div class="pnd-cards">
            <div class="pnd-bloco">
              <div class="pnd-cab"><h3 class="pnd-titulo">Quanto vale cada interação</h3>${ajudaBtn('pesos')}</div>
              <p class="pnd-ajuda">Uma curtida vale 1 ponto. Um salvamento vale 30 — é como dizer que salvar equivale a 30 curtidas. Só importa quando a campanha tem interação declarada (ver aviso acima).</p>
              <table class="pnd-tabela"><tbody>${linhasPeso}</tbody></table>
            </div>
            <div class="pnd-bloco">
              <div class="pnd-cab"><h3 class="pnd-titulo">Quanto você aceita pagar</h3>${ajudaBtn('meta_interacao')}</div>
              <p class="pnd-ajuda">Vale só quando você declara, no cartão da campanha, qual interação ela está comprando — aí o preço é o daquela interação, mercados diferentes: hoje uma curtida sai por R$ 0,12 e um salvamento por R$ 48. Sem declarar, o veredito é o custo por engajamento, na Seção 2.</p>
              <table class="pnd-tabela"><tbody>${linhasCustoSecao1}</tbody></table>
            </div>
            <div class="pnd-bloco">
              <div class="pnd-cab"><h3 class="pnd-titulo">Quando cada cor acende</h3>${ajudaBtn('cores')}</div>
              <p class="pnd-ajuda">Multiplicadores da meta de cada interação declarada. O valor em reais abaixo de cada um usa a meta antiga de custo por ponto (congelada — sem campo nesta tela desde a pausa), pro dia de religar a ponderada.</p>
              <table class="pnd-tabela"><tbody>${linhasLimiar1}</tbody></table>
            </div>
          </div>
        </div>
        <div class="pnd-grupo pnd-g-result">
          <div class="pnd-grupo-cab"><h2 class="pnd-grupo-tit">${pastilha('placar')}Metas por resultado${nomeConta ? ` — ${esc(nomeConta)}` : ''}</h2>
          <p class="pnd-grupo-sub">A leitura fina. Uma meta por tipo de campanha e os limiares que, a partir dela, decidem quando a cor muda.</p></div>
          <div class="pnd-cards">
            <div class="pnd-bloco">
              <div class="pnd-cab"><h3 class="pnd-titulo">Quanto você aceita pagar por resultado</h3>${ajudaBtn('meta_resultado')}</div>
              <p class="pnd-ajuda">Uma linha por tipo de campanha, cada uma na unidade do resultado que ela compra. É esse número que dispara a decisão de verba.</p>
              <table class="pnd-tabela"><tbody>${linhasMeta}</tbody></table>
            </div>
            <div class="pnd-bloco">
              <div class="pnd-cab"><h3 class="pnd-titulo">Quando cada cor acende</h3>${ajudaBtn('cores')}</div>
              <p class="pnd-ajuda">Multiplicadores da meta de resultado ao lado — um conjunto PRÓPRIO, independente do de engajamento. O preview usa a primeira meta preenchida na tabela ao lado.</p>
              <table class="pnd-tabela"><tbody>${linhasLimiar2}</tbody></table>
            </div>
          </div>
        </div>
        ${editavel ? (
          podeSalvar
            ? '<button class="pnd-salvar" id="pnd-salvar">Salvar a régua</button>'
            : '<button class="pnd-salvar" id="pnd-salvar" disabled>Salvar a régua</button><p class="pnd-nota">Ainda não consegui confirmar a régua que está salva no banco. Recarregue a página antes de editar — salvar agora arriscaria apagar a meta de verdade.</p>'
        ) : '<p class="pnd-nota">Você não tem permissão para editar a régua.</p>'}
        ${blocoPersona(o)}
      </div>
      <div class="pnd-exemplo" id="pnd-exemplo"></div>
    </div>`;

  // Lê o que está nos campos AGORA (ou a régua atual, quando só-leitura).
  function reguaDaTela() {
    if (!editavel) return regua;
    const ler = (id, padrao) => {
      const el = document.getElementById(id);
      const n = el ? Number(el.value) : NaN;
      return (Number.isFinite(n) && n > 0) ? n : padrao;
    };
    const pesos = {}, metas = {}, limiares = {}, limiares_resultado = {};
    // Se o dono apagar um campo sem querer, o valor volta pro que a régua JÁ TINHA
    // (não pro padrão de fábrica) — senão um peso 50 customizado vira 30 no silêncio.
    for (const k of Object.keys(PESOS_PADRAO)) pesos[k] = ler('pnd-peso-' + k, regua.pesos[k]);
    // Percorre ALVOS (não ROTULO_BALDE nem regua.metas) — é a MESMA lista que
    // desenhou as linhas de meta, todas na Seção 2 agora (24/09/2026). Um
    // balde fora de ALVOS não tem <input> na tela: 'pnd-meta-<chave>' não
    // existe no DOM, `ler` devolve o padrão 0, e a linha abaixo não grava a
    // chave. Resultado: salvar a régua também limpa qualquer meta antiga
    // guardada por engano num balde sem alvo — o que é o comportamento certo,
    // essas metas nunca deveriam existir (ver M do review final, 2026-07-28).
    //
    // GRAVA NA CHAVE DO ALVO (`a.chaveMeta || balde`), NUNCA no nome do balde
    // cru: é a MESMA regra que `metaDoBalde` (regua.js) usa pra LER. Sem isto,
    // o campo 'pnd-meta-engajamento_bruto' (que o dono preencheu) gravaria em
    // `metas.engajamento` — apagando a meta ANTIGA do ponto (que tem que
    // sobreviver intacta, pra pausa da ponderada ser reversível) — e a meta
    // NOVA cairia numa chave que ninguém lê, parecendo "não salvou".
    for (const b of Object.keys(ALVOS)) {
      const chave = (ALVOS[b] && ALVOS[b].chaveMeta) || b;
      const v = ler('pnd-meta-' + chave, 0);
      if (v > 0) metas[chave] = v;
    }
    // A META ANTIGA da ponderada (`metas.engajamento`, R$ por PONTO) não tem
    // mais campo nesta tela — a Seção 1 virou aviso (ver o topo dela). Sem
    // copiar ela aqui, salvar a régua a APAGARIA em silêncio, porque este
    // objeto nasce vazio e só recebe o que tem <input> na tela agora. Ela
    // PASSA por fora do laço acima, intocada, até o dia de religar a
    // ponderada (ver o comentário no topo do arquivo e em alvos.js).
    if (regua.metas && regua.metas.engajamento != null) metas.engajamento = regua.metas.engajamento;
    // Mesma lógica, agora para as METAS POR INTERAÇÃO (Task 3): percorre
    // INTERACOES (a MESMA lista que desenhou linhasInteracao), gravando na
    // MESMA `metas` — balde ('engajamento'...) e interação ('curtidas'...)
    // nunca colidem, então as duas listas convivem no mesmo objeto sem
    // sobrescrever uma a outra.
    for (const k of Object.keys(INTERACOES)) { const v = ler('pnd-int-' + k, 0); if (v > 0) metas[k] = v; }
    // DOIS conjuntos de limiar, cada um lido dos SEUS próprios campos
    // ('pnd-limiar-eng-*' pra Seção 1, 'pnd-limiar-res-*' pra Seção 2) — a
    // mesma lista de chaves (LIMIARES_PADRAO) desenha as duas tabelas, então
    // leitura e escrita nunca divergem em nenhuma das duas. Fallback pro que a
    // régua JÁ TINHA nesse conjunto, nunca pro multiplicador de fábrica nem
    // pro valor do OUTRO conjunto — leitura e escrita têm que falar da MESMA
    // lista, senão salvar apaga o que estava fora da tela.
    for (const k of Object.keys(LIMIARES_PADRAO)) limiares[k] = ler('pnd-limiar-eng-' + k, regua.limiares[k]);
    for (const k of Object.keys(LIMIARES_PADRAO)) limiares_resultado[k] = ler('pnd-limiar-res-' + k, regua.limiares_resultado[k]);
    return { pesos, metas, limiares, limiares_resultado };
  }

  // Converte cada limiar da SEÇÃO 1 em reais, ao vivo, contra a meta ANTIGA de
  // engajamento (`metas.engajamento`, R$ por ponto). DE PROPÓSITO continua
  // lendo a chave crua `engajamento` (NÃO `metaDoBalde`, que devolveria a meta
  // NOVA via `chaveMeta` — outra régua, outra unidade): 24/09/2026, a linha
  // que editava esse campo saiu da tela (virou aviso), mas o valor sobrevive
  // em `regua.metas.engajamento` (ver reguaDaTela) e este preview continua
  // mostrando o que os multiplicadores da ponderada significam, pro dia de
  // religar ela. Trocar para a chave nova quebraria essa memória.
  function pintarLimiaresSecao1(r) {
    const metaEng = Number(r.metas && r.metas.engajamento) || 0;
    for (const k of Object.keys(LIMIARES_PADRAO)) {
      const el = document.getElementById('pnd-limiar-eng-prev-' + k);
      if (!el) continue;
      const mult = Number(r.limiares[k]);
      el.textContent = (metaEng > 0 && Number.isFinite(mult) && mult > 0)
        ? `× ${mult.toLocaleString('pt-BR')} = ${reais(mult * metaEng)}`
        // Curto de proposito: este aviso divide a linha com o rotulo ('Manter e
        // observar ate'), e um texto longo aqui espremia o rotulo em tres linhas.
        // Some quando a conta nao tem meta antiga salva — o caso normal de
        // conta que nunca rodou a ponderada (ex.: Mantova, sem histórico).
        // CORREÇÃO (revisão final da Onda B, 25/09/2026): dizia "defina a
        // meta acima", mas o campo que editava `metas.engajamento` (R$ por
        // ponto) saiu desta tela em 24/09/2026 — ver o comentário 3 linhas
        // acima ("sem campo nesta tela desde a pausa"). Mandar "definir" um
        // campo que não existe mais era instrução impossível de seguir.
        : 'sem meta antiga salva';
    }
  }

  // O primeiro balde da Seção 2 (na MESMA ordem da tabela de metas) que tem
  // meta > 0 preenchida — é a base do preview dos limiares dali. Sem meta
  // NENHUMA preenchida na seção, não existe número pra multiplicar; melhor
  // mostrar só o multiplicador cru do que inventar um valor (regra da casa:
  // nunca inventar número).
  //
  // LÊ PELA CHAVE DO ALVO (`metaDoBalde`, a MESMA resolução de `regua.js`),
  // NUNCA `r.metas[b]` cru — defeito real (revisão da Tarefa 3, 24/09/2026):
  // como `engajamento` é o primeiro balde de `ALVOS`, e toda conta que já
  // rodou a ponderada tem `metas.engajamento` (a meta ANTIGA, R$/ponto)
  // salva, ler pelo nome cru do balde pegava sempre essa meta velha como
  // base do preview — mesmo com a meta NOVA (`engajamento_bruto`) preenchida.
  // O rótulo saía certo ("por engajamento") e o número saía calculado contra
  // a unidade errada: uma tela que mente com toda a confiança de uma que diz
  // a verdade. `metaDoBalde` é exatamente a função que já existe pra não
  // duplicar essa resolução (ver reguaDaTela, mais acima, que grava do lado
  // oposto pela mesma chave).
  function primeiroAlvoComMeta(r) {
    for (const b of BALDES_SECAO2) {
      const v = metaDoBalde(r, b);
      if (Number.isFinite(v) && v > 0) return { balde: b, meta: v };
    }
    return null;
  }

  // Converte cada limiar da SEÇÃO 2 em reais, ao vivo, contra a PRIMEIRA meta
  // de resultado preenchida — CONJUNTO independente do da Seção 1 (usa
  // `limiares_resultado`, nunca `limiares`). O rótulo do preview mostra de
  // qual meta ele veio ("por conversa iniciada", "por lead"...), porque aqui,
  // ao contrário da Seção 1, existem várias metas possíveis e sem dizer qual
  // o número ficaria ambíguo.
  function pintarLimiaresSecao2(r) {
    const base = primeiroAlvoComMeta(r);
    for (const k of Object.keys(LIMIARES_PADRAO)) {
      const el = document.getElementById('pnd-limiar-res-prev-' + k);
      if (!el) continue;
      const mult = Number(r.limiares_resultado[k]);
      const multValido = Number.isFinite(mult) && mult > 0;
      if (!multValido) { el.textContent = 'defina o multiplicador'; continue; }
      if (!base) { el.textContent = `× ${mult.toLocaleString('pt-BR')}`; continue; }
      el.textContent = `× ${mult.toLocaleString('pt-BR')} = ${reais(mult * base.meta)} ${sufixoDoAlvo(base.balde)}`;
    }
  }

  // EXEMPLO VIVO: um bloco por OBJETIVO que a conta roda, com campanha real.
  // O dono pediu depois de olhar a régua: ele precisa ver como CADA tipo de
  // campanha vai ser julgado, não só o tipo da mais cara.
  function blocoDeExemplo(ex, r) {
    // Dois tipos de exemplo, porque a régua tem dois tipos de meta:
    //  - 'objetivo'  -> meta do balde (custo por lead, conversa, venda, visita,
    //    engajamento…) — `metaDoBalde` já resolve pela CHAVE certa (ver
    //    regua.js), então engajamento aqui já lê `engajamento_bruto`.
    //  - 'interacao' -> meta por curtida/comentário/salvamento/compartilhamento
    const chave = ex.chave || ex.balde;
    const meta = metaDoBalde(r, chave);
    const alvoObj = ex.tipo === 'interacao' ? null : alvoDoBalde(chave);
    // CONFERIDO EM 24/09/2026 (a métrica de engajamento trocou de seção): esta
    // linha continua fazendo exatamente o que promete. Antes, só `engajamento`
    // tinha `metrica === 'ponderada'`; hoje NENHUM alvo tem mais essa métrica
    // (engajamento virou 'custo_engajamento', ver alvos.js) — então `ehPonderada`
    // dá sempre `false`, e é isso que se quer: o exemplo de engajamento passa a
    // usar `ex.custo` (o custo por engajamento já calculado por quem chamou,
    // linha abaixo) em vez de recalcular pontos ao vivo. O exemplo de
    // INTERAÇÃO DECLARADA (curtida/comentário/salvamento/compartilhamento)
    // não depende desta variável — ele cai no `|| ex.tipo === 'interacao'`
    // logo abaixo, que continua igual: aquele mercado não foi pausado.
    const ehPonderada = !!alvoObj && alvoObj.metrica === 'ponderada';
    // QUAL CONJUNTO DE LIMIAR: interação declarada é Seção 1 (`limiares`);
    // todo o resto — os objetivos de resultado da Seção 2, engajamento
    // (24/09/2026) incluído — usa `limiares_resultado`. Mesma regra do
    // veredito real em tela-de-gestao-trafego.vue: quem é dono da meta é dono
    // do limiar.
    const limiaresDoExemplo = (ehPonderada || ex.tipo === 'interacao') ? r.limiares : r.limiares_resultado;
    const c = calcularPonderada(ex.quantidades, { pesos: r.pesos, limiares: limiaresDoExemplo, meta: ehPonderada ? meta : 0 });
    const custo = ehPonderada ? c.custoPorPonto : (ex.custo != null ? ex.custo : null);
    const aval = avaliarAlvo({ custo, meta, limiares: limiaresDoExemplo });
    const faixa = FAIXA[aval.faixa] || FAIXA['sem-dados'];
    const rotulo = ex.rotulo || (alvoObj ? alvoObj.rotulo : 'Custo por resultado');
    const titulo = ex.titulo || ROTULO_BALDE[chave] || chave;
    // Detalhe: engajamento mostra a quebra das interações (que muda ao vivo com os
    // pesos); os demais mostram a quantidade do resultado que compraram.
    const detalhe = ehPonderada
      ? `<tr><td>Curtidas</td><td>${inteiro(ex.quantidades.curtidas)}</td></tr>
         <tr><td>Comentários</td><td>${inteiro(ex.quantidades.comentarios)}</td></tr>
         <tr><td>Salvamentos</td><td>${inteiro(ex.quantidades.salvamentos)}</td></tr>
         <tr><td>Compartilhamentos</td><td>${inteiro(ex.quantidades.compartilhamentos)}</td></tr>
         <tr class="forte"><td>Pontos${ajudaBtn('ponto')}</td><td>${inteiro(c.pontos)}</td></tr>`
      : (ex.detalhe || []).map((d) => `<tr class="forte"><td>${esc(d.rotulo)}</td><td>${d.valor == null ? '—' : inteiro(d.valor)}</td></tr>`).join('');
    const cortes = meta > 0 ? `
        <div class="pnd-ex-regua">
          <div class="pnd-ex-corte"><span class="pnd-ponto bom"></span>até ${reais(meta * limiaresDoExemplo.escalarForte)} — escalar forte</div>
          <div class="pnd-ex-corte"><span class="pnd-ponto bom"></span>até ${reais(meta * limiaresDoExemplo.dentroMeta)} — dentro da meta</div>
          <div class="pnd-ex-corte"><span class="pnd-ponto meio"></span>até ${reais(meta * limiaresDoExemplo.manter)} — manter e observar</div>
          <div class="pnd-ex-corte"><span class="pnd-ponto ruim"></span>acima disso — otimizar ou pausar</div>
        </div>` : '';
    const legenda = meta > 0
      ? `${rotulo} · sua meta é ${reais(meta)}`
      : `${rotulo} · sem meta definida aqui`;
    return `
      <div class="pnd-ex-bloco${ex.tipo === 'interacao' ? ' interacao' : ''}">
        <div class="pnd-ex-topo">
          <div class="pnd-ex-rot">${esc(titulo)}</div>
          <div class="pnd-ex-nome">${esc(ex.nome)}</div>
          <div class="pnd-ex-num">${reais(custo)}</div>
          <div class="pnd-ex-leg">${esc(legenda)}</div>
          <span class="pnd-ex-selo ${faixa.cor}">${faixa.texto}</span>${ajudaBtn('cores')}
          ${cortes}
        </div>
        <div class="pnd-ex-corpo">
          <table class="pnd-tabela"><tbody>
            <tr><td>Gasto</td><td>${reais(ex.quantidades.gasto)}</td></tr>
            ${detalhe}
          </tbody></table>
        </div>
      </div>`;
  }


  function pintarExemplo() {
    const caixa = document.getElementById('pnd-exemplo');
    if (!caixa) return;
    const lista = exemplos || [];
    if (!lista.length) {
      caixa.innerHTML = `
        <div class="pnd-ex-bloco"><div class="pnd-ex-topo">
          <div class="pnd-ex-rot">Como fica na prática</div>
          <div class="pnd-ex-nome">Ainda estou carregando suas campanhas. Assim que chegarem, mostro aqui um exemplo real de cada tipo que você roda.</div>
        </div></div>`;
      return;
    }
    const r = reguaDaTela();
    caixa.innerHTML = `
      <div class="pnd-ex-cab">
        <div class="pnd-ex-cab-tit">${pastilha('leitura')}Como fica na prática</div>
        <div class="pnd-ex-cab-sub">Um exemplo real de cada tipo de campanha que você roda. Mexa nos campos ao lado e veja mudar.</div>
      </div>
      ${lista.map((ex) => blocoDeExemplo(ex, r)).join('')}`;
  }

  // Repinta os três: o preview dos limiares da Seção 1, o da Seção 2 e o
  // exemplo vivo (lateral). Os três dependem da MESMA leitura da tela — uma
  // tecla em qualquer campo (peso, limiar de qualquer seção, meta de balde ou
  // meta de interação) precisa mover todos.
  function atualizarTela() {
    const r = reguaDaTela();
    pintarLimiaresSecao1(r);
    pintarLimiaresSecao2(r);
    pintarExemplo();
  }

  // Recolher/abrir o card de abertura. Fora do `if (editavel)` de propósito:
  // quem só olha a régua também rola a tela, e esconder a explicação não é uma
  // edição da régua. O painel remonta a cada troca de conta e a cada save, então
  // sem avisar quem chamou o card voltaria a abrir sozinho toda vez.
  const intro = document.getElementById('pnd-intro');
  if (intro && aoAlternarIntro) intro.addEventListener('toggle', () => aoAlternarIntro(intro.open));

  if (editavel) {
    alvo.querySelectorAll('.pnd-input').forEach((el) => el.addEventListener('input', atualizarTela));
    const botao = document.getElementById('pnd-salvar');
    // Além do atributo `disabled` no HTML, nem liga o listener quando a leitura do
    // banco não foi confirmada — dupla trava contra salvar em cima de dado errado.
    if (botao && podeSalvar) botao.addEventListener('click', () => o.aoSalvar && o.aoSalvar(reguaDaTela(), botao));
  }

  // PERSONA: FORA do `if (editavel)` acima de propósito. Quem manda aqui é
  // `personaEditavel` (role='admin', o que a RLS de `accounts` exige) e não a
  // permissão da régua — presas juntas, um admin sem permissão de editar a régua
  // veria o campo e o botão e nenhum dos dois responderia ao clique.
  // O botão é PRÓPRIO: salvar a persona não pode regravar as metas de verba junto.
  // NOME PRÓPRIO, e isto NÃO é preciosismo: enquanto esta variável se chamava
  // `campo`, ela sombreava o ajudante `campo(...)` do módulo (lá em cima, que
  // desenha os campos de peso). `const` vale para a função INTEIRA, inclusive
  // ANTES da linha onde aparece — então o uso lá em cima passava a apontar para
  // esta declaração, que ainda não existia, e o painel morria com
  // "Cannot access 'campo' before initialization". A aba "A régua" ficou
  // totalmente morta de 12/08 até 13/08 por causa disto. Guardado por
  // painel-regua.test.mjs.
  const campoPersona = document.getElementById('pnd-persona');
  if (campoPersona && o.personaEditavel) {
    const conta = document.getElementById('pnd-persona-conta');
    const frase = document.getElementById('pnd-persona-frase');
    const repintar = () => {
      const r = resumoPersona(campoPersona.value);
      if (conta) {
        conta.textContent = `${r.caracteres} de ${PERSONA_MAXIMO} caracteres`;
        conta.classList.toggle('pnd-persona-conta--estourou', r.excedeu);
      }
      if (frase) frase.textContent = fraseDaPersona(campoPersona.value, o.nomeConta || '');
    };
    campoPersona.addEventListener('input', repintar);
    const bp = document.getElementById('pnd-persona-salvar');
    if (bp) bp.addEventListener('click', () => o.aoSalvarPersona && o.aoSalvarPersona(limparPersona(campoPersona.value), bp));

    // TRAZER DE UM ARQUIVO. O texto cai NO CAMPO, não no banco: a pessoa confere e
    // ajusta antes de salvar. Encher o banco direto de um arquivo que ninguém leu
    // seria gravar o que a extração inventou.
    const upload = document.getElementById('pnd-persona-upload');
    if (upload && o.aoLerArquivo) {
      // POR QUE ESTE TRECHO NÃO USA AS VARIÁVEIS DE CIMA (medido em 13/08/2026):
      // ler um PDF passa pela IA e leva de 10 a 60 SEGUNDOS. Nesse meio-tempo o
      // painel pode se redesenhar sozinho — `loadGtData` remonta a régua quando
      // termina de carregar a conta, e trocar de conta faz o mesmo. O redesenho
      // TROCA os elementos: as referências capturadas aqui viram elementos
      // órfãos, fora da tela.
      //
      // Era exatamente isso que acontecia: a edge devolvia o texto com 200, o
      // código escrevia num campo que ninguém mais via, e o dono ficava olhando
      // um campo vazio SEM NENHUM AVISO — tendo pago a leitura da IA. Medido
      // duas vezes: subindo com a tela ainda carregando, o texto sumia; com a
      // tela parada, chegava.
      //
      // Então, DEPOIS do await, tudo é procurado de novo pelo id. E confere-se a
      // conta: se a tela trocou de conta enquanto a IA lia, escrever aqui
      // colocaria a persona de uma marca dentro de outra.
      const contaDoPedido = String(o.contaId);
      const achar = (id) => document.getElementById(id);
      const dizer = (texto) => { const s = achar('pnd-persona-status'); if (s) s.textContent = texto; };

      upload.addEventListener('change', async () => {
        const arquivo = upload.files && upload.files[0];
        if (!arquivo) return;
        dizer('Lendo…');
        try {
          const lido = await o.aoLerArquivo(arquivo);
          const campoAgora = achar('pnd-persona');
          if (!campoAgora) {
            dizer('Saí da tela da régua enquanto lia o arquivo. Abra de novo e suba outra vez.');
            return;
          }
          if (campoAgora.dataset.contaId !== contaDoPedido) {
            // NÃO escreve: seria a persona de uma marca no campo de outra.
            dizer('A tela trocou de conta enquanto eu lia o arquivo. Volte para a conta certa e suba de novo.');
            return;
          }
          campoAgora.value = lido;
          // Repinta contador e frase a partir dos elementos DE AGORA.
          const r = resumoPersona(campoAgora.value);
          const contaAgora = achar('pnd-persona-conta');
          if (contaAgora) {
            contaAgora.textContent = `${r.caracteres} de ${PERSONA_MAXIMO} caracteres`;
            contaAgora.classList.toggle('pnd-persona-conta--estourou', r.excedeu);
          }
          const fraseAgora = achar('pnd-persona-frase');
          if (fraseAgora) fraseAgora.textContent = fraseDaPersona(campoAgora.value, o.nomeConta || '');
          dizer(`Trouxe ${lido.length} caracteres. Confira e clique em Salvar.`);
        } catch (e) {
          dizer(String((e && e.message) || e));
        } finally {
          // Zera o input: sem isto, escolher O MESMO arquivo de novo não dispara
          // `change`, e a pessoa acha que a tela travou.
          upload.value = '';
        }
      });
    }
  }
  atualizarTela();
}
