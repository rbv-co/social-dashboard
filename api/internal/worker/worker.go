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
//
// A trava impede SOBREPOSIÇÃO (duas execuções ao mesmo tempo, ex.: deploy com dois workers); ela NÃO
// impede uma segunda execução da mesma janela depois que a primeira acabou (cron + `api worker
// rodar`, reentrega). "Enviar uma vez só" é garantido pelo livro envios_feitos (banco.ReservarEnvio),
// em CADA tarefa que manda algo para fora: uma tarefa nova que envia sem reservar quebra o Review
// Focus 1 do Plano 4, mesmo com a trava.
package worker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"runtime/debug"
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
	pool *pgxpool.Pool
	cron *cron.Cron

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
	return &Agendador{pool: p, cron: cron.New(cron.WithLocation(time.UTC)),
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
	_, err := a.cron.AddFunc(t.Agenda, func() { a.disparar(t) })
	return err
}

// disparar é o que a agenda faz a cada hora marcada. Confere Desligada de novo (e não só em
// Registrar): se a lista for definida depois do registro, a tarefa desligada não pode rodar sozinha
// (no ensaio, seria push de verdade). `api worker rodar --forcar` passa por Rodar, não por aqui.
func (a *Agendador) disparar(t Tarefa) {
	if a.Desligada(t.Nome) {
		slog.Info("tarefa desligada: agenda ignorada", "nome", t.Nome)
		return
	}
	if _, err := a.Rodar(a.ctxTarefas, t); err != nil {
		slog.Error("tarefa falhou", "nome", t.Nome, "erro", err.Error()) // já sem segredos (Rodar)
	}
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
// O log leva a pilha (sem o valor do pânico, que pode trazer segredo); o valor vai no erro, que
// Rodar limpa.
func executar(ctx context.Context, t Tarefa) (err error) {
	defer func() {
		if r := recover(); r != nil {
			slog.Error("pânico na tarefa", "nome", t.Nome, "pilha", string(debug.Stack()))
			err = fmt.Errorf("pânico: %v", r)
		}
	}()
	return t.Executar(ctx)
}

// erroLimpo é o erro que Rodar devolve: Error() já sem os segredos do Agendador, de modo que
// nenhum chamador (log, CLI, teste) os vaze. Unwrap guarda o original para errors.Is/As.
type erroLimpo struct {
	msg string
	err error
}

func (e *erroLimpo) Error() string { return e.msg }
func (e *erroLimpo) Unwrap() error { return e.err }

func (a *Agendador) limpo(err error) error {
	if err == nil {
		return nil
	}
	return &erroLimpo{msg: Limpar(err.Error(), a.Segredos), err: err}
}

// Rodar executa UMA vez sob a trava. executou=false (sem erro) = outra execução segura a trava
// (fica no log e em Metrica.Puladas, nunca em robos_execucoes). err = o erro da tarefa (já gravado
// em robos_execucoes) ou da infraestrutura (conexão, gravação), com os segredos já mascarados.
//
// A trava só evita SOBREPOSIÇÃO; uma execução repetida da mesma janela depois que esta acaba roda de
// novo. Quem envia algo para fora reserva a chave no livro (banco.ReservarEnvio) antes de enviar.
func (a *Agendador) Rodar(ctx context.Context, t Tarefa) (bool, error) {
	if err := validar(t); err != nil {
		return false, err
	}
	// Conexão PRÓPRIA para a trava (fora do pool): a tarefa usa o pool à vontade e várias tarefas ao
	// mesmo tempo nunca esgotam o pool segurando travas.
	conn, err := pgx.ConnectConfig(ctx, a.pool.Config().ConnConfig.Copy())
	if err != nil {
		return false, a.limpo(err)
	}
	defer func() {
		c, cancela := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancela()
		conn.Close(c) // fim da sessão: o Postgres solta qualquer trava que ainda esteja nela
	}()
	var ganhou bool
	if err := conn.QueryRow(ctx, `select pg_try_advisory_lock($1::int, hashtext($2::text))`, EspacoDaTrava, t.trava()).Scan(&ganhou); err != nil {
		return false, a.limpo(err)
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
	inicio := time.Now()
	erro := executar(ctxT, t)
	a.contar(t.Nome, func(m *Metrica) {
		m.Execucoes++
		m.UltimoInicio, m.UltimaDuracaoMs, m.UltimoErro = inicio, time.Since(inicio).Milliseconds(), ""
		if erro != nil {
			m.Falhas++
			m.UltimoErro = cortar(Limpar(erro.Error(), a.Segredos), 200)
		}
	})
	if t.RegistroProprio && erro == nil {
		return true, nil
	}
	// Contexto novo: o da tarefa pode ter vencido. Grava na conexão da trava (o pool pode estar cheio);
	// se ela caiu no meio da tarefa, grava pelo pool, para a linha existir de qualquer jeito.
	c, cancelaC := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancelaC()
	gerr := Gravar(c, conn, t.Nome, inicio, erro, a.Segredos)
	if gerr != nil {
		slog.Warn("conexão da trava perdida durante a tarefa; gravando a linha pelo pool", "nome", t.Nome, "erro", Limpar(gerr.Error(), a.Segredos))
		gerr = Gravar(c, a.pool, t.Nome, inicio, erro, a.Segredos)
	}
	return true, a.limpo(errors.Join(erro, gerr))
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

// Limpar troca cada segredo (com 8 caracteres ou mais) por ***, o mais longo primeiro (um segredo
// que é prefixo de outro não pode deixar a cauda do maior à mostra). É a ÚLTIMA barreira: quem monta
// o erro já não deve pôr segredo nele. Segredo com menos de 8 caracteres NÃO é mascarado (trocaria
// texto comum); o `api worker` avisa no boot.
func Limpar(s string, segredos []string) string {
	segredos = slices.Clone(segredos)
	slices.SortFunc(segredos, func(x, y string) int { return len(y) - len(x) })
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

// ValidarDesligadas confere os nomes de WORKER_TAREFAS_DESLIGADAS: "*" ou nome de tarefa registrada.
// Um erro de digitação manteria ligado o que se quis desligar (ex.: push real no ensaio), então o
// worker recusa subir. Quem de fato não agenda a tarefa desligada é o Agendador (Desligadas).
func ValidarDesligadas(ts []Tarefa, desligadas []string) error {
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
		return fmt.Errorf("WORKER_TAREFAS_DESLIGADAS: nomes desconhecidos %v; válidos: * ou %v", desconhecidos, validos)
	}
	return nil
}

// Filtrar devolve as tarefas que não estão desligadas ("*" desliga todas), depois de validar os
// nomes (ValidarDesligadas). O worker não a usa para agendar (isso é do Agendador); fica para quem
// precisa da lista filtrada.
func Filtrar(ts []Tarefa, desligadas []string) ([]Tarefa, error) {
	if err := ValidarDesligadas(ts, desligadas); err != nil {
		return nil, err
	}
	var out []Tarefa
	for _, t := range ts {
		if !slices.Contains(desligadas, "*") && !slices.Contains(desligadas, t.Nome) {
			out = append(out, t)
		}
	}
	return out, nil
}
