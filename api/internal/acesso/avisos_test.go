package acesso

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

const (
	epViewer = "https://push.exemplo/viewer"
	epAdmin  = "https://push.exemplo/admin"
)

// chaves de uma inscrição de verdade: p256dh = 65 bytes (ponto não comprimido) e auth = 16 bytes, base64url sem padding.
func chaveP(n byte) string {
	return base64.RawURLEncoding.EncodeToString(append([]byte{4}, bytes.Repeat([]byte{n}, 64)...))
}
func chaveA(n byte) string { return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{n}, 16)) }

// pref: a coluna `col` da preferência (usuário, tipo); "<nulo>" também vale para linha que não existe.
func pref(col, user, tipo string) string {
	return fmt.Sprintf(`select (select %s::text from push_preferencias where user_id = '%s' and tipo = '%s')`, col, user, tipo)
}

// sub: a coluna `col` da inscrição de `endpoint`.
func sub(col, endpoint string) string {
	return fmt.Sprintf(`select (select %s::text from push_subs where endpoint = '%s')`, col, endpoint)
}

func lote(itens ...string) string { return "[" + strings.Join(itens, ",") + "]" }
func item(user, tipo string, ativo bool) string {
	return fmt.Sprintf(`{"user_id":"%s","tipo":"%s","ativo":%t}`, user, tipo, ativo)
}

