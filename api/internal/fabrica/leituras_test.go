package fabrica

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

func mundoLeituras(t *testing.T) *mundoteste.Mundo {
	return novoMundo(t, func(r chi.Router, p *pgxpool.Pool) { montarLeituras(r, p) })
}

var abertas = []string{"/fabrica/lojas", "/fabrica/objetivos", "/fabrica/marcas", "/fabrica/looks",
	"/fabrica/publicos", "/fabrica/campanhas", "/fabrica/criativos", "/fabrica/jobs", "/fabrica/meta-jobs"}

// ids devolve o campo `campo` de cada linha, na ordem.
func ids(t *testing.T, corpo, campo string) []string {
	t.Helper()
	var linhas []map[string]any
	if err := json.Unmarshal([]byte(corpo), &linhas); err != nil {
		t.Fatalf("corpo %q: %v", corpo, err)
	}
	var out []string
	for _, l := range linhas {
		out = append(out, l[campo].(string))
	}
	return out
}

func TestLeituras(t *testing.T) {
	m := mundoLeituras(t)

	// As 9 rotas: qualquer sessão ativa lê (regra Ler = true; marcas filtra por conta); desativado e anônimo, 401.
	for _, rota := range abertas {
		for _, quem := range []string{"fabricante", "leitor", "semModulo", "impersonado", "robo"} {
			if st, corpo := m.Pedir(t, quem, "GET", rota, ""); st != 200 || !strings.HasPrefix(corpo, "[") {
				t.Errorf("%s como %s = %d %s", rota, quem, st, corpo)
			}
		}
		for _, quem := range []string{"desativado", ""} {
			if st, _ := m.Pedir(t, quem, "GET", rota, ""); st != 401 {
				t.Errorf("%s como %q = %d, esperava 401", rota, quem, st)
			}
		}
	}

	// Marcas: a única com a restritiva (pode_ver_conta). A varredura procura o uuid de A2 em quem não vê A2.
	for _, quem := range []string{"fabricante", "adminA1", "super", "robo"} {
		_, corpo := m.Pedir(t, quem, "GET", "/fabrica/marcas", "")
		if !strings.Contains(corpo, M1) || !strings.Contains(corpo, M2) {
			t.Errorf("%s deveria ver M1 e M2: %s", quem, corpo)
		}
	}
	for _, quem := range []string{"fabricanteA1", "impersonado"} {
		_, corpo := m.Pedir(t, quem, "GET", "/fabrica/marcas", "")
		if !strings.Contains(corpo, M1) || strings.Contains(corpo, M2) || strings.Contains(corpo, A2) {
			t.Errorf("%s deveria ver só M1: %s", quem, corpo)
		}
	}
	if _, corpo := m.Pedir(t, "fabricanteNenhuma", "GET", "/fabrica/marcas", ""); strings.TrimSpace(corpo) != "[]" {
		t.Errorf("fabricanteNenhuma = %s, esperava []", corpo)
	}
	if _, corpo := m.Pedir(t, "fabricanteA1", "GET", "/fabrica/marcas?account_id="+A2, ""); strings.TrimSpace(corpo) != "[]" {
		t.Errorf("fabricanteA1 ?account_id=A2 = %s, esperava []", corpo)
	}
	for quem, n := range map[string]string{"fabricanteA1": "1", "fabricante": "2"} {
		if h := m.Resposta(t, quem, "GET", "/fabrica/marcas?contar=1", "").Header().Get("X-Total-Count"); h != n {
			t.Errorf("%s X-Total-Count = %q, esperava %s", quem, h, n)
		}
	}

	// Filtros e ordem.
	_, corpo := m.Pedir(t, "fabricante", "GET", "/fabrica/lojas?ativo=true", "")
	if got := ids(t, corpo, "deposito_id"); strings.Join(got, ",") != "14888726315,14888726277" {
		t.Errorf("lojas ativas = %v", got)
	}
	_, corpo = m.Pedir(t, "fabricante", "GET", "/fabrica/objetivos?ativo=true", "")
	if got := ids(t, corpo, "chave"); strings.Join(got, ",") != "engajamento,branding" {
		t.Errorf("objetivos ativos = %v", got)
	}
	_, corpo = m.Pedir(t, "fabricante", "GET", "/fabrica/objetivos?chave=branding", "")
	if got := ids(t, corpo, "chave"); len(got) != 1 || !strings.Contains(corpo, `"pede_desconto":false`) {
		t.Errorf("objetivo branding = %s", corpo)
	}
	_, corpo = m.Pedir(t, "fabricante", "GET", "/fabrica/looks", "")
	if got := ids(t, corpo, "chave"); strings.Join(got, ",") != "produto-heroi,promo-sage,marca-velha" {
		t.Errorf("looks = %v", got)
	}
	_, corpo = m.Pedir(t, "fabricante", "GET", "/fabrica/publicos?ativo=true", "")
	if got := ids(t, corpo, "id"); len(got) != 1 || got[0] != P1 {
		t.Errorf("públicos ativos = %v", got)
	}
	_, corpo = m.Pedir(t, "fabricante", "GET", "/fabrica/campanhas?aberta=true&purgada=false&status=gerando,pronta,erro&ordem=created_at.desc", "")
	if got := ids(t, corpo, "id"); strings.Join(got, ",") != C2+","+C1 {
		t.Errorf("campanhas abertas = %v", got)
	}
	var cs []map[string]any
	json.Unmarshal([]byte(corpo), &cs)
	if cs[1]["qtd_criativos"].(float64) != 2 {
		t.Errorf("qtd_criativos de C1 = %v, esperava 2", cs[1]["qtd_criativos"])
	}
	_, corpo = m.Pedir(t, "fabricante", "GET", "/fabrica/campanhas?aberta=false&ordem=fechada_em.desc&limite=8", "")
	if got := ids(t, corpo, "id"); strings.Join(got, ",") != C3+","+C4 {
		t.Errorf("campanhas fechadas = %v", got)
	}
	if h := m.Resposta(t, "fabricante", "GET", "/fabrica/criativos?limite=1&contar=1", "").Header().Get("X-Total-Count"); h != "4" {
		t.Errorf("criativos X-Total-Count = %q, esperava 4", h)
	}
	_, corpo = m.Pedir(t, "fabricante", "GET", "/fabrica/criativos?campanha_id="+C1+"&escolhido=true&purgado=false", "")
	if got := ids(t, corpo, "id"); len(got) != 1 || got[0] != K1 {
		t.Errorf("criativos escolhidos de C1 = %v", got)
	}
	_, corpo = m.Pedir(t, "robo", "GET", "/fabrica/jobs?campanha_id="+C1, "")
	if got := ids(t, corpo, "id"); len(got) != 1 || got[0] != J1 || !strings.Contains(corpo, `"params"`) || strings.Contains(corpo, "criado_por") {
		t.Errorf("jobs de C1 = %s", corpo)
	}
	_, corpo = m.Pedir(t, "fabricante", "GET", "/fabrica/jobs?tipo=subir&campanha_id="+C3+"&ordem=created_at.desc&limite=1", "")
	if got := ids(t, corpo, "id"); len(got) != 1 || got[0] != J2 {
		t.Errorf("job subir de C3 = %v", got)
	}
	_, corpo = m.Pedir(t, "fabricante", "GET", "/fabrica/meta-jobs?campanha_id="+C3+","+C2+"&com_campanha_meta=true", "")
	if got := ids(t, corpo, "id"); len(got) != 1 || got[0] != MJ1 {
		t.Errorf("meta-jobs com campanha = %v", got)
	}
	_, corpo = m.Pedir(t, "robo", "GET", "/fabrica/meta-jobs?tipo=estudio&campanha_id="+C3, "")
	if got := ids(t, corpo, "id"); len(got) != 1 || got[0] != MJ1 {
		t.Errorf("meta-jobs estudio = %v", got)
	}

	// Divergência do brief: `status=` (lista vazia) não é 400 na gramática do 5.0 (texto[] aceita [""]); vira
	// "nenhuma linha", sem vazar nada. Fica assertado como é.
	if st, corpo := m.Pedir(t, "fabricante", "GET", "/fabrica/campanhas?status=", ""); st != 200 || strings.TrimSpace(corpo) != "[]" {
		t.Errorf("status= vazio = %d %s, esperava 200 []", st, corpo)
	}

	// 400: o pedido fora da lista branca não chega ao banco.
	for _, rota := range []string{"/fabrica/campanhas?ordem=nome", "/fabrica/campanhas?aberta=talvez",
		"/fabrica/criativos?campanha_id=xyz", "/fabrica/jobs?criado_por=" + idFabricante, "/fabrica/lojas?limite=1001"} {
		if st, corpo := m.Pedir(t, "fabricante", "GET", rota, ""); st != 400 {
			t.Errorf("%s = %d %s, esperava 400", rota, st, corpo)
		}
	}
}

