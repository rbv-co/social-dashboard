// A TRIAGEM DA VAGA DO TIVOLI — transforma os cadastros do formulário do Meta
// nas abas da planilha "Triagem Tivoli Vendedora.xlsx" (04. Vessel Brasil /
// 10. RH-DP). Aqui só se monta; buscar e enviar mora em
// `coletor/triagem-tivoli-no-zoho.mjs`.
//
// ⚠️ A PLANILHA É ESPELHO, MAS DUAS COLUNAS SÃO DO RH: "Status (RH)" e
// "Observações (RH)". O robô reescreve o arquivo inteiro a cada volta; se não
// relesse essas duas do arquivo que está no Zoho, apagaria a anotação do RH
// na volta seguinte, sem aviso. Elas casam pelo "ID do cadastro", nunca pela
// linha: a lista cresce por cima (mais novo primeiro) e a linha 2 de hoje é
// outra pessoa amanhã.

export const FORMULARIO_DA_VAGA = '2276869233161988';

// As chaves são as que o formulário foi criado com; o Meta devolve ora a
// chave, ora o texto da opção — os dois caem no mesmo rótulo.
const EXPERIENCIA = {
  luxo: 'Sim, em moda ou varejo de luxo',
  varejo: 'Sim, em outro tipo de varejo',
  nao: 'Ainda não',
};
const DISPONIBILIDADE = { sim: 'Sim', nao: 'Não' };

const COL_ID = 'ID do cadastro';
const COL_STATUS = 'Status (RH)';
const COL_OBS = 'Observações (RH)';

function rotulo(mapa, valor) {
  const v = String(valor ?? '').trim();
  if (!v) return '';
  if (mapa[v]) return mapa[v];
  const achado = Object.values(mapa).find((r) => r.toLowerCase() === v.toLowerCase());
  return achado || v;
}

function chaveDe(mapa, valor) {
  const r = rotulo(mapa, valor);
  return Object.keys(mapa).find((k) => mapa[k] === r) || '';
}

export function camposDoLead(lead) {
  const c = {};
  for (const f of lead.field_data || []) c[f.name] = (f.values || [])[0] ?? '';
  return c;
}

// Só dígitos, com o 55 na frente quando vier sem.
export function telefoneComPais(bruto) {
  const d = String(bruto || '').replace(/\D/g, '');
  if (!d) return '';
  return d.startsWith('55') && d.length >= 12 ? d : '55' + d;
}

export function telefoneLegivel(bruto) {
  const d = telefoneComPais(bruto).slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(bruto || '');
}

// ⚠️ Sem fim de semana vem PRIMEIRO: shopping abre sábado e domingo, e a
// experiência não compensa a escala que a pessoa não pode fazer.
export function triagem(experiencia, disponibilidade) {
  const e = chaveDe(EXPERIENCIA, experiencia);
  const d = chaveDe(DISPONIBILIDADE, disponibilidade);
  if (d === 'nao') return '❌ Sem fim de semana';
  if (e === 'luxo') return '⭐ Prioridade';
  if (e === 'varejo') return '✅ Chamar';
  if (e === 'nao') return '🟡 Sem experiência';
  return '';
}

// Lê do arquivo que já está no Zoho as duas colunas do RH, por ID.
export function anotacoesDoRh(abasLidas) {
  const m = new Map();
  const aba = (abasLidas || []).find((a) => a.nome === 'Candidatos');
  if (!aba) return m;
  const iId = aba.colunas.indexOf(COL_ID);
  const iSt = aba.colunas.indexOf(COL_STATUS);
  const iOb = aba.colunas.indexOf(COL_OBS);
  if (iId < 0) return m;
  for (const l of aba.linhas) {
    const id = String(l[iId] ?? '').trim();
    if (!id) continue;
    const status = iSt >= 0 ? (l[iSt] ?? '') : '';
    const obs = iOb >= 0 ? (l[iOb] ?? '') : '';
    if (status !== '' || obs !== '') m.set(id, { status, obs });
  }
  return m;
}

