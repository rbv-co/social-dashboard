// A SEQUÊNCIA DO LEITOR DE MESA — conta pura, com a porta injetada.
//
// A ORDEM É O CONTRATO, e é a MESMA do motor (`gravador/gravar-uma-peca.js`).
// Cada passo está aqui por um motivo que custou caro:
//
//   1. LER ANTES. Se a etiqueta já tem OUTRA peça, PARA. Gravar por cima faz
//      duas bolsas com a mesma identidade e uma bolsa sem nenhuma — e a etiqueta
//      já está costurada dentro do forro, onde não se reabre.
//   2. MONTAR O PLANO A PARTIR DA MEMÓRIA QUE ACABOU DE SER LIDA. Medido na
//      bancada em 01/09/2026: plano montado supondo etiqueta de fábrica, gravado
//      numa etiqueta reaproveitada — o leitor respondeu `90 00` DOZE VEZES e a
//      etiqueta ficou com uma mensagem quebrada, ilegível para o celular.
//   3. ESCREVER PÁGINA POR PÁGINA (a porta faz isso; aqui só se decide gravar).
//   4. LER DE VOLTA E CONFERIR. Etiqueta com defeito responde `90 00` a tudo e
//      não guarda nada. Sem este passo, a peça sairia dada como pronta com uma
//      etiqueta muda dentro da bolsa.
//   5. SÓ DEPOIS DE CONFERIR, MARCAR NO SISTEMA.
//
// ⚠️ POR QUE ISTO NÃO ESTÁ DENTRO DO `.vue`: `node --test` não compila `.vue`, e
// o que precisa de prova aqui é justamente o que não se vê olhando a tela — a
// etiqueta que sai no meio, a que responde bem e não guarda nada, a leitura que
// falhou. A tela chama e desenha; a decisão mora aqui e se prova.
//
// ⚠️ POR QUE A DECISÃO NÃO É REESCRITA AQUI: quem diz se pode gravar é
// `conferirLeitura` (nfc-fila.js), a MESMA função que o caminho do celular usa.
// Duas cópias da mesma decisão divergem no dia em que uma muda — e a que ficar
// para trás manda gravar por cima de uma bolsa.
import { conferirLeitura, codigoDoEndereco } from '../nfc-fila.js'

// O quinto estado, que o caminho do celular não tem porque lá o navegador já
// separa "não li" de "li e estava vazia": 'nao-li' → não sei o que tem nesta
// etiqueta, então NÃO GRAVO.
export const NAO_LI = 'nao-li'

// LER, SEM DEIXAR FALHA VIRAR VAZIO. A porta estoura quando não conseguiu ler —
// e é assim de propósito, porque um `''` devolvido aqui viraria 'vazia' na
// decisão, e 'vazia' quer dizer PODE GRAVAR.
async function lerComCuidado(porta) {
  try {
    const lida = await porta.lerAEtiqueta()
    return { leu: true, ...lida, falha: '' }
  } catch (erro) {
    // MEMÓRIA NENHUMA, de propósito: devolver o pedaço que deu para ler seria
    // devolver meia verdade, e meia verdade aqui vira "etiqueta em branco".
    return { leu: false, endereco: '', memoria: null, capability: null, falha: String(erro?.message || erro) }
  }
}

