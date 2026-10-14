package publico

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// Base das duas edges portadas (vessel-conta e vessel-registrar-garantia): leem o corpo como a edge lia, chamam as
// funções do banco com a chave de serviço (aqui: papel "dono", ver banco.ComAnonimo) e respondem no mesmo formato.
// NENHUM log leva argumento, CPF, e-mail, senha, token nem código: só o nome da função e a mensagem do Postgres.

// Mailer manda um e-mail (internal/email.ZeptoMail). Erro = não saiu.
type Mailer interface {
	Mandar(ctx context.Context, para, assunto, html, texto string) error
}

// corpoDaEdge é o objeto JSON de entrada; os campos ficam crus para a conversão ser a do banco (cast explícito).
type corpoDaEdge map[string]json.RawMessage

// leCorpoDaEdge: corpo ausente, que não é objeto ou acima do teto = nil (a edge: dados_invalidos).
func leCorpoDaEdge(w http.ResponseWriter, r *http.Request) corpoDaEdge {
	b, err := io.ReadAll(http.MaxBytesReader(w, r.Body, TetoCorpo))
	if err != nil {
		return nil
	}
	var c corpoDaEdge
	if json.Unmarshal(b, &c) != nil {
		return nil
	}
	return c
}

// texto: o campo como string ("" se ausente ou de outro tipo).
func (c corpoDaEdge) texto(k string) string {
	var s string
	if json.Unmarshal(c[k], &s) != nil {
		return ""
	}
	return s
}

// ehTrue: `corpo.k === true`.
func (c corpoDaEdge) ehTrue(k string) bool { return bytes.Equal(bytes.TrimSpace(c[k]), []byte("true")) }

// verdadeiro: a "verdade" do JavaScript (`if (corpo.k)`): ausente, null, false, 0 e "" não valem.
func (c corpoDaEdge) verdadeiro(k string) bool {
	v := bytes.TrimSpace(c[k])
	switch string(v) {
	case "", "null", "false", "0", `""`:
		return false
	}
	return true
}

// bruto: o campo, ou nil se ausente (o parâmetro some e vale o DEFAULT da função, ou falta e dá erro, como no PostgREST).
func (c corpoDaEdge) bruto(k string) json.RawMessage { return c[k] }

// ouNulo: `corpo.k ?? null`.
func (c corpoDaEdge) ouNulo(k string) json.RawMessage {
	if v, ok := c[k]; ok {
		return v
	}
	return json.RawMessage("null")
}

func lit(v any) json.RawMessage { b, _ := json.Marshal(v); return b }

// chamadasDoBanco roda as funções de uma edge, cada uma na sua transação (como cada `.rpc` da edge).
type chamadasDoBanco struct {
	s   *Servico
	ctx context.Context
	ip  string
	fns map[string]rpc.Funcao
}

func (s *Servico) chamadas(ctx context.Context, ip string) *chamadasDoBanco {
	return &chamadasDoBanco{s: s, ctx: ctx, ip: ip, fns: porNome(deEdge)}
}

// chamar devolve o JSON da função ("null" vira nil). Parâmetro com valor nil não é enviado.
func (c *chamadasDoBanco) chamar(nome string, args map[string]json.RawMessage) (json.RawMessage, error) {
	f, ok := c.fns[nome]
	if !ok {
		panic("função de edge não declarada: " + nome) // erro de programação: a API não deve nem subir com isso
	}
	corpo := map[string]json.RawMessage{}
	for k, v := range args {
		if v != nil {
			corpo[k] = v
		}
	}
	ped, msg := f.Montar(corpo)
	if msg != "" {
		slog.Error("edge: parâmetro", "rpc", nome, "motivo", msg)
		return nil, errors.New(msg)
	}
	var saida []byte
	err := banco.ComAnonimo(c.ctx, c.s.Pool, "dono", c.ip, func(tx pgx.Tx) (err error) {
		saida, err = f.Rodar(c.ctx, tx, ped)
		return err
	})
	if err != nil {
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			slog.Error("edge: banco", "rpc", nome, "mensagem", pe.Message)
		} else {
			slog.Error("edge: banco", "rpc", nome, "erro", "sem resposta")
		}
		return nil, err
	}
	if string(bytes.TrimSpace(saida)) == "null" {
		return nil, nil
	}
	return saida, nil
}

// objeto: o JSON como mapa (nil se vazio ou não for objeto).
func objeto(raw json.RawMessage) map[string]any {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return nil
	}
	return m
}

func responder(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if b, ok := corpo.(json.RawMessage); ok {
		w.Write(b)
		return
	}
	json.NewEncoder(w).Encode(corpo)
}

// hashDoIP: o IP já em hash, salgado com a chave do Core; o IP puro nunca é gravado (vessel-conta/index.ts:hashDoIp).
func (s *Servico) hashDoIP(ip string) string {
	if ip == "" {
		ip = "desconhecido"
	}
	h := sha256.Sum256([]byte("vessel-conta:" + s.Segredo + ":" + ip))
	return hex.EncodeToString(h[:])[:32]
}

// dentroDoTeto: vessel_teto_de_chamadas, no banco (a edge não guarda estado). FALHA ABERTA, COM LOG: o teto é defesa em
// profundidade e um banco sem a função não pode derrubar o cadastro da cliente.
func (c *chamadasDoBanco) dentroDoTeto(chave string, max, janela int) bool {
	saida, err := c.chamar("vessel_teto_de_chamadas", map[string]json.RawMessage{"p_chave": lit(chave), "p_max": lit(max), "p_janela_segundos": lit(janela)})
	if err != nil {
		return true
	}
	return bytes.Equal(bytes.TrimSpace(saida), []byte("true"))
}
