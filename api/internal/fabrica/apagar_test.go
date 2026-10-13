package fabrica

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/github"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// ghDeMentira: o GitHub dos testes; guarda cada pedido ("POST /caminho") e responde `status`.
type ghDeMentira struct {
	mu      sync.Mutex
	pedidos []string
	status  int
}

func (g *ghDeMentira) n() int {
	g.mu.Lock()
	defer g.mu.Unlock()
	return len(g.pedidos)
}

func novoGH(t *testing.T) (*ghDeMentira, *github.Cliente) {
	t.Helper()
	g := &ghDeMentira{status: 202}
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		g.mu.Lock()
		g.pedidos = append(g.pedidos, r.Method+" "+r.URL.Path)
		st := g.status
		g.mu.Unlock()
		w.WriteHeader(st)
	}))
	t.Cleanup(s.Close)
	return g, github.ParaTeste(t, "SEGREDO-GH", s.URL)
}

// arquivosDoMundo: <dir>/fabrica-criativos com o arquivo de cada criativo (K1–K4), o .mp4 sem linha
// da C1 e <dir>/fora.txt. semC3: não cria a pasta da C3 (o teste do symlink põe um link no lugar).
func arquivosDoMundo(t *testing.T, semC3 bool) string {
	t.Helper()
	dir := t.TempDir()
	fs := []string{
		C1 + "/produto/s1-avista-1080x1080.png", C1 + "/promo/colecao-1080x1920.png",
		C1 + "/produto/s1-avista-1920x1080.mp4", C2 + "/produto/s2-avista-1080x1080.png", "../fora.txt",
	}
	if !semC3 {
		fs = append(fs, C3+"/produto/s3-avista-1080x1080.png")
	}
	for _, f := range fs {
		p := filepath.Join(dir, "fabrica-criativos", f)
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

func existeEm(p ...string) bool {
	_, err := os.Lstat(filepath.Join(p...))
	return err == nil
}

func mundoApagar(t *testing.T, gh *github.Cliente, arquivos string) *mundoteste.Mundo {
	t.Helper()
	return novoMundo(t, func(r chi.Router, p *pgxpool.Pool) {
		r.With(soFabricante, soSessaoPropria).Post("/fabrica-apagar", (&Apagador{Pool: p, GH: gh, Arquivos: arquivos}).ServeHTTP)
	})
}

// log: captura o slog do processo durante o teste.
func capturarLog(t *testing.T) *bytes.Buffer {
	t.Helper()
	var b bytes.Buffer
	antes := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&b, nil)))
	t.Cleanup(func() { slog.SetDefault(antes) })
	return &b
}

func corpoApagar(id string) string { return `{"campanhaId":"` + id + `"}` }

func existeNoBanco(m *mundoteste.Mundo, t *testing.T, tabela, id string) bool {
	t.Helper()
	return m.Um(t, `select count(*)::text from `+tabela+` where id = '`+id+`'`) == "1"
}

