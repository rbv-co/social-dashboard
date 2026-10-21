package comercial

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/canais"
	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// GET /vendas/pedidos: os pedidos "Atendido" (9) lidos do ESPELHO do core, no formato da lista de
// `pedidos/vendas` do Bling que as telas já sabem ler (id, numero, data, total, loja.id, vendedor.id) e com os
// itens do pedido já dentro (no lugar de uma chamada ao Bling por pedido). Plano 03-A do BLING-FORA-ESPELHO:
// Gestão à Vista e Análise de Vendas abrem com o Bling fora.
//
// Fonte pela flag VENDAS_FONTE (padrão `bling`): com `bling` a rota responde {"fonte":"bling"} e a tela segue o
// caminho antigo; com `espelho` responde os pedidos. A flag aceita `espelho`, `bling` ou, por tela,
// `gestao=espelho,analise=bling` (o `tela` vem na query). Rollback = voltar a flag; sem reserva silenciosa: Core
// fora é erro claro (503), nunca lista parcial nem Bling por baixo.

const (
	vendasTTL        = 60 * time.Second // o limite do token no core é 120 leituras/min, dividido com Meta e Bling
	vendasMaxDias    = 93               // 1 mês + folga; a leitura gasta ~2 GETs por 100 pedidos
	vendasMaxIDs     = 100
	vendasLoteItens  = 100 // mesmo lote da leitura dupla (cabe na URL)
	vendasIdadeAviso = 30 * time.Minute
	situacaoAtendido = "9"
)

var (
	reDia    = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
	reNumero = regexp.MustCompile(`^[0-9]{1,18}$`)
	reTela   = regexp.MustCompile(`^[a-z-]{1,20}$`)
)

// FonteDeVendas lê VENDAS_FONTE para uma tela: `espelho`/`bling` vale para todas, `tela=fonte,tela=fonte` é por
// tela (o valor solto é o padrão). Vazio, torto ou desconhecido = `bling` (o lado seguro, sem mudança).
func FonteDeVendas(env, tela string) string {
	padrao := "bling"
	for _, parte := range strings.Split(env, ",") {
		chave, valor, tem := strings.Cut(strings.TrimSpace(parte), "=")
		valor = strings.ToLower(strings.TrimSpace(valor))
		if !tem {
			chave, valor = "", strings.ToLower(strings.TrimSpace(parte))
		}
		if valor != "espelho" && valor != "bling" {
			continue
		}
		if tem && strings.TrimSpace(chave) == tela && tela != "" {
			return valor
		}
		if !tem {
			padrao = valor
		}
	}
	return padrao
}

// VendasEspelho serve GET /vendas/pedidos. Deve vir DEPOIS de auth.Exigir.
type VendasEspelho struct {
	Pool  *pgxpool.Pool
	Core  *core.Cliente
	Fonte string // VENDAS_FONTE

	// Canais devolve as lojas a que o ator está limitado (nil = todas). Padrão: canais.Carregar.
	Canais func(ctx context.Context, a *auth.Ator) ([]int64, error)
	Agora  func() time.Time

	mu    sync.Mutex
	cache map[string]*leituraVendas
}

// leituraVendas é uma leitura do período inteiro (sem recorte de canal: o recorte é por pessoa, na saída).
type leituraVendas struct {
	mu      sync.Mutex // quem chega durante a carga espera a mesma carga (um GET só ao core por período)
	ate     time.Time
	pedidos []pedidoEspelho
	sinc    *core.Sincronia
	feita   bool
}

type refEspelho struct {
	ID   json.Number `json:"id"`
	Nome string      `json:"nome,omitempty"`
}

type itemEspelho struct {
	Codigo     string      `json:"codigo"`
	Descricao  string      `json:"descricao"`
	Unidade    string      `json:"unidade,omitempty"`
	Quantidade float64     `json:"quantidade"`
	Valor      float64     `json:"valor"`
	Desconto   float64     `json:"desconto"` // percentual da linha, como o Bling devolve
	Produto    *refEspelho `json:"produto,omitempty"`
}

