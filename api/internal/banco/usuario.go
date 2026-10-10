package banco

import (
	"context"
	"errors"
	"regexp"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ErrUsuarioInvalido: o id de usuário não é um uuid.
var ErrUsuarioInvalido = errors.New("usuário inválido: não é um uuid")

var reUUID = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)

// ComUsuario roda fn numa transação em que auth.uid() devolve usuarioID (as funções e
// triggers herdados de produção leem a identidade daí). Commit se fn devolver nil.
// set_config(..., true) vale só até o fim da transação: não vaza para a próxima.
func ComUsuario(ctx context.Context, p *pgxpool.Pool, usuarioID string, fn func(tx pgx.Tx) error) error {
	if !reUUID.MatchString(usuarioID) {
		return ErrUsuarioInvalido
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select set_config('app.usuario_id', $1, true)`, usuarioID); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
