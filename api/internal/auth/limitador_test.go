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

// Com 40 mil chaves vivas a varredura total roda no máximo uma vez por Janela/4: o custo por
// requisição fica plano (antes: ~1 ms cada, 40 mil requisições = dezenas de segundos), e as
// chaves vencidas ainda são removidas depois.
func TestLimitadorVarreduraNaoAmplificaCusto(t *testing.T) {
	l := NovoLimitador()
	l.MaxChaves = 10_000
	agora := time.Now()
	l.agora = func() time.Time { return agora }
	for i := 0; i < 40_000; i++ {
		l.Tentar("v" + strconv.Itoa(i))
	}
	ini := time.Now()
	for i := 0; i < 40_000; i++ { // todas as chaves continuam vivas: nenhuma varredura adianta
		l.Tentar("w" + strconv.Itoa(i))
	}
	if d := time.Since(ini); d > 5*time.Second {
		t.Fatalf("40 mil requisições com 40 mil chaves vivas levaram %v", d)
	}
	agora = agora.Add(l.Janela + time.Second)
	l.Tentar("nova")
	if len(l.falhas) != 1 {
		t.Fatalf("chaves vencidas não foram removidas: %d", len(l.falhas))
	}
}

func TestLimitadorVarreduraNoMaximoUmaPorQuartoDeJanela(t *testing.T) {
	l := NovoLimitador()
	l.MaxChaves = 10
	agora := time.Now()
	l.agora = func() time.Time { return agora }
	for i := 0; i < 20; i++ {
		l.Tentar("k" + strconv.Itoa(i))
	}
	antes := l.varridoEm
	agora = agora.Add(l.Janela/4 - time.Second)
	l.Tentar("outra")
	if !l.varridoEm.Equal(antes) {
		t.Fatal("varreu de novo antes de Janela/4")
	}
	agora = agora.Add(2 * time.Second)
	l.Tentar("mais")
	if l.varridoEm.Equal(antes) {
		t.Fatal("deveria varrer depois de Janela/4")
	}
}
