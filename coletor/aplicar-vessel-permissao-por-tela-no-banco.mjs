// APLICA, REGISTRA e PROVA o B13: cada função do Comercial Vessel confere a
// chave da SUA tela, não mais a da família.
//
//   node --env-file=coletor/.env coletor/aplicar-vessel-permissao-por-tela-no-banco.mjs            → ensaio: prova tudo e DESFAZ
//   node --env-file=coletor/.env coletor/aplicar-vessel-permissao-por-tela-no-banco.mjs --gravar   → prova tudo e só então grava
//
// ⚠️ TUDO NUMA TRANSAÇÃO SÓ: aplicar, registrar em `schema_migrations`, provar
// e só então `commit` — conferido (`.command === 'COMMIT'`). Nenhum `.catch`
// dentro da transação: um erro engolido faria o COMMIT virar ROLLBACK calado.
//
// ⚠️ ANTES DE APLICAR, CONFERE QUE O BANCO ESTÁ ONDE A MIGRATION PARTIU: o
// corpo de cada uma das 49 funções saiu do `pg_get_functiondef` de 25/09/2026
// (sha256 abaixo, em MEDIDO). Se alguém mexeu numa delas depois, o ensaio PARA
// e diz qual — a migration apagaria a mudança. Refazer: gerar de novo a partir
// do banco de agora, trocando só a linha da trava.
//
// ⚠️ AS CONTAS DE PROVA NASCEM DENTRO DE SAVEPOINT e morrem com ele. (Em
// 25/09/2026 havia 8 contas `prova-*@teste.invalido` em produção, em
// `auth.users` e `profiles`: aplicadores anteriores criaram os perfis de prova
// FORA do savepoint e gravaram com `--gravar`. Este não repete isso — e a
// impressão do fim confere que o número de contas não mudou.)
//
// O QUE A PROVA MOSTRA:
//   1. ANTES (desfeito): o buraco reproduzido — quem tem só uma tela passa nas
//      funções das outras. É também o controle que TEM de falhar: se a
//      classificação não soubesse ver "passou", o DEPOIS não provaria nada.
//   2. Estrutura: as 49 funções ficaram EXATAMENTE com o texto da migration;
//      nenhuma outra função do schema mudou (inclusive as da página pública);
//      grants iguais; as 5 políticas trocadas, as 4 da base comum intactas.
//   3. As PESSOAS DE VERDADE: para cada perfil real e cada função, "passava
//      antes" contra "passa depois" contra "a Central mostra a tela" — só lê
//      `profiles`, avalia as travas, não chama função nenhuma.
//   4. DEPOIS: cada uma das 49 funções chamada de verdade (como o PostgREST:
//      papel authenticated, argumentos por nome, cada chamada no seu savepoint)
//      por 13 perfis de mentira — só Material Gráfico, só Beauty Sessions, só
//      Stylist Circle, super-admin, desativado… — e pelo anon.
//
// DATABASE_URL: coletor/.env OU o ambiente (`node --env-file=<.env> …`).
import './lib/carregar-env.mjs'
import { readFileSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import pg from 'pg'

const ARQUIVO = '2026-09-25-vessel-permissao-por-tela-no-banco.sql'
const GRAVAR = process.argv.includes('--gravar')
const PRECISA = [
  '2026-09-24-permissoes-das-ferramentas-do-comercial-vessel.sql',
  '2026-09-25-vessel-agenda-do-private-edit.sql',
  '2026-09-25-vessel-codigos-sty-e-ca-sem-repetir.sql',
  '2026-09-25-vessel-convite-da-convidada-teto-e-abertura-da-equipe.sql',
]

const PA = 'atendimentos', BS = 'atendimentos.beauty-sessions', PE = 'atendimentos.private-edit'
const SC = 'atendimentos.stylist-circle', MG = 'atendimentos.material-grafico', CARD = 'atendimentos.appointment-card'

// ── A REGRA DE CADA FUNÇÃO: [nível de hoje, telas que a chamam de verdade] ──
// Medido no código da Central em 25/09/2026. Várias telas = OU.
const REGRAS = {
  vessel_beauty_session_apagar: ['editar', [BS]],
  vessel_beauty_session_arquivar: ['editar', [BS]],
  vessel_beauty_session_cadastrar_lead: ['editar', [BS]],
  vessel_beauty_session_criar: ['editar', [BS]],
  vessel_beauty_session_editar: ['editar', [BS]],
  vessel_beauty_session_encerrar: ['editar', [BS]],
  vessel_leads_da_beauty_session: ['ver', [BS]],
  vessel_conta_das_beauty_sessions: ['ver', [BS, MG]],
  vessel_criar_private_edit: ['editar', [PE]],
  vessel_convidar_para_encontro: ['editar', [PE]],
  vessel_private_edit_apagar: ['editar', [PE]],
  vessel_private_edit_arquivar: ['editar', [PE]],
  vessel_private_edit_editar: ['editar', [PE]],
  vessel_private_edit_encerrar: ['editar', [PE]],
  vessel_private_edit_situacao: ['editar', [PE]],
  vessel_agenda_das_lojas: ['ver', [PE]],
  vessel_chave_da_convidada: ['ver', [PE]],
  vessel_convidadas_do_encontro: ['ver', [PE]],
  vessel_convite_marcar: ['ver', [PE]],
  vessel_private_edit_sobreposicoes: ['ver', [PE]],
  vessel_stylists_para_escolher: ['ver', [PE]],
  vessel_conta_das_private_edits: ['ver', [PE, MG]],
  vessel_stylist_avaliar: ['editar', [SC]],
  vessel_stylist_criar: ['editar', [SC]],
  vessel_stylist_desativar: ['editar', [SC]],
  vessel_stylist_editar: ['editar', [SC]],
  vessel_stylist_etapa_criar: ['editar', [SC]],
  vessel_stylist_etapa_excluir: ['editar', [SC]],
  vessel_stylist_etapa_liberar_private_edit: ['editar', [SC]],
  vessel_stylist_etapa_marcar_prospectada: ['editar', [SC]],
  vessel_stylist_etapa_mover: ['editar', [SC]],
  vessel_stylist_etapa_renomear: ['editar', [SC]],
  vessel_stylist_etapa_tipo: ['editar', [SC]],
  vessel_stylist_motivo_ativar: ['editar', [SC]],
  vessel_stylist_motivo_criar: ['editar', [SC]],
  vessel_stylist_motivo_exigir_nota: ['editar', [SC]],
  vessel_stylist_motivo_mover: ['editar', [SC]],
  vessel_stylist_motivo_renomear: ['editar', [SC]],
  vessel_stylist_mover_de_etapa: ['editar', [SC]],
  vessel_stylist_registrar_contato: ['editar', [SC]],
  vessel_placar_do_stylist_circle: ['ver', [SC]],
  vessel_qualificacoes_vigentes: ['ver', [SC]],
  vessel_scorecard_da_stylist: ['ver', [SC]],
  vessel_stylist_contatos: ['ver', [SC]],
  vessel_stylist_historico_de_etapas: ['ver', [SC]],
  vessel_stylist_qualificacoes: ['ver', [SC]],
  vessel_rastreio_dos_stylists: ['ver', [SC, MG]],
  vessel_stylist_etapas: ['ver', [SC, PE]],
  vessel_situacao_do_atendimento: ['ver', [PA, PE]],
}
const FUNCOES = Object.keys(REGRAS)
const portao = (nivel, fs) => fs.length === 1
  ? `public.vessel_pode('${fs[0]}', '${nivel}')`
  : '(' + fs.map((f) => `public.vessel_pode('${f}', '${nivel}')`).join(' or ') + ')'
const familia = (nivel) => nivel === 'editar' ? 'public.is_vessel_atendimentos_editar()' : 'public.is_vessel_atendimentos()'

// As três que recusam devolvendo LISTA VAZIA (e não erro): para elas "vazio"
// só quer dizer "recusou" porque a prova monta dado antes (contato, avaliação,
// convidada) e confere que quem pode vê.
const RECUSA_VAZIA = new Set(['vessel_convidadas_do_encontro', 'vessel_stylist_contatos', 'vessel_stylist_qualificacoes'])

// ── A POLÍTICA DE CADA TABELA ───────────────────────────────────────────────
const POLITICAS_TROCADAS = {
  vessel_private_edits: "vessel_pode('atendimentos.private-edit'::text, 'ver'::text)",
  vessel_sessao_aberturas: "vessel_pode('atendimentos.beauty-sessions'::text, 'ver'::text)",
  vessel_stylist_aberturas: "vessel_pode('atendimentos.stylist-circle'::text, 'ver'::text)",
  vessel_convite_aberturas: "vessel_pode('atendimentos'::text, 'ver'::text)",
  vessel_client_advisors: "vessel_pode('atendimentos'::text, 'ver'::text)",
}
const POLITICAS_DA_BASE_COMUM = ['vessel_pessoas', 'vessel_atendimentos', 'vessel_pedidos', 'vessel_pedido_itens']

// ── O TEXTO DE ONDE A MIGRATION PARTIU (sha256 de pg_get_functiondef, 25/09/2026)
// e o texto que cada uma TEM de ter depois (o mesmo, trocada só a trava).
const MEDIDO = {
  'vessel_beauty_session_apagar(text)': '8fc55348ee1038deae4a53a1acc75d06a527a68763fab1e78a8e88602ec83114',
  'vessel_beauty_session_arquivar(text,boolean)': 'a5e63d659d6e621646d3fa7476ba81f52a64e36aa17d8dcc913f153428838e38',
  'vessel_beauty_session_cadastrar_lead(text,text,text,text,text)': 'fadd957ef637f3d359b144e5871afbf8eb03515da7133342334a1500176f2d6d',
  'vessel_beauty_session_criar(text,date,text,text,text)': '2be14aa550f1f6a6a22edb5ecd6b440395a36136a40af87376ab72d62a58e6d0',
  'vessel_beauty_session_editar(text,date,text)': 'aa70febf113209a0d94adddcef9d9d0ff5d59e5aeaf91214ab4251dc6b96d8d5',
  'vessel_beauty_session_encerrar(text,boolean)': '8e9d03e2988862aa1681b6e8f98ea388d98334280f5f44375c80821f8ce4e20b',
  'vessel_leads_da_beauty_session(text,integer)': 'ab339a62d4b671254de1b6878e5fabd09b36886393bb5073edc1a791e3223fe0',
  'vessel_conta_das_beauty_sessions(integer,boolean)': 'cc196ac81e13a8bd5817f93789dd10852dc12cc300c563723e417aaf0a709079',
  'vessel_criar_private_edit(text,timestamp with time zone,text,text,text,integer,boolean,boolean)': 'fdb43ab4fd1dc699e685cacbc028fd09e002ccc92a7223411db64ef30ed683c5',
  'vessel_convidar_para_encontro(text,text,text,text)': '71093f807f415398e4a0a914c1ffebd4bd12c3e91ee85c57482ad92b39e16827',
  'vessel_private_edit_apagar(text)': '5d907c519af3dd8c0b8b45881b07766fc2e9e4e948749d887752a282b0600287',
  'vessel_private_edit_arquivar(text,boolean)': '6eec03528ededc1e12190fa3b2a85071d219ca84f73d28466445094937775416',
  'vessel_private_edit_editar(text,timestamp with time zone,text,text,text,integer,text,boolean)': 'd535dfd7c74a710082656376387c343dfc06c3ba65be4e68f28c86db4b2b0680',
  'vessel_private_edit_encerrar(text,boolean)': '2b7e7f323dbc1c1943daa1991c90b713894b1be49421bba010fb91ca5ca09749',
  'vessel_private_edit_situacao(text,text,date,text,text)': 'f250c92829145fa7b6d311bd63fe91682aefdaf43b9b7f6e845324093e395a93',
  'vessel_agenda_das_lojas(date,date,text)': 'cfd280aa24676c7cde32f47d949324c733d48b127c0ee3de5a067c115f8424b2',
  'vessel_chave_da_convidada(bigint)': '2a446180f9dc6a199611f74307dfe0c085bf9a230ed78bbcc6b38fb29c935493',
  'vessel_convidadas_do_encontro(text,integer)': 'a9ef7060507e16f4ee3704cdca43a643bb68f9dc61492eed3769ddf34d62c39a',
  'vessel_convite_marcar(bigint,text)': '8d552b4de7a6b4d5e27ab3b26cbffbbb13a730e235f8a51ad1d231d2459f9d73',
  'vessel_private_edit_sobreposicoes(timestamp with time zone,text,text,text,text)': '5db98f340b92c224effec7da0662919c68c00e0081bf16ffb0f6b54aa2ea0757',
  'vessel_stylists_para_escolher()': '22f873962662bb9f64db22c9b995a96b581dd1257d3317e088ee4735d318e4ba',
  'vessel_conta_das_private_edits(integer,boolean)': '787808759d7756d80c6949116f378e629721551738d71ae96145ff32beeb571c',
  'vessel_stylist_avaliar(text,integer,integer,integer,integer,integer,text)': 'fce3197ce6bf5305d5c43cb3ae549781a52134e890bf895ae4e7dcb5589b1aac',
  'vessel_stylist_criar(text,text,text,text,text,text,text,text,text,date,text,date,text,boolean)': 'c487e771cbe84e625387476ff86255fb02379b38a8670d4958fca004468ef9cb',
  'vessel_stylist_desativar(text,boolean)': '437955457ac3caa3b74824b410c6a9318379aab10fea2812fd7a39722eb61c69',
  'vessel_stylist_editar(text,text,text,text,text,text,text,text,text,text,text,date,text,date,boolean,text,boolean)': 'ffd328cb4d0dc607c8f0bc59c36152c126978c59829e919e7a81425de63b861f',
  'vessel_stylist_etapa_criar(text,integer,text)': 'eda88a7f07bb6b72878768aec4857b213db17868c5315b3a898e6618d41d80fa',
  'vessel_stylist_etapa_excluir(bigint,bigint,bigint,text)': '4c92a143917c42af994b88fd6394b27bbcd7be5db838bbbe0d91a9b4dfde2b58',
  'vessel_stylist_etapa_liberar_private_edit(bigint,boolean)': '6aefdc516211ab8ce2205bf6697efc486df4292211f04fca2e7e69eeae970b73',
  'vessel_stylist_etapa_marcar_prospectada(bigint)': '18ce7620b56482669bd8de8fdc9de90737752430d2d31809a2403b809ecaf2ce',
  'vessel_stylist_etapa_mover(bigint,text)': '844fc148bba7790765f60dc64e84b2b93fb980c4ca98bf9fc48356669f810e84',
  'vessel_stylist_etapa_renomear(bigint,text)': '5c36b1f913c12c0459af8678bf4a60ce75a278393c09c1b503d287fa42cf2193',
  'vessel_stylist_etapa_tipo(bigint,text)': 'f1c4fee08816a69d0e28d8e81e277ccb25c3b5f9d08e2e872f88181f27380d39',
  'vessel_stylist_motivo_ativar(bigint,boolean)': 'c0558069a367e8d784941bf80e4c8b08935aac3dfd45196c4616e462eb605ae5',
  'vessel_stylist_motivo_criar(bigint,text,boolean)': '18d3181e1a662e4614c46cd104c3d5809302210c79525fdfa9ccba4fdfa5a7ab',
  'vessel_stylist_motivo_exigir_nota(bigint,boolean)': '429e1b32fe3122e34b369ede14ad949dd45780fc6df2e57326a6fe428dabb2d5',
  'vessel_stylist_motivo_mover(bigint,text)': '89838cd5e509c4a3f969cca91c758bc45f3eec75cc1a7d5cca76e851c8805866',
  'vessel_stylist_motivo_renomear(bigint,text)': '571bdb7f340bfab9deabf431c2a2450b182b37ded8e1cef630a897418b7ad046',
  'vessel_stylist_mover_de_etapa(text,bigint,bigint,text)': '8af70ca92985f93901ae34f7b8c72da104f28cfd7fa8aa8afb15319e60a1b7f3',
  'vessel_stylist_registrar_contato(text,text,text,text,text,date)': '3a3b8394fc2d560926be16d2d5a8f661f09283dee6be22964a7d33fcffcc07f6',
  'vessel_placar_do_stylist_circle(date,date,integer)': '30d57372bd1991cb111b4022e1921e4bcd344dcfeb4b7f7220d6f93c48143034',
  'vessel_qualificacoes_vigentes()': '0bafb6656c1f808e58dc2233b6c89b2723ede950c2a0e62a76824b8b00ad9b68',
  'vessel_scorecard_da_stylist(text,date,date,integer)': '0e251185a325df9cc21e26a866bf584ce5e2b5e79700957f2d75519adcdb5136',
  'vessel_stylist_contatos(text)': '7cafc257f629fd27dcb5d3f535a2fdbbf6c147fad5df00187d97f4b634d3f441',
  'vessel_stylist_historico_de_etapas(text)': 'd24ff1198f59951d83589e1489af4c367e9a9f498a4af5547fbb4f29572134af',
  'vessel_stylist_qualificacoes(text)': 'fef85d84fe21a836ee3a82a02556630d9b91be0ab7086b2fc9605378eb7b068a',
  'vessel_rastreio_dos_stylists(integer,boolean)': 'e33753e0523cf3ca5f7ca082aa6e6689e51d3d8ab825555f71ba3127f492c5fb',
  'vessel_stylist_etapas()': '56adae6db89d105a59195fbad787969807acc0da216b0ea7e319f7e394aff576',
  'vessel_situacao_do_atendimento(bigint,text)': 'fb8e2c4d223800794c7671658170413daff62239890db0cc4b4067b3222bdfc8',
}

const NOVO = {
  'vessel_beauty_session_apagar(text)': '69203324c1a81dcff30f506c914bdf0cf80884eb1c0805a8651d8eb8870a6b32',
  'vessel_beauty_session_arquivar(text,boolean)': '2765c243ee396b7b7df3fe8d3c2ad569776611e59aa62ef8013d6e7ba0cc2f12',
  'vessel_beauty_session_cadastrar_lead(text,text,text,text,text)': '82790666f4e363e19b4ed4a0cdcad76e29d63788822854cb61ed2469a8656e04',
  'vessel_beauty_session_criar(text,date,text,text,text)': '1b8201a13a6c5e7b94f00771b68ee1bb49c99d602b9aa7911616d2eb5b363108',
  'vessel_beauty_session_editar(text,date,text)': '2b5f0c1df81b0d6a66e61c6fc14328502932293eabd679b5f4c100149cdf7a9d',
  'vessel_beauty_session_encerrar(text,boolean)': '2a38370ee1b48e47d25ccd8d1f37ccf9686ad3aa67a0015174bfcba478c0ed52',
  'vessel_leads_da_beauty_session(text,integer)': '8d41073be564c02ec16dbb6aa2448e1b3043d875ecb05d1bb2dbe2bc363166f3',
  'vessel_conta_das_beauty_sessions(integer,boolean)': '53bb92072d1e3b64eda486228eb48717f75b01399d927e882589350c52a99b51',
  'vessel_criar_private_edit(text,timestamp with time zone,text,text,text,integer,boolean,boolean)': '4f94b4e79a5016d00dc26392b3ec268bea41332cd2b39846d5aab53f43c80c5f',
  'vessel_convidar_para_encontro(text,text,text,text)': 'e0a7a91614756e0151f18d262592a45b099546b44e88e34a33ec747925ac33cc',
  'vessel_private_edit_apagar(text)': 'e98ed1d1820faa1c8ce53434809d85d67dea66dc8b41b362befd4318ecda87ea',
  'vessel_private_edit_arquivar(text,boolean)': 'bfe01c42b520e368a18141274bf6441320336fcf4297ad10580e2e66d82ffdae',
  'vessel_private_edit_editar(text,timestamp with time zone,text,text,text,integer,text,boolean)': '244c55051f067cf88b4b7f926d4bcad6d1ca8fc04b2cc35ccebddcbf9f57888f',
  'vessel_private_edit_encerrar(text,boolean)': '7e71386e2526e477f9ac4394ce5a6a7d60829f5adadcc1b8cf7d3d0a6e10258b',
  'vessel_private_edit_situacao(text,text,date,text,text)': 'aa8805516d8bd934849ee903d1721eee9ceaaa1b29cb7b2b9614a365e3707189',
  'vessel_agenda_das_lojas(date,date,text)': '4ca80277e16426de2220fc3d4c25371191ca93137412f40ceaa3fa666c2d7aa6',
  'vessel_chave_da_convidada(bigint)': '78d7e83ef7f5b0febb22d423ca4482e8c89e14a948bc2d3f16a618f215a9851d',
  'vessel_convidadas_do_encontro(text,integer)': 'f15876dbabb588b5cdd673ef07370041c7ac6ae93ee021b045b5ab38a00dec5e',
  'vessel_convite_marcar(bigint,text)': '101fbf9fe6d0bb7bf231fa725e3a2456868ffbea9cba26adcf8e37a433876caa',
  'vessel_private_edit_sobreposicoes(timestamp with time zone,text,text,text,text)': 'af685734abed42ce7a8f4a3475cc4afc04d241aa124acc0e0378d4f50a622c95',
  'vessel_stylists_para_escolher()': '4189273e45692b5a77279ed65f9928a746661c3f50534ce13847e2762541474d',
  'vessel_conta_das_private_edits(integer,boolean)': 'da0f36f8163b0dd56a09f5f0882d5824aac07c65f4b27e6d3cad2f6ba6852ecc',
  'vessel_stylist_avaliar(text,integer,integer,integer,integer,integer,text)': 'ac12e7daa2a08832823499622094c958b9478e5d72a4231331873063d2583970',
  'vessel_stylist_criar(text,text,text,text,text,text,text,text,text,date,text,date,text,boolean)': '8b7ac0043c48f2e7a9376e017d92147b2c269c018a9c8325e26a80447b3e2fb2',
  'vessel_stylist_desativar(text,boolean)': '7d32bd8b377a202008402d8b12f7eea8098c417b7d4c9649674adeb774df8b2c',
  'vessel_stylist_editar(text,text,text,text,text,text,text,text,text,text,text,date,text,date,boolean,text,boolean)': '6fa8b2fdfc982fe7873795f1c6605a0e9460a0545ba1e671131dd3e5761d8e62',
  'vessel_stylist_etapa_criar(text,integer,text)': '79726407c1be945622a9daf91a76ab88a815628a40f824f688d0fee6c0215eb9',
  'vessel_stylist_etapa_excluir(bigint,bigint,bigint,text)': 'af03928e63bb9fd325370310a91409c085ba679d6e87c8d48a1ae5af8474b174',
  'vessel_stylist_etapa_liberar_private_edit(bigint,boolean)': '73077c5f9c2cae28bc768d8695052f535b916a3237421fb421dc8395b4cb887f',
  'vessel_stylist_etapa_marcar_prospectada(bigint)': 'a69a0adab257a43c9d7e85f413ae84bdb05389e2c9cf04fe91eed0dec47159c6',
  'vessel_stylist_etapa_mover(bigint,text)': 'a8306e697616dcd5addca4affb6b79cf4f1af4b01d851b3e1d1d16d4215c4d7b',
  'vessel_stylist_etapa_renomear(bigint,text)': '2dc6e946e1088c6ad1141ced2ce2219679a5064bec9f71f079541dc802d7ca3d',
  'vessel_stylist_etapa_tipo(bigint,text)': '8db587ff63f898f296af789c3f84f074eec043d6bd7e8b8f12aad392c5ff149e',
  'vessel_stylist_motivo_ativar(bigint,boolean)': '4b1a2c4f633b0e5fc7fd946e6782c2b1406c91cbb5f3ddc61d86f8704d47d377',
  'vessel_stylist_motivo_criar(bigint,text,boolean)': '328689c4c53ba16533cc24a9fc641ab77214000477b4faaae412db02664facf3',
  'vessel_stylist_motivo_exigir_nota(bigint,boolean)': 'facb529729192d629180aed8fe81da85c0a52acff82ade46df90dcff4bbcf0e6',
  'vessel_stylist_motivo_mover(bigint,text)': 'b52eb0684acc362807d3b7cc54838cc5764bd431430d509e77e1deabaa793c79',
  'vessel_stylist_motivo_renomear(bigint,text)': '9d463ec74d06e4f8fe9f3a7ac6ee104a990a5000322597a14c7cbfeef13ee5a3',
  'vessel_stylist_mover_de_etapa(text,bigint,bigint,text)': 'e39023cd388a7f0e2f8aad9301906b6c8d2d2d5408b3c2213584c33a4c0fcf86',
  'vessel_stylist_registrar_contato(text,text,text,text,text,date)': 'd77a812094ef9c0df52987753c9a88b31d7cc617c24d4261b9f4554977c66409',
  'vessel_placar_do_stylist_circle(date,date,integer)': '7d412aa8866f2626935d1818a0833d08ce908edfc233c3d645c49122b56c7d27',
  'vessel_qualificacoes_vigentes()': 'e2f7c22bcd3c6d455ef73486002ef2fc3c7346f44a664bf998780648ca79edb4',
  'vessel_scorecard_da_stylist(text,date,date,integer)': 'ac8cef964326d76e3308bd9841484bc5e611b3d9229d458fc7545ebed5530df8',
  'vessel_stylist_contatos(text)': 'd1781b38b3b519f4fb0d6bd4859513410676afdec412257bd3c1fc267295ba64',
  'vessel_stylist_historico_de_etapas(text)': '448f4465304d30814754aa6d2f7377f4db92b1f70337fccf3d72bb071db0f907',
  'vessel_stylist_qualificacoes(text)': '63931b90586aa008cf6d87b662fe3296470537af4c23f4d816d815d86a329daa',
  'vessel_rastreio_dos_stylists(integer,boolean)': 'ea1716539dbf6eed99e9d81d07034ba2a4e626a6b6c1c1c41b3925efe8060869',
  'vessel_stylist_etapas()': '69ad705861954c9349aea25358dd5e95fc883880676102a391bda1ba63b67f78',
  'vessel_situacao_do_atendimento(bigint,text)': '25b4936850bda8afca446451d4a968d4a9ddb1361f0d3e36dec8e14d665ec7a5',
}
const MEDIDO_DAS_TRAVAS = {
  'is_vessel_atendimentos()': '13af1a5a8929e86388ea63b623a1d26f2a81cbea9f5fc79af11b6a0587dcc45b',
  'is_vessel_atendimentos_editar()': 'b9e8bfc4aa33ccbd233568837f53f6b468a6427f007273294ef997bd4db0882f',
  'conta_ativa()': '22e5aae7d73cf0af24331a5eb01d2a7c95dffc70bf00e03bc4d1cc9e7abd8536',
}

// ⚠️ A IMPRESSÃO conta também as CONTAS: a prova cria perfis de mentira e eles
// têm de sumir com o savepoint.
const IMPRESSAO = `
  select (select count(*) from auth.users)::int as contas,
         (select count(*) from public.profiles)::int as perfis,
         (select md5(coalesce(string_agg(to_jsonb(p)::text, '|' order by p.id), '')) from public.profiles p) as perfis_md5,
         (select count(*) from public.vessel_stylists)::int as stylists,
         (select md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by t.id), '')) from public.vessel_stylists t) as stylists_md5,
         (select count(*) from public.vessel_stylist_contatos)::int as contatos,
         (select count(*) from public.vessel_stylist_qualificacoes)::int as qualificacoes,
         (select count(*) from public.vessel_private_edits)::int as private_edits,
         (select count(*) from public.vessel_beauty_sessions)::int as beauty_sessions,
         (select count(*) from public.vessel_atendimentos)::int as atendimentos,
         (select count(*) from public.vessel_pessoas)::int as pessoas`

// Todas as funções do schema public, com o sha do texto — para provar que só
// as 49 (e a trava nova) mudaram.
const TODAS = `select p.oid::regprocedure::text as assinatura, md5(pg_get_functiondef(p.oid)) as md5
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prokind = 'f'`

const falhas = []
const conferir = (ok, frase, detalhe) => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${frase}${ok ? '' : `  → ${JSON.stringify(detalhe)}`}`)
  if (!ok) falhas.push(frase)
}
const sha256 = (t) => createHash('sha256').update(t || '').digest('hex')

if (!process.env.DATABASE_URL) { console.error('❌ sem DATABASE_URL'); process.exit(1) }
const sql = readFileSync(new URL(`../db/migrations/${ARQUIVO}`, import.meta.url), 'utf8')

// ── a migration diz o que esta prova acha que ela diz? ─────────────────────
// Cada função da migration tem de trazer a trava de REGRAS e nenhuma da família.
console.log('\n── a migration contra a tabela de regras deste aplicador')
{
  const blocos = sql.split(/^CREATE OR REPLACE FUNCTION public\./m).slice(1)
  const nomes = blocos.map((b) => b.slice(0, b.indexOf('(')))
  conferir(nomes.length === 49 && new Set(nomes).size === 49 && nomes.every((n) => REGRAS[n]),
    'a migration recria exatamente as 49 funções da tabela', nomes.filter((n) => !REGRAS[n]))
  const erradas = blocos.filter((b) => {
    const nome = b.slice(0, b.indexOf('('))
    const corpo = b.slice(0, b.indexOf('$function$;') + 11)
    const [nivel, fs] = REGRAS[nome] || []
    return !REGRAS[nome] || corpo.includes('is_vessel_atendimentos') || corpo.split(portao(nivel, fs)).length !== 2
  }).map((b) => b.slice(0, b.indexOf('(')))
  conferir(erradas.length === 0, 'cada função da migration traz a trava da sua tela, uma vez, e nenhuma da família', erradas)
  if (falhas.length) { console.error('\n❌ a migration e o aplicador discordam — nada foi aplicado.'); process.exit(1) }
}

const cli = new pg.Client({ connectionString: process.env.DATABASE_URL })
await cli.connect()
const uma = async (s, a = []) => (await cli.query(s, a)).rows[0]
const r = async (s, a = []) => (await uma(`select ${s} as r`, a)).r
const registrada = async (nome) =>
  (await uma(`select exists (select 1 from public.schema_migrations where name = $1) as ok`, [nome])).ok
const falarComo = (id) => cli.query(`select set_config('request.jwt.claims', $1, true)`,
  [id ? JSON.stringify({ sub: id, role: 'authenticated' }) : ''])
// Como o PostgREST: papel authenticated (ou anon), parâmetros por NOME, e cada
// chamada no seu savepoint — o que ela gravar morre ali.
const chamar = async (fn, corpo, papel = 'authenticated') => {
  const ks = Object.keys(corpo)
  await cli.query(`savepoint chamada; set local role ${papel}`)
  try {
    const v = await r(`public.${fn}(${ks.map((k, i) => `${k} => $${i + 1}`).join(', ')})`, ks.map((k) => corpo[k]))
    await cli.query('rollback to savepoint chamada')
    return { v }
  } catch (e) {
    await cli.query('rollback to savepoint chamada')
    return { e }
  }
}
const recusou = (fn, { v, e }) => {
  if (e) return e.code === '42501'
  if (RECUSA_VAZIA.has(fn)) return Array.isArray(v) && v.length === 0
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return v.situacao === 'sem_permissao' || /^Você não tem a permissão/.test(v.erro || '')
  }
  return false
}

if (await registrada(ARQUIVO)) { console.error(`❌ ${ARQUIVO} já está registrada. Nada a fazer.`); process.exit(1) }
for (const p of PRECISA) {
  if (!(await registrada(p))) { console.error(`❌ falta ${p} antes desta.`); process.exit(1) }
}

console.log('\n── o banco de agora contra o texto de onde a migration partiu')
for (const [assinatura, esperado] of Object.entries(MEDIDO)) {
  const nome = assinatura.slice(0, assinatura.indexOf('('))
  const { lista, def } = await uma(`select string_agg(p.oid::regprocedure::text, ' | ') as lista, max(pg_get_functiondef(p.oid)) as def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [nome])
  if (lista !== assinatura) conferir(false, `${nome}: a assinatura de agora é a de onde a migration partiu`, lista)
  else if (sha256(def) !== esperado) conferir(false, `${nome}: o texto no banco é o mesmo de quando a migration foi escrita`, sha256(def))
}
for (const [assinatura, esperado] of Object.entries(MEDIDO_DAS_TRAVAS)) {
  const { def } = await uma(`select pg_get_functiondef($1::regprocedure) as def`, [`public.${assinatura}`])
  if (sha256(def) !== esperado) conferir(false, `${assinatura}: a trava da família é a de 25/09/2026`, sha256(def))
}
conferir(falhas.length === 0, `as 49 funções e as travas da família estão como em 25/09/2026 (sha256)`)
const { existe } = await uma(`select exists (select 1 from pg_proc where proname = 'vessel_pode') as existe`)
conferir(!existe, 'vessel_pode ainda não existe')
const polAntes = (await cli.query(`select tablename, qual from pg_policies where policyname like 'vessel_%_le_central'
   and tablename = any($1)`, [[...Object.keys(POLITICAS_TROCADAS), ...POLITICAS_DA_BASE_COMUM]])).rows
