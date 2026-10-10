package canais

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Tabelas de produção que a regra lê (só as colunas usadas).
const tabelas = `
create table bling_lojas (loja_id bigint primary key, nome text, grupo text, grupo_id uuid);
create table equipes (id uuid primary key, canal_loja_id bigint);
create table equipes_membros (equipe_id uuid not null, profile_id uuid not null, papel text not null default 'vendedora');
create table canais_grupos_membros (grupo_id uuid not null, profile_id uuid not null, papel text not null default 'supervisora');`

const (
	uA   = "aaaaaaaa-0000-0000-0000-000000000001" // vendedora limitada ao Dom Pedro
	uB   = "aaaaaaaa-0000-0000-0000-000000000002" // supervisora do Tivoli (outra pessoa)
	uC   = "aaaaaaaa-0000-0000-0000-000000000003" // não limitada
	uSem = "aaaaaaaa-0000-0000-0000-000000000004" // sem profile
	eDom = "bbbbbbbb-0000-0000-0000-000000000001"
	eTiv = "bbbbbbbb-0000-0000-0000-000000000002"
)

func preparar(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p := testebanco.Novo(t)
	ctx := context.Background()
	for _, sql := range []string{
		tabelas,
		`insert into usuarios (id, email) values ('` + uA + `','a@x'),('` + uB + `','b@x'),('` + uC + `','c@x'),('` + uSem + `','s@x')`,
		`insert into profiles (id, email, role, escopo_por_equipe) values ('` + uA + `','a@x','viewer',true),('` + uB + `','b@x','viewer',true),('` + uC + `','c@x','viewer',false)`,
		`insert into bling_lojas values (205657609,'Dom Pedro','Varejo',null),(205834140,'Tivoli','Varejo',null)`,
		`insert into equipes values ('` + eDom + `',205657609),('` + eTiv + `',205834140)`,
		`insert into equipes_membros values ('` + eDom + `','` + uA + `','vendedora'),('` + eTiv + `','` + uB + `','supervisora')`,
	} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	return p
}

func TestCarregar(t *testing.T) {
	p := preparar(t)
	ctx := context.Background()
	casos := []struct {
		nome string
		ator *auth.Ator
		quer []int64
	}{
		{"vendedora: só a loja dela (o vínculo da supervisora B não vaza)", &auth.Ator{ID: uA, Tipo: "painel"}, []int64{205657609}},
		{"supervisora B: o grupo do canal dela", &auth.Ator{ID: uB, Tipo: "painel"}, []int64{205834140, 205657609}},
		{"fora do escopo: todos", &auth.Ator{ID: uC, Tipo: "painel"}, nil},
		{"super-admin: todos", &auth.Ator{ID: uA, Tipo: "painel", SuperAdmin: true}, nil},
		{"conta de serviço nunca é limitada, mesmo com escopo ligado", &auth.Ator{ID: uA, Tipo: "servico"}, nil},
		{"sem profile: nenhum", &auth.Ator{ID: uSem, Tipo: "painel"}, []int64{}},
	}
	for _, c := range casos {
		got, err := Carregar(ctx, p, c.ator)
		if err != nil {
			t.Fatalf("%s: %v", c.nome, err)
		}
		if (got == nil) != (c.quer == nil) || !slices.Equal(got, c.quer) {
			t.Errorf("%s: %v, esperava %v", c.nome, got, c.quer)
		}
	}
}

func TestHandlerEuCanais(t *testing.T) {
	p := preparar(t)
	s := auth.NovoStore(p)
	ctx := context.Background()
	r := chi.NewRouter()
	r.With(auth.Exigir(p, s)).Get("/eu/canais", Handler(p))
	tokA, _ := s.Criar(ctx, uA, "painel", nil)
	tokC, _ := s.Criar(ctx, uC, "painel", nil)
	for _, c := range []struct{ token, quer string }{{tokA, `{"canais":[205657609]}`}, {tokC, `{"canais":null}`}} {
		req := httptest.NewRequest("GET", "/eu/canais", nil)
		req.Header.Set("Authorization", "Bearer "+c.token)
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		var got, quer any
		json.Unmarshal(w.Body.Bytes(), &got)
		json.Unmarshal([]byte(c.quer), &quer)
		b1, _ := json.Marshal(got)
		b2, _ := json.Marshal(quer)
		if w.Code != http.StatusOK || string(b1) != string(b2) {
			t.Errorf("%d %s, esperava %s", w.Code, w.Body, c.quer)
		}
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest("GET", "/eu/canais", nil))
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("sem sessão = %d", w.Code)
	}
}
