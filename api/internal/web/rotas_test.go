package web

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestSaudeEPronto(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	for _, caminho := range []string{"/saude", "/pronto"} {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("GET", caminho, nil))
		if r.Code != http.StatusOK {
			t.Fatalf("%s = %d", caminho, r.Code)
		}
	}
}

func TestAuthEuPelasRotasReais(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	const painel, cliente = "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"
	p.Exec(ctx, `insert into usuarios (id, email) values ($1, 'p@x.com'), ($2, 'c@x.com')`, painel, cliente)
	p.Exec(ctx, `insert into profiles (id, email, role) values ($1, 'p@x.com', 'viewer')`, painel)
	tokP, _ := s.Criar(ctx, painel, "painel", nil)
	tokC, _ := s.Criar(ctx, cliente, "cliente", nil)
	casos := []struct {
		nome, token string
		quer        int
	}{{"sem token", "", 401}, {"painel", tokP, 200}, {"cliente", tokC, 403}}
	for _, c := range casos {
		r := httptest.NewRequest("GET", "/auth/eu", nil)
		if c.token != "" {
			r.Header.Set("Authorization", "Bearer "+c.token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.quer {
			t.Errorf("%s: %d, esperava %d (%s)", c.nome, w.Code, c.quer, w.Body)
		}
	}
}

// Rotas públicas: EXATAMENTE estas. Qualquer outra rota registrada tem de exigir sessão;
// uma rota nova montada fora do grupo autenticado faz TestNenhumaRotaNovaFicaAberta falhar.
var publicas = map[string]bool{
	"GET /saude": true, "GET /pronto": true, "POST /auth/entrar": true,
	"POST /receber-webhook-pedido-shopify": true, "POST /receber-webhook-checkout": true,
	"POST /receber-webhook-abandono": true, "POST /receber-webhook-chatwoot": true,
	"POST /receber-opt-out-chatwoot": true,
	// Plano 5.0: links de senha (sem enumeração, limite por IP e por e-mail no handler)
	"POST /auth/esqueci-senha": true, "POST /auth/definir-senha": true,
	// Plano 5.1: o pedido de acesso da tela de login (JSON obrigatório, 10 por IP e 100 no total por hora, validação no handler)
	"POST /pedir-acesso": true,
	// Plano 6: a Vessel anônima e o Core no dialeto do Supabase. Chave do Core ou nenhuma; 415, limite por IP e global,
	// lista fechada de funções e de edges, CORS: tudo provado em publico/*_test.go
	"POST /rest/v1/rpc/{nome}": true, "OPTIONS /rest/v1/rpc/{nome}": true,
	"POST /functions/v1/{edge}": true, "OPTIONS /functions/v1/{edge}": true,
	// Plano 6: Storage. URL pública (só bucket público), URL assinada (HMAC com vencimento) e o envio de currículo (só as
	// duas pastas consultor-*; chave do Core ou limite por IP): arquivos/*_test.go
	"GET /storage/v1/object/public/{bucket}/*": true, "GET /storage/v1/object/sign/{bucket}/*": true,
	"POST /storage/v1/object/vessel-curriculos/{pasta}/{arquivo}": true, "OPTIONS /storage/v1/object/vessel-curriculos/{pasta}/{arquivo}": true,
}

func webhooksPublicos() []string {
	return []string{"/receber-webhook-pedido-shopify", "/receber-webhook-checkout", "/receber-webhook-abandono",
		"/receber-webhook-chatwoot", "/receber-opt-out-chatwoot"}
}

// Negado por padrão: percorre as rotas REAIS do roteador; toda rota fora da lista pública
// sem sessão = 401; todo webhook sem assinatura/segredo = 401 (a rota existe: não é 404).
func TestNenhumaRotaNovaFicaAberta(t *testing.T) {
	p := testebanco.Novo(t)
	st := auth.NovoStore(p)
	h := Rotas(p, st, auth.NovoLimitador(), config.Config{ShopifySegredos: []string{"s"}, ChatwootSegredo: "c"})
	semModulo := fixtureUsuarios(t, p, st)["nenhum"]
	const clienteID = "88888888-8888-4888-a888-888888888888"
	p.Exec(context.Background(), `insert into usuarios (id, email) values ($1, 'cliente-walk@x.com')`, clienteID)
	tokCliente, _ := st.Criar(context.Background(), clienteID, "cliente", nil)
	var vistas []string
	err := chi.Walk(h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		chave := metodo + " " + rota
		vistas = append(vistas, chave)
		if publicas[chave] {
			return nil
		}
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest(metodo, rota, strings.NewReader(`{"a":1}`)))
		if r.Code != http.StatusUnauthorized {
			t.Errorf("%s sem sessão = %d, esperava 401 (rota nova fora do grupo autenticado?)", chave, r.Code)
		}
		// sessão de CLIENTE (não é de painel) é recusada em TODA rota protegida, inclusive as só-sessão
		r = httptest.NewRecorder()
		req := httptest.NewRequest(metodo, rota, strings.NewReader(`{"a":1}`))
		req.Header.Set("Authorization", "Bearer "+tokCliente)
		h.ServeHTTP(r, req)
		if r.Code != http.StatusForbidden {
			t.Errorf("%s com sessão de cliente = %d, esperava 403", chave, r.Code)
		}
		// com sessão e SEM módulo nenhum: 403 em toda rota, salvo a lista curta de só-sessão
		if soSessao[chave] {
			return nil
		}
		r = httptest.NewRecorder()
		req = httptest.NewRequest(metodo, rota, strings.NewReader(`{"endpoint":"pedidos/vendas"}`))
		req.Header.Set("Authorization", "Bearer "+semModulo)
		h.ServeHTTP(r, req)
		if r.Code != http.StatusForbidden {
			t.Errorf("%s com sessão sem módulo = %d, esperava 403 (rota nova sem ExigirModulo?)", chave, r.Code)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	for chave := range publicas { // a lista pública não pode apontar para rota que não existe
		achou := false
		for _, v := range vistas {
			achou = achou || v == chave
		}
		if !achou {
			t.Errorf("rota pública %s não está montada", chave)
		}
	}
	for chave := range soSessao { // nem a lista só-sessão pode apontar para rota que não existe
		if !slices.Contains(vistas, chave) {
			t.Errorf("rota só-sessão %s não está montada", chave)
		}
	}
	// Plano 5.1: estar na lista pública e montada não basta: sem sessão, o pedido de acesso responde 201 com JSON
	// (montá-la no grupo autenticado faria 401; o 415 sem o cabeçalho é do handler, não de sessão).
	if _, err := p.Exec(context.Background(), `create table access_requests (id uuid primary key default gen_random_uuid(), name text not null,
		email text not null, message text, status text not null, created_at timestamptz not null default now())`); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/pedir-acesso", strings.NewReader(`{"name":"Sem Sessão","email":"sem-sessao@x.com","message":"oi"}`))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(r, req)
	var pedido struct{ ID string }
	if r.Code != http.StatusCreated || json.Unmarshal(r.Body.Bytes(), &pedido) != nil || pedido.ID == "" {
		t.Errorf("POST /pedir-acesso sem sessão = %d %s, esperava 201 com {\"id\"}", r.Code, r.Body)
	}
	for _, c := range webhooksPublicos() {
		r := httptest.NewRecorder()
		h.ServeHTTP(r, httptest.NewRequest("POST", c, strings.NewReader(`{"a":1}`)))
		if r.Code != http.StatusUnauthorized {
			t.Errorf("POST %s sem assinatura/segredo = %d, esperava 401", c, r.Code)
		}
	}
}

// Webhook só aceita POST: qualquer outro método é 405 do roteador, nunca chega ao handler.
func TestWebhooksSoAceitamPOST(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	for _, c := range webhooksPublicos() {
		for _, m := range []string{"GET", "PUT", "DELETE", "PATCH"} {
			r := httptest.NewRecorder()
			h.ServeHTTP(r, httptest.NewRequest(m, c, nil))
			if r.Code != http.StatusMethodNotAllowed {
				t.Errorf("%s %s = %d, esperava 405", m, c, r.Code)
			}
		}
	}
}

const conta = "33333333-3333-3333-3333-333333333333"

// fixtureUsuarios cria a conta Meta e uma pessoa por módulo (SÓ aquele módulo), uma sem
// módulo nenhum e uma admin; devolve o token de sessão de cada uma pelo nome.
func fixtureUsuarios(t *testing.T, p *pgxpool.Pool, s *auth.Store) map[string]string {
	t.Helper()
	ctx := context.Background()
	testebanco.TabelasDoEscopo(t, p) // as rotas ao vivo passam por autz.ComEscopo (lê perfil e equipes)
	if _, err := p.Exec(ctx, `create table accounts (id uuid primary key, instagram_id text, ad_account_id text);
		insert into accounts values ('`+conta+`', '1784', 'act_1')`); err != nil {
		t.Fatal(err)
	}
	perfis := []struct{ nome, role, features string }{
		{"nenhum", "viewer", "{}"}, {"so-meta", "viewer", "{meta}"}, {"so-social", "viewer", "{social}"},
		{"so-sales", "viewer", "{sales}"}, {"admin", "admin", "{}"},
	}
	toks := map[string]string{}
	for i, pf := range perfis {
		id := fmt.Sprintf("11111111-1111-1111-1111-11111111111%d", i)
		email := pf.nome + "@x.com"
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1, $2)`, id, email); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, features, escopo_por_equipe) values ($1, $2, $3, $4::text[], false)`, id, email, pf.role, pf.features); err != nil {
			t.Fatal(err)
		}
		tok, err := s.Criar(ctx, id, "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		toks[pf.nome] = tok
	}
	return toks
}

func coreFalso(t *testing.T) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"data":[]}`))
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// Rotas que só exigem sessão (qualquer módulo, ou nenhum). TODA outra rota do grupo
// autenticado tem de ter portão de módulo: uma rota nova sem portão falha no teste da varredura.
var soSessao = map[string]bool{
	// Plano 6: Storage. Cada bucket tem a SUA regra (Ler/Escrever/Apagar, uma matriz bucket × pessoa em arquivos/*_test.go);
	// com o bucket literal "{bucket}" o teste de módulo não vale: sem sessão 401 e com sessão de cliente 403 ele cobre.
	"GET /arquivos/{bucket}": true, "GET /arquivos/{bucket}/*": true, "PUT /arquivos/{bucket}/*": true,
	"DELETE /arquivos/{bucket}": true, "POST /arquivos/{bucket}/copiar": true, "POST /arquivos/{bucket}/assinar": true,
	"POST /auth/sair": true, "GET /auth/eu": true, "GET /eu/canais": true,
	// Plano 5.0: a conta de quem está logado; invite-user e entrar-como têm o portão das edges
	// DENTRO do handler (400 com a frase da edge: TestContaPelaMontagemReal) e /rpc/{nome} só
	// responde para nome registrado, cada um com o seu portão (sem registro: 404).
	"POST /auth/trocar-senha": true, "GET /eu/perfil": true, "POST /invite-user": true,
	"POST /entrar-como-usuario": true, "POST /conferir-senha": true, "POST /rpc/{nome}": true,
	// Plano 5.6: portão = catálogo, provado pela matriz de cada rota em `internal/redes`; vazamento entre
	// contas, impersonado e segredo por `TestNadaVazaEntreContas`, `TestEscritasRecusamImpersonado` e
	// `TestSegredoDaContaNuncaSai`.
	"GET /redes/contas": true, "PATCH /redes/contas/{id}": true, "GET /redes/seguidores": true,
	"GET /redes/leituras-de-seguidores": true, "GET /redes/engajamento": true, "GET /redes/conteudo": true,
	"GET /redes/campanhas": true, "GET /redes/chatwoot-eventos": true, "GET /redes/conjuntos": true, "GET /redes/anuncios": true,
	"GET /redes/insights-de-campanha": true, "GET /redes/insights-da-conta": true,
	"GET /redes/campanhas-por-hora": true, "GET /redes/anuncios-por-hora": true, "GET /redes/visitas-por-hora": true,
	"GET /redes/metas": true, "PUT /redes/metas": true, "GET /redes/filtros-de-campanha": true,
	"PUT /redes/filtros-de-campanha/{account_id}": true,
	// Plano 5.12: leituras com a regra do catálogo (`true` para sessão); a matriz por papel é
	// TestPaineisPelaMontagemReal.
	"GET /noticias/rodadas": true, "GET /noticias/concorrentes": true, "GET /noticias/panorama": true,
	"GET /status-ia/execucoes": true,
	// quem não passa na regra das duas tabelas recebe 200 [] (TestSaudeDosRobosPelaMontagemReal).
	"GET /status-ia/saude-dos-robos": true,
}

// Plano 5.1: as rotas do admin, de equipes, de avisos e de saúde. Portão = catálogo, provado pela matriz de
// cada rota em internal/acesso; escrita de impersonado recusada por TestEscritasRecusamImpersonado. Todas
// ficam no grupo de DOMÍNIO (prazo e escopo do grupo: TestPrazosPorRotaPelaMontagemReal).
var rotas51 = []string{
	"GET /acesso/usuarios", "PATCH /acesso/usuarios/{id}", "GET /acesso/perfis", "POST /acesso/perfis", "PATCH /acesso/perfis/{id}",
	"GET /acesso/pedidos", "PATCH /acesso/pedidos/{id}",
	"GET /equipes/times", "POST /equipes/times", "PATCH /equipes/times/{id}",
	"GET /equipes/membros", "POST /equipes/membros", "PATCH /equipes/membros/{id}", "DELETE /equipes/membros/{id}",
	"GET /equipes/permissoes", "POST /equipes/permissoes", "DELETE /equipes/permissoes/{id}",
	"GET /equipes/grupos", "POST /equipes/grupos", "PATCH /equipes/grupos/{id}", "DELETE /equipes/grupos/{id}",
	"GET /equipes/grupos-membros", "POST /equipes/grupos-membros", "DELETE /equipes/grupos-membros/{id}",
	"GET /avisos/preferencias", "POST /avisos/preferencias", "POST /eu/push/inscrever", "POST /eu/push/desinscrever",
	"GET /saude/conferencias",
}

// Plano 5.7: as 16 rotas de tabela de trafego.Montar, no grupo de DOMÍNIO. Portão = catálogo, provado pela
// matriz de cada rota em `internal/trafego`; vazamento e impersonado por `TestNadaVazaEntreContas` e
// `TestEscritasRecusamImpersonado`. Os 3 proxies NÃO entram aqui: têm ExigirModulo (TestNenhumaRotaNovaFicaAberta).
var rotas57 = []string{
	"GET /gestao-trafego/analises-de-orcamento", "GET /gestao-trafego/analises-de-anuncio",
	"GET /gestao-trafego/decisoes", "POST /gestao-trafego/decisoes",
	"GET /gestao-trafego/rascunhos", "POST /gestao-trafego/rascunhos",
	"PATCH /gestao-trafego/rascunhos/{id}", "DELETE /gestao-trafego/rascunhos/{id}",
	"GET /gestao-trafego/config-metricas", "PUT /gestao-trafego/config-metricas/{balde}",
	"GET /gestao-trafego/objetivos", "PUT /gestao-trafego/objetivos/{alvo_id}", "DELETE /gestao-trafego/objetivos/{alvo_id}",
	"GET /gestao-trafego/regua", "PUT /gestao-trafego/regua", "GET /gestao-trafego/interesses-sugeridos",
}

// Plano 5.2: as 30 rotas de patrimonio.Montar (22 escritas + 8 leituras), no grupo de DOMÍNIO. Portão =
// catálogo, provado pela matriz de cada rota em `internal/patrimonio`; escrita de impersonado recusada por
// `TestEscritasRecusamImpersonado`. As 5 RPCs entram por POST /rpc/{nome} (lista branca), não aqui.
var rotas52 = func() []string {
	r := []string{"GET /patrimonio/bens", "POST /patrimonio/bens", "PATCH /patrimonio/bens/{id}", "DELETE /patrimonio/bens/{id}",
		"POST /patrimonio/bens/em-massa", "POST /patrimonio/bens/apagar-em-massa",
		"GET /patrimonio/posses", "POST /patrimonio/posses", "PATCH /patrimonio/posses/{id}"}
	for _, x := range []string{"empresas", "locais", "comodos", "categorias"} {
		r = append(r, "GET /patrimonio/"+x, "POST /patrimonio/"+x, "PATCH /patrimonio/"+x+"/{id}", "DELETE /patrimonio/"+x+"/{id}")
	}
	return append(r, "GET /patrimonio/tipos", "POST /patrimonio/tipos", "GET /patrimonio/config", "PUT /patrimonio/config/{chave}", "POST /patrimonio/log")
}()

// Plano 5.8: as 10 rotas de catálogo da Fábrica. Portão = catálogo, provado pela matriz de cada rota em
// `internal/fabrica`; vazamento e impersonado pelas varreduras de lá. As 4 edges (soFabricante) e as 7 de robô
// (auth.SoServico) NÃO entram: o TestNenhumaRotaNovaFicaAberta prova que sessão sem módulo = 403 nelas.
var rotas58 = []string{
	"GET /fabrica/lojas", "GET /fabrica/objetivos", "GET /fabrica/marcas", "GET /fabrica/looks", "GET /fabrica/publicos",
	"GET /fabrica/campanhas", "GET /fabrica/criativos", "GET /fabrica/jobs", "GET /fabrica/meta-jobs",
	"POST /fabrica/criativos/escolher",
}

// Plano 5.9: as 20 rotas de tabela de conteudo.Montar (7 leituras, 13 escritas), no grupo de DOMÍNIO. Portão =
// catálogo, provado pela matriz de cada rota em `internal/conteudo`; vazamento e impersonado por
// `TestNadaVazaEntreContas` e `TestEscritasRecusamImpersonado`. O `POST /conteudo-trigger` NÃO entra: tem o
// portão da edge (PedeIA: sessão sem módulo = 403, TestNenhumaRotaNovaFicaAberta).
var rotas59 = []string{
	"GET /conteudo/pecas", "POST /conteudo/pecas", "PATCH /conteudo/pecas/{id}", "DELETE /conteudo/pecas/{id}",
	"GET /conteudo/arquivos", "POST /conteudo/arquivos", "PATCH /conteudo/arquivos/{id}", "DELETE /conteudo/arquivos/{id}",
	"GET /conteudo/eventos", "POST /conteudo/eventos",
	"GET /conteudo/ideias", "POST /conteudo/ideias", "PATCH /conteudo/ideias/{id}",
	"GET /conteudo/blocos", "POST /conteudo/blocos", "PATCH /conteudo/blocos/{id}",
	"GET /conteudo/concorrentes", "POST /conteudo/concorrentes", "PATCH /conteudo/concorrentes/{id}",
	"GET /conteudo/jobs",
}

// Plano 5.4 (+ Plano 12: POST e DELETE de termo): as 27 rotas de acessos.Montar (9 leituras, 18 escritas), no grupo de DOMÍNIO. Portão = catálogo,
// provado pela matriz de cada rota em `internal/acessos`; vazamento, impersonado e segredos por
// `TestNadaVazaParaQuemNaoTemAcessos`, `TestEscritasRecusamImpersonado` e `TestConexoesNuncaSaem`.
var rotas54 = []string{
	"GET /acessos/pessoas", "POST /acessos/pessoas", "PATCH /acessos/pessoas/{id}", "DELETE /acessos/pessoas/{id}",
	"POST /acessos/pessoas/{id}/ligar", "POST /acessos/log",
	"GET /acessos/organizacoes", "POST /acessos/organizacoes", "DELETE /acessos/organizacoes/{id}",
	"GET /acessos/setores", "POST /acessos/setores", "DELETE /acessos/setores/{id}",
	"GET /acessos/recursos", "GET /acessos/vinculos", "POST /acessos/vinculos", "GET /acessos/termos",
	"POST /acessos/termos", "DELETE /acessos/termos/{id}",
	// ACHADO 02-1: aba Drive do Acessos (3 tabelas)
	"GET /acessos/drive/marcas", "POST /acessos/drive/marcas", "DELETE /acessos/drive/marcas/{id}",
	"GET /acessos/drive/setores", "POST /acessos/drive/setores", "DELETE /acessos/drive/setores/{id}", "DELETE /acessos/drive/setores/{chave}/overrides",
	"GET /acessos/drive/overrides", "PUT /acessos/drive/overrides/{external_id}",
}

// Plano 12: as 7 leituras de atendimentos.Montar (Atendimentos, Base de Leads, Abandono de carrinho), no grupo de
// DOMÍNIO. Portão = catálogo tabela a tabela, provado pela matriz de `internal/atendimentos` (TestLeiturasPorPolicy).
var rotas512 = []string{
	"GET /vessel/atendimentos", "GET /vessel/pedidos", "GET /vessel/pessoas", "GET /vessel/origens",
	"GET /vessel/lista-espera", "GET /vessel/carrinho-eventos", "GET /vessel/checkout-abandono",
}

// Plano 5.10: as 6 leituras do selo. Portão = catálogo (is_vessel_admin), provado pela matriz de `internal/vessel`
// (TestLeiturasDoSelo, TestNadaVazaDoSelo). O cartão (POST /vessel-baixar-cartao, portão do selo DENTRO do handler)
// e a rota de robô da Fábrica NÃO entram: TestNenhumaRotaNovaFicaAberta prova o 403 sem módulo.
var rotas510 = []string{"GET /autenticidade/lotes", "GET /autenticidade/pecas", "GET /autenticidade/registros",
	"GET /autenticidade/baixas", "GET /autenticidade/cartao-pedidos", "GET /autenticidade/lembretes"}

// Plano 5.3: as 27 rotas de frota.Montar (11 leituras e 16 escritas), no grupo de DOMÍNIO. Portão = catálogo
// (is_frota_admin()), provado pela matriz de cada rota em `internal/frota`; vazamento e impersonado por
// `TestNadaVazaParaQuemNaoTemFrota` e `TestEscritasRecusamImpersonado` (lá). As 2 RPCs entram por
// POST /rpc/{nome} (lista branca); POST /avisar-decisao-de-reserva é do Plano 4 e fica onde está.
var rotas53 = []string{
	"GET /frota/veiculos", "POST /frota/veiculos", "PATCH /frota/veiculos/{id}",
	"GET /frota/usos", "POST /frota/usos", "PATCH /frota/usos/{id}", "POST /frota/usos/trocar",
	"GET /frota/requisicoes", "POST /frota/requisicoes", "PATCH /frota/requisicoes/{id}",
	"GET /frota/checklists", "POST /frota/checklists", "GET /frota/checklists/respostas", "GET /frota/checklists/copias",
	"GET /frota/checklist-itens", "POST /frota/checklist-itens", "PATCH /frota/checklist-itens/{id}",
	"GET /frota/checklist-config", "PATCH /frota/checklist-config",
	"GET /frota/plano-revisao", "POST /frota/plano-revisao", "PATCH /frota/plano-revisao/{id}",
	"GET /frota/revisoes", "DELETE /frota/revisoes/{id}",
	"POST /frota/manutencoes", "GET /frota/abastecimentos", "POST /frota/abastecimentos",
}

// Plano 5.5: as 18 rotas de vendas.Montar (14 leituras, 4 escritas), no grupo de DOMÍNIO. Portão = catálogo,
// provado pela matriz de `internal/vendas`; vazamento por `TestNadaVazaEntreLojas`/`TestTodaLeituraTemEscopoDeclarado`,
// impersonado por `TestEscritasRecusamImpersonado`.
var rotas55 = []string{
	"GET /comercial/lojas", "PATCH /comercial/lojas/{id}", "GET /comercial/depositos",
	"GET /comercial/metas-lojas", "GET /comercial/metas-vendedoras", "POST /comercial/metas/salvar",
	"GET /comercial/vendedoras", "POST /comercial/vendedoras/gravar",
	"GET /comercial/pedidos-vendedor", "POST /comercial/pedidos-vendedor/gravar",
	"GET /comercial/notas", "GET /comercial/ajustes-de-valor", "GET /comercial/ajustes-de-vendedor",
	"GET /comercial/formas-de-pagamento", "GET /comercial/estoque", "GET /comercial/vendas-por-item",
	"GET /comercial/briefings", "GET /comercial/pedidos-shopify",
}

func init() {
	for _, c := range slices.Concat(rotas51, rotas57, rotas52, rotas58, rotas59, rotas53, rotas55, rotas510, rotas54, rotas512) {
		soSessao[c] = true
	}
}

// Quem soma rotas ao grupo de domínio sem declarar aqui é pego: `rotas52` tem de ser EXATAMENTE as rotas
// /patrimonio/ montadas (nem mais, nem menos).
func TestRotasDoPatrimonioSaoAsDeclaradas(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	var montadas []string
	if err := chi.Walk(h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.HasPrefix(rota, "/patrimonio/") {
			montadas = append(montadas, metodo+" "+rota)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	slices.Sort(montadas)
	quer := slices.Clone(rotas52)
	slices.Sort(quer)
	if len(rotas52) != 30 || !slices.Equal(montadas, quer) {
		t.Errorf("rotas /patrimonio/ montadas = %d: %v\nesperadas (30): %v", len(montadas), montadas, quer)
	}
}

// Matriz completa 401/403/200 por rota pela montagem de produção: cada módulo abre SÓ as
// suas rotas (pega portão trocado, portão extra ou ausente). O core é um servidor falso.
func TestRotasProtegidasPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{CoreURL: coreFalso(t), CoreToken: "t"})
	toks := fixtureUsuarios(t, p, s)
	casos := []struct {
		metodo, caminho, corpo string
		quem                   []string // quem passa (200); admin passa em todas
	}{
		{"GET", "/eu/canais", "", []string{"nenhum", "so-meta", "so-social", "so-sales"}},
		{"GET", "/auth/eu", "", []string{"nenhum", "so-meta", "so-social", "so-sales"}},
		{"POST", "/bling-proxy", `{"endpoint":"pedidos/vendas"}`, []string{"so-sales"}},
		{"POST", "/meta-proxy", fmt.Sprintf(`{"accountId":%q,"path":"x"}`, conta), []string{"so-meta"}},
		{"POST", "/insights-ao-vivo", fmt.Sprintf(`{"account_id":%q}`, conta), []string{"so-social"}},
		{"POST", "/serie-novos-dia", fmt.Sprintf(`{"account_id":%q,"dias":[]}`, conta), []string{"so-social"}},
		{"POST", "/contar-collabs", fmt.Sprintf(`{"account_id":%q}`, conta), []string{"so-social"}},
	}
	pedir := func(metodo, caminho, corpo, tok string) int {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	for _, c := range casos {
		if got := pedir(c.metodo, c.caminho, c.corpo, ""); got != 401 {
			t.Errorf("%s %s sem sessão = %d, esperava 401", c.metodo, c.caminho, got)
		}
		for _, quem := range []string{"nenhum", "so-meta", "so-social", "so-sales", "admin"} {
			quer := 403
			if quem == "admin" || slices.Contains(c.quem, quem) {
				quer = 200
			}
			if got := pedir(c.metodo, c.caminho, c.corpo, toks[quem]); got != quer {
				t.Errorf("%s %s como %s = %d, esperava %d", c.metodo, c.caminho, quem, got, quer)
			}
		}
	}
}

// Ruling 34 pela montagem de produção: o autz.ComEscopo das 4 rotas ao vivo está ligado. Sem ele, o
// so-meta (allowed_accounts nulo = todas) cairia em 400 por escopo ausente (falha fechada): o teste acusa.
func TestEscopoDeContasPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{CoreURL: coreFalso(t), CoreToken: "t"})
	toks := fixtureUsuarios(t, p, s)
	ctx := context.Background()
	const restrito = "44444444-4444-4444-4444-444444444444"
	if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'meta-restrito@x.com')`, restrito); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into profiles (id, email, role, features, escopo_por_equipe, allowed_accounts)
		values ($1::uuid, 'meta-restrito@x.com', 'viewer', '{meta,social}', false, '{outra-conta}')`, restrito); err != nil {
		t.Fatal(err)
	}
	toks["meta-restrito"], _ = s.Criar(ctx, restrito, "painel", nil)
	pedir := func(caminho, corpo, tok string) (int, string) {
		r := httptest.NewRequest("POST", caminho, strings.NewReader(corpo))
		r.Header.Set("Authorization", "Bearer "+tok)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, w.Body.String()
	}
	proxy := fmt.Sprintf(`{"accountId":%q,"path":"/act_1/insights"}`, conta)
	if st, resp := pedir("/meta-proxy", proxy, toks["so-meta"]); st == 400 {
		t.Errorf("so-meta (sem lista) no /meta-proxy: %d %s (o ComEscopo da montagem?)", st, resp)
	}
	if st, resp := pedir("/meta-proxy", proxy, toks["meta-restrito"]); st != 400 || strings.TrimSpace(resp) != `{"error":"conta nao encontrada"}` {
		t.Errorf("meta-restrito no /meta-proxy: %d %s", st, resp)
	}
	ao := fmt.Sprintf(`{"account_id":%q}`, conta)
	if st, resp := pedir("/insights-ao-vivo", ao, toks["so-social"]); st == 404 {
		t.Errorf("so-social no /insights-ao-vivo: %d %s", st, resp)
	}
	if st, resp := pedir("/insights-ao-vivo", ao, toks["meta-restrito"]); st != 404 || !strings.Contains(resp, "conta não encontrada") {
		t.Errorf("meta-restrito no /insights-ao-vivo: %d %s", st, resp)
	}
}

// As rotas de /redes pela montagem de produção (esquema de produção): sem sessão 401; a pessoa com lista
// só vê A1; a admin vê as duas; a escrita da limitada em A2 é 403 (o redes.Montar está no grupo com ComEscopo).
func TestRedesPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{CoreURL: coreFalso(t), CoreToken: "t"})
	ctx := context.Background()
	const a1, a2 = "a5600000-0000-4000-a000-0000000000a1", "a5600000-0000-4000-a000-0000000000a2"
	const limitada, admin = "a5620000-0000-4000-a000-000000000001", "a5620000-0000-4000-a000-000000000002"
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := p.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`insert into usuarios (id, email) values ($1::uuid, 'limitada@x.com'), ($2::uuid, 'admin@x.com')`, limitada, admin)
	exec(`insert into profiles (id, email, role, features, escopo_por_equipe, allowed_accounts) values
		($1::uuid, 'limitada@x.com', 'viewer', '{social}', false, array[$3::uuid]),
		($2::uuid, 'admin@x.com', 'admin', '{social}', false, null)`, limitada, admin, a1)
	exec(`insert into accounts (id, name, username, instagram_id) values ($1::uuid, 'Vessel', 'vessel', '1784'), ($2::uuid, 'Mantova', 'mantova', '1785')`, a1, a2)
	exec(`insert into engagement_snapshots (account_id, captured_at, period_days, likes) values
		($1::uuid, '2026-10-11', 7, 10), ($2::uuid, '2026-10-11', 7, 30)`, a1, a2)
	tokL, _ := s.Criar(ctx, limitada, "painel", nil)
	tokA, _ := s.Criar(ctx, admin, "painel", nil)
	pedir := func(metodo, caminho, corpo, tok string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, w.Body.String()
	}
	if st, b := pedir("GET", "/redes/engajamento", "", ""); st != 401 {
		t.Errorf("sem sessão = %d %s", st, b)
	}
	if st, b := pedir("GET", "/redes/engajamento", "", tokL); st != 200 || !strings.Contains(b, a1) || strings.Contains(b, a2) {
		t.Errorf("limitada = %d %s (esperava só A1)", st, b)
	}
	if st, b := pedir("GET", "/redes/engajamento", "", tokA); st != 200 || !strings.Contains(b, a1) || !strings.Contains(b, a2) {
		t.Errorf("admin = %d %s (esperava as duas)", st, b)
	}
	meta := func(conta string) string {
		return `{"metas":[{"account_id":"` + conta + `","periodo":"1","indicador":"seguidores","valor":1}]}`
	}
	if st, b := pedir("PUT", "/redes/metas", meta(a2), tokL); st != 403 {
		t.Errorf("limitada gravando meta de A2 = %d %s, esperava 403", st, b)
	}
	if st, b := pedir("PUT", "/redes/metas", meta(a1), tokL); st/100 != 2 {
		t.Errorf("limitada gravando meta de A1 = %d %s, esperava 2xx", st, b)
	}
}

// Prazos pela montagem real: percorre as rotas e, nos middlewares embutidos de cada uma,
// confere que o de prazo dá o deadline esperado (contar-collabs 120 s, as outras ao vivo 90 s)
// e que nenhuma outra rota ganha prazo sem constar aqui.
func TestPrazosPorRotaPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	quer := map[string]time.Duration{"POST /bling-proxy": 90 * time.Second, "POST /insights-ao-vivo": 90 * time.Second, "POST /serie-novos-dia": 90 * time.Second, "POST /contar-collabs": 120 * time.Second,
		// Plano 5.0: o grupo de domínio inteiro (e o /rpc) tem prazo; rota de domínio nova herda
		"POST /rpc/{nome}": PrazoDominio,
		// Plano 5.12: leituras do grupo de domínio
		"GET /noticias/rodadas": PrazoDominio, "GET /noticias/concorrentes": PrazoDominio,
		"GET /noticias/panorama": PrazoDominio, "GET /status-ia/execucoes": PrazoDominio,
		"GET /status-ia/saude-dos-robos": PrazoDominio,
		// Plano 5.12: fatura real das contas de IA (grupo autenticado, FORA do de domínio)
		"POST /custo-anthropic": 90 * time.Second, "POST /custo-openai": 90 * time.Second,
		// Plano 5.7: proxies no grupo de SESSÃO, com prazo próprio (o de domínio cortaria a IA)
		"POST /sugerir-publico-ia": PrazoIA, "POST /ler-documento": PrazoIA, "POST /buscar-lugar": PrazoMapa,
		// Plano 5.10: o cartão EAN do Zoho, no grupo de SESSÃO com prazo próprio
		"POST /vessel-baixar-cartao": PrazoCartao}
	for _, c := range slices.Concat(rotas51, rotas57, rotas52, rotas59, rotas53, rotas55, rotas510, rotas54, rotas512, []string{"POST /conteudo-trigger"}) { // Planos 5.1, 5.7, 5.2, 5.9, 5.3, 5.5, 5.10, 5.4 e 12: no grupo de domínio, com o prazo dele
		quer[c] = PrazoDominio
	}
	vistos := map[string]bool{}
	chi.Walk(h.(chi.Routes), func(metodo, rota string, _ http.Handler, mws ...func(http.Handler) http.Handler) error {
		chave := metodo + " " + rota
		var achado time.Duration
		for _, mw := range mws {
			mw(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				if dl, ok := r.Context().Deadline(); ok {
					achado = time.Until(dl).Round(time.Second)
				}
			})).ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/", nil))
		}
		if strings.HasPrefix(rota, "/redes/") || strings.HasPrefix(rota, "/fabrica") { // Planos 5.6 e 5.8: o grupo de domínio inteiro herda o prazo
			if achado != PrazoDominio {
				t.Errorf("%s: prazo %v, esperava %v (PrazoDominio)", chave, achado, PrazoDominio)
			}
			return nil
		}
		if q, ok := quer[chave]; ok {
			vistos[chave] = true
			if achado != q {
				t.Errorf("%s: prazo %v, esperava %v", chave, achado, q)
			}
		} else if achado != 0 {
			t.Errorf("%s ganhou prazo %v fora da lista", chave, achado)
		}
		return nil
	})
	if len(vistos) != len(quer) {
		t.Errorf("rotas com prazo não montadas: %v", vistos)
	}
	// o WriteTimeout do servidor (main.go usa EscritaDoServidor): cada prazo de rota termina com folga ANTES dele
	if EscritaDoServidor != 150*time.Second {
		t.Errorf("EscritaDoServidor = %v: as NOTAS dizem 150 s (PrazoCollabs + 30 s)", EscritaDoServidor)
	}
	for chave, d := range quer {
		if d+30*time.Second > EscritaDoServidor {
			t.Errorf("%s: prazo %v sem 30 s de folga antes do WriteTimeout do servidor (%v): a conexão cairia antes do 504", chave, d, EscritaDoServidor)
		}
	}
	if PrazoDominio >= 60*time.Second {
		t.Errorf("PrazoDominio %v: o proxy_read_timeout padrão do nginx (60 s) cortaria a resposta antes do 504 da API", PrazoDominio)
	}
}

// meta-proxy: o prazo é do handler (25 s; 45 s com imagem; 75 s com vídeo), visto no
// contexto da chamada ao core pela montagem real.
type gravaPrazo struct{ prazo *time.Duration }

func (g gravaPrazo) RoundTrip(r *http.Request) (*http.Response, error) {
	if dl, ok := r.Context().Deadline(); ok {
		*g.prazo = time.Until(dl).Round(time.Second)
	}
	return &http.Response{StatusCode: 200, Header: http.Header{}, Body: io.NopCloser(strings.NewReader(`{"data":[]}`)), Request: r}, nil
}

func TestMetaProxyPrazosPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	var visto time.Duration
	antigo := http.DefaultTransport
	http.DefaultTransport = gravaPrazo{&visto}
	t.Cleanup(func() { http.DefaultTransport = antigo })
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{CoreURL: "http://core.invalido", CoreToken: "t", HostsDeMidia: []string{"m.exemplo"}})
	tok := fixtureUsuarios(t, p, s)["so-meta"]
	for _, c := range []struct {
		extra string
		quer  time.Duration
	}{{``, 25 * time.Second}, {`,"imageFromUrl":"https://m.exemplo/a.jpg"`, 45 * time.Second}, {`,"videoFromUrl":"https://m.exemplo/a.mp4"`, 75 * time.Second}} {
		visto = 0
		r := httptest.NewRequest("POST", "/meta-proxy", strings.NewReader(fmt.Sprintf(`{"accountId":%q,"path":"x"%s}`, conta, c.extra)))
		r.Header.Set("Authorization", "Bearer "+tok)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 || visto != c.quer {
			t.Errorf("%q: status %d, prazo %v, esperava 200 e %v", c.extra, w.Code, visto, c.quer)
		}
	}
}

// Limite por IP nos webhooks (Ruling 31: 600/min). O IP vem do X-Real-IP SÓ quando o par é o
// nginx (privado/loopback); X-Forwarded-For e cabeçalhos de cliente nunca valem.
func TestLimiteDeIPNosWebhooks(t *testing.T) {
	p := testebanco.Novo(t)
	novo := func() http.Handler {
		return Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	}
	pedir := func(h http.Handler, peer string, cab map[string]string, i int) int {
		r := httptest.NewRequest("POST", webhooksPublicos()[i%5], strings.NewReader(`{}`))
		r.RemoteAddr = peer + ":4000"
		for k, v := range cab {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	// par público forjando cabeçalhos: o balde é o do par, compartilhado pelas 5 rotas
	h := novo()
	for i := 0; i < 600; i++ {
		if got := pedir(h, "203.0.113.9", map[string]string{"X-Real-IP": fmt.Sprintf("198.51.100.%d", i%250), "X-Forwarded-For": fmt.Sprintf("9.9.9.%d", i%250)}, i); got != 401 {
			t.Fatalf("requisição %d = %d, esperava 401", i, got)
		}
	}
	if got := pedir(h, "203.0.113.9", map[string]string{"X-Real-IP": "198.51.100.200"}, 0); got != 429 {
		t.Fatalf("601ª do mesmo par com X-Real-IP trocado = %d, esperava 429 (spoof)", got)
	}
	// via nginx (loopback): cada X-Real-IP tem o seu balde; XFF é ignorado
	h = novo()
	for i := 0; i < 600; i++ {
		pedir(h, "127.0.0.1", map[string]string{"X-Real-IP": "198.51.100.1", "X-Forwarded-For": fmt.Sprintf("9.9.9.%d", i%250)}, i)
	}
	if got := pedir(h, "127.0.0.1", map[string]string{"X-Real-IP": "198.51.100.1", "X-Forwarded-For": "7.7.7.7"}, 0); got != 429 {
		t.Fatalf("601ª do mesmo X-Real-IP via nginx = %d, esperava 429 (XFF não pode abrir balde novo)", got)
	}
	if got := pedir(h, "127.0.0.1", map[string]string{"X-Real-IP": "198.51.100.2"}, 0); got != 401 {
		t.Fatalf("outro IP real via nginx = %d, esperava 401 (balde próprio)", got)
	}
}

// Prazo por requisição das rotas lentas da Meta: o contexto que chega ao handler tem deadline.
func TestComPrazoPoeDeadlineNoContexto(t *testing.T) {
	var dl time.Time
	var tem bool
	h := comPrazo(PrazoCollabs)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { dl, tem = r.Context().Deadline() }))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/x", nil))
	if !tem || time.Until(dl) < PrazoCollabs-5*time.Second || time.Until(dl) > PrazoCollabs {
		t.Fatalf("deadline = %v (tem=%v)", time.Until(dl), tem)
	}
}

// Plano 4: avisar-decisao-de-reserva pela montagem real. O corpo vazio dá 400 DEPOIS do portão: quem
// recebe 400 passou; quem recebe 403 parou nele (mata um portão montado com a permissão errada). O
// portão é o da edge: superadmin ou permissions['frota.aprovar'] com 'ver'. Papel admin, módulo e
// outra permissão da Frota NÃO abrem.
func TestAvisarDecisaoDeReservaPeloPortaoReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	toks := map[string]string{}
	for i, u := range []struct {
		nome, perm, role string
		super            bool
	}{
		{"aprova", `{"frota.aprovar":["ver"]}`, "viewer", false}, {"frota-ver", `{"frota":["ver"]}`, "viewer", false},
		{"aprova-editar", `{"frota.aprovar":["editar"]}`, "viewer", false}, {"papel-admin", `{}`, "admin", false},
		{"super", `{}`, "viewer", true}, {"sem-nada", `{}`, "viewer", false},
	} {
		id := fmt.Sprintf("22222222-2222-2222-2222-22222222222%d", i)
		p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $1::text || '@x')`, id)
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, is_superadmin, permissions) values ($1::uuid, $1::text || '@x', $2::text, $3::boolean, $4::jsonb)`,
			id, u.role, u.super, u.perm); err != nil {
			t.Fatal(err)
		}
		toks[u.nome], _ = s.Criar(ctx, id, "painel", nil)
	}
	pedir := func(tok string) int {
		r := httptest.NewRequest("POST", "/avisar-decisao-de-reserva", strings.NewReader(`{}`))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	if got := pedir(""); got != 401 {
		t.Errorf("sem sessão = %d, esperava 401", got)
	}
	for nome, quer := range map[string]int{"aprova": 400, "super": 400, "frota-ver": 403, "aprova-editar": 403, "papel-admin": 403, "sem-nada": 403} {
		if got := pedir(toks[nome]); got != quer {
			t.Errorf("%s = %d, esperava %d", nome, got, quer)
		}
	}
	// Só POST: o resto é 405 do roteador, nunca chega ao handler.
	for _, m := range []string{"GET", "PUT", "DELETE"} {
		r := httptest.NewRequest(m, "/avisar-decisao-de-reserva", nil)
		r.Header.Set("Authorization", "Bearer "+toks["aprova"])
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 405 {
			t.Errorf("%s = %d, esperava 405", m, w.Code)
		}
	}
}

// Plano 5.0 pela montagem real: os links de senha respondem sem sessão; as rotas da conta exigem
// sessão de painel e, para quem não é admin/super-admin, devolvem a frase da edge.
func TestContaPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{EnderecosDoApp: []string{"https://central.exemplo"}, EnderecoPadrao: "https://central.exemplo"})
	viewer := fixtureUsuarios(t, p, s)["nenhum"]
	ctx := context.Background()
	const cliente = "77777777-7777-4777-a777-777777777777"
	p.Exec(ctx, `insert into usuarios (id, email) values ($1, 'cliente@x.com')`, cliente)
	tokCliente, _ := s.Criar(ctx, cliente, "cliente", nil)
	pedir := func(metodo, caminho, corpo, tok string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	casos := []struct {
		metodo, caminho, corpo, tok string
		status                      int
		trecho                      string
	}{
		{"POST", "/auth/esqueci-senha", `{"email":"ninguem@x.com"}`, "", 202, `{"ok":true}`},
		{"POST", "/auth/definir-senha", `{"token":"inventado","senha":"senha-boa"}`, "", 400, "token_invalido"},
		{"POST", "/invite-user", `{"email":"a@x.com"}`, viewer, 400, "Apenas administradores"},
		{"POST", "/entrar-como-usuario", `{"alvoId":"` + conta + `"}`, viewer, 400, "Apenas super-admin"},
		{"POST", "/conferir-senha", `{}`, viewer, 400, "sem_senha"},
		{"POST", "/auth/trocar-senha", `{"senha":"1"}`, viewer, 400, "senha_invalida"},
		{"GET", "/eu/perfil", ``, viewer, 200, `"role":"viewer"`},
		// nome que nenhum sub-plano registra: o /rpc só responde para o que está na lista branca
		{"POST", "/rpc/funcao_que_ninguem_registra", `{}`, viewer, 404, "nao_encontrado"},
		{"POST", "/invite-user", `{}`, tokCliente, 403, "sem_permissao"},
		{"POST", "/rpc/qualquer", `{}`, "", 401, "nao_autenticado"},
	}
	for _, c := range casos {
		if st, corpo := pedir(c.metodo, c.caminho, c.corpo, c.tok); st != c.status || !strings.Contains(corpo, c.trecho) {
			t.Errorf("%s %s = %d %s, esperava %d com %q", c.metodo, c.caminho, st, corpo, c.status, c.trecho)
		}
	}
}

// Os caminhos FELIZES da conta pela montagem real (200/204 de verdade, com efeito no banco): quem
// tem o portão passa; o mesmo corpo sem ele já foi recusado acima.
func TestContaCaminhosFelizesPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{EnderecosDoApp: []string{"https://central.exemplo"}, EnderecoPadrao: "https://central.exemplo"})
	toks := fixtureUsuarios(t, p, s)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table entradas_como_outro_usuario (
		id uuid primary key default gen_random_uuid(),
		admin_id uuid not null references profiles(id), admin_email text not null,
		alvo_id uuid not null references profiles(id), alvo_email text not null,
		criado_em timestamptz not null default now())`); err != nil {
		t.Fatal(err)
	}
	const super, alvo = "99999999-9999-4999-a999-999999999991", "99999999-9999-4999-a999-999999999992"
	hash, err := auth.HashDaSenha("senha-do-super")
	if err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `insert into usuarios (id, email, senha_hash) values ($1::uuid, 'super@x.com', $2::text), ($3::uuid, 'alvo@x.com', null)`, super, hash, alvo)
	p.Exec(ctx, `insert into profiles (id, email, role, is_superadmin, escopo_por_equipe) values ($1::uuid, 'super@x.com', 'admin', true, false), ($2::uuid, 'alvo@x.com', 'viewer', false, false)`, super, alvo)
	toks["super"], _ = s.Criar(ctx, super, "painel", nil)
	pedir := func(metodo, caminho, corpo, tok string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		r.Header.Set("Authorization", "Bearer "+tok)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	for _, c := range []struct {
		metodo, caminho, corpo, quem string
		status                       int
		trecho                       string
	}{
		{"GET", "/auth/eu", ``, "nenhum", 200, `"id"`},
		{"GET", "/eu/perfil", ``, "nenhum", 200, `"role":"viewer"`},
		{"POST", "/conferir-senha", `{"senha":"senha-do-super"}`, "super", 200, `{"ok":true}`},
		{"POST", "/invite-user", `{"email":"nova@x.com","password":"senha-boa-123"}`, "admin", 200, `{"success":true}`},
		{"POST", "/entrar-como-usuario", `{"alvoId":"` + alvo + `"}`, "super", 200, `"expira_em"`},
		{"POST", "/auth/trocar-senha", `{"senha":"outra-senha-boa"}`, "nenhum", 204, ``},
	} {
		if st, corpo := pedir(c.metodo, c.caminho, c.corpo, toks[c.quem]); st != c.status || !strings.Contains(corpo, c.trecho) {
			t.Errorf("%s %s como %s = %d %s, esperava %d com %q", c.metodo, c.caminho, c.quem, st, corpo, c.status, c.trecho)
		}
	}
	var n int
	p.QueryRow(ctx, `select (select count(*) from usuarios where email = 'nova@x.com') + (select count(*) from entradas_como_outro_usuario where alvo_id = $1::uuid)`, alvo).Scan(&n)
	if n != 2 {
		t.Errorf("efeitos no banco = %d, esperava 2 (conta nova + auditoria de entrar como)", n)
	}
}

