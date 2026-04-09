import * as parser from '@solidity-parser/parser';
import type { ASTNode, SourceUnit } from '@solidity-parser/parser/dist/src/ast-types';
import {
  ParsedFile,
  ContractInfo,
  StateVariable,
  FunctionInfo,
  ModifierInfo,
  EventInfo,
  ParameterInfo,
  PragmaInfo,
  ImportInfo,
} from './types';

export class SolidityParser {
  parse(source: string, filePath: string): ParsedFile {
    let ast: SourceUnit;
    try {
      ast = parser.parse(source, {
        tolerant: true,
        loc: true,
        range: true,
      });
    } catch (err: any) {
      throw new Error(`Failed to parse ${filePath}: ${err.message}`);
    }

    const contracts = this.extractContracts(ast);
    const pragmas = this.extractPragmas(ast);
    const imports = this.extractImports(ast);

    return { path: filePath, source, ast, contracts, pragmas, imports };
  }

  private extractContracts(ast: SourceUnit): ContractInfo[] {
    const contracts: ContractInfo[] = [];

    for (const node of ast.children) {
      if (node.type === 'ContractDefinition') {
        contracts.push(this.buildContractInfo(node as any));
      }
    }

    return contracts;
  }

  private extractPragmas(ast: SourceUnit): PragmaInfo[] {
    const pragmas: PragmaInfo[] = [];
    for (const node of ast.children) {
      if (node.type === 'PragmaDirective') {
        const n = node as any;
        pragmas.push({
          name: n.name || '',
          value: n.value || '',
          node,
        });
      }
    }
    return pragmas;
  }

  private extractImports(ast: SourceUnit): ImportInfo[] {
    const imports: ImportInfo[] = [];
    for (const node of ast.children) {
      if (node.type === 'ImportDirective') {
        const n = node as any;
        imports.push({
          path: n.path || '',
          symbols: (n.symbolAliases || []).map((s: any) => s[0] || ''),
          node,
        });
      }
    }
    return imports;
  }

  private buildContractInfo(node: any): ContractInfo {
    const kind = node.kind === 'library'
      ? 'library'
      : node.kind === 'interface'
        ? 'interface'
        : node.kind === 'abstract'
          ? 'abstract'
          : 'contract';

    const baseContracts = (node.baseContracts || []).map(
      (bc: any) => bc.baseName?.namePath || bc.baseName?.name || 'unknown'
    );

    const stateVariables: StateVariable[] = [];
    const functions: FunctionInfo[] = [];
    const modifiers: ModifierInfo[] = [];
    const events: EventInfo[] = [];

    for (const sub of node.subNodes || []) {
      switch (sub.type) {
        case 'StateVariableDeclaration':
          for (const variable of sub.variables || []) {
            stateVariables.push(this.buildStateVariable(variable));
          }
          break;
        case 'FunctionDefinition':
          functions.push(this.buildFunctionInfo(sub));
          break;
        case 'ModifierDefinition':
          modifiers.push(this.buildModifierInfo(sub));
          break;
        case 'EventDefinition':
          events.push(this.buildEventInfo(sub));
          break;
      }
    }

    return {
      name: node.name,
      kind,
      baseContracts,
      stateVariables,
      functions,
      modifiers,
      events,
      node,
    };
  }

  private buildStateVariable(node: any): StateVariable {
    return {
      name: node.name || '',
      typeName: this.typeToString(node.typeName),
      visibility: node.visibility || 'internal',
      mutability: node.isDeclaredConst ? 'constant' : node.isImmutable ? 'immutable' : undefined,
      isConstant: !!node.isDeclaredConst,
      isImmutable: !!node.isImmutable,
      node,
    };
  }

  private buildFunctionInfo(node: any): FunctionInfo {
    return {
      name: node.name || '',
      visibility: node.visibility || 'public',
      stateMutability: node.stateMutability || 'nonpayable',
      modifiers: (node.modifiers || []).map((m: any) => m.name || ''),
      parameters: this.extractParameters(node.parameters),
      returnParameters: this.extractParameters(node.returnParameters),
      isConstructor: node.isConstructor || false,
      isFallback: node.isFallback || false,
      isReceive: node.isReceive || false,
      hasBody: !!node.body,
      node,
    };
  }

  private buildModifierInfo(node: any): ModifierInfo {
    return {
      name: node.name || '',
      parameters: this.extractParameters(node.parameters),
      node,
    };
  }

  private buildEventInfo(node: any): EventInfo {
    return {
      name: node.name || '',
      parameters: this.extractParameters(node.parameters),
      node,
    };
  }

  private extractParameters(params: any[] | null): ParameterInfo[] {
    if (!params) return [];
    return params.map((p: any) => ({
      name: p.name || '',
      typeName: this.typeToString(p.typeName),
      isIndexed: p.isIndexed || false,
    }));
  }

  typeToString(typeName: any): string {
    if (!typeName) return 'unknown';
    if (typeof typeName === 'string') return typeName;

    switch (typeName.type) {
      case 'ElementaryTypeName':
        return typeName.name || 'unknown';
      case 'UserDefinedTypeName':
        return typeName.namePath || 'unknown';
      case 'Mapping':
        return `mapping(${this.typeToString(typeName.keyType)} => ${this.typeToString(typeName.valueType)})`;
      case 'ArrayTypeName':
        return `${this.typeToString(typeName.baseTypeName)}[]`;
      case 'FunctionTypeName':
        return 'function';
      default:
        return 'unknown';
    }
  }
}
