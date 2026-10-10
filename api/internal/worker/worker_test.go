package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func nada(context.Context) error { return nil }

type bufferSeguro struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *bufferSeguro) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}

func (b *bufferSeguro) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

// capturarLog troca o slog padrão por um buffer até o fim do teste.
func capturarLog(t *testing.T) *bufferSeguro {
	t.Helper()
	b := &bufferSeguro{}
	antigo := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(b, nil)))
	t.Cleanup(func() { slog.SetDefault(antigo) })
	return b
}

func TestAgendasDeProducaoSaoValidas(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	for i, ag := range []string{
		"* * * * *", "0 10 * * *", "0 15 * * *", "0 21 * * *", "59 2 * * *", "5 * * * *", "30 3 * * *",
		"2-59/5 * * * *", "*/30 * * * *", "*/5 * * * *", "30 10 * * 1-5", "10 * * * *", "17 4 * * *",
		"30 2 * * *", "0 11 * * *", "0 1 * * *", "41 5 * * *",
	} {
		if err := a.Registrar(Tarefa{Nome: fmt.Sprintf("t%d", i), Agenda: ag, Limite: time.Second, Executar: nada}); err != nil {
			t.Errorf("agenda %q: %v", ag, err)
		}
	}
	if err := a.Registrar(Tarefa{Nome: "x", Agenda: "isto não é cron", Limite: time.Second, Executar: nada}); err == nil {
		t.Error("agenda inválida deveria falhar")
	}
	if err := a.Registrar(Tarefa{Nome: "t0", Agenda: "* * * * *", Limite: time.Second, Executar: nada}); err == nil {
		t.Error("nome repetido deveria falhar")
	}
}

func linha(t *testing.T, p *pgxpool.Pool, robo string) (ok bool, resp string, n int) {
	t.Helper()
	p.QueryRow(context.Background(), `select count(*) from robos_execucoes where robo = $1`, robo).Scan(&n)
	p.QueryRow(context.Background(), `select coalesce(ok, false), coalesce(resposta, '') from robos_execucoes where robo = $1 order by id desc limit 1`, robo).Scan(&ok, &resp)
	return
}

// semTrava confere em pg_locks (visão do cluster inteiro) que a trava da tarefa não sobrou.
// pg_try_advisory_lock(int, int) guarda a 1ª chave em classid, a 2ª em objid e objsubid = 2.
func semTrava(t *testing.T, p *pgxpool.Pool, trava string) {
	t.Helper()
	var n int
	if err := p.QueryRow(context.Background(), `select count(*) from pg_locks
		where locktype = 'advisory' and objsubid = 2 and granted
		  and classid::bigint = $1::bigint and objid::bigint = (hashtext($2::text)::bigint & 4294967295)`,
		int64(EspacoDaTrava), trava).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Fatalf("trava de %q vazou (%d linhas em pg_locks)", trava, n)
	}
}

func TestRodarRegistraSucessoEErroComConferidoEm(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	ctx := context.Background()
	if ex, err := a.Rodar(ctx, Tarefa{Nome: "boa", Limite: time.Second, Executar: nada}); !ex || err != nil {
		t.Fatalf("ex=%v err=%v", ex, err)
	}
	if ok, resp, n := linha(t, p, "boa"); !ok || resp != "ok" || n != 1 {
		t.Fatalf("ok=%v resp=%q n=%d", ok, resp, n)
	}
	ex, err := a.Rodar(ctx, Tarefa{Nome: "ruim", Limite: time.Second, Executar: func(context.Context) error { return errors.New("bling fora") }})
	if !ex || err == nil || err.Error() != "bling fora" {
		t.Fatalf("o erro da tarefa volta para quem chamou: ex=%v err=%v", ex, err)
	}
	if ok, resp, _ := linha(t, p, "ruim"); ok || resp != "bling fora" {
		t.Fatalf("ok=%v resp=%q", ok, resp)
	}
	var semConferir, status500 int
	p.QueryRow(ctx, `select count(*) filter (where conferido_em is null), count(*) filter (where status_code = 500) from robos_execucoes`).Scan(&semConferir, &status500)
	if semConferir != 0 || status500 != 1 {
		t.Fatalf("toda linha nasce conferida (conferir-robos não reescreve): sem conferido_em=%d, status 500=%d", semConferir, status500)
	}
	semTrava(t, p, "boa")
	semTrava(t, p, "ruim")
}

