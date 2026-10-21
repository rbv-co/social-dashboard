package mcp_test

// O MCP da Central pela montagem REAL (web.Rotas): o OAuth de ponta a ponta, as portas que ele não pode abrir e as
// ferramentas contra o esquema de produção (gatilhos e catálogo de autorização de verdade).

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/web"
)

const (
	emissor   = "https://central.test/api"
	front     = "https://central.test"
	retorno   = "https://chatgpt.com/connector_platform_oauth_redirect"
	idGestor  = "e1000000-0000-4000-a000-000000000001" // frota: ver, criar, editar, excluir
	idMotor   = "e1000000-0000-4000-a000-000000000002" // frota: ver, editar (dirige, não administra)
	idSuper   = "e1000000-0000-4000-a000-000000000003" // super pela ficha (para o "entrar como")
	idCliente = "e1000000-0000-4000-a000-000000000004" // cliente da Vessel: sessão sem profile
	veiculoV1 = "e1d00000-0000-4000-a000-000000000001"
	reqR1     = "e1f00000-0000-4000-a000-000000000001" // pendente, pedida pelo motorista
	verif     = "verificador-do-pkce-com-mais-de-quarenta-e-tres-caracteres-0123456789"
)

type mundo struct {
	h   http.Handler
	tok map[string]string // sessões de PAINEL
	q   func(t *testing.T, sql string) string
}

