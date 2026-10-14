package patrimonio

import (
	"encoding/json"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// Os cinco recursos do cadastro. Regra só de ator (nenhuma linha restringe): `leem` lê, `criam` cria,
// `editam` (só patrimônio) edita e apaga. A Frota vê e cria marca, local e ambiente, mas não edita;
// categoria e tipo ela nem vê.
type recurso struct {
	rota, tabela string
	todos        []string                 // ids da lista no mundo
	leem, criam  []string                 // quem lê / quem cria
	alvo         string                   // id do PATCH/DELETE ("" = o recurso não tem)
	corpo        func(nome string) string // POST válido
	semPai       string                   // POST sem o pai
	frase        string                   // a frase da tela para o pai que falta
	colunas      []string                 // as colunas EXATAS de cada linha da lista (as telas dependem delas)
}

var todosOsAtores = []string{"patGeral", "patT1", "frota", "superFicha", "acessos", "viewer"}

func recursos() []recurso {
	frotaLe := []string{"patGeral", "patT1", "frota", "superFicha"}
	soPatrimonio := []string{"patGeral", "patT1"}
	return []recurso{
		{rota: "/patrimonio/empresas", tabela: "patrimonio_empresas", colunas: []string{"id", "nome", "ordem", "criado_em"}, todos: []string{E1, E2}, leem: frotaLe, criam: frotaLe, alvo: E2,
			corpo: func(n string) string { return `{"nome":"` + n + `","ordem":3}` }},
		{rota: "/patrimonio/locais", tabela: "patrimonio_locais", colunas: []string{"id", "nome", "ordem", "criado_em", "empresa_id"}, todos: []string{L1, L2, L3}, leem: frotaLe, criam: frotaLe, alvo: L1,
			corpo:  func(n string) string { return `{"nome":"` + n + `","empresa_id":"` + E1 + `"}` },
			semPai: `{"nome":"Sem marca"}`, frase: "Escolha a marca antes de criar um local novo."},
		{rota: "/patrimonio/comodos", tabela: "patrimonio_comodos", colunas: []string{"id", "nome", "ordem", "criado_em", "local_id"}, todos: []string{C1}, leem: frotaLe, criam: frotaLe, alvo: C1,
			corpo:  func(n string) string { return `{"nome":"` + n + `","local_id":"` + L1 + `"}` },
			semPai: `{"nome":"Sem local"}`, frase: "Escolha o local antes de criar um ambiente novo."},
		{rota: "/patrimonio/categorias", tabela: "patrimonio_categorias", colunas: []string{"id", "nome", "vida_util_anos", "ordem", "criado_em"}, todos: []string{CatM, CatV}, leem: soPatrimonio, criam: soPatrimonio, alvo: CatM,
			corpo: func(n string) string { return `{"nome":"` + n + `"}` }},
		{rota: "/patrimonio/tipos", tabela: "patrimonio_tipos", colunas: []string{"id", "categoria_id", "nome", "ordem", "criado_em"}, todos: []string{TpM}, leem: soPatrimonio, criam: soPatrimonio,
			corpo:  func(n string) string { return `{"nome":"` + n + `","categoria_id":"` + CatM + `"}` },
			semPai: `{"nome":"Sem categoria"}`, frase: "Escolha a categoria antes de criar um tipo novo."},
	}
}

// VAZAMENTO: cada pessoa recebe exatamente as linhas que a regra de Ler do catálogo deixa.
func TestCadastrosLeitura(t *testing.T) {
	m := novoMundo(t, montarCadastros)
	for _, r := range recursos() {
		quer := slices.Clone(r.todos)
		slices.Sort(quer)
		for _, quem := range todosOsAtores {
			want := []string{}
			if slices.Contains(r.leem, quem) {
				want = quer
			}
			st, corpo := m.Pedir(t, quem, "GET", r.rota, "")
			if got := ids(t, corpo); st != 200 || !slices.Equal(got, want) {
				t.Errorf("%s: %s vê %v (%d), esperava %v", r.rota, quem, got, st, want)
			}
		}
		// o formato: as colunas exatas de cada linha (tela-de-patrimonio.vue:2066-2069, tela-de-frota.vue:1234-1235)
		_, corpo := m.Pedir(t, "patGeral", "GET", r.rota, "")
		var linhas []map[string]any
		if err := json.Unmarshal([]byte(corpo), &linhas); err != nil || len(linhas) != len(r.todos) {
			t.Fatalf("%s: %v %s", r.rota, err, corpo)
		}
		quemColunas := slices.Sorted(maps.Keys(linhas[0]))
		if !slices.Equal(quemColunas, slices.Sorted(slices.Values(r.colunas))) {
			t.Errorf("%s: colunas %v, esperava %v", r.rota, quemColunas, r.colunas)
		}
		m.Rodar(t, []caso{
			{Nome: r.rota + " sem sessão", Metodo: "GET", Caminho: r.rota, Status: 401},
			{Nome: r.rota + " ordem permitida", Quem: "patGeral", Metodo: "GET", Caminho: r.rota + "?ordem=nome", Status: 200},
			{Nome: r.rota + " ordem fora da lista", Quem: "patGeral", Metodo: "GET", Caminho: r.rota + "?ordem=criado_em", Status: 400},
		})
	}
	m.Rodar(t, []caso{
		{Nome: "a Frota acha Veículos como a sincronização acha, mas não lê a lista (paridade)", Quem: "frota", Metodo: "GET",
			Caminho: "/patrimonio/categorias?nome_como=%25ve%25cul%25&limite=1", Status: 200, Tem: "[]"},
		{Nome: "nome_como filtra (sem limite: só NaoTem prova que a outra saiu)", Quem: "patGeral", Metodo: "GET",
			Caminho: "/patrimonio/categorias?nome_como=%25ve%25cul%25", Status: 200, Tem: "Veículos", NaoTem: "Móveis"},
		{Nome: "e com limite=1 do mesmo jeito do pedido da Frota", Quem: "patGeral", Metodo: "GET",
			Caminho: "/patrimonio/categorias?nome_como=%25ve%25cul%25&limite=1", Status: 200, Tem: "Veículos", NaoTem: "Móveis"},
		{Nome: "a ordem padrão é ordem, nome", Quem: "patGeral", Metodo: "GET", Caminho: "/patrimonio/categorias", Status: 200, Tem: "Móveis e Utensílios"},
	})
	// ordem,nome (não nome): Vessel (ordem 1) antes de RBV Company (ordem 2), que alfabeticamente viria antes
	if _, c := m.Pedir(t, "patGeral", "GET", "/patrimonio/empresas", ""); !antes(c, "Vessel", "RBV Company") {
		t.Errorf("ordem padrão das empresas errada (tem de ser ordem, nome): %s", c)
	}
	// ordem,nome: Móveis (2) antes de Veículos (6)
	if _, c := m.Pedir(t, "patGeral", "GET", "/patrimonio/categorias", ""); !antes(c, "Móveis", "Veículos") {
		t.Errorf("ordem padrão errada: %s", c)
	}
}

// antes: a e b aparecem em s e a vem primeiro.
func antes(s, a, b string) bool {
	ia, ib := strings.Index(s, a), strings.Index(s, b)
	return ia >= 0 && ib >= 0 && ia < ib
}

// Criar: quem pode (regra só de ator) pelo handler real, inclusive entrando como outra pessoa; a
// contagem conferida depois de cada pedido.
func TestCadastrosCriar(t *testing.T) {
	m := novoMundo(t, montarCadastros)
	for _, r := range recursos() {
		total, _ := strconv.Atoi(m.Um(t, contar(r.tabela)))
		for i, quem := range append(slices.Clone(todosOsAtores), "impersonado") {
			status, frase := 403, ""
			if slices.Contains(r.criam, quem) {
				status = 201
				total++
			}
			if quem == "impersonado" {
				frase = "Quem entrou como outra pessoa"
			}
			m.Rodar(t, []caso{{Nome: fmt.Sprintf("%s: %s cria", r.rota, quem), Quem: quem, Metodo: "POST", Caminho: r.rota,
				Corpo: r.corpo(fmt.Sprintf("Novo %d", i)), Status: status, Tem: frase,
				Efeito: contar(r.tabela), Quer: strconv.Itoa(total)}})
		}
		m.Rodar(t, []caso{
			{Nome: r.rota + ": nome em branco", Quem: "patGeral", Metodo: "POST", Caminho: r.rota, Corpo: `{"nome":"  "}`, Status: 400,
				Efeito: contar(r.tabela), Quer: strconv.Itoa(total)},
			{Nome: r.rota + ": coluna que a tela não grava", Quem: "patGeral", Metodo: "POST", Caminho: r.rota,
				Corpo: `{"nome":"X","criado_em":"2020-01-01T00:00:00Z"}`, Status: 400, Tem: "corpo_invalido",
				Efeito: contar(r.tabela), Quer: strconv.Itoa(total)},
			{Nome: r.rota + ": id escolhido no corpo", Quem: "patGeral", Metodo: "POST", Caminho: r.rota,
				Corpo: `{"nome":"Com id","id":"` + bemInexistente + `"}`, Status: 400, Tem: "corpo_invalido",
				Efeito: contar(r.tabela), Quer: strconv.Itoa(total)},
			{Nome: r.rota + ": nome repetido no mesmo pai", Quem: "patGeral", Metodo: "POST", Caminho: r.rota,
				Corpo: r.corpo("Novo 0"), Status: 409, Tem: "conflito", Efeito: contar(r.tabela), Quer: strconv.Itoa(total)},
		})
		if r.semPai != "" {
			m.Rodar(t, []caso{{Nome: r.rota + ": sem o pai, com a frase da tela", Quem: "patGeral", Metodo: "POST", Caminho: r.rota,
				Corpo: r.semPai, Status: 400, Tem: r.frase, Efeito: contar(r.tabela), Quer: strconv.Itoa(total)}})
		}
	}
	m.Rodar(t, []caso{
		{Nome: "empresa: ordem vai para a linha", Quem: "patGeral", Metodo: "POST", Caminho: "/patrimonio/empresas",
			Corpo: `{"nome":"Mantova","ordem":3}`, Status: 201, Tem: `"ordem":3`},
		{Nome: "a Frota cria local e a resposta traz a linha (ela lê)", Quem: "frota", Metodo: "POST", Caminho: "/patrimonio/locais",
			Corpo: `{"nome":"Barracão","empresa_id":"` + E1 + `"}`, Status: 201, Tem: `"nome":"Barracão"`},
		{Nome: "o mesmo nome em outra marca passa (único por marca)", Quem: "patGeral", Metodo: "POST", Caminho: "/patrimonio/locais",
			Corpo: `{"nome":"Loja Tivoli","empresa_id":"` + E2 + `"}`, Status: 201},
		{Nome: "o mesmo nome na mesma marca: 409", Quem: "patGeral", Metodo: "POST", Caminho: "/patrimonio/locais",
			Corpo: `{"nome":"Loja Tivoli","empresa_id":"` + E1 + `"}`, Status: 409, Tem: "conflito"},
		{Nome: "pai que não existe", Quem: "patGeral", Metodo: "POST", Caminho: "/patrimonio/locais",
			Corpo: `{"nome":"Fantasma","empresa_id":"a1000000-0000-4000-a000-000000000099"}`, Status: 409},
	})
}

// Renomear e apagar: quem vê e não edita leva 403 (Frota nas três da árvore), quem não vê leva 404; a
// linha fica intacta depois de cada recusa.
func TestCadastrosRenomearEApagar(t *testing.T) {
	m := novoMundo(t, montarCadastros)
	for _, r := range recursos() {
		if r.alvo == "" {
			continue
		}
		u := r.rota + "/" + r.alvo
		nome := m.Um(t, col(r.tabela, "nome", r.alvo))
		existe := "select count(*)::text from " + r.tabela + " where id = '" + r.alvo + "'"
		for _, quem := range []string{"frota", "superFicha", "acessos", "viewer", "impersonado"} {
			status, frase := 404, ""
			switch {
			case quem == "impersonado":
				status, frase = 403, "Quem entrou como outra pessoa"
			case slices.Contains(r.leem, "frota") && (quem == "frota" || quem == "superFicha"):
				status = 403 // vê, não edita
			}
			m.Rodar(t, []caso{
				{Nome: fmt.Sprintf("%s: %s renomeia", r.rota, quem), Quem: quem, Metodo: "PATCH", Caminho: u, Corpo: `{"nome":"Mudou"}`,
					Status: status, Tem: frase, Efeito: col(r.tabela, "nome", r.alvo), Quer: nome},
				{Nome: fmt.Sprintf("%s: %s apaga", r.rota, quem), Quem: quem, Metodo: "DELETE", Caminho: u,
					Status: status, Tem: frase, Efeito: existe, Quer: "1"},
			})
		}
		m.Rodar(t, []caso{
			{Nome: r.rota + ": só o nome muda (ordem é 400)", Quem: "patGeral", Metodo: "PATCH", Caminho: u, Corpo: `{"ordem":2}`,
				Status: 400, Tem: "corpo_invalido", Efeito: col(r.tabela, "nome", r.alvo), Quer: nome},
			{Nome: r.rota + ": o id não muda por PATCH", Quem: "patGeral", Metodo: "PATCH", Caminho: u, Corpo: `{"id":"` + bemInexistente + `","nome":"Mudou"}`,
				Status: 400, Tem: "corpo_invalido", Efeito: col(r.tabela, "nome", r.alvo), Quer: nome},
			{Nome: r.rota + ": o pai não muda por PATCH", Quem: "patGeral", Metodo: "PATCH", Caminho: u,
				Corpo: `{"nome":"Mudou","empresa_id":"` + E2 + `","local_id":"` + L2 + `"}`, Status: 400, Tem: "corpo_invalido",
				Efeito: col(r.tabela, "nome", r.alvo), Quer: nome},
			{Nome: r.rota + ": nome em branco", Quem: "patGeral", Metodo: "PATCH", Caminho: u, Corpo: `{"nome":" "}`, Status: 400,
				Efeito: col(r.tabela, "nome", r.alvo), Quer: nome},
			{Nome: r.rota + ": patrimônio com trava edita (a trava não restringe cadastro)", Quem: "patT1", Metodo: "PATCH", Caminho: u,
				Corpo: `{"nome":"Pela T1"}`, Status: 200, Tem: `"nome":"Pela T1"`, Efeito: col(r.tabela, "nome", r.alvo), Quer: "Pela T1"},
			{Nome: r.rota + ": renomeia", Quem: "patGeral", Metodo: "PATCH", Caminho: u, Corpo: `{"nome":"RBV"}`, Status: 200,
				Efeito: col(r.tabela, "nome", r.alvo), Quer: "RBV"},
			{Nome: r.rota + ": id malformado", Quem: "patGeral", Metodo: "PATCH", Caminho: r.rota + "/nao-e-uuid", Corpo: `{"nome":"x"}`, Status: 404},
		})
	}
	// tipos: sem PATCH nem DELETE (Ruling 5.2-8)
	m.Rodar(t, []caso{
		{Nome: "tipos não renomeia", Quem: "patGeral", Metodo: "PATCH", Caminho: "/patrimonio/tipos/" + TpM, Corpo: `{"nome":"x"}`, Status: 404,
			Efeito: col("patrimonio_tipos", "nome", TpM), Quer: "Mesa"},
		{Nome: "tipos não apaga", Quem: "patGeral", Metodo: "DELETE", Caminho: "/patrimonio/tipos/" + TpM, Status: 404,
			Efeito: contar("patrimonio_tipos"), Quer: "1"},
	})
}

// Apagar em uso é PERMITIDO (paridade com produção: `*_rw` não olha uso; as FKs fazem o resto, e ações
// de FK não passam pela RLS): marca leva locais e ambientes; local leva ambientes; os bens e as equipes
// ficam sem o campo, inclusive os que a pessoa não vê.
func TestCadastrosApagarEmUso(t *testing.T) {
	m := novoMundo(t, montarCadastros)
	nulo := "<nulo>"
	m.Rodar(t, []caso{
		{Nome: "marca: leva o local dela; o bem fica sem local", Quem: "patGeral", Metodo: "DELETE", Caminho: "/patrimonio/empresas/" + E2, Status: 204,
			Efeito: "select (select count(*) from patrimonio_locais where id = '" + L3 + "') || '|' || (select count(*) from patrimonio_bens) || '|' || " +
				"coalesce((select local_id::text from patrimonio_bens where id = '" + B3 + "'), '-')", Quer: "0|6|-"},
		{Nome: "local de outro time, apagado por quem tem trava: o bem que ela não vê perde o local", Quem: "patT1", Metodo: "DELETE",
			Caminho: "/patrimonio/locais/" + L2, Status: 204, Efeito: col("patrimonio_bens", "local_id", B2), Quer: nulo},
		{Nome: "e a equipe do local fica sem local", Efeito: col("equipes", "local_id", T2), Quer: nulo},
		{Nome: "a outra equipe segue", Efeito: col("equipes", "local_id", T1), Quer: L1},
		{Nome: "local com ambiente: leva o ambiente, o bem fica", Quem: "patGeral", Metodo: "DELETE", Caminho: "/patrimonio/locais/" + L1, Status: 204,
			Efeito: "select (select count(*) from patrimonio_comodos) || '|' || (select count(*) from patrimonio_bens) || '|' || " +
				"(select count(*) from equipes where local_id is not null)", Quer: "0|6|0"},
		{Nome: "categoria: leva o tipo, o bem fica sem categoria", Quem: "patGeral", Metodo: "DELETE", Caminho: "/patrimonio/categorias/" + CatM, Status: 204,
			Efeito: "select (select count(*) from patrimonio_tipos) || '|' || (select count(*) from patrimonio_bens where categoria_id is null)", Quer: "0|4"},
	})
}

// A marca em uso por uma equipe (empresa_id, on delete set null) apaga e zera o campo; a marca que é a
// marca de uma pessoa (acessos_pessoas.marca_id, FK SEM on delete) NÃO apaga: o banco recusa (23503 = 409)
// e nada muda. Paridade com produção: a FK decide, a rota não inventa regra de uso.
func TestCadastrosApagarMarcaEmUsoPorEquipeEPessoa(t *testing.T) {
	m := novoMundo(t, montarCadastros)
	if _, err := m.P.Exec(t.Context(), `update equipes set empresa_id = '`+E2+`' where id = '`+T2+`';
		insert into acessos_pessoas (id, nome, marca_id) values ('9e200000-0000-4000-a000-0000000000f1', 'Da RBV', '`+E1+`')`); err != nil {
		t.Fatal(err)
	}
	antes := m.Um(t, fotoDoMundo)
	m.Rodar(t, []caso{
		{Nome: "marca que é a marca de uma pessoa: o banco recusa", Quem: "patGeral", Metodo: "DELETE", Caminho: "/patrimonio/empresas/" + E1,
			Status: 409, Efeito: contar("patrimonio_empresas"), Quer: "2"},
		{Nome: "marca usada só por equipe: apaga e a equipe fica sem marca", Quem: "patGeral", Metodo: "DELETE", Caminho: "/patrimonio/empresas/" + E2,
			Status: 204, Efeito: col("equipes", "empresa_id", T2), Quer: "<nulo>"},
	})
	if depois := m.Um(t, fotoDoMundo); depois == antes {
		t.Error("apagar a marca em uso por equipe não mudou o mundo")
	}
}

// Cada recusa deixa o mundo inteiro como estava (a foto cobre bens, equipes, posses e o resto).
func TestCadastrosRecusasNaoMudamNada(t *testing.T) {
	m := novoMundo(t, montarCadastros)
	antes := m.Um(t, fotoDoMundo)
	var casos []caso
	for _, r := range recursos() {
		for _, quem := range []string{"acessos", "viewer", "impersonado"} {
			casos = append(casos, caso{Nome: r.rota + " " + quem, Quem: quem, Metodo: "POST", Caminho: r.rota, Corpo: r.corpo("Recusado"), Status: 403})
		}
		if r.alvo == "" {
			continue
		}
		statusDaFrota := 404
		if slices.Contains(r.leem, "frota") {
			statusDaFrota = 403
		}
		casos = append(casos,
			caso{Nome: r.rota + " viewer PATCH", Quem: "viewer", Metodo: "PATCH", Caminho: r.rota + "/" + r.alvo, Corpo: `{"nome":"x"}`, Status: 404},
			// a Frota vê marca, local e ambiente mas não edita (403); categoria ela nem vê (404)
			caso{Nome: r.rota + " frota PATCH", Quem: "frota", Metodo: "PATCH", Caminho: r.rota + "/" + r.alvo, Corpo: `{"nome":"x"}`, Status: statusDaFrota},
			caso{Nome: r.rota + " frota DELETE", Quem: "frota", Metodo: "DELETE", Caminho: r.rota + "/" + r.alvo, Status: statusDaFrota},
			caso{Nome: r.rota + " viewer DELETE", Quem: "viewer", Metodo: "DELETE", Caminho: r.rota + "/" + r.alvo, Status: 404},
			caso{Nome: r.rota + " impersonado DELETE", Quem: "impersonado", Metodo: "DELETE", Caminho: r.rota + "/" + r.alvo, Status: 403})
	}
	casos = append(casos,
		caso{Nome: "frota não edita local", Quem: "frota", Metodo: "PATCH", Caminho: "/patrimonio/locais/" + L1, Corpo: `{"nome":"x"}`, Status: 403},
		caso{Nome: "frota não apaga ambiente", Quem: "frota", Metodo: "DELETE", Caminho: "/patrimonio/comodos/" + C1, Status: 403},
		caso{Nome: "frota não cria categoria", Quem: "frota", Metodo: "POST", Caminho: "/patrimonio/categorias", Corpo: `{"nome":"x"}`, Status: 403})
	m.Rodar(t, casos)
	if depois := m.Um(t, fotoDoMundo); depois != antes {
		t.Errorf("as recusas mudaram o mundo: %s -> %s", antes, depois)
	}
}