conferir(polAntes.length === 9 && polAntes.every((p) => p.qual === 'is_vessel_atendimentos()'),
  'as 9 políticas de leitura pedem a família hoje', polAntes)
if (falhas.length) { console.error('\n❌ o banco mudou depois de a migration ser escrita — nada foi aplicado.'); await cli.end(); process.exit(1) }

const antes = await uma(IMPRESSAO)
const todasAntes = Object.fromEntries((await cli.query(TODAS)).rows.map((x) => [x.assinatura, x.md5]))

// ── as pessoas de verdade (só a forma das permissões) ───────────────────────
const PESSOAS = (await cli.query(`select id, email, coalesce(is_superadmin, false) as sa, coalesce(disabled, false) as desativada,
    case when jsonb_typeof(permissions) = 'object' then permissions else '{}'::jsonb end as permissions
  from public.profiles order by email`)).rows
const DE_PROVA = (p) => /@teste\.invalido$/.test(p.email)
const temNaChave = (perm, f, nivel) => Array.isArray(perm[f]) && perm[f].includes('ver') && (nivel === 'ver' || perm[f].includes(nivel))
// O que a Central mostra: a tela abre com 'ver' da chave dela (podeAbrir) e o
// botão de mexer com 'editar' (hasPermission(chave, 'editar')). Super-admin vê
// tudo; conta desativada não entra na Central.
const aCentralMostra = (p, nivel, fs) => !p.desativada && (p.sa || fs.some((f) => temNaChave(p.permissions, f, nivel)))
// As 49 travas de uma vez, numa consulta só (uma ida ao banco por pessoa).
const avaliarTodas = async (id, exprDe) => {
  await falarComo(id)
  return uma(`select ${FUNCOES.map((fn) => `${exprDe(fn)} as "${fn}"`).join(', ')}`)
}

