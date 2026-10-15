package meta

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// Plano 04 (A): Z-API (WhatsApp) falha de cada jeito. Contrato de Enviar: ambiguo=true quando a mensagem
// PODE ter saído (quem chama NÃO repete); ambiguo=false com erro = recusa clara (a reserva é desfeita);
// uma chamada só por envio (sem repetição interna); nenhum erro leva token, id da instância nem endereço.
func TestZAPIFalhasClassificadasSemRepetirNemVazar(t *testing.T) {
	casos := []struct {
		nome     string
		serve    func(w http.ResponseWriter, r *http.Request)
		ambiguo  bool
		querErro bool
		prazo    time.Duration
	}{
		{"200 ok", func(w http.ResponseWriter, r *http.Request) { io.WriteString(w, `{"zaapId":"1","messageId":"2"}`) }, false, false, 0},
		{"429 recusa antes de processar", func(w http.ResponseWriter, r *http.Request) { w.Header().Set("Retry-After", "30"); w.WriteHeader(429) }, false, true, 0},
		{"400 definitivo", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(400)
			io.WriteString(w, `{"error":"phone"}`)
		}, false, true, 0},
		{"401 credencial", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(401) }, false, true, 0},
		{"404 instância", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(404) }, false, true, 0},
		{"500 recusa (registrado: reserva desfeita)", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) }, false, true, 0},
		{"502 gateway é ambíguo", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(502) }, true, true, 0},
		{"504 gateway é ambíguo", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(504) }, true, true, 0},
		{"conexão cortada é ambígua", func(w http.ResponseWriter, r *http.Request) { c, _, _ := w.(http.Hijacker).Hijack(); c.Close() }, true, true, 0},
		{"nunca responde é ambíguo", func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }, true, true, 150 * time.Millisecond},
		{"eco do segredo na recusa sai mascarado", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(400)
			io.WriteString(w, r.URL.Path+" "+r.Header.Get("Client-Token"))
		}, false, true, 0},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			var n atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				io.Copy(io.Discard, r.Body)
				n.Add(1)
				c.serve(w, r)
			}))
			defer srv.Close()
			z := &ZAPI{InstanceID: "inst-secreta-1", InstanceToken: "tok-instancia-2", ClientToken: "cli-token-3", URL: srv.URL}
			ctx := context.Background()
			if c.prazo > 0 {
				var cancela context.CancelFunc
				ctx, cancela = context.WithTimeout(ctx, c.prazo)
				defer cancela()
			}
			ambiguo, err := z.Enviar(ctx, "5511999999999", "oi")
			if (err != nil) != c.querErro || ambiguo != c.ambiguo {
				t.Fatalf("ambiguo=%v err=%v, esperava ambiguo=%v erro=%v", ambiguo, err, c.ambiguo, c.querErro)
			}
			if n.Load() != 1 {
				t.Errorf("chamadas = %d: o envio não pode repetir por conta própria", n.Load())
			}
			if err != nil {
				for _, segredo := range []string{"inst-secreta-1", "tok-instancia-2", "cli-token-3", srv.Listener.Addr().String()} {
					if strings.Contains(err.Error(), segredo) {
						t.Errorf("o erro vaza %q: %s", segredo, err)
					}
				}
			}
		})
	}
}
