package email

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

// Plano 04 (A): ZeptoMail falha de cada jeito. Mandar faz UMA chamada (repetir mandaria o link de senha
// duas vezes), devolve erro em tudo que não é 2xx e nunca leva token, destinatário, texto nem endereço.
func TestMandarFalhasViramErroSemRepetirNemVazar(t *testing.T) {
	casos := []struct {
		nome     string
		serve    func(w http.ResponseWriter, r *http.Request)
		querErro bool
		prazo    time.Duration
	}{
		{"202 ok", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(202)
			io.WriteString(w, `{"message":"OK"}`)
		}, false, 0},
		{"429 com Retry-After", func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Retry-After", "30")
			w.WriteHeader(429)
			io.WriteString(w, `{"error":{"code":"TM_4003"}}`)
		}, true, 0},
		{"500", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(500) }, true, 0},
		{"503 com HTML", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(503)
			io.WriteString(w, `<html>indisponível</html>`)
		}, true, 0},
		{"401 token ruim", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(401)
			io.WriteString(w, `{"error":{"code":"TM_3501"}}`)
		}, true, 0},
		{"422 destinatário inválido", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(422)
			io.WriteString(w, `{"error":{"code":"TM_3301"}}`)
		}, true, 0},
		{"recusa com JSON truncado", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(400); io.WriteString(w, `{"error":{"co`) }, true, 0},
		{"conexão cortada", func(w http.ResponseWriter, r *http.Request) { c, _, _ := w.(http.Hijacker).Hijack(); c.Close() }, true, 0},
		{"nunca responde", func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }, true, 150 * time.Millisecond},
		{"eco do pedido na recusa", func(w http.ResponseWriter, r *http.Request) {
			b, _ := io.ReadAll(r.Body)
			w.WriteHeader(400)
			w.Write(append(b, r.Header.Get("Authorization")...))
		}, true, 0},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			var n atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if c.nome != "eco do pedido na recusa" {
					io.Copy(io.Discard, r.Body) // sem ler o corpo o servidor não vê o cliente desistir
				}
				n.Add(1)
				c.serve(w, r)
			}))
			defer srv.Close()
			z := &ZeptoMail{URL: srv.URL, Token: "chave-zepto-secreta", De: "no-reply@x.com", Nome: "Central"}
			ctx := context.Background()
			if c.prazo > 0 {
				var cancela context.CancelFunc
				ctx, cancela = context.WithTimeout(ctx, c.prazo)
				defer cancela()
			}
			err := z.Mandar(ctx, "alvo@privado.com", "Assunto", "<p>link-secreto-de-senha</p>", "link-secreto-de-senha")
			if (err != nil) != c.querErro {
				t.Fatalf("err=%v, esperava erro=%v", err, c.querErro)
			}
			if n.Load() != 1 {
				t.Errorf("chamadas = %d: e-mail com link de senha não pode sair duas vezes", n.Load())
			}
			if err != nil {
				for _, s := range []string{"chave-zepto-secreta", "alvo@privado.com", "link-secreto-de-senha", srv.Listener.Addr().String()} {
					if strings.Contains(err.Error(), s) {
						t.Errorf("o erro vaza %q: %s", s, err)
					}
				}
			}
		})
	}
}
