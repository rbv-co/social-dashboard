package auth

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

var (
	reUUIDConta    = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	reEmailSimples = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
)

// falhaDaEdge: o contrato de erro de invite-user e entrar-como-usuario (400 {"error": frase}),
// que a tela mostra como está.
func falhaDaEdge(w http.ResponseWriter, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusBadRequest)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func jaCadastrado(err error) bool {
	var pe *pgconn.PgError
	return errors.As(err, &pe) && pe.Code == "23505"
}

func sucesso(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"success":true}`))
}

// InviteUser: POST /invite-user, o mesmo corpo e as mesmas respostas da edge invite-user:
// convidar (com ou sem senha), excluir (deleteUserId) e, só super-admin, trocar a senha de
// alguém (resetPasswordUserId, que fica provisória: precisa_trocar_senha). Portão: papel admin.
// Sessão de "entrar como" não administra contas (Ruling 18): o Ator é o do alvo, então o
// papel admin dele valeria; a marca ImpersonadorID é o que barra.
//
// PARIDADE COM A EDGE (Ruling 21, achado para o dono): qualquer admin exclui QUALQUER conta,
// inclusive a de um super-admin, e cria outro admin. É o que a edge fazia; restringir é decisão
// do dono, não desta migração. TestInviteUserAdminExcluiSuperAdminComoNaEdge documenta o fato.
func (c *Conta) InviteUser(w http.ResponseWriter, r *http.Request) {
	a := AtorDoContexto(r.Context())
	if a.ImpersonadorID != nil {
		falhaDaEdge(w, "Quem entrou como outra pessoa não administra contas.")
		return
	}
	if a.Papel != "admin" {
		falhaDaEdge(w, "Apenas administradores podem realizar esta ação")
		return
	}
	var in struct {
		Email, Name, Role, Password, DeleteUserId, ResetPasswordUserId string
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)).Decode(&in) != nil {
		falhaDaEdge(w, "Pedido inválido")
		return
	}
	ctx := r.Context()
	switch {
	case in.ResetPasswordUserId != "":
		if !a.SuperAdmin {
			falhaDaEdge(w, "Apenas superadmin pode trocar a senha de usuários")
			return
		}
		if len(in.Password) < SenhaMinima {
			falhaDaEdge(w, "A senha precisa de no mínimo 6 caracteres")
			return
		}
		if len(in.Password) > SenhaMaxima {
			falhaDaEdge(w, "A senha pode ter no máximo 72 caracteres.")
			return
		}
		if !reUUIDConta.MatchString(in.ResetPasswordUserId) {
			falhaDaEdge(w, "Usuário não encontrado")
			return
		}
		hash, err := HashDaSenha(in.Password)
		if err != nil {
			erroJSON(w, http.StatusInternalServerError, "erro_interno")
			return
		}
		achou := false
		err = banco.ComUsuario(ctx, c.Pool, a.ID, func(tx pgx.Tx) error {
			tag, err := tx.Exec(ctx, `update usuarios set senha_hash = $2::text where id = $1::uuid`, in.ResetPasswordUserId, hash)
			if err != nil || tag.RowsAffected() == 0 {
				return err
			}
			achou = true
			// senha posta por outra pessoa é PROVISÓRIA (a tela cobra a troca) e derruba as sessões do alvo
			if _, err := tx.Exec(ctx, `update profiles set precisa_trocar_senha = true where id = $1::uuid`, in.ResetPasswordUserId); err != nil {
				return err
			}
			_, err = tx.Exec(ctx, `delete from sessoes where usuario_id = $1::uuid`, in.ResetPasswordUserId)
			return err
		})
		switch {
		case err != nil:
			erroJSON(w, http.StatusInternalServerError, "erro_interno")
		case !achou:
			falhaDaEdge(w, "Usuário não encontrado")
		default:
			sucesso(w)
		}
		return

	case in.DeleteUserId != "":
		if in.DeleteUserId == a.ID {
			falhaDaEdge(w, "Não é possível excluir sua própria conta")
			return
		}
		if !reUUIDConta.MatchString(in.DeleteUserId) {
			falhaDaEdge(w, "Usuário não encontrado")
			return
		}
		achou := false
		err := banco.ComUsuario(ctx, c.Pool, a.ID, func(tx pgx.Tx) error {
			// tudo numa transação: se um registro ligado barrar a exclusão (FK), o perfil também
			// volta (a edge apagava o perfil antes e deixava um perfil sem conta). As sessões e os
			// links da conta caem em cascata; as que ela abriu "como" outra pessoa (impersonador_id,
			// sem cascata) são apagadas aqui para não barrar a exclusão de um super-admin.
			if _, err := tx.Exec(ctx, `delete from sessoes where impersonador_id = $1::uuid`, in.DeleteUserId); err != nil {
				return err
			}
			p, err := tx.Exec(ctx, `delete from profiles where id = $1::uuid`, in.DeleteUserId)
			if err != nil {
				return err
			}
			u, err := tx.Exec(ctx, `delete from usuarios where id = $1::uuid`, in.DeleteUserId)
			achou = p.RowsAffected()+u.RowsAffected() > 0
			return err
		})
		var pe *pgconn.PgError
		switch {
		case errors.As(err, &pe) && pe.Code == "23503":
			falhaDaEdge(w, "Não é possível excluir: ainda há registros ligados a esta pessoa.")
		case err != nil:
			erroJSON(w, http.StatusInternalServerError, "erro_interno")
		case !achou:
			falhaDaEdge(w, "Usuário não encontrado") // a edge também errava ao excluir quem não existe
		default:
			sucesso(w)
		}
		return
	}

	email := strings.ToLower(strings.TrimSpace(in.Email))
	if email == "" {
		falhaDaEdge(w, "Email obrigatório")
		return
	}
	if len(email) > 254 || !reEmailSimples.MatchString(email) {
		falhaDaEdge(w, "E-mail inválido")
		return
	}
	papel := "viewer"
	if in.Role == "admin" {
		papel = "admin"
	}
	// pendente: convidada que ainda não definiu a senha (convidar de novo = outro convite de 24 h)
	var existente string
	var pendente bool
	if err := c.Pool.QueryRow(ctx, `select id::text, senha_hash is null and email_confirmado_em is null from usuarios where lower(email) = $1::text`, email).Scan(&existente, &pendente); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}

	if len(in.Password) >= SenhaMinima { // criar já com senha (a edge: password && length >= 6)
		if len(in.Password) > SenhaMaxima {
			falhaDaEdge(w, "A senha pode ter no máximo 72 caracteres.")
			return
		}
		if existente != "" {
			falhaDaEdge(w, "A user with this email address has already been registered")
			return
		}
		hash, err := HashDaSenha(in.Password)
		if err != nil {
			erroJSON(w, http.StatusInternalServerError, "erro_interno")
			return
		}
		if err := banco.ComUsuario(ctx, c.Pool, a.ID, func(tx pgx.Tx) error {
			var id string
			if err := tx.QueryRow(ctx, `insert into usuarios (id, email, senha_hash, email_confirmado_em)
			    values (gen_random_uuid(), $1::text, $2::text, now()) returning id::text`, email, hash).Scan(&id); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `insert into profiles (id, email, name, role) values ($1::uuid, $2::text, $3::text, $4::text)
			    on conflict (id) do update set email = excluded.email, name = excluded.name, role = excluded.role`, id, email, in.Name, papel)
			return err
		}); err != nil {
			if jaCadastrado(err) { // dois pedidos juntos para o mesmo e-mail: o índice único decide
				falhaDaEdge(w, "A user with this email address has already been registered")
				return
			}
			erroJSON(w, http.StatusInternalServerError, "erro_interno")
			return
		}
		sucesso(w)
		return
	}

	// Convite por e-mail. Quem já tem conta recebe o link de troca de senha (como a edge fazia
	// quando o Auth respondia "already registered").
	base := c.destino(r)
	var link, assunto, frase string
	err := banco.ComUsuario(ctx, c.Pool, a.ID, func(tx pgx.Tx) error {
		var err error
		if existente != "" && pendente {
			link, err = novoLink(ctx, tx, existente, "convite", base, PrazoConvite)
			assunto, frase = "Você foi convidado para a Central", "Você foi convidado! Crie a sua senha pelo link (vale por 24 horas): "
			return err
		}
		if existente != "" {
			link, err = novoLink(ctx, tx, existente, "recuperacao", base, PrazoRecuperacao)
			assunto, frase = "Troque a sua senha da Central", "Para criar uma senha nova, abra o link (vale por 1 hora): "
			return err
		}
		var id string
		if err := tx.QueryRow(ctx, `insert into usuarios (id, email) values (gen_random_uuid(), $1::text) returning id::text`, email).Scan(&id); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `insert into profiles (id, email, name, role) values ($1::uuid, $2::text, $3::text, $4::text)
		    on conflict (id) do nothing`, id, email, in.Name, papel); err != nil {
			return err
		}
		link, err = novoLink(ctx, tx, id, "convite", base, PrazoConvite)
		assunto, frase = "Você foi convidado para a Central", "Você foi convidado! Crie a sua senha pelo link (vale por 24 horas): "
		return err
	})
	if jaCadastrado(err) {
		falhaDaEdge(w, "A user with this email address has already been registered")
		return
	}
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	if err := c.Email.Mandar(ctx, email, assunto, `<p>`+frase+`</p><p><a href="`+link+`">Abrir a Central</a></p>`, frase+link); err != nil {
		slog.Error("invite-user: e-mail não saiu", "erro", err.Error())
		falhaDaEdge(w, "Não consegui enviar o e-mail. Tente de novo.")
		return
	}
	sucesso(w)
}
