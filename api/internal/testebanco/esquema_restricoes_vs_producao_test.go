package testebanco

// Plano 02 (item B), parte 2: PK, UNIQUE, FK, CHECK e índices do esquema de teste contra os de produção
// (testdata/producao_restricoes.tsv), só para as tabelas que o teste cria. Sem constraint no teste, um teste
// de duplicidade ou de FK passa sobre um banco mais frouxo que o real. Índice comum (só desempenho) não entra.

import (
	"bufio"
	"context"
	"os"
	"sort"
	"strings"
	"testing"
)

const consultaRestricoes = `select c.conrelid::regclass::text, c.contype::text || ' ' || regexp_replace(pg_get_constraintdef(c.oid), '\s+', ' ', 'g')
from pg_constraint c where c.connamespace = 'public'::regnamespace and c.contype in ('p', 'u', 'f', 'c')
union all
select t.relname::text, 'i ' || regexp_replace(pg_get_indexdef(ix.indexrelid), '^CREATE (UNIQUE )?INDEX \S+ ON (ONLY )?(public\.)?\S+ ', 'CREATE \1INDEX ')
from pg_index ix join pg_class t on t.oid = ix.indrelid
where t.relnamespace = 'public'::regnamespace and ix.indisunique and not exists (select 1 from pg_constraint k where k.conindid = ix.indexrelid)`

// em produção as FKs de pessoa apontam para auth.users; na API, para usuarios (compat + migração 00001)
func normalizaRestricao(d string) string {
	return strings.ReplaceAll(d, "auth.users(id)", "usuarios(id)")
}

func TestRestricoesDeTesteConferemComProducao(t *testing.T) {
	f, err := os.Open("testdata/producao_restricoes.tsv")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	prod := map[string]map[string]bool{}
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 1<<20), 1<<20)
	for sc.Scan() {
		tab, def, ok := strings.Cut(sc.Text(), "\t")
		if !ok {
			t.Fatalf("linha malformada: %q", sc.Text())
		}
		if prod[tab] == nil {
			prod[tab] = map[string]bool{}
		}
		prod[tab][normalizaRestricao(def)] = true
	}

	p := ComEsquemaDeProducao(t)
	rows, err := p.Query(context.Background(), consultaRestricoes)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	teste := map[string]map[string]bool{}
	for rows.Next() {
		var tab, def string
		if err := rows.Scan(&tab, &def); err != nil {
			t.Fatal(err)
		}
		if teste[tab] == nil {
			teste[tab] = map[string]bool{}
		}
		teste[tab][normalizaRestricao(def)] = true
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}

	var faltamNoTeste, soNoTeste []string
	for tab, defs := range teste {
		if _, api := tabelasSoDoTeste[tab]; api {
			continue
		}
		pd, existe := prod[tab]
		if !existe {
			pd = map[string]bool{}
		}
		for d := range defs {
			if !pd[d] {
				soNoTeste = append(soNoTeste, tab+": "+d)
			}
		}
		for d := range pd {
			if !defs[d] {
				faltamNoTeste = append(faltamNoTeste, tab+": "+d)
			}
		}
	}
	sort.Strings(faltamNoTeste)
	sort.Strings(soNoTeste)
	for _, d := range faltamNoTeste {
		t.Errorf("restrição que a produção tem e o esquema de teste NÃO tem: %s", d)
	}
	for _, d := range soNoTeste {
		t.Errorf("restrição que o esquema de teste tem e a produção NÃO tem: %s", d)
	}
}
