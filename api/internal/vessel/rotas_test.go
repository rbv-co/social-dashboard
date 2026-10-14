package vessel

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// corpos: um pedido VÁLIDO por RPC do selo. Função nova sem corpo aqui faz as varreduras falharem.
var corpos = map[string]string{
	"vessel_alertas":                    `{}`,
	"vessel_fila_de_registros":          `{}`,
	"vessel_baixar_garantia":            `{"p_codigo":"VBAAAA0003","p_motivo":"pedido da cliente"}`,
	"vessel_baixar_peca":                `{"p_codigo":"VBAAAA0002","p_motivo":"extraviada"}`,
	"vessel_decidir_pedido_de_registro": `{"p_pedido":"` + PR2 + `","p_estado":"aprovado","p_quem_decidiu":"na_mao"}`,
	"vessel_definir_material_do_lote":   `{"p_lote":"` + L1 + `","p_material":"couro"}`,
	"vessel_desfazer_baixa":             `{"p_codigo":"VBTTTT0002"}`,
	"vessel_desmarcar_gravada":          `{"p_codigo":"VBAAAA0001","p_motivo":null}`,
	"vessel_editar_lote":                `{"p_lote":"` + L1 + `","p_modelo":"Linear","p_cor":"Caramelo","p_sku":"SS0001HB.S1","p_fabricado_em":null,"p_quantidade":4}`,
	"vessel_excluir_lote":               `{"p_lote":"` + L2 + `"}`,
	"vessel_excluir_peca":               `{"p_codigo":"VBAAAA0002"}`,
	"vessel_gerar_lote":                 `{"p_modelo":"Linear","p_cor":null,"p_sku":"SS0001HB.S1","p_quantidade":1,"p_fabricado_em":null,"p_fotos":null}`,
	"vessel_marcar_gravada":             `{"p_codigo":"VBAAAA0002"}`,
	"vessel_pedir_cartoes":              `{"p_pecas":["VBAAAA0002"]}`,
	"vessel_sobrescrever_etiqueta":      `{"p_codigo_antigo":"VBAAAA0001","p_codigo_novo":"VBAAAA0002","p_destino":"fila","p_motivo":"rasgou"}`,
	"vessel_trocar_dono":                `{"p_codigo":"VBAAAA0003","p_nome":"Bia","p_cpf":"11144477735","p_whatsapp":"11988887777","p_motivo":"venda","p_confirmacao":"VBAAAA0003"}`,
}

// tudo: as 6 leituras de Montar e as 16 RPCs, como web.Rotas as monta no grupo de domínio.
func tudo(r chi.Router, p *pgxpool.Pool) {
	Montar(r, p)
	montarRPCs(r, p)
}

// Ninguém fora do selo lê nem grava nada dele, por NENHUMA rota (leitura: [] e conta 0; RPC: 403, sem efeito);
// o "entrar como" lê tudo e não grava nada. Rota ou função nova entra sozinha (chi.Walk e FuncoesRPC).
func TestNadaVazaDoSelo(t *testing.T) {
	m := novoMundo(t, tudo)
	antes := m.Um(t, fotoDoSelo)
	lidas := 0
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo != http.MethodGet {
			return nil
		}
		lidas++
		for _, quem := range []string{"admin", "leitor", "chave"} {
			w := m.Resposta(t, quem, "GET", rota+"?contar=1", "")
			if w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != "[]" || w.Header().Get("X-Total-Count") != "0" {
				t.Errorf("%s GET %s = %d %s", quem, rota, w.Code, w.Body)
			}
		}
		if st, b := m.Pedir(t, "impersonado", "GET", rota, ""); st != http.StatusOK || strings.TrimSpace(b) == "[]" {
			t.Errorf("o impersonado (o alvo é do selo) não leu %s: %d %s", rota, st, b)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if lidas != len(leituras) || lidas != 6 {
		t.Errorf("leituras montadas = %d, declaradas = %d, esperava 6", lidas, len(leituras))
	}
	gravam := 0
	for _, f := range FuncoesRPC {
		corpo, ok := corpos[f.Nome]
		if !ok {
			t.Errorf("RPC sem corpo nas varreduras: %s", f.Nome)
			continue
		}
		for _, quem := range []string{"admin", "leitor", "chave"} {
			if st, b := m.Pedir(t, quem, "POST", "/rpc/"+f.Nome, corpo); st != http.StatusForbidden {
				t.Errorf("%s POST /rpc/%s = %d %s", quem, f.Nome, st, b)
			}
		}
		st, b := m.Pedir(t, "impersonado", "POST", "/rpc/"+f.Nome, corpo)
		if f.SoSessaoPropria {
			gravam++
			if st != http.StatusForbidden || !strings.Contains(b, "Quem entrou como outra pessoa") {
				t.Errorf("impersonado POST /rpc/%s = %d %s", f.Nome, st, b)
			}
		} else if st != http.StatusOK {
			t.Errorf("impersonado lendo /rpc/%s = %d %s", f.Nome, st, b)
		}
	}
	if len(FuncoesRPC) != 16 || gravam != 14 {
		t.Errorf("RPCs = %d (%d gravam), esperava 16 (14)", len(FuncoesRPC), gravam)
	}
	if m.Um(t, fotoDoSelo) != antes {
		t.Error("quem não é do selo, ou o impersonado, mudou o selo")
	}
}
