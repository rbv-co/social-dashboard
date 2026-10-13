package mapa

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// pedido: o que o Nominatim de mentira recebeu.
type pedido struct {
	metodo, caminho, agente string
	query                   url.Values
	quando                  time.Time
}

// falso: o Nominatim de mentira. Grava cada pedido e responde pelo `resposta`.
type falso struct {
	*httptest.Server
	mu      sync.Mutex
	pedidos []pedido
	// resposta devolve status e corpo; nil = 200 com lista/objeto de teste
	resposta func(r *http.Request) (int, string)
}

func novoFalso(t *testing.T, resposta func(r *http.Request) (int, string)) *falso {
	f := &falso{resposta: resposta}
	f.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		f.pedidos = append(f.pedidos, pedido{r.Method, r.URL.Path, r.Header.Get("User-Agent"), r.URL.Query(), time.Now()})
		f.mu.Unlock()
		status, corpo := http.StatusOK, `[{"display_name":"Shopping Iguatemi","lat":"-23.5","lon":"-46.6"}]`
		if strings.HasSuffix(r.URL.Path, "/reverse") {
			corpo = `{"display_name":"Av. Paulista","address":{"road":"Av. Paulista"}}`
		}
		if f.resposta != nil {
			status, corpo = f.resposta(r)
		}
		w.WriteHeader(status)
		w.Write([]byte(corpo))
	}))
	t.Cleanup(f.Close)
	return f
}

func (f *falso) n() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.pedidos)
}

func (f *falso) ultimo() pedido {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.pedidos[len(f.pedidos)-1]
}

func novoMapa(f *falso) *Mapa {
	m := Novo()
	m.base = f.URL
	m.intervalo = 50 * time.Millisecond
	return m
}

func pedir(m *Mapa, id string, corpo string) *httptest.ResponseRecorder {
	return pedirCtx(context.Background(), m, id, corpo)
}

func pedirCtx(ctx context.Context, m *Mapa, id string, corpo string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(http.MethodPost, "/buscar-lugar", strings.NewReader(corpo))
	if id != "" {
		r = r.WithContext(auth.NoContexto(ctx, &auth.Ator{ID: id, Tipo: "painel", Papel: "admin"}))
	} else {
		r = r.WithContext(ctx)
	}
	w := httptest.NewRecorder()
	m.ServeHTTP(w, r)
	return w
}

func objeto(t *testing.T, w *httptest.ResponseRecorder) map[string]json.RawMessage {
	t.Helper()
	var o map[string]json.RawMessage
	if err := json.Unmarshal(w.Body.Bytes(), &o); err != nil {
		t.Fatalf("resposta não é um objeto JSON: %v: %s", err, w.Body.String())
	}
	return o
}

func quer(t *testing.T, w *httptest.ResponseRecorder, status int, frase string) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status = %d (%s), quero %d", w.Code, w.Body.String(), status)
	}
	if frase != "" {
		var o map[string]string
		json.Unmarshal(w.Body.Bytes(), &o)
		if o["error"] != frase {
			t.Fatalf("error = %q, quero %q (%s)", o["error"], frase, w.Body.String())
		}
	}
}

