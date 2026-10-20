# Contrato: lista de espera (Central) × pop-up (Core)

Plano 07 da INTEGRACAO-CORE-2026-10 (20/10/2026). Mesma página em `social-dashboard/docs/` e `vessel-core-go/docs/`.

## Quem é dono de quê

| Dado | Dono | Tabela | Observação |
|---|---|---|---|
| A pessoa na lista, objetivo, visita, senha, UTM, `bling_id`, `planilha_em` | **Central** | `vessel_lista_espera` (api-db, Postgres) | índice único `lower(email)` |
| Captura bruta do pop-up, **consentimento**, **descadastro**, e-mail, aviso ao Chatwoot | **Core** | `leads_popup` (core-db, MySQL) | a Central **não** lê nem copia `leads_popup`; recebe só a pessoa |
| Resultado do repasse do formulário do site/loja | Core | `cadastros_site` | log do repasse, não duplica a lista |
| Contato da pessoa no Bling | Bling (token e cota do **Core**) | — | criado pela Central, **pelo proxy do Core** |

**Chave comum: `lower(trim(email))`.** Não existe id compartilhado e não se cria um.

## Direção e comportamento

- **Core empurra para a Central**, pela mesma RPC do site (`vessel_entrar_na_lista`, `origem='popup-loja'`, UTM e `clique_meta` do rastreio, `aceite_versao` = versão do consentimento). Idempotente por e-mail: quem já está na lista volta `ja_na_lista`.
- A captura **nunca** falha por causa da Central: o repasse roda depois de gravar, em segundo plano. Uma **varredura** (`leads:central`, agendador, a cada 5 min) repete o que não confirmou: espera 60/300/900/3600 s, teto de 5 tentativas.
- Só `na_lista` / `ja_na_lista` contam como entregue. **`reservado` não** (é o "ok" de mentira da Central para teto por IP ou robô, e não grava nada). `invalido` = `central_status='recusado'`, não repete.
- **Descadastrado nunca é repassado** (`central_status='descadastrado'`). Descadastrar depois de entregue não remove a pessoa da lista da Central (a lista não é a base de e-mail do pop-up; remoção é decisão manual).
- **Teto batido não some em silêncio:** com 5 tentativas (~81 min de Central fora) o lead para de ser repetido e a tarefa `leads:central` passa a FALHAR (visível na saúde do agendador) até alguém resolver. Passo manual: confirmar que a Central responde e rodar `UPDATE leads_popup SET central_tentativas = 0 WHERE central_status IS NULL AND origem = 'popup-loja'`; a varredura seguinte repete.
- Quem já está na lista e entra de novo pelo pop-up antes de concluir o passo 2 da LP tem a senha trocada pela RPC (comportamento da própria RPC, igual a reenviar o formulário do site).
- Estado em `leads_popup`: `central_status` (NULL = pendente), `central_em`, `central_erro` (sem dado pessoal), `central_tentativas`, `central_tentou_em`. Flag: `LEADS_CENTRAL_ATIVO` (padrão desligada; desligar para a ponte, as colunas ficam).
- Só `origem='popup-loja'` é repassada (as linhas `teste-interno` não).
- **Central fora:** `central_status` fica NULL, a varredura repete, nenhum lead se perde e a resposta do pop-up não muda. **Core fora:** o formulário LP/loja já repassa direto à Central; o pop-up não captura (é o que existe hoje).

## Contato no Bling

Robô `coletor/vessel-contatos-no-bling.mjs` (VPS, cron de 1 min, flag `VESSEL_CONTATOS_BLING`): para cada linha com `bling_em` nulo, procura o contato por e-mail (confere o detalhe) e reaproveita; senão cria pelo proxy do Core com `idempotency_key` estável (`vessel-lista:<id>:contato-criar:<hash do corpo>`). 504/incerto não reenvia; 400 é definitivo; 429/5xx/timeout repete até 5 vezes. O estado fica em `ultimo_erro`, em texto que começa por `bling ` (a planilha usa a mesma coluna e não o apaga). Marca de origem no `codigo` do contato: `LP-` / `PV-` / `PP-` (pop-up) + `AAAAMMDD-<id>`.

## Planilha

O robô `espelho-da-vessel-na-vps.mjs` marca `planilha_em` (só das linhas criadas até o instante em que a rodada começou a ler) e grava o motivo em `ultimo_erro` quando falha. Depende da conexão do Zoho em `acessos_conexoes` (reconectar é passo do dono).

## O que NÃO é deste contrato

O workflow n8n do RD (`OWv78JhWKGS5x7br`) foi arquivado em 20/10/2026: apontava para o Supabase antigo e foi substituído pelo `leads_popup` do Core.
