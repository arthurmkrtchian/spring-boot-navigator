import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('--- Spring Bean Navigator (Lint Fixed) ACTIVE ---');

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

    const showUsagesCmd = vscode.commands.registerCommand('springNav.showUsages', async (uri: vscode.Uri, line: number) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);

        const nextLineIndex = line + 1;
        if (nextLineIndex < editor.document.lineCount) {
             const nextLine = editor.document.lineAt(nextLineIndex);
             const classMatch = nextLine.text.match(/(?:class|interface)\s+(\w+)/);
             if (classMatch) {
                 const nameIndex = nextLine.text.indexOf(classMatch[1]);
                 const namePos = new vscode.Position(nextLineIndex, nameIndex);
                 editor.selection = new vscode.Selection(namePos, namePos);
             } else {
                 const methodMatch = nextLine.text.match(/\s+\w+\s+(\w+)\(/);
                 if (methodMatch) {
                     const nameIndex = nextLine.text.indexOf(methodMatch[1]);
                     const namePos = new vscode.Position(nextLineIndex, nameIndex);
                     editor.selection = new vscode.Selection(namePos, namePos);
                 }
             }
        }
        await vscode.commands.executeCommand('editor.action.referenceSearch.trigger');
    });

    const navigateToBeanCmd = vscode.commands.registerCommand('springNav.navigateToBean', async (uri: vscode.Uri, line: number) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            return;
        }

        const lineText = editor.document.lineAt(line).text;
        
        const typeRegex = /(?:private|protected|public|static|final|transient|@\w+|\s)*([\w<>]+)\s+\w+/;
        
        let match = lineText.match(typeRegex);
        let targetLine = line;

        if (!match && line + 1 < editor.document.lineCount) {
             const nextLineText = editor.document.lineAt(line + 1).text;
             match = nextLineText.match(typeRegex);
             if (match) {
                 targetLine = line + 1;
             }
        }

        if (!match || !match[1]) {
            await vscode.commands.executeCommand('editor.action.revealDefinition');
            return;
        }

        const typeName = match[1];
        
        const currentLineText = editor.document.lineAt(targetLine).text;
        const typeIndex = currentLineText.indexOf(typeName);
        const pos = new vscode.Position(targetLine, typeIndex !== -1 ? typeIndex : 0);
        editor.selection = new vscode.Selection(pos, pos);

        try {
            const implementations = await vscode.commands.executeCommand<vscode.Location[]>(
                'vscode.executeImplementationProvider',
                uri,
                pos
            );

            if (implementations && implementations.length > 0) {
                if (implementations.length === 1) {
                    const loc = implementations[0];
                    const doc = await vscode.workspace.openTextDocument(loc.uri);
                    const e = await vscode.window.showTextDocument(doc);
                    e.selection = new vscode.Selection(loc.range.start, loc.range.start);
                    e.revealRange(loc.range);
                } else {
                    await vscode.commands.executeCommand('editor.action.showReferences', uri, pos, implementations);
                }
                return;
            }
        } catch (e) {
            console.log("Implementation search failed, fallback to definition");
        }

        await vscode.commands.executeCommand('editor.action.revealDefinition');
    });

    context.subscriptions.push(showUsagesCmd, navigateToBeanCmd);

    let activeEditor = vscode.window.activeTextEditor;

    function updateDecorations() {
        if (!activeEditor) {
            return;
        }
        const text = activeEditor.document.getText();
        const beans: vscode.DecorationOptions[] = [];
        const injects: vscode.DecorationOptions[] = [];

        const beanRegex = /(@Component|@Service|@Repository|@Controller|@RestController|@Configuration|@Bean)/g;
        let match;
        while ((match = beanRegex.exec(text))) {
            const startPos = activeEditor.document.positionAt(match.index);
            const endPos = activeEditor.document.positionAt(match.index + match[0].length);
            
            const args = [activeEditor.document.uri, startPos.line];
            const commandUri = vscode.Uri.parse(`command:springNav.showUsages?${encodeURIComponent(JSON.stringify(args))}`);
            const markdown = new vscode.MarkdownString(`**Spring Bean**: [Show Usages](${commandUri})`);
            markdown.isTrusted = true;

            beans.push({ range: new vscode.Range(startPos, endPos), hoverMessage: markdown });
        }

        const injectRegex = /(@Autowired|@Inject|@Resource)/g;
        while ((match = injectRegex.exec(text))) {
            const startPos = activeEditor.document.positionAt(match.index);
            const endPos = activeEditor.document.positionAt(match.index + match[0].length);

            const args = [activeEditor.document.uri, startPos.line];
            const commandUri = vscode.Uri.parse(`command:springNav.navigateToBean?${encodeURIComponent(JSON.stringify(args))}`);
            const markdown = new vscode.MarkdownString(`**Injection**: [Go to Implementation](${commandUri})`);
            markdown.isTrusted = true;

            injects.push({ range: new vscode.Range(startPos, endPos), hoverMessage: markdown });
        }

        if (text.includes('@RequiredArgsConstructor') || text.includes('@AllArgsConstructor')) {
            const lombokFieldRegex = /(?:private|protected|public)?\s*final\s+([\w<>]+)\s+(\w+)\s*;/g;
            
            while ((match = lombokFieldRegex.exec(text))) {
                const fullMatchStart = match.index > 10 ? text.substring(match.index - 10, match.index) : "";
                if (fullMatchStart.includes("static")) {
                    continue;
                }

                const startPos = activeEditor.document.positionAt(match.index);
                const endPos = activeEditor.document.positionAt(match.index + match[0].length);

                const args = [activeEditor.document.uri, startPos.line];
                const commandUri = vscode.Uri.parse(`command:springNav.navigateToBean?${encodeURIComponent(JSON.stringify(args))}`);
                const markdown = new vscode.MarkdownString(`**Lombok Injection**: [Go to Implementation](${commandUri})`);
                markdown.isTrusted = true;

                injects.push({ range: new vscode.Range(startPos, endPos), hoverMessage: markdown });
            }
        }

        activeEditor.setDecorations(beanDecoration, beans);
        activeEditor.setDecorations(injectDecoration, injects);
    }

    let timeout: NodeJS.Timeout | undefined = undefined;
    function triggerUpdateDecorations() {
        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }
        timeout = setTimeout(updateDecorations, 500);
    }

    if (activeEditor) {
        triggerUpdateDecorations();
    }

    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
        if (editor) {
            triggerUpdateDecorations();
        }
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (activeEditor && event.document === activeEditor.document) {
            triggerUpdateDecorations();
        }
    }, null, context.subscriptions);
}

export function deactivate() {}