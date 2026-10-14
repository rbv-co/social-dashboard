package vendas

import (
	"net/http"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

func TestLojas(t *testing.T) {
	m := novoMundo(t, montarLojas)
	pedir := func(quem, caminho string) (int, string) { return m.Pedir(t, quem, http.MethodGet, caminho, "") }
	if st, c := pedir("viewer", "/comercial/lojas"); st != 200 || chaves(t, c, "loja_id") != "1,2,205512275,3,4" {
		t.Errorf("lojas = %d %s", st, c)
	}
	if st, c := pedir("viewer", "/comercial/lojas?limite=1"); st != 200 || chaves(t, c, "loja_id") != "3" {
		t.Errorf("primeira pelo nome = %d %s", st, c)
	}
	if st, c := pedir("viewer", "/comercial/lojas?ordem=loja_id&limite=1"); st != 200 || chaves(t, c, "loja_id") != "1" {
		t.Errorf("primeira pelo id = %d %s", st, c)
	}
	if _, c := pedir("viewer", "/comercial/lojas?ordem=loja_id&limite=3"); !contem(c, `"grupo":"Atacado"`) {
		t.Errorf("a loja 3 sem o grupo espelhado: %s", c)
	}
	const (
		loja1 = "select coalesce(grupo_id::text, '') || '/' || coalesce(grupo, '-') from bling_lojas where loja_id = 1"
		loja2 = "select coalesce(fechado_em::text, '-') from bling_lojas where loja_id = 2"
	)
	g2, inexistente := `{"grupo_id":"`+G2+`"}`, `{"grupo_id":"c5500000-0000-4000-a000-0000000000ff"}`
	m.Rodar(t, []caso{
		{Nome: "super fecha", Quem: "super", Metodo: "PATCH", Caminho: "/comercial/lojas/2", Corpo: `{"fechado_em":"2026-08-31"}`, Status: 200, Tem: `"fechado_em":"2026-08-31"`, Efeito: loja2, Quer: "2026-08-31"},
		{Nome: "super reabre", Quem: "super", Metodo: "PATCH", Caminho: "/comercial/lojas/2", Corpo: `{"fechado_em":null}`, Status: 200, Tem: `"fechado_em":null`, Efeito: loja2, Quer: "-"},
		{Nome: "papel admin não é super", Quem: "admin", Metodo: "PATCH", Caminho: "/comercial/lojas/2", Corpo: `{"fechado_em":"2026-08-31"}`, Status: 403, Efeito: loja2, Quer: "-"},
		{Nome: "vendedora", Quem: "vendT1", Metodo: "PATCH", Caminho: "/comercial/lojas/2", Corpo: `{"fechado_em":"2026-08-31"}`, Status: 403, Efeito: loja2, Quer: "-"},
		{Nome: "sem trava", Quem: "semTrava", Metodo: "PATCH", Caminho: "/comercial/lojas/2", Corpo: `{"fechado_em":"2026-08-31"}`, Status: 403, Efeito: loja2, Quer: "-"},
		{Nome: "agrupa (gatilho espelha o nome)", Quem: "super", Metodo: "PATCH", Caminho: "/comercial/lojas/1", Corpo: g2, Status: 200, Tem: `"grupo":"Varejo"`, Efeito: loja1, Quer: G2 + "/Varejo"},
		{Nome: "grupo inexistente", Quem: "super", Metodo: "PATCH", Caminho: "/comercial/lojas/1", Corpo: inexistente, Status: 409, Efeito: loja1, Quer: G2 + "/Varejo"},
		{Nome: "desagrupa", Quem: "super", Metodo: "PATCH", Caminho: "/comercial/lojas/1", Corpo: `{"grupo_id":null}`, Status: 200, Tem: `"grupo":null`, Efeito: loja1, Quer: "/-"},
		{Nome: "corpo vazio", Quem: "super", Metodo: "PATCH", Caminho: "/comercial/lojas/1", Corpo: `{}`, Status: 400},
		{Nome: "nome não se muda", Quem: "super", Metodo: "PATCH", Caminho: "/comercial/lojas/1", Corpo: `{"nome":"x"}`, Status: 400, Tem: "corpo_invalido", Efeito: "select nome from bling_lojas where loja_id = 1", Quer: "Loja Tivoli"},
		{Nome: "data inválida", Quem: "super", Metodo: "PATCH", Caminho: "/comercial/lojas/2", Corpo: `{"fechado_em":"31/08/2026"}`, Status: 400, Efeito: loja2, Quer: "-"},
		{Nome: "loja inexistente", Quem: "super", Metodo: "PATCH", Caminho: "/comercial/lojas/999", Corpo: `{"fechado_em":null}`, Status: 404},
		{Nome: "id que não é número", Quem: "super", Metodo: "PATCH", Caminho: "/comercial/lojas/abc", Corpo: `{"fechado_em":null}`, Status: 404},
		{Nome: "entrar como", Quem: "impersonado", Metodo: "PATCH", Caminho: "/comercial/lojas/2", Corpo: `{"fechado_em":"2026-08-31"}`, Status: 403, Tem: dados.FraseEntrarComo, Efeito: loja2, Quer: "-"},
	})
}
