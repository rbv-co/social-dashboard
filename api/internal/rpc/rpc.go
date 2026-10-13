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
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"maps"
	"net/http"
	"regexp"
	"slices"
	"strconv"
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
	// SoSessaoPropria: a função GRAVA. Sessão de "entrar como" recebe 403 sem a função rodar
	// (Ruling 5.2-3); função que só lê fica aberta a quem entrou como (ver o que a pessoa vê).
	SoSessaoPropria bool
	// ParamConta: o parâmetro (text) que diz de qual conta da Meta a função cuida. Valor texto tem de
	// ser de uma conta que quem pede vê (autz.PodeVerConta, a regra das restritivas so_contas_permitidas):
	// senão 403 sem a função rodar. null segue (a função decide). Ruling 5.7-10: função SECURITY DEFINER
	// que grava por conta não passava pela restritiva de produção.
	ParamConta string
}

var (
	reNome = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)
	tipos  = []string{"text", "uuid", "integer", "bigint", "numeric", "boolean", "date", "timestamptz", "jsonb"}
)

// proibidas são nomes que NUNCA viram RPC do painel, mesmo que um sub-plano os declare por
// engano: as duas do Ruling 23, a fila do abandono e os robôs (Ruling 25: ficam em SQL, só o
// worker as chama), as internas com EXECUTE revogado de `authenticated`, as três de página
// pública (`anon`, Plano 6) e as cinco sem chamada de rede (web.RPCForaDoPainel concorda: teste).
// A recusa é aqui, no ponto único de entrada: Novo falha e a API não sobe.
var proibidas = []string{
	"marcar_senha_trocada", "minha_conta_esta_desativada",
	"pegar_da_fila", "pegar_para_mensagem", "marcar_da_fila", "marcar_mensagem", "marcar_checkout_comprou",
	"marcar_checkout_pagamento_pendente", "liberar_travadas_da_fila", "liberar_mensagens_travadas", "agendar_followups",
	"avaliar_trava_cruzada", "mover_abandonados_para_fila", "devolver_da_fila", "devolver_mensagem",
	"registrar_pedido_para_mensagem", "disparar_robo", "disparar_coletor", "tomar_trava",
	"vessel_cpf_valido", "vessel_faixa_da_nota", "vessel_situacao_do_convite", "vessel_numeros_do_stylist_circle", "vessel_telefone_canonico",
	"vessel_convite_da_convidada", "vessel_rsvp_da_convidada", "vessel_pedir_atendimento",
	// ajudantes de policy (viraram Go em autz) e funções só citadas em comentário: sem chamada de rede do painel
	"is_vessel_atendimentos_editar", "meus_vinculos", "vessel_chave_do_produto", "vessel_email_canonico", "vessel_placar_do_stylist_circle",
}

func proibida(nome string) bool {
	return slices.Contains(proibidas, nome) || strings.HasPrefix(nome, "checkout_")
}

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
		if proibida(f.Nome) {
			return nil, fmt.Errorf("rpc %q: nome proibido na lista branca do painel", f.Nome)
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
		if f.ParamConta != "" && !slices.ContainsFunc(f.Params, func(p Param) bool { return p.Nome == f.ParamConta && p.Tipo == "text" }) {
			return nil, fmt.Errorf("rpc %s: ParamConta %q não é um parâmetro text declarado", f.Nome, f.ParamConta)
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
		if pr.Tipo == "text[]" && bruto != "null" { // elementos: só texto (ou null)
			var el []any
			if err := json.Unmarshal(v, &el); err != nil {
				return pr.Nome + " deve ser uma lista"
			}
			for _, x := range el {
				if _, ehTexto := x.(string); !ehTexto && x != nil {
					return pr.Nome + " deve ser uma lista de textos"
				}
			}
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
	if f.SoSessaoPropria && a.ImpersonadorID != nil {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", dados.FraseEntrarComo)
		return
	}
	// corpo vazio (inclusive sem tamanho declarado, chunked) vale {}
	corpo := map[string]json.RawMessage{}
	bruto, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		dados.Erro(w, http.StatusRequestEntityTooLarge, "corpo_grande_demais", "")
		return
	}
	if len(bytes.TrimSpace(bruto)) > 0 {
		r.Body = io.NopCloser(bytes.NewReader(bruto))
		if !dados.LerCorpo(w, r, &corpo) {
			return
		}
	}
	args := pgx.NamedArgs{}
	var chamadas []string
	var conta json.RawMessage
	var temConta bool
	for _, pr := range f.Params {
		v, tem := corpo[pr.Nome]
		delete(corpo, pr.Nome)
		if pr.Nome == f.ParamConta {
			conta, temConta = v, tem
		}
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
	if f.ParamConta != "" && temConta && strings.TrimSpace(string(conta)) != "null" {
		var c string
		if json.Unmarshal(conta, &c) != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", f.ParamConta+" deve ser texto")
			return
		}
		if !autz.PodeVerConta(e, c) {
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
			return
		}
	}
	chamada := pgx.Identifier{f.Nome}.Sanitize() + "(" + strings.Join(chamadas, ", ") + ")"
	var saida []byte
	err = banco.ComUsuario(r.Context(), rg.pool, a.ID, func(tx pgx.Tx) error {
		switch f.Retorno {
		case Conjunto:
			// linha inteira (r.*: uma coluna chamada r não a esconde) e o teto de linhas do PostgREST
			return tx.QueryRow(r.Context(), `select coalesce(json_agg(t.v), '[]'::json) from (select to_json(r.*) as v from `+
				chamada+` r limit `+strconv.Itoa(dados.LimitePadrao)+`) t`, args).Scan(&saida)
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
