// OS ESPELHOS DAS TABELAS NOVAS DA VESSEL, EM PLANILHA.
//
//   node coletor/espelhar-vessel-no-zoho.mjs
//   node coletor/espelhar-vessel-no-zoho.mjs --ensaio     # monta e não envia
//
// ⚠️ ESPELHO NÃO É BACKUP, E É DE PROPÓSITO
// Aqui o arquivo INTEIRO é comparado com o que deveria estar lá e regravado
// quando difere. Apagou do banco, some da planilha na rodada seguinte — é assim
// que a Política de Privacidade é cumprida de verdade. A cópia de segurança é
// outro robô (`guardar-copia-do-banco.mjs`), e ela guarda justamente o que aqui
// some.
//
// ⚠️ POR QUE COMPARAR O ARQUIVO INTEIRO, E NÃO PERGUNTAR "TEM LINHA NOVA"
// O robô da lista de espera já tropeçou nisso em agosto: ele só regravava
// quando havia cadastro novo, e apagar alguém do banco deixava os dados dela na
// planilha para sempre. Comparar o arquivo inteiro custa uma leitura por rodada
// e não deixa resto.
//
// Este robô NÃO mexe nas duas planilhas que já existem (lista de espera e
// garantias) — aquelas continuam com `vessel-espelhar-lista`.
import './lib/carregar-env.mjs';
import {
  RAIZ_RBV, conexaoZoho, tokenZoho, caminhoDePastas, baixarArquivo, subirArquivo, montarCsv,
} from './lib/zoho-da-central.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kounqtdoioootxqegkij.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const REST = SUPABASE_URL + '/rest/v1';
const cab = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
const ensaio = process.argv.includes('--ensaio');
// ⚠️ `--mostrar` IMPRIME AS PLANILHAS. Contar linhas não prova que a coluna
// certa tem o dado certo: uma planilha com as colunas trocadas tem o mesmo
// número de linhas de uma correta.
const mostrar = process.argv.includes('--mostrar');

// A pasta onde o dono já trabalha. ⚠️ Por NOME, nunca por id cravado: pasta
// recriada no Zoho muda de id, e um id fixo continuaria apontando, calado, para
// o lugar errado.
const CAMINHO = ['04. Vessel Brasil', '17. Marketing', 'Base de clientes'];

