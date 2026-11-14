import type { ReactNode } from 'react'
import { X } from 'lucide-react'
export default function Modal({ title, children, onClose, wide=false }: { title:string; children:ReactNode; onClose:()=>void; wide?:boolean }) {
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}>
    <div className={`modal ${wide?'wide':''}`}><div className="modal-head"><h2>{title}</h2><button className="icon-btn" onClick={onClose}><X/></button></div>{children}</div>
  </div>
}
