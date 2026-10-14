package vessel

import (
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// As 6 leituras pela cadeia real (auth.Exigir → autz.ComEscopo): quem é do selo vê; quem não é recebe [] e conta 0
// (papel admin, a chave só em permissions e o leitor); conta desativada e sem sessão = 401; parâmetro fora da lista = 400.
func TestLeiturasDoSelo(t *testing.T) {
	m := novoMundo(t, montarLeituras)
	marcas := map[string]string{ // rota → um pedaço que só aparece com as linhas legíveis
		"/autenticidade/lotes":          `"material_fonte":"dono"`,
		"/autenticidade/pecas":          `"VBTTTT0002"`,
		"/autenticidade/registros":      `"Ana Cliente"`,
		"/autenticidade/baixas":         `"VBTTTT0002"`,
		"/autenticidade/cartao-pedidos": `"pronto"`,
		"/autenticidade/lembretes":      `"duda@x.com"`,
	}
	if len(marcas) != len(leituras) {
		t.Fatalf("leitura sem caso aqui: %d rotas, %d casos", len(leituras), len(marcas))
	}
	for rota, marca := range marcas {
		for _, quem := range []string{"selo", "super", "impersonado"} {
			if st, b := m.Pedir(t, quem, "GET", rota, ""); st != 200 || !strings.Contains(b, marca) {
				t.Errorf("%s GET %s = %d %s", quem, rota, st, b)
			}
		}
		for _, quem := range []string{"admin", "leitor", "chave"} {
			w := m.Resposta(t, quem, "GET", rota+"?contar=1", "")
			if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" || w.Header().Get("X-Total-Count") != "0" {
				t.Errorf("%s GET %s = %d %s (X-Total-Count %q)", quem, rota, w.Code, w.Body, w.Header().Get("X-Total-Count"))
			}
		}
		for _, quem := range []string{"desativado", ""} {
			if st, _ := m.Pedir(t, quem, "GET", rota, ""); st != 401 {
				t.Errorf("%q GET %s = %d, esperava 401", quem, rota, st)
			}
		}
		if st, _ := m.Pedir(t, "selo", "GET", rota+"?inventado=1", ""); st != 400 {
			t.Errorf("GET %s?inventado=1 = %d, esperava 400", rota, st)
		}
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "peças por código", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/pecas?codigo=VBAAAA0001,VBAAAA0003", Status: 200, Tem: P3, NaoTem: P2},
		{Nome: "peças por código, quem não é do selo", Quem: "admin", Metodo: "GET", Caminho: "/autenticidade/pecas?codigo=VBAAAA0001", Status: 200, NaoTem: P1},
		{Nome: "registros sem o CPF", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/registros", Status: 200, NaoTem: cpfDaDona},
		{Nome: "registros sem a coluna cpf", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/registros", Status: 200, NaoTem: `"cpf"`},
		{Nome: "registros sem o nascimento", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/registros", Status: 200, NaoTem: "1990-05-01"},
		{Nome: "registros com o pedido do Bling (a tela mostra)", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/registros", Status: 200, Tem: `"bling_pedido":"777"`},
		{Nome: "só a baixa ativa", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/baixas", Status: 200, Tem: T2, NaoTem: T1},
		{Nome: "lembretes sem o hash do link", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/lembretes", Status: 200, NaoTem: "HASH-SECRETO"},
		{Nome: "a fila com limite, a mais nova primeiro", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/cartao-pedidos?limite=1", Status: 200, Tem: `"falhou"`, NaoTem: `"pronto"`},
		{Nome: "lotes com todas as colunas", Quem: "selo", Metodo: "GET", Caminho: "/autenticidade/lotes", Status: 200, Tem: `"os":"OS-7"`},
	})
}
