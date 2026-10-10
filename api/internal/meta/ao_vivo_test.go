package meta

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// graphFalsa responde como a Graph (pelo core) de acordo com caminho e parâmetros.
func graphFalsa(p core.PedidoMeta) (int, string, map[string]string) {
	m := func(k string) string { s, _ := p.Parametros[k].(string); return s }
	switch {
	case p.Caminho == "/1784" && m("fields") == "followers_count":
		return 200, `{"followers_count":24345,"id":"1784"}`, nil
	case p.Caminho == "/1784/insights" && strings.HasPrefix(m("metric"), "views"):
		if m("since") == "erro" {
			return 400, `{"error":{"message":"Invalid metric","code":100}}`, nil
		}
		return 200, `{"data":[{"name":"views","total_value":{"value":100}},{"name":"reach","total_value":{"value":50}}]}`, nil
	case p.Caminho == "/1784/insights" && strings.HasPrefix(m("metric"), "likes"):
		return 200, `{"data":[{"name":"likes","total_value":{"breakdowns":[{"results":[
			{"dimension_values":["POST"],"value":3},{"dimension_values":["REEL"],"value":2},{"dimension_values":["AD"],"value":4}]}]}}]}`, nil
	case p.Caminho == "/1784/insights" && m("metric") == "follows_and_unfollows":
		return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[{"dimension_values":["FOLLOWER"],"value":14},{"dimension_values":["NON_FOLLOWER"],"value":3}]}]}}]}`, nil
	case p.Caminho == "/1784/insights" && m("metric") == "replies":
		return 200, `{"data":[{"total_value":{"value":7}}]}`, nil
	case p.Caminho == "/act_999/insights" && m("fields") == "spend":
		return 200, `{"data":[{"spend":"10.5"}]}`, nil
	case p.Caminho == "/act_999/insights" && m("fields") == "actions":
		return 200, `{"data":[{"actions":[{"action_type":"post_reaction","value":"9"},{"action_type":"comment","value":"2"}]}]}`, nil
	case p.Caminho == "/act_999/insights" && m("fields") == "campaign_id,spend":
		if m("after") == "P2" {
			return 200, `{"data":[{"campaign_id":"c1","spend":"1.5"}]}`, nil
		}
		return 200, `{"data":[{"campaign_id":"c1","spend":"5"},{"campaign_id":"c2","spend":"7"}],
			"paging":{"next":"https://graph.facebook.com/v22.0/act_999/insights?fields=campaign_id%2Cspend&level=campaign&after=P2&limit=500&access_token=***"}}`, nil
	}
	return 404, `{"erro":"rota de teste desconhecida"}`, nil
}

func decodificar(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	return m
}

func TestInsightsAoVivo(t *testing.T) {
	a := montarMeta(t, graphFalsa)
	w := a.post("/insights-ao-vivo", a.tokens[uSocial], `{"account_id":"conta-1","engSince":1759287600,"engUntil":1759892400,"folSince":"1","folUntil":"2"}`)
	if w.Code != 200 {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	m := decodificar(t, w)
	b, _ := json.Marshal(m)
	quer := `{"engajamento":{"interacoes":0,"reach":50,"views":100,"visitas":0},"followers_count":24345,` +
		`"interacoes":{"comentarios":{"ad":2,"geral":2,"org":0,"post":0,"reel":0,"story":0},` +
		`"compartilhamentos":{"ad":0,"geral":0,"org":0,"post":0,"reel":0,"story":0},` +
		`"curtidas":{"ad":9,"geral":14,"org":5,"post":3,"reel":2,"story":0},` +
		`"salvamentos":{"ad":0,"geral":0,"org":0,"post":0,"reel":0,"story":0}},` +
		`"investimento":10.5,"novos":{"deixou":3,"seguiu":14,"total":11},"respostas":7}`
	if string(b) != quer {
		t.Fatalf("saída =\n%s\nesperava\n%s", b, quer)
	}
	for _, p := range a.core.pedidos {
		if p.Caminho == "/act_999/insights" && p.Parametros["time_range"] != `{"since":"2025-10-01","until":"2025-10-07"}` {
			t.Fatalf("janela em São Paulo errada: %v", p.Parametros["time_range"])
		}
	}
}

func TestInsightsAoVivoCampanhasPeriodoAnteriorEErros(t *testing.T) {
	a := montarMeta(t, graphFalsa)
	w := a.post("/insights-ao-vivo", a.tokens[uSocial], `{"account_id":"conta-1","engSince":"1759287600","engUntil":"1759892400",
		"folSince":"1","folUntil":"2","prevEngSince":"erro","prevEngUntil":"2","prevFolSince":"1","prevFolUntil":"2","campanhas":["c1"]}`)
	m := decodificar(t, w)
	if m["investimento"] != 6.5 {
		t.Fatalf("soma só de c1 nas duas páginas = %v", m["investimento"])
	}
	ant, ok := m["anterior"].(map[string]any)
	if !ok || m["meta_erro"] != nil || ant["engajamento"] == nil || m["engajamento"].(map[string]any)["views"] != 100.0 {
		t.Fatalf("falha só no período anterior não pode virar meta_erro: %s", w.Body)
	}
	atualFalha := a.post("/insights-ao-vivo", a.tokens[uSocial], `{"account_id":"conta-1","engSince":"erro","engUntil":"2","folSince":"1","folUntil":"2"}`)
	if m := decodificar(t, atualFalha); m["meta_erro"] != "meta_incompleto" {
		t.Fatalf("falha no período atual é meta_incompleto: %s", atualFalha.Body)
	}
	var pagina2 *core.PedidoMeta
	for i, p := range a.core.pedidos {
		if p.Parametros["after"] == "P2" {
			pagina2 = &a.core.pedidos[i]
		}
	}
	if pagina2 == nil || pagina2.Caminho != "/act_999/insights" || pagina2.Parametros["access_token"] != nil {
		t.Fatalf("paging.next traduzido errado: %+v", pagina2)
	}
	semAd := a.post("/insights-ao-vivo", a.tokens[uSocial], `{"account_id":"42","engSince":"1","engUntil":"2","folSince":"1","folUntil":"2"}`)
	if m := decodificar(t, semAd); m["investimento"] != nil {
		t.Fatalf("sem conta de anúncio o investimento é null: %v", m["investimento"])
	}
	if w := a.post("/insights-ao-vivo", a.tokens[uSocial], `{"account_id":"nao-existe"}`); w.Code != 404 {
		t.Fatalf("conta inexistente: %d", w.Code)
	}
	if w := a.post("/insights-ao-vivo", a.tokens[uMeta], `{"account_id":"conta-1"}`); w.Code != 403 {
		t.Fatalf("sem o módulo social: %d", w.Code)
	}
	morto := httptest.NewServer(http.NotFoundHandler())
	morto.Close()
	a.cli.URL = morto.URL
	if w := a.post("/insights-ao-vivo", a.tokens[uSocial], `{"account_id":"conta-1","engSince":"1","engUntil":"2","folSince":"1","folUntil":"2"}`); w.Code != 500 || !strings.Contains(w.Body.String(), "erro interno") {
		t.Fatalf("core fora: %d %s", w.Code, w.Body)
	}
}

func TestSerieNovosDia(t *testing.T) {
	var simultaneas, pico atomic.Int32
	a := montarMeta(t, func(p core.PedidoMeta) (int, string, map[string]string) {
		n := simultaneas.Add(1)
		defer simultaneas.Add(-1)
		for v := pico.Load(); n > v && !pico.CompareAndSwap(v, n); v = pico.Load() {
		}
		time.Sleep(5 * time.Millisecond)
		switch p.Parametros["since"] {
		case "1":
			return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[{"dimension_values":["FOLLOWER"],"value":5},{"dimension_values":["NON_FOLLOWER"],"value":1}]}]}}]}`, nil
		case "2":
			return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[]}]}}]}`, nil
		}
		return 500, `{"erro":"falhou"}`, nil
	})
	w := a.post("/serie-novos-dia", a.tokens[uSocial], `{"account_id":"conta-1","dias":[{"since":1,"until":2,"label":"01/10"},{"since":"2","until":"3","label":"02/10"},{"since":"3","until":"4","label":"03/10"}]}`)
	b, _ := json.Marshal(decodificar(t, w))
	quer := `{"serie":[{"deixou":1,"label":"01/10","publicado":true,"seguiu":5},{"deixou":0,"label":"02/10","publicado":false,"seguiu":0},{"deixou":0,"label":"03/10","publicado":false,"seguiu":0}]}`
	if string(b) != quer {
		t.Fatalf("%s", b)
	}
	var dias []string
	for i := 0; i < 100; i++ {
		dias = append(dias, `{"since":"9","until":"9","label":"x"}`)
	}
	antes := a.core.n()
	a.post("/serie-novos-dia", a.tokens[uSocial], `{"account_id":"conta-1","dias":[`+strings.Join(dias, ",")+`]}`)
	if a.core.n()-antes != 93 || pico.Load() > 5 {
		t.Fatalf("teto de 93 dias e ondas de 5: %d chamadas, pico %d", a.core.n()-antes, pico.Load())
	}
	if w := a.post("/serie-novos-dia", a.tokens[uSocial], `{"account_id":"conta-1","dias":[]}`); strings.TrimSpace(w.Body.String()) != `{"serie":[]}` {
		t.Fatalf("sem dias: %s", w.Body)
	}
}

func TestContarCollabs(t *testing.T) {
	var mu sync.Mutex
	caminhos := map[string]bool{}
	a := montarMeta(t, func(p core.PedidoMeta) (int, string, map[string]string) {
		mu.Lock()
		caminhos[p.Caminho] = true
		mu.Unlock()
		aceito := `{"data":[{"id":"1784","invite_status":"Accepted"}]}`
		switch {
		case p.Caminho == "/1785/media" && p.Parametros["after"] == "A2":
			return 200, `{"data":[{"id":"m1","media_product_type":"FEED","collaborators":` + aceito + `}]}`, nil
		case p.Caminho == "/1785/media":
			return 200, `{"data":[{"id":"m1","media_product_type":"FEED","collaborators":` + aceito + `},
				{"id":"m2","media_product_type":"REELS","collaborators":` + aceito + `},
				{"id":"m3","media_product_type":"FEED","collaborators":{"data":[{"id":"1784","invite_status":"Pending"}]}}],
				"paging":{"cursors":{"after":"A2"}}}`, nil
		}
		return 400, `{"error":{"message":"sem acesso"}}`, nil
	})
	w := a.post("/contar-collabs", a.tokens[uSocial], `{"account_id":"conta-1","since":"2026-10-01","until":"2026-10-07"}`)
	if strings.TrimSpace(w.Body.String()) != `{"posts":1,"reels":1}` {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	if caminhos["/1784/media"] || caminhos["/null/media"] || !caminhos["/1786/media"] {
		t.Fatalf("perfis varridos: %v", caminhos)
	}
	antes := a.core.n()
	if w := a.post("/contar-collabs", a.tokens[uSocial], `{"account_id":"conta-1"}`); strings.TrimSpace(w.Body.String()) != `{"posts":0,"reels":0}` || a.core.n() != antes {
		t.Fatalf("sem datas: %s", w.Body)
	}
}

func TestPecasPuras(t *testing.T) {
	if g := comoGraph(429, obj{"erro": "meta_em_recuo"}); g["error"].(obj)["message"] != "core: meta_em_recuo" || g["error"].(obj)["code"] != 429 {
		t.Fatalf("comoGraph erro do core: %v", g)
	}
	graph := obj{"error": obj{"message": "x"}}
	if g := comoGraph(400, graph); g["error"].(obj)["message"] != "x" {
		t.Fatalf("erro da Graph passa: %v", g)
	}
	if g := comoGraph(502, obj{"raw": strings.Repeat("z", 300)}); len(g["error"].(obj)["message"].(string)) != len("core: ")+200 {
		t.Fatal("raw é cortado em 200")
	}
	cam, params, ok := traduzirURL("https://graph.facebook.com/v21.0/act_9/insights?fields=spend&access_token=***&time_range=%7B%22since%22%3A%221%22%7D")
	if !ok || cam != "/act_9/insights" || params["fields"] != "spend" || params["time_range"] != `{"since":"1"}` || params["access_token"] != nil {
		t.Fatalf("traduzirURL = %q %v %v", cam, params, ok)
	}
	for _, fora := range []string{"https://scontent.fbcdn.net/x.jpg", "http://graph.facebook.com/v21.0/me", "nao e url"} {
		if _, _, ok := traduzirURL(fora); ok {
			t.Errorf("%q não é a Graph", fora)
		}
	}
	if pub, _, _ := lerBrutoDoDia(obj{"data": []any{}}); pub {
		t.Fatal("dia sem linha não foi publicado")
	}
	if diaSP("1760065200") != "2025-10-10" || diaSP("1760065199") != "2025-10-09" {
		t.Fatalf("dia em São Paulo: %s %s", diaSP("1760065200"), diaSP("1760065199"))
	}
}

// Credencial do core (401/403) nunca chega ao front como 401/403 nem vaza o token.
func TestAoVivoCore401Nunca401(t *testing.T) {
	a := montarMeta(t, func(core.PedidoMeta) (int, string, map[string]string) {
		return 401, `{"erro":"nao_autorizado"}`, nil
	})
	corpo := `{"account_id":"conta-1","engSince":"1","engUntil":"2","folSince":"1","folUntil":"2"}`
	w := a.post("/insights-ao-vivo", a.tokens[uSocial], corpo)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "meta_incompleto") || strings.Contains(w.Body.String(), tokenDoCore) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
	w = a.post("/serie-novos-dia", a.tokens[uSocial], `{"account_id":"conta-1","dias":[{"since":"1","until":"2","label":"x"}]}`)
	if w.Code != 200 || strings.Contains(w.Body.String(), tokenDoCore) || !strings.Contains(w.Body.String(), `"publicado":false`) {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}

const corpoInsights = `{"account_id":"conta-1","engSince":"1","engUntil":"2","folSince":"1","folUntil":"2"}`
const corpoSerie = `{"account_id":"conta-1","dias":[{"since":"1","until":"2","label":"x"}]}`
const corpoCollabs = `{"account_id":"conta-1","since":"2026-10-01","until":"2026-10-07"}`

var rotasAoVivo = []struct{ rota, corpo string }{
	{"/insights-ao-vivo", corpoInsights}, {"/serie-novos-dia", corpoSerie}, {"/contar-collabs", corpoCollabs},
}

func TestAoVivoPortaoNasTresRotas(t *testing.T) {
	a := montarMeta(t, graphFalsa)
	servico := func(u string) string {
		tk, err := auth.NovoStore(a.p).Criar(context.Background(), u, "servico", nil)
		if err != nil {
			t.Fatal(err)
		}
		return tk
	}
	for _, r := range rotasAoVivo {
		for _, c := range []struct {
			nome, token string
			quer        int
		}{
			{"sem sessão", "", 401}, {"token inválido", "lixo", 401},
			{"sem o módulo social", a.tokens[uNada], 403}, {"só meta", a.tokens[uMeta], 403},
			{"social", a.tokens[uSocial], 200}, {"role admin", a.tokens[uAdmin], 200},
			{"sessão de serviço com social", servico(uSocial), 200}, {"sessão de serviço sem social", servico(uNada), 403},
		} {
			if w := a.post(r.rota, c.token, r.corpo); w.Code != c.quer {
				t.Errorf("%s %s: %d, esperava %d (%s)", r.rota, c.nome, w.Code, c.quer, w.Body)
			}
		}
	}
}

func capturarLog(t *testing.T) *bytes.Buffer {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	return &log
}

func TestAoVivoSemTokenDoCore503(t *testing.T) {
	a := montarMeta(t, graphFalsa)
	a.cli.Token = ""
	for _, r := range rotasAoVivo {
		w := a.post(r.rota, a.tokens[uSocial], r.corpo)
		if w.Code != 503 || !strings.Contains(w.Body.String(), "core nao configurado") {
			t.Errorf("%s: %d %s", r.rota, w.Code, w.Body)
		}
	}
	if a.core.n() != 0 {
		t.Fatalf("sem token nada vai ao core: %d", a.core.n())
	}
}

func TestAoVivoLogaCausaDos500SemVazarToken(t *testing.T) {
	log := capturarLog(t)
	a := montarMeta(t, graphFalsa)
	morto := httptest.NewServer(http.NotFoundHandler())
	morto.Close()
	a.cli.URL = morto.URL
	for _, r := range []struct{ rota, corpo string }{{"/insights-ao-vivo", corpoInsights}, {"/contar-collabs", corpoCollabs}} {
		w := a.post(r.rota, a.tokens[uSocial], r.corpo)
		if w.Code != 500 || strings.Contains(w.Body.String(), tokenDoCore) {
			t.Fatalf("%s: %d %s", r.rota, w.Code, w.Body)
		}
	}
	if !strings.Contains(log.String(), "level=ERROR") || strings.Contains(log.String(), tokenDoCore) {
		t.Fatalf("log: %s", log.String())
	}
	// banco fora também loga a causa (e responde 500)
	log.Reset()
	a.p.Close()
	for _, r := range rotasAoVivo {
		if w := a.post(r.rota, a.tokens[uSocial], r.corpo); w.Code == 200 {
			t.Fatalf("%s com banco fora: %d", r.rota, w.Code)
		}
	}
}

func TestSerieNovosDiaRepete429EPulaDiaSemDatas(t *testing.T) {
	var chamadas atomic.Int32
	a := montarMeta(t, func(p core.PedidoMeta) (int, string, map[string]string) {
		if chamadas.Add(1) == 1 {
			return 429, `{"erro":"meta_em_recuo"}`, map[string]string{"Retry-After": "1"}
		}
		return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[{"dimension_values":["FOLLOWER"],"value":2}]}]}}]}`, nil
	})
	w := a.post("/serie-novos-dia", a.tokens[uSocial], corpoSerie)
	if !strings.Contains(w.Body.String(), `"publicado":true`) || a.core.n() != 2 {
		t.Fatalf("429 e depois 200: %s, %d chamadas", w.Body, a.core.n())
	}
	antes := a.core.n()
	w = a.post("/serie-novos-dia", a.tokens[uSocial], `{"account_id":"conta-1","dias":[{"label":"a"},{"since":"1","label":"b"},{"until":"2","label":"c"}]}`)
	if strings.Count(w.Body.String(), `"publicado":false`) != 3 || a.core.n() != antes {
		t.Fatalf("dia sem since/until: %s, %d chamadas novas", w.Body, a.core.n()-antes)
	}
}

func TestInsightsSoNovosFalhaViraIncompleto(t *testing.T) {
	a := montarMeta(t, func(p core.PedidoMeta) (int, string, map[string]string) {
		if p.Parametros["metric"] == "follows_and_unfollows" {
			return 400, `{"error":{"message":"x","code":100}}`, nil
		}
		return graphFalsa(p)
	})
	w := a.post("/insights-ao-vivo", a.tokens[uSocial], corpoInsights)
	if m := decodificar(t, w); w.Code != 200 || m["meta_erro"] != "meta_incompleto" {
		t.Fatalf("%d %s", w.Code, w.Body)
	}
}
