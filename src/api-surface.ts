import ts from 'typescript';

export function discoverPublicApiSurface(
  program: ts.Program,
  checker: ts.TypeChecker,
  entryPoints: string[]
): Set<ts.Symbol> {
  const publicSymbols = new Set<ts.Symbol>();
  const visited = new Set<ts.Symbol>();

  function addSymbol(symbol: ts.Symbol): void {
    if (!symbol || visited.has(symbol)) return;
    visited.add(symbol);

    // Resolve aliases
    let resolved = symbol;
    if (resolved.flags & ts.SymbolFlags.Alias) {
      try {
        resolved = checker.getAliasedSymbol(resolved);
      } catch {
        // Some aliases can't be resolved
      }
    }

    if (visited.has(resolved) && resolved !== symbol) {
      publicSymbols.add(resolved);
      return;
    }
    visited.add(resolved);
    publicSymbols.add(resolved);

    walkMembers(resolved);
    walkSymbolType(resolved);
  }

  function walkMembers(symbol: ts.Symbol): void {
    // Handle class members
    if (symbol.flags & ts.SymbolFlags.Class) {
      const decls = symbol.getDeclarations() ?? [];
      for (const decl of decls) {
        if (ts.isClassDeclaration(decl)) {
          for (const member of decl.members) {
            const modifiers = ts.getCombinedModifierFlags(member);
            if (modifiers & ts.ModifierFlags.Private) continue;

            const memberSymbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
            if (memberSymbol) {
              addSymbol(memberSymbol);
            }
          }

          if (decl.heritageClauses) {
            for (const clause of decl.heritageClauses) {
              for (const exprWithType of clause.types) {
                walkHeritageExpression(exprWithType);
              }
            }
          }
        }
      }
    }

    // Handle interface members
    if (symbol.flags & ts.SymbolFlags.Interface) {
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      const properties = type.getProperties();
      for (const prop of properties) {
        addSymbol(prop);
      }

      const decls = symbol.getDeclarations() ?? [];
      for (const decl of decls) {
        if (ts.isInterfaceDeclaration(decl) && decl.heritageClauses) {
          for (const clause of decl.heritageClauses) {
            for (const exprWithType of clause.types) {
              walkHeritageExpression(exprWithType);
            }
          }
        }
      }
    }

    // Handle enum members
    if (symbol.flags & ts.SymbolFlags.Enum) {
      if (symbol.exports) {
        symbol.exports.forEach((memberSymbol) => {
          publicSymbols.add(memberSymbol);
          visited.add(memberSymbol);
        });
      }
    }
  }

  function walkHeritageExpression(node: ts.ExpressionWithTypeArguments): void {
    // ExpressionWithTypeArguments is not a TypeReferenceNode, so resolve the symbol directly
    const symbol = checker.getSymbolAtLocation(node.expression);
    if (symbol) addSymbol(symbol);
    // Walk type arguments (e.g., `extends Base<T>`)
    if (node.typeArguments) {
      for (const arg of node.typeArguments) {
        walkTypeNode(arg);
      }
    }
  }

  function walkSymbolType(symbol: ts.Symbol): void {
    const decls = symbol.getDeclarations() ?? [];
    for (const decl of decls) {
      walkDeclarationTypes(decl);
    }
  }

  function walkDeclarationTypes(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) || ts.isMethodSignature(node)) {
      const sig = node as ts.FunctionDeclaration | ts.MethodDeclaration | ts.MethodSignature;
      if (sig.type) walkTypeNode(sig.type);
      for (const param of sig.parameters) {
        if (param.type) walkTypeNode(param.type);
      }
      if (sig.typeParameters) {
        for (const tp of sig.typeParameters) {
          if (tp.constraint) walkTypeNode(tp.constraint);
          if (tp.default) walkTypeNode(tp.default);
        }
      }
    }

    // Constructor declarations (parameter types contribute to public API)
    if (ts.isConstructorDeclaration(node)) {
      for (const param of node.parameters) {
        if (param.type) walkTypeNode(param.type);
      }
    }

    // Getter/setter accessors
    if (ts.isGetAccessorDeclaration(node)) {
      if (node.type) walkTypeNode(node.type);
    }
    if (ts.isSetAccessorDeclaration(node)) {
      for (const param of node.parameters) {
        if (param.type) walkTypeNode(param.type);
      }
    }

    if (ts.isPropertyDeclaration(node) || ts.isPropertySignature(node)) {
      if (node.type) walkTypeNode(node.type);
    }

    if (ts.isVariableDeclaration(node)) {
      if (node.type) walkTypeNode(node.type);
    }

    if (ts.isTypeAliasDeclaration(node)) {
      walkTypeNode(node.type);
      if (node.typeParameters) {
        for (const tp of node.typeParameters) {
          if (tp.constraint) walkTypeNode(tp.constraint);
          if (tp.default) walkTypeNode(tp.default);
        }
      }
    }
  }

  function walkTypeNode(typeNode: ts.TypeNode): void {
    if (!typeNode) return;

    if (ts.isTypeReferenceNode(typeNode)) {
      const symbol = checker.getSymbolAtLocation(typeNode.typeName);
      if (symbol) addSymbol(symbol);
      if (typeNode.typeArguments) {
        for (const arg of typeNode.typeArguments) {
          walkTypeNode(arg);
        }
      }
    }

    if (ts.isArrayTypeNode(typeNode)) {
      walkTypeNode(typeNode.elementType);
    }

    if (ts.isTupleTypeNode(typeNode)) {
      for (const el of typeNode.elements) {
        walkTypeNode(el);
      }
    }

    if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
      for (const t of typeNode.types) {
        walkTypeNode(t);
      }
    }

    if (ts.isTypeLiteralNode(typeNode)) {
      for (const member of typeNode.members) {
        if (ts.isPropertySignature(member) && member.type) {
          walkTypeNode(member.type);
        }
        if (ts.isMethodSignature(member)) {
          if (member.type) walkTypeNode(member.type);
          for (const param of member.parameters) {
            if (param.type) walkTypeNode(param.type);
          }
        }
      }
    }

    if (ts.isMappedTypeNode(typeNode)) {
      if (typeNode.type) walkTypeNode(typeNode.type);
      if (typeNode.typeParameter.constraint) walkTypeNode(typeNode.typeParameter.constraint);
    }

    if (ts.isConditionalTypeNode(typeNode)) {
      walkTypeNode(typeNode.checkType);
      walkTypeNode(typeNode.extendsType);
      walkTypeNode(typeNode.trueType);
      walkTypeNode(typeNode.falseType);
    }

    if (ts.isIndexedAccessTypeNode(typeNode)) {
      walkTypeNode(typeNode.objectType);
      walkTypeNode(typeNode.indexType);
    }

    if (ts.isParenthesizedTypeNode(typeNode)) {
      walkTypeNode(typeNode.type);
    }

    if (ts.isFunctionTypeNode(typeNode)) {
      if (typeNode.type) walkTypeNode(typeNode.type);
      for (const param of typeNode.parameters) {
        if (param.type) walkTypeNode(param.type);
      }
    }
  }

  // Start: walk exports of each entry point
  for (const entryPath of entryPoints) {
    const sourceFile = program.getSourceFile(entryPath);
    if (!sourceFile) {
      throw new Error(`Entry point not found in program: ${entryPath}`);
    }

    const fileSymbol = checker.getSymbolAtLocation(sourceFile);
    if (!fileSymbol) continue;

    const exports = checker.getExportsOfModule(fileSymbol);
    for (const exportedSymbol of exports) {
      addSymbol(exportedSymbol);
    }
  }

  return publicSymbols;
}