// POST /rpc/{nome} pela montagem real, com uma função registrada de verdade (movida de pendente para
// registrada, como cada sub-plano fará): 401 sem sessão, 403 sem o portão (e a função NÃO roda), 200 com
// ele, 404 para nome não registrado, e o portão vem antes da validação do corpo.
func TestRPCRegistradaPelaMontagemReal(t *testing.T) {
	original, pendentes := FuncoesRPC, RPCPendentes
	// RPCPendentes está vazia desde o 5.11: a função de teste TROCA uma registrada de verdade (mesmo nome, portão e
	// parâmetro de teste), o que mantém a soma de TotalRPCDoPainel.
	const nome = "vessel_pracas_listar"
	t.Cleanup(func() { FuncoesRPC, RPCPendentes = original, pendentes })
	FuncoesRPC = append(slices.DeleteFunc(slices.Clone(original), func(f rpc.Funcao) bool { return f.Nome == nome }),
		rpc.Funcao{Nome: nome, Params: []rpc.Param{{Nome: "p_n", Tipo: "integer"}}, Retorno: rpc.Valor, Portao: autz.SuperFicha})
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	toks := fixtureUsuarios(t, p, s)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table marca (n int);
		create function `+nome+`(p_n integer) returns integer language plpgsql as $$ begin insert into marca values (p_n); return p_n + 1; end $$`); err != nil {
		t.Fatal(err)
	}
	const super = "99999999-9999-4999-a999-999999999993"
	p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'super-rpc@x.com')`, super)
	p.Exec(ctx, `insert into profiles (id, email, role, is_superadmin, escopo_por_equipe) values ($1::uuid, 'super-rpc@x.com', 'viewer', true, false)`, super)
	toks["super"], _ = s.Criar(ctx, super, "painel", nil)
	pedir := func(caminho, corpo, quem string) (int, string) {
		r := httptest.NewRequest("POST", caminho, strings.NewReader(corpo))
		if quem != "" {
			r.Header.Set("Authorization", "Bearer "+toks[quem])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	for _, c := range []struct {
		caminho, corpo, quem string
		status               int
		trecho               string
	}{
		{"/rpc/" + nome, `{"p_n":1}`, "", 401, "nao_autenticado"},
		{"/rpc/" + nome, `{"p_n":1}`, "nenhum", 403, "sem_permissao"},
		{"/rpc/" + nome, `lixo`, "nenhum", 403, "sem_permissao"}, // o portão vem antes do corpo
		{"/rpc/" + nome, `{"p_n":1}`, "admin", 403, "sem_permissao"},
		{"/rpc/" + nome, `{"p_n":1}`, "super", 200, "2"},
		{"/rpc/" + nome, `{}`, "super", 400, "pedido_invalido"},
		{"/rpc/outra_funcao", `{"p_n":1}`, "super", 404, "nao_encontrado"},
	} {
		if st, corpo := pedir(c.caminho, c.corpo, c.quem); st != c.status || !strings.Contains(corpo, c.trecho) {
			t.Errorf("%s %s como %q = %d %s, esperava %d com %q", c.caminho, c.corpo, c.quem, st, corpo, c.status, c.trecho)
		}
	}
	var n int
	p.QueryRow(ctx, `select count(*) from marca`).Scan(&n)
	if n != 1 {
		t.Errorf("a função rodou %d vez(es), esperava 1 (só a do super-admin)", n)
	}
}

// Plano 5.1 pela montagem real: sem sessão é 401, o portão é o do catálogo (viewer não muda a conta do
// admin; só o admin lê pedidos de acesso), o pedido de acesso é público e o health check não depende de
// sessão. A matriz de cada rota está em internal/acesso; aqui vale a MONTAGEM (grupo, cadeia, posição).
func TestAcessoPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	const admin, viewer = "5e000000-0000-4000-a000-0000000000a1", "5e000000-0000-4000-a000-0000000000a2"
	for _, u := range [][3]string{{admin, "admin-51@x.com", "admin"}, {viewer, "viewer-51@x.com", "viewer"}} {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, u[0], u[1]); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, escopo_por_equipe) values ($1::uuid, $2::text, $2::text, $3::text, false)`, u[0], u[1], u[2]); err != nil {
			t.Fatal(err)
		}
	}
	tok := map[string]string{}
	for nome, id := range map[string]string{"admin": admin, "viewer": viewer} {
		var err error
		if tok[nome], err = s.Criar(ctx, id, "painel", nil); err != nil {
			t.Fatal(err)
		}
	}
	pedir := func(quem, metodo, caminho, corpo string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		r.Header.Set("Content-Type", "application/json")
		if quem != "" {
			r.Header.Set("Authorization", "Bearer "+tok[quem])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	for _, c := range []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		trecho                             string
	}{
		{"usuários sem sessão", "", "GET", "/acesso/usuarios", "", 401, "nao_autenticado"},
		{"conferências exigem sessão", "", "GET", "/saude/conferencias", "", 401, "nao_autenticado"},
		{"o health check segue público", "", "GET", "/saude", "", 200, "ok"},
		{"viewer não muda a conta do admin", "viewer", "PATCH", "/acesso/usuarios/" + admin, `{"disabled":true}`, 403, "sem_permissao"},
		{"viewer lê pedidos: a regra devolve lista vazia", "viewer", "GET", "/acesso/pedidos", "", 200, "[]"},
		{"admin lê os times", "admin", "GET", "/equipes/times", "", 200, "["},
		{"pedir acesso é público", "", "POST", "/pedir-acesso", `{"name":"Fulana","email":"fulana@x.com","message":"oi"}`, 201, `"id"`},
	} {
		if st, corpo := pedir(c.quem, c.metodo, c.caminho, c.corpo); st != c.status || !strings.Contains(corpo, c.trecho) {
			t.Errorf("%s: %s %s = %d %s, esperava %d com %q", c.nome, c.metodo, c.caminho, st, corpo, c.status, c.trecho)
		}
	}
	var off bool
	if err := p.QueryRow(ctx, `select disabled from profiles where id = $1::uuid`, admin).Scan(&off); err != nil || off {
		t.Errorf("o PATCH negado mexeu em profiles.disabled (%v, %v)", off, err)
	}
	var n int
	if err := p.QueryRow(ctx, `select count(*) from access_requests where email = 'fulana@x.com' and status = 'pending'`).Scan(&n); err != nil || n != 1 {
		t.Errorf("pedidos gravados = %d (%v), esperava 1", n, err)
	}
}

// Plano 5.4 pela montagem real: sem sessão é 401, quem não tem a feature lê `[]` e não muda nada, e a feature
// `acessos` sozinha cadastra mas não exclui (papel viewer). A matriz de cada rota está em internal/acessos;
// aqui vale a MONTAGEM (grupo de domínio, cadeia, posição).
func TestAcessosPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	const acessos, viewer = "a5400000-0000-4000-a000-0000000000a1", "a5400000-0000-4000-a000-0000000000a2"
	tok := map[string]string{}
	for _, u := range []struct{ nome, id, features string }{{"acessos", acessos, "{acessos}"}, {"viewer", viewer, "{}"}} {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, u.id, u.nome+"-54@x.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, features, escopo_por_equipe) values ($1::uuid, $2::text, $2::text, 'viewer', $3::text[], false)`,
			u.id, u.nome+"-54@x.com", u.features); err != nil {
			t.Fatal(err)
		}
		var err error
		if tok[u.nome], err = s.Criar(ctx, u.id, "painel", nil); err != nil {
			t.Fatal(err)
		}
	}
	pedir := func(quem, metodo, caminho, corpo string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		r.Header.Set("Content-Type", "application/json")
		if quem != "" {
			r.Header.Set("Authorization", "Bearer "+tok[quem])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	st, corpo := pedir("acessos", "POST", "/acessos/pessoas", `{"nome":"Teste"}`)
	if st != 201 {
		t.Fatalf("acessos cadastra = %d %s", st, corpo)
	}
	var id string
	if err := p.QueryRow(ctx, `select id::text from acessos_pessoas where nome = 'Teste'`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		trecho                             string
	}{
		{"sem sessão", "", "GET", "/acessos/pessoas", "", 401, "nao_autenticado"},
		{"viewer lê lista vazia", "viewer", "GET", "/acessos/pessoas", "", 200, "[]"},
		{"viewer não edita a ficha", "viewer", "PATCH", "/acessos/pessoas/" + id, `{"cargo":"x"}`, 404, "nao_encontrado"},
		{"acessos lê a ficha", "acessos", "GET", "/acessos/pessoas", "", 200, "Teste"},
		{"acessos sozinho não exclui", "acessos", "DELETE", "/acessos/pessoas/" + id, "", 403, "Só admin pode excluir."},
		{"acessos sozinho não liga ficha a login", "acessos", "POST", "/acessos/pessoas/" + id + "/ligar", `{"profile_id":"` + viewer + `"}`, 403, "Só admin pode ligar."},
	} {
		if st, corpo := pedir(c.quem, c.metodo, c.caminho, c.corpo); st != c.status || !strings.Contains(corpo, c.trecho) {
			t.Errorf("%s: %s %s = %d %s, esperava %d com %q", c.nome, c.metodo, c.caminho, st, corpo, c.status, c.trecho)
		}
	}
	var cargo *string
	var n int
	if err := p.QueryRow(ctx, `select cargo, (select count(*) from acessos_pessoas) from acessos_pessoas where id = $1::uuid`, id).Scan(&cargo, &n); err != nil || cargo != nil || n != 1 {
		t.Errorf("os pedidos negados mexeram no cadastro (cargo=%v, linhas=%d, %v)", cargo, n, err)
	}
}

// Plano 5.7 pela montagem real: a cadeia do grupo de domínio (sessão, escopo, prazo) nas leituras e na RPC,
// e o portão e o escopo dos três proxies no grupo de sessão. A matriz de cada rota está em internal/trafego,
// internal/ia e internal/mapa; aqui vale a MONTAGEM. Sem chave de IA e sem ligar a nada de fora: o 503 e o 400
// provam que o pedido passou do portão e do escopo e parou antes do externo.
func TestTrafegoPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	const a1, a2 = "a5700000-0000-4000-a000-0000000000a1", "a5700000-0000-4000-a000-0000000000a2"
	quem := map[string]string{}
	for i, u := range []struct{ nome, papel, features, contas string }{
		{"gestor-a1", "viewer", "{meta,meta.gestor}", "{" + a1 + "}"}, {"admin", "admin", "{}", ""},
		{"so-meta", "viewer", "{meta}", ""}, {"nenhum", "viewer", "{}", ""},
	} {
		id := fmt.Sprintf("a5710000-0000-4000-a000-00000000010%d", i)
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, id, u.nome+"@x.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, features, escopo_por_equipe, allowed_accounts)
			values ($1::uuid, $2::text, $2::text, $3::text, $4::text[], false, nullif($5::text, '')::uuid[])`,
			id, u.nome+"@x.com", u.papel, u.features, u.contas); err != nil {
			t.Fatal(err)
		}
		var err error
		if quem[u.nome], err = s.Criar(ctx, id, "painel", nil); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := p.Exec(ctx, `insert into gt_budget_analises (campaign_id, account_id, veredito) values ('9001', $1::text, 'escalar'), ('9002', $2::text, 'reduzir')`, a1, a2); err != nil {
		t.Fatal(err)
	}
	pedir := func(nome, metodo, caminho, corpo string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		r.Header.Set("Content-Type", "application/json")
		if nome != "" {
			r.Header.Set("Authorization", "Bearer "+quem[nome])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	for _, c := range []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		tem, naoTem                        string
	}{
		{"leitura sem sessão", "", "GET", "/gestao-trafego/analises-de-orcamento", "", 401, "nao_autenticado", ""},
		{"gestor com lista só vê a própria conta", "gestor-a1", "GET", "/gestao-trafego/analises-de-orcamento", "", 200, a1, a2},
		{"admin vê as duas", "admin", "GET", "/gestao-trafego/analises-de-orcamento", "", 200, a2, ""},
		{"RPC com conta que não se vê", "gestor-a1", "POST", "/rpc/gt_registrar_problemas", `{"p_conta":"` + a2 + `","p_itens":[]}`, 403, "sem_permissao", ""},
		{"RPC com a conta da lista", "gestor-a1", "POST", "/rpc/gt_registrar_problemas", `{"p_conta":"` + a1 + `","p_itens":[]}`, 200, "0", ""},
		{"IA sem o módulo do gestor", "so-meta", "POST", "/sugerir-publico-ia", `{"evidencia":{},"contaId":"` + a1 + `"}`, 403, "sem_permissao", ""},
		{"IA passa o portão e o escopo e para sem chave", "gestor-a1", "POST", "/sugerir-publico-ia", `{"evidencia":{},"contaId":"` + a1 + `"}`, 503, "chave_nao_configurada", ""},
		{"documento sem o módulo do gestor", "so-meta", "POST", "/ler-documento", `{}`, 403, "sem_permissao", ""},
		{"mapa sem o módulo meta", "nenhum", "POST", "/buscar-lugar", `{"acao":"buscar","termo":"praça"}`, 403, "sem_permissao", ""},
		{"mapa passa o portão e para na ação, sem ligar ao Nominatim", "so-meta", "POST", "/buscar-lugar", `{"acao":"apagar"}`, 400, "acao desconhecida", ""},
	} {
		st, corpo := pedir(c.quem, c.metodo, c.caminho, c.corpo)
		if st != c.status || !strings.Contains(corpo, c.tem) || (c.naoTem != "" && strings.Contains(corpo, c.naoTem)) {
			t.Errorf("%s: %s %s como %q = %d %s, esperava %d com %q e sem %q", c.nome, c.metodo, c.caminho, c.quem, st, corpo, c.status, c.tem, c.naoTem)
		}
	}
}

// Plano 5.2 pela montagem real: a cadeia do grupo de domínio (sessão, escopo, prazo) nas rotas do Patrimônio e
// o registro das RPCs em web.FuncoesRPC. A matriz de cada rota está em internal/patrimonio; aqui vale a
// MONTAGEM (grupo, cadeia, posição). `pat` tem o módulo; `viewer` não tem nada.
func TestPatrimonioPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	tok := map[string]string{}
	for _, u := range []struct{ id, nome, features string }{
		{"5e200000-0000-4000-a000-0000000010a1", "pat", "{patrimonio}"}, {"5e200000-0000-4000-a000-0000000010a2", "viewer", "{}"},
	} {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, u.id, u.nome+"-52@x.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, features, escopo_por_equipe) values ($1::uuid, $2::text, $3::text, 'viewer', $4::text[], false)`,
			u.id, u.nome+"-52@x.com", u.nome, u.features); err != nil {
			t.Fatal(err)
		}
		var err error
		if tok[u.nome], err = s.Criar(ctx, u.id, "painel", nil); err != nil {
			t.Fatal(err)
		}
	}
	pedir := func(quem, metodo, caminho, corpo string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		r.Header.Set("Content-Type", "application/json")
		if quem != "" {
			r.Header.Set("Authorization", "Bearer "+tok[quem])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	empresas := func() string {
		var n int
		if err := p.QueryRow(ctx, `select count(*) from patrimonio_empresas`).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return fmt.Sprint(n)
	}
	for _, c := range []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		tem                                string
		empresas                           string // linhas em patrimonio_empresas DEPOIS do caso
	}{
		{"leitura sem sessão", "", "GET", "/patrimonio/bens", "", 401, "nao_autenticado", "0"},
		{"viewer lê a lista vazia (a regra devolve 200 [])", "viewer", "GET", "/patrimonio/bens", "", 200, "[]", "0"},
		{"viewer não cria empresa", "viewer", "POST", "/patrimonio/empresas", `{"nome":"Vessel"}`, 403, "sem_permissao", "0"},
		{"viewer não chama a RPC (portão antes da função)", "viewer", "POST", "/rpc/pessoas_para_escolher", ``, 403, "sem_permissao", "0"},
		{"pat cria empresa", "pat", "POST", "/patrimonio/empresas", `{"nome":"Vessel"}`, 201, `"nome":"Vessel"`, "1"},
		{"pat chama a RPC registrada em web.FuncoesRPC", "pat", "POST", "/rpc/pessoas_para_escolher", ``, 200, "[]", "1"},
	} {
		st, corpo := pedir(c.quem, c.metodo, c.caminho, c.corpo)
		if st != c.status || !strings.Contains(corpo, c.tem) {
			t.Errorf("%s: %s %s como %q = %d %s, esperava %d com %q", c.nome, c.metodo, c.caminho, c.quem, st, corpo, c.status, c.tem)
		}
		if n := empresas(); n != c.empresas {
			t.Errorf("%s: patrimonio_empresas = %s linhas depois, esperava %s", c.nome, n, c.empresas)
		}
	}
}

