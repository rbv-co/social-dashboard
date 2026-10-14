package frota

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasUso = `t.id, t.veiculo_id, t.pessoa_id, t.pessoa_nome, t.saida_em, t.km_saida, t.volta_em, t.km_volta, ` +
	`t.destino, t.finalidade, t.tanque_quartos, t.observacao, t.criado_em, t.tipo, t.aceite_em, t.aceite_por, ` +
	`t.aceite_nome, t.aceite_rabisco, t.aceite_checklist_id, t.aceite_checklist_hash`

// GET /frota/usos (frota_uso: is_frota_admin()). saida_de/saida_ate comparam com ::date, como o cast do
// PostgREST (Ruling 5.3-14).
var consultaUsos = dados.Consulta{Tabela: "frota_uso", Alias: "t", SQL: `select ` + colunasUso + ` from frota_uso t`,
	Filtros: []dados.Filtro{
		{Param: "aberta", SQL: "(t.volta_em is null) = @aberta::boolean", Tipo: "booleano"},
		{Param: "veiculo_id", SQL: "t.veiculo_id = @veiculo_id::uuid", Tipo: "uuid"},
		{Param: "saida_de", SQL: "t.saida_em >= @saida_de::date", Tipo: "data"},
		{Param: "saida_ate", SQL: "t.saida_em <= @saida_ate::date", Tipo: "data"},
	},
	Ordens: map[string]string{"saida_em": "t.saida_em"}, OrdemPadrao: "t.saida_em desc", Desempate: "t.id"}

// POST /frota/usos: a retirada (tipo fica 'viagem'). aceite_por e o carimbo do aceite_em são do gatilho
// frota_aceite_imutavel; o aceite_em do pedido só o liga. Carro já fora = uniq_frota_uso_um_aberto = 409.
type corpoRetirada struct {
	VeiculoID           json.RawMessage `json:"veiculo_id,omitempty"`
	SaidaEm             json.RawMessage `json:"saida_em,omitempty"`
	PessoaID            json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome          json.RawMessage `json:"pessoa_nome,omitempty"`
	KmSaida             json.RawMessage `json:"km_saida,omitempty"`
	TanqueQuartos       json.RawMessage `json:"tanque_quartos,omitempty"`
	Destino             json.RawMessage `json:"destino,omitempty"`
	Finalidade          json.RawMessage `json:"finalidade,omitempty"`
	Observacao          json.RawMessage `json:"observacao,omitempty"`
	AceiteEm            json.RawMessage `json:"aceite_em,omitempty"`
	AceiteNome          json.RawMessage `json:"aceite_nome,omitempty"`
	AceiteRabisco       json.RawMessage `json:"aceite_rabisco,omitempty"`
	AceiteChecklistID   json.RawMessage `json:"aceite_checklist_id,omitempty"`
	AceiteChecklistHash json.RawMessage `json:"aceite_checklist_hash,omitempty"`
}

// PATCH /frota/usos/{id}: a devolução.
type corpoDevolucao struct {
	VoltaEm       json.RawMessage `json:"volta_em,omitempty"`
	KmVolta       json.RawMessage `json:"km_volta,omitempty"`
	TanqueQuartos json.RawMessage `json:"tanque_quartos,omitempty"`
}

var tabelaUsos = dados.Tabela{Nome: "frota_uso", Resposta: colunasUso}

// pedidoTroca: POST /frota/usos/trocar — o "passar o carro" (tela-de-frota.vue:1513, 1524, 1551) e a troca
// do dono fixo (3451, 3466) numa transação só (Ruling 5.3-8).
type pedidoTroca struct {
	VeiculoID   string      `json:"veiculo_id"`
	Fechar      *fechamento `json:"fechar"`
	Abrir       *corpoPosse `json:"abrir"`
	ParaEstoque bool        `json:"para_estoque"`
}

type fechamento struct {
	ID      string          `json:"id"`
	VoltaEm json.RawMessage `json:"volta_em"`
}

