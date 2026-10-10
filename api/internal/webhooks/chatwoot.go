package webhooks

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata" // America/Sao_Paulo sem depender do zoneinfo do contêiner

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/text/unicode/norm"
)

const limiteChatwoot = 1 << 20

var saoPaulo = func() *time.Location {
	l, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		panic(err)
	}
	return l
}()

// tokenValido compara o segredo da URL em tempo constante, inclusive no tamanho: compara os
// SHA-256 de ambos (sempre 32 bytes). Segredo vazio nunca vale.
func tokenValido(segredo, recebido string) bool {
	a, b := sha256.Sum256([]byte(segredo)), sha256.Sum256([]byte(recebido))
	return segredo != "" && subtle.ConstantTimeCompare(a[:], b[:]) == 1
}

// Chatwoot recebe os dois webhooks do Chatwoot. Ele não assina o corpo: autentica por um
// segredo fixo na própria URL (?token=). ⚠️ A URL NUNCA vai para log aqui (nem r.URL, nem a
// query), e o nginx não pode logar a query destas rotas (NOTAS-DA-IMPLANTACAO.md).
type Chatwoot struct {
	Pool    *pgxpool.Pool
	Segredo string
	Agora   func() time.Time // nil = time.Now
	// PrazoGravar limita a gravação (que ignora o cancelamento da requisição); 0 = 10 s.
	PrazoGravar time.Duration
}

// entrada: método, segredo, tamanho e JSON. false = já respondeu.
// O corpo vira um objeto (ou nil, se for outro tipo de JSON, como no edge).
func (c *Chatwoot) entrada(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	if r.Method != http.MethodPost {
		responder(w, http.StatusMethodNotAllowed, map[string]any{"ok": false})
		return nil, false
	}
	if !tokenValido(c.Segredo, r.URL.Query().Get("token")) {
		responder(w, http.StatusUnauthorized, map[string]string{"error": "nao_autorizado"})
		return nil, false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, limiteChatwoot))
	d.UseNumber()
	var corpo any
	err := d.Decode(&corpo)
	if err == nil {
		if _, e2 := d.Token(); e2 != io.EOF { // dado depois do JSON: req.json() do edge também recusa
			err = errors.New("dados depois do JSON")
		}
	}
	if err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			responder(w, http.StatusRequestEntityTooLarge, map[string]string{"error": "corpo_grande_demais"})
		} else {
			responder(w, http.StatusBadRequest, map[string]string{"error": "corpo_invalido"})
		}
		return nil, false
	}
	return mapa(corpo), true
}

// PrazoGravarPadrao é o teto da gravação em produção (PrazoGravar = 0).
const PrazoGravarPadrao = 10 * time.Second

func (c *Chatwoot) prazoDeGravacao() time.Duration {
	if c.PrazoGravar == 0 {
		return PrazoGravarPadrao
	}
	return c.PrazoGravar
}

func (c *Chatwoot) gravar(ctx context.Context, w http.ResponseWriter, quem, sql string, args ...any) {
	// o Chatwoot desiste em 5 s e não reenvia: cancelamento da requisição não pode perder a gravação
	// ...mas com prazo próprio, para um banco travado não prender a goroutine para sempre.
	prazo := c.prazoDeGravacao()
	ctx, cancela := context.WithTimeout(context.WithoutCancel(ctx), prazo)
	defer cancela()
	if _, err := c.Pool.Exec(ctx, sql, args...); err != nil {
		slog.Error("webhook chatwoot: falha ao gravar", "rota", quem, "erro", erroSemDados(err))
		responder(w, http.StatusInternalServerError, map[string]any{"ok": false, "erro": "falha_ao_gravar"})
		return
	}
	responder(w, http.StatusOK, map[string]any{"ok": true})
}

// numeroOuNulo: id inteiro do Chatwoot (número ou texto numérico), ou nil.
func numeroOuNulo(v any) *int64 {
	var s string
	switch x := v.(type) {
	case json.Number:
		s = x.String()
	case string:
		s = x
	default:
		return nil
	}
	n, err := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	if err != nil {
		return nil
	}
	return &n
}

func textoOuNulo(v any) *string {
	s, ok := v.(string)
	if !ok {
		return nil
	}
	return &s
}

// tipos válidos: 'qualified_lead' substituiu 'lead_quente' em 05/10/2026 (o antigo segue
// aceito para reenvio de evento antigo).
var tiposDeLead = map[string]bool{"lead_novo": true, "lead_quente": true, "qualified_lead": true}

