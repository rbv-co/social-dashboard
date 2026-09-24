import { test } from 'node:test';
import assert from 'node:assert/strict';
import { montarAbas, CONSULTAS } from './abas-da-vessel.js';
import { montarXlsx } from './planilha-xlsx.js';
import { abasDoXlsx } from './ler-xlsx.mjs';

// ⚠️ POR QUE ESTE TESTE EXISTE, COM LINHA INVENTADA
// Em 21/09/2026, CINCO das onze abas estavam vazias no banco: pessoas,
// atendimentos, origens, stylists e private edits, todas com zero linhas. Uma
// prova ao vivo passa por elas sem olhar nada — coluna trocada ali não
// apareceria até o dia em que a primeira cliente entrasse, e aí já estaria na
// mão do dono. Aqui cada aba recebe linha de mentira e é lida de volta.

const vazio = () => Object.fromEntries(Object.keys(CONSULTAS).map((k) => [k, []]));

/** Monta a planilha e devolve a aba pedida, já lida de volta do arquivo. */
async function aba(nome, dados) {
  const todas = abasDoXlsx(await montarXlsx(montarAbas({ ...vazio(), ...dados })));
  const achada = todas.find((a) => a.nome === nome);
  assert.ok(achada, `não existe aba "${nome}"`);
  return achada;
}

const PESSOA = { id: 1, nome: 'Marisa Carvalho', telefone: '+5511948670004',
  email: 'marisa@exemplo.com', cidade: 'Campinas', consultora: 'Ionara',
  bling_contato_id: '9001', criado_em: '2026-09-21T02:11:23+00:00' };

// ⚠️ A ORDEM É A QUE O DONO APROVOU em 21/09/2026, e o teste a guarda: a
// explicação primeiro, depois as pessoas, depois o que elas fizeram, depois a
// análise, e por último os programas da marca.
const ORDEM_DAS_ABAS = [
  'Instruções', 'Landing page', 'Clientes', 'Visitas às lojas', 'Vendas', 'Garantias',
  'Histórico de origem', 'Convites abertos', 'Stylists', 'Private Edits',
  'Beauty Sessions'];

test('as onze abas estão todas lá, na ordem que o dono aprovou', async () => {
  const todas = abasDoXlsx(await montarXlsx(montarAbas(vazio())));
  assert.deepEqual(todas.map((a) => a.nome), ORDEM_DAS_ABAS);
});

test('nenhuma consulta pede `*` na tabela da lista de espera (tem senha e IP lá)', () => {
  assert.ok(!CONSULTAS.listaDeEspera.colunas.includes('*'));
  for (const proibida of ['senha_hash', 'ip_hash']) {
    assert.ok(!CONSULTAS.listaDeEspera.colunas.includes(proibida),
      `${proibida} não pode sair do banco`);
  }
});

test('Landing page: a hora é do Brasil e os rótulos são de gente', async () => {
  const a = await aba('Landing page', {
    listaDeEspera: [{
      nome: 'Marisa Carvalho', email: 'marisa@exemplo.com', whatsapp: '+5511948670004',
      origem: 'lp-vesselbrasil', criado_em: '2026-09-21T02:11:23.050085+00:00',
      objetivo: 'visita', visita_data: '2026-10-05', visita_hora: '15:00',
      visita_bolsa: 'shoulder-bag', visita_ocasiao: 'viagem', visita_atelier: true,
      visita_acompanhantes: 0, visita_pedido: 'quero ver a cor café',
      aceite_em: '2026-09-21T02:11:24+00:00', aceite_versao: 'v3', bling_id: null,
    }],
  });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  assert.equal(c('Entrou em'), '20/09/2026 23:11');
  assert.equal(c('Dia da visita'), '05/10/2026');
  assert.equal(c('O que ela quer'), 'quer visitar a loja');
  assert.equal(c('Peça'), 'Shoulder Bag');
  assert.equal(c('Personal Atelier'), 'sim');
  // ⚠️ `0` é resposta, não ausência de resposta.
  assert.equal(c('Acompanhantes'), 'vem sozinha');
  assert.equal(c('Já está no Bling?'), 'ainda não');
});

test('Landing page: escolha nova no formulário aparece, em vez de sumir', async () => {
  const a = await aba('Landing page', {
    listaDeEspera: [{ nome: 'x', visita_bolsa: 'clutch-que-nao-existia', criado_em: '2026-09-21T12:00:00Z' }],
  });
  assert.equal(a.linhas[0][a.colunas.indexOf('Peça')], 'clutch-que-nao-existia');
});

