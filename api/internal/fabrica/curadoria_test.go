package fabrica

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

func mundoCuradoria(t *testing.T) *mundoteste.Mundo {
	return novoMundo(t, func(r chi.Router, p *pgxpool.Pool) {
		cu := &Curadoria{Pool: p}
		r.With(soFabricante, soSessaoPropria).Post("/fabrica-looks", cu.Looks)
		r.With(soFabricante, soSessaoPropria).Post("/fabrica-publicos", cu.Publicos)
	})
}

// intacto: cada pedido tem o status esperado e a foto das 9 tabelas não muda (o negado assertado com o efeito).
func intacto(t *testing.T, m *mundoteste.Mundo, rota string, casos []mundoteste.Caso) {
	t.Helper()
	antes := m.Um(t, fotoDaFabrica)
	for _, c := range casos {
		c.Metodo, c.Caminho = "POST", rota
		m.Rodar(t, []mundoteste.Caso{c})
		if depois := m.Um(t, fotoDaFabrica); depois != antes {
			t.Fatalf("%s: o banco mudou num pedido negado", c.Nome)
		}
	}
}

func TestLooks(t *testing.T) {
	m := mundoCuradoria(t)
	const rota = "/fabrica-looks"

	m.Rodar(t, []mundoteste.Caso{
		{Nome: "salvar tudo", Quem: "fabricante", Metodo: "POST", Caminho: rota, Status: 200, Tem: `"ok":true`,
			Corpo:  `{"acao":"salvar","look":{"chave":"promo-sage","nome":"Promo · Sálvia","objetivos":["engajamento"],"ativo":false}}`,
			Efeito: `select nome || '|' || objetivos::text || '|' || ativo from fabrica_looks where chave = 'promo-sage'`, Quer: "Promo · Sálvia|{engajamento}|false"},
		{Nome: "salvar só ativo", Quem: "fabricante", Metodo: "POST", Caminho: rota, Status: 200,
			Corpo:  `{"acao":"salvar","look":{"chave":"promo-sage","ativo":true}}`,
			Efeito: `select nome || '|' || objetivos::text || '|' || ativo from fabrica_looks where chave = 'promo-sage'`, Quer: "Promo · Sálvia|{engajamento}|true"},
		{Nome: "ordenar", Quem: "fabricante", Metodo: "POST", Caminho: rota, Status: 200, Tem: `"ok":true`,
			Corpo:  `{"acao":"ordenar","ordem":[{"chave":"promo-sage","ordem":1},{"chave":"produto-heroi","ordem":2},{"ordem":9}]}`,
			Efeito: `select string_agg(chave || ordem, ',' order by chave) from fabrica_looks`, Quer: "marca-velha3,produto-heroi2,promo-sage1"},
		{Nome: "restaurar", Quem: "fabricante", Metodo: "POST", Caminho: rota, Status: 200, Tem: `"excluido":false`,
			Corpo:  `{"acao":"excluir","chave":"marca-velha","excluido":false}`,
			Efeito: `select excluido::text from fabrica_looks where chave = 'marca-velha'`, Quer: "false"},
		{Nome: "excluir (padrão true)", Quem: "fabricante", Metodo: "POST", Caminho: rota, Status: 200, Tem: `"excluido":true`,
			Corpo:  `{"acao":"excluir","chave":"produto-heroi"}`,
			Efeito: `select excluido::text from fabrica_looks where chave = 'produto-heroi'`, Quer: "true"},
	})

	// chave inexistente: 200 e nada muda (a edge atualizava 0 linhas)
	antes := m.Um(t, fotoDaFabrica)
	if st, corpo := m.Pedir(t, "fabricante", "POST", rota, `{"acao":"salvar","look":{"chave":"nao-existe","nome":"X"}}`); st != 200 || !strings.Contains(corpo, `"ok":true`) {
		t.Errorf("chave inexistente = %d %s", st, corpo)
	}
	if m.Um(t, fotoDaFabrica) != antes {
		t.Error("chave inexistente mudou o banco")
	}

	// admin e super pela ficha também passam
	for _, quem := range []string{"adminA1", "super", "chaveEmLista"} {
		if st, corpo := m.Pedir(t, quem, "POST", rota, `{"acao":"ordenar","ordem":[]}`); st != 200 {
			t.Errorf("%s = %d %s", quem, st, corpo)
		}
	}

	corpoOK := `{"acao":"salvar","look":{"chave":"promo-sage","nome":"Invasor"}}`
	var negados []mundoteste.Caso
	for _, quem := range []string{"leitor", "semModulo", "roboSemFabrica"} {
		negados = append(negados, mundoteste.Caso{Nome: "negado " + quem, Quem: quem, Corpo: corpoOK, Status: 403})
	}
	negados = append(negados,
		mundoteste.Caso{Nome: "impersonado", Quem: "impersonado", Corpo: corpoOK, Status: 403, Tem: "Quem entrou como outra pessoa só consulta."},
		mundoteste.Caso{Nome: "desativado", Quem: "desativado", Corpo: corpoOK, Status: 401},
		mundoteste.Caso{Nome: "anônimo", Quem: "", Corpo: corpoOK, Status: 401},
		mundoteste.Caso{Nome: "salvar sem chave", Quem: "fabricante", Corpo: `{"acao":"salvar","look":{"nome":"X"}}`, Status: 400, Tem: "chave_obrigatoria"},
		mundoteste.Caso{Nome: "salvar chave vazia", Quem: "fabricante", Corpo: `{"acao":"salvar","look":{"chave":"","nome":"X"}}`, Status: 400, Tem: "chave_obrigatoria"},
		mundoteste.Caso{Nome: "salvar sem look", Quem: "fabricante", Corpo: `{"acao":"salvar"}`, Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "excluir sem chave", Quem: "fabricante", Corpo: `{"acao":"excluir"}`, Status: 400, Tem: "chave_obrigatoria"},
		mundoteste.Caso{Nome: "sync aposentado", Quem: "fabricante", Corpo: `{"acao":"sync"}`, Status: 400, Tem: "acao_invalida"},
		mundoteste.Caso{Nome: "ação x", Quem: "fabricante", Corpo: `{"acao":"x"}`, Status: 400, Tem: "acao_invalida"},
		mundoteste.Caso{Nome: "objetivos inválidos", Quem: "fabricante", Corpo: `{"acao":"salvar","look":{"chave":"promo-sage","objetivos":["Engajamento!"]}}`, Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "objetivos demais", Quem: "fabricante", Corpo: `{"acao":"salvar","look":{"chave":"promo-sage","objetivos":["a","b","c","d","e","f","g","h","i","j","k"]}}`, Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "nome vazio", Quem: "fabricante", Corpo: `{"acao":"salvar","look":{"chave":"promo-sage","nome":""}}`, Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "ativo texto", Quem: "fabricante", Corpo: `{"acao":"salvar","look":{"chave":"promo-sage","ativo":"sim"}}`, Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "chave traversal", Quem: "fabricante", Corpo: `{"acao":"salvar","look":{"chave":"../x","nome":"X"}}`, Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "só a chave", Quem: "fabricante", Corpo: `{"acao":"salvar","look":{"chave":"promo-sage"}}`, Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "excluir chave inválida", Quem: "fabricante", Corpo: `{"acao":"excluir","chave":"../x"}`, Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "ordenar chave inválida", Quem: "fabricante", Corpo: `{"acao":"ordenar","ordem":[{"chave":"promo-sage","ordem":7},{"chave":"A B","ordem":1}]}`, Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "ordenar 201", Quem: "fabricante", Status: 400,
			Corpo: `{"acao":"ordenar","ordem":[` + strings.TrimSuffix(strings.Repeat(`{"chave":"promo-sage","ordem":5},`, 201), ",") + `]}`},
	)
	intacto(t, m, rota, negados)
}

