// AS ONZE ABAS DA PLANILHA DA VESSEL: quais colunas, de que tipo, em que ordem.
//
// ⚠️ ELE RODA NOS DOIS LUGARES, e é de propósito. A edge (Deno) é quem escreve a
// planilha de verdade, a cada 3 minutos e a cada cadastro novo; o node roda o
// mesmo código no ensaio (`coletor/espelhar-vessel-no-zoho.mjs`) e nos testes.
// Se as abas morassem só dentro da edge, nenhum teste as alcançaria — a edge
// importa de URL e não carrega em `node --test`. Foi por isso que a planilha das
// garantias já morava em `_shared` desde 06/09/2026.
//
// ⚠️ NÃO TEM NENHUMA LEITURA DE BANCO AQUI DENTRO. Ele recebe os dados prontos e
// devolve as abas. É o que deixa os testes provarem coluna por coluna com linha
// inventada, sem tocar em dado real — inclusive nas cinco abas que hoje estão
// vazias no banco (pessoas, atendimentos, origens, stylists, private edits) e
// que, sem isso, ninguém veria quebrar.
//
// ⚠️ O FUSO NÃO SE RESOLVE AQUI. Cada coluna declara o seu tipo
// (`instante`, `dia`, `dia-de-instante`) e quem converte é `planilha-xlsx.js`,
// num lugar só. Ver o cabeçalho de lá para o defeito que isso consertou.
import { COLUNAS as COLUNAS_DE_GARANTIAS, linhasDeGarantias, pecaParaLote }
  from './planilha-de-garantias.js';
import { diaEmSaoPaulo } from './hora-de-sao-paulo.js';

// ── o que ler do banco ───────────────────────────────────────────────────────
// ⚠️ A LISTA DE COLUNAS MORA AQUI, e não em cada chamador: a edge usa o cliente
// do Supabase e o ensaio usa REST na mão, e duas listas separadas divergiriam
// em silêncio — uma aba montaria com coluna que o outro não pediu.
//
// ⚠️ E NÃO TEM `order` NENHUM AQUI. Quem ordena é a ABA, logo abaixo. Se a ordem
// viesse da consulta, os dois escritores (a edge e o ensaio) produziriam
// arquivos com as linhas em ordens diferentes para o MESMO dado — e a comparação
// byte a byte acharia que a planilha mudou, subindo versão nova sem motivo.
export const CONSULTAS = {
  // ⚠️ AS COLUNAS PELO NOME, E NÃO `*`: a tabela guarda `senha_hash` e `ip_hash`,
  // e nada que não entra na planilha precisa sair do banco.
  listaDeEspera: { tabela: 'vessel_lista_espera',
    colunas: 'id,nome,email,whatsapp,origem,criado_em,aceite_em,aceite_versao,bling_id,'
      + 'objetivo,visita_data,visita_hora,visita_bolsa,visita_ocasiao,visita_atelier,'
      + 'visita_acompanhantes,visita_pedido' },
  pedidos: { tabela: 'vessel_pedidos', colunas: '*' },
  pessoas: { tabela: 'vessel_pessoas',
    // ⚠️ `teste` entra (24/09/2026) só para a aba Beauty Sessions não contar a
    // ficha de teste em "Interessadas" — a mesma regra da Central.
    colunas: 'id,nome,telefone,email,cidade,instagram,consultora,bling_contato_id,criado_em,teste' },
  atendimentos: { tabela: 'vessel_atendimentos', colunas: '*' },
  origens: { tabela: 'vessel_origens', colunas: '*' },
  conviteAberturas: { tabela: 'vessel_convite_aberturas',
    colunas: 'momento,convite_codigo,praca,client_advisor,via' },
  stylists: { tabela: 'vessel_stylists', colunas: '*' },
  // ⚠️ 24/09/2026: o funil é configurável — a etapa é uma linha desta tabela,
  // e a aba mostra o NOME dela (a coluna `estagio` saiu do banco).
  stylistEtapas: { tabela: 'vessel_stylist_etapas', colunas: 'id,nome' },
  stylistAberturas: { tabela: 'vessel_stylist_aberturas', colunas: 'codigo' },
  privateEdits: { tabela: 'vessel_private_edits', colunas: '*' },
  beautySessions: { tabela: 'vessel_beauty_sessions', colunas: '*' },
  registros: { tabela: 'vessel_registros', colunas: '*' },
  pedidosDeRegistro: { tabela: 'vessel_pedidos_de_registro', colunas: '*' },
  pecas: { tabela: 'vessel_pecas', colunas: 'codigo,lote_id' },
  lotes: { tabela: 'vessel_lotes', colunas: 'id,modelo,cor' },
  lojasDoBling: { tabela: 'bling_lojas', colunas: 'loja_id,nome' },
  // Quem vendeu e o que saiu: os dois já estavam no banco e fora da planilha.
  // 452 dos 464 pedidos têm vendedor; são 1.138 itens em 464 pedidos.
  vendedores: { tabela: 'vessel_vendedores_bling', colunas: 'bling_vendedor_id,nome' },
  itensVendidos: { tabela: 'vessel_pedido_itens',
    colunas: 'pedido_id,sku,descricao,quantidade,total_do_item' },
};

