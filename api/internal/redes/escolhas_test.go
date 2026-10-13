package redes

import (
	"strconv"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const (
	fotoMetas   = `select md5(string_agg(t::text, '|' order by t::text)) from social_metas t`
	fotoFiltros = `select md5(string_agg(t::text, '|' order by t::text)) from campaign_filters t`
	metaA1      = `select valor::text from social_metas where account_id = '` + A1 + `' and periodo = '1' and indicador = 'seguidores'`
)

func metas(itens ...string) string { return `{"metas":[` + strings.Join(itens, ",") + `]}` }

func meta(conta, periodo, indicador, valor string) string {
	return `{"account_id":"` + conta + `","periodo":"` + periodo + `","indicador":"` + indicador + `","valor":` + valor + `}`
}

func TestMetasLeitura(t *testing.T) {
	m := novoMundo(t, montarEscolhas)
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "soA1 só A1", Quem: "soA1", Metodo: "GET", Caminho: "/redes/metas", Status: 200, Tem: `"valor":100`, NaoTem: A2},
		{Nome: "soA1 pede A2", Quem: "soA1", Metodo: "GET", Caminho: "/redes/metas?account_id=" + A2, Status: 200, Tem: "[]", NaoTem: A2},
		{Nome: "nenhuma", Quem: "nenhuma", Metodo: "GET", Caminho: "/redes/metas", Status: 200, Tem: "[]"},
		{Nome: "todas A1", Quem: "todas", Metodo: "GET", Caminho: "/redes/metas", Status: 200, Tem: A1},
		{Nome: "todas A2", Quem: "todas", Metodo: "GET", Caminho: "/redes/metas", Status: 200, Tem: `"valor":200`},
	})
}

func TestMetasGravarPermitido(t *testing.T) {
	m := novoMundo(t, montarEscolhas)
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "soA1 grava duas", Quem: "soA1", Metodo: "PUT", Caminho: "/redes/metas", Status: 200,
			Corpo: metas(meta(A1, "1", "seguidores", "150"), meta(A1, "7", "seguidores.cps", "1.25")),
			Tem:   `"valor":1.25`, NaoTem: A2, Efeito: metaA1, Quer: "150"},
		{Nome: "a nova é exata", Efeito: `select valor::text from social_metas where account_id = '` + A1 + `' and periodo = '7' and indicador = 'seguidores.cps'`, Quer: "1.25"},
		{Nome: "a de A2 não mexeu", Efeito: `select valor::text from social_metas where account_id = '` + A2 + `'`, Quer: "200"},
		{Nome: "todas grava A2", Quem: "todas", Metodo: "PUT", Caminho: "/redes/metas", Status: 200,
			Corpo: metas(meta(A2, "1", "seguidores", "250")), Tem: A2,
			Efeito: `select valor::text from social_metas where account_id = '` + A2 + `'`, Quer: "250"},
		{Nome: "indicador com hífen (a tela usa profile-views)", Quem: "soA1", Metodo: "PUT", Caminho: "/redes/metas", Status: 200,
			Corpo: metas(meta(A1, "1", "profile-views", "30")), Tem: "profile-views",
			Efeito: `select valor::text from social_metas where account_id = '` + A1 + `' and periodo = '1' and indicador = 'profile-views'`, Quer: "30"},
		{Nome: "valor inteiro grande exato", Quem: "todas", Metodo: "PUT", Caminho: "/redes/metas", Status: 200,
			Corpo:  metas(meta(A2, "1", "seguidores", "12345678901234567890.5")),
			Efeito: `select valor::text from social_metas where account_id = '` + A2 + `'`, Quer: "12345678901234567890.5"},
	})
}

