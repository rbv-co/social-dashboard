package conteudo

import (
	"net/http"
	"testing"
	"time"
)

// Plano 03-A: quem só edita (sem conteudo.aprovar) só agenda uma peça que JÁ está aprovada. Enquanto
// ele pede "agendada", outra pessoa devolve a peça a rascunho e ainda não confirmou. A conferência tem
// de esperar essa transação (for update) e, depois, enxergar o rascunho: 403. Sem a trava ela lê
// "aprovada" (a foto de antes), o UPDATE espera e grava rascunho → agendada: a peça pula a aprovação,
// que é o furo que a conferência existe para fechar. Há DUAS travas (autz.travar e a da conferência):
// o teste só reprova se as duas saírem.
func TestAgendarNaCorridaComODevolverARascunhoNaoPulaAAprovacao(t *testing.T) {
	m := novoMundo(t, montarPecas)
	ctx := t.Context()
	if _, err := m.P.Exec(ctx, `update conteudo_pecas set status = 'aprovada' where id = $1::uuid`, P1); err != nil {
		t.Fatal(err)
	}
	outra, err := m.P.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer outra.Rollback(ctx)
	if _, err := outra.Exec(ctx, `update conteudo_pecas set status = 'rascunho' where id = $1::uuid`, P1); err != nil {
		t.Fatal(err)
	}
	st := make(chan int, 1)
	go func() {
		c, _ := m.Pedir(t, "conteudista", "PATCH", "/conteudo/pecas/"+P1, `{"status":"agendada","publicar_em":"2026-11-01T15:00:00.000Z"}`)
		st <- c
	}()
	// só confirma a outra transação quando o pedido está de fato esperando a linha dela
	esperando := false
	for range 200 {
		if m.Um(t, `select count(*)::text from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`) != "0" {
			esperando = true
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if !esperando {
		t.Fatal("o pedido não chegou a esperar a linha travada: o teste não exerce a trava")
	}
	if err := outra.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if got := <-st; got != http.StatusForbidden {
		t.Errorf("agendar peça que acabou de voltar a rascunho = %d, esperava 403", got)
	}
	if v := m.Um(t, `select status from conteudo_pecas where id = '`+P1+`'`); v != "rascunho" {
		t.Errorf("status = %s: a peça pulou a aprovação (esperava rascunho)", v)
	}
}
