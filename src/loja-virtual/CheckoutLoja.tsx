import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CheckCircle2, Copy, FileUp, LoaderCircle, MapPin, PackageCheck, Truck } from 'lucide-react'
import './checkout.css'

export type CheckoutItem = { productId: string; quantity: number }
type StoreConfig = {
  allowCashOnDelivery:boolean; allowPixAdvance:boolean; allowCardOnDelivery:boolean
  pixKeyType:string; pixKey:string; pixHolder:string; pixCity:string
  allowPickup:boolean; allowDelivery:boolean; deliveryFee:number
}
type Customer = { name:string; phone:string; fulfillment:'retirada'|'entrega'; address:string; reference:string; payment:'dinheiro'|'pix_antecipado'|'cartao'; notes:string }
type Props = { items:CheckoutItem[]; resumeToken?:string; onBack:()=>void; onFinished:()=>void }
const money=(v:number)=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})
function formatWhatsApp(value:string){
  const digits=value.replace(/\D/g,'').slice(0,11)
  if(!digits)return ''
  if(digits.length<=2)return `(${digits}`
  if(digits.length<=7)return `(${digits.slice(0,2)}) ${digits.slice(2)}`
  return `(${digits.slice(0,2)}) ${digits.slice(2,7)}-${digits.slice(7)}`
}
const clean=(v:string,max=100)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9 .,\-]/g,'').trim().slice(0,max)
function crc16(payload:string){let crc=0xffff;for(let i=0;i<payload.length;i++){crc^=payload.charCodeAt(i)<<8;for(let j=0;j<8;j++)crc=(crc&0x8000)?((crc<<1)^0x1021):(crc<<1);crc&=0xffff}return crc.toString(16).toUpperCase().padStart(4,'0')}
function tlv(id:string,value:string){return id+String(value.length).padStart(2,'0')+value}
function pixPayload(key:string,holder:string,city:string,amount:number,txid:string){
  const gui=tlv('00','br.gov.bcb.pix')+tlv('01',key)
  const merchant=tlv('26',gui)
  const additional=tlv('05',txid.slice(0,25)||'***')
  const body=tlv('00','01')+tlv('01','12')+merchant+tlv('52','0000')+tlv('53','986')+tlv('54',amount.toFixed(2))+tlv('58','BR')+tlv('59',clean(holder,25)||'DOCE CACAU')+tlv('60',clean(city,15)||'SAO LUIS')+tlv('62',additional)+'6304'
  return body+crc16(body)
}
const blank:Customer={name:'',phone:'',fulfillment:'retirada',address:'',reference:'',payment:'pix_antecipado',notes:''}

