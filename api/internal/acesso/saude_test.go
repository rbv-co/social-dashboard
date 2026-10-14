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
		{nome: "sem sessão", metodo: "GET", caminho: "/saude/conferencias", status: 401},
		// a regra restritiva so_contas_permitidas: conta fora de allowed_accounts nunca aparece
		{nome: "viewer vê a conta A1 e a sem conta, nunca a A2", quem: "viewer", metodo: "GET", caminho: "/saude/conferencias", status: 200, tem: "conta A1", naoTem: "conta A2"},
		{nome: "viewer vê a linha sem conta", quem: "viewer", metodo: "GET", caminho: "/saude/conferencias", status: 200, tem: "sem conta"},
		// pode_ver_conta: papel admin passa por cima da trava de contas (allowed_accounts)
		{nome: "adminRestrito (papel admin com trava) vê as 3", quem: "adminRestrito", metodo: "GET", caminho: "/saude/conferencias", status: 200, tem: "conta A2"},
		{nome: "sem perfil: a regra restritiva nega tudo", quem: "semPerfil", metodo: "GET", caminho: "/saude/conferencias", status: 200, tem: "[]", naoTem: "conta"},
		{nome: "admin vê as 3", quem: "admin", metodo: "GET", caminho: "/saude/conferencias", status: 200, tem: "conta A2"},
		{nome: "semTrava (allowed_accounts nulo) vê as 3", quem: "semTrava", metodo: "GET", caminho: "/saude/conferencias", status: 200, tem: "conta A2"},
		{nome: "filtros combinados, só as falhas visíveis", quem: "viewer", metodo: "GET", caminho: "/saude/conferencias?checked_date=2026-10-11&status=fail", status: 200, tem: "conta A1", naoTem: "conta A2"},
		{nome: "filtro de status exclui o aviso", quem: "admin", metodo: "GET", caminho: "/saude/conferencias?status=fail", status: 200, tem: "conta A2", naoTem: "sem conta"},
		{nome: "data fora do formato", quem: "admin", metodo: "GET", caminho: "/saude/conferencias?checked_date=11/10/2026", status: 400},
		{nome: "ordem fora da lista", quem: "admin", metodo: "GET", caminho: "/saude/conferencias?ordem=detail", status: 400},
		{nome: "parâmetro desconhecido não vira filtro", quem: "admin", metodo: "GET", caminho: "/saude/conferencias?check_name=coleta_zerada", status: 400},
		{nome: "só leitura: POST não existe", quem: "admin", metodo: "POST", caminho: "/saude/conferencias", corpo: `{}`, status: 405},
	})

	if _, corpo := m.pedir(t, "semPerfil", "GET", "/saude/conferencias", ""); strings.TrimSpace(corpo) != "[]" {
		t.Errorf("sem perfil = %s, esperava exatamente []", corpo)
	}

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

	// ordem padrão created_at desc: as três linhas do seed nascem no mesmo instante, então datas distintas
	// (a mais nova é a meta_spotcheck, a mais velha a A1)
	if _, err := m.p.Exec(context.Background(), `update data_integrity_checks set created_at = case detail
		when 'conta A1' then '2026-10-11T08:00:00Z'::timestamptz when 'conta A2' then '2026-10-11T09:00:00Z'::timestamptz
		else '2026-10-11T10:00:00Z'::timestamptz end`); err != nil {
		t.Fatal(err)
	}
	var ordem []map[string]any
	if _, corpo := m.pedir(t, "admin", "GET", "/saude/conferencias", ""); json.Unmarshal([]byte(corpo), &ordem) != nil || len(ordem) != 3 ||
		ordem[0]["detail"] != "sem conta" || ordem[1]["detail"] != "conta A2" || ordem[2]["detail"] != "conta A1" {
		t.Errorf("a ordem padrão não é created_at desc: %s", corpo)
	}
	// ?ordem=checked_date.desc&limite=1 devolve 1 linha
	var l []map[string]any
	if _, corpo := m.pedir(t, "admin", "GET", "/saude/conferencias?ordem=checked_date.desc&limite=1", ""); json.Unmarshal([]byte(corpo), &l) != nil || len(l) != 1 {
		t.Fatalf("limite=1 devolveu %d linhas: %s", len(l), corpo)
	}
}