func TestBuscarLugar(t *testing.T) {
	t.Run("buscar: pedido ao Nominatim, cache e SSRF", func(t *testing.T) {
		f := novoFalso(t, nil)
		m := novoMapa(f)

		w := pedir(m, "u1", `{"acao":"buscar","termo":"Shopping Iguatemi"}`)
		quer(t, w, 200, "")
		o := objeto(t, w)
		if _, tem := o["doCache"]; tem || !strings.HasPrefix(string(o["lugares"]), `[{"display_name":"Shopping Iguatemi"`) {
			t.Fatalf("corpo = %s", w.Body.String())
		}
		if f.n() != 1 {
			t.Fatalf("pedidos = %d, quero 1", f.n())
		}
		p := f.ultimo()
		if p.metodo != "GET" || p.caminho != "/search" || p.agente != quemSou {
			t.Fatalf("pedido = %+v", p)
		}
		for k, v := range map[string]string{"q": "Shopping Iguatemi", "countrycodes": "br", "format": "jsonv2", "limit": "8", "addressdetails": "1"} {
			if p.query.Get(k) != v {
				t.Fatalf("query %s = %q, quero %q", k, p.query.Get(k), v)
			}
		}

		w = pedir(m, "u1", `{"acao":"buscar","termo":"  shopping iguatemi "}`)
		quer(t, w, 200, "")
		if string(objeto(t, w)["doCache"]) != "true" || f.n() != 1 {
			t.Fatalf("esperava cache e 1 pedido: %s, pedidos=%d", w.Body.String(), f.n())
		}
	})

	t.Run("SSRF: termo hostil fica no q, caminho fixo, redirecionamento não é seguido", func(t *testing.T) {
		alvo := novoFalso(t, nil) // o que o redirecionamento tentaria alcançar
		f := novoFalso(t, func(r *http.Request) (int, string) { return 0, "" })
		f.Server.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			f.mu.Lock()
			f.pedidos = append(f.pedidos, pedido{r.Method, r.URL.Path, r.Header.Get("User-Agent"), r.URL.Query(), time.Now()})
			f.mu.Unlock()
			if r.URL.Query().Get("q") == "redireciona" {
				http.Redirect(w, r, alvo.URL+"/interno", http.StatusFound)
				return
			}
			w.Write([]byte(`[]`))
		})
		m := novoMapa(f)

		hostil := "../../admin?x=1@evil.com/%2F"
		quer(t, pedir(m, "u1", `{"acao":"buscar","termo":"  `+hostil+`  "}`), 200, "")
		p := f.ultimo()
		if p.caminho != "/search" || p.query.Get("q") != hostil {
			t.Fatalf("caminho = %q, q = %q", p.caminho, p.query.Get("q"))
		}

		quer(t, pedir(m, "u1", `{"acao":"buscar","termo":"redireciona"}`), 502, "o servico de mapa respondeu 302")
		if alvo.n() != 0 {
			t.Fatalf("o redirecionamento foi seguido: %d pedido(s) ao alvo", alvo.n())
		}
		if Novo().base != "https://nominatim.openstreetmap.org" {
			t.Fatalf("base = %q", Novo().base)
		}
	})

	t.Run("ondeCaiu: reverse, cache de 5 casas e erro sem cache", func(t *testing.T) {
		f := novoFalso(t, nil)
		m := novoMapa(f)

		w := pedir(m, "u1", `{"acao":"ondeCaiu","lat":-23.5,"lng":-46.6}`)
		quer(t, w, 200, "")
		o := objeto(t, w)
		if string(o["display_name"]) != `"Av. Paulista"` {
			t.Fatalf("corpo = %s", w.Body.String())
		}
		if _, tem := o["doCache"]; tem {
			t.Fatalf("a primeira não vem do cache: %s", w.Body.String())
		}
		p := f.ultimo()
		if p.metodo != "GET" || p.caminho != "/reverse" || p.query.Get("lat") != "-23.5" || p.query.Get("lon") != "-46.6" ||
			p.query.Get("format") != "jsonv2" || p.query.Get("addressdetails") != "1" || p.agente != quemSou {
			t.Fatalf("pedido = %+v", p)
		}

		w = pedir(m, "u1", `{"acao":"ondeCaiu","lat":-23.500001,"lng":-46.6}`)
		quer(t, w, 200, "")
		o = objeto(t, w)
		if string(o["doCache"]) != "true" || string(o["display_name"]) != `"Av. Paulista"` || f.n() != 1 {
			t.Fatalf("esperava cache e 1 pedido: %s, pedidos=%d", w.Body.String(), f.n())
		}

		// o mar: o Nominatim devolve {"error":...}; volta igual, mas não é guardado
		mar := novoFalso(t, func(r *http.Request) (int, string) { return 200, `{"error":"Unable to geocode"}` })
		m2 := novoMapa(mar)
		for i := 1; i <= 2; i++ {
			w = pedir(m2, "u1", `{"acao":"ondeCaiu","lat":0,"lng":0}`)
			quer(t, w, 200, "")
			if string(objeto(t, w)["error"]) != `"Unable to geocode"` || strings.Contains(w.Body.String(), "doCache") {
				t.Fatalf("corpo = %s", w.Body.String())
			}
			if mar.n() != i {
				t.Fatalf("pedidos = %d, quero %d (o erro foi para o cache)", mar.n(), i)
			}
		}
	})

	t.Run("negados não chegam ao Nominatim", func(t *testing.T) {
		f := novoFalso(t, nil)
		m := novoMapa(f)
		casos := []struct {
			corpo, frase string
			status       int
		}{
			{`{"acao":"buscar","termo":"ab"}`, "digite pelo menos 3 letras", 400},
			{`{"acao":"buscar","termo":"  a  "}`, "digite pelo menos 3 letras", 400},
			{`{"acao":"buscar"}`, "digite pelo menos 3 letras", 400},
			{`{"acao":"buscar","termo":"` + strings.Repeat("a", 201) + `"}`, "termo longo demais", 400},
			{`{"acao":"ondeCaiu","lat":91,"lng":0}`, "coordenada invalida", 400},
			{`{"acao":"ondeCaiu","lat":-91,"lng":0}`, "coordenada invalida", 400},
			{`{"acao":"ondeCaiu","lat":0,"lng":-181}`, "coordenada invalida", 400},
			{`{"acao":"ondeCaiu","lat":0,"lng":181}`, "coordenada invalida", 400},
			{`{"acao":"ondeCaiu","lng":0}`, "coordenada invalida", 400},
			{`{"acao":"ondeCaiu","lat":0}`, "coordenada invalida", 400},
			{`{"acao":"apagar"}`, "acao desconhecida", 400},
			{`{}`, "acao desconhecida", 400},
			{`lixo`, "corpo_invalido", 400},
			{`null`, "corpo_invalido", 400},
			{`{"acao":"buscar","termo":"abc","extra":1}`, "corpo_invalido", 400},
		}
		for _, c := range casos {
			quer(t, pedir(m, "u1", c.corpo), c.status, c.frase)
		}
		// 201 caracteres de verdade (não bytes): 200 letras acentuadas passam do limite de bytes, mas não do de caracteres
		quer(t, pedir(m, "u1", `{"acao":"buscar","termo":"`+strings.Repeat("é", 200)+`"}`), 200, "")
		antes := f.n()
		quer(t, pedir(m, "", `{"acao":"buscar","termo":"abc"}`), 401, "")
		if f.n() != antes || antes != 1 {
			t.Fatalf("pedidos = %d (antes do 401: %d), quero só o dos 200 caracteres", f.n(), antes)
		}
	})

	t.Run("upstream com defeito", func(t *testing.T) {
		quebrado := true
		f := novoFalso(t, func(r *http.Request) (int, string) {
			if quebrado {
				return 503, `[]`
			}
			return 200, `[]`
		})
		m := novoMapa(f)
		quer(t, pedir(m, "u1", `{"acao":"buscar","termo":"abc"}`), 502, "o servico de mapa respondeu 503")
		quebrado = false
		// o 503 não foi para o cache: o seguinte vai de novo ao servidor
		w := pedir(m, "u1", `{"acao":"buscar","termo":"abc"}`)
		quer(t, w, 200, "")
		if f.n() != 2 || strings.Contains(w.Body.String(), "doCache") {
			t.Fatalf("pedidos = %d, corpo = %s", f.n(), w.Body.String())
		}

		grande := novoFalso(t, func(r *http.Request) (int, string) {
			return 200, `"` + strings.Repeat("a", tetoDaResposta-1) + `"` // JSON válido de 1 MiB + 1 byte
		})
		quer(t, pedir(novoMapa(grande), "u1", `{"acao":"buscar","termo":"abc"}`), 502, "o servico de mapa respondeu algo ilegivel")

		naoJSON := novoFalso(t, func(r *http.Request) (int, string) { return 200, `<html>` })
		quer(t, pedir(novoMapa(naoJSON), "u1", `{"acao":"buscar","termo":"abc"}`), 502, "o servico de mapa respondeu algo ilegivel")
		quer(t, pedir(novoMapa(naoJSON), "u1", `{"acao":"ondeCaiu","lat":1,"lng":1}`), 502, "o servico de mapa respondeu algo ilegivel")

		// um array no reverse (o Nominatim não faz isso, mas a recepção não pode quebrar)
		arr := novoFalso(t, func(r *http.Request) (int, string) { return 200, `[]` })
		quer(t, pedir(novoMapa(arr), "u1", `{"acao":"ondeCaiu","lat":1,"lng":1}`), 502, "o servico de mapa respondeu algo ilegivel")

		solta := make(chan struct{})
		mudo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			select {
			case <-r.Context().Done():
			case <-solta:
			}
		}))
		t.Cleanup(func() { close(solta); mudo.Close() })
		m3 := Novo()
		m3.base, m3.intervalo = mudo.URL, 10*time.Millisecond
		ctx, cancela := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancela()
		quer(t, pedirCtx(ctx, m3, "u1", `{"acao":"buscar","termo":"abc"}`), 502, "o servico de mapa nao respondeu")
	})

	t.Run("ritmo: pelo menos o intervalo entre as ligações", func(t *testing.T) {
		f := novoFalso(t, nil)
		m := novoMapa(f)
		var wg sync.WaitGroup
		for _, termo := range []string{"primeiro", "segundo", "terceiro"} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				quer(t, pedir(m, "u1", `{"acao":"buscar","termo":"`+termo+`"}`), 200, "")
			}()
		}
		wg.Wait()
		if f.n() != 3 {
			t.Fatalf("pedidos = %d", f.n())
		}
		for i := 1; i < 3; i++ {
			// folga de 5 ms: o relógio do servidor é lido depois da chegada, e o do cliente, antes da saída
			if d := f.pedidos[i].quando.Sub(f.pedidos[i-1].quando); d < m.intervalo-5*time.Millisecond {
				t.Fatalf("pedidos %d e %d chegaram com %v de intervalo, quero >= %v", i-1, i, d, m.intervalo)
			}
		}
	})

	t.Run("quem espera desiste com o prazo da rota", func(t *testing.T) {
		f := novoFalso(t, nil)
		m := novoMapa(f)
		m.intervalo = time.Hour
		quer(t, pedir(m, "u1", `{"acao":"buscar","termo":"uns"}`), 200, "") // a primeira não espera: ultima é zero
		ctx, cancela := context.WithTimeout(context.Background(), 100*time.Millisecond)
		defer cancela()
		quer(t, pedirCtx(ctx, m, "u1", `{"acao":"buscar","termo":"dois"}`), 502, "o servico de mapa nao respondeu")
		if f.n() != 1 {
			t.Fatalf("pedidos = %d, quero 1", f.n())
		}
	})

	t.Run("limite por pessoa, contado antes do cache", func(t *testing.T) {
		f := novoFalso(t, nil)
		m := novoMapa(f)
		m.lim.Max = 2
		quer(t, pedir(m, "u1", `{"acao":"buscar","termo":"abc"}`), 200, "")
		quer(t, pedir(m, "u1", `{"acao":"buscar","termo":"abc"}`), 200, "") // cache, mas conta
		quer(t, pedir(m, "u1", `{"acao":"buscar","termo":"abc"}`), 429, "muitas buscas seguidas; espere um minuto")
		quer(t, pedir(m, "u1", `{"acao":"buscar","termo":"novo termo"}`), 429, "muitas buscas seguidas; espere um minuto")
		if f.n() != 1 {
			t.Fatalf("pedidos = %d, quero 1", f.n())
		}
		quer(t, pedir(m, "u2", `{"acao":"buscar","termo":"abc"}`), 200, "")
	})

	t.Run("cache cheio: sai uma chave e o teto se mantém", func(t *testing.T) {
		m := Novo()
		for i := 0; i < tetoDoCache+10; i++ {
			m.guardar("k"+string(rune('a'+i%26))+strings.Repeat("x", i), []byte(`1`))
		}
		if len(m.cache) > tetoDoCache {
			t.Fatalf("cache com %d chaves, teto %d", len(m.cache), tetoDoCache)
		}
		m.cache["velha"] = guardado{time.Now().Add(-validade - time.Second), []byte(`1`)}
		if _, ok := m.doCache("velha"); ok {
			t.Fatal("entrada vencida voltou do cache")
		}
	})
}

