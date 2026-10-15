package fabrica

import (
	"encoding/json"
	"os"
	"testing"
)

// O contrato do ROBÔ DA FÁBRICA (coletor/, roda no Actions) com `/fabrica/robo/*`: `coletor/lib/contrato-fabrica-robo.test.mjs` grava,
// com os módulos REAIS do robô (escreverFabrica, linhaCriativoProduto, registrarExecucao...), cada requisição que sai pela rede;
// aqui cada uma é repetida na API de verdade, com a sessão de serviço do robô. O robô_test.go prova a API com requisições que ELA
// imagina; este prova que a requisição que o robô monta é a que ela aceita. Os ids são os do mundo de teste (mundo_test.go).
func TestRequisicoesDoRoboDeVerdade(t *testing.T) {
	b, err := os.ReadFile("../../../coletor/lib/__fixtures__/contrato-fabrica-robo.json")
	if err != nil {
		t.Fatal(err)
	}
	var pedidos []struct {
		Operacao string          `json:"operacao"`
		Metodo   string          `json:"metodo"`
		Caminho  string          `json:"caminho"`
		Corpo    json.RawMessage `json:"corpo"`
	}
	if err := json.Unmarshal(b, &pedidos); err != nil {
		t.Fatal(err)
	}
	if len(pedidos) < 10 {
		t.Fatalf("o arquivo de contrato do robô veio com %d requisições", len(pedidos))
	}
	m := mundoRobo(t)
	for _, p := range pedidos {
		corpo := string(p.Corpo)
		if corpo == "null" {
			corpo = ""
		}
		if st, resp := m.Pedir(t, "robo", p.Metodo, p.Caminho, corpo); st < 200 || st > 299 {
			t.Errorf("%s: %s %s = %d %s (o robô manda %s)", p.Operacao, p.Metodo, p.Caminho, st, resp, corpo)
		}
	}
}
