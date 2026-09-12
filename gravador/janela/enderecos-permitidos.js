// ONDE A JANELA PODE IR — E SÓ ALI.
//
// A janela do gravador não tem tela própria: ela abre a tela que já existe no
// painel. Isso é decisão de desenho (uma tela só, que continua evoluindo com o
// painel) e traz junto uma responsabilidade: dentro dessa janela, a página tem
// o leitor ACR122U emprestado.
//
// ⚠️ POR ISSO A NAVEGAÇÃO É PRESA AQUI. Se a página for redirecionada para fora
// — um link, um anúncio, um redirecionamento de login mal configurado — quem
// estiver do outro lado herdaria o poder de ler e escrever nas etiquetas da
// bancada. O leitor NÃO viaja junto.

// A casa, escrita à mão, uma linha por casa. Nada de curinga: uma lista que
// cresce sozinha deixa de ser trava no dia em que ninguém está olhando.
export const CASAS_PERMITIDAS = ['central.rbvcompany.com']

export const ENDERECO_DA_CENTRAL = 'https://central.rbvcompany.com/autenticidade'

// `new URL` faz o trabalho pesado de propósito: comparar texto à mão é como
// nasce o defeito de `endsWith`, em que `central.rbvcompany.com.outracoisa.com`
// passa por ser da casa. O `hostname` do motor do navegador já resolve também o
// truque do `@` (`https://central.rbvcompany.com@outracoisa.com`, cujo hostname
// de verdade é `outracoisa.com`).
export function podeNavegar(endereco) {
  if (typeof endereco !== 'string' || !endereco.trim()) return false
  let url
  try { url = new URL(endereco) } catch { return false }
  // Só https. Um `http://` da nossa própria casa continua sendo conexão aberta,
  // e a sessão de quem grava passa por ela.
  if (url.protocol !== 'https:') return false
  return CASAS_PERMITIDAS.includes(url.hostname)
}
