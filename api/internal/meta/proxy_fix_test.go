package meta

import (
	"bytes"
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

const uuidConta = "bbbbbbbb-1111-2222-3333-444444444444"

// Revisão: accounts.id é uuid em produção; accountId que não é uuid (texto ou número) tem de dar
// 400 "conta nao encontrada", nunca 500 (cast uuid falhando).
func TestMetaProxyContaComIdUUID(t *testing.T) {
	a := montarMetaCom(t, graphOK(`{}`), `create table accounts (id uuid primary key, instagram_id text, ad_account_id text, access_token text);
		insert into accounts (id) values ('`+uuidConta+`');`, []string{"midia.exemplo"})
	for corpo, quer := range map[string]int{
		`{"accountId":"nao-existe","path":"/me"}`:                         400,
		`{"accountId":42,"path":"/me"}`:                                   400,
		`{"accountId":"` + uuidConta + `","path":"/me"}`:                  200,
		`{"accountId":"` + strings.ToUpper(uuidConta) + `","path":"/me"}`: 400, // id::text é minúsculo; igual ao edge (eq no texto)
	} {
		w := a.post("/meta-proxy", a.tokens[uMeta], corpo)
		if w.Code != quer {
			t.Errorf("%s: %d %s, esperava %d", corpo, w.Code, w.Body, quer)
		}
		if quer == 400 && !strings.Contains(w.Body.String(), "conta nao encontrada") {
			t.Errorf("%s: %s", corpo, w.Body)
		}
	}
}

func TestMetaProxyAccountIdGrandeKeepsPrecisao(t *testing.T) {
	a := montarMeta(t, graphOK(`{}`))
	if _, err := a.p.Exec(context.Background(), `insert into accounts (id) values ('9007199254740993')`); err != nil {
		t.Fatal(err)
	}
	if w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":9007199254740993,"path":"/me"}`); w.Code != 200 {
		t.Fatalf("accountId > 2^53 perdeu precisão: %d %s", w.Code, w.Body)
	}
}

func TestMetaProxyHostsDeMidiaVazioRecusaTudo(t *testing.T) {
	a := montarMetaCom(t, graphOK(`{}`), accountsTexto, nil)
	for corpo, erro := range map[string]string{
		`{"accountId":"conta-1","path":"/p","imageFromUrl":"https://midia.exemplo/x.png"}`: "origem da imagem nao permitida",
		`{"accountId":"conta-1","path":"/p","videoFromUrl":"https://midia.exemplo/v.mp4"}`: "origem do video nao permitida",
	} {
		w := a.post("/meta-proxy", a.tokens[uMeta], corpo)
		if w.Code != 400 || !strings.Contains(w.Body.String(), erro) {
			t.Errorf("%s: %d %s", corpo, w.Code, w.Body)
		}
	}
	if a.core.n() != 0 {
		t.Fatalf("core chamado %d vezes", a.core.n())
	}
}

func TestMetaProxyVariantesDeOrigemRecusadas(t *testing.T) {
	a := montarMeta(t, graphOK(`{}`))
	for _, u := range []string{
		"https://midia.exemplo:8443/x.png",
		"https://midia.exemplo:443/x.png",
		"https://usuario:senha@midia.exemplo/x.png",
		"https://midia.exemplo@evil.com/x.png",
		`https://midia.exemplo\@evil.com/x.png`,
		`https:\\midia.exemplo\x.png`,
		"https://evil.com/?h=midia.exemplo",
		"https:///x.png",
		"//midia.exemplo/x.png",
		"HTTPS://evil.com/x.png",
	} {
		for _, campo := range []string{"imageFromUrl", "videoFromUrl"} {
			b, _ := jsonStr(u)
			w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/p","`+campo+`":`+b+`}`)
			if w.Code != 400 {
				t.Errorf("%s %s: %d %s", campo, u, w.Code, w.Body)
			}
		}
	}
	if a.core.n() != 0 {
		t.Fatalf("core chamado %d vezes", a.core.n())
	}
}

func jsonStr(s string) (string, error) {
	var b bytes.Buffer
	b.WriteByte('"')
	for _, r := range s {
		switch r {
		case '\\', '"':
			b.WriteByte('\\')
		}
		b.WriteRune(r)
	}
	b.WriteByte('"')
	return b.String(), nil
}

// O core recebe a URL já normalizada (u.String(); host em minúsculas, como o `new URL` do edge).
func TestMetaProxyEncaminhaURLNormalizada(t *testing.T) {
	a := montarMeta(t, graphOK(`{}`))
	a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/p","imageFromUrl":"https://MIDIA.exemplo/x.png?a=b"}`)
	if got := a.core.pedidos[0].ImagemURL; got != "https://midia.exemplo/x.png?a=b" {
		t.Fatalf("imagem_url = %q", got)
	}
}

// Igual ao edge: com imageFromUrl o vídeo é ignorado (nem validado nem encaminhado).
func TestMetaProxyImagemIgnoraVideo(t *testing.T) {
	a := montarMeta(t, graphOK(`{}`))
	w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/p","imageFromUrl":"https://midia.exemplo/x.png","videoFromUrl":"http://169.254.169.254/"}`)
	if w.Code != 200 || a.core.n() != 1 || a.core.pedidos[0].VideoURL != "" || a.core.pedidos[0].ImagemURL == "" {
		t.Fatalf("%d %s %+v", w.Code, w.Body, a.core.pedidos)
	}
}

