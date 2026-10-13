package paineis

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const eu = "51200000-0000-4000-a000-000000000099"

func TestRegraDaSaudeDosRobosEhPorPessoa(t *testing.T) {
	casos := []struct {
		nome  string
		e     *autz.Escopo
		passa bool
	}{
		{"admin", &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, Papel: "admin"}, true},
		{"super-admin pela ficha", &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, Papel: "viewer", SuperFicha: true}, true},
		{"claude.status em features", &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, Papel: "viewer", Modulos: []string{"claude.status"}}, true},
		{"claude.status só em permissions", &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, Papel: "viewer",
			Chaves: map[string]bool{"claude.status": true}, Acoes: map[string][]string{"claude.status": {"ver"}}}, false},
		{"comum", &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, Papel: "viewer"}, false},
		{"admin desativado", &autz.Escopo{ID: eu, TemPerfil: true, Ativo: false, Papel: "admin"}, false},
		{"sem perfil", &autz.Escopo{ID: eu, Ativo: true}, false},
	}
	for _, c := range casos {
		quer := "false"
		if c.passa {
			quer = "true"
		}
		for _, tab := range tabelasDaSaude {
			if f, err := autz.Producao.Filtro(c.e, tab, autz.Ler, "x"); err != nil || f.SQL != quer {
				t.Errorf("%s × %s = %q (%v), esperava %q (a regra virou por linha? reescreva SaudeDosRobos)", c.nome, tab, f.SQL, err, quer)
			}
		}
	}
}

func catalogoDaSaude(t *testing.T, esperados, execucoes string) *autz.Catalogo {
	t.Helper()
	cat, err := autz.Compilar([]byte(`[
 {"tabela":"robos_esperados","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"` + esperados + `","withCheck":null},
 {"tabela":"robos_execucoes","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"` + execucoes + `","withCheck":null}]`))
	if err != nil {
		t.Fatal(err)
	}
	return cat
}

func lerSaude(h http.Handler, e *autz.Escopo, query string) (int, string) {
	r := httptest.NewRequest("GET", "/status-ia/saude-dos-robos"+query, nil)
	if e != nil {
		r = r.WithContext(autz.NoContexto(r.Context(), e))
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code, strings.TrimSpace(w.Body.String())
}

func TestSaudeExigeAsDuasTabelas(t *testing.T) {
	p := testebanco.Novo(t)
	testebanco.TabelasDosPaineis(t, p)
	if _, err := p.Exec(context.Background(), `insert into robos_esperados values ('r', 1, false, 'x')`); err != nil {
		t.Fatal(err)
	}
	h := SaudeDosRobos(p, catalogoDaSaude(t, "true", "is_frota_admin()"))
	frota := &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, SemTrava: true, Modulos: []string{"frota"}}
	comum := &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, SemTrava: true}
	if st, corpo := lerSaude(h, frota, ""); st != 200 || !strings.Contains(corpo, `"robo":"r"`) {
		t.Errorf("quem lê as duas = %d %s", st, corpo)
	}
	if st, corpo := lerSaude(h, comum, ""); st != 200 || corpo != "[]" {
		t.Errorf("só a primeira tabela liberada = %d %s, esperava []", st, corpo)
	}
	// simétrico: a 2ª tabela aberta e a 1ª restrita também fecha (um laço só sobre a 2ª passaria)
	hEsperados := SaudeDosRobos(p, catalogoDaSaude(t, "is_frota_admin()", "true"))
	if st, corpo := lerSaude(hEsperados, frota, ""); st != 200 || !strings.Contains(corpo, `"robo":"r"`) {
		t.Errorf("quem lê as duas (restrita a 1ª) = %d %s", st, corpo)
	}
	if st, corpo := lerSaude(hEsperados, comum, ""); st != 200 || corpo != "[]" {
		t.Errorf("só a segunda tabela liberada = %d %s, esperava []", st, corpo)
	}
	conta := &autz.Escopo{ID: eu, TemPerfil: true, Ativo: true, SemTrava: true, Contas: []string{"A1"}}
	if st, corpo := lerSaude(SaudeDosRobos(p, catalogoDaSaude(t, "true", "pode_ver_conta(account_id)")), conta, ""); st != 200 || corpo != "[]" {
		t.Errorf("regra por linha = %d %s, esperava [] (fecha)", st, corpo)
	}
	if st, _ := lerSaude(h, nil, ""); st != 500 {
		t.Errorf("sem escopo = %d, esperava 500", st)
	}
	// query malformada também é 400: r.URL.Query() descartaria o par e responderia 200
	for _, q := range []string{"?x=1", "?x", "?x=%zz", "?%zz", "?a;b"} {
		if st, _ := lerSaude(h, frota, q); st != 400 {
			t.Errorf("parâmetro %q = %d, esperava 400", q, st)
		}
	}
}
