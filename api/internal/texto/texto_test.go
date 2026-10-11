package texto

import (
	"math"
	"regexp"
	"strings"
	"testing"
)

// Os valores esperados saíram do Node 22 (o mesmo Intl das edges), não de cabeça.
func TestReaisComoOIntlDoJS(t *testing.T) {
	casos := []struct {
		v              float64
		reais, simples string
	}{
		{0, "R$\U000000a00,00", "R$ 0,00"},
		{3, "R$\U000000a03,00", "R$ 3,00"},
		{1234.56, "R$\U000000a01.234,56", "R$ 1.234,56"},
		{0.005, "R$\U000000a00,01", "R$ 0,01"},
		{0.015, "R$\U000000a00,02", "R$ 0,02"},
		{2.675, "R$\U000000a02,68", "R$ 2,68"},
		{1e6, "R$\U000000a01.000.000,00", "R$ 1.000.000,00"},
		{12.3456, "R$\U000000a012,35", "R$ 12,35"},
		{-1, "-R$\U000000a01,00", "R$ -1,00"},
		{0.125, "R$\U000000a00,13", "R$ 0,13"},
		{1.005, "R$\U000000a01,01", "R$ 1,01"},
		{123456789.995, "R$\U000000a0123.456.790,00", "R$ 123.456.790,00"},
		{451.8, "R$\U000000a0451,80", "R$ 451,80"},
		{0.1 + 0.2, "R$\U000000a00,30", "R$ 0,30"},
		{999.995, "R$\U000000a01.000,00", "R$ 1.000,00"},
		{-1234.5, "-R$\U000000a01.234,50", "R$ -1.234,50"},
	}
	for _, c := range casos {
		if got := Reais(c.v); got != c.reais {
			t.Errorf("Reais(%v) = %q, esperava %q", c.v, got, c.reais)
		}
		if got := ReaisSimples(c.v); got != c.simples {
			t.Errorf("ReaisSimples(%v) = %q, esperava %q", c.v, got, c.simples)
		}
	}
}

func TestMilhar(t *testing.T) {
	for n, quer := range map[int64]string{0: "0", 7: "7", 999: "999", 1000: "1.000", 24351: "24.351", 1234567: "1.234.567", -24351: "-24.351"} {
		if got := Milhar(n); got != quer {
			t.Errorf("Milhar(%d) = %q, esperava %q", n, got, quer)
		}
	}
}

func TestCortarUTF16(t *testing.T) {
	if got := CortarUTF16("ação", 3); got != "açã" {
		t.Errorf("acentuado precomposto conta 1: %q", got)
	}
	if got := CortarUTF16("𝐁𝐨𝐥𝐬𝐚 preta", 4); got != "𝐁𝐨" {
		t.Errorf("letra matemática conta 2: %q", got)
	}
	if got := CortarUTF16("𝐁𝐨𝐥", 3); got != "𝐁\U0000fffd" {
		t.Errorf("corte no meio do par: %q", got)
	}
	if got := CortarUTF16("abc", 10); got != "abc" {
		t.Errorf("%q", got)
	}
}

func TestEspacoJS(t *testing.T) {
	re := regexp.MustCompile(`^` + EspacoJS + `+$`)
	if !re.MatchString("\t\n\v\f\r \U000000a0\U00001680\U00002000\U0000200a\U00002028\U00002029\U0000202f\U0000205f\U00003000\U0000feff") {
		t.Fatal("falta espaço do JS na classe")
	}
	if re.MatchString("\U00000085") || re.MatchString("\U0000200b") {
		t.Fatal("U+0085 e U+200B não são \\s no JS")
	}
}

// Extremos, também do Node 22: NaN, infinito, zero negativo, centavo que "vai um" e valores além do
// inteiro seguro (o JS imprime os dígitos mais curtos do double e completa com zeros; o Go faz igual).
func TestReaisExtremosComoOIntlDoJS(t *testing.T) {
	casos := []struct {
		v              float64
		reais, simples string
	}{
		{math.NaN(), "R$\U000000a0NaN", "R$ NaN"},
		{math.Copysign(math.NaN(), -1), "R$\U000000a0NaN", "R$ NaN"}, // NaN com o bit de sinal ligado: NaN não tem sinal
		{math.Inf(1), "R$\U000000a0∞", "R$ ∞"},
		{math.Inf(-1), "-R$\U000000a0∞", "R$ -∞"},
		{math.Copysign(0, -1), "-R$\U000000a00,00", "R$ -0,00"},
		{-0.001, "-R$\U000000a00,00", "R$ -0,00"},
		{-0.004, "-R$\U000000a00,00", "R$ -0,00"},
		{-0.005, "-R$\U000000a00,01", "R$ -0,01"},
		{0.995, "R$\U000000a01,00", "R$ 1,00"},
		{1e15, "R$\U000000a01.000.000.000.000.000,00", "R$ 1.000.000.000.000.000,00"},
		{9007199254740991, "R$\U000000a09.007.199.254.740.991,00", "R$ 9.007.199.254.740.991,00"},
		{1e17, "R$\U000000a0100.000.000.000.000.000,00", "R$ 100.000.000.000.000.000,00"},
		{123456789012345680, "R$\U000000a0123.456.789.012.345.680,00", "R$ 123.456.789.012.345.680,00"},
		{1e21, "R$\U000000a01.000.000.000.000.000.000.000,00", "R$ 1.000.000.000.000.000.000.000,00"},
		{-1e21, "-R$\U000000a01.000.000.000.000.000.000.000,00", "R$ -1.000.000.000.000.000.000.000,00"},
		{1.5e21, "R$\U000000a01.500.000.000.000.000.000.000,00", "R$ 1.500.000.000.000.000.000.000,00"},
		{99999999999999.995, "R$\U000000a0100.000.000.000.000,00", "R$ 100.000.000.000.000,00"},
		{1e300, "R$\U000000a01" + strings.Repeat(".000", 100) + ",00", "R$ 1" + strings.Repeat(".000", 100) + ",00"},
	}
	for _, c := range casos {
		if got := Reais(c.v); got != c.reais {
			t.Errorf("Reais(%v) = %q, esperava %q", c.v, got, c.reais)
		}
		if got := ReaisSimples(c.v); got != c.simples {
			t.Errorf("ReaisSimples(%v) = %q, esperava %q", c.v, got, c.simples)
		}
	}
	if got := Milhar(math.MinInt64); got != "-9.223.372.036.854.775.808" {
		t.Errorf("Milhar(MinInt64) = %q", got)
	}
	if got := Milhar(math.MaxInt64); got != "9.223.372.036.854.775.807" {
		t.Errorf("Milhar(MaxInt64) = %q", got)
	}
}
