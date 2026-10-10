package frota

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/webpush/pushteste"
)

// Colunas de produção usadas (db/migrations/acessos/001, 004, 022, 023, 028, 045; acessos_pessoas.profile_id
// existe em produção e não aparece nas migrations — premissa conferida por ops/migracao/conferir-worker.sql).
const tabelasFrota = `
create table acessos_pessoas (id uuid primary key, nome text not null, profile_id uuid, email_corporativo text);
create table frota_veiculos (id uuid primary key, placa text not null unique, nome text not null, pessoa_id uuid,
  situacao text not null default 'ativo');
create table frota_checklist_itens (id uuid primary key default gen_random_uuid(), ordem int not null default 0,
  item text not null unique, cadencia text not null, ativo boolean not null default true);
create table frota_checklist_config (id boolean primary key default true, dia_semanal int not null default 5,
  semana_mensal int not null default 1, dia_mensal int not null default 3);
create table frota_checklist (id uuid primary key default gen_random_uuid(), veiculo_id uuid not null, feita_em date not null,
  cadencias text[] not null default '{diario}', hodometro int not null default 1, unique (veiculo_id, feita_em));
create table frota_uso (id uuid primary key default gen_random_uuid(), veiculo_id uuid not null, pessoa_id uuid, pessoa_nome text,
  saida_em timestamptz not null default now(), volta_em timestamptz, tipo text not null default 'viagem');
create table frota_requisicoes (id uuid primary key default gen_random_uuid(), veiculo_id uuid not null, pessoa_id uuid,
  pessoa_nome text, destino text, retirada_prevista timestamptz not null, situacao text not null default 'pendente',
  criada_por uuid, motivo_decisao text, encerrada_motivo text);`

const (
	uMarcus  = "eeeeeeee-0000-0000-0000-000000000001"
	uBarbara = "eeeeeeee-0000-0000-0000-000000000002"
	uRaissa  = "eeeeeeee-0000-0000-0000-000000000003"
	pMarcus  = "ffffffff-0000-0000-0000-000000000001"
	pBarbara = "ffffffff-0000-0000-0000-000000000002"
	pRaissa  = "ffffffff-0000-0000-0000-000000000003"
	pSemLog  = "ffffffff-0000-0000-0000-000000000004"
	vVolvo   = "99999999-0000-0000-0000-000000000001"
	vFiat    = "99999999-0000-0000-0000-000000000002"
	vGol     = "99999999-0000-0000-0000-000000000003"
	vDoblo   = "99999999-0000-0000-0000-000000000004"
)

// Cenário: o Volvo é do Marcus, mas está emprestado (posse aberta) com a Barbara; o Fiat é da Raissa
// (só pelo e-mail corporativo, sem o elo); o Gol já tem ficha hoje; o Doblo é de quem não tem login.
func ambienteFrota(t *testing.T) (*PushFrota, *pushteste.Servico, *pgxpool.Pool) {
	t.Helper()
	p := testebanco.Novo(t)
	ctx := context.Background()
	if _, err := p.Exec(ctx, tabelasFrota+pushteste.Tabelas); err != nil {
		t.Fatal(err)
	}
	// Os ids entram por texto (constantes do teste), em comandos separados: o pgx não aceita vários
	// comandos num pedido com parâmetros.
	for _, sql := range []string{
		`insert into profiles (id, email) values ('` + uMarcus + `', 'marcus@rbv.com'), ('` + uBarbara + `', 'barbara@rbv.com'), ('` + uRaissa + `', 'raissa@rbv.com')`,
		`insert into acessos_pessoas values ('` + pMarcus + `', 'Marcus', '` + uMarcus + `', null), ('` + pBarbara + `', 'Barbara', '` + uBarbara + `', null),
			('` + pRaissa + `', 'Raissa', null, 'Raissa@RBV.com'), ('` + pSemLog + `', 'Sem Login', null, null)`,
		`insert into frota_veiculos values ('` + vVolvo + `', 'AAA', 'Volvo', '` + pMarcus + `', 'ativo'), ('` + vFiat + `', 'BBB', 'Fiat', '` + pRaissa + `', 'ativo'),
			('` + vGol + `', 'CCC', 'Gol', '` + pMarcus + `', 'ativo'), ('` + vDoblo + `', 'DDD', 'Doblo', '` + pSemLog + `', 'ativo')`,
		`insert into frota_uso (veiculo_id, pessoa_id, tipo) values ('` + vVolvo + `', '` + pBarbara + `', 'posse')`,
		`insert into frota_checklist (veiculo_id, feita_em) values ('` + vGol + `', '2026-10-09')`,
		`insert into frota_checklist_config default values`,
		`insert into frota_checklist_itens (ordem, item, cadencia) values (1, 'pneu', 'diario'), (2, 'óleo', 'semanal'), (3, 'estepe', 'mensal')`,
	} {
		if _, err := p.Exec(ctx, sql); err != nil {
			t.Fatal(err)
		}
	}
	srv := pushteste.Novo(t)
	agora := func() time.Time { return time.Date(2026, 10, 9, 10, 30, 0, 0, time.UTC) } // sexta 07:30 em SP
	return &PushFrota{Pool: p, VAPID: pushteste.VAPID(t), HTTP: srv.HTTP, Agora: agora}, srv, p
}

