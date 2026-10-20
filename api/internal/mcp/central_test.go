package mcp_test

import (
	"strings"
	"testing"
)

// As ferramentas genéricas (catalogo, consultar, criar, editar, apagar, executar_rpc) pela montagem real: o mapa vem
// das declarações das rotas e a permissão é a do autz de cada rota, como na tela.
func TestCentral(t *testing.T) {
	m := novoMundo(t)
	_, gestor, _ := m.acesso(t)
	_, super, _ := m.acessoDe(t, "super")

	deve := func(nome, args, contem string, querErro bool, tok string) string {
		t.Helper()
		txt, erro := m.ferramenta(t, tok, nome, args)
		if erro != querErro || !strings.Contains(txt, contem) {
			t.Fatalf("%s %s: erro=%v (queria %v), sem %q em %s", nome, args, erro, querErro, contem, txt)
		}
		return txt
	}

	// o mapa: áreas, o que cada tabela aceita, as funções
	deve("catalogo", `{}`, `"frota_veiculos"`, false, gestor)
	deve("catalogo", `{"area":"frota"}`, `"frota_requisicoes":{"consultar":{"filtros":{"situacao":"texto","veiculo_id":"uuid"}`, false, gestor)
	deve("catalogo", `{"area":"rpc"}`, `"pessoas_para_escolher"`, false, gestor)
	deve("catalogo", `{"area":"nada"}`, "area deve ser", true, gestor)

	// consultar: só filtro e ordem declarados; limite no teto
	deve("consultar", `{"tabela":"frota_requisicoes","filtros":{"situacao":"pendente"},"ordem":"retirada_prevista","desc":true}`, reqR1, false, gestor)
	deve("consultar", `{"tabela":"frota_requisicoes","filtros":{"criada_por":"x"}}`, "Aceita: situacao, veiculo_id", true, gestor)
	deve("consultar", `{"tabela":"frota_requisicoes","ordem":"id"}`, "ordem que", true, gestor)
	deve("consultar", `{"tabela":"frota_requisicoes","limite":500}`, "limite", true, gestor)
	deve("consultar", `{"tabela":"pg_shadow"}`, "fora do catálogo", true, gestor)

	// criar e editar: só os campos da rota; o autor vem da sessão, não do modelo
	deve("criar", `{"tabela":"frota_plano_revisao","campos":{"item":"Correia","a_cada_km":50000,"id":"x"}}`, "Pode:", true, gestor)
	txt := deve("criar", `{"tabela":"frota_plano_revisao","campos":{"item":"Correia","a_cada_km":50000}}`, `"item":"Correia"`, false, gestor)
	id := txt[strings.Index(txt, `"id":"`)+6:][:36]
	deve("editar", `{"tabela":"frota_plano_revisao","campos":{"ativo":false}}`, "falta o id", true, gestor)
	deve("editar", `{"tabela":"frota_plano_revisao","id":"`+id+`","campos":{"ativo":false}}`, `"ativo":false`, false, gestor)
	if v := m.q(t, `select item || '/' || a_cada_km || '/' || ativo from frota_plano_revisao`); v != "Correia/50000/false" {
		t.Fatalf("plano: %s", v)
	}
	deve("apagar", `{"tabela":"frota_plano_revisao","id":"`+id+`"}`, "não aceita apagar", true, gestor)

	// a permissão é a da tela: o gestor da Frota não mexe em grupos de canais; o super mexe e apaga
	deve("criar", `{"tabela":"canais_grupos","campos":{"nome":"Teste"}}`, "Não deu certo (HTTP 403)", true, gestor)
	txt = deve("criar", `{"tabela":"canais_grupos","campos":{"nome":"Teste"}}`, `"nome":"Teste"`, false, super)
	id = txt[strings.Index(txt, `"id":"`)+6:][:36]
	deve("apagar", `{"tabela":"canais_grupos","id":"`+id+`"}`, "Não deu certo (HTTP 403)", true, gestor)
	deve("apagar", `{"tabela":"canais_grupos","id":"`+id+`"}`, `"ok":true`, false, super)
	if n := m.q(t, `select count(*)::text from canais_grupos`); n != "0" {
		t.Fatalf("não apagou: %s", n)
	}

	// RPC: só da lista e só com os parâmetros dela; o portão é o da função
	deve("executar_rpc", `{"nome":"pessoas_para_escolher"}`, "[", false, gestor)
	deve("executar_rpc", `{"nome":"pessoas_para_escolher","args":{"p_x":1}}`, "não tem: p_x", true, gestor)
	deve("executar_rpc", `{"nome":"pg_sleep"}`, "fora da lista", true, gestor)

	// tools/list marca o que altera o que já existe (o ChatGPT pede confirmação)
	_, v := m.rpc(t, gestor, "tools/list", `{}`)
	for _, f := range v["result"].(map[string]any)["tools"].([]any) {
		f := f.(map[string]any)
		destrutiva := f["annotations"].(map[string]any)["destructiveHint"].(bool)
		if quer := f["name"] == "apagar" || f["name"] == "editar" || f["name"] == "executar_rpc"; quer && !destrutiva {
			t.Fatalf("%s deveria ser destrutiva", f["name"])
		}
	}
}
