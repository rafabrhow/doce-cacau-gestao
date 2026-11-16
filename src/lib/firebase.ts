import { initializeApp, getApps } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getMessaging, isSupported, getToken } from 'firebase/messaging'

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


// Chave pública VAPID gerada em Configurações do projeto > Cloud Messaging >
// Configuração da Web > Certificados push da Web.
export async function enableAdminPush(): Promise<string> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator)) {
    throw new Error('Este navegador não oferece suporte a notificações push.')
  }
  if (!import.meta.env.VITE_FIREBASE_VAPID_KEY) {
    throw new Error('Configure VITE_FIREBASE_VAPID_KEY com a chave pública Web Push do Firebase.')
  }
  if (!(await isSupported())) throw new Error('As notificações push não são suportadas neste navegador.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Permissão de notificações não concedida.')
  const registration = await navigator.serviceWorker.ready
  const messaging = getMessaging(app)
  const token = await getToken(messaging, {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration
  })
  if (!token) throw new Error('O Firebase não conseguiu gerar o token deste dispositivo.')
  return token
}