func ligarAviso(t *testing.T, p *pgxpool.Pool, tipo string, usuarios ...string) {
	t.Helper()
	for _, u := range usuarios {
		if _, err := p.Exec(context.Background(), `insert into push_preferencias (user_id, tipo, ativo) values ($1::uuid, $2, true)`, u, tipo); err != nil {
			t.Fatal(err)
		}
	}
}

func TestPushFrotaAvisaQuemEstaComOCarro(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	uaBarbara := pushteste.Inscrever(t, p, "barbara", uBarbara)
	uaRaissa := pushteste.Inscrever(t, p, "raissa", uRaissa)
	pushteste.Inscrever(t, p, "marcus", uMarcus)
	ligarAviso(t, p, "frota", uMarcus, uBarbara, uRaissa)
	if err := pf.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	var b, r map[string]string
	json.Unmarshal(pushteste.Decifrar(t, srv.Ultimo(t, "barbara"), uaBarbara), &b)
	json.Unmarshal(pushteste.Decifrar(t, srv.Ultimo(t, "raissa"), uaRaissa), &r)
	if b["titulo"] != "Checklist do Volvo" || b["corpo"] != "2 itens e o hodômetro. Hoje tem a conferência da semana junto." || b["url"] != "/frota" {
		t.Fatalf("Barbara (posse do Volvo): %v", b)
	}
	if r["titulo"] != "Checklist do Fiat" {
		t.Fatalf("Raissa, achada pelo e-mail corporativo: %v", r)
	}
	// Cada aviso tem a SUA tag (por carro): vazia ou 'vendas-do-dia' (o que o service worker usa quando falta)
	// faria um reenvio SUBSTITUIR o card das vendas. title/body são as chaves que o sw-push.js lê.
	if b["tag"] != "frota-checklist-"+vVolvo || r["tag"] != "frota-checklist-"+vFiat || b["tag"] == "vendas-do-dia" {
		t.Fatalf("tag do aparelho: %q e %q", b["tag"], r["tag"])
	}
	if b["title"] != b["titulo"] || b["body"] != b["corpo"] || b["title"] == "" || b["body"] == "" {
		t.Fatalf("o service worker lê title/body: %v", b)
	}
	var chaves []string
	p.QueryRow(context.Background(), `select array_agg(chave order by chave) from envios_feitos`).Scan(&chaves)
	if len(chaves) != 2 || !strings.HasPrefix(chaves[0], "enviar-push-frota:2026-10-09:"+vVolvo+":") || !strings.HasPrefix(chaves[1], "enviar-push-frota:2026-10-09:"+vFiat+":") {
		t.Fatalf("o livro leva dia e carro: %v", chaves)
	}
	if srv.Recebidos("marcus") != 0 {
		t.Fatal("o Marcus emprestou o Volvo e o Gol já tem ficha: nada para ele")
	}
	if err := pf.Rodar(context.Background()); err != nil || srv.Total() != 2 {
		t.Fatalf("rodar de novo na mesma manhã não reenvia: err=%v total=%d", err, srv.Total())
	}
}

func TestPushFrotaFimDeSemanaENinguemLigadoNaoEnviam(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	pushteste.Inscrever(t, p, "barbara", uBarbara)
	if err := pf.Rodar(context.Background()); err != nil || srv.Total() != 0 {
		t.Fatalf("frota nasce desligado: err=%v total=%d", err, srv.Total())
	}
	ligarAviso(t, p, "frota", uBarbara)
	pf.Agora = func() time.Time { return time.Date(2026, 10, 10, 10, 30, 0, 0, time.UTC) } // sábado
	if err := pf.Rodar(context.Background()); err != nil || srv.Total() != 0 {
		t.Fatalf("sábado não pede checklist: err=%v total=%d", err, srv.Total())
	}
}

