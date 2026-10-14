package acessos

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var errFichaJaLigada = errors.New("acessos: a ficha já está ligada a outro login")
var errSoAdminExclui = errors.New("acessos: só admin exclui colaborador")
var errSoAdminLiga = errors.New("acessos: só admin liga ficha a login")

type pedidoLigar struct {
	ProfileID string `json:"profile_id"`
}

// ligarAoLogin: POST /acessos/pessoas/{id}/ligar. profile_id alimenta pode_ver_bem (autz.Escopo.Pessoas:
// "o bem está comigo") — é permissão de ver bens, por isso não passa pelo PATCH. Compare-and-set: ficha
// ligada a OUTRO login = 409, nunca sobrescrita (tela-de-admin.vue:3180-3187 já pedia isso ao banco).
// Papel admin como o excluir (Ruling 5.4-7): só a feature `acessos` ligaria a própria ficha ao próprio login.
func ligarAoLogin(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in pedidoLigar
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if strings.TrimSpace(in.ProfileID) == "" {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Diga a conta de login.")
			return
		}
		id, ctx := chi.URLParam(r, "id"), r.Context()
		mudanca := map[string]any{"profile_id": in.ProfileID} // o MESMO mapa vai ao PodeEditar e ao UPDATE
		var linha []byte
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			// PodeEditar ANTES da conferência: trava a linha (o segundo pedido espera aqui e depois enxerga
			// o elo do primeiro) e responde 404 para ficha invisível sem dizer se ela está ligada
			if err := autz.Producao.PodeEditar(ctx, tx, e, "acessos_pessoas", id, mudanca); err != nil {
				return err
			}
			if e.Papel != "admin" {
				return errSoAdminLiga // depois do PodeEditar: ficha invisível continua 404
			}
			var livre bool
			if err := tx.QueryRow(ctx, `select profile_id is null or profile_id = @novo::uuid
				from acessos_pessoas where id = @id::uuid`, pgx.NamedArgs{"novo": in.ProfileID, "id": id}).Scan(&livre); err != nil {
				return err
			}
			if !livre {
				return errFichaJaLigada
			}
			var err error
			linha, err = tabelaPessoas.Editar(ctx, tx, autz.Producao, e, id, mudanca)
			return err
		})
		switch {
		case errors.Is(err, errSoAdminLiga):
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "Só admin pode ligar.")
		case errors.Is(err, errFichaJaLigada):
			dados.Erro(w, http.StatusConflict, "conflito",
				"Este cadastro já foi ligado a outro login enquanto esta ficha estava aberta. Feche e abra de novo para ver como está agora.")
		case err != nil:
			dados.ErroDeEscrita(w, err)
		default:
			dados.Responder(w, http.StatusOK, linha)
		}
	}
}

// excluirColaborador: DELETE /acessos/pessoas/{id}. Catálogo (is_acessos_admin) E papel admin: a tela só
// oferecia o botão a admin (tela-de-acessos.vue:2007) e a exclusão é definitiva e em cascata (Ruling 5.4-6).
func excluirColaborador(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		id, ctx := chi.URLParam(r, "id"), r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			if err := autz.Producao.PodeApagar(ctx, tx, e, "acessos_pessoas", id); err != nil {
				return err // invisível = 404, antes de dizer qualquer coisa sobre o papel
			}
			if e.Papel != "admin" {
				return errSoAdminExclui
			}
			return tabelaPessoas.Apagar(ctx, tx, autz.Producao, e, id)
		})
		switch {
		case errors.Is(err, errSoAdminExclui):
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "Só admin pode excluir.")
		case err != nil:
			dados.ErroDeEscrita(w, err)
		default:
			w.WriteHeader(http.StatusNoContent)
		}
	}
}

const colunasLog = `t.id, t.quando, t.quem, t.acao, t.provedor, t.alvo, t.resultado, t.detalhe`

// POST /acessos/log (acessos_log_insert: is_acessos_admin()). quem = sessão (antes vinha do navegador,
// tela-de-acessos.vue:129); provedor é do proxy (Plano 6). Sem PATCH/DELETE: o catálogo não tem.
type corpoLog struct {
	Acao      json.RawMessage `json:"acao,omitempty"`
	Alvo      json.RawMessage `json:"alvo,omitempty"`
	Resultado json.RawMessage `json:"resultado,omitempty"`
	Detalhe   json.RawMessage `json:"detalhe,omitempty"`
}

func (c corpoLog) Validar() error {
	if emBranco(c.Acao) {
		return errors.New("Diga a ação.")
	}
	return nil
}

var tabelaLog = dados.Tabela{Nome: "acessos_log", Resposta: colunasLog, Autor: "quem"}

// soAdminSeLiga: criar ficha JÁ ligada a um login (POST /acessos/pessoas com profile_id) é a mesma
// decisão do ligar (pode_ver_bem), então exige o mesmo papel admin; sem profile_id nada muda. O corpo é
// lido sob o teto de 1 MiB e devolvido ao handler; corpo ilegível segue adiante e o handler responde 400.
func soAdminSeLiga(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil || e.Papel == "admin" {
			next.ServeHTTP(w, r)
			return
		}
		bruto, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
		r.Body = io.NopCloser(bytes.NewReader(bruto))
		var c struct {
			ProfileID json.RawMessage `json:"profile_id"`
		}
		if err == nil && json.Unmarshal(bruto, &c) == nil && len(c.ProfileID) > 0 && string(c.ProfileID) != "null" {
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "Só admin pode ligar.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func montarAcoesDaPessoa(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaLog.Validar(autz.Producao))
	r.With(soSessaoPropria).Post("/acessos/pessoas/{id}/ligar", ligarAoLogin(p))
	r.With(soSessaoPropria).Delete("/acessos/pessoas/{id}", excluirColaborador(p))
	r.With(soSessaoPropria).Post("/acessos/log", dados.RotaCriar[corpoLog](p, autz.Producao, tabelaLog))
}
