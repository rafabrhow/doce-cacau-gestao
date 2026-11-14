import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Configuração do aplicativo Web da Doce Cacau.
// Estes identificadores são próprios do SDK Web; não são uma chave privada.
const firebaseConfig = {
  apiKey: 'AIzaSyD3km3Y7LUSlyMPSYym2GNdXu0iSdVBYpM',
  authDomain: 'doce-cacau-66cbe.firebaseapp.com',
  projectId: 'doce-cacau-66cbe',
  storageBucket: 'doce-cacau-66cbe.firebasestorage.app',
  messagingSenderId: '551137854754',
  appId: '1:551137854754:web:aa085a1dfe718c971bd17b'
}

export const firebaseReady = true
export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig)
export const auth = getAuth(app)
// App secundário para criar usuários da equipe sem encerrar a sessão do administrador atual.
const teamApp = getApps().find(x => x.name === 'doce-cacau-team') || initializeApp(firebaseConfig, 'doce-cacau-team')
export const teamAuth = getAuth(teamApp)
export const db = getFirestore(app)
export const storePath = ['stores', 'doce-cacau'] as const