async function ler(caminho) {
  const linhas = [];
  for (let inicio = 0; ; inicio += 1000) {
    const r = await fetch(`${REST}/${caminho}${caminho.includes('?') ? '&' : '?'}`
      + `limit=1000&offset=${inicio}`, { headers: cab });
    if (!r.ok) throw new Error(`${caminho}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    const parte = await r.json();
    linhas.push(...parte);
    if (parte.length < 1000) break;
  }
  return linhas;
}

const dia = (v) => (v ? String(v).slice(0, 10) : '');
const reais = (v) => (v === null || v === undefined ? '' : Number(v).toFixed(2).replace('.', ','));
const instante = (v) => (v ? String(v).slice(0, 16).replace('T', ' ') : '');

// ⚠️ O NOME DO CANAL EM PORTUGUÊS, e o código cru quando não conheço. Planilha é
// para pessoa ler: `lp-private-appointment` numa célula não diz nada a quem
// abre, e traduzir tudo menos o que eu não conheço esconderia canal novo.
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

// ⚠️ A JANELA DA VENDA É UMA ESCOLHA, E ELA APARECE NO NOME DA COLUNA. Do dia da
// visita até 7 dias depois — a mesma régua da Central. Não existe no dado nenhum
// campo dizendo "esta compra veio daquela visita"; o que existe é a mesma
// cliente comprando perto da data. Chamar isso de conversão sem dizer a régua é
// inventar precisão.
const DIAS_DA_VENDA = 7;
function comprasPerto(pedidos, pessoaId, quando) {
  const d = dia(quando);
  if (!d || !pessoaId) return [];
  const [a, m, x] = d.split('-').map(Number);
  const limite = dia(new Date(Date.UTC(a, m - 1, x + DIAS_DA_VENDA)));
  return pedidos.filter((p) => String(p.pessoa_id) === String(pessoaId)
    && dia(p.data_do_pedido) >= d && dia(p.data_do_pedido) <= limite);
}

const naoEhTeste = (l) => !l.teste;

// ── as planilhas ─────────────────────────────────────────────────────────────
const PLANILHAS = [
  {
    arquivo: 'pessoas-vessel.csv',
    // ⚠️ SEM o hash de origem e SEM a data de atualização: planilha é para
    // pessoa ler, e coluna que ninguém usa só atrapalha a leitura.
    async montar() {
      const linhas = await ler('vessel_pessoas?select=id,nome,telefone,email,cidade,consultora,bling_contato_id,criado_em&order=criado_em.desc');
      return montarCsv(
        ['Nome', 'WhatsApp', 'E-mail', 'Cidade', 'Client Advisor', 'Ficha no Bling', 'Entrou em'],
        linhas.map((p) => [p.nome, p.telefone, p.email, p.cidade, p.consultora,
                           p.bling_contato_id, dia(p.criado_em)]));
    },
  },
  {
    arquivo: 'atendimentos-vessel.csv',
    async montar() {
      const [linhas, pessoas] = await Promise.all([
        ler('vessel_atendimentos?select=*&order=criado_em.desc'),
        ler('vessel_pessoas?select=id,nome,telefone'),
      ]);
      const quem = new Map(pessoas.map((p) => [p.id, p]));
      const LOJA = { iguatemi: 'Iguatemi Campinas', tivoli: 'Tivoli', parkshopping: 'ParkShopping' };
      const STATUS = {
        solicitado: 'Pediu horário', confirmado: 'Confirmado', realizado: 'Veio',
        remarcado: 'Remarcou', cancelado: 'Cancelou', no_show: 'Não veio',
      };
      return montarCsv(
        ['Cliente', 'WhatsApp', 'Loja', 'Quando', 'Client Advisor', 'Situação',
         'Veio em', 'Convite', 'Veio de', 'Pedido em'],
        linhas.map((a) => [
          quem.get(a.pessoa_id)?.nome || '', quem.get(a.pessoa_id)?.telefone || '',
          LOJA[a.loja] || a.loja,
          a.quando ? String(a.quando).slice(0, 16).replace('T', ' ') : '',
          a.client_advisor, STATUS[a.status] || a.status,
          dia(a.presenca_em), a.convite_codigo,
          a.origem_registro === 'appointment_card' ? 'Cartão' : 'Site',
          dia(a.criado_em)]));
    },
  },
  {
    arquivo: 'convites-abertos-vessel.csv',
    async montar() {
      const linhas = await ler('vessel_convite_aberturas?select=momento,convite_codigo,praca,client_advisor,via&order=momento.desc');
      return montarCsv(
        ['Quando', 'Convite', 'Praça', 'Client Advisor', 'Abriu pelo'],
        linhas.map((c) => [
          String(c.momento).slice(0, 16).replace('T', ' '),
          c.convite_codigo, c.praca, c.client_advisor,
          c.via === 'qr' ? 'QR do cartão' : 'Link da mensagem']));
    },
  },
  {
    arquivo: 'vendas-vessel.csv',
    async montar() {
      const [pedidos, pessoas, lojas] = await Promise.all([
        ler('vessel_pedidos?select=*&order=data_da_venda.desc'),
        ler('vessel_pessoas?select=id,nome'),
        ler('bling_lojas?select=loja_id,nome'),
      ]);
      const quem = new Map(pessoas.map((p) => [p.id, p.nome]));
      const loja = new Map(lojas.map((l) => [String(l.loja_id), l.nome]));
      return montarCsv(
        // ⚠️ "Valor que entrou" e nao "Valor": o `total` do Bling nao desconta o
        // desconto do item e sai ~6% maior. Coluna com nome vago e como alguem
        // soma a errada sem perceber.
        ['Data da venda', 'Pedido', 'Loja', 'Cliente (no Bling)', 'Conhecemos?',
         'Como casou', 'Valor que entrou', 'Preço de tabela', 'Contado pelo dia de'],
        pedidos.map((p) => [
          dia(p.data_da_venda), p.numero, loja.get(String(p.loja_id)) || '',
          p.contato_nome,
          // ⚠️ "Órfã" não é defeito: é venda de quem nunca passou por um
          // formulário nosso. É o número que diz quanto do faturamento a
          // captação ainda não alcança.
          p.pessoa_id ? quem.get(p.pessoa_id) || 'sim' : 'órfã',
          p.casou_por === 'bling_contato' ? 'ficha do Bling'
            : p.casou_por === 'telefone' ? 'telefone' : '',
          reais(p.receita_liquida),
          reais(p.total_do_bling),
          p.origem_da_data === 'nota' ? 'nota fiscal' : 'pedido']));
    },
  },
  {
    // A PLANILHA QUE RESPONDE "DE ONDE VEIO E DEU EM QUÊ" — uma linha por
    // atendimento, com a etiqueta de origem e o que aconteceu depois. É a
    // versão em planilha do painel de atribuição.
    arquivo: 'atribuicao-vessel.csv',
    async montar() {
      const [ates, pessoas, origens, pedidos, stylists] = await Promise.all([
        ler('vessel_atendimentos?select=*&order=criado_em.desc'),
        ler('vessel_pessoas?select=id,nome,telefone'),
        ler('vessel_origens?select=*&order=id.asc'),
        ler('vessel_pedidos?select=pessoa_id,numero,data_do_pedido,receita_liquida,total_corrigido'),
        ler('vessel_stylists?select=codigo,nome'),
      ]);
      const quem = new Map(pessoas.map((p) => [p.id, p]));
      const nomeDaStylist = new Map(stylists.map((s) => [s.codigo, s.nome]));
      // ⚠️ A PRIMEIRA linha de origem, nunca a última: é o first touch, e o
      // plano proíbe sobrescrevê-lo. `order=id.asc` + `if (!primeira.has)`
      // guarda a mais antiga.
      const primeira = new Map();
      for (const o of origens) if (!primeira.has(o.pessoa_id)) primeira.set(o.pessoa_id, o);

      const LOJA = { iguatemi: 'Iguatemi Campinas', tivoli: 'Tivoli', parkshopping: 'ParkShopping' };
      const STATUS = {
        solicitado: 'Pediu horário', confirmado: 'Confirmado', realizado: 'Veio',
        remarcado: 'Remarcou', cancelado: 'Cancelou', no_show: 'Não veio',
      };
      return montarCsv(
        ['Cliente', 'WhatsApp', 'Loja', 'Quando', 'Situação', 'Veio?',
         'Chegou por (1ª vez)', 'Campanha', 'Stylist', 'Encontro',
         'Este atendimento veio de', 'Comprou até 7 dias depois',
         'Valor que entrou (7 dias)', 'Pedido em'],
        ates.filter(naoEhTeste).map((a) => {
          const o = primeira.get(a.pessoa_id) || {};
          const compras = comprasPerto(pedidos, a.pessoa_id, a.quando || a.criado_em);
          return [
            quem.get(a.pessoa_id)?.nome || '', quem.get(a.pessoa_id)?.telefone || '',
            LOJA[a.loja] || a.loja, instante(a.quando), STATUS[a.status] || a.status,
            a.status === 'realizado' ? 'sim' : a.status === 'no_show' ? 'não' : '',
            canal(o.canal), o.utm_campaign || '',
            o.stylist_id ? `${nomeDaStylist.get(o.stylist_id) || ''} (${o.stylist_id})`.trim() : '',
            a.evento_codigo || o.evento_id || '',
            canal(a.origem_registro),
            compras.length ? compras.map((c) => c.numero).join(' · ') : '',
            compras.length
              ? reais(compras.reduce((t, c) => t + Number(c.receita_liquida ?? c.total_corrigido ?? 0), 0))
              : '',
            dia(a.criado_em)];
        }));
    },
  },
  {
    // TODA linha de origem, na ordem em que chegou. A de atribuição mostra só a
    // primeira; esta mostra o histórico inteiro, que é o que prova o first touch.
    arquivo: 'origens-vessel.csv',
    async montar() {
      const [origens, pessoas, stylists] = await Promise.all([
        ler('vessel_origens?select=*&order=id.desc'),
        ler('vessel_pessoas?select=id,nome,telefone'),
        ler('vessel_stylists?select=codigo,nome'),
      ]);
      const quem = new Map(pessoas.map((p) => [p.id, p]));
      const nomeDaStylist = new Map(stylists.map((s) => [s.codigo, s.nome]));
      const primeira = new Set();
      // A mais antiga por pessoa: percorro do fim (id.desc) para o começo.
      for (const o of [...origens].reverse()) {
        if (!primeira.has('p' + o.pessoa_id)) { primeira.add('p' + o.pessoa_id); o._primeira = true; }
      }
      return montarCsv(
        ['Quando', 'Cliente', 'WhatsApp', 'É a 1ª origem dela?', 'Canal', 'Campanha',
         'Evento', 'Stylist', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content',
         'Veio de clique de anúncio?'],
        origens.map((o) => [
          instante(o.momento), quem.get(o.pessoa_id)?.nome || '',
          quem.get(o.pessoa_id)?.telefone || '', o._primeira ? 'sim' : 'não',
          canal(o.canal), o.campanha_id || '', o.evento_id || '',
          o.stylist_id ? `${nomeDaStylist.get(o.stylist_id) || ''} (${o.stylist_id})`.trim() : '',
          o.utm_source || '', o.utm_medium || '', o.utm_campaign || '', o.utm_content || '',
          // ⚠️ SIM OU NÃO, NUNCA O IDENTIFICADOR. O `clique_meta` é um
          // identificador de publicidade ligado a uma pessoa: ele serve para o
          // retorno ao Meta e não tem uso nenhum numa planilha que circula.
          o.clique_meta ? 'sim' : 'não']));
    },
  },
  {
    arquivo: 'stylists-vessel.csv',
    async montar() {
      const [stylists, aberturas, origens] = await Promise.all([
        ler('vessel_stylists?select=*&order=codigo.asc'),
        ler('vessel_stylist_aberturas?select=codigo'),
        ler('vessel_origens?select=pessoa_id,stylist_id'),
      ]);
      const abriu = new Map();
      for (const a of aberturas) abriu.set(a.codigo, (abriu.get(a.codigo) || 0) + 1);
      const trouxe = new Map();
      for (const o of origens) {
        if (!o.stylist_id) continue;
        const s = trouxe.get(o.stylist_id) || new Set();
        s.add(o.pessoa_id); trouxe.set(o.stylist_id, s);
      }
      const ATUACAO = { stylist: 'Stylist', 'personal-shopper': 'Personal shopper',
                        consultoria: 'Consultoria de imagem', outra: 'Outra' };
      return montarCsv(
        ['Código', 'Nome', 'WhatsApp', 'Cidade', 'Instagram', 'Atuação', 'Estágio',
         'Praça do Preview', 'O link dela', 'Abriram o link', 'Clientes que ela trouxe',
         'Entrou em'],
        stylists.filter(naoEhTeste).map((s) => [
          s.codigo, s.nome, s.whatsapp, s.cidade, s.instagram,
          ATUACAO[s.atuacao] || s.atuacao || '', s.estagio, s.praca_preview,
          `https://vesselbrasil.com.br/s/${s.codigo}`,
          abriu.get(s.codigo) || 0, (trouxe.get(s.codigo)?.size) || 0,
          dia(s.criado_em)]));
    },
  },
  {
    arquivo: 'private-edits-vessel.csv',
    async montar() {
      const [edits, stylists, ates] = await Promise.all([
        ler('vessel_private_edits?select=*&order=quando.desc'),
        ler('vessel_stylists?select=id,codigo,nome'),
        ler('vessel_atendimentos?select=evento_codigo,status,rsvp,teste'),
      ]);
      const anfitria = new Map(stylists.map((s) => [s.id, s]));
      const conta = (codigo, teste) => ates.filter((a) => a.evento_codigo === codigo && !a.teste);
      return montarCsv(
        // ⚠️ O link vai inteiro: e assim que a Ionara manda o convite. A chave
        // nao e senha — quem tem o link entra, e e para isso que ela existe.
        ['Código', 'Quando', 'Anfitriã', 'Local', 'Vagas', 'O link do convite',
         'Responderam', 'Disseram sim', 'Compareceram', 'Ativa?'],
        edits.filter(naoEhTeste).map((e) => {
          const r = conta(e.codigo);
          return [
            e.codigo, instante(e.quando),
            anfitria.get(e.stylist_id)?.nome || '', e.local, e.vagas,
            `https://vesselbrasil.com.br/pe/${e.chave}`,
            r.length, r.filter((a) => a.rsvp === 'sim').length,
            r.filter((a) => a.status === 'realizado').length,
            e.ativa ? 'sim' : 'não'];
        }));
    },
  },
  {
    arquivo: 'beauty-sessions-vessel.csv',
    async montar() {
      const [sessoes, origens] = await Promise.all([
        ler('vessel_beauty_sessions?select=*&order=quando.asc'),
        ler('vessel_origens?select=pessoa_id,evento_id'),
      ]);
      const interessadas = new Map();
      for (const o of origens) {
        if (!o.evento_id) continue;
        const s = interessadas.get(o.evento_id) || new Set();
        s.add(o.pessoa_id); interessadas.set(o.evento_id, s);
      }
      const LOJA = { iguatemi: 'Iguatemi Campinas', tivoli: 'Tivoli', parkshopping: 'ParkShopping' };
      return montarCsv(
        ['Código', 'Quando', 'Praça', 'Loja', 'Salão parceiro', 'O endereço do QR',
         'Interessadas', 'Ativa?'],
        sessoes.map((e) => [
          e.codigo, dia(e.quando), e.praca, LOJA[e.loja] || e.loja,
          // ⚠️ VAZIO APARECE COMO AVISO, e nao como celula em branco: sem o nome
          // do salao nao da para saber, depois, qual parceiro trouxe mais gente.
          e.parceiro || '⚠️ FALTA O NOME DO SALÃO',
          `https://vesselbrasil.com.br/bs/${e.codigo}`,
          (interessadas.get(e.codigo)?.size) || 0,
          e.ativa ? 'sim' : 'não']));
    },
  },
];

