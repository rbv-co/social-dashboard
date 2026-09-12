/* O CHECKLIST DE PRIMEIRO ESCALÃO — o que o dia de hoje pede.
 *
 * Fonte: checklist_manutencao_primeiro_escalao.pdf, 21 itens numa lista só,
 * "antes de cada utilização". Aqui eles se repartem em diário, semanal e
 * mensal, porque um checklist de 21 itens toda manhã produz, em duas semanas,
 * alguém marcando tudo OK sem olhar — e checklist que mente é pior do que
 * checklist nenhum.
 *
 * TUDO EM UTC. As datas são texto 'YYYY-MM-DD'. Usar o fuso da máquina faria a
 * data virar no horário errado e a conferência de sexta cair no sábado.
 *
 * Mora no _shared (não em src/) porque a Edge Function do robô da manhã (uma
 * tarefa futura) roda em Deno e não alcança src/ — só o front alcança o
 * _shared. Um arquivo, dois consumidores, pra não haver duas verdades sobre
 * que dia pede o quê. */

import { quemEstaComOCarro } from './posse.js';

export const CADENCIAS = ['diario', 'semanal', 'mensal'];

const num = (iso, de, ate) => Number(String(iso).slice(de, ate));
const utc = (iso) => Date.UTC(num(iso, 0, 4), num(iso, 5, 7) - 1, num(iso, 8, 10));

/** 1 = segunda … 7 = domingo. */
export function diaDaSemana(iso) {
  const n = new Date(utc(iso)).getUTCDay(); // 0 = domingo
  return n === 0 ? 7 : n;
}

/** Quantos dias de `a` até `b`. Negativo se `b` for antes. */
export function diasEntre(a, b) {
  return Math.round((utc(b) - utc(a)) / 86400000);
}

/** É o dia em que o mensal cai? Ex.: a 1ª quarta-feira do mês. */
export function ehDiaDoMensal(iso, config) {
  if (diaDaSemana(iso) !== config.dia_mensal) return false;
  // Qual ocorrência daquele dia da semana este é: dia 1 a 7 é a 1ª, 8 a 14 a 2ª.
  const ocorrencia = Math.floor((num(iso, 8, 10) - 1) / 7) + 1;
  return ocorrencia === config.semana_mensal;
}

/* NUNCA FEITO NÃO É ATRASADO. Se fosse, o primeiro dia da funcionalidade
 * jogaria os 21 itens na cara de todo mundo — exatamente o dia pesado que o
 * dono não quis. Sem histórico, espera o dia próprio chegar. */
export function semanalAtrasado(hoje, ultimaSemanal) {
  return !!ultimaSemanal && diasEntre(ultimaSemanal, hoje) > 7;
}
export function mensalAtrasado(hoje, ultimaMensal) {
  return !!ultimaMensal && diasEntre(ultimaMensal, hoje) > 31;
}

/**
 * Quais cadências a ficha de hoje pede.
 * Fim de semana devolve vazio. Dia útil sempre tem o diário; semanal e mensal
 * entram no dia próprio (D11) ou quando estão atrasados — e entram UMA vez,
 * nunca duas: semana pulada vira uma conferência, não duas.
 */
export function cadenciasDoDia({ hoje, config, ultimaSemanal, ultimaMensal, pegandoAgora }) {
  // O diário é seg-sex, mas quem pega um carro de rodízio no fim de semana
  // está prestes a dirigir do mesmo jeito. O papel manda conferir ANTES DA
  // UTILIZAÇÃO, e isso não tem dia — só o diário entra, nunca semanal/mensal
  // (esses têm dia próprio, e fim de semana nunca é esse dia).
  if (diaDaSemana(hoje) > 5) return pegandoAgora ? ['diario'] : [];
  const c = ['diario'];
  if (diaDaSemana(hoje) === config.dia_semanal || semanalAtrasado(hoje, ultimaSemanal)) {
    c.push('semanal');
  }
  if (ehDiaDoMensal(hoje, config) || mensalAtrasado(hoje, ultimaMensal)) {
    c.push('mensal');
  }
  return c;
}

