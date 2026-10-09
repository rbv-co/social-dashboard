package auth

import (
	"sync"
	"time"
)

// Limitador conta falhas de login por chave (e-mail|ip) numa janela.
// ponytail: em memória, vale para uma instância só; Redis/Postgres se houver mais de uma.
type Limitador struct {
	Max    int
	Janela time.Duration
	mu     sync.Mutex
	falhas map[string][]time.Time
	agora  func() time.Time
}

func NovoLimitador() *Limitador {
	return &Limitador{Max: 5, Janela: 15 * time.Minute, falhas: map[string][]time.Time{}, agora: time.Now}
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

func (l *Limitador) Bloqueado(k string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.podar(k)
	return len(l.falhas[k]) >= l.Max
}

func (l *Limitador) Falhou(k string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.falhas[k] = append(l.falhas[k], l.agora())
}

func (l *Limitador) Limpar(k string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.falhas, k)
}
