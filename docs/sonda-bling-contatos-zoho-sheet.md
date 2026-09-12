
---

## 29/08/2026 — PERMISSÃO CONCEDIDA, e o que ela revelou

O dono reautorizou o Bling com contatos e canais de venda. Vieram **38 escopos**
(eram 21) e os cinco endpoints que importam responderam 200: `/produtos`,
`/contatos`, `/canais-venda`, `/produtos/lojas`, `/estoques/saldos`.

### Três defeitos que a falta de permissão vinha escondendo

Medidos mandando cadastros PROPOSITALMENTE inválidos — o Bling valida o corpo
antes de gravar, então nada entrou na base do dono:

1. **`tipo` e `situacao` são OBRIGATÓRIOS** e o robô não mandava nenhum dos
   dois. Todo cadastro voltaria 400. Como não havia inscrito, isso só apareceria
   na primeira pessoa a se cadastrar.
2. **O WhatsApp ia em `telefone`.** Nos contatos de verdade da conta o
   `telefone` está VAZIO e o número vive em `celular`.
3. **`observacoes` NÃO É CAMPO DE CONTATO.** Um contato tem 24 campos e ele não
   está entre eles. O Bling ACEITA o campo no envio, sem reclamar, e descarta —
   a marca de origem sumiria em silêncio.

### Onde a marca de origem cabe

Não existe campo de texto livre em `financeiro`, `endereco`, `dadosAdicionais`
nem `pessoasContato`. O que existe é **`codigo`**, vazio em todos os contatos da
conta. Vai `LP-<data>-<id>`, único por pessoa e visível na lista.
A etiqueta de verdade é `tiposContato`; os 12 tipos existentes não têm nenhum de
lista de espera. Criar um é decisão do dono — depois é só somar o id em
`TIPOS_DO_CADASTRO`.

### Provado ponta a ponta (com autorização do dono)

Cadastro feito pela PORTA PÚBLICA (`vessel_entrar_na_lista` com a chave que está
dentro da própria LP — INSERT direto provaria o caminho errado):

  linha 11 → planilha_em 20:14:48 · bling_id 18357970612 · bling_em 20:14:49
  CSV no Zoho: 1 linha de dado, com `no_bling`
  Bling: codigo "LP-20260829-11", celular preenchido, telefone vazio, tipo F,
         situacao A, tipos [Cliente]

Um detalhe se provou sozinho: o CSV saiu com `no_bling = ainda não` (foi escrito
1 segundo ANTES do Bling responder) e a rodada seguinte regravou para `sim`. É a
comparação de autocorreção fazendo o trabalho dela.

**E o apagar também foi provado**, que é a promessa da Política de Privacidade:
contato apagado no Bling (204, e o GET seguinte deu 404) e linha apagada no
banco → a rodada seguinte devolveu o CSV a só o cabeçalho. Some do banco, some
da planilha.

⚠️ O código deste robô **não estava em repositório nenhum** — foi publicado de um
worktree que já não existe. Recuperado do próprio Supabase e devolvido a
`supabase/functions/vessel-espelhar-lista/`.
