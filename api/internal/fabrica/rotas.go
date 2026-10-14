package fabrica

import (
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/github"
)

// Montar registra as rotas do 5.8 no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir, do prazo de 30 s e
// de autz.ComEscopo): 9 leituras e 13 escritas (1 de catálogo, 5 edges, 7 de robô). gh: o cliente do GitHub
// (GITHUB_PAT); arquivos: ARQUIVOS_DIR. As escritas do painel recusam "entrar como" (soSessaoPropria) e conta
// de serviço (soPainel); as de robô só aceitam conta de serviço (montarRobo). Declaração errada derruba a
// subida. Rota nova entra sozinha nas varreduras de rotas_test.go. fabrica-candidatos (Task 7) só lê gc_* e
// os briefings: o portão é soPainel + soFabricante, sem soSessaoPropria.
func Montar(r chi.Router, p *pgxpool.Pool, gh *github.Cliente, arquivos string) {
	montarLeituras(r, p)
	disparos := auth.NovoLimitador()
	disparos.Max, disparos.Janela = 30, time.Hour // Ruling 5.8-16
	r.With(soPainel, soFabricante, soSessaoPropria).Post("/fabrica-trigger", (&Disparador{Pool: p, GH: gh, Limite: disparos}).ServeHTTP)
	r.With(soPainel, soFabricante, soSessaoPropria).Post("/fabrica-apagar", (&Apagador{Pool: p, GH: gh, Arquivos: arquivos}).ServeHTTP)
	cur := &Curadoria{Pool: p}
	r.With(soPainel, soFabricante, soSessaoPropria).Post("/fabrica-looks", cur.Looks)
	r.With(soPainel, soFabricante, soSessaoPropria).Post("/fabrica-publicos", cur.Publicos)
	r.With(soPainel, soFabricante).Post("/fabrica-candidatos", (&Candidatos{Pool: p}).ServeHTTP) // só lê: "entrar como" passa; conta de serviço não (como as outras edges)
	montarRobo(r, p)
}
