// Package worker roda tarefas agendadas (substitui o pg_cron + edges de cron).
package worker

import (
	"context"
	"fmt"
	"log/slog"
	"slices"
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

func validar(t Tarefa) error {
	if t.Limite <= 0 {
		return fmt.Errorf("tarefa %q: Limite deve ser positivo", t.Nome)
	}
	if t.Executar == nil {
		return fmt.Errorf("tarefa %q: Executar não pode ser nil", t.Nome)
	}
	return nil
}

func (a *Agendador) Registrar(t Tarefa) error {
	if err := validar(t); err != nil {
		return err
	}
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
	if err := validar(t); err != nil {
		return false, err
	}
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
	// Se o unlock falhar, a conexão é fechada: o Postgres derruba a sessão e a
	// trava com ela (senão ficaria presa numa conexão do pool, reentrante, e
	// nenhuma outra instância conseguiria rodar a tarefa).
	defer func() {
		c, cancela := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancela()
		var soltou bool
		if err := conn.QueryRow(c, `select pg_advisory_unlock(hashtext($1))`, t.Nome).Scan(&soltou); err != nil || !soltou {
			slog.Error("não consegui soltar a trava; fechando a conexão", "nome", t.Nome, "soltou", soltou, "erro", err)
			conn.Conn().Close(c)
		}
	}()

	ctxT, cancela := context.WithTimeout(ctx, t.Limite)
	defer cancela()
	inicio := a.agora()
	erro := executar(ctxT, t)
	ok, resp, status := erro == nil, "ok", 200
	if erro != nil {
		resp, status = erro.Error(), 500
	}
	// Grava na conexão que já está em mãos (pedir outra ao pool pode travar com
	// o pool esgotado). Contexto novo: o da tarefa pode ter expirado.
	c, cancelaC := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelaC()
	_, err = conn.Exec(c,
		`insert into robos_execucoes (robo, disparado_em, status_code, ok, resposta) values ($1, $2, $3, $4, $5)`,
		t.Nome, inicio, status, ok, resp)
	return true, err
}

func (a *Agendador) Iniciar(ctx context.Context) {
	a.cron.Start()
	<-ctx.Done()
	<-a.cron.Stop().Done() // espera as tarefas em andamento terminarem
}

// Filtrar tira as tarefas desligadas ("*" desliga todas), para o ensaio não disparar efeitos reais.
// Nome que não é "*" nem de tarefa registrada é erro (um erro de digitação manteria ligado o que
// se quis desligar, ex.: push real no ensaio).
func Filtrar(ts []Tarefa, desligadas []string) ([]Tarefa, error) {
	validos := []string{}
	for _, t := range ts {
		validos = append(validos, t.Nome)
	}
	var desconhecidos []string
	for _, d := range desligadas {
		if d != "*" && !slices.Contains(validos, d) {
			desconhecidos = append(desconhecidos, d)
		}
	}
	if len(desconhecidos) > 0 {
		return nil, fmt.Errorf("WORKER_TAREFAS_DESLIGADAS: nomes desconhecidos %v; válidos: * ou %v", desconhecidos, validos)
	}
	var out []Tarefa
	for _, t := range ts {
		if !slices.Contains(desligadas, "*") && !slices.Contains(desligadas, t.Nome) {
			out = append(out, t)
		}
	}
	return out, nil
}
