// Package frota: o aviso do checklist da manhã e o aviso da decisão de reserva (push).
package frota

import (
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
	_ "time/tzdata" // America/Sao_Paulo sem depender do zoneinfo do contêiner

	"github.com/rbv-co/social-dashboard/api/internal/texto"
)

var saoPaulo = func() *time.Location {
	l, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		panic(err)
	}
	return l
}()

// Config é a linha de frota_checklist_config.
type Config struct{ DiaSemanal, SemanaMensal, DiaMensal int }

func dia(iso string) time.Time { t, _ := time.Parse("2006-01-02", iso); return t }

// diaDaSemana (checklist.js): 1 = segunda … 7 = domingo.
func diaDaSemana(iso string) int {
	n := int(dia(iso).Weekday())
	if n == 0 {
		return 7
	}
	return n
}

func diasEntre(a, b string) int { return int(dia(b).Sub(dia(a)).Hours() / 24) }

func ehDiaDoMensal(iso string, c Config) bool {
	return diaDaSemana(iso) == c.DiaMensal && (dia(iso).Day()-1)/7+1 == c.SemanaMensal
}

// cadenciasDoDia (checklist.js, sem `pegandoAgora`: o robô da manhã não pega carro). Nunca feito
// NÃO é atrasado; fim de semana não pede nada.
func cadenciasDoDia(hoje string, c Config, ultimaSemanal, ultimaMensal string) []string {
	if diaDaSemana(hoje) > 5 {
		return nil
	}
	out := []string{"diario"}
	if diaDaSemana(hoje) == c.DiaSemanal || (ultimaSemanal != "" && diasEntre(ultimaSemanal, hoje) > 7) {
		out = append(out, "semanal")
	}
	if ehDiaDoMensal(hoje, c) || (ultimaMensal != "" && diasEntre(ultimaMensal, hoje) > 31) {
		out = append(out, "mensal")
	}
	return out
}

// Item é uma linha de frota_checklist_itens.
type Item struct {
	Cadencia string
	Ordem    int
	Ativo    bool
}

// itensDaFicha: os itens ativos das cadências pedidas, na ordem do gestor.
func itensDaFicha(itens []Item, cadencias []string) []Item {
	var out []Item
	for _, i := range itens {
		if i.Ativo && slices.Contains(cadencias, i.Cadencia) {
			out = append(out, i)
		}
	}
	slices.SortStableFunc(out, func(a, b Item) int { return a.Ordem - b.Ordem })
	return out
}

// montarAviso (aviso-de-checklist.js): o tamanho da tarefa, e por que hoje é mais longo.
func montarAviso(veiculo string, itens int, cadencias []string) (titulo, corpo string) {
	quantos := fmt.Sprintf("%d itens", itens)
	if itens == 1 {
		quantos = "1 item"
	}
	extra := ""
	switch {
	case slices.Contains(cadencias, "mensal"):
		extra = " Hoje tem a conferência do mês junto."
	case slices.Contains(cadencias, "semanal"):
		extra = " Hoje tem a conferência da semana junto."
	}
	return "Checklist do " + veiculo, quantos + " e o hodômetro." + extra
}

// Pessoa é uma linha de acessos_pessoas; Usuario, de profiles.
type Pessoa struct{ ID, Nome, ProfileID, EmailCorporativo string }
type Usuario struct{ ID, Email string }

func chaveDeEmail(s string) string { return strings.ToLower(aparar(s)) }

// loginDaPessoa (quem-loga.js): o elo profile_id (se aponta para usuário que existe), senão o e-mail
// corporativo. Vazio = sem login (resposta legítima).
func loginDaPessoa(p *Pessoa, usuarios []Usuario) string {
	if p == nil {
		return ""
	}
	if p.ProfileID != "" {
		for _, u := range usuarios {
			if u.ID == p.ProfileID {
				return u.ID
			}
		}
	}
	email := chaveDeEmail(p.EmailCorporativo)
	if email == "" {
		return ""
	}
	for _, u := range usuarios {
		if chaveDeEmail(u.Email) == email {
			return u.ID
		}
	}
	return ""
}

// ── aviso da decisão de reserva (aviso-de-reserva.js) ────────────────────────────────────────────

// Requisicao é o pedaço de frota_requisicoes que o aviso lê.
type Requisicao struct {
	ID, VeiculoID, Situacao                 string
	RetiradaPrevista                        *time.Time
	Destino, MotivoDecisao, EncerradaMotivo *string
	PessoaID, PessoaNome, CriadaPor         *string
}

// Aviso é o texto do push, com as chaves da edge (titulo, corpo, url).
type Aviso struct {
	Titulo string `json:"titulo"`
	Corpo  string `json:"corpo"`
	URL    string `json:"url"`
}

