package zoho

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// a tabela de db/migrations/acessos/006_zoho.sql:2-13 (a fatia do 5.4 a declara; aqui o teste não depende dela)
const tabelaDeConexoes = `create table if not exists acessos_conexoes (provedor text primary key, client_id text, client_secret text,
  refresh_token text, org_id text, data_center text default '.com', escopos text, conectado_por uuid, conectado_em timestamptz,
  atualizado_em timestamptz not null default now())`

func comConexao(t *testing.T, dc string) *pgxpool.Pool {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelaDeConexoes); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(context.Background(), `insert into acessos_conexoes (provedor, client_id, client_secret, refresh_token, data_center)
		values ('zoho', 'ID-1', 'SEGREDO-CLIENTE', 'SEGREDO-REFRESH', nullif($1::text, '-'))`, dc); err != nil {
		t.Fatal(err)
	}
	return p
}

// semSegredo: nenhum verbo de fmt (%v, %+v, %s, %#v) mostra segredo nem token de acesso. O %#v só obedece GoString;
// o %v/%+v de um *Cliente imprimiria o token em cache.
func semSegredo(t *testing.T, vs ...any) {
	t.Helper()
	for _, v := range vs {
		for _, verbo := range []string{"%v", "%+v", "%s", "%#v"} {
			if s := fmt.Sprintf(verbo, v); strings.Contains(s, "SEGREDO") || strings.Contains(s, "TOKEN-") {
				t.Errorf("%s de %T mostra segredo: %s", verbo, v, s)
			}
		}
	}
}

func TestConexao(t *testing.T) {
	ctx := context.Background()
	for _, c := range []struct{ dc, sufixo string }{{"-", ".com"}, {"", ".com"}, {".eu", ".eu"}, {"com.au", ".com.au"}} {
		con, err := Novo(comConexao(t, c.dc)).Conexao(ctx)
		if err != nil || con.sufixo != c.sufixo {
			t.Errorf("data_center %q = %q %v", c.dc, con.sufixo, err)
		}
		semSegredo(t, con)
	}
	for _, dc := range []string{"evil.com/x", ".com.evil.net", "com@evil"} {
		if _, err := Novo(comConexao(t, dc)).Conexao(ctx); !errors.Is(err, ErrDesconectado) {
			t.Errorf("data_center %q = %v, esperava ErrDesconectado", dc, err)
		}
	}
	p := comConexao(t, "-")
	if _, err := p.Exec(ctx, `update acessos_conexoes set refresh_token = ''`); err != nil {
		t.Fatal(err)
	}
	if _, err := Novo(p).Conexao(ctx); !errors.Is(err, ErrDesconectado) {
		t.Errorf("sem refresh_token = %v", err)
	}
	if _, err := p.Exec(ctx, `delete from acessos_conexoes`); err != nil {
		t.Fatal(err)
	}
	if _, err := Novo(p).Conexao(ctx); !errors.Is(err, ErrDesconectado) {
		t.Errorf("sem linha = %v", err)
	}
}

// zohoFalso: o accounts.zoho (token) e o WorkDrive (listar, baixar) de mentira.
type zohoFalso struct {
	mu                 sync.Mutex
	tokens, recusas    int    // quantos tokens foram pedidos; quantas respostas F7003 ainda dar
	itens              int    // itens da pasta "raiz"
	ultimoAuth, ultimo string // o Authorization e o caminho do último pedido à API
}