type pedidoEspelho struct {
	ID            json.Number   `json:"id"`
	Numero        json.Number   `json:"numero,omitempty"`
	NumeroLoja    string        `json:"numeroLoja,omitempty"`
	Data          string        `json:"data"`
	Total         float64       `json:"total"`
	TotalProdutos float64       `json:"totalProdutos"`
	Situacao      refSituacao   `json:"situacao"`
	Loja          *refEspelho   `json:"loja,omitempty"`
	Vendedor      *refEspelho   `json:"vendedor,omitempty"`
	Itens         []itemEspelho `json:"itens"`
}

type refSituacao struct {
	ID    int    `json:"id"`
	Valor string `json:"valor,omitempty"`
}

type sincroniaVendas struct {
	UltimoOK *time.Time `json:"ultimo_ok"`
	Atrasado bool       `json:"atrasado"`
	Defasado bool       `json:"defasado"` // atrasado, ou a última sincronização boa passou de 30 min
}

func (v *VendasEspelho) agora() time.Time {
	if v.Agora != nil {
		return v.Agora()
	}
	return time.Now()
}

func (v *VendasEspelho) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a := auth.AtorDoContexto(r.Context())
	if !(a.PodeModulo("sales") || a.PodeModulo("gestor")) {
		erro(w, http.StatusForbidden, "sem permissao")
		return
	}
	q := r.URL.Query()
	tela := q.Get("tela")
	if tela != "" && !reTela.MatchString(tela) {
		erro(w, http.StatusBadRequest, "tela invalida")
		return
	}
	if FonteDeVendas(v.Fonte, tela) != "espelho" {
		responder(w, http.StatusOK, map[string]string{"fonte": "bling"})
		return
	}
	de, ate, ids, err := periodoOuIDs(q)
	if err != nil {
		erro(w, http.StatusBadRequest, err.Error())
		return
	}
	loja, vendedor := q.Get("loja"), q.Get("vendedor")
	if (loja != "" && !reNumero.MatchString(loja)) || (vendedor != "" && !reNumero.MatchString(vendedor)) {
		erro(w, http.StatusBadRequest, "loja ou vendedor invalido")
		return
	}
	lista, err := v.canaisDe(r.Context(), a)
	if err != nil {
		if r.Context().Err() == nil {
			slog.Error("vendas/pedidos: carregar canais", "erro", err)
		}
		erro(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	if lista != nil && len(lista) == 0 { // limitado a nenhum canal: nega com lista vazia, como o recorte do bling-proxy
		responder(w, http.StatusOK, map[string]any{"fonte": "espelho", "data": []any{}})
		return
	}

	l, err := v.ler(r.Context(), de, ate, ids)
	if err != nil {
		v.falhou(w, r, err)
		return
	}
	permitidas := map[string]bool{}
	for _, c := range lista {
		permitidas[strconv.FormatInt(c, 10)] = true
	}
	saida := make([]pedidoEspelho, 0, len(l.pedidos))
	for _, p := range l.pedidos {
		lojaID, vendID := "", ""
		if p.Loja != nil {
			lojaID = p.Loja.ID.String()
		}
		if p.Vendedor != nil {
			vendID = p.Vendedor.ID.String()
		}
		if (lista != nil && !permitidas[lojaID]) || (loja != "" && lojaID != loja) || (vendedor != "" && vendID != vendedor) {
			continue
		}
		saida = append(saida, p)
	}
	s := sincroniaVendas{}
	if l.sinc != nil {
		s.UltimoOK, s.Atrasado = l.sinc.UltimoOK, l.sinc.Atrasado
		lei := core.Leitura{Sincronia: l.sinc}
		s.Defasado = lei.Defasado(v.agora(), vendasIdadeAviso)
	}
	responder(w, http.StatusOK, map[string]any{"fonte": "espelho", "data": saida, "sincronia": s})
}

func (v *VendasEspelho) canaisDe(ctx context.Context, a *auth.Ator) ([]int64, error) {
	if v.Canais != nil {
		return v.Canais(ctx, a)
	}
	return canais.Carregar(ctx, v.Pool, a)
}

func (v *VendasEspelho) falhou(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case r.Context().Err() != nil: // quem pediu desistiu
		erro(w, http.StatusBadGateway, "falha ao falar com o core")
	case errors.Is(err, core.ErrSemToken):
		erro(w, http.StatusServiceUnavailable, "core nao configurado")
	case errors.Is(err, core.ErrIndisponivel):
		slog.Warn("vendas/pedidos: core indisponivel", "erro", err)
		responder(w, http.StatusServiceUnavailable, map[string]string{"error": "core_indisponivel",
			"mensagem": "O espelho do core não respondeu agora. Nenhum número foi trocado: tente de novo em instantes."})
	default:
		slog.Error("vendas/pedidos: leitura do espelho", "erro", err)
		erro(w, http.StatusBadGateway, "o core recusou a leitura")
	}
}

