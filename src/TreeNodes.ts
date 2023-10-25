import * as iopath from "path";
import * as vscode from "vscode";
import { CoverageLevel } from "./CoverageLevel";
import { type CoverageLevelThresholds } from "./CoverageLevel";

export abstract class BaseNode extends vscode.TreeItem {
    constructor(
        public readonly path: string,
        public readonly label: string,
        public readonly children: CoverageNode[],
        collapsibleState: vscode.TreeItemCollapsibleState | undefined
    ) {
        super(label, collapsibleState);
    }

    // @ts-expect-error Children are settable, thus this value can't be set in the constructor, maybe it should be updated whenever the children are updated
    public get resourceUri(): vscode.Uri {
        return vscode.Uri.file(this.path);
    }
}

export class RootCoverageNode extends BaseNode {
    constructor(path: string, label: string, children: CoverageNode[] = []) {
        super(path, label, children, vscode.TreeItemCollapsibleState.Collapsed);
    }

    get totalLinesCount(): number {
        let sum = 0;
        this.children.forEach((n) => (sum += n.totalLinesCount));
        return sum;
    }

    get coveredLinesCount(): number {
        let sum = 0;
        this.children.forEach((n) => (sum += n.coveredLinesCount));
        return sum;
    }
}

export abstract class CoverageNode extends BaseNode {
    constructor(
        path: string,
        label: string,
        children: CoverageNode[],
        collapsibleState: vscode.TreeItemCollapsibleState | undefined,
        private readonly coverageLevelThresholds: CoverageLevelThresholds
    ) {
        super(path, label, children, collapsibleState);
    }

    private getCoveragePercent(): number {
        return this.totalLinesCount === 0 ? 100 : (this.coveredLinesCount / this.totalLinesCount) * 100;
    }

    abstract get totalLinesCount(): number;

    abstract get coveredLinesCount(): number;

    // @ts-expect-error Children are settable, thus this value can't be set in the constructor, maybe it should be updated whenever the children are updated
    get tooltip(): string {
        return `${this.label}: ${this.formatCoverage()}`;
    }

    // @ts-expect-error Children are settable, thus this value can't be set in the constructor, maybe it should be updated whenever the children are updated
    get description(): string {
        return this.formatCoverage();
    }

    private formatCoverage(): string {
        return `${+this.getCoveragePercent().toFixed(1)}%`;
    }

    private getCoverageLevel(): CoverageLevel {
        const coverageLevel = this.getCoveragePercent() >= this.coverageLevelThresholds.sufficientCoverageThreshold
            ? CoverageLevel.High
            : this.getCoveragePercent() >= this.coverageLevelThresholds.lowCoverageThreshold
                ? CoverageLevel.Medium
                : CoverageLevel.Low;
        return coverageLevel;
    }

    // @ts-expect-error Children are settable, thus this value can't be set in the constructor, maybe it should be updated whenever the children are updated
    get iconPath(): { light: string; dark: string; } {
        const light = iopath.join(__dirname, "..", "resources", "light", `${this.getCoverageLevel().toString()}.svg`);
        const dark = iopath.join(__dirname, "..", "resources", "dark", `${this.getCoverageLevel().toString()}.svg`);
        return {
            light,
            dark
        };
    }
}

export class FileCoverageNode extends CoverageNode {
    constructor(
        path: string,
        label: string,
        coverageLevelThresholds: CoverageLevelThresholds,
        public readonly totalLinesCount: number,
        public readonly coveredLinesCount: number
    ) {
        super(path, label, [], vscode.TreeItemCollapsibleState.None, coverageLevelThresholds);
        this.contextValue = FileCoverageNode.name;
        this.command = {
            command: "vscode.open",
            title: "Open",
            arguments: [vscode.Uri.file(this.path)]
        };
    }
}

export class FolderCoverageNode extends CoverageNode {
    constructor(path: string, label: string, children: CoverageNode[] = [], coverageLevelThresholds: CoverageLevelThresholds) {
        super(path, label, children, vscode.TreeItemCollapsibleState.Collapsed, coverageLevelThresholds);
    }

    get totalLinesCount(): number {
        let sum = 0;
        this.children.forEach((n) => (sum += n.totalLinesCount));
        return sum;
    }

    get coveredLinesCount(): number {
        let sum = 0;
        this.children.forEach((n) => (sum += n.coveredLinesCount));
        return sum;
    }
}
