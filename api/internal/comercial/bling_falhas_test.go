package comercial

import (
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// Plano 04 (A, B): o Bling respondeu 200, mas com um corpo que não é uma lista de pedidos. Para quem está
// limitada a uma loja, isso NUNCA pode virar "não vendeu nada" (200 com lista vazia): "deu ruim" ≠ "vazio".
func TestBlingListaLimitadaComCorpoInesperadoEhErroNaoLista(t *testing.T) {
	inesperados := map[string]string{
		"JSON truncado": `{"data":[{"id":1,"loja":{"id":205657609}`,
		"não é JSON":    `<html>Bad Gateway</html>`,
		"corpo vazio":   ``,
		"data ausente":  `{"mensagem":"ok"}`,
		"data é texto":  `{"data":"nenhum"}`,
		"raiz é lista":  `[{"id":1}]`,
		"null":          `null`,
	}
	for nome, corpo := range inesperados {
		t.Run(nome, func(t *testing.T) {
			a := montar(t, ok200(corpo))
			w := a.post(a.tokens[uLimitada], `{"endpoint":"pedidos/vendas","params":{"pagina":1}}`)
			if w.Code < 500 {
				t.Fatalf("resposta inesperada do Bling virou %d %s: a vendedora veria lista vazia no lugar do erro", w.Code, strings.TrimSpace(w.Body.String()))
			}
		})
	}
}

// O contraponto: a lista vazia de verdade (`{"data":[]}`) continua 200 vazia.
func TestBlingListaLimitadaVaziaDeVerdadeContinuaVazia(t *testing.T) {
	a := montar(t, func(core.PedidoBling, int) (int, string, map[string]string) {
		return 200, `{"data":[]}`, map[string]string{"X-Core-Origem": "bling"}
	})
	w := a.post(a.tokens[uLimitada], `{"endpoint":"pedidos/vendas","params":{"pagina":1}}`)
	if w.Code != 200 || strings.TrimSpace(w.Body.String()) != `{"data":[]}` {
		t.Fatalf("lista vazia legítima: %d %s", w.Code, w.Body)
	}
}
