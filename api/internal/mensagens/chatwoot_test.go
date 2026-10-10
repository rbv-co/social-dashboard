package mensagens

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	tokenChatwoot = "token-do-chatwoot-abc123"
	segredoDoBot  = "segredo-do-agentbot-xyz789"
)

// chatwootFalso: o Chatwoot de mentira. `resp` decide a resposta por "MÉTODO caminho"; o padrão é
// o caminho feliz (contato achado com o telefone como nome, conversa 77, mensagem aceita, nada recebido).
type chatwootFalso struct {
	mu      sync.Mutex
	pedidos []string // "MÉTODO caminho corpo"
	cabecas []http.Header
	resp    func(metodo, caminho string, corpo map[string]any) (int, string)
}

// lista: cópia dos pedidos e cabeçalhos (sob a trava: o servidor anota em outra goroutine).
func (f *chatwootFalso) lista() ([]string, []http.Header) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.pedidos), slices.Clone(f.cabecas)
}

func (f *chatwootFalso) chamadas(prefixo string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, p := range f.pedidos {
		if strings.HasPrefix(p, prefixo) {
			n++
		}
	}
	return n
}

func novoChatwoot(t *testing.T, resp func(metodo, caminho string, corpo map[string]any) (int, string)) (*Chatwoot, *chatwootFalso) {
	t.Helper()
	f := &chatwootFalso{resp: resp}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		var corpo map[string]any
		json.Unmarshal(b, &corpo)
		caminho := r.URL.Path
		if r.URL.RawQuery != "" {
			caminho += "?" + r.URL.RawQuery
		}
		f.mu.Lock()
		f.pedidos = append(f.pedidos, r.Method+" "+caminho+" "+string(b))
		f.cabecas = append(f.cabecas, r.Header.Clone())
		f.mu.Unlock()
		st, txt := 0, ""
		if f.resp != nil {
			st, txt = f.resp(r.Method, caminho, corpo)
		}
		if st == 0 {
			st, txt = caminhoFeliz(r.Method, caminho)
		}
		if st == -1 { // derruba a conexão: rede/prazo (status 0)
			c, _, _ := w.(http.Hijacker).Hijack()
			c.Close()
			return
		}
		w.WriteHeader(st)
		io.WriteString(w, txt)
	}))
	t.Cleanup(srv.Close)
	return &Chatwoot{URL: srv.URL + "/", ContaID: "3", CaixaID: 9, Token: tokenChatwoot, BotSecret: segredoDoBot}, f
}

func caminhoFeliz(metodo, caminho string) (int, string) {
	switch {
	case strings.HasPrefix(caminho, "/api/v1/accounts/3/contacts/search"):
		return 200, `{"payload":[{"id":51,"name":"+55 11 98765-4321","phone_number":"+5511987654321"}]}`
	case metodo == "PUT" && strings.HasPrefix(caminho, "/api/v1/accounts/3/contacts/"):
		return 200, `{"payload":{"id":51}}`
	case metodo == "POST" && caminho == "/api/v1/accounts/3/contacts":
		return 200, `{"payload":{"contact":{"id":52}}}`
	case metodo == "POST" && caminho == "/api/v1/accounts/3/conversations":
		return 200, `{"id":77}`
	case metodo == "POST" && strings.HasSuffix(caminho, "/messages"):
		return 200, `{"id":901}`
	case metodo == "GET" && strings.HasSuffix(caminho, "/messages"):
		return 200, `{"payload":[{"message_type":1,"created_at":1760000000},{"message_type":3,"created_at":1760000100}]}`
	case strings.HasSuffix(caminho, "/avisos/reservar"):
		return 200, `{"ok":true,"resultado":"reservado"}`
	case strings.HasSuffix(caminho, "/avisos/liberar"):
		return 200, `{"ok":true,"resultado":"liberado"}`
	}
	return 404, `{"error":"rota de teste desconhecida"}`
}