func TestRespostaSemSegredoECortadaEm500(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Segredos = []string{"segredo-do-chatwoot-123", "curto"}
	longo := strings.Repeat("é", 600)
	a.Rodar(context.Background(), Tarefa{Nome: "vaza", Limite: time.Second, Executar: func(context.Context) error {
		return fmt.Errorf("POST https://x/token/segredo-do-chatwoot-123/send curto %s", longo)
	}})
	_, resp, _ := linha(t, p, "vaza")
	if strings.Contains(resp, "segredo-do-chatwoot-123") || !strings.Contains(resp, "/token/***/send curto") {
		t.Fatalf("segredo na resposta (ou o curto foi trocado): %q", resp)
	}
	if n := len([]rune(resp)); n != 500 {
		t.Fatalf("resposta com %d caracteres, esperava 500", n)
	}
}

func TestLimiteDeTempoCancelaATarefa(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Rodar(context.Background(), Tarefa{Nome: "lenta", Limite: 50 * time.Millisecond,
		Executar: func(ctx context.Context) error { <-ctx.Done(); return ctx.Err() }})
	if ok, resp, _ := linha(t, p, "lenta"); ok || !strings.Contains(resp, "deadline") {
		t.Fatalf("ok=%v resp=%q", ok, resp)
	}
	semTrava(t, p, "lenta")
}

func TestDuasInstanciasSoUmaExecutaEAPuladaNaoGravaLinha(t *testing.T) {
	p := testebanco.Novo(t)
	a, b := Novo(p), Novo(p) // dois processos de worker no mesmo banco (deploy sobreposto)
	preso, liberar := make(chan struct{}), make(chan struct{})
	tarefa := Tarefa{Nome: "unica", Limite: 5 * time.Second, Executar: func(context.Context) error {
		close(preso)
		<-liberar
		return nil
	}}
	feito := make(chan bool)
	go func() { ex, _ := a.Rodar(context.Background(), tarefa); feito <- ex }()
	select {
	case <-preso:
	case <-time.After(5 * time.Second):
		t.Fatal("a primeira execução não começou")
	}
	ex, err := b.Rodar(context.Background(), Tarefa{Nome: "unica", Limite: time.Second, Executar: func(context.Context) error { t.Error("não podia executar"); return nil }})
	if ex || err != nil {
		t.Fatalf("segunda: ex=%v err=%v", ex, err)
	}
	close(liberar)
	if !<-feito {
		t.Fatal("a primeira deveria ter executado")
	}
	if _, _, n := linha(t, p, "unica"); n != 1 {
		t.Fatalf("pulada não grava linha: esperava 1, achei %d", n)
	}
	if b.metricas["unica"].Puladas != 1 {
		t.Fatalf("pulada não contou: %+v", b.metricas["unica"])
	}
}

func TestTravaCompartilhadaEntreTarefas(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	preso, liberar, feito := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		defer close(feito)
		a.Rodar(context.Background(), Tarefa{Nome: "meta-hora", Trava: "coletar-dados-hora", Limite: 5 * time.Second,
			Executar: func(context.Context) error { close(preso); <-liberar; return nil }})
	}()
	<-preso
	ex, _ := a.Rodar(context.Background(), Tarefa{Nome: "meta-hora-retentativa-00h", Trava: "coletar-dados-hora", Limite: time.Second, Executar: nada})
	close(liberar)
	<-feito
	if ex {
		t.Fatal("tarefas com a mesma Trava não podem rodar juntas")
	}
	// A linha de robos_execucoes leva o nome da TAREFA (o da tela de saúde), nunca o da trava.
	if ok, _, n := linha(t, p, "meta-hora"); !ok || n != 1 {
		t.Fatalf("linha com o nome da tarefa: ok=%v n=%d", ok, n)
	}
	if _, _, n := linha(t, p, "coletar-dados-hora"); n != 0 {
		t.Fatalf("o nome da trava não pode virar linha: %d", n)
	}
	if _, _, n := linha(t, p, "meta-hora-retentativa-00h"); n != 0 {
		t.Fatalf("a pulada não grava linha: %d", n)
	}
}