// ── os rótulos em português ──────────────────────────────────────────────────
// ⚠️ O NOME EM PORTUGUÊS, e o código cru quando não conheço. Planilha é para
// pessoa ler: `lp-private-appointment` numa célula não diz nada a quem abre, e
// traduzir tudo menos o que eu não conheço esconderia canal novo.
const CANAL = {
  meta: 'Anúncio (Meta)',
  beauty_session: 'Beauty Session',
  stylist: 'Stylist',
  private_edit: 'Private Edit',
  instagram: 'Instagram',
  'lp-private-appointment': 'Site · Private Appointment',
  'lp-personal-atelier': 'Site · Personal Atelier',
  'lp-stylist-circle': 'Site · Stylist Circle',
  'private-edit': 'Private Edit',
  appointment_card: 'Cartão da loja',
  // ⚠️ AS DUAS PORTAS DA BEAUTY SESSION (`vessel_atendimentos.origem_registro`):
  // a página do QR e o cadastro feito pela equipe dentro da sessão (24/09/2026).
  'beauty-session': 'Beauty Session · QR',
  'beauty-session-equipe': 'Beauty Session · pela equipe',
};
const canal = (c) => CANAL[c] || c || '';

const LOJA = { iguatemi: 'Iguatemi Campinas', tivoli: 'Tivoli', parkshopping: 'ParkShopping' };
const STATUS = {
  solicitado: 'Pediu horário', confirmado: 'Confirmado', realizado: 'Veio',
  remarcado: 'Remarcou', cancelado: 'Cancelou', no_show: 'Não veio',
};
const ATUACAO = {
  stylist: 'Stylist', 'personal-shopper': 'Personal shopper',
  consultoria: 'Consultoria de imagem', outra: 'Outra',
};

// O TEXTO É PARA GENTE LER, não o valor cru do banco. `null` é "ainda não chegou
// na segunda pergunta" — a LP cadastra primeiro e pergunta depois.
const objetivoLegivel = (v) => (v === 'visita' ? 'quer visitar a loja'
  : v === 'ecommerce' ? 'quer comprar pelo site' : 'ainda não escolheu');

// ⚠️ Chave desconhecida sai como veio, em vez de virar vazio: uma escolha nova
// no formulário apareceria na planilha em vez de sumir dela.
const PECA = {
  'hand-bag': 'Hand Bag', 'shoulder-bag': 'Shoulder Bag',
  'east-west': 'East West', 'toda-colecao': 'quer ver a coleção inteira',
};
const OCASIAO = {
  'dia-a-dia': 'dia a dia', trabalho: 'trabalho', viagem: 'viagem',
  noite: 'noite e eventos', presente: 'presente',
};
const legivel = (mapa, v) => (v ? (mapa[v] ?? v) : '');

// ⚠️ `0` É RESPOSTA ("venho sozinha"), `null` é "não respondeu". Um `||` aqui
// transformaria a primeira na segunda, e a Client Advisor prepararia a sala sem
// saber se alguém vem junto.
const acompanhantes = (v) => (v === null || v === undefined ? ''
  : v === 0 ? 'vem sozinha' : String(v));

const simNao = (v) => (v === true ? 'sim' : v === false ? 'não' : '');

// Quem não comprou sai com "ainda não" e o resto VAZIO — zero pedidos e R$ 0
// numa linha de quem nunca comprou somam certo, mas parecem compra de zero.
const compraDoLead = (c) => (c
  ? ['sim', c.primeira, c.pedidos, c.valor]
  : ['ainda não', null, null, null]);

// ⚠️ A JANELA DA VENDA É UMA ESCOLHA, E ELA APARECE NO NOME DA COLUNA. Do dia da
// visita até 7 dias depois — a mesma régua da Central. Não existe no dado nenhum
// campo dizendo "esta compra veio daquela visita"; o que existe é a mesma
// cliente comprando perto da data. Chamar isso de conversão sem dizer a régua é
// inventar precisão.
const DIAS_DA_VENDA = 7;
const soDia = (v) => (v ? String(v).slice(0, 10) : '');
function comprasPerto(pedidos, pessoaId, quando) {
  // ⚠️ O dia da visita sai do fuso do Brasil, e não do UTC: visita das 22h
  // cairia no dia seguinte e a janela de 7 dias começaria errada.
  const d = diaEmSaoPaulo(quando);
  if (!d || !pessoaId) return [];
  const [a, m, x] = d.split('-').map(Number);
  const limite = new Date(Date.UTC(a, m - 1, x + DIAS_DA_VENDA)).toISOString().slice(0, 10);
  return pedidos.filter((p) => ehVenda(p) && String(p.pessoa_id) === String(pessoaId)
    && soDia(p.data_do_pedido) >= d && soDia(p.data_do_pedido) <= limite);
}

const naoEhTeste = (l) => !l.teste;

