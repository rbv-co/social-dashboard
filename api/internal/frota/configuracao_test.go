package frota

import (
	"strings"
	"testing"
)

func TestConfiguracaoDaFrota(t *testing.T) {
	m := novoMundo(t, montarConfiguracao)
	const itens, config, plano = "/frota/checklist-itens", "/frota/checklist-config", "/frota/plano-revisao"
	const nItens, nPlano = "select count(*)::text from frota_checklist_itens", "select count(*)::text from frota_plano_revisao"
	col := func(tabela, coluna, id string) string {
		return "select " + coluna + "::text from " + tabela + " where id = '" + id + "'"
	}

	if _, corpo := m.Pedir(t, "motorista", "GET", itens, ""); strings.Index(corpo, "Pneus") < 0 || strings.Index(corpo, "Faróis") < strings.Index(corpo, "Pneus") {
		t.Errorf("itens = %s, esperava Pneus antes de Faróis", corpo)
	}
	m.Rodar(t, []caso{
		{Nome: "item novo", Quem: "motorista", Metodo: "POST", Caminho: itens, Corpo: `{"item":"Buzina","cadencia":"semanal","ordem":30}`, Status: 201, Efeito: nItens, Quer: "3"},
		{Nome: "nome repetido", Quem: "motorista", Metodo: "POST", Caminho: itens, Corpo: `{"item":"Pneus","cadencia":"diario","ordem":31}`, Status: 409, Efeito: nItens, Quer: "3"},
		{Nome: "cadência inválida", Quem: "motorista", Metodo: "POST", Caminho: itens, Corpo: `{"item":"Vidros","cadencia":"anual","ordem":32}`, Status: 400, Efeito: nItens, Quer: "3"},
		{Nome: "impede uso", Quem: "motorista", Metodo: "PATCH", Caminho: itens + "/" + I1, Corpo: `{"impede_uso":true}`, Status: 200, Efeito: col("frota_checklist_itens", "impede_uso", I1), Quer: "true"},
		{Nome: "desligar item", Quem: "motorista", Metodo: "PATCH", Caminho: itens + "/" + I1, Corpo: `{"ativo":false}`, Status: 200, Efeito: col("frota_checklist_itens", "ativo", I1), Quer: "false"},
		{Nome: "item não se renomeia", Quem: "motorista", Metodo: "PATCH", Caminho: itens + "/" + I1, Corpo: `{"item":"x"}`, Status: 400, Tem: "corpo_invalido"},

		{Nome: "dias: linha única", Quem: "motorista", Metodo: "GET", Caminho: config, Status: 200, Tem: `"id":true`},
		{Nome: "dias: gravar", Quem: "motorista", Metodo: "PATCH", Caminho: config, Corpo: `{"dia_semanal":3,"semana_mensal":2,"dia_mensal":4}`, Status: 200,
			Efeito: `select dia_semanal || '/' || semana_mensal || '/' || dia_mensal from frota_checklist_config`, Quer: "3/2/4"},
		{Nome: "dias: fora da faixa", Quem: "motorista", Metodo: "PATCH", Caminho: config, Corpo: `{"dia_semanal":6}`, Status: 400,
			Efeito: `select dia_semanal::text from frota_checklist_config`, Quer: "3"},

		{Nome: "plano: P1", Quem: "motorista", Metodo: "GET", Caminho: plano, Status: 200, Tem: P1},
		{Nome: "plano: novo", Quem: "motorista", Metodo: "POST", Caminho: plano, Corpo: `{"item":"Pneus","a_cada_km":40000,"observacao":null,"ordem":2}`, Status: 201, Efeito: nPlano, Quer: "2"},
		{Nome: "plano: nome repetido", Quem: "motorista", Metodo: "POST", Caminho: plano, Corpo: `{"item":"Troca de óleo","a_cada_km":5000,"ordem":3}`, Status: 409, Efeito: nPlano, Quer: "2"},
		{Nome: "plano: km zero", Quem: "motorista", Metodo: "POST", Caminho: plano, Corpo: `{"item":"Correia","a_cada_km":0,"ordem":4}`, Status: 400, Efeito: nPlano, Quer: "2"},
		{Nome: "plano: desligar", Quem: "motorista", Metodo: "PATCH", Caminho: plano + "/" + P1, Corpo: `{"ativo":false}`, Status: 200, Efeito: col("frota_plano_revisao", "ativo", P1), Quer: "false"},
	})

	// vazamento e IDOR: quem não tem a Frota não lê, não cria, não enxerga a linha para editar
	foto := m.Um(t, fotoDaFrota)
	for _, quem := range semFrota {
		for _, rota := range []string{itens, config, plano} {
			if st, corpo := m.Pedir(t, quem, "GET", rota, ""); st != 200 || corpo != "[]" {
				t.Errorf("VAZAMENTO: %s lê %s = %d %s", quem, rota, st, corpo)
			}
		}
		m.Rodar(t, []caso{
			{Nome: "item: " + quem, Quem: quem, Metodo: "POST", Caminho: itens, Corpo: `{"item":"Fantasma","cadencia":"diario","ordem":99}`, Status: 403, Efeito: fotoDaFrota, Quer: foto},
			{Nome: "plano: " + quem, Quem: quem, Metodo: "POST", Caminho: plano, Corpo: `{"item":"Fantasma","a_cada_km":1000,"ordem":99}`, Status: 403, Efeito: fotoDaFrota, Quer: foto},
			{Nome: "PATCH item: " + quem, Quem: quem, Metodo: "PATCH", Caminho: itens + "/" + I2, Corpo: `{"ativo":false}`, Status: 404, Efeito: fotoDaFrota, Quer: foto},
			{Nome: "PATCH plano: " + quem, Quem: quem, Metodo: "PATCH", Caminho: plano + "/" + P1, Corpo: `{"ativo":true}`, Status: 404, Efeito: fotoDaFrota, Quer: foto},
			{Nome: "PATCH dias: " + quem, Quem: quem, Metodo: "PATCH", Caminho: config, Corpo: `{"dia_semanal":1}`, Status: 404, Efeito: fotoDaFrota, Quer: foto},
		})
	}
	for _, c := range []caso{
		{Nome: "entrar como: item", Metodo: "POST", Caminho: itens, Corpo: `{"item":"Fantasma","cadencia":"diario","ordem":99}`},
		{Nome: "entrar como: PATCH item", Metodo: "PATCH", Caminho: itens + "/" + I2, Corpo: `{"ativo":false}`},
		{Nome: "entrar como: dias", Metodo: "PATCH", Caminho: config, Corpo: `{"dia_semanal":1}`},
		{Nome: "entrar como: plano", Metodo: "POST", Caminho: plano, Corpo: `{"item":"Fantasma","a_cada_km":1000,"ordem":99}`},
		{Nome: "entrar como: PATCH plano", Metodo: "PATCH", Caminho: plano + "/" + P1, Corpo: `{"ativo":true}`},
	} {
		c.Quem, c.Status = "impersonado", 403
		c.Efeito, c.Quer = fotoDaFrota, m.Um(t, fotoDaFrota)
		m.Rodar(t, []caso{c})
	}
}