/**
 * Este carro precisa de checklist agora?
 *
 * Vale para quem pega um carro de rodízio. Independe do dia da semana: o papel
 * manda conferir ANTES DA UTILIZAÇÃO, e quem pega um carro no sábado está
 * prestes a dirigir do mesmo jeito. O que o calendário decide é o que a ficha
 * PERGUNTA (cadenciasDoDia); no fim de semana, só o diário.
 */
export function precisaDeChecklist({ veiculoId, fichas, hoje }) {
  return !(fichas || []).some((f) => f && f.veiculo_id === veiculoId && f.feita_em === hoje);
}

/**
 * O QUE PEDIR A QUEM ESTÁ PEGANDO O CARRO AGORA.
 *
 * Desenho: docs/superpowers/specs/2026-08-13-frota-gestao-reservas-design.md
 *
 * POR QUE ESTA FUNÇÃO EXISTE, e o que ela conserta. `precisaDeChecklist` acima
 * olha só CARRO e DIA. A consequência, medida no banco em 13/08/2026: das 5
 * retiradas reais, nenhuma tinha a assinatura de quem pegou o carro. No único
 * dia em que houve ficha assinada, quem assinou foi Erick Martins às 7h30 e
 * quem pegou o carro foi Breno às 17h49 — e como o carro "já tinha checklist
 * hoje", a tela não pediu nada a ele.
 *
 * São duas frases diferentes, e é por isso que uma não cobre a outra:
 *   o checklist diz  "o carro estava assim neste dia, e fulano viu";
 *   a retirada diz   "eu, fulano, recebi este carro assim e respondo por ele".
 *
 * A REGRA PASSA A SER POR PESSOA, e não por carro:
 *
 *   ninguém conferiu hoje      → o checklist inteiro, assinado (como já era)
 *   quem está pegando conferiu → nada. Ninguém confere o mesmo carro 2x no dia
 *   conferiu OUTRA pessoa      → o aceite: uma linha curta, assinada
 *   conferiram e não assinaram → o aceite também. A conferência valeu; o que
 *                                falta é a prova, e o aceite é ela.
 *
 * NÃO EXISTE "assinar duas vezes": `frota_checklist` tem `unique (veiculo_id,
 * feita_em)`, um checklist por carro por dia, de propósito. O aceite mora na
 * viagem (`frota_uso`), não numa segunda ficha — continua sendo uma assinatura
 * por viagem, e nenhum PDF a mais. Foi assim que o dono aprovou.
 */
export function oQuePedirNaRetirada({ veiculoId, fichas, hoje, pessoaId, pessoaNome }) {
  const ficha = (fichas || []).find((f) => f && f.veiculo_id === veiculoId && f.feita_em === hoje) || null;

  if (!ficha) return { pedir: 'checklist', porque: 'sem-ficha', ficha: null, quemConferiu: null };

  const nome = (s) => String(s ?? '').trim().toLowerCase();
  const mesmaPessoa = (pessoaId && ficha.pessoa_id && pessoaId === ficha.pessoa_id)
    // O nome só decide quando os DOIS têm nome escrito: dois vazios não são a
    // mesma pessoa, são duas ausências — e tratá-los como iguais dispensaria a
    // assinatura de quem pega justamente nos casos sem cadastro.
    || (!!nome(pessoaNome) && nome(pessoaNome) === nome(ficha.pessoa_nome));

  if (!ficha.assinada_em) {
    return { pedir: 'aceite', porque: 'ficha-sem-assinatura', ficha, quemConferiu: ficha.pessoa_nome || null };
  }
  if (mesmaPessoa) {
    return { pedir: 'nada', porque: 'ja-assinou', ficha, quemConferiu: ficha.pessoa_nome || null };
  }
  return { pedir: 'aceite', porque: 'assinou-outra', ficha, quemConferiu: ficha.pessoa_nome || null };
}

/** A frase que a ficha de retirada mostra em cima do campo de assinar. */
export function porQuePedirOAceite(porque, quemConferiu) {
  const quem = String(quemConferiu ?? '').trim();
  switch (porque) {
    case 'assinou-outra':
      return `${quem || 'Outra pessoa'} já conferiu este carro hoje e assinou. `
        + 'Você não precisa conferir de novo — só assinar que está recebendo o carro assim.';
    case 'ficha-sem-assinatura':
      return 'Este carro já foi conferido hoje, mas a ficha ficou sem assinatura. '
        + 'Assine que está recebendo o carro no estado registrado.';
    default:
      return '';
  }
}

