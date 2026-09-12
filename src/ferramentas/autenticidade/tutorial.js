// O GUIA DE BANCADA DA GRAVAÇÃO: o passo a passo que fica na tela, a ajuda de
// cada aba, e o guia inteiro que abre na primeira vez.
//
// POR QUE EXISTE: o dono abriu a tela pronta e disse "ficou muito mal
// explicado". A primeira versão consertou o pior — ela dizia "Crie um lote
// antes de gravar etiquetas", "✓ Gravei essa" e "Gravador de mesa", e mais nada.
//
// POR QUE FOI REFEITO: cinco telas de texto corrido ainda deixavam de fora tudo
// o que se aprende ERRANDO, e o dono disse que ficou pobre. Faltava, escrito em
// lugar nenhum do projeto:
//   · a parte FÍSICA — a etiqueta vai costurada no forro, longe de metal, e o
//     ponto onde se encosta o celular muda entre iPhone e Android;
//   · o "deu errado, e agora?", que é a parte que quem está de pé na bancada
//     mais procura e a que ninguém tinha escrito;
//   · quem grava por onde — e o que ainda NÃO existe, para a tela não prometer
//     um gravador de mesa que ainda não foi comprado;
//   · ajuda CURTA dentro de cada aba, porque guia único ninguém reabre.
//
// Contas puras, sem DOM e sem Vue, porque é assim que dá pra testar de verdade.

// ── O PASSO A PASSO DA ABA GRAVAR ──────────────────────────────────────────
// Três etapas, e a tela abre a de agora e recolhe as outras. O número é o que
// responde "onde eu parei?" sem ninguém contar etiqueta na mão. É o MESMO
// número que a barra de abas mostra — a ferramenta é um caminho, não um
// armário, e dois números diferentes para a mesma etapa seriam duas verdades.
export const PASSOS = [
  {
    n: 1,
    aba: 'lotes',
    titulo: 'Criar o lote',
    resumo: 'Um lote é uma fornada de bolsas do mesmo modelo. Cada bolsa ganha um código diferente.',
  },
  {
    n: 2,
    aba: 'gravar',
    titulo: 'Gravar as etiquetas',
    resumo: 'Encoste a etiqueta no celular, uma de cada vez. A tela confere e passa para a próxima.',
  },
  {
    n: 3,
    aba: 'etiquetas',
    titulo: 'Conferir',
    resumo: 'As etiquetas deste lote estão prontas. Os registros aparecem quando as clientes ativarem a garantia.',
  },
]

/**
 * Em que passo a pessoa está.
 *   1 — não há lote nenhum, ou nenhum escolhido
 *   2 — há lote escolhido e ainda falta etiqueta
 *   3 — tudo gravado neste lote
 */
export function passoAtual({ temLote = false, pecas = [] } = {}) {
  if (!temLote) return 1
  const lista = Array.isArray(pecas) ? pecas : []
  if (!lista.length) return 1
  return lista.some((p) => !p.gravada_em) ? 2 : 3
}

// ── A AJUDA CURTA DE CADA ABA ──────────────────────────────────────────────
// Uma ou duas linhas, dentro da aba, sempre à vista. Guia inteiro ninguém
// reabre: quem chega na aba Alertas seis meses depois não vai procurar o guia
// para descobrir o que aquela lista significa.
//
// A chave é a MESMA da barra de abas. Aba nova sem verbete aqui aparece calada,
// e há teste que reprova isso.
export const AJUDA_DA_ABA = {
  lotes: 'Cada lote é uma fornada de bolsas do mesmo modelo, e cada bolsa ganha um código só dela. '
    + 'A aba abre nos lotes em andamento; os encerrados — com todas as peças gravadas ou baixadas — '
    + 'ficam atrás do botão “Ver encerrados”.',
  gravar: 'A fila de trabalho: uma etiqueta de cada vez, na ordem da série. O seletor só oferece '
    + 'lote que ainda tem peça por gravar, e a tela lê a etiqueta antes e depois de gravar.',
  etiquetas: 'O desfazer da aba anterior: apagar uma gravação feita errado. A peça volta para a fila, '
    + 'e nem o código nem a garantia de ninguém são apagados. Abre nos últimos 30 dias.',
  cartoes: 'O cartão EAN é o papel que vai dentro da bolsa: nome do modelo, foto da peça, '
    + 'número de série e o código de barras do produto. Marque as peças, confira a prévia — '
    + 'ela é o cartão de verdade, não um desenho parecido — e mande gerar. O robô entrega em PNG e '
    + 'PDF no Zoho. Depois de impresso o número de série daquela peça não muda mais.',
  registros: 'As garantias que as clientes registraram sozinhas, encostando o celular na etiqueta. '
    + 'Só leitura: dá para buscar pelo nome ou pelo código e baixar a planilha.',
  alertas: 'O que anda estranho nos últimos 30 dias: o mesmo código lido de muitos aparelhos, '
    + 'códigos que não existem sendo tentados, e peças baixadas que voltaram a ser lidas.',
}

