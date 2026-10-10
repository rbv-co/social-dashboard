package core

import "time"

type decisao struct {
	repetir bool
	esperar time.Duration
	motivo  string
}

// decidir é a política de supabase/functions/_shared/tentar-de-novo.js (medida em 18/08/2026):
// 404/403/4xx é RESPOSTA e não se repete; 429, 5xx e "sem resposta" (status 0) se repetem
// até 3 tentativas, com espera de 600 ms e 1200 ms (ou o Retry-After do 429, se maior), e
// nunca se começa uma tentativa que não cabe inteira no orçamento.
func decidir(tentativa, status int, decorrido, retryAfter, prazo, orcamento time.Duration) decisao {
	if status > 0 && status < 400 {
		return decisao{motivo: "deu certo"}
	}
	if status != 0 && status != 429 && status < 500 {
		return decisao{motivo: "o Bling respondeu, e a resposta é essa"}
	}
	if tentativa >= 3 {
		return decisao{motivo: "já tentei 3 vezes"}
	}
	esperar := (600 * time.Millisecond) << (tentativa - 1)
	if status == 429 && retryAfter > esperar {
		esperar = retryAfter
	}
	if decorrido+esperar+prazo > orcamento {
		return decisao{motivo: "não caberia outra tentativa no tempo desta chamada"}
	}
	motivo := "o Bling falhou do lado dele"
	switch status {
	case 0:
		motivo = "o Bling não respondeu no prazo"
	case 429:
		motivo = "o Bling pediu para esperar"
	}
	return decisao{repetir: true, esperar: esperar, motivo: motivo}
}
