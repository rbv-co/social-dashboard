package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// Prazos dos links de uso único: troca de senha 1 h (o padrão do Auth do Supabase); convite
// 24 h (quem é convidado nem sempre abre o e-mail na mesma hora).
const (
	PrazoRecuperacao = time.Hour
	PrazoConvite     = 24 * time.Hour
	SenhaMinima      = 6  // a mesma regra da tela e do Auth do Supabase
	SenhaMaxima      = 72 // bcrypt ignora o que passa de 72 bytes: recusar é mais honesto que cortar
)

// Mandador é quem envia e-mail (email.ZeptoMail; os testes trocam).
type Mandador interface {
	Mandar(ctx context.Context, para, assunto, html, texto string) error
}

// Conta: troca de senha, links de uso único e o perfil de quem está logado.
type Conta struct {
	Pool      *pgxpool.Pool
	Sessoes   *Store
	Email     Mandador
	Enderecos []string // ENDERECOS_DO_APP: para onde o link pode levar (texto exato)
	Padrao    string   // ENDERECO_PADRAO
	PorIP     *Limitador
	PorEmail  *Limitador
	enviando  chan struct{} // testes: avisa quando o envio assíncrono termina
	conferir  conferencias  // conferir-senha: erros por pessoa
}

func NovaConta(p *pgxpool.Pool, s *Store, m Mandador, enderecos []string, padrao string) *Conta {
	lim := func(max int) *Limitador {
		l := NovoLimitador()
		l.Max, l.Janela = max, 15*time.Minute
		return l
	}
	return &Conta{Pool: p, Sessoes: s, Email: m, Enderecos: enderecos, Padrao: padrao, PorIP: lim(20), PorEmail: lim(5)}
}

// destino: a origem do pedido se for um dos endereços do app; senão o padrão. Nunca o que o
// pedido mandou sem conferir (link de senha para site de terceiro).
func (c *Conta) destino(r *http.Request) string {
	if o := r.Header.Get("Origin"); slices.Contains(c.Enderecos, o) {
		return o
	}
	return c.Padrao
}

func tokenAleatorio() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// novoLink grava um token de uso único (apagando os anteriores não usados do mesmo tipo) e
// devolve o link em claro.
func novoLink(ctx context.Context, tx pgx.Tx, usuarioID, tipo, base string, prazo time.Duration) (string, error) {
	tok, err := tokenAleatorio()
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `delete from tokens_de_senha where usuario_id = $1::uuid and tipo = $2::text and usado_em is null`, usuarioID, tipo); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `insert into tokens_de_senha (token_hash, usuario_id, tipo, expira_em) values ($1::text, $2::uuid, $3::text, now() + make_interval(secs => $4::int))`,
		hashDoToken(tok), usuarioID, tipo, int(prazo.Seconds())); err != nil {
		return "", err
	}
	return base + "/#type=" + // fragmento: não chega ao servidor, ao log do nginx nem ao Referer
		map[string]string{"convite": "invite", "recuperacao": "recovery"}[tipo] + "&token=" + tok, nil
}

func validarSenha(s string) string {
	switch {
	case senhaCurta(s): // caracteres, não bytes (Ruling 33)
		return "A senha deve ter ao menos 6 caracteres."
	case len(s) > SenhaMaxima:
		return "A senha pode ter no máximo 72 bytes."
	}
	return ""
}

func erroComMensagem(w http.ResponseWriter, status int, codigo, mensagem string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": codigo, "mensagem": mensagem})
}

