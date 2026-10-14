package arquivos

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// As pessoas do mundo do Storage, cada uma pelo que a regra de bucket lê (papel, módulo, permissions, tipo de sessão).
const (
	idSuper      = "a6200000-0000-4000-a000-000000000001"
	idAdmin      = "a6200000-0000-4000-a000-000000000002"
	idAcessos    = "a6200000-0000-4000-a000-000000000003"
	idConteudo   = "a6200000-0000-4000-a000-000000000004"
	idBancoVer   = "a6200000-0000-4000-a000-000000000005"
	idBancoCri   = "a6200000-0000-4000-a000-000000000006"
	idBancoExc   = "a6200000-0000-4000-a000-000000000007"
	idGestor     = "a6200000-0000-4000-a000-000000000008"
	idLeitor     = "a6200000-0000-4000-a000-000000000009"
	idDesativ    = "a6200000-0000-4000-a000-00000000000a"
	idRoboMeta   = "a6200000-0000-4000-a000-00000000000b" // sessão de SERVIÇO, módulo meta
	idRoboFab    = "a6200000-0000-4000-a000-00000000000c" // sessão de SERVIÇO, módulo meta.fabrica
	idRoboTria   = "a6200000-0000-4000-a000-00000000000d" // sessão de SERVIÇO sem módulo (a triagem de currículos)
	idFabricante = "a6200000-0000-4000-a000-00000000000e" // pessoa com a chave meta.fabrica em permissions (a Fábrica)
)

var pessoas = []mundoteste.Pessoa{
	{Chave: "super", ID: idSuper, Email: "super@x.com", Papel: "viewer", Super: true},
	{Chave: "admin", ID: idAdmin, Email: "admin@x.com", Papel: "admin"},
	{Chave: "acessos", ID: idAcessos, Email: "acessos@x.com", Papel: "viewer", Modulos: []string{"acessos"}},
	{Chave: "conteudo", ID: idConteudo, Email: "conteudo@x.com", Papel: "viewer", Modulos: []string{"conteudo"}},
	{Chave: "banco-ver", ID: idBancoVer, Email: "bv@x.com", Papel: "viewer"},
	{Chave: "banco-criar", ID: idBancoCri, Email: "bc@x.com", Papel: "viewer"},
	{Chave: "banco-excluir", ID: idBancoExc, Email: "be@x.com", Papel: "viewer"},
	{Chave: "gestor", ID: idGestor, Email: "gestor@x.com", Papel: "viewer", Modulos: []string{"meta.gestor"}},
	{Chave: "leitor", ID: idLeitor, Email: "leitor@x.com", Papel: "viewer", Modulos: []string{"meta"}},
	{Chave: "desativado", ID: idDesativ, Email: "fora@x.com", Papel: "admin", Desativado: true},
	{Chave: "robo-meta", ID: idRoboMeta, Email: "rm@x.com", Papel: "viewer", Modulos: []string{"meta"}},
	{Chave: "robo-fabrica", ID: idRoboFab, Email: "rf@x.com", Papel: "viewer", Modulos: []string{"meta"}},
	{Chave: "fabricante", ID: idFabricante, Email: "fab@x.com", Papel: "viewer"},
	{Chave: "robo-triagem", ID: idRoboTria, Email: "rt@x.com", Papel: "viewer"},
}

const permissoes = `
update profiles set permissions = '{"banco": ["ver"]}' where id = '` + idBancoVer + `';
update profiles set permissions = '{"banco": ["ver", "criar"]}' where id = '` + idBancoCri + `';
update profiles set permissions = '{"banco": ["ver", "excluir"]}' where id = '` + idBancoExc + `';
update profiles set permissions = '{"meta.fabrica": ["ver"]}' where id in ('` + idFabricante + `', '` + idRoboFab + `');
`

const segredoDasUrls = "segredo-de-teste-das-urls-assinadas"

type mundo struct {
	*mundoteste.Mundo
	S   *Servico
	Pub http.Handler
	Dir string
	Rel *time.Time
}

