package acessos

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
	"github.com/rbv-co/social-dashboard/api/internal/zoho"
)

// zohoDeMentira: um Zoho (contas, Mail, Contacts e WorkDrive) em httptest. `chamadas` guarda "MÉTODO caminho?query corpo".
type zohoDeMentira struct {
	mu       sync.Mutex
	chamadas []string
	usuarios int // quantos usuários a listagem tem (paginada de 50 em 50)
	quebra   map[string]int
}

func (z *zohoDeMentira) foram(prefixo string) []string {
	z.mu.Lock()
	defer z.mu.Unlock()
	var o []string
	for _, c := range z.chamadas {
		if strings.HasPrefix(c, prefixo) {
			o = append(o, c)
		}
	}
	return o
}

func (z *zohoDeMentira) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	b, _ := io.ReadAll(r.Body)
	z.mu.Lock()
	z.chamadas = append(z.chamadas, r.Method+" "+r.URL.RequestURI()+" "+string(b))
	z.mu.Unlock()
	if st := z.quebra[r.Method+" "+r.URL.Path]; st != 0 {
		w.WriteHeader(st)
		w.Write([]byte(`{"errors":[{"id":"X","title":"quebrou"}]}`))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	switch p := r.URL.Path; {
	case p == "/oauth/v2/token":
		w.Write([]byte(`{"access_token":"tok-zoho"}`))
	case p == "/mail/api/organization/accounts" && r.Method == http.MethodGet:
		var ini int
		fmt.Sscan(r.URL.Query().Get("start"), &ini)
		var us []string
		for i := ini; i < ini+50 && i < z.usuarios; i++ {
			us = append(us, fmt.Sprintf(`{"accountId":%d,"zuid":%d,"displayName":"Pessoa %d","primaryEmailAddress":"p%d@rbv.com"}`, 1000+i, 9000+i, i, i))
		}
		fmt.Fprintf(w, `{"data":[%s]}`, strings.Join(us, ","))
	case strings.HasPrefix(p, "/mail/api/organization/accounts/") && r.Method == http.MethodPut:
		w.Write([]byte(`{"status":{"code":200}}`))
	case p == "/mail/api/organization/accounts" && r.Method == http.MethodPost:
		w.Write([]byte(`{"status":{"code":201,"description":"Created"},"data":{"accountId":777,"zuid":888}}`))
	case p == "/contacts/file":
		if r.URL.Query().Get("ID") == "9001" { // só o 2º usuário tem foto
			w.Header().Set("Content-Type", "image/png")
			w.Write([]byte("\x89PNG\r\n\x1a\nfoto"))
			return
		}
		w.Header().Set("Content-Type", "text/html")
		w.WriteHeader(404)
	case p == "/workdrive/api/v1/users/me":
		w.Write([]byte(`{"data":{"attributes":{"last_viewed_org_info":{"org_id":"org9"}}}}`))
	case p == "/workdrive/api/v1/teams/org9/teamfolders":
		w.Write([]byte(`{"data":[{"id":"tf1","type":"teamfolders","attributes":{"name":"Cliente A"}},{"id":"tf2","type":"teamfolders","attributes":{"name":"Cliente B","status":"51"}}]}`))
	case p == "/workdrive/api/v1/teamfolders/tf1/folders":
		w.Write([]byte(`{"data":[{"id":"wd-1","type":"files","attributes":{"is_folder":true,"name":"Contratos"}},{"id":"f9","type":"files","attributes":{"is_folder":false,"name":"arquivo.pdf"}},{"id":"wd-2","type":"files","attributes":{"is_folder":true,"name":"Notas"}}]}`))
	case strings.HasSuffix(p, "/permissions") && r.Method == http.MethodGet:
		w.Write([]byte(`{"data":[{"id":"pm1","attributes":{"type":"user","shared_by":"Ana","email_id":"ANA@rbv.com","share_to_entity_info":{"display_name":"Ana Lima","email_id":"ANA@rbv.com"},"expiry_in_millis":12}},{"id":"pm2","attributes":{"type":"everyone"}}]}`))
	case strings.HasSuffix(p, "/links") && r.Method == http.MethodGet:
		w.Write([]byte(`{"data":[{"id":"lk1","attributes":{"link":"https://wd/l1","link_name":"L","allow_download":true,"is_password_protected":false,"expiration_date":""}}]}`))
	case p == "/workdrive/api/v1/links" && r.Method == http.MethodPost:
		w.Write([]byte(`{"data":{"id":"lk2","attributes":{"link":"https://wd/l2"}}}`))
	case p == "/workdrive/api/v1/permissions" && r.Method == http.MethodPost:
		w.WriteHeader(201)
		w.Write([]byte(`{"data":{"id":"pm9"}}`))
	case r.Method == http.MethodDelete:
		w.WriteHeader(204)
	default:
		w.WriteHeader(404)
	}
}

