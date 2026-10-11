package mensagens

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Estes testes rodam as FUNÇÕES DE PRODUÇÃO do banco (as migrations do repositório, sem o `public.`, os
// grants e o RLS, que dependem dos papéis do Supabase): a reserva com `for update skip locked`, os estados
// enviando/enviada/falhou/ignorada e a trava cruzada. É aqui que "dois workers ao mesmo tempo" e "rodar de
// novo" provam que nenhuma mensagem sai duas vezes.

var migracoesDasMensagens = []string{
	"2026-09-30-zzy-mensagem-de-abandono.sql",
	"2026-09-30-zzzz-abandono-sem-duplicidade.sql",
	"2026-09-30-zzzzz-fila-de-mensagens.sql",
	"2026-09-30-zzzzzz-checkout-iniciado.sql",
	"2026-10-08-trava-cruzada-de-mensagens.sql",
	"2026-10-09-trava-cruzada-considera-enviando.sql",
}

var reLinhaDePapel = regexp.MustCompile(`(?mi)^\s*(revoke|grant)\b.*;\s*$|^\s*alter table .* enable row level security;\s*$`)

func bancoDeProducao(t *testing.T) *pgxpool.Pool {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), checkoutAbandono); err != nil {
		t.Fatal(err)
	}
	for _, nome := range migracoesDasMensagens {
		b, err := os.ReadFile(filepath.Join("..", "..", "..", "db", "migrations", nome))
		if err != nil {
			t.Fatalf("a migration de produção %s tem de estar no repositório: %v", nome, err)
		}
		sql := reLinhaDePapel.ReplaceAllString(string(b), "")
		sql = strings.ReplaceAll(strings.ReplaceAll(sql, "set search_path = public", ""), "public.", "")
		if _, err := p.Exec(context.Background(), sql); err != nil {
			t.Fatalf("%s: %v", nome, err)
		}
	}
	return p
}

// chatwootPorTelefone: o Chatwoot de mentira que dá a cada telefone o seu contato e a sua conversa (id =
// os 4 últimos dígitos), para contar quantas mensagens cada cliente recebeu.
func chatwootPorTelefone(t *testing.T, atraso time.Duration, extra func(met, cam string) (int, string)) (*Chatwoot, *chatwootFalso) {
	return novoChatwoot(t, func(met, cam string, corpo map[string]any) (int, string) {
		if extra != nil {
			if st, txt := extra(met, cam); st != 0 {
				return st, txt
			}
		}
		switch {
		case strings.Contains(cam, "contacts/search"):
			tel := cam[strings.LastIndex(cam, "%2B")+3:]
			id, _ := strconv.Atoi(tel[len(tel)-4:])
			return 200, fmt.Sprintf(`{"payload":[{"id":%d,"name":"Cliente","phone_number":"+%s"}]}`, id, tel)
		case met == "POST" && strings.HasSuffix(cam, "/conversations"):
			return 200, fmt.Sprintf(`{"id":%v}`, corpo["contact_id"])
		case met == "POST" && strings.HasSuffix(cam, "/messages"):
			time.Sleep(atraso) // alarga a janela em que os dois workers se atropelariam
		}
		return 0, ""
	})
}

// mensagensPorConversa conta os POST /conversations/<id>/messages recebidos pelo Chatwoot.
func mensagensPorConversa(f *chatwootFalso) map[string]int {
	out := map[string]int{}
	pedidos, _ := f.lista()
	for _, p := range pedidos {
		cam := strings.SplitN(p, " ", 3)[1]
		if strings.HasPrefix(p, "POST ") && strings.HasSuffix(cam, "/messages") {
			out[strings.Split(cam, "/")[6]]++
		}
	}
	return out
}