/* ── O que entra na ficha ─────────────────────────────────────────────────── */

/** Os itens ativos das cadências pedidas, na ordem que o gestor definiu. */
export function itensDaFicha(itens, cadencias) {
  const quer = new Set(cadencias || []);
  return (itens || [])
    .filter((i) => i && i.ativo !== false && quer.has(i.cadencia))
    .slice()
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
}

/* ── O hodômetro ──────────────────────────────────────────────────────────── */

// Mesmo limiar de problemasDaDevolucao() em estado-do-veiculo.js: 5.000 km numa
// tacada é quase sempre dedo errado, mas viagem longa existe — por isso pede
// confirmação em vez de barrar.
const SALTO_SUSPEITO = 5000;
const km = (n) => Math.abs(n).toLocaleString('pt-BR');

/**
 * O número do painel vale? Devolve { ok, precisaJustificar, motivo }.
 *
 * `precisaJustificar` distingue as duas recusas: número em branco só se
 * corrige, mas número que contraria o histórico pode estar certo (painel
 * trocado, odômetro adulterado pelo dono anterior) e aí a pessoa explica.
 */
export function hodometroAceito(novo, ultimoConhecido) {
  if (!Number.isInteger(novo) || novo <= 0) {
    return { ok: false, precisaJustificar: false,
      motivo: 'Informe o número que está no painel agora.' };
  }
  if (!Number.isInteger(ultimoConhecido)) {
    return { ok: true, precisaJustificar: false, motivo: '' };
  }
  if (novo < ultimoConhecido) {
    return { ok: false, precisaJustificar: true,
      motivo: `O último registro deste carro era ${km(ultimoConhecido)} km, e o odômetro não `
        + 'anda para trás. Confira o número — ou explique o que aconteceu.' };
  }
  if (novo - ultimoConhecido > SALTO_SUSPEITO) {
    return { ok: false, precisaJustificar: true,
      motivo: `São ${km(novo - ultimoConhecido)} km desde o último registro. `
        + 'Confirme se está certo, ou explique.' };
  }
  return { ok: true, precisaJustificar: false, motivo: '' };
}

// Justificativa tem de ser uma frase, não um resmungo: "ok" e "sei la" não
// explicam nada pra quem for ler isso daqui a seis meses.
const JUSTIFICATIVA_MINIMA = 10;

/**
 * Valida a ficha ANTES de gravar. Lista vazia significa que pode gravar.
 * `respostas` é { [itemId]: 'ok' | 'nao_ok' | 'na' }.
 */
export function problemasDaFicha({ hodometro, ultimoKm, justificativa, respostas, itens }) {
  const p = [];
  const h = hodometroAceito(hodometro, ultimoKm);
  const explicou = String(justificativa || '').trim().length >= JUSTIFICATIVA_MINIMA;
  if (!h.ok && !(h.precisaJustificar && explicou)) p.push(h.motivo);

  const r = respostas || {};
  const faltando = (itens || []).filter((i) => !r[i.id]);
  if (faltando.length === 1) p.push(`Falta responder "${faltando[0].item}".`);
  else if (faltando.length > 1) p.push(`Faltam ${faltando.length} itens sem resposta.`);
  return p;
}

/* ── A cobrança (D16) ─────────────────────────────────────────────────────── */

/**
 * Quem fez e quem não fez o checklist hoje.
 *
 * Só entra carro COM DONO FIXO e ativo: carro de rodízio não tem de quem
 * cobrar (a ficha dele acontece quando alguém pega), e cobrar dele acusaria
 * todo dia um carro que ninguém usou — o quadro viraria ruído e ninguém
 * olharia mais.
 *
 * `usos` é OPCIONAL (D9b). Sem ele, o comportamento é IDÊNTICO ao de antes —
 * o dono fixo é sempre quem responde. Com ele, quem está com o carro
 * emprestado (posse aberta) é quem é cobrado, e não o dono no papel: enquanto
 * o Marcus emprestou o carro pra Barbara, é a Barbara quem tem que preencher
 * a ficha, não ele.
 *
 * `hoje` também é OPCIONAL, e pela mesma razão: as chamadas que já existem não
 * passam data nenhuma, e mudá-las de uma vez trocaria um defeito por outro.
 * Quem passa a data ganha a regra do calendário — sábado e domingo não cobram
 * ninguém, porque o checklist diário é de dia útil (cadenciasDoDia devolve
 * vazio no fim de semana, e o robô da manhã já respeitava isso). Sem a data,
 * o quadro acusava "7 carros ainda sem checklist hoje" num domingo em que
 * ninguém deve nada — exatamente o ruído que este comentário diz não poder
 * existir, e que faz as pessoas pararem de olhar o quadro.
 */
