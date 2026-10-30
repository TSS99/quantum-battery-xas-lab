// The parts of n8ao (shipped without types) that hutch-3d-cache.ts uses.
declare module 'n8ao' {
  import type { Camera, Scene, Texture, WebGLRenderTarget, WebGLRenderer } from 'three';
  export class N8AOPostPass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: Record<string, unknown>;
    setQualityMode(mode: 'Performance' | 'Low' | 'Medium' | 'High' | 'Ultra'): void;
    setSize(width: number, height: number): void;
    setDepthTexture(texture: Texture): void;
    render(renderer: WebGLRenderer, inputBuffer: WebGLRenderTarget, outputBuffer: WebGLRenderTarget): void;
    dispose(): void;
  }
}
