// Package trafego: as rotas do sub-plano 5.7 — a Gestão de Tráfego: a fila (análises de orçamento e de
// anúncio do robô, decisões), os rascunhos do assistente de campanha, a configuração de métricas, os
// objetivos por interação, a régua da métrica ponderada (com histórico), as sugestões de interesse e a
// RPC gt_registrar_problemas. Regra de toda tabela = catálogo de produção (autz.Producao: "gestor" é papel
// admin ou 'meta.gestor' em features; a restritiva pode_ver_conta em 5 das 10). Escrita em
// banco.ComUsuario; "entrar como" só lê. Os proxies de IA moram em internal/ia e o de mapa em
// internal/mapa (Ruling 5.7-2).
package trafego

import (
	"encoding/json"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

// filtroConta: account_id das gt_* é TEXTO (a policy é pode_ver_conta(account_id), sem cast). Toda
// leitura com a restritiva declara este filtro e projeta account_id (Ruling 5.7-4): é por ele que a
// varredura da Task 11 acha vazamento.
var filtroConta = dados.Filtro{Param: "account_id", SQL: "t.account_id = @account_id::text", Tipo: "texto"}

var (
	reUUID     = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	reIDDaMeta = regexp.MustCompile(`^[0-9]{1,30}$`) // id de campanha/anúncio na Meta
)

// agora: relógio do servidor para updated_at (o do navegador era falsificável: Ruling 5.6-13).
func agora() string { return time.Now().UTC().Format(time.RFC3339Nano) }

// escopoOu500: rota montada fora de autz.ComEscopo é defeito de montagem (nada gravado).
func escopoOu500(w http.ResponseWriter, r *http.Request) *autz.Escopo {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
	}
	return e
}

// texto: o valor JSON é texto? (null, número, objeto: não)
func texto(v json.RawMessage) (string, bool) {
	var s string
	if len(v) == 0 || v[0] != '"' || json.Unmarshal(v, &s) != nil {
		return "", false
	}
	return s, true
}

func textoEm(v json.RawMessage, opcoes ...string) bool {
	s, ok := texto(v)
	return ok && slices.Contains(opcoes, s)
}

func casa(v json.RawMessage, re *regexp.Regexp) bool {
	s, ok := texto(v)
	return ok && re.MatchString(s)
}

// textoAte: texto de até max caracteres; vazio (ou só espaço) só se vazioPode.
func textoAte(v json.RawMessage, max int, vazioPode bool) bool {
	s, ok := texto(v)
	return ok && utf8.RuneCountInString(s) <= max && (vazioPode || strings.TrimSpace(s) != "")
}

func objeto(v json.RawMessage) bool {
	var m map[string]json.RawMessage
	return len(v) > 0 && v[0] == '{' && json.Unmarshal(v, &m) == nil
}

func nulo(v json.RawMessage) bool { return strings.TrimSpace(string(v)) == "null" }

func inteiroEntre(v json.RawMessage, min, max int64) bool {
	var n int64
	return json.Unmarshal(v, &n) == nil && n >= min && n <= max
}
