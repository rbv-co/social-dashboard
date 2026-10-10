package canais

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
)

func p64(v int64) *int64  { return &v }
func ps(v string) *string { return &v }

const (
	domPedro = int64(205657609)
	tivoli   = int64(205834140)
	atacado1 = int64(205395333)
	fabrica  = int64(205451611)
)

var (
	times = []Time{
		{ID: "t-dompedro", CanalLojaID: p64(domPedro)},
		{ID: "t-tivoli", CanalLojaID: p64(tivoli)},
		{ID: "t-marketing"}, // setor sem canal
		{ID: "t-atacado", CanalLojaID: p64(atacado1)},
	}
	lojas = []Canal{
		{LojaID: domPedro, Grupo: ps("Varejo"), GrupoID: ps("g-varejo")},
		{LojaID: tivoli, Grupo: ps(" varejo "), GrupoID: ps("g-varejo")},
		{LojaID: atacado1, Grupo: ps("Atacado"), GrupoID: ps("g-atacado")},
		{LojaID: fabrica, Grupo: ps("ATACADO"), GrupoID: ps("g-atacado")},
		{LojaID: 999, Grupo: nil}, // canal sem grupo
	}
)

func limitada(membros []Membro, grupos ...MembroDeGrupo) []int64 {
	return DoEscopo(Escopo{PorEquipe: true, MeuID: "u1", Times: times, Membros: membros, Canais: lojas, MembrosDeGrupo: grupos})
}

func TestDoEscopo(t *testing.T) {
	casos := []struct {
		nome string
		got  []int64
		quer []int64 // nil = todos
	}{
		{"super-admin não é limitado", DoEscopo(Escopo{SuperAdmin: true, PorEquipe: true, MeuID: "u1"}), nil},
		{"fora do escopo por equipe vê tudo", DoEscopo(Escopo{PorEquipe: false, MeuID: "u1", Times: times}), nil},
		{"vendedora do Dom Pedro só vê o Dom Pedro", limitada([]Membro{{"t-dompedro", "u1", "vendedora"}}), []int64{domPedro}},
		{"dois times = dois canais", limitada([]Membro{{"t-dompedro", "u1", "vendedora"}, {"t-tivoli", "u1", "gestor"}}), []int64{domPedro, tivoli}},
		{"limitada sem time vê NADA", limitada(nil), []int64{}},
		{"time sem canal não acrescenta", limitada([]Membro{{"t-marketing", "u1", "vendedora"}}), []int64{}},
		{"sem id de usuário não vê tudo", DoEscopo(Escopo{PorEquipe: true, Times: times}), []int64{}},
		{"vínculo de OUTRA pessoa não conta", limitada([]Membro{{"t-tivoli", "u2", "supervisora"}}), []int64{}},
		{"papel ausente = vendedora (não amplia)", limitada([]Membro{{"t-dompedro", "u1", ""}}), []int64{domPedro}},
		{"supervisora vê o grupo inteiro (maiúscula e espaço não importam)",
			limitada([]Membro{{"t-atacado", "u1", "supervisora"}}), []int64{atacado1, fabrica}},
		{"supervisora de grupo (canais_grupos_membros) vê o grupo",
			limitada(nil, MembroDeGrupo{"g-varejo", "u1", "supervisora"}), []int64{domPedro, tivoli}},
		{"vínculo de grupo sem papel não amplia", limitada(nil, MembroDeGrupo{"g-varejo", "u1", ""}), []int64{}},
		{"vínculo de grupo de outra pessoa não conta", limitada(nil, MembroDeGrupo{"g-varejo", "u2", "supervisora"}), []int64{}},
		{"canal repetido não duplica",
			limitada([]Membro{{"t-dompedro", "u1", "supervisora"}}, MembroDeGrupo{"g-varejo", "u1", "supervisora"}), []int64{domPedro, tivoli}},
	}
	for _, c := range casos {
		if (c.got == nil) != (c.quer == nil) || !slices.Equal(c.got, c.quer) {
			t.Errorf("%s: %v, esperava %v", c.nome, c.got, c.quer)
		}
	}
	if sem := DoEscopo(Escopo{PorEquipe: true, MeuID: "u1", Times: []Time{{ID: "t", CanalLojaID: p64(999)}},
		Membros: []Membro{{"t", "u1", "supervisora"}}, Canais: lojas}); !slices.Equal(sem, []int64{999}) {
		t.Errorf("canal sem grupo não pode ampliar: %v", sem)
	}
}

func decod(t *testing.T, s string) any {
	t.Helper()
	d := json.NewDecoder(strings.NewReader(s))
	d.UseNumber()
	var v any
	if err := d.Decode(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestRecortar(t *testing.T) {
	lista := decod(t, `{"data":[{"id":1,"loja":{"id":205657609}},{"id":2,"loja":{"id":205834140}},{"id":3},{"id":4,"loja":{"id":"205657609"}}],"pagina":3}`)
	if c, neg := Recortar("pedidos/vendas", lista, nil); neg || c.(map[string]any)["pagina"] == nil {
		t.Fatal("sem limite o corpo passa intacto")
	}
	c, neg := Recortar("pedidos/vendas", lista, []int64{domPedro})
	b, _ := json.Marshal(c)
	if neg || string(b) != `{"data":[{"id":1,"loja":{"id":205657609}},{"id":4,"loja":{"id":"205657609"}}],"pagina":3}` {
		t.Fatalf("lista recortada = %s", b)
	}
	if c, _ := Recortar("pedidos/vendas", lista, []int64{}); len(c.(map[string]any)["data"].([]any)) != 0 {
		t.Fatal("sem canal a lista vem vazia, não inteira")
	}
	erro := decod(t, `{"error":{"type":"x"}}`)
	if c, neg := Recortar("pedidos/vendas", erro, []int64{domPedro}); neg || c == nil {
		t.Fatal("resposta de erro do Bling não é lista")
	}
	outro := decod(t, `{"data":{"id":2,"loja":{"id":205834140}}}`)
	if _, neg := Recortar("pedidos/vendas/2", outro, []int64{domPedro}); !neg {
		t.Fatal("UM pedido de outra loja é NEGADO")
	}
	if _, neg := Recortar("pedidos/vendas/3", decod(t, `{"data":{"id":3}}`), []int64{domPedro}); !neg {
		t.Fatal("pedido sem loja não vira de todo mundo")
	}
	if _, neg := Recortar("pedidos/vendas/1", decod(t, `{"data":{"id":1,"loja":{"id":205657609}}}`), []int64{domPedro}); neg {
		t.Fatal("pedido da loja dela passa")
	}
	for _, cam := range []string{"nfe", "nfe/7", "nfce", "nfce/7"} {
		if _, neg := Recortar(cam, decod(t, `{"data":[]}`), []int64{domPedro}); !neg {
			t.Errorf("%s deveria ser negado a quem é limitado", cam)
		}
		if _, neg := Recortar(cam, decod(t, `{"data":[]}`), nil); neg {
			t.Errorf("%s passa para quem não é limitado (o robô)", cam)
		}
	}
	for _, cam := range []string{"produtos", "produtos/1", "estoques/saldos", "depositos"} {
		if _, neg := Recortar(cam, decod(t, `{"data":[]}`), []int64{domPedro}); neg {
			t.Errorf("%s não fala de canal e passa", cam)
		}
	}
}
