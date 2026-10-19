package acessos

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/microsoft"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// msGrafo: um Microsoft Graph de mentira (token em /token, Graph em /graph/me/drive/...). Guarda o que recebeu.
type msGrafo struct {
	mu           sync.Mutex
	perms        map[string][]mapa // item → permissões (GET permissions)
	filhos       map[string][]mapa // item ("raiz" = /root) → filhos (GET children); "gen*" gera 5 pastas por pasta
	falhaPerm    map[string]int    // item → status de erro no GET permissions
	falhaConvite map[string]int    // item → status de erro no invite
	falhaApagar  map[string]int    // item → status de erro no DELETE de permissão
	linkConvite  map[string]string // item → link que o invite devolve
	conta        map[string]string // e-mail convidado → conta real que o invite resolve
	tokenStatus  int               // != 0: o /token recusa com esse status
	convites     []mapa            // {item, corpo}
	apagados     []string          // "item/permissão"
	porMetodo    map[string]int    // "GET children" etc.
	total        int               // chamadas ao Graph (fora o token)
}

func msNovoGrafo() *msGrafo {
	return &msGrafo{perms: map[string][]mapa{}, filhos: map[string][]mapa{}, falhaPerm: map[string]int{},
		falhaConvite: map[string]int{}, falhaApagar: map[string]int{}, linkConvite: map[string]string{}, conta: map[string]string{}, porMetodo: map[string]int{}}
}

func msJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (g *msGrafo) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if r.URL.Path == "/token" {
		if g.tokenStatus != 0 {
			msJSON(w, g.tokenStatus, mapa{"error": "invalid_grant"})
			return
		}
		msJSON(w, 200, mapa{"access_token": "t"})
		return
	}
	g.total++
	if r.Header.Get("Authorization") != "Bearer t" {
		msJSON(w, 401, mapa{"error": mapa{"code": "InvalidAuthenticationToken"}})
		return
	}
	nao := func() { msJSON(w, 404, mapa{"error": mapa{"code": "itemNotFound"}}) }
	rest := strings.TrimPrefix(r.URL.EscapedPath(), "/graph/me/drive/")
	var partes []string
	for _, p := range strings.Split(rest, "/") {
		u, _ := url.PathUnescape(p)
		partes = append(partes, u)
	}
	item := "raiz"
	if partes[0] == "items" {
		item, partes = partes[1], partes[2:]
	} else {
		partes = partes[1:] // root/children
	}
	g.porMetodo[r.Method+" "+strings.Join(partes[:1], "")]++
	switch {
	case r.Method == "GET" && len(partes) == 1 && partes[0] == "children":
		if strings.HasPrefix(item, "gen") {
			var v []mapa
			for i := range 5 {
				v = append(v, mapa{"id": item + "-" + strconv.Itoa(i), "name": "n", "folder": mapa{"childCount": 5}})
			}
			msJSON(w, 200, mapa{"value": v})
			return
		}
		v, existe := g.filhos[item]
		if !existe {
			nao()
			return
		}
		msJSON(w, 200, mapa{"value": v})
	case r.Method == "GET" && len(partes) == 1 && partes[0] == "permissions":
		if st := g.falhaPerm[item]; st != 0 {
			msJSON(w, st, mapa{"error": mapa{"code": "generalException"}})
			return
		}
		v, existe := g.perms[item]
		if !existe {
			nao()
			return
		}
		msJSON(w, 200, mapa{"value": v})
	case r.Method == "POST" && len(partes) == 1 && partes[0] == "invite":
		var corpo mapa
		_ = json.NewDecoder(r.Body).Decode(&corpo)
		g.convites = append(g.convites, mapa{"item": item, "corpo": corpo})
		if st := g.falhaConvite[item]; st != 0 {
			msJSON(w, st, mapa{"error": mapa{"code": "accessDenied"}})
			return
		}
		email := corpo["recipients"].([]any)[0].(map[string]any)["email"].(string)
		if c := g.conta[email]; c != "" {
			email = c
		}
		v := []mapa{{"id": "inv", "roles": corpo["roles"], "grantedToV2": mapa{"user": mapa{"email": email}}}}
		if l := g.linkConvite[item]; l != "" {
			v = append(v, mapa{"id": "lk", "link": mapa{"webUrl": l}})
		}
		msJSON(w, 200, mapa{"value": v})
	case r.Method == "DELETE" && len(partes) == 2 && partes[0] == "permissions":
		if st := g.falhaApagar[item]; st != 0 {
			nao()
			return
		}
		g.apagados = append(g.apagados, item+"/"+partes[1])
		w.WriteHeader(204)
	default:
		nao()
	}
}

func msPerm(id, email, nome string, roles ...string) mapa {
	return mapa{"id": id, "roles": roles, "grantedToV2": mapa{"user": mapa{"email": email, "displayName": nome}}}
}

var msDono = mapa{"id": "own", "roles": []string{"owner"}, "grantedToV2": mapa{"user": mapa{"email": "dono@x.com", "displayName": "Dono"}}}

// msMembro: acesso direto da conta pessoal: sem grantedTo, o e-mail só no id (base64).
func msMembro(email string, roles ...string) mapa {
	return mapa{"id": base64.StdEncoding.EncodeToString([]byte("i:0#.f|membership|" + email)), "roles": roles}
}

