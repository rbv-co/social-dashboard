// A SEQUÊNCIA DE GRAVAR UMA PEÇA — conta pura, com a porta do leitor injetada.
//
// A ORDEM É O CONTRATO, e cada passo está aqui por um motivo que custou caro:
//
//   1. LER ANTES. Se a etiqueta já tem OUTRA peça, PARA. Gravar por cima faz
//      duas bolsas com a mesma identidade e uma bolsa sem nenhuma — e a
//      etiqueta já está costurada dentro do forro, onde não se reabre.
//   2. MONTAR O PLANO A PARTIR DA MEMÓRIA QUE ACABOU DE LER. A NTAG213 não vem
//      em branco: o Lock Control TLV tem 5 bytes e atravessa a página 4 para
//      dentro da 5. Planejar sem a memória apagaria a trava junto.
//   3. ESCREVER PÁGINA POR PÁGINA. A escrita é de 4 bytes; não existe meia
//      página nem escrita agrupada nesta etiqueta.
//   4. LER DE VOLTA E CONFERIR. Uma etiqueta com defeito responde `90 00` a
//      tudo e não guarda nada. Sem este passo, a peça sairia dada como gravada
//      com uma etiqueta muda dentro da bolsa.
//   5. SÓ DEPOIS DE CONFERIR, MARCAR NO SISTEMA.
//
// ⚠️ O BURACO QUE ESTE ARQUIVO FECHA: `enderecoNaEtiqueta` devolve vazio em DOIS
// casos diferentes — a etiqueta está em branco, e a leitura não deu certo. Para
// `conferirLeitura`, vazio é 'vazia', e 'vazia' quer dizer PODE GRAVAR. Uma
// leitura truncada, desalinhada ou interrompida viraria autorização para gravar
// por cima de uma bolsa que já tem dono. Aqui a leitura ou vem INTEIRA, ou vira
// 'nao-li' — que nunca autoriza nada.
import { conferirLeitura } from '../src/ferramentas/autenticidade/nfc-fila.js'
import {
  enderecoDaTag,
  naFila,
  rotuloDoMotivo,
  fraseDaRecusa,
} from '../src/ferramentas/autenticidade/lotes.js'
import {
  planoDeGravacao,
  enderecoNaEtiqueta,
  conferirCapabilityContainer,
  PRIMEIRA_PAGINA,
  ULTIMA_PAGINA,
  BYTES_DE_USUARIO,
} from '../src/ferramentas/autenticidade/gravador-de-mesa/ndef-para-ntag213.js'

export { BYTES_DE_USUARIO }

const BYTES_POR_PAGINA = 4
const PAGINA_DO_CAPABILITY_CONTAINER = 3
// A NTAG213 devolve no máximo 4 páginas por READ. Ler os 144 bytes do usuário
// custa 9 leituras — meio segundo na bancada, e é o preço de saber com certeza
// se a etiqueta está livre.
const BYTES_POR_LEITURA = 16

// ── A DECISÃO, EM CONTA PURA ───────────────────────────────────────────────
// Sai daqui a única resposta que importa: pode gravar nesta etiqueta ou não.
// Ela REAPROVEITA `conferirLeitura` (nfc-fila.js), que é a mesma decisão que o
// celular usa. Duas cópias da mesma decisão divergem no dia em que uma muda —
// e a que ficar para trás manda gravar por cima de uma bolsa.
//
// O que este arquivo acrescenta é o quinto estado, que o celular não tem porque
// lá o navegador já separa "não li" de "li e estava vazia":
//   'nao-li' → não sei o que tem nesta etiqueta, então NÃO GRAVO.
export function decidirPelaLeitura(leitura, codigoEsperado) {
  const memoria = leitura?.memoria
  if (!leitura?.leu) return 'nao-li'
  // Memória curta é meia memória, e meia memória lida como etiqueta em branco.
  // A conferência é aqui, e não só na porta do leitor, porque esta função é o
  // portão: quem chamar com uma leitura torta tem de ouvir 'nao-li'.
  if (!Array.isArray(memoria) || memoria.length !== BYTES_DE_USUARIO) return 'nao-li'
  return conferirLeitura(enderecoNaEtiqueta(memoria), codigoEsperado)
}

