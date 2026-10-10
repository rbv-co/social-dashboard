package conteudo

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/meta"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// Espelho porta supabase/functions/conteudo-espelho (pg_cron */30, robô 'conteudo-espelho'):
// A) CASAR peças agendadas/publicadas sem vínculo com o post real de /{ig}/media;
// B) MEDIR as já vinculadas (cadência de cadencia-de-medicao.js). A Graph vai SEMPRE pelo core.
type Espelho struct {
	Pool  *pgxpool.Pool
	Core  *core.Cliente
	Agora func() time.Time // nil = time.Now
}

func (e *Espelho) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "conteudo-espelho", Agenda: "*/30 * * * *", Limite: 10 * time.Minute, Executar: e.Rodar}
}

const (
	camposMidia          = "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count"
	diasDeAcompanhamento = 30
	diasDeMedidaDiaria   = 7
)

func (e *Espelho) Rodar(ctx context.Context) error {
	agora := time.Now
	if e.Agora != nil {
		agora = e.Agora
	}
	t := agora()
	var falhas []string
	casadas, sugeridas, err := e.casar(ctx, t, &falhas)
	if err != nil {
		return err
	}
	medidas, err := e.medir(ctx, t, &falhas)
	if err != nil {
		return err
	}
	slog.Info("conteudo-espelho", "casadas", casadas, "sugeridas", sugeridas, "medidas", medidas, "falhas", len(falhas))
	if len(falhas) > 0 { // uma conta/peça que falha não derruba as outras, mas a rodada fica vermelha
		return fmt.Errorf("espelho: %d falha(s): %s", len(falhas), strings.Join(falhas, " · "))
	}
	return nil
}

type contaIG struct{ id, nome, ig string }

// casar = PASSO A. Story fica de fora (a Graph não devolve story de forma confiável em /media).
func (e *Espelho) casar(ctx context.Context, t time.Time, falhas *[]string) (casadas, sugeridas int, err error) {
	linhas, err := e.Pool.Query(ctx, `select id::text, account_id::text, coalesce(formato, ''), coalesce(legenda, ''), coalesce(hashtags, ''), publicar_em
		  from conteudo_pecas
		 where status in ('agendada', 'publicada') and formato <> 'stories' and ig_media_id is null
		   and publicar_em is not null and publicar_em >= $1::timestamptz
		 order by publicar_em`, t.Add(-7*24*time.Hour))
	if err != nil {
		return 0, 0, err
	}
	pecas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (p Peca, err error) {
		return p, r.Scan(&p.ID, &p.AccountID, &p.Formato, &p.Legenda, &p.Hashtags, &p.PublicarEm)
	})
	if err != nil || len(pecas) == 0 {
		return 0, 0, err
	}
	porConta := map[string][]Peca{}
	var ids []string
	for _, p := range pecas {
		if porConta[p.AccountID] == nil {
			ids = append(ids, p.AccountID)
		}
		porConta[p.AccountID] = append(porConta[p.AccountID], p)
	}
	linhas, err = e.Pool.Query(ctx, `select id::text, coalesce(name, ''), coalesce(instagram_id::text, '') from accounts where id::text = any($1::text[]) order by name`, ids)
	if err != nil {
		return 0, 0, err
	}
	contas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (c contaIG, err error) { return c, r.Scan(&c.id, &c.nome, &c.ig) })
	if err != nil {
		return 0, 0, err
	}
	for _, c := range contas {
		if c.ig == "" {
			continue
		}
		j, err := meta.GET(ctx, e.Core, "/"+c.ig+"/media", map[string]any{"fields": camposMidia, "limit": "50"})
		if err != nil {
			*falhas = append(*falhas, "casar "+c.nome+": "+err.Error())
			continue
		}
		var lote struct {
			Data []Midia `json:"data"`
		}
		b, _ := json.Marshal(j)
		json.Unmarshal(b, &lote)
		daConta := porConta[c.id]
		pecaIDs := make([]string, len(daConta))
		for i, p := range daConta {
			pecaIDs[i] = p.ID
		}
		// Posts já vinculados a alguma peça, ou já decididos para estas: nunca oferecer de novo o que a
		// pessoa já disse que não era.
		linhas, err := e.Pool.Query(ctx, `select ig_media_id from conteudo_pecas where ig_media_id is not null
			union select ig_media_id from conteudo_casamentos where peca_id::text = any($1::text[])`, pecaIDs)
		if err != nil {
			return 0, 0, err
		}
		usados, err := pgx.CollectRows(linhas, pgx.RowTo[string])
		if err != nil {
			return 0, 0, err
		}
		jaUsados := map[string]bool{}
		for _, u := range usados {
			jaUsados[u] = true
		}
		for _, a := range casar(daConta, lote.Data, jaUsados) {
			err := pgx.BeginFunc(ctx, e.Pool, func(tx pgx.Tx) error {
				if _, err := tx.Exec(ctx, `insert into conteudo_casamentos (peca_id, ig_media_id, ig_permalink, ig_timestamp, ig_caption, ig_thumb, pontuacao, situacao, motivo)
					values ($1::uuid, $2::text, $3::text, $4::timestamptz, $5::text, $6::text, $7::numeric, $8::text, $9::text)
					on conflict (peca_id, ig_media_id) do update set ig_permalink = excluded.ig_permalink, ig_timestamp = excluded.ig_timestamp,
					  ig_caption = excluded.ig_caption, ig_thumb = excluded.ig_thumb, pontuacao = excluded.pontuacao,
					  situacao = excluded.situacao, motivo = excluded.motivo`,
					a.PecaID, a.IGMediaID, a.IGPermalink, a.IGTimestamp, a.IGCaption, a.IGThumb, a.Pontuacao, a.Situacao, a.Motivo); err != nil {
					return err
				}
				if a.Situacao != "automatico" {
					return nil
				}
				if _, err := tx.Exec(ctx, `update conteudo_pecas set ig_media_id = $2::text, ig_permalink = $3::text, status = 'publicada',
					publicado_em = $4::timestamptz where id = $1::uuid`, a.PecaID, a.IGMediaID, a.IGPermalink, a.IGTimestamp); err != nil {
					return err
				}
				_, err := tx.Exec(ctx, `insert into conteudo_eventos (peca_id, acao, detalhe) values ($1::uuid, 'casou', $2::text)`,
					a.PecaID, "Encontrei o post no Instagram sozinho. "+a.Motivo)
				return err
			})
			if err != nil {
				return 0, 0, err
			}
			if a.Situacao == "automatico" {
				casadas++
			} else {
				sugeridas++
			}
		}
	}
	return casadas, sugeridas, nil
}