func msPasta(id, nome string, filhos int) mapa {
	return mapa{"id": id, "name": nome, "folder": mapa{"childCount": filhos}}
}

func msMundo(t *testing.T, g *msGrafo, api string) *mundoteste.Mundo {
	t.Helper()
	srv := httptest.NewServer(g)
	t.Cleanup(srv.Close)
	return novoMundo(t, func(r chi.Router, p *pgxpool.Pool) {
		r.Post("/acessos-proxy", (&Proxy{Pool: p, MS: microsoft.ParaTeste(t, p, srv.URL), APIPublica: api}).ServeHTTP)
	})
}

// msPedir manda a ação como `quem` e devolve o status, o corpo como JSON e o texto bruto.
func msPedir(t *testing.T, m *mundoteste.Mundo, quem, acao string, campos mapa) (int, mapa, string) {
	t.Helper()
	if campos == nil {
		campos = mapa{}
	}
	campos["action"] = "microsoft." + acao
	b, _ := json.Marshal(campos)
	st, corpo := m.Pedir(t, quem, "POST", "/acessos-proxy", string(b))
	var j mapa
	if err := json.Unmarshal([]byte(corpo), &j); err != nil {
		t.Fatalf("%s: corpo não é um objeto JSON: %s", acao, corpo)
	}
	return st, j, corpo
}

// msV: o valor em j seguindo o caminho (chave de objeto ou posição de lista), ou nil.
func msV(j any, caminho ...any) any {
	for _, c := range caminho {
		switch k := c.(type) {
		case string:
			m, _ := j.(map[string]any)
			j = m[k]
		case int:
			l, _ := j.([]any)
			if k >= len(l) {
				return nil
			}
			j = l[k]
		}
	}
	return j
}

func msQuer(t *testing.T, onde string, got, want any) {
	t.Helper()
	// fmt.Sprint junta texto sem espaço: compara sem espaços dos dois lados
	sem := func(v any) string { return strings.ReplaceAll(fmt.Sprint(v), " ", "") }
	if sem(got) != sem(want) {
		t.Errorf("%s = %v, esperava %v", onde, got, want)
	}
}

func msTam(j any, caminho ...any) int {
	l, _ := msV(j, caminho...).([]any)
	return len(l)
}