test('Vendas: valor é número somável, órfã é órfã, e a data não tem fuso', async () => {
  const a = await aba('Vendas', {
    pedidos: [{ numero: '2680', situacao_id: 9, loja_id: 205834116, data_da_venda: '2026-09-21',
      contato_nome: 'Luiza Maria', pessoa_id: null, receita_liquida: '3450.00',
      total_do_bling: '3670.00', origem_da_data: 'nota' }],
    lojasDoBling: [{ loja_id: 205834116, nome: 'Shopping Iguatemi Campinas' }],
  });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  assert.equal(c('Data da venda'), '21/09/2026');
  assert.equal(c('Loja'), 'Shopping Iguatemi Campinas');
  assert.equal(c('Conhecemos?'), 'órfã');
  assert.equal(c('Valor que entrou'), '3450');
  assert.equal(c('Contado pelo dia de'), 'nota fiscal');
});

test('Vendas: cliente conhecida sai pelo nome dela', async () => {
  const a = await aba('Vendas', {
    pedidos: [{ numero: '1', situacao_id: 9, pessoa_id: 1, casou_por: 'telefone', data_da_venda: '2026-09-21' }],
    pessoas: [PESSOA],
  });
  assert.equal(a.linhas[0][a.colunas.indexOf('Conhecemos?')], 'Marisa Carvalho');
  assert.equal(a.linhas[0][a.colunas.indexOf('Como casou')], 'telefone');
});

test('⚠️ Visitas às lojas: a janela de 7 dias começa no dia BRASILEIRO da visita', async () => {
  // Visita às 22h30 do dia 05/10 no Brasil — que em UTC já é 06/10.
  // Com a conta em UTC, a compra do próprio dia 05 ficaria FORA da janela e a
  // visita apareceria como "não comprou". Este teste morre se isso voltar.
  const a = await aba('Visitas às lojas', {
    atendimentos: [{ pessoa_id: 1, loja: 'iguatemi', status: 'realizado',
      quando: '2026-10-06T01:30:00+00:00', criado_em: '2026-10-01T12:00:00Z' }],
    pessoas: [PESSOA],
    pedidos: [{ pessoa_id: 1, situacao_id: 9, numero: '2700', data_do_pedido: '2026-10-05',
      receita_liquida: '1200.00' }],
  });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  assert.equal(c('Quando'), '05/10/2026 22:30');
  assert.equal(c('Comprou até 7 dias depois'), '2700');
  assert.equal(c('Valor que entrou (7 dias)'), '1200');
  assert.equal(c('Veio?'), 'sim');
});

test('Visitas às lojas: compra de 8 dias depois fica FORA da janela', async () => {
  const a = await aba('Visitas às lojas', {
    atendimentos: [{ pessoa_id: 1, status: 'no_show', quando: '2026-10-05T15:00:00Z',
      criado_em: '2026-10-01T12:00:00Z' }],
    pessoas: [PESSOA],
    pedidos: [{ pessoa_id: 1, situacao_id: 9, numero: '2701', data_do_pedido: '2026-10-14' }],
  });
  assert.equal(a.linhas[0][a.colunas.indexOf('Comprou até 7 dias depois')], '');
  assert.equal(a.linhas[0][a.colunas.indexOf('Veio?')], 'não');
});

test('Atribuição e origem: o first touch é a origem MAIS ANTIGA', async () => {
  const dados = {
    pessoas: [PESSOA],
    origens: [
      { id: 10, pessoa_id: 1, canal: 'meta', momento: '2026-09-01T12:00:00Z', utm_campaign: 'lancamento' },
      { id: 20, pessoa_id: 1, canal: 'instagram', momento: '2026-09-10T12:00:00Z' },
    ],
    atendimentos: [{ pessoa_id: 1, status: 'realizado', quando: '2026-09-15T15:00:00Z',
      criado_em: '2026-09-15T12:00:00Z' }],
  };
  const atrib = await aba('Visitas às lojas', dados);
  assert.equal(atrib.linhas[0][atrib.colunas.indexOf('Chegou por (1ª vez)')], 'Anúncio (Meta)');
  assert.equal(atrib.linhas[0][atrib.colunas.indexOf('Campanha')], 'lancamento');

  const origens = await aba('Histórico de origem', dados);
  // A aba de origens mostra as duas, mais nova primeiro, e marca qual é a 1ª.
  const ehPrimeira = origens.colunas.indexOf('É a 1ª origem dela?');
  assert.equal(origens.linhas[0][origens.colunas.indexOf('Canal')], 'Instagram');
  assert.equal(origens.linhas[0][ehPrimeira], 'não');
  assert.equal(origens.linhas[1][ehPrimeira], 'sim');
});

