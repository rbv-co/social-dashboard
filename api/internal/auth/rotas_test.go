package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func montar(t *testing.T) (*pgxpool.Pool, *Store, http.Handler) {
	t.Helper()
	p := testebanco.Novo(t)
	s := NovoStore(p)
	h := NovosHandlers(p, s, NovoLimitador())
	r := chi.NewRouter()
	r.Post("/auth/entrar", h.Entrar)
	r.Group(func(r chi.Router) {
		r.Use(Exigir(p, s))
		r.Post("/auth/sair", h.Sair)
		r.Get("/auth/eu", h.Eu)
		r.With(ExigirPermissao("frota", "ver")).Get("/frota", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	})
	return p, s, r
}

func usuarioComSenha(t *testing.T, p *pgxpool.Pool, id, email, senha, permissoes string) {
	t.Helper()
	hash, _ := HashDaSenha(senha)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `insert into usuarios (id, email, senha_hash) values ($1, $2, $3)`, id, email, hash); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into profiles (id, email, role, permissions) values ($1, $2, 'viewer', $3::jsonb)`, id, email, permissoes); err != nil {
		t.Fatal(err)
	}
}

func chamar(h http.Handler, metodo, caminho, corpo, token string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func entrar(t *testing.T, h http.Handler, email, senha string) string {
	t.Helper()
	w := chamar(h, "POST", "/auth/entrar", `{"email":"`+email+`","senha":"`+senha+`"}`, "")
	if w.Code != 200 {
		t.Fatalf("entrar = %d %s", w.Code, w.Body)
	}
	var o struct{ Token string }
	json.Unmarshal(w.Body.Bytes(), &o)
	return o.Token
}

func TestLoginNormalizaEmailEntraNaMesmaConta(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "pessoa@x.com", "s3nha", `{}`)
	if entrar(t, h, "  PESSOA@X.com ", "s3nha") == "" {
		t.Fatal("sem token")
	}
}

func TestLoginErradoEPedidoRuim(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "a@x.com", "certa", `{}`)
	casos := []struct {
		corpo string
		code  int
	}{
		{`{"email":"a@x.com","senha":"errada"}`, 401},
		{`{"email":"nao@x.com","senha":"qualquer"}`, 401},
		{`{"email":"","senha":""}`, 400},
		{`nao é json`, 400},
		{`{"email":"a@x.com","senha":"` + strings.Repeat("a", 10000) + `"}`, 400},
	}
	for _, c := range casos {
		if w := chamar(h, "POST", "/auth/entrar", c.corpo, ""); w.Code != c.code {
			t.Fatalf("corpo %.30q: %d, esperava %d", c.corpo, w.Code, c.code)
		}
	}
}

func TestLoginSemSenhaCadastradaEh401ECountaNoLimite(t *testing.T) {
	p, _, h := montar(t)
	novoUsuario(t, NovoStore(p), uid, "sem@x.com") // senha_hash nulo
	corpo := `{"email":"sem@x.com","senha":"qualquer"}`
	for i := 0; i < 5; i++ {
		w := chamar(h, "POST", "/auth/entrar", corpo, "")
		if w.Code != 401 || !strings.Contains(w.Body.String(), "credenciais_invalidas") {
			t.Fatalf("tentativa %d = %d %s", i, w.Code, w.Body)
		}
	}
	if w := chamar(h, "POST", "/auth/entrar", corpo, ""); w.Code != 429 {
		t.Fatalf("falhas deveriam contar no limite: %d", w.Code)
	}
}

func TestLimiteDeTentativas(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "a@x.com", "certa", `{}`)
	for i := 0; i < 5; i++ {
		chamar(h, "POST", "/auth/entrar", `{"email":"a@x.com","senha":"errada"}`, "")
	}
	if w := chamar(h, "POST", "/auth/entrar", `{"email":"a@x.com","senha":"certa"}`, ""); w.Code != 429 {
		t.Fatalf("esperava 429, veio %d", w.Code)
	}
}

func TestLimiteIgnoraPortaDeOrigem(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "a@x.com", "certa", `{}`)
	do := func(addr, senha string) int {
		r := httptest.NewRequest("POST", "/auth/entrar", strings.NewReader(`{"email":"a@x.com","senha":"`+senha+`"}`))
		r.RemoteAddr = addr
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	for i := 0; i < 5; i++ {
		do("192.0.2.1:"+string(rune('a'+i)), "errada") // porta nova a cada conexão
	}
	if c := do("192.0.2.1:9999", "certa"); c != 429 {
		t.Fatalf("trocar de porta não pode escapar do limite: %d", c)
	}
}

func TestEuSairESemToken(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "a@x.com", "certa", `{"frota":["ver"]}`)
	if w := chamar(h, "GET", "/auth/eu", "", ""); w.Code != 401 {
		t.Fatalf("sem token = %d", w.Code)
	}
	tok := entrar(t, h, "a@x.com", "certa")
	w := chamar(h, "GET", "/auth/eu", "", tok)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"frota":["ver"]`) {
		t.Fatalf("eu = %d %s", w.Code, w.Body)
	}
	if w := chamar(h, "POST", "/auth/sair", "", tok); w.Code != 204 {
		t.Fatalf("sair = %d", w.Code)
	}
	if w := chamar(h, "GET", "/auth/eu", "", tok); w.Code != 401 {
		t.Fatalf("depois de sair = %d", w.Code)
	}
}

