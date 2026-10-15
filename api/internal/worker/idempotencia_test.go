package worker

import (
	"context"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Plano 03-B: as tarefas de manutenção re-executadas (o worker reinicia no meio, o dono roda à mão) deixam
// o banco no MESMO estado da primeira execução: a segunda e a terceira não apagam a mais nem reescrevem.
func TestManutencaoReexecutadaDeixaOMesmoEstado(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	const u = "dddddddd-0000-0000-0000-000000000002"
	for _, sql := range []string{
		`insert into usuarios (id, email) values ('` + u + `', 'g@x')`,
		`insert into sessoes (token_hash, usuario_id, expira_em) values ('v', '` + u + `', now() - interval '1 minute'), ('ok', '` + u + `', now() + interval '1 hour')`,
		`insert into webhooks_recebidos (origem, evento_id, recebido_em) values ('p', 'velho', now() - interval '31 days'), ('p', 'novo', now())`,
		`insert into envios_feitos (chave, feito_em) values ('velha', now() - interval '46 days'), ('nova', now())`,
		`insert into robos_execucoes (robo, disparado_em, ok, resposta, conferido_em) values
			('pendente', now() - interval '7 hours', null, null, null), ('vencida', now() - interval '61 days', true, 'ok', now() - interval '61 days')`,
	} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	foto := func() string {
		var s string
		if err := p.QueryRow(ctx, `select md5(coalesce((select string_agg(token_hash, ',' order by token_hash) from sessoes), '') || '|' ||
			coalesce((select string_agg(evento_id, ',' order by evento_id) from webhooks_recebidos), '') || '|' ||
			coalesce((select string_agg(chave, ',' order by chave) from envios_feitos), '') || '|' ||
			coalesce((select string_agg(robo || coalesce(resposta, '-') || (conferido_em is not null)::text, ',' order by robo) from robos_execucoes), ''))`).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	antes := foto()
	for _, tarefa := range []Tarefa{FaxinaDaAPI(p), ConferirRobos(p)} {
		if err := tarefa.Executar(ctx); err != nil {
			t.Fatalf("%s: %v", tarefa.Nome, err)
		}
	}
	primeira := foto()
	if primeira == antes {
		t.Fatal("a primeira execução não fez nada: o teste não prova idempotência")
	}
	for i := range 2 {
		for _, tarefa := range []Tarefa{FaxinaDaAPI(p), ConferirRobos(p)} {
			if err := tarefa.Executar(ctx); err != nil {
				t.Fatalf("%s, repetição %d: %v", tarefa.Nome, i+1, err)
			}
		}
		if got := foto(); got != primeira {
			t.Fatalf("a repetição %d mudou o estado deixado pela primeira execução", i+1)
		}
	}
}
