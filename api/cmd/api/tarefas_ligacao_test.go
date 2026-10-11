package main

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/mensagens"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// capturarMontagem registra o cliente do core e o robô de mensagens que tarefas() REALMENTE montou (o
// mesmo cliente vai para todas as tarefas da Graph e do Bling; o mesmo robô vira a tarefa registrada).
func capturarMontagem(t *testing.T) (cli **core.Cliente, msg **mensagens.Mensagens) {
	t.Helper()
	var c *core.Cliente
	var m *mensagens.Mensagens
	antigo := aoMontar
	aoMontar = func(cc *core.Cliente, mm *mensagens.Mensagens) { c, m = cc, mm }
	t.Cleanup(func() { aoMontar = antigo })
	return &c, &m
}

// O worker anda no ritmo do core (600 ms por chamada à Meta, ~100/min contra o teto de 120/min) PELA fiação de
// tarefas(): trocar clienteDoCore(cfg) por core.Novo(...) lá dentro derruba as coletas no 429.
func TestTarefasMontamOClienteDoCoreComRitmo(t *testing.T) {
	cli, _ := capturarMontagem(t)
	tarefas(nil, config.Config{CoreURL: "http://core.exemplo", CoreToken: "token-inventado"}, worker.Novo(nil))
	if *cli == nil {
		t.Fatal("tarefas() não montou o cliente do core pelo gancho")
	}
	if c := *cli; c.RitmoMeta != 600*time.Millisecond || c.URL != "http://core.exemplo" || c.Token != "token-inventado" {
		t.Fatalf("cliente do core das tarefas: %+v", c)
	}
}

