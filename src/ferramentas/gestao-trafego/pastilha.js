/* A PASTILHA DO BLOCO (Onda 4a, 23/09/2026) — o ícone numa pastilha cheia do
 * tom do bloco, o mesmo desenho que `src/compartilhado/icone-do-bloco.vue` dá
 * às telas feitas em <template>.
 *
 * POR QUE UMA CÓPIA EM TEXTO: quase tudo nesta ferramenta é montado por
 * innerHTML (o porte fiel do legado), e ali um componente Vue não existe. Os
 * traços abaixo são os MESMOS de icone-do-bloco.vue — se um mudar lá, mude
 * aqui. Só o desenho: a cor vem da folha da tela (`--bloco` no fundo,
 * `--sobre-cor` no traço), nunca daqui.
 *
 * `aria-hidden`: a pastilha é enfeite do título que vem logo depois dela; o
 * leitor de tela lê o título, não o ícone. Puro: sem DOM, sem estado. */

const DESENHOS = {
  lista: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  funil: '<rect x="3" y="4" width="5" height="15" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="6" rx="1"/>',
  placar: '<path d="M3 21h18"/><path d="M6 17v-6"/><path d="M11 17V6"/><path d="M16 17v-9"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  parceiras: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14.5c2 .8 3 2.8 3 5.5"/>',
  contato: '<path d="M4 5h16v11H9l-5 4V5z"/>',
  pessoa: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>',
  leitura: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
  venda: '<path d="M5 8h14l-1 13H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
};

/** O HTML da pastilha, ou '' para um nome que não existe (nunca uma caixa vazia). */
export function pastilha(nome) {
  const d = DESENHOS[nome];
  if (!d) return '';
  return `<span class="gt-pastilha" aria-hidden="true"><svg class="id-icone" viewBox="0 0 24 24" focusable="false">${d}</svg></span>`;
}

export const NOMES_DE_PASTILHA = Object.freeze(Object.keys(DESENHOS));
