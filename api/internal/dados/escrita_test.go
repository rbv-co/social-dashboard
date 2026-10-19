package dados

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
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
	ID        json.RawMessage `json:"id,omitempty"`
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
	cat, err := autz.Compilar([]byte(catalogoDeEscrita))
	if err != nil {
		t.Fatal(err)
	}
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
		  segredo text default 'nunca-na-resposta', criado_por text, editado_por text);
		create table coisa_log (id uuid, quem text);
		create function coisa_audita() returns trigger language plpgsql as $f$
		begin
		  if tg_op = 'DELETE' then
		    insert into coisa_log values (old.id, nullif(current_setting('app.usuario_id', true), ''));
		    return old;
		  end if;
		  new.editado_por := nullif(current_setting('app.usuario_id', true), '');
		  return new;
		end $f$;
		create trigger coisa_upd before update on coisa for each row execute function coisa_audita();
		create trigger coisa_del before delete on coisa for each row execute function coisa_audita();
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
	r.Patch("/autor/{id}", RotaEditar[corpoComAutor](p, cat, autor))
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
		{"autoria no corpo: 400 e nada gravado (não é trocada em silêncio)", "frota-a1", "POST", "/autor", `{"account_id":"A1","criado_por":"forjado"}`, 400, "corpo_invalido", "", total, "4"},
		{"autoria no corpo, com outra caixa: 400", "frota-a1", "POST", "/autor", `{"account_id":"A1","CRIADO_POR":"forjado"}`, 400, "corpo_invalido", "", total, "4"},
		{"id no corpo do POST: 400 e nada gravado", "frota-a1", "POST", "/autor", `{"account_id":"A1","id":"` + coisaA2 + `"}`, 400, "corpo_invalido", "", total, "4"},
		{"Autor sem ser mandado vem da sessão", "frota-a1", "POST", "/autor", `{"account_id":"A1"}`, 201, `"criado_por":"` + quemEscreve + `"`, "", total, "5"},
		{"autoria no corpo do PATCH: 400 e intacta", "so-a1", "PATCH", "/autor/" + coisaA1, `{"criado_por":"forjado"}`, 400, "corpo_invalido", "", linha(coisaA1, "criado_por"), "<nulo>"},
		{"id no corpo do PATCH não troca a chave: 400", "so-a1", "PATCH", "/autor/" + coisaA1, `{"id":"` + coisaA2 + `"}`, 400, "corpo_invalido", "", linha(coisaA1, "count(*)::text"), "1"},
		{"edita só a coluna enviada", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"nome":"um!"}`, 200, `"apelido":"u"`, "", linha(coisaA1, "nome || '/' || apelido"), "um!/u"},
		{"edita com a identidade da transação", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"apelido":"u"}`, 200, `"apelido":"u"`, "", linha(coisaA1, "editado_por"), quemEscreve},
		{"null explícito grava nulo", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"apelido":null}`, 200, `"apelido":null`, "", linha(coisaA1, "apelido"), "<nulo>"},
		{"linha de outra conta: 404 (IDOR)", "so-a1", "PATCH", "/coisas/" + coisaA2, `{"nome":"x"}`, 404, "nao_encontrado", "", linha(coisaA2, "nome"), "dois"},
		{"mover para conta que não vê: 403", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"account_id":"A2"}`, 403, "sem_permissao", "", linha(coisaA1, "account_id"), "A1"},
		{"id que nem é uuid: 404", "so-a1", "PATCH", "/coisas/1%20or%201=1", `{"nome":"x"}`, 404, "nao_encontrado", "", "", ""},
		{"tipo errado na edição: 400 e intacta", "so-a1", "PATCH", "/coisas/" + coisaA1, `{"nivel":"alto"}`, 400, "pedido_invalido", "", linha(coisaA1, "nivel::text"), "<nulo>"},
		{"apagar sem a regra: 403 e fica", "so-a1", "DELETE", "/coisas/" + coisaA1, "", 403, "sem_permissao", "", linha(coisaA1, "count(*)::text"), "1"},
		{"apagar linha invisível: 404 e fica", "so-a1", "DELETE", "/coisas/" + coisaA2, "", 404, "nao_encontrado", "", linha(coisaA2, "count(*)::text"), "1"},
		{"super pela ficha apaga", "super", "DELETE", "/coisas/" + coisaA2, "", 204, "", "", linha(coisaA2, "count(*)::text"), "0"},
		{"apaga com a identidade da transação", "super", "DELETE", "/coisas/" + coisaA1, "", 204, "", "", "select quem from coisa_log where id = '" + coisaA1 + "'", quemEscreve},
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

