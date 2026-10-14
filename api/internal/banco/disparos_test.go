package banco_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func textoDe(t *testing.T, p *pgxpool.Pool, sql string, args ...any) string {
	t.Helper()
	var v *string
	if err := p.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	if v == nil {
		return "<nulo>"
	}
	return *v
}

func executar(t *testing.T, p *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := p.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

// A disparar_robo nova só enfileira: nunca chama rede, nunca falha por argumento, e os disparos de um robô se
// juntam num pedido pendente só — o cadastro do site (gatilho de vessel_lista_espera) não pode quebrar, nem com
// dois ao mesmo tempo.
func TestDispararRoboEnfileiraSemFalhar(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	id1 := textoDe(t, p, `select disparar_robo('vessel-espelhar-lista', 'vessel-espelhar-lista', 'vessel-espelhar-lista', '{"origem":"gatilho"}'::jsonb, 120000)::text`)
	id2 := textoDe(t, p, `select disparar_robo('vessel-espelhar-lista', 'x', 'y')::text`) // os dois DEFAULTs
	id3 := textoDe(t, p, `select disparar_robo('vessel-espelhar-lista', null, null, null, null)::text`)
	if id1 != id2 || id2 != id3 {
		t.Errorf("os disparos do mesmo robô não se juntaram: %s %s %s", id1, id2, id3)
	}
	if v := textoDe(t, p, `select situacao || '|' || pedidos || '|' || corpo::text from disparos_pendentes where id = $1::bigint`, id1); v != `pendente|3|{"origem": "gatilho"}` {
		t.Errorf("pedido = %s", v)
	}
	if textoDe(t, p, `select disparar_robo('vessel-fotos-trigger', 'a', 'b', jsonb_build_object('lote', 1))::text`) == id1 {
		t.Error("robôs diferentes no mesmo pedido")
	}
	nulo := textoDe(t, p, `select disparar_robo(null, null, null, null, null)::text`)
	if v := textoDe(t, p, `select robo || '|' || corpo::text from disparos_pendentes where id = $1::bigint`, nulo); v != "?|{}" {
		t.Errorf("robô e corpo nulos = %s", v)
	}
	// muitos ao mesmo tempo (o site e o robô de pedidos mexendo na lista juntos): nenhum falha, um pedido só
	var wg sync.WaitGroup
	var falhas atomic.Int32
	for range 20 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := p.Exec(ctx, `select disparar_robo('corrida', 'f', 's')`); err != nil {
				falhas.Add(1)
			}
		}()
	}
	wg.Wait()
	if falhas.Load() != 0 {
		t.Fatalf("%d disparos simultâneos falharam", falhas.Load())
	}
	if v := textoDe(t, p, `select count(*)::text || '|' || sum(pedidos)::text from disparos_pendentes where robo = 'corrida'`); v != "1|20" {
		t.Errorf("corrida = %s, esperava 1 pedido com 20 disparos", v)
	}
	// o disparo é da transação de quem chamou: desfeita, ele some junto
	tx, err := p.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `select disparar_robo('desfeito', 'f', 's')`); err != nil {
		t.Fatal(err)
	}
	tx.Rollback(ctx)
	if v := textoDe(t, p, `select count(*)::text from disparos_pendentes where robo = 'desfeito'`); v != "0" {
		t.Errorf("disparo de transação desfeita ficou: %s", v)
	}
}

func nunca(t *testing.T) func(context.Context, banco.Disparo) error {
	return func(context.Context, banco.Disparo) error {
		t.Error("atendeu o que não devia")
		return nil
	}
}