func TestEspacoDeDuasChavesNaoColideComAsFuncoesSQL(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	ctx := context.Background()
	// Uma função de produção segura a trava de UMA chave com o mesmo texto: o worker roda mesmo assim.
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('pegar_da_fila'))`); err != nil {
		t.Fatal(err)
	}
	if ex, err := a.Rodar(ctx, Tarefa{Nome: "pegar_da_fila", Limite: time.Second, Executar: nada}); !ex || err != nil {
		t.Fatalf("colidiu com a trava de uma chave: ex=%v err=%v", ex, err)
	}
}

func TestPanicoViraErroELiberaATrava(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	ctx := context.Background()
	ex, err := a.Rodar(ctx, Tarefa{Nome: "boom", Limite: time.Second, Executar: func(context.Context) error { panic("kaboom") }})
	if !ex || err == nil || !strings.Contains(err.Error(), "kaboom") {
		t.Fatalf("ex=%v err=%v", ex, err)
	}
	semTrava(t, p, "boom")
	for i, f := range []func(context.Context) error{nada, func(context.Context) error { return errors.New("falha") },
		func(c context.Context) error { <-c.Done(); return c.Err() }} {
		if ex, _ := a.Rodar(ctx, Tarefa{Nome: "boom", Limite: 20 * time.Millisecond, Executar: f}); !ex {
			t.Fatalf("rodada %d depois de liberar a trava não executou", i)
		}
		semTrava(t, p, "boom")
	}
	if _, _, n := linha(t, p, "boom"); n != 4 {
		t.Fatalf("esperava 4 linhas, achei %d", n)
	}
}

// Pool de 2 conexões e 6 tarefas que USAM o banco ao mesmo tempo: a trava não pode tomar conexão do
// pool (senão as tarefas esperariam umas pelas outras até o prazo).
func TestTarefasQueUsamOBancoNaoTravamOPool(t *testing.T) {
	grande := testebanco.Novo(t)
	cfg := grande.Config()
	cfg.MaxConns = 2
	pequeno, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pequeno.Close)
	a := Novo(pequeno)
	var wg sync.WaitGroup
	for i := range 6 {
		wg.Go(func() {
			a.Rodar(context.Background(), Tarefa{Nome: fmt.Sprintf("pool-%d", i), Limite: 5 * time.Second,
				Executar: func(ctx context.Context) error {
					_, err := pequeno.Exec(ctx, `select pg_sleep(0.1)`)
					return err
				}})
		})
	}
	feito := make(chan struct{})
	go func() { wg.Wait(); close(feito) }()
	select {
	case <-feito:
	case <-time.After(10 * time.Second):
		t.Fatal("tarefas presas: a trava está disputando o pool")
	}
	for i := range 6 {
		if ok, resp, n := linha(t, grande, fmt.Sprintf("pool-%d", i)); !ok || n != 1 {
			t.Errorf("pool-%d: ok=%v resp=%q n=%d", i, ok, resp, n)
		}
	}
}

func TestRegistroProprioSoGravaALinhaDaTarefaNaFalha(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	gravar := a.Gravador()
	ctx := context.Background()
	a.Rodar(ctx, Tarefa{Nome: "coletar-dados-07h", RegistroProprio: true, Limite: time.Second, Executar: func(ctx context.Context) error {
		return gravar(ctx, "coletar-dados-07h · Vessel", time.Now(), nil)
	}})
	if _, _, n := linha(t, p, "coletar-dados-07h"); n != 0 {
		t.Fatal("com RegistroProprio e sucesso, o agendador não grava a linha dele")
	}
	if ok, _, n := linha(t, p, "coletar-dados-07h · Vessel"); !ok || n != 1 {
		t.Fatal("a linha da variante não foi gravada")
	}
	a.Rodar(ctx, Tarefa{Nome: "coletar-dados-07h", RegistroProprio: true, Limite: time.Second, Executar: func(context.Context) error { panic("x") }})
	if ok, _, n := linha(t, p, "coletar-dados-07h"); ok || n != 1 {
		t.Fatal("falha inteira tem de aparecer com o nome da tarefa")
	}
}

func TestDesligadaNaoAgendaMasFicaParaORodarManual(t *testing.T) {
	a := Novo(testebanco.Novo(t))
	a.Desligadas = []string{"vessel-rd-station"}
	if err := a.Registrar(Tarefa{Nome: "vessel-rd-station", Agenda: "* * * * *", Limite: time.Second, Executar: nada}); err != nil {
		t.Fatal(err)
	}
	if err := a.Registrar(Tarefa{Nome: "conferir-robos", Agenda: "* * * * *", Limite: time.Second, Executar: nada}); err != nil {
		t.Fatal(err)
	}
	if len(a.cron.Entries()) != 1 {
		t.Fatalf("só a ligada entra na agenda: %d entradas", len(a.cron.Entries()))
	}
	if _, ok := a.Buscar("vessel-rd-station"); !ok || !a.Desligada("vessel-rd-station") || a.Desligada("conferir-robos") {
		t.Fatal("a desligada continua registrada (para `api worker rodar --forcar`)")
	}
	a.Desligadas = []string{"*"}
	if !a.Desligada("qualquer") {
		t.Fatal(`"*" desliga todas`)
	}
}

func TestLimiteEExecutarInvalidosSaoRejeitados(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	casos := map[string]Tarefa{
		"limite zero":     {Nome: "v1", Agenda: "* * * * *", Executar: nada},
		"limite negativo": {Nome: "v2", Agenda: "* * * * *", Limite: -time.Second, Executar: nada},
		"executar nil":    {Nome: "v3", Agenda: "* * * * *", Limite: time.Second},
		"sem nome":        {Agenda: "* * * * *", Limite: time.Second, Executar: nada},
	}
	for nome, tf := range casos {
		if err := a.Registrar(tf); err == nil {
			t.Errorf("%s: Registrar deveria falhar", nome)
		}
		if ex, err := a.Rodar(context.Background(), tf); ex || err == nil {
			t.Errorf("%s: Rodar deveria falhar sem executar (ex=%v err=%v)", nome, ex, err)
		}
	}
	var n int
	p.QueryRow(context.Background(), `select count(*) from robos_execucoes`).Scan(&n)
	if n != 0 {
		t.Fatalf("nenhuma linha podia ser gravada: %d", n)
	}
}

// Desligamento: a tarefa em andamento tem a Graca; depois o contexto dela é cancelado e a linha de
// erro ainda é gravada (nada fica pendurado sem registro).
func TestDesligamentoCancelaDepoisDaGraca(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Graca = 100 * time.Millisecond
	comecou := make(chan struct{})
	var uma sync.Once
	if err := a.Registrar(Tarefa{Nome: "presa", Agenda: "@every 1s", Limite: time.Minute, Executar: func(ctx context.Context) error {
		uma.Do(func() { close(comecou) })
		<-ctx.Done()
		return ctx.Err()
	}}); err != nil {
		t.Fatal(err)
	}
	ctx, parar := context.WithCancel(context.Background())
	fim := make(chan struct{})
	go func() { a.Iniciar(ctx); close(fim) }()
	select {
	case <-comecou:
	case <-time.After(5 * time.Second):
		t.Fatal("a tarefa não foi agendada")
	}
	parar()
	select {
	case <-fim:
	case <-time.After(10 * time.Second):
		t.Fatal("Iniciar não voltou depois da graça")
	}
	if ok, resp, n := linha(t, p, "presa"); ok || n != 1 || !strings.Contains(resp, "canceled") {
		t.Fatalf("ok=%v resp=%q n=%d", ok, resp, n)
	}
}

func TestSaudeEMetricas(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Segredos = []string{"segredo-123456"}
	a.Registrar(Tarefa{Nome: "falha", Agenda: "0 1 * * *", Limite: time.Second, Executar: func(context.Context) error { return errors.New("x segredo-123456") }})
	a.Rodar(context.Background(), Tarefa{Nome: "falha", Limite: time.Second, Executar: func(context.Context) error { return errors.New("x segredo-123456") }})
	h := a.Saude()
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/saude", nil))
	if w.Code != 503 {
		t.Fatalf("parado: %d", w.Code)
	}
	a.rodando.Store(true)
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/saude", nil))
	if w.Code != 200 {
		t.Fatalf("rodando: %d", w.Code)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/metricas", nil))
	var m map[string]struct {
		Agenda     string `json:"agenda"`
		Falhas     int64  `json:"falhas"`
		UltimoErro string `json:"ultimo_erro"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil || m["falha"].Falhas != 1 || m["falha"].Agenda != "0 1 * * *" {
		t.Fatalf("métricas: %s (%v)", w.Body, err)
	}
	if strings.Contains(w.Body.String(), "segredo-123456") {
		t.Fatalf("segredo nas métricas: %s", w.Body)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/saude", nil))
	if w.Code != 405 {
		t.Fatalf("saúde é só leitura: POST = %d", w.Code)
	}
}

