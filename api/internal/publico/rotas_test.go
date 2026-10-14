package publico

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func hashDoIP(ip string) string { h := sha256.Sum256([]byte(ip)); return hex.EncodeToString(h[:]) }

const entrar = `{"p_nome":"Ana","p_email":"ana@x.com","p_whatsapp":"11999990000","p_aceite_versao":"v1"}`

// O formulário de outro site (text/plain, urlencoded) toma 415 ANTES de qualquer limite ou banco; JSON com charset passa.
func TestSoJSON(t *testing.T) {
	m := novoMundo(t)
	for _, ct := range []string{"text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""} {
		r := httptest.NewRequest("POST", "/rest/v1/rpc/vessel_pre_venda_restantes", strings.NewReader(`{}`))
		r.Header.Set("Content-Type", ct)
		w := httptest.NewRecorder()
		m.H.ServeHTTP(w, r)
		if w.Code != http.StatusUnsupportedMediaType {
			t.Errorf("Content-Type %q = %d, esperava 415", ct, w.Code)
		}
	}
	r := httptest.NewRequest("POST", "/rest/v1/rpc/vessel_pre_venda_restantes", strings.NewReader(`{}`))
	r.Header.Set("Content-Type", "application/json; charset=utf-8")
	w := httptest.NewRecorder()
	m.H.ServeHTTP(w, r)
	if w.Code != 200 {
		t.Errorf("application/json com charset = %d, esperava 200", w.Code)
	}
}

// Lista fechada: função fora da lista, de conta ou de painel = 404 para todos (inclusive o Core); as de escrita só com a
// chave do Core quando VESSEL_SO_CORE.
func TestListaFechadaESoCore(t *testing.T) {
	m := novoMundo(t, func(s *Servico) { s.SoCore = true })
	for _, nome := range []string{"vessel_conta_criar", "vessel_pedir_atendimento", "vessel_stylist_criar", "is_superadmin", "disparar_robo", "nao_existe"} {
		for _, cab := range [][]string{nil, {comCore}} {
			if st, _, _ := m.pedido(t, "/rest/v1/rpc/"+nome, `{}`, cab...); st != 404 {
				t.Errorf("%s (cab %v) = %d, esperava 404", nome, cab, st)
			}
		}
	}
	if st, _, _ := m.pedido(t, "/rest/v1/rpc/vessel_entrar_na_lista", entrar); st != 404 {
		t.Errorf("escrita anônima com VESSEL_SO_CORE = %d, esperava 404", st)
	}
	if st, _, _ := m.pedido(t, "/rest/v1/rpc/vessel_entrar_na_lista", entrar, "Authorization: Bearer chave-errada"); st != 404 {
		t.Errorf("escrita com chave errada = %d, esperava 404", st)
	}
	if st, r, _ := m.pedido(t, "/rest/v1/rpc/vessel_entrar_na_lista", entrar, comCore); st != 200 || !strings.Contains(r, `"ok" : true`) {
		t.Errorf("escrita com a chave do Core = %d %s", st, r)
	}
	if st, _, _ := m.pedido(t, "/rest/v1/rpc/vessel_pre_venda_restantes", `{}`); st != 200 {
		t.Errorf("leitura anônima = %d", st)
	}
	// sem VESSEL_SO_CORE (a transição): o anônimo escreve como hoje
	m2 := novoMundo(t)
	if st, _, _ := m2.pedido(t, "/rest/v1/rpc/vessel_entrar_na_lista", entrar); st != 200 {
		t.Errorf("escrita anônima na transição = %d, esperava 200", st)
	}
	// Core sem segredo configurado: ninguém é o Core, nem com "Bearer " vazio
	m3 := novoMundo(t, func(s *Servico) { s.Segredo = ""; s.SoCore = true })
	for _, cab := range []string{"Authorization: Bearer ", "Authorization: Bearer x", "Authorization: Bearer"} {
		if st, _, _ := m3.pedido(t, "/rest/v1/rpc/vessel_entrar_na_lista", entrar, cab); st != 404 {
			t.Errorf("segredo vazio e %q = %d, esperava 404", cab, st)
		}
	}
}

