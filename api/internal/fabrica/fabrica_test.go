package fabrica

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

func TestMundoDaFabrica(t *testing.T) {
	m := novoMundo(t, func(r chi.Router, _ *pgxpool.Pool) {
		r.Get("/eco", func(w http.ResponseWriter, r *http.Request) {
			e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
			fmt.Fprintf(w, "%t|%s|%t", Fabricante(e), a.Tipo, autz.PodeVerConta(e, A2))
		})
	})
	casos := []struct {
		quem  string
		st    int
		corpo string
	}{
		{"", 401, ""},
		{"fabricante", 200, "true|painel|true"},
		{"fabricanteA1", 200, "true|painel|false"},
		{"fabricanteNenhuma", 200, "true|painel|false"},
		{"adminA1", 200, "true|painel|true"},
		{"super", 200, "true|painel|true"},
		{"leitor", 200, "false|painel|true"},
		{"chaveEmLista", 200, "true|painel|true"},
		{"semModulo", 200, "false|painel|true"},
		{"desativado", 401, ""},
		{"robo", 200, "true|servico|true"},
		{"roboSemFabrica", 200, "false|servico|true"},
		{"impersonado", 200, "true|painel|false"},
	}
	for _, c := range casos {
		st, corpo := m.Pedir(t, c.quem, "GET", "/eco", "")
		if st != c.st || (c.corpo != "" && corpo != c.corpo) {
			t.Errorf("%q: %d %q, esperava %d %q", c.quem, st, corpo, c.st, c.corpo)
		}
	}
	if n := m.Um(t, `select count(*)::text from fabrica_criativos`); n != "4" {
		t.Errorf("criativos = %s, esperava 4", n)
	}
	if f := m.Um(t, fotoDaFabrica); f == "<nulo>" || f == "" {
		t.Error("a foto da fábrica está vazia")
	}
}

// A policy de escrita de produção é a fonte de verdade: Fabricante tem de dar o mesmo veredito dela, pessoa a
// pessoa, nas duas tabelas que gente grava.
func TestFabricanteIgualAPolicy(t *testing.T) {
	m := novoMundo(t)
	ctx := context.Background()
	linhas := map[string]map[string]any{
		"fabrica_campanhas": {"nome": "x"},
		"fabrica_criativos": {"arquetipo": "produto", "template": "t", "formato": "f"},
	}
	ids := map[string]string{}
	for _, p := range pessoas {
		ids[p.Chave] = p.ID
	}
	permitidos, negados := 0, 0
	for chave, id := range ids {
		e, err := autz.CarregarEscopo(ctx, m.P, id)
		if err != nil {
			t.Fatal(err)
		}
		for tab, linha := range linhas {
			f, err := autz.Producao.Filtro(e, tab, autz.Criar, "autz_nova")
			if err != nil {
				t.Fatal(err)
			}
			ok, err := autz.Conferir(ctx, m.P, f, tab, linha)
			if err != nil {
				t.Fatal(err)
			}
			if ok != Fabricante(e) {
				t.Errorf("%s em %s: policy = %t, Fabricante = %t", chave, tab, ok, Fabricante(e))
			}
		}
		if Fabricante(e) {
			permitidos++
		} else {
			negados++
		}
	}
	if permitidos < 7 || negados < 4 {
		t.Errorf("o mundo não exercita os dois lados: %d permitidos, %d negados", permitidos, negados)
	}
}

func TestSoFabricanteFalhaFechado(t *testing.T) {
	h := soFabricante(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(204) }))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 403 {
		t.Fatalf("sem escopo = %d, esperava 403", w.Code)
	}
}

func TestAjudantesDeValidacao(t *testing.T) {
	j := func(s string) json.RawMessage { return json.RawMessage(s) }
	for _, s := range []string{"null", "5", "{}"} {
		if _, ok := texto(j(s)); ok {
			t.Errorf("texto(%s) aceitou", s)
		}
	}
	if textoAte(j(`"  "`), 10, false) || !textoAte(j(`"  "`), 10, true) {
		t.Error("textoAte: vazio")
	}
	if !textoAte(j(`"ção"`), 3, false) || textoAte(j(`"ções"`), 3, false) {
		t.Error("textoAte tem de contar caracteres, não bytes")
	}
	if !objeto(j("{}")) || objeto(j("[]")) || objeto(j("null")) {
		t.Error("objeto")
	}
	if !lista(j("[]")) || lista(j("{}")) {
		t.Error("lista")
	}
	if !booleano(j("true")) || !booleano(j("false")) || booleano(j(`"true"`)) || booleano(j("1")) {
		t.Error("booleano")
	}
	if !urlValida(j(`"https://midia.x/f/a.png"`)) {
		t.Error("urlValida recusou https")
	}
	for _, s := range []string{`"javascript:alert(1)"`, `"/f/a.png"`, `"https://u:s@x/a"`, `5`} {
		if urlValida(j(s)) {
			t.Errorf("urlValida(%s) aceitou", s)
		}
	}
	if numeroOuNulo(j("-1")) || !numeroOuNulo(j("1.5")) || !numeroOuNulo(j("null")) || !numeroOuNulo(nil) {
		t.Error("numeroOuNulo")
	}
	if inteiroOuNulo(j("1.5")) || inteiroOuNulo(j("-1")) || !inteiroOuNulo(j("7")) {
		t.Error("inteiroOuNulo")
	}
	if !textoEm(j(`"a"`), "a", "b") || textoEm(j(`"c"`), "a", "b") {
		t.Error("textoEm")
	}
	if !casa(j(`"`+A1+`"`), reUUID) || casa(j(`"x"`), reUUID) || !casa(j(`"produto-heroi"`), reChaveLook) || casa(j(`"-x"`), reChaveLook) {
		t.Error("casa")
	}

	w := httptest.NewRecorder()
	escritaOuPedido(w, errPedido{"x"})
	if w.Code != 400 || w.Body.String() != "{\"error\":\"pedido_invalido\",\"mensagem\":\"x\"}\n" {
		t.Errorf("errPedido = %d %s", w.Code, w.Body)
	}
	w = httptest.NewRecorder()
	escritaOuPedido(w, autz.ErrNegado)
	if w.Code != 403 {
		t.Errorf("ErrNegado = %d", w.Code)
	}
	w = httptest.NewRecorder()
	responder(w, 202, map[string]any{"ok": true})
	if w.Code != 202 || w.Body.String() != "{\"ok\":true}\n" {
		t.Errorf("responder = %d %s", w.Code, w.Body)
	}
}
