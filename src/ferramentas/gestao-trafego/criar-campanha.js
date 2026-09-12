// O ASSISTENTE DE CRIAR CAMPANHA — os passos, o que cada um exige, e o resumo.
//
// PURO: sem rede e sem tela. Quem fala com a Meta é o editor; aqui mora a
// decisão de quando dá para avançar e o que vai ser criado.
//
// O PAYLOAD NÃO É MONTADO AQUI. Ele sai de `coletor/lib/payload-campanha.mjs`,
// o MESMO montador que a Fábrica usa para subir campanha de verdade há meses.
// Escrever um segundo montador ao lado de um provado foi o erro mais caro desta
// série: a Meta recusou quatro vezes seguidas, cada uma por um campo que o
// original já mandava.
import { payloadCampanhaAdset } from '../../../coletor/lib/payload-campanha.mjs';
import { payloadCriativa } from '../../../coletor/lib/meta-subir.mjs';
import { pedeNumeroDeWhatsapp, pedeEnderecoDoSite, podeSerCriado, bloqueio, usaPublicacao } from './subobjetivos.js';
import { montarSaudacao, extrasDoCriativo, botaoEscolhido } from './campos-do-anuncio.js';

// OS QUATRO PASSOS, na ordem em que a decisão acontece: o que se quer, quanto
// custa, para quem, e o que a pessoa vê. Cada um é uma pergunta, e é por isso
// que o assistente tem quatro telas em vez de um formulário só.
export const PASSOS = [
  { chave: 'objetivo', titulo: 'O que você quer que aconteça',
    ajuda: 'Isto define como a Meta entrega e o que ela otimiza.' },
  // DE QUEM É O ANÚNCIO vem logo depois do objetivo, e não do cadastro da
  // Fábrica. Amarrar isto à marca cadastrada foi um erro de desenho: o dono
  // quer criar campanha do zero em qualquer conta, escolhendo a página, o
  // Instagram e o número na hora. Fica aqui porque o objetivo é quem decide se
  // o WhatsApp é pedido ou não.
  { chave: 'identidade', titulo: 'De quem é o anúncio',
    ajuda: 'A página e o perfil que aparecem para quem vê.' },
  { chave: 'orcamento', titulo: 'Quanto por dia',
    ajuda: 'A campanha nasce PAUSADA — nada é gasto até você ativar.' },
  { chave: 'publico', titulo: 'Para quem',
    ajuda: 'Onde a campanha vai rodar e quem vai ver.' },
  { chave: 'anuncio', titulo: 'O anúncio',
    ajuda: 'A imagem e o texto que as pessoas vão ver.' },
];

// A Meta recusa imagem pequena — medido em 2026-08-03: um PNG de 95 bytes voltou
// `100/2446496 "Formato de imagem"`, com o tamanho no corpo do erro. O aviso tem
// de vir ANTES do envio: descobrir depois de esperar o upload é o pior momento.
export const LADO_MINIMO_PX = 600;
export const TAMANHO_MINIMO_BYTES = 10 * 1024;

// Piso de orçamento diário, o mesmo da fila: a Meta recusa valores muito baixos
// e o número exato varia com moeda e objetivo.
export const ORCAMENTO_MINIMO_CENTAVOS = 500;

export function estadoInicial() {
  return {
    objetivo: '',           // chave de fabrica_objetivos
    nome: '',
    // Escolhidos na tela, não herdados de cadastro nenhum.
    pageId: '',
    igId: '',
    whatsapp: '',           // só usado quando o sub-objetivo leva para o WhatsApp
    site: '',               // só usado quando o sub-objetivo leva para um site
    orcamentoCentavos: 5000,
    tipoOrcamento: 'diario',
    // Só usada quando o orçamento é TOTAL. A Meta exige `end_time` para
    // lifetime_budget — sem data, ela recusa o conjunto.
    terminaEm: '',
    publico: null,          // forma do publico-alvo.js
    imagemHash: '',
    imagemPreview: '',
    // VÍDEO: quando preenchido, manda no criativo em vez da imagem. A capa é
    // obrigatória — medido num anúncio real da conta, que carrega `image_url`
    // dentro do `video_data`.
    videoId: '',
    videoCapa: '',
    texto: '',
    // Só usados quando o tipo impulsiona uma publicação que já está no ar.
    publicacaoId: '',
    publicacaoResumo: '',
  };
}

