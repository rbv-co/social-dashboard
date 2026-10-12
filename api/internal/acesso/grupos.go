package acesso

import (
	"encoding/json"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasGrupo = `t.id, t.nome, t.ordem, t.ativo, t.criado_em`

// GET /equipes/grupos (canais_grupos_leitura: true). POST, PATCH e DELETE /equipes/grupos/{id}
// (canais_grupos_escrever: superadmin_pela_ficha, a ficha e não o e-mail). Renomear leva o nome a
// bling_lojas.grupo (gatilho espelhar_rename_do_grupo, que só roda dentro de banco.ComUsuario como
// qualquer escrita); nome repetido (índice lower/btrim) = 409.
var consultaGrupos = dados.Consulta{Tabela: "canais_grupos", Alias: "t", SQL: `select ` + colunasGrupo + ` from canais_grupos t`,
	Ordens: map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.nome", Desempate: "t.id"}

type corpoGrupo struct {
	Nome json.RawMessage `json:"nome,omitempty"`
}

var tabelaGrupos = dados.Tabela{Nome: "canais_grupos", Resposta: colunasGrupo}

const colunasSupervisora = `t.id, t.grupo_id, t.profile_id, t.papel, t.concedido_por, t.concedido_em`

// GET /equipes/grupos-membros (cgm_leitura: a própria linha OU pode_ver_grupo(grupo_id)); POST e
// DELETE /equipes/grupos-membros/{id} (cgm_escrever: superadmin_pela_ficha). concedido_por = sessão
// (Ruling 5.1-9): o corpo não o aceita. Quem não lê a linha recebe 404 no DELETE, igual ao id que não existe.
var consultaSupervisoras = dados.Consulta{Tabela: "canais_grupos_membros", Alias: "t", SQL: `select ` + colunasSupervisora + ` from canais_grupos_membros t`,
	Filtros: []dados.Filtro{
		{Param: "grupo_id", SQL: "t.grupo_id = @grupo_id::uuid", Tipo: "uuid"},
		{Param: "profile_id", SQL: "t.profile_id = @profile_id::uuid", Tipo: "uuid"},
	},
	Ordens: map[string]string{"concedido_em": "t.concedido_em"}, OrdemPadrao: "t.concedido_em", Desempate: "t.id"}

type corpoSupervisora struct {
	GrupoID   json.RawMessage `json:"grupo_id,omitempty"`
	ProfileID json.RawMessage `json:"profile_id,omitempty"`
	Papel     json.RawMessage `json:"papel,omitempty"`
}

var tabelaSupervisoras = dados.Tabela{Nome: "canais_grupos_membros", Resposta: colunasSupervisora, Autor: "concedido_por"}

func montarGrupos(r chi.Router, p *pgxpool.Pool) {
	deve(consultaGrupos.Validar(autz.Producao))
	deve(tabelaGrupos.Validar(autz.Producao))
	deve(consultaSupervisoras.Validar(autz.Producao))
	deve(tabelaSupervisoras.Validar(autz.Producao))
	r.Get("/equipes/grupos", consultaGrupos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/equipes/grupos", dados.RotaCriar[corpoGrupo](p, autz.Producao, tabelaGrupos))
	r.With(soSessaoPropria).Patch("/equipes/grupos/{id}", dados.RotaEditar[corpoGrupo](p, autz.Producao, tabelaGrupos))
	r.With(soSessaoPropria).Delete("/equipes/grupos/{id}", dados.RotaApagar(p, autz.Producao, tabelaGrupos))
	r.Get("/equipes/grupos-membros", consultaSupervisoras.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/equipes/grupos-membros", dados.RotaCriar[corpoSupervisora](p, autz.Producao, tabelaSupervisoras))
	r.With(soSessaoPropria).Delete("/equipes/grupos-membros/{id}", dados.RotaApagar(p, autz.Producao, tabelaSupervisoras))
}