func TestLivroDeEnvios(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if ok, err := banco.ReservarEnvio(ctx, p, "relatorio:2026-10-10:14:wpp"); !ok || err != nil {
		t.Fatalf("primeira reserva: ok=%v err=%v", ok, err)
	}
	if ok, err := banco.ReservarEnvio(ctx, p, "relatorio:2026-10-10:14:wpp"); ok || err != nil {
		t.Fatalf("a mesma chave não pode ser reservada duas vezes, e repetir não é erro: ok=%v err=%v", ok, err)
	}
	if err := banco.LiberarEnvio(ctx, p, "relatorio:2026-10-10:14:wpp"); err != nil {
		t.Fatal(err)
	}
	if ok, _ := banco.ReservarEnvio(ctx, p, "relatorio:2026-10-10:14:wpp"); !ok {
		t.Fatal("liberada, pode ser reservada de novo")
	}
}

func TestRodarDevolveErroSemSegredoELogaSemSegredo(t *testing.T) {
	const seg = "segredo-inventado-do-core-123"
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Segredos = []string{seg}
	log := capturarLog(t)
	tf := Tarefa{Nome: "vaza-no-erro", Limite: time.Second, Executar: func(context.Context) error {
		return fmt.Errorf("GET https://core/x?token=%s: 500", seg)
	}}
	ex, err := a.Rodar(context.Background(), tf)
	if !ex || err == nil || strings.Contains(err.Error(), seg) || !strings.Contains(err.Error(), "token=***") {
		t.Fatalf("o erro devolvido por Rodar não pode ter segredo: ex=%v err=%v", ex, err)
	}
	a.disparar(tf) // o que o cron faz
	if strings.Contains(log.String(), seg) || !strings.Contains(log.String(), "tarefa falhou") {
		t.Fatalf("segredo no log do cron (ou sem a linha de falha): %s", log)
	}
	if _, resp, _ := linha(t, p, "vaza-no-erro"); strings.Contains(resp, seg) {
		t.Fatalf("segredo na resposta: %s", resp)
	}
}

