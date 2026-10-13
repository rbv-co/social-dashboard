package patrimonio

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// montarSondas: /eco devolve o Escopo que chegou (locais|pessoas|semTrava|impersonado); /pessoas-que-leio
// conta as linhas de acessos_pessoas que a regra de Ler do catálogo deixa a pessoa ver; /grava passa
// pelo portão da sessão própria.
func montarSondas(r chi.Router, p *pgxpool.Pool) {
	r.Get("/eco", func(w http.ResponseWriter, r *http.Request) {
		e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
		if e == nil || a == nil { // a rota fora de ComEscopo/Exigir não pode derrubar o teste com pânico
			http.Error(w, "sem escopo", http.StatusInternalServerError)
			return
		}
		_, _ = fmt.Fprintf(w, "%v|%v|%v|%v", e.Locais, e.Pessoas, e.SemTrava, a.ImpersonadorID != nil)
	})
	r.Get("/pessoas-que-leio", func(w http.ResponseWriter, r *http.Request) {
		f, err := autz.Producao.Filtro(autz.EscopoDo(r.Context()), "acessos_pessoas", autz.Ler, "t")
		if err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		var n int
		if err := p.QueryRow(r.Context(), `select count(*) from acessos_pessoas t where `+f.SQL, pgx.NamedArgs(f.Juntar(pgx.NamedArgs{}))).Scan(&n); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		_, _ = w.Write([]byte(strconv.Itoa(n)))
	})
	r.With(soSessaoPropria).Post("/grava", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
}

func TestMundoDoPatrimonio(t *testing.T) {
	m := novoMundo(t, montarSondas)
	for quem, quer := range map[string]string{
		"patT1":       "[" + L1 + "]|[" + P1 + "]|false|false",
		"patT2":       "[" + L2 + "]|[]|false|false",
		"patGeral":    "[]|[]|true|false",
		"impersonado": "[]|[]|true|true",
		"viewer":      "[]|[]|false|false",
	} {
		// igualdade exata, não só "contém"
		if st, corpo := m.Pedir(t, quem, "GET", "/eco", ""); st != http.StatusOK || corpo != quer {
			t.Errorf("escopo de %s = %d %q, esperava %q", quem, st, corpo, quer)
		}
	}
	m.Rodar(t, []caso{
		{Nome: "sem sessão", Quem: "", Metodo: "GET", Caminho: "/eco", Status: http.StatusUnauthorized},
		{Nome: "6 bens no mundo", Efeito: contar("patrimonio_bens"), Quer: "6"},
	})
	if f := m.Um(t, fotoDoMundo); f == "<nulo>" || f == "" {
		t.Errorf("foto do mundo vazia: %q", f)
	}
}

// O portão da sessão própria do pacote: quem entrou como outra pessoa não passa; a própria passa.
func TestSoSessaoPropria(t *testing.T) {
	m := novoMundo(t, montarSondas)
	m.Rodar(t, []caso{
		{Nome: "sessão própria", Quem: "patGeral", Metodo: "POST", Caminho: "/grava", Status: http.StatusNoContent},
		{Nome: "entrou como", Quem: "impersonado", Metodo: "POST", Caminho: "/grava", Status: http.StatusForbidden, Tem: dados.FraseEntrarComo},
		{Nome: "sem sessão", Quem: "", Metodo: "POST", Caminho: "/grava", Status: http.StatusUnauthorized},
	})
}

// Ruling 5.2-17 (M2 da revisão da Task 2): o pessoa_id dos bens aponta para acessos_pessoas, cuja regra
// de Ler é is_acessos_admin() (papel admin ou módulo acessos; super pela ficha sozinha não basta);
// quem só tem patrimônio não lê NENHUMA pessoa por essa regra. Logo, no POST /patrimonio/bens
// (CriarSoLegivel) pessoa_id existente passa (201) e inexistente cai no 403 da FK, e no PATCH o
// inexistente é 409: a rota deixa quem só tem patrimônio testar se um uuid de acessos_pessoas existe.
// DECISÃO: aceitar. Quem tem patrimônio já lista TODAS as pessoas com id pela RPC
// pessoas_para_escolher() (02-gatilhos.sql), então validar o pessoa_id contra a regra de Ler
// impediria pôr responsável num bem (regressão) e o PostgREST de hoje já devolve esse erro. O custo,
// se a decisão estivesse errada, é um oráculo de existência de uuid (não adivinhável) para quem já vê
// a lista. A matriz do POST/PATCH está em TestBensEscrita.
func TestPessoaDosBensForaDaRegraDeLerDeAcessosPessoas(t *testing.T) {
	m := novoMundo(t, montarSondas)
	for quem, quer := range map[string]string{"patGeral": "0", "patT1": "0", "patT2": "0", "frota": "0", "viewer": "0", "acessos": "2", "superFicha": "0", "adminT1": "2"} {
		if st, corpo := m.Pedir(t, quem, "GET", "/pessoas-que-leio", ""); st != http.StatusOK || corpo != quer {
			t.Errorf("%s lê %s pessoas (%d), esperava %s", quem, corpo, st, quer)
		}
	}
	var fk int
	if err := m.P.QueryRow(t.Context(), `select count(*) from pg_constraint where conrelid = 'patrimonio_bens'::regclass and contype = 'f' and confrelid = 'acessos_pessoas'::regclass`).Scan(&fk); err != nil || fk != 1 {
		t.Errorf("FK pessoa_id dos bens para acessos_pessoas: %d %v", fk, err)
	}
}

func TestDeve(t *testing.T) {
	deve(nil)
	defer func() {
		if recover() == nil {
			t.Error("deve(err) tem de entrar em pânico")
		}
	}()
	deve(fmt.Errorf("rota errada"))
}

func TestTexto(t *testing.T) {
	raw := func(s string) json.RawMessage { return json.RawMessage(s) }
	cem := `"` + string(slices.Repeat([]byte("a"), 100)) + `"`
	for _, c := range []struct {
		nome        string
		v           json.RawMessage
		obrigatorio bool
		ok          bool
	}{
		{"ausente opcional", nil, false, true},
		{"ausente obrigatório", nil, true, false},
		{"texto", raw(`"Mesa"`), true, true},
		{"vazio", raw(`""`), false, false},
		{"só espaços", raw(`"   "`), false, false},
		{"null presente", raw(`null`), false, false},
		{"número", raw(`3`), false, false},
		{"no limite", raw(cem), true, true},
		{"passou do limite", raw(`"` + string(slices.Repeat([]byte("a"), 101)) + `"`), true, false},
		{"acentos contam por caractere", raw(`"` + string(slices.Repeat([]byte("ã"), 100)) + `"`), true, true},
	} {
		if err := texto("nome", c.v, 100, c.obrigatorio); (err == nil) != c.ok {
			t.Errorf("%s: %v", c.nome, err)
		}
	}
}

func TestTextoOuNulo(t *testing.T) {
	raw := func(s string) json.RawMessage { return json.RawMessage(s) }
	for _, c := range []struct {
		nome string
		v    json.RawMessage
		ok   bool
	}{
		{"ausente", nil, true},
		{"null", raw(`null`), true},
		{"vazio passa", raw(`""`), true},
		{"texto", raw(`"abc"`), true},
		{"passou do limite", raw(`"abcdef"`), false},
		{"acentos por caractere", raw(`"ãããããã"`), false},
		{"número", raw(`3`), false},
	} {
		if err := textoOuNulo("obs", c.v, 5); (err == nil) != c.ok {
			t.Errorf("%s: %v", c.nome, err)
		}
	}
	if err := textoOuNulo("obs", raw(`"ããããã"`), 5); err != nil {
		t.Errorf("5 caracteres com acento cabem em 5: %v", err)
	}
}
