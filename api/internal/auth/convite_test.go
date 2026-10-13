package auth

import (
	"bytes"
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
)

func montarConvite(t *testing.T) (*Conta, *correio, http.Handler, map[string]string) {
	t.Helper()
	p, s, c, cor, _ := montarConta(t)
	r := chi.NewRouter()
	r.Post("/auth/entrar", NovosHandlers(p, s, NovoLimitador()).Entrar)
	r.Post("/auth/definir-senha", c.DefinirSenha)
	r.With(Exigir(p, s)).Post("/invite-user", c.InviteUser)
	ctx := context.Background()
	toks := map[string]string{}
	for i, u := range []struct {
		nome, role string
		super      bool
	}{{"viewer", "viewer", false}, {"admin", "admin", false}, {"super", "admin", true}} {
		id := "33333333-3333-4333-a333-33333333333" + string(rune('0'+i))
		usuarioComSenha(t, p, id, u.nome+"@x.com", "s3nha", `{}`)
		p.Exec(ctx, `update profiles set role = $2::text, is_superadmin = $3::boolean where id = $1::uuid`, id, u.role, u.super)
		toks[u.nome], _ = s.Criar(ctx, id, "painel", nil)
		toks[u.nome+"-id"] = id
	}
	imp := toks["super-id"]
	toks["admin-impersonado"], _ = s.Criar(ctx, toks["admin-id"], "painel", &imp)
	return c, cor, r, toks
}

func TestInviteUserPortaoEContrato(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	casos := []struct {
		quem, corpo, quer string
	}{
		{"viewer", `{"email":"novo@x.com"}`, `{"error":"Apenas administradores podem realizar esta ação"}`},
		{"viewer", `lixo`, `{"error":"Apenas administradores podem realizar esta ação"}`},
		{"admin", `{}`, `{"error":"Email obrigatório"}`},
		{"admin", `{"email":"sem-arroba"}`, `{"error":"E-mail inválido"}`},
		{"admin", `{"resetPasswordUserId":"` + toks["viewer-id"] + `","password":"nova-senha"}`, `{"error":"Apenas superadmin pode trocar a senha de usuários"}`},
		{"super", `{"resetPasswordUserId":"` + toks["viewer-id"] + `","password":"123"}`, `{"error":"A senha precisa de no mínimo 6 caracteres"}`},
		{"super", `{"resetPasswordUserId":"44444444-4444-4444-a444-444444444444","password":"nova-senha"}`, `{"error":"Usuário não encontrado"}`},
		{"super", `{"resetPasswordUserId":"x' or '1'='1","password":"nova-senha"}`, `{"error":"Usuário não encontrado"}`},
		{"admin", `{"deleteUserId":"` + toks["admin-id"] + `"}`, `{"error":"Não é possível excluir sua própria conta"}`},
		{"admin", `{"email":"viewer@x.com","password":"outra-senha"}`, `{"error":"A user with this email address has already been registered"}`},
	}
	for _, k := range casos {
		w := chamar(h, "POST", "/invite-user", k.corpo, toks[k.quem])
		if w.Code != 400 || strings.TrimSpace(w.Body.String()) != k.quer {
			t.Errorf("%s %s = %d %s", k.quem, k.corpo, w.Code, w.Body)
		}
	}
	// "entrar como" não administra contas: 403 no formato do núcleo, com a frase em "mensagem"
	if w := chamar(h, "POST", "/invite-user", `{"email":"novo@x.com"}`, toks["admin-impersonado"]); w.Code != 403 ||
		strings.TrimSpace(w.Body.String()) != `{"error":"sem_permissao","mensagem":"Quem entrou como outra pessoa não administra contas."}` {
		t.Errorf("entrar como = %d %s", w.Code, w.Body)
	}
	var n int
	c.Pool.QueryRow(context.Background(), `select count(*) from usuarios where email = 'novo@x.com'`).Scan(&n)
	if n != 0 {
		t.Fatal("recusado e mesmo assim criou")
	}
	if w := chamar(h, "POST", "/invite-user", `{}`, ""); w.Code != 401 {
		t.Fatalf("sem sessão = %d", w.Code)
	}
}

