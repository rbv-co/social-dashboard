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
	vKombi   = "99999999-0000-0000-0000-000000000005" // inativo, do Marcus
	vRodizio = "99999999-0000-0000-0000-000000000006" // rodízio: sem dono
	vStrada  = "99999999-0000-0000-0000-000000000007" // do Marcus, com uma VIAGEM aberta da Barbara (não é posse)
)

// Cenário: o Volvo é do Marcus, mas está emprestado (posse aberta) com a Barbara; o Fiat é da Raissa
// (só pelo e-mail corporativo, sem o elo); o Gol já tem ficha hoje; o Doblo é de quem não tem login; o Kombi
// é do Marcus mas está inativo; o Rodízio não tem dono; a Strada é do Marcus e a Barbara está nela só numa
// viagem (quem viaja não responde pelo checklist do carro: o aviso é do dono).
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
		`insert into frota_veiculos values ('` + vKombi + `', 'EEE', 'Kombi', '` + pMarcus + `', 'inativo'), ('` + vRodizio + `', 'FFF', 'Rodízio', null, 'ativo'),
			('` + vStrada + `', 'GGG', 'Strada', '` + pMarcus + `', 'ativo')`,
		`insert into frota_uso (veiculo_id, pessoa_id, tipo) values ('` + vVolvo + `', '` + pBarbara + `', 'posse'), ('` + vStrada + `', '` + pBarbara + `', 'viagem')`,
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
	uaMarcus := pushteste.Inscrever(t, p, "marcus", uMarcus)
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
	if len(chaves) != 3 || !strings.HasPrefix(chaves[0], "enviar-push-frota:2026-10-09:"+vVolvo+":") || !strings.HasPrefix(chaves[1], "enviar-push-frota:2026-10-09:"+vFiat+":") ||
		!strings.HasPrefix(chaves[2], "enviar-push-frota:2026-10-09:"+vStrada+":") {
		t.Fatalf("o livro leva dia e carro: %v", chaves)
	}
	// Seleção dos carros: o Volvo emprestado (posse) vai para a Barbara e não para o Marcus; o Gol já tem ficha; o
	// Kombi (inativo) e o Rodízio (sem dono) não cobram ninguém; na Strada a viagem aberta da Barbara NÃO a faz
	// responder pelo carro: o aviso é do Marcus, e a Barbara continua com um só (o do Volvo).
	var m map[string]string
	json.Unmarshal(pushteste.Decifrar(t, srv.Ultimo(t, "marcus"), uaMarcus), &m)
	if srv.Recebidos("marcus") != 1 || m["titulo"] != "Checklist do Strada" {
		t.Fatalf("Marcus: %d avisos, o último %v (só o da Strada: Volvo emprestado, Gol com ficha, Kombi inativo)", srv.Recebidos("marcus"), m)
	}
	if srv.Recebidos("barbara") != 1 || srv.Recebidos("raissa") != 1 {
		t.Fatalf("Barbara %d (só o Volvo), Raissa %d (só o Fiat)", srv.Recebidos("barbara"), srv.Recebidos("raissa"))
	}
	if err := pf.Rodar(context.Background()); err != nil || srv.Total() != 3 {
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

// Cada carro avisa uma pessoa diferente: um aparelho morto sozinho (nenhum aviso do carro entregue) fica visível
// mesmo que os outros carros tenham saído. A tarefa segue e avisa todo mundo antes de falhar.
func TestPushFrotaCarroSemNenhumaEntregaFalhaMesmoComOsOutrosEnviados(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	pushteste.Inscrever(t, p, "barbara", uBarbara)
	pushteste.Inscrever(t, p, "raissa/e500", uRaissa)
	ligarAviso(t, p, "frota", uBarbara, uRaissa)
	err := pf.Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "nenhum_push_entregue") || !strings.Contains(err.Error(), "Fiat") || strings.Contains(err.Error(), "Volvo") {
		t.Fatalf("o Fiat da Raissa ficou sem aviso e o erro tem de dizer qual carro: %v", err)
	}
	if srv.Recebidos("barbara") != 1 || srv.Recebidos("raissa/e500") != 1 {
		t.Fatalf("a Barbara foi avisada mesmo assim: %d, e a Raissa foi tentada: %d", srv.Recebidos("barbara"), srv.Recebidos("raissa/e500"))
	}
	if err := pf.Rodar(context.Background()); err == nil || srv.Recebidos("raissa/e500") != 2 || srv.Recebidos("barbara") != 1 {
		t.Fatalf("a segunda rodada tenta de novo só o Fiat e continua falhando: %v", err)
	}
}

// Vários aparelhos da MESMA pessoa: um morto entre eles é tolerado (ela recebeu). Aparelho que o serviço de push
// diz estar morto (410) é podado e não é falha: some da tabela e a tarefa não falha.
func TestPushFrotaAparelhoRuimEntreVariosOuMortoNaoDerrubaATarefa(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	pushteste.Inscrever(t, p, "barbara", uBarbara)
	pushteste.Inscrever(t, p, "barbara-2/e500", uBarbara)
	pushteste.Inscrever(t, p, "raissa/morta", uRaissa)
	ligarAviso(t, p, "frota", uBarbara, uRaissa)
	if err := pf.Rodar(context.Background()); err != nil {
		t.Fatalf("um aparelho ruim entre vários da mesma pessoa e um morto podado: %v", err)
	}
	var vivos int
	p.QueryRow(context.Background(), `select count(*) from push_subs where endpoint like '%/morta'`).Scan(&vivos)
	if srv.Recebidos("barbara") != 1 || srv.Recebidos("barbara-2/e500") != 1 || vivos != 0 {
		t.Fatalf("Barbara %d, aparelho ruim %d, mortos que sobraram %d", srv.Recebidos("barbara"), srv.Recebidos("barbara-2/e500"), vivos)
	}
}

