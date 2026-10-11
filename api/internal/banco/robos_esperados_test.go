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

const arquivoRobos = "migracoes/00004_robos_esperados_do_worker.sql"

var robosDoWorker = []string{"abandono-de-checkout", "conferir-robos", "enviar-push-frota", "fabrica-purga", "faxina-da-api", "vessel-rd-station"}

// trechoDaMigracao devolve o SQL do Up ou do Down sem as diretivas do goose (o goose roda cada trecho numa
// transação; aqui o teste o executa à mão, quantas vezes quiser).
func trechoDaMigracao(t *testing.T, up bool) string {
	t.Helper()
	b, err := os.ReadFile(arquivoRobos)
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

func robosDoBanco(t *testing.T, p *pgxpool.Pool) []string {
	t.Helper()
	linhas, err := p.Query(context.Background(), `select robo from robos_esperados order by robo`)
	if err != nil {
		t.Fatal(err)
	}
	defer linhas.Close()
	var out []string
	for linhas.Next() {
		var r string
		if err := linhas.Scan(&r); err != nil {
			t.Fatal(err)
		}
		out = append(out, r)
	}
	return out
}

// A tabela vem do dump do Supabase (mesma DDL de 2026-07-31-saude-dos-robos.sql).
const tabelaRobos = `create table robos_esperados (robo text primary key, horas_sem_sucesso_ate int not null,
  critico boolean not null default false, porque text)`

func TestMigracaoDosRobosDoWorkerRodaDuasVezesEPreservaOResto(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelaRobos); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into robos_esperados values ('coletar-dados', 30, true, 'x'), ('estoque-do-site', 1, true, 'y'),
	  ('fabrica-purga', 99, true, 'ficha que o dono já ajustou')`); err != nil {
		t.Fatal(err)
	}
	up := trechoDaMigracao(t, true)
	for range 2 {
		if _, err := p.Exec(ctx, up); err != nil {
			t.Fatal(err)
		}
	}
	quer := append([]string{"coletar-dados"}, robosDoWorker...) // estoque-do-site sai: o core é o único escritor
	slices.Sort(quer)
	if got := robosDoBanco(t, p); !slices.Equal(got, quer) {
		t.Fatalf("robos_esperados = %v, esperava %v", got, quer)
	}
	var h int
	var porque string
	p.QueryRow(ctx, `select horas_sem_sucesso_ate, porque from robos_esperados where robo = 'fabrica-purga'`).Scan(&h, &porque)
	if h != 99 || porque != "ficha que o dono já ajustou" {
		t.Fatalf("a migration sobrescreveu uma ficha existente: %d %q", h, porque)
	}
	var critico int
	p.QueryRow(ctx, `select count(*) from robos_esperados where robo = any($1) and critico`, robosDoWorker).Scan(&critico)
	if critico != 1 { // só a fabrica-purga que já existia como crítica
		t.Fatalf("as fichas novas não são críticas: %d críticas", critico)
	}
}

func TestMigracaoDosRobosDoWorkerSemATabelaNaoFazNada(t *testing.T) {
	p := testebanco.Novo(t) // banco novo, sem o dump do Supabase: a migration 00004 já passou por aqui
	ctx := context.Background()
	if _, err := p.Exec(ctx, trechoDaMigracao(t, true)); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, trechoDaMigracao(t, false)); err != nil {
		t.Fatal(err)
	}
	var existe bool
	p.QueryRow(ctx, `select to_regclass('robos_esperados') is not null`).Scan(&existe)
	if existe {
		t.Fatal("a migration não pode criar a tabela")
	}
}

func TestMigracaoDosRobosDoWorkerDownApagaSoAsSeis(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	p.Exec(ctx, tabelaRobos)
	p.Exec(ctx, `insert into robos_esperados values ('coletar-dados', 30, true, 'x'), ('meta-hora', 4, false, 'y')`)
	if _, err := p.Exec(ctx, trechoDaMigracao(t, true)); err != nil {
		t.Fatal(err)
	}
	if got := robosDoBanco(t, p); len(got) != 8 {
		t.Fatalf("depois do Up: %v", got)
	}
	if _, err := p.Exec(ctx, trechoDaMigracao(t, false)); err != nil {
		t.Fatal(err)
	}
	if got := robosDoBanco(t, p); !slices.Equal(got, []string{"coletar-dados", "meta-hora"}) {
		t.Fatalf("depois do Down: %v", got)
	}
}