// ── ESCREVER E CONFERIR ────────────────────────────────────────────────────
// Usada nos DOIS caminhos: a gravação normal e a sobrescrita (onde o banco já
// mudou e só falta o chip). O plano sai sempre da memória que acabou de ser
// lida, nunca de uma etiqueta imaginada.
//
// ⚠️ A MEMÓRIA JÁ LIDA ENTRA POR PARÂMETRO. Quem já leu a etiqueta — a sequência
// inteira, logo abaixo — passa o que leu, e aqui não se lê de novo: cada ida ao
// chip é mais uma chance de a etiqueta sair de cima do leitor no meio, e uma
// releitura entre a decisão e a escrita poderia até ser de OUTRA etiqueta. Quem
// não leu ainda — a sobrescrita, em que o banco já mudou e a pessoa acabou de
// pôr a etiqueta de novo — deixa em branco e a leitura acontece aqui.
export async function escreverEConferir({ porta, endereco, memoria = null }) {
  let memoriaAtual = memoria
  if (!memoriaAtual) {
    const antes = await lerComCuidado(porta)
    if (!antes.leu) {
      return {
        ok: false,
        estado: NAO_LI,
        lido: '',
        frase: `Não consegui ler esta etiqueta, então não gravei nada nela. ${antes.falha}`,
      }
    }
    memoriaAtual = antes.memoria
  }
  try {
    await porta.gravar(endereco, memoriaAtual)
  } catch (erro) {
    // ⚠️ NADA FOI ESCRITO ≠ PAROU NO MEIO, e a diferença custa uma etiqueta boa
    // por vez. Endereço que não cabe e memória que não foi lida são recusados
    // com a etiqueta INTACTA — mandar separá-la seria jogar fora etiqueta boa.
    if (erro?.nadaFoiEscrito) {
      return { ok: false, estado: 'recusada', lido: '', frase: String(erro?.message || erro) }
    }
    return {
      ok: false,
      estado: 'falhou-ao-escrever',
      lido: '',
      frase: `${erro?.message || erro} A gravação parou na metade: esta etiqueta ficou `
        + 'incompleta, nem em branco nem gravada. SEPARE ESTA ETIQUETA e pegue outra — '
        + 'costurada assim, ela não abriria nada no celular da cliente.',
    }
  }

  const depois = await lerComCuidado(porta)
  if (!depois.leu) {
    return {
      ok: false,
      estado: 'nao-conferiu',
      lido: '',
      frase: `Gravei, mas não consegui ler de volta para conferir. ${depois.falha} `
        + 'Ponha a MESMA etiqueta no leitor de novo: se ela estiver boa, ela vai ser '
        + 'reconhecida como já gravada.',
    }
  }
  if (depois.endereco !== endereco) {
    return {
      ok: false,
      estado: 'nao-conferiu',
      lido: depois.endereco,
      frase: 'Gravei, mas a etiqueta não guardou o endereço: li de volta '
        + `"${depois.endereco || '(nada)'}" no lugar de "${endereco}". A etiqueta não presta. `
        + 'Separe esta e troque por outra.',
    }
  }
  return { ok: true, estado: 'gravada', lido: depois.endereco, frase: '' }
}

