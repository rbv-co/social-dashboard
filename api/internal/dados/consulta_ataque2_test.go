package dados

import (
	"errors"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// Segunda rodada da revisão: três classes de vazamento na gramática (A: vírgula depois do on abre
// um from novo; B: o que vem depois do ")" do grupo do marcador; C: o and do BETWEEN).
func TestConsultaRecusaVazamentosDaSegundaRevisao(t *testing.T) {
	cat, err := autz.Compilar([]byte(catalogoDeAtaque))
	if err != nil {
		t.Fatal(err)
	}
	comOnde := func(onde string) Consulta {
		c := consultaAtaque("select c.nome from coisa c")
		c.Onde = onde
		return c
	}
	casos := map[string]Consulta{
		// A: depois da vírgula o Postgres abre um item novo do from; a tabela nunca era vista
		"A: vírgula depois do on, nível 0":     consultaAtaque("select c.nome, k.id as vaza from coisa c join generate_series(1, 2) g on true, conta k"),
		"A: vírgula depois do on, subconsulta": consultaAtaque("select c.nome, (select count(*) from conta m join generate_series(1, 2) g on true, eq_b k where {ler:conta:m}) as n from coisa c"),
		"A: vírgula depois do on com marcador": consultaAtaque("select c.nome, k.id from coisa c left join conta m on {ler:conta:m} and m.id = c.dona, conta k"),
		"A: vírgula no where da subconsulta":   consultaAtaque("select c.nome, (select count(*) from conta m where {ler:conta:m}, eq_b k) as n from coisa c"),
		// B: o grupo do marcador seguido de operador inverte ou cancela a regra
		"B: grupo seguido de = false":          consultaAtaque("select c.nome, (select json_agg(k.id) from conta k where k.id = c.dona and ({ler:conta:k}) = false) from coisa c"),
		"B: grupo seguido de is not true":      consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and ({ler:conta:k}) is not true"),
		"B: grupo seguido de cast":             consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and ({ler:conta:k})::text = 'false'"),
		"B: grupo seguido de in":               consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and ({ler:conta:k}) in (false)"),
		"B: grupo seguido de is false":         consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and ({ler:conta:k}) is false"),
		"B: grupo duplo seguido de comparação": consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and (({ler:conta:k})) = false"),
		"B: Onde, oráculo de existência":       comOnde("exists (select 1 from conta k where ({ler:conta:k}) is false)"),
		"B: Onde, marcador solto no topo":      comOnde("{ler:conta:k}"),
		"B: Onde, marcador negado no topo":     comOnde("not {ler:conta:k}"),
		"B: marcador na lista do select":       consultaAtaque("select c.nome, {ler:conta:k} as x from coisa c"),
		// C: o and do between é parte do between, não um termo de and
		"C: between ... and marcador":             consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and c.nome between 'a' and {ler:conta:k}"),
		"C: between symmetric":                    consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and c.nome between symmetric 'a' and {ler:conta:k}"),
		"C: not between":                          consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and c.nome not between 'a' and {ler:conta:k}"),
		"C: between na subconsulta":               consultaAtaque("select c.nome, (select json_agg(k.id) from conta k where c.nome between 'a' and {ler:conta:k}) from coisa c"),
		"C: between fora da condição do marcador": consultaAtaque("select c.nome, c.nome between 'a' and 'b' from coisa c"),
	}
	for nome, c := range casos {
		err := c.Validar(cat)
		switch {
		case err == nil:
			t.Errorf("%s: ACEITO (vazaria dados)", nome)
		case !errors.Is(err, ErrDeclaracao):
			t.Errorf("%s: recusado sem ErrDeclaracao: %v", nome, err)
		}
	}
	ok := map[string]Consulta{
		"grupo duplo sozinho":                   consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and (({ler:conta:k}))"),
		"grupo entre ands":                      consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and ({ler:conta:k}) and k.id <> ''"),
		"grupo com outros termos":               consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and ({ler:conta:k} and k.id <> '')"),
		"intervalo com >= e <=":                 consultaAtaque("select c.nome, k.id from coisa c left join conta k on k.id = c.dona and c.nome >= 'a' and c.nome <= 'z' and {ler:conta:k}"),
		"duas junções com vírgula só em função": consultaAtaque("select c.nome from coisa c, jsonb_array_elements(c.dona::jsonb) e"),
	}
	for nome, c := range ok {
		if err := c.Validar(cat); err != nil {
			t.Errorf("%s: recusado: %v", nome, err)
		}
	}
}