func TestPreferenciasDeAviso(t *testing.T) {
	const rota = "/avisos/preferencias"
	m := novoMundo(t, montarAvisos)
	q := func(id string) string { return rota + "?user_id=" + id }
	desconhecido := "5e000000-0000-4000-a000-00000000ffff"

	t.Run("leitura: a própria, ou admin e super pela ficha", func(t *testing.T) {
		m.rodar(t, []caso{
			{nome: "a própria", quem: "viewer", metodo: "GET", caminho: q(idViewer), status: 200, tem: `"tipo":"vendas","ativo":true`},
			{nome: "a de outra pessoa vem vazia", quem: "viewer", metodo: "GET", caminho: q(idAdmin), status: 200, tem: `[]`},
			{nome: "admin lê a de outra", quem: "admin", metodo: "GET", caminho: q(idViewer), status: 200, tem: `"user_id":"` + idViewer + `"`},
			{nome: "adminRestrito (papel admin) lê a de outra", quem: "adminRestrito", metodo: "GET", caminho: q(idViewer), status: 200, tem: `"tipo":"vendas"`},
			{nome: "super pela ficha lê", quem: "superFicha", metodo: "GET", caminho: q(idViewer), status: 200, tem: `"tipo":"vendas"`},
			{nome: "super só por e-mail (ficha falsa, papel viewer) não lê a de outra", quem: "superSoPorEmail", metodo: "GET", caminho: q(idViewer), status: 200, tem: `[]`},
			{nome: "sem sessão", quem: "", metodo: "GET", caminho: q(idViewer), status: 401},
			{nome: "user_id que não é uuid", quem: "viewer", metodo: "GET", caminho: rota + "?user_id=x", status: 400},
			{nome: "ordem não existe nesta lista (chave composta)", quem: "admin", metodo: "GET", caminho: rota + "?ordem=tipo", status: 400},
		})
		// sem filtro: cada um enxerga o que a regra deixa (o vazamento pela lista inteira)
		m.rodar(t, []caso{
			{nome: "sem filtro: viewer só vê a própria", quem: "viewer", metodo: "GET", caminho: rota, status: 200, tem: idViewer, naoTem: idAdmin},
			{nome: "sem filtro: admin vê as duas", quem: "admin", metodo: "GET", caminho: rota, status: 200, tem: idViewer},
		})
		// IDOR: a pessoa alheia responde igual à que não existe (não denuncia a linha)
		_, alheia := m.pedir(t, "viewer", "GET", q(idAdmin), "")
		_, nada := m.pedir(t, "viewer", "GET", q(desconhecido), "")
		if alheia != nada {
			t.Errorf("preferência alheia %q difere da inexistente %q", alheia, nada)
		}
		var linhas []map[string]any
		if _, c := m.pedir(t, "admin", "GET", q(idViewer), ""); json.Unmarshal([]byte(c), &linhas) != nil || len(linhas) != 1 ||
			len(linhas[0]) != 5 {
			t.Errorf("a linha devolve user_id, tipo, ativo, alterado_em e alterado_por: %v", linhas)
		}
	})

	t.Run("gravação", func(t *testing.T) {
		m.rodar(t, []caso{
			{nome: "a própria: grava e carimba quem", quem: "viewer", metodo: "POST", caminho: rota, corpo: lote(item(idViewer, "saldo", true)), status: 204,
				efeito: pref("alterado_por", idViewer, "saldo"), quer: idViewer},
			{nome: "a data antiga vira de 2020 (preparo do teste de renovação)", quem: "viewer", metodo: "POST", caminho: rota, corpo: lote(item(idViewer, "saldo", true)), status: 204,
				efeito: `with u as (update push_preferencias set alterado_em = '2020-01-01T00:00:00Z' where user_id = '` + idViewer + `' and tipo = 'saldo' returning 1) select count(*)::text from u`, quer: "1"},
			{nome: "atualiza a mesma (upsert) e renova alterado_em", quem: "viewer", metodo: "POST", caminho: rota, corpo: lote(item(idViewer, "saldo", false)), status: 204,
				efeito: pref("(alterado_em > now() - interval '1 minute')::text || '/' || ativo", idViewer, "saldo"), quer: "true/false"},
			{nome: "admin grava a de outra e fica no rastro", quem: "admin", metodo: "POST", caminho: rota, corpo: lote(item(idViewer, "vendas", false)), status: 204,
				efeito: pref("alterado_por", idViewer, "vendas"), quer: idAdmin},
			{nome: "super pela ficha grava a de outra", quem: "superFicha", metodo: "POST", caminho: rota, corpo: lote(item(idAdmin, "conteudo", true)), status: 204,
				efeito: pref("ativo", idAdmin, "conteudo"), quer: "true"},
			{nome: "alterado_em = now()", quem: "viewer", metodo: "POST", caminho: rota, corpo: lote(item(idViewer, "conteudo", true)), status: 204,
				efeito: pref("(alterado_em > now() - interval '1 minute')", idViewer, "conteudo"), quer: "true"},
			// tudo-ou-nada: a linha do admin é negada, então a do próprio viewer (válida) também não grava
			{nome: "lote misto: viewer mexe na do admin = 403 e NADA grava", quem: "viewer", metodo: "POST", caminho: rota,
				corpo: lote(item(idViewer, "frota", true), item(idAdmin, "vendas", true)), status: 403,
				efeito: pref("ativo", idAdmin, "vendas"), quer: "false"},
			{nome: "…nem a própria do lote misto", efeito: pref("ativo", idViewer, "frota"), quer: "<nulo>"},
			{nome: "ordem inversa do lote misto", quem: "viewer", metodo: "POST", caminho: rota,
				corpo: lote(item(idAdmin, "vendas", true), item(idViewer, "frota", true)), status: 403,
				efeito: pref("ativo", idViewer, "frota"), quer: "<nulo>"},
			{nome: "super só por e-mail (ficha falsa) não grava a de outra", quem: "superSoPorEmail", metodo: "POST", caminho: rota, corpo: lote(item(idAdmin, "vendas", true)), status: 403,
				efeito: pref("ativo", idAdmin, "vendas"), quer: "false"},
			{nome: "pessoa sem perfil grava só a própria? (user_id dela não está em profiles: 409 da chave)", quem: "semPerfil", metodo: "POST", caminho: rota, corpo: lote(item(idSemPerfil, "vendas", true)), status: 409},
			{nome: "sem sessão", quem: "", metodo: "POST", caminho: rota, corpo: lote(item(idViewer, "vendas", true)), status: 401},
			{nome: "impersonado (papel admin) não grava", quem: "impersonado", metodo: "POST", caminho: rota, corpo: lote(item(idAdmin, "frota", true)), status: 403,
				efeito: pref("ativo", idAdmin, "frota"), quer: "<nulo>"},
		})
	})

	t.Run("pedido inválido não grava", func(t *testing.T) {
		antes := m.um(t, fotoDoMundo)
		var vinte, vinteEUm []string
		tipos := []string{"vendas", "saldo", "conteudo", "frota", "frota_reserva"}
		ids := []string{idViewer, idAdmin, idSuper, idSuperFicha, idSemTrava}
		for i := 0; i < 21; i++ {
			it := item(ids[i/5], tipos[i%5], true)
			vinteEUm = append(vinteEUm, it)
			if i < 20 {
				vinte = append(vinte, it)
			}
		}
		casos := []caso{
			{nome: "tipo fora da lista", quem: "viewer", metodo: "POST", caminho: rota, corpo: lote(item(idViewer, "cafe", true)), status: 400},
			{nome: "lote vazio", quem: "viewer", metodo: "POST", caminho: rota, corpo: `[]`, status: 400},
			{nome: "21 linhas", quem: "admin", metodo: "POST", caminho: rota, corpo: lote(vinteEUm...), status: 400},
			{nome: "par repetido", quem: "viewer", metodo: "POST", caminho: rota, corpo: lote(item(idViewer, "saldo", true), item(idViewer, "saldo", false)), status: 400},
			{nome: "par repetido com o uuid em outra caixa", quem: "viewer", metodo: "POST", caminho: rota,
				corpo: lote(item(idViewer, "saldo", true), item(strings.ToUpper(idViewer), "saldo", false)), status: 400},
			{nome: "par repetido com o uuid sem hífens (era 500: 21000 do Postgres)", quem: "viewer", metodo: "POST", caminho: rota,
				corpo: lote(item(idViewer, "saldo", true), item(strings.ReplaceAll(idViewer, "-", ""), "saldo", false)), status: 400},
			{nome: "par repetido com o uuid entre chaves", quem: "viewer", metodo: "POST", caminho: rota,
				corpo: lote(item(idViewer, "saldo", true), item("{"+idViewer+"}", "saldo", false)), status: 400},
			{nome: "uuid sem hífens sozinho também é recusado (só a forma canônica)", quem: "viewer", metodo: "POST", caminho: rota,
				corpo: lote(item(strings.ReplaceAll(idViewer, "-", ""), "saldo", true)), status: 400},
			{nome: "alterado_por no item", quem: "viewer", metodo: "POST", caminho: rota, corpo: `[{"user_id":"` + idViewer + `","tipo":"saldo","ativo":true,"alterado_por":"` + idAdmin + `"}]`, status: 400},
			{nome: "alterado_em no item", quem: "viewer", metodo: "POST", caminho: rota, corpo: `[{"user_id":"` + idViewer + `","tipo":"saldo","ativo":true,"alterado_em":"2020-01-01T00:00:00Z"}]`, status: 400},
			{nome: "sem ativo", quem: "viewer", metodo: "POST", caminho: rota, corpo: `[{"user_id":"` + idViewer + `","tipo":"saldo"}]`, status: 400},
			{nome: "ativo nulo", quem: "viewer", metodo: "POST", caminho: rota, corpo: `[{"user_id":"` + idViewer + `","tipo":"saldo","ativo":null}]`, status: 400},
			{nome: "item nulo", quem: "viewer", metodo: "POST", caminho: rota, corpo: `[null]`, status: 400},
			{nome: "user_id que não é uuid", quem: "viewer", metodo: "POST", caminho: rota, corpo: lote(item("x", "saldo", true)), status: 400},
			{nome: "objeto em vez de lista", quem: "viewer", metodo: "POST", caminho: rota, corpo: item(idViewer, "saldo", true), status: 400},
			{nome: "lote válido com um tipo ruim no fim: nada grava", quem: "admin", metodo: "POST", caminho: rota, corpo: lote(item(idViewer, "saldo", true), item(idViewer, "cafe", true)), status: 400},
		}
		m.rodar(t, casos)
		if depois := m.um(t, fotoDoMundo); depois != antes {
			t.Error("um pedido inválido mudou o banco")
		}
		// o teto é 20: 20 linhas passam (admin grava as 20)
		m.rodar(t, []caso{{nome: "20 linhas", quem: "admin", metodo: "POST", caminho: rota, corpo: lote(vinte...), status: 204,
			efeito: `select count(*)::text from push_preferencias`, quer: "20"}}) // as 20 combinações das quatro pessoas: as 5 já gravadas estão entre elas
	})
}