// Plano 5.8: a Fábrica pela montagem real (sem GITHUB_PAT: não há para onde despachar). Portão de catálogo,
// portão da edge (chave meta.fabrica), conta de serviço do robô e a recusa da conta de serviço no painel.
func TestFabricaPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{ArquivosDir: t.TempDir()})
	ctx := context.Background()
	quem := map[string]string{}
	for i, u := range []struct{ nome, features, permissoes string }{
		{"fabricante", "{meta}", `{"meta.fabrica": ["ver"]}`}, {"so-meta", "{meta}", `{}`},
	} {
		id := fmt.Sprintf("a5810000-0000-4000-a000-00000000020%d", i)
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, id, u.nome+"@x.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, features, permissions, escopo_por_equipe)
			values ($1::uuid, $2::text, $2::text, 'viewer', $3::text[], $4::jsonb, false)`, id, u.nome+"@x.com", u.features, u.permissoes); err != nil {
			t.Fatal(err)
		}
		var err error
		if quem[u.nome], err = s.Criar(ctx, id, "painel", nil); err != nil {
			t.Fatal(err)
		}
	}
	// o robô como o 5.13 o cria (api servico criar), com a chave de permissions dada à parte (como no NOTAS)
	tok, err := s.CriarContaDeServico(ctx, "robo-fabrica", "robo-fabrica@x.com", []string{"meta"})
	if err != nil {
		t.Fatal(err)
	}
	quem["robo-fabrica"] = tok
	if _, err := p.Exec(ctx, `update profiles set permissions = '{"meta.fabrica": ["ver", "editar"]}' where email = 'robo-fabrica@x.com'`); err != nil {
		t.Fatal(err)
	}
	pedir := func(nome, metodo, caminho, corpo string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		r.Header.Set("Content-Type", "application/json")
		if nome != "" {
			r.Header.Set("Authorization", "Bearer "+quem[nome])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	const campanhaInexistente = "a5830000-0000-4000-a000-0000000000ff"
	for _, c := range []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		tem                                string
	}{
		{"leitura sem sessão", "", "GET", "/fabrica/lojas", "", 401, "nao_autenticado"},
		{"leitura com qualquer módulo", "so-meta", "GET", "/fabrica/lojas", "", 200, "["},
		{"disparo sem a chave", "so-meta", "POST", "/fabrica-trigger", `{"tipo":"preview","params":{}}`, 403, "sem_permissao"},
		{"disparo passa o portão e para sem token", "fabricante", "POST", "/fabrica-trigger", `{"tipo":"preview","params":{}}`, 503, "github_nao_configurado"},
		{"disparo recusa conta de serviço", "robo-fabrica", "POST", "/fabrica-trigger", `{"tipo":"preview","params":{}}`, 403, "sem_permissao"},
		{"rota de robô recusa painel", "fabricante", "POST", "/fabrica/robo/execucoes", `{"robo":"fabrica","acao":"teste"}`, 403, "sem_permissao"},
		{"rota de robô aceita o robô", "robo-fabrica", "POST", "/fabrica/robo/execucoes", `{"robo":"fabrica","acao":"teste"}`, 201, `"id"`},
		{"apagar com rodada inexistente", "fabricante", "POST", "/fabrica-apagar", `{"campanhaId":"` + campanhaInexistente + `"}`, 200, `"ok":true`},
		{"apagar recusa conta de serviço", "robo-fabrica", "POST", "/fabrica-apagar", `{"campanhaId":"` + campanhaInexistente + `"}`, 403, "sem_permissao"},
	} {
		st, corpo := pedir(c.quem, c.metodo, c.caminho, c.corpo)
		if st != c.status || !strings.Contains(corpo, c.tem) {
			t.Errorf("%s: %s %s como %q = %d %s, esperava %d com %q", c.nome, c.metodo, c.caminho, c.quem, st, corpo, c.status, c.tem)
		}
	}
	var jobs int
	if err := p.QueryRow(ctx, `select count(*) from fabrica_jobs`).Scan(&jobs); err != nil || jobs != 0 {
		t.Errorf("jobs = %d (%v): sem token nada deveria nascer", jobs, err)
	}
}

// Plano 5.9 pela montagem real: as rotas do Conteúdo no grupo de domínio (sessão, escopo, conta), as 6 RPCs na
// lista branca e o /conteudo-trigger com o portão da edge. A matriz de cada rota está em internal/conteudo;
// aqui vale a MONTAGEM (grupo, cadeia, posição, FuncoesRPC).
func TestConteudoPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	const a1, a2 = "a5900000-0000-4000-a000-0000000000a1", "a5900000-0000-4000-a000-0000000000a2"
	const p1, p2 = "a5930000-0000-4000-a000-0000000000c1", "a5930000-0000-4000-a000-0000000000c2"
	quem := map[string]string{}
	for i, u := range []struct{ nome, papel, features, contas string }{
		{"editor-a1", "viewer", "{conteudo}", "{" + a1 + "}"}, {"aprovador-a1", "viewer", "{conteudo,conteudo.aprovar}", "{" + a1 + "}"},
		{"admin", "admin", "{}", ""}, {"nenhum", "viewer", "{}", ""},
	} {
		id := fmt.Sprintf("a5910000-0000-4000-a000-00000000020%d", i)
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, id, u.nome+"@x.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, features, escopo_por_equipe, allowed_accounts)
			values ($1::uuid, $2::text, $2::text, $3::text, $4::text[], false, nullif($5::text, '')::uuid[])`,
			id, u.nome+"@x.com", u.papel, u.features, u.contas); err != nil {
			t.Fatal(err)
		}
		var err error
		if quem[u.nome], err = s.Criar(ctx, id, "painel", nil); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := p.Exec(ctx, `insert into accounts (id, name, username, instagram_id) values ($1::uuid, 'Vessel', 'vessel', '1784'), ($2::uuid, 'Mantova', 'mantova', '1785')`, a1, a2); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into conteudo_pecas (id, account_id, titulo, formato, status, publicar_em) values
		($1::uuid, $2::uuid, 'Da A1', 'feed', 'em_aprovacao', now() + interval '1 day'),
		($3::uuid, $4::uuid, 'Da A2', 'feed', 'em_aprovacao', now() + interval '1 day')`, p1, a1, p2, a2); err != nil {
		t.Fatal(err)
	}
	pedir := func(nome, metodo, caminho, corpo string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		r.Header.Set("Content-Type", "application/json")
		if nome != "" {
			r.Header.Set("Authorization", "Bearer "+quem[nome])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	for _, c := range []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		tem, naoTem                        string
	}{
		{"leitura sem sessão", "", "GET", "/conteudo/pecas", "", 401, "nao_autenticado", ""},
		{"editor com lista só vê a própria conta", "editor-a1", "GET", "/conteudo/pecas", "", 200, a1, a2},
		{"admin vê as duas", "admin", "GET", "/conteudo/pecas", "", 200, a2, ""},
		{"sem módulo lê lista vazia (catálogo)", "nenhum", "GET", "/conteudo/pecas", "", 200, "[]", ""},
		{"RPC com peça de conta que não se vê", "aprovador-a1", "POST", "/rpc/conteudo_decidir", `{"p_peca":"` + p2 + `","p_decisao":"aprovada"}`, 403, "sem_permissao", ""},
		{"RPC na própria conta", "aprovador-a1", "POST", "/rpc/conteudo_decidir", `{"p_peca":"` + p1 + `","p_decisao":"aprovada"}`, 200, `"status":"aprovada"`, ""},
		{"RPC sem o portão da função", "editor-a1", "POST", "/rpc/conteudo_aprovar_e_agendar", `{"p_peca":"` + p1 + `"}`, 403, "sem_permissao", ""},
		{"pedir IA sem o módulo", "nenhum", "POST", "/conteudo-trigger", `{"account_id":"` + a1 + `"}`, 403, "sem_permissao", ""},
		{"pedir IA para conta que não se vê", "editor-a1", "POST", "/conteudo-trigger", `{"account_id":"` + a2 + `"}`, 403, "sem_permissao", ""},
		{"pedir IA na própria conta: o job na fila", "editor-a1", "POST", "/conteudo-trigger", `{"account_id":"` + a1 + `","quantas":5}`, 200, `"quantas":5`, ""},
	} {
		st, corpo := pedir(c.quem, c.metodo, c.caminho, c.corpo)
		if st != c.status || !strings.Contains(corpo, c.tem) || (c.naoTem != "" && strings.Contains(corpo, c.naoTem)) {
			t.Errorf("%s: %s %s como %q = %d %s, esperava %d com %q e sem %q", c.nome, c.metodo, c.caminho, c.quem, st, corpo, c.status, c.tem, c.naoTem)
		}
	}
	var fila string
	if err := p.QueryRow(ctx, `select count(*)::text || '|' || min(status) from conteudo_jobs`).Scan(&fila); err != nil || fila != "1|enfileirado" {
		t.Errorf("a fila = %q %v, esperava 1|enfileirado", fila, err)
	}
}

// Quem soma rotas ao grupo de domínio sem declarar aqui é pego: `rotas53` tem de ser EXATAMENTE as rotas
// /frota/ montadas (nem mais, nem menos).
func TestRotasDaFrotaSaoAsDeclaradas(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
	var montadas []string
	if err := chi.Walk(h.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if strings.HasPrefix(rota, "/frota/") {
			montadas = append(montadas, metodo+" "+rota)
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	slices.Sort(montadas)
	quer := slices.Clone(rotas53)
	slices.Sort(quer)
	if len(rotas53) != 27 || !slices.Equal(montadas, quer) {
		t.Errorf("rotas /frota/ montadas = %d: %v\nesperadas (27): %v", len(montadas), montadas, quer)
	}
}

// Plano 5.3: a Frota pela montagem real (auth.Exigir → autz.ComEscopo → handler, o mesmo da produção).
// Quem tem a feature frota grava; admin sem a Frota lê [] e não chega à linha; as 2 RPCs têm o portão de cada função.
func TestFrotaPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	tok := map[string]string{}
	for _, u := range []struct{ id, nome, papel, features string }{
		{"5e200000-0000-4000-a000-0000000030a1", "motorista", "viewer", "{frota}"},
		{"5e200000-0000-4000-a000-0000000030a2", "admin", "admin", "{}"},
	} {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, u.id, u.nome+"-53@x.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, features, escopo_por_equipe) values ($1::uuid, $2::text, $3::text, $4::text, $5::text[], false)`,
			u.id, u.nome+"-53@x.com", u.nome, u.papel, u.features); err != nil {
			t.Fatal(err)
		}
		var err error
		if tok[u.nome], err = s.Criar(ctx, u.id, "painel", nil); err != nil {
			t.Fatal(err)
		}
	}
	pedir := func(quem, metodo, caminho, corpo string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		r.Header.Set("Content-Type", "application/json")
		if quem != "" {
			r.Header.Set("Authorization", "Bearer "+tok[quem])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, strings.TrimSpace(w.Body.String())
	}
	obs := func() string {
		var v string
		if err := p.QueryRow(ctx, `select coalesce(string_agg(nome || ':' || coalesce(observacao, ''), ',' order by nome), '') from frota_veiculos`).Scan(&v); err != nil {
			t.Fatal(err)
		}
		return v
	}
	for _, c := range []struct {
		nome, quem, metodo, caminho, corpo string
		status                             int
		tem                                string
		veiculos                           string // frota_veiculos (nome:observacao) DEPOIS do caso
	}{
		{"leitura sem sessão", "", "GET", "/frota/veiculos", "", 401, "nao_autenticado", ""},
		{"admin sem a Frota lê a lista vazia", "admin", "GET", "/frota/veiculos", "", 200, "[]", ""},
		{"admin sem a Frota não cria", "admin", "POST", "/frota/veiculos", `{"placa":"ZZZ0Z00","nome":"Intruso"}`, 403, "sem_permissao", ""},
		{"motorista cria o carro", "motorista", "POST", "/frota/veiculos", `{"placa":"ZZZ1Z11","nome":"Teste"}`, 201, `"placa":"ZZZ1Z11"`, "Teste:"},
		{"admin sem a Frota não enxerga a linha (404)", "admin", "PATCH", "/frota/veiculos/__ID__", `{"observacao":"x"}`, 404, "", "Teste:"},
		{"admin não chama a RPC da ficha", "admin", "POST", "/rpc/frota_corrente_do_veiculo", `{"p_veiculo":"__ID__"}`, 403, "sem_permissao", "Teste:"},
		{"motorista chama a RPC da ficha", "motorista", "POST", "/rpc/frota_corrente_do_veiculo", `{"p_veiculo":"__ID__"}`, 200, "", "Teste:"},
		{"só a Frota não é admin do Patrimônio (Ruling 5.3-10)", "motorista", "POST", "/rpc/etiqueta_quem_e", `{"p_numero":1}`, 403, "sem_permissao", "Teste:"},
	} {
		var id string
		if strings.Contains(c.caminho+c.corpo, "__ID__") {
			if err := p.QueryRow(ctx, `select id::text from frota_veiculos where nome = 'Teste'`).Scan(&id); err != nil {
				t.Fatal(err)
			}
		}
		st, corpo := pedir(c.quem, c.metodo, strings.ReplaceAll(c.caminho, "__ID__", id), strings.ReplaceAll(c.corpo, "__ID__", id))
		if st != c.status || !strings.Contains(corpo, c.tem) {
			t.Errorf("%s: %s %s como %q = %d %s, esperava %d com %q", c.nome, c.metodo, c.caminho, c.quem, st, corpo, c.status, c.tem)
		}
		if v := obs(); v != c.veiculos {
			t.Errorf("%s: frota_veiculos = %q depois, esperava %q", c.nome, v, c.veiculos)
		}
	}
}