func TestPanicoLogaPilhaSemOValorDoPanico(t *testing.T) {
	const seg = "segredo-inventado-no-panico-1"
	a := Novo(testebanco.Novo(t))
	a.Segredos = []string{seg}
	log := capturarLog(t)
	_, err := a.Rodar(context.Background(), Tarefa{Nome: "boom-pilha", Limite: time.Second, Executar: func(context.Context) error { panic("x " + seg) }})
	if err == nil || strings.Contains(err.Error(), seg) {
		t.Fatalf("err=%v", err)
	}
	if !strings.Contains(log.String(), "goroutine") || !strings.Contains(log.String(), "boom-pilha") || strings.Contains(log.String(), seg) {
		t.Fatalf("esperava a pilha do pânico no log, sem segredo: %s", log)
	}
}

func TestDesligadaDepoisDoRegistrarNaoDispara(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	rodou := 0
	tf := Tarefa{Nome: "push-real", Agenda: "* * * * *", Limite: time.Second, Executar: func(context.Context) error { rodou++; return nil }}
	if err := a.Registrar(tf); err != nil { // Desligadas ainda vazio: entra na agenda
		t.Fatal(err)
	}
	a.Desligadas = []string{"push-real"} // ordem errada de quem monta o worker: o agendamento não pode furar a lista
	a.disparar(tf)
	if rodou != 0 {
		t.Fatal("tarefa desligada depois do Registrar disparou pela agenda")
	}
	if _, _, n := linha(t, p, "push-real"); n != 0 {
		t.Fatalf("a execução ignorada não grava linha: %d", n)
	}
	if ex, err := a.Rodar(context.Background(), tf); !ex || err != nil || rodou != 1 { // rodar --forcar
		t.Fatalf("o rodar manual continua valendo: ex=%v err=%v rodou=%d", ex, err, rodou)
	}
}