func TestAcharOuCriarContato(t *testing.T) {
	c, f := novoChatwoot(t, nil)
	ctx := context.Background()
	id, err := c.AcharOuCriarContato(ctx, s("Maria Silva"), "5511987654321")
	if err != nil || id != 51 {
		t.Fatalf("id=%d err=%v", id, err)
	}
	pedidos, cabecas := f.lista()
	if pedidos[0] != "GET /api/v1/accounts/3/contacts/search?q=%2B5511987654321 " || cabecas[0].Get("api_access_token") != tokenChatwoot {
		t.Fatalf("busca: %q", pedidos[0])
	}
	if pedidos[1] != `PUT /api/v1/accounts/3/contacts/51 {"name":"Maria Silva"}` {
		t.Fatalf("o telefone como nome vira o nome da cliente: %q", pedidos[1])
	}
	// Nome real que alguém já pôs nunca é sobrescrito; contato novo é criado com o nome (ou o +55…).
	c2, f2 := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
		if strings.Contains(cam, "search") {
			return 200, `{"payload":[{"id":60,"name":"Dona Maria","phone_number":"+5511987654321"}]}`
		}
		return 0, ""
	})
	if id, _ := c2.AcharOuCriarContato(ctx, s("Maria"), "5511987654321"); id != 60 || f2.chamadas("PUT") != 0 {
		t.Fatalf("id=%d puts=%d", id, f2.chamadas("PUT"))
	}
	c3, f3 := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
		if strings.Contains(cam, "search") {
			return 200, `{"payload":[]}`
		}
		return 0, ""
	})
	id3, _ := c3.AcharOuCriarContato(ctx, nil, "5511987654321")
	p3, _ := f3.lista()
	if id3 != 52 || !strings.Contains(p3[1], `"name":"+5511987654321"`) || !strings.Contains(p3[1], `"inbox_id":9`) {
		t.Fatalf("id=%d criar=%q", id3, p3[1])
	}
	// PUT do nome com 401 para a rodada; com 500, segue (nome é cosmético).
	for st, quer := range map[int]bool{401: true, 500: false} {
		c4, _ := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
			if m == "PUT" {
				return st, `{}`
			}
			return 0, ""
		})
		_, err := c4.AcharOuCriarContato(ctx, s("Maria"), "5511987654321")
		if (err != nil) != quer {
			t.Errorf("PUT %d: err=%v", st, err)
		}
	}
}

func TestRespondeuDesde(t *testing.T) {
	ctx := context.Background()
	desde := time.Unix(1760000000, 500e6) // 1760000000,5 s
	casos := []struct {
		corpo string
		desde *time.Time
		quer  bool
		erro  string
	}{
		{`{"payload":[{"message_type":0,"created_at":1759999999}]}`, &desde, false, ""}, // conversa antiga com a loja não conta
		{`{"payload":[{"message_type":0,"created_at":1760000001}]}`, &desde, true, ""},
		{`[{"message_type":0,"created_at":1}]`, nil, true, ""},
		{`{"payload":[{"message_type":1,"created_at":1760000009}]}`, &desde, false, ""},
		{`{"payload":[{"message_type":0}]}`, &desde, false, "mensagem_sem_data"},
		{`{"nada":1}`, nil, false, "resposta_inesperada"},
	}
	for i, c := range casos {
		cw, _ := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
			if m == "GET" && strings.HasSuffix(cam, "/messages") {
				return 200, c.corpo
			}
			return 0, ""
		})
		got, err := cw.Respondeu(ctx, 77, c.desde)
		var ec *ErroChatwoot
		if got != c.quer || (c.erro == "") != (err == nil) || (c.erro != "" && (!errors.As(err, &ec) || ec.Corpo != c.erro)) {
			t.Errorf("caso %d: %v %v", i, got, err)
		}
	}
}

