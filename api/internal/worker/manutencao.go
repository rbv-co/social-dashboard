package worker

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ConferirRobos porta public.conferir_robos (pg_cron 2-59/5). A função copiava a resposta do pg_net
// para robos_execucoes; o worker já grava cada execução conferida (conferido_em = now()), então sobra
// o resto dela: fechar linha antiga sem conferência (as do Supabase até o corte) com o MESMO texto de
// produção (sem acento, como está em pg_proc) e apagar o que passou de 60 dias.
func ConferirRobos(p *pgxpool.Pool) Tarefa {
	return Tarefa{Nome: "conferir-robos", Agenda: "2-59/5 * * * *", Limite: time.Minute, Executar: func(ctx context.Context) error {
		if _, err := p.Exec(ctx, `update robos_execucoes
			   set conferido_em = now(), resposta = 'a resposta foi apagada pelo pg_net antes da conferencia'
			 where conferido_em is null and disparado_em < now() - interval '6 hours'`); err != nil {
			return err
		}
		_, err := p.Exec(ctx, `delete from robos_execucoes where disparado_em < now() - interval '60 days'`)
		return err
	}}
}

// FaxinaDaAPI (tarefa nova, faxina-da-api) apaga o que as tabelas da própria API acumulam:
// sessões vencidas (NOTAS-DA-IMPLANTACAO, Plano 1), marcas de webhook com mais de 30 dias (reentrega
// do core vai até ~5 h; pendência do Plano 3) e o livro de envios com mais de 45 dias. Atenção: só
// as chaves das janelas que se repetem (push e relatório do dia/hora) levam a data. Chaves SEM data
// (ex.: decisão de reserva por pedido e situação, peça do conteudo-hora-h) também somem aos 45 dias:
// se o mesmo evento puder chegar de novo depois disso, a tarefa que usa a chave volta a enviar.
func FaxinaDaAPI(p *pgxpool.Pool) Tarefa {
	return Tarefa{Nome: "faxina-da-api", Agenda: "41 5 * * *", Limite: 2 * time.Minute, Executar: func(ctx context.Context) error {
		for _, sql := range []string{
			`delete from sessoes where expira_em < now()`,
			`delete from webhooks_recebidos where recebido_em < now() - interval '30 days'`,
			`delete from envios_feitos where feito_em < now() - interval '45 days'`,
		} {
			if _, err := p.Exec(ctx, sql); err != nil {
				return err
			}
		}
		return nil
	}}
}
