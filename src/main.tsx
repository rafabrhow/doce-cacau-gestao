import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import CatalogoPublico from './loja-virtual/CatalogoPublico'
import './styles.css'

const isPublicCatalog = window.location.pathname.replace(/\/+$/, '') === '/loja'

function configureAdminInstall() {
  const manifest = document.createElement('link')
  manifest.rel = 'manifest'
  manifest.href = '/manifest.webmanifest'
  document.head.appendChild(manifest)

  const appleIcon = document.createElement('link')
  appleIcon.rel = 'apple-touch-icon'
  appleIcon.href = '/icons/apple-touch-icon.png'
  document.head.appendChild(appleIcon)

  const capable = document.createElement('meta')
  capable.name = 'apple-mobile-web-app-capable'
  capable.content = 'yes'
  document.head.appendChild(capable)

  const statusBar = document.createElement('meta')
  statusBar.name = 'apple-mobile-web-app-status-bar-style'
  statusBar.content = 'black-translucent'
  document.head.appendChild(statusBar)

  const title = document.createElement('meta')
  title.name = 'apple-mobile-web-app-title'
  title.content = 'Doce Cacau'
  document.head.appendChild(title)

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((error) => {
        console.error('Não foi possível preparar o aplicativo Doce Cacau:', error)
      })
    })
  }
}

if (!isPublicCatalog) configureAdminInstall()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>{isPublicCatalog ? <CatalogoPublico /> : <App />}</React.StrictMode>
)
