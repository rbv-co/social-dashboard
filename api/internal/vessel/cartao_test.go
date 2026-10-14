package vessel

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
	"github.com/rbv-co/social-dashboard/api/internal/zoho"
	"golang.org/x/text/unicode/norm"
)

// Os exemplos reais de supabase/functions/_shared/cartao-no-zoho.test.mjs.
func TestRegrasDoCartao(t *testing.T) {
	if n := nomeDoArquivo("SS0001HB.S1", 4, "frente", "png"); n != "SS0001HB.S1_cartao_04_frente.png" {
		t.Errorf("nome = %s", n)
	}
	if n := nomeDoArquivo("SS0003SB.B2", 10, "verso", "pdf"); n != "SS0003SB.B2_cartao_10_verso.pdf" {
		t.Errorf("nome = %s", n)
	}
	for _, c := range []struct {
		sku       string
		n         int
		face, fmt string
	}{{"SS0001HB.S1", 4, "lado", "png"}, {"SS0001HB.S1", 4, "frente", "exe"}, {"SS0001HB.S1", 0, "frente", "png"},
		{"", 4, "frente", "png"}, {"SS0001HB.S1", 4, "../../x", "png"}} {
		if n := nomeDoArquivo(c.sku, c.n, c.face, c.fmt); n != "" {
			t.Errorf("%+v virou nome: %s", c, n)
		}
	}
	pasta := func(id, nome string) zoho.Item { return zoho.Item{ID: id, Nome: nome, Pasta: true} }
	dias := diasEmOrdem([]zoho.Item{pasta("a", "2026-09-07"), pasta("b", "2026-10-07"), pasta("c", "2026-10-06"),
		pasta("d", "Cartões com EAN - BKP 07-09-2026"), {ID: "e", Nome: "2026-10-08"}})
	if ids := []string{dias[0].ID, dias[1].ID, dias[2].ID}; len(dias) != 3 || !reflect.DeepEqual(ids, []string{"b", "c", "a"}) {
		t.Errorf("dias = %+v", dias)
	}
	sub := []zoho.Item{pasta("1", "SS0001HB.S1 - Linear Caramelo Pequena"), pasta("2", "SS0001HB.S10 - Outra"),
		pasta("3", norm.NFD.String("SS0001HB.M2 - Linear Vermelha Média"))}
	if p := pastaDoSku(sub, "SS0001HB.S1"); p == nil || p.ID != "1" {
		t.Errorf("pasta do SKU = %+v", p)
	}
	if p := pastaDoSku(sub, "SS0001HB.M2"); p == nil || p.ID != "3" {
		t.Errorf("o acento solto escondeu a pasta: %+v", p)
	}
	if pastaDoSku(sub, "SS9999XX.Z9") != nil || pastaDoSku(nil, "SS0001HB.S1") != nil {
		t.Error("achou pasta que não existe")
	}
	if !ehPastaDosCartoes("Cartões com EAN") || !ehPastaDosCartoes(norm.NFD.String("Cartões com EAN")) || ehPastaDosCartoes("Cartões com EAN - BKP 06-09-2026") {
		t.Error("a pasta dos cartões")
	}
	for pasta, quer := range map[string]string{"Cartões com EAN/2026-10-09": "2026-10-09", " Cartões com EAN/2026-10-09 ": "2026-10-09",
		"Cartões com EAN/2026-10-09 - BKP": "", "Cartões com EAN": "", "": ""} {
		if d := diaDaPasta(pasta); d != quer {
			t.Errorf("diaDaPasta(%q) = %q", pasta, d)
		}
	}
	tres := []zoho.Item{pasta("9", "2026-10-09"), pasta("7", "2026-10-07"), pasta("6", "2026-10-06")}
	nomes := func(l []zoho.Item) (s []string) {
		for _, i := range l {
			s = append(s, i.Nome)
		}
		return
	}
	for dica, quer := range map[string][]string{"2026-10-06": {"2026-10-06", "2026-10-09", "2026-10-07"},
		"2026-10-09": {"2026-10-09", "2026-10-07", "2026-10-06"}, "2026-01-01": {"2026-10-09", "2026-10-07", "2026-10-06"},
		"": {"2026-10-09", "2026-10-07", "2026-10-06"}} {
		if n := nomes(diasComDicaPrimeiro(tres, dica)); !reflect.DeepEqual(n, quer) {
			t.Errorf("dica %q = %v", dica, n)
		}
	}
}

// zohoDoRobo: a árvore que o robô de cartões deixa no WorkDrive, de mentira.
type zohoDoRobo struct {
	mu        sync.Mutex
	pedidos   []string          // os caminhos pedidos à API (sem o token)
	quebrado  bool              // toda listagem responde 500
	pastas    map[string]string // id da pasta → itens no JSON:API do WorkDrive
	conteudos map[string]string // id do arquivo → bytes; ausente = 404
	recusa    map[string]int    // id do arquivo → status do download
}

