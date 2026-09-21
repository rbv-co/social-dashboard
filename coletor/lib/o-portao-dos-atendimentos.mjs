// CONFERE QUE OS DOIS PORTOES DO COMERCIAL VESSEL VOLTARAM INTEIROS:
// `public.is_vessel_atendimentos()` (ver) e
// `public.is_vessel_atendimentos_editar()` (mexer).
//
// ⚠️ POR QUE ISTO EXISTE. Para provar qualquer conta do Comercial Vessel por
// uma conexao `pg` pura e preciso, por alguns segundos, trocar o portao por um
// `select true` — `auth.uid()` e nulo fora de uma sessao da Central, e sem isso
// toda funcao de conta levanta 42501 e nao ha o que provar. O `create or
// replace` da troca NAO e desfeito por nada automatico: ele e desfeito pela
// ORDEM DE DUAS LINHAS, um `rollback to savepoint` que tem de vir antes do
// `commit`. Ordem de linha nao e garantia — basta alguem mover, editar ou
// engolir aquela linha num refactor para o `commit` PUBLICAR o `select true`.
//
// ⚠️ E O ESTRAGO SERIA CALADO E ENORME. O portao nao guarda so as funcoes de
// conta: ele e o `using` das politicas de RLS de SEIS tabelas —
// `vessel_pessoas`, `vessel_atendimentos`, `vessel_convite_aberturas`,
// `vessel_client_advisors`, `vessel_pedidos` e `vessel_pedido_itens`. Um
// `select true` no lugar dele abre as seis de uma vez, para qualquer pessoa
// logada no iamundi, sem erro nenhum para denunciar. E o stub tambem larga
// pelo caminho o `security definer` e o `set search_path = public` — duas
// perdas que nem aparecem em quem sabe ler o resultado da funcao.
//
// ⚠️ E SAO DOIS PORTOES, NAO UM. Desde
// `db/migrations/2026-09-19-vessel-trava-de-editar.sql`, quem MUDA dado no
// Comercial Vessel passa por `is_vessel_atendimentos_editar()` — editar,
// apagar, arquivar e (desde
// `db/migrations/2026-09-19-vessel-encerrar-exige-editar.sql`) encerrar. Uma
// conferencia que so olhasse o portao de ver aprovaria um banco onde o portao
// de mexer virou `select true`: as escritas todas ficariam abertas para quem
// so tem permissao de OLHAR, e nada nesta conferencia diria uma palavra. Pior:
// `is_vessel_atendimentos_editar()` CHAMA `is_vessel_atendimentos()` por
// dentro, entao o portao de ver continuaria intacto e passando enquanto o de
// mexer estivesse escancarado — o caso exato em que uma conferencia pela
// metade da a impressao mais forte de estar tudo bem.
//
// ⚠️ A REGUA E O ARQUIVO, NAO UMA STRING REDIGITADA. O corpo esperado de cada
// portao e lido da migration ONDE AQUELE PORTAO NASCEU. Redigitar o corpo aqui
// criaria uma segunda verdade que envelhece sozinha: mudar o portao de verdade
// e esquecer desta copia faria a conferencia reprovar uma migration correta —
// ou, pior, aprovar uma errada.
import { readFileSync } from 'node:fs'

export const PORTAO = 'public.is_vessel_atendimentos()'
export const PORTAO_EDITAR = 'public.is_vessel_atendimentos_editar()'

/**
 * Os dois portoes e a migration que criou cada um.
 *
 * ⚠️ CADA UM LE O SEU PROPRIO ARQUIVO. Apontar os dois para a mesma migration
 * seria o mesmo erro da string redigitada, so que mais dificil de enxergar.
 */
const PORTOES = [
  {
    proname: 'is_vessel_atendimentos',
    rotulo: PORTAO,
    origem: '../../db/migrations/2026-09-17-vessel-atendimentos-leitura.sql',
  },
  {
    proname: 'is_vessel_atendimentos_editar',
    rotulo: PORTAO_EDITAR,
    origem: '../../db/migrations/2026-09-19-vessel-trava-de-editar.sql',
  },
]

const acharPortao = (proname) => {
  const p = PORTOES.find((x) => x.proname === proname)
  if (!p) throw new Error(`nao conheco o portao ${proname}`)
  return p
}

/**
 * O corpo de um portao COMO ESTA NA MIGRATION que o criou.
 *
 * ⚠️ O PADRAO CONTINUA SENDO O PORTAO DE VER, de proposito: esta funcao ja era
 * exportada assim e `coletor/provar-que-o-portao-e-conferido.mjs` a chama sem
 * argumento nenhum. Trocar o padrao faria aquele arquivo passar a estragar
 * outro portao sem que uma linha dele mudasse.
 */
export function corpoOriginalDoPortao(proname = 'is_vessel_atendimentos') {
  const { rotulo, origem } = acharPortao(proname)
  const texto = readFileSync(new URL(origem, import.meta.url), 'utf8')
  // Tudo entre o `as $$` da declaracao do portao e o `$$;` que a fecha — que e
  // exatamente o que o Postgres guarda em `pg_proc.prosrc`, newlines inclusas.
  //
  // ⚠️ O `\\(\\)` NO FIM DO NOME NAO E ENFEITE: sem ele, o padrao do portao de
  // ver casaria tambem com a declaracao de `is_vessel_atendimentos_editar`, e a
  // conferencia compararia o portao de ver com o corpo do portao de mexer.
  const m = texto.match(new RegExp(
    `create or replace function public\\.${proname}\\(\\)[\\s\\S]*?\\bas \\$\\$([\\s\\S]*?)\\$\\$;`))
  if (!m) throw new Error(`nao achei o corpo de ${rotulo} em ${origem}`)
  return m[1]
}

/**
 * Levanta erro se ALGUM dos dois portoes nao estiver EXATAMENTE como nasceu:
 * mesmo corpo, `security definer` ligado e `search_path=public` no
 * `proconfig`.
 *
 * ⚠️ LEVANTA, NAO AVISA. Um `console.warn` aqui viraria mais uma linha no meio
 * do log de um script que segue em frente e da `commit` — que e precisamente o
 * desfecho que esta conferencia existe para impedir.
 *
 * ⚠️ CHAMAR DEPOIS DO `rollback to savepoint` E ANTES DO `commit` — e antes de
 * imprimir qualquer linha de sucesso. Conferir depois do commit nao serve de
 * nada: a essa altura o estrago ja esta publicado.
 */
export async function conferirQueOPortaoVoltou(cli) {
  for (const { proname, rotulo } of PORTOES) {
    const { rows } = await cli.query(
      `select p.prosrc, p.prosecdef, coalesce(p.proconfig, '{}') as proconfig
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`, [proname])
    if (rows.length !== 1) throw new Error(`${rotulo}: ${rows.length} versao(oes) no banco`)
    const [p] = rows
    const esperado = corpoOriginalDoPortao(proname)
    if (p.prosrc !== esperado)
      throw new Error(
        `${rotulo} NAO VOLTOU: o corpo no banco nao e o da migration que o criou. ` +
        `No banco: ${JSON.stringify(p.prosrc)}`)
    if (p.prosecdef !== true)
      throw new Error(`${rotulo} voltou SEM security definer`)
    if (!p.proconfig.includes('search_path=public'))
      throw new Error(`${rotulo} voltou sem search_path=public: ${JSON.stringify(p.proconfig)}`)
  }
  return true
}
