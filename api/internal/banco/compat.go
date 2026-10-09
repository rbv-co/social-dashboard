package banco

import _ "embed"

// Compat é o SQL da camada de compatibilidade (ver compat/compat.sql). É idempotente.
//
//go:embed compat/compat.sql
var Compat string