type fotosDeTeste struct {
	mu     sync.Mutex
	feitas map[string]string
}

func (f *fotosDeTeste) Gravar(_ context.Context, caminho, tipo string, corpo []byte) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.feitas[caminho] = tipo + ":" + string(corpo[:4])
	return "https://api.test/storage/v1/object/public/acessos-avatars/" + caminho, nil
}

func mundoComZoho(t *testing.T, z *zohoDeMentira, fotos Fotos) *mundoteste.Mundo {
	t.Helper()
	srv := httptest.NewServer(z)
	t.Cleanup(srv.Close)
	return novoMundo(t, func(r chi.Router, p *pgxpool.Pool) {
		r.Post("/acessos-proxy", (&Proxy{Pool: p, Zoho: zoho.ParaTeste(t, p, srv.URL), Fotos: fotos, APIPublica: "https://api.test"}).ServeHTTP)
	})
}

func proxy(t *testing.T, m *mundoteste.Mundo, quem string, corpo string) (int, map[string]any) {
	t.Helper()
	st, b := m.Pedir(t, quem, "POST", "/acessos-proxy", corpo)
	var j map[string]any
	if err := json.Unmarshal([]byte(b), &j); err != nil {
		t.Fatalf("resposta não é objeto JSON (%d): %s", st, b)
	}
	return st, j
}

func TestProxyZohoPortaoEImpersonado(t *testing.T) {
	z := &zohoDeMentira{usuarios: 1}
	m := mundoComZoho(t, z, nil)
	for _, quem := range semAcessos {
		if st, j := proxy(t, m, quem, `{"action":"zoho.status"}`); st != 403 || j["error"] != "sem_permissao" {
			t.Errorf("%s: %d %v", quem, st, j)
		}
	}
	if st, j := proxy(t, m, "desativado", `{"action":"zoho.status"}`); st != 401 {
		t.Errorf("desativado: %d %v", st, j)
	}
	if st, j := proxy(t, m, "acessos", `{"action":"zoho.nao.existe"}`); st != 400 || j["error"] != "acao_desconhecida" || j["action"] != "zoho.nao.existe" {
		t.Errorf("ação desconhecida: %d %v", st, j)
	}
	if st, j := proxy(t, m, "acessos", `{"action":`); st != 400 || j["error"] != "json_invalido" {
		t.Errorf("json quebrado: %d %v", st, j)
	}
	// "entrar como" lê, mas não escreve nada no Zoho
	if st, j := proxy(t, m, "impersonado", `{"action":"zoho.status"}`); st != 200 || j["connected"] != true {
		t.Errorf("leitura do impersonado: %d %v", st, j)
	}
	for _, a := range []string{"zoho.authUrl", "zoho.import", "zoho.suspend", "zoho.reactivate", "zoho.create", "zoho.importarPastas",
		"zoho.criarLink", "zoho.apagarLink", "zoho.compartilharWorkspace", "zoho.revogarWorkspace"} {
		if st, j := proxy(t, m, "impersonado", `{"action":"`+a+`","email":"p0@rbv.com","password":"x","resourceId":"r","linkId":"l","permissaoId":"p"}`); st != 403 {
			t.Errorf("%s como impersonado = %d %v", a, st, j)
		}
	}
	if n := len(z.chamadas); n != 0 {
		t.Errorf("o Zoho recebeu %d chamadas de quem não podia: %v", n, z.chamadas)
	}
}

