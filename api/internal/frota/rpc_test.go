package frota

import (
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// montarRPCs: a lista branca como web.Rotas a monta (POST /rpc/{nome} no grupo de domínio).
func montarRPCs(r chi.Router, p *pgxpool.Pool) {
	reg, err := rpc.Novo(p, FuncoesRPC...)
	deve(err)
	r.Post("/rpc/{nome}", reg.ServeHTTP)
}

func TestRPCDaFrota(t *testing.T) {
	m := novoMundo(t, montarRPCs)
	const corrente, etiqueta = "/rpc/frota_corrente_do_veiculo", "/rpc/etiqueta_quem_e"
	for _, quem := range []string{"motorista", "superFicha", "impersonado"} {
		m.Rodar(t, []caso{{Nome: "ficha corrente: " + quem, Quem: quem, Metodo: "POST", Caminho: corrente, Corpo: `{"p_veiculo":"` + V1 + `"}`,
			Status: 200, Tem: "h-c1"}})
	}
	m.Rodar(t, []caso{
		{Nome: "ficha corrente traz as respostas", Quem: "motorista", Metodo: "POST", Caminho: corrente, Corpo: `{"p_veiculo":"` + V1 + `"}`, Status: 200, Tem: "Pneus"},
		{Nome: "carro inexistente", Quem: "motorista", Metodo: "POST", Caminho: corrente, Corpo: `{"p_veiculo":"f3d00000-0000-4000-a000-0000000000ff"}`, Status: 200, Tem: "[]"},
		{Nome: "uuid malformado", Quem: "motorista", Metodo: "POST", Caminho: corrente, Corpo: `{"p_veiculo":"x"}`, Status: 400},
	})
	for _, quem := range semFrota {
		m.Rodar(t, []caso{{Nome: "VAZAMENTO ficha: " + quem, Quem: quem, Metodo: "POST", Caminho: corrente, Corpo: `{"p_veiculo":"` + V1 + `"}`,
			Status: 403, Tem: "sem_permissao", NaoTem: "h-c1"}})
	}

	for _, quem := range []string{"patrimonio", "admin"} { // papel admin = admin do Patrimônio
		m.Rodar(t, []caso{{Nome: "etiqueta 101: " + quem, Quem: quem, Metodo: "POST", Caminho: etiqueta, Corpo: `{"p_numero":101}`, Status: 200, Tem: "AAA1A11"}})
	}
	if _, corpo := m.Pedir(t, "patrimonio", "POST", etiqueta, `{"p_numero":101}`); !strings.Contains(corpo, "Gol da frota") {
		t.Errorf("etiqueta 101 sem o nome do bem: %s", corpo)
	}
	m.Rodar(t, []caso{
		{Nome: "etiqueta que não existe", Quem: "patrimonio", Metodo: "POST", Caminho: etiqueta, Corpo: `{"p_numero":999}`, Status: 200, Tem: `"existe": false`},
		{Nome: "etiqueta de móvel", Quem: "patrimonio", Metodo: "POST", Caminho: etiqueta, Corpo: `{"p_numero":102}`, Status: 200, Tem: "Mesa", NaoTem: "AAA1A11"},
		{Nome: "número que não é número", Quem: "patrimonio", Metodo: "POST", Caminho: etiqueta, Corpo: `{"p_numero":"cento e um"}`, Status: 400},
		{Nome: "parâmetro a mais", Quem: "patrimonio", Metodo: "POST", Caminho: etiqueta, Corpo: `{"p_numero":101,"p_x":1}`, Status: 400},
		// Ruling 5.3-10: só a Frota não é admin do Patrimônio — a função devolveria {existe:false}, o portão nega antes
		{Nome: "só a Frota", Quem: "motorista", Metodo: "POST", Caminho: etiqueta, Corpo: `{"p_numero":101}`, Status: 403, NaoTem: "Gol"},
		{Nome: "ninguém", Quem: "viewer", Metodo: "POST", Caminho: etiqueta, Corpo: `{"p_numero":101}`, Status: 403, NaoTem: "Gol"},
	})
}