// periodoOuIDs valida a query: `ids=` (até 100, sem data: o detalhe de pedidos soltos) ou `de`+`ate`.
func periodoOuIDs(q url.Values) (de, ate string, ids []string, err error) {
	if s := q.Get("ids"); s != "" {
		ids = strings.Split(s, ",")
		if len(ids) > vendasMaxIDs {
			return "", "", nil, errors.New("ids demais")
		}
		for _, id := range ids {
			if !reNumero.MatchString(id) {
				return "", "", nil, errors.New("id invalido")
			}
		}
		slices.Sort(ids)
		return "", "", slices.Compact(ids), nil
	}
	de, ate = q.Get("de"), q.Get("ate")
	d1, e1 := time.Parse("2006-01-02", de)
	d2, e2 := time.Parse("2006-01-02", ate)
	if !reDia.MatchString(de) || !reDia.MatchString(ate) || e1 != nil || e2 != nil {
		return "", "", nil, errors.New("de e ate (AAAA-MM-DD) obrigatorios")
	}
	if d2.Before(d1) || d2.Sub(d1) > vendasMaxDias*24*time.Hour {
		return "", "", nil, errors.New("periodo invalido")
	}
	return de, ate, nil, nil
}

// ler devolve a leitura do período (ou dos ids) com cache de 60 s. Falha não fica em cache.
func (v *VendasEspelho) ler(ctx context.Context, de, ate string, ids []string) (*leituraVendas, error) {
	chave := de + "|" + ate + "|" + strings.Join(ids, ",")
	v.mu.Lock()
	if v.cache == nil {
		v.cache = map[string]*leituraVendas{}
	}
	for k, e := range v.cache { // poda o vencido (poucas chaves: um período por tela)
		if e.feita && v.agora().After(e.ate) {
			delete(v.cache, k)
		}
	}
	e := v.cache[chave]
	if e == nil {
		e = &leituraVendas{}
		v.cache[chave] = e
	}
	v.mu.Unlock()

	e.mu.Lock()
	defer e.mu.Unlock()
	if e.feita && v.agora().Before(e.ate) {
		return e, nil
	}
	pedidos, sinc, err := v.lerDoCore(ctx, de, ate, ids)
	if err != nil {
		return nil, err
	}
	e.pedidos, e.sinc, e.feita, e.ate = pedidos, sinc, true, v.agora().Add(vendasTTL)
	return e, nil
}

