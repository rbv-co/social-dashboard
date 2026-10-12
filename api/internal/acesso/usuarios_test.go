package acesso

import (
	"context"
	"encoding/json"
	"testing"
)

func TestUsuariosLeitura(t *testing.T) {
	m := novoMundo(t, montarUsuarios)
	m.p.Exec(context.Background(), `update profiles set perfil_id = '`+perfilVendedora+`' where id = '`+idVendT1+`'`)
	m.rodar(t, []caso{
		{nome: "sem sessão", metodo: "GET", caminho: "/acesso/usuarios", status: 401},
		{nome: "conta ativa lê todos os perfis (auth_read_profiles)", quem: "vendT1", metodo: "GET", caminho: "/acesso/usuarios", status: 200, tem: `"email":"admin@x.com"`},
		{nome: "e-mail sem caixa", quem: "admin", metodo: "GET", caminho: "/acesso/usuarios?email=ADMIN@X.COM", status: 200, tem: idAdmin, naoTem: idViewer},
		{nome: "por perfil de acesso", quem: "admin", metodo: "GET", caminho: "/acesso/usuarios?perfil_id=" + perfilVendedora, status: 200, tem: idVendT1, naoTem: idVendT2},
		{nome: "id malformado", quem: "admin", metodo: "GET", caminho: "/acesso/usuarios?id=1%20or%201=1", status: 400},
		{nome: "ordem fora da lista", quem: "admin", metodo: "GET", caminho: "/acesso/usuarios?ordem=permissions", status: 400},
		{nome: "parâmetro desconhecido não vira filtro silencioso", quem: "admin", metodo: "GET", caminho: "/acesso/usuarios?role=admin", status: 400},
	})
	var l []map[string]any
	if _, corpo := m.pedir(t, "vendT1", "GET", "/acesso/usuarios", ""); json.Unmarshal([]byte(corpo), &l) != nil || len(l) != len(pessoas) {
		t.Fatalf("lista = %d pessoas, esperava %d", len(l), len(pessoas))
	}
	if w := m.resposta(t, "admin", "GET", "/acesso/usuarios?email=admin@x.com&contar=1", ""); w.Header().Get("X-Total-Count") != "1" {
		t.Fatalf("X-Total-Count = %q", w.Header().Get("X-Total-Count"))
	}
}

