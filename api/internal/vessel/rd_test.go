package vessel

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const tokenRD = "token-publico-da-rd-123"

// Tabelas como em produção (migrations 2026-09-16 e 2026-09-28*); vessel_rd_payload é um esboço com a
// MESMA assinatura (a de verdade continua no banco restaurado).
const tabelasRD = `
create table vessel_pessoas (id bigserial primary key, nome text not null, telefone text not null, email text);
create table vessel_rd_envios (
  id bigint generated always as identity primary key, origem_id bigint not null unique, pessoa_id bigint not null,
  codigo text, status text not null default 'pendente' check (status in ('pendente', 'enviado', 'ok', 'falhou', 'sem_email')),
  tentativas int not null default 0, request_id bigint, http_status int, resposta text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
create function vessel_rd_payload(p_origem_id bigint) returns jsonb language sql stable as $$
  select case when p_origem_id = 404 then null
    else jsonb_build_object('event_type', 'CONVERSION', 'payload', jsonb_build_object('conversion_identifier', 'beauty-session-' || p_origem_id)) end $$;
insert into vessel_pessoas (id, nome, telefone, email) values (1, 'Ana', '5511999990001', 'ana@x'), (2, 'Bia', '5511999990002', '  ');`

type rdFalsa struct {
	mu     sync.Mutex
	corpos []string
	querys []string
	status int
	atraso time.Duration // responde depois disso (lentidão)
	// travaNa: ao chegar o N-ésimo POST (>0) o servidor chama cancelar e só responde quando o cliente
	// desiste (prazo estourando com um envio no ar).
	travaNa  int
	cancelar func()
}

// responder troca a resposta da RD (sob a trava: o servidor lê em outra goroutine).
func (f *rdFalsa) responder(status int, atraso time.Duration) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.status, f.atraso = status, atraso
}

func envios(f *rdFalsa) int { c, _ := f.lista(); return len(c) }

// lista: cópia dos corpos e das querys recebidos (sob a trava: o servidor anota em outra goroutine).
func (f *rdFalsa) lista() (corpos, querys []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.corpos), slices.Clone(f.querys)
}

func ambienteRD(t *testing.T, status int) (*RD, *rdFalsa, *pgxpool.Pool) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelasRD); err != nil {
		t.Fatal(err)
	}
	f := &rdFalsa{status: status}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.corpos = append(f.corpos, string(b))
		f.querys = append(f.querys, r.URL.RawQuery)
		st, atraso, trava, cancelar := f.status, f.atraso, f.travaNa > 0 && len(f.corpos) == f.travaNa, f.cancelar
		f.mu.Unlock()
		if trava {
			cancelar()
			select {
			case <-r.Context().Done():
			case <-time.After(10 * time.Second):
			}
			return
		}
		time.Sleep(atraso)
		if r.Header.Get("Content-Type") != "application/json" {
			st = 415
		}
		w.WriteHeader(st)
		io.WriteString(w, `{"event_uuid":"x"}`)
	}))
	t.Cleanup(srv.Close)
	return &RD{Pool: p, Token: tokenRD, URL: srv.URL}, f, p
}

func estadoRD(t *testing.T, p *pgxpool.Pool, origem int64) (status string, tentativas int, http *int, resp string) {
	t.Helper()
	if err := p.QueryRow(context.Background(), `select status, tentativas, http_status, coalesce(resposta, '') from vessel_rd_envios where origem_id = $1`, origem).
		Scan(&status, &tentativas, &http, &resp); err != nil {
		t.Fatal(err)
	}
	return
}

func TestRDEnviaAFilaEMarcaOk(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id, codigo) values (10, 1, 'BS1'), (11, 1, 'BS1')`); err != nil {
		t.Fatal(err)
	}
	if err := rd.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	corpos, querys := f.lista()
	if len(corpos) != 2 || !strings.Contains(corpos[0], `"beauty-session-10"`) || querys[0] != "api_key="+tokenRD {
		t.Fatalf("envios = %v %v", corpos, querys)
	}
	if st, n, h, resp := estadoRD(t, p, 10); st != "ok" || n != 1 || h == nil || *h != 200 || resp != `{"event_uuid":"x"}` {
		t.Fatalf("st=%s n=%d http=%v resp=%q", st, n, h, resp)
	}
	if err := rd.Rodar(ctx); err != nil || envios(f) != 2 {
		t.Fatalf("o que deu ok nunca é reenviado: err=%v envios=%d", err, envios(f))
	}
}

func TestRDSemEmailEsperaEVoltaQuandoGanhaEmail(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id) values (20, 2)`)
	rd.Rodar(ctx)
	if st, n, _, _ := estadoRD(t, p, 20); st != "sem_email" || n != 0 || envios(f) != 0 {
		t.Fatalf("sem e-mail não gasta tentativa: st=%s n=%d envios=%d", st, n, envios(f))
	}
	p.Exec(ctx, `update vessel_pessoas set email = 'bia@x' where id = 2`)
	rd.Rodar(ctx)
	if st, n, _, _ := estadoRD(t, p, 20); st != "ok" || n != 1 {
		t.Fatalf("ganhou e-mail, volta e vai: st=%s n=%d", st, n)
	}
}

