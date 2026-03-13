/**
 * Markdown and code comment parser for extracting issues from files.
 * Parses TODO.md, ARCHITECTURE.md, README.md, and inline code comments.
 * @packageDocumentation
 */

import fs from 'fs';
import path from 'path';
import type { IssueSource } from '../db/models.js';

/**
 * Represents an extracted issue from a source file.
 * @public
 */
export interface ExtractedIssue {
  /** Title of the extracted issue */
  title: string;
  /** Detailed description if available */
  description: string | null;
  /** Priority inferred from context */
  priority: 'low' | 'medium' | 'high' | 'critical';
  /** Source file path where the issue was found */
  sourceFile: string;
  /** Type of issue extracted */
  type: 'todo' | 'fixme' | 'hack' | 'note';
}

/**
 * Result of parsing a file for issues.
 * @public
 */
export interface ParseResult {
  /** List of extracted issues */
  issues: ExtractedIssue[];
  /** The full content of the file */
  content: string;
  /** Any warnings encountered during parsing */
  warnings: string[];
}

/**
 * Priority keywords that indicate urgency.
 * @internal
 */
const PRIORITY_KEYWORDS: Record<string, ExtractedIssue['priority']> = {
  critical: 'critical',
  urgent: 'critical',
  important: 'high',
  high: 'high',
  medium: 'medium',
  low: 'low',
  later: 'low',
};

/**
 * Checks if a file is likely a binary file based on content.
 * @param buffer - Buffer to check
 * @returns True if the file appears to be binary
 * @internal
 */