// ── A SEQUÊNCIA INTEIRA ────────────────────────────────────────────────────
// `porta` é `porta-do-gravador-de-mesa.js` (ou uma de mentira, no teste).
// `marcar` é o que registra no sistema — injetado, porque banco não entra em
// conta pura.
//
// OS ESTADOS, e por que cada um é separado dos outros:
//   'gravada'             gravou, conferiu na etiqueta e registrou. Acabou.
//   'ja-era-dela'         a etiqueta já tinha ESTA peça; não regravou, só marcou.
//   'outra-peca'          a etiqueta tem OUTRA peça do selo. A tela pergunta o
//                         que fazer; nada foi escrito.
//   'nao-e-vessel'        tem alguma coisa que não é do selo. Nada foi escrito.
//   'recusada'            o leitor, a etiqueta ou o endereço não permitem. Nada
//                         foi escrito.
//   'nao-li'              não sei o que tem na etiqueta. Nada foi escrito.
//   'falhou-ao-escrever'  parou no meio: a etiqueta ficou pela metade.
//   'nao-conferiu'        escreveu, mas a etiqueta não guardou. Etiqueta ruim.
//   'gravada-sem-marcar'  A ETIQUETA ESTÁ NO MUNDO E O SISTEMA NÃO SABE. É o pior
//                         caso da bancada e por isso tem estado próprio: chamar
//                         isto de 'falhou' faria a tela oferecer a mesma peça de
//                         novo, e a peça sairia em DUAS etiquetas.
//
// `aoContar(frase, fase)` recebe DOIS argumentos, e o segundo não é enfeite: o
// modo bancada escreve o estado em letra grande — "Encoste a etiqueta" vira
// "Gravando…" — e adivinhar a fase lendo a FRASE seria a tela decidindo por
// texto. Bastaria alguém melhorar uma palavra aqui para o painel parar de mudar
// de estado, em silêncio. A fase é 'esperando' ou 'gravando', os mesmos nomes de
// `modo-bancada.js`.
// ── APAGAR E CONFERIR ──────────────────────────────────────────────────────
// O espelho de `escreverEConferir`, e a conferência é o contrário: aqui dá certo
// quando a etiqueta NÃO devolve endereço nenhum.
//
// ⚠️ NÃO EXISTE "PAROU NA METADE" QUE ESTRAGUE A ETIQUETA. O plano põe a
// mensagem vazia na primeira escrita, então qualquer interrupção deixa a
// etiqueta válida e em branco. Por isso a frase de falha aqui nunca manda
// separar a etiqueta — mandar jogar fora uma etiqueta que está boa e vazia
// seria jogar fora etiqueta boa, que é o defeito que este arquivo já combate
// do outro lado.
export async function apagarEConferir({ porta, memoria = null }) {
  let memoriaAtual = memoria
  if (!memoriaAtual) {
    const antes = await lerComCuidado(porta)
    if (!antes.leu) {
      return {
        ok: false,
        estado: NAO_LI,
        frase: `Não consegui ler esta etiqueta, então não apaguei nada nela. ${antes.falha}`,
      }
    }
    memoriaAtual = antes.memoria
  }

  try {
    await porta.apagar(memoriaAtual)
  } catch (erro) {
    if (erro?.nadaFoiEscrito) {
      return { ok: false, estado: 'recusada', frase: String(erro?.message || erro) }
    }
    return {
      ok: false,
      estado: 'falhou-ao-apagar',
      frase: `${erro?.message || erro} A etiqueta pode ter ficado em branco mesmo assim — `
        + 'ponha a MESMA etiqueta no leitor e apague de novo para conferir. '
        + 'Apagar duas vezes não faz mal.',
    }
  }

  const depois = await lerComCuidado(porta)
  if (!depois.leu) {
    return {
      ok: false,
      estado: 'nao-conferiu',
      frase: `Apaguei, mas não consegui ler de volta para conferir. ${depois.falha} `
        + 'Ponha a MESMA etiqueta no leitor de novo: se ela estiver apagada, vai ser '
        + 'reconhecida como em branco.',
    }
  }
  if (depois.endereco) {
    return {
      ok: false,
      estado: 'nao-conferiu',
      frase: `Apaguei, mas ao ler de volta a etiqueta ainda devolveu "${depois.endereco}". `
        + 'NÃO considere esta etiqueta apagada.',
    }
  }

  return { ok: true, estado: 'apagada', frase: 'Etiqueta apagada e conferida: não devolve mais endereço.' }
}

