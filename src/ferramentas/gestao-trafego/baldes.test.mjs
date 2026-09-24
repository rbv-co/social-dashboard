import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baldeDoObjetivo, ehDeWhatsapp, baldeEfetivo, baldeDoObjetivoDaFabrica, ehDeSeguidores } from './baldes.js';

test('cada objetivo cai no seu balde', () => {
  assert.equal(baldeDoObjetivo('OUTCOME_TRAFFIC'), 'trafego');
  assert.equal(baldeDoObjetivo('OUTCOME_SALES'), 'vendas');
  assert.equal(baldeDoObjetivo('OUTCOME_ENGAGEMENT'), 'engajamento');
  assert.equal(baldeDoObjetivo('MESSAGES'), 'mensagens');
  assert.equal(baldeDoObjetivo('OUTCOME_LEADS'), 'leads');
  assert.equal(baldeDoObjetivo('outcome_traffic'), 'trafego', 'minusculo tambem');
});

test('objetivo desconhecido cai em padrao, que NAO tem meta', () => {
  // Sem meta, o calculo devolve 'sem-dados' — melhor que julgar pela regua errada.
  assert.equal(baldeDoObjetivo('COISA_NOVA_DA_META'), 'padrao');
  assert.equal(baldeDoObjetivo(null), 'padrao');
  assert.equal(baldeDoObjetivo(''), 'padrao');
});

test('WhatsApp vem do CONJUNTO, que e o que a Meta AFIRMA', () => {
  assert.equal(ehDeWhatsapp([{ destination_type: 'WHATSAPP' }]), true);
  assert.equal(ehDeWhatsapp([{ optimization_goal: 'CONVERSATIONS' }]), true);
  assert.equal(ehDeWhatsapp([{ destination_type: 'PROFILE_VISIT' }]), false);
  assert.equal(ehDeWhatsapp([]), false);
  assert.equal(ehDeWhatsapp(null), false);
});

test('engajamento com destino WhatsApp e medido como mensagem', () => {
  assert.equal(baldeEfetivo('OUTCOME_ENGAGEMENT', [{ destination_type: 'WHATSAPP' }]), 'mensagens');
});

test('campanha da Raissa com conversa de tabela NAO vira mensagem', () => {
  // O caso real: "[TRÁFEGO] VIAGENS | PERFIL", 4.601 curtidas e 18 conversas
  // espontaneas, era medida a R$ 317 por conversa contra meta de R$ 15.
  assert.equal(baldeEfetivo('OUTCOME_ENGAGEMENT', [{ destination_type: 'PROFILE_VISIT' }]), 'engajamento');
  assert.equal(baldeEfetivo('OUTCOME_ENGAGEMENT', [{ optimization_goal: 'POST_ENGAGEMENT' }]), 'engajamento');
});

test('destino WhatsApp vale para QUALQUER objetivo, nao so engajamento', () => {
  // Os dados mandaram (2026-07-29): a "[Leads] Para WhatsApp" da Motoeasy gastou
  // R$ 9.738 com 2 leads e 1.020 conversas. Medida por lead dava R$ 4.869 — um
  // numero sem significado. Sao 8 campanhas e R$ 33.314 em 90 dias assim.
  assert.equal(baldeEfetivo('OUTCOME_LEADS', [{ destination_type: 'WHATSAPP' }]), 'mensagens');
  assert.equal(baldeEfetivo('OUTCOME_TRAFFIC', [{ optimization_goal: 'CONVERSATIONS' }]), 'mensagens');
  assert.equal(baldeEfetivo('OUTCOME_SALES', [{ destination_type: 'WHATSAPP' }]), 'mensagens');
});

test('SEM destino WhatsApp cada objetivo continua no seu balde', () => {
  // A trava contra o bug de 2026-07-28: o sinal e o que a Meta AFIRMA no
  // conjunto, nunca o resultado. Campanha de lead comum segue lead.
  assert.equal(baldeEfetivo('OUTCOME_LEADS', [{ destination_type: 'ON_AD' }]), 'leads');
  assert.equal(baldeEfetivo('OUTCOME_TRAFFIC', [{ optimization_goal: 'LINK_CLICKS' }]), 'trafego');
  assert.equal(baldeEfetivo('OUTCOME_SALES', []), 'vendas');
});

// As QUATRO linhas semeadas em db/migrations/022_fabrica_objetivos.sql, copiadas
// campo por campo. Se a migration mudar, este bloco tem de mudar junto — e é de
// propósito: e o que prende a tela da Fabrica a um fato do banco.
const OBJETIVOS_DA_FABRICA = [
  { chave: 'engajamento', rotulo: 'Engajamento (WhatsApp)', meta_objective: 'OUTCOME_ENGAGEMENT', optimization_goal: 'CONVERSATIONS', destination_type: 'WHATSAPP' },
  { chave: 'conversao',   rotulo: 'Conversão / Vendas',     meta_objective: 'OUTCOME_SALES',      optimization_goal: 'CONVERSATIONS', destination_type: 'WHATSAPP' },
  { chave: 'branding',    rotulo: 'Reconhecimento',         meta_objective: 'OUTCOME_AWARENESS',  optimization_goal: 'REACH',         destination_type: null },
  { chave: 'trafego',     rotulo: 'Tráfego',                meta_objective: 'OUTCOME_TRAFFIC',    optimization_goal: 'LINK_CLICKS',   destination_type: 'WHATSAPP' },
];
const daFabrica = (chave) => OBJETIVOS_DA_FABRICA.find((o) => o.chave === chave);

