import {useEffect,useRef,useState} from 'react'
import type {Animal,Language} from '../../db/models'
import {repositories} from '../../db/repositories'
import {animalStrings} from '../../i18n/animals'
import {strings} from '../../i18n/strings'

// "Delete" archives the animal: it leaves the list, its health history is kept, and Edit → Status restores it.
// A permanent delete would erase vaccination and treatment records and is deliberately not offered.
export function DeleteAnimal({animal,language,label,className='row-action danger-text',onDeleted}:{animal:Pick<Animal,'id'|'earTag'|'name'|'status'>;language:Language;label?:string;className?:string;onDeleted?:()=>void}){
 const t=animalStrings[language]
 const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false)
 const trigger=useRef<HTMLButtonElement>(null)
 const close=()=>{setOpen(false);setError(false);trigger.current?.focus()}
 useEffect(()=>{
  if(!open)return
  const key=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);trigger.current?.focus()}}
  window.addEventListener('keydown',key)
  return()=>window.removeEventListener('keydown',key)
 },[open])
 if(animal.status==='archived')return null
 const name=animal.name?animal.earTag+' · '+animal.name:animal.earTag
 return <>
  <button ref={trigger} type="button" className={className} aria-label={(label??t.remove)+' '+name} onClick={()=>setOpen(true)}>{label??t.remove}</button>
  {open&&<div className="sheet-layer">
   <div className="sheet-backdrop" onClick={close}/>
   <div role="alertdialog" aria-modal="true" aria-labelledby={'remove-'+animal.id} aria-describedby={'remove-help-'+animal.id} className="panel confirm-panel">
    <h2 id={'remove-'+animal.id}>{t.removeTitle}</h2>
    <p className="font-semibold">{name}</p>
    <p id={'remove-help-'+animal.id} className="text-sm">{t.removeHelp}</p>
    {error&&<p role="alert" className="registry-error">{strings[language].error}</p>}
    <div className="flex flex-wrap gap-2">
     <button type="button" className="registry-action danger" disabled={busy} onClick={async()=>{
      setBusy(true);setError(false)
      try{await repositories.animals.archive(animal.id);setOpen(false);onDeleted?.()}catch{setError(true)}finally{setBusy(false)}
     }}>{t.confirmRemove}</button>
     <button type="button" className="registry-action secondary" autoFocus disabled={busy} onClick={close}>{t.cancel}</button>
    </div>
   </div>
  </div>}
 </>
}
