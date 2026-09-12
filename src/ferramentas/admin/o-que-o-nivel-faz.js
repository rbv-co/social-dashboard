//
// O QUE CADA NÍVEL PERMITE, NAQUELA FERRAMENTA, EM PORTUGUÊS.
//
// POR QUE EXISTE (desenho de 11/08/2026, D2): a escada escreve "Ver e mexer"
// com a mesma cara em toda linha, e o significado é incomparável:
//   Frota           → pega e devolve carro, faz o checklist
//   Gestão de Tráfego → muda orçamento de campanha que está gastando AGORA
// Quem concede não tinha como saber a diferença sem conhecer a ferramenta por
// dentro. O dono pediu literalmente "um detalhamento maior do que é cada
// permissão".
//
// REGRA QUE NÃO SE NEGOCIA: frase errada é pior que frase nenhuma — ela vai ser
// lida como verdade na hora de dar acesso. Ferramenta cuja mecânica não foi
// conferida NÃO ganha frase inventada; cai no texto neutro.
//
// A segunda metade da frase (o que a pessoa NÃO consegue) costuma valer mais
// que a primeira: é ela que responde a dúvida de quem está decidindo.
//
// TASK 2b (11/08/2026): mais 9 ferramentas ganharam frase, todas com
// evidência de arquivo:linha registrada em
// .superpowers/sdd/2026-08-11-config-usuarios-f1-leitura/evidencia-das-frases.md
// (gitignorado — é o memorial de prova, não faz parte do commit). Outras 6
// ficaram de fora e continuam no texto neutro — o motivo de cada uma está no
// mesmo relatório (task-2b-report.md), não aqui.
//
// PURO: sem rede, sem DOM.

