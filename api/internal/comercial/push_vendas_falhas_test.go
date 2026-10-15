package comercial

import (
	"context"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// Plano 04 (A): o Bling falha de cada jeito na lista de pedidos do dia. Nenhum jeito pode virar push
// "R$ 0 em vendas" (dado errado a quem confia no aviso): sem lista de verdade, a tarefa falha e nada sai.
func TestPushVendasFalhaDoBlingNuncaViraPushDeZero(t *testing.T) {
	casos := map[string]func(core.PedidoBling, int) (int, string, map[string]string){
		"429 sempre": func(core.PedidoBling, int) (int, string, map[string]string) {
			return 429, `{}`, map[string]string{"Retry-After": "1"}
		},
		"5xx sempre":      func(core.PedidoBling, int) (int, string, map[string]string) { return 502, `bad gateway`, nil },
		"4xx definitivo":  func(core.PedidoBling, int) (int, string, map[string]string) { return 401, `{"error":"token"}`, nil },
		"sem resposta":    func(core.PedidoBling, int) (int, string, map[string]string) { return 0, ``, nil },
		"JSON truncado":   func(core.PedidoBling, int) (int, string, map[string]string) { return 200, `{"data":[{"id":1,"tot`, nil },
		"HTML de gateway": func(core.PedidoBling, int) (int, string, map[string]string) { return 200, `<html>ok</html>`, nil },
		"data ausente":    func(core.PedidoBling, int) (int, string, map[string]string) { return 200, `{"mensagem":"ok"}`, nil },
		"data é texto":    func(core.PedidoBling, int) (int, string, map[string]string) { return 200, `{"data":"nenhum"}`, nil },
		"raiz é lista":    func(core.PedidoBling, int) (int, string, map[string]string) { return 200, `[]`, nil },
		"null":            func(core.PedidoBling, int) (int, string, map[string]string) { return 200, `null`, nil },
		"corpo vazio":     func(core.PedidoBling, int) (int, string, map[string]string) { return 200, ``, nil },
	}
	for nome, resp := range casos {
		t.Run(nome, func(t *testing.T) {
			pv, _, pf, p := ambientePush(t, resp)
			inscrever(t, p, "quer", "cccccccc-0000-0000-0000-000000000001")
			err := pv.Rodar(context.Background(), "hoje")
			if err == nil || !strings.Contains(err.Error(), "bling_indisponivel") || len(pf.recebidos) != 0 {
				t.Fatalf("err=%v pushes=%d: devia falhar como bling_indisponivel e não mandar nada", err, len(pf.recebidos))
			}
		})
	}
}

// 5xx transitório que passa na repetição: o push sai UMA vez (a repetição não duplica o efeito).
func TestPushVendasBlingTransitorioRepeteESaiUmaVez(t *testing.T) {
	falhou := map[string]bool{}
	pv, _, pf, p := ambientePush(t, func(pb core.PedidoBling, n int) (int, string, map[string]string) {
		if pb.Caminho == "/pedidos/vendas" {
			k := pb.Query["dataInicial"].(string)
			if !falhou[k] {
				falhou[k] = true
				return 503, `{}`, nil
			}
		}
		return pedidosPorDia(pb, n)
	})
	inscrever(t, p, "quer", "cccccccc-0000-0000-0000-000000000001")
	if err := pv.Rodar(context.Background(), "hoje"); err != nil {
		t.Fatalf("o 503 isolado devia passar na repetição: %v", err)
	}
	if len(pf.recebidos) != 1 {
		t.Fatalf("pushes=%d, esperava 1", len(pf.recebidos))
	}
}
