# Contador e notificações push — Doce Cacau

## 1. Gerar a chave Web Push (VAPID)

No Firebase Console, abra **Configurações do projeto → Cloud Messaging → Configuração da Web → Certificados push da Web**. Clique em **Generate key pair** e copie a chave pública gerada.

Configure no ambiente de build do Vite (local e Vercel):

```env
VITE_FIREBASE_VAPID_KEY=COLE_AQUI_A_CHAVE_PUBLICA
```

A variável é pública e pode ser incluída no bundle do navegador. Não coloque a chave privada VAPID no frontend.

## 2. Backend Firebase

O servidor precisa da variável `FIREBASE_SERVICE_ACCOUNT_JSON` já utilizada pelo projeto e de permissão para enviar mensagens pelo Firebase Cloud Messaging. Confirme que a API Firebase Cloud Messaging está habilitada no projeto `doce-cacau-66cbe` e que a conta de serviço tem permissão para enviar mensagens FCM.

## 3. Aplicar as regras

Publique o arquivo `firestore.rules` atualizado no Firestore. Os tokens são gravados pelo backend em `stores/doce-cacau/users/{uid}/push_tokens`; cada dispositivo é associado ao usuário autenticado.

## 4. Ativar em cada dispositivo

Depois de publicar o frontend com a variável VAPID, entre no painel administrativo usando HTTPS, clique em **Ativar notificações** e permita notificações no navegador/celular. Repita em cada dispositivo que deverá receber os avisos. A loja pública `/loja` não registra tokens e não exibe a interface administrativa.

## Comportamento

- O contador vermelho no logo e no menu mostra pedidos da loja virtual com status `pendente`.
- A contagem é consultada periodicamente e também é atualizada quando a tela administrativa de pedidos carrega ou conclui uma análise.
- Ao finalizar um novo pedido público, o backend envia push aos dispositivos registrados de usuários ativos.
- A notificação contém apenas o número do pedido; não inclui nome, telefone, endereço, produtos ou comprovante.
- Aprovar ou recusar o pedido remove-o da contagem de pendentes.
- A falha de envio de push não impede a finalização do pedido do cliente.
