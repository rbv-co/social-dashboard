package arquivos

import (
	"encoding/json"
	"net/http"
	"regexp"
	"slices"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// O currículo da candidata: o Core (e, antes dele, o navegador com a chave anon) envia o arquivo ao bucket
// vessel-curriculos por `POST /storage/v1/object/vessel-curriculos/<pasta>/<arquivo>`. A policy de produção
// (vessel_curriculos_anon_so_envia) deixava a anon SÓ INSERIR e SÓ nas pastas consultor-tivoli e consultor-brasilia:
// aqui é igual — pasta da lista, nome simples, nunca sobrescreve (409), tipo e tamanho do bucket; ler e apagar é do robô
// da triagem (sessão de serviço), pelas rotas de sessão.

var pastasDeCurriculo = []string{"consultor-tivoli", "consultor-brasilia"}

var reNomeDeCurriculo = regexp.MustCompile(`^[A-Za-z0-9._-]{1,120}$`)

const (
	curriculosPorIP    = 10
	curriculosGlobal   = 200
	curriculosDoCore   = 600
	janelaDeCurriculos = time.Hour
)

func (s *Servico) limitesDoCurriculo() func(http.Handler) http.Handler {
	novo := func(max int) *auth.Limitador {
		l := auth.NovoLimitador()
		l.Max, l.Janela = max, janelaDeCurriculos
		return l
	}
	s.limIPCurriculo, s.limGlobalCurriculo, s.limCoreCurriculo = novo(curriculosPorIP), novo(curriculosGlobal), novo(curriculosDoCore)
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip, core := s.quem(r)
			ok := false
			if core { // o Core envia por todas as candidatas: só o disjuntor global dele
				ok = s.limCoreCurriculo.Tentar("core")
			} else {
				ok = s.limIPCurriculo.Tentar(ip) && s.limGlobalCurriculo.Tentar("global")
			}
			if !ok {
				w.Header().Set("Retry-After", "3600")
				dados.Erro(w, http.StatusTooManyRequests, "muitas_requisicoes", "")
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

func (s *Servico) enviarCurriculo(w http.ResponseWriter, r *http.Request) {
	pasta, arquivo := chi.URLParam(r, "pasta"), chi.URLParam(r, "arquivo")
	if !slices.Contains(pastasDeCurriculo, pasta) || !reNomeDeCurriculo.MatchString(arquivo) || arquivo[0] == '.' {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
		return
	}
	b := s.buckets[nomeCurriculos]
	estender(w)
	if r.ContentLength > b.Max {
		dados.Erro(w, http.StatusRequestEntityTooLarge, "arquivo_grande_demais", "O arquivo passa do tamanho permitido.")
		return
	}
	if err := s.gravar(b, pasta+"/"+arquivo, r.Header.Get("Content-Type"), http.MaxBytesReader(w, r.Body, b.Max+1), false); err != nil {
		respostaDeErro(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"Key": nomeCurriculos + "/" + pasta + "/" + arquivo})
}