// O IP chega à função: o Core manda o X-Forwarded-For do visitante; o anônimo vale pelo X-Real-IP do nginx (e o
// X-Forwarded-For que ele manda é ignorado). Sem o cabeçalho a função cai em "sem-ip", como em produção.
func TestIPChegaAFuncao(t *testing.T) {
	m := novoMundo(t)
	corpo := func(i int) string {
		return fmt.Sprintf(`{"p_nome":"Pessoa %d","p_email":"p%d@x.com","p_whatsapp":"1199999000%d","p_aceite_versao":"v1"}`, i, i, i)
	}
	m.pedido(t, "/rest/v1/rpc/vessel_entrar_na_lista", corpo(1), comCore, "X-Forwarded-For: 203.0.113.9, 10.0.0.1")
	m.pedido(t, "/rest/v1/rpc/vessel_entrar_na_lista", corpo(2), "X-Real-IP: 198.51.100.7", "X-Forwarded-For: 1.2.3.4")
	m.pedido(t, "/rest/v1/rpc/vessel_entrar_na_lista", corpo(3), comCore)
	for i, quer := range []string{hashDoIP("203.0.113.9"), hashDoIP("198.51.100.7"), hashDoIP("127.0.0.1")} {
		if got := m.um(t, `select ip_hash from vessel_lista_espera where email = $1`, fmt.Sprintf("p%d@x.com", i+1)); got != quer {
			t.Errorf("ip_hash da pessoa %d = %s, esperava %s", i+1, got, quer)
		}
	}
}

// p_teste: só com a chave do Core. O anônimo o perde (a linha nasce real) e o Core o marca.
func TestPTesteSoDoCore(t *testing.T) {
	m := novoMundo(t)
	anon := `{"p_nome":"Beto","p_loja":"iguatemi","p_teste":true}`
	if st, r, _ := m.pedido(t, "/rest/v1/rpc/vessel_identificar_client_advisor", anon); st != 200 {
		t.Fatalf("anônimo = %d %s", st, r)
	}
	if st, r, _ := m.pedido(t, "/rest/v1/rpc/vessel_identificar_client_advisor", `{"p_nome":"Caio","p_loja":"iguatemi","p_teste":true}`, comCore); st != 200 {
		t.Fatalf("Core = %d %s", st, r)
	}
	if got := m.um(t, `select teste::text from vessel_client_advisors where nome = 'Beto'`); got != "false" {
		t.Errorf("p_teste do anônimo = %s, esperava false (ignorado)", got)
	}
	if got := m.um(t, `select teste::text from vessel_client_advisors where nome = 'Caio'`); got != "true" {
		t.Errorf("p_teste do Core = %s, esperava true", got)
	}
}

// Abuso: 429 por IP (outro IP segue), depois o teto global; o Core tem o disjuntor próprio.
func TestLimites(t *testing.T) {
	m := novoMundo(t, func(s *Servico) { s.PorIP, s.Global, s.DoCore = 3, 5, 4 })
	chama := func(ip string) int {
		st, _, _ := m.pedido(t, "/rest/v1/rpc/vessel_pre_venda_restantes", `{}`, "X-Real-IP: "+ip)
		return st
	}
	for i := 0; i < 3; i++ {
		if st := chama("198.51.100.1"); st != 200 {
			t.Fatalf("pedido %d = %d", i+1, st)
		}
	}
	if st := chama("198.51.100.1"); st != 429 {
		t.Errorf("4º pedido do mesmo IP = %d, esperava 429", st)
	}
	if st := chama("198.51.100.2"); st != 200 {
		t.Errorf("outro IP = %d, esperava 200 (o teto do primeiro não é do segundo)", st)
	}
	if st := chama("198.51.100.3"); st != 200 {
		t.Errorf("3º IP = %d", st)
	}
	// 3 + 1 + 1 = 5 do global gastos (o 429 do IP 1 não gasta o global): o próximo, de IP novo, estoura o teto global
	if st := chama("198.51.100.4"); st != 429 {
		t.Errorf("acima do teto global = %d, esperava 429", st)
	}
	for i := 0; i < 4; i++ {
		if st, _, _ := m.pedido(t, "/rest/v1/rpc/vessel_pre_venda_restantes", `{}`, comCore); st != 200 {
			t.Fatalf("Core %d = %d (o teto do anônimo não vale para ele)", i+1, st)
		}
	}
	if st, _, _ := m.pedido(t, "/rest/v1/rpc/vessel_pre_venda_restantes", `{}`, comCore); st != 429 {
		t.Errorf("Core acima do disjuntor = %d, esperava 429", st)
	}
}