export function quemFaltaHoje({ veiculos, fichasDeHoje, pessoas, usos, hoje }) {
  if (hoje && diaDaSemana(hoje) > 5) return [];
  const comFicha = new Set((fichasDeHoje || []).map((f) => f && f.veiculo_id));
  return (veiculos || [])
    .filter((v) => v && v.pessoa_id && v.situacao === 'ativo')
    .map((v) => {
      const quem = usos ? quemEstaComOCarro(v, usos) : null;
      const donoId = (quem && quem.pessoaId) || v.pessoa_id;
      const dono = (pessoas || []).find((p) => p && p.id === donoId);
      return { veiculo: v, donoId, dono: dono ? dono.nome : null,
        fez: comFicha.has(v.id) };
    })
    .sort((a, b) => (a.fez === b.fez
      ? String(a.veiculo.nome || '').localeCompare(String(b.veiculo.nome || ''))
      : (a.fez ? 1 : -1)));
}

/* ── O editor da lista ────────────────────────────────────────────────────── */

/**
 * Valida um item da lista antes de gravar. Espelha problemasDoItem() do plano
 * de revisão — o gestor mexe nas duas listas e merece a mesma reação.
 */
export function problemasDoItemDeChecklist({ item, cadencia, existentes, idAtual }) {
  const p = [];
  const nome = String(item || '').trim();
  if (!nome) p.push('Dê um nome ao item. Ex.: "Filtro de ar".');
  else if (nome.length < 3) p.push('O nome está curto demais para alguém entender depois.');

  if (!CADENCIAS.includes(cadencia)) {
    p.push('Escolha se o item é conferido todo dia, toda semana ou todo mês.');
  }
  const repetido = (existentes || []).some((e) =>
    e && e.id !== idAtual && String(e.item || '').trim().toLowerCase() === nome.toLowerCase());
  if (nome && repetido) {
    p.push(`Já existe um item chamado "${nome}". Edite o que existe em vez de criar outro igual — `
      + 'dois iguais dariam duas perguntas repetidas na mesma ficha.');
  }
  return p;
}

/* ── O detalhe do dia (V2 do quadro D16) ──────────────────────────────────── */

/**
 * O telefone que a cobrança usa pra chamar no WhatsApp: corporativo primeiro,
 * pessoal se não tiver — a mesma coluna que o cadastro de Colaboradores e
 * Acessos já guarda, sem inventar campo novo. Devolve null (nunca string
 * vazia) pra já entrar pronto em linkDoWhatsapp()/porQueNaoDaLink(), que
 * tratam nulo e vazio do mesmo jeito.
 */
export function telefoneDaCobranca(pessoa) {
  if (!pessoa) return null;
  return pessoa.numero_corporativo || pessoa.numero_pessoal || null;
}

/**
 * Os itens marcados "Problema" nas fichas de HOJE, de todos os carros, num
 * lugar só — pra não precisar abrir carro por carro pra descobrir o que está
 * pendente (pedido do dono).
 *
 * `fichasDeHoje` decide o QUE conta como hoje (a mesma lista que
 * quemFaltaHoje já recebe); `respostas` pode trazer resposta de qualquer
 * ficha — a função filtra sozinha pelas que pertencem a uma ficha de hoje,
 * então quem chama não precisa acertar o corte antes.
 */
