package vendas

import (
	"encoding/json"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasLoja = `t.loja_id, t.nome, t.grupo, t.grupo_id, t.fechado_em`

// GET /comercial/lojas (authenticated read bling_lojas: true). gav:685; admin:881, 1229, 4107; av:394 (?ordem=loja_id).
var consultaLojas = dados.Consulta{Tabela: "bling_lojas", Alias: "t", SQL: `select ` + colunasLoja + ` from bling_lojas t`,
	Ordens: map[string]string{"nome": "t.nome", "loja_id": "t.loja_id"}, OrdemPadrao: "t.nome", Desempate: "t.loja_id"}

// PATCH /comercial/lojas/{id} — {id} = loja_id (bling_lojas_grupo_superadmin: superadmin_pela_ficha() antes e
// depois). O que o Admin grava (tela-de-admin.vue:1072 fechado_em; :1194 grupo_id); o texto `grupo` vem do
// gatilho espelhar_grupo_do_canal e volta na resposta. Mandar nome/grupo/loja_id = 400.
type corpoLoja struct {
	FechadoEm json.RawMessage `json:"fechado_em,omitempty"`
	GrupoID   json.RawMessage `json:"grupo_id,omitempty"`
}

var tabelaLojas = dados.Tabela{Nome: "bling_lojas", Chave: "loja_id", Resposta: colunasLoja}

func montarLojas(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaLojas.Validar(autz.Producao))
	r.Get("/comercial/lojas", consultaLojas.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Patch("/comercial/lojas/{id}", dados.RotaEditar[corpoLoja](p, autz.Producao, tabelaLojas))
}
