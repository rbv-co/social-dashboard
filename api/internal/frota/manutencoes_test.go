package frota

import (
	"strings"
	"testing"
)

func TestManutencoesEAbastecimentos(t *testing.T) {
	m := novoMundo(t, montarManutencoes)
	const nManut, nRev, nAbast = "select count(*)::text from frota_manutencoes", "select count(*)::text from frota_revisoes", "select count(*)::text from frota_abastecimentos"
	const url, urlAb = "/frota/manutencoes", "/frota/abastecimentos"
	cab := func(extra string) string {
		return `{"veiculo_id":"` + V1 + `","km":6000,"feita_em":"2026-10-10","oficina":"JHM","total_centavos":45000,"observacao":null` + extra + `}`
	}
	const trocas = `[{"item":"Troca de óleo","custo_centavos":30000},{"item":"Filtro","custo_centavos":null}]`
	pedido := func(c, tr string) string { return `{"manutencao":` + c + `,"trocas":` + tr + `}` }

	m.Rodar(t, []caso{
		{Nome: "manutenção e as 2 trocas numa gravação", Quem: "motorista", Metodo: "POST", Caminho: url, Corpo: pedido(cab(""), trocas), Status: 201,
			Tem: `"total_centavos":45000`, Efeito: nRev, Quer: "3"},
		{Nome: "as trocas herdam o serviço e a autoria da sessão", Metodo: "", Efeito: `select count(*)::text from frota_revisoes where km = 6000 and oficina = 'JHM'
			and feita_em = '2026-10-10' and veiculo_id = '` + V1 + `' and criada_por = '` + idMotorista + `' and manutencao_id is not null`, Quer: "2"},
		{Nome: "sem trocas", Quem: "motorista", Metodo: "POST", Caminho: url, Corpo: pedido(cab(""), `[]`), Status: 400, Tem: "Marque ao menos uma troca", Efeito: nManut, Quer: "2"},
		{Nome: "km negativo no cabeçalho: nada fica", Quem: "motorista", Metodo: "POST", Caminho: url,
			Corpo: pedido(strings.Replace(cab(""), `"km":6000`, `"km":-1`, 1), trocas), Status: 400, Efeito: nManut, Quer: "2"},
		{Nome: "segunda troca inválida: o cabeçalho também não fica", Quem: "motorista", Metodo: "POST", Caminho: url,
			Corpo: pedido(cab(""), `[{"item":"Óleo","custo_centavos":1},{"item":"Filtro","custo_centavos":"caro"}]`), Status: 400, Efeito: nManut, Quer: "2"},
		{Nome: "km na troca", Quem: "motorista", Metodo: "POST", Caminho: url, Corpo: pedido(cab(""), `[{"item":"Óleo","km":1}]`), Status: 400, Tem: "corpo_invalido", Efeito: nManut, Quer: "2"},
		{Nome: "criada_por no cabeçalho", Quem: "motorista", Metodo: "POST", Caminho: url,
			Corpo: pedido(cab(`,"criada_por":"`+idAprovador+`"`), trocas), Status: 400, Tem: "corpo_invalido", Efeito: nManut, Quer: "2"},
	})
	for _, quem := range append([]string{"impersonado"}, semFrota...) {
		m.Rodar(t, []caso{
			{Nome: "manutenção: " + quem, Quem: quem, Metodo: "POST", Caminho: url, Corpo: pedido(cab(""), trocas), Status: 403, Efeito: nManut, Quer: "2"},
			{Nome: "abastecimento: " + quem, Quem: quem, Metodo: "POST", Caminho: urlAb,
				Corpo:  `{"veiculo_id":"` + V1 + `","abastecido_em":"2026-10-12T09:00:00Z","km":5300,"litros":38.25,"total_centavos":22000,"tanque_depois":4,"combustivel":"gasolina"}`,
				Status: 403, Efeito: nAbast, Quer: "1"},
		})
	}

	// revisões
	if _, corpo := m.Pedir(t, "motorista", "GET", "/frota/revisoes", ""); !strings.Contains(corpo, `"manutencao_id":"`+M1+`"`) {
		t.Errorf("revisões sem o elo com a manutenção: %s", corpo)
	}
	for _, quem := range semFrota {
		for _, rota := range []string{"/frota/revisoes", urlAb} {
			if st, corpo := m.Pedir(t, quem, "GET", rota, ""); st != 200 || corpo != "[]" {
				t.Errorf("VAZAMENTO: %s lê %s = %d %s", quem, rota, st, corpo)
			}
		}
	}
	m.Rodar(t, []caso{
		{Nome: "admin sem Frota: invisível", Quem: "admin", Metodo: "DELETE", Caminho: "/frota/revisoes/" + Rv1, Status: 404, Efeito: nRev, Quer: "3"},
		{Nome: "entrar como", Quem: "impersonado", Metodo: "DELETE", Caminho: "/frota/revisoes/" + Rv1, Status: 403, Efeito: nRev, Quer: "3"},
		{Nome: "✕ da troca", Quem: "motorista", Metodo: "DELETE", Caminho: "/frota/revisoes/" + Rv1, Status: 204, Efeito: nRev, Quer: "2"},
	})

	// abastecimentos
	bom := `{"veiculo_id":"` + V1 + `","abastecido_em":"2026-10-12T09:00:00Z","km":5300,"litros":38.25,"total_centavos":22000,"tanque_depois":4,"combustivel":"gasolina"`
	if _, corpo := m.Pedir(t, "motorista", "GET", urlAb, ""); !strings.Contains(corpo, A1) || !strings.Contains(corpo, `"litros":40.500`) {
		t.Errorf("abastecimentos = %s", corpo)
	}
	m.Rodar(t, []caso{
		{Nome: "criado_por no corpo", Quem: "motorista", Metodo: "POST", Caminho: urlAb, Corpo: bom + `,"criado_por":"` + idAprovador + `"}`, Status: 400, Efeito: nAbast, Quer: "1"},
		{Nome: "total zero", Quem: "motorista", Metodo: "POST", Caminho: urlAb, Corpo: strings.Replace(bom, `"total_centavos":22000`, `"total_centavos":0`, 1) + `}`, Status: 400, Efeito: nAbast, Quer: "1"},
		{Nome: "litros inválido", Quem: "motorista", Metodo: "POST", Caminho: urlAb, Corpo: strings.Replace(bom, `"litros":38.25`, `"litros":"muito"`, 1) + `}`, Status: 400, Efeito: nAbast, Quer: "1"},
		{Nome: "abastecer", Quem: "motorista", Metodo: "POST", Caminho: urlAb, Corpo: bom + `}`, Status: 201, Tem: `"criado_por":"` + idMotorista + `"`, Efeito: nAbast, Quer: "2"},
	})
}
