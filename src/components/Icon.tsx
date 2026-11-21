export type IconName='home'|'animals'|'health'|'calendar'|'settings'|'arrow'|'vaccine'|'tasks'|'reports'|'backup'|'bell'|'plus'|'layers'|'user'
export function Icon({name,className=''}:{name:IconName;className?:string}){
 const paths={
 home:'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
 animals:'M6 6 3 3v7l3 3v6l3 2h6l3-2v-6l3-3V3l-3 3M6 6l3-2h6l3 2M8 13h.01M16 13h.01M10 17h4',
 health:'M4 3v5a5 5 0 0 0 10 0V3M4 3H2m12 0h2M9 13v3a5 5 0 0 0 10 0v-2M22 11a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
 calendar:'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM7 14h2M13 14h2M7 18h2',
 settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM9 3l-1 3-3 1-2 3 2 3v4l3 1 2 3h4l2-3 3-1v-4l2-3-2-3-3-1-1-3Z',
 arrow:'M5 12h14m-5-5 5 5-5 5',
 vaccine:'m14 3 7 7M17 2l5 5M3 21l3-3m1-1 10-10 4 4L11 21l-4-4ZM8 12l4 4M11 9l4 4',
 tasks:'M9 4H5v17h14V4h-4M9 2h6v4H9ZM8 11l1 1 2-2M13 11h3M8 16l1 1 2-2M13 16h3',
 reports:'M4 20V10h4v10ZM10 20V4h4v16ZM16 20v-8h4v8Z',
 backup:'M12 3 3 7v10l9 4 9-4V7ZM3 7l9 4 9-4M12 11v10',
 bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4M12 2V1',
 plus:'M12 8v8M8 12h8M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
 layers:'m12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5',
 user:'M8 7a4 4 0 1 0 8 0 4 4 0 0 0-8 0M3 21v-3a9 9 0 0 1 18 0v3Z',
 }
 return <svg className={className} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]}/></svg>
}
