package vendas

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	colunasMetaLoja      = `t.id, t.loja_id, t.year, t.month, t.meta_valor, t.daily_goals`
	colunasMetaVendedora = `t.id, t.vendor_id, t.year, t.month, t.meta_valor, t.daily_goals`
	// MetasPorVez: o formulário de metas do Admin mostra as lojas e as vendedoras de UM mês (dezenas).
	MetasPorVez = 500
)

var (
	filtrosDoMes = []dados.Filtro{
		{Param: "ano", SQL: "t.year = @ano::bigint", Tipo: "inteiro"},
		{Param: "mes", SQL: "t.month = @mes::bigint", Tipo: "inteiro"},
	}
	// GET /comercial/metas-lojas: gav:686, admin:4108, av:395.
	consultaMetasLojas = dados.Consulta{Tabela: "bling_metas", Alias: "t", SQL: `select ` + colunasMetaLoja + ` from bling_metas t`,
		Filtros: filtrosDoMes, OrdemPadrao: "t.loja_id", Desempate: "t.id"}
	// GET /comercial/metas-vendedoras: admin:4110.
	consultaMetasVendedoras = dados.Consulta{Tabela: "bling_vendedor_metas", Alias: "t", SQL: `select ` + colunasMetaVendedora + ` from bling_vendedor_metas t`,
		Filtros: filtrosDoMes, OrdemPadrao: "t.vendor_id", Desempate: "t.id"}

	tabelaMetasLojas      = dados.Tabela{Nome: "bling_metas", Resposta: colunasMetaLoja}
	tabelaMetasVendedoras = dados.Tabela{Nome: "bling_vendedor_metas", Resposta: colunasMetaVendedora}

	reInteiro    = regexp.MustCompile(`^(0|[1-9][0-9]{0,17})$`)
	reValor      = regexp.MustCompile(`^(0|[1-9][0-9]{0,8})(\.[0-9]{1,2})?$`) // R$ até 999.999.999,99, 2 casas
	reChaveDoDia = regexp.MustCompile(`^[0-9A-Za-z_-]{1,20}$`)
)

type metaDaLoja struct {
	LojaID     json.RawMessage `json:"loja_id"`
	MetaValor  json.RawMessage `json:"meta_valor"`
	DailyGoals json.RawMessage `json:"daily_goals"`
}

type metaDaVendedora struct {
	VendorID   json.RawMessage `json:"vendor_id"`
	MetaValor  json.RawMessage `json:"meta_valor"`
	DailyGoals json.RawMessage `json:"daily_goals"`
}

type corpoMetas struct {
	Ano   int `json:"ano"`
	Mes   int `json:"mes"`
	Lojas struct {
		Gravar []metaDaLoja      `json:"gravar"`
		Apagar []json.RawMessage `json:"apagar"`
	} `json:"lojas"`
	Vendedoras struct {
		Gravar []metaDaVendedora `json:"gravar"`
		Apagar []json.RawMessage `json:"apagar"`
	} `json:"vendedoras"`
}

// lado: as metas de UMA tabela num salvamento.
type lado struct {
	tabela dados.Tabela
	coluna string // loja_id | vendor_id
	nome   string // para as frases
	gravar []metaValidada
	apagar []int64
}

type metaValidada struct {
	chave          int64
	valor, diarias json.RawMessage
}

func lerChave(v json.RawMessage, minimo int64) (int64, bool) {
	if !reInteiro.Match(v) {
		return 0, false
	}
	n, err := strconv.ParseInt(string(v), 10, 64)
	return n, err == nil && n >= minimo
}

func validarMeta(nome string, chave, valor, diarias json.RawMessage, minimo int64) (metaValidada, error) {
	k, ok := lerChave(chave, minimo)
	if !ok {
		return metaValidada{}, fmt.Errorf("Confira a %s da meta.", nome)
	}
	if f, err := strconv.ParseFloat(string(valor), 64); !reValor.Match(valor) || err != nil || f <= 0 {
		return metaValidada{}, fmt.Errorf("Meta da %s %d: use um valor maior que zero, com até duas casas.", nome, k)
	}
	if len(diarias) == 0 || string(diarias) == "null" {
		return metaValidada{chave: k, valor: valor, diarias: json.RawMessage("null")}, nil
	}
	var dias map[string]json.RawMessage
	if json.Unmarshal(diarias, &dias) != nil || len(dias) > 31 {
		return metaValidada{}, fmt.Errorf("Meta da %s %d: a meta de cada dia tem de ser uma lista de até 31 dias.", nome, k)
	}
	for dia, v := range dias {
		if !reChaveDoDia.MatchString(dia) || !reValor.Match(v) {
			return metaValidada{}, fmt.Errorf("Meta da %s %d: confira a meta do dia %q.", nome, k, dia)
		}
	}
	return metaValidada{chave: k, valor: valor, diarias: diarias}, nil
}

