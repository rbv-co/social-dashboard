package fabrica

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/github"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// escritas: um pedido VÁLIDO (para quem pode) por rota de escrita de Montar. Rota nova sem entrada aqui
// faz as varreduras falharem.
var escritas = map[string]struct{ caminho, corpo string }{
	"POST /fabrica/criativos/escolher":          {"/fabrica/criativos/escolher", `{"ids":["` + K1 + `"],"escolhido":false}`},
	"POST /fabrica-trigger":                     {"/fabrica-trigger", `{"tipo":"preview","params":{}}`},
	"POST /fabrica-apagar":                      {"/fabrica-apagar", `{"campanhaId":"` + C2 + `"}`},
	"POST /fabrica-candidatos":                  {"/fabrica-candidatos", `{"lojas":["14888726315"],"fonte":"manual","filtros":{}}`},
	"POST /fabrica-looks":                       {"/fabrica-looks", `{"acao":"excluir","chave":"promo-sage"}`},
	"POST /fabrica-publicos":                    {"/fabrica-publicos", `{"acao":"apagar","id":"` + P2 + `"}`},
	"PATCH /fabrica/robo/jobs/{id}":             {"/fabrica/robo/jobs/" + J1, `{"status":"concluido"}`},
	"POST /fabrica/robo/jobs/{id}/proximo-lote": {"/fabrica/robo/jobs/" + J1 + "/proximo-lote", ``},
	"PATCH /fabrica/robo/campanhas/{id}":        {"/fabrica/robo/campanhas/" + C1, `{"status":"pronta"}`},
	"POST /fabrica/robo/criativos": {"/fabrica/robo/criativos", `[{"campanha_id":"` + C2 + `","arquetipo":"produto",` +
		`"template":"t","formato":"1080x1080","storage_path":"` + C2 + `/produto/x.png","url":"https://midia.x/f/x.png"}]`},
	"PATCH /fabrica/robo/looks/{chave}": {"/fabrica/robo/looks/promo-sage", `{"preview_url":"https://midia.x/f/_previews/p.png"}`},
	"POST /fabrica/robo/meta-jobs":      {"/fabrica/robo/meta-jobs", `{"tipo":"estudio","payload":{"campanhaId":"` + C3 + `"},"status":"criado"}`},
	"POST /fabrica/robo/execucoes":      {"/fabrica/robo/execucoes", `{"robo":"fabrica-gerar","acao":"gerar criativos","status":"ok"}`},
}

// soLeitura: POST que só lê (o "entrar como" passa).
const soLeitura = "POST /fabrica-candidatos"

// mundoMontado: o mundo com Montar inteiro, um GitHub de mentira que conta os pedidos e a pasta de arquivos.
func mundoMontado(t *testing.T) (*mundoteste.Mundo, *atomic.Int64) {
	t.Helper()
	var pedidos atomic.Int64
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		pedidos.Add(1)
		w.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(srv.Close)
	gh, dir := github.ParaTeste(t, "SEGREDO-pat", srv.URL), t.TempDir()
	return novoMundo(t, func(r chi.Router, p *pgxpool.Pool) { Montar(r, p, gh, dir) }), &pedidos
}

func varrer(t *testing.T, m *mundoteste.Mundo, f func(metodo, rota, caminho, corpo string)) (leituras, gravacoes int) {
	t.Helper()
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet {
			leituras++
			f(metodo, rota, rota, "")
			return nil
		}
		gravacoes++
		e, ok := escritas[metodo+" "+rota]
		if !ok {
			t.Errorf("escrita sem caso nas varreduras: %s %s", metodo, rota)
			return nil
		}
		f(metodo, rota, e.caminho, e.corpo)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return leituras, gravacoes
}

// A marca de A2 nunca aparece para quem não vê A2 — sem filtro, filtrando por A2 ou contando; o impersonado
// vê o que o ALVO (fabricanteA1) vê. As outras 8 leituras não têm restritiva (Ruling 5.8-15).
func TestNadaVazaEntreContas(t *testing.T) {
	m, _ := mundoMontado(t)
	comRestritiva := map[string]bool{"/fabrica/marcas": true}
	varridas := 0
	l, g := varrer(t, m, func(metodo, rota, _, _ string) {
		if metodo != http.MethodGet || !comRestritiva[rota] {
			return
		}
		varridas++
		for _, quem := range []string{"fabricanteA1", "impersonado", "fabricanteNenhuma"} {
			for _, q := range []string{"", "?account_id=" + A2, "?account_id=" + A2 + "&contar=1&limite=1"} {
				w := m.Resposta(t, quem, "GET", rota+q, "")
				if w.Code != http.StatusOK || strings.Contains(w.Body.String(), A2) {
					t.Errorf("%s GET %s%s = %d %s", quem, rota, q, w.Code, w.Body)
				}
				if strings.Contains(q, "contar=1") && w.Header().Get("X-Total-Count") != "0" {
					t.Errorf("%s contou linhas de A2 em %s: %q", quem, rota, w.Header().Get("X-Total-Count"))
				}
			}
		}
		if _, b := m.Pedir(t, "fabricanteNenhuma", "GET", rota, ""); strings.Contains(b, A1) {
			t.Errorf("lista vazia viu A1 em %s: %s", rota, b)
		}
		if _, b := m.Pedir(t, "adminA1", "GET", rota, ""); !strings.Contains(b, A2) {
			t.Errorf("adminA1 não viu A2 em %s (a rota projeta account_id?): %s", rota, b)
		}
	})
	if l != 9 || g != 13 || varridas != 1 {
		t.Errorf("rotas = %d leituras (%d varridas) e %d escritas, esperava 9 (1) e 13", l, varridas, g)
	}
}

