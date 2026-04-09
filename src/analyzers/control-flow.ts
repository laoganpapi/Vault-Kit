import type { ASTNode } from '@solidity-parser/parser/dist/src/ast-types';
import { walkAST } from '../utils/ast-helpers';

export interface CFGBlock {
  id: number;
  statements: ASTNode[];
  successors: number[];
  predecessors: number[];
  isEntry: boolean;
  isExit: boolean;
}

export interface ControlFlowGraph {
  blocks: Map<number, CFGBlock>;
  entry: number;
  exits: number[];
}

let blockCounter = 0;

function newBlock(isEntry = false): CFGBlock {
  return {
    id: blockCounter++,
    statements: [],
    successors: [],
    predecessors: [],
    isEntry,
    isExit: false,
  };
}

/**
 * Builds a simplified control flow graph for a function body.
 * Tracks statement ordering to detect patterns like state changes after external calls.
 */
export function buildCFG(fnBody: any): ControlFlowGraph {
  blockCounter = 0;
  const blocks = new Map<number, CFGBlock>();

  const entry = newBlock(true);
  blocks.set(entry.id, entry);

  if (!fnBody || !fnBody.statements) {
    entry.isExit = true;
    return { blocks, entry: entry.id, exits: [entry.id] };
  }

  let current = entry;

  for (const stmt of fnBody.statements) {
    if (stmt.type === 'IfStatement') {
      current.statements.push(stmt);

      const thenBlock = newBlock();
      blocks.set(thenBlock.id, thenBlock);
      addEdge(blocks, current.id, thenBlock.id);

      if (stmt.trueBody?.statements) {
        for (const s of stmt.trueBody.statements) {
          thenBlock.statements.push(s);
        }
      }

      const afterBlock = newBlock();
      blocks.set(afterBlock.id, afterBlock);
      addEdge(blocks, thenBlock.id, afterBlock.id);

      if (stmt.falseBody) {
        const elseBlock = newBlock();
        blocks.set(elseBlock.id, elseBlock);
        addEdge(blocks, current.id, elseBlock.id);
        if (stmt.falseBody.statements) {
          for (const s of stmt.falseBody.statements) {
            elseBlock.statements.push(s);
          }
        }
        addEdge(blocks, elseBlock.id, afterBlock.id);
      } else {
        addEdge(blocks, current.id, afterBlock.id);
      }

      current = afterBlock;
    } else if (stmt.type === 'ForStatement' || stmt.type === 'WhileStatement') {
      const loopHeader = newBlock();
      blocks.set(loopHeader.id, loopHeader);
      addEdge(blocks, current.id, loopHeader.id);
      loopHeader.statements.push(stmt);

      const loopBody = newBlock();
      blocks.set(loopBody.id, loopBody);
      addEdge(blocks, loopHeader.id, loopBody.id);

      if (stmt.body?.statements) {
        for (const s of stmt.body.statements) {
          loopBody.statements.push(s);
        }
      }
      addEdge(blocks, loopBody.id, loopHeader.id); // back edge

      const afterLoop = newBlock();
      blocks.set(afterLoop.id, afterLoop);
      addEdge(blocks, loopHeader.id, afterLoop.id);

      current = afterLoop;
    } else {
      current.statements.push(stmt);
    }
  }

  current.isExit = true;
  const exits = Array.from(blocks.values()).filter(b => b.isExit).map(b => b.id);

  return { blocks, entry: entry.id, exits };
}

function addEdge(blocks: Map<number, CFGBlock>, from: number, to: number): void {
  blocks.get(from)!.successors.push(to);
  blocks.get(to)!.predecessors.push(from);
}

/**
 * Checks the ordering of statements in a function body.
 * Returns pairs of (externalCall, stateChange) where the state change
 * happens after the external call — a classic reentrancy pattern.
 */
export function findStateChangesAfterCalls(
  fnBody: any,
  stateVarNames: Set<string>
): Array<{ call: ASTNode; stateChange: ASTNode }> {
  const results: Array<{ call: ASTNode; stateChange: ASTNode }> = [];
  if (!fnBody?.statements) return results;

  const statements = flattenStatements(fnBody);
  let lastExternalCall: ASTNode | null = null;

  for (const stmt of statements) {
    // Check for external calls (handles both direct MemberAccess and NameValueExpression wrapping)
    let hasExternalCall = false;
    walkAST(stmt, (node: any) => {
      if (node.type === 'FunctionCall') {
        const expr = node.expression;
        let memberAccess: any = null;
        if (expr?.type === 'MemberAccess') {
          memberAccess = expr;
        } else if (expr?.type === 'NameValueExpression' && expr.expression?.type === 'MemberAccess') {
          memberAccess = expr.expression;
        }
        if (memberAccess && ['call', 'send', 'transfer', 'delegatecall'].includes(memberAccess.memberName)) {
          hasExternalCall = true;
          lastExternalCall = node;
        }
      }
    });

    if (hasExternalCall) continue;

    // After an external call, check for state changes
    if (lastExternalCall) {
      walkAST(stmt, (node: any) => {
        const isAssignment =
          node.type === 'BinaryOperation' &&
          (node.operator === '=' || node.operator === '+=' || node.operator === '-=' ||
           node.operator === '*=' || node.operator === '/=' || node.operator === '|=' ||
           node.operator === '&=' || node.operator === '^=');

        if (isAssignment) {
          const left = node.left;
          if (left?.type === 'Identifier' && stateVarNames.has(left.name)) {
            results.push({ call: lastExternalCall!, stateChange: node });
          }
          if (left?.type === 'IndexAccess' && left.base?.type === 'Identifier' && stateVarNames.has(left.base.name)) {
            results.push({ call: lastExternalCall!, stateChange: node });
          }
        }
      });
    }
  }

  return results;
}

/** Flatten nested block statements into a sequential list */
function flattenStatements(body: any): any[] {
  const result: any[] = [];
  if (!body?.statements) return result;

  for (const stmt of body.statements) {
    result.push(stmt);
    if (stmt.type === 'IfStatement') {
      if (stmt.trueBody?.statements) {
        result.push(...flattenStatements(stmt.trueBody));
      }
      if (stmt.falseBody?.statements) {
        result.push(...flattenStatements(stmt.falseBody));
      }
    }
    if (stmt.type === 'Block' && stmt.statements) {
      result.push(...flattenStatements(stmt));
    }
  }

  return result;
}
