export type PixPaymentMode = 'antecipado' | 'entrega'

export type LojaVirtualSettings = {
  enabled: boolean
  allowCashOnDelivery: boolean
  allowPixAdvance: boolean
  allowCardOnDelivery: boolean
  pixKeyType: 'cpf' | 'cnpj' | 'email' | 'telefone' | 'aleatoria'
  pixKey: string
  pixHolder: string
  pixCity: string
  allowPickup: boolean
  allowDelivery: boolean
  deliveryFee: number
  updatedAt?: unknown
}

export const defaultLojaVirtualSettings: LojaVirtualSettings = {
  enabled: false,
  allowCashOnDelivery: true,
  allowPixAdvance: true,
  allowCardOnDelivery: true,
  pixKeyType: 'aleatoria',
  pixKey: '',
  pixHolder: '',
  pixCity: '',
  allowPickup: true,
  allowDelivery: true,
  deliveryFee: 0
}
