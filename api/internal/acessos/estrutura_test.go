package acessos

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const fraseEntrarComo = "Quem entrou como outra pessoa não grava em Colaboradores e Acessos."

func idsDe(t *testing.T, corpo string) []string {
	t.Helper()
	var l []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(corpo), &l); err != nil {
		t.Fatalf("%v: %s", err, corpo)
	}
	out := make([]string, len(l))
	for i, x := range l {
		out[i] = x.ID
	}
	return out
}

func contagem(tabela string) string { return "select count(*)::text from " + tabela }

func coluna(tabela, col, id string) string {
	return "select " + col + "::text from " + tabela + " where id = '" + id + "'"
}

// quemPode: a matriz de produção. Quem pode o quê vem das policies do catálogo (acessos_organizacoes_rw e
// acessos_setores_rw: is_acessos_admin() para tudo), avaliadas no escopo REAL de cada pessoa do mundo
// (a conta desativada fica de fora: nem sessão tem), e não de uma lista escrita à mão aqui.
func quemPode(t *testing.T, m *mundoteste.Mundo, tabela string, op autz.Op) []string {
	t.Helper()
	var quem []string
	for _, p := range pessoas {
		if p.Desativado {
			continue
		}
		e, err := autz.CarregarEscopo(t.Context(), m.P, p.ID)
		if err != nil {
			t.Fatal(err)
		}
		f, err := autz.Producao.Filtro(e, tabela, op, "t")
		if err != nil {
			t.Fatal(err)
		}
		if !f.Nega() {
			quem = append(quem, p.Chave)
		}
	}
	return quem
}

// A matriz de produção tem de separar as pessoas do mundo (senão os testes abaixo provariam nada).
func TestEstruturaMatrizDeProducao(t *testing.T) {
	m := novoMundo(t, montarEstrutura)
	for _, tb := range []string{"acessos_organizacoes", "acessos_setores"} {
		for _, op := range []autz.Op{autz.Ler, autz.Criar, autz.Apagar} {
			if q := quemPode(t, m, tb, op); !slices.Equal(q, []string{"acessos", "admin"}) {
				t.Errorf("%s %s: podem %v, esperava acessos e admin", tb, op, q)
			}
		}
	}
}

type recursoEstrutura struct {
	rota, tabela string
	todos        []string
	corpo        func(nome string) string
	alvo         string
}

func recursosEstrutura() []recursoEstrutura {
	return []recursoEstrutura{
		{rota: "/acessos/organizacoes", tabela: "acessos_organizacoes", todos: []string{O1, O2}, alvo: O2,
			corpo: func(n string) string { return `{"nome":"` + n + `","ordem":3}` }},
		{rota: "/acessos/setores", tabela: "acessos_setores", todos: []string{S1, S2}, alvo: S1,
			corpo: func(n string) string { return `{"nome":"` + n + `","organizacao_id":"` + O2 + `"}` }},
	}
}

