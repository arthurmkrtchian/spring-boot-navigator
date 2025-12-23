import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('--- Spring Bean Navigator (Field Filter Fix) ACTIVE ---');

    const beanPath = vscode.Uri.file(context.asAbsolutePath('images/bean.svg'));
    const injectPath = vscode.Uri.file(context.asAbsolutePath('images/inject.svg'));

    const beanDecoration = vscode.window.createTextEditorDecorationType({
        gutterIconPath: beanPath,
        gutterIconSize: 'contain'
    });

    const injectDecoration = vscode.window.createTextEditorDecorationType({
        gutterIconPath: injectPath,
        gutterIconSize: 'contain'
    });

    const findBeanUsagesCmd = vscode.commands.registerCommand('springNav.findBeanUsages', async (uriStr: string, line: number, typeName: string, beanQualifier?: string, isPrimary?: boolean) => {
        const uri = vscode.Uri.parse(uriStr);
        const doc = await vscode.workspace.openTextDocument(uri);
        const lineText = doc.lineAt(line).text;
        const typeIndex = lineText.indexOf(typeName);
        
        if (typeIndex === -1) {
            vscode.window.showErrorMessage(`Could not find type ${typeName}.`);
            return;
        }
        
        const pos = new vscode.Position(line, typeIndex);

        let refs: vscode.Location[] | undefined;
        try {
            refs = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, pos);
        } catch (e) { return; }

        if (!refs || refs.length === 0) {
            vscode.window.showInformationMessage(`No usages found for ${typeName}.`);
            return;
        }

        const filteredRefs: vscode.Location[] = [];

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Scanning injection points for ${typeName}...`,
            cancellable: true
        }, async (progress, token) => {
            
            for (const ref of refs!) {
                if (token.isCancellationRequested) break;

                if (ref.uri.fsPath === uri.fsPath && Math.abs(ref.range.start.line - line) < 2) continue;

                const refDoc = await vscode.workspace.openTextDocument(ref.uri);
                const refLineIdx = ref.range.start.line;
                const refLineText = refDoc.lineAt(refLineIdx).text.trim();
                
                const startContextLine = Math.max(0, refLineIdx - 2);
                const contextRange = new vscode.Range(startContextLine, 0, refLineIdx + 1, 999);
                const contextText = refDoc.getText(contextRange);

                const isFieldDeclaration = /^(private|protected|public).*;$/.test(refLineText);

                if (isFieldDeclaration) {
                    const hasInjectionAnnotation = /@Autowired|@Inject|@Resource|@Value/.test(contextText);
                    const hasQualifierOnField = contextText.includes("@Qualifier");

                    if (!hasInjectionAnnotation && !hasQualifierOnField) {
                        const headerText = refDoc.getText(new vscode.Range(0, 0, 30, 0));
                        const hasLombok = /@RequiredArgsConstructor|@AllArgsConstructor/.test(headerText);

                        if (!hasLombok) {
                            continue;
                        }
                    }
                }

                const injectionHasQualifier = contextText.includes("@Qualifier");
                
                let injectionQualifierValue: string | undefined;
                if (injectionHasQualifier) {
                    const match = contextText.match(/@Qualifier\s*\(\s*"([^"]+)"\s*\)/);
                    if (match) injectionQualifierValue = match[1];
                }

                if (beanQualifier) {
                    if (injectionQualifierValue === beanQualifier) {
                        filteredRefs.push(ref);
                    }
                } else {
                    if (!injectionHasQualifier) {
                        filteredRefs.push(ref);
                    }
                }
            }
        });

        if (filteredRefs.length > 0) {
            await vscode.commands.executeCommand('editor.action.showReferences', uri, pos, filteredRefs);
        } else {
            vscode.window.showInformationMessage(`No active injection points found for ${isPrimary ? '@Primary ' : ''}bean ${typeName}${beanQualifier ? ' with @Qualifier("' + beanQualifier + '")' : ''}.`);
        }
    });

    const showUsagesCmd = vscode.commands.registerCommand('springNav.showUsages', async (uriStr: string, line: number, char: number) => {
        const uri = vscode.Uri.parse(uriStr);
        const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
        const pos = new vscode.Position(line, char);
        editor.selection = new vscode.Selection(pos, pos);
        await vscode.commands.executeCommand('editor.action.referenceSearch.trigger');
    });

    const revealLocationCmd = vscode.commands.registerCommand('springNav.revealLocation', async (uriStr: string, line: number, char: number) => {
        const uri = vscode.Uri.parse(uriStr);
        const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
        const pos = new vscode.Position(line, char);
        editor.selection = new vscode.Selection(pos, pos);
        editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    });

    const goToClassCmd = vscode.commands.registerCommand('springNav.goToClass', async (uriStr: string, line: number, exactType: string) => {
        const uri = vscode.Uri.parse(uriStr);
        await navigateToImplementation(uri, line, exactType);
    });

    const goToBeanCmd = vscode.commands.registerCommand('springNav.goToBean', async (uriStr: string, line: number, exactType: string, qualifier?: string) => {
        const uri = vscode.Uri.parse(uriStr);
        const beanLocation = await findBeanDefinition(uri, line, exactType, qualifier);
        if (beanLocation) {
            const editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(beanLocation.uri));
            const pos = beanLocation.range.start;
            editor.selection = new vscode.Selection(pos, pos);
            editor.revealRange(beanLocation.range, vscode.TextEditorRevealType.InCenter);
        } else {
            const foundClass = await navigateToImplementation(uri, line, exactType, true);
            if (!foundClass) vscode.window.showWarningMessage(`Could not find @Bean or Stereotype for ${exactType}`);
        }
    });

    context.subscriptions.push(findBeanUsagesCmd, showUsagesCmd, revealLocationCmd, goToClassCmd, goToBeanCmd);

    let activeEditor = vscode.window.activeTextEditor;
    const externalBeanCache = new Map<string, vscode.Location | null>();

    async function updateDecorations() {
        if (!activeEditor) return;
        const text = activeEditor.document.getText();
        const lines = text.split('\n');
        const uri = activeEditor.document.uri;
        
        const beans: vscode.DecorationOptions[] = [];
        const injects: vscode.DecorationOptions[] = [];
        const fieldMap = new Map<string, { line: number, type: string, range: vscode.Range, qualifier?: string }>();

        const addInject = (range: vscode.Range, type: string, varName: string, method: string, targetLine?: number, qualifier?: string) => {
            const lineToUse = targetLine !== undefined ? targetLine : range.start.line;
            const argsClass = [uri.toString(), lineToUse, type];
            const argsBean = [uri.toString(), lineToUse, type, qualifier];
            const cmdClassUri = vscode.Uri.parse(`command:springNav.goToClass?${encodeURIComponent(JSON.stringify(argsClass))}`);
            const cmdBeanUri = vscode.Uri.parse(`command:springNav.goToBean?${encodeURIComponent(JSON.stringify(argsBean))}`);
            
            const md = new vscode.MarkdownString();
            md.supportHtml = true; md.supportThemeIcons = true; md.isTrusted = true;
            md.appendMarkdown(`### 🍃 Spring Injection\n---\n`);
            md.appendMarkdown(`| Type | Name |\n| :--- | :--- |\n| \`${type}\` | \`${varName}\` |\n`);
            if (qualifier) md.appendMarkdown(`| **Qualifier** | \`"${qualifier}"\` 🔴 |\n`);
            md.appendMarkdown(`| **Via** | _${method}_ |\n\n---\n`);
            md.appendMarkdown(`[$(symbol-class) Open Class](${cmdClassUri}) &nbsp;|&nbsp; [$(symbol-property) Open Bean Config](${cmdBeanUri})`);
            injects.push({ range, hoverMessage: md });
        };

        const addBean = (range: vscode.Range, beanName: string, typeName: string, description: string, qualifier?: string, isPrimary?: boolean) => {
            const args = [uri.toString(), range.start.line, typeName, qualifier, isPrimary];
            const commandUri = vscode.Uri.parse(`command:springNav.findBeanUsages?${encodeURIComponent(JSON.stringify(args))}`);
            
            const md = new vscode.MarkdownString();
            md.supportThemeIcons = true; md.isTrusted = true; md.supportHtml = true;
            md.appendMarkdown(`### 🍃 Spring Bean Definition\n---\n`);
            md.appendMarkdown(`**Bean Name**: \`${beanName}\`\n\n`);
            if (qualifier) md.appendMarkdown(`**Qualifier**: \`"${qualifier}"\`\n\n`);
            if (isPrimary) md.appendMarkdown(`**Primary**: ✅ Yes\n\n`);
            md.appendMarkdown(`_${description}_\n\n---\n`);
            md.appendMarkdown(`[$(references) Find Usages](${commandUri})`);
            beans.push({ range, hoverMessage: md });
        };

        let currentClassName = "";
        let classNameRange: vscode.Range | undefined;
        let classLineIndex = -1;
        let isInsideAutowiredConstructor = false;
        
        let pendingBeanAnnotation = false;
        let pendingClassAnnotation = false;
        let pendingPrimary = false;
        let lastSeenQualifier: string | undefined = undefined;

        const classDeclRegex = /(?:class|interface)\s+(\w+)/;
        const beanAnnotRegex = /(@Component|@Service|@Repository|@Controller|@RestController|@Configuration)/;
        const beanMethodAnnotRegex = /@Bean/;
        const primaryAnnotRegex = /@Primary/;
        const autowiredAnnotRegex = /(@Autowired|@Inject|@Resource)/;
        const anyFieldRegex = /(?:private|protected|public)?\s+(?:final\s+)?([\w<>]+)\s+(\w+)\s*;/;
        const argRegex = /\b([A-Z][\w<>]*)\s+(\w+)\b/g; 
        const qualifierRegex = /@Qualifier\s*\(\s*"([^"]+)"\s*\)/;
        const methodDeclRegex = /^\s*(?!return|new|throw)(?:public|protected|private|static|final|synchronized|\s)*([\w<>[\]\.]+)\s+(\w+)\s*\(/;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
            const fMatch = line.match(anyFieldRegex);
            if (fMatch) {
                const type = fMatch[1];
                const name = fMatch[2];
                if (type !== 'return' && type !== 'class') {
                    const startCol = line.indexOf(type);
                    if (startCol !== -1) {
                         const range = new vscode.Range(i, startCol, i, startCol + type.length);
                         let qual: string | undefined;
                         let qMatch = line.match(qualifierRegex);
                         if (!qMatch && i > 0) qMatch = lines[i-1].match(qualifierRegex);
                         if (qMatch) qual = qMatch[1];
                         fieldMap.set(name, { line: i, type, range, qualifier: qual });
                    }
                }
            }
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]; 
            const trimmed = line.trim();
            if (trimmed.length === 0 || trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

            const qualMatch = line.match(qualifierRegex);
            if (qualMatch) lastSeenQualifier = qualMatch[1];
            if (primaryAnnotRegex.test(line)) pendingPrimary = true;

            if (beanAnnotRegex.test(line)) {
                pendingClassAnnotation = true;
            }

            const classMatch = line.match(classDeclRegex);
            if (classMatch) {
                currentClassName = classMatch[1];
                classLineIndex = i;
                const startCol = line.indexOf(currentClassName);
                if (startCol !== -1) {
                    classNameRange = new vscode.Range(i, startCol, i, startCol + currentClassName.length);
                    if (pendingClassAnnotation) {
                        addBean(classNameRange, currentClassName, currentClassName, "Defined via Stereotype Annotation", lastSeenQualifier, pendingPrimary);
                        pendingClassAnnotation = false;
                        lastSeenQualifier = undefined;
                        pendingPrimary = false;
                    }
                }
            }

            if (beanMethodAnnotRegex.test(line)) {
                pendingBeanAnnotation = true;
            }

            if (pendingBeanAnnotation) {
                if (trimmed.startsWith('@') && !line.includes('@Bean')) continue; 

                const methodMatch = line.match(methodDeclRegex);
                if (methodMatch) {
                    const returnType = methodMatch[1];
                    const methodName = methodMatch[2];
                    const startCol = line.indexOf(methodName);
                    
                    if (startCol !== -1 && methodName !== currentClassName) {
                        const range = new vscode.Range(i, startCol, i, startCol + methodName.length);
                        addBean(range, methodName, returnType, "Defined via @Bean Configuration", lastSeenQualifier, pendingPrimary);
                        
                        pendingBeanAnnotation = false;
                        lastSeenQualifier = undefined;
                        pendingPrimary = false;
                    }
                } else {
                    if (line.includes('=') || line.includes(';')) {
                         pendingBeanAnnotation = false; 
                         lastSeenQualifier = undefined;
                         pendingPrimary = false;
                    }
                }
            }

            if (currentClassName && line.includes(`public ${currentClassName}(`)) {
                let hasAutowired = line.includes('@Autowired');
                if (!hasAutowired && i > 0 && lines[i-1].includes('@Autowired')) hasAutowired = true;
                if (hasAutowired) isInsideAutowiredConstructor = true;
            }

            if (isInsideAutowiredConstructor) {
                argRegex.lastIndex = 0; 
                let argMatch;
                while ((argMatch = argRegex.exec(line)) !== null) {
                    const type = argMatch[1];
                    const name = argMatch[2];
                    if (type !== currentClassName && type !== 'String' && type !== 'int' && type !== 'boolean') {
                        let constructorArgQualifier: string | undefined;
                        const qMatch = line.match(qualifierRegex); 
                        if (qMatch) constructorArgQualifier = qMatch[1];

                        const fieldInfo = fieldMap.get(name);
                        if (fieldInfo) {
                            const effectiveQualifier = fieldInfo.qualifier || constructorArgQualifier;
                            addInject(fieldInfo.range, type, name, "Constructor Injection (Mapped to Field)", fieldInfo.line, effectiveQualifier);
                        } else {
                            const startCol = argMatch.index;
                            const range = new vscode.Range(i, startCol, i, startCol + type.length);
                            addInject(range, type, name, "Constructor Injection (Argument)", undefined, constructorArgQualifier);
                        }
                    }
                }
                if (line.includes(')')) isInsideAutowiredConstructor = false;
                continue;
            }

            if (autowiredAnnotRegex.test(line)) {
                const fieldMatch = line.match(anyFieldRegex);
                if (fieldMatch) {
                    const type = fieldMatch[1];
                    const name = fieldMatch[2];
                    const fieldInfo = fieldMap.get(name);
                    if (fieldInfo) addInject(fieldInfo.range, type, name, "Field Injection (@Autowired)", undefined, fieldInfo.qualifier);
                } else if (i + 1 < lines.length) {
                    const nextLine = lines[i+1];
                    const nextFieldMatch = nextLine.match(anyFieldRegex);
                    if (nextFieldMatch) {
                         const type = nextFieldMatch[1];
                         const name = nextFieldMatch[2];
                         const fieldInfo = fieldMap.get(name);
                         if (fieldInfo) addInject(fieldInfo.range, type, name, "Field Injection (@Autowired)", undefined, fieldInfo.qualifier);
                    }
                }
            }

            if ((text.includes('@RequiredArgsConstructor') || text.includes('@AllArgsConstructor')) && line.includes('final')) {
                if (!line.includes('static')) {
                    const lMatch = line.match(anyFieldRegex);
                    if (lMatch) {
                        const type = lMatch[1];
                        const name = lMatch[2];
                        const fieldInfo = fieldMap.get(name);
                        if (fieldInfo) addInject(fieldInfo.range, type, name, "Lombok Constructor Injection", undefined, fieldInfo.qualifier);
                    }
                }
            }
        }

        if (currentClassName && !pendingClassAnnotation && classLineIndex !== -1 && classNameRange) {
            const cachedLoc = externalBeanCache.get(currentClassName);
            if (cachedLoc) {
                 addBean(classNameRange, currentClassName, currentClassName, "Defined in External Configuration");
            } else if (cachedLoc === undefined) {
                findBeanDefinition(uri, classLineIndex, currentClassName).then(loc => {
                    externalBeanCache.set(currentClassName, loc);
                    if (loc) updateDecorations(); 
                });
            }
        }

        activeEditor.setDecorations(beanDecoration, beans);
        activeEditor.setDecorations(injectDecoration, injects);
    }

    async function findBeanDefinition(uri: vscode.Uri, definitionLine: number, className: string, requiredQualifier?: string): Promise<vscode.Location | null> {
        let standardCandidate: vscode.Location | null = null;
        try {
            const doc = await vscode.workspace.openTextDocument(uri);
            const lineText = doc.lineAt(definitionLine).text;
            const classIndex = lineText.indexOf(className);
            const pos = new vscode.Position(definitionLine, classIndex !== -1 ? classIndex : 0);
            const refs = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeReferenceProvider', uri, pos);
            if (refs && refs.length > 0) {
                refs.sort((a, b) => {
                    const aScore = (a.uri.path.includes("Config") || a.uri.path.includes("App")) ? 1 : 0;
                    const bScore = (b.uri.path.includes("Config") || b.uri.path.includes("App")) ? 1 : 0;
                    return bScore - aScore;
                });
                for (const ref of refs.slice(0, 50)) {
                    if (ref.uri.fsPath === uri.fsPath) continue;
                    const refDoc = await vscode.workspace.openTextDocument(ref.uri);
                    const range = new vscode.Range(Math.max(0, ref.range.start.line - 5), 0, ref.range.start.line + 1, 999);
                    const txt = refDoc.getText(range);
                    if (txt.includes('@Bean')) {
                        if (requiredQualifier) {
                            if (txt.includes(`"${requiredQualifier}"`) || txt.includes(requiredQualifier)) return ref;
                        } else {
                            if (txt.includes('@Primary')) return ref; 
                            if (!standardCandidate) standardCandidate = ref; 
                        }
                    }
                }
            }
        } catch (e) { }
        const configFiles = await vscode.workspace.findFiles('**/*{Config,Configuration,Application}.java', '**/node_modules/**', 10);
        let manualCandidate: vscode.Location | null = null;
        for (const fileUri of configFiles) {
            const fileDoc = await vscode.workspace.openTextDocument(fileUri);
            const text = fileDoc.getText();
            if (text.includes('@Bean') && text.includes(className)) {
                const lines = text.split('\n');
                let foundBean = false; let foundPrimary = false; let foundQualifier = false;
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i].trim();
                    if (line.startsWith('@Bean')) foundBean = true;
                    if (line.startsWith('@Primary')) foundPrimary = true;
                    if (requiredQualifier && line.includes(`"${requiredQualifier}"`)) foundQualifier = true;
                    if (foundBean && line.includes(`public ${className}`)) {
                        const loc = new vscode.Location(fileUri, new vscode.Position(i, line.indexOf(className)));
                        if (requiredQualifier) { if (foundQualifier) return loc; } 
                        else { if (foundPrimary) return loc; if (!manualCandidate) manualCandidate = loc; }
                        foundBean = false; foundPrimary = false; foundQualifier = false;
                    }
                }
            }
        }
        return standardCandidate || manualCandidate;
    }

    async function navigateToImplementation(uri: vscode.Uri, line: number, exactType: string, checkAnnotations: boolean = false): Promise<boolean> {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return false;
        const targetLine = line; 
        const currentLineText = editor.document.lineAt(targetLine).text;
        const typeIndex = currentLineText.indexOf(exactType);
        const pos = new vscode.Position(targetLine, typeIndex !== -1 ? typeIndex : 0);
        try {
            const implementations = await vscode.commands.executeCommand<vscode.Location[]>('vscode.executeImplementationProvider', uri, pos);
            if (implementations && implementations.length > 0) {
                if (checkAnnotations) {
                    const loc = implementations[0];
                    const doc = await vscode.workspace.openTextDocument(loc.uri);
                    const text = doc.getText();
                    if (/@(Service|Component|Repository|Controller|RestController|Configuration)\b/.test(text)) {
                        vscode.window.setStatusBarMessage(`Bean defined via Annotation in ${exactType}`, 3000);
                        const e = await vscode.window.showTextDocument(doc);
                        e.selection = new vscode.Selection(loc.range.start, loc.range.start);
                        e.revealRange(loc.range);
                        return true;
                    }
                    return false;
                }
                if (implementations.length === 1) {
                    const loc = implementations[0];
                    const doc = await vscode.workspace.openTextDocument(loc.uri);
                    const e = await vscode.window.showTextDocument(doc);
                    e.selection = new vscode.Selection(loc.range.start, loc.range.start);
                    e.revealRange(loc.range);
                    return true;
                } 
                await vscode.commands.executeCommand('editor.action.showReferences', uri, pos, implementations);
                return true;
            }
        } catch (e) { }
        if (!checkAnnotations) {
             editor.selection = new vscode.Selection(pos, pos);
             await vscode.commands.executeCommand('editor.action.revealDefinition');
             return true;
        }
        return false;
    }

    let timeout: NodeJS.Timeout | undefined = undefined;
    function triggerUpdateDecorations() {
        if (timeout) { clearTimeout(timeout); timeout = undefined; }
        timeout = setTimeout(updateDecorations, 500);
    }

    if (activeEditor) triggerUpdateDecorations();
    vscode.window.onDidChangeActiveTextEditor(editor => { activeEditor = editor; if (editor) triggerUpdateDecorations(); }, null, context.subscriptions);
    vscode.workspace.onDidChangeTextDocument(event => { if (activeEditor && event.document === activeEditor.document) triggerUpdateDecorations(); }, null, context.subscriptions);
}

export function deactivate() {}