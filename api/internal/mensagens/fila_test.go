package mensagens

import (
	"context"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Esboços das funções de produção com as MESMAS assinaturas (levantamento 02-funções.csv): anotam os
// argumentos recebidos. Provam nomes, argumentos nomeados e tipos da chamada do Go — a regra continua
// na função de verdade do banco restaurado.
const filaDeTeste = checkoutAbandono + `
create table mensagem_fila (tipo text not null, chave text not null, numero text, nome text, telefone text, url_de_recuperacao text,
  conversa_origem bigint, criado_em timestamptz not null default now(), mensagem_status text, mensagem_reservada_em timestamptz,
  mensagem_enviada_em timestamptz, mensagem_motivo text, mensagem_tentativas int not null default 0, chatwoot_conversation_id bigint,
  primary key (tipo, chave));
create table contatos_sem_mensagem (telefone text primary key, motivo text, criado_em timestamptz not null default now());
create table chamadas (id bigserial primary key, nome text, args text);
create function anotar(n text, a text) returns void language sql as $$ insert into chamadas (nome, args) values (n, a) $$;
create function pegar_para_mensagem(p_limite integer, p_atraso_min integer, p_reservar boolean default true, p_ultimos11 text[] default null, p_max_horas integer default 24)
returns setof checkout_abandono language plpgsql as $$ begin
  perform anotar('pegar_para_mensagem', format('%s %s %s %s %s', p_limite, p_atraso_min, p_reservar, coalesce(p_ultimos11::text, 'nulo'), p_max_horas));
  return query select * from checkout_abandono where status = 'fila_envio' order by token; end $$;
create function pegar_da_fila(p_tipo text, p_limite integer, p_max_horas integer, p_reservar boolean default true, p_ultimos11 text[] default null)
returns setof mensagem_fila language plpgsql as $$ begin
  perform anotar('pegar_da_fila', format('%s %s %s %s %s', p_tipo, p_limite, p_max_horas, p_reservar, coalesce(p_ultimos11::text, 'nulo')));
  return query select * from mensagem_fila where tipo = p_tipo order by chave; end $$;
create function marcar_mensagem(p_token text, p_status text, p_motivo text default null, p_conversa bigint default null) returns void
  language sql as $$ select anotar('marcar_mensagem', format('%s %s %s %s', p_token, p_status, coalesce(p_motivo, 'nulo'), coalesce(p_conversa::text, 'nulo'))) $$;
create function marcar_da_fila(p_tipo text, p_chave text, p_status text, p_motivo text default null, p_conversa bigint default null) returns void
  language sql as $$ select anotar('marcar_da_fila', format('%s %s %s %s %s', p_tipo, p_chave, p_status, coalesce(p_motivo, 'nulo'), coalesce(p_conversa::text, 'nulo'))) $$;
create function devolver_mensagem(p_token text, p_contar boolean) returns void
  language sql as $$ select anotar('devolver_mensagem', format('%s %s', p_token, p_contar)) $$;
create function devolver_da_fila(p_tipo text, p_chave text, p_contar boolean) returns void
  language sql as $$ select anotar('devolver_da_fila', format('%s %s %s', p_tipo, p_chave, p_contar)) $$;
create function liberar_mensagens_travadas() returns integer language sql as $$ select anotar('liberar_mensagens_travadas', ''); select 0 $$;
create function liberar_travadas_da_fila() returns integer language sql as $$ select anotar('liberar_travadas_da_fila', ''); select 0 $$;
create function agendar_followups(p_apos_horas integer default 48, p_teto_horas integer default 24) returns integer
  language sql as $$ select anotar('agendar_followups', format('%s %s', p_apos_horas, p_teto_horas)); select 0 $$;
create function avaliar_trava_cruzada(p_telefone text, p_horas integer default 20, p_tipo text default null, p_chave text default null) returns text
  language sql as $$ select anotar('avaliar_trava_cruzada', format('%s %s %s %s', p_telefone, p_horas, p_tipo, p_chave));
  select case p_telefone when '5511900000001' then 'barrar' when '5511900000002' then 'talvez' else 'liberar' end $$;`

func chamadasSQL(t *testing.T, p *pgxpool.Pool) []string {
	t.Helper()
	linhas, _ := p.Query(context.Background(), `select nome || ': ' || args from chamadas order by id`)
	defer linhas.Close()
	var out []string
	for linhas.Next() {
		var s string
		linhas.Scan(&s)
		out = append(out, s)
	}
	return out
}

func TestFilaSQLChamaAsFuncoesDeProducao(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, filaDeTeste); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `insert into checkout_abandono (token, telefone, nome, url_de_recuperacao, status, iniciado_em) values
		('tok1', '11987654321', 'Ana', 'https://l/x', 'fila_envio', '2026-10-10T12:00:00Z'), ('tok2', null, null, null, 'comprou', now())`)
	p.Exec(ctx, `insert into mensagem_fila (tipo, chave, numero, telefone, conversa_origem, criado_em) values
		('pedido', 'p1', '#1001', '11987654321', null, '2026-10-10T12:00:00Z'), ('followup', 'f1', null, '11987654322', 55, now())`)
	p.Exec(ctx, `insert into contatos_sem_mensagem (telefone) values ('5511987654321')`)
	f := filaSQL{p}
	if err := f.liberarMensagensTravadas(ctx); err != nil {
		t.Fatal(err)
	}
	ab, err := f.pegarParaMensagem(ctx, 10, 0, true, nil, 24)
	if err != nil || len(ab) != 1 || ab[0].Token != "tok1" || *ab[0].Nome != "Ana" || !ab[0].IniciadoEm.Equal(time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("ab=%+v err=%v", ab, err)
	}
	fl, err := f.pegarDaFila(ctx, "pedido", 5, 2, false, []string{"11987654321"})
	if err != nil || len(fl) != 1 || *fl[0].Numero != "#1001" || fl[0].ConversaOrigem != nil {
		t.Fatalf("fl=%+v err=%v", fl, err)
	}
	conv := int64(77)
	f.marcarMensagem(ctx, "tok1", "enviada", "", &conv)
	f.marcarDaFila(ctx, "pedido", "p1", "ignorada", "sem_telefone", nil)
	f.devolverMensagem(ctx, "tok1", true)
	f.devolverDaFila(ctx, "followup", "f1", false)
	f.liberarTravadasDaFila(ctx)
	f.agendarFollowups(ctx, 48, 24)
	quer := []string{
		"liberar_mensagens_travadas: ", "pegar_para_mensagem: 10 0 t nulo 24", "pegar_da_fila: pedido 5 2 f {11987654321}",
		"marcar_mensagem: tok1 enviada nulo 77", "marcar_da_fila: pedido p1 ignorada sem_telefone nulo",
		"devolver_mensagem: tok1 t", "devolver_da_fila: followup f1 f", "liberar_travadas_da_fila: ", "agendar_followups: 48 24",
	}
	if got := chamadasSQL(t, p); !slices.Equal(got, quer) {
		t.Fatalf("chamadas =\n%s", strings.Join(got, "\n"))
	}
	if b, err := f.bloqueados(ctx, []string{"5511987654321", "5511900000009"}); err != nil || !b["5511987654321"] || b["5511900000009"] {
		t.Fatalf("bloqueados=%v err=%v", b, err)
	}
	if st, _ := f.statusDoCheckout(ctx, "tok2"); st != "comprou" {
		t.Fatalf("status=%q", st)
	}
	if st, err := f.statusDoCheckout(ctx, "nao-existe"); st != "" || err != nil {
		t.Fatalf("sem linha = vazio, não erro: %q %v", st, err)
	}
	for tel, quer := range map[string]string{"5511900000001": "barrar", "5511900000002": "erro", "5511900000003": "liberar"} {
		if got := f.travaCruzada(ctx, tel, "abandono", "tok1"); got != quer {
			t.Errorf("trava %s = %s", tel, got)
		}
	}
	p.Exec(ctx, `drop function avaliar_trava_cruzada(text, integer, text, text)`)
	if got := f.travaCruzada(ctx, "5511900000003", "", ""); got != "erro" {
		t.Fatalf("falha ao consultar a trava não libera: %s", got)
	}
}