// precisaMedir (cadencia-de-medicao.js): todo dia na 1ª semana, uma vez por semana até 30 dias,
// depois nunca. As datas são em UTC, como a edge (toISOString().slice(0,10)).
func precisaMedir(publicado time.Time, ultima string, agora time.Time) bool {
	idade := agora.Sub(publicado).Hours() / 24
	if idade > diasDeAcompanhamento {
		return false
	}
	if ultima == "" {
		return true
	}
	if ultima >= agora.UTC().Format("2006-01-02") {
		return false
	}
	u, err := time.Parse(time.RFC3339, ultima+"T12:00:00Z")
	if err != nil {
		return false
	}
	return idade <= diasDeMedidaDiaria || agora.Sub(u).Hours()/24 >= 7
}

// insight devolve values[0].value da primeira métrica presente (nil = a Meta não respondeu).
func insight(ins map[string]any, nomes ...string) any {
	lista, _ := ins["data"].([]any)
	for _, nome := range nomes {
		for _, x := range lista {
			i, _ := x.(map[string]any)
			if i["name"] != nome {
				continue
			}
			vs, _ := i["values"].([]any)
			if len(vs) > 0 {
				if v, _ := vs[0].(map[string]any); v["value"] != nil {
					return v["value"]
				}
			}
		}
	}
	return nil
}

// medir = PASSO B. null e 0 são diferentes: null = a Meta não respondeu a métrica.
func (e *Espelho) medir(ctx context.Context, t time.Time, falhas *[]string) (int, error) {
	linhas, err := e.Pool.Query(ctx, `select p.id::text, p.ig_media_id, p.publicado_em,
			coalesce((select max(m.capturado_em)::text from conteudo_metricas m where m.peca_id = p.id), '')
		  from conteudo_pecas p
		 where p.ig_media_id is not null and p.publicado_em >= $1::timestamptz
		   and exists (select 1 from accounts a where a.id = p.account_id)`, t.Add(-diasDeAcompanhamento*24*time.Hour))
	if err != nil {
		return 0, err
	}
	type publicada struct {
		id, media, ultima string
		em                time.Time
	}
	pubs, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (p publicada, err error) {
		return p, r.Scan(&p.id, &p.media, &p.em, &p.ultima)
	})
	if err != nil {
		return 0, err
	}
	medidas := 0
	for _, p := range pubs {
		if !precisaMedir(p.em, p.ultima, t) {
			continue
		}
		midia, err := meta.GET(ctx, e.Core, "/"+p.media, map[string]any{"fields": "like_count,comments_count,permalink"})
		if err != nil {
			*falhas = append(*falhas, "medir "+p.id+": "+err.Error())
			continue
		}
		// Os insights falham em alguns tipos de mídia (e em post antigo): não impedem curtidas e comentários.
		ins, _ := meta.GET(ctx, e.Core, "/"+p.media+"/insights", map[string]any{"metric": "reach,saved,shares,views"})
		bruto, _ := json.Marshal(map[string]any{"midia": midia, "insights": ins})
		if _, err := e.Pool.Exec(ctx, `insert into conteudo_metricas (peca_id, capturado_em, curtidas, comentarios, alcance, salvamentos, compartilhamentos, visualizacoes, bruto)
			values ($1::uuid, $2::date, $3::numeric::int, $4::numeric::int, $5::numeric::int, $6::numeric::int, $7::numeric::int, $8::numeric::int, $9::jsonb)
			on conflict (peca_id, capturado_em) do update set curtidas = excluded.curtidas, comentarios = excluded.comentarios,
			  alcance = excluded.alcance, salvamentos = excluded.salvamentos, compartilhamentos = excluded.compartilhamentos,
			  visualizacoes = excluded.visualizacoes, bruto = excluded.bruto`,
			p.id, t.UTC().Format("2006-01-02"), numeroOuNulo(midia["like_count"]), numeroOuNulo(midia["comments_count"]),
			numeroOuNulo(insight(ins, "reach")), numeroOuNulo(insight(ins, "saved")), numeroOuNulo(insight(ins, "shares")),
			numeroOuNulo(insight(ins, "views", "impressions")), string(bruto)); err != nil {
			return medidas, err
		}
		medidas++
	}
	return medidas, nil
}

// numeroOuNulo: o número como texto (o banco converte), ou nil. Nunca troca "não veio" por zero.
func numeroOuNulo(v any) *string {
	if v == nil {
		return nil
	}
	s := fmt.Sprint(v)
	return &s
}
