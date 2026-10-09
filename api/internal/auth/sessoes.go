package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrSessaoInvalida = errors.New("sessão inválida")

type Sessao struct {
	UsuarioID      string
	Tipo           string
	ImpersonadorID *string
	ExpiraEm       time.Time
}

type Store struct {
	TTL   time.Duration
	pool  *pgxpool.Pool
	agora func() time.Time
}

func NovoStore(p *pgxpool.Pool) *Store {
	return &Store{TTL: 12 * time.Hour, pool: p, agora: time.Now}
}

func hashDoToken(t string) string {
	h := sha256.Sum256([]byte(t))
	return hex.EncodeToString(h[:])
}

func (s *Store) Criar(ctx context.Context, usuarioID, tipo string, impersonadorID *string) (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := base64.RawURLEncoding.EncodeToString(b)
	agora := s.agora()
	_, err := s.pool.Exec(ctx,
		`insert into sessoes (token_hash, usuario_id, tipo, impersonador_id, criada_em, expira_em, ultimo_uso_em)
		 values ($1, $2, $3, $4, $5, $6, $5)`,
		hashDoToken(token), usuarioID, tipo, impersonadorID, agora, agora.Add(s.TTL))
	return token, err
}

// Buscar valida o token (conta e impersonador ativos: `profiles.disabled` é a
// desativação real em produção; `usuarios.desativado_em` vem do Auth) e, só para sessão normal, renova a expiração
// (no máximo a cada 5 min, para não escrever no banco a cada requisição).
func (s *Store) Buscar(ctx context.Context, token string) (*Sessao, error) {
	h := hashDoToken(token)
	agora := s.agora()
	var se Sessao
	var ultimo time.Time
	err := s.pool.QueryRow(ctx,
		`select s.usuario_id::text, s.tipo, s.impersonador_id::text, s.expira_em, s.ultimo_uso_em
		   from sessoes s
		   join usuarios u on u.id = s.usuario_id
		   left join profiles p on p.id = u.id
		   left join usuarios ui on ui.id = s.impersonador_id
		   left join profiles pi on pi.id = s.impersonador_id
		  where s.token_hash = $1
		    and u.desativado_em is null and not coalesce(p.disabled, false)
		    and (s.impersonador_id is null or (ui.desativado_em is null and not coalesce(pi.disabled, false)))`, h).
		Scan(&se.UsuarioID, &se.Tipo, &se.ImpersonadorID, &se.ExpiraEm, &ultimo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessaoInvalida
	}
	if err != nil {
		return nil, err
	}
	if !agora.Before(se.ExpiraEm) {
		return nil, ErrSessaoInvalida
	}
	if se.ImpersonadorID == nil && agora.Sub(ultimo) > 5*time.Minute {
		novo := agora.Add(s.TTL)
		if _, err := s.pool.Exec(ctx, `update sessoes set expira_em = $2, ultimo_uso_em = $3 where token_hash = $1`, h, novo, agora); err != nil {
			return nil, err
		}
		se.ExpiraEm = novo
	}
	return &se, nil
}

func (s *Store) Revogar(ctx context.Context, token string) error {
	_, err := s.pool.Exec(ctx, `delete from sessoes where token_hash = $1`, hashDoToken(token))
	return err
}
