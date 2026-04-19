const boxVertexData = new Float32Array([
  // position, n, uv_or_color
  // front
  -1, 1, 1, 1,    0, 0, 1, 0,   0, 0, 0, -1,
  1, 1, 1, 1,     0, 0, 1, 0,   1, 0, 0, -1,
  -1, -1, 1, 1,   0, 0, 1, 0,   0, 1, 0, -1,
  1, -1, 1, 1,    0, 0, 1, 0,   1, 1, 0, -1,
  // right
  1, 1, 1, 1,     1, 0, 0, 0,   0, 0, 0, -1,
  1, 1, -1, 1,    1, 0, 0, 0,   1, 0, 0, -1,
  1, -1, 1, 1,    1, 0, 0, 0,   0, 1, 0, -1,
  1, -1, -1, 1,   1, 0, 0, 0,   1, 1, 0, -1,
  // back
  1, 1, -1, 1,    0, 0, -1, 0,  0, 0, 0, -1,
  -1, 1, -1, 1,   0, 0, -1, 0,  1, 0, 0, -1,
  1, -1, -1, 1,   0, 0, -1, 0,  0, 1, 0, -1,
  -1, -1, -1, 1,  0, 0, -1, 0,  1, 1, 0, -1,
  // left
  -1, 1, -1, 1,   -1, 0, 0, 0,  0, 0, 0, -1,
  -1, 1, 1, 1,    -1, 0, 0, 0,  1, 0, 0, -1,
  -1, -1, -1, 1,  -1, 0, 0, 0,  0, 1, 0, -1,
  -1, -1, 1, 1,   -1, 0, 0, 0,  1, 1, 0, -1,
  // top
  -1, 1, -1, 1,   0, 1, 0, 0,   0, 0, 0, -1,
  1, 1, -1, 1,    0, 1, 0, 0,   1, 0, 0, -1,
  -1, 1, 1, 1,    0, 1, 0, 0,   0, 1, 0, -1,
  1, 1, 1, 1,     0, 1, 0, 0,   1, 1, 0, -1,
  // bottom
  -1, -1, 1, 1,   0, -1, 0, 0,  0, 0, 0, -1,
  1, -1, 1, 1,    0, -1, 0, 0,  1, 0, 0, -1,
  -1, -1, -1, 1,  0, -1, 0, 0,  0, 1, 0, -1,
  1, -1, -1, 1,   0, -1, 0, 0,  1, 1, 0, -1,
]);
const boxIndexData = new Uint16Array([
  // front
  2, 1, 0, 1, 2, 3,
  // right
  6, 5, 4, 5, 6, 7,
  // back
  10, 9, 8, 9, 10, 11,
  // left
  14, 13, 12, 13, 14, 15,
  // top
  18, 17, 16, 17, 18, 19,
  // bottom
  22, 21, 20, 21, 22, 23,
]);

const floorVertexData = new Float32Array([
  // position, n, uv_or_color
  -1, 0, -1, 1,   0, 1, 0, 0,   1, 1, 1, 1,
  1, 0, -1, 1,    0, 1, 0, 0,   1, 1, 1, 1,
  -1, 0, 1, 1,    0, 1, 0, 0,   1, 1, 1, 1,
  1, 0, 1, 1,     0, 1, 0, 0,   1, 1, 1, 1,
]);
const floorIndexData = new Uint16Array([
  2, 1, 0, 1, 2, 3,
]);

export interface GeometryBufferData {
  label?: string;
  vertices: GPUBuffer;
  indices: GPUBuffer;
}

export class Geometry {
  public vertices: Float32Array<ArrayBuffer>;
  public indices: Uint16Array<ArrayBuffer>;
  public label?: string;

  constructor(options: {
    vertices: Float32Array<ArrayBuffer>,
    indices: Uint16Array<ArrayBuffer>,
    label?: string,
  }) {
    this.vertices = options.vertices;
    this.indices = options.indices;
    this.label = options.label;
  }

  public createGeometryBuffers(device: GPUDevice): GeometryBufferData {
    const data: GeometryBufferData = {
      vertices: device.createBuffer({
        size: this.vertices.byteLength,
        usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      }),
      indices: device.createBuffer({
        size: this.indices.byteLength,
        usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      }),
    };
    if (this.label) {
      data.label = this.label;
    }

    device.queue.writeBuffer(data.vertices, 0, this.vertices);
    device.queue.writeBuffer(data.indices, 0, this.indices);

    return data;
  }
}

export const box = new Geometry({
  label: 'box',
  vertices: boxVertexData,
  indices: boxIndexData,
});

export const floor = new Geometry({
  label: 'floor',
  vertices: floorVertexData,
  indices: floorIndexData,
});
