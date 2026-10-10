package main

import (
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/comercial"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// tarefas monta TODAS as tarefas de produção do worker, com o nome que robos_execucoes já usa (a
// tela de saúde casa robos_esperados por prefixo) e a agenda de cron.job (UTC). A tabela completa
// está no Plano 4 e é conferida por TestTarefasDeProducao. Só monta: nada aqui fala com rede ou banco.
func tarefas(p *pgxpool.Pool, cfg config.Config, ag *worker.Agendador) []worker.Tarefa {
	cli := core.Novo(cfg.CoreURL, cfg.CoreToken)
	var ts []worker.Tarefa
	// HTTP nil: o push herda o cliente seguro (Dialer.Control recusa faixas proibidas).
	pv := &comercial.PushVendas{Pool: p, Core: cli, VAPID: vapid(cfg)}
	ts = append(ts, pv.Tarefas()...)
	return ts
}

func vapid(cfg config.Config) webpush.VAPID {
	return webpush.VAPID{Publica: cfg.VAPIDPublica, Privada: cfg.VAPIDPrivada, Assunto: cfg.VAPIDAssunto}
}