// Pela montagem real: o escopo de canal chega ao handler (cadeia auth.Exigir → autz.ComEscopo) e o
// portão de escrita é o do catálogo (Plano 5.5).
func TestComercialPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{CoreURL: coreFalso(t), CoreToken: "t"})
	ctx := context.Background()
	const vend, viewer = "a5550000-0000-4000-a000-000000000001", "a5550000-0000-4000-a000-000000000002"
	const eq = "e5550000-0000-4000-a000-000000000001"
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := p.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`insert into usuarios (id, email) values ($1::uuid, 'vend@x.com'), ($2::uuid, 'viewer@x.com')`, vend, viewer)
	exec(`insert into profiles (id, email, role, features, escopo_por_equipe) values
		($1::uuid, 'vend@x.com', 'viewer', '{sales}', true), ($2::uuid, 'viewer@x.com', 'viewer', '{}', true)`, vend, viewer)
	exec(`insert into bling_lojas (loja_id, nome) values (1, 'Loja 1'), (2, 'Loja 2')`)
	exec(`insert into equipes (id, nome, canal_loja_id) values ($1::uuid, 'T1', 1)`, eq)
	exec(`insert into equipes_membros (equipe_id, profile_id, papel) values ($1::uuid, $2::uuid, 'vendedora')`, eq, vend)
	exec(`insert into bling_pedido_nota (pedido_id, loja_id, data_pedido, total) values (1, 1, '2026-10-01', 10), (2, 2, '2026-10-01', 20)`)
	tokV, _ := s.Criar(ctx, vend, "painel", nil)
	tokW, _ := s.Criar(ctx, viewer, "painel", nil)
	pedir := func(metodo, caminho, corpo, tok string) (int, string) {
		r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, w.Body.String()
	}
	if st, b := pedir("GET", "/comercial/notas", "", ""); st != 401 {
		t.Errorf("sem sessão = %d %s", st, b)
	}
	if st, b := pedir("GET", "/comercial/notas", "", tokV); st != 200 || !strings.Contains(b, `"pedido_id":1,`) || strings.Contains(b, `"pedido_id":2,`) {
		t.Errorf("vendedora = %d %s (esperava só o pedido do canal 1)", st, b)
	}
	if st, b := pedir("GET", "/comercial/notas", "", tokW); st != 200 || strings.TrimSpace(b) != "[]" {
		t.Errorf("viewer = %d %s (esperava [])", st, b)
	}
	if st, b := pedir("PATCH", "/comercial/lojas/1", `{"fechado_em":"2026-08-31"}`, tokW); st != 403 {
		t.Errorf("viewer fechando canal = %d %s, esperava 403", st, b)
	}
	if st, b := pedir("POST", "/comercial/pedidos-vendedor/gravar", `{"linhas":[{"pedido_id":1,"vendor_id":7}]}`, tokW); st != 403 {
		t.Errorf("viewer gravando o cache = %d %s, esperava 403", st, b)
	}
	var fechado *string
	if err := p.QueryRow(ctx, `select fechado_em::text from bling_lojas where loja_id = 1`).Scan(&fechado); err != nil || fechado != nil {
		t.Errorf("a loja 1 mudou: %v %v", fechado, err)
	}
}

