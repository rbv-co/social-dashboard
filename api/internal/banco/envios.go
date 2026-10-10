package banco

import (
	"context"

	"github.com/jackc/pgx/v5/pgconn"
)

// Executor é o que pgxpool.Pool, pgxpool.Conn, pgx.Conn e pgx.Tx têm em comum para escrever.
type Executor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

// ReservarEnvio é o livro de envios: marca `chave` ANTES de mandar a mensagem. true = esta execução
// pode mandar; false = já foi mandada (ou está sendo, por outra execução). Uma execução repetida
// (manual, duas instâncias, reentrega) nunca reenvia.
func ReservarEnvio(ctx context.Context, db Executor, chave string) (bool, error) {
	tag, err := db.Exec(ctx, `insert into envios_feitos (chave) values ($1::text) on conflict (chave) do nothing`, chave)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() == 1, nil
}

// LiberarEnvio desfaz a reserva. Só quando o envio COMPROVADAMENTE não saiu (recusa com status):
// num envio ambíguo (prazo, queda no meio) a reserva fica, e a mensagem não é repetida.
func LiberarEnvio(ctx context.Context, db Executor, chave string) error {
	_, err := db.Exec(ctx, `delete from envios_feitos where chave = $1::text`, chave)
	return err
}
