package rpc

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const quemPede = "11111111-0000-4000-a000-000000000001"

var (
	todos   = autz.Regra(func(*autz.Escopo) bool { return true })
	ninguem = autz.Regra(func(*autz.Escopo) bool { return false })
)

// montarCom monta o registro sobre um banco novo; ator e escopo são o que o middleware "pôs"
// no contexto (nil = ausente).
func montarCom(t *testing.T, ator *auth.Ator, escopo *autz.Escopo, fs ...Funcao) (*pgxpool.Pool, http.Handler) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), `
		create table marca (quem text);
		create function soma(p_a integer, p_b integer default 1) returns integer language sql as $$ select p_a + p_b $$;
		create function lista(p_ids uuid[]) returns table(id uuid, n int) language sql as $$ select x, 1 from unnest(p_ids) x order by x $$;
		create function tam(p_ids uuid[]) returns integer language sql as $$ select cardinality(p_ids) $$;
		create function quem() returns text language sql as $$ select current_setting('app.usuario_id', true) $$;
		create function marcar() returns void language sql as $$ insert into marca values (current_setting('app.usuario_id', true)) $$;
		create function marcar_e_falhar() returns int language plpgsql as $$ begin insert into marca values ('x'); raise exception 'Falhou depois de gravar'; end $$;
		create function negada() returns int language plpgsql as $$ begin raise exception 'Sem acesso para isso' using errcode = '42501'; end $$;
		create function regra() returns int language plpgsql as $$ begin raise exception 'Lote já gravado'; end $$;
		create function eco(p_j jsonb) returns jsonb language sql as $$ select p_j $$;
		create function eco_texto(p_t text) returns text language sql as $$ select p_t $$;
		create function nulo() returns int language sql as $$ select null::int $$;
		create function tabela_com_r() returns table(r int, x text) language sql as $$ select 1, 'a' union all select 2, 'b' $$;
		create function muitas() returns table(n int, m int) language sql as $$ select g, 1 from generate_series(1, 5000) g $$;
		create function escalares() returns setof integer language sql as $$ select generate_series(1, 3) $$;
		create function nenhuma() returns table(n int) language sql as $$ select 1 where false $$;
		create function textos(p_t text[]) returns integer language sql as $$ select cardinality(p_t) $$;
		create function ints(p_i integer[]) returns integer language sql as $$ select cardinality(p_i) $$;`); err != nil {
		t.Fatal(err)
	}
	reg, err := Novo(p, fs...)
	if err != nil {
		t.Fatal(err)
	}
	r := chi.NewRouter()
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			ctx := req.Context()
			if ator != nil {
				ctx = auth.NoContexto(ctx, ator)
			}
			if escopo != nil {
				ctx = autz.NoContexto(ctx, escopo)
			}
			next.ServeHTTP(w, req.WithContext(ctx))
		})
	})
	r.Post("/rpc/{nome}", reg.ServeHTTP)
	return p, r
}

func montar(t *testing.T, fs ...Funcao) (*pgxpool.Pool, http.Handler) {
	t.Helper()
	return montarCom(t, &auth.Ator{ID: quemPede, Tipo: "painel"}, &autz.Escopo{ID: quemPede}, fs...)
}

func chamar(h http.Handler, nome, corpo string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("POST", "/rpc/"+nome, strings.NewReader(corpo)))
	return w
}

