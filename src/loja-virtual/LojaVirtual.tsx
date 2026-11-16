import { useEffect, useState } from 'react'
import { Save, Store, Wallet, Truck, QrCode } from 'lucide-react'
import type { LojaVirtualSettings } from './types'
import './loja-virtual.css'

type Props = {
  initialSettings: LojaVirtualSettings
  onSave: (settings: LojaVirtualSettings) => Promise<void>
}

export default function LojaVirtual({ initialSettings, onSave }: Props) {
  const [form, setForm] = useState(initialSettings)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => setForm(initialSettings), [initialSettings])
  const update = <K extends keyof LojaVirtualSettings>(key: K, value: LojaVirtualSettings[K]) => setForm(old => ({ ...old, [key]: value }))
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setSaving(true); setMessage('')
    try { await onSave(form); setMessage('Configurações salvas com sucesso.') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Não foi possível salvar as configurações.') }
    finally { setSaving(false) }
  }
  return <section className="loja-virtual-page">
    <header className="loja-virtual-heading"><div><span>DOCE CACAU · COMÉRCIO DIGITAL</span><h1><Store size={25}/> Loja virtual</h1><p>Configure como seus clientes poderão comprar pelo catálogo digital.</p></div><span className={`loja-status ${form.enabled ? 'is-on' : ''}`}>{form.enabled ? 'Loja habilitada' : 'Loja em preparação'}</span></header>
    <form onSubmit={submit} className="loja-settings-form">
      <section className="loja-settings-card"><div className="loja-card-title"><Store/><div><h2>Disponibilidade da loja</h2><p>Controle quando o catálogo poderá receber pedidos.</p></div></div><label className="loja-switch-row"><span><b>Habilitar loja virtual</b><small>Quando ativa, clientes poderão consultar o catálogo e enviar pedidos para análise da loja.</small></span><input type="checkbox" checked={form.enabled} onChange={e=>update('enabled',e.target.checked)}/></label></section>
      <section className="loja-settings-card"><div className="loja-card-title"><Wallet/><div><h2>Formas de pagamento</h2><p>Escolha quais opções estarão disponíveis no catálogo.</p></div></div>{([["allowCashOnDelivery","Dinheiro na entrega/retirada"],["allowPixAdvance","Pix"],["allowCardOnDelivery","Cartão na entrega/retirada"]] as const).map(([key,label])=><label className="loja-check-row" key={key}><span>{label}</span><input type="checkbox" checked={form[key]} onChange={e=>update(key,e.target.checked)}/></label>)}</section>
      <section className="loja-settings-card"><div className="loja-card-title"><QrCode/><div><h2>Dados para recebimento via Pix</h2><p>Esses dados serão usados na geração do Pix Copia e Cola.</p></div></div><div className="loja-form-grid"><label>Tipo de chave<select value={form.pixKeyType} onChange={e=>update('pixKeyType',e.target.value as LojaVirtualSettings['pixKeyType'])}><option value="aleatoria">Chave aleatória</option><option value="cpf">CPF</option><option value="cnpj">CNPJ</option><option value="email">E-mail</option><option value="telefone">Telefone</option></select></label><label>Chave Pix<input value={form.pixKey} onChange={e=>update('pixKey',e.target.value)} placeholder="Informe a chave Pix"/></label><label>Nome do titular<input value={form.pixHolder} onChange={e=>update('pixHolder',e.target.value)} placeholder="Nome cadastrado no banco"/></label><label>Cidade do titular<input value={form.pixCity} onChange={e=>update('pixCity',e.target.value)} placeholder="Ex.: Codó" maxLength={25}/></label></div></section>
      <section className="loja-settings-card"><div className="loja-card-title"><Truck/><div><h2>Entrega e retirada</h2><p>Defina como o cliente poderá receber o pedido.</p></div></div><label className="loja-check-row"><span>Permitir retirada na loja</span><input type="checkbox" checked={form.allowPickup} onChange={e=>update('allowPickup',e.target.checked)}/></label><label className="loja-check-row"><span>Permitir entrega em endereço</span><input type="checkbox" checked={form.allowDelivery} onChange={e=>update('allowDelivery',e.target.checked)}/></label><label className="loja-fee-field">Taxa de entrega (R$)<input type="number" min="0" step="0.01" value={form.deliveryFee} onChange={e=>update('deliveryFee',Math.max(0,Number(e.target.value)||0))}/></label></section>
      <footer className="loja-settings-footer">{message && <span role="status">{message}</span>}<button type="submit" disabled={saving}><Save size={17}/>{saving?'Salvando...':'Salvar configurações'}</button></footer>
    </form>
  </section>
}
