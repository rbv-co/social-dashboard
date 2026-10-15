package frota

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// Plano 03-D: a troca de posse mexe em duas linhas (fecha a posse e abre a nova) na MESMA transação. Se
// a abertura falha (aqui, um gatilho que recusa), o fechamento já feito tem de ser desfeito: o carro
// não pode ficar "devolvido" sem a posse nova.
func TestTrocaQueFalhaNoMeioDesfazOFechamento(t *testing.T) {
	m := novoMundo(t, montarUsos)
	if _, err := m.P.Exec(t.Context(), `create function recusa_posse_nova() returns trigger language plpgsql as
		$$ begin if new.pessoa_nome = 'Explode' then raise exception 'recusada' using errcode = '23514'; end if; return new; end $$;
		create trigger recusa_posse_nova before insert on frota_uso for each row execute function recusa_posse_nova();`); err != nil {
		t.Fatal(err)
	}
	foto := m.Um(t, fotoDaFrota)
	st, corpo := m.Pedir(t, "motorista", "POST", "/frota/usos/trocar",
		`{"veiculo_id":"`+V1+`","fechar":{"id":"`+U1+`","volta_em":"2026-10-12T10:00:00Z"},`+
			`"abrir":{"pessoa_id":null,"pessoa_nome":"Explode","saida_em":"2026-10-12T10:00:00Z"}}`)
	if st != http.StatusBadRequest {
		t.Fatalf("troca com abertura recusada = %d %s, esperava 400", st, corpo)
	}
	if v := m.Um(t, fotoDaFrota); v != foto {
		t.Errorf("a troca que falhou no meio deixou rastro: o fechamento da posse não foi desfeito")
	}
	if v := m.Um(t, `select coalesce(volta_em::text, '<nulo>') from frota_uso where id = '`+U1+`'`); v != "<nulo>" {
		t.Errorf("U1 voltou em %s, esperava continuar aberta", v)
	}
}

// Plano 03-D: pedido que espera numa linha travada por outra transação tem prazo: o contexto vence, a
// resposta é 504 (não pendura), a conexão volta ao pool e, solta a trava, o mesmo pedido passa.
func TestPedidoPresoNaTravaEsgotaOPrazoESoltaAConexao(t *testing.T) {
	m := novoMundo(t, montarUsos)
	ctx := t.Context()
	preso, err := m.P.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer preso.Rollback(ctx)
	if _, err := preso.Exec(ctx, `select 1 from frota_uso where id = $1::uuid for update`, U1); err != nil {
		t.Fatal(err)
	}
	pedir := func(prazo time.Duration) (int, time.Duration) {
		c, cancela := context.WithTimeout(ctx, prazo)
		defer cancela()
		r := httptest.NewRequest("POST", "/frota/usos/trocar", strings.NewReader(
			`{"veiculo_id":"`+V1+`","fechar":{"id":"`+U1+`","volta_em":"2026-10-12T10:00:00Z"}}`)).WithContext(c)
		r.Header.Set("Authorization", "Bearer "+m.Tok["motorista"])
		w := httptest.NewRecorder()
		ini := time.Now()
		m.H.ServeHTTP(w, r)
		return w.Code, time.Since(ini)
	}
	st, dur := pedir(400 * time.Millisecond)
	if st != http.StatusGatewayTimeout || dur > 5*time.Second {
		t.Fatalf("pedido preso na trava = %d em %s, esperava 504 perto do prazo", st, dur)
	}
	preso.Rollback(ctx)
	if !conexoesSoltas(m) {
		t.Fatalf("depois do prazo estourado ficaram %d conexões do pool em uso", m.P.Stat().AcquiredConns())
	}
	if st, _ := pedir(5 * time.Second); st != http.StatusOK {
		t.Fatalf("solta a trava, o mesmo pedido deu %d", st)
	}
}

