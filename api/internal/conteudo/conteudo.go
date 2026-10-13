// Package conteudo: a Central de Conteúdo. Os robôs do Plano 4 (hora H: o aviso da peça agendada; espelho:
// casar a peça com o post do Instagram e medir) e as rotas do sub-plano 5.9: leituras do painel
// (dados.Consulta, regra do catálogo; a restritiva pode_ver_conta em peças, ideias, blocos e jobs; as filhas
// da peça presas a ela), escritas pelo catálogo com Tabela.Conferir (a regra que o catálogo não enxerga), as
// 6 RPCs (portão = a checagem de dentro de cada função) e POST /conteudo-trigger (a fila do robô da VPS).
// Toda escrita em banco.ComUsuario: o gatilho conteudo_guarda_aprovacao lê auth.uid(). "Entrar como" só lê.
package conteudo

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Conteudista: a checagem de dentro de conteudo_casar_na_mao, _decidir_casamento, _ideia_virar_peca e
// _reavisar (02-funções.csv:224-289, 322-366, 408-474): perfil com papel admin, is_superadmin (a FICHA) ou o
// módulo 'conteudo' em features. Sem conta_ativa, como as funções: são SECURITY DEFINER, a subconsulta em
// profiles não passa pela RLS (a sessão de conta desativada nem existe: auth.Exigir a recusa). As TABELAS
// usam a regra do catálogo (a mesma trinca, com conta ativa), não esta. Ruling 5.9-9.
var Conteudista = autz.Regra(func(e *autz.Escopo) bool {
	return e != nil && e.TemPerfil && (e.Papel == "admin" || e.SuperFicha || e.Modulo("conteudo"))
})

// Aprovador: a de conteudo_decidir, conteudo_aprovar_e_agendar e do gatilho conteudo_guarda_aprovacao
// (02-funções.csv:178-223, 290-321, 367-407): a mesma trinca com 'conteudo.aprovar' em features.
var Aprovador = autz.Regra(func(e *autz.Escopo) bool {
	return e != nil && e.TemPerfil && (e.Papel == "admin" || e.SuperFicha || e.Modulo("conteudo.aprovar"))
})

// PedeIA: o portão da edge conteudo-trigger (index.ts:36-42): papel admin, is_superadmin (ficha), a chave
// 'conteudo' em permissions ou o módulo 'conteudo' em features. Difere da edge em dois cantos (Ruling 5.9-11):
// a chave casa também como texto de um array no topo de permissions (o `?` do jsonb, que Escopo.Chaves segue;
// o hasOwnProperty da edge não casava) e a conta desativada não passa.
var PedeIA = autz.Regra(func(e *autz.Escopo) bool {
	return e != nil && e.TemPerfil && e.Ativo &&
		(e.Papel == "admin" || e.SuperFicha || e.Chaves["conteudo"] || e.Modulo("conteudo"))
})

var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

var (
	reUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	// os checks das migrations (e src/ferramentas/conteudo/estados.js e formatos.js). "formatos" já é nome do
	// hora_h.go (os rótulos do aviso).
	estadosDaPeca  = []string{"rascunho", "em_aprovacao", "aprovada", "reprovada", "agendada", "publicada", "arquivada"}
	formatosDaPeca = []string{"feed", "reels", "stories", "carrossel"}
)

// bruto: o valor JSON de uma coluna no mapa de escrita (dados.Campos guarda json.RawMessage); ausente = nil.
func bruto(campos map[string]any, col string) json.RawMessage {
	v, _ := campos[col].(json.RawMessage)
	return v
}

// comoTexto: o valor JSON é texto? (null, número, objeto: não). Não se chama "texto": casar.go importa o
// pacote internal/texto, e o nome do pacote e o da função não podem conviver no mesmo pacote Go.
func comoTexto(v json.RawMessage) (string, bool) {
	var s string
	if len(v) == 0 || v[0] != '"' || json.Unmarshal(v, &s) != nil {
		return "", false
	}
	return s, true
}

// textoAte: texto de até max caracteres; vazio (ou só espaço) só se vazioPode.
func textoAte(v json.RawMessage, max int, vazioPode bool) bool {
	s, ok := comoTexto(v)
	return ok && utf8.RuneCountInString(s) <= max && (vazioPode || strings.TrimSpace(s) != "")
}

