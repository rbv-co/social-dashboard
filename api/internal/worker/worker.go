// Package worker roda as tarefas agendadas (substitui o pg_cron e as edges de cron).
//
// Regras (spec §8.1):
//   - agenda em UTC, como o pg_cron; execução perdida (worker fora do ar na hora) NÃO é recuperada:
//     a próxima é a da agenda seguinte (o robfig/cron calcula a partir de agora);
//   - cada execução roda sob pg_try_advisory_lock de DUAS chaves (EspacoDaTrava, hashtext(trava)),
//     numa conexão própria, fora do pool. O espaço de duas chaves (objsubid = 2 em pg_locks) é
//     separado do de UMA chave bigint que as 26 funções SQL de produção usam
//     (pg_advisory_xact_lock(hashtext(...)), objsubid = 1): nenhuma trava do worker colide com elas;
//   - o resultado vai para robos_execucoes com o nome de PRODUÇÃO (a tela "saúde dos robôs" casa
//     robos_esperados por LIKE '<robo>%') e conferido_em = now().
package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/robfig/cron/v3"
)

// EspacoDaTrava é a 1ª chave do advisory lock de toda tarefa ("WRKR" em ASCII). Nenhuma função SQL
// pode usar pg_advisory_*(int, int) com esta 1ª chave.
const EspacoDaTrava int32 = 0x57524B52

type Tarefa struct {
	Nome   string        // nome de PRODUÇÃO em robos_execucoes
	Agenda string        // cron de 5 campos, em UTC (como o pg_cron)
	Limite time.Duration // prazo de UMA execução; vencido, o contexto da tarefa é cancelado
	// Trava: chave do advisory lock; vazio = Nome. Tarefas que gravam as mesmas linhas dividem a
	// trava (ex.: meta-hora e meta-hora-retentativa-00h).
	Trava string
	// RegistroProprio: a tarefa grava as próprias linhas em robos_execucoes (ex.: uma por conta). O
	// agendador só grava a linha com Nome quando a execução inteira falha (erro, prazo ou pânico).
	RegistroProprio bool
	Executar        func(ctx context.Context) error
}

func (t Tarefa) trava() string {
	if t.Trava != "" {
		return t.Trava
	}
	return t.Nome
}

// Metrica é o que /metricas mostra de cada tarefa (desde que o processo subiu).
type Metrica struct {
	Execucoes       int64     `json:"execucoes"`
	Falhas          int64     `json:"falhas"`
	Puladas         int64     `json:"puladas"` // outra execução segurava a trava
	UltimoInicio    time.Time `json:"ultimo_inicio,omitzero"`
	UltimaDuracaoMs int64     `json:"ultima_duracao_ms"`
	UltimoErro      string    `json:"ultimo_erro,omitempty"`
}

type Agendador struct {
	pool  *pgxpool.Pool
	cron  *cron.Cron
	agora func() time.Time

	Desligadas []string      // WORKER_TAREFAS_DESLIGADAS; "*" desliga todas
	Segredos   []string      // valores que nunca saem em robos_execucoes nem no log
	Graca      time.Duration // desligamento: quanto espera as tarefas em andamento; 0 = 30 s

	ctxTarefas     context.Context
	cancelaTarefas context.CancelFunc
	rodando        atomic.Bool

	mu       sync.Mutex
	tarefas  map[string]Tarefa
	metricas map[string]*Metrica
}

func Novo(p *pgxpool.Pool) *Agendador {
	ctx, cancela := context.WithCancel(context.Background())
	return &Agendador{pool: p, cron: cron.New(cron.WithLocation(time.UTC)), agora: time.Now,
		ctxTarefas: ctx, cancelaTarefas: cancela, tarefas: map[string]Tarefa{}, metricas: map[string]*Metrica{}}
}

func validar(t Tarefa) error {
	if t.Nome == "" {
		return errors.New("tarefa sem nome")
	}
	if t.Limite <= 0 {
		return fmt.Errorf("tarefa %q: Limite deve ser positivo", t.Nome)
	}
	if t.Executar == nil {
		return fmt.Errorf("tarefa %q: Executar não pode ser nil", t.Nome)
	}
	return nil
}

// Desligada: o nome está em WORKER_TAREFAS_DESLIGADAS (ou a lista tem "*").
func (a *Agendador) Desligada(nome string) bool {
	return slices.Contains(a.Desligadas, "*") || slices.Contains(a.Desligadas, nome)
}

