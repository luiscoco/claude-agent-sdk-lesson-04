import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { workspacePath } from './paths.js';
import type { Workspace } from '../shared/lesson.js';
export const TOOL_NAME = 'mcp__project__read_project_note';
export async function readProjectNote(
  workspace: Workspace,
  file: 'README.md' | 'architecture.json',
) {
  const root = await realpath(workspacePath(workspace));
  const target = await realpath(path.join(root, file));
  if (!target.startsWith(root + path.sep))
    throw new Error('The requested note leaves the fixture workspace.');
  const text = await readFile(target, 'utf8');
  if (text.length > 16000) throw new Error('Fixture note is too large.');
  return { workspace, file, text };
}
export function createProjectServer(
  workspace: Workspace,
  onRead: (file: string) => void = () => {},
) {
  return createSdkMcpServer({
    name: 'project-notes',
    version: '1.0.0',
    tools: [
      tool(
        'read_project_note',
        'Read a bundled project note. Only README.md and architecture.json are available; no arbitrary paths.',
        { file: z.enum(['README.md', 'architecture.json']) },
        async ({ file }) => {
          const note = await readProjectNote(workspace, file);
          onRead(file);
          return {
            content: [{ type: 'text', text: JSON.stringify(note) }],
            structuredContent: note,
          };
        },
        { annotations: { readOnlyHint: true, openWorldHint: false } },
      ),
    ],
  });
}