// A tarefa registrada de verdade (a de tarefas()) usa o cliente HTTP PADRÃO do Chatwoot, que nunca segue
// redirect: um 307 no POST do template seria repetido pelo http.DefaultClient e a cliente receberia a mensagem
// duas vezes. O Chatwoot de teste responde 307 ao envio; tem de haver UM POST e o item vira `falhou`.
func TestTarefaDeMensagensRegistradaNaoSegueRedirectNoEnvio(t *testing.T) {
	p := testebanco.Novo(t)
	ctx := context.Background()
	var mu sync.Mutex
	posts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cam := r.URL.Path
		switch {
		case r.Method == "POST" && strings.HasSuffix(cam, "/messages"):
			mu.Lock()
			posts++
			mu.Unlock()
			w.Header().Set("Location", cam+"?de=novo")
			w.WriteHeader(http.StatusTemporaryRedirect)
		case strings.Contains(cam, "/contacts/search"):
			io.WriteString(w, `{"payload":[{"id":51,"name":"Maria","phone_number":"+5511987654321"}]}`)
		case r.Method == "POST" && strings.HasSuffix(cam, "/conversations"):
			io.WriteString(w, `{"id":77}`)
		case r.Method == "GET" && strings.HasSuffix(cam, "/messages"):
			io.WriteString(w, `{"payload":[]}`)
		default:
			w.WriteHeader(404)
		}
	}))
	defer srv.Close()
	for k, v := range map[string]string{"ENVIO_MODO": "ligado", "ENVIO_MODO_INICIO": "", "ENVIO_MODO_PEDIDO": "", "ENVIO_MODO_FOLLOWUP": "",
		"CHATWOOT_URL": srv.URL, "CHATWOOT_CONTA_ID": "3", "CHATWOOT_CAIXA_ID": "9", "CHATWOOT_API_TOKEN": "token-do-chatwoot-de-teste",
		"CHATWOOT_BOT_SECRET": "segredo-do-bot-de-teste", "TEMPLATE_NOME": "abandono_v2", "TEMPLATE_TEXTO": "Oi {{1}}, seu carrinho",
		"LINK_BASE": "https://loja.exemplo/", "ENVIO_SO_PARA": "", "ENVIO_ATRASO_MINUTOS": "", "ABANDONO_TRAVA_CRUZADA": ""} {
		t.Setenv(k, v)
	}
	// Esboços das funções de produção (mesmos nomes de parâmetro) que anotam o que o robô marcou.
	for _, s := range []string{
		`create table checkout_abandono (token text primary key, telefone text, nome text, url_de_recuperacao text, status text, iniciado_em timestamptz)`,
		`create table contatos_sem_mensagem (telefone text primary key, motivo text)`,
		`create table marcadas (token text, status text, motivo text)`,
		`insert into checkout_abandono values ('t1', '(11) 98765-4321', 'MARIA SILVA', 'https://loja.exemplo/abc?key=1', 'fila_envio', '2026-10-10 14:00+00')`,
		`create function pegar_para_mensagem(p_limite integer, p_atraso_min integer, p_reservar boolean default true, p_ultimos11 text[] default null, p_max_horas integer default 24)
		   returns setof checkout_abandono language sql as 'select * from checkout_abandono where status = ''fila_envio'''`,
		`create function marcar_mensagem(p_token text, p_status text, p_motivo text default null, p_conversa bigint default null) returns void
		   language sql as 'insert into marcadas values (p_token, p_status, p_motivo)'`,
		`create function devolver_mensagem(p_token text, p_contar boolean) returns void language sql as 'insert into marcadas values (p_token, ''devolvida'', null)'`,
		`create function liberar_mensagens_travadas() returns integer language sql as 'select 0'`,
		`create function avaliar_trava_cruzada(p_telefone text, p_horas integer default 20, p_tipo text default null, p_chave text default null) returns text
		   language sql as 'select ''liberar''::text'`,
	} {
		if _, err := p.Exec(ctx, s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
	_, msg := capturarMontagem(t)
	// o relógio fica no meio da janela de envio (a regra olha a hora): só ele é trocado no robô registrado
	aoMontarAntes := aoMontar
	aoMontar = func(cc *core.Cliente, mm *mensagens.Mensagens) {
		mm.Agora = func() time.Time { return time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC) }
		aoMontarAntes(cc, mm)
	}
	ag := worker.Novo(p)
	var tarefa *worker.Tarefa
	ts := tarefas(p, config.Config{CoreURL: "http://127.0.0.1:1"}, ag)
	for i := range ts {
		if ts[i].Nome == "enviar-mensagem-abandono" {
			tarefa = &ts[i]
		}
	}
	if tarefa == nil || *msg == nil {
		t.Fatal("tarefas() não registrou o robô de mensagens")
	}
	if (*msg).HTTP != nil {
		t.Fatal("o robô registrado precisa usar o cliente padrão do Chatwoot (HTTP nil)")
	}
	tarefa.Executar(ctx) // o erro da tarefa não interessa aqui: o item `falhou` e quantos POSTs saíram
	mu.Lock()
	defer mu.Unlock()
	var status, motivo string
	p.QueryRow(ctx, `select status, motivo from marcadas where token = 't1'`).Scan(&status, &motivo)
	if posts != 1 || status != "falhou" || !strings.Contains(motivo, "enviar_template:307") {
		t.Fatalf("posts=%d, item marcado %q (%q): um 307 no envio não pode ser seguido nem contado como enviado", posts, status, motivo)
	}
}

// Configuração inválida das mensagens (FOLLOWUP_APOS_HORAS com fração, passada ligada) não derruba o boot, mas
// o worker AVISA no boot em vez de só falhar a cada rodada; passada desligada não avisa (ninguém a roda).
func TestBootAvisaConfigInvalidaDasMensagens(t *testing.T) {
	p := testebanco.Novo(t)
	for k, v := range map[string]string{"ENVIO_MODO_FOLLOWUP": "ligado", "FOLLOWUP_APOS_HORAS": "1.5"} {
		t.Setenv(k, v)
	}
	log := capturarLog(t)
	if got := rodarWorker(context.Background(), p, config.Config{}, []string{"listar"}); got != 0 {
		t.Fatalf("got=%d", got)
	}
	if !strings.Contains(log.String(), "FOLLOWUP_APOS_HORAS inválido") {
		t.Fatalf("faltou o aviso de boot: %s", log)
	}
	t.Setenv("ENVIO_MODO_FOLLOWUP", "")
	log2 := capturarLog(t)
	rodarWorker(context.Background(), p, config.Config{}, []string{"listar"})
	if strings.Contains(log2.String(), "FOLLOWUP_APOS_HORAS") {
		t.Fatalf("passada desligada não avisa: %s", log2)
	}
}
