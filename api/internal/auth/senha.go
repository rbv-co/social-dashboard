package auth

import "golang.org/x/crypto/bcrypt"

func HashDaSenha(senha string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(senha), bcrypt.DefaultCost)
	return string(b), err
}

// SenhaConfere aceita o hash bcrypt como o GoTrue o gravou ($2a$...).
func SenhaConfere(hash, senha string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(senha)) == nil
}
