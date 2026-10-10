package mensagens

import (
	"fmt"
	"math"
	"regexp"
	"strings"
	"time"
	_ "time/tzdata" // America/Sao_Paulo sem depender do zoneinfo do contêiner

	"github.com/rbv-co/social-dashboard/api/internal/texto"
)

// Regras PURAS de _shared/mensagem-de-abandono.js e _shared/trava-cruzada.js (sem rede, sem banco).

var saoPaulo = func() *time.Location {
	l, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		panic(err)
	}
	return l
}()

const (
	janelaInicio = 8  // 08:00 entra
	janelaFim    = 21 // 21:00 não entra
)

var (
	reSeparadorDeNome = regexp.MustCompile(`(^|[-'’])(\p{L})`)
	reEspacos         = regexp.MustCompile(texto.EspacoJS + `+`)
	reNaoDigito       = regexp.MustCompile(`\D`)
	reCelular         = regexp.MustCompile(`^55[1-9][1-9]9\d{8}$`)
	particulas        = map[string]bool{"da": true, "de": true, "do": true, "das": true, "dos": true, "e": true}
)

// capitalizarNome: "maria"/"MARIA" -> "Maria"; "ana-clara" -> "Ana-Clara". Caixa MISTURADA foi digitada
// de propósito ("DeAndre", "McKenzie"): fica como veio.
func capitalizarNome(p string) string {
	minusculo := strings.ToLower(p)
	if p != minusculo && p != strings.ToUpper(p) {
		return p
	}
	return reSeparadorDeNome.ReplaceAllStringFunc(minusculo, strings.ToUpper)
}

// palavras = s.trim().split(/\s+/) do JS (com o \s do JS), sem itens vazios.
func palavras(s string) []string {
	t := strings.Trim(reEspacos.ReplaceAllString(s, " "), " ")
	if t == "" {
		return nil
	}
	return strings.Split(t, " ")
}

// formatarNomeCompleto: "MARIA DA SILVA" -> "Maria da Silva". Vazio = nil (quem chama cai no telefone).
func formatarNomeCompleto(nome *string) *string {
	if nome == nil {
		return nil
	}
	ps := palavras(*nome)
	if len(ps) == 0 {
		return nil
	}
	for i, p := range ps {
		minuscula := strings.ToLower(p)
		soUmCaso := p == minuscula || p == strings.ToUpper(p)
		if i > 0 && soUmCaso && particulas[minuscula] {
			ps[i] = minuscula
		} else {
			ps[i] = capitalizarNome(p)
		}
	}
	s := strings.Join(ps, " ")
	return &s
}

// primeiroNome nunca devolve vazio: o template exige a variável preenchida.
func primeiroNome(nome *string) string {
	if nome == nil {
		return "cliente"
	}
	ps := palavras(*nome)
	if len(ps) == 0 {
		return "cliente"
	}
	return capitalizarNome(texto.CortarUTF16(ps[0], 30))
}

// normalizarTelefone: celular brasileiro como o Chatwoot/WhatsApp usa (55 + DDD + 9 + 8 dígitos).
// Fixo e celular sem o 9 não recebem WhatsApp de forma confiável: nil.
func normalizarTelefone(bruto *string) string {
	if bruto == nil {
		return ""
	}
	d := reNaoDigito.ReplaceAllString(*bruto, "")
	d = strings.TrimPrefix(d, "00")
	if len(d) == 10 || len(d) == 11 {
		d = "55" + d
	}
	if !reCelular.MatchString(d) {
		return ""
	}
	return d
}

// dentroDaJanela: 08:00 <= hora < 21:00 em Brasília.
func dentroDaJanela(agora time.Time) bool {
	h := agora.In(saoPaulo).Hour()
	return h >= janelaInicio && h < janelaFim
}