func (v *VendasEspelho) lerDoCore(ctx context.Context, de, ate string, ids []string) ([]pedidoEspelho, *core.Sincronia, error) {
	q := url.Values{}
	if len(ids) > 0 {
		q["pedido_id_bling[]"] = ids
	} else {
		q.Set("data_de", de)
		q.Set("data_ate", ate)
		q.Set("status_id_bling", situacaoAtendido)
	}
	q.Set("campos", "pedido_id_bling,numero,numero_loja,data,total,total_produtos,status_id_bling,descricao,loja_id_bling,loja_descricao,vendedor_id_bling")
	lp, err := v.Core.EspelhoTodas(ctx, "pedidos", q)
	if err != nil {
		return nil, nil, err
	}
	pedidos := make([]pedidoEspelho, 0, len(lp.Linhas))
	porID := make(map[string]int, len(lp.Linhas))
	for _, x := range lp.Linhas {
		id := texto(x["pedido_id_bling"])
		if !reNumero.MatchString(id) {
			return nil, nil, fmt.Errorf("%w: pedido sem id", core.ErrIndisponivel)
		}
		p := pedidoEspelho{ID: json.Number(id), NumeroLoja: textoOuVazio(x["numero_loja"]), Data: diaDe(textoOuVazio(x["data"])),
			Total: valorNum(x["total"]), TotalProdutos: valorNum(x["total_produtos"]), Itens: []itemEspelho{}}
		if n := textoOuVazio(x["numero"]); reNumero.MatchString(n) {
			p.Numero = json.Number(n)
		}
		sit, _ := strconv.Atoi(textoOuVazio(x["status_id_bling"]))
		p.Situacao = refSituacao{ID: sit, Valor: textoOuVazio(x["descricao"])}
		if l := textoOuVazio(x["loja_id_bling"]); reNumero.MatchString(l) {
			p.Loja = &refEspelho{ID: json.Number(l), Nome: textoOuVazio(x["loja_descricao"])}
		}
		if vd := textoOuVazio(x["vendedor_id_bling"]); reNumero.MatchString(vd) {
			p.Vendedor = &refEspelho{ID: json.Number(vd)}
		}
		porID[id] = len(pedidos)
		pedidos = append(pedidos, p)
	}
	sinc := lp.Sincronia
	todos := make([]string, 0, len(pedidos))
	for _, p := range pedidos {
		todos = append(todos, p.ID.String())
	}
	slices.Sort(todos)
	for i := 0; i < len(todos); i += vendasLoteItens {
		qi := url.Values{}
		qi["pedido_id_bling[]"] = todos[i:min(i+vendasLoteItens, len(todos))]
		qi.Set("campos", "pedido_id_bling,codigo,descricao,unidade,quantidade,valor,desconto,produto_id")
		li, err := v.Core.EspelhoTodas(ctx, "pedido_itens", qi)
		if err != nil {
			return nil, nil, err // um lote que falha derruba a leitura: nunca pedido com item faltando
		}
		for _, x := range li.Linhas {
			i, ok := porID[texto(x["pedido_id_bling"])]
			if !ok {
				return nil, nil, fmt.Errorf("%w: item de pedido que nao foi pedido", core.ErrIndisponivel)
			}
			it := itemEspelho{Codigo: textoOuVazio(x["codigo"]), Descricao: textoOuVazio(x["descricao"]), Unidade: textoOuVazio(x["unidade"]),
				Quantidade: valorNum(x["quantidade"]), Valor: valorNum(x["valor"]), Desconto: valorNum(x["desconto"])}
			if pr := textoOuVazio(x["produto_id"]); reNumero.MatchString(pr) {
				it.Produto = &refEspelho{ID: json.Number(pr)}
			}
			pedidos[i].Itens = append(pedidos[i].Itens, it)
		}
		if li.Sincronia != nil && sinc != nil && li.Sincronia.UltimoOK != nil && (sinc.UltimoOK == nil || li.Sincronia.UltimoOK.Before(*sinc.UltimoOK)) {
			sinc = li.Sincronia // vale a leitura mais antiga: a tela mostra o pior caso
		}
	}
	slices.SortFunc(pedidos, func(a, b pedidoEspelho) int {
		if c := strings.Compare(a.Data, b.Data); c != 0 {
			return c
		}
		return strings.Compare(a.ID.String(), b.ID.String())
	})
	return pedidos, sinc, nil
}

// textoOuVazio é texto() sem o "null" do JS: nulo vira "".
func textoOuVazio(v any) string {
	if v == nil {
		return ""
	}
	return texto(v)
}

func diaDe(s string) string { return s[:min(len(s), 10)] }

func valorNum(v any) float64 {
	f, _ := strconv.ParseFloat(textoOuVazio(v), 64)
	return f
}