export function problemasAbertosHoje({ fichasDeHoje, respostas, veiculos }) {
  const fichaPorId = new Map((fichasDeHoje || []).filter(Boolean).map((f) => [f.id, f]));
  const veiculoPorId = new Map((veiculos || []).filter(Boolean).map((v) => [v.id, v]));
  return (respostas || [])
    .filter((r) => r && r.estado === 'nao_ok' && fichaPorId.has(r.checklist_id))
    .map((r) => {
      const ficha = fichaPorId.get(r.checklist_id);
      const veiculo = veiculoPorId.get(ficha.veiculo_id);
      return {
        veiculoId: ficha.veiculo_id,
        veiculoNome: veiculo ? veiculo.nome : 'Veículo removido',
        item: r.item_texto,
        observacao: r.observacao || '',
      };
    })
    .sort((a, b) => a.veiculoNome.localeCompare(b.veiculoNome) || a.item.localeCompare(b.item));
}

/** A frase do topo do quadro. Nunca diz "tudo certo" sobre o que não sabe.
 *
 * `hoje` é OPCIONAL. Com a data, o fim de semana tem frase própria: sem ela a
 * lista vazia de sábado cairia em "Nenhum carro com dono fixo cadastrado.",
 * que é mentira — os carros estão lá, é o dia que não cobra. */
export function resumoDaCobranca(linhas, hoje) {
  if (hoje && diaDaSemana(hoje) > 5) {
    return 'Hoje é fim de semana: o checklist é de dia útil, ninguém deve nada.';
  }
  const l = linhas || [];
  if (!l.length) return 'Nenhum carro com dono fixo cadastrado.';
  const faltam = l.filter((x) => !x.fez).length;
  if (!faltam) return 'Todos os carros com dono já foram conferidos hoje.';
  return faltam === 1
    ? '1 carro ainda sem checklist hoje.'
    : `${faltam} carros ainda sem checklist hoje.`;
}

/* ── Por quais carros esta pessoa pode preencher (D21b) ───────────────────── */

/**
 * Por quais carros esta pessoa pode preencher o checklist hoje.
 *
 * Quem só dirige: o próprio carro. Quem administra: todos os ativos — e é o
 * que destrava o problema dos motoristas sem login (Barbara, Marcus e Thiago),
 * cujo carro ficaria eternamente sem ficha nenhuma.
 *
 * O carro da própria pessoa vem PRIMEIRO: é o que ela provavelmente veio fazer,
 * e obrigá-la a procurar o dela no meio de nove seria trocar um problema por
 * outro.
 *
 * `donoId` é o DONO NO CADASTRO, e vai junto pra tela poder dizer por quem se
 * está preenchendo — quem administra precisa saber que aquele Punto é do
 * Marcus. Repare que ele NÃO muda quando o carro está emprestado: de quem o
 * carro É e quem está COM ele são perguntas diferentes, e responder uma com a
 * outra faria a tela dizer que o carro é de quem pegou emprestado.
 *
 * `quemEstaCom` é opcional e decide só o `meu` (D9b): enquanto o carro está
 * emprestado, quem confere é quem está com ele. Sem essa função, "meu" é o
 * dono no cadastro — que é o certo quando não se sabe da posse. Sem ela a tela
 * teria um buraco: o quadro de cobrança JÁ olha a posse, então cobraria de
 * quem pegou emprestado uma ficha que o cartão não deixava preencher.
 */
export function veiculosParaConferir({ veiculos, euId, ehGestor, fichas, hoje, quemEstaCom, emViagem }) {
  const dono = typeof quemEstaCom === 'function' ? quemEstaCom : (v) => v.pessoa_id;
  return (veiculos || [])
    .filter((v) => v && v.situacao === 'ativo')
    // A mesma pergunta que o resto da ferramenta já faz — reaproveitada, e não
    // reescrita: duas contas de "precisa de checklist" divergem com o tempo.
    .filter((v) => precisaDeChecklist({ veiculoId: v.id, fichas, hoje }))
    .map((v) => ({
      veiculo: v,
      donoId: v.pessoa_id || null,
      // `euId &&` é obrigatório: sem ele, um carro de rodízio (`pessoa_id`
      // nulo) visto por quem não foi achado no cadastro (`euId` nulo) daria
      // `null === null` e abriria sozinho como se fosse o carro da pessoa.
      meu: !!(euId && dono(v) === euId),
      // Está com a pessoa por VIAGEM aberta — não por posse nem no papel.
      naMinhaMao: !!(euId && typeof emViagem === 'function' && emViagem(v) === euId),
    }))
    .filter((x) => ehGestor || x.meu)
    /* A ORDEM: o carro que está na mão da pessoa AGORA vem primeiro, depois o
     * resto dos dela, depois os dos outros (quando é gestor).
     *
     * `naMinhaMao` entrou em 21/08/2026: quem tem carro fixo E pegou um de
     * rodízio via os dois como "meus", e o desempate era alfabético — abria
     * sozinho o FIAT TORO enquanto a pessoa estava de pé ao lado da SAVEIRO
     * que acabou de retirar. O que ela veio conferir é o que está com ela. */
    .sort((a, b) => {
      if (a.meu !== b.meu) return a.meu ? -1 : 1;
      if (a.naMinhaMao !== b.naMinhaMao) return a.naMinhaMao ? -1 : 1;
      return String(a.veiculo.nome || '').localeCompare(String(b.veiculo.nome || ''));
    });
}

