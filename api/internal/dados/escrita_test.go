package dados

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const catalogoDeEscrita = `[
 {"tabela":"coisa","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null},
 {"tabela":"coisa","nome":"cria","tipo":"permissive","comando":"insert","papeis":["authenticated"],"using":null,"withCheck":"is_frota_admin()"},
 {"tabela":"coisa","nome":"edita","tipo":"permissive","comando":"update","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":"pode_ver_conta(account_id)"},
 {"tabela":"coisa","nome":"apaga","tipo":"permissive","comando":"delete","papeis":["authenticated"],"using":"superadmin_pela_ficha()","withCheck":null}
]`

const (
	quemEscreve = "11111111-0000-4000-a000-000000000001"
	coisaA1     = "aaaaaaaa-0000-4000-a000-000000000001"
	coisaA2     = "aaaaaaaa-0000-4000-a000-000000000002"
)

type corpoCoisa struct {
	AccountID json.RawMessage `json:"account_id,omitempty"`
	Nome      json.RawMessage `json:"nome,omitempty"`
	Apelido   json.RawMessage `json:"apelido,omitempty"`
	Nivel     json.RawMessage `json:"nivel,omitempty"`
}

// corpoComAutor declara a coluna do autor: mesmo assim, quem vale é a sessão.
type corpoComAutor struct {
	AccountID json.RawMessage `json:"account_id,omitempty"`
	CriadoPor json.RawMessage `json:"criado_por,omitempty"`
}

func (c corpoCoisa) Validar() error {
	if string(c.Nome) == `"proibido"` {
		return errors.New("nome proibido")
	}
	return nil
}

func TestCampos(t *testing.T) {
	var c corpoCoisa
	if err := json.Unmarshal([]byte(`{"nome":"x","apelido":null}`), &c); err != nil {
		t.Fatal(err)
	}
	m, err := Campos(&c)
	if err != nil || len(m) != 2 {
		t.Fatalf("campos = %v %v (ausente entrou ou null sumiu)", m, err)
	}
	if j, _ := json.Marshal(m); string(j) != `{"apelido":null,"nome":"x"}` {
		t.Fatalf("campos = %s", j)
	}
	type ruim struct {
		X json.RawMessage `json:"x; drop table coisa,omitempty"`
	}
	if _, err := Campos(&ruim{X: json.RawMessage(`1`)}); err == nil {
		t.Fatal("tag de coluna inválida passou")
	}
}

func TestTabelaValidar(t *testing.T) {
	cat, _ := autz.Compilar([]byte(catalogoDeEscrita))
	for _, tb := range []Tabela{{Nome: "fora", Resposta: "t.id"}, {Nome: "coisa"}, {Nome: "coisa", Resposta: "t.id", Autor: "x y"}} {
		if tb.Validar(cat) == nil {
			t.Errorf("%+v validou", tb)
		}
	}
}

func montarEscrita(t *testing.T) (http.Handler, *pgxpool.Pool) {
	t.Helper()
	cat, err := autz.Compilar([]byte(catalogoDeEscrita))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), `create table coisa (
		  id uuid primary key default gen_random_uuid(), account_id text, nome text not null default 'sem nome',
		  apelido text, nivel int, quem uuid default nullif(current_setting('app.usuario_id', true), '')::uuid,
		  segredo text default 'nunca-na-resposta', criado_por text);
		insert into coisa (id, account_id, nome, apelido) values ('`+coisaA1+`', 'A1', 'um', 'u'), ('`+coisaA2+`', 'A2', 'dois', 'd')`); err != nil {
		t.Fatal(err)
	}
	tab := Tabela{Nome: "coisa", Resposta: "t.id, t.account_id, t.nome, t.apelido, t.nivel, t.quem"}
	if err := tab.Validar(cat); err != nil {
		t.Fatal(err)
	}
	escopos := map[string]*autz.Escopo{
		"frota-a1": {ID: quemEscreve, TemPerfil: true, Ativo: true, SemTrava: true, Modulos: []string{"frota"}, Contas: []string{"A1"}},
		"so-a1":    {ID: quemEscreve, TemPerfil: true, Ativo: true, SemTrava: true, Contas: []string{"A1"}},
		"super":    {ID: quemEscreve, TemPerfil: true, Ativo: true, SuperFicha: true},
	}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			if e := escopos[req.Header.Get("X-Quem")]; e != nil {
				req = req.WithContext(autz.NoContexto(req.Context(), e))
			}
			next.ServeHTTP(w, req)
		})
	})
	r.Post("/coisas", RotaCriar[corpoCoisa](p, cat, tab))
	autor := tab
	autor.Resposta += ", t.criado_por"
	autor.Autor = "criado_por"
	r.Post("/autor", RotaCriar[corpoComAutor](p, cat, autor))
	r.Patch("/coisas/{id}", RotaEditar[corpoCoisa](p, cat, tab))
	r.Delete("/coisas/{id}", RotaApagar(p, cat, tab))
	return r, p
}