func TestMetaProxyNuncaDevolve401ou403DoCore(t *testing.T) {
	casos := []struct {
		nome, corpo, querCorpo string
		st                     int
	}{
		{"401 com corpo no formato da Graph", `{"error":{"message":"Invalid OAuth","code":190}}`, "", 401},
		{"401 erro nao_autorizado", `{"erro":"nao_autorizado"}`, `{"error":"nao_autorizado"}`, 401},
		{"401 array", `[]`, `{"error":"core: 401"}`, 401},
		{"401 null", `null`, `{"error":"core: 401"}`, 401},
		{"401 texto", `"x"`, `{"error":"core: 401"}`, 401},
		{"401 sem corpo JSON", `<html>`, `{"error":"core: 401"}`, 401},
		{"403 escopo_negado", `{"erro":"escopo_negado"}`, `{"error":"escopo_negado"}`, 403},
		{"403 corpo da Graph", `{"error":{"message":"x","code":200}}`, "", 403},
		{"400 array mantém 4xx", `[]`, `{"error":"core: 400"}`, 400},
		{"500 null", `null`, `{"error":"core: 500"}`, 500},
		{"413 do core", `{"erro":"parametros grandes demais"}`, `{"error":"parametros grandes demais"}`, 413},
		{"500 da Graph passa pelo corpo", `{"error":{"code":190,"message":"Token"}}`, `{"error":{"code":190,"message":"Token"}}`, 500},
	}
	for _, c := range casos {
		a := montarMeta(t, func(core.PedidoMeta) (int, string, map[string]string) { return c.st, c.corpo, nil })
		w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/p","method":"POST"}`)
		want := c.querCorpo
		code := c.st
		if c.st == 401 || c.st == 403 {
			code = 500
		}
		if want == "" {
			want = `{"error":"core: ` + strconv.Itoa(c.st) + `"}`
		}
		if c.nome == "500 da Graph passa pelo corpo" {
			code = 500
		}
		if w.Code != code || strings.TrimSpace(w.Body.String()) != want || w.Code == 401 || w.Code == 403 {
			t.Errorf("%s: %d %s (esperava %d %s)", c.nome, w.Code, w.Body, code, want)
		}
		if a.core.n() != 1 {
			t.Errorf("%s: %d chamadas", c.nome, a.core.n())
		}
	}
}

func TestMetaProxyErroDeRedeUmaChamadaSo(t *testing.T) {
	a := montarMeta(t, graphOK(`{}`))
	var n atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n.Add(1)
		c, _, _ := w.(http.Hijacker).Hijack()
		c.Close()
	}))
	defer srv.Close()
	a.cli.URL = srv.URL
	w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/act_1/campaigns","method":"POST"}`)
	if w.Code != 500 || n.Load() != 1 {
		t.Fatalf("%d, chamadas=%d (POST nunca se repete)", w.Code, n.Load())
	}
}

func TestMetaProxyRespostaGrandeDoCoreVira500(t *testing.T) {
	a := montarMeta(t, graphOK(`{}`))
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.Copy(w, io.LimitReader(zeros{}, 33<<20))
	}))
	defer srv.Close()
	a.cli.URL = srv.URL
	w := a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/me"}`)
	if w.Code != 500 {
		t.Fatalf("%d", w.Code)
	}
}

type zeros struct{}

func (zeros) Read(p []byte) (int, error) { clear(p); return len(p), nil }

func TestMetaProxyLimiteDe64KB(t *testing.T) {
	a := montarMeta(t, graphOK(`{}`))
	base := `{"accountId":"conta-1","path":"/me","params":{"x":"`
	fim := `"}}`
	exato := base + strings.Repeat("a", 64<<10-len(base)-len(fim)) + fim
	if len(exato) != 64<<10 {
		t.Fatal(len(exato))
	}
	if w := a.post("/meta-proxy", a.tokens[uMeta], exato); w.Code != 200 {
		t.Fatalf("64 KB exatos: %d %s", w.Code, w.Body)
	}
	if w := a.post("/meta-proxy", a.tokens[uMeta], exato[:len(exato)-len(fim)]+"a"+fim); w.Code != 413 {
		t.Fatalf("64 KB + 1: %d", w.Code)
	}
}

// Falhas registram a CAUSA no log, nunca o token do core nem os parâmetros.
func TestMetaProxyLogaCausaSemSegredo(t *testing.T) {
	var log bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	a := montarMeta(t, graphOK(`{}`))
	morto := httptest.NewServer(http.NotFoundHandler())
	morto.Close()
	a.cli.URL = morto.URL
	a.post("/meta-proxy", a.tokens[uMeta], `{"accountId":"conta-1","path":"/me","params":{"segredo":"VALOR-SECRETO"}}`)
	l := log.String()
	if !strings.Contains(l, "connect") && !strings.Contains(l, "refused") {
		t.Errorf("log sem a causa: %s", l)
	}
	if strings.Contains(l, tokenDoCore) || strings.Contains(l, "VALOR-SECRETO") {
		t.Errorf("segredo no log: %s", l)
	}
	log.Reset()
	a.p.Close() // banco fora: chama o handler direto (o middleware também usa o pool)
	rec := httptest.NewRecorder()
	(&Proxy{Pool: a.p, Core: a.cli, HostsDeMidia: nil}).ServeHTTP(rec, httptest.NewRequest("POST", "/meta-proxy", strings.NewReader(`{"accountId":"conta-1","path":"/me"}`)))
	if rec.Code != 500 || !strings.Contains(log.String(), "consulta de conta falhou") || !strings.Contains(log.String(), "closed pool") {
		t.Errorf("banco fora: %d log=%s", rec.Code, log.String())
	}
}
