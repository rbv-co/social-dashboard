package webhooks

import (
	"bytes"
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
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
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
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
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(antes) })
	_, h := montarChatwoot(t, segredoCW)
	log.Reset() // descarta o que a migração do banco de teste logou
	postCW(h, "/receber-webhook-chatwoot", segredoCW, lead)
	postCW(h, "/receber-opt-out-chatwoot", "errado", `{}`)
	if log.Len() != 0 {
		t.Fatalf("nada deveria ser logado: %s", log.String())
	}
}

func optOutMsg(extra string) string {
	return `{"event":"message_created","message_type":"incoming","content":"Não quero receber","sender":{"phone_number":"+55 19 98262-1828"}` + extra + `}`
}

// Porta de opt-out.test.mjs: a regra do opt-out precisa estar travada, não só o caminho feliz.
func TestChatwootOptOutMatrizDoEdge(t *testing.T) {
	p, h := montarChatwoot(t, segredoCW)
	cont := func() int { return contar(t, p, `select count(*) from contatos_sem_mensagem`) }
	envia := func(corpo string) (gravou bool, w *httptest.ResponseRecorder) {
		antes := cont()
		w = postCW(h, "/receber-opt-out-chatwoot", segredoCW, corpo)
		if w.Code != 200 {
			t.Fatalf("%s: %d", corpo, w.Code)
		}
		return cont() > antes, w
	}
	jc := func(c string) string { // conteúdo -> JSON
		return strings.Replace(optOutMsg(""), `"Não quero receber"`, c, 1)
	}
	motivo := func(tel string) string {
		var m string
		p.QueryRow(context.Background(), `select motivo from contatos_sem_mensagem where telefone = $1`, tel).Scan(&m)
		return m
	}
	// positivos: cada um com telefone próprio para a linha ser nova
	pos := []struct{ conteudo, motivo string }{
		{`"NAO QUERO RECEBER!"`, "resposta: nao quero receber"},
		{`"Não quero receber"`, "resposta: nao quero receber"},
		{`"não quero receber mais"`, "resposta: nao quero receber mais"},
		{`"Parar"`, "resposta: parar"},
		{`"sair."`, "resposta: sair"},
		{`" pare "`, "resposta: pare"},
	}
	for i, c := range pos {
		fone := "1998262" + strings.Repeat(string(rune('0'+i)), 4)
		corpo := strings.Replace(jc(c.conteudo), "+55 19 98262-1828", fone, 1)
		if ok, _ := envia(corpo); !ok {
			t.Errorf("deveria reconhecer %s", c.conteudo)
			continue
		}
		if m := motivo("55" + fone); m != c.motivo {
			t.Errorf("%s: motivo %q, esperava %q", c.conteudo, m, c.motivo)
		}
	}
	// negativos: nenhum grava, e todos respondem ok+ignorado
	neg := map[string]string{
		"quero comprar":          jc(`"quero comprar"`),
		"palavra solta":          jc(`"posso parar na loja hoje?"`),
		"sair no meio":           jc(`"quero sair daqui"`),
		"prefixo no meio":        jc(`"eu disse nao quero receber"`),
		"oi":                     jc(`"oi"`),
		"vazio":                  jc(`""`),
		"content null":           jc(`null`),
		"sem content":            `{"event":"message_created","message_type":"incoming","sender":{"phone_number":"11982621828"}}`,
		"conversation_updated":   strings.Replace(optOutMsg(""), "message_created", "conversation_updated", 1),
		"sem event":              strings.Replace(optOutMsg(""), `"event":"message_created",`, "", 1),
		"outgoing":               strings.Replace(optOutMsg(""), "incoming", "outgoing", 1),
		"sem message_type":       strings.Replace(optOutMsg(""), `"message_type":"incoming",`, "", 1),
		"sender vazio":           strings.Replace(optOutMsg(""), `{"phone_number":"+55 19 98262-1828"}`, `{}`, 1),
		"telefone abc":           strings.Replace(optOutMsg(""), "+55 19 98262-1828", "abc", 1),
		"telefone vazio e meta":  strings.Replace(optOutMsg(`,"conversation":{"meta":{"sender":{"phone_number":"19982621828"}}}`), "+55 19 98262-1828", "", 1),
		"palavra extra em parar": jc(`"parar agora"`),
	}
	for nome, corpo := range neg {
		ok, w := envia(corpo)
		if ok {
			t.Errorf("%s: não devia gravar", nome)
		}
		if !strings.Contains(w.Body.String(), `"ignorado":true`) {
			t.Errorf("%s: corpo %s", nome, w.Body)
		}
	}
	// sender sem telefone usa o da conversa
	if ok, _ := envia(strings.Replace(optOutMsg(`,"conversation":{"meta":{"sender":{"phone_number":"19982621828"}}}`), `{"phone_number":"+55 19 98262-1828"}`, `{}`, 1)); !ok || motivo("5519982621828") != "resposta: nao quero receber" {
		t.Error("devia usar o telefone da conversa")
	}
}