/**
 * O RESULTADO da ficha, deduzido dos itens conferidos. Não se escolhe.
 *
 * Até 12/08/2026 a pessoa que conferia podia trocar o resultado a dedo (D14: "a
 * palavra final continua sendo dela"). O dono derrubou, e a razão é o pior
 * desfecho que a regra antiga permitia: marcar LIBERADO com vazamento embaixo
 * do carro, e a ficha assinada registrar isso como verdade. Num histórico que
 * serve pra responder por multa e por acidente, o resultado não pode depender
 * da pressa de quem está com a chave na mão.
 *
 * Três desfechos:
 *  - 'nao_liberado'  → algum item marcado como problema tem `impede_uso`. O
 *                      carro não sai.
 *  - 'com_ressalvas' → há problema, mas nenhum que impeça rodar.
 *  - 'liberado'      → nenhum problema.
 *
 * QUAIS ITENS IMPEDEM O USO É DECISÃO DO DONO, não do código: vem de
 * `frota_checklist_itens.impede_uso`, editável na aba Plano. Item que o
 * `itens` não conhece conta como "não impede" — inventar gravidade sobre um
 * item que ninguém classificou seria pior que a ressalva.
 */
export function resultadoDoChecklist(respostas, itens) {
  const problemas = (respostas || []).filter((r) => r && r.estado === 'nao_ok');
  if (!problemas.length) return 'liberado';

  const bloqueia = new Set(
    (itens || []).filter((i) => i && i.impede_uso).map((i) => String(i.item || '').trim()),
  );
  const grave = problemas.some((r) => bloqueia.has(String(r.item_texto || r.item || '').trim()));
  return grave ? 'nao_liberado' : 'com_ressalvas';
}

/**
 * Os itens que produziram o resultado, pra tela poder DIZER o porquê.
 * "Não liberado" sozinho não ajuda ninguém a resolver; "Não liberado —
 * vazamento sob o veículo" manda a pessoa direto pra oficina.
 */
export function porQueDoResultado(respostas, itens) {
  const problemas = (respostas || []).filter((r) => r && r.estado === 'nao_ok');
  const bloqueia = new Set(
    (itens || []).filter((i) => i && i.impede_uso).map((i) => String(i.item || '').trim()),
  );
  const nome = (r) => String(r.item_texto || r.item || '').trim();
  const graves = problemas.filter((r) => bloqueia.has(nome(r))).map(nome);
  const leves = problemas.filter((r) => !bloqueia.has(nome(r))).map(nome);
  return { graves, leves };
}

/**
 * O fim da frase "Pela sua reserva de ..., para ...". Aqui só falta ___.
 *
 * Era texto fixo — "o checklist e o combustível" — e mentia na tela em que
 * outra pessoa já tinha conferido o carro: ali não há checklist nenhum para
 * fazer, só a assinatura de quem está recebendo. A pessoa procurava na ficha
 * uma coisa que não estava lá.
 *
 * Recebe o `pedir` de oQuePedirNaRetirada(), e nunca devolve vazio.
 */
export function oQueFaltaNaRetirada(pedir) {
  switch (pedir) {
    case 'checklist': return 'Aqui só falta o checklist e o combustível.';
    case 'aceite': return 'Aqui só falta assinar que está recebendo o carro, e o combustível.';
    default: return 'Aqui só falta o combustível.';
  }
}

