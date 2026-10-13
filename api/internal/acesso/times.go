package acesso

import (
	"encoding/json"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Times: equipes, membros e liberações de estoque. Toda regra é a do catálogo de produção
// (autz.Producao): o escopo por equipe (pode_ver_equipe, sou_gestor_da_equipe) é do banco/catálogo, não
// destas declarações. Vínculo ou liberação que a pessoa não enxerga responde 404, igual ao que não existe.

const colunasTime = `t.id, t.nome, t.tipo, t.ativo, t.canal_loja_id, t.local_id, t.setor_id, t.empresa_id, ` +
	`t.deposito_id, t.ordem, t.criado_em, t.atualizado_em`

// GET /equipes/times. Regra equipes_leitura: true (toda sessão).
var consultaTimes = dados.Consulta{Tabela: "equipes", Alias: "t", SQL: `select ` + colunasTime + ` from equipes t`,
	Ordens: map[string]string{"nome": "t.nome", "ordem": "t.ordem"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}

// POST /equipes/times (equipes_criar: super pela ficha OU gestor direto em alguma equipe) e
// PATCH /equipes/times/{id} (equipes_editar: sou_gestor_da_equipe(id)). O que a tela grava.
type corpoTime struct {
	Nome        json.RawMessage `json:"nome,omitempty"`
	Tipo        json.RawMessage `json:"tipo,omitempty"`
	CanalLojaID json.RawMessage `json:"canal_loja_id,omitempty"`
}

var tabelaTimes = dados.Tabela{Nome: "equipes", Resposta: colunasTime}

const colunasMembro = `t.id, t.equipe_id, t.profile_id, t.papel, t.criado_em, t.criado_por`

// GET /equipes/membros. Regra membros_leitura: a própria linha OU pode_ver_equipe(equipe_id).
var consultaMembros = dados.Consulta{Tabela: "equipes_membros", Alias: "t", SQL: `select ` + colunasMembro + ` from equipes_membros t`,
	Filtros: []dados.Filtro{
		{Param: "equipe_id", SQL: "t.equipe_id = @equipe_id::uuid", Tipo: "uuid"},
		{Param: "profile_id", SQL: "t.profile_id = @profile_id::uuid", Tipo: "uuid"},
		{Param: "papel", SQL: "t.papel = any(@papel::text[])", Tipo: "texto[]"},
	},
	Ordens: map[string]string{"criado_em": "t.criado_em"}, OrdemPadrao: "t.criado_em", Desempate: "t.id"}

// POST /equipes/membros, PATCH (só o papel: trocar de time não existe na tela) e DELETE /equipes/membros/{id}.
// Regra membros_escrever: sou_gestor_da_equipe(equipe_id) antes e depois. criado_por = default auth.uid().
type corpoMembroNovo struct {
	EquipeID  json.RawMessage `json:"equipe_id,omitempty"`
	ProfileID json.RawMessage `json:"profile_id,omitempty"`
	Papel     json.RawMessage `json:"papel,omitempty"`
}

type corpoMembroPapel struct {
	Papel json.RawMessage `json:"papel,omitempty"`
}

var tabelaMembros = dados.Tabela{Nome: "equipes_membros", Resposta: colunasMembro}

const colunasLiberacao = `t.id, t.equipe_id, t.profile_id, t.chave, t.concedido_por, t.criado_em`

// GET /equipes/permissoes (eqperm_leitura: a própria OU pode_ver_equipe), POST e DELETE /equipes/permissoes/{id}
// (eqperm_escrever: super pela ficha OU supervisora/gestora do time pelos vínculos). concedido_por = default
// auth.uid(). Apagada por id (Ruling 5.1-14).
var consultaLiberacoes = dados.Consulta{Tabela: "equipes_permissoes", Alias: "t", SQL: `select ` + colunasLiberacao + ` from equipes_permissoes t`,
	Filtros: []dados.Filtro{
		{Param: "equipe_id", SQL: "t.equipe_id = @equipe_id::uuid", Tipo: "uuid"},
		{Param: "profile_id", SQL: "t.profile_id = @profile_id::uuid", Tipo: "uuid"},
	},
	Ordens: map[string]string{"criado_em": "t.criado_em"}, OrdemPadrao: "t.criado_em", Desempate: "t.id"}

type corpoLiberacao struct {
	EquipeID  json.RawMessage `json:"equipe_id,omitempty"`
	ProfileID json.RawMessage `json:"profile_id,omitempty"`
	Chave     json.RawMessage `json:"chave,omitempty"`
}

var tabelaLiberacoes = dados.Tabela{Nome: "equipes_permissoes", Resposta: colunasLiberacao}

// montarTimes: GET/POST /equipes/times, PATCH /equipes/times/{id}; GET/POST /equipes/membros,
// PATCH/DELETE /equipes/membros/{id}; GET/POST /equipes/permissoes, DELETE /equipes/permissoes/{id}.
// Monte DEPOIS de auth.Exigir e autz.ComEscopo. Cada escrita passa por soSessaoPropria.
func montarTimes(r chi.Router, p *pgxpool.Pool) {
	cat := autz.Producao
	for _, c := range []dados.Consulta{consultaTimes, consultaMembros, consultaLiberacoes} {
		deve(c.Validar(cat))
	}
	for _, t := range []dados.Tabela{tabelaTimes, tabelaMembros, tabelaLiberacoes} {
		deve(t.Validar(cat))
	}
	r.Get("/equipes/times", consultaTimes.Handler(p, cat))
	r.Get("/equipes/membros", consultaMembros.Handler(p, cat))
	r.Get("/equipes/permissoes", consultaLiberacoes.Handler(p, cat))

	r.With(soSessaoPropria).Post("/equipes/times", dados.RotaCriar[corpoTime](p, cat, tabelaTimes))
	r.With(soSessaoPropria).Patch("/equipes/times/{id}", dados.RotaEditar[corpoTime](p, cat, tabelaTimes))
	r.With(soSessaoPropria).Post("/equipes/membros", dados.RotaCriar[corpoMembroNovo](p, cat, tabelaMembros))
	r.With(soSessaoPropria).Patch("/equipes/membros/{id}", dados.RotaEditar[corpoMembroPapel](p, cat, tabelaMembros))
	r.With(soSessaoPropria).Delete("/equipes/membros/{id}", dados.RotaApagar(p, cat, tabelaMembros))
	r.With(soSessaoPropria).Post("/equipes/permissoes", dados.RotaCriar[corpoLiberacao](p, cat, tabelaLiberacoes))
	r.With(soSessaoPropria).Delete("/equipes/permissoes/{id}", dados.RotaApagar(p, cat, tabelaLiberacoes))
}
