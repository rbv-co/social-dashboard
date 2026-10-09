package auth

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

const uid = "11111111-1111-1111-1111-111111111111"
const uid2 = "22222222-2222-2222-2222-222222222222"

func novoUsuario(t *testing.T, s *Store, id, email string) {
	t.Helper()
	if _, err := s.pool.Exec(context.Background(), `insert into usuarios (id, email) values ($1, $2)`, id, email); err != nil {
		t.Fatal(err)
	}
}

func TestCriarEBuscar(t *testing.T) {
	s := NovoStore(testebanco.Novo(t))
	novoUsuario(t, s, uid, "a@x.com")
	tok, err := s.Criar(context.Background(), uid, "painel", nil)
	if err != nil || tok == "" {
		t.Fatal(err)
	}
	se, err := s.Buscar(context.Background(), tok)
	if err != nil || se.UsuarioID != uid || se.Tipo != "painel" || se.ImpersonadorID != nil {
		t.Fatalf("sessão = %+v, err = %v", se, err)
	}
	// o token em claro nunca é guardado
	var n int
	s.pool.QueryRow(context.Background(), `select count(*) from sessoes where token_hash = $1`, tok).Scan(&n)
	if n != 0 {
		t.Fatal("token guardado em claro")
	}
}

func TestTokenInexistenteEExpirada(t *testing.T) {
	s := NovoStore(testebanco.Novo(t))
	novoUsuario(t, s, uid, "a@x.com")
	if _, err := s.Buscar(context.Background(), "nao-existe"); !errors.Is(err, ErrSessaoInvalida) {
		t.Fatalf("err = %v", err)
	}
	tok, _ := s.Criar(context.Background(), uid, "painel", nil)
	s.agora = func() time.Time { return time.Now().Add(s.TTL + time.Minute) }
	if _, err := s.Buscar(context.Background(), tok); !errors.Is(err, ErrSessaoInvalida) {
		t.Fatalf("expirada deveria ser inválida, err = %v", err)
	}
}

func TestUsuarioDesativadoDepoisDaSessaoPerdeAcesso(t *testing.T) {
	s := NovoStore(testebanco.Novo(t))
	novoUsuario(t, s, uid, "a@x.com")
	tok, _ := s.Criar(context.Background(), uid, "painel", nil)
	s.pool.Exec(context.Background(), `update usuarios set desativado_em = now() where id = $1`, uid)
	if _, err := s.Buscar(context.Background(), tok); !errors.Is(err, ErrSessaoInvalida) {
		t.Fatalf("err = %v", err)
	}
}

func TestRenovacaoDeslizanteMasNuncaParaImpersonada(t *testing.T) {
	s := NovoStore(testebanco.Novo(t))
	novoUsuario(t, s, uid, "a@x.com")
	novoUsuario(t, s, uid2, "adm@x.com")
	normal, _ := s.Criar(context.Background(), uid, "painel", nil)
	imp := uid2
	impersonada, _ := s.Criar(context.Background(), uid, "painel", &imp)
	antesN, _ := s.Buscar(context.Background(), normal)
	antesI, _ := s.Buscar(context.Background(), impersonada)
	s.agora = func() time.Time { return time.Now().Add(10 * time.Minute) }
	depoisN, _ := s.Buscar(context.Background(), normal)
	depoisI, _ := s.Buscar(context.Background(), impersonada)
	if !depoisN.ExpiraEm.After(antesN.ExpiraEm) {
		t.Fatal("sessão normal deveria renovar")
	}
	if !depoisI.ExpiraEm.Equal(antesI.ExpiraEm) {
		t.Fatal("sessão impersonada não pode renovar")
	}
}

func TestRevogar(t *testing.T) {
	s := NovoStore(testebanco.Novo(t))
	novoUsuario(t, s, uid, "a@x.com")
	tok, _ := s.Criar(context.Background(), uid, "painel", nil)
	if err := s.Revogar(context.Background(), tok); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Buscar(context.Background(), tok); !errors.Is(err, ErrSessaoInvalida) {
		t.Fatalf("err = %v", err)
	}
}

func TestDesativadoPorProfilesDepoisDaSessaoPerdeAcesso(t *testing.T) {
	s := NovoStore(testebanco.Novo(t))
	ctx := context.Background()
	novoUsuario(t, s, uid, "a@x.com")
	s.pool.Exec(ctx, `insert into profiles (id, email, role) values ($1, 'a@x.com', 'viewer')`, uid)
	tok, _ := s.Criar(ctx, uid, "painel", nil)
	if _, err := s.Buscar(ctx, tok); err != nil {
		t.Fatalf("antes de desativar: %v", err)
	}
	s.pool.Exec(ctx, `update profiles set disabled = true where id = $1`, uid)
	if _, err := s.Buscar(ctx, tok); !errors.Is(err, ErrSessaoInvalida) {
		t.Fatalf("err = %v", err)
	}
}

func TestImpersonadorDesativadoMataASessao(t *testing.T) {
	for _, nome := range []string{"usuarios.desativado_em", "profiles.disabled"} {
		t.Run(nome, func(t *testing.T) {
			s := NovoStore(testebanco.Novo(t))
			ctx := context.Background()
			novoUsuario(t, s, uid, "a@x.com")
			novoUsuario(t, s, uid2, "adm@x.com")
			s.pool.Exec(ctx, `insert into profiles (id, email, role) values ($1, 'adm@x.com', 'admin')`, uid2)
			imp := uid2
			tok, _ := s.Criar(ctx, uid, "painel", &imp)
			if _, err := s.Buscar(ctx, tok); err != nil {
				t.Fatalf("antes de desativar: %v", err)
			}
			if nome == "profiles.disabled" {
				s.pool.Exec(ctx, `update profiles set disabled = true where id = $1`, uid2)
			} else {
				s.pool.Exec(ctx, `update usuarios set desativado_em = now() where id = $1`, uid2)
			}
			if _, err := s.Buscar(ctx, tok); !errors.Is(err, ErrSessaoInvalida) {
				t.Fatalf("err = %v", err)
			}
		})
	}
}

func TestUsuarioSemProfilesContinuaValendo(t *testing.T) {
	s := NovoStore(testebanco.Novo(t))
	novoUsuario(t, s, uid, "cliente@x.com") // conta de cliente: sem linha em profiles
	tok, _ := s.Criar(context.Background(), uid, "cliente", nil)
	if _, err := s.Buscar(context.Background(), tok); err != nil {
		t.Fatalf("err = %v", err)
	}
}
