package autz

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// Ataques às conferências de escrita, reproduzidos no banco real pela revisão da Task 5.
// "coisa": criar/editar por quem vê a conta. "peca": o WITH CHECK do update (frota) difere do
// USING (conta). "dup" e "num": chave repetida e chave inteira.
const catalogoDeAtaqueEscrita = `[
 {"tabela":"coisa","nome":"le","tipo":"permissive","comando":"select","papeis":["public"],"using":"true","withCheck":null},
 {"tabela":"coisa","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null},
 {"tabela":"coisa","nome":"edita","tipo":"permissive","comando":"update","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":"pode_ver_conta(account_id)"},
 {"tabela":"coisa","nome":"cria","tipo":"permissive","comando":"insert","papeis":["authenticated"],"using":null,"withCheck":"pode_ver_conta(account_id)"},
 {"tabela":"coisa","nome":"apaga","tipo":"permissive","comando":"delete","papeis":["authenticated"],"using":"superadmin_pela_ficha()","withCheck":null},
 {"tabela":"peca","nome":"le","tipo":"permissive","comando":"select","papeis":["public"],"using":"true","withCheck":null},
 {"tabela":"peca","nome":"so","tipo":"restrictive","comando":"select","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":null},
 {"tabela":"peca","nome":"edita","tipo":"permissive","comando":"update","papeis":["authenticated"],"using":"pode_ver_conta(account_id)","withCheck":"is_frota_admin()"},
 {"tabela":"dup","nome":"le","tipo":"permissive","comando":"select","papeis":["public"],"using":"true","withCheck":null},
 {"tabela":"dup","nome":"edita","tipo":"permissive","comando":"update","papeis":["authenticated"],"using":"true","withCheck":"true"},
 {"tabela":"num","nome":"le","tipo":"permissive","comando":"select","papeis":["public"],"using":"true","withCheck":null},
 {"tabela":"num","nome":"edita","tipo":"permissive","comando":"update","papeis":["authenticated"],"using":"true","withCheck":"true"}
]`

const pecaA1 = "bbbbbbbb-0000-4000-a000-000000000001"

func mundoDeAtaque(t *testing.T) (*Catalogo, *pgxpool.Pool) {
	t.Helper()
	cat, err := Compilar([]byte(catalogoDeAtaqueEscrita))
	if err != nil {
		t.Fatal(err)
	}
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), `create table coisa (id uuid primary key, account_id text, nome varchar(5), n int);
		create table peca (id uuid primary key, account_id text, nome text);
		create table dup (id uuid, nome text);
		create table num (id bigint primary key, nome text);
		insert into coisa values ('`+coisaA1+`', 'A1', 'um', 1), ('`+coisaA2+`', 'A2', 'dois', 2);
		insert into peca values ('`+pecaA1+`', 'A1', 'p');
		insert into dup values ('`+coisaA1+`', 'x'), ('`+coisaA1+`', 'y');
		insert into num values (7, 'sete')`); err != nil {
		t.Fatal(err)
	}
	return cat, p
}

// editarEDesfazer roda PodeEditar numa transação própria e a desfaz (solta o lock da linha).
func editarEDesfazer(t *testing.T, cat *Catalogo, p *pgxpool.Pool, e *Escopo, tab, id string, m map[string]any) error {
	t.Helper()
	tx := iniciar(t, p)
	defer tx.Rollback(context.Background())
	return cat.PodeEditar(context.Background(), tx, e, tab, id, m)
}

func apagarEDesfazer(t *testing.T, cat *Catalogo, p *pgxpool.Pool, e *Escopo, tab, id string) error {
	t.Helper()
	tx := iniciar(t, p)
	defer tx.Rollback(context.Background())
	return cat.PodeApagar(context.Background(), tx, e, tab, id)
}

func iniciar(t *testing.T, p *pgxpool.Pool) pgx.Tx {
	t.Helper()
	tx, err := p.Begin(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { tx.Rollback(context.Background()) })
	return tx
}