// conexoesSoltas espera (até 2 s) o pool devolver todas as conexões e confere no servidor que nenhuma
// ficou "idle in transaction" (a transação esquecida aberta).
func conexoesSoltas(m *mundoteste.Mundo) bool {
	for range 40 {
		if m.P.Stat().AcquiredConns() == 0 {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	var presas int
	err := m.P.QueryRow(context.Background(), `select count(*) from pg_stat_activity
		where datname = current_database() and state like 'idle in transaction%' and pid <> pg_backend_pid()`).Scan(&presas)
	return m.P.Stat().AcquiredConns() <= 1 && err == nil && presas == 0 // 1 = a conexão desta consulta
}

// Plano 03-D: depois de uma enxurrada de pedidos de todo tipo (200, 201, 400, 403, 404, 409), em
// paralelo, o pool não perdeu conexão e o servidor não tem transação esquecida aberta.
func TestEnxurradaDePedidosNaoVazaConexao(t *testing.T) {
	m := novoMundo(t, montarUsos)
	pedidos := []struct{ quem, metodo, caminho, corpo string }{
		{"motorista", "GET", "/frota/usos", ""},
		{"motorista", "POST", "/frota/usos", `{"veiculo_id":"` + V1 + `","km_saida":150}`},     // 409: carro fora
		{"motorista", "POST", "/frota/usos", `{"veiculo_id":"` + V2 + `","tipo":"posse"}`},     // 400: corpo
		{"admin", "PATCH", "/frota/usos/" + U1, `{"volta_em":"2026-10-12T18:00:00Z"}`},         // 404: invisível
		{"viewer", "POST", "/frota/usos", `{"veiculo_id":"` + V2 + `","km_saida":150}`},        // 403
		{"motorista", "PATCH", "/frota/usos/" + U1, `{"observacao":"x"}`},                      // grava em linha dele
		{"motorista", "POST", "/frota/usos/trocar", `{"veiculo_id":"` + V1 + `","fechar":{}}`}, // 400
	}
	status := make([]int, 210)
	mundoteste.EmParalelo(len(status), func(i int) {
		p := pedidos[i%len(pedidos)]
		status[i] = m.Resposta(t, p.quem, p.metodo, p.caminho, p.corpo).Code
	})
	vistos := map[int]int{}
	for _, s := range status {
		vistos[s]++
	}
	// os pedidos chegaram ao banco (nada de 401/5xx) e os dois lados (passa e recusa) foram exercidos
	if vistos[200] == 0 || vistos[409] == 0 || vistos[403] == 0 || vistos[401]+vistos[500] != 0 {
		t.Fatalf("status da enxurrada = %v: esperava 200, 403 e 409 e nenhum 401/500", vistos)
	}
	if !conexoesSoltas(m) {
		t.Fatalf("depois da enxurrada: %d conexões em uso ou transação esquecida aberta", m.P.Stat().AcquiredConns())
	}
}

// Plano 03-D: isolamento. Enquanto a troca de posse está no meio (a posse velha já fechada, a nova ainda
// sendo gravada: o gatilho de atraso segura 2 s), quem lê vê o carro como estava ANTES, inteiro: a
// posse velha aberta e nenhuma nova. Nunca o meio-termo (velha fechada sem a nova).
func TestLeituraDuranteATrocaNaoVeOMeioTermo(t *testing.T) {
	m := novoMundo(t, montarUsos)
	m.Atrasar(t, "frota_uso", "insert", 2000)
	feito := make(chan int, 1)
	go func() {
		c, _ := m.Pedir(t, "motorista", "POST", "/frota/usos/trocar",
			`{"veiculo_id":"`+V1+`","fechar":{"id":"`+U1+`","volta_em":"2026-10-12T10:00:00Z"},`+
				`"abrir":{"pessoa_id":null,"pessoa_nome":"Fulano de Fora","saida_em":"2026-10-12T10:00:00Z"}}`)
		feito <- c
	}()
	// espera estar DENTRO da janela: a troca dormindo no gatilho do insert (o fechamento já rodou)
	dormindo := false
	for range 200 {
		if m.Um(t, `select count(*)::text from pg_stat_activity where datname = current_database() and wait_event = 'PgSleep'`) == "1" {
			dormindo = true
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if !dormindo {
		t.Fatal("a troca não chegou ao gatilho de atraso: o teste não está lendo no meio dela")
	}
	st, corpo := m.Pedir(t, "motorista", "GET", "/frota/usos?veiculo_id="+V1, "")
	if st != http.StatusOK || strings.Count(corpo, `"veiculo_id"`) != 1 || !strings.Contains(corpo, U1) || !strings.Contains(corpo, `"volta_em":null`) {
		t.Errorf("leitura no meio da troca = %d %s: esperava só a posse velha, ainda aberta", st, corpo)
	}
	if c := <-feito; c != http.StatusOK {
		t.Fatalf("troca = %d", c)
	}
	if v := m.Um(t, `select count(*) filter (where volta_em is null)::text || '/' || count(*)::text from frota_uso where veiculo_id = '`+V1+`'`); v != "1/2" {
		t.Errorf("depois da troca: %s, esperava 1 aberta de 2", v)
	}
}
