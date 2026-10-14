package fabrica

import (
	"context"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// O material do lote mais recente do SKU, para a pílula de garantia da arte: só o robô da Fábrica (sessão de
// serviço com a chave), uma coluna, o SKU exato (texto livre, nunca no SQL).
func TestMaterialDoSku(t *testing.T) {
	m := mundoRobo(t)
	ctx := context.Background()
	for _, sql := range []string{
		`insert into vessel_lotes (modelo, sku, quantidade, material, material_fonte, criado_em) values
		  ('Linear', 'SS0001HB.S1', 1, 'canvas', 'dono', '2026-01-01T10:00:00Z'),
		  ('Linear', 'SS0001HB.S1', 1, 'couro', 'painel', '2026-02-01T10:00:00Z'),
		  ('Linear', 'SS0001HB.S1', 1, null, null, '2026-03-01T10:00:00Z'),
		  ('Bolsa', 'A&B 1', 1, 'canvas', 'dono', '2026-01-01T10:00:00Z')`,
		// o gatilho deu ao lote de março o material herdado; tirá-lo deixa o lote mais novo SEM material
		`update vessel_lotes set material = null, material_fonte = null where criado_em = '2026-03-01T10:00:00Z'`,
	} {
		if _, err := m.P.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	const rota = "/fabrica/robo/material-do-sku"
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "o mais recente com material", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1", Status: 200, Tem: `{"material":"couro"}`},
		{Nome: "SKU com & e espaço", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=A%26B%201", Status: 200, Tem: `{"material":"canvas"}`},
		{Nome: "SKU sem lote", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=SS9999", Status: 200, Tem: `{"material":null}`},
		{Nome: "SKU que parece SQL", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=x%27%20or%20%271%27%3D%271", Status: 200, Tem: `{"material":null}`},
		{Nome: "sem sku", Quem: "robo", Metodo: "GET", Caminho: rota, Status: 400},
		{Nome: "sku vazio", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=%20", Status: 400},
		{Nome: "sku longo demais", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=" + strings.Repeat("a", 81), Status: 400},
		{Nome: "dois skus", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=a&sku=b", Status: 400},
		{Nome: "parâmetro a mais", Quem: "robo", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1&x=1", Status: 400},
		{Nome: "painel, mesmo o fabricante", Quem: "fabricante", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1", Status: 403},
		{Nome: "super pelo painel", Quem: "super", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1", Status: 403},
		{Nome: "robô sem a chave da Fábrica", Quem: "roboSemFabrica", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1", Status: 403},
		{Nome: "impersonado", Quem: "impersonado", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1", Status: 403},
		{Nome: "sem sessão", Quem: "", Metodo: "GET", Caminho: rota + "?sku=SS0001HB.S1", Status: 401},
	})
}