func TestMetasGravarNegado(t *testing.T) {
	m := novoMundo(t, montarEscolhas)
	antes := m.Um(t, fotoMetas)
	negado := func(nome, quem, corpo string, status int, tem string) mundoteste.Caso {
		return mundoteste.Caso{Nome: nome, Quem: quem, Metodo: "PUT", Caminho: "/redes/metas", Corpo: corpo, Status: status, Tem: tem,
			Efeito: fotoMetas, Quer: antes}
	}
	cinquentaEUm := make([]string, 51)
	for i := range cinquentaEUm {
		cinquentaEUm[i] = meta(A1, strconv.Itoa(i), "seguidores", "1")
	}
	m.Rodar(t, []mundoteste.Caso{
		negado("soA1 em A2 (existente)", "soA1", metas(meta(A2, "1", "seguidores", "999")), 403, "sem_permissao"),
		negado("soA1 cria o que não veria", "soA1", metas(meta(A2, "30", "seguidores", "999")), 403, "sem_permissao"),
		negado("lote misto é atômico", "soA1", metas(meta(A1, "1", "seguidores", "150"), meta(A2, "1", "seguidores", "999")), 403, "sem_permissao"),
		negado("lote misto, a recusada primeiro", "soA1", metas(meta(A2, "1", "seguidores", "999"), meta(A1, "1", "seguidores", "150")), 403, "sem_permissao"),
		negado("nenhuma em A1", "nenhuma", metas(meta(A1, "1", "seguidores", "150")), 403, "sem_permissao"),
		negado("conta que não existe", "soA1", metas(meta(A3, "1", "seguidores", "1")), 403, "sem_permissao"),
		negado("impersonado", "impersonado", metas(meta(A1, "1", "seguidores", "150")), 403, "Quem entrou como outra pessoa"),
		negado("sem sessão", "", metas(meta(A1, "1", "seguidores", "150")), 401, ""),
		negado("lista vazia", "soA1", `{"metas":[]}`, 400, "pedido_invalido"),
		negado("sem a chave", "soA1", `{}`, 400, "pedido_invalido"),
		negado("51 itens", "soA1", metas(cinquentaEUm...), 400, "pedido_invalido"),
		negado("valor texto", "soA1", metas(meta(A1, "1", "seguidores", `"150"`)), 400, "pedido_invalido"),
		negado("valor nulo", "soA1", metas(meta(A1, "1", "seguidores", "null")), 400, "pedido_invalido"),
		negado("valor enorme", "soA1", metas(meta(A1, "1", "seguidores", "1e999")), 400, "pedido_invalido"),
		negado("período com maiúscula e espaço", "soA1", metas(meta(A1, "Um Mês", "seguidores", "1")), 400, "pedido_invalido"),
		negado("período longo", "soA1", metas(meta(A1, strings.Repeat("a", 21), "seguidores", "1")), 400, "pedido_invalido"),
		negado("indicador longo", "soA1", metas(meta(A1, "1", strings.Repeat("a", 81), "1")), 400, "pedido_invalido"),
		negado("conta não uuid", "soA1", metas(meta("x", "1", "seguidores", "1")), 400, "pedido_invalido"),
		negado("chave a mais", "soA1", metas(`{"account_id":"`+A1+`","periodo":"1","indicador":"seguidores","valor":1,"id":1}`), 400, "corpo_invalido"),
		negado("item sem valor", "soA1", metas(`{"account_id":"`+A1+`","periodo":"1","indicador":"seguidores"}`), 400, "pedido_invalido"),
		negado("válido + inválido", "soA1", metas(meta(A1, "1", "seguidores", "150"), meta(A1, "Um Mês", "x", "1")), 400, "pedido_invalido"),
	})
	m.Rodar(t, []mundoteste.Caso{{Nome: "o 100 continua", Efeito: metaA1, Quer: "100"}})
	m.Rodar(t, []mundoteste.Caso{{Nome: "nada de A2 período 30", Efeito: `select count(*)::text from social_metas where periodo = '30'`, Quer: "0"}})
}

func TestFiltrosDeCampanhaLeitura(t *testing.T) {
	m := novoMundo(t, montarEscolhas)
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "soA1 só A1", Quem: "soA1", Metodo: "GET", Caminho: "/redes/filtros-de-campanha", Status: 200, Tem: `"selected_ids":["9001"]`, NaoTem: A2},
		{Nome: "soA1 pede A2", Quem: "soA1", Metodo: "GET", Caminho: "/redes/filtros-de-campanha?account_id=" + A2, Status: 200, Tem: "[]", NaoTem: A2},
		{Nome: "nenhuma", Quem: "nenhuma", Metodo: "GET", Caminho: "/redes/filtros-de-campanha", Status: 200, Tem: "[]"},
		{Nome: "todas", Quem: "todas", Metodo: "GET", Caminho: "/redes/filtros-de-campanha", Status: 200, Tem: `["9002"]`},
	})
}

