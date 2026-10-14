package patrimonio

import (
	"encoding/json"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Posses: "a posse segue o bem". Toda regra é a do catálogo de produção (autz.Producao): patrimonio_posse_rw
// (is_patrimonio_admin) E a restritiva patrimonio_posse_segue_o_bem (o bem é visível por pode_ver_bem).
// Posse de bem que a pessoa não vê não aparece, não se fecha (404) e não se cria (403, igual ao bem que
// nem existe).
//
// pessoa_id aponta para acessos_pessoas, cuja regra de Ler quem tem só patrimônio não satisfaz: pessoa
// existente = 201 e inexistente = 403 do POST (Ruling 5.2-17). Não se valida contra a regra de Ler porque
// quem tem patrimônio já lista todas as pessoas com id por pessoas_para_escolher() e a posse perderia o dono.

const colunasPosse = `t.id, t.bem_id, t.pessoa_id, t.pessoa_nome, t.de, t.ate, t.motivo, t.criado_em`

// GET /patrimonio/posses. Filtros: bem_id (a ficha), aberta (relatório "com quem está": ate is null),
// de_desde/de_ate (relatório do período, pela data de início).
var consultaPosses = dados.Consulta{
	Tabela: "patrimonio_posse", Alias: "t",
	SQL: `select ` + colunasPosse + ` from patrimonio_posse t`,
	Filtros: []dados.Filtro{
		{Param: "bem_id", SQL: "t.bem_id = @bem_id::uuid", Tipo: "uuid"},
		{Param: "aberta", SQL: "(t.ate is null) = @aberta::boolean", Tipo: "booleano"},
		{Param: "de_desde", SQL: "t.de >= @de_desde::date", Tipo: "data"},
		{Param: "de_ate", SQL: "t.de <= @de_ate::date", Tipo: "data"},
	},
	Ordens:      map[string]string{"de": "t.de"},
	OrdemPadrao: "t.de desc",
	Desempate:   "t.id",
}

// corpoPosseNova: o que sincronizarPosse grava (tela-de-patrimonio.vue:1624-1630). pessoa_nome vem da
// tela, como hoje: é o nome congelado no histórico.
type corpoPosseNova struct {
	BemID      json.RawMessage `json:"bem_id,omitempty"`
	PessoaID   json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome json.RawMessage `json:"pessoa_nome,omitempty"`
	De         json.RawMessage `json:"de,omitempty"`
	Ate        json.RawMessage `json:"ate,omitempty"`
	Motivo     json.RawMessage `json:"motivo,omitempty"`
}

// corpoFimDaPosse: o PATCH só fecha (tela-de-patrimonio.vue:1620); trocar o bem de uma posse não existe.
type corpoFimDaPosse struct {
	Ate json.RawMessage `json:"ate,omitempty"`
}

// POST (CriarSoLegivel: posse de bem que a pessoa não vê = 403, nada gravado — Ruling 5.2-2) e
// PATCH /{id} (PodeEditar: posse de bem invisível = 404).
var tabelaPosses = dados.Tabela{Nome: "patrimonio_posse", Resposta: colunasPosse, CriarSoLegivel: true}

// montarPosses: GET/POST /patrimonio/posses e PATCH /patrimonio/posses/{id}. Monte DEPOIS de auth.Exigir
// e autz.ComEscopo. Sem DELETE: a posse some junto do bem (FK em cascata). Cada escrita passa por
// soSessaoPropria.
func montarPosses(r chi.Router, p *pgxpool.Pool) {
	cat := autz.Producao
	deve(consultaPosses.Validar(cat))
	deve(tabelaPosses.Validar(cat))
	r.Get("/patrimonio/posses", consultaPosses.Handler(p, cat))
	r.With(soSessaoPropria).Post("/patrimonio/posses", dados.RotaCriar[corpoPosseNova](p, cat, tabelaPosses))
	r.With(soSessaoPropria).Patch("/patrimonio/posses/{id}", dados.RotaEditar[corpoFimDaPosse](p, cat, tabelaPosses))
}
