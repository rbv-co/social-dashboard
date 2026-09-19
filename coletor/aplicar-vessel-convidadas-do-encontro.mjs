// APLICA, REGISTRA e PROVA o "ver quem foi" do Private Edit:
// `public.vessel_convidadas_do_encontro(text, int)`.
//
// ⚠️ TUDO NUMA TRANSACAO SO: aplicar, registrar, provar e so entao `commit`.
// DDL no Postgres e transacional — nao existe um instante em que a tela de
// alguem encontre uma funcao pela metade.
//
// ⚠️⚠️ `vessel_pedidos` TEM DADO DE VERDADE: 457 pedidos e 1.126 itens do
// comercial, medidos antes desta prova. As tabelas de gente
// (`vessel_pessoas`, `vessel_atendimentos`, `vessel_private_edits`,
// `vessel_stylists`) estao VAZIAS — cada linha que esta prova enxerga nelas foi
// ela quem criou. Por isso:
//   · toda linha inventada nasce e morre entre `savepoint prova` e
//     `rollback to savepoint prova`;
//   · dos pedidos de verdade se tira uma IMPRESSAO campo a campo ANTES de
//     escrever qualquer coisa, e ela tem de voltar identica depois do rollback
//     E DE NOVO depois do commit, numa conexao nova. Contar 457 nao pegaria um
//     pedido EDITADO no lugar de outro.
//   · as tres Beauty Sessions de verdade tambem entram na impressao, porque
//     este arquivo abre a mesma transacao que elas veem.
//
// ⚠️ ESTA PROVA NAO TROCA NENHUM PORTAO POR `select true`. O caminho e o das
// irmas: FABRICAR SESSAO DE VERDADE com `set_config('request.jwt.claims', ...)`,
// que e de onde `auth.uid()` le quem e. Assim a funcao nova e exercitada com a
// TRAVA LIGADA, do jeito que a Central vai chamar — e nao ha um instante sequer
// em que `is_vessel_atendimentos()` (o `using` do RLS de SEIS tabelas) esteja
// aberto.
//
// ⚠️ A PROVA DO `comprou` E O CORACAO DESTE ARQUIVO. Ela monta QUATRO
// convidadas de propriedades diferentes de proposito, porque uma prova com so
// a convidada facil (compareceu e comprou) nao consegue distinguir a regra
// certa — "compareceu E comprou dentro da janela" — da regra errada e obvia,
// "comprou alguma vez na vida". As duas passariam. Ver o bloco 4c.
//
// ⚠️ NENHUMA DATA CRAVADA: o encontro e as compras sao posicionados em
// OFICINAS de dias a partir de `now()`, e as compras a partir do DIA DO
// ENCONTRO. Uma prova com '2026-10-15' escrito na mao comeca a mentir sozinha
// no dia seguinte a janela passar.
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { conferirQueOPortaoVoltou } from './lib/o-portao-dos-atendimentos.mjs'

const ARQUIVO = '2026-09-19-vessel-convidadas-do-encontro.sql'
const FUNCAO = 'public.vessel_convidadas_do_encontro(text, integer)'

const PE = 'PE-20260919-CPS-X7'            // o encontro INVENTADO por esta prova
const PE_TORTO = `  ${PE.toLowerCase()}  ` // o mesmo codigo, torto
const STY = 'STY-9997'
const MARCA = 'prova-convidadas-do-encontro'
// ⚠️ ACIMA DE TODA A FAIXA QUE O BLING USA: `bling_pedido_id` e o identificador
// de la, e os 457 pedidos de verdade vao de 26.126.634.450 a 26.906.436.477
// (medido, nao suposto). Um numero ABAIXO do menor deles nao colide na hora de
// gravar — mas a conferencia final, que procura `bling_pedido_id >= PEDIDO_BASE`
// para achar o que a prova deixou para tras, acusaria os 457 pedidos de verdade
// como sobra da prova. Foi exatamente o que aconteceu na primeira rodada deste
// arquivo.
const PEDIDO_BASE = 9000000000001

