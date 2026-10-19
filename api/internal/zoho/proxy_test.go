package zoho

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

// Chamar: token recusado (401 ou F7003 no corpo, que o Zoho às vezes manda com 200) renova e repete UMA vez; um status
// de erro do Zoho volta como Resposta (quem chama traduz), não como erro Go; o segredo não aparece no erro.
func TestChamarRenovaTokenEUmaVez(t *testing.T) {
	var tokens, api atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/oauth/v2/token":
			w.Write([]byte(`{"access_token":"TOKEN-` + string(rune('0'+tokens.Add(1))) + `"}`))
		case r.URL.Path == "/mail/x":
			n := api.Add(1)
			switch {
			case n == 1:
				w.WriteHeader(http.StatusUnauthorized)
			case n == 2:
				w.Write([]byte(`{"errors":[{"id":"F7003","title":"Invalid OAuth token."}]}`)) // 200 com token recusado
			default:
				if r.Header.Get("Authorization") != "Zoho-oauthtoken TOKEN-2" || r.Header.Get("Content-Type") != "application/json" {
					t.Errorf("cabeçalhos: %v", r.Header)
				}
				w.WriteHeader(http.StatusTeapot)
				w.Write([]byte(`{"ok":1}`))
			}
		}
	}))
	defer srv.Close()
	p := comConexao(t, "-")
	c := ParaTeste(t, p, srv.URL)
	con, err := c.Conexao(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	// 1ª chamada: 401 -> renova -> o 2º pedido devolve F7003 (já gastou a única repetição) e volta como Resposta
	r, err := c.Chamar(context.Background(), con, Pedido{Metodo: "POST", Servico: Mail, Caminho: "/x", Corpo: []byte(`{"a":1}`)})
	if err != nil || r.Status != 200 || !strings.Contains(string(r.Corpo), "F7003") || tokens.Load() != 2 {
		t.Fatalf("1ª: %+v %v tokens=%d", r, err, tokens.Load())
	}
	// 2ª: o 3º hit do /mail/x passa direto; o status do Zoho (418) volta como Resposta
	r, err = c.Chamar(context.Background(), con, Pedido{Metodo: "POST", Servico: Mail, Caminho: "/x", Corpo: []byte(`{"a":1}`)})
	if err != nil || r.Status != http.StatusTeapot {
		t.Fatalf("2ª: %+v %v", r, err)
	}
	semSegredo(t, c, con, r)
}

func TestChamarSemRespostaNaoVazaSegredoNemURL(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/v2/token" {
			w.Write([]byte(`{"access_token":"TOKEN-1"}`))
			return
		}
		hj, _ := w.(http.Hijacker)
		cn, _, _ := hj.Hijack()
		cn.Close() // cai a conexão no meio do pedido
	}))
	defer srv.Close()
	c := ParaTeste(t, comConexao(t, "-"), srv.URL)
	con, _ := c.Conexao(context.Background())
	_, err := c.Chamar(context.Background(), con, Pedido{Metodo: "GET", Servico: WorkDrive, Caminho: "/files/SEGREDO-NA-URL/links"})
	if err == nil || strings.Contains(err.Error(), "SEGREDO") || strings.Contains(err.Error(), srv.URL) {
		t.Errorf("erro de transporte: %v", err)
	}
}