// VAZAMENTO: cada pessoa recebe exatamente as linhas que a regra de Ler do catálogo deixa.
func TestEstruturaLeitura(t *testing.T) {
	m := novoMundo(t, montarEstrutura)
	for _, r := range recursosEstrutura() {
		leem := quemPode(t, m, r.tabela, autz.Ler)
		for _, p := range pessoas {
			if p.Desativado {
				continue
			}
			quer := []string{}
			if slices.Contains(leem, p.Chave) {
				quer = r.todos
			}
			st, corpo := m.Pedir(t, p.Chave, "GET", r.rota, "")
			if got := idsDe(t, corpo); st != http.StatusOK || !slices.Equal(got, quer) {
				t.Errorf("%s: %s vê %v (%d), esperava %v", r.rota, p.Chave, got, st, quer)
			}
		}
		m.Rodar(t, []caso{
			{Nome: r.rota + " sem sessão", Metodo: "GET", Caminho: r.rota, Status: http.StatusUnauthorized},
			{Nome: r.rota + " conta desativada", Quem: "desativado", Metodo: "GET", Caminho: r.rota, Status: http.StatusUnauthorized},
			{Nome: r.rota + " quem entrou como outra pessoa lê como ela", Quem: "impersonado", Metodo: "GET", Caminho: r.rota, Status: http.StatusOK, Tem: r.todos[0]},
			{Nome: r.rota + " ordem fora da lista", Quem: "acessos", Metodo: "GET", Caminho: r.rota + "?ordem=criado_em", Status: http.StatusBadRequest},
		})
	}
	// a ordem da tela (ordem, nome) é a padrão; ?ordem=nome é a do admin
	_, c := m.Pedir(t, "acessos", "GET", "/acessos/organizacoes", "")
	if !(strings.Index(c, "Sede Centro") < strings.Index(c, "Fábrica Conchal")) {
		t.Errorf("ordem padrão das organizações errada (ordem, nome): %s", c)
	}
	_, c = m.Pedir(t, "admin", "GET", "/acessos/organizacoes?ordem=nome", "")
	if !(strings.Index(c, "Fábrica Conchal") < strings.Index(c, "Sede Centro")) {
		t.Errorf("?ordem=nome das organizações errada: %s", c)
	}
	_, c = m.Pedir(t, "acessos", "GET", "/acessos/setores", "")
	if !(strings.Index(c, `"RH"`) < strings.Index(c, `"Comercial"`)) {
		t.Errorf("ordem padrão dos setores errada (RH tem ordem 1): %s", c)
	}
	_, c = m.Pedir(t, "admin", "GET", "/acessos/setores?ordem=nome", "")
	if !(strings.Index(c, `"Comercial"`) < strings.Index(c, `"RH"`)) {
		t.Errorf("?ordem=nome dos setores errada: %s", c)
	}
	for _, r := range recursosEstrutura() {
		if w := m.Resposta(t, "acessos", "GET", r.rota+"?contar=1&limite=1", ""); w.Code != http.StatusOK ||
			w.Header().Get("X-Total-Count") != "2" || len(idsDe(t, w.Body.String())) != 1 {
			t.Errorf("%s ?contar=1&limite=1: %d total=%q %s", r.rota, w.Code, w.Header().Get("X-Total-Count"), w.Body.String())
		}
		// quem não pode ler não descobre nem o total
		if w := m.Resposta(t, "viewer", "GET", r.rota+"?contar=1&limite=1", ""); w.Header().Get("X-Total-Count") != "0" {
			t.Errorf("%s: o total vazou para quem não lê: %q", r.rota, w.Header().Get("X-Total-Count"))
		}
	}
}

