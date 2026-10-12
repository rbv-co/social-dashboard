package web

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// A visão robos_saude pela montagem real: quem lê as duas tabelas (admin, super-admin pela ficha,
// claude.status em features) vê as linhas; o resto recebe 200 [] (nunca 403: a RLS filtra em vez
// de negar, e a API aplica a regra que a visão aplicaria se ainda fosse security_invoker, que a
// 09-22 perdeu: Ruling 1 do 5.12).
func TestSaudeDosRobosPelaMontagemReal(t *testing.T) {
	p := testebanco.Novo(t)
	s := auth.NovoStore(p)
	h := Rotas(p, s, auth.NovoLimitador(), config.Config{})
	toks := pessoasDosPaineis(t, p, s)
	if _, err := p.Exec(context.Background(), `
insert into robos_esperados (robo, horas_sem_sucesso_ate, critico) values
 ('coletar-dados', 30, true), ('meta-hora', 4, false), ('meta-hora-retentativa-00h', 24, false), ('sem-rodar', 2, false), ('parado', 2, false);
insert into robos_execucoes (robo, disparado_em, ok) values
 ('coletar-dados-07h · Vessel', now() - interval '1 hour', false),
 ('meta-hora', now() - interval '1 hour', true),
 ('meta-hora-retentativa-00h', now() - interval '2 hours', true),
 ('parado', now() - interval '3 hours', true);`); err != nil {
		t.Fatal(err)
	}
	const caminho = "/status-ia/saude-dos-robos"

	if c, _ := lerDosPaineis(h, caminho, ""); c != 401 {
		t.Errorf("sem sessão = %d, esperava 401", c)
	}
	for quem, quer := range map[string]int{"cliente": 403, "admin-desativado": 401} {
		if c, _ := lerDosPaineis(h, caminho, toks[quem]); c != quer {
			t.Errorf("como %s = %d, esperava %d", quem, c, quer)
		}
	}
	for _, quem := range []string{"nenhum", "so-permissao"} {
		if c, corpo := lerDosPaineis(h, caminho, toks[quem]); c != 200 || corpo != "[]" {
			t.Errorf("como %s = %d %s, esperava 200 []", quem, c, corpo)
		}
	}
	colunas := []string{"robo", "critico", "ultimo_sucesso", "ultimo_disparo", "falhas_24h", "disparos_24h",
		"horas_sem_sucesso_ate", "situacao", "porque", "quem_falhou", "variantes_vivas"}
	for _, quem := range []string{"admin", "super", "status"} {
		c, corpo := lerDosPaineis(h, caminho, toks[quem])
		if c != 200 {
			t.Fatalf("como %s = %d %s, esperava 200", quem, c, corpo)
		}
		var linhas []struct {
			Robo       string   `json:"robo"`
			Situacao   string   `json:"situacao"`
			QuemFalhou []string `json:"quem_falhou"`
		}
		if err := json.Unmarshal([]byte(corpo), &linhas); err != nil {
			t.Fatalf("como %s: %v (%s)", quem, err, corpo)
		}
		var robos, situacoes []string
		for _, l := range linhas {
			robos, situacoes = append(robos, l.Robo), append(situacoes, l.Situacao)
		}
		if got, quer := strings.Join(robos, "|"), "coletar-dados|meta-hora|meta-hora-retentativa-00h|parado|sem-rodar"; got != quer {
			t.Errorf("como %s: robôs %q, esperava %q", quem, got, quer)
		}
		if got, quer := strings.Join(situacoes, "|"), "nunca deu certo|ok|ok|ATRASADO|sem registro ainda"; got != quer {
			t.Errorf("como %s: situações %q, esperava %q", quem, got, quer)
		}
		if len(linhas) == 5 && !slices.Equal(linhas[0].QuemFalhou, []string{"coletar-dados-07h · Vessel"}) {
			t.Errorf("como %s: quem_falhou = %v", quem, linhas[0].QuemFalhou)
		}
		if len(linhas) == 5 && !slices.Equal(linhas[3].QuemFalhou, []string{"parado"}) {
			t.Errorf("como %s: quem_falhou do parado = %v", quem, linhas[3].QuemFalhou)
		}
		// as chaves do 1º objeto, na ordem das 11 colunas da visão
		d := json.NewDecoder(strings.NewReader(corpo))
		for range 2 { // [ e {
			if _, err := d.Token(); err != nil {
				t.Fatal(err)
			}
		}
		var chaves []string
		for d.More() {
			k, err := d.Token()
			if err != nil {
				t.Fatal(err)
			}
			chaves = append(chaves, k.(string))
			var v json.RawMessage
			if err := d.Decode(&v); err != nil {
				t.Fatal(err)
			}
		}
		if !slices.Equal(chaves, colunas) {
			t.Errorf("como %s: chaves %v, esperava %v", quem, chaves, colunas)
		}
	}
	// critico desc vem antes de robo: um crítico alfabeticamente último sobe para o 2º lugar
	// (a semente acima não separa "critico desc, robo" de "robo").
	if _, err := p.Exec(context.Background(), `insert into robos_esperados (robo, horas_sem_sucesso_ate, critico) values ('zz-critico', 1, true)`); err != nil {
		t.Fatal(err)
	}
	_, corpo := lerDosPaineis(h, caminho, toks["admin"])
	var l []struct{ Robo string }
	if err := json.Unmarshal([]byte(corpo), &l); err != nil || len(l) != 6 || l[0].Robo != "coletar-dados" || l[1].Robo != "zz-critico" {
		t.Errorf("ordem critico desc, robo: %s (%v)", corpo, err)
	}
}