func TestFiltrosDeCampanhaGravarPermitido(t *testing.T) {
	m := novoMundo(t, montarEscolhas)
	url := "/redes/filtros-de-campanha/" + A1
	lido := `select selected_ids::text from campaign_filters where account_id = '` + A1 + `'`
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "dois ids", Quem: "soA1", Metodo: "PUT", Caminho: url, Corpo: `{"selected_ids":["9001","9003"]}`, Status: 200,
			Tem: `"selected_ids":["9001","9003"]`, Efeito: lido, Quer: "{9001,9003}"},
		{Nome: "updated_at é do servidor", Efeito: `select (updated_at > '2026-10-01T00:00:00Z' and updated_at <= now() + interval '1 minute')::text from campaign_filters where account_id = '` + A1 + `'`, Quer: "true"},
		{Nome: "null = todas", Quem: "soA1", Metodo: "PUT", Caminho: url, Corpo: `{"selected_ids":null}`, Status: 200, Tem: `"selected_ids":null`,
			Efeito: lido, Quer: "<nulo>"},
		{Nome: "[] = nenhuma", Quem: "soA1", Metodo: "PUT", Caminho: url, Corpo: `{"selected_ids":[]}`, Status: 200, Tem: `"selected_ids":[]`,
			Efeito: lido, Quer: "{}"},
		{Nome: "a de A2 não mexeu", Efeito: `select selected_ids::text from campaign_filters where account_id = '` + A2 + `'`, Quer: "{9002}"},
		{Nome: "todas em A2", Quem: "todas", Metodo: "PUT", Caminho: "/redes/filtros-de-campanha/" + A2, Corpo: `{"selected_ids":["9002","9005"]}`, Status: 200,
			Efeito: `select selected_ids::text from campaign_filters where account_id = '` + A2 + `'`, Quer: "{9002,9005}"},
	})
}

func TestFiltrosDeCampanhaGravarNegado(t *testing.T) {
	m := novoMundo(t, montarEscolhas)
	antes := m.Um(t, fotoFiltros)
	ids2001 := `"1"` + strings.Repeat(`,"1"`, 2000)
	negado := func(nome, quem, caminho, corpo string, status int, tem string) mundoteste.Caso {
		return mundoteste.Caso{Nome: nome, Quem: quem, Metodo: "PUT", Caminho: caminho, Corpo: corpo, Status: status, Tem: tem,
			Efeito: fotoFiltros, Quer: antes}
	}
	ok := `{"selected_ids":["9001"]}`
	m.Rodar(t, []mundoteste.Caso{
		negado("soA1 em A2", "soA1", "/redes/filtros-de-campanha/"+A2, ok, 403, "sem_permissao"),
		negado("soA1 em A3 (não existe) igual", "soA1", "/redes/filtros-de-campanha/"+A3, ok, 403, "sem_permissao"),
		negado("nenhuma em A1", "nenhuma", "/redes/filtros-de-campanha/"+A1, ok, 403, "sem_permissao"),
		negado("impersonado", "impersonado", "/redes/filtros-de-campanha/"+A1, ok, 403, "Quem entrou como outra pessoa"),
		negado("sem sessão", "", "/redes/filtros-de-campanha/"+A1, ok, 401, ""),
		negado("sem a chave", "soA1", "/redes/filtros-de-campanha/"+A1, `{}`, 400, "pedido_invalido"),
		negado("id não numérico", "soA1", "/redes/filtros-de-campanha/"+A1, `{"selected_ids":["abc"]}`, 400, "pedido_invalido"),
		negado("id número JSON", "soA1", "/redes/filtros-de-campanha/"+A1, `{"selected_ids":[9001]}`, 400, "pedido_invalido"),
		negado("selected_ids objeto", "soA1", "/redes/filtros-de-campanha/"+A1, `{"selected_ids":{}}`, 400, "pedido_invalido"),
		negado("2001 ids", "soA1", "/redes/filtros-de-campanha/"+A1, `{"selected_ids":[`+ids2001+`]}`, 400, "pedido_invalido"),
		negado("chave a mais", "soA1", "/redes/filtros-de-campanha/"+A1, `{"selected_ids":[],"updated_at":"x"}`, 400, "corpo_invalido"),
		negado("conta que não é uuid", "soA1", "/redes/filtros-de-campanha/abc", ok, 404, "nao_encontrado"),
	})
}
