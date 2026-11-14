# Conectar e ativar o Firebase — Doce Cacau

## Arquivos desta atualização
- `src/lib/firebase.ts`: configuração do projeto Firebase Doce Cacau.
- `src/App.tsx`: login, leitura em tempo real e gravação em coleções separadas.
- `firestore.rules`: regras iniciais de acesso.

## 1. Ativar autenticação por e-mail e senha
No Firebase Console:
1. Abra Authentication.
2. Entre em Método de login.
3. Ative E-mail/senha (o provedor chamado E-mail/senha, não apenas link de e-mail).
4. Salve.

## 2. Criar o primeiro usuário
1. Em Authentication > Usuários, clique em Adicionar usuário.
2. Informe o e-mail e uma senha forte para o administrador.
3. Use essas credenciais na tela de login do Doce Cacau.

Para cadastrar funcionários, adicione cada conta na mesma tela. Todos terão as mesmas permissões nesta versão, conforme definido para a loja.

## 3. Publicar regras do Firestore
1. Abra Firestore Database > Regras.
2. Substitua o conteúdo pelas regras do arquivo `firestore.rules`.
3. Clique em Publicar.

As regras permitem acesso somente a usuários autenticados e às coleções da loja Doce Cacau. Como todos os funcionários têm permissões iguais nesta versão, qualquer usuário autenticado pode ler e gravar os documentos dessas coleções.

## 4. Coleções criadas automaticamente
Após o primeiro login e a primeira operação, o sistema utilizará:
- `stores/doce-cacau/users`
- `stores/doce-cacau/products`
- `stores/doce-cacau/orders`
- `stores/doce-cacau/stock_movements`

Não é necessário criar as coleções manualmente.

## 5. Teste recomendado
1. Crie o usuário administrador.
2. Publique as regras.
3. Entre no sistema.
4. Cadastre um produto de teste com estoque inicial.
5. Confira se o documento apareceu em `stores/doce-cacau/products`.
6. Faça uma entrada/saída de estoque e confira `stock_movements`.
7. Faça uma venda de teste e confira `orders` e a baixa de estoque.

## Observações
- O sistema agora escuta as coleções em tempo real e grava cada produto, pedido e movimentação em seu próprio documento.
- Venda/reserva, baixa de estoque e movimentos correspondentes são gravados em uma transação Firestore.
- A confirmação de entrega de uma reserva não baixa o estoque novamente, pois a quantidade já foi comprometida quando a reserva foi criada.
- A configuração Web Firebase presente em `src/lib/firebase.ts` contém identificadores públicos do aplicativo. A segurança real depende das regras do Firestore e da autenticação; nunca coloque senhas ou chaves privadas no frontend.
- A primeira versão ainda não implementa recuperação de senha pela interface, gestão de perfis/permissões diferenciadas, cancelamento de reserva com estorno, nem integração com Pix/adquirentes ou emissão fiscal.
