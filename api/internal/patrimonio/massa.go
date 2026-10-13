package patrimonio

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// LoteMaximo: a tela só marca o que lista (407 bens em produção, levantamento/07-linhas.csv).
const LoteMaximo = 1000

var reUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

type corpoEmMassa struct {
	IDs       []string        `json:"ids"`
	Alteracao corpoBemEmMassa `json:"alteracao"`
}

// corpoBemEmMassa: as colunas de montarAlteracaoEmMassa (acao-em-massa.js) e o atualizado_em que a tela manda.
type corpoBemEmMassa struct {
	Situacao     json.RawMessage `json:"situacao,omitempty"`
	EmpresaID    json.RawMessage `json:"empresa_id,omitempty"`
	LocalID      json.RawMessage `json:"local_id,omitempty"`
	ComodoID     json.RawMessage `json:"comodo_id,omitempty"`
	CategoriaID  json.RawMessage `json:"categoria_id,omitempty"`
	PessoaID     json.RawMessage `json:"pessoa_id,omitempty"`
	DonoTexto    json.RawMessage `json:"dono_texto,omitempty"`
	AtualizadoEm json.RawMessage `json:"atualizado_em,omitempty"`
}

type corpoApagarEmMassa struct {
	IDs []string `json:"ids"`
}

// idsDoLote: de 1 a LoteMaximo uuids distintos, EM ORDEM (duas massas simultâneas travam as linhas
// na mesma ordem: sem deadlock).
func idsDoLote(ids []string) ([]string, error) {
	if len(ids) == 0 || len(ids) > LoteMaximo {
		return nil, fmt.Errorf("Mande de 1 a %d itens.", LoteMaximo)
	}
	out := make([]string, len(ids))
	for i, id := range ids {
		out[i] = strings.ToLower(id)
		if !reUUID.MatchString(out[i]) {
			return nil, errors.New("Item inválido no lote.")
		}
	}
	slices.Sort(out)
	if len(slices.Compact(slices.Clone(out))) != len(out) {
		return nil, errors.New("Item repetido no lote.")
	}
	return out, nil
}

// emMassa: POST /patrimonio/bens/em-massa. Cada bem pelo MESMO caminho do PATCH unitário (o mapa de
// escrita sai da mesma struct; PodeEditar na mesma transação que grava). Um bem negado (404/403) ou
// com erro desfaz o lote inteiro, e a resposta é a mesma para o alheio e o inexistente (sem oráculo).
// ponytail: ~3 consultas por item (até 1000); um update único com where id = any() quando o volume
// pedir — sem perder o PodeEditar por linha.
func emMassa(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in corpoEmMassa
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		lote, err := idsDoLote(in.IDs)
		if err != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return
		}
		campos, err := dados.Campos(&in.Alteracao)
		if err != nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		if len(campos) == 0 {
			dados.Erro(w, http.StatusBadRequest, "corpo_invalido", "Nada para gravar.")
			return
		}
		pessoa, trocaDono := campos["pessoa_id"]
		ctx := r.Context()
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			for _, id := range lote {
				if _, err := tabelaBens.Editar(ctx, tx, autz.Producao, e, id, campos); err != nil {
					return err
				}
			}
			if !trocaDono {
				return nil
			}
			return trocarDonoEmMassa(ctx, tx, e, lote, pessoa.(json.RawMessage))
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, fmt.Appendf(nil, `{"alterados":%d}`, len(lote)))
	}
}

// trocarDonoEmMassa: o que a tela fazia depois do update em massa (tela-de-patrimonio.vue:1902-1911), na
// MESMA transação (Ruling 5.2-5): fecha a posse aberta de cada bem com ate = hoje (São Paulo) e, havendo
// dono novo, abre a dele com motivo 'alteração em massa'. Cada posse passa pela regra do catálogo pelo
// mesmo caminho das rotas de posse. O pessoa_id já passou pela FK no update dos bens (pessoa inexistente
// = 409 lá, nada gravado); o nome vem de acessos_pessoas sem a regra de Ler de Acessos, como a tela
// (pessoas_para_escolher já lista todas as pessoas a quem tem Patrimônio — Ruling 5.2-17).
func trocarDonoEmMassa(ctx context.Context, tx pgx.Tx, e *autz.Escopo, lote []string, pessoa json.RawMessage) error {
	var hoje string
	if err := tx.QueryRow(ctx, `select ((now() at time zone 'America/Sao_Paulo')::date)::text`).Scan(&hoje); err != nil {
		return err
	}
	linhas, err := tx.Query(ctx, `select id::text from patrimonio_posse where bem_id = any(@ids::uuid[]) and ate is null order by id`,
		pgx.NamedArgs{"ids": lote})
	if err != nil {
		return err
	}
	abertas, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		return err
	}
	for _, id := range abertas {
		if _, err := tabelaPosses.Editar(ctx, tx, autz.Producao, e, id, map[string]any{"ate": hoje}); err != nil {
			return err
		}
	}
	if string(pessoa) == "null" {
		return nil // sem dono novo: só fecha (a tela não abre posse de "ninguém")
	}
	var nome *string
	if err := tx.QueryRow(ctx, `select nome from acessos_pessoas where id = (@p::jsonb #>> '{}')::uuid`,
		pgx.NamedArgs{"p": string(pessoa)}).Scan(&nome); err != nil {
		return err
	}
	for _, id := range lote {
		if _, err := tabelaPosses.Criar(ctx, tx, autz.Producao, e, map[string]any{
			"bem_id": id, "pessoa_id": pessoa, "pessoa_nome": nome, "de": hoje, "motivo": "alteração em massa"}); err != nil {
			return err
		}
	}
	return nil
}

// apagarEmMassa: POST /patrimonio/bens/apagar-em-massa. Tudo ou nada, pelo mesmo Apagar do DELETE
// unitário (as posses vão pela FK em cascata).
func apagarEmMassa(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in corpoApagarEmMassa
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		lote, err := idsDoLote(in.IDs)
		if err != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return
		}
		ctx := r.Context()
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			for _, id := range lote {
				if err := tabelaBens.Apagar(ctx, tx, autz.Producao, e, id); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// montarMassa: as duas rotas em lote. Monte DEPOIS de montarBens/montarPosses (as tabelas já validadas)
// e de auth.Exigir e autz.ComEscopo; cada escrita passa por soSessaoPropria.
func montarMassa(r chi.Router, p *pgxpool.Pool) {
	r.With(soSessaoPropria).Post("/patrimonio/bens/em-massa", emMassa(p))
	r.With(soSessaoPropria).Post("/patrimonio/bens/apagar-em-massa", apagarEmMassa(p))
}
