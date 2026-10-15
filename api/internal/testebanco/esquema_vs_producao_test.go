package testebanco

// Plano 02 do esforço REVISAO-TESTES-2026-10 (item B): o banco de TESTE (compat + migrações + esquema/*.sql)
// confere com as colunas REAIS de produção. Todo teste da API roda contra esse esquema; coluna com tipo,
// NOT NULL ou default diferente da produção deixa teste verde sobre um banco que não existe.
// testdata/producao_colunas.tsv vem de um SELECT em produção (ver testdata/producao_colunas.sql).

import (
	"bufio"
	"context"
	"os"
	"sort"
	"strings"
	"testing"
)

const consultaColunas = `select c.relname || '.' || a.attname,
  regexp_replace(concat_ws(' | ', format_type(a.atttypid, a.atttypmod), case when a.attnotnull then 'NOT NULL' else 'null' end,
    coalesce(pg_get_expr(d.adbin, d.adrelid), '-'), case when a.attgenerated <> '' then 'gerada' else '' end,
    case when a.attidentity <> '' then 'identity ' || a.attidentity::text else '' end), '\s+', ' ', 'g')
from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')`

// tabelasSoDoTeste: tabelas que o esquema de teste cria e que NÃO são (ainda) de produção: as da API
// (migrações em api/internal/banco/migracoes) e as que o esquema inclui antes de existirem em produção.
var tabelasSoDoTeste = map[string]string{
	"usuarios": "API (migração 00001)", "sessoes": "API (migração 00001)", "webhooks_recebidos": "API (00002)",
	"envios_feitos": "API (00003)", "disparos_pendentes": "API (00007)", "tokens_de_senha": "API (00005)",
	"tokens_de_servico": "API (00006)", "goose_db_version": "goose",
}

// divergenciasDeProposito: coluna que o esquema de teste mantém DIFERENTE da produção, com o motivo.
var divergenciasDeProposito = map[string]string{
	"campaigns.account_id": "produção: NOT NULL; teste: NULL, porque os testes de autorização semeiam campanha sem conta (pode_ver_conta(null) = verdadeiro) para provar a regra",
}

func TestEsquemaDeTesteConfereComProducao(t *testing.T) {
	f, err := os.Open("testdata/producao_colunas.tsv")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	prod := map[string]string{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		k, v, ok := strings.Cut(sc.Text(), "\t")
		if !ok {
			t.Fatalf("linha malformada em producao_colunas.tsv: %q", sc.Text())
		}
		prod[k] = v
	}

	p := ComEsquemaDeProducao(t)
	rows, err := p.Query(context.Background(), consultaColunas)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	teste := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			t.Fatal(err)
		}
		teste[k] = v
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}

	var diverge, soTeste []string
	usadasDeProposito := map[string]bool{}
	tabelasTeste := map[string]bool{}
	for k, v := range teste {
		tab, _, _ := strings.Cut(k, ".")
		tabelasTeste[tab] = true
		if _, ok := tabelasSoDoTeste[tab]; ok {
			continue
		}
		pv, ok := prod[k]
		if _, deProposito := divergenciasDeProposito[k]; deProposito {
			usadasDeProposito[k] = true
			if pv == v {
				t.Errorf("divergenciasDeProposito tem %q, que já é igual à produção: tire da lista", k)
			}
			continue
		}
		switch {
		case !ok:
			soTeste = append(soTeste, k)
		case pv != v:
			diverge = append(diverge, k+"\n      produção: "+pv+"\n      teste:    "+v)
		}
	}
	sort.Strings(diverge)
	sort.Strings(soTeste)
	for _, d := range diverge {
		t.Errorf("coluna diferente da produção: %s", d)
	}
	for _, k := range soTeste {
		t.Errorf("coluna que o esquema de teste tem e a produção NÃO tem: %s", k)
	}

	// o inverso: coluna de tabela que o teste cria e que falta nele (tabela inteira que o teste não cria é só informativo:
	// o esquema de teste modela o que a API usa, não as 181 tabelas)
	semTabela := map[string]int{}
	var faltam []string
	for k, v := range prod {
		tab, _, _ := strings.Cut(k, ".")
		if !tabelasTeste[tab] {
			semTabela[tab]++
		} else if _, ok := teste[k]; !ok {
			faltam = append(faltam, k+"\n      produção: "+v)
		}
	}
	sort.Strings(faltam)
	for _, k := range faltam {
		t.Errorf("coluna que a produção tem e o esquema de teste NÃO tem: %s", k)
	}
	t.Logf("produção tem %d tabelas/visões que o esquema de teste não cria (%d colunas)", len(semTabela), sumInts(semTabela))
}

func sumInts(m map[string]int) (n int) {
	for _, v := range m {
		n += v
	}
	return
}
