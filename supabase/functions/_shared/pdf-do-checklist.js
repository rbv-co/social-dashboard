/* O PAPEL DA FICHA ASSINADA — o PDF que vai pro Zoho (D23).
 *
 * Desenho: docs/superpowers/specs/2026-08-06-frota-checklist-assinatura-design.md
 *
 * O QUE ESTE ARQUIVO É: lógica pura, sem rede e sem banco. Recebe a ficha já
 * lida e devolve (a) as linhas do documento e (b) os bytes do PDF. Quem busca
 * os dados e quem sobe pro Zoho é o robô da fila — separado de propósito, pra
 * que o conteúdo do documento possa ser conferido por teste sem depender de
 * uma empresa de fora estar no ar.
 *
 * POR QUE UM GERADOR DE PDF ESCRITO À MÃO, e não uma biblioteca: o documento é
 * texto em uma coluna, e é isso. Toda biblioteca de PDF que renderiza layout
 * pesa megabytes e entra no tempo de partida de uma Edge Function que roda de
 * poucos em poucos minutos. O formato usado aqui (Type1 Helvetica/Courier, uma
 * página por vez, sem imagem) é a parte mais antiga e mais estável do PDF —
 * abre em qualquer leitor desde 1994.
 *
 * A REGRA QUE MANDA NESTE ARQUIVO: o papel não pode discordar do sistema.
 * O instante da assinatura sai de `instanteCanonico` — a MESMA função que
 * entrou na impressão digital. Os textos dos itens saem das RESPOSTAS
 * gravadas (congeladas, D13), nunca da lista de itens de hoje: se o gestor
 * renomear um item amanhã, a ficha de hoje tem de continuar dizendo o que foi
 * realmente perguntado hoje. */

import { instanteCanonico, tempoDePreenchimento } from './assinatura.js';
import { normalizarRabisco } from './rabisco.js';

/* ── Formatação de números, datas e horas ─────────────────────────────────── */

// `feita_em` é DATE. Vem como texto 'AAAA-MM-DD' e é partido como texto —
// nunca por `new Date()`, que interpretaria em UTC e mostraria o dia anterior
// pra quem está em Brasília.
export function dataPorExtenso(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto ?? ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(texto ?? '');
}

/**
 * O instante, no fuso de quem lê o papel (Brasília, UTC-3 o ano inteiro — o
 * Brasil não tem mais horário de verão).
 *
 * NUNCA usa `toLocaleString`: o fuso de uma Edge Function é UTC, e o de quem
 * gerar isso na máquina de casa é outro. O papel tem de sair igual dos dois.
 */
export function horaDeBrasilia(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const d = new Date(t - 3 * 3600 * 1000);
  const p2 = (n) => String(n).padStart(2, '0');
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} `
    + `às ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}

// 123456 -> "123.456". Feito à mão pra não depender de locale instalado.
const comPonto = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function tempoPorExtenso(segundos) {
  if (segundos === null || segundos === undefined) return null;
  if (segundos < 0) return null;             // relógio torto: não inventa duração
  if (segundos < 60) return `${segundos} segundos`;
  const min = Math.floor(segundos / 60), s = segundos % 60;
  return s === 0 ? `${min} minutos` : `${min} minutos e ${s} segundos`;
}

const ROTULO_RESULTADO = {
  liberado: 'Liberado', com_ressalvas: 'Com ressalvas', nao_liberado: 'Não liberado',
};
const ROTULO_ESTADO = { ok: 'OK', nao_ok: 'PROBLEMA', na: 'Não se aplica' };
const ROTULO_CADENCIA = { diario: 'diário', semanal: 'semanal', mensal: 'mensal' };
const ROTULO_SEM_ASSINATURA = {
  sem_login: 'quem conferiu não tem login próprio no aplicativo',
};

/* ── O conteúdo do documento ──────────────────────────────────────────────── */

/**
 * As linhas do papel, na ordem em que saem.
 *
 * Cada linha é `{ estilo, texto }`. Os estilos existem pra hierarquia visual e
 * são traduzidos em fonte/tamanho lá embaixo, em `montarPdf`.
 *
 * `donoNome` é de quem é o carro; `assinanteNome` é quem assinou. Os dois
 * podem ser pessoas DIFERENTES de quem preencheu (D21b: quem administra
 * preenche a ficha de qualquer carro e assina com a própria senha), e é
 * justamente por isso que o papel traz os dois: registrar só um deles deixaria
 * o documento sugerindo que o dono do carro foi quem olhou.
 *
 * Nada aqui é inventado: campo que não veio sai como "não informado", nunca
 * como um nome plausível ou um traço mudo.
 */
