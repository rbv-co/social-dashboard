package acesso

import (
	"bytes"
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

const contaPedidos = `select count(*)::text from access_requests`

// pedidoPublico faz POST /pedir-acesso SEM sessão, a partir de `ip` (RemoteAddr).
func pedidoPublico(h http.Handler, ip, corpo string, cabecalhos ...string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", "/pedir-acesso", strings.NewReader(corpo))
	r.RemoteAddr = ip
	r.Header.Set("Content-Type", "application/json") // as telas mandam; os cabeçalhos do teste podem trocar
	for i := 0; i+1 < len(cabecalhos); i += 2 {
		r.Header.Set(cabecalhos[i], cabecalhos[i+1])
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func roteadorPublico(m *mundo) http.Handler {
	r := chi.NewRouter()
	MontarPublicas(r, m.p)
	return r
}

// desviaLog troca o slog padrão por um buffer durante o teste (nome e e-mail nunca vão para log).
func desviaLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(antes) })
	return &buf
}

func TestPedirAcessoPublico(t *testing.T) {
	logs := desviaLog(t)
	m := novoMundo(t)
	h := roteadorPublico(m)
	const ip = "203.0.113.9:1234"

	w := pedidoPublico(h, ip, `{"name":"Ana Teste","email":"ana@x.com","message":"oi"}`)
	if w.Code != 201 || !strings.HasPrefix(w.Body.String(), `{"id"`) {
		t.Fatalf("pedido válido = %d %s", w.Code, w.Body)
	}
	if strings.Contains(w.Body.String(), "ana@x.com") || strings.Contains(w.Body.String(), "Ana Teste") {
		t.Errorf("a resposta devolveu o que foi enviado: %s", w.Body)
	}
	if v := m.um(t, `select name||'|'||email||'|'||message||'|'||status from access_requests where name = 'Ana Teste'`); v != "Ana Teste|ana@x.com|oi|pending" {
		t.Fatalf("linha gravada = %q", v)
	}
	depois := m.um(t, contaPedidos)
	if depois != "2" {
		t.Fatalf("contagem depois do primeiro pedido = %s", depois)
	}

	longo := strings.Repeat("a", 121)
	recusados := []struct{ nome, corpo, codigo, frase string }{
		{"status no corpo (campo a mais)", `{"name":"Ana Teste","email":"ana@x.com","status":"approved"}`, "corpo_invalido", ""},
		{"nome vazio", `{"name":"  ","email":"ana@x.com"}`, "pedido_invalido", "Nome e email são obrigatórios."},
		{"e-mail que não é e-mail", `{"name":"Ana Teste","email":"não é e-mail"}`, "pedido_invalido", "Confira"},
		{"nome com 121 caracteres", `{"name":"` + longo + `","email":"ana@x.com"}`, "pedido_invalido", "Confira"},
		{"mensagem com 2001 caracteres", `{"name":"Ana Teste","email":"ana@x.com","message":"` + strings.Repeat("m", 2001) + `"}`, "pedido_invalido", "Confira"},
		{"e-mail com nome de exibição", `{"name":"Ana Teste","email":"Ana <ana@x.com>"}`, "pedido_invalido", "Confira"},
		{"dois e-mails", `{"name":"Ana Teste","email":"ana@x.com, bia@x.com"}`, "pedido_invalido", "Confira"},
		{"domínio sem ponto", `{"name":"Ana Teste","email":"ana@localhost"}`, "pedido_invalido", "Confira"},
		{"e-mail com 255 caracteres", `{"name":"Ana Teste","email":"` + strings.Repeat("a", 243) + `@example.com"}`, "pedido_invalido", "Confira"},
	}
	// o limitador conta TODO pedido do IP, recusado ou não: 1 válido + 9 recusados = os 10 da cota
	if len(recusados) != 9 {
		t.Fatalf("a lista de recusados tem de ter 9 (1 válido + 9 = 10 do IP), tem %d", len(recusados))
	}
	for _, c := range recusados {
		w := pedidoPublico(h, ip, c.corpo)
		if w.Code != 400 || !strings.Contains(w.Body.String(), `"error":"`+c.codigo+`"`) || !strings.Contains(w.Body.String(), c.frase) {
			t.Errorf("%s = %d %s; esperava 400 %s %q", c.nome, w.Code, w.Body, c.codigo, c.frase)
		}
		if strings.Contains(w.Body.String(), "ana@x.com") || strings.Contains(w.Body.String(), "Ana Teste") {
			t.Errorf("%s: a recusa devolveu o que foi enviado: %s", c.nome, w.Body)
		}
		if v := m.um(t, contaPedidos); v != depois {
			t.Fatalf("%s: a contagem mudou para %s", c.nome, v)
		}
	}

	// o 11º do mesmo IP, mesmo válido: 429 com Retry-After e nada gravado
	w = pedidoPublico(h, ip, `{"name":"Bia","email":"bia@x.com"}`)
	if w.Code != 429 || w.Header().Get("Retry-After") != "3600" {
		t.Errorf("11º pedido do IP = %d (Retry-After %q) %s", w.Code, w.Header().Get("Retry-After"), w.Body)
	}
	// X-Real-IP só vale vindo do proxy (IP privado): de um IP público não dá para trocar de balde
	w = pedidoPublico(h, ip, `{"name":"Bia","email":"bia@x.com"}`, "X-Real-IP", "198.51.100.99")
	if w.Code != 429 {
		t.Errorf("X-Real-IP forjado por IP público furou o limite: %d", w.Code)
	}
	if v := m.um(t, contaPedidos); v != depois {
		t.Errorf("o pedido limitado gravou: contagem %s", v)
	}
	// outro IP tem a sua cota
	w = pedidoPublico(h, "198.51.100.7:1234", `{"name":"Bia","email":"bia@x.com"}`)
	if w.Code != 201 {
		t.Errorf("outro IP = %d %s", w.Code, w.Body)
	}

	if s := logs.String(); strings.Contains(s, "ana@x.com") || strings.Contains(s, "Ana Teste") || strings.Contains(s, "bia@x.com") {
		t.Errorf("nome ou e-mail foram para o log:\n%s", s)
	}
}

