package meta

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// falhaDeContas: a rodada devolveu o sinal "alguma conta falhou" (a linha de cada conta já foi gravada).
func falhaDeContas(err error) bool {
	var fi *worker.FalhaDeItens
	return errors.As(err, &fi)
}

// meiaNoiteSP: 00:00 em São Paulo (UTC-3, sem horário de verão) em segundos, escrita à mão no teste.
func meiaNoiteSP(ano int, mes time.Month, dia int) int64 {
	return time.Date(ano, mes, dia, 3, 0, 0, 0, time.UTC).Unix()
}

// ajusteColeta muda o que a Graph de mentira (graphDaColeta) responde sobre a conta 1784 (Vessel) e
// segura caminhos até o teste soltá-los (conta lenta).
type ajusteColeta struct {
	mu            sync.Mutex
	seguidores    int    // 0 = o padrão do fake
	likes         int    // curtidas de todas as janelas de engajamento; 0 = o padrão
	vesselParcial bool   // a Meta manda a Vessel pela metade (curtidas 0 com 556 interações)
	brutoSempre   bool   // seguiram/deixaram: todo dia vem publicado (14 e 3)
	midias        string // corpo de /1784/media; "" = o padrão
	stories       string // corpo de /1784/stories; "" = o padrão
	campanhas     bool   // /act_999/campaigns devolve uma campanha
	segura        map[string]chan struct{}
}

func (a *ajusteColeta) resp(p core.PedidoMeta) (int, string, map[string]string) {
	a.mu.Lock()
	seg, likes, parcial, bruto, midias, stories, camp := a.seguidores, a.likes, a.vesselParcial, a.brutoSempre, a.midias, a.stories, a.campanhas
	ch := a.segura[p.Caminho]
	a.mu.Unlock()
	m := func(k string) string { s, _ := p.Parametros[k].(string); return s }
	if ch != nil {
		select {
		case <-ch:
		case <-time.After(5 * time.Second):
		}
		return 500, `{"error":{"message":"solto tarde"}}`, nil
	}
	switch {
	case p.Caminho == "/1784" && m("fields") == "followers_count" && seg != 0:
		return 200, fmt.Sprintf(`{"followers_count":%d}`, seg), nil
	case p.Caminho == "/1784/insights" && strings.HasPrefix(m("metric"), "likes,comments") && parcial:
		return 200, `{"data":[{"name":"likes","total_value":{"value":0}},{"name":"comments","total_value":{"value":34}},{"name":"reach","total_value":{"value":900}},{"name":"total_interactions","total_value":{"value":556}}]}`, nil
	case p.Caminho == "/1784/insights" && strings.HasPrefix(m("metric"), "likes,comments") && likes != 0:
		return 200, fmt.Sprintf(`{"data":[{"name":"likes","total_value":{"value":%d}},{"name":"comments","total_value":{"value":10}},{"name":"saves","total_value":{"value":5}},
			{"name":"shares","total_value":{"value":3}},{"name":"reach","total_value":{"value":1000}},{"name":"views","total_value":{"value":2000}},
			{"name":"total_interactions","total_value":{"value":118}},{"name":"accounts_engaged","total_value":{"value":50}},{"name":"profile_views","total_value":{"value":20}}]}`, likes), nil
	case bruto && m("metric") == "follows_and_unfollows":
		return 200, `{"data":[{"total_value":{"breakdowns":[{"results":[{"dimension_values":["FOLLOWER"],"value":14},{"dimension_values":["NON_FOLLOWER"],"value":3}]}]}}]}`, nil
	case p.Caminho == "/1784/media" && midias != "":
		return 200, midias, nil
	case p.Caminho == "/1784/stories" && stories != "":
		return 200, stories, nil
	case camp && p.Caminho == "/act_999/campaigns":
		return 200, `{"data":[{"id":"c1","name":"Campanha","objective":"x","status":"ACTIVE"}]}`, nil
	}
	return graphDaColeta(p)
}

// libera solta o caminho segurado; o teste chama antes de o servidor fechar.
func (a *ajusteColeta) seguraAte(t *testing.T, caminho string) {
	t.Helper()
	ch := make(chan struct{})
	a.mu.Lock()
	if a.segura == nil {
		a.segura = map[string]chan struct{}{}
	}
	a.segura[caminho] = ch
	a.mu.Unlock()
	t.Cleanup(func() { close(ch) }) // registrado depois do Close do servidor: roda antes dele
}

