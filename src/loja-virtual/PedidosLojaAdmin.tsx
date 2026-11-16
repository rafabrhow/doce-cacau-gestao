import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, XCircle, RefreshCw, ExternalLink, PackageCheck, Search, Clock3 } from 'lucide-react'
import './pedidos-loja-admin.css'

type PublicOrder = {
  id: string; orderNumber: string; status: 'pendente'|'aprovado'|'recusado'; deliveryStatus?: string
  customer: { name?: string; phone?: string; fulfillment?: string; address?: string; reference?: string; notes?: string; payment?: string }
  items: Array<{ productId: string; name: string; quantity: number; unitPrice: number; lineTotal: number }>
  subtotal: number; deliveryFee: number; total: number; paymentMethod: string; paymentStatus: string
  proofFileId?: string|null; proofFileName?: string; createdAt?: { _seconds?: number; seconds?: number }|string
  rejectionReason?: string
}
type Props = { getToken: () => Promise<string> }
const money = (v:number) => (Number(v)||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
const dateLabel = (v:PublicOrder['createdAt']) => {
  if (!v) return 'Data não informada'
  const d = typeof v === 'string' ? new Date(v) : new Date(((v as any)._seconds || (v as any).seconds || 0) * 1000)
  return Number.isNaN(d.getTime()) ? 'Data não informada' : d.toLocaleString('pt-BR')
}
const paymentLabel = (v:string) => ({pix_antecipado:'Pix',pix_entrega:'Pix na entrega (pedido antigo)',cartao:'Cartão na entrega/retirada',dinheiro:'Dinheiro na entrega/retirada'}[v] || v)

type ReviewDialog = {
  order: PublicOrder
  action: 'aprovar' | 'recusar'
}
export default function PedidosLojaAdmin({getToken}:Props) {
  const [orders,setOrders] = useState<PublicOrder[]>([])
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [busy,setBusy] = useState('')
  const [filter,setFilter] = useState<'pendente'|'todos'>('pendente')
  const [search,setSearch] = useState('')
  const [notice,setNotice] = useState('')
  const [reviewDialog,setReviewDialog] = useState<ReviewDialog|null>(null)
  const [reviewReason,setReviewReason] = useState('')
  const load = useCallback(async()=>{
    setLoading(true);setError('')
    try { const token=await getToken();const r=await fetch('/api/loja/admin/pedidos',{headers:{Authorization:`Bearer ${token}`}});const j=await r.json();if(!r.ok)throw new Error(j.error||'Falha ao carregar pedidos.');setOrders(j.orders||[]) }
    catch(e){setError(e instanceof Error?e.message:'Falha ao carregar pedidos.')} finally {setLoading(false)}
  },[getToken])
  useEffect(()=>{void load()},[load])

  useEffect(()=>{
    if(!reviewDialog)return

    const handleEscape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){
        setReviewDialog(null)
        setReviewReason('')
      }
    }

    window.addEventListener('keydown',handleEscape)
    return()=>window.removeEventListener('keydown',handleEscape)
  },[reviewDialog])
  const visible = useMemo(()=>orders.filter(o=>(filter==='todos'||o.status==='pendente') && `${o.orderNumber} ${o.customer?.name} ${o.customer?.phone}`.toLowerCase().includes(search.toLowerCase())),[orders,filter,search])
  async function review(order:PublicOrder,action:'aprovar'|'recusar',reason=''){
    setBusy(order.id)
    setNotice('')
    setError('')

    try{
      const token=await getToken()
      const r=await fetch(`/api/loja/admin/pedidos/${encodeURIComponent(order.id)}`,{
        method:'PATCH',
        headers:{
          Authorization:`Bearer ${token}`,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({action,reason})
      })
      const j=await r.json()
      if(!r.ok)throw new Error(j.error||'Não foi possível atualizar o pedido.')

      setReviewDialog(null)
      setReviewReason('')
      setNotice(action==='aprovar'
        ?'Pedido aprovado e encaminhado para vendas/entrega.'
        :'Pedido recusado.')
      await load()
    }catch(e){
      setError(e instanceof Error?e.message:'Falha ao analisar pedido.')
    }finally{
      setBusy('')
    }
  }
  async function openProof(order:PublicOrder){
    if(!order.proofFileId)return
    const tab=window.open('about:blank','_blank')
    try{const token=await getToken();const r=await fetch(`/api/loja/admin/comprovante/${encodeURIComponent(order.id)}`,{headers:{Authorization:`Bearer ${token}`}});if(!r.ok){const j=await r.json().catch(()=>({}));throw new Error(j.error||'Não foi possível abrir o comprovante.')}const blob=await r.blob();const url=URL.createObjectURL(blob);if(tab)tab.location.href=url;else{const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.click()}window.setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(e){if(tab)tab.close();setError(e instanceof Error?e.message:'Falha ao abrir comprovante.')}
  }
  return <section className="pedidos-loja-page">
    <header className="pedidos-loja-heading"><div><span>DOCE CACAU · COMÉRCIO DIGITAL</span><h1><PackageCheck/> Pedidos da loja virtual</h1><p>Confira os pedidos enviados pelos clientes antes de reservar o estoque.</p></div><button className="pedidos-refresh" onClick={()=>void load()} disabled={loading}><RefreshCw size={16}/> Atualizar</button></header>
    <div className="pedidos-loja-toolbar"><div className="pedidos-loja-tabs"><button className={filter==='pendente'?'active':''} onClick={()=>setFilter('pendente')}>Aguardando análise <b>{orders.filter(o=>o.status==='pendente').length}</b></button><button className={filter==='todos'?'active':''} onClick={()=>setFilter('todos')}>Todos os pedidos</button></div><label className="pedidos-loja-search"><Search size={17}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar pedido, cliente ou telefone"/></label></div>
    {notice&&<div className="pedidos-loja-notice">{notice}</div>}{error&&<div className="pedidos-loja-error">{error}</div>}
    {loading?<div className="pedidos-loja-empty"><RefreshCw/> Carregando pedidos...</div>:!visible.length?<div className="pedidos-loja-empty"><Clock3/><b>Nenhum pedido nesta lista</b><span>Os novos pedidos enviados pelo catálogo aparecerão aqui.</span></div>:<div className="pedidos-loja-list">{visible.map(order=><article className="pedido-loja-card" key={order.id}>
      <div className="pedido-loja-top"><div><span className="pedido-loja-number">{order.orderNumber||order.id}</span><h2>{order.customer?.name||'Cliente'}</h2><small>{order.customer?.phone||'Telefone não informado'} · {dateLabel(order.createdAt)}</small></div><span className={`pedido-loja-status ${order.status}`}>{order.status==='pendente'?'Aguardando análise':order.status==='aprovado'?'Aprovado':'Recusado'}</span></div>
      <div className="pedido-loja-content"><div className="pedido-loja-items">{(order.items||[]).map((item,i)=><div key={`${item.productId}-${i}`}><span>{item.quantity}× {item.name}</span><b>{money(item.lineTotal ?? item.quantity*item.unitPrice)}</b></div>)}</div><div className="pedido-loja-summary"><div><span>Subtotal</span><b>{money(order.subtotal)}</b></div><div><span>Entrega</span><b>{money(order.deliveryFee)}</b></div><div className="grand"><span>Total</span><b>{money(order.total)}</b></div></div></div>
      <div className="pedido-loja-meta"><span><b>Recebimento:</b> {order.customer?.fulfillment==='entrega'?'Entrega':'Retirada'}</span><span><b>Pagamento:</b> {paymentLabel(order.paymentMethod)}</span><span><b>Status:</b> {order.paymentStatus}</span></div>
      {order.customer?.fulfillment==='entrega'&&<div className="pedido-loja-address"><b>Endereço:</b> {order.customer.address||'Não informado'} {order.customer.reference&&` · Referência: ${order.customer.reference}`}</div>}
      {order.customer?.notes&&<div className="pedido-loja-address"><b>Observações:</b> {order.customer.notes}</div>}
      <div className="pedido-loja-actions">{order.proofFileId&&<button className="proof-button" onClick={()=>void openProof(order)}><ExternalLink size={15}/> Ver comprovante {order.proofFileName?`· ${order.proofFileName}`:''}</button>}{order.status==='pendente'&&<div><button className="reject-button" disabled={!!busy} onClick={()=>{setReviewReason('');setReviewDialog({order,action:'recusar'})}}><XCircle size={16}/> Recusar</button><button className="approve-button" disabled={!!busy} onClick={()=>{setReviewReason('');setReviewDialog({order,action:'aprovar'})}}><CheckCircle2 size={16}/>{busy===order.id?'Processando...':'Aprovar e reservar estoque'}</button></div>}</div>
      {order.status==='recusado'&&order.rejectionReason&&<small className="pedido-loja-reason">Motivo: {order.rejectionReason}</small>}
    </article>)}</div>}

    {reviewDialog&&(
      <div
        className="dc-review-overlay"
        onMouseDown={event=>{
          if(event.target===event.currentTarget){
            setReviewDialog(null)
            setReviewReason('')
          }
        }}
      >
        <div className="dc-review-modal" role="dialog" aria-modal="true" aria-labelledby="dc-review-title">
          <div className={`dc-review-icon ${reviewDialog.action}`}>
            {reviewDialog.action==='aprovar'?<CheckCircle2 size={27}/>:<XCircle size={27}/>}
          </div>

          <h2 id="dc-review-title">
            {reviewDialog.action==='aprovar'?'Aprovar pedido?':'Recusar pedido?'}
          </h2>

          <p>
            {reviewDialog.action==='aprovar'
              ?'O estoque será reservado e uma venda será criada no sistema.'
              :'O pedido será recusado e não será encaminhado para vendas.'}
          </p>

          <div className="dc-review-order">
            <b>{reviewDialog.order.orderNumber||reviewDialog.order.id}</b>
            <span>{reviewDialog.order.customer?.name||'Cliente'}</span>
            <strong>{money(reviewDialog.order.total)}</strong>
          </div>

          {reviewDialog.action==='recusar'&&(
            <label className="dc-review-reason">
              Motivo da recusa (opcional)
              <textarea
                value={reviewReason}
                onChange={event=>setReviewReason(event.target.value)}
                placeholder="Informe o motivo..."
                maxLength={300}
              />
            </label>
          )}

          <div className="dc-review-buttons">
            <button
              type="button"
              className="dc-review-cancel"
              disabled={!!busy}
              onClick={()=>{
                setReviewDialog(null)
                setReviewReason('')
              }}
            >
              Cancelar
            </button>

            <button
              type="button"
              className={reviewDialog.action==='aprovar'?'dc-review-confirm':'dc-review-reject'}
              disabled={!!busy}
              onClick={()=>void review(reviewDialog.order,reviewDialog.action,reviewReason.trim())}
            >
              {busy===reviewDialog.order.id
                ?'Processando...'
                :reviewDialog.action==='aprovar'?'Confirmar aprovação':'Confirmar recusa'}
            </button>
          </div>
        </div>
      </div>
    )}
  </section>
}