// ⚠️ `set_config(..., true)` vale até o fim da TRANSAÇÃO: fora de uma, a
// claim some antes da consulta seguinte. Por isso "passava antes" é medido
// depois do `begin` (e antes de aplicar).
const passavaAntes = {}

// ── os perfis de mentira ────────────────────────────────────────────────────
// `features` como o derivar-features.js grava: cada chave com 'ver' + o pai.
const PERFIS = {
  'só Material Gráfico': { permissions: { [MG]: ['ver'] } },
  'só Beauty Sessions (mexer)': { permissions: { [BS]: ['ver', 'editar'] } },
  'só Beauty Sessions (ver)': { permissions: { [BS]: ['ver'] } },
  'só Private Edit (mexer)': { permissions: { [PE]: ['ver', 'editar'] } },
  'só Private Edit (ver)': { permissions: { [PE]: ['ver'] } },
  'só Stylist Circle (mexer)': { permissions: { [SC]: ['ver', 'editar'] } },
  'só Stylist Circle (ver)': { permissions: { [SC]: ['ver'] } },
  'só Private Appointment (mexer)': { permissions: { [PA]: ['ver', 'editar'] } },
  'só Appointment Card': { permissions: { [CARD]: ['ver'] } },
  'todas as telas (mexer)': { permissions: { [PA]: ['ver', 'editar'], [BS]: ['ver', 'editar'], [PE]: ['ver', 'editar'], [SC]: ['ver', 'editar'], [MG]: ['ver'], [CARD]: ['ver'] } },
  'super-admin': { permissions: {}, sa: true },
  'desativada (todas as telas)': { permissions: { [PA]: ['ver', 'editar'], [BS]: ['ver', 'editar'], [PE]: ['ver', 'editar'], [SC]: ['ver', 'editar'], [MG]: ['ver'] }, desativada: true },
  'outra ferramenta (Patrimônio)': { permissions: { patrimonio: ['ver'] } },
}
const featuresDe = (perm) => [...new Set(Object.entries(perm).filter(([, a]) => a.includes('ver'))
  .flatMap(([k]) => (k.includes('.') ? [k, k.split('.')[0]] : [k])))].sort()
