import { useEffect, useMemo, useState } from 'react'
import { jsPDF } from 'jspdf'
import {
  LayoutDashboard, Package, ShoppingCart, ClipboardList, Users, BarChart3, Search,
  Plus, ScanBarcode, LogOut, Menu, X, TrendingUp, AlertTriangle, Wallet,
  CalendarDays, Trash2, Check, Pencil, Minus, RefreshCw, PackagePlus, Store, FileSpreadsheet, FileText, Eye, Undo2
} from 'lucide-react'
import type { Movement, Order, OrderItem, PaymentRecord, Product, StoreData } from './types'
import { dateNow, loadStore, money, saveStore, uid } from './lib/store'
import { auth, db, firebaseReady, teamAuth } from './lib/firebase'
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword, updateProfile } from 'firebase/auth'
import {
  collection, onSnapshot, setDoc, doc, getDoc, runTransaction, serverTimestamp
} from 'firebase/firestore'
import Modal from './components/Modal'
import Scanner from './components/Scanner'

type Page = 'dashboard'|'products'|'pos'|'orders'|'stock'|'finance'|'reports'|'users'
type TeamUser = { uid:string; name:string; email:string; role?:string; active?:boolean; lastLoginAt?:any; createdAt?:any }

function sumOrderPayments(order: Pick<Order,'payments'>): number {
  return (order.payments||[]).reduce((sum,payment)=> {
    const amount=Number(payment.amount)
    return sum+(Number.isFinite(amount)&&amount>0?amount:0)
  },0)
}
function getOrderPaymentStatus(order: Pick<Order,'total'|'payments'>): Order['paymentStatus'] {
  const received=sumOrderPayments(order)
  return received>=Number(order.total)-0.001?'Pago':received>0?'Parcial':'A pagar'
}

function formatCurrencyInput(value:number):string {
  return (Number.isFinite(value)?Math.max(0,value):0).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})
}
function CurrencyInput({value,onChange,max,className}:{value:number;onChange:(value:number)=>void;max?:number;className?:string}) {
  return <input className={className} type="text" inputMode="decimal" value={formatCurrencyInput(value)} onChange={e=>{
    const digits=e.target.value.replace(/\D/g,'')
    const parsed=digits?Number(digits)/100:0
    const safeValue=Number.isFinite(parsed)?Math.max(0,parsed):0
    onChange(Math.min(max??Number.MAX_SAFE_INTEGER,safeValue))
  }} />
}

const nav = [
  {id:'dashboard',label:'Visão geral',icon:LayoutDashboard},
  {id:'products',label:'Produtos',icon:Package},
  {id:'pos',label:'Frente de caixa',icon:ShoppingCart},
  {id:'orders',label:'Vendas e reservas',icon:ClipboardList},
  {id:'stock',label:'Estoque',icon:PackagePlus},
  {id:'finance',label:'Financeiro',icon:Wallet},
  {id:'reports',label:'Relatórios',icon:BarChart3},
  {id:'users',label:'Equipe',icon:Users}
] as const
const blank: StoreData = { products:[], orders:[], movements:[] }

