// A TRIAGEM DA VAGA DO TIVOLI — transforma as linhas de `vessel_candidaturas`
// nas abas da planilha "Triagem Tivoli Vendedora.xlsx" (04. Vessel Brasil /
// 10. RH-DP). Aqui só se monta; buscar e enviar mora em
// `coletor/triagem-tivoli-no-zoho.mjs`.
//
// ⚠️ DE ONDE VEM: a página `vesselbrasil.com.br/vaga-tivoli`, e NÃO o
// formulário do Meta. O cadastro feito dentro do Instagram fica no Meta, e ler
// de lá exige `leads_retrieval` — que o token do usuário do sistema não tem e
// ninguém da casa consegue gerar (25/09/2026).
//
// ⚠️ O ROBÔ ACRESCENTA, NÃO REESCREVE (pedido do dono, 25/09/2026: "manter as
// informações que o usuário for editando"). A cada volta ele relê o arquivo do
// Zoho e devolve TUDO como o RH deixou — qualquer coluna, qualquer ordem, aba
// que o RH tenha criado. O que ele faz é só pôr as candidatas NOVAS no topo.
//   - "nova" = não está no arquivo E `na_planilha_em` vazio no banco;
//   - não está no arquivo mas já foi entregue = o RH apagou: NÃO volta.
// Quem é quem se sabe pelo "ID do cadastro", nunca pela linha.

export const VAGA = 'consultor-tivoli';
export const PASTA_DOS_CURRICULOS = 'Triagem Tivoli - Currículos';

const EXPERIENCIA = {
  luxo: 'Sim, em moda ou varejo de luxo',
  varejo: 'Sim, em outro tipo de varejo',
  nao: 'Ainda não',
};

const COL_ID = 'ID do cadastro';
const COL_STATUS = 'Status (RH)';
const COL_OBS = 'Observações (RH)';

export function telefoneLegivel(canonico) {
  const d = String(canonico || '').replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return String(canonico || '');
}

// ⚠️ Sem fim de semana vem PRIMEIRO: shopping abre sábado e domingo, e a
// experiência não compensa a escala que a pessoa não pode fazer.
export function triagem(experiencia, fimDeSemana) {
  if (fimDeSemana === false) return '❌ Sem fim de semana';
  if (experiencia === 'luxo') return '⭐ Prioridade';
  if (experiencia === 'varejo') return '✅ Chamar';
  if (experiencia === 'nao') return '🟡 Sem experiência';
  return '';
}

// O `utm_source` que o anúncio carimba (`{{site_source_name}}` do Meta).
export function veioPor(origem) {
  const s = String(origem?.utm_source || '').toLowerCase();
  if (!s) return origem?.clique_meta ? 'Anúncio' : 'Direto';
  if (s === 'ig' || s.includes('instagram')) return 'Instagram';
  if (s === 'fb' || s.includes('facebook')) return 'Facebook';
  return s;
}

/**
 * O nome do currículo na pasta do Zoho: data, nome e um pedaço do ID.
 * ⚠️ O PEDAÇO DO ID NÃO É ENFEITE: duas "Ana Souza" no mesmo dia teriam o mesmo
 * nome de arquivo, e o Zoho SUBSTITUI (`override-name-exist`) — o currículo da
 * primeira sumiria sem aviso.
 */
