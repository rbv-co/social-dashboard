// resumo-do-destino.js — a frase que o passo "Subir" diz ANTES de publicar na Meta.
//
// POR QUE EXISTE: a pendência B4 ("gerei e subiu só do Tivoli, faltou Dom Pedro") não era defeito
// do laço multi-loja do coletor — medido no banco em 12/08/2026, o laço sempre subiu exatamente as
// lojas que recebeu. A tela é que nasce com `destino.lojas = ['tivoli']` e deixa a segunda loja
// dependendo de um chip pequeno. Sem uma frase dizendo o que vai acontecer, a pessoa só descobre no
// Gerenciador de Anúncios. Isto é o item 9 do PADRÃO: a tela nunca mente — e calar também é mentir.
//
// Devolve { texto, fora, atencao } ou null quando o destino não cria campanha por loja.
// `atencao` é o que decide a cor da tarja na tela: âmbar SÓ quando há algo a alertar (loja de fora
// ou nenhuma loja). Com as duas lojas marcadas a frase é informação, não aviso — pintar de âmbar
// sempre faria o alerta virar paisagem, que é justamente o que o item 9 do PADRÃO proíbe.

function listar(nomes) {
  if (nomes.length <= 1) return nomes[0] || '';
  return nomes.slice(0, -1).join(', ') + ' e ' + nomes[nomes.length - 1];
}

export function resumoDoDestino(destino, lojasDisponiveis) {
  if (destino?.tipo !== 'nova') return null;
  const sel = destino.lojas || [];
  const nomeDe = (slug) => lojasDisponiveis.find((l) => l.slug === slug)?.nome || slug;
  const dentro = sel.map(nomeDe);
  const fora = lojasDisponiveis.filter((l) => !sel.includes(l.slug)).map((l) => l.nome);

  if (!dentro.length) return { texto: 'Nenhuma loja selecionada — não vai subir nada.', fora: null, atencao: true };

  const texto = dentro.length === 1
    ? `Vai criar 1 campanha nova: ${dentro[0]}.`
    : `Vai criar ${dentro.length} campanhas novas: ${listar(dentro)}.`;
  // Aviso só quando há o que dizer (PADRÃO item 9: aviso que aparece sempre vira paisagem).
  const aviso = fora.length ? `${listar(fora)} ${fora.length === 1 ? 'não vai' : 'não vão'} receber campanha.` : null;
  return { texto, fora: aviso, atencao: Boolean(aviso) };
}
