package web

import _ "embed"

// contratoDaTela: como a tela fala com a API, tabela por tabela (rota, chave, linha única, área). Gerado do front
// por src/compartilhado/extrair-contrato-front.mjs e conferido contra este roteador em contrato_front_test.go; o MCP
// da Central acha por ele a rota de cada tabela (o mesmo mapa da tela, nunca um segundo à mão).
//
//go:embed testdata/contrato_front.json
var contratoDaTela []byte
