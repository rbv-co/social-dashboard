package conteudo

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// corpoPeca: o que atualizarPeca/mudarStatus gravam (dados-conteudo.js:197-237; camposDoBanco de
// painel-peca.vue:535-562; tela-de-conteudo.vue:433; tela-de-peca.vue:249). Os campos de aprovação
// (aprovado_por/_em, motivo_reprovacao) e do Instagram (ig_*) ficam FORA: só as funções os gravam. status
// entra: a guarda conteudo_guarda_aprovacao decide quem aprova (com a identidade de banco.ComUsuario).
// avisado_em só nulo: quem o marca é o robô da hora H (Ruling 5.9-6).
type corpoPeca struct {
	AccountID   json.RawMessage `json:"account_id,omitempty"`
	Titulo      json.RawMessage `json:"titulo,omitempty"`
	Formato     json.RawMessage `json:"formato,omitempty"`
	Status      json.RawMessage `json:"status,omitempty"`
	Legenda     json.RawMessage `json:"legenda,omitempty"`
	Hashtags    json.RawMessage `json:"hashtags,omitempty"`
	Observacoes json.RawMessage `json:"observacoes,omitempty"`
	Responsavel json.RawMessage `json:"responsavel,omitempty"`
	PublicarEm  json.RawMessage `json:"publicar_em,omitempty"`
	PublicadoEm json.RawMessage `json:"publicado_em,omitempty"`
	AvisadoEm   json.RawMessage `json:"avisado_em,omitempty"`
}

func (c corpoPeca) Validar() error {
	var e []error
	ok := func(v json.RawMessage, valido bool, frase string) {
		if v != nil && !valido {
			e = append(e, errors.New(frase))
		}
	}
	ok(c.AccountID, casa(c.AccountID, reUUID), "account_id é o id da conta.")
	ok(c.Titulo, textoAte(c.Titulo, 300, false), "titulo tem de 1 a 300 caracteres.")
	ok(c.Formato, textoEm(c.Formato, formatosDaPeca...), "formato é feed, reels, stories ou carrossel.")
	ok(c.Status, textoEm(c.Status, estadosDaPeca...), "status é um dos estados da peça.")
	ok(c.Legenda, textoAte(c.Legenda, 20000, true), "legenda tem até 20000 caracteres.")
	ok(c.Hashtags, textoAte(c.Hashtags, 5000, true), "hashtags têm até 5000 caracteres.")
	ok(c.Observacoes, textoOuNulo(c.Observacoes, 20000), "observacoes têm até 20000 caracteres.")
	ok(c.Responsavel, uuidOuNulo(c.Responsavel), "responsavel é o id de uma pessoa ou null.")
	ok(c.PublicarEm, instanteOuNulo(c.PublicarEm), "publicar_em é um instante ISO 8601 ou null.")
	ok(c.PublicadoEm, instanteOuNulo(c.PublicadoEm), "publicado_em é um instante ISO 8601 ou null.")
	ok(c.AvisadoEm, nulo(c.AvisadoEm), "avisado_em só pode ser limpo (null): quem marca o aviso é o robô da hora H.")
	return errors.Join(e...)
}

// corpoPecaNova: o que criarPeca recebe (camposDoBanco, planoViraPecas :393, duplicarPeca :581). SEM status
// nem publicado_em: a peça nasce rascunho. O gatilho da aprovação é BEFORE UPDATE — um INSERT já 'agendada'
// pulava a aprovação em produção (Ruling 5.9-6, achado 2). criado_por vem da sessão (Tabela.Autor).
type corpoPecaNova struct {
	AccountID   json.RawMessage `json:"account_id,omitempty"`
	Titulo      json.RawMessage `json:"titulo,omitempty"`
	Formato     json.RawMessage `json:"formato,omitempty"`
	Legenda     json.RawMessage `json:"legenda,omitempty"`
	Hashtags    json.RawMessage `json:"hashtags,omitempty"`
	Observacoes json.RawMessage `json:"observacoes,omitempty"`
	Responsavel json.RawMessage `json:"responsavel,omitempty"`
	PublicarEm  json.RawMessage `json:"publicar_em,omitempty"`
	AvisadoEm   json.RawMessage `json:"avisado_em,omitempty"`
}

