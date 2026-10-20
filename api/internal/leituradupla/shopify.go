// Package leituradupla compara o dado que a Central guarda com o que o core (dono do dado) tem no
// espelho, ANTES de a Central trocar de fonte. Não troca nada: a Central segue servindo o dado local;
// aqui só se mede e se registra a divergência em log estruturado (plano 04-D do INTEGRACAO-CORE-2026-10).
//
// Ligada por `CORE_LEITURA_<TABELA>` (config.CoreLeituraShopifyPedidos); desligada, a tarefa nem é registrada.
package leituradupla

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// LinhaCentral é o que `shopify_pedidos` da Central tem e o espelho também (sem nome nem e-mail de cliente).
type LinhaCentral struct {
	ID       string // shopify_pedidos.id::text (o id da Shopify; texto, passa de 2^53)
	Numero   string
	Total    string
	Moeda    string
	Status   string
	CriadoEm time.Time
}

// Diferenca é um campo que diverge num pedido (só valores de negócio, nada pessoal).
type Diferenca struct {
	ID, Campo, Central, Core string
}

// Relatorio é o resultado de uma comparação. SoCoreAnterior = pedido do core mais antigo que o
// primeiro da Central (a tabela da Central começa depois): esperado, não é divergência.
type Relatorio struct {
	Central, Core                     int
	Iguais                            int
	SoCentral, SoCore, SoCoreAnterior []string
	Recentes                          int // pedidos mexidos no core depois do corte: a leitura dos dois lados não é do mesmo instante
	Diferencas                        []Diferenca
	Defasado                          bool
}

// Limpo: nada divergiu (ou o core está defasado e a comparação não vale como divergência).
func (r Relatorio) Limpo() bool {
	return r.Defasado || (len(r.SoCentral) == 0 && len(r.SoCore) == 0 && len(r.Diferencas) == 0)
}

func cents(s string) (int64, bool) {
	f, err := strconv.ParseFloat(strings.TrimSpace(s), 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, false
	}
	return int64(math.Round(f * 100)), true
}

func texto(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case fmt.Stringer:
		return x.String() // json.Number
	}
	return fmt.Sprint(v)
}

// Comparar casa por id da Shopify (texto: sem passar por float). Compara número do pedido (sem "#"),
// total (em centavos), moeda e situação financeira (caixa não importa).
//
// `corte` é a hora em que o lado local foi lido; pedido criado ou alterado no core depois de corte-5min
// fica fora (a Central é lida antes do core: o que mudou no meio não é divergência). Zero = sem corte.
func Comparar(central []LinhaCentral, doCore []map[string]any, defasado bool, corte time.Time) Relatorio {
	r := Relatorio{Central: len(central), Core: len(doCore), Defasado: defasado}
	coreID := make(map[string]map[string]any, len(doCore))
	for _, l := range doCore {
		coreID[texto(l["shopify_id"])] = l
	}
	var primeiro time.Time
	vistas := make(map[string]bool, len(central))
	for _, c := range central {
		vistas[c.ID] = true
		if primeiro.IsZero() || c.CriadoEm.Before(primeiro) {
			primeiro = c.CriadoEm
		}
		l, ok := coreID[c.ID]
		if !ok {
			r.SoCentral = append(r.SoCentral, c.ID)
			continue
		}
		if recente(l["atualizado_em"], corte) {
			r.Recentes++
			continue
		}
		n := len(r.Diferencas)
		if strings.TrimPrefix(c.Numero, "#") != strings.TrimPrefix(texto(l["nome"]), "#") {
			r.Diferencas = append(r.Diferencas, Diferenca{c.ID, "numero", c.Numero, texto(l["nome"])})
		}
		a, okA := cents(c.Total)
		b, okB := cents(texto(l["total"]))
		if !okA || !okB || a != b {
			r.Diferencas = append(r.Diferencas, Diferenca{c.ID, "total", c.Total, texto(l["total"])})
		}
		if c.Moeda != texto(l["moeda"]) {
			r.Diferencas = append(r.Diferencas, Diferenca{c.ID, "moeda", c.Moeda, texto(l["moeda"])})
		}
		if !strings.EqualFold(c.Status, texto(l["status_financeiro"])) {
			r.Diferencas = append(r.Diferencas, Diferenca{c.ID, "status_financeiro", c.Status, texto(l["status_financeiro"])})
		}
		if len(r.Diferencas) == n {
			r.Iguais++
		}
	}
	for _, l := range doCore {
		id := texto(l["shopify_id"])
		if vistas[id] {
			continue
		}
		if recente(l["criado_em"], corte) {
			r.Recentes++
			continue
		}
		if t, err := time.Parse("2006-01-02 15:04:05", texto(l["criado_em"])); err == nil && !primeiro.IsZero() && t.Before(primeiro) {
			r.SoCoreAnterior = append(r.SoCoreAnterior, id)
			continue
		}
		r.SoCore = append(r.SoCore, id)
	}
	return r
}

