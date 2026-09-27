import { mount as mountSurface } from './surface';
export const mount: typeof mountSurface = (container, context) => mountSurface(container, context, true);
export const surfaceTarget = 'mobile' as const;

import '@tap-examples/tap-mobile-ui/styles.css';
import './mobile.css';