func TestProxyZohoStatusENaoConectado(t *testing.T) {
	z := &zohoDeMentira{}
	m := mundoComZoho(t, z, nil)
	if st, j := proxy(t, m, "admin", `{"action":"zoho.status"}`); st != 200 || j["connected"] != true || j["org_id"] != "org-1" {
		t.Errorf("status: %d %v", st, j)
	}
	if _, err := m.P.Exec(t.Context(), `update acessos_conexoes set refresh_token = null where provedor = 'zoho'`); err != nil {
		t.Fatal(err)
	}
	if st, j := proxy(t, m, "admin", `{"action":"zoho.status"}`); st != 200 || j["connected"] != false {
		t.Errorf("status sem refresh: %d %v", st, j)
	}
	for _, a := range []string{"zoho.users", "zoho.import", "zoho.suspend", "zoho.pastas", "zoho.acessoDaPasta", "zoho.criarLink"} {
		if st, j := proxy(t, m, "admin", `{"action":"`+a+`","email":"a@b.c","resourceId":"r"}`); st != 200 || j["error"] != "nao_conectado" {
			t.Errorf("%s sem conexão: %d %v", a, st, j)
		}
	}
	if len(z.chamadas) != 0 {
		t.Errorf("chamou o Zoho sem conexão: %v", z.chamadas)
	}
}

func TestProxyZohoUsuariosPaginaEImporta(t *testing.T) {
	z := &zohoDeMentira{usuarios: 53}
	fotos := &fotosDeTeste{feitas: map[string]string{}}
	m := mundoComZoho(t, z, fotos)
	if st, j := proxy(t, m, "acessos", `{"action":"zoho.users"}`); st != 200 || j["count"] != float64(53) || len(j["users"].([]any)) != 53 {
		t.Fatalf("users: %d %v", st, j)
	}
	// a Pessoa 5 já existe no cadastro (por zoho_account_id): atualiza, não duplica
	if _, err := m.P.Exec(t.Context(), `insert into acessos_pessoas (nome, status, zoho_account_id, email_corporativo) values ('Antigo', 'ativo', '1005', 'velho@rbv.com')`); err != nil {
		t.Fatal(err)
	}
	st, j := proxy(t, m, "acessos", `{"action":"zoho.import"}`)
	if st != 200 || j["criados"] != float64(52) || j["atualizados"] != float64(1) || j["erros"] != float64(0) || j["total"] != float64(53) || j["com_foto"] != float64(1) || j["fotos_falhas"] != float64(0) {
		t.Fatalf("import: %d %v", st, j)
	}
	if v := m.Um(t, `select nome || '|' || email_corporativo from acessos_pessoas where zoho_account_id = '1005'`); v != "Pessoa 5|p5@rbv.com" {
		t.Errorf("a pessoa existente não foi atualizada: %s", v)
	}
	if v := m.Um(t, `select count(*)::text from acessos_pessoas where zoho_account_id is not null`); v != "53" {
		t.Errorf("pessoas do Zoho = %s, esperava 53", v)
	}
	if url := m.Um(t, `select avatar_url from acessos_pessoas where zoho_account_id = '1001'`); !strings.HasPrefix(url, "https://api.test/storage/v1/object/public/acessos-avatars/") || !strings.Contains(url, ".png?v=") {
		t.Errorf("avatar_url = %s", url)
	}
	if len(fotos.feitas) != 1 {
		t.Errorf("fotos gravadas = %v", fotos.feitas)
	}
	// repetir não duplica nada
	st, j = proxy(t, m, "acessos", `{"action":"zoho.import"}`)
	if st != 200 || j["criados"] != float64(0) || j["atualizados"] != float64(53) {
		t.Fatalf("2º import: %d %v", st, j)
	}
	if v := m.Um(t, `select count(*)::text from acessos_pessoas where zoho_account_id is not null`); v != "53" {
		t.Errorf("o 2º import duplicou: %s", v)
	}
	if v := m.Um(t, `select resultado || '|' || coalesce(quem::text, '-') from acessos_log where acao = 'zoho.import' order by quando desc limit 1`); v != "ok|"+idAcessos {
		t.Errorf("trilha do import: %s", v)
	}
}

