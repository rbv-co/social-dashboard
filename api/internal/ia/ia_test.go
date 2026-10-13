package ia

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

const (
	chaveTeste = "SEGREDO-chave-ia"
	contaA1    = "11111111-1111-1111-1111-111111111111"
	contaA2    = "22222222-2222-2222-2222-222222222222"
)

// anthropicFalsa: a Anthropic de mentira. Conta os pedidos, guarda o último corpo e os cabeçalhos e
// responde o que o caso mandou.
type anthropicFalsa struct {
	srv    *httptest.Server
	mu     sync.Mutex
	n      int
	corpo  []byte
	cab    http.Header
	status int
	resp   string
}

func novaFalsa(t *testing.T, status int, resp string) *anthropicFalsa {
	f := &anthropicFalsa{status: status, resp: resp}
	f.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b := new(bytes.Buffer)
		b.ReadFrom(r.Body)
		f.mu.Lock()
		f.n, f.corpo, f.cab = f.n+1, b.Bytes(), r.Header.Clone()
		st, rs := f.status, f.resp
		f.mu.Unlock()
		w.WriteHeader(st)
		w.Write([]byte(rs))
	}))
	t.Cleanup(f.srv.Close)
	return f
}

func (f *anthropicFalsa) pedidos() int { f.mu.Lock(); defer f.mu.Unlock(); return f.n }

func (f *anthropicFalsa) responder(status int, resp string) {
	f.mu.Lock()
	f.status, f.resp = status, resp
	f.mu.Unlock()
}

// recebido: o último corpo enviado à Anthropic, já lido.
func (f *anthropicFalsa) recebido(t *testing.T) map[string]any {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	var m map[string]any
	if err := json.Unmarshal(f.corpo, &m); err != nil {
		t.Fatalf("corpo enviado à Anthropic: %v (%q)", err, f.corpo)
	}
	return m
}

func (f *anthropicFalsa) prompt(t *testing.T) string {
	t.Helper()
	msgs := f.recebido(t)["messages"].([]any)
	return msgs[0].(map[string]any)["content"].(string)
}

type pessoa struct {
	ator   *auth.Ator
	escopo *autz.Escopo
}

var (
	gestor = pessoa{&auth.Ator{ID: "gestor", Tipo: "painel", Modulos: []string{"meta.gestor"}},
		&autz.Escopo{ID: "gestor", TemPerfil: true, Ativo: true, Contas: []string{contaA1}}}
	super = pessoa{&auth.Ator{ID: "super", Tipo: "painel", SuperAdmin: true},
		&autz.Escopo{ID: "super", TemPerfil: true, Ativo: true, SuperFicha: true, TodasContas: true}}
	leitor = pessoa{&auth.Ator{ID: "leitor", Tipo: "painel", Modulos: []string{"meta"}},
		&autz.Escopo{ID: "leitor", TemPerfil: true, Ativo: true, Contas: []string{contaA1}}}
)

// chamar: o portão da montagem (auth.ExigirModulo("meta.gestor")) sobre o handler, com ator e escopo no contexto.
func chamar(h http.HandlerFunc, p pessoa, corpo string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/x", strings.NewReader(corpo))
	ctx := autz.NoContexto(auth.NoContexto(req.Context(), p.ator), p.escopo)
	w := httptest.NewRecorder()
	auth.ExigirModulo("meta.gestor")(h).ServeHTTP(w, req.WithContext(ctx))
	return w
}

func lido(t *testing.T, w *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &m); err != nil {
		t.Fatalf("resposta não é JSON: %v (%q)", err, w.Body.String())
	}
	return m
}

func iaDe(f *anthropicFalsa) *IA {
	ia := Nova(chaveTeste)
	ia.claude.url = f.srv.URL
	return ia
}

func exigir(t *testing.T, w *httptest.ResponseRecorder, status int, campos map[string]any) {
	t.Helper()
	if w.Code != status {
		t.Fatalf("status = %d, quer %d (%s)", w.Code, status, w.Body.String())
	}
	m := lido(t, w)
	for k, v := range campos {
		if gj, wj := mustJSON(m[k]), mustJSON(v); gj != wj {
			t.Errorf("%s = %s, quer %s", k, gj, wj)
		}
	}
	if strings.Contains(w.Body.String(), chaveTeste) {
		t.Error("a chave vazou na resposta")
	}
}