// Criar: quem pode (policy de produção) pelo handler real, inclusive entrando como outra pessoa; a
// contagem e a foto inteira conferidas depois de cada recusa.
func TestEstruturaCriar(t *testing.T) {
	m := novoMundo(t, montarEstrutura)
	for _, r := range recursosEstrutura() {
		criam := quemPode(t, m, r.tabela, autz.Criar)
		total, _ := strconv.Atoi(m.Um(t, contagem(r.tabela)))
		for i, p := range append(slices.Clone(pessoas), mundoteste.Pessoa{Chave: "impersonado"}) {
			if p.Desativado {
				continue
			}
			status, frase := http.StatusForbidden, ""
			if slices.Contains(criam, p.Chave) {
				status = http.StatusCreated
				total++
			}
			if p.Chave == "impersonado" {
				frase = fraseEntrarComo
			}
			foto := m.Um(t, fotoDosAcessos)
			m.Rodar(t, []caso{{Nome: fmt.Sprintf("%s: %s cria", r.rota, p.Chave), Quem: p.Chave, Metodo: "POST", Caminho: r.rota,
				Corpo: r.corpo(fmt.Sprintf("Novo %d", i)), Status: status, Tem: frase,
				Efeito: contagem(r.tabela), Quer: strconv.Itoa(total)}})
			if status == http.StatusForbidden && m.Um(t, fotoDosAcessos) != foto {
				t.Errorf("%s: a recusa a %s mudou o mundo", r.rota, p.Chave)
			}
		}
		foto := m.Um(t, fotoDosAcessos)
		m.Rodar(t, []caso{
			{Nome: r.rota + ": sem sessão", Metodo: "POST", Caminho: r.rota, Corpo: r.corpo("x"), Status: http.StatusUnauthorized},
			{Nome: r.rota + ": nome em branco", Quem: "acessos", Metodo: "POST", Caminho: r.rota, Corpo: `{"nome":""}`, Status: http.StatusBadRequest, Tem: "Nome é obrigatório"},
			{Nome: r.rota + ": só espaços", Quem: "acessos", Metodo: "POST", Caminho: r.rota, Corpo: `{"nome":"   "}`, Status: http.StatusBadRequest, Tem: "Nome é obrigatório"},
			{Nome: r.rota + ": sem nome", Quem: "acessos", Metodo: "POST", Caminho: r.rota, Corpo: `{"ordem":1}`, Status: http.StatusBadRequest, Tem: "Nome é obrigatório"},
			{Nome: r.rota + ": nome null", Quem: "acessos", Metodo: "POST", Caminho: r.rota, Corpo: `{"nome":null}`, Status: http.StatusBadRequest, Tem: "Nome é obrigatório"},
			{Nome: r.rota + ": coluna que a tela não grava", Quem: "acessos", Metodo: "POST", Caminho: r.rota,
				Corpo: `{"nome":"X","criado_em":"2020-01-01T00:00:00Z"}`, Status: http.StatusBadRequest, Tem: "corpo_invalido"},
			{Nome: r.rota + ": id vem da rota, não do corpo", Quem: "acessos", Metodo: "POST", Caminho: r.rota,
				Corpo: `{"nome":"X","id":"a4100000-0000-4000-a000-0000000000aa"}`, Status: http.StatusBadRequest, Tem: "corpo_invalido"},
			{Nome: r.rota + ": ordem que não é número", Quem: "acessos", Metodo: "POST", Caminho: r.rota, Corpo: `{"nome":"X","ordem":"abc"}`, Status: http.StatusBadRequest},
		})
		if m.Um(t, fotoDosAcessos) != foto || m.Um(t, contagem(r.tabela)) != strconv.Itoa(total) {
			t.Errorf("%s: as recusas 400 mudaram o mundo", r.rota)
		}
	}

	m.Rodar(t, []caso{
		{Nome: "organização: ordem e nome vão para a linha", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/organizacoes",
			Corpo: `{"nome":"Sede Village","ordem":3}`, Status: http.StatusCreated, Tem: `"ordem":3`},
	})

	antes := m.Um(t, contagem("acessos_organizacoes"))
	foto := m.Um(t, fotoDosAcessos)
	m.Rodar(t, []caso{
		{Nome: "organização: nome repetido", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/organizacoes",
			Corpo: `{"nome":"Fábrica Conchal"}`, Status: http.StatusConflict, Tem: "conflito", Efeito: contagem("acessos_organizacoes"), Quer: antes},
		{Nome: "setor: nome repetido NA MESMA organização", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/setores",
			Corpo: `{"nome":"RH","organizacao_id":"` + O1 + `"}`, Status: http.StatusConflict, Tem: "conflito"},
		{Nome: "setor: organização que não existe", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/setores",
			Corpo: `{"nome":"Fantasma","organizacao_id":"a4100000-0000-4000-a000-000000000099"}`, Status: http.StatusConflict, Tem: "conflito"},
	})
	if m.Um(t, fotoDosAcessos) != foto {
		t.Error("as recusas 409 mudaram o mundo")
	}
	m.Rodar(t, []caso{
		{Nome: "setor: o mesmo nome em OUTRA organização passa (único por organização)", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/setores",
			Corpo: `{"nome":"RH","organizacao_id":"` + O2 + `"}`, Status: http.StatusCreated, Tem: `"organizacao_id":"` + O2 + `"`},
		{Nome: "setor: ordem e organização na resposta", Quem: "admin", Metodo: "POST", Caminho: "/acessos/setores",
			Corpo: `{"nome":"Logística","ordem":7,"organizacao_id":"` + O1 + `"}`, Status: http.StatusCreated, Tem: `"ordem":7`},
	})
	// defaults do banco: ordem 0 sem corpo, criado_em do servidor
	if _, c := m.Pedir(t, "acessos", "POST", "/acessos/organizacoes", `{"nome":"Sede Lagoa"}`); !strings.Contains(c, `"ordem":0`) || !strings.Contains(c, `"criado_em":"`) {
		t.Errorf("defaults da organização: %s", c)
	}
}