test('⚠️ Origens: o identificador de anúncio NUNCA vai para a planilha', async () => {
  const a = await aba('Histórico de origem', {
    pessoas: [PESSOA],
    origens: [{ id: 1, pessoa_id: 1, canal: 'meta', momento: '2026-09-01T12:00:00Z',
      clique_meta: 'IwAR0-um-identificador-de-pessoa-real' }],
  });
  const tudo = a.linhas.flat().join('|');
  assert.ok(!tudo.includes('IwAR0'), 'o clique_meta vazou para a planilha');
  assert.equal(a.linhas[0][a.colunas.indexOf('Veio de clique de anúncio?')], 'sim');
});

test('Clientes: "Entrou em" é o dia do Brasil, não o do UTC', async () => {
  const a = await aba('Clientes', { pessoas: [PESSOA] });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  // criado_em é 21/09 02h11 em UTC = 20/09 no Brasil.
  assert.equal(c('Entrou em'), '20/09/2026');
  assert.equal(c('Client Advisor'), 'Ionara');
  assert.equal(c('Ficha no Bling'), '9001');
});

test('Visitas às lojas: situação em português e os três dias certos', async () => {
  const a = await aba('Visitas às lojas', {
    pessoas: [PESSOA],
    atendimentos: [{ pessoa_id: 1, loja: 'tivoli', status: 'no_show',
      quando: '2026-10-06T01:30:00+00:00', client_advisor: 'Ionara',
      presenca_em: '2026-10-06T01:40:00+00:00', convite_codigo: 'CV1',
      origem_registro: 'appointment_card', criado_em: '2026-10-01T02:00:00+00:00' }],
  });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  assert.equal(c('Loja'), 'Tivoli');
  assert.equal(c('Situação'), 'Não veio');
  assert.equal(c('Quando'), '05/10/2026 22:30');
  assert.equal(c('Veio em'), '05/10/2026');
  assert.equal(c('Pedido em'), '30/09/2026');
  // ⚠️ A coluna binária "Veio de" (Cartão / Site) MORREU na fusão das duas abas
  // de visita. Ela chamava de "Site" tudo o que não fosse cartão — inclusive o
  // link de uma stylist e o QR de uma Beauty Session. A que ficou sabe o canal.
  assert.equal(c('Este atendimento veio de'), 'Cartão da loja');
  assert.equal(c('Client Advisor'), 'Ionara');
});

test('Convites abertos: QR e link têm nomes diferentes', async () => {
  const a = await aba('Convites abertos', {
    conviteAberturas: [
      { momento: '2026-09-20T18:00:00Z', convite_codigo: 'CV1', praca: 'CPS',
        client_advisor: 'Ionara', via: 'qr' },
      { momento: '2026-09-21T18:00:00Z', convite_codigo: 'CV2', praca: 'CPS',
        client_advisor: 'Ionara', via: 'link' },
    ],
  });
  const i = a.colunas.indexOf('Abriu pelo');
  // Mais recente primeiro.
  assert.equal(a.linhas[0][i], 'Link da mensagem');
  assert.equal(a.linhas[1][i], 'QR do cartão');
});

test('Stylists: o link dela, quantos abriram e quantas ela trouxe', async () => {
  const a = await aba('Stylists', {
    stylists: [{ id: 5, codigo: 'ANA', nome: 'Ana Stylist', whatsapp: '199',
      cidade: 'Campinas', instagram: '@ana', atuacao: 'personal-shopper',
      etapa_id: 3, praca_preview: 'CPS', criado_em: '2026-09-21T02:00:00+00:00' }],
    stylistEtapas: [{ id: 1, nome: 'Identificado' }, { id: 3, nome: 'Prospectado' }],
    stylistAberturas: [{ codigo: 'ANA' }, { codigo: 'ANA' }, { codigo: 'OUTRA' }],
    origens: [{ id: 1, pessoa_id: 1, stylist_id: 'ANA' },
      { id: 2, pessoa_id: 1, stylist_id: 'ANA' },
      { id: 3, pessoa_id: 2, stylist_id: 'ANA' }],
  });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  assert.equal(c('O link dela'), 'https://vesselbrasil.com.br/s/ANA');
  assert.equal(c('Abriram o link'), '2');
  // Duas PESSOAS distintas, e não três linhas de origem.
  assert.equal(c('Clientes que ela trouxe'), '2');
  assert.equal(c('Atuação'), 'Personal shopper');
  // 24/09: o nome da etapa (funil configurável), não uma chave de texto.
  assert.equal(c('Etapa'), 'Prospectado');
  assert.equal(c('Entrou em'), '20/09/2026');
});

test('Stylists e Private Edits: linha de teste não entra na planilha', async () => {
  const a = await aba('Stylists', {
    stylists: [{ id: 1, codigo: 'TESTE', nome: 'Fulana de Teste', teste: true },
      { id: 2, codigo: 'REAL', nome: 'Ana' }],
  });
  assert.equal(a.linhas.length, 1);
  assert.equal(a.linhas[0][a.colunas.indexOf('Código')], 'REAL');
});

