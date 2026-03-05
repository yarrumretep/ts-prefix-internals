import ts from 'typescript';
import type { RenameDecision, Diagnostic } from './config.js';

export interface ClassificationResult {
  willPrefix: RenameDecision[];
  willNotPrefix: RenameDecision[];
  diagnostics: Diagnostic[];
  symbolsToRename: Map<ts.Symbol, string>; // symbol -> new name
}

export function classifySymbols(
  program: ts.Program,
  checker: ts.TypeChecker,
  publicApiSymbols: Set<ts.Symbol>,
  entryPoints: string[],
  prefix: string
): ClassificationResult {
  const willPrefix: RenameDecision[] = [];
  const willNotPrefix: RenameDecision[] = [];
  const diagnostics: Diagnostic[] = [];
  const symbolsToRename = new Map<ts.Symbol, string>();
  const processed = new Set<ts.Symbol>();

  const entrySet = new Set(entryPoints.map(e => ts.sys.resolvePath(e)));

  function isProjectSourceFile(sf: ts.SourceFile): boolean {
    if (sf.isDeclarationFile) return false;
    if (sf.fileName.includes('node_modules')) return false;
    return true;
  }

  function isPublicSymbol(symbol: ts.Symbol): boolean {
    return publicApiSymbols.has(symbol);
  }

  function resolveSymbol(symbol: ts.Symbol): ts.Symbol {
    if (symbol.flags & ts.SymbolFlags.Alias) {
      try {
        return checker.getAliasedSymbol(symbol);
      } catch {
        return symbol;
      }
    }
    return symbol;
  }

  function getSourceLocation(symbol: ts.Symbol): { fileName: string; line: number } | undefined {
    const decls = symbol.getDeclarations();
    if (!decls || decls.length === 0) return undefined;
    const decl = decls[0];
    const sf = decl.getSourceFile();
    const { line } = sf.getLineAndCharacterOfPosition(decl.getStart());
    return { fileName: sf.fileName, line: line + 1 };
  }

  function hasDecorators(node: ts.Node): boolean {
    const decorators = ts.canHaveDecorators(node) ? ts.getDecorators(node) : undefined;
    return decorators !== undefined && decorators.length > 0;
  }

  function shouldSkipSymbol(symbol: ts.Symbol, name: string): boolean {
    if (name === 'constructor') return true;
    if (name.startsWith(prefix)) return true;
    return false;
  }

  function isFromExternalOrDts(symbol: ts.Symbol): boolean {
    const decls = symbol.getDeclarations();
    if (!decls || decls.length === 0) return true;
    for (const decl of decls) {
      const sf = decl.getSourceFile();
      if (sf.isDeclarationFile) return true;
      if (sf.fileName.includes('node_modules')) return true;
    }
    return false;
  }

  function getSymbolKind(symbol: ts.Symbol): string {
    if (symbol.flags & ts.SymbolFlags.Class) return 'class';
    if (symbol.flags & ts.SymbolFlags.Interface) return 'interface';
    if (symbol.flags & ts.SymbolFlags.TypeAlias) return 'type-alias';
    if (symbol.flags & ts.SymbolFlags.Enum) return 'enum';
    if (symbol.flags & ts.SymbolFlags.EnumMember) return 'enum-member';
    if (symbol.flags & ts.SymbolFlags.Function) return 'function';
    if (symbol.flags & ts.SymbolFlags.Variable) return 'variable';
    if (symbol.flags & ts.SymbolFlags.Method) return 'method';
    if (symbol.flags & ts.SymbolFlags.Property) return 'property';
    if (symbol.flags & ts.SymbolFlags.Accessor) return 'accessor';
    if (symbol.flags & ts.SymbolFlags.GetAccessor) return 'getter';
    if (symbol.flags & ts.SymbolFlags.SetAccessor) return 'setter';
    return 'unknown';
  }

  function classifyOne(
    symbol: ts.Symbol,
    qualifiedName: string,
    shouldPrefix: boolean,
    reason: string
  ): void {
    if (processed.has(symbol)) return;
    processed.add(symbol);

    const loc = getSourceLocation(symbol);
    if (!loc) return;

    const name = symbol.getName();

    // Check if any declaration has decorators
    const decls = symbol.getDeclarations() ?? [];
    for (const decl of decls) {
      if (hasDecorators(decl)) return;
    }

    if (shouldSkipSymbol(symbol, name)) return;

    const decision: RenameDecision = {
      symbolName: name,
      qualifiedName,
      kind: getSymbolKind(symbol),
      fileName: loc.fileName,
      line: loc.line,
      newName: shouldPrefix ? `${prefix}${name}` : name,
      reason,
    };

    if (shouldPrefix) {
      willPrefix.push(decision);
      symbolsToRename.set(symbol, `${prefix}${name}`);
    } else {
      willNotPrefix.push(decision);
    }
  }

  function processClassMembers(
    classDecl: ts.ClassDeclaration,
    classSymbol: ts.Symbol,
    classIsPublic: boolean,
    className: string
  ): void {
    for (const member of classDecl.members) {
      // Skip constructors (but handle parameter properties below)
      if (ts.isConstructorDeclaration(member)) {
        // Process constructor parameter properties
        for (const param of member.parameters) {
          const modifiers = ts.getCombinedModifierFlags(param);
          const isParamProp = modifiers & (
            ts.ModifierFlags.Public |
            ts.ModifierFlags.Private |
            ts.ModifierFlags.Protected |
            ts.ModifierFlags.Readonly
          );
          if (!isParamProp) continue;

          const paramSymbol = param.name ? checker.getSymbolAtLocation(param.name) : undefined;
          if (!paramSymbol) continue;
          if (isFromExternalOrDts(paramSymbol)) continue;

          const paramName = paramSymbol.getName();
          const qualifiedName = `${className}.${paramName}`;

          if (classIsPublic) {
            const isPrivate = modifiers & ts.ModifierFlags.Private;
            if (isPrivate) {
              classifyOne(paramSymbol, qualifiedName, true, 'private member of public class');
            } else {
              const memberIsPublic = isPublicSymbol(paramSymbol);
              classifyOne(paramSymbol, qualifiedName, !memberIsPublic, memberIsPublic ? 'public API member' : 'non-public member of public class');
            }
          } else {
            const memberIsPublic = isPublicSymbol(paramSymbol);
            classifyOne(paramSymbol, qualifiedName, !memberIsPublic, memberIsPublic ? 'public API member (via type leak)' : 'member of internal class');
          }
        }
        continue;
      }

      const memberSymbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
      if (!memberSymbol) continue;
      if (isFromExternalOrDts(memberSymbol)) continue;

      const memberName = memberSymbol.getName();
      const qualifiedName = `${className}.${memberName}`;

      if (classIsPublic) {
        const modifiers = ts.getCombinedModifierFlags(member);
        const isPrivate = modifiers & ts.ModifierFlags.Private;
        if (isPrivate) {
          classifyOne(memberSymbol, qualifiedName, true, 'private member of public class');
        } else {
          const memberIsPublic = isPublicSymbol(memberSymbol);
          classifyOne(memberSymbol, qualifiedName, !memberIsPublic, memberIsPublic ? 'public API member' : 'non-public member of public class');
        }
      } else {
        // Class is internal, but individual members may still be public
        // if they leak through an exported variable's inferred type
        const memberIsPublic = isPublicSymbol(memberSymbol);
        classifyOne(memberSymbol, qualifiedName, !memberIsPublic, memberIsPublic ? 'public API member (via type leak)' : 'member of internal class');
      }
    }
  }

  function processInterfaceMembers(
    ifaceDecl: ts.InterfaceDeclaration,
    ifaceSymbol: ts.Symbol,
    ifaceIsPublic: boolean,
    ifaceName: string
  ): void {
    for (const member of ifaceDecl.members) {
      const memberSymbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
      if (!memberSymbol) continue;
      if (isFromExternalOrDts(memberSymbol)) continue;

      const memberName = memberSymbol.getName();
      const qualifiedName = `${ifaceName}.${memberName}`;

      if (ifaceIsPublic) {
        const memberIsPublic = isPublicSymbol(memberSymbol);
        classifyOne(memberSymbol, qualifiedName, !memberIsPublic, memberIsPublic ? 'public API member' : 'member of public interface');
      } else {
        classifyOne(memberSymbol, qualifiedName, true, 'member of internal interface');
      }
    }
  }

  function processEnumMembers(
    enumDecl: ts.EnumDeclaration,
    enumSymbol: ts.Symbol,
    enumIsPublic: boolean,
    enumName: string
  ): void {
    for (const member of enumDecl.members) {
      const memberSymbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
      if (!memberSymbol) continue;
      if (isFromExternalOrDts(memberSymbol)) continue;

      const memberName = memberSymbol.getName();
      const qualifiedName = `${enumName}.${memberName}`;

      if (enumIsPublic) {
        const memberIsPublic = isPublicSymbol(memberSymbol);
        classifyOne(memberSymbol, qualifiedName, !memberIsPublic, memberIsPublic ? 'public API enum member' : 'member of public enum');
      } else {
        classifyOne(memberSymbol, qualifiedName, true, 'member of internal enum');
      }
    }
  }

  function processTypeNodeMembers(
    typeNode: ts.TypeNode | undefined,
    ownerName: string,
    ownerIsPublic: boolean
  ): void {
    if (!typeNode) return;

    if (ts.isTypeLiteralNode(typeNode)) {
      for (const member of typeNode.members) {
        const memberSymbol = member.name ? checker.getSymbolAtLocation(member.name) : undefined;
        if (memberSymbol && !isFromExternalOrDts(memberSymbol)) {
          const memberName = memberSymbol.getName();
          const qualifiedName = `${ownerName}.${memberName}`;

          if (ownerIsPublic) {
            const memberIsPublic = isPublicSymbol(memberSymbol);
            classifyOne(memberSymbol, qualifiedName, !memberIsPublic, memberIsPublic ? 'public API member' : 'member of public type literal');
          } else {
            classifyOne(memberSymbol, qualifiedName, true, 'member of internal type literal');
          }
        }

        if (ts.isPropertySignature(member) && member.type) {
          processTypeNodeMembers(member.type, ownerName, ownerIsPublic);
        }
        if (ts.isMethodSignature(member)) {
          if (member.type) processTypeNodeMembers(member.type, ownerName, ownerIsPublic);
          for (const param of member.parameters) {
            if (param.type) processTypeNodeMembers(param.type, ownerName, ownerIsPublic);
          }
        }
      }
      return;
    }

    if (ts.isUnionTypeNode(typeNode) || ts.isIntersectionTypeNode(typeNode)) {
      for (const t of typeNode.types) {
        processTypeNodeMembers(t, ownerName, ownerIsPublic);
      }
      return;
    }

    if (ts.isParenthesizedTypeNode(typeNode)) {
      processTypeNodeMembers(typeNode.type, ownerName, ownerIsPublic);
      return;
    }

    if (ts.isArrayTypeNode(typeNode)) {
      processTypeNodeMembers(typeNode.elementType, ownerName, ownerIsPublic);
      return;
    }

    if (ts.isTupleTypeNode(typeNode)) {
      for (const el of typeNode.elements) {
        processTypeNodeMembers(el, ownerName, ownerIsPublic);
      }
      return;
    }
  }

  // Walk all source files in the program — classification pass
  for (const sf of program.getSourceFiles()) {
    if (!isProjectSourceFile(sf)) continue;

    ts.forEachChild(sf, function visit(node) {
      // Class declarations
      if (ts.isClassDeclaration(node) && node.name) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && !isFromExternalOrDts(symbol)) {
          const resolved = resolveSymbol(symbol);
          const name = symbol.getName();
          const isPublic = isPublicSymbol(symbol) || isPublicSymbol(resolved);

          classifyOne(symbol, name, !isPublic, isPublic ? 'public API' : 'internal class');
          processClassMembers(node, symbol, isPublic, name);
        }
        return; // don't recurse into class body (already processed members)
      }

      // Interface declarations
      if (ts.isInterfaceDeclaration(node) && node.name) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && !isFromExternalOrDts(symbol)) {
          const resolved = resolveSymbol(symbol);
          const name = symbol.getName();
          const isPublic = isPublicSymbol(symbol) || isPublicSymbol(resolved);

          classifyOne(symbol, name, !isPublic, isPublic ? 'public API' : 'internal interface');
          processInterfaceMembers(node, symbol, isPublic, name);
        }
        return;
      }

      // Enum declarations
      if (ts.isEnumDeclaration(node) && node.name) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && !isFromExternalOrDts(symbol)) {
          const resolved = resolveSymbol(symbol);
          const name = symbol.getName();
          const isPublic = isPublicSymbol(symbol) || isPublicSymbol(resolved);

          classifyOne(symbol, name, !isPublic, isPublic ? 'public API' : 'internal enum');
          processEnumMembers(node, symbol, isPublic, name);
        }
        return;
      }

      // Type alias declarations
      if (ts.isTypeAliasDeclaration(node) && node.name) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && !isFromExternalOrDts(symbol)) {
          const resolved = resolveSymbol(symbol);
          const name = symbol.getName();
          const isPublic = isPublicSymbol(symbol) || isPublicSymbol(resolved);

          classifyOne(symbol, name, !isPublic, isPublic ? 'public API' : 'internal type alias');
          processTypeNodeMembers(node.type, name, isPublic);
        }
        return;
      }

      // Function declarations
      if (ts.isFunctionDeclaration(node) && node.name) {
        const symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && !isFromExternalOrDts(symbol)) {
          const resolved = resolveSymbol(symbol);
          const name = symbol.getName();
          const isPublic = isPublicSymbol(symbol) || isPublicSymbol(resolved);

          classifyOne(symbol, name, !isPublic, isPublic ? 'public API' : 'internal function');
        }
        return;
      }

      // Variable statements (may contain variable declarations)
      if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name)) {
            const symbol = checker.getSymbolAtLocation(decl.name);
            if (symbol && !isFromExternalOrDts(symbol)) {
              const resolved = resolveSymbol(symbol);
              const name = symbol.getName();
              const isPublic = isPublicSymbol(symbol) || isPublicSymbol(resolved);

              classifyOne(symbol, name, !isPublic, isPublic ? 'public API' : 'internal variable');
            }
          }
        }
        return;
      }

      // Don't recurse into function bodies, etc. - we only want top-level declarations
      // But do recurse into module blocks (namespaces)
      if (ts.isModuleDeclaration(node)) {
        ts.forEachChild(node, visit);
      }
    });
  }

  // Dynamic access detection — runs AFTER classification so renamedNames is populated
  const renamedNames = new Set<string>();
  for (const [sym] of symbolsToRename) {
    renamedNames.add(sym.getName());
  }

  function detectDynamicAccess(sf: ts.SourceFile, suppressed: Set<number>): void {
    function visit(node: ts.Node): void {
      if (ts.isElementAccessExpression(node)) {
        const arg = node.argumentExpression;

        // String literals (obj["foo"]) are handled by the renamer — skip
        if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
          ts.forEachChild(node, visit);
          return;
        }

        // Check if the object is an array/tuple/index-signature/generic type — suppress entirely
        const rawObjectType = checker.getTypeAtLocation(node.expression);
        // Use getNonNullableType to unwrap `T | undefined` from optional chaining
        const objectType = checker.getNonNullableType(rawObjectType);
        if (
          checker.isArrayType(objectType) ||
          checker.isTupleType(objectType) ||
          objectType.getNumberIndexType() !== undefined ||
          objectType.getStringIndexType() !== undefined ||
          isGenericType(rawObjectType)
        ) {
          ts.forEachChild(node, visit);
          return;
        }

        const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
        if (suppressed.has(line + 1)) {
          ts.forEachChild(node, visit);
          return;
        }
        const shortFile = sf.fileName.replace(/.*[/\\]/, '');

        // Check if the argument has a string literal type that matches a renamed symbol
        const argType = checker.getTypeAtLocation(arg);
        const literalNames = collectStringLiterals(argType);

        if (literalNames.length > 0) {
          const hits = literalNames.filter(n => renamedNames.has(n));
          if (hits.length > 0) {
            diagnostics.push({
              level: 'error',
              message: `Dynamic access to prefixed property '${hits.join("', '")}' at ${shortFile}:${line + 1} will break after renaming`,
              file: sf.fileName,
              line: line + 1,
            });
            ts.forEachChild(node, visit);
            return;
          }
        }

        // Fall through: warn on unresolvable dynamic access
        diagnostics.push({
          level: 'warn',
          message: `Dynamic property access at ${shortFile}:${line + 1} — may break after prefixing`,
          file: sf.fileName,
          line: line + 1,
        });
      }
      ts.forEachChild(node, visit);
    }
    ts.forEachChild(sf, visit);
  }

  /** Check if a type is a generic/abstract type whose properties are not concrete. */
  function isGenericType(type: ts.Type): boolean {
    const flags = type.getFlags();
    // Type parameters: T, K extends string, etc.
    if (flags & ts.TypeFlags.TypeParameter) return true;
    // Conditional types: NonNullable<T>, Extract<T, U>, etc.
    if (flags & ts.TypeFlags.Conditional) return true;
    // Mapped types: Partial<T>, Pick<T, K>, etc.
    const objFlags = (type as ts.ObjectType).objectFlags ?? 0;
    if (objFlags & ts.ObjectFlags.Mapped) return true;
    return false;
  }

  function collectStringLiterals(type: ts.Type): string[] {
    if (type.isStringLiteral()) {
      return [type.value];
    }
    if (type.isUnion()) {
      const results: string[] = [];
      for (const member of type.types) {
        if (member.isStringLiteral()) {
          results.push(member.value);
        }
      }
      if (results.length === type.types.length) {
        return results;
      }
    }
    return [];
  }

  // Unsafe pattern detection — runs AFTER classification alongside dynamic access detection
  function detectUnsafePatterns(sf: ts.SourceFile, suppressed: Set<number>): void {

    // Resolve the source type for an ObjectBindingPattern.
    function getDestructuringSourceType(pattern: ts.ObjectBindingPattern): ts.Type | undefined {
      const container = pattern.parent;
      if (ts.isParameter(container)) {
        if (container.type) return checker.getTypeFromTypeNode(container.type);
        const sym = container.name ? checker.getSymbolAtLocation(container.name) : undefined;
        return sym ? checker.getTypeOfSymbolAtLocation(sym, container) : undefined;
      }
      if (ts.isVariableDeclaration(container) && container.initializer) {
        return checker.getTypeAtLocation(container.initializer);
      }
      return undefined;
    }

    // Check an ObjectBindingPattern for untracked property name collisions.
    function checkDestructuring(pattern: ts.ObjectBindingPattern): void {
      const sourceType = getDestructuringSourceType(pattern);
      if (!sourceType) return;

      const container = pattern.parent;
      const isParam = ts.isParameter(container);
      const hitProps: string[] = [];
      let hasDefault = false;

      for (const element of pattern.elements) {
        if (ts.isOmittedExpression(element)) continue;

        const propName = element.propertyName && ts.isIdentifier(element.propertyName)
          ? element.propertyName.text
          : ts.isIdentifier(element.name) ? element.name.text : undefined;

        if (!propName || !renamedNames.has(propName)) continue;

        const prop = sourceType.getProperty(propName);
        if (!prop) continue;

        // If the property symbol is directly tracked, the renamer handles it
        if (symbolsToRename.has(prop)) continue;

        // Skip non-project properties (lib, node_modules)
        const propDecls = prop.getDeclarations();
        const isProject = propDecls?.some(d => {
          const dsf = d.getSourceFile();
          return !dsf.isDeclarationFile && !dsf.fileName.includes('node_modules');
        }) ?? false;
        if (!isProject) continue;

        // Skip public API properties
        if (isPublicSymbol(prop)) continue;

        hitProps.push(propName);
        if (element.initializer) hasDefault = true;
      }

      if (hitProps.length === 0) return;

      const { line } = sf.getLineAndCharacterOfPosition(pattern.getStart());
      if (suppressed.has(line + 1)) return;
      const shortFile = sf.fileName.replace(/.*[/\\]/, '');
      const names = hitProps.join("', '");

      if (isParam && hasDefault) {
        diagnostics.push({
          level: 'warn',
          message: `Destructured parameter with default at ${shortFile}:${line + 1} — property '${names}' matches renamed symbol(s) but binding name won't be renamed; use explicit property access (e.g. fields.${hitProps[0]} ?? default)`,
          file: sf.fileName,
          line: line + 1,
        });
      } else {
        diagnostics.push({
          level: 'warn',
          message: `Destructured binding at ${shortFile}:${line + 1} — property '${names}' matches renamed symbol(s) but binding name won't be renamed; use dot access instead`,
          file: sf.fileName,
          line: line + 1,
        });
      }
    }

    // Check computed property keys for renamed name collisions.
    function checkComputedPropertyKey(node: ts.ComputedPropertyName): void {
      const exprType = checker.getTypeAtLocation(node.expression);
      const literals = collectStringLiterals(exprType);
      const hits = literals.filter(n => renamedNames.has(n));

      if (hits.length === 0) return;

      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      if (suppressed.has(line + 1)) return;
      const shortFile = sf.fileName.replace(/.*[/\\]/, '');

      diagnostics.push({
        level: 'warn',
        message: `Computed property key at ${shortFile}:${line + 1} — includes renamed name(s) '${hits.join("', '")}'; string values won't be renamed at runtime. Use direct property names in object literals`,
        file: sf.fileName,
        line: line + 1,
      });
    }

    function visit(node: ts.Node): void {
      if (ts.isObjectBindingPattern(node)) {
        checkDestructuring(node);
      }
      if (ts.isComputedPropertyName(node)) {
        checkComputedPropertyKey(node);
      }
      ts.forEachChild(node, visit);
    }
    ts.forEachChild(sf, visit);
  }

  function getSuppressedLines(sf: ts.SourceFile): Set<number> {
    const suppressed = new Set<number>();
    const text = sf.getFullText();

    // Single-line: // ts-prefix-suppress-warnings → suppresses next line
    const singleRe = /\/\/\s*ts-prefix-suppress-warnings\s*$/gm;
    let match: RegExpExecArray | null;
    while ((match = singleRe.exec(text)) !== null) {
      // Only match bare "ts-prefix-suppress-warnings" (not -start or -end)
      if (/ts-prefix-suppress-warnings-(start|end)/.test(match[0])) continue;
      const { line } = sf.getLineAndCharacterOfPosition(match.index);
      suppressed.add(line + 2); // suppress the *next* line (1-indexed)
    }

    // Block: // ts-prefix-suppress-warnings-start ... // ts-prefix-suppress-warnings-end
    const startRe = /\/\/\s*ts-prefix-suppress-warnings-start\b/g;
    const endRe = /\/\/\s*ts-prefix-suppress-warnings-end\b/g;
    while ((match = startRe.exec(text)) !== null) {
      const startLine = sf.getLineAndCharacterOfPosition(match.index).line;
      endRe.lastIndex = match.index;
      const endMatch = endRe.exec(text);
      const endLine = endMatch
        ? sf.getLineAndCharacterOfPosition(endMatch.index).line
        : sf.getLineAndCharacterOfPosition(text.length).line;
      for (let l = startLine + 1; l <= endLine + 1; l++) {
        suppressed.add(l + 1); // 1-indexed
      }
    }

    return suppressed;
  }

  for (const sf of program.getSourceFiles()) {
    if (!isProjectSourceFile(sf)) continue;
    const suppressed = getSuppressedLines(sf);
    detectDynamicAccess(sf, suppressed);
    detectUnsafePatterns(sf, suppressed);
  }

  return { willPrefix, willNotPrefix, diagnostics, symbolsToRename };
}
