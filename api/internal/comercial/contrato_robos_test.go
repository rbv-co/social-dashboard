package comercial

import (
	"encoding/json"
	"os"
	"testing"
)

// O contrato dos robôs do Bling (coletor/) com `POST /bling-proxy`: `coletor/lib/contrato-bling-proxy.test.mjs` LÊ do código
// dos robôs cada endpoint passado a `blingProxy(...)` e o trava neste arquivo; aqui a API tem de deixar passar TODOS. Endpoint
// que um robô usa e a lista fechada não tem é 403 `endpoint nao permitido` na virada.
func TestEndpointsQueOsRobosUsamPassamNaLista(t *testing.T) {
	b, err := os.ReadFile("../../../coletor/lib/__fixtures__/endpoints-do-bling-proxy.json")
	if err != nil {
		t.Fatal(err)
	}
	var endpoints []string
	if err := json.Unmarshal(b, &endpoints); err != nil {
		t.Fatal(err)
	}
	if len(endpoints) < 10 {
		t.Fatalf("o arquivo de contrato dos robôs veio com %d endpoints", len(endpoints))
	}
	for _, e := range endpoints {
		if !permitido(e) {
			t.Errorf("um robô do coletor usa o endpoint %q e a lista da API o recusa (403 na virada)", e)
		}
	}
}
