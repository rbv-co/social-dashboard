package redes

import (
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// fotoContas: hash da tabela accounts inteira (token e publicacao_automatica inclusive).
const fotoContas = `select md5(string_agg(a::text, '|' order by a.id)) from accounts a`

func TestContas(t *testing.T) {
	m := novoMundo(t, montarContas)

	// GET: qualquer sessão vê as duas contas (a tabela não tem a restritiva em produção), nunca o token.
	for _, quem := range []string{"todas", "soA1", "nenhuma", "semModulo", "impersonado"} {
		st, corpo := m.Pedir(t, quem, "GET", "/redes/contas", "")
		if st != 200 {
			t.Errorf("GET como %s = %d %s", quem, st, corpo)
			continue
		}
		for _, tem := range []string{A1, A2, `"persona":"Mulheres 30+"`, `"name":"Vessel"`, `"name":"Mantova"`} {
			if !strings.Contains(corpo, tem) {
				t.Errorf("GET como %s sem %q: %s", quem, tem, corpo)
			}
		}
		for _, naoTem := range []string{"SEGREDO", `"access_token":`, `"publicacao_automatica":`} {
			if strings.Contains(corpo, naoTem) {
				t.Errorf("GET como %s vazou %q: %s", quem, naoTem, corpo)
			}
		}
	}
	_, corpo := m.Pedir(t, "todas", "GET", "/redes/contas?ordem=name.desc", "")
	if strings.Index(corpo, "Vessel") > strings.Index(corpo, "Mantova") {
		t.Errorf("?ordem=name.desc devia pôr Vessel antes de Mantova: %s", corpo)
	}
	_, corpo = m.Pedir(t, "todas", "GET", "/redes/contas", "")
	if strings.Index(corpo, "Mantova") > strings.Index(corpo, "Vessel") {
		t.Errorf("ordem padrão é por nome (Mantova antes de Vessel): %s", corpo)
	}

	foto := m.Um(t, fotoContas)
	intacta := func(nome, quem, metodo, caminho, corpo string, st int, tem string) mundoteste.Caso {
		return mundoteste.Caso{Nome: nome, Quem: quem, Metodo: metodo, Caminho: caminho, Corpo: corpo,
			Status: st, Tem: tem, NaoTem: "SEGREDO", Efeito: fotoContas, Quer: foto}
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "ordem por token", Quem: "todas", Metodo: "GET", Caminho: "/redes/contas?ordem=access_token", Status: 400},
		{Nome: "select de token", Quem: "todas", Metodo: "GET", Caminho: "/redes/contas?select=access_token", Status: 400},
		{Nome: "desativado", Quem: "desativado", Metodo: "GET", Caminho: "/redes/contas", Status: 401},
		{Nome: "sem sessão", Quem: "", Metodo: "GET", Caminho: "/redes/contas", Status: 401},

		// Negados: linha intacta.
		intacta("viewer", "todas", "PATCH", "/redes/contas/"+A1, `{"persona":"x"}`, 403, ""),
		intacta("super pela ficha, papel viewer", "superA1", "PATCH", "/redes/contas/"+A1, `{"persona":"x"}`, 403, ""),
		intacta("impersonado", "impersonado", "PATCH", "/redes/contas/"+A1, `{"persona":"x"}`, 403, "Quem entrou como outra pessoa"),
		intacta("sem sessão", "", "PATCH", "/redes/contas/"+A1, `{"persona":"x"}`, 401, ""),
		intacta("access_token", "adminA1", "PATCH", "/redes/contas/"+A1, `{"access_token":"x"}`, 400, "corpo_invalido"),
		intacta("publicacao_automatica", "adminA1", "PATCH", "/redes/contas/"+A1, `{"publicacao_automatica":false}`, 400, "corpo_invalido"),
		intacta("id", "adminA1", "PATCH", "/redes/contas/"+A1, `{"id":"`+A2+`"}`, 400, ""),
		intacta("name vazio", "adminA1", "PATCH", "/redes/contas/"+A1, `{"name":""}`, 400, ""),
		intacta("name em branco", "adminA1", "PATCH", "/redes/contas/"+A1, `{"name":"   "}`, 400, ""),
		intacta("name nulo", "adminA1", "PATCH", "/redes/contas/"+A1, `{"name":null}`, 400, ""),
		intacta("name grande", "adminA1", "PATCH", "/redes/contas/"+A1, `{"name":"`+strings.Repeat("x", 101)+`"}`, 400, ""),
		intacta("cor", "adminA1", "PATCH", "/redes/contas/"+A1, `{"accent_color":"vermelho"}`, 400, ""),
		intacta("cor nula", "adminA1", "PATCH", "/redes/contas/"+A1, `{"accent_color":null}`, 400, ""),
		intacta("portal texto", "adminA1", "PATCH", "/redes/contas/"+A1, `{"conteudo_usa_portal":"sim"}`, 400, ""),
		intacta("portal nulo", "adminA1", "PATCH", "/redes/contas/"+A1, `{"conteudo_usa_portal":null}`, 400, ""),
		intacta("persona grande", "adminA1", "PATCH", "/redes/contas/"+A1, `{"persona":"`+strings.Repeat("x", 20001)+`"}`, 400, ""),
		intacta("vazio", "adminA1", "PATCH", "/redes/contas/"+A1, `{}`, 400, ""),
		intacta("inexistente", "adminA1", "PATCH", "/redes/contas/"+A3, `{"persona":"x"}`, 404, ""),
		intacta("id inválido", "adminA1", "PATCH", "/redes/contas/abc", `{"persona":"x"}`, 404, ""),

		// Admin: persona; o token fica.
		{Nome: "persona", Quem: "adminA1", Metodo: "PATCH", Caminho: "/redes/contas/" + A1, Corpo: `{"persona":"Mulheres 35+"}`,
			Status: 200, Tem: `"persona":"Mulheres 35+"`, NaoTem: "SEGREDO",
			Efeito: `select persona || '|' || access_token from accounts where id = '` + A1 + `'`, Quer: "Mulheres 35+|SEGREDO-token-A1"},
		// admin de A1 edita A2 (accounts não tem a restritiva).
		{Nome: "outra conta", Quem: "adminA1", Metodo: "PATCH", Caminho: "/redes/contas/" + A2, Corpo: `{"persona":null}`,
			Status: 200, NaoTem: "SEGREDO",
			Efeito: `select coalesce(persona, '<nulo>') || '|' || access_token from accounts where id = '` + A2 + `'`, Quer: "<nulo>|SEGREDO-token-A2"},
		{Nome: "quatro colunas", Quem: "adminA1", Metodo: "PATCH", Caminho: "/redes/contas/" + A1,
			Corpo:  `{"name":"Vessel Brasil","username":"vesselbr","accent_color":"#112233","conteudo_usa_portal":true}`,
			Status: 200, Tem: `"username":"vesselbr"`, NaoTem: "SEGREDO",
			Efeito: `select name || '|' || username || '|' || accent_color || '|' || conteudo_usa_portal || '|' || publicacao_automatica from accounts where id = '` + A1 + `'`,
			Quer:   "Vessel Brasil|vesselbr|#112233|true|true"},
		{Nome: "username nulo", Quem: "adminA1", Metodo: "PATCH", Caminho: "/redes/contas/" + A1, Corpo: `{"username":null}`,
			Status: 200, Efeito: `select coalesce(username, '<nulo>') from accounts where id = '` + A1 + `'`, Quer: "<nulo>"},
	})
}
