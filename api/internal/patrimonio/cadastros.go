package patrimonio

import (
	"encoding/json"
	"errors"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Cadastros do Patrimônio: empresas (marcas), locais, cômodos (ambientes), categorias e tipos. Regra
// só de ator, nenhuma linha restringe: marca, local e ambiente leem e criam com is_patrimonio_admin OU
// is_frota_admin (`*_leitura_frota`, `*_criar_frota`) e só is_patrimonio_admin edita e apaga (`*_rw`);
// categoria e tipo são só de is_patrimonio_admin (a Frota acha "Veículos" por nome_como, Ruling 5.2-14,
// e não lê a lista). Tipos não têm PATCH nem DELETE (Ruling 5.2-8).
//
// Apagar em uso é permitido, como em produção: a marca leva os locais e os ambientes dela e o local leva
// os ambientes (FK on delete cascade); os bens e as equipes ficam sem o campo (on delete set null),
// inclusive os que a pessoa não vê (ações de FK não passam pela RLS). Nome repetido no mesmo pai = 409.
const (
	colunasMarca     = `t.id, t.nome, t.ordem, t.criado_em`
	colunasLocal     = `t.id, t.nome, t.ordem, t.criado_em, t.empresa_id`
	colunasAmbiente  = `t.id, t.nome, t.ordem, t.criado_em, t.local_id`
	colunasCategoria = `t.id, t.nome, t.vida_util_anos, t.ordem, t.criado_em`
	colunasTipo      = `t.id, t.categoria_id, t.nome, t.ordem, t.criado_em`
)

// Leituras: as duas telas pedem .order('ordem').order('nome') (padrão); o admin pede só nome.
// categorias tem nome_como: a Frota acha "Veículos" como a função sincronizar acha (ilike '%ve%cul%', Ruling 5.2-14).
var (
	consultaMarcas     = dados.Consulta{Tabela: "patrimonio_empresas", Alias: "t", SQL: `select ` + colunasMarca + ` from patrimonio_empresas t`, Ordens: map[string]string{"nome": "t.nome", "ordem": "t.ordem"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
	consultaLocais     = dados.Consulta{Tabela: "patrimonio_locais", Alias: "t", SQL: `select ` + colunasLocal + ` from patrimonio_locais t`, Ordens: map[string]string{"nome": "t.nome", "ordem": "t.ordem"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
	consultaAmbientes  = dados.Consulta{Tabela: "patrimonio_comodos", Alias: "t", SQL: `select ` + colunasAmbiente + ` from patrimonio_comodos t`, Ordens: map[string]string{"nome": "t.nome", "ordem": "t.ordem"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
	consultaCategorias = dados.Consulta{Tabela: "patrimonio_categorias", Alias: "t", SQL: `select ` + colunasCategoria + ` from patrimonio_categorias t`,
		Filtros: []dados.Filtro{{Param: "nome_como", SQL: "t.nome ilike @nome_como::text", Tipo: "texto"}},
		Ordens:  map[string]string{"nome": "t.nome", "ordem": "t.ordem"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
	consultaTipos = dados.Consulta{Tabela: "patrimonio_tipos", Alias: "t", SQL: `select ` + colunasTipo + ` from patrimonio_tipos t`, Ordens: map[string]string{"nome": "t.nome", "ordem": "t.ordem"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
)

// Corpos do POST (o "+" das duas telas e as Listas: tela-de-patrimonio.vue:1436, 1533, 1974, 1988;
// tela-de-frota.vue:3188, 3271). Validar: nome obrigatório (1..200) e o pai obrigatório, com a frase da tela.
type corpoMarca struct {
	Nome  json.RawMessage `json:"nome,omitempty"`
	Ordem json.RawMessage `json:"ordem,omitempty"`
}
type corpoLocal struct {
	Nome      json.RawMessage `json:"nome,omitempty"`
	Ordem     json.RawMessage `json:"ordem,omitempty"`
	EmpresaID json.RawMessage `json:"empresa_id,omitempty"` // "Escolha a marca antes de criar um local novo."
}
type corpoAmbiente struct {
	Nome    json.RawMessage `json:"nome,omitempty"`
	Ordem   json.RawMessage `json:"ordem,omitempty"`
	LocalID json.RawMessage `json:"local_id,omitempty"` // "Escolha o local antes de criar um ambiente novo."
}
type corpoCategoria struct {
	Nome  json.RawMessage `json:"nome,omitempty"`
	Ordem json.RawMessage `json:"ordem,omitempty"`
}
type corpoTipo struct {
	Nome        json.RawMessage `json:"nome,omitempty"`
	Ordem       json.RawMessage `json:"ordem,omitempty"`
	CategoriaID json.RawMessage `json:"categoria_id,omitempty"` // "Escolha a categoria antes de criar um tipo novo."
}

// corpoNome: o PATCH das Listas só renomeia (tela-de-patrimonio.vue:2003).
type corpoNome struct {
	Nome json.RawMessage `json:"nome,omitempty"`
}

// pai: o pai que falta (ausente ou null) responde com a frase da tela, não com o erro do banco.
func pai(v json.RawMessage, frase string) error {
	if v == nil || string(v) == "null" {
		return errors.New(frase)
	}
	return nil
}

func (c corpoMarca) Validar() error     { return texto("o nome", c.Nome, 200, true) }
func (c corpoCategoria) Validar() error { return texto("o nome", c.Nome, 200, true) }
func (c corpoNome) Validar() error      { return texto("o nome", c.Nome, 200, false) }
func (c corpoLocal) Validar() error {
	return errors.Join(texto("o nome", c.Nome, 200, true), pai(c.EmpresaID, "Escolha a marca antes de criar um local novo."))
}
func (c corpoAmbiente) Validar() error {
	return errors.Join(texto("o nome", c.Nome, 200, true), pai(c.LocalID, "Escolha o local antes de criar um ambiente novo."))
}
func (c corpoTipo) Validar() error {
	return errors.Join(texto("o nome", c.Nome, 200, true), pai(c.CategoriaID, "Escolha a categoria antes de criar um tipo novo."))
}

var (
	tabelaMarcas     = dados.Tabela{Nome: "patrimonio_empresas", Resposta: colunasMarca}
	tabelaLocais     = dados.Tabela{Nome: "patrimonio_locais", Resposta: colunasLocal}
	tabelaAmbientes  = dados.Tabela{Nome: "patrimonio_comodos", Resposta: colunasAmbiente}
	tabelaCategorias = dados.Tabela{Nome: "patrimonio_categorias", Resposta: colunasCategoria}
	tabelaTipos      = dados.Tabela{Nome: "patrimonio_tipos", Resposta: colunasTipo}
)

// montarCadastros: GET/POST/PATCH {id}/DELETE {id} de empresas, locais, comodos e categorias; GET/POST de tipos.
// Cada Tabela por deve(…Validar(autz.Producao)); cada escrita com r.With(soSessaoPropria).
func montarCadastros(r chi.Router, p *pgxpool.Pool) {
	for _, t := range []dados.Tabela{tabelaMarcas, tabelaLocais, tabelaAmbientes, tabelaCategorias, tabelaTipos} {
		deve(t.Validar(autz.Producao))
	}
	r.Get("/patrimonio/empresas", consultaMarcas.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/patrimonio/empresas", dados.RotaCriar[corpoMarca](p, autz.Producao, tabelaMarcas))
	r.With(soSessaoPropria).Patch("/patrimonio/empresas/{id}", dados.RotaEditar[corpoNome](p, autz.Producao, tabelaMarcas))
	r.With(soSessaoPropria).Delete("/patrimonio/empresas/{id}", dados.RotaApagar(p, autz.Producao, tabelaMarcas))

	r.Get("/patrimonio/locais", consultaLocais.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/patrimonio/locais", dados.RotaCriar[corpoLocal](p, autz.Producao, tabelaLocais))
	r.With(soSessaoPropria).Patch("/patrimonio/locais/{id}", dados.RotaEditar[corpoNome](p, autz.Producao, tabelaLocais))
	r.With(soSessaoPropria).Delete("/patrimonio/locais/{id}", dados.RotaApagar(p, autz.Producao, tabelaLocais))

	r.Get("/patrimonio/comodos", consultaAmbientes.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/patrimonio/comodos", dados.RotaCriar[corpoAmbiente](p, autz.Producao, tabelaAmbientes))
	r.With(soSessaoPropria).Patch("/patrimonio/comodos/{id}", dados.RotaEditar[corpoNome](p, autz.Producao, tabelaAmbientes))
	r.With(soSessaoPropria).Delete("/patrimonio/comodos/{id}", dados.RotaApagar(p, autz.Producao, tabelaAmbientes))

	r.Get("/patrimonio/categorias", consultaCategorias.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/patrimonio/categorias", dados.RotaCriar[corpoCategoria](p, autz.Producao, tabelaCategorias))
	r.With(soSessaoPropria).Patch("/patrimonio/categorias/{id}", dados.RotaEditar[corpoNome](p, autz.Producao, tabelaCategorias))
	r.With(soSessaoPropria).Delete("/patrimonio/categorias/{id}", dados.RotaApagar(p, autz.Producao, tabelaCategorias))

	r.Get("/patrimonio/tipos", consultaTipos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/patrimonio/tipos", dados.RotaCriar[corpoTipo](p, autz.Producao, tabelaTipos))
}
