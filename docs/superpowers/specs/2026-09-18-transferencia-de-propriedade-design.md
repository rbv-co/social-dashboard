# Transferência de propriedade da peça (Registered Pieces) — desenho

**Decidido pelo dono em 18/09/2026.** A dona atual libera a transferência com um
código de 6 dígitos; a nova dona digita o código na página da peça e a peça passa
para o nome dela.

## O que a cliente vê

1. A dona abre a peça (já registrada no nome dela) e toca em **"Transferir esta
   peça"**.
2. A tela mostra o **código de 6 dígitos**, a data em que vence e o aviso: "Vale
   por 7 dias. Passe este código só para quem vai ficar com a peça." Tem botão de
   copiar e botão de cancelar.
3. Quem recebe abre a página da peça, cria conta ou entra, toca em **"Recebi esta
   peça"** e digita o código.
4. A peça passa para o nome dela na hora. A garantia **mantém a data original**.
   A página **não** mostra nada sobre a dona anterior.

## Regras

- O código vale **uma vez só**; é apagado (marcado como usado) ao ser aceito.
- Validade de **7 dias** a partir da geração.
- A dona pode **cancelar**; gerar um novo cancela o anterior (no máximo um convite
  aberto por peça).
- Se a peça trocar de dona por qualquer outro caminho (painel), o convite aberto
  perde a validade.
- **Teto de 5 tentativas erradas por peça a cada 24h.** Estourou, a resposta é
  sempre "código inválido", sem calcular nada.
- Quem digita errado vê só "código inválido" — nunca "existe convite", nunca o
  nome de ninguém.
- A dona não pode transferir para si mesma (resposta `sua_ja`).
- Fica na trilha (`vessel_edicoes`) quem transferiu, quando e para quem.

## Banco

Tabela `vessel_transferencias`:

| coluna | o que é |
|---|---|
| `id` | uuid, chave |
| `peca_codigo` | o código da peça (mesmo formato normalizado das outras tabelas) |
| `cliente_de` | conta da dona que gerou |
| `codigo_hash` | o código de 6 dígitos guardado com `extensions.crypt`/`gen_salt` — nunca em texto |
| `criado_em`, `vale_ate` | now() e now() + 7 dias |
| `usado_em`, `cliente_para` | preenchidos ao aceitar |
| `cancelado_em` | preenchido ao cancelar |

Índice único parcial: no máximo **um** convite aberto por peça
(`usado_em is null and cancelado_em is null`).

Tabela de tentativas: reaproveitar o padrão de `vessel_tentativa_de_presente`
(teto no banco, chave normalizada, janela de 24h), com teto 5.

Funções (todas `security definer`, `set search_path`, fechadas para `anon` e
`authenticated`, liberadas para `service_role`, como as irmãs do selo):

- `vessel_transferencia_gerar(p_token text, p_codigo text)` → json
  `{ok, codigo_transferencia, vale_ate}` — só se a sessão for a **dona atual** da
  peça; cancela convite aberto anterior.
- `vessel_transferencia_aberta(p_token text, p_codigo text)` → json
  `{ok, tem, vale_ate}` — sem devolver o código (ele só aparece na geração).
- `vessel_transferencia_cancelar(p_token text, p_codigo text)` → json `{ok}`.
- `vessel_transferencia_aceitar(p_token text, p_codigo text, p_codigo_transferencia text)`
  → json `{ok, garantia_ate}` — confere o teto, o prazo, o hash e que a dona
  atual ainda é `cliente_de`; troca a dona mantendo `garantia_ate`,
  `comprado_em`, `pedido_id` e `bling_pedido` do registro.

A troca da dona reaproveita o caminho que o painel já usa (`vessel_trocar_dono`)
ou grava direto em `vessel_registros`, o que preservar a garantia sem mexer na
função do painel — a decisão fica para quem implementa, medindo a função que está
no banco.

## Robô (edge `vessel-conta`)

Ações novas, todas com `token` de sessão:

| ação | manda | responde |
|---|---|---|
| `transferir-gerar` | `codigo` (da peça) | `{ok:true, codigo_transferencia, vale_ate}` |
| `transferir-aberta` | `codigo` | `{ok:true, tem, vale_ate}` |
| `transferir-cancelar` | `codigo` | `{ok:true}` |
| `transferir-aceitar` | `codigo`, `codigo_transferencia` | `{ok:true, garantia_ate}` |

Motivos de recusa: `sem_sessao`, `nao_e_sua`, `sua_ja`, `codigo_invalido`,
`muitas_tentativas`, `falhou`. O código de transferência **nunca** vai para log.

## Páginas

- **/verify/novo (teste):** botão "Transferir esta peça" na peça registrada da
  dona; folha com o código, copiar, validade e cancelar; botão "Recebi esta peça"
  com o campo de 6 dígitos para quem não é a dona.
- **Certificado real (/verify):** só depois que o dono aprovar nos testes.
- **Painel:** mostra na peça se há convite aberto e permite cancelar.

## Fora deste desenho

Transferência por link ou por e-mail, aviso por push, e histórico de donas
visível para a cliente.