// Registrar guarda a tarefa (para `api worker rodar`/`listar`) e a agenda, a menos que esteja desligada.
func (a *Agendador) Registrar(t Tarefa) error {
	if err := validar(t); err != nil {
		return err
	}
	if _, err := cron.ParseStandard(t.Agenda); err != nil {
		return fmt.Errorf("tarefa %q: agenda %q: %w", t.Nome, t.Agenda, err)
	}
	a.mu.Lock()
	if _, dup := a.tarefas[t.Nome]; dup {
		a.mu.Unlock()
		return fmt.Errorf("tarefa %q registrada duas vezes", t.Nome)
	}
	a.tarefas[t.Nome] = t
	a.metricas[t.Nome] = &Metrica{}
	a.mu.Unlock()
	if a.Desligada(t.Nome) {
		slog.Info("tarefa desligada por WORKER_TAREFAS_DESLIGADAS", "nome", t.Nome)
		return nil
	}
	_, err := a.cron.AddFunc(t.Agenda, func() {
		if _, err := a.Rodar(a.ctxTarefas, t); err != nil {
			slog.Error("tarefa falhou", "nome", t.Nome, "erro", Limpar(err.Error(), a.Segredos))
		}
	})
	return err
}

// Buscar devolve a tarefa registrada (ligada ou desligada).
func (a *Agendador) Buscar(nome string) (Tarefa, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	t, ok := a.tarefas[nome]
	return t, ok
}

// Tarefas devolve as registradas, em ordem de nome.
func (a *Agendador) Tarefas() []Tarefa {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]Tarefa, 0, len(a.tarefas))
	for _, t := range a.tarefas {
		out = append(out, t)
	}
	slices.SortFunc(out, func(x, y Tarefa) int { return strings.Compare(x.Nome, y.Nome) })
	return out
}

func (a *Agendador) contar(nome string, f func(*Metrica)) {
	a.mu.Lock()
	defer a.mu.Unlock()
	m := a.metricas[nome]
	if m == nil {
		m = &Metrica{}
		a.metricas[nome] = m
	}
	f(m)
}

// executar roda a tarefa convertendo pânico em erro: uma tarefa defeituosa não derruba o worker.
func executar(ctx context.Context, t Tarefa) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = fmt.Errorf("pânico: %v", r)
		}
	}()
	return t.Executar(ctx)
}

// Rodar executa UMA vez sob a trava. executou=false (sem erro) = outra execução segura a trava
// (fica no log e em Metrica.Puladas, nunca em robos_execucoes). err = o erro da tarefa (já gravado
// em robos_execucoes) ou da infraestrutura (conexão, gravação).
func (a *Agendador) Rodar(ctx context.Context, t Tarefa) (bool, error) {
	if err := validar(t); err != nil {
		return false, err
	}
	// Conexão PRÓPRIA para a trava (fora do pool): a tarefa usa o pool à vontade e várias tarefas ao
	// mesmo tempo nunca esgotam o pool segurando travas.
	conn, err := pgx.ConnectConfig(ctx, a.pool.Config().ConnConfig.Copy())
	if err != nil {
		return false, err
	}
	defer func() {
		c, cancela := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancela()
		conn.Close(c) // fim da sessão: o Postgres solta qualquer trava que ainda esteja nela
	}()
	var ganhou bool
	if err := conn.QueryRow(ctx, `select pg_try_advisory_lock($1::int, hashtext($2::text))`, EspacoDaTrava, t.trava()).Scan(&ganhou); err != nil {
		return false, err
	}
	if ganhou {
		// Solta EXPLICITAMENTE antes de fechar: o fim da sessão é assíncrono no servidor, e a próxima
		// execução (ou outra instância) poderia achar a trava ainda presa por um instante.
		defer func() {
			c, cancela := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancela()
			if _, err := conn.Exec(c, `select pg_advisory_unlock($1::int, hashtext($2::text))`, EspacoDaTrava, t.trava()); err != nil {
				slog.Error("não consegui soltar a trava; a sessão fecha e o Postgres solta", "nome", t.Nome, "erro", err)
			}
		}()
	}
	if !ganhou {
		a.contar(t.Nome, func(m *Metrica) { m.Puladas++ })
		slog.Info("tarefa pulada: outra execução segura a trava", "nome", t.Nome, "trava", t.trava())
		return false, nil
	}

	ctxT, cancela := context.WithTimeout(ctx, t.Limite)
	defer cancela()
	inicio, relogio := a.agora(), time.Now()
	erro := executar(ctxT, t)
	a.contar(t.Nome, func(m *Metrica) {
		m.Execucoes++
		m.UltimoInicio, m.UltimaDuracaoMs, m.UltimoErro = inicio, time.Since(relogio).Milliseconds(), ""
		if erro != nil {
			m.Falhas++
			m.UltimoErro = cortar(Limpar(erro.Error(), a.Segredos), 200)
		}
	})
	if t.RegistroProprio && erro == nil {
		return true, nil
	}
	// Contexto novo: o da tarefa pode ter vencido. Grava na conexão da trava (o pool pode estar cheio).
	c, cancelaC := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelaC()
	return true, errors.Join(erro, Gravar(c, conn, t.Nome, inicio, erro, a.Segredos))
}

