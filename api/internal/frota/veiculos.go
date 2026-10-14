package frota

import (
	"encoding/json"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasVeiculo = `t.id, t.placa, t.nome, t.marca, t.ano, t.cor, t.combustivel, t.renavam, t.chassi, t.tipo_oleo, ` +
	`t.contrato, t.codigo_patrimonial, t.aluguel_centavos, t.fipe_centavos, t.categoria_comercial, t.blindado, t.situacao, ` +
	`t.pessoa_id, t.local_texto, t.observacao, t.criado_em, t.atualizado_em, t.seguro_seguradora, t.seguro_apolice, ` +
	`t.seguro_vence_em, t.seguro_valor_centavos, t.tag_pedagio, t.rastreador, t.bem_id, t.contato_nome, t.contato_telefone, ` +
	`t.contato_papel, t.oficina_nome, t.oficina_telefone, t.empresa_id, t.local_id, t.comodo_id`

// GET /frota/veiculos (frota_veiculos_ler: is_frota_admin()). Também é a leitura do Patrimônio
// (tela-de-patrimonio.vue:2084) e de Colaboradores e Acessos (tela-de-acessos.vue:1820, 2078, 2249).
var consultaVeiculos = dados.Consulta{Tabela: "frota_veiculos", Alias: "t", SQL: `select ` + colunasVeiculo + ` from frota_veiculos t`,
	Filtros: []dados.Filtro{{Param: "pessoa_id", SQL: "t.pessoa_id = @pessoa_id::uuid", Tipo: "uuid"}},
	Ordens:  map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.nome", Desempate: "t.id"}

// POST /frota/veiculos e PATCH /frota/veiculos/{id} (frota_veiculos_escrever). A união do que as três
// telas gravam (tela-de-frota.vue:2977-2995 + valores e local; tela-de-patrimonio.vue:1296, 1312, 1328;
// tela-de-frota.vue:1551). Fora: id, blindado, criado_em (400). Mudar situacao/pessoa_id/bem_id dispara
// os gatilhos verbatim (espelho no Patrimônio, posse órfã fechada).
type corpoVeiculo struct {
	Nome                json.RawMessage `json:"nome,omitempty"`
	Placa               json.RawMessage `json:"placa,omitempty"`
	Marca               json.RawMessage `json:"marca,omitempty"`
	Ano                 json.RawMessage `json:"ano,omitempty"`
	Cor                 json.RawMessage `json:"cor,omitempty"`
	Combustivel         json.RawMessage `json:"combustivel,omitempty"`
	Renavam             json.RawMessage `json:"renavam,omitempty"`
	Chassi              json.RawMessage `json:"chassi,omitempty"`
	TipoOleo            json.RawMessage `json:"tipo_oleo,omitempty"`
	Contrato            json.RawMessage `json:"contrato,omitempty"`
	CodigoPatrimonial   json.RawMessage `json:"codigo_patrimonial,omitempty"`
	AluguelCentavos     json.RawMessage `json:"aluguel_centavos,omitempty"`
	FipeCentavos        json.RawMessage `json:"fipe_centavos,omitempty"`
	CategoriaComercial  json.RawMessage `json:"categoria_comercial,omitempty"`
	Situacao            json.RawMessage `json:"situacao,omitempty"`
	PessoaID            json.RawMessage `json:"pessoa_id,omitempty"`
	LocalTexto          json.RawMessage `json:"local_texto,omitempty"`
	Observacao          json.RawMessage `json:"observacao,omitempty"`
	AtualizadoEm        json.RawMessage `json:"atualizado_em,omitempty"`
	SeguroSeguradora    json.RawMessage `json:"seguro_seguradora,omitempty"`
	SeguroApolice       json.RawMessage `json:"seguro_apolice,omitempty"`
	SeguroVenceEm       json.RawMessage `json:"seguro_vence_em,omitempty"`
	SeguroValorCentavos json.RawMessage `json:"seguro_valor_centavos,omitempty"`
	TagPedagio          json.RawMessage `json:"tag_pedagio,omitempty"`
	Rastreador          json.RawMessage `json:"rastreador,omitempty"`
	BemID               json.RawMessage `json:"bem_id,omitempty"`
	ContatoNome         json.RawMessage `json:"contato_nome,omitempty"`
	ContatoTelefone     json.RawMessage `json:"contato_telefone,omitempty"`
	ContatoPapel        json.RawMessage `json:"contato_papel,omitempty"`
	OficinaNome         json.RawMessage `json:"oficina_nome,omitempty"`
	OficinaTelefone     json.RawMessage `json:"oficina_telefone,omitempty"`
	EmpresaID           json.RawMessage `json:"empresa_id,omitempty"`
	LocalID             json.RawMessage `json:"local_id,omitempty"`
	ComodoID            json.RawMessage `json:"comodo_id,omitempty"`
}

var tabelaVeiculos = dados.Tabela{Nome: "frota_veiculos", Resposta: colunasVeiculo}

func montarVeiculos(r chi.Router, p *pgxpool.Pool) {
	deve(consultaVeiculos.Validar(autz.Producao))
	deve(tabelaVeiculos.Validar(autz.Producao))
	r.Get("/frota/veiculos", consultaVeiculos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/frota/veiculos", dados.RotaCriar[corpoVeiculo](p, autz.Producao, tabelaVeiculos))
	r.With(soSessaoPropria).Patch("/frota/veiculos/{id}", dados.RotaEditar[corpoVeiculo](p, autz.Producao, tabelaVeiculos))
}
