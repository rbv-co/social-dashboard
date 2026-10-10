package main

import (
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/comercial"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/fabrica"
	"github.com/rbv-co/social-dashboard/api/internal/mensagens"
	"github.com/rbv-co/social-dashboard/api/internal/meta"
	"github.com/rbv-co/social-dashboard/api/internal/vessel"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// tarefas monta TODAS as tarefas de produção do worker, com o nome que robos_execucoes já usa (a
// tela de saúde casa robos_esperados por prefixo) e a agenda de cron.job (UTC). A tabela completa
// está no Plano 4 e é conferida por TestTarefasDeProducao. Só monta: nada aqui fala com rede ou banco.
func tarefas(p *pgxpool.Pool, cfg config.Config, ag *worker.Agendador) []worker.Tarefa {
	cli := clienteDoCore(cfg)
	var ts []worker.Tarefa
	// HTTP nil: o push herda o cliente seguro (Dialer.Control recusa faixas proibidas).
	pv := &comercial.PushVendas{Pool: p, Core: cli, VAPID: vapid(cfg)}
	ts = append(ts, pv.Tarefas()...)
	ts = append(ts, worker.ConferirRobos(p), worker.FaxinaDaAPI(p), mensagens.MoverAbandonados(p),
		(&vessel.RD{Pool: p, Token: cfg.RDStationToken}).Tarefa(),
		(&fabrica.Purga{Pool: p, Dir: cfg.ArquivosDir}).Tarefa())
	ts = append(ts, (&meta.PushSaldo{Pool: p, Core: cli, VAPID: vapid(cfg)}).Tarefa())
	return ts
}

// clienteDoCore é o cliente do worker: anda a 600 ms por chamada à Meta (~100/min), abaixo do teto de
// 120/min por consumidor do core. A API (rotas ao vivo) usa outro cliente, sem ritmo.
func clienteDoCore(cfg config.Config) *core.Cliente {
	cli := core.Novo(cfg.CoreURL, cfg.CoreToken)
	cli.RitmoMeta = 600 * time.Millisecond
	return cli
}

func vapid(cfg config.Config) webpush.VAPID {
	return webpush.VAPID{Publica: cfg.VAPIDPublica, Privada: cfg.VAPIDPrivada, Assunto: cfg.VAPIDAssunto}
}