// A montagem recusa declaração inválida (a API não sobe) e o corpo que não segue a regra:
// todo campo exportado é json.RawMessage com `json:"<coluna>,omitempty"`.
func TestMontagemDaEscrita(t *testing.T) {
	cat, err := autz.Compilar([]byte(catalogoDeEscrita))
	if err != nil {
		t.Fatal(err)
	}
	bom := Tabela{Nome: "coisa", Resposta: "t.id"}
	type (
		boa struct {
			A json.RawMessage `json:"a,omitempty"`
		}
		semOmit struct {
			A json.RawMessage `json:"a"`
		}
		texto struct {
			A string `json:"a,omitempty"`
		}
		ponteiro struct {
			A *string `json:"a,omitempty"`
		}
		semTag    struct{ A json.RawMessage }
		colunaRim struct {
			A json.RawMessage `json:"A b,omitempty"`
		}
		embutida struct{ boa }
	)
	panica := func(f func()) (p bool) {
		defer func() { p = recover() != nil }()
		f()
		return
	}
	casos := []struct {
		nome   string
		monta  func()
		panica bool
	}{
		{"tabela fora do catálogo (criar)", func() { RotaCriar[boa](nil, cat, Tabela{Nome: "fora", Resposta: "t.id"}) }, true},
		{"tabela fora do catálogo (editar)", func() { RotaEditar[boa](nil, cat, Tabela{Nome: "fora", Resposta: "t.id"}) }, true},
		{"tabela fora do catálogo (apagar)", func() { RotaApagar(nil, cat, Tabela{Nome: "fora", Resposta: "t.id"}) }, true},
		{"sem Resposta (apagar)", func() { RotaApagar(nil, cat, Tabela{Nome: "coisa"}) }, true},
		{"campo string sem RawMessage", func() { RotaEditar[texto](nil, cat, bom) }, true},
		{"campo *string", func() { RotaEditar[ponteiro](nil, cat, bom) }, true},
		{"RawMessage sem omitempty", func() { RotaEditar[semOmit](nil, cat, bom) }, true},
		{"campo sem tag", func() { RotaCriar[semTag](nil, cat, bom) }, true},
		{"coluna inválida na tag", func() { RotaCriar[colunaRim](nil, cat, bom) }, true},
		{"struct embutida", func() { RotaCriar[embutida](nil, cat, bom) }, true},
		{"corpo que não é struct", func() { RotaCriar[string](nil, cat, bom) }, true},
		{"declaração correta", func() {
			RotaCriar[boa](nil, cat, bom)
			RotaEditar[boa](nil, cat, bom)
			RotaApagar(nil, cat, bom)
		}, false},
	}
	for _, c := range casos {
		if got := panica(c.monta); got != c.panica {
			t.Errorf("%s: panic = %v, esperava %v", c.nome, got, c.panica)
		}
	}
}

