package auth

import (
	"crypto/rand"
	"encoding/hex"
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
	limite  *Limitador // e-mail|ip
	porMail *Limitador // só e-mail: IPs trocando não escapam
	porIP   *Limitador // só ip: um IP varrendo e-mails
}

func NovosHandlers(p *pgxpool.Pool, s *Store, l *Limitador) *Handlers {
	extra := func(max int) *Limitador {
		x := NovoLimitador()
		x.Max, x.Janela = max, l.Janela
		return x
	}
	return &Handlers{pool: p, sessoes: s, limite: l, porMail: extra(10), porIP: extra(20)}
}

// Hash de uma senha aleatória que ninguém conhece: gasta o mesmo tempo de bcrypt
// quando o e-mail não existe (ou a conta não tem senha), sem revelar quem tem conta.
var hashFalso = func() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	h, err := bcrypt.GenerateFromPassword([]byte(hex.EncodeToString(b)), bcrypt.DefaultCost)
	if err != nil {
		panic(err)
	}
	return string(h)
}()

// ipDe devolve o IP do cliente. Só confia em X-Real-IP quando a conexão vem de
// loopback/rede privada (nosso nginx, que DEVE setar `X-Real-IP $remote_addr`);
// de origem pública, cabeçalhos do cliente são forjáveis e ignorados.
func ipDe(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	ip := net.ParseIP(host)
	if ip != nil && (ip.IsLoopback() || ip.IsPrivate()) {
		if real := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); real != nil {
			ip = real
		}
	}
	if ip == nil {
		return host
	}
	if ip.To4() == nil { // IPv6: um cliente controla o /64 inteiro, então a chave é o /64
		return ip.Mask(net.CIDRMask(64, 128)).String()
	}
	return ip.String()
}

func (h *Handlers) Entrar(w http.ResponseWriter, r *http.Request) {
	var in struct {
		Email string `json:"email"`
		Senha string `json:"senha"`
	}
	email := ""
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&in) == nil {
		email = strings.ToLower(strings.TrimSpace(in.Email))
	}
	if email == "" || in.Senha == "" || len(email) > 254 { // antes do limitador: chave não cresce sem teto
		erroJSON(w, http.StatusBadRequest, "pedido_invalido")
		return
	}
	ip := ipDe(r)
	chave := email + "|" + ip
	// registra antes do bcrypt; IP primeiro e em curto-circuito: IP bloqueado não
	// registra nas chaves de e-mail (senão trancaria contas alheias e incharia o mapa)
	if !(h.porIP.Tentar(ip) && h.limite.Tentar(chave) && h.porMail.Tentar(email)) {
		erroJSON(w, http.StatusTooManyRequests, "muitas_tentativas")
		return
	}
	var id, hash string
	err := h.pool.QueryRow(r.Context(),
		`select u.id::text, coalesce(u.senha_hash, '')
		   from usuarios u left join profiles p on p.id = u.id
		  where lower(u.email) = $1 and u.desativado_em is null and not coalesce(p.disabled, false)`, email).
		Scan(&id, &hash)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		erroJSON(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	if err != nil || hash == "" { // sem conta ou sem senha cadastrada: nega, com o mesmo custo de bcrypt
		id, hash = "", hashFalso
	}
	if !SenhaConfere(hash, in.Senha) || id == "" {
		erroJSON(w, http.StatusUnauthorized, "credenciais_invalidas")
		return
	}
	// ip não é limpo: senão um atacante zeraria o contador entrando na própria conta
	h.limite.Limpar(chave)
	h.porMail.Limpar(email)
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
