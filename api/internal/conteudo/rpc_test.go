package conteudo

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// montarRPCs monta a lista como web.Rotas, no grupo de domínio.
func montarRPCs(r chi.Router, p *pgxpool.Pool) {
	reg, err := rpc.Novo(p, FuncoesRPC...)
	deve(err)
	r.Post("/rpc/{nome}", reg.ServeHTTP)
}

const idSemPerfil = "a5910000-0000-4000-a000-000000000099" // só em usuarios

var errDesfazer = errors.New("desfazer")

// O portão do Go = a checagem de dentro de cada função de produção (e do gatilho), pessoa por pessoa:
// permitida = a função roda sem erro (a transação é desfeita); negada = P0001 com a frase do portão dela.
// As funções são SECURITY DEFINER: o desativado PASSA nelas (a subconsulta em profiles não vê a RLS), e passa
// em Conteudista/Aprovador também — a sessão dele nem existe (auth.Exigir).
func TestPortoesIguaisAsFuncoes(t *testing.T) {
	m := novoMundo(t)
	ctx := context.Background()
	if _, err := m.P.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'semperfil@x.com')`, idSemPerfil); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{"semPerfil": idSemPerfil}
	for _, p := range pessoas {
		ids[p.Chave] = p.ID
	}
	for _, c := range []struct {
		nome, sql, frase string
		regra            autz.Regra
	}{
		{"conteudo_aprovar_e_agendar", `select conteudo_aprovar_e_agendar('` + P2 + `'::uuid)`, "Sem permissao para aprovar pecas de conteudo.", Aprovador},
		{"conteudo_casar_na_mao", `select conteudo_casar_na_mao('` + P1 + `'::uuid, 'https://www.instagram.com/p/ABC123/')`, "Voce nao tem acesso a Central de Conteudo.", Conteudista},
		{"conteudo_decidir", `select conteudo_decidir('` + P2 + `'::uuid, 'aprovada', null)`, "Sem permissao para aprovar ou reprovar pecas de conteudo.", Aprovador},
		{"conteudo_decidir_casamento", `select conteudo_decidir_casamento('` + CS1 + `'::uuid, true)`, "Sem permissao na Central de Conteudo.", Conteudista},
		{"conteudo_ideia_virar_peca", `select conteudo_ideia_virar_peca('` + I1 + `'::uuid, '` + A1 + `'::uuid, null)`, "Sem permissao na Central de Conteudo.", Conteudista},
		{"conteudo_reavisar", `select conteudo_reavisar('` + P4 + `'::uuid)`, "Sem permissao na Central de Conteudo.", Conteudista},
		// a guarda das rotas de peça (PATCH de status): mesmo portão de quem aprova
		{"gatilho conteudo_guarda_aprovacao", `update conteudo_pecas set status = 'aprovada' where id = '` + P2 + `'`, "Sem permissao para aprovar pecas de conteudo.", Aprovador},
	} {
		var permitidas, negadas int
		for quem, id := range ids {
			e, err := autz.CarregarEscopo(ctx, m.P, id)
			if err != nil {
				t.Fatal(err)
			}
			err = banco.ComUsuario(ctx, m.P, id, func(tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, c.sql); err != nil {
					return err
				}
				return errDesfazer
			})
			naFuncao := true
			if pg := (*pgconn.PgError)(nil); errors.As(err, &pg) {
				if pg.Code != "P0001" || pg.Message != c.frase {
					t.Fatalf("%s como %s: erro inesperado da função: %v", c.nome, quem, err)
				}
				naFuncao = false
			} else if !errors.Is(err, errDesfazer) {
				t.Fatalf("%s como %s: erro inesperado: %v", c.nome, quem, err)
			}
			if naFuncao {
				permitidas++
			} else {
				negadas++
			}
			if no := c.regra(e); no != naFuncao {
				t.Errorf("%s como %s: o portão do Go = %t, a função %t", c.nome, quem, no, naFuncao)
			}
		}
		if permitidas < 5 || negadas < 4 {
			t.Errorf("%s: o mundo tem de mostrar os dois lados: %d permitidas, %d negadas", c.nome, permitidas, negadas)
		}
	}
}

func TestRPCsDoConteudo(t *testing.T) {
	m := novoMundo(t, montarRPCs)
	inexistente := "a5930000-0000-4000-a000-0000000000ff"
	rpcDe := func(nome string) string { return "/rpc/" + nome }
	intacto(t, m, []mundoteste.Caso{
		// aprovar já agendando
		{Nome: "aprovar peça de A2 sem vê-la", Quem: "aprovadorA1", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"` + P3 + `"}`, Status: 403},
		{Nome: "aprovar peça inexistente (igual)", Quem: "aprovadorA1", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"` + inexistente + `"}`, Status: 403},
		{Nome: "aprovar com id inválido (igual)", Quem: "aprovadorA1", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"x"}`, Status: 403},
		{Nome: "editor aprova", Quem: "conteudista", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"` + P2 + `"}`, Status: 403},
		{Nome: "impersonado (o alvo não aprova: o portão vem antes)", Quem: "impersonado", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"` + P2 + `"}`, Status: 403},
		{Nome: "impersonado reavisa a peça que o alvo vê", Quem: "impersonado", Metodo: "POST", Caminho: rpcDe("conteudo_reavisar"), Corpo: `{"p_peca":"` + P4 + `"}`, Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "impersonado casa na mão", Quem: "impersonado", Metodo: "POST", Caminho: rpcDe("conteudo_casar_na_mao"), Corpo: `{"p_peca":"` + P1 + `","p_media":"ABC"}`, Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "aprovar sem data", Quem: "aprovador", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"` + P7 + `"}`, Status: 400, Tem: "Esta peca nao tem data marcada"},
		// decidir
		{Nome: "decidir peça de A2 sem vê-la", Quem: "aprovadorA1", Metodo: "POST", Caminho: rpcDe("conteudo_decidir"), Corpo: `{"p_peca":"` + P3 + `","p_decisao":"aprovada"}`, Status: 403},
		{Nome: "decisão fora da lista", Quem: "aprovador", Metodo: "POST", Caminho: rpcDe("conteudo_decidir"), Corpo: `{"p_peca":"` + P2 + `","p_decisao":"talvez"}`, Status: 400, Tem: "Decisao invalida: talvez"},
		{Nome: "decidir peça que não espera aprovação", Quem: "aprovador", Metodo: "POST", Caminho: rpcDe("conteudo_decidir"), Corpo: `{"p_peca":"` + P1 + `","p_decisao":"aprovada"}`, Status: 400, Tem: "alguem ja decidiu"},
		// casar na mão
		{Nome: "casar peça de A2 sem vê-la", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_casar_na_mao"), Corpo: `{"p_peca":"` + P3 + `","p_media":"ABC"}`, Status: 403},
		{Nome: "casar sem link", Quem: "conteudista", Metodo: "POST", Caminho: rpcDe("conteudo_casar_na_mao"), Corpo: `{"p_peca":"` + P1 + `","p_media":" "}`, Status: 400, Tem: "Informe o link ou o codigo do post."},
		{Nome: "casar com post de outra peça", Quem: "conteudista", Metodo: "POST", Caminho: rpcDe("conteudo_casar_na_mao"), Corpo: `{"p_peca":"` + P1 + `","p_media":"IG5"}`, Status: 400, Tem: "Esse post ja esta ligado a outra peca."},
		{Nome: "casar com a chave em permissions (a função lê features)", Quem: "chaveConteudo", Metodo: "POST", Caminho: rpcDe("conteudo_casar_na_mao"), Corpo: `{"p_peca":"` + P1 + `","p_media":"ABC"}`, Status: 403},
		// decidir casamento
		{Nome: "decidir sugestão de peça de A2", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_decidir_casamento"), Corpo: `{"p_casamento":"` + CS3 + `","p_confirma":true}`, Status: 403},
		{Nome: "decidir sugestão inexistente (igual)", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_decidir_casamento"), Corpo: `{"p_casamento":"` + inexistente + `","p_confirma":true}`, Status: 403},
		// ideia vira peça
		{Nome: "ideia de A2 vira peça em A1", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_ideia_virar_peca"), Corpo: `{"p_ideia":"` + I3 + `","p_account":"` + A1 + `"}`, Status: 403},
		{Nome: "ideia geral vira peça em A2", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_ideia_virar_peca"), Corpo: `{"p_ideia":"` + I2 + `","p_account":"` + A2 + `"}`, Status: 403},
		{Nome: "ideia inexistente (igual)", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_ideia_virar_peca"), Corpo: `{"p_ideia":"` + inexistente + `","p_account":"` + A1 + `"}`, Status: 403},
		{Nome: "ideia já usada", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_ideia_virar_peca"), Corpo: `{"p_ideia":"` + I5 + `","p_account":"` + A1 + `"}`, Status: 400, Tem: "Esta ideia ja virou peca."},
		{Nome: "sem a conta", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_ideia_virar_peca"), Corpo: `{"p_ideia":"` + I1 + `"}`, Status: 400, Tem: "falta o parâmetro p_account"},
		// reavisar
		{Nome: "reavisar peça de A2", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_reavisar"), Corpo: `{"p_peca":"` + P5 + `"}`, Status: 403},
		{Nome: "reavisar peça não agendada", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_reavisar"), Corpo: `{"p_peca":"` + P1 + `"}`, Status: 400, Tem: "So da para reavisar"},
		{Nome: "lista vazia não reavisa", Quem: "conteudistaNenhuma", Metodo: "POST", Caminho: rpcDe("conteudo_reavisar"), Corpo: `{"p_peca":"` + P4 + `"}`, Status: 403},
	})
	const peca = `select status || '|' || coalesce(ig_media_id, '-') || '|' || coalesce(aprovado_por::text, '-') || '|' || coalesce(avisado_em::text, 'nulo') from conteudo_pecas where id = '`
	const eventos = `select string_agg(acao, ',' order by id) from conteudo_eventos where peca_id = '`
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "aprovar já agendando", Quem: "aprovadorA1", Metodo: "POST", Caminho: rpcDe("conteudo_aprovar_e_agendar"), Corpo: `{"p_peca":"` + P2 + `"}`,
			Status: 200, Tem: `"status":"agendada"`, Efeito: peca + P2 + `'`, Quer: "agendada|-|" + idAprovadorA1 + "|nulo"},
		{Nome: "a trilha da aprovação", Efeito: eventos + P2 + `'`, Quer: "aprovou,mudou_status"},
		{Nome: "quem só aprova continua decidindo (paridade)", Quem: "soAprovar", Metodo: "POST", Caminho: rpcDe("conteudo_decidir"),
			Corpo: `{"p_peca":"` + P3 + `","p_decisao":"reprovada","p_motivo":"Foto escura"}`, Status: 200,
			Efeito: `select status || '|' || motivo_reprovacao from conteudo_pecas where id = '` + P3 + `'`, Quer: "reprovada|Foto escura"},
		{Nome: "casar na mão pelo link", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_casar_na_mao"),
			Corpo: `{"p_peca":"` + P1 + `","p_media":"https://www.instagram.com/reel/ABC123/?igsh=x"}`, Status: 200,
			Efeito: `select status || '|' || ig_media_id from conteudo_pecas where id = '` + P1 + `'`, Quer: "publicada|ABC123"},
		{Nome: "confirmar a sugestão", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_decidir_casamento"),
			Corpo: `{"p_casamento":"` + CS1 + `","p_confirma":true}`, Status: 200, Tem: `"situacao":"confirmado"`,
			Efeito: `select status || '|' || ig_media_id from conteudo_pecas where id = '` + P4 + `'`, Quer: "publicada|IG41"},
		{Nome: "a sugestão já decidida", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_decidir_casamento"),
			Corpo: `{"p_casamento":"` + CS1 + `","p_confirma":false}`, Status: 400, Tem: "Esta sugestao ja foi decidida."},
		{Nome: "ideia geral vira peça na própria conta", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_ideia_virar_peca"),
			Corpo: `{"p_ideia":"` + I2 + `","p_account":"` + A1 + `","p_publicar_em":"2026-11-02T15:00:00Z"}`, Status: 200, Tem: `"status":"rascunho"`,
			Efeito: `select situacao || '|' || (select account_id::text from conteudo_pecas pc where pc.id = i.peca_id) from conteudo_ideias i where id = '` + I2 + `'`, Quer: "usada|" + A1},
		{Nome: "admin decide em A2", Quem: "adminA1", Metodo: "POST", Caminho: rpcDe("conteudo_decidir_casamento"),
			Corpo: `{"p_casamento":"` + CS3 + `","p_confirma":false}`, Status: 200, Tem: `"situacao":"recusado"`},
	})
	// reavisar (P4 já foi publicada acima: usa uma peça agendada nova)
	if _, err := m.P.Exec(context.Background(), `insert into conteudo_pecas (id, account_id, titulo, formato, status, publicar_em, avisado_em)
		values ('a5930000-0000-4000-a000-0000000000c8', '`+A1+`', 'Agendada', 'feed', 'agendada', now(), now())`); err != nil {
		t.Fatal(err)
	}
	m.Rodar(t, []mundoteste.Caso{{Nome: "reavisar", Quem: "conteudistaA1", Metodo: "POST", Caminho: rpcDe("conteudo_reavisar"),
		Corpo: `{"p_peca":"a5930000-0000-4000-a000-0000000000c8"}`, Status: 200,
		Efeito: `select coalesce(avisado_em::text, 'nulo') || '|' || (select string_agg(acao, ',') from conteudo_eventos where peca_id = 'a5930000-0000-4000-a000-0000000000c8')
			from conteudo_pecas where id = 'a5930000-0000-4000-a000-0000000000c8'`, Quer: "nulo|reavisar"}})
}

// Dois aprovadores decidindo a MESMA peça ao mesmo tempo: um passa, o outro recebe a frase do trinco da função
// (sem impasse: a conferência não trava a linha) e a trilha tem UMA decisão.
func TestDecisaoSimultanea(t *testing.T) {
	m := novoMundo(t, montarRPCs)
	var wg sync.WaitGroup
	st := make([]int, 2)
	comeca := make(chan struct{})
	for i, quem := range []string{"aprovador", "aprovadorA1"} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-comeca
			st[i], _ = m.Pedir(t, quem, "POST", "/rpc/conteudo_decidir", `{"p_peca":"`+P2+`","p_decisao":"aprovada"}`)
		}()
	}
	close(comeca)
	wg.Wait()
	if !(st[0] == http.StatusOK && st[1] == http.StatusBadRequest) && !(st[0] == http.StatusBadRequest && st[1] == http.StatusOK) {
		t.Errorf("status = %v, esperava um 200 e um 400", st)
	}
	if v := m.Um(t, `select count(*)::text from conteudo_eventos where peca_id = '`+P2+`' and acao = 'aprovou'`); v != "1" {
		t.Errorf("decisões na trilha = %s", v)
	}
}