// ⚠️ SÓ A SITUAÇÃO 9 É VENDA. O Bling tem vários estados; 12 é cancelado, e
// `null` quer dizer que o pedido sumiu de lá. Até 21/09/2026 a planilha contava
// os três como venda, porque o robô nunca voltava para conferir — medido, eram
// 2 pedidos cancelados valendo R$ 3.850 no espelho. A Gestão à Vista sempre
// filtrou assim (ela lê o Bling ao vivo); agora a planilha diz o mesmo número.
const ATENDIDO = 9;
const ehVenda = (p) => Number(p?.situacao_id) === ATENDIDO;

// ⚠️ A ORDEM DAS LINHAS É DA ABA, NÃO DA CONSULTA (leia o aviso em CONSULTAS).
// Texto em ordem alfabética resolve datas do Postgres porque elas vêm sempre no
// mesmo formato, do mais significativo para o menos ('2026-09-21T02:11' >
// '2026-09-20T23:11'). `localeCompare` para não depender de `<` em tipos mistos.
const maisNovoPrimeiro = (campo) => (a, b) =>
  String(b[campo] ?? '').localeCompare(String(a[campo] ?? ''));
const maisVelhoPrimeiro = (campo) => (a, b) =>
  String(a[campo] ?? '').localeCompare(String(b[campo] ?? ''));

// ── OS NOMES DAS ABAS: corrigidos pelo dono em 21/09/2026 ───────────────────
//
// Cinco nomes mudaram, e o motivo foi confusão de verdade na mão dele: três
// pares diziam quase a mesma coisa. "Pessoas" e "Lista de espera" eram as duas
// "gente"; "Atribuição" e "Origens" eram as duas "de onde veio"; "Atendimentos"
// soava igual a "Convites abertos".
//
//   Lista de espera  →  Landing page                 (quem chegou pelo site)
//   Pessoas          →  Clientes
//   Atendimentos     →  Visitas às lojas
//   Origens          →  Histórico de origem
//
// E em 21/09, à noite, a "Atribuição" (que tinha virado "De onde veio e no que
// deu") FOI ABSORVIDA por "Visitas às lojas": as duas eram uma linha por visita,
// da mesma tabela. Onze abas, e não mais doze.
//
// ⚠️ AS TABELAS NÃO FORAM RENOMEADAS, e isso não é descuido. `vessel_lista_espera`
// continua com esse nome porque renomear tabela em produção arrasta migration,
// RLS, gatilho e o vigia; renomear o rótulo custa uma linha. A tabela nasceu
// servindo só a lista de espera e hoje recebe quem chega por QUALQUER página de
// captação — a LP comum e a pré-venda, que se distinguem na coluna
// "Como chegou". É por isso que o rótulo certo é "Landing page".
//
// ⚠️ E EM 23/09/2026 VIROU "Leads (landing page)", a pedido do dono: quem se
// cadastrou ainda NÃO É CLIENTE, e a planilha passou a dizer se comprou.
//
// ⚠️ NOME DE ABA TEM TETO DE 31 LETRAS (regra do Excel, não nossa). O maior
// daqui, "De onde veio e no que deu", tem 25. `nomeDeAba` corta o que passar e
// numera repetido, então um nome longo demais não quebra o arquivo — ele
// aparece cortado, que é pior de notar. Contar antes de batizar.

// ── A ABA DE INSTRUÇÕES ──────────────────────────────────────────────────────
//
// Pedido do dono em 21/09/2026: uma aba explicando a planilha, em primeiro lugar.
//
// ⚠️ TÍTULO DE BLOCO É `{ texto, secao: true }`, e não MAIÚSCULA com risquinho.
// A primeira versão separava os blocos com uma linha de traços porque não havia
// estilo nenhum — ficou com cara de arquivo de texto dentro de uma planilha. Com
// o negrito de verdade, o risco sai e a linha em branco basta.
//
// ⚠️ UMA COLUNA SÓ, E LINHAS CURTAS. O Excel NÃO estica a altura da linha quando
// o texto quebra: ele usa a altura padrão e o resto some, sem aviso. Quem
// escrever linha nova aqui: até ~100 letras, que é o que cabe na largura desta
// coluna. Há teste medindo cada uma.
//
// ⚠️ `zebra: false` e `filtro: false`: listra e seta de filtro em texto corrido
// fazem a pessoa procurar a coluna e a tabela que não existem.
const bloco = (texto) => ({ texto, secao: true });

