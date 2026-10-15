package acessos

import (
	"encoding/json"
	"errors"
	"net/url"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasPessoa = `t.id, t.nome, t.cargo, t.status, t.criado_em, t.atualizado_em, t.setor_id, t.email_corporativo, ` +
	`t.numero_pessoal, t.numero_corporativo, t.data_inicio_contrato, t.data_fim_contrato, t.motivo_saida, t.avatar_url, ` +
	`t.zoho_account_id, t.email_outlook, t.conta_apple, t.organizacao_id, t.profile_id, t.marca_id`

// GET /acessos/pessoas (acessos_pessoas_rw: is_acessos_admin()). A UNIÃO do que as telas leem:
// Colaboradores e Acessos (select *: 1341, 2244, 2564, 2565, 2578), Frota (tela-de-frota.vue:1070) e
// Admin (tela-de-admin.vue:3672, com os três embutidos). Cada embutido passa pela regra de Ler da SUA
// tabela e sai com lista fechada: quem não lê o Patrimônio recebe "patrimonio_empresas": null, como o
// embutido do PostgREST sob RLS (Ruling 5.4-9).
var consultaPessoas = dados.Consulta{Tabela: "acessos_pessoas", Alias: "t",
	SQL: `select ` + colunasPessoa + `,
	  (select json_build_object('nome', s.nome) from acessos_setores s
	    where s.id = t.setor_id and {ler:acessos_setores:s}) as acessos_setores,
	  (select json_build_object('nome', o.nome) from acessos_organizacoes o
	    where o.id = t.organizacao_id and {ler:acessos_organizacoes:o}) as acessos_organizacoes,
	  (select json_build_object('nome', m.nome) from patrimonio_empresas m
	    where m.id = t.marca_id and {ler:patrimonio_empresas:m}) as patrimonio_empresas
	from acessos_pessoas t`,
	Filtros:     []dados.Filtro{{Param: "status", SQL: "t.status = @status::text", Tipo: "texto"}},
	OrdemPadrao: "t.nome", Desempate: "t.id"}

// POST /acessos/pessoas: o que a tela grava ao criar (tela-de-acessos.vue:1619) e o "criar cadastro"
// do Admin, já ligado ao login (tela-de-admin.vue:3212). Nasce 'ativo' (sem status no corpo).
type corpoPessoaNova struct {
	Nome               json.RawMessage `json:"nome,omitempty"`
	Cargo              json.RawMessage `json:"cargo,omitempty"`
	SetorID            json.RawMessage `json:"setor_id,omitempty"`
	OrganizacaoID      json.RawMessage `json:"organizacao_id,omitempty"`
	EmailCorporativo   json.RawMessage `json:"email_corporativo,omitempty"`
	EmailOutlook       json.RawMessage `json:"email_outlook,omitempty"`
	ContaApple         json.RawMessage `json:"conta_apple,omitempty"`
	NumeroCorporativo  json.RawMessage `json:"numero_corporativo,omitempty"`
	NumeroPessoal      json.RawMessage `json:"numero_pessoal,omitempty"`
	DataInicioContrato json.RawMessage `json:"data_inicio_contrato,omitempty"`
	ProfileID          json.RawMessage `json:"profile_id,omitempty"`
	AtualizadoEm       json.RawMessage `json:"atualizado_em,omitempty"`
}

func (c corpoPessoaNova) Validar() error {
	if emBranco(c.Nome) {
		return errors.New("Nome é obrigatório")
	}
	return nil
}

// PATCH /acessos/pessoas/{id}: a união das edições (ficha 1618, campo único 1783, desligar 1858,
// reativar 1891, Zoho 1964, e-mail do OneDrive 1279/2323; Frota 948/1005; lotação do Admin 3166).
// avatar_url (Plano 12): a tela grava a URL da foto depois de enviar o arquivo ao Storage (null remove
// a foto); só http(s) absoluta. Fora: profile_id (só por POST …/ligar: decide pode_ver_bem, Ruling 5.4-7),
// id, criado_em — mandar = 400. O POST (cadastro novo) segue sem avatar_url: a foto vem depois.
type corpoPessoa struct {
	Nome               json.RawMessage `json:"nome,omitempty"`
	Cargo              json.RawMessage `json:"cargo,omitempty"`
	Status             json.RawMessage `json:"status,omitempty"`
	SetorID            json.RawMessage `json:"setor_id,omitempty"`
	OrganizacaoID      json.RawMessage `json:"organizacao_id,omitempty"`
	MarcaID            json.RawMessage `json:"marca_id,omitempty"`
	EmailCorporativo   json.RawMessage `json:"email_corporativo,omitempty"`
	EmailOutlook       json.RawMessage `json:"email_outlook,omitempty"`
	ContaApple         json.RawMessage `json:"conta_apple,omitempty"`
	NumeroCorporativo  json.RawMessage `json:"numero_corporativo,omitempty"`
	NumeroPessoal      json.RawMessage `json:"numero_pessoal,omitempty"`
	DataInicioContrato json.RawMessage `json:"data_inicio_contrato,omitempty"`
	DataFimContrato    json.RawMessage `json:"data_fim_contrato,omitempty"`
	MotivoSaida        json.RawMessage `json:"motivo_saida,omitempty"`
	ZohoAccountID      json.RawMessage `json:"zoho_account_id,omitempty"`
	AvatarURL          json.RawMessage `json:"avatar_url,omitempty"`
	AtualizadoEm       json.RawMessage `json:"atualizado_em,omitempty"`
}

func (c corpoPessoa) Validar() error {
	if c.Nome != nil && emBranco(c.Nome) {
		return errors.New("Nome é obrigatório")
	}
	return urlDeFoto(c.AvatarURL)
}

var errFoto = errors.New("A foto precisa ser uma URL http(s) de até 2048 caracteres.")

// urlDeFoto: ausente ou null passam (null remove a foto); o resto é texto de até 2048 bytes, URL http(s)
// absoluta com host. A tela põe a URL num <img src>: "javascript:", "data:" e caminho relativo ficam de fora.
func urlDeFoto(v json.RawMessage) error {
	if v == nil || string(v) == "null" {
		return nil
	}
	var s string
	if json.Unmarshal(v, &s) != nil || len(s) > 2048 {
		return errFoto
	}
	u, err := url.Parse(s)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return errFoto
	}
	return nil
}

var tabelaPessoas = dados.Tabela{Nome: "acessos_pessoas", Resposta: colunasPessoa}

func montarPessoas(r chi.Router, p *pgxpool.Pool) {
	deve(consultaPessoas.Validar(autz.Producao))
	deve(tabelaPessoas.Validar(autz.Producao))
	r.Get("/acessos/pessoas", consultaPessoas.Handler(p, autz.Producao))
	r.With(soSessaoPropria, soAdminSeLiga).Post("/acessos/pessoas", dados.RotaCriar[corpoPessoaNova](p, autz.Producao, tabelaPessoas))
	r.With(soSessaoPropria).Patch("/acessos/pessoas/{id}", dados.RotaEditar[corpoPessoa](p, autz.Producao, tabelaPessoas))
}
