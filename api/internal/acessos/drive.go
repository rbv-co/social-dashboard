package acessos

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Drive (aba "Drive" do Acessos): marcas (pastas-raiz do OneDrive), setores personalizados e overrides
// (pasta → setor). Regra só de ator (acessos_drive_*_rw: is_acessos_admin() para tudo), nenhuma linha
// restringe. Sem PATCH: a tela só cria, remove e reclassifica (upsert do override).
const (
	colunasDriveMarca    = `t.id, t.nome, t.external_id, t.ordem, t.criado_em`
	colunasDriveSetor    = `t.id, t.chave, t.label, t.ordem, t.criado_em`
	colunasDriveOverride = `t.external_id, t.setor_chave, t.nome, t.atualizado_em`
)

var (
	consultaDriveMarcas = dados.Consulta{Tabela: "acessos_drive_marcas", Alias: "t",
		SQL:    `select ` + colunasDriveMarca + ` from acessos_drive_marcas t`,
		Ordens: map[string]string{"ordem": "t.ordem"}, OrdemPadrao: "t.ordem", Desempate: "t.id"}
	consultaDriveSetores = dados.Consulta{Tabela: "acessos_drive_setores", Alias: "t",
		SQL:    `select ` + colunasDriveSetor + ` from acessos_drive_setores t`,
		Ordens: map[string]string{"ordem": "t.ordem", "label": "t.label"}, OrdemPadrao: "t.ordem, t.label", Desempate: "t.id"}
	consultaDriveOverrides = dados.Consulta{Tabela: "acessos_drive_overrides", Alias: "t",
		SQL:         `select ` + colunasDriveOverride + ` from acessos_drive_overrides t`,
		OrdemPadrao: "t.external_id", Desempate: "t.external_id"}
)

type corpoDriveMarca struct {
	Nome       json.RawMessage `json:"nome,omitempty"`
	ExternalID json.RawMessage `json:"external_id,omitempty"`
	Ordem      json.RawMessage `json:"ordem,omitempty"`
}
type corpoDriveSetor struct {
	Chave json.RawMessage `json:"chave,omitempty"`
	Label json.RawMessage `json:"label,omitempty"`
	Ordem json.RawMessage `json:"ordem,omitempty"`
}

// corpoDriveOverride: a chave (external_id) vem da URL; setor_chave é obrigatório, nome é opcional.
type corpoDriveOverride struct {
	SetorChave json.RawMessage `json:"setor_chave,omitempty"`
	Nome       json.RawMessage `json:"nome,omitempty"`
}

func (c corpoDriveMarca) Validar() error {
	if emBranco(c.Nome) || emBranco(c.ExternalID) {
		return errors.New("Nome e external_id são obrigatórios")
	}
	return nil
}

func (c corpoDriveSetor) Validar() error {
	if emBranco(c.Chave) || emBranco(c.Label) {
		return errors.New("Chave e label são obrigatórios")
	}
	return nil
}

func (c corpoDriveOverride) Validar() error {
	if emBranco(c.SetorChave) {
		return errors.New("setor_chave é obrigatório")
	}
	return nil
}

var (
	tabelaDriveMarcas    = dados.Tabela{Nome: "acessos_drive_marcas", Resposta: colunasDriveMarca}
	tabelaDriveSetores   = dados.Tabela{Nome: "acessos_drive_setores", Resposta: colunasDriveSetor, Chave: "chave"}
	tabelaDriveOverrides = dados.Tabela{Nome: "acessos_drive_overrides", Resposta: colunasDriveOverride, Chave: "external_id"}
)

// gravarOverride: PUT /acessos/drive/overrides/{external_id} {setor_chave, nome?}: o upsert da
// reclassificação por arrastar (a mesma pasta muda de setor sem criar linha nova).
func gravarOverride(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var c corpoDriveOverride
		if !dados.LerCorpo(w, r, &c) {
			return
		}
		if err := c.Validar(); err != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return
		}
		campos, err := dados.Campos(&c)
		if err != nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		campos["external_id"] = chi.URLParam(r, "external_id")
		campos["atualizado_em"] = time.Now().UTC().Format(time.RFC3339Nano)
		var linha []byte
		err = banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) (err error) {
			linha, err = tabelaDriveOverrides.Gravar(r.Context(), tx, autz.Producao, e, campos)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, linha)
	}
}

// apagarOverridesDoSetor: DELETE /acessos/drive/setores/{chave}/overrides: as pastas do setor removido
// voltam à classificação automática. Cada linha passa pela regra (Apagar); tudo na mesma transação.
func apagarOverridesDoSetor(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			rows, err := tx.Query(ctx, `select external_id from acessos_drive_overrides where setor_chave = $1 order by external_id`, chi.URLParam(r, "chave"))
			if err != nil {
				return err
			}
			ids, err := pgx.CollectRows(rows, pgx.RowTo[string])
			if err != nil {
				return err
			}
			if len(ids) == 0 {
				// sem override: 204 só para quem pode apagar o setor (sem poder ou setor que não existe = 404);
				// senão a rota diria "ok" a quem a policy recusa.
				return autz.Producao.PodeApagarPor(ctx, tx, e, "acessos_drive_setores", "chave", chi.URLParam(r, "chave"))
			}
			for _, id := range ids {
				if err := tabelaDriveOverrides.Apagar(ctx, tx, autz.Producao, e, id); err != nil {
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

func montarDrive(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaDriveMarcas.Validar(autz.Producao))
	deve(tabelaDriveSetores.Validar(autz.Producao))
	deve(tabelaDriveOverrides.Validar(autz.Producao))
	r.Get("/acessos/drive/marcas", consultaDriveMarcas.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/acessos/drive/marcas", dados.RotaCriar[corpoDriveMarca](p, autz.Producao, tabelaDriveMarcas))
	r.With(soSessaoPropria).Delete("/acessos/drive/marcas/{id}", dados.RotaApagar(p, autz.Producao, tabelaDriveMarcas))
	r.Get("/acessos/drive/setores", consultaDriveSetores.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/acessos/drive/setores", dados.RotaCriar[corpoDriveSetor](p, autz.Producao, tabelaDriveSetores))
	r.With(soSessaoPropria).Delete("/acessos/drive/setores/{id}", dados.RotaApagar(p, autz.Producao, tabelaDriveSetores))
	r.With(soSessaoPropria).Delete("/acessos/drive/setores/{chave}/overrides", apagarOverridesDoSetor(p))
	r.Get("/acessos/drive/overrides", consultaDriveOverrides.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/acessos/drive/overrides/{external_id}", gravarOverride(p))
}