// novoMundo: sessões de painel pelo mundoteste, as de serviço criadas à mão (o Store as aceita), as rotas de sessão no
// grupo autenticado e as públicas num roteador à parte (sem sessão).
func novoMundo(t *testing.T, ajusta ...func(*Servico)) *mundo {
	t.Helper()
	dir := t.TempDir()
	s := &Servico{Raiz: dir, Segredo: segredoDasUrls}
	for _, f := range ajusta {
		f(s)
	}
	m := mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: permissoes,
		Impersonadas: map[string][2]string{"impersonado": {idAdmin, idSuper}}}, func(r chi.Router, p *pgxpool.Pool) { s.Montar(r) })
	st := auth.NovoStore(m.P)
	for chave, id := range map[string]string{"robo-meta": idRoboMeta, "robo-fabrica": idRoboFab, "robo-triagem": idRoboTria} {
		tok, err := st.Criar(context.Background(), id, "servico", nil)
		if err != nil {
			t.Fatal(err)
		}
		m.Tok[chave] = tok
	}
	pub := chi.NewRouter()
	s.MontarPublicas(pub)
	return &mundo{Mundo: m, S: s, Pub: pub, Dir: dir}
}

// arq: o corpo de um arquivo de cada tipo (os primeiros bytes são os que o DetectContentType reconhece).
var (
	png  = append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{0}, 64)...)
	jpg  = append([]byte("\xff\xd8\xff\xe0\x00\x10JFIF"), bytes.Repeat([]byte{0}, 64)...)
	pdf  = []byte("%PDF-1.4\n%conteudo do pdf\n")
	mp4  = append([]byte("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom"), bytes.Repeat([]byte{0}, 64)...)
	zip_ = append([]byte("PK\x03\x04"), bytes.Repeat([]byte{0}, 64)...)
	html = []byte("<!doctype html><html><script>alert(1)</script></html>")
)

// envia: PUT /arquivos/{bucket}/{caminho} como `quem`.
func (m *mundo) envia(t testing.TB, quem, bucket, caminho, tipo string, corpo []byte, cab ...string) (int, string) {
	t.Helper()
	r := httptest.NewRequest("PUT", "/arquivos/"+bucket+"/"+caminho, bytes.NewReader(corpo))
	r.Header.Set("Content-Type", tipo)
	for _, c := range cab {
		k, v, _ := strings.Cut(c, ": ")
		r.Header.Set(k, v)
	}
	if quem != "" {
		r.Header.Set("Authorization", "Bearer "+m.Tok[quem])
	}
	w := httptest.NewRecorder()
	m.H.ServeHTTP(w, r)
	return w.Code, w.Body.String()
}

func (m *mundo) pede(t testing.TB, quem, metodo, caminho, corpo string) (int, string, http.Header) {
	t.Helper()
	w := m.Resposta(t, quem, metodo, caminho, corpo)
	return w.Code, w.Body.String(), w.Header()
}

// publico: GET sem sessão no roteador público.
func (m *mundo) publico(t testing.TB, caminho string) (int, string, http.Header) {
	t.Helper()
	w := httptest.NewRecorder()
	m.Pub.ServeHTTP(w, httptest.NewRequest("GET", caminho, nil))
	return w.Code, w.Body.String(), w.Header()
}

// planta grava um arquivo direto no disco do bucket (o que já existia antes do teste).
func (m *mundo) planta(t testing.TB, bucket, caminho string, corpo []byte) {
	t.Helper()
	p := filepath.Join(m.Dir, bucket, filepath.FromSlash(caminho))
	if err := os.MkdirAll(filepath.Dir(p), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(p, corpo, 0o640); err != nil {
		t.Fatal(err)
	}
}

func (m *mundo) existe(bucket, caminho string) bool {
	_, err := os.Stat(filepath.Join(m.Dir, bucket, filepath.FromSlash(caminho)))
	return err == nil
}

func (m *mundo) lê(t testing.TB, bucket, caminho string) []byte {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(m.Dir, bucket, filepath.FromSlash(caminho)))
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// sobras: arquivos temporários de envio que ficaram no disco (têm de ser zero).
func (m *mundo) sobras(t testing.TB) []string {
	t.Helper()
	var l []string
	filepath.WalkDir(m.Dir, func(p string, d os.DirEntry, _ error) error {
		if d != nil && !d.IsDir() && strings.HasPrefix(d.Name(), ".envio-") {
			l = append(l, p)
		}
		return nil
	})
	return l
}

var _ = fmt.Sprint