export default function CheckoutLoja({items,resumeToken='',onBack,onFinished}:Props){
  const [orderItems,setOrderItems]=useState<CheckoutItem[]>(items)
  const [config,setConfig]=useState<StoreConfig|null>(null)
  const [products,setProducts]=useState<any[]>([])
  const [customer,setCustomer]=useState<Customer>(blank)
  const [token,setToken]=useState('')
  const [loading,setLoading]=useState(true)
  const [saving,setSaving]=useState(false)
  const [error,setError]=useState('')
  const [step,setStep]=useState<'dados'|'pagamento'|'concluido'>('dados')
  const [proof,setProof]=useState<File|null>(null)
  const [proofName,setProofName]=useState('')
  const [orderNumber,setOrderNumber]=useState('')
  const [copied,setCopied]=useState(false)
  const totalItems=useMemo(()=>orderItems.reduce((s,i)=>s+i.quantity,0),[orderItems])
  const subtotal=useMemo(()=>orderItems.reduce((s,i)=>s+i.quantity*(products.find(p=>p.id===i.productId)?.price||0),0),[orderItems,products])
  const fee=customer.fulfillment==='entrega'?(config?.deliveryFee||0):0
  const total=subtotal+fee
  const setField=<K extends keyof Customer>(key:K,value:Customer[K])=>setCustomer(old=>({...old,[key]:value}))

  useEffect(()=>{
    let alive=true
    const load=async()=>{
      try{
        const response=await fetch('/api/loja/checkout')
        const data=await response.json()
        if(!response.ok)throw new Error(data.error||'Não foi possível preparar o checkout.')
        if(alive){setConfig(data.settings);setProducts(data.products||[])}
        if(resumeToken){
          const draftResponse=await fetch(`/api/loja/rascunhos/${encodeURIComponent(resumeToken)}`)
          const draftData=await draftResponse.json()
          if(!draftResponse.ok)throw new Error(draftData.error||'Não foi possível recuperar o pedido salvo.')
          if(alive){setToken(resumeToken);setCustomer({...blank,...draftData.draft.customer});setOrderItems(draftData.draft.items||[]);setProofName(draftData.draft.proofFileName||'');if(draftData.draft.status==='finalizado'){setOrderNumber(draftData.draft.orderNumber||'');setStep('concluido')}else{setStep('pagamento')}}
        }
      }catch(e){if(alive)setError((e as Error).message)}
      finally{if(alive)setLoading(false)}
    }
    load()
    return()=>{alive=false}
  },[resumeToken])

  useEffect(()=>{
    if(!config)return
    const methods:Customer['payment'][]=[]
    if(config.allowPixAdvance)methods.push('pix_antecipado')
    if(config.allowCardOnDelivery)methods.push('cartao')
    if(config.allowCashOnDelivery)methods.push('dinheiro')
    if(methods.length&&!methods.includes(customer.payment))setField('payment',methods[0])
    if(!config.allowPickup&&config.allowDelivery)setField('fulfillment','entrega')
    if(!config.allowDelivery&&config.allowPickup)setField('fulfillment','retirada')
  },[config])

  async function ensureDraft(){
    if(token)return token
    const response=await fetch('/api/loja/rascunhos',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:orderItems,customer})})
    const data=await response.json()
    if(!response.ok)throw new Error(data.error||'Não foi possível salvar seu pedido.')
    setToken(data.token)
    window.history.replaceState({},'',`/loja?pedido=${encodeURIComponent(data.token)}`)
    return data.token as string
  }
  async function saveDraft(nextCustomer=customer,targetToken=token){
    if(!targetToken)return
    const response=await fetch(`/api/loja/rascunhos/${encodeURIComponent(targetToken)}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:orderItems,customer:nextCustomer})})
    const data=await response.json().catch(()=>({}))
    if(!response.ok)throw new Error(data.error||'Não foi possível salvar o pedido.')
  }
  useEffect(()=>{
    if(!token||step==='concluido')return
    const timer=window.setTimeout(()=>{saveDraft().catch(()=>{})},700)
    return()=>window.clearTimeout(timer)
  },[customer,orderItems,token,step])

  async function continueToPayment(){
    setError('')
    if(!customer.name.trim()||customer.phone.replace(/\D/g,'').length!==11){setError('Informe seu nome e um número de WhatsApp com DDD e 11 dígitos.');return}
    if(customer.fulfillment==='entrega'&&!customer.address.trim()){setError('Informe o endereço para entrega.');return}
    if(customer.payment==='pix_antecipado'&&(!config?.pixKey||!config.pixHolder||!config.pixCity)){setError('A loja ainda não configurou todos os dados para receber Pix. Escolha outra forma ou entre em contato com a loja.');return}
    setSaving(true)
    try{const draftToken=await ensureDraft();await saveDraft(customer,draftToken);setStep('pagamento')}
    catch(e){setError((e as Error).message)}
    finally{setSaving(false)}
  }
  async function uploadProof(){
    if(!proof||!token)return
    const form=new FormData();form.append('proof',proof)
    const response=await fetch(`/api/loja/rascunhos/${encodeURIComponent(token)}/comprovante`,{method:'POST',body:form})
    const data=await response.json()
    if(!response.ok)throw new Error(data.error||'Não foi possível anexar o comprovante.')
    setProofName(proof.name)
  }
  async function finalize(){
    setSaving(true);setError('')
    try{
      if(customer.payment==='pix_antecipado'&&!proofName){
        if(!proof)throw new Error('Anexe o comprovante do Pix para concluir o pedido.')
        await uploadProof()
      }
      await saveDraft()
      const response=await fetch(`/api/loja/rascunhos/${encodeURIComponent(token)}/finalizar`,{method:'POST'})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error||'Não foi possível finalizar o pedido.')
      setOrderNumber(data.orderNumber)
      setStep('concluido')
      window.history.replaceState({},'',`/loja?pedido=${encodeURIComponent(token)}&concluido=1`)
    }catch(e){setError((e as Error).message)}
    finally{setSaving(false)}
  }
  if(loading)return <div className="dc-checkout-state"><LoaderCircle className="dc-spin"/> Preparando seu pedido...</div>
  if(error&&!config)return <div className="dc-checkout-state dc-checkout-error">{error}<button onClick={onBack}>Voltar à sacola</button></div>
  if(!config)return null
  const paymentLabel=customer.payment==='pix_antecipado'?'Pix':customer.payment==='cartao'?'Cartão na entrega/retirada':'Dinheiro na entrega/retirada'
  return <section className="dc-checkout">
    <button className="dc-checkout-back" onClick={step==='dados'?onBack:()=>setStep('dados')}><ArrowLeft size={16}/> {step==='dados'?'Voltar à sacola':'Voltar'}</button>
    <div className="dc-checkout-heading"><span className="dc-eyebrow">DOCE CACAU · SEU PEDIDO</span><h2>{step==='concluido'?'Pedido recebido!':step==='dados'?'Finalizar pedido':'Pagamento'}</h2><p>{step==='concluido'?'Recebemos seus dados e vamos conferir seu pedido.':'Só mais alguns dados para preparar seu pedido com carinho.'}</p></div>
    {step==='concluido'?<div className="dc-order-success"><CheckCircle2 size={42}/><h3>Pedido enviado com sucesso</h3><p>Número do pedido: <b>{orderNumber}</b></p><p>Seu pedido está aguardando a confirmação da loja. O estoque e o financeiro só serão atualizados após a validação pela equipe.</p><button onClick={onFinished}>Voltar à loja</button></div>:<div className="dc-checkout-layout">
      <div className="dc-checkout-form">
        {step==='dados'?<>
          <section className="dc-checkout-card"><h3>Seus dados</h3><label>Nome completo<input value={customer.name} onChange={e=>setField('name',e.target.value)} maxLength={100} placeholder="Como podemos chamar você?"/></label><label>WhatsApp / telefone<input type="tel" inputMode="numeric" autoComplete="tel" value={customer.phone} onChange={e=>setField('phone',formatWhatsApp(e.target.value))} maxLength={15} placeholder="(00) 00000-0000"/></label></section>
          <section className="dc-checkout-card"><h3>Como deseja receber?</h3><div className="dc-choice-grid">{config.allowPickup&&<button type="button" className={customer.fulfillment==='retirada'?'selected':''} onClick={()=>setField('fulfillment','retirada')}><PackageCheck/> Retirar na loja</button>}{config.allowDelivery&&<button type="button" className={customer.fulfillment==='entrega'?'selected':''} onClick={()=>setField('fulfillment','entrega')}><Truck/> Receber em endereço</button>}</div>{customer.fulfillment==='entrega'&&<><label>Endereço completo<input value={customer.address} onChange={e=>setField('address',e.target.value)} maxLength={220} placeholder="Rua, número, bairro e cidade"/></label><label>Ponto de referência (opcional)<input value={customer.reference} onChange={e=>setField('reference',e.target.value)} maxLength={150}/></label><div className="dc-fee-note"><MapPin size={15}/> Taxa de entrega: {money(fee)}</div></>}</section>
          <section className="dc-checkout-card"><h3>Forma de pagamento</h3><div className="dc-payment-options">{config.allowPixAdvance&&<label><input type="radio" checked={customer.payment==='pix_antecipado'} onChange={()=>setField('payment','pix_antecipado')} /> Pix</label>}{config.allowCardOnDelivery&&<label><input type="radio" checked={customer.payment==='cartao'} onChange={()=>setField('payment','cartao')}/> Cartão na {customer.fulfillment==='entrega'?'entrega':'retirada'}</label>}{config.allowCashOnDelivery&&<label><input type="radio" checked={customer.payment==='dinheiro'} onChange={()=>setField('payment','dinheiro')}/> Dinheiro na {customer.fulfillment==='entrega'?'entrega':'retirada'}</label>}</div></section>
          <section className="dc-checkout-card"><h3>Observações (opcional)</h3><textarea value={customer.notes} onChange={e=>setField('notes',e.target.value)} maxLength={400} placeholder="Alguma informação para preparar seu pedido?"/></section>
          <button className="dc-checkout-primary" onClick={continueToPayment} disabled={saving}>{saving?<LoaderCircle className="dc-spin"/>:'Continuar para pagamento'} <ArrowLeft className="dc-arrow-right" size={16}/></button>
        </>:<>
          <section className="dc-checkout-card"><h3>{paymentLabel}</h3>{customer.payment==='pix_antecipado'?<><p>Faça o Pix usando o código abaixo e anexe o comprovante para enviar o pedido.</p><div className="dc-pix-code">{pixPayload(config.pixKey,config.pixHolder,config.pixCity,total,token||'***')}</div><button className="dc-copy-pix" onClick={()=>{const value=pixPayload(config.pixKey,config.pixHolder,config.pixCity,total,token||'***');navigator.clipboard.writeText(value).then(()=>setCopied(true))}}><Copy size={16}/>{copied?'Código copiado':'Copiar Pix Copia e Cola'}</button><button className="dc-copy-pix" onClick={()=>navigator.clipboard.writeText(window.location.href).then(()=>setCopied(true))}><Copy size={16}/>Copiar link para continuar depois</button><label className="dc-proof-upload"><FileUp/> {proofName||proof?.name||'Anexar comprovante (imagem ou PDF)'}<input type="file" accept="image/*,application/pdf" onChange={e=>{const file=e.target.files?.[0]||null;if(file&&file.size>5*1024*1024){setError('O comprovante deve ter no máximo 5 MB.');setProof(null);return}setError('');setProof(file);setProofName('')}}/></label></>:<><p>{customer.payment==='cartao'?'O pagamento será realizado com cartão no momento da retirada ou entrega.':'O pagamento será realizado em dinheiro no momento da retirada ou entrega.'}</p><button className="dc-copy-pix" onClick={()=>navigator.clipboard.writeText(window.location.href).then(()=>setCopied(true))}><Copy size={16}/>{copied?'Link copiado':'Copiar link para continuar depois'}</button></>}</section>
          <button className="dc-checkout-primary" onClick={finalize} disabled={saving}>{saving?<LoaderCircle className="dc-spin"/>:'Enviar pedido'} <ArrowLeft className="dc-arrow-right" size={16}/></button>
        </>}
        {error&&<p className="dc-checkout-error">{error}</p>}
        <small className="dc-checkout-privacy">Seus dados serão usados somente para organizar e entregar este pedido.</small>
      </div>
      <aside className="dc-checkout-summary"><h3>Resumo do pedido</h3>{orderItems.map(item=>{const p=products.find(x=>x.id===item.productId);return <div className="dc-summary-line" key={item.productId}><span>{item.quantity} × {p?.name||'Produto'}</span><b>{money((p?.price||0)*item.quantity)}</b></div>})}<div className="dc-summary-line"><span>Subtotal ({totalItems} itens)</span><b>{money(subtotal)}</b></div>{fee>0&&<div className="dc-summary-line"><span>Entrega</span><b>{money(fee)}</b></div>}<div className="dc-summary-total"><span>Total</span><b>{money(total)}</b></div></aside>
    </div>}
  </section>
}
