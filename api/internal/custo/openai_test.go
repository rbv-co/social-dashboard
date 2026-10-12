package custo

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// apiOpenAIFalsa responde como a API admin da OpenAI; `mudar` troca o handler de uma rota
// ("<caminho ESCAPADO>" ou "<caminho>?<group_by>"). A base é <servidor>/v1/organization. Devolve o
// servidor e um contador de chamadas por rota. Toda chamada tem de trazer `Authorization: Bearer <chave>`.
func apiOpenAIFalsa(t *testing.T, mudar map[string]http.HandlerFunc) (*httptest.Server, func(string) int) {
	t.Helper()
	const pre = "/v1/organization"
	var mu sync.Mutex
	hits := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer "+chaveFalsa {
			t.Errorf("%s sem a chave no Authorization", r.URL.Path)
		}
		q := r.URL.Query()
		rota := strings.TrimPrefix(r.URL.EscapedPath(), pre)
		if g := q.Get("group_by[]"); g != "" {
			rota += "?" + g
		}
		mu.Lock()
		hits[rota]++
		mu.Unlock()
		if strings.HasPrefix(rota, "/costs") && (q.Get("start_time") != "1789257600" || q.Get("end_time") != "1791849600" ||
			q.Get("bucket_width") != "1d" || q.Get("limit") != "180") {
			t.Errorf("%s: consulta errada %s", rota, r.URL.RawQuery)
		}
		if h := mudar[rota]; h != nil {
			h(w, r)
			return
		}
		switch rota {
		case "/costs":
			if q.Has("group_by[]") {
				t.Errorf("o total não agrupa: %s", r.URL.RawQuery)
			}
			switch q.Get("page") {
			case "":
				io.WriteString(w, `{"data":[{"start_time":1791590400,"start_time_iso":"2026-10-10T00:00:00+00:00","results":[{"amount":{"value":12.34}},{"amount":{"value":0.66}}]}],"has_more":true,"next_page":"pg2"}`)
			case "pg2":
				io.WriteString(w, `{"data":[{"start_time":1791676800,"results":[{"amount":null}]}],"has_more":false,"next_page":null}`)
			default:
				t.Errorf("página inesperada %q", q.Get("page"))
			}
		case "/costs?line_item":
			io.WriteString(w, `{"data":[{"start_time":1791590400,"results":[{"line_item":"gpt-image-2-2026-04-21 image, output","amount":{"value":9.1234567}},`+
				`{"line_item":null,"amount":{"value":0.0000004}}]}],"has_more":false}`)
		case "/costs?api_key_id":
			io.WriteString(w, `{"data":[{"start_time":1791590400,"results":[{"api_key_id":"key_1","amount":{"value":3}},{"api_key_id":"key_2","amount":{"value":10}}]}],"has_more":false}`)
		case "/projects":
			if q.Get("limit") != "50" {
				t.Errorf("projects sem limit=50: %s", r.URL.RawQuery)
			}
			io.WriteString(w, `{"data":[{"id":"proj_1"},{"id":"proj/../x"},{"name":"sem id"},{"id":"."},{"id":".."},{"id":"a b"}]}`)
		case "/projects/proj_1/api_keys":
			if q.Get("limit") != "100" {
				t.Errorf("api_keys sem limit=100: %s", r.URL.RawQuery)
			}
			io.WriteString(w, `{"data":[{"id":"key_1","name":"FabricadeAnuncios"}]}`)
		case "/projects/proj%2F..%2Fx/api_keys":
			w.WriteHeader(500)
		case "/projects/a%20b/api_keys": // PathEscape: espaço = %20 (QueryEscape daria +)
			io.WriteString(w, `{"data":[]}`)
		default:
			t.Errorf("rota inesperada %s", rota)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, func(rota string) int { mu.Lock(); defer mu.Unlock(); return hits[rota] }
}

func buscarOpenAI(t *testing.T, srv *httptest.Server) (string, error) {
	t.Helper()
	f, err := OpenAI{Base: srv.URL + "/v1/organization", Pausa: semEspera}.Buscar(context.Background(), chaveFalsa, janelaDeTeste)
	if err != nil {
		return "", err
	}
	b, _ := json.Marshal(f)
	return string(b), nil
}

