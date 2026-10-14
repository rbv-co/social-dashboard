// Package vendas: as rotas do sub-plano 5.5 — o Comercial (Bling e Shopify): lojas e o grupo do canal,
// depósitos, metas de loja e de vendedora, os dois caches que as telas de venda preenchem (vendedor do
// pedido e nome da vendedora), notas, ajustes de valor e de vendedor, formas de pagamento, estoque e
// vendas por item, o briefing da Gestão Comercial e os pedidos da Shopify. Toda regra é a do catálogo de
// produção (autz.Producao: pode_ver_canal e pode_ver_estoque entram sozinhos pela regra de Ler); toda
// escrita roda em banco.ComUsuario; sessão de "entrar como" só lê (Ruling 5.5-8). O proxy do Bling e o
// push de vendas (internal/comercial, Planos 3 e 4) não mudam (Rulings 14 e 24 do mestre).
package vendas

import (
	"encoding/json"
	"fmt"
	"unicode/utf8"

	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// soSessaoPropria vai em TODA escrita do 5.5 (TestEscritasRecusamImpersonado confere).
var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// deve: declaração de rota errada faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

// textoOuNulo: ausente ou null passa; senão, string de até max caracteres.
func textoOuNulo(campo string, v json.RawMessage, max int) error {
	if v == nil || string(v) == "null" {
		return nil
	}
	var s string
	if json.Unmarshal(v, &s) != nil || utf8.RuneCountInString(s) > max {
		return fmt.Errorf("Confira %s: texto de até %d caracteres.", campo, max)
	}
	return nil
}
