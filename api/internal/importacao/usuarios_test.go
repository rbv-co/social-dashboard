package importacao

import (
	"context"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

type fonteFalsa []UsuarioOrigem

func (f fonteFalsa) Usuarios(context.Context) ([]UsuarioOrigem, error) { return f, nil }

func TestImportarPreservaHashEMarcaBanidoEIgnoraSemEmail(t *testing.T) {
	p := testebanco.Novo(t)
	hash, _ := auth.HashDaSenha("senha-antiga")
	agora := time.Now()
	futuro, passado := agora.Add(24*time.Hour), agora.Add(-24*time.Hour)
	f := fonteFalsa{
		{ID: "11111111-1111-1111-1111-111111111111", Email: "Ana@X.com", SenhaHash: hash, ConfirmadoEm: &passado, CriadoEm: &passado},
		{ID: "22222222-2222-2222-2222-222222222222", Email: "banido@x.com", SenhaHash: hash, BanidoAte: &futuro},
		{ID: "33333333-3333-3333-3333-333333333333", Email: "ban-vencido@x.com", SenhaHash: hash, BanidoAte: &passado},
		{ID: "44444444-4444-4444-4444-444444444444", Email: "", SenhaHash: hash},
	}
	n, ign, err := Importar(context.Background(), f, p, agora)
	if err != nil || n != 3 || ign != 1 {
		t.Fatalf("n=%d ign=%d err=%v", n, ign, err)
	}
	var gravado string
	p.QueryRow(context.Background(), `select senha_hash from usuarios where lower(email) = 'ana@x.com'`).Scan(&gravado)
	if gravado != hash || !auth.SenhaConfere(gravado, "senha-antiga") {
		t.Fatal("hash não foi preservado byte a byte")
	}
	var desativados int
	p.QueryRow(context.Background(), `select count(*) from usuarios where desativado_em is not null`).Scan(&desativados)
	if desativados != 1 {
		t.Fatalf("só o banido vigente deveria estar desativado, achei %d", desativados)
	}
}

func TestImportarDeNovoNaoDuplicaENemCorrompe(t *testing.T) {
	p := testebanco.Novo(t)
	hash, _ := auth.HashDaSenha("x")
	f := fonteFalsa{{ID: "11111111-1111-1111-1111-111111111111", Email: "a@x.com", SenhaHash: hash}}
	for i := 0; i < 3; i++ {
		if _, _, err := Importar(context.Background(), f, p, time.Now()); err != nil {
			t.Fatal(err)
		}
	}
	var n int
	var gravado string
	p.QueryRow(context.Background(), `select count(*), min(senha_hash) from usuarios`).Scan(&n, &gravado)
	if n != 1 {
		t.Fatalf("duplicou: %d", n)
	}
	if gravado != hash {
		t.Fatal("reimportar corrompeu o hash")
	}
}
