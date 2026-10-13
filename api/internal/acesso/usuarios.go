package acesso

import (
	"encoding/json"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasUsuario = `t.id, t.email, t.name, t.role, t.is_superadmin, t.permissions, t.permissions_excecao, ` +
	`t.features, t.disabled, t.avatar_url, t.allowed_accounts, t.created_at, t.perfil_id, t.escopo_por_equipe`

// GET /acesso/usuarios: a lista de pessoas de todas as telas (admin, times, frota, conteúdo, redes).
// Regra: auth_read_profiles (sessão de conta ativa lê todos os perfis).
var consultaUsuarios = dados.Consulta{
	Tabela: "profiles", Alias: "t",
	SQL: `select ` + colunasUsuario + ` from profiles t`,
	Filtros: []dados.Filtro{
		{Param: "id", SQL: "t.id = @id::uuid", Tipo: "uuid"},
		{Param: "email", SQL: "lower(t.email) = lower(@email::text)", Tipo: "texto"},
		{Param: "perfil_id", SQL: "t.perfil_id = @perfil_id::uuid", Tipo: "uuid"},
	},
	Ordens:      map[string]string{"name": "t.name", "email": "t.email", "created_at": "t.created_at"},
	OrdemPadrao: "t.name",
	Desempate:   "t.id",
}

// corpoUsuario: as colunas de profiles que as telas gravam (inventário). Ausente = não muda; null
// explícito = grava nulo (allowed_accounts nulo = vê todas as contas).
type corpoUsuario struct {
	AvatarURL          json.RawMessage `json:"avatar_url,omitempty"`
	PrecisaTrocarSenha json.RawMessage `json:"precisa_trocar_senha,omitempty"`
	PerfilID           json.RawMessage `json:"perfil_id,omitempty"`
	Permissions        json.RawMessage `json:"permissions,omitempty"`
	PermissionsExcecao json.RawMessage `json:"permissions_excecao,omitempty"`
	Features           json.RawMessage `json:"features,omitempty"`
	AllowedAccounts    json.RawMessage `json:"allowed_accounts,omitempty"`
	IsSuperadmin       json.RawMessage `json:"is_superadmin,omitempty"`
	EscopoPorEquipe    json.RawMessage `json:"escopo_por_equipe,omitempty"`
	Role               json.RawMessage `json:"role,omitempty"`
	Disabled           json.RawMessage `json:"disabled,omitempty"`
}

// Validar: os dois mapas de permissão têm de ser objeto (Ruling 5.1-13), nesta ordem fixa; o resto é o
// tipo da coluna.
func (c corpoUsuario) Validar() error {
	if err := mapaDePermissoes("permissions", c.Permissions); err != nil {
		return err
	}
	return mapaDePermissoes("permissions_excecao", c.PermissionsExcecao)
}

// PATCH /acesso/usuarios/{id}. Regra: admin_update_profiles + os gatilhos guard_profiles e
// impedir_autopromocao, que leem auth.uid() dentro de banco.ComUsuario.
var tabelaUsuarios = dados.Tabela{Nome: "profiles", Resposta: colunasUsuario}

func montarUsuarios(r chi.Router, p *pgxpool.Pool) {
	deve(consultaUsuarios.Validar(autz.Producao))
	deve(tabelaUsuarios.Validar(autz.Producao))
	r.Get("/acesso/usuarios", consultaUsuarios.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Patch("/acesso/usuarios/{id}", dados.RotaEditar[corpoUsuario](p, autz.Producao, tabelaUsuarios))
}
