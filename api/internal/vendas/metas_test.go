package vendas

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// fotoDasMetas: um hash das duas tabelas de meta; igual antes e depois = nada foi gravado.
const fotoDasMetas = `select md5(coalesce((select string_agg(t::text, '|' order by id) from bling_metas t), '') ||
	coalesce((select string_agg(t::text, '|' order by id) from bling_vendedor_metas t), ''))`

func TestMetasLeitura(t *testing.T) {
	m := novoMundo(t, montarMetas)
	pedir := func(caminho string) (int, string) { return m.Pedir(t, "viewer", http.MethodGet, caminho, "") }
	if st, c := pedir("/comercial/metas-lojas?ano=2026&mes=10"); st != 200 || chaves(t, c, "loja_id") != "0,1" {
		t.Errorf("metas de outubro = %d %s", st, c)
	} else if !strings.Contains(c, `"daily_goals":{"1": 2000, "2": 2000}`) {
		t.Errorf("daily_goals não veio como objeto: %s", c)
	}
	if st, c := pedir("/comercial/metas-lojas?ano=2026&mes=9"); st != 200 || chaves(t, c, "loja_id") != "2" {
		t.Errorf("metas de setembro = %d %s", st, c)
	}
	if st, c := pedir("/comercial/metas-vendedoras?ano=2026&mes=10"); st != 200 || chaves(t, c, "vendor_id") != "7" {
		t.Errorf("metas das vendedoras = %d %s", st, c)
	}
	if st, _ := pedir("/comercial/metas-lojas?ano=x"); st != http.StatusBadRequest {
		t.Errorf("ano inválido = %d", st)
	}
}

const metasDoContrato = `{"ano":2026,"mes":10,
 "lojas":{"gravar":[{"loja_id":1,"meta_valor":80000,"daily_goals":{"1":40000,"2":40000}},{"loja_id":2,"meta_valor":50000,"daily_goals":null}],"apagar":[0]},
 "vendedoras":{"gravar":[{"vendor_id":8,"meta_valor":15000,"daily_goals":null}],"apagar":[7]}}`

