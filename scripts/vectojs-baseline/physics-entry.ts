import { ForceLayout2D } from '@vectojs/graph-layout';
import {
  runPhysicsBrowserWorkload,
  type ForceLayoutConstructor,
  type PhysicsBrowserRequest,
  type PhysicsBrowserResult,
} from './physics-browser';

export interface PhysicsBaselineBrowserApi {
  run(request: PhysicsBrowserRequest): Promise<PhysicsBrowserResult>;
}

export const physicsBaselineBrowserApi: PhysicsBaselineBrowserApi = {
  run: (request) => runPhysicsBrowserWorkload(ForceLayout2D as ForceLayoutConstructor, request),
};

declare global {
  interface Window {
    __VECTOJS_PHYSICS_BASELINE__?: PhysicsBaselineBrowserApi;
  }
}

if (typeof window !== 'undefined') window.__VECTOJS_PHYSICS_BASELINE__ = physicsBaselineBrowserApi;