func semeiaAsFilas(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	ctx := context.Background()
	for i := 1; i <= 4; i++ { // abandono: 4 checkouts na fila de envio há 2 min
		if _, err := p.Exec(ctx, `insert into checkout_abandono (token, telefone, nome, url_de_recuperacao, status, iniciado_em, fila_envio_em)
			values ($1::text, $2::text, 'MARIA SILVA', $3::text, 'fila_envio', now() - interval '1 hour', now() - interval '2 minutes')`,
			fmt.Sprintf("ab-%d", i), fmt.Sprintf("1198765000%d", i), fmt.Sprintf("https://loja.com/checkouts/ab%d?key=1", i)); err != nil {
			t.Fatal(err)
		}
	}
	// o mesmo telefone (0099) com um abandono E um início: a trava cruzada deixa sair UMA só.
	if _, err := p.Exec(ctx, `insert into checkout_abandono (token, telefone, nome, url_de_recuperacao, status, iniciado_em, fila_envio_em)
		values ('ab-compartilhado', '11987650099', 'JOANA', 'https://loja.com/checkouts/abc?key=1', 'fila_envio', now() - interval '1 hour', now() - interval '2 minutes')`); err != nil {
		t.Fatal(err)
	}
	for i := 1; i <= 2; i++ {
		if _, err := p.Exec(ctx, `select registrar_pedido_para_mensagem($1::bigint, $2::text, 'ANA', $3::text, now() - interval '30 seconds')`,
			int64(1000+i), fmt.Sprintf("#%d", 1000+i), fmt.Sprintf("1198765001%d", i)); err != nil {
			t.Fatal(err)
		}
		if _, err := p.Exec(ctx, `insert into mensagem_fila (tipo, chave, nome, telefone, url_de_recuperacao) values ('inicio', $1::text, 'BIA', $2::text, $3::text)`,
			fmt.Sprintf("in-%d", i), fmt.Sprintf("1198765002%d", i), fmt.Sprintf("https://loja.com/checkouts/in%d?key=1", i)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := p.Exec(ctx, `insert into mensagem_fila (tipo, chave, nome, telefone, url_de_recuperacao) values ('inicio', 'in-compartilhado', 'JOANA', '11987650099', 'https://loja.com/checkouts/in?key=1')`); err != nil {
		t.Fatal(err)
	}
	// follow-up: quem recebeu a de abandono há 50 h (entre 48 e 72) e continua na fila entra pelo agendar_followups.
	if _, err := p.Exec(ctx, `insert into checkout_abandono (token, telefone, nome, url_de_recuperacao, status, iniciado_em, fila_envio_em, mensagem_status, mensagem_enviada_em, chatwoot_conversation_id)
		values ('fu-1', '11987650031', 'CARLA', 'https://loja.com/checkouts/fu1?key=1', 'fila_envio', now() - interval '51 hours', now() - interval '51 hours', 'enviada', now() - interval '50 hours', 55)`); err != nil {
		t.Fatal(err)
	}
}

func novoRobo(p *pgxpool.Pool, cw *Chatwoot) *Mensagens {
	return &Mensagens{Pool: p, Cfg: configLigada(cw), Agora: func() time.Time { return agoraDentro }}
}

func estados(t *testing.T, p *pgxpool.Pool) map[string]string {
	t.Helper()
	linhas, err := p.Query(context.Background(), `select 'abandono/' || token, coalesce(mensagem_status, 'fila') from checkout_abandono
		union all select tipo || '/' || chave, coalesce(mensagem_status, 'fila') from mensagem_fila`)
	if err != nil {
		t.Fatal(err)
	}
	defer linhas.Close()
	out := map[string]string{}
	for linhas.Next() {
		var k, v string
		linhas.Scan(&k, &v)
		out[k] = v
	}
	return out
}

// Três workers ao mesmo tempo no mesmo banco (o que um deploy sobreposto faria se a trava do worker falhasse):
// cada cliente recebe UMA mensagem, e rodar de novo (cron, `api worker rodar`) não reenvia nada.
func TestDoisWorkersNaoEnviamDuasVezes(t *testing.T) {
	p := bancoDeProducao(t)
	semeiaAsFilas(t, p)
	cw, falso := chatwootPorTelefone(t, 40*time.Millisecond, nil)
	var wg sync.WaitGroup
	erros := make([]error, 3)
	for i := range erros {
		wg.Add(1)
		go func() {
			defer wg.Done()
			erros[i] = novoRobo(p, cw).Rodar(context.Background())
		}()
	}
	wg.Wait()
	for i, e := range erros {
		if e != nil {
			t.Fatalf("worker %d: %v", i, e)
		}
	}
	// O que a trava cruzada devolveu ('esperar') sai ou é barrado nas rodadas seguintes, uma de cada vez.
	for i := 0; i < 3; i++ {
		if err := novoRobo(p, cw).Rodar(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	// as conversas são os 4 últimos dígitos do telefone: 0001..0004, 0099, 0011, 0012, 0021, 0022, 0031.
	quer := map[string]int{"1": 1, "2": 1, "3": 1, "4": 1, "99": 1, "11": 1, "12": 1, "21": 1, "22": 1, "31": 1}
	got := mensagensPorConversa(falso)
	if fmt.Sprint(got) != fmt.Sprint(quer) {
		t.Fatalf("mensagens por conversa = %v, esperava exatamente uma cada: %v", got, quer)
	}
	st := estados(t, p)
	shared := []string{st["abandono/ab-compartilhado"], st["inicio/in-compartilhado"]}
	for k, v := range st {
		if v != "enviada" && v != "ignorada" {
			t.Errorf("%s ficou %s", k, v)
		}
	}
	if (shared[0] == "enviada") == (shared[1] == "enviada") {
		t.Fatalf("o telefone compartilhado recebe uma só: %v", shared)
	}
	// Rodar de novo: nada novo sai.
	antes := len(mensagensPorConversa(falso))
	total := func() int {
		n := 0
		for _, v := range mensagensPorConversa(falso) {
			n += v
		}
		return n
	}
	enviadasAntes := total()
	for i := 0; i < 2; i++ {
		if err := novoRobo(p, cw).Rodar(context.Background()); err != nil {
			t.Fatal(err)
		}
	}
	if total() != enviadasAntes || len(mensagensPorConversa(falso)) != antes {
		t.Fatalf("rodar de novo reenviou: %d -> %d", enviadasAntes, total())
	}
}

// falhaAoGravar: a mensagem sai, mas gravar 'enviada' no banco falha (o banco caiu logo depois do envio).
type falhaAoGravar struct{ fila }

func (falhaAoGravar) marcarMensagem(ctx context.Context, token, status, motivo string, conversa *int64) error {
	if status == "enviada" {
		return fmt.Errorf("banco fora")
	}
	return nil
}

// A mensagem SAIU e o banco não registrou: a linha fica `enviando` (nunca volta à fila) e, passados 10 min,
// vira falhou/travada_sem_confirmacao — visível, jamais uma segunda mensagem.
func TestEnviadaSemGravarNuncaReenvia(t *testing.T) {
	p := bancoDeProducao(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `insert into checkout_abandono (token, telefone, nome, url_de_recuperacao, status, iniciado_em, fila_envio_em)
		values ('ab-1', '11987650001', 'MARIA', 'https://loja.com/checkouts/ab1?key=1', 'fila_envio', now() - interval '1 hour', now() - interval '2 minutes')`); err != nil {
		t.Fatal(err)
	}
	cw, falso := chatwootPorTelefone(t, 0, nil)
	m := novoRobo(p, cw)
	desligar(&m.Cfg, "abandono")
	m.fila = falhaAoGravar{filaSQL{p}}
	if err := m.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	status := func() (string, string) {
		var st, motivo string
		p.QueryRow(ctx, `select coalesce(mensagem_status, 'fila'), coalesce(mensagem_motivo, '') from checkout_abandono where token = 'ab-1'`).Scan(&st, &motivo)
		return st, motivo
	}
	if st, _ := status(); st != "enviando" {
		t.Fatalf("status = %s", st)
	}
	for i := 0; i < 2; i++ {
		m2 := novoRobo(p, cw)
		desligar(&m2.Cfg, "abandono")
		if err := m2.Rodar(ctx); err != nil {
			t.Fatal(err)
		}
	}
	p.Exec(ctx, `update checkout_abandono set mensagem_reservada_em = now() - interval '11 minutes' where token = 'ab-1'`)
	m3 := novoRobo(p, cw)
	desligar(&m3.Cfg, "abandono")
	if err := m3.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	if st, motivo := status(); st != "falhou" || motivo != "travada_sem_confirmacao" {
		t.Fatalf("status=%s motivo=%s", st, motivo)
	}
	if got := mensagensPorConversa(falso); fmt.Sprint(got) != "map[1:1]" {
		t.Fatalf("mensagens = %v", got)
	}
}

// Prazo no meio do lote contra o banco de produção: a mensagem em voo vira `falhou` (ambígua, nunca reenviada) e as
// reservadas que sobraram voltam à fila (status nulo) SEM gastar tentativa — e a rodada seguinte as envia.
func TestPrazoNoMeioDoLoteContraOBanco(t *testing.T) {
	p := bancoDeProducao(t)
	ctx := context.Background()
	for i := 1; i <= 3; i++ {
		if _, err := p.Exec(ctx, `insert into checkout_abandono (token, telefone, nome, url_de_recuperacao, status, iniciado_em, fila_envio_em)
			values ($1::text, $2::text, 'MARIA', $3::text, 'fila_envio', now() - interval '1 hour', now() - ($4::int * interval '1 minute'))`,
			fmt.Sprintf("ab-%d", i), fmt.Sprintf("1198765000%d", i), fmt.Sprintf("https://loja.com/checkouts/ab%d?key=1", i), 10-i); err != nil {
			t.Fatal(err)
		}
	}
	cw, falso := chatwootPorTelefone(t, 0, func(met, cam string) (int, string) {
		if met == "POST" && strings.HasSuffix(cam, "/conversations/1/messages") {
			time.Sleep(700 * time.Millisecond) // a primeira fica pendurada até o prazo
		}
		return 0, ""
	})
	m := novoRobo(p, cw)
	desligar(&m.Cfg, "abandono")
	ctx2, cancela := context.WithTimeout(ctx, 400*time.Millisecond)
	defer cancela()
	if err := m.Rodar(ctx2); err == nil || err.Error() != "abandono: limite_de_tempo" {
		t.Fatalf("err=%v", err)
	}
	var st1, st2, st3 string
	var tent int
	p.QueryRow(ctx, `select mensagem_status, mensagem_tentativas from checkout_abandono where token = 'ab-1'`).Scan(&st1, &tent)
	p.QueryRow(ctx, `select coalesce(mensagem_status, 'fila') from checkout_abandono where token = 'ab-2'`).Scan(&st2)
	p.QueryRow(ctx, `select coalesce(mensagem_status, 'fila') from checkout_abandono where token = 'ab-3'`).Scan(&st3)
	if st1 != "falhou" || st2 != "fila" || st3 != "fila" || tent != 0 {
		t.Fatalf("estados = %s %s %s tentativas=%d", st1, st2, st3, tent)
	}
	m2 := novoRobo(p, cw)
	desligar(&m2.Cfg, "abandono")
	if err := m2.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	got := mensagensPorConversa(falso)
	if got["1"] != 1 || got["2"] != 1 || got["3"] != 1 {
		t.Fatalf("a 1ª (ambígua) não é reenviada e as outras saem: %v", got)
	}
}

// O corpo do erro do Chatwoot (com o token e o segredo do bot) não chega à coluna `mensagem_motivo`.
func TestSegredoNaoVaiParaAColunaDeMotivo(t *testing.T) {
	p := bancoDeProducao(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, `insert into checkout_abandono (token, telefone, nome, url_de_recuperacao, status, iniciado_em, fila_envio_em)
		values ('ab-1', '11987650001', 'MARIA', 'https://loja.com/checkouts/ab1?key=1', 'fila_envio', now() - interval '1 hour', now() - interval '2 minutes'),
		       ('ab-2', '11987650002', 'MARIA', 'https://loja.com/checkouts/ab2?key=1', 'fila_envio', now() - interval '1 hour', now() - interval '1 minute')`); err != nil {
		t.Fatal(err)
	}
	eco, _ := json.Marshal(map[string]string{"error": "token " + tokenChatwoot + " e " + segredoDoBot})
	cw, _ := chatwootPorTelefone(t, 0, func(met, cam string) (int, string) {
		if met == "POST" && strings.HasSuffix(cam, "/messages") {
			return 422, string(eco)
		}
		return 0, ""
	})
	m := novoRobo(p, cw)
	desligar(&m.Cfg, "abandono")
	if err := m.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var n int
	var motivo string
	p.QueryRow(ctx, `select count(*), coalesce(max(mensagem_motivo), '') from checkout_abandono where mensagem_status = 'falhou'`).Scan(&n, &motivo)
	if n != 2 || !strings.Contains(motivo, "enviar_template:422") || strings.Contains(motivo, tokenChatwoot) || strings.Contains(motivo, segredoDoBot) || !strings.Contains(motivo, "***") {
		t.Fatalf("n=%d motivo=%q", n, motivo)
	}
}
