/**
 * Task Read Service
 * Handles task retrieval operations with comprehensive error handling
 */

import { MCPError, ErrorCode, getClientFromContext, transformApiError, handleFetchError, handleStatusCodeError } from '../../../index';
import { validateId } from '../validation';
import { formatAorpAsMarkdown } from '../../../utils/response-factory';
import { createSuccessResponse } from '../../../utils/simple-response';
import { logger } from '../../../utils/logger';
import type { TaskComment } from '../../../types/vikunja';

export interface GetTaskArgs {
  id?: number;
  sessionId?: string;
}

/**
 * Retrieves a task by ID with full details including comments
 */
export async function getTask(args: GetTaskArgs): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    if (!args.id) {
      throw new MCPError(ErrorCode.VALIDATION_ERROR, 'Task id is required for get operation');
    }
    validateId(args.id, 'id');

    const client = await getClientFromContext();

    // Fetch task and comments in parallel
    const fetchComments = async (): Promise<TaskComment[]> => {
      try {
        return await client.tasks.getTaskComments(args.id!);
      } catch (err: unknown) {
        logger.warn('Failed to fetch comments for task', { taskId: args.id, error: err instanceof Error ? err.message : String(err) });
        return [];
      }
    };

    const [task, comments] = await Promise.all([
      client.tasks.getTask(args.id),
      fetchComments(),
    ]);

    // Build rich markdown response with all task details
    const content = formatTaskDetail(task, comments);

    const response = createSuccessResponse(
      'get-task',
      content,
      undefined,
      {
        timestamp: new Date().toISOString(),
        taskId: args.id,
      }
    );

    return {
      content: [
        {
          type: 'text' as const,
          text: formatAorpAsMarkdown(response),
        },
      ],
    };
  } catch (error) {
    // Re-throw MCPError instances without modification
    if (error instanceof MCPError) {
      throw error;
    }

    // Handle fetch/connection errors with helpful guidance
    if (error instanceof Error && (
      error.message.includes('fetch failed') ||
      error.message.includes('ECONNREFUSED') ||
      error.message.includes('ENOTFOUND')
    )) {
      throw handleFetchError(error, 'get task');
    }

    // Use standardized error transformation for all other errors
    if (args.id) {
      throw handleStatusCodeError(error, 'get task', args.id, `Task with ID ${args.id} not found`);
    }
    throw transformApiError(error, 'Failed to get task');
  }
}

/**
 * Formats a task with all its details into readable markdown
 */
function formatTaskDetail(task: Record<string, unknown>, comments: TaskComment[]): string {
  const parts: string[] = [];

  // Title and ID
  parts.push(`**${task.title as string}** (ID: ${task.id as number})`);

  // Status
  const status = task.done ? '✅ Done' : '❌ Not Done';
  parts.push(`**Status:** ${status}`);

  // Priority
  if (task.priority !== undefined && (task.priority as number) > 0) {
    const stars = '⭐'.repeat(Math.min(task.priority as number, 5));
    parts.push(`**Priority:** ${stars} (${task.priority as number}/5)`);
  }

  // Due date
  if (task.due_date) {
    parts.push(`**Due:** ${task.due_date as string}`);
  }

  // Progress
  if (task.percent_done !== undefined && (task.percent_done as number) > 0) {
    parts.push(`**Progress:** ${task.percent_done as number}%`);
  }

  // Project
  if (task.project_id) {
    parts.push(`**Project ID:** ${task.project_id as number}`);
  }

  // Labels
  const labels = task.labels as Array<{ title: string }> | undefined;
  if (labels && labels.length > 0) {
    parts.push(`**Labels:** ${labels.map(l => l.title).join(', ')}`);
  }

  // Assignees
  const assignees = task.assignees as Array<{ username: string; email?: string }> | undefined;
  if (assignees && assignees.length > 0) {
    const names = assignees.map(a => a.email ? `${a.username} (${a.email})` : a.username).join(', ');
    parts.push(`**Assignees:** ${names}`);
  }

  // Description (full, not truncated)
  if (task.description) {
    parts.push(`\n**Description:**\n${task.description as string}`);
  }

  // Comments
  if (comments.length > 0) {
    parts.push(`\n**Comments (${comments.length}):**`);
    for (const comment of comments) {
      const author = comment.author?.username || 'Unknown';
      const date = comment.created ? new Date(comment.created).toLocaleDateString() : '';
      parts.push(`- **${author}** (${date}): ${comment.comment}`);
    }
  }

  return parts.join('\n');
}