// Plano 5.10: o selo pela montagem de PRODUÇÃO (web.Rotas): as leituras no grupo de domínio, as 16 RPCs registradas e
// o cartão com o portão do selo antes do Zoho (sem conexão do Zoho no banco de teste: 503 depois do portão).
func TestSeloPelaMontagemReal(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table if not exists acessos_conexoes (provedor text primary key, client_id text, client_secret text,
		refresh_token text, org_id text, data_center text default '.com', escopos text, conectado_por uuid, conectado_em timestamptz,
		atualizado_em timestamptz not null default now())`); err != nil {
		t.Fatal(err)
	}
	quem := map[string]string{}
	for i, c := range []struct{ nome, features string }{{"selo", "{autenticidade}"}, {"so-meta", "{meta}"}} {
		id := fmt.Sprintf("5a10a000-0000-4000-a000-00000000000%d", i+1)
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, id, c.nome+"@x.com"); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, role, features) values ($1::uuid, $2::text, 'viewer', $3::text[])`, id, c.nome+"@x.com", c.features); err != nil {
			t.Fatal(err)
		}
		tok, err := s.Criar(ctx, id, "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		quem[c.nome] = tok
	}
	if _, err := p.Exec(ctx, `insert into vessel_lotes (id, modelo, sku, quantidade) values ('5a10b000-0000-4000-a000-000000000001', 'Linear', 'SS1', 1);
		insert into vessel_pecas (codigo, lote_id, numero_na_serie, cartao_gerado_em) values ('VBMONTA001', '5a10b000-0000-4000-a000-000000000001', 1, now())`); err != nil {
		t.Fatal(err)
	}
	for _, c := range []struct {
		nome, quem, metodo, rota, corpo string
		status                          int
		tem                             string
	}{
		{"leitura sem sessão", "", "GET", "/autenticidade/pecas", "", 401, "nao_autenticado"},
		{"leitura de quem não é do selo", "so-meta", "GET", "/autenticidade/pecas", "", 200, "[]"},
		{"leitura do selo", "selo", "GET", "/autenticidade/pecas", "", 200, "VBMONTA001"},
		{"RPC registrada, quem não é do selo", "so-meta", "POST", "/rpc/vessel_alertas", "{}", 403, "sem_permissao"},
		{"RPC registrada, o selo", "selo", "POST", "/rpc/vessel_marcar_gravada", `{"p_codigo":"VBMONTA001"}`, 200, `"ja_estava" : false`},
		{"cartão, quem não é do selo", "so-meta", "POST", "/vessel-baixar-cartao", `{"codigo":"VBMONTA001","face":"frente","formato":"png"}`, 403, "sem_permissao"},
		{"cartão passa o portão e para sem o Zoho", "selo", "POST", "/vessel-baixar-cartao", `{"codigo":"VBMONTA001","face":"frente","formato":"png"}`, 503, "zoho_desconectado"},
	} {
		req := httptest.NewRequest(c.metodo, c.rota, strings.NewReader(c.corpo))
		if c.quem != "" {
			req.Header.Set("Authorization", "Bearer "+quem[c.quem])
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != c.status || !strings.Contains(w.Body.String(), c.tem) {
			t.Errorf("%s: %s %s = %d %s; esperava %d com %q", c.nome, c.metodo, c.rota, w.Code, w.Body, c.status, c.tem)
		}
	}
}