// ── LER A ETIQUETA INTEIRA ─────────────────────────────────────────────────
// Lê a página 3 (o Capability Container, que diz se a etiqueta está formatada e
// se ainda aceita gravação) e os 144 bytes do usuário.
//
// LÊ TUDO, e não só o começo. Um endereço nosso cabe nos primeiros 60 bytes,
// mas uma etiqueta gravada por outro app põe o registro de aplicativo do
// Android na frente e empurra o endereço para adiante. Ler pela metade acharia
// "nada" numa etiqueta ocupada — e nada é a resposta perigosa.
export async function lerAEtiqueta(sessao) {
  let capability = null
  const memoria = []
  try {
    capability = conferirCapabilityContainer(
      await sessao.lerPaginas(PAGINA_DO_CAPABILITY_CONTAINER, BYTES_POR_PAGINA),
    )
    const paginasPorVez = BYTES_POR_LEITURA / BYTES_POR_PAGINA
    for (let pagina = PRIMEIRA_PAGINA; pagina <= ULTIMA_PAGINA; pagina += paginasPorVez) {
      const quantos = Math.min(
        BYTES_POR_LEITURA,
        (ULTIMA_PAGINA - pagina + 1) * BYTES_POR_PAGINA,
      )
      memoria.push(...await sessao.lerPaginas(pagina, quantos))
    }
  } catch (erro) {
    // MEMÓRIA NENHUMA, de propósito. Devolver o pedaço que deu para ler seria
    // devolver meia verdade, e meia verdade aqui vira "etiqueta em branco".
    return { leu: false, memoria: [], capability, falha: erro?.message || String(erro) }
  }
  if (memoria.length !== BYTES_DE_USUARIO) {
    return {
      leu: false,
      memoria: [],
      capability,
      falha: `A leitura trouxe ${memoria.length} de ${BYTES_DE_USUARIO} bytes. `
        + 'Encoste a etiqueta de novo e segure parada.',
    }
  }
  return { leu: true, memoria, capability, falha: '' }
}

// ── O QUE CADA DECISÃO SIGNIFICA NA BANCADA ────────────────────────────────
function fraseDaEtiquetaOcupada(memoria, peca) {
  const jaEstaLa = enderecoNaEtiqueta(memoria)
  const codigo = jaEstaLa.split('/').pop()
  return 'ESTA ETIQUETA JÁ TEM DONO: dentro dela está a peça '
    + `${codigo || jaEstaLa}, não a ${peca}. Separe esta etiqueta e pegue uma em branco. `
    + 'Gravar por cima faria duas bolsas com a mesma identidade e uma bolsa sem nenhuma.'
}