func TestEscolher(t *testing.T) {
	m := mundoLeituras(t)
	const efeito = `select string_agg(escolhido::text, ',' order by id) from fabrica_criativos where id in ('` + K1 + `','` + K2 + `')`
	const volta = `update fabrica_criativos set escolhido = (id = '` + K1 + `') where id in ('` + K1 + `','` + K2 + `')`
	corpo := func(ids ...string) string {
		return `{"ids":["` + strings.Join(ids, `","`) + `"],"escolhido":false}`
	}
	const rota = "/fabrica/criativos/escolher"

	// Permitido: Fabricante (por permissions, lista, papel ou ficha). Repetidos contam uma vez.
	for _, quem := range []string{"fabricante", "chaveEmLista", "super", "adminA1"} {
		m.Rodar(t, []mundoteste.Caso{{Nome: "permitido " + quem, Quem: quem, Metodo: "POST", Caminho: rota,
			Corpo: corpo(K2, K1, K1), Status: 200, Tem: `"atualizados":2`, Efeito: efeito, Quer: "false,false"}})
		if _, err := m.P.Exec(t.Context(), volta); err != nil {
			t.Fatal(err)
		}
	}

	foto := m.Um(t, fotoDaFabrica)
	intacto := func(nome string) {
		t.Helper()
		if f := m.Um(t, fotoDaFabrica); f != foto {
			t.Errorf("%s: o banco mudou", nome)
		}
	}
	casos := []mundoteste.Caso{
		{Nome: "leitor", Quem: "leitor", Metodo: "POST", Caminho: rota, Corpo: corpo(K1), Status: 403},
		{Nome: "semModulo", Quem: "semModulo", Metodo: "POST", Caminho: rota, Corpo: corpo(K1), Status: 403},
		{Nome: "roboSemFabrica", Quem: "roboSemFabrica", Metodo: "POST", Caminho: rota, Corpo: corpo(K1), Status: 403},
		{Nome: "impersonado", Quem: "impersonado", Metodo: "POST", Caminho: rota, Corpo: corpo(K1), Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "id inexistente desfaz tudo", Quem: "fabricante", Metodo: "POST", Caminho: rota,
			Corpo: corpo(K1, "a5840000-0000-4000-a000-0000000000ff"), Status: 404, Efeito: efeito, Quer: "true,false"},
		{Nome: "sem escolhido", Quem: "fabricante", Metodo: "POST", Caminho: rota, Corpo: `{"ids":["` + K1 + `"]}`, Status: 400},
		{Nome: "escolhido texto", Quem: "fabricante", Metodo: "POST", Caminho: rota, Corpo: `{"ids":["` + K1 + `"],"escolhido":"sim"}`, Status: 400},
		{Nome: "ids vazio", Quem: "fabricante", Metodo: "POST", Caminho: rota, Corpo: `{"ids":[],"escolhido":true}`, Status: 400},
		{Nome: "id não uuid", Quem: "fabricante", Metodo: "POST", Caminho: rota, Corpo: corpo("x"), Status: 400},
		{Nome: "501 ids", Quem: "fabricante", Metodo: "POST", Caminho: rota,
			Corpo: corpo(strings.Split(strings.Repeat(K1+",", 501), ",")[:501]...), Status: 400},
		{Nome: "sem sessão", Quem: "", Metodo: "POST", Caminho: rota, Corpo: corpo(K1), Status: 401},
	}
	for _, c := range casos {
		m.Rodar(t, []mundoteste.Caso{c})
		intacto(c.Nome)
	}
}
