package frota

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/webpush/pushteste"
)

const (
	uAprova = "eeeeeeee-0000-0000-0000-0000000000a1"
	uSuper  = "eeeeeeee-0000-0000-0000-0000000000a2"
	uNada   = "eeeeeeee-0000-0000-0000-0000000000a3"
	reqID   = "77777777-0000-0000-0000-000000000001"
)

type ambienteReserva struct {
	p      *pgxpool.Pool
	h      http.Handler
	srv    *pushteste.Servico
	tokens map[string]string
}

func montarReserva(t *testing.T) *ambienteReserva {
	t.Helper()
	pf, srv, p := ambienteFrota(t)
	ctx := context.Background()
	s := auth.NovoStore(p)
	tokens := map[string]string{}
	for _, u := range []struct {
		id, perm string
		super    bool
	}{
		{uAprova, `{"frota.aprovar":["ver"]}`, false}, {uSuper, `{}`, true}, {uNada, `{"frota":["ver"]}`, false},
		{uBarbara, `{}`, false},
	} {
		p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $1::text || '@x')`, u.id)
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, is_superadmin, permissions) values ($1::uuid, $1::text || '@x', 'viewer', $2, $3::jsonb)
			on conflict (id) do update set permissions = excluded.permissions, is_superadmin = excluded.is_superadmin`, u.id, u.super, u.perm); err != nil {
			t.Fatal(err)
		}
		tokens[u.id], _ = s.Criar(ctx, u.id, "painel", nil)
	}
	p.Exec(ctx, `insert into frota_requisicoes (id, veiculo_id, pessoa_id, pessoa_nome, destino, retirada_prevista, situacao, criada_por, motivo_decisao)
		values ($1::uuid, $2::uuid, $3::uuid, 'Barbara', 'Campinas', '2026-10-12T17:05:00Z', 'recusada', $4::uuid, 'carro na oficina')`,
		reqID, vVolvo, pBarbara, uAprova)
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.With(auth.ExigirPermissao("frota.aprovar", "ver")).Post("/avisar-decisao-de-reserva", (&Reserva{Pool: p, VAPID: pf.VAPID, HTTP: srv.HTTP}).ServeHTTP)
	})
	return &ambienteReserva{p: p, h: r, srv: srv, tokens: tokens}
}

func (a *ambienteReserva) post(token, corpo string) (int, map[string]any) {
	req := httptest.NewRequest("POST", "/avisar-decisao-de-reserva", strings.NewReader(corpo))
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	a.h.ServeHTTP(w, req)
	var m map[string]any
	json.Unmarshal(w.Body.Bytes(), &m)
	return w.Code, m
}

func TestReservaPortao(t *testing.T) {
	a := montarReserva(t)
	corpo := `{"requisicaoId":"` + reqID + `"}`
	if c, _ := a.post("", corpo); c != 401 {
		t.Fatalf("sem sessão: %d", c)
	}
	if c, _ := a.post(a.tokens[uNada], corpo); c != 403 {
		t.Fatalf("sem frota.aprovar: %d", c)
	}
	if c, _ := a.post(a.tokens[uBarbara], corpo); c != 403 {
		t.Fatalf("quem pediu não decide: %d", c)
	}
	for _, u := range []string{uAprova, uSuper} {
		if c, m := a.post(a.tokens[u], corpo); c != 200 || m["ok"] != true {
			t.Fatalf("%s: %d %v", u, c, m)
		}
	}
}

