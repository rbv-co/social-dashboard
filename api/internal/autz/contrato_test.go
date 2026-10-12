package autz_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/autz/autzteste"
)

// colunasDa devolve as colunas da linha que as policies de `tab` leem (as de Colunas que
// aparecem sem prefixo de outra tabela: "p.id" é do perfil, "patrimonio_posse.bem_id" é da linha).
func colunasDa(tab string, catalogo []map[string]any) []string {
	var texto strings.Builder
	for _, p := range catalogo {
		if p["tabela"] == tab {
			fmt.Fprint(&texto, p["using"], " ", p["withCheck"], " ")
		}
	}
	s := strings.ReplaceAll(texto.String(), tab+".", "")
	var out []string
	for _, c := range append([]string{"id"}, nomes()...) {
		if regexp.MustCompile(`(^|[^.\w])` + c + `\b`).MatchString(s) {
			out = append(out, c)
		}
	}
	return out
}

// moverSQL: o update que MOVE uma linha (troca uma coluna que as policies leem por outro valor),
// como a pessoa (SECURITY INVOKER: a RLS vale). Cada linha roda numa subtransação desfeita, então
// uma não muda o que a outra enxerga; devolve {id: "ok" | "erro" | "0"} ("erro" = 42501: a linha
// NOVA foi recusada; "0" = a linha antiga nem apareceu).
const moverSQL = `
create function autz_mover(tab text, col text, patch jsonb, ids uuid[]) returns jsonb language plpgsql as $f$
declare r jsonb := '{}'; i uuid; n bigint := 0;
begin
  foreach i in array ids loop
    begin
      execute format('update %I set %I = (jsonb_populate_record(null::%I, $1)).%I where id = $2', tab, col, tab, col) using patch, i;
      get diagnostics n = row_count;
      raise exception 'desfazer' using errcode = 'P0001';
    exception
      when sqlstate 'P0001' then r := r || jsonb_build_object(i::text, case when n = 1 then 'ok' else '0' end);
      when insufficient_privilege then r := r || jsonb_build_object(i::text, 'erro');
    end;
  end loop;
  return r;
end $f$;`

// atualizaveis: as tabelas com policy de update/all para sessão de pessoa.
func atualizaveis(catalogo []map[string]any) map[string]bool {
	out := map[string]bool{}
	for _, p := range catalogo {
		if c := p["comando"]; c != "update" && c != "all" {
			continue
		}
		for _, r := range p["papeis"].([]any) {
			if r == "authenticated" || r == "public" {
				out[p["tabela"].(string)] = true
			}
		}
	}
	return out
}

func nomes() []string {
	var l []string
	for _, c := range autzteste.Colunas {
		l = append(l, c.Nome)
	}
	return l
}

// grade: o produto cartesiano dos valores das colunas (dono = os ids de `donos`).
func grade(cols []string, donos []any) []map[string]any {
	linhas := []map[string]any{{}}
	for _, c := range cols {
		vals, ok := autzteste.Valores[c]
		if autzteste.DeDono[c] {
			vals, ok = donos, true
		}
		if !ok {
			continue // "id" e as colunas que nenhuma policy compara a valor fixo
		}
		var nova []map[string]any
		for _, l := range linhas {
			for _, v := range vals {
				x := map[string]any{c: v}
				for k, w := range l {
					x[k] = w
				}
				nova = append(nova, x)
			}
		}
		linhas = nova
	}
	return linhas
}

type resultado struct{ permitido, negado int }

type placar struct {
	mu         sync.Mutex
	cobertura  map[string]*resultado
	constantes map[string]map[string]bool // tab×op -> formas do SQL do Go vistas ("true", "false", "linha")
	falhas     int
	atualiz    map[string]bool // tabelas com policy de update/all
}

func (p *placar) contar(chave string, ok bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	r := p.cobertura[chave]
	if r == nil {
		r = &resultado{}
		p.cobertura[chave] = r
	}
	if ok {
		r.permitido++
	} else {
		r.negado++
	}
}

func (p *placar) forma(chave, sql string) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.constantes[chave] == nil {
		p.constantes[chave] = map[string]bool{}
	}
	if sql != "true" && sql != "false" {
		sql = "linha"
	}
	p.constantes[chave][sql] = true
}

func (p *placar) erro(t *testing.T, format string, a ...any) {
	t.Helper()
	p.mu.Lock()
	p.falhas++
	n := p.falhas
	p.mu.Unlock()
	if n <= 60 {
		t.Errorf(format, a...)
	}
}