// ordenar é uma transação só: a segunda atualização falha e a primeira não fica gravada.
func TestLooksOrdenarEmUmaTransacao(t *testing.T) {
	m := mundoCuradoria(t)
	if _, err := m.P.Exec(t.Context(), `
		create function fabrica_teste_falha() returns trigger language plpgsql as
		$$ begin raise exception 'falha de teste'; end $$;
		create trigger fabrica_teste_falha before update on fabrica_looks
		  for each row when (new.chave = 'produto-heroi') execute function fabrica_teste_falha();`); err != nil {
		t.Fatal(err)
	}
	antes := m.Um(t, fotoDaFabrica)
	st, corpo := m.Pedir(t, "fabricante", "POST", "/fabrica-looks",
		`{"acao":"ordenar","ordem":[{"chave":"promo-sage","ordem":7},{"chave":"produto-heroi","ordem":8}]}`)
	if st == 200 {
		t.Fatalf("a segunda atualização falhou e a resposta foi 200: %s", corpo)
	}
	if got := m.Um(t, `select ordem from fabrica_looks where chave = 'promo-sage'`); got != "2" {
		t.Errorf("promo-sage ficou com ordem %s: a primeira atualização escapou da transação", got)
	}
	if m.Um(t, fotoDaFabrica) != antes {
		t.Error("o banco mudou")
	}
}

func idDaResposta(t *testing.T, corpo string) string {
	t.Helper()
	var r struct{ ID string }
	if err := json.Unmarshal([]byte(corpo), &r); err != nil || !reUUID.MatchString(r.ID) {
		t.Fatalf("resposta %q sem id uuid (%v)", corpo, err)
	}
	return r.ID
}

