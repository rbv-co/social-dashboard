package frota

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// Toda escrita da Frota recusa a sessão de "entrar como", sem tocar no banco (Ruling 5.3-5).
func TestEscritasRecusamImpersonado(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.Um(t, fotoDaFrota)
	n := 0
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo == http.MethodGet {
			return nil
		}
		n++
		st, corpo := m.Pedir(t, "impersonado", metodo, strings.ReplaceAll(rota, "{id}", V1), `{"observacao":"x"}`)
		if st != http.StatusForbidden || !strings.Contains(corpo, "Quem entrou como outra pessoa") {
			t.Errorf("%s %s como impersonado = %d %s", metodo, rota, st, corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 16 {
		t.Errorf("escritas = %d, esperava 16 (rota de escrita nova? ponha soSessaoPropria e conte aqui)", n)
	}
	if depois := m.Um(t, fotoDaFrota); depois != antes {
		t.Error("o impersonado mudou o banco")
	}
}

// Quem não tem a Frota (papel admin, só frota.aprovar, só Patrimônio, ninguém) não lê nem grava NADA, pelo
// handler real: lista = [], criar = 403, linha existente = 404; a conta desativada (com a feature frota)
// nem passa da sessão: 401 em toda rota; banco intacto. Escrita nova sem entrada em `escritas` faz o
// teste falhar.
func TestNadaVazaParaQuemNaoTemFrota(t *testing.T) {
	m := novoMundo(t, Montar)
	antes := m.Um(t, fotoDaFrota)
	type escrita struct {
		id, corpo string
		status    int
	}
	escritas := map[string]escrita{
		"POST /frota/veiculos":              {"", `{"placa":"ZZZ9Z99","nome":"Intruso"}`, 403},
		"PATCH /frota/veiculos/{id}":        {V1, `{"observacao":"x"}`, 404},
		"POST /frota/usos":                  {"", `{"veiculo_id":"` + V2 + `","km_saida":1}`, 403},
		"PATCH /frota/usos/{id}":            {U1, `{"volta_em":"2026-10-12T10:00:00Z"}`, 404},
		"POST /frota/usos/trocar":           {"", `{"veiculo_id":"` + V1 + `","fechar":{"id":"` + U1 + `","volta_em":"2026-10-12T10:00:00Z"}}`, 404},
		"POST /frota/requisicoes":           {"", `{"veiculo_id":"` + V2 + `","retirada_prevista":"2026-11-01T12:00:00Z"}`, 403},
		"PATCH /frota/requisicoes/{id}":     {R1, `{"destino":"x"}`, 404},
		"POST /frota/checklists":            {"", `{"ficha":{"veiculo_id":"` + V2 + `","feita_em":"2026-11-01","hodometro":1},"respostas":[]}`, 403},
		"POST /frota/checklist-itens":       {"", `{"item":"Intruso","cadencia":"diario"}`, 403},
		"PATCH /frota/checklist-itens/{id}": {I1, `{"ativo":false}`, 404},
		"PATCH /frota/checklist-config":     {"", `{"dia_semanal":2}`, 404},
		"POST /frota/plano-revisao":         {"", `{"item":"Intruso","a_cada_km":1}`, 403},
		"PATCH /frota/plano-revisao/{id}":   {P1, `{"ativo":false}`, 404},
		"DELETE /frota/revisoes/{id}":       {Rv1, ``, 404},
		"POST /frota/manutencoes":           {"", `{"manutencao":{"veiculo_id":"` + V1 + `","km":1},"trocas":[{"item":"x"}]}`, 403},
		"POST /frota/abastecimentos": {"", `{"veiculo_id":"` + V1 + `","km":1,"litros":1,"total_centavos":1,` +
			`"tanque_depois":1,"combustivel":"x"}`, 403},
	}
	for _, quem := range semFrota {
		leituras, gravacoes := 0, 0
		err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
			if metodo == http.MethodGet {
				leituras++
				if st, corpo := m.Pedir(t, quem, metodo, rota, ""); st != http.StatusOK || strings.TrimSpace(corpo) != "[]" {
					t.Errorf("%s GET %s = %d %s; esperava 200 []", quem, rota, st, corpo)
				}
				return nil
			}
			gravacoes++
			e, ok := escritas[metodo+" "+rota]
			if !ok {
				t.Errorf("escrita sem caso de vazamento: %s %s", metodo, rota)
				return nil
			}
			if st, corpo := m.Pedir(t, quem, metodo, strings.ReplaceAll(rota, "{id}", e.id), e.corpo); st != e.status {
				t.Errorf("%s %s %s = %d %s; esperava %d", quem, metodo, rota, st, corpo, e.status)
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
		if leituras != 11 || gravacoes != 16 {
			t.Errorf("rotas = %d leituras e %d escritas, esperava 11 e 16", leituras, gravacoes)
		}
	}
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		e := escritas[metodo+" "+rota]
		if st, corpo := m.Pedir(t, "desativado", metodo, strings.ReplaceAll(rota, "{id}", e.id), e.corpo); st != http.StatusUnauthorized {
			t.Errorf("desativado %s %s = %d %s; esperava 401", metodo, rota, st, corpo)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if depois := m.Um(t, fotoDaFrota); depois != antes {
		t.Error("quem não tem a Frota mudou o banco")
	}
}