func novoZohoDoRobo() *zohoDoRobo {
	item := func(id, nome string, pasta bool) string {
		return fmt.Sprintf(`{"id":%q,"attributes":{"name":%q,"is_folder":%t}}`, id, nome, pasta)
	}
	lista := func(itens ...string) string { return `{"data":[` + strings.Join(itens, ",") + `]}` }
	return &zohoDoRobo{
		pastas: map[string]string{
			raizDasFotos: lista(item("vb", "Vessel Brasil", true), item("outra", "Outra marca", true)),
			"vb":         lista(item("bkp", "Cartões com EAN - BKP 06-09-2026", true), item("ce", norm.NFD.String("Cartões com EAN"), true)),
			"ce":         lista(item("d8", "2026-10-08", true), item("d9", "2026-10-09", true)),
			"d9":         lista(item("sku9", "SS0001HB.S1 - Linear Caramelo", true)),
			"d8":         lista(item("sku8", "SS0001HB.S1 - Linear Caramelo", true)),
			"sku9":       lista(item("v1", "SS0001HB.S1_cartao_01_verso.png", false), item("fp1", "SS0001HB.S1_cartao_01_frente.pdf", false)),
			"sku8":       lista(item("vp1", "SS0001HB.S1_cartao_01_verso.pdf", false)),
		},
		conteudos: map[string]string{"gravado1": "FRENTE-PNG", "v1": "VERSO-PNG", "vp1": "VERSO-PDF-DO-DIA-8"},
		recusa:    map[string]int{"fp1": 500},
	}
}

func (z *zohoDoRobo) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	z.mu.Lock()
	defer z.mu.Unlock()
	if r.URL.Path == "/oauth/v2/token" {
		io.WriteString(w, `{"access_token":"TOKEN-DO-ZOHO"}`)
		return
	}
	z.pedidos = append(z.pedidos, r.URL.Path)
	if r.Header.Get("Authorization") != "Zoho-oauthtoken TOKEN-DO-ZOHO" {
		w.WriteHeader(401)
		return
	}
	if id, ok := strings.CutPrefix(r.URL.Path, "/workdrive/api/v1/download/"); ok {
		if s := z.recusa[id]; s != 0 {
			w.WriteHeader(s)
			return
		}
		c, ok := z.conteudos[id]
		if !ok {
			w.WriteHeader(404)
			return
		}
		io.WriteString(w, c)
		return
	}
	id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/workdrive/api/v1/files/"), "/files")
	if z.quebrado {
		w.WriteHeader(500)
		return
	}
	if l, ok := z.pastas[id]; ok && r.URL.Query().Get("page[offset]") == "0" {
		io.WriteString(w, l)
		return
	}
	io.WriteString(w, `{"data":[]}`)
}

func (z *zohoDoRobo) contar(prefixo string) (n int) {
	z.mu.Lock()
	defer z.mu.Unlock()
	for _, p := range z.pedidos {
		if strings.HasPrefix(p, prefixo) {
			n++
		}
	}
	z.pedidos = nil
	return
}