func (c corpoPecaNova) Validar() error {
	var falta error
	if c.AccountID == nil || c.Titulo == nil || c.Formato == nil {
		falta = errors.New("Informe account_id, titulo e formato.")
	}
	return errors.Join(falta, corpoPeca{AccountID: c.AccountID, Titulo: c.Titulo, Formato: c.Formato, Legenda: c.Legenda,
		Hashtags: c.Hashtags, Observacoes: c.Observacoes, Responsavel: c.Responsavel, PublicarEm: c.PublicarEm,
		AvisadoEm: c.AvisadoEm}.Validar())
}

// tabelaPecas: catálogo (conteudo_pecas_escrita + a restritiva pela regra de Ler no PodeEditar/PodeApagar) e,
// na criação, a peça nova tem de ser legível (a conta dela, Ruling 5.9-4).
var tabelaPecas = dados.Tabela{Nome: "conteudo_pecas", Resposta: colunasPeca, Autor: "criado_por",
	Conferir: soLegivelAoCriar("conteudo_pecas")}

// reCaminho: <conta>/<peça>/<nome> como subirArquivo monta (dados-conteudo.js:543: `${account}/${peca}/${ordem}-${slug}.${ext}`).
var reCaminho = regexp.MustCompile(`^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$`)

// corpoArquivo: o insert de subirArquivo (:551) e de duplicarPeca (:607). bucket só 'conteudo' (o único da
// Central; o Storage é do Plano 6); largura/altura/duracao_s ninguém grava.
type corpoArquivo struct {
	PecaID  json.RawMessage `json:"peca_id,omitempty"`
	Ordem   json.RawMessage `json:"ordem,omitempty"`
	Bucket  json.RawMessage `json:"bucket,omitempty"`
	Caminho json.RawMessage `json:"caminho,omitempty"`
	Tipo    json.RawMessage `json:"tipo,omitempty"`
	Mime    json.RawMessage `json:"mime,omitempty"`
	Bytes   json.RawMessage `json:"bytes,omitempty"`
}

func (c corpoArquivo) Validar() error {
	var e []error
	caminho, _ := comoTexto(c.Caminho)
	if !casa(c.PecaID, reUUID) {
		e = append(e, errors.New("peca_id é o id da peça."))
	}
	if !reCaminho.MatchString(caminho) || strings.Contains(caminho, "..") {
		e = append(e, errors.New("caminho é <conta>/<peça>/<nome do arquivo>."))
	}
	if !textoEm(c.Tipo, "imagem", "video") {
		e = append(e, errors.New("tipo é imagem ou video."))
	}
	if c.Ordem != nil && !inteiroEntre(c.Ordem, 1, 1000) {
		e = append(e, errors.New("ordem é um número de 1 a 1000."))
	}
	if c.Bucket != nil && !textoEm(c.Bucket, "conteudo") {
		e = append(e, errors.New("bucket é conteudo."))
	}
	if c.Mime != nil && !textoOuNulo(c.Mime, 100) {
		e = append(e, errors.New("mime tem até 100 caracteres."))
	}
	if c.Bytes != nil && !nulo(c.Bytes) && !inteiroEntre(c.Bytes, 0, 1<<40) {
		e = append(e, errors.New("bytes é um número inteiro."))
	}
	return errors.Join(e...)
}

// corpoOrdem: trocarOrdem (:639). -1 é o valor livre da troca em três passos (painel-peca.vue:737-739: o
// unique (peca_id, ordem) impede a troca direta).
type corpoOrdem struct {
	Ordem json.RawMessage `json:"ordem,omitempty"`
}

func (c corpoOrdem) Validar() error {
	if !inteiroEntre(c.Ordem, -1, 1000) {
		return errors.New("ordem é um número de -1 a 1000.")
	}
	return nil
}

// conferirArquivo: a peça do arquivo tem de ser uma que quem pede LÊ (a restritiva de conteudo_pecas; a tabela
// de arquivos não tem conta: Ruling 5.9-4). Na criação, a peça do corpo — invisível ou inexistente = 403 — e o
// caminho preso a <conta da peça>/<peça>/ (403 fora dele: o apagar do Storage levaria o objeto de outra peça,
// Ruling 5.9-8). Na edição e no apagar, a peça da linha — invisível = 404, como a própria linha.
func conferirArquivo(ctx context.Context, tx pgx.Tx, e *autz.Escopo, id string, campos map[string]any) error {
	if id == "" {
		peca, _ := comoTexto(bruto(campos, "peca_id"))
		conta, err := pecaVisivel(ctx, tx, e, peca)
		if err != nil {
			return negado(err)
		}
		if caminho, _ := comoTexto(bruto(campos, "caminho")); !strings.HasPrefix(caminho, conta+"/"+peca+"/") {
			return autz.ErrNegado
		}
		return nil
	}
	var peca string
	// a linha existe e quem pede a lê: o PodeEditar/PodeApagar acabou de conferi-la
	if err := tx.QueryRow(ctx, `select peca_id::text from conteudo_arquivos where id = $1::uuid`, id).Scan(&peca); err != nil {
		return err
	}
	_, err := pecaVisivel(ctx, tx, e, peca)
	return err
}