func TestSalvarMetas(t *testing.T) {
	m := novoMundo(t, montarMetas)
	const (
		lojasOut  = `select string_agg(loja_id || ':' || meta_valor::bigint || ':' || coalesce(daily_goals::text, '-'), ',' order by loja_id) from bling_metas where year = 2026 and month = 10`
		lojasSet  = `select string_agg(loja_id::text, ',') from bling_metas where year = 2026 and month = 9`
		vendasOut = `select string_agg(vendor_id || ':' || meta_valor::bigint, ',' order by vendor_id) from bling_vendedor_metas where year = 2026 and month = 10`
	)
	salvar := func(quem, corpo string) (int, string) {
		return m.Pedir(t, quem, http.MethodPost, "/comercial/metas/salvar", corpo)
	}

	// 1. o salvamento do contrato: cria, edita (a meta da loja 1 segue com o id 2) e apaga
	if st, c := salvar("admin", metasDoContrato); st != 200 || c != `{"gravadas":3,"apagadas":2}` {
		t.Fatalf("salvar = %d %s", st, c)
	}
	m.Rodar(t, []caso{
		{Nome: "lojas de outubro", Efeito: lojasOut, Quer: `1:80000:{"1": 40000, "2": 40000},2:50000:-`},
		{Nome: "meta da loja 1 editada, não duplicada", Efeito: `select id::text from bling_metas where loja_id = 1 and year = 2026 and month = 10`, Quer: "2"},
		{Nome: "setembro intacto", Efeito: lojasSet, Quer: "2"},
		{Nome: "vendedoras", Efeito: vendasOut, Quer: "8:15000"},
	})
	foto := m.Um(t, fotoDasMetas)
	semEfeito := func(nome, quem, corpo string, status int, tem string) {
		t.Helper()
		st, c := salvar(quem, corpo)
		if st != status || !strings.Contains(c, tem) {
			t.Errorf("%s: %d %s; esperava %d com %q", nome, st, c, status, tem)
		}
		if v := m.Um(t, fotoDasMetas); v != foto {
			t.Errorf("%s: gravou alguma coisa", nome)
		}
	}

	// 2. tudo ou nada: a linha seguinte (apagar o que não existe) desfaz a anterior da MESMA transação
	semEfeito("tudo ou nada", "admin", `{"ano":2026,"mes":10,"lojas":{"gravar":[{"loja_id":4,"meta_valor":1000}],"apagar":[3]}}`, 404, "")

	// 3. quem não pode
	um := `{"ano":2026,"mes":10,"lojas":{"gravar":[{"loja_id":1,"meta_valor":1}]}}`
	semEfeito("super com papel viewer (paridade)", "super", um, 403, "")
	semEfeito("vendedora", "vendT1", um, 403, "")
	semEfeito("sem trava", "semTrava", um, 403, "")
	semEfeito("entrar como", "impersonado", um, 403, dados.FraseEntrarComo)

	// 4. pedido inválido: 400 e nada gravado
	lojaCom := func(campos string) string {
		return `{"ano":2026,"mes":10,"lojas":{"gravar":[{"loja_id":1,` + campos + `}]}}`
	}
	var dias33 []string
	for i := 1; i <= 32; i++ {
		dias33 = append(dias33, fmt.Sprintf(`"%d":1`, i))
	}
	var muitas []string
	for i := range 501 {
		muitas = append(muitas, fmt.Sprintf(`{"loja_id":%d,"meta_valor":1}`, 1000+i))
	}
	for nome, corpo := range map[string]string{
		"valor negativo":        lojaCom(`"meta_valor":-1`),
		"valor zero":            lojaCom(`"meta_valor":0`),
		"valor em texto":        lojaCom(`"meta_valor":"80000"`),
		"três casas":            lojaCom(`"meta_valor":80000.123`),
		"notação científica":    lojaCom(`"meta_valor":1e5`),
		"valor grande demais":   lojaCom(`"meta_valor":1000000000`),
		"diárias em lista":      lojaCom(`"meta_valor":1,"daily_goals":[1,2]`),
		"diária negativa":       lojaCom(`"meta_valor":1,"daily_goals":{"1":-5}`),
		"chave de dia inválida": lojaCom(`"meta_valor":1,"daily_goals":{"1; drop":1}`),
		"32 dias":               lojaCom(`"meta_valor":1,"daily_goals":{` + strings.Join(dias33, ",") + `}`),
		"ano 1999":              `{"ano":1999,"mes":10,"lojas":{"gravar":[{"loja_id":1,"meta_valor":1}]}}`,
		"mês 13":                `{"ano":2026,"mes":13,"lojas":{"gravar":[{"loja_id":1,"meta_valor":1}]}}`,
		"gravar e apagar":       `{"ano":2026,"mes":10,"lojas":{"gravar":[{"loja_id":1,"meta_valor":1}],"apagar":[1]}}`,
		"sem metas":             `{"ano":2026,"mes":10}`,
		"501 metas":             `{"ano":2026,"mes":10,"lojas":{"gravar":[` + strings.Join(muitas, ",") + `]}}`,
		"vendedora 0":           `{"ano":2026,"mes":10,"vendedoras":{"gravar":[{"vendor_id":0,"meta_valor":1}]}}`,
		"mesma loja duas vezes": `{"ano":2026,"mes":10,"lojas":{"gravar":[{"loja_id":1,"meta_valor":1},{"loja_id":1,"meta_valor":2}]}}`,
	} {
		semEfeito(nome, "admin", corpo, 400, "pedido_invalido")
	}
	semEfeito("campo desconhecido", "admin", lojaCom(`"meta_valor":1,"nome":"x"`), 400, "corpo_invalido")
	if _, c := salvar("admin", `{"ano":2026,"mes":10}`); !strings.Contains(c, "Nada para gravar.") {
		t.Errorf("sem metas: %s", c)
	}

	// 5. o banco tem único (loja, ano, mês): a duplicata que o plano temia não existe
	if _, err := m.P.Exec(t.Context(), `insert into bling_metas (loja_id, year, month, meta_valor) values (1, 2026, 10, 1)`); err == nil {
		t.Error("o banco aceitou uma segunda meta da loja 1 no mês")
	}
}

// Dois salvamentos simultâneos do mesmo mês, criando a mesma meta: as duas 200 e uma linha só.
func TestSalvarMetasSemCorrida(t *testing.T) {
	m := novoMundo(t, montarMetas)
	for i := range 10 {
		loja := 40 + i
		aoMesmoTempo(func(lado int) {
			corpo := fmt.Sprintf(`{"ano":2026,"mes":11,"lojas":{"gravar":[{"loja_id":%d,"meta_valor":%d}]}}`, loja, 1000+lado)
			if st, c := m.Pedir(t, "admin", http.MethodPost, "/comercial/metas/salvar", corpo); st != 200 {
				t.Errorf("loja %d lado %d = %d %s", loja, lado, st, c)
			}
		})
		if v := m.Um(t, fmt.Sprintf(`select count(*)::text from bling_metas where loja_id = %d and year = 2026 and month = 11`, loja)); v != "1" {
			t.Fatalf("loja %d: %s linhas", loja, v)
		}
	}
}
