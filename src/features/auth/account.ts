import {createContext,useContext} from 'react'

// Account controls provided by the sign-in gate and shown by the app shell
// (desktop sidebar, phone menu) and the Settings page.
export type AccountControls={
 username:string
 role:'ADMIN'|'VETERINARIAN'
 language:'sq'|'en'
 busy:boolean
 setLanguage:(value:'sq'|'en')=>void
 logout:()=>void
 openVet:()=>void
}
export const AccountContext=createContext<AccountControls|undefined>(undefined)
export const useAccount=()=>useContext(AccountContext)
