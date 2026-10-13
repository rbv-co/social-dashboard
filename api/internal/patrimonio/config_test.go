package patrimonio

import (
	"net/http"
	"strings"
	"testing"
)

const (
	cfgNumero = "select valor from patrimonio_config where chave = 'numero_maximo'"
	cfgLinhas = "select count(*)::text from patrimonio_config where chave = 'numero_maximo'"
	fraseImp  = "Quem entrou como outra pessoa só consulta."
)

// TestConfigELog: a configuração e o log do Patrimônio. Quem pode é is_patrimonio_admin (o módulo, sem
// olhar a trava: a configuração é da empresa); o PUT é upsert pela chave da lista fechada; o log grava
// `quem` da sessão e não tem leitura. Sessão de "entrar como" só consulta.
func TestConfigELog(t *testing.T) {
	m := novoMundo(t, montarConfig)

	// leitura
	for _, c := range []struct{ quem, quer string }{
		{"patGeral", `"numero_maximo"`}, {"patT1", `"numero_maximo"`}, {"impersonado", `"numero_maximo"`},
		{"frota", `[]`}, {"viewer", `[]`}, {"acessos", `[]`}, {"superFicha", `[]`},
	} {
		st, corpo := m.Pedir(t, c.quem, "GET", "/patrimonio/config", "")
		if st != http.StatusOK || (c.quer == `[]` && corpo != `[]`) || (c.quer != `[]` && !contem(corpo, c.quer, `"valor":"400"`, `"atualizado_em"`)) {
			t.Errorf("GET config como %s: %d %s", c.quem, st, corpo)
		}
	}
	m.Rodar(t, []caso{{Nome: "sem sessão", Metodo: "GET", Caminho: "/patrimonio/config", Status: http.StatusUnauthorized}})

	// gravação
	antes := m.Um(t, "select atualizado_em::text from patrimonio_config where chave = 'numero_maximo'")
	maior := "select (atualizado_em > '" + antes + "'::timestamptz)::text from patrimonio_config where chave = 'numero_maximo'"
	m.Rodar(t, []caso{
		{Nome: "patGeral grava", Quem: "patGeral", Metodo: "PUT", Caminho: "/patrimonio/config/numero_maximo", Corpo: `{"valor":"500"}`,
			Status: http.StatusOK, Tem: `"valor":"500"`, NaoTem: `"error"`, Efeito: cfgNumero, Quer: "500"},
		{Nome: "o relógio é do servidor", Efeito: maior, Quer: "true"},
		{Nome: "patT1 (com trava) também: a configuração é da empresa", Quem: "patT1", Metodo: "PUT", Caminho: "/patrimonio/config/numero_maximo",
			Corpo: `{"valor":"600"}`, Status: http.StatusOK, Tem: `"valor":"600"`, Efeito: cfgNumero, Quer: "600"},
		{Nome: "valor com 6 dígitos", Quem: "patGeral", Metodo: "PUT", Caminho: "/patrimonio/config/numero_maximo",
			Corpo: `{"valor":"999999"}`, Status: http.StatusOK, Efeito: cfgNumero, Quer: "999999"},
	})
	m.Rodar(t, []caso{{Nome: "volta a 600", Quem: "patT1", Metodo: "PUT", Caminho: "/patrimonio/config/numero_maximo",
		Corpo: `{"valor":"600"}`, Status: http.StatusOK, Efeito: cfgNumero, Quer: "600"}})

	recusas := []caso{
		{Nome: "frota", Quem: "frota", Corpo: `{"valor":"1"}`, Status: http.StatusForbidden},
		{Nome: "viewer", Quem: "viewer", Corpo: `{"valor":"1"}`, Status: http.StatusForbidden},
		{Nome: "acessos", Quem: "acessos", Corpo: `{"valor":"1"}`, Status: http.StatusForbidden},
		{Nome: "super pela ficha sem o módulo", Quem: "superFicha", Corpo: `{"valor":"1"}`, Status: http.StatusForbidden},
		{Nome: "impersonado (a patGeral, mas entrou como)", Quem: "impersonado", Corpo: `{"valor":"1"}`, Status: http.StatusForbidden, Tem: fraseImp},
		{Nome: "zero", Quem: "patGeral", Corpo: `{"valor":"0"}`, Status: http.StatusBadRequest, Tem: "pedido_invalido"},
		{Nome: "texto", Quem: "patGeral", Corpo: `{"valor":"abc"}`, Status: http.StatusBadRequest, Tem: "pedido_invalido"},
		{Nome: "grande demais", Quem: "patGeral", Corpo: `{"valor":"1234567"}`, Status: http.StatusBadRequest, Tem: "pedido_invalido"},
		{Nome: "número, não texto", Quem: "patGeral", Corpo: `{"valor":500}`, Status: http.StatusBadRequest, Tem: "corpo_invalido"},
		{Nome: "com zero à esquerda", Quem: "patGeral", Corpo: `{"valor":"0500"}`, Status: http.StatusBadRequest, Tem: "pedido_invalido"},
		{Nome: "o relógio não vem do corpo", Quem: "patGeral", Corpo: `{"valor":"500","atualizado_em":"x"}`, Status: http.StatusBadRequest, Tem: "corpo_invalido"},
		{Nome: "a chave não vem do corpo", Quem: "patGeral", Corpo: `{"valor":"500","chave":"x"}`, Status: http.StatusBadRequest, Tem: "corpo_invalido"},
	}
	for i := range recusas {
		recusas[i].Metodo, recusas[i].Caminho = "PUT", "/patrimonio/config/numero_maximo"
		recusas[i].Efeito, recusas[i].Quer = cfgNumero, "600"
	}
	m.Rodar(t, recusas)
	m.Rodar(t, []caso{
		{Nome: "chave fora da lista", Quem: "patGeral", Metodo: "PUT", Caminho: "/patrimonio/config/outra", Corpo: `{"valor":"1"}`,
			Status: http.StatusNotFound, Efeito: "select count(*)::text from patrimonio_config", Quer: "1"},
		{Nome: "chave fora da lista, sem permissão: o mesmo 404", Quem: "viewer", Metodo: "PUT", Caminho: "/patrimonio/config/outra", Corpo: `{"valor":"1"}`,
			Status: http.StatusNotFound},
	})

	// caminho de inserção: a linha não existe
	if _, err := m.P.Exec(t.Context(), "delete from patrimonio_config"); err != nil {
		t.Fatal(err)
	}
	m.Rodar(t, []caso{
		{Nome: "frota não cria a linha", Quem: "frota", Metodo: "PUT", Caminho: "/patrimonio/config/numero_maximo", Corpo: `{"valor":"400"}`,
			Status: http.StatusForbidden, Efeito: cfgLinhas, Quer: "0"},
		{Nome: "viewer não cria a linha", Quem: "viewer", Metodo: "PUT", Caminho: "/patrimonio/config/numero_maximo", Corpo: `{"valor":"400"}`,
			Status: http.StatusForbidden, Efeito: cfgLinhas, Quer: "0"},
		{Nome: "impersonado não cria a linha", Quem: "impersonado", Metodo: "PUT", Caminho: "/patrimonio/config/numero_maximo", Corpo: `{"valor":"400"}`,
			Status: http.StatusForbidden, Tem: fraseImp, Efeito: cfgLinhas, Quer: "0"},
		{Nome: "patGeral cria", Quem: "patGeral", Metodo: "PUT", Caminho: "/patrimonio/config/numero_maximo", Corpo: `{"valor":"400"}`,
			Status: http.StatusOK, Tem: `"chave":"numero_maximo"`, Efeito: cfgNumero, Quer: "400"},
	})
}