export const FRASES = {
  frota: {
    sem: 'A Frota não aparece no menu dela.',
    ver: 'Enxerga os carros e de quem é cada um. Não registra nada.',
    mexer: 'Pega e devolve carro, faz o checklist do dia e pede requisição. '
      + 'Não cadastra veículo novo nem apaga.',
    tudo: 'Cadastra e apaga veículo, edita o plano de revisão, e preenche o '
      + 'checklist pelos outros — inclusive pelos motoristas que não têm login.',
  },
  'frota.aprovar': {
    sem: 'Não decide requisição de carro; só pede.',
    ver: 'Aprova e recusa os pedidos de carro de todo mundo.',
  },
  'meta.gestor': {
    sem: 'A Gestão de Tráfego não aparece no menu dela.',
    ver: 'Acompanha o gasto e o resultado das campanhas. Não altera nada.',
    mexer: 'Muda o orçamento de campanha que está gastando agora, pausa e '
      + 'reativa anúncio no ar, aprova as sugestões do robô, e cria e duplica '
      + 'campanha na conta de anúncios.',
  },
  'meta.fabrica': {
    sem: 'A Fábrica de Anúncios não aparece no menu dela.',
    ver: 'Vê os criativos e as campanhas que a Fábrica montou. Não gera nem sobe.',
    mexer: 'Gera criativo com IA e monta campanha. O que sobe para a Meta '
      + 'nasce pausado, e alguém precisa ativar.',
  },
  acessos: {
    sem: 'Colaboradores e Acessos não aparece no menu dela.',
    ver: 'Consulta a ficha dos colaboradores e o que cada um acessa.',
    mexer: 'Edita a ficha, liga contas do Zoho e do OneDrive e registra termos. '
      + 'Não desliga nem apaga colaborador.',
    tudo: 'Tudo do anterior, mais desligar e apagar colaborador do cadastro.',
  },
  patrimonio: {
    sem: 'O Patrimônio não aparece no menu dela.',
    ver: 'Consulta os bens, onde estão e com quem.',
    mexer: 'Registra troca de posse e corrige a ficha do bem. Não cadastra bem novo.',
    tudo: 'Cadastra e apaga bem, e imprime as etiquetas.',
  },
  social: {
    // O card de Redes Sociais na tela de Início (tela-de-inicio.vue:184) é um
    // OU de TRÊS chaves: social || social.relatorio || conteudo. Quem perde
    // 'social' e fica com 'social.relatorio' continua vendo o menu — e hoje 13
    // das 15 pessoas têm 'social.relatorio'. A frase fala do que é verdade em
    // qualquer combinação: o painel em si (tela-de-menu-redes.vue:64) não abre.
    sem: 'O painel de Redes Sociais não abre para ela.',
    // O degrau "Ver e baixar" SAIU em 13/08/2026 (item B1e): o Dashboard de
    // Redes nunca teve download, e a frase aqui prometia a planilha que não
    // existe. Frase errada é pior que frase nenhuma — e esta era das piores,
    // porque descrevia com detalhe algo que não acontece.
    ver: 'Vê os números dos perfis. É painel de leitura: nada aqui se altera.',
  },
  // Ganhou frase em 13/08/2026, quando os degraus passaram a valer (item B1c).
  // Antes ficava no texto neutro de propósito: não dava para escrever a verdade
  // sobre níveis que não governavam nada — quem tinha "Só ver" enviava arquivo,
  // e "Tudo" não apagava.
  banco: {
    sem: 'O Banco de Arquivos não aparece no menu dela.',
    // A escada desta ferramenta tem TRÊS degraus, não quatro: 'criar' e
    // 'excluir' entram juntas no "Tudo" (niveis-de-permissao.js:60), então não
    // existe "envia mas não apaga" para conceder pela tela. A frase diz isso
    // com todas as letras, porque é a pergunta que quem concede vai fazer.
    ver: 'Abre a lista e baixa qualquer arquivo. Não envia nem apaga — a área '
      + 'de envio nem aparece para ela.',
    tudo: 'Baixa, ENVIA e APAGA arquivo, inclusive os que outra pessoa subiu. '
      + 'Não dá para separar: quem envia também apaga. E apagar aqui é '
      + 'definitivo — o arquivo sai do armazenamento e não há lixeira.',
  },
  conteudo: {
    sem: 'A Central de Conteúdo não aparece no menu dela.',
    ver: 'Vê o calendário de posts e as artes já aprovadas.',
    mexer: 'Cria peça, sobe a arte e agenda. Não aprova a própria peça — '
      + 'aprovar é a chave separada, logo abaixo.',
    tudo: 'Tudo do anterior, mais apagar peça agendada.',
  },
  'conteudo.aprovar': {
    // conteudo/painel-peca.vue:215 (botão "Aprovar e agendar", só com
    // podeAprovar) e :233-245 (reprovar, que pede o motivo); a decisão em si
    // passa por estados.js:69 (podeTransicionar exige podeAprovar) e
    // dados-conteudo.js:56-58 (podeAprovar lê 'conteudo.aprovar').
    sem: 'Não decide (aprova ou reprova) peça de ninguém.',
    ver: 'Aprova e reprova a peça de qualquer um, com o motivo da recusa. '
      + 'A tela esconde o botão, mas quem trava de verdade é o banco.',
  },
  gestor: {
    // gestao-comercial/tela-de-gestao-comercial.vue:348 (guarda de entrada) e
    // :18 (a aba de Relatórios só aparece com podeRelatorios — chave
    // separada, abaixo). O briefing (gc-body) é só leitura: sem .insert/
    // .update/.delete no arquivo inteiro.
    sem: 'A Gestão Comercial não aparece no menu dela.',
    ver: 'Lê o briefing semanal que a IA escreve sobre a área comercial. '
      + 'Não vê a aba de Relatórios — essa é chave separada, logo abaixo.',
  },
  'gestor.relatorios': {
    // gestao-comercial/tela-de-gestao-comercial.vue:18 (a aba só existe com
    // podeRelatorios) e relatorios-comerciais.vue:57+335 (botão "Exportar"
    // só com podeExportar).
    sem: 'A aba de Relatórios não aparece dentro da Gestão Comercial — só o '
      + 'briefing.',
    ver: 'Abre a aba de Relatórios Comerciais e consulta os números. Não '
      + 'baixa nada.',
    exportar: 'Abre a aba de Relatórios Comerciais, consulta e baixa o '
      + 'relatório.',
  },
  'claude.status': {
    // mapa-de-enderecos.js:31 (rota gateada em 'ver'); dentro da tela não há
    // NENHUM hasPermission. Em 19/08/2026 o quadro de projetos saiu da tela, e
    // com ele o único lugar em que essa permissão dava direito de ESCREVER —
    // hoje a tela inteira é de leitura. Não existe outro degrau no catálogo.
    sem: 'O Status da IA não aparece no menu dela.',
    ver: 'Vê o gasto real das contas de IA, quanto cada tarefa custou e como '
      + 'os robôs estão indo. É uma tela só de leitura: não há nada para '
      + 'alterar aqui dentro, e não há nível intermediário.',
  },
  noticias: {
    // mapa-de-enderecos.js:7 (rota gateada em 'ver'); a tela inteira só faz
    // .select (loadNoticias, tela-de-noticias.vue) — nenhum insert/update/
    // delete no arquivo. É porta fechada ou vitrine de leitura, sem meio-termo.
    sem: 'O Portal de Notícias não aparece no menu dela.',
    ver: 'Lê o resumo do mercado e das concorrentes, edição por edição. É '
      + 'vitrine: nada aqui se registra ou se altera.',
  },
  autenticidade: {
    // tela-de-autenticidade.vue:15 (botão "Gerar lote", só com podeCriar) e
    // :75 (botão "Gravei essa", só com podeEditar); "Baixar planilha" (linha
    // 85-87) não tem guarda própria — é liberado a partir do 'ver'.
    sem: 'Autenticidade e Garantia não aparece no menu dela.',
    ver: 'Vê os lotes de etiquetas, o progresso de gravação, os registros de '
      + 'garantia das clientes e os alertas de leitura suspeita, e baixa a '
      + 'planilha de registros. Não gera lote novo nem marca etiqueta como gravada.',
    mexer: 'Marca cada etiqueta como gravada, uma a uma. Não gera lote novo.',
    tudo: 'Tudo do anterior, mais gerar lote novo de etiquetas.',
  },
  'social.relatorio': {
    // tela-de-relatorio-redes.vue:229 (guarda de entrada em 'ver'; sem ela a
    // tela devolve pro Início) e :27+119 (bloco de exportar só com
    // podeExportar). ATENÇÃO: o card "Relatório Interativo" no submenu de
    // Redes Sociais (tela-de-menu-redes.vue:24) é visível só para
    // estado.role==='admin', que é OUTRO controle — por isso o degrau "sem"
    // aqui fala da própria tela, não do card do submenu.
    sem: 'Não abre o Relatório Interativo — tentando entrar, a tela manda '
      + 'de volta pro Início.',
    ver: 'Vê a planilha do histórico coletado, dia a dia, por perfil, e '
      + 'ordena e filtra as colunas. Não baixa o arquivo.',
    exportar: 'Vê, ordena e filtra a planilha, e baixa em CSV.',
  },
  'patrimonio.relatorios': {
    // tela-de-patrimonio.vue:49 (a aba só aparece com podeRelatorios) e
    // relatorios-do-patrimonio.js + aba-de-relatorios.vue (pode-exportar =
    // podeExportarRelatorio, linha 930).
    sem: 'A aba de Relatórios não aparece dentro do Patrimônio.',
    ver: 'Abre a aba de Relatórios do Patrimônio e consulta os números. Não '
      + 'baixa a planilha.',
    exportar: 'Abre a aba de Relatórios do Patrimônio, consulta e baixa a '
      + 'planilha.',
  },
  'frota.relatorios': {
    // tela-de-frota.vue:107-110 (podeRelatorios decide se a aba entra em
    // areasVisiveis) e :108+2319 (pode-exportar = podeExportarRelatorio).
    sem: 'A aba de Relatórios não aparece dentro da Frota.',
    ver: 'Abre a aba de Relatórios da Frota e consulta os números. Não '
      + 'baixa a planilha.',
    exportar: 'Abre a aba de Relatórios da Frota, consulta e baixa a '
      + 'planilha.',
  },
}

