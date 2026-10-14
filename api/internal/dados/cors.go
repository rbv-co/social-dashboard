package dados

import "net/http"

// CORS libera o preflight e a resposta para as origens configuradas (comparação EXATA com o cabeçalho Origin, que o
// navegador manda em minúsculas e sem barra final). `metodos` é o que a rota aceita ("POST, OPTIONS"). Origem fora da
// lista não recebe cabeçalho CORS (o navegador bloqueia); o preflight responde 204 sem tocar em mais nada. A resposta
// varia com a origem, então `Vary: Origin` vai sempre.
func CORS(origens []string, metodos string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Add("Vary", "Origin")
			if og := r.Header.Get("Origin"); og != "" {
				for _, ok := range origens {
					if og == ok {
						h := w.Header()
						h.Set("Access-Control-Allow-Origin", og)
						h.Set("Access-Control-Allow-Methods", metodos)
						h.Set("Access-Control-Allow-Headers", "apikey, authorization, content-type, x-client-info, x-upsert, prefer")
						h.Set("Access-Control-Max-Age", "600")
					}
				}
			}
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
