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

	"github.com/rbv-co/social-dashboard/api/internal/worker"
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
		{&ErroChatwoot{502, nil, "abrir_conversa"}, "tentar_de_novo"},
		{&ErroChatwoot{502, nil, "enviar_template"}, "falhou"}, // ruling: gateway no envio é ambíguo
		{&ErroChatwoot{503, nil, "enviar_template"}, "tentar_de_novo"},
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

// ---- Fix round 1 ----

// redirecionador: responde `codigo` com Location em `destino(r)` ao primeiro pedido; se o cliente
// SEGUIR, os pedidos seguintes vão para o caminho feliz (GET de mensagens = 200).
type redirecionador struct {
	mu      sync.Mutex
	pedidos []string
}

func (r *redirecionador) n() int {
	r.mu.Lock()
	defer r.mu.Unlock()
	return len(r.pedidos)
}

func servidorQueRedireciona(t *testing.T, codigo int, destino func(base string) string) (*httptest.Server, *redirecionador) {
	t.Helper()
	rd := &redirecionador{}
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rd.mu.Lock()
		rd.pedidos = append(rd.pedidos, r.Method+" "+r.URL.RequestURI())
		primeiro := len(rd.pedidos) == 1
		rd.mu.Unlock()
		if primeiro {
			http.Redirect(w, r, destino(srv.URL), codigo)
			return
		}
		io.WriteString(w, `{"id":77,"payload":[{"id":51,"phone_number":"+5511987654321","name":"x"}]}`) // "sucesso" de quem seguiu
	}))
	t.Cleanup(srv.Close)
	return srv, rd
}

// Importante 1: o cliente padrão NUNCA segue redirect. 301/302/303 num POST virariam GET da lista de
// mensagens (200): EnviarTemplate devolveria nil e a mensagem nunca teria saído.
func TestNuncaSegueRedirect(t *testing.T) {
	ctx := context.Background()
	for _, codigo := range []int{301, 302, 303, 307, 308} {
		for _, mesmoHost := range []bool{true, false} {
			alvo := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				t.Errorf("%d: o outro host foi chamado: %s %s", codigo, r.Method, r.URL)
			}))
			destino := func(base string) string {
				if mesmoHost {
					return base + "/api/v1/accounts/3/conversations/77/messages"
				}
				return alvo.URL + "/api/v1/accounts/3/conversations/77/messages"
			}
			for passo, chamada := range map[string]func(c *Chatwoot) error{
				"enviar_template": func(c *Chatwoot) error {
					return c.EnviarTemplate(ctx, 77, "Oi", templateMarketing("t", "pt_BR", s("Maria"), "abc"))
				},
				"abrir_conversa": func(c *Chatwoot) error { _, err := c.AbrirConversa(ctx, 51, "5511987654321"); return err },
				"buscar_contato": func(c *Chatwoot) error {
					_, err := c.AcharOuCriarContato(ctx, s("Maria"), "5511987654321")
					return err
				},
			} {
				srv, rd := servidorQueRedireciona(t, codigo, destino)
				err := chamada(&Chatwoot{URL: srv.URL, ContaID: "3", CaixaID: 9, Token: tokenChatwoot, BotSecret: segredoDoBot})
				var ec *ErroChatwoot
				if !errors.As(err, &ec) || ec.Status != codigo || ec.Passo != passo || classificarErro(err) != "falhou" {
					t.Errorf("%d %s mesmoHost=%v: err=%v (3xx é falhou visível, nunca sucesso)", codigo, passo, mesmoHost, err)
				}
				if rd.n() != 1 {
					t.Errorf("%d %s mesmoHost=%v: %d pedidos; o redirect foi seguido", codigo, passo, mesmoHost, rd.n())
				}
			}
			alvo.Close()
		}
	}
}

