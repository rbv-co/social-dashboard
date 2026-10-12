package auth

import (
	"context"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// profiles.permissions é jsonb livre: array, escalar, null, chave com valor que não é array. O banco
// tolera tudo (vessel_pode exige objeto; o operador ? casa chaves). A API também: nada disso pode virar
// 500 em TODA rota autenticada da pessoa (Exigir carrega o ator em cada requisição).
func TestLerPermissoesToleranteComoOBanco(t *testing.T) {
	casos := []struct {
		nome, json string
		acoes      map[string][]string
		chaves     map[string]bool
	}{
		{"objeto normal", `{"meta.opr": ["ver", "editar"]}`, map[string][]string{"meta.opr": {"ver", "editar"}}, map[string]bool{"meta.opr": true}},
		{"array de textos", `["meta.opr", 3, null, "x"]`, map[string][]string{}, map[string]bool{"meta.opr": true, "x": true}},
		{"escalar texto", `"meta.opr"`, map[string][]string{}, map[string]bool{}},
		{"escalar número", `3`, map[string][]string{}, map[string]bool{}},
		{"null", `null`, map[string][]string{}, map[string]bool{}},
		{"vazio", ``, map[string][]string{}, map[string]bool{}},
		{"valor true", `{"meta.opr": true}`, map[string][]string{}, map[string]bool{"meta.opr": true}},
		{"valor texto", `{"meta.opr": "ver"}`, map[string][]string{}, map[string]bool{"meta.opr": true}},
		{"valor objeto", `{"meta.opr": {"ver": true}}`, map[string][]string{}, map[string]bool{"meta.opr": true}},
		{"array de números", `{"k": [1]}`, map[string][]string{"k": {}}, map[string]bool{"k": true}},
		{"array misto", `{"k": ["ver", 1, null, true, "editar"], "j": true}`, map[string][]string{"k": {"ver", "editar"}}, map[string]bool{"k": true, "j": true}},
		{"valor null", `{"k": null}`, map[string][]string{"k": {}}, map[string]bool{"k": true}},
		{"json inválido", `{`, map[string][]string{}, map[string]bool{}},
	}
	for _, c := range casos {
		chaves, acoes := LerPermissoes([]byte(c.json))
		if !reflect.DeepEqual(acoes, c.acoes) || !reflect.DeepEqual(chaves, c.chaves) {
			t.Errorf("%s: acoes=%v chaves=%v, queria %v e %v", c.nome, acoes, chaves, c.acoes, c.chaves)
		}
	}
}

func TestCarregarAtorToleraPermissionsMalFormadas(t *testing.T) {
	p := testebanco.Novo(t)
	s := NovoStore(p)
	ctx := context.Background()
	r := chi.NewRouter()
	r.Use(Exigir(p, s))
	r.Get("/x", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	for i, perm := range []string{`'["meta.opr"]'`, `'"texto"'`, `'null'`, `'{"meta.opr": true}'`, `'{"k": [1]}'`, `'{"k": ["ver", 1], "j": "x"}'`} {
		id := "44444444-4444-4444-4444-44444444444" + string(rune('0'+i))
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1, $2)`, id, id+"@x.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, permissions) values ($1, $2, 'viewer', `+perm+`::jsonb)`, id, id+"@x.com"); err != nil {
			t.Fatal(err)
		}
		tok, err := s.Criar(ctx, id, "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		sessao, err := s.Buscar(ctx, tok)
		if err != nil {
			t.Fatal(err)
		}
		a, err := CarregarAtor(ctx, p, sessao)
		if err != nil || a == nil {
			t.Fatalf("permissions %s: CarregarAtor: %v", perm, err)
		}
		req := httptest.NewRequest("GET", "/x", nil)
		req.Header.Set("Authorization", "Bearer "+tok)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Errorf("permissions %s: GET /x = %d (%s), queria 200", perm, w.Code, w.Body.String())
		}
	}
}
