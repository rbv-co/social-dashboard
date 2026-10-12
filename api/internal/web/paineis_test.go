package web

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// pessoasDosPaineis: as de fixtureUsuarios (nenhum, so-meta, so-social, so-sales, admin) mais as que
// separam as regras do 5.12. Cria também as tabelas do escopo e as do 5.12. Devolve nome → token.
func pessoasDosPaineis(t *testing.T, p *pgxpool.Pool, s *auth.Store) map[string]string {
	t.Helper()
	toks := fixtureUsuarios(t, p, s)
	testebanco.TabelasDoEscopo(t, p)
	testebanco.TabelasDosPaineis(t, p)
	ctx := context.Background()
	extras := []struct {
		nome, tipo, papel, features, permissions string
		super, desativado                        bool
	}{
		{"super", "painel", "viewer", "{}", "{}", true, false},
		{"status", "painel", "viewer", "{claude.status}", `{"claude.status":["ver"]}`, false, false},
		{"so-permissao", "painel", "viewer", "{}", `{"claude.status":["ver"]}`, false, false},
		{"admin-desativado", "painel", "admin", "{}", "{}", false, true},
		{"cliente", "cliente", "", "", "", false, false}, // cliente da Vessel: sem perfil
	}
	for i, x := range extras {
		id := fmt.Sprintf("51200000-0000-4000-a000-%012d", i+1)
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, id, x.nome+"@p512.x"); err != nil {
			t.Fatal(err)
		}
		if x.tipo == "painel" {
			if _, err := p.Exec(ctx, `insert into profiles (id, email, role, is_superadmin, features, permissions, disabled, escopo_por_equipe)
				values ($1::uuid, $2::text, $3::text, $4::boolean, $5::text[], $6::jsonb, $7::boolean, false)`,
				id, x.nome+"@p512.x", x.papel, x.super, x.features, x.permissions, x.desativado); err != nil {
				t.Fatal(err)
			}
		}
		tok, err := s.Criar(ctx, id, x.tipo, nil)
		if err != nil {
			t.Fatal(err)
		}
		toks[x.nome] = tok
	}
	return toks
}