func TestRDFalhaTentaAteCincoVezesEAparece(t *testing.T) {
	rd, f, p := ambienteRD(t, 400)
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id) values (30, 1)`)
	for i := range 6 {
		err := rd.Rodar(ctx)
		if i < 5 && (err == nil || !strings.Contains(err.Error(), "1 de 1")) {
			t.Fatalf("rodada %d: falha tem de virar erro da tarefa: %v", i, err)
		}
		if i == 4 && (err == nil || !strings.Contains(err.Error(), "esgotaram as 5 tentativas")) {
			t.Fatalf("a 5ª falha tira a linha da fila: tem de aparecer no erro da tarefa: %v", err)
		}
		if i == 5 && err != nil {
			t.Fatalf("depois de 5 tentativas a linha sai da fila: %v", err)
		}
	}
	if st, n, h, _ := estadoRD(t, p, 30); st != "falhou" || n != 5 || *h != 400 || envios(f) != 5 {
		t.Fatalf("st=%s n=%d http=%v envios=%d", st, n, h, envios(f))
	}
}

func TestRDEnviadoParadoHaDezMinutosVoltaAFila(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id, status, tentativas, atualizado_em) values
		(40, 1, 'enviado', 1, now() - interval '11 minutes'), (41, 1, 'enviado', 1, now() - interval '2 minutes'),
		(42, 1, 'enviado', 1, now() - interval '7 minutes')`)
	rd.Rodar(ctx)
	if st, n, _, _ := estadoRD(t, p, 40); st != "ok" || n != 2 {
		t.Fatalf("parado há 11 min é reenviado: st=%s n=%d", st, n)
	}
	if st, _, _, _ := estadoRD(t, p, 41); st != "enviado" || envios(f) != 1 {
		t.Fatalf("enviado há 2 min fica quieto: st=%s envios=%d", st, envios(f))
	}
	if st, _, _, _ := estadoRD(t, p, 42); st != "enviado" {
		t.Fatalf("enviado há 7 min ainda não passou dos 10: st=%s", st)
	}
}

func TestRDSemTokenNaoChamaARDMasArrumaAFila(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	rd.Token = ""
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id) values (50, 2)`)
	if err := rd.Rodar(ctx); err == nil || !strings.Contains(err.Error(), "rd_sem_token") {
		t.Fatalf("sem token é erro visível: %v", err)
	}
	if st, _, _, _ := estadoRD(t, p, 50); st != "sem_email" || envios(f) != 0 {
		t.Fatalf("st=%s envios=%d", st, envios(f))
	}
}

func TestRDRedeForaNaoGuardaOToken(t *testing.T) {
	rd, _, p := ambienteRD(t, 200)
	rd.URL = "http://127.0.0.1:1/conversions" // ninguém escuta
	rd.HTTP = &http.Client{Timeout: time.Second}
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id) values (60, 1), (404, 1)`)
	err := rd.Rodar(ctx)
	if err == nil || strings.Contains(err.Error(), tokenRD) {
		t.Fatalf("err=%v", err)
	}
	st, _, h, resp := estadoRD(t, p, 60)
	if st != "falhou" || h != nil || resp == "" || strings.Contains(resp, tokenRD) || strings.Contains(resp, "api_key") {
		t.Fatalf("st=%s http=%v resp=%q", st, h, resp)
	}
	if st, _, _, resp := estadoRD(t, p, 404); st != "falhou" || !strings.Contains(resp, "sem payload") {
		t.Fatalf("origem sumida: st=%s resp=%q", st, resp)
	}
}

