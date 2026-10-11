package meta

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/texto"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// ColetaDiaria porta supabase/functions/coletar-dados + public.disparar_coletor (jobs coletar-dados-07h,
// -12h, -18h e -2359). Uma rodada passa por TODAS as contas que disparar_coletor escolhia
// (instagram_id e access_token preenchidos, em ordem de nome) e grava UMA linha por conta em
// robos_execucoes com o nome de produção 'coletar-dados-<rodada> · <conta>' (a tela casa
// 'coletar-dados%'). A Graph vai pelo core, que é o dono do token: renovarToken não existe mais.
type ColetaDiaria struct {
	Pool       *pgxpool.Pool
	Core       *core.Cliente
	Gravar     func(ctx context.Context, robo string, inicio time.Time, erro error) error // worker.Agendador.Gravador()
	Alerta     string                                                                     // ALERT_WEBHOOK_URL (opcional; vazio = só a linha em data_integrity_checks)
	HTTP       *http.Client                                                               // para o alerta; nil = prazo de 15 s
	Agora      func() time.Time                                                           // nil = time.Now
	Dormir     func(context.Context, time.Duration) error                                 // espera entre releituras; nil = espera de verdade
	PrazoConta time.Duration                                                              // 0 = 6 min por conta (prazoPorConta)
}

func (c *ColetaDiaria) prazoConta() time.Duration {
	if c.PrazoConta > 0 {
		return c.PrazoConta
	}
	return prazoPorConta
}

// Tarefas: as 4 rodadas de produção (cron.job, UTC). Dividem a trava: duas rodadas nunca se cruzam.
//
// RegistroProprio e falha de conta: cada conta grava a linha DELA em robos_execucoes
// ('coletar-dados-07h · <conta>') e a falha de uma conta vira a linha dela com ok=false, sem derrubar as
// outras. A view robos_saude julga cada variante pela execução mais recente DELA; uma linha agregada
// vermelha 'coletar-dados-07h' criaria uma variante sem nenhum sucesso ("nunca deu certo" por 72 h).
// Por isso a rodada NÃO devolve erro comum quando só contas falharam: devolve worker.Falhou(n, nomes),
// que o agendador trata sem gravar linha agregada, mas sinalizando: slog.Error por conta (aqui),
// Metrica.Falhas/UltimoErro e o código de saída 1 de `api worker rodar`. Erro de verdade (limite de 50 min
// com conta sem coletar, banco fora) continua gravando a linha agregada.
func (c *ColetaDiaria) Tarefas() []worker.Tarefa {
	rodada := func(nome, agenda string) worker.Tarefa {
		return worker.Tarefa{Nome: "coletar-dados-" + nome, Agenda: agenda, Trava: "coletar-dados", RegistroProprio: true,
			Limite: 50 * time.Minute, Executar: func(ctx context.Context) error { return c.Rodada(ctx, nome) }}
	}
	return []worker.Tarefa{rodada("07h", "0 10 * * *"), rodada("12h", "0 15 * * *"), rodada("18h", "0 21 * * *"), rodada("2359", "59 2 * * *")}
}

// prazoPorConta: uma conta presa não come a rodada inteira (o pg_net dava 140 s por conta; pelo
// core, no ritmo de ~100 chamadas/min, uma conta grande precisa de alguns minutos).
const prazoPorConta = 6 * time.Minute

type contaColeta struct{ id, nome, ig, ad string }

func (c *ColetaDiaria) agora() time.Time {
	if c.Agora != nil {
		return c.Agora()
	}
	return time.Now()
}