func msSQL(t *testing.T, m *mundoteste.Mundo, sql string, args ...any) {
	t.Helper()
	if _, err := m.P.Exec(t.Context(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func msLog(t *testing.T, m *mundoteste.Mundo, acao, resultado string) string {
	return m.Um(t, `select count(*)::text from acessos_log where acao = $1 and resultado = $2 and provedor = 'microsoft' and quem = $3::uuid`,
		acao, resultado, idAdmin)
}

const msApi = "https://x.test/api"

var msTodas = []string{"status", "authUrl", "browse", "tree", "shareMany", "addFolder", "folders", "removeFolder",
	"shares", "sharesMany", "accessScan", "allShares", "share", "unshare", "revokeForEmail"}

func TestProxyMicrosoftPortaoEImpersonado(t *testing.T) {
	g := msNovoGrafo()
	m := msMundo(t, g, msApi)
	for _, quem := range semAcessos {
		for _, a := range msTodas {
			st, j, _ := msPedir(t, m, quem, a, mapa{"itemId": "x", "email": "a@x.com", "items": []string{"x"}, "emails": []string{"a@x.com"}})
			if st != 403 || j["error"] != "sem_permissao" {
				t.Errorf("%s %s: %d %v, esperava 403 sem_permissao", quem, a, st, j)
			}
		}
	}
	antes := m.Um(t, `select count(*)::text from acessos_recursos`)
	for _, a := range []string{"authUrl", "shareMany", "addFolder", "removeFolder", "share", "unshare", "revokeForEmail"} {
		st, j, _ := msPedir(t, m, "impersonado", a, mapa{"itemId": "x", "name": "n", "email": "a@x.com", "items": []string{"x"},
			"emails": []string{"a@x.com"}, "permId": "p", "recursoId": R1})
		if st != 403 || j["error"] != "sem_permissao" {
			t.Errorf("impersonado %s: %d %v, esperava 403", a, st, j)
		}
	}
	msQuer(t, "recursos depois do impersonado", m.Um(t, `select count(*)::text from acessos_recursos`), antes)
	if st, j, _ := msPedir(t, m, "impersonado", "status", nil); st != 200 || j["connected"] != true {
		t.Errorf("impersonado lê o status: %d %v", st, j)
	}
	if g.total != 0 {
		t.Errorf("o Graph recebeu %d chamadas de quem não podia", g.total)
	}
}

func TestProxyMicrosoftSemConexao(t *testing.T) {
	g := msNovoGrafo()
	m := msMundo(t, g, msApi)
	msSQL(t, m, `update acessos_conexoes set refresh_token = null where provedor = 'microsoft'`)
	campos := mapa{"itemId": "x", "email": "a@x.com", "items": []string{"x"}, "emails": []string{"a@x.com"}, "permId": "p"}
	for _, a := range []string{"browse", "tree", "shareMany", "shares", "sharesMany", "accessScan", "allShares", "share", "unshare", "revokeForEmail"} {
		st, j, corpo := msPedir(t, m, "admin", a, campos)
		if st != 200 || j["error"] != "nao_conectado" {
			t.Errorf("%s sem refresh_token: %d %s", a, st, corpo)
		}
	}
	if g.total != 0 {
		t.Errorf("o Graph recebeu %d chamadas sem conexão", g.total)
	}
	msQuer(t, "shareMany sem conexão não registra pasta", m.Um(t, `select count(*)::text from acessos_recursos where tipo = 'onedrive'`), 0)
	st, j, _ := msPedir(t, m, "admin", "status", nil)
	msQuer(t, "status", fmt.Sprint(st, j["connected"], j["conectado_em"]), "200 false <nil>")
	msSQL(t, m, `update acessos_conexoes set refresh_token = 'novo', conectado_em = '2026-10-01T10:00:00Z' where provedor = 'microsoft'`)
	_, j, corpo := msPedir(t, m, "admin", "status", nil)
	if j["connected"] != true || !strings.Contains(corpo, "2026-10-01") {
		t.Errorf("status conectado: %s", corpo)
	}
}

func TestProxyMicrosoftTokenRecusado(t *testing.T) {
	g := msNovoGrafo()
	g.tokenStatus = 400
	m := msMundo(t, g, msApi)
	for _, a := range []string{"browse", "tree", "allShares"} {
		st, j, _ := msPedir(t, m, "admin", a, mapa{"itemId": "x"})
		if st != 500 || j["error"] != "falha_interna" {
			t.Errorf("%s com token recusado: %d %v, esperava 500 falha_interna", a, st, j)
		}
	}
}

func TestProxyMicrosoftBrowse(t *testing.T) {
	g := msNovoGrafo()
	g.filhos["raiz"] = []mapa{msPasta("p1", "Marca", 3), {"id": "f1", "name": "a.txt", "file": mapa{}}}
	g.filhos["p1"] = []mapa{}
	m := msMundo(t, g, msApi)
	st, j, _ := msPedir(t, m, "admin", "browse", nil)
	msQuer(t, "raiz", fmt.Sprint(st, msTam(j, "folders"), msV(j, "folders", 0, "id"), msV(j, "folders", 0, "name"),
		msV(j, "folders", 0, "childCount"), j["parentId"]), "200 1 p1 Marca 3 <nil>")
	_, j, corpo := msPedir(t, m, "admin", "browse", mapa{"itemId": "p1"})
	if !strings.Contains(corpo, `"folders":[]`) || j["parentId"] != "p1" {
		t.Errorf("pasta vazia: %s", corpo)
	}
	_, j, _ = msPedir(t, m, "admin", "browse", mapa{"itemId": "nao-existe"})
	msQuer(t, "erro do Graph", fmt.Sprint(j["error"], msV(j, "detalhe", "error", "code")), "graph_http_404 itemNotFound")
}

func TestProxyMicrosoftTree(t *testing.T) {
	g := msNovoGrafo()
	g.filhos["raiz"] = []mapa{msPasta("A", "A", 2), {"id": "f", "name": "arq", "file": mapa{}}}
	g.filhos["A"] = []mapa{msPasta("A1", "A1", 1), msPasta("A2", "A2", 0)}
	g.filhos["A1"] = []mapa{msPasta("A11", "A11", 0)}
	m := msMundo(t, g, msApi)
	ids := func(j mapa) string {
		var s []string
		for i := range msTam(j, "folders") {
			s = append(s, fmt.Sprint(msV(j, "folders", i, "id"), ":", msV(j, "folders", i, "depth")))
		}
		return strings.Join(s, ",")
	}
	_, j, _ := msPedir(t, m, "admin", "tree", mapa{"itemId": "raiz", "depth": 1})
	msQuer(t, "profundidade 1", ids(j), "A:1")
	msQuer(t, "total e truncated", fmt.Sprint(j["total"], j["truncated"], j["depth"]), "1 false 1")
	_, j, corpo := msPedir(t, m, "admin", "tree", mapa{"itemId": "raiz"}) // padrão 2
	msQuer(t, "profundidade padrão", ids(j), "A:1,A1:2,A2:2")
	msQuer(t, "trail e parentId", fmt.Sprint(msV(j, "folders", 0, "trail"), msV(j, "folders", 0, "parentId"), msV(j, "folders", 1, "trail"), msV(j, "folders", 1, "parentId")), "[] raiz [A] A")
	if !strings.Contains(corpo, `"trail":[]`) {
		t.Errorf("trail da raiz tem de sair [] e não null: %s", corpo)
	}
	_, j, _ = msPedir(t, m, "admin", "tree", mapa{"itemId": "raiz", "depth": "9"}) // texto, e acima do teto 5
	msQuer(t, "profundidade 5", fmt.Sprint(ids(j), j["depth"]), "A:1,A1:2,A2:2,A11:3 5")
	msQuer(t, "trail profundo", msV(j, "folders", 3, "trail"), "[A A1]")
	if st, j, _ := msPedir(t, m, "admin", "tree", nil); st != 400 || j["error"] != "sem_itemId" {
		t.Errorf("sem itemId: %d %v", st, j)
	}
	// tetos: 5 pastas por pasta, 5 níveis = 781 chamadas; para em 400 e marca truncated
	_, j, _ = msPedir(t, m, "admin", "tree", mapa{"itemId": "gen", "depth": 5})
	g.mu.Lock()
	chamadas := g.porMetodo["GET children"]
	g.mu.Unlock()
	total, _ := j["total"].(float64)
	if j["truncated"] != true || total == 0 || total > 1500 || chamadas > 401 {
		t.Errorf("tetos: truncated=%v total=%v chamadas=%d", j["truncated"], j["total"], chamadas)
	}
}

func TestProxyMicrosoftAddFolderFoldersRemoveFolder(t *testing.T) {
	g := msNovoGrafo()
	m := msMundo(t, g, msApi)
	_, _, corpo := msPedir(t, m, "admin", "folders", nil)
	if !strings.Contains(corpo, `"folders":[]`) {
		t.Errorf("sem pastas tem de sair []: %s", corpo)
	}
	st, j, _ := msPedir(t, m, "admin", "addFolder", mapa{"itemId": "od-1", "name": "Zeta", "caminho": "/RBV/Zeta"})
	id, _ := msV(j, "recurso", "id").(string)
	msQuer(t, "criou", fmt.Sprint(st, msV(j, "recurso", "tipo"), msV(j, "recurso", "provedor"), msV(j, "recurso", "nome"),
		msV(j, "recurso", "external_id"), msV(j, "recurso", "caminho"), j["jaExistia"]), "200 onedrive microsoft Zeta od-1 /RBV/Zeta <nil>")
	if id == "" {
		t.Fatal("recurso sem id")
	}
	_, j, _ = msPedir(t, m, "admin", "addFolder", mapa{"itemId": "od-1", "name": "Outro nome"})
	msQuer(t, "repetido", fmt.Sprint(j["jaExistia"], msV(j, "recurso", "id") == id, msV(j, "recurso", "nome")), "true true Zeta")
	msQuer(t, "uma linha", m.Um(t, `select count(*)::text from acessos_recursos where external_id = 'od-1'`), 1)
	msQuer(t, "log addFolder", msLog(t, m, "onedrive.addFolder", "ok"), 1)
	// arquivada conta como existente (checagem de duplicata, não listagem)
	msSQL(t, m, `insert into acessos_recursos (tipo, provedor, nome, external_id, arquivado_em) values ('onedrive', 'microsoft', 'Arq', 'od-arq', now())`)
	_, j, _ = msPedir(t, m, "admin", "addFolder", mapa{"itemId": "od-arq", "name": "Arq"})
	msQuer(t, "arquivada existe", j["jaExistia"], true)
	msQuer(t, "arquivada não duplica", m.Um(t, `select count(*)::text from acessos_recursos where external_id = 'od-arq'`), 1)
	_, j, _ = msPedir(t, m, "admin", "addFolder", mapa{"itemId": "od-2"})
	msQuer(t, "sem nome", msV(j, "recurso", "nome"), "(sem nome)")
	if st, j, _ := msPedir(t, m, "admin", "addFolder", nil); st != 400 || j["error"] != "sem_itemId" {
		t.Errorf("sem itemId: %d %v", st, j)
	}
	msSQL(t, m, `insert into acessos_recursos (tipo, provedor, nome, external_id) values ('onedrive', 'microsoft', 'Alfa', 'od-3')`)
	_, j, _ = msPedir(t, m, "admin", "folders", nil)
	var nomes []string
	for i := range msTam(j, "folders") {
		nomes = append(nomes, msV(j, "folders", i, "nome").(string))
	}
	// só onedrive, ativas, por nome; as do mundo (icloud/workdrive) e a arquivada ficam de fora
	msQuer(t, "folders", strings.Join(nomes, ","), "(sem nome),Alfa,Zeta")

	if st, j, _ := msPedir(t, m, "admin", "removeFolder", nil); st != 400 || j["error"] != "sem_recursoId" {
		t.Errorf("sem recursoId: %d %v", st, j)
	}
	_, j, _ = msPedir(t, m, "admin", "removeFolder", mapa{"recursoId": id})
	msQuer(t, "removeFolder", j["ok"], true)
	msQuer(t, "removida", m.Um(t, `select count(*)::text from acessos_recursos where id = $1::uuid`, id), 0)
	msQuer(t, "log removeFolder", msLog(t, m, "onedrive.removeFolder", "ok"), 1)
	if st, j, _ := msPedir(t, m, "admin", "removeFolder", mapa{"recursoId": "nao-e-uuid"}); st != 500 || j["error"] != "falha_ao_remover" {
		t.Errorf("id inválido: %d %v", st, j)
	}
}

func TestProxyMicrosoftAddFolderEmParalelo(t *testing.T) {
	m := msMundo(t, msNovoGrafo(), msApi)
	mundoteste.EmParalelo(8, func(int) {
		m.Pedir(t, "admin", "POST", "/acessos-proxy", `{"action":"microsoft.addFolder","itemId":"od-corrida","name":"C"}`)
	})
	msQuer(t, "uma linha só", m.Um(t, `select count(*)::text from acessos_recursos where external_id = 'od-corrida'`), 1)
}

func TestProxyMicrosoftShares(t *testing.T) {
	g := msNovoGrafo()
	g.perms["P"] = []mapa{
		msDono,
		{"id": "lnk", "roles": []string{"read"}, "link": mapa{"scope": "anonymous", "webUrl": "https://1drv.ms/f/s!abc"}},
		msPerm("pa", "ana@x.com", "Ana", "write"),
		msMembro("bia@x.com", "read"),
	}
	g.perms["vazia"] = []mapa{msDono}
	m := msMundo(t, g, msApi)
	st, j, _ := msPedir(t, m, "admin", "shares", mapa{"itemId": "P"})
	msQuer(t, "status e total", fmt.Sprint(st, msTam(j, "shares"), j["link"]), "200 3 https://1drv.ms/f/s!abc")
	linha := func(i int) string {
		return fmt.Sprint(msV(j, "shares", i, "permId"), "|", msV(j, "shares", i, "name"), "|", msV(j, "shares", i, "email"), "|", msV(j, "shares", i, "role"))
	}
	msQuer(t, "link", linha(0), "lnk|Link (anonymous)||leitura")
	msQuer(t, "edição", linha(1), "pa|Ana|ana@x.com|edição")
	msQuer(t, "membership", strings.Split(linha(2), "|")[2]+strings.Split(linha(2), "|")[3], "bia@x.comleitura")
	_, _, corpo := msPedir(t, m, "admin", "shares", mapa{"itemId": "vazia"})
	if !strings.Contains(corpo, `"shares":[]`) || !strings.Contains(corpo, `"link":null`) {
		t.Errorf("só o dono: %s", corpo)
	}
	if st, j, _ := msPedir(t, m, "admin", "shares", nil); st != 400 || j["error"] != "sem_itemId" {
		t.Errorf("sem itemId: %d %v", st, j)
	}
	_, j, _ = msPedir(t, m, "admin", "shares", mapa{"itemId": "x"})
	msQuer(t, "erro do Graph", j["error"], "graph_http_404")
}

func TestProxyMicrosoftShareEUnshare(t *testing.T) {
	g := msNovoGrafo()
	g.perms["P"] = []mapa{{"id": "lnk", "roles": []string{"read"}, "link": mapa{"webUrl": "https://1drv.ms/f/P"}}}
	g.conta["alias@x.com"] = "real@outlook.com"
	g.falhaConvite["Q"] = 403
	m := msMundo(t, g, msApi)
	_, j, _ := msPedir(t, m, "admin", "share", mapa{"itemId": "P", "email": "alias@x.com", "role": "edição"})
	msQuer(t, "resposta", fmt.Sprint(j["ok"], j["invited"], j["account"], j["link"]), "true alias@x.com real@outlook.com https://1drv.ms/f/P")
	c := g.convites[0]
	msQuer(t, "convite", fmt.Sprint(c["item"], msV(c["corpo"], "recipients", 0, "email"), msV(c["corpo"], "roles", 0),
		msV(c["corpo"], "requireSignIn"), msV(c["corpo"], "sendInvitation")), "P alias@x.com write true true")
	if !strings.Contains(fmt.Sprint(msV(c["corpo"], "message")), "RBV") {
		t.Errorf("convite sem mensagem: %v", c)
	}
	_, j, _ = msPedir(t, m, "admin", "share", mapa{"itemId": "P", "email": "novo@x.com"})
	msQuer(t, "papel padrão e conta", fmt.Sprint(msV(g.convites[1]["corpo"], "roles", 0), j["account"]), "read novo@x.com")
	msQuer(t, "log share ok", msLog(t, m, "onedrive.share", "ok"), 2)

	st, j, _ := msPedir(t, m, "admin", "share", mapa{"itemId": "Q", "email": "z@x.com"})
	msQuer(t, "negado", fmt.Sprint(st, j["error"], msV(j, "detalhe", "error", "code"), j["ok"]), "200 graph_http_403 accessDenied <nil>")
	msQuer(t, "log share erro", msLog(t, m, "onedrive.share", "erro"), 1)
	if st, j, _ := msPedir(t, m, "admin", "share", mapa{"itemId": "P"}); st != 400 || j["error"] != "sem_itemId_ou_email" {
		t.Errorf("sem e-mail: %d %v", st, j)
	}

	_, j, _ = msPedir(t, m, "admin", "unshare", mapa{"itemId": "P", "permId": "pa/1"})
	msQuer(t, "unshare", fmt.Sprint(j["ok"], g.apagados), "true [P/pa/1]")
	msQuer(t, "log unshare ok", msLog(t, m, "onedrive.unshare", "ok"), 1)
	if st, j, _ := msPedir(t, m, "admin", "unshare", mapa{"itemId": "P"}); st != 400 || j["error"] != "sem_itemId_ou_permId" {
		t.Errorf("sem permId: %d %v", st, j)
	}
}

func TestProxyMicrosoftUnshareNegadoPeloGraph(t *testing.T) {
	g := msNovoGrafo()
	g.falhaApagar["P"] = 404
	m := msMundo(t, g, msApi)
	_, j, _ := msPedir(t, m, "admin", "unshare", mapa{"itemId": "P", "permId": "x"})
	msQuer(t, "unshare 404", j["error"], "graph_http_404")
	msQuer(t, "log unshare erro", msLog(t, m, "onedrive.unshare", "erro"), 1)
}

func TestProxyMicrosoftShareMany(t *testing.T) {
	g := msNovoGrafo()
	g.linkConvite["A"] = "https://1drv.ms/A"
	g.perms["B"] = []mapa{{"id": "lk", "roles": []string{"read"}, "link": mapa{"webUrl": "https://1drv.ms/B"}}}
	g.falhaConvite["C"] = 500
	g.conta["y@x.com"] = "real-y@outlook.com"
	m := msMundo(t, g, msApi)
	msSQL(t, m, `insert into acessos_recursos (tipo, provedor, nome, external_id) values ('onedrive', 'microsoft', 'B já registrada', 'B')`)
	_, j, _ := msPedir(t, m, "admin", "shareMany", mapa{
		"items": []any{mapa{"id": "A", "name": "Pasta A"}, "B", mapa{"id": "C"}, mapa{"name": "sem id"}, ""}, "emails": []any{"x@x.com", "y@x.com", "", 7}, "role": "edição"})
	msQuer(t, "placar", fmt.Sprint(j["ok"], j["fail"], j["ops"], j["truncated"]), "4 2 6 false")
	for _, c := range g.convites {
		if msV(c["corpo"], "roles", 0) != "write" {
			t.Errorf("papel do convite: %v", c)
		}
	}
	msQuer(t, "links", fmt.Sprint(msTam(j, "links"), msV(j, "links", 0, "id"), msV(j, "links", 0, "name"), msV(j, "links", 0, "link"),
		msV(j, "links", 1, "id"), msV(j, "links", 1, "name"), msV(j, "links", 1, "link")), "2 A Pasta A https://1drv.ms/A B <nil> https://1drv.ms/B")
	msQuer(t, "resolved", fmt.Sprint(msTam(j, "resolved"), msV(j, "resolved", 0, "invited"), msV(j, "resolved", 0, "account"),
		msV(j, "resolved", 1, "account")), "2 x@x.com x@x.com real-y@outlook.com")
	msQuer(t, "A registrada com o nome", m.Um(t, `select nome from acessos_recursos where external_id = 'A' and tipo = 'onedrive'`), "Pasta A")
	msQuer(t, "B não duplica", m.Um(t, `select count(*)::text from acessos_recursos where external_id = 'B'`), 1)
	msQuer(t, "C registrada sem nome", m.Um(t, `select nome from acessos_recursos where external_id = 'C'`), "(sem nome)")
	msQuer(t, "log shareMany (parcial vira erro)", msLog(t, m, "onedrive.shareMany", "erro"), 1)
	msQuer(t, "detalhe do log", m.Um(t, `select detalhe from acessos_log where acao = 'onedrive.shareMany'`), `{"emails":2,"fail":2,"items":3,"ok":4}`)

	for _, c := range []mapa{{}, {"items": []string{"A"}}, {"emails": []string{"a@x.com"}}, {"items": []string{"A"}, "emails": []any{1, ""}}} {
		if st, j, _ := msPedir(t, m, "admin", "shareMany", c); st != 400 || j["error"] != "sem_items_ou_emails" {
			t.Errorf("%v: %d %v", c, st, j)
		}
	}
}

func TestProxyMicrosoftShareManyTeto(t *testing.T) {
	g := msNovoGrafo()
	m := msMundo(t, g, msApi)
	var itens, emails []string
	for i := range 30 {
		itens = append(itens, "i"+strconv.Itoa(i))
	}
	for i := range 21 {
		emails = append(emails, "e"+strconv.Itoa(i)+"@x.com")
	}
	_, j, _ := msPedir(t, m, "admin", "shareMany", mapa{"items": itens, "emails": emails})
	msQuer(t, "teto de 600", fmt.Sprint(j["ops"], j["ok"], j["truncated"], len(g.convites)), "600 600 true 600")
	msQuer(t, "só as pastas alcançadas têm link", msTam(j, "links"), 29)
}

func TestProxyMicrosoftSharesMany(t *testing.T) {
	g := msNovoGrafo()
	g.perms["A"] = []mapa{msDono, msPerm("1", "Ana@x.com", "Ana", "read"), msPerm("2", "bia@x.com", "Bia", "read")}
	g.perms["B"] = []mapa{msPerm("3", "ana@x.com", "Ana", "write")}
	m := msMundo(t, g, msApi)
	_, j, _ := msPedir(t, m, "admin", "sharesMany", mapa{"items": []any{"A", "B", mapa{"id": "sumiu"}}})
	msQuer(t, "agregado", fmt.Sprint(msTam(j, "shares"), j["total"], msV(j, "shares", 0, "email"), msV(j, "shares", 0, "role"),
		msV(j, "shares", 0, "folders"), msV(j, "shares", 1, "email"), msV(j, "shares", 1, "role"), msV(j, "shares", 1, "folders")),
		"2 3 Ana@x.com edição 2 bia@x.com leitura 1")
	_, _, corpo := msPedir(t, m, "admin", "sharesMany", mapa{"items": []string{}})
	msQuer(t, "vazio", corpo, `{"shares":[],"total":0}`)
}

func TestProxyMicrosoftAccessScan(t *testing.T) {
	g := msNovoGrafo()
	g.perms["od-raiz-1"] = []mapa{msDono, msPerm("1", "Ana@X.com", "Ana", "write"),
		{"id": "2", "roles": []string{"read"}, "grantedToV2": mapa{"user": mapa{"email": "bia@x.com"}}, "inheritedFrom": mapa{"id": "pai"}},
		{"id": "lnk", "roles": []string{"read"}, "link": mapa{"scope": "anonymous"}}}
	g.filhos["od-raiz-1"] = []mapa{msPasta("F1", "Financeiro", 1), {"id": "x", "name": "arq", "file": mapa{}}}
	g.perms["F1"] = []mapa{msPerm("3", "Carla@X.com", "Carla", "read")}
	g.filhos["F1"] = []mapa{msPasta("F2", "Fundo", 0)}
	g.perms["F2"] = []mapa{msPerm("4", "dan@x.com", "Dan", "read")}
	m := msMundo(t, g, msApi)
	linhas := func(j mapa) string {
		var s []string
		for i := range msTam(j, "items") {
			s = append(s, fmt.Sprint(msV(j, "items", i, "email"), ":", msV(j, "items", i, "role"), ":", msV(j, "items", i, "marca"), ":", msV(j, "items", i, "pasta")))
		}
		return strings.Join(s, ",")
	}
	_, j, _ := msPedir(t, m, "admin", "accessScan", nil)
	msQuer(t, "profundidade padrão (2)", linhas(j), "ana@x.com:edição:RBV:RBV,carla@x.com:leitura:RBV:Financeiro,dan@x.com:leitura:RBV:Fundo")
	msQuer(t, "depth/truncated", fmt.Sprint(j["depth"], j["truncated"]), "2 false")
	_, j, _ = msPedir(t, m, "admin", "accessScan", mapa{"depth": 1})
	msQuer(t, "profundidade 1", linhas(j), "ana@x.com:edição:RBV:RBV,carla@x.com:leitura:RBV:Financeiro")
	msSQL(t, m, `delete from acessos_drive_marcas`)
	_, _, corpo := msPedir(t, m, "admin", "accessScan", nil)
	msQuer(t, "sem marcas", corpo, `{"depth":2,"items":[],"truncated":false}`)
}

func TestProxyMicrosoftAllShares(t *testing.T) {
	g := msNovoGrafo()
	g.perms["od-raiz-1"] = []mapa{msDono, msPerm("1", "ana@x.com", "Ana", "write")}
	g.perms["od-a"] = []mapa{{"id": "2", "roles": []string{"read"}, "inheritedFrom": mapa{"id": "pai"},
		"grantedToV2": mapa{"user": mapa{"email": "Bia@X.com", "displayName": "Bia"}}}}
	g.perms["od-arq-ok"] = []mapa{msPerm("3", "carla@x.com", "Carla", "read")}
	g.falhaPerm["od-arq-500"] = 500
	m := msMundo(t, g, msApi)
	msSQL(t, m, `insert into acessos_recursos (id, tipo, provedor, nome, external_id, criado_em, arquivado_em) values
	  ('a4500000-0000-4000-a000-0000000000a1', 'onedrive', 'microsoft', 'Ativa', 'od-a', '2026-01-01', null),
	  ('a4500000-0000-4000-a000-0000000000a2', 'onedrive', 'microsoft', 'Arquivada ok', 'od-arq-ok', '2026-01-02', now()),
	  ('a4500000-0000-4000-a000-0000000000a3', 'onedrive', 'microsoft', 'Arquivada 500', 'od-arq-500', '2026-01-03', now()),
	  ('a4500000-0000-4000-a000-0000000000a4', 'onedrive', 'microsoft', 'Duplicata da raiz', 'od-raiz-1', '2026-01-04', null)`)
	_, j, _ := msPedir(t, m, "admin", "allShares", nil)
	linha := func(i int) string {
		return fmt.Sprint(msV(j, "items", i, "pasta"), "|", msV(j, "items", i, "email"), "|", msV(j, "items", i, "role"), "|",
			msV(j, "items", i, "isRoot"), "|", msV(j, "items", i, "marca"), "|", msV(j, "items", i, "inherited"))
	}
	msQuer(t, "total", msTam(j, "items"), 3)
	msQuer(t, "raiz da marca", linha(0), "RBV|ana@x.com|edição|true|RBV|false")
	msQuer(t, "herdada", linha(1), "Ativa|bia@x.com|leitura|false|<nil>|true")
	msQuer(t, "arquivada entra", linha(2), "Arquivada ok|carla@x.com|leitura|false|<nil>|false")
	msQuer(t, "recursoId", msV(j, "items", 1, "recursoId"), "a4500000-0000-4000-a000-0000000000a1")
	msQuer(t, "falhas", fmt.Sprint(msTam(j, "falhas"), msV(j, "falhas", 0, "pasta"), msV(j, "falhas", 0, "motivo")), "1 Arquivada 500 HTTP 500")
	// nada para ler: as duas listas saem [] e nunca null
	msSQL(t, m, `delete from acessos_recursos where tipo = 'onedrive'; delete from acessos_drive_marcas`)
	_, _, corpo := msPedir(t, m, "admin", "allShares", nil)
	msQuer(t, "vazio", corpo, `{"falhas":[],"items":[]}`)
}

func TestProxyMicrosoftRevokeForEmail(t *testing.T) {
	g := msNovoGrafo()
	membroAna := msMembro("Ana@x.com", "write")
	g.perms["od-a"] = []mapa{msDono, msPerm("pa", "ana@x.com", "Ana", "read"), msPerm("pb", "bia@x.com", "Bia", "read")}
	g.perms["od-arq"] = []mapa{membroAna, msPerm("pb2", "bia@x.com", "Bia", "read")}
	g.perms["od-outra"] = []mapa{msPerm("pb3", "bia@x.com", "Bia", "read")}
	g.falhaPerm["od-quebrada"] = 500
	m := msMundo(t, g, msApi)
	msSQL(t, m, `insert into acessos_recursos (tipo, provedor, nome, external_id, criado_em, arquivado_em) values
	  ('onedrive', 'microsoft', 'Ativa', 'od-a', '2026-01-01', null),
	  ('onedrive', 'microsoft', 'Arquivada', 'od-arq', '2026-01-02', now()),
	  ('onedrive', 'microsoft', 'Outra', 'od-outra', '2026-01-03', null),
	  ('onedrive', 'microsoft', 'Quebrada', 'od-quebrada', '2026-01-04', null),
	  ('onedrive', 'microsoft', 'Sem id', null, '2026-01-05', null)`)
	_, j, _ := msPedir(t, m, "admin", "revokeForEmail", mapa{"email": "ANA@x.com"})
	msQuer(t, "resposta", fmt.Sprint(j["removed"], j["folders"], j["falhas"], j["truncated"]), "2 [Ativa Arquivada] 1 <nil>")
	msQuer(t, "só as permissões da Ana", fmt.Sprint(g.apagados), fmt.Sprint([]string{"od-a/pa", "od-arq/" + membroAna["id"].(string)}))
	msQuer(t, "log revoke", m.Um(t, `select detalhe from acessos_log where acao = 'onedrive.revoke' and resultado = 'ok' and alvo = 'ANA@x.com'`), "2 acessos")
	// ninguém com esse e-mail: nada apagado, e a lista sai [] e não null
	g.apagados = nil
	_, _, corpo := msPedir(t, m, "admin", "revokeForEmail", mapa{"email": "ninguem@x.com"})
	if !strings.Contains(corpo, `"folders":[]`) || len(g.apagados) != 0 {
		t.Errorf("ninguém: %s %v", corpo, g.apagados)
	}
	st, j, _ := msPedir(t, m, "admin", "revokeForEmail", nil)
	msQuer(t, "sem e-mail", fmt.Sprint(st, " ", j["error"]), "200 sem_email")
}

func TestProxyMicrosoftAuthURL(t *testing.T) {
	m := msMundo(t, msNovoGrafo(), msApi)
	st, j, _ := msPedir(t, m, "admin", "authUrl", nil)
	u, err := url.Parse(fmt.Sprint(j["url"]))
	if st != 200 || err != nil || !strings.HasSuffix(u.Path, "/authorize") {
		t.Fatalf("authUrl: %d %v", st, j)
	}
	q := u.Query()
	msQuer(t, "redirect_uri", q.Get("redirect_uri"), "https://x.test/api/acessos-oauth/callback/microsoft")
	msQuer(t, "demais parâmetros", strings.Join([]string{q.Get("client_id"), q.Get("response_type"), q.Get("response_mode"), q.Get("scope")}, " "),
		"cli-ms code query Files.ReadWrite offline_access User.Read")
	estado := m.Um(t, `select oauth_state from acessos_conexoes where provedor = 'microsoft'`)
	if estado == "<nulo>" || estado == "" || q.Get("state") != estado {
		t.Errorf("state da URL %q != gravado %q", q.Get("state"), estado)
	}
	msQuer(t, "state com data", m.Um(t, `select (oauth_state_em is not null)::text from acessos_conexoes where provedor = 'microsoft'`), "true")
	msQuer(t, "o state do Zoho não muda", m.Um(t, `select oauth_state from acessos_conexoes where provedor = 'zoho'`), "SEGREDO-estado-zoho")

	sem := msMundo(t, msNovoGrafo(), "")
	st, j, _ = msPedir(t, sem, "admin", "authUrl", nil)
	msQuer(t, "sem APIPublica", fmt.Sprint(st, " ", j["error"]), "500 api_url_publica_ausente")
	msQuer(t, "sem APIPublica não grava state", sem.Um(t, `select oauth_state from acessos_conexoes where provedor = 'microsoft'`), "<nulo>")

	// conexão sem linha: defeito, não "nao_conectado"
	msSQL(t, m, `delete from acessos_conexoes where provedor = 'microsoft'`)
	st, j, _ = msPedir(t, m, "admin", "authUrl", nil)
	msQuer(t, "sem linha", fmt.Sprint(st, " ", j["error"]), "500 falha_interna")
}