const criarPerfis = async () => {
  const ids = {}
  for (const [rotulo, x] of Object.entries(PERFIS)) {
    const id = randomUUID(), email = `prova-b13-${id}@teste.invalido`
    await cli.query(`insert into auth.users (id, email) values ($1, $2)`, [id, email])
    await cli.query(`insert into public.profiles (id, email, name, features, permissions, is_superadmin, disabled)
      values ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [id, email, `Prova ${rotulo}`, featuresDe(x.permissions), JSON.stringify(x.permissions), !!x.sa, !!x.desativada])
    ids[rotulo] = id
  }
  return ids
}
// Passava na família? (a regra de antes, sobre o perfil de mentira)
const naFamilia = (x, nivel) => !x.desativada && (!!x.sa || (featuresDe(x.permissions).some((f) => f === PA || f.startsWith(PA + '.'))
  && (nivel === 'ver' || Object.entries(x.permissions).some(([k, a]) => (k === PA || k.startsWith(PA + '.')) && a.includes('editar')))))
const naTela = (x, nivel, fs) => aCentralMostra({ ...x, sa: !!x.sa, desativada: !!x.desativada }, nivel, fs)

// Um encontro, uma parceira com contato e avaliação, e uma convidada — montados
// por quem tem todas as telas. Sem eles, as três funções que recusam com lista
// vazia não distinguiriam "recusou" de "não tem nada".
const montar = async (quem) => {
  const lib = Number((await uma(`select id from public.vessel_stylist_etapas where ativa and libera_private_edit order by ordem limit 1`)).id)
  await falarComo(quem)
  await cli.query('set local role authenticated')
  const s = await r(`public.vessel_stylist_criar(p_nome => 'Prova B13', p_whatsapp => '(19) 97313-1301', p_origem_contato => 'pesquisa')`)
  const m = await r(`public.vessel_stylist_mover_de_etapa(p_codigo => $1, p_etapa_id => $2)`, [s?.codigo, lib])
  const c = await r(`public.vessel_stylist_registrar_contato(p_codigo => $1, p_canal => 'presencial', p_resultado => 'conversou')`, [s?.codigo])
  const q = await r(`public.vessel_stylist_avaliar($1, 3, 3, 3, 3, 3)`, [s?.codigo])
  const pe = await r(`public.vessel_criar_private_edit($1, (((now() at time zone 'America/Sao_Paulo')::date + 47)::timestamp + time '19:00') at time zone 'America/Sao_Paulo', null, 'CPS', 'iguatemi', 8, true)`, [s?.codigo])
  const a = await r(`public.vessel_convidar_para_encontro($1, 'Ana da Prova B13', '(19) 97313-1302')`, [pe?.codigo])
  await cli.query('reset role')
  await falarComo(null)
  if (!s?.ok || !m?.ok || !c?.ok || !q?.ok || !pe?.ok || !a?.id) throw new Error(`não montei o cenário de prova: ${JSON.stringify({ s, m, c, q, pe, a })}`)
  return { sty: s.codigo, pe: pe.codigo, convidada: a.id, etapa: lib }
}

// Os argumentos de cada chamada: inofensivos (código que não existe, ou o do
// cenário) — o que importa é a resposta da TRAVA, que é a primeira coisa de
// cada função. Tudo o que gravar morre no savepoint da chamada.
const quando = `${new Date(Date.now() + 50 * 864e5).toISOString().slice(0, 10)}T22:00:00Z`
const hoje = new Date().toISOString().slice(0, 10)
const ARGS = (c) => ({
  vessel_beauty_session_apagar: { p_codigo: 'BS-NAO-EXISTE' },
  vessel_beauty_session_arquivar: { p_codigo: 'BS-NAO-EXISTE', p_arquivada: true },
  vessel_beauty_session_cadastrar_lead: { p_codigo: 'BS-NAO-EXISTE', p_nome: 'Lia da Prova', p_whatsapp: '(19) 97313-1303' },
  vessel_beauty_session_criar: { p_codigo: 'PROVAB13', p_quando: hoje, p_praca: 'CPS', p_loja: 'iguatemi' },
  vessel_beauty_session_editar: { p_codigo: 'BS-NAO-EXISTE', p_loja: 'iguatemi' },
  vessel_beauty_session_encerrar: { p_codigo: 'BS-NAO-EXISTE' },
  vessel_leads_da_beauty_session: { p_codigo: 'BS-NAO-EXISTE' },
  vessel_conta_das_beauty_sessions: { p_dias: 7, p_incluir_arquivadas: false },
  vessel_criar_private_edit: { p_stylist: c.sty, p_quando: quando, p_praca: 'CPS', p_loja: 'iguatemi', p_vagas: 8, p_teste: true },
  vessel_convidar_para_encontro: { p_codigo: c.pe, p_nome: 'Bia da Prova B13', p_whatsapp: '(19) 97313-1304' },
  vessel_private_edit_apagar: { p_codigo: c.pe },
  vessel_private_edit_arquivar: { p_codigo: c.pe, p_arquivada: true },
  vessel_private_edit_editar: { p_codigo: c.pe, p_vagas: 9 },
  vessel_private_edit_encerrar: { p_codigo: c.pe },
  vessel_private_edit_situacao: { p_codigo: c.pe, p_status: 'agendado' },
  vessel_agenda_das_lojas: { p_de: hoje, p_ate: hoje },
  vessel_chave_da_convidada: { p_id: c.convidada },
  vessel_convidadas_do_encontro: { p_codigo: c.pe },
  vessel_convite_marcar: { p_id: c.convidada, p_marca: 'enviado' },
  vessel_private_edit_sobreposicoes: { p_quando: quando, p_loja: 'iguatemi' },
  vessel_stylists_para_escolher: {},
  vessel_conta_das_private_edits: { p_dias: 14, p_incluir_arquivadas: false },
  vessel_stylist_avaliar: { p_codigo: c.sty, p_carteira: 4, p_portfolio: 4, p_mobilizacao: 4, p_acesso: 4, p_confiabilidade: 4 },
  vessel_stylist_criar: { p_nome: 'Prova B13 Nova', p_whatsapp: '(19) 97313-1305', p_origem_contato: 'pesquisa' },
  vessel_stylist_desativar: { p_codigo: c.sty },
  vessel_stylist_editar: { p_codigo: c.sty, p_observacoes: 'prova' },
  vessel_stylist_etapa_criar: { p_nome: 'Etapa Prova B13' },
  vessel_stylist_etapa_excluir: { p_id: -1 },
  vessel_stylist_etapa_liberar_private_edit: { p_id: -1, p_libera: true },
  vessel_stylist_etapa_marcar_prospectada: { p_id: -1 },
  vessel_stylist_etapa_mover: { p_id: -1, p_direcao: 'cima' },
  vessel_stylist_etapa_renomear: { p_id: -1, p_nome: 'x' },
  vessel_stylist_etapa_tipo: { p_id: -1, p_tipo: 'funil' },
  vessel_stylist_motivo_ativar: { p_id: -1, p_ativo: true },
  vessel_stylist_motivo_criar: { p_etapa_id: -1, p_nome: 'x' },
  vessel_stylist_motivo_exigir_nota: { p_id: -1, p_exige: true },
  vessel_stylist_motivo_mover: { p_id: -1, p_direcao: 'cima' },
  vessel_stylist_motivo_renomear: { p_id: -1, p_nome: 'x' },
  vessel_stylist_mover_de_etapa: { p_codigo: c.sty, p_etapa_id: c.etapa },
  vessel_stylist_registrar_contato: { p_codigo: c.sty, p_canal: 'whatsapp', p_resultado: 'interesse' },
  vessel_placar_do_stylist_circle: {},
  vessel_qualificacoes_vigentes: {},
  vessel_scorecard_da_stylist: { p_codigo: c.sty },
  vessel_stylist_contatos: { p_codigo: c.sty },
  vessel_stylist_historico_de_etapas: { p_codigo: c.sty },
  vessel_stylist_qualificacoes: { p_codigo: c.sty },
  vessel_rastreio_dos_stylists: { p_dias: 7, p_incluir_desativadas: false },
  vessel_stylist_etapas: {},
  vessel_situacao_do_atendimento: { p_id: c.convidada, p_situacao: 'confirmado' },
})

/** Chama as 49 com cada perfil; devolve {rotulo: {fn: passou}} e confere contra `esperado`. */
const rodarMatriz = async (ids, cenario, esperado, titulo) => {
  const args = ARGS(cenario)
  const res = {}
  let erradas = 0
  for (const [rotulo, id] of Object.entries(ids)) {
    res[rotulo] = {}
    await falarComo(id)
    const difs = []
    for (const fn of FUNCOES) {
      const saida = await chamar(fn, args[fn])
      const passou = !recusou(fn, saida)
      res[rotulo][fn] = passou
      const deveria = esperado(PERFIS[rotulo], ...REGRAS[fn])
      if (passou !== deveria) difs.push(`${fn}: ${passou ? 'passou' : 'recusou'}${saida.e ? ` (${saida.e.code} ${saida.e.message})` : ''}`)
    }
    erradas += difs.length
    const n = Object.values(res[rotulo]).filter(Boolean).length
    conferir(difs.length === 0, `${titulo} · ${rotulo}: passa em ${n} de 49, como a regra diz`, difs)
  }
  await falarComo(null)
  return { res, erradas }
}

await cli.query('begin')
try {
  for (const p of PESSOAS) passavaAntes[p.id] = await avaliarTodas(p.id, (fn) => familia(REGRAS[fn][0]))
  await falarComo(null)
  conferir(PESSOAS.filter((p) => p.sa && !p.desativada).every((p) => Object.values(passavaAntes[p.id]).every(Boolean)),
    'controle: medido antes, os super-admins passam nas 49 (a medição enxerga quem passa)')
  // ── 1. ANTES: o buraco, reproduzido (desfeito) ────────────────────────────
  console.log('\n── ANTES (desfeito): a trava da família deixa uma tela chamar as outras')
  await cli.query('savepoint antes')
  {
    const ids = await criarPerfis()
    const cen = await montar(ids['todas as telas (mexer)'])
    const { res } = await rodarMatriz(ids, cen, (x, nivel) => naFamilia(x, nivel), 'antes')
    conferir(res['só Material Gráfico'].vessel_stylist_contatos === true,
      'antes: quem tem SÓ o Material Gráfico lê o histórico de contato das parceiras (o buraco)')
    conferir(res['só Beauty Sessions (mexer)'].vessel_criar_private_edit === true && res['só Beauty Sessions (mexer)'].vessel_stylist_mover_de_etapa === true,
      'antes: quem tem SÓ Beauty Sessions cria Private Edit e move parceira no funil (o buraco)')
  }
  await cli.query('rollback to savepoint antes')
  await falarComo(null)

  // ── 2. aplicar e registrar ────────────────────────────────────────────────
  console.log('\n── aplicar e registrar')
  await cli.query(sql)
  await cli.query(`insert into public.schema_migrations (name, observacao) values ($1, $2)`,
    [ARQUIVO, 'Aplicada e registrada na mesma transacao por coletor/aplicar-vessel-permissao-por-tela-no-banco.mjs'])

  console.log('\n── a estrutura')
  const naoBate = []
  for (const [assinatura, esperado] of Object.entries(NOVO)) {
    const { def } = await uma(`select pg_get_functiondef($1::regprocedure) as def`, [`public.${assinatura}`])
    if (sha256(def) !== esperado) naoBate.push(assinatura)
  }
  conferir(naoBate.length === 0, 'as 49 funções ficaram EXATAMENTE com o texto da migration (sha256)', naoBate)
  const todasDepois = Object.fromEntries((await cli.query(TODAS)).rows.map((x) => [x.assinatura, x.md5]))
  const mudaram = Object.keys({ ...todasAntes, ...todasDepois }).filter((k) => todasAntes[k] !== todasDepois[k]).sort()
  const esperadas = [...Object.keys(NOVO), 'vessel_pode(text,text)'].sort()
  conferir(JSON.stringify(mudaram) === JSON.stringify(esperadas),
    'nenhuma outra função do schema mudou — nem as da página pública (convite, RSVP, formulários) nem as travas da família',
    mudaram.filter((m) => !esperadas.includes(m)))
  const ainda = (await cli.query(`select p.oid::regprocedure::text as a from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and pg_get_functiondef(p.oid) ~ 'is_vessel_atendimentos' and p.proname not like 'is_vessel_atendimentos%' order by 1`)).rows.map((x) => x.a)
  conferir(JSON.stringify(ainda) === JSON.stringify(['vessel_convite_da_convidada(text,text,boolean)']),
    'a família sobra só no convite público ("abertura da equipe não conta")', ainda)
  const grants = (await cli.query(`select p.oid::regprocedure::text as a, has_function_privilege('authenticated', p.oid, 'EXECUTE') as aut,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon from pg_proc p where p.oid::regprocedure::text = any($1)`, [Object.keys(NOVO)])).rows
  conferir(grants.length === 49 && grants.every((g) => g.aut && !g.anon), 'as 49: a Central executa, o anon não (como antes)', grants.filter((g) => !g.aut || g.anon))
  const gp = await uma(`select has_function_privilege('authenticated', 'public.vessel_pode(text,text)', 'EXECUTE') as aut,
       has_function_privilege('anon', 'public.vessel_pode(text,text)', 'EXECUTE') as anon,
       has_function_privilege('public', 'public.vessel_pode(text,text)', 'EXECUTE') as pub,
       (select prosecdef and provolatile = 's' and proconfig::text like '%search_path=public%' from pg_proc where oid = 'public.vessel_pode(text,text)'::regprocedure) as forma`)
  conferir(gp.aut === true && gp.anon === false && gp.pub === false && gp.forma === true,
    'vessel_pode: security definer, stable, search_path fixo; authenticated executa, anon e public não', gp)
  const pol = Object.fromEntries((await cli.query(`select tablename, qual from pg_policies where policyname like 'vessel_%_le_central'
     and tablename = any($1)`, [[...Object.keys(POLITICAS_TROCADAS), ...POLITICAS_DA_BASE_COMUM]])).rows.map((p) => [p.tablename, p.qual]))
  conferir(Object.entries(POLITICAS_TROCADAS).every(([t, q]) => pol[t] === q), 'as 5 políticas de uma tela pedem a chave dela', pol)
  conferir(POLITICAS_DA_BASE_COMUM.every((t) => pol[t] === 'is_vessel_atendimentos()'), 'as 4 da base comum continuam com a família', pol)
  for (const [ruim, frase] of [[`public.vessel_pode('atendimentos.privat-edit', 'ver')`, 'chave escrita errada'],
    [`public.vessel_pode('atendimentos.stylist-circle', 'mexer')`, 'nível que não existe'],
    [`public.vessel_pode('atendimentos.material-grafico', 'editar')`, 'editar no Material Gráfico (só tem ver)']]) {
    await cli.query('savepoint ruim')
    let erro = null
    try { await r(ruim) } catch (e) { erro = e }
    await cli.query('rollback to savepoint ruim')
    conferir(erro?.code === '22023', `vessel_pode com ${frase}: ERRO, não "false" calado`, erro?.message)
  }

  // ── 3. as pessoas de verdade ──────────────────────────────────────────────
  console.log('\n── as pessoas de verdade: antes × depois × o que a Central mostra (só a forma das permissões)')
  const reais = PESSOAS.filter((p) => !DE_PROVA(p))
  let mudancas = 0, contraACentral = 0
  for (const p of reais) {
    const difs = [], fora = []
    let nAntes = 0, nDepois = 0
    const passaDepois = await avaliarTodas(p.id, (fn) => portao(...REGRAS[fn]))
    for (const fn of FUNCOES) {
      const [nivel, fs] = REGRAS[fn]
      const depois = passaDepois[fn]
      const antesP = passavaAntes[p.id][fn]
      nAntes += antesP ? 1 : 0
      nDepois += depois ? 1 : 0
      if (antesP !== depois) difs.push(`${fn}: ${antesP ? 'passava' : 'não passava'} → ${depois ? 'passa' : 'não passa'}`)
      if (depois !== aCentralMostra(p, nivel, fs)) fora.push(fn)
    }
    mudancas += difs.length
    contraACentral += fora.length
    if (nAntes || nDepois || difs.length || fora.length) {
      console.log(`     ${p.email}${p.sa ? ' (super-admin)' : ''}${p.desativada ? ' (desativada)' : ''}: antes ${nAntes}/49, depois ${nDepois}/49`)
    }
    if (difs.length) console.log(`       muda: ${difs.join('; ')}`)
    if (fora.length) console.log(`       ✗ discorda da Central em: ${fora.join(', ')}`)
  }
  await falarComo(null)
  console.log(`     (${reais.length} perfis reais; os que não aparecem não passam em nenhuma, antes e depois)`)
  conferir(contraACentral === 0, 'depois, cada pessoa de verdade passa EXATAMENTE nas funções das telas que a Central mostra a ela', contraACentral)
  conferir(mudancas === 0, 'nenhuma pessoa de verdade perde nem ganha nada que usa pela Central', mudancas)
  const esquecidas = PESSOAS.filter(DE_PROVA)
  if (esquecidas.length) {
    console.log(`\n  ⚠️ ${esquecidas.length} conta(s) de PROVA esquecida(s) em produção (…@teste.invalido), de aplicadores anteriores — fora da conta acima:`)
    for (const p of esquecidas) {
      const passaDepois = await avaliarTodas(p.id, (fn) => portao(...REGRAS[fn]))
      const nAntes = FUNCOES.filter((fn) => passavaAntes[p.id][fn]).length
      const nDepois = FUNCOES.filter((fn) => passaDepois[fn]).length
      console.log(`     ${p.email.replace(/-[0-9a-f-]{36}@/, '-…@')}: antes ${nAntes}/49, depois ${nDepois}/49`)
    }
    await falarComo(null)
  }

  // ── 4. DEPOIS: cada função, de verdade, por perfil ────────────────────────
  console.log('\n── DEPOIS: as 49 chamadas de verdade por 13 perfis de mentira (savepoint, desfeito)')
  await cli.query('savepoint prova')
  const ids = await criarPerfis()
  const cen = await montar(ids['todas as telas (mexer)'])
  const { res } = await rodarMatriz(ids, cen, (x, nivel, fs) => naTela(x, nivel, fs), 'depois')

  console.log('\n── o que o dono pediu, em frases')
  const mg = res['só Material Gráfico']
  conferir(mg.vessel_conta_das_beauty_sessions && mg.vessel_conta_das_private_edits && mg.vessel_rastreio_dos_stylists,
    'só Material Gráfico: lê as três listas dos QR (sessões, encontros, parceiras)')
  conferir(!mg.vessel_beauty_session_criar && !mg.vessel_stylist_contatos && !mg.vessel_convidadas_do_encontro && !mg.vessel_stylist_criar,
    'só Material Gráfico: NÃO cria sessão, NÃO vê o histórico de contato das parceiras nem as convidadas')
  conferir(FUNCOES.filter((f) => f.includes('private_edit') || ['vessel_convidadas_do_encontro', 'vessel_convidar_para_encontro', 'vessel_convite_marcar', 'vessel_chave_da_convidada'].includes(f))
    .every((f) => !res['só Beauty Sessions (mexer)'][f]), 'só Beauty Sessions (mexer): não toca em nenhuma função do Private Edit')
  conferir(!res['só Stylist Circle (mexer)'].vessel_criar_private_edit && res['só Stylist Circle (mexer)'].vessel_stylist_criar,
    'só Stylist Circle (mexer): cadastra parceira, mas NÃO cria Private Edit (precisa de Private Edit com mexer)')
  conferir(!res['só Private Edit (ver)'].vessel_criar_private_edit && res['só Private Edit (ver)'].vessel_convidadas_do_encontro
    && res['só Private Edit (mexer)'].vessel_criar_private_edit, 'Private Edit: ver lê as convidadas e não cria; mexer cria')
  conferir(res['só Private Edit (ver)'].vessel_stylist_etapas && res['só Private Edit (ver)'].vessel_situacao_do_atendimento
    && !res['só Private Edit (ver)'].vessel_rastreio_dos_stylists, 'Private Edit lê as etapas e marca presença (as compartilhadas), mas não a lista das parceiras')
  conferir(Object.values(res['super-admin']).every(Boolean) && Object.values(res['todas as telas (mexer)']).every(Boolean), 'super-admin e quem tem todas as telas: as 49')
  conferir(!Object.values(res['desativada (todas as telas)']).some(Boolean), 'conta desativada: nenhuma, mesmo com todas as chaves')
  conferir(!Object.values(res['só Appointment Card']).some(Boolean) && !Object.values(res['outra ferramenta (Patrimônio)']).some(Boolean),
    'só Appointment Card / outra ferramenta: nenhuma')

  console.log('\n── o anon (a página pública) não chama nenhuma das 49')
  await falarComo(null)
  const args = ARGS(cen)
  const anonPassou = []
  for (const fn of FUNCOES) {
    const s = await chamar(fn, args[fn], 'anon')
    if (!(s.e && s.e.code === '42501')) anonPassou.push(fn)
  }
  conferir(anonPassou.length === 0, 'anon: "permissão negada" nas 49 (nem chega na trava)', anonPassou)

  console.log('\n── a leitura direta das tabelas (como o PostgREST, papel authenticated)')
  const contar = async (id, tabela) => {
    await falarComo(id)
    await cli.query('savepoint leitura')
    await cli.query('set local role authenticated')
    const n = (await uma(`select count(*)::int as n from public.${tabela}`)).n
    await cli.query('rollback to savepoint leitura')
    return n
  }
  const peVer = await contar(ids['só Private Edit (ver)'], 'vessel_private_edits')
  const mgPe = await contar(ids['só Material Gráfico'], 'vessel_private_edits')
  const scPe = await contar(ids['só Stylist Circle (mexer)'], 'vessel_private_edits')
  const desPe = await contar(ids['desativada (todas as telas)'], 'vessel_private_edits')
  conferir(peVer >= 1 && mgPe === 0 && scPe === 0 && desPe === 0,
    'vessel_private_edits: Private Edit lê; Material Gráfico, Stylist Circle e conta desativada leem zero', { peVer, mgPe, scPe, desPe })
  const mgPessoas = await contar(ids['só Material Gráfico'], 'vessel_pessoas')
  const outraPessoas = await contar(ids['outra ferramenta (Patrimônio)'], 'vessel_pessoas')
  conferir(mgPessoas >= 1 && outraPessoas === 0,
    'vessel_pessoas (base comum, decisão do dono): qualquer tela do Comercial Vessel ainda lê; quem não tem nenhuma, não', { mgPessoas, outraPessoas })
  await falarComo(null)

  await cli.query('rollback to savepoint prova')
  await falarComo(null)
  const depoisDaProva = await uma(IMPRESSAO)
  conferir(JSON.stringify(depoisDaProva) === JSON.stringify(antes), 'a prova não deixou rastro (nem conta de mentira)', { antes, depoisDaProva })

  if (falhas.length) throw new Error(`${falhas.length} conferência(s) falharam`)
  if (GRAVAR) {
    const fim = await cli.query('commit')
    if (fim.command !== 'COMMIT') throw new Error(`o commit voltou ${fim.command}`)
    console.log(`\n✅ ${ARQUIVO} aplicada e registrada.`)
  } else {
    await cli.query('rollback')
    console.log('\n✅ ensaio limpo: tudo passou e NADA foi gravado. Rode com --gravar para valer.')
  }
} catch (e) {
  await cli.query('rollback').catch(() => {})
  console.error(`\n❌ nada foi gravado: ${e.message}`)
  process.exitCode = 1
} finally {
  await cli.end()
}

if (GRAVAR && !process.exitCode) {
  const outra = new pg.Client({ connectionString: process.env.DATABASE_URL })
  await outra.connect()
  const agora = (await outra.query(IMPRESSAO)).rows[0]
  const reg = (await outra.query(`select 1 from public.schema_migrations where name = $1`, [ARQUIVO])).rowCount
  const def = (await outra.query(`select pg_get_functiondef('public.vessel_stylist_contatos(text)'::regprocedure) as d`)).rows[0].d
  await outra.end()
  if (JSON.stringify(agora) !== JSON.stringify(antes) || reg !== 1 || !def.includes("vessel_pode('atendimentos.stylist-circle', 'ver')")) {
    console.error('❌ depois do commit algo não bate', { antes, agora, reg })
    process.exitCode = 1
  } else {
    console.log('  ✓ depois do commit, numa conexão nova: dados intactos, trava nova no lugar e migration registrada')
  }
}