func novoMundo(t *testing.T) *mundo {
	t.Helper()
	p := testebanco.ComEsquemaDeProducao(t)
	ctx := context.Background()
	s := auth.NovoStore(p)
	m := &mundo{tok: map[string]string{}}
	for _, x := range []struct{ chave, id, perm string }{
		{"gestor", idGestor, `{"frota":["ver","criar","editar","excluir"],"frota.aprovar":["ver"]}`},
		{"motorista", idMotor, `{"frota":["ver","editar"]}`},
		{"super", idSuper, `{}`},
	} {
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2)`, x.id, x.chave+"@x.com"); err != nil {
			t.Fatal(err)
		}
		features := `{frota}`
		if x.chave == "gestor" {
			features = `{frota,frota.aprovar}`
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, is_superadmin, permissions, features)
			values ($1::uuid, $2, $3, 'viewer', $4, $5::jsonb, $6::text[])`, x.id, x.chave+"@x.com", x.chave,
			x.chave == "super", x.perm, features); err != nil {
			t.Fatal(err)
		}
		tok, err := s.Criar(ctx, x.id, "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		m.tok[x.chave] = tok
	}
	por := idSuper
	imp, err := s.Criar(ctx, idGestor, "painel", &por)
	if err != nil {
		t.Fatal(err)
	}
	m.tok["impersonado"] = imp
	if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'cliente@x.com')`, idCliente); err != nil {
		t.Fatal(err)
	}
	if m.tok["cliente"], err = s.Criar(ctx, idCliente, "cliente", nil); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `
		insert into frota_veiculos (id, placa, nome) values ('`+veiculoV1+`', 'AAA1A11', 'Gol');
		insert into frota_uso (veiculo_id, pessoa_nome, tipo, saida_em, volta_em, km_saida, km_volta)
		  values ('`+veiculoV1+`', 'Fulano', 'viagem', '2026-10-02T08:00:00Z', '2026-10-02T12:00:00Z', 1000, 1500);
		insert into frota_requisicoes (id, veiculo_id, retirada_prevista, situacao, criada_por)
		  values ('`+reqR1+`', '`+veiculoV1+`', '2026-10-25T12:00:00Z', 'pendente', '`+idMotor+`');`); err != nil {
		t.Fatal(err)
	}
	m.h = web.Rotas(p, s, auth.NovoLimitador(), config.Config{APIURLPublica: emissor, EnderecoPadrao: front})
	m.q = func(t *testing.T, sql string) string {
		var v string
		if err := p.QueryRow(ctx, sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	return m
}

func (m *mundo) pedir(t *testing.T, metodo, caminho, tok, tipo, corpo string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
	if tok != "" {
		r.Header.Set("Authorization", "Bearer "+tok)
	}
	if tipo != "" {
		r.Header.Set("Content-Type", tipo)
	}
	w := httptest.NewRecorder()
	m.h.ServeHTTP(w, r)
	return w
}

func campo(t *testing.T, corpo []byte, nome string) string {
	t.Helper()
	var v map[string]any
	if err := json.Unmarshal(corpo, &v); err != nil {
		t.Fatalf("corpo não é JSON: %s", corpo)
	}
	s, _ := v[nome].(string)
	return s
}

func desafio() string {
	h := sha256.Sum256([]byte(verif))
	return base64.RawURLEncoding.EncodeToString(h[:])
}

func (m *mundo) registrar(t *testing.T) string {
	t.Helper()
	w := m.pedir(t, "POST", "/oauth/registrar", "", "application/json",
		`{"client_name":"ChatGPT","redirect_uris":["`+retorno+`"],"token_endpoint_auth_method":"none"}`)
	if w.Code != http.StatusCreated {
		t.Fatalf("registrar: %d %s", w.Code, w.Body)
	}
	return campo(t, w.Body.Bytes(), "client_id")
}

func pedidoDe(cliente string) url.Values {
	return url.Values{"client_id": {cliente}, "redirect_uri": {retorno}, "response_type": {"code"},
		"code_challenge": {desafio()}, "code_challenge_method": {"S256"}, "state": {"st-1"}, "scope": {"frota"}}
}

// consentir faz o "Permitir" como `quem` e devolve o código.
func (m *mundo) consentir(t *testing.T, quem, cliente string) (int, string) {
	t.Helper()
	q := pedidoDe(cliente)
	corpo, _ := json.Marshal(map[string]any{"client_id": cliente, "redirect_uri": retorno, "response_type": "code",
		"code_challenge": q.Get("code_challenge"), "code_challenge_method": "S256", "state": "st-1", "scope": "frota", "permitir": true})
	w := m.pedir(t, "POST", "/oauth/decidir", m.tok[quem], "application/json", string(corpo))
	if w.Code != http.StatusOK {
		return w.Code, w.Body.String()
	}
	u, err := url.Parse(campo(t, w.Body.Bytes(), "redirect"))
	if err != nil || !strings.HasPrefix(u.String(), retorno+"?") || u.Query().Get("state") != "st-1" || u.Query().Get("iss") != emissor {
		t.Fatalf("redirect de volta errado: %s", w.Body)
	}
	return w.Code, u.Query().Get("code")
}

func (m *mundo) token(t *testing.T, form url.Values) *httptest.ResponseRecorder {
	t.Helper()
	return m.pedir(t, "POST", "/oauth/token", "", "application/x-www-form-urlencoded", form.Encode())
}

func (m *mundo) trocar(t *testing.T, cliente, codigo, verificador string) *httptest.ResponseRecorder {
	return m.token(t, url.Values{"grant_type": {"authorization_code"}, "code": {codigo}, "client_id": {cliente},
		"redirect_uri": {retorno}, "code_verifier": {verificador}})
}

// acesso: o fluxo inteiro como gestor; devolve cliente, token de acesso e refresh.
func (m *mundo) acesso(t *testing.T) (string, string, string) {
	t.Helper()
	return m.acessoDe(t, "gestor")
}

func (m *mundo) acessoDe(t *testing.T, quem string) (string, string, string) {
	t.Helper()
	cliente := m.registrar(t)
	st, codigo := m.consentir(t, quem, cliente)
	if st != http.StatusOK {
		t.Fatalf("consentir: %d %s", st, codigo)
	}
	w := m.trocar(t, cliente, codigo, verif)
	if w.Code != http.StatusOK {
		t.Fatalf("token: %d %s", w.Code, w.Body)
	}
	return cliente, campo(t, w.Body.Bytes(), "access_token"), campo(t, w.Body.Bytes(), "refresh_token")
}

func (m *mundo) rpc(t *testing.T, tok, metodo, params string) (int, map[string]any) {
	t.Helper()
	w := m.pedir(t, "POST", "/mcp", tok, "application/json", `{"jsonrpc":"2.0","id":1,"method":"`+metodo+`","params":`+params+`}`)
	var v map[string]any
	json.Unmarshal(w.Body.Bytes(), &v)
	return w.Code, v
}

// ferramenta chama tools/call e devolve o texto e o isError.
func (m *mundo) ferramenta(t *testing.T, tok, nome, args string) (string, bool) {
	t.Helper()
	st, v := m.rpc(t, tok, "tools/call", `{"name":"`+nome+`","arguments":`+args+`}`)
	res, ok := v["result"].(map[string]any)
	if st != http.StatusOK || !ok {
		t.Fatalf("%s: %d %v", nome, st, v)
	}
	texto := res["content"].([]any)[0].(map[string]any)["text"].(string)
	return texto, res["isError"].(bool)
}

func TestFluxoOAuthDePontaAPonta(t *testing.T) {
	m := novoMundo(t)

	// metadados apontam um para o outro
	w := m.pedir(t, "GET", "/.well-known/oauth-protected-resource/mcp", "", "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"resource":"`+emissor+`/mcp"`) {
		t.Fatalf("recurso: %d %s", w.Code, w.Body)
	}
	w = m.pedir(t, "GET", "/.well-known/oauth-authorization-server", "", "", "")
	if w.Code != 200 || campo(t, w.Body.Bytes(), "issuer") != emissor {
		t.Fatalf("servidor: %d %s", w.Code, w.Body)
	}

	// sem token: 401 com o caminho para o OAuth
	w = m.pedir(t, "POST", "/mcp", "", "application/json", `{"jsonrpc":"2.0","id":1,"method":"ping"}`)
	if w.Code != 401 || !strings.Contains(w.Header().Get("WWW-Authenticate"), `resource_metadata="`+emissor+`/.well-known/oauth-protected-resource/mcp"`) {
		t.Fatalf("sem token: %d %q", w.Code, w.Header().Get("WWW-Authenticate"))
	}

	cliente := m.registrar(t)
	// autorizar manda à tela de consentimento com o mesmo pedido
	w = m.pedir(t, "GET", "/oauth/autorizar?"+pedidoDe(cliente).Encode(), "", "", "")
	if w.Code != http.StatusFound || !strings.HasPrefix(w.Header().Get("Location"), front+"/oauth/consentimento?") {
		t.Fatalf("autorizar: %d %q", w.Code, w.Header().Get("Location"))
	}
	// a tela pergunta antes de mostrar os botões
	w = m.pedir(t, "GET", "/oauth/pedido?"+pedidoDe(cliente).Encode(), m.tok["gestor"], "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"pode":true`) || campo(t, w.Body.Bytes(), "cliente") != "ChatGPT" {
		t.Fatalf("pedido do gestor: %d %s", w.Code, w.Body)
	}
	// qualquer conta do painel liga (o que ela alcança é o que a permissão dela alcança); cliente da Vessel não
	w = m.pedir(t, "GET", "/oauth/pedido?"+pedidoDe(cliente).Encode(), m.tok["motorista"], "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"pode":true`) {
		t.Fatalf("pedido do motorista: %d %s", w.Code, w.Body)
	}
	w = m.pedir(t, "GET", "/oauth/pedido?"+pedidoDe(cliente).Encode(), m.tok["cliente"], "", "")
	if w.Code != http.StatusForbidden { // o grupo do painel já barra; SoPainel é a segunda tranca
		t.Fatalf("pedido do cliente: %d %s", w.Code, w.Body)
	}
	w = m.pedir(t, "GET", "/oauth/pedido?"+pedidoDe(cliente).Encode(), m.tok["impersonado"], "", "")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"pode":false`) {
		t.Fatalf("pedido no entrar como: %d %s", w.Code, w.Body)
	}

	_, codigo := m.consentir(t, "gestor", cliente)
	if w := m.trocar(t, cliente, codigo, verif+"x"); w.Code != 400 {
		t.Fatalf("verificador errado deveria ser 400: %d %s", w.Code, w.Body)
	}
	// o código foi gasto pela tentativa errada: vale UMA vez, certo ou errado
	if w := m.trocar(t, cliente, codigo, verif); w.Code != 400 {
		t.Fatalf("código reusado deveria ser 400: %d", w.Code)
	}

	cliente, acesso, refresh := m.acesso(t)
	if st, v := m.rpc(t, acesso, "initialize", `{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"t","version":"1"}}`); st != 200 ||
		v["result"].(map[string]any)["protocolVersion"] != "2025-06-18" {
		t.Fatalf("initialize: %d %v", st, v)
	}
	if w := m.pedir(t, "POST", "/mcp", acesso, "application/json", `{"jsonrpc":"2.0","method":"notifications/initialized"}`); w.Code != http.StatusAccepted {
		t.Fatalf("notificação: %d", w.Code)
	}
	if _, v := m.rpc(t, acesso, "tools/list", `{}`); len(v["result"].(map[string]any)["tools"].([]any)) != 20 {
		t.Fatalf("tools/list: %v", v)
	}

	// refresh rotativo: o acesso velho cai, o novo vale
	w = m.token(t, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {cliente}})
	if w.Code != 200 {
		t.Fatalf("refresh: %d %s", w.Code, w.Body)
	}
	acesso2 := campo(t, w.Body.Bytes(), "access_token")
	if st, _ := m.rpc(t, acesso, "ping", `{}`); st != 401 {
		t.Fatalf("acesso velho depois do refresh deveria ser 401: %d", st)
	}
	if st, _ := m.rpc(t, acesso2, "ping", `{}`); st != 200 {
		t.Fatalf("acesso novo: %d", st)
	}
	// refresh velho de volta = vazou: a família inteira cai
	if w := m.token(t, url.Values{"grant_type": {"refresh_token"}, "refresh_token": {refresh}, "client_id": {cliente}}); w.Code != 400 {
		t.Fatalf("refresh reusado: %d", w.Code)
	}
	if st, _ := m.rpc(t, acesso2, "ping", `{}`); st != 401 {
		t.Fatalf("depois do reuso o acesso da família deveria cair: %d", st)
	}
}

func TestPortasQueOMCPNaoAbre(t *testing.T) {
	m := novoMundo(t)

	// host de retorno fora da lista: sem cliente (o nome é livre, o destino do código não)
	if w := m.pedir(t, "POST", "/oauth/registrar", "", "application/json",
		`{"client_name":"ChatGPT","redirect_uris":["https://chatgpt.com.evil.io/cb"]}`); w.Code != 400 {
		t.Fatalf("host estranho deveria ser 400: %d", w.Code)
	}
	cliente := m.registrar(t)
	// redirect_uri não registrada: erro na página, sem redirecionar
	q := pedidoDe(cliente)
	q.Set("redirect_uri", "https://chatgpt.com/outro")
	if w := m.pedir(t, "GET", "/oauth/autorizar?"+q.Encode(), "", "", ""); w.Code != 400 || w.Header().Get("Location") != "" {
		t.Fatalf("redirect_uri estranha: %d %q", w.Code, w.Header().Get("Location"))
	}
	// sem PKCE: volta ao cliente como invalid_request
	q = pedidoDe(cliente)
	q.Del("code_challenge")
	if w := m.pedir(t, "GET", "/oauth/autorizar?"+q.Encode(), "", "", ""); w.Code != 302 ||
		!strings.Contains(w.Header().Get("Location"), "error=invalid_request") {
		t.Fatalf("sem PKCE: %d %q", w.Code, w.Header().Get("Location"))
	}
	// cliente da Vessel e "entrar como" não consentem; decidir sem sessão = 401
	for _, quem := range []string{"cliente", "impersonado"} {
		if st, _ := m.consentir(t, quem, cliente); st != http.StatusForbidden {
			t.Fatalf("%s consentindo deveria ser 403: %d", quem, st)
		}
	}
	if w := m.pedir(t, "POST", "/oauth/decidir", "", "application/json", `{}`); w.Code != 401 {
		t.Fatalf("decidir sem sessão: %d", w.Code)
	}

	_, acesso, _ := m.acesso(t)
	// token do ChatGPT não abre a API do painel
	if w := m.pedir(t, "GET", "/frota/veiculos", acesso, "", ""); w.Code != http.StatusForbidden {
		t.Fatalf("token mcp no painel deveria ser 403: %d", w.Code)
	}
	// sessão do painel não abre o MCP
	if st, _ := m.rpc(t, m.tok["gestor"], "ping", `{}`); st != 401 {
		t.Fatalf("sessão de painel no /mcp deveria ser 401: %d", st)
	}
	// permissão tirada depois do consentimento vale na hora: cada rota confere a dela a cada chamada
	if txt, _ := m.ferramenta(t, acesso, "listar_veiculos", `{}`); !strings.Contains(txt, "AAA1A11") {
		t.Fatalf("antes de tirar a permissão: %s", txt)
	}
	m.q(t, `update profiles set permissions = '{}', features = '{}' where id = '`+idGestor+`' returning 'ok'`)
	if txt, _ := m.ferramenta(t, acesso, "listar_veiculos", `{}`); strings.Contains(txt, "AAA1A11") {
		t.Fatalf("sem permissão ainda vê a frota: %s", txt)
	}
}

func TestFerramentas(t *testing.T) {
	m := novoMundo(t)
	_, acesso, _ := m.acesso(t)

	if txt, erro := m.ferramenta(t, acesso, "listar_veiculos", `{}`); erro || !strings.Contains(txt, "AAA1A11") {
		t.Fatalf("listar_veiculos: %v %s", erro, txt)
	}
	if txt, erro := m.ferramenta(t, acesso, "listar_requisicoes", `{"veiculo_id":"`+veiculoV1+`","situacao":"pendente"}`); erro || !strings.Contains(txt, reqR1) {
		t.Fatalf("listar_requisicoes: %v %s", erro, txt)
	}

	// abastecimento: KM abaixo do conhecido (1500, da devolução) é barrado e nada grava
	abast := func(km string) string {
		return `{"veiculo_id":"` + veiculoV1 + `","km":` + km + `,"litros":40,"total_reais":250.5,"tanque_depois":4,"combustivel":"gasolina"}`
	}
	if txt, erro := m.ferramenta(t, acesso, "registrar_abastecimento", abast("1400")); !erro || !strings.Contains(txt, "1500") {
		t.Fatalf("km menor deveria barrar: %v %s", erro, txt)
	}
	if n := m.q(t, `select count(*)::text from frota_abastecimentos`); n != "0" {
		t.Fatalf("barrado gravou: %s", n)
	}
	if txt, erro := m.ferramenta(t, acesso, "registrar_abastecimento", abast("1600")); erro {
		t.Fatalf("abastecimento: %s", txt)
	}
	if v := m.q(t, `select total_centavos || '/' || criado_por from frota_abastecimentos`); v != "25050/"+idGestor {
		t.Fatalf("gravou errado: %s", v)
	}
	// preço por litro absurdo avisa, não barra (D39)
	if txt, erro := m.ferramenta(t, acesso, "registrar_abastecimento",
		`{"veiculo_id":"`+veiculoV1+`","km":1700,"litros":40,"total_reais":2500,"tanque_depois":4,"combustivel":"gasolina"}`); erro || !strings.Contains(txt, "Aviso") {
		t.Fatalf("preço absurdo: %v %s", erro, txt)
	}

	// editar_veiculo: placa não passa; local passa
	if txt, erro := m.ferramenta(t, acesso, "editar_veiculo", `{"id":"`+veiculoV1+`","placa":"ZZZ9Z99"}`); !erro || !strings.Contains(txt, "placa") {
		t.Fatalf("placa deveria ser recusada: %v %s", erro, txt)
	}
	if txt, erro := m.ferramenta(t, acesso, "editar_veiculo", `{"id":"`+veiculoV1+`","local_texto":"Garagem 2"}`); erro ||
		m.q(t, `select coalesce(local_texto, '<nulo>') from frota_veiculos`) != "Garagem 2" {
		t.Fatalf("editar_veiculo não gravou o local: %v %s", erro, txt)
	}

	// decidir: recusar sem motivo não chega ao banco; aprovar grava quem decidiu
	if _, erro := m.ferramenta(t, acesso, "decidir_requisicao", `{"id":"`+reqR1+`","decisao":"recusada"}`); !erro {
		t.Fatal("recusa sem motivo deveria ser recusada")
	}
	if txt, erro := m.ferramenta(t, acesso, "decidir_requisicao", `{"id":"`+reqR1+`","decisao":"aprovada"}`); erro {
		t.Fatalf("aprovar: %s", txt)
	}
	if v := m.q(t, `select situacao || '/' || decidida_por from frota_requisicoes where id = '`+reqR1+`'`); v != "aprovada/"+idGestor {
		t.Fatalf("decisão: %s", v)
	}

	// manutenção com troca vira revisão
	if txt, erro := m.ferramenta(t, acesso, "lancar_manutencao",
		`{"veiculo_id":"`+veiculoV1+`","km":1800,"total_reais":300,"trocas":[{"item":"Troca de óleo","custo_reais":300}]}`); erro {
		t.Fatalf("manutenção: %s", txt)
	}
	if v := m.q(t, `select item || '/' || custo_centavos || '/' || km from frota_revisoes`); v != "Troca de óleo/30000/1800" {
		t.Fatalf("revisão: %s", v)
	}

	// revisão: nome casado com o plano (o alerta compara o nome exato), repetido e KM para trás barram, avisos da tela
	m.q(t, `with x as (insert into frota_plano_revisao (item, a_cada_km) values ('Filtro de ar', 10000) returning 1) select 'ok'`)
	revisao := func(km, extra, trocas string) (string, bool) {
		return m.ferramenta(t, acesso, "lancar_manutencao", `{"veiculo_id":"`+veiculoV1+`","km":`+km+extra+`,"trocas":`+trocas+`}`)
	}
	antes := m.q(t, `select count(*)::text from frota_revisoes`)
	for _, c := range []struct{ km, extra, trocas, contem string }{
		{"1900", ``, `[{"item":"filtro de ar"},{"item":"FILTRO  DE AR"}]`, "duas vezes"},
		{"1700", ``, `[{"item":"filtro de ar"}]`, "km_confirmado=true"},
		{"900000", ``, `[{"item":"filtro de ar"}]`, "salto"},
		{"0", ``, `[{"item":"filtro de ar"}]`, "Informe o KM"},
		{"1900", ``, `[{"item":" "}]`, "nome do item"},
	} {
		if txt, erro := revisao(c.km, c.extra, c.trocas); !erro || !strings.Contains(txt, c.contem) {
			t.Fatalf("km %s %s: erro=%v %s", c.km, c.trocas, erro, txt)
		}
	}
	if n := m.q(t, `select count(*)::text from frota_revisoes`); n != antes {
		t.Fatalf("recusa gravou revisão: %s → %s", antes, n)
	}
	txt, erro := revisao("1700", `,"km_confirmado":true,"total_reais":150`, `[{"item":"filtro de ar","custo_reais":80},{"item":"Palheta"}]`)
	if erro || !strings.Contains(txt, "fora do plano de revisão, não entram no alerta de troca: Palheta") ||
		!strings.Contains(txt, "somam R$ 80.00 e o total informado é R$ 150.00") {
		t.Fatalf("revisão confirmada: erro=%v %s", erro, txt)
	}
	if v := m.q(t, `select string_agg(item || '/' || km, ',' order by item) from frota_revisoes where km = 1700`); v != "Filtro de ar/1700,Palheta/1700" {
		t.Fatalf("revisões gravadas: %s", v)
	}

	// argumento desconhecido e ferramenta desconhecida
	if _, erro := m.ferramenta(t, acesso, "listar_usos", `{"sql":"drop"}`); !erro {
		t.Fatal("argumento desconhecido deveria ser erro")
	}
	if _, v := m.rpc(t, acesso, "tools/call", `{"name":"apagar_tudo","arguments":{}}`); v["error"] == nil {
		t.Fatalf("ferramenta desconhecida: %v", v)
	}
}
