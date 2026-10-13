package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// Contas de serviço (Plano 5.13): o robô é um usuário SEM senha com perfil próprio (viewer, features
// mínimas); o token `srv_...` só o identifica. Tudo que vale para gente (catálogo, módulo, conta) vale
// para o robô pelo perfil: não há escopo por token (Ruling 38).

const prefixoServico = "srv_"

var (
	ErrServicoNomeEmUso       = errors.New("já existe um token de serviço com esse nome")
	ErrServicoUsuarioComSenha = errors.New("esse e-mail é de uma conta de gente (tem senha): conta de gente não vira robô")

	reNomeServico = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{1,62}$`)
)

// ModulosConhecidos são os valores válidos de profiles.features que o código confere (ExigirModulo,
// PodeModulo, predicados do autz e policies do catálogo de produção), mais o default 'banco'.
// TestModulosConhecidosCobremOsModulosDoCodigo falha se o código passar a conferir um módulo fora daqui.
var ModulosConhecidos = []string{"abandono-carrinho", "acessos", "autenticidade", "banco", "carrinho", "claude.status",
	"conteudo", "frota", "frota.aprovar", "gestor", "meta", "meta.gestor", "meta.leads", "patrimonio", "sales", "social"}

// buscarServico valida um token `srv_`: não revogado, usuário sem desativado_em e perfil sem disabled.
// Sem expiração e sem renovação (ExpiraEm fica zero); só ultimo_uso_em é gravado, no máximo a cada 5 min.
func (s *Store) buscarServico(ctx context.Context, token string) (*Sessao, error) {
	agora := s.agora()
	var id string
	se := &Sessao{Tipo: "servico"}
	err := s.pool.QueryRow(ctx,
		`select t.id::text, t.usuario_id::text
		   from tokens_de_servico t
		   join usuarios u on u.id = t.usuario_id
		   left join profiles p on p.id = u.id
		  where t.token_hash = $1 and t.revogado_em is null
		    and u.desativado_em is null and not coalesce(p.disabled, false)`, hashDoToken(token)).
		Scan(&id, &se.UsuarioID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrSessaoInvalida
	}
	if err != nil {
		return nil, err
	}
	if _, err := s.pool.Exec(ctx,
		`update tokens_de_servico set ultimo_uso_em = $2
		  where id = $1::uuid and (ultimo_uso_em is null or ultimo_uso_em < $2::timestamptz - interval '5 minutes')`,
		id, agora); err != nil {
		return nil, err
	}
	return se, nil
}

// CriarContaDeServico cria o token `nome` para o robô de e-mail `email` e devolve o token (em claro, só
// aqui). E-mail novo: cria o usuário (sem senha) e o perfil viewer com features = modulos, sem trava de equipe
// (escopo_por_equipe = false: o default de produção é true) e allowed_accounts nulo (todas as contas). E-mail que já
// existe: usa o usuário, que tem de ter perfil, não ter senha e não ser super-admin; modulos então tem de
// vir vazio (o perfil existente não é alterado por aqui). Tudo numa transação.
func (s *Store) CriarContaDeServico(ctx context.Context, nome, email string, modulos []string) (string, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	if !reNomeServico.MatchString(nome) {
		return "", fmt.Errorf("nome inválido %q: 2 a 63 caracteres, letras minúsculas, dígitos e hífen, começando por letra ou dígito", nome)
	}
	if !strings.Contains(email, "@") || len(email) > 254 {
		return "", fmt.Errorf("e-mail inválido %q", email)
	}
	for _, m := range modulos {
		if !slices.Contains(ModulosConhecidos, m) {
			return "", fmt.Errorf("módulo desconhecido %q (conhecidos: %s)", m, strings.Join(ModulosConhecidos, ", "))
		}
	}
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	token := prefixoServico + base64.RawURLEncoding.EncodeToString(b)

	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var id string
	var temSenha, temPerfil, super bool
	err = tx.QueryRow(ctx,
		`select u.id::text, u.senha_hash is not null, p.id is not null, coalesce(p.is_superadmin, false)
		   from usuarios u left join profiles p on p.id = u.id where lower(u.email) = $1::text`, email).
		Scan(&id, &temSenha, &temPerfil, &super)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		if err := tx.QueryRow(ctx, `insert into usuarios (id, email) values (gen_random_uuid(), $1::text) returning id::text`, email).Scan(&id); err != nil {
			return "", err
		}
		if modulos == nil {
			modulos = []string{}
		}
		if _, err := tx.Exec(ctx,
			`insert into profiles (id, email, name, role, features, disabled, escopo_por_equipe) values ($1::uuid, $2::text, $3::text, 'viewer', $4::text[], false, false)`,
			id, email, "robô "+nome, modulos); err != nil {
			return "", err
		}
	case err != nil:
		return "", err
	case temSenha:
		return "", ErrServicoUsuarioComSenha
	case !temPerfil:
		return "", errors.New("o usuário não tem perfil (conta de cliente não vira robô)")
	case super:
		return "", errors.New("super-admin não vira robô")
	case len(modulos) > 0:
		return "", errors.New("o usuário já existe: --modulos não vale (o perfil dele não é alterado por aqui)")
	}
	if _, err := tx.Exec(ctx, `insert into tokens_de_servico (usuario_id, nome, token_hash) values ($1::uuid, $2::text, $3::text)`,
		id, nome, hashDoToken(token)); err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" && pg.ConstraintName == "tokens_de_servico_nome_key" {
			return "", ErrServicoNomeEmUso
		}
		return "", err
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return token, nil
}

// RevogarServico marca o token como revogado; false se não existe ou já estava revogado.
func (s *Store) RevogarServico(ctx context.Context, nome string) (bool, error) {
	tag, err := s.pool.Exec(ctx, `update tokens_de_servico set revogado_em = now() where nome = $1 and revogado_em is null`, nome)
	return tag.RowsAffected() == 1, err
}

type TokenDeServico struct {
	Nome, Email             string
	CriadoEm                time.Time
	UltimoUsoEm, RevogadoEm *time.Time
}

// ListarServico lista os tokens (nunca o token: só o hash existe no banco).
func (s *Store) ListarServico(ctx context.Context) ([]TokenDeServico, error) {
	rows, err := s.pool.Query(ctx,
		`select t.nome, u.email, t.criado_em, t.ultimo_uso_em, t.revogado_em
		   from tokens_de_servico t join usuarios u on u.id = t.usuario_id order by t.criado_em, t.nome`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var l []TokenDeServico
	for rows.Next() {
		var t TokenDeServico
		if err := rows.Scan(&t.Nome, &t.Email, &t.CriadoEm, &t.UltimoUsoEm, &t.RevogadoEm); err != nil {
			return nil, err
		}
		l = append(l, t)
	}
	return l, rows.Err()
}

// SoServico deve vir DEPOIS de Exigir: as rotas de robô só aceitam conta de serviço (sessão de painel
// ou de "entrar como" leva 403).
func SoServico(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a := AtorDoContexto(r.Context()); a == nil || a.Tipo != "servico" {
			erroJSON(w, http.StatusForbidden, "sem_permissao")
			return
		}
		next.ServeHTTP(w, r)
	})
}
