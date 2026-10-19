package banco_test

import (
	"context"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const esquemaDoAbandono = `
create table checkout_abandono (
  token text primary key, email text, telefone text, nome text, total numeric, moeda text, url_de_recuperacao text,
  status text not null default 'aguardando' check (status in ('aguardando','fila_envio','pagamento_pendente','comprou')),
  iniciado_em timestamptz not null default now(), ultimo_evento_em timestamptz not null default now(),
  fila_envio_em timestamptz, comprou_em timestamptz, comprou_depois boolean not null default false);
create table mensagem_fila (tipo text not null, chave text not null, nome text, telefone text, url_de_recuperacao text,
  mensagem_status text, primary key (tipo, chave));`

// funcaoDoSupabase fatia uma função SQL de db/migrations (o DDL de produção) e a põe no schema do teste: tira o
// `public.` e o `set search_path`, que apontariam para fora do schema isolado.
func funcaoDoSupabase(t *testing.T, arquivo, nome string) string {
	t.Helper()
	b, err := os.ReadFile("../../../db/migrations/" + arquivo)
	if err != nil {
		t.Fatal(err)
	}
	s := string(b)
	i := strings.Index(s, "create or replace function public."+nome+"(")
	if i < 0 {
		t.Fatalf("%s não tem a função %s", arquivo, nome)
	}
	s = s[i:]
	s = s[:strings.Index(s, "\n$$;")+4]
	return noSchemaDoTeste(s)
}

func noSchemaDoTeste(s string) string {
	return strings.ReplaceAll(strings.ReplaceAll(s, "set search_path = public", ""), "public.", "")
}

// trechoDe00011 devolve o SQL do Up ou do Down da 00011 sem as diretivas do goose, já no schema do teste.
func trechoDe00011(t *testing.T, up bool) string {
	t.Helper()
	b, err := os.ReadFile("migracoes/00011_abandono_compra_sem_linha.sql")
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
	return noSchemaDoTeste(strings.Join(linhas, "\n"))
}

func abandonoComFuncoesAntigas(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p := testebanco.Novo(t)
	ctx := context.Background()
	for _, sql := range []string{
		esquemaDoAbandono,
		funcaoDoSupabase(t, "2026-09-30-zzzz-abandono-sem-duplicidade.sql", "fone11"),
		funcaoDoSupabase(t, "2026-09-30-zzzz-abandono-sem-duplicidade.sql", "marcar_checkout_comprou"),
		funcaoDoSupabase(t, "2026-09-30-zzzzzzz-checkout-iniciado-com-link.sql", "registrar_checkout_abandono"),
	} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	return p
}

func contar(t *testing.T, p *pgxpool.Pool, sql string, args ...any) int {
	t.Helper()
	var n int
	if err := p.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// o cenário do 04-M1: o pedido pago chega ANTES do checkouts/update, que então chega atrasado.
func compraAntesDoCheckout(t *testing.T, p *pgxpool.Pool, token string) {
	t.Helper()
	ctx := context.Background()
	if _, err := p.Exec(ctx, `select marcar_checkout_comprou($1, 'ana@x.com', '+55 (11) 98888-7777')`, token); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `select registrar_checkout_abandono($1, 'ana@x.com', '11988887777', 'Ana', 10, 'BRL', 'https://x/c')`, token); err != nil {
		t.Fatal(err)
	}
}

func TestComprouAntesDoCheckoutNaoViraRecuperacao(t *testing.T) {
	p := abandonoComFuncoesAntigas(t)
	ctx := context.Background()

	// antes: a compra não deixa rastro e o evento atrasado cria `aguardando` + mensagem de recuperação (o defeito).
	compraAntesDoCheckout(t, p, "velho")
	if n := contar(t, p, `select count(*) from checkout_abandono where token='velho' and status='aguardando'`); n != 1 {
		t.Fatalf("a função antiga deveria reproduzir o defeito (aguardando=%d)", n)
	}
	if n := contar(t, p, `select count(*) from mensagem_fila where chave='velho'`); n != 1 {
		t.Fatalf("a função antiga deveria enfileirar a recuperação (fila=%d)", n)
	}

	// depois: Up (duas vezes: repetição segura).
	for i := 0; i < 2; i++ {
		if _, err := p.Exec(ctx, trechoDe00011(t, true)); err != nil {
			t.Fatalf("Up %d: %v", i+1, err)
		}
	}
	compraAntesDoCheckout(t, p, "novo")
	var status, email, fone string
	var comprouEm *string
	var depois bool
	if err := p.QueryRow(ctx, `select status, email, telefone, comprou_em::text, comprou_depois from checkout_abandono where token='novo'`).
		Scan(&status, &email, &fone, &comprouEm, &depois); err != nil {
		t.Fatal(err)
	}
	if status != "comprou" || comprouEm == nil || depois || email != "ana@x.com" || fone != "+55 (11) 98888-7777" {
		t.Fatalf("linha da compra errada: %s %v %v %s %s", status, comprouEm, depois, email, fone)
	}
	if n := contar(t, p, `select count(*) from mensagem_fila where chave='novo'`); n != 0 {
		t.Fatalf("quem já comprou não recebe recuperação (fila=%d)", n)
	}

	// o mesmo pedido chegando de novo não muda o instante da compra.
	var antes, depoisDe string
	p.QueryRow(ctx, `select comprou_em::text from checkout_abandono where token='novo'`).Scan(&antes)
	if _, err := p.Exec(ctx, `select marcar_checkout_comprou('novo', 'ana@x.com', null)`); err != nil {
		t.Fatal(err)
	}
	p.QueryRow(ctx, `select comprou_em::text from checkout_abandono where token='novo'`).Scan(&depoisDe)
	if antes != depoisDe {
		t.Fatalf("comprou_em mudou na repetição: %s -> %s", antes, depoisDe)
	}

	// Down volta ao comportamento antigo.
	if _, err := p.Exec(ctx, trechoDe00011(t, false)); err != nil {
		t.Fatal(err)
	}
	compraAntesDoCheckout(t, p, "volta")
	if n := contar(t, p, `select count(*) from mensagem_fila where chave='volta'`); n != 1 {
		t.Fatalf("o Down deveria voltar ao defeito antigo (fila=%d)", n)
	}
}

func TestCompraPorEmailETelefoneEToken(t *testing.T) {
	p := abandonoComFuncoesAntigas(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, trechoDe00011(t, true)); err != nil {
		t.Fatal(err)
	}
	// outro checkout aberto da mesma pessoa (e-mail e telefone) e um já em fila_envio: ambos viram `comprou`.
	for _, sql := range []string{
		`insert into checkout_abandono (token, email, telefone, status) values ('a', 'ANA@x.com ', null, 'aguardando')`,
		`insert into checkout_abandono (token, email, telefone, status) values ('b', null, '(11) 98888-7777', 'fila_envio')`,
		`insert into checkout_abandono (token, email, telefone, status) values ('c', 'outra@x.com', null, 'aguardando')`,
		`select marcar_checkout_comprou('pago', 'ana@x.com', '11988887777')`,
	} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	if n := contar(t, p, `select count(*) from checkout_abandono where token in ('a','b','pago') and status='comprou'`); n != 3 {
		t.Fatalf("a compra deveria fechar os 3 checkouts da pessoa (fechou %d)", n)
	}
	if n := contar(t, p, `select count(*) from checkout_abandono where token='b' and comprou_depois`); n != 1 {
		t.Fatal("quem estava em fila_envio precisa ficar com comprou_depois")
	}
	if n := contar(t, p, `select count(*) from checkout_abandono where token='c' and status='aguardando'`); n != 1 {
		t.Fatal("o checkout de outra pessoa não pode ser tocado")
	}
	// sem token (pedido sem checkout_token): não cria linha, só fecha os da pessoa.
	if _, err := p.Exec(ctx, `select marcar_checkout_comprou(null, 'outra@x.com', null)`); err != nil {
		t.Fatal(err)
	}
	if n := contar(t, p, `select count(*) from checkout_abandono`); n != 4 {
		t.Fatalf("token nulo não pode inserir linha (total %d)", n)
	}
	if n := contar(t, p, `select count(*) from checkout_abandono where token='c' and status='comprou'`); n != 1 {
		t.Fatal("a compra sem token deveria fechar o checkout da pessoa por e-mail")
	}
}

// numa base sem as funções do Supabase (testes, instalação nova) a migration não faz nada e não cria nenhuma.
func TestAbandonoCompraSemLinhaSemObjetosNaoFazNada(t *testing.T) {
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), trechoDe00011(t, true)); err != nil {
		t.Fatal(err)
	}
	if n := contar(t, p, `select count(*) from pg_proc where proname = 'marcar_checkout_comprou' and pronamespace = current_schema()::regnamespace`); n != 0 {
		t.Fatal("a migration não deve criar a função onde ela não existia")
	}
}

// A 00011 mexe numa função que vem do dump: na virada o `migrar` roda antes do schema.sql e ela seria no-op. O
// restaurar.sh precisa reaplicá-la depois dos dados.
func TestRestaurarReaplicaAMigrationDoAbandono(t *testing.T) {
	b, err := os.ReadFile("../../../ops/migracao/restaurar.sh")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(b), "00011_abandono_compra_sem_linha") {
		t.Fatal("restaurar.sh não reaplica a 00011 depois dos dados")
	}
}