func casa(v json.RawMessage, re *regexp.Regexp) bool {
	s, ok := comoTexto(v)
	return ok && re.MatchString(s)
}

func nulo(v json.RawMessage) bool { return strings.TrimSpace(string(v)) == "null" }

func textoEm(v json.RawMessage, opcoes ...string) bool {
	s, ok := comoTexto(v)
	return ok && slices.Contains(opcoes, s)
}

// textoOuNulo: null ou texto de até max caracteres (vazio pode).
func textoOuNulo(v json.RawMessage, max int) bool { return nulo(v) || textoAte(v, max, true) }

func uuidOuNulo(v json.RawMessage) bool { return nulo(v) || casa(v, reUUID) }

// instanteOuNulo: null ou um instante RFC 3339 (o toISOString da tela: "2026-10-20T15:00:00.000Z").
func instanteOuNulo(v json.RawMessage) bool {
	if nulo(v) {
		return true
	}
	s, ok := comoTexto(v)
	if !ok {
		return false
	}
	_, err := time.Parse(time.RFC3339, s)
	return err == nil
}

func inteiroEntre(v json.RawMessage, min, max int64) bool {
	var n int64
	return json.Unmarshal(v, &n) == nil && n >= min && n <= max
}

func booleano(v json.RawMessage) bool { s := string(v); return s == "true" || s == "false" }

// pecaVisivel: a peça existe e quem pede a LÊ (a regra de Ler de conteudo_pecas: conteudista do catálogo E
// pode_ver_conta da conta dela); devolve a conta. Senão autz.ErrNaoEncontrado — igual para "não existe", "id
// inválido" e "é de outra conta" (IDOR). Sem trava de linha: mudar a conta de uma peça no meio da transação de
// outra pessoa é corrida que a tela não faz (ponytail: `for no key update` se um dia mover peça entre contas
// virar operação comum). Ruling 5.9-3/5.9-4.
func pecaVisivel(ctx context.Context, tx pgx.Tx, e *autz.Escopo, peca string) (string, error) {
	if !reUUID.MatchString(peca) {
		return "", autz.ErrNaoEncontrado
	}
	f, err := autz.Producao.Filtro(e, "conteudo_pecas", autz.Ler, "pc")
	if err != nil {
		return "", err
	}
	var conta string
	err = tx.QueryRow(ctx, `select pc.account_id::text from conteudo_pecas pc where pc.id = @peca::uuid and (`+f.SQL+`)`,
		f.Juntar(pgx.NamedArgs{"peca": peca})).Scan(&conta)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", autz.ErrNaoEncontrado
	}
	return conta, err
}

// negado: na criação de uma filha (e nos parâmetros de RPC), a mãe invisível e a inexistente respondem igual,
// 403 (como o CriarSoLegivel do 5.2): o pedido não confirma que a mãe existe.
func negado(err error) error {
	if errors.Is(err, autz.ErrNaoEncontrado) {
		return autz.ErrNegado
	}
	return err
}

// soLegivelAoCriar: Tabela.Conferir das tabelas com a restritiva. A linha criada tem de passar na regra de LER
// de quem cria (o Criar do catálogo é só o WITH CHECK, sem a restritiva de select: criar peça/ideia/bloco numa
// conta que não se vê passaria e devolveria só o id). Ruling 5.9-4. Na edição o PodeEditar já confere a
// linha nova com a regra de Ler (EditarNova).
func soLegivelAoCriar(tab string) func(context.Context, pgx.Tx, *autz.Escopo, string, map[string]any) error {
	return func(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error {
		if id != "" || campos == nil {
			return nil
		}
		f, err := autz.Producao.Filtro(e, tab, autz.Ler, "autz_nova")
		if err != nil {
			return err
		}
		ok, err := autz.Conferir(ctx, tx, f, tab, campos)
		if err != nil {
			return err
		}
		if !ok {
			return autz.ErrNegado
		}
		return nil
	}
}

// responder: o corpo da edge portada ({"error": código}, {"job_id": …}), que a tela já lê.
func responder(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}