func TestProxyZohoImportSemFotosContaFalha(t *testing.T) {
	z := &zohoDeMentira{usuarios: 3}
	m := mundoComZoho(t, z, nil)
	if st, j := proxy(t, m, "admin", `{"action":"zoho.import"}`); st != 200 || j["com_foto"] != float64(0) || j["fotos_falhas"] != float64(1) || j["criados"] != float64(3) {
		t.Errorf("import sem Fotos: %d %v", st, j)
	}
}

func TestProxyZohoImportEmParalelo(t *testing.T) {
	z := &zohoDeMentira{usuarios: 20}
	m := mundoComZoho(t, z, nil)
	var wg sync.WaitGroup
	codigos := make([]int, 4)
	for i := range codigos {
		wg.Add(1)
		go func() {
			defer wg.Done()
			codigos[i], _ = m.Pedir(t, "admin", "POST", "/acessos-proxy", `{"action":"zoho.import"}`)
		}()
	}
	wg.Wait()
	if v := m.Um(t, `select count(*)::text from acessos_pessoas where zoho_account_id is not null`); v != "20" {
		t.Errorf("import em paralelo duplicou pessoas: %s (códigos %v)", v, codigos)
	}
	for _, c := range codigos {
		if c != 200 && c != 409 {
			t.Errorf("códigos %v", codigos)
		}
	}
}

func TestProxyZohoSuspenderReativarCriar(t *testing.T) {
	z := &zohoDeMentira{usuarios: 3}
	m := mundoComZoho(t, z, nil)
	if st, j := proxy(t, m, "admin", `{"action":"zoho.suspend","email":"P1@RBV.com"}`); st != 200 || j["ok"] != true || j["accao"] != "disableUser" {
		t.Fatalf("suspend: %d %v", st, j)
	}
	put := z.foram("PUT /mail/api/organization/accounts/1001")
	if len(put) != 1 || !strings.Contains(put[0], `"mode":"disableUser"`) || !strings.Contains(put[0], `"zuid":"9001"`) {
		t.Errorf("PUT = %v", put)
	}
	if st, j := proxy(t, m, "admin", `{"action":"zoho.reactivate","email":"p1@rbv.com"}`); st != 200 || j["accao"] != "enableUser" {
		t.Errorf("reactivate: %d %v", st, j)
	}
	if st, j := proxy(t, m, "admin", `{"action":"zoho.suspend","email":"ninguem@rbv.com"}`); st != 200 || j["error"] != "usuario_zoho_nao_encontrado" {
		t.Errorf("sem usuário: %d %v", st, j)
	}
	if st, j := proxy(t, m, "admin", `{"action":"zoho.suspend"}`); st != 200 || j["error"] != "sem_email" {
		t.Errorf("sem e-mail: %d %v", st, j)
	}
	if v := m.Um(t, `select count(*)::text from acessos_log where acao in ('zoho.suspend','zoho.reactivate') and resultado = 'ok'`); v != "2" {
		t.Errorf("trilha de suspender/reativar = %s", v)
	}
	if st, j := proxy(t, m, "admin", `{"action":"zoho.create","email":" novo@rbv.com ","password":"S3nha!","firstName":"No","lastName":"Vo"}`); st != 200 || j["ok"] != true || j["accountId"] != "777" || j["zuid"] != "888" || j["email"] != "novo@rbv.com" {
		t.Errorf("create: %d %v", st, j)
	}
	if st, j := proxy(t, m, "admin", `{"action":"zoho.create","email":"x@rbv.com"}`); st != 200 || j["error"] != "email_e_senha_obrigatorios" {
		t.Errorf("create sem senha: %d %v", st, j)
	}
	// a senha da caixa nunca vai para a trilha
	if v := m.Um(t, `select count(*)::text from acessos_log where detalhe like '%S3nha%'`); v != "0" {
		t.Errorf("a senha foi para a trilha")
	}
	z.quebra = map[string]int{"POST /mail/api/organization/accounts": 500}
	if st, j := proxy(t, m, "admin", `{"action":"zoho.create","email":"y@rbv.com","password":"p"}`); st != 200 || j["error"] != "zoho_create_falhou" || j["detalhe"] != "http 500" {
		t.Errorf("create com 500: %d %v", st, j)
	}
}