func TestReservaAvisaQuemPediuUmaVezSo(t *testing.T) {
	a := montarReserva(t)
	ua := pushteste.Inscrever(t, a.p, "barbara", uBarbara)
	ligarAviso(t, a.p, "frota_reserva", uBarbara)
	corpo := `{"requisicaoId":"` + reqID + `"}`
	c, m := a.post(a.tokens[uAprova], corpo)
	if c != 200 || m["enviados"] != 1.0 || m["situacao"] != "recusada" {
		t.Fatalf("%d %v", c, m)
	}
	var aviso map[string]string
	json.Unmarshal(pushteste.Decifrar(t, a.srv.Ultimo(t, "barbara"), ua), &aviso)
	if aviso["titulo"] != "Reserva recusada" || aviso["corpo"] != "Volvo · 12/10 às 14:05 — carro na oficina" {
		t.Fatalf("o texto sai do que está gravado: %v", aviso)
	}
	// Tag própria POR RESERVA (nunca vazia nem 'vendas-do-dia': o service worker a usa quando falta e o card
	// das vendas seria substituído); o texto e a url seguem como na edge; title/body são o que o sw-push.js lê.
	if aviso["tag"] != "reserva-"+reqID || aviso["url"] != "/frota" || aviso["title"] != aviso["titulo"] || aviso["body"] != aviso["corpo"] {
		t.Fatalf("tag/url/title/body: %v", aviso)
	}
	var chave string
	a.p.QueryRow(context.Background(), `select chave from envios_feitos`).Scan(&chave)
	if !strings.HasPrefix(chave, "avisar-decisao-de-reserva:"+reqID+":recusada:") {
		t.Fatalf("livro: %q", chave)
	}
	// Clique duplo: a pessoa já foi avisada; não recebe de novo e o front continua vendo "avisei".
	if c, m := a.post(a.tokens[uAprova], corpo); c != 200 || m["enviados"] != 1.0 || a.srv.Total() != 1 {
		t.Fatalf("%d %v total=%d", c, m, a.srv.Total())
	}
}

func TestReservaRespostasDaEdge(t *testing.T) {
	a := montarReserva(t)
	tok := a.tokens[uAprova]
	if c, m := a.post(tok, `{}`); c != 400 || m["erro"] != "sem_requisicao" {
		t.Fatalf("%d %v", c, m)
	}
	if c, m := a.post(tok, `{"requisicaoId":"nao-e-uuid"}`); c != 404 || m["erro"] != "requisicao_nao_encontrada" {
		t.Fatalf("%d %v", c, m)
	}
	if c, m := a.post(tok, `{"requisicaoId":"`+reqID+`"}`); c != 200 || m["motivo"] != "sem_aparelho_ou_aviso_desligado" || m["enviados"] != 0.0 {
		t.Fatalf("Barbara sem aparelho: %d %v", c, m)
	}
	a.p.Exec(context.Background(), `update frota_requisicoes set pessoa_id = null, criada_por = $1::uuid`, uAprova)
	if c, m := a.post(tok, `{"requisicaoId":"`+reqID+`"}`); c != 200 || m["motivo"] != "decidiu_a_propria" {
		t.Fatalf("%d %v", c, m)
	}
	a.p.Exec(context.Background(), `update frota_requisicoes set criada_por = null`)
	if c, m := a.post(tok, `{"requisicaoId":"`+reqID+`"}`); c != 200 || m["motivo"] != "quem_pediu_nao_tem_login" || m["pessoa"] != "Barbara" {
		t.Fatalf("%d %v", c, m)
	}
	a.p.Exec(context.Background(), `update frota_requisicoes set situacao = 'pendente'`)
	if c, m := a.post(tok, `{"requisicaoId":"`+reqID+`"}`); c != 200 || m["motivo"] != "situacao_nao_avisavel" {
		t.Fatalf("%d %v", c, m)
	}
}

// Mudou a situação (recusada, depois revogada) = outro aviso, que SUBSTITUI o card anterior (mesma tag).
func TestReservaNovaSituacaoAvisaDeNovo(t *testing.T) {
	a := montarReserva(t)
	ua := pushteste.Inscrever(t, a.p, "barbara", uBarbara)
	ligarAviso(t, a.p, "frota_reserva", uBarbara)
	corpo := `{"requisicaoId":"` + reqID + `"}`
	a.post(a.tokens[uAprova], corpo)
	a.p.Exec(context.Background(), `update frota_requisicoes set situacao = 'revogada', encerrada_motivo = 'carro na oficina'`)
	if c, m := a.post(a.tokens[uAprova], corpo); c != 200 || m["enviados"] != 1.0 || m["situacao"] != "revogada" || a.srv.Total() != 2 {
		t.Fatalf("%d %v total=%d", c, m, a.srv.Total())
	}
	var aviso map[string]string
	json.Unmarshal(pushteste.Decifrar(t, a.srv.Ultimo(t, "barbara"), ua), &aviso)
	if aviso["titulo"] != "A sua reserva foi encerrada" || aviso["tag"] != "reserva-"+reqID {
		t.Fatalf("%v", aviso)
	}
}