// ── OS TRÊS ESTÁGIOS, POR EXTENSO ──────────────────────────────────────────
// Cada um com o que FAZER, o que a TELA MOSTRA e como saber que DEU CERTO. Os
// três juntos são o guia de bancada; separados, viram rótulo.
//
// Esta é a fonte única: as telas do guia nascem daqui logo abaixo. Escrevendo o
// estágio duas vezes, uma das duas fica para trás no dia em que a tela mudar.
export const ESTAGIOS = [
  {
    n: 1,
    aba: 'lotes',
    titulo: 'Estágio 1 — Lotes',
    oQueFazer: 'Aperte “Gerar lote de etiquetas”, escolha o produto no Bling (ou escreva o modelo à '
      + 'mão) e diga quantas peças a fornada tem. O banco sorteia um código diferente para cada peça.',
    oQueATelaMostra: 'Um cartão por lote, com modelo, cor, referência, quantidade e quantas etiquetas '
      + 'já foram gravadas. “Ver as peças e os links” abre a lista inteira, com o endereço de cada uma.',
    comoSaber: 'O lote novo aparece na lista marcado com “N por gravar”, e a tela leva você direto '
      + 'para o estágio 2 com ele já escolhido.',
  },
  {
    n: 2,
    aba: 'gravar',
    titulo: 'Estágio 2 — Gravar',
    oQueFazer: 'Escolha o lote, pegue uma etiqueta em branco e encoste no celular, segurando parado. '
      + 'Uma etiqueta de cada vez, na ordem, sem pular.',
    oQueATelaMostra: 'A peça da vez com o endereço dela, a barra do lote (“7 de 20”), a fila com a que '
      + 'acabou de sair e as próximas, e um sinal que pulsa enquanto espera a etiqueta encostar.',
    comoSaber: 'O sinal vira um ✓ verde e o recado diz “Peça N pronta. Pegue a próxima etiqueta.” A '
      + 'peça da vez muda sozinha. Sem o ✓, a peça NÃO foi marcada: encoste a MESMA etiqueta de novo.',
  },
  {
    n: 3,
    aba: 'etiquetas',
    titulo: 'Estágio 3 — Etiquetas',
    oQueFazer: 'Só quando alguma coisa saiu errada: aqui se apaga a gravação de uma peça, com a sua '
      + 'senha, e ela volta para a fila do estágio 2.',
    oQueATelaMostra: 'As peças já gravadas — dos últimos 30 dias, e o resto atrás da busca —, dizendo '
      + 'qual bolsa cada uma é, quando foi gravada, e com um selo quando há garantia de cliente.',
    comoSaber: 'Depois de apagar, a peça sai daqui e reaparece na fila do estágio 2. A garantia da '
      + 'cliente continua valendo: nada é apagado do lado dela.',
  },
]

