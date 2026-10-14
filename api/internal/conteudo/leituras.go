package conteudo

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// filtroConta: account_id das conteudo_* é UUID (a restritiva é pode_ver_conta((account_id)::text)). Toda
// leitura com a restritiva declara este filtro e projeta account_id: é por ele que a varredura da Task 9
// acha vazamento.
var filtroConta = dados.Filtro{Param: "account_id", SQL: "t.account_id = @account_id::uuid", Tipo: "uuid"}

// filtroDaMarca: "desta marca OU de todas" (account_id nulo), o `.or(account_id.eq.X,account_id.is.null)` de
// listarIdeias/listarBlocos (dados-conteudo.js:291, 438).
var filtroDaMarca = dados.Filtro{Param: "da_marca", SQL: "(t.account_id = @da_marca::uuid or t.account_id is null)", Tipo: "uuid"}

var filtroAtivo = dados.Filtro{Param: "ativo", SQL: "t.ativo = @ativo::boolean", Tipo: "booleano"}

// colunasPeca: o CAMPOS_PECA de dados-conteudo.js:20-23, na mesma ordem.
const colunasPeca = `t.id, t.account_id, t.titulo, t.formato, t.status, t.legenda, t.hashtags, t.observacoes,
  t.publicar_em, t.publicado_em, t.avisado_em, t.ig_media_id, t.ig_permalink, t.responsavel, t.criado_por,
  t.aprovado_por, t.aprovado_em, t.motivo_reprovacao, t.created_at, t.updated_at`

// consultaPecas: GET /conteudo/pecas. Traz EMBUTIDOS, cada um com a regra de Ler da sua tabela, o que a tela
// buscava em três consultas por lista de ids (dados-conteudo.js:106-155): `capa` (o arquivo de ordem 1 se for
// imagem), `metrica` (a leitura mais recente) e `sugestao` (o casamento sugerido de maior pontuação). Some a
// lista de ids na URL (uma conta com centenas de peças estouraria o limite de ~150 uuids do mestre, IV.1).
// Ruling 5.9-3.
var consultaPecas = dados.Consulta{Tabela: "conteudo_pecas", Alias: "t",
	SQL: `select ` + colunasPeca + `,
	  (select jsonb_build_object('caminho', a.caminho, 'tipo', a.tipo) from conteudo_arquivos a
	    where a.peca_id = t.id and a.ordem = 1 and a.tipo = 'imagem' and {ler:conteudo_arquivos:a}) as capa,
	  (select jsonb_build_object('peca_id', m.peca_id, 'capturado_em', m.capturado_em, 'curtidas', m.curtidas,
	      'comentarios', m.comentarios, 'alcance', m.alcance, 'salvamentos', m.salvamentos,
	      'compartilhamentos', m.compartilhamentos, 'visualizacoes', m.visualizacoes)
	    from conteudo_metricas m where m.peca_id = t.id and {ler:conteudo_metricas:m}
	    order by m.capturado_em desc limit 1) as metrica,
	  (select jsonb_build_object('id', c.id, 'peca_id', c.peca_id, 'ig_media_id', c.ig_media_id,
	      'ig_permalink', c.ig_permalink, 'ig_timestamp', c.ig_timestamp, 'ig_caption', c.ig_caption,
	      'ig_thumb', c.ig_thumb, 'pontuacao', c.pontuacao, 'motivo', c.motivo)
	    from conteudo_casamentos c where c.peca_id = t.id and c.situacao = 'sugerido' and {ler:conteudo_casamentos:c}
	    order by c.pontuacao desc, c.id limit 1) as sugestao
	  from conteudo_pecas t`,
	Filtros: []dados.Filtro{filtroConta,
		{Param: "id", SQL: "t.id = @id::uuid", Tipo: "uuid"},
		{Param: "status", SQL: "t.status = any(@status::text[])", Tipo: "texto[]"},
	},
	Ordens:      map[string]string{"publicar_em": "t.publicar_em", "created_at": "t.created_at"},
	OrdemPadrao: "t.publicar_em", Desempate: "t.id"} // asc: nulos por último, o `nullsFirst: false` da tela

// As filhas da peça: só com a peça VISÍVEL (o join leva a regra de Ler de conteudo_pecas, com a restritiva),
// e com account_id da peça projetado e filtrável (a tela manda a conta, nunca a lista de peças). Em produção as
// filhas não tinham a restritiva: quem só via A1 lia arquivos e trilha de A2 (Ruling 5.9-3, achado 1).
const colunasArquivo = `t.id, t.peca_id, t.ordem, t.bucket, t.caminho, t.tipo, t.mime, t.bytes`

