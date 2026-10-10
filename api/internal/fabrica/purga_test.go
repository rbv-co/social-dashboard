package fabrica

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Colunas de produção usadas (migrations 015_fabrica_criativos.sql e 017_fabrica_jobs_lifecycle.sql).
const tabelasFabrica = `
create table fabrica_campanhas (id uuid primary key, nome text not null default 'x', created_at timestamptz not null default now(),
  fechada_em timestamptz, purgado_em timestamptz);
create table fabrica_criativos (id uuid primary key default gen_random_uuid(), campanha_id uuid references fabrica_campanhas(id) on delete cascade,
  storage_path text, purgado_em timestamptz);
insert into fabrica_campanhas (id, created_at, fechada_em, purgado_em) values
  ('00000000-0000-0000-0000-00000000000a', now() - interval '2 days', now() - interval '1 day', null),   -- fechada
  ('00000000-0000-0000-0000-00000000000b', now() - interval '2 days', null, null),                       -- aberta e nova
  ('00000000-0000-0000-0000-00000000000c', now() - interval '31 days', null, null),                      -- abandonada
  ('00000000-0000-0000-0000-00000000000d', now() - interval '40 days', now() - interval '39 days', now()), -- já purgada
  ('00000000-0000-0000-0000-00000000000e', now() - interval '29 days', null, null);                       -- quase abandonada
insert into fabrica_criativos (campanha_id, storage_path) values
  ('00000000-0000-0000-0000-00000000000a', 'a/1.png'), ('00000000-0000-0000-0000-00000000000a', 'a/sumiu.png'),
  ('00000000-0000-0000-0000-00000000000a', null), ('00000000-0000-0000-0000-00000000000a', ''),
  ('00000000-0000-0000-0000-00000000000b', 'b/1.png'), ('00000000-0000-0000-0000-00000000000c', 'c/1.png'),
  ('00000000-0000-0000-0000-00000000000d', 'd/1.png'), ('00000000-0000-0000-0000-00000000000e', 'e/1.png');`

func ambientePurga(t *testing.T) (*Purga, *pgxpool.Pool, string) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelasFabrica); err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	for _, f := range []string{"a/1.png", "b/1.png", "c/1.png", "d/1.png", "e/1.png"} {
		caminho := filepath.Join(dir, "fabrica-criativos", f)
		os.MkdirAll(filepath.Dir(caminho), 0o755)
		os.WriteFile(caminho, []byte("x"), 0o644)
	}
	return &Purga{Pool: p, Dir: dir}, p, dir
}

func existe(dir, f string) bool {
	_, err := os.Stat(filepath.Join(dir, "fabrica-criativos", f))
	return err == nil
}

func TestPurgaApagaFechadasEAbandonadas(t *testing.T) {
	pu, p, dir := ambientePurga(t)
	if err := pu.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if existe(dir, "a/1.png") || existe(dir, "c/1.png") {
		t.Fatal("fechada e abandonada há 30+ dias perdem os arquivos")
	}
	if !existe(dir, "b/1.png") || !existe(dir, "d/1.png") || !existe(dir, "e/1.png") {
		t.Fatal("aberta e nova fica (29 dias ainda não é abandonada); já purgada não é tocada")
	}
	var marcadas, criativos int
	p.QueryRow(context.Background(), `select count(*) from fabrica_campanhas where purgado_em is not null`).Scan(&marcadas)
	p.QueryRow(context.Background(), `select count(*) from fabrica_criativos where purgado_em is not null`).Scan(&criativos)
	if marcadas != 3 || criativos != 5 {
		t.Fatalf("rodadas marcadas=%d (esperava a, c, d) criativos marcados=%d (4 de a + 1 de c)", marcadas, criativos)
	}
}

