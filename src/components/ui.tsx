'use client';
import { useId, useState, type ReactNode } from 'react';
import { Num, Unit } from './tex';

export function Range({label,display,value,min,max,step=1,onChange,unit='',digits=0,hint}:{label:string;display?:ReactNode;value:number;min:number;max:number;step?:number;onChange:(n:number)=>void;unit?:string;digits?:number;hint?:ReactNode}){const id=useId();const [start,setStart]=useState<number|null>(null);const delta=start===null?0:value-start;return <div className="range-control"><div><label htmlFor={id}>{display??label}</label><output htmlFor={id}><Num>{value.toFixed(digits)}</Num>{unit&&<span> <Unit>{unit}</Unit></span>}</output></div><input id={id} aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={e=>{if(start===null)setStart(value);onChange(+e.target.value);}} aria-describedby={`${id}-note`}/><small id={`${id}-note`}>{start===null ? hint : <><span className="delta-readout">{delta>0?'+':''}<Num>{delta.toFixed(digits)}</Num> <Unit>{unit}</Unit></span> from <Num>{start.toFixed(digits)}</Num> <Unit>{unit}</Unit>{hint&&<> · {hint}</>}</>}</small></div>;}
export function download(name:string,text:string,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