func mustJSON(v any) string { b, _ := json.Marshal(v); return string(b) }

func corpoPublico(extra string) string {
	return `{"evidencia":{"interesses":[{"key":"6003","nome":"Moda"},{"key":6004,"nome":"Bolsas"}],"idade":"25-34"},` +
		`"marca":"Vessel","objetivo":"Seguidores","persona":"  SEGREDO-PERSONA mulheres 30+  ","contaId":"` + contaA1 + `"` + extra + `}`
}

func textoDaIA(t string) string {
	return mustJSON(map[string]any{"content": []any{map[string]any{"type": "text", "text": t}}, "usage": map[string]any{"input_tokens": 5}})
}

func TestSugerirPublico(t *testing.T) {
	t.Run("feliz", func(t *testing.T) {
		f := novaFalsa(t, 200, textoDaIA(`Aqui: {"leitura":"L","interesses":[{"id":"6003"},{"id":"9999"},{"id":"6003"},{"id":6004}],"cuidado":"C"} fim`))
		w := chamar(iaDe(f).SugerirPublico, gestor, corpoPublico(""))
		exigir(t, w, 200, map[string]any{"ok": true, "leitura": "L", "cuidado": "C", "uso": map[string]any{"input_tokens": 5},
			"interesses": []any{map[string]any{"id": "6003", "nome": "Moda"}, map[string]any{"id": "6004", "nome": "Bolsas"}}})
		if f.pedidos() != 1 {
			t.Fatalf("pedidos = %d", f.pedidos())
		}
		if f.cab.Get("x-api-key") != chaveTeste || f.cab.Get("anthropic-version") != "2023-06-01" || f.cab.Get("content-type") != "application/json" {
			t.Errorf("cabeçalhos: %v", f.cab)
		}
		m := f.recebido(t)
		if m["model"] != "claude-opus-4-5" || m["max_tokens"] != float64(1600) || len(m["messages"].([]any)) != 1 {
			t.Errorf("corpo: %v", m)
		}
		if m["messages"].([]any)[0].(map[string]any)["role"] != "user" {
			t.Error("role")
		}
		p := f.prompt(t)
		for _, quer := range []string{"A marca é: Vessel.", "<persona>\nSEGREDO-PERSONA mulheres 30+\n</persona>", `"key":6004`,
			"O tipo de campanha que está sendo criada: Seguidores."} {
			if !strings.Contains(p, quer) {
				t.Errorf("prompt sem %q", quer)
			}
		}
		if strings.Contains(p, "\n\n") {
			t.Error("prompt com linha vazia (o filter(Boolean) da edge)")
		}
	})

	t.Run("modo texto corta em 3 antes de filtrar", func(t *testing.T) {
		f := novaFalsa(t, 200, textoDaIA(`{"leitura":"x","sugestoes":["a","","b","c","d"],"cuidado":"y"}`))
		w := chamar(iaDe(f).SugerirPublico, gestor, corpoPublico(`,"modo":"texto"`))
		exigir(t, w, 200, map[string]any{"ok": true, "leitura": "x", "sugestoes": []any{"a", "b"}, "cuidado": "y"})
		if !strings.Contains(f.prompt(t), `os itens em "vagas"`) {
			t.Error("não é o prompt de texto")
		}
		if _, tem := lido(t, w)["interesses"]; tem {
			t.Error("modo texto não devolve interesses")
		}
	})

	t.Run("super lê qualquer conta", func(t *testing.T) {
		f := novaFalsa(t, 200, textoDaIA(`{"leitura":"L","interesses":[],"cuidado":"C"}`))
		corpo := strings.Replace(corpoPublico(""), contaA1, contaA2, 1)
		exigir(t, chamar(iaDe(f).SugerirPublico, super, corpo), 200, map[string]any{"ok": true, "interesses": []any{}})
	})

	t.Run("limites de texto", func(t *testing.T) {
		f := novaFalsa(t, 200, textoDaIA(`{"leitura":"`+strings.Repeat("l", 2000)+`","cuidado":"`+strings.Repeat("c", 900)+`"}`))
		corpo := mustJSON(map[string]any{"evidencia": map[string]any{}, "contaId": contaA1,
			"marca": strings.Repeat("m", 300), "objetivo": strings.Repeat("o", 300), "persona": "   " + strings.Repeat("p", 5000)})
		w := chamar(iaDe(f).SugerirPublico, gestor, corpo)
		m := lido(t, w)
		if len(m["leitura"].(string)) != 1200 || len(m["cuidado"].(string)) != 400 {
			t.Errorf("leitura/cuidado: %d/%d", len(m["leitura"].(string)), len(m["cuidado"].(string)))
		}
		p := f.prompt(t)
		if !strings.Contains(p, strings.Repeat("m", 200)+".") || strings.Contains(p, strings.Repeat("m", 201)) ||
			strings.Contains(p, strings.Repeat("o", 201)) || !strings.Contains(p, "\n"+strings.Repeat("p", 4000)+"\n</persona>") {
			t.Error("marca/objetivo em 200 e persona aparada em 4000")
		}
	})

	negados := []struct {
		nome   string
		quem   pessoa
		corpo  string
		status int
		erro   string
	}{
		{"leitor sem o módulo", leitor, corpoPublico(""), 403, "sem_permissao"},
		{"conta que não vê", gestor, strings.Replace(corpoPublico(""), contaA1, contaA2, 1), 404, "conta_nao_encontrada"},
		{"sem contaId", gestor, `{"evidencia":{}}`, 400, "sem_conta"},
		{"contaId inválido", gestor, `{"evidencia":{},"contaId":"x"}`, 400, "sem_conta"},
		{"sem evidência", gestor, `{"contaId":"` + contaA1 + `"}`, 400, "sem_evidencia"},
		{"evidência array", gestor, `{"evidencia":[],"contaId":"` + contaA1 + `"}`, 400, "sem_evidencia"},
		{"evidência texto", gestor, `{"evidencia":"x","contaId":"` + contaA1 + `"}`, 400, "sem_evidencia"},
		{"corpo lixo", gestor, `lixo`, 400, "corpo_invalido"},
		{"campo extra", gestor, `{"evidencia":{},"contaId":"` + contaA1 + `","extra":1}`, 400, "corpo_invalido"},
	}
	for _, c := range negados {
		t.Run("negado: "+c.nome, func(t *testing.T) {
			f := novaFalsa(t, 200, textoDaIA(`{}`))
			exigir(t, chamar(iaDe(f).SugerirPublico, c.quem, c.corpo), c.status, map[string]any{"error": c.erro})
			if f.pedidos() != 0 {
				t.Fatalf("a Anthropic recebeu %d pedido(s)", f.pedidos())
			}
		})
	}

	t.Run("sem chave", func(t *testing.T) {
		f := novaFalsa(t, 200, textoDaIA(`{}`))
		ia := Nova("")
		ia.claude.url = f.srv.URL
		exigir(t, chamar(ia.SugerirPublico, gestor, corpoPublico("")), 503, map[string]any{"error": "chave_nao_configurada",
			"comoResolver": "Configure ANTHROPIC_API_KEY_TRAFEGO no serviço api e reinicie."})
		if f.pedidos() != 0 {
			t.Fatal("chamou a Anthropic sem chave")
		}
	})

	t.Run("limite por pessoa", func(t *testing.T) {
		f := novaFalsa(t, 200, textoDaIA(`{"leitura":"L"}`))
		ia := iaDe(f)
		ia.limSugerir.Max = 1
		exigir(t, chamar(ia.SugerirPublico, gestor, corpoPublico("")), 200, nil)
		exigir(t, chamar(ia.SugerirPublico, gestor, corpoPublico("")), 429, map[string]any{"error": "muitas_leituras",
			"detalhe": "São no máximo 30 leituras da IA por hora por pessoa."})
		if f.pedidos() != 1 {
			t.Fatalf("pedidos = %d, quer 1", f.pedidos())
		}
		exigir(t, chamar(ia.SugerirPublico, super, corpoPublico("")), 200, nil) // outra pessoa tem a cota dela
		if lim := Nova("x"); lim.limSugerir.Max != 30 || lim.limDocumento.Max != 10 {
			t.Errorf("limites: %d/%d", lim.limSugerir.Max, lim.limDocumento.Max)
		}
	})

	t.Run("a requisição inválida não gasta cota", func(t *testing.T) {
		f := novaFalsa(t, 200, textoDaIA(`{"leitura":"L"}`))
		ia := iaDe(f)
		ia.limSugerir.Max = 1
		chamar(ia.SugerirPublico, gestor, `{"evidencia":{}}`) // sem_conta
		exigir(t, chamar(ia.SugerirPublico, gestor, corpoPublico("")), 200, nil)
	})

	t.Run("erros da Anthropic", func(t *testing.T) {
		f := novaFalsa(t, 529, `{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}`)
		ia := iaDe(f)
		exigir(t, chamar(ia.SugerirPublico, gestor, corpoPublico("")), 502, map[string]any{"error": "anthropic_recusou", "status": 529, "detalhe": "Overloaded"})
		f.responder(500, "oops")
		exigir(t, chamar(ia.SugerirPublico, gestor, corpoPublico("")), 502, map[string]any{"error": "anthropic_recusou", "status": 500, "detalhe": "{}"})
		f.responder(200, textoDaIA("sem json"))
		exigir(t, chamar(ia.SugerirPublico, gestor, corpoPublico("")), 502, map[string]any{"error": "resposta_ilegivel", "bruto": "sem json"})
	})

	t.Run("anthropic fora do ar", func(t *testing.T) {
		f := novaFalsa(t, 200, "")
		ia := iaDe(f)
		f.srv.Close()
		exigir(t, chamar(ia.SugerirPublico, gestor, corpoPublico("")), 502, map[string]any{"error": "anthropic_inacessivel"})
	})

	t.Run("não segue redirecionamento", func(t *testing.T) {
		segundo := novaFalsa(t, 200, textoDaIA(`{}`))
		f := novaFalsa(t, 307, "")
		ia := iaDe(f)
		// o primeiro servidor responde 307 para o segundo
		f.srv.Config.Handler = http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			http.Redirect(w, r, segundo.srv.URL, http.StatusTemporaryRedirect)
		})
		exigir(t, chamar(ia.SugerirPublico, gestor, corpoPublico("")), 502, map[string]any{"error": "anthropic_recusou", "status": 307})
		if segundo.pedidos() != 0 {
			t.Fatal("seguiu o redirecionamento (a chave iria junto)")
		}
	})
}

