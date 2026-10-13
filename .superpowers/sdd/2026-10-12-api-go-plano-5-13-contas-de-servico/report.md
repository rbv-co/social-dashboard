# Relatório — Plano 5.13 (contas de serviço)

## Feito
- Migração `00006_tokens_de_servico.sql` (tabela conforme o contrato; só o hash sha256).
- `api/internal/auth/servico.go`: `Store.buscarServico`, `CriarContaDeServico` (transação: usuário sem senha + perfil viewer com `features` = `--modulos`, ou usuário existente; recusa usuário com senha, super-admin, sem perfil e `--modulos` em usuário existente), `RevogarServico`, `ListarServico`, `auth.SoServico`.
- `Store.Buscar` (sessoes.go): procura em `sessoes`; só se não achar E o token tiver prefixo `srv_` cai em `tokens_de_servico` (uma consulta a mais apenas para robô; sessão de painel não muda; token com outro formato nem toca a tabela de serviço). A sessão de serviço volta com `ExpiraEm` zero e NÃO passa pela expiração/renovação; `ultimo_uso_em` num único UPDATE condicional (no máximo a cada 5 min, relógio injetável). Hash comparado por igualdade de sha256 no WHERE, como as sessões.
- CLI `api servico criar|revogar|listar` (`cmd/api/servico.go`, ligado em `main.go`); o token sai sozinho no stdout, instruções no stderr, nada em log.
- Docs: NOTAS (seção Plano 5.13), API-PRONTA (seção Contas de serviço + estado), plano-mãe (Rulings 38 e 39).

## TDD
- RED: `go vet` dos pacotes `auth` e `cmd/api` com símbolos indefinidos (`CriarContaDeServico`, `servicoComando`) antes da implementação.
- GREEN: testes novos passam (auth: `TestServico*`, `TestSoServico`, `TestContaDeServico*`; cmd/api: `TestServicoCLI`).
- Mutações (cada uma reprovou, código restaurado e conferido por diff):
  1. aceitar token revogado -> `TestServicoTokenInvalidoDa401`
  2. esquecer o filtro de perfil `disabled` -> `TestServicoTokenInvalidoDa401`
  3. renovar (`ExpiraEm = agora+TTL`) -> `TestServicoNaoExpiraNemRenova`; expirar como painel -> idem
  4. `SoServico` aceitando `painel` -> `TestSoServico`
  5. extra: gravar `ultimo_uso_em` a cada chamada -> `TestServicoUltimoUsoGravaNoMaximoACada5Min`

## Validação (Postgres 17 próprio na porta 58513, removido ao fim)
- `gofmt -l .` vazio; `go vet ./...` ok; `go test -race -p 1 -count=1 -timeout 40m ./...`: 27 pacotes ok, nenhuma falha (inclui internal/meta).

## Não verificado
- Não rodado contra o banco restaurado de produção: `profiles.allowed_accounts` é `uuid[]` lá (o CLI não a preenche; fica nula) e `escopo_por_equipe` tem default `true` (serviço não é limitado a loja de qualquer forma, `canais/banco.go`).
- Rotas de robô (5.8) usarão `auth.SoServico`; nenhuma rota o usa ainda.