test('Private Edits: conta quem respondeu, quem disse sim e quem veio', async () => {
  const a = await aba('Private Edits', {
    privateEdits: [{ codigo: 'PE1', quando: '2026-10-06T01:30:00+00:00', stylist_id: 5,
      local: 'Casa da Ana', vagas: 8, chave: 'abc123', ativa: true }],
    stylists: [{ id: 5, codigo: 'ANA', nome: 'Ana Stylist' }],
    atendimentos: [
      { evento_codigo: 'PE1', status: 'realizado', rsvp: 'sim' },
      { evento_codigo: 'PE1', status: 'solicitado', rsvp: 'sim' },
      { evento_codigo: 'PE1', status: 'cancelado', rsvp: 'não' },
      { evento_codigo: 'PE1', status: 'realizado', rsvp: 'sim', teste: true },
      { evento_codigo: 'OUTRO', status: 'realizado', rsvp: 'sim' },
    ],
  });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  assert.equal(c('Anfitriã'), 'Ana Stylist');
  assert.equal(c('Quando'), '05/10/2026 22:30');
  assert.equal(c('O link do convite'), 'https://vesselbrasil.com.br/pe/abc123');
  assert.equal(c('Responderam'), '3', 'a linha de teste e a de outro evento não contam');
  assert.equal(c('Disseram sim'), '2');
  assert.equal(c('Compareceram'), '1');
});

test('Beauty Sessions: o dia é puro e salão sem nome vira aviso', async () => {
  const a = await aba('Beauty Sessions', {
    beautySessions: [{ codigo: 'BS-1', quando: '2026-09-25', praca: 'CPS',
      loja: 'iguatemi', parceiro: null, ativa: true }],
    origens: [{ id: 1, pessoa_id: 1, evento_id: 'BS-1' },
      { id: 2, pessoa_id: 1, evento_id: 'BS-1' }],
  });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  // ⚠️ `quando` é coluna `date`: 25/09 tem de sair 25/09, nunca 24/09.
  assert.equal(c('Quando'), '25/09/2026');
  assert.equal(c('Loja'), 'Iguatemi Campinas');
  assert.equal(c('Salão parceiro'), '⚠️ FALTA O NOME DO SALÃO');
  assert.equal(c('Interessadas'), '1', 'a mesma pessoa duas vezes conta uma');
});

test('Beauty Sessions: as interessadas separadas pelo QR e pela equipe, sem a ficha de teste', async () => {
  const a = await aba('Beauty Sessions', {
    beautySessions: [{ codigo: 'BS-1', quando: '2026-09-25', praca: 'CPS', loja: 'iguatemi',
      parceiro: 'Salão', ativa: false }],
    pessoas: [{ id: 1, nome: 'Rita' }, { id: 2, nome: 'Ana' }, { id: 3, nome: 'Bia' },
      { id: 4, nome: 'Teste', teste: true }],
    origens: [
      { id: 1, pessoa_id: 1, evento_id: 'BS-1', utm_medium: 'offline_qr' },
      { id: 2, pessoa_id: 2, evento_id: 'BS-1', utm_medium: 'offline_equipe' },
      // ⚠️ A Ana leu o QR DEPOIS de a equipe cadastrá-la: continua da equipe
      // (a primeira origem dela na sessão), e não conta duas vezes.
      { id: 3, pessoa_id: 2, evento_id: 'BS-1', utm_medium: 'offline_qr' },
      { id: 4, pessoa_id: 3, evento_id: 'BS-1', utm_medium: 'offline_equipe' },
      { id: 5, pessoa_id: 4, evento_id: 'BS-1', utm_medium: 'offline_qr' },
    ],
  });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  assert.equal(c('Interessadas'), '3', 'a ficha de teste não conta');
  assert.equal(c('Pelo QR'), '1');
  assert.equal(c('Pela equipe'), '2');
  assert.equal(c('Ativa?'), 'não', 'encerrada continua na aba');
});