func TestProxyZohoPastasImportarEIdempotente(t *testing.T) {
	z := &zohoDeMentira{}
	m := mundoComZoho(t, z, nil)
	// o mundo já tem 'Contratos' (wd-1) como workdrive: conta como já importada
	st, j := proxy(t, m, "acessos", `{"action":"zoho.pastas"}`)
	if st != 200 || j["pastasDeEquipe"] != float64(1) || j["total"] != float64(3) || j["novas"] != float64(2) || j["jaImportadas"] != float64(1) {
		t.Fatalf("pastas: %d %v", st, j)
	}
	if v := m.Um(t, `select count(*)::text from acessos_recursos where tipo = 'workdrive'`); v != "1" {
		t.Errorf("listar gravou: %s", v)
	}
	st, j = proxy(t, m, "acessos", `{"action":"zoho.importarPastas"}`)
	if st != 200 || j["criadas"] != float64(2) || j["jaExistiam"] != float64(1) || j["total"] != float64(3) || j["erros"] != float64(0) {
		t.Fatalf("importar: %d %v", st, j)
	}
	if v := m.Um(t, `select nome || '|' || drive_id || '|' || caminho from acessos_recursos where external_id = 'wd-2'`); v != "Notas|tf1|Cliente A/Notas" {
		t.Errorf("linha importada: %s", v)
	}
	st, j = proxy(t, m, "acessos", `{"action":"zoho.importarPastas"}`)
	if st != 200 || j["criadas"] != float64(0) || j["jaExistiam"] != float64(3) {
		t.Fatalf("2ª importação: %d %v", st, j)
	}
	if v := m.Um(t, `select count(*)::text from acessos_recursos where tipo = 'workdrive'`); v != "3" {
		t.Errorf("workdrive = %s", v)
	}
	// o Zoho recusa a listagem: erro claro, sem gravar
	z.quebra = map[string]int{"GET /workdrive/api/v1/teams/org9/teamfolders": 500}
	if st, j := proxy(t, m, "acessos", `{"action":"zoho.importarPastas"}`); st != 500 || j["error"] != "falha_interna" {
		t.Errorf("Zoho fora: %d %v", st, j)
	}
}

