package autz

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestCatalogoEmbutidoIgualAoDosDocs(t *testing.T) {
	docs, err := os.ReadFile("../../../docs/migracao-go/catalogo-policies-producao.json")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(docs, catalogoProducao) {
		t.Fatal("api/internal/autz/catalogo-policies-producao.json difere de docs/migracao-go/: copie o dos docs")
	}
}

func TestCatalogoDeProducaoCompilaInteiro(t *testing.T) {
	if n := len(Producao.Tabelas()); n != 144 {
		t.Fatalf("tabelas = %d, esperava 144", n)
	}
}

// Forma que o pacote não conhece NUNCA vira liberado: a compilação falha.
func TestFormaDesconhecidaFalha(t *testing.T) {
	for _, expr := range []string{
		`is_dono_de_tudo()`, `(auth.role() = 'anon'::text)`, `vessel_pode('atendimentos'::text, 'apagar'::text)`,
		`vessel_pode('outra'::text, 'ver'::text)`, `(EXISTS ( SELECT 1 FROM profiles p WHERE ((p.id = auth.uid()) AND (p.email ~~ '%@rbv%'::text))))`,
		`(true OR is_hacker())`,
	} {
		j := `[{"tabela":"t","nome":"n","tipo":"permissive","comando":"select","papeis":["authenticated"],"using":` + strings.ReplaceAll(`"`+expr+`"`, `'`, `'`) + `,"withCheck":null}]`
		if _, err := Compilar([]byte(j)); err == nil {
			t.Errorf("%s compilou", expr)
		}
	}
}

// O SQL do filtro: constante quando só depende de quem pede; com a linha, parâmetros nomeados
// com cast e prefixo por alias×op (dois filtros na mesma consulta não colidem); entrada ruim nega.
func TestFiltroFormaDoSQL(t *testing.T) {
	comum := &Escopo{ID: "11111111-0000-4000-a000-000000000001", TemPerfil: true, Ativo: true, Papel: "viewer", SemTrava: true}
	frota := &Escopo{ID: comum.ID, TemPerfil: true, Ativo: true, Modulos: []string{"frota"}}
	contas := &Escopo{ID: comum.ID, TemPerfil: true, Ativo: true, Contas: []string{"A1"}}
	casos := []struct {
		e     *Escopo
		tab   string
		op    Op
		sql   string
		nArgs int
	}{
		{comum, "frota_veiculos", Ler, "false", 0},
		{frota, "frota_veiculos", Ler, "true", 0},
		{frota, "frota_requisicoes", Criar, `("v"."criada_por" = @autz_v_1_1::uuid)`, 1},
		{contas, "campaigns", Ler, `("v"."account_id" is null or "v"."account_id"::text = any(@autz_v_0_1::text[]))`, 1},
		{comum, "push_subs", Apagar, `(("v"."user_id" = @autz_v_4_1::uuid) and ("v"."user_id" = @autz_v_4_2::uuid))`, 2},
	}
	for _, c := range casos {
		f, err := Producao.Filtro(c.e, c.tab, c.op, "v")
		if err != nil || f.SQL != c.sql || len(f.Args) != c.nArgs {
			t.Errorf("%s×%s = %q %v (%d args)", c.tab, c.op, f.SQL, err, len(f.Args))
		}
	}
	for nome, chamar := range map[string]func() (Filtro, error){
		"tabela fora":   func() (Filtro, error) { return Producao.Filtro(comum, "tabela_que_nao_existe", Ler, "v") },
		"sem escopo":    func() (Filtro, error) { return Producao.Filtro(nil, "push_subs", Ler, "v") },
		"alias injeção": func() (Filtro, error) { return Producao.Filtro(comum, "push_subs", Ler, `v" or true --`) },
	} {
		if f, err := chamar(); err == nil || !f.Nega() {
			t.Errorf("%s: %q %v", nome, f.SQL, err)
		}
	}
}