// Corpo: > 32 KiB = 413, parâmetro desconhecido ou faltando = 400, tudo ANTES do banco.
func TestCorpoEParametros(t *testing.T) {
	m := novoMundo(t)
	grande := `{"p_nome":"` + strings.Repeat("a", TetoCorpo) + `"}`
	if st, _, _ := m.pedido(t, "/rest/v1/rpc/vessel_entrar_na_lista", grande); st != 413 {
		t.Errorf("corpo grande = %d, esperava 413", st)
	}
	if st, r, _ := m.pedido(t, "/rest/v1/rpc/vessel_pre_venda_restantes", `{"p_x":1}`); st != 400 || !strings.Contains(r, "parâmetro desconhecido") {
		t.Errorf("parâmetro desconhecido = %d %s", st, r)
	}
	if st, r, _ := m.pedido(t, "/rest/v1/rpc/vessel_entrar_na_lista", `{"p_nome":"x"}`); st != 400 || !strings.Contains(r, "falta o parâmetro") {
		t.Errorf("parâmetro faltando = %d %s", st, r)
	}
	if st, _, _ := m.pedido(t, "/rest/v1/rpc/vessel_entrar_na_lista", `lixo`); st != 400 {
		t.Errorf("JSON inválido = %d, esperava 400", st)
	}
}

// CORS: preflight 204 sem tocar no banco; só a origem configurada recebe o cabeçalho.
func TestCORS(t *testing.T) {
	m := novoMundo(t)
	for _, c := range []struct {
		origem string
		quer   bool
	}{{"https://vesselbrasil.com.br", true}, {"https://outro-site.com", false}, {"", false}} {
		r := httptest.NewRequest("OPTIONS", "/rest/v1/rpc/vessel_abrir_convite", nil)
		if c.origem != "" {
			r.Header.Set("Origin", c.origem)
		}
		r.Header.Set("Access-Control-Request-Method", "POST")
		w := httptest.NewRecorder()
		m.H.ServeHTTP(w, r)
		got := w.Header().Get("Access-Control-Allow-Origin")
		if w.Code != 204 || (c.quer && got != c.origem) || (!c.quer && got != "") {
			t.Errorf("origem %q = %d, ACAO %q (esperava presente=%t)", c.origem, w.Code, got, c.quer)
		}
		if c.quer && !strings.Contains(w.Header().Get("Access-Control-Allow-Headers"), "apikey") {
			t.Errorf("preflight sem apikey nos cabeçalhos permitidos: %q", w.Header().Get("Access-Control-Allow-Headers"))
		}
	}
	// a resposta de verdade também leva o cabeçalho
	_, _, h := m.pedido(t, "/rest/v1/rpc/vessel_pre_venda_restantes", `{}`, "Origin: https://vesselbrasil.com.br")
	if h.Get("Access-Control-Allow-Origin") != "https://vesselbrasil.com.br" || h.Get("Cache-Control") != "no-store" {
		t.Errorf("cabeçalhos da resposta: %v", h)
	}
}
