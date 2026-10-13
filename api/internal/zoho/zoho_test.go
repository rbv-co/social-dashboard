package zoho

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
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

func TestConexao(t *testing.T) {
	ctx := context.Background()
	for _, c := range []struct{ dc, sufixo string }{{"-", ".com"}, {"", ".com"}, {".eu", ".eu"}, {"com.au", ".com.au"}} {
		con, err := Novo(comConexao(t, c.dc)).Conexao(ctx)
		if err != nil || con.sufixo != c.sufixo {
			t.Errorf("data_center %q = %q %v", c.dc, con.sufixo, err)
		}
		if s := fmt.Sprint(con) + fmt.Sprintf("%v %s", con, con); strings.Contains(s, "SEGREDO") {
			t.Errorf("a conexão impressa mostra o segredo: %s", s)
		}
	}
	for _, dc := range []string{"evil.com/x", ".com.evil.net", "com@evil"} {
		if _, err := Novo(comConexao(t, dc)).Conexao(ctx); !errors.Is(err, ErrDesconectado) {
			t.Errorf("data_center %q = %v, esperava ErrDesconectado", dc, err)
		}
	}
	p := comConexao(t, "-")
	p.Exec(ctx, `update acessos_conexoes set refresh_token = ''`)
	if _, err := Novo(p).Conexao(ctx); !errors.Is(err, ErrDesconectado) {
		t.Errorf("sem refresh_token = %v", err)
	}
	p.Exec(ctx, `delete from acessos_conexoes`)
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