// Evento é POST /receber-webhook-chatwoot?token= (CRM: lead novo / qualificado):
// extrairEventoDoChatwoot de _shared/verificar-webhook-chatwoot.js. Cada conversa conta UMA
// vez por tipo (único em conversation_id+tipo): reenvio é inofensivo.
func (c *Chatwoot) Evento(w http.ResponseWriter, r *http.Request) {
	in, ok := c.entrada(w, r)
	if !ok {
		return
	}
	tipo, _ := in["tipo"].(string)
	conversa := numeroOuNulo(in["conversation_id"])
	if !tiposDeLead[tipo] || conversa == nil || *conversa == 0 {
		responder(w, http.StatusBadRequest, map[string]string{"error": "payload_incompleto"})
		return
	}
	agora := time.Now
	if c.Agora != nil {
		agora = c.Agora
	}
	quando := agora()
	switch v := in["created_at"].(type) {
	case string:
		if t, err := time.Parse(time.RFC3339Nano, v); err == nil {
			quando = t
		}
	case json.Number:
		// new Date(número) do JS = milissegundos; 0/negativo: o edge trata 0 como ausente (falsy)
		if ms, err := v.Int64(); err == nil && ms > 0 {
			quando = time.UnixMilli(ms)
		}
	}
	c.gravar(r.Context(), w, "evento", `insert into chatwoot_eventos (tipo, chatwoot_account_id, conversation_id,
		  conversation_display_id, contact_id, contact_name, contact_phone_number, loja, classificacao_ia, criado_em_chatwoot, dia_br)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::text::date)
		on conflict (conversation_id, tipo) do nothing`,
		tipo, numeroOuNulo(in["account_id"]), *conversa, numeroOuNulo(in["conversation_display_id"]), numeroOuNulo(in["contact_id"]),
		textoOuNulo(in["contact_name"]), textoOuNulo(in["contact_phone_number"]), textoOuNulo(in["loja"]), textoOuNulo(in["classificacao_ia"]),
		quando.UTC(), quando.In(saoPaulo).Format("2006-01-02"))
}

var (
	naoAlfanumerico = regexp.MustCompile(`[^a-z0-9 ]`)
	frasesDeSaida   = map[string]bool{"parar": true, "pare": true, "sair": true}
	celularBR       = regexp.MustCompile(`^55[1-9][1-9]9\d{8}$`)
	naoDigito       = regexp.MustCompile(`\D`)
)

// limpar: sem acento (NFD e fora U+0300..U+036F, como o JS), minúsculas, só [a-z0-9 ].
func limpar(s string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(s) {
		if r >= 0x300 && r <= 0x36f {
			continue
		}
		b.WriteRune(r)
	}
	t := naoAlfanumerico.ReplaceAllString(strings.ToLower(b.String()), " ")
	return strings.Join(strings.Fields(t), " ")
}

// normalizarTelefone (_shared/mensagem-de-abandono.js): só celular brasileiro, com DDI 55.
func normalizarTelefone(bruto string) string {
	d := naoDigito.ReplaceAllString(bruto, "")
	d = strings.TrimPrefix(d, "00")
	if n := len(d); n == 10 || n == 11 {
		d = "55" + d
	}
	if !celularBR.MatchString(d) {
		return ""
	}
	return d
}

// OptOut é POST /receber-opt-out-chatwoot?token= (evento padrão "message_created"): quem
// responde PARAR/SAIR (frase exata) ou "não quero receber..." vai para contatos_sem_mensagem.
func (c *Chatwoot) OptOut(w http.ResponseWriter, r *http.Request) {
	in, ok := c.entrada(w, r)
	if !ok {
		return
	}
	conteudo, _ := in["content"].(string)
	t := limpar(conteudo)
	if in["event"] != "message_created" || in["message_type"] != "incoming" || !(frasesDeSaida[t] || strings.HasPrefix(t, "nao quero receber")) {
		responder(w, http.StatusOK, map[string]any{"ok": true, "ignorado": true})
		return
	}
	// como o `??` do edge: só cai para o segundo caminho se o primeiro for ausente/null
	cru := mapa(in["sender"])["phone_number"]
	if cru == nil {
		cru = mapa(mapa(mapa(in["conversation"])["meta"])["sender"])["phone_number"]
	}
	bruto, _ := cru.(string)
	tel := normalizarTelefone(bruto)
	if tel == "" {
		responder(w, http.StatusOK, map[string]any{"ok": true, "ignorado": true})
		return
	}
	c.gravar(r.Context(), w, "opt-out", `insert into contatos_sem_mensagem (telefone, motivo) values ($1, $2) on conflict (telefone) do nothing`,
		tel, "resposta: "+t)
}
