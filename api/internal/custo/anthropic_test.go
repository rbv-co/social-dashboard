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
)

// apiAnthropicFalsa responde como a API admin; `mudar` troca o handler de uma rota
// ("<caminho>" ou "<caminho>?<group_by>"). Devolve o servidor e um contador de chamadas por rota.
func apiAnthropicFalsa(t *testing.T, mudar map[string]http.HandlerFunc) (*httptest.Server, func(string) int) {
	t.Helper()
	var mu sync.Mutex
	hits := map[string]int{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-api-key") != chaveFalsa || r.Header.Get("anthropic-version") != "2023-06-01" {
			t.Errorf("%s sem a chave ou a versão", r.URL.Path)
		}
		q := r.URL.Query()
		rota := r.URL.Path
		if g := q.Get("group_by[]"); g != "" {
			rota += "?" + g
		}
		mu.Lock()
		hits[rota]++
		mu.Unlock()
		if h := mudar[rota]; h != nil {
			h(w, r)
			return
		}
		if r.URL.Path != "/v1/organizations/api_keys" && (q.Get("starting_at") != "2026-09-13T00:00:00Z" ||
			q.Get("ending_at") != "2026-10-13T00:00:00Z" || q.Get("bucket_width") != "1d" || q.Get("limit") != "31") {
			t.Errorf("%s: consulta errada %s", rota, r.URL.RawQuery)
		}
		switch rota {
		case "/v1/organizations/cost_report":
			switch q.Get("page") {
			case "":
				io.WriteString(w, `{"data":[{"starting_at":"2026-10-10T00:00:00Z","results":[{"amount":"1234.5"},{"amount":"0.5"}]}],"has_more":true,"next_page":"p2"}`)
			case "p2":
				io.WriteString(w, `{"data":[{"starting_at":"2026-10-11T00:00:00Z","results":[{"amount":"100"},{"amount":null}]}],"has_more":false,"next_page":null}`)
			default:
				t.Errorf("página inesperada %q", q.Get("page"))
			}
		case "/v1/organizations/cost_report?description":
			io.WriteString(w, `{"data":[{"results":[{"description":"Claude Opus 4.8 Usage - Input Tokens","amount":"1000"},`+
				`{"description":null,"model":"claude-haiku","token_type":"output","amount":"30"},{"description":"Web Search","amount":"0"}]}],"has_more":false}`)
		case "/v1/organizations/api_keys":
			if q.Get("limit") != "100" {
				t.Errorf("api_keys sem limit=100: %s", r.URL.RawQuery)
			}
			io.WriteString(w, `{"data":[{"id":"apikey_a","name":"gestortrafego"},{"id":"apikey_b","name":""}]}`)
		case "/v1/organizations/usage_report/messages?api_key_id":
			io.WriteString(w, `{"data":[{"results":[`+
				`{"api_key_id":"apikey_a","uncached_input_tokens":1000,"cache_read_input_tokens":500,"cache_creation_input_tokens":0,"output_tokens":100},`+
				`{"api_key_id":"apikey_b","uncached_input_tokens":3000,"output_tokens":0},`+
				`{"api_key_id":null,"uncached_input_tokens":0,"output_tokens":0}]}],"has_more":false}`)
		default:
			t.Errorf("rota inesperada %s", rota)
			w.WriteHeader(404)
		}
	}))
	t.Cleanup(srv.Close)
	return srv, func(rota string) int { mu.Lock(); defer mu.Unlock(); return hits[rota] }
}

