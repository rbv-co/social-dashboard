package publico

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

// Regras de casamento da garantia: porta de supabase/functions/_shared/{casar-sku-do-bling,nome-de-quem-deu}.js.
// Elas decidem se a cliente ganha a garantia SEM ninguém olhar: na dúvida, FILA (errar para o lado seguro).

// achatar: só letras e dígitos, maiúsculas, sem acento.
func achatar(s string) string {
	s = strings.ReplaceAll(s, "ß", "SS") // o toUpperCase do JS faz isto
	var b strings.Builder
	for _, r := range strings.ToUpper(norm.NFD.String(s)) {
		if (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// minimoParaComparar: prefixo curto casa com meio catálogo (SS1 com SS1025-F, SS1162...).
const minimoParaComparar = 4

// casaComOSku: o código do item do pedido contra o SKU do lote; prefixo nos dois sentidos, nunca mais frouxo.
func casaComOSku(codigoDoItem, sku string) bool {
	a, b := achatar(codigoDoItem), achatar(sku)
	if len(a) < minimoParaComparar || len(b) < minimoParaComparar {
		return false
	}
	return strings.HasPrefix(a, b) || strings.HasPrefix(b, a)
}

var particulas = map[string]bool{"de": true, "da": true, "do": true, "das": true, "dos": true, "e": true}

// normalizarNome: sem acento (U+0300 a U+036F), minúsculo, só a-z e espaço, espaços colapsados.
func normalizarNome(t string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(norm.NFD.String(t)) {
		switch {
		case r >= 0x300 && r <= 0x36f:
		case r >= 'a' && r <= 'z':
			b.WriteRune(r)
		default:
			b.WriteByte(' ')
		}
	}
	return strings.Join(strings.FieldsFunc(b.String(), unicode.IsSpace), " ")
}

func pedacos(nome string) []string {
	var out []string
	for _, p := range strings.Split(normalizarNome(nome), " ") {
		if p != "" && !particulas[p] {
			out = append(out, p)
		}
	}
	return out
}

// nomesBatem (estrita): primeiro nome igual E último sobrenome igual.
func nomesBatem(digitado, doPedido string) bool {
	a, b := pedacos(digitado), pedacos(doPedido)
	if len(a) < 2 || len(b) < 2 {
		return false
	}
	return a[0] == b[0] && a[len(a)-1] == b[len(b)-1]
}

func distancia(a, b string) int {
	d := make([][]int, len(a)+1)
	for i := range d {
		d[i] = make([]int, len(b)+1)
		d[i][0] = i
	}
	for j := 0; j <= len(b); j++ {
		d[0][j] = j
	}
	for i := 1; i <= len(a); i++ {
		for j := 1; j <= len(b); j++ {
			troca := 1
			if a[i-1] == b[j-1] {
				troca = 0
			}
			d[i][j] = min(d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+troca)
		}
	}
	return d[len(a)][len(b)]
}

// limiteDeDistancia escala com o menor sobrenome: curto exige igualdade ("Pina"/"Lima" são pessoas diferentes).
func limiteDeDistancia(tamanho int) int {
	switch {
	case tamanho < 5:
		return 0
	case tamanho <= 7:
		return 1
	}
	return 2
}

// nomesChegamPerto (frouxa): primeiro nome IGUAL e sobrenome quase igual. SÓ com a marca PRESENTE do Bling no pedido.
func nomesChegamPerto(digitado, doPedido string) bool {
	a, b := pedacos(digitado), pedacos(doPedido)
	if len(a) < 2 || len(b) < 2 || a[0] != b[0] {
		return false
	}
	sa, sb := a[len(a)-1], b[len(b)-1]
	return distancia(sa, sb) <= limiteDeDistancia(min(len(sa), len(sb)))
}