// Rota anônima: um <form> de outro site usa o navegador (e o IP) do visitante, e só consegue
// mandar text/plain, multipart ou urlencoded sem preflight. Exigir application/json fecha isso
// (o limite por IP não pode ser queimado por terceiros). 415 antes de ler o corpo e sem gravar.
func TestPedirAcessoExigeJSON(t *testing.T) {
	m := novoMundo(t)
	h := roteadorPublico(m)
	const ip = "203.0.113.60:1"
	corpo := `{"name":"Form","email":"form@x.com"}`
	antes := m.um(t, contaPedidos)
	for _, ct := range []string{"text/plain", "text/plain;charset=UTF-8", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "", "application/jsonx", "application/json, text/plain"} {
		w := pedidoPublico(h, ip, corpo, "Content-Type", ct)
		if w.Code != 415 || !strings.Contains(w.Body.String(), `"error":"tipo_de_conteudo"`) {
			t.Errorf("Content-Type %q = %d %s; esperava 415 tipo_de_conteudo", ct, w.Code, w.Body)
		}
	}
	if v := m.um(t, contaPedidos); v != antes {
		t.Errorf("recusados por tipo gravaram: %s -> %s", antes, v)
	}
	for _, ct := range []string{"application/json", "application/json; charset=utf-8", "Application/JSON"} {
		if w := pedidoPublico(h, ip, corpo, "Content-Type", ct); w.Code != 201 {
			t.Errorf("Content-Type %q = %d %s; esperava 201", ct, w.Code, w.Body)
		}
	}
}