// A política vale também para https -> http no mesmo host (o token iria em claro).
func TestPoliticaDeRedirectRecusaTudo(t *testing.T) {
	de, _ := http.NewRequest("POST", "https://chat.exemplo.com/api/v1/x", nil)
	para, _ := http.NewRequest("POST", "http://chat.exemplo.com/api/v1/x", nil)
	mesmo, _ := http.NewRequest("POST", "https://chat.exemplo.com/outro", nil)
	if err := clientePadrao.CheckRedirect(para, []*http.Request{de}); !errors.Is(err, http.ErrUseLastResponse) {
		t.Errorf("downgrade https->http: %v", err)
	}
	if err := clientePadrao.CheckRedirect(mesmo, []*http.Request{de}); !errors.Is(err, http.ErrUseLastResponse) {
		t.Errorf("mesmo host também não segue: %v", err)
	}
}

// Importante 3: os corpos e cabeçalhos, literalmente como _shared/cliente-chatwoot.js. A edge manda
// source_id SEM o "+" (o telefone já normalizado), não manda content_attributes e usa X-Bot-Secret só
// no custom_api. A ordem das chaves é a do encoder do Go (alfabética): o JSON é o mesmo para o Chatwoot.
func TestCorposECabecalhosComoNaEdge(t *testing.T) {
	ctx := context.Background()
	c, f := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
		if strings.Contains(cam, "search") {
			return 200, `{"payload":[]}`
		}
		return 0, ""
	})
	id, err := c.AcharOuCriarContato(ctx, s("Maria Silva"), "5511987654321")
	if err != nil || id != 52 {
		t.Fatalf("%d %v", id, err)
	}
	if id, err := c.AbrirConversa(ctx, 52, "5511987654321"); err != nil || id != 77 {
		t.Fatalf("%d %v", id, err)
	}
	if err := c.EnviarTemplate(ctx, 77, "Oi, Maria! Seu carrinho espera.", templateMarketing("abandono_v2", "pt_BR", s("maria silva"), "abc?key=1")); err != nil {
		t.Fatal(err)
	}
	if ja, err := c.Respondeu(ctx, 77, nil); err != nil || ja { // o caminho feliz só tem mensagens enviadas
		t.Fatalf("%v %v", ja, err)
	}
	if err := c.EnviarTemplate(ctx, 78, "Pedido 1001", templatePedido("pedido_v1", "pt_BR", nil, s("1001"))); err != nil {
		t.Fatal(err)
	}
	quer := []string{
		`GET /api/v1/accounts/3/contacts/search?q=%2B5511987654321 `,
		`POST /api/v1/accounts/3/contacts {"inbox_id":9,"name":"Maria Silva","phone_number":"+5511987654321"}`,
		`POST /api/v1/accounts/3/conversations {"contact_id":52,"inbox_id":9,"source_id":"5511987654321"}`,
		`POST /api/v1/accounts/3/conversations/77/messages {"content":"Oi, Maria! Seu carrinho espera.","message_type":"outgoing","private":false,"template_params":{"name":"abandono_v2","category":"MARKETING","language":"pt_BR","processed_params":{"body":{"1":"Maria"},"buttons":[{"type":"url","parameter":"abc?key=1"}]}}}`,
		`GET /api/v1/accounts/3/conversations/77/messages `,
		`POST /api/v1/accounts/3/conversations/78/messages {"content":"Pedido 1001","message_type":"outgoing","private":false,"template_params":{"name":"pedido_v1","category":"UTILITY","language":"pt_BR","processed_params":{"body":{"1":"cliente","2":"1001"}}}}`,
	}
	pedidos, cabecas := f.lista()
	if !slices.Equal(pedidos, quer) {
		t.Fatalf("corpos:\n%q\nesperado:\n%q", pedidos, quer)
	}
	for i, h := range cabecas {
		if h.Get("api_access_token") != tokenChatwoot || h.Get("X-Bot-Secret") != "" || h.Get("Content-Type") != "application/json" {
			t.Errorf("pedido %d: cabeçalhos %v", i, h)
		}
	}
	// custom_api: X-Bot-Secret, nunca o token da API; idade_s só quando >= 0.
	c.ReservarAviso(ctx, "5511987654321", "pedido_recebido", "1001", nil)
	neg := int64(-1)
	c.ReservarAviso(ctx, "5511987654321", "pedido_recebido", "1001", &neg)
	idade := int64(0)
	c.ReservarAviso(ctx, "5511987654321", "pedido_recebido", "1001", &idade)
	c.LiberarAviso(ctx, "5511987654321", "pedido_recebido", "1001")
	pedidos, cabecas = f.lista()
	querAvisos := []string{
		`POST /custom_api/v1/accounts/3/avisos/reservar {"chave":"1001","phone":"5511987654321","tipo":"pedido_recebido"}`,
		`POST /custom_api/v1/accounts/3/avisos/reservar {"chave":"1001","phone":"5511987654321","tipo":"pedido_recebido"}`,
		`POST /custom_api/v1/accounts/3/avisos/reservar {"chave":"1001","idade_s":0,"phone":"5511987654321","tipo":"pedido_recebido"}`,
		`POST /custom_api/v1/accounts/3/avisos/liberar {"chave":"1001","phone":"5511987654321","tipo":"pedido_recebido"}`,
	}
	if !slices.Equal(pedidos[len(quer):], querAvisos) {
		t.Fatalf("avisos:\n%q", pedidos[len(quer):])
	}
	for i, h := range cabecas[len(quer):] {
		if h.Get("X-Bot-Secret") != segredoDoBot || h.Get("api_access_token") != "" {
			t.Errorf("aviso %d: cabeçalhos %v", i, h)
		}
	}
	// PUT do nome (contato que só tem o telefone como nome).
	c2, f2 := novoChatwoot(t, nil)
	c2.AcharOuCriarContato(ctx, s("  Maria  "), "5511987654321")
	if p, h := f2.lista(); p[1] != `PUT /api/v1/accounts/3/contacts/51 {"name":"Maria"}` || h[1].Get("api_access_token") != tokenChatwoot {
		t.Errorf("PUT: %q", p[1])
	}
}

