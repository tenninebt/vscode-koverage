// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { FileCoverageDataProvider, CoverageNode } from './dataProvider';
import { CoverageParser } from './coverage-parser';
import { FilesLoader } from './files-loader';
import { ConfigStore } from './configStore';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
	console.log('Congratulations, your extension "koverage" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json

	const outputChannel = vscode.window.createOutputChannel(`Koverage`);
	const configStore = new ConfigStore(outputChannel);
	const fileCoverageDataProvider = new FileCoverageDataProvider(
		configStore,
		new CoverageParser(outputChannel),
		new FilesLoader(configStore),
		outputChannel);

	let treeView = vscode.window.createTreeView('koverage', {
		treeDataProvider: fileCoverageDataProvider,
		showCollapseAll: true,
		canSelectMany: false
	});

	// --- Commands
	let refresh = vscode.commands.registerCommand('koverage.refresh', () =>
		fileCoverageDataProvider.refresh()
	);
	//TODO fix this command
	let openFile = vscode.commands.registerCommand('koverage.openFile', (node: CoverageNode) => {
		if (node.command) {
			vscode.commands.executeCommand(node.command.command || '', node.command.arguments);
		}
	});

	context.subscriptions.push(refresh);
	context.subscriptions.push(openFile);
	context.subscriptions.push(treeView);
	context.subscriptions.push(outputChannel);
}

// this method is called when your extension is deactivated
export function deactivate() { }
