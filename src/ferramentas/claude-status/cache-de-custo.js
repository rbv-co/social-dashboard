// QUANTAS VEZES VALE PERGUNTAR "QUANTO GASTAMOS?" — e por que a resposta não é
// "sempre que a tela piscar".
//
// A BRONCA (dono, 19/08/2026): "sempre que abro a ferramenta demora para
// carregar os dados da OpenAI e fica dizendo que teve erro."
//
// O QUE ESTAVA ACONTECENDO, medido no registro da Supabase em 24h:
//
//   · a tela pedia a fatura QUATRO vezes por minuto: Anthropic e OpenAI, cada
//     uma em duas janelas (o total do topo, sempre 30 dias, e o extrato, no
//     período escolhido). Com a tela aberta o dia inteiro dá 5.760 chamadas —
//     para um número que os dois fornecedores fecham UMA vez por dia;
//   · o total do topo só aparece quando as DUAS respondem, e a `custo-anthropic`
//     levou 7,2s em média, com pior caso de 18,1s. Era essa a demora — a
//     `custo-openai` respondia em 2,1s;
//   · e a `custo-openai` devolveu erro em 3 das 26 chamadas de verdade (11,5%).
//     A cada minuto o dado era pedido de novo, então bastava um tropeço em
//     qualquer rodada para a frase de erro reaparecer na tela.
//
// Quando o período do extrato é 30 dias — que é o padrão com que a tela abre —
// as duas janelas são EXATAMENTE a mesma pergunta, feita duas vezes.
//
// Este arquivo é só a regra de quando reaproveitar, sem rede e sem relógio
// próprio (quem passa o "agora" é quem chama). Fica fora do .vue porque lá
// dentro não teria como ter teste.

// Quanto tempo uma resposta continua valendo. Dez minutos é folgado de um lado e
// curto do outro, de propósito: a OpenAI e a Anthropic consolidam custo por DIA,
// então nada muda em dez minutos; e quem abre a tela de novo depois de um café
// recebe número fresco assim mesmo.
export const VALIDADE_MS = 10 * 60 * 1000;

/** A chave de uma pergunta: fornecedor + janela. Duas perguntas com a mesma
 *  chave são a mesma pergunta — é isso que faz o topo e o extrato, ambos em 30
 *  dias, virarem uma chamada só. */
export function chaveDaBusca(funcao, dias) {
  return `${funcao}:${Number(dias)}`;
}

/** Cria o cache. `agora` é injetado nas funções, nunca lido aqui dentro. */
export function criarCacheDeCusto({ validadeMs = VALIDADE_MS } = {}) {
  const guardado = new Map();

  return {
    /** O que está guardado e ainda vale, ou null. ERRO NUNCA É GUARDADO: se a
     *  chamada falhou, a próxima tentativa tem de ir de verdade — cachear falha
     *  transformaria um tropeço de rede em dez minutos de "deu erro". */
    ler(funcao, dias, agora) {
      const k = chaveDaBusca(funcao, dias);
      const item = guardado.get(k);
      if (!item) return null;
      if (agora - item.quando >= validadeMs) {
        guardado.delete(k); // vencido não fica ocupando lugar
        return null;
      }
      return item.dados;
    },

    /** Guarda uma resposta boa. */
    guardar(funcao, dias, dados, agora) {
      guardado.set(chaveDaBusca(funcao, dias), { dados, quando: agora });
    },

    /** Quantas perguntas distintas estão guardadas. Serve ao teste, e a quem
     *  quiser conferir que o topo e o extrato viraram uma só. */
    get tamanho() {
      return guardado.size;
    },

    /** Joga tudo fora — usado quando alguém pede explicitamente para atualizar. */
    limpar() {
      guardado.clear();
    },
  };
}
