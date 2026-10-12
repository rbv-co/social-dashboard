package dados

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// Tabela é o caminho de ESCRITA declarado de uma tabela do catálogo. Nome, Resposta e Autor são
// texto FIXO da rota; o pedido só escolhe VALORES das colunas que a struct do corpo declara.
type Tabela struct {
	Nome     string // tabela do catálogo (ex.: "equipes")
	Resposta string // colunas devolvidas, sobre o alias t: a MESMA lista da leitura (ex.: "t.id, t.nome")
	Autor    string // coluna que recebe quem grava, na criação (ex.: "criado_por"); vazia = nenhuma
}

var reColuna = regexp.MustCompile(`^[a-z_][a-z0-9_]{0,62}$`)

// ErrSemCampos: o corpo não trouxe coluna nenhuma.
var ErrSemCampos = errors.New("dados: nada para gravar")

// Validar confere a declaração na montagem (erro = a API não sobe).
func (t Tabela) Validar(cat *autz.Catalogo) error {
	switch {
	case !cat.Tem(t.Nome):
		return fmt.Errorf("tabela %q fora do catálogo", t.Nome)
	case strings.TrimSpace(t.Resposta) == "":
		return fmt.Errorf("tabela %s: Resposta obrigatória", t.Nome)
	case t.Autor != "" && !reColuna.MatchString(t.Autor):
		return fmt.Errorf("tabela %s: Autor %q inválido", t.Nome, t.Autor)
	}
	return nil
}

// Campos devolve as colunas PRESENTES no corpo já lido. O corpo é uma struct de json.RawMessage
// com `json:"<coluna>,omitempty"`: chave ausente fica fora (não muda); `null` explícito entra (grava
// nulo). O tipo de cada valor é o Postgres que confere: jsonb_populate_record faz o cast pelo tipo
// da coluna (valor que não converte = 22P02 = 400).
func Campos(corpo any) (map[string]any, error) {
	j, err := json.Marshal(corpo)
	if err != nil {
		return nil, err
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(j, &m); err != nil {
		return nil, err
	}
	campos := make(map[string]any, len(m))
	for k, v := range m {
		if !reColuna.MatchString(k) {
			return nil, fmt.Errorf("dados: coluna %q inválida na struct do corpo", k)
		}
		campos[k] = v
	}
	return campos, nil
}

// colunas: as chaves em ordem (SQL determinístico), conferidas e citadas.
func colunas(campos map[string]any) ([]string, error) {
	if len(campos) == 0 {
		return nil, ErrSemCampos
	}
	ks := make([]string, 0, len(campos))
	for k := range campos {
		if !reColuna.MatchString(k) {
			return nil, fmt.Errorf("dados: coluna %q inválida", k)
		}
		ks = append(ks, k)
	}
	slices.Sort(ks)
	for i, k := range ks {
		ks[i] = pgx.Identifier{k}.Sanitize()
	}
	return ks, nil
}

// Criar confere a linha nova (WITH CHECK de insert), grava SÓ as colunas presentes e devolve a linha.
// Rode dentro de banco.ComUsuario.
func (t Tabela) Criar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, campos map[string]any) ([]byte, error) {
	if e == nil {
		return nil, autz.ErrNegado
	}
	if t.Autor != "" {
		campos = maps.Clone(campos) // não muda o mapa de quem chamou
		campos[t.Autor] = e.ID      // autoria vem da sessão, nunca do corpo
	}
	cols, err := colunas(campos)
	if err != nil {
		return nil, err
	}
	if err := cat.PodeCriar(ctx, tx, e, t.Nome, campos); err != nil {
		return nil, err
	}
	j, err := json.Marshal(campos)
	if err != nil {
		return nil, err
	}
	tab, lista := pgx.Identifier{t.Nome}.Sanitize(), strings.Join(cols, ", ")
	return t.devolver(ctx, tx, cat, e, `insert into `+tab+` (`+lista+`) select `+lista+
		` from jsonb_populate_record(null::`+tab+`, @dados_campos::jsonb) returning *`,
		pgx.NamedArgs{"dados_campos": string(j)})
}

// Editar confere (autz.PodeEditar trava a linha; Ler + USING na antiga; WITH CHECK na nova), muda SÓ
// as colunas presentes e devolve a linha. Rode dentro de banco.ComUsuario.
func (t Tabela) Editar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, id string, campos map[string]any) ([]byte, error) {
	cols, err := colunas(campos)
	if err != nil {
		return nil, err
	}
	if err := cat.PodeEditar(ctx, tx, e, t.Nome, id, campos); err != nil {
		return nil, err
	}
	j, err := json.Marshal(campos)
	if err != nil {
		return nil, err
	}
	sets := make([]string, len(cols))
	for i, c := range cols {
		sets[i] = c + " = dados_r." + c
	}
	tab := pgx.Identifier{t.Nome}.Sanitize()
	return t.devolver(ctx, tx, cat, e, `update `+tab+` as dados_alvo set `+strings.Join(sets, ", ")+
		` from jsonb_populate_record(null::`+tab+`, @dados_campos::jsonb) as dados_r`+
		` where dados_alvo.id = @dados_id returning dados_alvo.*`,
		pgx.NamedArgs{"dados_campos": string(j), "dados_id": id})
}

