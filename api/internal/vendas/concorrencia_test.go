package vendas

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// Plano 03-A: oito salvamentos juntos da MESMA meta (loja, mês) que ainda não existe, com o insert
// alargado por 50 ms: os oito dão 200 e fica UMA linha, com o valor de um deles (não uma mistura). A
// trava é o pg_advisory_xact_lock do mês; sem ela os oito acham "não existe" e sete batem no único.
func TestOitoSalvarMetasDoMesmoMesNaoDuplicamNemFalham(t *testing.T) {
	m := novoMundo(t, montarMetas)
	m.Atrasar(t, "bling_metas", "insert", 50)
	st := make([]int, 8)
	mundoteste.EmParalelo(len(st), func(i int) {
		corpo := fmt.Sprintf(`{"ano":2026,"mes":12,"lojas":{"gravar":[{"loja_id":60,"meta_valor":%d}]}}`, 1000+i)
		st[i], _ = m.Pedir(t, "admin", http.MethodPost, "/comercial/metas/salvar", corpo)
	})
	for i, s := range st {
		if s != http.StatusOK {
			t.Errorf("salvamento %d = %d, esperava 200", i, s)
		}
	}
	if v := m.Um(t, `select count(*)::text from bling_metas where loja_id = 60 and year = 2026 and month = 12`); v != "1" {
		t.Errorf("%s linhas da meta, esperava 1", v)
	}
	if v := m.Um(t, `select (meta_valor between 1000 and 1007)::text from bling_metas where loja_id = 60 and year = 2026 and month = 12`); v != "true" {
		t.Errorf("meta_valor fora do que algum dos oito mandou")
	}
}

// Plano 03-D: o salvamento de várias metas é uma transação só: se a segunda falha (gatilho que recusa a
// loja 99), a primeira, já gravada, é desfeita.
func TestSalvarMetasQueFalhaNoMeioNaoGravaNada(t *testing.T) {
	m := novoMundo(t, montarMetas)
	if _, err := m.P.Exec(t.Context(), `create function recusa_loja_99() returns trigger language plpgsql as
		$$ begin if new.loja_id = 99 then raise exception 'recusada' using errcode = '23514'; end if; return new; end $$;
		create trigger recusa_loja_99 before insert on bling_metas for each row execute function recusa_loja_99();`); err != nil {
		t.Fatal(err)
	}
	st, corpo := m.Pedir(t, "admin", http.MethodPost, "/comercial/metas/salvar",
		`{"ano":2026,"mes":12,"lojas":{"gravar":[{"loja_id":61,"meta_valor":10},{"loja_id":99,"meta_valor":20}]}}`)
	if st != http.StatusBadRequest {
		t.Fatalf("salvar com a segunda meta recusada = %d %s, esperava 400", st, corpo)
	}
	if v := m.Um(t, `select count(*)::text from bling_metas where loja_id in (61, 99) and year = 2026 and month = 12`); v != "0" {
		t.Errorf("%s metas gravadas apesar da falha no meio, esperava 0", v)
	}
}

// Plano 03-B: o mesmo "Salvar" repetido (clique duplo, reenvio do navegador): três vezes, 200 nas três, uma
// linha e o mesmo conteúdo.
func TestSalvarMetasRepetidoDeixaOMesmoEstado(t *testing.T) {
	m := novoMundo(t, montarMetas)
	corpo := `{"ano":2026,"mes":12,"lojas":{"gravar":[{"loja_id":62,"meta_valor":500}]}}`
	foto := `select count(*)::text || '|' || string_agg(meta_valor::text || coalesce(daily_goals::text, '-'), ',') from bling_metas where loja_id = 62 and year = 2026 and month = 12`
	var primeira string
	for i := range 3 {
		if st, c := m.Pedir(t, "admin", http.MethodPost, "/comercial/metas/salvar", corpo); st != http.StatusOK {
			t.Fatalf("salvamento %d = %d %s", i, st, c)
		}
		if i == 0 {
			if primeira = m.Um(t, foto); !strings.HasPrefix(primeira, "1|") {
				t.Fatalf("depois do primeiro salvamento: %s", primeira)
			}
		} else if got := m.Um(t, foto); got != primeira {
			t.Fatalf("salvamento %d mudou o estado: %s (era %s)", i, got, primeira)
		}
	}
}
