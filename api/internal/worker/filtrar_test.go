package worker

import (
	"strings"
	"testing"
)

func TestFiltrar(t *testing.T) {
	ts := []Tarefa{{Nome: "a"}, {Nome: "b"}}
	if got, err := Filtrar(ts, nil); err != nil || len(got) != 2 {
		t.Fatal("vazio mantém tudo")
	}
	if got, err := Filtrar(ts, []string{"a"}); err != nil || len(got) != 1 || got[0].Nome != "b" {
		t.Fatalf("%v %v", got, err)
	}
	if got, err := Filtrar(ts, []string{"*"}); err != nil || len(got) != 0 {
		t.Fatal("* desliga todas")
	}
	_, err := Filtrar(ts, []string{"a", "enviar-push-vendas-7h"})
	if err == nil || !strings.Contains(err.Error(), "enviar-push-vendas-7h") || !strings.Contains(err.Error(), "[a b]") {
		t.Fatalf("erro de digitação deve falhar listando desconhecidos e válidos: %v", err)
	}
}
