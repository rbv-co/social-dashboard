// Package web monta o roteador HTTP.
package web

import (
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/acesso"
	"github.com/rbv-co/social-dashboard/api/internal/acessos"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/canais"
	"github.com/rbv-co/social-dashboard/api/internal/comercial"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/conteudo"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/custo"
	"github.com/rbv-co/social-dashboard/api/internal/email"
	"github.com/rbv-co/social-dashboard/api/internal/fabrica"
	"github.com/rbv-co/social-dashboard/api/internal/frota"
	"github.com/rbv-co/social-dashboard/api/internal/github"
	"github.com/rbv-co/social-dashboard/api/internal/ia"
	"github.com/rbv-co/social-dashboard/api/internal/mapa"
	"github.com/rbv-co/social-dashboard/api/internal/meta"
	"github.com/rbv-co/social-dashboard/api/internal/paineis"
	"github.com/rbv-co/social-dashboard/api/internal/patrimonio"
	"github.com/rbv-co/social-dashboard/api/internal/redes"
	"github.com/rbv-co/social-dashboard/api/internal/trafego"
	"github.com/rbv-co/social-dashboard/api/internal/vendas"
	"github.com/rbv-co/social-dashboard/api/internal/vessel"
	"github.com/rbv-co/social-dashboard/api/internal/webhooks"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/zoho"
)

// Prazos por requisição das rotas lentas da Meta (o contexto da requisição não tem prazo
// próprio). contar-collabs varre N perfis x até 5 páginas em série, então é o maior; o
// WriteTimeout do servidor (main.go) e o proxy_read_timeout do nginx (NOTAS) ficam ACIMA
// destes valores, senão o prazo nunca teria como disparar antes da conexão cair.
const (
	PrazoMetaAoVivo = 90 * time.Second
	PrazoCollabs    = 120 * time.Second
	// bling-proxy: usuário limitado a lojas faz UMA chamada ao core por loja (até 25 s cada).
	PrazoBling = 90 * time.Second
	// Plano 5.12: custo-*: a Anthropic chegou a 18 s (cache-de-custo.js:13-15); 90 dias = 3 páginas em série.
	PrazoCusto = 90 * time.Second
	// Plano 5: o grupo de DOMÍNIO inteiro (leituras, escritas e POST /rpc/{nome}), do carregamento do
	// escopo à resposta: função lenta ou consulta presa não segura conexão do pool (o contexto
	// cancelado cancela a consulta no banco; a resposta é 504 prazo_esgotado). Fica ABAIXO dos 60 s do
	// proxy_read_timeout padrão do nginx e do WriteTimeout do servidor (main.go).
	PrazoDominio = 30 * time.Second
	// Plano 5.7: proxies de IA da Gestão de Tráfego (um PDF pela IA leva até ~2 min; 30 s de folga antes do
	// EscritaDoServidor) e de mapa (fila de uma ligação por segundo ao Nominatim).
	PrazoIA   = 120 * time.Second
	PrazoMapa = 20 * time.Second
	// Plano 5.10: o cartão EAN do Zoho (POST /vessel-baixar-cartao): o resgate pela busca na árvore do robô levava
	// ~7 s e o PDF a 600 dpi vem em fluxo; o de domínio (30 s) cortaria o download.
	PrazoCartao = 60 * time.Second

	// EscritaDoServidor é o WriteTimeout do http.Server (main.go): a folga de 30 s acima do maior
	// prazo por requisição (PrazoCollabs) deixa o handler terminar e responder antes de a conexão cair.
	// TestPrazosPorRotaPelaMontagemReal confere cada prazo de rota contra ESTA constante.
	EscritaDoServidor = PrazoCollabs + 30*time.Second
)

// FuncoesRPC é a lista branca de POST /rpc/{nome}. Vazia no 5.0: cada sub-plano acrescenta as
// funções do seu domínio, com parâmetros, retorno e o portão que espelha a checagem interna da
// função, e TIRA os nomes dela de RPCPendentes (montarRPC recusa os dois lugares ao mesmo tempo).
var FuncoesRPC = slices.Concat(
	trafego.FuncoesRPC,    // Plano 5.7
	patrimonio.FuncoesRPC, // Plano 5.2
	conteudo.FuncoesRPC,   // Plano 5.9
	vessel.FuncoesRPC,     // Plano 5.10
	frota.FuncoesRPC,      // Plano 5.3
)

