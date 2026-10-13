package acessos

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// A sonda /eco devolve o que a cadeia de produção entregou ao handler. is_acessos_admin() = ativa e
// (papel admin ou módulo acessos): o super (ficha ou e-mail) NÃO entra; quem entrou como outra
// pessoa tem o escopo do ALVO e o ImpersonadorID preenchido.
func TestMundoDosAcessos(t *testing.T) {
	m := novoMundo(t, func(r chi.Router, _ *pgxpool.Pool) {
		r.Get("/eco", func(w http.ResponseWriter, r *http.Request) {
			e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
			_, _ = fmt.Fprintf(w, "%t|%s|%t", autz.AcessosAdmin(e), e.Papel, a.ImpersonadorID != nil)
		})
	})
	casos := []caso{{Nome: "sem sessão", Quem: "", Metodo: "GET", Caminho: "/eco", Status: http.StatusUnauthorized}}
	for quem, quer := range map[string]string{
		"acessos": "true|viewer|false", "admin": "true|admin|false",
		"superFicha": "false|viewer|false", "superEmail": "false|viewer|false", "frota": "false|viewer|false",
		"patrimonio": "false|viewer|false", "viewer": "false|viewer|false",
		"impersonado": "true|viewer|true",
	} {
		casos = append(casos, caso{Nome: quem, Quem: quem, Metodo: "GET", Caminho: "/eco", Status: http.StatusOK, Tem: quer})
	}
	casos = append(casos, caso{Nome: "conta desativada", Quem: "desativado", Metodo: "GET", Caminho: "/eco", Status: http.StatusUnauthorized})
	comSessaoSemPerfil(t, m, "semPerfil", "a4000000-0000-4000-a000-0000000000ff")
	casos = append(casos, caso{Nome: "sem perfil", Quem: "semPerfil", Metodo: "GET", Caminho: "/eco", Status: http.StatusOK, Tem: "false||false"})
	m.Rodar(t, casos)
	// o corpo é exatamente a linha (Tem só confere contido): igualdade por pessoa
	for quem, quer := range map[string]string{"acessos": "true|viewer|false", "superEmail": "false|viewer|false", "impersonado": "true|viewer|true"} {
		if st, corpo := m.Pedir(t, quem, "GET", "/eco", ""); st != http.StatusOK || corpo != quer {
			t.Errorf("%s: %d %q, esperava %q", quem, st, corpo, quer)
		}
	}

	// o elo ficha↔login que o Escopo lê (pode_ver_bem): UMA ficha para quem está ligada, nenhuma para as outras
	for _, x := range pessoas {
		e, err := autz.CarregarEscopo(t.Context(), m.P, x.ID)
		if err != nil {
			t.Fatal(err)
		}
		quer := []string(nil)
		if x.ID == idAcessos {
			quer = []string{P1}
		}
		if !slices.Equal(e.Pessoas, quer) {
			t.Errorf("%s: Escopo.Pessoas = %v, esperava %v", x.Chave, e.Pessoas, quer)
		}
	}
}

// O mundo planta segredos em acessos_conexoes e a vigia os procura em TODA resposta.
func TestSegredosDoMundo(t *testing.T) {
	m := novoMundo(t)
	// os cinco valores falsos estão mesmo no banco (senão "nunca sai" prova nada)
	for _, s := range segredos {
		if n := m.Um(t, `select count(*)::text from acessos_conexoes where $1 in (client_secret, refresh_token, oauth_state)`, s); n != "1" {
			t.Errorf("segredo %q plantado %s vez(es) em acessos_conexoes, esperava 1", s, n)
		}
	}
	if n := m.Um(t, `select count(*)::text from acessos_conexoes where client_secret like 'SEGREDO-%' or refresh_token like 'SEGREDO-%' or oauth_state like 'SEGREDO-%'`); n != "2" {
		t.Errorf("conexões com segredo plantado = %s, esperava 2 (zoho e microsoft)", n)
	}

	if segredoEm("ok, sem nada") != "" || segredoEm(`{"provedor":"zoho","client_id":"cli-zoho"}`) != "" {
		t.Error("segredoEm achou segredo onde não há")
	}
	for _, c := range []string{"x SEGREDO-refresh-ms y", `{"a":"SEGREDO-cliente-zoho"}`, "SEGREDO-novo-esquecido-na-lista"} {
		if segredoEm(c) == "" {
			t.Errorf("segredoEm não achou o segredo em %q", c)
		}
	}

	// a vigia pega o vazamento no corpo e no cabeçalho, deixa a resposta limpa passar INTEIRA
	var achados []string
	h := http.NewServeMux()
	h.HandleFunc("/limpa", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("X-Teste", "1")
		w.WriteHeader(http.StatusCreated)
		_, _ = w.Write([]byte(`{"ok":true}`))
	})
	h.HandleFunc("/vaza-corpo", func(w http.ResponseWriter, _ *http.Request) { _, _ = w.Write([]byte(segredos[1])) })
	h.HandleFunc("/vaza-cookie", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Set-Cookie", "estado="+segredos[2])
	})
	v := vigiarSegredos(h, func(f string, a ...any) { achados = append(achados, fmt.Sprintf(f, a...)) })
	w := httptest.NewRecorder()
	v.ServeHTTP(w, httptest.NewRequest("GET", "/limpa", nil))
	if w.Code != http.StatusCreated || w.Body.String() != `{"ok":true}` || w.Header().Get("X-Teste") != "1" || len(achados) != 0 {
		t.Errorf("resposta limpa alterada: %d %q %v %v", w.Code, w.Body.String(), w.Header(), achados)
	}
	for _, c := range []string{"/vaza-corpo", "/vaza-cookie"} {
		antes := len(achados)
		v.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("GET", c, nil))
		if len(achados) != antes+1 {
			t.Errorf("a vigia deixou %s passar", c)
		}
	}
}

