package worker

import (
	"context"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func TestConferirRobos(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `insert into robos_execucoes (robo, disparado_em, ok, resposta, conferido_em) values
		('pendente-velha', now() - interval '7 hours', null, null, null),
		('pendente-nova', now() - interval '1 hour', null, null, null),
		('pendente-5h', now() - interval '5 hours', null, null, null),
		('conferida-velha', now() - interval '7 hours', true, 'ok', now() - interval '7 hours'),
		('vencida', now() - interval '61 days', true, 'ok', now() - interval '61 days'),
		('quase-vencida', now() - interval '59 days', true, 'ok', now() - interval '59 days')`); err != nil {
		t.Fatal(err)
	}
	if err := ConferirRobos(p).Executar(ctx); err != nil {
		t.Fatal(err)
	}
	estado := func(robo string) (existe bool, resp string, conferida bool) {
		err := p.QueryRow(ctx, `select coalesce(resposta, ''), conferido_em is not null from robos_execucoes where robo = $1`, robo).Scan(&resp, &conferida)
		return err == nil, resp, conferida
	}
	if _, resp, c := estado("pendente-velha"); !c || resp != "a resposta foi apagada pelo pg_net antes da conferencia" {
		t.Fatalf("pendente com mais de 6 h: conferida=%v resp=%q", c, resp)
	}
	if _, _, c := estado("pendente-nova"); c {
		t.Fatal("pendente com menos de 6 h não se mexe")
	}
	if _, _, c := estado("pendente-5h"); c {
		t.Fatal("pendente há 5 h ainda não passou do limite de 6 h")
	}
	if _, resp, _ := estado("conferida-velha"); resp != "ok" {
		t.Fatalf("linha já conferida nunca é reescrita: %q", resp)
	}
	if existe, _, _ := estado("vencida"); existe {
		t.Fatal("mais de 60 dias é apagada")
	}
	if existe, _, _ := estado("quase-vencida"); !existe {
		t.Fatal("59 dias fica")
	}
}

func TestFaxinaDaAPI(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	const u = "dddddddd-0000-0000-0000-000000000001"
	if _, err := p.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'f@x')`, u); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into sessoes (token_hash, usuario_id, expira_em) values
		('vencida', $1::uuid, now() - interval '1 minute'), ('valida', $1::uuid, now() + interval '1 hour')`, u); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into webhooks_recebidos (origem, evento_id, recebido_em) values
		('pedido', 'velho', now() - interval '31 days'), ('pedido', 'novo', now() - interval '29 days')`); err != nil {
		t.Fatal(err)
	}
	if _, err := p.Exec(ctx, `insert into envios_feitos (chave, feito_em) values
		('velha', now() - interval '46 days'), ('nova', now() - interval '44 days')`); err != nil {
		t.Fatal(err)
	}
	if err := FaxinaDaAPI(p).Executar(ctx); err != nil {
		t.Fatal(err)
	}
	var sessoes, webhooks, envios string
	p.QueryRow(ctx, `select string_agg(token_hash, ',') from sessoes`).Scan(&sessoes)
	p.QueryRow(ctx, `select string_agg(evento_id, ',') from webhooks_recebidos`).Scan(&webhooks)
	p.QueryRow(ctx, `select string_agg(chave, ',') from envios_feitos`).Scan(&envios)
	if sessoes != "valida" || webhooks != "novo" || envios != "nova" {
		t.Fatalf("sessoes=%q webhooks=%q envios=%q", sessoes, webhooks, envios)
	}
}

func TestAgendasDaManutencao(t *testing.T) {
	for _, c := range []struct {
		t            Tarefa
		nome, agenda string
	}{
		{ConferirRobos(nil), "conferir-robos", "2-59/5 * * * *"},
		{FaxinaDaAPI(nil), "faxina-da-api", "41 5 * * *"},
	} {
		if c.t.Nome != c.nome || c.t.Agenda != c.agenda || c.t.Limite <= 0 || c.t.Limite > 5*time.Minute {
			t.Errorf("%+v", c.t)
		}
	}
}