var consultaArquivos = dados.Consulta{Tabela: "conteudo_arquivos", Alias: "t",
	SQL: `select ` + colunasArquivo + `, pc.account_id from conteudo_arquivos t
	  join conteudo_pecas pc on pc.id = t.peca_id and {ler:conteudo_pecas:pc}`,
	Filtros: []dados.Filtro{
		{Param: "peca_id", SQL: "t.peca_id = @peca_id::uuid", Tipo: "uuid"},
		{Param: "account_id", SQL: "pc.account_id = @account_id::uuid", Tipo: "uuid"},
	},
	OrdemPadrao: "t.ordem", Desempate: "t.id"}

const colunasEvento = `t.id, t.peca_id, t.de, t.para, t.acao, t.detalhe, t.quem, t.quando`

var consultaEventos = dados.Consulta{Tabela: "conteudo_eventos", Alias: "t",
	SQL: `select ` + colunasEvento + `, pc.account_id from conteudo_eventos t
	  join conteudo_pecas pc on pc.id = t.peca_id and {ler:conteudo_pecas:pc}`,
	Filtros: []dados.Filtro{
		{Param: "peca_id", SQL: "t.peca_id = @peca_id::uuid", Tipo: "uuid"},
		{Param: "account_id", SQL: "pc.account_id = @account_id::uuid", Tipo: "uuid"},
	},
	OrdemPadrao: "t.quando desc", Desempate: "t.id"}

// colunasIdeia: TODAS (criarIdeia/atualizarIdeia faziam `.select('*')`; listarIdeias, um subconjunto).
const colunasIdeia = `t.id, t.account_id, t.titulo, t.gancho, t.formato, t.pilar, t.roteiro, t.producao, t.porque_formato,
  t.cta, t.legenda_sugerida, t.hashtags_sugeridas, t.por_que_agora, t.referencia, t.origem, t.modelo, t.job_id,
  t.situacao, t.peca_id, t.criado_por, t.created_at`

var consultaIdeias = dados.Consulta{Tabela: "conteudo_ideias", Alias: "t",
	SQL: `select ` + colunasIdeia + ` from conteudo_ideias t`,
	Filtros: []dados.Filtro{filtroConta, filtroDaMarca,
		{Param: "situacao", SQL: "t.situacao = any(@situacao::text[])", Tipo: "texto[]"},
		{Param: "descartada", SQL: "(t.situacao = 'descartada') = @descartada::boolean", Tipo: "booleano"},
	},
	OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

const colunasBloco = `t.id, t.account_id, t.tipo, t.nome, t.texto, t.usos, t.ativo, t.criado_por, t.created_at`

var consultaBlocos = dados.Consulta{Tabela: "conteudo_blocos", Alias: "t",
	SQL:         `select ` + colunasBloco + ` from conteudo_blocos t`,
	Filtros:     []dados.Filtro{filtroConta, filtroDaMarca, filtroAtivo},
	OrdemPadrao: "t.tipo", Desempate: "t.id"}

// consultaConcorrentes: SEM a restritiva em produção (conteudo_concorrentes não está na lista de
// 2026-07-31-allowed-accounts-no-banco.sql): todo conteudista lê os de toda marca, como hoje (Ruling 5.9-5).
const colunasConcorrente = `t.id, t.account_id, t.handle, t.nome, t.observacao, t.ativo, t.created_at`

var consultaConcorrentes = dados.Consulta{Tabela: "conteudo_concorrentes", Alias: "t",
	SQL:         `select ` + colunasConcorrente + ` from conteudo_concorrentes t`,
	Filtros:     []dados.Filtro{filtroConta, filtroAtivo},
	OrdemPadrao: "t.nome", Desempate: "t.id"}

// consultaJobs: o que verJob (dados-conteudo.js:427) lê, mais tipo/conta/datas. Sem criado_por nem
// github_run_id (nenhuma tela os lê).
var consultaJobs = dados.Consulta{Tabela: "conteudo_jobs", Alias: "t",
	SQL: `select t.id, t.tipo, t.account_id, t.params, t.status, t.resultado, t.erro, t.created_at, t.updated_at
	  from conteudo_jobs t`,
	Filtros: []dados.Filtro{filtroConta,
		{Param: "id", SQL: "t.id = @id::uuid", Tipo: "uuid"},
		{Param: "status", SQL: "t.status = any(@status::text[])", Tipo: "texto[]"},
	},
	OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

func montarLeituras(r chi.Router, p *pgxpool.Pool) {
	r.Get("/conteudo/pecas", consultaPecas.Handler(p, autz.Producao))
	r.Get("/conteudo/arquivos", consultaArquivos.Handler(p, autz.Producao))
	r.Get("/conteudo/eventos", consultaEventos.Handler(p, autz.Producao))
	r.Get("/conteudo/ideias", consultaIdeias.Handler(p, autz.Producao))
	r.Get("/conteudo/blocos", consultaBlocos.Handler(p, autz.Producao))
	r.Get("/conteudo/concorrentes", consultaConcorrentes.Handler(p, autz.Producao))
	r.Get("/conteudo/jobs", consultaJobs.Handler(p, autz.Producao))
}