// 429 e lentidão além do prazo: falha visível, a linha volta à fila (até 5 tentativas) e o token
// nunca é guardado; quando a RD volta, a mesma linha vai.
func TestRD429ELentaVoltamAFilaSemToken(t *testing.T) {
	rd, f, p := ambienteRD(t, 429)
	rd.HTTP = &http.Client{Timeout: 100 * time.Millisecond}
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id) values (70, 1)`)
	if err := rd.Rodar(ctx); err == nil {
		t.Fatal("429 é falha visível")
	}
	if st, n, h, _ := estadoRD(t, p, 70); st != "falhou" || n != 1 || h == nil || *h != 429 {
		t.Fatalf("429: st=%s n=%d http=%v", st, n, h)
	}
	f.responder(200, 300*time.Millisecond)
	err := rd.Rodar(ctx)
	st, n, h, resp := estadoRD(t, p, 70)
	if err == nil || st != "falhou" || n != 2 || h != nil || strings.Contains(resp, tokenRD) || strings.Contains(err.Error(), tokenRD) {
		t.Fatalf("lenta: err=%v st=%s n=%d http=%v resp=%q", err, st, n, h, resp)
	}
	f.responder(200, 0)
	if err := rd.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	if st, n, _, _ := estadoRD(t, p, 70); st != "ok" || n != 3 || envios(f) != 3 {
		t.Fatalf("voltou: st=%s n=%d envios=%d", st, n, envios(f))
	}
}

// A RD (ou um intermediário) ecoando a chave no corpo: o que vai para a tabela e para o erro não a leva.
func TestRDRespostaQueEcoaOTokenNaoVaiParaATabela(t *testing.T) {
	rd, _, p := ambienteRD(t, 200)
	eco := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(400)
		io.WriteString(w, "chave inválida: "+r.URL.Query().Get("api_key"))
	}))
	t.Cleanup(eco.Close)
	rd.URL = eco.URL
	p.Exec(context.Background(), `insert into vessel_rd_envios (origem_id, pessoa_id) values (80, 1)`)
	err := rd.Rodar(context.Background())
	_, _, _, resp := estadoRD(t, p, 80)
	if err == nil || strings.Contains(err.Error(), tokenRD) || strings.Contains(resp, tokenRD) || !strings.Contains(resp, "***") {
		t.Fatalf("err=%v resp=%q", err, resp)
	}
}

// Prazo da tarefa estoura no meio do lote (a RD está lenta): o que já saiu fica ok, o envio que estava
// no ar fica 'enviado' (ambíguo: a regra de 10 min decide) e o que NUNCA foi enviado volta a 'pendente'
// com a tentativa devolvida, senão leads sem envio esgotariam as 5 tentativas em silêncio.
func TestRDPrazoNoMeioDoLoteDevolveOQueNaoSaiu(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	ctx, cancela := context.WithCancel(context.Background())
	defer cancela()
	f.travaNa, f.cancelar = 2, cancela
	for o := 90; o <= 94; o++ {
		p.Exec(context.Background(), `insert into vessel_rd_envios (origem_id, pessoa_id) values ($1::bigint, 1)`, o)
	}
	err := rd.Rodar(ctx)
	if err == nil || !strings.Contains(err.Error(), "limite_de_tempo") || strings.Contains(err.Error(), tokenRD) {
		t.Fatalf("err=%v", err)
	}
	bg := context.Background()
	if st, n, _, _ := estadoRD(t, p, 90); st != "ok" || n != 1 {
		t.Fatalf("o que saiu antes do prazo fica ok: st=%s n=%d", st, n)
	}
	if st, n, _, _ := estadoRD(t, p, 91); st != "enviado" || n != 1 {
		t.Fatalf("envio no ar quando o prazo estourou é ambíguo, fica enviado: st=%s n=%d", st, n)
	}
	for o := int64(92); o <= 94; o++ {
		if st, n, _, resp := estadoRD(t, p, o); st != "pendente" || n != 0 || strings.Contains(resp, "deadline") {
			t.Fatalf("origem %d nunca foi enviada: volta pendente sem gastar tentativa: st=%s n=%d resp=%q", o, st, n, resp)
		}
	}
	if envios(f) != 2 {
		t.Fatalf("envios = %d", envios(f))
	}
	// Próxima rodada manda o resto; o ambíguo espera os 10 min e então vai de novo.
	f.travaNa = 0
	if err := rd.Rodar(bg); err != nil || envios(f) != 5 {
		t.Fatalf("err=%v envios=%d", err, envios(f))
	}
	if st, _, _, _ := estadoRD(t, p, 91); st != "enviado" {
		t.Fatalf("o ambíguo não é reenviado antes dos 10 min: %s", st)
	}
	p.Exec(bg, `update vessel_rd_envios set atualizado_em = now() - interval '11 minutes' where origem_id = 91`)
	if err := rd.Rodar(bg); err != nil {
		t.Fatal(err)
	}
	if st, n, _, _ := estadoRD(t, p, 91); st != "ok" || n != 2 {
		t.Fatalf("st=%s n=%d", st, n)
	}
}

// O resultado de um envio que TERMINOU é gravado mesmo com o contexto da tarefa já cancelado (o
// WithoutCancel da gravação): sem isso um ok viraria 'enviado' e a conversão sairia de novo em 10 min.
func TestRDGravaOResultadoMesmoComOPrazoVencido(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	ctx, cancela := context.WithCancel(context.Background())
	defer cancela()
	rd.HTTP = &http.Client{Transport: cancelaDepois{cancela}}
	for o := 100; o <= 101; o++ {
		p.Exec(context.Background(), `insert into vessel_rd_envios (origem_id, pessoa_id) values ($1::bigint, 1)`, o)
	}
	err := rd.Rodar(ctx)
	if err == nil || !strings.Contains(err.Error(), "limite_de_tempo") {
		t.Fatalf("err=%v", err)
	}
	if st, n, h, _ := estadoRD(t, p, 100); st != "ok" || n != 1 || h == nil || *h != 200 {
		t.Fatalf("o envio que terminou tem o resultado gravado: st=%s n=%d http=%v", st, n, h)
	}
	if st, n, _, _ := estadoRD(t, p, 101); st != "pendente" || n != 0 || envios(f) != 1 {
		t.Fatalf("o seguinte volta à fila: st=%s n=%d envios=%d", st, n, envios(f))
	}
}

// cancelaDepois faz o POST de verdade, lê a resposta inteira e então cancela o contexto da tarefa.
type cancelaDepois struct{ cancela func() }

func (c cancelaDepois) RoundTrip(r *http.Request) (*http.Response, error) {
	resp, err := http.DefaultTransport.RoundTrip(r)
	if err != nil {
		return nil, err
	}
	corpo, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	resp.Body = io.NopCloser(bytes.NewReader(corpo))
	c.cancela()
	return resp, nil
}

// Falha ao gravar o resultado de um envio não aborta o resto do lote (as outras linhas seguem) e
// aparece no erro. A linha sem resultado fica 'enviado' e a regra de 10 min a recupera.
func TestRDFalhaAoGravarNaoAbortaOLote(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	ctx := context.Background()
	// Só a linha 110 tem a gravação do resultado recusada (resposta com NUL não entra em text).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.corpos = append(f.corpos, string(b))
		f.mu.Unlock()
		if strings.Contains(string(b), "beauty-session-110") {
			io.WriteString(w, "a\x00b")
			return
		}
		io.WriteString(w, "{}")
	}))
	t.Cleanup(srv.Close)
	rd.URL = srv.URL
	for o := 110; o <= 112; o++ {
		p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id) values ($1::bigint, 1)`, o)
	}
	err := rd.Rodar(ctx)
	if err == nil {
		t.Fatal("falha ao gravar tem de aparecer")
	}
	if st, _, _, _ := estadoRD(t, p, 110); st != "enviado" {
		t.Fatalf("sem resultado gravado a linha fica enviado: %s", st)
	}
	for _, o := range []int64{111, 112} {
		if st, _, _, _ := estadoRD(t, p, o); st != "ok" {
			t.Fatalf("origem %d: o resto do lote segue: %s", o, st)
		}
	}
}