func TestBaixarCartao(t *testing.T) {
	z := novoZohoDoRobo()
	srv := httptest.NewServer(z)
	defer srv.Close()
	m := novoMundo(t, func(r chi.Router, p *pgxpool.Pool) {
		r.Post("/vessel-baixar-cartao", (&Cartao{Pool: p, Zoho: zoho.ParaTeste(t, p, srv.URL)}).ServeHTTP)
	})
	// a conexão (a tabela é da fatia do 5.4: aqui só se faltar) e o id que o robô gravou da frente em png de P1
	if _, err := m.P.Exec(context.Background(), `create table if not exists acessos_conexoes (provedor text primary key, client_id text,
		  client_secret text, refresh_token text, org_id text, data_center text default '.com', escopos text, conectado_por uuid,
		  conectado_em timestamptz, atualizado_em timestamptz not null default now())`); err != nil {
		t.Fatal(err)
	}
	m.P.Exec(context.Background(), `insert into acessos_conexoes (provedor, client_id, client_secret, refresh_token) values
		('zoho', 'ID', 'SEGREDO-CLIENTE', 'SEGREDO-REFRESH');
		insert into vessel_cartao_arquivos (codigo, nome, zoho_id) values ('VBAAAA0001', 'SS0001HB.S1_cartao_01_frente.png', 'gravado1');
		update vessel_pecas set cartao_gerado_em = now() where codigo = 'VBAAAA0003'`)
	corpo := func(codigo, face, formato string) string {
		return fmt.Sprintf(`{"codigo":%q,"face":%q,"formato":%q}`, codigo, face, formato)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "quem não é do selo", Quem: "admin", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P1, "frente", "png"), Status: 403, Tem: `"error":"sem_permissao"`},
		{Nome: "a chave só em permissions", Quem: "chave", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P1, "frente", "png"), Status: 403},
		{Nome: "desativado", Quem: "desativado", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P1, "frente", "png"), Status: 401},
	})
	if n := z.contar("/"); n != 0 {
		t.Fatalf("quem foi recusado chegou ao Zoho: %d pedidos", n)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "sem corpo", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Status: 400, Tem: `"erro":"codigo_invalido"`},
		{Nome: "código que não é texto", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: `{"codigo":12345678,"face":"frente","formato":"png"}`, Status: 400, Tem: "codigo_invalido"},
		{Nome: "código com barra", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo("../VBAAAA0001", "frente", "png"), Status: 400, Tem: "codigo_invalido"},
		{Nome: "peça que não existe", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo("ZZZZ9999", "frente", "png"), Status: 404, Tem: `"erro":"peca_nao_existe"`},
		{Nome: "peça sem cartão", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P2, "frente", "png"), Status: 409, Tem: `"erro":"sem_cartao"`},
		{Nome: "face fora da lista", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P1, "lado", "png"), Status: 400, Tem: `"erro":"pedido_invalido"`},
		{Nome: "face com caminho", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P1, "../../x", "png"), Status: 400, Tem: "pedido_invalido"},
	})
	if n := z.contar("/"); n != 0 {
		t.Fatalf("pedido inválido chegou ao Zoho: %d pedidos", n)
	}
	// o caminho comum: o id gravado pelo robô, sem listar nada; o "entrar como" também baixa (só lê)
	for _, quem := range []string{"selo", "impersonado"} {
		w := m.Resposta(t, quem, "POST", "/vessel-baixar-cartao", corpo(strings.ToLower(P1), "frente", "png"))
		if w.Code != 200 || w.Body.String() != "FRENTE-PNG" || w.Header().Get("Content-Type") != "application/octet-stream" ||
			!strings.Contains(w.Header().Get("Content-Disposition"), "SS0001HB.S1_cartao_01_frente.png") || w.Header().Get("Cache-Control") != "no-store" {
			t.Errorf("%s baixando pelo id gravado = %d %q %v", quem, w.Code, w.Body, w.Header())
		}
		if n, l := z.contar("/workdrive/api/v1/download/"), z.contar("/workdrive/api/v1/files/"); n != 1 || l != 0 {
			t.Errorf("%s: %d downloads e %d listagens, esperava 1 e 0", quem, n, l)
		}
	}
	// sem id gravado: a busca acha no dia da dica (o do último pedido pronto: 2026-10-09) e no dia mais velho
	casos := []struct{ face, formato, quer string }{{"verso", "png", "VERSO-PNG"}, {"verso", "pdf", "VERSO-PDF-DO-DIA-8"}}
	for _, c := range casos {
		w := m.Resposta(t, "selo", "POST", "/vessel-baixar-cartao", corpo(P1, c.face, c.formato))
		if w.Code != 200 || w.Body.String() != c.quer {
			t.Errorf("busca %s.%s = %d %s", c.face, c.formato, w.Code, w.Body)
		}
	}
	// id gravado que o Zoho recusa (arquivo trocado): cai na busca
	m.P.Exec(context.Background(), `insert into vessel_cartao_arquivos (codigo, nome, zoho_id) values ('VBAAAA0001', 'SS0001HB.S1_cartao_01_verso.png', 'sumiu')`)
	if st, b := m.Pedir(t, "selo", "POST", "/vessel-baixar-cartao", corpo(P1, "verso", "png")); st != 200 || b != "VERSO-PNG" {
		t.Errorf("id gravado recusado = %d %s", st, b)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "arquivo que nenhum dia tem", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P3, "frente", "png"),
			Status: 404, Tem: `"arquivo":"SS0001HB.S1_cartao_03_frente.png"`},
		{Nome: "o Zoho recusa o download", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao", Corpo: corpo(P1, "frente", "pdf"),
			Status: 502, Tem: `"status":500`},
	})
	z.mu.Lock()
	z.quebrado = true // toda listagem responde 500 daqui em diante
	z.mu.Unlock()
	m.Rodar(t, []mundoteste.Caso{{Nome: "o Zoho fora do ar na busca", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao",
		Corpo: corpo(P1, "verso", "pdf"), Status: 502, Tem: `"erro":"zoho_indisponivel"`, NaoTem: "SEGREDO"}})
	m.P.Exec(context.Background(), `delete from acessos_conexoes`)
	m.Rodar(t, []mundoteste.Caso{{Nome: "sem conexão do Zoho", Quem: "selo", Metodo: "POST", Caminho: "/vessel-baixar-cartao",
		Corpo: corpo(P1, "frente", "png"), Status: 503, Tem: `"erro":"zoho_desconectado"`}})
}
