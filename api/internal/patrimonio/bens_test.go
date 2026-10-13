package patrimonio

import (
	"encoding/json"
	"slices"
	"testing"
)

// VAZAMENTO: cada pessoa recebe exatamente os bens que pode_ver_bem deixa (e nenhum sem o módulo).
func TestBensLeitura(t *testing.T) {
	m := novoMundo(t, montarBens)
	for quem, quer := range map[string][]string{
		"patGeral":   {B1, B2, B3, B4, BV, BV2},
		"patT1":      {B1, B3, BV, BV2}, // L1 pelo time; B3 pela mão (a P1 é ela)
		"patT2":      {B2},
		"adminT1":    {B1, BV, BV2}, // a trava vale também para o papel admin (só o time dele)
		"frota":      {},
		"acessos":    {},
		"viewer":     {},
		"superFicha": {}, // paridade: a permissiva exige is_patrimonio_admin (Ruling 5.2-16)
	} {
		slices.Sort(quer)
		st, corpo := m.Pedir(t, quem, "GET", "/patrimonio/bens", "")
		if got := ids(t, corpo); st != 200 || !slices.Equal(got, quer) {
			t.Errorf("%s vê %v (%d), esperava %v", quem, got, st, quer)
		}
	}
	m.Rodar(t, []caso{
		{Nome: "sem sessão", Metodo: "GET", Caminho: "/patrimonio/bens", Status: 401},
		{Nome: "IDOR por filtro: a T2 pedindo os bens do motorista do carro da T1", Quem: "patT2", Metodo: "GET",
			Caminho: "/patrimonio/bens?pessoa_id=" + P2, Status: 200, Tem: "[]"},
		{Nome: "pela mão: o notebook da P1 em local sem time, com o nome do local embutido", Quem: "patT1", Metodo: "GET",
			Caminho: "/patrimonio/bens?pessoa_id=" + P1, Status: 200, Tem: "Sede Limeira", NaoTem: "Cadeira"},
		{Nome: "embutido sem categoria sai null", Quem: "patT1", Metodo: "GET", Caminho: "/patrimonio/bens?pessoa_id=" + P1,
			Status: 200, Tem: `"patrimonio_categorias":null`},
		{Nome: "a outra trava não vê o que está com a P1", Quem: "patT2", Metodo: "GET", Caminho: "/patrimonio/bens?pessoa_id=" + P1,
			Status: 200, Tem: "[]"},
		{Nome: "a Frota pede os bens para ligar carro: vazio sem o módulo (paridade)", Quem: "frota", Metodo: "GET",
			Caminho: "/patrimonio/bens?ordem=nome&limite=500", Status: 200, Tem: "[]"},
		{Nome: "ordem fora da lista", Quem: "patGeral", Metodo: "GET", Caminho: "/patrimonio/bens?ordem=valor_centavos", Status: 400},
		{Nome: "filtro que não existe não vira filtro silencioso", Quem: "patGeral", Metodo: "GET", Caminho: "/patrimonio/bens?local_id=" + L1, Status: 400},
		{Nome: "pessoa_id malformado", Quem: "patGeral", Metodo: "GET", Caminho: "/patrimonio/bens?pessoa_id=1%20or%201=1", Status: 400},
	})
	// a ordem (ids() ordena; aqui não): numero é o padrão, nome é a outra permitida
	for caminho, quer := range map[string][]string{
		"/patrimonio/bens":            {B1, B2, B3, B4, BV, BV2},
		"/patrimonio/bens?ordem=nome": {B1, B2, BV, BV2, B4, B3}, // Cadeira Tivoli, Cadeira DP, Kwid, Kwid novo, Mesa, Notebook
	} {
		_, corpo := m.Pedir(t, "patGeral", "GET", caminho, "")
		var l []struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal([]byte(corpo), &l); err != nil {
			t.Fatalf("%v: %s", err, corpo)
		}
		got := make([]string, len(l))
		for i, x := range l {
			got[i] = x.ID
		}
		if !slices.Equal(got, quer) {
			t.Errorf("%s: ordem %v, esperava %v", caminho, got, quer)
		}
	}
	if w := m.Resposta(t, "patT1", "GET", "/patrimonio/bens?pessoa_id="+P1+"&contar=1&limite=1", ""); w.Header().Get("X-Total-Count") != "1" {
		t.Errorf("X-Total-Count = %q (o contador da ficha de Acessos)", w.Header().Get("X-Total-Count"))
	}
}