// sufixoDoLink: o link dinâmico do botão = base FIXA + sufixo. Base vazia nunca casa (o "sufixo" seria
// a URL inteira e o botão quebraria).
func sufixoDoLink(url *string, base string) string {
	if base == "" || url == nil || !strings.HasPrefix(*url, base) {
		return ""
	}
	return (*url)[len(base):]
}

// Template é o template_params que o Chatwoot aceita (app/models/message.rb). O botão de URL precisa
// ser o PRIMEIRO botão do template: o Chatwoot usa a posição.
type Template struct {
	Name            string         `json:"name"`
	Category        string         `json:"category"`
	Language        string         `json:"language"`
	ProcessedParams ParamsTemplate `json:"processed_params"`
}

type ParamsTemplate struct {
	Body    map[string]any `json:"body"` // any: o número do pedido pode ir nulo, como na edge
	Buttons []Botao        `json:"buttons,omitempty"`
}

type Botao struct {
	Type      string `json:"type"`
	Parameter string `json:"parameter"`
}

// templateMarketing: abandono, follow-up e inicio — MARKETING, {1: nome} e o link no primeiro botão.
func templateMarketing(nomeTemplate, idioma string, nome *string, sufixo string) Template {
	return Template{nomeTemplate, "MARKETING", idioma, ParamsTemplate{map[string]any{"1": primeiroNome(nome)}, []Botao{{"url", sufixo}}}}
}

// templatePedido: pedido recebido — UTILITY, {1: nome, 2: número} e NENHUM botão (link reclassificaria
// como marketing).
func templatePedido(nomeTemplate, idioma string, nome *string, numero *string) Template {
	return Template{nomeTemplate, "UTILITY", idioma, ParamsTemplate{map[string]any{"1": primeiroNome(nome), "2": numero}, nil}}
}

const limiteMaximoPorRodada = 100

func inteiro(x float64) bool { return !math.IsNaN(x) && !math.IsInf(x, 0) && x == math.Trunc(x) }

// validarConfig: o que o robô exige ANTES de tocar em qualquer linha. Falha FECHADA: segredo ausente
// ou inválido nunca vira "sem limite" nem "link quebrado para todos". O seco não fala com o Chatwoot.
func validarConfig(c Passada, chat ChatwootConfig, exigeLink bool) []string {
	var p []string
	if !inteiro(c.Limite) || c.Limite < 1 || c.Limite > limiteMaximoPorRodada {
		p = append(p, fmt.Sprintf("ENVIO_LIMITE_POR_RODADA inválido (inteiro de 1 a %d)", limiteMaximoPorRodada))
	}
	if exigeLink && (c.LinkBase == "" || !strings.HasSuffix(c.LinkBase, "/")) {
		p = append(p, "LINK_BASE vazio ou sem a barra final")
	}
	if c.Modo == "seco" {
		return p
	}
	if c.TemplateNome == "" {
		p = append(p, "TEMPLATE_NOME vazio")
	}
	if !strings.HasPrefix(chat.URL, "http://") && !strings.HasPrefix(chat.URL, "https://") {
		p = append(p, "CHATWOOT_URL vazio ou sem http(s)")
	}
	if chat.ContaID == "" {
		p = append(p, "CHATWOOT_CONTA_ID vazio")
	}
	if caixa := numeroJS(chat.CaixaID, math.NaN()); !inteiro(caixa) || caixa < 1 {
		p = append(p, "CHATWOOT_CAIXA_ID vazio ou inválido")
	}
	if chat.Token == "" {
		p = append(p, "CHATWOOT_API_TOKEN vazio")
	}
	if c.Modo == "lista" && len(c.SoPara) == 0 {
		p = append(p, "ENVIO_SO_PARA vazio")
	}
	return p
}

// Decisao é o que fazer com UMA linha antes de qualquer chamada externa.
type Decisao struct {
	Acao     string // enviar | ignorar | esperar
	Motivo   string
	Telefone string
	Sufixo   string
}

