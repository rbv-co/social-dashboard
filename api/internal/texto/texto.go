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

// centavos arredonda como o Intl do JS: sobre a representação decimal MAIS CURTA do double (a de
// String(v)), metade para longe do zero (ECMA-402 roundingMode "halfExpand"). 2.675 vira 268 (o
// double é 2,67499…, mas o JS arredonda o texto "2.675"); 0.015 vira 2.
func centavos(v float64) int64 {
	inteiro, frac, _ := strings.Cut(strconv.FormatFloat(math.Abs(v), 'f', -1, 64), ".")
	frac += "000"
	n, _ := strconv.ParseInt(inteiro+frac[:2], 10, 64)
	if frac[2] >= '5' {
		n++
	}
	return n
}

func milhar(n int64) string {
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return b.String()
}

func valor(v float64) string {
	c := centavos(v)
	return milhar(c/100) + "," + strconv.FormatInt(100+c%100, 10)[1:]
}

// Reais = v.toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'}): "R$" + espaço NÃO
// separável (U+00A0) + "1.234,56"; negativo "-R$ 1,00".
func Reais(v float64) string {
	sinal := ""
	if v < 0 {
		sinal = "-"
	}
	return sinal + "R$\U000000a0" + valor(v)
}

// ReaisSimples = 'R$ ' + v.toLocaleString('pt-BR', {minimumFractionDigits: 2, maximumFractionDigits: 2})
// (espaço comum; negativo "R$ -1,00"), o brl() de _shared/saldo-de-conta.js.
func ReaisSimples(v float64) string {
	sinal := ""
	if v < 0 {
		sinal = "-"
	}
	return "R$ " + sinal + valor(v)
}

// Milhar = n.toLocaleString('pt-BR') para inteiro: "24.351".
func Milhar(n int64) string {
	if n < 0 {
		return "-" + milhar(-n)
	}
	return milhar(n)
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
