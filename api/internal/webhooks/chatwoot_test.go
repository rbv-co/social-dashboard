package webhooks

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const segredoCW = "segredo-do-chatwoot-42"

const esquemaChatwoot = `
create table chatwoot_eventos (id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('lead_novo', 'lead_quente', 'qualified_lead')),
  chatwoot_account_id integer, conversation_id bigint not null, conversation_display_id bigint, contact_id bigint,
  contact_name text, contact_phone_number text, loja text, classificacao_ia text,
  criado_em_chatwoot timestamptz not null, dia_br date not null, recebido_em timestamptz not null default now(),
  unique (conversation_id, tipo));
create table contatos_sem_mensagem (telefone text primary key, motivo text, criado_em timestamptz not null default now());`

func montarChatwoot(t *testing.T, segredo string) (*pgxpool.Pool, http.Handler) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), esquemaChatwoot); err != nil {
		t.Fatal(err)
	}
	c := &Chatwoot{Pool: p, Segredo: segredo, Agora: func() time.Time { return time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC) }}
	r := chi.NewRouter()
	r.HandleFunc("/receber-webhook-chatwoot", c.Evento)
	r.HandleFunc("/receber-opt-out-chatwoot", c.OptOut)
	return p, r
}

func postCW(h http.Handler, caminho, token, corpo string) *httptest.ResponseRecorder {
	alvo := caminho
	if token != "" {
		alvo += "?token=" + token
	}
	req := httptest.NewRequest("POST", alvo, strings.NewReader(corpo))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

const lead = `{"tipo":"qualified_lead","account_id":1,"conversation_id":555,"conversation_display_id":12,"contact_id":9,"contact_name":"Ana","contact_phone_number":"+5511987654321","loja":"Tivoli","classificacao_ia":"quente","created_at":"2026-10-10T01:30:00Z"}`

func TestChatwootSegredo(t *testing.T) {
	p, h := montarChatwoot(t, segredoCW)
	for _, tok := range []string{"", "errado", segredoCW + "x", segredoCW[:5]} {
		if w := postCW(h, "/receber-webhook-chatwoot", tok, lead); w.Code != 401 {
			t.Errorf("token %q: %d", tok, w.Code)
		}
		if w := postCW(h, "/receber-opt-out-chatwoot", tok, `{}`); w.Code != 401 {
			t.Errorf("opt-out token %q: %d", tok, w.Code)
		}
	}
	if n := contar(t, p, `select count(*) from chatwoot_eventos`); n != 0 {
		t.Fatal("nada pode gravar sem o segredo")
	}
	_, semSegredo := montarChatwoot(t, "")
	if w := postCW(semSegredo, "/receber-webhook-chatwoot", "", lead); w.Code != 401 {
		t.Fatalf("sem segredo configurado nada passa: %d", w.Code)
	}
	if !tokenValido(segredoCW, segredoCW) || tokenValido(segredoCW, "") || tokenValido("", "") {
		t.Fatal("tokenValido")
	}
}

func TestChatwootEvento(t *testing.T) {
	p, h := montarChatwoot(t, segredoCW)
	for i := 0; i < 2; i++ { // reenvio do mesmo evento: uma linha só
		if w := postCW(h, "/receber-webhook-chatwoot", segredoCW, lead); w.Code != 200 {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
	}
	var dia, nome string
	p.QueryRow(context.Background(), `select dia_br::text, contact_name from chatwoot_eventos`).Scan(&dia, &nome)
	if n := contar(t, p, `select count(*) from chatwoot_eventos`); n != 1 || dia != "2026-10-09" || nome != "Ana" {
		t.Fatalf("n=%d dia=%s nome=%s (01:30 UTC ainda é dia 9 em São Paulo)", n, dia, nome)
	}
	semData := `{"tipo":"lead_novo","conversation_id":"556","created_at":"ontem"}`
	postCW(h, "/receber-webhook-chatwoot", segredoCW, semData)
	p.QueryRow(context.Background(), `select dia_br::text from chatwoot_eventos where conversation_id = 556`).Scan(&dia)
	if dia != "2026-10-10" {
		t.Fatalf("created_at inválido usa agora: %s", dia)
	}
	casos := []struct {
		corpo string
		quer  int
	}{
		{`{"tipo":"lead_frio","conversation_id":1}`, 400},
		{`{"tipo":"lead_novo"}`, 400},
		{`não é json`, 400},
		{`{"tipo":"lead_novo","conversation_id":1,"x":"` + strings.Repeat("a", limiteChatwoot) + `"}`, 413},
	}
	for _, c := range casos {
		if w := postCW(h, "/receber-webhook-chatwoot", segredoCW, c.corpo); w.Code != c.quer {
			t.Errorf("%.40s: %d", c.corpo, w.Code)
		}
	}
	req := httptest.NewRequest("GET", "/receber-webhook-chatwoot?token="+segredoCW, nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 405 {
		t.Fatalf("GET = %d", w.Code)
	}
}

func TestChatwootOptOut(t *testing.T) {
	p, h := montarChatwoot(t, segredoCW)
	msg := func(conteudo, tipo, fone string) string {
		return `{"event":"message_created","message_type":"` + tipo + `","content":"` + conteudo + `","sender":{"phone_number":"` + fone + `"}}`
	}
	casos := []struct {
		corpo, gravou string
	}{
		{msg("PARAR", "incoming", "+55 (11) 98765-4321"), "5511987654321|resposta: parar"},
		{msg("Não quero receber mais!", "incoming", "11 91234-5678"), "5511912345678|resposta: nao quero receber mais"},
		{msg("posso parar na loja?", "incoming", "11 91111-1111"), ""},
		{msg("sair", "outgoing", "11 92222-2222"), ""},
		{msg("sair", "incoming", "11 3333-3333"), ""}, // telefone fixo não recebe WhatsApp
		{`{"event":"message_created","message_type":"incoming","content":"pare","conversation":{"meta":{"sender":{"phone_number":"0055 21 99876-5432"}}}}`, "5521998765432|resposta: pare"},
		{msg("PARAR", "incoming", "+55 (11) 98765-4321"), ""}, // reenvio: nada novo
	}
	for _, c := range casos {
		antes := contar(t, p, `select count(*) from contatos_sem_mensagem`)
		if w := postCW(h, "/receber-opt-out-chatwoot", segredoCW, c.corpo); w.Code != 200 {
			t.Fatalf("%d %s", w.Code, w.Body)
		}
		depois := contar(t, p, `select count(*) from contatos_sem_mensagem`)
		if c.gravou == "" {
			if depois != antes {
				t.Errorf("não devia gravar: %s", c.corpo)
			}
			continue
		}
		tel, motivo, _ := strings.Cut(c.gravou, "|")
		var got string
		p.QueryRow(context.Background(), `select motivo from contatos_sem_mensagem where telefone = $1`, tel).Scan(&got)
		if got != motivo {
			t.Errorf("%s: motivo %q, esperava %q", c.corpo, got, motivo)
		}
	}
}

func TestChatwootSegredoNuncaNoLog(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	p, h := montarChatwoot(t, segredoCW)
	p.Exec(context.Background(), `drop table chatwoot_eventos`) // força a falha de banco (que loga)
	w := postCW(h, "/receber-webhook-chatwoot", segredoCW, lead)
	if w.Code != 500 || !strings.Contains(log.String(), "falha ao gravar") {
		t.Fatalf("%d / log: %s", w.Code, log.String())
	}
	if strings.Contains(log.String(), segredoCW) || strings.Contains(w.Body.String(), segredoCW) {
		t.Fatal("o segredo vazou")
	}
}

func TestChatwootCorpoNaoObjetoComoNoEdge(t *testing.T) {
	_, h := montarChatwoot(t, segredoCW)
	if w := postCW(h, "/receber-webhook-chatwoot", segredoCW, `[1]`); w.Code != 400 || !strings.Contains(w.Body.String(), "payload_incompleto") {
		t.Errorf("evento com array: %d %s", w.Code, w.Body)
	}
	if w := postCW(h, "/receber-opt-out-chatwoot", segredoCW, `[1]`); w.Code != 200 {
		t.Errorf("opt-out com array: %d", w.Code)
	}
}

func TestChatwootNaoLogaNadaNoCaminhoFeliz(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	_, h := montarChatwoot(t, segredoCW)
	log.Reset() // descarta o que a migração do banco de teste logou
	postCW(h, "/receber-webhook-chatwoot", segredoCW, lead)
	postCW(h, "/receber-opt-out-chatwoot", "errado", `{}`)
	if log.Len() != 0 {
		t.Fatalf("nada deveria ser logado: %s", log.String())
	}
}