export function linhasDoChecklist({ ficha, respostas, veiculo, donoNome, assinanteNome }) {
  const f = ficha || {};
  const v = veiculo || {};
  const itens = Array.isArray(respostas) ? respostas : [];
  const L = [];
  /* `extra` carrega o que a APRESENTAÇÃO precisa (o rótulo separado do valor, a
   * cor de um estado) sem tocar em `texto`, que continua sendo a frase inteira.
   * Isso não é gosto: os testes de conteúdo — e a doutrina deste arquivo — leem
   * `texto`, e o papel não pode passar a dizer outra coisa porque ficou bonito.
   * O visual mudou em 13/08/2026 a pedido do dono; o conteúdo, não. */
  const put = (estilo, texto, extra) => L.push({ estilo, texto, ...(extra || {}) });

  put('titulo', 'Checklist de primeiro escalão');
  put('subtitulo', 'Documento gerado pela Central de Inteligência RBV a partir da ficha assinada. '
    + 'O conteúdo abaixo é o que foi gravado no dia, e não pode mais ser alterado.');

  put('secao', 'O carro e o dia');
  put('campo', `Carro: ${v.nome || 'não informado'}`, { rotulo: 'Carro', valor: v.nome || 'não informado' });
  put('campo', `Placa: ${v.placa || 'não informada'}`, { rotulo: 'Placa', valor: v.placa || 'não informada' });
  put('campo', `Data da conferência: ${dataPorExtenso(f.feita_em)}`,
    { rotulo: 'Data da conferência', valor: dataPorExtenso(f.feita_em) });
  const cadencias = (f.cadencias || []).map((c) => ROTULO_CADENCIA[c] || c);
  const tipo = cadencias.length ? cadencias.join(', ') : 'não informado';
  put('campo', `Tipo de conferência: ${tipo}`, { rotulo: 'Tipo de conferência', valor: tipo });
  const km = f.hodometro ? `${comPonto(f.hodometro)} km` : 'não informado';
  put('campo', `Hodômetro: ${km}`, { rotulo: 'Hodômetro', valor: km });
  if (f.hodometro_justificativa) {
    put('campo', `Por que o hodômetro contraria o anterior: ${f.hodometro_justificativa}`,
      { rotulo: 'Por que o hodômetro contraria o anterior', valor: f.hodometro_justificativa });
  }
  /* O RESULTADO SAI COMO SELO, e a cor é a mesma lógica da tela: verde libera,
   * laranja ressalva, vermelho não libera. Ele deixou de ser escolhido a dedo
   * (migration 044) — é a soma dos itens conferidos, e num documento que
   * responde por multa e por acidente essa é a linha que se lê primeiro. */
  const resultado = ROTULO_RESULTADO[f.resultado] || f.resultado || 'não informado';
  put('selo', `Resultado: ${resultado}`, {
    rotulo: 'Resultado',
    valor: resultado,
    tom: { liberado: 'verde', com_ressalvas: 'laranja', nao_liberado: 'vermelha' }[f.resultado] || 'fraca',
  });
  if (f.anomalias) {
    put('campo', `Anomalias registradas: ${f.anomalias}`,
      { rotulo: 'Anomalias registradas', valor: f.anomalias });
  }

  put('secao', `O que foi conferido (${itens.length} ${itens.length === 1 ? 'item' : 'itens'})`);
  if (itens.length === 0) {
    // Ficha sem resposta nenhuma é anormal e o papel DIZ isso, em vez de sair
    // com uma seção vazia que parece defeito de impressão.
    put('texto', 'Esta ficha foi gravada sem nenhum item respondido. '
      + 'Avise quem administra a Frota.');
  }
  for (const r of itens) {
    put('item', `${ROTULO_ESTADO[r.estado] || r.estado} — ${r.item_texto}`, {
      marca: ROTULO_ESTADO[r.estado] || r.estado,
      corpo: r.item_texto,
      // Só o problema ganha cor. Pintar os três faria a página parecer um
      // semáforo e o problema deixaria de saltar — que é o único motivo de
      // haver cor aqui.
      tom: r.estado === 'nao_ok' ? 'vermelha' : null,
    });
    if (r.observacao) put('fraco', `      observação: ${r.observacao}`);
  }

  put('secao', 'Quem respondeu por esta ficha');
  put('campo', `Conferiu e preencheu: ${f.pessoa_nome || 'não informado'}`,
    { rotulo: 'Conferiu e preencheu', valor: f.pessoa_nome || 'não informado' });
  put('campo', `Carro de: ${donoNome || 'não informado'}`,
    { rotulo: 'Carro de', valor: donoNome || 'não informado' });

  put('secao', 'A assinatura');
  if (f.assinada_em) {
    put('campo', `Assinada por: ${assinanteNome || 'não informado'}`,
      { rotulo: 'Assinada por', valor: assinanteNome || 'não informado' });
    // OS DOIS FORMATOS, DE PROPÓSITO. O de cima é pra pessoa ler; o de baixo é
    // o instante EXATO que entrou na impressão digital. Mostrar só o legível
    // faria o papel parecer discordar do sistema pra quem for recalcular.
    put('campo', `Assinada em: ${horaDeBrasilia(f.assinada_em)} (horário de Brasília)`,
      { rotulo: 'Assinada em', valor: `${horaDeBrasilia(f.assinada_em)} (horário de Brasília)` });
    put('fraco', `Instante exato registrado pelo servidor: ${instanteCanonico(f.assinada_em)}`);

    const { segundos } = tempoDePreenchimento(f.aberta_em, f.assinada_em);
    const tempo = tempoPorExtenso(segundos);
    // Não escreve zero: zero significaria "instantâneo", que é uma acusação
    // contra quem talvez nem tenha como ter o dado (ficha sem login nasce
    // sem `aberta_em`).
    const valorTempo = tempo || 'não registrado nesta ficha';
    put('campo', `Tempo de preenchimento: ${valorTempo}`,
      { rotulo: 'Tempo de preenchimento', valor: valorTempo });

    /* O RABISCO (F7c). Sai desenhado, com os traços que a pessoa fez com o dedo
       na hora de assinar — é o que o dono pediu pra "deixar mais fiel".
       Vem dos PONTOS gravados, não de uma imagem: este gerador não desenha
       imagem, mas desenha linha, que é nativa do formato.

       QUANDO NÃO HÁ DESENHO, O PAPEL DIZ ISSO com todas as letras. Nem toda
       ficha assinada tem rabisco (ele é opcional, pra não virar uma porta
       fechada nova), e um espaço em branco no lugar de uma assinatura é
       exatamente o tipo de ambiguidade que este documento existe pra não ter. */
    const rabisco = normalizarRabisco(f.assinatura_rabisco);
    if (rabisco) {
      put('texto', 'Assinatura de próprio punho, feita na tela:');
      L.push({ estilo: 'rabisco', texto: '', rabisco });
    } else {
      put('fraco', 'Esta ficha foi assinada só com a senha: não há rabisco desenhado nela.');
    }
  } else {
    put('texto', 'Esta ficha NÃO foi assinada.');
    const motivo = ROTULO_SEM_ASSINATURA[f.sem_assinatura_motivo] || f.sem_assinatura_motivo;
    put('texto', motivo
      ? `Motivo: ${motivo}.`
      : 'Motivo não registrado.');
    put('fraco', 'A conferência do carro foi feita e vale; o que falta é a prova de quem a fez.');
  }

  put('secao', 'Os códigos de conferência');
  put('fraco', 'Estes códigos são calculados a partir de TUDO o que está escrito acima. '
    + 'Mudar qualquer letra desta ficha no sistema muda o código — e o código da ficha seguinte '
    + 'deste mesmo carro deixa de encaixar. É assim que uma alteração feita depois não tem como '
    + 'passar despercebida.');
  put('texto', 'Código desta ficha:');
  put('codigo', f.assinatura_hash || '(a ficha não foi assinada — não há código)');
  put('texto', 'Código da ficha anterior deste carro:');
  put('codigo', f.assinatura_hash_anterior
    || (f.assinada_em
      ? '(não há: esta é a primeira ficha assinada deste carro)'
      : '(a ficha não foi assinada — não há código)'));

  return L;
}

