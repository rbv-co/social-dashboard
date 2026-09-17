/* QUEM PODE CHAMAR UM ROBÔ — a decisão, separada do encanamento.
 *
 * POR QUE ESTE ARQUIVO EXISTE: a autorização mora numa função `.ts` que fala com
 * a rede e com o ambiente do Deno, e isso não se prova num teste de `node`. As
 * REGRAS, que são a parte que pode estar errada, não precisam de rede nenhuma —
 * então elas vivem aqui, puras, e o `.ts` só liga os fios.
 *
 * AS QUATRO REGRAS, e a medição que gerou cada uma:
 *
 * 1. SEM `Bearer`, NÃO ENTRA. Nunca chega a olhar segredo.
 *
 * 2. BATEU COM O QUE ESTÁ NA MEMÓRIA, ENTRA. É o caminho da maioria das
 *    chamadas, e ele não toca o banco — que é o ponto: em 12/09/2026, de cada
 *    ~20 rodadas do espelho da Vessel, 2 a 4 morriam com 401 porque a leitura do
 *    segredo voltava 504 na virada do minuto, quando vários cron disparam
 *    juntos. O mesmo 504 apareceu no `conteudo-espelho` um minuto depois: não é
 *    de um robô, é da casa.
 *
 * 3. NÃO BATEU COM A MEMÓRIA, LÊ O BANCO ANTES DE NEGAR — e descarta a memória.
 *    ⚠️ Esta é a regra que salva o DIA DA ROTAÇÃO. Sem ela, trocar o segredo
 *    derrubaria todos os robôs por até o tempo da memória, e o defeito só
 *    apareceria no dia da troca — o pior dia para descobrir.
 *
 * 4. LEU O BANCO E NÃO BATEU (ou não há segredo), NEGA. Fail-closed de verdade:
 *    é para isso que ela serve, e continua intacta. O que mudou é que "não
 *    consegui ler" deixou de ser tratado como "está errado" — quem trata disso é
 *    a repetição, em `tentar-de-novo.js`.
 */

/** Comparação em tempo constante: não vaza o segredo pelo relógio. */
export function igualTempoConstante(a, b) {
  const ea = new TextEncoder().encode(String(a ?? ''));
  const eb = new TextEncoder().encode(String(b ?? ''));
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** O valor que o cabeçalho tem de ter para um dado segredo. */
export const cabecalhoEsperado = (segredo) => `Bearer ${segredo}`;

/**
 * A decisão.
 *
 * @param auth             o cabeçalho `Authorization` recebido (ou vazio)
 * @param segredoNaMemoria o que este isolate guardou, ou null se não guardou/venceu
 * @param segredoDoBanco   `undefined` = ainda não foi lido; `null` = leu e não há
 * @returns {{acao: 'negar'|'autorizar'|'ler-o-banco', descartarMemoria?: boolean, porque: string}}
 */
export function decidirAutorizacao({ auth = '', segredoNaMemoria = null, segredoDoBanco = undefined } = {}) {
  if (!String(auth).startsWith('Bearer ')) {
    return { acao: 'negar', porque: 'sem cabecalho Bearer' };
  }

  if (segredoDoBanco === undefined) {
    if (segredoNaMemoria && igualTempoConstante(auth, cabecalhoEsperado(segredoNaMemoria))) {
      return { acao: 'autorizar', porque: 'bateu com a memoria' };
    }
    return {
      acao: 'ler-o-banco',
      // Só descarta o que EXISTIA e não bateu — pode ser segredo trocado.
      descartarMemoria: Boolean(segredoNaMemoria),
      porque: segredoNaMemoria ? 'nao bateu com a memoria' : 'memoria vazia ou vencida',
    };
  }

  if (!segredoDoBanco) return { acao: 'negar', porque: 'sem segredo cadastrado ou leitura falhou' };
  if (!igualTempoConstante(auth, cabecalhoEsperado(segredoDoBanco))) {
    return { acao: 'negar', porque: 'segredo errado' };
  }
  return { acao: 'autorizar', porque: 'bateu com o banco' };
}
