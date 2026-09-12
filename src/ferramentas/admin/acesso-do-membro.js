// O QUE UMA PESSOA DO TIME ENXERGA DE VENDA — em uma frase que ela entenda.
//
// PEDIDO DO DONO (12/08/2026): "quero mexer nas permissões do que essa pessoa
// pode enxergar de canal de venda, e também outras ferramentas... a mesma
// temática da permissão dos usuários mas no time de vendas".
//
// A DECISÃO QUE MANDA AQUI: o canal de venda JÁ É o time. Cada time aponta
// para um `canal_loja_id` do Bling, e a trava do banco (`pode_ver_canal`, em
// db/migrations/2026-08-04-escopo-em-vendas-e-estoque.sql) responde
// exatamente esta pergunta: "este canal é de algum time meu?". Uma segunda
// lista de canais por pessoa seria uma SEGUNDA verdade sobre a mesma pergunta
// — e duas telas de permissão que divergem é a pior classe de defeito que
// este sistema já teve.
//
// Então este arquivo NÃO decide nada novo. Ele só traduz, para quem está
// olhando a tela, o que a trava do banco já faz — e mostra a única chave que
// existe de verdade: `profiles.escopo_por_equipe`.
//
// PURO de propósito: nada de DOM, nada de banco. As frases de acesso são o
// que o dono lê antes de clicar, e frase errada aqui vira decisão errada lá.

// ─────────────────────────────────────────────────────────────────────────────
// OS TIMES DA PESSOA

// Os times em que a pessoa está, na ordem em que os times vierem.
// Devolve o TIME inteiro (não só o id) porque quem chama quer o nome e o canal.
export function timesDaPessoa(profileId, times, membros) {
  if (!profileId) return [];
  const meus = new Set(
    (membros || [])
      .filter((m) => String(m.profile_id) === String(profileId))
      .map((m) => String(m.equipe_id)),
  );
  return (times || []).filter((t) => meus.has(String(t.id)));
}

// ─────────────────────────────────────────────────────────────────────────────
// A FRASE DO ACESSO ÀS VENDAS
//
// `escopo_por_equipe` é a chave, e ela é do PERFIL, não do time: vale para o
// sistema inteiro da pessoa. Por isso a frase precisa dizer isso com todas as
// letras — mexer nela dentro de um time muda o que ela vê em TODOS.
//
// Repare que `false` (não está limitada) é o estado ABERTO: os 17 logins que já
// existiam em 04/08/2026 foram marcados `false` para nada mudar naquele dia, e
// quem nasce depois nasce `true` (fechado). Ler ao contrário inverte a frase
// inteira, então o default aqui é o FECHADO — errar para o lado de dizer
// "limitada" é o erro barato.
export function oQueVeDeVendas({ pessoa, times, membros, canais }) {
  const p = pessoa || {};
  // `!== false` e não `=== true`: coluna ausente no select (ou nula) não pode
  // virar "vê tudo" por omissão.
  const presa = p.escopo_por_equipe !== false;
  const meusTimes = timesDaPessoa(p.id, times, membros);
  const nomeDoCanal = (id) => {
    const c = (canais || []).find((x) => String(x.loja_id) === String(id));
    return c ? c.nome : null;
  };

  const comCanal = meusTimes
    .filter((t) => t.canal_loja_id)
    .map((t) => ({ time: t.nome, canal: nomeDoCanal(t.canal_loja_id) || ('canal ' + t.canal_loja_id) }));
  const semCanal = meusTimes.filter((t) => !t.canal_loja_id).map((t) => t.nome);

  const base = { presa, itens: comCanal, semCanal, times: meusTimes };

  if (!presa) {
    return {
      ...base,
      grave: false,
      frase: 'Vê as vendas de TODOS os canais — ela não está limitada aos times dela.',
    };
  }
  if (!meusTimes.length) {
    return {
      ...base,
      grave: true,
      frase: 'Não vê venda nenhuma: está limitada aos times dela, e não está em time nenhum.',
    };
  }
  if (!comCanal.length) {
    return {
      ...base,
      grave: true,
      frase: 'Não vê venda nenhuma: ' + (semCanal.length === 1 ? 'o time ' : 'os times ')
        + semCanal.join(', ') + (semCanal.length === 1 ? ' não tem' : ' não têm')
        + ' canal do Bling ligado.',
    };
  }
  let frase = 'Vê as vendas de: '
    + comCanal.map((i) => i.canal + ' (time ' + i.time + ')').join(' · ') + '.';
  if (semCanal.length) {
    frase += ' ' + (semCanal.length === 1 ? 'O time ' : 'Os times ') + semCanal.join(', ')
      + (semCanal.length === 1 ? ' não tem' : ' não têm')
      + ' canal do Bling ligado, então não traz faturamento nenhum.';
  }
  return { ...base, grave: false, frase };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEM PODE MEXER NA CHAVE DO ESCOPO
//
// SÓ O DONO. E não é excesso de zelo: desligar `escopo_por_equipe` de alguém
// abre TODOS os canais para ela, inclusive os de times que quem está clicando
// não administra. Um gestor de loja poderia, num clique, dar a uma vendedora
// dele o faturamento das outras lojas — que é exatamente a regra de ouro dos
// times ao contrário ("ninguém concede o que não tem", equipes.js).
//
// Para os outros a chave aparece na tela, escrita, mas não clicável: esconder
// faria a pessoa achar que a limitação não existe.
export function podeMudarEscopo(eu) {
  return !!(eu && eu.is_superadmin);
}

// A explicação do que aquele clique vai fazer, para ir no confirmar. Nunca
// "tem certeza?" sozinho: a pergunta precisa dizer o tamanho do estrago.
export function avisoDaMudancaDeEscopo({ pessoa, ligar, times, membros }) {
  const nome = (pessoa && (pessoa.name || pessoa.email)) || 'esta pessoa';
  const meus = timesDaPessoa(pessoa && pessoa.id, times, membros);
  if (ligar) {
    return meus.length
      ? nome + ' passa a ver SOMENTE as vendas dos times dela ('
        + meus.map((t) => t.nome).join(', ') + '). Tudo o mais some da tela dela.'
      : nome + ' passa a ver SOMENTE as vendas dos times dela — e ela não está em '
        + 'time nenhum, então vai ficar sem ver venda alguma.';
  }
  return nome + ' passa a ver as vendas de TODOS os canais, inclusive os de times '
    + 'que ela não faz parte. Isto vale no sistema inteiro, não só neste time.';
}
