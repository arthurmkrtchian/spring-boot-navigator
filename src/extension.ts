import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    console.log('--- Spring Bean Navigator (Optimized & Debounced) ACTIVE ---');

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


    const findUsagesCmd = vscode.commands.registerCommand('springNav.showUsages', async (uri: vscode.Uri, line: number) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const pos = new vscode.Position(line, 0);
        editor.selection = new vscode.Selection(pos, pos);
        
        const nextLineIndex = line + 1;
        if (nextLineIndex < editor.document.lineCount) {
             const nextLine = editor.document.lineAt(nextLineIndex);
             const classMatch = nextLine.text.match(/class\s+(\w+)/);
             if (classMatch) {
                 const nameIndex = nextLine.text.indexOf(classMatch[1]);
                 const namePos = new vscode.Position(nextLineIndex, nameIndex);
                 editor.selection = new vscode.Selection(namePos, namePos);
             }
        }
        await vscode.commands.executeCommand('editor.action.referenceSearch.trigger');
    });

    const goToDefCmd = vscode.commands.registerCommand('springNav.goToDef', async (uri: vscode.Uri, line: number) => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const lineText = editor.document.lineAt(line).text;
        const strictRegex = /(?:public|protected|private|static|final|transient|volatile|@\w+|\s)*([\w<>]+)\s+\w+/;
        
        let match = lineText.match(strictRegex);
        let targetLine = line;

        if (!match && line + 1 < editor.document.lineCount) {
             const nextLineText = editor.document.lineAt(line + 1).text;
             match = nextLineText.match(strictRegex);
             if (match) { targetLine = line + 1; }
        }

        let targetPos = new vscode.Position(targetLine, 0);

        if (match && match[1]) {
            const typeName = match[1];
            const typeIndex = editor.document.lineAt(targetLine).text.indexOf(typeName);
            if (typeIndex !== -1) {
                targetPos = new vscode.Position(targetLine, typeIndex);
            }
        } else {
             const words = editor.document.lineAt(targetLine).text.trim().split(/\s+/);
             for (const word of words) {
                 if (/^[A-Z]/.test(word) && !word.startsWith('@')) {
                     const idx = editor.document.lineAt(targetLine).text.indexOf(word);
                     targetPos = new vscode.Position(targetLine, idx);
                     break;
                 }
             }
        }

        editor.selection = new vscode.Selection(targetPos, targetPos);
        await vscode.commands.executeCommand('editor.action.revealDefinition');
    });

    context.subscriptions.push(findUsagesCmd, goToDefCmd);


    let activeEditor = vscode.window.activeTextEditor;

    function updateDecorations() {
        if (!activeEditor) return;
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
            const commandUri = vscode.Uri.parse(`command:springNav.goToDef?${encodeURIComponent(JSON.stringify(args))}`);
            const markdown = new vscode.MarkdownString(`**Injection**: [Go to Bean](${commandUri})`);
            markdown.isTrusted = true;

            injects.push({ range: new vscode.Range(startPos, endPos), hoverMessage: markdown });
        }

        if (text.includes('@RequiredArgsConstructor')) {
            const lombokFieldRegex = /(?:public|protected|private)?\s*final\s+([\w<>]+)\s+(\w+)\s*;/g;
            while ((match = lombokFieldRegex.exec(text))) {
                const fullMatchStart = match.index > 0 ? text.substring(match.index - 7, match.index) : "";
                if (fullMatchStart.includes("static")) continue;

                const startPos = activeEditor.document.positionAt(match.index);
                const endPos = activeEditor.document.positionAt(match.index + match[0].length);

                const args = [activeEditor.document.uri, startPos.line];
                const commandUri = vscode.Uri.parse(`command:springNav.goToDef?${encodeURIComponent(JSON.stringify(args))}`);
                const markdown = new vscode.MarkdownString(`**Lombok Injection**: [Go to Bean](${commandUri})`);
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

    if (activeEditor) triggerUpdateDecorations();

    // Слушатели событий
    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
        if (editor) triggerUpdateDecorations();
    }, null, context.subscriptions);

    vscode.workspace.onDidChangeTextDocument(event => {
        if (activeEditor && event.document === activeEditor.document) {
            triggerUpdateDecorations(); // Вызываем оптимизированную версию
        }
    }, null, context.subscriptions);
}

export function deactivate() {}