func contem(corpo string, partes ...string) bool {
	for _, p := range partes {
		if !strings.Contains(corpo, p) {
			return false
		}
	}
	return true
}

func TestLog(t *testing.T) {
	m := novoMundo(t, montarConfig)
	const log = "select count(*)::text from patrimonio_log"
	novo := `{"acao":"bem.editar","alvo":"bem:` + B1 + `","resultado":"ok","detalhe":"Cadeira"}`
	m.Rodar(t, []caso{
		{Nome: "patT1 registra", Quem: "patT1", Metodo: "POST", Caminho: "/patrimonio/log", Corpo: novo,
			Status: http.StatusCreated, Tem: `"quem":"` + idPatT1 + `"`, NaoTem: `"error"`, Efeito: log, Quer: "1"},
		{Nome: "só a ação basta", Quem: "patGeral", Metodo: "POST", Caminho: "/patrimonio/log", Corpo: `{"acao":"x"}`,
			Status: http.StatusCreated, Tem: `"quem":"` + idPatGeral + `"`, Efeito: log, Quer: "2"},
		{Nome: "campos nulos do que é opcional", Quem: "patGeral", Metodo: "POST", Caminho: "/patrimonio/log",
			Corpo: `{"acao":"x","alvo":null,"resultado":null,"detalhe":null}`, Status: http.StatusCreated, Efeito: log, Quer: "3"},
		{Nome: "quem gravado é o da sessão", Efeito: "select count(*)::text from patrimonio_log where quem in ('" + idPatT1 + "','" + idPatGeral + "')", Quer: "3"},
	})
	recusas := []caso{
		{Nome: "quem no corpo", Quem: "patT1", Corpo: `{"acao":"x","quem":"` + idPatGeral + `"}`, Status: http.StatusBadRequest, Tem: "corpo_invalido"},
		{Nome: "id no corpo", Quem: "patT1", Corpo: `{"acao":"x","id":"` + B1 + `"}`, Status: http.StatusBadRequest, Tem: "corpo_invalido"},
		{Nome: "quando no corpo", Quem: "patT1", Corpo: `{"acao":"x","quando":"2020-01-01"}`, Status: http.StatusBadRequest, Tem: "corpo_invalido"},
		{Nome: "ação vazia", Quem: "patT1", Corpo: `{"acao":""}`, Status: http.StatusBadRequest},
		{Nome: "ação nula", Quem: "patT1", Corpo: `{"acao":null}`, Status: http.StatusBadRequest},
		{Nome: "sem ação", Quem: "patT1", Corpo: `{"detalhe":"y"}`, Status: http.StatusBadRequest},
		{Nome: "ação grande demais", Quem: "patT1", Corpo: `{"acao":"` + strings.Repeat("a", 101) + `"}`, Status: http.StatusBadRequest},
		{Nome: "detalhe grande demais", Quem: "patT1", Corpo: `{"acao":"x","detalhe":"` + strings.Repeat("a", 2001) + `"}`, Status: http.StatusBadRequest},
		{Nome: "alvo que não é texto", Quem: "patT1", Corpo: `{"acao":"x","alvo":5}`, Status: http.StatusBadRequest},
		{Nome: "frota", Quem: "frota", Corpo: novo, Status: http.StatusForbidden},
		{Nome: "viewer", Quem: "viewer", Corpo: novo, Status: http.StatusForbidden},
		{Nome: "acessos", Quem: "acessos", Corpo: novo, Status: http.StatusForbidden},
		{Nome: "impersonado", Quem: "impersonado", Corpo: novo, Status: http.StatusForbidden, Tem: fraseImp},
		{Nome: "sem sessão", Corpo: novo, Status: http.StatusUnauthorized},
	}
	for i := range recusas {
		recusas[i].Metodo, recusas[i].Caminho = "POST", "/patrimonio/log"
		recusas[i].Efeito, recusas[i].Quer = log, "3"
	}
	m.Rodar(t, recusas)
	// o log não tem leitura nem apagar
	for _, met := range []string{"GET", "DELETE", "PATCH"} {
		if st, _ := m.Pedir(t, "patGeral", met, "/patrimonio/log", ""); st != http.StatusNotFound && st != http.StatusMethodNotAllowed {
			t.Errorf("%s /patrimonio/log = %d, esperava 404/405", met, st)
		}
	}
}
