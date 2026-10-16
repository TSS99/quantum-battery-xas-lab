'use client';
import { useId, type ReactNode } from 'react';
import { Download } from 'lucide-react';

export function Badge({children,tone='violet'}:{children:ReactNode;tone?:string}){return <span className={`badge ${tone}`}><span/>{children}</span>;}
export function Panel({children,className='',title,eyebrow,aside}:{children:ReactNode;className?:string;title?:string;eyebrow?:string;aside?:ReactNode}){return <section className={`panel ${className}`}>{title&&<div className="panel-head"><div>{eyebrow&&<span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2></div>{aside}</div>}{children}</section>;}
export function Range({label,value,min,max,step=1,onChange,unit='',digits=0,hint}:{label:string;value:number;min:number;max:number;step?:number;onChange:(n:number)=>void;unit?:string;digits?:number;hint?:string}){const id=useId();return <div className="range-control"><div><label htmlFor={id}>{label}</label><output htmlFor={id}>{value.toFixed(digits)}<span> {unit}</span></output></div><input id={id} aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(+e.target.value)}/>{hint&&<small>{hint}</small>}</div>;}
export function Metric({label,value,unit,tone=''}:{label:string;value:ReactNode;unit?:string;tone?:string}){return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>;}
export function Disclosure({children,title='Model assumptions'}:{children:ReactNode;title?:string}){return <details className="disclosure"><summary>{title}</summary><div>{children}</div></details>;}
export function download(name:string,text:string,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function ExportButton({onClick,children='Export'}:{onClick:()=>void;children?:ReactNode}){return <button className="button secondary small" onClick={onClick}><Download size={14}/>{children}</button>;}
