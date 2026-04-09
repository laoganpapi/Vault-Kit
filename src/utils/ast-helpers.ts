import type { ASTNode } from '@solidity-parser/parser/dist/src/ast-types';

/** Resolve a FunctionCall expression's inner MemberAccess (handles NameValueExpression) */
function resolveMemberAccess(node: any): any | null {
  if (node.type !== 'FunctionCall') return null;
  const expr = node.expression;
  if (expr?.type === 'MemberAccess') return expr;
  if (expr?.type === 'NameValueExpression' && expr.expression?.type === 'MemberAccess') {
    return expr.expression;
  }
  return null;
}

/** Check if a node is a low-level call (.call, .delegatecall, .staticcall) */
export function isLowLevelCall(node: any): boolean {
  const ma = resolveMemberAccess(node);
  return ma ? ['call', 'delegatecall', 'staticcall'].includes(ma.memberName) : false;
}

/** Check if a node is .send() */
export function isSendCall(node: any): boolean {
  const ma = resolveMemberAccess(node);
  return ma?.memberName === 'send';
}

/** Check if a node is .transfer() */
export function isTransferCall(node: any): boolean {
  const ma = resolveMemberAccess(node);
  return ma?.memberName === 'transfer';
}

/** Check if a node is a call to a known dangerous function */
export function isDangerousCall(node: any): boolean {
  return isLowLevelCall(node) || isSendCall(node) || isTransferCall(node);
}

/** Check if a node is selfdestruct/suicide */
export function isSelfdestructCall(node: any): boolean {
  if (node.type !== 'FunctionCall') return false;
  const expr = node.expression;
  if (expr?.type === 'Identifier') {
    return expr.name === 'selfdestruct' || expr.name === 'suicide';
  }
  return false;
}

/** Check if a node is delegatecall */
export function isDelegatecall(node: any): boolean {
  const ma = resolveMemberAccess(node);
  return ma?.memberName === 'delegatecall';
}

/** Check if a node references block.timestamp or now */
export function isTimestampAccess(node: any): boolean {
  if (node.type === 'MemberAccess') {
    return (
      node.expression?.type === 'Identifier' &&
      node.expression.name === 'block' &&
      node.memberName === 'timestamp'
    );
  }
  if (node.type === 'Identifier' && node.name === 'now') {
    return true;
  }
  return false;
}

/** Check if a node references tx.origin */
export function isTxOrigin(node: any): boolean {
  return (
    node.type === 'MemberAccess' &&
    node.expression?.type === 'Identifier' &&
    node.expression.name === 'tx' &&
    node.memberName === 'origin'
  );
}

/** Check if a node references msg.sender */
export function isMsgSender(node: any): boolean {
  return (
    node.type === 'MemberAccess' &&
    node.expression?.type === 'Identifier' &&
    node.expression.name === 'msg' &&
    node.memberName === 'sender'
  );
}

/** Check if a node references msg.value */
export function isMsgValue(node: any): boolean {
  return (
    node.type === 'MemberAccess' &&
    node.expression?.type === 'Identifier' &&
    node.expression.name === 'msg' &&
    node.memberName === 'value'
  );
}

/** Check if a call's return value is checked (wrapped in require, if, assert, or assigned) */
export function isReturnValueChecked(callNode: any, parent: any): boolean {
  if (!parent) return false;

  // Wrapped in require/assert
  if (parent.type === 'FunctionCall') {
    const fn = parent.expression;
    if (fn?.type === 'Identifier' && (fn.name === 'require' || fn.name === 'assert')) {
      return true;
    }
  }

  // Assigned to a variable
  if (parent.type === 'VariableDeclarationStatement') return true;
  if (parent.type === 'StateVariableDeclaration') return true;
  if (
    parent.type === 'BinaryOperation' &&
    parent.operator === '='
  ) {
    return true;
  }

  // Used in if condition
  if (parent.type === 'IfStatement') return true;

  // Tuple destructuring (bool success, ) = ...
  if (parent.type === 'ExpressionStatement') {
    const expr = parent.expression;
    if (expr?.type === 'BinaryOperation' && expr.operator === '=') {
      return true;
    }
  }

  return false;
}

/** Get the line number from an AST node */
export function getNodeLine(node: any): number {
  return node?.loc?.start?.line || 0;
}

/** Get all identifiers referenced in a subtree */
export function collectIdentifiers(node: any): string[] {
  const ids: string[] = [];
  walkAST(node, (n: any) => {
    if (n.type === 'Identifier') {
      ids.push(n.name);
    }
  });
  return ids;
}

/** Walk an AST subtree depth-first */
export function walkAST(node: any, callback: (node: any, parent?: any) => void, parent?: any): void {
  if (!node || typeof node !== 'object') return;
  if (node.type) callback(node, parent);

  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (item && typeof item === 'object') {
          walkAST(item, callback, node);
        }
      }
    } else if (child && typeof child === 'object' && child.type) {
      walkAST(child, callback, node);
    }
  }
}

/** Check if an expression involves arithmetic */
export function isArithmeticOp(node: any): boolean {
  if (node.type !== 'BinaryOperation') return false;
  return ['+', '-', '*', '/', '**', '%'].includes(node.operator);
}

/** Check if a node is inside an unchecked block */
export function isInsideUncheckedBlock(node: any, fnBody: any): boolean {
  let found = false;
  walkAST(fnBody, (n: any) => {
    if (n.type === 'UncheckedStatement') {
      walkAST(n, (inner: any) => {
        if (inner === node) found = true;
      });
    }
  });
  return found;
}

/** Extract the name from a type node */
export function resolveTypeName(typeName: any): string {
  if (!typeName) return 'unknown';
  if (typeof typeName === 'string') return typeName;
  if (typeName.type === 'ElementaryTypeName') return typeName.name || 'unknown';
  if (typeName.type === 'UserDefinedTypeName') return typeName.namePath || 'unknown';
  if (typeName.type === 'Mapping') return 'mapping';
  if (typeName.type === 'ArrayTypeName') return `${resolveTypeName(typeName.baseTypeName)}[]`;
  return 'unknown';
}