func (z *zohoFalso) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	z.mu.Lock()
	defer z.mu.Unlock()
	if r.URL.Path == "/oauth/v2/token" {
		r.ParseForm()
		if r.PostForm.Get("refresh_token") != "SEGREDO-REFRESH" || r.PostForm.Get("client_secret") != "SEGREDO-CLIENTE" {
			w.WriteHeader(400)
			return
		}
		z.tokens++
		fmt.Fprintf(w, `{"access_token":"TOKEN-%d"}`, z.tokens)
		return
	}
	z.ultimoAuth, z.ultimo = r.Header.Get("Authorization"), r.URL.RequestURI()
	if z.recusas > 0 {
		z.recusas--
		w.WriteHeader(400)
		io.WriteString(w, `{"errors":[{"id":"F7003","title":"Invalid OAuth token SEGREDO-NO-CORPO"}]}`)
		return
	}
	switch {
	case strings.HasPrefix(r.URL.Path, "/workdrive/api/v1/files/raiz/files"):
		offset := 0
		fmt.Sscan(r.URL.Query().Get("page[offset]"), &offset)
		var itens []string
		for i := offset; i < z.itens && i < offset+50; i++ {
			itens = append(itens, fmt.Sprintf(`{"id":"i%d","attributes":{"name":" item %d ","is_folder":%t}}`, i, i, i%2 == 0))
		}
		fmt.Fprintf(w, `{"data":[%s]}`, strings.Join(itens, ","))
	case r.URL.Path == "/workdrive/api/v1/files/quebrada/files":
		w.WriteHeader(500)
	case r.URL.Path == "/workdrive/api/v1/download/arq1":
		io.WriteString(w, "PNG-BYTES")
	case r.URL.Path == "/workdrive/api/v1/download/pula":
		http.Redirect(w, r, "http://127.0.0.1:1/arquivo", http.StatusFound) // para http: não segue
	default:
		w.WriteHeader(404)
	}
}

func TestClienteZoho(t *testing.T) {
	ctx := context.Background()
	z := &zohoFalso{itens: 60}
	srv := httptest.NewServer(z)
	defer srv.Close()
	c := ParaTeste(t, comConexao(t, "-"), srv.URL)
	con, err := c.Conexao(ctx)
	if err != nil {
		t.Fatal(err)
	}
	// listar pagina (60 itens = 2 chamadas), apara o nome e marca a pasta
	itens, err := c.Listar(ctx, con, "raiz")
	if err != nil || len(itens) != 60 || itens[0] != (Item{ID: "i0", Nome: "item 0", Pasta: true}) || itens[59].Pasta {
		t.Fatalf("listar = %d %v %+v", len(itens), err, itens)
	}
	if !strings.Contains(z.ultimo, "page%5Boffset%5D=50") && !strings.Contains(z.ultimo, "page[offset]=50") {
		t.Errorf("a 2ª página não pediu o offset 50: %s", z.ultimo)
	}
	// baixar com o MESMO token (um pedido de token para tudo até aqui)
	resp, err := c.Baixar(ctx, con, "arq1")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if string(b) != "PNG-BYTES" || z.tokens != 1 || z.ultimoAuth != "Zoho-oauthtoken TOKEN-1" {
		t.Errorf("baixar = %q, tokens %d, auth %q", b, z.tokens, z.ultimoAuth)
	}
	semSegredo(t, con, c) // o token TOKEN-1 já está em memória no cliente
	// F7003 (o Zoho invalidou o token antes da hora): renova e tenta UMA vez
	z.recusas = 1
	if _, err := c.Listar(ctx, con, "raiz"); err != nil || z.tokens != 2 {
		t.Errorf("F7003 = %v, tokens %d", err, z.tokens)
	}
	// recusado duas vezes: erro com o status, sem o corpo (que cita o token)
	z.recusas = 2
	_, err = c.Baixar(ctx, con, "arq1")
	var e *ErroHTTP
	if !errors.As(err, &e) || e.Status != 400 || strings.Contains(err.Error(), "SEGREDO") {
		t.Errorf("recusado duas vezes = %v", err)
	}
	// 404, listagem quebrada, redirecionamento para http e Zoho fora do ar
	if _, err := c.Baixar(ctx, con, "nao-existe"); !errors.As(err, &e) || e.Status != 404 {
		t.Errorf("404 = %v", err)
	}
	if _, err := c.Listar(ctx, con, "quebrada"); !errors.As(err, &e) || e.Status != 500 {
		t.Errorf("listagem quebrada = %v", err)
	}
	if _, err := c.Baixar(ctx, con, "pula"); !errors.As(err, &e) || e.Status != http.StatusFound {
		t.Errorf("redirecionamento para http = %v", err)
	}
	// o token em cache é DESTA conexão: outra conta (client_id diferente) pede token novo e a seguinte (de volta) também
	antes := z.tokens
	con2 := con
	con2.clientID = "ID-2"
	if resp, err := c.Baixar(ctx, con2, "arq1"); err != nil || z.tokens != antes+1 {
		t.Errorf("outra conta reaproveitou o token: %v, tokens %d -> %d", err, antes, z.tokens)
	} else {
		resp.Body.Close()
	}
	if resp, err := c.Baixar(ctx, con, "arq1"); err != nil || z.tokens != antes+2 {
		t.Errorf("voltar à conta anterior reaproveitou o token: %v, tokens %d", err, z.tokens)
	} else {
		resp.Body.Close()
	}
	// contexto cancelado: o erro diz isso (errors.Is), sem URL; com e sem token em cache
	cancelado, cancela := context.WithCancel(ctx)
	cancela()
	c3 := ParaTeste(t, comConexao(t, "-"), srv.URL)
	for nome, cli := range map[string]*Cliente{"com token": c, "sem token": c3} {
		_, err := cli.Listar(cancelado, con, "raiz")
		if !errors.Is(err, context.Canceled) || strings.Contains(err.Error(), "127.0.0.1") {
			t.Errorf("ctx cancelado (%s) = %v", nome, err)
		}
	}
	srv.Close()
	// com o token já em memória, a falha é na API (get); sem token, é no pedido do token (tokenDe): nenhum cita URL
	_, err = c.Listar(ctx, con, "raiz")
	if err == nil || strings.Contains(err.Error(), "127.0.0.1") || strings.Contains(err.Error(), "SEGREDO") {
		t.Errorf("API fora do ar = %v (sem URL nem segredo)", err)
	}
	c2 := ParaTeste(t, comConexao(t, "-"), srv.URL)
	_, err = c2.Listar(ctx, con, "raiz")
	if err == nil || strings.Contains(err.Error(), "127.0.0.1") || strings.Contains(err.Error(), "SEGREDO") {
		t.Errorf("fora do ar = %v (sem URL nem segredo)", err)
	}
}

