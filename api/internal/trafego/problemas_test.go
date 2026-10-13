package trafego

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// montarRPCs monta a lista como web.Rotas, no grupo de domínio.
func montarRPCs(r chi.Router, p *pgxpool.Pool) {
	reg, err := rpc.Novo(p, FuncoesRPC...)
	deve(err)
	r.Post("/rpc/{nome}", reg.ServeHTTP)
}

const idSemPerfil = "a5710000-0000-4000-a000-000000000099" // só em usuarios

var errDesfazer = errors.New("desfazer")

// O portão do Go = a checagem de dentro da função de produção, pessoa por pessoa: permitida = a função
// roda sem erro; negada = P0001 'Sem permissao na Gestao de Trafego.'. A transação é desfeita.
func TestPortaoDoGestorIgualAFuncao(t *testing.T) {
	m := novoMundo(t)
	ctx := context.Background()
	if _, err := m.P.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'semperfil@x.com')`, idSemPerfil); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{"semPerfil": idSemPerfil}
	for _, p := range pessoas {
		ids[p.Chave] = p.ID
	}
	var permitidas, negadas int
	for nome, id := range ids {
		e, err := autz.CarregarEscopo(ctx, m.P, id)
		if err != nil {
			t.Fatal(err)
		}
		err = banco.ComUsuario(ctx, m.P, id, func(tx pgx.Tx) error {
			var n int
			if err := tx.QueryRow(ctx, `select gt_registrar_problemas($1::text, '[]'::jsonb)`, A3).Scan(&n); err != nil {
				return err
			}
			return errDesfazer
		})
		naFuncao := true
		if pg := (*pgconn.PgError)(nil); errors.As(err, &pg) {
			if pg.Code != "P0001" || pg.Message != "Sem permissao na Gestao de Trafego." {
				t.Fatalf("%s: erro inesperado da função: %v", nome, err)
			}
			naFuncao = false
		} else if !errors.Is(err, errDesfazer) {
			t.Fatalf("%s: erro inesperado: %v", nome, err)
		}
		if naFuncao {
			permitidas++
		} else {
			negadas++
		}
		if no := GestorDeTrafego(e); no != naFuncao {
			t.Errorf("%s: GestorDeTrafego = %t, a função %t", nome, no, naFuncao)
		}
	}
	if permitidas == 0 || negadas == 0 {
		t.Fatalf("o mundo tem de mostrar os dois lados: %d permitidas, %d negadas", permitidas, negadas)
	}
}

func TestRegistrarProblemas(t *testing.T) {
	m := novoMundo(t, montarRPCs)
	const (
		e7005 = `select titulo from gt_problemas_meta where ad_id = '7005' and codigo = 3 and account_id = '` + A1 + `'`
		f7001 = `select (resolvido_em is not null)::text from gt_problemas_meta where ad_id = '7001' and codigo = 1`
		f7002 = `select (resolvido_em is not null)::text from gt_problemas_meta where ad_id = '7002' and codigo = 2`
	)
	pedir := func(quem, corpo string) (int, string) {
		return m.Pedir(t, quem, "POST", "/rpc/gt_registrar_problemas", corpo)
	}
	foto := func() string { return m.Um(t, fotoDoTrafego) }

	intacto := func(nome, quem, corpo string, st int, tem string) {
		t.Helper()
		antes := foto()
		got, resp := pedir(quem, corpo)
		if got != st || (tem != "" && !strings.Contains(resp, tem)) {
			t.Errorf("%s: %d %s; esperava %d com %q", nome, got, resp, st, tem)
		}
		if foto() != antes {
			t.Errorf("%s: o banco mudou", nome)
		}
	}

	// gestorA1 registra em A1: o primeiro repetido vence, o que sumiu da lista fecha, A2 fica
	st, resp := pedir("gestorA1", `{"p_conta":"`+A1+`","p_itens":[{"ad_id":"7005","codigo":3,"titulo":"Novo"},{"ad_id":"7005","codigo":3,"titulo":"Repetido"}]}`)
	if st != 200 || resp != "1" {
		t.Fatalf("gestorA1 em A1: %d %s", st, resp)
	}
	if v := m.Um(t, e7005); v != "Novo" {
		t.Errorf("7005/3 titulo = %q", v)
	}
	if v := m.Um(t, f7001); v != "true" {
		t.Errorf("7001/1 devia estar fechado: %s", v)
	}
	if v := m.Um(t, f7002); v != "false" {
		t.Errorf("7002/2 (A2) devia continuar aberto: %s", v)
	}

	vazio := func(c string) string { return `{"p_conta":"` + c + `","p_itens":[]}` }
	intacto("A1 pede A2", "gestorA1", vazio(A2), 403, "")
	intacto("A1 pede A3", "gestorA1", vazio(A3), 403, "")
	intacto("gestorNenhuma", "gestorNenhuma", vazio(A1), 403, "")
	intacto("leitor", "leitor", vazio(A1), 403, "")
	intacto("superA1", "superA1", vazio(A1), 403, "")
	intacto("semModulo", "semModulo", vazio(A1), 403, "")
	intacto("impersonado", "impersonado", vazio(A1), 403, "Quem entrou como outra pessoa")
	intacto("conta não texto", "gestorA1", `{"p_conta":5,"p_itens":[]}`, 400, "p_conta deve ser texto")
	intacto("sem p_itens", "gestorA1", `{"p_conta":"`+A1+`"}`, 400, "falta o parâmetro p_itens")
	intacto("conta vazia, gestorA1", "gestorA1", vazio(""), 403, "")
	intacto("conta vazia, gestorTodas", "gestorTodas", vazio(""), 400, "Falta dizer de qual conta e a lista.")
	if v := m.Um(t, f7002); v != "false" {
		t.Errorf("7002/2 fechado pelos negados: %s", v)
	}

	// admin vê todas as contas
	if st, resp := pedir("adminA1", vazio(A2)); st != 200 || resp != "0" {
		t.Errorf("adminA1 em A2: %d %s", st, resp)
	}
	if v := m.Um(t, f7002); v != "true" {
		t.Errorf("7002/2 devia estar fechado pelo admin: %s", v)
	}
}
