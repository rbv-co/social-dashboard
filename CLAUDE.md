# Central de Inteligência RBV

## ANTES DE ESCREVER QUALQUER LINHA

Leia **[PADRAO-DA-CENTRAL.md](PADRAO-DA-CENTRAL.md)**. Ele é obrigatório e vale
para toda tela, toda ferramenta nova e todo ajuste em tela existente.

Cada regra de lá está lá porque um defeito real chegou às mãos do dono. Não é
guia de estilo opinativo: é a lista do que já quebrou.

O resumo, se você só ler uma linha: **nada de jeitinho.** Cor sai de token, botão
tem três tipos e só, texto nunca corta, e toda entrega se mede a 375px num
navegador de verdade — não se deduz.

## Como rodar

```bash
npm test                            # suíte inteira
npm run build                       # build de produção
npm run dev -- --port 5199 --strictPort   # porta fixa: há mais de uma janela neste repositório
```

`coletor/.env` é gitignored e não vem em worktree novo — copie do checkout
principal, senão dois testes da fábrica falham por credencial ausente.

## ⚠️ ANTES DE PUBLICAR EDGE FUNCTION (`supabase functions deploy`)

**Mais de uma pessoa publica robô neste projeto, cada uma do próprio computador.**
Quem publica por último VENCE — a Supabase não avisa, não junta, não guarda a
versão anterior. `git push` não publica edge; a publicação é outra porta, e ela
não olha o GitHub.

Isso já apagou trabalho no ar. Em 14/09/2026 a `vessel-espelhar-lista` foi
republicada com o código da `main`, e a versão que estava rodando (a trava do
"espelho ao vivo", de 12/09) só existia num worktree que nunca tinha subido. O
banco ficou na versão nova e o robô na velha — sem erro nenhum aparecendo.

**A regra, sem exceção:**

1. **`git fetch` e partir do `origin/main` atualizado.** Publicar de branch
   atrasada apaga o que outra pessoa publicou depois.
2. **Só se publica o que JÁ ESTÁ na `main`.** Código publicado que não está no
   GitHub some na próxima publicação de outra pessoa.
3. **Comparar o que está no ar com o que vai subir, arquivo por arquivo:**
   ```bash
   npx supabase functions download <nome> --project-ref kounqtdoioootxqegkij --use-api --workdir /tmp/no-ar
   ```
   e comparar cada arquivo com `shasum -a 256` contra o do repositório. Se
   algum DIFERE, **pare e descubra quem publicou aquilo** (o
   `entrypoint_path` no painel mostra o computador de origem) antes de
   sobrescrever.
4. **`_shared/` é de todos.** Mexer em `_shared/segredo-de-cron.ts` muda o
   portão de 12 robôs. Publicar UM robô leva a cópia dele de `_shared`; os
   outros só mudam quando forem republicados.
5. **`verify_jwt` dos robôs de cron fica DESLIGADO.** O `--use-api` pode ligar
   sozinho, e o cron passa a tomar 401 calado. Conferir antes e depois; para
   manter, use `--no-verify-jwt` (a tranca de verdade é o segredo do cron — ver o
   cabeçalho de `_shared/segredo-de-cron.ts`).
6. **Depois de publicar, chamar o robô** com `Authorization: Bearer errado`:
   tem de voltar `401 {"error":"nao_autorizado"}` da própria função. `503
   BOOT_ERROR` = subiu quebrado.

## Onde ficam as coisas

| | |
|---|---|
| Padrão obrigatório | `PADRAO-DA-CENTRAL.md` |
| Tokens (cor, espaço, fonte, botões) | `src/estilos/estilos-globais.css` |
| Telas | `src/ferramentas/<ferramenta>/` |
| Lógica pura + teste ao lado | `src/ferramentas/<ferramenta>/*.js` + `*.test.mjs` |
| Edge Functions | `supabase/functions/` |
| Robôs e scripts | `coletor/` |
| Desenhos e planos | `docs/superpowers/{specs,plans}/` |