func TestAnthropicFatura(t *testing.T) {
	if (Anthropic{}).cliente("k").http != semRedirecionar {
		t.Fatal("sem HTTP próprio, a Anthropic tem de usar semRedirecionar")
	}
	srv, _ := apiAnthropicFalsa(t, nil)
	f, err := Anthropic{Base: srv.URL, Pausa: semEspera}.Buscar(context.Background(), chaveFalsa, janelaDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(f)
	// Node 22 com as fórmulas de custo-anthropic/index.ts: CENTAVOS/100; totalBrl = Number((13.35*5.5).toFixed(2)) = 73.42;
	// rateio: pesos 1500+100×5 = 2000 e 3000 → 13.35×2000/5000 = 5.34 e 13.35×3000/5000 = 8.01; "" no nome cai no id.
	quer := `{"desde":"2026-09-13","ate":"2026-10-13","cambio":5.5,"totalUsd":13.35,"totalBrl":73.42,` +
		`"dias":[{"data":"2026-10-10","usd":12.35},{"data":"2026-10-11","usd":1}],` +
		`"porCategoria":[{"item":"Claude Opus 4.8 Usage - Input Tokens","usd":10},{"item":"claude-haiku / output","usd":0.3}],` +
		`"porChave":[{"nome":"apikey_b","tokensIn":3000,"tokensOut":0,"usdEstimado":8.01},{"nome":"gestortrafego","tokensIn":1500,"tokensOut":100,"usdEstimado":5.34}]}`
	if string(b) != quer {
		t.Fatalf("fatura =\n%s\nesperava\n%s", b, quer)
	}
}

func TestAnthropicDetalheQuebradoNaoDerrubaOTotal(t *testing.T) {
	srv, _ := apiAnthropicFalsa(t, map[string]http.HandlerFunc{
		"/v1/organizations/cost_report?description": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(503) },
		"/v1/organizations/usage_report/messages?api_key_id": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"results":[{"api_key_id":"apikey_a","uncached_input_tokens":10,"output_tokens":"muitos"}]}],"has_more":false}`)
		},
	})
	f, err := Anthropic{Base: srv.URL, Pausa: semEspera}.Buscar(context.Background(), chaveFalsa, janelaDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(f)
	if !strings.Contains(string(b), `"totalUsd":13.35`) || !strings.Contains(string(b), `"porCategoria":[],"porChave":[]`) {
		t.Fatalf("fatura = %s", b)
	}
}

func TestAnthropicTotalQuebradoFalhaSemChamarOsDetalhes(t *testing.T) {
	srv, hits := apiAnthropicFalsa(t, map[string]http.HandlerFunc{
		"/v1/organizations/cost_report": func(w http.ResponseWriter, _ *http.Request) {
			w.WriteHeader(401)
			io.WriteString(w, `{"error":"invalid x-api-key `+chaveFalsa+`"}`)
		},
	})
	_, err := Anthropic{Base: srv.URL, Pausa: semEspera}.Buscar(context.Background(), chaveFalsa, janelaDeTeste)
	quer := "Não consegui falar com o Anthropic agora (o Anthropic respondeu, e a resposta é essa). Tentei 1 vez. Tente de novo em instantes; se continuar, o Anthropic está fora do ar."
	if err == nil || err.Error() != quer {
		t.Fatalf("erro = %v", err)
	}
	for _, r := range []string{"/v1/organizations/cost_report?description", "/v1/organizations/api_keys", "/v1/organizations/usage_report/messages?api_key_id"} {
		if n := hits(r); n != 0 {
			t.Errorf("%s chamada %d vez(es) depois do total falhar", r, n)
		}
	}
}

func TestAnthropicAmountQueNaoENumero(t *testing.T) {
	srv, hits := apiAnthropicFalsa(t, map[string]http.HandlerFunc{
		"/v1/organizations/cost_report": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"starting_at":"2026-10-10T00:00:00Z","results":[{"amount":"abc"}]}],"has_more":false}`)
		},
	})
	_, err := Anthropic{Base: srv.URL, Pausa: semEspera}.Buscar(context.Background(), chaveFalsa, janelaDeTeste)
	if err == nil || err.Error() != "Resposta inesperada do Anthropic." {
		t.Fatalf("erro = %v", err)
	}
	if hits("/v1/organizations/api_keys") != 0 {
		t.Error("detalhes chamados depois de um total inválido")
	}
}

// Paginação dos detalhes, soma por nome entre páginas, "desconhecida", nomes que falham (caem no id)
// e empate estável.
func TestAnthropicDetalhesPaginadosERateio(t *testing.T) {
	srv, hits := apiAnthropicFalsa(t, map[string]http.HandlerFunc{
		"/v1/organizations/cost_report?description": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("page") == "" {
				io.WriteString(w, `{"data":[{"results":[{"description":"Y","amount":"100"},{"description":"X","amount":"100"}]}],"has_more":true,"next_page":"c2"}`)
				return
			}
			io.WriteString(w, `{"data":[{"results":[{"description":"X","amount":"200"},{"description":"Z","amount":"100"},{"amount":"50"},{"description":"","model":"m","amount":"0"}]}],"has_more":false}`)
		},
		"/v1/organizations/api_keys": func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(500) },
		"/v1/organizations/usage_report/messages?api_key_id": func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Query().Get("page") == "" {
				io.WriteString(w, `{"data":[{"results":[{"api_key_id":"key_b","uncached_input_tokens":300},{"api_key_id":"key_a","uncached_input_tokens":100}]}],"has_more":true,"next_page":"u2"}`)
				return
			}
			io.WriteString(w, `{"data":[{"results":[{"api_key_id":"key_a","cache_creation_input_tokens":200},{"api_key_id":null,"output_tokens":80}]}],"has_more":false}`)
		},
	})
	f, err := Anthropic{Base: srv.URL, Pausa: semEspera}.Buscar(context.Background(), chaveFalsa, janelaDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(f)
	// pesos 300, 300 (empate: key_b chegou primeiro) e 80×5 = 400; total 1000 → 13.35×400/1000 = 5.34, ×300/1000 = 4.005
	quer := `"porCategoria":[{"item":"X","usd":3},{"item":"Y","usd":1},{"item":"Z","usd":1},{"item":"? / ?","usd":0.5}],` +
		`"porChave":[{"nome":"desconhecida","tokensIn":0,"tokensOut":80,"usdEstimado":5.34},` +
		`{"nome":"key_b","tokensIn":300,"tokensOut":0,"usdEstimado":4.005},{"nome":"key_a","tokensIn":300,"tokensOut":0,"usdEstimado":4.005}]}`
	if !strings.HasSuffix(string(b), quer) {
		t.Fatalf("fatura =\n%s\nesperava terminar em\n%s", b, quer)
	}
	if hits("/v1/organizations/api_keys") != 3 {
		t.Errorf("api_keys: %d chamadas, esperava 3 (nova tentativa do cliente)", hits("/v1/organizations/api_keys"))
	}
}