// Valor de tipo errado numa linha de outra conta (invisível) tem de responder igual a um id que
// não existe: 404. Se o erro de tipo (22P02, 22001) saísse só para a linha que existe, seria um
// oráculo de existência.
func TestPodeEditarNaoDistingueLinhaInvisivelDeInexistente(t *testing.T) {
	cat, p := mundoDeAtaque(t)
	ctx := context.Background()
	a1 := escopoComContas("A1")
	for _, m := range []map[string]any{{"n": "abc"}, {"nome": "longo-demais"}, {"id": "nao-uuid"}} {
		tx := iniciar(t, p)
		invisivel := cat.PodeEditar(ctx, tx, a1, "coisa", coisaA2, m)
		tx.Rollback(ctx) // solta o lock (a versão com defeito travava a linha invisível)
		tx = iniciar(t, p)
		inexistente := cat.PodeEditar(ctx, tx, a1, "coisa", "aaaaaaaa-0000-4000-a000-000000000009", m)
		tx.Rollback(ctx)
		if !errors.Is(invisivel, ErrNaoEncontrado) || !errors.Is(inexistente, ErrNaoEncontrado) {
			t.Errorf("mudanças %v: invisível=%v inexistente=%v, esperava 404 nos dois", m, invisivel, inexistente)
		}
	}
}

// for update trava a linha lida; a regra de leitura tem de estar no WHERE do select que trava,
// senão PodeEditar trava (e um `for update nowait` alheio responde 55P03) a linha de outra conta.
func TestPodeEditarNaoTravaLinhaQueNaoVe(t *testing.T) {
	cat, p := mundoDeAtaque(t)
	ctx := context.Background()
	tx1 := iniciar(t, p)
	if err := cat.PodeEditar(ctx, tx1, escopoComContas("A1"), "coisa", coisaA2, map[string]any{"nome": "x"}); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("PodeEditar = %v", err)
	}
	tx2 := iniciar(t, p)
	if _, err := tx2.Exec(ctx, `select 1 from coisa where id = '`+coisaA2+`' for update nowait`); err != nil {
		t.Errorf("a linha que a pessoa não vê ficou travada (revela que existe): %v", err)
	}
}

func TestPodeEditarETravaALinhaQueVe(t *testing.T) {
	cat, p := mundoDeAtaque(t)
	ctx := context.Background()
	tx1 := iniciar(t, p)
	if err := cat.PodeEditar(ctx, tx1, escopoComContas("A1"), "coisa", coisaA1, map[string]any{"nome": "x"}); err != nil {
		t.Fatal(err)
	}
	_, err := iniciar(t, p).Exec(ctx, `select 1 from coisa where id = '`+coisaA1+`' for update nowait`)
	var pe *pgconn.PgError
	if !errors.As(err, &pe) || pe.Code != "55P03" {
		t.Errorf("a linha conferida não ficou travada: %v", err)
	}
}

func TestPodeApagarETravaALinhaQueVe(t *testing.T) {
	cat, p := mundoDeAtaque(t)
	ctx := context.Background()
	super := escopoComContas()
	super.SuperFicha = true
	if err := cat.PodeApagar(ctx, iniciar(t, p), escopoComContas("A1"), "coisa", coisaA2); !errors.Is(err, ErrNaoEncontrado) {
		t.Fatalf("apagar o que não vê = %v", err)
	}
	if _, err := iniciar(t, p).Exec(ctx, `select 1 from coisa where id = '`+coisaA2+`' for update nowait`); err != nil {
		t.Errorf("apagar uma linha invisível a travou: %v", err)
	}
	tx := iniciar(t, p)
	if err := cat.PodeApagar(ctx, tx, super, "coisa", coisaA1); err != nil {
		t.Fatal(err)
	}
	_, err := iniciar(t, p).Exec(ctx, `select 1 from coisa where id = '`+coisaA1+`' for update nowait`)
	var pe *pgconn.PgError
	if !errors.As(err, &pe) || pe.Code != "55P03" {
		t.Errorf("a linha conferida para apagar não ficou travada: %v", err)
	}
}