// ── QUEM GRAVA POR ONDE ────────────────────────────────────────────────────
// `pronto` é o que impede a tela de prometer o que não existe — e de negar o que
// já existe, que é a mesma mentira ao contrário.
//
// ⚠️ MUDOU EM 01/09/2026: até esta data o gravador de mesa estava `pronto:false`
// porque a máquina ainda não tinha sido comprada. Ela foi, e o caminho inteiro
// foi provado à mão no Windows — conectar, ler, gravar as 12 páginas e o celular
// abrir o certificado — e agora existe o programa que empresta o leitor para
// esta tela. Deixar "AINDA NÃO EXISTE" escrito aqui mandaria a bancada ignorar
// o botão que está na frente dela.
export const ONDE_SE_GRAVA = [
  {
    chave: 'android',
    onde: 'Android com Chrome',
    como: 'Grava direto pela tela. Aperte “Gravar nesta etiqueta” e encoste — a tela lê a etiqueta '
      + 'antes, grava, e lê de novo para conferir antes de dar a peça por pronta.',
    pronto: true,
  },
  {
    chave: 'iphone',
    onde: 'iPhone',
    como: 'O navegador do iPhone não grava NFC — é limite da Apple, não defeito daqui. Copie o '
      + 'endereço, grave pelo aplicativo de NFC do celular e volte para tocar em “✓ Gravei essa”.',
    pronto: true,
  },
  {
    chave: 'computador',
    onde: 'Computador',
    como: 'O navegador do computador não tem NFC. Com o programa do gravador aberto, a tela oferece '
      + '“Gravar pelo leitor de mesa”; sem ele, mostra o endereço para copiar, e a gaveta “Gravador '
      + 'de mesa” baixa a lista das etiquetas que ainda faltam neste lote.',
    pronto: true,
  },
  {
    chave: 'gravador',
    onde: 'Gravador de mesa',
    como: 'O leitor ACR122U ligado na USB do computador da bancada. Ele só aparece DENTRO do programa '
      + 'do gravador: abra o programa (ícone “Gravador de Etiquetas”), entre na Central como sempre, e '
      + 'o botão “Gravar pelo leitor de mesa” estará ali. Ponha a etiqueta no meio do leitor e clique — '
      + 'a tela lê antes, grava, lê de volta e confere sozinha. Se o botão não aparecer, a tela foi '
      + 'aberta pelo navegador comum, e não pelo programa.',
    pronto: true,
  },
]