// Arredondamento do rateio em 4 casas (toFixed do JS sobre o valor exato do float).
func TestAnthropicRateioArredondaEm4Casas(t *testing.T) {
	srv, _ := apiAnthropicFalsa(t, map[string]http.HandlerFunc{
		"/v1/organizations/usage_report/messages?api_key_id": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"results":[{"api_key_id":"a","uncached_input_tokens":100},{"api_key_id":"b","uncached_input_tokens":200},{"api_key_id":"c","output_tokens":80}]}],"has_more":false}`)
		},
	})
	f, err := Anthropic{Base: srv.URL, Pausa: semEspera}.Buscar(context.Background(), chaveFalsa, janelaDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(f)
	// pesos 100, 200, 400 de 700: 1.9071428… → 1.9071; 3.8142857… → 3.8143; 7.6285714… → 7.6286
	for _, quer := range []string{`"usdEstimado":1.9071}`, `"usdEstimado":3.8143}`, `"usdEstimado":7.6286}`} {
		if !strings.Contains(string(b), quer) {
			t.Errorf("faltou %s em %s", quer, b)
		}
	}
}

// Sem consumo nenhum: lista vazia (nada de divisão por zero nem NaN no JSON).
func TestAnthropicSemUsoNaoQuebra(t *testing.T) {
	srv, _ := apiAnthropicFalsa(t, map[string]http.HandlerFunc{
		"/v1/organizations/usage_report/messages?api_key_id": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"results":[{"api_key_id":"a","output_tokens":0}]}],"has_more":false}`)
		},
	})
	f, err := Anthropic{Base: srv.URL, Pausa: semEspera}.Buscar(context.Background(), chaveFalsa, janelaDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := json.Marshal(f); !strings.HasSuffix(string(b), `"porChave":[]}`) {
		t.Fatalf("fatura = %s", b)
	}
}

// O usd de cada dia é o valor cru (centavos/100); só o total é arredondado (index.ts:48-49, 183).
func TestAnthropicDiaNaoArredonda(t *testing.T) {
	srv, _ := apiAnthropicFalsa(t, map[string]http.HandlerFunc{
		"/v1/organizations/cost_report": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"starting_at":"2026-10-10T00:00:00Z","results":[{"amount":"1.234567"}]}],"has_more":false}`)
		},
	})
	f, err := Anthropic{Base: srv.URL, Pausa: semEspera}.Buscar(context.Background(), chaveFalsa, janelaDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(f)
	if !strings.Contains(string(b), `"totalUsd":0.0123,`) || !strings.Contains(string(b), `"dias":[{"data":"2026-10-10","usd":0.01234567}]`) {
		t.Fatalf("fatura = %s", b)
	}
}

// Um amount ilegível no extrato por descrição invalida o extrato inteiro (nada de lista pela metade).
func TestAnthropicDescricaoIlegivelZeraOExtrato(t *testing.T) {
	srv, _ := apiAnthropicFalsa(t, map[string]http.HandlerFunc{
		"/v1/organizations/cost_report?description": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"results":[{"description":"X","amount":"100"},{"description":"Y","amount":"abc"}]}],"has_more":false}`)
		},
	})
	f, err := Anthropic{Base: srv.URL, Pausa: semEspera}.Buscar(context.Background(), chaveFalsa, janelaDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := json.Marshal(f); !strings.Contains(string(b), `"totalUsd":13.35,`) || !strings.Contains(string(b), `"porCategoria":[],`) {
		t.Fatalf("fatura = %s", b)
	}
}

// Empate no 5º decimal: toFixed (valor exato do float) dá 1.001 onde Math.round(x*1e4)/1e4 daria 1.0011.
func TestAnthropicRateioUsaOToFixedENaoOMathRound(t *testing.T) {
	srv, _ := apiAnthropicFalsa(t, map[string]http.HandlerFunc{
		"/v1/organizations/cost_report": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"starting_at":"2026-10-10T00:00:00Z","results":[{"amount":"100.105"}]}],"has_more":false}`)
		},
		"/v1/organizations/usage_report/messages?api_key_id": func(w http.ResponseWriter, _ *http.Request) {
			io.WriteString(w, `{"data":[{"results":[{"api_key_id":"a","uncached_input_tokens":10}]}],"has_more":false}`)
		},
	})
	f, err := Anthropic{Base: srv.URL, Pausa: semEspera}.Buscar(context.Background(), chaveFalsa, janelaDeTeste)
	if err != nil {
		t.Fatal(err)
	}
	if b, _ := json.Marshal(f); !strings.Contains(string(b), `"totalUsd":1.001,`) || !strings.HasSuffix(string(b), `"usdEstimado":1.001}]}`) {
		t.Fatalf("fatura = %s", b)
	}
}
