import type { ASTNode } from '@solidity-parser/parser/dist/src/ast-types';
import { ParsedFile, ContractInfo, FunctionInfo, Finding } from './types';

/**
 * AnalysisContext wraps a parsed file and provides convenience methods
 * for detectors to query contract structure and walk the AST.
 */
export class AnalysisContext {
  readonly file: ParsedFile;
  readonly sourceLines: string[];
  private readonly findings: Finding[] = [];

  constructor(file: ParsedFile) {
    this.file = file;
    this.sourceLines = file.source.split('\n');
  }

  get contracts(): ContractInfo[] {
    return this.file.contracts;
  }

  get filePath(): string {
    return this.file.path;
  }

  get source(): string {
    return this.file.source;
  }

  get linesOfCode(): number {
    return this.sourceLines.filter(l => l.trim().length > 0).length;
  }

  addFinding(finding: Finding): void {
    this.findings.push(finding);
  }

  getFindings(): Finding[] {
    return [...this.findings];
  }

  /** Get the source snippet for a given AST node */
  getSnippet(node: ASTNode, contextLines = 0): string {
    const loc = (node as any).loc;
    if (!loc) return '';

    const startLine = Math.max(0, loc.start.line - 1 - contextLines);
    const endLine = Math.min(this.sourceLines.length, loc.end.line + contextLines);

    return this.sourceLines.slice(startLine, endLine).join('\n');
  }

  /** Get line number from AST node */
  getLine(node: ASTNode): number {
    const loc = (node as any).loc;
    return loc ? loc.start.line : 0;
  }

  /** Get the Solidity compiler version from pragma */
  getSolidityVersion(): string | undefined {
    for (const pragma of this.file.pragmas) {
      if (pragma.name === 'solidity') {
        return pragma.value;
      }
    }
    return undefined;
  }

  /** Check if Solidity version is >= 0.8.0 (has built-in overflow checks) */
  hasBuiltinOverflowChecks(): boolean {
    const version = this.getSolidityVersion();
    if (!version) return false;
    const match = version.match(/(\d+)\.(\d+)/);
    if (!match) return false;
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    return major > 0 || minor >= 8;
  }

  /** Walk all nodes in the AST depth-first */
  walk(callback: (node: ASTNode, parent?: ASTNode) => void): void {
    this.walkNode(this.file.ast, undefined, callback);
  }

  /** Walk nodes within a specific subtree */
  walkNode(
    node: ASTNode | any,
    parent: ASTNode | undefined,
    callback: (node: ASTNode, parent?: ASTNode) => void
  ): void {
    if (!node || typeof node !== 'object') return;

    if (node.type) {
      callback(node, parent);
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'range') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) {
          if (item && typeof item === 'object' && item.type) {
            this.walkNode(item, node, callback);
          }
        }
      } else if (child && typeof child === 'object' && child.type) {
        this.walkNode(child, node, callback);
      }
    }
  }

  /** Find all nodes of a given type within a subtree */
  findNodes(root: ASTNode, type: string): ASTNode[] {
    const results: ASTNode[] = [];
    this.walkNode(root, undefined, (node) => {
      if (node.type === type) results.push(node);
    });
    return results;
  }

  /** Check if a function has a specific modifier */
  functionHasModifier(fn: FunctionInfo, modifierName: string): boolean {
    return fn.modifiers.some(m =>
      m.toLowerCase() === modifierName.toLowerCase()
    );
  }

  /** Check if a function is externally callable */
  isExternallyCallable(fn: FunctionInfo): boolean {
    return (
      fn.visibility === 'public' ||
      fn.visibility === 'external' ||
      fn.visibility === 'default'
    );
  }

  /** Check if a function modifies state */
  isStateMutating(fn: FunctionInfo): boolean {
    return (
      fn.stateMutability !== 'view' &&
      fn.stateMutability !== 'pure'
    );
  }

  /** Get all external calls in a function body */
  getExternalCalls(fnNode: ASTNode): ASTNode[] {
    const calls: ASTNode[] = [];
    this.walkNode(fnNode, undefined, (node: any) => {
      if (node.type === 'FunctionCall') {
        const expr = node.expression;
        // member access calls: addr.call(), addr.send(), addr.transfer(), contract.func()
        if (expr?.type === 'MemberAccess') {
          calls.push(node);
        }
        // Handle NameValueExpression: addr.call{value: x}()
        if (expr?.type === 'NameValueExpression' && expr.expression?.type === 'MemberAccess') {
          calls.push(node);
        }
      }
    });
    return calls;
  }

  /** Get all state variable assignments in a subtree */
  getStateAssignments(root: ASTNode, contract: ContractInfo): ASTNode[] {
    const stateVarNames = new Set(contract.stateVariables.map(v => v.name));
    const assignments: ASTNode[] = [];

    this.walkNode(root, undefined, (node: any) => {
      if (
        node.type === 'ExpressionStatement' &&
        node.expression?.type === 'BinaryOperation' &&
        node.expression.operator === '='
      ) {
        const left = node.expression.left;
        if (left?.type === 'Identifier' && stateVarNames.has(left.name)) {
          assignments.push(node);
        }
        if (left?.type === 'IndexAccess' && left.base?.type === 'Identifier' && stateVarNames.has(left.base.name)) {
          assignments.push(node);
        }
        if (left?.type === 'MemberAccess' && left.expression?.type === 'Identifier' && stateVarNames.has(left.expression.name)) {
          assignments.push(node);
        }
      }
    });

    return assignments;
  }
}
