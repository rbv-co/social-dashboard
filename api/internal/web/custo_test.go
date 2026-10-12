package web

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
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

// chamadaAoFornecedor é o que o gravador viu: para onde a rota foi e com qual credencial.
type chamadaAoFornecedor struct{ host, xAPIKey, authorization string }

// gravadorDeCusto toma o lugar da rede (http.DefaultTransport, que o cliente sem redirecionamento
// usa): grava cada chamada e responde 401, sem sair da máquina. Se o portão quebrar, o teste vê a
// chamada em vez de bater no fornecedor de verdade.
type gravadorDeCusto struct {
	mu       sync.Mutex
	chamadas []chamadaAoFornecedor
}

func (g *gravadorDeCusto) RoundTrip(r *http.Request) (*http.Response, error) {
	g.mu.Lock()
	g.chamadas = append(g.chamadas, chamadaAoFornecedor{r.URL.Host, r.Header.Get("x-api-key"), r.Header.Get("Authorization")})
	g.mu.Unlock()
	return &http.Response{StatusCode: 401, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{}`)), Request: r}, nil
}

func (g *gravadorDeCusto) zerar() []chamadaAoFornecedor {
	g.mu.Lock()
	defer g.mu.Unlock()
	c := g.chamadas
	g.chamadas = nil
	return c
}

// TestCustoPeloPortaoReal: o portão da edge (papel admin) pela montagem de produção, com a rede
// trocada por um gravador. Só o admin passa do portão; super-admin pela ficha e claude.status NÃO
// abrem (Ruling 8), e "entrar como" um admin abre (o JWT do alvo abria), um não-admin não. Negado =
// zero chamadas. Admin com chave: cada rota leva a SUA chave ao SEU fornecedor, e a outra nunca vai.
func TestCustoPeloPortaoReal(t *testing.T) {
	const chaveAnt, chaveOAI = "sk-ant-admin-falsa-123", "sk-admin-falsa-456"
	const idAdmin, idNenhum, idSuper = "11111111-1111-1111-1111-111111111114", "11111111-1111-1111-1111-111111111110", "51200000-0000-4000-a000-000000000001"
	rede := &gravadorDeCusto{}
	antigo := http.DefaultTransport
	http.DefaultTransport = rede
	t.Cleanup(func() { http.DefaultTransport = antigo })
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	toks := pessoasDosPaineis(t, p, s)
	super := idSuper
	var err error
	if toks["admin-como-super"], err = s.Criar(context.Background(), idAdmin, "painel", &super); err != nil {
		t.Fatal(err)
	}
	if toks["nenhum-como-super"], err = s.Criar(context.Background(), idNenhum, "painel", &super); err != nil {
		t.Fatal(err)
	}
	semChave := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	comChave := Rotas(p, s, auth.NovoLimitador(), config.Config{AnthropicAdmin: chaveAnt, OpenAIAdmin: chaveOAI})
	type resposta struct {
		status int
		corpo  string
	}
	negados := map[string]resposta{
		"": {401, `{"error":"nao_autenticado"}`}, "cliente": {403, `{"error":"sem_permissao"}`},
		"admin-desativado": {401, `{"error":"nao_autenticado"}`},
		"nenhum":           {403, `{"error":"sem_permissao"}`}, "status": {403, `{"error":"sem_permissao"}`},
		"super":             {403, `{"error":"sem_permissao"}`},
		"nenhum-como-super": {403, `{"error":"sem_permissao"}`}, // "entrar como" um não-admin
	}
	for _, rota := range []string{"/custo-anthropic", "/custo-openai"} {
		for quem, q := range negados {
			for nome, h := range map[string]http.Handler{"sem chave": semChave, "com chave": comChave} {
				c, corpo := postarCusto(h, rota, `{"dias":7}`, toks[quem])
				if c != q.status || corpo != q.corpo {
					t.Errorf("%s como %q (%s) = %d %s, esperava %v", rota, quem, nome, c, corpo, q)
				}
				if strings.Contains(corpo, chaveAnt) || strings.Contains(corpo, chaveOAI) {
					t.Errorf("%s como %q: o corpo contém a chave", rota, quem)
				}
				if n := rede.zerar(); len(n) != 0 {
					t.Errorf("%s como %q (%s): o negado chamou o fornecedor: %v", rota, quem, nome, n)
				}
			}
			// o portão vem antes do corpo: corpo inválido também é 403 para o negado (não 400)
			if c, _ := postarCusto(comChave, rota, `{"dias":"x"}`, toks[quem]); quem != "" && quem != "admin-desativado" && c != 403 {
				t.Errorf("%s como %q com corpo inválido = %d, esperava 403 (portão antes do corpo)", rota, quem, c)
			}
		}
		for _, quem := range []string{"admin", "admin-como-super"} { // "entrar como" um admin abre (Ruling 8)
			c, corpo := postarCusto(semChave, rota, `{"dias":7}`, toks[quem])
			if c != 500 || corpo != `{"error":"falha","detalhe":"chave_admin_nao_configurada"}` {
				t.Errorf("%s como %s sem chave = %d %s", rota, quem, c, corpo)
			}
			if n := rede.zerar(); len(n) != 0 {
				t.Errorf("%s como %s sem chave chamou o fornecedor: %v", rota, quem, n)
			}
		}
	}
	// cada rota leva a SUA chave ao SEU fornecedor (trocar `cfg.AnthropicAdmin` por `cfg.OpenAIAdmin`,
	// ou o `Buscar`, mandaria a chave de um fornecedor para o outro)
	for _, quem := range []string{"admin", "admin-como-super"} {
		postarCusto(comChave, "/custo-anthropic", `{"dias":7}`, toks[quem])
		chamadas := rede.zerar()
		if len(chamadas) == 0 {
			t.Fatalf("/custo-anthropic como %s não chegou ao fornecedor", quem)
		}
		for _, c := range chamadas {
			if c != (chamadaAoFornecedor{"api.anthropic.com", chaveAnt, ""}) {
				t.Errorf("/custo-anthropic como %s: chamada %+v, esperava api.anthropic.com com x-api-key", quem, c)
			}
		}
		postarCusto(comChave, "/custo-openai", `{"dias":7}`, toks[quem])
		chamadas = rede.zerar()
		if len(chamadas) == 0 {
			t.Fatalf("/custo-openai como %s não chegou ao fornecedor", quem)
		}
		for _, c := range chamadas {
			if c != (chamadaAoFornecedor{"api.openai.com", "", "Bearer " + chaveOAI}) {
				t.Errorf("/custo-openai como %s: chamada %+v, esperava api.openai.com com Bearer", quem, c)
			}
		}
	}
}

// TestCustoForaDoGrupoDeDominio: as rotas custo-* ficam no grupo autenticado, FORA do de domínio. A
// cadeia de middlewares é a do grupo autenticado (a de /invite-user) + o prazo de 90 s: dentro do grupo de domínio entrariam
// também o prazo de 30 s (que, aninhado, venceria os 90 s) e o carregamento do escopo (consulta ao
// banco que a edge não faz). Se mudar de propósito, revise o portão e o prazo.
func TestCustoForaDoGrupoDeDominio(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	// a irmã do mesmo grupo autenticado, sem prazo próprio: custo-* tem exatamente um middleware a mais
	// (o prazo). Um middleware global novo no roteador raiz sobe os dois lados e não quebra o teste.
	mwsDe := map[string]int{}
	chi.Walk(h.(chi.Routes), func(metodo, rota string, _ http.Handler, mws ...func(http.Handler) http.Handler) error {
		if metodo == "POST" {
			mwsDe[rota] = len(mws)
		}
		return nil
	})
	irma, ok := mwsDe["/invite-user"]
	if !ok {
		t.Fatal("a rota irmã POST /invite-user sumiu: troque a referência")
	}
	for _, rota := range []string{"/custo-anthropic", "/custo-openai"} {
		n, ok := mwsDe[rota]
		if !ok {
			t.Errorf("%s não está montada", rota)
		} else if n != irma+1 {
			t.Errorf("%s tem %d middlewares, esperava %d (os da irmã /invite-user + o prazo de 90 s): saiu do grupo autenticado, entrou no de domínio ou perdeu o prazo?", rota, n, irma+1)
		}
	}
}
