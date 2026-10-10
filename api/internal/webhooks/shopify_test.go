package webhooks

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const segredoAdmin, segredoApp = "segredo-admin-shopify", "segredo-app-shopify"

// Tabelas e funções SQL de produção que os receptores tocam. As funções do abandono são
// dublês que registram a chamada em `chamadas` (o corpo real fica no banco restaurado).
const esquemaShopify = `
create table shopify_pedidos (id bigint primary key, numero text, loja_id bigint not null, total numeric(12,2) not null,
  moeda text not null, status_financeiro text not null, cliente_nome text, cliente_email text,
  criado_em_shopify timestamptz not null, bruto jsonb not null, atualizado_em timestamptz not null default now());
create table carrinho_eventos (id bigint generated always as identity primary key, cart_token text not null,
  tipo text not null, evento_shopify_id text, criado_em timestamptz not null default now());
create unique index carrinho_eventos_evento_shopify_id_uidx on carrinho_eventos (evento_shopify_id) where evento_shopify_id is not null;
create table chamadas (id serial, nome text, args text);
create function registrar_checkout_abandono(p_token text, p_email text, p_telefone text, p_nome text, p_total numeric, p_moeda text, p_url text)
  returns void language plpgsql as $$ begin
    if p_token = 'explode' then raise exception 'falha simulada'; end if;
    insert into chamadas (nome, args) values ('registrar', concat_ws('|', p_token, p_email, p_telefone, p_nome, p_total, p_moeda, p_url)); end $$;
create function marcar_checkout_comprou(p_token text) returns void language sql as $$ insert into chamadas (nome, args) values ('comprou-antiga', p_token) $$;
create function marcar_checkout_comprou(p_token text, p_email text default null, p_telefone text default null) returns void language sql
  as $$ insert into chamadas (nome, args) values ('comprou', concat_ws('|', coalesce(p_token, '-'), p_email, p_telefone)) $$;
create function marcar_checkout_pagamento_pendente(p_token text) returns void language sql as $$ insert into chamadas (nome, args) values ('pendente', p_token) $$;
create function reabrir_checkout_abandono(p_token text) returns void language sql as $$ insert into chamadas (nome, args) values ('reabrir', p_token) $$;
create function registrar_pedido_para_mensagem(p_pedido_id bigint, p_numero text, p_nome text, p_telefone text, p_criado_em timestamptz)
  returns void language sql as $$ insert into chamadas (nome, args) values ('pedido', concat_ws('|', p_pedido_id, p_numero, p_nome, p_telefone, p_criado_em is not null)) $$;
create function cancelar_mensagem_pedido(p_pedido_id bigint) returns void language sql as $$ insert into chamadas (nome, args) values ('cancelar', p_pedido_id::text) $$;`

func assinar(segredo, corpo string) string {
	m := hmac.New(sha256.New, []byte(segredo))
	m.Write([]byte(corpo))
	return base64.StdEncoding.EncodeToString(m.Sum(nil))
}

func montarShopify(t *testing.T, segredos ...string) (*pgxpool.Pool, http.Handler) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), esquemaShopify); err != nil {
		t.Fatal(err)
	}
	s := &Shopify{Pool: p, Segredos: segredos}
	r := chi.NewRouter()
	r.HandleFunc("/receber-webhook-pedido-shopify", s.Pedido)
	r.HandleFunc("/receber-webhook-checkout", s.Checkout)
	r.HandleFunc("/receber-webhook-abandono", s.Abandono)
	return p, r
}

