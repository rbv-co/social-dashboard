package mundoteste

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

// EmParalelo roda fn(i) em n goroutines soltas juntas (todas esperam a largada) e espera as n
// terminarem. É o que faz a corrida acontecer de verdade: goroutines lançadas em sequência, sem
// barreira, muitas vezes terminam uma antes de a outra começar e o teste passa sem exercer a trava.
func EmParalelo(n int, fn func(i int)) {
	var pronto, fim sync.WaitGroup
	largada := make(chan struct{})
	pronto.Add(n)
	fim.Add(n)
	for i := range n {
		go func() {
			defer fim.Done()
			pronto.Done()
			<-largada
			fn(i)
		}()
	}
	pronto.Wait()
	close(largada)
	fim.Wait()
}

// Atrasar: ver AtrasarEm.
func (m *Mundo) Atrasar(t testing.TB, tabela, evento string, ms int) {
	t.Helper()
	AtrasarEm(t, m.P, tabela, evento, ms)
}

// AtrasarEm põe um gatilho que dorme `ms` milissegundos antes de cada `evento` (insert, update ou delete)
// em `tabela`. Alarga a janela entre "conferir" e "gravar" para a corrida do teste ser certa e não sorte:
// com a trava no lugar, quem perde espera e o resultado não muda; sem ela, todos passam pela conferência.
func AtrasarEm(t testing.TB, p *pgxpool.Pool, tabela, evento string, ms int) {
	t.Helper()
	nome := "atraso_" + tabela + "_" + evento
	if _, err := p.Exec(context.Background(), fmt.Sprintf(`
		create function %[1]s() returns trigger language plpgsql as
		$$ begin perform pg_sleep(%[4]f); return coalesce(new, old); end $$;
		create trigger %[1]s before %[3]s on %[2]s for each row execute function %[1]s();`,
		nome, tabela, evento, float64(ms)/1000)); err != nil {
		t.Fatal(err)
	}
}
