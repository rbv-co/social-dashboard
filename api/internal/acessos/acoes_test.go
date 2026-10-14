package acessos

import (
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

func acoesElo(id string) string {
	return "select coalesce(profile_id::text, '<nulo>') from acessos_pessoas where id = '" + id + "'"
}

func acoesTemPessoa(t *testing.T, login, pessoa string) bool {
	t.Helper()
	e, err := autz.CarregarEscopo(t.Context(), mundoPool, login)
	if err != nil {
		t.Fatal(err)
	}
	return slices.Contains(e.Pessoas, pessoa)
}

// mundoPool: o pool do mundo corrente (cada teste abre o seu em novoMundo).
var mundoPool autz.Banco

func TestLigarFichaAoLogin(t *testing.T) {
	m := novoMundo(t, montarPessoas, montarAcoesDaPessoa)
	mundoPool = m.P
	if acoesTemPessoa(t, idViewer, P3) {
		t.Fatal("o Escopo do viewer já tem a P3 antes de ligar")
	}
	st, corpo := m.Pedir(t, "admin", "POST", "/acessos/pessoas/"+P3+"/ligar", `{"profile_id":"`+idViewer+`"}`)
	if st != 200 || !strings.Contains(corpo, `"profile_id":"`+idViewer+`"`) {
		t.Fatalf("ligar = %d %s", st, corpo)
	}
	if !acoesTemPessoa(t, idViewer, P3) {
		t.Error("o Escopo do viewer não passou a ter a P3 (pode_ver_bem)")
	}
	foto := m.Um(t, fotoDosAcessos)
	nada := func(nome, quem, id, corpo string, status int, tem string) caso {
		return caso{Nome: nome, Quem: quem, Metodo: "POST", Caminho: "/acessos/pessoas/" + id + "/ligar", Corpo: corpo,
			Status: status, Tem: tem, Efeito: fotoDosAcessos, Quer: foto}
	}
	m.Rodar(t, []caso{
		{Nome: "de novo ao mesmo login", Quem: "admin", Metodo: "POST", Caminho: "/acessos/pessoas/" + P3 + "/ligar",
			Corpo: `{"profile_id":"` + idViewer + `"}`, Status: 200, Tem: idViewer},
		nada("ficha de outro login = 409", "admin", P3, `{"profile_id":"`+idFrota+`"}`, 409, "já foi ligado a outro login"),
		{Nome: "o elo continua", Efeito: acoesElo(P3), Quer: idViewer},
		nada("P1 ligada a outro login", "admin", P1, `{"profile_id":"`+idViewer+`"}`, 409, "já foi ligado a outro login"),
		nada("sem profile_id", "admin", P3, `{}`, 400, "Diga a conta de login."),
		nada("profile_id vazio", "admin", P3, `{"profile_id":"  "}`, 400, "Diga a conta de login."),
		nada("profile_id não é uuid", "admin", P3, `{"profile_id":"x"}`, 400, ""),
		nada("campo a mais", "admin", P3, `{"profile_id":"`+idViewer+`","nome":"x"}`, 400, "corpo_invalido"),
		nada("id inexistente", "admin", "a4400000-0000-4000-a000-0000000000ff", `{"profile_id":"`+idViewer+`"}`, 404, ""),
		// Ruling 5.4-7: ligar decide pode_ver_bem, então exige papel admin como o excluir (a feature
		// `acessos` sozinha escalava o próprio acesso ao Patrimônio)
		nada("só a feature acessos: 403", "acessos", P3, `{"profile_id":"`+idViewer+`"}`, 403, "Só admin pode ligar."),
		nada("a própria ficha ao próprio login (escalada)", "acessos", P3, `{"profile_id":"`+idAcessos+`"}`, 403, "Só admin pode ligar."),
		nada("entrar como", "impersonado", P1, `{"profile_id":"`+idViewer+`"}`, 403, "Quem entrou como outra pessoa"),
	})
	// o convite do dono (frota) e quem não tem Acessos: 404 e o elo intacto, sem dizer a quem a ficha pertence
	for _, quem := range append([]string{"frota"}, semAcessos...) {
		m.Rodar(t, []caso{nada("sem Acessos: "+quem, quem, P1, `{"profile_id":"`+idViewer+`"}`, 404, "")})
	}
	if v := m.Um(t, acoesElo(P1)); v != idAcessos {
		t.Errorf("elo da P1 = %s", v)
	}
}

// Dois pedidos de admin ligando a MESMA ficha a logins diferentes: o PodeEditar trava a linha, o segundo enxerga o
// elo do primeiro e recebe 409 — nunca dois 200 com o segundo sobrescrevendo.
func TestLigarConcorrente(t *testing.T) {
	m := novoMundo(t, montarPessoas, montarAcoesDaPessoa)
	var st [2]int
	var wg sync.WaitGroup
	for i, x := range []struct{ quem, login string }{{"admin", idViewer}, {"admin", idFrota}} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st[i] = m.Resposta(t, x.quem, "POST", "/acessos/pessoas/"+P3+"/ligar", `{"profile_id":"`+x.login+`"}`).Code
		}()
	}
	wg.Wait()
	slices.Sort(st[:])
	if st != [2]int{200, 409} {
		t.Errorf("ligações simultâneas = %v, esperava [200 409]", st)
	}
	if v := m.Um(t, acoesElo(P3)); v != idViewer && v != idFrota {
		t.Errorf("elo = %s", v)
	}
}