func ambienteComAjuste(t *testing.T, a *ajusteColeta, agora time.Time) (*ColetaDiaria, *coreMeta, *pgxpool.Pool, *worker.Agendador) {
	t.Helper()
	c, f, p, ag := ambienteColeta(t)
	f.resp = a.resp
	c.Agora = func() time.Time { return agora }
	return c, f, p, ag
}

// janelasDe: "since-until" de cada leitura de engajamento (as 9 métricas) da conta, em ordem.
func janelasDe(f *coreMeta, caminho string) []string {
	var out []string
	for _, pd := range f.lista() {
		if m, _ := pd.Parametros["metric"].(string); pd.Caminho == caminho && strings.HasPrefix(m, "likes,comments") {
			out = append(out, pd.Parametros["since"].(string)+"-"+pd.Parametros["until"].(string))
		}
	}
	slices.Sort(out)
	return out
}

func jan(since, until int64) string {
	return strconv.FormatInt(since, 10) + "-" + strconv.FormatInt(until, 10)
}

func TestColetaDiariaJanelasDeEngajamento(t *testing.T) {
	c, f, _, _ := ambienteComAjuste(t, &ajusteColeta{}, agoraColeta)
	if err := c.Rodada(context.Background(), "07h"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	hoje, agora := meiaNoiteSP(2026, 10, 10), agoraColeta.Unix()
	quer := []string{
		jan(hoje, agora),                     // 0d: de hoje 00:00 até agora
		jan(hoje-1*86400, hoje),              // 1d: ontem inteiro (até hoje 00:00)
		jan(hoje-7*86400, hoje),              // 7d: últimos 7 dias COMPLETOS
		jan(hoje-14*86400, hoje),             // 14d
		jan(hoje-30*86400, hoje),             // 30d
		jan(meiaNoiteSP(2026, 10, 1), agora), // mês: do dia 1 de outubro até agora
	}
	slices.Sort(quer)
	if got := janelasDe(f, "/1784/insights"); !slices.Equal(got, quer) {
		t.Fatalf("janelas de engajamento\n got %v\nquer %v", got, quer)
	}
}

// 23:59 em São Paulo já é o dia seguinte em UTC (02:59Z): o dia de coleta, o mês, as stories e os posts
// têm de seguir o calendário de São Paulo.
func TestColetaDiaria2359NaViradaDeSaoPauloNaoUsaOFusoUTC(t *testing.T) {
	agora := time.Date(2026, 11, 1, 2, 59, 0, 0, time.UTC) // 31/10 às 23:59 em São Paulo
	aj := &ajusteColeta{
		stories: `{"data":[{"id":"601","timestamp":"2026-11-01T02:10:00+0000"},{"id":"602","timestamp":"2026-10-31T02:30:00+0000"},{"id":"603","timestamp":"2026-11-01T02:50:00+0000"}]}`,
		midias: `{"data":[{"id":"a","media_product_type":"FEED","timestamp":"2026-11-01T02:20:00+0000","owner":{"id":"1784"}},
			{"id":"b","media_product_type":"FEED","timestamp":"2026-10-31T02:20:00+0000","owner":{"id":"1784"}}]}`,
	}
	c, f, p, _ := ambienteComAjuste(t, aj, agora)
	ctx := context.Background()
	if err := c.Rodada(ctx, "2359"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	var dias string
	p.QueryRow(ctx, `select string_agg(distinct captured_at::text, ',') from daily_snapshots where account_id = $1::uuid`, contaA1).Scan(&dias)
	if dias != "2026-10-31" {
		t.Fatalf("o dia da coleta é o de São Paulo (31/10), não o do UTC: %q", dias)
	}
	var stories, posts0, posts1 int
	p.QueryRow(ctx, `select stories_count from content_snapshots where account_id = $1::uuid and period_days = 0 and captured_at = '2026-10-31'`, contaA1).Scan(&stories)
	p.QueryRow(ctx, `select posts_count from content_snapshots where account_id = $1::uuid and period_days = 0 and captured_at = '2026-10-31'`, contaA1).Scan(&posts0)
	p.QueryRow(ctx, `select posts_count from content_snapshots where account_id = $1::uuid and period_days = 1 and captured_at = '2026-10-31'`, contaA1).Scan(&posts1)
	// stories 601 e 603 são de 31/10 em São Paulo (23:10 e 23:50); a 602 é de 30/10 (23:30)
	if stories != 2 || posts0 != 1 || posts1 != 1 {
		t.Fatalf("stories=%d (queria 2) posts 0d=%d 1d=%d (queria 1 e 1)", stories, posts0, posts1)
	}
	mes := jan(meiaNoiteSP(2026, 10, 1), agora.Unix()) // o mês é outubro, não novembro
	if got := janelasDe(f, "/1784/insights"); !slices.Contains(got, mes) {
		t.Fatalf("janela do mês %s ausente: %v", mes, got)
	}
}

// Uma rodada de muitas contas passa da meia-noite: o dia é o do COMEÇO da rodada para todas, e a janela de
// "hoje" não invade o dia seguinte.
func TestColetaDiariaRodadaQueAtravessaAMeiaNoiteFicaNoDiaDoComeco(t *testing.T) {
	c, f, p, _ := ambienteColeta(t)
	inicio := time.Date(2026, 11, 1, 2, 59, 0, 0, time.UTC) // 31/10 23:59 em São Paulo
	n := 0
	c.Agora = func() time.Time {
		n++
		if n == 1 { // a primeira leitura do relógio é o dia da rodada
			return inicio
		}
		return inicio.Add(11 * time.Minute) // 00:10 de 01/11: as contas seguintes já passaram da meia-noite
	}
	ctx := context.Background()
	if err := c.Rodada(ctx, "2359"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	var fora int
	p.QueryRow(ctx, `select (select count(*) from daily_snapshots where captured_at <> '2026-10-31') +
		(select count(*) from engagement_snapshots where captured_at <> '2026-10-31') +
		(select count(*) from content_snapshots where captured_at <> '2026-10-31')`).Scan(&fora)
	if fora != 0 {
		t.Fatalf("%d linhas fora do dia 31/10", fora)
	}
	meia := meiaNoiteSP(2026, 11, 1)
	got := janelasDe(f, "/1784/insights")
	for _, w := range []string{jan(meiaNoiteSP(2026, 10, 31), meia), jan(meiaNoiteSP(2026, 10, 1), meia)} {
		if !slices.Contains(got, w) {
			t.Errorf("janela %s ausente (a de hoje e a do mês fecham à meia-noite): %v", w, got)
		}
	}
	for _, w := range got {
		_, ate, _ := strings.Cut(w, "-")
		if u, _ := strconv.ParseInt(ate, 10, 64); u > meia {
			t.Errorf("janela %s invade o dia seguinte", w)
		}
	}
}

func TestColetaDiariaRodarDuasVezesAtualizaOQueJaEstaNoBanco(t *testing.T) {
	aj := &ajusteColeta{seguidores: 24345, likes: 100,
		midias: `{"data":[{"id":"1","media_product_type":"FEED","timestamp":"2026-10-10T11:00:00+0000","owner":{"id":"1784"}}]}`}
	c, _, p, _ := ambienteComAjuste(t, aj, agoraColeta)
	ctx := context.Background()
	if err := c.Rodada(ctx, "07h"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	aj.mu.Lock()
	aj.seguidores, aj.likes = 24400, 150
	aj.midias = `{"data":[{"id":"1","media_product_type":"FEED","timestamp":"2026-10-10T11:00:00+0000","owner":{"id":"1784"}},
		{"id":"2","media_product_type":"REELS","timestamp":"2026-10-10T11:30:00+0000","owner":{"id":"1784"}},
		{"id":"3","media_product_type":"FEED","timestamp":"2026-10-10T11:40:00+0000","owner":{"id":"1784"}}]}`
	aj.mu.Unlock()
	if err := c.Rodada(ctx, "12h"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	var diarias, leituras, eng, cont, seguidores, likes0, likes99, posts0, reels0, posts7, reels7 int
	p.QueryRow(ctx, `select count(*) from daily_snapshots where account_id = $1::uuid`, contaA1).Scan(&diarias)
	p.QueryRow(ctx, `select count(*) from followers_leituras where account_id = $1::uuid`, contaA1).Scan(&leituras)
	p.QueryRow(ctx, `select count(*) from engagement_snapshots where account_id = $1::uuid`, contaA1).Scan(&eng)
	p.QueryRow(ctx, `select count(*) from content_snapshots where account_id = $1::uuid`, contaA1).Scan(&cont)
	p.QueryRow(ctx, `select followers_count from daily_snapshots where account_id = $1::uuid`, contaA1).Scan(&seguidores)
	p.QueryRow(ctx, `select likes from engagement_snapshots where account_id = $1::uuid and period_days = 0`, contaA1).Scan(&likes0)
	p.QueryRow(ctx, `select likes from engagement_snapshots where account_id = $1::uuid and period_days = 99`, contaA1).Scan(&likes99)
	p.QueryRow(ctx, `select posts_count, reels_count from content_snapshots where account_id = $1::uuid and period_days = 0`, contaA1).Scan(&posts0, &reels0)
	p.QueryRow(ctx, `select posts_count, reels_count from content_snapshots where account_id = $1::uuid and period_days = 7`, contaA1).Scan(&posts7, &reels7)
	if posts7 != 2 || reels7 != 1 {
		t.Fatalf("content_snapshots dos períodos de 7 dias em diante também atualiza: posts7=%d reels7=%d", posts7, reels7)
	}
	if diarias != 1 || eng != 6 || cont != 5 {
		t.Fatalf("a 2ª rodada atualiza, não duplica: daily=%d eng=%d content=%d", diarias, eng, cont)
	}
	if leituras != 2 {
		t.Fatalf("followers_leituras é append-only (uma por rodada): %d", leituras)
	}
	if seguidores != 24400 || likes0 != 150 || likes99 != 150 || posts0 != 2 || reels0 != 1 {
		t.Fatalf("valores da 2ª rodada: seguidores=%d likes0=%d likes99=%d posts0=%d reels0=%d", seguidores, likes0, likes99, posts0, reels0)
	}
}

func TestColetaDiariaBrutoDeSeguidoresSoReleOsDiasCertos(t *testing.T) {
	c, f, p, _ := ambienteComAjuste(t, &ajusteColeta{brutoSempre: true}, agoraColeta)
	ctx := context.Background()
	for _, l := range [][3]any{
		{"2026-10-09", 5, 1}, {"2026-10-08", 0, 0}, // dd 1 e 2: sempre relidos, com número ou sem
		{"2026-10-07", 5, 1}, {"2026-10-06", 5, 1}, // dd 3 e 4 já preenchidos: não relê
		{"2026-10-05", 0, 0},                       // dd 5 buraco: relê
		{"2026-09-28", 5, 1},                       // dd 12 preenchido
		{"2026-09-27", 0, 0},                       // dd 13: último dia da janela, buraco: relê
		{"2026-09-26", 0, 0}, {"2026-09-25", 0, 0}, // dd 14 e 15: fora da janela, buraco que NÃO se preenche
	} {
		if _, err := p.Exec(ctx, `insert into daily_snapshots values ($1::uuid, $2::date, 1000, $3::int, $4::int)`, contaA1, l[0], l[1], l[2]); err != nil {
			t.Fatal(err)
		}
	}
	if err := c.Rodada(ctx, "07h"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	var relidos []string
	for _, pd := range f.lista() {
		if pd.Caminho != "/1784/insights" || pd.Parametros["metric"] != "follows_and_unfollows" {
			continue
		}
		since, _ := strconv.ParseInt(pd.Parametros["since"].(string), 10, 64)
		until, _ := strconv.ParseInt(pd.Parametros["until"].(string), 10, 64)
		if until != since+86399 || (since-3*3600)%86400 != 0 { // o dia inteiro, de 00:00 a 23:59:59 em São Paulo
			t.Errorf("janela do dia fora do dia de São Paulo: %d-%d", since, until)
		}
		relidos = append(relidos, time.Unix(since, 0).In(saoPaulo).Format("2006-01-02"))
	}
	slices.Sort(relidos)
	quer := []string{"2026-09-27", "2026-10-05", "2026-10-08", "2026-10-09", "2026-10-10"}
	if !slices.Equal(relidos, quer) {
		t.Fatalf("dias relidos\n got %v\nquer %v", relidos, quer)
	}
	var estado string
	p.QueryRow(ctx, `select string_agg(captured_at::text || '=' || gained || '/' || lost, ' ' order by captured_at) from daily_snapshots where account_id = $1::uuid`, contaA1).Scan(&estado)
	if quer := "2026-09-25=0/0 2026-09-26=0/0 2026-09-27=14/3 2026-09-28=5/1 2026-10-05=14/3 2026-10-06=5/1 2026-10-07=5/1 2026-10-08=14/3 2026-10-09=14/3 2026-10-10=14/3"; estado != quer {
		t.Fatalf("daily_snapshots\n got %s\nquer %s", estado, quer)
	}
	var recados int
	p.QueryRow(ctx, `select count(*) from data_integrity_checks where check_name = 'bruto_seguidores_parado'`).Scan(&recados)
	if recados != 0 {
		t.Fatalf("todo dia veio publicado: sem recado (%d)", recados)
	}
}

func TestColetaDiariaUmaLeituraDeMediaServeOsCincoPeriodos(t *testing.T) {
	// 2026-10-10 07:00 em São Paulo. Cada item cai em cima de uma fronteira de período.
	aj := &ajusteColeta{midias: `{"data":[
		{"id":"m1","media_product_type":"FEED","timestamp":"2026-10-10T03:00:00+0000","owner":{"id":"1784"}},
		{"id":"m2","media_product_type":"FEED","timestamp":"2026-10-10T02:59:59+0000","owner":{"id":"1784"}},
		{"id":"m3","media_product_type":"REELS","timestamp":"2026-10-09T03:00:00+0000","owner":{"id":"1784"}},
		{"id":"m4","media_product_type":"FEED","timestamp":"2026-10-08T20:00:00+0000","owner":{"id":"1784"}},
		{"id":"m5","media_product_type":"FEED","timestamp":"2026-10-03T03:00:00+0000","owner":{"id":"1784"}},
		{"id":"m6","media_product_type":"FEED","timestamp":"2026-10-03T02:59:59+0000","owner":{"id":"1784"}},
		{"id":"m7","media_product_type":"FEED","timestamp":"2026-09-26T03:00:00+0000","owner":{"id":"1784"}},
		{"id":"m8","media_product_type":"FEED","timestamp":"2026-09-26T02:59:59+0000","owner":{"id":"1784"}},
		{"id":"m9","media_product_type":"FEED","timestamp":"2026-09-10T03:00:00+0000","owner":{"id":"1784"}},
		{"id":"m10","media_product_type":"FEED","timestamp":"2026-09-10T02:59:59+0000","owner":{"id":"1784"}},
		{"id":"m11","media_product_type":"FEED","timestamp":"2026-10-10T11:00:00+0000","owner":{"id":"999"}},
		{"id":"m12","media_product_type":"STORY","timestamp":"2026-10-10T11:00:00+0000","owner":{"id":"1784"}},
		{"id":"m13","media_product_type":"FEED","timestamp":"2026-10-10T11:00:00+0000"},
		{"id":"m14","media_product_type":"FEED"}]}`}
	c, f, p, _ := ambienteComAjuste(t, aj, agoraColeta)
	ctx := context.Background()
	if err := c.Rodada(ctx, "07h"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	leituras := 0
	for _, pd := range f.lista() {
		if pd.Caminho == "/1784/media" {
			leituras++
		}
	}
	if leituras != 1 {
		t.Fatalf("/media lido %d vezes; uma leitura serve os 5 períodos", leituras)
	}
	var got string
	p.QueryRow(ctx, `select string_agg(period_days || ':' || posts_count || '/' || reels_count, ' ' order by period_days) from content_snapshots where account_id = $1::uuid`, contaA1).Scan(&got)
	// 0d: m1, m13, m14 (sem data conta em todos). 1d (09/10): m2, m3 (reels), m14. 7d (>= 03/10): m1 m2 m4 m5 m13 m14 + m3.
	// 14d (>= 26/09): + m6 m7. 30d (>= 10/09): + m8 m9. m10, m11 (de outro dono) e m12 (story) ficam de fora.
	if quer := "0:3/0 1:2/1 7:6/1 14:8/1 30:10/1"; got != quer {
		t.Fatalf("posts/reels por período\n got %s\nquer %s", got, quer)
	}
}

func TestColetaDiariaPrazoPorContaCortaSoAContaLenta(t *testing.T) {
	if (&ColetaDiaria{}).prazoConta() != 6*time.Minute {
		t.Fatalf("o prazo por conta é de 6 min: %v", (&ColetaDiaria{}).prazoConta())
	}
	aj := &ajusteColeta{}
	c, _, p, _ := ambienteComAjuste(t, aj, agoraColeta)
	aj.seguraAte(t, "/1786") // Breno (1ª na ordem de nome) trava; Mantova e Vessel vêm depois
	c.PrazoConta = 200 * time.Millisecond
	ctx := context.Background()
	err := c.Rodada(ctx, "07h")
	var fi *worker.FalhaDeItens
	if !errors.As(err, &fi) || fi.Quantos != 2 || fi.Resumo != "Breno, Mantova Móveis" {
		t.Fatalf("duas contas falharam (Breno cortada, Mantova com 500): %v", err)
	}
	var resp string
	p.QueryRow(ctx, `select resposta from robos_execucoes where robo = 'coletar-dados-07h · Breno' and not ok`).Scan(&resp)
	if !strings.Contains(resp, "context deadline exceeded") {
		t.Fatalf("a conta lenta foi cortada pelo prazo: %q", resp)
	}
	var vessel bool
	p.QueryRow(ctx, `select ok from robos_execucoes where robo = 'coletar-dados-07h · Vessel'`).Scan(&vessel)
	var seguidores int
	p.QueryRow(ctx, `select followers_count from daily_snapshots where account_id = $1::uuid`, contaA1).Scan(&seguidores)
	if !vessel || seguidores != 24345 {
		t.Fatalf("a conta seguinte ainda roda: ok=%v seguidores=%d", vessel, seguidores)
	}
}

func TestColetaDiariaLimiteDaRodadaParaEAvisaQuemFaltou(t *testing.T) {
	for _, tf := range (&ColetaDiaria{}).Tarefas() {
		if tf.Limite != 50*time.Minute || tf.Trava != "coletar-dados" || !tf.RegistroProprio {
			t.Errorf("%s: limite=%v trava=%q registro próprio=%v (50 min por rodada)", tf.Nome, tf.Limite, tf.Trava, tf.RegistroProprio)
		}
	}
	aj := &ajusteColeta{}
	c, _, p, ag := ambienteComAjuste(t, aj, agoraColeta)
	aj.seguraAte(t, "/1786") // Breno trava e o limite da rodada vence nela
	tf := c.Tarefas()[0]
	tf.Limite = 300 * time.Millisecond
	ctx := context.Background()
	executou, err := ag.Rodar(ctx, tf)
	if !executou || err == nil || falhaDeContas(err) || !strings.Contains(err.Error(), "limite de tempo da rodada: 2 de 3 conta(s) sem coletar") {
		t.Fatalf("estourar o limite é erro da tarefa (com linha agregada): executou=%v err=%v", executou, err)
	}
	var agregada int
	p.QueryRow(ctx, `select count(*) from robos_execucoes where robo = 'coletar-dados-07h' and not ok`).Scan(&agregada)
	var contas int
	p.QueryRow(ctx, `select count(*) from robos_execucoes where robo like 'coletar-dados-07h · %'`).Scan(&contas)
	if agregada != 1 || contas != 1 {
		t.Fatalf("linha agregada=%d, linhas de conta=%d (só a Breno foi cortada; as outras não rodaram)", agregada, contas)
	}
}

// O limite vence justo quando a ÚLTIMA conta termina: todas foram gravadas, então não há o que avisar.
func TestColetaDiariaLimiteQueVenceNaUltimaContaNaoEErro(t *testing.T) {
	c, _, p, _ := ambienteColeta(t)
	ctx := context.Background()
	p.Exec(ctx, `delete from accounts where id = 'aaaaaaaa-0000-0000-0000-0000000000a2'`) // sem a Mantova (500): só contas boas
	ctxRodada, vence := context.WithCancel(ctx)
	defer vence()
	gravar := c.Gravar
	c.Gravar = func(ctx context.Context, robo string, inicio time.Time, erro error) error {
		err := gravar(ctx, robo, inicio, erro)
		if strings.HasSuffix(robo, "· Vessel") { // a última na ordem de nome
			vence()
		}
		return err
	}
	if err := c.Rodada(ctxRodada, "07h"); err != nil {
		t.Fatalf("todas as contas foram gravadas: %v", err)
	}
	var n int
	p.QueryRow(ctx, `select count(*) from robos_execucoes where ok`).Scan(&n)
	if n != 2 {
		t.Fatalf("linhas ok = %d", n)
	}
}

func TestColetaDiariaAvisoDeZeradasSaiUmaVezNoFimMesmoComContaQueFalhou(t *testing.T) {
	aj := &ajusteColeta{vesselParcial: true, campanhas: true}
	c, _, p, _ := ambienteComAjuste(t, aj, agoraColeta)
	ctx := context.Background()
	// A Breno (leitura pela metade) tem anúncios e a tabela de campanhas não existe: a conta falha DEPOIS
	// de ter acumulado degradados. A Vessel também vem pela metade. O aviso é um só, no fim da rodada.
	p.Exec(ctx, `update accounts set ad_account_id = '999' where id = $1::uuid`, contaA3)
	log := capturarLog(t)
	err := c.Rodada(ctx, "07h")
	if !falhaDeContas(err) {
		t.Fatalf("Mantova e Breno falharam: %v", err)
	}
	var n int
	var detalhe, status, dia string
	p.QueryRow(ctx, `select count(*) from data_integrity_checks where check_name = 'coleta_zerada'`).Scan(&n)
	p.QueryRow(ctx, `select detail, status, checked_date::text from data_integrity_checks where check_name = 'coleta_zerada'`).Scan(&detalhe, &status, &dia)
	if n != 1 || status != "fail" || dia != "2026-10-10" ||
		!strings.Contains(detalhe, "Breno 0d") || !strings.Contains(detalhe, "Vessel 0d") || !strings.Contains(detalhe, "Vessel mês (sem histórico)") {
		t.Fatalf("um aviso com as duas contas: n=%d status=%s dia=%s detalhe=%q", n, status, dia, detalhe)
	}
	var ok bool
	p.QueryRow(ctx, `select ok from robos_execucoes where robo = 'coletar-dados-07h · Breno'`).Scan(&ok)
	if ok || !strings.Contains(log.String(), `conta=Breno`) {
		t.Fatalf("a Breno terminou com erro (linha ok=false e slog.Error): ok=%v log=%s", ok, log)
	}
}

// Falhar ao gravar o recado do "bruto parado" só vai para o log (na edge o erro era engolido): a conta
// termina o que estava fazendo e fica ok.
func TestColetaDiariaErroNoRecadoDoBrutoNaoAbortaAConta(t *testing.T) {
	c, _, p, _ := ambienteColeta(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `alter table data_integrity_checks add constraint sem_recado_de_bruto check (check_name <> 'bruto_seguidores_parado')`); err != nil {
		t.Fatal(err)
	}
	log := capturarLog(t)
	if err := c.Rodada(ctx, "07h"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	var ok bool
	var eng, cont int
	p.QueryRow(ctx, `select ok from robos_execucoes where robo = 'coletar-dados-07h · Vessel'`).Scan(&ok)
	p.QueryRow(ctx, `select count(*) from engagement_snapshots where account_id = $1::uuid`, contaA1).Scan(&eng)
	p.QueryRow(ctx, `select count(*) from content_snapshots where account_id = $1::uuid`, contaA1).Scan(&cont)
	if !ok || eng != 6 || cont != 5 || !strings.Contains(log.String(), "recado do bruto parado") {
		t.Fatalf("a conta segue: ok=%v eng=%d content=%d; log=%s", ok, eng, cont, log)
	}
}

func TestColetaDiariaAsContasVaoEmOrdemDeNomeEOsRecadosSaoFail(t *testing.T) {
	c, _, p, _ := ambienteColeta(t)
	ctx := context.Background()
	if err := c.Rodada(ctx, "18h"); err != nil && !falhaDeContas(err) {
		t.Fatal(err)
	}
	linhas, _ := p.Query(ctx, `select robo from robos_execucoes order by id`)
	var ordem []string
	for linhas.Next() {
		var r string
		linhas.Scan(&r)
		ordem = append(ordem, r)
	}
	if quer := "coletar-dados-18h · Breno|coletar-dados-18h · Mantova Móveis|coletar-dados-18h · Vessel"; strings.Join(ordem, "|") != quer {
		t.Fatalf("ordem de gravação = %v (por nome, não por id)", ordem)
	}
	var n int
	p.QueryRow(ctx, `select count(*) from data_integrity_checks where check_name in ('bruto_seguidores_parado', 'coleta_zerada') and status = 'fail'`).Scan(&n)
	var todos int
	p.QueryRow(ctx, `select count(*) from data_integrity_checks`).Scan(&todos)
	if n != 2 || todos != 2 {
		t.Fatalf("os dois recados do coletor são fail: %d de %d", n, todos)
	}
}
