package meta

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

type gravaPrazoMeta struct{ prazo *time.Duration }

func (g gravaPrazoMeta) RoundTrip(r *http.Request) (*http.Response, error) {
	if dl, ok := r.Context().Deadline(); ok {
		*g.prazo = time.Until(dl).Round(time.Second)
	}
	return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"data":[]}`)), Request: r}, nil
}

// Cada chamada à Meta nas rotas ao vivo tem teto de 60 s (padrão de produção, sem prazo no
// contexto) e NUNCA estende um prazo menor da rota. Subir o teto para horas falha aqui.
func TestChamadaAoVivoTemTetoDe60sQueNaoEstendeOPrazoDaRota(t *testing.T) {
	var visto time.Duration
	cli := core.Novo("http://core.invalido", "t")
	cli.HTTP = &http.Client{Transport: gravaPrazoMeta{&visto}}
	av := &AoVivo{Core: cli}
	if _, err := av.graph(context.Background(), "/x", obj{}); err != nil || visto != 60*time.Second {
		t.Fatalf("teto = %v (err %v), esperava 1m0s", visto, err)
	}
	ctx, cancela := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancela()
	visto = 0
	if _, err := av.graph(ctx, "/x", obj{}); err != nil || visto != 5*time.Second {
		t.Fatalf("com prazo de rota de 5 s a chamada viu %v (err %v)", visto, err)
	}
}
