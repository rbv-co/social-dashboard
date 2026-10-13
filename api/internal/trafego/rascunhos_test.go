package trafego

import (
	"encoding/json"
	"slices"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// idsRascunhos: os ids da lista devolvida pela rota, NA ORDEM em que vieram.
func idsRascunhos(t *testing.T, m *mundoteste.Mundo, quem, caminho string) []string {
	t.Helper()
	st, corpo := m.Pedir(t, quem, "GET", caminho, "")
	if st != 200 {
		t.Fatalf("GET %s como %s = %d %s", caminho, quem, st, corpo)
	}
	var linhas []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(corpo), &linhas); err != nil {
		t.Fatalf("GET %s: %v: %s", caminho, err, corpo)
	}
	ids := []string{}
	for _, l := range linhas {
		ids = append(ids, l.ID)
	}
	return ids
}

func conferirRascunhos(t *testing.T, m *mundoteste.Mundo, nome, quem, caminho string, ordenado bool, quer ...string) {
	t.Helper()
	got := idsRascunhos(t, m, quem, caminho)
	if !ordenado {
		slices.Sort(got)
		quer = slices.Sorted(slices.Values(quer))
	}
	if !slices.Equal(got, quer) {
		t.Errorf("%s: GET %s como %s devolveu %v, esperava %v", nome, caminho, quem, got, quer)
	}
}

