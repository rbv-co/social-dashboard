package arquivos

import (
	"bytes"
	"errors"
)

// GravarDoServidor grava (upsert) um objeto por código do servidor, sem sessão: a foto do Zoho que o proxy do Acessos
// importa (Plano 07a). Quem chama já passou pelo portão do proxy (is_acessos_admin); aqui seguem valendo o tamanho e o
// tipo do bucket, e o caminho passa pela mesma conferência de toda gravação.
func (s *Servico) GravarDoServidor(bucket, caminho, tipo string, corpo []byte) error {
	s.iniciar()
	b, ok := s.buckets[bucket]
	if !ok || !caminhoValido(caminho) {
		return errors.New("arquivos: bucket ou caminho inválido")
	}
	return s.gravar(b, caminho, tipo, bytes.NewReader(corpo), true)
}