// Redirecionamento da RD não é seguido: o Referer carregaria ?api_key= para outro host.
func TestRDNaoSegueRedirecionamento(t *testing.T) {
	rd, _, p := ambienteRD(t, 200)
	var chegou int
	var mu sync.Mutex
	alheio := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		chegou++
		mu.Unlock()
	}))
	t.Cleanup(alheio.Close)
	redir := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, alheio.URL+"/?"+r.URL.RawQuery, http.StatusTemporaryRedirect)
	}))
	t.Cleanup(redir.Close)
	rd.URL = redir.URL
	p.Exec(context.Background(), `insert into vessel_rd_envios (origem_id, pessoa_id) values (120, 1)`)
	err := rd.Rodar(context.Background())
	st, _, h, resp := estadoRD(t, p, 120)
	mu.Lock()
	defer mu.Unlock()
	if err == nil || chegou != 0 || st != "falhou" || h == nil || *h != 307 || strings.Contains(resp, tokenRD) {
		t.Fatalf("err=%v chegou=%d st=%s http=%v resp=%q", err, chegou, st, h, resp)
	}
}

// Duas rodadas ao mesmo tempo sobre as mesmas linhas (dois workers, `api worker rodar` junto com o
// cron): a reserva num comando só com skip locked faz cada conversão sair UMA vez.
func TestRDDuasRodadasSimultaneasEnviamCadaLinhaUmaVez(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	f.responder(200, 15*time.Millisecond)
	ctx := context.Background()
	for o := 200; o < 260; o++ { // 60 > 50: uma rodada não leva tudo
		if _, err := p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id) values ($1::bigint, 1)`, o); err != nil {
			t.Fatal(err)
		}
	}
	var wg sync.WaitGroup
	erros := make([]error, 2)
	for i := range erros {
		wg.Add(1)
		go func() { defer wg.Done(); erros[i] = rd.Rodar(ctx) }()
	}
	wg.Wait()
	if erros[0] != nil || erros[1] != nil {
		t.Fatalf("erros: %v", erros)
	}
	corpos, _ := f.lista()
	vistos := map[string]int{}
	for _, c := range corpos {
		vistos[c]++
	}
	for c, n := range vistos {
		if n != 1 {
			t.Fatalf("%d envios do mesmo corpo: %s", n, c)
		}
	}
	if len(vistos) != 60 {
		t.Fatalf("enviou %d de 60", len(vistos))
	}
	var naoOk int
	p.QueryRow(ctx, `select count(*) from vessel_rd_envios where status <> 'ok' or tentativas <> 1`).Scan(&naoOk)
	if naoOk != 0 {
		t.Fatalf("%d linhas fora de ok/1 tentativa", naoOk)
	}
}

// Linha travada por outra transação (outro worker reservando) é PULADA, não esperada: a rodada manda
// as demais sem bloquear e a travada fica para quem a segura. Sem o skip locked a rodada pendura.
func TestRDPulaLinhaTravadaPorOutraTransacao(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	bg := context.Background()
	for o := 300; o <= 305; o++ {
		p.Exec(bg, `insert into vessel_rd_envios (origem_id, pessoa_id) values ($1::bigint, 1)`, o)
	}
	tx, err := p.Begin(bg)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(bg)
	if _, err := tx.Exec(bg, `select id from vessel_rd_envios where origem_id in (300, 301) for update`); err != nil {
		t.Fatal(err)
	}
	ctx, cancela := context.WithTimeout(bg, 10*time.Second)
	defer cancela()
	if err := rd.Rodar(ctx); err != nil || envios(f) != 4 {
		t.Fatalf("err=%v envios=%d (esperava 4: as 2 travadas ficam de fora, sem esperar)", err, envios(f))
	}
	for _, o := range []int64{300, 301} {
		if st, n, _, _ := estadoRD(t, p, o); st != "pendente" || n != 0 {
			t.Fatalf("origem %d: travada por outro, intocada: st=%s n=%d", o, st, n)
		}
	}
	tx.Commit(bg)
	if err := rd.Rodar(bg); err != nil || envios(f) != 6 {
		t.Fatalf("err=%v envios=%d", err, envios(f))
	}
}

// A 5ª tentativa que fica 'enviado' (processo caiu no meio) e é virada a 'falhou' pelo passo de 10 min sai
// da fila como as outras esgotadas: o erro da tarefa tem de dizer, uma vez só (depois a linha já é 'falhou').
func TestRDEsgotadaPeloPassoDe10MinAparece(t *testing.T) {
	rd, f, p := ambienteRD(t, 200)
	ctx := context.Background()
	p.Exec(ctx, `insert into vessel_rd_envios (origem_id, pessoa_id, status, tentativas, atualizado_em) values
		(40, 1, 'enviado', 5, now() - interval '11 minutes'),
		(41, 1, 'enviado', 3, now() - interval '11 minutes')`)
	err := rd.Rodar(ctx)
	if err == nil || !strings.Contains(err.Error(), "1 linha(s) esgotaram as 5 tentativas") {
		t.Fatalf("a 5ª tentativa travada tem de contar como esgotada (e só ela): %v", err)
	}
	if st, n, _, resp := estadoRD(t, p, 40); st != "falhou" || n != 5 || resp != "sem resposta em 10 min" || envios(f) != 1 {
		t.Fatalf("st=%s n=%d resp=%q envios=%d", st, n, resp, envios(f))
	}
	if err := rd.Rodar(ctx); err != nil {
		t.Fatalf("avisa uma vez só: %v", err)
	}
}
