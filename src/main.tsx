import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import CatalogoPublico from './loja-virtual/CatalogoPublico'
import './styles.css'
const isPublicCatalog = window.location.pathname.replace(/\/+$/, '') === '/loja'
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode>{isPublicCatalog ? <CatalogoPublico /> : <App />}</React.StrictMode>)