func TestReservarELiberarAviso(t *testing.T) {
	ctx := context.Background()
	idade := int64(30)
	for _, c := range []struct {
		st    int
		corpo string
		quer  string
		erro  int // status do ErroChatwoot; -1 = sem erro
	}{
		{200, `{"ok":true,"resultado":"adiado"}`, "adiado", -1},
		{200, `{"ok":true,"resultado":"duplicado"}`, "duplicado", -1},
		{200, `{"ok":true,"resultado":"talvez"}`, "", 200},
		{200, `não é json`, "", 200},
		{401, `{}`, "", 401},
		{503, `{}`, "", 503},
		{-1, ``, "", 0},
	} {
		cw, f := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
			if strings.HasSuffix(cam, "/reservar") {
				return c.st, c.corpo
			}
			return 0, ""
		})
		got, err := cw.ReservarAviso(ctx, "5511987654321", "pedido_recebido", "1001", &idade)
		var ec *ErroChatwoot
		if got != c.quer || (c.erro == -1) != (err == nil) || (c.erro != -1 && (!errors.As(err, &ec) || ec.Status != c.erro || ec.Passo != "reservar_aviso")) {
			t.Errorf("%d %s: %q %v", c.st, c.corpo, got, err)
		}
		if err != nil && (strings.Contains(err.Error(), segredoDoBot) || strings.Contains(err.Error(), "5511987654321")) {
			t.Errorf("segredo ou telefone no erro: %v", err)
		}
		pedidos, cabecas := f.lista()
		if len(cabecas) > 0 && (cabecas[0].Get("X-Bot-Secret") != segredoDoBot || cabecas[0].Get("api_access_token") != "") {
			t.Errorf("a reserva usa o X-Bot-Secret, não o token da API")
		}
		if c.st == 200 && !strings.Contains(pedidos[0], `"idade_s":30`) {
			t.Errorf("idade_s não foi: %q", pedidos[0])
		}
	}
	cw, _ := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) { return -1, "" })
	if got := cw.LiberarAviso(ctx, "5511987654321", "pedido_recebido", "1001"); got != "" {
		t.Fatalf("liberar é best-effort: %q", got)
	}
}

func TestClassificarEDetalhe(t *testing.T) {
	for _, c := range []struct {
		err  error
		quer string
	}{
		{&ErroChatwoot{0, "x", "enviar_template"}, "falhou"}, // rede NO envio: pode ter saído
		{&ErroChatwoot{0, "x", "abrir_conversa"}, "tentar_de_novo"},
		{&ErroChatwoot{401, nil, "buscar_contato"}, "parar"},
		{&ErroChatwoot{403, nil, "enviar_template"}, "parar"},
		{&ErroChatwoot{429, nil, "enviar_template"}, "tentar_de_novo"},
		{&ErroChatwoot{502, nil, "enviar_template"}, "tentar_de_novo"},
		{&ErroChatwoot{422, nil, "enviar_template"}, "falhou"},
		{errors.New("outra coisa"), "tentar_de_novo"},
	} {
		if got := classificarErro(c.err); got != c.quer {
			t.Errorf("%v = %s", c.err, got)
		}
	}
	if d := detalheDoErro(&ErroChatwoot{422, map[string]any{"error": "Template <inválido>"}, "enviar_template"}); d != `enviar_template:422 {"error":"Template <inválido>"}` {
		t.Fatalf("%q", d)
	}
	cw, _ := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) { return -1, "" })
	_, err := cw.AbrirConversa(context.Background(), 51, "5511987654321")
	if err == nil || strings.Contains(detalheDoErro(err), tokenChatwoot) || !strings.HasPrefix(detalheDoErro(err), "abrir_conversa:0 ") {
		t.Fatalf("rede: %v / %q", err, detalheDoErro(err))
	}
}

// Redirect para outro host não leva o token nem o segredo do bot (o Go repassa cabeçalhos próprios).
func TestRedirectParaOutroHostNaoLevaOToken(t *testing.T) {
	var mu sync.Mutex
	var vazou []string
	alvo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		vazou = append(vazou, r.Header.Get("api_access_token")+r.Header.Get("X-Bot-Secret"))
		mu.Unlock()
	}))
	defer alvo.Close()
	origem := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, alvo.URL+"/captura", http.StatusTemporaryRedirect)
	}))
	defer origem.Close()
	// 127.0.0.1:porta diferente = host diferente para o Go.
	cw := &Chatwoot{URL: origem.URL, ContaID: "3", CaixaID: 9, Token: tokenChatwoot, BotSecret: segredoDoBot}
	ctx := context.Background()
	_, err := cw.AbrirConversa(ctx, 51, "5511987654321")
	var ec *ErroChatwoot
	if !errors.As(err, &ec) || ec.Status != 307 {
		t.Fatalf("o 3xx volta como resposta: %v", err)
	}
	if _, err := cw.ReservarAviso(ctx, "5511987654321", "pedido_recebido", "1001", nil); err == nil {
		t.Fatal("reserva sem 2xx é erro")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(vazou) != 0 {
		t.Fatalf("o outro host recebeu pedido com credencial: %q", vazou)
	}
}