// O 415 vem ANTES dos limitadores: um <form> de outro site (text/plain) não gasta a cota por IP de quem é
// legítimo nem o teto global.
func TestPedirAcessoTipoErradoNaoGastaCota(t *testing.T) {
	m := novoMundo(t)
	h := roteadorPublico(m)
	const bom = `{"name":"Cota","email":"cota@x.com"}`
	const ip = "203.0.113.70:1"
	for i := 0; i < LimitePedirAcesso; i++ {
		if w := pedidoPublico(h, ip, bom, "Content-Type", "text/plain"); w.Code != 415 {
			t.Fatalf("text/plain %d = %d, esperava 415", i, w.Code)
		}
	}
	if w := pedidoPublico(h, ip, bom); w.Code != 201 {
		t.Errorf("JSON depois de %d text/plain do mesmo IP = %d %s; esperava 201 (o 415 gastou a cota por IP)", LimitePedirAcesso, w.Code, w.Body)
	}
	for i := 0; i < TetoGlobalPedirAcesso; i++ {
		if w := pedidoPublico(h, fmt.Sprintf("198.51.100.%d:1", i+1), bom, "Content-Type", "text/plain"); w.Code != 415 {
			t.Fatalf("text/plain de IP novo %d = %d, esperava 415", i, w.Code)
		}
	}
	if w := pedidoPublico(h, "192.0.2.70:1", bom); w.Code != 201 {
		t.Errorf("JSON depois de %d text/plain de IPs distintos = %d %s; esperava 201 (o 415 gastou o teto global)", TetoGlobalPedirAcesso, w.Code, w.Body)
	}
}

// Espaço invisível não é nome; espaços em volta do e-mail são aparados (e o que vai para o banco já
// vem aparado); `ana@[1.2.3.4]` (domínio literal) passa: é endereço válido do net/mail, o que
// importa é a rota não gravar lixo, e e-mail de pedido só é lido por um admin.
func TestPedirAcessoApara(t *testing.T) {
	m := novoMundo(t)
	h := roteadorPublico(m)
	const ip = "203.0.113.61:1"
	antes := m.um(t, contaPedidos)
	for _, nome := range []string{`\u200b`, `\u200b\u200b \u200b`, `\ufeff`, `\u00a0\u200d`} {
		w := pedidoPublico(h, ip, `{"name":"`+nome+`","email":"inv@x.com"}`)
		if w.Code != 400 || !strings.Contains(w.Body.String(), "Nome e email são obrigatórios.") {
			t.Errorf("nome %q = %d %s; esperava 400", nome, w.Code, w.Body)
		}
	}
	if v := m.um(t, contaPedidos); v != antes {
		t.Errorf("nome invisível gravou: %s -> %s", antes, v)
	}
	if w := pedidoPublico(h, ip, `{"name":"  Cris\u200b ","email":"  cris@x.com\t","message":" oi \n"}`); w.Code != 201 {
		t.Fatalf("e-mail com espaços em volta = %d %s", w.Code, w.Body)
	}
	if v := m.um(t, `select name||'|'||email||'|'||message from access_requests where email like 'cris%'`); v != "Cris\u200b|cris@x.com|oi" {
		t.Errorf("linha gravada = %q (esperava aparada)", v)
	}
	if w := pedidoPublico(h, ip, `{"name":"Literal","email":"ana@[1.2.3.4]"}`); w.Code != 201 {
		t.Errorf("domínio literal = %d (aceito, registrado como inofensivo)", w.Code)
	}
}

