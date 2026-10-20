//go:build prod

package web

// Plano 03 do esforço POS-VIRADA-2026-10: a matriz ROTA × PERFIL e as entradas hostis contra o endereço PÚBLICO de
// produção (nginx + API Go), em vez do httptest. Fora do `go test ./...` de propósito (build tag `prod`): precisa
// de contas de prova `zz-prova-*` (ferramentas/prova03-contas.sh) e escreve em produção só o mínimo.
//
//	PROD_BASE=https://central.rbvcompany.com PROD_TOKENS=tokens.json PROD_OUT=03-evidencias \
//	  go test -tags prod -count=1 -run 'TestProd' -v ./internal/web
//
// Regras de segurança do teste (a lição de 12/10: "teste de 403" não pode gravar):
//   - o ESPERADO é o de `esperado` (matriz_seguranca_test.go), decidido pela regra e não pelo comportamento atual;
//   - rota que grava só recebe pedido de perfil que o portão TEM de barrar, com id inexistente e corpo malformado
//     (400 se o portão falhar, nunca gravação); perfil que passaria o portão só envia em escrita COM parâmetro
//     de caminho (id inexistente → 404);
//   - nenhum token é impresso.

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

const corpoMalformado = `{"zz-prova-03`

var reParam = regexp.MustCompile(`\{[^}]+\}|\*`)

// prodCorposValidos: as três rotas cujo portão depende do corpo (ver corposValidos), com caminhos zz-prova.
var prodCorposValidos = map[string]string{
	"POST /bling-proxy":              `{"endpoint":"pedidos/vendas"}`,
	"DELETE /arquivos/{bucket}":      `{"caminhos":["zz-prova/a.txt"]}`,
	"POST /arquivos/{bucket}/copiar": `{"de":"zz-prova/a.txt","para":"zz-prova/b.txt"}`,
}

func prodBase(t *testing.T) string {
	b := strings.TrimRight(os.Getenv("PROD_BASE"), "/")
	if b == "" {
		t.Fatal("defina PROD_BASE")
	}
	return b
}

func prodTokens(t *testing.T) map[string]string {
	raw, err := os.ReadFile(os.Getenv("PROD_TOKENS"))
	if err != nil {
		t.Fatal(err)
	}
	m := map[string]string{}
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	return m
}

func prodOut(t *testing.T) string {
	d := os.Getenv("PROD_OUT")
	if d == "" {
		t.Fatal("defina PROD_OUT")
	}
	_ = os.MkdirAll(d, 0o755)
	return d
}

// urlPublica: o que o nginx expõe direto (mesmo caminho) e o que fica sob /api (o prefixo cai no proxy).
func urlPublica(base, caminho string) string {
	for _, p := range []string{"/arquivos", "/storage/", "/rest/v1/rpc/", "/functions/v1/"} {
		if strings.HasPrefix(caminho, p) {
			return base + caminho
		}
	}
	return base + "/api" + caminho
}

// substitui troca os parâmetros do caminho por valores inexistentes; com `bucketReal` o {bucket} vira o bucket de
// verdade (só para quem o portão TEM de barrar: o 404 do bucket inexistente viria antes do 403 e não provaria nada).
func substitui(rota string, bucketReal bool) string {
	return reParam.ReplaceAllStringFunc(rota, func(m string) string {
		switch m {
		case "{id}":
			return "00000000-0000-4000-8000-000000000000"
		case "{nome}":
			return "nome-inexistente"
		case "{bucket}":
			if bucketReal {
				return "arquivos"
			}
		case "*":
			return "zz-prova/x.txt"
		}
		return "zz-prova-inexistente"
	})
}

