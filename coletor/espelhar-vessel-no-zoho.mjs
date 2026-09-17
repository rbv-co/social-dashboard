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
        ['Data da venda', 'Pedido', 'Loja', 'Cliente (no Bling)', 'Conhecemos?',
         'Como casou', 'Valor', 'Contado pelo dia de'],
        pedidos.map((p) => [
          dia(p.data_da_venda), p.numero, loja.get(String(p.loja_id)) || '',
          p.contato_nome,
          // ⚠️ "Órfã" não é defeito: é venda de quem nunca passou por um
          // formulário nosso. É o número que diz quanto do faturamento a
          // captação ainda não alcança.
          p.pessoa_id ? quem.get(p.pessoa_id) || 'sim' : 'órfã',
          p.casou_por === 'bling_contato' ? 'ficha do Bling'
            : p.casou_por === 'telefone' ? 'telefone' : '',
          reais(p.total_corrigido ?? p.total_do_bling),
          p.origem_da_data === 'nota' ? 'nota fiscal' : 'pedido']));
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
