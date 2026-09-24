/* OS ENDEREÇOS PÚBLICOS DA PRIVATE EDIT E DO STYLIST CIRCLE.
 *
 * ⚠️ SÃO GÊMEOS DOS DO SITE, como os da Beauty Session. Eles são montados em
 * `vessel-brasil/regras-da-private-edit.mjs` e
 * `vessel-brasil/regras-do-rastreio-de-stylist.mjs`, porque é lá que as páginas
 * públicas vivem. A Central não importa arquivo do site (repositórios
 * separados, e o site não pode levar credencial do banco).
 *
 * A defesa é a mesma: o teste ao lado LÊ os arquivos de lá, quando a pasta está
 * por perto, e cobra que os dois montem o mesmo endereço. Divergir aqui não dá
 * erro — dá um link impresso que leva a lugar nenhum.
 *
 * (A Beauty Session tem os dela em `beauty-sessions/contas-das-sessoes.js`,
 * onde nasceram. Mover agora só para agrupar criaria um segundo lugar para a
 * mesma verdade durante a mudança, que é o defeito que tudo isto evita.)
 */

export const SITE = 'https://vesselbrasil.com.br'

/** O código de uma stylist: STY-0000. */
export const FORMATO_STYLIST = /^STY-\d{4}$/

/** O código de um encontro: PE-AAAAMMDD-PRACA-SEQ. */
export const FORMATO_ENCONTRO = /^PE-\d{8}-[A-Z]{3}-[A-Z0-9]{1,4}$/

/**
 * A chave do convite: 8 letras, sem I, L, O, U, 0 e 1.
 * ⚠️ O ALFABETO NÃO É DECORAÇÃO — a chave é lida em voz alta e digitada por
 * gente, e esses seis caracteres são os que se confundem entre si.
 */
export const FORMATO_DA_CHAVE = /^[ABCDEFGHJKMNPQRSTVWXYZ23456789]{8}$/

/** O link permanente da stylist — o do dia a dia, que ela cola no story. */
export function enderecoDaStylist(codigo) {
  const c = String(codigo || '').trim().toUpperCase()
  return FORMATO_STYLIST.test(c) ? `${SITE}/s/${c}` : ''
}

/**
 * O convite de UM encontro. Vai pela CHAVE, não pelo código.
 *
 * ⚠️ POR QUE A CHAVE, E NÃO O CÓDIGO: `PE-20261005-CPS-01` é adivinhável —
 * quem recebesse um convite conseguiria listar os outros encontros trocando a
 * data e o número. A chave é sorteada, e é por isso que ela existe.
 */
export function enderecoDoConvite(chave) {
  const c = String(chave || '').trim().toUpperCase()
  return FORMATO_DA_CHAVE.test(c) ? `${SITE}/pe/${c}` : ''
}

/** A porta de entrada do programa, onde a stylist se inscreve. Uma só. */
export const ENDERECO_DO_CIRCLE = `${SITE}/stylist-circle/`

/* O GERADOR DO APPOINTMENT CARD.
 *
 * ⚠️ MORA NO OUTRO REPOSITÓRIO (`rbv-co/vessel-brasil`), que o .gitignore deste
 * exclui de propósito. Isto é uma PORTA, não uma cópia: copiar o gerador para cá
 * seriam 831 linhas de tela, o fundo de 377 KB, três fontes e o codificador de
 * QR duplicados — junto com três contas delicadas que passariam a existir em
 * dose dupla: a arte que é 1,35x a especificação, o QR que tem de caber em 43
 * caracteres, e a fonte Versatile que tem ':' e ';' trocados no arquivo.
 *
 * ⚠️ E NÃO DÁ PARA EMBUTIR EM MOLDURA: a Vercel manda `frame-ancestors` e o
 * quadro sai branco, com o erro só no console.
 *
 * ⚠️ ABRE VAZIO. O gerador não lê nada da barra de endereço, e mandar
 * parâmetro faria a Client Advisor achar que preencheu quando não preencheu.
 */
export const ENDERECO_DO_GERADOR_DE_CARTAO = `${SITE}/geradorappointmentcard/`

// ⚠️ 24/09/2026: o funil da stylist é CONFIGURÁVEL (`vessel_stylist_etapas`),
// e nenhuma lista de etapas mora mais no código — o `ESTAGIOS` que ficava aqui
// saiu junto com a lista fechada.

/** dd/mm/aaaa sem passar por Date — fuso não muda o dia. */
export function dataLegivel(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

/**
 * dd/mm/aaaa às HHhMM, para o encontro, que tem HORA.
 *
 * ⚠️ O `quando` do encontro é timestamptz e chega em UTC. Converter no fuso de
 * São Paulo é obrigatório: um encontro às 19h de Campinas chega como 22h UTC, e
 * mostrar "22h" mandaria a anfitriã para o lugar certo na hora errada.
 */
export function dataHoraLegivel(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const f = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const p = Object.fromEntries(f.map((x) => [x.type, x.value]))
  return `${p.day}/${p.month}/${p.year} às ${p.hour}h${p.minute}`
}

/**
 * O que está errado num encontro novo, em frases da operação.
 * ⚠️ Espelha as conferências do banco. Quem barra de verdade é
 * `vessel_criar_private_edit` — isto é para a pessoa descobrir antes de enviar.
 */
export function problemasDoEncontro({ stylist, quando, praca, vagas } = {}) {
  const problemas = []
  if (!stylist || !FORMATO_STYLIST.test(String(stylist).toUpperCase())) {
    problemas.push('Escolha a stylist anfitriã.')
  }
  if (!quando) {
    problemas.push('Escolha o dia e a hora do encontro.')
  } else if (new Date(quando).getTime() < Date.now() - 24 * 3600 * 1000) {
    problemas.push('Esta data já passou — o convite nasceria vencido.')
  }
  if (!praca || !['CPS', 'SAO', 'SBO', 'BSB'].includes(String(praca).toUpperCase())) {
    problemas.push('Escolha a praça.')
  }
  // ⚠️ T11: capacidade planejada de 7 a 10 (decisão do dono, 22/09/2026) — a
  // mesma régua de `vessel_criar_private_edit`.
  const v = Number(vagas)
  if (!Number.isInteger(v) || v < 7 || v > 10) {
    problemas.push('As vagas (capacidade planejada) precisam ficar entre 7 e 10.')
  }
  return problemas
}
