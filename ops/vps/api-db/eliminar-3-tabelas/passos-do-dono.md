# Passos que só o dono pode fazer (plano 05 C) — token da Shopify e cópias do Drive

A tabela `estoque_do_site_estado` guarda, na chave do token, **um token de acesso da Shopify** (e um mapa SKU→id do Bling). A cópia diária do banco (`guardar-copia-do-banco.mjs`) copiou esse valor em texto puro para o Drive até este plano (a lista `SEM_O_VALOR` só protegia `bling_tokens`, `segredos_de_cron`, `acessos_conexoes`, `accounts`, `usuarios`). Eliminar a tabela NÃO apaga as cópias que já saíram. Faça, nesta ordem:

## 1. Trocar o token na Shopify (você; eu não toco)
1. Admin da Shopify da loja → Configurações → Apps e canais de vendas → **Desenvolver apps** (ou a "app personalizada" que o robô de estoque usava).
2. Abra o app (provavelmente "Estoque do site"/"Vessel") → **Credenciais da API** → anote qual escopo tinha (`read_inventory`, `write_inventory`, `read_products` ou similar).
3. **Revogue/desinstale** o token de acesso antigo (botão "Revogar token" ou "Desinstalar app"). Isto invalida o que ficou nas cópias.
4. Se algum robô VIVO usa a Shopify (o `trazer-pedidos-da-shopify` roda de hora em hora, com `SHOPIFY_ACCESS_TOKEN` ou `SHOPIFY_CLIENT_ID`+`SHOPIFY_CLIENT_SECRET`): confira **qual** credencial ele usa antes de revogar (`/etc/robos.env` na VPS; não imprima o valor). Se for o MESMO token, gere o novo e atualize `/etc/robos.env` no mesmo minuto, senão o robô passa a tomar 401. Se for outro, nada a atualizar.
5. Teste: o robô seguinte (`/var/log/robos/pedidos-da-shopify.log`) termina sem `401`.

## 2. Limpar as cópias diárias do Drive/Zoho WorkDrive que já contêm o token
1. Abra no Zoho WorkDrive a pasta **`00. Copias de seguranca da Central`**: `diario/AAAA-MM-DD/` (até 30) e `mensal/AAAA-MM/` (até 12; a cópia mensal também leva essa tabela, não é dado de cliente).
2. Em cada pasta que tenha `estoque_do_site_estado.jsonl`, **apague só esse arquivo** (o resto da cópia vale). O `manifesto.json` da pasta ainda listará a tabela com a soma de verificação; a restauração dessa tabela deixa de conferir, e ninguém precisa dela (a tabela será eliminada).
3. Esvazie a lixeira do WorkDrive (apagar sem esvaziar deixa o token recuperável).
4. Confirme que as cópias NOVAS já saem sem o valor: depois do merge deste plano, abra a cópia do dia seguinte e veja que `estoque_do_site_estado.jsonl` traz `"valor": "(fora da copia: e credencial)"`.
5. Se houver cópia fora do WorkDrive (disco do Mac, pen drive, e-mail), o mesmo vale.

Quando os dois passos estiverem feitos, avise a orquestradora: é a pré-condição 4 do `runbook-drop.md`.