func TestBuscarLugarSemTermoNoLog(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(antes) })

	// o caminho feliz e os dois de falha, que são os que logam
	f := novoFalso(t, nil)
	m := novoMapa(f)
	quer(t, pedir(m, "u1", `{"acao":"buscar","termo":"Segredo Do Termo"}`), 200, "")
	quer(t, pedir(m, "u1", `{"acao":"ondeCaiu","lat":-23.5,"lng":-46.6}`), 200, "")
	ruim := novoFalso(t, func(r *http.Request) (int, string) { return 503, `[]` })
	m2 := novoMapa(ruim)
	quer(t, pedir(m2, "u1", `{"acao":"buscar","termo":"Segredo Do Termo"}`), 502, "")
	quer(t, pedir(m2, "u1", `{"acao":"ondeCaiu","lat":-23.5,"lng":-46.6}`), 502, "")
	ctx, cancela := context.WithCancel(context.Background())
	cancela()
	quer(t, pedirCtx(ctx, m, "u1", `{"acao":"buscar","termo":"Segredo Do Termo outro"}`), 502, "")

	if log.Len() == 0 {
		t.Fatal("o teste não exercitou nenhum log")
	}
	for _, proibido := range []string{"Segredo", "segredo", "-23.5", "-46.6", "23.5"} {
		if strings.Contains(log.String(), proibido) {
			t.Fatalf("o log vazou %q:\n%s", proibido, log.String())
		}
	}
}