// Apagar confere (autz.PodeApagar trava a linha; Ler + USING de delete) e apaga.
func (t Tabela) Apagar(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, id string) error {
	if err := cat.PodeApagar(ctx, tx, e, t.Nome, id); err != nil {
		return err
	}
	_, err := tx.Exec(ctx, `delete from `+pgx.Identifier{t.Nome}.Sanitize()+` where id = @dados_id`,
		pgx.NamedArgs{"dados_id": id})
	return err
}

// devolver roda a escrita como CTE e responde a linha pela lista Resposta se quem pede a lê DEPOIS
// de gravada (regra de Ler do catálogo sobre a linha nova); senão {"id": …} (contrato II.2).
func (t Tabela) devolver(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, escrita string, args pgx.NamedArgs) ([]byte, error) {
	f, err := cat.Filtro(e, t.Nome, autz.Ler, "t")
	if err != nil {
		return nil, err
	}
	var corpo []byte
	// row_to_json e não json_build_object: este escreve {"id" : …} com espaços; o PostgREST, compacto
	err = tx.QueryRow(ctx, `with t as (`+escrita+`) select coalesce(
		(select row_to_json(x) from (select `+t.Resposta+` from t where `+f.SQL+`) x),
		(select row_to_json(y) from (select t.id from t) y))`, f.Juntar(args)).Scan(&corpo)
	if err != nil {
		return nil, err
	}
	if corpo == nil {
		return nil, autz.ErrNaoEncontrado
	}
	return corpo, nil
}

// lerCampos lê o corpo C, roda C.Validar() se existir e devolve as colunas presentes. Já respondeu
// quando devolve false.
func lerCampos[C any](w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	var c C
	if !LerCorpo(w, r, &c) {
		return nil, false
	}
	if v, ok := any(&c).(interface{ Validar() error }); ok {
		if err := v.Validar(); err != nil {
			Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return nil, false
		}
	}
	campos, err := Campos(&c)
	if err != nil { // tag de struct inválida: defeito da rota, não do pedido
		Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return nil, false
	}
	if len(campos) == 0 {
		Erro(w, http.StatusBadRequest, "corpo_invalido", "Nada para gravar.")
		return nil, false
	}
	return campos, true
}

// escopoOuErro: rota de escrita montada fora de autz.ComEscopo é defeito de montagem: 500, nada gravado.
func escopoOuErro(w http.ResponseWriter, r *http.Request) *autz.Escopo {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		Erro(w, http.StatusInternalServerError, "erro_interno", "")
	}
	return e
}

// RotaCriar: POST que lê o corpo C (struct de json.RawMessage), confere e grava em banco.ComUsuario.
func RotaCriar[C any](p *pgxpool.Pool, cat *autz.Catalogo, t Tabela) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOuErro(w, r)
		if e == nil {
			return
		}
		campos, ok := lerCampos[C](w, r)
		if !ok {
			return
		}
		var linha []byte
		err := banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) (err error) {
			linha, err = t.Criar(r.Context(), tx, cat, e, campos)
			return err
		})
		if err != nil {
			ErroDeEscrita(w, err)
			return
		}
		escrever(w, http.StatusCreated, linha)
	}
}

// RotaEditar: PATCH /…/{id} com o corpo C.
func RotaEditar[C any](p *pgxpool.Pool, cat *autz.Catalogo, t Tabela) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOuErro(w, r)
		if e == nil {
			return
		}
		campos, ok := lerCampos[C](w, r)
		if !ok {
			return
		}
		id := chi.URLParam(r, "id")
		var linha []byte
		err := banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) (err error) {
			linha, err = t.Editar(r.Context(), tx, cat, e, id, campos)
			return err
		})
		if err != nil {
			ErroDeEscrita(w, err)
			return
		}
		escrever(w, http.StatusOK, linha)
	}
}

// RotaApagar: DELETE /…/{id}.
func RotaApagar(p *pgxpool.Pool, cat *autz.Catalogo, t Tabela) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := escopoOuErro(w, r)
		if e == nil {
			return
		}
		id := chi.URLParam(r, "id")
		err := banco.ComUsuario(r.Context(), p, e.ID, func(tx pgx.Tx) error {
			return t.Apagar(r.Context(), tx, cat, e, id)
		})
		if err != nil {
			ErroDeEscrita(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// Responder escreve um corpo JSON já montado (pelo Postgres) com o status.
func Responder(w http.ResponseWriter, status int, corpo []byte) { escrever(w, status, corpo) }
