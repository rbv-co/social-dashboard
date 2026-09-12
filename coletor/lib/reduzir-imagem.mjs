// REDUZIR A FOTO, no Mac OU no Linux.
//
// ⚠️ POR QUE ISTO VIROU UM MODULO: o robo das fotos usava `sips` direto, que e
// nativo do macOS. Isso o prendia A ESTA MAQUINA — se o Mac estivesse dormindo
// as 8h05, ninguem tirava foto nenhuma naquele dia (aconteceu: das tres
// execucoes registradas no log, duas morreram por falta de rede). O dono pediu
// que ele rodasse sem depender do computador de ninguem.
//
// No Linux do GitHub Actions nao existe `sips`. Existe o ImageMagick, que ja vem
// instalado. As duas ferramentas fazem a mesma coisa; o que muda e o nome e a
// ordem dos argumentos.
//
// ⚠️ A ESCOLHA E POR EXISTENCIA, NAO POR SISTEMA. Testar `process.platform`
// pareceria mais direto e seria pior: um Mac sem `sips` (ou um Linux com ele
// instalado) cairia no caminho errado. Perguntar "esta ferramenta existe?" e a
// pergunta que importa.
import { execFileSync } from 'node:child_process'

/** As ferramentas que servem, na ordem de preferencia. */
export const FERRAMENTAS = [
  {
    nome: 'sips',
    caminho: '/usr/bin/sips',
    // -Z redimensiona pelo maior lado sem distorcer; 55 e a qualidade JPEG.
    argumentos: (entrada, saida, largura) => [
      '-Z', String(largura), '-s', 'format', 'jpeg',
      '-s', 'formatOptions', '55', entrada, '--out', saida,
    ],
  },
  {
    nome: 'magick',
    caminho: 'magick',
    // `>` no fim do resize: so ENCOLHE. Sem ele, foto menor que o teto seria
    // ESTICADA — e foto esticada fica borrada na tela da cliente.
    argumentos: (entrada, saida, largura) => [
      entrada, '-resize', `${largura}x${largura}>`, '-quality', '55', saida,
    ],
  },
  {
    // O ImageMagick antigo chama-se `convert`. Fica por ultimo porque em
    // algumas maquinas `convert` e outro programa (o do ImageMagick 6 e o
    // homonimo do Windows), e `magick` nunca e ambiguo.
    nome: 'convert',
    caminho: 'convert',
    argumentos: (entrada, saida, largura) => [
      entrada, '-resize', `${largura}x${largura}>`, '-quality', '55', saida,
    ],
  },
]

/** Devolve a primeira ferramenta disponivel, ou `null`. */
export function ferramentaDisponivel(existe = padraoExiste) {
  return FERRAMENTAS.find((f) => existe(f.caminho)) || null
}

function padraoExiste(caminho) {
  try {
    if (caminho.startsWith('/')) {
      execFileSync(caminho, ['--help'], { stdio: 'ignore' })
      return true
    }
    execFileSync('/usr/bin/which', [caminho], { stdio: 'ignore' })
    return true
  } catch { return false }
}

/**
 * Reduz `entrada` para `saida`. Devolve o nome da ferramenta usada.
 * Lanca quando NAO HA ferramenta nenhuma — silencio aqui viraria foto original
 * de 326 KB indo para o site, ou pior, nenhuma foto e ninguem sabendo por que.
 */
export function reduzir(entrada, saida, largura, { rodar = execFileSync, existe } = {}) {
  const f = ferramentaDisponivel(existe);
  if (!f) {
    throw new Error('Não achei como reduzir a foto: nem `sips` (Mac) nem ImageMagick '
      + '(`magick`/`convert`). No Linux, instale com `apt-get install -y imagemagick`.')
  }
  rodar(f.caminho, f.argumentos(entrada, saida, largura), { stdio: 'ignore' })
  return f.nome
}
