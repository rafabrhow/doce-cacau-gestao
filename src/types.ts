export type Product = {
  id: string; name: string; barcode: string; category: string; brand: string;
  cost: number; price: number; stock: number; minStock: number; expiry: string; image: string; driveFileId?: string; outOfStockSince?: string | null; archived?: boolean; archivedAt?: string | null; archiveReason?: string | null; createdBy?: string; createdByName?: string; updatedBy?: string; updatedByName?: string;
}
export type OrderItem = { productId: string; name: string; barcode: string; quantity: number; unitPrice: number }
export type PaymentRecord = { id: string; amount: number; method: 'Pix'|'Dinheiro'|'Cartão de crédito'|'Cartão de débito'|'Transferência'|'Outro'; date: string; user: string; userId?: string }
export type Order = {
  id: string; customer: string; phone: string; items: OrderItem[]; total: number;
  paymentStatus: 'Pago' | 'A pagar' | 'Parcial'; deliveryStatus: 'Reservado' | 'Entregue';
  paid: number; payments?: PaymentRecord[]; seller: string; createdAt: string; pickupDate: string; notes: string; createdBy?: string; createdByName?: string; updatedBy?: string; updatedByName?: string;
}
export type Movement = { id: string; productId: string; productName: string; type: 'Entrada'|'Saída'|'Ajuste'|'Reserva'|'Cancelamento'; quantity: number; date: string; user: string; userId?: string; detail: string }
export type User = { name: string; email: string }
export type StoreData = { products: Product[]; orders: Order[]; movements: Movement[] }
