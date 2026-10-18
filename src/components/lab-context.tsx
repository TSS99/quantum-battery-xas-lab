'use client';
import { createContext, useContext, useCallback, useEffect, useState, type ReactNode } from 'react';
import { DEFAULT_STATE, type LabState, validateScenario, scenarioFromURL, elementFromURL, selectElement } from '@/lib/scenario';
import { batteryFormula, isBattery } from '@/lib/sample';
import type { Spectrum } from '@/lib/spectra';

interface Context { progress:string[]; complete:(steps:string[])=>void; loadPreset:(patch:Partial<LabState>)=>void; undoPreset:()=>void; canUndo:boolean; state:LabState; set:(patch:Partial<LabState>)=>void; reset:()=>void; runs:Spectrum[]; addRun:(run:Spectrum)=>void; updateRun:(run:Spectrum)=>void; removeRun:(id:string)=>void; notice:string; notify:(text:string)=>void; }
const LabContext=createContext<Context|null>(null);
export function LabProvider({children}:{children:ReactNode}) {
 const [progress,setProgress]=useState<string[]>([]); const complete=useCallback((steps:string[])=>setProgress(p=>steps.every(s=>p.includes(s))?p:[...new Set([...p,...steps])]),[]);
 const [state,setState]=useState<LabState>(DEFAULT_STATE); const [previous,setPrevious]=useState<LabState|null>(null); const [runs,setRuns]=useState<Spectrum[]>([]); const [notice,notify]=useState(''); const [ready,setReady]=useState(false);
 useEffect(()=>{try { const prior=JSON.parse(sessionStorage.getItem('qbx-progress')||'[]'); if(Array.isArray(prior))setProgress(prior.filter((s:unknown)=>typeof s==='string'&&['sample','active','kick','evolve','sampling','transform','validate','cost'].includes(s))); const stored=localStorage.getItem('qbx-state-v1'); if(stored) setState(validateScenario(JSON.parse(stored))); const shared=scenarioFromURL(window.location.href); if(shared) setState(shared); } catch {notify('Saved settings could not be read. Defaults restored.');}
  // Links from the element pages: ?element=Fe&edge=K selects that element as a pure sample.
  try { const link=elementFromURL(window.location.href); if(link){setState(s=>selectElement(s,link));notify(`Selected ${link.element} with its ${link.edge} edge. The X-ray tables have no density, so enter your sample's density on the Sample page.`);} } catch(e) {notify(e instanceof Error?e.message:'This element link could not be read.');}
  setReady(true);},[]);
 useEffect(()=>{if(ready)try{localStorage.setItem('qbx-state-v1',JSON.stringify(state));}catch{/* Storage can be unavailable in private browsing. */}},[ready,state]);
 useEffect(()=>{if(!notice)return;const id=setTimeout(()=>notify(''),6000);return()=>clearTimeout(id);},[notice]);
 useEffect(()=>{if(ready)try{sessionStorage.setItem('qbx-progress',JSON.stringify(progress));}catch{}},[ready,progress]);
 return <LabContext.Provider value={{progress,complete,loadPreset:patch=>{setPrevious(state);const next={...DEFAULT_STATE,...patch};if(isBattery(next.sample))next.sample={...next.sample,formula:batteryFormula(next.x)};setState(next);},canUndo:!!previous,undoPreset:()=>{if(previous){setState(previous);setPrevious(null);notify('Previous settings restored.');}},state,set:patch=>setState(s=>{const next={...s,...patch};if(patch.x!==undefined&&isBattery(next.sample))next.sample={...next.sample,formula:batteryFormula(next.x)};return next;}),reset:()=>{setState(DEFAULT_STATE);notify('Experiment parameters reset.');},runs,addRun:run=>setRuns(r=>[...r.slice(-11),run]),updateRun:run=>setRuns(r=>r.map(s=>s.id===run.id?run:s)),removeRun:id=>setRuns(r=>r.filter(s=>s.id!==id)),notice,notify}}>{children}</LabContext.Provider>;
}
export function useLab(){const value=useContext(LabContext);if(!value)throw new Error('LabProvider is required');return value;}