func pdfB64(quebras bool) (string, string) {
	puro := base64.StdEncoding.EncodeToString([]byte("%PDF-1.4 SEGREDO-DOC conteúdo"))
	if !quebras {
		return puro, puro
	}
	var b strings.Builder
	for i := 0; i < len(puro); i += 10 {
		b.WriteString(puro[i:min(i+10, len(puro))] + "\n")
	}
	return b.String(), puro
}

func corpoDoc(b64 string, limite string) string {
	s := mustJSON(map[string]any{"base64": b64})
	if limite != "" {
		s = strings.TrimSuffix(s, "}") + `,"limite":` + limite + "}"
	}
	return s
}

const respostaDoc = `{"content":[{"type":"text","text":"  Mulheres 30 a 45 anos  "}],"stop_reason":"end_turn","usage":{"input_tokens":5}}`

func TestLerDocumento(t *testing.T) {
	t.Run("feliz", func(t *testing.T) {
		f := novaFalsa(t, 200, respostaDoc)
		comQuebras, puro := pdfB64(true)
		w := chamar(iaDe(f).LerDocumento, gestor, corpoDoc(comQuebras, "10"))
		exigir(t, w, 200, map[string]any{"ok": true, "texto": "Mulheres 3", "uso": map[string]any{"input_tokens": 5}})
		m := f.recebido(t)
		ef := m["output_config"].(map[string]any)
		if m["model"] != "claude-opus-5" || m["max_tokens"] != float64(8000) || ef["effort"] != "low" {
			t.Errorf("corpo: %v", m)
		}
		if f.cab.Get("x-api-key") != chaveTeste || f.cab.Get("anthropic-version") != "2023-06-01" {
			t.Errorf("cabeçalhos: %v", f.cab)
		}
		c := m["messages"].([]any)[0].(map[string]any)["content"].([]any)
		doc := c[0].(map[string]any)
		src := doc["source"].(map[string]any)
		if doc["type"] != "document" || src["type"] != "base64" || src["media_type"] != "application/pdf" || src["data"] != puro {
			t.Errorf("documento: %v", doc)
		}
		if c[1].(map[string]any)["type"] != "text" || !strings.Contains(c[1].(map[string]any)["text"].(string), "- no máximo 10 caracteres;") {
			t.Errorf("pedido: %v", c[1])
		}
	})

	t.Run("limite", func(t *testing.T) {
		for limite, quer := range map[string]string{"": "4000", "20000": "8000", "-5": "4000", "0": "4000", `"x"`: "4000", "7.5": "7", "8000": "8000"} {
			f := novaFalsa(t, 200, respostaDoc)
			b64, _ := pdfB64(false)
			exigir(t, chamar(iaDe(f).LerDocumento, gestor, corpoDoc(b64, limite)), 200, nil)
			c := f.recebido(t)["messages"].([]any)[0].(map[string]any)["content"].([]any)
			if !strings.Contains(c[1].(map[string]any)["text"].(string), "- no máximo "+quer+" caracteres;") {
				t.Errorf("limite %q: %v", limite, c[1])
			}
		}
	})

	gif := base64.StdEncoding.EncodeToString([]byte("GIF89a......"))
	grande := strings.Repeat("A", 4_500_004)
	negados := []struct {
		nome   string
		quem   pessoa
		corpo  string
		status int
		erro   string
		trecho string
	}{
		{"leitor sem o módulo", leitor, corpoDoc(gif, ""), 403, "sem_sermissao", ""},
		{"vazio", gestor, `{"base64":""}`, 400, "sem_arquivo", ""},
		{"só espaços", gestor, `{"base64":" \n "}`, 400, "sem_arquivo", ""},
		{"corpo lixo", gestor, `lixo`, 400, "corpo_invalido", ""},
		{"não é base64", gestor, `{"base64":"não-base64!!"}`, 400, "nao_e_pdf", "O arquivo não é um PDF."},
		{"é um GIF", gestor, corpoDoc(gif, ""), 400, "nao_e_pdf", "O arquivo não é um PDF."},
		{"base64 grande demais", gestor, corpoDoc(grande, ""), 413, "arquivo_grande_demais", "limite aqui é 3 MB"},
		{"corpo de 5 MB", gestor, strings.Repeat("a", 5<<20), 413, "arquivo_grande_demais", "O PDF passa do limite de 3 MB."},
	}
	negados[0].erro = "sem_permissao"
	for _, c := range negados {
		t.Run("negado: "+c.nome, func(t *testing.T) {
			f := novaFalsa(t, 200, respostaDoc)
			w := chamar(iaDe(f).LerDocumento, c.quem, c.corpo)
			exigir(t, w, c.status, map[string]any{"error": c.erro})
			if d, _ := lido(t, w)["detalhe"].(string); !strings.Contains(d, c.trecho) {
				t.Errorf("detalhe = %q, quer conter %q", d, c.trecho)
			}
			if f.pedidos() != 0 {
				t.Fatalf("a Anthropic recebeu %d pedido(s)", f.pedidos())
			}
		})
	}

	t.Run("sem chave", func(t *testing.T) {
		f := novaFalsa(t, 200, respostaDoc)
		ia := Nova("")
		ia.claude.url = f.srv.URL
		b64, _ := pdfB64(false)
		exigir(t, chamar(ia.LerDocumento, gestor, corpoDoc(b64, "")), 503, map[string]any{"error": "chave_nao_configurada"})
		if f.pedidos() != 0 {
			t.Fatal("chamou a Anthropic sem chave")
		}
	})

	t.Run("limite por pessoa", func(t *testing.T) {
		f := novaFalsa(t, 200, respostaDoc)
		ia := iaDe(f)
		ia.limDocumento.Max = 1
		b64, _ := pdfB64(false)
		exigir(t, chamar(ia.LerDocumento, gestor, corpoDoc(b64, "")), 200, nil)
		exigir(t, chamar(ia.LerDocumento, gestor, corpoDoc(b64, "")), 429, map[string]any{"error": "muitos_documentos",
			"detalhe": "São no máximo 10 PDFs por hora por pessoa."})
		if f.pedidos() != 1 {
			t.Fatalf("pedidos = %d, quer 1", f.pedidos())
		}
	})

	t.Run("recusa, vazio e erros", func(t *testing.T) {
		f := novaFalsa(t, 200, `{"content":[],"stop_reason":"refusal"}`)
		ia := iaDe(f)
		b64, _ := pdfB64(false)
		exigir(t, chamar(ia.LerDocumento, gestor, corpoDoc(b64, "")), 502, map[string]any{"error": "recusado_pela_ia"})
		f.responder(200, `{"content":[],"stop_reason":"end_turn"}`)
		exigir(t, chamar(ia.LerDocumento, gestor, corpoDoc(b64, "")), 502, map[string]any{"error": "sem_texto", "detalhe": "a IA não devolveu texto para este PDF"})
		f.responder(429, `{"error":{"message":"rate"}}`)
		exigir(t, chamar(ia.LerDocumento, gestor, corpoDoc(b64, "")), 502, map[string]any{"error": "anthropic_recusou", "status": 429, "detalhe": "rate"})
		f.srv.Close()
		exigir(t, chamar(ia.LerDocumento, gestor, corpoDoc(b64, "")), 502, map[string]any{"error": "anthropic_inacessivel"})
	})
}

