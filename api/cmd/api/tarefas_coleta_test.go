package main

import (
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// TestTarefasDeProducao confere nome e agenda; aqui, o prazo, a trava e o registro próprio das tarefas
// do coletar-dados e da auditoria (uma rodada de 50 min por vez; a auditoria tem a trava do próprio nome).
func TestTarefasDoColetarDadosTemPrazoETrava(t *testing.T) {
	quer := map[string]struct {
		limite  time.Duration
		trava   string
		proprio bool
	}{
		"coletar-dados-07h": {50 * time.Minute, "coletar-dados", true}, "coletar-dados-12h": {50 * time.Minute, "coletar-dados", true},
		"coletar-dados-18h": {50 * time.Minute, "coletar-dados", true}, "coletar-dados-2359": {50 * time.Minute, "coletar-dados", true},
		"auditar-dados": {5 * time.Minute, "", false},
	}
	visto := 0
	for _, tf := range tarefas(nil, config.Config{}, worker.Novo(nil)) {
		q, ok := quer[tf.Nome]
		if !ok {
			continue
		}
		visto++
		if tf.Limite != q.limite || tf.Trava != q.trava || tf.RegistroProprio != q.proprio {
			t.Errorf("%s: limite=%v trava=%q registro próprio=%v; queria %+v", tf.Nome, tf.Limite, tf.Trava, tf.RegistroProprio, q)
		}
	}
	if visto != len(quer) {
		t.Fatalf("tarefas encontradas: %d de %d", visto, len(quer))
	}
}
