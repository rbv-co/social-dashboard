package publico

import (
	"regexp"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

var reArg = regexp.MustCompile(`^(p_[a-z0-9_]+) (.+?)( DEFAULT .+)?$`)

// Cada declaração (nome, tipo e DEFAULT de cada parâmetro, retorno json) é a assinatura da função de produção no
// esquema carregado do levantamento: parâmetro trocado ou DEFAULT esquecido aqui reprova.
func TestDeclaracoesIguaisAsFuncoes(t *testing.T) {
	m := novoMundo(t)
	todas := append(append([]rpc.Funcao{}, interno...), publico...)
	if len(interno) != 14 || len(publico) != 10 {
		t.Fatalf("%d de escrita e %d de leitura; esperava 14 e 10", len(interno), len(publico))
	}
	vistos := map[string]bool{}
	for _, f := range todas {
		if vistos[f.Nome] {
			t.Errorf("%s declarada duas vezes", f.Nome)
		}
		vistos[f.Nome] = true
		args := m.um(t, `select pg_get_function_arguments(p.oid) from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, f.Nome)
		if got := m.um(t, `select pg_get_function_result(p.oid) from pg_proc p where p.proname = $1 and p.pronamespace = 'public'::regnamespace`, f.Nome); got != "json" {
			t.Errorf("%s devolve %q: a rota pública só repassa json", f.Nome, got)
		}
		var reais []rpc.Param
		if args != "" {
			for _, a := range strings.Split(args, ", ") {
				x := reArg.FindStringSubmatch(a)
				if x == nil {
					t.Fatalf("%s: argumento %q fora do formato", f.Nome, a)
				}
				tipo := strings.ReplaceAll(x[2], "timestamp with time zone", "timestamptz")
				reais = append(reais, rpc.Param{Nome: x[1], Tipo: tipo, Opcional: x[3] != ""})
			}
		}
		if len(reais) != len(f.Params) {
			t.Errorf("%s: %d parâmetros declarados, a função tem %d (%s)", f.Nome, len(f.Params), len(reais), args)
			continue
		}
		for i, r := range reais {
			if f.Params[i] != r {
				t.Errorf("%s parâmetro %d: declarado %+v, a função tem %+v", f.Nome, i+1, f.Params[i], r)
			}
		}
	}
}
