package atendimentos

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

var errDesfazer = errors.New("desfazer")

// reNegado: a recusa em json que não diz "sem_permissao": {"ok" : false, "erro" : "Você não tem a permissão ..."}.
var reNegado = regexp.MustCompile(`"ok"\s*:\s*false[^}]*permiss`)

// valorDeTeste: um literal que passa no cast do tipo (só o portão importa nos testes de portão).
func valorDeTeste(tipo string) string {
	switch tipo {
	case "text":
		return "'X'"
	case "bigint", "integer":
		return "1"
	case "boolean":
		return "true"
	case "date":
		return "'2026-01-01'::date"
	case "timestamptz":
		return "'2026-01-01T10:00:00Z'::timestamptz"
	}
	panic("tipo sem valor de teste: " + tipo)
}

// reais: os argumentos de quem tem dado de verdade no mundo (as três de lista vazia precisam de lista cheia para
// provar o outro lado).
var reais = map[string]string{
	"vessel_convidadas_do_encontro": "p_codigo => 'PE-20270301-CPS-01'",
	"vessel_stylist_contatos":       "p_codigo => 'STY-0001'",
	"vessel_stylist_qualificacoes":  "p_codigo => 'STY-0001'",
}

// consulta: o SELECT que chama f só com os parâmetros obrigatórios e devolve o json como texto (função de
// conjunto vira lista, como o json_agg do rpc.Conjunto).
func consulta(f rpc.Funcao) string {
	as := reais[f.Nome]
	if as == "" {
		var l []string
		for _, p := range f.Params {
			if !p.Opcional {
				l = append(l, p.Nome+" => "+valorDeTeste(p.Tipo))
			}
		}
		as = strings.Join(l, ", ")
	}
	if f.Retorno == rpc.Conjunto {
		return `select coalesce(json_agg(r), '[]'::json)::text from ` + f.Nome + `(` + as + `) r`
	}
	return `select to_json(` + f.Nome + `(` + as + `))::text`
}

