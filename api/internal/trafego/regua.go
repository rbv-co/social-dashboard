package trafego

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasRegua = `t.id, t.pesos, t.metas, t.limiares, t.limiares_resultado, t.metas_por_conta, t.updated_at`

var consultaRegua = dados.Consulta{Tabela: "gt_ponderada_config", Alias: "t",
	SQL: `select ` + colunasRegua + ` from gt_ponderada_config t`, OrdemPadrao: "t.id", Desempate: "t.id"}

var (
	tabelaRegua    = dados.Tabela{Nome: "gt_ponderada_config", Resposta: colunasRegua}
	tabelaReguaLog = dados.Tabela{Nome: "gt_ponderada_config_log", Resposta: "t.id", Autor: "mudou_quem"}
)

type corpoRegua struct {
	Pesos             json.RawMessage `json:"pesos"`
	Limiares          json.RawMessage `json:"limiares"`
	LimiaresResultado json.RawMessage `json:"limiares_resultado"`
	ContaID           string          `json:"conta_id"`
	Metas             json.RawMessage `json:"metas"`
}

// objetoRaso: objeto JSON de até 50 chaves curtas cujos valores são número, booleano ou null.
func objetoRaso(v json.RawMessage) bool {
	var m map[string]any
	if !objeto(v) || json.Unmarshal(v, &m) != nil || len(m) > 50 {
		return false
	}
	for k, x := range m {
		switch x.(type) {
		case float64, bool, nil:
		default:
			return false
		}
		if k == "" || len(k) > 40 {
			return false
		}
	}
	return true
}

// gravarRegua: PUT /gestao-trafego/regua (Ruling 5.7-7).
func gravarRegua(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOu500(w, r)
		if e == nil {
			return
		}
		var in corpoRegua
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if !objetoRaso(in.Pesos) || !objetoRaso(in.Limiares) || !objetoRaso(in.LimiaresResultado) || !objetoRaso(in.Metas) || !reUUID.MatchString(in.ContaID) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "A régua é pesos, limiares, limiares_resultado, conta_id e metas.")
			return
		}
		// as metas são DA CONTA: quem não vê a conta não muda as metas dela; quem não é gestor nem trava a linha
		fe, err := autz.Producao.Filtro(e, "gt_ponderada_config", autz.Editar, "t")
		if err != nil || fe.Nega() || !autz.PodeVerConta(e, in.ContaID) {
			if err == nil {
				err = autz.ErrNegado
			}
			dados.ErroDeEscrita(w, err)
			return
		}
		ctx := r.Context()
		var corpo []byte
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			// trava ANTES de ler: a leitura seguinte (outra instrução, outro instantâneo) vê a última gravada
			if _, err := tx.Exec(ctx, `select 1 from gt_ponderada_config where id = 1 for update`); err != nil {
				return err
			}
			var antes, mapa []byte
			err := tx.QueryRow(ctx, `select row_to_json(x) from (select `+colunasRegua+` from gt_ponderada_config t where t.id = 1) x`).Scan(&antes)
			if errors.Is(err, pgx.ErrNoRows) {
				return autz.ErrNaoEncontrado
			}
			if err != nil {
				return err
			}
			if err := tx.QueryRow(ctx, `select coalesce(metas_por_conta, '{}'::jsonb) || jsonb_build_object(@conta::text, @metas::jsonb)
				from gt_ponderada_config where id = 1`, pgx.NamedArgs{"conta": in.ContaID, "metas": string(in.Metas)}).Scan(&mapa); err != nil {
				return err
			}
			depois, err := tabelaRegua.Editar(ctx, tx, autz.Producao, e, "1", map[string]any{
				"pesos": in.Pesos, "limiares": in.Limiares, "limiares_resultado": in.LimiaresResultado,
				"metas_por_conta": json.RawMessage(mapa), "updated_at": agora(), "updated_by": e.ID})
			if err != nil {
				return err
			}
			if _, err := tabelaReguaLog.Criar(ctx, tx, autz.Producao, e,
				map[string]any{"antes": json.RawMessage(antes), "depois": json.RawMessage(depois)}); err != nil {
				return err
			}
			corpo = depois
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, corpo)
	}
}

func montarRegua(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaRegua.Validar(autz.Producao))
	deve(tabelaReguaLog.Validar(autz.Producao))
	r.Get("/gestao-trafego/regua", consultaRegua.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Put("/gestao-trafego/regua", gravarRegua(p))
}