// Importante 4: Segredos() tem token e segredo do bot, e Limpar os mascara em erro e detalhe do cliente.
func TestSegredosEMascaramNoErroDoCliente(t *testing.T) {
	env := map[string]string{"CHATWOOT_API_TOKEN": tokenChatwoot, "CHATWOOT_BOT_SECRET": segredoDoBot}
	cfg := LerConfig(func(k string) string { return env[k] })
	if got := cfg.Segredos(); !slices.Contains(got, tokenChatwoot) || !slices.Contains(got, segredoDoBot) {
		t.Fatalf("Segredos() = %q", got)
	}
	cw, _ := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
		return 422, `{"error":"eco ` + tokenChatwoot + ` e ` + segredoDoBot + `"}` // o servidor que repete o segredo
	})
	err := cw.EnviarTemplate(context.Background(), 77, "Oi", templateMarketing("t", "pt_BR", nil, "x"))
	d := detalheDoErro(err)
	if !strings.Contains(d, tokenChatwoot) || !strings.Contains(d, segredoDoBot) {
		t.Fatalf("o teste precisa do segredo no detalhe: %q", d)
	}
	for _, saida := range []string{d, err.Error(), "falhou: " + d} {
		if l := worker.Limpar(saida, cfg.Segredos()); strings.Contains(l, tokenChatwoot) || strings.Contains(l, segredoDoBot) {
			t.Errorf("segredo vazou: %q", l)
		}
	}
	if l := worker.Limpar(d, cfg.Segredos()); !strings.Contains(l, "***") {
		t.Errorf("sem máscara: %q", l)
	}
}

