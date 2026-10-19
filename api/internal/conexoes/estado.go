// Package conexoes guarda o "state" do OAuth (a trava de CSRF e de fixação de conexão) em acessos_conexoes, para o Zoho
// e a Microsoft. O state nasce numa rota de admin (acessos-proxy authUrl), vale 10 minutos e é de uso único: o retorno do
// provedor (rota pública) só grava o refresh_token se trouxer o mesmo state. Os segredos da conexão ficam nos pacotes
// zoho e microsoft; aqui só passa o state.
package conexoes

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrSemConexao     = errors.New("conexoes: provedor sem linha em acessos_conexoes")
	ErrEstadoInvalido = errors.New("conexoes: state inválido")
	ErrEstadoExpirado = errors.New("conexoes: state expirado")
)

// ValidadeDoEstado: o mesmo teto da edge acessos-oauth.
const ValidadeDoEstado = 10 * time.Minute

// NovoEstado grava um state aleatório (256 bits) na linha do provedor e o devolve. Um novo pedido substitui o anterior.
func NovoEstado(ctx context.Context, p *pgxpool.Pool, provedor string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	estado := hex.EncodeToString(b)
	tag, err := p.Exec(ctx, `update acessos_conexoes set oauth_state = $2, oauth_state_em = now() where provedor = $1`, provedor, estado)
	if err != nil {
		return "", err
	}
	if tag.RowsAffected() == 0 {
		return "", ErrSemConexao
	}
	return estado, nil
}

// ConsumirEstado confere o state recebido (tempo constante) e o apaga: uso único. Vencido também apaga; divergente NÃO
// apaga (um pedido forjado não derruba a conexão em andamento do admin).
func ConsumirEstado(ctx context.Context, p *pgxpool.Pool, provedor, recebido string) error {
	tx, err := p.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var guardado *string
	var em *time.Time
	err = tx.QueryRow(ctx, `select oauth_state, oauth_state_em from acessos_conexoes where provedor = $1 for update`, provedor).Scan(&guardado, &em)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSemConexao
	}
	if err != nil {
		return err
	}
	if guardado == nil || *guardado == "" || subtle.ConstantTimeCompare([]byte(*guardado), []byte(recebido)) != 1 {
		return ErrEstadoInvalido
	}
	if _, err := tx.Exec(ctx, `update acessos_conexoes set oauth_state = null where provedor = $1`, provedor); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if em != nil && time.Since(*em) > ValidadeDoEstado {
		return ErrEstadoExpirado
	}
	return nil
}
