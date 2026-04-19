export class TimestampQueryManager {
  public querySet: GPUQuerySet;
  public buffer: GPUBuffer;
  public mappableBuffer: GPUBuffer;

  private hostMs: number | undefined = undefined;

  constructor(device: GPUDevice) {
    this.querySet = device.createQuerySet({
      type: 'timestamp',
      count: 2,
    });

    this.buffer = device.createBuffer({
      size: this.querySet.count * 8,
      usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
    });

    this.mappableBuffer = device.createBuffer({
      size: this.buffer.size,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
  }

  public async retrieveAndShowTimestamps(info: HTMLElement) {
    if (this.mappableBuffer.mapState !== 'unmapped') {
      return;
    }

    await this.mappableBuffer.mapAsync(GPUMapMode.READ);

    const buffer = this.mappableBuffer.getMappedRange();
    const timestamps = new BigInt64Array(buffer);

    try {
      info.innerHTML = '';

      if (this.hostMs != null) {
        const node = document.createElement('div');
        node.textContent = `host total: ${this.hostMs.toFixed(2)} ms`;
        info.appendChild(node);
      }

      {
        const node = document.createElement('div');
        const elapsedTotalMs = Number(timestamps[timestamps.length - 1] - timestamps[0]) * 1e-6;
        node.textContent = `gpu total: ${elapsedTotalMs.toFixed(2)} ms`;
        info.appendChild(node);
      }
    } finally {
      this.mappableBuffer.unmap();
    }
  }

  public setElapsedHost(hostMs: number) {
    this.hostMs = hostMs;
  }
}
