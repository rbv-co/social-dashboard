// Package fabrica: a Fábrica de Anúncios. A purga diária (worker, Plano 4) e as rotas do sub-plano 5.8:
// leituras do painel (dados.Consulta, regra do catálogo; fabrica_marcas com a restritiva pode_ver_conta),
// a escolha de criativos (catálogo), as 5 edges portadas (fabrica-trigger, -apagar, -candidatos, -looks,
// -publicos; portão Fabricante, que é a policy de escrita de produção) e as rotas de robô /fabrica/robo/…
// (auth.SoServico + o perfil do robô). Escrita em banco.ComUsuario; "entrar como" só lê (Ruling 5.8-3).
package fabrica

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Fabricante: exists(profiles p where p.id = auth.uid() and (p.role = 'admin' or p.is_superadmin = true
// or p.permissions ? 'meta.fabrica')) — fab_camp_write/fab_criativos_write de produção, que o catálogo
// compila igual (TestFabricanteIgualAPolicy compara pessoa a pessoa). É o portão das edges portadas e das
// rotas de robô, cujas tabelas só a chave de serviço gravava (Ruling 5.8-3).
var Fabricante = autz.Regra(func(e *autz.Escopo) bool {
	return e != nil && e.TemPerfil && e.Ativo && (e.Papel == "admin" || e.SuperFicha || e.Chaves["meta.fabrica"])
})

// soFabricante: depois de autz.ComEscopo. Sem escopo (rota montada fora do grupo) nega: falha fechada.
func soFabricante(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !Fabricante(autz.EscopoDo(r.Context())) {
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
			return
		}
		next.ServeHTTP(w, r)
	})
}

var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// soPainel: as escritas do painel recusam conta de serviço (um token de robô com meta.fabrica não dispara,
// não apaga nem cura; o robô tem as rotas /fabrica/robo/…). Depois de auth.Exigir.
func soPainel(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a := auth.AtorDoContexto(r.Context()); a == nil || a.Tipo == "servico" {
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

var (
	reUUID      = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	reChaveLook = regexp.MustCompile(`^[a-z0-9][a-z0-9_-]{0,79}$`) // chave de fabrica_looks (templates.mjs, IA_LOOKS)
	reRunID     = regexp.MustCompile(`^[0-9]{1,20}$`)              // id de execução do GitHub Actions
)

// errPedido: entrada inválida descoberta dentro da transação; escritaOuPedido responde 400 com a frase.
type errPedido struct{ frase string }

func (e errPedido) Error() string { return e.frase }

func escritaOuPedido(w http.ResponseWriter, err error) {
	var ep errPedido
	if errors.As(err, &ep) {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", ep.frase)
		return
	}
	dados.ErroDeEscrita(w, err)
}

// responder: o corpo das edges portadas ({"error": código, "detail": frase}, {"ok": true}, {"job_id": …}),
// que as telas já leem; montado em Go porque não vem de tabela.
func responder(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// texto: o valor JSON é texto? (null, número, objeto: não)
func texto(v json.RawMessage) (string, bool) {
	var s string
	if len(v) == 0 || v[0] != '"' || json.Unmarshal(v, &s) != nil {
		return "", false
	}
	return s, true
}

// textoAte: texto de até max caracteres; vazio (ou só espaço) só se vazioPode.
func textoAte(v json.RawMessage, max int, vazioPode bool) bool {
	s, ok := texto(v)
	return ok && utf8.RuneCountInString(s) <= max && (vazioPode || strings.TrimSpace(s) != "")
}

func casa(v json.RawMessage, re *regexp.Regexp) bool {
	s, ok := texto(v)
	return ok && re.MatchString(s)
}

func nulo(v json.RawMessage) bool { return strings.TrimSpace(string(v)) == "null" }

func objeto(v json.RawMessage) bool {
	var m map[string]json.RawMessage
	return len(v) > 0 && v[0] == '{' && json.Unmarshal(v, &m) == nil
}

func lista(v json.RawMessage) bool {
	var l []json.RawMessage
	return len(v) > 0 && v[0] == '[' && json.Unmarshal(v, &l) == nil
}

func booleano(v json.RawMessage) bool { s := string(v); return s == "true" || s == "false" }

func textoEm(v json.RawMessage, opcoes ...string) bool {
	s, ok := texto(v)
	return ok && slices.Contains(opcoes, s)
}

// textoOuNulo: ausente, null ou texto de até max caracteres (vazio pode).
func textoOuNulo(v json.RawMessage, max int) bool {
	return len(v) == 0 || nulo(v) || textoAte(v, max, true)
}

// numeroOuNulo: ausente, null ou número ≥ 0.
func numeroOuNulo(v json.RawMessage) bool {
	var f float64
	return len(v) == 0 || nulo(v) || (json.Unmarshal(v, &f) == nil && f >= 0)
}

// inteiroOuNulo: ausente, null ou inteiro ≥ 0 (cabe em bigint).
func inteiroOuNulo(v json.RawMessage) bool {
	var n int64
	return len(v) == 0 || nulo(v) || (json.Unmarshal(v, &n) == nil && n >= 0)
}

// urlValida: http(s) absoluto, com host, até 2000 caracteres (o endereço público do arquivo; quem lê é a Meta).
func urlValida(v json.RawMessage) bool {
	s, ok := texto(v)
	if !ok || utf8.RuneCountInString(s) > 2000 {
		return false
	}
	u, err := url.Parse(s)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Host != "" && u.User == nil
}
