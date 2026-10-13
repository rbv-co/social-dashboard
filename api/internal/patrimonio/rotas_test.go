package patrimonio

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// escritas: um pedido VÁLIDO (para quem não entrou como outra pessoa) por rota de escrita de Montar. Rota
// de escrita nova sem entrada aqui faz a varredura falhar: o gate e o banco seriam testados com `{}` e a
// rota nova passaria despercebida.
var escritas = map[string]struct{ caminho, corpo string }{
	"POST /patrimonio/bens":                 {"/patrimonio/bens", `{"nome":"Intruso"}`},
	"PATCH /patrimonio/bens/{id}":           {"/patrimonio/bens/" + B2, `{"nome":"Renomeado"}`},
	"DELETE /patrimonio/bens/{id}":          {"/patrimonio/bens/" + B3, ``},
	"POST /patrimonio/bens/em-massa":        {"/patrimonio/bens/em-massa", `{"ids":["` + B1 + `"],"alteracao":{"situacao":"em_estoque"}}`},
	"POST /patrimonio/bens/apagar-em-massa": {"/patrimonio/bens/apagar-em-massa", `{"ids":["` + B4 + `"]}`},
	"POST /patrimonio/posses":               {"/patrimonio/posses", `{"bem_id":"` + B1 + `","pessoa_id":"` + P2 + `","pessoa_nome":"Motorista","de":"2026-03-01"}`},
	"PATCH /patrimonio/posses/{id}":         {"/patrimonio/posses/" + PO2, `{"ate":"2026-02-01"}`},
	"POST /patrimonio/empresas":             {"/patrimonio/empresas", `{"nome":"Intrusa"}`},
	"PATCH /patrimonio/empresas/{id}":       {"/patrimonio/empresas/" + E1, `{"nome":"Renomeada"}`},
	"DELETE /patrimonio/empresas/{id}":      {"/patrimonio/empresas/" + E2, ``},
	"POST /patrimonio/locais":               {"/patrimonio/locais", `{"nome":"Intruso","empresa_id":"` + E1 + `"}`},
	"PATCH /patrimonio/locais/{id}":         {"/patrimonio/locais/" + L1, `{"nome":"Renomeado"}`},
	"DELETE /patrimonio/locais/{id}":        {"/patrimonio/locais/" + L2, ``},
	"POST /patrimonio/comodos":              {"/patrimonio/comodos", `{"nome":"Intruso","local_id":"` + L1 + `"}`},
	"PATCH /patrimonio/comodos/{id}":        {"/patrimonio/comodos/" + C1, `{"nome":"Renomeado"}`},
	"DELETE /patrimonio/comodos/{id}":       {"/patrimonio/comodos/" + C1, ``},
	"POST /patrimonio/categorias":           {"/patrimonio/categorias", `{"nome":"Intrusa"}`},
	"PATCH /patrimonio/categorias/{id}":     {"/patrimonio/categorias/" + CatM, `{"nome":"Renomeada"}`},
	"DELETE /patrimonio/categorias/{id}":    {"/patrimonio/categorias/" + CatV, ``},
	"POST /patrimonio/tipos":                {"/patrimonio/tipos", `{"nome":"Intruso","categoria_id":"` + CatM + `"}`},
	"PUT /patrimonio/config/{chave}":        {"/patrimonio/config/numero_maximo", `{"valor":"999"}`},
	"POST /patrimonio/log":                  {"/patrimonio/log", `{"acao":"intrusa"}`},
}

// Toda escrita do 5.2 recusa a sessão de "entrar como", sem tocar no banco (Ruling 5.2-3). A varredura
// anda nas rotas REAIS de Montar (chi.Walk): rota de escrita nova entra sozinha na conta e exige uma
// entrada em `escritas`, senão o teste acusa.
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar, montarRPCs)
	antes := m.Um(t, fotoDoMundo)
	n := 0
	vistas := map[string]bool{}
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet || !strings.HasPrefix(rota, "/patrimonio/") {
			return nil
		}
		n++
		chave := metodo + " " + rota
		e, ok := escritas[chave]
		if !ok {
			t.Errorf("escrita sem caso na varredura: %s", chave)
			return nil
		}
		vistas[chave] = true
		st, corpo := m.Pedir(t, "impersonado", metodo, e.caminho, e.corpo)
		if st != http.StatusForbidden || !strings.Contains(corpo, "Quem entrou como outra pessoa") {
			t.Errorf("%s como impersonado = %d %s", chave, st, corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 22 || len(escritas) != 22 || len(vistas) != 22 {
		t.Errorf("escritas = %d, casos = %d, varridas = %d, esperava 22 (rota de escrita nova? ponha soSessaoPropria e um caso em `escritas`)", n, len(escritas), len(vistas))
	}
	for _, c := range []struct {
		nome, corpo string
		status      int
	}{
		{"criar_pessoa_rapida", `{"p_nome":"Intrusa"}`, http.StatusForbidden},
		{"criar_setor_rapido", `{"p_nome":"Intruso"}`, http.StatusForbidden},
		{"sincronizar_carro_e_bem", `{"p_bem_id":"` + BV2 + `","p_placa":"IMP1A11","p_nome":"x"}`, http.StatusForbidden},
		{"pessoas_para_escolher", ``, http.StatusOK}, // só lê: quem entrou como vê o que a pessoa vê
		{"setores_para_escolher", ``, http.StatusOK},
	} {
		if st, corpo := m.Pedir(t, "impersonado", "POST", "/rpc/"+c.nome, c.corpo); st != c.status {
			t.Errorf("rpc %s como impersonado = %d %s, esperava %d", c.nome, st, corpo, c.status)
		} else if c.status == http.StatusForbidden && !strings.Contains(corpo, "Quem entrou como outra pessoa") {
			t.Errorf("rpc %s como impersonado: 403 sem a frase do entrar como: %s", c.nome, corpo)
		}
	}
	if depois := m.Um(t, fotoDoMundo); depois != antes {
		t.Error("o impersonado mudou o banco")
	}
}
