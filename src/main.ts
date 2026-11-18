import { App } from './App';
import { runPhysicsSelfTest } from './core/physicsSelfTest';
import { installTooltips } from './ui/Tooltip';

if (import.meta.env.DEV) runPhysicsSelfTest();

installTooltips();
const app = new App();
// Development builds expose the app for automated checks.
if (import.meta.env.DEV) (window as unknown as { __unisim?: App }).__unisim = app;