// decidirEnvio (abandono): na fila, com telefone de celular, sem pedido de parar, com link da base e
// dentro da janela.
func decidirEnvio(l LinhaAbandono, bloqueados map[string]bool, agora time.Time, base string) Decisao {
	if l.Status != "fila_envio" {
		return Decisao{Acao: "ignorar", Motivo: "nao_esta_mais_na_fila"}
	}
	if l.Telefone == nil || strings.TrimSpace(*l.Telefone) == "" {
		return Decisao{Acao: "ignorar", Motivo: "sem_telefone"}
	}
	tel := normalizarTelefone(l.Telefone)
	if tel == "" {
		return Decisao{Acao: "ignorar", Motivo: "telefone_invalido"}
	}
	if bloqueados[tel] {
		return Decisao{Acao: "ignorar", Motivo: "pediu_para_nao_receber"}
	}
	suf := sufixoDoLink(l.URL, base)
	if suf == "" {
		return Decisao{Acao: "ignorar", Motivo: "sem_link"}
	}
	if !dentroDaJanela(agora) {
		return Decisao{Acao: "esperar", Motivo: "fora_da_janela"}
	}
	return Decisao{Acao: "enviar", Telefone: tel, Sufixo: suf}
}

// decidirLinha (rodada-da-fila.js): pedido é transacional (sem bloqueados nem link); inicio e
// follow-up são marketing (bloqueados e link). inicio sem link AINDA espera (o link chega num evento
// seguinte do checkout) sem gastar tentativa.
func decidirLinha(tipo string, l LinhaFila, bloqueados map[string]bool, agora time.Time, base string) Decisao {
	if l.Telefone == nil || strings.TrimSpace(*l.Telefone) == "" {
		return Decisao{Acao: "ignorar", Motivo: "sem_telefone"}
	}
	tel := normalizarTelefone(l.Telefone)
	if tel == "" {
		return Decisao{Acao: "ignorar", Motivo: "telefone_invalido"}
	}
	suf := ""
	if tipo == "followup" || tipo == "inicio" {
		if bloqueados[tel] {
			return Decisao{Acao: "ignorar", Motivo: "pediu_para_nao_receber"}
		}
		if tipo == "inicio" && (l.URL == nil || *l.URL == "") {
			return Decisao{Acao: "esperar", Motivo: "sem_link_ainda"}
		}
		if suf = sufixoDoLink(l.URL, base); suf == "" {
			return Decisao{Acao: "ignorar", Motivo: "sem_link"}
		}
	}
	if !dentroDaJanela(agora) {
		return Decisao{Acao: "esperar", Motivo: "fora_da_janela"}
	}
	return Decisao{Acao: "enviar", Telefone: tel, Sufixo: suf}
}

// travaCruzadaLigada: ABANDONO_TRAVA_CRUZADA padrão LIGADA; só desliga com false/0/off/nao/não.
func travaCruzadaLigada(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "false", "0", "off", "nao", "não":
		return false
	}
	return true
}

const (
	motivoTravaCruzada = "ignorada_trava_cruzada"
	horasDaTrava       = 20
)

// amostraDoSufixo: o sufixo do link sem a chave secreta de recuperação (vai para o log do modo seco).
var reChave = regexp.MustCompile(`(?i)(key=)[^&]*`)

func amostraDoSufixo(s string) string { return reChave.ReplaceAllString(s, "${1}…") }

// LinhaAbandono é o que pegar_para_mensagem devolve (uma linha de checkout_abandono).
type LinhaAbandono struct {
	Token               string
	Telefone, Nome, URL *string
	Status              string
	IniciadoEm          time.Time
}

// LinhaFila é o que pegar_da_fila devolve (uma linha de mensagem_fila).
type LinhaFila struct {
	Chave                       string
	Numero, Nome, Telefone, URL *string
	ConversaOrigem              *int64
	CriadoEm                    time.Time
}