// Sem nenhum item na lista não há checklist montado: nada sai (a edge devolvia "sem lista"), com os carros
// devendo e as pessoas ligadas.
func TestPushFrotaSemNenhumItemNaoEnvia(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	pushteste.Inscrever(t, p, "barbara", uBarbara)
	ligarAviso(t, p, "frota", uBarbara)
	p.Exec(context.Background(), `delete from frota_checklist_itens`)
	if err := pf.Rodar(context.Background()); err != nil || srv.Total() != 0 {
		t.Fatalf("sem itens: err=%v total=%d", err, srv.Total())
	}
}

// Ruling 28: o VAPID é validado ANTES de qualquer coisa (inclusive de olhar as inscrições e de reservar no livro):
// sem as chaves a tarefa falha alto mesmo quando ninguém ligou o aviso.
func TestPushFrotaVAPIDRuimFalhaAntesDeOlharInscricoesEDeReservar(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	pf.VAPID.Publica = ""
	if err := pf.Rodar(context.Background()); err == nil {
		t.Fatal("VAPID ausente com ninguém inscrito tem de falhar (não pode ficar verde calado)")
	}
	pushteste.Inscrever(t, p, "barbara", uBarbara)
	ligarAviso(t, p, "frota", uBarbara)
	if err := pf.Rodar(context.Background()); err == nil {
		t.Fatal("VAPID ausente")
	}
	var n int
	p.QueryRow(context.Background(), `select count(*) from envios_feitos`).Scan(&n)
	if n != 0 || srv.Total() != 0 {
		t.Fatalf("nada reservado nem enviado com o VAPID ruim: reservas=%d envios=%d", n, srv.Total())
	}
}

// "Hoje" é o dia de São Paulo, não o de UTC: 22:00 de sexta em SP já é sábado em UTC (cobra), e 23:00 de domingo
// em SP já é segunda em UTC (não cobra).
func TestPushFrotaHojeEDeSaoPauloNaoDeUTC(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	pushteste.Inscrever(t, p, "barbara", uBarbara)
	ligarAviso(t, p, "frota", uBarbara)
	pf.Agora = func() time.Time { return time.Date(2026, 10, 12, 2, 0, 0, 0, time.UTC) } // domingo 23:00 em SP
	if err := pf.Rodar(context.Background()); err != nil || srv.Total() != 0 {
		t.Fatalf("domingo em São Paulo não cobra: err=%v total=%d", err, srv.Total())
	}
	pf.Agora = func() time.Time { return time.Date(2026, 10, 10, 1, 0, 0, 0, time.UTC) } // sexta 22:00 em SP
	if err := pf.Rodar(context.Background()); err != nil || srv.Total() != 1 {
		t.Fatalf("sexta em São Paulo cobra: err=%v total=%d", err, srv.Total())
	}
	var chave string
	p.QueryRow(context.Background(), `select chave from envios_feitos`).Scan(&chave)
	if !strings.HasPrefix(chave, "enviar-push-frota:2026-10-09:") {
		t.Fatalf("o livro leva o dia de São Paulo: %q", chave)
	}
}

// A data da última ficha semanal/mensal não pode depender do DateStyle da sessão ('SQL, DMY' escreve 09/10/2026):
// lida errado, a semanal viraria "atrasada" e o aviso diria a conferência da semana num dia que não é.
func TestPushFrotaUltimaFichaIndependeDoDateStyle(t *testing.T) {
	pf, srv, p := ambienteFrota(t)
	ctx := context.Background()
	cfg := p.Config()
	cfg.ConnConfig.RuntimeParams["datestyle"] = "SQL, DMY"
	dmy, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer dmy.Close()
	var ds string
	dmy.QueryRow(ctx, `show datestyle`).Scan(&ds)
	if !strings.Contains(ds, "DMY") {
		t.Fatalf("a sessão do teste não pegou o DateStyle: %q", ds)
	}
	pf.Pool = dmy
	ua := pushteste.Inscrever(t, p, "barbara", uBarbara)
	ligarAviso(t, p, "frota", uBarbara)
	p.Exec(ctx, `insert into frota_checklist (veiculo_id, feita_em, cadencias) values ($1::uuid, '2026-10-09', '{diario,semanal}')`, vVolvo)
	pf.Agora = func() time.Time { return time.Date(2026, 10, 13, 10, 30, 0, 0, time.UTC) } // terça: nem dia da semanal nem do mensal
	if err := pf.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	var b map[string]string
	json.Unmarshal(pushteste.Decifrar(t, srv.Ultimo(t, "barbara"), ua), &b)
	if b["corpo"] != "1 item e o hodômetro." {
		t.Fatalf("a semanal de 4 dias atrás não está atrasada: %v", b)
	}
}
