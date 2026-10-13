# Task 2 — frota: fundação (mundo de teste, portão de impersonado, ajudantes)

Arquivos: `api/internal/frota/dominio.go`, `dominio_test.go`, `mundo_test.go` (os do Plano 4 intactos).

## Divergências do brief (código atual manda)
- Mundo sobre `testebanco/mundoteste` (5.2), não sobre um `novoMundo` próprio; `caso = mundoteste.Caso`; `novoMundo` devolve `*mundoteste.Mundo` (`Pedir/Um/Rodar/P/Tok`), sem `resposta/pedir/um/rodar` locais.
- `impersonado` via `Opcoes.Impersonadas` (alvo = motorista, por = superFicha, que é super pela FICHA).
- `soSessaoPropria` = `dados.SoSessaoPropria(dados.FraseEntrarComo)` (padrão do 5.2), em vez de middleware próprio. Frase: "Quem entrou como outra pessoa só consulta." (contém "Quem entrou como outra pessoa", que é o que o teste confere).
- `naLinha` sem o `if rc != nil` do brief: fora de rota chi é pânico visível, não fallback silencioso.
- `desativado`: `mundoteste.Novo` cria a sessão sem erro; o 401 vem do `Store.Buscar` (provado em `TestMundoDaFrota`).
- Trava (`escopo_por_equipe`) não é usada na Frota (regra = `is_frota_admin()`), pessoas ficam sem trava.
- Acrescentei `TestFotoDaFrotaCobreTodasAsTabelas` (as 14 `frota_*` do esquema e `patrimonio_bens` estão na foto; a foto muda com uma linha), `TestVazio`, `TestNaLinha`, `TestDeve`.

## TDD
RED: `go vet ./internal/frota/` → `undefined: soSessaoPropria` (sem dominio.go). GREEN: todos os testes do pacote (os do Plano 4 inclusive).

## Mutações (todas derrubam testes; revertidas)
1. portão passa-tudo → `TestSoSessaoPropria` FAIL.
2. mundo sem `autz.ComEscopo` → `TestMundoDaFrota` FAIL.
3. impersonado por não-super (par = {motorista, viewer}) → `TestMundoDaFrota` e `TestSoSessaoPropria` FAIL (o Store recusa).
4. motorista sem o módulo `frota` → `TestMundoDaFrota` FAIL.
5. foto sem `frota_abastecimentos` → `TestFotoDaFrotaCobreTodasAsTabelas` FAIL.

## Validação final (em `api/`, Postgres 17 próprio na porta 58663, contêiner removido)
`gofmt -l .` vazio; `go vet ./...` ok; `go test -race -p 1 -count=1 -timeout 40m ./...` sem nenhuma falha (internal/meta passou na bateria, sem precisar rodar isolado).