export function nomeDoCurriculo(c) {
  if (!c?.curriculo) return '';
  const ext = String(c.curriculo).split('.').pop().toLowerCase();
  const dia = String(c.criado_em || '').slice(0, 10);
  const nome = String(c.nome || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return `${dia} - ${nome} - ${String(c.id).slice(0, 8)}.${ext}`;
}

const COMO_USAR = [
  { texto: 'TRIAGEM TIVOLI — VENDEDORA', secao: true },
  'Cada linha da aba "Candidatos" é uma pessoa que se candidatou à vaga de Consultor de Vendas do Tivoli Shopping pela página vesselbrasil.com.br/vaga-tivoli (o destino do anúncio).',
  'A planilha se atualiza sozinha, a cada 2 horas das 8h às 20h. Mais novo em cima.',
  '',
  { texto: 'O QUE O RH PODE MEXER', secao: true },
  'Tudo. O robô nunca reescreve uma linha que já está aqui: corrigir nome, mudar telefone, anotar, reordenar, criar coluna ou aba — fica como você deixou.',
  'O robô só acrescenta candidatas novas no topo da aba "Candidatos".',
  'Apagou a linha de alguém? Ela não volta.',
  'Só NÃO apague nem renomeie a coluna "ID do cadastro": é por ela que o robô sabe quem já está na planilha. Sem ela, ele para e não mexe em nada.',
  'Não renomeie a aba "Candidatos": é nela que as novas entram.',
  '',
  { texto: 'A COLUNA "TRIAGEM"', secao: true },
  '⭐ Prioridade — tem experiência em moda ou varejo de luxo e pode trabalhar aos fins de semana.',
  '✅ Chamar — tem experiência em outro varejo e pode trabalhar aos fins de semana.',
  '🟡 Sem experiência — pode trabalhar aos fins de semana, mas ainda não trabalhou com vendas.',
  '❌ Sem fim de semana — respondeu que não pode fazer a escala de shopping.',
  '',
  { texto: 'O CURRÍCULO', secao: true },
  `Quem anexou na página tem o arquivo na pasta "${PASTA_DOS_CURRICULOS}", ao lado desta planilha, com o nome que aparece na coluna "Currículo".`,
  'Quem não anexou foi convidada a mandar pelo WhatsApp (19) 99822-7221. Para chamar, use o link da coluna "WhatsApp".',
];

const TITULOS = [
  'Chegou em', 'Nome', 'Telefone', 'WhatsApp', 'Cidade', 'Experiência com vendas',
  'Fim de semana', 'Triagem', 'Currículo', 'Veio por', COL_STATUS, COL_OBS, COL_ID,
];
const LARGURAS = [17, 30, 17, 28, 20, 30, 14, 22, 44, 11, 20, 40, 38];

const dois = (n) => String(n).padStart(2, '0');
const ZERO_DO_EXCEL = Date.UTC(1899, 11, 30);

/**
 * "Chegou em" como TEXTO, 'DD/MM/AAAA HH:MM' na hora de São Paulo.
 * ⚠️ TEXTO DE PROPÓSITO: a linha preservada volta do arquivo como texto (ou
 * como número de série, se o Zoho regravou), e a coluna de data do gerador
 * apaga o que não é data — a data de uma linha antiga sumiria calada.
 */
export function chegouEm(valor) {
  const v = String(valor ?? '').trim();
  if (!v) return '';
  if (/^\d{2}\/\d{2}\/\d{4}/.test(v)) return v;
  if (/^\d+(\.\d+)?$/.test(v)) {
    // Número de série do Excel, já em hora de parede.
    const d = new Date(ZERO_DO_EXCEL + Math.round(Number(v) * 86400000));
    return `${dois(d.getUTCDate())}/${dois(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} `
      + `${dois(d.getUTCHours())}:${dois(d.getUTCMinutes())}`;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;       // texto do RH: fica como está
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

function linhaNova(c) {
  const fone = String(c.whatsapp || '').replace(/\D/g, '');
  return {
    'Chegou em': chegouEm(c.criado_em),
    Nome: c.nome || '',
    Telefone: telefoneLegivel(c.whatsapp),
    WhatsApp: fone ? `https://wa.me/${fone}` : '',
    Cidade: c.cidade || '',
    'Experiência com vendas': EXPERIENCIA[c.experiencia] || c.experiencia || '',
    'Fim de semana': c.fim_de_semana === true ? 'Sim' : (c.fim_de_semana === false ? 'Não' : ''),
    Triagem: triagem(c.experiencia, c.fim_de_semana),
    'Currículo': nomeDoCurriculo(c) || 'Não anexou',
    'Veio por': veioPor(c.origem),
    [COL_STATUS]: '',
    [COL_OBS]: '',
    [COL_ID]: String(c.id),
  };
}

const abaDeUso = () => ({
  nome: 'Como usar', filtro: false, zebra: false,
  colunas: [{ titulo: 'COMO USAR ESTA PLANILHA', largura: 110 }],
  linhas: COMO_USAR.map((l) => [l]),
});

/**
 * Junta o que está no Zoho (`abasLidas`, ou null se o arquivo ainda não existe)
 * com o banco. Devolve `{ abas, entregues, novas }` — `entregues` são os IDs
 * que passam a estar na planilha e que o robô marca no banco DEPOIS de subir.
 *
 * ⚠️ SEM A COLUNA "ID do cadastro" NÃO HÁ COMO SABER QUEM JÁ ESTÁ LÁ: em vez
 * de adivinhar (e duplicar todo mundo, ou apagar), ele LANÇA ERRO e não mexe.
 */
export function montarAbasDaTriagem(candidaturas, abasLidas = null) {
  const todas = [...(candidaturas || [])]
    .sort((a, b) => String(b.criado_em).localeCompare(String(a.criado_em)));
  const lida = (abasLidas || []).find((a) => a.nome === 'Candidatos');

  // Arquivo novo (ou sem a aba): todo mundo que o RH ainda não apagou.
  // ⚠️ Se o arquivo SUMIU, volta todo mundo, entregue ou não: perder a lista
  // inteira por um arquivo apagado sem querer é pior que devolver linha.
  if (!lida) {
    if (abasLidas && abasLidas.length) {
      throw new Error('a planilha existe mas não tem a aba "Candidatos" — renomearam? Não mexi em nada.');
    }
    const linhas = todas.map((c) => TITULOS.map((t) => linhaNova(c)[t]));
    return {
      abas: [{ nome: 'Candidatos', colunas: TITULOS.map((titulo, i) => ({ titulo, largura: LARGURAS[i] })), linhas }, abaDeUso()],
      entregues: todas.map((c) => String(c.id)),
      novas: todas.length,
    };
  }

  const iId = lida.colunas.indexOf(COL_ID);
  if (iId < 0) throw new Error('a aba "Candidatos" perdeu a coluna "ID do cadastro" — não mexi em nada.');
  const iChegou = lida.colunas.indexOf('Chegou em');
  const larg = (t) => LARGURAS[TITULOS.indexOf(t)] ?? 20;
  const noArquivo = new Set(lida.linhas.map((l) => String(l[iId] ?? '').trim()).filter(Boolean));

  const novas = todas.filter((c) => !noArquivo.has(String(c.id)) && !c.na_planilha_em);
  const linhasNovas = novas.map((c) => {
    const d = linhaNova(c);
    return lida.colunas.map((t) => d[t] ?? '');
  });
  // As linhas do RH, do jeito que estão — só a data volta a ser texto legível.
  const doRh = lida.linhas.map((l) => {
    const copia = lida.colunas.map((_, i) => l[i] ?? '');
    if (iChegou >= 0) copia[iChegou] = chegouEm(copia[iChegou]);
    return copia;
  });

  // Outras abas que o RH criou vão junto, como estão. "Como usar" é do robô.
  const outras = abasLidas
    .filter((a) => a.nome !== 'Candidatos' && a.nome !== 'Como usar')
    .map((a) => ({ nome: a.nome, colunas: a.colunas.map((titulo) => ({ titulo, largura: 20 })), linhas: a.linhas }));

  return {
    abas: [
      { nome: 'Candidatos', colunas: lida.colunas.map((titulo) => ({ titulo, largura: larg(titulo) })), linhas: [...linhasNovas, ...doRh] },
      abaDeUso(),
      ...outras,
    ],
    entregues: [...new Set([...novas.map((c) => String(c.id)), ...todas.filter((c) => noArquivo.has(String(c.id))).map((c) => String(c.id))])],
    novas: novas.length,
  };
}
