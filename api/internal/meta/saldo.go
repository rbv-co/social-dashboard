package meta

import (
	"cmp"
	"fmt"
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/rbv-co/social-dashboard/api/internal/texto"
)

// Porta de _shared/saldo-de-conta.js. O `balance` da Meta é a FATURA, não o saldo: o saldo de verdade
// só vem como TEXTO em funding_source_details.display_string ("Saldo disponível (R$ 1.673,75 BRL)").
// O parse falha FECHADO: não reconheceu = 'nao-sei', que nunca vira aviso.

const tipoPrePago = 20

var reSaldo = regexp.MustCompile(`R\$` + texto.EspacoJS + `*([\d.]+),(\d{2})`)

// lerSaldoDoTexto: "Saldo disponível (R$ 1.673,75 BRL)" -> 167375 (centavos); outra forma -> nil.
func lerSaldoDoTexto(t string) *int64 {
	m := reSaldo.FindStringSubmatch(t)
	if m == nil {
		return nil
	}
	inteiro := strings.ReplaceAll(m[1], ".", "")
	n, err := strconv.ParseInt(inteiro, 10, 64)
	if err != nil {
		return nil
	}
	cent, _ := strconv.ParseInt(m[2], 10, 64)
	c := n*100 + cent
	return &c
}

func ehPrePaga(conta map[string]any) bool {
	if v, ok := conta["is_prepay_account"].(bool); ok && v {
		return true
	}
	fs, _ := conta["funding_source_details"].(map[string]any)
	return fs != nil && numero(fs["type"]) == tipoPrePago
}

// Leitura é o lerSaldo() de uma conta (+ conta e account_id, como a edge acrescenta).
type Leitura struct {
	PrePaga       bool
	Centavos      *int64
	Reais         *float64
	DiasRestantes *float64
	Nivel         string // acabou | critico | atencao | ok | nao-se-aplica | nao-sei
	Porque        string
	Conta         string
	AccountID     string
}

func f64(v float64) *float64 { return &v }

func plural(n float64) string {
	if n == 1 {
		return ""
	}
	return "s"
}

func lerSaldo(conta map[string]any, gastoPorDia float64) Leitura {
	if !ehPrePaga(conta) {
		return Leitura{Nivel: "nao-se-aplica", Porque: "Esta conta paga no cartão — não tem saldo que acabe."}
	}
	fs, _ := conta["funding_source_details"].(map[string]any)
	ds, _ := fs["display_string"].(string)
	c := lerSaldoDoTexto(ds)
	if c == nil {
		return Leitura{PrePaga: true, Nivel: "nao-sei", Porque: "Não consegui ler o saldo desta conta."}
	}
	reais := float64(*c) / 100
	var dias *float64
	if !math.IsNaN(gastoPorDia) && !math.IsInf(gastoPorDia, 0) && gastoPorDia > 0 {
		dias = f64(reais / gastoPorDia)
	}
	l := Leitura{PrePaga: true, Centavos: c, Reais: &reais}
	switch {
	case *c <= 0:
		l.DiasRestantes, l.Nivel, l.Porque = f64(0), "acabou", "O saldo acabou — as campanhas desta conta já podem ter parado."
	case dias == nil:
		l.Nivel, l.Porque = "ok", "Não sei o ritmo de gasto para estimar quanto tempo dura."
	case *dias < 1:
		l.DiasRestantes, l.Nivel, l.Porque = dias, "critico", "No ritmo atual, o saldo não passa de hoje."
	case *dias < 3:
		d := math.Floor(*dias)
		l.DiasRestantes, l.Nivel, l.Porque = dias, "atencao", fmt.Sprintf("No ritmo atual, o saldo dura cerca de %d dia%s.", int(d), plural(d))
	default:
		l.DiasRestantes, l.Nivel, l.Porque = dias, "ok", fmt.Sprintf("No ritmo atual, o saldo dura cerca de %d dias.", int(math.Floor(*dias)))
	}
	return l
}

var urgencia = map[string]int{"acabou": 0, "critico": 1, "atencao": 2}

// contasParaAvisar: só acabou, critico e atencao ('nao-sei' fica de fora de propósito), da mais urgente
// para a menos; empate pelo prazo (sort estável, como o do JS).
func contasParaAvisar(ls []Leitura) []Leitura {
	var out []Leitura
	for _, l := range ls {
		if _, ok := urgencia[l.Nivel]; ok {
			out = append(out, l)
		}
	}
	dias := func(l Leitura) float64 {
		if l.DiasRestantes == nil {
			return 0
		}
		return *l.DiasRestantes
	}
	slices.SortStableFunc(out, func(a, b Leitura) int {
		if c := cmp.Compare(urgencia[a.Nivel], urgencia[b.Nivel]); c != 0 {
			return c
		}
		return cmp.Compare(dias(a), dias(b))
	})
	return out
}

// montarAvisoDeSaldo: título e corpo do push, ou ok=false quando não há o que avisar.
func montarAvisoDeSaldo(ls []Leitura) (titulo, corpo string, ok bool) {
	lista := contasParaAvisar(ls)
	if len(lista) == 0 {
		return "", "", false
	}
	p := lista[0]
	linha := func(l Leitura) string {
		if l.Nivel == "acabou" {
			return l.Conta + ": sem saldo"
		}
		prazo := "hoje"
		if *l.DiasRestantes >= 1 {
			d := math.Floor(*l.DiasRestantes)
			prazo = fmt.Sprintf("%d dia%s", int(d), plural(d))
		}
		return fmt.Sprintf("%s: %s (~%s)", l.Conta, texto.ReaisSimples(*l.Reais), prazo)
	}
	switch p.Nivel {
	case "acabou":
		titulo = p.Conta + " está sem saldo"
	case "critico":
		titulo = p.Conta + ": saldo acaba hoje"
	default:
		d := math.Floor(*p.DiasRestantes)
		titulo = fmt.Sprintf("%s: saldo para %d dia%s", p.Conta, int(d), plural(d))
	}
	if len(lista) == 1 {
		corpo = texto.ReaisSimples(*p.Reais) + " restantes. " + p.Porque
	} else {
		partes := make([]string, len(lista))
		for i, l := range lista {
			partes[i] = linha(l)
		}
		corpo = strings.Join(partes, " · ")
	}
	return titulo, corpo, true
}