// lerDosPaineis faz GET caminho com o token (vazio = sem sessão) e devolve status e corpo.
func lerDosPaineis(h http.Handler, caminho, tok string) (int, string) {
	r := httptest.NewRequest("GET", caminho, nil)
	if tok != "" {
		r.Header.Set("Authorization", "Bearer "+tok)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code, strings.TrimSpace(w.Body.String())
}

// semearPaineis: 3 rodadas de notícias (5 linhas), 2 panoramas e 2 execuções de IA.
func semearPaineis(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	_, err := p.Exec(context.Background(), `
insert into noticias_concorrentes (marca, titulo, rodada, destaque, created_at, produtos) values
 ('Santa Lolla', 'A1', '2026-09-29', false, '2026-09-29 10:00+00', null),
 ('Schutz', 'B1', '2026-10-06', false, '2026-10-06 10:00+00', null),
 ('Schutz', 'B2', '2026-10-06', true,  '2026-10-06 09:00+00', '[{"nome":"Bolsa X","preco":199.9}]'),
 ('Mercado', 'C1', '2026-10-06', false, '2026-10-06 11:00+00', null),
 ('Arezzo&Co', 'D1', '2026-09-22', false, '2026-09-22 10:00+00', null);
insert into noticias_panorama (rodada, conteudo_md, modelo, uso, created_at) values
 ('2026-09-29', '# Panorama', 'claude-opus-4-8', '{"in":1}', '2026-09-29 12:00+00'),
 ('2026-10-06', '# Panorama', 'claude-opus-4-8', '{"in":1}', '2026-10-06 12:00+00');
insert into ia_execucoes (run_at, robo, acao, usd) values
 ('2026-10-06 12:00+00', 'noticias', 'panorama', 0.1234),
 ('2026-10-05 12:00+00', 'noticias', 'coleta', 0.05);`)
	if err != nil {
		t.Fatal(err)
	}
}

func TestPaineisPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	toks := pessoasDosPaineis(t, p, s)
	semearPaineis(t, p)

	// Por papel: as 4 rotas respondem igual a quem tem sessão de painel (policy `true`).
	for _, caminho := range []string{"/noticias/rodadas", "/noticias/concorrentes", "/noticias/panorama", "/status-ia/execucoes"} {
		if c, _ := lerDosPaineis(h, caminho, ""); c != 401 {
			t.Errorf("%s sem sessão = %d, esperava 401", caminho, c)
		}
		for quem, quer := range map[string]int{"cliente": 403, "admin-desativado": 401} {
			if c, _ := lerDosPaineis(h, caminho, toks[quem]); c != quer {
				t.Errorf("%s como %s = %d, esperava %d", caminho, quem, c, quer)
			}
		}
		var ref string
		for _, quem := range []string{"nenhum", "admin", "super", "status"} {
			c, corpo := lerDosPaineis(h, caminho, toks[quem])
			if c != 200 {
				t.Errorf("%s como %s = %d, esperava 200 (%s)", caminho, quem, c, corpo)
			}
			if ref == "" {
				ref = corpo
			} else if corpo != ref {
				t.Errorf("%s como %s: linhas diferentes das de 'nenhum'", caminho, quem)
			}
		}
	}

	compacto := func(s string) string {
		var b bytes.Buffer
		if err := json.Compact(&b, []byte(s)); err != nil {
			t.Fatalf("JSON inválido: %v (%s)", err, s)
		}
		return b.String()
	}
	titulos := func(corpo string) string {
		var l []map[string]any
		if err := json.Unmarshal([]byte(corpo), &l); err != nil {
			t.Fatal(err)
		}
		var ts []string
		for _, m := range l {
			ts = append(ts, m["titulo"].(string))
		}
		return strings.Join(ts, ",")
	}

	ok := []struct{ caminho, corpo string }{
		{"/noticias/rodadas?limite=2", `[{"rodada":"2026-10-06"},{"rodada":"2026-09-29"}]`},
		{"/noticias/panorama?limite=1", `[{"rodada":"2026-10-06","conteudo_md":"# Panorama","modelo":"claude-opus-4-8","created_at":"2026-10-06T12:00:00+00:00"}]`},
	}
	for _, c := range ok {
		code, corpo := lerDosPaineis(h, c.caminho, toks["nenhum"])
		if code != 200 || compacto(corpo) != compacto(c.corpo) {
			t.Errorf("%s = %d %s\nesperava %s", c.caminho, code, corpo, c.corpo)
		}
	}

	code, corpo := lerDosPaineis(h, "/noticias/concorrentes?rodada=2026-10-06,2026-09-29", toks["nenhum"])
	if code != 200 || titulos(corpo) != "B2,C1,B1,A1" {
		t.Errorf("concorrentes por rodada = %d, títulos %q, esperava B2,C1,B1,A1", code, titulos(corpo))
	}
	var linhas []map[string]any
	json.Unmarshal([]byte(corpo), &linhas)
	b2, _ := json.Marshal(linhas[0])
	for _, trecho := range []string{`"produtos":[{"nome":"Bolsa X","preco":199.9}]`, `"destaque":true`, `"rodada":"2026-10-06"`, `"created_at":"2026-10-06T09:00:00+00:00"`} {
		if !strings.Contains(string(b2), trecho) {
			t.Errorf("B2 sem %s: %s", trecho, b2)
		}
	}
	code, corpo = lerDosPaineis(h, "/noticias/concorrentes", toks["nenhum"])
	if code != 200 || titulos(corpo) != "B2,C1,B1,A1,D1" {
		t.Errorf("concorrentes sem filtro = %d, títulos %q, esperava B2,C1,B1,A1,D1", code, titulos(corpo))
	}

	for _, caminho := range []string{
		"/noticias/concorrentes?rodada=2026-13-40", "/noticias/concorrentes?rodada=2026-10-06'--",
		"/noticias/concorrentes?marca=Schutz", "/noticias/concorrentes?ordem=titulo",
		"/noticias/concorrentes?rodada=2026-10-06&rodada=2026-09-29", "/noticias/concorrentes?limite=1001",
		"/noticias/rodadas?ordem=rodada", "/noticias/panorama?uso=x", "/status-ia/execucoes?robo=noticias",
	} {
		if c, corpo := lerDosPaineis(h, caminho, toks["nenhum"]); c != 400 || !strings.Contains(corpo, "pedido_invalido") {
			t.Errorf("%s = %d %s, esperava 400 pedido_invalido", caminho, c, corpo)
		}
	}

	code, corpo = lerDosPaineis(h, "/status-ia/execucoes?limite=1", toks["nenhum"])
	if code != 200 || !strings.Contains(corpo, `"usd":0.1234`) || !strings.Contains(corpo, `"run_at":"2026-10-06T12:00:00+00:00"`) || strings.Count(corpo, `"robo"`) != 1 {
		t.Errorf("execuções limite=1 = %d %s", code, corpo)
	}
	r := httptest.NewRequest("GET", "/status-ia/execucoes?contar=1&limite=1", nil)
	r.Header.Set("Authorization", "Bearer "+toks["nenhum"])
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if w.Code != 200 || w.Header().Get("X-Total-Count") != "2" {
		t.Errorf("contar = %d, X-Total-Count %q, esperava 2", w.Code, w.Header().Get("X-Total-Count"))
	}
}