// Clique duplo de verdade (pedidos ao mesmo tempo): um push só.
func TestReservaCliqueDuploSimultaneoUmPushSo(t *testing.T) {
	a := montarReserva(t)
	pushteste.Inscrever(t, a.p, "barbara", uBarbara)
	ligarAviso(t, a.p, "frota_reserva", uBarbara)
	corpo := `{"requisicaoId":"` + reqID + `"}`
	var wg sync.WaitGroup
	for range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if c, _ := a.post(a.tokens[uAprova], corpo); c != 200 {
				t.Errorf("status %d", c)
			}
		}()
	}
	wg.Wait()
	if a.srv.Total() != 1 {
		t.Fatalf("%d pushes para o mesmo aparelho", a.srv.Total())
	}
}

// Ruling 14 do plano: o serviço de push recusou (5xx, ambíguo) = a reserva do livro é desfeita e o próximo
// clique tenta de novo; a resposta não diz "avisei" e nada do aparelho aparece no log.
func TestReservaRecusaDoPushLiberaOLivro(t *testing.T) {
	var log bytes.Buffer
	anterior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	defer slog.SetDefault(anterior)
	a := montarReserva(t)
	pushteste.Inscrever(t, a.p, "e500", uBarbara)
	ligarAviso(t, a.p, "frota_reserva", uBarbara)
	for i := 1; i <= 2; i++ {
		c, m := a.post(a.tokens[uAprova], `{"requisicaoId":"`+reqID+`"}`)
		var n int
		a.p.QueryRow(context.Background(), `select count(*) from envios_feitos`).Scan(&n)
		if c != 200 || m["enviados"] != 0.0 || m["falhas"] != 1.0 || n != 0 || a.srv.Recebidos("e500") != i {
			t.Fatalf("clique %d: %d %v reservas=%d tentativas=%d", i, c, m, n, a.srv.Recebidos("e500"))
		}
	}
	if strings.Contains(log.String(), "example.com/push") {
		t.Fatalf("o endpoint foi ao log: %s", log.String())
	}
}

func TestReservaVAPIDInvalidoDa500SemVazarChave(t *testing.T) {
	var log bytes.Buffer
	anterior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	defer slog.SetDefault(anterior)
	a := montarReserva(t)
	pushteste.Inscrever(t, a.p, "barbara", uBarbara)
	ligarAviso(t, a.p, "frota_reserva", uBarbara)
	v := pushteste.VAPID(t)
	v.Publica = "lixo"
	r := chi.NewRouter()
	r.Use(auth.Exigir(a.p, auth.NovoStore(a.p)))
	r.Post("/avisar-decisao-de-reserva", (&Reserva{Pool: a.p, VAPID: v, HTTP: a.srv.HTTP}).ServeHTTP)
	req := httptest.NewRequest("POST", "/avisar-decisao-de-reserva", strings.NewReader(`{"requisicaoId":"`+reqID+`"}`))
	req.Header.Set("Authorization", "Bearer "+a.tokens[uAprova])
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	var m map[string]any
	json.Unmarshal(w.Body.Bytes(), &m)
	if w.Code != 500 || m["erro"] != "vapid_nao_configurado" || a.srv.Total() != 0 {
		t.Fatalf("%d %v", w.Code, m)
	}
	for _, s := range []string{w.Body.String(), log.String()} {
		if strings.Contains(s, v.Privada) || strings.Contains(s, "example.com/push") {
			t.Fatalf("vazou segredo: %s", s)
		}
	}
}

// O corpo é SÓ o id: título, texto, tag, url ou destino mandados pelo cliente são ignorados (push arbitrário).
func TestReservaIgnoraTextoDoCliente(t *testing.T) {
	a := montarReserva(t)
	ua := pushteste.Inscrever(t, a.p, "barbara", uBarbara)
	ligarAviso(t, a.p, "frota_reserva", uBarbara)
	pushteste.Inscrever(t, a.p, "outro", uAprova) // o corpo tentando apontar outro destino
	ligarAviso(t, a.p, "frota_reserva", uAprova)
	a.post(a.tokens[uAprova], `{"requisicaoId":"`+reqID+`","titulo":"HACK","corpo":"HACK","title":"HACK","body":"HACK","tag":"vendas-do-dia","userId":"`+uAprova+`","url":"https://evil.example"}`)
	var aviso map[string]string
	json.Unmarshal(pushteste.Decifrar(t, a.srv.Ultimo(t, "barbara"), ua), &aviso)
	if aviso["titulo"] != "Reserva recusada" || aviso["tag"] != "reserva-"+reqID || aviso["url"] != "/frota" || a.srv.Recebidos("outro") != 0 {
		t.Fatalf("%v", aviso)
	}
}
