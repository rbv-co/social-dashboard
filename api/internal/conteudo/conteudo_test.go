package conteudo

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/webpush/pushteste"
)

// Tabelas da Central de Conteúdo como em produção (migrations 2026-07-29-conteudo-01, 2026-07-31-conteudo-07,
// 2026-08-01-conteudo-16) e a função de reivindicação como está em pg_proc (levantamento 02-funções.csv).
const tabelasConteudo = `
create table accounts (id uuid primary key, name text, instagram_id text, access_token text);
create table conteudo_pecas (id uuid primary key default gen_random_uuid(), account_id uuid not null references accounts(id),
  titulo text not null, formato text not null, status text not null default 'rascunho', legenda text not null default '',
  hashtags text not null default '', publicar_em timestamptz, publicado_em timestamptz, avisado_em timestamptz,
  ig_media_id text, ig_permalink text, responsavel uuid);
create table conteudo_eventos (id bigserial primary key, peca_id uuid not null references conteudo_pecas(id), de text, para text,
  acao text not null, detalhe text, quem uuid, quando timestamptz not null default now());
create table conteudo_casamentos (id uuid primary key default gen_random_uuid(), peca_id uuid not null references conteudo_pecas(id),
  ig_media_id text not null, ig_permalink text, ig_timestamp timestamptz, ig_caption text, ig_thumb text, pontuacao numeric not null,
  motivo text, situacao text not null default 'sugerido', unique (peca_id, ig_media_id));
create table conteudo_metricas (peca_id uuid not null references conteudo_pecas(id), capturado_em date not null, curtidas int,
  comentarios int, alcance int, salvamentos int, compartilhamentos int, visualizacoes int, bruto jsonb, primary key (peca_id, capturado_em));
create function conteudo_reivindicar_hora_h() returns setof conteudo_pecas language sql as $$
  update conteudo_pecas set avisado_em = now() where status = 'agendada' and avisado_em is null and publicar_em <= now() returning * $$;
insert into accounts values ('aaaaaaaa-0000-0000-0000-000000000001', 'Vessel', '1784', null);`

const contaVessel = "aaaaaaaa-0000-0000-0000-000000000001"

func bancoConteudo(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelasConteudo+pushteste.Tabelas); err != nil {
		t.Fatal(err)
	}
	return p
}

