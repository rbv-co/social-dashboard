package acessos

import (
	"reflect"
	"testing"
)

// Porte dos casos de src/ferramentas/acessos/normalizar-pastas-do-workdrive.test.mjs (a edge segue no ar com o JS).
func TestPastasDoWorkdrive(t *testing.T) {
	j := objeto([]byte(`{"data":[
		{"id":"1","type":"teamfolders","attributes":{"name":"  Equipe  "}},
		{"id":"2","type":"files","attributes":{"is_folder":true,"name":"Pasta"}},
		{"id":"3","type":"files","attributes":{"type":"FOLDER","display_name":"Outra"}},
		{"id":"4","type":"files","attributes":{"is_folder":false,"name":"arquivo.pdf"}},
		{"id":"5","type":"files","attributes":{"is_folder":true,"name":"Lixeira","status":"51"}},
		{"id":"6","type":"files","attributes":{"is_folder":true,"name":"Ativa","status":1}},
		{"type":"files","attributes":{"is_folder":true,"name":"Sem id"}},
		{"id":"7","type":"files","attributes":{"is_folder":true,"name":"   "}}]}`))
	got := pastasDoWorkdrive(j)
	quer := []pastaWD{{"1", "Equipe"}, {"2", "Pasta"}, {"3", "Outra"}, {"6", "Ativa"}, {"7", "(sem nome)"}}
	if !reflect.DeepEqual(got, quer) {
		t.Errorf("pastas = %+v\nquer   = %+v", got, quer)
	}
	if pastasDoWorkdrive(nil) != nil || pastasDoWorkdrive(map[string]any{"data": "x"}) != nil {
		t.Error("sem data não pode virar pasta")
	}
}

func TestLinhasEIdempotencia(t *testing.T) {
	l := linhasDeRecursos([]pastaWD{{"a", "A"}, {"b", "B"}, {"a", "A repetida"}}, "tf", " Cliente ")
	if l[0].Caminho != "Cliente/A" || l[0].DriveID != "tf" || linhasDeRecursos([]pastaWD{{"x", "X"}}, "tf", "")[0].Caminho != "X" {
		t.Errorf("linhas = %+v", l)
	}
	novas, ja := separarNovas(l, []string{"b"})
	if len(novas) != 1 || novas[0].ExternalID != "a" || len(ja) != 2 { // b já gravada; o 2º "a" repetido na rodada
		t.Errorf("novas=%+v ja=%+v", novas, ja)
	}
}