const COMO_USAR = [
  { texto: 'TRIAGEM TIVOLI — VENDEDORA', secao: true },
  'Cada linha da aba "Candidatos" é uma pessoa que preencheu o formulário do anúncio da vaga de Consultor de Vendas do Tivoli Shopping.',
  'A planilha se atualiza sozinha: o robô busca os cadastros novos no Meta e reescreve este arquivo. Mais novo em cima.',
  '',
  { texto: 'O QUE O RH PODE ESCREVER', secao: true },
  'Só as colunas "Status (RH)" e "Observações (RH)". O robô guarda o que estiver nelas e devolve na volta seguinte.',
  'Qualquer outra coluna é reescrita pelo robô: mudança feita nelas some na próxima atualização.',
  'Não apague a coluna "ID do cadastro": é por ela que a anotação volta para a pessoa certa.',
  '',
  { texto: 'A COLUNA "TRIAGEM"', secao: true },
  '⭐ Prioridade — tem experiência em moda ou varejo de luxo e pode trabalhar aos fins de semana.',
  '✅ Chamar — tem experiência em outro varejo e pode trabalhar aos fins de semana.',
  '🟡 Sem experiência — pode trabalhar aos fins de semana, mas ainda não trabalhou com vendas.',
  '❌ Sem fim de semana — respondeu que não pode fazer a escala de shopping.',
  '',
  { texto: 'O CURRÍCULO', secao: true },
  'O formulário não recebe arquivo. No fim dele a pessoa vê o botão "Enviar currículo no WhatsApp", que abre o (19) 99822-7221. Quem não mandou pode ser chamado pelo link da coluna "WhatsApp".',
];

export function montarAbasDaTriagem(leads, anotacoes = new Map()) {
  const ordenados = [...(leads || [])]
    .sort((a, b) => String(b.created_time).localeCompare(String(a.created_time)));
  const linhas = ordenados.map((lead) => {
    const c = camposDoLead(lead);
    const tel = c.phone_number || c.phone || '';
    const exp = rotulo(EXPERIENCIA, c.experiencia);
    const disp = rotulo(DISPONIBILIDADE, c.disponibilidade);
    const rh = anotacoes.get(String(lead.id)) || { status: '', obs: '' };
    return [
      lead.created_time,
      c.full_name || '',
      telefoneLegivel(tel),
      tel ? `https://wa.me/${telefoneComPais(tel)}` : '',
      c.city || '',
      exp,
      disp,
      triagem(exp, disp),
      lead.platform === 'ig' ? 'Instagram' : (lead.platform === 'fb' ? 'Facebook' : (lead.platform || '')),
      rh.status,
      rh.obs,
      String(lead.id),
    ];
  });
  return [
    {
      nome: 'Candidatos',
      colunas: [
        { titulo: 'Chegou em', tipo: 'instante', largura: 17 },
        { titulo: 'Nome', largura: 30 },
        { titulo: 'Telefone', largura: 17 },
        { titulo: 'WhatsApp', largura: 30 },
        { titulo: 'Cidade', largura: 20 },
        { titulo: 'Experiência com vendas', largura: 30 },
        { titulo: 'Fim de semana', largura: 14 },
        { titulo: 'Triagem', largura: 22 },
        { titulo: 'Veio por', largura: 11 },
        { titulo: COL_STATUS, largura: 20 },
        { titulo: COL_OBS, largura: 40 },
        { titulo: COL_ID, largura: 20 },
      ],
      linhas,
    },
    {
      nome: 'Como usar',
      filtro: false, zebra: false,
      colunas: [{ titulo: 'COMO USAR ESTA PLANILHA', largura: 110 }],
      linhas: COMO_USAR.map((l) => [l]),
    },
  ];
}