func TestInviteUserCriaComSenhaEConvida(t *testing.T) {
	c, cor, h, toks := montarConvite(t)
	ctx := context.Background()
	if w := chamar(h, "POST", "/invite-user", `{"email":" Com.Senha@x.com","name":"Ana","role":"superadmin","password":"senha-boa"}`, toks["admin"]); w.Code != 200 || w.Body.String() != `{"success":true}` {
		t.Fatalf("criar com senha = %d %s", w.Code, w.Body)
	}
	var papel, nome string
	c.Pool.QueryRow(ctx, `select p.role, p.name from profiles p join usuarios u on u.id = p.id where u.email = 'com.senha@x.com'`).Scan(&papel, &nome)
	if papel != "viewer" || nome != "Ana" {
		t.Fatalf("papel=%q nome=%q (papel desconhecido vira viewer)", papel, nome)
	}
	entrar(t, h, "com.senha@x.com", "senha-boa")

	// sem senha: convite por e-mail; ninguém entra antes de definir a senha
	if w := chamar(h, "POST", "/invite-user", `{"email":"convidado@x.com","role":"admin"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("convite = %d %s", w.Code, w.Body)
	}
	env := cor.lista()
	m := reLink.FindStringSubmatch(env[len(env)-1].texto)
	if env[len(env)-1].para != "convidado@x.com" || m == nil || m[2] != "invite" || m[1] != padrao {
		t.Fatalf("e-mail = %+v", env[len(env)-1])
	}
	for _, senha := range []string{"", "x", "qualquer"} {
		if w := chamar(h, "POST", "/auth/entrar", `{"email":"convidado@x.com","senha":"`+senha+`"}`, ""); w.Code == 200 {
			t.Fatalf("convidado entrou com %q antes de definir a senha", senha)
		}
	}
	var horas float64
	c.Pool.QueryRow(ctx, `select extract(epoch from expira_em - now()) / 3600 from tokens_de_senha where tipo = 'convite'`).Scan(&horas)
	if horas < 23.9 || horas > 24 {
		t.Fatalf("convite vale %.2f h", horas)
	}
	if w := chamar(h, "POST", "/auth/definir-senha", `{"token":"`+m[3]+`","senha":"minha-senha"}`, ""); w.Code != 200 {
		t.Fatalf("definir pelo convite = %d %s", w.Code, w.Body)
	}
	entrar(t, h, "convidado@x.com", "minha-senha")

	// convidar quem já existe manda o link de troca, sem criar outra conta
	if w := chamar(h, "POST", "/invite-user", `{"email":"viewer@x.com"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("convite de existente = %d", w.Code)
	}
	env = cor.lista()
	if m := reLink.FindStringSubmatch(env[len(env)-1].texto); m == nil || m[2] != "recovery" {
		t.Fatalf("existente recebeu %+v", env[len(env)-1])
	}
	// e-mail que não sai vira erro na tela
	cor.falhar = true
	if w := chamar(h, "POST", "/invite-user", `{"email":"outro@x.com"}`, toks["admin"]); w.Code != 400 || !strings.Contains(w.Body.String(), "Não consegui enviar o e-mail") {
		t.Fatalf("falha de envio = %d %s", w.Code, w.Body)
	}
}

func TestInviteUserTrocaSenhaProvisoriaEExclui(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	ctx := context.Background()
	if w := chamar(h, "POST", "/invite-user", `{"resetPasswordUserId":"`+toks["viewer-id"]+`","password":"provisoria"}`, toks["super"]); w.Code != 200 {
		t.Fatalf("reset = %d %s", w.Code, w.Body)
	}
	var precisa bool
	c.Pool.QueryRow(ctx, `select precisa_trocar_senha from profiles where id = $1::uuid`, toks["viewer-id"]).Scan(&precisa)
	if !precisa {
		t.Fatal("senha posta por outra pessoa tem de ser provisória")
	}
	if _, err := c.Sessoes.Buscar(ctx, toks["viewer"]); err != ErrSessaoInvalida {
		t.Fatalf("a sessão do alvo continuou: %v", err)
	}
	entrar(t, h, "viewer@x.com", "provisoria")
	if w := chamar(h, "POST", "/invite-user", `{"deleteUserId":"`+toks["viewer-id"]+`"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("excluir = %d %s", w.Code, w.Body)
	}
	var n int
	c.Pool.QueryRow(ctx, `select (select count(*) from usuarios where id = $1::uuid) + (select count(*) from profiles where id = $1::uuid)`, toks["viewer-id"]).Scan(&n)
	if n != 0 {
		t.Fatalf("sobrou %d linha(s) do excluído", n)
	}
}

// contagens que não podem mudar quando o pedido é recusado
func fotoDeContas(t *testing.T, c *Conta) string {
	t.Helper()
	var f string
	if err := c.Pool.QueryRow(context.Background(), `select
	    (select count(*) from usuarios)::text || '/' || (select count(*) from profiles)::text || '/' ||
	    (select count(*) from sessoes)::text || '/' || (select count(*) from tokens_de_senha)::text || '/' ||
	    (select coalesce(string_agg(senha_hash, ',' order by id), '') from usuarios)`).Scan(&f); err != nil {
		t.Fatal(err)
	}
	return f
}

// Todo papel que não é admin, a conta sem perfil, a sessão de cliente e a de "entrar como"
// (mesmo a de um super-admin) são recusados em TODAS as ações, sem efeito nenhum no banco.
func TestInviteUserNegaQuemNaoEAdmin(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	ctx := context.Background()
	s := c.Sessoes
	alvo := toks["viewer-id"]
	// "editor" (papel que não é admin) e conta sem perfil
	usuarioComSenha(t, c.Pool, "55555555-5555-4555-a555-555555555551", "editor@x.com", "s3nha", `{}`)
	c.Pool.Exec(ctx, `update profiles set role = 'editor', is_superadmin = true where id = '55555555-5555-4555-a555-555555555551'`)
	c.Pool.Exec(ctx, `insert into usuarios (id, email) values ('55555555-5555-4555-a555-555555555552', 'semperfil@x.com')`)
	adminDesativado := "55555555-5555-4555-a555-555555555553"
	usuarioComSenha(t, c.Pool, adminDesativado, "desativado@x.com", "s3nha", `{}`)
	c.Pool.Exec(ctx, `update profiles set role = 'admin', is_superadmin = true where id = $1`, adminDesativado)
	toks["editor"], _ = s.Criar(ctx, "55555555-5555-4555-a555-555555555551", "painel", nil)
	toks["sem-perfil"], _ = s.Criar(ctx, "55555555-5555-4555-a555-555555555552", "painel", nil)
	toks["admin-desativado"], _ = s.Criar(ctx, adminDesativado, "painel", nil)
	c.Pool.Exec(ctx, `update profiles set disabled = true where id = $1`, adminDesativado)
	toks["admin-como-cliente"], _ = s.Criar(ctx, toks["admin-id"], "cliente", nil)
	// quem impersona tem de ser super-admin (Store.Buscar exige, Task 9): o "editor" da fixture é
	adm := "55555555-5555-4555-a555-555555555551"
	toks["super-impersonado"], _ = s.Criar(ctx, toks["super-id"], "painel", &adm)

	corpos := []string{
		`{"email":"novo@x.com","password":"senha-boa"}`,
		`{"email":"novo@x.com"}`,
		`{"deleteUserId":"` + alvo + `"}`,
		`{"resetPasswordUserId":"` + alvo + `","password":"troquei-tudo"}`,
	}
	antes := fotoDeContas(t, c)
	for _, quem := range []string{"viewer", "editor", "sem-perfil", "admin-impersonado", "super-impersonado"} {
		for _, corpo := range corpos {
			w := chamar(h, "POST", "/invite-user", corpo, toks[quem])
			quer, status := `{"error":"Apenas administradores podem realizar esta ação"}`, 400
			if strings.Contains(quem, "impersonado") {
				quer, status = `{"error":"sem_permissao","mensagem":"Quem entrou como outra pessoa não administra contas."}`, 403
			}
			if w.Code != status || strings.TrimSpace(w.Body.String()) != quer {
				t.Errorf("%s %s = %d %s", quem, corpo, w.Code, w.Body)
			}
		}
	}
	for _, quem := range []string{"admin-desativado"} { // sessão de conta desativada não vale
		for _, corpo := range corpos {
			if w := chamar(h, "POST", "/invite-user", corpo, toks[quem]); w.Code != 401 {
				t.Errorf("%s %s = %d (esperava 401)", quem, corpo, w.Code)
			}
		}
	}
	for _, corpo := range corpos { // sessão de cliente nem chega ao portão
		if w := chamar(h, "POST", "/invite-user", corpo, toks["admin-como-cliente"]); w.Code != 403 {
			t.Errorf("sessão de cliente %s = %d (esperava 403)", corpo, w.Code)
		}
	}
	if depois := fotoDeContas(t, c); depois != antes {
		t.Fatalf("recusado e mesmo assim mudou o banco:\n antes  %s\n depois %s", antes, depois)
	}
	// o alvo continua entrando com a senha antiga
	entrar(t, h, "viewer@x.com", "s3nha")
}

// Ruling 21: a edge deixava QUALQUER admin excluir qualquer conta (inclusive super-admin) e criar
// outro admin. A API mantém (paridade); restringir é decisão do dono. Este teste documenta o
// comportamento: se o dono decidir restringir, ele muda de propósito.
func TestInviteUserAdminExcluiSuperAdminComoNaEdge(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	if w := chamar(h, "POST", "/invite-user", `{"email":"outro-admin@x.com","role":"admin","password":"senha-boa"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("admin cria admin = %d %s", w.Code, w.Body)
	}
	var papel string
	c.Pool.QueryRow(context.Background(), `select role from profiles where email = 'outro-admin@x.com'`).Scan(&papel)
	if papel != "admin" {
		t.Fatalf("papel = %q", papel)
	}
	if w := chamar(h, "POST", "/invite-user", `{"deleteUserId":"`+toks["super-id"]+`"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("admin exclui super-admin = %d %s", w.Code, w.Body)
	}
	var n int
	c.Pool.QueryRow(context.Background(), `select count(*) from usuarios where id = $1::uuid`, toks["super-id"]).Scan(&n)
	if n != 0 {
		t.Fatal("o super-admin continua lá")
	}
}

func TestInviteUserExclusaoLimpaTudoDaContaEFalhaSemSobras(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	ctx := context.Background()
	alvo := toks["viewer-id"]
	// links vivos e uma sessão que o alvo abriu "como" outra pessoa (impersonador_id não tem cascata)
	c.Pool.Exec(ctx, `insert into tokens_de_senha (token_hash, usuario_id, tipo, expira_em) values ('h1', $1::uuid, 'recuperacao', now() + interval '1 hour')`, alvo)
	adm := alvo
	if _, err := c.Sessoes.Criar(ctx, toks["admin-id"], "painel", &adm); err != nil {
		t.Fatal(err)
	}
	// um registro ligado barra a exclusão: nada pode ser apagado (nem o perfil)
	c.Pool.Exec(ctx, `create table ligado (u uuid references usuarios(id))`)
	c.Pool.Exec(ctx, `insert into ligado values ($1::uuid)`, alvo)
	antes := fotoDeContas(t, c)
	w := chamar(h, "POST", "/invite-user", `{"deleteUserId":"`+alvo+`"}`, toks["admin"])
	if w.Code != 400 || !strings.Contains(w.Body.String(), "ainda há registros ligados") {
		t.Fatalf("exclusão barrada = %d %s", w.Code, w.Body)
	}
	if depois := fotoDeContas(t, c); depois != antes {
		t.Fatalf("a exclusão barrada deixou resto:\n antes  %s\n depois %s", antes, depois)
	}
	// liberada, leva sessões, links e as sessões "como" que a conta abriu
	c.Pool.Exec(ctx, `delete from ligado`)
	if w := chamar(h, "POST", "/invite-user", `{"deleteUserId":"`+alvo+`"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("excluir = %d %s", w.Code, w.Body)
	}
	var n int
	c.Pool.QueryRow(ctx, `select (select count(*) from sessoes where usuario_id = $1::uuid or impersonador_id = $1::uuid)
	    + (select count(*) from tokens_de_senha where usuario_id = $1::uuid)
	    + (select count(*) from profiles where id = $1::uuid) + (select count(*) from usuarios where id = $1::uuid)`, alvo).Scan(&n)
	if n != 0 {
		t.Fatalf("sobraram %d linha(s)", n)
	}
	if _, err := c.Sessoes.Buscar(ctx, toks["viewer"]); err != ErrSessaoInvalida {
		t.Fatalf("a sessão do excluído continua: %v", err)
	}
	// excluir de novo / id que não existe: erro, não "sucesso" calado (a edge também errava)
	for _, id := range []string{alvo, "44444444-4444-4444-a444-444444444444", "x' or '1'='1", "não-é-uuid"} {
		if w := chamar(h, "POST", "/invite-user", `{"deleteUserId":"`+id+`"}`, toks["admin"]); w.Code != 400 || !strings.Contains(w.Body.String(), "Usuário não encontrado") {
			t.Errorf("excluir inexistente %s = %d %s", id, w.Code, w.Body)
		}
	}
	// perfil órfão (sem conta) também sai
	c.Pool.Exec(ctx, `insert into profiles (id, email, role) values ('66666666-6666-4666-a666-666666666666', 'orfao@x.com', 'viewer')`)
	if w := chamar(h, "POST", "/invite-user", `{"deleteUserId":"66666666-6666-4666-a666-666666666666"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("excluir perfil órfão = %d %s", w.Code, w.Body)
	}
}

func TestInviteUserSenhaTemLimiteEmBytes(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	alvo := toks["viewer-id"]
	para := func(senha string) string { // quem tenta trocar a senha do alvo (super) e criar (admin)
		w := chamar(h, "POST", "/invite-user", `{"resetPasswordUserId":"`+alvo+`","password":"`+senha+`"}`, toks["super"])
		return w.Body.String()
	}
	ok72, ruim73 := strings.Repeat("a", 72), strings.Repeat("a", 73)
	acentos72, acentos74 := strings.Repeat("é", 36), strings.Repeat("é", 37) // 72 e 74 BYTES
	if !strings.Contains(para(ruim73), "no máximo 72") || !strings.Contains(para(acentos74), "no máximo 72") {
		t.Fatal("reset aceitou senha acima de 72 bytes")
	}
	if !strings.Contains(para("12345"), "no mínimo 6") {
		t.Fatal("reset aceitou senha de 5")
	}
	for _, senha := range []string{ok72, acentos72, "123456"} {
		if got := para(senha); got != `{"success":true}` {
			t.Fatalf("reset com %d bytes = %s", len(senha), got)
		}
		entrar(t, h, "viewer@x.com", senha)
	}
	for i, senha := range []string{ruim73, acentos74} {
		corpo := `{"email":"b` + string(rune('0'+i)) + `@x.com","password":"` + senha + `"}`
		if w := chamar(h, "POST", "/invite-user", corpo, toks["admin"]); !strings.Contains(w.Body.String(), "no máximo 72") {
			t.Fatalf("criar com %d bytes = %d %s", len(senha), w.Code, w.Body)
		}
	}
	for i, senha := range []string{ok72, acentos72, "123456"} {
		corpo := `{"email":"c` + string(rune('0'+i)) + `@x.com","password":"` + senha + `"}`
		if w := chamar(h, "POST", "/invite-user", corpo, toks["admin"]); w.Code != 200 {
			t.Fatalf("criar com %d bytes = %d %s", len(senha), w.Code, w.Body)
		}
		entrar(t, h, "c"+string(rune('0'+i))+"@x.com", senha)
	}
	var n int
	c.Pool.QueryRow(context.Background(), `select count(*) from usuarios where email like 'b_@x.com'`).Scan(&n)
	if n != 0 {
		t.Fatal("senha longa demais criou conta")
	}
}

// Troca de senha pelo super-admin: o alvo perde as sessões e a senha antiga; o ator (outra
// pessoa) mantém a própria sessão.
func TestInviteUserResetDerrubaSoAsSessoesDoAlvo(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	ctx := context.Background()
	if w := chamar(h, "POST", "/invite-user", `{"resetPasswordUserId":"`+toks["admin-id"]+`","password":"provisoria"}`, toks["super"]); w.Code != 200 {
		t.Fatalf("reset = %d %s", w.Code, w.Body)
	}
	if _, err := c.Sessoes.Buscar(ctx, toks["admin"]); err != ErrSessaoInvalida {
		t.Fatal("a sessão do alvo continuou")
	}
	if _, err := c.Sessoes.Buscar(ctx, toks["admin-impersonado"]); err != ErrSessaoInvalida {
		t.Fatal("a sessão 'como' o alvo continuou")
	}
	if _, err := c.Sessoes.Buscar(ctx, toks["super"]); err != nil {
		t.Fatalf("o ator perdeu a sessão: %v", err)
	}
	if w := chamar(h, "POST", "/auth/entrar", `{"email":"admin@x.com","senha":"s3nha"}`, ""); w.Code == 200 {
		t.Fatal("a senha antiga continua valendo")
	}
	entrar(t, h, "admin@x.com", "provisoria")
	// usuário válido (formato) que não existe, e perfil sem conta: nada vira "sucesso"
	if w := chamar(h, "POST", "/invite-user", `{"resetPasswordUserId":"44444444-4444-4444-a444-444444444444","password":"provisoria"}`, toks["super"]); !strings.Contains(w.Body.String(), "Usuário não encontrado") {
		t.Fatalf("reset de quem não existe = %s", w.Body)
	}
}

// Convidar duas vezes o mesmo e-mail (caixa e espaços diferentes) não duplica conta nem perfil,
// e só o último link do convite vale. Pedidos simultâneos criam UMA conta, sem 500.
func TestInviteUserIdempotenteENormalizaEmail(t *testing.T) {
	c, cor, h, toks := montarConvite(t)
	ctx := context.Background()
	for _, e := range []string{"Pendente@X.com", "  pendente@x.COM  "} {
		if w := chamar(h, "POST", "/invite-user", `{"email":"`+e+`"}`, toks["admin"]); w.Code != 200 {
			t.Fatalf("convite %q = %d %s", e, w.Code, w.Body)
		}
	}
	env := cor.lista()
	if len(env) != 2 || env[0].para != "pendente@x.com" || env[1].para != "pendente@x.com" {
		t.Fatalf("e-mails = %+v", env)
	}
	m0, m1 := reLink.FindStringSubmatch(env[0].texto), reLink.FindStringSubmatch(env[1].texto)
	if m0 == nil || m1 == nil || m0[2] != "invite" || m1[2] != "invite" || m0[3] == m1[3] {
		t.Fatalf("o reenvio de um convite pendente tem de ser outro convite: %v %v", m0, m1)
	}
	var contas, perfis, vivos int
	c.Pool.QueryRow(ctx, `select (select count(*) from usuarios where lower(email) = 'pendente@x.com'),
	    (select count(*) from profiles where lower(email) = 'pendente@x.com'),
	    (select count(*) from tokens_de_senha where usado_em is null and tipo = 'convite')`).Scan(&contas, &perfis, &vivos)
	if contas != 1 || perfis != 1 || vivos != 1 {
		t.Fatalf("contas=%d perfis=%d convites vivos=%d", contas, perfis, vivos)
	}
	if w := chamar(h, "POST", "/auth/definir-senha", `{"token":"`+m0[3]+`","senha":"minha-senha"}`, ""); w.Code == 200 {
		t.Fatal("o convite antigo continuou valendo")
	}
	if w := chamar(h, "POST", "/auth/definir-senha", `{"token":"`+m1[3]+`","senha":"minha-senha"}`, ""); w.Code != 200 {
		t.Fatalf("o convite novo não valeu: %d %s", w.Code, w.Body)
	}
	// quem já definiu a senha e é convidado de novo ganha o link de TROCA (1 h), em e-mail com caixa/espaço
	if w := chamar(h, "POST", "/invite-user", `{"email":" PENDENTE@x.com "}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("convite de quem já tem senha = %d", w.Code)
	}
	if m := reLink.FindStringSubmatch(cor.lista()[2].texto); m == nil || m[2] != "recovery" {
		t.Fatalf("esperava link de troca: %+v", cor.lista()[2])
	}

	// criar com senha duas vezes e em paralelo: uma conta só, ninguém recebe 500
	corpo := `{"email":" Paralelo@x.com ","password":"senha-boa"}`
	var wg sync.WaitGroup
	codigos := make([]int, 8)
	msgs := make([]string, 8)
	for i := range codigos {
		wg.Add(1)
		go func() {
			defer wg.Done()
			w := chamar(h, "POST", "/invite-user", corpo, toks["admin"])
			codigos[i], msgs[i] = w.Code, w.Body.String()
		}()
	}
	wg.Wait()
	certos := 0
	for i, cod := range codigos {
		switch {
		case cod == 200:
			certos++
		case cod != 400 || !strings.Contains(msgs[i], "already been registered"):
			t.Errorf("pedido simultâneo %d = %d %s", i, cod, msgs[i])
		}
	}
	c.Pool.QueryRow(ctx, `select count(*) from usuarios where lower(email) = 'paralelo@x.com'`).Scan(&contas)
	if certos != 1 || contas != 1 {
		t.Fatalf("sucessos=%d contas=%d", certos, contas)
	}
	// o mesmo em paralelo no convite sem senha: uma conta, um convite vivo
	var wg2 sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg2.Add(1)
		go func() {
			defer wg2.Done()
			w := chamar(h, "POST", "/invite-user", `{"email":"corrida@x.com"}`, toks["admin"])
			if w.Code != 200 && !strings.Contains(w.Body.String(), "already been registered") {
				t.Errorf("convite simultâneo = %d %s", w.Code, w.Body)
			}
		}()
	}
	wg2.Wait()
	c.Pool.QueryRow(ctx, `select (select count(*) from usuarios where email = 'corrida@x.com'), (select count(*) from tokens_de_senha t join usuarios u on u.id = t.usuario_id where u.email = 'corrida@x.com' and t.usado_em is null)`).Scan(&contas, &vivos)
	if contas != 1 || vivos != 1 {
		t.Fatalf("convite simultâneo: contas=%d links vivos=%d", contas, vivos)
	}
}

// Quem cria é o da sessão (nunca o corpo): a identidade dos gatilhos é a do ator, e campos de
// poder no corpo (id, is_superadmin, permissions, papel desconhecido ou em outra caixa) não valem.
func TestInviteUserUsaOAtorDaSessaoENaoOCorpo(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	ctx := context.Background()
	c.Pool.Exec(ctx, `create table trilha (quem text, id uuid)`)
	c.Pool.Exec(ctx, `create function trilha_fn() returns trigger language plpgsql as $f$ begin
	    insert into trilha values (current_setting('app.usuario_id', true), new.id); return new; end $f$`)
	c.Pool.Exec(ctx, `create trigger trilha_t after insert or update on profiles for each row execute function trilha_fn()`)
	corpo := `{"email":"forjado@x.com","password":"senha-boa","role":"Admin","id":"` + toks["super-id"] + `","is_superadmin":true,"isSuperadmin":true,"criado_por":"` + toks["super-id"] + `","permissions":{"frota":["ver"]},"uid":"` + toks["super-id"] + `"}`
	if w := chamar(h, "POST", "/invite-user", corpo, toks["admin"]); w.Code != 200 {
		t.Fatalf("criar = %d %s", w.Code, w.Body)
	}
	var papel string
	var super bool
	var perm string
	var id string
	c.Pool.QueryRow(ctx, `select role, coalesce(is_superadmin, false), permissions::text, id::text from profiles where email = 'forjado@x.com'`).Scan(&papel, &super, &perm, &id)
	if papel != "viewer" || super || perm != "{}" || id == toks["super-id"] {
		t.Fatalf("o corpo mandou no perfil: papel=%q super=%v perm=%s id=%s", papel, super, perm, id)
	}
	var quem string
	if err := c.Pool.QueryRow(ctx, `select quem from trilha where id = $1::uuid`, id).Scan(&quem); err != nil || quem != toks["admin-id"] {
		t.Fatalf("a escrita foi feita como %q (%v), esperava o admin da sessão", quem, err)
	}
	// excluir e trocar senha também
	c.Pool.Exec(ctx, `delete from trilha`)
	chamar(h, "POST", "/invite-user", `{"resetPasswordUserId":"`+id+`","password":"outra-senha","uid":"`+toks["admin-id"]+`"}`, toks["super"])
	if err := c.Pool.QueryRow(ctx, `select quem from trilha where id = $1::uuid`, id).Scan(&quem); err != nil || quem != toks["super-id"] {
		t.Fatalf("o reset foi feito como %q (%v), esperava o super da sessão", quem, err)
	}
}

// Nenhum token, link ou e-mail nos logs quando o envio falha; corpo inválido ou grande demais
// é recusado com a frase da edge.
func TestInviteUserNaoVazaSegredoNoLogEValidaCorpo(t *testing.T) {
	_, cor, h, toks := montarConvite(t)
	var buf bytes.Buffer
	antigo := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buf, nil)))
	defer slog.SetDefault(antigo)
	cor.falhar = true
	w := chamar(h, "POST", "/invite-user", `{"email":"log@x.com"}`, toks["admin"])
	if w.Code != 400 || strings.Contains(w.Body.String(), "falha de envio") || strings.Contains(w.Body.String(), "token") {
		t.Fatalf("falha de envio = %d %s", w.Code, w.Body)
	}
	if buf.Len() == 0 {
		t.Fatal("a falha de envio não foi registrada")
	}
	if l := buf.String(); strings.Contains(l, "token") || strings.Contains(l, "log@x.com") || strings.Contains(l, "type=") {
		t.Fatalf("log com segredo: %s", l)
	}
	for _, corpo := range []string{`lixo`, `[]`, `{"email":123}`, `{"email":"` + strings.Repeat("a", 70<<10) + `"}`} {
		if w := chamar(h, "POST", "/invite-user", corpo, toks["admin"]); w.Code != 400 || strings.TrimSpace(w.Body.String()) != `{"error":"Pedido inválido"}` {
			t.Errorf("corpo %.20q = %d %s", corpo, w.Code, w.Body)
		}
	}
	for _, e := range []string{"a@b", "a b@x.com", "@x.com", "a@@x.com", strings.Repeat("a", 250) + "@x.com"} {
		if w := chamar(h, "POST", "/invite-user", `{"email":"`+e+`"}`, toks["admin"]); w.Code != 400 || !strings.Contains(w.Body.String(), "E-mail inválido") {
			t.Errorf("e-mail %.20q = %d %s", e, w.Code, w.Body)
		}
	}
}