func enviar(h http.Handler, caminho, corpo, assinatura, topico, evento string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("POST", caminho, strings.NewReader(corpo))
	if assinatura != "" {
		req.Header.Set("X-Shopify-Hmac-Sha256", assinatura)
	}
	if topico != "" {
		req.Header.Set("X-Shopify-Topic", topico)
	}
	if evento != "" {
		req.Header.Set("X-Shopify-Event-Id", evento)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func contar(t *testing.T, p *pgxpool.Pool, sql string) int {
	t.Helper()
	var n int
	if err := p.QueryRow(context.Background(), sql).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

const pedido = `{"id":7001,"name":"#1042","total_price":"199.90","currency":"BRL","financial_status":"paid","created_at":"2026-10-09T10:00:00-03:00","customer":{"first_name":"Ana","last_name":"Lima","email":"ana@x.com"}}`

func TestShopifyAssinatura(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin, segredoApp)
	casos := []struct {
		nome, assinatura string
		quer             int
	}{
		{"sem assinatura", "", 401},
		{"assinatura errada", assinar("outro", pedido), 401},
		{"assinatura de outro corpo", assinar(segredoAdmin, pedido+" "), 401},
		{"base64 inválido", "%%%não-é-base64", 401},
		{"segredo do admin", assinar(segredoAdmin, pedido), 200},
		{"segredo do app (webhook criado por API) e espaços nas pontas", " " + assinar(segredoApp, pedido) + " ", 200},
	}
	for _, c := range casos {
		if w := enviar(h, "/receber-webhook-pedido-shopify", pedido, c.assinatura, "orders/paid", ""); w.Code != c.quer {
			t.Errorf("%s: %d %s", c.nome, w.Code, w.Body)
		}
	}
	if n := contar(t, p, `select count(*) from shopify_pedidos`); n != 1 {
		t.Fatalf("linhas = %d", n)
	}
	_, semSegredo := montarShopify(t)
	if w := enviar(semSegredo, "/receber-webhook-pedido-shopify", pedido, assinar("", pedido), "", ""); w.Code != 401 {
		t.Fatalf("sem segredo configurado nada passa: %d", w.Code)
	}
	req := httptest.NewRequest("GET", "/receber-webhook-checkout", nil)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 405 {
		t.Fatalf("GET = %d", w.Code)
	}
}

func TestShopifyCorpoGrandeEJSONInvalido(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin)
	grande := `{"id":1,"x":"` + strings.Repeat("a", limiteShopify) + `"}`
	if w := enviar(h, "/receber-webhook-pedido-shopify", grande, assinar(segredoAdmin, grande), "", ""); w.Code != 413 {
		t.Fatalf("corpo grande = %d", w.Code)
	}
	if w := enviar(h, "/receber-webhook-checkout", "não é json", assinar(segredoAdmin, "não é json"), "", "e1"); w.Code != 200 || !strings.Contains(w.Body.String(), "json_invalido") {
		t.Fatalf("json inválido = %d %s", w.Code, w.Body)
	}
	if n := contar(t, p, `select count(*) from webhooks_recebidos`); n != 0 {
		t.Fatal("JSON inválido não deixa marca")
	}
}

func TestShopifyPedidoUpsertEReplay(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin)
	if w := enviar(h, "/receber-webhook-pedido-shopify", pedido, assinar(segredoAdmin, pedido), "orders/paid", "ev-1"); w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	var numero, nome, email, status string
	var total float64
	p.QueryRow(context.Background(), `select numero, cliente_nome, cliente_email, status_financeiro, total::float8 from shopify_pedidos where id = 7001`).Scan(&numero, &nome, &email, &status, &total)
	if numero != "#1042" || nome != "Ana Lima" || email != "ana@x.com" || status != "paid" || total != 199.9 {
		t.Fatalf("linha = %q %q %q %q %v", numero, nome, email, status, total)
	}
	// Replay do MESMO evento com corpo diferente: não regrava.
	outro := strings.Replace(pedido, `"199.90"`, `"1.00"`, 1)
	if w := enviar(h, "/receber-webhook-pedido-shopify", outro, assinar(segredoAdmin, outro), "orders/paid", "ev-1"); !strings.Contains(w.Body.String(), "duplicado") {
		t.Fatalf("replay = %s", w.Body)
	}
	p.QueryRow(context.Background(), `select total::float8 from shopify_pedidos where id = 7001`).Scan(&total)
	if total != 199.9 {
		t.Fatalf("replay regravou: %v", total)
	}
	// Sem Event-Id: processa, e o upsert por id é idempotente (uma linha só).
	enviar(h, "/receber-webhook-pedido-shopify", outro, assinar(segredoAdmin, outro), "orders/updated", "")
	if n := contar(t, p, `select count(*) from shopify_pedidos`); n != 1 {
		t.Fatalf("linhas = %d", n)
	}
	sem := `{"id":1}`
	if w := enviar(h, "/receber-webhook-pedido-shopify", sem, assinar(segredoAdmin, sem), "", ""); !strings.Contains(w.Body.String(), "ignorado") {
		t.Fatalf("sem created_at = %s", w.Body)
	}
}

