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
    colunas: 'nome,email,whatsapp,origem,criado_em,aceite_em,aceite_versao,bling_id,'
      + 'objetivo,visita_data,visita_hora,visita_bolsa,visita_ocasiao,visita_atelier,'
      + 'visita_acompanhantes,visita_pedido' },
  pedidos: { tabela: 'vessel_pedidos', colunas: '*' },
  pessoas: { tabela: 'vessel_pessoas',
    colunas: 'id,nome,telefone,email,cidade,consultora,bling_contato_id,criado_em' },
  atendimentos: { tabela: 'vessel_atendimentos', colunas: '*' },
  origens: { tabela: 'vessel_origens', colunas: '*' },
  conviteAberturas: { tabela: 'vessel_convite_aberturas',
    colunas: 'momento,convite_codigo,praca,client_advisor,via' },
  stylists: { tabela: 'vessel_stylists', colunas: '*' },
  stylistAberturas: { tabela: 'vessel_stylist_aberturas', colunas: 'codigo' },
  privateEdits: { tabela: 'vessel_private_edits', colunas: '*' },
  beautySessions: { tabela: 'vessel_beauty_sessions', colunas: '*' },
  registros: { tabela: 'vessel_registros', colunas: '*' },
  pedidosDeRegistro: { tabela: 'vessel_pedidos_de_registro', colunas: '*' },
  pecas: { tabela: 'vessel_pecas', colunas: 'codigo,lote_id' },
  lotes: { tabela: 'vessel_lotes', colunas: 'id,modelo,cor' },
  lojasDoBling: { tabela: 'bling_lojas', colunas: 'loja_id,nome' },
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
  return pedidos.filter((p) => String(p.pessoa_id) === String(pessoaId)
    && soDia(p.data_do_pedido) >= d && soDia(p.data_do_pedido) <= limite);
}

const naoEhTeste = (l) => !l.teste;

// ⚠️ A ORDEM DAS LINHAS É DA ABA, NÃO DA CONSULTA (leia o aviso em CONSULTAS).
// Texto em ordem alfabética resolve datas do Postgres porque elas vêm sempre no
// mesmo formato, do mais significativo para o menos ('2026-09-21T02:11' >
// '2026-09-20T23:11'). `localeCompare` para não depender de `<` em tipos mistos.
const maisNovoPrimeiro = (campo) => (a, b) =>
  String(b[campo] ?? '').localeCompare(String(a[campo] ?? ''));
const maisVelhoPrimeiro = (campo) => (a, b) =>
  String(a[campo] ?? '').localeCompare(String(b[campo] ?? ''));