func TestRascunhos(t *testing.T) {
	m := novoMundo(t, montarRascunhos)
	const base = "/gestao-trafego/rascunhos"
	conferirRascunhos(t, m, "gestor de todas", "gestorTodas", base, false, R1, R2, R3)
	conferirRascunhos(t, m, "admin vê tudo", "adminA1", base, false, R1, R2, R3)
	conferirRascunhos(t, m, "o time inteiro na conta que vê", "gestorA1", base, false, R1, R2)
	conferirRascunhos(t, m, "entrar como vê o que o alvo vê", "impersonado", base, false, R1, R2)
	conferirRascunhos(t, m, "gestor sem conta", "gestorNenhuma", base, false)
	conferirRascunhos(t, m, "leitor não é gestor", "leitor", base, false)
	conferirRascunhos(t, m, "super pela ficha não é gestor", "superA1", base, false)
	conferirRascunhos(t, m, "mais novo primeiro", "gestorA1", base+"?account_id="+A1+"&ordem=updated_at.desc&limite=60", true, R2, R1)
	conferirRascunhos(t, m, "conta que não vê", "gestorA1", base+"?account_id="+A2, false)
	conferirRascunhos(t, m, "por status", "gestorTodas", base+"?status=criada", false, R3)

	nome := func(id string) string { return `select nome from gt_campanhas_rascunho where id = '` + id + `'` }
	conta := func(id string) string { return `select account_id from gt_campanhas_rascunho where id = '` + id + `'` }
	total := `select count(*)::text from gt_campanhas_rascunho`
	ok := `{"account_id":"` + A1 + `","estado":{"objetivo":"seguidores"},"passo":1,"nome":"Nova","tipo":"Seguidores","status":"rascunho"}`
	fraseEntrarComo := `"Quem entrou como outra pessoa só consulta."`

	m.Rodar(t, []mundoteste.Caso{
		{Nome: "criar: gestor na conta que vê", Quem: "gestorA1", Metodo: "POST", Caminho: base, Corpo: ok, Status: 201,
			Tem: `"criado_por":"` + idGestorA1 + `"`, Efeito: total, Quer: "4"},
		{Nome: "criar: conta que não vê", Quem: "gestorA1", Metodo: "POST", Caminho: base, Corpo: `{"account_id":"` + A2 + `","nome":"x"}`, Status: 403, Efeito: total, Quer: "4"},
		{Nome: "criar: sem account_id", Quem: "gestorA1", Metodo: "POST", Caminho: base, Corpo: `{"nome":"x"}`, Status: 400, Tem: "Informe account_id.", Efeito: total, Quer: "4"},
		{Nome: "criar: criado_por no corpo", Quem: "gestorA1", Metodo: "POST", Caminho: base, Corpo: `{"criado_por":"` + idGestorTodas + `","account_id":"` + A1 + `"}`, Status: 400, Tem: "corpo_invalido", Efeito: total, Quer: "4"},
		{Nome: "criar: leitor", Quem: "leitor", Metodo: "POST", Caminho: base, Corpo: ok, Status: 403, Efeito: total, Quer: "4"},
		{Nome: "criar: super pela ficha", Quem: "superA1", Metodo: "POST", Caminho: base, Corpo: ok, Status: 403, Efeito: total, Quer: "4"},
		{Nome: "criar: entrar como", Quem: "impersonado", Metodo: "POST", Caminho: base, Corpo: ok, Status: 403, Tem: fraseEntrarComo, Efeito: total, Quer: "4"},
		{Nome: "criar: status fora da lista", Quem: "gestorA1", Metodo: "POST", Caminho: base, Corpo: `{"account_id":"` + A1 + `","status":"enviada"}`, Status: 400, Efeito: total, Quer: "4"},
		{Nome: "criar: estado lista", Quem: "gestorA1", Metodo: "POST", Caminho: base, Corpo: `{"account_id":"` + A1 + `","estado":[]}`, Status: 400, Efeito: total, Quer: "4"},
		{Nome: "criar: passo 51", Quem: "gestorA1", Metodo: "POST", Caminho: base, Corpo: `{"account_id":"` + A1 + `","passo":51}`, Status: 400, Efeito: total, Quer: "4"},

		{Nome: "editar: o dono", Quem: "gestorA1", Metodo: "PATCH", Caminho: base + "/" + R2, Corpo: `{"status":"criada","resultado":{"campanha":"123"}}`, Status: 200, Tem: `"status":"criada"`,
			Efeito: `select (updated_at > '2026-10-11T10:00:00Z')::text from gt_campanhas_rascunho where id = '` + R2 + `'`, Quer: "true"},
		{Nome: "editar: de outra pessoa que vê", Quem: "gestorA1", Metodo: "PATCH", Caminho: base + "/" + R1, Corpo: `{"nome":"Invadido"}`, Status: 403, Efeito: nome(R1), Quer: "Seguidores outubro"},
		{Nome: "editar: de conta que não vê", Quem: "gestorA1", Metodo: "PATCH", Caminho: base + "/" + R3, Corpo: `{"nome":"Invadido"}`, Status: 404, Efeito: nome(R3), Quer: "Vendas Mantova"},
		{Nome: "editar: mover para conta que não vê", Quem: "gestorA1", Metodo: "PATCH", Caminho: base + "/" + R2, Corpo: `{"account_id":"` + A2 + `"}`, Status: 403, Efeito: conta(R2), Quer: A1},
		{Nome: "editar: id que não existe", Quem: "gestorA1", Metodo: "PATCH", Caminho: base + "/abc", Corpo: `{"nome":"x"}`, Status: 404},
		{Nome: "editar: corpo vazio", Quem: "gestorA1", Metodo: "PATCH", Caminho: base + "/" + R2, Corpo: `{}`, Status: 400},
		{Nome: "editar: o dono de outra conta", Quem: "gestorTodas", Metodo: "PATCH", Caminho: base + "/" + R3, Corpo: `{"nome":"x"}`, Status: 200, Efeito: nome(R3), Quer: "x"},
		{Nome: "editar: entrar como", Quem: "impersonado", Metodo: "PATCH", Caminho: base + "/" + R2, Corpo: `{"nome":"y"}`, Status: 403, Tem: fraseEntrarComo, Efeito: nome(R2), Quer: "Mensagens"},

		{Nome: "apagar: de outra pessoa que vê", Quem: "gestorA1", Metodo: "DELETE", Caminho: base + "/" + R1, Status: 403, Efeito: nome(R1), Quer: "Seguidores outubro"},
		{Nome: "apagar: de conta que não vê", Quem: "gestorA1", Metodo: "DELETE", Caminho: base + "/" + R3, Status: 404, Efeito: nome(R3), Quer: "x"},
		{Nome: "apagar: entrar como", Quem: "impersonado", Metodo: "DELETE", Caminho: base + "/" + R2, Status: 403, Tem: fraseEntrarComo, Efeito: nome(R2), Quer: "Mensagens"},
		{Nome: "apagar: o dono", Quem: "gestorA1", Metodo: "DELETE", Caminho: base + "/" + R2, Status: 204, Efeito: `select count(*)::text from gt_campanhas_rascunho where id = '` + R2 + `'`, Quer: "0"},
	})
}