func TestBensEscrita(t *testing.T) {
	m := novoMundo(t, montarBens)
	u := func(id string) string { return "/patrimonio/bens/" + id }
	criar := func(nome, quem, corpo string, status int, total string) caso {
		return caso{Nome: nome, Quem: quem, Metodo: "POST", Caminho: "/patrimonio/bens", Corpo: corpo, Status: status,
			Efeito: contar("patrimonio_bens"), Quer: total}
	}
	carro := `select coalesce(v.pessoa_id::text, '-') || '|' || v.situacao || '|' || (u.volta_em is null)::text
		from frota_veiculos v join frota_uso u on u.veiculo_id = v.id where v.id = '` + V1 + `'`
	m.Rodar(t, []caso{
		criar("sem o módulo patrimônio não cria", "frota", `{"nome":"Mesa","local_id":"`+L1+`"}`, 403, "6"),
		criar("sem trava cria em qualquer local", "patGeral",
			`{"nome":"Mesa nova","numero":20,"local_id":"`+L2+`","categoria_id":"`+CatM+`","atualizado_em":"2026-10-12T12:00:00Z"}`, 201, "7"),
		criar("com trava cria no local do time", "patT1", `{"nome":"Cadeira nova","local_id":"`+L1+`"}`, 201, "8"),
		criar("com trava NÃO cria no local de outro time (Ruling 5.2-2)", "patT1", `{"nome":"Fora","local_id":"`+L2+`"}`, 403, "8"),
		criar("com trava NÃO cria item sem local nem pessoa (não o veria)", "patT1", `{"nome":"Solto"}`, 403, "8"),
		criar("local que não existe responde igual ao alheio (sem oráculo)", "patT1",
			`{"nome":"X","local_id":"a2000000-0000-4000-a000-000000000099"}`, 403, "8"),
		criar("número de etiqueta repetido", "patGeral", `{"nome":"X","numero":1}`, 409, "8"),
		criar("situação fora da lista", "patGeral", `{"nome":"X","situacao":"perdido"}`, 400, "8"),
		criar("sem nome", "patGeral", `{"numero":30}`, 400, "8"),
		criar("nome em branco", "patGeral", `{"nome":"   "}`, 400, "8"),
		criar("coluna que a tela não grava", "patGeral", `{"nome":"X","criado_em":"2020-01-01T00:00:00Z"}`, 400, "8"),
		criar("entrar como não cria", "impersonado", `{"nome":"X"}`, 403, "8"),

		{Nome: "edita o que vê", Quem: "patT1", Metodo: "PATCH", Caminho: u(B1), Corpo: `{"observacao":"riscada"}`,
			Status: 200, Tem: `"observacao":"riscada"`, Efeito: col("patrimonio_bens", "observacao", B1), Quer: "riscada"},
		{Nome: "IDOR: bem de outro time é 404 e fica intacto", Quem: "patT1", Metodo: "PATCH", Caminho: u(B2),
			Corpo: `{"observacao":"x"}`, Status: 404, Efeito: col("patrimonio_bens", "observacao", B2), Quer: "<nulo>"},
		{Nome: "IDOR: a outra trava também não mexe no da T1", Quem: "patT2", Metodo: "PATCH", Caminho: u(B1),
			Corpo: `{"observacao":"y"}`, Status: 404, Efeito: col("patrimonio_bens", "observacao", B1), Quer: "riscada"},
		{Nome: "mover para local de outro time: 403 (sairia do que ela vê)", Quem: "patT1", Metodo: "PATCH", Caminho: u(B1),
			Corpo: `{"local_id":"` + L2 + `"}`, Status: 403, Efeito: col("patrimonio_bens", "local_id", B1), Quer: L1},
		{Nome: "passar adiante o que só vê pela mão: 403, paridade com o WITH CHECK", Quem: "patT1", Metodo: "PATCH", Caminho: u(B3),
			Corpo: `{"pessoa_id":"` + P2 + `"}`, Status: 403, Efeito: col("patrimonio_bens", "pessoa_id", B3), Quer: P1},
		{Nome: "Frota não lê bem: 404", Quem: "frota", Metodo: "PATCH", Caminho: u(B1), Corpo: `{"observacao":"z"}`, Status: 404},
		{Nome: "id malformado", Quem: "patGeral", Metodo: "PATCH", Caminho: u("nao-e-uuid"), Corpo: `{"observacao":"z"}`, Status: 404},
		{Nome: "bem de veículo segue a frota: a resposta traz a situação do carro", Quem: "patGeral", Metodo: "PATCH", Caminho: u(BV),
			Corpo: `{"situacao":"em_estoque"}`, Status: 200, Tem: `"situacao":"em_uso"`, Efeito: carro, Quer: P2 + "|ativo|true"},
		{Nome: "o responsável espelha no carro e a posse do carro segue aberta", Quem: "patGeral", Metodo: "PATCH", Caminho: u(BV),
			Corpo: `{"pessoa_id":"` + P1 + `"}`, Status: 200, Efeito: carro, Quer: P1 + "|ativo|true"},
		{Nome: "bem sem responsável: o carro também, e a posse do carro fecha", Quem: "patGeral", Metodo: "PATCH", Caminho: u(BV),
			Corpo: `{"pessoa_id":null}`, Status: 200, Efeito: carro, Quer: "-|ativo|false"},
		{Nome: "entrar como não edita", Quem: "impersonado", Metodo: "PATCH", Caminho: u(B4), Corpo: `{"observacao":"x"}`,
			Status: 403, Tem: "Quem entrou como outra pessoa", Efeito: col("patrimonio_bens", "observacao", B4), Quer: "<nulo>"},

		{Nome: "IDOR: apagar bem de outro time é 404 e ele fica", Quem: "patT1", Metodo: "DELETE", Caminho: u(B2), Status: 404,
			Efeito: "select count(*)::text from patrimonio_bens where id = '" + B2 + "'", Quer: "1"},
		{Nome: "sem o módulo: 404 e fica", Quem: "viewer", Metodo: "DELETE", Caminho: u(B4), Status: 404,
			Efeito: "select count(*)::text from patrimonio_bens where id = '" + B4 + "'", Quer: "1"},
		{Nome: "entrar como não apaga", Quem: "impersonado", Metodo: "DELETE", Caminho: u(B4), Status: 403, Tem: "Quem entrou como outra pessoa",
			Efeito: "select count(*)::text from patrimonio_bens where id = '" + B4 + "'", Quer: "1"},
		{Nome: "apaga o que vê; a posse vai junto", Quem: "patGeral", Metodo: "DELETE", Caminho: u(B2), Status: 204,
			Efeito: "select count(*)::text from patrimonio_posse where bem_id = '" + B2 + "'", Quer: "0"},
		{Nome: "com trava apaga o do time", Quem: "patT1", Metodo: "DELETE", Caminho: u(BV2), Status: 204,
			Efeito: "select count(*)::text from patrimonio_bens where id = '" + BV2 + "'", Quer: "0"},
	})
}

