package frota

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// contar devolve quantas respostas tiveram cada status.
func contar(st []int) map[int]int {
	c := map[int]int{}
	for _, s := range st {
		c[s]++
	}
	return c
}

// Plano 03-A: oito pessoas pegando o MESMO carro livre ao mesmo tempo, 20 rodadas: um 201, sete 409 e
// uma saída aberta. A trava é o índice parcial uniq_frota_uso_um_aberto (sem ele as oito entram).
func TestOitoRetiradasDoMesmoCarroUmaSoGanha(t *testing.T) {
	m := novoMundo(t, montarUsos)
	for rodada := range 20 {
		st := make([]int, 8)
		mundoteste.EmParalelo(len(st), func(i int) {
			quem := []string{"motorista", "motorista2"}[i%2]
			st[i] = m.Resposta(t, quem, "POST", "/frota/usos", `{"veiculo_id":"`+V2+`","km_saida":150}`).Code
		})
		if c := contar(st); c[http.StatusCreated] != 1 || c[http.StatusConflict] != 7 {
			t.Fatalf("rodada %d: status %v, esperava um 201 e sete 409", rodada, st)
		}
		if v := m.Um(t, `select count(*)::text from frota_uso where veiculo_id = '`+V2+`' and volta_em is null`); v != "1" {
			t.Fatalf("rodada %d: V2 com %s saídas abertas", rodada, v)
		}
		if _, err := m.P.Exec(t.Context(), `update frota_uso set volta_em = now() where veiculo_id = $1::uuid and volta_em is null`, V2); err != nil {
			t.Fatal(err)
		}
	}
}

// Plano 03-A: oito trocas que só FECHAM a mesma posse, com horas diferentes: uma 200, sete 409, e a hora
// gravada é a da que ganhou (sem a trava de linha do PodeEditar, as oito passam pela conferência e a
// última a gravar apaga a hora das outras: atualização perdida, todas com 200).
func TestOitoFechamentosDaMesmaPosseUmSoGanha(t *testing.T) {
	m := novoMundo(t, montarUsos)
	for rodada := range 20 {
		if _, err := m.P.Exec(t.Context(), `update frota_uso set volta_em = null where id = $1::uuid`, U1); err != nil {
			t.Fatal(err)
		}
		st := make([]int, 8)
		corpo := make([]string, 8)
		mundoteste.EmParalelo(len(st), func(i int) {
			w := m.Resposta(t, "motorista", "POST", "/frota/usos/trocar",
				fmt.Sprintf(`{"veiculo_id":%q,"fechar":{"id":%q,"volta_em":"2026-10-12T%02d:00:00Z"}}`, V1, U1, 10+i))
			st[i], corpo[i] = w.Code, w.Body.String()
		})
		if c := contar(st); c[http.StatusOK] != 1 || c[http.StatusConflict] != 7 {
			t.Fatalf("rodada %d: status %v, esperava um 200 e sete 409", rodada, st)
		}
		ganhou := -1
		for i, s := range st {
			if s == http.StatusOK {
				ganhou = i
			}
		}
		quer := fmt.Sprintf("2026-10-12 %02d:00:00+00", 10+ganhou)
		if v := m.Um(t, `select volta_em::text from frota_uso where id = '`+U1+`'`); v != quer {
			t.Fatalf("rodada %d: volta_em = %s, esperava %s (a hora de quem ganhou)", rodada, v, quer)
		}
	}
}
