import * as vscode from 'vscode';
import { PseudoDebugSession } from './session';

const TYPE = 'pseudo';

/**
 * Registers the debug adapter, inline: the session runs inside the extension
 * host, so there is no second process and no protocol framing to marshal.
 */
export function registerDebugger(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.debug.registerDebugAdapterDescriptorFactory(TYPE, {
      createDebugAdapterDescriptor: () =>
        new vscode.DebugAdapterInlineImplementation(new PseudoDebugSession()),
    }),

    // Lets F5 work on an open .pseudo file with no launch.json present.
    vscode.debug.registerDebugConfigurationProvider(TYPE, {
      resolveDebugConfiguration: (_folder, config) => {
        if (config.type === undefined && config.request === undefined) {
          const editor = vscode.window.activeTextEditor;
          if (editor?.document.languageId !== 'pseudocode') return undefined;
          config.type = TYPE;
          config.request = 'launch';
          config.name = 'Debug pseudocode file';
          config.program = editor.document.uri.fsPath;
          config.stopOnEntry = true;
        }

        const settings = vscode.workspace.getConfiguration('pseudoLang');
        config.strictDeclarations ??= settings.get<boolean>('strictDeclarations', false);
        config.maxCallDepth ??= settings.get<number>('maxCallDepth', 2000);
        config.randomFileRecordSize ??= settings.get<number>('randomFileRecordSize', 512);
        return config;
      },
    }),

    // INPUT has no terminal during a debug session, so the adapter asks for a
    // line and the extension puts the question in front of the user.
    vscode.debug.onDidReceiveDebugSessionCustomEvent(async (event) => {
      if (event.session.type !== TYPE || event.event !== 'pseudoInputRequest') return;
      const value = await vscode.window.showInputBox({
        prompt: 'INPUT',
        placeHolder: 'the value the program is waiting for',
        ignoreFocusOut: true,
      });
      await event.session.customRequest('pseudoInputResponse', { value: value ?? null });
    }),
  );
}