// Ruling 5xx: 502/504 no envio são AMBÍGUOS (o gateway pode ter repassado a mensagem): falhou, nunca
// reenvia. 429/500/503 seguem tentar_de_novo, como na edge. Nos outros passos 5xx é seguro repetir.
func TestGatewayAmbiguoNoEnvio(t *testing.T) {
	for st, quer := range map[int]string{429: "tentar_de_novo", 500: "tentar_de_novo", 501: "tentar_de_novo", 502: "falhou", 503: "tentar_de_novo", 504: "falhou"} {
		if got := classificarErro(&ErroChatwoot{st, nil, "enviar_template"}); got != quer {
			t.Errorf("enviar_template %d = %s, esperava %s", st, got, quer)
		}
		for _, passo := range []string{"buscar_contato", "criar_contato", "abrir_conversa", "ler_conversa"} {
			if got := classificarErro(&ErroChatwoot{st, nil, passo}); got != "tentar_de_novo" {
				t.Errorf("%s %d = %s: sem mensagem no ar, repetir é seguro", passo, st, got)
			}
		}
	}
}

// Mínimo: id ausente ou <= 0 vira erro DENTRO do cliente (nada é enviado com id lixo).
func TestIdAusenteOuInvalidoEErro(t *testing.T) {
	ctx := context.Background()
	for nome, c := range map[string]struct {
		corpo, chamada string
	}{
		"achado sem id":       {`{"payload":[{"phone_number":"+5511987654321","name":"x"}]}`, "contato"},
		"achado com id 0":     {`{"payload":[{"id":0,"phone_number":"+5511987654321","name":"x"}]}`, "contato"},
		"achado com id texto": {`{"payload":[{"id":"abc","phone_number":"+5511987654321","name":"x"}]}`, "contato"},
		"criado sem id":       {`{"payload":{"contact":{}}}`, "criado"},
		"criado com id -3":    {`{"payload":{"contact":{"id":-3}}}`, "criado"},
		"conversa sem id":     {`{}`, "conversa"},
		"conversa com id 0":   {`{"id":0}`, "conversa"},
		"conversa com id -1":  {`{"id":-1}`, "conversa"},
	} {
		cw, f := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
			switch {
			case c.chamada == "criado" && m == "GET":
				return 200, `{"payload":[]}`
			case c.chamada == "criado" || c.chamada == "contato" && m == "GET":
				return 200, c.corpo
			case c.chamada == "conversa":
				return 200, c.corpo
			}
			return 0, ""
		})
		var id int64
		var err error
		if c.chamada == "conversa" {
			id, err = cw.AbrirConversa(ctx, 51, "5511987654321")
		} else {
			id, err = cw.AcharOuCriarContato(ctx, s("Maria"), "5511987654321")
		}
		var ec *ErroChatwoot
		if err == nil || id != 0 || !errors.As(err, &ec) || ec.Corpo != "resposta_inesperada" || classificarErro(err) != "falhou" {
			t.Errorf("%s: id=%d err=%v", nome, id, err)
		}
		if f.chamadas("PUT") != 0 {
			t.Errorf("%s: não se renomeia contato com id lixo", nome)
		}
	}
}

// Mínimo: contexto já vencido antes do envio = nao_enviado (nada saiu, nada gasta tentativa); no meio
// do voo continua ambíguo (falhou).
func TestContextoVencidoAntesDoEnvioENaoEnviado(t *testing.T) {
	cw, f := novoChatwoot(t, nil)
	for nome, mk := range map[string]func() (context.Context, context.CancelFunc){
		"cancelado": func() (context.Context, context.CancelFunc) {
			c, cancela := context.WithCancel(context.Background())
			cancela()
			return c, cancela
		},
		"prazo vencido": func() (context.Context, context.CancelFunc) {
			return context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
		},
	} {
		ctx, cancela := mk()
		err := cw.EnviarTemplate(ctx, 77, "Oi", templateMarketing("t", "pt_BR", nil, "x"))
		cancela()
		var ec *ErroChatwoot
		if !errors.As(err, &ec) || ec.Corpo != "nao_enviado" || classificarErro(err) != "nao_enviado" || !strings.HasPrefix(detalheDoErro(err), "enviar_template:0 ") {
			t.Errorf("%s: %v / %q", nome, err, classificarErro(err))
		}
	}
	if n := f.chamadas(""); n != 0 {
		t.Errorf("%d pedidos saíram com o contexto vencido", n)
	}
	lento, _ := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) { return -1, "" })
	if err := lento.EnviarTemplate(context.Background(), 77, "Oi", templateMarketing("t", "pt_BR", nil, "x")); classificarErro(err) != "falhou" {
		t.Errorf("conexão caída no meio do envio é ambígua: %v", err)
	}
}

