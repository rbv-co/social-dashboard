package canais

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// Carregar lê do banco o escopo do ator e devolve os canais (nil = todos).
//
// Conta de serviço (sessão tipo "servico") NUNCA é limitada a loja: regra explícita da spec
// §4 (os robôs do coletor leem o faturamento inteiro). Sem linha em profiles = nenhum canal:
// falta de dado nunca amplia.
//
// ⚠️ As leituras de vínculo filtram por profile_id = o ator. Sem esse filtro viria o vínculo
// de TODO MUNDO e a regra ampliaria o acesso de quem não devia (a edge tinha o mesmo aviso).
func Carregar(ctx context.Context, p *pgxpool.Pool, a *auth.Ator) ([]int64, error) {
	if a == nil {
		return []int64{}, nil // sem ator, nega
	}
	if a.Tipo == "servico" {
		return nil, nil
	}
	var porEquipe bool
	err := p.QueryRow(ctx, `select coalesce(escopo_por_equipe, false) from profiles where id = $1`, a.ID).Scan(&porEquipe)
	if errors.Is(err, pgx.ErrNoRows) {
		return []int64{}, nil
	}
	if err != nil {
		return nil, err
	}
	e := Escopo{SuperAdmin: a.SuperAdmin, PorEquipe: porEquipe, MeuID: a.ID}
	if e.SuperAdmin || !e.PorEquipe {
		return nil, nil // economia de consulta: a regra devolveria nil de qualquer jeito
	}
	linhas, err := p.Query(ctx, `select equipe_id::text, profile_id::text, coalesce(papel, '') from equipes_membros where profile_id = $1`, a.ID)
	if err != nil {
		return nil, err
	}
	if e.Membros, err = pgx.CollectRows(linhas, func(r pgx.CollectableRow) (m Membro, err error) {
		return m, r.Scan(&m.EquipeID, &m.ProfileID, &m.Papel)
	}); err != nil {
		return nil, err
	}
	linhas, err = p.Query(ctx, `select e.id::text, e.canal_loja_id from equipes e
		where e.id in (select equipe_id from equipes_membros where profile_id = $1)`, a.ID)
	if err != nil {
		return nil, err
	}
	if e.Times, err = pgx.CollectRows(linhas, func(r pgx.CollectableRow) (t Time, err error) {
		return t, r.Scan(&t.ID, &t.CanalLojaID)
	}); err != nil {
		return nil, err
	}
	// TODOS os canais com o grupo: é o que deixa a supervisora ver o grupo inteiro.
	linhas, err = p.Query(ctx, `select loja_id, grupo, grupo_id::text from bling_lojas`)
	if err != nil {
		return nil, err
	}
	if e.Canais, err = pgx.CollectRows(linhas, func(r pgx.CollectableRow) (c Canal, err error) {
		return c, r.Scan(&c.LojaID, &c.Grupo, &c.GrupoID)
	}); err != nil {
		return nil, err
	}
	linhas, err = p.Query(ctx, `select grupo_id::text, profile_id::text, coalesce(papel, '') from canais_grupos_membros where profile_id = $1`, a.ID)
	if err != nil {
		return nil, err
	}
	if e.MembrosDeGrupo, err = pgx.CollectRows(linhas, func(r pgx.CollectableRow) (g MembroDeGrupo, err error) {
		return g, r.Scan(&g.GrupoID, &g.ProfileID, &g.Papel)
	}); err != nil {
		return nil, err
	}
	return DoEscopo(e), nil
}

// Handler: GET /eu/canais -> {"canais": null} (vê todos) ou {"canais": [ids]} ([] = nenhum).
// Deve vir DEPOIS de auth.Exigir.
func Handler(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := Carregar(r.Context(), p, auth.AtorDoContexto(r.Context()))
		w.Header().Set("Content-Type", "application/json")
		if err != nil {
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":"erro_interno"}`))
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"canais": c})
	}
}
