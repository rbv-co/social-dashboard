package auth

import (
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestLimitadorBloqueiaAposMaxEJanelaExpira(t *testing.T) {
	l := NovoLimitador()
	agora := time.Now()
	l.agora = func() time.Time { return agora }
	for i := 0; i < l.Max; i++ {
		if !l.Tentar("k") {
			t.Fatalf("bloqueou cedo, i=%d", i)
		}
	}
	if l.Tentar("k") {
		t.Fatal("deveria bloquear")
	}
	if !l.Tentar("outra") {
		t.Fatal("chave diferente não pode ser afetada")
	}
	agora = agora.Add(l.Janela + time.Second)
	if !l.Tentar("k") {
		t.Fatal("janela deveria ter expirado")
	}
	l.Limpar("k")
	if len(l.falhas["k"]) != 0 || !l.Tentar("k") {
		t.Fatal("Limpar deveria zerar")
	}
}

func TestLimitadorTentarEhAtomico(t *testing.T) {
	l := NovoLimitador()
	var ok atomic.Int32
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if l.Tentar("k") {
				ok.Add(1)
			}
		}()
	}
	wg.Wait()
	if int(ok.Load()) != l.Max {
		t.Fatalf("permitidas = %d, esperava exatamente %d", ok.Load(), l.Max)
	}
}

func TestLimitadorPodaTudoAoPassarDoTeto(t *testing.T) {
	l := NovoLimitador()
	l.MaxChaves = 100
	agora := time.Now()
	l.agora = func() time.Time { return agora }
	for i := 0; i < 150; i++ {
		l.Tentar("k" + strconv.Itoa(i))
	}
	agora = agora.Add(l.Janela + time.Second)
	l.Tentar("nova") // passa do teto: poda as chaves vencidas, que nunca mais voltam
	if len(l.falhas) != 1 {
		t.Fatalf("mapa com %d chaves, esperava 1", len(l.falhas))
	}
}
