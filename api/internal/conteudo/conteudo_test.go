package conteudo

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
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
	antes := map[string]int{}
	for _, id := range []string{naHora, velha, doDono, futura} {
		antes[id] = len(eventos(t, p, id))
	}
	if err := h.Rodar(ctx); err != nil || srv.Total() != total {
		t.Fatalf("rodar de novo não avisa de novo: err=%v total %d -> %d", err, total, srv.Total())
	}
	for id, n := range antes {
		if depois := len(eventos(t, p, id)); depois != n {
			t.Fatalf("a trilha da peça %s mudou na segunda rodada: %d -> %d", id, n, depois)
		}
	}
	for id, quer := range map[string]bool{naHora: true, velha: true, doDono: true, futura: false} {
		var avisado bool
		p.QueryRow(ctx, `select avisado_em is not null from conteudo_pecas where id = $1::uuid`, id).Scan(&avisado)
		if avisado != quer {
			t.Fatalf("peça %s: avisado_em preenchido = %v, esperava %v", id, avisado, quer)
		}
	}
}

// "Reavisar" (conteudo_reavisar) e a reaprovação zeram avisado_em: a peça é reivindicada de novo e o aviso
// TEM de sair de novo, com a sua própria linha na trilha (o livro de envios não pode tratar como repetido).
func TestHoraHReavisarMandaDeNovo(t *testing.T) {
	p := bancoConteudo(t)
	ctx := context.Background()
	p.Exec(ctx, `insert into profiles (id, email, role, features) values ('`+uConteudo+`', 'c@x', 'viewer', '{conteudo}')`)
	pushteste.Inscrever(t, p, "conteudo", uConteudo)
	p.Exec(ctx, `insert into push_preferencias (user_id, tipo, ativo) values ('`+uConteudo+`', 'conteudo', true)`)
	id := peca(t, p, "Bolsa", "feed", "agendada", time.Now().Add(-time.Minute), "")
	srv := pushteste.Novo(t)
	h := &HoraH{Pool: p, VAPID: pushteste.VAPID(t), HTTP: srv.HTTP}
	for rodada := 1; rodada <= 2; rodada++ {
		if err := h.Rodar(ctx); err != nil {
			t.Fatal(err)
		}
		if srv.Total() != rodada || len(eventos(t, p, id)) != rodada {
			t.Fatalf("rodada %d: pushes=%d, trilha=%v", rodada, srv.Total(), eventos(t, p, id))
		}
		if err := h.Rodar(ctx); err != nil || srv.Total() != rodada { // sem reavisar, nada de novo
			t.Fatalf("rodada %d repetida: err=%v pushes=%d", rodada, err, srv.Total())
		}
		p.Exec(ctx, `update conteudo_pecas set avisado_em = null where id = $1::uuid`, id)
	}
	if ev := eventos(t, p, id); len(ev) != 2 || ev[1] != "avisou: Aviso enviado para 1 aparelho(s)." {
		t.Fatalf("%v", ev)
	}
}

// O claim é o que impede o aviso duplo: execuções simultâneas (dois workers, cron + rodar manual).
func TestHoraHExecucoesSimultaneasReivindicamUmaVez(t *testing.T) {
	p := bancoConteudo(t)
	ctx := context.Background()
	p.Exec(ctx, `insert into profiles (id, email, role, features) values ('`+uConteudo+`', 'c@x', 'viewer', '{conteudo}')`)
	pushteste.Inscrever(t, p, "conteudo", uConteudo)
	p.Exec(ctx, `insert into push_preferencias (user_id, tipo, ativo) values ('`+uConteudo+`', 'conteudo', true)`)
	var ids []string
	for _, t1 := range []string{"A", "B", "C"} {
		ids = append(ids, peca(t, p, t1, "feed", "agendada", time.Now().Add(-time.Minute), ""))
	}
	srv := pushteste.Novo(t)
	h := &HoraH{Pool: p, VAPID: pushteste.VAPID(t), HTTP: srv.HTTP}
	var wg sync.WaitGroup
	largada := make(chan struct{})
	for range 6 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-largada
			if err := h.Rodar(ctx); err != nil {
				t.Error(err)
			}
		}()
	}
	close(largada)
	wg.Wait()
	if srv.Total() != 3 {
		t.Fatalf("3 peças, 1 aparelho: esperava 3 pushes, saíram %d", srv.Total())
	}
	for _, id := range ids {
		if ev := eventos(t, p, id); len(ev) != 1 {
			t.Fatalf("peça %s: %v", id, ev)
		}
	}
}

