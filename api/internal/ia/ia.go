package ia

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	// os modelos e tetos das edges, sem troca na migração (Ruling 5.7-11; achado 5)
	modeloPublico      = "claude-opus-4-5" // sugerir-publico-ia/index.ts:28
	maxTokensPublico   = 1600              // index.ts:35 (o valor que estava no ar)
	modeloDocumento    = "claude-opus-5"   // ler-documento/index.ts:24
	maxTokensDocumento = 8000              // index.ts:27
	maxBase64          = 4_500_000         // index.ts:31 (~3,3 MB de PDF)
	tetoCorpoDocumento = maxBase64 + 100_000
)

var reUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// IA: os dois handlers. Monte DEPOIS de auth.Exigir e auth.ExigirModulo("meta.gestor"); o SugerirPublico
// também depois de autz.ComEscopo.
type IA struct {
	claude                   *claude
	limSugerir, limDocumento *auth.Limitador
}

func Nova(chave string) *IA {
	s, d := auth.NovoLimitador(), auth.NovoLimitador()
	s.Max, s.Janela = 30, time.Hour // ponytail: em memória, uma instância; teto de gasto no painel da Anthropic é a segunda barreira
	d.Max, d.Janela = 10, time.Hour
	return &IA{limSugerir: s, limDocumento: d, claude: &claude{chave: chave, url: urlAnthropic,
		http: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}}
}

type obj = map[string]any

