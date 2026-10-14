package trafego

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// corpoDaRegua: um PUT válido para a conta; troque um campo com strings.Replace para estragá-lo.
func corpoDaRegua(conta string) string {
	return `{"pesos":{"curtidas":1,"comentarios":10},"limiares":{"manter":1.3,"ponderada_ligada":true},` +
		`"limiares_resultado":{"dentroMeta":1.1},"conta_id":"` + conta + `","metas":{"mensagens":8.5}}`
}

func TestRegua(t *testing.T) {
	m := novoMundo(t, montarRegua)

	// leitura: a régua é geral (toda sessão lê, e a linha carrega as metas de todas as contas)
	for _, quem := range []string{"semModulo", "gestorA1"} {
		st, corpo := m.Pedir(t, quem, "GET", "/gestao-trafego/regua", "")
		if st != 200 || strings.Count(corpo, `"id"`) != 1 || !strings.Contains(corpo, A1) || !strings.Contains(corpo, A2) ||
			!strings.Contains(corpo, `"metas_por_conta"`) {
			t.Errorf("leitura como %s: %d %s", quem, st, corpo)
		}
	}

	// negado e intacto: a foto não muda e o histórico segue vazio
	foto := m.Um(t, fotoDoTrafego)
	sem := func(campo string) string { // o corpo válido sem `campo`
		var o map[string]json.RawMessage
		_ = json.Unmarshal([]byte(corpoDaRegua(A1)), &o)
		delete(o, campo)
		b, _ := json.Marshal(o)
		return string(b)
	}
	ruim := func(de, para string) string { return strings.Replace(corpoDaRegua(A1), de, para, 1) }
	chaves51 := make([]string, 51)
	for i := range chaves51 {
		chaves51[i] = fmt.Sprintf(`"k%d":1`, i)
	}
	for _, c := range []struct {
		nome, quem, corpo string
		st                int
		tem               string
	}{
		{"gestorA1 na conta A2", "gestorA1", corpoDaRegua(A2), 403, ""},
		{"gestorNenhuma na conta A1", "gestorNenhuma", corpoDaRegua(A1), 403, ""},
		{"leitor", "leitor", corpoDaRegua(A1), 403, ""},
		{"super pela ficha não é gestor", "superA1", corpoDaRegua(A1), 403, ""},
		{"semModulo", "semModulo", corpoDaRegua(A1), 403, ""},
		{"entrar como", "impersonado", corpoDaRegua(A1), 403, "Quem entrou como outra pessoa só consulta."},
		{"sem sessão", "", corpoDaRegua(A1), 401, ""},
		{"pesos texto", "gestorA1", ruim(`"pesos":{"curtidas":1,"comentarios":10}`, `"pesos":"x"`), 400, ""},
		{"valor texto", "gestorA1", ruim(`"curtidas":1`, `"curtidas":"texto"`), 400, ""},
		{"valor objeto", "gestorA1", ruim(`"curtidas":1`, `"curtidas":{"a":1}`), 400, ""},
		{"metas nulo", "gestorA1", ruim(`"metas":{"mensagens":8.5}`, `"metas":null`), 400, ""},
		{"sem limiares_resultado", "gestorA1", sem("limiares_resultado"), 400, ""},
		{"sem metas", "gestorA1", sem("metas"), 400, ""},
		{"conta_id inválido", "gestorA1", ruim(`"conta_id":"`+A1+`"`, `"conta_id":"x"`), 400, ""},
		{"51 chaves", "gestorA1", ruim(`"pesos":{"curtidas":1,"comentarios":10}`, `"pesos":{`+strings.Join(chaves51, ",")+`}`), 400, ""},
		{"chave com 41 caracteres", "gestorA1", ruim(`"curtidas"`, `"`+strings.Repeat("c", 41)+`"`), 400, ""},
		{"chave a mais", "gestorA1", ruim(`"conta_id"`, `"updated_by":"`+idGestorA1+`","conta_id"`), 400, "corpo_invalido"},
		{"corpo vazio", "gestorA1", `{}`, 400, ""},
	} {
		st, corpo := m.Pedir(t, c.quem, "PUT", "/gestao-trafego/regua", c.corpo)
		if st != c.st || !strings.Contains(corpo, c.tem) {
			t.Errorf("%s: %d %s, esperava %d com %q", c.nome, st, corpo, c.st, c.tem)
		}
		if f := m.Um(t, fotoDoTrafego); f != foto {
			t.Errorf("%s: o banco mudou", c.nome)
		}
	}
	if n := m.Um(t, `select count(*)::text from gt_ponderada_config_log`); n != "0" {
		t.Errorf("histórico com %s linhas depois de só recusas", n)
	}

	// permitido: grava a conta pedida, mantém a outra, registra o histórico
	st, corpo := m.Pedir(t, "gestorA1", "PUT", "/gestao-trafego/regua", corpoDaRegua(A1))
	if st != 200 || !strings.Contains(corpo, `8.5`) || strings.Contains(corpo, "updated_by") {
		t.Errorf("gestorA1 em A1: %d %s", st, corpo)
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "meta de A1", Efeito: `select metas_por_conta #>> '{` + A1 + `,mensagens}' from gt_ponderada_config`, Quer: "8.5"},
		{Nome: "meta de A2 fica", Efeito: `select metas_por_conta #>> '{` + A2 + `,mensagens}' from gt_ponderada_config`, Quer: "7.7"},
		{Nome: "limiar ligado", Efeito: `select limiares ->> 'ponderada_ligada' from gt_ponderada_config`, Quer: "true"},
		{Nome: "pesos", Efeito: `select pesos ->> 'comentarios' from gt_ponderada_config`, Quer: "10"},
		{Nome: "limiares_resultado", Efeito: `select limiares_resultado ->> 'dentroMeta' from gt_ponderada_config`, Quer: "1.1"},
		{Nome: "updated_by", Efeito: `select updated_by::text from gt_ponderada_config`, Quer: idGestorA1},
		{Nome: "updated_at é do servidor", Efeito: `select (updated_at > now() - interval '1 minute')::text from gt_ponderada_config`, Quer: "true"},
		{Nome: "uma linha de histórico", Efeito: `select count(*)::text from gt_ponderada_config_log`, Quer: "1"},
		{Nome: "mudou_quem", Efeito: `select mudou_quem::text from gt_ponderada_config_log`, Quer: idGestorA1},
		{Nome: "antes", Efeito: `select antes #>> '{metas_por_conta,` + A1 + `,mensagens}' from gt_ponderada_config_log`, Quer: "9.8"},
		{Nome: "depois", Efeito: `select depois #>> '{metas_por_conta,` + A1 + `,mensagens}' from gt_ponderada_config_log`, Quer: "8.5"},
		{Nome: "depois guarda a outra conta", Efeito: `select depois #>> '{metas_por_conta,` + A2 + `,mensagens}' from gt_ponderada_config_log`, Quer: "7.7"},
	})
	// quem vê todas grava a A2; a leitura devolve o que ficou
	if st, corpo := m.Pedir(t, "gestorTodas", "PUT", "/gestao-trafego/regua", corpoDaRegua(A2)); st != 200 {
		t.Errorf("gestorTodas em A2: %d %s", st, corpo)
	}
	if v := m.Um(t, `select metas_por_conta #>> '{`+A1+`,mensagens}' from gt_ponderada_config`); v != "8.5" {
		t.Errorf("a meta de A1 sumiu depois da gravação de A2: %s", v)
	}
	if n := m.Um(t, `select count(*)::text from gt_ponderada_config_log`); n != "2" {
		t.Errorf("histórico com %s linhas, esperava 2", n)
	}
}