// ── A SEQUÊNCIA ────────────────────────────────────────────────────────────
// `sessao` é a porta do leitor (leitor-de-mesa.js) ou uma de mentira, no teste.
// `marcar` é o que registra no sistema — injetado, porque banco não entra em
// conta pura e porque a fila precisa poder tentar de novo só a marcação.
//
// OS ESTADOS, e por que cada um é separado dos outros:
//   'gravada'             gravou, conferiu na etiqueta e registrou. Acabou.
//   'ja-era-dela'         a etiqueta já tinha ESTA peça; não regravou, só marcou.
//   'recusada'            a etiqueta ou a peça não podem receber esta gravação.
//                         Nada foi escrito.
//   'nao-li'              não sei o que tem na etiqueta. Nada foi escrito.
//   'falhou-ao-escrever'  parou no meio: a etiqueta ficou pela metade.
//   'nao-conferiu'        escreveu, mas a etiqueta não guardou. Etiqueta ruim.
//   'gravada-sem-marcar'  A ETIQUETA ESTÁ NO MUNDO E O SISTEMA NÃO SABE. É o
//                         pior caso da bancada e por isso tem estado próprio:
//                         chamar isto de 'falhou' faria a fila oferecer a mesma
//                         peça de novo, e a peça sairia em DUAS etiquetas.
export async function gravarUmaPeca({ sessao, peca, marcar, conferirApenas = false }) {
  const p = peca || {}
  const codigo = String(p.codigo ?? '').trim().toUpperCase()
  // O CÓDIGO ENTRA EM TODO RESULTADO. Quem recebe isto é a fila (fila.js), e
  // ela precisa saber de qual peça o resultado é — sem isso ela recebe um
  // resultado órfão e para, ou anda com a peça errada.
  const nada = { codigo, marcada: false, endereco: '', lido: '' }

  // AS RECUSAS QUE NÃO PRECISAM DA ETIQUETA vêm primeiro, de propósito: fazer o
  // operador encostar uma etiqueta para só então ouvir "esta peça está baixada"
  // é gastar o tempo dele e arriscar uma etiqueta boa numa peça que não vai
  // virar bolsa.
  if (!codigo) {
    return { ...nada, estado: 'recusada', frase: 'Esta peça está sem código. Recarregue a lista do lote.' }
  }
  if (!naFila(p)) {
    return {
      ...nada,
      estado: 'recusada',
      frase: `A peça ${codigo} está baixada (${rotuloDoMotivo(p.baixa_motivo)}) e saiu da fila. `
        + 'Gravar a etiqueta dela poria uma etiqueta dentro de uma bolsa que não deveria existir.',
    }
  }
  if (p.gravada_em && !conferirApenas) {
    // `nova_ja_gravada` é a mesma recusa que o banco dá, e a frase é a do
    // painel: a pessoa lê a MESMA explicação na tela e aqui.
    return { ...nada, estado: 'recusada', frase: fraseDaRecusa('nova_ja_gravada') }
  }

  const endereco = enderecoDaTag(codigo)

  // 1. LER ANTES.
  const leitura = await lerAEtiqueta(sessao)
  if (!leitura.leu) {
    return {
      ...nada,
      endereco,
      estado: 'nao-li',
      frase: `Não consegui ler esta etiqueta, então não gravei nada nela. ${leitura.falha} `
        + 'Enquanto não der para ler, não dá para saber se ela já tem outra peça dentro.',
    }
  }
  const capability = leitura.capability || {}
  if (!capability.formatada || !capability.podeGravar) {
    return { ...nada, endereco, estado: 'recusada', frase: capability.aviso || 'Esta etiqueta não aceita gravação.' }
  }

  const decisao = decidirPelaLeitura(leitura, codigo)
  if (decisao === 'outra-peca' || decisao === 'nao-e-vessel') {
    return {
      ...nada,
      endereco,
      lido: enderecoNaEtiqueta(leitura.memoria),
      estado: 'recusada',
      frase: decisao === 'outra-peca'
        ? fraseDaEtiquetaOcupada(leitura.memoria, codigo)
        : 'ESTA ETIQUETA JÁ ESTÁ GRAVADA COM OUTRA COISA, que não é do selo Vessel '
          + `(${enderecoNaEtiqueta(leitura.memoria)}). Separe esta etiqueta e pegue uma em branco.`,
    }
  }

  // A ETIQUETA JÁ TEM ESTA PEÇA. Não se regrava: escrever de novo o que já está
  // lá só cria uma chance a mais de a etiqueta sair no meio. Isto acontece de
  // verdade quando a gravação deu certo e a MARCAÇÃO é que falhou — e é assim
  // que se termina o serviço sem gastar outra etiqueta.
  if (decisao === 'confere') {
    const marcacao = await registrarNoSistema({ marcar, peca: p })
    return {
      ...nada,
      endereco,
      lido: endereco,
      estado: 'ja-era-dela',
      marcada: marcacao.ok,
      frase: marcacao.ok
        ? `Esta etiqueta já estava gravada com a peça ${codigo}. Registrei aqui e seguimos.`
        : `A etiqueta já está com a peça ${codigo}, mas ${marcacao.frase}`,
    }
  }

  if (conferirApenas) {
    return {
      ...nada,
      endereco,
      estado: 'recusada',
      frase: 'Esta etiqueta está em branco: não é a etiqueta desta peça.',
    }
  }

  // 2. O PLANO SAI DA MEMÓRIA QUE ACABOU DE SER LIDA.
  let plano
  try {
    plano = planoDeGravacao(endereco, leitura.memoria)
  } catch (erro) {
    return { ...nada, endereco, estado: 'recusada', frase: erro?.message || String(erro) }
  }

  // 3. ESCREVER PÁGINA POR PÁGINA.
  for (const { pagina, bytes } of plano) {
    try {
      await sessao.escreverPagina(pagina, bytes)
    } catch (erro) {
      return {
        ...nada,
        endereco,
        estado: 'falhou-ao-escrever',
        frase: `${erro?.message || erro} A gravação parou na metade: esta etiqueta ficou `
          + 'incompleta, nem em branco nem gravada. SEPARE ESTA ETIQUETA e pegue outra — '
          + 'costurada assim, ela não abriria nada no celular da cliente.',
      }
    }
  }

  // 4. LER DE VOLTA E CONFERIR. Não é zelo: etiqueta com defeito responde
  // `90 00` a tudo e não guarda nada.
  const conferencia = await lerAEtiqueta(sessao)
  if (!conferencia.leu) {
    return {
      ...nada,
      endereco,
      estado: 'nao-conferiu',
      frase: `Gravei, mas não consegui ler de volta para conferir. ${conferencia.falha} `
        + 'Encoste a MESMA etiqueta de novo: se ela estiver boa, ela vai ser reconhecida como já gravada.',
    }
  }
  const lido = enderecoNaEtiqueta(conferencia.memoria)
  if (lido !== endereco) {
    return {
      ...nada,
      endereco,
      lido,
      estado: 'nao-conferiu',
      frase: 'Gravei, mas a etiqueta não guardou o endereço: li de volta '
        + `"${lido || '(nada)'}" no lugar de "${endereco}". A etiqueta não presta. `
        + 'Separe esta e troque por outra.',
    }
  }

  // 5. SÓ AGORA MARCAR NO SISTEMA.
  const marcacao = await registrarNoSistema({ marcar, peca: p })
  if (!marcacao.ok) {
    return {
      ...nada,
      endereco,
      lido,
      estado: 'gravada-sem-marcar',
      frase: `A ETIQUETA JÁ ESTÁ GRAVADA E CONFERIDA com a peça ${codigo}, mas o sistema não `
        + `registrou isso: ${marcacao.frase} NÃO grave esta peça em outra etiqueta — `
        + 'guarde esta e tente registrar de novo quando a internet voltar.',
    }
  }

  return {
    codigo,
    marcada: true,
    endereco,
    lido,
    estado: 'gravada',
    frase: `Peça ${codigo} gravada e conferida na etiqueta.`,
  }
}

