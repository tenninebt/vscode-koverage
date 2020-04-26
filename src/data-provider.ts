import * as vscodeLogging from '@vscode-logging/logger';
import * as iopath from 'path';
import * as vscode from 'vscode';
import { ConfigStore } from './config-store';
import { CoverageParser } from './coverage-parser';
import { FilesLoader } from './files-loader';
import { WorkspaceFolderCoverage } from './workspace-folder-coverage-file';

export class FileCoverageDataProvider implements vscode.TreeDataProvider<CoverageNode>, vscode.Disposable {

    private coverageWatcher: vscode.FileSystemWatcher;

    constructor(
        private readonly configStore: ConfigStore,
        private readonly coverageParser: CoverageParser,
        private readonly filesLoader: FilesLoader,
        private readonly logger: vscodeLogging.IVSCodeExtLogger) {

        if (configStore === null || configStore === undefined) {
            throw new Error('configStore must be defined');
        }

        if (coverageParser === null || coverageParser === undefined) {
            throw new Error('coverageParser must be defined');
        }

        if (filesLoader === null || filesLoader === undefined) {
            throw new Error('filesLoader must be defined');
        }
        this.listenToFileSystem();
        this.listenToConfigChanges();
    }

    listenToConfigChanges() {
        this.configStore.subscribe(_ => this.refresh('<ConfigChanged>'));
    }

    dispose() {
        this.coverageWatcher?.dispose();
    }

    private listenToFileSystem(): void {
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showInformationMessage('No file coverage in empty workspace');
            return;
        }
        for (let folder in vscode.workspace.workspaceFolders) {
            const searchPattern = iopath.join(folder, `**/{${this.configStore.current.coverageFilePaths}/**}`);
            this.logger.debug(`createFileSystemWatcher(Pattern = ${searchPattern})`);
            this.coverageWatcher = vscode.workspace.createFileSystemWatcher(searchPattern);
            this.coverageWatcher.onDidChange(() => this.refresh('<CoverageChanged>'));
            this.coverageWatcher.onDidCreate(() => this.refresh('<CoverageCreated>'));
            this.coverageWatcher.onDidDelete(() => this.refresh('<CoverageDeleted>'));
        }
    }

    getTreeItem(element: CoverageNode): vscode.TreeItem {
        return element;
    }

    getChildren(element?: CoverageNode): Thenable<CoverageNode[]> {
        if (!vscode.workspace.workspaceFolders) {
            vscode.window.showInformationMessage('No file coverage in empty workspace');
            return Promise.resolve([]);
        }
        if (!element) {
            return this
                .getIndexedCoverageData()
                .then(indexedCoverageData => {
                    for (let node of indexedCoverageData.values()) {
                        if (node.depth === 0) {
                            return node.children.sort((a, b) => a.path.localeCompare(b.path));
                        }
                    }
                });
        } else {
            return Promise.resolve(element.children.sort((a, b) => a.path.localeCompare(b.path)));
        }
    }

    private async getRawCoverageData(): Promise<Set<WorkspaceFolderCoverage>> {
        let coverageData = await this.filesLoader
            .loadCoverageFiles()
            .then(async files => await this.coverageParser.filesToSections(files));
        return coverageData;
    }

    private async getIndexedCoverageData(): Promise<Map<string, CoverageNode>> {

        let coverageData = await this.getRawCoverageData();

        let nodesMap: Map<string, CoverageNode> = new Map<string, CoverageNode>();

        for (const workspaceFolderCoverage of coverageData) {
            
            for (const [codeFilePath, coverageData] of workspaceFolderCoverage.coverage) {
                
                let pathSteps = iopath.join(workspaceFolderCoverage.workspaceFolder.name, codeFilePath).split('/');
                let parentPath = '';
                let path = '';

                for (let index = 0; index < pathSteps.length; index++) {
                    const step = pathSteps[index];
                    parentPath = path;
                    path = iopath.join(path, step);

                    if (!nodesMap.has(parentPath)) {
                        nodesMap.set(parentPath, new FolderCoverageNode(parentPath, parentPath, index, [],
                            FileCoverageDataProvider.getCoverageLevel(this.configStore)));
                    }

                    const parentNode = nodesMap.get(parentPath);
                    if (parentNode instanceof FolderCoverageNode) {
                        if (index === pathSteps.length - 1) {
                            const node = new FileCoverageNode(path, step, index, FileCoverageDataProvider.getCoverageLevel(this.configStore),
                                coverageData.lines.found, coverageData.lines.hit);
                            parentNode.children.push(node);
                            nodesMap.set(path, node);
                        } else {
                            if (!nodesMap.has(path)) {
                                const node = new FolderCoverageNode(path, step, index, [], FileCoverageDataProvider.getCoverageLevel(this.configStore));
                                parentNode.children.push(node);
                                nodesMap.set(path, node);
                            }
                        }
                    } else {
                        //Weird case !
                    }
                }
            }
        };
        return nodesMap;
    }

    private static getCoverageLevel(configStore: ConfigStore): (coveragePercent: number) => CoverageLevel {
        const coverageLevel = (coveragePercent: number) =>
            coveragePercent >= configStore.current.sufficientCoverageThreshold ? CoverageLevel.High :
                coveragePercent >= configStore.current.lowCoverageThreshold ? CoverageLevel.Medium :
                    CoverageLevel.Low;
        return coverageLevel;
    }

    private _onDidChangeTreeData: vscode.EventEmitter<CoverageNode | undefined> = new vscode.EventEmitter<CoverageNode | undefined>();
    readonly onDidChangeTreeData: vscode.Event<CoverageNode | undefined> = this._onDidChangeTreeData.event;

    refresh(reason: string): void {
        this.logger.debug(`Refreshing due to ${reason}...`);
        this._onDidChangeTreeData.fire();
    }
}