export async function gravarPeloLeitorDeMesa({ porta, peca, endereco, marcar, aoContar = () => {} }) {
  const codigo = String(peca?.codigo ?? '').trim().toUpperCase()
  const nada = { codigo, lido: '', codigoAntigo: '' }

  // 0. PEGAR A ETIQUETA. Sem etiqueta em cima do leitor o Windows recusa a
  // conexão — e é assim que o programa sabe que ainda não puseram nenhuma. A
  // espera, e a segunda tentativa do serviço que sobe sob demanda, são de lá.
  aoContar('Ponha a etiqueta em cima do leitor, no meio, e segure parada…', 'esperando')
  try {
    await porta.conectar()
  } catch (erro) {
    return { ...nada, estado: 'recusada', frase: String(erro?.message || erro) }
  }

  try {
    // 1. LER ANTES.
    const antes = await lerComCuidado(porta)
    if (!antes.leu) {
      return {
        ...nada,
        estado: NAO_LI,
        frase: `Não consegui ler esta etiqueta, então não gravei nada nela. ${antes.falha} `
          + 'Enquanto não der para ler, não dá para saber se ela já tem outra peça dentro.',
      }
    }

    const capability = antes.capability || {}
    if (!capability.formatada || !capability.podeGravar) {
      return {
        ...nada,
        estado: 'recusada',
        frase: capability.aviso || 'Esta etiqueta não aceita gravação. Use outra.',
      }
    }

    const decisao = conferirLeitura(antes.endereco, codigo)

    // A ETIQUETA JÁ TEM OUTRA PEÇA. Não é o fim da linha: a tela oferece a
    // sobrescrita que ela já sabe fazer, com o NOME da bolsa que vai perder a
    // identidade. A decisão não cabe aqui dentro.
    if (decisao === 'outra-peca') {
      return {
        ...nada,
        estado: 'outra-peca',
        lido: antes.endereco,
        codigoAntigo: codigoDoEndereco(antes.endereco) || '',
        frase: 'PARE: esta etiqueta já tem OUTRA peça gravada. '
          + 'Escolha abaixo o que fazer com ela antes de gravar por cima.',
      }
    }
    if (decisao === 'nao-e-vessel') {
      return {
        ...nada,
        estado: 'nao-e-vessel',
        lido: antes.endereco,
        frase: 'ESTA ETIQUETA JÁ ESTÁ GRAVADA COM OUTRA COISA, que não é do selo Vessel '
          + `(${antes.endereco}). Separe esta etiqueta e pegue uma em branco.`,
      }
    }

    // JÁ ERA DELA: não se regrava. Escrever de novo o que já está lá só cria uma
    // chance a mais de a etiqueta sair no meio. Acontece de verdade quando a
    // gravação deu certo e a MARCAÇÃO é que falhou.
    if (decisao === 'confere') {
      const marcou = await marcar(peca)
      return {
        ...nada,
        estado: 'ja-era-dela',
        lido: antes.endereco,
        marcada: Boolean(marcou),
        frase: marcou
          ? `Esta etiqueta já estava gravada com a peça ${codigo}. Registrei e seguimos.`
          : `A etiqueta já está com a peça ${codigo}, mas não consegui marcá-la. Tente de novo.`,
      }
    }

    // 2, 3 e 4. O PLANO SAI DA MEMÓRIA LIDA, escreve, e lê de volta.
    aoContar('Gravando… não tire a etiqueta de cima do leitor.', 'gravando')
    let escrita
    try {
      escrita = await escreverEConferir({ porta, endereco, memoria: antes.memoria })
    } catch (erro) {
      // endereço que não cabe na etiqueta: recusado com a etiqueta intacta
      return { ...nada, estado: 'recusada', frase: String(erro?.message || erro) }
    }
    if (!escrita.ok) return { ...nada, ...escrita, estado: escrita.estado }

    // 5. SÓ AGORA MARCAR NO SISTEMA.
    const marcou = await marcar(peca)
    if (!marcou) {
      return {
        ...nada,
        estado: 'gravada-sem-marcar',
        lido: escrita.lido,
        frase: `A ETIQUETA JÁ ESTÁ GRAVADA E CONFERIDA com a peça ${codigo}, mas o sistema não `
          + 'registrou isso. NÃO grave esta peça em outra etiqueta — guarde esta e tente '
          + 'registrar de novo.',
      }
    }
    return {
      ...nada,
      estado: 'gravada',
      lido: escrita.lido,
      marcada: true,
      frase: `Peça ${peca?.numero_na_serie ?? codigo} gravada e conferida. Pegue a próxima etiqueta.`,
    }
  } finally {
    // SOLTAR A ETIQUETA EM TODOS OS CAMINHOS. Leitor preso à etiqueta que já saiu
    // da mesa trava a peça seguinte, e a bancada acha que o aparelho quebrou.
    await porta.desconectar()
  }
}