func marcas(t *testing.T, p *pgxpool.Pool) int {
	t.Helper()
	var n int
	if err := p.QueryRow(context.Background(), `select count(*) from marca`).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestRPCChamaComParametrosNomeadosEIdentidade(t *testing.T) {
	_, h := montar(t,
		Funcao{Nome: "soma", Params: []Param{{Nome: "p_a", Tipo: "integer"}, {Nome: "p_b", Tipo: "integer", Opcional: true}}, Portao: todos},
		Funcao{Nome: "lista", Params: []Param{{Nome: "p_ids", Tipo: "uuid[]"}}, Retorno: Conjunto, Portao: todos},
		Funcao{Nome: "quem", Portao: todos},
		Funcao{Nome: "eco", Params: []Param{{Nome: "p_j", Tipo: "jsonb"}}, Portao: todos},
		Funcao{Nome: "nulo", Portao: todos},
		Funcao{Nome: "negada", Portao: todos},
		Funcao{Nome: "regra", Portao: todos},
	)
	casos := []struct {
		nome, corpo string
		status      int
		quer        string
	}{
		{"soma", `{"p_a":2}`, 200, `3`},
		{"soma", `{"p_a":2,"p_b":5}`, 200, `7`},
		{"soma", `{}`, 400, `{"error":"pedido_invalido","mensagem":"falta o parâmetro p_a"}`},
		{"soma", `{"p_a":"x"}`, 400, `{"error":"pedido_invalido"}`},
		{"soma", `{"p_a":1,"p_c":1}`, 400, `{"error":"pedido_invalido","mensagem":"parâmetro desconhecido: p_c"}`},
		{"soma", `{"p_a":1} lixo`, 400, `{"error":"corpo_invalido"}`},
		{"lista", `{"p_ids":["bbbbbbbb-0000-4000-a000-000000000002","aaaaaaaa-0000-4000-a000-000000000001"]}`, 200,
			`[{"id":"aaaaaaaa-0000-4000-a000-000000000001","n":1}, {"id":"bbbbbbbb-0000-4000-a000-000000000002","n":1}]`},
		{"lista", `{"p_ids":"aaaaaaaa-0000-4000-a000-000000000001"}`, 400, `{"error":"pedido_invalido","mensagem":"p_ids deve ser uma lista"}`},
		{"quem", ``, 200, `"` + quemPede + `"`},
		{"eco", `{"p_j":{"a":[1,"x"]}}`, 200, `{"a": [1, "x"]}`},
		{"eco", `{"p_j":null}`, 200, `null`},
		{"nulo", `{}`, 200, `null`},
		// 42501 do RAISE da função: 403 com a frase (como o PostgREST)
		{"negada", `{}`, 403, `{"error":"sem_permissao","mensagem":"Sem acesso para isso"}`},
		{"regra", `{}`, 400, `{"error":"regra_de_negocio","mensagem":"Lote já gravado"}`},
		{"pg_sleep", `{}`, 404, `{"error":"nao_encontrado"}`}, // não registrada: lista branca
		{"marcar", `{}`, 404, `{"error":"nao_encontrado"}`},
	}
	for _, c := range casos {
		w := chamar(h, c.nome, c.corpo)
		if w.Code != c.status || strings.TrimSpace(w.Body.String()) != c.quer {
			t.Errorf("%s %s = %d %s, esperava %d %s", c.nome, c.corpo, w.Code, w.Body, c.status, c.quer)
		}
	}
}

// O portão vem ANTES da função: negado = 403 e a função nem roda (a marca não é gravada).
func TestRPCPortaoAntesDaFuncao(t *testing.T) {
	p, h := montar(t, Funcao{Nome: "marcar", Retorno: Nada, Portao: ninguem})
	if w := chamar(h, "marcar", `{}`); w.Code != 403 {
		t.Fatalf("portão fechado = %d %s", w.Code, w.Body)
	}
	if n := marcas(t, p); n != 0 {
		t.Fatalf("a função rodou com o portão fechado (%d marcas)", n)
	}
	p2, h2 := montar(t, Funcao{Nome: "marcar", Retorno: Nada, Portao: todos})
	if w := chamar(h2, "marcar", ``); w.Code != 204 {
		t.Fatalf("portão aberto = %d %s", w.Code, w.Body)
	}
	var quem string
	if err := p2.QueryRow(context.Background(), `select quem from marca`).Scan(&quem); err != nil || quem != quemPede {
		t.Fatalf("marca = %q %v (a escrita não viu quem pede)", quem, err)
	}
}

// Portão fechado vem antes até da leitura do corpo: nem parâmetro ruim, nem corpo lixo mudam
// a resposta (não dá para sondar a assinatura da função sem permissão).
func TestRPCPortaoFechadoNaoVazaNadaDaAssinatura(t *testing.T) {
	_, h := montar(t, Funcao{Nome: "soma", Params: []Param{{Nome: "p_a", Tipo: "integer"}}, Portao: ninguem})
	for _, corpo := range []string{``, `{}`, `{"p_a":1}`, `{"p_a":"x","zzz":1}`, `lixo`, `[`} {
		w := chamar(h, "soma", corpo)
		if w.Code != 403 || strings.TrimSpace(w.Body.String()) != `{"error":"sem_permissao"}` {
			t.Errorf("corpo %q = %d %s", corpo, w.Code, w.Body)
		}
	}
}

// Todo portão exportado de autz fecha para quem não tem ficha (escopo vazio) e a função não
// roda; e o portão aberto de verdade (super-admin pela ficha) deixa passar.
func TestRPCCadaPortaoDeAutzNega(t *testing.T) {
	portoes := map[string]autz.Regra{
		"FrotaAdmin": autz.FrotaAdmin, "AcessosAdmin": autz.AcessosAdmin, "PatrimonioAdmin": autz.PatrimonioAdmin,
		"VesselAdmin": autz.VesselAdmin, "VesselLeads": autz.VesselLeads, "PodeVerVendas": autz.PodeVerVendas,
		"SuperFicha": autz.SuperFicha, "SuperEmail": autz.SuperEmail, "PodeAprovarFrota": autz.PodeAprovarFrota,
		"PodeCadastrarPessoaRapida": autz.PodeCadastrarPessoaRapida, "VesselAtendimentos": autz.VesselAtendimentos,
		"VesselAtendimentosEditar": autz.VesselAtendimentosEditar,
	}
	vp, err := autz.VesselPode("atendimentos", "editar")
	if err != nil {
		t.Fatal(err)
	}
	portoes["VesselPode(atendimentos,editar)"] = vp
	for nome, regra := range portoes {
		p, h := montarCom(t, &auth.Ator{ID: quemPede, Tipo: "painel"}, &autz.Escopo{ID: quemPede},
			Funcao{Nome: "marcar", Retorno: Nada, Portao: regra})
		if w := chamar(h, "marcar", `{}`); w.Code != 403 || marcas(t, p) != 0 {
			t.Errorf("%s: sem ficha = %d %s (marcas %d)", nome, w.Code, w.Body, marcas(t, p))
		}
	}
	p, h := montarCom(t, &auth.Ator{ID: quemPede, Tipo: "painel"}, &autz.Escopo{ID: quemPede, TemPerfil: true, Ativo: true, SuperFicha: true},
		Funcao{Nome: "marcar", Retorno: Nada, Portao: autz.SuperFicha})
	if w := chamar(h, "marcar", `{}`); w.Code != 204 || marcas(t, p) != 1 {
		t.Errorf("super pela ficha = %d %s", w.Code, w.Body)
	}
}

// Sem ator, sem escopo, escopo de outra pessoa ou sessão que não é de painel/serviço: nada roda.
func TestRPCSessaoEIdentidade(t *testing.T) {
	f := Funcao{Nome: "marcar", Retorno: Nada, Portao: todos}
	outro := "22222222-0000-4000-a000-000000000002"
	casos := []struct {
		nome   string
		ator   *auth.Ator
		escopo *autz.Escopo
		status int
	}{
		{"sem ator", nil, &autz.Escopo{ID: quemPede}, 500},
		{"sem escopo", &auth.Ator{ID: quemPede, Tipo: "painel"}, nil, 500},
		{"escopo de outra pessoa", &auth.Ator{ID: quemPede, Tipo: "painel"}, &autz.Escopo{ID: outro}, 500},
		{"sessão de cliente", &auth.Ator{ID: quemPede, Tipo: "cliente"}, &autz.Escopo{ID: quemPede}, 403},
		{"tipo vazio", &auth.Ator{ID: quemPede}, &autz.Escopo{ID: quemPede}, 403},
		{"serviço", &auth.Ator{ID: quemPede, Tipo: "servico"}, &autz.Escopo{ID: quemPede}, 204},
		{"painel", &auth.Ator{ID: quemPede, Tipo: "painel"}, &autz.Escopo{ID: quemPede}, 204},
	}
	for _, c := range casos {
		p, h := montarCom(t, c.ator, c.escopo, f)
		w := chamar(h, "marcar", `{}`)
		quer := 0
		if c.status == 204 {
			quer = 1
		}
		if w.Code != c.status || marcas(t, p) != quer {
			t.Errorf("%s = %d %s (marcas %d), esperava %d", c.nome, w.Code, w.Body, marcas(t, p), c.status)
		}
	}
}

// A lista é fechada: só o nome registrado, exatamente. Variantes de caixa, qualificação de
// schema, aspas, ponto e vírgula, unicode parecido, "..", caminho: tudo 404 e a função alvo
// não roda. O corpo do 404 é sempre o mesmo (não revela o que existe).
func TestRPCNomeForaDaListaEhSempre404(t *testing.T) {
	p, h := montar(t, Funcao{Nome: "marcar", Retorno: Nada, Portao: todos})
	nomes := []string{
		"MARCAR", "Marcar", "marcar ", " marcar", "marcar%00", "marcar%0a", "marcar%09", "marcar;", "marcar;select%201",
		`"marcar"`, "'marcar'", "marcar'", "marcar()", "marcar(", "marcar--", "marcar/*", "ｍarcar", "mаrcar", "marçar",
		"public.marcar", "pg_catalog.marcar", "pg_catalog.pg_sleep", "pg_sleep", "set_config", "current_setting",
		"version", "pg_read_file", "lo_import", "dblink", "..", ".", "%2e%2e", "marcar%2f..", "..%2fmarcar", "marcar.", ".marcar",
		"marcar%3b", "marcar%22", "marcar%5c", "marcar%e2%80%8b", // zero-width space
		"", "%20", "_", "marcar_", "marca", "marcarx",
	}
	for _, n := range nomes {
		w := httptest.NewRecorder()
		req, err := http.NewRequest("POST", "/rpc/"+n, strings.NewReader(`{}`))
		if err != nil {
			t.Fatalf("%q: %v", n, err)
		}
		h.ServeHTTP(w, req)
		if w.Code == 204 || w.Code == 200 {
			t.Errorf("nome %q executou (%d)", n, w.Code)
		}
		if w.Code != 404 {
			t.Errorf("nome %q = %d %s, esperava 404", n, w.Code, w.Body)
		}
		if w.Code == 404 && strings.Contains(w.Body.String(), "error") && strings.TrimSpace(w.Body.String()) != `{"error":"nao_encontrado"}` {
			t.Errorf("nome %q: corpo do 404 = %s", n, w.Body)
		}
	}
	if n := marcas(t, p); n != 0 {
		t.Fatalf("uma variante do nome executou a função (%d marcas)", n)
	}
	// a escapada com url.PathEscape também
	for _, n := range []string{"pg_catalog.pg_sleep", `marcar";select 1;--`, "mаrcar"} {
		if w := chamar(h, url.PathEscape(n), `{}`); w.Code != 404 {
			t.Errorf("%q = %d", n, w.Code)
		}
	}
	if w := chamar(h, "marcar", `{}`); w.Code != 204 {
		t.Fatalf("o nome certo = %d", w.Code)
	}
}

// O valor do pedido nunca vira SQL: texto com aspas e comandos volta como dado; tipo errado,
// objeto/lista onde se espera escalar e estouro de faixa são 400; a tabela segue de pé.
func TestRPCParametrosNaoViramSQL(t *testing.T) {
	p, h := montar(t,
		Funcao{Nome: "eco_texto", Params: []Param{{Nome: "p_t", Tipo: "text"}}, Portao: todos},
		Funcao{Nome: "soma", Params: []Param{{Nome: "p_a", Tipo: "integer"}, {Nome: "p_b", Tipo: "integer", Opcional: true}}, Portao: todos},
		Funcao{Nome: "tam", Params: []Param{{Nome: "p_ids", Tipo: "uuid[]"}}, Portao: todos},
		Funcao{Nome: "marcar", Retorno: Nada, Portao: todos},
	)
	veneno := `x'); insert into marca values ('pwn'); --`
	if w := chamar(h, "eco_texto", `{"p_t":"x'); insert into marca values ('pwn'); --"}`); w.Code != 200 || strings.TrimSpace(w.Body.String()) != `"`+veneno+`"` {
		t.Errorf("texto com SQL = %d %s", w.Code, w.Body)
	}
	if w := chamar(h, "eco_texto", `{"p_t":null}`); w.Code != 200 || strings.TrimSpace(w.Body.String()) != `null` {
		t.Errorf("texto nulo = %d %s", w.Code, w.Body)
	}
	for _, c := range []struct{ nome, corpo string }{
		{"eco_texto", `{"p_t":{"a":1}}`}, {"eco_texto", `{"p_t":["a"]}`},
		{"soma", `{"p_a":{"a":1}}`}, {"soma", `{"p_a":[1]}`}, {"soma", `{"p_a":1.5}`}, {"soma", `{"p_a":99999999999}`},
		{"soma", `{"p_a":true}`}, {"soma", `{"p_a":"1; select 1"}`}, {"soma", `{"p_a":"1","p_b":"x"}`},
		{"soma", `{"P_A":1}`}, {"soma", `{"p_a ":1}`}, {"soma", `{"p_a":1,"p_a ":2}`}, {"soma", `{"":1,"p_a":1}`},
		{"tam", `{"p_ids":["não é uuid"]}`}, {"tam", `{"p_ids":[{"a":1}]}`}, {"tam", `{"p_ids":[["aaaaaaaa-0000-4000-a000-000000000001"]]}`},
		{"tam", `{"p_ids":{"a":1}}`}, {"tam", `{"p_ids":1}`}, {"tam", `{"p_ids":"{aaaaaaaa-0000-4000-a000-000000000001}"}`},
		{"soma", `[]`}, {"soma", `"x"`}, {"soma", `1`}, {"soma", `null`}, {"soma", `{"p_a":1}{"p_a":2}`},
	} {
		w := chamar(h, c.nome, c.corpo)
		if w.Code != 400 {
			t.Errorf("%s %s = %d %s, esperava 400", c.nome, c.corpo, w.Code, w.Body)
		}
	}
	if w := chamar(h, "soma", `{"p_a":"7","p_b":1}`); w.Code != 200 || strings.TrimSpace(w.Body.String()) != `8` {
		t.Errorf("número em texto = %d %s", w.Code, w.Body)
	}
	// lista vazia é {} (cardinality 0), não NULL; null é null
	if w := chamar(h, "tam", `{"p_ids":[]}`); w.Code != 200 || strings.TrimSpace(w.Body.String()) != `0` {
		t.Errorf("lista vazia = %d %s", w.Code, w.Body)
	}
	if w := chamar(h, "tam", `{"p_ids":null}`); w.Code != 200 || strings.TrimSpace(w.Body.String()) != `null` {
		t.Errorf("lista nula = %d %s", w.Code, w.Body)
	}
	if n := marcas(t, p); n != 0 {
		t.Fatalf("algum pedido executou SQL do cliente (%d marcas)", n)
	}
	// corpo acima de 1 MiB
	if w := chamar(h, "eco_texto", `{"p_t":"`+strings.Repeat("a", 2<<20)+`"}`); w.Code != 413 {
		t.Errorf("corpo enorme = %d", w.Code)
	}
}

// A função roda numa transação: se ela falha depois de gravar, nada fica.
func TestRPCErroDesfazOQueAFuncaoGravou(t *testing.T) {
	p, h := montar(t, Funcao{Nome: "marcar_e_falhar", Portao: todos})
	if w := chamar(h, "marcar_e_falhar", `{}`); w.Code != 400 || !strings.Contains(w.Body.String(), "Falhou depois de gravar") {
		t.Fatalf("= %d %s", w.Code, w.Body)
	}
	if n := marcas(t, p); n != 0 {
		t.Fatalf("a escrita da função com erro ficou (%d marcas)", n)
	}
}

// Erro que não é de regra de negócio não vaza texto do banco (nome de tabela, valor).
func TestRPCErroNativoNaoVazaTexto(t *testing.T) {
	_, h := montar(t, Funcao{Nome: "soma", Params: []Param{{Nome: "p_a", Tipo: "integer"}}, Portao: todos},
		Funcao{Nome: "inexistente_no_banco", Portao: todos})
	for _, c := range []struct{ nome, corpo string }{{"soma", `{"p_a":"segredo-xyz"}`}, {"inexistente_no_banco", `{}`}} {
		w := chamar(h, c.nome, c.corpo)
		if strings.Contains(w.Body.String(), "segredo-xyz") || strings.Contains(w.Body.String(), "inexistente_no_banco") || strings.Contains(w.Body.String(), "integer") {
			t.Errorf("%s vazou texto do banco: %s", c.nome, w.Body)
		}
	}
}

func TestRPCNovoRecusaDeclaracaoRuim(t *testing.T) {
	for _, f := range []Funcao{
		{Nome: "soma; drop table x", Portao: todos},
		{Nome: "soma"},
		{Nome: "", Portao: todos},
		{Nome: "Soma", Portao: todos},
		{Nome: "pg_catalog.soma", Portao: todos},
		{Nome: "soma", Portao: todos, Params: []Param{{Nome: "p_a", Tipo: "integer); drop table x; --"}}},
		{Nome: "soma", Portao: todos, Params: []Param{{Nome: "p-a", Tipo: "integer"}}},
		{Nome: "soma", Portao: todos, Params: []Param{{Nome: "p_a", Tipo: "jsonb[]"}}},
		{Nome: "soma", Portao: todos, Params: []Param{{Nome: "p_a", Tipo: "text[][]"}}},
		{Nome: "soma", Portao: todos, Params: []Param{{Nome: "p_a", Tipo: "INTEGER"}}},
		{Nome: "soma", Portao: todos, Params: []Param{{Nome: "p_a", Tipo: "integer"}, {Nome: "p_a", Tipo: "integer"}}},
		{Nome: "soma", Portao: todos, Params: []Param{{Nome: "", Tipo: "integer"}}},
	} {
		if _, err := Novo(nil, f); err == nil {
			t.Errorf("%+v aceito", f)
		}
	}
	if _, err := Novo(nil, Funcao{Nome: "a", Portao: todos}, Funcao{Nome: "a", Portao: todos}); err == nil {
		t.Error("duplicata aceita")
	}
	if _, err := Novo(nil); err != nil {
		t.Errorf("registro vazio recusado: %v", err)
	}
}

// Registro vazio (o estado do Plano 5.0): toda chamada é 404.
func TestRPCRegistroVazioNega(t *testing.T) {
	_, h := montar(t)
	for _, n := range []string{"soma", "marcar", "quem", "pg_sleep"} {
		if w := chamar(h, n, `{}`); w.Code != 404 {
			t.Errorf("%s = %d", n, w.Code)
		}
	}
}

// Função que devolve tabela: a linha inteira vira o objeto (mesmo com coluna chamada r), o teto
// é o max_rows do PostgREST (1000), escalar setof continua escalar, vazio é [] e void é 204.
func TestRPCConjuntoLinhaInteiraETeto(t *testing.T) {
	_, h := montar(t,
		Funcao{Nome: "tabela_com_r", Retorno: Conjunto, Portao: todos},
		Funcao{Nome: "muitas", Retorno: Conjunto, Portao: todos},
		Funcao{Nome: "escalares", Retorno: Conjunto, Portao: todos},
		Funcao{Nome: "nenhuma", Retorno: Conjunto, Portao: todos},
		Funcao{Nome: "marcar", Retorno: Nada, Portao: todos},
	)
	if w := chamar(h, "tabela_com_r", `{}`); w.Code != 200 || strings.Join(strings.Fields(w.Body.String()), "") != `[{"r":1,"x":"a"},{"r":2,"x":"b"}]` {
		t.Errorf("coluna r = %d %s", w.Code, w.Body)
	}
	w := chamar(h, "muitas", `{}`)
	var linhas []map[string]int
	if err := json.Unmarshal(w.Body.Bytes(), &linhas); err != nil || w.Code != 200 || len(linhas) != dados.LimitePadrao {
		t.Errorf("5000 linhas = %d, %d linhas (%v)", w.Code, len(linhas), err)
	}
	if w := chamar(h, "escalares", `{}`); w.Code != 200 || strings.Join(strings.Fields(w.Body.String()), "") != `[1,2,3]` {
		t.Errorf("setof escalar = %d %s", w.Code, w.Body)
	}
	if w := chamar(h, "nenhuma", `{}`); w.Code != 200 || strings.TrimSpace(w.Body.String()) != `[]` {
		t.Errorf("vazia = %d %s", w.Code, w.Body)
	}
	if w := chamar(h, "marcar", `{}`); w.Code != 204 {
		t.Errorf("void = %d %s", w.Code, w.Body)
	}
}

// text[] só aceita textos (e null); uuid[]/integer[] seguem com os 400 do cast.
func TestRPCListaDeTextoSoComTexto(t *testing.T) {
	_, h := montar(t,
		Funcao{Nome: "textos", Params: []Param{{Nome: "p_t", Tipo: "text[]"}}, Portao: todos},
		Funcao{Nome: "ints", Params: []Param{{Nome: "p_i", Tipo: "integer[]"}}, Portao: todos},
	)
	for _, c := range []struct {
		nome, corpo string
		status      int
		quer        string
	}{
		{"textos", `{"p_t":["a","b"]}`, 200, `2`},
		{"textos", `{"p_t":["a",null]}`, 200, `2`},
		{"textos", `{"p_t":[]}`, 200, `0`},
		{"textos", `{"p_t":[["a"]]}`, 400, ``},
		{"textos", `{"p_t":[{"a":1}]}`, 400, ``},
		{"textos", `{"p_t":[1]}`, 400, ``},
		{"textos", `{"p_t":[true]}`, 400, ``},
		{"ints", `{"p_i":[1,2]}`, 200, `2`},
		{"ints", `{"p_i":[[1]]}`, 400, ``},
		{"ints", `{"p_i":[{"a":1}]}`, 400, ``},
		{"ints", `{"p_i":["x"]}`, 400, ``},
	} {
		w := chamar(h, c.nome, c.corpo)
		if w.Code != c.status || (c.quer != "" && strings.TrimSpace(w.Body.String()) != c.quer) {
			t.Errorf("%s %s = %d %s", c.nome, c.corpo, w.Code, w.Body)
		}
	}
}

// Corpo vazio com tamanho desconhecido (chunked, ContentLength -1) vale {} .
func TestRPCCorpoVazioSemTamanho(t *testing.T) {
	_, h := montar(t, Funcao{Nome: "quem", Portao: todos}, Funcao{Nome: "soma", Params: []Param{{Nome: "p_a", Tipo: "integer"}}, Portao: todos})
	for _, corpo := range []string{"", "  \n"} {
		req := httptest.NewRequest("POST", "/rpc/quem", io.NopCloser(strings.NewReader(corpo)))
		req.ContentLength = -1
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != 200 {
			t.Errorf("corpo %q sem tamanho = %d %s", corpo, w.Code, w.Body)
		}
	}
	req := httptest.NewRequest("POST", "/rpc/soma", io.NopCloser(strings.NewReader("")))
	req.ContentLength = -1
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 400 || !strings.Contains(w.Body.String(), "falta o parâmetro p_a") {
		t.Errorf("param obrigatório sem corpo = %d %s", w.Code, w.Body)
	}
	req = httptest.NewRequest("POST", "/rpc/soma", io.NopCloser(strings.NewReader(`{"p_a":4}`)))
	req.ContentLength = -1
	w = httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `5` {
		t.Errorf("corpo sem tamanho = %d %s", w.Code, w.Body)
	}
}

// Nomes que nunca viram RPC do painel: Novo recusa (a montagem da API não sobe).
func TestRPCNovoRecusaNomesProibidos(t *testing.T) {
	proibidos := []string{
		// Ruling 23
		"marcar_senha_trocada", "minha_conta_esta_desativada",
		// fila do abandono (Ruling 25) e robôs
		"pegar_da_fila", "pegar_para_mensagem", "marcar_da_fila", "marcar_mensagem", "marcar_checkout_comprou",
		"marcar_checkout_pagamento_pendente", "liberar_travadas_da_fila", "liberar_mensagens_travadas", "agendar_followups",
		"avaliar_trava_cruzada", "mover_abandonados_para_fila", "devolver_da_fila", "devolver_mensagem",
		"registrar_pedido_para_mensagem", "checkout_qualquer_coisa", "checkout_", "disparar_robo", "disparar_coletor", "tomar_trava",
		// internas com EXECUTE revogado de authenticated
		"vessel_cpf_valido", "vessel_faixa_da_nota", "vessel_situacao_do_convite", "vessel_numeros_do_stylist_circle", "vessel_telefone_canonico",
		// páginas públicas (anon): Plano 6
		"vessel_convite_da_convidada", "vessel_rsvp_da_convidada", "vessel_pedir_atendimento",
		// ajudantes de policy e funções sem chamada de rede (web.RPCForaDoPainel)
		"is_vessel_atendimentos_editar", "meus_vinculos", "vessel_chave_do_produto", "vessel_email_canonico", "vessel_placar_do_stylist_circle",
	}
	for _, n := range proibidos {
		if _, err := Novo(nil, Funcao{Nome: n, Portao: todos}); err == nil || !strings.Contains(err.Error(), "proibid") {
			t.Errorf("%s: erro = %v", n, err)
		}
	}
	if _, err := Novo(nil, Funcao{Nome: "vessel_alertas", Portao: todos}); err != nil {
		t.Errorf("nome comum recusado: %v", err)
	}
}
