export interface ClipboardLike {
  writeText(text: string): Promise<void>;
  readText(): Promise<string>;
}

/** Copies text and, after a delay, clears the clipboard only if it still holds that text. */
export class ClipboardCleaner {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly clipboard: ClipboardLike) {}

  async copy(text: string, clearAfterSeconds: number): Promise<void> {
    this.cancel();
    await this.clipboard.writeText(text);
    if (clearAfterSeconds <= 0) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.clearIfUnchanged(text);
    }, clearAfterSeconds * 1000);
  }

  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async clearIfUnchanged(text: string): Promise<void> {
    try {
      if ((await this.clipboard.readText()) === text) await this.clipboard.writeText("");
    } catch {
      // Without read access we cannot tell whether the user copied something else since.
    }
  }
}