func TestOpenAIFatura(t *testing.T) {
	if (OpenAI{}).cliente("k").http != semRedirecionar {
		t.Fatal("o cliente da OpenAI tem de ser o semRedirecionar")
	}
	if c := (OpenAI{}).cliente("k"); c.prazo != 8*time.Second || c.orcamento != 20*time.Second || c.fornecedor != "OpenAI" {
		t.Fatalf("prazo/orçamento/nome da edge: %v %v %q", c.prazo, c.orcamento, c.fornecedor)
	}
	if (OpenAI{}).base() != "https://api.openai.com/v1/organization" {
		t.Fatalf("base padrão = %s", (OpenAI{}).base())
	}
	srv, hits := apiOpenAIFalsa(t, nil)
	got, err := buscarOpenAI(t, srv)
	if err != nil {
		t.Fatal(err)
	}
	// Node 22 com as fórmulas de custo-openai/index.ts: dólares (sem /100), 12.34+0.66 = 13, 13*5.5 = 71.5,
	// 9.1234567.toFixed(6) = 9.123457, 0.0000004 → 0 (cai no filtro > 0), nome da chave key_1 vem do projeto.
	quer := `{"desde":"2026-09-13","ate":"2026-10-13","cambio":5.5,"totalUsd":13,"totalBrl":71.5,` +
		`"dias":[{"data":"2026-10-10","usd":13},{"data":"2026-10-11","usd":0}],` +
		`"porCategoria":[{"item":"gpt-image-2-2026-04-21 image, output","usd":9.123457}],` +
		`"porChave":[{"nome":"key_2","usd":10},{"nome":"FabricadeAnuncios","usd":3}]}`
	if got != quer {
		t.Fatalf("fatura =\n%s\nesperava\n%s", got, quer)
	}
	// o projeto cujo id tem "/" é pedido com o caminho ESCAPADO (o id nunca muda o caminho), e o sem id não é pedido
	if hits("/projects/proj%2F..%2Fx/api_keys") != 3 || hits("/projects/proj_1/api_keys") != 1 || hits("/costs") != 2 || hits("/projects/a%20b/api_keys") != 1 {
		t.Errorf("chamadas: x=%d proj_1=%d costs=%d", hits("/projects/proj%2F..%2Fx/api_keys"), hits("/projects/proj_1/api_keys"), hits("/costs"))
	}
}

func TestOpenAIDetalheQuebradoNaoDerrubaOTotal(t *testing.T) {
	srv, _ := apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs?line_item": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(400) },
	})
	got, err := buscarOpenAI(t, srv)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, `"totalUsd":13,`) || !strings.Contains(got, `"porCategoria":[],`) || !strings.Contains(got, `"porChave":[{"nome":"key_2"`) {
		t.Fatalf("fatura = %s", got)
	}
}

func TestOpenAITotalQuebradoE500(t *testing.T) {
	srv, _ := apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(503)
			io.WriteString(w, `{"error":"invalid key `+chaveFalsa+`"}`)
		},
	})
	_, err := buscarOpenAI(t, srv)
	if err == nil || !strings.Contains(err.Error(), "(já tentei 3 vezes)") {
		t.Fatalf("erro = %v", err)
	}
	if strings.Contains(err.Error(), chaveFalsa[:10]) || strings.Contains(err.Error(), "invalid key") {
		t.Errorf("o erro vazou a chave ou o corpo do fornecedor: %v", err)
	}
}

func TestOpenAINomesFalhamSemDerrubar(t *testing.T) {
	srv, _ := apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/projects": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) },
	})
	got, err := buscarOpenAI(t, srv)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(got, `"porChave":[{"nome":"key_2","usd":10},{"nome":"key_1","usd":3}]`) {
		t.Fatalf("fatura = %s", got)
	}
}

