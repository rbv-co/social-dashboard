// AS REGRAS DOS TIMES DE VENDA — o que cada um mostra, o que falta nele, e
// quem pode mexer em quê.
//
// PEDIDO DO DONO (04/08/2026): "preciso que na gestão de usuários eu consiga
// gerir as equipes de lojas e canais de vendas... eu poderei definir quem gere
// cada time de venda, quem pode criar e excluir".
//
// PURO de propósito: aqui não se desenha nada e não se fala com banco. A tela
// pergunta e obedece. Assim as regras de acesso — que são o assunto mais caro
// de errar deste arquivo — podem ser provadas sem navegador.

// ─────────────────────────────────────────────────────────────────────────────
// OS PAPÉIS
//
// A ordem é a da escada: quanto mais embaixo, mais pode. `nivel` existe para
// comparar sem depender da ordem do array.
export const PAPEIS = [
  {
    id: 'vendedora', nivel: 1, rotulo: 'Vendedora',
    explicacao: 'Vê os números do time dela. Não gerencia ninguém.',
  },
  {
    id: 'supervisora', nivel: 2, rotulo: 'Supervisora',
    // Decisão do dono: "o estoque vai ser o nível de supervisora que pode ver,
    // e aí a supervisora pode permitir que outras pessoas visualizem".
    explicacao: 'Vê tudo do time, inclusive o estoque, e pode liberar o estoque para quem ela escolher no time.',
  },
  {
    id: 'gestor', nivel: 3, rotulo: 'Gestor',
    explicacao: 'Administra o time: coloca gente, tira gente e define o papel de cada uma.',
  },
];

export function acharPapel(id) {
  return PAPEIS.find((p) => p.id === id) || null;
}

