// Package fabrica: as tarefas da Fábrica de Anúncios que o worker roda.
package fabrica

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// Purga porta supabase/functions/fabrica-purga (job fabrica-purga-diaria, robô 'fabrica-purga'):
// apaga os criativos das rodadas fechadas (ou nunca fechadas e com mais de 30 dias) e marca
// purgado_em. Os arquivos moram em <Dir>/fabrica-criativos/<storage_path> (spec §7: o mesmo caminho
// do objeto no bucket). Qualquer erro aborta a rodada, como o `throw` da edge.
type Purga struct {
	Pool *pgxpool.Pool
	Dir  string // ARQUIVOS_DIR
}

func (pu *Purga) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "fabrica-purga", Agenda: "17 4 * * *", Limite: 5 * time.Minute, Executar: pu.Rodar}
}

func (pu *Purga) Rodar(ctx context.Context) error {
	if pu.Dir == "" {
		return errors.New("ARQUIVOS_DIR vazio: não sei onde estão os criativos")
	}
	base := filepath.Join(pu.Dir, "fabrica-criativos")
	linhas, err := pu.Pool.Query(ctx, `select id::text from fabrica_campanhas
		where purgado_em is null and (fechada_em is not null or created_at < now() - interval '30 days')`)
	if err != nil {
		return err
	}
	rodadas, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		return err
	}
	objetos := 0
	for _, id := range rodadas {
		linhas, err := pu.Pool.Query(ctx, `select storage_path from fabrica_criativos
			where campanha_id = $1::uuid and purgado_em is null and coalesce(storage_path, '') <> ''`, id)
		if err != nil {
			return err
		}
		caminhos, err := pgx.CollectRows(linhas, pgx.RowTo[string])
		if err != nil {
			return err
		}
		for _, c := range caminhos {
			if err := apagar(base, c); err != nil {
				return fmt.Errorf("rodada %s: %w", id, err)
			}
		}
		objetos += len(caminhos)
		err = pgx.BeginFunc(ctx, pu.Pool, func(tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `update fabrica_criativos set purgado_em = now() where campanha_id = $1::uuid and purgado_em is null`, id); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `update fabrica_campanhas set purgado_em = now() where id = $1::uuid`, id)
			return err
		})
		if err != nil {
			return err
		}
	}
	slog.Info("fabrica-purga", "rodadas_purgadas", len(rodadas), "objetos_apagados", objetos)
	return nil
}

// apagar remove base/c. O caminho vem do banco: nunca sai da pasta do bucket. filepath.IsLocal recusa
// "..", absoluto e vazio; o NUL é recusado à parte; e os.Root recusa symlink de DIRETÓRIO que aponte
// para fora (IsLocal só olha o texto). Arquivo que já não existe conta como apagado.
func apagar(base, c string) error {
	if !filepath.IsLocal(c) || strings.ContainsRune(c, 0) {
		return fmt.Errorf("caminho recusado %q", c)
	}
	raiz, err := os.OpenRoot(base)
	if errors.Is(err, fs.ErrNotExist) {
		return nil // a pasta do bucket nem existe: não há o que apagar
	}
	if err != nil {
		return err
	}
	defer raiz.Close()
	if err := raiz.Remove(c); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}
