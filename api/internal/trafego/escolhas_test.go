package trafego

import (
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const (
	fraseEntrarComo = "Quem entrou como outra pessoa só consulta."
	fotoConfig      = `select md5(string_agg(t::text, '|' order by t::text)) from gt_config_metricas t`
	fotoObjetivos   = `select md5(string_agg(t::text, '|' order by t::text)) from gt_objetivo_interacao t`
)

func TestConfigMetricas(t *testing.T) {
	m := novoMundo(t, montarEscolhas)
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "sem módulo lê", Quem: "semModulo", Metodo: "GET", Caminho: "/gestao-trafego/config-metricas", Status: 200, Tem: `"balde":"engajamento"`},
		{Nome: "leitor lê", Quem: "leitor", Metodo: "GET", Caminho: "/gestao-trafego/config-metricas", Status: 200, Tem: "custo_visita"},
		{Nome: "gestorA1 lê", Quem: "gestorA1", Metodo: "GET", Caminho: "/gestao-trafego/config-metricas", Status: 200, Tem: "updated_at"},
		{Nome: "desativado", Quem: "desativado", Metodo: "GET", Caminho: "/gestao-trafego/config-metricas", Status: 401},
		{Nome: "sem sessão", Quem: "", Metodo: "GET", Caminho: "/gestao-trafego/config-metricas", Status: 401},
	})

	const efeito = `select metricas::text from gt_config_metricas where balde = 'engajamento'`
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "gestorA1 grava", Quem: "gestorA1", Metodo: "PUT", Caminho: "/gestao-trafego/config-metricas/engajamento",
			Corpo: `{"metricas":["cpm"]}`, Status: 200, Tem: `"metricas":["cpm"]`, Efeito: efeito, Quer: `["cpm"]`},
		{Nome: "updated_at é do servidor", Efeito: `select (updated_at > '2026-10-01')::text from gt_config_metricas where balde = 'engajamento'`, Quer: "true"},
		{Nome: "balde novo com lista vazia", Quem: "gestorA1", Metodo: "PUT", Caminho: "/gestao-trafego/config-metricas/vendas",
			Corpo: `{"metricas":[]}`, Status: 200, Tem: `"balde":"vendas"`,
			Efeito: `select metricas::text from gt_config_metricas where balde = 'vendas'`, Quer: `[]`},
		{Nome: "admin também é gestor", Quem: "adminA1", Metodo: "PUT", Caminho: "/gestao-trafego/config-metricas/vendas",
			Corpo: `{"metricas":["cpm","ctr"]}`, Status: 200,
			Efeito: `select metricas::text from gt_config_metricas where balde = 'vendas'`, Quer: `["cpm", "ctr"]`},
	})

	antes := m.Um(t, fotoConfig)
	negado := func(nome, quem, caminho, corpo string, status int, tem string) mundoteste.Caso {
		return mundoteste.Caso{Nome: nome, Quem: quem, Metodo: "PUT", Caminho: caminho, Corpo: corpo, Status: status, Tem: tem,
			Efeito: fotoConfig, Quer: antes}
	}
	const eng = "/gestao-trafego/config-metricas/engajamento"
	trintaEUma := `{"metricas":["` + strings.Repeat(`a","`, 30) + `a"]}`
	m.Rodar(t, []mundoteste.Caso{
		negado("leitor", "leitor", eng, `{"metricas":["cpm"]}`, 403, "sem_permissao"),
		negado("super pela ficha não é gestor", "superA1", eng, `{"metricas":["cpm"]}`, 403, "sem_permissao"),
		negado("sem módulo", "semModulo", eng, `{"metricas":["cpm"]}`, 403, "sem_permissao"),
		negado("impersonado", "impersonado", eng, `{"metricas":["cpm"]}`, 403, fraseEntrarComo),
		negado("sem sessão", "", eng, `{"metricas":["cpm"]}`, 401, ""),
		negado("texto no lugar da lista", "gestorA1", eng, `{"metricas":"cpm"}`, 400, "pedido_invalido"),
		negado("número na lista", "gestorA1", eng, `{"metricas":[1]}`, 400, "pedido_invalido"),
		negado("null", "gestorA1", eng, `{"metricas":null}`, 400, "pedido_invalido"),
		negado("ausente", "gestorA1", eng, `{}`, 400, "pedido_invalido"),
		negado("31 chaves", "gestorA1", eng, trintaEUma, 400, "pedido_invalido"),
		negado("maiúscula", "gestorA1", eng, `{"metricas":["CPM"]}`, 400, "pedido_invalido"),
		negado("chave de 41 caracteres", "gestorA1", eng, `{"metricas":["`+strings.Repeat("a", 41)+`"]}`, 400, "pedido_invalido"),
		negado("campo a mais", "gestorA1", eng, `{"metricas":[],"updated_at":"x"}`, 400, "corpo_invalido"),
		negado("balde inválido", "gestorA1", "/gestao-trafego/config-metricas/Vendas!", `{"metricas":[]}`, 404, ""),
	})
}