// Limites no cantinho certo (conta caracteres, não bytes), resposta uniforme com e-mail repetido
// (a rota pública não pode servir para descobrir quem já pediu), corpo grande e caractere que o
// Postgres não guarda.
func TestPedirAcessoPublicoBordasEUniformidade(t *testing.T) {
	logs := desviaLog(t)
	m := novoMundo(t)
	h := roteadorPublico(m)
	const ip = "203.0.113.50:1"

	// 120 caracteres de 2 bytes e 2000 de mensagem: passam
	w := pedidoPublico(h, ip, `{"name":"`+strings.Repeat("é", 120)+`","email":"borda@x.com","message":"`+strings.Repeat("ç", 2000)+`"}`)
	if w.Code != 201 {
		t.Errorf("120 caracteres de nome e 2000 de mensagem (multibyte) = %d %s", w.Code, w.Body)
	}
	// e-mail com 254 bytes: passa
	local := strings.Repeat("a", 64) + "." + strings.Repeat("b", 64) + "." + strings.Repeat("c", 64)
	email := local + "@" + strings.Repeat("d", 55) + ".com" // 194 + 1 + 59 = 254
	if len(email) != 254 {
		t.Fatalf("e-mail de teste tem %d", len(email))
	}
	w = pedidoPublico(h, ip, `{"name":"Limite","email":"`+email+`"}`)
	if w.Code != 201 {
		t.Errorf("e-mail com 254 = %d %s", w.Code, w.Body)
	}

	// e-mail repetido: o mesmo 201 {"id"} de sempre e nenhum 409. Em produção o índice único parcial (lower(email) com
	// status pending) barra a duplicada: a linha do mundo continua sendo a única
	a := pedidoPublico(h, ip, `{"name":"Rep","email":"fulana@x.com"}`) // é o e-mail do pedido1 do mundo
	b := pedidoPublico(h, ip, `{"name":"Rep","email":"fulana@x.com"}`)
	caixaAlta := pedidoPublico(h, ip, `{"name":"Rep","email":"FULANA@X.COM"}`) // outra caixa: o índice é lower(email)
	novo := pedidoPublico(h, ip, `{"name":"Rep","email":"nunca-vi@x.com"}`)
	for _, w := range []*httptest.ResponseRecorder{a, b, caixaAlta, novo} {
		if w.Code != 201 || !strings.HasPrefix(w.Body.String(), `{"id":"`) {
			t.Errorf("e-mail repetido ou novo = %d %s; a resposta tem de ser uniforme", w.Code, w.Body)
		}
	}
	if a.Body.String() == b.Body.String() {
		t.Error("dois pedidos devolveram o mesmo id")
	}
	if v := m.um(t, `select count(*)::text from access_requests where lower(email) = 'fulana@x.com'`); v != "1" {
		t.Errorf("linhas do e-mail repetido = %s, esperava 1 (a do mundo; as duas repetidas não gravam)", v)
	}

	antes := m.um(t, contaPedidos)
	const ip2 = "203.0.113.51:1" // a cota do primeiro IP (10) já foi usada acima
	// NUL: o Postgres recusa em texto; tem de virar 400, não 500
	if w := pedidoPublico(h, ip2, `{"name":"a\u0000b","email":"nul@x.com"}`); w.Code != 400 {
		t.Errorf("NUL no nome = %d %s", w.Code, w.Body)
	}
	// corpo acima do teto da rota: 413 antes de ler tudo
	if w := pedidoPublico(h, ip2, `{"name":"x","email":"x@x.com","message":"`+strings.Repeat("m", 100_000)+`"}`); w.Code != 413 {
		t.Errorf("corpo de 100 KB = %d, esperava 413", w.Code)
	}
	for _, corpo := range []string{``, `null`, `[]`, `{"name":1,"email":"a@x.com"}`, `{"name":"a","email":"a@x.com"} {}`} {
		if w := pedidoPublico(h, ip2, corpo); w.Code != 400 {
			t.Errorf("corpo %q = %d, esperava 400", corpo, w.Code)
		}
	}
	if v := m.um(t, contaPedidos); v != antes {
		t.Errorf("recusados gravaram: %s -> %s", antes, v)
	}
	if s := logs.String(); strings.Contains(s, "fulana@x.com") || strings.Contains(s, "Rep") || strings.Contains(s, "nul@x.com") {
		t.Errorf("dado pessoal no log:\n%s", s)
	}
}

