package acesso

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// sonda devolve o que a cadeia do domínio entregou à rota: papel|superFicha|impersonado|vínculos|
// temPerfil|todasContas|nContas.
func sonda(r chi.Router, _ *pgxpool.Pool) {
	r.Get("/eco", func(w http.ResponseWriter, req *http.Request) {
		e := autz.EscopoDo(req.Context())
		a := auth.AtorDoContexto(req.Context())
		if e == nil || a == nil {
			http.Error(w, "sem escopo ou sem ator na cadeia", http.StatusInternalServerError)
			return
		}
		fmt.Fprintf(w, "%s|%t|%t|%d|%t|%t|%d", e.Papel, e.SuperFicha, a.ImpersonadorID != nil, len(e.Vinculos), e.TemPerfil, e.TodasContas, len(e.Contas))
	})
}

func TestMundoEACadeiaDoDominio(t *testing.T) {
	m := novoMundo(t, sonda)
	m.rodar(t, []caso{
		{nome: "sem sessão", quem: "", metodo: "GET", caminho: "/eco", status: 401},
		{nome: "admin", quem: "admin", metodo: "GET", caminho: "/eco", status: 200, tem: "admin|false|false|0|true|true|0"},
		{nome: "super pela ficha", quem: "superFicha", metodo: "GET", caminho: "/eco", status: 200, tem: "viewer|true|false|0"},
		{nome: "supervisora do grupo G1 (T3 pelo grupo)", quem: "supervG1", metodo: "GET", caminho: "/eco", status: 200, tem: "viewer|false|false|1"},
		{nome: "impersonado", quem: "impersonado", metodo: "GET", caminho: "/eco", status: 200, tem: "admin|false|true|0"},
		// o admin restrito é admin e NÃO vê todas as contas: difere do admin sem trava
		{nome: "admin restrito", quem: "adminRestrito", metodo: "GET", caminho: "/eco", status: 200, tem: "admin|false|false|0|true|false|1"},
		{nome: "super só por e-mail (ficha falsa)", quem: "superSoPorEmail", metodo: "GET", caminho: "/eco", status: 200, tem: "viewer|false|false|0|true|true|0"},
		{nome: "sessão de painel sem perfil", quem: "semPerfil", metodo: "GET", caminho: "/eco", status: 200, tem: "|false|false|0|false|"},
	})
}

// As pessoas "super" do mundo valem pelo que a função de produção is_superadmin() diz (e-mail na lista
// E conta ativa), não pelo que o nome sugere: pega regra compilada como "ficha OU e-mail".
func TestPessoasSuperDoMundo(t *testing.T) {
	m := novoMundo(t)
	quer := map[string]bool{
		idSuper: true, idErick: true, idSuperSoPorEmail: true, // e-mail na lista (a ficha só vale para os dois primeiros)
		idSuperFicha: false, idAdmin: false, idAdminRestrito: false, idViewer: false, idSemPerfil: false,
	}
	for id, super := range quer {
		var v bool
		err := banco.ComUsuario(context.Background(), m.p, id, func(tx pgx.Tx) error {
			return tx.QueryRow(context.Background(), `select public.is_superadmin()`).Scan(&v)
		})
		if err != nil || v != super {
			t.Errorf("is_superadmin() de %s = %t (%v), esperava %t", id, v, err, super)
		}
	}
	if m.um(t, `select is_superadmin::text from profiles where id = '`+idSuperSoPorEmail+`'`) != "false" {
		t.Error("superSoPorEmail tem de ter a ficha is_superadmin falsa")
	}
}

func TestSoSessaoPropria(t *testing.T) {
	rodou := false
	h := soSessaoPropria(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		rodou = true
		w.WriteHeader(http.StatusNoContent)
	}))
	super := idSuper
	casos := []struct {
		nome   string
		ator   *auth.Ator
		status int
		roda   bool
	}{
		{"sem ator", nil, http.StatusForbidden, false},
		{"ator próprio", &auth.Ator{ID: idAdmin}, http.StatusNoContent, true},
		{"ator impersonado", &auth.Ator{ID: idAdmin, ImpersonadorID: &super}, http.StatusForbidden, false},
	}
	for _, c := range casos {
		rodou = false
		r := httptest.NewRequest("POST", "/x", nil)
		if c.ator != nil {
			r = r.WithContext(auth.NoContexto(r.Context(), c.ator))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != c.status || rodou != c.roda {
			t.Errorf("%s: status %d (esperava %d), handler rodou=%t (esperava %t)", c.nome, w.Code, c.status, rodou, c.roda)
		}
		if c.status == http.StatusForbidden {
			corpo := w.Body.String()
			if !strings.Contains(corpo, `"error":"sem_permissao"`) || !strings.Contains(corpo, "Quem entrou como outra pessoa não muda acessos nem avisos.") {
				t.Errorf("%s: corpo %s", c.nome, corpo)
			}
		}
	}
}

func TestDevePanicaNaMontagem(t *testing.T) {
	deve(nil)
	defer func() {
		if recover() == nil {
			t.Error("deve(err) tinha de entrar em pânico")
		}
	}()
	deve(fmt.Errorf("rota fora do catálogo"))
}

// A foto tem de enxergar toda tabela que o 5.1 escreve: mudar uma linha de cada uma muda o hash.
func TestFotoDoMundoVeMudancas(t *testing.T) {
	m := novoMundo(t)
	base := m.um(t, fotoDoMundo)
	if base != m.um(t, fotoDoMundo) {
		t.Fatal("a foto não é estável")
	}
	for _, sql := range []string{
		`update profiles set name = 'x' where id = '` + idViewer + `'`,
		`update equipes set nome = 'x' where id = '` + T1 + `'`,
		`update equipes_membros set papel = 'gestor' where id = '` + mVendT1 + `'`,
		`update equipes_permissoes set concedido_por = '` + idAdmin + `' where id = '` + epVendT1 + `'`,
		`update canais_grupos set nome = 'x' where id = '` + G1 + `'`,
		`update bling_lojas set nome = 'x' where loja_id = 1`,
		`delete from canais_grupos_membros where id = '` + cgmSupervG1 + `'`,
		`update acessos_perfis set nome = 'x' where id = '` + perfilVendedora + `'`,
		`update access_requests set message = 'x' where id = '` + pedido1 + `'`,
		`update push_subs set p256dh = 'x' where user_id = '` + idViewer + `'`,
		`update push_preferencias set ativo = not ativo where user_id = '` + idViewer + `'`,
		`insert into audit_log (actor_id, action) values ('` + idAdmin + `', 'x')`,
	} {
		if _, err := m.p.Exec(context.Background(), sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if nova := m.um(t, fotoDoMundo); nova == base {
			t.Errorf("a foto não mudou com: %s", sql)
		}
		base = m.um(t, fotoDoMundo)
	}
}