/**
 * O CHECKLIST DE HOJE, INTEIRO: o que falta e o que já foi feito, num quadro só.
 *
 * `quemFaltaHoje` responde a outra pergunta — "de quem eu cobro hoje?" — e por
 * isso olha só carro com dono fixo, e devolve vazio no fim de semana. Esta aqui
 * responde "o que aconteceu de checklist hoje, na frota toda", e é o que o
 * quadro da Gestão passa a mostrar.
 *
 * O BURACO QUE ELA FECHA (medido em 21/08/2026): o dono retirou a Bravo
 * Blackmotion, um carro de rodízio, e o quadro não mostrava esse carro pra
 * ninguém — nem como pendente, nem como feito. Carro sem dono fixo não entrava
 * na conta, então uma retirada sem checklist não era cobrada de pessoa nenhuma.
 *
 * AS DUAS ETIQUETAS:
 *   fixo    — o carro é de alguém (dono fixo ou posse aberta). Cobrado de
 *             segunda a sexta, como sempre foi.
 *   reserva — o carro saiu numa retirada de HOJE. Entra em QUALQUER dia,
 *             inclusive sábado e domingo: quem pega carro confere antes de
 *             sair, e o papel não conhece fim de semana.
 */
export function checklistDeHoje({ veiculos, fichasDeHoje, pessoas, usos, hoje }) {
  const fichaDoCarro = new Map();
  for (const f of fichasDeHoje || []) if (f && f.veiculo_id) fichaDoCarro.set(f.veiculo_id, f);
  const diaUtil = !hoje || diaDaSemana(hoje) <= 5;
  const nome = (id) => {
    const p = (pessoas || []).find((x) => x && x.id === id);
    return p ? p.nome : null;
  };

  // A retirada de hoje: viagem cuja saída caiu no dia de hoje. Uma viagem que
  // começou ontem e continua aberta NÃO pede checklist hoje — o de hoje é de
  // quem pega o carro hoje.
  const retiradaDeHoje = new Map();
  for (const u of usos || []) {
    if (!u || (u.tipo || 'viagem') !== 'viagem') continue;
    if (diaEmBrasiliaDoInstante(u.saida_em) !== hoje) continue;
    retiradaDeHoje.set(u.veiculo_id, u);
  }

  const linhas = [];
  for (const v of veiculos || []) {
    if (!v || v.situacao !== 'ativo') continue;
    const uso = retiradaDeHoje.get(v.id) || null;
    const ficha = fichaDoCarro.get(v.id) || null;
    const quem = usos ? quemEstaComOCarro(v, usos) : null;
    const donoId = (quem && quem.pessoaId) || v.pessoa_id || null;
    const ehFixo = !!donoId && !uso;

    // Entra no quadro quem: saiu hoje (rodízio), é de alguém em dia útil, ou
    // simplesmente teve ficha hoje — esta última pega o carro que alguém
    // conferiu por fora das duas regras, e que sumiria do quadro sem ela.
    if (!uso && !ficha && !(ehFixo && diaUtil)) continue;

    linhas.push({
      veiculo: v,
      tag: uso ? 'reserva' : 'fixo',
      quemId: uso ? (uso.pessoa_id || null) : donoId,
      quem: uso ? (uso.pessoa_nome || nome(uso.pessoa_id)) : nome(donoId),
      fez: !!ficha,
      ficha,
      assinada: !!(ficha && ficha.assinada_em),
    });
  }

  // Pendente primeiro — é o que pede providência; depois por nome.
  return linhas.sort((a, b) => (a.fez === b.fez
    ? String(a.veiculo.nome || '').localeCompare(String(b.veiculo.nome || ''))
    : (a.fez ? 1 : -1)));
}

/** O dia (AAAA-MM-DD) de um instante, no fuso de Brasília. Mesma conta do resto
 *  da casa: `toISOString()` puro dá o dia em UTC, e depois das 21h isso já é o
 *  dia seguinte. */
function diaEmBrasiliaDoInstante(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t - 3 * 3600 * 1000).toISOString().slice(0, 10);
}
