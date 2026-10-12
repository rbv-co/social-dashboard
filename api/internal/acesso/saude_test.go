package acesso

import (
	"context"
	"encoding/json"
	"sort"
	"strings"
	"testing"
)

func TestSaude(t *testing.T) {
	m := novoMundo(t, montarSaude)
	m.rodar(t, []caso{
		{nome: "sem sessão (conferências)", metodo: "GET", caminho: "/saude/conferencias", status: 401},
		{nome: "sem sessão (execuções)", metodo: "GET", caminho: "/saude/ia-execucoes", status: 401},
		// a regra restritiva so_contas_permitidas: conta fora de allowed_accounts nunca aparece
		{nome: "viewer vê a conta A1 e a sem conta, nunca a A2", quem: "viewer", metodo: "GET", caminho: "/saude/conferencias", status: 200, tem: "conta A1", naoTem: "conta A2"},
		{nome: "viewer vê a linha sem conta", quem: "viewer", metodo: "GET", caminho: "/saude/conferencias", status: 200, tem: "sem conta"},
		// pode_ver_conta: papel admin passa por cima da trava de contas (allowed_accounts)
		{nome: "adminRestrito (papel admin com trava) vê as 3", quem: "adminRestrito", metodo: "GET", caminho: "/saude/conferencias", status: 200, tem: "conta A2"},
		{nome: "sem perfil: a regra restritiva nega tudo", quem: "semPerfil", metodo: "GET", caminho: "/saude/conferencias", status: 200, tem: "[]"},
		{nome: "admin vê as 3", quem: "admin", metodo: "GET", caminho: "/saude/conferencias", status: 200, tem: "conta A2"},
		{nome: "semTrava (allowed_accounts nulo) vê as 3", quem: "semTrava", metodo: "GET", caminho: "/saude/conferencias", status: 200, tem: "conta A2"},
		{nome: "filtros combinados, só as falhas visíveis", quem: "viewer", metodo: "GET", caminho: "/saude/conferencias?checked_date=2026-10-11&status=fail", status: 200, tem: "conta A1", naoTem: "conta A2"},
		{nome: "filtro de status exclui o aviso", quem: "admin", metodo: "GET", caminho: "/saude/conferencias?status=fail", status: 200, tem: "conta A2", naoTem: "sem conta"},
		{nome: "data fora do formato", quem: "admin", metodo: "GET", caminho: "/saude/conferencias?checked_date=11/10/2026", status: 400},
		{nome: "ordem fora da lista", quem: "admin", metodo: "GET", caminho: "/saude/conferencias?ordem=detail", status: 400},
		{nome: "parâmetro desconhecido não vira filtro", quem: "admin", metodo: "GET", caminho: "/saude/conferencias?check_name=coleta_zerada", status: 400},
		{nome: "execuções: qualquer conta ativa lê (ia_exec_select: true)", quem: "viewer", metodo: "GET", caminho: "/saude/ia-execucoes", status: 200, tem: `"acao":"nova"`},
		{nome: "execuções: parâmetro desconhecido", quem: "admin", metodo: "GET", caminho: "/saude/ia-execucoes?robo=panorama", status: 400},
		{nome: "execuções: ordem fora da lista", quem: "admin", metodo: "GET", caminho: "/saude/ia-execucoes?ordem=usd", status: 400},
		{nome: "só leitura: POST não existe", quem: "admin", metodo: "POST", caminho: "/saude/conferencias", corpo: `{}`, status: 405},
		{nome: "só leitura: DELETE não existe", quem: "admin", metodo: "DELETE", caminho: "/saude/ia-execucoes", status: 405},
	})

	// as colunas exatas: nem uma a mais, nem uma a menos
	chaves := func(caminho string) string {
		_, corpo := m.pedir(t, "admin", "GET", caminho, "")
		var l []map[string]any
		if err := json.Unmarshal([]byte(corpo), &l); err != nil || len(l) == 0 {
			t.Fatalf("%s: %v %s", caminho, err, corpo)
		}
		var ks []string
		for k := range l[0] {
			ks = append(ks, k)
		}
		sort.Strings(ks)
		return strings.Join(ks, ",")
	}
	if g, q := chaves("/saude/conferencias"), "account_id,check_name,checked_date,created_at,detail,id,status"; g != q {
		t.Errorf("colunas das conferências = %s, esperava %s", g, q)
	}
	if g, q := chaves("/saude/ia-execucoes"), "acao,chamadas,created_at,detalhe,duracao_ms,github_run_id,id,input_tokens,itens,modelo,output_tokens,robo,run_at,status,unidade,usd"; g != q {
		t.Errorf("colunas das execuções = %s, esperava %s", g, q)
	}

	// ordem: padrão created_at desc; ?ordem=checked_date.desc&limite=1 devolve 1 linha
	var l []map[string]any
	if _, corpo := m.pedir(t, "admin", "GET", "/saude/conferencias?ordem=checked_date.desc&limite=1", ""); json.Unmarshal([]byte(corpo), &l) != nil || len(l) != 1 {
		t.Fatalf("limite=1 devolveu %d linhas: %s", len(l), corpo)
	}
	// execuções: nova antes de antiga, na ordem pedida e na padrão
	for _, q := range []string{"?ordem=run_at.desc&limite=200", ""} {
		_, corpo := m.pedir(t, "vendT1", "GET", "/saude/ia-execucoes"+q, "")
		if i, j := strings.Index(corpo, `"acao":"nova"`), strings.Index(corpo, `"acao":"antiga"`); i < 0 || j < 0 || i > j {
			t.Errorf("ordem das execuções %q: nova@%d antiga@%d em %s", q, i, j, corpo)
		}
	}
	_, corpo := m.pedir(t, "admin", "GET", "/saude/ia-execucoes?ordem=run_at.asc", "")
	if i, j := strings.Index(corpo, `"acao":"nova"`), strings.Index(corpo, `"acao":"antiga"`); i < j {
		t.Errorf("run_at.asc devia pôr antiga antes: %s", corpo)
	}
	// usd é número JSON com as casas do numeric(10,4), como o PostgREST
	m.p.Exec(context.Background(), `update ia_execucoes set usd = 1.5 where acao = 'nova'`)
	if _, corpo := m.pedir(t, "admin", "GET", "/saude/ia-execucoes", ""); !strings.Contains(corpo, `"usd":1.5000`) || !strings.Contains(corpo, `"usd":0.0000`) {
		t.Errorf("usd sem as casas: %s", corpo)
	}
}