// O histórico que falha desfaz a régua: uma transação só.
func TestReguaHistoricoFalhandoDesfazTudo(t *testing.T) {
	m := novoMundo(t, montarRegua)
	if _, err := m.P.Exec(context.Background(), `alter table gt_ponderada_config_log add constraint nunca check (false)`); err != nil {
		t.Fatal(err)
	}
	foto := m.Um(t, fotoDoTrafego)
	st, corpo := m.Pedir(t, "gestorA1", "PUT", "/gestao-trafego/regua", corpoDaRegua(A1))
	if st != 400 || !strings.Contains(corpo, "pedido_invalido") {
		t.Errorf("histórico falhando: %d %s, esperava 400 pedido_invalido", st, corpo)
	}
	if f := m.Um(t, fotoDoTrafego); f != foto {
		t.Error("a régua ficou gravada sem histórico")
	}
}

// Quem grava a régua de A1 enquanto outra gravação (A3) está aberta não pode apagá-la.
func TestReguaNaoPerdeMetaDeOutraConta(t *testing.T) {
	m := novoMundo(t, montarRegua)
	ctx := context.Background()
	tx, err := m.P.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	if _, err := tx.Exec(ctx, `select 1 from gt_ponderada_config where id = 1 for update`); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `update gt_ponderada_config set metas_por_conta = metas_por_conta || '{"`+A3+`": {"mensagens": 1}}'::jsonb where id = 1`); err != nil {
		t.Fatal(err)
	}
	type resposta struct {
		st    int
		corpo string
	}
	feito := make(chan resposta, 1)
	go func() {
		st, corpo := m.Pedir(t, "gestorTodas", "PUT", "/gestao-trafego/regua", corpoDaRegua(A1))
		feito <- resposta{st, corpo}
	}()
	select {
	case r := <-feito:
		t.Fatalf("o PUT não esperou a trava: %d %s", r.st, r.corpo)
	case <-time.After(300 * time.Millisecond):
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case r := <-feito:
		if r.st != 200 {
			t.Fatalf("PUT: %d %s", r.st, r.corpo)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("o PUT não terminou depois da trava solta")
	}
	for conta, quer := range map[string]string{A1: "8.5", A2: "7.7", A3: "1"} {
		if v := m.Um(t, `select metas_por_conta #>> '{`+conta+`,mensagens}' from gt_ponderada_config`); v != quer {
			t.Errorf("meta da conta %s = %s, esperava %s (o mapa foi lido antes da trava?)", conta, v, quer)
		}
	}
	if v := m.Um(t, `select antes #>> '{metas_por_conta,`+A3+`,mensagens}' from gt_ponderada_config_log`); v != "1" {
		t.Errorf("o `antes` do histórico não viu a gravação que travou antes: %s", v)
	}
}

