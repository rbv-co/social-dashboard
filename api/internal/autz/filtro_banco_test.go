package autz

import (
	"context"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Conferir roda a condição no Postgres sobre uma linha que ainda não existe: os casts dos
// parâmetros nomeados têm de ser aceitos e a linha de outra pessoa/loja/conta tem de ser negada.
func TestConferirLinhaNova(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `create table autz_t (dono uuid, canal bigint, equipe text, conta text, local_id text, pessoa_id text)`); err != nil {
		t.Fatal(err)
	}
	cat := catalogoDe(t,
		pol("permissive", "insert", `["authenticated"]`, "(auth.uid() = dono)"),
		pol("permissive", "select", `["authenticated"]`, "pode_ver_canal(canal)"),
		pol("permissive", "update", `["authenticated"]`, "pode_ver_conta(conta)"),
		pol("permissive", "delete", `["authenticated"]`, "pode_ver_bem(local_id, pessoa_id)"))
	cat.tabelas["autz_t"] = cat.tabelas["t"]
	e := &Escopo{ID: eu, TemPerfil: true, Ativo: true, Canais: []int64{7}, Contas: []string{"A1"}, Locais: []string{"L1"}}
	casos := []struct {
		op    Op
		linha map[string]any
		ok    bool
	}{
		{Criar, map[string]any{"dono": eu}, true},
		{Criar, map[string]any{"dono": outra}, false},
		{Criar, map[string]any{}, false}, // coluna nula nunca casa
		{Ler, map[string]any{"canal": 7}, true},
		{Ler, map[string]any{"canal": 8}, false},
		// EditarNova = leitura (canal) E update (conta) da linha NOVA
		{EditarNova, map[string]any{"conta": "A1", "canal": 7}, true},
		{EditarNova, map[string]any{"conta": "B2", "canal": 7}, false}, // conta que não é minha
		{EditarNova, map[string]any{"conta": "A1", "canal": 8}, false}, // canal que não é meu: a policy de select nega a linha nova
		{EditarNova, map[string]any{"canal": 7}, true},                 // conta nula: a regra de produção libera
		{Apagar, map[string]any{"local_id": "L1"}, false},              // Apagar exige também o Ler: a policy de select (canal) nega a linha sem canal
	}
	for _, c := range casos {
		f, err := cat.Filtro(e, "autz_t", c.op, "v")
		if err != nil {
			t.Fatal(err)
		}
		got, err := Conferir(ctx, p, f, "autz_t", c.linha)
		if err != nil || got != c.ok {
			t.Errorf("%s %v = %v %v, esperava %v", c.op, c.linha, got, err, c.ok)
		}
	}
	nega, _ := Producao.Filtro(&Escopo{ID: eu}, "tabela_que_nao_existe", Ler, "v")
	if ok, err := Conferir(ctx, p, nega, "autz_t", nil); ok || err != nil {
		t.Errorf("filtro que nega = %v %v", ok, err)
	}
}