// Depois do claim (irreversível) um erro numa peça não pode deixar as outras sem aviso nem trilha.
func TestHoraHErroNumaPecaNaoParaAsOutras(t *testing.T) {
	p := bancoConteudo(t)
	ctx := context.Background()
	p.Exec(ctx, `insert into profiles (id, email, role, features) values ('`+uConteudo+`', 'c@x', 'viewer', '{conteudo}')`)
	pushteste.Inscrever(t, p, "conteudo", uConteudo)
	p.Exec(ctx, `insert into push_preferencias (user_id, tipo, ativo) values ('`+uConteudo+`', 'conteudo', true)`)
	ruim := peca(t, p, "Ruim", "feed", "agendada", time.Now().Add(-time.Minute), "")
	var boas []string
	for _, n := range []string{"B1", "B2", "B3"} {
		boas = append(boas, peca(t, p, n, "feed", "agendada", time.Now().Add(-time.Minute), ""))
	}
	if _, err := p.Exec(ctx, `create function barra_peca() returns trigger language plpgsql as $$
		begin if new.peca_id = '`+ruim+`'::uuid then raise exception 'banco recusou a trilha'; end if; return new; end $$;
		create trigger barra before insert on conteudo_eventos for each row execute function barra_peca()`); err != nil {
		t.Fatal(err)
	}
	srv := pushteste.Novo(t)
	err := (&HoraH{Pool: p, VAPID: pushteste.VAPID(t), HTTP: srv.HTTP}).Rodar(ctx)
	if err == nil || !strings.Contains(err.Error(), "banco recusou a trilha") || !strings.Contains(err.Error(), ruim) {
		t.Fatalf("o erro da peça ruim sobe, com a peça: %v", err)
	}
	for _, id := range boas {
		if ev := eventos(t, p, id); len(ev) != 1 || ev[0] != "avisou: Aviso enviado para 1 aparelho(s)." {
			t.Fatalf("peça %s ficou sem trilha: %v", id, ev)
		}
	}
	if srv.Total() != 4 {
		t.Fatalf("pushes = %d, esperava 4 (a ruim também foi avisada)", srv.Total())
	}
}