// ── as onze abas ─────────────────────────────────────────────────────────────
// A ordem é a ordem das abas no arquivo, e ela segue o que o dono abre primeiro.
export function montarAbas(d) {
  const pessoaPorId = new Map(d.pessoas.map((p) => [p.id, p]));
  const nomeDaPessoa = (id) => pessoaPorId.get(id)?.nome || '';
  const zapDaPessoa = (id) => pessoaPorId.get(id)?.telefone || '';
  const nomeDaLoja = new Map(d.lojasDoBling.map((l) => [String(l.loja_id), l.nome]));
  const nomeDaStylist = new Map(d.stylists.map((s) => [s.codigo, s.nome]));

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

  const interessadasNoEvento = new Map();
  for (const o of d.origens) {
    if (!o.evento_id) continue;
    const s = interessadasNoEvento.get(o.evento_id) || new Set();
    s.add(o.pessoa_id); interessadasNoEvento.set(o.evento_id, s);
  }

  return [
    {
      nome: 'Lista de espera',
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
      ],
      linhas: [...d.listaDeEspera].sort(maisNovoPrimeiro('criado_em')).map((l) => [
        l.nome, l.email, l.whatsapp, l.criado_em, l.origem,
        objetivoLegivel(l.objetivo), l.visita_data, l.visita_hora,
        legivel(PECA, l.visita_bolsa), legivel(OCASIAO, l.visita_ocasiao),
        simNao(l.visita_atelier), acompanhantes(l.visita_acompanhantes),
        l.visita_pedido, l.aceite_em, l.aceite_versao,
        l.bling_id ? 'sim' : 'ainda não',
      ]),
    },
    {
      nome: 'Vendas',
      colunas: [
        { titulo: 'Data da venda', tipo: 'dia', largura: 14 },
        { titulo: 'Pedido', largura: 12 },
        { titulo: 'Loja', largura: 22 },
        { titulo: 'Cliente (no Bling)', largura: 28 },
        { titulo: 'Conhecemos?', largura: 22 },
        { titulo: 'Como casou', largura: 16 },
        // ⚠️ "Valor que entrou" e não "Valor": o `total` do Bling não desconta o
        // desconto do item e sai ~6% maior. Coluna com nome vago é como alguém
        // soma a errada sem perceber.
        { titulo: 'Valor que entrou', tipo: 'dinheiro', largura: 16 },
        { titulo: 'Preço de tabela', tipo: 'dinheiro', largura: 16 },
        { titulo: 'Contado pelo dia de', largura: 16 },
      ],
      linhas: [...d.pedidos].sort(maisNovoPrimeiro('data_da_venda')).map((p) => [
        p.data_da_venda, p.numero, nomeDaLoja.get(String(p.loja_id)) || '',
        p.contato_nome,
        // ⚠️ "Órfã" não é defeito: é venda de quem nunca passou por um
        // formulário nosso. É o número que diz quanto do faturamento a captação
        // ainda não alcança.
        p.pessoa_id ? nomeDaPessoa(p.pessoa_id) || 'sim' : 'órfã',
        p.casou_por === 'bling_contato' ? 'ficha do Bling'
          : p.casou_por === 'telefone' ? 'telefone' : '',
        p.receita_liquida, p.total_do_bling,
        p.origem_da_data === 'nota' ? 'nota fiscal' : 'pedido',
      ]),
    },
    {
      nome: 'Garantias',
      colunas: COLUNAS_DE_GARANTIAS,
      linhas: linhasDeGarantias(d.registros, d.pedidosDeRegistro,
        pecaParaLote(d.pecas, d.lotes)),
    },
    {
      // A ABA QUE RESPONDE "DE ONDE VEIO E DEU EM QUÊ" — uma linha por
      // atendimento, com a etiqueta de origem e o que aconteceu depois. É a
      // versão em planilha do painel de atribuição.
      nome: 'Atribuição',
      colunas: [
        { titulo: 'Cliente', largura: 28 },
        { titulo: 'WhatsApp', largura: 18 },
        { titulo: 'Loja', largura: 20 },
        { titulo: 'Quando', tipo: 'instante', largura: 18 },
        { titulo: 'Situação', largura: 16 },
        { titulo: 'Veio?', largura: 8 },
        { titulo: 'Chegou por (1ª vez)', largura: 26 },
        { titulo: 'Campanha', largura: 22 },
        { titulo: 'Stylist', largura: 22 },
        { titulo: 'Encontro', largura: 14 },
        { titulo: 'Este atendimento veio de', largura: 26 },
        { titulo: 'Comprou até 7 dias depois', largura: 24 },
        { titulo: 'Valor que entrou (7 dias)', tipo: 'dinheiro', largura: 20 },
        { titulo: 'Pedido em', tipo: 'dia-de-instante', largura: 14 },
      ],
      linhas: [...d.atendimentos].sort(maisNovoPrimeiro('criado_em'))
        .filter(naoEhTeste).map((a) => {
        const o = primeiraOrigem.get(a.pessoa_id) || {};
        const compras = comprasPerto(d.pedidos, a.pessoa_id, a.quando || a.criado_em);
        return [
          nomeDaPessoa(a.pessoa_id), zapDaPessoa(a.pessoa_id),
          LOJA[a.loja] || a.loja, a.quando, STATUS[a.status] || a.status,
          a.status === 'realizado' ? 'sim' : a.status === 'no_show' ? 'não' : '',
          canal(o.canal), o.utm_campaign || '',
          o.stylist_id ? `${nomeDaStylist.get(o.stylist_id) || ''} (${o.stylist_id})`.trim() : '',
          a.evento_codigo || o.evento_id || '',
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
      // TODA linha de origem, na ordem em que chegou. A de atribuição mostra só
      // a primeira; esta mostra o histórico inteiro, que é o que prova o first
      // touch.
      nome: 'Origens',
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
      nome: 'Pessoas',
      // ⚠️ SEM o hash de origem e SEM a data de atualização: planilha é para
      // pessoa ler, e coluna que ninguém usa só atrapalha a leitura.
      colunas: [
        { titulo: 'Nome', largura: 28 },
        { titulo: 'WhatsApp', largura: 18 },
        { titulo: 'E-mail', largura: 30 },
        { titulo: 'Cidade', largura: 20 },
        { titulo: 'Client Advisor', largura: 20 },
        { titulo: 'Ficha no Bling', largura: 14 },
        { titulo: 'Entrou em', tipo: 'dia-de-instante', largura: 14 },
      ],
      linhas: [...d.pessoas].sort(maisNovoPrimeiro('criado_em')).map((p) => [p.nome, p.telefone, p.email, p.cidade, p.consultora,
          p.bling_contato_id, p.criado_em]),
    },
    {
      nome: 'Atendimentos',
      colunas: [
        { titulo: 'Cliente', largura: 28 },
        { titulo: 'WhatsApp', largura: 18 },
        { titulo: 'Loja', largura: 20 },
        { titulo: 'Quando', tipo: 'instante', largura: 18 },
        { titulo: 'Client Advisor', largura: 20 },
        { titulo: 'Situação', largura: 16 },
        { titulo: 'Veio em', tipo: 'dia-de-instante', largura: 14 },
        { titulo: 'Convite', largura: 14 },
        { titulo: 'Veio de', largura: 12 },
        { titulo: 'Pedido em', tipo: 'dia-de-instante', largura: 14 },
      ],
      linhas: [...d.atendimentos].sort(maisNovoPrimeiro('criado_em')).map((a) => [
        nomeDaPessoa(a.pessoa_id), zapDaPessoa(a.pessoa_id),
        LOJA[a.loja] || a.loja, a.quando, a.client_advisor,
        STATUS[a.status] || a.status, a.presenca_em, a.convite_codigo,
        a.origem_registro === 'appointment_card' ? 'Cartão' : 'Site',
        a.criado_em,
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
        { titulo: 'Estágio', largura: 16 },
        { titulo: 'Praça do Preview', largura: 18 },
        { titulo: 'O link dela', largura: 40 },
        { titulo: 'Abriram o link', tipo: 'numero', largura: 14 },
        { titulo: 'Clientes que ela trouxe', tipo: 'numero', largura: 18 },
        { titulo: 'Entrou em', tipo: 'dia-de-instante', largura: 14 },
      ],
      linhas: [...d.stylists].sort(maisVelhoPrimeiro('codigo'))
        .filter(naoEhTeste).map((s) => [
        s.codigo, s.nome, s.whatsapp, s.cidade, s.instagram,
        ATUACAO[s.atuacao] || s.atuacao || '', s.estagio, s.praca_preview,
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
        { titulo: 'Ativa?', largura: 8 },
      ],
      linhas: [...d.beautySessions].sort(maisVelhoPrimeiro('quando')).map((e) => [
          e.codigo, e.quando, e.praca, LOJA[e.loja] || e.loja,
          // ⚠️ VAZIO APARECE COMO AVISO, e não como célula em branco: sem o nome
          // do salão não dá para saber, depois, qual parceiro trouxe mais gente.
          e.parceiro || '⚠️ FALTA O NOME DO SALÃO',
          `https://vesselbrasil.com.br/bs/${e.codigo}`,
          interessadasNoEvento.get(e.codigo)?.size || 0,
          e.ativa ? 'sim' : 'não',
        ]),
    },
  ];
}