// 3xx não é seguido: o cabeçalho com a chave iria para o outro endereço.
func TestOpenAINaoSegueRedirecionamento(t *testing.T) {
	var alvoChamado bool
	var mu sync.Mutex
	alvo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		alvoChamado = true
		mu.Unlock()
		if r.Header.Get("Authorization") != "" {
			t.Error("a chave foi para o endereço do redirecionamento")
		}
		io.WriteString(w, `{"data":[],"has_more":false}`)
	}))
	defer alvo.Close()
	srv, _ := apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs": func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, alvo.URL, http.StatusFound) },
	})
	_, err := buscarOpenAI(t, srv)
	if err == nil || !strings.Contains(err.Error(), "o OpenAI respondeu, e a resposta é essa") {
		t.Fatalf("erro = %v", err)
	}
	mu.Lock()
	defer mu.Unlock()
	if alvoChamado {
		t.Error("o redirecionamento foi seguido")
	}
}

// amount.value em texto numérico (Number("1.5") do JS), ausente = 0; valor ilegível no total = resposta inesperada.
func TestOpenAIValorEmTextoEIlegivel(t *testing.T) {
	srv, _ := apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"start_time":1791590400,"results":[{"amount":{"value":"1.5"}},{"amount":{}},{}]}],"has_more":false}`)
		},
	})
	got, err := buscarOpenAI(t, srv)
	if err != nil || !strings.Contains(got, `"dias":[{"data":"2026-10-10","usd":1.5}]`) || !strings.Contains(got, `"totalUsd":1.5,`) {
		t.Fatalf("fatura = %s (%v)", got, err)
	}

	srv, _ = apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"start_time":1791590400,"results":[{"amount":{"value":"abc"}}]}],"has_more":false}`)
		},
	})
	if _, err = buscarOpenAI(t, srv); err == nil || err.Error() != "Resposta inesperada do OpenAI." {
		t.Fatalf("erro = %v", err)
	}
}

// Dinheiro: o total arredonda em 4 casas e o BRL em 2 pelo toFixed do JS (valor exato do float), o dia
// fica cru, e a data do balde sem start_time_iso vem de start_time (UTC).
func TestOpenAITotalArredondaComoOToFixed(t *testing.T) {
	// fuso não-UTC: a data vinda de start_time tem de sair em UTC (a CI roda com TZ=UTC e não notaria)
	local := time.Local
	time.Local = time.FixedZone("BRT", -3*3600)
	t.Cleanup(func() { time.Local = local })
	// Node: (13.35+0.123456789).toFixed(4) = "13.4735"; ((13.35+0.123456789)*5.5).toFixed(2) = "74.10"
	srv, _ := apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("page") == "" {
				io.WriteString(w, `{"data":[{"start_time":1791680000,"start_time_iso":"2026-10-10T23:59:59+00:00","results":[{"amount":{"value":13.35}}]}],"has_more":true,"next_page":"b"}`)
				return
			}
			io.WriteString(w, `{"data":[{"start_time":1791677000,"start_time_iso":"","results":[{"amount":{"value":0.123456789}}]}],"has_more":false}`)
		},
	})
	got, err := buscarOpenAI(t, srv)
	if err != nil {
		t.Fatal(err)
	}
	// 13.35 + 0.123456789 = 13.473456789 → 13.4735; ×5.5 = 74.1040… → 74.1
	for _, quer := range []string{`"totalUsd":13.4735,`, `"totalBrl":74.1,`, `{"data":"2026-10-10","usd":13.35}`, `{"data":"2026-10-11","usd":0.123456789}`} {
		if !strings.Contains(got, quer) {
			t.Errorf("faltou %s em %s", quer, got)
		}
	}

	srv, _ = apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"start_time":1791590400,"results":[{"amount":{"value":2.00005}}]},{"start_time":1791676800,"results":[{"amount":{"value":13.35}}]}],"has_more":false}`)
		},
	})
	// Node: (2.00005+13.35) = 15.35005 e .toFixed(4) = "15.3500" (o float exato fica abaixo do empate); Math.round(x*1e4)/1e4 daria 15.3501
	got, err = buscarOpenAI(t, srv)
	if err != nil || !strings.Contains(got, `"totalUsd":15.35,`) {
		t.Fatalf("fatura = %s (%v)", got, err)
	}

	// um único dia de 13.35: Node (13.35*5.5).toFixed(2) = "73.42" (Math.round daria 73.43)
	srv, _ = apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"start_time":1791590400,"results":[{"amount":{"value":13.35}}]}],"has_more":false}`)
		},
	})
	if got, err = buscarOpenAI(t, srv); err != nil || !strings.Contains(got, `"totalUsd":13.35,"totalBrl":73.42,`) {
		t.Fatalf("fatura = %s (%v)", got, err)
	}
}

