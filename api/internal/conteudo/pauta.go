package conteudo

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// corpoIdeia: limparParaGravar (roteiro.js:120-145) + account_id (painel-ideia.vue:298), a situação
// (mudarSituacaoDaIdeia, dados-conteudo.js:339) e a peça (planoViraPecas :409). origem, modelo, job_id,
// referencia e porque_formato ficam FORA: são do robô (que grava por pg na VPS).
type corpoIdeia struct {
	AccountID         json.RawMessage `json:"account_id,omitempty"`
	Titulo            json.RawMessage `json:"titulo,omitempty"`
	Formato           json.RawMessage `json:"formato,omitempty"`
	Pilar             json.RawMessage `json:"pilar,omitempty"`
	Gancho            json.RawMessage `json:"gancho,omitempty"`
	Producao          json.RawMessage `json:"producao,omitempty"`
	LegendaSugerida   json.RawMessage `json:"legenda_sugerida,omitempty"`
	Cta               json.RawMessage `json:"cta,omitempty"`
	HashtagsSugeridas json.RawMessage `json:"hashtags_sugeridas,omitempty"`
	PorQueAgora       json.RawMessage `json:"por_que_agora,omitempty"`
	Roteiro           json.RawMessage `json:"roteiro,omitempty"`
	Situacao          json.RawMessage `json:"situacao,omitempty"`
	PecaID            json.RawMessage `json:"peca_id,omitempty"`
}

// listaDeObjetos: [] ou uma lista de até max objetos (o roteiro: um take/card por item).
func listaDeObjetos(v json.RawMessage, max int) bool {
	var l []map[string]json.RawMessage
	return len(v) > 0 && v[0] == '[' && json.Unmarshal(v, &l) == nil && len(l) <= max
}

func (c corpoIdeia) Validar() error {
	var e []error
	ok := func(v json.RawMessage, valido bool, frase string) {
		if v != nil && !valido {
			e = append(e, errors.New(frase))
		}
	}
	ok(c.AccountID, uuidOuNulo(c.AccountID), "account_id é o id da conta ou null (de todas as marcas).")
	ok(c.Titulo, textoAte(c.Titulo, 300, false), "titulo tem de 1 a 300 caracteres.")
	ok(c.Formato, nulo(c.Formato) || textoEm(c.Formato, formatosDaPeca...), "formato é feed, reels, stories, carrossel ou null.")
	ok(c.Pilar, textoOuNulo(c.Pilar, 60), "pilar tem até 60 caracteres.")
	for _, v := range []json.RawMessage{c.Gancho, c.Producao, c.LegendaSugerida, c.Cta, c.HashtagsSugeridas, c.PorQueAgora} {
		ok(v, textoOuNulo(v, 5000), "os textos da ideia têm até 5000 caracteres.")
	}
	ok(c.Roteiro, listaDeObjetos(c.Roteiro, 60), "roteiro é uma lista de até 60 passos.")
	ok(c.Situacao, textoEm(c.Situacao, "nova", "favorita", "usada", "descartada"), "situacao é nova, favorita, usada ou descartada.")
	ok(c.PecaID, uuidOuNulo(c.PecaID), "peca_id é o id da peça ou null.")
	return errors.Join(e...)
}

// corpoIdeiaNova: criarIdeia (:300). Sem situacao nem peca_id (nasce 'nova'; ligar a uma peça é edição) e com
// título obrigatório. origem fica no default 'manual' (a tela mandava 'manual'; o corpo não escolhe 'ia').
type corpoIdeiaNova struct {
	AccountID         json.RawMessage `json:"account_id,omitempty"`
	Titulo            json.RawMessage `json:"titulo,omitempty"`
	Formato           json.RawMessage `json:"formato,omitempty"`
	Pilar             json.RawMessage `json:"pilar,omitempty"`
	Gancho            json.RawMessage `json:"gancho,omitempty"`
	Producao          json.RawMessage `json:"producao,omitempty"`
	LegendaSugerida   json.RawMessage `json:"legenda_sugerida,omitempty"`
	Cta               json.RawMessage `json:"cta,omitempty"`
	HashtagsSugeridas json.RawMessage `json:"hashtags_sugeridas,omitempty"`
	PorQueAgora       json.RawMessage `json:"por_que_agora,omitempty"`
	Roteiro           json.RawMessage `json:"roteiro,omitempty"`
}

func (c corpoIdeiaNova) Validar() error {
	var falta error
	if c.Titulo == nil {
		falta = errors.New("Informe o titulo.")
	}
	return errors.Join(falta, corpoIdeia{AccountID: c.AccountID, Titulo: c.Titulo, Formato: c.Formato, Pilar: c.Pilar,
		Gancho: c.Gancho, Producao: c.Producao, LegendaSugerida: c.LegendaSugerida, Cta: c.Cta,
		HashtagsSugeridas: c.HashtagsSugeridas, PorQueAgora: c.PorQueAgora, Roteiro: c.Roteiro}.Validar())
}