// rotasDoRoteador: as chaves da matriz. TestMatrizRotaPorPerfil (rodada em CI) garante que elas são exatamente as
// rotas de chi.Walk; aqui não dá para montar Rotas() sem banco.
func rotasDoRoteador(t *testing.T) []string {
	out := make([]string, 0, len(matriz))
	for k := range matriz {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}

var cliente = &http.Client{Timeout: 45 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

type resposta struct {
	status int
	ctype  string
	corpo  string
	acao   string // Access-Control-Allow-Origin
	erro   string
}

func pedir(metodo, url, token, corpo, ctype string, extra map[string]string) resposta {
	var rd io.Reader
	if corpo != "" {
		rd = strings.NewReader(corpo)
	}
	r, err := http.NewRequest(metodo, url, rd)
	if err != nil {
		return resposta{erro: err.Error()}
	}
	if ctype != "" {
		r.Header.Set("Content-Type", ctype)
	}
	r.Header.Set("Origin", "https://evil.example")
	r.Header.Set("User-Agent", "zz-prova-03")
	if token != "" {
		r.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range extra {
		r.Header.Set(k, v)
	}
	for tent := 0; ; tent++ {
		resp, err := cliente.Do(r.Clone(r.Context()))
		if err != nil {
			if tent < 1 && rd == nil {
				time.Sleep(time.Second)
				continue
			}
			return resposta{erro: err.Error()}
		}
		b, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
		resp.Body.Close()
		return resposta{status: resp.StatusCode, ctype: resp.Header.Get("Content-Type"), corpo: string(b), acao: resp.Header.Get("Access-Control-Allow-Origin")}
	}
}

var vazamentos = []string{"$2a$", "goroutine ", "panic:", "SQLSTATE", "pgx", "/internal/", ".go:", "runtime error", "pq: "}

func achaVazamento(corpo string) string {
	for _, v := range vazamentos {
		if strings.Contains(corpo, v) {
			return v
		}
	}
	return ""
}

// enviar decide se o pedido é seguro em produção (ver o cabeçalho do arquivo).
func enviar(l linha, pf string, temParam bool, chave string) bool {
	if chave == "POST /auth/sair" { // a matriz o chama de leitura, mas ele REVOGA a sessão: só quem o portão barra o envia
		return pf == "anonimo" || pf == "cliente"
	}
	if _, ok := prodCorposValidos[chave]; ok && l.g != gPublica && pf != "anonimo" && pf != "cliente" && pf != "impersonado" && pf != "sem-permissao" {
		return false // bling-proxy etc.: chamariam o serviço externo de verdade
	}
	switch {
	case l.e == rwL, l.g == gPublica:
		return true
	case pf == "anonimo", pf == "cliente", pf == "impersonado":
		return true
	case pf == "sem-permissao" && (l.g == gModulo || l.g == gDominio):
		return true
	}
	return temParam
}

type linhaCSV struct {
	chave, perfil, corpo         string
	st1, st2                     int
	ctype, regra, obs            string
	enviado, ok, alcancavel, rep bool
	forma                        string
}

// formaDoCorpo resume o corpo SEM copiar dado: tipo e tamanho (para achar "200 com linhas" para quem não devia ver nada).
func formaDoCorpo(corpo string) string {
	c := strings.TrimSpace(corpo)
	var v any
	if c == "" {
		return "vazio"
	}
	if json.Unmarshal([]byte(c), &v) != nil {
		return fmt.Sprintf("texto(%d)", len(c))
	}
	switch x := v.(type) {
	case nil:
		return "vazio"
	case []any:
		if len(x) == 0 {
			return "vazio"
		}
		return fmt.Sprintf("array[%d]", len(x))
	case map[string]any:
		if len(x) == 0 {
			return "vazio"
		}
		return fmt.Sprintf("objeto{%d}", len(x))
	}
	return "escalar"
}

func perfisBase() []string {
	return []string{"anonimo", "cliente", "sem-permissao", "impersonado", "superadmin", "servico"}
}

func nomePerfil(p string) perfil {
	switch p {
	case "anonimo":
		return pAnon
	case "cliente":
		return pCli
	case "sem-permissao":
		return pSem
	case "impersonado":
		return pImp
	case "superadmin":
		return pSuper
	case "servico":
		return pServ
	}
	return perfil(p)
}

func TestProdMatriz(t *testing.T) {
	base, tok, out := prodBase(t), prodTokens(t), prodOut(t)
	chaves := rotasDoRoteador(t)
	extras := []string{"admin", "todos-modulos"}
	for k := range tok {
		if strings.HasPrefix(k, "mod:") {
			extras = append(extras, k)
		}
	}
	sort.Strings(extras)
	type job struct {
		chave, pf string
		l         linha
	}
	var jobs []job
	for _, c := range chaves {
		l, ok := matriz[c]
		if !ok {
			t.Errorf("%s: rota sem linha na matriz", c)
			continue
		}
		pfs := append(append([]string{}, perfisBase()...), extras...)
		if l.g == gPublica {
			pfs = []string{"anonimo"}
		}
		for _, pf := range pfs {
			jobs = append(jobs, job{c, pf, l})
		}
	}
	var mu sync.Mutex
	var res []linhaCSV
	var wg sync.WaitGroup
	ch := make(chan job)
	for w := 0; w < 4; w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range ch {
				metodo, rota, _ := strings.Cut(j.chave, " ")
				temParam := reParam.MatchString(rota)
				lc := linhaCSV{chave: j.chave, perfil: j.pf, alcancavel: true}
				if !enviar(j.l, j.pf, temParam, j.chave) {
					lc.obs = "NÃO ENVIADO: escrita real em produção"
					mu.Lock()
					res = append(res, lc)
					mu.Unlock()
					continue
				}
				lc.enviado = true
				corpo, ct := "", ""
				if metodo != "GET" && metodo != "HEAD" {
					ct = "application/json"
					corpo = corpoMalformado // o portão vem antes do corpo: 400 = passou, nenhum handler grava
					if cv, ok := prodCorposValidos[j.chave]; ok && (j.pf == "anonimo" || j.pf == "cliente" || j.pf == "impersonado" || j.pf == "sem-permissao") {
						corpo = cv // o portão fino está DENTRO do handler e depende do corpo; nomes zz-prova, e só barrados enviam
					}
					lc.corpo = corpo
				}
				token := tok[j.pf]
				if j.pf == "anonimo" {
					token = ""
				}
				u := urlPublica(base, substitui(rota, j.pf == "anonimo" || j.pf == "cliente" || j.pf == "impersonado"))
				var rs [2]resposta
				for i := range rs {
					rs[i] = pedir(metodo, u, token, corpo, ct, nil)
				}
				lc.st1, lc.st2, lc.ctype, lc.forma = rs[0].status, rs[1].status, rs[0].ctype, formaDoCorpo(rs[0].corpo)
				lc.rep = rs[0].status == rs[1].status
				var falhas []string
				if rs[0].erro != "" {
					falhas = append(falhas, "erro de rede: "+rs[0].erro)
				}
				if strings.HasPrefix(rs[0].ctype, "text/html") && rs[0].status == 200 && strings.Contains(rs[0].corpo, "<div id=\"root\">") {
					lc.alcancavel = false
					lc.obs = "SPA do nginx (rota não é exposta no endereço público)"
				}
				if rs[0].acao == "*" || strings.Contains(rs[0].acao, "evil") {
					falhas = append(falhas, "CORS para origem hostil: "+rs[0].acao)
				}
				if v := achaVazamento(rs[0].corpo); v != "" {
					falhas = append(falhas, "corpo com "+v)
				}
				if rs[0].status >= 500 {
					falhas = append(falhas, fmt.Sprintf("5xx %d", rs[0].status))
				}
				if !lc.rep {
					falhas = append(falhas, fmt.Sprintf("repetição diferente %d x %d", rs[0].status, rs[1].status))
				}
				pf := nomePerfil(j.pf)
				if lc.alcancavel && rs[0].erro == "" {
					switch {
					case strings.HasPrefix(j.pf, "mod:"), j.pf == "admin":
						lc.regra = "só registro (sem esperado fixo)"
					case j.pf == "todos-modulos":
						lc.regra = "só registro (viewer com todos os módulos; rota que exige papel admin/permissão além do módulo o barra)"
					default:
						if ok, regra := esperado(j.l, pf, rs[0].status); !ok {
							lc.regra = regra
							falhas = append(falhas, fmt.Sprintf("status %d, esperava: %s", rs[0].status, regra))
						}
					}
				}
				lc.ok = len(falhas) == 0
				if len(falhas) > 0 {
					lc.obs = strings.Join(falhas, "; ")
				}
				mu.Lock()
				res = append(res, lc)
				mu.Unlock()
			}
		}()
	}
	for _, j := range jobs {
		ch <- j
	}
	close(ch)
	wg.Wait()
	sort.Slice(res, func(i, j int) bool {
		if res[i].chave != res[j].chave {
			return res[i].chave < res[j].chave
		}
		return res[i].perfil < res[j].perfil
	})
	f, err := os.Create(filepath.Join(out, "matriz-prod.csv"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	w := csv.NewWriter(f)
	_ = w.Write([]string{"rota", "perfil", "enviado", "corpo", "status1", "status2", "igual2x", "ctype", "alcancavel", "ok", "forma", "obs"})
	var env, bad, naoAlc int
	for _, r := range res {
		_ = w.Write([]string{r.chave, r.perfil, fmt.Sprint(r.enviado), r.corpo, fmt.Sprint(r.st1), fmt.Sprint(r.st2), fmt.Sprint(r.rep), r.ctype, fmt.Sprint(r.alcancavel), fmt.Sprint(r.ok), r.forma, r.obs})
		if r.enviado {
			env++
			if !r.ok {
				bad++
				t.Errorf("%s como %s: %s", r.chave, r.perfil, r.obs)
			}
			if !r.alcancavel {
				naoAlc++
			}
		}
	}
	w.Flush()
	t.Logf("rotas=%d linhas=%d enviadas=%d desvios=%d nao-alcancaveis=%d", len(chaves), len(res), env, bad, naoAlc)
}

// TestProdRPC: as 90+ funções de /rest/v1/rpc/{nome} por perfil, sempre com corpo malformado (o portão vem antes do
// corpo; função nenhuma executa) salvo as três listas de leitura, que devolvem `[]` ao viewer sem nada.
func TestProdRPC(t *testing.T) {
	base, tok, out := prodBase(t), prodTokens(t), prodOut(t)
	var linhas []string
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for _, f := range FuncoesRPC {
		wg.Add(1)
		sem <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-sem }()
			u := base + "/api/rpc/" + f.Nome
			p := func(pf string) int {
				tk := tok[pf]
				return pedir("POST", u, tk, corpoMalformado, "application/json", nil).status
			}
			anon, cli, sm, imp, sup := p("anonimo"), p("cliente"), p("sem-permissao"), p("impersonado"), p("superadmin")
			var falhas []string
			if anon != 401 {
				falhas = append(falhas, fmt.Sprintf("anônimo %d (esperava 401)", anon))
			}
			if cli != 403 {
				falhas = append(falhas, fmt.Sprintf("cliente %d (esperava 403)", cli))
			}
			if rpcsQueDevolvemVazio[f.Nome] {
				r := pedir("POST", u, tok["sem-permissao"], `{"p_codigo":"CODIGO-QUALQUER"}`, "application/json", nil)
				if r.status != 200 || strings.TrimSpace(r.corpo) != "[]" {
					falhas = append(falhas, fmt.Sprintf("sem-permissão %d %.40s (esperava 200 [])", r.status, r.corpo))
				}
			} else if sm != 403 {
				falhas = append(falhas, fmt.Sprintf("viewer sem nada %d (esperava 403)", sm))
			}
			if f.SoSessaoPropria && imp != 403 {
				falhas = append(falhas, fmt.Sprintf("entrar-como em função que grava %d (esperava 403)", imp))
			}
			if !f.SoSessaoPropria && (imp == 403 || imp == 401) {
				falhas = append(falhas, fmt.Sprintf("entrar-como em função de leitura %d", imp))
			}
			if sup == 401 || sup == 403 {
				falhas = append(falhas, fmt.Sprintf("superadmin %d", sup))
			}
			l := fmt.Sprintf("%s,grava=%v,anon=%d,cliente=%d,sem=%d,imp=%d,super=%d,%s", f.Nome, f.SoSessaoPropria, anon, cli, sm, imp, sup, strings.Join(falhas, "; "))
			mu.Lock()
			linhas = append(linhas, l)
			mu.Unlock()
			if len(falhas) > 0 {
				t.Errorf("rpc %s: %s", f.Nome, strings.Join(falhas, "; "))
			}
		}()
	}
	wg.Wait()
	sort.Strings(linhas)
	_ = os.WriteFile(filepath.Join(out, "rpc-prod.csv"), []byte("rpc,grava,anon,cliente,sem,imp,super,desvios\n"+strings.Join(linhas, "\n")+"\n"), 0o644)
	t.Logf("rpc: %d funções", len(linhas))
}

// TestProdPublicasHostis: toda rota pública com assinatura inválida, corpo grande, tipo errado e método errado:
// nunca 5xx e nunca 2xx para pedido sem credencial (webhook/aceite com assinatura falsa).
func TestProdPublicasHostis(t *testing.T) {
	base, out := prodBase(t), prodOut(t)
	var linhas []string
	grande := strings.Repeat("A", 6<<20)
	medio := strings.Repeat("B", 1536<<10)
	hdrsFalsos := map[string]string{
		"X-Shopify-Hmac-Sha256": "Zm9yamFkbw==", "X-Hub-Signature-256": "sha256=00", "X-Chatwoot-Signature": "sha256=00",
		"Authorization": "Bearer errado", "X-Webhook-Secret": "errado", "X-Cron-Secret": "errado",
	}
	for _, chave := range rotasDoRoteador(t) {
		l := matriz[chave]
		if l.g != gPublica {
			continue
		}
		metodo, rota, _ := strings.Cut(chave, " ")
		u := urlPublica(base, substitui(rota, false))
		type v struct {
			nome, metodo, corpo, ct string
			hd                      map[string]string
		}
		var vars []v
		if metodo != "GET" {
			vars = append(vars,
				v{"sem-assinatura-json", metodo, `{"zz":"zz-prova-03"}`, "application/json", nil},
				v{"assinatura-falsa", metodo, `{"zz":"zz-prova-03"}`, "application/json", hdrsFalsos},
				v{"replay-assinatura-falsa", metodo, `{"zz":"zz-prova-03"}`, "application/json", map[string]string{"X-Shopify-Hmac-Sha256": "Zm9yamFkbw==", "X-Shopify-Webhook-Id": "zz-prova-03-replay", "X-Shopify-Topic": "orders/create"}},
				v{"texto", metodo, "zz-prova-03", "text/plain", nil},
				v{"xml", metodo, "<a>zz-prova-03</a>", "application/xml", nil},
				v{"form", metodo, "a=zz-prova-03", "application/x-www-form-urlencoded", nil},
				v{"sem-content-type", metodo, `{"zz":1}`, "", nil},
				v{"json-quebrado", metodo, corpoMalformado, "application/json", nil},
				v{"colchetes", metodo, strings.Repeat("[", 20000), "application/json", nil},
				v{"nul-e-unicode", metodo, "{\"a\":\"\x00\xff\xfe\u202e\"}", "application/json", nil},
				v{"corpo-1.5MB", metodo, medio, "application/json", nil},
				v{"corpo-6MB", metodo, grande, "application/json", nil},
			)
		}
		for _, m := range []string{"GET", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE"} {
			if m != metodo {
				vars = append(vars, v{"metodo-" + m, m, "", "", nil})
			}
		}
		for _, x := range vars {
			r := pedir(x.metodo, u, "", x.corpo, x.ct, x.hd)
			var falhas []string
			if r.erro != "" && !strings.Contains(r.erro, "broken pipe") && !strings.Contains(r.erro, "reset") && !strings.Contains(r.erro, "EOF") {
				falhas = append(falhas, "rede: "+r.erro)
			}
			if r.status >= 500 {
				falhas = append(falhas, fmt.Sprintf("5xx %d", r.status))
			}
			credencial := strings.HasPrefix(chave, "POST /receber-") || strings.Contains(chave, "webhook")
			if credencial && r.status >= 200 && r.status < 300 && x.metodo == "POST" && !strings.HasPrefix(r.ctype, "text/html") {
				falhas = append(falhas, fmt.Sprintf("2xx (%d) para pedido sem credencial válida", r.status))
			}
			if v := achaVazamento(r.corpo); v != "" {
				falhas = append(falhas, "corpo com "+v)
			}
			if r.acao == "*" || strings.Contains(r.acao, "evil") {
				falhas = append(falhas, "CORS hostil "+r.acao)
			}
			linhas = append(linhas, fmt.Sprintf("%s,%s,%d,%s", chave, x.nome, r.status, strings.Join(falhas, "; ")))
			if len(falhas) > 0 {
				t.Errorf("%s [%s] = %d: %s", chave, x.nome, r.status, strings.Join(falhas, "; "))
			}
		}
	}
	_ = os.WriteFile(filepath.Join(out, "publicas-hostis.csv"), []byte("rota,variante,status,desvios\n"+strings.Join(linhas, "\n")+"\n"), 0o644)
	t.Logf("públicas hostis: %d pedidos", len(linhas))
}

// lerTudo: como pedir, mas sem o teto de 64 KB (o isolamento compara conjuntos de linhas inteiros).
func lerTudo(url, token string) (int, []byte) {
	r, _ := http.NewRequest("GET", url, nil)
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("User-Agent", "zz-prova-03")
	resp, err := cliente.Do(r)
	if err != nil {
		return 0, nil
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(resp.Body, 32<<20))
	return resp.StatusCode, b
}

// contasNoJSON junta os valores de account_id (e o id da própria linha de /redes/contas) de todo objeto do documento.
func contasNoJSON(v any, out map[string]bool, cabecalhoContas bool) {
	switch x := v.(type) {
	case []any:
		for _, e := range x {
			contasNoJSON(e, out, cabecalhoContas)
		}
	case map[string]any:
		if s, ok := x["account_id"].(string); ok && s != "" {
			out[s] = true
		}
		if s, ok := x["ad_account"].(string); ok && s != "" {
			out[s] = true
		}
		if cabecalhoContas {
			if s, ok := x["id"].(string); ok {
				out[s] = true
			}
		}
		for k, e := range x {
			if k != "account_id" && k != "id" {
				contasNoJSON(e, out, false)
			}
		}
	}
}

// TestProdIsolamentoContas: B do plano. Em cada GET de listagem, quem só tem a conta A não vê linha da conta B (e vice-versa);
// quem tem allowed_accounts vazio não vê linha de conta nenhuma. Controle positivo: o superadmin vê as duas.
func TestProdIsolamentoContas(t *testing.T) {
	base, tok, out := prodBase(t), prodTokens(t), prodOut(t)
	A, B := os.Getenv("PROD_CONTA_A"), os.Getenv("PROD_CONTA_B") // ids de accounts que a ferramenta de contas gravou em allowed_accounts
	if A == B {
		t.Fatal("as duas contas de prova apontam para a mesma conta")
	}
	var linhas []string
	cobertas, totalRotas := 0, 0
	for _, chave := range rotasDoRoteador(t) {
		metodo, rota, _ := strings.Cut(chave, " ")
		l := matriz[chave]
		// /redes/contas é o catálogo das contas, aberto a qualquer sessão ativa pela policy auth_read_accounts (RLS de produção)
		if metodo != "GET" || reParam.MatchString(rota) || l.e != rwL || l.g == gPublica || l.g == gRobo || rota == "/auth/eu" || rota == "/redes/contas" {
			continue
		}
		totalRotas++
		u := base + "/api" + rota
		vistos := map[string]map[string]bool{}
		st := map[string]int{}
		for _, pf := range []string{"superadmin", "conta-a", "conta-b", "conta-0"} {
			code, b := lerTudo(u, tok[pf])
			st[pf] = code
			vistos[pf] = map[string]bool{}
			var v any
			if json.Unmarshal(b, &v) == nil {
				contasNoJSON(v, vistos[pf], rota == "/redes/contas")
			}
		}
		for id := range vistos["conta-a"] {
			if id != A {
				t.Errorf("S1? %s: conta-a (só %s) viu a conta %s", rota, A, id)
			}
		}
		for id := range vistos["conta-b"] {
			if id != B {
				t.Errorf("S1? %s: conta-b (só %s) viu a conta %s", rota, B, id)
			}
		}
		if len(vistos["conta-0"]) > 0 {
			t.Errorf("S1? %s: conta sem nenhuma conta viu %d contas", rota, len(vistos["conta-0"]))
		}
		if len(vistos["superadmin"]) >= 2 {
			cobertas++
		}
		linhas = append(linhas, fmt.Sprintf("%s,super=%d(%d contas),a=%d(%d),b=%d(%d),zero=%d(%d)", rota, st["superadmin"], len(vistos["superadmin"]), st["conta-a"], len(vistos["conta-a"]), st["conta-b"], len(vistos["conta-b"]), st["conta-0"], len(vistos["conta-0"])))
	}
	sort.Strings(linhas)
	resumo := fmt.Sprintf("rotas GET de listagem varridas=%d; em que o superadmin vê 2 contas ou mais (controle positivo: nelas o isolamento foi de fato exercido)=%d\n", totalRotas, cobertas)
	_ = os.WriteFile(filepath.Join(out, "cruzado.txt"), []byte(resumo+"rota,super,conta-a,conta-b,conta-0\n"+strings.Join(linhas, "\n")+"\n"), 0o644)
	t.Log(resumo)
	if cobertas < 5 {
		t.Errorf("só %d rotas carregam as duas contas no superadmin: o teste de isolamento não prova o suficiente", cobertas)
	}
}
