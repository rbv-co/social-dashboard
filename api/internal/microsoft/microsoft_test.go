package microsoft

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func comConexao(t *testing.T, refresh string) (*testing.T, *Cliente, *httptest.Server, *atomic.Int32) {
	t.Helper()
	var tokens atomic.Int32
	var graph atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/token":
			r.ParseForm()
			if r.Form.Get("refresh_token") != "SEGREDO-REFRESH" || r.Form.Get("client_secret") != "SEGREDO-CLIENTE" {
				w.WriteHeader(400)
				return
			}
			fmt.Fprintf(w, `{"access_token":"TOKEN-%d"}`, tokens.Add(1))
		case r.URL.Path == "/graph/me/drive/root/children":
			if graph.Add(1) == 1 { // o primeiro token "venceu": 401, renova e repete
				w.WriteHeader(401)
				return
			}
			w.Write([]byte(`{"value":[]}`))
		case r.URL.Path == "/graph/texto":
			w.Write([]byte("<html>não é json</html>"))
		case r.URL.Path == "/graph/vazio":
			w.WriteHeader(204)
		}
	}))
	t.Cleanup(srv.Close)
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), `create table if not exists acessos_conexoes (provedor text primary key, client_id text, client_secret text,
	  refresh_token text, org_id text, data_center text default '.com', escopos text, conectado_por uuid, conectado_em timestamptz,
	  atualizado_em timestamptz not null default now(), oauth_state text, oauth_state_em timestamptz)`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(context.Background(), `insert into acessos_conexoes (provedor, client_id, client_secret, refresh_token) values ('microsoft', 'ID', 'SEGREDO-CLIENTE', nullif($1, ''))`, refresh); err != nil {
		t.Fatal(err)
	}
	return t, ParaTeste(t, p, srv.URL), srv, &tokens
}

func TestGrafoRenovaTokenEDevolveStatusSemErro(t *testing.T) {
	_, c, _, tokens := comConexao(t, "SEGREDO-REFRESH")
	r, err := c.Grafo(context.Background(), "GET", "/me/drive/root/children", nil)
	if err != nil || !r.OK() || tokens.Load() != 2 {
		t.Fatalf("%+v %v tokens=%d", r, err, tokens.Load())
	}
	if r, err := c.Grafo(context.Background(), "GET", "/texto", nil); err != nil || !strings.Contains(string(r.Corpo), `"raw"`) {
		t.Errorf("corpo que não é JSON deve virar {raw}: %+v %v", r, err)
	}
	if r, err := c.Grafo(context.Background(), "DELETE", "/vazio", nil); err != nil || r.Status != 204 || len(r.Corpo) != 0 {
		t.Errorf("204: %+v %v", r, err)
	}
	for _, v := range []string{fmt.Sprintf("%v", c), fmt.Sprintf("%+v", c), fmt.Sprintf("%#v", c)} {
		if strings.Contains(v, "TOKEN-") || strings.Contains(v, "SEGREDO") {
			t.Errorf("o cliente mostra segredo: %s", v)
		}
	}
}

func TestGrafoSemRefreshTokenEhDesconectado(t *testing.T) {
	_, c, _, tokens := comConexao(t, "")
	if _, err := c.Grafo(context.Background(), "GET", "/me/drive/root/children", nil); err != ErrDesconectado || tokens.Load() != 0 {
		t.Errorf("%v tokens=%d", err, tokens.Load())
	}
}

func TestGrafoFalhaDoTokenNaoVazaSegredo(t *testing.T) {
	_, c, _, _ := comConexao(t, "SEGREDO-REFRESH")
	c.urlToken = c.urlToken + "-quebrado" // o login responde 404
	_, err := c.Grafo(context.Background(), "GET", "/me/drive/root/children", nil)
	if err == nil || strings.Contains(err.Error(), "SEGREDO") || strings.Contains(err.Error(), "127.0.0.1") {
		t.Errorf("erro do token: %v", err)
	}
}
