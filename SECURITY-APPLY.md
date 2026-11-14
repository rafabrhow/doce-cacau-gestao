# Correções de segurança e integridade — Doce Cacau

## Arquivos alterados
- `server.js`: valida membro ativo no Firebase, CORS por lista permitida, OAuth com `state` de uso único e expiração, token Drive com permissão restrita, imagens privadas, validação de pertencimento à pasta `Doce Cacau/Produtos` antes de ler/excluir.
- `firestore.rules`: acesso somente a usuários com documento ativo em `stores/doce-cacau/users/{uid}`.
- `src/App.tsx`: verificação de arquivamento a cada minuto enquanto o sistema está aberto; bloqueio de venda de produtos arquivados; pré-visualização autenticada de imagens privadas do Drive.
- `.gitignore`: exclui `.env*`, token OAuth, `dist` e dependências.
- `vite.config.ts`: inclui a origem LAN local conhecida na lista de desenvolvimento.

## Aplicação
1. Faça backup da pasta atual.
2. Extraia os arquivos do pacote na raiz do projeto, preservando os caminhos.
3. No Firebase Console, abra Firestore Database > Regras, substitua pelas regras de `firestore.rules` e publique.
4. **Antes de publicar as regras**, confirme em `stores/doce-cacau/users` que existe um documento para cada administrador, com ID igual ao UID do Firebase Authentication e `active: true`. Se não existir, crie o documento manualmente com `uid`, `name`, `email`, `role: "Administrador"` e `active: true`. Sem esse cadastro, o acesso será negado intencionalmente.
5. Mantenha `FIREBASE_SERVICE_ACCOUNT_JSON`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` no `.env.local` local, nunca no código.
6. Reinicie `npm run dev:all`.
7. Entre no sistema e teste: abrir cadastro de produto com foto já existente no Drive, enviar nova foto, gerar catálogo, registrar venda, repor estoque e observar arquivamento.

## Observações importantes
- Imagens novas deixam de ser públicas por link. A pré-visualização e o catálogo passam pela API autenticada. Fotos antigas que já foram compartilhadas publicamente continuam com a permissão antiga até que você a remova no Google Drive.
- O OAuth `state` é mantido em memória; é adequado ao servidor local único. Para múltiplas instâncias ou hospedagem, use armazenamento persistente e sessão OAuth compartilhada.
- A verificação dos 90 dias roda ao receber snapshots e a cada minuto enquanto o app está aberto. Se o app ficar fechado, o arquivamento ocorre ao reabrir/conectar; para executar mesmo com o app fechado, será necessário um agendador backend (Cloud Scheduler/cron).
- As regras pressupõem que os dois administradores já estejam cadastrados como membros ativos. Não habilite cadastro público de membros.