// PodeCriar com a coluna que a policy lê ausente: ela virava NULL e pode_ver_conta(NULL) é
// verdadeiro, então a conferência passava e a rota podia gravar a linha em qualquer conta.
func TestPodeCriarExigeAColunaQueAPolicyLe(t *testing.T) {
	cat, p := mundoDeAtaque(t)
	ctx := context.Background()
	a1 := escopoComContas("A1")
	casos := []struct {
		nome  string
		linha map[string]any
		quer  error
	}{
		{"sem account_id", map[string]any{"nome": "x"}, ErrDeclaracao},
		{"linha vazia", map[string]any{}, ErrDeclaracao},
		{"linha nula", nil, ErrDeclaracao},
		{"Account_id em maiúscula no lugar de account_id", map[string]any{"Account_id": "A2", "nome": "x"}, ErrDeclaracao},
		{"conta que não vê", map[string]any{"account_id": "A2"}, ErrNegado},
		{"a própria conta", map[string]any{"account_id": "A1"}, nil},
		{"account_id nulo, como a RLS de produção", map[string]any{"account_id": nil}, nil},
	}
	for _, c := range casos {
		if err := cat.PodeCriar(ctx, p, a1, "coisa", c.linha); !errors.Is(err, c.quer) {
			t.Errorf("%s: %v, esperava %v", c.nome, err, c.quer)
		}
	}
}

func TestPodeEditarRecusaChaveComCaixaDiferente(t *testing.T) {
	cat, p := mundoDeAtaque(t)

	a1 := escopoComContas("A1")
	if err := editarEDesfazer(t, cat, p, a1, "coisa", coisaA1, map[string]any{"Account_id": "A2"}); !errors.Is(err, ErrDeclaracao) {
		t.Errorf("Account_id: %v", err)
	}
	// os valores antigos valem na linha nova: editar só o nome não precisa repetir account_id
	if err := editarEDesfazer(t, cat, p, a1, "coisa", coisaA1, map[string]any{"nome": "novo"}); err != nil {
		t.Errorf("editar só o nome: %v", err)
	}
	if err := editarEDesfazer(t, cat, p, a1, "coisa", coisaA1, map[string]any{"account_id": "A2"}); !errors.Is(err, ErrNegado) {
		t.Errorf("mover para A2: %v", err)
	}
}

// PodeEditar(..., nil) montava `to_jsonb(linha) || 'null'` (vira array) e o Postgres respondia 22023.
func TestPodeEditarComMudancasNulas(t *testing.T) {
	cat, p := mundoDeAtaque(t)
	if err := cat.PodeEditar(context.Background(), iniciar(t, p), escopoComContas("A1"), "coisa", coisaA1, nil); err != nil {
		t.Errorf("mudanças nil: %v", err)
	}
}

// O WITH CHECK do update vale para a linha NOVA e pode ser diferente do USING: quem vê a peça
// (USING) mas não é admin da frota (CHECK) não pode editá-la.
func TestPodeEditarAplicaOWithCheckNaLinhaNova(t *testing.T) {
	cat, p := mundoDeAtaque(t)

	sem := escopoComContas("A1")
	if err := editarEDesfazer(t, cat, p, sem, "peca", pecaA1, map[string]any{"nome": "x"}); !errors.Is(err, ErrNegado) {
		t.Errorf("sem módulo frota: %v", err)
	}
	frota := escopoComContas("A1")
	frota.Modulos = []string{"frota"}
	if err := editarEDesfazer(t, cat, p, frota, "peca", pecaA1, map[string]any{"nome": "x"}); err != nil {
		t.Errorf("com módulo frota: %v", err)
	}
}

// A chave tem de ser única: duas linhas com o mesmo id é defeito da tabela/declaração, nunca
// "a primeira que vier" (e as duas ficariam travadas).
func TestPodeEditarChaveRepetidaEDeclaracaoInvalida(t *testing.T) {
	cat, p := mundoDeAtaque(t)
	if err := cat.PodeEditar(context.Background(), iniciar(t, p), escopoComContas("A1"), "dup", coisaA1, map[string]any{"nome": "z"}); !errors.Is(err, ErrDeclaracao) {
		t.Errorf("id repetido: %v", err)
	}
}