// O que se diz quando a mecânica daquela ferramenta ainda não foi conferida
// com o dono. Descreve o EFEITO do nível, que é verdade em qualquer ferramenta,
// e não afirma nada sobre o que ela faz por dentro.
export const NEUTRO = {
  // NÃO diz "não aparece no menu": este texto vale pra qualquer ferramenta, e
  // há card de menu liberado por um OU de várias chaves — Vendas
  // (sales.gestao || sales.analise) e Meta (meta.campanha || meta.gestor),
  // tela-de-inicio.vue:185-186. Perder UMA chave não faz o card sumir. O que
  // é verdade em todo caso é que a ferramenta em si não abre.
  sem: 'Essa ferramenta não abre para ela.',
  ver: 'Abre e consulta, sem alterar nada.',
  exportar: 'Abre, consulta e baixa a planilha, sem alterar nada.',
  mexer: 'Abre e altera o que já existe. Não cria nem apaga.',
  tudo: 'Abre, altera, cria e apaga.',
}

export function temFraseConferida(recursoKey) {
  return Object.prototype.hasOwnProperty.call(FRASES, recursoKey)
}

export function oQueONivelFaz(recursoKey, degrauChave) {
  const d = degrauChave || 'sem'
  const doRecurso = FRASES[recursoKey]
  if (doRecurso && doRecurso[d]) return doRecurso[d]
  return NEUTRO[d] || NEUTRO.sem
}
