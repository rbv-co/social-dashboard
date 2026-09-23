// O FILETE DO CARTÃO NO MESMO TOM DO SELO (Onda 2c, 23/09/2026).
//
// O cartão desta tela que tem SITUAÇÃO (o lote, a etiqueta, o lembrete, a
// linha do cartão EAN) já mostra essa situação num selo das classes prontas
// da casa (`.selo-ok`, `.selo-info`…). O filete à esquerda do cartão repete a
// mesma cor, para o olho separar os estados de longe — e sai DAQUI, do mesmo
// selo, para os dois nunca discordarem (a lição da Frota: `tomDoCartao`).
//
// O tom é um dos de `--situacao-*` (src/estilos/identidade-da-ferramenta.css):
//   selo-ok      → viva        (verde: gravada, encerrado, já impresso)
//   selo-info    → andamento   (azul: por gravar, aberto)
//   selo-atencao → queda       (laranja: baixada, não dá, incoerente)
//   selo-erro    → faltou      (vermelho: lote sem peça nenhuma)
//   o resto      → parada      (cinza: pendente, cancelado, sem cartão)
// Não cria selo nem texto: só lê o que a tela já escreve.
const TOM = {
  'selo-ok': 'viva',
  'selo-info': 'andamento',
  'selo-atencao': 'queda',
  'selo-erro': 'faltou',
}

export function tomDoSelo(selo) {
  return TOM[String(selo || '').trim()] || 'parada'
}

/** A classe pronta para o `:class` do cartão: `id-tom-viva`, `id-tom-parada`… */
export const classeDoTom = (selo) => `id-tom-${tomDoSelo(selo)}`
