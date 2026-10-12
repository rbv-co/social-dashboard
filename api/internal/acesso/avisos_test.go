package acesso

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

const (
	epViewer = "https://push.exemplo/viewer"
	epAdmin  = "https://push.exemplo/admin"
)

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
			{nome: "atualiza a mesma (upsert)", quem: "viewer", metodo: "POST", caminho: rota, corpo: lote(item(idViewer, "saldo", false)), status: 204,
				efeito: pref("ativo", idViewer, "saldo"), quer: "false"},
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
			{nome: "novo: no nome de quem está logado", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/novo", "k1", "a1"), status: 200, tem: `"id"`, naoTem: `k1`, // chave e endpoint não voltam na resposta

				efeito: sub("user_id", "https://push.exemplo/novo"), quer: idViewer},
			{nome: "reinscreve o próprio com chaves novas", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo(epViewer, "kv2", "av2"), status: 200, tem: `"id"`,
				efeito: sub("p256dh || '/' || auth", epViewer), quer: "kv2/av2"},
			{nome: "o mesmo aparelho de novo não duplica", efeito: `select count(*)::text from push_subs where user_id = '` + idViewer + `'`, quer: "2"},
			// o endpoint é de outra pessoa: 403 e a linha dela fica exatamente como estava (dono e chaves)
			{nome: "endpoint do admin = 403 e a linha do admin intacta", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo(epAdmin, "roubada", "roubada"), status: 403, naoTem: "ka",
				efeito: sub("user_id || '/' || p256dh || '/' || auth", epAdmin), quer: idAdmin + "/ka/aa"},
			{nome: "super não toma o endpoint do admin", quem: "super", metodo: "POST", caminho: ins, corpo: corpo(epAdmin, "roubada", "roubada"), status: 403,
				efeito: sub("user_id || '/' || p256dh", epAdmin), quer: idAdmin + "/ka"},
			{nome: "admin reinscreve o próprio", quem: "admin", metodo: "POST", caminho: ins, corpo: corpo(epAdmin, "ka2", "aa2"), status: 200,
				efeito: sub("p256dh", epAdmin), quer: "ka2"},
			{nome: "sessão sem perfil também inscreve o próprio aparelho", quem: "semPerfil", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/sp", "k", "a"), status: 200,
				efeito: sub("user_id", "https://push.exemplo/sp"), quer: idSemPerfil},
			{nome: "sem sessão", quem: "", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/x", "k", "a"), status: 401},
			{nome: "impersonado", quem: "impersonado", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/imp", "k", "a"), status: 403,
				efeito: sub("user_id", "https://push.exemplo/imp"), quer: "<nulo>"},
			{nome: "impersonado nem reinscreve o endpoint do alvo", quem: "impersonado", metodo: "POST", caminho: ins, corpo: corpo(epAdmin, "imp", "imp"), status: 403,
				efeito: sub("p256dh", epAdmin), quer: "ka2"},
		})
	})

	t.Run("validação", func(t *testing.T) {
		antes := m.um(t, fotoDoMundo)
		longo := func(n int) string { return strings.Repeat("a", n) }
		ep2048 := "https://push.exemplo/" + longo(2048-len("https://push.exemplo/"))
		m.rodar(t, []caso{
			{nome: "http (e o IP de metadados)", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo("http://169.254.169.254/x", "k", "a"), status: 400},
			{nome: "esquema que não é https", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo("ftp://push.exemplo/x", "k", "a"), status: 400},
			{nome: "sem host", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo("https:///x", "k", "a"), status: 400},
			{nome: "não é URL", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo("isso não é url", "k", "a"), status: 400},
			{nome: "endpoint vazio", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo("", "k", "a"), status: 400},
			{nome: "endpoint com 2049 caracteres", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo(ep2048+"a", "k", "a"), status: 400},
			{nome: "p256dh vazio", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/v", "", "a"), status: 400},
			{nome: "auth vazio", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/v", "k", ""), status: 400},
			{nome: "p256dh com 257", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/v", longo(257), "a"), status: 400},
			{nome: "auth com 257", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo("https://push.exemplo/v", "k", longo(257)), status: 400},
			{nome: "user_id no corpo", quem: "viewer", metodo: "POST", caminho: ins, corpo: `{"endpoint":"https://push.exemplo/v","p256dh":"k","auth":"a","user_id":"` + idAdmin + `"}`, status: 400},
			{nome: "id no corpo", quem: "viewer", metodo: "POST", caminho: ins, corpo: `{"endpoint":"https://push.exemplo/v","p256dh":"k","auth":"a","id":"` + idAdmin + `"}`, status: 400},
			{nome: "corpo vazio", quem: "viewer", metodo: "POST", caminho: ins, corpo: ``, status: 400},
		})
		if depois := m.um(t, fotoDoMundo); depois != antes {
			t.Error("um pedido inválido mudou o banco")
		}
		// os limites exatos passam
		m.rodar(t, []caso{
			{nome: "endpoint com 2048", quem: "viewer", metodo: "POST", caminho: ins, corpo: corpo(ep2048, longo(256), longo(256)), status: 200},
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