// Toda escrita recusa a sessão de "entrar como", sem tocar no banco nem no GitHub (o candidatos só lê).
func TestEscritasRecusamImpersonado(t *testing.T) {
	m, pedidos := mundoMontado(t)
	antes := m.Um(t, fotoDaFabrica)
	_, n := varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet {
			return
		}
		st, b := m.Pedir(t, "impersonado", metodo, caminho, corpo)
		switch chave := metodo + " " + rota; {
		case chave == soLeitura:
			if st != http.StatusOK {
				t.Errorf("%s como impersonado = %d %s (só lê: deveria passar)", chave, st, b)
			}
		case strings.HasPrefix(rota, "/fabrica/robo/"):
			if st != http.StatusForbidden {
				t.Errorf("%s como impersonado = %d %s", chave, st, b)
			}
		default:
			if st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
				t.Errorf("%s como impersonado = %d %s", chave, st, b)
			}
		}
	})
	if n != 13 {
		t.Errorf("escritas = %d, esperava 13 (rota nova? ponha soSessaoPropria e um caso em `escritas`)", n)
	}
	if m.Um(t, fotoDaFabrica) != antes || pedidos.Load() != 0 {
		t.Errorf("o impersonado mudou o banco ou chamou o GitHub (%d pedidos)", pedidos.Load())
	}
}

// Rota de robô: sessão de PAINEL (mesmo quem passaria no Fabricante) e robô sem a chave = 403 sem efeito;
// o robô com o perfil certo passa.
func TestRotasDeRoboSoServico(t *testing.T) {
	m, _ := mundoMontado(t)
	antes := m.Um(t, fotoDaFabrica)
	robo := 0
	varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if !strings.HasPrefix(rota, "/fabrica/robo/") {
			return
		}
		robo++
		for _, quem := range []string{"fabricante", "adminA1", "super", "chaveEmLista", "roboSemFabrica"} {
			if st, b := m.Pedir(t, quem, metodo, caminho, corpo); st != http.StatusForbidden {
				t.Errorf("%s %s como %s = %d %s", metodo, rota, quem, st, b)
			}
		}
	})
	if robo != 7 {
		t.Errorf("rotas de robô = %d, esperava 7", robo)
	}
	if m.Um(t, fotoDaFabrica) != antes {
		t.Error("sessão de painel ou robô sem a chave gravou numa rota de robô")
	}
	varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if !strings.HasPrefix(rota, "/fabrica/robo/") {
			return
		}
		if st, b := m.Pedir(t, "robo", metodo, caminho, corpo); st < 200 || st > 299 {
			t.Errorf("%s %s como robo = %d %s", metodo, rota, st, b)
		}
	})
}

// Escrita do painel recusa conta de serviço, mesmo com a chave meta.fabrica no perfil do robô: o token do
// robô não dispara, não apaga nem cura; sem efeito no banco nem no GitHub.
func TestEscritasDoPainelRecusamServico(t *testing.T) {
	m, pedidos := mundoMontado(t)
	antes := m.Um(t, fotoDaFabrica)
	_, n := varrer(t, m, func(metodo, rota, caminho, corpo string) {
		if metodo == http.MethodGet || strings.HasPrefix(rota, "/fabrica/robo/") {
			return
		}
		for _, quem := range []string{"robo", "roboSemFabrica"} {
			if st, b := m.Pedir(t, quem, metodo, caminho, corpo); st != http.StatusForbidden {
				t.Errorf("%s %s como %s = %d %s", metodo, rota, quem, st, b)
			}
		}
	})
	if n != 13 {
		t.Errorf("escritas = %d, esperava 13", n)
	}
	if m.Um(t, fotoDaFabrica) != antes || pedidos.Load() != 0 {
		t.Errorf("conta de serviço mudou o banco ou chamou o GitHub (%d pedidos)", pedidos.Load())
	}
}