// O CONTRATO: para cada pessoa × tabela × operação, o que o Go decide (autz.Producao) é
// EXATAMENTE o que a RLS de produção decide, linha a linha. Ler e Apagar: o conjunto de ids;
// Editar: 0 (não vê/não pode), 1 (passou) ou erro (passou no USING e caiu no WITH CHECK);
// Criar: cada linha candidata aceita ou recusada.
func TestContratoDePermissaoContraARLSDeProducao(t *testing.T) {
	m := autzteste.Novo(t)
	ctx := context.Background()
	var catalogo []map[string]any
	json.Unmarshal(autz.CatalogoJSON(), &catalogo)
	if _, err := m.Pool.Exec(ctx, moverSQL); err != nil {
		t.Fatal(err)
	}
	var todos []any
	for _, ps := range m.Personas {
		todos = append(todos, ps.ID)
	}
	todos = append(todos, nil)
	cols := map[string][]string{}
	for _, tab := range autz.Producao.Tabelas() {
		cols[tab] = colunasDa(tab, catalogo)
		if autzteste.DoMundo[tab] {
			continue
		}
		j, _ := json.Marshal(grade(cols[tab], todos))
		nomeT := pgx.Identifier{tab}.Sanitize()
		if _, err := m.Pool.Exec(ctx, `insert into `+nomeT+` select (jsonb_populate_record(null::`+nomeT+
			`, jsonb_build_object('id', gen_random_uuid()) || x)).* from jsonb_array_elements($1::jsonb) x`, string(j)); err != nil {
			t.Fatalf("%s: %v", tab, err)
		}
	}
	pl := &placar{cobertura: map[string]*resultado{}, constantes: map[string]map[string]bool{}, atualiz: atualizaveis(catalogo)}
	t.Run("pessoas", func(t *testing.T) {
		for _, ps := range m.Personas {
			t.Run(ps.Nome, func(t *testing.T) {
				t.Parallel()
				verificarPessoa(t, m, pl, ps, cols)
			})
		}
	})
	if pl.falhas > 0 {
		t.Fatalf("%d divergências entre o Go e a RLS de produção", pl.falhas)
	}
	// Cobertura: toda tabela×operação viu permitido E negado, salvo quando a regra é constante
	// para TODAS as pessoas (o Go devolveu só "true", ou só "false"): aí o mundo não tem como
	// mostrar o outro lado, e a constante é a própria regra (ex.: `true`, ou nenhuma policy).
	var fracas []string
	for k, r := range pl.cobertura {
		if strings.HasSuffix(k, "×mover") {
			continue // conferido abaixo, só nas tabelas em que a leitura da linha nova decide
		}
		c := pl.constantes[k]
		if (r.negado == 0 && !(len(c) == 1 && c["true"])) || (r.permitido == 0 && !(len(c) == 1 && c["false"])) {
			fracas = append(fracas, fmt.Sprintf("%s (permitido %d, negado %d, Go %v)", k, r.permitido, r.negado, c))
		}
	}
	// O update que MOVE a linha tem de ter mostrado os dois lados nas tabelas em que a regra de
	// leitura da linha nova decide (conta): senão a dimensão não pegaria o EditarNova errado.
	for _, tab := range []string{"conteudo_pecas", "conteudo_blocos", "conteudo_ideias", "campaign_filters", "social_metas"} {
		if r := pl.cobertura[tab+"×mover"]; r == nil || r.permitido == 0 || r.negado == 0 {
			fracas = append(fracas, fmt.Sprintf("%s×mover não mostrou os dois lados (%+v)", tab, r))
		}
	}
	sort.Strings(fracas)
	if len(fracas) > 0 {
		t.Fatalf("o mundo do teste não mostra os dois lados de %d regras (acrescente pessoa/linha):\n%s", len(fracas), strings.Join(fracas, "\n"))
	}
}