func TestPurgaRecusaCaminhoForaDaPasta(t *testing.T) {
	pu, p, dir := ambientePurga(t)
	fora := filepath.Join(dir, "fora.txt")
	os.WriteFile(fora, []byte("não apague"), 0o644)
	p.Exec(context.Background(), `insert into fabrica_criativos (campanha_id, storage_path) values ('00000000-0000-0000-0000-00000000000a', '../fora.txt')`)
	err := pu.Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "caminho recusado") {
		t.Fatalf("err=%v", err)
	}
	if _, err := os.Stat(fora); err != nil {
		t.Fatal("arquivo fora da pasta do bucket foi apagado")
	}
	var marcada bool
	p.QueryRow(context.Background(), `select purgado_em is not null from fabrica_campanhas where id = '00000000-0000-0000-0000-00000000000a'`).Scan(&marcada)
	if marcada {
		t.Fatal("rodada com caminho recusado não pode ficar marcada como purgada")
	}
	// Um caminho ruim não trava as outras rodadas (nem os outros arquivos da mesma rodada).
	p.QueryRow(context.Background(), `select purgado_em is not null from fabrica_campanhas where id = '00000000-0000-0000-0000-00000000000c'`).Scan(&marcada)
	if !marcada || existe(dir, "c/1.png") || existe(dir, "a/1.png") {
		t.Fatalf("a rodada seguinte tem de ser purgada mesmo com a anterior recusada (c marcada=%v)", marcada)
	}
}

func TestPurgaSemDiretorioEErro(t *testing.T) {
	pu, _, _ := ambientePurga(t)
	pu.Dir = ""
	if err := pu.Rodar(context.Background()); err == nil {
		t.Fatal("ARQUIVOS_DIR vazio tem de falhar")
	}
	if tf := pu.Tarefa(); tf.Nome != "fabrica-purga" || tf.Agenda != "17 4 * * *" {
		t.Fatalf("%+v", tf)
	}
}

// O caminho vem do banco: nenhuma forma de sair da pasta do bucket apaga nada fora dela.
func TestApagarNaoSaiDaPasta(t *testing.T) {
	dir := t.TempDir()
	base := filepath.Join(dir, "fabrica-criativos")
	os.MkdirAll(filepath.Join(base, "a"), 0o755)
	fora := filepath.Join(dir, "fora.txt")
	os.WriteFile(fora, []byte("não apague"), 0o644)
	alheia := filepath.Join(dir, "alheia")
	os.MkdirAll(alheia, 0o755)
	os.WriteFile(filepath.Join(alheia, "x.png"), []byte("não apague"), 0o644)
	if err := os.Symlink(alheia, filepath.Join(base, "elo")); err != nil {
		t.Fatal(err)
	}
	raiz, err := os.OpenRoot(base)
	if err != nil {
		t.Fatal(err)
	}
	defer raiz.Close()
	for _, c := range []string{"../fora.txt", "a/../../fora.txt", fora, "/etc/passwd", "a/\x00b.png", "\x00", "..", ""} {
		if err := apagar(raiz, c); err == nil || !strings.Contains(err.Error(), "caminho recusado") {
			t.Errorf("%q: err=%v", c, err)
		}
	}
	if err := apagar(raiz, "elo/x.png"); err == nil {
		t.Error("symlink de diretório para fora da pasta tem de falhar")
	}
	for _, f := range []string{fora, filepath.Join(alheia, "x.png")} {
		if _, err := os.Stat(f); err != nil {
			t.Fatalf("%s foi apagado", f)
		}
	}
	if err := apagar(raiz, "a/nao-existe.png"); err != nil {
		t.Errorf("arquivo que já não existe conta como apagado: %v", err)
	}
}

// Pasta-base ausente (volume não montado) é erro ANTES de tocar no banco: senão toda rodada fechada
// seria marcada como purgada sem ter apagado nada.
func TestPurgaPastaBaseAusenteFalhaSemMarcarNada(t *testing.T) {
	pu, p, dir := ambientePurga(t)
	pu.Dir = filepath.Join(dir, "volume-nao-montado")
	err := pu.Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "pasta-base ausente") {
		t.Fatalf("err=%v", err)
	}
	var n int
	p.QueryRow(context.Background(), `select (select count(*) from fabrica_campanhas where purgado_em is not null and id <> '00000000-0000-0000-0000-00000000000d')
		+ (select count(*) from fabrica_criativos where purgado_em is not null)`).Scan(&n)
	if n != 0 {
		t.Fatalf("%d linhas ficaram marcadas como purgadas sem apagar arquivo", n)
	}
}