// Detalhes: paginação (as duas varreduras seguem next_page e somam entre páginas), nome nulo/ausente =
// "(sem nome)", arredondamento em 6 casas pelo toFixed, filtro > 0 depois de arredondar, ordem e empate estável.
func TestOpenAIDetalhesPaginadosERedondos(t *testing.T) {
	srv, hits := apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs?line_item": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("page") == "" {
				// Y e X empatam depois da soma; A some (5e-7 → toFixed(6) = 0, Math.round daria 0.000001)
				io.WriteString(w, `{"data":[{"start_time":1,"results":[{"line_item":"Y","amount":{"value":1}},{"line_item":"X","amount":{"value":0.5}},{"line_item":"A","amount":{"value":5e-7}}]}],"has_more":true,"next_page":"l2"}`)
				return
			}
			io.WriteString(w, `{"data":[{"start_time":2,"results":[{"line_item":"X","amount":{"value":0.5}},{"amount":{"value":1.0000015}},{"line_item":"Z","amount":{"value":9.1234565}},{"line_item":"W","amount":{"value":0}}]}],"has_more":false}`)
		},
		"/costs?api_key_id": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("page") == "" {
				io.WriteString(w, `{"data":[{"start_time":1,"results":[{"api_key_id":"k2","amount":{"value":1}},{"api_key_id":"k1","amount":{"value":0.25}}]}],"has_more":true,"next_page":"c2"}`)
				return
			}
			io.WriteString(w, `{"data":[{"start_time":2,"results":[{"api_key_id":"k1","amount":{"value":0.75}},{"api_key_id":null,"amount":{"value":0.0000035}},{"api_key_id":"k3","amount":{"value":0}}]}],"has_more":false}`)
		},
		"/projects": func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, `{"data":[{"id":"p"}]}`) },
		"/projects/p/api_keys": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"id":"k1","name":"Um"},{"id":"k2","name":""},{"name":"sem id"}]}`)
		},
	})
	got, err := buscarOpenAI(t, srv)
	if err != nil {
		t.Fatal(err)
	}
	// Node: toFixed(6) de 9.1234565 = 9.123456, 1.0000015 = 1.000001, 0.0000035 = 0.000003 (Math.round: 9.123457, 1.000002, 0.000004)
	// Y = 1 e X = 0.5+0.5 = 1 empatam (Y chegou primeiro); "(sem nome)" = 1.000001 fica na frente deles.
	cats := `"porCategoria":[{"item":"Z","usd":9.123456},{"item":"(sem nome)","usd":1.000001},{"item":"Y","usd":1},{"item":"X","usd":1}],`
	chaves := `"porChave":[{"nome":"k2","usd":1},{"nome":"Um","usd":1},{"nome":"(sem nome)","usd":0.000003}]}`
	if !strings.Contains(got, cats) || !strings.HasSuffix(got, chaves) {
		t.Fatalf("fatura =\n%s\nesperava conter %s\ne terminar em %s", got, cats, chaves)
	}
	if hits("/costs?line_item") != 2 || hits("/costs?api_key_id") != 2 {
		t.Errorf("páginas dos detalhes: %d e %d, esperava 2 e 2", hits("/costs?line_item"), hits("/costs?api_key_id"))
	}
}

// Crédito/ajuste (valor negativo): soma com sinal no total e nos detalhes, e o que fecha negativo não
// aparece (filtro > 0). Igual à edge, que não usa módulo nem filtra != 0.
func TestOpenAIValoresNegativos(t *testing.T) {
	srv, _ := apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"start_time":1791590400,"results":[{"amount":{"value":5}},{"amount":{"value":-2}}]}],"has_more":false}`)
		},
		"/costs?line_item": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"start_time":1,"results":[{"line_item":"A","amount":{"value":5}},{"line_item":"A","amount":{"value":-2}},{"line_item":"B","amount":{"value":-2}}]}],"has_more":false}`)
		},
		"/costs?api_key_id": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"start_time":1,"results":[{"api_key_id":"k1","amount":{"value":4}},{"api_key_id":"k1","amount":{"value":-1}},{"api_key_id":"k2","amount":{"value":-1}}]}],"has_more":false}`)
		},
	})
	got, err := buscarOpenAI(t, srv)
	if err != nil {
		t.Fatal(err)
	}
	for _, quer := range []string{`"totalUsd":3,`, `"dias":[{"data":"2026-10-10","usd":3}]`, `"porCategoria":[{"item":"A","usd":3}]`, `"porChave":[{"nome":"k1","usd":3}]}`} {
		if !strings.Contains(got, quer) {
			t.Errorf("faltou %s em %s", quer, got)
		}
	}
}