// comPrazo limita o contexto da requisição; o que estiver preso na rede/core desiste junto.
func comPrazo(d time.Duration) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx, cancela := context.WithTimeout(r.Context(), d)
			defer cancela()
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// Rotas: tudo atrás de sessão (Exigir) e de um portão, exceto a lista PÚBLICA explícita
// (saúde, login e os webhooks, que se autenticam por assinatura/segredo e têm limite por IP).
// As rotas portadas das edges têm o MESMO nome, corpo e resposta da edge (Plano 7 troca
// `functions.invoke(nome)` por `POST /nome`).
func Rotas(p *pgxpool.Pool, s *auth.Store, l *auth.Limitador, cfg config.Config) http.Handler {
	r := chi.NewRouter()
	r.Get("/saude", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })
	r.Get("/pronto", func(w http.ResponseWriter, r *http.Request) {
		if err := p.Ping(r.Context()); err != nil {
			http.Error(w, "banco indisponível", http.StatusServiceUnavailable)
			return
		}
		w.Write([]byte("ok"))
	})
	h := auth.NovosHandlers(p, s, l)
	r.Post("/auth/entrar", h.Entrar)
	// Plano 5.0: links de senha (públicos; limite por IP e por e-mail lá dentro, resposta sem enumeração).
	conta := auth.NovaConta(p, s, &email.ZeptoMail{Token: cfg.ZeptoToken, De: cfg.ZeptoDe, Nome: cfg.ZeptoNome},
		cfg.EnderecosDoApp, cfg.EnderecoPadrao)
	r.Post("/auth/esqueci-senha", conta.EsqueciSenha)
	r.Post("/auth/definir-senha", conta.DefinirSenha)
	acesso.MontarPublicas(r, p) // Plano 5.1: POST /pedir-acesso, público com limite por IP e teto global (fora de auth.Exigir)

	// Webhooks: públicos, sem sessão. O fan-out do core vem de um IP só: teto folgado.
	// Só POST: outro método = 405 do chi (testado).
	sh := &webhooks.Shopify{Pool: p, Segredos: cfg.ShopifySegredos}
	cw := &webhooks.Chatwoot{Pool: p, Segredo: cfg.ChatwootSegredo}
	r.Group(func(r chi.Router) {
		r.Use(auth.LimitarPorIP(600, time.Minute))
		r.Post("/receber-webhook-pedido-shopify", sh.Pedido)
		r.Post("/receber-webhook-checkout", sh.Checkout)
		r.Post("/receber-webhook-abandono", sh.Abandono)
		r.Post("/receber-webhook-chatwoot", cw.Evento)
		r.Post("/receber-opt-out-chatwoot", cw.OptOut)
	})

	rpcs, err := montarRPC(p, FuncoesRPC, RPCPendentes, RPCForaDoPainel)
	if err != nil {
		panic(err) // declaração errada: a API não sobe
	}
	cli := core.Novo(cfg.CoreURL, cfg.CoreToken)
	av := &meta.AoVivo{Pool: p, Core: cli}
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.Post("/auth/sair", h.Sair)
		r.Get("/auth/eu", h.Eu)
		r.Get("/eu/canais", canais.Handler(p))
		r.With(comPrazo(PrazoBling)).Post("/bling-proxy", (&comercial.Bling{Pool: p, Core: cli}).ServeHTTP)                                                   // portão por caminho, lá dentro
		r.With(auth.ExigirModulo("meta"), autz.ComEscopo(p)).Post("/meta-proxy", (&meta.Proxy{Pool: p, Core: cli, HostsDeMidia: cfg.HostsDeMidia}).ServeHTTP) // prazo próprio (25/45/75 s)
		r.With(auth.ExigirModulo("social"), autz.ComEscopo(p), comPrazo(PrazoMetaAoVivo)).Post("/insights-ao-vivo", av.Insights)
		r.With(auth.ExigirModulo("social"), autz.ComEscopo(p), comPrazo(PrazoMetaAoVivo)).Post("/serie-novos-dia", av.SerieNovosDia)
		r.With(auth.ExigirModulo("social"), autz.ComEscopo(p), comPrazo(PrazoCollabs)).Post("/contar-collabs", av.ContarCollabs)
		// Plano 4: o mesmo portão da edge (superadmin ou permissions['frota.aprovar'] com 'ver').
		r.With(auth.ExigirPermissao("frota.aprovar", "ver")).Post("/avisar-decisao-de-reserva",
			(&frota.Reserva{Pool: p, VAPID: webpush.VAPID{Publica: cfg.VAPIDPublica, Privada: cfg.VAPIDPrivada, Assunto: cfg.VAPIDAssunto}}).ServeHTTP)

		// Plano 5.7: proxies de IA (chave em ANTHROPIC_API_KEY_TRAFEGO) e de mapa (Nominatim). Portões = os das edges.
		// No grupo de SESSÃO: o prazo do grupo de domínio (30 s) cortaria a IA.
		iaTrafego, lugar := ia.Nova(cfg.IATrafego), mapa.Novo()
		r.With(auth.ExigirModulo("meta.gestor"), autz.ComEscopo(p), comPrazo(PrazoIA)).Post("/sugerir-publico-ia", iaTrafego.SugerirPublico)
		r.With(auth.ExigirModulo("meta.gestor"), comPrazo(PrazoIA)).Post("/ler-documento", iaTrafego.LerDocumento)
		r.With(auth.ExigirModulo("meta"), comPrazo(PrazoMapa)).Post("/buscar-lugar", lugar.ServeHTTP)

		// Plano 5.10: o cartão EAN do Zoho. Portão do selo (is_vessel_admin) DENTRO do handler, antes de ler o corpo;
		// no grupo de SESSÃO com o escopo e o prazo próprio (o de domínio cortaria o download).
		r.With(autz.ComEscopo(p), comPrazo(PrazoCartao)).Post("/vessel-baixar-cartao", (&vessel.Cartao{Pool: p, Zoho: zoho.Novo(p)}).ServeHTTP)

		// Plano 5.0: conta. Os portões de invite-user e entrar-como são os das edges (papel admin;
		// super-admin pela ficha), dentro do handler, com a resposta 400 {"error": frase} das edges.
		r.Post("/auth/trocar-senha", conta.TrocarSenha)
		r.Get("/eu/perfil", conta.Perfil)
		r.Post("/invite-user", conta.InviteUser)
		r.Post("/entrar-como-usuario", conta.EntrarComo)
		r.Post("/conferir-senha", conta.ConferirSenha)

		// Plano 5.12: a fatura real das contas de IA. Portão da edge (papel admin) DENTRO do handler,
		// antes de ler o corpo, a chave ou chamar o fornecedor.
		r.With(comPrazo(PrazoCusto)).Post("/custo-anthropic", custo.Rota{Chave: cfg.AnthropicAdmin, Buscar: custo.Anthropic{}.Buscar}.ServeHTTP)
		r.With(comPrazo(PrazoCusto)).Post("/custo-openai", custo.Rota{Chave: cfg.OpenAIAdmin, Buscar: custo.OpenAI{}.Buscar}.ServeHTTP)

		// Plano 5: rotas de DOMÍNIO. Toda rota daqui lê autz.EscopoDo(ctx): leitura por dados.Consulta
		// (regra de Ler do catálogo no WHERE), escrita por autz.PodeCriar/PodeEditar/PodeApagar dentro de
		// banco.ComUsuario, RPC pelo registro (lista branca). Prazo (PrazoDominio) e escopo vêm do grupo:
		// rota nova de domínio entra AQUI, nunca solta no grupo de cima. Os sub-planos 5.1+ acrescentam aqui.
		r.Group(func(r chi.Router) {
			r.Use(comPrazo(PrazoDominio), autz.ComEscopo(p))
			r.Post("/rpc/{nome}", rpcs.ServeHTTP)
			redes.Montar(r, p)   // Plano 5.6
			acesso.Montar(r, p)  // Plano 5.1
			trafego.Montar(r, p) // Plano 5.7
			// Plano 5.2: patrimônio e cadastros compartilhados (as 5 RPCs entram por FuncoesRPC).
			patrimonio.Montar(r, p)
			// Plano 5.8: Fábrica (leituras, 4 edges, rotas de robô). O despacho ao GitHub (15 s) cabe nos 30 s do grupo.
			fabrica.Montar(r, p, github.Novo(cfg.GitHubPAT), cfg.ArquivosDir)
			conteudo.Montar(r, p) // Plano 5.9
			acessos.Montar(r, p)  // Plano 5.4: colaboradores e acessos (cadastro)
			vessel.Montar(r, p)   // Plano 5.10: as 6 leituras do selo (as 16 RPCs vão por FuncoesRPC)
			vendas.Montar(r, p)   // Plano 5.5: Comercial (Bling e Shopify)
			frota.Montar(r, p)    // Plano 5.3: veículos, usos, reservas, checklists, manutenções (as 2 RPCs entram por FuncoesRPC)
			// Plano 5.12: notícias e status da IA (leituras declaradas, regra do catálogo).
			if err := paineis.Montar(r, p, autz.Producao); err != nil {
				panic(err) // declaração errada: a API não sobe
			}
		})
	})
	return r
}
