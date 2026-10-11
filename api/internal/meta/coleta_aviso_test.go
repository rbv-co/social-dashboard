package meta

import (
	"context"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// O recado ao super admin diz o que de fato aconteceu: métricas zeradas (texto de sempre), falha de
// leitura da Graph (texto próprio, sem "zeradas" nem "5 tentativas") ou as duas coisas.
func TestAvisarSuperAdminTextoPorCausa(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasColeta); err != nil {
		t.Fatal(err)
	}
	zerada := "⚠️ Coleta IG: a Meta retornou métricas zeradas/inconsistentes (alcance 0 ou likes/comments/saves/shares zerados com interações>0) mesmo após 5 tentativas em: " +
		"Breno 0d · Vessel 7d (sem histórico). Mantive o valor mais recente válido (não zerei o painel). Verificar token/permissões da Meta."
	graph := "⚠️ Coleta IG: falha ao ler a Graph da Meta (a leitura não chegou ou a Meta recusou; não são métricas zeradas) em: " +
		"Vessel: 2 de 12 janelas de insights de campanha falharam (core: conexão recusada). O que já estava gravado foi mantido e as outras leituras seguiram. Verificar o status da Meta e o token/permissões."
	casos := []struct {
		nome string
		deg  degradados
		quer string
	}{
		{"só métricas zeradas", degradados{zeradas: []string{"Breno 0d", "Vessel 7d (sem histórico)"}}, zerada},
		{"só falha da Graph", degradados{graph: []string{"Vessel: 2 de 12 janelas de insights de campanha falharam (core: conexão recusada)"}}, graph},
		{"as duas", degradados{zeradas: []string{"Breno 0d", "Vessel 7d (sem histórico)"}, graph: []string{"Vessel: 2 de 12 janelas de insights de campanha falharam (core: conexão recusada)"}}, zerada + "\n" + graph},
	}
	c := &ColetaDiaria{Pool: p}
	for _, k := range casos {
		t.Run(k.nome, func(t *testing.T) {
			p.Exec(ctx, `delete from data_integrity_checks`)
			c.avisarSuperAdmin(ctx, "2026-10-10", k.deg)
			var detalhe string
			if err := p.QueryRow(ctx, `select detail from data_integrity_checks where check_name = 'coleta_zerada'`).Scan(&detalhe); err != nil {
				t.Fatal(err)
			}
			if detalhe != k.quer {
				t.Fatalf("detalhe\n got %q\nquer %q", detalhe, k.quer)
			}
			if k.nome == "só falha da Graph" && (strings.Contains(detalhe, "zeradas/") || strings.Contains(detalhe, "5 tentativas")) {
				t.Fatalf("texto de métrica zerada numa falha da Graph: %q", detalhe)
			}
		})
	}
	p.Exec(ctx, `delete from data_integrity_checks`)
	c.avisarSuperAdmin(ctx, "2026-10-10", degradados{})
	var n int
	p.QueryRow(ctx, `select count(*) from data_integrity_checks`).Scan(&n)
	if n != 0 {
		t.Fatalf("nada degradado: nenhuma linha (%d)", n)
	}
}
