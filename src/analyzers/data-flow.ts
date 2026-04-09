import type { ASTNode } from '@solidity-parser/parser/dist/src/ast-types';
import { walkAST } from '../utils/ast-helpers';

export interface DataFlowInfo {
  /** Variables read in the function */
  reads: Map<string, ASTNode[]>;
  /** Variables written in the function */
  writes: Map<string, ASTNode[]>;
  /** Variables that are read before being written (potential uninitialized use) */
  readBeforeWrite: Set<string>;
  /** Variables written but never read (dead stores) */
  writtenNotRead: Set<string>;
  /** Storage variables read inside loops */
  storageReadsInLoops: Array<{ variable: string; node: ASTNode }>;
}

/**
 * Performs basic data flow analysis on a function body.
 */
export function analyzeDataFlow(
  fnBody: any,
  stateVarNames: Set<string>,
  localVarNames: Set<string>
): DataFlowInfo {
  const reads = new Map<string, ASTNode[]>();
  const writes = new Map<string, ASTNode[]>();
  const readBeforeWrite = new Set<string>();
  const writtenNotRead = new Set<string>();
  const storageReadsInLoops: Array<{ variable: string; node: ASTNode }> = [];

  const written = new Set<string>();
  const read = new Set<string>();

  if (!fnBody) {
    return { reads, writes, readBeforeWrite, writtenNotRead, storageReadsInLoops };
  }

  // Track reads and writes
  walkAST(fnBody, (node: any) => {
    if (node.type === 'Identifier') {
      const name = node.name;
      if (stateVarNames.has(name) || localVarNames.has(name)) {
        if (!reads.has(name)) reads.set(name, []);
        reads.get(name)!.push(node);
        read.add(name);

        if (!written.has(name) && !stateVarNames.has(name)) {
          readBeforeWrite.add(name);
        }
      }
    }

    if (node.type === 'BinaryOperation' && node.operator === '=') {
      const left = node.left;
      if (left?.type === 'Identifier') {
        const name = left.name;
        if (!writes.has(name)) writes.set(name, []);
        writes.get(name)!.push(node);
        written.add(name);
      }
    }
  });

  // Detect dead stores
  for (const name of written) {
    if (!read.has(name) && localVarNames.has(name)) {
      writtenNotRead.add(name);
    }
  }

  // Detect storage reads in loops
  walkAST(fnBody, (node: any) => {
    if (node.type === 'ForStatement' || node.type === 'WhileStatement' || node.type === 'DoWhileStatement') {
      walkAST(node.body || node, (inner: any) => {
        if (inner.type === 'Identifier' && stateVarNames.has(inner.name)) {
          storageReadsInLoops.push({ variable: inner.name, node: inner });
        }
        if (inner.type === 'IndexAccess' && inner.base?.type === 'Identifier' && stateVarNames.has(inner.base.name)) {
          storageReadsInLoops.push({ variable: inner.base.name, node: inner });
        }
      });
    }
  });

  return { reads, writes, readBeforeWrite, writtenNotRead, storageReadsInLoops };
}

/**
 * Checks if a variable flows from user input (msg.sender, msg.value, calldata)
 * into a sensitive operation (delegatecall target, selfdestruct param).
 */
export function traceTaintedInputs(fnBody: any): Map<string, string[]> {
  const tainted = new Map<string, string[]>(); // variable -> sources

  walkAST(fnBody, (node: any) => {
    // Track assignments from tainted sources
    if (node.type === 'VariableDeclarationStatement') {
      const init = node.initialValue;
      if (!init) return;

      const varName = node.variables?.[0]?.name;
      if (!varName) return;

      const sources: string[] = [];
      walkAST(init, (n: any) => {
        if (n.type === 'MemberAccess') {
          if (n.expression?.name === 'msg') sources.push(`msg.${n.memberName}`);
          if (n.expression?.name === 'tx') sources.push(`tx.${n.memberName}`);
        }
      });

      if (sources.length > 0) {
        tainted.set(varName, sources);
      }
    }
  });

  return tainted;
}
