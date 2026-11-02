import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Workspace } from '../shared/lesson.js';
export const PROJECT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const CONFIG_DIRECTORY = path.join(PROJECT_ROOT, '.local', 'sdk-state');
export const workspacePath = (workspace: Workspace) =>
  path.join(PROJECT_ROOT, 'fixtures', 'workspaces', workspace);
