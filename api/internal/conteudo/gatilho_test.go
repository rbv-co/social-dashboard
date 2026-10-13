package conteudo

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

func TestQuantasDoPedido(t *testing.T) {
	for entrada, quer := range map[string]int{
		``: 12, `null`: 12, `0`: 12, `"abc"`: 12, `""`: 12, `5`: 5, `"15"`: 15, `25`: 20, `-5`: 1, `0.5`: 1,
		`3.7`: 3, `19.99`: 19, `"1e3"`: 20, `true`: 12, `{}`: 12,
	} {
		if n := quantasDoPedido(json.RawMessage(entrada)); n != quer {
			t.Errorf("quantas %s = %d, esperava %d", entrada, n, quer)
		}
	}
	for entrada, quer := range map[string]any{`"2026-10-19"`: "2026-10-19", `"2026-02-30"`: nil, `"2026-10-19x"`: nil, `null`: nil, `20261019`: nil} {
		if v := segundaDoPedido(json.RawMessage(entrada)); v != quer {
			t.Errorf("segunda %s = %v, esperava %v", entrada, v, quer)
		}
	}
}

func TestGatilho(t *testing.T) {
	m := novoMundo(t, montarGatilho, montarLeituras)
	pedido := func(conta, resto string) string { return `{"account_id":"` + conta + `"` + resto + `}` }
	intacto(t, m, []mundoteste.Caso{
		{Nome: "sem o módulo nem a chave", Quem: "semModulo", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, ""), Status: 403, Tem: `"error":"sem_permissao"`},
		{Nome: "só conteudo.aprovar", Quem: "soAprovar", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, ""), Status: 403},
		{Nome: "desativado", Quem: "desativado", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, ""), Status: 401},
		{Nome: "sem sessão", Quem: "", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, ""), Status: 401},
		{Nome: "impersonado", Quem: "impersonado", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, ""), Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "conta que não vê", Quem: "conteudistaA1", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A2, `,"quantas":5`), Status: 403, Tem: `"error":"sem_permissao"`},
		{Nome: "lista vazia", Quem: "conteudistaNenhuma", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, ""), Status: 403},
		{Nome: "conta que não é uuid", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido("abc", ""), Status: 400, Tem: `"error":"conta_invalida"`},
		{Nome: "36 hífens (a regex da edge aceitava)", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(strings.Repeat("-", 36), ""), Status: 400, Tem: "conta_invalida"},
		{Nome: "conta que não existe", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A9, ""), Status: 400, Tem: "conta_invalida"},
		{Nome: "conta como número", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: `{"account_id":5}`, Status: 400, Tem: "conta_invalida"},
		{Nome: "campo desconhecido", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger", Corpo: pedido(A1, `,"robo":"x"`), Status: 400, Tem: "corpo_invalido"},
	})
	const job = `select tipo || '|' || status || '|' || params::text || '|' || criado_por::text from conteudo_jobs where id = $1::uuid`
	var primeiro struct {
		JobID   string `json:"job_id"`
		Quantas int    `json:"quantas"`
	}
	st, b := m.Pedir(t, "conteudistaA1", "POST", "/conteudo-trigger", pedido(A1, `,"quantas":3.7,"modo":"ideias"`))
	if st != 200 || json.Unmarshal([]byte(b), &primeiro) != nil || primeiro.Quantas != 3 {
		t.Fatalf("pedir ideias: %d %s", st, b)
	}
	if v := m.Um(t, job, primeiro.JobID); v != `ideias|enfileirado|{"quantas": 3}|`+idConteudistaA1 {
		t.Errorf("o job = %s", v)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "segunda rodada na mesma marca (outro modo, outra pessoa)", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger",
			Corpo: pedido(A1, `,"modo":"semana","segunda":"2026-10-19"`), Status: 409, Tem: `{"error":"ja_rodando","job_id":"` + primeiro.JobID + `"}`,
			Efeito: `select count(*)::text from conteudo_jobs where account_id = '` + A1 + `'`, Quer: "2"}, // J1 (concluído) + o novo
		{Nome: "a semana em A2 por quem vê todas", Quem: "conteudista", Metodo: "POST", Caminho: "/conteudo-trigger",
			Corpo: pedido(strings.ToUpper(A2), `,"modo":"semana","segunda":"2026-02-30"`), Status: 200, Tem: `"quantas":12`,
			Efeito: `select tipo || '|' || params::text from conteudo_jobs where account_id = '` + A2 + `' and status = 'enfileirado'`, Quer: `semana|{"segunda": null}`},
	})
	// a janela da edge: rodada presa há mais de 3 min não segura a marca; concluída não conta
	if _, err := m.P.Exec(context.Background(), `update conteudo_jobs set created_at = now() - interval '4 minutes' where id = $1::uuid`, primeiro.JobID); err != nil {
		t.Fatal(err)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "a chave em permissions pede (a edge aceitava)", Quem: "chaveConteudo", Metodo: "POST", Caminho: "/conteudo-trigger",
			Corpo: pedido(A1, `,"quantas":"15"`), Status: 200, Tem: `"quantas":15`},
		{Nome: "quem pediu com a chave não LÊ o job (as policies leem features)", Quem: "chaveConteudo", Metodo: "GET", Caminho: "/conteudo/jobs", Status: 200, Tem: "[]"},
	})
}

// Dois cliques no MESMO instante: um job só; o outro clique recebe ja_rodando com o id dele. 20 rodadas.
func TestGatilhoCliqueDuplo(t *testing.T) {
	m := novoMundo(t, montarGatilho)
	ctx := context.Background()
	for rodada := range 20 {
		if _, err := m.P.Exec(ctx, `delete from conteudo_jobs where account_id = $1::uuid`, A1); err != nil {
			t.Fatal(err)
		}
		var wg sync.WaitGroup
		st, corpo := make([]int, 2), make([]string, 2)
		comeca := make(chan struct{})
		for i, quem := range []string{"conteudista", "conteudistaA1"} {
			wg.Add(1)
			go func() {
				defer wg.Done()
				<-comeca
				st[i], corpo[i] = m.Pedir(t, quem, "POST", "/conteudo-trigger", `{"account_id":"`+A1+`","quantas":12}`)
			}()
		}
		close(comeca)
		wg.Wait()
		n := m.Um(t, `select count(*)::text from conteudo_jobs where account_id = $1::uuid`, A1)
		ok := (st[0] == http.StatusOK && st[1] == http.StatusConflict) || (st[0] == http.StatusConflict && st[1] == http.StatusOK)
		if !ok || n != "1" {
			t.Fatalf("rodada %d: %v %v, %s jobs", rodada, st, corpo, n)
		}
		id := m.Um(t, `select id::text from conteudo_jobs where account_id = $1::uuid`, A1)
		if !strings.Contains(corpo[0]+corpo[1], `"job_id":"`+id+`"`) || strings.Count(corpo[0]+corpo[1], id) != 2 {
			t.Fatalf("rodada %d: os dois cliques não falam do mesmo job %s: %v", rodada, id, corpo)
		}
	}
}
