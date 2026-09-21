// A HORA COMO ELA FOI NO BRASIL, e não como o banco a guarda.
//
// ⚠️ O DEFEITO QUE ISTO CONSERTA (medido em 21/09/2026)
// O banco guarda instante em UTC, e o PostgREST devolve `2026-09-21T02:11:23+00:00`.
// As planilhas cortavam essa string com `slice(0, 16)` e imprimiam o pedaço como
// se fosse hora local — 3 horas adiantada, sem erro nenhum aparecer. Pior: de
// 150 cadastros da lista de espera, 24 saíam com o DIA ERRADO, porque quem
// entrou depois das 21h no Brasil já é "amanhã" em UTC. A Marisa entrou em
// 20/09 às 23h11 e a planilha dizia 21/09 02h11.
//
// ⚠️ ISTO SERVE SÓ PARA COLUNA DE INSTANTE (`timestamptz`), NUNCA PARA DATA PURA.
// Coluna `date` — data da venda, dia da visita, garantia até — já vem como
// 'AAAA-MM-DD' e não tem hora nenhuma. Passar uma data pura por aqui a leria
// como meia-noite em UTC e devolveria o DIA ANTERIOR: a visita de segunda
// viraria domingo. São 7 colunas `date` no banco da Vessel; elas passam
// intocadas (ver `dia` em `planilha-xlsx.mjs`).
//
// ⚠️ POR QUE `Intl` E NÃO "MENOS TRÊS HORAS"
// Subtrair 3 horas na mão acerta hoje e erra no dia em que o horário de verão
// voltar (o Brasil o aboliu em 2019, não o proibiu para sempre) e erra em
// qualquer linha gravada antes de 2019. O `Intl` carrega a tabela de fusos.

const FUSO = 'America/Sao_Paulo';

// `hourCycle: 'h23'` de propósito: com `hour12: false` algumas versões do ICU
// devolvem "24" para a meia-noite, e "24:05" não existe em planilha nenhuma.
const RELOGIO = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO,
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

/**
 * Os números do relógio de parede em São Paulo, para um instante em UTC.
 * Devolve `null` para vazio ou lixo — planilha com célula vazia é melhor que
 * planilha com "Invalid Date".
 */
export function paredeEmSaoPaulo(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const d = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(d.getTime())) return null;
  const p = {};
  for (const { type, value } of RELOGIO.formatToParts(d)) p[type] = value;
  return {
    ano: Number(p.year),
    mes: Number(p.month),
    dia: Number(p.day),
    hora: Number(p.hour) === 24 ? 0 : Number(p.hour),
    minuto: Number(p.minute),
    segundo: Number(p.second),
  };
}

const dois = (n) => String(n).padStart(2, '0');

/** 'AAAA-MM-DD HH:MM:SS' na hora do Brasil. Vazio quando não há instante. */
export function instanteLegivel(valor) {
  const h = paredeEmSaoPaulo(valor);
  if (!h) return '';
  return `${h.ano}-${dois(h.mes)}-${dois(h.dia)} ${dois(h.hora)}:${dois(h.minuto)}:${dois(h.segundo)}`;
}

/** Só o dia, na hora do Brasil — 'AAAA-MM-DD'. É o que muda em 24 dos 150. */
export function diaEmSaoPaulo(valor) {
  const h = paredeEmSaoPaulo(valor);
  if (!h) return '';
  return `${h.ano}-${dois(h.mes)}-${dois(h.dia)}`;
}