// Contexto cancelado depois do claim (prazo da execução, desligamento) não pode deixar peça sem aviso.
func TestHoraHContextoCanceladoDepoisDoClaimTerminaAsPecas(t *testing.T) {
	p := bancoConteudo(t)
	p.Exec(context.Background(), `insert into profiles (id, email, role, features) values ('`+uConteudo+`', 'c@x', 'viewer', '{conteudo}')`)
	pushteste.Inscrever(t, p, "conteudo", uConteudo)
	p.Exec(context.Background(), `insert into push_preferencias (user_id, tipo, ativo) values ('`+uConteudo+`', 'conteudo', true)`)
	var ids []string
	for _, n := range []string{"A", "B"} {
		ids = append(ids, peca(t, p, n, "feed", "agendada", time.Now().Add(-time.Minute), ""))
	}
	srv := pushteste.Novo(t)
	ctx, cancela := context.WithCancel(context.Background())
	cancelou := false
	cli := &http.Client{Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if !cancelou {
			cancelou = true
			cancela() // o prazo vence no meio do lote
		}
		return srv.HTTP.Transport.RoundTrip(r)
	})}
	if err := (&HoraH{Pool: p, VAPID: pushteste.VAPID(t), HTTP: cli}).Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	if srv.Total() != 2 {
		t.Fatalf("pushes = %d, esperava 2", srv.Total())
	}
	for _, id := range ids {
		if ev := eventos(t, p, id); len(ev) != 1 {
			t.Fatalf("peça %s ficou sem trilha: %v", id, ev)
		}
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

// Falha de push é erro da tarefa mesmo quando outros aparelhos receberam; e a trilha não pode parecer sucesso.
func TestHoraHFalhaParcialEPecaSemNenhumAparelhoFicamVisiveis(t *testing.T) {
	p := bancoConteudo(t)
	ctx := context.Background()
	p.Exec(ctx, `insert into profiles (id, email, role, features) values
		('`+uConteudo+`', 'c@x', 'viewer', '{conteudo}'), ('`+uOutro+`', 'o@x', 'viewer', '{conteudo}')`)
	pushteste.Inscrever(t, p, "bom", uConteudo)
	pushteste.Inscrever(t, p, "ruim/e500", uConteudo)
	pushteste.Inscrever(t, p, "so-ruim/e500", uOutro)
	p.Exec(ctx, `insert into push_preferencias (user_id, tipo, ativo) values ('`+uConteudo+`', 'conteudo', true), ('`+uOutro+`', 'conteudo', true)`)
	parcial := peca(t, p, "Parcial", "feed", "agendada", time.Now().Add(-time.Minute), uConteudo)
	nenhum := peca(t, p, "Nenhum", "feed", "agendada", time.Now().Add(-time.Minute), uOutro)
	srv := pushteste.Novo(t)
	err := (&HoraH{Pool: p, VAPID: pushteste.VAPID(t), HTTP: srv.HTTP}).Rodar(ctx)
	if err == nil || !strings.Contains(err.Error(), "2 falha(s)") {
		t.Fatalf("falha de push é erro da tarefa: %v", err)
	}
	if ev := eventos(t, p, parcial); len(ev) != 1 || ev[0] != "avisou: Aviso enviado para 1 aparelho(s)." {
		t.Fatalf("parcial: %v", ev)
	}
	if ev := eventos(t, p, nenhum); len(ev) != 1 || ev[0] != `avisou: Tentei avisar, mas nenhum aparelho recebeu (1 falha(s)). Use "Reavisar" para tentar de novo.` {
		t.Fatalf("nenhum: %v", ev)
	}
	for _, id := range []string{parcial, nenhum} { // a reivindicação NÃO é desfeita (senão repetiria a cada 5 min)
		var avisado bool
		p.QueryRow(ctx, `select avisado_em is not null from conteudo_pecas where id = $1::uuid`, id).Scan(&avisado)
		if !avisado {
			t.Fatalf("peça %s voltou à fila", id)
		}
	}
}

func TestTarefasDoConteudoComOPrazoDeProducao(t *testing.T) {
	h := (&HoraH{}).Tarefa()
	e := (&Espelho{}).Tarefa()
	if h.Nome != "conteudo-hora-h" || h.Agenda != "*/5 * * * *" || h.Limite != 2*time.Minute ||
		e.Nome != "conteudo-espelho" || e.Agenda != "*/30 * * * *" || e.Limite != 10*time.Minute {
		t.Fatalf("%+v %+v", h, e)
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
	if err == nil || !strings.Contains(err.Error(), "push_nao_entregue") {
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

// ── espelho: contrato com a Graph, o banco e o relógio ────────────────────────────────────────────

func novaConta(t *testing.T, p *pgxpool.Pool, id, nome, ig string) {
	t.Helper()
	if _, err := p.Exec(context.Background(), `insert into accounts (id, name, instagram_id) values ($1::uuid, $2::text, $3::text)`, id, nome, ig); err != nil {
		t.Fatal(err)
	}
}

func pecaDaConta(t *testing.T, p *pgxpool.Pool, conta, titulo, formato, status string, publicarEm time.Time) string {
	t.Helper()
	var id string
	if err := p.QueryRow(context.Background(), `insert into conteudo_pecas (account_id, titulo, formato, status, legenda, publicar_em)
		values ($1::uuid, $2, $3, $4, $2, $5) returning id::text`, conta, titulo, formato, status, publicarEm).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

func publicada(t *testing.T, p *pgxpool.Pool, conta, titulo, media string, publicadoEm time.Time) string {
	t.Helper()
	id := pecaDaConta(t, p, conta, titulo, "feed", "publicada", publicadoEm)
	if _, err := p.Exec(context.Background(), `update conteudo_pecas set ig_media_id = $2::text, publicado_em = $3::timestamptz where id = $1::uuid`, id, media, publicadoEm); err != nil {
		t.Fatal(err)
	}
	return id
}

func quantos(t *testing.T, p *pgxpool.Pool, sql string, args ...any) (n int) {
	t.Helper()
	if err := p.QueryRow(context.Background(), sql, args...).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

const midiaDe14h = `{"data":[{"id":"%s","caption":"Bolsa de couro preta","media_type":"IMAGE","media_product_type":"FEED","timestamp":"2026-10-09T14:05:00+0000"}]}`

func TestEspelhoPedeATodaGraphComOsParametrosDaEdge(t *testing.T) {
	p := bancoConteudo(t)
	agora := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC)
	pecaDaConta(t, p, contaVessel, "Bolsa de couro preta", "feed", "agendada", time.Date(2026, 10, 9, 14, 0, 0, 0, time.UTC))
	publicada(t, p, contaVessel, "Antiga", "m-antiga", agora.AddDate(0, 0, -3))
	cli, f := coreConteudo(t, func(pd core.PedidoMeta) (int, string) {
		if pd.Caminho == "/1784/media" {
			return 200, `{"data":[]}`
		}
		return 200, `{"like_count":1}`
	})
	if err := (&Espelho{Pool: p, Core: cli, Agora: func() time.Time { return agora }}).Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	quer := map[string]map[string]any{
		"/1784/media":        {"fields": camposMidia, "limit": "50"},
		"/m-antiga":          {"fields": "like_count,comments_count,permalink"},
		"/m-antiga/insights": {"metric": "reach,saved,shares,views"},
	}
	if camposMidia != "id,caption,media_type,media_product_type,timestamp,permalink,thumbnail_url,media_url,like_count,comments_count" {
		t.Fatalf("campos da edge: %s", camposMidia)
	}
	vistos := 0
	for _, pd := range f.lista() {
		if q, ok := quer[pd.Caminho]; ok {
			vistos++
			if len(pd.Parametros) != len(q) {
				t.Errorf("%s: parâmetros %v, esperava %v", pd.Caminho, pd.Parametros, q)
			}
			for k, v := range q {
				if pd.Parametros[k] != v {
					t.Errorf("%s: %s = %v, esperava %v", pd.Caminho, k, pd.Parametros[k], v)
				}
			}
		}
	}
	if vistos != 3 {
		t.Fatalf("esperava os 3 pedidos, vi %d: %+v", vistos, f.lista())
	}
}

// A data da medição é em UTC (toISOString().slice(0,10) da edge): às 01:00 UTC ainda é "ontem" em São Paulo.
func TestEspelhoDataDaMedicaoEmUTC(t *testing.T) {
	p := bancoConteudo(t)
	agora := time.Date(2026, 10, 10, 1, 0, 0, 0, time.UTC)
	id := publicada(t, p, contaVessel, "Antiga", "m-antiga", agora.AddDate(0, 0, -3))
	cli, _ := coreConteudo(t, func(core.PedidoMeta) (int, string) { return 200, `{"like_count":1}` })
	if err := (&Espelho{Pool: p, Core: cli, Agora: func() time.Time { return agora }}).Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	var dia string
	p.QueryRow(context.Background(), `select capturado_em::text from conteudo_metricas where peca_id = $1::uuid`, id).Scan(&dia)
	if dia != "2026-10-10" {
		t.Fatalf("capturado_em = %q (UTC, não São Paulo)", dia)
	}
}

// Só peças dos últimos 7 dias entram no casamento; o resto já saiu da 1ª página de /media.
func TestEspelhoSoCasaPecasDosUltimosSeteDias(t *testing.T) {
	p := bancoConteudo(t)
	agora := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC)
	velha := pecaDaConta(t, p, contaVessel, "Bolsa de couro preta", "feed", "agendada", agora.Add(-7*24*time.Hour-time.Minute))
	nova := pecaDaConta(t, p, contaVessel, "Bolsa de couro preta", "feed", "agendada", agora.Add(-7*24*time.Hour+time.Minute))
	cli, _ := coreConteudo(t, func(pd core.PedidoMeta) (int, string) {
		if pd.Caminho == "/1784/media" { // um post só, perto das duas peças
			return 200, `{"data":[{"id":"m1","caption":"Bolsa de couro preta","media_type":"IMAGE","media_product_type":"FEED","timestamp":"` +
				agora.Add(-7*24*time.Hour).Format("2006-01-02T15:04:05-0700") + `"}]}`
		}
		return 200, `{}`
	})
	if err := (&Espelho{Pool: p, Core: cli, Agora: func() time.Time { return agora }}).Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if quantos(t, p, `select count(*) from conteudo_casamentos where peca_id = $1::uuid`, velha) != 0 ||
		quantos(t, p, `select count(*) from conteudo_casamentos where peca_id = $1::uuid`, nova) != 1 {
		t.Fatal("a peça de 7 dias e 1 min atrás não entra; a de 6 dias e 23h59 entra")
	}
}

// Post já vinculado a outra peça, ou já decidido para esta, nunca é oferecido de novo.
func TestEspelhoNaoOfereceDeNovoPostUsadoNemDecidido(t *testing.T) {
	p := bancoConteudo(t)
	ctx := context.Background()
	agora := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC)
	hora := time.Date(2026, 10, 9, 14, 0, 0, 0, time.UTC)
	publicada(t, p, contaVessel, "Outra", "m-vinculado", agora.AddDate(0, 0, -20)) // vinculado a OUTRA peça (fora da janela)
	pendente := pecaDaConta(t, p, contaVessel, "Bolsa de couro preta", "feed", "agendada", hora)
	recusada := pecaDaConta(t, p, contaVessel, "Bolsa de couro preta", "feed", "agendada", hora)
	p.Exec(ctx, `insert into conteudo_casamentos (peca_id, ig_media_id, pontuacao, situacao) values ($1::uuid, 'm-recusado', 0.7, 'recusado')`, recusada)
	cli, _ := coreConteudo(t, func(pd core.PedidoMeta) (int, string) {
		if pd.Caminho == "/1784/media" {
			return 200, `{"data":[` + strings.Repeat(`{"id":"m-vinculado","caption":"Bolsa de couro preta","media_type":"IMAGE","media_product_type":"FEED","timestamp":"2026-10-09T14:05:00+0000"},`, 1) +
				`{"id":"m-recusado","caption":"Bolsa de couro preta","media_type":"IMAGE","media_product_type":"FEED","timestamp":"2026-10-09T14:06:00+0000"}]}`
		}
		return 200, `{}`
	})
	if err := (&Espelho{Pool: p, Core: cli, Agora: func() time.Time { return agora }}).Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	if n := quantos(t, p, `select count(*) from conteudo_casamentos where peca_id in ($1::uuid, $2::uuid) and ig_media_id <> 'm-recusado'`, pendente, recusada); n != 0 {
		t.Fatalf("ofereceu de novo %d casamento(s)", n)
	}
	// como na edge, "decidido" vale para a conta inteira: o post recusado para uma peça não vai para a outra
	if n := quantos(t, p, `select count(*) from conteudo_casamentos where peca_id = $1::uuid`, pendente); n != 0 {
		t.Fatalf("o post já decidido foi oferecido a outra peça da conta: %d", n)
	}
}

// Falha de uma peça na medição fica visível e não impede as outras.
func TestEspelhoFalhaNaMedicaoFicaVisivelEMedeAsOutras(t *testing.T) {
	p := bancoConteudo(t)
	agora := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC)
	ruim := publicada(t, p, contaVessel, "Ruim", "m-ruim", agora.AddDate(0, 0, -2))
	boa := publicada(t, p, contaVessel, "Boa", "m-boa", agora.AddDate(0, 0, -2))
	cli, _ := coreConteudo(t, func(pd core.PedidoMeta) (int, string) {
		if pd.Caminho == "/m-ruim" {
			return 500, `{"error":{"message":"fora do ar"}}`
		}
		return 200, `{"like_count":7}`
	})
	err := (&Espelho{Pool: p, Core: cli, Agora: func() time.Time { return agora }}).Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "medir "+ruim+": Meta API /m-ruim: fora do ar") {
		t.Fatalf("err = %v", err)
	}
	if quantos(t, p, `select count(*) from conteudo_metricas where peca_id = $1::uuid`, boa) != 1 ||
		quantos(t, p, `select count(*) from conteudo_metricas where peca_id = $1::uuid`, ruim) != 0 {
		t.Fatal("a boa é medida, a ruim não")
	}
}

// Erro de banco numa conta não derruba as outras contas nem a medição, e não apaga a falha da Meta já colhida.
func TestEspelhoErroDeBancoNaCasarNaoAbortaORestante(t *testing.T) {
	p := bancoConteudo(t)
	ctx := context.Background()
	agora := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC)
	hora := time.Date(2026, 10, 9, 14, 0, 0, 0, time.UTC)
	novaConta(t, p, "aaaaaaaa-0000-0000-0000-00000000000a", "Aaa", "2001")
	novaConta(t, p, "aaaaaaaa-0000-0000-0000-00000000000b", "Bbb", "2002")
	novaConta(t, p, "aaaaaaaa-0000-0000-0000-00000000000c", "Ccc", "2003")
	pecaDaConta(t, p, "aaaaaaaa-0000-0000-0000-00000000000a", "Bolsa de couro preta", "feed", "agendada", hora)
	pecaDaConta(t, p, "aaaaaaaa-0000-0000-0000-00000000000b", "Bolsa de couro preta", "feed", "agendada", hora)
	ccc := pecaDaConta(t, p, "aaaaaaaa-0000-0000-0000-00000000000c", "Bolsa de couro preta", "feed", "agendada", hora)
	pub := publicada(t, p, contaVessel, "Antiga", "m-antiga", agora.AddDate(0, 0, -2))
	if _, err := p.Exec(ctx, `create function barra_casamento() returns trigger language plpgsql as $$
		begin if new.ig_media_id = 'm-bbb' then raise exception 'banco recusou o casamento'; end if; return new; end $$;
		create trigger barra before insert on conteudo_casamentos for each row execute function barra_casamento()`); err != nil {
		t.Fatal(err)
	}
	cli, _ := coreConteudo(t, func(pd core.PedidoMeta) (int, string) {
		switch pd.Caminho {
		case "/2001/media":
			return 500, `{"error":{"message":"fora do ar"}}`
		case "/2002/media":
			return 200, fmt.Sprintf(midiaDe14h, "m-bbb")
		case "/2003/media":
			return 200, fmt.Sprintf(midiaDe14h, "m-ccc")
		}
		return 200, `{"like_count":3}`
	})
	err := (&Espelho{Pool: p, Core: cli, Agora: func() time.Time { return agora }}).Rodar(ctx)
	if err == nil || !strings.Contains(err.Error(), "casar Aaa: Meta API /2001/media: fora do ar") || !strings.Contains(err.Error(), "banco recusou o casamento") {
		t.Fatalf("as duas falhas sobem: %v", err)
	}
	if quantos(t, p, `select count(*) from conteudo_casamentos where peca_id = $1::uuid`, ccc) != 1 {
		t.Fatal("a conta seguinte foi casada")
	}
	if quantos(t, p, `select count(*) from conteudo_metricas where peca_id = $1::uuid`, pub) != 1 {
		t.Fatal("a medição rodou")
	}
}