func TestEditarUsuario(t *testing.T) {
	m := novoMundo(t, montarUsuarios)
	u := func(id string) string { return "/acesso/usuarios/" + id }
	col := func(c, id string) string {
		return "select coalesce(" + c + "::text, '<nulo>') from profiles where id = '" + id + "'"
	}
	rastro := func(acao, ator string) string {
		return "select count(*)::text from audit_log where action = '" + acao + "' and actor_id = '" + ator + "'"
	}
	m.rodar(t, []caso{
		{"admin muda as permissões de outra pessoa", "admin", "PATCH", u(idVendT1), `{"permissions":{"frota":["ver"]},"features":["frota"]}`, 200, `"features":["frota"]`, "", col("permissions", idVendT1), `{"frota": ["ver"]}`},
		{"…e o gatilho registra QUEM mudou (a identidade chegou)", "", "", "", "", 0, "", "", rastro("acesso_change", idAdmin), "1"},
		{"viewer não edita perfil", "viewer", "PATCH", u(idVendT1), `{"disabled":true}`, 403, "sem_permissao", "", col("disabled", idVendT1), "false"},
		{"super pela ficha com papel viewer não edita (a policy lê role = 'admin')", "superFicha", "PATCH", u(idVendT1), `{"disabled":true}`, 403, "", "", col("disabled", idVendT1), "false"},
		{"gestor de time não edita perfil", "gestorT1", "PATCH", u(idVendT1), `{"disabled":true}`, 403, "", "", col("disabled", idVendT1), "false"},
		{"admin comum não muda cargo (guard_profiles)", "admin", "PATCH", u(idVendT1), `{"role":"admin"}`, 400, "Apenas o superadmin pode alterar o cargo", "", col("role", idVendT1), "viewer"},
		{"super por e-mail muda cargo, com rastro", "super", "PATCH", u(idVendT2), `{"role":"admin"}`, 200, `"role":"admin"`, "", rastro("role_change", idSuper), "1"},
		{"admin não mexe no próprio acesso (impedir_autopromocao)", "admin", "PATCH", u(idAdmin), `{"permissions":{"tudo":["ver"]}}`, 403, "", "", col("permissions", idAdmin), "{}"},
		{"admin não mexe no perfil do erick (guard_profiles)", "admin", "PATCH", u(idErick), `{"disabled":true}`, 400, "perfil do superadmin", "", col("disabled", idErick), "false"},
		{"lista de contas", "admin", "PATCH", u(idViewer), `{"allowed_accounts":["` + A2 + `"]}`, 200, A2, "", col("allowed_accounts", idViewer), "{" + A2 + "}"},
		{"chave ausente não muda", "admin", "PATCH", u(idViewer), `{"disabled":false}`, 200, "", "", col("allowed_accounts", idViewer), "{" + A2 + "}"},
		{"null explícito: vê todas as contas", "admin", "PATCH", u(idViewer), `{"allowed_accounts":null}`, 200, `"allowed_accounts":null`, "", col("allowed_accounts", idViewer), "<nulo>"},
		{"permissions tem de ser objeto", "admin", "PATCH", u(idVendT1), `{"permissions":["frota"]}`, 400, "objeto", "", col("permissions", idVendT1), `{"frota": ["ver"]}`},
		{"tipo que a coluna não aceita", "admin", "PATCH", u(idVendT1), `{"is_superadmin":"sim"}`, 400, "pedido_invalido", "", col("is_superadmin", idVendT1), "false"},
		{"coluna que nenhuma tela grava", "admin", "PATCH", u(idVendT1), `{"email":"x@y.com"}`, 400, "corpo_invalido", "", col("email", idVendT1), "vendt1@x.com"},
		{"id que não existe", "admin", "PATCH", u("5e000000-0000-4000-a000-000000000099"), `{"disabled":true}`, 404, "nao_encontrado", "", "", ""},
		{"id malformado", "admin", "PATCH", u("nao-e-uuid"), `{"disabled":true}`, 404, "nao_encontrado", "", "", ""},
		{"entrar-como não edita (Ruling 5.1-4)", "impersonado", "PATCH", u(idVendT1), `{"disabled":true}`, 403, "Quem entrou como outra pessoa", "", col("disabled", idVendT1), "false"},
		{"o resto do que as telas gravam", "admin", "PATCH", u(idVendT1), `{"avatar_url":"https://x/a.png","precisa_trocar_senha":true,"perfil_id":"` + perfilVendedora + `","permissions_excecao":{}}`, 200, perfilVendedora, "", col("precisa_trocar_senha", idVendT1), "true"},
		{"ACHADO (Ruling 5.1-3): admin comum marca super-admin de outra conta — paridade com produção", "admin", "PATCH", u(idVendT1), `{"is_superadmin":true}`, 200, "", "", col("is_superadmin", idVendT1), "true"},
	})
}

