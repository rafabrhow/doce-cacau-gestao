import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Minus, Plus, ShoppingBag, X } from 'lucide-react'
import './catalogo-publico.css'
import CheckoutLoja, { type CheckoutItem } from './CheckoutLoja'

type CatalogProduct = { id:string; name:string; category:string; brand:string; price:number; imageUrl:string; imageUrls?:string[] }
type CartItem = { product:CatalogProduct; quantity:number }
const money = (value:number) => value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'})

function ProductGallery({product}:{product:CatalogProduct}){
  const images=(product.imageUrls?.length?product.imageUrls:[product.imageUrl]).filter(Boolean)
  const [index,setIndex]=useState(0)
  useEffect(()=>setIndex(0),[product.id])
  const current=images[Math.min(index,Math.max(0,images.length-1))]
  return <div className="dc-product-photo">
    {current?<img src={current} alt={`${product.name} — foto ${index+1}`} loading="lazy"/>:<div className="dc-no-photo">DOCE CACAU</div>}
    {images.length>1&&<>
      <button type="button" className="dc-gallery-arrow dc-gallery-prev" aria-label="Foto anterior" onClick={()=>setIndex(value=>(value-1+images.length)%images.length)}><ArrowLeft size={21}/></button>
      <button type="button" className="dc-gallery-arrow dc-gallery-next" aria-label="Próxima foto" onClick={()=>setIndex(value=>(value+1)%images.length)}><ArrowRight size={21}/></button>
    </>}
  </div>
}

export default function CatalogoPublico() {
  const [products,setProducts] = useState<CatalogProduct[]>([])
  const [loading,setLoading] = useState(true)
  const [error,setError] = useState('')
  const [cart,setCart] = useState<CartItem[]>([])
  const [cartOpen,setCartOpen] = useState(false)
  const [search,setSearch] = useState('')
  const [checkout,setCheckout] = useState(false)
  const [resumeToken,setResumeToken] = useState('')
  useEffect(()=>{
    let active=true
    const params=new URLSearchParams(window.location.search)
    const savedToken=params.get('pedido')||''
    if(savedToken){setResumeToken(savedToken);setCheckout(true)}
    fetch('/api/loja/catalogo').then(async response=>{
      const payload=await response.json().catch(()=>({}))
      if(!response.ok) throw new Error(payload.error||'Não foi possível abrir o catálogo.')
      return payload
    }).then(payload=>{if(active)setProducts(Array.isArray(payload.products)?payload.products:[])}).catch(err=>{if(active)setError(err.message||'Falha ao carregar a loja.')}).finally(()=>{if(active)setLoading(false)})
    return ()=>{active=false}
  },[])
  const filtered=useMemo(()=>products.filter(p=>`${p.name} ${p.category} ${p.brand}`.toLowerCase().includes(search.toLowerCase())),[products,search])
  const checkoutItems:CheckoutItem[]=cart.map(item=>({productId:item.product.id,quantity:item.quantity}))
  const total=cart.reduce((sum,item)=>sum+item.product.price*item.quantity,0)
  const count=cart.reduce((sum,item)=>sum+item.quantity,0)
  function add(product:CatalogProduct){setCart(old=>{const found=old.find(x=>x.product.id===product.id);return found?old.map(x=>x.product.id===product.id?{...x,quantity:x.quantity+1}:x):[...old,{product,quantity:1}]})}
  function change(id:string,delta:number){setCart(old=>old.map(x=>x.product.id===id?{...x,quantity:x.quantity+delta}:x).filter(x=>x.quantity>0))}
  if(checkout)return <main className="dc-storefront"><CheckoutLoja items={checkoutItems} resumeToken={resumeToken} onBack={()=>{setCheckout(false);setResumeToken('');window.history.replaceState({},'', '/loja')}} onFinished={()=>{setCheckout(false);setResumeToken('');setCart([]);window.history.replaceState({},'', '/loja')}}/></main>
  return <main className="dc-storefront">
    <header className="dc-store-header"><a className="dc-store-brand" href="/loja"><img src="/logo-doce-cacau.jpeg" alt="Doce Cacau"/><span><b>DOCE CACAU</b><small>CHOCOLATERIA</small></span></a><button className="dc-cart-trigger" onClick={()=>setCartOpen(true)}><ShoppingBag size={18}/> Minha sacola <i>{count}</i></button></header>
    <section className="dc-store-hero"><div className="dc-hero-copy"><span className="dc-eyebrow">UM PRESENTE EM CADA DETALHE</span><h1>Pequenos prazeres.<br/><em>Grandes momentos.</em></h1><p>Descubra nossa seleção especial de chocolates e escolha seus favoritos.</p><a href="#produtos">Explorar produtos <ArrowRight size={16}/></a></div><div className="dc-hero-art"><div className="dc-hero-orbit"/><div className="dc-hero-seal">DOCE<br/>CACAU</div></div></section>
    <section className="dc-products-section" id="produtos"><div className="dc-section-heading"><div><span className="dc-eyebrow">NOSSA SELEÇÃO</span><h2>Escolha seus favoritos</h2><p>Produtos selecionados para adoçar seu dia.</p></div><label className="dc-search"><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar produto..."/><span>⌕</span></label></div>
      {loading?<div className="dc-state">Preparando nossa vitrine...</div>:error?<div className="dc-state dc-error">{error}</div>:filtered.length===0?<div className="dc-state">{products.length?'Nenhum produto encontrado.':'Estamos preparando novidades. Volte em breve!'}</div>:<div className="dc-product-grid">{filtered.map(product=><article className="dc-product-card" key={product.id}><ProductGallery product={product}/><div className="dc-product-info"><small>{product.category||product.brand||'Nossa seleção'}</small><h3>{product.name}</h3><div className="dc-product-bottom"><b>{money(product.price)}</b><button aria-label={`Adicionar ${product.name}`} onClick={()=>add(product)}><Plus size={18}/></button></div></div></article>)}</div>}</section>
    <footer className="dc-store-footer"><span>DOCE CACAU</span><small>Feito com carinho para momentos especiais.</small></footer>
    {cartOpen&&<div className="dc-cart-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCartOpen(false)}}><aside className="dc-cart-drawer"><header><div><span className="dc-eyebrow">SEU PEDIDO</span><h2>Minha sacola</h2></div><button className="dc-icon-button" onClick={()=>setCartOpen(false)} aria-label="Fechar"><X/></button></header>{cart.length===0?<div className="dc-empty-cart">Sua sacola está esperando por você.</div>:<><div className="dc-cart-items">{cart.map(item=><div className="dc-cart-item" key={item.product.id}><div><b>{item.product.name}</b><small>{money(item.product.price)} cada</small></div><div className="dc-quantity"><button onClick={()=>change(item.product.id,-1)} aria-label="Diminuir"><Minus size={14}/></button><b>{item.quantity}</b><button onClick={()=>change(item.product.id,1)} aria-label="Aumentar"><Plus size={14}/></button></div></div>)}</div><div className="dc-cart-total"><span>Subtotal</span><b>{money(total)}</b></div><button className="dc-checkout-disabled" onClick={()=>{setCartOpen(false);setCheckout(true)}}>Continuar pedido <ArrowRight size={17}/></button></>}</aside></div>}
  </main>
}
