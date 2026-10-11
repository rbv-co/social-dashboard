// Package texto: as poucas formatações do JavaScript das edges que as mensagens e avisos precisam
// reproduzir byte a byte (dinheiro, milhar, corte de texto).
package texto

import (
	"math"
	"strconv"
	"strings"
	"unicode/utf16"
)

// EspacoJS é a classe `\s` do JavaScript (o `\s` do Go só tem o ASCII): para regex portadas das edges.
const EspacoJS = `[\t\n\v\f\r \x{00a0}\x{1680}\x{2000}-\x{200a}\x{2028}\x{2029}\x{202f}\x{205f}\x{3000}\x{feff}]`

// agruparMilhar põe o ponto a cada três dígitos de uma string de dígitos ("1234567" -> "1.234.567").
func agruparMilhar(s string) string {
	var b strings.Builder
	for i := range len(s) {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteByte(s[i])
	}
	return b.String()
}

// valor formata |v| com duas casas como o Intl do JS. Trabalha sobre o TEXTO: o JS imprime os dígitos
// mais curtos do double (a representação de String(v)) e completa com zeros, então 2.675 vira "2,68"
// (o double é 2,67499…, mas o JS arredonda o texto "2.675", metade para longe do zero: ECMA-402
// "halfExpand"), 0.015 vira "0,02" e 1e21 vira "1.000.000.000.000.000.000.000,00" (sem teto: não passa
// por inteiro de 64 bits). NaN e infinito saem "NaN" e "∞", como no Node.
func valor(v float64) string {
	switch {
	case math.IsNaN(v):
		return "NaN"
	case math.IsInf(v, 0):
		return "∞"
	}
	inteiro, frac, _ := strings.Cut(strconv.FormatFloat(math.Abs(v), 'f', -1, 64), ".")
	frac += "000"
	d := []byte(inteiro + frac[:2]) // centavos como texto de dígitos
	if frac[2] >= '5' {             // soma 1 centavo, levando o "vai um"
		i := len(d) - 1
		for ; i >= 0 && d[i] == '9'; i-- {
			d[i] = '0'
		}
		if i < 0 {
			d = append([]byte{'1'}, d...)
		} else {
			d[i]++
		}
	}
	n := len(d) - 2
	return agruparMilhar(string(d[:n])) + "," + string(d[n:])
}

// negativo: o Intl mostra o "-" também no zero negativo e em quem arredonda para 0,00 (-0.001); NaN não tem sinal.
func negativo(v float64) bool { return !math.IsNaN(v) && math.Signbit(v) }

// Reais = v.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}): "R$" + espaço NÃO
// separável (U+00A0) + "1.234,56"; negativo "-R$ 1,00".
func Reais(v float64) string {
	sinal := ""
	if negativo(v) {
		sinal = "-"
	}
	return sinal + "R$\U000000a0" + valor(v)
}

// ReaisSimples = 'R$ ' + v.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})
// (espaço comum; negativo "R$ -1,00"), o brl() de _shared/saldo-de-conta.js.
func ReaisSimples(v float64) string {
	sinal := ""
	if negativo(v) {
		sinal = "-"
	}
	return "R$ " + sinal + valor(v)
}

// Milhar = n.toLocaleString('pt-BR') para inteiro: "24.351".
func Milhar(n int64) string {
	s := strconv.FormatInt(n, 10)
	if neg := strings.HasPrefix(s, "-"); neg {
		return "-" + agruparMilhar(s[1:])
	}
	return agruparMilhar(s)
}

// CortarUTF16 = s.slice(0, n) do JS, que conta unidades UTF-16 (um emoji ou letra "𝐁" vale 2).
// Diferença de propósito: um corte no meio de um par substituto vira U+FFFD (o JS deixaria meio caractere).
func CortarUTF16(s string, n int) string {
	u := utf16.Encode([]rune(s))
	if len(u) <= n {
		return s
	}
	return string(utf16.Decode(u[:n]))
}
