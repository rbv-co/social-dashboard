package auth

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Ator é quem está fazendo a requisição, já com o que pode.
type Ator struct {
	ID             string
	Tipo           string // painel | cliente | servico
	Papel          string
	SuperAdmin     bool
	Permissoes     map[string][]string // recurso -> ações ("ver","criar","editar","excluir")
	ImpersonadorID *string
}

func CarregarAtor(ctx context.Context, p *pgxpool.Pool, s *Sessao) (*Ator, error) {
	a := &Ator{ID: s.UsuarioID, Tipo: s.Tipo, ImpersonadorID: s.ImpersonadorID, Permissoes: map[string][]string{}}
	var perm []byte
	err := p.QueryRow(ctx,
		`select coalesce(role, ''), coalesce(is_superadmin, false), coalesce(permissions, '{}'::jsonb)
		   from profiles where id = $1`, s.UsuarioID).Scan(&a.Papel, &a.SuperAdmin, &perm)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, nil // sem perfil = sem permissão (cliente da Vessel não tem profile)
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(perm, &a.Permissoes); err != nil {
		return nil, err
	}
	return a, nil
}