func peca(t *testing.T, p *pgxpool.Pool, titulo, formato, status string, publicarEm time.Time, responsavel string) string {
	t.Helper()
	var id string
	if err := p.QueryRow(context.Background(), `insert into conteudo_pecas (account_id, titulo, formato, status, legenda, publicar_em, responsavel)
		values ($1::uuid, $2, $3, $4, $2, $5, nullif($6::text, '')::uuid) returning id::text`, contaVessel, titulo, formato, status, publicarEm, responsavel).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func eventos(t *testing.T, p *pgxpool.Pool, id string) []string {
	t.Helper()
	linhas, _ := p.Query(context.Background(), `select acao || ': ' || coalesce(detalhe, '') from conteudo_eventos where peca_id = $1::uuid order by id`, id)
	defer linhas.Close()
	var out []string
	for linhas.Next() {
		var s string
		linhas.Scan(&s)
		out = append(out, s)
	}
	return out
}

const (
	uConteudo = "cccccccc-0000-0000-0000-0000000000c1"
	uOutro    = "cccccccc-0000-0000-0000-0000000000c2"
	uSemAcess = "cccccccc-0000-0000-0000-0000000000c3"
)

func TestHoraHAvisaUmaVezSoEQuemPode(t *testing.T) {
	p := bancoConteudo(t)
	ctx := context.Background()
	p.Exec(ctx, `insert into profiles (id, email, role, features) values
		('`+uConteudo+`', 'c@x', 'viewer', '{conteudo}'), ('`+uOutro+`', 'o@x', 'admin', '{}'), ('`+uSemAcess+`', 's@x', 'viewer', '{banco}')`)
	srv := pushteste.Novo(t)
	ua := pushteste.Inscrever(t, p, "conteudo", uConteudo)
	pushteste.Inscrever(t, p, "outro", uOutro)
	pushteste.Inscrever(t, p, "sem-acesso", uSemAcess)
	p.Exec(ctx, `insert into push_preferencias (user_id, tipo, ativo) values ('`+uConteudo+`', 'conteudo', true), ('`+uOutro+`', 'conteudo', true), ('`+uSemAcess+`', 'conteudo', true)`)
	agora := time.Now()
	naHora := peca(t, p, " Bolsa nova ", "carrossel", "agendada", agora.Add(-time.Minute), "")
	velha := peca(t, p, "Velha", "feed", "agendada", agora.Add(-13*time.Hour), "")
	doDono := peca(t, p, "Do dono", "reels", "agendada", agora.Add(-2*time.Minute), uConteudo)
	futura := peca(t, p, "Futura", "feed", "agendada", agora.Add(time.Hour), "")
	h := &HoraH{Pool: p, VAPID: pushteste.VAPID(t), HTTP: srv.HTTP}
	if err := h.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	if srv.Recebidos("conteudo") != 2 || srv.Recebidos("outro") != 1 || srv.Recebidos("sem-acesso") != 0 {
		t.Fatalf("conteudo=%d outro=%d sem-acesso=%d", srv.Recebidos("conteudo"), srv.Recebidos("outro"), srv.Recebidos("sem-acesso"))
	}
	var aviso map[string]string
	json.Unmarshal(pushteste.Decifrar(t, srv.Ultimo(t, "conteudo"), ua), &aviso)
	if !strings.HasPrefix(aviso["title"], "Hora de publicar: ") || !strings.HasPrefix(aviso["tag"], "conteudo-") {
		t.Fatalf("aviso = %v", aviso)
	}
	if ev := eventos(t, p, naHora); len(ev) != 1 || ev[0] != "avisou: Aviso enviado para 2 aparelho(s)." {
		t.Fatalf("na hora: %v", ev)
	}
	if ev := eventos(t, p, velha); len(ev) != 1 || !strings.Contains(ev[0], "Passou mais de 12 horas") {
		t.Fatalf("velha: %v", ev)
	}
	if ev := eventos(t, p, doDono); len(ev) != 1 || ev[0] != "avisou: Aviso enviado para 1 aparelho(s)." {
		t.Fatalf("com responsável, só ele: %v", ev)
	}
	if ev := eventos(t, p, futura); len(ev) != 0 {
		t.Fatalf("futura não é reivindicada: %v", ev)
	}
	total := srv.Total()
	if err := h.Rodar(ctx); err != nil || srv.Total() != total {
		t.Fatalf("rodar de novo não avisa de novo: err=%v total %d -> %d", err, total, srv.Total())
	}
}

func TestAvisoDePecaComoAEdge(t *testing.T) {
	var a map[string]string
	json.Unmarshal(avisoDePeca(pecaDaHora{id: "p1", titulo: "  ", formato: "x", conta: " Vessel "}), &a)
	if a["title"] != "Hora de publicar: Peça sem título" || a["body"] != "Publicação · Vessel · legenda pronta para copiar" ||
		a["tag"] != "conteudo-p1" || a["url"] != "/conteudo/peca/p1" {
		t.Fatalf("%v", a)
	}
	json.Unmarshal(avisoDePeca(pecaDaHora{id: "p2", titulo: "Look", formato: "stories"}), &a)
	if a["body"] != "Story · legenda pronta para copiar" {
		t.Fatalf("%v", a)
	}
}

func TestHoraHResponsavelDesligadoFicaNaTrilhaEVAPIDRuimNaoReivindica(t *testing.T) {
	p := bancoConteudo(t)
	ctx := context.Background()
	p.Exec(ctx, `insert into profiles (id, email, role, features) values ('`+uConteudo+`', 'c@x', 'viewer', '{conteudo}')`)
	id := peca(t, p, "Do dono", "feed", "agendada", time.Now().Add(-time.Minute), uConteudo)
	h := &HoraH{Pool: p, VAPID: pushteste.VAPID(t), HTTP: pushteste.Novo(t).HTTP}
	h.VAPID.Privada = ""
	if err := h.Rodar(ctx); err == nil {
		t.Fatal("VAPID inválido é erro")
	}
	var avisado bool
	p.QueryRow(ctx, `select avisado_em is not null from conteudo_pecas where id = $1::uuid`, id).Scan(&avisado)
	if avisado {
		t.Fatal("com VAPID errado nada pode ser reivindicado")
	}
	h.VAPID = pushteste.VAPID(t)
	if err := h.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	if ev := eventos(t, p, id); len(ev) != 1 || !strings.Contains(ev[0], "quem é responsável por esta peça está com o aviso de conteúdo desligado") {
		t.Fatalf("%v", ev)
	}
}

// ── espelho ──────────────────────────────────────────────────────────────────────────────────────

type graphFalsa struct {
	mu      sync.Mutex
	pedidos []core.PedidoMeta
	resp    func(core.PedidoMeta) (int, string)
}

// lista: cópia dos pedidos recebidos (sob a trava).
func (f *graphFalsa) lista() []core.PedidoMeta {
	f.mu.Lock()
	defer f.mu.Unlock()
	return slices.Clone(f.pedidos)
}

func coreConteudo(t *testing.T, resp func(core.PedidoMeta) (int, string)) (*core.Cliente, *graphFalsa) {
	t.Helper()
	f := &graphFalsa{resp: resp}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var p core.PedidoMeta
		json.NewDecoder(r.Body).Decode(&p)
		f.mu.Lock()
		f.pedidos = append(f.pedidos, p)
		f.mu.Unlock()
		st, corpo := f.resp(p)
		w.WriteHeader(st)
		io.WriteString(w, corpo)
	}))
	t.Cleanup(srv.Close)
	cli := core.Novo(srv.URL, "token-do-core")
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	return cli, f
}

