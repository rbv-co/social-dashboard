package rpc

import (
	"context"
	"encoding/json"
	"maps"
	"slices"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Pedido é a chamada de uma Funcao já montada: o nome citado, cada valor como parâmetro nomeado com cast explícito
// (nada do corpo entra no texto do SQL) e os valores enviados, para o Conferir.
type Pedido struct {
	chamada  string
	args     pgx.NamedArgs
	Enviados map[string]json.RawMessage
	conta    json.RawMessage
	temConta bool
}

// Montar prepara a chamada a partir do corpo (consome as chaves: o que sobrar é parâmetro desconhecido). msg != ""
// é a frase do 400 pedido_invalido: parâmetro faltando, de forma errada ou desconhecido. É o preparo que a
// ServeHTTP e o pacote publico (rotas anônimas e do Core, sem sessão) dividem: a regra de forma e de cast é uma só.
func (f Funcao) Montar(corpo map[string]json.RawMessage) (*Pedido, string) {
	ped := &Pedido{args: pgx.NamedArgs{}, Enviados: map[string]json.RawMessage{}}
	var chamadas []string
	for _, pr := range f.Params {
		v, tem := corpo[pr.Nome]
		delete(corpo, pr.Nome)
		if pr.Nome == f.ParamConta {
			ped.conta, ped.temConta = v, tem
		}
		if !tem {
			if !pr.Opcional {
				return nil, "falta o parâmetro " + pr.Nome
			}
			continue
		}
		if msg := formaOk(pr, v); msg != "" {
			return nil, msg
		}
		ped.args[pr.Nome] = string(v)
		ped.Enviados[pr.Nome] = v
		chamadas = append(chamadas, pgx.Identifier{pr.Nome}.Sanitize()+" => "+expr(pr))
	}
	if len(corpo) > 0 {
		k := slices.Min(slices.Collect(maps.Keys(corpo)))
		if r := []rune(k); len(r) > 40 {
			k = string(r[:40]) + "…"
		}
		return nil, "parâmetro desconhecido: " + k
	}
	ped.chamada = pgx.Identifier{f.Nome}.Sanitize() + "(" + strings.Join(chamadas, ", ") + ")"
	return ped, ""
}

// Rodar executa o pedido na transação e devolve o JSON da resposta (nil para Nada). Conjunto = lista (até o teto de
// linhas do PostgREST); Valor = to_json do resultado ("null" se vazio).
func (f Funcao) Rodar(ctx context.Context, tx pgx.Tx, p *Pedido) ([]byte, error) {
	var saida []byte
	switch f.Retorno {
	case Conjunto:
		// linha inteira (r.*: uma coluna chamada r não a esconde) e o teto de linhas do PostgREST
		err := tx.QueryRow(ctx, `select coalesce(json_agg(t.v), '[]'::json) from (select to_json(r.*) as v from `+
			p.chamada+` r limit `+strconv.Itoa(dados.LimitePadrao)+`) t`, p.args).Scan(&saida)
		return saida, err
	case Nada:
		_, err := tx.Exec(ctx, `select `+p.chamada, p.args)
		return nil, err
	}
	err := tx.QueryRow(ctx, `select coalesce(to_json(`+p.chamada+`), 'null'::json)`, p.args).Scan(&saida)
	return saida, err
}
