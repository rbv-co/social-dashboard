package autz

import (
	"slices"
	"testing"
)

// ColunasDaLinhaNova lê o formato do SQL que o próprio Filtro gera ("autz_nova"."coluna"). Se o autz
// mudar esse formato, este teste falha em vez de dados.Tabela deixar de exigir as colunas da regra.
func TestColunasDaLinhaNovaAcompanhaOFormatoDoFiltro(t *testing.T) {
	e := &Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, Papel: "viewer"}
	for tab, quer := range map[string][]string{
		"push_preferencias": {"user_id"},
		"push_subs":         {"user_id"},
	} {
		f, err := Producao.Filtro(e, tab, Criar, "autz_nova")
		if err != nil {
			t.Fatal(err)
		}
		if got := ColunasDaLinhaNova(f); !slices.Equal(got, quer) {
			t.Errorf("%s: colunas = %v, esperava %v (SQL: %s)", tab, got, quer, f.SQL)
		}
	}
	// sem a regra citar a linha nova (a regra `true`), não há coluna a exigir
	f, err := Producao.Filtro(e, "acessos_perfis", Ler, "autz_nova")
	if err != nil {
		t.Fatal(err)
	}
	if got := ColunasDaLinhaNova(f); len(got) != 0 {
		t.Errorf("regra true devolveu colunas %v", got)
	}
}