// ── DEU ERRADO, E AGORA? ───────────────────────────────────────────────────
// A parte que mais falta e a que ninguém tinha escrito. Cada caso diz O QUE
// HOUVE e O QUE FAZER, em português de bancada — quem lê isto está de pé, com a
// bolsa numa mão e o celular na outra.
export const SOCORRO = [
  {
    chave: 'nao-grava',
    sintoma: 'A etiqueta não grava',
    oQueHouve: 'A etiqueta pode estar cheia, travada de fábrica, ou ser de um tipo pequeno demais para '
      + 'guardar o endereço. O recado da tela diz qual dos casos foi.',
    oQueFazer: 'Separe essa etiqueta e pegue outra. Se a segunda também não gravar, o problema não é a '
      + 'etiqueta: confira se o NFC do celular está ligado e recarregue a página.',
  },
  {
    chave: 'ja-tem-outra',
    sintoma: 'A etiqueta já tem outra peça',
    oQueHouve: 'Você encostou uma etiqueta que já foi gravada com outra bolsa. A tela lê ANTES de '
      + 'gravar justamente por isso: ela nunca escreve por cima sem perguntar.',
    oQueFazer: 'Se foi engano, aperte “Não sobrescrever”, separe a etiqueta e pegue uma em branco. Se '
      + 'essa etiqueta foi gravada e ficou de lado antes de ser costurada, escolha o que fazer com a '
      + 'peça antiga — volta para a fila, ou dar baixa — e aperte “Sobrescrever esta etiqueta”. A '
      + 'pergunta diz qual bolsa vai perder a identidade, com modelo, cor e número.',
  },
  {
    chave: 'peca-errada',
    sintoma: 'Gravei a peça errada',
    oQueHouve: 'A etiqueta ficou com o endereço de outra peça, e o sistema marcou essa outra peça como '
      + 'pronta.',
    oQueFazer: 'Vá na aba 3 Etiquetas, ache a peça e aperte “Apagar a gravação” — são duas perguntas e '
      + 'a sua senha. A peça volta para a fila. Atenção: a ETIQUETA continua com o endereço antigo '
      + 'dentro dela. Ache essa etiqueta e grave-a de novo, ou descarte-a antes de costurar.',
  },
  {
    chave: 'nao-pergunta-nada',
    sintoma: 'Encosto o celular e não acontece nada',
    oQueHouve: 'Ou o NFC está desligado, ou o celular não está encostando na parte certa, ou tem metal '
      + 'no caminho.',
    oQueFazer: 'Ligue o NFC nos ajustes do celular. Tire a capinha, se ela for grossa ou tiver ímã. '
      + 'Encoste devagar e vá deslizando até achar o ponto — no iPhone o leitor fica na parte de cima '
      + 'das costas; no Android costuma ficar no meio das costas. Segure parado: depois de 8 segundos '
      + 'a tela desiste sozinha e você começa de novo.',
  },
  {
    chave: 'iphone-sem-botao',
    sintoma: 'Estou no iPhone e não aparece o botão de gravar',
    oQueHouve: 'O navegador do iPhone não grava NFC. É limite da Apple, e não defeito da ferramenta.',
    oQueFazer: 'Use o modo do aplicativo, que é o que a tela já abre no iPhone: copie o endereço, grave '
      + 'pelo aplicativo de NFC e volte aqui para tocar em “✓ Gravei essa”. Sem esse toque a peça não '
      + 'conta como pronta, e a fila não anda.',
  },
  {
    chave: 'computador-sem-modo',
    sintoma: 'No computador não aparece o modo de encostar',
    oQueHouve: 'Computador não tem NFC. A tela mostra o modo do aplicativo, que é copiar o endereço. '
      + 'O modo do leitor de mesa só existe dentro do programa do gravador — pelo navegador comum ele '
      + 'não aparece, e não é defeito.',
    oQueFazer: 'Abra o programa “Gravador de Etiquetas” e entre na Central por ele; ou grave pelo '
      + 'celular; ou abra a gaveta “Gravador de mesa” e baixe a lista das que faltam. '
      + 'Depois cole de volta o texto que a máquina devolver e confirme — esse é o único caminho que '
      + 'marca peça sem conferir etiqueta, então só use depois de gravar de verdade.',
  },
  {
    chave: 'gravou-sem-marcar',
    sintoma: 'A tela diz que gravou, mas não marcou a peça',
    oQueHouve: 'A etiqueta recebeu o endereço e o registro no sistema não entrou — quase sempre é a '
      + 'internet caindo no meio.',
    oQueFazer: 'NÃO pegue outra etiqueta. Encoste ESTA mesma de novo: a tela lê, vê que já é a peça '
      + 'certa e marca sem regravar nada.',
  },
]

// ── O GUIA DA PRIMEIRA VEZ ─────────────────────────────────────────────────
// A ordem não é enfeite: primeiro o PARA QUE serve, depois o caminho inteiro em
// três estágios, depois ONDE a etiqueta vai (é o erro que estraga a peça na
// fábrica), o como, quem grava por onde, a trava — e por último o socorro, que
// é onde a pessoa volta quando alguma coisa der errado.
//
// As telas dos estágios e as do socorro NASCEM das listas acima, e não são
// escritas de novo: texto repetido em dois lugares é texto que diverge.
const telaDoEstagio = (e) => ({
  chave: `estagio-${e.n}`,
  titulo: e.titulo,
  texto: e.oQueFazer,
  itens: [
    { rotulo: 'O que a tela mostra', texto: e.oQueATelaMostra },
    { rotulo: 'Como saber que deu certo', texto: e.comoSaber },
  ],
})

// O socorro vem em duas telas de propósito: sete casos numa tela só viram um
// muro de texto, e muro de texto ninguém lê de pé na bancada.
const telaDeSocorro = (titulo, casos) => ({
  chave: `socorro-${casos[0].chave}`,
  titulo,
  texto: 'Cada caso diz o que houve e o que fazer. Nada aqui exige chamar alguém.',
  itens: casos.map((c) => ({ rotulo: c.sintoma, texto: `${c.oQueHouve} ${c.oQueFazer}` })),
})