func TestEspelhoCasaEMede(t *testing.T) {
	p := bancoConteudo(t)
	ctx := context.Background()
	agora := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC)
	casa := peca(t, p, "Bolsa de couro preta", "feed", "agendada", time.Date(2026, 10, 9, 14, 0, 0, 0, time.UTC), "")
	story := peca(t, p, "Story", "stories", "agendada", time.Date(2026, 10, 9, 14, 0, 0, 0, time.UTC), "")
	medida := peca(t, p, "Antiga", "feed", "publicada", time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC), "")
	p.Exec(ctx, `update conteudo_pecas set ig_media_id = 'm-antiga', publicado_em = '2026-10-01T12:00:00Z' where id = $1::uuid`, medida)
	cli, f := coreConteudo(t, func(pd core.PedidoMeta) (int, string) {
		switch pd.Caminho {
		case "/1784/media":
			return 200, `{"data":[{"id":"m1","caption":"Bolsa de couro preta","media_type":"IMAGE","media_product_type":"FEED","timestamp":"2026-10-09T14:05:00+0000","permalink":"https://ig/p/m1"}]}`
		case "/m1": // a recém-casada já é medida na mesma rodada (o passo B vem depois do A, como na edge)
			return 200, `{"like_count":5,"comments_count":0}`
		case "/m1/insights":
			return 200, `{"data":[{"name":"reach","values":[{"value":100}]},{"name":"impressions","values":[{"value":150}]}]}`
		case "/m-antiga":
			return 200, `{"like_count":42,"comments_count":3,"permalink":"https://ig/p/a"}`
		case "/m-antiga/insights":
			return 400, `{"error":{"message":"(#10) Not enough viewers"}}`
		}
		return 404, `{"erro":"desconhecido"}`
	})
	e := &Espelho{Pool: p, Core: cli, Agora: func() time.Time { return agora }}
	if err := e.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var mediaID, status string
	p.QueryRow(ctx, `select coalesce(ig_media_id, ''), status from conteudo_pecas where id = $1::uuid`, casa).Scan(&mediaID, &status)
	if mediaID != "m1" || status != "publicada" {
		t.Fatalf("casou automático: media=%q status=%q", mediaID, status)
	}
	if ev := eventos(t, p, casa); len(ev) != 1 || ev[0] != "casou: Encontrei o post no Instagram sozinho. Legenda 100% parecida, publicado 5 min depois do combinado." {
		t.Fatalf("%v", ev)
	}
	var curtidas, alcance *int
	var dia string
	p.QueryRow(ctx, `select curtidas, alcance, capturado_em::text from conteudo_metricas where peca_id = $1::uuid`, medida).Scan(&curtidas, &alcance, &dia)
	if curtidas == nil || *curtidas != 42 || alcance != nil || dia != "2026-10-10" {
		t.Fatalf("insights falhou: curtidas ficam, alcance nulo (não zero): %v %v %s", curtidas, alcance, dia)
	}
	var vis *int
	p.QueryRow(ctx, `select visualizacoes from conteudo_metricas where peca_id = $1::uuid`, casa).Scan(&vis)
	if vis == nil || *vis != 150 {
		t.Fatalf("views ausente cai em impressions: %v", vis)
	}
	for _, pd := range f.lista() {
		if strings.Contains(pd.Caminho, story) {
			t.Fatal("story nunca é casado")
		}
	}
	n := len(f.lista())
	err := e.Rodar(ctx)
	if depois := len(f.lista()); err != nil || depois != n {
		t.Fatalf("já medida hoje e já casada: nada a perguntar à Meta (pedidos %d -> %d, err=%v)", n, depois, err)
	}
}