// A conexão da trava não pode vazar: depois de várias execuções o número de sessões do banco volta ao
// que era (conexão sem Close ficaria aberta, presa a uma sessão).
func TestConexaoDaTravaNaoVaza(t *testing.T) {
	grande := testebanco.Novo(t)
	cfg := grande.Config()
	app := fmt.Sprintf("vaza-conexao-%d", time.Now().UnixNano())
	cfg.ConnConfig.RuntimeParams["application_name"] = app // a conexão da trava herda
	p, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	sessoes := func() int {
		var n int
		if err := grande.QueryRow(context.Background(), `select count(*) from pg_stat_activity where application_name = $1::text`, app).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	a := Novo(p)
	if ex, err := a.Rodar(context.Background(), Tarefa{Nome: "aquece", Limite: time.Second, Executar: nada}); !ex || err != nil {
		t.Fatal(ex, err)
	}
	antes := sessoes()
	for i := range 20 {
		ex, _ := a.Rodar(context.Background(), Tarefa{Nome: fmt.Sprintf("vaza-%d", i%3), Limite: time.Second,
			Executar: func(context.Context) error {
				if i%4 == 0 {
					return errors.New("falha")
				}
				return nil
			}})
		if !ex {
			t.Fatalf("rodada %d não executou", i)
		}
	}
	var depois int
	for range 50 { // o encerramento da sessão no servidor é assíncrono
		if depois = sessoes(); depois <= antes+1 {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatalf("sessões antes=%d depois=%d: a conexão da trava vazou", antes, depois)
}

func TestLimparTrocaOSegredoMaisLongoPrimeiro(t *testing.T) {
	got := Limpar("a abcdefgh-CAUDA-SECRETA b abcdefgh c", []string{"abcdefgh", "abcdefgh-CAUDA-SECRETA", "curto"})
	if strings.Contains(got, "CAUDA") || got != "a *** b *** c" {
		t.Fatalf("a cauda do segredo longo vazou: %q", got)
	}
}

func TestAgendadorUsaUTC(t *testing.T) {
	if l := Novo(testebanco.Novo(t)).cron.Location(); l != time.UTC {
		t.Fatalf("a agenda é em UTC (como o pg_cron): %v", l)
	}
}

func TestTarefaQueTerminaNaGracaNaoECancelada(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	a.Graca = 5 * time.Second
	comecou := make(chan struct{})
	var uma sync.Once
	var cancelada bool
	if err := a.Registrar(Tarefa{Nome: "termina-na-graca", Agenda: "@every 1s", Limite: time.Minute, Executar: func(ctx context.Context) error {
		uma.Do(func() { close(comecou) })
		time.Sleep(300 * time.Millisecond)
		cancelada = ctx.Err() != nil
		return nil
	}}); err != nil {
		t.Fatal(err)
	}
	ctx, parar := context.WithCancel(context.Background())
	fim := make(chan struct{})
	go func() { a.Iniciar(ctx); close(fim) }()
	select {
	case <-comecou:
	case <-time.After(5 * time.Second):
		t.Fatal("a tarefa não foi agendada")
	}
	parar()
	select {
	case <-fim:
	case <-time.After(10 * time.Second):
		t.Fatal("Iniciar não voltou")
	}
	if ok, resp, n := linha(t, p, "termina-na-graca"); !ok || n != 1 || cancelada {
		t.Fatalf("a tarefa que acaba dentro da graça termina inteira: ok=%v resp=%q n=%d cancelada=%v", ok, resp, n, cancelada)
	}
}

// Se a conexão da trava cai no meio da tarefa, a linha de robos_execucoes ainda sai (pelo pool).
func TestConexaoDaTravaPerdidaGravaPeloPool(t *testing.T) {
	p := testebanco.Novo(t)
	a := Novo(p)
	capturarLog(t)
	ex, err := a.Rodar(context.Background(), Tarefa{Nome: "perde-trava", Limite: 10 * time.Second, Executar: func(ctx context.Context) error {
		var matou bool
		return p.QueryRow(ctx, `select coalesce(bool_and(pg_terminate_backend(pid, 5000)), false) from pg_locks
			where locktype = 'advisory' and objsubid = 2 and granted
			  and classid::bigint = $1::bigint and objid::bigint = (hashtext($2::text)::bigint & 4294967295)`,
			int64(EspacoDaTrava), "perde-trava").Scan(&matou)
	}})
	if !ex || err != nil {
		t.Fatalf("ex=%v err=%v", ex, err)
	}
	if ok, resp, n := linha(t, p, "perde-trava"); !ok || resp != "ok" || n != 1 {
		t.Fatalf("a linha tem de existir mesmo sem a conexão da trava: ok=%v resp=%q n=%d", ok, resp, n)
	}
	semTrava(t, p, "perde-trava")
}

func TestValidarDesligadas(t *testing.T) {
	ts := []Tarefa{{Nome: "a"}, {Nome: "b"}}
	if err := ValidarDesligadas(ts, []string{"a", "*"}); err != nil {
		t.Fatal(err)
	}
	if err := ValidarDesligadas(ts, []string{"c"}); err == nil || !strings.Contains(err.Error(), "c") {
		t.Fatalf("nome desconhecido: %v", err)
	}
}