func TestInscricaoDePush(t *testing.T) {
	const ins, des = "/eu/push/inscrever", "/eu/push/desinscrever"
	corpo := func(ep, p, a string) string {
		return fmt.Sprintf(`{"endpoint":%q,"p256dh":%q,"auth":%q}`, ep, p, a)
	}
	m := novoMundo(t, montarAvisos)

	t.Run("inscrever", func(t *testing.T) {
		m.rodar(t, []caso{
			{nome: "novo: no nome de quem está logado", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/novo", chaveP(1), chaveA(1)), status: 200, tem: `"id"`, naoTem: chaveP(1), // chave e endpoint não voltam na resposta

				efeito: sub("user_id", "https://push.exemplo/novo"), quer: idViewer},
			{nome: "reinscreve o próprio com chaves novas", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo(epViewer, chaveP(2), chaveA(2)), status: 200, tem: `"id"`,
				efeito: sub("p256dh || '/' || auth", epViewer), quer: chaveP(2) + "/" + chaveA(2)},
			{nome: "o mesmo aparelho de novo não duplica", efeito: `select count(*)::text from push_subs where user_id = '` + idViewer + `'`, quer: "2"},
			// o endpoint é de outra pessoa: 403 e a linha dela fica exatamente como estava (dono e chaves)
			{nome: "endpoint do admin = 403 e a linha do admin intacta", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo(epAdmin, chaveP(9), chaveA(9)), status: 403, naoTem: "ka",
				efeito: sub("user_id || '/' || p256dh || '/' || auth", epAdmin), quer: idAdmin + "/ka/aa"},
			{nome: "super não toma o endpoint do admin", quem: "super", metodo: "POST", caminho: ins, corpo: corpo(epAdmin, chaveP(9), chaveA(9)), status: 403,
				efeito: sub("user_id || '/' || p256dh", epAdmin), quer: idAdmin + "/ka"},
			{nome: "admin reinscreve o próprio", quem: "admin", metodo: "POST", caminho: ins, corpo: corpo(epAdmin, chaveP(3), chaveA(3)), status: 200,
				efeito: sub("p256dh", epAdmin), quer: chaveP(3)},
			{nome: "sessão sem perfil também inscreve o próprio aparelho", quem: "semPerfil", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/sp", chaveP(4), chaveA(4)), status: 200,
				efeito: sub("user_id", "https://push.exemplo/sp"), quer: idSemPerfil},
			{nome: "sem sessão", quem: "", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/x", chaveP(5), chaveA(5)), status: 401},
			{nome: "impersonado", quem: "impersonado", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/imp", chaveP(6), chaveA(6)), status: 403,
				efeito: sub("user_id", "https://push.exemplo/imp"), quer: "<nulo>"},
			{nome: "impersonado nem reinscreve o endpoint do alvo", quem: "impersonado", metodo: "POST", caminho: ins, corpo: corpo(epAdmin, chaveP(7), chaveA(7)), status: 403,
				efeito: sub("p256dh", epAdmin), quer: chaveP(3)},
		})
	})

	t.Run("validação", func(t *testing.T) {
		antes := m.um(t, fotoDoMundo)
		longo := func(n int) string { return strings.Repeat("a", n) }
		ep2048 := "https://push.exemplo/" + longo(2048-len("https://push.exemplo/"))
		const bom = "https://push.exemplo/v"
		P, A := chaveP(1), chaveA(1)
		naoURL := func(nome, ep string) caso {
			return caso{nome: nome, quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo(ep, P, A), status: 400}
		}
		naoChave := func(nome, p, a string) caso {
			return caso{nome: nome, quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo(bom, p, a), status: 400}
		}
		m.rodar(t, []caso{
			naoURL("http (e o IP de metadados)", "http://169.254.169.254/x"),
			naoURL("esquema que não é https", "ftp://push.exemplo/x"),
			naoURL("sem host", "https:///x"),
			naoURL("não é URL", "isso não é url"),
			naoURL("endpoint vazio", ""),
			naoURL("endpoint com 2049 caracteres", ep2048+"a"),
			// a MESMA regra do envio (webpush.EndpointAceito): linha que o envio recusaria não entra (senão nunca é podada)
			naoURL("https com IP literal", "https://169.254.169.254/x"),
			naoURL("https com IP literal v6", "https://[::1]/x"),
			naoURL("https com IP decimal", "https://2130706433/x"),
			naoURL("localhost", "https://localhost/x"),
			naoURL("sufixo interno", "https://api.internal/x"),
			naoURL("userinfo", "https://quem:senha@push.exemplo/x"),
			naoChave("p256dh vazio", "", A),
			naoChave("auth vazio", P, ""),
			naoChave("p256dh que não é base64url", "k!k", A),
			naoChave("auth que não é base64url", P, "a+/="),
			naoChave("p256dh com o tamanho errado (16 bytes)", chaveA(1), A),
			naoChave("auth com o tamanho errado (65 bytes)", P, chaveP(1)),
			naoChave("p256dh com 257", longo(257), A),
			naoChave("auth com 257", P, longo(257)),
			{nome: "user_id no corpo", quem: "viewer", metodo: "POST", caminho: ins, corpo: `{"endpoint":"` + bom + `","p256dh":"` + P + `","auth":"` + A + `","user_id":"` + idAdmin + `"}`, status: 400},
			{nome: "id no corpo", quem: "viewer", metodo: "POST", caminho: ins, corpo: `{"endpoint":"` + bom + `","p256dh":"` + P + `","auth":"` + A + `","id":"` + idAdmin + `"}`, status: 400},
			{nome: "corpo vazio", quem: "viewer", metodo: "POST", caminho: ins, corpo: ``, status: 400},
		})
		if depois := m.um(t, fotoDoMundo); depois != antes {
			t.Error("um pedido inválido mudou o banco")
		}
		// os limites exatos passam
		m.rodar(t, []caso{
			{nome: "endpoint com 2048", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo(ep2048, chaveP(1), chaveA(1)), status: 200},
			{nome: "chave com padding também vale (o navegador às vezes manda)", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/pad", chaveP(1), chaveA(1)+"=="), status: 200},
		})
	})

	t.Run("desinscrever", func(t *testing.T) {
		m := novoMundo(t, montarAvisos)
		total := `select count(*)::text from push_subs`
		m.rodar(t, []caso{
			// dono da linha: o catálogo no WHERE; a do admin continua (e a resposta é a mesma de endpoint que não existe)
			{nome: "o endpoint do admin = 204 e a linha fica", quem: "viewer", metodo: "POST", caminho: des, corpo: `{"endpoint":"` + epAdmin + `"}`, status: 204,
				efeito: sub("user_id", epAdmin), quer: idAdmin},
			{nome: "…e o total não mudou", efeito: total, quer: "2"},
			{nome: "super não apaga a do admin", quem: "super", metodo: "POST", caminho: des, corpo: `{"endpoint":"` + epAdmin + `"}`, status: 204,
				efeito: sub("user_id", epAdmin), quer: idAdmin},
			{nome: "endpoint que não existe = 204", quem: "viewer", metodo: "POST", caminho: des, corpo: `{"endpoint":"https://push.exemplo/nunca"}`, status: 204, efeito: total, quer: "2"},
			{nome: "impersonado = 403 e a linha do alvo fica", quem: "impersonado", metodo: "POST", caminho: des, corpo: `{"endpoint":"` + epAdmin + `"}`, status: 403,
				efeito: sub("user_id", epAdmin), quer: idAdmin},
			{nome: "sem sessão", quem: "", metodo: "POST", caminho: des, corpo: `{"endpoint":"` + epViewer + `"}`, status: 401, efeito: total, quer: "2"},
			{nome: "campo a mais", quem: "viewer", metodo: "POST", caminho: des, corpo: `{"endpoint":"` + epViewer + `","user_id":"` + idAdmin + `"}`, status: 400,
				efeito: sub("user_id", epViewer), quer: idViewer},
			{nome: "sem endpoint", quem: "viewer", metodo: "POST", caminho: des, corpo: `{}`, status: 400, efeito: total, quer: "2"},
			{nome: "o próprio = 204 e some", quem: "viewer", metodo: "POST", caminho: des, corpo: `{"endpoint":"` + epViewer + `"}`, status: 204,
				efeito: sub("user_id", epViewer), quer: "<nulo>"},
			{nome: "de novo = 204 (idempotente)", quem: "viewer", metodo: "POST", caminho: des, corpo: `{"endpoint":"` + epViewer + `"}`, status: 204, efeito: total, quer: "1"},
		})
	})
}
