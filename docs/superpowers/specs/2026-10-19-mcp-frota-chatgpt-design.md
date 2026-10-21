# MCP da Central para o ChatGPT (nasceu MCP da Frota)

## 21/10: revisão e responsável

Decisões do dono (21/10), para o gestor da Frota fazer pelo ChatGPT o que faz na tela:

- `lancar_manutencao` vira "Registrar revisão ou manutenção" (nome interno mantido: o ChatGPT conectado guarda a
  lista), casa o nome do item com o plano e traz as travas de `lancamento-de-manutencao.js` (PR #450).
- `trocar_responsavel` (nova): passar, devolver, recolher, trocar e tirar o dono fixo, pela mesma
  `POST /frota/usos/trocar` da tela, com as regras de `posse.js`. Uma diferença deliberada: posse aberta de alguém de
  fora (sem `pessoa_id`) também conta como empréstimo na troca do dono; `trocarDonoFixo` da tela a entrega ao dono
  novo (dívida registrada na tela).
- Continua fora: checklist e assinatura (são físicas). A aba Relatórios é só tela (`frota.relatorios`); os dados ela
  lê pelas mesmas rotas que o MCP consulta.

## 20/10: a Central inteira

Decisão do dono (20/10): "ele deve ser autônomo a todo painel, desde que o usuário logado tenha permissão". Muda:

- **Quem liga:** qualquer conta do painel (`SoPainel`: sessão de tipo `painel`, nunca "entrar como" nem cliente da
  Vessel). O portão de gestor da Frota saiu: o que o ChatGPT alcança é o que a permissão da pessoa alcança, rota a rota,
  na hora (tirar a permissão vale já).
- **O que alcança:** `web.Rotas` monta as rotas de domínio por uma função só (`dominio`), que o painel e o MCP usam.
  Rota nova de domínio entra no MCP sem mexer nele. Fora: contas, convites, senhas, "entrar como" e os proxies
  externos (Meta, Bling, Acessos), que não são domínio.
- **Ferramentas genéricas** (`internal/mcp/catalogo.go`): `catalogo` (áreas → tabelas → filtros, ordens, campos de
  criar/editar, apagar; `area=rpc` lista as funções), `consultar`, `criar`, `editar`, `apagar`, `executar_rpc`.
  O mapa sai do que a API já declara: a rota de cada tabela do contrato da tela (`contrato_front.json`, embutido), os
  filtros/ordens/campos das declarações das rotas (`dados.Declaradas`, anotado em `Consulta.Handler`, `RotaCriar`,
  `RotaEditar`, `RotaApagar`) e as RPCs da lista branca. A escrita segue a convenção de `banco-pela-api.js`.
  `editar`, `apagar` e `executar_rpc` vão com `destructiveHint` (o ChatGPT pede confirmação).
- **Frota** (as 13 ferramentas próprias continuam): `listar_veiculos` com `busca`, `situacao` e `estado` (livre,
  fixo, na_rua, reservado, oficina, parado, fora_da_frota, a régua do selo da tela); `listar_usos` com `tipo`;
  `pedir_carro` exige para quem é (cadastro de colaboradores; de fora só com `de_fora=true`).
- Resposta sem campos nulos e com teto de 60 KB (o modelo refaz com filtro).

O resto deste documento é o desenho de 19/10 (OAuth, sessão `mcp`, travas da Frota), que segue valendo.

Data: 2026-10-19 · Estado: implementado na branch `worktree-mcp-frota-gpt`, merge só depois de D+1 da virada.

## Decisões do dono (19/10)

1. Base: **API Go** (a virada Supabase → Go é hoje, 22h40; uma edge do Supabase morreria na janela).
2. Quem usa: **só gestores da frota** = quem vê a aba Gestão da tela (`areas-da-frota.js`: `frota` com `criar` ou `excluir`). Motorista (`frota` só com `ver`/`editar`) não passa, mesmo tendo `is_frota_admin()`.
3. Consulta de tudo da frota; edição de **abastecimentos, requisições, manutenções/plano de revisão e dados do veículo**. Fora: checklist e assinatura (é física), cadastrar ou apagar carro (sincronia com o Patrimônio), qualquer DELETE.

## Arquitetura

O ChatGPT (Developer Mode → Apps) fala MCP remoto com OAuth. Tudo mora na API Go, pacote `internal/mcp`:

- **OAuth 2.1** (servidor próprio, sem dependência nova):
  - metadados: `GET /.well-known/oauth-protected-resource[/mcp]` (RFC 9728) e `GET /.well-known/oauth-authorization-server` (RFC 8414); `issuer` = `API_URL_PUBLICA`.
  - `POST /oauth/registrar` (RFC 7591, cliente público, sem segredo). `redirect_uris` só https em hosts permitidos (`chatgpt.com`, `chat.openai.com`): é a defesa contra phishing, porque o nome do cliente é escolhido por quem registra.
  - `GET /oauth/autorizar` valida cliente, `redirect_uri` exato e PKCE `S256` e manda para a tela `/oauth/consentimento` do front com os mesmos parâmetros. Pedido inválido não redireciona (erro na própria página: sem open redirect).
  - `POST /oauth/decidir` (com a sessão do painel): revalida tudo, exige gestor e sessão própria (nada de "entrar como"), grava o código (hash SHA-256, 10 min, uso único) e devolve a URL de volta. Negar devolve `error=access_denied`.
  - `POST /oauth/token`: `authorization_code` (PKCE) e `refresh_token` (rotativo; reuso de refresh já trocado revoga a família).
  - O token de acesso é uma linha de `sessoes` com `tipo = 'mcp'` (12 h, mesma renovação deslizante). `auth.Exigir` já nega todo tipo fora de painel/serviço: o token do ChatGPT **não abre nenhuma outra rota da API**.
- **`POST /mcp`** (Streamable HTTP sem estado, resposta JSON): `initialize`, `ping`, `tools/list`, `tools/call`. Sem token ou token inválido = 401 com `WWW-Authenticate: Bearer resource_metadata=...`.
  - A cada chamada: sessão `mcp` válida (conta ativa), ator carregado como painel, portão de gestor.
  - Cada ferramenta vira uma requisição **interna** ao roteador da frota (`frota.Montar` atrás de `autz.ComEscopo`): mesma autorização do catálogo, mesmos gatilhos, mesmas frases de erro. Nenhuma regra é reescrita.
  - Travas que só existiam na tela entram na ferramenta: abastecimento com KM menor que o último conhecido ou data no futuro é recusado; preço por litro fora de R$ 1–15 volta como aviso (D39).
  - Decidir requisição (aprovar/recusar) dispara o mesmo aviso que a tela (`/avisar-decisao-de-reserva`); falha do aviso não desfaz a decisão.

## Ferramentas

Leitura (`readOnlyHint`): `listar_veiculos`, `listar_usos`, `listar_requisicoes`, `listar_abastecimentos`, `listar_revisoes`, `ver_plano_de_revisao` (13 ferramentas no total, com as 7 de escrita).
Escrita (o ChatGPT pede confirmação): `editar_veiculo`, `registrar_abastecimento`, `pedir_carro`, `decidir_requisicao`, `lancar_manutencao`, `criar_item_do_plano`, `editar_item_do_plano`.

Dinheiro entra em reais na ferramenta e vai em centavos para a rota.

## Fora de escopo e dívida registrada

- Tela para revogar conexões: hoje revoga quem apagar as linhas de `sessoes` (tipo `mcp`) e `oauth_refresh` do usuário.
- Limites em memória (por instância), como os demais da API.

## Ligar (depois de D+1)

1. Merge e deploy da API (migration `00012` sobe junto) e do front.
2. nginx: reinstalar `ops/vps/api/nginx-central-api.conf` (ganhou os dois `/.well-known/oauth-*` da raiz) em `/etc/nginx/snippets/central-api.conf`, `nginx -t` e `reload`.
3. ChatGPT (Plus/Pro/Business): Settings → Apps → Advanced → Developer mode; criar app com URL `https://socialdashboard.rbvcompany.com/api/mcp`, autenticação OAuth. O domínio tem de ser o da `API_URL_PUBLICA` do `/root/secrets/api.env` (hoje `socialdashboard.`): é o `issuer`, e o cliente recusa metadados de outro host.
