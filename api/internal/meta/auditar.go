package meta

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// Auditoria porta supabase/functions/auditar-dados (job integridade-diaria, robô 'auditar-dados') e
// REESCREVE public.run_integrity_checks aqui: os mesmos 7 checks, no mesmo SQL, numa transação.
type Auditoria struct {
	Pool   *pgxpool.Pool
	Core   *core.Cliente
	Alerta string           // ALERT_WEBHOOK_URL (opcional): UM recado por dia com fails e warns
	HTTP   *http.Client     // para o alerta; nil = prazo de 15 s
	Agora  func() time.Time // nil = time.Now
}

func (a *Auditoria) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "auditar-dados", Agenda: "30 2 * * *", Limite: 5 * time.Minute, Executar: a.Rodar}
}

// checksInternos: os nomes que esta auditoria grava (e só estes ela apaga antes de regravar).
var checksInternos = []string{"frescor", "bruto_seguidores", "eng_likes0", "aninhamento", "nav_soma", "queda_seguidores", "alcance_vs_views"}

// integridade: o corpo de run_integrity_checks (levantamento 02-funções.csv), com v_today = $1.
var integridade = []string{
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, a.id, 'frescor',
	  case when (select max(captured_at) from daily_snapshots where account_id=a.id)=$1::date
	        and (select max(captured_at) from engagement_snapshots where account_id=a.id)=$1::date
	        and (select max(captured_at) from content_snapshots where account_id=a.id)=$1::date then 'ok' else 'fail' end,
	  'daily='||coalesce((select max(captured_at)::text from daily_snapshots where account_id=a.id),'-')||' eng='||coalesce((select max(captured_at)::text from engagement_snapshots where account_id=a.id),'-')
	from accounts a`,
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, a.id, 'bruto_seguidores',
	  case when coalesce((select max(captured_at) from daily_snapshots where account_id=a.id and (coalesce(gained,0)>0 or coalesce(lost,0)>0)), date '2000-01-01') >= $1::date-2 then 'ok' else 'warn' end,
	  'ultimo='||coalesce((select max(captured_at)::text from daily_snapshots where account_id=a.id and (coalesce(gained,0)>0 or coalesce(lost,0)>0)),'nunca')
	from accounts a`,
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, e.account_id, 'eng_likes0',
	  case when count(*) filter (where e.likes=0 and e.total_interactions>50)>0 then 'fail' else 'ok' end,
	  coalesce(string_agg(distinct case when e.likes=0 and e.total_interactions>50 then 'p'||e.period_days end, ','),'')
	from engagement_snapshots e where e.captured_at=$1::date group by e.account_id`,
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, x.account_id, 'aninhamento',
	  case when coalesce(l7,0)<=coalesce(l14,0) and coalesce(l14,0)<=coalesce(l30,0) and coalesce(r7,0)<=coalesce(r14,0) and coalesce(r14,0)<=coalesce(r30,0) then 'ok' else 'fail' end,
	  'likes '||coalesce(l7,0)||'/'||coalesce(l14,0)||'/'||coalesce(l30,0)
	from (select account_id,
	    max(likes) filter(where period_days=7) l7,max(likes) filter(where period_days=14) l14,max(likes) filter(where period_days=30) l30,
	    max(reach) filter(where period_days=7) r7,max(reach) filter(where period_days=14) r14,max(reach) filter(where period_days=30) r30
	  from engagement_snapshots where captured_at=$1::date and period_days in (7,14,30) group by account_id) x`,
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, c.account_id, 'nav_soma',
	  case when bool_and(c.story_navigation=c.story_nav_forward+c.story_nav_back+c.story_nav_exit+c.story_nav_next) then 'ok' else 'fail' end, ''
	from content_snapshots c where c.captured_at=$1::date and c.period_days=1 and c.stories_count>0 group by c.account_id`,
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, a.id, 'queda_seguidores',
	  case when x.yc>0 and (x.yc-x.tc)::float/x.yc > 0.25 then 'fail'
	       when x.yc>0 and (x.yc-x.tc)::float/x.yc > 0.10 then 'warn' else 'ok' end,
	  'hoje='||coalesce(x.tc,0)||' ontem='||coalesce(x.yc,0)
	from accounts a cross join lateral (
	  select (select followers_count from daily_snapshots where account_id=a.id and captured_at=$1::date) tc,
	         (select followers_count from daily_snapshots where account_id=a.id and captured_at<$1::date order by captured_at desc limit 1) yc) x`,
	`insert into data_integrity_checks(checked_date,account_id,check_name,status,detail)
	select $1::date, e.account_id, 'alcance_vs_views',
	  case when (e.views>0 and e.reach=0) or (e.reach > e.views + 5) then 'fail' else 'ok' end,
	  'reach='||e.reach||' views='||e.views
	from engagement_snapshots e where e.captured_at=$1::date and e.period_days=7`,
}

// veredito: o valor do painel contra a Meta ao vivo (verdict() da edge).
func veredito(painel, meta *float64) (string, string) {
	if painel == nil || meta == nil {
		return "warn", "sem dado p/ comparar"
	}
	f := func(v float64) string { return strconv.FormatFloat(v, 'f', -1, 64) }
	div := math.Abs(*painel-*meta) / math.Max(*meta, 1)
	switch {
	case (*painel == 0 && *meta > 50) || div > 0.30:
		return "fail", fmt.Sprintf("painel=%s vs Meta=%s", f(*painel), f(*meta))
	case div > 0.15:
		return "warn", fmt.Sprintf("painel=%s vs Meta=%s (%d%%)", f(*painel), f(*meta), int64(math.Floor(div*100+0.5)))
	}
	return "ok", fmt.Sprintf("painel=%s vs Meta=%s", f(*painel), f(*meta))
}