func TestPermissaoPorRota(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "com@x.com", "s", `{"frota":["ver"]}`)
	usuarioComSenha(t, p, uid2, "sem@x.com", "s", `{"frota":["editar"]}`)
	if w := chamar(h, "GET", "/frota", "", entrar(t, h, "com@x.com", "s")); w.Code != 200 {
		t.Fatalf("com permissão = %d", w.Code)
	}
	if w := chamar(h, "GET", "/frota", "", entrar(t, h, "sem@x.com", "s")); w.Code != 403 {
		t.Fatalf("sem 'ver' = %d", w.Code)
	}
}

func TestSenhaXNaoEntraSemSenhaNemSemConta(t *testing.T) {
	p, _, h := montar(t)
	novoUsuario(t, NovoStore(p), uid, "sem@x.com") // senha_hash nulo
	if _, err := p.Exec(context.Background(), `insert into usuarios (id, email, senha_hash) values ($1, 'vazia@x.com', '')`, uid2); err != nil {
		t.Fatal(err)
	}
	for _, e := range []string{"sem@x.com", "vazia@x.com", "naoexiste@x.com"} {
		if w := chamar(h, "POST", "/auth/entrar", `{"email":"`+e+`","senha":"x"}`, ""); w.Code != 401 {
			t.Fatalf("%s com senha x = %d %s", e, w.Code, w.Body)
		}
	}
}

func TestEmailSoEspacosEh400(t *testing.T) {
	_, _, h := montar(t)
	if w := chamar(h, "POST", "/auth/entrar", `{"email":"   ","senha":"abc"}`, ""); w.Code != 400 {
		t.Fatalf("= %d", w.Code)
	}
}

func entrarDe(h http.Handler, addr, email, senha string) int {
	r := httptest.NewRequest("POST", "/auth/entrar", strings.NewReader(`{"email":"`+email+`","senha":"`+senha+`"}`))
	r.RemoteAddr = addr
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code
}

func TestLimitePorEmailComIPsDiferentes(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "a@x.com", "certa", `{}`)
	for i := 0; i < 10; i++ {
		entrarDe(h, "198.51.100."+strconv.Itoa(i+1)+":1000", "a@x.com", "errada")
	}
	if c := entrarDe(h, "198.51.100.200:1000", "a@x.com", "certa"); c != 429 {
		t.Fatalf("IP novo contra e-mail bloqueado = %d", c)
	}
}

func TestLimitePorIPComEmailsDiferentes(t *testing.T) {
	_, _, h := montar(t)
	for i := 0; i < 20; i++ {
		entrarDe(h, "203.0.113.7:1000", "u"+strconv.Itoa(i)+"@x.com", "errada")
	}
	if c := entrarDe(h, "203.0.113.7:1000", "novo@x.com", "errada"); c != 429 {
		t.Fatalf("mesmo IP, e-mail novo = %d", c)
	}
}

