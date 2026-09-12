// A PERSONA DA MARCA — quem ela atende, escrito pelo dono, por conta de anúncios.
//
// POR QUE EXISTE (pedido do dono, 12/08/2026): "hoje vc sugere idades que não
// casam com a marca". Medido no prompt de `sugerir-publico-ia`: a tela mandava só
// o NOME da conta ("A marca é: Vessel"). Sem saber para quem a marca vende, o
// modelo tirava a faixa etária dos números da própria conta — e número de conta
// diz quem CLICOU, não para quem a marca quer vender. São coisas diferentes, e a
// diferença é justamente o que o dono estava corrigindo na mão toda vez.
//
// PURO: sem rede, sem tela.

// Teto de tamanho. Não é estética: a persona viaja em TODO pedido de sugestão de
// público, então cada caractere é custo recorrente de IA. 4.000 dá umas 600
// palavras — espaço de sobra para descrever um público sem virar um documento.
export const MAXIMO = 4000;

// Corta o excesso e normaliza o espaço em branco, SEM mexer nas quebras de linha
// (o dono escreve em tópicos, e juntar tudo numa linha só destruiria a lista).
export function limparPersona(texto) {
  if (typeof texto !== 'string') return '';
  const t = texto
    .replace(/\r\n?/g, '\n')      // colar do Word/Zoho traz \r\n
    .replace(/[ \t]+\n/g, '\n')   // espaço pendurado no fim da linha
    .replace(/\n{3,}/g, '\n\n')   // mais de uma linha em branco não significa nada
    .trim();
  return t.length > MAXIMO ? t.slice(0, MAXIMO).trim() : t;
}

// O que a tela precisa mostrar embaixo do campo. `restantes` fica negativo de
// propósito quando passou do teto: a tela avisa em vez de cortar em silêncio.
export function resumoPersona(texto) {
  const t = typeof texto === 'string' ? texto : '';
  const caracteres = t.trim().length;
  return {
    vazia: caracteres === 0,
    caracteres,
    restantes: MAXIMO - caracteres,
    excedeu: caracteres > MAXIMO,
  };
}

// A FRASE QUE A TELA DIZ SOBRE O ESTADO DA PERSONA.
//
// Persona vazia NÃO é erro — é o estado de hoje, de todas as contas. Mas a tela
// tem que dizer o que muda por estar vazia, senão o campo parece decorativo.
export function fraseDaPersona(texto, nomeDaConta) {
  const r = resumoPersona(texto);
  const conta = nomeDaConta ? ` de ${nomeDaConta}` : '';
  if (r.vazia) {
    return `Sem persona${conta}, a IA sugere público olhando só os números da conta — ou seja, para quem já clicou, que não é necessariamente para quem você quer vender.`;
  }
  if (r.excedeu) {
    return `Passou ${r.caracteres - MAXIMO} caractere(s) do limite de ${MAXIMO}. O que passar do limite é cortado antes de chegar na IA.`;
  }
  return `A IA vai ler isto antes de sugerir idade, lugar e interesses${conta}, e o que estiver aqui tem precedência sobre o que os números sugerirem.`;
}