const texto = (v) => (typeof v === 'string' ? v.trim() : '');

// ESTE OBJETIVO PRECISA DE UM NÚMERO DE WHATSAPP?
//
// Duas evidências, e as duas contam: `promoted_object_tipo === 'whatsapp'` é o
// que a Fábrica declara, e `destination_type` contendo WHATSAPP é o que a Meta
// usa para montar o criativo. Objetivo pode ter um sem o outro, e faltar o
// número em qualquer um dos casos faz a Meta recusar o conjunto.
// QUEM DECIDE É O CATÁLOGO, e não o formato do `destination_type`. A primeira
// versão olhava "contém WHATSAPP" no destino, o que funcionava por acidente:
// `MESSAGING_INSTAGRAM_DIRECT_MESSENGER_WHATSAPP` contém, e `INSTAGRAM_DIRECT`
// não — mas quem sabe disso é a linha do catálogo, que já declara o que precisa.
export const pedeWhatsapp = (sub) => pedeNumeroDeWhatsapp(sub);
export const pedeSite = (sub) => pedeEnderecoDoSite(sub);

// Endereço de site que a Meta aceita: precisa ter esquema e domínio. "loja.com"
// sem http é recusado, e descobrir isso na resposta dela é o pior momento.
export function siteValido(v) {
  const t = texto(v);
  if (!/^https?:\/\//i.test(t)) return false;
  try { return !!new URL(t).hostname.includes('.'); } catch { return false; }
}

// Só dígitos, para comparar tamanho. O criativo da Fábrica já faz o mesmo
// (`soDigitos` em meta-subir.mjs) antes de montar o link do wa.me.
const digitos = (v) => String(v == null ? '' : v).replace(/\D/g, '');

// OS NÚMEROS QUE JÁ FUNCIONAM NESTA CONTA, tirados dos conjuntos que existem.
//
// POR QUE (medido ao vivo em 03/08/2026): a Meta recusa número que não esteja
// ligado à conta, com "This WhatsApp phone number is not linked to your
// account" — e não existe endpoint que liste os números permitidos. O que
// existe é a prova pelo uso: todo conjunto de WhatsApp que já roda carrega, no
// `promoted_object`, o par página + número que a Meta ACEITOU.
//
// Então em vez de deixar digitar no escuro, oferecemos o que já deu certo. Quem
// tiver um número novo continua podendo digitar — a lista é atalho, não trava.
export function numerosJaUsados(conjuntos) {
  const vistos = new Map();
  for (const cj of (Array.isArray(conjuntos) ? conjuntos : [])) {
    const po = cj && cj.promoted_object;
    const numero = po && po.whatsapp_phone_number;
    if (!numero) continue;
    const chave = `${po.page_id || ''}|${numero}`;
    if (!vistos.has(chave)) vistos.set(chave, { pageId: String(po.page_id || ''), numero: String(numero) });
  }
  return [...vistos.values()];
}

// Os números desta página primeiro; se ela não tem nenhum, mostra os da conta —
// é melhor um palpite útil que uma lista vazia, e a pessoa vê de qual página é.
export function numerosParaPagina(numeros, pageId) {
  const lista = Array.isArray(numeros) ? numeros : [];
  const daPagina = lista.filter((n) => String(n.pageId) === String(pageId));
  return daPagina.length ? daPagina : lista;
}

// Um número brasileiro com DDI+DDD+número tem 12 ou 13 dígitos (13 com o 9).
// Abaixo disso é engano de digitação, e o anúncio sairia com um link morto —
// que é pior que não sair, porque gasta.
export const MINIMO_DE_DIGITOS_WHATSAPP = 12;

// O QUE FALTA NESTE PASSO — lista de frases, vazia quando dá para avançar.
//
// Devolve FRASES, não códigos: quem chama mostra direto, e uma mensagem escrita
// aqui perto da regra tem chance de continuar verdadeira quando a regra mudar.
export function faltaNoPasso(chave, estado, objetivoRow) {
  const e = estado || {};
  const faltas = [];
  if (chave === 'identidade') {
    if (!texto(e.pageId)) faltas.push('Escolha a página do Facebook que assina o anúncio.');
    // O Instagram NÃO é obrigatório: anúncio só de Facebook existe. Mas a
    // maioria das páginas tem um perfil ligado, e sair sem ele significa não
    // aparecer no Instagram — então o assistente avisa em vez de barrar.
    if (pedeWhatsapp(objetivoRow) && digitos(e.whatsapp).length < MINIMO_DE_DIGITOS_WHATSAPP) {
      faltas.push('Este objetivo leva a conversa para o WhatsApp — informe o número com DDI e DDD (ex.: 55 19 99999-9999).');
    }
    if (pedeSite(objetivoRow) && !siteValido(e.site)) {
      faltas.push('Este objetivo leva para um site — informe o endereço completo, começando com https://');
    }
  }
  if (chave === 'objetivo') {
    if (!texto(e.objetivo)) faltas.push('Escolha o que você quer que aconteça.');
    // O QUE AINDA NÃO DÁ PARA CRIAR aparece na lista, mas não deixa avançar — e
    // repete aqui o motivo, porque quem clicou em "Avançar" pode não ter lido o
    // aviso lá em cima.
    else if (objetivoRow && !podeSerCriado(objetivoRow)) faltas.push(bloqueio(objetivoRow));
    if (!texto(e.nome)) faltas.push('Dê um nome à campanha — é por ele que você vai achá-la depois.');
  }
  if (chave === 'orcamento') {
    const c = Number(e.orcamentoCentavos);
    if (!Number.isFinite(c) || c <= 0) faltas.push('Informe quanto pode ser gasto por dia.');
    else if (c < ORCAMENTO_MINIMO_CENTAVOS) {
      faltas.push(`A Meta não aceita menos de ${(ORCAMENTO_MINIMO_CENTAVOS / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por dia.`);
    }
    // ORÇAMENTO TOTAL EXIGE DATA DE TÉRMINO. É a Meta que exige (`lifetime_budget`
    // sem `end_time` é recusado), e faz sentido: um valor total sem prazo não diz
    // em quanto tempo gastar. Pedir aqui evita a recusa lá.
    if (e.tipoOrcamento === 'total' && !texto(e.terminaEm)) {
      faltas.push('Escolha até quando a campanha vai rodar — orçamento total precisa de uma data de término.');
    }
  }
  if (chave === 'publico') {
    // Localização é a única coisa que a Meta EXIGE, e é a que barra o salvamento
    // no editor de público — a mesma regra, no mesmo lugar do fluxo.
    const p = e.publico || {};
    const temCidade = (p.cidades || []).length > 0;
    const temOutra = (p.outrasLocalizacoes || []).length > 0;
    if (!temCidade && !temOutra) faltas.push('Escolha pelo menos uma cidade ou região — a Meta exige um lugar.');
  }
  if (chave === 'anuncio') {
    // DOIS CAMINHOS, e é o tipo escolhido que decide qual. Impulsionar uma
    // publicação não pede imagem nem texto: a arte e a legenda são as do post,
    // e pedir de novo faria escrever um texto que nunca apareceria.
    if (usaPublicacao(objetivoRow)) {
      if (!texto(e.publicacaoId)) faltas.push('Escolha a publicação que vai ser impulsionada.');
    } else {
      if (!texto(e.imagemHash) && !texto(e.videoId)) faltas.push('Escolha uma imagem ou um vídeo, ou envie um.');
      // A CAPA DO VÍDEO é exigida pela Meta dentro do `video_data`. Sem ela o
      // criativo é recusado, e o erro só apareceria na hora de criar.
      if (texto(e.videoId) && !texto(e.videoCapa)) faltas.push('Este vídeo não tem capa. Escolha outro, ou envie uma imagem.');
      if (!texto(e.texto)) faltas.push('Escreva o texto que vai aparecer no anúncio.');
    }
  }
  return faltas;
}

export const podeAvancar = (chave, estado, objetivoRow) => faltaNoPasso(chave, estado, objetivoRow).length === 0;

// O PRIMEIRO PASSO INCOMPLETO — para o assistente saber onde parar quando alguém
// pula direto para o fim, e para o botão final não prometer o que não pode.
export function primeiroPassoIncompleto(estado, objetivoRow) {
  for (const p of PASSOS) if (!podeAvancar(p.chave, estado, objetivoRow)) return p.chave;
  return null;
}

// A IMAGEM SERVE? — checagem no navegador, antes de subir.
//
// A Meta recusa imagem pequena, e descobrir isso depois de esperar o upload é o
// pior momento possível. `largura`/`altura` vêm do próprio navegador ao ler o
// arquivo; `bytes` do File. Tudo opcional: o que não se sabe não vira acusação.
export function imagemServe({ bytes, largura, altura } = {}) {
  const problemas = [];
  if (Number.isFinite(bytes) && bytes < TAMANHO_MINIMO_BYTES) {
    problemas.push('Esta imagem é pequena demais e a Meta recusa. Use uma maior.');
  }
  if (Number.isFinite(largura) && Number.isFinite(altura) && (largura < LADO_MINIMO_PX || altura < LADO_MINIMO_PX)) {
    problemas.push(`A imagem tem ${largura}×${altura}. A Meta pede pelo menos ${LADO_MINIMO_PX}×${LADO_MINIMO_PX}.`);
  }
  return { ok: problemas.length === 0, problemas };
}

const reais = (c) => (Number(c) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// A DATA DO CAMPO ("2026-08-31") vira o FIM daquele dia, não o começo.
// Quem escolhe 31 quer que rode o dia 31 inteiro; mandar 00:00 encerraria a
// campanha antes de o dia começar. Sem fuso escrito à mão: a Meta interpreta na
// zona da conta de anúncios, que é a mesma de quem está olhando a tela.
export function horarioDeTermino(data) {
  const d = String(data || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59` : '';
}

// O QUE VAI SER CRIADO, em português, para a confirmação.
//
// A janela de confirmar é a última chance de perceber que se está criando a
// coisa errada — então ela lista tudo, e diz que nasce pausado. Prometer "criar
// campanha" sem dizer que ela não vai rodar seria esconder a melhor parte.
export function resumoDoQueVaiSerCriado(estado, objetivoRotulo, identidade, sub) {
  const e = estado || {};
  const p = e.publico || {};
  const id = identidade || {};
  const linhas = [
    `Campanha "${texto(e.nome)}" — ${objetivoRotulo || texto(e.objetivo)}`,
  ];
  // A PÁGINA ENTRA NA CONFIRMAÇÃO, e é a linha mais importante depois do nome:
  // é a única coisa desta tela que muda de quem o anúncio parece ser, e a única
  // que ninguém percebe estar errada depois de criado.
  if (texto(id.pagina) || texto(e.pageId)) {
    linhas.push(`Assinada por ${texto(id.pagina) || `página ${texto(e.pageId)}`}`
      + (texto(id.instagram) ? ` e @${texto(id.instagram)}` : ' (sem Instagram ligado)'));
  }
  // SÓ O CANAL DESTE TIPO. O número e o endereço podem estar preenchidos sem
  // serem usados — o do WhatsApp vem sugerido do cadastro da marca, e fica lá
  // mesmo quando se escolhe um tipo que leva ao Direct. Visto ao vivo:
  // uma campanha de Direct dizia "Conversas vão para o WhatsApp +55…", que é
  // mentira, e mentira justamente na tela que existe para conferir.
  //
  // Quando `sub` não vem (chamada antiga), volta a mostrar o que estiver
  // preenchido: melhor a informação a mais do que a menos.
  const mostraWhats = sub ? pedeWhatsapp(sub) : true;
  const mostraSite = sub ? pedeSite(sub) : true;
  if (mostraWhats && texto(e.whatsapp)) linhas.push(`Conversas vão para o WhatsApp ${texto(e.whatsapp)}`);
  if (mostraSite && texto(e.site)) linhas.push(`O anúncio leva para ${texto(e.site)}`);
  linhas.push(e.tipoOrcamento === 'total'
    ? `1 conjunto com ${reais(e.orcamentoCentavos)} no total${texto(e.terminaEm) ? `, até ${texto(e.terminaEm).split('-').reverse().join('/')}` : ''}`
    : `1 conjunto com ${reais(e.orcamentoCentavos)} por dia`);
  const cidades = (p.cidades || []).map((c) => c.nome || c.key).filter(Boolean);
  if (cidades.length) linhas.push(`Em ${cidades.join(', ')}`);
  if (p.idadeMin != null && p.idadeMax != null) linhas.push(`Idade ${p.idadeMin}–${p.idadeMax}`);
  const interesses = (p.interesses || []).map((i) => i.name).filter(Boolean);
  if (interesses.length) linhas.push(`Interesses: ${interesses.join(', ')}`);
  linhas.push(usaPublicacao(sub)
    ? `1 anúncio impulsionando ${texto(e.publicacaoResumo) || 'a publicação escolhida'}`
    : (texto(e.videoId) ? '1 anúncio com o vídeo escolhido' : '1 anúncio com a imagem escolhida'));
  return linhas;
}

// OS PAYLOADS PRONTOS PARA A META. Delega no montador compartilhado — este
// arquivo só junta o estado do formulário com a linha do objetivo.
//
// `nome` do formulário SOBRESCREVE o nome automático: quem digitou um nome quer
// aquele nome. O do montador é o padrão da Fábrica, bom para lote e ruim para
// campanha feita à mão.
export function payloadsDoAssistente({ estado, objetivoRow, nomeDaConta }) {
  const e = estado || {};
  if (!objetivoRow || !texto(e.pageId)) return null;
  // A "marca" e a "loja" que o montador da Fábrica espera são montadas AQUI, a
  // partir do que a pessoa escolheu na tela. Antes elas vinham do cadastro, e
  // isso amarrava criar campanha à existência de uma loja registrada — não dava
  // para criar do zero numa conta qualquer, nem escolher outra página.
  //
  // Continuam existindo porque o montador é o mesmo que a Fábrica usa em
  // produção, e trocar a assinatura dele para caber neste caso seria mexer no
  // que já está provado. Traduzir aqui é mais barato que manter dois.
  const marca = { pageId: texto(e.pageId), igId: texto(e.igId) || undefined };
  const loja = {
    nome: texto(nomeDaConta) || 'Campanha',
    whatsapp: texto(e.whatsapp),
    geoCities: [],   // vazio de propósito: o público desta tela sempre traz cidade
  };
  // OS NOMES DOS CAMPOS SÃO OS DE `orcamento.mjs`, e não é detalhe: a primeira
  // versão mandava `tipo:'lifetime'` e `valorCentavos`, e `normalizarOrcamento`
  // — que só conhece `'total'` e `valor` — caía no padrão silenciosamente.
  // Resultado: quem escolhesse "Total R$ 500" criava um conjunto de R$ 500 POR
  // DIA. Nenhum erro, nenhum aviso, e a diferença aparecia na fatura.
  const orcamento = {
    modo: 'ABO',
    tipo: e.tipoOrcamento === 'total' ? 'total' : 'diario',
    valor: Number(e.orcamentoCentavos),
    ...(e.tipoOrcamento === 'total' && texto(e.terminaEm) ? { fim: horarioDeTermino(e.terminaEm) } : {}),
  };
  const { campaign, adset } = payloadCampanhaAdset(
    objetivoRow, marca, loja,
    { DAILY_BUDGET: Number(e.orcamentoCentavos), DATA: '' },
    e.publico ? publicoParaFabrica(e.publico) : null,
    orcamento,
  );
  if (texto(e.nome)) {
    campaign.name = texto(e.nome).slice(0, 200);
    adset.name = `${texto(e.nome)} · conjunto`.slice(0, 200);
  }
  return { campaign, adset };
}

// O CRIATIVO DESTE ASSISTENTE.
//
// Delega no `payloadCriativa` da Fábrica SÓ nos casos que ele já monta provados
// (WhatsApp puro e multi-destino). Os destinos novos são montados aqui, e não
// lá, por dois motivos: mexer num montador que sobe anúncio de verdade há meses
// é o risco que não vale a pena, e a regra nova precisa de um dado que ele nem
// recebe — o endereço do site.
//
// O CUIDADO QUE ISTO RESOLVE: `payloadCriativa` decide pelo `destination_type`,
// e cai no ramo "WhatsApp puro" para qualquer destino que não seja vazio. Com
// `INSTAGRAM_DIRECT` ele montaria um link de wa.me — um anúncio de Direct
// levando para o WhatsApp, sem erro nenhum da Meta.
// O BOTÃO DO ANÚNCIO, por destino. Extraído porque o vídeo precisa do mesmo —
// e duas cópias divergiriam na primeira mudança.
function ctaDoDestino(sub, estado) {
  const dt = String((sub || {}).destination_type || '').toUpperCase();
  const numero = String(estado.whatsapp || '').replace(/\D/g, '');
  if (dt.includes('WHATSAPP')) {
    return { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP', link: `https://api.whatsapp.com/send?phone=${numero}` } };
  }
  if (dt === 'INSTAGRAM_DIRECT') {
    return { type: 'INSTAGRAM_MESSAGE', value: { app_destination: 'INSTAGRAM_DIRECT' } };
  }
  if (pedeSite(sub)) return { type: 'LEARN_MORE', value: { link: texto(estado.site) } };
  return { type: 'LEARN_MORE' };
}

// OS CAMPOS EXTRAS entram DEPOIS, e de uma vez só para todos os caminhos.
//
// Por que depois, e não dentro de cada ramo: o ramo do WhatsApp delega em
// `payloadCriativa`, que é código provado da Fábrica e que eu não quero tocar.
// Costurar título, descrição, botão e saudação em cinco lugares diferentes
// também garantiria esquecer um — e esquecer aqui é o campo sumir CALADO, sem
// erro da Meta, que foi como o título quase se perdeu no ramo de vídeo.
//
// O anúncio que impulsiona uma publicação não passa por aqui de propósito: ele
// não tem `object_story_spec`, e o texto dele é o da publicação original.
function comExtras(criativa, { sub, estado }) {
  const e = estado || {};
  const spec = (criativa || {}).object_story_spec;
  if (!spec) return criativa;
  const ehVideo = !!spec.video_data;
  const dados = spec.video_data || spec.link_data;
  if (!dados) return criativa;

  Object.assign(dados, extrasDoCriativo({ titulo: e.titulo, descricao: e.descricao, video: ehVideo }));

  // O botão: troca só o TIPO e mantém o `value`. O `value` é que carrega o
  // número do WhatsApp e o endereço do site — perdê-lo faria o botão apontar
  // para lugar nenhum.
  //
  // E NÃO MEXE quando existe `asset_feed_spec`: ali a campanha manda três
  // botões de uma vez (Messenger, WhatsApp, Direct) e é a Meta que escolhe onde
  // a pessoa responde melhor. Trocar o botão de baixo brigaria com a lista de
  // cima e quebraria o multi-destino, que é caminho provado da Fábrica.
  if (dados.call_to_action && !criativa.asset_feed_spec) {
    dados.call_to_action = { ...dados.call_to_action, type: botaoEscolhido(sub, e.botao) };
  }

  // A SAUDAÇÃO só existe onde há conversa. Num anúncio de site ela seria um
  // campo ignorado — ou um erro, dependendo do humor da Meta.
  const dt = String((sub || {}).destination_type || '').toUpperCase();
  if (dt.includes('WHATSAPP')) {
    const saudacao = montarSaudacao({ saudacao: e.saudacao, resposta: e.saudacaoResposta });
    if (saudacao) dados.page_welcome_message = saudacao;
  }
  return criativa;
}

export function criativaDoAssistente(args) {
  return comExtras(criativaSemExtras(args), args);
}

function criativaSemExtras({ sub, estado, page, ig }) {
  const e = estado || {};
  const s = sub || {};
  const mensagem = texto(e.texto);
  const dt = String(s.destination_type || '').toUpperCase();

  // IMPULSIONAR UMA PUBLICAÇÃO. Provado ao vivo em 03/08/2026: estes dois
  // campos, e SÓ eles. Mandar `object_story_spec` junto faz a Meta responder
  // "O campo de link é obrigatório" e recusar — os dois caminhos não se
  // misturam, e essa é a armadilha deste trecho.
  if (usaPublicacao(s)) {
    return { instagram_user_id: ig, source_instagram_media_id: texto(e.publicacaoId) };
  }

  // O VÍDEO VEM ANTES DE TUDO, e a ordem não é detalhe: o ramo do WhatsApp
  // delega em `payloadCriativa`, que só sabe montar imagem. Com o vídeo depois
  // dele, um anúncio de vídeo para WhatsApp virava um anúncio de imagem VAZIA —
  // `image_hash: ''` — e a Meta aceitaria o criativo sem nada dentro.
  // Pego por teste antes de chegar na conta (03/08/2026).
  //
  // Formato medido num anúncio real: `video_data` no lugar de `link_data`, com
  // a capa em `image_url` — sem ela a Meta recusa.
  if (texto(e.videoId)) {
    return {
      object_story_spec: {
        page_id: page, instagram_user_id: ig,
        video_data: {
          video_id: texto(e.videoId),
          message: mensagem,
          image_url: texto(e.videoCapa),
          call_to_action: ctaDoDestino(s, e),
        },
      },
    };
  }

  if (dt.includes('WHATSAPP')) {
    // Caminho provado da Fábrica, sem tocar: WhatsApp puro e multi-destino.
    return payloadCriativa({
      hash: texto(e.imagemHash), adsetDestinationType: s.destination_type,
      waNumero: texto(e.whatsapp), page, ig, mensagem,
    });
  }

  const comum = { image_hash: texto(e.imagemHash), message: mensagem };
  if (dt === 'INSTAGRAM_DIRECT') {
    return {
      object_story_spec: { page_id: page, instagram_user_id: ig, link_data: {
        ...comum, link: 'https://www.instagram.com/',
        call_to_action: { type: 'INSTAGRAM_MESSAGE', value: { app_destination: 'INSTAGRAM_DIRECT' } },
      } },
    };
  }
  if (pedeSite(s)) {
    return {
      object_story_spec: { page_id: page, instagram_user_id: ig, link_data: {
        ...comum, link: texto(e.site), call_to_action: { type: 'LEARN_MORE' },
      } },
    };
  }
  // Reconhecimento: sem destino e sem site. Liga ao perfil, como a Fábrica faz.
  return {
    object_story_spec: { page_id: page, instagram_user_id: ig, link_data: {
      ...comum, link: 'https://www.instagram.com/', call_to_action: { type: 'LEARN_MORE' },
    } },
  };
}

// O EDITOR DE PÚBLICO e a FÁBRICA falam formas diferentes do mesmo público: o
// editor guarda `cidades:[{key,raio,unidade}]`, a Fábrica espera
// `geo:{cities:[{key,radius,distance_unit}]}`. Traduzir aqui é o preço de reusar
// o `montarTargeting` que já está provado, e é melhor que manter dois.
export function publicoParaFabrica(pub) {
  const p = pub || {};
  return {
    geo: {
      cities: (p.cidades || []).filter((c) => c && c.key != null).map((c) => ({
        key: String(c.key),
        ...(Number(c.raio) > 0 ? { radius: Number(c.raio), distance_unit: c.unidade === 'mile' ? 'mile' : 'kilometer' } : {}),
      })),
      /* PIN, ESTADO E PAÍS PASSAVAM DIRETO PARA O LIXO ATÉ 18/08/2026.
       *
       * O passo do público EXIGE um lugar e aceita os quatro — cidade, pin no
       * mapa, estado e país. Só a cidade chegava aqui. Quem marcasse um pin
       * criava a campanha SEM ele, calado: o conjunto ia para a Meta com o que
       * sobrou, ou com as cidades da loja como último recurso. Aconteceu com o
       * dono, na Moto Easy.
       *
       * `montarTargeting` (coletor/lib/publico.mjs) sempre soube ler os três, e
       * na MESMA forma que o editor guarda — por isso aqui é passagem direta, e
       * não tradução. Filtrar pin sem coordenada é o único cuidado: um ponto
       * vazio faz a Meta recusar o pedido inteiro. */
      pins: (p.pins || []).filter((x) => x && Number.isFinite(Number(x.lat)) && Number.isFinite(Number(x.lng))),
      countries: (p.paises || []).filter((x) => x && x.key != null),
      regions: (p.estados || []).filter((x) => x && x.key != null),
      excluded: (p.excluidas || []).filter((x) => x && x.key != null).map((x) => ({ key: String(x.key), type: x.tipo === 'regiao' ? 'region' : 'city' })),
    },
    idade_min: p.idadeMin,
    idade_max: p.idadeMax,
    generos: p.generos || [],
    interesses: (p.interesses || []).filter((i) => i && i.id).map((i) => ({ id: String(i.id), name: i.name })),
    // Vieram de um público salvo da conta e vão junto. Sem esta linha, aplicar
    // um público salvo criaria uma campanha com um público MAIS LARGO que o
    // escolhido — e em silêncio, que é o pior jeito de errar público.
    comportamentos: (p.comportamentos || []).filter((b) => b && b.id).map((b) => ({ id: String(b.id), name: b.name })),
    custom_audiences: (p.incluir || []).filter((a) => a && a.id).map((a) => ({ id: String(a.id) })),
  };
}
