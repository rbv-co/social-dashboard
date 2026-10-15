package dados

import (
	"context"
	"sync/atomic"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// Plano 03-A: dezesseis UpsertVisivel da MESMA chave, em transações separadas e soltas juntas, 10 rodadas:
// nenhuma falha (a segunda não bate no único: o ON CONFLICT DO UPDATE é um comando só), uma linha, e o
// valor é o de alguém que mandou (nunca um valor misturado ou perdido sem escritor).
func TestUpsertVisivelSimultaneoNaoFalhaNemDuplica(t *testing.T) {
	cat, err := autz.Compilar([]byte(catalogoDeUpsert))
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	p := testebanco.Novo(t)
	if _, err := p.Exec(ctx, `create table escolha (account_id uuid primary key, valor int)`); err != nil {
		t.Fatal(err)
	}
	e := &autz.Escopo{ID: quemEscreve, TemPerfil: true, Ativo: true, Contas: []string{coisaA1}}
	for rodada := range 10 {
		var falhas atomic.Int32
		mundoteste.EmParalelo(16, func(i int) {
			tx, err := p.Begin(ctx)
			if err != nil {
				falhas.Add(1)
				return
			}
			defer tx.Rollback(ctx)
			if _, err := UpsertVisivel(ctx, tx, cat, e, "escolha", []string{"account_id"},
				map[string]any{"account_id": coisaA1, "valor": 100 + i}, "account_id, valor"); err != nil {
				t.Errorf("rodada %d, escritor %d: %v", rodada, i, err)
				falhas.Add(1)
				return
			}
			if err := tx.Commit(ctx); err != nil {
				t.Errorf("rodada %d, escritor %d: commit: %v", rodada, i, err)
				falhas.Add(1)
			}
		})
		if falhas.Load() != 0 {
			t.FailNow()
		}
		var n, v int
		if err := p.QueryRow(ctx, `select count(*), min(valor) from escolha where account_id = $1::uuid`, coisaA1).Scan(&n, &v); err != nil {
			t.Fatal(err)
		}
		if n != 1 || v < 100 || v > 115 {
			t.Fatalf("rodada %d: %d linhas, valor %d", rodada, n, v)
		}
		if _, err := p.Exec(ctx, `delete from escolha`); err != nil {
			t.Fatal(err)
		}
	}
}
