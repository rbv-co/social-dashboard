// Package importacao copia dados do Supabase para o banco novo.
package importacao

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type UsuarioOrigem struct {
	ID, Email, SenhaHash              string
	ConfirmadoEm, CriadoEm, BanidoAte *time.Time
}

type Fonte interface {
	Usuarios(ctx context.Context) ([]UsuarioOrigem, error)
}

// Importar é idempotente: pode rodar quantas vezes precisar no ensaio.
// Conta sem e-mail (login só por telefone) é ignorada e contada.
func Importar(ctx context.Context, f Fonte, p *pgxpool.Pool, agora time.Time) (importados, ignorados int, err error) {
	lista, err := f.Usuarios(ctx)
	if err != nil {
		return 0, 0, err
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		return 0, 0, err
	}
	defer tx.Rollback(ctx)
	for _, u := range lista {
		email := strings.TrimSpace(u.Email)
		if email == "" {
			ignorados++
			continue
		}
		var desativado *time.Time
		if u.BanidoAte != nil && u.BanidoAte.After(agora) {
			desativado = &agora
		}
		criado := agora
		if u.CriadoEm != nil {
			criado = *u.CriadoEm
		}
		if _, err := tx.Exec(ctx, `
			insert into usuarios (id, email, senha_hash, email_confirmado_em, criado_em, desativado_em)
			values ($1, $2, $3, $4, $5, $6)
			on conflict (id) do update set email = excluded.email, senha_hash = excluded.senha_hash,
			  email_confirmado_em = excluded.email_confirmado_em, desativado_em = excluded.desativado_em`,
			u.ID, email, nullSeVazio(u.SenhaHash), u.ConfirmadoEm, criado, desativado); err != nil {
			return 0, 0, err
		}
		importados++
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, 0, err
	}
	return importados, ignorados, nil
}

func nullSeVazio(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

type fonteSupabase struct{ url string }

// FonteSupabase lê auth.users em transação somente leitura.
func FonteSupabase(url string) Fonte { return fonteSupabase{url} }

func (f fonteSupabase) Usuarios(ctx context.Context) ([]UsuarioOrigem, error) {
	c, err := pgx.Connect(ctx, f.url)
	if err != nil {
		return nil, err
	}
	defer c.Close(ctx)
	tx, err := c.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	rows, err := tx.Query(ctx, `select id::text, coalesce(email, ''), coalesce(encrypted_password, ''),
		email_confirmed_at, created_at, banned_until from auth.users where deleted_at is null`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []UsuarioOrigem
	for rows.Next() {
		var u UsuarioOrigem
		if err := rows.Scan(&u.ID, &u.Email, &u.SenhaHash, &u.ConfirmadoEm, &u.CriadoEm, &u.BanidoAte); err != nil {
			return nil, err
		}
		out = append(out, u)
	}
	return out, rows.Err()
}
