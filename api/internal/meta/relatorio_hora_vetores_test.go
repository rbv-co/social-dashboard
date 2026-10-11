package meta

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"
)

// Os recortes fixos da edge, LITERAIS (não as constantes do código: erro de digitação nelas tem de falhar).
const (
	grupoDaEdge = "120363431546698175-group"
	contaDaEdge = "b6883e82-07cb-4f21-9fd7-ea7626786174"
	outraConta  = "aaaaaaaa-0000-0000-0000-000000000099"
)

type insightHora struct {
	campanha, dia    string
	hora             int
	gasto, acumulado float64
	conversas        int
}

type leituraFalsa struct {
	seguidores     int
	lidoEm, origem string
}

type visitaFalsa struct {
	dia           string
	hora, visitas int
}

type vetorRelatorio struct {
	nome, agora, dia string // agora em UTC (RFC 3339); dia e hora = os de São Paulo
	hora             int
	campanhas        [][2]string
	insights         []insightHora
	leituras         []leituraFalsa
	visitas          []visitaFalsa
	mensagens        []string
}

func TestRelatorioHoraConstantesSaoAsDaEdge(t *testing.T) {
	if grupoWhatsApp != grupoDaEdge || contaVessel != contaDaEdge {
		t.Fatalf("grupo=%q conta=%q", grupoWhatsApp, contaVessel)
	}
}

// Vetores gerados pela edge (index.ts + _shared/relatorio-por-hora.js no Node 22): mesmos textos, mesmo
// dia e hora de São Paulo na chave do livro, e nada das linhas de OUTRA conta entra na conta.
func TestRelatorioHoraVetoresDaEdge(t *testing.T) {
	for _, v := range vetoresRelatorio {
		t.Run(v.nome, func(t *testing.T) {
			rh, z, p := ambienteRelatorio(t)
			ctx := context.Background()
			agora, err := time.Parse(time.RFC3339, v.agora)
			if err != nil {
				t.Fatal(err)
			}
			rh.Agora = func() time.Time { return agora }
			exec := func(sql string, args ...any) {
				t.Helper()
				if _, err := p.Exec(ctx, sql, args...); err != nil {
					t.Fatal(err)
				}
			}
			for _, c := range v.campanhas {
				exec(`insert into campaigns (campaign_id, name) values ($1::text, $2::text)`, c[0], c[1])
			}
			for _, l := range v.insights {
				for conta, mult := range map[string]float64{contaDaEdge: 1, outraConta: 100} { // a outra conta é isca
					exec(`insert into campaign_insights_hora (campaign_id, account_id, dia, hora, gasto_hora, gasto_acumulado, conversas_hora)
						values ($1::text, $2::uuid, $3::date, $4::smallint, $5::numeric, $6::numeric, $7::int)`,
						l.campanha, conta, l.dia, l.hora, l.gasto*mult, l.acumulado*mult, l.conversas)
				}
			}
			for _, l := range v.leituras {
				exec(`insert into followers_leituras (account_id, followers_count, lido_em, origem) values ($1::uuid, $2::int, $3::timestamptz, $4::text)`,
					contaDaEdge, l.seguidores, l.lidoEm, l.origem)
			}
			exec(`insert into followers_leituras (account_id, followers_count, lido_em, origem) values ($1::uuid, 1, $2::timestamptz, 'hora')`, outraConta, agora.Add(-5*time.Minute))
			for _, vi := range v.visitas {
				for conta, mult := range map[string]int{contaDaEdge: 1, outraConta: 100} {
					exec(`insert into perfil_visitas_hora (account_id, dia, hora, visitas_hora) values ($1::uuid, $2::date, $3::smallint, $4::int)`, conta, vi.dia, vi.hora, vi.visitas*mult)
				}
			}

			if err := rh.Rodar(ctx); err != nil {
				t.Fatal(err)
			}
			msgs, caminhos, _ := z.lista()
			if len(msgs) != len(v.mensagens) {
				t.Fatalf("mensagens = %q", msgs)
			}
			for i, m := range v.mensagens {
				if msgs[i] != grupoDaEdge+"|"+m {
					t.Errorf("mensagem %d:\n got %q\nwant %q", i, msgs[i], grupoDaEdge+"|"+m)
				}
				if caminhos[i] != "/instances/"+zapiInstancia+"/token/"+zapiToken+"/send-text" {
					t.Errorf("caminho %q", caminhos[i])
				}
			}
			linhas, err := p.Query(ctx, `select chave from envios_feitos`)
			if err != nil {
				t.Fatal(err)
			}
			defer linhas.Close()
			n, prefixo := 0, fmt.Sprintf("enviar-relatorio-hora:%s:%02d:", v.dia, v.hora)
			for linhas.Next() {
				var chave string
				if err := linhas.Scan(&chave); err != nil {
					t.Fatal(err)
				}
				if n++; !strings.HasPrefix(chave, prefixo) {
					t.Errorf("chave %q, esperava prefixo %q (dia e hora de São Paulo)", chave, prefixo)
				}
			}
			if n != len(v.mensagens) {
				t.Errorf("%d chaves no livro, %d mensagens", n, len(v.mensagens))
			}
			if err := rh.Rodar(ctx); err != nil {
				t.Fatal(err)
			}
			if msgs, _, _ := z.lista(); len(msgs) != len(v.mensagens) {
				t.Fatalf("rodar de novo na mesma hora reenviou: %d", len(msgs))
			}
		})
	}
}