// EsqueciSenha: POST /auth/esqueci-senha {email} (público). Responde SEMPRE 202 igual, exista
// a conta ou não (sem enumeração), e manda o e-mail fora da requisição (o tempo de resposta
// também não entrega quem tem conta).
func (c *Conta) EsqueciSenha(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in)
	email := strings.ToLower(strings.TrimSpace(in.Email))
	if email == "" || len(email) > 254 {
		erroJSON(w, http.StatusBadRequest, "pedido_invalido")
		return
	}
	if !(c.PorIP.Tentar(ipDe(r)) && c.PorEmail.Tentar(email)) {
		erroJSON(w, http.StatusTooManyRequests, "muitas_tentativas")
		return
	}
	base := c.destino(r)
	go func() {
		defer func() {
			if c.enviando != nil {
				c.enviando <- struct{}{}
			}
		}()
		defer func() { // um pânico no envio não derruba o processo; o valor pode ter o link: só o tipo vai ao log
			if p := recover(); p != nil {
				slog.Error("esqueci-senha: pânico ao enviar o link", "tipo", fmt.Sprintf("%T", p))
			}
		}()
		ctx, cancela := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancela()
		var id string
		err := c.Pool.QueryRow(ctx, `select u.id::text from usuarios u left join profiles p on p.id = u.id
		   where lower(u.email) = $1::text and u.desativado_em is null and not coalesce(p.disabled, false)`, email).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			return
		}
		var link string
		if err == nil {
			err = pgx.BeginFunc(ctx, c.Pool, func(tx pgx.Tx) error {
				// trava a linha da pessoa: dois pedidos juntos não passam os dois pela conferência abaixo
				if _, e := tx.Exec(ctx, `select 1 from usuarios where id = $1::uuid for update`, id); e != nil {
					return e
				}
				var recente bool
				if e := tx.QueryRow(ctx, `select exists (select 1 from tokens_de_senha where usuario_id = $1::uuid and criado_em > now() - interval '60 seconds')`, id).Scan(&recente); e != nil || recente {
					return e // anti bombardeio de e-mail: link de menos de 1 min atrás vale; a resposta ao pedido é a mesma
				}
				var e error
				link, e = novoLink(ctx, tx, id, "recuperacao", base, PrazoRecuperacao)
				return e
			})
		}
		if err == nil && link != "" {
			err = c.Email.Mandar(ctx, email, "Troque a sua senha da Central",
				`<p>Para criar uma senha nova, abra o link abaixo (vale por 1 hora):</p><p><a href="`+link+`">Criar senha nova</a></p>`,
				"Para criar uma senha nova, abra o link (vale por 1 hora): "+link)
		}
		if err != nil {
			slog.Error("esqueci-senha: não enviei o link", "usuario", id, "erro", err.Error())
		}
	}()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"ok":true}`))
}

// DefinirSenha: POST /auth/definir-senha {token, senha} (público). Consome o link (convite ou
// troca), grava a senha, derruba as outras sessões da pessoa e já devolve uma sessão nova.
func (c *Conta) DefinirSenha(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Token string `json:"token"`
		Senha string `json:"senha"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in)
	if in.Token == "" || len(in.Token) > 100 {
		erroJSON(w, http.StatusBadRequest, "pedido_invalido")
		return
	}
	if msg := validarSenha(in.Senha); msg != "" {
		erroComMensagem(w, http.StatusBadRequest, "senha_invalida", msg)
		return
	}
	if !c.PorIP.Tentar(ipDe(r)) {
		erroJSON(w, http.StatusTooManyRequests, "muitas_tentativas")
		return
	}
	hash, err := HashDaSenha(in.Senha)
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	var id string
	err = pgx.BeginFunc(r.Context(), c.Pool, func(tx pgx.Tx) error {
		if err := tx.QueryRow(r.Context(), `select t.usuario_id::text from tokens_de_senha t
		     join usuarios u on u.id = t.usuario_id left join profiles p on p.id = u.id
		    where t.token_hash = $1::text and t.usado_em is null and t.expira_em > now()
		      and u.desativado_em is null and not coalesce(p.disabled, false)
		    for update of t`, hashDoToken(in.Token)).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `update usuarios set senha_hash = $2::text, email_confirmado_em = coalesce(email_confirmado_em, now()) where id = $1::uuid`, id, hash); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `update tokens_de_senha set usado_em = now() where token_hash = $1::text`, hashDoToken(in.Token)); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `delete from tokens_de_senha where usuario_id = $1::uuid and usado_em is null`, id); err != nil {
			return err
		}
		// também as sessões "entrou como" em que a pessoa é o impersonador (quem roubou a senha dela)
		_, err := tx.Exec(r.Context(), `delete from sessoes where usuario_id = $1::uuid or impersonador_id = $1::uuid`, id)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) {
		erroComMensagem(w, http.StatusBadRequest, "token_invalido", "Este link é inválido ou já venceu. Peça um novo.")
		return
	}
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	token, err := c.Sessoes.Criar(r.Context(), id, "painel", nil)
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