const INSTRUCOES = [
  bloco('O QUE É ISTO'),
  'Esta planilha é uma fotografia da base da VESSEL BRASIL, tirada do sistema.',
  'Ela se atualiza sozinha: no segundo em que alguém se cadastra no site, e de 3 em 3 minutos.',
  'É o único arquivo desta pasta. Os onze CSV antigos foram para a lixeira do Zoho em 21/09/2026.',
  '',
  bloco('ESCREVER AQUI NÃO MUDA NADA NO SISTEMA'),
  'Se você digitar, corrigir ou apagar algo nesta planilha, isso some na atualização seguinte.',
  'O robô regrava o arquivo inteiro a cada rodada.',
  'Para corrigir um dado de verdade, corrija na Central ou no formulário do site.',
  '',
  bloco('SE ALGUÉM PEDIR PARA SAIR DA BASE'),
  'Apague a pessoa no sistema. Ela desaparece desta planilha na rodada seguinte, sozinha.',
  'Não precisa mexer no arquivo. É assim que a Política de Privacidade do site vira verdade.',
  '',
  bloco('A HORA É A DE BRASÍLIA'),
  'Todas as datas e horas desta planilha estão no horário de Brasília.',
  'Elas são data de verdade, e não texto: dá para ordenar, filtrar e contar por período.',
  'As colunas de dinheiro também somam.',
  '',
  bloco('O QUE TEM EM CADA ABA'),
  'Leads (landing page) — quem se cadastrou pelo site, o que pediu, e se já comprou',
  'Clientes — as pessoas da base, com cidade e Client Advisor',
  'Visitas às lojas — a visita inteira: quem veio, por onde chegou e o que comprou depois',
  'Vendas — os pedidos: quem vendeu, o que saiu, e o valor que entrou de verdade',
  'Garantias — o selo registrado e a fila de conferência',
  'Histórico de origem — todo registro de origem, para provar por onde ela chegou',
  'Convites abertos — quem abriu convite, pelo QR do cartão ou pelo link',
  'Stylists — cada stylist, com o link dela e quantas clientes trouxe',
  'Private Edits — cada encontro, com o link do convite e quem compareceu',
  'Beauty Sessions — cada sessão, o QR, o salão e as interessadas pelo QR e pela equipe',
  '',
  bloco('PEDIDO CANCELADO SOME DAQUI SOZINHO'),
  'A aba Vendas mostra só pedido com situação "atendido" no Bling.',
  'Quando a loja cancela ou refaz um pedido, o robô percebe e ele sai da planilha.',
  'É o mesmo critério da Gestão à Vista, então os dois números batem.',
  '',
  bloco('ABA VAZIA NÃO É DEFEITO'),
  'Aba sem nenhuma linha quer dizer que esse dado ainda não existe no sistema.',
  '',
  bloco('SE A PLANILHA PARAR DE ATUALIZAR'),
  'Abra a Central, vá em Status e procure "vessel-espelhar-lista".',
  'Se ele estiver ATRASADO, o painel diz qual parte parou: a planilha ou o Bling.',
];

// ⚠️ A ORDEM DESTE ARRAY É A ORDEM DAS ABAS NO ARQUIVO, e ela foi escolhida pelo
// dono: a explicação primeiro, depois as pessoas, depois o que elas fizeram,
// depois a análise, e por último os programas da marca. Mexer aqui muda o que
// ele vê ao abrir.