// A rota pública não ganha sessão nem a cadeia autenticada: montá-la no grupo autenticado muda o
// contrato (a tela de login não tem sessão). E não existe outra rota pública no pacote.
func TestPedirAcessoNaoPedeSessaoEOutrosMetodosNaoExistem(t *testing.T) {
	m := novoMundo(t)
	h := roteadorPublico(m)
	for _, metodo := range []string{"GET", "PUT", "PATCH", "DELETE"} {
		r := httptest.NewRequest(metodo, "/pedir-acesso", nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 405 && w.Code != 404 {
			t.Errorf("%s /pedir-acesso = %d", metodo, w.Code)
		}
	}
	if w := pedidoPublico(h, "203.0.113.77:1", `{"name":"Sem sessão","email":"s@x.com"}`); w.Code != 201 {
		t.Errorf("sem sessão = %d %s", w.Code, w.Body)
	}
}

// Ruling 5.1-17: teto global de 100 por hora somando todos os IPs (aceitos e recusados), com o mesmo 429
// do limite por IP. Quem estoura o PRÓPRIO IP não gasta o teto dos outros (o por IP vem antes).
func TestPedirAcessoTetoGlobal(t *testing.T) {
	m := novoMundo(t)
	h := roteadorPublico(m)
	const bom, ruim = `{"name":"Teto","email":"teto@x.com"}`, `{"name":"","email":"teto@x.com"}`
	for i := 0; i < LimitePedirAcesso+5; i++ { // um IP: 10 passam (gastam 10 do teto), 5 levam 429 do IP (não gastam)
		w := pedidoPublico(h, "203.0.113.1:1", bom)
		if (i < LimitePedirAcesso) != (w.Code == 201) || (i >= LimitePedirAcesso && w.Code != 429) {
			t.Fatalf("pedido %d do IP fixo = %d", i, w.Code)
		}
	}
	for i := 0; i < TetoGlobalPedirAcesso-LimitePedirAcesso; i++ { // 90 IPs novos: metade aceita, metade recusada por validação (também contam)
		corpo, quer := bom, 201
		if i%2 == 1 {
			corpo, quer = ruim, 400
		}
		if w := pedidoPublico(h, fmt.Sprintf("198.51.100.%d:1", i+1), corpo); w.Code != quer {
			t.Fatalf("IP novo %d = %d %s, esperava %d (o teto global fechou cedo demais?)", i, w.Code, w.Body, quer)
		}
	}
	antes := m.um(t, contaPedidos)
	w := pedidoPublico(h, "192.0.2.1:1", bom) // o 101º do total, de um IP que nunca pediu
	if w.Code != 429 || w.Header().Get("Retry-After") != "3600" || !strings.Contains(w.Body.String(), `"muitas_requisicoes"`) {
		t.Errorf("pedido além do teto global = %d (Retry-After %q) %s", w.Code, w.Header().Get("Retry-After"), w.Body)
	}
	if w := pedidoPublico(h, "192.0.2.2:1", ruim); w.Code != 429 { // recusado por validação também fica atrás do teto
		t.Errorf("recusado além do teto = %d", w.Code)
	}
	if v := m.um(t, contaPedidos); v != antes {
		t.Errorf("o pedido além do teto gravou: %s -> %s", antes, v)
	}
}

func TestPedidosDoAdmin(t *testing.T) {
	m := novoMundo(t, montarPedidos)
	const pedido2 = "3b000000-0000-4000-a000-000000000002"
	if _, err := m.p.Exec(context.Background(), `insert into access_requests (id, name, email, message, status, created_at)
		values ($1::uuid, 'Beltrana', 'beltrana@x.com', '', 'pending', '2026-10-11T12:00:00Z')`, pedido2); err != nil {
		t.Fatal(err)
	}
	foto := m.um(t, fotoDoMundo)
	intacto := `select ((` + fotoDoMundo + `) = '` + foto + `')::text`
	statusDo := func(id string) string { return `select status from access_requests where id = '` + id + `'` }
	pedidoURL := "/acesso/pedidos/" + pedido1

	m.rodar(t, []caso{
		{nome: "sem sessão não lê", quem: "", metodo: "GET", caminho: "/acesso/pedidos", status: 401},
		{nome: "admin lê", quem: "admin", metodo: "GET", caminho: "/acesso/pedidos", status: 200, tem: `"email":"fulana@x.com"`},
		{nome: "admin com trava de loja também lê (a regra é o papel)", quem: "adminRestrito", metodo: "GET", caminho: "/acesso/pedidos", status: 200, tem: `"email":"beltrana@x.com"`},
		{nome: "entrar-como lê como o admin alvo", quem: "impersonado", metodo: "GET", caminho: "/acesso/pedidos", status: 200, tem: `"email":"fulana@x.com"`},
		{nome: "viewer não lê", quem: "viewer", metodo: "GET", caminho: "/acesso/pedidos", status: 200, tem: "[]", naoTem: "@x.com"},
		{nome: "super pela ficha com papel viewer não lê (paridade, Ruling 5.1-3)", quem: "superFicha", metodo: "GET", caminho: "/acesso/pedidos", status: 200, tem: "[]", naoTem: "@x.com"},
		{nome: "super só por e-mail com papel viewer não lê", quem: "superSoPorEmail", metodo: "GET", caminho: "/acesso/pedidos", status: 200, tem: "[]", naoTem: "@x.com"},
		{nome: "sessão sem perfil não lê", quem: "semPerfil", metodo: "GET", caminho: "/acesso/pedidos", status: 200, tem: "[]", naoTem: "@x.com"},
		{nome: "filtro que não existe", quem: "admin", metodo: "GET", caminho: "/acesso/pedidos?status=pending", status: 400},

		// IDOR e portões do PATCH: nada muda
		{nome: "viewer não decide (404, não revela a linha)", quem: "viewer", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":"approved"}`, status: 404, naoTem: "fulana", efeito: intacto, quer: "true"},
		{nome: "super pela ficha com papel viewer não decide", quem: "superFicha", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":"approved"}`, status: 404, efeito: intacto, quer: "true"},
		{nome: "sessão sem perfil não decide", quem: "semPerfil", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":"approved"}`, status: 404, efeito: intacto, quer: "true"},
		{nome: "sem sessão não decide", quem: "", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":"approved"}`, status: 401, efeito: intacto, quer: "true"},
		{nome: "entrar-como não decide", quem: "impersonado", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":"approved"}`, status: 403, tem: "Quem entrou como outra pessoa", efeito: intacto, quer: "true"},
		{nome: "status fora da lista", quem: "admin", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":"hacked"}`, status: 400, efeito: intacto, quer: "true"},
		{nome: "status vazio", quem: "admin", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":""}`, status: 400, efeito: intacto, quer: "true"},
		{nome: "status nulo", quem: "admin", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":null}`, status: 400, efeito: intacto, quer: "true"},
		{nome: "status que não é texto", quem: "admin", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":1}`, status: 400, efeito: intacto, quer: "true"},
		{nome: "sem status", quem: "admin", metodo: "PATCH", caminho: pedidoURL, corpo: `{}`, status: 400, efeito: intacto, quer: "true"},
		{nome: "outra coluna: nome", quem: "admin", metodo: "PATCH", caminho: pedidoURL, corpo: `{"name":"x"}`, status: 400, efeito: intacto, quer: "true"},
		{nome: "status válido com outra coluna junto", quem: "admin", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":"approved","email":"x@x.com"}`, status: 400, efeito: intacto, quer: "true"},
		{nome: "id no corpo", quem: "admin", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":"approved","id":"` + pedido2 + `"}`, status: 400, efeito: intacto, quer: "true"},
		{nome: "pedido que não existe", quem: "admin", metodo: "PATCH", caminho: "/acesso/pedidos/3b000000-0000-4000-a000-0000000000ee", corpo: `{"status":"approved"}`, status: 404, efeito: intacto, quer: "true"},
		{nome: "id que não é uuid", quem: "admin", metodo: "PATCH", caminho: "/acesso/pedidos/x", corpo: `{"status":"approved"}`, status: 404, efeito: intacto, quer: "true"},

		// o que vale: só o pedido do id muda, só o status
		{nome: "admin aprova", quem: "admin", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":"approved"}`, status: 200, tem: `"status":"approved"`, efeito: statusDo(pedido1), quer: "approved"},
		{nome: "o outro pedido não mudou", efeito: statusDo(pedido2), quer: "pending"},
		{nome: "nada além do status mudou", efeito: `select (name||email||message)||created_at::text from access_requests where id = '` + pedido1 + `'`, quer: "Fulanafulana@x.comquero entrar2026-10-10 12:00:00+00"},
		{nome: "admin nega", quem: "adminRestrito", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":"denied"}`, status: 200, tem: `"status":"denied"`, efeito: statusDo(pedido1), quer: "denied"},
		{nome: "admin volta a pendente", quem: "admin", metodo: "PATCH", caminho: pedidoURL, corpo: `{"status":"pending"}`, status: 200, efeito: statusDo(pedido1), quer: "pending"},
	})

	// padrão created_at desc: o pedido2 (11/10) antes do pedido1 (10/10)
	_, corpo := m.pedir(t, "admin", "GET", "/acesso/pedidos", "")
	if i, j := strings.Index(corpo, pedido2), strings.Index(corpo, pedido1); i < 0 || j < 0 || i > j {
		t.Errorf("a ordem não é created_at desc: %s", corpo)
	}
	// as colunas são as da tela e só elas
	for _, c := range []string{`"id"`, `"name"`, `"email"`, `"message"`, `"status"`, `"created_at"`} {
		if !strings.Contains(corpo, c) {
			t.Errorf("falta a coluna %s: %s", c, corpo)
		}
	}
}