test('os objetivos da Fabrica caem no balde que a META AFIRMA, nao no rotulo', () => {
  // TRES dos quatro objetivos da Fabrica mandam pro WhatsApp. Julgar so pelo
  // meta_objective daria sugestao de ENGAJAMENTO pra uma campanha de conversa —
  // o mesmo erro de classificacao que este produto ja cometeu duas vezes.
  assert.equal(baldeDoObjetivoDaFabrica(daFabrica('engajamento')), 'mensagens');
  assert.equal(baldeDoObjetivoDaFabrica(daFabrica('conversao')), 'mensagens');
  assert.equal(baldeDoObjetivoDaFabrica(daFabrica('trafego')), 'mensagens');
  // O unico sem messaging (destination_type null, REACH): segue reconhecimento.
  assert.equal(baldeDoObjetivoDaFabrica(daFabrica('branding')), 'reconhecimento');
});

test('o rotulo bonito NAO decide o balde', () => {
  // "Engajamento (WhatsApp)" e o nome que o dono le na tela; quem manda sao os
  // campos. Trocar o rotulo nao pode mudar o balde.
  const comOutroRotulo = { ...daFabrica('engajamento'), rotulo: 'Qualquer outro nome' };
  assert.equal(baldeDoObjetivoDaFabrica(comOutroRotulo), 'mensagens');
});

test('linha sem optimization_goal (select curto de quem chamou) cai em padrao, NAO em engajamento', () => {
  // A coluna e `not null` na migration 022: linha de verdade sempre tem valor.
  // Faltar aqui so pode ser `select` de quem chamou que nao pediu a coluna — e
  // responder 'engajamento' com confianca seria o erro de classificacao de novo,
  // em silencio. 'padrao' fecha a faixa de sugestoes em vez de mostrar a errada.
  assert.equal(baldeDoObjetivoDaFabrica({ chave: 'engajamento', meta_objective: 'OUTCOME_ENGAGEMENT' }), 'padrao');
  // Nem com o outro sinal presente: se a coluna `not null` nao veio, a linha
  // chegou incompleta e nao da pra confiar em nada dela.
  assert.equal(baldeDoObjetivoDaFabrica({ chave: 'engajamento', meta_objective: 'OUTCOME_ENGAGEMENT', destination_type: 'WHATSAPP' }), 'padrao');
  assert.equal(baldeDoObjetivoDaFabrica({ meta_objective: 'OUTCOME_SALES', optimization_goal: '   ' }), 'padrao',
    'so espaco e o mesmo que faltar');
  assert.equal(baldeDoObjetivoDaFabrica({ meta_objective: 'OUTCOME_SALES', optimization_goal: null }), 'padrao');
});

test('linha ausente ou lixo cai em padrao, sem quebrar', () => {
  // 'padrao' e o balde sem meta — quem chama trata como "nao sei", e a faixa de
  // sugestoes simplesmente nao aparece.
  for (const lixo of [null, undefined, {}, 'engajamento', 42, []])
    assert.equal(baldeDoObjetivoDaFabrica(lixo), 'padrao');
});

test('ehDeSeguidores pega as quatro formas reais, sem padrao unico', () => {
  // Os quatro nomes que existem hoje nas contas — nenhum startsWith unico
  // cobre todos (ver comentario em baldes.js).
  assert.equal(ehDeSeguidores('[+SEGUIDORES] SeguidoresParceiros'), true, 'sem espaco');
  assert.equal(ehDeSeguidores('[+ SEGUIDORES] DETALHES | P3'), true, 'com espaco');
  assert.equal(ehDeSeguidores('[SEGUIDORES][REMARKETING]'), true, 'sem o +');
  assert.equal(ehDeSeguidores('[400]_AXIOM_05_SEGUID_VESSEL-CAMPINAS'), true, 'abreviado no meio do nome');
});

test('ehDeSeguidores nao pega campanha de outro tipo por engano', () => {
  assert.equal(ehDeSeguidores('[LEADS] MOTO OU PARCELA? | P3'), false);
  // Visita ao perfil e outro produto: mede visita de verdade, custo por
  // resultado valido — nao pode cair na muleta de seguidores so por estar
  // perto do tema.
  assert.equal(ehDeSeguidores('[300]_VESSEL_PERFIL_TOPO_VISITAS_ABO_260922_LOCALIZAÇÃO'), false);
});

test('ehDeSeguidores e case/acento-insensivel e nao quebra com lixo', () => {
  assert.equal(ehDeSeguidores('[+ seguidores] minusculo'), true);
  assert.equal(ehDeSeguidores(null), false);
  assert.equal(ehDeSeguidores(undefined), false);
  assert.equal(ehDeSeguidores(''), false);
  assert.equal(ehDeSeguidores(42), false);
});