// ── as doze abas ─────────────────────────────────────────────────────────────
// A ordem é a ordem das abas no arquivo, e ela segue o que o dono abre primeiro.
export function montarAbas(d) {
  const pessoaPorId = new Map(d.pessoas.map((p) => [p.id, p]));
  const nomeDaPessoa = (id) => pessoaPorId.get(id)?.nome || '';
  const zapDaPessoa = (id) => pessoaPorId.get(id)?.telefone || '';
  const nomeDaLoja = new Map(d.lojasDoBling.map((l) => [String(l.loja_id), l.nome]));
  const nomeDaStylist = new Map(d.stylists.map((s) => [s.codigo, s.nome]));
  const nomeDaEtapa = new Map((d.stylistEtapas || []).map((e) => [e.id, e.nome]));
  const nomeDoVendedor = new Map(
    (d.vendedores ?? []).map((v) => [String(v.bling_vendedor_id), v.nome]));

  // As peças de cada pedido, resumidas numa célula. ⚠️ `pedido_id` aponta para
  // `vessel_pedidos.id` (a chave da NOSSA tabela), e não para o id do Bling —
  // conferido no banco antes de escrever, porque trocar os dois devolveria
  // peças de outro pedido sem erro nenhum.
  // As compras de cada lead: só pedido atendido, somado por `lead_id`.
  const comprasPorLead = new Map();
  for (const p of (d.pedidos ?? []).filter(ehVenda)) {
    if (p.lead_id == null) continue;
    const c = comprasPorLead.get(String(p.lead_id)) ?? { primeira: null, pedidos: 0, valor: 0 };
    c.pedidos++;
    c.valor = Math.round((c.valor + (Number(p.receita_liquida) || 0)) * 100) / 100;
    if (!c.primeira || String(p.data_da_venda) < c.primeira) c.primeira = String(p.data_da_venda);
    comprasPorLead.set(String(p.lead_id), c);
  }

  const pecasDoPedido = new Map();
  for (const i of (d.itensVendidos ?? [])) {
    const lista = pecasDoPedido.get(String(i.pedido_id)) ?? [];
    const quantos = Math.round(Number(i.quantidade) || 1);
    lista.push(`${i.descricao || i.sku}${quantos > 1 ? ` (${quantos}x)` : ''}`);
    pecasDoPedido.set(String(i.pedido_id), lista);
  }

  // ⚠️ A PRIMEIRA linha de origem de cada pessoa, nunca a última: é o first
  // touch, e o plano proíbe sobrescrevê-lo.
  const primeiraOrigem = new Map();
  for (const o of [...d.origens].sort((a, b) => a.id - b.id)) {
    if (!primeiraOrigem.has(o.pessoa_id)) primeiraOrigem.set(o.pessoa_id, o);
  }

  const abriuOLink = new Map();
  for (const a of d.stylistAberturas) abriuOLink.set(a.codigo, (abriuOLink.get(a.codigo) || 0) + 1);

  const trouxeClientes = new Map();
  for (const o of d.origens) {
    if (!o.stylist_id) continue;
    const s = trouxeClientes.get(o.stylist_id) || new Set();
    s.add(o.pessoa_id); trouxeClientes.set(o.stylist_id, s);
  }

  // ⚠️ A PORTA DE CADA INTERESSADA É A DA PRIMEIRA ORIGEM DELA NAQUELE EVENTO:
  // `utm_medium = 'offline_equipe'` é o cadastro feito pela equipe dentro da
  // sessão; qualquer outra é o QR. A Central decide pela linha de
  // `vessel_beauty_session_cadastros` e dá o mesmo número: a equipe só consegue
  // cadastrar quem AINDA NÃO se identificou na sessão, então a primeira origem
  // de quem ela cadastrou é sempre a dela. Esta aba não lê aquela tabela de
  // propósito — assim a planilha não quebra se a edge for publicada antes da
  // migration.
  // ⚠️ E A FICHA DE TESTE NÃO CONTA, como na Central desde 24/09/2026.
  const ehFichaDeTeste = (id) => pessoaPorId.get(id)?.teste === true;
  const portaNoEvento = new Map();   // evento -> Map(pessoa -> 'qr' | 'equipe')
  for (const o of [...d.origens].sort((a, b) => a.id - b.id)) {
    if (!o.evento_id || ehFichaDeTeste(o.pessoa_id)) continue;
    const m = portaNoEvento.get(o.evento_id) || new Map();
    if (!m.has(o.pessoa_id)) m.set(o.pessoa_id, o.utm_medium === 'offline_equipe' ? 'equipe' : 'qr');
    portaNoEvento.set(o.evento_id, m);
  }
  const interessadas = (evento, porta) => [...(portaNoEvento.get(evento)?.values() ?? [])]
    .filter((p) => !porta || p === porta).length;

  return [
    {
      nome: 'Instruções',
      // `documentacao` não vai para o arquivo: é para o robô não contar esta aba
      // na linha de resultado dele ("Instruções: 38 linhas" não diz nada).
      documentacao: true,
      filtro: false,
      zebra: false,
      colunas: [{ titulo: 'COMO USAR ESTA PLANILHA', largura: 104 }],
      linhas: INSTRUCOES.map((l) => [l]),
    },
    {
      nome: 'Leads (landing page)',
      colunas: [
        { titulo: 'Nome', largura: 28 },
        { titulo: 'E-mail', largura: 30 },
        { titulo: 'WhatsApp', largura: 18 },
        { titulo: 'Entrou em', tipo: 'instante', largura: 18 },
        { titulo: 'Como chegou', largura: 22 },
        { titulo: 'O que ela quer', largura: 22 },
        { titulo: 'Dia da visita', tipo: 'dia', largura: 14 },
        { titulo: 'Hora da visita', largura: 14 },
        { titulo: 'Peça', largura: 22 },
        { titulo: 'Ocasião', largura: 16 },
        { titulo: 'Personal Atelier', largura: 15 },
        { titulo: 'Acompanhantes', largura: 15 },
        { titulo: 'Pedido especial', largura: 40 },
        { titulo: 'Aceitou os termos em', tipo: 'instante', largura: 18 },
        { titulo: 'Versão do termo', largura: 15 },
        { titulo: 'Já está no Bling?', largura: 15 },
        // ⚠️ LEAD NÃO É CLIENTE (23/09/2026). O `lead_id` é gravado no pedido
        // por coletor/trazer-pedidos-do-bling.mjs (ficha → e-mail → telefone,
        // só do dia do cadastro em diante). Cancelado não conta: `ehVenda`,
        // o mesmo critério da aba Vendas.
        { titulo: 'Comprou?', largura: 11 },
        { titulo: '1ª compra em', tipo: 'dia', largura: 13 },
        { titulo: 'Pedidos', tipo: 'numero', largura: 9 },
        { titulo: 'Valor comprado', tipo: 'dinheiro', largura: 15 },
      ],
      linhas: [...d.listaDeEspera].sort(maisNovoPrimeiro('criado_em')).map((l) => [
        l.nome, l.email, l.whatsapp, l.criado_em, l.origem,
        objetivoLegivel(l.objetivo), l.visita_data, l.visita_hora,
        legivel(PECA, l.visita_bolsa), legivel(OCASIAO, l.visita_ocasiao),
        simNao(l.visita_atelier), acompanhantes(l.visita_acompanhantes),
        l.visita_pedido, l.aceite_em, l.aceite_versao,
        l.bling_id ? 'sim' : 'ainda não',
        ...compraDoLead(comprasPorLead.get(String(l.id))),
      ]),
    },
    {
      nome: 'Clientes',
      // ⚠️ SEM o hash de origem e SEM a data de atualização: planilha é para
      // pessoa ler, e coluna que ninguém usa só atrapalha a leitura.
      colunas: [
        { titulo: 'Nome', largura: 28 },
        { titulo: 'WhatsApp', largura: 18 },
        { titulo: 'E-mail', largura: 30 },
        { titulo: 'Cidade', largura: 20 },
        // ⚠️ MESMA POSIÇÃO DA ABA "Stylists" (depois da cidade), de propósito:
        // quem lê as duas abas não precisa procurar a coluna em lugar diferente.
        { titulo: 'Instagram', largura: 20 },
        { titulo: 'Client Advisor', largura: 20 },
        { titulo: 'Ficha no Bling', largura: 14 },
        { titulo: 'Entrou em', tipo: 'dia-de-instante', largura: 14 },
      ],
      linhas: [...d.pessoas].sort(maisNovoPrimeiro('criado_em')).map((p) => [p.nome, p.telefone, p.email, p.cidade, p.instagram, p.consultora,
          p.bling_contato_id, p.criado_em]),
    },
    {
      // ⚠️ ESTA ABA ENGOLIU A "De onde veio e no que deu" em 21/09/2026, e o
      // motivo é que as duas eram A MESMA COISA: uma linha por visita agendada,
      // da mesma tabela, com o mesmo grão. Uma mostrava loja/situação/Client
      // Advisor e a outra mostrava origem/campanha/compra — uma tabela partida
      // ao meio, que o dono leu como redundância. A segunda nasceu no Growth
      // Plan como "a versão em planilha do painel de atribuição"; agora é a
      // mesma aba, inteira.
      //
      // ⚠️ AS LINHAS DE TESTE SAEM. A aba antiga de visitas NÃO filtrava
      // `teste` e a de atribuição filtrava — juntar sem decidir deixaria o
      // número de visitas diferente do que o painel mostra. Fica o filtro.
      nome: 'Visitas às lojas',
      colunas: [
        { titulo: 'Cliente', largura: 28 },
        { titulo: 'WhatsApp', largura: 18 },
        { titulo: 'Loja', largura: 20 },
        { titulo: 'Quando', tipo: 'instante', largura: 18 },
        { titulo: 'Situação', largura: 16 },
        { titulo: 'Veio?', largura: 8 },
        { titulo: 'Veio em', tipo: 'dia-de-instante', largura: 13 },
        { titulo: 'Client Advisor', largura: 20 },
        { titulo: 'Chegou por (1ª vez)', largura: 26 },
        { titulo: 'Campanha', largura: 22 },
        { titulo: 'Stylist', largura: 22 },
        { titulo: 'Encontro', largura: 14 },
        { titulo: 'Convite', largura: 14 },
        { titulo: 'Este atendimento veio de', largura: 26 },
        { titulo: 'Comprou até 7 dias depois', largura: 24 },
        { titulo: 'Valor que entrou (7 dias)', tipo: 'dinheiro', largura: 20 },
        { titulo: 'Pedido em', tipo: 'dia-de-instante', largura: 13 },
      ],
      linhas: [...d.atendimentos].sort(maisNovoPrimeiro('criado_em'))
        .filter(naoEhTeste).map((a) => {
          const o = primeiraOrigem.get(a.pessoa_id) || {};
          const compras = comprasPerto(d.pedidos, a.pessoa_id, a.quando || a.criado_em);
          return [
            nomeDaPessoa(a.pessoa_id), zapDaPessoa(a.pessoa_id),
            LOJA[a.loja] || a.loja, a.quando, STATUS[a.status] || a.status,
            a.status === 'realizado' ? 'sim' : a.status === 'no_show' ? 'não' : '',
            a.presenca_em, a.client_advisor,
            canal(o.canal), o.utm_campaign || '',
            o.stylist_id ? `${nomeDaStylist.get(o.stylist_id) || ''} (${o.stylist_id})`.trim() : '',
            a.evento_codigo || o.evento_id || '',
            a.convite_codigo,
            canal(a.origem_registro),
            compras.map((c) => c.numero).join(' · '),
            compras.length
              ? compras.reduce((t, c) => t + Number(c.receita_liquida ?? c.total_corrigido ?? 0), 0)
              : '',
            a.criado_em,
          ];
        }),
    },
    {
      nome: 'Vendas',
      colunas: [
        { titulo: 'Data da venda', tipo: 'dia', largura: 14 },
        { titulo: 'Pedido', largura: 10 },
        { titulo: 'Loja', largura: 24 },
        { titulo: 'Quem vendeu', largura: 26 },
        { titulo: 'Cliente (no Bling)', largura: 28 },
        { titulo: 'Conhecemos?', largura: 22 },
        { titulo: 'Como casou', largura: 15 },
        { titulo: 'O que saiu', largura: 44 },
        { titulo: 'Peças', tipo: 'numero', largura: 8 },
        // ⚠️ AS TRÊS COLUNAS DE DINHEIRO SEMPRE FECHAM: tabela − desconto = entrou.
        // Isso é uma escolha, e ela veio de medir. O desconto da Vessel mora em
        // DOIS lugares no Bling: um no pedido e outro em cada peça — 119 dos 464
        // pedidos (26%) têm o do item. Mostrar os dois separados parecia mais
        // completo e era pior: em 2 pedidos antigos os números do próprio Bling
        // se contradizem (o 2116 tem total 194,95 e soma de peças 339,90), e a
        // coluna de desconto por peça sairia NEGATIVA. Uma coluna só, que é a
        // conta que a pessoa faz de cabeça, nunca se contradiz.
        //
        // ⚠️ "Preço de tabela" é `total_produtos` (a soma dos preços cheios), e
        // não o `total` do Bling, que já vem com o desconto do pedido aplicado e
        // sem o do item — era ele que estava nesta coluna até 21/09/2026.
        { titulo: 'Preço de tabela', tipo: 'dinheiro', largura: 16 },
        { titulo: 'Desconto', tipo: 'dinheiro', largura: 13 },
        { titulo: 'Desconto (%)', tipo: 'numero', largura: 13 },
        { titulo: 'Valor que entrou', tipo: 'dinheiro', largura: 17 },
        { titulo: 'Contado pelo dia de', largura: 17 },
      ],
      linhas: [...d.pedidos].filter(ehVenda)
        .sort(maisNovoPrimeiro('data_da_venda')).map((p) => {
        const pecas = pecasDoPedido.get(String(p.id)) ?? [];
        const tabela = Number(p.total_produtos) || 0;
        const entrou = Number(p.receita_liquida) || 0;
        const desconto = Math.round((tabela - entrou) * 100) / 100;
        return [
          p.data_da_venda, p.numero, nomeDaLoja.get(String(p.loja_id)) || '',
          // Vendedor que o Bling não conhece mais sai com o número, e não vazio:
          // vazio parece "venda sem vendedor", que é outra coisa.
          nomeDoVendedor.get(String(p.vendedor_id))
            || (p.vendedor_id ? `nº ${p.vendedor_id}` : ''),
          p.contato_nome,
          // ⚠️ "Órfã" não é defeito: é venda de quem nunca passou por um
          // formulário nosso. É o número que diz quanto do faturamento a
          // captação ainda não alcança.
          p.pessoa_id ? nomeDaPessoa(p.pessoa_id) || 'sim' : 'órfã',
          p.casou_por === 'bling_contato' ? 'ficha do Bling'
            : p.casou_por === 'telefone' ? 'telefone' : '',
          pecas.join(' · '), pecas.length,
          tabela, desconto,
          // Sem preço de tabela não há porcentagem a calcular — melhor vazio
          // que um zero que parece "vendeu sem desconto".
          tabela > 0 ? Math.round((desconto / tabela) * 1000) / 10 : '',
          p.receita_liquida,
          p.origem_da_data === 'nota' ? 'nota fiscal' : 'pedido',
        ];
      }),
    },
    {
      nome: 'Garantias',
      colunas: COLUNAS_DE_GARANTIAS,
      linhas: linhasDeGarantias(d.registros, d.pedidosDeRegistro,
        pecaParaLote(d.pecas, d.lotes)),
    },
    {
      // TODA linha de origem, na ordem em que chegou. A de atribuição mostra só
      // a primeira; esta mostra o histórico inteiro, que é o que prova o first
      // touch.
      nome: 'Histórico de origem',
      colunas: [
        { titulo: 'Quando', tipo: 'instante', largura: 18 },
        { titulo: 'Cliente', largura: 28 },
        { titulo: 'WhatsApp', largura: 18 },
        { titulo: 'É a 1ª origem dela?', largura: 16 },
        { titulo: 'Canal', largura: 24 },
        { titulo: 'Campanha', largura: 20 },
        { titulo: 'Evento', largura: 14 },
        { titulo: 'Stylist', largura: 22 },
        { titulo: 'utm_source', largura: 16 },
        { titulo: 'utm_medium', largura: 16 },
        { titulo: 'utm_campaign', largura: 20 },
        { titulo: 'utm_content', largura: 20 },
        { titulo: 'Veio de clique de anúncio?', largura: 20 },
      ],
      linhas: [...d.origens].sort((a, b) => b.id - a.id).map((o) => [
        o.momento, nomeDaPessoa(o.pessoa_id), zapDaPessoa(o.pessoa_id),
        primeiraOrigem.get(o.pessoa_id)?.id === o.id ? 'sim' : 'não',
        canal(o.canal), o.campanha_id || '', o.evento_id || '',
        o.stylist_id ? `${nomeDaStylist.get(o.stylist_id) || ''} (${o.stylist_id})`.trim() : '',
        o.utm_source || '', o.utm_medium || '', o.utm_campaign || '', o.utm_content || '',
        // ⚠️ SIM OU NÃO, NUNCA O IDENTIFICADOR. O `clique_meta` é um
        // identificador de publicidade ligado a uma pessoa: ele serve para o
        // retorno ao Meta e não tem uso nenhum numa planilha que circula.
        o.clique_meta ? 'sim' : 'não',
      ]),
    },
    {
      nome: 'Convites abertos',
      colunas: [
        { titulo: 'Quando', tipo: 'instante', largura: 18 },
        { titulo: 'Convite', largura: 14 },
        { titulo: 'Praça', largura: 20 },
        { titulo: 'Client Advisor', largura: 20 },
        { titulo: 'Abriu pelo', largura: 20 },
      ],
      linhas: [...d.conviteAberturas].sort(maisNovoPrimeiro('momento'))
        .map((c) => [c.momento, c.convite_codigo, c.praca, c.client_advisor,
          c.via === 'qr' ? 'QR do cartão' : 'Link da mensagem']),
    },
    {
      nome: 'Stylists',
      colunas: [
        { titulo: 'Código', largura: 12 },
        { titulo: 'Nome', largura: 28 },
        { titulo: 'WhatsApp', largura: 18 },
        { titulo: 'Cidade', largura: 20 },
        { titulo: 'Instagram', largura: 20 },
        { titulo: 'Atuação', largura: 22 },
        { titulo: 'Etapa', largura: 20 },
        { titulo: 'Praça do Preview', largura: 18 },
        { titulo: 'O link dela', largura: 40 },
        { titulo: 'Abriram o link', tipo: 'numero', largura: 14 },
        { titulo: 'Clientes que ela trouxe', tipo: 'numero', largura: 18 },
        { titulo: 'Entrou em', tipo: 'dia-de-instante', largura: 14 },
      ],
      linhas: [...d.stylists].sort(maisVelhoPrimeiro('codigo'))
        .filter(naoEhTeste).map((s) => [
        s.codigo, s.nome, s.whatsapp, s.cidade, s.instagram,
        ATUACAO[s.atuacao] || s.atuacao || '', nomeDaEtapa.get(s.etapa_id) || '', s.praca_preview,
        `https://vesselbrasil.com.br/s/${s.codigo}`,
        abriuOLink.get(s.codigo) || 0, trouxeClientes.get(s.codigo)?.size || 0,
        s.criado_em,
      ]),
    },
    {
      nome: 'Private Edits',
      colunas: [
        { titulo: 'Código', largura: 12 },
        { titulo: 'Quando', tipo: 'instante', largura: 18 },
        { titulo: 'Anfitriã', largura: 28 },
        { titulo: 'Local', largura: 28 },
        { titulo: 'Vagas', tipo: 'numero', largura: 8 },
        // ⚠️ O link vai inteiro: é assim que a Ionara manda o convite. A chave
        // não é senha — quem tem o link entra, e é para isso que ela existe.
        { titulo: 'O link do convite', largura: 44 },
        { titulo: 'Responderam', tipo: 'numero', largura: 12 },
        { titulo: 'Disseram sim', tipo: 'numero', largura: 12 },
        { titulo: 'Compareceram', tipo: 'numero', largura: 12 },
        { titulo: 'Ativa?', largura: 8 },
      ],
      linhas: [...d.privateEdits].sort(maisNovoPrimeiro('quando'))
        .filter(naoEhTeste).map((e) => {
        const anfitria = d.stylists.find((s) => s.id === e.stylist_id);
        const r = d.atendimentos.filter((a) => a.evento_codigo === e.codigo && !a.teste);
        return [
          e.codigo, e.quando, anfitria?.nome || '', e.local, e.vagas,
          `https://vesselbrasil.com.br/pe/${e.chave}`,
          r.length, r.filter((a) => a.rsvp === 'sim').length,
          r.filter((a) => a.status === 'realizado').length,
          e.ativa ? 'sim' : 'não',
        ];
      }),
    },
    {
      nome: 'Beauty Sessions',
      colunas: [
        { titulo: 'Código', largura: 12 },
        // `quando` aqui é coluna `date` no banco: dia puro, sem fuso nenhum.
        { titulo: 'Quando', tipo: 'dia', largura: 14 },
        { titulo: 'Praça', largura: 20 },
        { titulo: 'Loja', largura: 20 },
        { titulo: 'Salão parceiro', largura: 26 },
        { titulo: 'O endereço do QR', largura: 40 },
        { titulo: 'Interessadas', tipo: 'numero', largura: 12 },
        // ⚠️ AS DUAS PORTAS SOMAM "Interessadas", sempre.
        { titulo: 'Pelo QR', tipo: 'numero', largura: 10 },
        { titulo: 'Pela equipe', tipo: 'numero', largura: 12 },
        { titulo: 'Ativa?', largura: 8 },
      ],
      linhas: [...d.beautySessions].sort(maisVelhoPrimeiro('quando')).map((e) => [
          e.codigo, e.quando, e.praca, LOJA[e.loja] || e.loja,
          // ⚠️ VAZIO APARECE COMO AVISO, e não como célula em branco: sem o nome
          // do salão não dá para saber, depois, qual parceiro trouxe mais gente.
          e.parceiro || '⚠️ FALTA O NOME DO SALÃO',
          `https://vesselbrasil.com.br/bs/${e.codigo}`,
          interessadas(e.codigo), interessadas(e.codigo, 'qr'), interessadas(e.codigo, 'equipe'),
          e.ativa ? 'sim' : 'não',
        ]),
    },

  ];
}