// A foto enxerga toda tabela que uma rota do 5.4 pode gravar, direto ou por FK: as 14 acessos_* e
// as que têm FK para elas (excluir colaborador zera pessoa_id em bens e carros, por exemplo).
func TestFotoDosAcessosCobreOQueAsRotasGravam(t *testing.T) {
	m := novoMundo(t)
	l, err := m.P.Query(t.Context(), `
		select distinct c.conrelid::regclass::text from pg_constraint c
		  join pg_class a on a.oid = c.confrelid and a.relname like 'acessos\_%'
		 where c.contype = 'f' and c.confrelid <> c.conrelid
		union select relname from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace and relname like 'acessos\_%'`)
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	var tabelas []string
	for l.Next() {
		var n string
		if err := l.Scan(&n); err != nil {
			t.Fatal(err)
		}
		tabelas = append(tabelas, n)
	}
	if err := l.Err(); err != nil {
		t.Fatal(err)
	}
	if n := len(tabelas); n < 14 {
		t.Fatalf("só %d tabelas ligadas às acessos_*: %v", n, tabelas)
	}
	// as duas únicas ligadas por FK que nenhuma rota do 5.4 grava: o perfil de acesso é do 5.1 (profiles
	// aponta para acessos_perfis) e o elo ficha↔login mora em acessos_pessoas.profile_id
	foraDaFoto := []string{"acessos_perfis", "profiles"}
	for _, tb := range tabelas {
		if slices.Contains(foraDaFoto, tb) {
			continue
		}
		if !strings.Contains(fotoDosAcessos, " from "+tb+" t") {
			t.Errorf("a foto não enxerga %s", tb)
		}
	}
	// e a foto muda quando uma delas muda (hash estável sem mexer, diferente depois de mexer)
	a := m.Um(t, fotoDosAcessos)
	if b := m.Um(t, fotoDosAcessos); a != b {
		t.Error("a foto não é estável")
	}
	for _, sql := range []string{
		`update acessos_conexoes set refresh_token = 'SEGREDO-outro' where provedor = 'zoho'`,
		`update equipes set setor_id = null`,
		`update patrimonio_bens set pessoa_id = null`,
		`update patrimonio_posse set pessoa_id = null`,
		`update frota_veiculos set pessoa_id = null`,
		`update frota_uso set pessoa_id = null`,
	} {
		antes := m.Um(t, fotoDosAcessos)
		if _, err := m.P.Exec(t.Context(), sql); err != nil {
			t.Fatal(err)
		}
		if m.Um(t, fotoDosAcessos) == antes {
			t.Errorf("a foto não viu %q", sql)
		}
	}
}

func TestSoSessaoPropria(t *testing.T) {
	chamou := false
	h := soSessaoPropria(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		chamou = true
		w.WriteHeader(http.StatusNoContent)
	}))
	imp := idSuperFicha
	for _, c := range []struct {
		nome   string
		ator   *auth.Ator
		status int
		roda   bool
	}{
		{"sem ator", nil, http.StatusForbidden, false},
		{"ator próprio", &auth.Ator{ID: idAcessos}, http.StatusNoContent, true},
		{"impersonado", &auth.Ator{ID: idAcessos, ImpersonadorID: &imp}, http.StatusForbidden, false},
	} {
		chamou = false
		r := httptest.NewRequest("POST", "/x", nil)
		if c.ator != nil {
			r = r.WithContext(auth.NoContexto(r.Context(), c.ator))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.status || chamou != c.roda {
			t.Errorf("%s: %d (handler rodou = %t), esperava %d (%t)", c.nome, w.Code, chamou, c.status, c.roda)
		}
		if c.status == http.StatusForbidden {
			var e struct{ Error, Mensagem string }
			if err := json.Unmarshal(w.Body.Bytes(), &e); err != nil || e.Error != "sem_permissao" ||
				e.Mensagem != "Quem entrou como outra pessoa não grava em Colaboradores e Acessos." {
				t.Errorf("%s: corpo %q", c.nome, w.Body.String())
			}
		}
	}
}

func TestEmBranco(t *testing.T) {
	for v, quer := range map[string]bool{`"Ana"`: false, ``: true, `null`: true, `"  "`: true, `""`: true, `1`: true, `["Ana"]`: true} {
		if got := emBranco(json.RawMessage(v)); got != quer {
			t.Errorf("emBranco(%q) = %t, esperava %t", v, got, quer)
		}
	}
}

func TestDeve(t *testing.T) {
	deve(nil)
	defer func() {
		if recover() == nil {
			t.Error("deve(err) não entrou em pânico")
		}
	}()
	deve(fmt.Errorf("declaração errada"))
}
