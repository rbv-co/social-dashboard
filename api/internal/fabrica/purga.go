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
	// A pasta-base tem de existir ANTES de qualquer coisa no banco: sem ela (volume não montado) toda
	// rodada fechada seria marcada como purgada sem ter apagado arquivo nenhum.
	raiz, err := os.OpenRoot(filepath.Join(pu.Dir, "fabrica-criativos"))
	if err != nil {
		switch {
		case errors.Is(err, fs.ErrPermission):
			return fmt.Errorf("pasta-base sem permissão de leitura (dono/permissão do volume em ARQUIVOS_DIR): %w", err)
		case errors.Is(err, fs.ErrNotExist):
			return fmt.Errorf("pasta-base ausente: volume montado? %w", err)
		}
		return fmt.Errorf("pasta-base inacessível: %w", err)
	}
	defer raiz.Close()
	linhas, err := pu.Pool.Query(ctx, `select id::text from fabrica_campanhas
		where purgado_em is null and (fechada_em is not null or created_at < now() - interval '30 days')`)
	if err != nil {
		return err
	}
	rodadas, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		return err
	}
	// Uma rodada com problema não trava as outras (Ruling 17): os erros se juntam e a tarefa falha
	// visível; a rodada com erro NÃO é marcada e é tentada de novo amanhã.
	var erros []error
	purgadas, objetos := 0, 0
	for _, id := range rodadas {
		n, err := pu.purgar(ctx, raiz, id)
		objetos += n
		if err != nil {
			erros = append(erros, fmt.Errorf("rodada %s: %w", id, err))
			continue
		}
		purgadas++
	}
	slog.Info("fabrica-purga", "rodadas_purgadas", purgadas, "rodadas_com_erro", len(erros), "objetos_apagados", objetos)
	return errors.Join(erros...)
}

// purgar apaga os arquivos de UMA rodada e só então a marca (e os criativos) como purgada, na mesma
// transação. Um caminho recusado não impede apagar os outros arquivos da rodada, mas impede a marca.
func (pu *Purga) purgar(ctx context.Context, raiz *os.Root, id string) (int, error) {
	linhas, err := pu.Pool.Query(ctx, `select storage_path from fabrica_criativos
		where campanha_id = $1::uuid and purgado_em is null and coalesce(storage_path, '') <> ''`, id)
	if err != nil {
		return 0, err
	}
	caminhos, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil {
		return 0, err
	}
	var erros []error
	for _, c := range caminhos {
		if err := apagar(raiz, c); err != nil {
			erros = append(erros, err)
		}
	}
	if len(erros) > 0 {
		return len(caminhos) - len(erros), errors.Join(erros...)
	}
	err = pgx.BeginFunc(ctx, pu.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `update fabrica_criativos set purgado_em = now() where campanha_id = $1::uuid and purgado_em is null`, id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `update fabrica_campanhas set purgado_em = now() where id = $1::uuid`, id)
		return err
	})
	return len(caminhos), err
}

// apagar remove raiz/c. O caminho vem do banco: nunca sai da pasta do bucket. filepath.IsLocal recusa
// "..", absoluto e vazio; o NUL é recusado à parte; e os.Root recusa symlink de DIRETÓRIO que aponte
// para fora (IsLocal só olha o texto). Arquivo que já não existe conta como apagado.
func apagar(raiz *os.Root, c string) error {
	if !filepath.IsLocal(c) || strings.ContainsRune(c, 0) {
		return fmt.Errorf("caminho recusado %q", c)
	}
	if err := raiz.Remove(c); err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}
	return nil
}
