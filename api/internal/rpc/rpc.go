// Package rpc expõe, uma a uma, as funções SQL que o front chamava pelo PostgREST
// (`.rpc(nome, args)`): POST /rpc/{nome} com o mesmo corpo. Só nomes registrados (lista
// branca), cada um com seus parâmetros tipados e um portão em Go (autz.Regra) que espelha a
// checagem que a função já faz por dentro. A função roda numa transação com auth.uid() = quem
// pede (banco.ComUsuario), então a checagem interna dela continua valendo como segunda barreira.
//
// Nada do pedido entra no texto do SQL: o nome vem do registro (validado e citado), os tipos
// vêm da declaração (lista fechada) e cada valor viaja como parâmetro nomeado, convertido com
// cast explícito.
package rpc

import (
	"encoding/json"
	"fmt"
	"maps"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Retorno diz como a resposta é montada.
type Retorno int

const (
	Valor    Retorno = iota // returns <escalar|json|record>: to_json(f(...))
	Conjunto                // returns setof/table: json_agg das linhas ([] se nenhuma)
	Nada                    // returns void: 204
)

// Param: Tipo é o tipo SQL do parâmetro (com [] para array). Opcional = a função tem DEFAULT.
type Param struct {
	Nome, Tipo string
	Opcional   bool
}

type Funcao struct {
	Nome    string
	Params  []Param
	Retorno Retorno
	Portao  autz.Regra
}

var (
	reNome = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)
	tipos  = []string{"text", "uuid", "integer", "bigint", "numeric", "boolean", "date", "timestamptz", "jsonb"}
)

type Registro struct {
	pool    *pgxpool.Pool
	funcoes map[string]Funcao
}

// Novo valida as declarações (erro = a API não sobe): nome, tipos, portão obrigatório.
func Novo(p *pgxpool.Pool, fs ...Funcao) (*Registro, error) {
	r := &Registro{pool: p, funcoes: map[string]Funcao{}}
	for _, f := range fs {
		if !reNome.MatchString(f.Nome) || f.Portao == nil {
			return nil, fmt.Errorf("rpc %q: nome inválido ou sem portão", f.Nome)
		}
		if _, dup := r.funcoes[f.Nome]; dup {
			return nil, fmt.Errorf("rpc %q registrada duas vezes", f.Nome)
		}
		vistos := map[string]bool{}
		for _, pr := range f.Params {
			if !reNome.MatchString(pr.Nome) || !slices.Contains(tipos, strings.TrimSuffix(pr.Tipo, "[]")) || pr.Tipo == "jsonb[]" {
				return nil, fmt.Errorf("rpc %s: parâmetro %q de tipo %q inválido", f.Nome, pr.Nome, pr.Tipo)
			}
			if vistos[pr.Nome] {
				return nil, fmt.Errorf("rpc %s: parâmetro %q repetido", f.Nome, pr.Nome)
			}
			vistos[pr.Nome] = true
		}
		r.funcoes[f.Nome] = f
	}
	return r, nil
}

// expr: o valor JSON do parâmetro convertido no SQL, sempre com cast explícito. Lista vazia
// vira '{}' (não NULL, como o PostgREST entregava) e `null` vira NULL.
func expr(pr Param) string {
	v := "@" + pr.Nome + "::jsonb"
	switch {
	case pr.Tipo == "jsonb":
		return "nullif(" + v + ", 'null'::jsonb)"
	case strings.HasSuffix(pr.Tipo, "[]"):
		return "(case when jsonb_typeof(" + v + ") = 'array' then coalesce((select array_agg(x)::" + pr.Tipo +
			" from jsonb_array_elements_text(" + v + ") x), '{}'::" + pr.Tipo + ") end)"
	}
	return "(" + v + " #>> '{}')::" + pr.Tipo
}

// formaOk confere a forma do valor JSON antes de ele ir ao banco: lista para tipo[]; nem
// objeto nem lista para escalar (que o `#>> '{}'` viraria texto e um `text` aceitaria).
func formaOk(pr Param, v json.RawMessage) string {
	bruto := strings.TrimSpace(string(v))
	switch {
	case strings.HasSuffix(pr.Tipo, "[]"):
		if !strings.HasPrefix(bruto, "[") && bruto != "null" {
			return pr.Nome + " deve ser uma lista"
		}
	case pr.Tipo != "jsonb":
		if strings.HasPrefix(bruto, "[") || strings.HasPrefix(bruto, "{") {
			return pr.Nome + " deve ser um valor simples"
		}
	}
	return ""
}

// ServeHTTP: POST /rpc/{nome}. Monte DEPOIS de auth.Exigir e autz.ComEscopo.
func (rg *Registro) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f, ok := rg.funcoes[chi.URLParam(r, "nome")]
	if !ok {
		dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
		return
	}
	e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
	if e == nil || a == nil || e.ID != a.ID {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	// só sessão de pessoa do painel ou conta de serviço chama função do painel
	if a.Tipo != "painel" && a.Tipo != "servico" {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
		return
	}
	if !f.Portao(e) {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
		return
	}
	corpo := map[string]json.RawMessage{}
	if r.ContentLength != 0 && !dados.LerCorpo(w, r, &corpo) {
		return
	}
	args := pgx.NamedArgs{}
	var chamadas []string
	for _, pr := range f.Params {
		v, tem := corpo[pr.Nome]
		delete(corpo, pr.Nome)
		if !tem {
			if !pr.Opcional {
				dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "falta o parâmetro "+pr.Nome)
				return
			}
			continue
		}
		if msg := formaOk(pr, v); msg != "" {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", msg)
			return
		}
		args[pr.Nome] = string(v)
		chamadas = append(chamadas, pgx.Identifier{pr.Nome}.Sanitize()+" => "+expr(pr))
	}
	if len(corpo) > 0 {
		k := slices.Min(slices.Collect(maps.Keys(corpo)))
		if r := []rune(k); len(r) > 40 {
			k = string(r[:40]) + "…"
		}
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "parâmetro desconhecido: "+k)
		return
	}
	chamada := pgx.Identifier{f.Nome}.Sanitize() + "(" + strings.Join(chamadas, ", ") + ")"
	var saida []byte
	err := banco.ComUsuario(r.Context(), rg.pool, a.ID, func(tx pgx.Tx) error {
		switch f.Retorno {
		case Conjunto:
			return tx.QueryRow(r.Context(), `select coalesce(json_agg(r), '[]'::json) from `+chamada+` r`, args).Scan(&saida)
		case Nada:
			_, err := tx.Exec(r.Context(), `select `+chamada, args)
			return err
		}
		return tx.QueryRow(r.Context(), `select coalesce(to_json(`+chamada+`), 'null'::json)`, args).Scan(&saida)
	})
	if err != nil {
		dados.ErroDoBanco(w, err)
		return
	}
	if f.Retorno == Nada {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(saida)
}