// ── a rodada ─────────────────────────────────────────────────────────────────
if (!SERVICE_KEY) { console.error('⛔ Falta SUPABASE_SERVICE_KEY.'); process.exit(1); }

const montadas = [];
for (const p of PLANILHAS) {
  const texto = await p.montar();
  const linhas = texto.trim().split('\n').length - 1;
  montadas.push({ ...p, texto, linhas });
  console.log(`  ${p.arquivo.padEnd(30)} ${String(linhas).padStart(5)} linhas`);
}

if (mostrar) {
  for (const p of montadas) {
    console.log(`\n──────── ${p.arquivo} ────────`);
    console.log(p.texto.trim().split('\n').slice(0, 12).join('\n'));
  }
}

if (ensaio) {
  console.log('\nensaio: montei as planilhas e não enviei nada.\n');
  process.exit(0);
}

const tz = await tokenZoho(await conexaoZoho(REST, cab));
const pasta = await caminhoDePastas(tz, RAIZ_RBV, CAMINHO);

let trocadas = 0;
for (const p of montadas) {
  const laDentro = await baixarArquivo(tz, pasta, p.arquivo);
  // ⚠️ SÓ REGRAVA SE DIFERE. Subir igual todo dia enche o histórico do Zoho de
  // versões idênticas e faz a planilha parecer que mudou quando não mudou.
  if (laDentro === p.texto) { console.log(`  = ${p.arquivo} (não mudou)`); continue; }
  await subirArquivo(tz, pasta, p.arquivo, p.texto);
  console.log(`  ↑ ${p.arquivo}`);
  trocadas++;
}

console.log(`\n${trocadas} de ${montadas.length} planilhas atualizadas em ${CAMINHO.join(' / ')}\n`);
