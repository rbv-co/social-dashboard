package frota

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasManutencao = `t.id, t.veiculo_id, t.km, t.feita_em, t.oficina, t.total_centavos, t.observacao, t.criada_em, t.criada_por`
const colunasRevisao = `t.id, t.veiculo_id, t.item, t.km, t.feita_em, t.oficina, t.custo_centavos, t.observacao, t.criada_em, t.criada_por, t.manutencao_id`
const colunasAbastecimento = `t.id, t.veiculo_id, t.pessoa_id, t.pessoa_nome, t.abastecido_em, t.km, t.litros, t.total_centavos, ` +
	`t.tanque_depois, t.combustivel, t.posto, t.observacao, t.criado_em, t.criado_por`

var consultaRevisoes = dados.Consulta{Tabela: "frota_revisoes", Alias: "t", SQL: `select ` + colunasRevisao + ` from frota_revisoes t`,
	Ordens: map[string]string{"criada_em": "t.criada_em"}, OrdemPadrao: "t.criada_em", Desempate: "t.id"}
var consultaAbastecimentos = dados.Consulta{Tabela: "frota_abastecimentos", Alias: "t",
	SQL:    `select ` + colunasAbastecimento + ` from frota_abastecimentos t`,
	Ordens: map[string]string{"abastecido_em": "t.abastecido_em"}, OrdemPadrao: "t.abastecido_em desc", Desempate: "t.id"}

var tabelaManutencoes = dados.Tabela{Nome: "frota_manutencoes", Resposta: colunasManutencao, Autor: "criada_por"}
var tabelaRevisoes = dados.Tabela{Nome: "frota_revisoes", Resposta: colunasRevisao, Autor: "criada_por"}
var tabelaAbastecimentos = dados.Tabela{Nome: "frota_abastecimentos", Resposta: colunasAbastecimento, Autor: "criado_por"}

type corpoManutencao struct {
	VeiculoID     json.RawMessage `json:"veiculo_id,omitempty"`
	Km            json.RawMessage `json:"km,omitempty"`
	FeitaEm       json.RawMessage `json:"feita_em,omitempty"`
	Oficina       json.RawMessage `json:"oficina,omitempty"`
	TotalCentavos json.RawMessage `json:"total_centavos,omitempty"`
	Observacao    json.RawMessage `json:"observacao,omitempty"`
}

type corpoTroca struct {
	Item          json.RawMessage `json:"item,omitempty"`
	CustoCentavos json.RawMessage `json:"custo_centavos,omitempty"`
}

type pedidoManutencao struct {
	Manutencao corpoManutencao `json:"manutencao"`
	Trocas     []corpoTroca    `json:"trocas"`
}

// doCabecalho: o que cada troca herda do serviço (mesmo carro, KM, data e oficina).
var doCabecalho = []string{"veiculo_id", "km", "feita_em", "oficina"}

// gravarManutencao: POST /frota/manutencoes — o serviço e as trocas numa transação (Ruling 5.3-7).
func gravarManutencao(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in pedidoManutencao
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if len(in.Trocas) == 0 || len(in.Trocas) > 30 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Marque ao menos uma troca (no máximo 30 por lançamento).")
			return
		}
		cab, err := dados.Campos(&in.Manutencao)
		trocas := make([]map[string]any, len(in.Trocas))
		for i := range in.Trocas {
			if err == nil {
				trocas[i], err = dados.Campos(&in.Trocas[i])
			}
		}
		if err != nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		ctx := r.Context()
		var linha []byte
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			var err error
			if linha, err = tabelaManutencoes.Criar(ctx, tx, autz.Producao, e, cab); err != nil {
				return err
			}
			id, err := idDaLinha(linha)
			if err != nil {
				return err
			}
			for _, tr := range trocas {
				tr["manutencao_id"] = id
				for _, c := range doCabecalho {
					if v, ok := cab[c]; ok {
						tr[c] = v
					}
				}
				if _, err := tabelaRevisoes.Criar(ctx, tx, autz.Producao, e, tr); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusCreated, linha)
	}
}

type corpoAbastecimento struct {
	VeiculoID     json.RawMessage `json:"veiculo_id,omitempty"`
	PessoaID      json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome    json.RawMessage `json:"pessoa_nome,omitempty"`
	AbastecidoEm  json.RawMessage `json:"abastecido_em,omitempty"`
	Km            json.RawMessage `json:"km,omitempty"`
	Litros        json.RawMessage `json:"litros,omitempty"`
	TotalCentavos json.RawMessage `json:"total_centavos,omitempty"`
	TanqueDepois  json.RawMessage `json:"tanque_depois,omitempty"`
	Combustivel   json.RawMessage `json:"combustivel,omitempty"`
	Posto         json.RawMessage `json:"posto,omitempty"`
	Observacao    json.RawMessage `json:"observacao,omitempty"`
}

func montarManutencoes(r chi.Router, p *pgxpool.Pool) {
	for _, c := range []dados.Consulta{consultaRevisoes, consultaAbastecimentos} {
		deve(c.Validar(autz.Producao))
	}
	for _, t := range []dados.Tabela{tabelaManutencoes, tabelaRevisoes, tabelaAbastecimentos} {
		deve(t.Validar(autz.Producao))
	}
	r.With(soSessaoPropria).Post("/frota/manutencoes", gravarManutencao(p))
	r.Get("/frota/revisoes", consultaRevisoes.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Delete("/frota/revisoes/{id}", dados.RotaApagar(p, autz.Producao, tabelaRevisoes))
	r.Get("/frota/abastecimentos", consultaAbastecimentos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/frota/abastecimentos", dados.RotaCriar[corpoAbastecimento](p, autz.Producao, tabelaAbastecimentos))
}