enum CoverageLevel {
    Low = 'low',
    Medium = 'medium',
    High = 'high'
}

export abstract class CoverageNode extends vscode.TreeItem {

    private coverageWatcher: vscode.FileSystemWatcher;

    constructor(
        public readonly path: string,
        public readonly label: string,
        public readonly depth: number,
        public readonly children: CoverageNode[],
        protected readonly getCoverageLevel: (coveragePercent: number) => CoverageLevel,
        collapsibleState: vscode.TreeItemCollapsibleState | undefined
    ) {
        super(label, collapsibleState);
    }

    public getCoveragePercent(): number {
        return this.coveredLinesCount / this.totalLinesCount * 100;
    }

    abstract get totalLinesCount(): number;

    abstract get coveredLinesCount(): number;

    get tooltip(): string {
        return `${this.label}: ${this.formatCoverage()}`;
    }

    get description(): string {
        return this.formatCoverage();
    }

    private formatCoverage(): string {
        return this.getCoveragePercent().toPrecision(2) + '%';
    }

    get resourceUri(): vscode.Uri {
        return vscode.Uri.file(iopath.join('./', this.path));
    }

    private _getCoverageLevel(): CoverageLevel {
        return this.getCoverageLevel(this.getCoveragePercent());
    }

    get iconPath() {
        const light = iopath.join(__filename, '..', '..', 'resources', 'light', `${this._getCoverageLevel().toString()}.svg`);
        const dark = iopath.join(__filename, '..', '..', 'resources', 'dark', `${this._getCoverageLevel().toString()}.svg`);
        return {
            light: light,
            dark: dark
        };
    }
}

class FolderCoverageNode extends CoverageNode {

    constructor(
        public readonly path: string,
        public readonly label: string,
        public readonly depth: number,
        public readonly children: CoverageNode[] = [],
        public readonly getCoverageLevel: (coveragePercent: number) => CoverageLevel,
    ) {
        super(path, label, depth, children, getCoverageLevel, vscode.TreeItemCollapsibleState.Collapsed);
    }

    get totalLinesCount(): number {
        var sum = 0;
        this.children.forEach(n => sum += n.totalLinesCount);
        return sum;
    }

    get coveredLinesCount(): number {
        var sum = 0;
        this.children.forEach(n => sum += n.coveredLinesCount);
        return sum;
    }
}

class FileCoverageNode extends CoverageNode {

    constructor(
        public readonly path: string,
        public readonly label: string,
        public readonly depth: number,
        public readonly getCoverageLevel: (coveragePercent: number) => CoverageLevel,
        public readonly totalLinesCount: number,
        public readonly coveredLinesCount: number,
    ) {
        super(path, label, depth, [], getCoverageLevel, vscode.TreeItemCollapsibleState.None);
    }

    get command(): vscode.Command {
        return {
            command: 'vscode.open',
            title: 'Open',
            arguments: [vscode.Uri.file(iopath.join(vscode.workspace.rootPath || '', this.path))],
        };
    }
}