// Um valor ilegível no detalhe invalida o detalhe inteiro (nada de lista pela metade), sem derrubar o total.
func TestOpenAIDetalheIlegivelZeraSoOSeuDetalhe(t *testing.T) {
	srv, _ := apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs?api_key_id": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"start_time":1,"results":[{"api_key_id":"key_1","amount":{"value":3}},{"api_key_id":"key_2","amount":{"value":"abc"}}]}],"has_more":false}`)
		},
	})
	got, err := buscarOpenAI(t, srv)
	if err != nil || !strings.Contains(got, `"totalUsd":13,`) || !strings.HasSuffix(got, `"porChave":[]}`) || !strings.Contains(got, `"porCategoria":[{"item":"gpt-image`) {
		t.Fatalf("fatura = %s (%v)", got, err)
	}
}

// Nomes: um projeto que falha não leva os nomes dos outros, nome vazio cai no id, chave sem id é ignorada.
func TestOpenAINomesPorProjeto(t *testing.T) {
	srv, _ := apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/projects": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"id":"a"},{"id":"b"},{"id":"c"}]}`)
		},
		"/projects/a/api_keys": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) },
		"/projects/b/api_keys": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"id":"key_1","name":"Bê"},{"name":"Fantasma"}]}`)
		},
		"/costs?api_key_id": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"start_time":1,"results":[{"api_key_id":"key_1","amount":{"value":3}},{"api_key_id":"key_2","amount":{"value":10}},{"api_key_id":"","amount":{"value":1}}]}],"has_more":false}`)
		},
		"/projects/c/api_keys": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"id":"key_2","name":""}]}`)
		},
	})
	got, err := buscarOpenAI(t, srv)
	if err != nil || !strings.HasSuffix(got, `"porChave":[{"nome":"key_2","usd":10},{"nome":"Bê","usd":3},{"nome":"","usd":1}]}`) {
		t.Fatalf("fatura = %s (%v)", got, err)
	}
}

// Sem nenhum gasto: listas vazias (nunca null, que a tela recusa) e total zero.
func TestOpenAISemGastoSaiVazio(t *testing.T) {
	vazio := func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, `{"data":[],"has_more":false}`) }
	srv, _ := apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs": vazio, "/costs?line_item": vazio, "/costs?api_key_id": vazio,
		"/projects": func(w http.ResponseWriter, _ *http.Request) { io.WriteString(w, `{}`) },
	})
	got, err := buscarOpenAI(t, srv)
	quer := `{"desde":"2026-09-13","ate":"2026-10-13","cambio":5.5,"totalUsd":0,"totalBrl":0,"dias":[],"porCategoria":[],"porChave":[]}`
	if err != nil || got != quer {
		t.Fatalf("fatura = %s (%v)", got, err)
	}
}

// A segunda página de um detalhe falha: o detalhe inteiro vira [] (nada de soma pela metade que pareça a conta toda).
func TestOpenAIDetalheComPaginaQuebradaZeraOExtrato(t *testing.T) {
	srv, _ := apiOpenAIFalsa(t, map[string]http.HandlerFunc{
		"/costs?line_item": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("page") == "" {
				io.WriteString(w, `{"data":[{"start_time":1,"results":[{"line_item":"X","amount":{"value":5}}]}],"has_more":true,"next_page":"l2"}`)
				return
			}
			w.WriteHeader(429)
		},
	})
	got, err := buscarOpenAI(t, srv)
	if err != nil || !strings.Contains(got, `"totalUsd":13,`) || !strings.Contains(got, `"porCategoria":[],`) {
		t.Fatalf("fatura = %s (%v)", got, err)
	}
}
