package acesso

import (
	"encoding/json"
	"fmt"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasPerfil = `t.id, t.nome, t.permissions, t.criado_em, t.criado_por`

// GET /acesso/perfis. Regra acessos_perfis_ler: true (toda sessão). O filtro nome é igualdade exata: a
// tela procura o perfil pelo nome único antes de regravar.
var consultaPerfis = dados.Consulta{
	Tabela: "acessos_perfis", Alias: "t",
	SQL:     `select ` + colunasPerfil + ` from acessos_perfis t`,
	Filtros: []dados.Filtro{{Param: "nome", SQL: "t.nome = @nome::text", Tipo: "texto"}},
	Ordens:  map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.nome", Desempate: "t.id",
}

// POST /acesso/perfis e PATCH /acesso/perfis/{id}. Regra acessos_perfis_escrever: is_superadmin() — a
// LISTA DE E-MAILS cravada (autz.SuperEmail), não a ficha is_superadmin de profiles. Nome repetido =
// 409 (a tela usa o 409 para oferecer a regravação). criado_por vem da sessão (Ruling 5.1-9).
type corpoPerfilNovo struct {
	Nome        json.RawMessage `json:"nome,omitempty"`
	Permissions json.RawMessage `json:"permissions,omitempty"`
}

// PATCH muda só as permissões: renomear perfil não existe na tela (e perfil_id em profiles é por id).
type corpoPerfilEdicao struct {
	Permissions json.RawMessage `json:"permissions,omitempty"`
}

// permissionsObjeto: permissions, se veio, é objeto JSON (Ruling 5.1-13; null explícito também é recusado).
func permissionsObjeto(v json.RawMessage) error {
	var m map[string]json.RawMessage
	if v != nil && (json.Unmarshal(v, &m) != nil || m == nil) {
		return fmt.Errorf("permissions tem de ser um objeto")
	}
	return nil
}

func (c corpoPerfilNovo) Validar() error   { return permissionsObjeto(c.Permissions) }
func (c corpoPerfilEdicao) Validar() error { return permissionsObjeto(c.Permissions) }

var tabelaPerfis = dados.Tabela{Nome: "acessos_perfis", Resposta: colunasPerfil, Autor: "criado_por"}

func montarPerfis(r chi.Router, p *pgxpool.Pool) {
	deve(consultaPerfis.Validar(autz.Producao))
	deve(tabelaPerfis.Validar(autz.Producao))
	r.Get("/acesso/perfis", consultaPerfis.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/acesso/perfis", dados.RotaCriar[corpoPerfilNovo](p, autz.Producao, tabelaPerfis))
	r.With(soSessaoPropria).Patch("/acesso/perfis/{id}", dados.RotaEditar[corpoPerfilEdicao](p, autz.Producao, tabelaPerfis))
}
