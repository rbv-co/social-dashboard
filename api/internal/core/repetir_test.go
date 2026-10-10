package core

import (
	"testing"
	"time"
)

func TestDecidir(t *testing.T) {
	const p, o = 11 * time.Second, 25 * time.Second
	casos := []struct {
		nome                  string
		tentativa, status     int
		decorrido, retryAfter time.Duration
		repetir               bool
		esperar               time.Duration
	}{
		{"deu certo", 1, 200, 0, 0, false, 0},
		{"404 é resposta", 1, 404, 0, 0, false, 0},
		{"403 é resposta", 1, 403, 0, 0, false, 0},
		{"429 repete", 1, 429, 0, 0, true, 600 * time.Millisecond},
		{"429 obedece Retry-After maior", 1, 429, 0, 3 * time.Second, true, 3 * time.Second},
		{"Retry-After menor não encurta", 2, 429, 0, time.Second, true, 1200 * time.Millisecond},
		{"500 repete", 2, 500, 0, 0, true, 1200 * time.Millisecond},
		{"sem resposta repete", 1, 0, 0, 0, true, 600 * time.Millisecond},
		{"terceira não repete", 3, 503, 0, 0, false, 0},
		{"não cabe no orçamento", 1, 0, 14 * time.Second, 0, false, 0},
	}
	for _, c := range casos {
		d := decidir(c.tentativa, c.status, c.decorrido, c.retryAfter, p, o)
		if d.repetir != c.repetir || d.esperar != c.esperar || d.motivo == "" {
			t.Errorf("%s: %+v", c.nome, d)
		}
	}
}