// A janela padrao da funcao nova, e a que esta prova manda de proposito para
// `vessel_conta_das_private_edits` — o numero do topo e a lista de baixo tem de
// usar a MESMA regua.
const DIAS = 7

// ⚠️ A IMPRESSAO DOS PEDIDOS DE VERDADE, campo a campo e em ordem fixa. Nao e
// `count(*)`: trocar a data ou a receita de um pedido deixaria a contagem igual
// e a impressao diferente.
const IMPRESSAO = `
  select (select count(*) from public.vessel_pedidos)::int as pedidos,
         (select count(*) from public.vessel_pedido_itens)::int as itens,
         (select count(*) from public.vessel_beauty_sessions)::int as sessoes,
         (select md5(coalesce(string_agg(
                   p.id || '|' || p.bling_pedido_id || '|' ||
                   coalesce(p.pessoa_id::text, '~') || '|' || p.data_do_pedido::text || '|' ||
                   coalesce(p.receita_liquida::text, '~') || '|' ||
                   coalesce(p.total_corrigido::text, '~'),
                   E'\\n' order by p.id), ''))
            from public.vessel_pedidos p) as impressao_pedidos,
         (select md5(coalesce(string_agg(
                   b.codigo || '|' || coalesce(b.quando::text, '~') || '|' || b.loja || '|' ||
                   b.ativa::text || '|' || b.arquivada::text,
                   E'\\n' order by b.codigo), ''))
            from public.vessel_beauty_sessions b) as impressao_sessoes`