// TrocarSenha: POST /auth/trocar-senha {senha} (sessão). Grava a senha, tira a cobrança de
// troca (precisa_trocar_senha) e derruba as OUTRAS sessões da pessoa. Sessão de "entrar como"
// nunca troca a senha de ninguém.
func (c *Conta) TrocarSenha(w http.ResponseWriter, r *http.Request) {
	a := AtorDoContexto(r.Context())
	if a.ImpersonadorID != nil {
		erroComMensagem(w, http.StatusForbidden, "sem_permissao", "Quem entrou como outra pessoa não troca a senha dela.")
		return
	}
	var in struct {
		Senha string `json:"senha"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in)
	if msg := validarSenha(in.Senha); msg != "" {
		erroComMensagem(w, http.StatusBadRequest, "senha_invalida", msg)
		return
	}
	hash, err := HashDaSenha(in.Senha)
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	meuHash := hashDoToken(tokenDe(r))
	err = banco.ComUsuario(r.Context(), c.Pool, a.ID, func(tx pgx.Tx) error { // gatilhos de profiles veem quem
		if _, err := tx.Exec(r.Context(), `update usuarios set senha_hash = $2::text where id = $1::uuid`, a.ID, hash); err != nil {
			return err
		}
		// A sessão de quem troca foi validada ANTES da transação: um definir-senha concorrente (a dona) pode
		// tê-la derrubado e criado a sessão nova dela. Conferida e travada aqui, DEPOIS do lock de usuarios (a
		// mesma ordem do definir-senha: sem deadlock): sumiu = 401, a transação desfaz tudo e não apaga a
		// sessão nova da dona nem sobrescreve a senha dela.
		var viva bool
		if err := tx.QueryRow(r.Context(), `select true from sessoes where token_hash = $1::text for update`, meuHash).Scan(&viva); err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `update profiles set precisa_trocar_senha = false where id = $1::uuid`, a.ID); err != nil {
			return err
		}
		// links de senha ainda vivos (podem ter vazado) morrem junto com a senha antiga
		if _, err := tx.Exec(r.Context(), `delete from tokens_de_senha where usuario_id = $1::uuid and usado_em is null`, a.ID); err != nil {
			return err
		}
		_, err := tx.Exec(r.Context(), `delete from sessoes where (usuario_id = $1::uuid or impersonador_id = $1::uuid) and token_hash <> $2::text`, a.ID, meuHash)
		return err
	})
	if errors.Is(err, pgx.ErrNoRows) { // a própria sessão sumiu durante a troca
		erroJSON(w, http.StatusUnauthorized, "nao_autenticado")
		return
	}
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Perfil: GET /eu/perfil (sessão) -> o mesmo array que a tela lia de
// profiles?id=eq.<eu>&select=role,features,...: [] quando não há perfil.
func (c *Conta) Perfil(w http.ResponseWriter, r *http.Request) {
	var corpo []byte
	err := c.Pool.QueryRow(r.Context(), `select coalesce(json_agg(t.*), '[]'::json) from (
	    select role, features, avatar_url, permissions, allowed_accounts, is_superadmin, precisa_trocar_senha, escopo_por_equipe
	      from profiles where id = $1::uuid) t`, AtorDoContexto(r.Context()).ID).Scan(&corpo)
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(corpo)
}