// Apagar em uso é PERMITIDO (paridade com produção: acessos_*_rw não olha uso; a tela já avisa "ficarão
// sem setor"): as FKs on delete set null fazem o resto, inclusive em linhas que a pessoa não alcança.
// DECISÃO (paridade): a rota não inventa regra de uso; o que o banco decide é o que vale.
func TestEstruturaApagarEmUso(t *testing.T) {
	m := novoMundo(t, montarEstrutura)
	m.Rodar(t, []caso{
		{Nome: "antes: o time e a Carla apontam para o Comercial", Efeito: coluna("equipes", "setor_id", EQ1), Quer: S2},
		{Nome: "setor em uso por time e pessoa: apaga", Quem: "acessos", Metodo: "DELETE", Caminho: "/acessos/setores/" + S2, Status: http.StatusNoContent,
			Efeito: "select (select count(*) from acessos_setores where id = '" + S2 + "') || '|' || coalesce((select setor_id::text from equipes where id = '" + EQ1 +
				"'), '-') || '|' || coalesce((select setor_id::text from acessos_pessoas where id = '" + P3 + "'), '-') || '|' || (select count(*) from equipes) || '|' || (select count(*) from acessos_pessoas)",
			Quer: "0|-|-|1|3"},
		{Nome: "a Ana, do outro setor, segue", Efeito: coluna("acessos_pessoas", "setor_id", P1), Quer: S1},
		{Nome: "organização em uso: apaga; setor e pessoas ficam sem organização", Quem: "admin", Metodo: "DELETE", Caminho: "/acessos/organizacoes/" + O1, Status: http.StatusNoContent,
			Efeito: "select (select count(*) from acessos_organizacoes where id = '" + O1 + "') || '|' || coalesce((select organizacao_id::text from acessos_setores where id = '" + S1 +
				"'), '-') || '|' || coalesce((select organizacao_id::text from acessos_pessoas where id = '" + P1 + "'), '-') || '|' || (select count(*) from acessos_setores) || '|' || (select count(*) from acessos_pessoas)",
			Quer: "0|-|-|1|3"},
		{Nome: "o setor da Ana segue (só perdeu a organização)", Efeito: coluna("acessos_pessoas", "setor_id", P1), Quer: S1},
		{Nome: "a outra organização segue", Efeito: contagem("acessos_organizacoes"), Quer: "1"},
		{Nome: "apagar de novo: 404", Quem: "acessos", Metodo: "DELETE", Caminho: "/acessos/organizacoes/" + O1, Status: http.StatusNotFound},
		{Nome: "o setor apagado não volta", Quem: "acessos", Metodo: "DELETE", Caminho: "/acessos/setores/" + S2, Status: http.StatusNotFound},
	})
}

// IDOR e portões do DELETE: quem não vê leva 404 (não descobre que existe), quem entrou como outra
// pessoa leva 403 com a frase; id inexistente ou malformado, 404. O mundo fica como estava.
func TestEstruturaApagarNegados(t *testing.T) {
	m := novoMundo(t, montarEstrutura)
	foto := m.Um(t, fotoDosAcessos)
	var casos []caso
	for _, r := range recursosEstrutura() {
		u := r.rota + "/" + r.alvo
		for _, quem := range semAcessos {
			casos = append(casos, caso{Nome: r.rota + ": " + quem + " apaga", Quem: quem, Metodo: "DELETE", Caminho: u, Status: http.StatusNotFound})
		}
		casos = append(casos,
			caso{Nome: r.rota + ": sem sessão", Metodo: "DELETE", Caminho: u, Status: http.StatusUnauthorized},
			caso{Nome: r.rota + ": conta desativada", Quem: "desativado", Metodo: "DELETE", Caminho: u, Status: http.StatusUnauthorized},
			caso{Nome: r.rota + ": quem entrou como outra pessoa", Quem: "impersonado", Metodo: "DELETE", Caminho: u, Status: http.StatusForbidden, Tem: fraseEntrarComo},
			caso{Nome: r.rota + ": id que não existe", Quem: "acessos", Metodo: "DELETE", Caminho: r.rota + "/a4100000-0000-4000-a000-000000000099", Status: http.StatusNotFound},
			caso{Nome: r.rota + ": id malformado", Quem: "acessos", Metodo: "DELETE", Caminho: r.rota + "/nao-e-uuid", Status: http.StatusNotFound},
			// sem PATCH: nenhuma tela renomeia
			caso{Nome: r.rota + ": sem PATCH", Quem: "acessos", Metodo: "PATCH", Caminho: u, Corpo: `{"nome":"x"}`, Status: http.StatusMethodNotAllowed},
		)
	}
	// IDOR cruzado do brief: semAcessos em O2 e S1
	casos = append(casos,
		caso{Nome: "IDOR O2", Quem: "viewer", Metodo: "DELETE", Caminho: "/acessos/organizacoes/" + O2, Status: http.StatusNotFound, Efeito: coluna("acessos_organizacoes", "nome", O2), Quer: "Fábrica Conchal"},
		caso{Nome: "IDOR S1", Quem: "frota", Metodo: "DELETE", Caminho: "/acessos/setores/" + S1, Status: http.StatusNotFound, Efeito: coluna("acessos_setores", "nome", S1), Quer: "RH"},
	)
	m.Rodar(t, casos)
	if m.Um(t, fotoDosAcessos) != foto {
		t.Error("as recusas do DELETE mudaram o mundo")
	}
}
