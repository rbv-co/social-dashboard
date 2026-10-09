package auth

import (
	"testing"
	"time"
)

func TestLimitadorBloqueiaAposMaxEJanelaExpira(t *testing.T) {
	l := NovoLimitador()
	agora := time.Now()
	l.agora = func() time.Time { return agora }
	for i := 0; i < l.Max; i++ {
		if l.Bloqueado("k") {
			t.Fatalf("bloqueou cedo, i=%d", i)
		}
		l.Falhou("k")
	}
	if !l.Bloqueado("k") {
		t.Fatal("deveria bloquear")
	}
	if l.Bloqueado("outra") {
		t.Fatal("chave diferente não pode ser afetada")
	}
	agora = agora.Add(l.Janela + time.Second)
	if l.Bloqueado("k") {
		t.Fatal("janela deveria ter expirado")
	}
	l.Falhou("k")
	l.Limpar("k")
	if l.Bloqueado("k") || len(l.falhas["k"]) != 0 {
		t.Fatal("Limpar deveria zerar")
	}
}
