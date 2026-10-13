package main

import (
	"bytes"
	"context"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

func rodarServico(t *testing.T, st *auth.Store, args ...string) (int, string, string) {
	t.Helper()
	var out, errw bytes.Buffer
	c := servicoComando(context.Background(), st, args, &out, &errw)
	return c, out.String(), errw.String()
}

func TestServicoCLI(t *testing.T) {
	p := testebanco.Novo(t)
	st := auth.NovoStore(p)
	ctx := context.Background()

	c, out, errw := rodarServico(t, st, "criar", "coletor", "coletor@x.com", "--modulos", "meta,banco")
	tok := strings.TrimSpace(out)
	if c != 0 || !strings.HasPrefix(tok, "srv_") || strings.Contains(tok, "\n") {
		t.Fatalf("criar: %d out=%q err=%q", c, out, errw)
	}
	if strings.Contains(errw, tok) {
		t.Fatal("o token apareceu no stderr")
	}
	if se, err := st.Buscar(ctx, tok); err != nil || se.Tipo != "servico" {
		t.Fatalf("o token impresso não funciona: %+v %v", se, err)
	}

	if c, _, e := rodarServico(t, st, "criar", "coletor", "outro@x.com"); c == 0 || e == "" {
		t.Fatalf("nome repetido: c=%d err=%q", c, e)
	}
	p.Exec(ctx, `insert into usuarios (id, email, senha_hash) values (gen_random_uuid(), 'gente@x.com', 'h')`)
	if c, o, e := rodarServico(t, st, "criar", "robo-gente", "gente@x.com"); c == 0 || o != "" || e == "" {
		t.Fatalf("usuário com senha: c=%d out=%q err=%q", c, o, e)
	}

	c, out, errw = rodarServico(t, st, "listar")
	if !strings.HasSuffix(strings.TrimSpace(out), "-") { // ainda não revogado
		t.Fatalf("listar: %q", out)
	}
	if c != 0 || !strings.Contains(out, "coletor") || !strings.Contains(out, "coletor@x.com") || strings.Contains(out+errw, tok) || strings.Contains(out, "srv_") {
		t.Fatalf("listar: %d %q %q", c, out, errw)
	}

	if c, _, e := rodarServico(t, st, "revogar", "coletor"); c != 0 {
		t.Fatalf("revogar: %d %q", c, e)
	}
	if _, err := st.Buscar(ctx, tok); err == nil {
		t.Fatal("token revogado continua valendo")
	}
	if c, _, _ := rodarServico(t, st, "revogar", "coletor"); c == 0 {
		t.Fatal("revogar de novo deveria falhar")
	}
	if c, _, _ := rodarServico(t, st, "revogar", "nao-existe"); c == 0 {
		t.Fatal("revogar inexistente deveria falhar")
	}
	if c, out, _ = rodarServico(t, st, "listar"); strings.HasSuffix(strings.TrimSpace(out), "-") {
		t.Fatalf("listar não mostra quando foi revogado: %q", out)
	}
	for _, a := range [][]string{{}, {"criar"}, {"criar", "a"}, {"criar", "robo", "x@x.com", "--modulos"}, {"revogar"}, {"xis"}} {
		if c, _, _ := rodarServico(t, st, a...); c != 2 {
			t.Fatalf("uso errado %v = %d, quer 2", a, c)
		}
	}
}
