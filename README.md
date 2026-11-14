# Doce Cacau — Gestão Inteligente

Aplicação web responsiva para gestão de uma chocolateria: produtos, código de barras, estoque, PDV, reservas, pagamentos e relatórios.

## Requisitos
- Node.js 20 ou superior
- npm

## Rodar localmente
```bash
npm install
npm run dev
```
Abra o endereço mostrado pelo Vite (normalmente http://localhost:5173).

## Build de produção
```bash
npm run build
npm run preview
```

## Modo inicial
Sem variáveis Firebase, o sistema abre em modo local de demonstração e salva os dados no navegador via localStorage. Isso serve para testar telas e fluxos em um computador. Esses dados não são compartilhados entre dispositivos/usuários e podem ser perdidos ao limpar os dados do navegador.

## Conectar Firebase
1. Crie um projeto no Firebase Console.
2. Ative Authentication > Sign-in method > Email/Password.
3. Crie os usuários da equipe em Authentication > Users.
4. Crie um banco Firestore.
5. Copie `.env.example` para `.env` e preencha as variáveis `VITE_FIREBASE_*` com as credenciais do app Web.
6. Reinicie `npm run dev`.

**Atenção:** esta entrega inclui inicialização Firebase e autenticação por e-mail/senha, além de sincronização inicial do documento `stores/doce-cacau`. Antes de usar em produção, configure regras de segurança do Firestore e valide permissões. A sincronização atual grava o documento inteiro da loja; para uso concorrente real, recomendamos migrar para coleções por produto/pedido e transações Firestore, evitando sobrescritas entre vendedores.

Exemplo inicial de regra (não publicar sem adaptar e testar):
```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /stores/{storeId} {
      allow read, write: if request.auth != null;
    }
  }
}
```
Essa regra permite que qualquer usuário autenticado acesse a loja; para uma operação comercial, implemente papéis e validações adicionais.

## Leitor e pesquisa por código
A leitura da câmera usa `@zxing/browser`. Navegadores exigem HTTPS (ou localhost) e permissão de câmera.
A consulta externa usa Open Food Facts. A base pode não conter todos os chocolates Cacau Show; sempre confira nome, marca e imagem antes de salvar.

## Antes de publicar
- Configurar Firebase e regras de segurança robustas.
- Testar login com cada funcionário.
- Validar fluxo de reserva/entrega e pagamentos parciais.
- Implementar concorrência segura de estoque com transações Firestore.
- Testar leitor em Android e iPhone via HTTPS.
- Configurar domínio, deploy Vercel e variáveis de ambiente.
- Definir política de backup e privacidade/LGPD.

## Observações funcionais
- Todos os usuários autenticados têm a mesma permissão nesta primeira versão.
- Reservas baixam o estoque disponível no ato da criação; marcar como entregue não baixa novamente.
- Cancelamento e devolução de reserva ainda precisam de fluxo próprio antes de produção.
- Pagamentos são registros internos; não há integração com adquirente, Pix automático ou emissão fiscal.