// Ponta a ponta pelo banco: o robô com a filaSQL, o Chatwoot de mentira e os esboços.
func TestMensagensPeloBanco(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, filaDeTeste); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `insert into checkout_abandono (token, telefone, nome, url_de_recuperacao, status, iniciado_em) values
		('tok1', '11987654321', 'MARIA', 'https://loja.com/checkouts/abc?key=1', 'fila_envio', now() - interval '1 hour')`)
	cw, _ := novoChatwoot(t, nil)
	cfg := configLigada(cw)
	desligar(&cfg, "abandono")
	m := &Mensagens{Pool: p, Cfg: cfg, Agora: func() time.Time { return agoraDentro }}
	if err := m.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	got := chamadasSQL(t, p)
	if !slices.Contains(got, "marcar_mensagem: tok1 enviada nulo 77") || !slices.Contains(got, "avaliar_trava_cruzada: 5511987654321 20 abandono tok1") {
		t.Fatalf("chamadas =\n%s", strings.Join(got, "\n"))
	}
}

// Cada chamada ao banco tem prazo próprio (a gravação roda sem o contexto da tarefa, e uma consulta pendurada
// seguraria a trava do worker para sempre).
func TestFilaSQLTemPrazoNoBanco(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, filaDeTeste); err != nil {
		t.Fatal(err)
	}
	p.Exec(ctx, `create or replace function liberar_mensagens_travadas() returns integer language sql as $$ select 0 from pg_sleep(3) $$;
		create or replace function agendar_followups(p_apos_horas integer default 48, p_teto_horas integer default 24) returns integer language sql as $$ select 0 from pg_sleep(3) $$`)
	antigo := prazoBanco
	prazoBanco = 200 * time.Millisecond
	defer func() { prazoBanco = antigo }()
	inicio := time.Now()
	f := filaSQL{p}
	if err := f.liberarMensagensTravadas(ctx); err == nil {
		t.Fatal("devia estourar o prazo")
	}
	if err := f.agendarFollowups(ctx, 48, 24); err == nil {
		t.Fatal("devia estourar o prazo")
	}
	if d := time.Since(inicio); d > 2*time.Second {
		t.Fatalf("levou %s", d)
	}
}
