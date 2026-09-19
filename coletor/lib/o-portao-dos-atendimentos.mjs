// CONFERE QUE O PORTAO `public.is_vessel_atendimentos()` VOLTOU INTEIRO.
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
// ⚠️ A REGUA E O ARQUIVO, NAO UMA STRING REDIGITADA. O corpo esperado e lido
// de `db/migrations/2026-09-17-vessel-atendimentos-leitura.sql`, que e onde o
// portao nasceu. Redigitar o corpo aqui criaria uma segunda verdade que
// envelhece sozinha: mudar o portao de verdade e esquecer desta copia faria a
// conferencia reprovar uma migration correta — ou, pior, aprovar uma errada.
import { readFileSync } from 'node:fs'

export const PORTAO = 'public.is_vessel_atendimentos()'
const ORIGEM = '../../db/migrations/2026-09-17-vessel-atendimentos-leitura.sql'

/** O corpo do portao COMO ESTA NA MIGRATION que o criou. */
export function corpoOriginalDoPortao() {
  const texto = readFileSync(new URL(ORIGEM, import.meta.url), 'utf8')
  // Tudo entre o `as $$` da declaracao do portao e o `$$;` que a fecha — que e
  // exatamente o que o Postgres guarda em `pg_proc.prosrc`, newlines inclusas.
  const m = texto.match(
    /create or replace function public\.is_vessel_atendimentos\(\)[\s\S]*?\bas \$\$([\s\S]*?)\$\$;/)
  if (!m) throw new Error(`nao achei o corpo de ${PORTAO} em ${ORIGEM}`)
  return m[1]
}

/**
 * Levanta erro se o portao nao estiver EXATAMENTE como nasceu: mesmo corpo,
 * `security definer` ligado e `search_path=public` no `proconfig`.
 *
 * ⚠️ CHAMAR DEPOIS DO `rollback to savepoint` E ANTES DO `commit` — e antes de
 * imprimir qualquer linha de sucesso. Conferir depois do commit nao serve de
 * nada: a essa altura o estrago ja esta publicado.
 */
export async function conferirQueOPortaoVoltou(cli) {
  const { rows } = await cli.query(
    `select p.prosrc, p.prosecdef, coalesce(p.proconfig, '{}') as proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'is_vessel_atendimentos'`)
  if (rows.length !== 1) throw new Error(`${PORTAO}: ${rows.length} versao(oes) no banco`)
  const [p] = rows
  const esperado = corpoOriginalDoPortao()
  if (p.prosrc !== esperado)
    throw new Error(
      `${PORTAO} NAO VOLTOU: o corpo no banco nao e o da migration que o criou. ` +
      `No banco: ${JSON.stringify(p.prosrc)}`)
  if (p.prosecdef !== true)
    throw new Error(`${PORTAO} voltou SEM security definer`)
  if (!p.proconfig.includes('search_path=public'))
    throw new Error(`${PORTAO} voltou sem search_path=public: ${JSON.stringify(p.proconfig)}`)
  return true
}
