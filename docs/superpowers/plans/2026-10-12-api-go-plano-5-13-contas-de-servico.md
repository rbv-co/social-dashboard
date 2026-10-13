# Plano 5.13 — Contas de serviço (tokens dos robôs)

> Sub-plano da migração Supabase → Go (plano-mãe `2026-10-11-api-go-plano-5-dominios.md`; spec §4 "Contas de serviço"). Trilha A. Pedido da trilha C (inventário do `coletor/`, item 1) e da trilha B (5.8: rotas de robô da Fábrica). Decisão da orquestradora (12/10): **perfil próprio por robô, sem escopos por token**.

**Objetivo:** os robôs do `coletor/` (Fábrica no Actions, os 6 híbridos da VPS e os validadores da Meta) chamam a API em Go com `Authorization: Bearer <token>` de longa duração, revogável, e recebem `Ator{Tipo:"servico"}` com o PERFIL do usuário do robô — catálogo, módulo e conta valem como para gente; o menor privilégio é o perfil.

## Contrato

- **Tabela** (migração goose `00006_tokens_de_servico.sql`, da API, não do dump): `tokens_de_servico (id uuid pk default gen_random_uuid(), usuario_id uuid not null references usuarios(id) on delete cascade, nome text not null unique check (nome ~ '^[a-z0-9][a-z0-9-]{1,62}$'), token_hash text not null unique, criado_em timestamptz not null default now(), revogado_em timestamptz, ultimo_uso_em timestamptz)`. Só o HASH (sha256, o mesmo `hashDoToken` das sessões) é gravado.
- **Token:** `srv_` + 32 bytes aleatórios em base64url. Impresso UMA vez pelo CLI.
- **`auth.Exigir`** (e `Store.Buscar`): o Bearer é procurado em `sessoes`; não achando, em `tokens_de_servico` com `revogado_em is null`, usuário sem `desativado_em` e perfil sem `disabled`. Achou → `Sessao{UsuarioID, Tipo:"servico"}` sem expiração e sem renovação; `ultimo_uso_em` atualizado no máximo a cada 5 min. Revogado, usuário ou perfil desativado → 401 como sessão inválida. O caminho de sessão normal não muda.
- **`auth.SoServico`**: middleware para as rotas de robô (5.8): ator de tipo diferente de `servico` → `403 {"error":"sem_permissao"}`.
- **CLI** (no binário `api`, rodado na VPS): `api servico criar <nome> <email> [--modulos a,b]` — se o e-mail não existir, cria `usuarios` (SEM senha) + `profiles` (`role 'viewer'`, `features` = `--modulos`, `disabled false`, `allowed_accounts` nulo); se existir, usa o usuário (recusa se ele tiver senha: conta de gente não vira robô). Imprime o token uma vez. `api servico revogar <nome>` (marca `revogado_em`), `api servico listar` (nome, e-mail, criado, último uso, revogado; nunca o token).
- **Sem rota HTTP** de criação/revogação (CLI na VPS, como o resto da operação).
- **`status-projetos` aposentado** (Ruling 39): sem rota de escrita de `projetos_status`.

## Testes de aceitação

- Token válido → `GET /auth/eu` 200 com `tipo:"servico"`, `papel` e permissões do perfil do robô; `ExigirModulo` passa só nos módulos do perfil (403 no resto).
- Revogado → 401; usuário com `desativado_em` → 401; perfil `disabled` → 401; token inexistente → 401; token de sessão normal continua funcionando igual.
- `SoServico`: sessão de painel → 403; token de serviço → passa; sem sessão → 401 (do `Exigir`).
- Banco não guarda o token em claro (busca do texto do token em `tokens_de_servico` = 0 linhas).
- `ultimo_uso_em`: duas chamadas seguidas gravam uma vez (relógio injetado).
- CLI: `criar` imprime token que funciona; nome repetido → erro; e-mail de usuário com senha → erro; `listar` não imprime token; `revogar` derruba na próxima chamada.
- Mutações que têm de reprovar: aceitar token revogado; esquecer o filtro de perfil desativado; renovar/expirar a sessão de serviço como a de painel; `SoServico` aceitando `painel`.

## Arquivos

Create `api/internal/banco/migracoes/00006_tokens_de_servico.sql`, `api/internal/auth/servico.go`, `api/internal/auth/servico_test.go`, `api/cmd/api/servico.go`, `api/cmd/api/servico_test.go`. Modify `api/internal/auth/sessoes.go` (fallback do `Buscar`), `api/cmd/api/main.go` (subcomando), `docs/migracao-go/NOTAS-DA-IMPLANTACAO.md` (seção 5.13: como criar o robô e o token na VPS, rotação, revogação; robôs mandam `Authorization: Bearer`), `docs/migracao-go/API-PRONTA.md` (seção "Contas de serviço (5.13)"), plano-mãe (Rulings 38 e 39).

## Rulings

38. Ruling: conta de serviço = usuário com PERFIL próprio (viewer, `features` mínimas, sem senha) + `tokens_de_servico` (hash sha256, sem expiração, revogável, CLI na VPS), sem escopos por token — decisão da orquestradora (12/10): o perfil já é o menor privilégio e todas as regras (catálogo, módulo, conta) valem sem caminho especial em `autz` — custo se errada: um robô lê o que o perfil viewer lê (as policies `true` a sessões, como a lista de perfis).
39. Ruling: o robô `status-projetos` é aposentado e `projetos_status` não ganha rota de escrita — o quadro de projetos saiu da tela em 19/08/2026 (`tela-de-status-claude.vue:703`) e ninguém lê a tabela — custo se errada: se o quadro voltar, uma rota de upsert só para serviço resolve.