test('Visitas às lojas e Histórico de origem: a lead da equipe aparece como a do QR, com a marca dela', async () => {
  const dados = {
    pessoas: [{ id: 7, nome: 'Ana da Equipe', telefone: '5519990002402', criado_em: '2026-09-24T12:00:00+00:00' }],
    atendimentos: [
      { id: 1, pessoa_id: 7, loja: 'iguatemi', status: 'solicitado', origem_registro: 'beauty-session-equipe',
        criado_em: '2026-09-24T12:00:00+00:00' },
      { id: 2, pessoa_id: 7, loja: 'iguatemi', status: 'solicitado', origem_registro: 'beauty-session',
        criado_em: '2026-09-20T12:00:00+00:00' }],
    origens: [{ id: 1, pessoa_id: 7, canal: 'beauty_session', evento_id: 'BS-1', utm_source: 'beauty_session',
      utm_medium: 'offline_equipe', utm_campaign: 'bs_1', momento: '2026-09-24T12:00:00+00:00' }],
  };
  const v = await aba('Visitas às lojas', dados);
  const veio = v.colunas.indexOf('Este atendimento veio de');
  assert.deepEqual(v.linhas.map((l) => l[veio]), ['Beauty Session · pela equipe', 'Beauty Session · QR']);
  assert.equal(v.linhas[0][v.colunas.indexOf('Chegou por (1ª vez)')], 'Beauty Session');
  assert.equal(v.linhas[0][v.colunas.indexOf('Encontro')], 'BS-1');
  const h = await aba('Histórico de origem', dados);
  assert.equal(h.linhas[0][h.colunas.indexOf('utm_medium')], 'offline_equipe');
  assert.equal(h.linhas[0][h.colunas.indexOf('Evento')], 'BS-1');
  const cl = await aba('Clientes', dados);
  assert.equal(cl.linhas[0][0], 'Ana da Equipe');
});

test('pessoa apagada do banco não deixa nome de fantasma em aba nenhuma', async () => {
  // A venda aponta para uma pessoa que não existe mais (LGPD: ela pediu para
  // sair). A planilha não pode inventar nome nem estourar.
  const a = await aba('Vendas', {
    pedidos: [{ numero: '9', situacao_id: 9, pessoa_id: 999, data_da_venda: '2026-09-21' }],
    pessoas: [],
  });
  assert.equal(a.linhas[0][a.colunas.indexOf('Conhecemos?')], 'sim');
});

test('⚠️ a ordem das linhas não depende da ordem que o banco devolveu', async () => {
  // Os DOIS escritores (a edge e o ensaio em node) gravam o MESMO arquivo. Se a
  // ordem viesse da consulta, um poderia devolver as linhas ao contrário do
  // outro e a comparação byte a byte acharia que a planilha mudou — versão nova
  // no Zoho a cada três minutos, para sempre.
  const linhas = [
    { nome: 'Velha', criado_em: '2026-09-01T12:00:00Z' },
    { nome: 'Nova', criado_em: '2026-09-21T12:00:00Z' },
    { nome: 'Meio', criado_em: '2026-09-10T12:00:00Z' },
  ];
  const daOrdem = async (ordem) => {
    const a = await aba('Landing page', { listaDeEspera: ordem });
    return a.linhas.map((l) => l[0]);
  };
  const esperado = ['Nova', 'Meio', 'Velha'];
  assert.deepEqual(await daOrdem(linhas), esperado);
  assert.deepEqual(await daOrdem([...linhas].reverse()), esperado);
  assert.deepEqual(await daOrdem([linhas[1], linhas[0], linhas[2]]), esperado);
});

test('mesmo dado em ordem diferente gera bytes IDÊNTICOS', async () => {
  const dados = {
    ...vazio(),
    pedidos: [{ numero: '1', situacao_id: 9, data_da_venda: '2026-09-01' },
      { numero: '2', situacao_id: 9, data_da_venda: '2026-09-21' }],
    beautySessions: [{ codigo: 'B2', quando: '2026-10-02' }, { codigo: 'B1', quando: '2026-10-01' }],
  };
  const trocado = {
    ...dados,
    pedidos: [...dados.pedidos].reverse(),
    beautySessions: [...dados.beautySessions].reverse(),
  };
  const a = await montarXlsx(montarAbas(dados));
  const b = await montarXlsx(montarAbas(trocado));
  assert.equal(Buffer.from(a).toString('base64'), Buffer.from(b).toString('base64'));
});

test('Landing page: a origem de cada LP chega na planilha', async () => {
  // ⚠️ ESTE É O PORTÃO que `vessel-espelhar-lista/marca-de-origem.test.mjs`
  // aponta. No Bling as LPs se separam por um prefixo no `codigo` (LP, PV); na
  // planilha se separam por esta coluna. Perder a coluna numa faxina deixaria as
  // duas captações misturadas, e ninguém saberia qual página trouxe quem.
  const a = await aba('Landing page', {
    listaDeEspera: [
      { nome: 'Da pré-venda', origem: 'pre-venda', criado_em: '2026-09-21T12:00:00Z' },
      { nome: 'Da LP comum', origem: 'lp-vesselbrasil', criado_em: '2026-09-20T12:00:00Z' },
    ],
  });
  const i = a.colunas.indexOf('Como chegou');
  assert.notEqual(i, -1, 'a coluna da origem saiu da planilha');
  assert.equal(a.linhas[0][i], 'pre-venda');
  assert.equal(a.linhas[1][i], 'lp-vesselbrasil');
});

