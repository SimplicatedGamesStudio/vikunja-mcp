/**
 * Kanban Tool Module
 * Provides access to kanban view buckets and tasks grouped by bucket.
 * Uses direct API calls since node-vikunja doesn't expose view/bucket endpoints.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { AuthManager } from '../auth/AuthManager';
import type { VikunjaClientFactory } from '../client/VikunjaClientFactory';
import { MCPError, ErrorCode } from '../types';
import { createAuthRequiredError, wrapToolError } from '../utils/error-handler';
import { createSuccessResponse, formatMcpResponse } from '../utils/simple-response';

// ─── Types ───────────────────────────────────────────────────────────────────

interface BucketResponse {
  id: number;
  title: string;
  project_view_id: number;
  limit: number;
  count: number;
  position: number;
  created: string;
  updated: string;
  created_by?: { id: number; name: string; username: string };
}

interface ViewTaskBucket {
  id: number;
  title: string;
  project_view_id: number;
  tasks: ViewTask[];
  position: number;
}

interface ViewTask {
  id: number;
  title: string;
  description?: string;
  done: boolean;
  due_date?: string;
  priority: number;
  project_id: number;
  bucket_id: number;
  position: number;
  labels?: Array<{ id: number; title: string; hex_color?: string }>;
  assignees?: Array<{ id: number; username: string; name?: string }>;
  percent_done?: number;
  created?: string;
  updated?: string;
}

type McpResponse = {
  content: Array<{ type: 'text'; text: string }>;
};

// ─── API Helpers ─────────────────────────────────────────────────────────────

async function vikunjaFetch<T>(
  authManager: AuthManager,
  path: string,
  options?: { method?: string; body?: unknown }
): Promise<T> {
  const session = authManager.getSession();
  const url = `${session.apiUrl}${path}`;

  const response = await fetch(url, {
    method: options?.method || 'GET',
    headers: {
      'Authorization': `Bearer ${session.apiToken}`,
      'Content-Type': 'application/json',
    },
    ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new MCPError(
      ErrorCode.API_ERROR,
      `Vikunja API error ${response.status}: ${body || response.statusText}`
    );
  }

  return response.json() as Promise<T>;
}

// ─── Subcommand Handlers ─────────────────────────────────────────────────────

async function listBuckets(
  authManager: AuthManager,
  projectId: number,
  viewId: number
): Promise<McpResponse> {
  const buckets = await vikunjaFetch<BucketResponse[]>(
    authManager,
    `/projects/${projectId}/views/${viewId}/buckets`
  );

  const sorted = buckets.sort((a, b) => a.position - b.position);

  let md = `## ✅ Success\n\nFound ${sorted.length} buckets\n\n**Operation:** list-buckets\n\n`;
  for (const [i, b] of sorted.entries()) {
    md += `### ${i + 1}. **${b.title}** (ID: ${b.id})\n`;
    md += `- **Position:** ${b.position}\n`;
    if (b.limit > 0) md += `- **WIP Limit:** ${b.limit}\n`;
    md += '\n';
  }

  return { content: [{ type: 'text' as const, text: md }] };
}

async function listViewTasks(
  authManager: AuthManager,
  projectId: number,
  viewId: number,
  bucketTitle?: string,
  bucketId?: number,
): Promise<McpResponse> {
  const data = await vikunjaFetch<ViewTaskBucket[]>(
    authManager,
    `/projects/${projectId}/views/${viewId}/tasks?per_page=200`
  );

  // Filter to requested bucket if specified
  let buckets = data.sort((a, b) => a.position - b.position);

  if (bucketId !== undefined) {
    buckets = buckets.filter(b => b.id === bucketId);
    if (buckets.length === 0) {
      throw new MCPError(ErrorCode.NOT_FOUND, `Bucket with ID ${bucketId} not found`);
    }
  } else if (bucketTitle !== undefined) {
    const lower = bucketTitle.toLowerCase();
    buckets = buckets.filter(b => b.title.toLowerCase() === lower);
    if (buckets.length === 0) {
      throw new MCPError(
        ErrorCode.NOT_FOUND,
        `Bucket "${bucketTitle}" not found. Available buckets: ${data.map(b => b.title).join(', ')}`
      );
    }
  }

  // Build markdown
  let totalTasks = 0;
  let md = '';

  for (const bucket of buckets) {
    const tasks = bucket.tasks || [];
    totalTasks += tasks.length;

    md += `## ${bucket.title} (${tasks.length} tasks)\n\n`;

    if (tasks.length === 0) {
      md += '_No tasks_\n\n';
      continue;
    }

    for (const [i, t] of tasks.entries()) {
      md += `### ${i + 1}. **${t.title}** (ID: ${t.id})\n`;
      md += `- **Status:** ${t.done ? '✅ Done' : '❌ Not Done'}\n`;
      if (t.priority > 0) {
        md += `- **Priority:** ${'⭐'.repeat(Math.min(t.priority, 5))} (${t.priority}/5)\n`;
      }
      if (t.labels && t.labels.length > 0) {
        md += `- **Labels:** ${t.labels.map(l => l.title).join(', ')}\n`;
      }
      if (t.assignees && t.assignees.length > 0) {
        md += `- **Assignees:** ${t.assignees.map(a => a.name || a.username).join(', ')}\n`;
      }
      if (t.description) {
        // Strip HTML and truncate for readability
        const plain = t.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const truncated = plain.length > 300 ? plain.substring(0, 300) + '...' : plain;
        md += `- **Description:** ${truncated}\n`;
      }
      md += '\n';
    }
  }

  const header = bucketTitle || bucketId !== undefined
    ? `Found ${totalTasks} tasks in bucket "${buckets[0]?.title}"`
    : `Found ${totalTasks} tasks across ${buckets.length} buckets`;

  const fullMd = `## ✅ Success\n\n${header}\n\n**Operation:** list-view-tasks\n\n${md}`;

  return { content: [{ type: 'text' as const, text: fullMd }] };
}

async function getKanbanViewId(
  authManager: AuthManager,
  projectId: number
): Promise<McpResponse> {
  // Get project details which include views
  const project = await vikunjaFetch<{
    id: number;
    title: string;
    views?: Array<{
      id: number;
      title: string;
      view_kind: string;
      bucket_configuration_mode?: string;
      default_bucket_id?: number;
      done_bucket_id?: number;
    }>;
  }>(authManager, `/projects/${projectId}`);

  const views = project.views || [];
  const kanbanViews = views.filter(v => v.view_kind === 'kanban');

  let md = `## ✅ Success\n\nProject: **${project.title}** — ${views.length} views, ${kanbanViews.length} kanban\n\n**Operation:** get-views\n\n`;

  for (const [i, v] of views.entries()) {
    const isKanban = v.view_kind === 'kanban' ? ' 📋' : '';
    md += `### ${i + 1}. **${v.title}** (ID: ${v.id})${isKanban}\n`;
    md += `- **Kind:** ${v.view_kind}\n`;
    if (v.bucket_configuration_mode) {
      md += `- **Bucket Config:** ${v.bucket_configuration_mode}\n`;
    }
    md += '\n';
  }

  return { content: [{ type: 'text' as const, text: md }] };
}

async function moveTask(
  authManager: AuthManager,
  projectId: number,
  viewId: number,
  taskId: number,
  targetBucketId?: number,
  position?: number,
): Promise<McpResponse> {
  if (targetBucketId === undefined && position === undefined) {
    throw new MCPError(ErrorCode.VALIDATION_ERROR, 'At least one of targetBucketId or position is required');
  }

  const actions: string[] = [];

  // Step 1: Move task to a different bucket (view-level, does NOT touch task content)
  // Endpoint: POST /projects/{p}/views/{v}/buckets/{b}/tasks  body: {task_id}
  if (targetBucketId !== undefined) {
    await vikunjaFetch<{ task_id: number; bucket_id: number; project_view_id: number }>(
      authManager,
      `/projects/${projectId}/views/${viewId}/buckets/${targetBucketId}/tasks`,
      { method: 'POST', body: { task_id: taskId } }
    );
    actions.push(`Moved to bucket ID ${targetBucketId}`);
  }

  // Step 2: Set position within the bucket (view-level, does NOT touch task content)
  // Endpoint: POST /tasks/{id}/position  body: {task_id, project_view_id, position}
  if (position !== undefined) {
    await vikunjaFetch<{ task_id: number; project_view_id: number; position: number }>(
      authManager,
      `/tasks/${taskId}/position`,
      { method: 'POST', body: { task_id: taskId, project_view_id: viewId, position } }
    );
    actions.push(`Position set to ${position}`);
  }

  let md = `## ✅ Success\n\nUpdated task ID ${taskId} in view ${viewId}\n\n**Operation:** move-task\n\n`;
  for (const a of actions) {
    md += `- ${a}\n`;
  }

  return { content: [{ type: 'text' as const, text: md }] };
}

// ─── Tool Registration ───────────────────────────────────────────────────────

export function registerKanbanTool(
  server: McpServer,
  authManager: AuthManager,
  _clientFactory?: VikunjaClientFactory
): void {
  server.tool(
    'vikunja_kanban',
    'Access kanban board views: list buckets, get tasks grouped by bucket, or filter tasks by bucket name/ID',
    {
      subcommand: z.enum(['list-buckets', 'get-tasks', 'get-views', 'move-task']),
      projectId: z.number().positive(),
      viewId: z.number().positive().optional().describe('Kanban view ID (use get-views to find it)'),
      bucketTitle: z.string().optional().describe('Filter tasks by bucket title (e.g. "Doing")'),
      bucketId: z.number().positive().optional().describe('Filter tasks by bucket ID'),
      taskId: z.number().positive().optional().describe('Task ID to move (for move-task)'),
      targetBucketId: z.number().positive().optional().describe('Destination bucket ID (for move-task)'),
      position: z.number().optional().describe('New position within the bucket (for move-task)'),
    },
    async (args) => {
      if (!authManager.isAuthenticated()) {
        throw createAuthRequiredError('access kanban board');
      }

      try {
        switch (args.subcommand) {
          case 'get-views':
            return await getKanbanViewId(authManager, args.projectId);

          case 'list-buckets': {
            if (!args.viewId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'viewId is required for list-buckets');
            }
            return await listBuckets(authManager, args.projectId, args.viewId);
          }

          case 'get-tasks': {
            if (!args.viewId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'viewId is required for get-tasks');
            }
            return await listViewTasks(
              authManager,
              args.projectId,
              args.viewId,
              args.bucketTitle,
              args.bucketId
            );
          }

          case 'move-task': {
            if (!args.viewId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'viewId is required for move-task');
            }
            if (!args.taskId) {
              throw new MCPError(ErrorCode.VALIDATION_ERROR, 'taskId is required for move-task');
            }
            return await moveTask(
              authManager,
              args.projectId,
              args.viewId,
              args.taskId,
              args.targetBucketId,
              args.position
            );
          }

          default:
            throw new MCPError(ErrorCode.VALIDATION_ERROR, `Unknown subcommand: ${String(args.subcommand)}`);
        }
      } catch (error) {
        if (error instanceof MCPError) throw error;
        throw wrapToolError(error, 'vikunja_kanban', args.subcommand, args.projectId);
      }
    }
  );
}
