package auth

import (
	"sync"
	"time"
)

// Limitador conta tentativas de login por chave numa janela.
// ponytail: em memória, vale para uma instância só; Redis/Postgres se houver mais de uma.
type Limitador struct {
	Max       int
	Janela    time.Duration
	MaxChaves int // teto de chaves antes de varrer o mapa inteiro
	mu        sync.Mutex
	falhas    map[string][]time.Time
	agora     func() time.Time
	varridoEm time.Time // última varredura total: no máximo uma por Janela/4
}

func NovoLimitador() *Limitador {
	return &Limitador{Max: 5, Janela: 15 * time.Minute, MaxChaves: 10_000, falhas: map[string][]time.Time{}, agora: time.Now}
}

func (l *Limitador) podar(k string) {
	corte := l.agora().Add(-l.Janela)
	vivas := l.falhas[k][:0]
	for _, t := range l.falhas[k] {
		if t.After(corte) {
			vivas = append(vivas, t)
		}
	}
	if len(vivas) == 0 {
		delete(l.falhas, k)
		return
	}
	l.falhas[k] = vivas
}

// Tentar poda, confere o máximo e REGISTRA a tentativa numa única seção crítica,
// antes de qualquer trabalho caro (bcrypt): requisições paralelas não furam o limite.
// Devolve false (sem registrar) quando a chave já está bloqueada.
func (l *Limitador) Tentar(k string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	// ponytail: chaves só eram podadas quando reusadas; acima de MaxChaves (10 mil) varre o
	// mapa todo sob o lock (O(n)), mas no máximo uma vez por Janela/4: sem isso cada requisição
	// pagaria a varredura (0,7-2,4 ms com 12-40 mil chaves) e a rota pública viraria amplificador
	// de CPU. Chave vencida some em até Janela + Janela/4. Com mais carga/instâncias: Redis ou Postgres.
	if agora := l.agora(); len(l.falhas) > l.MaxChaves && agora.Sub(l.varridoEm) >= l.Janela/4 {
		l.varridoEm = agora
		for chave := range l.falhas {
			l.podar(chave)
		}
	}
	l.podar(k)
	if len(l.falhas[k]) >= l.Max {
		return false
	}
	l.falhas[k] = append(l.falhas[k], l.agora())
	return true
}

func (l *Limitador) Limpar(k string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.falhas, k)
}