// ── A ABA DE INSTRUÇÕES ─────────────────────────────────────────────────────

// ⚠️ `?? ''` porque a linha EM BRANCO volta do arquivo como célula ausente: o
// gerador não escreve célula vazia (planilha com milhares delas fica pesada).
// Sem isto, o teste estoura em `undefined.length` e parece defeito do conteúdo.
const instrucoes = async () =>
  (await aba('Instruções', {})).linhas.map((l) => l[0] ?? '');

// O que foi ENTREGUE ao gerador, antes de virar arquivo — é onde dá para ver
// quais linhas são título de bloco.
const instrucoesCruas = () =>
  montarAbas(vazio()).find((a) => a.nome === 'Instruções').linhas.map((l) => l[0]);

test('a aba de Instruções é a PRIMEIRA — é a que abre', async () => {
  const todas = abasDoXlsx(await montarXlsx(montarAbas(vazio())));
  assert.equal(todas[0].nome, 'Instruções');
  assert.equal(todas[0].colunas[0], 'COMO USAR ESTA PLANILHA');
});

test('⚠️ as instruções nomeiam TODAS as outras abas', async () => {
  // Esta é a trava que importa: sem ela, renomear uma aba e esquecer a
  // explicação deixaria a planilha se contradizendo — o dono leria um nome na
  // aba e outro na instrução, e não saberia qual está velho.
  const texto = (await instrucoes()).join('\n');
  for (const nome of ORDEM_DAS_ABAS) {
    if (nome === 'Instruções') continue;
    assert.ok(texto.includes(nome), `as instruções não falam da aba "${nome}"`);
  }
});

test('⚠️ nenhuma linha das instruções passa de 100 letras', async () => {
  // O Excel NÃO estica a altura da linha sozinho quando o texto quebra: ele usa
  // a altura padrão e o resto do texto fica ESCONDIDO, sem aviso nenhum. Linha
  // curta é o que impede isso — não a quebra automática.
  for (const l of await instrucoes()) {
    assert.ok(l.length <= 100, `linha com ${l.length} letras ficaria cortada: "${l}"`);
  }
});

test('as instruções dizem as três coisas que mais confundem', async () => {
  const texto = (await instrucoes()).join('\n').toLowerCase();
  // 1. que escrever na planilha não muda nada no sistema
  assert.match(texto, /escrever aqui não muda nada/);
  // 2. que apagar no sistema apaga daqui (a promessa da Política de Privacidade)
  assert.match(texto, /desaparece desta planilha/);
  // 3. em que fuso está a hora — foi o defeito que originou tudo isto
  assert.match(texto, /horário de brasília/);
});

test('a aba de Instruções não entra na contagem da rodada', async () => {
  // O robô imprime "Landing page: 150, Vendas: 464..." no resultado. "Instruções:
  // 38" ali no meio não diz nada e atrapalha quem lê o log.
  const doc = montarAbas(vazio()).filter((a) => a.documentacao);
  assert.equal(doc.length, 1);
  assert.equal(doc[0].nome, 'Instruções');
});

test('a aba de Instruções não tem filtro, e as de dado têm', async () => {
  const abas = montarAbas(vazio());
  assert.equal(abas.find((a) => a.nome === 'Instruções').filtro, false);
  for (const a of abas.filter((x) => !x.documentacao)) {
    assert.notEqual(a.filtro, false, `a aba "${a.nome}" perdeu o filtro`);
  }
});

test('os títulos de bloco das instruções são negrito de verdade, não maiúscula com risco', () => {
  // A primeira versão separava os blocos com uma linha de traços, porque não
  // havia estilo nenhum — ficou com cara de arquivo de texto dentro de uma
  // planilha. Agora são células com estilo próprio.
  const cruas = instrucoesCruas();
  const titulos = cruas.filter((l) => l && typeof l === 'object' && l.secao);
  assert.ok(titulos.length >= 6, `só ${titulos.length} títulos de bloco`);
  assert.equal(titulos[0].texto, 'O QUE É ISTO');
  // E nenhum risquinho sobrou.
  for (const l of cruas) {
    const texto = typeof l === 'object' && l ? l.texto : String(l ?? '');
    assert.ok(!texto.includes('──'), `sobrou um risco: "${texto}"`);
  }
});