// O papel admin NÃO escapa da trava de time: só mexe no que o time dele vê.
func TestBensAdminComTrava(t *testing.T) {
	m := novoMundo(t, montarBens)
	u := func(id string) string { return "/patrimonio/bens/" + id }
	m.Rodar(t, []caso{
		{Nome: "não cria em local de outro time", Quem: "adminT1", Metodo: "POST", Caminho: "/patrimonio/bens",
			Corpo: `{"nome":"Fora","local_id":"` + L2 + `"}`, Status: 403, Efeito: contar("patrimonio_bens"), Quer: "6"},
		{Nome: "cria no local do time", Quem: "adminT1", Metodo: "POST", Caminho: "/patrimonio/bens",
			Corpo: `{"nome":"Dentro","local_id":"` + L1 + `"}`, Status: 201, Efeito: contar("patrimonio_bens"), Quer: "7"},
		{Nome: "bem de outro time é 404 no PATCH", Quem: "adminT1", Metodo: "PATCH", Caminho: u(B2), Corpo: `{"observacao":"x"}`,
			Status: 404, Efeito: col("patrimonio_bens", "observacao", B2), Quer: "<nulo>"},
		{Nome: "bem de outro time é 404 no DELETE", Quem: "adminT1", Metodo: "DELETE", Caminho: u(B2), Status: 404,
			Efeito: "select count(*)::text from patrimonio_bens where id = '" + B2 + "'", Quer: "1"},
		{Nome: "apaga o do time", Quem: "adminT1", Metodo: "DELETE", Caminho: u(B1), Status: 204,
			Efeito: "select count(*)::text from patrimonio_bens where id = '" + B1 + "'", Quer: "0"},
	})
}

// Ruling 5.2-17 (veja o comentário em patrimonio_test.go): pessoa_id é FK para acessos_pessoas, que
// quem só tem patrimônio não lê. Aceito e fixado: POST existente 201, inexistente 403 (CriarSoLegivel),
// PATCH inexistente 409.
func TestBensPessoaDeAcessos(t *testing.T) {
	m := novoMundo(t, montarBens)
	const fantasma = "9e200000-0000-4000-a000-000000000099"
	m.Rodar(t, []caso{
		{Nome: "POST com pessoa que existe", Quem: "patT1", Metodo: "POST", Caminho: "/patrimonio/bens",
			Corpo: `{"nome":"Com responsável","local_id":"` + L1 + `","pessoa_id":"` + P2 + `"}`, Status: 201, Tem: P2,
			Efeito: contar("patrimonio_bens"), Quer: "7"},
		{Nome: "POST com pessoa que não existe", Quem: "patT1", Metodo: "POST", Caminho: "/patrimonio/bens",
			Corpo: `{"nome":"Com fantasma","local_id":"` + L1 + `","pessoa_id":"` + fantasma + `"}`, Status: 403,
			Efeito: contar("patrimonio_bens"), Quer: "7"},
		{Nome: "PATCH com pessoa que não existe", Quem: "patT1", Metodo: "PATCH", Caminho: "/patrimonio/bens/" + B1,
			Corpo: `{"pessoa_id":"` + fantasma + `"}`, Status: 409, Efeito: col("patrimonio_bens", "pessoa_id", B1), Quer: "<nulo>"},
	})
}
