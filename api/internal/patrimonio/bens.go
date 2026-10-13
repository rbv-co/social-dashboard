package patrimonio

import (
	"encoding/json"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasBem = `t.id, t.numero, t.nome, t.valor_centavos, t.data_compra, t.empresa_id, t.local_id, t.comodo_id, ` +
	`t.categoria_id, t.tipo_id, t.marca, t.numero_serie, t.pessoa_id, t.dono_texto, t.etiquetado, t.situacao, ` +
	`t.observacao, t.detalhes, t.criado_em, t.atualizado_em`

// GET /patrimonio/bens. Regras: patrimonio_bens_rw (is_patrimonio_admin) E a restritiva
// patrimonio_bens_so_do_meu_time (pode_ver_bem(local_id, pessoa_id)). Os três nomes que a ficha de
// Acessos embute (tela-de-acessos.vue:2076) vêm sempre ({nome} ou null), cada um com a regra de Ler
// da sua tabela (Ruling 5.2-7). Filtro pessoa_id (a ficha de Acessos); ordens numero (padrão) e nome.
var consultaBens = dados.Consulta{
	Tabela: "patrimonio_bens", Alias: "t",
	SQL: `select ` + colunasBem + `,
	        case when cat.id is null then null else json_build_object('nome', cat.nome) end as patrimonio_categorias,
	        case when loc.id is null then null else json_build_object('nome', loc.nome) end as patrimonio_locais,
	        case when amb.id is null then null else json_build_object('nome', amb.nome) end as patrimonio_comodos
	      from patrimonio_bens t
	      left join patrimonio_categorias cat on {ler:patrimonio_categorias:cat} and cat.id = t.categoria_id
	      left join patrimonio_locais loc on {ler:patrimonio_locais:loc} and loc.id = t.local_id
	      left join patrimonio_comodos amb on {ler:patrimonio_comodos:amb} and amb.id = t.comodo_id`,
	Filtros:     []dados.Filtro{{Param: "pessoa_id", SQL: "t.pessoa_id = @pessoa_id::uuid", Tipo: "uuid"}},
	Ordens:      map[string]string{"numero": "t.numero", "nome": "t.nome"},
	OrdemPadrao: "t.numero",
	Desempate:   "t.id",
}

// corpoBem: as colunas que salvarBem grava (tela-de-patrimonio.vue:1659-1678). Ausente = não muda;
// null = limpa. atualizado_em vem da tela, como hoje (Ruling 5.2-11).
type corpoBem struct {
	Nome          json.RawMessage `json:"nome,omitempty"`
	Numero        json.RawMessage `json:"numero,omitempty"`
	NumeroSerie   json.RawMessage `json:"numero_serie,omitempty"`
	ValorCentavos json.RawMessage `json:"valor_centavos,omitempty"`
	DataCompra    json.RawMessage `json:"data_compra,omitempty"`
	EmpresaID     json.RawMessage `json:"empresa_id,omitempty"`
	LocalID       json.RawMessage `json:"local_id,omitempty"`
	ComodoID      json.RawMessage `json:"comodo_id,omitempty"`
	CategoriaID   json.RawMessage `json:"categoria_id,omitempty"`
	TipoID        json.RawMessage `json:"tipo_id,omitempty"`
	Marca         json.RawMessage `json:"marca,omitempty"`
	PessoaID      json.RawMessage `json:"pessoa_id,omitempty"`
	DonoTexto     json.RawMessage `json:"dono_texto,omitempty"`
	Situacao      json.RawMessage `json:"situacao,omitempty"`
	Observacao    json.RawMessage `json:"observacao,omitempty"`
	Etiquetado    json.RawMessage `json:"etiquetado,omitempty"`
	AtualizadoEm  json.RawMessage `json:"atualizado_em,omitempty"`
}

// Validar: o nome, se veio, é texto (o POST sem nome cai no not null: 400). O resto é o tipo e o
// check da coluna.
func (c corpoBem) Validar() error { return texto("o nome", c.Nome, 200, false) }

// POST (CriarSoLegivel: com trava de time só cria o que vai ver — Ruling 5.2-2), PATCH /{id}
// (PodeEditar: Ler + rw + editar_so_do_meu_time na antiga e na nova) e DELETE /{id} (Ler + rw +
// apagar_so_do_meu_time). Os gatilhos do bem rodam em banco.ComUsuario; a resposta é a linha DEPOIS deles.
var tabelaBens = dados.Tabela{Nome: "patrimonio_bens", Resposta: colunasBem, CriarSoLegivel: true}

func montarBens(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaBens.Validar(autz.Producao))
	r.Get("/patrimonio/bens", consultaBens.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/patrimonio/bens", dados.RotaCriar[corpoBem](p, autz.Producao, tabelaBens))
	r.With(soSessaoPropria).Patch("/patrimonio/bens/{id}", dados.RotaEditar[corpoBem](p, autz.Producao, tabelaBens))
	r.With(soSessaoPropria).Delete("/patrimonio/bens/{id}", dados.RotaApagar(p, autz.Producao, tabelaBens))
}