func TestShopifyCheckout(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin)
	c := `{"cart_token":" abc ","email":"nao@grava.com"}`
	enviar(h, "/receber-webhook-checkout", c, assinar(segredoAdmin, c), "checkouts/create", "ev-9")
	enviar(h, "/receber-webhook-checkout", c, assinar(segredoAdmin, c), "checkouts/create", "ev-9")
	var token, ev string
	p.QueryRow(context.Background(), `select cart_token, evento_shopify_id from carrinho_eventos`).Scan(&token, &ev)
	if n := contar(t, p, `select count(*) from carrinho_eventos`); n != 1 || token != "abc" || ev != "ev-9" {
		t.Fatalf("n=%d token=%q ev=%q", n, token, ev)
	}
	sem := `{"email":"x@x.com"}`
	if w := enviar(h, "/receber-webhook-checkout", sem, assinar(segredoAdmin, sem), "checkouts/create", "ev-10"); !strings.Contains(w.Body.String(), "sem_cart_token") {
		t.Fatalf("sem cart_token = %s", w.Body)
	}
}

func TestShopifyAbandono(t *testing.T) {
	p, h := montarShopify(t, segredoAdmin)
	casos := []struct {
		topico, corpo string
		quer          []string
	}{
		{"checkouts/create", `{"token":"t1","email":"a@x.com","total_price":"99.5","currency":"BRL","abandoned_checkout_url":"https://loja/r","shipping_address":{"first_name":"Luis","last_name":"Fulano","phone":"+55 11 98765-4321"},"customer":{"phone":"999"}}`,
			[]string{"registrar:t1|a@x.com|+55 11 98765-4321|Luis Fulano|99.5|BRL|https://loja/r"}},
		{"checkouts/update", `{"token":"t2","completed_at":"2026-10-09"}`, nil},
		{"orders/paid", `{"id":1,"checkout_token":"t1","email":"a@x.com"}`, []string{"comprou:t1|a@x.com"}},
		{"orders/create", `{"id":5,"name":"#9","checkout_token":"t3","financial_status":"pending","source_name":"web","phone":"11999990000","created_at":"2026-10-09T10:00:00Z","billing_address":{"first_name":"Bia"}}`,
			[]string{"pendente:t3", "pedido:5|#9|Bia|11999990000|t"}},
		{"orders/create", `{"id":6,"financial_status":"paid","source_name":"pos","phone":"11999990000"}`, []string{"comprou:-|11999990000"}},
		{"orders/cancelled", `{"id":5,"checkout_token":"t3"}`, []string{"reabrir:t3", "cancelar:5"}},
		{"customers/create", `{"id":1}`, nil},
	}
	for i, c := range casos {
		p.Exec(context.Background(), `delete from chamadas`)
		w := enviar(h, "/receber-webhook-abandono", c.corpo, assinar(segredoAdmin, c.corpo), c.topico, "")
		linhas, _ := p.Query(context.Background(), `select nome || ':' || coalesce(args, '') from chamadas order by id`)
		var got []string
		for linhas.Next() {
			var s string
			linhas.Scan(&s)
			got = append(got, s)
		}
		if w.Code != 200 || strings.Join(got, ",") != strings.Join(c.quer, ",") {
			t.Errorf("caso %d (%s): %d %s chamadas=%v", i, c.topico, w.Code, w.Body, got)
		}
	}
}

func TestShopifyFalhaDeBancoDevolve500ESemMarca(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	p, h := montarShopify(t, segredoAdmin)
	c := `{"token":"explode","email":"a@x.com"}`
	if w := enviar(h, "/receber-webhook-abandono", c, assinar(segredoAdmin, c), "checkouts/create", "ev-x"); w.Code != 500 {
		t.Fatalf("falha = %d", w.Code)
	}
	if n := contar(t, p, `select count(*) from webhooks_recebidos`); n != 0 {
		t.Fatal("a marca de recebido tem de sumir junto com o efeito que falhou")
	}
	// O banco voltou: a reentrega do MESMO evento é processada (não é tratada como duplicada).
	p.Exec(context.Background(), `create or replace function registrar_checkout_abandono(p_token text, p_email text, p_telefone text, p_nome text, p_total numeric, p_moeda text, p_url text)
		returns void language sql as $$ insert into chamadas (nome, args) values ('registrar', p_token) $$`)
	if w := enviar(h, "/receber-webhook-abandono", c, assinar(segredoAdmin, c), "checkouts/create", "ev-x"); w.Code != 200 || strings.Contains(w.Body.String(), "duplicado") {
		t.Fatalf("reentrega = %d %s", w.Code, w.Body)
	}
	if strings.Contains(log.String(), segredoAdmin) || !strings.Contains(log.String(), "falha ao gravar") {
		t.Fatalf("log = %s", log.String())
	}
}