func verificarPessoa(t *testing.T, m *autzteste.Mundo, pl *placar, ps autzteste.Persona, cols map[string][]string) {
	ctx := context.Background()
	e, err := autz.CarregarEscopo(ctx, m.Pool, ps.ID)
	if err != nil {
		t.Fatal(err)
	}
	outro := m.Pessoa("comum").ID
	if ps.ID == outro {
		outro = m.Pessoa("admin").ID
	}
	// O lado da RLS: UMA transação como a pessoa, cada tentativa num savepoint desfeito.
	err = m.ComoPessoa(ctx, ps.ID, func(tx pgx.Tx) error {
		for _, tab := range autz.Producao.Tabelas() {
			nomeT := pgx.Identifier{tab}.Sanitize()
			filtro := func(op autz.Op) autz.Filtro {
				f, err := autz.Producao.Filtro(e, tab, op, tab)
				if err != nil {
					t.Fatal(err)
				}
				if op != autz.EditarNova { // só tem efeito junto do Editar: o tri-estado de editar já a confere
					pl.forma(tab+"×"+op.String(), f.SQL)
				}
				return f
			}
			fl, fa, fe, fn, fc := filtro(autz.Ler), filtro(autz.Apagar), filtro(autz.Editar), filtro(autz.EditarNova), filtro(autz.Criar)

			// Go: uma consulta dá ler, apagar e editar de todas as linhas (como superusuário).
			goLer, goApagar, goEditar := map[string]bool{}, map[string]bool{}, map[string]string{}
			var todas []string
			args := fc.Juntar(fn.Juntar(fe.Juntar(fa.Juntar(fl.Juntar(pgx.NamedArgs{})))))
			linhas, err := m.Pool.Query(ctx, `select id::text, coalesce(`+fl.SQL+`, false), coalesce(`+fa.SQL+`, false),
			    coalesce(`+fe.SQL+`, false), coalesce(`+fn.SQL+`, false) from `+nomeT+` as `+nomeT, args)
			if err != nil {
				t.Fatalf("%s: %v", tab, err)
			}
			var id string
			var ler, apagar, velha, nova bool
			if _, err := pgx.ForEachRow(linhas, []any{&id, &ler, &apagar, &velha, &nova}, func() error {
				todas = append(todas, id)
				goLer[id], goApagar[id] = ler, apagar
				switch {
				case !velha:
					goEditar[id] = "0"
				case !nova:
					goEditar[id] = "erro"
				default:
					goEditar[id] = "1"
				}
				return nil
			}); err != nil {
				t.Fatalf("%s: %v", tab, err)
			}

			// RLS: ler
			rlsLer := conjunto(t, tx, `select id::text from `+nomeT)
			// RLS: apagar (desfeito)
			rlsApagar := map[string]bool{}
			emSavepoint(t, tx, func() error {
				rlsApagar = conjunto(t, tx, `delete from `+nomeT+` returning id::text`)
				return nil
			})
			// RLS: editar: a tabela inteira; se a RLS recusar alguma linha nova, linha a linha
			rlsEditar := map[string]string{}
			for _, x := range todas {
				rlsEditar[x] = "0"
			}
			errLote := emSavepoint(t, tx, func() error {
				l, err := tx.Query(ctx, `update `+nomeT+` set id = id returning id::text`)
				if err != nil {
					return err
				}
				vistos, err := pgx.CollectRows(l, pgx.RowTo[string])
				for _, x := range vistos {
					rlsEditar[x] = "1"
				}
				return err
			})
			if errLote != nil {
				for _, x := range todas {
					rlsEditar[x] = "0"
					err := emSavepoint(t, tx, func() error {
						tag, err := tx.Exec(ctx, `update `+nomeT+` set id = id where id = $1::uuid`, x)
						if err == nil && tag.RowsAffected() == 1 {
							rlsEditar[x] = "1"
						}
						return err
					})
					if err != nil {
						rlsEditar[x] = "erro"
					}
				}
			}
			for _, x := range todas {
				if rlsLer[x] != goLer[x] {
					pl.erro(t, "%s × %s × ler linha %s: RLS %v, Go %v (%s)", ps.Nome, tab, x, rlsLer[x], goLer[x], fl.SQL)
				}
				if rlsApagar[x] != goApagar[x] {
					pl.erro(t, "%s × %s × apagar linha %s: RLS %v, Go %v", ps.Nome, tab, x, rlsApagar[x], goApagar[x])
				}
				if rlsEditar[x] != goEditar[x] {
					pl.erro(t, "%s × %s × editar linha %s: RLS %q, Go %q", ps.Nome, tab, x, rlsEditar[x], goEditar[x])
				}
				pl.contar(tab+"×ler", rlsLer[x])
				pl.contar(tab+"×apagar", rlsApagar[x])
				pl.contar(tab+"×editar", rlsEditar[x] == "1")
			}

			// EDITAR-NOVA: o update que MOVE a linha (troca uma coluna que as policies leem por um
			// valor que a pessoa pode ou não enxergar). A RLS exige que a linha NOVA passe no WITH
			// CHECK das de update/all E no USING das de select/all; o Go avalia o EditarNova sobre
			// a linha movida. Só as linhas que a pessoa pode editar (a antiga passou no USING).
			if pl.atualiz[tab] {
				var editaveis []string
				for _, x := range todas {
					if goEditar[x] != "0" {
						editaveis = append(editaveis, x)
					}
				}
				for _, c := range cols[tab] {
					valores, ok := autzteste.Valores[c]
					if autzteste.DeDono[c] {
						valores, ok = []any{outro, ps.ID, nil}, true
					}
					if !ok || len(editaveis) == 0 {
						continue
					}
					for _, v := range valores {
						patch, _ := json.Marshal(map[string]any{c: v})
						goNova := map[string]bool{}
						qs, err := m.Pool.Query(ctx, `select id::text, coalesce(`+fn.SQL+`, false) from (select (jsonb_populate_record(null::`+nomeT+
							`, to_jsonb(t) || @autz_patch::jsonb)).* from `+nomeT+` t where id::text = any(@autz_ids::text[])) as `+nomeT,
							fn.Juntar(pgx.NamedArgs{"autz_patch": string(patch), "autz_ids": editaveis}))
						if err != nil {
							t.Fatalf("%s mover %s: %v", tab, c, err)
						}
						var xid string
						var passa bool
						if _, err := pgx.ForEachRow(qs, []any{&xid, &passa}, func() error { goNova[xid] = passa; return nil }); err != nil {
							t.Fatalf("%s mover %s: %v", tab, c, err)
						}
						var res map[string]string
						emSavepoint(t, tx, func() error {
							return tx.QueryRow(ctx, `select autz_mover($1::text, $2::text, $3::jsonb, $4::uuid[])`, tab, c, string(patch), editaveis).Scan(&res)
						})
						for _, x := range editaveis {
							rls := res[x] == "ok"
							if res[x] == "0" || res[x] == "" {
								pl.erro(t, "%s × %s × mover %s para %v, linha %s: a RLS nem viu a linha que o Go diz editável (%q)", ps.Nome, tab, c, v, x, res[x])
							} else if rls != goNova[x] {
								pl.erro(t, "%s × %s × mover %s para %v, linha %s: RLS %v, Go %v (%s)", ps.Nome, tab, c, v, x, rls, goNova[x], fn.SQL)
							}
							pl.contar(tab+"×mover", rls)
						}
					}
				}
			}

			// CRIAR: linhas candidatas desta pessoa (dono = ela, outra pessoa ou ninguém)
			for _, l := range grade(cols[tab], []any{ps.ID, outro, nil}) {
				delete(l, "id")
				goOK, err := autz.Conferir(ctx, m.Pool, fc, tab, l)
				if err != nil {
					t.Fatalf("%s criar: %v", tab, err)
				}
				rlsOK := emSavepoint(t, tx, func() error { return inserir(ctx, tx, tab, l) }) == nil
				if goOK != rlsOK {
					pl.erro(t, "%s × %s × criar %v: RLS %v, Go %v (%s)", ps.Nome, tab, l, rlsOK, goOK, fc.SQL)
				}
				pl.contar(tab+"×criar", rlsOK)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// emSavepoint roda fn e desfaz o que ela fez. Erro que não seja a recusa da RLS (42501)
// derruba o teste: só a RLS pode dizer não.
func emSavepoint(t *testing.T, tx pgx.Tx, fn func() error) error {
	t.Helper()
	ctx := context.Background()
	if _, err := tx.Exec(ctx, `savepoint s`); err != nil {
		t.Fatal(err)
	}
	err := fn()
	if _, e := tx.Exec(ctx, `rollback to savepoint s`); e != nil {
		t.Fatal(e)
	}
	if err != nil && !negadoPelaRLS(err) {
		t.Fatalf("erro que não é da RLS: %v", err)
	}
	return err
}

func conjunto(t *testing.T, tx pgx.Tx, sql string) map[string]bool {
	t.Helper()
	l, err := tx.Query(context.Background(), sql)
	if err != nil {
		t.Fatalf("%v\n%s", err, sql)
	}
	vistos, err := pgx.CollectRows(l, pgx.RowTo[string])
	if err != nil {
		t.Fatalf("%v\n%s", err, sql)
	}
	out := map[string]bool{}
	for _, x := range vistos {
		out[x] = true
	}
	return out
}

func inserir(ctx context.Context, tx pgx.Tx, tab string, linha map[string]any) error {
	nomeT := pgx.Identifier{tab}.Sanitize()
	if len(linha) == 0 {
		_, err := tx.Exec(ctx, `insert into `+nomeT+` default values`)
		return err
	}
	var cs []string
	for c := range linha {
		cs = append(cs, pgx.Identifier{c}.Sanitize())
	}
	sort.Strings(cs)
	j, _ := json.Marshal(linha)
	_, err := tx.Exec(ctx, `insert into `+nomeT+` (`+strings.Join(cs, ", ")+`) select `+strings.Join(cs, ", ")+
		` from jsonb_populate_record(null::`+nomeT+`, $1::jsonb)`, string(j))
	return err
}

func negadoPelaRLS(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "42501"
}
