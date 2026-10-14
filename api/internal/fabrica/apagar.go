package fabrica

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/github"
)

// Apagador: POST /fabrica-apagar. Portão (soFabricante, soSessaoPropria) na montagem.
type Apagador struct {
	Pool     *pgxpool.Pool
	GH       *github.Cliente
	Arquivos string // ARQUIVOS_DIR: os criativos moram em <Arquivos>/fabrica-criativos/<storage_path>
}

type pedidoApagar struct {
	CampanhaID *string `json:"campanhaId"`
}

func (a *Apagador) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	var c pedidoApagar
	if !dados.LerCorpo(w, r, &c) {
		return
	}
	if c.CampanhaID == nil || *c.CampanhaID == "" {
		responder(w, http.StatusBadRequest, map[string]string{"error": "campanhaId_obrigatorio"})
		return
	}
	id := *c.CampanhaID
	if !reUUID.MatchString(id) {
		responder(w, http.StatusBadRequest, map[string]string{"error": "campanhaId_invalido"})
		return
	}
	ctx := r.Context()
	achou := true
	var runID string
	var caminhos []string
	err := banco.ComUsuario(ctx, a.Pool, e.ID, func(tx pgx.Tx) error {
		var status string
		var job *string
		err := tx.QueryRow(ctx, `select status, job_id::text from fabrica_campanhas where id = $1::uuid for update`, id).
			Scan(&status, &job)
		if errors.Is(err, pgx.ErrNoRows) {
			achou = false
			return nil
		}
		if err != nil {
			return err
		}
		if err := autz.Producao.PodeApagar(ctx, tx, e, "fabrica_campanhas", id); err != nil {
			return err
		}
		if status == "gerando" && job != nil {
			err := tx.QueryRow(ctx, `select coalesce(github_run_id, '') from fabrica_jobs where id = $1::uuid`, *job).Scan(&runID)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
		}
		linhas, err := tx.Query(ctx, `select storage_path from fabrica_criativos
			where campanha_id = $1::uuid and coalesce(storage_path, '') <> ''`, id)
		if err != nil {
			return err
		}
		if caminhos, err = pgx.CollectRows(linhas, pgx.RowTo[string]); err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `delete from fabrica_campanhas where id = $1::uuid`, id) // criativos: on delete cascade
		return err
	})
	if err != nil {
		dados.ErroDeEscrita(w, err)
		return
	}
	if !achou {
		responder(w, http.StatusOK, map[string]bool{"ok": true}) // idempotente (fabrica-apagar/index.ts:17)
		return
	}
	// Depois do commit, melhor esforço (Ruling 5.8-9): o banco já é a verdade.
	if runID != "" {
		if err := a.GH.Cancelar(context.WithoutCancel(ctx), "fabrica", runID); err != nil {
			slog.Warn("fabrica-apagar: não cancelei o run", "campanha", id, "erro", err.Error())
		}
	}
	falhas := a.apagarArquivos(id, caminhos)
	slog.Info("fabrica-apagar", "campanha", id, "arquivos", len(caminhos), "arquivos_com_erro", falhas, "cancelou_run", runID != "")
	responder(w, http.StatusOK, map[string]bool{"ok": true})
}

// apagarArquivos: cada caminho pela apagar da purga (mesma raiz, mesmo IsLocal) e a pasta da rodada.
// Devolve quantos falharam; o que sobrar é da faxina-fabrica.
func (a *Apagador) apagarArquivos(campanha string, caminhos []string) (falhas int) {
	raiz, err := os.OpenRoot(filepath.Join(a.Arquivos, "fabrica-criativos"))
	if err != nil {
		slog.Error("fabrica-apagar: pasta-base inacessível; os arquivos ficam para a faxina", "erro", err.Error())
		return len(caminhos) + 1
	}
	defer raiz.Close()
	for _, c := range caminhos {
		if err := apagar(raiz, c); err != nil {
			falhas++
			slog.Warn("fabrica-apagar: arquivo não apagado", "campanha", campanha, "erro", err.Error())
		}
	}
	if err := raiz.RemoveAll(campanha); err != nil { // o que não tem linha (o .mp4 do 16:9) mora em <id>/
		falhas++
		slog.Warn("fabrica-apagar: pasta da rodada não apagada", "campanha", campanha, "erro", err.Error())
	}
	return falhas
}