// maxCarga é o registro único do Web Push (RFC 8188): 4096 - cabeçalho(86) - tag(16) - delimitador(1). O mesmo
// número do webpush.maxPayload, que não é exportado; acima dele o envio falha para todo aparelho.
const maxCarga = 3993

// carga é o corpo do push: o texto e a url IGUAIS aos da edge (titulo/corpo/url), mais `title`/`body` (as
// chaves que public/sw-push.js lê: sem elas o celular mostraria "Vendas de hoje" e corpo vazio) e a `tag`
// própria do tipo. Tag vazia ou 'vendas-do-dia' (o que o service worker usa quando falta) faria um reenvio
// SUBSTITUIR o card das vendas: quem chama passa sempre uma tag estável. A tag é só do aparelho; a
// deduplicação do envio é do livro (envios_feitos), que leva o dia ou o id da decisão.
//
// Tamanho: o corpo vai duas vezes (corpo e body) e o destino da reserva é texto livre. Se passar de maxCarga,
// só o FIM do corpo é cortado (busca binária pelo maior prefixo que cabe, em fronteira de caractere, mais
// "…"); o título, o começo do corpo e a url ficam. Até esse tamanho o texto não muda um byte.
func carga(a Aviso, tag string) []byte {
	monta := func(corpo string) []byte {
		b, _ := json.Marshal(struct {
			Titulo string `json:"titulo"`
			Corpo  string `json:"corpo"`
			Title  string `json:"title"`
			Body   string `json:"body"`
			Tag    string `json:"tag"`
			URL    string `json:"url"`
		}{a.Titulo, corpo, a.Titulo, corpo, tag, a.URL})
		return b
	}
	b := monta(a.Corpo)
	if len(b) <= maxCarga {
		return b
	}
	corpo := []rune(a.Corpo)
	lo, hi := 0, len(corpo) // maior n com o prefixo de n caracteres + "…" cabendo
	for lo < hi {
		meio := (lo + hi + 1) / 2
		if len(monta(string(corpo[:meio])+"…")) <= maxCarga {
			lo = meio
		} else {
			hi = meio - 1
		}
	}
	return monta(string(corpo[:lo]) + "…")
}

var reEspacos = regexp.MustCompile(texto.EspacoJS + `+`)
var reBordas = regexp.MustCompile(`^` + texto.EspacoJS + `+|` + texto.EspacoJS + `+$`)

// aparar = trim() do JS (o `\s` do JS, não o unicode.IsSpace do Go: U+FEFF sai, U+0085 fica).
func aparar(s string) string { return reBordas.ReplaceAllString(s, "") }

// encurtar: um parágrafo no push é cortado pelo celular no meio da frase; corta aqui, com reticências.
func encurtar(p *string) string {
	if p == nil {
		return ""
	}
	t := aparar(reEspacos.ReplaceAllString(*p, " ")) // = trim() + replace(/\s+/g, ' ') do JS
	if texto.CortarUTF16(t, 120) == t {
		return t
	}
	return strings.TrimRight(texto.CortarUTF16(t, 119), " ") + "…"
}

// montarAvisoDeReserva: o aviso de uma reserva DECIDIDA; ok=false para o que não é decisão.
func montarAvisoDeReserva(r Requisicao, veiculo string) (Aviso, bool) {
	if veiculo == "" {
		veiculo = "o veículo"
	}
	partes := []string{veiculo}
	if r.RetiradaPrevista != nil {
		partes = append(partes, r.RetiradaPrevista.In(saoPaulo).Format("02/01 às 15:04"))
	}
	junto := func() string { return strings.Join(partes, " · ") }
	switch r.Situacao {
	case "aprovada":
		if r.Destino != nil && *r.Destino != "" { // "  " conta (truthy no JS): entra aparado
			partes = append(partes, aparar(*r.Destino))
		}
		return Aviso{"Reserva aprovada", junto(), "/frota"}, true
	case "recusada":
		if m := encurtar(r.MotivoDecisao); m != "" {
			return Aviso{"Reserva recusada", junto() + " — " + m, "/frota"}, true
		}
		return Aviso{"Reserva recusada", junto() + " — sem motivo escrito. Fale com quem administra a Frota.", "/frota"}, true
	case "revogada", "cancelada":
		titulo := "A sua reserva foi cancelada"
		if r.Situacao == "revogada" {
			titulo = "A sua reserva foi encerrada"
		}
		if m := encurtar(r.EncerradaMotivo); m != "" {
			return Aviso{titulo, junto() + " — " + m, "/frota"}, true
		}
		return Aviso{titulo, junto() + " — o carro não está mais reservado para você.", "/frota"}, true
	}
	return Aviso{}, false
}