// B1: o Auth normalizava o e-mail de auth.users, mas a edge gravava profiles.email COMO RECEBIDO,
// e duas telas (vendedoras em lote, Frota) procuram o perfil por igualdade exata.
func TestInviteUserPerfilGuardaOEmailComoDigitado(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	ctx := context.Background()
	dois := func(email string) (usuario, perfil string) {
		if err := c.Pool.QueryRow(ctx, `select u.email, p.email from usuarios u join profiles p on p.id = u.id where lower(u.email) = lower($1::text)`, email).Scan(&usuario, &perfil); err != nil {
			t.Fatalf("%s: %v", email, err)
		}
		return
	}
	// criar com senha, e convidar sem senha
	for corpo, quer := range map[string]string{
		`{"email":"  Ana.Silva@Loja.com ","password":"senha-boa"}`: "Ana.Silva@Loja.com",
		`{"email":" Bia.Souza@Loja.com "}`:                         "Bia.Souza@Loja.com",
	} {
		if w := chamar(h, "POST", "/invite-user", corpo, toks["admin"]); w.Code != 200 {
			t.Fatalf("%s = %d %s", corpo, w.Code, w.Body)
		}
		u, p := dois(quer)
		if u != strings.ToLower(quer) || p != quer {
			t.Errorf("usuarios.email=%q (esperava %q) profiles.email=%q (esperava %q)", u, strings.ToLower(quer), p, quer)
		}
		// a busca exata que as telas fazem (`email=eq.`) acha o perfil
		var n int
		c.Pool.QueryRow(ctx, `select count(*) from profiles where email = $1::text`, quer).Scan(&n)
		if n != 1 {
			t.Errorf("busca exata por %q achou %d perfis", quer, n)
		}
	}
	// is_superadmin por lista de e-mail é sensível a caixa em produção: criar BRENO@... NÃO herda o
	// poder (nenhum privilégio novo); o e-mail fica como digitado e não casa com a lista em minúsculas.
	if w := chamar(h, "POST", "/invite-user", `{"email":"BRENO@RBVCOMPANY.COM","password":"senha-boa"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("criar = %d %s", w.Code, w.Body)
	}
	var casaComALista, super bool
	c.Pool.QueryRow(ctx, `select email = any (array['breno@rbvcompany.com']::text[]), coalesce(is_superadmin, false) from profiles where lower(email) = 'breno@rbvcompany.com'`).Scan(&casaComALista, &super)
	if casaComALista || super {
		t.Fatalf("BRENO@RBVCOMPANY.COM casou com a lista (%v) ou virou super (%v)", casaComALista, super)
	}
}

// m1: o UUID da própria conta em maiúsculas não pode furar a trava "não exclua a si mesmo".
func TestInviteUserNaoExcluiASiMesmoComUUIDEmMaiusculas(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	for _, id := range []string{strings.ToUpper(toks["admin-id"]), toks["admin-id"]} {
		w := chamar(h, "POST", "/invite-user", `{"deleteUserId":"`+id+`"}`, toks["admin"])
		if w.Code != 400 || strings.TrimSpace(w.Body.String()) != `{"error":"Não é possível excluir sua própria conta"}` {
			t.Errorf("excluir a si mesmo (%s) = %d %s", id, w.Code, w.Body)
		}
	}
	var n int
	c.Pool.QueryRow(context.Background(), `select count(*) from usuarios where id = $1::uuid`, toks["admin-id"]).Scan(&n)
	if n != 1 {
		t.Fatal("o admin se excluiu")
	}
	// em maiúsculas, o alvo é achado do mesmo jeito (o Postgres lê UUID sem caixa)
	if w := chamar(h, "POST", "/invite-user", `{"deleteUserId":"`+strings.ToUpper(toks["viewer-id"])+`"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("excluir outro em maiúsculas = %d %s", w.Code, w.Body)
	}
}

// m3: o mínimo conta CARACTERES (Ruling 33); o teto de 72 continua em BYTES.
func TestInviteUserMinimoDeSenhaContaCaracteres(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	ctx := context.Background()
	if msg := validarSenha("ééé"); msg == "" {
		t.Error("validarSenha aceitou 3 caracteres (6 bytes)")
	}
	if msg := validarSenha("éééééé"); msg != "" {
		t.Errorf("validarSenha recusou 6 caracteres: %s", msg)
	}
	if msg := validarSenha(strings.Repeat("é", 37)); msg == "" {
		t.Error("validarSenha aceitou 74 bytes")
	}
	if utf8.RuneCountInString("ééé") != 3 {
		t.Fatal("premissa")
	}
	// reset: "ééé" recusada (a senha do alvo não muda); "éééééé" vale
	w := chamar(h, "POST", "/invite-user", `{"resetPasswordUserId":"`+toks["viewer-id"]+`","password":"ééé"}`, toks["super"])
	if w.Code != 400 || !strings.Contains(w.Body.String(), "no mínimo 6") {
		t.Fatalf("reset com 3 caracteres = %d %s", w.Code, w.Body)
	}
	entrar(t, h, "viewer@x.com", "s3nha")
	if w := chamar(h, "POST", "/invite-user", `{"resetPasswordUserId":"`+toks["viewer-id"]+`","password":"éééééé"}`, toks["super"]); w.Code != 200 {
		t.Fatalf("reset com 6 caracteres = %d %s", w.Code, w.Body)
	}
	// criar: com 3 caracteres não nasce conta com essa senha (como na edge, vira convite por e-mail)
	if w := chamar(h, "POST", "/invite-user", `{"email":"curta@x.com","password":"ééé"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("criar com 3 caracteres = %d %s", w.Code, w.Body)
	}
	var comSenha bool
	c.Pool.QueryRow(ctx, `select senha_hash is not null from usuarios where email = 'curta@x.com'`).Scan(&comSenha)
	if comSenha {
		t.Fatal("a conta nasceu com a senha de 3 caracteres")
	}
	if w := chamar(h, "POST", "/auth/entrar", `{"email":"curta@x.com","senha":"ééé"}`, ""); w.Code == 200 {
		t.Fatal("entrou com a senha de 3 caracteres")
	}
	if w := chamar(h, "POST", "/invite-user", `{"email":"longa@x.com","password":"éééééé"}`, toks["admin"]); w.Code != 200 {
		t.Fatalf("criar com 6 caracteres = %d %s", w.Code, w.Body)
	}
	entrar(t, h, "longa@x.com", "éééééé")
}

// m4: o reset roda com a identidade do ator e passa pelos gatilhos de profiles (a edge escrevia
// como service_role, que o guard_profiles deixa passar). A frase do RAISE chega à tela (400) e a
// transação volta inteira; um erro nativo do banco não vaza.
func TestInviteUserRaiseDoGatilhoVira400ComAFrase(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	ctx := context.Background()
	alvo := toks["viewer-id"]
	c.Pool.Exec(ctx, `create function barra_fn() returns trigger language plpgsql as $f$ begin
	    raise exception 'Só um super-admin da lista pode mexer neste perfil' using errcode = 'P0001'; end $f$`)
	c.Pool.Exec(ctx, `create trigger barra_t before update on profiles for each row execute function barra_fn()`)
	antes := fotoDeContas(t, c)
	w := chamar(h, "POST", "/invite-user", `{"resetPasswordUserId":"`+alvo+`","password":"provisoria"}`, toks["super"])
	if w.Code != 400 || strings.TrimSpace(w.Body.String()) != `{"error":"Só um super-admin da lista pode mexer neste perfil"}` {
		t.Fatalf("reset barrado pelo gatilho = %d %s", w.Code, w.Body)
	}
	if depois := fotoDeContas(t, c); depois != antes {
		t.Fatalf("o reset barrado deixou resto:\n antes  %s\n depois %s", antes, depois)
	}
	entrar(t, h, "viewer@x.com", "s3nha") // a senha antiga continua valendo (e o login abre uma sessão: nova foto)
	antes = fotoDeContas(t, c)
	// o mesmo para excluir e criar
	c.Pool.Exec(ctx, `drop trigger barra_t on profiles`)
	c.Pool.Exec(ctx, `create trigger barra_t before delete or insert on profiles for each row execute function barra_fn()`)
	for _, corpo := range []string{`{"deleteUserId":"` + alvo + `"}`, `{"email":"nova@x.com","password":"senha-boa"}`, `{"email":"nova2@x.com"}`} {
		w := chamar(h, "POST", "/invite-user", corpo, toks["admin"])
		if w.Code != 400 || !strings.Contains(w.Body.String(), "Só um super-admin da lista") {
			t.Errorf("%s = %d %s", corpo, w.Code, w.Body)
		}
	}
	if depois := fotoDeContas(t, c); depois != antes {
		t.Fatalf("recusado pelo gatilho e mesmo assim mudou o banco:\n antes  %s\n depois %s", antes, depois)
	}
	// erro nativo (não é RAISE nosso) continua 500 sem texto do banco
	c.Pool.Exec(ctx, `drop trigger barra_t on profiles`)
	c.Pool.Exec(ctx, `alter table profiles add constraint so_perfil_ok check (precisa_trocar_senha = false)`)
	w = chamar(h, "POST", "/invite-user", `{"resetPasswordUserId":"`+alvo+`","password":"provisoria"}`, toks["super"])
	if w.Code != 500 || strings.Contains(w.Body.String(), "so_perfil_ok") || strings.Contains(w.Body.String(), "profiles") {
		t.Fatalf("erro nativo = %d %s", w.Code, w.Body)
	}
}

// m5: a troca de senha pelo super-admin derruba também as sessões em que o alvo é o IMPERSONADOR
// e mata os links de senha ainda vivos do alvo (podem ter vazado).
func TestInviteUserResetDerrubaSessoesComoImpersonadorELinksVivos(t *testing.T) {
	c, _, h, toks := montarConvite(t)
	ctx := context.Background()
	alvo := toks["viewer-id"]
	// o alvo entrou como o admin (sessão do admin com impersonador_id = alvo)
	comoAdmin, err := c.Sessoes.Criar(ctx, toks["admin-id"], "painel", &alvo)
	if err != nil {
		t.Fatal(err)
	}
	c.Pool.Exec(ctx, `insert into tokens_de_senha (token_hash, usuario_id, tipo, expira_em) values ('vivo-1', $1::uuid, 'recuperacao', now() + interval '1 hour'), ('vivo-2', $1::uuid, 'convite', now() + interval '1 day')`, alvo)
	c.Pool.Exec(ctx, `insert into tokens_de_senha (token_hash, usuario_id, tipo, expira_em) values ('vivo-do-outro', $1::uuid, 'recuperacao', now() + interval '1 hour')`, toks["admin-id"])
	if w := chamar(h, "POST", "/invite-user", `{"resetPasswordUserId":"`+alvo+`","password":"provisoria"}`, toks["super"]); w.Code != 200 {
		t.Fatalf("reset = %d %s", w.Code, w.Body)
	}
	if _, err := c.Sessoes.Buscar(ctx, comoAdmin); err != ErrSessaoInvalida {
		t.Fatalf("a sessão aberta pelo alvo como outra pessoa continuou: %v", err)
	}
	var doAlvo, doOutro int
	c.Pool.QueryRow(ctx, `select count(*) filter (where usuario_id = $1::uuid), count(*) filter (where usuario_id = $2::uuid) from tokens_de_senha where usado_em is null`, alvo, toks["admin-id"]).Scan(&doAlvo, &doOutro)
	if doAlvo != 0 || doOutro != 1 {
		t.Fatalf("links vivos: do alvo %d (esperava 0), de outra pessoa %d (esperava 1)", doAlvo, doOutro)
	}
}

// m7: o link do e-mail só leva a um endereço do app; Origin forjado cai no padrão.
func TestInviteUserOrigemForjadaNaoViraLink(t *testing.T) {
	_, cor, h, toks := montarConvite(t)
	pedir := func(origem, corpo string) string {
		r := httptest.NewRequest("POST", "/invite-user", strings.NewReader(corpo))
		r.Header.Set("Authorization", "Bearer "+toks["admin"])
		r.Header.Set("Origin", origem)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != 200 {
			t.Fatalf("%s = %d %s", corpo, w.Code, w.Body)
		}
		env := cor.lista()
		m := reLink.FindStringSubmatch(env[len(env)-1].texto)
		if m == nil {
			t.Fatalf("sem link em %+v", env[len(env)-1])
		}
		return m[1]
	}
	for _, corpo := range []string{`{"email":"forja1@x.com"}`, `{"email":"viewer@x.com"}`} { // convite novo e troca de quem já existe
		if got := pedir("https://central.exemplo.ladrao.net", corpo); got != padrao {
			t.Errorf("%s: origem forjada levou o link para %s", corpo, got)
		}
		if got := pedir("", corpo); got != padrao {
			t.Errorf("%s: sem origem levou o link para %s", corpo, got)
		}
		if got := pedir(central, corpo); got != central {
			t.Errorf("%s: origem do app levou o link para %s", corpo, got)
		}
	}
}
