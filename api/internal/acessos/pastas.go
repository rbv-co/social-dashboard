package acessos

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasRecurso = `t.id, t.tipo, t.provedor, t.nome, t.external_id, t.drive_id, t.caminho, t.criado_em, ` +
	`t.arquivado_em, t.arquivado_motivo`

// GET /acessos/recursos: contagem por provedor (488: ?tipo=&arquivado=false&contar=1&limite=1), lista do
// console (522: ?tipo=&arquivado=false; iCloud com ?ordem=nome), provisionamento (1910) e Visão geral
// (2594). Gravar pasta é do proxy (Plano 6); a tela de pastas do iCloud não tem caminho (Ruling 5.4-10).
var consultaRecursos = dados.Consulta{Tabela: "acessos_recursos", Alias: "t",
	SQL: `select ` + colunasRecurso + ` from acessos_recursos t`,
	Filtros: []dados.Filtro{
		{Param: "tipo", SQL: "t.tipo = @tipo::text", Tipo: "texto"},
		{Param: "arquivado", SQL: "(t.arquivado_em is not null) = @arquivado::boolean", Tipo: "booleano"},
	},
	Ordens: map[string]string{"nome": "t.nome", "caminho": "t.caminho"}, OrdemPadrao: "t.caminho, t.nome", Desempate: "t.id"}

const colunasVinculo = `t.id, t.recurso_id, t.pessoa_id, t.papel, t.estado, t.observacao, t.criado_em, t.feito_em`

// GET /acessos/vinculos (669: ?recurso_id=; 1881: ?pessoa_id=; 2250: todos). O embutido acessos_recursos
// é o que a tela lê (nome, tipo, arquivado_em), sob a regra de Ler da tabela de pastas.
var consultaVinculos = dados.Consulta{Tabela: "acessos_vinculos", Alias: "t",
	SQL: `select ` + colunasVinculo + `,
	  (select json_build_object('nome', r.nome, 'tipo', r.tipo, 'arquivado_em', r.arquivado_em) from acessos_recursos r
	    where r.id = t.recurso_id and {ler:acessos_recursos:r}) as acessos_recursos
	from acessos_vinculos t`,
	Filtros: []dados.Filtro{
		{Param: "recurso_id", SQL: "t.recurso_id = @recurso_id::uuid", Tipo: "uuid"},
		{Param: "pessoa_id", SQL: "t.pessoa_id = @pessoa_id::uuid", Tipo: "uuid"},
	},
	OrdemPadrao: "t.criado_em", Desempate: "t.id"}

// POST /acessos/vinculos: o provisionamento do iCloud (1984). Sem PATCH/DELETE: os sítios que os usavam
// estão na tela sem caminho (Ruling 5.4-10). Sem único (recurso, pessoa), como em produção.
type corpoVinculo struct {
	RecursoID json.RawMessage `json:"recurso_id,omitempty"`
	PessoaID  json.RawMessage `json:"pessoa_id,omitempty"`
	Papel     json.RawMessage `json:"papel,omitempty"`
	Estado    json.RawMessage `json:"estado,omitempty"`
}

var tabelaVinculos = dados.Tabela{Nome: "acessos_vinculos", Resposta: colunasVinculo}

const colunasTermo = `t.id, t.pessoa_id, t.titulo, t.arquivo_path, t.enviado_em, t.observacao`

// GET /acessos/termos (1821: ?pessoa_id=&contar=1&limite=1; 2173: ?pessoa_id=). O arquivo vai e volta pelo
// Storage (bucket acessos-termos, Plano 6); estas rotas só mexem na LINHA (Plano 12).
var consultaTermos = dados.Consulta{Tabela: "acessos_termos", Alias: "t",
	SQL:         `select ` + colunasTermo + ` from acessos_termos t`,
	Filtros:     []dados.Filtro{{Param: "pessoa_id", SQL: "t.pessoa_id = @pessoa_id::uuid", Tipo: "uuid"}},
	OrdemPadrao: "t.enviado_em desc", Desempate: "t.id"}

// POST /acessos/termos (tela-de-acessos.vue:2061: {pessoa_id, titulo, arquivo_path} depois do upload) e
// DELETE /acessos/termos/{id} (:2079). Regra do catálogo (acessos_termos_rw: is_acessos_admin()). O arquivo
// do termo mora em <pessoa_id>/<nome> no bucket: caminho fora disso é recusado, para a linha não apontar
// para o arquivo de outra pessoa nem para fora do bucket.
type corpoTermo struct {
	PessoaID    json.RawMessage `json:"pessoa_id,omitempty"`
	Titulo      json.RawMessage `json:"titulo,omitempty"`
	ArquivoPath json.RawMessage `json:"arquivo_path,omitempty"`
	Observacao  json.RawMessage `json:"observacao,omitempty"`
}

var errTermo = errors.New("O arquivo do termo tem de estar na pasta da pessoa (pessoa_id/nome).")

func (c corpoTermo) Validar() error {
	var pessoa, caminho string
	if json.Unmarshal(c.PessoaID, &pessoa) != nil || json.Unmarshal(c.ArquivoPath, &caminho) != nil || pessoa == "" {
		return errTermo
	}
	resto, ok := strings.CutPrefix(strings.ToLower(caminho), strings.ToLower(pessoa)+"/")
	if !ok || strings.TrimSpace(resto) == "" || len(caminho) > 500 || strings.Contains(resto, "..") || strings.ContainsAny(caminho, "\\\x00") {
		return errTermo
	}
	return nil
}

var tabelaTermos = dados.Tabela{Nome: "acessos_termos", Resposta: colunasTermo}

func montarPastas(r chi.Router, p *pgxpool.Pool) {
	deve(consultaRecursos.Validar(autz.Producao))
	deve(consultaVinculos.Validar(autz.Producao))
	deve(consultaTermos.Validar(autz.Producao))
	deve(tabelaVinculos.Validar(autz.Producao))
	deve(tabelaTermos.Validar(autz.Producao))
	r.Get("/acessos/recursos", consultaRecursos.Handler(p, autz.Producao))
	r.Get("/acessos/vinculos", consultaVinculos.Handler(p, autz.Producao))
	r.Get("/acessos/termos", consultaTermos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/acessos/vinculos", dados.RotaCriar[corpoVinculo](p, autz.Producao, tabelaVinculos))
	r.With(soSessaoPropria).Post("/acessos/termos", dados.RotaCriar[corpoTermo](p, autz.Producao, tabelaTermos))
	r.With(soSessaoPropria).Delete("/acessos/termos/{id}", dados.RotaApagar(p, autz.Producao, tabelaTermos))
}
