package mensagens

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/texto"
)

// Porta de _shared/cliente-chatwoot.js. O token NUNCA aparece em log nem em mensagem de erro.

// ErroChatwoot: Status 0 = rede/prazo (sem resposta), com o PASSO em que falhou.
type ErroChatwoot struct {
	Status int
	Corpo  any
	Passo  string
}

func (e *ErroChatwoot) Error() string { return fmt.Sprintf("chatwoot %s: HTTP %d", e.Passo, e.Status) }

const (
	prazoChatwoot = 15 * time.Second
	prazoLiberar  = 4 * time.Second // best-effort, no caminho de erro: não pode segurar a rodada
)

// corpoNaoEnviado marca o ErroChatwoot de um envio que nem começou (contexto já vencido).
const corpoNaoEnviado = "nao_enviado"

// classificarErro: nao_enviado -> devolver o item à fila sem gastar tentativa; 401/403 -> parar a rodada (credencial); 429/5xx/rede -> tentar de novo; demais 4xx
// -> falhou. ⚠️ Rede/prazo e 502/504 NO enviar_template NÃO tentam de novo: a mensagem pode ter saído.
func classificarErro(err error) string {
	var e *ErroChatwoot
	if !errors.As(err, &e) {
		return "tentar_de_novo"
	}
	switch {
	case e.Status == 0 && e.Corpo == corpoNaoEnviado:
		return "nao_enviado" // o contexto já tinha vencido: nada saiu e nada gasta tentativa
	// 502/504 no envio: o gateway pode ter repassado a mensagem antes de falhar (a edge repetia: aqui não).
	case e.Passo == "enviar_template" && (e.Status == 502 || e.Status == 504):
		return "falhou"
	case e.Status == 0 && e.Passo == "enviar_template":
		return "falhou"
	case e.Status == 0:
		return "tentar_de_novo"
	case e.Status == 401 || e.Status == 403:
		return "parar"
	case e.Status == 429 || e.Status >= 500:
		return "tentar_de_novo"
	}
	return "falhou"
}

// detalheDoErro: `${passo}:${status} ${JSON.stringify(corpo ?? ”).slice(0,160)}` (ou o texto do erro).
func detalheDoErro(err error) string {
	var e *ErroChatwoot
	if !errors.As(err, &e) {
		return texto.CortarUTF16(err.Error(), 160)
	}
	var b bytes.Buffer
	enc := json.NewEncoder(&b)
	enc.SetEscapeHTML(false) // como o JSON.stringify
	corpo := e.Corpo
	if corpo == nil {
		corpo = ""
	}
	enc.Encode(corpo)
	return fmt.Sprintf("%s:%d %s", e.Passo, e.Status, texto.CortarUTF16(strings.TrimRight(b.String(), "\n"), 160))
}

// Chatwoot é o cliente mínimo da API do Chatwoot para o robô.
type Chatwoot struct {
	URL, ContaID string
	CaixaID      int64
	Token        string // api_access_token
	BotSecret    string // X-Bot-Secret do custom_api (reserva do aviso)
	HTTP         *http.Client
}

// clientePadrao NUNCA segue redirect. O Go repassa cabeçalhos próprios (api_access_token, X-Bot-Secret)
// a quem o Location apontar, e um 301/302/303 num POST vira GET: o GET da lista de mensagens devolve 200
// e o envio ficaria registrado como feito sem nunca ter saído. O 3xx volta como resposta e vira erro
// `falhou` (visível, nunca duplica). Se Chatwoot.HTTP for dado, quem o monta assume essa política.
var clientePadrao = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
	return http.ErrUseLastResponse
}}

func (c *Chatwoot) cliente() *http.Client {
	if c.HTTP != nil {
		return c.HTTP
	}
	return clientePadrao
}

func (c *Chatwoot) raiz() string { return strings.TrimSuffix(c.URL, "/") }

// semURL: o erro do http.Client traz a URL; fica só a causa (cortada).
func semURL(err error) string {
	var ue *url.Error
	if errors.As(err, &ue) {
		err = ue.Err
	}
	return texto.CortarUTF16(err.Error(), 160)
}

func decodificar(b []byte) any {
	if len(b) == 0 {
		return nil
	}
	d := json.NewDecoder(bytes.NewReader(b))
	d.UseNumber()
	var v any
	if d.Decode(&v) != nil {
		return string(b) // corpo que não é JSON: fica o texto
	}
	return v
}