func TestIPDe(t *testing.T) {
	casos := []struct {
		nome, addr string
		hdr        map[string]string
		quer       string
	}{
		{"público ignora cabeçalhos forjados", "203.0.113.9:5555", map[string]string{"X-Real-IP": "1.1.1.1", "True-Client-IP": "2.2.2.2", "X-Forwarded-For": "3.3.3.3"}, "203.0.113.9"},
		{"privado usa X-Real-IP", "172.18.0.2:5555", map[string]string{"X-Real-IP": "198.51.100.4"}, "198.51.100.4"},
		{"loopback usa X-Real-IP", "127.0.0.1:5555", map[string]string{"X-Real-IP": "198.51.100.4"}, "198.51.100.4"},
		{"privado sem cabeçalho", "10.0.0.5:1", nil, "10.0.0.5"},
		{"privado com X-Real-IP lixo", "10.0.0.5:1", map[string]string{"X-Real-IP": "não-é-ip"}, "10.0.0.5"},
		{"privado ignora XFF", "10.0.0.5:1", map[string]string{"X-Forwarded-For": "9.9.9.9"}, "10.0.0.5"},
	}
	for _, c := range casos {
		r := httptest.NewRequest("GET", "/", nil)
		r.RemoteAddr = c.addr
		for k, v := range c.hdr {
			r.Header.Set(k, v)
		}
		if got := ipDe(r); got != c.quer {
			t.Errorf("%s: ipDe = %q, esperava %q", c.nome, got, c.quer)
		}
	}
}

func TestTokenSemPrefixoBearerEhVazio(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("Authorization", "abc123")
	if got := tokenDe(r); got != "" {
		t.Fatalf("token = %q", got)
	}
}

func TestIPBloqueadoNaoTrancaContaDaVitima(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "vitima@x.com", "certa", `{}`)
	for i := 0; i < 20; i++ {
		entrarDe(h, "203.0.113.50:1000", "u"+strconv.Itoa(i)+"@x.com", "errada")
	}
	for i := 0; i < 10; i++ { // já bloqueado por IP: não pode registrar na chave da vítima
		if c := entrarDe(h, "203.0.113.50:1000", "vitima@x.com", "errada"); c != 429 {
			t.Fatalf("esperava 429, veio %d", c)
		}
	}
	if c := entrarDe(h, "198.51.100.9:1000", "vitima@x.com", "certa"); c != 200 {
		t.Fatalf("vítima de outro IP = %d", c)
	}
}

func TestLoginDeDesativadoPorProfilesEh401MesmoComSenhaCerta(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "a@x.com", "certa", `{}`)
	p.Exec(context.Background(), `update profiles set disabled = true where id = $1`, uid)
	w := chamar(h, "POST", "/auth/entrar", `{"email":"a@x.com","senha":"certa"}`, "")
	if w.Code != 401 || !strings.Contains(w.Body.String(), "credenciais_invalidas") {
		t.Fatalf("= %d %s", w.Code, w.Body)
	}
}

func TestSessaoDeDesativadoPorProfilesEh401NaRota(t *testing.T) {
	p, _, h := montar(t)
	usuarioComSenha(t, p, uid, "a@x.com", "certa", `{}`)
	tok := entrar(t, h, "a@x.com", "certa")
	p.Exec(context.Background(), `update profiles set disabled = true where id = $1`, uid)
	if w := chamar(h, "GET", "/auth/eu", "", tok); w.Code != 401 {
		t.Fatalf("= %d", w.Code)
	}
}

func TestLoginDeUsuarioSemProfilesFunciona(t *testing.T) {
	p, _, h := montar(t)
	hash, _ := HashDaSenha("s3nha")
	p.Exec(context.Background(), `insert into usuarios (id, email, senha_hash) values ($1, 'c@x.com', $2)`, uid, hash)
	if entrar(t, h, "c@x.com", "s3nha") == "" {
		t.Fatal("sem token")
	}
}
