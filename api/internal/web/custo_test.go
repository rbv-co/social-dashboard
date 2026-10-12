package web

import (
	"github.com/go-chi/chi/v5"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// postarCusto faz POST rota com o corpo e o token (vazio = sem sessão); devolve status e corpo.
func postarCusto(h http.Handler, rota, corpo, tok string) (int, string) {
	r := httptest.NewRequest("POST", rota, strings.NewReader(corpo))
	if tok != "" {
		r.Header.Set("Authorization", "Bearer "+tok)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code, strings.TrimSpace(w.Body.String())
}

// TestCustoPeloPortaoReal: o portão da edge (papel admin) pela montagem de produção. Só o admin passa
// do portão; super-admin pela ficha e claude.status NÃO abrem (Ruling 8). Sem chave, o admin chega ao
// 500 chave_admin_nao_configurada: prova que passou do portão sem ir à rede.
func TestCustoPeloPortaoReal(t *testing.T) {
	const chaveAnt, chaveOAI = "sk-ant-admin-falsa-123", "sk-admin-falsa-456"
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	toks := pessoasDosPaineis(t, p, s)
	semChave := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	comChave := Rotas(p, s, auth.NovoLimitador(), config.Config{AnthropicAdmin: chaveAnt, OpenAIAdmin: chaveOAI})
	negados := map[string][2]any{ // quem → {status, corpo}
		"": {401, `{"error":"nao_autenticado"}`}, "cliente": {403, `{"error":"sem_permissao"}`},
		"admin-desativado": {401, `{"error":"nao_autenticado"}`},
		"nenhum":           {403, `{"error":"sem_permissao"}`}, "status": {403, `{"error":"sem_permissao"}`},
		"super": {403, `{"error":"sem_permissao"}`},
	}
	for _, rota := range []string{"/custo-anthropic", "/custo-openai"} {
		for quem, q := range negados {
			for nome, h := range map[string]http.Handler{"sem chave": semChave, "com chave": comChave} {
				c, corpo := postarCusto(h, rota, `{"dias":7}`, toks[quem])
				if c != q[0].(int) || corpo != q[1].(string) {
					t.Errorf("%s como %q (%s) = %d %s, esperava %v %v", rota, quem, nome, c, corpo, q[0], q[1])
				}
				if strings.Contains(corpo, chaveAnt) || strings.Contains(corpo, chaveOAI) {
					t.Errorf("%s como %q: o corpo contém a chave", rota, quem)
				}
			}
		}
		c, corpo := postarCusto(semChave, rota, `{"dias":7}`, toks["admin"])
		if c != 500 || corpo != `{"error":"falha","detalhe":"chave_admin_nao_configurada"}` {
			t.Errorf("%s como admin sem chave = %d %s", rota, c, corpo)
		}
	}
}

// TestCustoForaDoGrupoDeDominio: as rotas custo-* ficam no grupo autenticado, FORA do de domínio. A
// cadeia de middlewares é exatamente Exigir + o prazo de 90 s: dentro do grupo de domínio entrariam
// também o prazo de 30 s (que, aninhado, venceria os 90 s) e o carregamento do escopo (consulta ao
// banco que a edge não faz). Se mudar de propósito, revise o portão e o prazo e ajuste este número.
func TestCustoForaDoGrupoDeDominio(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	vistas := 0
	chi.Walk(h.(chi.Routes), func(metodo, rota string, _ http.Handler, mws ...func(http.Handler) http.Handler) error {
		if metodo == "POST" && (rota == "/custo-anthropic" || rota == "/custo-openai") {
			vistas++
			if len(mws) != 2 {
				t.Errorf("%s tem %d middlewares, esperava 2 (Exigir + prazo): saiu do grupo autenticado ou entrou no de domínio?", rota, len(mws))
			}
		}
		return nil
	})
	if vistas != 2 {
		t.Errorf("rotas custo montadas: %d", vistas)
	}
}
