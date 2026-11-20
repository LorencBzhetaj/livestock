export function Icon({name,className=''}:{name:'home'|'animals'|'health'|'calendar'|'settings'|'arrow';className?:string}){
 const paths={
 home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
 animals:'M6 6 3 3v7l3 3v6l3 2h6l3-2v-6l3-3V3l-3 3M6 6l3-2h6l3 2M8 13h.01M16 13h.01M10 17h4',
 health:'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z',
 calendar:'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 14h2M13 14h2M7 18h2',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3l-1 3-3 1-2 3 2 3v4l3 1 2 3h4l2-3 3-1v-4l2-3-2-3-3-1-1-3Z',
 arrow:'M5 12h14m-5-5 5 5-5 5',
 }
 return <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>
}