func TestPushFrotaFalhasFicamVisiveis(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	pushteste.Inscrever(t, p, "e500", uBarbara)
	ligarAviso(t, p, "frota", uBarbara)
	if err := pf.Rodar(context.Background()); err == nil || !strings.Contains(err.Error(), "nenhum_push_entregue") {
		t.Fatalf("todas as entregas recusadas = erro da tarefa: %v", err)
	}
	pf.VAPID.Assunto = "x"
	if err := pf.Rodar(context.Background()); err == nil {
		t.Fatal("VAPID inválido falha antes de tudo")
	}
	p.Exec(context.Background(), `drop table frota_uso`)
	pf.VAPID = pushteste.VAPID(t)
	if err := pf.Rodar(context.Background()); err == nil || !strings.Contains(err.Error(), "quem está com cada carro") || srv.Recebidos("e500") != 1 {
		t.Fatalf("consulta que falha não manda nada pela metade: %v", err)
	}
	if tf := pf.Tarefa(); tf.Nome != "enviar-push-frota" || tf.Agenda != "30 10 * * 1-5" {
		t.Fatalf("%+v", tf)
	}
}

// O livro tem o DIA: amanhã o mesmo carro devendo avisa de novo; no mesmo dia, nunca.
func TestPushFrotaDiaSeguinteAvisaDeNovo(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	pushteste.Inscrever(t, p, "barbara", uBarbara)
	ligarAviso(t, p, "frota", uBarbara)
	for i, dia := range []int{9, 9, 12} { // sexta, sexta de novo, segunda
		pf.Agora = func() time.Time { return time.Date(2026, 10, dia, 10, 30, 0, 0, time.UTC) }
		if err := pf.Rodar(context.Background()); err != nil {
			t.Fatal(err)
		}
		if quer := []int{1, 1, 2}[i]; srv.Total() != quer {
			t.Fatalf("rodada %d (dia %d): %d pushes, esperava %d", i, dia, srv.Total(), quer)
		}
	}
}

// Ruling 14 do plano: recusa do serviço de push (não-2xx, inclusive 5xx ambíguo) desfaz a reserva do livro; a próxima
// rodada tenta de novo. Falha de aparelho é erro da tarefa, e nada do aparelho (endpoint) vai a erro ou log.
func TestPushFrotaRecusaLiberaOLivroENaoVazaSegredo(t *testing.T) {
	var log bytes.Buffer
	anterior := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&log, nil)))
	defer slog.SetDefault(anterior)
	pf, srv, p := ambienteFrota(t)
	pushteste.Inscrever(t, p, "e500", uBarbara)
	ligarAviso(t, p, "frota", uBarbara)
	for i := 1; i <= 2; i++ {
		err := pf.Rodar(context.Background())
		if err == nil || !strings.Contains(err.Error(), "nenhum_push_entregue") {
			t.Fatalf("rodada %d: %v", i, err)
		}
		var n int
		p.QueryRow(context.Background(), `select count(*) from envios_feitos`).Scan(&n)
		if n != 0 || srv.Recebidos("e500") != i {
			t.Fatalf("rodada %d: reservas=%d, tentativas=%d (a recusa libera e a seguinte tenta)", i, n, srv.Recebidos("e500"))
		}
		for _, segredo := range []string{err.Error(), log.String()} {
			for _, proibido := range []string{"example.com/push", pf.VAPID.Privada, "e500"} {
				if strings.Contains(segredo, proibido) {
					t.Fatalf("vazou %q em %q", proibido, segredo)
				}
			}
		}
	}
}

// Sem o dono do carro nas inscrições nada sai, e o envio não segue com a lista pela metade.
func TestPushFrotaSemListaOuSemConfigNaoEnvia(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	pushteste.Inscrever(t, p, "barbara", uBarbara)
	ligarAviso(t, p, "frota", uBarbara)
	p.Exec(context.Background(), `delete from frota_checklist_config`)
	if err := pf.Rodar(context.Background()); err != nil || srv.Total() != 0 {
		t.Fatalf("sem configuração: err=%v total=%d", err, srv.Total())
	}
}
