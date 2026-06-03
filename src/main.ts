import './regimes/GalaxyRuntimePatch';
import './AppControlsPatch';
import { App } from './App';
import { runPhysicsSelfTest } from './core/physicsSelfTest';
import { installTooltips } from './ui/Tooltip';

if (import.meta.env.DEV) runPhysicsSelfTest();

installTooltips();
new App();