func TestProxyZohoAcessoDaPastaELinks(t *testing.T) {
	z := &zohoDeMentira{}
	m := mundoComZoho(t, z, nil)
	st, j := proxy(t, m, "acessos", `{"action":"zoho.acessoDaPasta","resourceId":"wd-1"}`)
	if st != 200 || j["resourceId"] != "wd-1" || len(j["falhas"].([]any)) != 0 {
		t.Fatalf("acessoDaPasta: %d %v", st, j)
	}
	ps := j["pessoas"].([]any)
	p0, p1 := ps[0].(map[string]any), ps[1].(map[string]any)
	if p0["nome"] != "Ana Lima" || p0["email"] != "ana@rbv.com" || p0["escopo"] != "Pessoa específica" || p0["id"] != "pm1" || p0["expira_em_millis"] != float64(12) ||
		p1["nome"] != "?" || p1["escopo"] != "Qualquer um do time" || p1["expira_em_millis"] != float64(0) {
		t.Errorf("pessoas: %v", ps)
	}
	l0 := j["links"].([]any)[0].(map[string]any)
	if l0["url"] != "https://wd/l1" || l0["tem_senha"] != false || l0["expira_em"] != nil {
		t.Errorf("links: %v", l0)
	}
	// uma das duas leituras falha: a outra vem e a falha vai na resposta, nunca em silêncio
	z.quebra = map[string]int{"GET /workdrive/api/v1/files/wd-1/links": 500}
	st, j = proxy(t, m, "acessos", `{"action":"zoho.acessoDaPasta","resourceId":"wd-1"}`)
	f := j["falhas"].([]any)
	if st != 200 || len(f) != 1 || f[0].(map[string]any)["o_que"] != "links da pasta" || len(j["pessoas"].([]any)) != 2 || len(j["links"].([]any)) != 0 {
		t.Errorf("falha parcial: %d %v", st, j)
	}
	if st, j := proxy(t, m, "acessos", `{"action":"zoho.acessoDaPasta"}`); st != 400 || j["error"] != "faltou_resourceId" {
		t.Errorf("sem resourceId: %d %v", st, j)
	}
	// escritas
	if st, j := proxy(t, m, "acessos", `{"action":"zoho.criarLink","resourceId":"wd-1","papel":"edição"}`); st != 200 || j["id"] != "lk2" || j["url"] != "https://wd/l2" {
		t.Errorf("criarLink: %d %v", st, j)
	}
	if c := z.foram("POST /workdrive/api/v1/links"); len(c) != 1 || !strings.Contains(c[0], `"role_id":"5"`) || !strings.Contains(c[0], `"resource_id":"wd-1"`) || !strings.Contains(c[0], `"allow_download":true`) {
		t.Errorf("corpo do link: %v", c)
	}
	if st, j := proxy(t, m, "acessos", `{"action":"zoho.compartilharWorkspace","resourceId":"wd-1"}`); st != 200 || j["id"] != "pm9" {
		t.Errorf("compartilharWorkspace: %d %v", st, j)
	}
	if c := z.foram("POST /workdrive/api/v1/permissions"); len(c) != 1 || !strings.Contains(c[0], `"role_id":"6"`) || !strings.Contains(c[0], `"shared_type":"everyone"`) {
		t.Errorf("corpo da permissão: %v", c)
	}
	if st, j := proxy(t, m, "acessos", `{"action":"zoho.apagarLink","linkId":"lk1"}`); st != 200 || j["ok"] != true {
		t.Errorf("apagarLink: %d %v", st, j)
	}
	if st, j := proxy(t, m, "acessos", `{"action":"zoho.revogarWorkspace","permissaoId":"pm9"}`); st != 200 || j["ok"] != true {
		t.Errorf("revogarWorkspace: %d %v", st, j)
	}
	for a, campo := range map[string]string{"zoho.apagarLink": "faltou_linkId", "zoho.revogarWorkspace": "faltou_permissaoId", "zoho.criarLink": "faltou_resourceId", "zoho.compartilharWorkspace": "faltou_resourceId"} {
		if st, j := proxy(t, m, "acessos", `{"action":"`+a+`"}`); st != 400 || j["error"] != campo {
			t.Errorf("%s sem argumento: %d %v", a, st, j)
		}
	}
	z.quebra = map[string]int{"DELETE /workdrive/api/v1/links/lk1": 404}
	if st, j := proxy(t, m, "acessos", `{"action":"zoho.apagarLink","linkId":"lk1"}`); st != 502 || j["error"] != "falha_ao_apagar_link" || j["status"] != float64(404) {
		t.Errorf("apagarLink com 404: %d %v", st, j)
	}
}

func TestProxyZohoAuthURL(t *testing.T) {
	z := &zohoDeMentira{}
	m := mundoComZoho(t, z, nil)
	st, j := proxy(t, m, "admin", `{"action":"zoho.authUrl"}`)
	u, _ := j["url"].(string)
	if st != 200 || !strings.Contains(u, "/oauth/v2/auth?") || !strings.Contains(u, "client_id=cli-zoho") || !strings.Contains(u, "redirect_uri=https%3A%2F%2Fapi.test%2Facessos-oauth%2Fcallback%2Fzoho") ||
		!strings.Contains(u, "access_type=offline") || strings.Contains(u, "SEGREDO") {
		t.Fatalf("authUrl: %d %v", st, j)
	}
	estado := m.Um(t, `select oauth_state from acessos_conexoes where provedor = 'zoho'`)
	if len(estado) != 64 || estado == "SEGREDO-estado-zoho" || !strings.Contains(u, "state="+estado) {
		t.Errorf("state não foi renovado: %q", estado)
	}
}