// Sem escopo, as três operações respondem igual (negado), nunca 500 numa e 403 em outra.
func TestEscritaSemEscopoNegaIgual(t *testing.T) {
	cat, err := autz.Compilar([]byte(catalogoDeEscrita))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table coisa (id uuid primary key default gen_random_uuid(), account_id text)`); err != nil {
		t.Fatal(err)
	}
	tab := Tabela{Nome: "coisa", Resposta: "t.id"}
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tab.Criar(ctx, tx, cat, nil, map[string]any{"account_id": "A1"}); !errors.Is(err, autz.ErrNegado) {
		t.Errorf("Criar sem escopo = %v", err)
	}
	if _, err := tab.Editar(ctx, tx, cat, nil, coisaA1, map[string]any{"account_id": "A1"}); !errors.Is(err, autz.ErrNegado) {
		t.Errorf("Editar sem escopo = %v", err)
	}
	if err := tab.Apagar(ctx, tx, cat, nil, coisaA1); !errors.Is(err, autz.ErrNegado) {
		t.Errorf("Apagar sem escopo = %v", err)
	}
}

// Mapa vazio e coluna proibida vindos de um handler próprio são 400, não 500.
func TestErroDeEscritaDoHelper(t *testing.T) {
	for _, c := range []struct {
		err    error
		status int
	}{{ErrSemCampos, 400}, {ErrColunaProibida, 400}} {
		w := httptest.NewRecorder()
		ErroDeEscrita(w, fmt.Errorf("embrulhado: %w", c.err))
		if w.Code != c.status || !strings.Contains(w.Body.String(), "corpo_invalido") {
			t.Errorf("%v: %d %s", c.err, w.Code, w.Body.String())
		}
	}
}

// Corpo sem a coluna que a regra de criar lê: 400 do pedido (a struct declara a coluna); defeito
// de declaração (a struct nem declara a coluna) continua 500.
func TestCriarSemColunaDaRegra(t *testing.T) {
	cat, err := autz.Compilar([]byte(`[
 {"tabela":"item","nome":"le","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null},
 {"tabela":"item","nome":"cria","tipo":"permissive","comando":"insert","papeis":["authenticated"],"using":null,"withCheck":"pode_ver_conta(account_id)"}
]`))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), `create table item (id uuid primary key default gen_random_uuid(), account_id text, nome text)`); err != nil {
		t.Fatal(err)
	}
	tab := Tabela{Nome: "item", Resposta: "t.id, t.account_id, t.nome"}
	type comConta struct {
		AccountID json.RawMessage `json:"account_id,omitempty"`
		Nome      json.RawMessage `json:"nome,omitempty"`
	}
	type semConta struct {
		Nome json.RawMessage `json:"nome,omitempty"`
	}
	e := &autz.Escopo{ID: quemEscreve, TemPerfil: true, Ativo: true, SemTrava: true, Contas: []string{"A1"}}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			next.ServeHTTP(w, req.WithContext(autz.NoContexto(req.Context(), e)))
		})
	})
	r.Post("/com", RotaCriar[comConta](p, cat, tab))
	r.Post("/sem", RotaCriar[semConta](p, cat, tab))
	for _, c := range []struct {
		caminho, corpo string
		status         int
		tem            string
	}{
		{"/com", `{"nome":"x"}`, 400, "pedido_invalido"},
		{"/com", `{"account_id":"A1","nome":"x"}`, 201, `"account_id":"A1"`},
		{"/sem", `{"nome":"x"}`, 500, "erro_interno"},
	} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest("POST", c.caminho, strings.NewReader(c.corpo)))
		if w.Code != c.status || !strings.Contains(w.Body.String(), c.tem) {
			t.Errorf("%s %s: %d %s", c.caminho, c.corpo, w.Code, w.Body.String())
		}
	}
	var n int
	p.QueryRow(context.Background(), `select count(*) from item`).Scan(&n)
	if n != 1 {
		t.Errorf("linhas gravadas = %d, esperava 1", n)
	}
}

func TestParamDecodificado(t *testing.T) {
	for _, c := range []struct{ caminho, quer string }{{"/x/a%2Fb", "a/b"}, {"/x/c_vendas", "c_vendas"}} {
		r := httptest.NewRequest("GET", c.caminho, nil)
		rc := chi.NewRouteContext()
		rc.URLParams.Add("id", c.caminho[len("/x/"):])
		r = r.WithContext(context.WithValue(r.Context(), chi.RouteCtxKey, rc))
		if got := Param(r, "id"); got != c.quer {
			t.Errorf("Param(%s) = %q, esperava %q", c.caminho, got, c.quer)
		}
	}
}