func TestIASemSegredoNoLog(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(antes) })

	f := novaFalsa(t, 200, textoDaIA(`{"leitura":"L","interesses":[],"cuidado":"C"}`))
	ia := iaDe(f)
	b64, puro := pdfB64(false)
	var respostas strings.Builder
	rodar := func(h http.HandlerFunc, corpo string) {
		respostas.WriteString(chamar(h, gestor, corpo).Body.String())
	}
	rodar(ia.SugerirPublico, corpoPublico(""))
	rodar(ia.SugerirPublico, corpoPublico(`,"modo":"texto"`))
	f.responder(200, respostaDoc)
	rodar(ia.LerDocumento, corpoDoc(b64, ""))
	f.responder(529, `{"error":{"message":"SEGREDO-PERSONA no erro"}}`) // o corpo de erro da Anthropic não vai ao log
	rodar(ia.SugerirPublico, corpoPublico(""))
	rodar(ia.LerDocumento, corpoDoc(b64, ""))
	f.responder(200, textoDaIA("sem json"))
	rodar(ia.SugerirPublico, corpoPublico(""))
	f.srv.Close()
	rodar(ia.SugerirPublico, corpoPublico(""))
	rodar(ia.LerDocumento, corpoDoc(b64, ""))

	s := log.String()
	if !strings.Contains(s, "ia: chamada à Anthropic") {
		t.Fatalf("sem a linha de log: %q", s)
	}
	if n := strings.Count(s, "ia: chamada à Anthropic"); n != 8 {
		t.Errorf("linhas de log = %d, quer 8 (uma por chamada)", n)
	}
	for _, proibido := range []string{chaveTeste, "SEGREDO-PERSONA", "SEGREDO-DOC", puro, `"key":6004`, "mulheres 30+"} {
		if strings.Contains(s, proibido) {
			t.Errorf("o log contém %q:\n%s", proibido, s)
		}
	}
	if strings.Contains(respostas.String(), chaveTeste) {
		t.Error("a chave saiu numa resposta")
	}
	for _, quer := range []string{"rota=sugerir-publico-ia", "rota=ler-documento", "pessoa=gestor", "status=200", "bytes_pdf=", "ms="} {
		if !strings.Contains(s, quer) {
			t.Errorf("log sem %q", quer)
		}
	}
}