func TestChatwootLinhaCompletaDoEvento(t *testing.T) {
	p, h := montarChatwoot(t, segredoCW)
	if w := postCW(h, "/receber-webhook-chatwoot", segredoCW, lead); w.Code != 200 {
		t.Fatal(w.Code)
	}
	var tipo, acc, conv, disp, cid, nome, fone, loja, ia, criado, dia string
	err := p.QueryRow(context.Background(), `select tipo, chatwoot_account_id::text, conversation_id::text, conversation_display_id::text,
		contact_id::text, contact_name, contact_phone_number, loja, classificacao_ia,
		to_char(criado_em_chatwoot at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS'), dia_br::text from chatwoot_eventos`).
		Scan(&tipo, &acc, &conv, &disp, &cid, &nome, &fone, &loja, &ia, &criado, &dia)
	if err != nil {
		t.Fatal(err)
	}
	got := strings.Join([]string{tipo, acc, conv, disp, cid, nome, fone, loja, ia, criado, dia}, "|")
	if want := "qualified_lead|1|555|12|9|Ana|+5511987654321|Tivoli|quente|2026-10-10T01:30:00|2026-10-09"; got != want {
		t.Fatalf("linha %q, esperava %q", got, want)
	}
	// campos ausentes viram NULL, não texto vazio
	postCW(h, "/receber-webhook-chatwoot", segredoCW, `{"tipo":"lead_novo","conversation_id":700}`)
	var nulos int
	p.QueryRow(context.Background(), `select (chatwoot_account_id is null)::int + (conversation_display_id is null)::int + (contact_id is null)::int +
		(contact_name is null)::int + (contact_phone_number is null)::int + (loja is null)::int + (classificacao_ia is null)::int
		from chatwoot_eventos where conversation_id = 700`).Scan(&nulos)
	if nulos != 7 {
		t.Fatalf("esperava 7 NULL, veio %d", nulos)
	}
}

func TestChatwootCreatedAtFalsyEMilissegundos(t *testing.T) {
	p, h := montarChatwoot(t, segredoCW)
	dia := func(id int) string {
		var d string
		p.QueryRow(context.Background(), `select dia_br::text from chatwoot_eventos where conversation_id = $1::bigint`, id).Scan(&d)
		return d
	}
	envia := func(id int, ca string) {
		postCW(h, "/receber-webhook-chatwoot", segredoCW, `{"tipo":"lead_novo","conversation_id":`+strconv.Itoa(id)+`,"created_at":`+ca+`}`)
	}
	envia(1, `0`)
	envia(2, `-5`)
	envia(3, `""`)
	envia(4, `1791595800000`) // 2026-10-10T01:30:00Z em ms: dia 9 em São Paulo
	envia(5, `1791595800`)    // segundos lidos como ms (como o JS): 1970-01-21
	for id, quer := range map[int]string{1: "2026-10-10", 2: "2026-10-10", 3: "2026-10-10", 4: "2026-10-09", 5: "1970-01-21"} {
		if got := dia(id); got != quer {
			t.Errorf("conversa %d: dia %q, esperava %q", id, got, quer)
		}
	}
}

func TestChatwootDadosDepoisDoJSON(t *testing.T) {
	p, h := montarChatwoot(t, segredoCW)
	for _, rota := range []string{"/receber-webhook-chatwoot", "/receber-opt-out-chatwoot"} {
		w := postCW(h, rota, segredoCW, lead+` {"x":1}`)
		if w.Code != 400 || !strings.Contains(w.Body.String(), "corpo_invalido") {
			t.Errorf("%s: %d %s", rota, w.Code, w.Body)
		}
	}
	if n := contar(t, p, `select count(*) from chatwoot_eventos`); n != 0 {
		t.Fatal("corpo inválido não pode gravar")
	}
	if w := postCW(h, "/receber-webhook-chatwoot", segredoCW, lead+"  \n "); w.Code != 200 {
		t.Errorf("espaço em branco depois do JSON é válido: %d", w.Code)
	}
}

func TestChatwootGravaMesmoComRequisicaoCancelada(t *testing.T) {
	p, h := montarChatwoot(t, segredoCW)
	ctx, cancela := context.WithCancel(context.Background())
	cancela() // o Chatwoot desistiu (5 s) e não reenvia: o evento não pode se perder
	req := httptest.NewRequest("POST", "/receber-webhook-chatwoot?token="+segredoCW, strings.NewReader(lead)).WithContext(ctx)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 || contar(t, p, `select count(*) from chatwoot_eventos`) != 1 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

type corpoProibido struct{ t *testing.T }

func (c corpoProibido) Read([]byte) (int, error) {
	c.t.Error("corpo lido antes de validar o segredo")
	return 0, errors.New("proibido")
}

func TestChatwootTokenErradoNaoLeOCorpo(t *testing.T) {
	_, h := montarChatwoot(t, segredoCW)
	for _, rota := range []string{"/receber-webhook-chatwoot", "/receber-opt-out-chatwoot"} {
		req := httptest.NewRequest("POST", rota+"?token=errado", io.NopCloser(corpoProibido{t}))
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != 401 {
			t.Errorf("%s: %d", rota, w.Code)
		}
	}
}