export const TELAS_DO_GUIA = [
  {
    chave: 'para-que-serve',
    titulo: 'Para que serve',
    texto: 'Cada bolsa ganha uma etiqueta com um endereço só dela. A cliente encosta o celular '
      + 'e abre uma página provando que a bolsa é original, com a garantia dela.',
  },
  ...ESTAGIOS.map(telaDoEstagio),
  {
    chave: 'onde-a-etiqueta-vai',
    titulo: 'Onde a etiqueta vai',
    texto: 'Costurada no forro interno, longe de fecho, rebite e corrente. Etiqueta encostada em '
      + 'metal não é lida pelo celular — e etiqueta que não lê faz a cliente achar que a bolsa é falsa.',
    itens: [
      {
        rotulo: 'Na bolsa',
        texto: 'Costurada no forro interno. O couro e o tecido não atrapalham a leitura; metal '
          + 'atrapalha, então deixe pelo menos dois dedos de distância de fecho, rebite e corrente.',
      },
      {
        rotulo: 'Onde encostar o celular',
        texto: 'No iPhone o leitor fica na parte de CIMA das costas, perto da câmera. No Android '
          + 'costuma ficar no MEIO das costas. Encoste devagar e vá deslizando até a tela reagir.',
      },
      {
        rotulo: 'Segure parado',
        texto: 'Até a confirmação aparecer. Tirar o celular no meio é o que mais faz a gravação '
          + 'falhar — e a tela avisa: “A etiqueta saiu de perto no meio”.',
      },
    ],
  },
  {
    chave: 'como-gravar',
    titulo: 'Como gravar',
    texto: 'Escolha o lote, toque em Gravar e encoste o celular na etiqueta, segurando parado. '
      + 'Quando terminar, a tela já mostra a próxima peça. Uma etiqueta de cada vez.',
  },
  {
    chave: 'o-que-a-tela-faz',
    titulo: 'O que a tela faz por você',
    texto: 'Ela lê a etiqueta ANTES, para nunca escrever por cima da peça de outra bolsa. E lê '
      + 'DEPOIS, para só dar a peça por pronta quando a etiqueta devolver o que foi gravado.',
  },
  {
    chave: 'quem-grava-por-onde',
    titulo: 'Quem grava por onde',
    texto: 'Nem todo aparelho grava NFC, e a tela se ajusta sozinha ao que você está usando.',
    itens: ONDE_SE_GRAVA.map((g) => ({ rotulo: g.onde, texto: g.como })),
  },
  {
    chave: 'a-trava',
    titulo: 'A trava',
    texto: 'Travar deixa a etiqueta impossível de regravar, para sempre. Ela nasce desligada. '
      + 'Quando for ligar, faça o primeiro teste numa etiqueta descartável.',
  },
  telaDeSocorro('Deu errado, e agora? (1 de 2)', SOCORRO.slice(0, 4)),
  telaDeSocorro('Deu errado, e agora? (2 de 2)', SOCORRO.slice(4)),
]

const CHAVE_DO_GUIA = 'autenticidade-guia-visto'

// O depósito entra por parâmetro para o teste conseguir fingir — e porque
// `localStorage` ESTOURA em janela anônima e com dados de site bloqueados. Por
// isso todo acesso vai dentro de try/catch, como o resto do projeto faz.
export function guiaJaVisto(deposito) {
  try {
    const d = deposito || (typeof localStorage !== 'undefined' ? localStorage : null)
    return d?.getItem(CHAVE_DO_GUIA) === 'sim'
  } catch { return false }
}

export function marcarGuiaVisto(deposito) {
  try {
    const d = deposito || (typeof localStorage !== 'undefined' ? localStorage : null)
    d?.setItem(CHAVE_DO_GUIA, 'sim')
    return true
  } catch { return false }
}

/** Devolve o índice da tela seguinte, ou null quando o guia acabou. */
export function proximaTelaDoGuia(indice) {
  const i = Number(indice)
  if (!Number.isInteger(i) || i < 0) return 0
  return i + 1 < TELAS_DO_GUIA.length ? i + 1 : null
}

/**
 * O índice da tela anterior, ou null quando já se está na primeira.
 *
 * NASCEU COM O GUIA LONGO: com cinco telas, quem passava direto pela que
 * interessava recomeçava o guia inteiro. Com o guia de bancada são mais de dez,
 * e "voltar uma" deixou de ser luxo.
 */
export function telaAnteriorDoGuia(indice) {
  const i = Number(indice)
  if (!Number.isInteger(i) || i <= 0) return null
  return Math.min(i, TELAS_DO_GUIA.length - 1) - 1
}