func TestApagar(t *testing.T) {
	t.Run("rodada gerando: banco, run cancelado e pasta; de novo é idempotente", func(t *testing.T) {
		g, gh := novoGH(t)
		dir := arquivosDoMundo(t, false)
		m := mundoApagar(t, gh, dir)
		st, corpo := m.Pedir(t, "fabricante", "POST", "/fabrica-apagar", corpoApagar(C1))
		if st != 200 || strings.TrimSpace(corpo) != `{"ok":true}` {
			t.Fatalf("= %d %s", st, corpo)
		}
		if existeNoBanco(m, t, "fabrica_campanhas", C1) || existeNoBanco(m, t, "fabrica_criativos", K1) || existeNoBanco(m, t, "fabrica_criativos", K2) {
			t.Fatal("C1, K1 e K2 têm de sair do banco")
		}
		if !existeNoBanco(m, t, "fabrica_jobs", J1) {
			t.Fatal("J1 é histórico: fica")
		}
		if existeEm(dir, "fabrica-criativos", C1) {
			t.Fatal("a pasta da rodada (com o .mp4 sem linha) tem de sumir")
		}
		if !existeEm(dir, "fabrica-criativos", C2, "produto", "s2-avista-1080x1080.png") || !existeEm(dir, "fora.txt") {
			t.Fatal("o que é de outra rodada e o que está fora ficam")
		}
		if len(g.pedidos) != 1 || g.pedidos[0] != "POST /repos/rbv-co/social-dashboard/actions/runs/111/cancel" {
			t.Fatalf("pedidos ao GitHub = %v", g.pedidos)
		}
		foto := m.Um(t, fotoDaFabrica)
		st, corpo = m.Pedir(t, "fabricante", "POST", "/fabrica-apagar", corpoApagar(C1))
		if st != 200 || strings.TrimSpace(corpo) != `{"ok":true}` || g.n() != 1 || m.Um(t, fotoDaFabrica) != foto {
			t.Fatalf("segunda chamada = %d %s, pedidos=%d", st, corpo, g.n())
		}
	})

	t.Run("rodada pronta: sem GitHub; criativo e arquivo somem", func(t *testing.T) {
		g, gh := novoGH(t)
		dir := arquivosDoMundo(t, false)
		m := mundoApagar(t, gh, dir)
		if st, corpo := m.Pedir(t, "fabricante", "POST", "/fabrica-apagar", corpoApagar(C2)); st != 200 {
			t.Fatalf("= %d %s", st, corpo)
		}
		if existeNoBanco(m, t, "fabrica_campanhas", C2) || existeNoBanco(m, t, "fabrica_criativos", K3) || g.n() != 0 {
			t.Fatalf("C2/K3 fora do banco e 0 pedidos (pedidos=%d)", g.n())
		}
		if existeEm(dir, "fabrica-criativos", C2) {
			t.Fatal("o arquivo de K3 tem de sumir")
		}
		if !existeEm(dir, "fabrica-criativos", C1, "produto", "s1-avista-1080x1080.png") {
			t.Fatal("arquivo de outra rodada ficou de pé")
		}
	})

	t.Run("caminho vindo do banco fora da raiz nunca é tocado", func(t *testing.T) {
		_, gh := novoGH(t)
		dir := arquivosDoMundo(t, false)
		m := mundoApagar(t, gh, dir)
		for i, c := range []string{"../fora.txt", "/etc/hostname", C2 + "/../../fora.txt"} {
			if _, err := m.P.Exec(context.Background(), `insert into fabrica_criativos (id, campanha_id, arquetipo, template, formato, storage_path, url)
				values ($1::uuid, $2::uuid, 'produto', 'produto-heroi', '1080x1080', $3::text, 'https://midia.x/a.png')`,
				"a5840000-0000-4000-a000-00000000ff0"+string(rune('1'+i)), C2, c); err != nil {
				t.Fatal(err)
			}
		}
		lg := capturarLog(t)
		if st, corpo := m.Pedir(t, "fabricante", "POST", "/fabrica-apagar", corpoApagar(C2)); st != 200 {
			t.Fatalf("= %d %s", st, corpo)
		}
		if existeNoBanco(m, t, "fabrica_campanhas", C2) {
			t.Fatal("o banco apagou")
		}
		if !existeEm(dir, "fora.txt") {
			t.Fatal("dir/fora.txt foi apagado")
		}
		if !strings.Contains(lg.String(), "arquivo não apagado") {
			t.Fatalf("log sem a recusa: %s", lg)
		}
	})

	t.Run("pasta da rodada que é symlink para fora: o alvo fica", func(t *testing.T) {
		_, gh := novoGH(t)
		dir := arquivosDoMundo(t, true)
		alvo := filepath.Join(dir, "externo", "produto", "s3-avista-1080x1080.png")
		if err := os.MkdirAll(filepath.Dir(alvo), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(alvo, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(filepath.Join(dir, "externo"), filepath.Join(dir, "fabrica-criativos", C3)); err != nil {
			t.Fatal(err)
		}
		m := mundoApagar(t, gh, dir)
		if st, corpo := m.Pedir(t, "fabricante", "POST", "/fabrica-apagar", corpoApagar(C3)); st != 200 {
			t.Fatalf("= %d %s", st, corpo)
		}
		if existeNoBanco(m, t, "fabrica_campanhas", C3) {
			t.Fatal("o banco apagou")
		}
		if !existeEm(alvo) {
			t.Fatal("o arquivo fora da raiz sumiu pelo symlink")
		}
	})

	t.Run("negados: GitHub 0, foto igual, arquivos no lugar", func(t *testing.T) {
		g, gh := novoGH(t)
		dir := arquivosDoMundo(t, false)
		m := mundoApagar(t, gh, dir)
		foto := m.Um(t, fotoDaFabrica)
		for quem, quer := range map[string]struct {
			st  int
			tem string
		}{
			"leitor": {403, ""}, "semModulo": {403, ""}, "roboSemFabrica": {403, ""},
			"impersonado": {403, "Quem entrou como outra pessoa só consulta."}, "desativado": {401, ""},
		} {
			st, corpo := m.Pedir(t, quem, "POST", "/fabrica-apagar", corpoApagar(C1))
			if st != quer.st || !strings.Contains(corpo, quer.tem) {
				t.Errorf("%s = %d %s, esperava %d %q", quem, st, corpo, quer.st, quer.tem)
			}
		}
		if g.n() != 0 || m.Um(t, fotoDaFabrica) != foto {
			t.Fatalf("negado teve efeito: pedidos=%d", g.n())
		}
		for _, f := range []string{C1 + "/produto/s1-avista-1080x1080.png", C1 + "/produto/s1-avista-1920x1080.mp4", C2 + "/produto/s2-avista-1080x1080.png"} {
			if !existeEm(dir, "fabrica-criativos", f) {
				t.Fatalf("%s sumiu", f)
			}
		}
	})

	t.Run("corpo", func(t *testing.T) {
		g, gh := novoGH(t)
		m := mundoApagar(t, gh, arquivosDoMundo(t, false))
		foto := m.Um(t, fotoDaFabrica)
		for corpo, quer := range map[string]string{
			`{}`: `campanhaId_obrigatorio`, `{"campanhaId":""}`: `campanhaId_obrigatorio`, `{"campanhaId":null}`: `campanhaId_obrigatorio`,
			`{"campanhaId":"x"}`: `campanhaId_invalido`,
		} {
			st, resp := m.Pedir(t, "fabricante", "POST", "/fabrica-apagar", corpo)
			if st != 400 || !strings.Contains(resp, quer) {
				t.Errorf("%s = %d %s", corpo, st, resp)
			}
		}
		st, resp := m.Pedir(t, "fabricante", "POST", "/fabrica-apagar", corpoApagar("a5830000-0000-4000-a000-0000000000ee"))
		if st != 200 || strings.TrimSpace(resp) != `{"ok":true}` || g.n() != 0 || m.Um(t, fotoDaFabrica) != foto {
			t.Fatalf("inexistente = %d %s pedidos=%d", st, resp, g.n())
		}
	})

	t.Run("banco que falha no meio: nada some, nem o arquivo", func(t *testing.T) {
		g, gh := novoGH(t)
		dir := arquivosDoMundo(t, false)
		m := mundoApagar(t, gh, dir)
		if _, err := m.P.Exec(context.Background(), `create function recusa_c2() returns trigger language plpgsql as
			$$ begin if old.id = '`+C2+`' then raise exception 'recusado de teste'; end if; return old; end $$;
			create trigger recusa_c2 before delete on fabrica_campanhas for each row execute function recusa_c2()`); err != nil {
			t.Fatal(err)
		}
		st, _ := m.Pedir(t, "fabricante", "POST", "/fabrica-apagar", corpoApagar(C2))
		if st == 200 {
			t.Fatal("o banco falhou e a resposta foi 200")
		}
		if !existeNoBanco(m, t, "fabrica_campanhas", C2) || !existeNoBanco(m, t, "fabrica_criativos", K3) || g.n() != 0 {
			t.Fatal("C2 e K3 têm de continuar no banco")
		}
		if !existeEm(dir, "fabrica-criativos", C2, "produto", "s2-avista-1080x1080.png") {
			t.Fatal("o arquivo de K3 saiu antes do commit")
		}
	})

	t.Run("disco e GitHub fora: o banco manda", func(t *testing.T) {
		_, gh := novoGH(t)
		lg := capturarLog(t)
		m := mundoApagar(t, gh, filepath.Join(t.TempDir(), "não-existe"))
		if st, corpo := m.Pedir(t, "fabricante", "POST", "/fabrica-apagar", corpoApagar(C2)); st != 200 {
			t.Fatalf("disco fora = %d %s", st, corpo)
		}
		if existeNoBanco(m, t, "fabrica_campanhas", C2) || !strings.Contains(lg.String(), "pasta-base inacessível") {
			t.Fatalf("C2 fora do banco e o log diz a causa: %s", lg)
		}

		g, gh := novoGH(t)
		g.status = 500
		m = mundoApagar(t, gh, arquivosDoMundo(t, false))
		if st, corpo := m.Pedir(t, "fabricante", "POST", "/fabrica-apagar", corpoApagar(C1)); st != 200 {
			t.Fatalf("GitHub fora = %d %s", st, corpo)
		}
		if existeNoBanco(m, t, "fabrica_campanhas", C1) || g.n() != 1 {
			t.Fatalf("C1 fora do banco, 1 tentativa de cancelamento (pedidos=%d)", g.n())
		}
	})
}
