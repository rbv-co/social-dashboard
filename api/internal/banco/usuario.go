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

// ErrPapelInvalido: papel de banco fora da lista fechada.
var ErrPapelInvalido = errors.New("papel de banco inválido")

// ComAnonimo roda fn numa transação SEM usuário (auth.uid() é nulo), com o papel do banco que a função enxerga em
// auth.role() ("anon", ou "dono" = NULL, a conexão direta do dono do banco: lista fechada; ver compat.sql) e o IP e o
// User-Agent do cliente em request.headers, de onde vessel_hash_de_origem() e vessel_verificar() os leem (o PostgREST pôs o cabeçalho ali; sem ele todo cliente viraria "sem-ip" e os tetos por
// IP das funções viram globais). Os valores valem só até o fim da transação.
func ComAnonimo(ctx context.Context, p *pgxpool.Pool, papel, ip, agente string, fn func(tx pgx.Tx) error) error {
	if papel != "anon" && papel != "dono" {
		return ErrPapelInvalido
	}
	tx, err := p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if len(agente) > 512 { // as funções guardam no máximo 300; o resto é só peso
		agente = agente[:512]
	}
	if _, err := tx.Exec(ctx, `select set_config('app.papel_db', $1, true),
		set_config('request.headers', (select coalesce(json_object_agg(k, v), '{}'::json)::text
		   from (values ('x-forwarded-for', $2::text), ('user-agent', $3::text)) h(k, v) where v <> ''), true)`,
		papel, ip, agente); err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