var tabelaArquivos = dados.Tabela{Nome: "conteudo_arquivos", Resposta: colunasArquivo, Conferir: conferirArquivo}

// acoesDaTela: as ações que registrarEvento grava (dados-conteudo.js:193, 235, 624; tela-de-conteudo.vue:435).
// 'aprovou', 'reprovou', 'casou', 'casou_na_mao', 'recusou_casamento', 'reavisar' e o 'criou' da ideia só as
// funções gravam: um evento forjado mentiria na trilha de quem aprovou (Ruling 5.9-7).
var acoesDaTela = []string{"criou", "mudou_status", "remarcou", "duplicou"}

// corpoEvento: registrarEvento (:180). quem vem da sessão (Tabela.Autor: a policy exige quem = auth.uid()).
type corpoEvento struct {
	PecaID  json.RawMessage `json:"peca_id,omitempty"`
	De      json.RawMessage `json:"de,omitempty"`
	Para    json.RawMessage `json:"para,omitempty"`
	Acao    json.RawMessage `json:"acao,omitempty"`
	Detalhe json.RawMessage `json:"detalhe,omitempty"`
}

func (c corpoEvento) Validar() error {
	var e []error
	estado := func(v json.RawMessage) bool { return v == nil || nulo(v) || textoEm(v, estadosDaPeca...) }
	if !casa(c.PecaID, reUUID) {
		e = append(e, errors.New("peca_id é o id da peça."))
	}
	if !textoEm(c.Acao, acoesDaTela...) {
		e = append(e, errors.New("acao é criou, mudou_status, remarcou ou duplicou."))
	}
	if !estado(c.De) || !estado(c.Para) {
		e = append(e, errors.New("de e para são estados da peça ou null."))
	}
	if c.Detalhe != nil && !textoOuNulo(c.Detalhe, 1000) {
		e = append(e, errors.New("detalhe tem até 1000 caracteres."))
	}
	return errors.Join(e...)
}

// tabelaEventos: catálogo (conteudo_eventos_insercao: conteudista e quem = auth.uid()) e a peça do evento
// legível por quem grava (a tabela de eventos não tem conta).
var tabelaEventos = dados.Tabela{Nome: "conteudo_eventos", Resposta: colunasEvento, Autor: "quem",
	Conferir: func(ctx context.Context, tx pgx.Tx, e *autz.Escopo, _ string, campos map[string]any) error {
		peca, _ := comoTexto(bruto(campos, "peca_id"))
		_, err := pecaVisivel(ctx, tx, e, peca)
		return negado(err)
	}}

func montarPecas(r chi.Router, p *pgxpool.Pool) {
	r.With(soSessaoPropria).Post("/conteudo/pecas", dados.RotaCriar[corpoPecaNova](p, autz.Producao, tabelaPecas))
	r.With(soSessaoPropria).Patch("/conteudo/pecas/{id}", dados.RotaEditar[corpoPeca](p, autz.Producao, tabelaPecas))
	r.With(soSessaoPropria).Delete("/conteudo/pecas/{id}", dados.RotaApagar(p, autz.Producao, tabelaPecas))
	r.With(soSessaoPropria).Post("/conteudo/arquivos", dados.RotaCriar[corpoArquivo](p, autz.Producao, tabelaArquivos))
	r.With(soSessaoPropria).Patch("/conteudo/arquivos/{id}", dados.RotaEditar[corpoOrdem](p, autz.Producao, tabelaArquivos))
	r.With(soSessaoPropria).Delete("/conteudo/arquivos/{id}", dados.RotaApagar(p, autz.Producao, tabelaArquivos))
	r.With(soSessaoPropria).Post("/conteudo/eventos", dados.RotaCriar[corpoEvento](p, autz.Producao, tabelaEventos))
}
