package autz_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/autz/autzteste"
)

// Os portões que os sub-planos põem na frente das RPCs decidem como a função de produção
// que eles espelham, para cada pessoa do mundo (chamada como a pessoa).
func TestPortoesContraAsFuncoesDeProducao(t *testing.T) {
	m := autzteste.Novo(t)
	ctx := context.Background()
	portoes := map[string]autz.Regra{
		"is_frota_admin()": autz.FrotaAdmin, "is_acessos_admin()": autz.AcessosAdmin,
		"is_patrimonio_admin()": autz.PatrimonioAdmin, "is_vessel_admin()": autz.VesselAdmin,
		"is_vessel_leads()": autz.VesselLeads, "pode_ver_vendas()": autz.PodeVerVendas,
		"superadmin_pela_ficha()": autz.SuperFicha, "is_superadmin()": autz.SuperEmail,
		"pode_aprovar_frota()": autz.PodeAprovarFrota, "pode_cadastrar_pessoa_rapida()": autz.PodeCadastrarPessoaRapida,
		"is_vessel_atendimentos()": autz.VesselAtendimentos, "is_vessel_atendimentos_editar()": autz.VesselAtendimentosEditar,
	}
	for _, f := range autz.FerramentasVessel {
		for _, n := range []string{"ver", "editar"} {
			if r, err := autz.VesselPode(f, n); err == nil {
				portoes["vessel_pode('"+f+"', '"+n+"')"] = r
			}
		}
	}
	if _, err := autz.VesselPode("atendimentos.material-grafico", "editar"); err == nil {
		t.Error("vessel_pode do Material Gráfico só tem ver")
	}
	if _, err := autz.VesselPode("outra", "ver"); err == nil {
		t.Error("ferramenta fora da lista aceita")
	}
	for chamada, regra := range portoes {
		sim, nao := 0, 0
		for _, ps := range m.Personas {
			e, err := autz.CarregarEscopo(ctx, m.Pool, ps.ID)
			if err != nil {
				t.Fatal(err)
			}
			var banco *bool
			if err := m.ComoPessoa(ctx, ps.ID, func(tx pgx.Tx) error {
				return tx.QueryRow(ctx, `select `+chamada).Scan(&banco)
			}); err != nil {
				t.Fatalf("%s: %v", chamada, err)
			}
			quer := banco != nil && *banco
			if regra(e) != quer {
				t.Errorf("%s como %s: Go %v, produção %v", chamada, ps.Nome, regra(e), quer)
			}
			if quer {
				sim++
			} else {
				nao++
			}
		}
		if sim == 0 || nao == 0 {
			t.Errorf("%s: o mundo não mostra os dois lados (sim %d, não %d)", chamada, sim, nao)
		}
	}
}