// MARCAR NO SISTEMA. As três formas de falhar são tratadas iguais aqui — a
// diferença entre elas não muda o que a bancada faz (guardar a etiqueta e tentar
// de novo), e o que muda é só a frase.
//
// A RECUSA DO BANCO VIRA A FRASE DO PAINEL (`fraseDaRecusa`, em lotes.js). A
// pessoa lê a MESMA explicação aqui e na tela; um `motivo` cru como
// "sem_permissao" faz recarregar às cegas.
async function registrarNoSistema({ marcar, peca }) {
  if (typeof marcar !== 'function') {
    return { ok: false, frase: 'este programa está sem a ligação com o sistema.' }
  }
  try {
    const r = await marcar(peca)
    // `undefined` conta como sucesso: quem injeta uma função que só faz o
    // trabalho e não devolve nada não deve ser punido com um falso negativo.
    if (r === undefined || r === null || r.ok) return { ok: true, frase: '' }
    // A FRASE PRÓPRIA DO MARCADOR VENCE A GENÉRICA. `fraseDaRecusa` só conhece
    // os motivos que o BANCO devolve; motivos que só este programa conhece —
    // 'nao_confirmou', quando o banco diz `ok` e a peça não ficou marcada —
    // cairiam no `default` dela, que manda "recarregue a tela" e some com a
    // única informação que importava.
    return { ok: false, frase: r.frase || fraseDaRecusa(r.motivo, r) }
  } catch (erro) {
    return { ok: false, frase: `não consegui falar com o sistema (${erro?.message || erro}).` }
  }
}
