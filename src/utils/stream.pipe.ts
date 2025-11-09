import { Transform, TransformCallback } from 'stream';

export class CounterStream extends Transform {
  private bytesProcessed = 0;

  _transform(
    chunk: unknown,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    this.bytesProcessed += (chunk as Buffer).length;
    this.push(chunk);
    callback();
  }

  getBytesProcessed(): number {
    return this.bytesProcessed;
  }
}

export class ProgressStream extends Transform {
  private bytesProcessed = 0;
  private lastReportedProgress = 0;
  private readonly reportInterval: number;
  private readonly onProgress?: (bytes: number) => void;

  constructor(
    reportIntervalBytes = 1024 * 1024,
    onProgress?: (bytes: number) => void,
  ) {
    super();
    this.reportInterval = reportIntervalBytes;
    this.onProgress = onProgress;
  }

  _transform(
    chunk: unknown,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const buffer = chunk as Buffer;
    this.bytesProcessed += buffer.length;

    if (
      this.bytesProcessed - this.lastReportedProgress >=
      this.reportInterval
    ) {
      this.lastReportedProgress = this.bytesProcessed;
      if (this.onProgress) {
        this.onProgress(this.bytesProcessed);
      }
    }

    this.push(chunk);
    callback();
  }

  _flush(callback: TransformCallback): void {
    if (this.onProgress && this.bytesProcessed > this.lastReportedProgress) {
      this.onProgress(this.bytesProcessed);
    }
    callback();
  }

  getBytesProcessed(): number {
    return this.bytesProcessed;
  }
}