func (c *Chatwoot) chamar(ctx context.Context, passo, metodo, caminho string, corpo any) (any, error) {
	ctx, cancela := context.WithTimeout(ctx, prazoChatwoot)
	defer cancela()
	var leitor io.Reader
	if corpo != nil {
		b, _ := json.Marshal(corpo)
		leitor = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, metodo, c.raiz()+"/api/v1/accounts/"+c.ContaID+caminho, leitor)
	if err != nil {
		return nil, &ErroChatwoot{0, "pedido_invalido", passo}
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("api_access_token", c.Token)
	r, err := c.cliente().Do(req)
	if err != nil {
		return nil, &ErroChatwoot{0, semURL(err), passo}
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	j := decodificar(b)
	if r.StatusCode < 200 || r.StatusCode > 299 {
		return nil, &ErroChatwoot{r.StatusCode, j, passo}
	}
	return j, nil
}

func campo(v any, chaves ...string) any {
	for _, k := range chaves {
		m, _ := v.(map[string]any)
		v = m[k]
	}
	return v
}

func id64(v any) (int64, bool) {
	switch x := v.(type) {
	case json.Number:
		n, err := x.Int64()
		return n, err == nil
	case string:
		n, err := strconv.ParseInt(x, 10, 64)
		return n, err == nil
	}
	return 0, false
}

func (c *Chatwoot) customAPI(ctx context.Context, prazo time.Duration, caminho string, corpo any) (int, any, error) {
	ctx, cancela := context.WithTimeout(ctx, prazo)
	defer cancela()
	b, _ := json.Marshal(corpo)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.raiz()+"/custom_api/v1/accounts/"+c.ContaID+caminho, bytes.NewReader(b))
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Bot-Secret", c.BotSecret)
	r, err := c.cliente().Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer r.Body.Close()
	lido, _ := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	return r.StatusCode, decodificar(lido), nil
}

// ReservarAviso reserva o aviso único (custom_api, X-Bot-Secret). Devolve reservado | duplicado |
// janela | adiado; qualquer outra coisa é ErroChatwoot (passo reservar_aviso). O segredo e o telefone
// nunca entram no erro.
func (c *Chatwoot) ReservarAviso(ctx context.Context, phone, tipo, chave string, idadeS *int64) (string, error) {
	corpo := map[string]any{"phone": phone, "tipo": tipo, "chave": chave}
	if idadeS != nil && *idadeS >= 0 { // o Chatwoot só adia (adiado) enquanto idade_s < 120
		corpo["idade_s"] = *idadeS
	}
	st, j, err := c.customAPI(ctx, prazoChatwoot, "/avisos/reservar", corpo)
	if err != nil {
		return "", &ErroChatwoot{0, "rede_ou_timeout", "reservar_aviso"}
	}
	if st < 200 || st > 299 {
		return "", &ErroChatwoot{st, nil, "reservar_aviso"}
	}
	res, _ := campo(j, "resultado").(string)
	if campo(j, "ok") != true || (res != "reservado" && res != "duplicado" && res != "janela" && res != "adiado") {
		return "", &ErroChatwoot{st, "resposta_inesperada", "reservar_aviso"}
	}
	return res, nil
}

// LiberarAviso desfaz a reserva, SÓ quando a mensagem comprovadamente não foi aceita. Best-effort:
// nunca falha; devolve liberado | inexistente | "" (não deu para saber).
func (c *Chatwoot) LiberarAviso(ctx context.Context, phone, tipo, chave string) string {
	st, j, err := c.customAPI(ctx, prazoLiberar, "/avisos/liberar", map[string]any{"phone": phone, "tipo": tipo, "chave": chave})
	res, _ := campo(j, "resultado").(string)
	if err == nil && st >= 200 && st <= 299 && campo(j, "ok") == true && (res == "liberado" || res == "inexistente") {
		return res
	}
	return ""
}

var reTelefoneComoNome = regexp.MustCompile(`^[+\d\s()-]*$`)

// AcharOuCriarContato acha pelo telefone (+55…) ou cria. O nome só é escrito por cima quando o contato
// tem o TELEFONE como nome (a triagem do Chatwoot cria assim): nome real nunca é sobrescrito.
func (c *Chatwoot) AcharOuCriarContato(ctx context.Context, nome *string, telefone string) (int64, error) {
	e164 := "+" + telefone
	achados, err := c.chamar(ctx, "buscar_contato", http.MethodGet, "/contacts/search?q="+url.QueryEscape(e164), nil)
	if err != nil {
		return 0, err
	}
	lista, _ := campo(achados, "payload").([]any)
	for _, x := range lista {
		ct, _ := x.(map[string]any)
		if ct["phone_number"] != e164 {
			continue
		}
		id, ok := id64(ct["id"])
		if !ok || id <= 0 {
			return 0, idInesperado("buscar_contato")
		}
		nomeAtual, temNome := ct["name"]
		atual, _ := nomeAtual.(string) // null vira "": vazio também é "só telefone"
		if nome != nil && strings.TrimSpace(*nome) != "" && temNome && reTelefoneComoNome.MatchString(strings.TrimSpace(atual)) {
			if _, err := c.chamar(ctx, "atualizar_contato", http.MethodPut, "/contacts/"+strconv.FormatInt(id, 10),
				map[string]any{"name": strings.TrimSpace(*nome)}); err != nil && classificarErro(err) == "parar" {
				return 0, err // nome é cosmético; credencial recusada, não
			}
		}
		return id, nil
	}
	nomeNovo := e164
	if nome != nil && *nome != "" {
		nomeNovo = *nome
	}
	criado, err := c.chamar(ctx, "criar_contato", http.MethodPost, "/contacts", map[string]any{"inbox_id": c.CaixaID, "name": nomeNovo, "phone_number": e164})
	if err != nil {
		return 0, err
	}
	id, ok := id64(campo(criado, "payload", "contact", "id"))
	if !ok {
		id, ok = id64(campo(criado, "id"))
	}
	if !ok || id <= 0 {
		return 0, idInesperado("criar_contato")
	}
	return id, nil
}

// AbrirConversa: para WhatsApp o source_id do contato na caixa é o número sem o "+".
func (c *Chatwoot) AbrirConversa(ctx context.Context, contatoID int64, telefone string) (int64, error) {
	j, err := c.chamar(ctx, "abrir_conversa", http.MethodPost, "/conversations", map[string]any{"inbox_id": c.CaixaID, "contact_id": contatoID, "source_id": telefone})
	if err != nil {
		return 0, err
	}
	id, ok := id64(campo(j, "id"))
	if !ok || id <= 0 {
		return 0, idInesperado("abrir_conversa")
	}
	return id, nil
}

// idInesperado: a resposta veio 2xx sem um id utilizável. Nada foi enviado: erro (falhou), nunca um id 0
// que mandaria o template para /conversations/0/messages.
func idInesperado(passo string) error { return &ErroChatwoot{200, "resposta_inesperada", passo} }

// EnviarTemplate: contexto já vencido antes de começar = ErroChatwoot "nao_enviado" (classificarErro:
// nao_enviado, nada saiu); vencido DEPOIS de o pedido sair é ambíguo (status 0 -> falhou).
func (c *Chatwoot) EnviarTemplate(ctx context.Context, conversaID int64, texto string, params Template) error {
	if ctx.Err() != nil {
		return &ErroChatwoot{0, corpoNaoEnviado, "enviar_template"}
	}
	_, err := c.chamar(ctx, "enviar_template", http.MethodPost, "/conversations/"+strconv.FormatInt(conversaID, 10)+"/messages",
		map[string]any{"content": texto, "message_type": "outgoing", "private": false, "template_params": params})
	return err
}

// Respondeu: a cliente mandou mensagem (message_type 0) nesta conversa — desde `desde`, quando dado
// (a conversa é reaproveitada: uma antiga com a loja não conta). ⚠️ "não consegui ler" NÃO é "não
// respondeu": falha na leitura, mensagem sem data ou `desde` inválido são erro (quem chama não envia).
func (c *Chatwoot) Respondeu(ctx context.Context, conversaID int64, desde *time.Time) (bool, error) {
	j, err := c.chamar(ctx, "ler_conversa", http.MethodGet, "/conversations/"+strconv.FormatInt(conversaID, 10)+"/messages", nil)
	if err != nil {
		return false, err
	}
	msgs, ok := j.([]any)
	if !ok {
		msgs, ok = campo(j, "payload").([]any)
	}
	if !ok {
		return false, &ErroChatwoot{200, "resposta_inesperada", "ler_conversa"}
	}
	var recebidas []map[string]any
	for _, x := range msgs {
		m, _ := x.(map[string]any)
		if n, ok := m["message_type"].(json.Number); ok && n.String() == "0" {
			recebidas = append(recebidas, m)
		}
	}
	if desde == nil {
		return len(recebidas) > 0, nil
	}
	limite := float64(desde.UnixMilli()) / 1000 // o Chatwoot manda created_at em segundos
	for _, m := range recebidas {
		n, ok := m["created_at"].(json.Number)
		if !ok {
			return false, &ErroChatwoot{200, "mensagem_sem_data", "ler_conversa"}
		}
		criado, err := n.Float64()
		if err != nil {
			return false, &ErroChatwoot{200, "mensagem_sem_data", "ler_conversa"}
		}
		if criado >= limite {
			return true, nil
		}
	}
	return false, nil
}
