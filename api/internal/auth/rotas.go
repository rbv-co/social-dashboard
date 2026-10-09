package auth

import (
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

type Handlers struct {
	pool    *pgxpool.Pool
	sessoes *Store
	limite  *Limitador
}

func NovosHandlers(p *pgxpool.Pool, s *Store, l *Limitador) *Handlers {
	return &Handlers{pool: p, sessoes: s, limite: l}
}

// gasta o mesmo tempo de bcrypt quando o e-mail não existe (ou a conta não tem
// senha), para não revelar quem tem conta
var hashFalso, _ = bcrypt.GenerateFromPassword([]byte("x"), bcrypt.DefaultCost)

// ipDe tira a porta de RemoteAddr: sem isso cada conexão nova teria chave própria
// e escaparia do limite. Atrás do nginx, RealIP já deixa só o IP.
func ipDe(r *http.Request) string {
	if ip, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return ip
	}
	return r.RemoteAddr
}

func (h *Handlers) Entrar(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
		Senha string `json:"senha"`
	}
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in) != nil || in.Email == "" || in.Senha == "" {
		erroJSON(w, http.StatusBadRequest, "pedido_invalido")
		return
	}
	email := strings.ToLower(strings.TrimSpace(in.Email))
	chave := email + "|" + ipDe(r)
	if h.limite.Bloqueado(chave) {
		erroJSON(w, http.StatusTooManyRequests, "muitas_tentativas")
		return
	}
	var id, hash string
	err := h.pool.QueryRow(r.Context(),
		`select id::text, coalesce(senha_hash, '') from usuarios where lower(email) = $1 and desativado_em is null`, email).
		Scan(&id, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		id = ""
	} else if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	if hash == "" { // sem conta ou sem senha cadastrada: mesmo custo de bcrypt
		hash = string(hashFalso)
	}
	if !SenhaConfere(hash, in.Senha) || id == "" {
		h.limite.Falhou(chave)
		erroJSON(w, http.StatusUnauthorized, "credenciais_invalidas")
		return
	}
	h.limite.Limpar(chave)
	token, err := h.sessoes.Criar(r.Context(), id, "painel", nil)
	if err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"token": token})
}

func (h *Handlers) Sair(w http.ResponseWriter, r *http.Request) {
	if err := h.sessoes.Revogar(r.Context(), tokenDe(r)); err != nil {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handlers) Eu(w http.ResponseWriter, r *http.Request) {
	a := AtorDoContexto(r.Context())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"id": a.ID, "tipo": a.Tipo, "papel": a.Papel, "superadmin": a.SuperAdmin,
		"permissoes": a.Permissoes, "impersonador_id": a.ImpersonadorID,
	})
}
