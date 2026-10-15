package mensagens

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

// Plano 04 (A): cliente do Chatwoot (envio de WhatsApp), cada passo × cada falha. Classes de saída:
// tentar_de_novo (seguro repetir), falhou (visível, nunca reenvia), parar (credencial). O ponto de dinheiro
// é o enviar_template: a mensagem PODE ter saído, então só o 429 repete; o resto nunca reenvia. Cada
// chamada ao cliente faz UMA requisição (a repetição é decisão da fila, não do cliente).
func TestChatwootFalhaPorPassoClassificaECalaOToken(t *testing.T) {
	const token = "tok-chatwoot-secreto"
	type falha struct {
		nome  string
		serve func(w http.ResponseWriter, r *http.Request)
		prazo time.Duration
	}
	st := func(c int, corpo string) func(http.ResponseWriter, *http.Request) {
		return func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(c); io.WriteString(w, corpo) }
	}
	falhas := []falha{
		{"429", st(429, `{"error":"rate"}`), 0},
		{"500", st(500, `oops`), 0},
		{"503", st(503, `<html>`), 0},
		{"400", st(400, `{"error":"inválido"}`), 0},
		{"401", st(401, `{}`), 0},
		{"conexão cortada", func(w http.ResponseWriter, r *http.Request) { c, _, _ := w.(http.Hijacker).Hijack(); c.Close() }, 0},
		{"nunca responde", func(w http.ResponseWriter, r *http.Request) { <-r.Context().Done() }, 150 * time.Millisecond},
		{"200 JSON truncado", st(200, `{"id":12`), 0},
		{"200 vazio", st(200, ``), 0},
		{"200 id com tipo errado", st(200, `{"id":{"x":1},"payload":"texto"}`), 0},
	}
	passos := []struct {
		nome  string
		rodar func(c *Chatwoot, ctx context.Context) error
	}{
		{"buscar_contato", func(c *Chatwoot, ctx context.Context) error {
			_, e := c.AcharOuCriarContato(ctx, nil, "5511999999999")
			return e
		}},
		{"abrir_conversa", func(c *Chatwoot, ctx context.Context) error {
			_, e := c.AbrirConversa(ctx, 7, "5511999999999")
			return e
		}},
		{"enviar_template", func(c *Chatwoot, ctx context.Context) error { return c.EnviarTemplate(ctx, 9, "oi", Template{}) }},
		{"ler_conversa", func(c *Chatwoot, ctx context.Context) error { _, e := c.Respondeu(ctx, 9, nil); return e }},
	}
	for _, p := range passos {
		for _, f := range falhas {
			t.Run(p.nome+"/"+f.nome, func(t *testing.T) {
				var n atomic.Int32
				srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					io.Copy(io.Discard, r.Body)
					n.Add(1)
					f.serve(w, r)
				}))
				defer srv.Close()
				c := &Chatwoot{URL: srv.URL, ContaID: "1", CaixaID: 3, Token: token}
				ctx := context.Background()
				if f.prazo > 0 {
					var cancela context.CancelFunc
					ctx, cancela = context.WithTimeout(ctx, f.prazo)
					defer cancela()
				}
				err := p.rodar(c, ctx)
				// 2xx com corpo bom no enviar_template é sucesso; aqui só há 2xx quebrado: nos demais passos é erro.
				if err == nil {
					if p.nome == "enviar_template" && strings.HasPrefix(f.nome, "200") {
						return // envio aceito (2xx): o corpo não importa, nunca se reenvia por isso
					}
					t.Fatal("a falha virou sucesso")
				}
				if got := n.Load(); got != 1 {
					t.Errorf("requisições = %d, esperava 1 (o cliente não repete sozinho)", got)
				}
				como := classificarErro(err)
				if p.nome == "enviar_template" {
					switch f.nome {
					case "429":
						if como != "tentar_de_novo" {
							t.Errorf("429 no envio recusa antes de processar: %s", como)
						}
					case "401":
						if como != "parar" {
							t.Errorf("401: %s", como)
						}
					default:
						if como != "falhou" {
							t.Errorf("no envio a falha %q é ambígua ou definitiva e nunca reenvia: %s", f.nome, como)
						}
					}
				}
				if m := err.Error() + detalheDoErroSem(err, []string{token}); strings.Contains(m, token) || strings.Contains(m, srv.Listener.Addr().String()) {
					t.Errorf("vaza token ou endereço: %s", m)
				}
			})
		}
	}
}
