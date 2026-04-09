import type { ASTNode } from '@solidity-parser/parser/dist/src/ast-types';
import { ContractInfo, FunctionInfo } from '../core/types';
import { walkAST } from '../utils/ast-helpers';

export interface CallEdge {
  caller: string;
  callee: string;
  isExternal: boolean;
  isLowLevel: boolean;
  node: ASTNode;
}

export interface CallGraph {
  edges: CallEdge[];
  internalCalls: Map<string, Set<string>>;
  externalCalls: Map<string, Set<string>>;
}

/**
 * Builds a call graph for a contract showing which functions call which.
 */
export function buildCallGraph(contract: ContractInfo): CallGraph {
  const edges: CallEdge[] = [];
  const internalCalls = new Map<string, Set<string>>();
  const externalCalls = new Map<string, Set<string>>();

  const functionNames = new Set(contract.functions.map(f => f.name));

  for (const fn of contract.functions) {
    const callerName = fn.name || (fn.isConstructor ? 'constructor' : 'fallback');
    if (!internalCalls.has(callerName)) internalCalls.set(callerName, new Set());
    if (!externalCalls.has(callerName)) externalCalls.set(callerName, new Set());

    walkAST(fn.node, (node: any) => {
      if (node.type === 'FunctionCall') {
        const expr = node.expression;

        if (expr?.type === 'Identifier' && functionNames.has(expr.name)) {
          // Internal call
          edges.push({
            caller: callerName,
            callee: expr.name,
            isExternal: false,
            isLowLevel: false,
            node,
          });
          internalCalls.get(callerName)!.add(expr.name);
        } else if (expr?.type === 'MemberAccess') {
          const memberName = expr.memberName;
          const isLowLevel = ['call', 'delegatecall', 'staticcall', 'send', 'transfer'].includes(memberName);

          edges.push({
            caller: callerName,
            callee: memberName,
            isExternal: true,
            isLowLevel,
            node,
          });
          externalCalls.get(callerName)!.add(memberName);
        }
      }
    });
  }

  return { edges, internalCalls, externalCalls };
}

/** Find all functions that can reach a target function via internal calls */
export function findCallers(graph: CallGraph, target: string): Set<string> {
  const callers = new Set<string>();
  const visited = new Set<string>();

  function dfs(fn: string): void {
    if (visited.has(fn)) return;
    visited.add(fn);

    for (const edge of graph.edges) {
      if (edge.callee === fn && !edge.isExternal) {
        callers.add(edge.caller);
        dfs(edge.caller);
      }
    }
  }

  dfs(target);
  return callers;
}

/** Check if a function (transitively) makes external calls */
export function makesExternalCall(graph: CallGraph, fnName: string): boolean {
  const visited = new Set<string>();

  function check(name: string): boolean {
    if (visited.has(name)) return false;
    visited.add(name);

    const ext = graph.externalCalls.get(name);
    if (ext && ext.size > 0) return true;

    const internal = graph.internalCalls.get(name);
    if (internal) {
      for (const callee of internal) {
        if (check(callee)) return true;
      }
    }
    return false;
  }

  return check(fnName);
}
