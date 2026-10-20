package core

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"time"
)

// Leitura do ESPELHO do core (`GET /api/interno/espelho/{tabela}`): o dado de negócio que o core é dono
// (Bling, Shopify) e que a Central lê em vez de replicar. Regras (02-evidencias/resiliencia.md §2.4):
// prazo de 5 s por tentativa e 15 s no total; 429/5xx/rede repetem com recuo (`decidir`); paginação
// CONFERIDA contra `/contagem`; falha NUNCA vira lista parcial nem "não existe".

const (
	caminhoEspelho = "/api/interno/espelho/"
	maxPaginasEsp  = 500
)

// ErrIndisponivel: o core não respondeu bem (rede, prazo, 429/5xx repetido) ou entregou uma leitura
// que não bate (paginação incompleta). Quem lê decide se serve cache degradado; nunca trata como
// "a linha não existe".
var ErrIndisponivel = errors.New("core: espelho indisponível")

// Sincronia é o bloco que o core devolve com a idade da sincronização da tabela (03-E). Ausente em
// core que ainda não o tem: sem bloco não se acusa defasagem (ver Defasado).
type Sincronia struct {
	UltimoOK       *time.Time `json:"ultimo_ok"`
	PeriodoS       int        `json:"periodo_s"`
	Atrasado       bool       `json:"atrasado"`
	UltimoEventoEm *time.Time `json:"ultimo_evento_em"`
	TempoReal      *bool      `json:"tempo_real"`
}

// Leitura é o resultado de EspelhoTodas. Linhas é uma lista de objetos com os números como
// json.Number (id da Shopify passa de 2^53: float64 o corromperia).
type Leitura struct {
	Linhas      []map[string]any
	EspelhadoEm *time.Time // "última mudança de linha" (não é frescor de sincronização)
	Sincronia   *Sincronia // nil = o core não informou
}

// Defasado diz se a leitura deve ser mostrada como defasada: o core disse `atrasado`, ou a última
// sincronização boa é mais velha que maxIdade (0 = sem limite). Sem bloco `sincronia` NÃO acusa.
func (l *Leitura) Defasado(agora time.Time, maxIdade time.Duration) bool {
	if l == nil || l.Sincronia == nil {
		return false
	}
	if l.Sincronia.Atrasado {
		return true
	}
	return maxIdade > 0 && l.Sincronia.UltimoOK != nil && agora.Sub(*l.Sincronia.UltimoOK) > maxIdade
}

func (c *Cliente) tokenEspelho() string {
	if c.TokenEspelho != "" {
		return c.TokenEspelho
	}
	return c.Token
}

type paginaEsp struct {
	Data          []map[string]any `json:"data"`
	ProximoCursor *string          `json:"proximo_cursor"`
	EspelhadoEm   *time.Time       `json:"espelhado_em"`
	Sincronia     *Sincronia       `json:"sincronia"`
	Linhas        *json.Number     `json:"linhas"` // só em /contagem
}

// obter faz GET com repetição (GET é idempotente). Erro 4xx (exceto 429) é erro de contrato, não de
// disponibilidade: sai sem repetir e sem ErrIndisponivel.
func (c *Cliente) obter(ctx context.Context, caminho string, q url.Values, destino any) error {
	if c.tokenEspelho() == "" {
		return ErrSemToken
	}
	const prazo, orcamento = 5 * time.Second, 15 * time.Second
	comeco := time.Now()
	for tentativa := 1; ; tentativa++ {
		ctxT, cancela := context.WithTimeout(ctx, prazo)
		r, err := c.get(ctxT, caminho, q)
		cancela()
		if errors.Is(err, ErrSemToken) || errors.Is(err, ErrRespostaGrande) || errors.Is(err, errURLInvalida) || (err != nil && ctx.Err() != nil) {
			return err
		}
		status := 0
		if err == nil {
			status = r.Status
		}
		d := decidir(tentativa, status, time.Since(comeco), retryAfter(r), prazo, orcamento)
		if status > 0 && status < 400 {
			dec := json.NewDecoder(bytes.NewReader(r.Corpo))
			dec.UseNumber()
			if err := dec.Decode(destino); err != nil {
				return fmt.Errorf("%w: resposta inesperada", ErrIndisponivel)
			}
			return nil
		}
		if status >= 400 && status < 500 && status != 429 {
			return fmt.Errorf("core: espelho respondeu %d", status)
		}
		if !d.repetir {
			return fmt.Errorf("%w: %s", ErrIndisponivel, d.motivo)
		}
		if err := c.dormir(ctx, d.esperar); err != nil {
			return err
		}
	}
}