func TestPublicos(t *testing.T) {
	m := mundoCuradoria(t)
	const rota = "/fabrica-publicos"

	_, corpo := m.Pedir(t, "fabricante", "POST", rota, `{"acao":"salvar","preset":{"nome":"Campinas 30+","geo":{"cities":[{"key":"247071","radius":10,"distance_unit":"kilometer"}],"pins":[]},"idade_min":30,"idade_max":55,"generos":[2],"interesses":[{"id":"6003","name":"Moda"}],"custom_audiences":[]}}`)
	novo := idDaResposta(t, corpo)
	linha := func(id string) string {
		return fmt.Sprintf(`select nome || '|' || coalesce(marca_id::text, 'nulo') || '|' || geo::text || '|' || idade_min || '|' || idade_max || '|' ||
			generos::text || '|' || interesses::text || '|' || custom_audiences::text || '|' || criado_por from fabrica_publicos where id = '%s'`, id)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "linha inserida", Efeito: linha(novo), Quer: `Campinas 30+|nulo|{"pins": [], "cities": [{"key": "247071", "radius": 10, "distance_unit": "kilometer"}]}|30|55|{2}|[{"id": "6003", "name": "Moda"}]|[]|` + idFabricante},
		{Nome: "atualiza P1", Quem: "fabricanteA1", Metodo: "POST", Caminho: rota, Status: 200, Tem: `"id":"` + P1 + `"`,
			Corpo:  `{"acao":"salvar","preset":{"id":"` + P1 + `","nome":"Novo"}}`,
			Efeito: linha(P1), Quer: `Novo|nulo|{}|18|65|{}|[]|[]|` + idFabricanteA1},
		{Nome: "apagar P2", Quem: "fabricante", Metodo: "POST", Caminho: rota, Status: 200, Tem: `"ok":true`,
			Corpo: `{"acao":"apagar","id":"` + P2 + `"}`, Efeito: `select count(*) from fabrica_publicos where id = '` + P2 + `'`, Quer: "0"},
		{Nome: "apagar de novo (idempotente)", Quem: "fabricante", Metodo: "POST", Caminho: rota, Status: 200, Tem: `"ok":true`,
			Corpo: `{"acao":"apagar","id":"` + P2 + `"}`},
		{Nome: "com marca", Quem: "fabricante", Metodo: "POST", Caminho: rota, Status: 200,
			Corpo:  `{"acao":"salvar","preset":{"nome":"Com marca","marca_id":"` + M1 + `"}}`,
			Efeito: `select marca_id::text from fabrica_publicos where nome = 'Com marca'`, Quer: M1},
	})

	salvar := func(preset string) string { return `{"acao":"salvar","preset":` + preset + `}` }
	var negados []mundoteste.Caso
	for _, quem := range []string{"leitor", "roboSemFabrica", "semModulo"} {
		negados = append(negados,
			mundoteste.Caso{Nome: "salvar " + quem, Quem: quem, Corpo: salvar(`{"id":"` + P1 + `","nome":"Invasor"}`), Status: 403},
			mundoteste.Caso{Nome: "apagar " + quem, Quem: quem, Corpo: `{"acao":"apagar","id":"` + P1 + `"}`, Status: 403})
	}
	negados = append(negados,
		mundoteste.Caso{Nome: "impersonado salvar", Quem: "impersonado", Corpo: salvar(`{"id":"` + P1 + `","nome":"Invasor"}`), Status: 403, Tem: "Quem entrou como outra pessoa só consulta."},
		mundoteste.Caso{Nome: "impersonado apagar", Quem: "impersonado", Corpo: `{"acao":"apagar","id":"` + P1 + `"}`, Status: 403},
		mundoteste.Caso{Nome: "sem nome", Quem: "fabricante", Corpo: salvar(`{"idade_min":20}`), Status: 400, Tem: "nome_obrigatorio"},
		mundoteste.Caso{Nome: "sem preset", Quem: "fabricante", Corpo: `{"acao":"salvar"}`, Status: 400, Tem: "nome_obrigatorio"},
		mundoteste.Caso{Nome: "apagar sem id", Quem: "fabricante", Corpo: `{"acao":"apagar"}`, Status: 400, Tem: "id_obrigatorio"},
		mundoteste.Caso{Nome: "apagar id ruim", Quem: "fabricante", Corpo: `{"acao":"apagar","id":"x"}`, Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "idade_min 70", Quem: "fabricante", Corpo: salvar(`{"nome":"X","idade_min":70}`), Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "min > max", Quem: "fabricante", Corpo: salvar(`{"nome":"X","idade_min":40,"idade_max":30}`), Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "idade fracionária", Quem: "fabricante", Corpo: salvar(`{"nome":"X","idade_min":20.5}`), Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "generos [3]", Quem: "fabricante", Corpo: salvar(`{"nome":"X","generos":[3]}`), Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "geo lista", Quem: "fabricante", Corpo: salvar(`{"nome":"X","geo":[]}`), Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "marca_id x", Quem: "fabricante", Corpo: salvar(`{"nome":"X","marca_id":"x"}`), Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "interesses objeto", Quem: "fabricante", Corpo: salvar(`{"nome":"X","interesses":{}}`), Status: 400, Tem: "pedido_invalido"},
		mundoteste.Caso{Nome: "id inexistente", Quem: "fabricante", Corpo: salvar(`{"id":"a5870000-0000-4000-a000-0000000000ff","nome":"X"}`), Status: 404},
		mundoteste.Caso{Nome: "ação x", Quem: "fabricante", Corpo: `{"acao":"x"}`, Status: 400, Tem: "acao_invalida"},
	)
	intacto(t, m, rota, negados)
}