// Duas pessoas gravando contas diferentes ao mesmo tempo: as duas ficam e o histórico encadeia.
func TestReguaGravacoesSimultaneas(t *testing.T) {
	m := novoMundo(t, montarRegua)
	var wg sync.WaitGroup
	sts := make([]int, 8)
	for i := range sts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			conta := []string{A1, A2, A3}[i%3]
			sts[i], _ = m.Pedir(t, "gestorTodas", "PUT", "/gestao-trafego/regua",
				strings.Replace(corpoDaRegua(conta), `"mensagens":8.5`, `"mensagens":`+string(rune('1'+i)), 1))
		}()
	}
	wg.Wait()
	for i, st := range sts {
		if st != 200 {
			t.Errorf("gravação %d: %d", i, st)
		}
	}
	if v := m.Um(t, `select (select count(*) from jsonb_object_keys(metas_por_conta))::text from gt_ponderada_config`); v != "3" {
		t.Errorf("metas_por_conta com %s contas, esperava 3", v)
	}
	if v := m.Um(t, `select count(*)::text from gt_ponderada_config_log`); v != "8" {
		t.Errorf("histórico com %s linhas, esperava 8", v)
	}
	// cada `antes` é o `depois` da gravação anterior: nenhuma leitura velha
	if v := m.Um(t, `select count(*)::text from (select antes, lag(depois) over (order by id) as d from gt_ponderada_config_log) z where d is not null and antes is distinct from d`); v != "0" {
		t.Errorf("%s linhas do histórico com `antes` diferente do `depois` anterior", v)
	}
}