func TestEspelhoFalhaDaMetaFicaVisivel(t *testing.T) {
	p := bancoConteudo(t)
	peca(t, p, "Bolsa", "feed", "agendada", time.Now().Add(-time.Hour), "")
	cli, _ := coreConteudo(t, func(core.PedidoMeta) (int, string) { return 500, `{"error":{"message":"fora do ar"}}` })
	e := &Espelho{Pool: p, Core: cli}
	if err := e.Rodar(context.Background()); err == nil || !strings.Contains(err.Error(), "casar Vessel: Meta API /1784/media: fora do ar") {
		t.Fatalf("err=%v", err)
	}
}

func TestPrecisaMedir(t *testing.T) {
	agora := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC)
	dia := func(d int) time.Time { return agora.AddDate(0, 0, -d) }
	for _, c := range []struct {
		publicado time.Time
		ultima    string
		quer      bool
	}{
		{dia(3), "", true}, {dia(31), "", false}, {dia(3), "2026-10-10", false}, {dia(3), "2026-10-09", true},
		{dia(20), "2026-10-05", false}, {dia(20), "2026-10-02", true},
	} {
		if got := precisaMedir(c.publicado, c.ultima, agora); got != c.quer {
			t.Errorf("publicado %s, última %q: %v", c.publicado.Format("01-02"), c.ultima, got)
		}
	}
}

// Segredo e endpoint nunca saem no erro, no log nem na trilha da peça (VAPID privada, endpoint do
// push e token do core).
func TestConteudoNaoVazaSegredoNemEndpoint(t *testing.T) {
	var log bytes.Buffer
	anterior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	defer slog.SetDefault(anterior)

	p := bancoConteudo(t)
	ctx := context.Background()
	p.Exec(ctx, `insert into profiles (id, email, role, features) values ('`+uConteudo+`', 'c@x', 'viewer', '{conteudo}')`)
	pushteste.Inscrever(t, p, "segredo-do-endpoint/e500", uConteudo)
	p.Exec(ctx, `insert into push_preferencias (user_id, tipo, ativo) values ('`+uConteudo+`', 'conteudo', true)`)
	id := peca(t, p, "Bolsa", "feed", "agendada", time.Now().Add(-time.Minute), "")
	h := &HoraH{Pool: p, VAPID: pushteste.VAPID(t), HTTP: pushteste.Novo(t).HTTP}
	err := h.Rodar(ctx)
	if err == nil || !strings.Contains(err.Error(), "nenhum_push_entregue") {
		t.Fatalf("push recusado é erro da tarefa: %v", err)
	}
	saida := err.Error() + log.String() + strings.Join(eventos(t, p, id), "|")
	for _, segredo := range []string{"segredo-do-endpoint", "example.com", h.VAPID.Privada} {
		if strings.Contains(saida, segredo) {
			t.Fatalf("%q vazou: %s", segredo, saida)
		}
	}
	h.VAPID.Privada = "chave-privada-inventada"
	if err := h.Rodar(ctx); err == nil || strings.Contains(err.Error(), "chave-privada-inventada") {
		t.Fatalf("erro de VAPID não pode trazer a chave: %v", err)
	}

	// core fora do ar: o token dele não aparece (o endereço interno do core aparece no erro de rede,
	// como em todas as tarefas da Graph: core.Cliente é do Plano 3, e o endereço não é segredo).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	cli := core.Novo(srv.URL, "token-do-core")
	cli.Dormir = func(context.Context, time.Duration) error { return nil }
	srv.Close()
	e := &Espelho{Pool: p, Core: cli}
	err = e.Rodar(ctx)
	if err == nil {
		t.Fatal("core fora do ar é erro")
	}
	saida = err.Error() + log.String()
	for _, segredo := range []string{"token-do-core"} {
		if strings.Contains(saida, segredo) {
			t.Fatalf("%q vazou: %s", segredo, saida)
		}
	}
}
