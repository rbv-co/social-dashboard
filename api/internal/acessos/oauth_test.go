package acessos

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/microsoft"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/zoho"
)

// provedorDeMentira responde ao /oauth/v2/token do Zoho e ao /token da Microsoft e guarda os formulários recebidos.
type provedorDeMentira struct {
	mu          sync.Mutex
	formularios []url.Values
	semRefresh  bool
	recusa      bool
}

func (p *provedorDeMentira) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b, _ := io.ReadAll(r.Body)
	f, _ := url.ParseQuery(string(b))
	p.mu.Lock()
	p.formularios = append(p.formularios, f)
	p.mu.Unlock()
	w.Header().Set("Content-Type", "application/json")
	switch {
	case p.recusa:
		w.WriteHeader(400)
		w.Write([]byte(`{"error":"invalid_grant"}`))
	case r.URL.Path == "/mail/api/organization":
		w.Write([]byte(`{"data":{"zoid":55512}}`))
	case p.semRefresh:
		w.Write([]byte(`{"access_token":"acesso-novo"}`))
	default:
		w.Write([]byte(`{"access_token":"acesso-novo","refresh_token":"refresh-novo"}`))
	}
}

func TestOAuthRetorno(t *testing.T) {
	pg := testebanco.ComEsquemaDeProducao(t)
	prov := &provedorDeMentira{}
	srv := httptest.NewServer(prov)
	defer srv.Close()
	ctx := context.Background()
	reset := func() {
		if _, err := pg.Exec(ctx, `delete from acessos_conexoes;
			insert into acessos_conexoes (provedor, client_id, client_secret, refresh_token, oauth_state, oauth_state_em) values
			('zoho', 'cli-zoho', 'seg-z', 'refresh-velho-z', 'estado-z', now()),
			('microsoft', 'cli-ms', 'seg-m', 'refresh-velho-m', 'estado-m', now())`); err != nil {
			t.Fatal(err)
		}
		prov.formularios, prov.semRefresh, prov.recusa = nil, false, false
	}
	um := func(sql string) string {
		var v *string
		if err := pg.QueryRow(ctx, sql).Scan(&v); err != nil {
			t.Fatal(err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}
	r := chi.NewRouter()
	(&OAuth{Zoho: zoho.ParaTeste(t, pg, srv.URL), MS: microsoft.ParaTeste(t, pg, srv.URL), APIPublica: "https://api.test", Retorno: "https://app.test/"}).Montar(r)
	vai := func(caminho string) (int, string, http.Header) {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("GET", caminho, nil))
		return w.Code, w.Header().Get("Location"), w.Header()
	}

	// Zoho: caminho feliz grava o refresh_token e o zoid, apaga o state e volta com ?zoho=ok
	reset()
	st, loc, cab := vai("/acessos-oauth/callback/zoho?code=C1&state=estado-z")
	if st != 302 || loc != "https://app.test/?zoho=ok" {
		t.Fatalf("zoho feliz: %d %s", st, loc)
	}
	if cab.Get("Cache-Control") != "no-store" || cab.Get("Referrer-Policy") != "no-referrer" {
		t.Errorf("cabeçalhos do retorno: %v", cab)
	}
	if v := um(`select refresh_token || '|' || org_id || '|' || coalesce(oauth_state, '<nulo>') from acessos_conexoes where provedor = 'zoho'`); v != "refresh-novo|55512|<nulo>" {
		t.Errorf("conexão do Zoho: %s", v)
	}
	if f := prov.formularios[0]; f.Get("grant_type") != "authorization_code" || f.Get("code") != "C1" || f.Get("redirect_uri") != "https://api.test/acessos-oauth/callback/zoho" || f.Get("client_secret") != "seg-z" {
		t.Errorf("troca do code: %v", f)
	}
	// repetir o mesmo retorno (state já usado) NÃO reconecta
	if st, loc, _ := vai("/acessos-oauth/callback/zoho?code=C1&state=estado-z"); st != 302 || loc != "https://app.test/?msg=state_invalido&zoho=erro" {
		t.Errorf("repetição: %d %s", st, loc)
	}
	if n := len(prov.formularios); n != 2 { // 1 troca + 1 zoid; a repetição nem chegou ao provedor
		t.Errorf("a repetição chamou o provedor: %d", n)
	}

	// Microsoft
	reset()
	st, loc, _ = vai("/acessos-oauth/callback/microsoft?code=C2&state=estado-m")
	if st != 302 || loc != "https://app.test/?onedrive=ok" {
		t.Fatalf("microsoft feliz: %d %s", st, loc)
	}
	if v := um(`select refresh_token || '|' || coalesce(oauth_state, '<nulo>') from acessos_conexoes where provedor = 'microsoft'`); v != "refresh-novo|<nulo>" {
		t.Errorf("conexão da Microsoft: %s", v)
	}
	if f := prov.formularios[0]; f.Get("redirect_uri") != "https://api.test/acessos-oauth/callback/microsoft" || f.Get("scope") != "Files.ReadWrite offline_access User.Read" {
		t.Errorf("troca do code (MS): %v", f)
	}
	// o state de um provedor não vale no outro
	reset()
	if _, loc, _ := vai("/acessos-oauth/callback/microsoft?code=C&state=estado-z"); loc != "https://app.test/?msg=state_invalido&onedrive=erro" {
		t.Errorf("state do outro provedor: %s", loc)
	}

	// falhas: cada uma volta com o motivo e NÃO mexe na conexão que já existia
	reset()
	for caminho, quer := range map[string]string{
		"/acessos-oauth/callback/zoho?state=estado-z":               "?msg=sem_code&zoho=erro",
		"/acessos-oauth/callback/zoho?code=C":                       "?msg=sem_state&zoho=erro",
		"/acessos-oauth/callback/zoho?error=access_denied":          "?msg=access_denied&zoho=erro",
		"/acessos-oauth/callback/zoho?error=%3Cscript%3E":           "?msg=erro_do_provedor&zoho=erro",
		"/acessos-oauth/callback/zoho?code=C&state=errado":          "?msg=state_invalido&zoho=erro",
		"/acessos-oauth/callback/microsoft?code=C&state=errado":     "?msg=state_invalido&onedrive=erro",
		"/acessos-oauth/callback/microsoft?error=access_denied&x=1": "?msg=access_denied&onedrive=erro",
	} {
		if _, loc, _ := vai(caminho); loc != "https://app.test/"+quer {
			t.Errorf("%s -> %s, esperava %s", caminho, loc, quer)
		}
	}
	if v := um(`select refresh_token || '|' || oauth_state from acessos_conexoes where provedor = 'zoho'`); v != "refresh-velho-z|estado-z" {
		t.Errorf("state divergente mexeu na conexão: %s", v)
	}
	prov.recusa = true
	if _, loc, _ := vai("/acessos-oauth/callback/zoho?code=C&state=estado-z"); loc != "https://app.test/?msg=falha_token&zoho=erro" {
		t.Errorf("provedor recusou: %s", loc)
	}
	if v := um(`select refresh_token from acessos_conexoes where provedor = 'zoho'`); v != "refresh-velho-z" {
		t.Errorf("troca recusada mexeu no refresh_token: %s", v)
	}
	reset()
	prov.semRefresh = true
	if _, loc, _ := vai("/acessos-oauth/callback/microsoft?code=C&state=estado-m"); loc != "https://app.test/?msg=sem_refresh_token&onedrive=erro" {
		t.Errorf("sem refresh_token: %s", loc)
	}

	// state vencido (> 10 min): erro e o state some
	reset()
	if _, err := pg.Exec(ctx, `update acessos_conexoes set oauth_state_em = now() - interval '11 minutes' where provedor = 'zoho'`); err != nil {
		t.Fatal(err)
	}
	if _, loc, _ := vai("/acessos-oauth/callback/zoho?code=C&state=estado-z"); loc != "https://app.test/?msg=state_expirado&zoho=erro" {
		t.Errorf("state vencido: %s", loc)
	}
	if v := um(`select coalesce(oauth_state, '<nulo>') from acessos_conexoes where provedor = 'zoho'`); v != "<nulo>" {
		t.Errorf("state vencido ficou no banco: %s", v)
	}

	// dois retornos juntos com o MESMO state: só um grava (uso único, mesmo em corrida)
	reset()
	var wg sync.WaitGroup
	oks := 0
	var mu sync.Mutex
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, loc, _ := vai("/acessos-oauth/callback/zoho?code=C&state=estado-z"); strings.HasSuffix(loc, "?zoho=ok") {
				mu.Lock()
				oks++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	if oks != 1 {
		t.Errorf("retornos que conectaram com o mesmo state = %d, esperava 1", oks)
	}

	// sem API_URL_PUBLICA o retorno recusa (o redirect_uri não seria o registrado)
	r2 := chi.NewRouter()
	(&OAuth{Zoho: zoho.ParaTeste(t, pg, srv.URL), MS: microsoft.ParaTeste(t, pg, srv.URL), Retorno: "https://app.test/"}).Montar(r2)
	reset()
	w := httptest.NewRecorder()
	r2.ServeHTTP(w, httptest.NewRequest("GET", "/acessos-oauth/callback/zoho?code=C&state=estado-z", nil))
	if loc := w.Header().Get("Location"); loc != "https://app.test/?msg=api_url_publica_ausente&zoho=erro" {
		t.Errorf("sem API_URL_PUBLICA: %s", loc)
	}
	if v := um(`select oauth_state from acessos_conexoes where provedor = 'zoho'`); v != "estado-z" {
		t.Errorf("recusa por configuração consumiu o state: %s", v)
	}
}