test('a aba de Instruções não tem listra — listra em texto corrido vira tabela falsa', () => {
  const abas = montarAbas(vazio());
  assert.equal(abas.find((a) => a.nome === 'Instruções').zebra, false);
  for (const a of abas.filter((x) => !x.documentacao)) {
    assert.notEqual(a.zebra, false, `a aba "${a.nome}" perdeu a listra`);
  }
});

test('⚠️ Vendas: preço de tabela − desconto = valor que entrou, SEMPRE', async () => {
  // O desconto da Vessel mora em DOIS lugares no Bling: um no pedido e outro em
  // cada peça (119 dos 464 pedidos têm o segundo, medido em 21/09/2026). A aba
  // mostra UMA coluna de desconto, somando os dois, justamente para as três
  // colunas nunca se contradizerem na frente do dono.
  const a = await aba('Vendas', {
    pedidos: [
      // desconto só no pedido
      { numero: '1', situacao_id: 9, data_da_venda: '2026-09-21', total_produtos: '800.00',
        desconto: '400.00', total_do_bling: '400.00', receita_liquida: '400.00' },
      // desconto também na peça: o `total` do Bling não enxerga, a soma sim
      { numero: '2', situacao_id: 9, data_da_venda: '2026-09-20', total_produtos: '1000.00',
        desconto: '100.00', total_do_bling: '900.00', receita_liquida: '850.00' },
      // e o caso torto de verdade: o Bling se contradiz (pedido 2116, julho)
      { numero: '3', situacao_id: 9, data_da_venda: '2026-07-04', total_produtos: '389.90',
        desconto: '50.00', total_do_bling: '194.95', receita_liquida: '339.90' },
    ],
  });
  const col = (t) => a.colunas.indexOf(t);
  for (const l of a.linhas) {
    const tabela = Number(l[col('Preço de tabela')]);
    const desconto = Number(l[col('Desconto')]);
    const entrou = Number(l[col('Valor que entrou')]);
    assert.ok(Math.abs((tabela - desconto) - entrou) < 0.01,
      `o pedido ${l[col('Pedido')]} não fecha: ${tabela} - ${desconto} ≠ ${entrou}`);
    assert.ok(desconto >= 0, `desconto negativo no pedido ${l[col('Pedido')]}`);
  }
  // e a porcentagem acompanha
  assert.equal(a.linhas[0][col('Desconto (%)')], '50');
});

test('Vendas: quem vendeu sai pelo nome, e o desconhecido sai pelo número', async () => {
  const a = await aba('Vendas', {
    pedidos: [
      { numero: '1', situacao_id: 9, data_da_venda: '2026-09-21', vendedor_id: 77 },
      { numero: '2', situacao_id: 9, data_da_venda: '2026-09-20', vendedor_id: 999 },
      { numero: '3', situacao_id: 9, data_da_venda: '2026-09-19', vendedor_id: null },
    ],
    vendedores: [{ bling_vendedor_id: 77, nome: 'Ionara Elias' }],
  });
  const i = a.colunas.indexOf('Quem vendeu');
  assert.equal(a.linhas[0][i], 'Ionara Elias');
  // ⚠️ Vendedor que o Bling não conhece mais sai com o NÚMERO, e não vazio:
  // vazio parece "venda sem vendedor", que é outra coisa.
  assert.equal(a.linhas[1][i], 'nº 999');
  assert.equal(a.linhas[2][i] ?? '', '');
});

test('Vendas: "O que saiu" traz as peças do pedido CERTO', async () => {
  // ⚠️ `vessel_pedido_itens.pedido_id` aponta para `vessel_pedidos.id` (a chave
  // da nossa tabela), e não para o id do Bling. Trocar os dois devolveria peças
  // de outro pedido sem erro nenhum.
  const a = await aba('Vendas', {
    pedidos: [
      { id: 1, situacao_id: 9, bling_pedido_id: 26890674024, numero: '2668', data_da_venda: '2026-09-21' },
      { id: 2, situacao_id: 9, bling_pedido_id: 26889945274, numero: '2667', data_da_venda: '2026-09-20' },
    ],
    itensVendidos: [
      { pedido_id: 1, sku: 'SS1', descricao: 'ShoulderBag Ravelle Small Mostarda', quantidade: '1.000' },
      { pedido_id: 1, sku: 'SS2', descricao: 'East West Astrea Big Bordô', quantidade: '2.000' },
      { pedido_id: 2, sku: 'SS3', descricao: 'Bolsa Festa Dubrovnik', quantidade: '1.000' },
    ],
  });
  const oQue = a.colunas.indexOf('O que saiu');
  const quantas = a.colunas.indexOf('Peças');
  assert.equal(a.linhas[0][oQue],
    'ShoulderBag Ravelle Small Mostarda · East West Astrea Big Bordô (2x)');
  assert.equal(a.linhas[0][quantas], '2');
  assert.equal(a.linhas[1][oQue], 'Bolsa Festa Dubrovnik');
});

