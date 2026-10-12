package email

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

const tokenDeTeste = "segredo-zepto-123456"

func TestMandarMontaOPedidoDoZeptoMail(t *testing.T) {
	var cab http.Header
	var corpo map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cab = r.Header.Clone()
		json.NewDecoder(r.Body).Decode(&corpo)
		w.WriteHeader(201)
	}))
	defer srv.Close()
	for _, tok := range []string{tokenDeTeste, "Zoho-enczapikey " + tokenDeTeste} {
		z := &ZeptoMail{URL: srv.URL, Token: tok, De: "nao-responda@x", Nome: "Central"}
		if err := z.Mandar(context.Background(), "pessoa@x", "Assunto", "<p>oi</p>", "oi"); err != nil {
			t.Fatal(err)
		}
		if cab.Get("Authorization") != "Zoho-enczapikey "+tokenDeTeste {
			t.Fatalf("Authorization = %q", cab.Get("Authorization"))
		}
	}
	de, _ := corpo["from"].(map[string]any)
	para, _ := corpo["to"].([]any)
	if de["address"] != "nao-responda@x" || de["name"] != "Central" || corpo["subject"] != "Assunto" ||
		corpo["htmlbody"] != "<p>oi</p>" || corpo["textbody"] != "oi" || len(para) != 1 ||
		para[0].(map[string]any)["email_address"].(map[string]any)["address"] != "pessoa@x" {
		t.Fatalf("corpo = %v", corpo)
	}
}

// Recusa, redirecionamento e rede fora viram erro sem token, sem destinatário e sem o texto.
func TestMandarFalhaSemVazar(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/recusa":
			w.WriteHeader(401)
			w.Write([]byte(`{"error":{"code":"TM_3201","message":"token ` + tokenDeTeste + ` inválido"}}`))
		case "/redireciona":
			http.Redirect(w, r, "https://outro.exemplo/roubar", http.StatusTemporaryRedirect)
		}
	}))
	defer srv.Close()
	for caminho, quer := range map[string]string{"/recusa": "zeptomail: recusou (401 TM_3201)", "/redireciona": "zeptomail: recusou (307 )"} {
		z := &ZeptoMail{URL: srv.URL + caminho, Token: tokenDeTeste}
		err := z.Mandar(context.Background(), "pessoa@x", "a", "link-secreto", "link-secreto")
		if err == nil || err.Error() != quer {
			t.Errorf("%s: %v", caminho, err)
		}
	}
	z := &ZeptoMail{URL: "http://127.0.0.1:1/" + tokenDeTeste, Token: tokenDeTeste}
	err := z.Mandar(context.Background(), "pessoa@x", "a", "b", "c")
	if err == nil || strings.Contains(err.Error(), tokenDeTeste) || strings.Contains(err.Error(), "127.0.0.1") {
		t.Fatalf("rede fora: %v", err)
	}
	if err := (&ZeptoMail{}).Mandar(context.Background(), "a", "b", "c", "d"); err != ErrSemToken {
		t.Fatalf("sem token: %v", err)
	}
}

// Cliente injetado também não segue redirecionamento (o corpo leva o link de senha e o cabeçalho, o token).
func TestMandarNaoSegueRedirecionamentoNemComClienteInjetado(t *testing.T) {
	var visitas atomic.Int32
	alvo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { visitas.Add(1) }))
	defer alvo.Close()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, alvo.URL, http.StatusTemporaryRedirect)
	}))
	defer srv.Close()
	z := &ZeptoMail{URL: srv.URL, Token: tokenDeTeste, HTTP: &http.Client{}}
	if err := z.Mandar(context.Background(), "pessoa@x", "a", "b", "c"); err == nil || err.Error() != "zeptomail: recusou (307 )" {
		t.Fatalf("err = %v", err)
	}
	if visitas.Load() != 0 {
		t.Fatal("seguiu o redirecionamento")
	}
}

// Servidor lento: o envio desiste (15 s em produção), com cliente próprio ou injetado sem prazo.
func TestMandarTemPrazo(t *testing.T) {
	prazoAntes := prazoDoEnvio
	prazoDoEnvio = 150 * time.Millisecond
	defer func() { prazoDoEnvio = prazoAntes }()
	fim := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		select {
		case <-fim:
		case <-time.After(5 * time.Second):
		}
	}))
	defer srv.Close()
	defer close(fim)
	for nome, cli := range map[string]*http.Client{"próprio": nil, "injetado": {}} {
		t0 := time.Now()
		err := (&ZeptoMail{URL: srv.URL, Token: tokenDeTeste, HTTP: cli}).Mandar(context.Background(), "pessoa@x", "a", "b", "c")
		if err == nil || err.Error() != "zeptomail: rede" || time.Since(t0) > 2*time.Second {
			t.Errorf("%s: err = %v em %v", nome, err, time.Since(t0))
		}
	}
}