func (c *ColetaDiaria) dormir(ctx context.Context, d time.Duration) error {
	if c.Dormir != nil {
		return c.Dormir(ctx, d)
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// degradados: o que a rodada avisa ao super admin no fim, em duas famílias: métricas que a Meta devolveu
// zeradas/inconsistentes (`zeradas`) e leituras da Graph que falharam de fato (`graph`).
type degradados struct{ zeradas, graph []string }

// Rodada coleta todas as contas, em série. O dia ("hoje" em São Paulo) é o do COMEÇO da rodada para todas
// (a de 23:59 passa da meia-noite com várias contas). A falha de uma conta vira a linha DELA (ok=false) e
// a rodada segue; no fim devolve worker.Falhou se alguma falhou (ver Tarefas). Os degradados são uma
// lista só para a rodada, avisada no fim (como a edge), mesmo com conta que terminou em erro.
func (c *ColetaDiaria) Rodada(ctx context.Context, rodada string) error {
	hoje := c.hoje()
	linhas, err := c.Pool.Query(ctx, `select id::text, coalesce(name, ''), instagram_id::text, coalesce(ad_account_id::text, '')
		  from accounts where instagram_id is not null and access_token is not null order by name`)
	if err != nil {
		return err
	}
	contas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (x contaColeta, err error) {
		return x, r.Scan(&x.id, &x.nome, &x.ig, &x.ad)
	})
	if err != nil {
		return err
	}
	var deg degradados
	var falharam []string
	defer func() {
		g, cancela := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
		defer cancela()
		c.avisarSuperAdmin(g, hoje, deg)
	}()
	for i, conta := range contas {
		if ctx.Err() != nil { // o prazo da rodada acabou com conta sem coletar
			return fmt.Errorf("limite de tempo da rodada: %d de %d conta(s) sem coletar: %w", len(contas)-i, len(contas), ctx.Err())
		}
		inicio := c.agora()
		ctxC, cancela := context.WithTimeout(ctx, c.prazoConta())
		erro := c.processarConta(ctxC, conta, hoje, &deg)
		cancela()
		if erro != nil {
			falharam = append(falharam, conta.nome)
			slog.Error("coletar-dados: conta falhou", "rodada", rodada, "conta", conta.nome, "erro", erro.Error())
		}
		g, cancelaG := context.WithTimeout(context.WithoutCancel(ctx), 10*time.Second)
		err := c.Gravar(g, fmt.Sprintf("coletar-dados-%s · %s", rodada, conta.nome), inicio, erro)
		cancelaG()
		if err != nil {
			return err
		}
	}
	if len(falharam) > 0 {
		return worker.Falhou(len(falharam), strings.Join(falharam, ", "))
	}
	return nil
}

var periodos = []int{0, 1, 7, 14, 30}

var chavesEng = []string{"likes", "comments", "saves", "shares", "reach", "views", "total_interactions", "accounts_engaged", "profile_views"}

func (c *ColetaDiaria) hoje() string { return c.agora().In(saoPaulo).Format("2006-01-02") }

// menosDias: o dia de São Paulo `n` dias antes de `dia` (brDateMinus da edge).
func menosDias(dia string, n int) string {
	t, _ := time.ParseInLocation("2006-01-02", dia, saoPaulo)
	return t.AddDate(0, 0, -n).Format("2006-01-02")
}

// inicioDoDia: a meia-noite de São Paulo em segundos (`${dia}T00:00:00-03:00` da edge).
func inicioDoDia(dia string) int64 {
	t, _ := time.ParseInLocation("2006-01-02", dia, saoPaulo)
	return t.Unix()
}

func diaDaMeta(ts string) string {
	for _, l := range []string{"2006-01-02T15:04:05-0700", time.RFC3339} {
		if t, err := time.Parse(l, ts); err == nil {
			return t.In(saoPaulo).Format("2006-01-02")
		}
	}
	return ""
}

func (c *ColetaDiaria) processarConta(ctx context.Context, conta contaColeta, hoje string, deg *degradados) error {
	j, err := GET(ctx, c.Core, "/"+conta.ig, map[string]any{"fields": "followers_count"})
	if err != nil {
		return err // como a edge: sem a contagem, nada desta conta é coletado nesta rodada
	}
	seguidores := numero(j["followers_count"])
	if _, err := c.Pool.Exec(ctx, `insert into daily_snapshots (account_id, captured_at, followers_count) values ($1::uuid, $2::date, $3::numeric)
		on conflict (account_id, captured_at) do update set followers_count = excluded.followers_count`, conta.id, hoje, seguidores); err != nil {
		return err
	}
	// Cada leitura é uma linha própria (append-only): o movimento DENTRO do dia não se perde.
	if _, err := c.Pool.Exec(ctx, `insert into followers_leituras (account_id, followers_count, origem) values ($1::uuid, $2::numeric, 'diario')`,
		conta.id, seguidores); err != nil {
		return err
	}
	if err := c.brutoDeSeguidores(ctx, conta, hoje); err != nil {
		return err
	}
	st := c.storiesDeHoje(ctx, conta.ig, hoje)
	midias, erroMidias := GET(ctx, c.Core, "/"+conta.ig+"/media", map[string]any{"fields": "id,media_product_type,timestamp,owner", "limit": "100"})
	for _, dias := range periodos {
		posts, reels := 0, 0
		if erroMidias == nil { // uma leitura de /media serve os 5 períodos (a edge pedia a mesma coisa 5 vezes)
			posts, reels = contarMidias(midias, conta.ig, hoje, dias)
		}
		if err := c.gravarEng(ctx, conta, hoje, dias, deg); err != nil {
			return err
		}
		sql := `insert into content_snapshots (account_id, captured_at, period_days, posts_count, reels_count)
			values ($1::uuid, $2::date, $3::int, $4::int, $5::int)
			on conflict (account_id, captured_at, period_days) do update set posts_count = excluded.posts_count, reels_count = excluded.reels_count`
		args := []any{conta.id, hoje, dias, posts, reels}
		if dias <= 1 {
			sql = `insert into content_snapshots (account_id, captured_at, period_days, posts_count, reels_count, stories_count, story_shares,
				story_replies, story_reach, story_interactions, story_navigation, story_profile_visits, story_follows,
				story_nav_forward, story_nav_back, story_nav_exit, story_nav_next)
				values ($1::uuid, $2::date, $3::int, $4::int, $5::int, $6::int, $7::numeric, $8::numeric, $9::numeric, $10::numeric,
				  $11::numeric, $12::numeric, $13::numeric, $14::numeric, $15::numeric, $16::numeric, $17::numeric)
				on conflict (account_id, captured_at, period_days) do update set posts_count = excluded.posts_count,
				  reels_count = excluded.reels_count, stories_count = excluded.stories_count, story_shares = excluded.story_shares,
				  story_replies = excluded.story_replies, story_reach = excluded.story_reach, story_interactions = excluded.story_interactions,
				  story_navigation = excluded.story_navigation, story_profile_visits = excluded.story_profile_visits,
				  story_follows = excluded.story_follows, story_nav_forward = excluded.story_nav_forward,
				  story_nav_back = excluded.story_nav_back, story_nav_exit = excluded.story_nav_exit, story_nav_next = excluded.story_nav_next`
			args = append(args, st.quantos, st.shares, st.replies, st.reach, st.interactions, st.navigation, st.profileVisits,
				st.follows, st.navForward, st.navBack, st.navExit, st.navNext)
		}
		if _, err := c.Pool.Exec(ctx, sql, args...); err != nil {
			return err
		}
	}
	if err := c.gravarEng(ctx, conta, hoje, 99, deg); err != nil {
		return err
	}
	if conta.ad != "" { // perfil sem ad_account_id não tem anúncios: pula, sem erro
		if err := c.anuncios(ctx, conta, hoje, deg); err != nil {
			return err
		}
	}
	return nil
}

// contarMidias: posts e reels do perfil (não collabs de terceiros, não stories) publicados no período.
func contarMidias(j map[string]any, ig, hoje string, dias int) (posts, reels int) {
	de, ate := menosDias(hoje, dias), ""
	switch dias {
	case 0:
		de, ate = hoje, hoje
	case 1:
		de = menosDias(hoje, 1)
		ate = de
	}
	itens, _ := j["data"].([]any)
	for _, x := range itens {
		m, _ := x.(map[string]any)
		dono := ig
		if o, ok := m["owner"].(map[string]any); ok && o["id"] != nil {
			dono = fmt.Sprint(o["id"])
		}
		produto, _ := m["media_product_type"].(string)
		if dono != ig || produto == "STORY" {
			continue
		}
		if ts, _ := m["timestamp"].(string); ts != "" {
			d := diaDaMeta(ts)
			if d < de || (ate != "" && d > ate) {
				continue
			}
		}
		if produto == "REELS" {
			reels++
		} else {
			posts++
		}
	}
	return
}

type stories struct {
	quantos                                                                  int
	shares, replies, reach, interactions, navigation, profileVisits, follows float64
	navForward, navBack, navExit, navNext                                    float64
}

// storiesDeHoje: soma das métricas dos stories publicados HOJE (São Paulo). Erro numa story não conta;
// erro na lista = zeros (como a edge).
func (c *ColetaDiaria) storiesDeHoje(ctx context.Context, ig, hoje string) stories {
	var s stories
	j, err := GET(ctx, c.Core, "/"+ig+"/stories", map[string]any{"fields": "id,timestamp", "limit": "100"})
	if err != nil {
		return s
	}
	itens, _ := j["data"].([]any)
	for _, x := range itens {
		st, _ := x.(map[string]any)
		ts, _ := st["timestamp"].(string)
		if ts == "" || diaDaMeta(ts) != hoje {
			continue
		}
		s.quantos++
		id := fmt.Sprint(st["id"])
		if ins, err := GET(ctx, c.Core, "/"+id+"/insights", map[string]any{"metric": "reach,replies,shares,total_interactions,navigation,profile_visits,follows"}); err == nil {
			lista, _ := ins["data"].([]any)
			for _, y := range lista {
				it, _ := y.(map[string]any)
				v := it["value"]
				if v == nil {
					if vs, _ := it["values"].([]any); len(vs) > 0 {
						v0, _ := vs[0].(map[string]any)
						v = v0["value"]
					}
				}
				n := numero(v)
				switch it["name"] {
				case "shares":
					s.shares += n
				case "replies":
					s.replies += n
				case "reach":
					s.reach += n
				case "total_interactions":
					s.interactions += n
				case "navigation":
					s.navigation += n
				case "profile_visits":
					s.profileVisits += n
				case "follows":
					s.follows += n
				}
			}
		}
		if nb, err := GET(ctx, c.Core, "/"+id+"/insights", map[string]any{"metric": "navigation", "breakdown": "story_navigation_action_type"}); err == nil {
			for _, y := range resultados(primeiro(nb)) {
				r, _ := y.(map[string]any)
				n := numero(r["value"])
				switch dimensao(r) {
				case "tap_forward":
					s.navForward += n
				case "tap_back":
					s.navBack += n
				case "tap_exit":
					s.navExit += n
				case "swipe_forward":
					s.navNext += n
				}
			}
		}
	}
	return s
}

// brutoDeSeguidores: re-lê "seguiram/deixaram" dos 3 dias recentes e de todo dia dos últimos 14 ainda
// 0/0 (buraco de queda do coletor). Dia fechado há 2+ dias sem número = o Instagram parou de publicar:
// fica gravado (bruto_seguidores_parado) e quem avisa, uma vez por dia, é o auditar-dados.
func (c *ColetaDiaria) brutoDeSeguidores(ctx context.Context, conta contaColeta, hoje string) error {
	linhas, err := c.Pool.Query(ctx, `select captured_at::text, coalesce(gained, 0)::float8, coalesce(lost, 0)::float8 from daily_snapshots
		where account_id = $1::uuid and captured_at >= $2::date and captured_at <= $3::date`, conta.id, menosDias(hoje, 14), hoje)
	if err != nil {
		return err
	}
	type linhaDia struct{ ganho, perda float64 }
	dias := map[string]linhaDia{}
	var d string
	var l linhaDia
	if _, err := pgx.ForEachRow(linhas, []any{&d, &l.ganho, &l.perda}, func() error { dias[d] = l; return nil }); err != nil {
		return err
	}
	var semBruto []string
	for dd := 0; dd < 14; dd++ {
		dia := menosDias(hoje, dd)
		row, tem := dias[dia]
		buraco := tem && row.ganho == 0 && row.perda == 0
		if dd >= 3 && !buraco {
			continue // dia antigo já preenchido (ou sem linha): não re-busca; o que tem número conta como publicado
		}
		ate := inicioDoDia(dia) + 86399 // `${dia}T23:59:59-03:00`
		r, err := GET(ctx, c.Core, "/"+conta.ig+"/insights", map[string]any{"metric": "follows_and_unfollows", "period": "day",
			"metric_type": "total_value", "breakdown": "follow_type", "since": strconv.FormatInt(inicioDoDia(dia), 10), "until": strconv.FormatInt(ate, 10)})
		publicado, seguiu, deixou := false, 0.0, 0.0
		if err == nil {
			publicado, seguiu, deixou = lerBrutoDoDia(r)
		}
		if !publicado {
			if dia <= menosDias(hoje, 2) { // o de hoje e o de ontem ainda podem estar sem número (atraso normal da Meta)
				semBruto = append(semBruto, dia)
			}
			continue
		}
		if _, err := c.Pool.Exec(ctx, `update daily_snapshots set gained = $3::numeric, lost = $4::numeric where account_id = $1::uuid and captured_at = $2::date`,
			conta.id, dia, seguiu, deixou); err != nil {
			return err
		}
	}
	if len(semBruto) == 0 {
		return nil
	}
	desde := semBruto[len(semBruto)-1] // o dia fechado mais antigo (o laço vai de hoje para trás)
	plural := "dias"
	if len(semBruto) == 1 {
		plural = "dia"
	}
	recado := fmt.Sprintf("%s: o Instagram não publica seguiram/deixaram desde %s/%s (%d %s sem número)", conta.nome, desde[8:10], desde[5:7], len(semBruto), plural)
	err = pgx.BeginFunc(ctx, c.Pool, func(tx pgx.Tx) error { // regravável: fica sempre a leitura mais nova do dia
		if _, err := tx.Exec(ctx, `delete from data_integrity_checks where checked_date = $1::date and check_name = 'bruto_seguidores_parado' and account_id = $2::uuid`,
			hoje, conta.id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `insert into data_integrity_checks (checked_date, account_id, status, check_name, detail) values ($1::date, $2::uuid, 'fail', 'bruto_seguidores_parado', $3::text)`,
			hoje, conta.id, texto.CortarUTF16(recado, 900))
		return err
	})
	if err != nil { // é recado: como na edge, não derruba a conta (o resto da coleta vale mais que ele)
		slog.Error("coletar-dados: recado do bruto parado", "conta", conta.nome, "erro", err)
	}
	return nil
}

// ── engajamento (leitura-de-engajamento.js) ─────────────────────────────────────────────────────

type eng map[string]float64

func somaDoDetalhe(l eng) float64 { return l["likes"] + l["comments"] + l["saves"] + l["shares"] }

// leituraParcial: a Meta às vezes manda o detalhamento PELA METADE (curtidas zeradas com o total
// certo). Zero curtidas com 50+ interações não é explicável (piso medido em produção).
func leituraParcial(l eng) bool {
	if l == nil || l["total_interactions"] <= 0 {
		return false
	}
	return somaDoDetalhe(l) == 0 || (l["likes"] == 0 && l["total_interactions"] >= 50)
}

func leituraServe(l eng) bool { return l != nil && l["reach"] > 0 && !leituraParcial(l) }

func rotulo(dias int) string {
	if dias == 99 {
		return "mês"
	}
	return fmt.Sprintf("%dd", dias)
}

// engajamento lê as 9 métricas da conta no período; nil = a Meta não respondeu.
func (c *ColetaDiaria) engajamento(ctx context.Context, ig, hoje string, dias int) eng {
	agora := min(c.agora().Unix(), inicioDoDia(menosDias(hoje, -1))) // a rodada de 23:59 não invade o dia seguinte
	var de, ate int64
	switch dias {
	case 0:
		de, ate = inicioDoDia(hoje), agora
	case 1:
		de, ate = inicioDoDia(menosDias(hoje, 1)), inicioDoDia(hoje)
	case 99:
		de, ate = inicioDoDia(hoje[:7]+"-01"), agora
	default: // últimos N dias COMPLETOS (fecha à meia-noite de São Paulo, = "Últimos N dias" do Business Suite)
		de, ate = inicioDoDia(menosDias(hoje, dias)), inicioDoDia(hoje)
	}
	j, err := GET(ctx, c.Core, "/"+ig+"/insights", map[string]any{
		"metric": "likes,comments,saves,shares,reach,views,total_interactions,accounts_engaged,profile_views", "period": "day",
		"metric_type": "total_value", "since": strconv.FormatInt(de, 10), "until": strconv.FormatInt(ate, 10)})
	if err != nil {
		return nil
	}
	v := eng{}
	itens, _ := j["data"].([]any)
	for _, x := range itens {
		it, _ := x.(map[string]any)
		nome, _ := it["name"].(string)
		tv, _ := it["total_value"].(map[string]any)
		v[nome] = numero(tv["value"])
	}
	return v
}

// gravarEng: grava o período; leitura pela metade não é gravada (vira degradado e fica o último bom).
func (c *ColetaDiaria) gravarEng(ctx context.Context, conta contaColeta, hoje string, dias int, deg *degradados) error {
	if dias == 0 { // "hoje" é reescrito 4x por dia e só cresce: na dúvida, NÃO sobrescreve
		var v eng
		for i := range 4 {
			v = c.engajamento(ctx, conta.ig, hoje, 0)
			if !leituraParcial(v) {
				break
			}
			if i < 3 {
				if err := c.dormir(ctx, time.Duration(300*(i+1))*time.Millisecond); err != nil {
					return err
				}
			}
		}
		if leituraParcial(v) {
			deg.zeradas = append(deg.zeradas, conta.nome+" "+rotulo(0))
			return nil
		}
		return c.upsertEng(ctx, conta.id, hoje, 0, v)
	}
	var ultima eng
	ok := false
	for i := range 5 {
		ultima = c.engajamento(ctx, conta.ig, hoje, dias)
		if leituraServe(ultima) {
			ok = true
			break
		}
		if i < 4 {
			if err := c.dormir(ctx, time.Duration(350*(i+1))*time.Millisecond); err != nil {
				return err
			}
		}
	}
	junto := eng{}
	for k, x := range ultima {
		junto[k] = x
	}
	if ultima == nil {
		junto = nil
	}
	if !ok {
		prev, err := c.ultimoBom(ctx, conta.id, dias)
		if err != nil {
			return err
		}
		switch {
		case prev != nil:
			if junto == nil {
				junto = eng{}
			}
			for _, k := range chavesEng {
				if !(junto[k] > 0) {
					junto[k] = prev[k]
				}
			}
			if dias != 1 { // 1d não alerta: o painel mostra 2D e um dia quieto é normal
				deg.zeradas = append(deg.zeradas, conta.nome+" "+rotulo(dias))
			}
		case junto == nil || !(junto["reach"] > 0) || leituraParcial(junto):
			if dias != 1 {
				deg.zeradas = append(deg.zeradas, conta.nome+" "+rotulo(dias)+" (sem histórico)")
			}
			return nil
		}
	}
	return c.upsertEng(ctx, conta.id, hoje, dias, junto)
}

// ultimoBom: a linha mais recente (das últimas 30 com alcance) que passa no leituraServe; nil se
// nenhuma presta (não ter valor é melhor que copiar um errado para a frente).
func (c *ColetaDiaria) ultimoBom(ctx context.Context, conta string, dias int) (eng, error) {
	linhas, err := c.Pool.Query(ctx, `select coalesce(likes, 0)::float8, coalesce(comments, 0)::float8, coalesce(saves, 0)::float8,
			coalesce(shares, 0)::float8, coalesce(reach, 0)::float8, coalesce(views, 0)::float8, coalesce(total_interactions, 0)::float8,
			coalesce(accounts_engaged, 0)::float8, coalesce(profile_views, 0)::float8
		  from engagement_snapshots where account_id = $1::uuid and period_days = $2::int and reach > 0
		 order by captured_at desc limit 30`, conta, dias)
	if err != nil {
		return nil, err
	}
	defer linhas.Close()
	for linhas.Next() {
		vs := make([]float64, len(chavesEng))
		ptrs := make([]any, len(vs))
		for i := range vs {
			ptrs[i] = &vs[i]
		}
		if err := linhas.Scan(ptrs...); err != nil {
			return nil, err
		}
		l := eng{}
		for i, k := range chavesEng {
			l[k] = vs[i]
		}
		if leituraServe(l) {
			return l, nil
		}
	}
	return nil, linhas.Err()
}

// upsertEng grava só as métricas presentes (engCols da edge); as colunas vêm da lista fixa chavesEng.
func (c *ColetaDiaria) upsertEng(ctx context.Context, conta, hoje string, dias int, v eng) error {
	var cols, vals, sets []string
	args := []any{conta, hoje, dias}
	for _, k := range chavesEng {
		x, ok := v[k]
		if !ok {
			continue
		}
		args = append(args, x)
		cols = append(cols, k)
		vals = append(vals, fmt.Sprintf("$%d::numeric", len(args)))
		sets = append(sets, k+" = excluded."+k)
	}
	if len(cols) == 0 {
		return nil
	}
	_, err := c.Pool.Exec(ctx, `insert into engagement_snapshots (account_id, captured_at, period_days, `+strings.Join(cols, ", ")+`)
		values ($1::uuid, $2::date, $3::int, `+strings.Join(vals, ", ")+`)
		on conflict (account_id, captured_at, period_days) do update set `+strings.Join(sets, ", "), args...)
	return err
}

// avisarSuperAdmin: métricas zeradas/inconsistentes e leituras da Graph que falharam viram UMA linha
// 'coleta_zerada' (e o webhook, se houver), cada família com o texto que diz o que aconteceu. É aviso:
// falhar aqui não derruba a conta.
func (c *ColetaDiaria) avisarSuperAdmin(ctx context.Context, hoje string, deg degradados) {
	var partes []string
	if len(deg.zeradas) > 0 {
		partes = append(partes, "⚠️ Coleta IG: a Meta retornou métricas zeradas/inconsistentes (alcance 0 ou likes/comments/saves/shares zerados com interações>0) mesmo após 5 tentativas em: "+
			strings.Join(deg.zeradas, " · ")+". Mantive o valor mais recente válido (não zerei o painel). Verificar token/permissões da Meta.")
	}
	if len(deg.graph) > 0 {
		partes = append(partes, "⚠️ Coleta IG: falha ao ler a Graph da Meta (a leitura não chegou ou a Meta recusou; não são métricas zeradas) em: "+
			strings.Join(deg.graph, " · ")+". O que já estava gravado foi mantido e as outras leituras seguiram. Verificar o status da Meta e o token/permissões.")
	}
	if len(partes) == 0 {
		return
	}
	msg := strings.Join(partes, "\n")
	if _, err := c.Pool.Exec(ctx, `insert into data_integrity_checks (checked_date, status, check_name, detail) values ($1::date, 'fail', 'coleta_zerada', $2::text)`,
		hoje, texto.CortarUTF16(msg, 900)); err != nil {
		slog.Error("coletar-dados: alerta no banco", "erro", err)
	}
	if err := avisarWebhook(ctx, c.HTTP, c.Alerta, msg); err != nil {
		slog.Error("coletar-dados: webhook de alerta", "erro", err)
	}
}

// avisarWebhook manda {text, content} (Slack e Discord) a ALERT_WEBHOOK_URL. A URL é segredo: o erro
// devolvido nunca a contém.
func avisarWebhook(ctx context.Context, cli *http.Client, alvo, msg string) error {
	if alvo == "" {
		return nil
	}
	corpo, _ := json.Marshal(map[string]string{"text": msg, "content": msg})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, alvo, bytes.NewReader(corpo))
	if err != nil {
		return errors.New("ALERT_WEBHOOK_URL inválida")
	}
	req.Header.Set("Content-Type", "application/json")
	c := &http.Client{Timeout: 15 * time.Second}
	if cli != nil {
		cp := *cli
		c = &cp
	}
	// Nunca segue redirect (como Z-API, RD e Chatwoot): o alerta e a URL, que é segredo, iriam a outro endereço.
	c.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	r, err := c.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		return err
	}
	r.Body.Close()
	if r.StatusCode >= 300 {
		return fmt.Errorf("webhook de alerta respondeu %d", r.StatusCode)
	}
	return nil
}