export function nivelDo(papel) {
  const p = acharPapel(papel);
  return p ? p.nivel : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEM PODE MEXER
//
// A REGRA DE OURO: ninguém concede o que não tem.
//
// Sem ela, uma supervisora se promoveria a gestora e sairia do próprio cerco em
// dois cliques — e o sistema já teve exatamente esse buraco antes (autopromoção
// no cadastro de usuário, tapada com gatilho). Aqui a trava é a mesma ideia:
// ninguém entrega um papel igual ou acima do seu.
export function podeAdministrarTime(eu, papelNoTime) {
  if (!eu) return false;
  if (eu.is_superadmin) return true;
  return nivelDo(papelNoTime) >= nivelDo('gestor');
}

// ⚠️ A SUPERVISORA NÃO SE CONCEDE DENTRO DO TIME (27/08/2026).
//
// Decisão do dono no desenho do canal pai: "a supervisora fica a nível pai,
// gestora e vendedora fica a nível loja". Ela agora mora em
// `canais_grupos_membros`, e o alcance dela é o GRUPO inteiro — oferecê-la
// também aqui daria dois lugares para conceder a mesma coisa, com alcances
// diferentes, e ninguém saberia qual vale.
//
// ELA CONTINUA EM `PAPEIS`, de propósito: o nível dela ainda decide quem vê e
// quem libera o estoque (`veOEstoque`, `podeLiberarEstoque`), e tirá-la da lista
// faria uma supervisora antiga virar nível 0 — perdendo acesso em silêncio.
// Medido em 27/08: ZERO pessoas com papel 'supervisora' em time, então isto não
// tira nada de ninguém hoje. O que muda é só o que a tela OFERECE daqui pra frente.
export const PAPEIS_DO_TIME = PAPEIS.filter((p) => p.id !== 'supervisora');

// Que papéis ESTA pessoa pode conceder neste time.
export function papeisQuePossoConceder(eu, papelNoTime) {
  if (!eu) return [];
  if (eu.is_superadmin) return PAPEIS_DO_TIME.slice();
  if (!podeAdministrarTime(eu, papelNoTime)) return [];
  // Gestor concede até gestor — é o topo da escada do time, e quem administra o
  // time precisa poder passar o bastão sem depender do dono.
  return PAPEIS_DO_TIME.filter((p) => p.nivel <= nivelDo(papelNoTime));
}

// TIRAR-SE DO PRÓPRIO TIME É PERMITIDO, menos para o último gestor: um time sem
// gestor não tem quem coloque gente de volta, e só o dono destravaria. Já vi
// esse fim de caminho em porta de sala: a última pessoa sai e tranca a chave
// dentro.
export function podeRemover(eu, papelNoTime, membro, todosOsMembros) {
  if (!podeAdministrarTime(eu, papelNoTime)) return { pode: false, porque: 'Você não administra este time.' };
  const gestores = (todosOsMembros || []).filter((m) => m.papel === 'gestor');
  if (membro.papel === 'gestor' && gestores.length <= 1 && !(eu && eu.is_superadmin)) {
    return { pode: false, porque: 'É o último gestor do time. Coloque outro antes de tirar este.' };
  }
  return { pode: true, porque: '' };
}

// ─────────────────────────────────────────────────────────────────────────────
// O ESTOQUE É LIBERADO, NÃO HERDADO
//
// Decisão do dono: estar no time deixa a pessoa ver as VENDAS do time; o
// estoque não vem junto. Ou ela supervisiona, ou alguém liberou para ela.
export function veOEstoque(membro, liberacoes) {
  const m = membro || {};
  if (m.papel === 'supervisora' || m.papel === 'gestor') return { ve: true, porque: 'pelo papel' };
  const tem = (liberacoes || []).some(
    (l) => String(l.equipe_id) === String(m.equipe_id)
      && String(l.profile_id) === String(m.profile_id)
      && l.chave === 'estoque',
  );
  return { ve: tem, porque: tem ? 'liberado' : '' };
}

// Quem pode LIBERAR o estoque neste time. Repare que supervisora entra — ela
// não administra o time (não põe nem tira gente), mas o estoque é dela.
export function podeLiberarEstoque(eu, papelNoTime) {
  if (!eu) return false;
  if (eu.is_superadmin) return true;
  return papelNoTime === 'supervisora' || papelNoTime === 'gestor';
}

// ─────────────────────────────────────────────────────────────────────────────
// O QUE FALTA NUM TIME
//
// Time sem canal do Bling é o caso que MAIS confunde: tudo parece certo, a
// pessoa está no time, e o faturamento aparece zerado. O aviso existe para essa
// pergunta não virar um chamado.
export function avisosDoTime(equipe) {
  const e = equipe || {};
  const out = [];
  if (!e.canal_loja_id) {
    out.push({
      grave: true,
      texto: 'Sem canal do Bling: este time não vai mostrar faturamento nenhum. '
        + 'Ligue ao canal correspondente assim que ele existir no Bling.',
    });
  }
  // Depósito é o que responde "estoque desta loja". Sem ele o estoque aparece
  // vazio — e vazio se confunde com "acabou o produto".
  if (!e.deposito_id) {
    out.push({ grave: false, texto: 'Sem depósito ligado: o estoque deste time vai aparecer vazio.' });
  }
  if (e.tipo !== 'canal' && !e.local_id) {
    out.push({ grave: false, texto: 'Sem local do Patrimônio: os bens desta loja não vão aparecer ligados ao time.' });
  }
  if (e.tipo !== 'canal' && !e.setor_id) {
    out.push({ grave: false, texto: 'Sem setor de Colaboradores: as pessoas do RH não vão casar com este time.' });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// A LISTA NA TELA

export function validarTime(dados, outrosTimes) {
  const d = dados || {};
  const nome = String(d.nome || '').trim();
  if (!nome) return 'Dê um nome ao time — é por ele que as pessoas vão reconhecê-lo.';
  const repetido = (outrosTimes || []).some(
    (t) => String(t.id) !== String(d.id) && String(t.nome || '').trim().toLowerCase() === nome.toLowerCase(),
  );
  if (repetido) return `Já existe um time chamado "${nome}".`;
  // UM CANAL, UM TIME. O banco já tem índice único para isto, mas o erro dele
  // chega como "duplicate key value violates unique constraint" — que não diz
  // nada a quem está cadastrando uma loja.
  if (d.canal_loja_id) {
    const dono = (outrosTimes || []).find(
      (t) => String(t.id) !== String(d.id) && String(t.canal_loja_id) === String(d.canal_loja_id),
    );
    if (dono) return `Esse canal do Bling já é do time "${dono.nome}". Um canal pertence a um time só.`;
  }
  return '';
}

// Os canais do Bling ainda livres, para o seletor. Mostrar os já usados só
// levaria ao erro acima.
export function canaisLivres(canais, times, doTimeAtual) {
  const usados = new Set(
    (times || [])
      .filter((t) => String(t.id) !== String(doTimeAtual))
      .map((t) => String(t.canal_loja_id))
      .filter((x) => x && x !== 'null'),
  );
  return (canais || []).filter((c) => !usados.has(String(c.loja_id)));
}

// A linha do time como a tela mostra: nome, o que ele é, e quanta gente tem.
export function linhaDoTime(equipe, membros) {
  const e = equipe || {};
  const meus = (membros || []).filter((m) => String(m.equipe_id) === String(e.id));
  const porPapel = {};
  for (const m of meus) porPapel[m.papel] = (porPapel[m.papel] || 0) + 1;
  const partes = [];
  for (const p of PAPEIS) {
    const n = porPapel[p.id] || 0;
    if (n) partes.push(`${n} ${n === 1 ? p.rotulo.toLowerCase() : p.rotulo.toLowerCase() + 's'}`);
  }
  return {
    id: e.id,
    nome: e.nome,
    tipo: e.tipo,
    ativo: e.ativo !== false,
    quantos: meus.length,
    // "Ninguém ainda" é resposta melhor que uma linha em branco: diz que o time
    // existe e está vazio, que é diferente de a tela não ter carregado.
    quemTem: partes.length ? partes.join(' · ') : 'ninguém ainda',
    avisos: avisosDoTime(e),
  };
}

// Times na ordem em que se lê: ativos primeiro, depois pela ordem definida, e o
// nome desempata. Inativo no meio da lista faz procurar duas vezes.
export function ordenarTimes(times) {
  return (times || []).slice().sort((a, b) => {
    const at = a.ativo === false ? 1 : 0;
    const bt = b.ativo === false ? 1 : 0;
    if (at !== bt) return at - bt;
    const ao = Number(a.ordem) || 0;
    const bo = Number(b.ordem) || 0;
    if (ao !== bo) return ao - bo;
    return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
  });
}
