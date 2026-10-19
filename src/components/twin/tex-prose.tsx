import { Tex } from '../tex';

/** Prose with LaTeX between dollar signs, the way the twin texts are written: "the edge $E_0$ moves". */
export function TexProse({ children }: { children: string }) {
  return <>{children.split('$').map((part, i) => i % 2 ? <Tex key={i}>{part}</Tex> : part)}</>;
}
