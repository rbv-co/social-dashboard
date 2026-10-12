package acesso

import (
	"context"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

const (
	rGrupos = "/equipes/grupos"
	rSupers = "/equipes/grupos-membros"
)

func contaGrupos() string { return `select count(*)::text from canais_grupos` }
func contaCgm() string    { return `select count(*)::text from canais_grupos_membros` }

// Leitura de grupos: qualquer sessão lê (canais_grupos_leitura: true), com a ordem pelo nome.
func TestGruposLeitura(t *testing.T) {
	m := mundoGrupos(t)
	m.rodar(t, []caso{
		{nome: "sem sessão", quem: "", metodo: "GET", caminho: rGrupos, status: 401},
		{nome: "vendedora lê os dois grupos", quem: "vendT1", metodo: "GET", caminho: rGrupos, status: 200, tem: `"nome":"Atacado"`},
		{nome: "vendedora lê o G1 também", quem: "vendT1", metodo: "GET", caminho: rGrupos, status: 200, tem: `"nome":"Varejo"`},
		{nome: "colunas do contrato", quem: "vendT1", metodo: "GET", caminho: rGrupos, status: 200, tem: `"ordem":0,"ativo":true,"criado_em":`},
		{nome: "impersonado lê", quem: "impersonado", metodo: "GET", caminho: rGrupos, status: 200, tem: `"nome":"Varejo"`},
		{nome: "query malformada", quem: "vendT1", metodo: "GET", caminho: rGrupos + "?ordem=x", status: 400},
	})
	if _, c := m.pedir(t, "vendT1", "GET", rGrupos+"?contar=1", ""); !strings.HasPrefix(c, "[") {
		t.Errorf("corpo %s", c)
	}
	// ordem pelo nome: Atacado antes de Varejo
	if _, c := m.pedir(t, "vendT1", "GET", rGrupos, ""); strings.Index(c, "Atacado") > strings.Index(c, "Varejo") {
		t.Errorf("ordem padrão não é pelo nome: %s", c)
	}
}

// Escrita de grupos: só super-admin PELA FICHA (o e-mail na lista não basta); renomear leva o nome às
// lojas (gatilho espelhar_rename_do_grupo); nome repetido = 409; apagar solta as lojas
// (on delete set null + gatilho espelhar_grupo_do_canal zera o texto).
func TestGruposEscrita(t *testing.T) {
	m := mundoGrupos(t)
	g := func(id string) string { return rGrupos + "/" + id }
	nome := func(id string) string { return `select nome from canais_grupos where id = '` + id + `'` }
	m.rodar(t, []caso{
		// criar
		{nome: "super cria", quem: "super", metodo: "POST", caminho: rGrupos, corpo: `{"nome":"Online"}`, status: 201, tem: `"nome":"Online"`,
			efeito: contaGrupos(), quer: "3"},
		{nome: "a ficha basta (viewer)", quem: "superFicha", metodo: "POST", caminho: rGrupos, corpo: `{"nome":"Feira"}`, status: 201,
			efeito: contaGrupos(), quer: "4"},
		{nome: "admin não cria", quem: "admin", metodo: "POST", caminho: rGrupos, corpo: `{"nome":"Hack"}`, status: 403, efeito: contaGrupos(), quer: "4"},
		{nome: "impersonando o super não cria", quem: "impersonadoSuper", metodo: "POST", caminho: rGrupos, corpo: `{"nome":"Hack"}`, status: 403,
			tem: "Quem entrou como outra pessoa", efeito: contaGrupos(), quer: "4"},
		{nome: "admin restrito não cria", quem: "adminRestrito", metodo: "POST", caminho: rGrupos, corpo: `{"nome":"Hack"}`, status: 403, efeito: contaGrupos(), quer: "4"},
		{nome: "e-mail na lista sem a ficha não cria", quem: "superSoPorEmail", metodo: "POST", caminho: rGrupos, corpo: `{"nome":"Hack"}`, status: 403, efeito: contaGrupos(), quer: "4"},
		{nome: "vendedora não cria", quem: "vendT1", metodo: "POST", caminho: rGrupos, corpo: `{"nome":"Hack"}`, status: 403, efeito: contaGrupos(), quer: "4"},
		{nome: "sem sessão", quem: "", metodo: "POST", caminho: rGrupos, corpo: `{"nome":"Hack"}`, status: 401, efeito: contaGrupos(), quer: "4"},
		{nome: "nome repetido (lower/btrim) = 409", quem: "super", metodo: "POST", caminho: rGrupos, corpo: `{"nome":" varejo "}`, status: 409, efeito: contaGrupos(), quer: "4"},
		{nome: "nome nulo = 400", quem: "super", metodo: "POST", caminho: rGrupos, corpo: `{"nome":null}`, status: 400, efeito: contaGrupos(), quer: "4"},
		{nome: "corpo vazio = 400", quem: "super", metodo: "POST", caminho: rGrupos, corpo: `{}`, status: 400, efeito: contaGrupos(), quer: "4"},
		{nome: "id no corpo = 400", quem: "super", metodo: "POST", caminho: rGrupos, corpo: `{"id":"` + T1 + `","nome":"Z"}`, status: 400, efeito: contaGrupos(), quer: "4"},
		{nome: "coluna fora do contrato = 400", quem: "super", metodo: "POST", caminho: rGrupos, corpo: `{"nome":"Z","ativo":false}`, status: 400, efeito: contaGrupos(), quer: "4"},
		// renomear (o gatilho de produção leva o nome à loja 3, do G1)
		{nome: "admin não renomeia", quem: "admin", metodo: "PATCH", caminho: g(G1), corpo: `{"nome":"Hack"}`, status: 403, efeito: nome(G1), quer: "Varejo"},
		{nome: "e-mail sem ficha não renomeia", quem: "superSoPorEmail", metodo: "PATCH", caminho: g(G1), corpo: `{"nome":"Hack"}`, status: 403, efeito: nome(G1), quer: "Varejo"},
		{nome: "renomear para nome de outro grupo = 409", quem: "super", metodo: "PATCH", caminho: g(G1), corpo: `{"nome":"ATACADO"}`, status: 409, efeito: nome(G1), quer: "Varejo"},
		{nome: "impersonando o super: 403 do portão, nada muda", quem: "impersonadoSuper", metodo: "PATCH", caminho: g(G1), corpo: `{"nome":"Hack"}`, status: 403,
			tem: "Quem entrou como outra pessoa", efeito: nome(G1), quer: "Varejo"},
		{nome: "id no corpo = 400", quem: "super", metodo: "PATCH", caminho: g(G1), corpo: `{"id":"` + G2 + `"}`, status: 400, efeito: nome(G1), quer: "Varejo"},
		{nome: "id que não existe = 404", quem: "super", metodo: "PATCH", caminho: g("c6000000-0000-4000-a000-0000000000ff"), corpo: `{"nome":"X"}`, status: 404},
		{nome: "id que não é uuid = 404", quem: "super", metodo: "PATCH", caminho: g("xx"), corpo: `{"nome":"X"}`, status: 404},
		{nome: "super renomeia", quem: "super", metodo: "PATCH", caminho: g(G1), corpo: `{"nome":"Varejo Físico"}`, status: 200, tem: `"nome":"Varejo Físico"`,
			efeito: `select grupo from bling_lojas where loja_id = 3`, quer: "Varejo Físico"},
		{nome: "a loja sem grupo segue sem", quem: "", efeito: `select coalesce(grupo, '<nulo>') from bling_lojas where loja_id = 1`, quer: "<nulo>"},
		// apagar
		{nome: "admin não apaga", quem: "admin", metodo: "DELETE", caminho: g(G1), status: 403, efeito: contaGrupos(), quer: "4"},
		{nome: "e-mail sem ficha não apaga", quem: "superSoPorEmail", metodo: "DELETE", caminho: g(G1), status: 403, efeito: contaGrupos(), quer: "4"},
		{nome: "impersonando o super não apaga", quem: "impersonadoSuper", metodo: "DELETE", caminho: g(G2), status: 403, tem: "Quem entrou como outra pessoa", efeito: contaGrupos(), quer: "4"},
		{nome: "apagar o que não existe = 404", quem: "super", metodo: "DELETE", caminho: g("c6000000-0000-4000-a000-0000000000ff"), status: 404},
		{nome: "super apaga o G2", quem: "super", metodo: "DELETE", caminho: g(G2), status: 204, efeito: contaGrupos(), quer: "3"},
		{nome: "apagar o G1 solta a loja 3 e zera o texto (espelhar_grupo_do_canal)", quem: "super", metodo: "DELETE", caminho: g(G1), status: 204,
			efeito: `select coalesce(grupo_id::text, '<nulo>') || '|' || coalesce(grupo, '<nulo>') from bling_lojas where loja_id = 3`, quer: "<nulo>|<nulo>"},
		{nome: "apagar o G1 apagou a supervisora (cascade)", quem: "", efeito: contaCgm(), quer: "0"},
	})
}

// O gatilho espelhar_rename_do_grupo, sozinho: só a loja do grupo muda; e criar não toca loja.
func TestGruposRenomearSoMexeNasLojasDoGrupo(t *testing.T) {
	m := mundoGrupos(t)
	m.rodar(t, []caso{
		{nome: "renomeia G2 (sem loja)", quem: "super", metodo: "PATCH", caminho: rGrupos + "/" + G2, corpo: `{"nome":"Atacado BR"}`, status: 200,
			efeito: `select coalesce(grupo, '<nulo>') from bling_lojas where loja_id = 3`, quer: "Varejo"},
		{nome: "renomeia G1: só a loja do G1 muda", quem: "super", metodo: "PATCH", caminho: rGrupos + "/" + G1, corpo: `{"nome":"Varejo BR"}`, status: 200,
			efeito: `select string_agg(loja_id || ':' || coalesce(grupo, '<nulo>'), ',' order by loja_id) from bling_lojas`, quer: "1:<nulo>,2:<nulo>,3:Varejo BR"},
	})
}

// Supervisoras de grupo: leitura = a própria linha OU pode_ver_grupo (a trava de escopo corta quem não
// é do grupo); escrita só pela ficha; autoria vem da sessão; quem não lê a linha recebe o 404 do inexistente.
func TestSupervisorasLeitura(t *testing.T) {
	m := mundoGrupos(t)
	m.rodar(t, []caso{
		{nome: "sem sessão", quem: "", metodo: "GET", caminho: rSupers, status: 401},
		{nome: "vendedora sem linha própria não vê a supervisora do G1", quem: "vendT1", metodo: "GET", caminho: rSupers, status: 200, naoTem: cgmSupervG1},
		{nome: "a própria supervisora vê", quem: "supervG1", metodo: "GET", caminho: rSupers, status: 200, tem: cgmSupervG1},
		{nome: "sem trava vê todas", quem: "semTrava", metodo: "GET", caminho: rSupers, status: 200, tem: cgmSupervG1},
		{nome: "super vê", quem: "super", metodo: "GET", caminho: rSupers, status: 200, tem: cgmSupervG1},
		{nome: "viewer com trava (conta A1) não vê", quem: "viewer", metodo: "GET", caminho: rSupers, status: 200, naoTem: cgmSupervG1},
		{nome: "filtro por grupo: sem trava", quem: "semTrava", metodo: "GET", caminho: rSupers + "?grupo_id=" + G1, status: 200, tem: cgmSupervG1},
		{nome: "filtro por grupo: o outro grupo não tem", quem: "semTrava", metodo: "GET", caminho: rSupers + "?grupo_id=" + G2, status: 200, naoTem: cgmSupervG1},
		{nome: "filtro por pessoa", quem: "semTrava", metodo: "GET", caminho: rSupers + "?profile_id=" + idSupervG1, status: 200, tem: cgmSupervG1},
		{nome: "filtro não vaza o que a regra corta", quem: "vendT1", metodo: "GET", caminho: rSupers + "?grupo_id=" + G1, status: 200, naoTem: cgmSupervG1},
		{nome: "filtro com uuid inválido = 400", quem: "semTrava", metodo: "GET", caminho: rSupers + "?grupo_id=x", status: 400},
		{nome: "impersonado lê pela regra do alvo (admin sem trava)", quem: "impersonado", metodo: "GET", caminho: rSupers, status: 200, tem: cgmSupervG1},
	})
	// vendT1 recebe a lista vazia, exatamente
	if st, c := m.pedir(t, "vendT1", "GET", rSupers, ""); st != 200 || strings.TrimSpace(c) != "[]" {
		t.Errorf("vendT1 = %d %s, esperava []", st, c)
	}
	if st, c := m.pedir(t, "supervG1", "GET", rSupers, ""); st != 200 || !strings.Contains(c, `"papel":"supervisora"`) || !strings.Contains(c, `"concedido_por":null`) {
		t.Errorf("supervG1 = %d %s", st, c)
	}
}

func TestSupervisorasEscrita(t *testing.T) {
	m := mundoGrupos(t)
	novo := `{"grupo_id":"` + G2 + `","profile_id":"` + idVendT1 + `"}`
	d := func(id string) string { return rSupers + "/" + id }
	m.rodar(t, []caso{
		{nome: "admin não concede", quem: "admin", metodo: "POST", caminho: rSupers, corpo: novo, status: 403, efeito: contaCgm(), quer: "1"},
		{nome: "e-mail sem ficha não concede", quem: "superSoPorEmail", metodo: "POST", caminho: rSupers, corpo: novo, status: 403, efeito: contaCgm(), quer: "1"},
		{nome: "a própria supervisora não concede", quem: "supervG1", metodo: "POST", caminho: rSupers, corpo: novo, status: 403, efeito: contaCgm(), quer: "1"},
		{nome: "impersonando o super não concede", quem: "impersonadoSuper", metodo: "POST", caminho: rSupers, corpo: novo, status: 403,
			tem: "Quem entrou como outra pessoa", efeito: contaCgm(), quer: "1"},
		{nome: "papel fora da lista = 400", quem: "super", metodo: "POST", caminho: rSupers, corpo: `{"grupo_id":"` + G2 + `","profile_id":"` + idVendT1 + `","papel":"gestora"}`, status: 400, efeito: contaCgm(), quer: "1"},
		{nome: "concedido_por no corpo = 400", quem: "super", metodo: "POST", caminho: rSupers, corpo: `{"grupo_id":"` + G2 + `","profile_id":"` + idVendT1 + `","concedido_por":"` + idAdmin + `"}`, status: 400, efeito: contaCgm(), quer: "1"},
		{nome: "id no corpo = 400", quem: "super", metodo: "POST", caminho: rSupers, corpo: `{"id":"` + T1 + `","grupo_id":"` + G2 + `","profile_id":"` + idVendT1 + `"}`, status: 400, efeito: contaCgm(), quer: "1"},
		{nome: "sem profile_id = 400", quem: "super", metodo: "POST", caminho: rSupers, corpo: `{"grupo_id":"` + G2 + `"}`, status: 400, efeito: contaCgm(), quer: "1"},
		{nome: "grupo que não existe = 409", quem: "super", metodo: "POST", caminho: rSupers, corpo: `{"grupo_id":"c6000000-0000-4000-a000-0000000000ff","profile_id":"` + idVendT1 + `"}`, status: 409, efeito: contaCgm(), quer: "1"},
		{nome: "par repetido = 409", quem: "super", metodo: "POST", caminho: rSupers, corpo: `{"grupo_id":"` + G1 + `","profile_id":"` + idSupervG1 + `"}`, status: 409, efeito: contaCgm(), quer: "1"},
		{nome: "super concede; autoria = a sessão, papel = supervisora", quem: "super", metodo: "POST", caminho: rSupers, corpo: novo, status: 201,
			tem: `"concedido_por":"` + idSuper + `"`, efeito: `select concedido_por::text || '|' || papel from canais_grupos_membros where profile_id = '` + idVendT1 + `'`, quer: idSuper + "|supervisora"},
		{nome: "a ficha basta, e a autoria é dela", quem: "superFicha", metodo: "POST", caminho: rSupers, corpo: `{"grupo_id":"` + G2 + `","profile_id":"` + idVendT2 + `"}`, status: 201,
			efeito: `select concedido_por::text from canais_grupos_membros where profile_id = '` + idVendT2 + `'`, quer: idSuperFicha},
		// apagar: IDOR e portões
		{nome: "vendedora sem leitura da linha: 404 (como o inexistente)", quem: "vendT1", metodo: "DELETE", caminho: d(cgmSupervG1), status: 404,
			efeito: contaCgm(), quer: "3"},
		{nome: "sem trava lê a linha mas não é super: 403", quem: "semTrava", metodo: "DELETE", caminho: d(cgmSupervG1), status: 403, efeito: contaCgm(), quer: "3"},
		{nome: "e-mail sem ficha: 403", quem: "superSoPorEmail", metodo: "DELETE", caminho: d(cgmSupervG1), status: 403, efeito: contaCgm(), quer: "3"},
		{nome: "a própria supervisora não se remove", quem: "supervG1", metodo: "DELETE", caminho: d(cgmSupervG1), status: 403, efeito: contaCgm(), quer: "3"},
		{nome: "impersonando o super não apaga", quem: "impersonadoSuper", metodo: "DELETE", caminho: d(cgmSupervG1), status: 403,
			tem: "Quem entrou como outra pessoa", efeito: contaCgm(), quer: "3"},
		{nome: "id que não é uuid = 404", quem: "super", metodo: "DELETE", caminho: d("xx"), status: 404},
		{nome: "super apaga", quem: "super", metodo: "DELETE", caminho: d(cgmSupervG1), status: 204, efeito: contaCgm(), quer: "2"},
	})
	// IDOR: o 404 de quem não lê a linha é igual ao do id que não existe (não revela que existe)
	_, inexistente := m.pedir(t, "vendT1", "DELETE", d("3c000000-0000-4000-a000-0000000000ff"), "")
	m2 := mundoGrupos(t)
	st, existente := m2.pedir(t, "vendT1", "DELETE", d(cgmSupervG1), "")
	if st != 404 || existente != inexistente {
		t.Errorf("IDOR: existente = %d %q, inexistente = %q", st, existente, inexistente)
	}
}

// Quem concede é a pessoa da sessão: o default auth.uid() de concedido_por e o gatilho de produção
// não são o que grava a autoria — é Tabela.Autor. Com a coluna nula nada mais denuncia quem concedeu.
func TestSupervisoraConcedidaPorQuemPede(t *testing.T) {
	m := mundoGrupos(t)
	for _, quem := range []string{"super", "superFicha", "erick"} {
		st, c := m.pedir(t, quem, "POST", rSupers, `{"grupo_id":"`+G2+`","profile_id":"`+idVendT1+`"}`)
		if st != 201 {
			t.Fatalf("%s: %d %s", quem, st, c)
		}
		if v := m.um(t, `select concedido_por::text from canais_grupos_membros where grupo_id = '`+G2+`' and profile_id = '`+idVendT1+`'`); v == "<nulo>" || v == "" {
			t.Errorf("%s: concedido_por nulo", quem)
		}
		if _, err := m.p.Exec(context.Background(), `delete from canais_grupos_membros where grupo_id = $1::uuid and profile_id = $2::uuid`, G2, idVendT1); err != nil {
			t.Fatal(err)
		}
	}
}

// mundoGrupos: o mundo com as rotas de grupos e uma sessão aberta por "entrar como" num super-admin
// (impersonadoSuper): nela a regra do catálogo deixaria escrever; só o portão soSessaoPropria recusa.
func mundoGrupos(t *testing.T) *mundo {
	t.Helper()
	m := novoMundo(t, montarGrupos)
	super := idSuper
	tok, err := auth.NovoStore(m.p).Criar(context.Background(), idSuperFicha, "painel", &super)
	if err != nil {
		t.Fatal(err)
	}
	m.tok["impersonadoSuper"] = tok
	return m
}