const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')
const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
await cli.query('begin')
try {
  const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]

  // ── 0. COMO O DADO DE VERDADE ESTA AGORA ─────────────────────────────────
  // ⚠️ ANTES DE ESCREVER QUALQUER COISA, inclusive antes do DDL.
  const antesDeTudo = await uma(IMPRESSAO)
  if (antesDeTudo.pedidos < 1)
    throw new Error('vessel_pedidos veio vazia: a impressao nao provaria nada')
  console.log(`   antes da prova: ${antesDeTudo.pedidos} pedidos, ${antesDeTudo.itens} itens, ${antesDeTudo.sessoes} Beauty Sessions`)

  await cli.query(sql)
  await cli.query(
    `insert into public.schema_migrations (name, observacao) values ($1,$2)
     on conflict (name) do nothing`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-convidadas-do-encontro.mjs'])

  // ── 1. SOBROU UMA SO, com a assinatura combinada ─────────────────────────
  // ⚠️ `create or replace` NAO troca uma funcao por outra de assinatura
  // diferente: cria uma SEGUNDA, sobrecarregada. Com duas no banco, a chamada
  // da tela morreria com "function is not unique" — e morreria DEPOIS do
  // deploy, na mao do usuario.
  {
    const { quantas, assinaturas } = await uma(
      `select count(*)::int as quantas,
              string_agg(p.oid::regprocedure::text, ' | ' order by p.oid::regprocedure::text) as assinaturas
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'vessel_convidadas_do_encontro'`)
    if (quantas !== 1) throw new Error(`a funcao ficou com ${quantas} versoes: ${assinaturas}`)
    if (!assinaturas.endsWith('(text,integer)'))
      throw new Error(`a funcao nao ficou com (text,integer): ${assinaturas}`)
  }

  // ── 2. A PORTA: leitura, entao e a trava de VER — e so para quem logou ────
  // ⚠️ `revoke ... from public` NAO fecha `authenticated`, e uma funcao nova
  // nasce ABERTA para `public` — ou seja, para `anon`, que e quem abre a pagina
  // do convite. Esta funcao devolve NOME E TELEFONE de cliente: `anon` aqui
  // seria a lista de convidadas publicada na internet, que o proprio modulo 07
  // proibe com todas as letras.
  {
    const p = await uma(
      `select has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
              has_function_privilege('anon',$1,'EXECUTE') as anon,
              has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [FUNCAO])
    if (p.autenticado !== true) throw new Error('a Central nao consegue ler as convidadas')
    if (p.anon !== false || p.qualquer_um !== false)
      throw new Error(`as convidadas vazaram para a pagina publica (anon=${p.anon}, public=${p.qualquer_um})`)
  }

  await cli.query('savepoint prova')

  // ── 3. O ENCONTRO, AS CONVIDADAS E AS COMPRAS ────────────────────────────
  const { id: sty } = await uma(
    `insert into public.vessel_stylists (codigo, nome, whatsapp)
     values ($1, 'Anfitria da Prova', '5519966666666') returning id`, [STY])

  // ⚠️ O ENCONTRO FICA NO PASSADO RECENTE (3 dias atras) para que a janela de
  // 7 dias a partir dele ainda esteja aberta hoje — e para que "depois do
  // encontro" e "antes do encontro" sejam dois lados de verdade.
  await uma(
    `insert into public.vessel_private_edits (codigo, chave, stylist_id, quando, praca, loja, vagas)
     values ($1, 'XXXXXXXX', $2, now() - interval '3 days', 'CPS', 'iguatemi', 8)`, [PE, sty])

  const pessoa = async (nome, fone) => (await uma(
    `insert into public.vessel_pessoas (nome, telefone) values ($1,$2) returning id`,
    [nome, fone])).id

  const convidada = async (id, status, teste) => uma(
    `insert into public.vessel_atendimentos
       (pessoa_id, loja, origem_registro, evento_codigo, rsvp, status, teste)
     values ($1,'iguatemi',$2,$3,'sim',$4,$5)`, [id, MARCA, PE, status, teste])

  // ⚠️ A COMPRA E POSICIONADA EM DIAS A PARTIR DO DIA DO ENCONTRO, NO FUSO DE
  // SAO PAULO — a mesma conta que a receita faz. Calcular a data em JavaScript
  // poria o fuso da maquina no meio e a prova passaria a depender de onde ela
  // roda.
  let proximoPedido = PEDIDO_BASE
  const compra = async (id, offsetDias, valor) => uma(
    `insert into public.vessel_pedidos (bling_pedido_id, pessoa_id, data_do_pedido, receita_liquida)
     select $1, $2, (e.quando at time zone 'America/Sao_Paulo')::date + $3::int, $4::numeric
       from public.vessel_private_edits e where e.codigo = $5`,
    [proximoPedido++, id, offsetDias, valor, PE])

  // ── 3a. AS QUATRO CONVIDADAS E A DE TESTE ────────────────────────────────
  // ⚠️ CADA UMA EXISTE PARA SEPARAR UM CASO DO `comprou`. Juntas, elas sao a
  // unica coisa que distingue a regra certa da regra errada.
  //
  //   comprou_dentro  compareceu E comprou na janela ......... comprou = SIM
  //   comprou_fora    compareceu, comprou FORA da janela ..... comprou = nao
  //   nao_veio        comprou na janela, mas NAO compareceu .. comprou = nao
  //   sem_compra      compareceu e nao comprou nada .......... comprou = nao
  const pDentro = await pessoa('Convidada que comprou dentro', '5519955555551')
  const pFora   = await pessoa('Convidada que comprou fora',   '5519955555552')
  const pFaltou = await pessoa('Convidada que nao veio',       '5519955555553')
  const pNada   = await pessoa('Convidada que nao comprou',    '5519955555554')
  const pTeste  = await pessoa('Convidada de teste',           '5519944444444')

  await convidada(pDentro, 'realizado', false)
  await convidada(pFora,   'realizado', false)
  // ⚠️ `no_show` e o caso mais cruel: ela CONFIRMOU e comprou na janela. So o
  // `status = 'realizado'` a separa de quem entra na receita.
  await convidada(pFaltou, 'no_show',   false)
  await convidada(pNada,   'realizado', false)
  await convidada(pTeste,  'realizado', true)

  // ⚠️ UMA DAS COMPRAS DA `dentro` CAI EXATAMENTE NO ULTIMO DIA DA JANELA
  // (dia do encontro + 7). O `between` do Postgres e INCLUSIVO nas duas pontas,
  // e a receita conta com isso; um `<` no lugar do `between` perderia esta
  // compra calado.
  await compra(pDentro, 0, '1000.00')
  await compra(pDentro, DIAS, '250.00')
  // ⚠️ E AS DUAS DA `fora` MIRAM OS DOIS LADOS: uma muito antes do encontro
  // (a compra de "alguma vez na vida") e outra UM DIA depois da janela fechar.
  await compra(pFora, -60, '777.00')
  await compra(pFora, DIAS + 1, '333.00')
  await compra(pFaltou, 1, '555.00')
  await compra(pTeste, 1, '111.00')

  const RECEITA_ESPERADA = 1250          // 1000.00 + 250.00, so a `dentro`
  const RECEITA_JANELA_LARGA = 1583      // + os 333.00 da `fora`, com 70 dias

  // ── 4. PERFIS DE MENTIRA E SESSAO DE VERDADE ─────────────────────────────
  // ⚠️ `profiles.id` tem FK para `auth.users(id)` e `profiles.email` e NOT NULL
  // sem default: por isso cada perfil de mentira nasce em DOIS inserts. Nada
  // disto sobrevive ao `rollback to savepoint prova`.
  const perfil = async (features, permissions) => {
    const id = randomUUID()
    const email = `${MARCA}-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(
      `insert into public.profiles (id, email, features, permissions, is_superadmin)
       values ($1, $2, $3, $4::jsonb, false)`,
      [id, email, features, JSON.stringify(permissions)])
    return id
  }
  // ⚠️ E ASSIM QUE `auth.uid()` LE QUEM E: `request.jwt.claims -> sub`. Falar
  // como alguem aqui e mais honesto do que trocar a trava por `select true` —
  // a trava roda INTEIRA, com o portao de `features` e a acao de `permissions`.
  const falarComo = async (id) => cli.query(
    `select set_config('request.jwt.claims', $1, true)`,
    [id === null ? '' : JSON.stringify({ sub: id })])

  const so_ve   = await perfil(['atendimentos'], { atendimentos: ['ver'] })
  const de_fora = await perfil(['frota'], { frota: ['ver'] })

  const convidadas = async (codigo = PE, dias = DIAS) => (await uma(
    dias === null
      ? `select public.vessel_convidadas_do_encontro($1) as r`
      : `select public.vessel_convidadas_do_encontro($1, $2) as r`,
    dias === null ? [codigo] : [codigo, dias])).r
  const conta = async (dias = DIAS) => (await uma(
    `select public.vessel_conta_das_private_edits($1) as r`, [dias])).r

  // ── 4a. SEM SESSAO E SEM A PERMISSAO: LISTA VAZIA, NUNCA DADO ────────────
  // ⚠️ `auth.uid()` e nulo sem sessao, entao este caso sozinho nao separa "o
  // portao esta ligado" de "o portao nao existe" — por isso vem logo abaixo o
  // perfil que TEM login e NAO tem `atendimentos`.
  await falarComo(null)
  const semSessao = await convidadas()
  if (!Array.isArray(semSessao)) throw new Error(`sem sessao a funcao devolveu ${JSON.stringify(semSessao)}`)
  if (semSessao.length !== 0)
    throw new Error(`sem sessao vazaram ${semSessao.length} convidada(s): ${JSON.stringify(semSessao)}`)

  await falarComo(de_fora)
  const deFora = await convidadas()
  if (deFora.length !== 0)
    throw new Error(`quem nao tem atendimentos leu ${deFora.length} convidada(s): ${JSON.stringify(deFora)}`)

  // ── 4b. QUEM SO VE, VE — a trava daqui e a de VER, nao a de editar ───────
  // ⚠️ ESTE PERFIL E O QUE MORDE A DIFERENCA ENTRE AS DUAS TRAVAS: ele tem
  // `atendimentos` em `features` e NAO tem `editar` em `permissions`. Trocar
  // `is_vessel_atendimentos()` por `is_vessel_atendimentos_editar()` — o erro
  // facil, porque as quatro irmas deste bloco de tela usam a de editar — passa
  // batido por 4a e esconde a lista de quem tem todo o direito de le-la.
  await falarComo(so_ve)
  const lista = await convidadas()

  if (lista.length !== 4)
    throw new Error(`a lista trouxe ${lista.length}, esperava 4: ${JSON.stringify(lista)}`)

  // ⚠️ SO QUEM NAO E `teste` — o MESMO filtro das contas.
  if (lista.some((c) => c.nome === 'Convidada de teste'))
    throw new Error('a convidada de teste entrou na lista')

  const porNome = Object.fromEntries(lista.map((c) => [c.nome, c]))
  const dentro = porNome['Convidada que comprou dentro']
  const fora   = porNome['Convidada que comprou fora']
  const faltou = porNome['Convidada que nao veio']
  const nada   = porNome['Convidada que nao comprou']
  for (const [nome, c] of Object.entries({ dentro, fora, faltou, nada }))
    if (!c) throw new Error(`a convidada ${nome} nao veio na lista: ${JSON.stringify(lista)}`)

  // Os campos do contrato, um por um.
  if (dentro.telefone !== '5519955555551') throw new Error(`telefone errado: ${JSON.stringify(dentro)}`)
  if (dentro.rsvp !== 'sim') throw new Error(`rsvp errado: ${JSON.stringify(dentro)}`)
  if (dentro.status !== 'realizado') throw new Error(`status errado: ${JSON.stringify(dentro)}`)
  if (faltou.status !== 'no_show') throw new Error(`status errado: ${JSON.stringify(faltou)}`)
  if (!('presenca_em' in dentro)) throw new Error(`faltou presenca_em: ${JSON.stringify(dentro)}`)
  if (!('respondeu_em' in dentro)) throw new Error(`faltou respondeu_em: ${JSON.stringify(dentro)}`)
  if (dentro.respondeu_em === null) throw new Error('respondeu_em veio nulo')

  // ── 4c. O `comprou` TEM DE SER A REGRA DA RECEITA ────────────────────────
  // ⚠️ AS QUATRO ASERCOES ABAIXO SAO O MOTIVO DESTE ARQUIVO EXISTIR. Escrito
  // como `exists (select 1 from vessel_pedidos where pessoa_id = t.pessoa_id)`
  // — qualquer compra, de qualquer epoca — a primeira passaria e as duas do
  // meio cairiam. E e exatamente esse o erro que poria "Comprou: Sim" ao lado
  // de uma receita que ignora aquela compra.
  //
  // ⚠️ `!== true` / `!== false`, nunca `if (c.comprou)`: `pg` entrega SQL NULL
  // como `null`, que e falsy em JavaScript — um `comprou` nulo passaria batido
  // por um `if` solto do mesmo jeito que passa um `false`.
  if (dentro.comprou !== true)
    throw new Error(`quem compareceu e comprou na janela nao marcou comprou: ${JSON.stringify(dentro)}`)
  if (fora.comprou !== false)
    throw new Error(`quem comprou FORA da janela marcou comprou: ${JSON.stringify(fora)}`)
  if (faltou.comprou !== false)
    throw new Error(`quem NAO compareceu marcou comprou: ${JSON.stringify(faltou)}`)
  if (nada.comprou !== false)
    throw new Error(`quem nao comprou nada marcou comprou: ${JSON.stringify(nada)}`)

  // ── 4d. O NUMERO DO TOPO E A LISTA DE BAIXO, NA MESMA TELA ───────────────
  // ⚠️ E A MESMA JANELA NOS DOIS: a conta recebe o mesmo `DIAS` que a lista.
  const linha = (await conta(DIAS) || []).find((l) => l.codigo === PE)
  if (!linha) throw new Error('o encontro nao apareceu na conta')

  if (linha.responderam !== lista.length)
    throw new Error(`o topo diz ${linha.responderam} respostas e a lista mostra ${lista.length}`)
  if (linha.compareceram !== lista.filter((c) => c.status === 'realizado').length)
    throw new Error(`o topo diz ${linha.compareceram} presencas e a lista mostra outra coisa`)
  if (linha.confirmadas !== lista.filter((c) => ['confirmado', 'realizado', 'no_show'].includes(c.status)).length)
    throw new Error(`o topo diz ${linha.confirmadas} confirmadas e a lista mostra outra coisa`)

  // ⚠️ E AQUI A AMARRACAO QUE NENHUMA CONTAGEM FAZ: a receita do topo tem de
  // ser EXATAMENTE a soma das compras de quem a lista marcou `comprou`. Se
  // alguem marcado `comprou` nao alimenta a receita — ou se alguem que
  // alimenta a receita ficou sem a marca — as duas contas divergem e esta
  // linha quebra.
  const compradoras = lista.filter((c) => c.comprou === true).map((c) => c.telefone)
  const { soma } = await uma(
    `select coalesce(sum(coalesce(p.receita_liquida, p.total_corrigido, 0)), 0)::text as soma
       from public.vessel_pedidos p
       join public.vessel_pessoas pe on pe.id = p.pessoa_id
      where pe.telefone = any($1)
        and p.data_do_pedido
              between (select (e.quando at time zone 'America/Sao_Paulo')::date
                         from public.vessel_private_edits e where e.codigo = $2)
                  and (select (e.quando at time zone 'America/Sao_Paulo')::date + $3::int
                         from public.vessel_private_edits e where e.codigo = $2)`,
    [compradoras, PE, DIAS])
  if (Number(linha.receita) !== Number(soma))
    throw new Error(`a receita do topo (${linha.receita}) nao e a soma das compras de quem a lista marcou comprou (${soma})`)
  if (Number(linha.receita) !== RECEITA_ESPERADA)
    throw new Error(`a receita do topo deu ${linha.receita}, esperava ${RECEITA_ESPERADA}`)

  // ── 4e. A JANELA E DE VERDADE, E ANDA PARA A FRENTE ──────────────────────
  // ⚠️ COM 70 DIAS a compra da `fora` que caiu UM DIA depois do fim entra, e o
  // `comprou` dela vira SIM — junto com a receita do topo. Sem este caso, um
  // `p_dias` ignorado (janela cravada no corpo da funcao) passaria despercebido.
  // E a compra de 60 dias ANTES continua de fora: a janela comeca no dia do
  // encontro e anda para a frente, nunca para tras.
  const larga = await convidadas(PE, 70)
  const foraLarga = larga.find((c) => c.nome === 'Convidada que comprou fora')
  if (foraLarga.comprou !== true)
    throw new Error(`com 70 dias a compra logo depois da janela continuou de fora: ${JSON.stringify(foraLarga)}`)
  const faltouLarga = larga.find((c) => c.nome === 'Convidada que nao veio')
  if (faltouLarga.comprou !== false)
    throw new Error(`com 70 dias quem nao compareceu passou a contar: ${JSON.stringify(faltouLarga)}`)
  const linhaLarga = (await conta(70) || []).find((l) => l.codigo === PE)
  if (Number(linhaLarga.receita) !== RECEITA_JANELA_LARGA)
    throw new Error(`com 70 dias a receita deu ${linhaLarga.receita}, esperava ${RECEITA_JANELA_LARGA}`)

  // ⚠️ E A JANELA CURTA FECHA: com 0 dias so o que foi comprado NO DIA do
  // encontro conta. A compra da `dentro` no ultimo dia (+7) sai, e ela
  // continua `comprou` pela outra — mas a receita cai.
  const curta = (await conta(0) || []).find((l) => l.codigo === PE)
  if (Number(curta.receita) !== 1000)
    throw new Error(`com 0 dias a receita deu ${curta.receita}, esperava 1000`)

  // ── 4f. O CODIGO TORTO: minusculas e espaco na ponta ─────────────────────
  // ⚠️ AS CINCO ACOES MORAM NO MESMO BLOCO DA TELA — encerrar, editar, apagar,
  // arquivar e este "ver quem foi". As quatro primeiras normalizam o codigo com
  // `upper(nullif(trim(coalesce(p_codigo,'')),''))`; esta copia a MESMA
  // expressao. Sem isso, o mesmo codigo faria os botoes funcionarem e a lista
  // vir vazia — e "ninguem respondeu ainda" e uma MENTIRA de aparencia
  // perfeita, que nenhuma tela denuncia.
  const torta = await convidadas(PE_TORTO)
  if (torta.length !== lista.length)
    throw new Error(`o codigo torto trouxe ${torta.length} convidada(s), esperava ${lista.length}`)
  if (JSON.stringify(torta) !== JSON.stringify(lista))
    throw new Error('o codigo torto trouxe outra lista')
  // ⚠️ E O `comprou` DO CODIGO TORTO TAMBEM: se a busca do encontro lesse o
  // normalizado e a janela viesse de outro lugar — ou vice-versa — a lista
  // sairia certa e o `comprou` errado.
  if (torta.find((c) => c.nome === 'Convidada que comprou dentro').comprou !== true)
    throw new Error('o codigo torto perdeu a janela de venda')

  // Encontro que nao existe: lista vazia, e nao erro nem lista dos outros.
  const inexistente = await convidadas('PE-20260919-CPS-NAOEXISTE')
  if (inexistente.length !== 0)
    throw new Error(`encontro inexistente devolveu ${inexistente.length} convidada(s)`)
  const vazio = await convidadas('   ')
  if (vazio.length !== 0) throw new Error('codigo em branco devolveu convidada')

  // ── 4g. O PADRAO DO `p_dias` E 7, E NULO NAO APAGA A JANELA ──────────────
  // ⚠️ Quem manda `p_dias: null` de fora NAO cai no padrao do parametro, cai em
  // NULL — e `between x and NULL` nao devolve linha nenhuma, calado. Sem o
  // `coalesce`, todo `comprou` viraria `false` e ninguem perceberia.
  const semDias = await convidadas(PE, null)
  if (JSON.stringify(semDias) !== JSON.stringify(lista))
    throw new Error('o padrao de p_dias nao e o mesmo 7 que a prova usou')
  const comNulo = (await uma(
    `select public.vessel_convidadas_do_encontro($1, null) as r`, [PE])).r
  if (JSON.stringify(comNulo) !== JSON.stringify(lista))
    throw new Error('p_dias nulo apagou a janela de venda')

  // ── 5. NADA DISSO FICA ───────────────────────────────────────────────────
  await falarComo(null)
  await cli.query('rollback to savepoint prova')

  // ⚠️ DEPOIS DO ROLLBACK, ANTES DO COMMIT e antes de qualquer linha de
  // sucesso: a sessao de mentira tem de ter ido embora junto.
  const { u } = await uma(`select auth.uid() as u`)
  if (u !== null) throw new Error(`a sessao de mentira sobreviveu ao rollback: ${u}`)

  // ⚠️ E OS DOIS PORTOES CONTINUAM INTEIROS. Esta prova nao troca nenhum por
  // `select true` em momento nenhum — mas a conferencia fica, porque ela e
  // barata e porque o dia em que alguem trouxer um stub para dentro deste
  // arquivo ela e quem avisa, antes do commit.
  await conferirQueOPortaoVoltou(cli)

  // ⚠️⚠️ E O DADO DE VERDADE VOLTOU IDENTICO: os pedidos do comercial, os itens
  // e as Beauty Sessions.
  const depoisDoRollback = await uma(IMPRESSAO)
  for (const campo of ['pedidos', 'itens', 'sessoes', 'impressao_pedidos', 'impressao_sessoes'])
    if (depoisDoRollback[campo] !== antesDeTudo[campo])
      throw new Error(`${campo} nao voltou como estava: ${antesDeTudo[campo]} -> ${depoisDoRollback[campo]}`)

  // E NENHUMA LINHA DE PROVA PODE TER ESCAPADO DO SAVEPOINT.
  // ⚠️ Procura-se pela MARCA de cada linha inventada aqui. `vessel_pedidos` TEM
  // linhas de verdade — uma conferencia escrita como `count(*) = 0` reprovaria
  // migration correta.
  const sobrou = await uma(
    `select (select count(*) from public.vessel_private_edits where codigo = $1)::int as encontros,
            (select count(*) from public.vessel_stylists where codigo = $2)::int as stylists,
            (select count(*) from public.vessel_atendimentos where evento_codigo = $1)::int as convidadas,
            (select count(*) from public.vessel_pessoas where telefone like '55199%')::int as pessoas,
            (select count(*) from public.vessel_pedidos where bling_pedido_id >= $3)::int as pedidos,
            (select count(*) from public.profiles where email like $4)::int as perfis,
            (select count(*) from auth.users where email like $4)::int as contas`,
    [PE, STY, PEDIDO_BASE, `${MARCA}-%`])
  for (const [onde, n] of Object.entries(sobrou))
    if (n !== 0) throw new Error(`sobrou dado de prova em ${onde}: ${n} linha(s)`)

  await cli.query('commit')

  // ── 6. E DE NOVO, DEPOIS DO COMMIT, NUMA CONEXAO NOVA ────────────────────
  // ⚠️ UM `COMMIT` DEPOIS DE ERRO VIRA `ROLLBACK` CALADO, e o script imprime
  // sucesso do mesmo jeito. Conferir na mesma conexao tambem nao resolve: ela
  // pode estar num estado que a proxima nao tera.
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  try {
    const dela = async (s, a = []) => (await outra.query(s, a)).rows[0]

    const { quantas, assinaturas } = await dela(
      `select count(*)::int as quantas,
              string_agg(p.oid::regprocedure::text, ' | ') as assinaturas
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'vessel_convidadas_do_encontro'`)
    if (quantas !== 1 || !assinaturas.endsWith('(text,integer)'))
      throw new Error(`depois do commit a funcao esta ${quantas}x como ${assinaturas}`)

    const p = await dela(
      `select has_function_privilege('authenticated',$1,'EXECUTE') as autenticado,
              has_function_privilege('anon',$1,'EXECUTE') as anon,
              has_function_privilege('public',$1,'EXECUTE') as qualquer_um`, [FUNCAO])
    if (p.autenticado !== true || p.anon !== false || p.qualquer_um !== false)
      throw new Error(`depois do commit a porta esta ${JSON.stringify(p)}`)

    // ⚠️ O PORTAO, DE NOVO, JA PUBLICADO. E a ultima chance de descobrir que
    // alguma coisa foi ao ar aberta.
    await conferirQueOPortaoVoltou(outra)

    const agora = await dela(IMPRESSAO)
    for (const campo of ['pedidos', 'itens', 'sessoes', 'impressao_pedidos', 'impressao_sessoes'])
      if (agora[campo] !== antesDeTudo[campo])
        throw new Error(`depois do commit, ${campo} esta diferente: ${antesDeTudo[campo]} -> ${agora[campo]}`)

    const { registrada } = await dela(
      `select exists (select 1 from public.schema_migrations where name = $1) as registrada`, [ARQUIVO])
    if (registrada !== true) throw new Error('a migration nao ficou registrada: o commit nao pegou')

    console.log(`   ${agora.pedidos} pedidos, ${agora.itens} itens e ${agora.sessoes} Beauty Sessions, identicos aos de antes da prova`)
  } finally { await outra.end() }

  console.log('✅ aplicada, registrada e provada:', ARQUIVO)
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error('❌ nao aplicada:', e.message)
  process.exitCode = 1
} finally { await cli.end() }