// M12: o erro de rede nunca traz a URL (a busca carrega o telefone na query) nem o endereço.
func TestErroDeRedeNaoTrazURLNemTelefone(t *testing.T) {
	cw, _ := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) { return -1, "" })
	_, err := cw.AcharOuCriarContato(context.Background(), s("Maria"), "5511987654321")
	var ec *ErroChatwoot
	if !errors.As(err, &ec) {
		t.Fatal(err)
	}
	txt, _ := ec.Corpo.(string)
	for _, proibido := range []string{"5511987654321", "http", "127.0.0.1", "search", tokenChatwoot} {
		if strings.Contains(txt, proibido) || strings.Contains(detalheDoErro(err), proibido) {
			t.Errorf("%q no erro de rede: %q", proibido, detalheDoErro(err))
		}
	}
	if txt == "" || len(txt) > 160 {
		t.Errorf("a causa fica (cortada): %q", txt)
	}
}

// M16: created_at exatamente igual a `desde` conta como resposta (>=).
func TestRespondeuNoMesmoSegundo(t *testing.T) {
	desde := time.Unix(1760000001, 0)
	cw, _ := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
		if m == "GET" && strings.HasSuffix(cam, "/messages") {
			return 200, `{"payload":[{"message_type":0,"created_at":1760000001}]}`
		}
		return 0, ""
	})
	if ja, err := cw.Respondeu(context.Background(), 77, &desde); err != nil || !ja {
		t.Fatalf("%v %v", ja, err)
	}
}

// M31: só o contato com o phone_number EXATO serve; sem nenhum, cria.
func TestContatoSoPeloTelefoneExato(t *testing.T) {
	ctx := context.Background()
	c, f := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
		if strings.Contains(cam, "search") {
			return 200, `{"payload":[{"id":90,"name":"Outra","phone_number":"+5511900000000"},{"id":91,"name":"Sem fone"},{"id":60,"name":"Dona Maria","phone_number":"+5511987654321"}]}`
		}
		return 0, ""
	})
	if id, err := c.AcharOuCriarContato(ctx, s("Maria"), "5511987654321"); err != nil || id != 60 || f.chamadas("POST") != 0 {
		t.Fatalf("id=%d err=%v", id, err)
	}
	c2, f2 := novoChatwoot(t, func(m, cam string, _ map[string]any) (int, string) {
		if strings.Contains(cam, "search") {
			return 200, `{"payload":[{"id":90,"name":"Outra","phone_number":"+5511900000000"}]}`
		}
		return 0, ""
	})
	if id, err := c2.AcharOuCriarContato(ctx, s("Maria"), "5511987654321"); err != nil || id != 52 || f2.chamadas("POST /api/v1/accounts/3/contacts ") != 1 || f2.chamadas("PUT") != 0 {
		t.Fatalf("id=%d err=%v", id, err)
	}
}

// M32: o detalhe corta o corpo em 160 unidades UTF-16 (como o .slice(0,160) da edge).
func TestDetalheCortaEm160(t *testing.T) {
	longo := strings.Repeat("a", 300)
	d := detalheDoErro(&ErroChatwoot{422, longo, "enviar_template"})
	if d != `enviar_template:422 "`+strings.Repeat("a", 159) {
		t.Fatalf("len=%d %q", len(d), d)
	}
	if d := detalheDoErro(&ErroChatwoot{500, nil, "criar_contato"}); d != `criar_contato:500 ""` {
		t.Fatalf("%q", d)
	}
	if d := detalheDoErro(errors.New(strings.Repeat("b", 300))); d != strings.Repeat("b", 160) {
		t.Fatalf("erro que não é do Chatwoot: %d", len(d))
	}
	if sem := semURL(errors.New(strings.Repeat("c", 300))); len(sem) != 160 {
		t.Fatalf("semURL: %d", len(sem))
	}
}
