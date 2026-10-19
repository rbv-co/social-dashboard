package banco_test

import (
	"context"
	"os"
	"slices"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// trechoDe00010 devolve o SQL do Up ou do Down de 00010 sem as diretivas do goose, para rodar à mão.
func trechoDe00010(t *testing.T, up bool) string {
	t.Helper()
	b, err := os.ReadFile("migracoes/00010_robos_saude_por_variante.sql")
	if err != nil {
		t.Fatal(err)
	}
	partes := strings.SplitN(string(b), "-- +goose Down", 2)
	if len(partes) != 2 {
		t.Fatal("a migration precisa de Up e Down")
	}
	s := partes[1]
	if up {
		s = partes[0]
	}
	var linhas []string
	for _, l := range strings.Split(s, "\n") {
		if !strings.HasPrefix(strings.TrimSpace(l), "-- +goose") {
			linhas = append(linhas, l)
		}
	}
	return strings.Join(linhas, "\n")
}

func saudeDosRobos(t *testing.T, p *pgxpool.Pool) []string {
	t.Helper()
	linhas, err := p.Query(context.Background(), `select row_to_json(v)::text from robos_saude v order by v.critico desc, v.robo`)
	if err != nil {
		t.Fatal(err)
	}
	defer linhas.Close()
	var out []string
	for linhas.Next() {
		var s string
		if err := linhas.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out = append(out, s)
	}
	return out
}

// A view nova tem de devolver EXATAMENTE o que a de 2026-09-22 devolve (a tela de saúde e o aviso de robô parado
// leem as duas do mesmo jeito), em todos os desenhos de histórico que a regra distingue; Up repetido é seguro e o
// Down volta à de antes.
func TestRobosSaudePorVarianteDaIgualARegraAntiga(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	testebanco.TabelasDosPaineis(t, p) // robos_esperados + a view de produção (2026-09-22)
	if _, err := p.Exec(ctx, `
insert into robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
  ('coleta', 24, true, 'pai'),               -- tem variantes vivas, uma delas com ficha própria
  ('coleta-lenta', 72, false, 'ficha própria: prefixo mais longo'),
  ('so-falha', 24, true, null),              -- viva e nunca deu certo
  ('morto', 24, false, 'x'),                 -- só histórico antigo, com sucesso atrasado
  ('morto-nunca', 24, false, 'x'),           -- só histórico antigo, nunca deu certo
  ('vazio', 24, false, 'x'),                 -- sem execução nenhuma
  ('saudavel', 24, false, 'x'),             -- viva e com sucesso recente
  ('misto', 10, false, 'x');                 -- uma variante viva e ok, outra viva sem sucesso, uma morta
insert into robos_execucoes (robo, disparado_em, ok) values
  ('coleta',          now() - interval '1 hour',  true),
  ('coleta-a',        now() - interval '30 hours', true),   -- viva, sucesso atrasado para o teto de 24 h
  ('coleta-a',        now() - interval '2 hours', false),
  ('coleta-lenta',    now() - interval '50 hours', true),   -- dentro do teto de 72 h da ficha própria
  ('coleta-lenta-b',  now() - interval '3 hours', false),
  ('so-falha',        now() - interval '2 hours', false),
  ('so-falha',        now() - interval '1 hour',  false),
  ('morto',           now() - interval '200 hours', true),
  ('morto-nunca',     now() - interval '200 hours', false),
  ('misto-ok',        now() - interval '1 hour',  true),
  ('misto-sem',       now() - interval '1 hour',  false),
  ('misto-velha',     now() - interval '300 hours', true),
  ('saudavel-1',      now() - interval '2 hours', true),
  ('fora-de-ficha',   now() - interval '1 hour',  true);`); err != nil {
		t.Fatal(err)
	}
	antes := saudeDosRobos(t, p)
	situacoes := strings.Join(antes, "\n")
	for _, s := range []string{`"ok"`, `"ATRASADO"`, `"nunca deu certo"`, `"sem registro ainda"`} {
		if !strings.Contains(situacoes, s) {
			t.Fatalf("o cenário não cobre a situação %s:\n%s", s, situacoes)
		}
	}
	if len(antes) != 8 {
		t.Fatalf("linhas = %d, esperava 8 (uma por ficha)", len(antes))
	}

	for range 2 { // Up duas vezes: a segunda não muda nada
		if _, err := p.Exec(ctx, trechoDe00010(t, true)); err != nil {
			t.Fatal(err)
		}
		if depois := saudeDosRobos(t, p); !slices.Equal(depois, antes) {
			t.Fatalf("a view nova devolve outra coisa.\nantes:  %v\ndepois: %v", antes, depois)
		}
	}
	if _, err := p.Exec(ctx, trechoDe00010(t, false)); err != nil {
		t.Fatal(err)
	}
	if depois := saudeDosRobos(t, p); !slices.Equal(depois, antes) {
		t.Fatalf("o Down não restaurou a view.\nantes:  %v\ndepois: %v", antes, depois)
	}
}

// Sem a view (banco novo, só as migrations Go) o Up e o Down não fazem nada e não criam nada.
func TestRobosSaudePorVarianteSemAViewNaoFazNada(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	for _, up := range []bool{true, false} {
		if _, err := p.Exec(ctx, trechoDe00010(t, up)); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	if err := p.QueryRow(ctx, `select count(*) from pg_class where relname in ('robos_saude','robos_esperados')`).Scan(&n); err != nil || n != 0 {
		t.Fatalf("a migration criou algo (%d, %v)", n, err)
	}
}
