// Package worker roda tarefas agendadas (substitui o pg_cron + edges de cron).
package worker

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/robfig/cron/v3"
)

type Tarefa struct {
	Nome     string
	Agenda   string // cron de 5 campos, em UTC (como o pg_cron)
	Limite   time.Duration
	Executar func(ctx context.Context) error
}

type Agendador struct {
	pool  *pgxpool.Pool
	cron  *cron.Cron
	agora func() time.Time
}

func Novo(p *pgxpool.Pool) *Agendador {
	return &Agendador{pool: p, cron: cron.New(cron.WithLocation(time.UTC)), agora: time.Now}
}

func (a *Agendador) Registrar(t Tarefa) error {
	_, err := a.cron.AddFunc(t.Agenda, func() {
		if _, err := a.Rodar(context.Background(), t); err != nil {
			slog.Error("tarefa", "nome", t.Nome, "erro", err)
		}
	})
	return err
}

// executar roda a tarefa convertendo pânico em erro, para que uma tarefa
// defeituosa não derrube o processo do worker.
func executar(ctx context.Context, t Tarefa) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("pânico: %v", r)
		}
	}()
	return t.Executar(ctx)
}

// Rodar executa uma vez sob pg_try_advisory_lock: se outra instância já roda a
// mesma tarefa, devolve false sem executar. Grava o resultado em robos_execucoes.
func (a *Agendador) Rodar(ctx context.Context, t Tarefa) (bool, error) {
	conn, err := a.pool.Acquire(ctx)
	if err != nil {
		return false, err
	}
	defer conn.Release()
	var ganhou bool
	if err := conn.QueryRow(ctx, `select pg_try_advisory_lock(hashtext($1))`, t.Nome).Scan(&ganhou); err != nil {
		return false, err
	}
	if !ganhou {
		return false, nil
	}
	// Mesma conexão do lock (advisory lock é por sessão); roda antes do Release.
	defer conn.Exec(context.Background(), `select pg_advisory_unlock(hashtext($1))`, t.Nome)

	ctxT, cancela := context.WithTimeout(ctx, t.Limite)
	defer cancela()
	inicio := a.agora()
	erro := executar(ctxT, t)
	ok, resp, status := erro == nil, "ok", 200
	if erro != nil {
		resp, status = erro.Error(), 500
	}
	// context.Background(): o ctx da tarefa pode ter expirado e o resultado precisa ser gravado.
	_, err = a.pool.Exec(context.Background(),
		`insert into robos_execucoes (robo, disparado_em, status_code, ok, resposta) values ($1, $2, $3, $4, $5)`,
		t.Nome, inicio, status, ok, resp)
	return true, err
}

func (a *Agendador) Iniciar(ctx context.Context) {
	a.cron.Start()
	<-ctx.Done()
	<-a.cron.Stop().Done() // espera as tarefas em andamento terminarem
}
