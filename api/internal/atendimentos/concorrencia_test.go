package atendimentos

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// Plano 03-A: oito cadastros de stylist ao mesmo tempo com o insert alargado em 50 ms: todos 200, todos com
// código próprio (STY-NNNN, sem repetir). A função tem DUAS proteções, o pg_advisory_xact_lock antes de
// calcular o próximo número e um laço de 3 tentativas que refaz a conta se o único estourar: tirar só a
// trava não reprova este teste (o laço cobre). É guarda de regressão, não prova de cada proteção.
func TestOitoCadastrosDeStylistComInsertLentoNaoRepetemCodigo(t *testing.T) {
	m := novoMundo(t)
	m.Atrasar(t, "vessel_stylists", "insert", 50)
	const n = 8
	codigos := make([]string, n)
	mundoteste.EmParalelo(n, func(i int) {
		st, resp := m.Pedir(t, "editar:"+circle, "POST", "/rpc/vessel_stylist_criar",
			fmt.Sprintf(`{"p_nome":"Lenta %d","p_whatsapp":"1998000000%d","p_origem_contato":"inbound"}`, i, i))
		var o map[string]any
		json.Unmarshal([]byte(resp), &o)
		if st != 200 || o["ok"] != true {
			t.Errorf("cadastro %d = %d %.200s", i, st, resp)
			return
		}
		codigos[i], _ = o["codigo"].(string)
	})
	vistos := map[string]bool{}
	for _, c := range codigos {
		if c == "" || vistos[c] {
			t.Errorf("código vazio ou repetido: %v", codigos)
		}
		vistos[c] = true
	}
	if got := m.Um(t, `select count(distinct codigo)::text || '/' || count(*)::text from vessel_stylists`); got != fmt.Sprintf("%d/%d", n+1, n+1) {
		t.Errorf("códigos distintos / stylists = %s, esperava %d/%d", got, n+1, n+1)
	}
}