// Plano 6, pela montagem real: o envio de currículo do Core (chave certa, um IP só, nomes UUID como o Core gera) não toma o
// teto por IP do anônimo, e o anônimo toma; a rota de arquivo e a de edge usam a MESMA regra de "quem é o Core".
func TestCurriculoPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	h := Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{VesselInterno: "chave-do-core-com-mais-de-24-caracteres", ArquivosDir: t.TempDir()})
	envia := func(i int, cab ...string) int {
		r := httptest.NewRequest("POST", fmt.Sprintf("/storage/v1/object/vessel-curriculos/consultor-tivoli/%08x-0000-4000-a000-000000000000.pdf", i), strings.NewReader("%PDF-1.4\nconteudo\n"))
		r.RemoteAddr = "127.0.0.1:4000"
		r.Header.Set("Content-Type", "application/pdf")
		for _, c := range cab {
			k, v, _ := strings.Cut(c, ": ")
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code
	}
	for i := 0; i < 15; i++ { // o Core: o mesmo IP 15 vezes, todas passam
		if st := envia(i, "Authorization: Bearer chave-do-core-com-mais-de-24-caracteres", "X-Forwarded-For: 203.0.113.5"); st != 200 {
			t.Fatalf("Core, envio %d = %d", i+1, st)
		}
	}
	var visto429 bool
	for i := 100; i < 115; i++ { // o anônimo (a anon do navegador não vale como chave): 10 por IP por hora
		if st := envia(i, "Authorization: Bearer chave-anon-publica", "X-Real-IP: 198.51.100.9"); st == 429 {
			visto429 = true
		} else if st != 200 {
			t.Fatalf("anônimo, envio %d = %d", i, st)
		}
	}
	if !visto429 {
		t.Error("o anônimo mandou 15 currículos do mesmo IP sem tomar 429")
	}
}