func TestObjetivos(t *testing.T) {
	m := novoMundo(t, montarEscolhas)
	for _, quem := range []string{"semModulo", "leitor", "gestorA1"} {
		m.Rodar(t, []mundoteste.Caso{
			{Nome: quem + " lê os dois", Quem: quem, Metodo: "GET", Caminho: "/gestao-trafego/objetivos", Status: 200, Tem: `"alvo_id":"9001"`},
			{Nome: quem + " lê o de A2 (tabela sem restritiva)", Quem: quem, Metodo: "GET", Caminho: "/gestao-trafego/objetivos", Status: 200, Tem: `"alvo_id":"9002"`},
		})
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "filtro conta e nível", Quem: "leitor", Metodo: "GET", Caminho: "/gestao-trafego/objetivos?conta_id=" + A1 + "&nivel=campanha",
			Status: 200, Tem: `"alvo_id":"9001"`, NaoTem: "9002"},
		{Nome: "filtro alvo", Quem: "leitor", Metodo: "GET", Caminho: "/gestao-trafego/objetivos?alvo_id=9002", Status: 200, Tem: "9002", NaoTem: "9001"},
		{Nome: "conta inválida", Quem: "leitor", Metodo: "GET", Caminho: "/gestao-trafego/objetivos?conta_id=x", Status: 400},
		{Nome: "desativado", Quem: "desativado", Metodo: "GET", Caminho: "/gestao-trafego/objetivos", Status: 401},
	})

	const base = "/gestao-trafego/objetivos/"
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "gestorA1 cria 9003", Quem: "gestorA1", Metodo: "PUT", Caminho: base + "9003",
			Corpo: `{"nivel":"anuncio","interacao":"comentarios","conta_id":"` + A1 + `"}`, Status: 200, Tem: `"interacao":"comentarios"`,
			Efeito: `select updated_by::text from gt_objetivo_interacao where alvo_id = '9003'`, Quer: idGestorA1},
		{Nome: "gestorA1 troca 9001, conta nula", Quem: "gestorA1", Metodo: "PUT", Caminho: base + "9001",
			Corpo: `{"nivel":"campanha","interacao":"salvamentos","conta_id":null}`, Status: 200, Tem: `"conta_id":null`,
			Efeito: `select interacao || '|' || coalesce(conta_id::text, 'nulo') from gt_objetivo_interacao where alvo_id = '9001'`, Quer: "salvamentos|nulo"},
		{Nome: "updated_at do servidor", Efeito: `select (updated_at > '2026-10-02')::text from gt_objetivo_interacao where alvo_id = '9001'`, Quer: "true"},
		{Nome: "gestorA1 apaga 9001", Quem: "gestorA1", Metodo: "DELETE", Caminho: base + "9001", Status: 204,
			Efeito: `select count(*)::text from gt_objetivo_interacao where alvo_id = '9001'`, Quer: "0"},
		{Nome: "apagar o que não existe", Quem: "gestorA1", Metodo: "DELETE", Caminho: base + "9999", Status: 204,
			Efeito: `select count(*)::text from gt_objetivo_interacao`, Quer: "2"},
	})

	antes := m.Um(t, fotoObjetivos)
	corpoOk := `{"nivel":"campanha","interacao":"curtidas","conta_id":null}`
	negado := func(nome, quem, metodo, caminho, corpo string, status int, tem string) mundoteste.Caso {
		return mundoteste.Caso{Nome: nome, Quem: quem, Metodo: metodo, Caminho: caminho, Corpo: corpo, Status: status, Tem: tem,
			Efeito: fotoObjetivos, Quer: antes}
	}
	m.Rodar(t, []mundoteste.Caso{
		negado("leitor grava", "leitor", "PUT", base+"9002", corpoOk, 403, "sem_permissao"),
		negado("leitor apaga", "leitor", "DELETE", base+"9002", "", 403, "sem_permissao"),
		negado("super pela ficha grava", "superA1", "PUT", base+"9002", corpoOk, 403, "sem_permissao"),
		negado("super pela ficha apaga", "superA1", "DELETE", base+"9002", "", 403, "sem_permissao"),
		negado("sem módulo apaga o que não existe", "semModulo", "DELETE", base+"9999", "", 403, "sem_permissao"),
		negado("impersonado grava", "impersonado", "PUT", base+"9002", corpoOk, 403, fraseEntrarComo),
		negado("impersonado apaga", "impersonado", "DELETE", base+"9002", "", 403, fraseEntrarComo),
		negado("sem sessão apaga", "", "DELETE", base+"9002", "", 401, ""),
		negado("interação inválida", "gestorA1", "PUT", base+"9002", `{"nivel":"campanha","interacao":"likes","conta_id":null}`, 400, "pedido_invalido"),
		negado("nível inválido", "gestorA1", "PUT", base+"9002", `{"nivel":"conta","interacao":"curtidas","conta_id":null}`, 400, "pedido_invalido"),
		negado("sem conta_id", "gestorA1", "PUT", base+"9002", `{"nivel":"campanha","interacao":"curtidas"}`, 400, "pedido_invalido"),
		negado("conta_id que não é uuid", "gestorA1", "PUT", base+"9002", `{"nivel":"campanha","interacao":"curtidas","conta_id":"x"}`, 400, "pedido_invalido"),
		negado("campo a mais", "gestorA1", "PUT", base+"9002", `{"nivel":"campanha","interacao":"curtidas","conta_id":null,"updated_by":"x"}`, 400, "corpo_invalido"),
		negado("alvo com letra, PUT", "gestorA1", "PUT", base+"abc", corpoOk, 404, ""),
		negado("alvo com letra, DELETE", "gestorA1", "DELETE", base+"abc", "", 404, ""),
	})
}
