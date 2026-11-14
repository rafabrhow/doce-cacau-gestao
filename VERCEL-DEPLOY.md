# Doce Cacau — preparação para Vercel

## Arquivos desta adaptação
- `server.js`: mantém o servidor local e exporta o Express para a função da Vercel.
- `api/[...path].js`: encaminha as rotas `/api/*` para o Express e preserva o fluxo multipart do upload.
- `vercel.json`: define build Vite e diretório publicado `dist`.

## Variáveis de ambiente da Vercel
Cadastre em Project Settings > Environment Variables, nos ambientes Production e Preview conforme necessário:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` — URL pública da Vercel seguida de `/api/drive/oauth2callback`.
- `FIREBASE_SERVICE_ACCOUNT_JSON` — JSON completo da conta de serviço Firebase Admin, armazenado como variável secreta. Não coloque no Git.
- `GOOGLE_TOKEN_ENCRYPTION_KEY` — segredo aleatório com pelo menos 32 caracteres. Usado para criptografar os tokens OAuth antes de gravá-los no Firestore.

O Firebase Web SDK continua usando a configuração pública existente em `src/lib/firebase.ts`; ela não substitui a conta de serviço do Firebase Admin.

## Armazenamento seguro
Na Vercel, os tokens OAuth do Google Drive passam a ser criptografados com AES-256-GCM e armazenados em `stores/doce-cacau/private_integrations/google_drive` no Firestore. Os estados temporários do OAuth são armazenados em `stores/doce-cacau/oauth_states`. Essas gravações são feitas pelo Firebase Admin no servidor; as regras do Firestore não concedem acesso direto do navegador a essas coleções.

No desenvolvimento local, o servidor continua usando `.env.local` e `.google-drive-token.json`, preservando o fluxo atual.

## Google Cloud OAuth
Depois que a Vercel fornecer a URL do projeto, configure em Authorized redirect URIs exatamente o valor de `GOOGLE_REDIRECT_URI`, por exemplo:
`https://SEU-PROJETO.vercel.app/api/drive/oauth2callback`

Não use o exemplo literalmente: substitua pelo domínio real atribuído à aplicação.

## Observações
- A interface e a API devem permanecer no mesmo domínio para evitar a necessidade de CORS.
- Não publique `.env.local`, `.google-drive-token.json`, JSON de conta de serviço, `client_secret*.json` ou chaves privadas.
- Faça o primeiro deploy como Preview e teste login, status do Drive, conexão OAuth, upload, visualização e exclusão de foto antes de promover para Production.