func (c *Cliente) get(ctx context.Context, caminho string, q url.Values) (*Resposta, error) {
	alvo := c.URL + caminho
	if len(q) > 0 {
		alvo += "?" + q.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, alvo, nil)
	if err != nil {
		return nil, errURLInvalida
	}
	req.Header.Set("Authorization", "Bearer "+c.tokenEspelho())
	req.Header.Set("Accept", "application/json")
	if c.UserAgent != "" {
		req.Header.Set("User-Agent", c.UserAgent)
	}
	cli := c.HTTP
	if cli == nil {
		cli = semRedirecionamento()
	}
	r, err := cli.Do(req)
	if err != nil {
		return nil, semEndereco(err, caminho)
	}
	defer r.Body.Close()
	lido, err := io.ReadAll(io.LimitReader(r.Body, limiteResposta+1))
	if err != nil {
		return nil, semEndereco(err, caminho)
	}
	if int64(len(lido)) > limiteResposta {
		return nil, ErrRespostaGrande
	}
	return &Resposta{Status: r.StatusCode, Corpo: lido, RetryAfter: r.Header.Get("Retry-After")}, nil
}

// EspelhoTodas lê a tabela inteira (com os filtros em q), seguindo o cursor, e CONFERE: a soma das
// páginas tem de ser igual a `/contagem` com os mesmos filtros. Divergiu (linha entrou ou saiu no meio)
// ou o core falhou em qualquer página = ErrIndisponivel; nunca devolve lista parcial.
func (c *Cliente) EspelhoTodas(ctx context.Context, tabela string, q url.Values) (*Leitura, error) {
	var antes paginaEsp
	if err := c.obter(ctx, caminhoEspelho+tabela+"/contagem", q, &antes); err != nil {
		return nil, err
	}
	esperadas, err := antes.Linhas.Int64()
	if antes.Linhas == nil || err != nil {
		return nil, fmt.Errorf("%w: contagem sem número", ErrIndisponivel)
	}
	out := &Leitura{Linhas: []map[string]any{}}
	cursor := ""
	for p := 0; p < maxPaginasEsp; p++ {
		qp := url.Values{}
		for k, v := range q {
			qp[k] = v
		}
		qp.Set("limite", "1000")
		if cursor != "" {
			qp.Set("cursor", cursor)
		}
		var pg paginaEsp
		if err := c.obter(ctx, caminhoEspelho+tabela, qp, &pg); err != nil {
			return nil, err
		}
		if pg.Data == nil {
			return nil, fmt.Errorf("%w: resposta sem lista", ErrIndisponivel)
		}
		out.Linhas = append(out.Linhas, pg.Data...)
		if pg.EspelhadoEm != nil {
			out.EspelhadoEm = pg.EspelhadoEm
		}
		if pg.Sincronia != nil {
			out.Sincronia = pg.Sincronia
		}
		if pg.ProximoCursor == nil || *pg.ProximoCursor == "" {
			if int64(len(out.Linhas)) != esperadas {
				return nil, fmt.Errorf("%w: leitura incompleta (%d de %s)", ErrIndisponivel, len(out.Linhas), strconv.FormatInt(esperadas, 10))
			}
			return out, nil
		}
		cursor = *pg.ProximoCursor
	}
	return nil, fmt.Errorf("%w: páginas demais", ErrIndisponivel)
}
