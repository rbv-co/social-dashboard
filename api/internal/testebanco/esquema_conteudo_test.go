package testebanco

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// A fatia 5.9: as 9 tabelas das migrations, o gatilho conteudo_pecas_guarda e as 6 RPCs verbatim.
func TestFatiaDoConteudo(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		conta    = "a5900000-0000-4000-a000-0000000000a1"
		editor   = "a5910000-0000-4000-a000-000000000001" // features {conteudo}
		aprova   = "a5910000-0000-4000-a000-000000000002" // features {conteudo, conteudo.aprovar}
		pecaEm   = "a5930000-0000-4000-a000-0000000000c1" // em_aprovacao, com data
		pecaRasc = "a5930000-0000-4000-a000-0000000000c2" // rascunho
	)
	um := func(sql string, args ...any) string {
		t.Helper()
		var v *string
		if err := p.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}
	codigo := func(err error) (string, string) {
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return pe.Code, pe.Message
		}
		return "", ""
	}
	if _, err := p.Exec(ctx, `
		insert into usuarios (id, email) values ('`+editor+`', 'editor@x.com'), ('`+aprova+`', 'aprova@x.com');
		insert into profiles (id, email, role, features) values ('`+editor+`', 'editor@x.com', 'viewer', '{conteudo}'),
		  ('`+aprova+`', 'aprova@x.com', 'viewer', '{conteudo,conteudo.aprovar}');
		insert into accounts (id, name) values ('`+conta+`', 'Vessel');
		insert into conteudo_pecas (id, account_id, titulo, formato, status, publicar_em) values
		  ('`+pecaEm+`', '`+conta+`', 'Em aprovação', 'feed', 'em_aprovacao', '2026-10-20T15:00:00Z'),
		  ('`+pecaRasc+`', '`+conta+`', 'Rascunho', 'reels', 'rascunho', null);`); err != nil {
		t.Fatal(err)
	}
	for _, tab := range []string{"conteudo_pecas", "conteudo_ideias", "conteudo_blocos", "conteudo_arquivos", "conteudo_casamentos",
		"conteudo_concorrentes", "conteudo_eventos", "conteudo_jobs", "conteudo_metricas"} {
		if v := um(`select coalesce(to_regclass($1::text)::text, 'falta')`, "public."+tab); v == "falta" {
			t.Errorf("tabela %s não existe", tab)
		}
	}
	if v := um(`select string_agg(tgname::text || ':' || (tgtype::int & 2 = 2)::text || ':' || (tgtype::int & 16 = 16)::text, ',')
		from pg_trigger where tgrelid = 'conteudo_pecas'::regclass and not tgisinternal`); v != "conteudo_pecas_guarda:true:true" {
		t.Errorf("gatilho de conteudo_pecas = %s, esperava conteudo_pecas_guarda BEFORE UPDATE", v)
	}
	// defaults
	if v := um(`select status || '|' || legenda || '|' || hashtags from conteudo_pecas where id = $1::uuid`, pecaRasc); v != "rascunho||" {
		t.Errorf("defaults da peça = %s", v)
	}
	if v := um(`with n as (insert into conteudo_ideias (titulo) values ('x') returning *) select situacao || '|' || origem || '|' || roteiro::text from n`); v != "nova|manual|[]" {
		t.Errorf("defaults da ideia = %s", v)
	}
	if v := um(`with n as (insert into conteudo_jobs (account_id) values ($1::uuid) returning *) select tipo || '|' || status || '|' || params::text from n`, conta); v != "ideias|enfileirado|{}" {
		t.Errorf("defaults do job = %s", v)
	}
	como := func(id, sql string, args ...any) error {
		return banco.ComUsuario(ctx, p, id, func(tx pgx.Tx) error { _, err := tx.Exec(ctx, sql, args...); return err })
	}
	// a guarda: sem conteudo.aprovar, nem aprovar nem agendar vindo de em_aprovacao; com identidade nula, passa
	for _, s := range []string{"aprovada", "reprovada", "agendada"} {
		err := como(editor, `update conteudo_pecas set status = $1::text where id = $2::uuid`, s, pecaEm)
		if c, m := codigo(err); c != "P0001" || m != "Sem permissao para aprovar pecas de conteudo." {
			t.Errorf("editor levou a %s: %v", s, err)
		}
	}
	if v := um(`select status from conteudo_pecas where id = $1::uuid`, pecaEm); v != "em_aprovacao" {
		t.Errorf("negado gravou: %s", v)
	}
	if err := como(editor, `update conteudo_pecas set legenda = 'nova' where id = $1::uuid`, pecaEm); err != nil {
		t.Errorf("editar a legenda: %v", err)
	}
	if err := como(editor, `update conteudo_pecas set status = 'em_aprovacao' where id = $1::uuid`, pecaRasc); err != nil {
		t.Errorf("mandar para aprovação: %v", err)
	}
	if v := um(`select (updated_at > created_at)::text from conteudo_pecas where id = $1::uuid`, pecaRasc); v != "true" {
		t.Error("a guarda não tocou updated_at")
	}
	// a função de decidir: aprovador passa, grava quem aprovou e o evento; o segundo recebe a frase do trinco
	err := banco.ComUsuario(ctx, p, aprova, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `select conteudo_decidir($1::uuid, 'aprovada', null)`, pecaEm)
		return err
	})
	if err != nil {
		t.Fatalf("aprovador decidindo: %v", err)
	}
	if v := um(`select status || '|' || aprovado_por::text || '|' || (select count(*) from conteudo_eventos where peca_id = $1::uuid and acao = 'aprovou')::text
		from conteudo_pecas where id = $1::uuid`, pecaEm); v != "aprovada|"+aprova+"|1" {
		t.Errorf("depois de decidir: %s", v)
	}
	err = banco.ComUsuario(ctx, p, aprova, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `select conteudo_decidir($1::uuid, 'aprovada', null)`, pecaEm)
		return err
	})
	if c, m := codigo(err); c != "P0001" || m != "Esta peca nao esta esperando aprovacao (alguem ja decidiu?)." {
		t.Errorf("segunda decisão: %v", err)
	}
	// restrições
	if c, _ := codigo(como(editor, `insert into conteudo_pecas (account_id, titulo, formato) values ($1::uuid, 'x', 'tiktok')`, conta)); c != "23514" {
		t.Errorf("formato fora da lista: %s", c)
	}
	if c, _ := codigo(como(editor, `insert into conteudo_pecas (account_id, titulo, formato, status) values ($1::uuid, 'x', 'feed', 'agendada')`, conta)); c != "23514" {
		t.Errorf("agendada sem data: %s", c)
	}
	// o INSERT não passa pela guarda (BEFORE UPDATE): por isso a rota de criar não aceita status (Ruling 5.9-6)
	if err := como(editor, `insert into conteudo_pecas (account_id, titulo, formato, status, publicar_em) values ($1::uuid, 'pulou', 'feed', 'agendada', now())`, conta); err != nil {
		t.Errorf("o insert direto de peça agendada devia passar no banco (é a rota que barra): %v", err)
	}
	// cascata e set null
	if _, err := p.Exec(ctx, `insert into conteudo_arquivos (peca_id, caminho, tipo) values ('`+pecaRasc+`', 'a/b/1.png', 'imagem');
		insert into conteudo_eventos (peca_id, acao) values ('`+pecaRasc+`', 'criou');
		insert into conteudo_metricas (peca_id, capturado_em, curtidas) values ('`+pecaRasc+`', '2026-10-01', 3);
		insert into conteudo_casamentos (peca_id, ig_media_id, pontuacao) values ('`+pecaRasc+`', 'IG9', 0.5);
		insert into conteudo_ideias (titulo, peca_id) values ('ligada', '`+pecaRasc+`')`); err != nil {
		t.Fatal(err)
	}
	if c, _ := codigo(como(editor, `insert into conteudo_arquivos (peca_id, caminho, tipo) values ($1::uuid, 'a/b/2.png', 'imagem')`, pecaRasc)); c != "23505" {
		t.Errorf("duas capas na ordem 1: %s", c)
	}
	if _, err := p.Exec(ctx, `delete from conteudo_pecas where id = $1::uuid`, pecaRasc); err != nil {
		t.Fatal(err)
	}
	if v := um(`select ((select count(*) from conteudo_arquivos) + (select count(*) from conteudo_metricas) + (select count(*) from conteudo_casamentos)
		+ (select count(*) from conteudo_eventos where peca_id = $1::uuid))::text || '|' || coalesce((select peca_id::text from conteudo_ideias where titulo = 'ligada'), 'nulo')`, pecaRasc); v != "0|nulo" {
		t.Errorf("cascata = %s", v)
	}
	// tipos que a restritiva e as rotas presumem
	if v := um(`select string_agg(c.relname || '.' || format_type(a.atttypid, a.atttypmod), ',' order by c.relname) from pg_attribute a
		join pg_class c on c.oid = a.attrelid where a.attname = 'account_id' and c.relkind = 'r' and c.relname like 'conteudo\_%'`); v != "conteudo_blocos.uuid,conteudo_concorrentes.uuid,conteudo_ideias.uuid,conteudo_jobs.uuid,conteudo_pecas.uuid" {
		t.Errorf("account_id = %s", v)
	}
}
