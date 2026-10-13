// Package mundoteste monta o mundo de teste das rotas de domínio: o esquema de produção (D0), as
// pessoas com perfil e sessão, as linhas do domínio e as rotas atrás da MESMA cadeia do grupo de
// domínio de web.Rotas (auth.Exigir → autz.ComEscopo), SEM o comPrazo(PrazoDominio) da produção
// (Ruling 5.1-12: o prazo não é o que estes testes medem). Extraído do 5.1 (acesso/mundo_test.go) no 5.2,
// como o 5.1 previa. Não fica em testebanco: os testes internos de autz importam testebanco, e
// testebanco importando autz seria ciclo (Ruling 5.2-13).
package mundoteste

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Pessoa vira uma linha em usuarios e em profiles e uma sessão de painel. Trava = escopo_por_equipe;
// Contas nil = allowed_accounts nulo (vê todas as contas); Modulos = features.
type Pessoa struct {
	Chave, ID, Email, Papel  string
	Super, Trava, Desativado bool
	Modulos, Contas          []string
}

type Opcoes struct {
	Pessoas []Pessoa
	Linhas  string // SQL do domínio, rodado sem identidade depois das pessoas
	// Impersonadas: chave da sessão → {id do alvo, id de quem entrou como ele}. Quem entrou como ele
	// tem de ser uma Pessoa com Super: true (o auth.Store exige super pela ficha).
	Impersonadas map[string][2]string
}

type Mundo struct {
	P   *pgxpool.Pool
	H   http.Handler
	Tok map[string]string
}

// Novo monta o mundo num banco novo (testebanco.ComEsquemaDeProducao).
func Novo(t *testing.T, o Opcoes, montar ...func(chi.Router, *pgxpool.Pool)) *Mundo {
	t.Helper()
	p := testebanco.ComEsquemaDeProducao(t)
	ctx := context.Background()
	s := auth.NovoStore(p)
	m := &Mundo{P: p, Tok: map[string]string{}}
	for _, x := range o.Pessoas {
		modulos := x.Modulos
		if modulos == nil {
			modulos = []string{}
		}
		if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, $2::text)`, x.ID, x.Email); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into profiles (id, email, name, role, is_superadmin, escopo_por_equipe,
			  allowed_accounts, features, disabled)
			values ($1::uuid, $2::text, $3::text, $4::text, $5::boolean, $6::boolean, $7::uuid[], $8::text[], $9::boolean)`,
			x.ID, x.Email, x.Chave, x.Papel, x.Super, x.Trava, x.Contas, modulos, x.Desativado); err != nil {
			t.Fatal(err)
		}
		tok, err := s.Criar(ctx, x.ID, "painel", nil)
		if err != nil {
			t.Fatal(err)
		}
		m.Tok[x.Chave] = tok
	}
	for chave, par := range o.Impersonadas {
		por := par[1]
		tok, err := s.Criar(ctx, par[0], "painel", &por)
		if err != nil {
			t.Fatal(err)
		}
		m.Tok[chave] = tok
	}
	if o.Linhas != "" {
		if _, err := p.Exec(ctx, o.Linhas); err != nil {
			t.Fatal(err)
		}
	}
	r := chi.NewRouter()
	r.Group(func(r chi.Router) {
		r.Use(auth.Exigir(p, s))
		r.Use(autz.ComEscopo(p))
		for _, f := range montar {
			f(r, p)
		}
	})
	m.H = r
	return m
}

// Resposta faz a requisição como `quem` ("" = sem sessão).
func (m *Mundo) Resposta(t testing.TB, quem, metodo, caminho, corpo string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(metodo, caminho, strings.NewReader(corpo))
	if quem != "" {
		tok, ok := m.Tok[quem]
		if !ok {
			t.Fatalf("pessoa %q fora do mundo", quem)
		}
		r.Header.Set("Authorization", "Bearer "+tok)
	}
	w := httptest.NewRecorder()
	m.H.ServeHTTP(w, r)
	return w
}

func (m *Mundo) Pedir(t testing.TB, quem, metodo, caminho, corpo string) (int, string) {
	t.Helper()
	w := m.Resposta(t, quem, metodo, caminho, corpo)
	return w.Code, w.Body.String()
}

// Um roda uma consulta de UMA coluna ::text (nulo = "<nulo>").
func (m *Mundo) Um(t testing.TB, sql string, args ...any) string {
	t.Helper()
	var v *string
	if err := m.P.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	if v == nil {
		return "<nulo>"
	}
	return *v
}

// Caso: uma requisição e o que tem de sair dela. Efeito/Quer: consulta rodada DEPOIS (o "negado não
// grava"); caso sem Metodo só confere o efeito.
type Caso struct {
	Nome, Quem, Metodo, Caminho, Corpo string
	Status                             int
	Tem, NaoTem                        string
	Efeito, Quer                       string
}

func (m *Mundo) Rodar(t testing.TB, casos []Caso) {
	t.Helper()
	for _, c := range casos {
		if c.Metodo != "" {
			st, corpo := m.Pedir(t, c.Quem, c.Metodo, c.Caminho, c.Corpo)
			if st != c.Status || (c.Tem != "" && !strings.Contains(corpo, c.Tem)) || (c.NaoTem != "" && strings.Contains(corpo, c.NaoTem)) {
				t.Errorf("%s: %s %s como %q = %d %s; esperava %d com %q e sem %q", c.Nome, c.Metodo, c.Caminho, c.Quem, st, corpo, c.Status, c.Tem, c.NaoTem)
			}
		}
		if c.Efeito != "" {
			if v := m.Um(t, c.Efeito); v != c.Quer {
				t.Errorf("%s: efeito %q = %q, esperava %q", c.Nome, c.Efeito, v, c.Quer)
			}
		}
	}
}
