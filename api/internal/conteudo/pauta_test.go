package conteudo

import (
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

func TestIdeias(t *testing.T) {
	m := novoMundo(t, montarPauta)
	const situacao = `select situacao || '|' || coalesce(peca_id::text, 'nulo') from conteudo_ideias where id = '`
	intacto(t, m, []mundoteste.Caso{
		{Nome: "criar em conta que não vê", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"account_id":"` + A2 + `","titulo":"x"}`, Status: 403},
		{Nome: "lista vazia não cria nem na própria", Quem: "conteudistaNenhuma", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x"}`, Status: 403},
		{Nome: "criar dizendo que é da IA", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"account_id":"` + A1 + `","titulo":"x","origem":"ia"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "criar com criado_por", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"titulo":"x","criado_por":"` + idAprovador + `"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "criar sem título", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"account_id":"` + A1 + `","gancho":"x"}`, Status: 400, Tem: "Informe o titulo."},
		{Nome: "roteiro que não é lista", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"titulo":"x","roteiro":{"cena":1}}`, Status: 400, Tem: "roteiro"},
		{Nome: "editar ideia de A2 sem vê-la", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I3,
			Corpo: `{"situacao":"descartada"}`, Status: 404},
		{Nome: "mover a ideia para A2", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"account_id":"` + A2 + `"}`, Status: 403},
		{Nome: "ligar a ideia a peça de A2", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"situacao":"usada","peca_id":"` + P3 + `"}`, Status: 403},
		{Nome: "ligar a peça inexistente (igual)", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"situacao":"usada","peca_id":"a5930000-0000-4000-a000-0000000000ff"}`, Status: 403},
		{Nome: "situação fora da lista", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"situacao":"arquivada"}`, Status: 400},
		{Nome: "trocar a origem", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"origem":"manual"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "criar já usada (situacao e peca_id são de edição)", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"titulo":"x","situacao":"usada","peca_id":"` + P1 + `"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "só conteudo.aprovar não cria", Quem: "soAprovar", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"titulo":"x"}`, Status: 403},
	})
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "criar na própria conta", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo:  `{"account_id":"` + A1 + `","titulo":"Nova pauta","formato":"reels","roteiro":[{"cena":1,"narracao":"oi"}]}`,
			Status: 201, Tem: `"origem":"manual"`,
			Efeito: `select criado_por::text || '|' || situacao from conteudo_ideias where titulo = 'Nova pauta'`, Quer: idConteudistaA1 + "|nova"},
		{Nome: "criar de todas as marcas", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/ideias",
			Corpo: `{"account_id":null,"titulo":"Geral"}`, Status: 201},
		{Nome: "favoritar", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"situacao":"favorita"}`, Status: 200, Efeito: situacao + I1 + `'`, Quer: "favorita|nulo"},
		{Nome: "o plano vira peça (planoViraPecas)", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I1,
			Corpo: `{"situacao":"usada","peca_id":"` + P1 + `"}`, Status: 200, Efeito: situacao + I1 + `'`, Quer: "usada|" + P1},
		{Nome: "editar a geral", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I2,
			Corpo: `{"gancho":"Comece pelo couro","cta":null}`, Status: 200},
		{Nome: "descartar a de A2 quem vê todas", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/ideias/" + I3,
			Corpo: `{"situacao":"descartada"}`, Status: 200, Efeito: situacao + I3 + `'`, Quer: "descartada|nulo"},
	})
}

func TestBlocosEConcorrentes(t *testing.T) {
	m := novoMundo(t, montarPauta)
	intacto(t, m, []mundoteste.Caso{
		{Nome: "bloco em conta que não vê", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/blocos",
			Corpo: `{"account_id":"` + A2 + `","tipo":"legenda","nome":"x","texto":"y"}`, Status: 403},
		{Nome: "bloco sem apelido (a tela manda null: o banco recusava)", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/blocos",
			Corpo: `{"account_id":"` + A1 + `","tipo":"legenda","nome":null,"texto":"y"}`, Status: 400, Tem: "apelido"},
		{Nome: "bloco de tipo fora da lista", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/blocos",
			Corpo: `{"account_id":"` + A1 + `","tipo":"emoji","nome":"x","texto":"y"}`, Status: 400},
		{Nome: "bloco com criado_por (salvarBloco o mandava)", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/blocos",
			Corpo: `{"account_id":"` + A1 + `","tipo":"legenda","nome":"x","texto":"y","criado_por":"` + idConteudista + `"}`, Status: 400},
		{Nome: "desativar bloco de A2 sem vê-lo", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/blocos/" + B3,
			Corpo: `{"ativo":false}`, Status: 404},
		{Nome: "ativo em texto", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/blocos/" + B1,
			Corpo: `{"ativo":"false"}`, Status: 400},
		{Nome: "editar o texto do bloco (só ativo)", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/blocos/" + B1,
			Corpo: `{"texto":"x"}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "concorrente repetido na marca", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/concorrentes",
			Corpo: `{"account_id":"` + A1 + `","handle":"lojaum"}`, Status: 409},
		{Nome: "concorrente sem conta", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo/concorrentes",
			Corpo: `{"handle":"x"}`, Status: 400},
		{Nome: "concorrente: só ativo no PATCH", Quem: "conteudista", Metodo: "PATCH", Caminho: "/conteudo/concorrentes/" + K1,
			Corpo: `{"handle":"y"}`, Status: 400},
		{Nome: "concorrente sem o módulo", Quem: "semModulo", Metodo: "POST", Caminho: "/conteudo/concorrentes",
			Corpo: `{"account_id":"` + A1 + `","handle":"z"}`, Status: 403},
		{Nome: "concorrente com só conteudo.aprovar", Quem: "soAprovar", Metodo: "PATCH", Caminho: "/conteudo/concorrentes/" + K1,
			Corpo: `{"ativo":false}`, Status: 404},
	})
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "bloco na própria conta", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/blocos",
			Corpo: `{"account_id":"` + A1 + `","tipo":"cta","nome":"Chame","texto":"Chame no direct"}`, Status: 201,
			Tem: `"criado_por":"` + idConteudistaA1 + `"`},
		{Nome: "desativar bloco", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/blocos/" + B1, Corpo: `{"ativo":false}`, Status: 200,
			Efeito: `select ativo::text from conteudo_blocos where id = '` + B1 + `'`, Quer: "false"},
		// paridade (Ruling 5.9-5): concorrentes não têm a restritiva — quem só vê A1 grava e desativa os de A2, como hoje
		{Nome: "concorrente em A2 por quem só vê A1", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo/concorrentes",
			Corpo: `{"account_id":"` + A2 + `","handle":"lojatres","nome":null,"observacao":"vende bolsa"}`, Status: 201},
		{Nome: "desativar concorrente de A2 por quem só vê A1", Quem: "conteudistaA1", Metodo: "PATCH", Caminho: "/conteudo/concorrentes/" + K2,
			Corpo: `{"ativo":false}`, Status: 200, Efeito: `select ativo::text from conteudo_concorrentes where id = '` + K2 + `'`, Quer: "false"},
	})
}
