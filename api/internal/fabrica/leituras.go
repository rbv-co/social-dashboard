package fabrica

import (
	"net/http"
	"slices"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var filtroAtivo = dados.Filtro{Param: "ativo", SQL: "t.ativo = @ativo::boolean", Tipo: "booleano"}

var consultaLojas = dados.Consulta{Tabela: "fabrica_lojas", Alias: "t",
	SQL: `select t.deposito_id, t.nome, t.ativo, t.ordem, t.marca_id, t.whatsapp, t.geo_cities, t.canal_loja_id
	  from fabrica_lojas t`,
	Filtros: []dados.Filtro{filtroAtivo}, OrdemPadrao: "t.ordem", Desempate: "t.deposito_id"}

var consultaObjetivos = dados.Consulta{Tabela: "fabrica_objetivos", Alias: "t",
	SQL: `select t.chave, t.rotulo, t.descricao, t.meta_objective, t.optimization_goal, t.billing_event,
	  t.destination_type, t.promoted_object_tipo, t.cta_type, t.looks, t.pede_desconto, t.ativo, t.ordem
	  from fabrica_objetivos t`,
	Filtros:     []dados.Filtro{filtroAtivo, {Param: "chave", SQL: "t.chave = @chave::text", Tipo: "texto"}},
	OrdemPadrao: "t.ordem", Desempate: "t.chave"}

// consultaMarcas: a única com a restritiva (so_contas_permitidas = pode_ver_conta(account_id), account_id
// TEXTO). Projeta account_id: é por ele que a varredura da Task 10 acha vazamento.
var consultaMarcas = dados.Consulta{Tabela: "fabrica_marcas", Alias: "t",
	SQL: `select t.id, t.nome, t.caption_template, t.ad_account, t.page_id, t.ig_id, t.account_id, t.ativo,
	  t.segmento, t.termos_produto, t.created_at from fabrica_marcas t`,
	Filtros:     []dados.Filtro{{Param: "account_id", SQL: "t.account_id = @account_id::text", Tipo: "texto"}, filtroAtivo},
	OrdemPadrao: "t.created_at", Desempate: "t.id"}

var consultaLooks = dados.Consulta{Tabela: "fabrica_looks", Alias: "t",
	SQL: `select t.chave, t.nome, t.arquetipo, t.objetivos, t.ativo, t.excluido, t.ordem, t.preview_url, t.tipo,
	  t.canva_formato_map, t.campo_map, t.created_at from fabrica_looks t`,
	Filtros: []dados.Filtro{filtroAtivo}, OrdemPadrao: "t.ordem", Desempate: "t.chave"}

var consultaPublicos = dados.Consulta{Tabela: "fabrica_publicos", Alias: "t",
	SQL: `select t.id, t.nome, t.marca_id, t.geo, t.idade_min, t.idade_max, t.generos, t.interesses,
	  t.custom_audiences, t.ativo, t.created_at from fabrica_publicos t`,
	Filtros: []dados.Filtro{filtroAtivo}, OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

// colunasCampanha: o que home, curar, subir e o robô leem. criado_por (uuid de pessoa) não sai.
const colunasCampanha = `t.id, t.nome, t.status, t.objetivo, t.job_id, t.desconto_tipo, t.desconto_pct, t.parcelas,
  t.created_at, t.fechada_em, t.purgado_em`

var consultaCampanhas = dados.Consulta{Tabela: "fabrica_campanhas", Alias: "t",
	SQL: `select ` + colunasCampanha + `, (select count(*) from fabrica_criativos c
	  where c.campanha_id = t.id and {ler:fabrica_criativos:c}) as qtd_criativos from fabrica_campanhas t`,
	Filtros: []dados.Filtro{
		{Param: "id", SQL: "t.id = @id::uuid", Tipo: "uuid"},
		{Param: "status", SQL: "t.status = any(@status::text[])", Tipo: "texto[]"},
		{Param: "aberta", SQL: "(t.fechada_em is null) = @aberta::boolean", Tipo: "booleano"},
		{Param: "purgada", SQL: "(t.purgado_em is not null) = @purgada::boolean", Tipo: "booleano"},
	},
	Ordens:      map[string]string{"created_at": "t.created_at", "fechada_em": "t.fechada_em"},
	OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

const colunasCriativo = `t.id, t.campanha_id, t.sku, t.arquetipo, t.template, t.formato, t.variante, t.preco_de,
  t.preco_por, t.storage_path, t.url, t.legenda, t.escolhido, t.purgado_em, t.created_at`

var consultaCriativos = dados.Consulta{Tabela: "fabrica_criativos", Alias: "t",
	SQL: `select ` + colunasCriativo + ` from fabrica_criativos t`,
	Filtros: []dados.Filtro{
		{Param: "campanha_id", SQL: "t.campanha_id = @campanha_id::uuid", Tipo: "uuid"},
		{Param: "escolhido", SQL: "t.escolhido = @escolhido::boolean", Tipo: "booleano"},
		{Param: "arquetipo", SQL: "t.arquetipo = @arquetipo::text", Tipo: "texto"},
		{Param: "purgado", SQL: "(t.purgado_em is not null) = @purgado::boolean", Tipo: "booleano"},
	},
	OrdemPadrao: "t.created_at", Desempate: "t.id"}

// consultaJobs: params->>'campanhaId' é expressão total (texto ou nulo, nunca erro): o filtro não vira
// oráculo (regra do modelo de leitura do mestre, IV.1).
var consultaJobs = dados.Consulta{Tabela: "fabrica_jobs", Alias: "t",
	SQL: `select t.id, t.tipo, t.params, t.status, t.github_run_id, t.resultado, t.erro, t.created_at, t.updated_at
	  from fabrica_jobs t`,
	Filtros: []dados.Filtro{
		{Param: "id", SQL: "t.id = @id::uuid", Tipo: "uuid"},
		{Param: "tipo", SQL: "t.tipo = @tipo::text", Tipo: "texto"},
		{Param: "status", SQL: "t.status = @status::text", Tipo: "texto"},
		{Param: "campanha_id", SQL: "t.params->>'campanhaId' = @campanha_id::text", Tipo: "texto"},
	},
	Ordens: map[string]string{"created_at": "t.created_at"}, OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

var consultaMetaJobs = dados.Consulta{Tabela: "fabrica_meta_jobs", Alias: "t",
	SQL: `select t.id, t.tipo, t.loja, t.ad_account_id, t.meta_campaign_id, t.adset_ids, t.ad_ids, t.payload,
	  t.status, t.erro, t.created_at from fabrica_meta_jobs t`,
	Filtros: []dados.Filtro{
		{Param: "campanha_id", SQL: "t.payload->>'campanhaId' = any(@campanha_id::text[])", Tipo: "texto[]"},
		{Param: "tipo", SQL: "t.tipo = @tipo::text", Tipo: "texto"},
		{Param: "com_campanha_meta", SQL: "(t.meta_campaign_id is not null) = @com_campanha_meta::boolean", Tipo: "booleano"},
	},
	Ordens: map[string]string{"created_at": "t.created_at"}, OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

var tabelaCriativos = dados.Tabela{Nome: "fabrica_criativos", Resposta: colunasCriativo}

type pedidoEscolher struct {
	IDs       []string `json:"ids"`
	Escolhido *bool    `json:"escolhido"`
}

// escolher: POST /fabrica/criativos/escolher. Catálogo (fab_criativos_write) em cada id pelo Tabela.Editar
// (PodeEditar trava a linha), tudo numa transação: um id que falha desfaz os outros.
func escolher(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var c pedidoEscolher
		if !dados.LerCorpo(w, r, &c) {
			return
		}
		if c.Escolhido == nil || len(c.IDs) == 0 || len(c.IDs) > 500 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Mande ids (1 a 500) e escolhido.")
			return
		}
		for _, id := range c.IDs {
			if !reUUID.MatchString(id) {
				dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "ids são uuids.")
				return
			}
		}
		ids := slices.Compact(slices.Sorted(slices.Values(c.IDs)))
		campos := map[string]any{"escolhido": *c.Escolhido}
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			for _, id := range ids {
				if _, err := tabelaCriativos.Editar(ctx, tx, autz.Producao, e, id, campos); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		responder(w, http.StatusOK, map[string]int{"atualizados": len(ids)})
	}
}

func montarLeituras(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaCriativos.Validar(autz.Producao))
	r.Get("/fabrica/lojas", consultaLojas.Handler(p, autz.Producao))
	r.Get("/fabrica/objetivos", consultaObjetivos.Handler(p, autz.Producao))
	r.Get("/fabrica/marcas", consultaMarcas.Handler(p, autz.Producao))
	r.Get("/fabrica/looks", consultaLooks.Handler(p, autz.Producao))
	r.Get("/fabrica/publicos", consultaPublicos.Handler(p, autz.Producao))
	r.Get("/fabrica/campanhas", consultaCampanhas.Handler(p, autz.Producao))
	r.Get("/fabrica/criativos", consultaCriativos.Handler(p, autz.Producao))
	r.Get("/fabrica/jobs", consultaJobs.Handler(p, autz.Producao))
	r.Get("/fabrica/meta-jobs", consultaMetaJobs.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/fabrica/criativos/escolher", escolher(p))
}
