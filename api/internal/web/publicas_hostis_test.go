package web

// Plano 01 do esforço REVISAO-TESTES-2026-10 (itens B e C): as rotas PÚBLICAS (sem sessão) pela montagem real,
// com entrada hostil. Cada pedido tem de dar < 500, igual na repetição, sem vazar o canário do disco, o diretório
// do Storage, o segredo de URL assinada nem rastro de pilha/SQL no corpo.

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

const canario = "CANARIO-VAZOU-9f3a71"

// rastros: o que NUNCA aparece no corpo de uma resposta (pilha do Go, texto do driver/Postgres, segredos de teste).
var rastros = []string{"goroutine ", "panic(", ".go:", "SQLSTATE", "pgconn", "pgx", "ERROR:", "syntax error", "duplicate key", "violates", "does not exist", "invalid input syntax", "Key (", "segredo-de-teste", chaveDoCore, "Bearer "}

func semVazamento(t *testing.T, quem string, arquivos string, corpo string) {
	t.Helper()
	for _, r := range append([]string{canario, arquivos}, rastros...) {
		if r != "" && strings.Contains(corpo, r) {
			t.Errorf("%s: a resposta vaza %q: %.200s", quem, r, corpo)
		}
	}
}

// hostis: valores que entram em cada parâmetro de caminho das rotas públicas.
var hostis = []string{
	"..", "../..", "%2e%2e", "%2e%2e%2f%2e%2e%2fCANARIO-RAIZ.txt", "..%2f..%2fCANARIO-RAIZ.txt", "%2e%2e/%2e%2e/CANARIO-RAIZ.txt",
	"..\\..\\CANARIO-RAIZ.txt", "%5c..%5cCANARIO-RAIZ.txt", "/etc/passwd", "%2fetc%2fpasswd", "CANARIO-RAIZ.txt", "%00", "a%00.pdf",
	"a;drop table usuarios;--", "%27%20or%20%271%27%3D%271", "%C3%28", "ç", "con", "x.pdf%20", "." + strings.Repeat("a", 300),
	strings.Repeat("a", 5000), "publico", "conteudo", "consultor-tivoli", "consultor-brasilia", "vessel-curriculos",
}

var corposHostis = []struct{ ct, corpo string }{
	{"application/json", `{`}, {"application/json", `[]`}, {"application/json", `null`}, {"application/json", `"x"`},
	{"application/json", `{"a":"\u0000","b":1e999,"c":-0}`}, {"application/json", strings.Repeat("[", 20000)},
	{"application/json; charset=utf-8", `{"email":"a@b.c","password":"x","p_teste":true}`},
	{"application/json", `{"p_teste":true,"p_nome":"' or 1=1--"}`}, {"text/plain", `{"a":1}`}, {"application/x-www-form-urlencoded", `a=b&c=d`},
	{"multipart/form-data; boundary=zzz", "--zzz\r\nContent-Disposition: form-data; name=\"a\"\r\n\r\nb\r\n--zzz--\r\n"},
	{"", `{}`}, {"application/json", string(bytes.Repeat([]byte("a"), 2<<20))},
}