/* ── Onde o arquivo mora no Zoho ──────────────────────────────────────────── */

// Barra, dois-pontos e companhia quebram nome de pasta e de arquivo em
// qualquer nuvem. Trocados por hífen — nunca apagados, senão "A/B" e "AB"
// viravam a mesma pasta.
const semCaractereProibido = (s) => String(s ?? '')
  .replace(/[\\/:*?"<>|]/g, '-')
  .replace(/\s+/g, ' ')
  .trim();

/**
 * As pastas, de fora pra dentro, DENTRO da pasta "Gestão de Serviços" do Zoho:
 * `Frota / <carro> / <AAAA-MM>`.
 *
 * O carro leva a PLACA junto do nome porque dois carros podem ter o mesmo nome
 * de modelo ("FORD FIESTA SEDAN") — e duas pastas com o mesmo nome fariam as
 * fichas de dois veículos se misturarem sem ninguém notar.
 */
export function pastasDoArquivo({ ficha, veiculo }) {
  const v = veiculo || {};
  const carro = semCaractereProibido(
    v.placa ? `${v.nome || 'Carro sem nome'} (${v.placa})` : (v.nome || 'Carro sem nome'));
  // O mês sai do TEXTO da data (AAAA-MM-DD), não de um objeto Date: converter
  // pra data e voltar poderia jogar o dia 1º pro mês anterior por causa de fuso.
  const mes = /^(\d{4})-(\d{2})/.exec(String(ficha?.feita_em ?? ''));
  return ['Frota', carro, mes ? `${mes[1]}-${mes[2]}` : 'sem-data'];
}

/**
 * O nome do arquivo. Leva a data e a placa pra ser único dentro da pasta do
 * mês, e legível pra quem procura o papel de um dia específico.
 */
export function nomeDoArquivo({ ficha, veiculo }) {
  const placa = semCaractereProibido(veiculo?.placa || 'sem-placa');
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(String(ficha?.feita_em ?? ''))
    ? ficha.feita_em : 'sem-data';
  return `checklist-${dia}-${placa}.pdf`;
}

/* ── Os bytes do PDF ──────────────────────────────────────────────────────── */

// A4 em pontos (1 pt = 1/72 pol). Margem de 56 pt ≈ 2 cm.
const LARGURA = 595, ALTURA = 842, MARGEM = 56;
const UTIL = LARGURA - 2 * MARGEM;

/* ── A MARCA NO PAPEL (13/08/2026) ────────────────────────────────────────────
 *
 * Pedido do dono: "melhorar o visual dos PDFs que são criados no Zoho, quero
 * algo mais corporativo, bem mais profissional, pode ser com o branding book da
 * RBV Co."
 *
 * NÃO EXISTE UM ARQUIVO DE MANUAL DE MARCA no repositório — o manual de fato é
 * o que está em uso, e foi daí que estas medidas saíram:
 *   · o logotipo é "RBV & Co." + um filete + "CONSULTANCY", em SERIFADA, preto
 *     sobre branco (a proporção do filete está documentada em
 *     public/midia/favicon.svg, que é o monograma da mesma marca);
 *   · as cores são as de src/estilos/estilos-globais.css: preto quente
 *     (#17150f), pérola, e o vermelho/laranja/verde de estado.
 *
 * A MARCA É DESENHADA, NÃO É IMAGEM, e isso não é preguiça: embutir o PNG do
 * logotipo exigiria descompactar e recompactar a imagem dentro de uma Edge
 * Function que roda de poucos em poucos minutos — e o motivo de este gerador
 * ser escrito à mão (ver o cabeçalho do arquivo) é justamente não pagar esse
 * preço de partida. As fontes Times são BASE do formato PDF, como a Helvetica:
 * existem em qualquer leitor desde 1994, não pesam um byte no arquivo, e são
 * serifadas — que é o que o logotipo é. */
const MARCA = {
  faixaPrimeira: 104,   // a faixa cheia, com o logotipo por extenso
  faixaDemais: 46,      // a faixa fina que se repete nas páginas seguintes
  rodape: 44,           // a área reservada embaixo, onde nada de conteúdo entra
  respiroDepois: 26,    // o ar entre a faixa e a primeira linha do conteúdo
};

/* As cores do papel, em RGB de 0 a 1, que é como o PDF conta.
 * Não há token aqui e nem poderia haver: token existe pra responder ao tema
 * claro e escuro, e papel não tem tema. Os valores são a conversão direta dos
 * tokens da Central — mesma marca, mesmo olho. */
const COR = {
  tinta: [0.09, 0.08, 0.06],      // #17150f — o preto quente do texto
  fraca: [0.43, 0.41, 0.38],      // o cinza do que é secundário
  fio: [0.86, 0.85, 0.83],        // as linhas de seção
  faixa: [0.05, 0.05, 0.05],      // a faixa da marca
  sobre: [1, 1, 1],               // texto em cima da faixa
  caixa: [0.96, 0.955, 0.945],    // o fundo dos códigos
  verde: [0.10, 0.43, 0.27],      // #1a6e45 — liberado
  laranja: [0.72, 0.35, 0.00],    // #b85800 — com ressalvas
  vermelha: [0.69, 0.12, 0.23],   // #b01e3a — não liberado, e item com problema
};

// F1 Helvetica · F2 Helvetica-Bold · F3 Courier (códigos) ·
// F4 Times-Roman · F5 Times-Bold (a marca e o título — a serifada do logotipo).
const FONTES = [
  ['F1', 'Helvetica'], ['F2', 'Helvetica-Bold'], ['F3', 'Courier'],
  ['F4', 'Times-Roman'], ['F5', 'Times-Bold'],
];

const ESTILOS = {
  titulo: { fonte: 'F5', tamanho: 17, antes: 0, depois: 5, cor: 'tinta' },
  subtitulo: { fonte: 'F1', tamanho: 8.5, antes: 0, depois: 16, cor: 'fraca' },
  // Título de seção em versalete espaçado sobre um fio — a mesma hierarquia
  // que o padrão da Central usa na tela (10px, maiúsculas, letter-spacing).
  secao: { fonte: 'F2', tamanho: 8.5, antes: 16, depois: 10, cor: 'fraca', tc: 1.5, caixaAlta: true, fio: true },
  campo: { fonte: 'F1', tamanho: 10, antes: 0, depois: 6, cor: 'tinta' },
  selo: { fonte: 'F2', tamanho: 9.5, antes: 3, depois: 9, cor: 'tinta' },
  item: { fonte: 'F1', tamanho: 10, antes: 0, depois: 5, cor: 'tinta' },
  texto: { fonte: 'F1', tamanho: 10, antes: 0, depois: 4, cor: 'tinta' },
  fraco: { fonte: 'F1', tamanho: 8.5, antes: 0, depois: 4, cor: 'fraca' },
  codigo: { fonte: 'F3', tamanho: 8.5, antes: 0, depois: 8, cor: 'tinta' },
  vazio: { fonte: 'F1', tamanho: 10, antes: 0, depois: 6, cor: 'tinta' },
};

// A coluna do rótulo nos pares "rótulo · valor". 186 pt cabe o mais comprido
// que este documento tem ("Por que o hodômetro contraria o anterior", 179 pt
// em Helvetica 8,5) — contado, não estimado.
const COLUNA_ROTULO = 186;
// A coluna da marca de estado na lista de itens: "Não se aplica" é a maior,
// com 60 pt em Helvetica-Bold 8,5.
const COLUNA_MARCA = 84;

/* ── O quadro do rabisco ──────────────────────────────────────────────────────
   A PROPORÇÃO É A MESMA DO CAMPO DE DESENHO DA TELA (2:1, ver
   campo-de-rabisco.vue), e isso é obrigatório, não combinação bonita: os pontos
   são guardados de 0 a 1 RELATIVOS ao quadro em que foram feitos. Imprimir num
   quadro de outra proporção esticaria ou espremeria a assinatura — o papel
   mostraria um desenho que a pessoa nunca fez.

   240x120 pt ≈ 8,5 x 4,2 cm: o tamanho de uma assinatura de caneta num
   documento, e cabe com folga na largura útil da folha (483 pt). */
const RABISCO = {
  largura: 240, altura: 120, antes: 4, depois: 10,
  // Espaço abaixo da linha de assinatura, DENTRO do quadro: é onde as letras
  // que descem (o "g" de "Rodrigo") passam sem bater no fim da caixa.
  base: 16,
  // Grossura do traço em pontos. 1,1 imita caneta esferográfica; mais fino
  // some numa impressão a laser ruim, mais grosso vira borrão nas curvas de um
  // rabisco feito com o dedo.
  grossura: 1.1,
};

// Largura média de caractere, em fração do tamanho da fonte. Helvetica em
// texto corrido fica perto de 0,50; o valor aqui é FOLGADO de propósito
// (0,54) porque errar pra mais só quebra a linha um pouco antes, enquanto
// errar pra menos deixa texto passando da margem — e texto cortado é o
// defeito que o padrão da central proíbe por escrito.
// As Times são mais estreitas que a Helvetica no mesmo corpo — usar o número
// dela deixaria a linha quebrar cedo demais e abriria buraco no fim de cada
// linha. Times-Bold é a da marca, que é sempre uma linha curta.
const LARGURA_MEDIA = { F1: 0.54, F2: 0.56, F3: 0.60, F4: 0.48, F5: 0.51 };

/** Quanto um texto ocupa, em pontos. Serve pra alinhar à direita e pra medir
 *  a caixa de um selo. É estimativa (mesma tabela de larguras médias acima) e
 *  ela erra PRA MAIS de propósito: sobrar espaço é feio, faltar é texto por
 *  cima de texto. */
function larguraDe(texto, fonte, tamanho, tc = 0) {
  const n = String(texto ?? '').length;
  return n * (tamanho * (LARGURA_MEDIA[fonte] ?? 0.54) + tc);
}

// Quebra o texto em linhas que cabem numa largura dada. Palavra maior que a
// linha inteira (um código de 64 letras, um caminho de pasta) é PARTIDA em vez
// de vazar pra fora da folha.
function quebrarEm(texto, fonte, tamanho, largura) {
  const cabem = Math.max(8, Math.floor(largura / (tamanho * (LARGURA_MEDIA[fonte] ?? 0.54))));
  const palavras = String(texto ?? '').split(/\s+/).filter(Boolean);
  if (palavras.length === 0) return [''];
  const linhas = [];
  let atual = '';
  for (let p of palavras) {
    while (p.length > cabem) {
      if (atual) { linhas.push(atual); atual = ''; }
      linhas.push(p.slice(0, cabem));
      p = p.slice(cabem);
    }
    if (!atual) atual = p;
    else if ((atual + ' ' + p).length <= cabem) atual += ' ' + p;
    else { linhas.push(atual); atual = p; }
  }
  if (atual) linhas.push(atual);
  return linhas;
}

/** O mesmo, para um estilo do documento, na largura útil da folha. */
function quebrar(texto, estilo) {
  const { fonte, tamanho } = ESTILOS[estilo] || ESTILOS.texto;
  return quebrarEm(texto, fonte, tamanho, UTIL);
}

// PDF guarda texto em bytes, não em Unicode. WinAnsiEncoding cobre todo o
// português (é o Latin-1 com uns símbolos a mais entre 0x80 e 0x9F). O que
// não couber vira "?" — visível, nunca um byte inválido que estraga o arquivo
// inteiro e impede de abrir o documento.
const WINANSI_EXTRA = {
  '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85,
  '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89, 'Š': 0x8A,
  '‹': 0x8B, 'Œ': 0x8C, 'Ž': 0x8E, '‘': 0x91, '’': 0x92,
  '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97,
  '˜': 0x98, '™': 0x99, 'š': 0x9A, '›': 0x9B, 'œ': 0x9C,
  'ž': 0x9E, 'Ÿ': 0x9F,
};

/** O texto virado em bytes de string PDF, já com os escapes de `(`, `)` e `\`. */
export function bytesDeTexto(texto) {
  const out = [];
  for (const ch of String(texto ?? '')) {
    let b;
    const cp = ch.codePointAt(0);
    if (WINANSI_EXTRA[ch] !== undefined) b = WINANSI_EXTRA[ch];
    else if (cp >= 0x20 && cp <= 0x7e) b = cp;
    else if (cp >= 0xa0 && cp <= 0xff) b = cp;
    else b = 0x3f; // "?"
    if (b === 0x28 || b === 0x29 || b === 0x5c) out.push(0x5c); // ( ) \
    out.push(b);
  }
  return out;
}

/* ── O rabisco virando linha no papel ─────────────────────────────────────── */

// Duas casas bastam: o PDF é medido em pontos (1/72 pol), e 0,01 pt é 3,5
// milésimos de milímetro. Guardar mais casas só engorda o arquivo.
const pt = (n) => Math.round(n * 100) / 100;

/**
 * Os traços do rabisco convertidos em coordenadas da folha.
 *
 * `caixa` é `{ x, y, largura, altura }`, com `y` na BASE do quadro — a mesma
 * convenção do resto do arquivo, porque no PDF o eixo Y cresce PRA CIMA.
 *
 * E é aí que mora a única sutileza desta função: na tela, `y = 0` é o TOPO
 * (é assim que todo sistema de desenho de tela conta). No papel, `y = 0` é o
 * PÉ da folha. Sem inverter, a assinatura sairia impressa de cabeça pra baixo —
 * espelhada na horizontal, que é pior do que não sair, porque parece um
 * documento adulterado.
 *
 * Os pontos passam por `normalizarRabisco` antes: é ela que prende as
 * coordenadas entre 0 e 1 (traço que escapou da área de desenho não pode virar
 * risco fora do quadro, por cima do texto da ficha) e descarta o que não é
 * número — nunca convertendo lixo em zero, que aqui seria um canto do quadro.
 */
export function tracosNaFolha(rabisco, caixa) {
  const { x, y, largura, altura } = caixa || {};
  const tracos = normalizarRabisco(rabisco);
  if (!tracos) return [];
  return tracos.map((traco) => traco.map((p) => [
    pt(x + p[0] * largura),
    pt(y + altura - p[1] * altura),
  ]));
}

/**
 * O quadro do rabisco como operadores de desenho do PDF.
 *
 * Sai FORA de `BT … ET`: dentro de um bloco de texto o PDF só aceita operadores
 * de texto, e um caminho ali dentro faz o leitor recusar a página inteira.
 *
 * `q … Q` guarda e devolve o estado gráfico. Sem isso, a grossura e a cor do
 * traço vazariam pro que for desenhado depois na mesma página.
 */
export function desenhoDoRabisco(rabisco, caixa) {
  const linhas = ['q'];

  // A linha de assinatura, como no papel. Cinza claro (`0.75 G`) pra ser
  // guia, não parte do desenho.
  const yBase = pt(caixa.y + RABISCO.base);
  linhas.push('0.75 G 0.5 w');
  linhas.push(`${pt(caixa.x)} ${yBase} m ${pt(caixa.x + caixa.largura)} ${yBase} l S`);

  // A tinta. Preto puro, e aqui não há token que valha: papel branco, caneta
  // preta — o documento não tem tema claro e escuro.
  linhas.push(`0 G ${RABISCO.grossura} w 1 J 1 j`);
  for (const traco of tracosNaFolha(rabisco, caixa)) {
    linhas.push(`${traco[0][0]} ${traco[0][1]} m`);
    for (let i = 1; i < traco.length; i++) linhas.push(`${traco[i][0]} ${traco[i][1]} l`);
    // Um toque só: sem repetir o ponto, o caminho não tem comprimento e o
    // leitor não desenha nada — a ponta redonda (`1 J`) só aparece se houver
    // segmento. O mesmo cuidado que o campo da tela toma.
    if (traco.length === 1) linhas.push(`${traco[0][0]} ${traco[0][1]} l`);
    linhas.push('S');
  }

  linhas.push('Q');
  return linhas.join('\n') + '\n';
}

/* ── O papel timbrado ─────────────────────────────────────────────────────── */

/** Onde o conteúdo começa em cada página, e onde ele tem de parar. */
const topoDa = (indice) => ALTURA
  - (indice === 0 ? MARCA.faixaPrimeira : MARCA.faixaDemais)
  - MARCA.respiroDepois;
const PE = MARGEM + MARCA.rodape;

/**
 * A faixa da marca no alto da página.
 *
 * A primeira página leva o logotipo por extenso — "RBV & Co.", o filete, e
 * "CONSULTANCY" em versalete espaçado, na mesma ordem e na mesma proporção do
 * logotipo de verdade. As seguintes levam uma faixa fina só com o nome: repetir
 * o logotipo inteiro em toda folha é o que faz papel de empresa parecer
 * panfleto.
 */
function faixaDaMarca(indice) {
  const alto = indice === 0;
  const altura = alto ? MARCA.faixaPrimeira : MARCA.faixaDemais;
  const ops = [{ tipo: 'caixa', x: 0, y: ALTURA - altura, largura: LARGURA, altura, cor: 'faixa' }];

  if (alto) {
    ops.push({ tipo: 'texto', x: MARGEM, y: ALTURA - 50, fonte: 'F5', tamanho: 25, texto: 'RBV & Co.', cor: 'sobre', tc: 0.4 });
    // O FILETE. Ele é o que faz três letras serem lidas como a marca, e não
    // como três letras quaisquer — é assim no logotipo e no monograma do app.
    ops.push({ tipo: 'fio', x: MARGEM, y: ALTURA - 61, largura: 148, cor: 'sobre', grossura: 1.8 });
    ops.push({ tipo: 'texto', x: MARGEM, y: ALTURA - 78, fonte: 'F4', tamanho: 8.5, texto: 'CONSULTANCY', cor: 'sobre', tc: 3.4 });
    const dir = 'CENTRAL DE INTELIGÊNCIA';
    ops.push({
      tipo: 'texto', x: LARGURA - MARGEM - larguraDe(dir, 'F1', 8, 1.3),
      y: ALTURA - 50, fonte: 'F1', tamanho: 8, texto: dir, cor: 'sobre', tc: 1.3,
    });
    const dir2 = 'GESTÃO DE FROTA';
    ops.push({
      tipo: 'texto', x: LARGURA - MARGEM - larguraDe(dir2, 'F1', 8, 1.3),
      y: ALTURA - 64, fonte: 'F1', tamanho: 8, texto: dir2, cor: 'sobre', tc: 1.3,
    });
  } else {
    ops.push({ tipo: 'texto', x: MARGEM, y: ALTURA - 29, fonte: 'F5', tamanho: 13, texto: 'RBV & Co.', cor: 'sobre', tc: 0.3 });
    const dir = 'CHECKLIST DE FROTA · FICHA ASSINADA';
    ops.push({
      tipo: 'texto', x: LARGURA - MARGEM - larguraDe(dir, 'F1', 7.5, 1.2),
      y: ALTURA - 29, fonte: 'F1', tamanho: 7.5, texto: dir, cor: 'sobre', tc: 1.2,
    });
  }
  return ops;
}

/** O rodapé, em todas as páginas. A numeração só existe depois de se saber
 *  quantas páginas há — por isso ele é montado no fim, e não durante a
 *  paginação. Documento de conferência sem "página X de Y" é documento do qual
 *  ninguém percebe que a última folha sumiu. */
function rodapeDaPagina(indice, total) {
  const y = MARGEM - 6;
  const esq = 'RBV & Co. · Central de Inteligência · documento gerado automaticamente';
  const dir = `Página ${indice + 1} de ${total}`;
  return [
    { tipo: 'fio', x: MARGEM, y: MARGEM + 16, largura: UTIL, cor: 'fio', grossura: 0.6 },
    { tipo: 'texto', x: MARGEM, y, fonte: 'F1', tamanho: 7.5, texto: esq, cor: 'fraca' },
    {
      tipo: 'texto', x: LARGURA - MARGEM - larguraDe(dir, 'F1', 7.5),
      y, fonte: 'F1', tamanho: 7.5, texto: dir, cor: 'fraca',
    },
  ];
}

/**
 * As linhas viram bytes de PDF. Devolve `Uint8Array`.
 *
 * Uma coluna, quantas páginas precisar. Sem imagem e sem fonte embutida:
 * Helvetica, Courier e Times são as fontes que todo leitor de PDF já tem, e é
 * por isso que este arquivo continua pesando kilobytes e abrindo em qualquer
 * lugar.
 */
export function montarPdf(linhas) {
  // 1) Distribui as linhas em páginas, medindo a altura conforme desce.
  const paginas = [];
  let atual = [];
  let y = topoDa(0);
  const quebrarPagina = () => { paginas.push(atual); atual = []; y = topoDa(paginas.length); };
  // Cabe o que vem a seguir no que resta da folha?
  const cabe = (altura) => y - altura >= PE;

  for (const l of (linhas || [])) {
    /* O QUADRO DO RABISCO NÃO SE PARTE ENTRE DUAS PÁGINAS. Meia assinatura no
       pé de uma folha e a outra metade no topo da seguinte não é um documento
       de conferência — é um defeito de impressão que parece adulteração. Se
       não couber inteiro no que resta, ele desce inteiro pra próxima página. */
    if (l.estilo === 'rabisco') {
      if (!cabe(RABISCO.antes + RABISCO.altura)) quebrarPagina();
      y -= RABISCO.antes + RABISCO.altura;
      const caixa = { x: MARGEM, y, largura: RABISCO.largura, altura: RABISCO.altura };
      // A MOLDURA. Sem ela o rabisco fica boiando no meio do texto; com ela,
      // vira o quadro de assinatura que todo documento impresso tem.
      atual.push({ tipo: 'moldura', ...caixa, cor: 'fio' });
      atual.push({ tipo: 'rabisco', rabisco: l.rabisco, caixa });
      y -= RABISCO.depois;
      continue;
    }

    const est = ESTILOS[l.estilo] || ESTILOS.texto;
    const alturaLinha = est.tamanho * 1.3;

    /* TÍTULO DE SEÇÃO: versalete espaçado com um fio embaixo. O fio some junto
       com o título se a página virar — título órfão no pé da folha é o defeito
       clássico de documento gerado. */
    if (l.estilo === 'secao') {
      if (!cabe(est.antes + alturaLinha + 8)) quebrarPagina();
      y -= est.antes + alturaLinha;
      atual.push({
        tipo: 'texto', x: MARGEM, y, fonte: est.fonte, tamanho: est.tamanho,
        texto: String(l.texto ?? '').toUpperCase(), cor: est.cor, tc: est.tc,
      });
      atual.push({ tipo: 'fio', x: MARGEM, y: y - 5, largura: UTIL, cor: 'fio', grossura: 0.6 });
      y -= est.depois;
      continue;
    }

    /* PAR RÓTULO · VALOR em duas colunas. Se o rótulo não couber na coluna
       dele, o par inteiro volta a ser uma linha corrida — degradar assim é
       melhor que deixar rótulo e valor se sobrepondo, que é ilegível. */
    if (l.estilo === 'campo' && l.rotulo && larguraDe(l.rotulo, 'F1', 8.5) <= COLUNA_ROTULO - 10) {
      const pedacos = quebrarEm(l.valor, est.fonte, est.tamanho, UTIL - COLUNA_ROTULO);
      pedacos.forEach((pedaco, i) => {
        if (!cabe(alturaLinha)) quebrarPagina();
        y -= (i === 0 ? est.antes : 0) + alturaLinha;
        if (i === 0) {
          atual.push({
            tipo: 'texto', x: MARGEM, y, fonte: 'F1', tamanho: 8.5,
            texto: l.rotulo, cor: 'fraca',
          });
        }
        atual.push({
          tipo: 'texto', x: MARGEM + COLUNA_ROTULO, y, fonte: est.fonte,
          tamanho: est.tamanho, texto: pedaco, cor: est.cor,
        });
      });
      y -= est.depois;
      continue;
    }

    /* O SELO DO RESULTADO: caixa cheia da cor do estado, com o texto em branco
       em cima. É a linha que se lê primeiro num documento que responde por
       multa e por acidente. */
    if (l.estilo === 'selo' && l.valor) {
      const largura = larguraDe(l.valor, est.fonte, est.tamanho) + 22;
      const alturaSelo = est.tamanho + 12;
      if (!cabe(est.antes + alturaSelo)) quebrarPagina();
      y -= est.antes + alturaSelo;
      atual.push({
        tipo: 'texto', x: MARGEM, y: y + 4, fonte: 'F1', tamanho: 8.5,
        texto: l.rotulo || 'Resultado', cor: 'fraca',
      });
      atual.push({
        tipo: 'caixa', x: MARGEM + COLUNA_ROTULO, y, largura, altura: alturaSelo,
        cor: l.tom || 'fraca',
      });
      atual.push({
        tipo: 'texto', x: MARGEM + COLUNA_ROTULO + 11, y: y + 4.5,
        fonte: est.fonte, tamanho: est.tamanho, texto: l.valor, cor: 'sobre',
      });
      y -= est.depois;
      continue;
    }

    /* ITEM CONFERIDO: a marca de estado à esquerda, o item à direita. Só o
       problema é colorido — pintar os três faria a página virar semáforo e o
       problema deixaria de saltar. */
    if (l.estilo === 'item' && l.marca) {
      const pedacos = quebrarEm(l.corpo, est.fonte, est.tamanho, UTIL - COLUNA_MARCA);
      pedacos.forEach((pedaco, i) => {
        if (!cabe(alturaLinha)) quebrarPagina();
        y -= alturaLinha;
        if (i === 0) {
          atual.push({
            tipo: 'texto', x: MARGEM, y, fonte: 'F2', tamanho: 8.5,
            texto: l.marca, cor: l.tom || 'fraca',
          });
        }
        atual.push({
          tipo: 'texto', x: MARGEM + COLUNA_MARCA, y, fonte: est.fonte,
          tamanho: est.tamanho, texto: pedaco, cor: est.cor,
        });
      });
      y -= est.depois;
      continue;
    }

    /* CÓDIGO: fundo cinza claro, como o campo de uma senha impressa. Ele tem 64
       letras sem espaço nenhum e é o que mais denuncia um documento mal
       montado quando vaza pela margem. */
    if (l.estilo === 'codigo') {
      const pedacos = quebrarEm(l.texto, est.fonte, est.tamanho, UTIL - 16);
      const alturaCaixa = pedacos.length * alturaLinha + 12;
      if (!cabe(alturaCaixa)) quebrarPagina();
      const topo = y;
      atual.push({ tipo: 'caixa', x: MARGEM, y: topo - alturaCaixa, largura: UTIL, altura: alturaCaixa, cor: 'caixa' });
      pedacos.forEach((pedaco, i) => {
        const linhaY = topo - 6 - (i + 1) * alturaLinha + 3;
        atual.push({
          tipo: 'texto', x: MARGEM + 8, y: linhaY, fonte: est.fonte,
          tamanho: est.tamanho, texto: pedaco, cor: est.cor,
        });
      });
      y = topo - alturaCaixa - est.depois;
      continue;
    }

    /* O RESPIRO É DO PARÁGRAFO, NÃO DE CADA LINHA QUEBRADA. Aplicando `antes` e
       `depois` dentro do laço, um parágrafo de duas linhas saía com um buraco
       no meio do tamanho do espaço entre parágrafos — dá pra ver a olho no
       texto de abertura do documento, que quebra em duas linhas. */
    const pedacos = l.estilo === 'vazio' ? [''] : quebrar(l.texto, l.estilo);
    pedacos.forEach((pedaco, i) => {
      const respiro = i === 0 ? est.antes : 0;
      if (!cabe(respiro + alturaLinha)) quebrarPagina();
      y -= respiro + alturaLinha;
      if (pedaco !== '') {
        atual.push({
          tipo: 'texto', x: MARGEM, y, fonte: est.fonte, tamanho: est.tamanho,
          texto: pedaco, cor: est.cor,
        });
      }
    });
    y -= est.depois;
  }
  paginas.push(atual);

  // 2) Cada página vira um fluxo de desenho, com a faixa da marca em cima e o
  //    rodapé embaixo — os dois montados só agora, porque a numeração precisa
  //    do total de páginas.
  const fluxos = paginas.map((itens, i) => {
    const bytes = [];
    const escrever = (s) => { for (const c of s) bytes.push(c.charCodeAt(0)); };
    /* TEXTO E DESENHO NÃO CONVIVEM NO MESMO BLOCO. Dentro de `BT … ET` o PDF só
       aceita operadores de texto: um caminho ali dentro faz o leitor recusar a
       página inteira, e o arquivo abre em branco. Por isso o bloco de texto se
       abre quando há texto e se FECHA antes de cada desenho. */
    let emTexto = false;
    const abrirTexto = () => { if (!emTexto) { escrever('BT\n'); emTexto = true; } };
    const fecharTexto = () => { if (emTexto) { escrever('ET\n'); emTexto = false; } };
    const rgb = (nome) => (COR[nome] || COR.tinta).map((n) => n.toFixed(3)).join(' ');

    for (const it of [...faixaDaMarca(i), ...itens, ...rodapeDaPagina(i, paginas.length)]) {
      if (it.tipo === 'rabisco') {
        fecharTexto();
        escrever(desenhoDoRabisco(it.rabisco, it.caixa));
        continue;
      }
      if (it.tipo === 'caixa') {
        fecharTexto();
        escrever(`q ${rgb(it.cor)} rg ${pt(it.x)} ${pt(it.y)} ${pt(it.largura)} ${pt(it.altura)} re f Q\n`);
        continue;
      }
      if (it.tipo === 'moldura') {
        fecharTexto();
        escrever(`q ${rgb(it.cor)} RG 0.8 w ${pt(it.x)} ${pt(it.y)} ${pt(it.largura)} ${pt(it.altura)} re S Q\n`);
        continue;
      }
      if (it.tipo === 'fio') {
        fecharTexto();
        escrever(`q ${rgb(it.cor)} RG ${it.grossura} w ${pt(it.x)} ${pt(it.y)} m `
          + `${pt(it.x + it.largura)} ${pt(it.y)} l S Q\n`);
        continue;
      }
      abrirTexto();
      /* `Tc` e a cor são reescritos em TODA linha, e não só quando mudam.
         O estado de texto do PDF é PEGAJOSO: ele atravessa `BT … ET` dentro do
         mesmo fluxo. Deixar de zerar o espaçamento depois de um título faria o
         parágrafo seguinte sair com as letras afastadas, e a cor de um selo
         vazaria para o texto de baixo. */
      escrever(`/${it.fonte} ${it.tamanho} Tf\n${(it.tc || 0).toFixed(2)} Tc\n${rgb(it.cor)} rg\n`
        + `1 0 0 1 ${pt(it.x)} ${it.y.toFixed(2)} Tm\n(`);
      bytes.push(...bytesDeTexto(it.texto));
      escrever(') Tj\n');
    }
    fecharTexto();
    return bytes;
  });

  // 3) Os objetos do arquivo. 1 catálogo, 2 páginas, 3-7 fontes, e depois um
  //    par (página, fluxo) por página.
  const objetos = [];
  const primeiraFonte = 3;
  const idPagina = (i) => primeiraFonte + FONTES.length + i * 2;
  const idFluxo = (i) => idPagina(i) + 1;
  const recursoDeFontes = FONTES
    .map(([apelido], k) => `/${apelido} ${primeiraFonte + k} 0 R`).join(' ');

  objetos.push(bytesDe('<< /Type /Catalog /Pages 2 0 R >>'));
  objetos.push(bytesDe(`<< /Type /Pages /Kids [${paginas.map((_, i) => `${idPagina(i)} 0 R`).join(' ')}] `
    + `/Count ${paginas.length} >>`));
  for (const [, nome] of FONTES) {
    objetos.push(bytesDe(`<< /Type /Font /Subtype /Type1 /BaseFont /${nome} /Encoding /WinAnsiEncoding >>`));
  }
  paginas.forEach((_, i) => {
    objetos.push(bytesDe(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${LARGURA} ${ALTURA}] `
      + `/Resources << /Font << ${recursoDeFontes} >> >> /Contents ${idFluxo(i)} 0 R >>`));
    const fluxo = fluxos[i];
    objetos.push([...bytesDe(`<< /Length ${fluxo.length} >>\nstream\n`), ...fluxo,
      ...bytesDe('\nendstream')]);
  });

  // 4) Monta o arquivo e a tabela de posições (xref). Os deslocamentos têm de
  //    bater byte a byte, senão o leitor recusa o arquivo — por isso tudo aqui
  //    é contado em BYTES, nunca em caracteres.
  const saida = [];
  const empurrar = (b) => { for (const x of b) saida.push(x); };
  empurrar(bytesDe('%PDF-1.4\n'));
  // Comentário com bytes altos: convenção do formato pra avisar que o arquivo
  // é binário, e evita que um programa de transferência o trate como texto.
  empurrar([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]);

  const posicoes = [];
  objetos.forEach((corpo, i) => {
    posicoes.push(saida.length);
    empurrar(bytesDe(`${i + 1} 0 obj\n`));
    empurrar(corpo);
    empurrar(bytesDe('\nendobj\n'));
  });

  const inicioXref = saida.length;
  empurrar(bytesDe(`xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`));
  for (const p of posicoes) empurrar(bytesDe(`${String(p).padStart(10, '0')} 00000 n \n`));
  empurrar(bytesDe(`trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${inicioXref}\n%%EOF\n`));

  return new Uint8Array(saida);
}

// Texto ASCII do próprio formato (nomes de objeto, números) em bytes.
function bytesDe(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xff);
  return out;
}

/** O atalho que o robô usa: da ficha direto pros bytes. */
export function pdfDoChecklist(dados) {
  return montarPdf(linhasDoChecklist(dados));
}
