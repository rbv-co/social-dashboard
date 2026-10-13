package redes

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// colunasConta: lista FECHADA (Ruling 5.6-8). Em produção o SELECT de `authenticated` em accounts é por
// coluna e deixa de fora access_token (o token da Meta) e publicacao_automatica; a API conecta como dona
// da tabela e não tem esse freio — a lista é o freio. Nunca `t.*`.
const colunasConta = `t.id, t.name, t.username, t.instagram_id, t.ad_account_id, t.profile_picture_url, ` +
	`t.picture_url, t.accent_color, t.persona, t.conteudo_usa_portal`

// GET /redes/contas: Admin (1776, 1915, 3968, 4019), Redes (3277), Relatório (230), Conteúdo (65),
// Gestor (610), Análise de campanhas (213), Marca/Vendas (83).
var consultaContas = dados.Consulta{Tabela: "accounts", Alias: "t",
	SQL:    `select ` + colunasConta + ` from accounts t`,
	Ordens: map[string]string{"name": "t.name"}, OrdemPadrao: "t.name", Desempate: "t.id"}

// corpoConta: o que as três telas gravam — nome/@/cor (Admin 4004), persona (Gestor 1331), Portal
// (Conteúdo 499). Qualquer outra chave é recusada por dados.LerCorpo.
type corpoConta struct {
	Name              json.RawMessage `json:"name,omitempty"`
	Username          json.RawMessage `json:"username,omitempty"`
	AccentColor       json.RawMessage `json:"accent_color,omitempty"`
	Persona           json.RawMessage `json:"persona,omitempty"`
	ConteudoUsaPortal json.RawMessage `json:"conteudo_usa_portal,omitempty"`
}

var reCor = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// textoAte: texto de até max caracteres; nulo só se podeNulo; vazio só se !obrigatorio.
func textoAte(v json.RawMessage, max int, podeNulo, obrigatorio bool) bool {
	if string(v) == "null" {
		return podeNulo
	}
	var s string
	if json.Unmarshal(v, &s) != nil || utf8.RuneCountInString(s) > max {
		return false
	}
	return !obrigatorio || strings.TrimSpace(s) != ""
}

func (c corpoConta) Validar() error {
	var e []error
	if c.Name != nil && !textoAte(c.Name, 100, false, true) {
		e = append(e, errors.New("O nome da conta tem de 1 a 100 caracteres."))
	}
	if c.Username != nil && !textoAte(c.Username, 100, true, false) {
		e = append(e, errors.New("O @ tem até 100 caracteres."))
	}
	var cor string
	if c.AccentColor != nil && (json.Unmarshal(c.AccentColor, &cor) != nil || !reCor.MatchString(cor)) {
		e = append(e, errors.New("A cor é #RRGGBB."))
	}
	if c.Persona != nil && !textoAte(c.Persona, 20000, true, false) {
		e = append(e, errors.New("A persona tem até 20000 caracteres."))
	}
	var b bool
	// "null" em bool não dá erro no json (deixa o zero): a coluna é not null, então null é recusado à parte.
	if c.ConteudoUsaPortal != nil && (string(c.ConteudoUsaPortal) == "null" || json.Unmarshal(c.ConteudoUsaPortal, &b) != nil) {
		e = append(e, errors.New("O Portal de Notícias é ligado ou desligado."))
	}
	return errors.Join(e...)
}

var tabelaContas = dados.Tabela{Nome: "accounts", Resposta: colunasConta}

func montarContas(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaContas.Validar(autz.Producao))
	r.Get("/redes/contas", consultaContas.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Patch("/redes/contas/{id}", dados.RotaEditar[corpoConta](p, autz.Producao, tabelaContas))
}