func TestEscritaDeclarada(t *testing.T) {
	h, p := montarEscrita(t)
	um := func(sql string) string {
		var v *string
		if err := p.QueryRow(context.Background(), sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}
	const total = "select count(*)::text from coisa"
	linha := func(id, cols string) string { return "select " + cols + " from coisa where id = '" + id + "'" }
	casos := []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		tem, naoTem, efeito, quer          string
	}{
		{"cria e devolve pela lista da leitura, com a identidade da transação", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nome":"tres"}`, 201, `"quem":"` + quemEscreve + `"`, "nunca-na-resposta", total, "3"},
		{"cria linha que depois não lê: só o id", "frota-a1", "POST", "/coisas", `{"account_id":"A2","nome":"quatro"}`, 201, `{"id":`, `"nome"`, total, "4"},
		{"sem a regra de criar: 403 e nada gravado", "so-a1", "POST", "/coisas", `{"account_id":"A1"}`, 403, "sem_permissao", "", total, "4"},
		{"campo não declarado: 400 e nada gravado", "frota-a1", "POST", "/coisas", `{"account_id":"A1","segredo":"x"}`, 400, "corpo_invalido", "", total, "4"},
		{"tipo que a coluna não aceita: 400 e nada gravado", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nivel":"alto"}`, 400, "pedido_invalido", "", total, "4"},
		{"corpo vazio", "frota-a1", "POST", "/coisas", `{}`, 400, "Nada para gravar", "", total, "4"},
		{"Validar da struct", "frota-a1", "POST", "/coisas", `{"account_id":"A1","nome":"proibido"}`, 400, "nome proibido", "", total, "4"},
		{"sem escopo no contexto: 500 e nada gravado", "", "POST", "/coisas", `{"account_id":"A1"}`, 500, "erro_interno", "", total, "4"},
		{"Autor vem da sessão, não do corpo", "frota-a1", "POST", "/autor", `{"account_id":"A1","criado_por":"forjado"}`, 201, `"criado_por":"` + quemEscreve + `"`, "forjado", total, "5"},
		{"edita só a coluna enviada", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"nome":"um!"}`, 200, `"apelido":"u"`, "", linha(coisaA1, "nome || '/' || apelido"), "um!/u"},
		{"null explícito grava nulo", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"apelido":null}`, 200, `"apelido":null`, "", linha(coisaA1, "apelido"), "<nulo>"},
		{"linha de outra conta: 404 (IDOR)", "so-a1", "PATCH", "/coisas/" + coisaA2, `{"nome":"x"}`, 404, "nao_encontrado", "", linha(coisaA2, "nome"), "dois"},
		{"mover para conta que não vê: 403", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"account_id":"A2"}`, 403, "sem_permissao", "", linha(coisaA1, "account_id"), "A1"},
		{"id que nem é uuid: 404", "so-a1", "PATCH", "/coisas/1%20or%201=1", `{"nome":"x"}`, 404, "nao_encontrado", "", "", ""},
		{"tipo errado na edição: 400 e intacta", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"nivel":"alto"}`, 400, "pedido_invalido", "", linha(coisaA1, "nivel::text"), "<nulo>"},
		{"apagar sem a regra: 403 e fica", "so-a1", "DELETE", "/coisas/" + coisaA1, "", 403, "sem_permissao", "", linha(coisaA1, "count(*)::text"), "1"},
		{"apagar linha invisível: 404 e fica", "so-a1", "DELETE", "/coisas/" + coisaA2, "", 404, "nao_encontrado", "", linha(coisaA2, "count(*)::text"), "1"},
		{"super pela ficha apaga", "super", "DELETE", "/coisas/" + coisaA2, "", 204, "", "", linha(coisaA2, "count(*)::text"), "0"},
	}
	for _, c := range casos {
		r := httptest.NewRequest(c.metodo, c.caminho, strings.NewReader(c.corpo))
		r.Header.Set("X-Quem", c.quem)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		corpo := w.Body.String()
		if w.Code != c.status || (c.tem != "" && !strings.Contains(corpo, c.tem)) || (c.naoTem != "" && strings.Contains(corpo, c.naoTem)) {
			t.Errorf("%s: %d %s", c.nome, w.Code, corpo)
		}
		if c.efeito != "" {
			if v := um(c.efeito); v != c.quer {
				t.Errorf("%s: efeito %q = %q, esperava %q", c.nome, c.efeito, v, c.quer)
			}
		}
	}
}
