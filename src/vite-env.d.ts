/// <reference types="vite/client" />

declare module '*.css';
interface ImportMetaEnv { readonly VITE_FIREBASE_VAPID_KEY: string }
interface ImportMeta { readonly env: ImportMetaEnv }
