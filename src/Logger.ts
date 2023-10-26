import * as vscode from "vscode"

export interface Logger {
    trace: (message: string, ...args: any[]) => void
    debug: (message: string, ...args: any[]) => void
    info: (message: string, ...args: any[]) => void
    warn: (message: string, data?: any) => void
    error: (message: string, data?: any) => void
}

export class OutputChannelLogger implements vscode.Disposable {
    private readonly output: vscode.LogOutputChannel

    constructor(name = "Koverage") {
        this.output = vscode.window.createOutputChannel(name, { log: true })
    }

    public get logLevel(): vscode.LogLevel {
        return this.output.logLevel
    }

    public info(message: string, ...args: any[]): void {
        this.output.info(message, ...args)
    }

    public debug(message: string, ...args: any[]): void {
        this.output.debug(message, ...args)
    }

    public trace(message: string, ...args: any[]): void {
        this.output.trace(message, ...args)
    }

    public warn(message: string, data?: any): void {
        this.output.warn(message, ...(data ? [data] : []))
    }

    public error(message: string, data?: any): void {
        // See https://github.com/microsoft/TypeScript/issues/10496
        if (data && data.message === 'No content available.') {
            return
        }
        this.output.error(message, ...(data ? [data] : []))
    }

    public dispose(): void {
        this.output.dispose()
    }
}