// Item B: nenhum caminho, corpo ou tipo hostil derruba (5xx), trava ou vaza nas rotas públicas.
func TestPublicasComEntradaHostil(t *testing.T) {
	_, h, _, arquivos, _ := mundoDaMatriz(t)
	for _, ar := range []struct{ rel, conteudo string }{
		{"../CANARIO-RAIZ.txt", canario}, {"CANARIO-RAIZ.txt", canario}, {"conteudo/privado.jpg", canario}, {"vessel-curriculos/consultor-tivoli/seguro.pdf", canario},
	} {
		c := filepath.Join(arquivos, ar.rel)
		if err := os.MkdirAll(filepath.Dir(c), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(c, []byte(ar.conteudo), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.MkdirAll(filepath.Join(arquivos, "publico"), 0o755); err != nil {
		t.Fatal(err)
	}
	os.WriteFile(filepath.Join(arquivos, "publico", "ok.png"), []byte("PUBLICO-OK"), 0o644)
	// controle positivo: o arquivo do bucket público sai (se nada saísse, "não vazou" não provaria nada)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/storage/v1/object/public/publico/ok.png", nil))
	if w.Code != http.StatusOK || w.Body.String() != "PUBLICO-OK" {
		t.Fatalf("controle positivo: GET público do bucket público = %d %.80s", w.Code, w.Body)
	}
	if w.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Errorf("arquivo servido sem X-Content-Type-Options: nosniff (cabeçalhos: %v)", w.Header())
	}

	n := 0
	hist := map[int]int{}
	faz := func(m, caminho, ct string, corpo []byte, ip int) {
		t.Helper()
		var cods [2]int
		for i := range cods {
			r := httptest.NewRequest(m, "/", bytes.NewReader(corpo))
			u, err := url.Parse(caminho)
			if err != nil { // caminho que nem o cliente HTTP monta
				return
			}
			r.URL, r.RequestURI = u, caminho
			r.RemoteAddr = "127.0.0.1:4000" // loopback: o X-Real-IP vale e cada pedido tem o seu IP (o limite por IP não mascara a repetição)
			r.Header.Set("X-Real-IP", fmt.Sprintf("10.%d.%d.%d", ip>>16&255, ip>>8&255, ip&255))
			r.Header.Set("Origin", "https://evil.example")
			if ct != "" {
				r.Header.Set("Content-Type", ct)
			}
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			cods[i] = w.Code
			if o := w.Header().Get("Access-Control-Allow-Origin"); o == "*" || strings.Contains(o, "evil") {
				t.Errorf("%s %.80s: Access-Control-Allow-Origin = %q para origem hostil", m, caminho, o)
			}
			hist[w.Code]++
			quem := fmt.Sprintf("%s %.80s [%s]", m, caminho, ct)
			if w.Code >= 500 {
				t.Errorf("%s = %d %.160s (nunca 5xx com entrada hostil)", quem, w.Code, w.Body)
			}
			semVazamento(t, quem, arquivos, w.Body.String())
			if strings.Contains(w.Body.String(), "PUBLICO-OK") && !strings.HasSuffix(caminho, "/publico/ok.png") {
				t.Errorf("%s serviu o arquivo público fora do caminho dele", quem)
			}
		}
		if cods[0] != cods[1] && cods[0] != http.StatusTooManyRequests && cods[1] != http.StatusTooManyRequests {
			t.Errorf("%s %.80s: repetido deu %d e depois %d", m, caminho, cods[0], cods[1])
		}
		n++
	}
	ip := 1
	for chave, l := range matriz {
		if l.g != gPublica {
			continue
		}
		m, rota, _ := strings.Cut(chave, " ")
		for _, hv := range append([]string{"x"}, hostis...) {
			caminho := strings.NewReplacer("{nome}", hv, "{edge}", hv, "{bucket}", hv, "{pasta}", hv, "{arquivo}", hv, "*", hv).Replace(rota)
			if m == "GET" || m == "OPTIONS" {
				ip++
				faz(m, caminho, "", nil, ip)
				continue
			}
			for _, c := range corposHostis {
				ip++
				faz(m, caminho, c.ct, []byte(c.corpo), ip)
			}
			if strings.Contains(rota, "{") || strings.Contains(rota, "*") {
				continue
			}
			break // rota sem parâmetro: um valor hostil só repetiria o mesmo caminho
		}
	}
	// os 3 GET de arquivo com dois jeitos de montar o caminho, direto (sem substituir parâmetro de rota)
	for _, c := range []string{
		"/storage/v1/object/public/publico/..%2fCANARIO-RAIZ.txt", "/storage/v1/object/public/publico/../CANARIO-RAIZ.txt",
		"/storage/v1/object/public/conteudo/privado.jpg", "/storage/v1/object/public/%2e%2e/CANARIO-RAIZ.txt",
		"/storage/v1/object/public/publico//..//..//CANARIO-RAIZ.txt", "/storage/v1/object/sign/conteudo/privado.jpg?exp=9999999999&sig=" + strings.Repeat("0", 64),
		"/storage/v1/object/sign/conteudo/privado.jpg?exp=1&sig=x", "/storage/v1/object/sign/conteudo/privado.jpg", "/storage/v1/object/sign/..%2fCANARIO-RAIZ.txt?exp=9999999999&sig=0",
	} {
		ip++
		w := httptest.NewRecorder()
		r := httptest.NewRequest("GET", c, nil)
		h.ServeHTTP(w, r)
		if w.Code == http.StatusOK {
			t.Errorf("GET %s = 200: serviu o que não é público (corpo %.60s)", c, w.Body)
		}
		semVazamento(t, "GET "+c, arquivos, w.Body.String())
	}
	t.Logf("%d pedidos hostis (x2) nas rotas públicas; status: %v", n, hist)
}

// Item B (429): toda rota pública que GRAVA ou faz trabalho (POST) tem teto por origem. A origem é a do socket: de IP
// público, o X-Real-IP forjado pelo atacante é ignorado, então trocar o cabeçalho a cada pedido não escapa do limite.
func TestPublicasLimitamPorOrigem(t *testing.T) {
	_, _, _, _, nova := mundoDaMatriz(t)
	for chave, l := range matriz {
		m, rota, _ := strings.Cut(chave, " ")
		if l.g != gPublica || m != "POST" {
			continue
		}
		rota = strings.NewReplacer("{nome}", "vessel_conta", "{edge}", "vessel-conta", "{pasta}", "consultor-tivoli", "{arquivo}", "cv.pdf").Replace(rota)
		corpo := map[string]string{ // a validação vem ANTES do limitador de propósito (a chave do limite não cresce sem teto): o corpo tem de ser válido
			"POST /auth/entrar": `{"email":"a@x.com","senha":"errada"}`, "POST /auth/esqueci-senha": `{"email":"a@x.com"}`,
			"POST /auth/definir-senha": `{"token":"inexistente","senha":"UmaSenhaLonga123"}`,
		}[chave]
		if corpo == "" {
			corpo = `{"a":1}`
		}
		h := nova()
		visto429 := false
		for i := 0; i < 1300 && !visto429; i++ {
			r := httptest.NewRequest(m, rota, strings.NewReader(corpo))
			r.RemoteAddr = "198.51.100.9:5000" // IP público: X-Real-IP não vale
			r.Header.Set("X-Real-IP", fmt.Sprintf("10.9.%d.%d", i>>8&255, i&255))
			r.Header.Set("Content-Type", "application/json")
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			if w.Code >= 500 {
				t.Fatalf("%s: pedido %d deu %d %.120s", chave, i, w.Code, w.Body)
			}
			visto429 = w.Code == http.StatusTooManyRequests
			// ponytail: /auth/{entrar,esqueci-senha,definir-senha} respondem 429 sem Retry-After (ACHADOS-01 #1, Baixa);
			// só o teto de /auth/* sem cabeçalho é aceito aqui, o das demais públicas tem de trazê-lo.
			if visto429 && w.Header().Get("Retry-After") == "" && !strings.HasPrefix(rota, "/auth/") {
				t.Errorf("%s: 429 sem Retry-After", chave)
			}
		}
		if !visto429 {
			t.Errorf("%s: 1300 pedidos de uma origem só e nenhum 429 (rota pública sem teto)", chave)
		}
	}
}

// Item B (filtros do dialeto): os parâmetros de query das leituras de domínio (`limite`, `deslocamento`, `ordem`,
// `contar` e os filtros declarados de cada rota) com identificadores e valores hostis. A gramática das consultas é
// fechada e os valores entram como parâmetro: o pedido ruim dá 4xx, nunca 5xx, nunca atrasa o banco (pg_sleep) nem
// muda o esquema. Limite honesto: o banco do teste tem as tabelas vazias, então um `pg_sleep` injetado numa cláusula que
// nunca roda não prova nada pelo tempo; a prova de que a injeção não vira SQL é a gramática fechada + parâmetros
// (internal/dados/consulta_*_test.go, fuzz); aqui fica o 5xx, o vazamento e o esquema intacto.
func TestFiltrosHostisNasLeiturasDeDominio(t *testing.T) {
	p, h, sessoes, arquivos, _ := mundoDaMatriz(t)
	contagem := func() string {
		var s string
		if err := p.QueryRow(context.Background(), `select (select count(*) from usuarios)::text || '/' || (select count(*) from information_schema.tables where table_schema = current_schema())::text
			|| '/' || (select count(*) from pg_proc where pronamespace = current_schema()::regnamespace)::text`).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	antes := contagem()
	valores := []string{
		"1' or '1'='1", "1; drop table usuarios; --", "'||(select pg_sleep(5))||'", "1);select pg_sleep(5);--", "-1", "99999999999999999999",
		"%00", "\x00", "ç€\u202e", strings.Repeat("9", 400), "{ler:usuarios:x}", "in.(1,2,3", "(select count(*) from usuarios)", "usuarios.senha_hash desc",
	}
	chaves := []string{"limite", "deslocamento", "ordem", "contar", "id", "conta_id", "status", "de", "q", "select", "order", "senha_hash", "usuarios.senha_hash", "id;drop table usuarios"}
	n := 0
	for chave, l := range matriz {
		m, rota, _ := strings.Cut(chave, " ")
		if l.g != gDominio || m != "GET" || strings.Contains(rota, "{") {
			continue
		}
		for _, pf := range []perfil{pSuper, pSem} {
			tok := sessoes()[pf]
			for _, k := range chaves {
				for _, v := range valores {
					q := url.Values{k: {v}}.Encode()
					r := httptest.NewRequest("GET", rota+"?"+q, nil)
					r.Header.Set("Authorization", "Bearer "+tok)
					w := httptest.NewRecorder()
					t0 := time.Now()
					h.ServeHTTP(w, r)
					n++
					if w.Code >= 500 {
						t.Errorf("%s ?%.60s como %s = %d %.120s", chave, q, pf, w.Code, w.Body)
					}
					if d := time.Since(t0); d > 3*time.Second {
						t.Errorf("%s ?%.60s demorou %s (consulta injetada?)", chave, q, d)
					}
					semVazamento(t, chave+" ?"+k, arquivos, w.Body.String())
					if strings.Contains(w.Body.String(), "$2a$") || strings.Contains(w.Body.String(), "$2b$") {
						t.Errorf("%s ?%.60s como %s devolveu hash de senha", chave, q, pf)
					}
				}
			}
		}
	}
	if depois := contagem(); depois != antes {
		t.Errorf("o banco mudou durante a varredura: antes %s, depois %s (usuários/tabelas/funções)", antes, depois)
	}
	t.Logf("%d pedidos com filtro hostil", n)
}

// Item C: segredo nunca em log, em resposta de erro nem em /saude e /pronto. Entram senha, token de sessão inventado,
// token de senha, assinatura de webhook e o segredo dos webhooks; depois o banco cai e /pronto não pode mostrar a conexão.
func TestSegredosNaoVazamNosLogsNemNasRespostas(t *testing.T) {
	p, h, _, arquivos, _ := mundoDaMatriz(t)
	logs := capturaLogs(t)
	const (
		senha  = "SenhaSecreta!987-nao-pode-sair"
		tokenR = "tok-inventado-ABCDEF0123456789-nao-pode-sair"
		assin  = "assinatura-do-webhook-nao-pode-sair"
	)
	var corpos []string
	pede := func(m, caminho, corpo string, cab map[string]string) {
		r := httptest.NewRequest(m, caminho, strings.NewReader(corpo))
		r.Header.Set("Content-Type", "application/json")
		for k, v := range cab {
			r.Header.Set(k, v)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		corpos = append(corpos, w.Body.String())
		for k := range w.Header() {
			if strings.EqualFold(k, "Server") || strings.EqualFold(k, "X-Powered-By") {
				t.Errorf("%s %s expõe o cabeçalho %s", m, caminho, k)
			}
		}
	}
	pede("POST", "/auth/entrar", `{"email":"ninguem@x.com","senha":"`+senha+`"}`, nil)
	pede("POST", "/auth/esqueci-senha", `{"email":"ninguem@x.com"}`, nil)
	pede("POST", "/auth/definir-senha", `{"token":"`+tokenR+`","senha":"`+senha+`"}`, nil)
	pede("GET", "/auth/eu", "", map[string]string{"Authorization": "Bearer " + tokenR})
	pede("POST", "/receber-webhook-pedido-shopify", `{"id":1}`, map[string]string{"X-Shopify-Hmac-Sha256": assin})
	pede("POST", "/receber-webhook-chatwoot", `{"id":1}`, map[string]string{"X-Chatwoot-Signature": assin, "Authorization": "Bearer " + assin})
	pede("POST", "/rest/v1/rpc/vessel_conta", `{"p_senha":"`+senha+`"}`, map[string]string{"apikey": tokenR, "Authorization": "Bearer " + tokenR})
	pede("GET", "/saude", "", nil)
	pede("GET", "/pronto", "", nil)
	p.Close() // o banco "cai": /pronto responde 503 sem a string de conexão
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest("GET", "/pronto", nil))
	if w.Code != http.StatusServiceUnavailable || strings.TrimSpace(w.Body.String()) != "banco indisponível" {
		t.Errorf("/pronto com o banco fora = %d %q, esperava 503 \"banco indisponível\" (sem detalhe do driver)", w.Code, w.Body)
	}
	corpos = append(corpos, w.Body.String())
	for _, s := range []string{senha, tokenR, assin, "segredo-de-teste", chaveDoCore, "postgres://"} {
		if strings.Contains(logs.String(), s) {
			t.Errorf("o segredo %q apareceu nos logs", s)
		}
		for _, c := range corpos {
			if strings.Contains(c, s) {
				t.Errorf("o segredo %q voltou numa resposta: %.120s", s, c)
			}
		}
	}
	for _, c := range corpos {
		semVazamento(t, "resposta", arquivos, c)
	}
}

// Item B (Core x anônimo) pela montagem REAL (cfg com VESSEL_SO_CORE): função de escrita só com a chave do Core; a lista é
// fechada (função de painel/conta = 404 até para o Core); p_teste é ignorado para o anônimo; 415 antes de qualquer coisa.
func TestPublicasSoCorePelaMontagemReal(t *testing.T) {
	_, h, _, _, _ := mundoDaMatriz(t)
	pedir := func(nome, ct, corpo, chave string) (int, string) {
		r := httptest.NewRequest("POST", "/rest/v1/rpc/"+nome, strings.NewReader(corpo))
		if ct != "" {
			r.Header.Set("Content-Type", ct)
		}
		if chave != "" {
			r.Header.Set("Authorization", "Bearer "+chave)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w.Code, w.Body.String()
	}
	escrita := `{"p_nome":"Ana","p_email":"ana@x.com","p_whatsapp":"11999990000","p_aceite_versao":"v1"}`
	for _, c := range []struct {
		nome, ct, corpo, chave string
		quer                   func(int) bool
		regra                  string
	}{
		{"vessel_entrar_na_lista", "application/json", escrita, "", func(s int) bool { return s == 404 }, "escrita anônima = 404"},
		{"vessel_entrar_na_lista", "application/json", escrita, "chave-errada", func(s int) bool { return s == 404 }, "chave errada = 404"},
		{"vessel_entrar_na_lista", "application/json", escrita, chaveDoCore, func(s int) bool { return s == 200 }, "Core escreve"},
		{"vessel_entrar_na_lista", "text/plain", escrita, chaveDoCore, func(s int) bool { return s == 415 }, "415 antes de tudo, até para o Core"},
		{"vessel_pre_venda_restantes", "application/json", `{}`, "", func(s int) bool { return s == 200 }, "leitura anônima"},
		{"is_superadmin", "application/json", `{}`, chaveDoCore, func(s int) bool { return s == 404 }, "função de painel: 404 até para o Core"},
		{"vessel_conta_criar", "application/json", `{}`, chaveDoCore, func(s int) bool { return s == 404 }, "função de conta fora da lista"},
	} {
		if st, corpo := pedir(c.nome, c.ct, c.corpo, c.chave); !c.quer(st) {
			t.Errorf("%s (%s) = %d %.120s", c.nome, c.regra, st, corpo)
		}
	}
}

// Item B (upload): currículo anônimo/Core e PUT autenticado pela montagem real: tipo, tamanho e caminho. Nada sai
// do bucket e nada é criado por pedido recusado.
func TestUploadsHostisPelaMontagemReal(t *testing.T) {
	_, h, sessoes, arquivos, _ := mundoDaMatriz(t)
	envia := func(m, caminho, ct string, corpo []byte, tok string) int {
		r := httptest.NewRequest(m, "/", bytes.NewReader(corpo))
		u, err := url.Parse(caminho)
		if err != nil {
			t.Fatal(err)
		}
		r.URL, r.RequestURI = u, caminho
		if ct != "" {
			r.Header.Set("Content-Type", ct)
		}
		if tok != "" {
			r.Header.Set("Authorization", "Bearer "+tok)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		semVazamento(t, m+" "+caminho, arquivos, w.Body.String())
		return w.Code
	}
	const pdf = "application/pdf"
	cv := []byte("%PDF-1.4 curriculo")
	for _, c := range []struct {
		caminho, ct, tok string
		corpo            []byte
		quer             int
	}{
		{"/storage/v1/object/vessel-curriculos/consultor-tivoli/ok.pdf", pdf, chaveDoCore, cv, 200},
		{"/storage/v1/object/vessel-curriculos/consultor-tivoli/ok.pdf", pdf, chaveDoCore, cv, 409}, // nunca sobrescreve
		{"/storage/v1/object/vessel-curriculos/consultor-tivoli/anon.pdf", pdf, "", cv, 403},        // VESSEL_SO_CORE: o navegador não grava
		{"/storage/v1/object/vessel-curriculos/outra-pasta/a.pdf", pdf, chaveDoCore, cv, 403},
		{"/storage/v1/object/vessel-curriculos/consultor-tivoli/..", pdf, chaveDoCore, cv, 403},
		{"/storage/v1/object/vessel-curriculos/consultor-tivoli/.oculto", pdf, chaveDoCore, cv, 403},
		{"/storage/v1/object/vessel-curriculos/consultor-tivoli/a%2f..%2f..%2fx.pdf", pdf, chaveDoCore, cv, 403},
		{"/storage/v1/object/vessel-curriculos/consultor-tivoli/" + strings.Repeat("a", 121), pdf, chaveDoCore, cv, 403},
		{"/storage/v1/object/vessel-curriculos/consultor-tivoli/pagina.html", "text/html", chaveDoCore, cv, 415},
		{"/storage/v1/object/vessel-curriculos/consultor-tivoli/exe.pdf", "application/x-msdownload", chaveDoCore, cv, 415},
		{"/storage/v1/object/vessel-curriculos/consultor-tivoli/grande.pdf", pdf, chaveDoCore, bytes.Repeat([]byte("a"), 5<<20+10), 413},
	} {
		if st := envia("POST", c.caminho, c.ct, c.corpo, c.tok); st != c.quer {
			t.Errorf("POST %.100s (%s, %d bytes) = %d, esperava %d", c.caminho, c.ct, len(c.corpo), st, c.quer)
		}
	}
	// PUT autenticado (superadmin): caminho hostil = 400, tipo fora do bucket = 415, grande demais = 413
	tok := sessoes()[pSuper]
	png := []byte("\x89PNG\r\n\x1a\n")
	for _, c := range []struct {
		caminho, ct string
		corpo       []byte
		quer        int
	}{
		{"/arquivos/avatars/foto.png", "image/png", png, 200},
		{"/arquivos/avatars/..%2f..%2fCANARIO-RAIZ.txt", "image/png", png, 400},
		{"/arquivos/avatars/a/../../b.png", "image/png", png, 400},
		{"/arquivos/avatars/%2fetc%2fpasswd", "image/png", png, 400},
		{"/arquivos/avatars/a%5c..%5cb.png", "image/png", png, 400},
		{"/arquivos/avatars/x.html", "text/html", png, 415},
		{"/arquivos/avatars/x.svg", "image/svg+xml", []byte("<svg onload=alert(1)>"), 415},
		{"/arquivos/avatars/grande.png", "image/png", bytes.Repeat([]byte("a"), 2<<20+10), 413},
	} {
		if st := envia("PUT", c.caminho, c.ct, c.corpo, tok); st != c.quer {
			t.Errorf("PUT %.100s (%s, %d bytes) = %d, esperava %d", c.caminho, c.ct, len(c.corpo), st, c.quer)
		}
	}
	// nada foi parar fora do bucket: só os dois arquivos legítimos existem sob a raiz
	var achados []string
	filepath.WalkDir(arquivos, func(p string, d os.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			rel, _ := filepath.Rel(arquivos, p)
			achados = append(achados, rel)
		}
		return nil
	})
	want := []string{"avatars/foto.png", "vessel-curriculos/consultor-tivoli/ok.pdf"}
	slices.Sort(achados)
	if !slices.Equal(achados, want) {
		t.Errorf("arquivos no disco = %v, esperava só %v", achados, want)
	}
	if _, err := os.Stat(filepath.Join(filepath.Dir(arquivos), "CANARIO-RAIZ.txt")); err == nil {
		t.Error("um arquivo foi criado fora da raiz do Storage")
	}
}
