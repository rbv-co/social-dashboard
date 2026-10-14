package main

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/web"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// esquemaCompleto monta, a partir das PRÓPRIAS listas de conferir.go, um schema que as satisfaz por
// inteiro (colunas com o tipo esperado, índices únicos, funções com parâmetros e colunas de retorno).
// tudoTexto = toda coluna nova como text (o tipo errado de propósito).
func esquemaCompleto(t *testing.T, p *pgxpool.Pool, tudoTexto bool) {
	t.Helper()
	var ddl []string
	tabelas := make([]string, 0, len(colunasDoWorker))
	for tb := range colunasDoWorker {
		tabelas = append(tabelas, tb)
	}
	sort.Strings(tabelas)
	for _, tb := range tabelas {
		ddl = append(ddl, "create table if not exists "+tb+" ()")
		for _, c := range strings.Split(colunasDoWorker[tb], ",") {
			tipo := "text"
			if e := tiposDoWorker[tb+"."+c]; e != "" && !tudoTexto {
				tipo, _, _ = strings.Cut(e, "|")
			}
			ddl = append(ddl, fmt.Sprintf("alter table %s add column if not exists %s %s", tb, c, tipo))
		}
	}
	for i, u := range unicosDoWorker {
		tb, cols, _ := strings.Cut(strings.TrimSuffix(u, ")"), "(")
		ddl = append(ddl, fmt.Sprintf("create unique index u_%d on %s (%s)", i, tb, cols))
	}
	for i, u := range deduplicadoresDoWorker {
		tb, cols, _ := strings.Cut(strings.TrimSuffix(u, ")"), "(")
		ddl = append(ddl, fmt.Sprintf("create unique index d_%d on %s (%s) where %s is not null", i, tb, cols, cols))
	}
	for _, item := range append(slices.Clone(funcoesDoWorker), funcoesPorNomeDoWorker...) {
		nome, resto, temSig := strings.Cut(item, "(")
		var tipos []string
		if temSig {
			if tp := strings.TrimSuffix(resto, ")"); tp != "" {
				tipos = strings.Split(tp, ",")
			}
		} else {
			tipos = make([]string, len(parametrosDasFuncoes[nome]))
			for i := range tipos {
				tipos[i] = "text"
			}
		}
		var args []string
		for i, tp := range tipos {
			nm := fmt.Sprintf("p_x%d", i)
			if i < len(parametrosDasFuncoes[nome]) {
				nm = parametrosDasFuncoes[nome][i]
			}
			args = append(args, nm+" "+tp)
		}
		retorno, corpo := "returns integer", "begin return 0; end"
		if cols := retornoDasFuncoes[nome]; len(cols) > 0 {
			var cs []string
			for _, c := range cols {
				cs = append(cs, c+" text")
			}
			retorno, corpo = "returns table("+strings.Join(cs, ", ")+")", "begin return; end"
		}
		ddl = append(ddl, fmt.Sprintf("create function %s(%s) %s language plpgsql as $f$ %s $f$", nome, strings.Join(args, ", "), retorno, corpo))
	}
	// As funções de web.FuncoesRPC que as listas acima não criam (as do 5.2), pela PRÓPRIA declaração: Opcional =
	// DEFAULT null; o retorno segue rpc.Retorno (Plano 5.9). conferirRPC do conferirSchema as confere.
	criadas := map[string]bool{}
	for _, item := range append(slices.Clone(funcoesDoWorker), funcoesPorNomeDoWorker...) {
		criadas[nomeDaFuncao(item)] = true
	}
	for _, f := range web.FuncoesRPC {
		if criadas[f.Nome] {
			continue
		}
		var args []string
		for _, pr := range f.Params {
			args = append(args, pr.Nome+" "+pr.Tipo+map[bool]string{true: " default null"}[pr.Opcional])
		}
		retorno := map[rpc.Retorno]string{rpc.Valor: "integer", rpc.Conjunto: "setof integer", rpc.Nada: "void"}[f.Retorno]
		ddl = append(ddl, fmt.Sprintf("create function %s(%s) returns %s language sql as $f$ select null::integer $f$",
			f.Nome, strings.Join(args, ", "), retorno))
	}
	ddl = append(ddl, `create function trg_vazio() returns trigger language plpgsql as $f$ begin return new; end $f$`)
	for _, g := range gatilhosDoWorker {
		// a tabela do gatilho (5.11: as de atendimentos não estão em nenhuma outra lista do fixture)
		ddl = append(ddl, fmt.Sprintf("create table if not exists %s (id integer)", g[1]))
		ddl = append(ddl, fmt.Sprintf("create trigger %s before update on %s for each row execute function trg_vazio()", g[0], g[1]))
	}
	for _, s := range ddl {
		if _, err := p.Exec(context.Background(), s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
}

func exec(t *testing.T, p *pgxpool.Pool, sqls ...string) {
	t.Helper()
	for _, s := range sqls {
		if _, err := p.Exec(context.Background(), s); err != nil {
			t.Fatalf("%s: %v", s, err)
		}
	}
}

func faltamDe(t *testing.T, p *pgxpool.Pool) []string {
	t.Helper()
	f, err := conferirSchema(context.Background(), p)
	if err != nil {
		t.Fatal(err)
	}
	return f
}

// O caminho feliz: um schema que satisfaz TODAS as listas confere (saída 0, "schema confere"). Também prova que
// índice com colunas FORA de ordem alfabética (campaign_insights(campaign_id,account_id,...)) casa: sem o
// sort do alvo, a conferência acusaria um índice que existe.
func TestConferirSchemaCompletoConfere(t *testing.T) {
	p := testebanco.Novo(t)
	esquemaCompleto(t, p, false)
	if f := faltamDe(t, p); len(f) > 0 {
		t.Fatalf("schema completo não devia ter pendência:\n%s", strings.Join(f, "\n"))
	}
	var codigo int
	saida := saidaDe(t, func() {
		codigo = rodarWorker(context.Background(), p, config.Config{TarefasDesligadas: []string{"nome-que-nao-existe"}}, []string{"conferir"})
	})
	if codigo != 0 || !strings.Contains(saida, "schema confere") {
		t.Fatalf("codigo=%d saida=%q (conferir não valida desligadas nem exige nada além do schema)", codigo, saida)
	}
}

func TestConferirSchemaVazioListaEmOrdem(t *testing.T) {
	p := testebanco.Novo(t)
	faltam := faltamDe(t, p)
	if !slices.IsSorted(faltam) || len(faltam) < 50 {
		t.Fatalf("a lista tem de sair ordenada (%d itens)", len(faltam))
	}
	tem := func(item string) bool { return slices.Contains(faltam, item) }
	for _, quer := range []string{"coluna campaigns.objective", "único campaigns(campaign_id)", "função pegar_da_fila(text,integer,integer,boolean,text[])",
		"coluna accounts.id", "coluna bling_pedido_nota.nota_situacao", "coluna bling_pedido_ajuste_valor.pedido_id", "coluna bling_pedido_vendedor.pedido_id",
		"coluna bling_lojas.loja_id", "coluna frota_uso.saida_em", "coluna frota_uso.id", "função registrar_checkout_abandono",
		"coluna equipes_permissoes.chave", "coluna entradas_como_outro_usuario.admin_id", "coluna entradas_como_outro_usuario.criado_em", "coluna equipes.deposito_id",
		"coluna access_requests.status", "coluna acessos_perfis.permissions", "coluna canais_grupos_membros.concedido_por", "coluna push_preferencias.alterado_por",
		"único push_subs(endpoint)", "único push_preferencias(user_id,tipo)", "função guard_profiles()", "função equipes_toca_atualizado()", "função impedir_autopromocao()", "função espelhar_rename_do_grupo()", "função espelhar_grupo_do_canal()", "único acessos_perfis(nome)", // Plano 5.1
		"gatilho equipes_atualizado em equipes (ausente ou desabilitado)", "gatilho trg_espelhar_grupo_do_canal em bling_lojas (ausente ou desabilitado)",
		"gatilho trg_espelhar_rename_do_grupo em canais_grupos (ausente ou desabilitado)", "gatilho trg_guard_profiles em profiles (ausente ou desabilitado)",
		"gatilho trg_impedir_autopromocao em profiles (ausente ou desabilitado)",
		"único chatwoot_eventos(conversation_id,tipo)", "único (dedupe do on conflict do nothing) carrinho_eventos(evento_shopify_id)",
		"coluna noticias_concorrentes.rodada", "coluna noticias_panorama.rodada", "coluna ia_execucoes.run_at", "coluna robos_saude.critico"} {
		if !tem(quer) {
			t.Errorf("faltou acusar %q", quer)
		}
	}
	for _, nao := range []string{"coluna robos_execucoes.conferido_em", "coluna profiles.features", "coluna profiles.precisa_trocar_senha", "coluna profiles.allowed_accounts"} {
		if tem(nao) { // a tabela existe no banco de teste (legado)
			t.Errorf("acusou o que existe: %q", nao)
		}
	}
	var codigo int
	saidaDe(t, func() { codigo = rodarWorker(context.Background(), p, config.Config{}, []string{"conferir"}) })
	if codigo != 1 {
		t.Fatalf("schema incompleto = saída 1: %d", codigo)
	}
}

// robos_saude é uma VISÃO em produção (relkind 'v'): a conferência de colunas a enxerga, e acusa a
// que falta nela (não olha só tabelas).
func TestConferirEnxergaAVisaoRobosSaude(t *testing.T) {
	p := testebanco.Novo(t)
	esquemaCompleto(t, p, false)
	exec(t, p, `alter table robos_saude rename to robos_saude_base`,
		`create view robos_saude as select robo, critico from robos_saude_base`)
	if f := faltamDe(t, p); len(f) > 0 {
		t.Fatalf("a visão com robo e critico devia conferir:\n%s", strings.Join(f, "\n"))
	}
	exec(t, p, `drop view robos_saude`, `create view robos_saude as select robo from robos_saude_base`)
	if f := faltamDe(t, p); !slices.Equal(f, []string{"coluna robos_saude.critico"}) {
		t.Fatalf("visão sem critico: %v", f)
	}
}

// Toda coluna como text: tipo errado em tudo. Tem de sair 1 e dizer esperado × achado.
func TestConferirSchemaTudoTextoFalhaPeloTipo(t *testing.T) {
	p := testebanco.Novo(t)
	esquemaCompleto(t, p, true)
	faltam := faltamDe(t, p)
	for _, quer := range []string{"tipo accounts.id: esperado uuid, achado text", "tipo daily_snapshots.account_id: esperado uuid, achado text",
		"tipo bling_pedido_vendedor.pedido_id: esperado bigint|integer, achado text", "tipo bling_pedido_nota.nota_situacao: esperado smallint|integer, achado text",
		"tipo daily_snapshots.captured_at: esperado date, achado text", "tipo frota_checklist.cadencias: esperado text[], achado text",
		"tipo noticias_concorrentes.rodada: esperado date, achado text", "tipo noticias_panorama.rodada: esperado date, achado text"} {
		if !slices.Contains(faltam, quer) {
			t.Errorf("faltou acusar %q", quer)
		}
	}
	var codigo int
	saida := saidaDe(t, func() { codigo = rodarWorker(context.Background(), p, config.Config{}, []string{"conferir"}) })
	if codigo != 1 || !strings.Contains(saida, "esperado uuid, achado text") {
		t.Fatalf("codigo=%d", codigo)
	}
	for _, f := range faltam { // com tudo texto, só tipo (e a nulidade) pode estar errado: nada de coluna, índice ou função faltando
		if strings.HasPrefix(f, "coluna ") && !strings.Contains(f, "aceitar nulo") || strings.HasPrefix(f, "único") || strings.HasPrefix(f, "função") {
			t.Errorf("o schema só erra tipo, mas saiu %q", f)
		}
	}
}

func TestConferirSchemaNuloEBaseTextoVarchar(t *testing.T) {
	p := testebanco.Novo(t)
	esquemaCompleto(t, p, false)
	exec(t, p, `alter table carrinho_eventos alter column cart_token set not null`, `alter table ads alter column ad_id type varchar(40)`)
	faltam := faltamDe(t, p)
	if !slices.Contains(faltam, "coluna carrinho_eventos.cart_token deve aceitar nulo (NOT NULL achado)") {
		t.Errorf("cart_token NOT NULL não foi acusado: %v", faltam)
	}
	for _, f := range faltam {
		if strings.Contains(f, "ads.ad_id") {
			t.Errorf("varchar vale como text: %q", f)
		}
	}
}

// O que cada filtro do índice único protege (cada caso mata uma mutação da consulta).
func TestConferirSchemaIndicesUnicos(t *testing.T) {
	p := testebanco.Novo(t)
	exec(t, p,
		// não é único (mutação: tirar indisunique)
		`create table campaigns (campaign_id text, account_id uuid, name text)`, `create index on campaigns (campaign_id)`,
		// INCLUDE não é chave (falso alarme reproduzido: 'único ads(ad_id)')
		`create table ads (ad_id text, name text)`, `create unique index on ads (ad_id) include (name)`,
		// índice de expressão (mutação: tirar indexprs is null)
		`create table campaign_adsets (adset_id text, name text)`, `create unique index on campaign_adsets (adset_id, lower(name))`,
		// deferrable: o ON CONFLICT recusa (mutação: tirar indimmediate)
		`create table conteudo_metricas (peca_id uuid, capturado_em date, unique (peca_id, capturado_em) deferrable initially deferred)`,
		// colunas FORA de ordem alfabética (mutação: tirar o sort do alvo)
		`create table conteudo_casamentos (peca_id uuid, ig_media_id text)`, `create unique index on conteudo_casamentos (peca_id, ig_media_id)`,
		// parcial: ON CONFLICT (colunas) não infere
		`create table daily_snapshots (account_id uuid, captured_at date, followers_count int)`,
		`create unique index on daily_snapshots (account_id, captured_at) where followers_count > 0`,
		// parcial serve ao dedupe de `on conflict do nothing`
		`create table carrinho_eventos (tipo text, cart_token text, evento_shopify_id text)`,
		`create unique index on carrinho_eventos (evento_shopify_id) where evento_shopify_id is not null`,
		// índice inválido (mutação: tirar indisvalid)
		`create table ad_insights_hora (ad_id text, account_id uuid, dia date, hora int)`, `create unique index iah on ad_insights_hora (ad_id, account_id, dia, hora)`,
		`update pg_index set indisvalid = false where indexrelid = 'iah'::regclass`,
		// chave a mais que o alvo não serve (alvo: 1 coluna; índice: 2)
		`create table perfil_visitas_hora (account_id uuid, dia date, hora int)`, `create unique index on perfil_visitas_hora (account_id, dia, hora, dia)`,
	)
	faltam := faltamDe(t, p)
	acusa := func(u string) bool { return slices.Contains(faltam, "único "+u) }
	for _, u := range []string{"campaigns(campaign_id)", "campaign_adsets(adset_id)", "conteudo_metricas(peca_id,capturado_em)",
		"daily_snapshots(account_id,captured_at)", "ad_insights_hora(ad_id,account_id,dia,hora)"} {
		if !acusa(u) {
			t.Errorf("devia acusar único %s", u)
		}
	}
	for _, u := range []string{"ads(ad_id)", "conteudo_casamentos(peca_id,ig_media_id)"} {
		if acusa(u) {
			t.Errorf("acusou índice que serve: %s", u)
		}
	}
	if slices.Contains(faltam, "único (dedupe do on conflict do nothing) carrinho_eventos(evento_shopify_id)") {
		t.Error("índice parcial serve ao dedupe do `on conflict do nothing`")
	}
}

func TestConferirSchemaFuncoes(t *testing.T) {
	p := testebanco.Novo(t)
	exec(t, p,
		// parâmetro com outro nome (o código chama p_limite => ...) e coluna de retorno faltando
		`create function pegar_da_fila(p_tipo text, p_limit integer, p_max_horas integer, p_reservar boolean, p_ultimos11 text[])
		   returns table (chave text, numero text) language sql as 'select null::text, null::text where false'`,
		// retorno por tipo composto: as colunas são as da tabela (falta iniciado_em)
		`create table checkout_abandono (token text, telefone text, nome text, url_de_recuperacao text, status text)`,
		`create function pegar_para_mensagem(p_limite integer, p_atraso_min integer, p_reservar boolean, p_ultimos11 text[], p_max_horas integer)
		   returns setof checkout_abandono language sql as 'select * from checkout_abandono'`,
		// sobrecarga: basta UMA com os parâmetros que o código passa
		`create function marcar_checkout_comprou(p_token text) returns void language sql as 'select'`,
		`create function marcar_checkout_comprou(p_token text, p_email text, p_telefone text) returns void language sql as 'select'`,
		// composto completo
		`create table conteudo_pecas (id uuid, account_id uuid, titulo text, formato text, publicar_em timestamptz, responsavel uuid, avisado_em timestamptz)`,
		`create function conteudo_reivindicar_hora_h() returns setof conteudo_pecas language sql as 'select * from conteudo_pecas'`,
	)
	faltam := faltamDe(t, p)
	tem := func(s string) bool { return slices.Contains(faltam, s) }
	for _, quer := range []string{
		"função pegar_da_fila(text,integer,integer,boolean,text[]) sem o parâmetro p_limite",
		"função pegar_da_fila(text,integer,integer,boolean,text[]) não devolve a coluna conversa_origem",
		"função pegar_para_mensagem(integer,integer,boolean,text[],integer) não devolve a coluna iniciado_em",
	} {
		if !tem(quer) {
			t.Errorf("faltou acusar %q em %v", quer, faltam)
		}
	}
	// pegar_da_fila existe só com o nome do parâmetro errado: a função em si NÃO falta
	if tem("função pegar_da_fila(text,integer,integer,boolean,text[])") {
		t.Error("a função existe: não é 'falta'")
	}
	for _, f := range faltam {
		if strings.Contains(f, "marcar_checkout_comprou") || strings.Contains(f, "conteudo_reivindicar_hora_h") {
			t.Errorf("acusou o que está certo: %q", f)
		}
	}
	if tem("função pegar_para_mensagem(integer,integer,boolean,text[],integer) sem o parâmetro p_limite") {
		t.Error("parâmetros de pegar_para_mensagem estão certos")
	}
}

// `api worker conferir` roda SÓ o schema: se `api migrar` não rodou, diz isso numa linha e segue conferindo o resto
// (nada de recusar antes de listar, nem aviso de VAPID).
func TestConferirSemMigrarDizEmUmaLinhaESegue(t *testing.T) {
	p := testebanco.Novo(t)
	exec(t, p, `drop table envios_feitos`)
	log := capturarLog(t)
	var codigo int
	saida := saidaDe(t, func() { codigo = rodarWorker(context.Background(), p, config.Config{}, []string{"conferir"}) })
	if codigo != 1 {
		t.Fatalf("codigo=%d", codigo)
	}
	var linhasMigrar int
	for _, l := range strings.Split(saida, "\n") {
		if strings.HasPrefix(l, "migrações:") {
			linhasMigrar++
			if !strings.Contains(l, "`api migrar`") || !strings.Contains(l, "envios_feitos") {
				t.Errorf("linha da migração: %q", l)
			}
		}
	}
	if linhasMigrar != 1 || !strings.Contains(saida, "coluna accounts.id") {
		t.Fatalf("uma linha sobre `api migrar` e o resto conferido: %q", saida)
	}
	if strings.Contains(log.String(), "VAPID") || strings.Contains(log.String(), "sem as tabelas") {
		t.Fatalf("conferir não avisa VAPID nem recusa por tabela: %s", log)
	}
}

// Erro de conexão não pode imprimir endereço, usuário nem URL do banco.
func TestConferirBancoForaDoArNaoMostraOEndereco(t *testing.T) {
	p := testebanco.Novo(t)
	p.Close()
	var codigo int
	saida := saidaDe(t, func() { codigo = rodarWorker(context.Background(), p, config.Config{}, []string{"conferir"}) })
	if codigo != 1 || strings.Contains(saida, "postgres") || strings.Contains(saida, "localhost") || strings.Contains(saida, "58813") || strings.Contains(saida, "host=") {
		t.Fatalf("codigo=%d saida=%q", codigo, saida)
	}
}

// ---- nomes × robos_esperados ----

// robosEsperadosDasMigracoes lê as linhas que as migrations do repositório inserem em robos_esperados: as do
// Supabase (db/migrations) e as do goose do próprio api (internal/banco/migracoes, só o trecho Up), menos as
// que o goose apaga (`delete from robos_esperados where robo = '...'`). O banco restaurado pode ter mais: as
// notas mandam comparar `select robo from robos_esperados` no ensaio.
func robosEsperadosDasMigracoes(t *testing.T) []string {
	t.Helper()
	arqs, err := filepath.Glob(filepath.Join("..", "..", "..", "db", "migrations", "*.sql"))
	if err != nil || len(arqs) == 0 {
		t.Fatalf("migrations não encontradas em db/migrations: %v", err)
	}
	goose, err := filepath.Glob(filepath.Join("..", "..", "internal", "banco", "migracoes", "*.sql"))
	if err != nil || len(goose) == 0 {
		t.Fatalf("migrations do goose não encontradas: %v", err)
	}
	reTupla := regexp.MustCompile(`\(\s*'([a-z0-9][a-z0-9-]*)'\s*,\s*\d+\s*,\s*(?:true|false)`)
	reInsert := regexp.MustCompile(`insert into (?:public\.)?robos_esperados`)
	reApaga := regexp.MustCompile(`delete from (?:public\.)?robos_esperados where robo = '([a-z0-9][a-z0-9-]*)'`)
	var nomes, apagados []string
	for _, a := range append(arqs, goose...) { // o goose por último: o que ele apaga já foi inserido antes
		b, err := os.ReadFile(a)
		if err != nil {
			t.Fatal(err)
		}
		s := string(b)
		if i := strings.Index(s, "-- +goose Down"); i >= 0 {
			s = s[:i]
		}
		for _, m := range reApaga.FindAllStringSubmatch(s, -1) {
			apagados = append(apagados, m[1])
		}
		for {
			loc := reInsert.FindStringIndex(s)
			if loc == nil {
				break
			}
			s = s[loc[0]:]
			fim, aspas := len(s), false // o comando acaba no ';' fora de aspas simples
			for j := 0; j < len(s); j++ {
				if s[j] == '\'' {
					aspas = !aspas
				} else if s[j] == ';' && !aspas {
					fim = j
					break
				}
			}
			for _, m := range reTupla.FindAllStringSubmatch(s[:fim], -1) {
				if !slices.Contains(nomes, m[1]) {
					nomes = append(nomes, m[1])
				}
			}
			s = s[fim:]
		}
	}
	return slices.DeleteFunc(nomes, func(n string) bool { return slices.Contains(apagados, n) })
}

// donoNaTela é a regra da view robos_saude (migration 2026-09-22-vigia-dos-robos-cada-um-no-seu-teto.sql): a
// execução pertence ao robô esperado de prefixo MAIS LONGO que a alcança.
func donoNaTela(esperados []string, robo string) string {
	melhor := ""
	for _, e := range esperados {
		if strings.HasPrefix(robo, e) && len(e) > len(melhor) {
			melhor = e
		}
	}
	return melhor
}

// Os nomes que a tela "saúde dos robôs" enxerga: um nome trocado faz o robô sumir da tela ou cair no teto do
// vizinho (meta-hora dentro de coletar-dados: alarme falso). A lista de robos_esperados sai das migrations e
// o nome por conta sai do código de verdade (coletar-dados-07h roda contra um core fora do ar e a linha da conta
// é lida de robos_execucoes).
func TestNomesCasamComRobosEsperados(t *testing.T) {
	esperados := robosEsperadosDasMigracoes(t)
	for _, deve := range []string{"coletar-dados", "meta-hora", "meta-hora-retentativa-00h", "enviar-push-vendas", "enviar-push-saldo", "guardar-copia-do-banco",
		"enviar-mensagem-abandono", "vessel-triagem-da-vaga",
		"enviar-push-frota", "fabrica-purga", "vessel-rd-station", "abandono-de-checkout", "conferir-robos", "faxina-da-api"} {
		if !slices.Contains(esperados, deve) {
			t.Fatalf("o leitor das migrations não achou %q (achou %v)", deve, esperados)
		}
	}
	if slices.Contains(esperados, "estoque-do-site") { // o Core é o único escritor: a ficha crítica ficaria vermelha para sempre
		t.Fatal("estoque-do-site não pode ter ficha (a migration 00004 a apaga)")
	}
	// destino de cada tarefa de produção pelo prefixo mais longo; toda tarefa tem ficha (robô sem ficha não é cobrado)
	quer := map[string]string{
		"meta-hora": "meta-hora", "meta-hora-retentativa-00h": "meta-hora-retentativa-00h",
		"enviar-push-saldo-08h": "enviar-push-saldo", "enviar-push-vendas-07h": "enviar-push-vendas", "enviar-push-vendas-22h": "enviar-push-vendas",
		"auditar-dados": "auditar-dados", "conteudo-hora-h": "conteudo-hora-h",
		"conteudo-espelho": "conteudo-espelho", "enviar-relatorio-hora": "enviar-relatorio-hora", "enviar-mensagem-abandono": "enviar-mensagem-abandono",
		// fichas que a migration 00004 do goose cadastra (antes só existiam por acaso no banco real)
		"enviar-push-frota": "enviar-push-frota", "conferir-robos": "conferir-robos", "faxina-da-api": "faxina-da-api",
		"abandono-de-checkout": "abandono-de-checkout", "vessel-rd-station": "vessel-rd-station", "fabrica-purga": "fabrica-purga",
		"coletar-dados-07h": "coletar-dados", "coletar-dados-12h": "coletar-dados", "coletar-dados-18h": "coletar-dados", "coletar-dados-2359": "coletar-dados",
	}
	p := testebanco.Novo(t)
	ag := worker.Novo(p)
	ts := tarefas(p, config.Config{CoreURL: "http://127.0.0.1:1", CoreToken: "token-so-do-teste"}, ag)
	for _, tf := range ts { // toda tarefa registrada tem destino conferido, e o nome casa
		e, ok := quer[tf.Nome]
		if !ok {
			t.Errorf("tarefa %q sem destino conferido na tela de saúde", tf.Nome)
			continue
		}
		if got := donoNaTela(esperados, tf.Nome); got == "" || got != e {
			t.Errorf("%q cai em %q, esperava %q", tf.Nome, got, e)
		}
	}
	if len(ts) != len(quer) {
		t.Errorf("tarefas = %d, destinos conferidos = %d", len(ts), len(quer))
	}
	// o nome por conta, vindo do código de coletar-dados
	exec(t, p, `create table accounts (id uuid primary key default gen_random_uuid(), name text, instagram_id text, ad_account_id text, access_token text)`,
		`insert into accounts (name, instagram_id, ad_account_id, access_token) values ('Mantova Móveis', '1784', 'act_9', 'tk'), ('Vessel', '1785', 'act_8', 'tk')`)
	for _, tf := range ts {
		if tf.Nome != "coletar-dados-07h" {
			continue
		}
		// Executar direto, sem o ag.Rodar: o Rodar toma a trava do `coletar-dados` e os advisory locks são por
		// BANCO (não por schema), então outro pacote rodando em paralelo contra o mesmo servidor a disputaria.
		saidaDe(t, func() { tf.Executar(context.Background()) })
	}
	linhas, err := p.Query(context.Background(), `select robo from robos_execucoes where robo like 'coletar-dados-07h%' order by robo`)
	if err != nil {
		t.Fatal(err)
	}
	var robos []string
	for linhas.Next() {
		var r string
		linhas.Scan(&r)
		robos = append(robos, r)
	}
	linhas.Close()
	if !slices.Equal(robos, []string{"coletar-dados-07h · Mantova Móveis", "coletar-dados-07h · Vessel"}) {
		t.Fatalf("linhas por conta gravadas pelo código: %q", robos)
	}
	for _, r := range robos {
		if got := donoNaTela(esperados, r); got != "coletar-dados" {
			t.Errorf("%q cai em %q, esperava coletar-dados", r, got)
		}
	}
}

// Plano 5.1: gatilho ausente, na tabela errada ou desabilitado é acusado (a função sozinha existir não basta).
func TestConferirGatilhosDoPlano51(t *testing.T) {
	p := testebanco.Novo(t)
	esquemaCompleto(t, p, false)
	exec(t, p, `alter table profiles disable trigger trg_guard_profiles`, `drop trigger equipes_atualizado on equipes`,
		`drop trigger trg_espelhar_rename_do_grupo on canais_grupos`,
		`create trigger trg_espelhar_rename_do_grupo before update on canais_grupos_membros for each row execute function trg_vazio()`)
	var gatilhos []string
	for _, f := range faltamDe(t, p) {
		if strings.HasPrefix(f, "gatilho ") {
			gatilhos = append(gatilhos, f)
		} else {
			t.Errorf("só gatilho devia faltar: %q", f)
		}
	}
	quer := []string{"gatilho equipes_atualizado em equipes (ausente ou desabilitado)", "gatilho trg_espelhar_rename_do_grupo em canais_grupos (ausente ou desabilitado)",
		"gatilho trg_guard_profiles em profiles (ausente ou desabilitado)"}
	if !slices.Equal(gatilhos, quer) {
		t.Fatalf("gatilhos acusados: %v", gatilhos)
	}
}

// Plano 5.1: contra a fatia D0 do esquema de produção, NADA das tabelas, funções e gatilhos do 5.1 é acusado
// (pega erro de digitação nas listas do conferir). O que é de outros planos fica de fora do filtro.
func TestConferirNaFatiaD0NaoAcusaOPlano51(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	tabelas51 := []string{"profiles", "equipes", "equipes_membros", "equipes_permissoes", "canais_grupos", "canais_grupos_membros",
		"bling_lojas", "acessos_perfis", "access_requests", "push_subs", "push_preferencias", "data_integrity_checks"}
	funcoes51 := []string{"guard_profiles", "impedir_autopromocao", "espelhar_rename_do_grupo", "espelhar_grupo_do_canal", "equipes_toca_atualizado"}
	do51 := func(f string) bool {
		if strings.HasPrefix(f, "gatilho ") {
			return true
		}
		for _, fn := range funcoes51 {
			if strings.HasPrefix(f, "função "+fn+"(") {
				return true
			}
		}
		for _, tb := range tabelas51 {
			if strings.Contains(f, " "+tb+".") || strings.Contains(f, " "+tb+"(") {
				return true
			}
		}
		return false
	}
	faltam := faltamDe(t, p)
	if len(faltam) == 0 {
		t.Fatal("a fatia D0 não tem o esquema todo: devia sobrar item de outros planos (o filtro não provaria nada)")
	}
	for _, f := range faltam {
		if do51(f) {
			t.Errorf("a fatia D0 devia satisfazer o 5.1, mas o conferir acusa %q", f)
		}
	}
}

// Plano 5.7 (Ruling 5.7-16): account_id das gt_* e da social_metas é TEXTO. O init só completa com uuid o que
// a lista não declara: se sobrescrevesse, a conferência acusaria falso no banco restaurado.
func TestContaEmTextoNaoViraUUID(t *testing.T) {
	for _, k := range []string{"gt_fila_decisoes.account_id", "gt_budget_analises.account_id", "gt_ad_analises.account_id",
		"gt_campanhas_rascunho.account_id", "gt_problemas_meta.account_id", "fabrica_marcas.account_id", "social_metas.account_id"} {
		if tiposDoWorker[k] != "text" {
			t.Errorf("tiposDoWorker[%q] = %q, esperava text", k, tiposDoWorker[k])
		}
	}
	if tiposDoWorker["campaigns.account_id"] != "uuid" {
		t.Errorf("campaigns.account_id = %q: o init deixou de completar com uuid o que não é declarado", tiposDoWorker["campaigns.account_id"])
	}
}

// Plano 5.7: contra a fatia D0 (as 10 tabelas + fabrica_marcas, os únicos e gt_registrar_problemas), o conferir
// não acusa nada do 5.7 — pega erro de digitação nas listas. Os presumidos (impactos, limiares_resultado) estão
// na fatia como jsonb; no banco restaurado quem confere é o `api worker conferir`.
func TestConferirNaFatiaD0NaoAcusaOPlano57(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	tabelas57 := []string{"gt_config_metricas", "gt_objetivo_interacao", "gt_ponderada_config", "gt_ponderada_config_log",
		"gt_budget_analises", "gt_ad_analises", "gt_fila_decisoes", "gt_campanhas_rascunho", "gt_problemas_meta",
		"fabrica_marcas", "interesses_sugeridos"}
	for _, f := range faltamDe(t, p) {
		if strings.Contains(f, "gt_registrar_problemas") {
			t.Errorf("a fatia D0 devia satisfazer o 5.7, mas o conferir acusa %q", f)
		}
		for _, tb := range tabelas57 {
			if strings.Contains(f, " "+tb+".") || strings.Contains(f, " "+tb+"(") {
				t.Errorf("a fatia D0 devia satisfazer o 5.7, mas o conferir acusa %q", f)
			}
		}
	}
}

// do52: o que o `conferir` acusa que é do 5.2 (as tabelas, os únicos, as funções-gatilho do bem, os gatilhos
// e as RPCs). O resto da fatia D0 é de outros planos.
func do52(f string) bool {
	if strings.HasPrefix(f, "gatilho ") || strings.HasPrefix(f, "rpc ") || strings.Contains(f, "patrimonio_") {
		return true
	}
	for _, c := range []string{" acessos_setores.", " acessos_pessoas.", " frota_veiculos.", " equipes.local_id", "função bem_de_veiculo_segue_a_frota("} {
		if strings.Contains(f, c) {
			return true
		}
	}
	return false
}

// Plano 5.2: contra a fatia D0 NADA do 5.2 é acusado (pega erro de digitação nas listas do conferir) e as 5
// RPCs de web.FuncoesRPC batem com o pg_proc da D0 (Ruling do ledger, menor M3 da Task 9: só este teste pega
// declaração de RPC errada, porque o mundo do pacote patrimonio monta a lista, não a confere).
func TestConferirNaFatiaD0NaoAcusaOPlano52(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	faltam := faltamDe(t, p)
	if len(faltam) == 0 {
		t.Fatal("a fatia D0 não tem o esquema todo: devia sobrar item de outros planos (o filtro não provaria nada)")
	}
	for _, f := range faltam {
		if do52(f) {
			t.Errorf("a fatia D0 devia satisfazer o 5.2, mas o conferir acusa %q", f)
		}
	}
	for _, c := range []string{"patrimonio_bens.", "patrimonio_posse.", "patrimonio_config(", "trg_patrimonio_espelha_situacao"} { // o que o 5.2 presume está LISTADO
		achou := false
		for _, l := range []map[string]string{colunasDoWorker, tiposDoWorker} {
			for k := range l {
				achou = achou || strings.HasPrefix(k, c)
			}
		}
		for _, l := range [][]string{unicosDoWorker, funcoesDoWorker} {
			achou = achou || slices.ContainsFunc(l, func(k string) bool { return strings.HasPrefix(k, c) })
		}
		achou = achou || slices.ContainsFunc(gatilhosDoWorker, func(g [2]string) bool { return g[0] == c })
		if !achou {
			t.Errorf("o conferir não lista %q (o 5.2 o presume)", c)
		}
	}
	nomes := map[string]bool{}
	for _, f := range web.FuncoesRPC {
		nomes[f.Nome] = true
	}
	for _, n := range []string{"criar_pessoa_rapida", "criar_setor_rapido", "pessoas_para_escolher", "setores_para_escolher", "sincronizar_carro_e_bem"} {
		if !nomes[n] {
			t.Errorf("web.FuncoesRPC não tem %s", n)
		}
	}
	emTx(t, p, func(tx pgx.Tx) {
		papelAuthenticated(t, p)
		if f, err := conferirRPC(context.Background(), tx, web.FuncoesRPC); err != nil || len(f) != 0 {
			t.Errorf("web.FuncoesRPC contra o pg_proc da D0: %v %v", f, err)
		}
	})
}

// Plano 5.2: o conferir ACUSA o que o 5.2 presume quando o banco restaurado diverge: coluna ausente, tipo
// trocado, único faltando, gatilho desligado, função ausente e declaração de RPC errada.
func TestConferirAcusaADivergenciaDoPlano52(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	papelAuthenticated(t, p)
	exec(t, p,
		`alter table patrimonio_bens drop column etiquetado`,
		`alter table patrimonio_posse alter column de type text using de::text`,
		`alter table patrimonio_config drop constraint patrimonio_config_pkey`,
		`alter table patrimonio_bens disable trigger trg_patrimonio_espelha_situacao`,
		`drop trigger trg_patrimonio_espelha_responsavel on patrimonio_bens`,
		`drop function patrimonio_espelha_responsavel_no_veiculo() cascade`)
	faltam := faltamDe(t, p)
	for _, quer := range []string{"coluna patrimonio_bens.etiquetado", "tipo patrimonio_posse.de: esperado date",
		"único patrimonio_config(chave)", "gatilho trg_patrimonio_espelha_situacao em patrimonio_bens (ausente ou desabilitado)",
		"gatilho trg_patrimonio_espelha_responsavel em patrimonio_bens (ausente ou desabilitado)",
		"função patrimonio_espelha_responsavel_no_veiculo()"} {
		if !contem(faltam, quer) {
			t.Errorf("o conferir não acusou %q", quer)
		}
	}
	// declaração errada: p_nome sem Opcional e o retorno trocado de Conjunto para Valor
	errada := slices.Clone(web.FuncoesRPC)
	for i, f := range errada {
		switch f.Nome {
		case "sincronizar_carro_e_bem":
			errada[i].Params = slices.Clone(f.Params)
			for j := range errada[i].Params {
				if errada[i].Params[j].Nome == "p_nome" {
					errada[i].Params[j].Opcional = false
				}
			}
		case "pessoas_para_escolher":
			errada[i].Retorno = rpc.Valor
		}
	}
	emTx(t, p, func(tx pgx.Tx) {
		f, err := conferirRPC(context.Background(), tx, errada)
		if err != nil || !contem(f, "rpc sincronizar_carro_e_bem: parâmetro p_nome") || !contem(f, "rpc pessoas_para_escolher: declarada como Valor") {
			t.Errorf("declaração errada não acusada: %v %v", f, err)
		}
	})
}

// Plano 5.8: o deposito_id da loja é TEXTO (a Fábrica compara texto com texto). O de gc_estoque_item (bigint)
// entra com a Task 7, junto das tabelas gc_* do 5.5.
func TestTiposDaFabrica(t *testing.T) {
	if tiposDoWorker["fabrica_lojas.deposito_id"] != "text" {
		t.Errorf("fabrica_lojas.deposito_id = %q, esperava text", tiposDoWorker["fabrica_lojas.deposito_id"])
	}
}

// Plano 5.8: contra a fatia D0 (as 8 tabelas da Fábrica, fabrica_marcas e ia_execucoes), o conferir não acusa
// nada de fabrica_* — pega erro de digitação nas listas. No banco restaurado quem confere é o `api worker conferir`.
func TestConferirNaFatiaD0NaoAcusaOPlano58(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	for _, f := range faltamDe(t, p) {
		if strings.Contains(f, " fabrica_") || strings.Contains(f, " ia_execucoes.") {
			t.Errorf("a fatia D0 devia satisfazer o 5.8, mas o conferir acusa %q", f)
		}
	}
}

// Plano 5.9: contra a fatia D0 (as 9 conteudo_*, o gatilho da aprovação e as 6 RPCs verbatim), o conferir não
// acusa nada do 5.9 — pega erro de digitação nas listas. conteudo_reivindicar_hora_h é do Plano 4 (o robô da
// hora H tem banco próprio nos testes) e não está na fatia.
func TestConferirNaFatiaD0NaoAcusaOPlano59(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	faltam := faltamDe(t, p)
	for _, f := range faltam {
		if strings.Contains(f, " conteudo_") && !strings.Contains(f, "conteudo_reivindicar_hora_h") {
			t.Errorf("a fatia D0 devia satisfazer o 5.9, mas o conferir acusa %q", f)
		}
	}
	if !slices.ContainsFunc(faltam, func(f string) bool { return strings.Contains(f, "conteudo_reivindicar_hora_h") }) {
		t.Error("conteudo_reivindicar_hora_h não está na fatia: o conferir devia acusá-la (o filtro acima não provaria nada)")
	}
}

// Plano 5.10: contra a fatia D0 (as 12 tabelas do selo, os 6 gatilhos e as 16 RPCs) e a migração 00007, o conferir
// não acusa nada do selo nem da disparar_robo — pega erro de digitação nas listas. As 2 colunas presumidas de
// vessel_registros estão na fatia; no banco restaurado quem as confere é o `api worker conferir`.
func TestConferirNaFatiaD0NaoAcusaOPlano510(t *testing.T) {
	p := testebanco.ComEsquemaDeProducao(t)
	tabelas510 := []string{"vessel_lotes", "vessel_pecas", "vessel_registros", "vessel_baixas", "vessel_cartao_pedidos",
		"vessel_cartao_arquivos", "vessel_lembretes", "vessel_clientes"}
	for _, f := range faltamDe(t, p) {
		if strings.Contains(f, "disparar_robo") || strings.Contains(f, "disparos_pendentes") || strings.Contains(f, "vessel_") && strings.Contains(f, "gatilho") {
			t.Errorf("a fatia D0 devia satisfazer o 5.10, mas o conferir acusa %q", f)
		}
		for _, tb := range tabelas510 {
			if strings.Contains(f, " "+tb+".") || strings.Contains(f, " "+tb+"(") || strings.Contains(f, "/rpc/vessel_") {
				t.Errorf("a fatia D0 devia satisfazer o 5.10, mas o conferir acusa %q", f)
			}
		}
	}
}

// Plano 5.10: a disparar_robo de produção (pg_net) e os 2 gatilhos do Actions de volta são acusados; a da 00007, não.
func TestConferirDisparos(t *testing.T) {
	p := testebanco.Novo(t) // as migrações já trazem a 00007
	tem := func(trecho string) bool {
		for _, f := range faltamDe(t, p) {
			if strings.Contains(f, trecho) {
				return true
			}
		}
		return false
	}
	if tem("disparar_robo") || tem("vessel_lote_novo_pede_foto") {
		t.Fatal("a 00007 sozinha não pode ser acusada")
	}
	exec(t, p, `create or replace function disparar_robo(p_robo text, p_funcao text, p_segredo text, p_body jsonb default '{}'::jsonb,
		p_timeout integer default 120000) returns bigint language plpgsql as $f$
		declare v bigint; begin select net.http_post(url := 'https://x') into v; return v; end $f$`)
	exec(t, p, `create table if not exists vessel_lotes (id uuid); create function pede_foto() returns trigger language plpgsql as $f$ begin return new; end $f$;
		create trigger vessel_lote_novo_pede_foto after insert on vessel_lotes for each row execute function pede_foto()`)
	if !tem("função disparar_robo: ausente ou a de produção") || !tem("gatilho vessel_lote_novo_pede_foto: removido de produção") {
		t.Errorf("o conferir não acusou a função antiga e o gatilho de volta: %v", faltamDe(t, p))
	}
}
