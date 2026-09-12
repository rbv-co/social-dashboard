-- NOTA DE ESCOPO do cadastro rápido de colaborador — SÓ COMENTÁRIO.
-- Não cria, não altera e não revoga nada: escreve no banco o que hoje só estava
-- escrito no desenho, para quem abrir a função pelo Supabase ler ali mesmo.
--
-- POR QUE EXISTE: a revisão da branch de 13/08/2026 achou uma diferença entre
-- quem a TELA deixa cadastrar e quem o BANCO deixa cadastrar. O dono decidiu
-- deixar o comportamento como está por enquanto — todo mundo que passa nessa
-- porta é gente da casa — com a condição de que o banco DIGA isso. Diferença
-- conhecida e sem registro vira surpresa na mão de quem vier depois.

comment on function public.criar_pessoa_rapida(text, text, uuid, uuid) is
$c$Cria a ficha do colaborador que falta, direto do formulário do bem ou do carro.
Devolve a linha criada, ou a que já existia com ja_existia = true (nome repetido
não entra: a comparação ignora maiúsculas e espaços das pontas).

QUEM PODE CHAMAR, DE VERDADE: qualquer usuário logado que passe em
pode_cadastrar_pessoa_rapida(), ou seja is_acessos_admin() OU is_patrimonio_admin()
OU is_frota_admin(). As duas últimas só olham se profiles.features contém
'patrimonio' / 'frota' — e essas features são DERIVADAS de qualquer permissão que
tenha a ação 'ver' (src/compartilhado/derivar-features.js). Na prática: quem
consegue ABRIR o Patrimônio ou a Frota consegue chamar esta função pela API.

O QUE A TELA MOSTRA: o botão "+" ao lado do campo de pessoa só aparece para quem
pode EDITAR o registro (patrimonio.criar/editar, frota.editar). A tela é mais
estreita que o banco.

A DIFERENÇA É CONHECIDA E DELIBERADA, decidida pelo dono em 13/08/2026: quem tem
qualquer acesso a Patrimônio ou Frota é gente da casa, e o estrago possível é uma
ficha de colaborador a mais — sem login, sem contato, sem permissão nenhuma.
Apertar isso exigiria ensinar ao banco o SEGUNDO modelo de permissão (o
permissions{} recurso→ação, que hoje só o front lê), que é a Onda 3 já desenhada
em docs/superpowers/specs/2026-07-16-seguranca-e-dados-design.md. Enquanto ela não
chega, o certo é a diferença estar escrita — não remendada aqui no escuro.

Desenho: docs/superpowers/specs/2026-08-13-cadastro-rapido-de-pessoa-design.md (D5)$c$;

comment on function public.criar_setor_rapido(text) is
$c$Cria o setor que falta, de dentro da mesma caixinha do cadastro rápido de
colaborador. Devolve o setor criado, ou o que já existia com ja_existia = true
(acessos_setores.nome já é unique; devolver o existente evita o erro cru do banco
chegar à tela).

MESMA NOTA DE ESCOPO da criar_pessoa_rapida: quem pode chamar é quem passa em
pode_cadastrar_pessoa_rapida() — na prática, quem consegue ABRIR o Patrimônio ou a
Frota —, enquanto a tela só mostra o "+" para quem pode EDITAR. Diferença conhecida
e deliberada em 13/08/2026; apertá-la depende de o banco aprender o modelo
permissions{} (Onda 3).

Desenho: docs/superpowers/specs/2026-08-13-cadastro-rapido-de-pessoa-design.md (D5)$c$;
