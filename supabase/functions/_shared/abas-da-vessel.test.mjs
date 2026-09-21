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

test('as onze abas estão todas lá, nesta ordem', async () => {
  const todas = abasDoXlsx(await montarXlsx(montarAbas(vazio())));
  assert.deepEqual(todas.map((a) => a.nome), [
    'Lista de espera', 'Vendas', 'Garantias', 'Atribuição', 'Origens', 'Pessoas',
    'Atendimentos', 'Convites abertos', 'Stylists', 'Private Edits', 'Beauty Sessions']);
});

test('nenhuma consulta pede `*` na tabela da lista de espera (tem senha e IP lá)', () => {
  assert.ok(!CONSULTAS.listaDeEspera.colunas.includes('*'));
  for (const proibida of ['senha_hash', 'ip_hash']) {
    assert.ok(!CONSULTAS.listaDeEspera.colunas.includes(proibida),
      `${proibida} não pode sair do banco`);
  }
});

test('Lista de espera: a hora é do Brasil e os rótulos são de gente', async () => {
  const a = await aba('Lista de espera', {
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

test('Lista de espera: escolha nova no formulário aparece, em vez de sumir', async () => {
  const a = await aba('Lista de espera', {
    listaDeEspera: [{ nome: 'x', visita_bolsa: 'clutch-que-nao-existia', criado_em: '2026-09-21T12:00:00Z' }],
  });
  assert.equal(a.linhas[0][a.colunas.indexOf('Peça')], 'clutch-que-nao-existia');
});

test('Vendas: valor é número somável, órfã é órfã, e a data não tem fuso', async () => {
  const a = await aba('Vendas', {
    pedidos: [{ numero: '2680', loja_id: 205834116, data_da_venda: '2026-09-21',
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
    pedidos: [{ numero: '1', pessoa_id: 1, casou_por: 'telefone', data_da_venda: '2026-09-21' }],
    pessoas: [PESSOA],
  });
  assert.equal(a.linhas[0][a.colunas.indexOf('Conhecemos?')], 'Marisa Carvalho');
  assert.equal(a.linhas[0][a.colunas.indexOf('Como casou')], 'telefone');
});

test('⚠️ Atribuição: a janela de 7 dias começa no dia BRASILEIRO da visita', async () => {
  // Visita às 22h30 do dia 05/10 no Brasil — que em UTC já é 06/10.
  // Com a conta em UTC, a compra do próprio dia 05 ficaria FORA da janela e a
  // visita apareceria como "não comprou". Este teste morre se isso voltar.
  const a = await aba('Atribuição', {
    atendimentos: [{ pessoa_id: 1, loja: 'iguatemi', status: 'realizado',
      quando: '2026-10-06T01:30:00+00:00', criado_em: '2026-10-01T12:00:00Z' }],
    pessoas: [PESSOA],
    pedidos: [{ pessoa_id: 1, numero: '2700', data_do_pedido: '2026-10-05',
      receita_liquida: '1200.00' }],
  });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  assert.equal(c('Quando'), '05/10/2026 22:30');
  assert.equal(c('Comprou até 7 dias depois'), '2700');
  assert.equal(c('Valor que entrou (7 dias)'), '1200');
  assert.equal(c('Veio?'), 'sim');
});

test('Atribuição: compra de 8 dias depois fica FORA da janela', async () => {
  const a = await aba('Atribuição', {
    atendimentos: [{ pessoa_id: 1, status: 'no_show', quando: '2026-10-05T15:00:00Z',
      criado_em: '2026-10-01T12:00:00Z' }],
    pessoas: [PESSOA],
    pedidos: [{ pessoa_id: 1, numero: '2701', data_do_pedido: '2026-10-14' }],
  });
  assert.equal(a.linhas[0][a.colunas.indexOf('Comprou até 7 dias depois')], '');
  assert.equal(a.linhas[0][a.colunas.indexOf('Veio?')], 'não');
});

test('Atribuição e Origens: o first touch é a origem MAIS ANTIGA', async () => {
  const dados = {
    pessoas: [PESSOA],
    origens: [
      { id: 10, pessoa_id: 1, canal: 'meta', momento: '2026-09-01T12:00:00Z', utm_campaign: 'lancamento' },
      { id: 20, pessoa_id: 1, canal: 'instagram', momento: '2026-09-10T12:00:00Z' },
    ],
    atendimentos: [{ pessoa_id: 1, status: 'realizado', quando: '2026-09-15T15:00:00Z',
      criado_em: '2026-09-15T12:00:00Z' }],
  };
  const atrib = await aba('Atribuição', dados);
  assert.equal(atrib.linhas[0][atrib.colunas.indexOf('Chegou por (1ª vez)')], 'Anúncio (Meta)');
  assert.equal(atrib.linhas[0][atrib.colunas.indexOf('Campanha')], 'lancamento');

  const origens = await aba('Origens', dados);
  // A aba de origens mostra as duas, mais nova primeiro, e marca qual é a 1ª.
  const ehPrimeira = origens.colunas.indexOf('É a 1ª origem dela?');
  assert.equal(origens.linhas[0][origens.colunas.indexOf('Canal')], 'Instagram');
  assert.equal(origens.linhas[0][ehPrimeira], 'não');
  assert.equal(origens.linhas[1][ehPrimeira], 'sim');
});

test('⚠️ Origens: o identificador de anúncio NUNCA vai para a planilha', async () => {
  const a = await aba('Origens', {
    pessoas: [PESSOA],
    origens: [{ id: 1, pessoa_id: 1, canal: 'meta', momento: '2026-09-01T12:00:00Z',
      clique_meta: 'IwAR0-um-identificador-de-pessoa-real' }],
  });
  const tudo = a.linhas.flat().join('|');
  assert.ok(!tudo.includes('IwAR0'), 'o clique_meta vazou para a planilha');
  assert.equal(a.linhas[0][a.colunas.indexOf('Veio de clique de anúncio?')], 'sim');
});

test('Pessoas: "Entrou em" é o dia do Brasil, não o do UTC', async () => {
  const a = await aba('Pessoas', { pessoas: [PESSOA] });
  const c = (t) => a.linhas[0][a.colunas.indexOf(t)];
  // criado_em é 21/09 02h11 em UTC = 20/09 no Brasil.
  assert.equal(c('Entrou em'), '20/09/2026');
  assert.equal(c('Client Advisor'), 'Ionara');
  assert.equal(c('Ficha no Bling'), '9001');
});

test('Atendimentos: situação em português e os três dias certos', async () => {
  const a = await aba('Atendimentos', {
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
  assert.equal(c('Veio de'), 'Cartão');
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
      estagio: 'ativa', praca_preview: 'CPS', criado_em: '2026-09-21T02:00:00+00:00' }],
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

test('pessoa apagada do banco não deixa nome de fantasma em aba nenhuma', async () => {
  // A venda aponta para uma pessoa que não existe mais (LGPD: ela pediu para
  // sair). A planilha não pode inventar nome nem estourar.
  const a = await aba('Vendas', {
    pedidos: [{ numero: '9', pessoa_id: 999, data_da_venda: '2026-09-21' }],
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
    const a = await aba('Lista de espera', { listaDeEspera: ordem });
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
    pedidos: [{ numero: '1', data_da_venda: '2026-09-01' }, { numero: '2', data_da_venda: '2026-09-21' }],
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

test('Lista de espera: a origem de cada LP chega na planilha', async () => {
  // ⚠️ ESTE É O PORTÃO que `vessel-espelhar-lista/marca-de-origem.test.mjs`
  // aponta. No Bling as LPs se separam por um prefixo no `codigo` (LP, PV); na
  // planilha se separam por esta coluna. Perder a coluna numa faxina deixaria as
  // duas captações misturadas, e ninguém saberia qual página trouxe quem.
  const a = await aba('Lista de espera', {
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
