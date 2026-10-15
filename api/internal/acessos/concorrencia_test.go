package acessos

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// Plano 03-A: oito ligações da MESMA ficha a dois logins, soltas juntas, 20 rodadas. Quem recebe 200
// tem de ser o login que ficou gravado (todo 200 de outro login seria atualização perdida: a ficha
// diria uma coisa e o 200 outra); o login que não ficou recebe 409. A trava é o for update do PodeEditar.
func TestLigarOitoSimultaneasNaoPerdeAtualizacao(t *testing.T) {
	m := novoMundo(t, montarPessoas, montarAcoesDaPessoa)
	logins := []string{idViewer, idFrota}
	for rodada := range 20 {
		if _, err := m.P.Exec(t.Context(), `update acessos_pessoas set profile_id = null where id = $1::uuid`, P3); err != nil {
			t.Fatal(err)
		}
		st := make([]int, 8)
		mundoteste.EmParalelo(len(st), func(i int) {
			st[i] = m.Resposta(t, "admin", "POST", "/acessos/pessoas/"+P3+"/ligar", `{"profile_id":"`+logins[i%2]+`"}`).Code
		})
		ficou := m.Um(t, acoesElo(P3))
		for i, c := range st {
			quer := http.StatusConflict
			if logins[i%2] == ficou {
				quer = http.StatusOK
			}
			if c != quer {
				t.Fatalf("rodada %d: pedido %d (login %s) = %d, esperava %d; a ficha ficou com %s (%s)", rodada, i, logins[i%2], c, quer, ficou, fmt.Sprint(st))
			}
		}
	}
}