func TestEspelhoRespostaIlegivelDaMetaEhFalha(t *testing.T) {
	p := bancoConteudo(t)
	pecaDaConta(t, p, contaVessel, "Bolsa", "feed", "agendada", time.Now().Add(-time.Hour))
	cli, _ := coreConteudo(t, func(core.PedidoMeta) (int, string) { return 200, `{"data":[{"id":"m1","caption":42}]}` })
	if err := (&Espelho{Pool: p, Core: cli}).Rodar(context.Background()); err == nil || !strings.Contains(err.Error(), "casar Vessel") {
		t.Fatalf("resposta fora do formato não pode virar \"nenhum post\" calado: %v", err)
	}
}

// Fronteiras da cadência: 30 dias de acompanhamento, 7 de medida diária, 7 entre as semanais.
func TestPrecisaMedirNasFronteiras(t *testing.T) {
	agora := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	dias := func(d int) time.Time { return agora.AddDate(0, 0, -d) }
	for _, c := range []struct {
		publicado time.Time
		ultima    string
		quer      bool
	}{
		{dias(30), "", true}, {dias(30).Add(-time.Second), "", false},
		{dias(7), "2026-10-09", true},                  // 7 dias exatos: ainda é medida diária
		{dias(7).Add(-time.Hour), "2026-10-09", false}, // passou de 7: semanal, e a última foi ontem
		{dias(20), "2026-10-03", true},                 // 12:00 de 03/10 a 12:00 de 10/10 = 7 dias exatos
		{dias(20), "2026-10-04", false},
	} {
		if got := precisaMedir(c.publicado, c.ultima, agora); got != c.quer {
			t.Errorf("publicado %s, última %q: %v", c.publicado.Format(time.RFC3339), c.ultima, got)
		}
	}
}

// "Hoje" é o dia em UTC: às 01:00 UTC de 10/10 a medida de 09/10 já é de ontem (em São Paulo ainda seria hoje).
func TestPrecisaMedirUsaODiaEmUTC(t *testing.T) {
	agora := time.Date(2026, 10, 10, 1, 0, 0, 0, time.UTC)
	if !precisaMedir(agora.AddDate(0, 0, -3), "2026-10-09", agora) || precisaMedir(agora.AddDate(0, 0, -3), "2026-10-10", agora) {
		t.Fatal("a medida de 09/10 vale como ontem; a de 10/10 como hoje")
	}
}
