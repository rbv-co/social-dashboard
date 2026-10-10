package vessel

import (
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
		st, atraso := f.status, f.atraso
		f.mu.Unlock()
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
		(40, 1, 'enviado', 1, now() - interval '11 minutes'), (41, 1, 'enviado', 1, now() - interval '2 minutes')`)
	rd.Rodar(ctx)
	if st, n, _, _ := estadoRD(t, p, 40); st != "ok" || n != 2 {
		t.Fatalf("parado há 11 min é reenviado: st=%s n=%d", st, n)
	}
	if st, _, _, _ := estadoRD(t, p, 41); st != "enviado" || envios(f) != 1 {
		t.Fatalf("enviado há 2 min fica quieto: st=%s envios=%d", st, envios(f))
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