func (a *Auditoria) Rodar(ctx context.Context) error {
	var hoje *string
	if err := a.Pool.QueryRow(ctx, `select max(captured_at)::text from daily_snapshots`).Scan(&hoje); err != nil {
		return err
	}
	if hoje == nil {
		return errors.New("sem snapshots")
	}
	// 1) Checks internos. Só os nomes que a auditoria grava são apagados antes: os recados que o
	//    coletar-dados deixou no dia (coleta_zerada, bruto_seguidores_parado) entram no aviso abaixo.
	err := pgx.BeginFunc(ctx, a.Pool, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `delete from data_integrity_checks where checked_date = $1::date and check_name = any($2::text[])`, *hoje, checksInternos); err != nil {
			return err
		}
		for _, sql := range integridade {
			if _, err := tx.Exec(ctx, sql, *hoje); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("run_integrity_checks: %w", err)
	}
	// 2) Spot-check contra a Meta ao vivo (curtidas + alcance, 7 dias).
	linhas, err := a.Pool.Query(ctx, `select id::text, coalesce(name, ''), coalesce(instagram_id::text, '') from accounts order by name`)
	if err != nil {
		return err
	}
	type contaAud struct{ id, nome, ig string }
	contas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (c contaAud, err error) { return c, r.Scan(&c.id, &c.nome, &c.ig) })
	if err != nil {
		return err
	}
	if _, err := a.Pool.Exec(ctx, `delete from data_integrity_checks where checked_date = $1::date and check_name = 'meta_spotcheck'`, *hoje); err != nil {
		return err
	}
	agora := time.Now
	if a.Agora != nil {
		agora = a.Agora
	}
	ate := agora().Unix()
	for _, c := range contas {
		var metaLikes, metaReach *float64
		if c.ig != "" {
			if j, err := GET(ctx, a.Core, "/"+c.ig+"/insights", map[string]any{"metric": "likes,reach", "period": "day", "metric_type": "total_value",
				"since": strconv.FormatInt(ate-7*86400, 10), "until": strconv.FormatInt(ate, 10)}); err == nil {
				itens, _ := j["data"].([]any)
				for _, x := range itens {
					it, _ := x.(map[string]any)
					tv, _ := it["total_value"].(map[string]any)
					if tv["value"] == nil {
						continue
					}
					v := numero(tv["value"])
					switch it["name"] {
					case "likes":
						metaLikes = &v
					case "reach":
						metaReach = &v
					}
				}
			} else {
				slog.Warn("auditar-dados: Meta", "conta", c.nome, "erro", err)
			}
		}
		var sLikes, sReach *float64
		err := a.Pool.QueryRow(ctx, `select likes::float8, reach::float8 from engagement_snapshots
			where account_id = $1::uuid and captured_at = $2::date and period_days = 7 limit 1`, c.id, *hoje).Scan(&sLikes, &sReach)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return err
		}
		vl, dl := veredito(sLikes, metaLikes)
		vr, dr := veredito(sReach, metaReach)
		pior := "ok"
		if vl == "fail" || vr == "fail" {
			pior = "fail"
		} else if vl == "warn" || vr == "warn" {
			pior = "warn"
		}
		if _, err := a.Pool.Exec(ctx, `insert into data_integrity_checks (checked_date, account_id, check_name, status, detail)
			values ($1::date, $2::uuid, 'meta_spotcheck', $3::text, $4::text)`, *hoje, c.id, pior, "curtidas "+dl+" · alcance "+dr); err != nil {
			return err
		}
	}
	// 3) UM recado por dia com fails E warns (o warn entrou em 2026-08-06: sabia e não contava).
	linhas, err = a.Pool.Query(ctx, `select coalesce(nullif(a.name, ''), nullif(a.instagram_id::text, ''), '?'), d.check_name, coalesce(d.detail, ''), d.status
		  from data_integrity_checks d left join accounts a on a.id = d.account_id
		 where d.checked_date = $1::date and d.status in ('fail', 'warn')
		 order by d.status, d.check_name, 1`, *hoje)
	if err != nil {
		return err
	}
	var fails, warns []string
	var nome, check, detalhe, status string
	if _, err := pgx.ForEachRow(linhas, []any{&nome, &check, &detalhe, &status}, func() error {
		l := "• " + nome + " · " + check
		if detalhe != "" {
			l += " (" + detalhe + ")"
		}
		if status == "fail" {
			fails = append(fails, l)
		} else {
			warns = append(warns, l)
		}
		return nil
	}); err != nil {
		return err
	}
	slog.Info("auditar-dados", "dia", *hoje, "fails", len(fails), "warns", len(warns))
	if len(fails)+len(warns) > 0 {
		var partes []string
		if len(fails) > 0 {
			partes = append(partes, fmt.Sprintf("🚨 %d falha(s):\n", len(fails))+strings.Join(fails, "\n"))
		}
		if len(warns) > 0 {
			partes = append(partes, fmt.Sprintf("⚠️ %d aviso(s):\n", len(warns))+strings.Join(warns, "\n"))
		}
		if err := avisarWebhook(ctx, a.HTTP, a.Alerta, "Saúde dos dados ("+*hoje+")\n\n"+strings.Join(partes, "\n\n")); err != nil {
			slog.Error("auditar-dados: webhook de alerta", "erro", err)
		}
	}
	return nil
}
