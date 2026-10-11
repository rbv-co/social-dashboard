package frota

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
)

// Reserva é POST /avisar-decisao-de-reserva (porta da edge de mesmo nome; o front chama depois de
// aprovar/recusar/cancelar/revogar). DEVE vir atrás de auth.Exigir + auth.ExigirPermissao(
// "frota.aprovar", "ver") — o mesmo portão da edge (superadmin ou permissions['frota.aprovar']
// contém 'ver'). Quem chama manda SÓ o id: o texto sai do que está gravado (senão seria um jeito de
// mandar push arbitrário para o celular de qualquer pessoa).
type Reserva struct {
	Pool  *pgxpool.Pool
	VAPID webpush.VAPID
	HTTP  *http.Client // serviço de push; nil = o cliente seguro do webpush
}

func responder(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

type obj = map[string]any

func (rs *Reserva) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	ator := auth.AtorDoContexto(ctx)
	var in struct {
		RequisicaoID any `json:"requisicaoId"`
	}
	json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&in)
	id, _ := in.RequisicaoID.(string)
	if id == "" {
		responder(w, http.StatusBadRequest, obj{"ok": false, "erro": "sem_requisicao"})
		return
	}
	falhou := func(onde string, err error) {
		slog.Error("avisar-decisao-de-reserva", "onde", onde, "erro", err)
		responder(w, http.StatusInternalServerError, obj{"ok": false, "erro": "erro_interno"})
	}
	var req Requisicao
	var veiculo *string
	err := rs.Pool.QueryRow(ctx, `select r.id::text, r.situacao, r.retirada_prevista, r.destino, r.motivo_decisao,
			r.encerrada_motivo, r.pessoa_id::text, r.pessoa_nome, r.criada_por::text, v.nome
		  from frota_requisicoes r left join frota_veiculos v on v.id = r.veiculo_id
		 where r.id::text = lower($1::text)`, id).
		Scan(&req.ID, &req.Situacao, &req.RetiradaPrevista, &req.Destino, &req.MotivoDecisao, &req.EncerradaMotivo,
			&req.PessoaID, &req.PessoaNome, &req.CriadaPor, &veiculo)
	if errors.Is(err, pgx.ErrNoRows) {
		responder(w, http.StatusNotFound, obj{"ok": false, "erro": "requisicao_nao_encontrada"})
		return
	}
	if err != nil {
		falhou("requisição", err)
		return
	}
	aviso, ok := montarAvisoDeReserva(req, deref(veiculo))
	if !ok {
		responder(w, http.StatusOK, obj{"ok": true, "enviados": 0, "motivo": "situacao_nao_avisavel", "situacao": req.Situacao})
		return
	}
	// Quem PEDIU: pessoa_id na frente; criada_por como resgate (pedido aberto pela Gestão em nome de outro).
	destino := ""
	if req.PessoaID != nil {
		pessoas, err := carregarPessoas(ctx, rs.Pool)
		if err != nil {
			falhou("pessoas", err)
			return
		}
		usuarios, err := carregarUsuarios(ctx, rs.Pool)
		if err != nil {
			falhou("usuários", err)
			return
		}
		destino = loginDaPessoa(pessoas[*req.PessoaID], usuarios)
	}
	if destino == "" {
		destino = deref(req.CriadaPor)
	}
	if destino == "" {
		responder(w, http.StatusOK, obj{"ok": true, "enviados": 0, "motivo": "quem_pediu_nao_tem_login", "pessoa": req.PessoaNome})
		return
	}
	if destino == ator.ID {
		responder(w, http.StatusOK, obj{"ok": true, "enviados": 0, "motivo": "decidiu_a_propria"})
		return
	}
	inscritos, err := webpush.Destinatarios(ctx, rs.Pool, "frota_reserva", destino)
	if err != nil {
		falhou("inscrições", err)
		return
	}
	if len(inscritos) == 0 {
		responder(w, http.StatusOK, obj{"ok": true, "enviados": 0, "motivo": "sem_aparelho_ou_aviso_desligado"})
		return
	}
	if _, err := webpush.ValidarVAPID(rs.VAPID); err != nil {
		slog.Error("avisar-decisao-de-reserva: VAPID", "erro", err) // o erro nunca traz as chaves
		responder(w, http.StatusInternalServerError, obj{"ok": false, "erro": "vapid_nao_configurado"})
		return
	}
	// A mesma decisão (id + situação) não vai duas vezes ao mesmo aparelho (clique duplo, nova tentativa). A
	// chave NÃO leva data, de propósito (aceito): o mesmo par id+situação só volta por um novo clique do front,
	// e depois da faxina das reservas com mais de 45 dias um reenvio seria, no pior caso, um aviso a mais. A tag
	// é por reserva: o aviso da nova situação (recusada, depois revogada) SUBSTITUI o card anterior em vez de
	// empilhar; ela só vale no aparelho, a deduplicação é do livro.
	res, err := webpush.Entregar(ctx, rs.Pool, rs.HTTP, inscritos, carga(aviso, "reserva-"+req.ID),
		rs.VAPID, "avisar-decisao-de-reserva:"+req.ID+":"+req.Situacao)
	if err != nil {
		falhou("entrega", err)
		return
	}
	// Já entregue antes conta como entregue: o front só precisa saber se a pessoa foi avisada.
	responder(w, http.StatusOK, obj{"ok": true, "enviados": res.Enviados + res.Repetidos, "podados": res.Podados, "falhas": res.Falhas, "situacao": req.Situacao})
}