// O portão do Go = a primeira linha de cada função de produção, pessoa por pessoa: cada função roda como cada
// pessoa (e como um usuário sem perfil) numa transação desfeita. Negada = raise 42501 ("sem permissao") ou o json
// {"ok":false,"situacao"|"motivo":"sem_permissao"}. As três que devolvem lista vazia a quem não pode ver
// (convidadas, contatos e qualificações da stylist) ficam atrás do portão largo contaAtiva e a função
// continua sendo a barreira: para elas o teste confere que o portão do Go deixa passar TODO mundo que a função
// deixa (o inverso não precisa valer) e que a função devolve vazio ao resto.
func TestPortoesIguaisAsFuncoes(t *testing.T) {
	m := novoMundo(t)
	ctx := context.Background()
	if _, err := m.P.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'semperfil@x.com')`, semPerfil); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{"semPerfil": semPerfil}
	for _, p := range pessoas {
		ids[p.Chave] = p.ID
	}
	listaVazia := map[string]bool{"vessel_convidadas_do_encontro": true, "vessel_stylist_contatos": true, "vessel_stylist_qualificacoes": true}
	for _, f := range FuncoesRPC {
		var permitidas, negadas int
		for quem, id := range ids {
			e, err := autz.CarregarEscopo(ctx, m.P, id)
			if err != nil {
				t.Fatal(err)
			}
			var negada bool
			err = banco.ComUsuario(ctx, m.P, id, func(tx pgx.Tx) error {
				var saida *string
				var pe *pgconn.PgError
				switch err := tx.QueryRow(ctx, consulta(f)).Scan(&saida); {
				case errors.As(err, &pe) && pe.Code == "42501":
					negada = true
				case err != nil && !errors.As(err, &pe):
					return err
				case err == nil && saida != nil:
					negada = strings.Contains(*saida, `"sem_permissao"`) || (reNegado.MatchString(*saida)) ||
						(listaVazia[f.Nome] && strings.TrimSpace(*saida) == "[]")
				}
				return errDesfazer // desfaz inclusive o que uma função que grava fizesse
			})
			if !errors.Is(err, errDesfazer) {
				t.Fatalf("%s como %s: %v", f.Nome, quem, err)
			}
			if negada {
				negadas++
			} else {
				permitidas++
			}
			no := f.Portao(e)
			switch {
			case listaVazia[f.Nome] && !negada && !no:
				t.Errorf("%s como %s: a função deixa passar e o portão largo do Go barra", f.Nome, quem)
			case !listaVazia[f.Nome] && no == negada:
				t.Errorf("%s como %s: o portão do Go = %t, a função %t", f.Nome, quem, no, !negada)
			}
		}
		if permitidas < 2 || negadas < 5 {
			t.Errorf("%s: o mundo tem de mostrar os dois lados: %d permitidas, %d negadas", f.Nome, permitidas, negadas)
		}
	}
	if len(FuncoesRPC) != 62 {
		t.Errorf("%d funções, esperava as 62 do 5.11", len(FuncoesRPC))
	}
}

// Todas as 62 chamadas pelo HTTP como super, com argumentos de teste: nenhuma pode dar 5xx (tabela, coluna ou função
// que o esquema não tem derrubaria aqui) nem 400 de parâmetro (declaração errada: nome ou tipo).
func TestNenhumaRPCDa5xxNemParametroErrado(t *testing.T) {
	m := novoMundo(t)
	for _, f := range FuncoesRPC {
		st, resp := m.Pedir(t, "super", "POST", "/rpc/"+f.Nome, corpoDeTeste(f))
		if st >= 500 || (st == 400 && strings.Contains(resp, "pedido_invalido")) {
			t.Errorf("%s = %d %.200s", f.Nome, st, resp)
		}
	}
}

// corpoDeTeste: o corpo JSON com os parâmetros obrigatórios de f.
func corpoDeTeste(f rpc.Funcao) string {
	var partes []string
	for _, p := range f.Params {
		if !p.Opcional {
			partes = append(partes, fmt.Sprintf("%q:%s", p.Nome, jsonDeTeste(p.Tipo)))
		}
	}
	return "{" + strings.Join(partes, ",") + "}"
}

func jsonDeTeste(tipo string) string {
	switch tipo {
	case "text":
		return `"X"`
	case "bigint", "integer":
		return "1"
	case "boolean":
		return "true"
	case "date":
		return `"2026-01-01"`
	case "timestamptz":
		return `"2026-01-01T10:00:00Z"`
	}
	panic("tipo sem valor de teste: " + tipo)
}

// fotoDoMundo: tudo o que uma RPC de atendimentos pode mudar. Igual antes e depois = a recusa não gravou.
const fotoDoMundo = `select md5(coalesce(string_agg(t, '|' order by t), '')) from (
	select 'a' || row_to_json(x)::text t from vessel_atendimentos x union all
	select 'b' || row_to_json(x)::text from vessel_beauty_sessions x union all
	select 'c' || row_to_json(x)::text from vessel_beauty_session_cadastros x union all
	select 'd' || row_to_json(x)::text from vessel_stylist_contatos x union all
	select 'e' || row_to_json(x)::text from vessel_stylist_etapas x union all
	select 'f' || row_to_json(x)::text from vessel_stylist_etapas_historico x union all
	select 'g' || row_to_json(x)::text from vessel_stylist_etapas_trilha x union all
	select 'h' || row_to_json(x)::text from vessel_stylist_motivos_de_saida x union all
	select 'i' || row_to_json(x)::text from vessel_stylist_qualificacoes x union all
	select 'j' || row_to_json(x)::text from vessel_stylists x union all
	select 'k' || row_to_json(x)::text from vessel_private_edits x union all
	select 'l' || row_to_json(x)::text from vessel_pracas x union all
	select 'm' || row_to_json(x)::text from vessel_praca_cidades x union all
	select 'n' || row_to_json(x)::text from vessel_stylist_circle_edicoes x union all
	select 'o' || row_to_json(x)::text from vessel_stylist_na_edicao x union all
	select 'p' || row_to_json(x)::text from vessel_pessoas x union all
	select 'q' || row_to_json(x)::text from vessel_origens x union all
	select 'r' || row_to_json(x)::text from vessel_lista_espera x union all
	select 's' || row_to_json(x)::text from disparos_pendentes x) f`

// "Entrar como" não grava: quem entrou como uma pessoa com todas as permissões de editar recebe 403 em TODAS as
// funções que gravam (a função nem roda: o mundo fica igual) e continua lendo as que só leem (Ruling 5.2-3).
func TestEntrarComoNaoGrava(t *testing.T) {
	m := novoMundo(t)
	antes := m.Um(t, fotoDoMundo)
	// o alvo do entrar-como precisa passar nos portões de editar: dá a ele todas as permissões
	if _, err := m.P.Exec(context.Background(), `update profiles set permissions = (select jsonb_object_agg(f, '["ver","editar"]'::jsonb)
		from unnest(array['atendimentos','atendimentos.beauty-sessions','atendimentos.private-edit','atendimentos.stylist-circle',
		'atendimentos.pracas','atendimentos.edicoes']) f) where id = $1::uuid`, porFerramenta[circle][1]); err != nil {
		t.Fatal(err)
	}
	var gravam, leem int
	for _, f := range FuncoesRPC {
		st, resp := m.Pedir(t, "impersonado", "POST", "/rpc/"+f.Nome, corpoDeTeste(f))
		if f.SoSessaoPropria {
			gravam++
			if st != 403 || !strings.Contains(resp, "sem_permissao") {
				t.Errorf("%s como entrar-como = %d %.120s, esperava 403", f.Nome, st, resp)
			}
		} else {
			leem++
			if st == 403 || st >= 500 { // 200 ou "não achei" (404): o que vale é o portão deixar ler
				t.Errorf("%s (só lê) como entrar-como = %d %.120s, esperava que lesse", f.Nome, st, resp)
			}
		}
	}
	if gravam != 43 || leem != 19 {
		t.Errorf("%d gravam e %d leem; esperava 43 e 19 (a classificação do script)", gravam, leem)
	}
	if m.Um(t, fotoDoMundo) != antes {
		t.Fatal("entrar-como mudou o mundo")
	}
}

// Quem não pode: 403 sem a função rodar e o mundo igual, em TODAS as 62 como quem não tem nenhuma permissão e como
// quem tem só "ver" da ferramenta (nenhuma função de gravar passa com ver). As três de lista vazia respondem 200 [].
// Varredura de vazamento: nenhuma resposta a quem não pode contém nome, WhatsApp, e-mail ou chave do mundo; como
// super, ao menos uma contém (senão a varredura não enxergaria nada).
func TestNegadoNaoGravaNemVaza(t *testing.T) {
	m := novoMundo(t)
	antes := m.Um(t, fotoDoMundo)
	segredos := []string{"Ana Stylist", "5511999990000", "11999990000", "Bia Convidada", "bia@x.com", "11988887777"}
	if chave := m.Um(t, `select chave from vessel_private_edits limit 1`); chave != "" {
		segredos = append(segredos, chave)
	}
	vaza := func(corpo string) bool {
		for _, s := range segredos {
			if strings.Contains(corpo, s) {
				return true
			}
		}
		return false
	}
	listaVazia := map[string]bool{"vessel_convidadas_do_encontro": true, "vessel_stylist_contatos": true, "vessel_stylist_qualificacoes": true}
	semNada := map[string]bool{"leitor": true, "admin": true, "soeditar": true, "lista": true}
	ids := map[string]string{}
	for _, p := range pessoas {
		ids[p.Chave] = p.ID
	}
	for _, quem := range []string{"leitor", "admin", "soeditar", "lista", "desativado", "ver:" + beauty, "ver:" + circle, "ver:" + privateEdit} {
		e, err := autz.CarregarEscopo(context.Background(), m.P, ids[quem])
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range FuncoesRPC {
			body := corpoDeTeste(f)
			switch f.Nome {
			case "vessel_stylist_contatos", "vessel_stylist_qualificacoes":
				body = `{"p_codigo":"STY-0001"}`
			case "vessel_convidadas_do_encontro":
				body = `{"p_codigo":"PE-20270301-CPS-01"}`
			}
			st, resp := m.Pedir(t, quem, "POST", "/rpc/"+f.Nome, body)
			switch {
			case quem == "desativado": // a conta desativada nem passa pela autenticação
				if st != 401 {
					t.Errorf("%s como desativado = %d, esperava 401", f.Nome, st)
				}
			case !f.Portao(e): // o portão do Go barra: 403 e a função nem roda
				if st != 403 || !strings.Contains(resp, "sem_permissao") {
					t.Errorf("%s como %s = %d %.100s, esperava 403", f.Nome, quem, st, resp)
				}
			case listaVazia[f.Nome] && semNada[quem]: // a função devolve vazio a quem não pode ver
				if st != 200 || strings.TrimSpace(resp) != "[]" {
					t.Errorf("%s como %s = %d %.100s, esperava 200 []", f.Nome, quem, st, resp)
				}
			case st == 403 || st >= 500: // passou no portão: a função decide, mas nunca 403 do Go nem erro de servidor
				if !strings.Contains(resp, "sem_permissao") || st >= 500 {
					t.Errorf("%s como %s = %d %.100s", f.Nome, quem, st, resp)
				}
			}
			if vaza(resp) && (semNada[quem] || quem == "desativado") {
				t.Errorf("%s como %s devolveu dado do mundo: %.200s", f.Nome, quem, resp)
			}
		}
	}
	if m.Um(t, fotoDoMundo) != antes {
		t.Fatal("uma recusa mudou o mundo")
	}
	achou := false
	for _, f := range FuncoesRPC {
		_, resp := m.Pedir(t, "super", "POST", "/rpc/"+f.Nome, corpoDeTeste(f))
		if _, r := m.Pedir(t, "super", "POST", "/rpc/"+f.Nome, `{"p_codigo":"STY-0001"}`); vaza(r) {
			achou = true
		}
		if vaza(resp) {
			achou = true
		}
	}
	if !achou {
		t.Error("a varredura de vazamento não achou nada nem para o super: o detector está cego")
	}
}