// Gravar grava UMA linha em robos_execucoes. status_code 200/500 e ok como o conferir_robos fazia
// (ok = status 2xx); resposta "ok" ou o erro sem segredos, com até 500 caracteres (o left(...,500)
// de conferir_robos); conferido_em = now(), para conferir-robos nunca reescrever a linha.
func Gravar(ctx context.Context, db banco.Executor, robo string, inicio time.Time, erro error, segredos []string) error {
	ok, resp, status := erro == nil, "ok", 200
	if erro != nil {
		resp, status = Limpar(erro.Error(), segredos), 500
	}
	_, err := db.Exec(ctx, `insert into robos_execucoes (robo, disparado_em, status_code, ok, resposta, conferido_em)
		values ($1::text, $2::timestamptz, $3::int, $4::boolean, $5::text, now())`, robo, inicio, status, ok, cortar(resp, 500))
	return err
}

// Gravador é o Gravar com o pool e os segredos do agendador: o que as tarefas com RegistroProprio
// recebem (ex.: uma linha por conta em coletar-dados).
func (a *Agendador) Gravador() func(ctx context.Context, robo string, inicio time.Time, erro error) error {
	return func(ctx context.Context, robo string, inicio time.Time, erro error) error {
		return Gravar(ctx, a.pool, robo, inicio, erro, a.Segredos)
	}
}

// Limpar troca cada segredo (com 8 caracteres ou mais) por ***. É a ÚLTIMA barreira: quem monta o
// erro já não deve pôr segredo nele.
func Limpar(s string, segredos []string) string {
	for _, seg := range segredos {
		if len(seg) >= 8 {
			s = strings.ReplaceAll(s, seg, "***")
		}
	}
	return s
}

func cortar(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}

// Iniciar agenda tudo e bloqueia até ctx acabar. No desligamento: nada novo começa; as tarefas em
// andamento têm Graca para terminar; depois o contexto delas é cancelado (a linha de erro ainda é
// gravada) e Iniciar espera mais 15 s no máximo.
func (a *Agendador) Iniciar(ctx context.Context) {
	a.rodando.Store(true)
	a.cron.Start()
	<-ctx.Done()
	a.rodando.Store(false)
	parado := a.cron.Stop()
	graca := a.Graca
	if graca <= 0 {
		graca = 30 * time.Second
	}
	select {
	case <-parado.Done():
		return
	case <-time.After(graca):
	}
	slog.Warn("desligando: tarefas ainda em andamento; cancelando", "graca", graca)
	a.cancelaTarefas()
	select {
	case <-parado.Done():
	case <-time.After(15 * time.Second):
		slog.Error("desligando: tarefas não terminaram 15 s depois de canceladas")
	}
}

// Saude: GET /saude (200 enquanto agenda, 503 parado) e GET /metricas (JSON por tarefa). Só leitura:
// não há rota que execute tarefa (execução manual é `api worker rodar`).
func (a *Agendador) Saude() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /saude", func(w http.ResponseWriter, _ *http.Request) {
		if !a.rodando.Load() {
			http.Error(w, "parado", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})
	m.HandleFunc("GET /metricas", func(w http.ResponseWriter, _ *http.Request) {
		type item struct {
			Agenda    string `json:"agenda"`
			Desligada bool   `json:"desligada"`
			Metrica
		}
		a.mu.Lock()
		out := map[string]item{}
		for nome, t := range a.tarefas {
			out[nome] = item{t.Agenda, a.Desligada(nome), *a.metricas[nome]}
		}
		a.mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(out)
	})
	return m
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
