package trafego

import (
	"encoding/json"
	"net/http"
	"regexp"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var consultaConfigMetricas = dados.Consulta{Tabela: "gt_config_metricas", Alias: "t",
	SQL:         `select t.balde, t.metricas, t.updated_at from gt_config_metricas t`,
	OrdemPadrao: "t.updated_at", Desempate: "t.balde"}

var consultaObjetivos = dados.Consulta{Tabela: "gt_objetivo_interacao", Alias: "t",
	SQL: `select t.alvo_id, t.nivel, t.interacao, t.conta_id, t.updated_at from gt_objetivo_interacao t`,
	Filtros: []dados.Filtro{
		{Param: "alvo_id", SQL: "t.alvo_id = @alvo_id::text", Tipo: "texto"},
		{Param: "conta_id", SQL: "t.conta_id = @conta_id::uuid", Tipo: "uuid"},
		{Param: "nivel", SQL: "t.nivel = @nivel::text", Tipo: "texto"}},
	OrdemPadrao: "t.updated_at", Desempate: "t.alvo_id"}

var (
	reBalde   = regexp.MustCompile(`^[a-z_]{1,40}$`)
	reMetrica = regexp.MustCompile(`^[a-z0-9_]{1,40}$`)
)

// upsert grava `linha` por dados.UpsertVisivel na transação de quem pede e responde 200 com a linha.
func upsert(w http.ResponseWriter, r *http.Request, p *pgxpool.Pool, e *autz.Escopo, tab string, chave []string, linha map[string]any, resposta string) {
	var corpo []byte
	err := banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) (err error) {
		corpo, err = dados.UpsertVisivel(r.Context(), tx, autz.Producao, e, tab, chave, linha, resposta)
		return err
	})
	if err != nil {
		dados.ErroDeEscrita(w, err)
		return
	}
	dados.Responder(w, http.StatusOK, corpo)
}

// gravarConfig: PUT /gestao-trafego/config-metricas/{balde}.
func gravarConfig(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOu500(w, r)
		if e == nil {
			return
		}
		balde := chi.URLParam(r, "balde")
		if !reBalde.MatchString(balde) {
			dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
			return
		}
		var in struct {
			Metricas json.RawMessage `json:"metricas"`
		}
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		var lista []string
		if json.Unmarshal(in.Metricas, &lista) != nil || lista == nil || len(lista) > 30 || !todasCasam(lista, reMetrica) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "metricas é uma lista de até 30 chaves de métrica.")
			return
		}
		upsert(w, r, p, e, "gt_config_metricas", []string{"balde"},
			map[string]any{"balde": balde, "metricas": in.Metricas, "updated_at": agora()}, "balde, metricas, updated_at")
	}
}

func todasCasam(l []string, re *regexp.Regexp) bool {
	for _, s := range l {
		if !re.MatchString(s) {
			return false
		}
	}
	return true
}

// gravarObjetivo: PUT /gestao-trafego/objetivos/{alvo_id}. conta_id não amarra alvo_id a uma conta
// (Ruling 5.7-7): paridade com a policy, que não tem a restritiva.
func gravarObjetivo(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOu500(w, r)
		if e == nil {
			return
		}
		alvo := chi.URLParam(r, "alvo_id")
		if !reIDDaMeta.MatchString(alvo) {
			dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
			return
		}
		var in struct {
			Nivel     json.RawMessage `json:"nivel"`
			Interacao json.RawMessage `json:"interacao"`
			ContaID   json.RawMessage `json:"conta_id"`
		}
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if !textoEm(in.Nivel, "campanha", "anuncio") || !textoEm(in.Interacao, "curtidas", "comentarios", "salvamentos", "compartilhamentos") ||
			in.ContaID == nil || (!nulo(in.ContaID) && !casa(in.ContaID, reUUID)) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Informe nivel, interacao e conta_id (ou null).")
			return
		}
		upsert(w, r, p, e, "gt_objetivo_interacao", []string{"alvo_id"},
			map[string]any{"alvo_id": alvo, "nivel": in.Nivel, "interacao": in.Interacao, "conta_id": in.ContaID,
				"updated_at": agora(), "updated_by": e.ID},
			"alvo_id, nivel, interacao, conta_id, updated_at")
	}
}

// apagarObjetivo: DELETE /gestao-trafego/objetivos/{alvo_id} — 204 também sem linha (Ruling 5.7-8). A regra
// de apagar só depende de quem pede (gestor), por isso o "não pode" sai antes do banco.
func apagarObjetivo(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOu500(w, r)
		if e == nil {
			return
		}
		alvo := chi.URLParam(r, "alvo_id")
		if !reIDDaMeta.MatchString(alvo) {
			dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
			return
		}
		fa, err := autz.Producao.Filtro(e, "gt_objetivo_interacao", autz.Apagar, "t")
		if err != nil || fa.Nega() {
			if err == nil {
				err = autz.ErrNegado
			}
			dados.ErroDeEscrita(w, err)
			return
		}
		err = banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) error {
			_, err := tx.Exec(r.Context(), `delete from gt_objetivo_interacao t where t.alvo_id = @alvo::text and (`+fa.SQL+`)`,
				fa.Juntar(pgx.NamedArgs{"alvo": alvo}))
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func montarEscolhas(r chi.Router, p *pgxpool.Pool) {
	r.Get("/gestao-trafego/config-metricas", consultaConfigMetricas.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/gestao-trafego/config-metricas/{balde}", gravarConfig(p))
	r.Get("/gestao-trafego/objetivos", consultaObjetivos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/gestao-trafego/objetivos/{alvo_id}", gravarObjetivo(p))
	r.With(soSessaoPropria).Delete("/gestao-trafego/objetivos/{alvo_id}", apagarObjetivo(p))
}