// tbFalso grava o Fatalf em vez de derrubar o teste (testing.TB embutido só para satisfazer a interface).
type tbFalso struct {
	testing.TB
	falhou bool
}

func (f *tbFalso) Helper() {}
func (f *tbFalso) Fatalf(string, ...any) {
	f.falhou = true
	runtime.Goexit()
}

func TestParaTesteSoLoopbackHTTP(t *testing.T) {
	for base, ok := range map[string]bool{"http://127.0.0.1:1": true, "http://localhost:1/": true, "http://[::1]:1": true,
		"https://127.0.0.1": false, "http://10.0.0.1": false, "http://accounts.zoho.com": false, "://": false} {
		f := &tbFalso{}
		done := make(chan struct{})
		go func() { defer close(done); ParaTeste(f, nil, base) }() // Goexit só sai da goroutine
		<-done
		if f.falhou == ok {
			t.Errorf("ParaTeste(%q): recusou = %v, esperava %v", base, f.falhou, !ok)
		}
	}
}

// O POST do token carrega client_secret e refresh_token: um 307/308 não o reenvia a outro host; o GET do download
// segue (https, até 3).
func TestRedirecionamentoSoDoGet(t *testing.T) {
	seguir := Novo(nil).http.CheckRedirect
	destino, _ := http.NewRequest(http.MethodPost, "https://outro.example/x", strings.NewReader("client_secret=SEGREDO"))
	if err := seguir(destino, []*http.Request{{Method: http.MethodPost}}); !errors.Is(err, http.ErrUseLastResponse) {
		t.Errorf("POST seguiu o redirecionamento: %v", err)
	}
	get, _ := http.NewRequest(http.MethodGet, "https://outro.example/x", nil)
	if err := seguir(get, []*http.Request{{Method: http.MethodGet}}); err != nil {
		t.Errorf("GET https devia seguir: %v", err)
	}
}
