# Google Drive local — Doce Cacau

## Dependências e inicialização
1. Na pasta raiz do projeto, execute `npm install`.
2. Copie `.env.local.example` para `.env.local`.
3. Preencha as variáveis do Google OAuth e a conta de serviço do Firebase. Nunca envie esse arquivo ou suas chaves para outras pessoas.
4. No Google Cloud Console, habilite a Google Drive API e configure um cliente OAuth do tipo Aplicativo da Web. Cadastre exatamente `http://localhost:8787/api/drive/oauth2callback` como URI de redirecionamento autorizado.
5. No OAuth consent screen, adicione `sistemasrddl@gmail.com` como usuário de teste enquanto o app estiver em modo de teste.
6. Execute `npm run dev:all`. O Vite continua em `https://localhost:5173` e a API local em `http://127.0.0.1:8787`.
7. Entre no Doce Cacau, abra Produtos > Novo produto e clique em Conectar Google Drive. Autorize a conta `sistemasrddl@gmail.com`.
8. Depois da conexão, selecione uma foto no cadastro do produto. O arquivo será salvo em `Doce Cacau/Produtos` no Drive e a referência será gravada no campo `image` do produto ao salvar.

## Credenciais Firebase
A API local valida o usuário logado com Firebase Admin. Gere uma chave de conta de serviço no projeto Firebase correto (`doce-cacau-66cbe`) e coloque o JSON em `FIREBASE_SERVICE_ACCOUNT_JSON`. Não use a configuração pública do SDK Web como chave de serviço.

## Segurança e observações
- `.env.local` e `.google-drive-token-backup.json` são arquivos privados; não os publique nem os envie.
- As imagens permanecem privadas no Google Drive. O Doce Cacau entrega as imagens somente pela API autenticada, após validar o usuário e confirmar que o arquivo pertence à pasta Doce Cacau/Produtos.
- Esta primeira etapa é para desenvolvimento local. Esta implementação continua voltada ao desenvolvimento local. Antes de publicar, adapte a API para hospedagem com armazenamento seguro dos tokens (não use arquivo local efêmero), HTTPS, origens APP_ORIGINS explícitas e processo OAuth persistente/compartilhado entre instâncias.
