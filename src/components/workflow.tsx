'use client';
import Link from 'next/link';
import { useLab } from './lab-context';
export const WORKFLOW = [
  ['sample','Choose a sample','/crystal/'],
  ['active','Choose an active space','/electronic/'],
  ['kick','Kick the ground state','/quantum/?step=kick'],
  ['evolve','Evolve in time','/quantum/?step=evolve'],
  ['sampling','Sample the signal','/quantum/?step=sampling'],
  ['transform','Transform to energy','/quantum/?step=transform'],
  ['validate','Compare and validate','/spectra/'],
  ['cost','Check the cost and limits','/validation/'],
] as const;
export function WorkflowRail() {
  const {progress}=useLab();
  return <section className="workflow-section"><h2>Follow the research workflow</h2><p className="muted">{progress.length} of 8 steps explored</p><nav aria-label="Research workflow"><ol className="workflow-rail">{WORKFLOW.map(([id,title,href],i)=><li key={id} className={progress.includes(id)?'done':''}><Link href={href} aria-label={`${i+1} ${title}`+(progress.includes(id)?', completed':'')}><span aria-hidden="true">{i+1}</span>{title}</Link></li>)}</ol></nav></section>;
}
export function WorkflowNext({steps,done}:{steps:string[];done:boolean}) {
  const index=WORKFLOW.findIndex(([id])=>steps.includes(id));
  if(index<0)return null;
  const last=Math.max(...steps.map(id=>WORKFLOW.findIndex(([key])=>key===id)));
  return <nav className="workflow-next" aria-label="Workflow controls"><Link href={index>0?WORKFLOW[index-1][2]:'/'}>Back</Link><Link href={last<7?WORKFLOW[last+1][2]:'/'}>{done?'Next step':'Skip for now'}</Link></nav>;
}
