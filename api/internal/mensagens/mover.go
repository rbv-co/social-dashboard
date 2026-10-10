// Package mensagens: os robôs de mensagem (WhatsApp pelo Chatwoot) do abandono de checkout.
package mensagens

import (
	"context"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// MoverAbandonados porta o job abandono-de-checkout (pg_cron 1/min, SQL puro):
// `select public.mover_abandonados_para_fila(10)`. A regra (10 min sem evento -> fila de envio;
// Pix vencido em 35 min reabre) continua na função do banco restaurado.
func MoverAbandonados(p *pgxpool.Pool) worker.Tarefa {
	return worker.Tarefa{Nome: "abandono-de-checkout", Agenda: "* * * * *", Limite: 30 * time.Second,
		Executar: func(ctx context.Context) error {
			var n int
			if err := p.QueryRow(ctx, `select mover_abandonados_para_fila(p_minutos => 10)`).Scan(&n); err != nil {
				return err
			}
			if n > 0 {
				slog.Info("abandono-de-checkout", "movidos", n)
			}
			return nil
		}}
}