export default function App() {
  const [data,setData] = useState<StoreData>(loadStore)
  const [page,setPage] = useState<Page>('dashboard')
  const [user,setUser] = useState({name:'Administrador',email:'admin@docecacau.local'})
  const [logged,setLogged] = useState(!firebaseReady)
  const [loginEmail,setLoginEmail] = useState('')
  const [loginPass,setLoginPass] = useState('')
  const [loginError,setLoginError] = useState('')
  const [teamUsers,setTeamUsers] = useState<TeamUser[]>([])
  const [newTeamName,setNewTeamName] = useState('')
  const [newTeamEmail,setNewTeamEmail] = useState('')
  const [newTeamPassword,setNewTeamPassword] = useState('')
  const [profileName,setProfileName] = useState('')
  const [selectedTeamUser,setSelectedTeamUser] = useState<TeamUser|null>(null)
  const [savingProfile,setSavingProfile] = useState(false)
  const [creatingTeamUser,setCreatingTeamUser] = useState(false)
  const [mobileOpen,setMobileOpen] = useState(false)
  const [modal,setModal] = useState<'product'|'scanner'|'stock'|'order'|null>(null)
  const [scannerOpen,setScannerOpen] = useState(false)
  const [scannedBarcode,setScannedBarcode] = useState('')
  const [editing,setEditing] = useState<Product|null>(null)
  const [search,setSearch] = useState('')
  const [pickerOpen,setPickerOpen] = useState(false)
  const [toast,setToast] = useState('')
  const [cart,setCart] = useState<OrderItem[]>([])
  const [scanTarget,setScanTarget] = useState<'product'|'cart'>('product')
  const [paymentOrder,setPaymentOrder] = useState<Order|null>(null)
  const [orderEditor,setOrderEditor] = useState<Order|null>(null)
  const [orderDetails,setOrderDetails] = useState<Order|null>(null)
  const [cancelTarget,setCancelTarget] = useState<Order|null>(null)
  const [financeRange,setFinanceRange] = useState<'today'|'7days'|'30days'|'all'>('today')
  const todayISO = new Date().toLocaleDateString('en-CA')
  const firstDayISO = `${todayISO.slice(0,8)}01`
  const [reportFrom,setReportFrom] = useState(firstDayISO)
  const [reportTo,setReportTo] = useState(todayISO)

  useEffect(()=>{ if(!firebaseReady) saveStore(data) },[data])
  useEffect(()=>{
    if(!auth) return
    return onAuthStateChanged(auth, async u=>{
      if(u){
        // O nome salvo no cadastro da equipe é a fonte principal.
        // O displayName do Authentication e o e-mail são apenas alternativas.
        let displayName = u.displayName || u.email?.split('@')[0] || 'Usuário'
        if(db){
          const userRef=doc(db,'stores','doce-cacau','users',u.uid)
          try{
            const profileSnap=await getDoc(userRef)
            const savedName=profileSnap.exists()?String(profileSnap.data().name||'').trim():''
            if(savedName) displayName=savedName
          }catch(e){
            console.error('Não foi possível carregar o nome do perfil:',e)
          }
          await setDoc(userRef,{
            uid:u.uid,name:displayName,email:u.email||'',role:'Administrador',
            lastLoginAt:serverTimestamp(),lastLoginName:displayName
          },{merge:true}).catch(e=>notify('Não foi possível atualizar o perfil: '+e.message))
        }
        setUser({name:displayName,email:u.email||''})
        setProfileName(displayName)
        setLogged(true)
      } else {
        setLogged(false)
        setData(blank)
      }
    })
  },[])
  useEffect(()=>{
    if(!db || !logged) return
    const unsubs = [
      onSnapshot(collection(db,'stores','doce-cacau','products'), snap=>{
        const now=Date.now()
        const products=snap.docs.map(d=>({...d.data(),id:d.id} as Product))
        // A contagem começa quando o sistema identifica estoque zero. Produtos antigos
        // sem a data recebem a data de início agora, evitando arquivamento retroativo.
        products.forEach(product=>{
          if(product.archived) return
          const ref=doc(db!,'stores','doce-cacau','products',product.id)
          if(Number(product.stock)>0 && product.outOfStockSince){
            void setDoc(ref,{outOfStockSince:null},{merge:true})
          } else if(Number(product.stock)<=0 && !product.outOfStockSince){
            void setDoc(ref,{outOfStockSince:new Date(now).toISOString()},{merge:true})
          } else if(Number(product.stock)<=0 && product.outOfStockSince && now-new Date(product.outOfStockSince).getTime()>=90*24*60*60*1000){
            void setDoc(ref,{archived:true,archivedAt:new Date(now).toISOString(),archiveReason:'Sem estoque por mais de 90 dias'},{merge:true})
          }
        })
        setData(old=>({...old,products}))
      }, e=>notify('Erro ao carregar produtos: '+e.message)),
      onSnapshot(collection(db,'stores','doce-cacau','orders'), snap=>{
        setData(old=>({...old,orders:snap.docs.map(d=>{const raw={...d.data(),id:d.id} as Order;const paid=sumOrderPayments(raw);return {...raw,paid,paymentStatus:getOrderPaymentStatus(raw)}}).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}))
      }, e=>notify('Erro ao carregar pedidos: '+e.message)),
      onSnapshot(collection(db,'stores','doce-cacau','stock_movements'), snap=>{
        setData(old=>({...old,movements:snap.docs.map(d=>({...d.data(),id:d.id} as Movement)).sort((a,b)=>b.date.localeCompare(a.date))}))
      }, e=>notify('Erro ao carregar estoque: '+e.message))
      ,
      onSnapshot(collection(db,'stores','doce-cacau','users'), snap=>{
        setTeamUsers(snap.docs.map(d=>({...d.data(),uid:d.id} as TeamUser)).sort((a,b)=>(a.name||'').localeCompare(b.name||'')))
      }, e=>notify('Erro ao carregar equipe: '+e.message))
    ]
    return ()=>unsubs.forEach(unsub=>unsub())
  },[logged])
  // Reavalia produtos sem estoque periodicamente enquanto o sistema estiver aberto.
  // O snapshot continua fazendo a verificação imediata ao carregar/alterar produtos.
  useEffect(()=>{
    if(!db || !logged) return
    const archiveExpiredProducts=async()=>{
      const now=Date.now()
      const expired=data.products.filter(p=>!p.archived&&Number(p.stock)<=0&&p.outOfStockSince&&now-new Date(p.outOfStockSince).getTime()>=90*24*60*60*1000)
      await Promise.all(expired.map(p=>setDoc(doc(db!,'stores','doce-cacau','products',p.id),{archived:true,archivedAt:new Date(now).toISOString(),archiveReason:'Sem estoque por 90 dias'},{merge:true}).catch(e=>console.error('Falha ao arquivar produto:',p.id,e))))
    }
    void archiveExpiredProducts()
    const timer=window.setInterval(()=>void archiveExpiredProducts(),60*1000)
    return ()=>window.clearInterval(timer)
  },[logged,data.products])
  async function persist(next:StoreData) {
    // Mantido apenas como fallback local; no Firebase cada operação grava
    // documentos próprios para evitar sobrescrever o banco inteiro.
    setData(next)
    if(!firebaseReady) saveStore(next)
  }
  function notify(msg:string){setToast(msg);window.setTimeout(()=>setToast(''),3200)}
  async function login(e:React.FormEvent){
    e.preventDefault();setLoginError('')
    try { if(auth){const c=await signInWithEmailAndPassword(auth,loginEmail,loginPass);setUser({name:c.user.email?.split('@')[0]||'Usuário',email:c.user.email||''});setLogged(true)} }
    catch {setLoginError('E-mail ou senha inválidos.')}
  }
  async function logout(){if(auth)await signOut(auth);else setLogged(false)}
  async function saveOwnProfile(e:React.FormEvent){
    e.preventDefault()
    const name=profileName.trim()
    const current=auth?.currentUser
    const target=selectedTeamUser
    if(!name||!current||!target){notify('Selecione um usuário para editar.');return}
    setSavingProfile(true)
    try{
      if(target.uid===current.uid){
        await updateProfile(current,{displayName:name})
        setUser(old=>({...old,name}))
      }
      if(db){
        await setDoc(doc(db,'stores','doce-cacau','users',target.uid),{
          uid:target.uid,name,email:target.email,role:'Administrador',active:true,
          updatedAt:serverTimestamp(),updatedBy:current.uid,updatedByName:user.name
        },{merge:true})
      }
      setSelectedTeamUser(old=>old?({...old,name}):old)
      notify('Nome atualizado com sucesso!')
    }catch(err){notify('Não foi possível atualizar o nome: '+(err as Error).message)}
    finally{setSavingProfile(false)}
  }
  async function addTeamUser(e:React.FormEvent){
    e.preventDefault()
    const name=newTeamName.trim(), email=newTeamEmail.trim().toLowerCase(), password=newTeamPassword
    if(!name||!email||password.length<6){notify('Informe nome, e-mail e senha com pelo menos 6 caracteres.');return}
    setCreatingTeamUser(true)
    try{
      const credential=await createUserWithEmailAndPassword(teamAuth,email,password)
      await updateProfile(credential.user,{displayName:name})
      if(db){
        await setDoc(doc(db,'stores','doce-cacau','users',credential.user.uid),{
          uid:credential.user.uid,name,email,role:'Administrador',active:true,
          createdAt:serverTimestamp(),createdBy:auth?.currentUser?.uid||null,
          createdByName:user.name,lastLoginAt:null
        })
      }
      await signOut(teamAuth)
      setNewTeamName('');setNewTeamEmail('');setNewTeamPassword('')
      notify('Administrador cadastrado! Ele já pode entrar com seu próprio e-mail e senha.')
    }catch(err){
      await signOut(teamAuth).catch(()=>{})
      const code=(err as {code?:string}).code
      const message=code==='auth/email-already-in-use'?'Este e-mail já possui uma conta no Firebase.':code==='auth/weak-password'?'A senha precisa ter pelo menos 6 caracteres.':(err as Error).message
      notify('Não foi possível cadastrar: '+message)
    }finally{setCreatingTeamUser(false)}
  }
  function openProduct(p?:Product){setScannedBarcode('');setEditing(p||null);setModal('product')}
  function addMovement(product:Product,type:Movement['type'],quantity:number,detail:string){
    return {id:uid(),productId:product.id,productName:product.name,type,quantity,date:dateNow(),user:user.name,detail}
  }
  async function saveProduct(p:Product){
    const old=data.products.find(x=>x.id===p.id)
    try {
      if(db && auth?.currentUser){
        const ref=doc(db,'stores','doce-cacau','products',p.id)
        await runTransaction(db,async tx=>{
          const snap=await tx.get(ref)
          if(snap.exists()){
            const current=snap.data() as Product
            const delta=p.stock-Number(current.stock||0)
            tx.set(ref,{...p,stock:p.stock,outOfStockSince:p.stock>0?null:(Number(current.stock)>0?new Date().toISOString():(current as any).outOfStockSince||new Date().toISOString()),archived:false,updatedAt:serverTimestamp(),updatedBy:auth!.currentUser!.uid,updatedByName:user.name})
            if(delta!==0){
              const movement=addMovement({...p,stock:Number(current.stock||0)},delta>0?'Entrada':'Ajuste',Math.abs(delta),'Ajuste de estoque pelo cadastro do produto')
              tx.set(doc(db!,'stores','doce-cacau','stock_movements',movement.id),movement)
            }
          } else {
            tx.set(ref,{...p,outOfStockSince:p.stock>0?null:new Date().toISOString(),archived:false,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),createdBy:auth!.currentUser!.uid,createdByName:user.name})
            if(p.stock>0){
              const movement=addMovement(p,'Entrada',p.stock,'Estoque inicial')
              tx.set(doc(db!,'stores','doce-cacau','stock_movements',movement.id),movement)
            }
          }
        })
      } else {
        const next={...data,products:old?data.products.map(x=>x.id===p.id?p:x):[p,...data.products]}
        if(!old && p.stock>0) next.movements=[addMovement(p,'Entrada',p.stock,'Estoque inicial'),...data.movements]
        await persist(next)
      }
      setModal(null);notify('Produto salvo no banco de dados.')
    } catch(e) { notify('Não foi possível salvar o produto: '+(e as Error).message) }
  }
  function normalizeBarcode(value:unknown){
    let code=String(value??'').trim().replace(/^\](?:C1|E0|d2)/i,'')
    // ZXing pode devolver espaços ou separadores; para GTIN/EAN comparamos apenas os dígitos.
    const digits=code.replace(/\D/g,'')
    return digits || code.toUpperCase()
  }
  function findBarcode(rawCode:string){
    const code=String(rawCode??'').trim()
    const normalized=normalizeBarcode(code)
    const found=data.products.find(x=>!(x as any).archived&&normalizeBarcode(x.barcode)===normalized)
    setScannerOpen(false)
    if(scanTarget==='cart'){
      if(found) addToCart(found)
      else notify(`Produto não cadastrado. Código lido: ${code}. Cadastre-o primeiro.`)
      return
    }
    // O formulário de produto permanece montado enquanto o leitor fica sobreposto.
    setScannedBarcode(code)
    if(found) notify(`Código reconhecido: ${found.name}. Confira os dados antes de salvar.`)
    else notify('Código lido! Complete os dados do produto e salve o cadastro.')
  }
  async function lookupBarcode(code:string){
    try {
      const r=await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json`)
      const j=await r.json()
      const p=j.product
      if(p) return {name:p.product_name||p.product_name_pt||'',brand:p.brands||'',image:p.image_front_url||''}
    } catch {}
    return null
  }
  function addToCart(p:Product){
    setCart(old=>{const found=old.find(i=>i.productId===p.id);return found?old.map(i=>i.productId===p.id?{...i,quantity:i.quantity+1}:i):[...old,{productId:p.id,name:p.name,barcode:p.barcode,quantity:1,unitPrice:p.price}]})
    notify(`${p.name} adicionado ao carrinho.`)
  }
  const total=cart.reduce((s,i)=>s+i.quantity*i.unitPrice,0)
  async function finishOrder(status:'Reservado'|'Entregue',payment:'Pago'|'A pagar'|'Parcial',customer:string,phone:string,paid:number,method:PaymentRecord['method'],pickup:string,notes:string,discount:number){
    if(!cart.length)return
    const subtotal=cart.reduce((sum,item)=>sum+item.quantity*item.unitPrice,0)
    const appliedDiscount=Math.min(subtotal,Math.max(0,Number(discount)||0))
    const finalTotal=Math.max(0,subtotal-appliedDiscount)
    const safePaid=Math.min(finalTotal,Math.max(0,paid))
    const initialPayments:PaymentRecord[]=safePaid>0?[{id:uid(),amount:safePaid,method,date:dateNow(),user:user.name,userId:auth?.currentUser?.uid}]:[]
    const recordedPaid=initialPayments.reduce((sum,p)=>sum+p.amount,0)
    const effectivePayment:Order['paymentStatus']=recordedPaid>=finalTotal-0.001?'Pago':recordedPaid>0?'Parcial':'A pagar'
    const order:Order={id:uid(),customer,phone,items:cart,subtotal,discount:appliedDiscount,total:finalTotal, paymentStatus:effectivePayment,deliveryStatus:status,paid:recordedPaid,payments:initialPayments,seller:user.name,createdAt:dateNow(),pickupDate:pickup,notes}
    try {
      if(db && auth?.currentUser){
        await runTransaction(db,async tx=>{
          const refs=cart.map(i=>({item:i,ref:doc(db,'stores','doce-cacau','products',i.productId)}))
          const snaps=await Promise.all(refs.map(x=>tx.get(x.ref)))
          snaps.forEach((snap,index)=>{
            const item=refs[index].item
            if(!snap.exists()) throw new Error(`Produto não encontrado: ${item.name}`)
            const product=snap.data() as Product
            if((product as any).archived) throw new Error(`Produto arquivado e indisponível para venda: ${item.name}`)
            if(Number(product.stock)<item.quantity) throw new Error(`Estoque insuficiente: ${item.name}`)
          })
          snaps.forEach((snap,index)=>{
            const item=refs[index].item
            const product=snap.data() as Product
            const nextStock=Number(product.stock)-item.quantity
            tx.update(refs[index].ref,{stock:nextStock,outOfStockSince:nextStock>0?null:(product as any).outOfStockSince||new Date().toISOString(),updatedAt:serverTimestamp()})
            const movement=addMovement({...product,id:snap.id},status==='Reservado'?'Reserva':'Saída',item.quantity,status==='Reservado'?'Reserva de pedido':'Venda no PDV')
            tx.set(doc(db!,'stores','doce-cacau','stock_movements',movement.id),movement)
          })
          tx.set(doc(db!,'stores','doce-cacau','orders',order.id),{...order,createdBy:auth!.currentUser!.uid,createdByName:user.name,createdAt:order.createdAt,serverCreatedAt:serverTimestamp()})
        })
      } else {
        for(const i of cart){const p=data.products.find(x=>x.id===i.productId);if(!p||(p as any).archived||p.stock<i.quantity){notify(`Produto indisponível ou estoque insuficiente: ${i.name}`);return}}
        const products=data.products.map(p=>{const item=cart.find(i=>i.productId===p.id);return item?{...p,stock:p.stock-item.quantity}:p})
        const movements=cart.map(i=>{const p=data.products.find(p=>p.id===i.productId)!;return addMovement(p,status==='Reservado'?'Reserva':'Saída',i.quantity,status==='Reservado'?'Reserva de pedido':'Venda no PDV')})
        await persist({...data,products,orders:[order,...data.orders],movements:[...movements,...data.movements]})
      }
      setCart([]);setModal(null);setPage('pos');notify(status==='Reservado'?'Reserva registrada no Firebase.':'Venda salva no Firebase.')
    } catch(e) { notify((e as Error).message || 'Não foi possível concluir o pedido.') }
  }
  async function changeOrder(o:Order,patch:Partial<Order>){
    if(o.isCanceled){notify('Venda estornada não pode ser alterada.');return}
    if('paid' in patch || 'payments' in patch || 'paymentStatus' in patch){notify('Os pagamentos só podem ser alterados pelo registro de recebimentos.');return}
    const updated={...o,...patch}
    try {
      if(db && auth?.currentUser){
        await runTransaction(db,async tx=>{
          const orderRef=doc(db!,'stores','doce-cacau','orders',o.id)
          const orderSnap=await tx.get(orderRef)
          if(!orderSnap.exists()) throw new Error('Pedido não encontrado.')
          const current=orderSnap.data() as Order
          tx.update(orderRef,{...patch,updatedAt:serverTimestamp(),updatedBy:auth!.currentUser!.uid,updatedByName:user.name})
          if(current.deliveryStatus==='Reservado' && updated.deliveryStatus==='Entregue'){
            current.items.forEach(item=>{
              const movement:Movement={id:uid(),productId:item.productId,productName:item.name,type:'Saída',quantity:item.quantity,date:dateNow(),user:user.name,detail:`Entrega da reserva ${o.id.slice(0,6)}`}
              tx.set(doc(db!,'stores','doce-cacau','stock_movements',movement.id),movement)
            })
          }
        })
      } else {
        let movements=data.movements
        if(o.deliveryStatus==='Reservado' && updated.deliveryStatus==='Entregue'){
          movements=[...o.items.map(i=>({id:uid(),productId:i.productId,productName:i.name,type:'Saída' as const,quantity:i.quantity,date:dateNow(),user:user.name,detail:`Entrega da reserva ${o.id.slice(0,6)}`})),...movements]
        }
        await persist({...data,orders:data.orders.map(x=>x.id===o.id?updated:x),movements})
      }
      notify('Pedido atualizado.')
    } catch(e) { notify('Falha ao atualizar pedido: '+(e as Error).message) }
  }
  async function saveOrderEdit(original:Order, patch:Pick<Order,'customer'|'phone'|'items'|'discount'|'notes'|'pickupDate'>){
    if(original.isCanceled){notify('Uma venda estornada não pode ser editada.');return}
    const subtotal=patch.items.reduce((sum,item)=>sum+item.quantity*item.unitPrice,0)
    const discount=Math.min(subtotal,Math.max(0,Number(patch.discount)||0))
    const total=Math.max(0,subtotal-discount)
    const received=sumOrderPayments(original)
    if(total+0.001<received){notify('O novo total não pode ser menor que os pagamentos já recebidos. Faça a conferência financeira antes de editar.');return}
    const oldQty=new Map<string,number>(), newQty=new Map<string,number>()
    original.items.forEach(i=>oldQty.set(i.productId,(oldQty.get(i.productId)||0)+i.quantity))
    patch.items.forEach(i=>newQty.set(i.productId,(newQty.get(i.productId)||0)+i.quantity))
    const productIds=[...new Set([...oldQty.keys(),...newQty.keys()])]
    const updated:Order={...original,...patch,subtotal,discount,total,paid:received,paymentStatus:received>=total-0.001?'Pago':received>0?'Parcial':'A pagar',updatedBy:user.name}
    try{
      if(db&&auth?.currentUser){
        await runTransaction(db,async tx=>{
          const orderRef=doc(db!,'stores','doce-cacau','orders',original.id)
          const orderSnap=await tx.get(orderRef)
          if(!orderSnap.exists())throw new Error('Venda não encontrada.')
          const current=orderSnap.data() as Order
          if(current.isCanceled)throw new Error('Esta venda já foi estornada.')
          if(total+0.001<sumOrderPayments(current))throw new Error('O novo total é menor que os recebimentos registrados.')
          const refs=productIds.map(id=>({id,ref:doc(db!,'stores','doce-cacau','products',id)}))
          const snaps=await Promise.all(refs.map(x=>tx.get(x.ref)))
          snaps.forEach((snap,index)=>{
            if(!snap.exists())throw new Error('Produto não encontrado ao ajustar estoque.')
            const delta=(oldQty.get(refs[index].id)||0)-(newQty.get(refs[index].id)||0)
            const product=snap.data() as Product
            if(delta<0&&Number(product.stock)<-delta)throw new Error(`Estoque insuficiente para aumentar ${product.name}.`)
          })
          snaps.forEach((snap,index)=>{
            const id=refs[index].id, delta=(oldQty.get(id)||0)-(newQty.get(id)||0)
            if(!delta)return
            const product=snap.data() as Product, next=Number(product.stock)+delta
            tx.update(refs[index].ref,{stock:next,outOfStockSince:next>0?null:product.outOfStockSince||new Date().toISOString(),updatedAt:serverTimestamp()})
            const movement=addMovement({...product,id},delta>0?'Entrada':'Saída',Math.abs(delta),`Ajuste por edição da venda ${original.id.slice(0,7)}`)
            tx.set(doc(db!,'stores','doce-cacau','stock_movements',movement.id),movement)
          })
          tx.update(orderRef,{...patch,subtotal,discount,total,paid:sumOrderPayments(current),paymentStatus:sumOrderPayments(current)>=total-0.001?'Pago':sumOrderPayments(current)>0?'Parcial':'A pagar',updatedAt:serverTimestamp(),updatedBy:auth!.currentUser!.uid,updatedByName:user.name})
        })
      }else{
        const products=data.products.map(p=>{const delta=(oldQty.get(p.id)||0)-(newQty.get(p.id)||0);return delta?{...p,stock:p.stock+delta}:p})
        const movements=productIds.flatMap(id=>{const delta=(oldQty.get(id)||0)-(newQty.get(id)||0);const p=data.products.find(x=>x.id===id);return delta&&p?[addMovement(p,delta>0?'Entrada':'Saída',Math.abs(delta),`Ajuste por edição da venda ${original.id.slice(0,7)}`)]:[]})
        await persist({...data,products,orders:data.orders.map(o=>o.id===original.id?updated:o),movements:[...movements,...data.movements]})
      }
      setOrderEditor(null);notify('Venda atualizada e estoque ajustado.')
    }catch(e){notify('Não foi possível editar a venda: '+(e as Error).message)}
  }
  async function cancelOrder(order:Order,reason:string){
    if(order.isCanceled){notify('Esta venda já foi estornada.');return}
    if(!reason.trim()){notify('Informe o motivo do estorno.');return}
    try{
      if(db&&auth?.currentUser){
        await runTransaction(db,async tx=>{
          const orderRef=doc(db!,'stores','doce-cacau','orders',order.id), orderSnap=await tx.get(orderRef)
          if(!orderSnap.exists())throw new Error('Venda não encontrada.')
          const current=orderSnap.data() as Order
          if(current.isCanceled)throw new Error('Esta venda já foi estornada.')
          const refs=current.items.map(item=>({item,ref:doc(db!,'stores','doce-cacau','products',item.productId)}))
          const snaps=await Promise.all(refs.map(x=>tx.get(x.ref)))
          snaps.forEach((snap,index)=>{if(!snap.exists())throw new Error(`Produto não encontrado: ${refs[index].item.name}`)})
          snaps.forEach((snap,index)=>{
            const item=refs[index].item, product=snap.data() as Product, next=Number(product.stock)+item.quantity
            tx.update(refs[index].ref,{stock:next,outOfStockSince:null,updatedAt:serverTimestamp()})
            const movement=addMovement({...product,id:snap.id},'Entrada',item.quantity,`Estorno da venda ${order.id.slice(0,7)}: ${reason.trim()}`)
            tx.set(doc(db!,'stores','doce-cacau','stock_movements',movement.id),movement)
          })
          tx.update(orderRef,{isCanceled:true,canceledAt:dateNow(),canceledBy:auth!.currentUser!.uid,canceledByName:user.name,cancelReason:reason.trim(),updatedAt:serverTimestamp(),updatedBy:auth!.currentUser!.uid,updatedByName:user.name})
        })
      }else{
        const products=data.products.map(p=>{const qty=order.items.filter(i=>i.productId===p.id).reduce((a,i)=>a+i.quantity,0);return qty?{...p,stock:p.stock+qty,outOfStockSince:null}:p})
        const movements=order.items.map(i=>{const p=data.products.find(x=>x.id===i.productId)!;return addMovement(p,'Entrada',i.quantity,`Estorno da venda ${order.id.slice(0,7)}: ${reason.trim()}`)})
        await persist({...data,products,orders:data.orders.map(o=>o.id===order.id?{...o,isCanceled:true,canceledAt:dateNow(),canceledByName:user.name,cancelReason:reason.trim()}:o),movements:[...movements,...data.movements]})
      }
      setCancelTarget(null);notify('Venda estornada. Estoque devolvido e histórico preservado. Os pagamentos registrados foram mantidos para conferência.')
    }catch(e){notify('Não foi possível estornar: '+(e as Error).message)}
  }
  async function registerPayment(o:Order,amount:number,method:PaymentRecord['method']){
    if(o.isCanceled){notify('Não é possível receber pagamento de uma venda estornada.');return}
    if(!Number.isFinite(amount)||amount<=0){notify('Informe um valor de pagamento válido.');return}
    const payment:PaymentRecord={id:uid(),amount,method,date:dateNow(),user:user.name,userId:auth?.currentUser?.uid}
    try{
      if(db && auth?.currentUser){
        await runTransaction(db,async tx=>{
          const ref=doc(db!,'stores','doce-cacau','orders',o.id)
          const snap=await tx.get(ref)
          if(!snap.exists()) throw new Error('Pedido não encontrado.')
          const current=snap.data() as Order
          const currentPaid=sumOrderPayments(current)
          const remaining=Math.max(0,Number(current.total)-currentPaid)
          if(amount>remaining+0.001) throw new Error('O valor informado é maior que o saldo pendente.')
          const nextPaid=Math.min(Number(current.total),currentPaid+amount)
          const payments=[...(current.payments||[]),payment]
          tx.update(ref,{paid:nextPaid,paymentStatus:nextPaid>=Number(current.total)-0.001?'Pago':'Parcial',payments,updatedAt:serverTimestamp(),updatedBy:auth!.currentUser!.uid,updatedByName:user.name})
        })
      }else{
        const current=data.orders.find(x=>x.id===o.id)
        if(!current) throw new Error('Pedido não encontrado.')
        const currentPaid=sumOrderPayments(current)
        const remaining=Math.max(0,current.total-currentPaid)
        if(amount>remaining+0.001) throw new Error('O valor informado é maior que o saldo pendente.')
        const nextPaid=Math.min(current.total,currentPaid+amount)
        const updated={...current,paid:nextPaid,paymentStatus:(nextPaid>=current.total-0.001?'Pago':'Parcial') as Order['paymentStatus'],payments:[...(current.payments||[]),payment]}
        await persist({...data,orders:data.orders.map(x=>x.id===o.id?updated:x)})
      }
      setPaymentOrder(null)
      notify('Pagamento registrado com sucesso.')
    }catch(e){notify('Não foi possível registrar o pagamento: '+(e as Error).message)}
  }
  async function adjustStock(p:Product,qty:number,detail:string){
    try {
      if(db && auth?.currentUser){
        await runTransaction(db,async tx=>{
          const ref=doc(db!,'stores','doce-cacau','products',p.id)
          const snap=await tx.get(ref)
          if(!snap.exists()) throw new Error('Produto não encontrado.')
          const current=snap.data() as Product
          const nextStock=Number(current.stock)+qty
          if(nextStock<0) throw new Error('A quantidade de saída é maior que o estoque disponível.')
          tx.update(ref,{stock:nextStock,outOfStockSince:nextStock>0?null:(current as any).outOfStockSince||new Date().toISOString(),updatedAt:serverTimestamp(),updatedBy:auth!.currentUser!.uid,updatedByName:user.name})
          const movement=addMovement({...current,id:p.id},qty>=0?'Entrada':'Ajuste',Math.abs(qty),detail)
          tx.set(doc(db!,'stores','doce-cacau','stock_movements',movement.id),movement)
        })
      } else {
        const nextStock=Math.max(0,p.stock+qty);const nextP={...p,stock:nextStock,outOfStockSince:nextStock>0?undefined:(p as any).outOfStockSince||new Date().toISOString()}
        await persist({...data,products:data.products.map(x=>x.id===p.id?nextP:x),movements:[addMovement(p,qty>=0?'Entrada':'Ajuste',Math.abs(qty),detail),...data.movements]})
      }
      setModal(null);notify('Estoque atualizado.')
    } catch(e) { notify('Falha ao movimentar estoque: '+(e as Error).message) }
  }
  const activeProducts=data.products.filter(p=>!(p as any).archived)
  const archivedProducts=data.products.filter(p=>Boolean((p as any).archived))
  const low=activeProducts.filter(p=>p.stock<=p.minStock)
  const monthOrders=data.orders.filter(o=>!o.isCanceled&&new Date(o.createdAt).getMonth()===new Date().getMonth()&&new Date(o.createdAt).getFullYear()===new Date().getFullYear())
  const monthTotal=monthOrders.reduce((s,o)=>s+o.total,0)
  const unpaid=data.orders.filter(o=>!o.isCanceled).reduce((s,o)=>s+Math.max(0,o.total-sumOrderPayments(o)),0)
  const filteredProducts=activeProducts.filter(p=>(p.name+' '+p.barcode+' '+p.category).toLowerCase().includes(search.toLowerCase()))
  const filteredOrders=data.orders.filter(o=>(o.customer+' '+o.seller+' '+o.id).toLowerCase().includes(search.toLowerCase()))
  if(!logged) return <div className="login-screen"><div className="login-card"><img src="/logo-doce-cacau.jpeg"/><h1>Bem-vindo à Doce Cacau</h1><p>Gestão inteligente da sua chocolateria</p><form onSubmit={login}><label>E-mail<input type="email" value={loginEmail} onChange={e=>setLoginEmail(e.target.value)} required/></label><label>Senha<input type="password" value={loginPass} onChange={e=>setLoginPass(e.target.value)} required/></label>{loginError&&<p className="error">{loginError}</p>}<button className="primary full">Entrar</button></form><small>Cadastre os usuários no Firebase Authentication.</small></div></div>
  function isWithinReportPeriod(value?:string){
    if(!value) return false
    const date=new Date(value)
    const from=reportFrom?new Date(`${reportFrom}T00:00:00`):null
    const to=reportTo?new Date(`${reportTo}T23:59:59.999`):null
    return (!from||date>=from)&&(!to||date<=to)
  }
  function getReportOrders(){
    return data.orders.filter(o=>!o.isCanceled&&isWithinReportPeriod(o.createdAt))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt))
  }
  function getReportCancellations(){
    return data.orders.filter(o=>o.isCanceled&&isWithinReportPeriod(o.canceledAt||o.createdAt))
      .sort((a,b)=>(b.canceledAt||b.createdAt).localeCompare(a.canceledAt||a.createdAt))
  }
  async function exportProductCatalogPdf(){
    const availableProducts=activeProducts
      .filter(p=>Number(p.stock)>0)
      .sort((a,b)=>(a.category||'').localeCompare(b.category||'','pt-BR')||a.name.localeCompare(b.name,'pt-BR'))
    if(!availableProducts.length){notify('Não há produtos com estoque disponível para incluir no catálogo.');return}
    const pdf=new jsPDF({orientation:'portrait',unit:'mm',format:'a4'})
    const pageW=210,pageH=297,margin=14,gap=7
    const brown:[number,number,number]=[91,58,43]
    const muted:[number,number,number]=[145,119,104]
    const cream:[number,number,number]=[250,244,238]
    const gold:[number,number,number]=[190,145,111]
    const columns=3
    const cardGap=5
    const cardW=(pageW-margin*2-cardGap*(columns-1))/columns
    const cardH=103
    const startY=56
    const rowGap=5
    const cardsPerPage=6
    const dateText=new Date().toLocaleDateString('pt-BR')
    const token=await auth.currentUser?.getIdToken()
    const imageCache=new Map<string,string|null>()
    const resolveDriveId=(p:Product)=>{
      if(p.driveFileId)return p.driveFileId
      const url=String(p.image||'')
      return url.match(/[?&]id=([a-zA-Z0-9_-]+)/)?.[1] || url.match(/\/d\/([a-zA-Z0-9_-]+)/)?.[1] || ''
    }
    const loadProductImage=async(fileId:string)=>{
      if(!fileId)return null
      if(imageCache.has(fileId))return imageCache.get(fileId)??null
      try{
        if(!token)throw new Error('Sessão não encontrada. Faça login novamente.')
        const response=await fetch(`/api/drive/image/${encodeURIComponent(fileId)}`,{headers:{Authorization:`Bearer ${token}`}})
        if(!response.ok){const detail=await response.text().catch(()=> '');throw new Error(`API de imagem (${response.status}) ${detail.slice(0,160)}`)}
        const blob=await response.blob()
        if(!blob.type.startsWith('image/'))throw new Error(`O Drive retornou um arquivo inválido (${blob.type||'sem tipo'}).`)
        // jsPDF não interpreta WEBP de forma consistente. Convertemos qualquer
        // formato de imagem recebido do Drive para JPEG antes de inserir no PDF.
        const bitmap=await createImageBitmap(blob)
        const canvas=document.createElement('canvas')
        canvas.width=bitmap.width
        canvas.height=bitmap.height
        const context=canvas.getContext('2d')
        if(!context)throw new Error('Não foi possível preparar a imagem para o catálogo.')
        context.fillStyle='#ffffff'
        context.fillRect(0,0,canvas.width,canvas.height)
        context.drawImage(bitmap,0,0)
        bitmap.close()
        const dataUrl=canvas.toDataURL('image/jpeg',0.9)
        imageCache.set(fileId,dataUrl);return dataUrl
      }catch(error){console.warn('Foto não incluída no catálogo:',fileId,error);imageCache.set(fileId,null);return null}
    }
    const drawHeader=(page:number)=>{
      pdf.setFillColor(...cream);pdf.rect(0,0,pageW,43,'F')
      pdf.setFillColor(...brown);pdf.rect(0,0,5,pageH,'F')
      pdf.setTextColor(...brown);pdf.setFont('helvetica','bold');pdf.setFontSize(22);pdf.text('DOCE CACAU',margin,18)
      pdf.setFont('helvetica','normal');pdf.setFontSize(9);pdf.setTextColor(...muted);pdf.text('CHOCOLATES DISPONÍVEIS',margin,25)
      pdf.setFont('helvetica','bold');pdf.setFontSize(12);pdf.setTextColor(...brown);pdf.text('CATÁLOGO DE PRODUTOS',margin,37)
      pdf.setFont('helvetica','normal');pdf.setFontSize(8);pdf.setTextColor(...muted);pdf.text(`Atualizado em ${dateText}`,pageW-margin,18,{align:'right'});pdf.text('Consulte disponibilidade antes de finalizar seu pedido.',pageW-margin,25,{align:'right'})
      pdf.setDrawColor(...gold);pdf.setLineWidth(.35);pdf.line(margin,45,pageW-margin,45)
      pdf.setFontSize(8);pdf.setTextColor(...muted);pdf.text(`${availableProducts.length} produto(s) disponível(is)`,margin,51);pdf.text(`Página ${page}`,pageW-margin,51,{align:'right'})
    }
    const drawFooter=()=>{pdf.setDrawColor(232,218,207);pdf.line(margin,pageH-14,pageW-margin,pageH-14);pdf.setFont('helvetica','normal');pdf.setFontSize(7);pdf.setTextColor(...muted);pdf.text('Doce Cacau · Catálogo gerado automaticamente pelo estoque da loja',pageW/2,pageH-9,{align:'center'})}
    for(let index=0;index<availableProducts.length;index++){
      const p=availableProducts[index]
      const page=Math.floor(index/cardsPerPage)+1,local=index%cardsPerPage
      if(local===0){if(index>0)pdf.addPage();drawHeader(page)}
      const col=local%columns,row=Math.floor(local/columns),x=margin+col*(cardW+cardGap),y=startY+row*(cardH+rowGap)
      pdf.setFillColor(255,253,250);pdf.setDrawColor(232,218,207);pdf.setLineWidth(.3);pdf.roundedRect(x,y,cardW,cardH,2.5,2.5,'FD')
      // Cartão vertical: a foto ocupa quase toda a área superior, ideal para
      // fotografias feitas com o celular na posição vertical.
      const imageX=x+2.5,imageY=y+2.5,imageW=cardW-5,imageH=75
      pdf.setFillColor(...cream);pdf.roundedRect(imageX,imageY,imageW,imageH,1.8,1.8,'F')
      const image=await loadProductImage(resolveDriveId(p))
      if(image){try{
        const dims=pdf.getImageProperties(image)
        const scale=Math.min(imageW/dims.width,imageH/dims.height)
        const fittedW=dims.width*scale,fittedH=dims.height*scale
        pdf.addImage(image,'JPEG',imageX+(imageW-fittedW)/2,imageY+(imageH-fittedH)/2,fittedW,fittedH,`product-${p.id}`,'FAST')
      }catch(error){console.warn('Não foi possível inserir imagem no PDF:',p.id,error);pdf.setFont('helvetica','normal');pdf.setFontSize(6);pdf.setTextColor(...muted);pdf.text('FOTO INDISPONÍVEL',imageX+imageW/2,imageY+imageH/2,{align:'center'})}}
      else{pdf.setFont('helvetica','normal');pdf.setFontSize(6);pdf.setTextColor(...muted);pdf.text('FOTO INDISPONÍVEL',imageX+imageW/2,imageY+imageH/2,{align:'center'})}
      const titleY=y+82
      pdf.setFont('helvetica','bold');pdf.setFontSize(7);pdf.setTextColor(...brown)
      const name=pdf.splitTextToSize(p.name||'Produto',cardW-7).slice(0,1);pdf.text(name,x+3.5,titleY)
      const meta=[p.brand,p.category].filter(Boolean).join(' · ')
      pdf.setFont('helvetica','normal');pdf.setFontSize(5.5);pdf.setTextColor(...muted)
      if(meta)pdf.text(pdf.splitTextToSize(meta,cardW-7).slice(0,1),x+3.5,y+89)
      pdf.setFont('helvetica','bold');pdf.setFontSize(8);pdf.setTextColor(...brown);pdf.text(money(p.price),x+3.5,y+98)
      pdf.setFont('helvetica','normal');pdf.setFontSize(5.5);pdf.setTextColor(83,126,91);pdf.text('DISPONÍVEL',x+cardW-3.5,y+98,{align:'right'})
    }
    drawFooter();pdf.save(`doce-cacau-catalogo-${new Date().toISOString().slice(0,10)}.pdf`)
    notify(`Catálogo gerado com ${availableProducts.length} produto(s) em estoque.`)
  }

  function exportReportCsv(){
    const orders=getReportOrders(), cancellations=getReportCancellations()
    const gross=orders.reduce((s,o)=>s+o.total,0)
    const canceled=cancellations.reduce((s,o)=>s+o.total,0)
    const rows=[
      ['Relatório de vendas, estornos e recebimentos - Doce Cacau'],
      ['Período',reportFrom||'Desde o início','até',reportTo||'Hoje'],
      ['Vendas válidas',gross,'Estornos',canceled,'Vendas líquidas',gross-canceled],
      [],
      ['VENDAS'],
      ['Pedido','Data','Cliente','Vendedor','Total do pedido','Total recebido','Saldo pendente','Status pagamento','Entrega'],
      ...orders.map(o=>[o.id,new Date(o.createdAt).toLocaleString('pt-BR'),o.customer,o.seller,o.total,sumOrderPayments(o),Math.max(0,o.total-sumOrderPayments(o)),o.paymentStatus,o.deliveryStatus]),
      [],
      ['ESTORNOS DE VENDAS'],
      ['Pedido','Data do estorno','Cliente','Vendedor','Valor estornado','Motivo','Responsável','Produtos devolvidos'],
      ...cancellations.map(o=>[o.id,new Date(o.canceledAt||o.createdAt).toLocaleString('pt-BR'),o.customer,o.seller,-Math.abs(o.total),o.cancelReason||'',o.canceledByName||o.updatedByName||'',o.items.map(i=>`${i.name} x${i.quantity}`).join(' | ')]),
      [],
      ['RECEBIMENTOS PRESERVADOS EM VENDAS ESTORNADAS (HISTÓRICO)'],
      ['Pedido','Data do recebimento','Cliente','Responsável','Forma','Valor histórico'],
      ...cancellations.flatMap(o=>(o.payments||[]).map(p=>[o.id,new Date(p.date).toLocaleString('pt-BR'),o.customer,p.user,p.method,p.amount])),
      [],
      ['RECEBIMENTOS DE VENDAS VÁLIDAS'],
      ['Pedido','Data do recebimento','Cliente','Responsável','Forma','Valor'],
      ...orders.flatMap(o=>(o.payments||[]).map(p=>[o.id,new Date(p.date).toLocaleString('pt-BR'),o.customer,p.user,p.method,p.amount]))
    ]
    const csv='\\ufeff'+rows.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(';')).join('\\r\\n')
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}))
    const a=document.createElement('a');a.href=url;a.download=`doce-cacau-relatorio-${reportFrom||'inicio'}-${reportTo||'hoje'}.csv`;a.click();URL.revokeObjectURL(url)
  }
  function exportReportPdf(){
    const orders=getReportOrders(), cancellations=getReportCancellations()
    const receipts=orders.flatMap(o=>(o.payments||[]).map(p=>({...p,order:o})))
      .sort((a,b)=>b.date.localeCompare(a.date))
    const canceledReceipts=cancellations.flatMap(o=>(o.payments||[]).map(p=>({...p,order:o})))
      .sort((a,b)=>b.date.localeCompare(a.date))
    const sold=orders.reduce((s,o)=>s+o.total,0)
    const canceled=cancellations.reduce((s,o)=>s+o.total,0)
    const net=sold-canceled
    const received=receipts.reduce((s,p)=>s+p.amount,0)
    const pending=orders.reduce((s,o)=>s+Math.max(0,o.total-sumOrderPayments(o)),0)
    const docPdf=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'})
    const pageW=297, pageH=210, margin=15
    const brown: [number, number, number]=[91,58,43], muted: [number, number, number]=[145,119,104], cream: [number, number, number]=[250,244,238], gold: [number, number, number]=[190,145,111]
    const currency=(v:number)=>money(v)
    const dateLabel=(v:string)=>v?new Date(`${v}T12:00:00`).toLocaleDateString('pt-BR'):'—'
    const addHeader=(continued=false)=>{
      docPdf.setFillColor(...cream);docPdf.rect(0,0,pageW,38,'F')
      docPdf.setFillColor(...brown);docPdf.rect(0,0,5,pageH,'F')
      docPdf.setTextColor(...brown);docPdf.setFont('helvetica','bold');docPdf.setFontSize(20)
      docPdf.text('DOCE CACAU',margin,17)
      docPdf.setFont('helvetica','normal');docPdf.setFontSize(8);docPdf.setTextColor(...muted)
      docPdf.text('CHOCOLATERIA  |  RELATORIO GERENCIAL',margin,23)
      docPdf.setFont('helvetica','bold');docPdf.setFontSize(15);docPdf.setTextColor(...brown)
      docPdf.text(continued?'RELATORIO DE VENDAS E RECEBIMENTOS (CONT.)':'RELATORIO DE VENDAS E RECEBIMENTOS',margin,33)
      docPdf.setFont('helvetica','normal');docPdf.setFontSize(8);docPdf.setTextColor(...muted)
      docPdf.text(`Periodo: ${dateLabel(reportFrom)} ate ${dateLabel(reportTo)}   |   Emitido em ${new Date().toLocaleString('pt-BR')}`,pageW-margin,17,{align:'right'})
    }
    const addFooter=(page:number)=>{
      docPdf.setDrawColor(225,211,200);docPdf.line(margin,pageH-12,pageW-margin,pageH-12)
      docPdf.setFont('helvetica','normal');docPdf.setFontSize(8);docPdf.setTextColor(...muted)
      docPdf.text('Doce Cacau - Controle interno de vendas e recebimentos',margin,pageH-7)
      docPdf.text(`Pagina ${page}`,pageW-margin,pageH-7,{align:'right'})
    }
    let page=1,y=48
    addHeader()
    const metric=(x:number,label:string,value:string)=>{
      docPdf.setFillColor(255,252,249);docPdf.setDrawColor(230,211,196);docPdf.roundedRect(x,y,63,22,3,3,'FD')
      docPdf.setFont('helvetica','normal');docPdf.setFontSize(8);docPdf.setTextColor(...muted);docPdf.text(label,x+4,y+7)
      docPdf.setFont('helvetica','bold');docPdf.setFontSize(12);docPdf.setTextColor(...brown);docPdf.text(value,x+4,y+16)
    }
    metric(margin,'VENDAS VÁLIDAS',currency(sold))
    metric(margin+67,'ESTORNOS',`-${currency(canceled)}`)
    metric(margin+134,'VENDAS LÍQUIDAS',currency(net))
    metric(margin+201,'TOTAL RECEBIDO',currency(received))
    y+=31
    const section=(title:string)=>{
      if(y>pageH-28){addFooter(page);docPdf.addPage();page++;addHeader(true);y=48}
      docPdf.setFont('helvetica','bold');docPdf.setFontSize(11);docPdf.setTextColor(...brown);docPdf.text(title,margin,y);y+=7
    }
    const table=(headers:string[],rows:string[][],widths:number[])=>{
      const rowH=8
      const drawRow=(cells:string[],header=false)=>{
        if(y>pageH-20){addFooter(page);docPdf.addPage();page++;addHeader(true);y=48}
        docPdf.setFillColor(...(header?brown:cream));docPdf.setDrawColor(232,220,211)
        docPdf.rect(margin,y-5,pageW-2*margin,rowH, 'FD')
        docPdf.setFont('helvetica',header?'bold':'normal');docPdf.setFontSize(header?7:7);docPdf.setTextColor(...(header?[255,255,255] as [number, number, number]:brown))
        let x=margin+2
        cells.forEach((cell,i)=>{const max=Math.max(12,widths[i]-3);const text=docPdf.splitTextToSize(String(cell??''),max)[0]||'';docPdf.text(text,x,y);x+=widths[i]})
        y+=rowH
      }
      drawRow(headers,true);rows.forEach(row=>drawRow(row))
      y+=5
    }
    section('VENDAS')
    table(['Pedido','Data','Cliente','Vendedor','Total','Recebido','Pendente','Pagamento','Entrega'],
      orders.map(o=>[o.id.slice(0,8),new Date(o.createdAt).toLocaleDateString('pt-BR'),o.customer||'Nao informado',o.seller,currency(o.total),currency(sumOrderPayments(o)),currency(Math.max(0,o.total-sumOrderPayments(o))),o.paymentStatus,o.deliveryStatus]),
      [19,19,39,28,25,25,25,25,22])
    section('ESTORNOS DE VENDAS')
    table(['Pedido','Data do estorno','Cliente','Responsavel','Valor estornado','Motivo'],
      cancellations.map(o=>[o.id.slice(0,8),new Date(o.canceledAt||o.createdAt).toLocaleString('pt-BR'),o.customer||'Nao informado',o.canceledByName||o.updatedByName||'',`-${currency(o.total)}`,o.cancelReason||'Nao informado']),
      [22,36,42,34,30,83])
    if(canceledReceipts.length){
      section('RECEBIMENTOS PRESERVADOS EM VENDAS ESTORNADAS (HISTORICO)')
      table(['Pedido','Data','Cliente','Responsavel','Forma','Valor historico'],
        canceledReceipts.map(p=>[p.order.id.slice(0,8),new Date(p.date).toLocaleString('pt-BR'),p.order.customer||'Nao informado',p.user,p.method,currency(p.amount)]),
        [22,34,48,38,55,30])
    }
    section('RECEBIMENTOS REGISTRADOS EM VENDAS VALIDAS')
    table(['Pedido','Data','Cliente','Responsavel','Forma de pagamento','Valor'],
      receipts.map(p=>[p.order.id.slice(0,8),new Date(p.date).toLocaleString('pt-BR'),p.order.customer||'Nao informado',p.user,p.method,currency(p.amount)]),
      [22,34,48,38,55,30])
    if(!orders.length&&!cancellations.length){docPdf.setFont('helvetica','normal');docPdf.setFontSize(9);docPdf.setTextColor(...muted);docPdf.text('Nenhum pedido ou estorno encontrado no periodo selecionado.',margin,y)}
    addFooter(page)
    const pdfBlob=docPdf.output('blob')
    const pdfUrl=URL.createObjectURL(pdfBlob)
    const downloadLink=document.createElement('a')
    downloadLink.href=pdfUrl
    downloadLink.download=`doce-cacau-relatorio-${reportFrom||'inicio'}-${reportTo||'hoje'}.pdf`
    downloadLink.style.display='none'
    document.body.appendChild(downloadLink)
    downloadLink.click()
    downloadLink.remove()
    window.setTimeout(()=>URL.revokeObjectURL(pdfUrl),1000)
  }

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen?'open':''}`}><div className="brand"><img src="/logo-doce-cacau.jpeg"/><button className="mobile-close" onClick={()=>setMobileOpen(false)}><X/></button></div><div className="store-label"><Store size={15}/> PAINEL DA CHOCOLATERIA</div><nav>{nav.map(n=>{const Icon=n.icon;return <button key={n.id} className={page===n.id?'nav-item active':'nav-item'} onClick={()=>{setPage(n.id);setMobileOpen(false);setSearch('')}}><Icon size={19}/>{n.label}{n.id==='orders'&&data.orders.some(o=>o.deliveryStatus==='Reservado')&&<i/>}</button>})}</nav><div className="sidebar-bottom"><div className="user-chip"><div className="avatar">{user.name.slice(0,1).toUpperCase()}</div><div><b>{user.name}</b><small>{user.email}</small></div></div><button className="nav-item" onClick={logout}><LogOut size={18}/> Sair</button></div></aside>
    {mobileOpen&&<div className="mobile-scrim" onClick={()=>setMobileOpen(false)}/>}
    <main className="main"><header className="topbar"><button className="icon-btn menu-toggle" onClick={()=>setMobileOpen(true)}><Menu/></button><div><span className="eyebrow">DOCE CACAU /</span><b>{nav.find(n=>n.id===page)?.label}</b></div><div className="top-actions"><div className="avatar" title={user.name}>{user.name.slice(0,1).toUpperCase()}</div></div></header>
    <section className="content">
      {page==='dashboard'&&<><div className="welcome"><div><span className="eyebrow">{new Date().toLocaleDateString('pt-BR',{weekday:'long'}).toLocaleUpperCase('pt-BR')} • DOCE CACAU</span><h1>Olá, {user.name.split(' ')[0]}! <span>☕</span></h1><p>Veja como está a sua chocolateria hoje.</p></div><button className="primary" onClick={()=>setPage('pos')}><Plus size={18}/> Nova venda</button></div><div className="stats-grid"><Stat icon={<Wallet/>} label="Vendas do mês" value={money(monthTotal)} hint={`${monthOrders.length} pedidos registrados`}/><Stat icon={<ClipboardList/>} label="Reservas pendentes" value={String(data.orders.filter(o=>o.deliveryStatus==='Reservado'&&!o.isCanceled).length)} hint="Aguardando retirada"/><Stat icon={<TrendingUp/>} label="A receber" value={money(unpaid)} hint="Saldo de pedidos em aberto"/><Stat icon={<Package/>} label="Produtos cadastrados" value={String(activeProducts.length)} hint={`${low.length} com estoque baixo`}/></div><div className="dashboard-grid"><div className="panel"><div className="panel-title"><div><h2>Movimentações recentes</h2><p>Últimas atividades registradas</p></div><button className="text-btn" onClick={()=>setPage('stock')}>Ver estoque</button></div>{data.movements.slice(0,6).length?data.movements.slice(0,6).map(m=><div className="activity" key={m.id}><span className="activity-icon"><Package size={17}/></span><div><b>{m.productName}</b><small>{m.detail} · {m.user}</small></div><strong className={m.type==='Entrada'?'positive':''}>{m.type==='Entrada'?'+':'−'}{m.quantity}</strong></div>):<Empty text="As movimentações aparecerão aqui quando você cadastrar produtos e registrar vendas."/>}</div><div className="panel"><div className="panel-title"><div><h2>Atenção ao estoque</h2><p>Produtos no limite mínimo</p></div><AlertTriangle size={19} className="warning-text"/></div>{low.length?low.slice(0,6).map(p=><div className="stock-alert" key={p.id}><div><b>{p.name}</b><small>Mínimo: {p.minStock} unidades</small></div><span className="badge danger">{p.stock} un.</span></div>):<Empty text="Nenhum produto com estoque baixo."/>}</div></div><div className="panel"><div className="panel-title"><div><h2>Reservas recentes</h2><p>Pedidos aguardando retirada</p></div><button className="text-btn" onClick={()=>setPage('orders')}>Ver todas</button></div><OrderTable orders={data.orders.filter(o=>o.deliveryStatus==='Reservado'&&!o.isCanceled).slice(0,5)} onChange={changeOrder} onPay={setPaymentOrder} onEdit={setOrderEditor} onCancel={setCancelTarget} onDetails={setOrderDetails}/></div></>}
      {page==='products'&&<><PageHeading title="Produtos" desc="Cadastre e organize os chocolates da sua loja." action={<div className="products-heading-actions"><button className="secondary" onClick={exportProductCatalogPdf}><FileText size={17}/> Catálogo</button><button className="primary" onClick={()=>openProduct()}><Plus size={18}/> Novo produto</button></div>}/><div className="toolbar"><div className="search"><Search/><input placeholder="Buscar por nome, categoria ou código..." value={search} onChange={e=>setSearch(e.target.value)}/></div><button className="secondary" onClick={()=>{setScanTarget('product');setScannerOpen(true)}}><ScanBarcode size={18}/> Ler código</button></div><div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Código de barras</th><th>Categoria</th><th>Custo</th><th>Preço</th><th>Estoque</th><th></th></tr></thead><tbody>{filteredProducts.map(p=><tr key={p.id}><td><b>{p.name}</b><small>{p.brand} · {p.updatedByName||p.createdByName||'Responsável não identificado'}</small></td><td>{p.barcode||'—'}</td><td>{p.category}</td><td>{money(p.cost)}</td><td><b>{money(p.price)}</b></td><td><span className={`badge ${p.stock<=p.minStock?'danger':'success'}`}>{p.stock} un.</span></td><td><button className="icon-btn" onClick={()=>openProduct(p)}><Pencil size={16}/></button></td></tr>)}</tbody></table>{!filteredProducts.length&&<Empty text="Nenhum produto cadastrado. Comece adicionando seu primeiro chocolate."/>}</div></div>{archivedProducts.length>0&&<div className="panel table-panel"><div className="panel-title"><div><h2>Produtos arquivados</h2><p>{archivedProducts.length} produto(s) sem estoque há mais de 90 dias. Histórico preservado.</p></div></div><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Arquivado em</th><th>Último estoque</th><th>Ação</th></tr></thead><tbody>{archivedProducts.map(p=><tr key={p.id}><td><b>{p.name}</b><small>{p.brand} · {p.category}</small></td><td>{(p as any).archivedAt?new Date((p as any).archivedAt).toLocaleDateString('pt-BR'):'—'}</td><td>{p.stock} un.</td><td><button className="secondary small" onClick={async()=>{try{if(db){await setDoc(doc(db,'stores','doce-cacau','products',p.id),{archived:false,archivedAt:null,archiveReason:null,outOfStockSince:p.stock>0?null:new Date().toISOString()},{merge:true})}else{await persist({...data,products:data.products.map(x=>x.id===p.id?({...x,archived:false,archivedAt:null,outOfStockSince:x.stock>0?undefined:new Date().toISOString()} as Product):x)})}notify('Produto reativado com sucesso.')}catch(e){notify('Não foi possível reativar: '+(e as Error).message)}}}>Reativar produto</button></td></tr>)}</tbody></table></div></div>}</>}
      {page==='pos'&&<><PageHeading title="Frente de caixa" desc="Registre vendas e reservas de forma rápida."/><div className="pos-layout"><div className="panel"><div className="panel-title"><div><h2>Adicionar produtos</h2><p>Busque pelo nome ou leia um código de barras.</p></div><div className="pos-actions"><button className="secondary" onClick={()=>setPickerOpen(v=>!v)}><Package size={18}/>{pickerOpen?'Ocultar produtos':'Ver produtos'}</button><button className="secondary" onClick={()=>{setScanTarget('cart');setScannerOpen(true)}}><ScanBarcode size={18}/> Câmera</button></div></div><div className="product-search-area"><div className="search"><Search/><input placeholder="Toque para buscar ou digite o produto..." value={search} onFocus={()=>setPickerOpen(true)} onChange={e=>{setSearch(e.target.value);setPickerOpen(true)}}/></div><div className={`product-picker ${pickerOpen?'open':''}`}>{activeProducts.filter(p=>(p.name+' '+p.barcode).toLowerCase().includes(search.toLowerCase())).map(p=><button className="picker-item" key={p.id} onClick={()=>addToCart(p)} disabled={p.stock<=0}><span className="product-thumb">🍫</span><span><b>{p.name}</b><small>{p.stock} disponíveis</small></span><strong>{money(p.price)}</strong><Plus size={17}/></button>)}</div></div></div><div className="panel cart-panel"><div className="panel-title"><div><h2>Seu pedido</h2><p>{cart.reduce((s,i)=>s+i.quantity,0)} itens no carrinho</p></div><button className="text-btn" onClick={()=>setCart([])}>Limpar</button></div>{cart.map(i=><div className="cart-item" key={i.productId}><div><b>{i.name}</b><small>{money(i.unitPrice)} cada</small></div><div className="qty"><button onClick={()=>setCart(c=>c.map(x=>x.productId===i.productId?{...x,quantity:Math.max(1,x.quantity-1)}:x))}><Minus size={13}/></button><b>{i.quantity}</b><button onClick={()=>setCart(c=>c.map(x=>x.productId===i.productId?{...x,quantity:x.quantity+1}:x))}><Plus size={13}/></button></div><strong>{money(i.quantity*i.unitPrice)}</strong></div>)}{!cart.length&&<Empty text="Adicione produtos para iniciar a venda."/>}<div className="cart-total"><span>Total</span><strong>{money(total)}</strong></div><button className="primary full" disabled={!cart.length} onClick={()=>setModal('order')}>Continuar pedido</button></div></div></>}
      {page==='orders'&&<><PageHeading title="Vendas e reservas" desc="Acompanhe pagamentos, retiradas e responsáveis."/><div className="toolbar"><div className="search"><Search/><input placeholder="Buscar cliente, vendedor ou pedido..." value={search} onChange={e=>setSearch(e.target.value)}/></div><div className="filter-count">{data.orders.length} pedidos</div></div><div className="panel table-panel"><OrderTable orders={filteredOrders} onChange={changeOrder} onPay={setPaymentOrder} onEdit={setOrderEditor} onCancel={setCancelTarget} onDetails={setOrderDetails}/></div></>}
      {page==='stock'&&<><PageHeading title="Controle de estoque" desc="Entradas, saídas e histórico de movimentações."/>
      <div className="panel table-panel"><div className="table-wrap"><table><thead><tr><th>Produto</th><th>Estoque atual</th><th>Estoque mínimo</th><th>Status</th><th>Ação</th></tr></thead><tbody>{activeProducts.map(p=><tr key={p.id}><td><b>{p.name}</b><small>{p.barcode}</small></td><td>{p.stock}</td><td>{p.minStock}</td><td><div style={{display:'flex',flexDirection:'column',alignItems:'flex-start',gap:5}}><span className={`badge ${p.stock<=p.minStock?'danger':'success'}`}>{p.stock<=p.minStock?'Estoque baixo':'Normal'}</span>{Number(p.stock)<=0&&(()=>{const since=(p as any).outOfStockSince;const elapsed=since?Math.max(0,Math.floor((Date.now()-new Date(since).getTime())/86400000)):0;const remaining=Math.max(0,90-elapsed);const progress=Math.min(100,elapsed/90*100);return <div style={{display:'flex',alignItems:'center',gap:6}} title={`Sem estoque há ${elapsed} dia(s). Arquivamento em ${remaining} dia(s).`}><div style={{width:58,height:4,background:'var(--surface-tertiary)',borderRadius:99,overflow:'hidden'}}><div style={{height:'100%',width:`${progress}%`,background:remaining<=10?'#d97706':'#b77945',borderRadius:99}}/></div><small style={{fontSize:10,color:remaining<=10?'#b45309':'var(--muted)',whiteSpace:'nowrap'}}>{remaining}d p/ arquivar</small></div>})()}</div></td><td><button className="secondary small" onClick={()=>{setEditing(p);setModal('stock')}}>Movimentar</button></td></tr>)}</tbody></table>{!activeProducts.length&&<Empty text="Cadastre produtos para controlar seu estoque."/>}</div></div><div className="panel"><div className="panel-title"><div><h2>Histórico de movimentações</h2><p>Registro de entradas, saídas e reservas</p></div></div>{data.movements.slice(0,30).map(m=><div className="activity" key={m.id}><span className="activity-icon"><RefreshCw size={16}/></span><div><b>{m.productName} · {m.type}</b><small>{m.detail} · {m.user} · {new Date(m.date).toLocaleString('pt-BR')}</small></div><strong>{m.quantity} un.</strong></div>)}</div></>}
      {page==='finance'&&(()=>{
        const now=new Date()
        const start=new Date(now); start.setHours(0,0,0,0)
        if(financeRange==='7days') start.setDate(start.getDate()-6)
        if(financeRange==='30days') start.setDate(start.getDate()-29)
        if(financeRange==='all') start.setTime(0)
        const records=data.orders.filter(order=>!order.isCanceled).flatMap(order=>(order.payments||[]).map(payment=>({ ...payment, orderId:order.id, customer:order.customer, seller:order.seller })))
          .filter(payment=>financeRange==='all'||new Date(payment.date)>=start)
          .sort((a,b)=>b.date.localeCompare(a.date))
        const received=records.reduce((sum,p)=>sum+p.amount,0)
        const byMethod=records.reduce((acc,p)=>{acc[p.method]=(acc[p.method]||0)+p.amount;return acc},{} as Record<string,number>)
        const pending=data.orders.reduce((sum,o)=>sum+Math.max(0,o.total-sumOrderPayments(o)),0)
        return <><PageHeading title="Financeiro" desc="Acompanhe automaticamente tudo o que foi recebido e o que ainda falta receber."/>
          <div className="toolbar finance-filters">
            <div className="segmented">
              {([['today','Hoje'],['7days','7 dias'],['30days','30 dias'],['all','Tudo']] as const).map(([value,label])=><button key={value} className={financeRange===value?'active':''} onClick={()=>setFinanceRange(value)}>{label}</button>)}
            </div>
          </div>
          <div className="stats-grid">
            <Stat icon={<Wallet/>} label="Total recebido" value={money(received)} hint="Pagamentos registrados no período"/>
            <Stat icon={<CalendarDays/>} label="Recebimentos" value={String(records.length)} hint="Lançamentos de pagamento"/>
            <Stat icon={<AlertTriangle/>} label="Saldo a receber" value={money(pending)} hint="Todos os pedidos em aberto"/>
            <Stat icon={<ShoppingCart/>} label="Pedidos com recebimento" value={String(new Set(records.map(p=>p.orderId)).size)} hint="Pedidos que tiveram pagamento"/>
          </div>
          <div className="grid-two finance-methods">
            <div className="panel"><div className="panel-title"><div><h2>Recebido por forma de pagamento</h2><p>Somente valores efetivamente registrados</p></div></div>
              {Object.entries(byMethod).length?Object.entries(byMethod).sort((a,b)=>b[1]-a[1]).map(([method,value])=><div className="activity" key={method}><div><b>{method}</b></div><strong>{money(value)}</strong></div>):<Empty text="Ainda não há recebimentos neste período."/>}
            </div>
            <div className="panel"><div className="panel-title"><div><h2>Contas a receber</h2><p>Pedidos com saldo pendente</p></div></div>
              {data.orders.filter(o=>!o.isCanceled&&o.total-sumOrderPayments(o)>0.001).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0,8).map(o=><div className="activity finance-due-row" key={o.id}><div><b>{o.customer||'Cliente não informado'}</b><small>{o.seller} · {o.paymentStatus} · Pedido #{o.id.slice(0,7)}</small></div><strong>{money(o.total-sumOrderPayments(o))}</strong><button className="primary small" onClick={()=>setPaymentOrder(o)}>Registrar pagamento</button></div>)}
              {!data.orders.some(o=>!o.isCanceled&&o.total-sumOrderPayments(o)>0.001)&&<Empty text="Nenhum valor pendente."/>}
            </div>
          </div>
          <div className="panel"><div className="panel-title"><div><h2>Histórico de recebimentos</h2><p>Data, pedido, responsável e forma de pagamento</p></div></div>
            {records.length?records.map((p)=><div className="activity finance-record" key={p.id}><div><b>{money(p.amount)} · {p.customer||'Cliente não informado'}</b><small>Pedido #{p.orderId.slice(0,8)} · {p.method} · {p.user} · {new Date(p.date).toLocaleString('pt-BR')}</small></div><strong>{p.seller}</strong></div>):<Empty text="Nenhum recebimento registrado neste período."/>}
          </div>
        </>
      })()}
      {page==='reports'&&(()=>{
        const orders=getReportOrders(), cancellations=getReportCancellations()
        const receipts=orders.flatMap(o=>(o.payments||[]).map(p=>({...p,order:o})))
          .sort((a,b)=>b.date.localeCompare(a.date))
        const received=receipts.reduce((s,p)=>s+p.amount,0)
        const sold=orders.reduce((s,o)=>s+o.total,0)
        const canceled=cancellations.reduce((s,o)=>s+o.total,0)
        const net=sold-canceled
        const pending=orders.reduce((s,o)=>s+Math.max(0,o.total-sumOrderPayments(o)),0)
        const methods=receipts.reduce((a,p)=>{a[p.method]=(a[p.method]||0)+p.amount;return a},{} as Record<string,number>)
        const sellers=orders.reduce((a,o)=>{a[o.seller]??={count:0,total:0,received:0};a[o.seller].count++;a[o.seller].total+=o.total;a[o.seller].received+=sumOrderPayments(o);return a},{} as Record<string,{count:number,total:number,received:number}>)
        return <div className="reports-print-area">
          <PageHeading title="Relatórios" desc="Vendas e recebimentos no período selecionado." action={<div className="report-actions"><button className="secondary" onClick={exportReportCsv}><FileSpreadsheet size={16}/> Exportar Excel</button><button type="button" className="primary" onClick={exportReportPdf}><FileText size={16}/> Exportar PDF</button></div>}/>
          <div className="panel report-period"><div className="panel-title"><div><h2>Período do relatório</h2><p>Escolha as datas para atualizar os indicadores e as exportações.</p></div></div><div className="report-date-fields"><label>Data inicial<input type="date" value={reportFrom} max={reportTo||undefined} onChange={e=>setReportFrom(e.target.value)}/></label><label>Data final<input type="date" value={reportTo} min={reportFrom||undefined} onChange={e=>setReportTo(e.target.value)}/></label></div></div>
          <div className="stats-grid">
            <Stat icon={<Wallet/>} label="Vendas válidas" value={money(sold)} hint={`${orders.length} pedidos não estornados`}/>
            <Stat icon={<Undo2/>} label="Total estornado" value={money(canceled)} hint={`${cancellations.length} estorno(s) no período`}/>
            <Stat icon={<TrendingUp/>} label="Vendas líquidas" value={money(net)} hint="Vendas válidas menos estornos"/>
            <Stat icon={<Check/>} label="Total recebido" value={money(received)} hint="Pagamentos de vendas válidas"/>
          </div>
          <div className="stats-grid">
            <Stat icon={<AlertTriangle/>} label="Saldo a receber" value={money(pending)} hint="Somente pedidos não estornados"/>
            <Stat icon={<CalendarDays/>} label="Pedidos entregues" value={String(orders.filter(o=>o.deliveryStatus==='Entregue').length)} hint="Entregas concluídas"/>
          </div>
          <div className="grid-two report-grids">
            <div className="panel"><div className="panel-title"><div><h2>Recebimentos por forma de pagamento</h2><p>Valores registrados no período</p></div></div>
              {Object.entries(methods).length?Object.entries(methods).sort((a,b)=>b[1]-a[1]).map(([method,value])=><div className="activity" key={method}><div><b>{method}</b></div><strong>{money(value)}</strong></div>):<Empty text="Nenhum recebimento neste período."/>}
            </div>
            <div className="panel"><div className="panel-title"><div><h2>Vendas por funcionário</h2><p>Pedidos, valor vendido e recebido</p></div></div>
              {Object.entries(sellers).length?Object.entries(sellers).map(([name,v])=><div className="activity" key={name}><div><b>{name}</b><small>{v.count} pedidos · Recebido {money(v.received)}</small></div><strong>{money(v.total)}</strong></div>):<Empty text="Nenhuma venda neste período."/>}
            </div>
          </div>
          <div className="panel"><div className="panel-title"><div><h2>Detalhamento das vendas</h2><p>Pedidos, valores, pagamentos e entrega</p></div></div>
            <div className="table-wrap"><table><thead><tr><th>Pedido / Cliente</th><th>Data</th><th>Vendedor</th><th>Total</th><th>Recebido</th><th>Saldo</th><th>Pagamento</th><th>Entrega</th></tr></thead><tbody>
              {orders.map(o=><tr key={o.id}><td><b>{o.customer||'Cliente não informado'}</b><small>#{o.id.slice(0,8)}</small></td><td>{new Date(o.createdAt).toLocaleDateString('pt-BR')}</td><td>{o.seller}<small>{o.updatedByName?`Última alteração: ${o.updatedByName}`:'Cadastro original'}</small></td><td>{money(o.total)}</td><td>{money(sumOrderPayments(o))}</td><td>{money(Math.max(0,o.total-sumOrderPayments(o)))}</td><td>{o.paymentStatus}</td><td>{o.deliveryStatus}</td></tr>)}
            </tbody></table></div>
            {!orders.length&&<Empty text="Nenhum pedido encontrado neste período."/>}
          </div>
          <div className="panel"><div className="panel-title"><div><h2>Estornos de vendas</h2><p>Estornos registrados no período, com valor negativo para conferência.</p></div></div>
            {cancellations.length?<div className="table-wrap"><table><thead><tr><th>Pedido / Cliente</th><th>Data do estorno</th><th>Responsável</th><th>Valor estornado</th><th>Motivo</th><th>Produtos devolvidos</th></tr></thead><tbody>
              {cancellations.map(o=><tr key={`cancel-${o.id}`}><td><b>{o.customer||'Cliente não informado'}</b><small>#{o.id.slice(0,8)}</small></td><td>{new Date(o.canceledAt||o.createdAt).toLocaleString('pt-BR')}</td><td>{o.canceledByName||o.updatedByName||'—'}</td><td><b style={{color:"#b4534b"}}>− {money(o.total)}</b></td><td>{o.cancelReason||'—'}</td><td>{o.items.map(i=>`${i.name} × ${i.quantity}`).join(', ')}</td></tr>)}
            </tbody></table></div>:<Empty text="Nenhum estorno registrado neste período."/>}
          </div>
          <div className="panel"><div className="panel-title"><div><h2>Recebimentos preservados em vendas estornadas</h2><p>Histórico original dos pagamentos; não são somados ao total recebido das vendas válidas.</p></div></div>
            {cancellations.some(o=>(o.payments||[]).length>0)?cancellations.flatMap(o=>(o.payments||[]).map(p=>({...p,order:o}))).sort((a,b)=>b.date.localeCompare(a.date)).map(p=><div className="activity" key={`canceled-payment-${p.order.id}-${p.id}`}><div><b>{money(p.amount)} · {p.order.customer||'Cliente não informado'}</b><small>Pedido #{p.order.id.slice(0,8)} · {p.method} · {p.user} · Venda estornada</small></div><strong>{p.order.canceledByName||p.order.updatedByName||'—'}</strong></div>):<Empty text="Não há pagamentos preservados em vendas estornadas neste período."/>}
          </div>
          <div className="panel"><div className="panel-title"><div><h2>Histórico de recebimentos</h2><p>Cada baixa registrada, com forma de pagamento e responsável</p></div></div>
            {receipts.length?receipts.map(p=><div className="activity" key={p.id}><div><b>{money(p.amount)} · {p.order.customer||'Cliente não informado'}</b><small>Pedido #{p.order.id.slice(0,8)} · {p.method} · {p.user} · {new Date(p.date).toLocaleString('pt-BR')}</small></div></div>):<Empty text="Nenhum recebimento registrado neste período."/>}
          </div>
        </div>
      })()}
      {page==='users'&&<><PageHeading title="Equipe" desc="Todos os integrantes têm perfil de administrador e acesso aos mesmos dados."/>
        <div className="panel" id="team-profile">
          <div className="panel-title"><div><h2>{selectedTeamUser?.uid===auth?.currentUser?.uid?'Meu perfil':selectedTeamUser?'Editar administrador':'Editar perfil'}</h2><p>{selectedTeamUser?'Altere o nome que aparece nos registros e na equipe.':'Selecione um usuário na lista abaixo para editar seu nome.'}</p></div></div>
          <form className="team-create-form team-profile-form" onSubmit={saveOwnProfile}>
            <label>Nome<input value={profileName} onChange={e=>setProfileName(e.target.value)} placeholder="Selecione um usuário" required disabled={!selectedTeamUser}/></label>
            <label>E-mail<input value={selectedTeamUser?.email||''} readOnly disabled/></label>
            <button className="primary" type="submit" disabled={!selectedTeamUser||savingProfile||profileName.trim()===selectedTeamUser?.name}>{savingProfile?'Salvando...':'Salvar nome'}</button>
          </form>
        </div>
        <div className="panel">
          <div className="panel-title"><div><h2>Cadastrar administrador</h2><p>Crie um acesso individual sem sair da sua conta atual.</p></div></div>
          <form className="team-create-form" onSubmit={addTeamUser}>
            <label>Nome<input value={newTeamName} onChange={e=>setNewTeamName(e.target.value)} placeholder="Nome do usuário" required/></label>
            <label>E-mail<input type="email" value={newTeamEmail} onChange={e=>setNewTeamEmail(e.target.value)} placeholder="email@exemplo.com" required/></label>
            <label>Senha inicial<input type="password" minLength={6} value={newTeamPassword} onChange={e=>setNewTeamPassword(e.target.value)} placeholder="Mínimo de 6 caracteres" required/></label>
            <button className="primary" type="submit" disabled={creatingTeamUser}>{creatingTeamUser?'Cadastrando...':'Adicionar administrador'}</button>
          </form>
          <div className="notice team-notice"><Users/><div><b>Permissões iguais para todos</b><p>Todos os administradores visualizam e gerenciam os mesmos produtos, estoque, vendas, reservas e financeiro. Cada operação fica registrada com o usuário responsável.</p></div></div>
        </div>
        <div className="panel table-panel">
          <div className="panel-title"><div><h2>Usuários cadastrados</h2><p>{teamUsers.length} administrador(es) com acesso à loja.</p></div></div>
          <div className="table-wrap"><table><thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Último acesso</th><th>Situação</th></tr></thead><tbody>
            {teamUsers.map(member=><tr key={member.uid} className={`team-user-row ${selectedTeamUser?.uid===member.uid?'selected':''}`} onClick={()=>{setSelectedTeamUser(member);setProfileName(member.name||'');document.getElementById('team-profile')?.scrollIntoView({behavior:'smooth',block:'center'})}} title="Clique para editar este usuário"><td><b>{member.name||'Usuário'}</b>{member.uid===auth?.currentUser?.uid&&<small>Você</small>}</td><td>{member.email}</td><td><span className="badge success">Administrador</span></td><td>{member.lastLoginAt?.toDate?member.lastLoginAt.toDate().toLocaleString('pt-BR'):'Ainda não acessou'}</td><td><span className="badge success">{member.active===false?'Inativo':'Ativo'}</span></td></tr>)}
          </tbody></table>{!teamUsers.length&&<Empty text="Nenhum usuário encontrado."/>}</div>
          <p className="muted">Conectado como: {user.name} · {user.email}</p>
        </div>
      </>}
    </section></main>
    {modal==='product'&&<ProductForm product={editing} onClose={()=>setModal(null)} onSave={saveProduct} onScan={()=>{setScanTarget('product');setScannerOpen(true)}} scannedBarcode={scannedBarcode} onLookup={lookupBarcode} notify={notify}/>}
    {scannerOpen&&<Scanner onClose={()=>setScannerOpen(false)} onScan={findBarcode}/>}
    {modal==='stock'&&editing&&<StockForm product={editing} onClose={()=>setModal(null)} onSave={adjustStock}/>}
    {modal==='order'&&<OrderForm total={total} onClose={()=>setModal(null)} onSave={finishOrder}/>}
    {paymentOrder&&<PaymentForm order={paymentOrder} onClose={()=>setPaymentOrder(null)} onSave={registerPayment}/>}
    {orderEditor&&<OrderEditForm order={orderEditor} products={activeProducts} onClose={()=>setOrderEditor(null)} onSave={patch=>saveOrderEdit(orderEditor,patch)}/>}
    {orderDetails&&<OrderDetails order={orderDetails} onClose={()=>setOrderDetails(null)}/>}
    {cancelTarget&&<CancelOrderDialog order={cancelTarget} onClose={()=>setCancelTarget(null)} onConfirm={reason=>cancelOrder(cancelTarget,reason)}/> } 
    {toast&&<div className="toast">{toast}</div>}
  </div>
}

function Stat({icon,label,value,hint}:{icon:React.ReactNode;label:string;value:string;hint:string}){return <div className="stat-card"><span className="stat-icon">{icon}</span><span className="stat-label">{label}</span><strong>{value}</strong><small>{hint}</small></div>}
function PageHeading({title,desc,action}:{title:string;desc:string;action?:React.ReactNode}){return <div className="page-heading"><div><h1>{title}</h1><p>{desc}</p></div>{action}</div>}
function Empty({text}:{text:string}){return <div className="empty"><span>🍫</span><p>{text}</p></div>}
function OrderTable({orders,onChange,onPay,onEdit,onCancel,onDetails}:{orders:Order[];onChange:(o:Order,p:Partial<Order>)=>void;onPay:(o:Order)=>void;onEdit:(o:Order)=>void;onCancel:(o:Order)=>void;onDetails:(o:Order)=>void}){
 return <div className="table-wrap"><table><thead><tr><th>Pedido / Cliente</th><th>Data</th><th>Vendedor</th><th>Total</th><th>Pagamento</th><th>Entrega</th><th>Ações</th></tr></thead><tbody>{orders.map(o=><tr key={o.id} className={o.isCanceled?'order-canceled':''}><td><b>{o.customer||'Cliente não informado'}</b><small>#{o.id.slice(0,7)} · {o.items.length} item(ns)</small></td><td>{new Date(o.createdAt).toLocaleDateString('pt-BR')}</td><td>{o.seller}<small>{o.updatedByName?`Última alteração: ${o.updatedByName}`:'Cadastro original'}</small></td><td><b>{money(o.total)}</b><small>Recebido: {money(sumOrderPayments(o))}</small></td><td>{o.isCanceled?<span className="badge danger">Estornada</span>:<span className={`badge ${getOrderPaymentStatus(o)==='Pago'?'success':'warning'}`}>{getOrderPaymentStatus(o)}</span>}</td><td><span className={`badge ${o.deliveryStatus==='Entregue'?'success':'info'}`}>{o.deliveryStatus}</span></td><td><div className="actions"><button title="Ver detalhes" className="icon-btn" onClick={()=>onDetails(o)}><Eye size={16}/></button>{!o.isCanceled&&<><button title="Editar venda" className="icon-btn" onClick={()=>onEdit(o)}><Pencil size={16}/></button>{getOrderPaymentStatus(o)!=='Pago'&&<button title="Registrar pagamento" className="secondary small" onClick={()=>onPay(o)}>Receber</button>}{o.deliveryStatus==='Reservado'&&<button title="Marcar como entregue" className="icon-btn" onClick={()=>onChange(o,{deliveryStatus:'Entregue'})}><Package size={16}/></button>}<button title="Estornar venda" className="icon-btn danger-action" onClick={()=>onCancel(o)}><Undo2 size={16}/></button></>}</div></td></tr>)}</tbody></table>{!orders.length&&<Empty text="Nenhum pedido encontrado."/>}</div>
}
function OrderEditForm({order,products,onClose,onSave}:{order:Order;products:Product[];onClose:()=>void;onSave:(p:Pick<Order,'customer'|'phone'|'items'|'discount'|'notes'|'pickupDate'>)=>void}){
 const [customer,setCustomer]=useState(order.customer||''),[phone,setPhone]=useState(order.phone||''),[notes,setNotes]=useState(order.notes||''),[pickupDate,setPickupDate]=useState(order.pickupDate||''),[discount,setDiscount]=useState(Number(order.discount)||0),[items,setItems]=useState<OrderItem[]>(order.items.map(i=>({...i})))
 const subtotal=items.reduce((s,i)=>s+i.quantity*i.unitPrice,0),total=Math.max(0,subtotal-Math.min(subtotal,Math.max(0,discount)))
 function updateItem(id:string,patch:Partial<OrderItem>){setItems(old=>old.map(i=>i.productId===id?{...i,...patch}:i))}
 return <Modal title="Editar venda" onClose={onClose} wide><div className="form-grid"><label className="span-2">Cliente<input value={customer} onChange={e=>setCustomer(e.target.value)}/></label><label className="span-2">Telefone<input value={phone} onChange={e=>setPhone(e.target.value)}/></label><label className="span-2">Observações<input value={notes} onChange={e=>setNotes(e.target.value)}/></label><label>Retirada prevista<input type="date" value={pickupDate} onChange={e=>setPickupDate(e.target.value)}/></label><label>Desconto (R$)<CurrencyInput value={discount} onChange={setDiscount}/></label></div><h3>Produtos da venda</h3><div className="order-edit-items">{items.map(item=><div className="order-edit-item" key={item.productId}><div><b>{item.name}</b><small>{money(item.unitPrice)} cada · estoque atual: {products.find(p=>p.id===item.productId)?.stock??'produto indisponível'}</small></div><label>Qtd.<input type="number" min="0" step="1" value={item.quantity} onChange={e=>updateItem(item.productId,{quantity:Math.max(0,Math.floor(Number(e.target.value)||0))})}/></label><strong>{money(item.quantity*item.unitPrice)}</strong></div>)}</div><p className="muted">Quantidade zero remove o produto da venda. Para adicionar outro produto, use o botão abaixo.</p><select className="order-add-product" defaultValue="" onChange={e=>{const p=products.find(x=>x.id===e.target.value);if(p){const found=items.find(i=>i.productId===p.id);setItems(found?items.map(i=>i.productId===p.id?{...i,quantity:i.quantity+1}:i):[...items,{productId:p.id,name:p.name,barcode:p.barcode,quantity:1,unitPrice:p.price}])}e.currentTarget.value=''}}><option value="" disabled>Adicionar produto...</option>{products.filter(p=>p.stock>0).map(p=><option key={p.id} value={p.id}>{p.name} — {money(p.price)} ({p.stock} disponíveis)</option>)}</select><div className="order-total"><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div className="order-total"><span>Desconto</span><strong>− {money(Math.min(subtotal,discount))}</strong></div><div className="order-total"><span>Total atualizado</span><strong>{money(total)}</strong></div><div className="modal-actions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={!items.some(i=>i.quantity>0)} onClick={()=>onSave({customer,phone,notes,pickupDate,discount,items:items.filter(i=>i.quantity>0)})}>Salvar alterações</button></div></Modal>
}
function OrderDetails({order,onClose}:{order:Order;onClose:()=>void}){return <Modal title="Detalhes do pedido" onClose={onClose} wide><div className="order-detail-grid"><div><small>Cliente</small><b>{order.customer||'Não informado'}</b></div><div><small>Vendedor</small><b>{order.seller}</b></div><div><small>Data</small><b>{new Date(order.createdAt).toLocaleString('pt-BR')}</b></div><div><small>Telefone</small><b>{order.phone||'—'}</b></div></div><h3>Itens</h3>{order.items.map((i,n)=><div className="order-edit-item" key={`${i.productId}-${n}`}><span>{i.name} × {i.quantity}</span><strong>{money(i.quantity*i.unitPrice)}</strong></div>)}<div className="order-total"><span>Subtotal</span><strong>{money(order.subtotal??order.items.reduce((s,i)=>s+i.quantity*i.unitPrice,0))}</strong></div><div className="order-total"><span>Desconto</span><strong>− {money(order.discount||0)}</strong></div><div className="order-total"><span>Total</span><strong>{money(order.total)}</strong></div><h3>Pagamentos</h3>{(order.payments||[]).length?(order.payments||[]).map(p=><div className="order-edit-item" key={p.id}><span>{p.method} · {p.user} · {new Date(p.date).toLocaleString('pt-BR')}</span><strong>{money(p.amount)}</strong></div>):<p className="muted">Nenhum pagamento registrado.</p>}{order.isCanceled&&<div className="notice"><div><b>Venda estornada</b><p>{order.cancelReason} · {order.canceledByName} · {order.canceledAt?new Date(order.canceledAt).toLocaleString('pt-BR'):''}</p></div></div>}</Modal>}
function CancelOrderDialog({order,onClose,onConfirm}:{order:Order;onClose:()=>void;onConfirm:(reason:string)=>void}){const [reason,setReason]=useState('');return <Modal title="Confirmar estorno da venda" onClose={onClose}><div className="notice"><div><b>Atenção: esta operação não pode ser desfeita automaticamente.</b><p>Os {order.items.reduce((s,i)=>s+i.quantity,0)} itens serão devolvidos ao estoque. Os pagamentos existentes serão preservados para conferência financeira.</p></div></div><label className="confirm-reason">Motivo do estorno<textarea value={reason} onChange={e=>setReason(e.target.value)} placeholder="Informe o motivo..."/></label><div className="modal-actions"><button className="secondary" onClick={onClose}>Voltar</button><button className="primary" disabled={!reason.trim()} onClick={()=>onConfirm(reason)}>Confirmar estorno</button></div></Modal>}

function PaymentForm({order,onClose,onSave}:{order:Order;onClose:()=>void;onSave:(o:Order,amount:number,method:PaymentRecord['method'])=>void}){
 const remaining=Math.max(0,order.total-sumOrderPayments(order))
 const [amount,setAmount]=useState(remaining)
 const [method,setMethod]=useState<PaymentRecord['method']>('Pix')
 return <Modal title={`Registrar pagamento · ${order.customer||'Cliente'}`} onClose={onClose}>
  <div className="payment-summary">
   <div><span>Total do pedido</span><b>{money(order.total)}</b></div>
   <div><span>Já recebido</span><b>{money(sumOrderPayments(order))}</b></div>
   <div className="payment-balance"><span>Saldo pendente</span><strong>{money(remaining)}</strong></div>
  </div>
  {(order.payments||[]).length>0&&<div className="payment-history"><b>Recebimentos anteriores</b>{(order.payments||[]).map(p=><div key={p.id}><span>{p.method} · {p.user}<small>{new Date(p.date).toLocaleString('pt-BR')}</small></span><strong>{money(p.amount)}</strong></div>)}</div>}
  <div className="form-grid"><label className="span-2">Valor recebido agora<CurrencyInput value={amount} max={remaining} onChange={setAmount}/></label><label className="span-2">Forma de pagamento<select value={method} onChange={e=>setMethod(e.target.value as PaymentRecord['method'])}><option>Pix</option><option>Dinheiro</option><option>Cartão de crédito</option><option>Cartão de débito</option><option>Transferência</option><option>Outro</option></select></label></div>
  <div className="modal-actions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" disabled={amount<=0||amount>remaining+0.001} onClick={()=>onSave(order,amount,method)}>Confirmar recebimento</button></div>
 </Modal>
}
function ProductForm({product,onClose,onSave,onScan,scannedBarcode,onLookup,notify}:{product:Product|null;onClose:()=>void;onSave:(p:Product)=>void;onScan:()=>void;scannedBarcode:string;onLookup:(c:string)=>Promise<{name:string;brand:string;image:string}|null>;notify:(s:string)=>void}){
 const [p,setP]=useState<Product>(product||{id:uid(),name:'',barcode:'',category:'Bombons',brand:'Cacau Show',cost:0,price:0,stock:0,minStock:2,expiry:'',image:''})
 const [loading,setLoading]=useState(false)
 const [uploadingImage,setUploadingImage]=useState(false)
 const [driveConnected,setDriveConnected]=useState<boolean|null>(null)
 const [drivePreview,setDrivePreview]=useState('')
 useEffect(()=>{
   let active=true;let objectUrl=''
   if(p.driveFileId){
     auth.currentUser?.getIdToken().then(token=>fetch(`/api/drive/image/${encodeURIComponent(p.driveFileId!)}`,{headers:{Authorization:`Bearer ${token}`}})).then(async response=>{if(!response.ok)throw new Error('Não foi possível carregar a foto.');return response.blob()}).then(blob=>{if(!active)return;objectUrl=URL.createObjectURL(blob);setDrivePreview(objectUrl)}).catch(()=>{if(active)setDrivePreview('')})
   }else setDrivePreview('')
   return ()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)}
 },[p.driveFileId])
 useEffect(()=>{if(scannedBarcode)setP(x=>({...x,barcode:scannedBarcode}))},[scannedBarcode])
 useEffect(()=>{let active=true;auth.currentUser?.getIdToken().then(token=>fetch('/api/drive/status',{headers:{Authorization:`Bearer ${token}`}})).then(r=>r?.ok?r.json():null).then(v=>{if(active&&v) setDriveConnected(Boolean(v.connected))}).catch(()=>{});return()=>{active=false}},[])
 async function connectDrive(){try{const token=await auth.currentUser?.getIdToken();if(!token)throw new Error('Entre novamente no sistema.');const r=await fetch('/api/drive/connect',{headers:{Authorization:`Bearer ${token}`}});const v=await r.json();if(!r.ok)throw new Error(v.error||'Falha ao iniciar conexão.');window.open(v.url,'_blank','noopener,noreferrer')}catch(e){notify((e as Error).message)}}
 async function uploadProductImage(file?:File){if(!file)return;try{setUploadingImage(true);const token=await auth.currentUser?.getIdToken();if(!token)throw new Error('Entre novamente no sistema.');const body=new FormData();body.append('image',file);body.append('productId',p.id);const r=await fetch('/api/drive/upload',{method:'POST',headers:{Authorization:`Bearer ${token}`},body});const v=await r.json();if(!r.ok)throw new Error(v.error||'Falha ao enviar foto.');setP(x=>({...x,image:'',driveFileId:v.fileId}));setDriveConnected(true);notify('Foto enviada ao Google Drive.')}catch(e){notify((e as Error).message)}finally{setUploadingImage(false)}}
 async function lookup(){if(!p.barcode){notify('Informe ou leia o código primeiro.');return}setLoading(true);const found=await onLookup(p.barcode);if(found){setP(x=>({...x,name:x.name||found.name,brand:x.brand||found.brand,image:x.image||found.image}));notify('Dados encontrados. Confira antes de salvar.')}else notify('Não encontramos esse código. Preencha manualmente.');setLoading(false)}
 function field(k:keyof Product,label:string,type='text'){return <label>{label}{(k==='cost'||k==='price')?<CurrencyInput value={Number(p[k])||0} onChange={v=>setP(x=>({...x,[k]:v}))}/>:<input type={type} value={String(p[k]??'')} onChange={e=>setP(x=>({...x,[k]:type==='number'?Number(e.target.value):e.target.value}))}/>}</label>}
 return <Modal title={product?'Editar produto':'Cadastrar produto'} onClose={onClose} wide><div className="product-image-upload"><div className="product-image-preview">{(drivePreview||p.image)?<img src={drivePreview||p.image} alt={p.name||'Foto do produto'}/>:<Package size={28}/>}</div><div className="product-image-actions"><b>Foto do produto</b><small>{driveConnected===false?'Conecte o Google Drive para compartilhar as fotos entre os administradores.':'A foto ficará compartilhada pelo Google Drive.'}</small><label className="secondary upload-image-button">{uploadingImage?'Enviando foto...':'Escolher foto'}<input type="file" accept="image/*" disabled={uploadingImage} onChange={e=>uploadProductImage(e.target.files?.[0])}/></label>{driveConnected!==true&&<button type="button" className="secondary" onClick={connectDrive}>Conectar Google Drive</button>}</div></div><div className="form-grid">{field('name','Nome do produto')}{field('category','Categoria')}{field('brand','Marca') }<div className="barcode-field"><label>Código de barras<input value={p.barcode} onChange={e=>setP(x=>({...x,barcode:e.target.value}))} placeholder="EAN / GTIN"/></label><button className="secondary" onClick={onScan}><ScanBarcode size={17}/></button><button className="secondary" onClick={lookup} disabled={loading}><Search size={17}/>{loading?'Buscando':'Buscar'}</button></div>{field('cost','Preço de custo','number')}{field('price','Preço de venda','number')}{field('stock','Estoque inicial','number')}{field('minStock','Estoque mínimo','number')}{field('expiry','Validade','date')}</div><div className="modal-actions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" onClick={()=>{if(!p.name.trim()){notify('Informe o nome do produto.');return}onSave(p)}}>Salvar produto</button></div></Modal>
}
function StockForm({product,onClose,onSave}:{product:Product;onClose:()=>void;onSave:(p:Product,q:number,d:string)=>void}){
 const [qty,setQty]=useState(1);const [detail,setDetail]=useState('Reposição de mercadoria')
 return <Modal title={`Movimentar estoque · ${product.name}`} onClose={onClose}><div className="form-grid"><label>Tipo<select id="stock-type"><option value="in">Entrada</option><option value="out">Saída / perda</option></select></label><label>Quantidade<input type="number" min="1" value={qty} onChange={e=>setQty(Math.max(1,Number(e.target.value)))}/></label><label className="span-2">Observação<input value={detail} onChange={e=>setDetail(e.target.value)}/></label></div><div className="modal-actions"><button className="secondary" onClick={onClose}>Cancelar</button><button className="primary" onClick={()=>{const type=(document.getElementById('stock-type') as HTMLSelectElement).value;onSave(product,type==='in'?qty:-qty,detail)}}>Confirmar</button></div></Modal>
}
function OrderForm({total,onClose,onSave}:{total:number;onClose:()=>void;onSave:(s:'Reservado'|'Entregue',p:'Pago'|'A pagar'|'Parcial',c:string,ph:string,paid:number,method:PaymentRecord['method'],pick:string,n:string,discount:number)=>void}){
 const [customer,setCustomer]=useState('');const [phone,setPhone]=useState('');const [status,setStatus]=useState<'Reservado'|'Entregue'>('Entregue');const [payment,setPayment]=useState<'Pago'|'A pagar'|'Parcial'>('Pago');const [discount,setDiscount]=useState(0);const finalTotal=Math.max(0,total-Math.min(total,Math.max(0,discount)));const [paid,setPaid]=useState(total);const [method,setMethod]=useState<PaymentRecord['method']>('Pix');const [pickup,setPickup]=useState('');const [notes,setNotes]=useState('')
 useEffect(()=>{if(payment==='Pago')setPaid(finalTotal);else if(paid>finalTotal)setPaid(finalTotal)},[finalTotal,payment])
 return <Modal title="Finalizar pedido" onClose={onClose}><div className="form-grid"><label className="span-2">Nome do cliente<input value={customer} onChange={e=>setCustomer(e.target.value)} placeholder="Opcional"/></label><label className="span-2">Telefone<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(00) 00000-0000"/></label><label className="span-2">Desconto (R$)<CurrencyInput value={discount} max={total} onChange={setDiscount}/></label><label>Status da entrega<select value={status} onChange={e=>setStatus(e.target.value as 'Reservado'|'Entregue')}><option>Entregue</option><option>Reservado</option></select></label><label>Pagamento<select value={payment} onChange={e=>{const v=e.target.value as typeof payment;setPayment(v);setPaid(v==='Pago'?finalTotal:0)}}><option>Pago</option><option>A pagar</option><option>Parcial</option></select></label>{payment!=='A pagar'&&<><label className="span-2">Forma de pagamento<select value={method} onChange={e=>setMethod(e.target.value as PaymentRecord['method'])}><option>Pix</option><option>Dinheiro</option><option>Cartão de crédito</option><option>Cartão de débito</option><option>Transferência</option><option>Outro</option></select></label>{payment==='Parcial'&&<label className="span-2">Valor já pago<CurrencyInput value={paid} max={finalTotal} onChange={setPaid}/></label>}</>}<label>Retirada prevista<input type="date" value={pickup} onChange={e=>setPickup(e.target.value)}/></label><label className="span-2">Observações<input value={notes} onChange={e=>setNotes(e.target.value)}/></label></div><div className="order-total"><span>Subtotal</span><strong>{money(total)}</strong></div>{discount>0&&<div className="order-total"><span>Desconto</span><strong>− {money(Math.min(total,discount))}</strong></div>}<div className="order-total"><span>Total com desconto</span><strong>{money(finalTotal)}</strong></div><div className="modal-actions"><button className="secondary" onClick={onClose}>Voltar</button><button className="primary" disabled={payment==='Parcial'&&(paid<=0||paid>=finalTotal)} onClick={()=>onSave(status,payment,customer,phone,payment==='Pago'?finalTotal:payment==='Parcial'?Math.min(finalTotal,Math.max(0,paid)):0,method,pickup,notes,Math.min(total,Math.max(0,discount)))}>Confirmar pedido</button></div></Modal>
}