// recente: o instante (UTC, "2006-01-02 15:04:05", como o core grava) é posterior a corte-5min.
func recente(v any, corte time.Time) bool {
	if corte.IsZero() {
		return false
	}
	t, err := time.Parse("2006-01-02 15:04:05", texto(v))
	return err == nil && t.After(corte.Add(-5*time.Minute))
}

// Fonte lê o lado local. A produção usa o pgx (CentralPG); o teste, uma lista.
type Fonte interface {
	Linhas(ctx context.Context) ([]LinhaCentral, error)
}

// CentralPG lê `shopify_pedidos` do api-db.
type CentralPG struct{ Pool *pgxpool.Pool }

func (c CentralPG) Linhas(ctx context.Context) ([]LinhaCentral, error) {
	rows, err := c.Pool.Query(ctx, `select id::text, coalesce(numero,''), coalesce(total::text,''), coalesce(moeda,''),
	  coalesce(status_financeiro,''), coalesce(criado_em_shopify at time zone 'UTC', 'epoch') from shopify_pedidos`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []LinhaCentral
	for rows.Next() {
		var l LinhaCentral
		if err := rows.Scan(&l.ID, &l.Numero, &l.Total, &l.Moeda, &l.Status, &l.CriadoEm); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// ShopifyPedidos é a tarefa de leitura dupla de `shopify_pedidos`.
type ShopifyPedidos struct {
	Fonte    Fonte
	Core     *core.Cliente
	Agora    func() time.Time // nil = time.Now
	MaxIdade time.Duration    // limite de idade da sincronização do core; 0 = só o `atrasado` do core
}

func (s *ShopifyPedidos) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "leitura-dupla-shopify-pedidos", Agenda: "7,37 * * * *", Limite: 2 * time.Minute, Executar: s.Rodar}
}

const maxAmostra = 20

// Rodar lê os dois lados e registra. Core fora (ErrIndisponivel) devolve erro e NÃO registra
// divergência: falta de resposta não é "diferente", e a Central segue servindo o dado local.
func (s *ShopifyPedidos) Rodar(ctx context.Context) error {
	agora := time.Now
	if s.Agora != nil {
		agora = s.Agora
	}
	corte := agora()
	local, err := s.Fonte.Linhas(ctx)
	if err != nil {
		return fmt.Errorf("leitura dupla shopify_pedidos: lado local: %w", err)
	}
	l, err := s.Core.EspelhoTodas(ctx, "shopify_pedidos", nil)
	if err != nil {
		if errors.Is(err, core.ErrIndisponivel) {
			slog.Warn("leitura dupla", "tabela", "shopify_pedidos", "resultado", "core_indisponivel")
		}
		return fmt.Errorf("leitura dupla shopify_pedidos: core: %w", err)
	}
	r := Comparar(local, l.Linhas, l.Defasado(agora(), s.MaxIdade), corte)
	atributos := []any{"tabela", "shopify_pedidos", "central", r.Central, "core", r.Core, "iguais", r.Iguais,
		"so_central", len(r.SoCentral), "so_core", len(r.SoCore), "so_core_anterior", len(r.SoCoreAnterior),
		"diferencas", len(r.Diferencas), "recentes_ignorados", r.Recentes, "defasado", r.Defasado, "sincronia_informada", l.Sincronia != nil}
	if r.Limpo() {
		slog.Info("leitura dupla", append(atributos, "resultado", "limpa")...)
		return nil
	}
	slog.Warn("leitura dupla", append(atributos, "resultado", "divergente",
		"amostra_so_central", amostra(r.SoCentral), "amostra_so_core", amostra(r.SoCore),
		"amostra_diferencas", amostraDif(r.Diferencas))...)
	return nil
}

func amostra(ids []string) []string { return ids[:min(len(ids), maxAmostra)] }

func amostraDif(d []Diferenca) []string {
	out := make([]string, 0, min(len(d), maxAmostra))
	for _, x := range d[:min(len(d), maxAmostra)] {
		out = append(out, fmt.Sprintf("%s.%s central=%s core=%s", x.ID, x.Campo, x.Central, x.Core))
	}
	return out
}
