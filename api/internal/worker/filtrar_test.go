package worker

import "testing"

func TestFiltrar(t *testing.T) {
	ts := []Tarefa{{Nome: "a"}, {Nome: "b"}}
	if got := Filtrar(ts, nil); len(got) != 2 {
		t.Fatal("sem desligadas mantém tudo")
	}
	if got := Filtrar(ts, []string{"a"}); len(got) != 1 || got[0].Nome != "b" {
		t.Fatalf("%v", got)
	}
	if got := Filtrar(ts, []string{"*"}); len(got) != 0 {
		t.Fatal("* desliga todas")
	}
}