// Observação (achado 5.1): a sessão `painel` de quem não tem linha em profiles lê a lista da equipe,
// como em produção (auth_read_profiles pede só `auth.uid() is not null` + conta ativa); não edita.
func TestUsuariosSemPerfilEPortoes(t *testing.T) {
	m := novoMundo(t, montarUsuarios)
	u := func(id string) string { return "/acesso/usuarios/" + id }
	col := func(c, id string) string {
		return "select coalesce(" + c + "::text, '<nulo>') from profiles where id = '" + id + "'"
	}
	m.rodar(t, []caso{
		{nome: "sessão sem perfil lê a lista (paridade com produção)", quem: "semPerfil", metodo: "GET", caminho: "/acesso/usuarios", status: 200, tem: `"email":"admin@x.com"`},
		{nome: "sessão sem perfil não edita", quem: "semPerfil", metodo: "PATCH", caminho: u(idVendT1), corpo: `{"disabled":true}`, status: 403, efeito: col("disabled", idVendT1), quer: "false"},
		{nome: "a lista não traz nada além das colunas declaradas", quem: "viewer", metodo: "GET", caminho: "/acesso/usuarios?id=" + idAdmin, status: 200, naoTem: "password"},
		{nome: "super só por e-mail (ficha falsa, papel viewer) não edita: a policy lê role = 'admin'", quem: "superSoPorEmail", metodo: "PATCH", caminho: u(idVendT1), corpo: `{"disabled":true}`, status: 403, efeito: col("disabled", idVendT1), quer: "false"},
		{nome: "viewer não se promove", quem: "viewer", metodo: "PATCH", caminho: u(idViewer), corpo: `{"role":"admin"}`, status: 403, efeito: col("role", idViewer), quer: "viewer"},
		{nome: "admin não muda o próprio cargo (guard_profiles dispara antes de impedir_autopromocao)", quem: "admin", metodo: "PATCH", caminho: u(idAdmin), corpo: `{"role":"viewer"}`, status: 400, tem: "Apenas o superadmin pode alterar o cargo", efeito: col("role", idAdmin), quer: "admin"},
		{nome: "admin não se torna super", quem: "admin", metodo: "PATCH", caminho: u(idAdmin), corpo: `{"is_superadmin":true}`, status: 403, efeito: col("is_superadmin", idAdmin), quer: "false"},
		{nome: "admin não reabilita o próprio escopo (escopo_por_equipe)", quem: "admin", metodo: "PATCH", caminho: u(idAdmin), corpo: `{"allowed_accounts":["` + A1 + `"]}`, status: 403, efeito: col("allowed_accounts", idAdmin), quer: "<nulo>"},
		{nome: "admin restrito (trava + conta A1) edita pela policy do papel", quem: "adminRestrito", metodo: "PATCH", caminho: u(idVendT1), corpo: `{"features":["x"]}`, status: 200},
		{nome: "super por e-mail edita o perfil do erick, com rastro", quem: "super", metodo: "PATCH", caminho: u(idErick), corpo: `{"disabled":true}`, status: 200, efeito: col("disabled", idErick), quer: "true"},
		{nome: "impersonado (o super entrou como o admin) não edita", quem: "impersonado", metodo: "PATCH", caminho: u(idAdmin), corpo: `{"features":["x"]}`, status: 403, tem: "Quem entrou como outra pessoa", efeito: col("features", idAdmin), quer: "{}"},
		{nome: "sem sessão", metodo: "PATCH", caminho: u(idVendT1), corpo: `{"disabled":true}`, status: 401, efeito: col("disabled", idVendT1), quer: "false"},
	})
}

// Super-admin é a lista de e-mails de is_superadmin(), NÃO a coluna profiles.is_superadmin: o admin com a
// ficha marcada (e e-mail fora da lista) não passa pelos gatilhos; o da lista (ficha falsa) passa.
func TestUsuariosSuperEPorEmail(t *testing.T) {
	m := novoMundo(t, montarUsuarios)
	// montagem direta no banco (sem auth.uid(), os gatilhos confiam): vendT1 vira admin com a ficha marcada;
	// superSoPorEmail vira admin com a ficha falsa.
	if _, err := m.p.Exec(context.Background(), `update profiles set role = 'admin', is_superadmin = true where id = '`+idVendT1+`';
		update profiles set role = 'admin' where id = '`+idSuperSoPorEmail+`'`); err != nil {
		t.Fatal(err)
	}
	u := func(id string) string { return "/acesso/usuarios/" + id }
	col := func(c, id string) string {
		return "select coalesce(" + c + "::text, '<nulo>') from profiles where id = '" + id + "'"
	}
	m.rodar(t, []caso{
		{nome: "admin com a ficha marcada NÃO muda cargo (a ficha não é a lista)", quem: "vendT1", metodo: "PATCH", caminho: u(idVendT2), corpo: `{"role":"admin"}`, status: 400, tem: "Apenas o superadmin pode alterar o cargo", efeito: col("role", idVendT2), quer: "viewer"},
		{nome: "admin com a ficha marcada NÃO mexe no próprio acesso", quem: "vendT1", metodo: "PATCH", caminho: u(idVendT1), corpo: `{"permissions":{"x":["ver"]}}`, status: 403, efeito: col("permissions", idVendT1), quer: "{}"},
		{nome: "admin com a ficha marcada NÃO mexe no perfil do erick", quem: "vendT1", metodo: "PATCH", caminho: u(idErick), corpo: `{"disabled":true}`, status: 400, tem: "perfil do superadmin", efeito: col("disabled", idErick), quer: "false"},
		{nome: "admin da lista (ficha falsa) muda cargo", quem: "superSoPorEmail", metodo: "PATCH", caminho: u(idVendT2), corpo: `{"role":"admin"}`, status: 200, efeito: col("role", idVendT2), quer: "admin"},
		{nome: "admin da lista mexe no próprio acesso", quem: "superSoPorEmail", metodo: "PATCH", caminho: u(idSuperSoPorEmail), corpo: `{"features":["frota"]}`, status: 200, efeito: col("features", idSuperSoPorEmail), quer: "{frota}"},
	})
}
