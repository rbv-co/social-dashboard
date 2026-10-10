package comercial

import (
	"cmp"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
)

// pedido é o que o push de vendas precisa de um pedido do Bling (ou trazido de outro dia).
type pedido struct {
	ID     int64
	Data   string // AAAA-MM-DD
	Total  float64
	LojaID *int64
	Itens  int
}

// linhaDaNota é uma linha de bling_pedido_nota.
type linhaDaNota struct {
	PedidoID     int64
	DataPedido   string
	DataDaVenda  string
	Total        float64
	LojaID       *int64
	NotaSituacao *int
}

func dentro(dia, di, df string) bool { return dia != "" && dia >= di && dia <= df }

// ajustarPelaDataDaNota (_shared/data-da-venda.js): a venda conta no dia da NOTA. Sem linha
// fica como está; nota negada (2, 4, 9) tira a venda; trazido de outro dia só com nota
// AUTORIZADA (5, 6).
func ajustarPelaDataDaNota(pedidos []pedido, linhas []linhaDaNota, di, df string) []pedido {
	porID := map[int64]linhaDaNota{}
	for _, l := range linhas {
		porID[l.PedidoID] = l
	}
	negada := func(l linhaDaNota) bool {
		return l.NotaSituacao != nil && (*l.NotaSituacao == 2 || *l.NotaSituacao == 4 || *l.NotaSituacao == 9)
	}
	autorizada := func(l linhaDaNota) bool {
		return l.NotaSituacao != nil && (*l.NotaSituacao == 5 || *l.NotaSituacao == 6)
	}
	var saida []pedido
	vistos := map[int64]bool{}
	for _, p := range pedidos {
		vistos[p.ID] = true
		l, ok := porID[p.ID]
		if !ok {
			saida = append(saida, p)
			continue
		}
		if negada(l) {
			continue
		}
		dia := l.DataDaVenda
		if dia == "" {
			dia = p.Data
		}
		if !dentro(dia, di, df) {
			continue
		}
		p.Data = dia
		saida = append(saida, p)
	}
	for _, l := range linhas {
		if vistos[l.PedidoID] || !autorizada(l) || !dentro(l.DataDaVenda, di, df) {
			continue
		}
		saida = append(saida, pedido{ID: l.PedidoID, Data: l.DataDaVenda, Total: l.Total, LojaID: l.LojaID})
	}
	return saida
}

// aplicarValorCorrigido (_shared/valor-corrigido.js): bling_pedido_ajuste_valor vence o
// total do Bling; ajuste negativo não passa; ajuste nunca TRAZ pedido.
func aplicarValorCorrigido(pedidos []pedido, ajustes map[int64]float64) []pedido {
	for i, p := range pedidos {
		if v, ok := ajustes[p.ID]; ok && v >= 0 {
			pedidos[i].Total = v
		}
	}
	return pedidos
}

type metricas struct {
	Valor  float64
	Vendas int
	Itens  int
}

type canalAgregado struct {
	LojaID   int64
	Nome     string
	Ref, Cmp metricas
}

type agregado struct {
	Ref, Cmp metricas
	Canais   []canalAgregado // só lojas cadastradas, do maior valor para o menor
}

// agregarVendasPorCanal (_shared/vendas-do-dia.js): totais somam TODOS os pedidos (até de
// loja não cadastrada); a quebra por canal só as lojas de bling_lojas.
func agregarVendasPorCanal(ref, cmpDia []pedido, lojas []canalAgregado) agregado {
	soma := func(ps []pedido) (map[int64]metricas, metricas) {
		por := map[int64]metricas{}
		var tot metricas
		for _, p := range ps {
			k := int64(0)
			if p.LojaID != nil {
				k = *p.LojaID
			}
			m := por[k]
			m.Valor += p.Total
			m.Vendas++
			m.Itens += p.Itens
			por[k] = m
			tot.Valor += p.Total
			tot.Vendas++
			tot.Itens += p.Itens
		}
		return por, tot
	}
	pr, tr := soma(ref)
	pc, tc := soma(cmpDia)
	a := agregado{Ref: tr, Cmp: tc}
	for _, l := range lojas {
		a.Canais = append(a.Canais, canalAgregado{LojaID: l.LojaID, Nome: l.Nome, Ref: pr[l.LojaID], Cmp: pc[l.LojaID]})
	}
	slices.SortStableFunc(a.Canais, func(x, y canalAgregado) int { return cmp.Compare(y.Ref.Valor, x.Ref.Valor) })
	return a
}

// brl imita toLocaleString('pt-BR', {style:'currency', currency:'BRL', maximumFractionDigits:0}):
// "R$" + espaço NÃO separável (U+00A0) + milhar com ponto; arredonda metade para longe do zero.
func brl(v float64) string {
	n := int64(math.Round(v))
	sinal := ""
	if n < 0 {
		sinal, n = "-", -n
	}
	s := strconv.FormatInt(n, 10)
	var b strings.Builder
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return sinal + "R$ " + b.String()
}

// seta: 📈 sobe, 📉 cai, ➡️ estável, 🆕 quando a comparação foi zero.
func seta(ref, comparacao float64) string {
	if comparacao == 0 {
		return "\U0001F195"
	}
	s := int(math.Floor((ref-comparacao)/comparacao*100 + 0.5)) // o Math.round do JS
	switch {
	case s > 0:
		return fmt.Sprintf("\U0001F4C8 %d%%", s)
	case s < 0:
		return fmt.Sprintf("\U0001F4C9 %d%%", -s)
	}
	return "➡️ 0%"
}

func plural(n int, sing, plur string) string {
	if n == 1 {
		return fmt.Sprintf("%d %s", n, sing)
	}
	return fmt.Sprintf("%d %s", n, plur)
}

// montarCorpo (_shared/vendas-do-dia.js): a MESMA notificação serve 22h (hoje × ontem) e
// 07h (ontem × anteontem).
func montarCorpo(a agregado, refLabel, cmpLabel string) map[string]string {
	linhas := []string{fmt.Sprintf("%s vs %s · %s · %s", seta(a.Ref.Valor, a.Cmp.Valor), cmpLabel,
		plural(a.Ref.Vendas, "venda", "vendas"), plural(a.Ref.Itens, "item", "itens"))}
	movimento := false
	for _, c := range a.Canais {
		if c.Ref.Vendas > 0 {
			movimento = true
			linhas = append(linhas, fmt.Sprintf("%s · %s · %s", c.Nome, brl(c.Ref.Valor), seta(c.Ref.Valor, c.Cmp.Valor)))
		}
	}
	if !movimento {
		ainda := ""
		if refLabel == "hoje" {
			ainda = " ainda"
		}
		linhas = append(linhas, "Nenhuma venda registrada "+refLabel+ainda+".")
	}
	return map[string]string{
		"title": "\U0001F6CD️ Vendas de " + refLabel + " · " + brl(a.Ref.Valor),
		"body":  strings.Join(linhas, "\n"),
		"url":   "/gestao-vista",
		"tag":   "vendas-do-dia",
	}
}
