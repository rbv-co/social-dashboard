package acessos

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/microsoft"
	"github.com/rbv-co/social-dashboard/api/internal/zoho"
)

// OAuth: o retorno do Zoho e da Microsoft (a edge acessos-oauth). Rotas PÚBLICAS: quem chega é o navegador do admin
// mandado pelo provedor; a trava é o state gravado pelo authUrl do proxy (10 min, uso único), nunca a sessão. Não há rota
// de início: começar uma conexão exige o admin autenticado no proxy, para ninguém fixar a conexão da empresa.
type OAuth struct {
	Zoho *zoho.Cliente
	MS   *microsoft.Cliente
	// APIPublica: a mesma do Proxy (monta o redirect_uri, que tem de ser idêntico ao do authUrl).
	APIPublica string
	// Retorno: para onde a pessoa volta (o endereço padrão do app); aqui não há Origin para descobrir.
	Retorno string
}

var motivoDoProvedor = regexp.MustCompile(`^[A-Za-z0-9_.-]{1,64}$`)

func (o *OAuth) Montar(r chi.Router) {
	r.Get("/acessos-oauth/callback/zoho", o.retorno("zoho", "zoho", func(ctx context.Context, code, state, cb string) error {
		return o.Zoho.ConcluirOAuth(ctx, code, state, cb)
	}))
	r.Get("/acessos-oauth/callback/microsoft", o.retorno("microsoft", "onedrive", func(ctx context.Context, code, state, cb string) error {
		return o.MS.ConcluirOAuth(ctx, code, state, cb)
	}))
}

func (o *OAuth) retorno(provedor, chave string, concluir func(ctx context.Context, code, state, callback string) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer") // o code vai na URL
		volta := func(resultado, msg string) {
			q := url.Values{chave: {resultado}}
			if msg != "" {
				q.Set("msg", msg)
			}
			http.Redirect(w, r, o.Retorno+"?"+q.Encode(), http.StatusFound)
		}
		q := r.URL.Query()
		if e := q.Get("error"); e != "" {
			if !motivoDoProvedor.MatchString(e) { // o texto é do provedor (ou de quem forjou a URL) e a tela o exibe
				e = "erro_do_provedor"
			}
			volta("erro", e)
			return
		}
		if q.Get("code") == "" {
			volta("erro", "sem_code")
			return
		}
		if q.Get("state") == "" {
			volta("erro", "sem_state")
			return
		}
		if o.APIPublica == "" {
			volta("erro", "api_url_publica_ausente")
			return
		}
		ctx, cancela := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancela()
		err := concluir(ctx, q.Get("code"), q.Get("state"), (&Proxy{APIPublica: o.APIPublica}).callback(provedor))
		var fz *zoho.FalhaOAuth
		var fm *microsoft.FalhaOAuth
		switch {
		case err == nil:
			volta("ok", "")
		case errors.As(err, &fz):
			volta("erro", fz.Motivo)
		case errors.As(err, &fm):
			volta("erro", fm.Motivo)
		default:
			volta("erro", "falha_interna")
		}
	}
}