// validarMetas confere o pedido inteiro ANTES de abrir a transação.
func validarMetas(in corpoMetas) ([]lado, error) {
	if in.Ano < 2020 || in.Ano > 2100 || in.Mes < 1 || in.Mes > 12 {
		return nil, errors.New("Mês ou ano inválido.")
	}
	lojas := lado{tabela: tabelaMetasLojas, coluna: "loja_id", nome: "loja"}
	for _, g := range in.Lojas.Gravar {
		m, err := validarMeta("loja", g.LojaID, g.MetaValor, g.DailyGoals, 0) // 0 = "Total geral"
		if err != nil {
			return nil, err
		}
		lojas.gravar = append(lojas.gravar, m)
	}
	vend := lado{tabela: tabelaMetasVendedoras, coluna: "vendor_id", nome: "vendedora"}
	for _, g := range in.Vendedoras.Gravar {
		m, err := validarMeta("vendedora", g.VendorID, g.MetaValor, g.DailyGoals, 1)
		if err != nil {
			return nil, err
		}
		vend.gravar = append(vend.gravar, m)
	}
	for _, par := range []struct {
		l      *lado
		apagar []json.RawMessage
		minimo int64
	}{{&lojas, in.Lojas.Apagar, 0}, {&vend, in.Vendedoras.Apagar, 1}} {
		for _, v := range par.apagar {
			k, ok := lerChave(v, par.minimo)
			if !ok {
				return nil, fmt.Errorf("Confira a %s da meta a apagar.", par.l.nome)
			}
			par.l.apagar = append(par.l.apagar, k)
		}
	}
	total := 0
	for _, l := range []lado{lojas, vend} {
		todas := make([]int64, 0, len(l.gravar)+len(l.apagar))
		for _, g := range l.gravar {
			todas = append(todas, g.chave)
		}
		vistas := map[int64]bool{}
		for _, k := range append(todas, l.apagar...) {
			if vistas[k] {
				return nil, fmt.Errorf("A %s %d aparece duas vezes.", l.nome, k)
			}
			vistas[k] = true
		}
		total += len(vistas)
	}
	switch {
	case total == 0:
		return nil, errors.New("Nada para gravar.")
	case total > MetasPorVez:
		return nil, fmt.Errorf("Mande no máximo %d metas por vez.", MetasPorVez)
	}
	return []lado{lojas, vend}, nil
}

// localizarMeta: o id da meta pela chave natural (loja ou vendedora, ano e mês), com a regra de Ler do
// catálogo (para metas, toda sessão; a defesa vale se a policy mudar). Roda sob a trava do mês. "" = não
// existe. O banco tem único (chave, year, month) nas duas tabelas (pg_dump do ensaio, 14/10), então
// há no máximo uma linha; a trava do mês evita que a segunda criação simultânea caia nesse único (23505).
func localizarMeta(ctx context.Context, tx pgx.Tx, e *autz.Escopo, l lado, chave int64, ano, mes int) (string, error) {
	f, err := autz.Producao.Filtro(e, l.tabela.Nome, autz.Ler, "t")
	if err != nil {
		return "", err
	}
	linhas, err := tx.Query(ctx, `select t.id::text from `+pgx.Identifier{l.tabela.Nome}.Sanitize()+` t where t.`+
		pgx.Identifier{l.coluna}.Sanitize()+` = @chave::bigint and t.year = @ano::int and t.month = @mes::int and (`+f.SQL+`) limit 1`,
		f.Juntar(pgx.NamedArgs{"chave": chave, "ano": ano, "mes": mes}))
	if err != nil {
		return "", err
	}
	ids, err := pgx.CollectRows(linhas, pgx.RowTo[string])
	if err != nil || len(ids) == 0 {
		return "", err
	}
	return ids[0], nil
}

// salvarMetas: POST /comercial/metas/salvar. O "Salvar" do Admin (tela-de-admin.vue:4246-4266) numa
// transação só, cada meta pelo MESMO Tabela.Criar/Editar/Apagar (PodeX + SQL com o mesmo mapa).
func salvarMetas(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in corpoMetas
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		lados, err := validarMetas(in)
		if err != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return
		}
		ctx := r.Context()
		var gravadas, apagadas int
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			gravadas, apagadas = 0, 0
			// a trava do mês: dois salvamentos do mesmo mês não tentam criar a mesma meta ao mesmo tempo (Ruling 5.5-6)
			if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext('comercial.metas'), @periodo::int)`,
				pgx.NamedArgs{"periodo": in.Ano*100 + in.Mes}); err != nil {
				return err
			}
			for _, l := range lados {
				for _, g := range l.gravar {
					id, err := localizarMeta(ctx, tx, e, l, g.chave, in.Ano, in.Mes)
					if err != nil {
						return err
					}
					if id == "" {
						_, err = l.tabela.Criar(ctx, tx, autz.Producao, e, map[string]any{
							l.coluna: g.chave, "year": in.Ano, "month": in.Mes, "meta_valor": g.valor, "daily_goals": g.diarias})
					} else {
						_, err = l.tabela.Editar(ctx, tx, autz.Producao, e, id, map[string]any{
							"meta_valor": g.valor, "daily_goals": g.diarias})
					}
					if err != nil {
						return err
					}
					gravadas++
				}
				for _, k := range l.apagar {
					id, err := localizarMeta(ctx, tx, e, l, k, in.Ano, in.Mes)
					if err != nil {
						return err
					}
					if id == "" {
						return autz.ErrNaoEncontrado
					}
					if err := l.tabela.Apagar(ctx, tx, autz.Producao, e, id); err != nil {
						return err
					}
					apagadas++
				}
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		slog.Info("metas salvas", "por", e.ID, "ano", in.Ano, "mes", in.Mes, "gravadas", gravadas, "apagadas", apagadas)
		dados.Responder(w, http.StatusOK, fmt.Appendf(nil, `{"gravadas":%d,"apagadas":%d}`, gravadas, apagadas))
	}
}

func montarMetas(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaMetasLojas.Validar(autz.Producao))
	deve(tabelaMetasVendedoras.Validar(autz.Producao))
	r.Get("/comercial/metas-lojas", consultaMetasLojas.Handler(p, autz.Producao))
	r.Get("/comercial/metas-vendedoras", consultaMetasVendedoras.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/comercial/metas/salvar", salvarMetas(p))
}