// conferirIdeia: criar só o legível (a conta; nula = de todas as marcas, legível a todo conteudista) e, na
// edição, ligar só a uma peça que quem pede lê (invisível ou inexistente = 403). Rulings 5.9-4.
func conferirIdeia(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error {
	if id == "" {
		return soLegivelAoCriar("conteudo_ideias")(ctx, tx, e, id, campos)
	}
	if v := bruto(campos, "peca_id"); v != nil && !nulo(v) {
		peca, _ := comoTexto(v)
		_, err := pecaVisivel(ctx, tx, e, peca)
		return negado(err)
	}
	return nil
}

var tabelaIdeias = dados.Tabela{Nome: "conteudo_ideias", Resposta: colunasIdeia, Autor: "criado_por", Conferir: conferirIdeia}

// corpoBloco: adicionarBloco (voz-da-marca.vue:197-202 → salvarBloco, dados-conteudo.js:447). O nome é NOT NULL
// no banco: o "Apelido (opcional)" vazio, que a tela manda como null, já falhava em produção (achado 7).
type corpoBloco struct {
	AccountID json.RawMessage `json:"account_id,omitempty"`
	Tipo      json.RawMessage `json:"tipo,omitempty"`
	Nome      json.RawMessage `json:"nome,omitempty"`
	Texto     json.RawMessage `json:"texto,omitempty"`
}

func (c corpoBloco) Validar() error {
	var e []error
	if c.AccountID != nil && !uuidOuNulo(c.AccountID) {
		e = append(e, errors.New("account_id é o id da conta ou null (de todas as marcas)."))
	}
	if !textoEm(c.Tipo, "legenda", "hashtags", "cta", "assinatura") {
		e = append(e, errors.New("tipo é legenda, hashtags, cta ou assinatura."))
	}
	if !textoAte(c.Nome, 100, false) {
		e = append(e, errors.New("nome (o apelido) tem de 1 a 100 caracteres."))
	}
	if !textoAte(c.Texto, 5000, false) {
		e = append(e, errors.New("texto tem de 1 a 5000 caracteres."))
	}
	return errors.Join(e...)
}

// corpoAtivo: apagarBloco (:455) e apagarConcorrente (:491) desativam (nunca apagam).
type corpoAtivo struct {
	Ativo json.RawMessage `json:"ativo,omitempty"`
}

func (c corpoAtivo) Validar() error {
	if !booleano(c.Ativo) {
		return errors.New("ativo é true ou false.")
	}
	return nil
}

var tabelaBlocos = dados.Tabela{Nome: "conteudo_blocos", Resposta: colunasBloco, Autor: "criado_por",
	Conferir: soLegivelAoCriar("conteudo_blocos")}

// corpoConcorrente: adicionarConcorrente (voz-da-marca.vue:213-219 → salvarConcorrente, :478). O @ já vem tirado.
type corpoConcorrente struct {
	AccountID  json.RawMessage `json:"account_id,omitempty"`
	Handle     json.RawMessage `json:"handle,omitempty"`
	Nome       json.RawMessage `json:"nome,omitempty"`
	Observacao json.RawMessage `json:"observacao,omitempty"`
}

func (c corpoConcorrente) Validar() error {
	var e []error
	if !casa(c.AccountID, reUUID) {
		e = append(e, errors.New("account_id é o id da conta."))
	}
	if !textoAte(c.Handle, 100, false) {
		e = append(e, errors.New("handle tem de 1 a 100 caracteres."))
	}
	if c.Nome != nil && !textoOuNulo(c.Nome, 200) {
		e = append(e, errors.New("nome tem até 200 caracteres."))
	}
	if c.Observacao != nil && !textoOuNulo(c.Observacao, 2000) {
		e = append(e, errors.New("observacao tem até 2000 caracteres."))
	}
	return errors.Join(e...)
}

// tabelaConcorrentes: SÓ o catálogo — conteudo_concorrentes não tem a restritiva em produção: todo conteudista
// grava o concorrente de qualquer marca, como hoje (Ruling 5.9-5, achado 5). Sem coluna de autoria.
var tabelaConcorrentes = dados.Tabela{Nome: "conteudo_concorrentes", Resposta: colunasConcorrente}

func montarPauta(r chi.Router, p *pgxpool.Pool) {
	r.With(soSessaoPropria).Post("/conteudo/ideias", dados.RotaCriar[corpoIdeiaNova](p, autz.Producao, tabelaIdeias))
	r.With(soSessaoPropria).Patch("/conteudo/ideias/{id}", dados.RotaEditar[corpoIdeia](p, autz.Producao, tabelaIdeias))
	r.With(soSessaoPropria).Post("/conteudo/blocos", dados.RotaCriar[corpoBloco](p, autz.Producao, tabelaBlocos))
	r.With(soSessaoPropria).Patch("/conteudo/blocos/{id}", dados.RotaEditar[corpoAtivo](p, autz.Producao, tabelaBlocos))
	r.With(soSessaoPropria).Post("/conteudo/concorrentes", dados.RotaCriar[corpoConcorrente](p, autz.Producao, tabelaConcorrentes))
	r.With(soSessaoPropria).Patch("/conteudo/concorrentes/{id}", dados.RotaEditar[corpoAtivo](p, autz.Producao, tabelaConcorrentes))
}