// O id é comparado com o tipo da coluna (o índice da chave primária serve), e um id que não
// converte para esse tipo é 404 sem derrubar a transação.
func TestPodeEditarIdNoTipoDaColuna(t *testing.T) {
	cat, p := mundoDeAtaque(t)
	ctx := context.Background()
	tx := iniciar(t, p)
	a1 := escopoComContas("A1")
	for _, id := range []string{"abc", "7 or 1=1", "99999999999999999999", ""} {
		if err := cat.PodeEditar(ctx, tx, a1, "num", id, map[string]any{"nome": "x"}); !errors.Is(err, ErrNaoEncontrado) {
			t.Errorf("id %q: %v", id, err)
		}
	}
	if err := cat.PodeEditar(ctx, tx, a1, "num", "7", map[string]any{"nome": "x"}); err != nil {
		t.Errorf("id 7 depois de ids inválidos na mesma transação: %v", err)
	}
	if err := cat.PodeApagar(ctx, tx, a1, "num", "nao-e-numero"); !errors.Is(err, ErrNaoEncontrado) {
		t.Errorf("apagar com id inválido: %v", err)
	}
}

// ---- ComEscopo ----

type bancoQueFalha struct{ err error }

func (b bancoQueFalha) Query(context.Context, string, ...any) (pgx.Rows, error) { return nil, b.err }
func (b bancoQueFalha) QueryRow(context.Context, string, ...any) pgx.Row        { return linhaComErro{b.err} }

type linhaComErro struct{ err error }

func (l linhaComErro) Scan(...any) error { return l.err }

func TestComEscopo(t *testing.T) {
	p := testebanco.Novo(t)
	testebanco.TabelasDoEscopo(t, p)
	ctx := context.Background()
	const id = "11111111-0000-4000-a000-000000000001"
	for _, sql := range []string{`insert into usuarios (id, email, senha_hash) values ($1, 'a@x.com', 'x')`,
		`insert into profiles (id, email, role, features) values ($1, 'a@x.com', 'viewer', '{frota}')`} {
		if _, err := p.Exec(ctx, sql, id); err != nil {
			t.Fatal(err)
		}
	}
	s := auth.NovoStore(p)
	token, err := s.Criar(ctx, id, "painel", nil)
	if err != nil {
		t.Fatal(err)
	}
	rodar := func(b Banco, token string) *httptest.ResponseRecorder {
		var visto *Escopo
		h := auth.Exigir(p, s)(ComEscopo(b)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			visto = EscopoDo(r.Context())
			w.Write([]byte("ok"))
		})))
		req := httptest.NewRequest("GET", "/", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code == 200 && (visto == nil || visto.ID != id || !visto.Modulo("frota")) {
			t.Errorf("o escopo não chegou ao contexto: %+v", visto)
		}
		return w
	}
	if w := rodar(p, token); w.Code != 200 {
		t.Errorf("com escopo = %d %s", w.Code, w.Body)
	}
	if w := rodar(p, ""); w.Code != 401 {
		t.Errorf("sem token = %d", w.Code)
	}
	if w := rodar(bancoQueFalha{errors.New("falha do banco com SEGREDO")}, token); w.Code != 500 || w.Body.String() != `{"error":"erro_interno"}` {
		t.Errorf("falha do banco = %d %s", w.Code, w.Body)
	}
	if w := rodar(bancoQueFalha{context.Canceled}, token); w.Code != 499 {
		t.Errorf("pedido cancelado = %d (o cliente desistiu: não é erro 500)", w.Code)
	}
	if w := rodar(bancoQueFalha{context.DeadlineExceeded}, token); w.Code != 504 {
		t.Errorf("prazo = %d", w.Code)
	}
	// sem ator no contexto (rota montada sem auth.Exigir): 401, nunca escopo vazio
	w := httptest.NewRecorder()
	ComEscopo(p)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { t.Error("passou sem ator") })).ServeHTTP(w, httptest.NewRequest("GET", "/", nil))
	if w.Code != 401 || w.Header().Get("Content-Type") != "application/json" {
		t.Errorf("sem ator = %d %q", w.Code, w.Header().Get("Content-Type"))
	}
}