// corpoPosse: a posse nova; veiculo_id vem do topo e tipo é sempre 'posse' (o pedido não escolhe).
type corpoPosse struct {
	PessoaID   json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome json.RawMessage `json:"pessoa_nome,omitempty"`
	SaidaEm    json.RawMessage `json:"saida_em,omitempty"`
}

var errPosseMudou = errors.New("frota: a posse a fechar não é mais a aberta deste carro")

func trocarPosse(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in pedidoTroca
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if in.VeiculoID == "" || (in.Fechar == nil && in.Abrir == nil && !in.ParaEstoque) || (in.ParaEstoque && in.Abrir != nil) ||
			(in.Fechar != nil && (in.Fechar.ID == "" || vazio(in.Fechar.VoltaEm))) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido",
				"Diga o carro e o que fazer: fechar a posse aberta, abrir a nova ou recolher para o estoque.")
			return
		}
		var abrir map[string]any
		if in.Abrir != nil {
			var err error
			if abrir, err = dados.Campos(in.Abrir); err != nil {
				dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
				return
			}
			abrir["veiculo_id"], abrir["tipo"] = in.VeiculoID, "posse"
		}
		var fechado, aberto *string
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			if in.Fechar != nil {
				volta := map[string]any{"volta_em": in.Fechar.VoltaEm}
				// PodeEditar ANTES da conferência: linha invisível = 404, sem dizer se existe ou se está aberta
				// (e trava a linha: a segunda troca da mesma posse espera e cai na conferência abaixo).
				if err := autz.Producao.PodeEditar(ctx, tx, e, "frota_uso", in.Fechar.ID, volta); err != nil {
					return err
				}
				var aberta bool
				if err := tx.QueryRow(ctx, `select veiculo_id = @veiculo::uuid and tipo = 'posse' and volta_em is null
					from frota_uso where id = @id::uuid`, pgx.NamedArgs{"veiculo": in.VeiculoID, "id": in.Fechar.ID}).Scan(&aberta); err != nil {
					return err
				}
				if !aberta {
					return errPosseMudou
				}
				if _, err := tabelaUsos.Editar(ctx, tx, autz.Producao, e, in.Fechar.ID, volta); err != nil {
					return err
				}
				fechado = &in.Fechar.ID
			}
			if abrir != nil {
				linha, err := tabelaUsos.Criar(ctx, tx, autz.Producao, e, abrir)
				if err != nil {
					return err // carro na rua = uniq_frota_uso_um_aberto = 409, e o fechamento acima é desfeito
				}
				id, err := idDaLinha(linha)
				if err != nil {
					return err
				}
				aberto = &id
			}
			if in.ParaEstoque {
				if _, err := tabelaVeiculos.Editar(ctx, tx, autz.Producao, e, in.VeiculoID, map[string]any{"situacao": "inativo"}); err != nil {
					return err
				}
			}
			return nil
		})
		if errors.Is(err, errPosseMudou) {
			dados.Erro(w, http.StatusConflict, "conflito", "Alguém mexeu neste carro agora há pouco. Recarregue para ver.")
			return
		}
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		corpo, _ := json.Marshal(map[string]*string{"fechado": fechado, "aberto": aberto})
		dados.Responder(w, http.StatusOK, corpo)
	}
}

func montarUsos(r chi.Router, p *pgxpool.Pool) {
	deve(consultaUsos.Validar(autz.Producao))
	deve(tabelaUsos.Validar(autz.Producao))
	r.Get("/frota/usos", consultaUsos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/frota/usos", dados.RotaCriar[corpoRetirada](p, autz.Producao, tabelaUsos))
	r.With(soSessaoPropria).Patch("/frota/usos/{id}", dados.RotaEditar[corpoDevolucao](p, autz.Producao, tabelaUsos))
	r.With(soSessaoPropria).Post("/frota/usos/trocar", trocarPosse(p))
}