func TestAtenderDisparo(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	disparar := func(robo string) { executar(t, p, `select disparar_robo($1::text, 'f', 's', '{"n":1}'::jsonb)`, robo) }
	situacoes := func() string {
		return textoDe(t, p, `select coalesce(string_agg(situacao || ':' || pedidos, ',' order by id), '') from disparos_pendentes where robo = 'espelho'`)
	}

	if atendeu, err := banco.AtenderDisparo(ctx, p, "espelho", nunca(t)); atendeu || err != nil {
		t.Fatalf("sem pedido = %v %v", atendeu, err)
	}

	// um pedido (dois disparos juntos): roda UMA vez; o disparo DURANTE o atendimento abre um pendente novo
	disparar("espelho")
	disparar("espelho")
	var visto banco.Disparo
	atendeu, err := banco.AtenderDisparo(ctx, p, "espelho", func(_ context.Context, d banco.Disparo) error {
		visto = d
		disparar("espelho")
		return nil
	})
	if !atendeu || err != nil || visto.Robo != "espelho" || visto.Pedidos != 2 || string(visto.Corpo) != `{"n": 1}` {
		t.Fatalf("atendimento = %v %v %+v", atendeu, err, visto)
	}
	if v := situacoes(); v != "feito:2,pendente:1" {
		t.Errorf("depois do atendimento = %s", v)
	}

	// falha comum: 'falhou' com o texto, e não volta sozinha
	executar(t, p, `delete from disparos_pendentes`)
	disparar("espelho")
	if _, err := banco.AtenderDisparo(ctx, p, "espelho", func(context.Context, banco.Disparo) error { return errors.New("zoho fora") }); err == nil || !strings.Contains(err.Error(), "zoho fora") {
		t.Errorf("erro = %v", err)
	}
	if v := textoDe(t, p, `select situacao || '|' || erro from disparos_pendentes where robo = 'espelho'`); v != "falhou|zoho fora" {
		t.Errorf("falha = %s", v)
	}
	if atendeu, _ := banco.AtenderDisparo(ctx, p, "espelho", nunca(t)); atendeu {
		t.Error("a falha foi refeita sem disparo novo")
	}

	// incerto (pelo erro marcado e pelo prazo estourado dentro de fazer): também não volta
	for _, c := range []struct {
		nome  string
		fazer func(context.Context, banco.Disparo) error
	}{
		{"ErrIncerto", func(context.Context, banco.Disparo) error { return fmt.Errorf("github: 504: %w", banco.ErrIncerto) }},
		{"prazo", func(ctx context.Context, _ banco.Disparo) error { <-ctx.Done(); return ctx.Err() }},
	} {
		executar(t, p, `delete from disparos_pendentes`)
		disparar("espelho")
		c2, cancela := context.WithTimeout(ctx, 2*time.Second)
		banco.AtenderDisparo(c2, p, "espelho", c.fazer)
		cancela()
		if v := situacoes(); v != "incerto:1" {
			t.Errorf("%s: %s", c.nome, v)
		}
		if atendeu, _ := banco.AtenderDisparo(ctx, p, "espelho", nunca(t)); atendeu {
			t.Errorf("%s: o incerto foi refeito", c.nome)
		}
	}

	// órfão: 'atendendo' há 31 min vira 'incerto' sem rodar; o de 29 min fica
	executar(t, p, `delete from disparos_pendentes`)
	executar(t, p, `insert into disparos_pendentes (robo, situacao, atualizado_em) values
		('espelho', 'atendendo', now() - interval '31 minutes'), ('espelho', 'atendendo', now() - interval '29 minutes')`)
	if atendeu, _ := banco.AtenderDisparo(ctx, p, "espelho", nunca(t)); atendeu {
		t.Error("atendeu um órfão")
	}
	if v := textoDe(t, p, `select string_agg(situacao, ',' order by id) from disparos_pendentes where robo = 'espelho'`); v != "incerto,atendendo" {
		t.Errorf("órfãos = %s", v)
	}

	// faxina: o resolvido há mais de 30 dias sai; o de 29 dias fica
	executar(t, p, `delete from disparos_pendentes`)
	executar(t, p, `insert into disparos_pendentes (robo, situacao, atualizado_em) values ('espelho', 'feito', now() - interval '31 days'),
		('espelho', 'incerto', now() - interval '31 days'), ('espelho', 'falhou', now() - interval '29 days')`)
	banco.AtenderDisparo(ctx, p, "espelho", nunca(t))
	if v := situacoes(); v != "falhou:1" {
		t.Errorf("faxina = %s", v)
	}

	// oito atendentes ao mesmo tempo, um pedido: roda uma vez (várias rodadas: a corrida é de microssegundos)
	// o pool abre conexões sob demanda: sem aquecê-lo, o primeiro atendente termina antes de os outros conectarem
	// e a corrida nunca acontece (a mutação "select e depois update" passaria)
	var quentes []*pgxpool.Conn
	for range 8 {
		c, err := p.Acquire(ctx)
		if err != nil {
			t.Fatal(err)
		}
		quentes = append(quentes, c)
	}
	for _, c := range quentes {
		c.Release()
	}
	for rodada := range 5 {
		executar(t, p, `delete from disparos_pendentes`)
		disparar("espelho")
		var vezes atomic.Int32
		var wg sync.WaitGroup
		comeca := make(chan struct{})
		for range 8 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-comeca
				banco.AtenderDisparo(ctx, p, "espelho", func(context.Context, banco.Disparo) error {
					vezes.Add(1)
					time.Sleep(50 * time.Millisecond)
					return nil
				})
			}()
		}
		close(comeca)
		wg.Wait()
		if vezes.Load() != 1 {
			t.Errorf("rodada %d: o pedido rodou %d vezes", rodada, vezes.Load())
		}
	}

	// pedido de outro robô não é deste atendente
	disparar("outro")
	if atendeu, _ := banco.AtenderDisparo(ctx, p, "espelho", nunca(t)); atendeu {
		t.Error("atendeu o pedido de outro robô")
	}
}

// Se o atendimento passa de 30 min e a reconciliação marca 'incerto' no meio, o resultado não se perde calado: erro.
func TestAtenderDisparoReconciliadoNoMeio(t *testing.T) {
	p := testebanco.Novo(t)
	executar(t, p, `select disparar_robo('espelho', 'f', 's')`)
	atendeu, err := banco.AtenderDisparo(context.Background(), p, "espelho", func(context.Context, banco.Disparo) error {
		executar(t, p, `update disparos_pendentes set situacao = 'incerto' where robo = 'espelho'`)
		return nil
	})
	if !atendeu || err == nil || !strings.Contains(err.Error(), "já não estava atendendo") {
		t.Fatalf("atendimento reconciliado no meio = %v %v", atendeu, err)
	}
}