test('⚠️ Visitas às lojas engoliu a aba de atribuição, e ficou com as duas metades', async () => {
  const a = await aba('Visitas às lojas', {
    pessoas: [PESSOA],
    atendimentos: [{ pessoa_id: 1, loja: 'tivoli', status: 'realizado',
      quando: '2026-10-06T01:30:00+00:00', client_advisor: 'Ionara',
      convite_codigo: 'CV1', criado_em: '2026-10-01T12:00:00Z' }],
    origens: [{ id: 1, pessoa_id: 1, canal: 'meta', momento: '2026-09-01T12:00:00Z',
      utm_campaign: 'lancamento' }],
    pedidos: [{ pessoa_id: 1, situacao_id: 9, numero: '2700', data_do_pedido: '2026-10-05',
      receita_liquida: '1200.00' }],
  });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  // a metade que era de "Visitas às lojas"
  assert.equal(c('Loja'), 'Tivoli');
  assert.equal(c('Client Advisor'), 'Ionara');
  assert.equal(c('Convite'), 'CV1');
  // a metade que era de "De onde veio e no que deu"
  assert.equal(c('Chegou por (1ª vez)'), 'Anúncio (Meta)');
  assert.equal(c('Campanha'), 'lancamento');
  assert.equal(c('Comprou até 7 dias depois'), '2700');
  assert.equal(c('Valor que entrou (7 dias)'), '1200');
});

test('⚠️ Visitas às lojas não mostra linha de teste', async () => {
  // A aba antiga de visitas NÃO filtrava `teste` e a de atribuição filtrava.
  // Juntar sem decidir deixaria o número de visitas diferente do do painel.
  const a = await aba('Visitas às lojas', {
    pessoas: [PESSOA],
    atendimentos: [
      { pessoa_id: 1, status: 'realizado', criado_em: '2026-10-02T12:00:00Z', teste: true },
      { pessoa_id: 1, status: 'realizado', criado_em: '2026-10-01T12:00:00Z' },
    ],
  });
  assert.equal(a.linhas.length, 1);
});

// ── PEDIDO QUE DEIXOU DE SER VENDA ──────────────────────────────────────────
// ⚠️ Estes testes existem por causa de uma pergunta do dono sobre a Gestão à
// Vista em 21/09/2026: ela mostrava R$ 6.900 porque a mesma venda tinha TRÊS
// pedidos no Bling, dois cancelados. Ela lê o Bling ao vivo e se corrigiu; a
// planilha, não — ela contava cancelado como venda desde sempre.

const VENDA = (extra) => ({ numero: '1', data_da_venda: '2026-09-21',
  data_do_pedido: '2026-09-21', situacao_id: 9, total_produtos: '1000.00',
  receita_liquida: '1000.00', ...extra });

test('⚠️ Vendas mostra só pedido ATENDIDO — cancelado e sumido ficam de fora', async () => {
  const a = await aba('Vendas', {
    pedidos: [
      VENDA({ numero: '2682' }),                        // a venda de verdade
      VENDA({ numero: '2680', situacao_id: 12 }),       // cancelado
      VENDA({ numero: '2681', situacao_id: 12 }),       // cancelado
      VENDA({ numero: '2099', situacao_id: null }),     // sumiu do Bling
    ],
  });
  assert.equal(a.linhas.length, 1, 'contou pedido que não é venda');
  assert.equal(a.linhas[0][a.colunas.indexOf('Pedido')], '2682');
});

test('⚠️ a janela de 7 dias também ignora pedido cancelado', async () => {
  // Senão a visita apareceria como "comprou" por causa de um pedido desfeito, e
  // a atribuição contaria receita que não existe.
  const a = await aba('Visitas às lojas', {
    pessoas: [PESSOA],
    atendimentos: [{ pessoa_id: 1, status: 'realizado', quando: '2026-10-05T15:00:00Z',
      criado_em: '2026-10-01T12:00:00Z' }],
    pedidos: [
      { pessoa_id: 1, numero: '900', data_do_pedido: '2026-10-06',
        receita_liquida: '500.00', situacao_id: 12 },
      { pessoa_id: 1, numero: '901', data_do_pedido: '2026-10-06',
        receita_liquida: '700.00', situacao_id: 9 },
    ],
  });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  assert.equal(c('Comprou até 7 dias depois'), '901');
  assert.equal(c('Valor que entrou (7 dias)'), '700');
});

test('as instruções avisam que pedido cancelado sai sozinho', async () => {
  const texto = (await instrucoes()).join('\n');
  assert.match(texto, /cancelado/i);
  assert.match(texto, /Gestão à Vista/);
});
