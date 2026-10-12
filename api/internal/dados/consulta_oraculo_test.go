package dados

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/autz/autzteste"
)

// O resultado de uma rota (marcadores + sombra do framework, rodando como dono do banco) é igual ao
// que a PRÓPRIA RLS de produção dá à mesma pessoa para o mesmo SQL escrito sem marcadores
// (oráculo da Task 4: 276 policies verbatim, `set local role authenticated`). A rota de patrimônio
// cita patrimonio_bens E patrimonio_posse, cuja regra lê patrimonio_bens: exercita a ordem das CTEs.
func TestRotaComSombraIgualARLSDeProducao(t *testing.T) {
	m := autzteste.Novo(t)
	ctx := context.Background()
	if _, err := m.Pool.Exec(ctx, `insert into patrimonio_posse (bem_id) values ($1), ($2), ($3), ($4), (null)`,
		autzteste.B1, autzteste.B2, autzteste.B3, autzteste.B4); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Pool.Exec(ctx, `insert into patrimonio_log (pessoa_id) values ($1), ($2), (null)`, autzteste.PE1, autzteste.PE2); err != nil {
		t.Fatal(err)
	}
	rotas := []struct {
		nome string
		c    Consulta
		rls  string // o mesmo SQL, sem marcadores: a RLS é que filtra
		pks  []string
	}{
		{"patrimônio: bem e posse (posse lê o bem pela regra)", Consulta{Tabela: "patrimonio_bens", Alias: "b",
			SQL:         `select b.id as bid, p.id as pid, (select count(*) from patrimonio_posse p where {ler:patrimonio_posse:p}) as n_posse from patrimonio_bens b left join patrimonio_posse p on p.bem_id = b.id and {ler:patrimonio_posse:p}`,
			OrdemPadrao: "b.id", Desempate: "b.id"},
			`select b.id as bid, p.id as pid, (select count(*) from patrimonio_posse p) as n_posse from patrimonio_bens b left join patrimonio_posse p on p.bem_id = b.id`, nil},
		{"patrimônio: a posse é a principal e o bem vem por subconsulta", Consulta{Tabela: "patrimonio_posse", Alias: "p",
			SQL:         `select p.id as pid, (select count(*) from patrimonio_bens y where {ler:patrimonio_bens:y}) as n_bens from patrimonio_posse p`,
			OrdemPadrao: "p.id", Desempate: "p.id"},
			`select p.id as pid, (select count(*) from patrimonio_bens y) as n_bens from patrimonio_posse p`, nil},
		{"equipes e seus membros", Consulta{Tabela: "equipes", Alias: "e",
			SQL:         `select e.id as eid, m.id as mid, m.papel from equipes e left join equipes_membros m on m.equipe_id = e.id and {ler:equipes_membros:m}`,
			OrdemPadrao: "e.id", Desempate: "e.id"},
			`select e.id as eid, m.id as mid, m.papel from equipes e left join equipes_membros m on m.equipe_id = e.id`, nil},
		{"log de patrimônio com contagem de bens", Consulta{Tabela: "patrimonio_log", Alias: "l",
			SQL:         `select l.id as lid, (select count(*) from patrimonio_bens y where {ler:patrimonio_bens:y}) as n_bens from patrimonio_log l`,
			OrdemPadrao: "l.id", Desempate: "l.id"},
			`select l.id as lid, (select count(*) from patrimonio_bens y) as n_bens from patrimonio_log l`, nil},
	}
	pessoas := []string{"sem-perfil", "comum", "admin", "super-ficha", "super-email", "desativado", "vendedora", "gestor",
		"gestor-sem-trava", "supervisora-time", "supervisora-grupo", "estoque", "sem-time", "contas-a1", "modulo:patrimonio"}
	for _, r := range rotas {
		distintos := map[string]bool{}
		for _, nome := range pessoas {
			pe := m.Pessoa(nome)
			e, err := autz.CarregarEscopo(ctx, m.Pool, pe.ID)
			if err != nil {
				t.Fatal(err)
			}
			rt := chi.NewRouter()
			rt.Use(func(next http.Handler) http.Handler {
				return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
					next.ServeHTTP(w, req.WithContext(autz.NoContexto(req.Context(), e)))
				})
			})
			rt.Get("/x", r.c.Handler(m.Pool, autz.Producao))
			w := httptest.NewRecorder()
			rt.ServeHTTP(w, httptest.NewRequest("GET", "/x", nil))
			if w.Code != 200 {
				t.Fatalf("%s / %s = %d %s", r.nome, nome, w.Code, w.Body)
			}
			var rls string
			if err := m.ComoPessoa(ctx, pe.ID, func(tx pgx.Tx) error {
				return tx.QueryRow(ctx, `select coalesce(json_agg(t), '[]'::json) from (`+r.rls+`) t`).Scan(&rls)
			}); err != nil {
				t.Fatalf("%s / %s (RLS): %v", r.nome, nome, err)
			}
			a, b := ordenado(t, w.Body.String()), ordenado(t, rls)
			if !slices.Equal(a, b) {
				t.Errorf("%s / %s: a rota deu\n%v\na RLS deu\n%v", r.nome, nome, a, b)
			}
			distintos[compacto(w.Body.String())] = true
		}
		if len(distintos) < 2 { // o teste só vale se as pessoas enxergam coisas diferentes
			t.Errorf("%s: as %d pessoas viram só %d resultados distintos", r.nome, len(pessoas), len(distintos))
		}
	}
}

// ordenado: as linhas do JSON como texto, ordenadas (a ordem entre empates não importa aqui).
func ordenado(t *testing.T, j string) []string {
	t.Helper()
	var linhas []json.RawMessage
	if err := json.Unmarshal([]byte(j), &linhas); err != nil {
		t.Fatal(err, j)
	}
	out := make([]string, len(linhas))
	for i, l := range linhas {
		out[i] = compacto(string(l))
	}
	slices.Sort(out)
	return out
}