function isBinaryFile(buffer: Buffer): boolean {
  // Check for null bytes which indicate binary content
  for (let i = 0; i < Math.min(buffer.length, 8192); i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

/**
 * Decodes a text buffer as strict UTF-8.
 * I skip non-UTF8 text instead of silently mangling it into latin1.
 *
 * @param buffer - Buffer to decode
 * @param filePath - Source file path for warnings
 * @returns Decoded text or a warning-only result when unsupported
 * @internal
 */
function decodeUtf8(
  buffer: Buffer,
  filePath: string
): { content: string; warning?: string } {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return { content: decoder.decode(buffer) };
  } catch {
    return {
      content: '',
      warning: `Skipping non-UTF8 text file: ${filePath}`,
    };
  }
}

/**
 * Determines priority from text content.
 * @param text - Text to analyze
 * @returns Inferred priority
 * @internal */
function inferPriority(text: string): ExtractedIssue['priority'] {
  const lowerText = text.toLowerCase();
  for (const [keyword, priority] of Object.entries(PRIORITY_KEYWORDS)) {
    if (lowerText.includes(keyword)) {
      return priority;
    }
  }
  return 'medium';
}

/**
 * Determines the issue type from the source.
 * @param source - Source identifier
 * @returns Issue type
 * @internal
 */
function inferType(source: string): ExtractedIssue['type'] {
  const lower = source.toLowerCase();
  if (lower.includes('fixme')) return 'fixme';
  if (lower.includes('hack')) return 'hack';
  if (lower.includes('todo')) return 'todo';
  return 'note';
}

/**
 * Parses a markdown TODO file for task items.
 * @param content - File content
 * @param filePath - Source file path
 * @returns Extracted TODO items
 * @internal
 */
function parseMarkdownTodos(content: string, filePath: string): ExtractedIssue[] {
  const issues: ExtractedIssue[] = [];
  const lines = content.split('\n');

  for (const line of lines) {
    // Match unchecked TODO items
    const uncheckedMatch = line.match(/^- \[ \]\s+(.+)$/);
    if (uncheckedMatch) {
      const title = uncheckedMatch[1].trim();
      issues.push({
        title,
        description: null,
        priority: inferPriority(title),
        sourceFile: filePath,
        type: 'todo',
      });
    }
  }

  return issues;
}

/**
 * Parses code files for inline TODO/FIXME/HACK comments.
 * Supports JavaScript, TypeScript, Python, Java, C/C++, Go, and Rust.
 * @param content - File content
 * @param filePath - Source file path
 * @returns Extracted issues from comments
 * @internal
 */
function parseCodeComments(content: string, filePath: string): ExtractedIssue[] {
  const issues: ExtractedIssue[] = [];

  // Match single-line comments in various languages
  // eslint-disable-next-line max-len
  const singleLinePattern = /(?:^|\s)(?:\/\/|#|;;|--|<!--)\s*(?:TODO|FIXME|HACK|XXX|NOTE):?\s*(.+)$/gim;

  let match;
  while ((match = singleLinePattern.exec(content)) !== null) {
    const commentText = match[1].trim();
    if (commentText) {
      issues.push({
        title: commentText,
        description: null,
        priority: inferPriority(commentText),
        sourceFile: filePath,
        type: inferType(match[0]),
      });
    }
  }

  // Match multi-line comments in C-style languages
  const multiLinePattern = /\/\*\*?\s*(?:TODO|FIXME|HACK|XXX|NOTE):?\s*([\s\S]*?)\*\//gi;
  while ((match = multiLinePattern.exec(content)) !== null) {
    const commentText = match[1].replace(/\n\s*\*\s*/g, ' ').trim();
    if (commentText) {
      issues.push({
        title: commentText,
        description: null,
        priority: inferPriority(commentText),
        sourceFile: filePath,
        type: inferType(match[0]),
      });
    }
  }

  return issues;
}

/**
 * Parses a file and extracts issues based on file type.
 *
 * @param filePath - Path to the file to parse
 * @param options - Parsing options
 * @returns Result containing extracted issues or error
 * @example
 * ```typescript
 * const result = await parseFile('./TODO.md');
 * if (result.success) {
 *   console.log(result.data.issues);
 * }
 * ```
 * @public
 */
export async function parseFile(
  filePath: string,
  options: { fileSizeLimitMb?: number } = {}
): Promise<{ success: true; data: ParseResult } | { success: false; error: Error }> {
  const fileSizeLimitMb = options.fileSizeLimitMb ?? 10;
  const warnings: string[] = [];

  try {
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      return { success: false, error: new Error(`File not found: ${filePath}`) };
    }

    // Get file stats
    const stats = fs.statSync(filePath);

    // Check file size
    if (stats.size > fileSizeLimitMb * 1024 * 1024) {
      return {
        success: false,
        error: new Error(
          `File too large: ${filePath} (${(stats.size / 1024 / 1024).toFixed(2)}MB > ${fileSizeLimitMb}MB)`
        ),
      };
    }

    // Read file
    const buffer = fs.readFileSync(filePath);

    // Check for binary content
    if (isBinaryFile(buffer)) {
      warnings.push(`Skipping binary file: ${filePath}`);
      return { success: true, data: { issues: [], content: '', warnings } };
    }

    const decoded = decodeUtf8(buffer, filePath);
    if (decoded.warning) {
      warnings.push(decoded.warning);
      return { success: true, data: { issues: [], content: '', warnings } };
    }

    const content = decoded.content;

    // Parse based on file extension
    const ext = path.extname(filePath).toLowerCase();
    const issues: ExtractedIssue[] = [];

    // Special handling for known file types
    if (['.md', '.markdown', '.todo', '.todos'].includes(ext)) {
      issues.push(...parseMarkdownTodos(content, filePath));
    }

    // Parse code comments for all code files
    if (isCodeFile(ext)) {
      issues.push(...parseCodeComments(content, filePath));
    }

    return {
      success: true,
      data: {
        issues,
        content,
        warnings,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}

/**
 * Determines if a file extension represents a code file.
 * @param ext - File extension (including the dot)
 * @returns True if it's a code file we should scan for comments
 * @internal
 */
function isCodeFile(ext: string): boolean {
  const codeExtensions = new Set([
    '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs',
    '.py', '.pyw',
    '.java', '.kt', '.kts',
    '.c', '.cpp', '.cc', '.cxx', '.h', '.hpp',
    '.go',
    '.rs',
    '.rb',
    '.php',
    '.swift',
    '.scala',
    '.cs',
    '.vue', '.svelte',
    '.sh', '.bash', '.zsh',
    '.sql',
  ]);
  return codeExtensions.has(ext.toLowerCase());
}

/**
 * Checks if a file should be scanned based on include/exclude patterns.
 *
 * @param filePath - Path to check
 * @param options - Include and exclude patterns
 * @returns True if the file should be scanned
 * @public
 */
export function shouldScanFile(
  filePath: string,
  options: { include?: string[]; exclude?: string[] } = {}
): boolean {
  const include = options.include ?? ['**/*.md', '**/*.ts', '**/*.js', '**/*.py'];
  const exclude = options.exclude ?? ['node_modules', '.git', 'dist', 'build'];

  const name = path.basename(filePath);
  const relativePath = filePath;

  // Check exclude patterns first
  for (const pattern of exclude) {
    if (pattern.startsWith('**/')) {
      // Glob pattern like **/node_modules
      const globPart = pattern.slice(3);
      if (name === globPart || relativePath.includes(globPart)) {
        return false;
      }
    } else if (name === pattern || relativePath.includes(`/${pattern}/`)) {
      return false;
    }
  }

  // Check include patterns
  for (const pattern of include) {
    if (pattern.startsWith('**/*.')) {
      // Extension pattern like **/*.md
      const ext = pattern.slice(4);
      if (name.endsWith(ext)) {
        return true;
      }
    } else if (name === pattern || relativePath.includes(pattern)) {
      return true;
    }
  }

  // Default: include code files
  return isCodeFile(path.extname(filePath));
}

/**
 * Gets the source type based on file name.
 * @param filePath - Path to the file
 * @returns The inferred source type
 * @public
 */
export function getSourceFromFile(filePath: string): IssueSource {
  const name = path.basename(filePath).toLowerCase();
  if (name.includes('todo')) return 'scanner';
  if (name.includes('architecture') || name.includes('arch')) return 'scanner';
  return 'scanner';
}
