// Package config lê a configuração do processo a partir de variáveis de ambiente.
package config

import (
	"errors"
	"os"
	"strings"
)

type Config struct {
	Addr        string
	DatabaseURL string
	Origens     []string // CORS: usado quando as rotas públicas entrarem (plano da Vessel)
}

func Carregar() (Config, error) {
	c := Config{Addr: os.Getenv("ADDR"), DatabaseURL: os.Getenv("DATABASE_URL")}
	if c.Addr == "" {
		c.Addr = ":8080"
	}
	if c.DatabaseURL == "" {
		return c, errors.New("DATABASE_URL ausente")
	}
	for _, o := range strings.Split(os.Getenv("ORIGENS_PERMITIDAS"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.Origens = append(c.Origens, o)
		}
	}
	return c, nil
}