func responder(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

var semChave = obj{"error": "chave_nao_configurada", "comoResolver": "Configure ANTHROPIC_API_KEY_TRAFEGO no serviço api e reinicie."}

// registrar: a única linha de log por chamada (Ruling 5.7-15).
func registrar(rota, pessoa string, status int, uso json.RawMessage, inicio time.Time, bytesPDF int) {
	slog.Info("ia: chamada à Anthropic", "rota", rota, "pessoa", pessoa, "status", status,
		"uso", string(usoOuNulo(uso)), "ms", time.Since(inicio).Milliseconds(), "bytes_pdf", bytesPDF)
}

type saidaPublico struct {
	Ok         bool            `json:"ok"`
	Leitura    string          `json:"leitura"`
	Interesses []interesse     `json:"interesses"`
	Cuidado    string          `json:"cuidado"`
	Uso        json.RawMessage `json:"uso"`
}

type saidaTexto struct {
	Ok        bool            `json:"ok"`
	Leitura   string          `json:"leitura"`
	Sugestoes []string        `json:"sugestoes"`
	Cuidado   string          `json:"cuidado"`
	Uso       json.RawMessage `json:"uso"`
}

// SugerirPublico: POST /sugerir-publico-ia.
func (ia *IA) SugerirPublico(w http.ResponseWriter, r *http.Request) {
	a, e := auth.AtorDoContexto(r.Context()), autz.EscopoDo(r.Context())
	if a == nil || e == nil {
		slog.Error("ia: sugerir-publico-ia montada sem auth.Exigir ou autz.ComEscopo")
		responder(w, http.StatusInternalServerError, obj{"error": "erro_interno"})
		return
	}
	var in struct {
		Evidencia json.RawMessage `json:"evidencia"`
		Modo      string          `json:"modo"`
		Marca     string          `json:"marca"`
		Objetivo  string          `json:"objetivo"`
		Persona   string          `json:"persona"`
		ContaID   string          `json:"contaId"`
	}
	if !dados.LerCorpo(w, r, &in) {
		return
	}
	var ev map[string]any
	if len(in.Evidencia) == 0 || in.Evidencia[0] != '{' || decodificar(in.Evidencia, &ev) != nil {
		responder(w, http.StatusBadRequest, obj{"error": "sem_evidencia"})
		return
	}
	if !reUUID.MatchString(in.ContaID) {
		responder(w, http.StatusBadRequest, obj{"error": "sem_conta"})
		return
	}
	if !autz.PodeVerConta(e, in.ContaID) { // Ruling 5.7-13: igual a conta inexistente
		responder(w, http.StatusNotFound, obj{"error": "conta_nao_encontrada"})
		return
	}
	if ia.claude.chave == "" {
		responder(w, http.StatusServiceUnavailable, semChave)
		return
	}
	if !ia.limSugerir.Tentar(a.ID) {
		responder(w, http.StatusTooManyRequests, obj{"error": "muitas_leituras", "detalhe": "São no máximo 30 leituras da IA por hora por pessoa."})
		return
	}
	var evc bytes.Buffer
	_ = json.Compact(&evc, in.Evidencia)
	marca, objetivo, persona := cortar(in.Marca, 200), cortar(in.Objetivo, 200), cortar(strings.TrimSpace(in.Persona), 4000)
	texto := in.Modo == "texto"
	prompt := montarPrompt(evc.String(), marca, objetivo, persona)
	if texto {
		prompt = promptDeTexto(evc.String(), marca, objetivo, persona)
	}
	inicio := time.Now()
	st, res, bruto, err := ia.claude.enviar(r.Context(), obj{"model": modeloPublico, "max_tokens": maxTokensPublico,
		"messages": []obj{{"role": "user", "content": prompt}}})
	registrar("sugerir-publico-ia", a.ID, st, res.Usage, inicio, 0)
	if err != nil {
		responder(w, http.StatusBadGateway, obj{"error": "anthropic_inacessivel", "detalhe": err.Error()})
		return
	}
	if st < 200 || st > 299 {
		responder(w, http.StatusBadGateway, obj{"error": "anthropic_recusou", "status": st, "detalhe": detalheDoErro(res, bruto)})
		return
	}
	var b strings.Builder
	for _, c := range res.Content {
		b.WriteString(c.Text)
	}
	saida := strings.TrimSpace(b.String())
	lido := extrairJSON(saida)
	if lido == nil {
		responder(w, http.StatusBadGateway, obj{"error": "resposta_ilegivel", "bruto": cortar(saida, 800)})
		return
	}
	leitura, cuidado, uso := cortar(textoDe(lido["leitura"]), 1200), cortar(textoDe(lido["cuidado"]), 400), usoOuNulo(res.Usage)
	if texto {
		responder(w, http.StatusOK, saidaTexto{true, leitura, sugestoesDe(lido["sugestoes"]), cuidado, uso})
		return
	}
	responder(w, http.StatusOK, saidaPublico{true, leitura, filtrarInteresses(lido["interesses"], ev), cuidado, uso})
}

// limiteDe: o `limite` da edge (min(Number(x), 8000), senão 4000), com piso 1: a edge aceitava 0 e
// negativo, que cortavam o texto do fim (Ruling 5.7-12).
func limiteDe(v json.RawMessage) int {
	var f float64
	if json.Unmarshal(v, &f) != nil || math.IsNaN(f) || math.IsInf(f, 0) || f < 1 {
		return 4000
	}
	return int(math.Min(f, 8000))
}

// LerDocumento: POST /ler-documento.
func (ia *IA) LerDocumento(w http.ResponseWriter, r *http.Request) {
	a := auth.AtorDoContexto(r.Context())
	if a == nil {
		slog.Error("ia: ler-documento montada sem auth.Exigir")
		responder(w, http.StatusInternalServerError, obj{"error": "erro_interno"})
		return
	}
	bruto, err := io.ReadAll(http.MaxBytesReader(w, r.Body, tetoCorpoDocumento))
	var grande *http.MaxBytesError
	if errors.As(err, &grande) {
		responder(w, http.StatusRequestEntityTooLarge, obj{"error": "arquivo_grande_demais", "detalhe": "O PDF passa do limite de 3 MB."})
		return
	}
	var in struct {
		Base64 string          `json:"base64"`
		Limite json.RawMessage `json:"limite"`
	}
	if err != nil || json.Unmarshal(bruto, &in) != nil {
		responder(w, http.StatusBadRequest, obj{"error": "corpo_invalido"})
		return
	}
	b64 := strings.Join(strings.Fields(in.Base64), "") // sem quebra de linha: a API recusa
	if b64 == "" {
		responder(w, http.StatusBadRequest, obj{"error": "sem_arquivo"})
		return
	}
	if len(b64) > maxBase64 {
		responder(w, http.StatusRequestEntityTooLarge, obj{"error": "arquivo_grande_demais", "detalhe": fmt.Sprintf(
			"O PDF tem cerca de %d MB e o limite aqui é %d MB.", int(math.Round(float64(len(b64))*0.75/1024/1024)), int(math.Round(maxBase64*0.75/1024/1024)))})
		return
	}
	pdf, err := base64.StdEncoding.DecodeString(b64)
	if err != nil || !bytes.HasPrefix(pdf, []byte("%PDF-")) { // Ruling 5.7-12: lixo não gasta chamada
		responder(w, http.StatusBadRequest, obj{"error": "nao_e_pdf", "detalhe": "O arquivo não é um PDF."})
		return
	}
	limite := limiteDe(in.Limite)
	if ia.claude.chave == "" {
		responder(w, http.StatusServiceUnavailable, semChave)
		return
	}
	if !ia.limDocumento.Tentar(a.ID) {
		responder(w, http.StatusTooManyRequests, obj{"error": "muitos_documentos", "detalhe": "São no máximo 10 PDFs por hora por pessoa."})
		return
	}
	// o pedido da edge (ler-documento/index.ts:84-95), com as linhas vazias (aqui não há filter)
	pedido := strings.Join([]string{
		"Este documento descreve PARA QUEM uma marca vende (persona, público-alvo, curadoria de marca).",
		"",
		"Devolva o conteúdo dele como TEXTO CORRIDO em português, para ser colado num campo de formulário:",
		fmt.Sprintf("- no máximo %d caracteres;", limite),
		"- preserve a estrutura em parágrafos e tópicos que o documento usa;",
		"- NÃO invente nada que não esteja no documento, e não acrescente comentário seu;",
		"- se o documento tiver faixa etária, renda, cidade, o que a pessoa procura e o que NÃO combina com a marca, esses pontos são os mais importantes e não podem ficar de fora;",
		"- se não couber tudo, corte o que é decoração (história da marca, missão, visão) e mantenha o que descreve a PESSOA.",
		"",
		"Responda SÓ com o texto, sem preâmbulo e sem markdown de cabeçalho.",
	}, "\n")
	inicio := time.Now()
	st, res, corpoErro, err := ia.claude.enviar(r.Context(), obj{"model": modeloDocumento, "max_tokens": maxTokensDocumento,
		"output_config": obj{"effort": "low"},
		"messages": []obj{{"role": "user", "content": []obj{
			{"type": "document", "source": obj{"type": "base64", "media_type": "application/pdf", "data": b64}},
			{"type": "text", "text": pedido}}}}})
	registrar("ler-documento", a.ID, st, res.Usage, inicio, len(pdf))
	if err != nil {
		responder(w, http.StatusBadGateway, obj{"error": "anthropic_inacessivel", "detalhe": err.Error()})
		return
	}
	if st < 200 || st > 299 {
		responder(w, http.StatusBadGateway, obj{"error": "anthropic_recusou", "status": st, "detalhe": detalheDoErro(res, corpoErro)})
		return
	}
	if res.StopReason == "refusal" {
		responder(w, http.StatusBadGateway, obj{"error": "recusado_pela_ia"})
		return
	}
	var b strings.Builder
	for _, c := range res.Content {
		if c.Type == "text" {
			b.WriteString(c.Text)
		}
	}
	texto := strings.TrimSpace(b.String())
	if texto == "" {
		responder(w, http.StatusBadGateway, obj{"error": "sem_texto", "detalhe": "a IA não devolveu texto para este PDF"})
		return
	}
	responder(w, http.StatusOK, obj{"ok": true, "texto": cortar(texto, limite), "uso": usoOuNulo(res.Usage)})
}
