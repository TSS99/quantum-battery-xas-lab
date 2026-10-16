'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_STATE, type LabState, validateScenario, scenarioFromURL } from '@/lib/scenario';
import type { Spectrum } from '@/lib/spectra';

interface Context { state:LabState; set:(patch:Partial<LabState>)=>void; reset:()=>void; runs:Spectrum[]; addRun:(run:Spectrum)=>void; updateRun:(run:Spectrum)=>void; removeRun:(id:string)=>void; notice:string; notify:(text:string)=>void; }
const LabContext=createContext<Context|null>(null);
export function LabProvider({children}:{children:ReactNode}) {
 const [state,setState]=useState<LabState>(DEFAULT_STATE); const [runs,setRuns]=useState<Spectrum[]>([]); const [notice,notify]=useState(''); const [ready,setReady]=useState(false);
 useEffect(()=>{try { const stored=localStorage.getItem('qbx-state-v1'); if(stored) setState(validateScenario(JSON.parse(stored))); const shared=scenarioFromURL(window.location.href); if(shared) setState(shared); } catch {notify('Saved settings could not be read. Defaults restored.');} setReady(true);},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem('qbx-state-v1',JSON.stringify(state));}catch{/* Storage can be unavailable in private browsing. */}},[ready,state]);
 useEffect(()=>{if(!notice)return;const id=setTimeout(()=>notify(''),6000);return()=>clearTimeout(id);},[notice]);
 return <LabContext.Provider value={{state,set:patch=>setState(s=>({...s,...patch})),reset:()=>{setState(DEFAULT_STATE);notify('Experiment parameters reset.');},runs,addRun:run=>setRuns(r=>[...r.slice(-11),run]),updateRun:run=>setRuns(r=>r.map(s=>s.id===run.id?run:s)),removeRun:id=>setRuns(r=>r.filter(s=>s.id!==id)),notice,notify}}>{children}</LabContext.Provider>;
}
export function useLab(){const value=useContext(LabContext);if(!value)throw new Error('LabProvider is required');return value;}
