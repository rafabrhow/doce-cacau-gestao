import type { StoreData } from '../types'
const KEY = 'doce-cacau-store-v1'
const empty: StoreData = { products: [], orders: [], movements: [] }
export function loadStore(): StoreData {
  try { return { ...empty, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return empty }
}
export function saveStore(data: StoreData) { localStorage.setItem(KEY, JSON.stringify(data)) }
export function money(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}
export function uid() { return crypto.randomUUID?.() || `${Date.now()}-${Math.random()}` }
export function dateNow() { return new Date().toISOString() }