func TestExcluirColaborador(t *testing.T) {
	m := novoMundo(t, montarPessoas, montarAcoesDaPessoa)
	mundoPool = m.P
	foto := m.Um(t, fotoDosAcessos)
	intacto := func(nome, quem, id string, status int, tem string) caso {
		return caso{Nome: nome, Quem: quem, Metodo: "DELETE", Caminho: "/acessos/pessoas/" + id, Status: status, Tem: tem,
			Efeito: fotoDosAcessos, Quer: foto}
	}
	casos := []caso{
		{Nome: "sem sessão", Metodo: "DELETE", Caminho: "/acessos/pessoas/" + P2, Status: 401},
		intacto("só a feature acessos: 403", "acessos", P2, 403, "Só admin pode excluir."),
		intacto("entrar como", "impersonado", P2, 403, "Quem entrou como outra pessoa"),
	}
	for _, quem := range semAcessos {
		casos = append(casos, intacto("sem Acessos: "+quem, quem, P2, 404, ""))
	}
	m.Rodar(t, casos)
	if m.Um(t, "select count(*)::text from acessos_vinculos where id = '"+V2+"'") != "1" {
		t.Fatal("o vínculo V2 sumiu num pedido negado")
	}
	m.Rodar(t, []caso{
		{Nome: "admin exclui P2", Quem: "admin", Metodo: "DELETE", Caminho: "/acessos/pessoas/" + P2, Status: 204,
			Efeito: "select count(*)::text from acessos_pessoas where id = '" + P2 + "'", Quer: "0"},
		{Nome: "cascata: vínculo", Efeito: "select count(*)::text from acessos_vinculos where id = '" + V2 + "'", Quer: "0"},
		{Nome: "FK set null: bem e carro do Bruno", Efeito: "select (select coalesce(pessoa_id::text, '<nulo>') from patrimonio_bens where id = '" + B1 + "') || ',' || (select coalesce(pessoa_id::text, '<nulo>') from frota_veiculos where id = '" + F1 + "')", Quer: "<nulo>,<nulo>"},
		{Nome: "de novo = 404", Quem: "admin", Metodo: "DELETE", Caminho: "/acessos/pessoas/" + P2, Status: 404},
		{Nome: "vínculos e termos de outros ficam", Efeito: "select (select count(*) from acessos_vinculos where id = '" + V1 + "') || ',' || (select count(*) from acessos_termos where id = '" + T1 + "')", Quer: "1,1"},
	})
	if !acoesTemPessoa(t, idAcessos, P1) {
		t.Fatal("pré-condição: o acessos deveria ter a P1 no Escopo")
	}
	m.Rodar(t, []caso{
		{Nome: "admin exclui P1", Quem: "admin", Metodo: "DELETE", Caminho: "/acessos/pessoas/" + P1, Status: 204,
			Efeito: "select (select count(*) from acessos_termos where id = '" + T1 + "') || ',' || (select count(*) from acessos_vinculos where id = '" + V1 + "')", Quer: "0,0"},
	})
	if acoesTemPessoa(t, idAcessos, P1) {
		t.Error("o Escopo do acessos manteve a P1 excluída")
	}
}

func TestTrilha(t *testing.T) {
	m := novoMundo(t, montarPessoas, montarAcoesDaPessoa)
	foto := m.Um(t, fotoDosAcessos)
	nada := func(nome, quem, corpo string, status int, tem string) caso {
		return caso{Nome: nome, Quem: quem, Metodo: "POST", Caminho: "/acessos/log", Corpo: corpo, Status: status, Tem: tem,
			Efeito: fotoDosAcessos, Quer: foto}
	}
	m.Rodar(t, []caso{
		nada("quem não vem do navegador", "acessos", `{"acao":"x","quem":"`+idAdmin+`"}`, 400, "corpo_invalido"),
		nada("quando é do banco", "acessos", `{"acao":"x","quando":"2020-01-01T00:00:00Z"}`, 400, "corpo_invalido"),
		nada("resultado fora de ok|erro", "acessos", `{"acao":"x","resultado":"parcial"}`, 400, ""),
		nada("ação em branco", "acessos", `{"acao":" "}`, 400, "Diga a ação."),
		nada("sem Acessos", "frota", `{"acao":"x"}`, 403, ""),
		nada("entrar como", "impersonado", `{"acao":"x"}`, 403, "Quem entrou como outra pessoa"),
	})
	for _, quem := range semAcessos {
		m.Rodar(t, []caso{nada("sem Acessos: "+quem, quem, `{"acao":"x"}`, 403, "")})
	}
	m.Rodar(t, []caso{
		{Nome: "grava com a autoria da sessão", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/log",
			Corpo:  `{"acao":"colaborador.editar","alvo":"colab:Ana","resultado":"ok","detalhe":null}`,
			Status: 201, Tem: `"quem":"` + idAcessos + `"`,
			Efeito: "select count(*)::text from acessos_log where acao = 'colaborador.editar' and quem = '" + idAcessos + "'", Quer: "1"},
	})
}
