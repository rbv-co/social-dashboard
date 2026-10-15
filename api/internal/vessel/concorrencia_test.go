package vessel

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// Plano 03-A: dezesseis baixas simultâneas da MESMA peça, em 15 peças: uma ganha (ok:true) e as outras
// voltam ja_baixada (200) ou 409 (quem perdeu a corrida no índice vessel_baixas_ativa_idx, que é a trava
// de verdade: a função confere e depois insere). Sempre uma baixa ativa, nunca duas.
func TestBaixaDeDezesseisSimultaneasUmaSoGanha(t *testing.T) {
	m := novoMundo(t, montarRPCs)
	for r := range 15 {
		codigo := fmt.Sprintf("VBZZ%04d", r)
		if _, err := m.P.Exec(t.Context(), `insert into vessel_pecas (codigo, lote_id, numero_na_serie, criado_em)
			values ($1, $2::uuid, $3, now())`, codigo, L1, 100+r); err != nil {
			t.Fatal(err)
		}
		st := make([]int, 16)
		corpo := make([]string, 16)
		mundoteste.EmParalelo(len(st), func(i int) {
			st[i], corpo[i] = m.Pedir(t, "selo", "POST", "/rpc/vessel_baixar_peca", `{"p_codigo":"`+codigo+`","p_motivo":"extraviada"}`)
		})
		ganhou := 0
		for i := range st {
			switch {
			case st[i] == http.StatusOK && strings.Contains(corpo[i], `"ok" : true`):
				ganhou++
			case st[i] == http.StatusOK && strings.Contains(corpo[i], "ja_baixada"), st[i] == http.StatusConflict:
			default:
				t.Errorf("peça %s: resposta inesperada %d %s", codigo, st[i], corpo[i])
			}
		}
		if ganhou != 1 {
			t.Errorf("peça %s: %d baixas ganharam, esperava 1", codigo, ganhou)
		}
		if v := m.Um(t, `select count(*)::text from vessel_baixas where codigo = '`+codigo+`' and desfeita_em is null`); v != "1" {
			t.Errorf("peça %s: %s baixas ativas", codigo, v)
		}
	}
}
